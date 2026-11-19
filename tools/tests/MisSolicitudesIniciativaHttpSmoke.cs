// Prueba de humo SIN SQL de handlers/admin_iniciativas_mis_solicitudes.ashx
// ("Mis solicitudes" de la pestaña Solicitudes) y de que Solicitudes sigue
// la MISMA regla que "Solicitar una iniciativa" (AccesoIniciativas), con
// roles, dueños y lector falsos.
//
//   A  acceso al handler (2026-10-28): anonimo y VIEWER sin PO/SO: 403 sin
//      tocar el lector. ADM, MOD (sea o no PO/SO) y PO/SO sin rol entran.
//      Es la misma respuesta que admin_sesion da en "solicitante".
//   M  el modulo (URL directa): la pagina es de todos (el registro); el
//      handler pasa o se niega igual que Solicitar; los datos de ADM
//      (Nuevas, cola de cambios) siguen siendo solo de ADM aunque la cuenta
//      pueda solicitar.
//   C  de quien: siempre la cuenta de IIS; ?cuenta= / ?usuario= no cambian
//      nada; el detalle de otra cuenta es 404 (como si no existiera).
//   L  listar / detalle: 200, sin tablas 501, numero invalido 400, POST 405,
//      accion desconocida 400. Solo lectura: el fuente no escribe.
//   E  filtro Estado (2026-11-04): ENVIADA / APROBADA / RECHAZADA / todas,
//      siempre dentro de la cuenta; estado desconocido 400 sin leer.
//
// Compilar y correr desde la raiz del repo (como AccesoAdminHttpSmoke):
//   csc /out:MisSolicitudesIniciativaHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\MisSolicitudesIniciativaHttpSmoke.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class RolesMiasFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesMiasFalsos Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class DuenosMiasFalsos : IFuenteDuenosVigentes
{
    public readonly List<PersonaCatalogo> Personas = new List<PersonaCatalogo>();
    public readonly List<DirectorioOrganizacional.Dueno> Filas = new List<DirectorioOrganizacional.Dueno>();
    public DuenosMiasFalsos Persona(string nombre, string correo) { Personas.Add(new PersonaCatalogo { Nombre = nombre, Correo = correo }); return this; }
    public DuenosMiasFalsos Fila(string po, string so)
    {
        Filas.Add(new DirectorioOrganizacional.Dueno { CategoriaN2 = "/A/B", C1 = "/A", Po = po, So = so, Director = "Dir", Vigente = true });
        return this;
    }
    public DuenosVigentes Leer()
    {
        var filas = new List<DirectorioOrganizacional.Dueno>();
        foreach (var f in Filas)
            filas.Add(new DirectorioOrganizacional.Dueno { CategoriaN2 = f.CategoriaN2, C1 = f.C1, Po = f.Po, So = f.So, Director = f.Director, Vigente = f.Vigente });
        return new DuenosVigentes { Personas = new List<PersonaCatalogo>(Personas), Directorio = new DirectorioOrganizacional(filas, new Dictionary<string, string>()) };
    }
}

// Guarda solicitudes por cuenta y solo devuelve las de la cuenta pedida,
// como el filtro SQL (sin distinguir mayusculas).
sealed class LectorMiasFalso : ILectorMisSolicitudesIniciativa
{
    public bool Hay = true;
    public readonly List<Dictionary<string, object>> Todas = new List<Dictionary<string, object>>();
    public readonly List<string> Llamadas = new List<string>();

    public bool Disponible() { Llamadas.Add("disponible"); return Hay; }

    public LecturaSolicitudesIniciativa ListarDe(string cuenta, int maximo, string estado)
    {
        Llamadas.Add("listar:" + cuenta + (estado == null ? "" : ":" + estado));
        var l = new LecturaSolicitudesIniciativa();
        foreach (var s in Todas)
            if (string.Equals((string)s["solicitante_cuenta"], cuenta, StringComparison.OrdinalIgnoreCase)
                && (estado == null || (string)s["estado"] == estado)) l.Solicitudes.Add(s);
        l.Total = l.Solicitudes.Count;
        return l;
    }

    public Dictionary<string, object> DetalleDe(int numero, string cuenta)
    {
        Llamadas.Add("detalle:" + numero + ":" + cuenta);
        foreach (var s in Todas)
            if ((int)s["numero"] == numero && string.Equals((string)s["solicitante_cuenta"], cuenta, StringComparison.OrdinalIgnoreCase))
                return new Dictionary<string, object>(s) { { "eventos", new List<object>() } };
        return null;
    }
}

