// Prueba offline de quien puede pedir una iniciativa
// (App_Code/AccesoIniciativas.cs: interruptor INICIATIVAS_ABIERTAS de
// adm.Interruptor + Product Owner / Service Owner VIGENTE) A TRAVES DE LOS
// HANDLERS reales y de AdminAccesoModulo.Revisar (la pagina estatica), con
// un HttpContext armado a mano: sin IIS y sin SQL Server. El rol
// (dbo.UsuariosAdmin), el interruptor (AccesoIniciativas.Fuente) y los
// dueños (dbo.CatPersona + dbo.CatCategoriaDueno,
// AccesoIniciativas.FuenteDuenos) salen de fuentes falsas. En la matriz la
// cuenta comun es PO vigente y MOD es SO vigente; la parte P cambia eso.
//
// Matriz (interruptor true / false / sin fila / error de lectura x VIEWER /
// ADM / MOD / anonimo; solo "true" es ON, los otros tres son OFF):
//   C   el valor: solo Encendido = 1 abre; 0, sin fila, error o sin fuente
//       cierran; el error se registra.
//   W   Web.config ya no cuenta: el fuente no lee appSettings.
//   T   apagar en la base vale en el SIGUIENTE request (sin reiniciar); una
//       sola lectura por request; anonimo no la provoca.
//   B   el navegador no decide: una query trampa (?solicitante=1,
//       INICIATIVAS_ABIERTAS=1, rol=ADM...) no abre nada.
//   V   cuenta comun (sin fila): ON entra a la pagina y a los 4 handlers de
//       Nueva solicitud (400/405/no-403: paso la puerta, no llego a SQL);
//       OFF 403 AccesoDenegado con el mensaje de "no esta abierta".
//   A/M ADM y MOD: igual en ON y en OFF; el interruptor ni se lee.
//   N   anonimo: 403 en ON y en OFF.
//   X   lo de Admin que NO es Nueva solicitud (registro, solicitudes,
//       acuse, gestion, recientes, diagnostico, correos, alta de
//       categoria, ?duenos=1, volumetria total, la pagina para un anonimo)
//       sigue 403 para la cuenta comun en ON y en OFF; el modulo tambien.
//   R   la cuenta comun sigue siendo VIEWER (no gana rol).
//   U   rutas de otros modulos del tablero: el modulo no las toca.
//   S   admin_sesion: "solicitante" segun la matriz; "autorizado" no cambia.
//   F   el fuente: los 4 handlers usan ExigirSolicitud; ningun otro handler
//       admin_* menciona AccesoIniciativas.
//   P   PO / SO vigente (2026-10-26): PO vigente y SO vigente entran; quien
//       esta en CatPersona sin ser dueño, el PO/SO de una fila dada de baja
//       y quien pierde la asignacion (siguiente request) no; ni por la
//       pagina, ni por el modulo, ni llamando a los handlers, ni con query
//       trampa. Interruptor apagado: tampoco el PO. ADM entra sin ser dueño
//       (y sin leer nada); MOD solo si es PO/SO (sin mirar el interruptor).
//       Dueño heredado del C1 y fila solo de C1 cuentan; cuenta ambigua o
//       sin persona no; error al leer: cerrado y registrado; una lectura
//       por request.
//   L   (2026-10-26) PIERDE ADM/MOD SIENDO PO/SO: un ADM que es PO vigente y
//       un MOD que es SO vigente salen de dbo.UsuariosAdmin con la "pagina
//       abierta" (requests seguidos de la misma cuenta, sin reiniciar): en
//       el siguiente request Admin entero es 403 (registro, solicitudes,
//       gestion, correos, alta, ?duenos=1, volumetria total, recientes,
//       acuse, diagnostico) y admin_sesion autorizado false; Nueva solicitud
//       solo con el interruptor encendido (como cualquier PO/SO); el
//       PO/SO nunca devuelve el rol. Y los fallos de consulta: el rol, el
//       interruptor o los dueños que fallan nunca dan acceso y admin_sesion
//       lo dice con "verificacion": "incompleta" (y SOLO entonces).
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
    public int Lecturas;
    public string UltimaClave;
    public bool? Encendido(string clave)
    {
        Lecturas++;
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
    public IList<string> AccesosDe(string cuenta)
    {
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

    // AdminAccesoModulo sobre una ruta: "pasa" o "403|html|AccesoDenegado".
    static string Modulo(string ruta, string cuenta)
    {
        var sw = new StringWriter();
        var ctx = Contexto("x", null, cuenta, sw);
        var sigue = AdminAccesoModulo.Revisar(ctx, ruta);
        HttpContext.Current = null;
        if (sigue) return "pasa";
        var cuerpo = sw.ToString();
        return ctx.Response.StatusCode + "|" + (cuerpo.StartsWith("<!doctype") ? "html" : "json") + "|" +
               (cuerpo.Contains("no est\u00e1 abierta") ? "cerrada" : EsDuenos(cuerpo) ? "duenos" : "admin");
    }

    static bool EsDuenos(string cuerpo) { return cuerpo.Contains("Service Owners (SO) vigentes"); }

    // La pagina (por el modulo) y los 4 handlers de Nueva solicitud llamados
    // directo, en ese orden: P = paso la puerta (400/405/500 sin SQL),
    // D = 403 "solo PO/SO vigentes", C = 403 "no esta abierta", X = otro 403.
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
            s += estado != 403 ? "P" : EsDuenos(cuerpo) ? "D" : cuerpo.Contains("no est\u00e1 abierta") ? "C" : "X";
        }
        return s;
    }

    static string Sesion(string cuenta)
    {
        int estado;
        return Correr(new AdminSesion(), "admin_sesion.ashx", null, cuenta, out estado);
    }

    static bool Denegado(string cuerpo) { return cuerpo.Contains("\"tipo\":\"AccesoDenegado\""); }

    public static int Main()
    {
        const string ADM = @"SORIANA\t_adm", MOD = @"SORIANA\t_mod", COMUN = @"SORIANA\juanperez";
        var roles = new RolesFalsos();
        roles.Filas[ADM.ToUpperInvariant()] = new[] { "ADM" };
        roles.Filas[MOD.ToUpperInvariant()] = new[] { "MOD" };
        AccesoAdmin.FuenteRoles = roles;
        var interruptor = new InterruptorFalso();
        AccesoIniciativas.Fuente = interruptor;
        // La matriz: la cuenta comun es PO vigente y MOD es SO vigente; ADM
        // no es dueño de nada (no le hace falta).
        var duenos = new DuenosFalsos()
            .Persona("Juan Perez", "juanperez@soriana.com")
            .Persona("Mod Uno", "t_mod@soriana.com")
            .Persona("Adm Uno", "t_adm@soriana.com")
            .Fila("/A/B", "/A", "Juan Perez", "Mod Uno", true);
        AccesoIniciativas.FuenteDuenos = duenos;
        int estado;
        string cuerpo;

        // ---- C: el valor ------------------------------------------------
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

        // ---- W: Web.config ya no cuenta ----------------------------------
        {
            var t = File.ReadAllText(Path.Combine("App_Code", "AccesoIniciativas.cs"));
            Check("W1 AccesoIniciativas no lee AppSettings ni ConfigurationManager", "False|False",
                  t.Contains("AppSettings") + "|" + t.Contains("ConfigurationManager"));
            Check("W2 Web.config.ejemplo ya no trae la clave IniciativasAbiertas", false,
                  File.ReadAllText("Web.config.ejemplo").Contains("<add key=\"IniciativasAbiertas\""));
        }

        foreach (var modo in new[] { "true", "false", "sin fila", "error" })
        {
            var on = modo == "true";
            interruptor.Lanza = modo == "error";
            interruptor.Valor = modo == "false" ? (bool?)false : modo == "sin fila" ? (bool?)null : true;
            var E = "[" + modo + "] ";

            // ---- V: cuenta comun ------------------------------------------
            Check(E + "V1 pagina admin/iniciativas.html", on ? "pasa" : "403|html|cerrada", Modulo("~/admin/iniciativas.html", COMUN));
            foreach (var h in new[] { "catalogos", "capacidad", "volumetria", "validar" })
                Check(E + "V2 modulo: handler " + h, on ? "pasa" : "403|json|cerrada",
                      Modulo("~/handlers/admin_iniciativas_" + h + ".ashx", COMUN));

            cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, COMUN, out estado);
            Check(E + "V3 capacidad sin categoria", on ? "400|False" : "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, COMUN, out estado);
            Check(E + "V4 validar con GET", on ? "405|False" : "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasVolumetria(), "admin_iniciativas_volumetria.ashx", null, COMUN, out estado);
            Check(E + "V5 volumetria sin ruta", on ? "400|False" : "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "rutas=1", COMUN, out estado);
            Check(E + "V6 catalogos ?rutas=1 (ON: paso la puerta, sin SQL)", on ? "False" : "True", estado == 403);
            if (!on) Check("OFF V7 el 403 dice que no esta abierta", true, cuerpo.Contains("no est\u00e1 abierta") && Denegado(cuerpo));

            // ---- R: no gana rol -------------------------------------------
            {
                var sw = new StringWriter();
                var ctx = Contexto("x.ashx", null, COMUN, sw);
                Check(E + "R1 sigue VIEWER y PuedeEntrar false", "VIEWER|False", AccesoAdmin.Rol(ctx) + "|" + AccesoAdmin.PuedeEntrar(ctx));
                Check(E + "R2 EsSoloSolicitante", on, AccesoIniciativas.EsSoloSolicitante(ctx));
                HttpContext.Current = null;
            }

            // ---- X: el resto de Admin sigue cerrado para la cuenta comun ----
            foreach (var r in new[] { "registro", "solicitudes", "acuse", "gestion", "recientes", "diagnostico" })
                Check(E + "X1 modulo: admin_iniciativas_" + r, "403|json|admin", Modulo("~/handlers/admin_iniciativas_" + r + ".ashx", COMUN));
            var otros = new Dictionary<string, IHttpHandler>
            {
                { "admin_iniciativas_registro.ashx", new AdminIniciativasRegistro() },
                { "admin_iniciativas_solicitudes.ashx", new AdminIniciativasSolicitudes() },
                { "admin_iniciativas_acuse.ashx", new AdminIniciativasAcuse() },
                { "admin_iniciativas_gestion.ashx", new AdminIniciativasGestion() },
                { "admin_iniciativas_recientes.ashx", new AdminIniciativasRecientes() },
                { "admin_iniciativas_diagnostico.ashx", new AdminIniciativasDiagnostico() },
                { "admin_correos.ashx", new AdminCorreos() },
                { "admin_categorias_alta.ashx", new AdminCategoriasAlta() },
            };
            foreach (var kv in otros)
            {
                cuerpo = Correr(kv.Value, kv.Key, null, COMUN, out estado);
                Check(E + "X2 " + kv.Key + ": 403 AccesoDenegado", "403|True", estado + "|" + Denegado(cuerpo));
            }
            cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "duenos=1", COMUN, out estado);
            Check(E + "X3 catalogos ?duenos=1 (solo ADM)", "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasVolumetria(), "admin_iniciativas_volumetria.ashx", "alcance=total&ruta=/A", COMUN, out estado);
            Check(E + "X4 volumetria alcance=total (solo ADM)", "403|True", estado + "|" + Denegado(cuerpo));

            // ---- N: anonimo y sin usuario ----------------------------------
            foreach (var anon in new[] { "", null })
            {
                var n = anon == null ? "sin usuario" : "anonimo";
                Check(E + "N1 " + n + ": pagina", "403|html|cerrada", Modulo("~/admin/iniciativas.html", anon));
                cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, anon, out estado);
                Check(E + "N2 " + n + ": capacidad 403", "403|True", estado + "|" + Denegado(cuerpo));
                cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, anon, out estado);
                Check(E + "N3 " + n + ": validar 403", "403|True", estado + "|" + Denegado(cuerpo));
            }

            // ---- A/M: ADM y MOD, igual que siempre ------------------------
            foreach (var quien in new[] { ADM, MOD })
            {
                var q = quien == ADM ? "ADM" : "MOD";
                var antes = interruptor.Lecturas;
                Check(E + "A1 " + q + ": pagina", "pasa", Modulo("~/admin/iniciativas.html", quien));
                cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, quien, out estado);
                Check(E + "A2 " + q + ": capacidad sin categoria 400", 400, estado);
                cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, quien, out estado);
                Check(E + "A3 " + q + ": validar GET 405", 405, estado);
                Check(E + "A4 " + q + ": registro por el modulo", "pasa", Modulo("~/handlers/admin_iniciativas_registro.ashx", quien));
                Check(E + "A5 " + q + ": el interruptor ni se lee", antes, interruptor.Lecturas);
                cuerpo = Correr(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", null, quien, out estado);
                Check(E + "A6 " + q + ": gestion (solo ADM)", quien == ADM ? "False" : "True",
                      estado == 403 && cuerpo.Contains("RolInsuficiente"));
                cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, quien, out estado);
                Check(E + "S1 " + q + ": admin_sesion", "{\"autorizado\":true,\"rol\":\"" + q + "\",\"solicitante\":true}", cuerpo);
            }

            // ---- S: admin_sesion para la cuenta comun y el anonimo ---------
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, COMUN, out estado);
            // Interruptor que falla: igual de cerrado, pero no confirmado.
            var marca = modo == "error" ? ",\"verificacion\":\"incompleta\"" : "";
            Check(E + "S2 cuenta comun: admin_sesion", "{\"autorizado\":false,\"solicitante\":" + (on ? "true" : "false") + marca + "}", cuerpo);
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, "", out estado);
            Check(E + "S3 anonimo: admin_sesion", "{\"autorizado\":false,\"solicitante\":false}", cuerpo);

            // ---- B: el navegador no decide ---------------------------------
            {
                const string trampa = "solicitante=1&IniciativasAbiertas=true&INICIATIVAS_ABIERTAS=1&rol=ADM&autorizado=true";
                cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", trampa, COMUN, out estado);
                Check(E + "B1 capacidad con query trampa", on ? "400|False" : "403|True", estado + "|" + Denegado(cuerpo));
                cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", trampa, COMUN, out estado);
                Check(E + "B2 validar con query trampa", on ? "405|False" : "403|True", estado + "|" + Denegado(cuerpo));
                cuerpo = Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", trampa, COMUN, out estado);
                Check(E + "B3 registro con query trampa: 403 siempre", "403|True", estado + "|" + Denegado(cuerpo));
                cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", trampa, COMUN, out estado);
                Check(E + "B4 admin_sesion con query trampa", "{\"autorizado\":false,\"solicitante\":" + (on ? "true" : "false") + marca + "}", cuerpo);
            }

            // ---- U: otros modulos del tablero -----------------------------
            foreach (var u in new[] { "~/dashboard.html", "~/handlers/kpis.ashx", "~/handlers/experiencia.ashx",
                                       "~/handlers/qa.ashx", "~/handlers/backlog_resumen.ashx", "~/experiencia/experiencia.html" })
            {
                Check(E + "U1 " + u + ": el modulo no la toca (comun)", "pasa", Modulo(u, COMUN));
                Check(E + "U2 " + u + ": el modulo no la toca (anonimo)", "pasa", Modulo(u, ""));
                Check(E + "U3 " + u + ": no es ruta de solicitante", false, AccesoIniciativas.EsRutaSolicitante(u));
            }
        }

        // ---- T: apagar sin reiniciar; una lectura por request ------------
        interruptor.Lanza = false;
        interruptor.Valor = true;
        Check("T1 encendido: pagina para la cuenta comun", "pasa", Modulo("~/admin/iniciativas.html", COMUN));
        interruptor.Valor = false;
        Check("T2 apagado en la base: el siguiente request ya es 403", "403|html|cerrada", Modulo("~/admin/iniciativas.html", COMUN));
        cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, COMUN, out estado);
        Check("T3 ... y el handler tambien", "403|True", estado + "|" + Denegado(cuerpo));
        interruptor.Valor = true;
        Check("T4 encendido otra vez: pasa", "pasa", Modulo("~/admin/iniciativas.html", COMUN));
        {
            var sw = new StringWriter();
            var ctx = Contexto("admin_iniciativas_capacidad.ashx", null, COMUN, sw);
            var antes = interruptor.Lecturas;
            var a = AdminAccesoModulo.Revisar(ctx, "~/handlers/admin_iniciativas_capacidad.ashx");
            var b = AccesoIniciativas.ExigirSolicitud(ctx);
            var c = AccesoIniciativas.PuedeSolicitar(ctx);
            Check("T5 modulo + handler en el mismo request: una sola lectura", "True|True|True|1", a + "|" + b + "|" + c + "|" + (interruptor.Lecturas - antes));
            interruptor.Valor = false;
            Check("T6 dentro del MISMO request no cambia a media respuesta", true, AccesoIniciativas.PuedeSolicitar(ctx));
            HttpContext.Current = null;
        }
        {
            var antes = interruptor.Lecturas;
            Modulo("~/admin/iniciativas.html", "");
            Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, null, out estado);
            Check("T7 anonimo / sin usuario: ni se lee", 0, interruptor.Lecturas - antes);
        }

        // ---- P: PO / SO vigente ------------------------------------------
        {
            const string PO = @"SORIANA\t_po", SO = @"SORIANA\t_so", NADA = @"SORIANA\t_nada",
                         EXPO = @"SORIANA\t_expo", HEREDA = @"SORIANA\t_hereda", RAIZ = @"SORIANA\t_raiz",
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
            // /H/1 hereda su PO de la PRIMERA fila de su C1 (la vigente).
            AccesoIniciativas.FuenteDuenos = d;
            interruptor.Lanza = false;
            interruptor.Valor = true;

            Check("P1 PO vigente: pagina + 4 handlers", "PPPPP", Puertas(PO));
            Check("P1 PO vigente: admin_sesion solicitante", "{\"autorizado\":false,\"solicitante\":true}", Sesion(PO));
            Check("P2 SO vigente: pagina + 4 handlers", "PPPPP", Puertas(SO));
            Check("P3 en CatPersona sin ser PO/SO: 403 solo PO/SO vigentes", "DDDDD", Puertas(NADA));
            Check("P3 ... admin_sesion no solicitante", "{\"autorizado\":false,\"solicitante\":false}", Sesion(NADA));
            Check("P3 ... el 403 de la pagina es HTML con el aviso", "403|html|duenos", Modulo("~/admin/iniciativas.html", NADA));
            Check("P3 ... el 403 del modulo para un handler es JSON", "403|json|duenos", Modulo("~/handlers/admin_iniciativas_validar.ashx", NADA));
            Check("P4 ex PO/SO (solo en fila no vigente): 403", "DDDDD", Puertas(EXPO));
            Check("P4 ex PO/SO: admin_sesion no solicitante", "{\"autorizado\":false,\"solicitante\":false}", Sesion(EXPO));
            Check("P5 query trampa no abre (solicitante=1, po=, rol=ADM)", "DDDDD",
                  Puertas(NADA, "solicitante=1&po=Ciro+Nada&so=Ciro+Nada&rol=ADM&INICIATIVAS_ABIERTAS=1"));
            Check("P5 cuenta fuera de CatPersona: 403", "DDDDD", Puertas(FUERA));
            Check("P5 correo en dos personas (ambiguo): 403 aunque las dos sean dueñas", "DDDDD", Puertas(AMBIGUO));
            Check("P8 PO heredado del C1 en un N2 vigente: entra", "PPPPP", Puertas(HEREDA));
            Check("P8 SO de una fila solo de C1 vigente: entra", "PPPPP", Puertas(RAIZ));

            // Pierde la asignacion: el siguiente request ya no entra.
            d.Filas[0].Po = "Otra Persona";
            Check("P4 PO que deja de serlo: siguiente request 403", "DDDDD", Puertas(PO));
            d.Filas[0].Po = "ana po";
            d.Filas[0].Vigente = false;
            Check("P4 fila dada de baja: el PO y el SO ya no entran", "DDDDD|DDDDD", Puertas(PO) + "|" + Puertas(SO));
            d.Filas[0].Vigente = true;
            Check("P4 fila otra vez vigente: entran", "PPPPP|PPPPP", Puertas(PO) + "|" + Puertas(SO));

            // Interruptor apagado: tampoco el PO; los dueños ni se leen.
            foreach (var modo in new[] { "false", "sin fila", "error" })
            {
                interruptor.Lanza = modo == "error";
                interruptor.Valor = modo == "false" ? (bool?)false : null;
                var antes = d.Lecturas;
                Check("P6 [" + modo + "] interruptor apagado: PO y SO 403 no esta abierta", "CCCCC|CCCCC", Puertas(PO) + "|" + Puertas(SO));
                Check("P6 [" + modo + "] ... admin_sesion no solicitante", "{\"autorizado\":false,\"solicitante\":false" +
                      (modo == "error" ? ",\"verificacion\":\"incompleta\"" : "") + "}", Sesion(PO));
                Check("P6 [" + modo + "] ... sin leer los dueños", 0, d.Lecturas - antes);
                // ADM sigue; MOD PO/SO sigue (no mira el interruptor).
                Check("P6 [" + modo + "] ADM sigue", "PPPPP", Puertas(ADM));
            }
            interruptor.Lanza = false;
            interruptor.Valor = true;

            // ADM sin ser dueño: entra, sin leer interruptor ni dueños.
            {
                var antesI = interruptor.Lecturas; var antesD = d.Lecturas;
                Check("P7 ADM sin ser PO/SO: pagina + 4 handlers", "PPPPP", Puertas(ADM));
                Check("P7 ADM: admin_sesion solicitante", "{\"autorizado\":true,\"rol\":\"ADM\",\"solicitante\":true}", Sesion(ADM));
                Check("P7 ADM: ni interruptor ni dueños se leen", "0|0", (interruptor.Lecturas - antesI) + "|" + (d.Lecturas - antesD));
            }
            // MOD: sin ser dueño, no; dueño, si; el interruptor ni se lee.
            {
                var antesI = interruptor.Lecturas;
                Check("P7 MOD sin ser PO/SO: la pagina pasa (es MOD) y los 4 handlers 403", "PDDDD", Puertas(MOD));
                Check("P7 MOD sin ser PO/SO: admin_sesion no solicitante", "{\"autorizado\":true,\"rol\":\"MOD\",\"solicitante\":false}", Sesion(MOD));
                Check("P7 MOD sin ser PO/SO: el interruptor ni se lee", 0, interruptor.Lecturas - antesI);
                cuerpo = Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", null, MOD, out estado);
                Check("P7 MOD sin ser PO/SO: el resto de Admin no cambia (registro sin 403)", false, estado == 403);
                cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", null, MOD, out estado);
                Check("P7 MOD sin ser PO/SO: catalogos sin ?rutas (Cobertura) sin 403", false, estado == 403);
                cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", null, NADA, out estado);
                Check("P7 cuenta comun sin ser PO/SO: catalogos sin ?rutas 403", "403|True", estado + "|" + EsDuenos(cuerpo));
                d.Fila("/M/1", "/M", "Otro PO", "mod uno", true);
                interruptor.Valor = false;
                antesI = interruptor.Lecturas;   // la cuenta comun de arriba si lo leyo
                Check("P7 MOD SO vigente con el interruptor apagado: entra", "PPPPP", Puertas(MOD));
                Check("P7 MOD SO vigente: admin_sesion solicitante", "{\"autorizado\":true,\"rol\":\"MOD\",\"solicitante\":true}", Sesion(MOD));
                Check("P7 MOD: el interruptor ni se lee", 0, interruptor.Lecturas - antesI);
                d.Filas.RemoveAt(d.Filas.Count - 1);
                interruptor.Valor = true;
            }

            // Error al leer los dueños: cerrado; una lectura por request.
            d.Lanza = true;
            Check("P9 error al leer los dueños: el PO no entra", "DDDDD", Puertas(PO));
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
            Check("P10 Evaluar ADM: no lee nada", "", AccesoIniciativas.Evaluar(RolAdmin.Adm, idPo, nunca, nunca) ?? "");
            Check("P10 Evaluar MOD dueño: no lee el interruptor", "", AccesoIniciativas.Evaluar(RolAdmin.Mod, idPo, nunca, si) ?? "");
            Check("P10 Evaluar MOD no dueño", AccesoIniciativas.MensajeSoloDuenos, AccesoIniciativas.Evaluar(RolAdmin.Mod, idPo, nunca, no));
            Check("P10 Evaluar comun apagado: no lee dueños", AccesoIniciativas.MensajeCerrado, AccesoIniciativas.Evaluar(null, idPo, no, nunca));
            Check("P10 Evaluar comun encendido y dueño", "", AccesoIniciativas.Evaluar(null, idPo, si, si) ?? "");
            Check("P10 Evaluar comun encendido no dueño", AccesoIniciativas.MensajeSoloDuenos, AccesoIniciativas.Evaluar(null, idPo, si, no));
            Check("P10 Evaluar anonimo", AccesoIniciativas.MensajeCerrado, AccesoIniciativas.Evaluar(null, IdentidadWindows.Desde("", false), nunca, nunca));
            Check("P10 el aviso", "La solicitud de iniciativas est\u00e1 disponible \u00fanicamente para Product Owners (PO) y Service Owners (SO) vigentes.",
                  AccesoIniciativas.MensajeSoloDuenos);

            AccesoIniciativas.FuenteDuenos = duenos;
        }

        // ---- L: pierde ADM/MOD siendo PO/SO; consultas que fallan --------
        {
            const string ADMPO = @"SORIANA\t_admpo", MODSO = @"SORIANA\t_modso";
            var d = new DuenosFalsos()
                .Persona("Ada Jefa", "t_admpo@soriana.com")
                .Persona("Moi Jefe", "t_modso@soriana.com")
                .Persona("Ciro Nada", "t_nada@soriana.com")
                .Fila("/L/1", "/L", "Ada Jefa", "Moi Jefe", true);
            AccesoIniciativas.FuenteDuenos = d;
            interruptor.Lanza = false;
            interruptor.Valor = true;
            roles.Filas[ADMPO.ToUpperInvariant()] = new[] { "ADM" };
            roles.Filas[MODSO.ToUpperInvariant()] = new[] { "MOD" };

            // Lo de Admin que NO es Nueva solicitud, llamado directo.
            var soloAdmin = new KeyValuePair<IHttpHandler, string>[]
            {
                new KeyValuePair<IHttpHandler, string>(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx"),
                new KeyValuePair<IHttpHandler, string>(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx"),
                new KeyValuePair<IHttpHandler, string>(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx"),
                new KeyValuePair<IHttpHandler, string>(new AdminIniciativasRecientes(), "admin_iniciativas_recientes.ashx"),
                new KeyValuePair<IHttpHandler, string>(new AdminIniciativasAcuse(), "admin_iniciativas_acuse.ashx"),
                new KeyValuePair<IHttpHandler, string>(new AdminIniciativasDiagnostico(), "admin_iniciativas_diagnostico.ashx"),
                new KeyValuePair<IHttpHandler, string>(new AdminCorreos(), "admin_correos.ashx"),
                new KeyValuePair<IHttpHandler, string>(new AdminCategoriasAlta(), "admin_categorias_alta.ashx"),
            };
            // "D" = 403 AccesoDenegado; "R" = 403 RolInsuficiente; "P" = paso la puerta.
            Func<string, string> admin = delegate (string cuenta)
            {
                var r = "";
                foreach (var h in soloAdmin)
                {
                    int e;
                    var c = Correr(h.Key, h.Value, null, cuenta, out e);
                    r += e != 403 ? "P" : Denegado(c) ? "D" : c.Contains("RolInsuficiente") ? "R" : "X";
                }
                int e2;
                var c2 = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "duenos=1", cuenta, out e2);
                r += e2 != 403 ? "P" : Denegado(c2) ? "D" : c2.Contains("RolInsuficiente") ? "R" : "X";
                c2 = Correr(new AdminIniciativasVolumetria(), "admin_iniciativas_volumetria.ashx", "alcance=total&ruta=/A", cuenta, out e2);
                r += e2 != 403 ? "P" : Denegado(c2) ? "D" : c2.Contains("RolInsuficiente") ? "R" : "X";
                return r;
            };

            // Antes: ADM entra a todo; MOD a lo suyo (lo de ADM, RolInsuficiente).
            Check("L1 ADM que es PO: Admin abierto (antes de quitarlo)", "PPPPPPPPPP", admin(ADMPO));
            Check("L1 ADM que es PO: Nueva solicitud", "PPPPP", Puertas(ADMPO));
            Check("L1 ADM que es PO: admin_sesion", "{\"autorizado\":true,\"rol\":\"ADM\",\"solicitante\":true}", Sesion(ADMPO));
            Check("L1 MOD que es SO: lo de ADM sigue RolInsuficiente", "PRRRPPRRRR", admin(MODSO));
            Check("L1 MOD que es SO: admin_sesion", "{\"autorizado\":true,\"rol\":\"MOD\",\"solicitante\":true}", Sesion(MODSO));

            // Se quitan de dbo.UsuariosAdmin; la "pagina" sigue abierta: los
            // siguientes requests de la misma cuenta.
            roles.Filas.Remove(ADMPO.ToUpperInvariant());
            roles.Filas.Remove(MODSO.ToUpperInvariant());
            foreach (var quien in new[] { ADMPO, MODSO })
            {
                var q = quien == ADMPO ? "ex ADM (PO)" : "ex MOD (SO)";
                Check("L2 " + q + ": todo Admin 403 AccesoDenegado en el siguiente request", "DDDDDDDDDD", admin(quien));
                foreach (var r in new[] { "registro", "solicitudes", "gestion", "recientes", "acuse", "diagnostico" })
                    Check("L2 " + q + ": modulo admin_iniciativas_" + r, "403|json|admin", Modulo("~/handlers/admin_iniciativas_" + r + ".ashx", quien));
                {
                    var sw = new StringWriter();
                    var ctx = Contexto("x.ashx", null, quien, sw);
                    Check("L3 " + q + ": VIEWER, PuedeEntrar false, solo solicitante", "VIEWER|False|True",
                          AccesoAdmin.Rol(ctx) + "|" + AccesoAdmin.PuedeEntrar(ctx) + "|" + AccesoIniciativas.EsSoloSolicitante(ctx));
                    HttpContext.Current = null;
                }
                Check("L4 " + q + ": con el interruptor, Nueva solicitud como cualquier PO/SO", "PPPPP", Puertas(quien));
                Check("L4 " + q + ": admin_sesion solo solicitante (sin rol)", "{\"autorizado\":false,\"solicitante\":true}", Sesion(quien));
                Check("L4 " + q + ": query trampa no devuelve el rol", "DDDDDDDDDD", admin(quien));
                {
                    int e;
                    var c = Correr(new AdminSesion(), "admin_sesion.ashx", "rol=ADM&autorizado=true", quien, out e);
                    Check("L4 " + q + ": admin_sesion con query trampa", "{\"autorizado\":false,\"solicitante\":true}", c);
                }
                interruptor.Valor = false;
                Check("L5 " + q + ": interruptor apagado: tampoco Nueva solicitud", "CCCCC", Puertas(quien));
                Check("L5 " + q + ": admin_sesion nada", "{\"autorizado\":false,\"solicitante\":false}", Sesion(quien));
                interruptor.Valor = true;
                // Deja de ser PO/SO tambien: nada.
                var fila = d.Filas[0];
                var po = fila.Po; var so = fila.So;
                fila.Po = "Otra"; fila.So = "Otro";
                Check("L6 " + q + ": sin rol y sin PO/SO: nada", "DDDDD|DDDDDDDDDD", Puertas(quien) + "|" + admin(quien));
                fila.Po = po; fila.So = so;
            }
            // Vuelven a la tabla: el siguiente request ya los deja (sin cache).
            roles.Filas[ADMPO.ToUpperInvariant()] = new[] { "ADM" };
            Check("L7 ADM devuelto a UsuariosAdmin: el siguiente request entra", "PPPPPPPPPP", admin(ADMPO));

            // Consultas que fallan: nunca dan acceso; admin_sesion lo marca.
            const string MARCA = ",\"verificacion\":\"incompleta\"";
            roles.Lanza = true;
            Check("L8 rol que falla: ADM PO pierde Admin (fallo cerrado)", "DDDDDDDDDD", admin(ADMPO));
            Check("L8 rol que falla: Nueva solicitud solo por PO/SO + interruptor", "PPPPP", Puertas(ADMPO));
            Check("L8 rol que falla: admin_sesion marcado", "{\"autorizado\":false,\"solicitante\":true" + MARCA + "}", Sesion(ADMPO));
            Check("L8 rol que falla: cuenta sin PO/SO, nada y marcado", "DDDDD|{\"autorizado\":false,\"solicitante\":false" + MARCA + "}",
                  Puertas(@"SORIANA\t_nada") + "|" + Sesion(@"SORIANA\t_nada"));
            interruptor.Valor = false;
            Check("L8 rol que falla + interruptor apagado: nada", "CCCCC|{\"autorizado\":false,\"solicitante\":false" + MARCA + "}",
                  Puertas(ADMPO) + "|" + Sesion(ADMPO));
            interruptor.Valor = true;
            Check("L8 anonimo con el rol fallando: no consulta, sin marca", "{\"autorizado\":false,\"solicitante\":false}", Sesion(""));
            roles.Lanza = false;

            d.Lanza = true;
            Check("L9 dueños que fallan: cuenta comun no entra y marcado", "DDDDD|{\"autorizado\":false,\"solicitante\":false" + MARCA + "}",
                  Puertas(MODSO) + "|" + Sesion(MODSO));
            roles.Filas[MODSO.ToUpperInvariant()] = new[] { "MOD" };
            Check("L9 dueños que fallan: MOD confirmado sigue en Admin, sin Nueva solicitud, marcado",
                  "PDDDD|{\"autorizado\":true,\"rol\":\"MOD\",\"solicitante\":false" + MARCA + "}", Puertas(MODSO) + "|" + Sesion(MODSO));
            Check("L9 dueños que fallan: ADM no los lee, sin marca", "{\"autorizado\":true,\"rol\":\"ADM\",\"solicitante\":true}", Sesion(ADMPO));
            d.Lanza = false;
            roles.Filas.Remove(MODSO.ToUpperInvariant());

            interruptor.Lanza = true;
            Check("L10 interruptor que falla: PO sin rol no entra y marcado", "CCCCC|{\"autorizado\":false,\"solicitante\":false" + MARCA + "}",
                  Puertas(MODSO) + "|" + Sesion(MODSO));
            interruptor.Lanza = false;
            Check("L11 todo bien: sin marca", "{\"autorizado\":false,\"solicitante\":true}", Sesion(MODSO));
            {
                var sw = new StringWriter();
                var ctx = Contexto("x.ashx", null, MODSO, sw);
                AccesoAdmin.PuedeEntrar(ctx);
                AccesoIniciativas.PuedeSolicitar(ctx);
                Check("L11 la marca vive en el request (sin fallo, false)", false, AccesoAdmin.VerificacionIncompleta(ctx));
                HttpContext.Current = null;
            }
            roles.Filas.Remove(ADMPO.ToUpperInvariant());
            AccesoIniciativas.FuenteDuenos = duenos;
        }

        // ---- F: el fuente ----------------------------------------------
        foreach (var h in new[] { "catalogos", "capacidad", "volumetria", "validar" })
        {
            var t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_" + h + ".ashx"));
            Check("F1 " + h + " usa ExigirSolicitud y no Exigir a secas", "True|False",
                  t.Contains("AccesoIniciativas.ExigirSolicitud(context)") + "|" + t.Contains("AccesoAdmin.Exigir(context)"));
        }
        foreach (var f in Directory.GetFiles("handlers", "admin_*.ashx"))
        {
            var n = Path.GetFileName(f);
            if (n == "admin_iniciativas_catalogos.ashx" || n == "admin_iniciativas_capacidad.ashx" ||
                n == "admin_iniciativas_volumetria.ashx" || n == "admin_iniciativas_validar.ashx" || n == "admin_sesion.ashx" ||
                n == "admin_iniciativas_mis_solicitudes.ashx") continue;
            Check("F2 " + n + " no mira el interruptor", false, File.ReadAllText(f).Contains("AccesoIniciativas"));
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
                  html.Contains("<b>Importante:</b> La solicitud de iniciativas est\u00e1 disponible \u00fanicamente para Product Owners (PO) y Service Owners (SO) vigentes."));
        }

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
