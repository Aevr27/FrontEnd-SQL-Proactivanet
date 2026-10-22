// Prueba de humo SIN SQL de handlers/admin_iniciativas_acuse.ashx y de
// App_Code/AcuseIniciativa.cs: identidad (cuenta -> cuenta@soriana.com ->
// CatPersona, exactamente una), roles PO/SO independientes, elegibilidad
// = Atrasada del semaforo, nada del navegador sustituye la identidad,
// duplicados, sin sql/28, bandeja y leidas solo ADM, listar no marca.
// La base de verdad (sql/28) se prueba en AcuseIniciativaSqlLocalDbSmoke.
//
// Compilar y correr desde la raiz del repo (como CambiosRecientesHttpSmoke):
//   csc /target:library /out:adm.dll ... App_Code\*.cs
//   csc /target:library /out:hnd.dll /r:adm.dll ... h\*.cs   (handlers sin la linea 1)
//   csc /out:AcuseIniciativaHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\AcuseIniciativaHttpSmoke.cs
using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class RolesFalsosAcuse : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesFalsosAcuse Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class PersonasFalsas : IFuentePersonasAcuse
{
    public List<PersonaCatalogo> Lista = new List<PersonaCatalogo>();
    public PersonasFalsas Con(string nombre, string correo) { Lista.Add(new PersonaCatalogo { Nombre = nombre, Correo = correo }); return this; }
    public List<PersonaCatalogo> Personas() { return Lista; }
}

sealed class IniciativasFalsas : IFuenteIniciativasAcuse
{
    public Dictionary<string, IniciativaAcuse> Por = new Dictionary<string, IniciativaAcuse>();
    public int LecturasRegistro;
    public IniciativasFalsas Con(IniciativaAcuse i) { Por[i.Folio] = i; return this; }
    public IniciativaAcuse Iniciativa(string folio) { LecturasRegistro++; IniciativaAcuse i; return Por.TryGetValue(folio, out i) ? i : null; }
    public List<IniciativaAcuse> Duenos() { return new List<IniciativaAcuse>(Por.Values); }
}

sealed class AlmacenFalso : IAlmacenAcuses
{
    public bool Hay = true;
    public readonly List<string[]> Registros = new List<string[]>();      // cuenta, folio, rol, dueno, estado, fecha compromiso
    public readonly List<AcuseGuardado> Guardados = new List<AcuseGuardado>();
    public readonly Dictionary<string, DateTime> Leidas = new Dictionary<string, DateTime>();
    public int Marcadas;
    public ErrorAcuse Lanzar;
    public bool Disponible() { return Hay; }
    public RegistroAcuse Registrar(string cuenta, string folio, string rol, string dueno, string estado, DateTime? fecha)
    {
        Registros.Add(new[] { cuenta, folio, rol, dueno, estado, fecha.HasValue ? fecha.Value.ToString("yyyy-MM-dd") : "NULL" });
        if (Lanzar != null) throw Lanzar;
        foreach (var g in Guardados)
            if (g.Folio == folio && g.Rol == rol && string.Equals(g.Cuenta, cuenta, StringComparison.OrdinalIgnoreCase))
                return new RegistroAcuse { IdAcuse = g.IdAcuse, Nuevo = false, FechaUtc = g.FechaUtc };
        var a = new AcuseGuardado { IdAcuse = Guardados.Count + 1, Folio = folio, Rol = rol, Cuenta = cuenta, NombreDueno = dueno,
                                    Estado = estado, FechaUtc = new DateTime(2026, 10, 22, 15, 0, Guardados.Count) };
        Guardados.Add(a);
        return new RegistroAcuse { IdAcuse = a.IdAcuse, Nuevo = true, FechaUtc = a.FechaUtc };
    }
    public List<AcuseGuardado> DeIniciativa(string folio) { return Guardados.FindAll(g => g.Folio == folio); }
    public BandejaAcuses Bandeja(string usuario, int limite)
    {
        var b = new BandejaAcuses();
        foreach (var g in Guardados)
        {
            DateTime l;
            var leida = Leidas.TryGetValue(g.IdAcuse + "|" + usuario.ToUpperInvariant(), out l);
            if (!leida) b.NoLeidas++;
            b.Notificaciones.Add(new NotificacionAcuse { IdNotificacion = g.IdAcuse, FechaUtc = g.FechaUtc, Acuse = g, LeidaUtc = leida ? (DateTime?)l : null });
        }
        return b;
    }
    public bool MarcarLeida(string usuario, int id)
    {
        Marcadas++;
        if (id > Guardados.Count) throw new ErrorAcuse(51307, "La notificacion no existe.");
        var k = id + "|" + usuario.ToUpperInvariant();
        if (Leidas.ContainsKey(k)) return false;
        Leidas[k] = new DateTime(2026, 10, 22, 16, 0, 0);
        return true;
    }
}