// sql/42 sin SQL: lo que validar pide cancelar / reemplazar.
sealed class CancelacionesMiasFalsas : ICancelacionSolicitudesIniciativa
{
    public bool Hay = true;
    public Exception Lanza;
    public int Reemplazos;
    public readonly List<string> Llamadas = new List<string>();
    public bool Disponible() { return Hay; }
    public void Cancelar(int numero, string usuario, string motivo)
    {
        Llamadas.Add(numero + "|" + usuario + "|" + motivo);
        if (Lanza != null) throw Lanza;
    }
    public SolicitudGuardada Reemplazar(AltaSolicitud a) { Reemplazos++; throw new InvalidOperationException("no deberia llegar"); }
}

public static class MisSolicitudesIniciativaHttpSmoke
{
    static int fallos = 0, pasados = 0;
    // Lo que manda el navegador desde una pagina del propio sitio
    // (AccesoAdmin.ExigirMismoOrigen). Sin IIS los headers del request son
    // de solo lectura: se abren por reflexion solo para ponerlo.
    static void CabeceraNavegador(HttpRequest req, string nombre, string valor)
    {
        var h = req.Headers;
        var t = typeof(System.Collections.Specialized.NameObjectCollectionBase);
        var f = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
        var ro = t.GetProperty("IsReadOnly", f);
        ro.SetValue(h, false, null);
        t.GetMethod("BaseSet", f, null, new[] { typeof(string), typeof(object) }, null)
         .Invoke(h, new object[] { nombre, new System.Collections.ArrayList { valor } });
        ro.SetValue(h, true, null);
    }

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    const string ADM = @"SORIANA\t_adm";
    const string MOD = @"SORIANA\t_mod";          // MOD que no es PO/SO
    const string MODPO = @"SORIANA\t_modpo";      // MOD y SO vigente
    const string POSO = @"SORIANA\juanperez";     // sin rol, PO vigente
    const string VIEWER = @"SORIANA\t_nadie";     // sin rol ni PO/SO

    static HttpContext Contexto(string archivo, string query, string cuenta, StringWriter sw)
    {
        var ctx = new HttpContext(new HttpRequest(archivo, "http://localhost/handlers/" + archivo, query ?? ""), new HttpResponse(sw));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        return ctx;
    }

