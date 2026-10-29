// Prueba offline de quien ve el registro de Iniciativas y quien puede pedir
// una iniciativa (App_Code/AccesoIniciativas.cs, 2026-10-28) A TRAVES DE LOS
// HANDLERS reales y de AdminAccesoModulo.Revisar (la pagina estatica), con
// un HttpContext armado a mano: sin IIS y sin SQL Server. El rol
// (dbo.UsuariosAdmin) y los dueños (dbo.CatPersona +
// dbo.CatCategoriaDueno, AccesoIniciativas.FuenteDuenos) salen de fuentes
// falsas. En la matriz PO es Product Owner vigente, SO es Service Owner
// vigente, COMUN esta en CatPersona sin ser dueño y MOD no es dueño.
//
// La regla:
//   registro (Iniciativas)        todos, tambien anonimos (2026-10-29)
//   Solicitar / Mis solicitudes   ADM, MOD, PO y SO; los demas no.
//   Administracion                ADM y MOD (AccesoAdmin); PO/SO no.
//
//   C   el interruptor de sql/30 (Leer): solo Encendido = 1 abre; 0, sin
//       fila, error o sin fuente cierran; el error se registra.
//   I   el interruptor ya NO decide el acceso: nada del sitio lo lee.
//   W   Web.config no cuenta: el fuente no lee appSettings.
//   G   el registro (pagina, registro, ?export=1 y Cobertura) es de todos,
//       tambien anonimos, por el modulo y llamando al handler, sin
//       consultar el rol ni los dueños.
//   S   Solicitar: la pagina y los 4 handlers de Nueva solicitud pasan para
//       ADM, MOD, PO y SO; la cuenta comun recibe 403 "solo PO/SO" en los 4
//       handlers (por URL directa y por el modulo); el anonimo, 403.
//   X   lo de Admin (solicitudes de cambio, Nuevas, revision, acuse,
//       gestion, recientes, diagnostico, correos, alta de categoria,
//       ?duenos=1, volumetria total) sigue 403 para PO, SO y la cuenta
//       comun; el modulo tambien. Ninguno gana rol (siguen VIEWER).
//   B   el navegador no decide: una query trampa (?solicitante=1, rol=ADM,
//       INICIATIVAS_ABIERTAS=1...) no abre nada.
//   E   admin_sesion: autorizado / rol / solicitante / registro segun la
//       regla.
//   U   rutas de otros modulos del tablero: el modulo no las toca.
//   P   PO / SO VIGENTE: el PO y el SO de una fila vigente entran; quien
//       esta en CatPersona sin ser dueño, el de una fila dada de baja, quien
//       pierde la asignacion (siguiente request), la cuenta ambigua o sin
//       persona no; dueño heredado del C1 y fila solo de C1 cuentan; error
//       al leer: cerrado, registrado y marcado; una lectura por request.
//   L   PIERDE ADM/MOD SIENDO PO/SO: en el siguiente request Admin entero es
//       403 y admin_sesion autorizado false; sigue con el registro y con
//       Nueva solicitud (PO/SO); nunca devuelve el rol. Consultas que fallan:
//       nunca dan acceso y admin_sesion lo marca "incompleta" (SOLO entonces).
//   F   el fuente: quien usa ExigirSolicitud / ExigirRegistro.
//
// Compilar como AccesoAdminHttpSmoke (adm.dll + hnd.dll) y correr con cwd =
// raiz del repo.
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Principal;
using System.Web;

// El interruptor de adm.Interruptor sin SQL: valor (null = sin fila) o error.
sealed class InterruptorFalso : IFuenteInterruptores
{
    public bool? Valor;
    public bool Lanza;
    public string UltimaClave;
    public bool? Encendido(string clave)
    {
        UltimaClave = clave;
        if (Lanza) throw new InvalidOperationException("adm.Interruptor no se pudo leer");
        return Valor;
    }
}

// dbo.CatPersona + dbo.CatCategoriaDueno sin SQL, o error.
sealed class DuenosFalsos : IFuenteDuenosVigentes
{
    public readonly List<PersonaCatalogo> Personas = new List<PersonaCatalogo>();
    public readonly List<DirectorioOrganizacional.Dueno> Filas = new List<DirectorioOrganizacional.Dueno>();
    public bool Lanza;
    public int Lecturas;

    public DuenosFalsos Persona(string nombre, string correo)
    {
        Personas.Add(new PersonaCatalogo { Nombre = nombre, Correo = correo });
        return this;
    }

    public DuenosFalsos Fila(string n2, string c1, string po, string so, bool vigente)
    {
        Filas.Add(new DirectorioOrganizacional.Dueno { CategoriaN2 = n2, C1 = c1, Po = po, So = so, Director = "Dir", Vigente = vigente });
        return this;
    }

    public DuenosVigentes Leer()
    {
        Lecturas++;
        if (Lanza) throw new InvalidOperationException("CatCategoriaDueno no se pudo leer");
        // Copia: el directorio normaliza las filas en sitio.
        var filas = new List<DirectorioOrganizacional.Dueno>();
        foreach (var f in Filas)
            filas.Add(new DirectorioOrganizacional.Dueno { CategoriaN2 = f.CategoriaN2, C1 = f.C1, Po = f.Po, So = f.So, Director = f.Director, Vigente = f.Vigente });
        return new DuenosVigentes { Personas = new List<PersonaCatalogo>(Personas), Directorio = new DirectorioOrganizacional(filas, new Dictionary<string, string>()) };
    }
}