public static class AcuseIniciativaHttpSmoke
{
    static int fallos = 0;
    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // Las dos personas que la VM resolvio el 2026-10-22, y otras de prueba.
    const string PO = @"SORIANA\jesuscamor";     // MOD, PO
    const string SO = @"SORIANA\edgarrad";       // ADM, SO
    const string ADM = @"SORIANA\t_andresvr";    // ADM, no es dueño (t_*: no resuelve)
    const string OTRO = @"SORIANA\omaralus";     // ADM, en CatPersona pero no es dueño
    const string DUP = @"SORIANA\dup";           // MOD, dos filas con su correo
    const string HOMONIMO = @"SORIANA\homonimo"; // MOD, otra persona con su mismo nombre
    const string VIEWER = @"SORIANA\t_nadie";

    static string Correr(string metodo, string query, string cuenta, out int estado, params string[] kv)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("admin_iniciativas_acuse.ashx",
            "http://localhost/handlers/admin_iniciativas_acuse.ashx", query ?? ""), new HttpResponse(sw));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        var req = ctx.Request;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, metodo);
        if (kv.Length > 0)
        {
            var form = (NameValueCollection)Activator.CreateInstance(typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection"), true);
            for (var i = 0; i < kv.Length; i += 2) form.Add(kv[i], kv[i + 1]);
            typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, form);
        }
        new AdminIniciativasAcuse().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static Dictionary<string, object> Json(string s) { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s); }

    static IniciativaAcuse Ini(string folio, string po, string so, bool atrasada, bool? control = true, string estado = "En Soluci\u00f3n")
    {
        return new IniciativaAcuse { Folio = folio, Estado = estado, Activa = true, ControlFecha = control, FechaRetrasada = atrasada, Po = po, So = so,
                                     FechaCompromiso = new DateTime(2026, 9, 1) };
    }

    static IdentidadWindows Id(string cuenta) { return IdentidadWindows.Desde(cuenta, true); }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesFalsosAcuse().Con(PO, "MOD").Con(SO, "ADM").Con(ADM, "ADM").Con(OTRO, "ADM")
                                                       .Con(DUP, "MOD").Con(HOMONIMO, "MOD");
        var personas = new PersonasFalsas()
            .Con("Jesus Campa Morones", "JesusCamor@soriana.com ")
            .Con("Edgar Ramos D\u00e1valos", "edgarrad@soriana.com")
            .Con("Omar Luis", "omaralus@soriana.com")
            .Con("Dup Uno", "dup@soriana.com").Con("Dup Dos", "dup@soriana.com")
            .Con("Ana Lopez", "homonimo@soriana.com").Con("Ana  L\u00f3pez", "otraana@soriana.com");
        var inis = new IniciativasFalsas()
            .Con(Ini("PRB 2026-000001", "Jesus Campa Morones", "Edgar Ramos Davalos", true))
            .Con(Ini("PRB 2026-000002", "  jesus  campa  morones ", "Otra Persona", false))          // en tiempo
            .Con(Ini("REQ 2026-000003", "Jesus Campa Morones", null, true, false))                   // sin control de fecha
            .Con(Ini("PRB 2026-000004", "Ana Lopez", "Ana Lopez", true))
            .Con(Ini("PRB 2026-000005", "Otra Persona", "EDGAR RAMOS DAVALOS", true));
        var alm = new AlmacenFalso();
        AcusesIniciativa.Personas = personas;
        AcusesIniciativa.Iniciativas = inis;
        AcusesIniciativa.Almacen = alm;
        int estado;

        // ---------------- Z: oculto pendiente de aprobacion ----------------
        // Con Habilitado = false (el valor del repo) nada se lee ni se
        // escribe: GET disponible false, POST 403 FuncionNoAprobada.
        Check("Z0 en el repo el acuse esta OCULTO", false, AcusesIniciativa.Habilitado);
        foreach (var q in new[] { "accion=mio", "accion=iniciativa&folio=PRB%202026-000001" })
            Check("Z1 GET " + q + " (dueno): disponible false", "200|{\"disponible\":false}", (new Func<string>(delegate { var b = Correr("GET", q, PO, out estado); return estado + "|" + b; }))());
        Check("Z1 GET bandeja (ADM): disponible false", "{\"disponible\":false}", Correr("GET", "accion=bandeja", SO, out estado));
        Check("Z2 POST acusar (dueno de una Atrasada): 403 FuncionNoAprobada, nada guardado", "403|True|0",
              Codigo("POST", "accion=acusar", PO, "folio", "PRB 2026-000001", "rol", "PO") + "|" +
              Correr("POST", "accion=acusar", PO, out estado, "folio", "PRB 2026-000001", "rol", "PO").Contains("FuncionNoAprobada") + "|" + alm.Registros.Count);
        Check("Z3 POST leida (ADM): 403, nada marcado", "403|0", Codigo("POST", "accion=leida", SO, "id", "1") + "|" + alm.Marcadas);
        Check("Z4 sigue 403 AccesoDenegado para VIEWER (la puerta no cambia)", 403, Codigo("GET", "accion=mio", VIEWER));
        Check("Z5 sigue 403 RolInsuficiente para MOD en la bandeja", true, Correr("GET", "accion=bandeja", PO, out estado).Contains("RolInsuficiente"));
        // El resto prueba la funcion como quedara al reactivarla.
        AcusesIniciativa.Habilitado = true;

        // ---------------- I: identidad (sin HTTP) ----------------
        var lp = personas.Lista;
        Check("I1 cuenta -> cuenta@soriana.com -> una fila de CatPersona (correo sin mayusculas ni espacios)",
              "resuelto|Jesus Campa Morones|jesuscamor@soriana.com",
              IdentidadAcuse.Resolver(Id(PO), lp).Estado + "|" + IdentidadAcuse.Resolver(Id(PO), lp).Nombre + "|" + IdentidadAcuse.Resolver(Id(PO), lp).Correo);
        Check("I2 t_* sin fila: no_encontrado", "no_encontrado", IdentidadAcuse.Resolver(Id(ADM), lp).Estado);
        Check("I3 dos filas con el mismo correo: ambiguo (no se escoge)", "ambiguo", IdentidadAcuse.Resolver(Id(DUP), lp).Estado);
        Check("I4 otra persona con el mismo nombre (sin acentos/espacios): nombre_repetido", "nombre_repetido", IdentidadAcuse.Resolver(Id(HOMONIMO), lp).Estado);
        Check("I5 sin identidad / anonima", "sin_identidad|sin_identidad",
              IdentidadAcuse.Resolver(null, lp).Estado + "|" + IdentidadAcuse.Resolver(IdentidadWindows.Desde(null, false), lp).Estado);
        var edgar = IdentidadAcuse.Resolver(Id(SO), lp);
        Check("I6 due\u00f1o sin acentos, mayusculas ni espacios de mas; otro nombre no", "True|True|False|False",
              edgar.EsDueno("Edgar Ramos Davalos") + "|" + edgar.EsDueno("  EDGAR   RAMOS DAVALOS ") + "|" + edgar.EsDueno("Edgar Ramos") + "|" + edgar.EsDueno(null));
        Check("I7 dominio en mayusculas o distinto da la misma cuenta", "resuelto",
              IdentidadAcuse.Resolver(Id(@"OTRODOM\EDGARRAD"), lp).Estado);

        // ---------------- F: la fecha que se evalua (foto del episodio) ----------------
        Func<string, string, string, string, string, string> foto = delegate (string est, string fa, string fs, string fc, string esperado)
        {
            var d = new Dictionary<string, object> { { "folio", "X" }, { "estado", est }, { "f_analisis", fa }, { "f_solucion", fs }, { "f_cierre", fc } };
            var f = IniciativaAcuse.DesdeRegistro(d).FechaCompromiso;
            return f.HasValue ? f.Value.ToString("yyyy-MM-dd") : "NULL";
        };
        Check("F1 la fecha del Estado de la lista: Analisis/Solucion/Monitoreo (acentos y mayusculas dan igual); sin fecha, cerrado o invalida = NULL",
              "2026-08-01|2026-09-01|2026-10-01|NULL|NULL|NULL",
              foto("En An\u00e1lisis", "2026-08-01", "2026-09-01", "2026-10-01", null) + "|" + foto("EN SOLUCION", "2026-08-01", "2026-09-01", "2026-10-01", null) + "|" +
              foto("En Monitoreo", "2026-08-01", "2026-09-01", "2026-10-01", null) + "|" + foto("En Soluci\u00f3n", "2026-08-01", null, null, null) + "|" +
              foto("Cerrado", "2026-08-01", "2026-09-01", "2026-10-01", null) + "|" + foto("En An\u00e1lisis", "01/08/2026", null, null, null));

        // ---------------- A: quien entra ----------------
        Check("A1 VIEWER: 403 y no se consulta nada", "403|AccesoDenegado|0",
              Json(Correr("GET", "accion=mio", VIEWER, out estado))["tipo"] is string ? estado + "|" + Json(Correr("GET", "accion=mio", VIEWER, out estado))["tipo"] + "|" + alm.Registros.Count : "x");
        Check("A2 MOD no ve la bandeja ni marca leidas (403 RolInsuficiente)", "403|RolInsuficiente|403|RolInsuficiente",
              Json(Correr("GET", "accion=bandeja", PO, out estado))["tipo"] is string ? estado + "|RolInsuficiente|" +
              Codigo("POST", "accion=leida", PO, "id", "1") + "|" + Json(Correr("POST", "accion=leida", PO, out estado, "id", "1"))["tipo"] : "x");
        Check("A3 accion desconocida 400; GET de acusar 405; POST de mio 405", "400|405|405",
              Codigo("GET", "accion=borrar", PO) + "|" + Codigo("GET", "accion=acusar&folio=PRB%202026-000001&rol=PO", PO) + "|" + Codigo("POST", "accion=mio", PO));

        // ---------------- S: sin sql/28 ----------------
        alm.Hay = false;
        var j = Json(Correr("GET", "accion=mio", PO, out estado));
        Check("S1 sin sql/28: GET 200 disponible=false", "200|False", estado + "|" + j["disponible"]);
        j = Json(Correr("POST", "accion=acusar", PO, out estado, "folio", "PRB 2026-000001", "rol", "PO"));
        Check("S2 sin sql/28: POST 501 y nada se registra", "501|PersistenciaNoHabilitada|0", estado + "|" + j["tipo"] + "|" + alm.Registros.Count);
        alm.Hay = true;

        // ---------------- M: mio ----------------
        j = Json(Correr("GET", "accion=mio", PO, out estado));
        var roles = (Dictionary<string, object>)j["roles"];
        Check("M1 PO: sus folios como PO (sin acentos/espacios), ninguno como SO; atrasada o no (eso lo decide el POST)",
              "200|resuelto|Jesus Campa Morones|PRB 2026-000001,PRB 2026-000002,REQ 2026-000003|PO",
              estado + "|" + ((Dictionary<string, object>)j["identidad"])["estado"] + "|" + ((Dictionary<string, object>)j["identidad"])["nombre"] + "|" +
              string.Join(",", Ordenadas(roles.Keys)) + "|" + string.Join(",", ((ArrayList)roles["PRB 2026-000001"]).ToArray()));
        j = Json(Correr("GET", "accion=mio", SO, out estado));
        Check("M2 SO: PRB 1 y PRB 5 como SO", "PRB 2026-000001:SO,PRB 2026-000005:SO", Roles((Dictionary<string, object>)j["roles"]));
        j = Json(Correr("GET", "accion=mio", ADM, out estado));
        Check("M3 identidad no resuelta: sin roles", "no_encontrado|0", ((Dictionary<string, object>)j["identidad"])["estado"] + "|" + ((Dictionary<string, object>)j["roles"]).Count);
        j = Json(Correr("GET", "accion=mio", HOMONIMO, out estado));
        Check("M4 nombre repetido en CatPersona: sin roles aunque sea 'Ana Lopez' de PRB 4", "nombre_repetido|0",
              ((Dictionary<string, object>)j["identidad"])["estado"] + "|" + ((Dictionary<string, object>)j["roles"]).Count);

        // ---------------- C: acusar ----------------
        j = Json(Correr("POST", "accion=acusar", PO, out estado, "folio", "PRB 2026-000001", "rol", "PO",
                        "cuenta", @"SORIANA\edgarrad", "usuario", "otro", "nombre", "Edgar Ramos Davalos"));
        Check("C1 PO asignado y Atrasada: 200 nuevo; firma la cuenta de IIS, no la del formulario; manda la fecha que evaluo",
              "200|True|True|PO|Jesus Campa Morones|SORIANA\\jesuscamor|PRB 2026-000001|PO|Jesus Campa Morones|En Soluci\u00f3n|2026-09-01",
              estado + "|" + j["acusado"] + "|" + j["nuevo"] + "|" + j["rol"] + "|" + j["nombre"] + "|" + string.Join("|", alm.Registros[0]));
        j = Json(Correr("POST", "accion=acusar", PO, out estado, "folio", "PRB 2026-000001", "rol", "PO"));
        Check("C2 doble envio: 200 nuevo=false, mismo id, un solo acuse guardado", "200|False|1|1",
              estado + "|" + j["nuevo"] + "|" + j["id"] + "|" + alm.Guardados.Count);
        j = Json(Correr("POST", "accion=acusar", PO, out estado, "folio", "PRB 2026-000001", "rol", "SO"));
        Check("C3 el PO no puede acusar como SO: 403 NoEsDueno, nada nuevo", "403|NoEsDueno|1", estado + "|" + j["tipo"] + "|" + alm.Guardados.Count);
        j = Json(Correr("POST", "accion=acusar", SO, out estado, "folio", "PRB 2026-000001", "rol", "SO"));
        Check("C4 el SO acusa por separado la misma iniciativa: otro acuse", "200|True|2|SO", estado + "|" + j["nuevo"] + "|" + alm.Guardados.Count + "|" + alm.Guardados[1].Rol);
        j = Json(Correr("POST", "accion=acusar", SO, out estado, "folio", "PRB 2026-000001", "rol", "PO"));
        Check("C5 el SO no puede acusar como PO", "403|NoEsDueno", estado + "|" + j["tipo"]);
        j = Json(Correr("POST", "accion=acusar", PO, out estado, "folio", "PRB 2026-000002", "rol", "PO"));
        Check("C6 en tiempo: 409 NoElegible", "409|NoElegible", estado + "|" + j["tipo"]);
        j = Json(Correr("POST", "accion=acusar", PO, out estado, "folio", "REQ 2026-000003", "rol", "PO"));
        Check("C7 sin control de fecha (aunque fecha_retrasada): 409 NoElegible", "409|NoElegible", estado + "|" + j["tipo"]);
        j = Json(Correr("POST", "accion=acusar", OTRO, out estado, "folio", "PRB 2026-000001", "rol", "PO"));
        Check("C8 ADM que no es el due\u00f1o: 403 NoEsDueno (ser ADM no basta)", "403|NoEsDueno", estado + "|" + j["tipo"]);
        j = Json(Correr("POST", "accion=acusar", ADM, out estado, "folio", "PRB 2026-000001", "rol", "PO"));
        Check("C9 identidad no resuelta: 403 IdentidadNoResuelta", "403|IdentidadNoResuelta", estado + "|" + j["tipo"]);
        j = Json(Correr("POST", "accion=acusar", HOMONIMO, out estado, "folio", "PRB 2026-000004", "rol", "PO"));
        Check("C10 homonimo: 403 aunque el nombre coincida", "403|IdentidadNoResuelta", estado + "|" + j["tipo"]);
        j = Json(Correr("POST", "accion=acusar", DUP, out estado, "folio", "PRB 2026-000001", "rol", "PO"));
        Check("C11 correo con dos personas: 403", "403|IdentidadNoResuelta", estado + "|" + j["tipo"]);
        Check("C12 rol invalido 400; sin folio 400; folio que no existe 404",
              "400|400|404",
              Codigo("POST", "accion=acusar", PO, "folio", "PRB 2026-000001", "rol", "DIR") + "|" +
              Codigo("POST", "accion=acusar", PO, "rol", "PO") + "|" + Codigo("POST", "accion=acusar", PO, "folio", "PRB 2026-999999", "rol", "PO"));
        alm.Lanzar = new ErrorAcuse(51305, "El dueno de ese rol cambio: vuelve a abrir la iniciativa.");
        j = Json(Correr("POST", "accion=acusar", SO, out estado, "folio", "PRB 2026-000005", "rol", "SO"));
        Check("C13 la base ve otro due\u00f1o (51305): 409, acusado=false", "409|Base51305|False", estado + "|" + j["tipo"] + "|" + j["acusado"]);
        alm.Lanzar = new ErrorAcuse(51308, "La fecha compromiso de la iniciativa cambio: vuelve a abrirla.");
        j = Json(Correr("POST", "accion=acusar", SO, out estado, "folio", "PRB 2026-000005", "rol", "SO"));
        Check("C13b la fecha compromiso cambio entre evaluar y guardar (51308): 409, acusado=false", "409|Base51308|False",
              estado + "|" + j["tipo"] + "|" + j["acusado"]);
        alm.Lanzar = null;
        var antes = inis.Por["PRB 2026-000001"];
        Check("C14 la iniciativa no cambia (estado, due\u00f1os, semaforo)", "En Soluci\u00f3n|Jesus Campa Morones|Edgar Ramos Davalos|True",
              antes.Estado + "|" + antes.Po + "|" + antes.So + "|" + antes.Atrasada);
        Check("C15 sin usuario autenticado: 403 antes de nada", "403", Codigo("POST", "accion=acusar", "", "folio", "PRB 2026-000001", "rol", "PO"));

        // ---------------- D: acuses de una iniciativa ----------------
        j = Json(Correr("GET", "accion=iniciativa&folio=PRB%202026-000001", PO, out estado));
        Check("D1 detalle (MOD o ADM): los dos acuses, rol y fecha", "200|2|PO,SO", estado + "|" + ((ArrayList)j["acuses"]).Count + "|" +
              ((Dictionary<string, object>)((ArrayList)j["acuses"])[0])["rol"] + "," + ((Dictionary<string, object>)((ArrayList)j["acuses"])[1])["rol"]);

        // ---------------- B: bandeja de ADM ----------------
        j = Json(Correr("GET", "accion=bandeja", SO, out estado));
        Check("B1 ADM: 2 notificaciones no leidas; listar NO marca", "200|2|2|0",
              estado + "|" + j["no_leidas"] + "|" + ((ArrayList)j["notificaciones"]).Count + "|" + alm.Marcadas);
        var n0 = (Dictionary<string, object>)((ArrayList)j["notificaciones"])[0];
        Check("B2 notificacion: folio, persona, rol, hora, cuenta, leida=false",
              "PRB 2026-000001|Jesus Campa Morones|PO|2026-10-22T15:00:00Z|SORIANA\\jesuscamor|False",
              n0["folio"] + "|" + n0["nombre"] + "|" + n0["rol"] + "|" + n0["fecha_utc"] + "|" + n0["cuenta"] + "|" + n0["leida"]);
        j = Json(Correr("POST", "accion=leida", SO, out estado, "id", "1"));
        Check("B3 marcar leida: nueva", "200|True", estado + "|" + j["nueva"]);
        j = Json(Correr("POST", "accion=leida", SO, out estado, "id", "1"));
        Check("B4 otra vez: sin duplicar (nueva=false)", "200|False", estado + "|" + j["nueva"]);
        j = Json(Correr("GET", "accion=bandeja", SO, out estado));
        Check("B5 leida solo para ese ADM", "1", j["no_leidas"]);
        j = Json(Correr("GET", "accion=bandeja", OTRO, out estado));
        Check("B6 otro ADM la sigue viendo no leida", "2", j["no_leidas"]);
        Check("B7 id que no existe 404; sin id 400", "404|400",
              Codigo("POST", "accion=leida", SO, "id", "99") + "|" + Codigo("POST", "accion=leida", SO));

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }

    static int Codigo(string metodo, string query, string cuenta, params string[] kv)
    {
        int estado;
        Correr(metodo, query, cuenta, out estado, kv);
        return estado;
    }

    static List<string> Ordenadas(IEnumerable<string> l) { var r = new List<string>(l); r.Sort(StringComparer.Ordinal); return r; }

    static string Roles(Dictionary<string, object> roles)
    {
        var l = new List<string>();
        foreach (var k in Ordenadas(roles.Keys)) l.Add(k + ":" + string.Join("+", ((ArrayList)roles[k]).ToArray()));
        return string.Join(",", l.ToArray());
    }
}