    static string Correr(IHttpHandler h, string archivo, string metodo, string query, string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = Contexto(archivo, query, cuenta, sw);
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(ctx.Request, metodo);
        CabeceraNavegador(ctx.Request, "Sec-Fetch-Site", "same-origin");
        try { h.ProcessRequest(ctx); }
        catch (Exception ex) { sw.Write("EXCEPCION " + ex.GetType().Name); }
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static string Mias(string query, string cuenta, out int estado, string metodo = "GET")
    {
        return Correr(new AdminIniciativasMisSolicitudes(), "admin_iniciativas_mis_solicitudes.ashx", metodo, query, cuenta, out estado);
    }

    // AdminAccesoModulo sobre una ruta: "pasa" o el estado del rechazo.
    static string Modulo(string ruta, string cuenta)
    {
        var sw = new StringWriter();
        var ctx = Contexto("x", null, cuenta, sw);
        var sigue = AdminAccesoModulo.Revisar(ctx, ruta);
        HttpContext.Current = null;
        return sigue ? "pasa" : ctx.Response.StatusCode.ToString();
    }

    static bool Solicitante(string cuenta)
    {
        int st;
        var j = Json(Correr(new AdminSesion(), "admin_sesion.ashx", "GET", null, cuenta, out st));
        return Campo(j, "solicitante") is bool && (bool)Campo(j, "solicitante");
    }

    static Dictionary<string, object> Json(string s)
    {
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s); }
        catch { return new Dictionary<string, object>(); }
    }
    static object Campo(Dictionary<string, object> j, string k) { object v; return j.TryGetValue(k, out v) ? v : "(falta)"; }

    static Dictionary<string, object> Fila(int n, string cuenta, string estado = "ENVIADA")
    {
        return new Dictionary<string, object>
        {
            { "numero", n }, { "numero_texto", new NumeroSolicitud(n).ToString() }, { "estado", estado },
            { "titulo", "Solicitud " + n }, { "solicitante_cuenta", cuenta },
        };
    }

    static string Numeros(string cuerpo)
    {
        var filas = Campo(Json(cuerpo), "solicitudes") as System.Collections.ArrayList;
        if (filas == null) return "(sin lista)";
        var r = new List<string>();
        foreach (Dictionary<string, object> f in filas) r.Add(Convert.ToString(f["numero"]));
        return string.Join(",", r.ToArray());
    }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesMiasFalsos().Con(ADM, "ADM").Con(MOD, "MOD").Con(MODPO, "MOD");
        AccesoIniciativas.FuenteDuenos = new DuenosMiasFalsos()
            .Persona("Juan Perez", "juanperez@soriana.com")
            .Persona("Mod Po", "t_modpo@soriana.com")
            .Persona("Mod Uno", "t_mod@soriana.com")
            .Persona("Nadie", "t_nadie@soriana.com")
            .Fila("Juan Perez", "Mod Po");
        var lector = new LectorMiasFalso();
        lector.Todas.Add(Fila(3, POSO));
        lector.Todas.Add(Fila(2, MODPO));
        lector.Todas.Add(Fila(1, POSO.ToUpperInvariant()));
        lector.Todas.Add(Fila(9, ADM));
        lector.Todas.Add(Fila(5, MOD));
        RegistroSolicitudesIniciativa.Mias = lector;
        // Los datos de ADM: si alguien que no es ADM llegara a leerlos, se nota.
        var lectorAdm = new LectorAdmFalso();
        RegistroSolicitudesIniciativa.Lector = lectorAdm;
        int st;
        string cuerpo;

        // ---------------- A: acceso al handler ----------------
        foreach (var c in new[] { new[] { "anonimo", "" }, new[] { "VIEWER sin PO/SO", VIEWER } })
            foreach (var q in new[] { "accion=listar", "accion=detalle&numero=3" })
            {
                lector.Llamadas.Clear();
                cuerpo = Mias(q, c[1], out st);
                Check("A1 " + c[0] + " " + q + ": 403 sin tocar el lector", "403|AccesoDenegado|0",
                      st + "|" + Campo(Json(cuerpo), "tipo") + "|" + lector.Llamadas.Count);
            }
        lector.Llamadas.Clear();
        cuerpo = Mias("accion=listar", null, out st);
        Check("A1 sin usuario: 403 sin tocar el lector", "403|0", st + "|" + lector.Llamadas.Count);

        cuerpo = Mias("accion=listar", MOD, out st);
        Check("A2 MOD sin ser PO/SO: entra (MOD siempre puede solicitar)", "200|True", st + "|" + Solicitante(MOD));

        foreach (var c in new[] { new[] { "ADM", ADM }, new[] { "MOD", MOD }, new[] { "MOD PO/SO", MODPO }, new[] { "PO/SO sin rol", POSO } })
        {
            cuerpo = Mias("accion=listar", c[1], out st);
            Check("A3 " + c[0] + ": 200", 200, st);
        }
        // La misma regla que admin_sesion "solicitante" (lo que muestra la pestaña).
        foreach (var c in new[] { "", VIEWER, MOD, ADM, MODPO, POSO })
        {
            Mias("accion=listar", c, out st);
            Check("A4 " + (c.Length == 0 ? "anonimo" : c) + ": entra a Mis solicitudes = solicitante de admin_sesion", Solicitante(c), st == 200);
        }

        // ---------------- M: URL directa (modulo) ----------------
        foreach (var c in new[] { new[] { "VIEWER sin PO/SO (el registro es de todos)", VIEWER, "pasa" }, new[] { "anonimo (el registro es de todos)", "", "pasa" },
                                  new[] { "PO/SO sin rol", POSO, "pasa" }, new[] { "MOD sin PO/SO", MOD, "pasa" }, new[] { "ADM", ADM, "pasa" } })
            Check("M1 pagina admin/iniciativas.html, " + c[0], c[2], Modulo("~/admin/iniciativas.html", c[1]));
        foreach (var c in new[] { new[] { "VIEWER sin PO/SO", VIEWER, "403" }, new[] { "anonimo", "", "403" },
                                  new[] { "PO/SO sin rol", POSO, "pasa" }, new[] { "MOD sin PO/SO", MOD, "pasa" } })
            Check("M2 modulo: Mis solicitudes, " + c[0], c[2], Modulo("~/handlers/admin_iniciativas_mis_solicitudes.ashx", c[1]));
        Check("M2 ... es ruta del solicitante y protegida", "True|True",
              AccesoIniciativas.EsRutaSolicitante("~/handlers/admin_iniciativas_mis_solicitudes.ashx") + "|" +
              AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_mis_solicitudes.ashx"));
        foreach (var c in new[] { new[] { "PO/SO sin rol", POSO }, new[] { "MOD PO/SO", MODPO }, new[] { "MOD sin PO/SO", MOD } })
        {
            lectorAdm.Llamadas = 0;
            Correr(new AdminIniciativasSolicitudesNuevas(), "admin_iniciativas_solicitudes_nuevas.ashx", "GET", "accion=listar", c[1], out st);
            var nuevas = st;
            Correr(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx", "GET", "accion=listar", c[1], out st);
            Check("M3 " + c[0] + ": Nuevas (todas) y la cola de cambios siguen siendo de ADM", "403|403|0", nuevas + "|" + st + "|" + lectorAdm.Llamadas);
        }
        Check("M3 ... modulo: Nuevas niega al PO/SO sin rol por URL directa", "403",
              Modulo("~/handlers/admin_iniciativas_solicitudes_nuevas.ashx", POSO));

        // ---------------- C: de quien ----------------
        cuerpo = Mias("accion=listar", POSO, out st);
        Check("C1 PO/SO: solo las suyas (sin distinguir mayusculas), las mas recientes primero", "200|3,1|2",
              st + "|" + Numeros(cuerpo) + "|" + Campo(Json(cuerpo), "total"));
        cuerpo = Mias("accion=listar", MODPO, out st);
        Check("C2 MOD PO/SO: solo la suya", "2", Numeros(cuerpo));
        cuerpo = Mias("accion=listar", MOD, out st);
        Check("C2 MOD sin PO/SO: solo la suya", "5", Numeros(cuerpo));
        cuerpo = Mias("accion=detalle&numero=3", MOD, out st);
        Check("C2 MOD: detalle de una solicitud de OTRA cuenta 404", "404|SolicitudNoExiste", st + "|" + Campo(Json(cuerpo), "tipo"));
        cuerpo = Mias("accion=listar", ADM, out st);
        Check("C3 ADM: tambien solo las suyas (las de todos van por Nuevas)", "9", Numeros(cuerpo));
        lector.Llamadas.Clear();
        cuerpo = Mias("accion=listar&cuenta=" + Uri.EscapeDataString(MODPO) + "&usuario=" + Uri.EscapeDataString(MODPO), POSO, out st);
        Check("C4 ?cuenta= / ?usuario= no cambian de quien: la cuenta de IIS", "3,1|listar:" + POSO,
              Numeros(cuerpo) + "|" + lector.Llamadas[lector.Llamadas.Count - 1]);
        cuerpo = Mias("accion=detalle&numero=2", POSO, out st);
        Check("C5 detalle de una solicitud de OTRA cuenta: 404, como si no existiera", "404|SolicitudNoExiste", st + "|" + Campo(Json(cuerpo), "tipo"));
        cuerpo = Mias("accion=detalle&numero=%230000003", POSO, out st);
        Check("C6 detalle de la suya: 200 con su numero y su historial", "200|3|True",
              st + "|" + Campo(Json(cuerpo), "numero") + "|" + (Campo(Json(cuerpo), "eventos") is System.Collections.ArrayList));

        // ---------------- L: respuestas ----------------
        cuerpo = Mias("accion=detalle&numero=abc", POSO, out st);
        Check("L1 numero invalido: 400 SinSolicitud", "400|SinSolicitud", st + "|" + Campo(Json(cuerpo), "tipo"));
        cuerpo = Mias("accion=borrar", POSO, out st);
        Check("L2 accion desconocida: 400", 400, st);
        cuerpo = Mias("accion=listar", POSO, out st, "POST");
        Check("L3 POST: 405", 405, st);
        lector.Hay = false;
        cuerpo = Mias("accion=listar", POSO, out st);
        Check("L4 sin tablas de sql/29: 501 RegistroNoDisponible", "501|RegistroNoDisponible", st + "|" + Campo(Json(cuerpo), "tipo"));
        lector.Hay = true;
        cuerpo = Mias("accion=listar", VIEWER, out st);
        Check("L5 sin datos de otros en un 403", false, cuerpo.Contains("Solicitud 3"));
        {
            var t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_mis_solicitudes.ashx"));
            Check("L6 solo lectura: el handler no escribe ni llama procedimientos", "False|False|False",
                  t.Contains("ExecuteNonQuery") + "|" + t.Contains("usp_") + "|" + t.Contains("SqlCommand"));
            var r = File.ReadAllText(Path.Combine("App_Code", "RegistroSolicitudesIniciativa.cs"));
            Check("L7 el filtro por cuenta es un parametro (@cuenta), nunca texto armado", "True|False",
                  r.Contains("UPPER(s.SolicitanteCuenta) = UPPER(@cuenta)") + "|" + r.Contains("+ cuenta +"));
        }

        // ---------------- E: filtro Estado ----------------
        lector.Todas.Add(Fila(7, POSO, "APROBADA"));
        lector.Todas.Add(Fila(6, POSO, "RECHAZADA"));
        lector.Todas.Add(Fila(8, MODPO, "APROBADA"));
        lector.Todas.Add(Fila(4, MOD, "RECHAZADA"));
        foreach (var c in new[] { new[] { "ENVIADA", "3,1" }, new[] { "APROBADA", "7" }, new[] { "RECHAZADA", "6" }, new[] { "", "3,1,7,6" } })
        {
            cuerpo = Mias("accion=listar" + (c[0].Length == 0 ? "" : "&estado=" + c[0]), POSO, out st);
            Check("E1 PO/SO estado=" + (c[0].Length == 0 ? "(todas)" : c[0]) + ": solo las suyas de ese estado", "200|" + c[1], st + "|" + Numeros(cuerpo));
        }
        lector.Llamadas.Clear();
        Mias("accion=listar&estado=APROBADA", POSO, out st);
        Check("E2 el estado llega al lector con la cuenta de IIS", "listar:" + POSO + ":APROBADA", lector.Llamadas[lector.Llamadas.Count - 1]);
        cuerpo = Mias("accion=listar&estado=APROBADA", MOD, out st);
        Check("E3 MOD: APROBADA de otras cuentas no aparecen", "200|", st + "|" + Numeros(cuerpo));
        cuerpo = Mias("accion=listar&estado=RECHAZADA", MOD, out st);
        Check("E3 MOD: su RECHAZADA", "4", Numeros(cuerpo));
        cuerpo = Mias("accion=listar&estado=APROBADA", MODPO, out st);
        Check("E3 MOD PO/SO: su APROBADA", "8", Numeros(cuerpo));
        foreach (var q in new[] { "PENDIENTE", "aprobada", "TODAS", "ENVIADA' OR 1=1--" })
        {
            lector.Llamadas.Clear();
            cuerpo = Mias("accion=listar&estado=" + Uri.EscapeDataString(q), POSO, out st);
            Check("E4 estado desconocido '" + q + "': 400 sin leer", "400|EstadoDesconocido|0", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + lector.Llamadas.Count);
        }
        lector.Llamadas.Clear();
        cuerpo = Mias("accion=listar&estado=APROBADA", VIEWER, out st);
        Check("E5 VIEWER con filtro: 403 sin leer", "403|0", st + "|" + lector.Llamadas.Count);
        cuerpo = Mias("accion=detalle&numero=7&estado=RECHAZADA", POSO, out st);
        Check("E6 detalle ignora ?estado=", "200|7", st + "|" + Campo(Json(cuerpo), "numero"));

        // ---------------- X: cancelar y modificar (sql/42) ----------------
        var cancX = new CancelacionesMiasFalsas();
        SolicitudesIniciativa.Cancelaciones = cancX;
        Func<string, string[][], string> postValidar = delegate (string cuenta, string[][] campos)
        {
            var sw = new StringWriter();
            var ctx = Contexto("admin_iniciativas_validar.ashx", null, cuenta, sw);
            typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(ctx.Request, "POST");
            CabeceraNavegador(ctx.Request, "Sec-Fetch-Site", "same-origin");
            var tipoForm = typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection");
            var form = (System.Collections.Specialized.NameValueCollection)Activator.CreateInstance(tipoForm, true);
            foreach (var c in campos) form.Add(c[0], c[1]);
            typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(ctx.Request, form);
            try { new AdminIniciativasValidar().ProcessRequest(ctx); }
            catch (Exception ex) { sw.Write("EXCEPCION " + ex.GetType().Name); }
            st = ctx.Response.StatusCode;
            HttpContext.Current = null;
            return sw.ToString();
        };
        Func<string, string, string, string[][]> fc = delegate (string accion, string numero, string motivo)
        {
            var l = new List<string[]> { new[] { "accion", accion }, new[] { "numero", numero }, new[] { "motivo", motivo },
                                         new[] { "usuario", ADM }, new[] { "solicitante_cuenta", ADM } };
            return l.ToArray();
        };
        Func<string> hechas = delegate { return string.Join(",", cancX.Llamadas.ToArray()); };
        cuerpo = postValidar("", fc("cancelar", "3", "m"));
        Check("X1 anonimo no cancela: 403, nada se toca", "403|", st + "|" + hechas());
        cuerpo = postValidar(VIEWER, fc("cancelar", "3", "m"));
        Check("X2 VIEWER sin PO/SO no cancela: 403", "403|", st + "|" + hechas());
        cuerpo = postValidar(POSO, fc("cancelar", "#0000003", "  Ya no la necesito  "));
        Check("X3 PO/SO cancela la suya: 200, SU cuenta (lo del formulario se ignora), motivo recortado",
              "200|True|3|" + POSO + "|Ya no la necesito", st + "|" + Campo(Json(cuerpo), "cancelada") + "|" + hechas());
        cancX.Llamadas.Clear();
        cuerpo = postValidar(MOD, fc("cancelar", "5", "m"));
        Check("X4 MOD tambien (ExigirSolicitud): 200 con su cuenta", "200|5|" + MOD + "|m", st + "|" + hechas());
        cancX.Llamadas.Clear();
        cuerpo = postValidar(POSO, fc("cancelar", "3", " "));
        Check("X5 motivo vacio: 422 FaltaMotivoCancelacion, nada se toca", "422|FaltaMotivoCancelacion|", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + hechas());
        cuerpo = postValidar(POSO, fc("cancelar", "3", new string('m', 2001)));
        Check("X6 motivo de 2001: 422 MotivoCancelacionLargo", "422|MotivoCancelacionLargo|", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + hechas());
        cuerpo = postValidar(POSO, fc("cancelar", "abc", "m"));
        Check("X7 numero invalido: 400", "400|", st + "|" + hechas());
        cuerpo = postValidar(POSO, fc("borrar", "3", "m"));
        Check("X8 accion desconocida: 400, nada se toca", "400|AccionDesconocida|", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + hechas());
        cancX.Hay = false;
        cuerpo = postValidar(POSO, fc("cancelar", "3", "m"));
        Check("X9 sin sql/42: 501 CancelacionNoHabilitada", "501|CancelacionNoHabilitada|", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + hechas());
        var modificar = new[] { new[] { "reemplaza_a", "3" }, new[] { "motivo_cancelacion", "m" }, new[] { "tipo", "ADO" } };
        cuerpo = postValidar(POSO, modificar);
        Check("X9b sin sql/42 modificar: 501 antes de validar o guardar", "501|CancelacionNoHabilitada", st + "|" + Campo(Json(cuerpo), "tipo"));
        cancX.Hay = true;
        cancX.Lanza = new ErrorSolicitud(51411, "La solicitud no existe.");
        cuerpo = postValidar(POSO, fc("cancelar", "5", "m"));
        Check("X10 de otra cuenta (51411): 404 SolicitudNoExiste, sin decir de quien es", "404|SolicitudNoExiste|False", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + Campo(Json(cuerpo), "cancelada"));
        lector.Llamadas.Clear();
        lector.Todas.Add(Fila(30, POSO, "APROBADA"));
        cancX.Lanza = new ErrorSolicitud(51421, "ya no");
        cuerpo = postValidar(POSO, fc("cancelar", "30", "m"));
        Check("X11 ADM la aprobo antes (51421, carrera): 409 que dice como quedo, leida DENTRO de la cuenta",
              "409|SolicitudNoPendiente|APROBADA|True|detalle:30:" + POSO,
              st + "|" + Campo(Json(cuerpo), "tipo") + "|" + Campo(Json(cuerpo), "estado_actual") + "|" +
              (Convert.ToString(Campo(Json(cuerpo), "error")).IndexOf("aprob", StringComparison.Ordinal) > 0) + "|" + string.Join(",", lector.Llamadas.ToArray()));
        cancX.Lanza = new TimeoutException("t");
        cuerpo = postValidar(POSO, fc("cancelar", "3", "m"));
        Check("X12 tiempo agotado: 500 CancelacionNoConfirmada, cancelada null", "500|CancelacionNoConfirmada|", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + (Json(cuerpo).ContainsKey("cancelada") && Json(cuerpo)["cancelada"] == null ? "" : "no-null"));
        cancX.Lanza = null; cancX.Llamadas.Clear();
        // Modificar: lo que se revisa ANTES del servicio (motivo, numero).
        cuerpo = postValidar(POSO, new[] { new[] { "reemplaza_a", "3" }, new[] { "motivo_cancelacion", "" } });
        Check("X13 modificar sin motivo: 422 en motivo_cancelacion, nada se guarda", "422|True|0",
              st + "|" + cuerpo.Contains("\"campo\":\"motivo_cancelacion\"") + "|" + cancX.Reemplazos);
        cuerpo = postValidar(POSO, new[] { new[] { "reemplaza_a", "x" }, new[] { "motivo_cancelacion", "m" } });
        Check("X14 modificar con numero invalido: 400 SinSolicitud", "400|SinSolicitud", st + "|" + Campo(Json(cuerpo), "tipo"));
        // Detalle de Mis solicitudes: puede_cancelar (solo pantalla).
        foreach (var f in lector.Todas) f["cancelacion_disponible"] = true;
        cuerpo = Mias("accion=detalle&numero=3", POSO, out st);
        Check("X15 detalle de una suya ENVIADA con sql/42: es_propia y puede_cancelar", "200|True|True", st + "|" + Campo(Json(cuerpo), "es_propia") + "|" + Campo(Json(cuerpo), "puede_cancelar"));
        cuerpo = Mias("accion=detalle&numero=30", POSO, out st);
        Check("X16 detalle de una suya APROBADA: no se puede cancelar", "200|False", st + "|" + Campo(Json(cuerpo), "puede_cancelar"));
        foreach (var f in lector.Todas) f["cancelacion_disponible"] = false;
        cuerpo = Mias("accion=detalle&numero=3", POSO, out st);
        Check("X17 sin sql/42: puede_cancelar false", "False", Campo(Json(cuerpo), "puede_cancelar"));
        lector.Todas.Add(Fila(31, POSO, "CANCELADA"));
        cuerpo = Mias("accion=listar&estado=CANCELADA", POSO, out st);
        Check("X18 filtro CANCELADA (dentro de la cuenta): 200 solo la suya", "200|31", st + "|" + Numeros(cuerpo));
        cuerpo = Mias("accion=listar", POSO, out st);
        Check("X19 Todas incluye la CANCELADA", true, (Array.IndexOf(Numeros(cuerpo).Split(','), "31") >= 0));
        cuerpo = Mias("accion=listar&estado=ENVIADA", POSO, out st);
        Check("X20 Pendientes NO incluye la CANCELADA", false, (Array.IndexOf(Numeros(cuerpo).Split(','), "31") >= 0));
        lector.Todas.Add(Fila(32, MOD, "CANCELADA"));
        cuerpo = Mias("accion=listar&estado=CANCELADA", POSO, out st);
        Check("X21 la CANCELADA de otra cuenta no aparece", "31", Numeros(cuerpo));
        var srcMias = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_mis_solicitudes.ashx"));
        Check("X22 Mis solicitudes sigue sin escribir (cancelar va por validar)", "False|False", srcMias.Contains("Cancelar(") + "|" + srcMias.Contains("Cancelaciones"));

        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }
}

sealed class LectorAdmFalso : ILectorSolicitudesIniciativa
{
    public int Llamadas;
    public bool Disponible() { Llamadas++; return true; }
    public LecturaSolicitudesIniciativa Listar(int maximo, string estado) { Llamadas++; return new LecturaSolicitudesIniciativa(); }
    public Dictionary<string, object> Detalle(int numero) { Llamadas++; return null; }
}