sealed class RolesFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public bool Lanza;
    public int Lecturas;
    public IList<string> AccesosDe(string cuenta)
    {
        Lecturas++;
        if (Lanza) throw new InvalidOperationException("dbo.UsuariosAdmin no se pudo leer");
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

public static class AccesoIniciativasHttpSmoke
{
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // null = sin usuario; "" = anonimo.
    static HttpContext Contexto(string archivo, string query, string cuenta, StringWriter salida)
    {
        var ctx = new HttpContext(
            new HttpRequest(archivo, "http://localhost/handlers/" + archivo, query ?? ""),
            new HttpResponse(salida));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        return ctx;
    }

    static string Correr(IHttpHandler h, string archivo, string query, string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = Contexto(archivo, query, cuenta, sw);
        try { h.ProcessRequest(ctx); }
        catch (Exception ex) { sw.Write("EXCEPCION " + ex.GetType().Name); }
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    // AdminAccesoModulo sobre una ruta: "pasa" o "403|html|json" + el motivo:
    // "cerrada" (anonimo), "duenos" (solo PO/SO), "cuenta" (registro sin
    // cuenta) o "admin" (Admin).
    static string Modulo(string ruta, string cuenta, string query = null)
    {
        var sw = new StringWriter();
        var ctx = Contexto("x", query, cuenta, sw);
        var sigue = AdminAccesoModulo.Revisar(ctx, ruta);
        HttpContext.Current = null;
        if (sigue) return "pasa";
        var cuerpo = sw.ToString();
        return ctx.Response.StatusCode + "|" + (cuerpo.StartsWith("<!doctype") ? "html" : "json") + "|" +
               (cuerpo.Contains("no está abierta") ? "cerrada" : EsDuenos(cuerpo) ? "duenos" : "admin");
    }

    static bool EsDuenos(string cuerpo) { return cuerpo.Contains("Service Owners (SO) vigentes"); }

    // La pagina (por el modulo) y los 4 handlers de Nueva solicitud llamados
    // directo, en ese orden: P = paso la puerta (400/405/500 sin SQL),
    // D = 403 "solo PO/SO vigentes", C = 403 anonimo, X = otro 403.
    static string Puertas(string cuenta, string query = null)
    {
        var m = Modulo("~/admin/iniciativas.html", cuenta);
        var s = m == "pasa" ? "P" : m.EndsWith("duenos") ? "D" : m.EndsWith("cerrada") ? "C" : "X";
        var hs = new KeyValuePair<IHttpHandler, string>[]
        {
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx"),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx"),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasVolumetria(), "admin_iniciativas_volumetria.ashx"),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx"),
        };
        foreach (var h in hs)
        {
            int estado;
            var q = h.Value == "admin_iniciativas_catalogos.ashx" ? "rutas=1" + (query == null ? "" : "&" + query) : query;
            var cuerpo = Correr(h.Key, h.Value, q, cuenta, out estado);
            s += estado != 403 ? "P" : EsDuenos(cuerpo) ? "D" : cuerpo.Contains("no está abierta") ? "C" : "X";
        }
        return s;
    }

    // El registro: la pagina, el registro y la Cobertura por el modulo, y
    // el registro, ?export=1 y la Cobertura llamando al handler. "P" = paso
    // la puerta (sin base aqui: 500), "X" = 403.
    static string Registro(string cuenta)
    {
        var s = "";
        foreach (var r in new[] { "~/admin/iniciativas.html", "~/handlers/admin_iniciativas_registro.ashx", "~/handlers/admin_iniciativas_catalogos.ashx" })
            s += Modulo(r, cuenta) == "pasa" ? "P" : "X";
        int estado;
        Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", null, cuenta, out estado);
        s += estado == 403 ? "X" : "P";
        Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", "export=1", cuenta, out estado);
        s += estado == 403 ? "X" : "P";
        Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", null, cuenta, out estado);
        s += estado == 403 ? "X" : "P";
        return s;
    }

    static string Sesion(string cuenta, string query = null)
    {
        int estado;
        return Correr(new AdminSesion(), "admin_sesion.ashx", query, cuenta, out estado);
    }

    static string Sin(bool solicitante, string marca = "")
    {
        return "{\"autorizado\":false,\"solicitante\":" + (solicitante ? "true" : "false") + ",\"registro\":true" + marca + "}";
    }

    static string Con(string rol, string marca = "")
    {
        return "{\"autorizado\":true,\"rol\":\"" + rol + "\",\"solicitante\":true,\"registro\":true" + marca + "}";
    }

    static bool Denegado(string cuerpo) { return cuerpo.Contains("\"tipo\":\"AccesoDenegado\""); }

    // Lo de Admin que NO es del registro ni de Nueva solicitud, llamado
    // directo: "D" = 403 AccesoDenegado; "R" = 403 RolInsuficiente; "P" = paso
    // la puerta; "X" = otra cosa.
    static string Admin(string cuenta)
    {
        var hs = new KeyValuePair<IHttpHandler, string>[]
        {
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasSolicitudes(), "accion=listar"),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasSolicitudesNuevas(), "accion=listar"),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasSolicitudesNuevasRevision(), "accion=aprobar"),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasGestion(), null),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasRecientes(), null),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasAcuse(), null),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasDiagnostico(), null),
            new KeyValuePair<IHttpHandler, string>(new AdminCorreos(), null),
            new KeyValuePair<IHttpHandler, string>(new AdminCategoriasAlta(), null),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasCatalogos(), "duenos=1"),
            new KeyValuePair<IHttpHandler, string>(new AdminIniciativasVolumetria(), "alcance=total&ruta=/A"),
        };
        var r = "";
        foreach (var h in hs)
        {
            int e;
            var c = Correr(h.Key, "x.ashx", h.Value, cuenta, out e);
            r += e != 403 ? "P" : Denegado(c) ? "D" : c.Contains("RolInsuficiente") ? "R" : "X";
        }
        return r;
    }

    static readonly string[] RutasAdmin =
    {
        "solicitudes", "solicitudes_nuevas", "solicitudes_nuevas_revision", "acuse", "gestion", "recientes", "diagnostico",
    };

    public static int Main()
    {
        const string ADM = @"SORIANA\t_adm", MOD = @"SORIANA\t_mod", PO = @"SORIANA\t_po", SO = @"SORIANA\t_so",
                     COMUN = @"SORIANA\juanperez";
        var roles = new RolesFalsos();
        roles.Filas[ADM.ToUpperInvariant()] = new[] { "ADM" };
        roles.Filas[MOD.ToUpperInvariant()] = new[] { "MOD" };
        AccesoAdmin.FuenteRoles = roles;
        var duenos = new DuenosFalsos()
            .Persona("Ana Po", "t_po@soriana.com")
            .Persona("Beto So", "t_so@soriana.com")
            .Persona("Juan Perez", "juanperez@soriana.com")   // en CatPersona, sin ser dueño
            .Persona("Mod Uno", "t_mod@soriana.com")
            .Persona("Adm Uno", "t_adm@soriana.com")
            .Fila("/A/B", "/A", "Ana Po", "Beto So", true);
        AccesoIniciativas.FuenteDuenos = duenos;
        int estado;
        string cuerpo;

        // ---- C: el interruptor de sql/30 (solo la lectura) ----------------
        {
            var f = new InterruptorFalso();
            var errores = 0;
            Action<Exception> reg = delegate { errores++; };
            f.Valor = true;
            Check("C1 Encendido = 1 abre (clave INICIATIVAS_ABIERTAS)", "True|INICIATIVAS_ABIERTAS", AccesoIniciativas.Leer(f, reg) + "|" + f.UltimaClave);
            f.Valor = false;
            Check("C2 Encendido = 0 cierra", false, AccesoIniciativas.Leer(f, reg));
            f.Valor = null;
            Check("C3 sin fila cierra", false, AccesoIniciativas.Leer(f, reg));
            f.Valor = true; f.Lanza = true;
            Check("C4 error de lectura cierra (aunque la fila diga 1) y se registra", "False|1", AccesoIniciativas.Leer(f, reg) + "|" + errores);
            Check("C5 sin fuente cierra", false, AccesoIniciativas.Leer(null, reg));
        }

        // ---- I: el interruptor ya no decide el acceso ----------------------
        {
            Check("I1 AccesoIniciativas ya no tiene una fuente de interruptor por request", "True|False",
                  (typeof(AccesoIniciativas).GetField("Fuente") == null) + "|" + (typeof(AccesoIniciativas).GetMethod("Abiertas") != null));
            var llamadores = new List<string>();
            foreach (var dir in new[] { "App_Code", "handlers" })
                foreach (var f in Directory.GetFiles(dir))
                {
                    var t = File.ReadAllText(f);
                    if (t.Contains("AccesoIniciativas.Leer(") || t.Contains("new FuenteInterruptoresSql(")) llamadores.Add(Path.GetFileName(f));
                }
            Check("I2 nada del sitio lee el interruptor (ni Leer ni FuenteInterruptoresSql)", "", string.Join(",", llamadores.ToArray()));
        }

        // ---- W: Web.config no cuenta ---------------------------------------
        {
            var t = File.ReadAllText(Path.Combine("App_Code", "AccesoIniciativas.cs"));
            Check("W1 AccesoIniciativas no lee AppSettings ni ConfigurationManager", "False|False",
                  t.Contains("AppSettings") + "|" + t.Contains("ConfigurationManager"));
            Check("W2 Web.config.ejemplo no trae la clave IniciativasAbiertas", false,
                  File.ReadAllText("Web.config.ejemplo").Contains("<add key=\"IniciativasAbiertas\""));
        }

        // ---- G: el registro es de todos ------------------------------------
        foreach (var c in new[] { new[] { "ADM", ADM }, new[] { "MOD", MOD }, new[] { "PO", PO }, new[] { "SO", SO }, new[] { "cuenta comun", COMUN } })
            Check("G1 " + c[0] + ": registro (pagina, registro, Cobertura por el modulo; registro, export y Cobertura directo)", "PPPPPP", Registro(c[1]));
        foreach (var anon in new[] { "", null })
        {
            var n = anon == null ? "sin usuario" : "anonimo";
            Check("G2 " + n + ": el registro tambien (2026-10-29)", "PPPPPP", Registro(anon));
            cuerpo = Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", null, anon, out estado);
            Check("G2 " + n + ": el registro no responde 403", "False|False", (estado == 403) + "|" + Denegado(cuerpo));
        }
        {
            var antesR = roles.Lecturas; var antesD = duenos.Lecturas;
            foreach (var r in new[] { "~/admin/iniciativas.html", "~/handlers/admin_iniciativas_registro.ashx", "~/handlers/admin_iniciativas_catalogos.ashx" })
                Modulo(r, COMUN);
            var sw = new StringWriter();
            var ctx = Contexto("admin_iniciativas_registro.ashx", null, COMUN, sw);
            AccesoIniciativas.ExigirRegistro(ctx);
            HttpContext.Current = null;
            Check("G3 el registro no consulta dbo.UsuariosAdmin ni los dueños", "0|0",
                  (roles.Lecturas - antesR) + "|" + (duenos.Lecturas - antesD));
            roles.Lanza = true; duenos.Lanza = true;
            Check("G4 con dbo.UsuariosAdmin y los dueños fallando, el registro sigue", "PPPPPP", Registro(COMUN));
            roles.Lanza = false; duenos.Lanza = false;
        }
        Check("G5 Cobertura: solo sin ?rutas ni ?duenos es del registro", "True|False|False",
              AccesoIniciativas.EsLecturaRegistro("~/handlers/admin_iniciativas_catalogos.ashx", null, null) + "|" +
              AccesoIniciativas.EsLecturaRegistro("~/handlers/admin_iniciativas_catalogos.ashx", "1", null) + "|" +
              AccesoIniciativas.EsLecturaRegistro("~/handlers/admin_iniciativas_catalogos.ashx", null, "1"));

        // ---- S: Solicitar una iniciativa -----------------------------------
        Check("S1 ADM: pagina + 4 handlers", "PPPPP", Puertas(ADM));
        Check("S1 MOD (sin ser PO/SO): pagina + 4 handlers", "PPPPP", Puertas(MOD));
        Check("S1 PO: pagina + 4 handlers", "PPPPP", Puertas(PO));
        Check("S1 SO: pagina + 4 handlers", "PPPPP", Puertas(SO));
        Check("S2 cuenta comun: la pagina (registro) si, los 4 handlers 403 solo PO/SO", "PDDDD", Puertas(COMUN));
        Check("S2 anonimo: solo la pagina (registro)", "PCCCC", Puertas(""));
        Check("S2 sin usuario: solo la pagina (registro)", "PCCCC", Puertas(null));
        foreach (var h in new[] { "capacidad", "volumetria", "validar", "mis_solicitudes" })
        {
            Check("S3 modulo, cuenta comun: " + h + " 403 JSON solo PO/SO", "403|json|duenos", Modulo("~/handlers/admin_iniciativas_" + h + ".ashx", COMUN));
            Check("S3 modulo, PO: " + h + " pasa", "pasa", Modulo("~/handlers/admin_iniciativas_" + h + ".ashx", PO));
        }
        Check("S3 modulo, cuenta comun: catalogos?rutas=1 (la cascada) 403", "403|json|duenos",
              Modulo("~/handlers/admin_iniciativas_catalogos.ashx", COMUN, "rutas=1"));
        cuerpo = Correr(new AdminIniciativasMisSolicitudes(), "admin_iniciativas_mis_solicitudes.ashx", "accion=listar", COMUN, out estado);
        Check("S4 Mis solicitudes, cuenta comun por URL directa: 403", "403|True", estado + "|" + Denegado(cuerpo));
        Check("S5 el aviso de solo PO/SO",
              "La solicitud de iniciativas está disponible únicamente para Product Owners (PO) y Service Owners (SO) vigentes.",
              AccesoIniciativas.MensajeSoloDuenos);

        // ---- X: Administracion sigue siendo de ADM / MOD -------------------
        foreach (var c in new[] { new[] { "PO", PO }, new[] { "SO", SO }, new[] { "cuenta comun", COMUN } })
        {
            Check("X1 " + c[0] + ": todo Admin 403 AccesoDenegado por URL directa", "DDDDDDDDDDD", Admin(c[1]));
            foreach (var r in RutasAdmin)
                Check("X2 " + c[0] + ": modulo admin_iniciativas_" + r, "403|json|admin", Modulo("~/handlers/admin_iniciativas_" + r + ".ashx", c[1]));
            var sw = new StringWriter();
            var ctx = Contexto("x.ashx", null, c[1], sw);
            Check("X3 " + c[0] + ": sigue VIEWER y PuedeEntrar false", "VIEWER|False", AccesoAdmin.Rol(ctx) + "|" + AccesoAdmin.PuedeEntrar(ctx));
            HttpContext.Current = null;
        }
        Check("X4 ADM: todo Admin pasa la puerta", "PPPPPPPPPPP", Admin(ADM));
        Check("X4 MOD: acuse y diagnostico pasan; la cola, la revision y lo solo-ADM RolInsuficiente", "RRRRRPPRRRR", Admin(MOD));

        // ---- B: el navegador no decide -------------------------------------
        {
            const string trampa = "solicitante=1&IniciativasAbiertas=true&INICIATIVAS_ABIERTAS=1&rol=ADM&autorizado=true&registro=true";
            Check("B1 cuenta comun con query trampa: Nueva solicitud no", "PDDDD", Puertas(COMUN, trampa));
            Check("B2 PO con query trampa: Admin no", "DDDDDDDDDDD", Admin(PO));
            foreach (var r in RutasAdmin)
                Check("B3 PO con query trampa: modulo admin_iniciativas_" + r, "403|json|admin", Modulo("~/handlers/admin_iniciativas_" + r + ".ashx", PO, trampa));
            Check("B4 admin_sesion con query trampa", Sin(false), Sesion(COMUN, trampa));
            Check("B5 anonimo con query trampa: el registro si, Nueva solicitud no", "pasa|CCCC", Modulo("~/admin/iniciativas.html", "", trampa) + "|" + Puertas("", trampa).Substring(1));
        }

        // ---- E: admin_sesion -----------------------------------------------
        Check("E1 ADM", Con("ADM"), Sesion(ADM));
        Check("E1 MOD (sin ser PO/SO): solicitante", Con("MOD"), Sesion(MOD));
        Check("E1 PO", Sin(true), Sesion(PO));
        Check("E1 SO", Sin(true), Sesion(SO));
        Check("E1 cuenta comun: registro, sin solicitar", Sin(false), Sesion(COMUN));
        Check("E1 anonimo: solo el registro", "{\"autorizado\":false,\"solicitante\":false,\"registro\":true}", Sesion(""));

        // ---- U: otros modulos del tablero ----------------------------------
        foreach (var u in new[] { "~/dashboard.html", "~/handlers/kpis.ashx", "~/handlers/experiencia.ashx",
                                   "~/handlers/qa.ashx", "~/handlers/backlog_resumen.ashx", "~/experiencia/experiencia.html" })
        {
            Check("U1 " + u + ": el modulo no la toca (comun)", "pasa", Modulo(u, COMUN));
            Check("U2 " + u + ": el modulo no la toca (anonimo)", "pasa", Modulo(u, ""));
            Check("U3 " + u + ": no es ruta de solicitante ni del registro", "False|False",
                  AccesoIniciativas.EsRutaSolicitante(u) + "|" + AccesoIniciativas.EsLecturaRegistro(u, null, null));
        }

        // ---- P: PO / SO vigente --------------------------------------------
        {
            const string NADA = @"SORIANA\t_nada", EXPO = @"SORIANA\t_expo", HEREDA = @"SORIANA\t_hereda", RAIZ = @"SORIANA\t_raiz",
                         AMBIGUO = @"SORIANA\t_ambiguo", FUERA = @"SORIANA\t_fuera";
            var d = new DuenosFalsos()
                .Persona("Ana Po", "t_po@soriana.com")
                .Persona("Beto So", "t_so@soriana.com")
                .Persona("Ciro Nada", "t_nada@soriana.com")       // en CatPersona, sin ser dueño
                .Persona("Dora ExPo", "t_expo@soriana.com")       // dueña solo en una fila dada de baja
                .Persona("Elia Hereda", "t_hereda@soriana.com")   // PO del C1 que hereda un N2 vigente
                .Persona("Fito Raiz", "t_raiz@soriana.com")       // SO de una fila solo de C1
                .Persona("Gil Uno", "t_ambiguo@soriana.com")
                .Persona("Gil Dos", "t_ambiguo@soriana.com")      // mismo correo: ambiguo
                .Persona("Mod Uno", "t_mod@soriana.com")
                .Persona("Adm Uno", "t_adm@soriana.com")
                .Fila("/V/1", "/V", "ana po", "BETO  SO", true)    // nombres con otra capitalizacion / espacios
                .Fila("/V/2", "/V", "Gil Uno", "Gil Dos", true)
                .Fila("/X/1", "/X", "Dora ExPo", "Dora ExPo", false)
                .Fila(null, "/H", "Elia Hereda", "Otro SO", true) // la fila del C1 (vigentes primero, LeerDuenos)
                .Fila("/H/0", "/H", "Otra PO", "Otro SO", false)
                .Fila("/H/1", "/H", null, "Otro SO", true)        // sin PO propio: hereda el del C1
                .Fila(null, "/R", "Otro PO", "Fito Raiz", true);
            AccesoIniciativas.FuenteDuenos = d;

            Check("P1 PO vigente: pagina + 4 handlers", "PPPPP", Puertas(PO));
            Check("P2 SO vigente: pagina + 4 handlers", "PPPPP", Puertas(SO));
            Check("P3 en CatPersona sin ser PO/SO: 403 solo PO/SO vigentes", "PDDDD", Puertas(NADA));
            Check("P3 ... admin_sesion no solicitante", Sin(false), Sesion(NADA));
            Check("P4 ex PO/SO (solo en fila no vigente): 403", "PDDDD", Puertas(EXPO));
            Check("P5 query trampa no abre (solicitante=1, po=, rol=ADM)", "PDDDD",
                  Puertas(NADA, "solicitante=1&po=Ciro+Nada&so=Ciro+Nada&rol=ADM&INICIATIVAS_ABIERTAS=1"));
            Check("P5 cuenta fuera de CatPersona: 403", "PDDDD", Puertas(FUERA));
            Check("P5 correo en dos personas (ambiguo): 403 aunque las dos sean dueñas", "PDDDD", Puertas(AMBIGUO));
            Check("P6 PO heredado del C1 en un N2 vigente: entra", "PPPPP", Puertas(HEREDA));
            Check("P6 SO de una fila solo de C1 vigente: entra", "PPPPP", Puertas(RAIZ));

            // Pierde la asignacion: el siguiente request ya no entra.
            d.Filas[0].Po = "Otra Persona";
            Check("P7 PO que deja de serlo: siguiente request 403", "PDDDD", Puertas(PO));
            d.Filas[0].Po = "ana po";
            d.Filas[0].Vigente = false;
            Check("P7 fila dada de baja: el PO y el SO ya no entran", "PDDDD|PDDDD", Puertas(PO) + "|" + Puertas(SO));
            d.Filas[0].Vigente = true;
            Check("P7 fila otra vez vigente: entran", "PPPPP|PPPPP", Puertas(PO) + "|" + Puertas(SO));

            // ADM y MOD sin ser dueños: entran sin leer los dueños.
            {
                var antes = d.Lecturas;
                Check("P8 ADM y MOD sin ser PO/SO: entran", "PPPPP|PPPPP", Puertas(ADM) + "|" + Puertas(MOD));
                Check("P8 ... sin leer los dueños", 0, d.Lecturas - antes);
            }

            // Error al leer los dueños: cerrado, marcado; una lectura por request.
            d.Lanza = true;
            Check("P9 error al leer los dueños: el PO no entra", "PDDDD", Puertas(PO));
            Check("P9 ... admin_sesion marcado", Sin(false, ",\"verificacion\":\"incompleta\""), Sesion(PO));
            d.Lanza = false;
            {
                var sw = new StringWriter();
                var ctx = Contexto("admin_iniciativas_capacidad.ashx", null, PO, sw);
                var antes = d.Lecturas;
                var a = AdminAccesoModulo.Revisar(ctx, "~/handlers/admin_iniciativas_capacidad.ashx");
                var b = AccesoIniciativas.ExigirSolicitud(ctx);
                var c = AccesoIniciativas.PuedeSolicitar(ctx);
                Check("P9 modulo + handler en el mismo request: una sola lectura de dueños", "True|True|True|1", a + "|" + b + "|" + c + "|" + (d.Lecturas - antes));
                HttpContext.Current = null;
            }
            {
                var antes = d.Lecturas;
                Puertas("");
                Puertas(null);
                Check("P9 anonimo / sin usuario: 403 y los dueños ni se leen", 0, d.Lecturas - antes);
            }

            // La regla sola (sin HttpContext).
            var errores = 0;
            var idPo = IdentidadWindows.Desde(PO, true);
            Check("P10 EsPoSoVigente sin datos: false", false, AccesoIniciativas.EsPoSoVigente(idPo, null));
            Check("P10 LeerPoSoVigente sin fuente: false", false, AccesoIniciativas.LeerPoSoVigente(null, idPo, null));
            d.Lanza = true;
            Check("P10 LeerPoSoVigente con error: false y se registra", "False|1",
                  AccesoIniciativas.LeerPoSoVigente(d, idPo, delegate { errores++; }) + "|" + errores);
            d.Lanza = false;
            Func<bool> si = delegate { return true; }, no = delegate { return false; };
            Func<bool> nunca = delegate { throw new InvalidOperationException("no se debia leer"); };
            Check("P10 Evaluar ADM: no lee los dueños", "", AccesoIniciativas.Evaluar(RolAdmin.Adm, idPo, nunca) ?? "");
            Check("P10 Evaluar MOD: no lee los dueños", "", AccesoIniciativas.Evaluar(RolAdmin.Mod, idPo, nunca) ?? "");
            Check("P10 Evaluar comun dueño", "", AccesoIniciativas.Evaluar(null, idPo, si) ?? "");
            Check("P10 Evaluar comun no dueño", AccesoIniciativas.MensajeSoloDuenos, AccesoIniciativas.Evaluar(null, idPo, no));
            Check("P10 Evaluar anonimo", AccesoIniciativas.MensajeCerrado, AccesoIniciativas.Evaluar(null, IdentidadWindows.Desde("", false), nunca));

            AccesoIniciativas.FuenteDuenos = duenos;
        }

        // ---- L: pierde ADM/MOD siendo PO/SO; consultas que fallan ----------
        {
            const string ADMPO = @"SORIANA\t_admpo", MODSO = @"SORIANA\t_modso", NADA = @"SORIANA\t_nada";
            var d = new DuenosFalsos()
                .Persona("Ada Jefa", "t_admpo@soriana.com")
                .Persona("Moi Jefe", "t_modso@soriana.com")
                .Persona("Ciro Nada", "t_nada@soriana.com")
                .Fila("/L/1", "/L", "Ada Jefa", "Moi Jefe", true);
            AccesoIniciativas.FuenteDuenos = d;
            roles.Filas[ADMPO.ToUpperInvariant()] = new[] { "ADM" };
            roles.Filas[MODSO.ToUpperInvariant()] = new[] { "MOD" };

            Check("L1 ADM que es PO: Admin abierto (antes de quitarlo)", "PPPPPPPPPPP", Admin(ADMPO));
            Check("L1 ADM que es PO: admin_sesion", Con("ADM"), Sesion(ADMPO));
            Check("L1 MOD que es SO: lo de ADM sigue RolInsuficiente", "RRRRRPPRRRR", Admin(MODSO));

            // Se quitan de dbo.UsuariosAdmin; la "pagina" sigue abierta: los
            // siguientes requests de la misma cuenta.
            roles.Filas.Remove(ADMPO.ToUpperInvariant());
            roles.Filas.Remove(MODSO.ToUpperInvariant());
            foreach (var quien in new[] { ADMPO, MODSO })
            {
                var q = quien == ADMPO ? "ex ADM (PO)" : "ex MOD (SO)";
                Check("L2 " + q + ": todo Admin 403 AccesoDenegado en el siguiente request", "DDDDDDDDDDD", Admin(quien));
                foreach (var r in RutasAdmin)
                    Check("L2 " + q + ": modulo admin_iniciativas_" + r, "403|json|admin", Modulo("~/handlers/admin_iniciativas_" + r + ".ashx", quien));
                Check("L3 " + q + ": sigue con el registro", "PPPPPP", Registro(quien));
                Check("L4 " + q + ": y con Nueva solicitud, como cualquier PO/SO", "PPPPP", Puertas(quien));
                Check("L4 " + q + ": admin_sesion solicitante sin rol", Sin(true), Sesion(quien));
                Check("L4 " + q + ": admin_sesion con query trampa no devuelve el rol", Sin(true), Sesion(quien, "rol=ADM&autorizado=true"));
                // Deja de ser PO/SO tambien: solo el registro.
                var fila = d.Filas[0];
                var po = fila.Po; var so = fila.So;
                fila.Po = "Otra"; fila.So = "Otro";
                Check("L5 " + q + ": sin rol y sin PO/SO: solo el registro", "PPPPPP|PDDDD|DDDDDDDDDDD", Registro(quien) + "|" + Puertas(quien) + "|" + Admin(quien));
                fila.Po = po; fila.So = so;
            }
            roles.Filas[ADMPO.ToUpperInvariant()] = new[] { "ADM" };
            Check("L6 ADM devuelto a UsuariosAdmin: el siguiente request entra", "PPPPPPPPPPP", Admin(ADMPO));

            // Consultas que fallan: nunca dan acceso; admin_sesion lo marca.
            const string MARCA = ",\"verificacion\":\"incompleta\"";
            roles.Lanza = true;
            Check("L7 rol que falla: ADM PO pierde Admin (fallo cerrado)", "DDDDDDDDDDD", Admin(ADMPO));
            Check("L7 rol que falla: Nueva solicitud por ser PO/SO", "PPPPP", Puertas(ADMPO));
            Check("L7 rol que falla: admin_sesion marcado", Sin(true, MARCA), Sesion(ADMPO));
            Check("L7 rol que falla: cuenta sin PO/SO, solo el registro y marcado", "PDDDD|" + Sin(false, MARCA), Puertas(NADA) + "|" + Sesion(NADA));
            Check("L7 anonimo con el rol fallando: no consulta, sin marca", "{\"autorizado\":false,\"solicitante\":false,\"registro\":true}", Sesion(""));
            roles.Lanza = false;

            d.Lanza = true;
            Check("L8 dueños que fallan: PO sin rol no entra y marcado", "PDDDD|" + Sin(false, MARCA), Puertas(MODSO) + "|" + Sesion(MODSO));
            roles.Filas[MODSO.ToUpperInvariant()] = new[] { "MOD" };
            Check("L8 dueños que fallan: MOD confirmado no los lee: Nueva solicitud, sin marca", "PPPPP|" + Con("MOD"), Puertas(MODSO) + "|" + Sesion(MODSO));
            d.Lanza = false;
            roles.Filas.Remove(MODSO.ToUpperInvariant());
            Check("L9 todo bien: sin marca", Sin(true), Sesion(MODSO));
            {
                var sw = new StringWriter();
                var ctx = Contexto("x.ashx", null, MODSO, sw);
                AccesoAdmin.PuedeEntrar(ctx);
                AccesoIniciativas.PuedeSolicitar(ctx);
                Check("L9 la marca vive en el request (sin fallo, false)", false, AccesoAdmin.VerificacionIncompleta(ctx));
                HttpContext.Current = null;
            }
            roles.Filas.Remove(ADMPO.ToUpperInvariant());
            AccesoIniciativas.FuenteDuenos = duenos;
        }

        // ---- F: el fuente --------------------------------------------------
        foreach (var h in new[] { "capacidad", "volumetria", "validar", "mis_solicitudes" })
        {
            var t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_" + h + ".ashx"));
            Check("F1 " + h + " usa ExigirSolicitud y no Exigir a secas", "True|False",
                  t.Contains("AccesoIniciativas.ExigirSolicitud(context)") + "|" + t.Contains("AccesoAdmin.Exigir(context)"));
        }
        {
            var t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_registro.ashx"));
            Check("F1 registro usa ExigirRegistro y no Exigir a secas", "True|False",
                  t.Contains("AccesoIniciativas.ExigirRegistro(context)") + "|" + t.Contains("AccesoAdmin.Exigir(context)"));
            t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_catalogos.ashx"));
            Check("F1 catalogos: ExigirAdm (?duenos=1), ExigirRegistro (Cobertura) y ExigirSolicitud (?rutas=1)", "True|True|True",
                  t.Contains("AccesoAdmin.ExigirAdm(context,") + "|" + t.Contains("AccesoIniciativas.ExigirRegistro(context)") + "|" +
                  t.Contains("AccesoIniciativas.ExigirSolicitud(context)"));
        }
        foreach (var f in Directory.GetFiles("handlers", "admin_*.ashx"))
        {
            var n = Path.GetFileName(f);
            if (n == "admin_iniciativas_catalogos.ashx" || n == "admin_iniciativas_capacidad.ashx" ||
                n == "admin_iniciativas_volumetria.ashx" || n == "admin_iniciativas_validar.ashx" || n == "admin_sesion.ashx" ||
                n == "admin_iniciativas_mis_solicitudes.ashx" || n == "admin_iniciativas_registro.ashx" ||
                n == "admin_iniciativas_solicitudes.ashx") continue;
            Check("F2 " + n + " no abre nada fuera de Admin (no usa AccesoIniciativas)", false, File.ReadAllText(f).Contains("AccesoIniciativas"));
        }
        {
            // Solicitudes de cambio: AccesoIniciativas SOLO para enviar sin rol
            // (PO / SO de la iniciativa, sql/37); lo demas sigue ExigirAdm.
            var t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes.ashx"));
            Check("F2 solicitudes: ExigirSolicitud solo con accion=enviar sin rol; lo demas Exigir + ExigirAdm; rol PSO del servidor",
                  "True|True|True|True|False",
                  t.Contains("if (accion == \"enviar\" && !AccesoAdmin.PuedeEntrar(context))") + "|" +
                  t.Contains("else if (!AccesoAdmin.Exigir(context)) return;") + "|" +
                  t.Contains("&& !AccesoAdmin.ExigirAdm(context, \"Solo un administrador (ADM) revisa") + "|" +
                  t.Contains("rol = SolicitudCambioPso.Rol;") + "|" + t.Contains("Form[\"rol"));
        }
        // El modulo: el envio de "Solicitar cambios" pasa para PO / SO
        // vigentes; cualquier otra accion del handler sigue siendo de Admin.
        {
            const string R = "~/handlers/admin_iniciativas_solicitudes.ashx";
            Check("K1 modulo: PO y SO vigentes pasan con accion=enviar", "pasa|pasa", Modulo(R, PO, "accion=enviar") + "|" + Modulo(R, SO, "accion=enviar"));
            Check("K2 modulo: en CatPersona sin ser dueno, accion=enviar: 403 solo PO/SO", "403|json|duenos", Modulo(R, COMUN, "accion=enviar"));
            Check("K3 modulo: PO en listar / detalle / aplicar / rechazar / sin accion: 403 de Admin",
                  "403|json|admin,403|json|admin,403|json|admin,403|json|admin,403|json|admin",
                  string.Join(",", Array.ConvertAll(new string[] { "accion=listar", "accion=detalle&id=1", "accion=aplicar", "accion=rechazar", null }, q => Modulo(R, PO, q))));
            Check("K4 modulo: anonimo con accion=enviar: 403", true, Modulo(R, "", "accion=enviar").StartsWith("403|json"));
            Check("K5 modulo: ADM y MOD siguen pasando en todo", "pasa|pasa|pasa", Modulo(R, ADM, "accion=listar") + "|" + Modulo(R, MOD, "accion=enviar") + "|" + Modulo(R, ADM, "accion=aplicar"));
            Check("K6 la ruta del envio es exacta (otra ruta con accion=enviar no se abre)", "False|False",
                  AccesoIniciativas.EsEnvioCambio("~/handlers/admin_iniciativas_gestion.ashx", "enviar") + "|" +
                  AccesoIniciativas.EsEnvioCambio(R, "Enviar"));
        }
        Check("F3 son exactamente 6 rutas de solicitante (pagina + 4 de Nueva solicitud + Mis solicitudes)", 6, AccesoIniciativas.RutasSolicitante.Length);
        {
            var t = File.ReadAllText(Path.Combine("App_Code", "AccesoIniciativas.cs"));
            Check("F4 los dueños salen de CatCategoriaDueno vigente (PoSoVigentes) y la persona de IdentidadAcuse", "True|True",
                  t.Contains("Directorio.PoSoVigentes()") + "|" + t.Contains("IdentidadAcuse.Resolver(id, d.Personas)"));
            var html = File.ReadAllText(Path.Combine("admin", "iniciativas.html"));
            Check("F5 el boton Solicitar va con data-solo-solicitud (no data-solo-admin)", "True|False",
                  html.Contains("id=\"btnSolicitar\" data-solo-solicitud hidden") + "|" + html.Contains("id=\"btnSolicitar\" data-solo-admin"));
            Check("F6 Nueva solicitud muestra el aviso Importante", true,
                  html.Contains("<b>Importante:</b> La solicitud de iniciativas está disponible únicamente para Product Owners (PO) y Service Owners (SO) vigentes."));
        }

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
