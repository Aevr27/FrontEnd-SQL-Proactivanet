// Prueba de humo SIN SQL de handlers/admin_iniciativas_mis_cambios.ashx
// ("Mis solicitudes de cambio" de la pestana Solicitudes, 2026-11-04), con
// roles, duenos, lector y almacen falsos.
//
//   A  acceso: anonimo y VIEWER sin PO/SO: 403 sin tocar el lector. ADM, MOD
//      (sea o no PO/SO) y PO/SO sin rol entran: la MISMA regla que "Mis
//      solicitudes" de iniciativa (admin_sesion "solicitante").
//   M  el modulo (URL directa): la ruta es del solicitante; la cola de ADM
//      (listar / detalle / aplicar / rechazar) sigue siendo solo de ADM.
//   C  de quien: siempre la cuenta de IIS (SolicitadoPor); ?cuenta= /
//      ?usuario= / ?solicitado_por= no cambian nada; el detalle de otra
//      cuenta es 404. Una PSO sigue siendo de quien la envio aunque hoy el
//      folio tenga otro PO / SO (el lector no recibe duenos).
//   E  filtro Estado: PENDIENTE / APLICADA / RECHAZADA / todas, dentro de la
//      cuenta; desconocido 400 sin leer.
//   S  lo de ADM no sale: sin intentos / ultimo_error / su fecha; el evento
//      FALLO_APLICAR se ve sin su detalle; el comentario de rechazo si.
//   L  sin sql/22 501; POST 405; accion desconocida 400; id invalido 400;
//      solo lectura (el fuente no escribe ni llama al almacen de ADM).
//
// Compilar y correr desde la raiz del repo (como MisSolicitudesIniciativaHttpSmoke):
//   csc /out:MisSolicitudesCambioHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\MisSolicitudesCambioHttpSmoke.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class RolesMisCambiosFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesMisCambiosFalsos Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class DuenosMisCambiosFalsos : IFuenteDuenosVigentes
{
    public readonly List<PersonaCatalogo> Personas = new List<PersonaCatalogo>();
    public readonly List<DirectorioOrganizacional.Dueno> Filas = new List<DirectorioOrganizacional.Dueno>();
    public DuenosMisCambiosFalsos Persona(string nombre, string correo) { Personas.Add(new PersonaCatalogo { Nombre = nombre, Correo = correo }); return this; }
    public DuenosMisCambiosFalsos Fila(string po, string so)
    {
        Filas.Add(new DirectorioOrganizacional.Dueno { CategoriaN2 = "/A/B", C1 = "/A", Po = po, So = so, Director = "Dir", Vigente = true });
        return this;
    }
    public DuenosVigentes Leer()
    {
        return new DuenosVigentes { Personas = new List<PersonaCatalogo>(Personas), Directorio = new DirectorioOrganizacional(new List<DirectorioOrganizacional.Dueno>(Filas), new Dictionary<string, string>()) };
    }
}

// Guarda solicitudes por cuenta y solo devuelve las de la cuenta pedida,
// como el filtro SQL (sin distinguir mayusculas). Copia cada fila: el
// handler puede quitarle campos sin tocar las de aqui.
sealed class LectorMisCambiosFalso : ILectorMisSolicitudesCambio
{
    public readonly List<Dictionary<string, object>> Todas = new List<Dictionary<string, object>>();
    public readonly List<string> Llamadas = new List<string>();

    static Dictionary<string, object> Copia(Dictionary<string, object> s)
    {
        var d = new Dictionary<string, object>(s);
        object ev;
        if (d.TryGetValue("eventos", out ev))
        {
            var l = new List<object>();
            foreach (Dictionary<string, object> e in (List<object>)ev) l.Add(new Dictionary<string, object>(e));
            d["eventos"] = l;
        }
        return d;
    }

    public List<Dictionary<string, object>> ListarDe(string cuenta, string estado, int maximo)
    {
        Llamadas.Add("listar:" + cuenta + (estado == null ? "" : ":" + estado));
        var l = new List<Dictionary<string, object>>();
        foreach (var s in Todas)
            if (string.Equals((string)s["solicitado_por"], cuenta, StringComparison.OrdinalIgnoreCase)
                && (estado == null || (string)s["estado"] == estado)) l.Add(Copia(s));
        return l;
    }

    public Dictionary<string, object> DetalleDe(int id, string cuenta)
    {
        Llamadas.Add("detalle:" + id + ":" + cuenta);
        foreach (var s in Todas)
            if ((int)s["id"] == id && string.Equals((string)s["solicitado_por"], cuenta, StringComparison.OrdinalIgnoreCase))
                return Copia(s);
        return null;
    }
}

// La cola de ADM: si alguien que no es ADM llegara a leerla o escribirla, se nota.
sealed class AlmacenAdmFalso : IAlmacenSolicitudesCambio
{
    public int Llamadas;
    public ResultadoEnvioSolicitud Enviar(PeticionSolicitudCambio p, string usuario, string rol) { Llamadas++; return new ResultadoEnvioSolicitud(); }
    public List<Dictionary<string, object>> Listar(string estado, int maximo) { Llamadas++; return new List<Dictionary<string, object>>(); }
    public Dictionary<string, object> Detalle(int idSolicitud) { Llamadas++; return null; }
    public void Rechazar(int idSolicitud, string revisor, string comentario) { Llamadas++; }
    public void Aplicar(int idSolicitud, string revisor, string comentario, List<ClasificacionSolicitud> c, DateTime hoy) { Llamadas++; }
    public void RegistrarFallo(int idSolicitud, string revisor, int numero, string mensaje) { Llamadas++; }
}

public static class MisSolicitudesCambioHttpSmoke
{
    static int fallos = 0, pasados = 0;

    static void CabeceraNavegador(HttpRequest req, string nombre, string valor)
    {
        var h = req.Headers;
        var t = typeof(System.Collections.Specialized.NameObjectCollectionBase);
        var f = BindingFlags.NonPublic | BindingFlags.Instance;
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
        return Correr(new AdminIniciativasMisCambios(), "admin_iniciativas_mis_cambios.ashx", metodo, query, cuenta, out estado);
    }

    static string Modulo(string ruta, string cuenta, string query = null)
    {
        var sw = new StringWriter();
        var ctx = Contexto("x", query, cuenta, sw);
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

    static Dictionary<string, object> Fila(int id, string cuenta, string estado, string rol = "PSO")
    {
        return new Dictionary<string, object>
        {
            { "id", id }, { "folio", "PRB-" + id }, { "titulo", "Cambio " + id }, { "tipo", "FECHA" }, { "estado", estado },
            { "solicitado_por", cuenta }, { "rol_solicitante", rol }, { "motivo", "m" },
            { "revisado_por", estado == "PENDIENTE" ? null : ADM },
            { "comentario_revision", estado == "RECHAZADA" ? "No procede" : null },
            { "intentos", 2 }, { "ultimo_error", "SECRETO error interno" }, { "fecha_ultimo_intento_utc", "2026-11-04T10:00:00Z" },
            { "sin_clasificar", 0 },
            { "eventos", new List<object>
                {
                    new Dictionary<string, object> { { "id", 1 }, { "evento", "ENVIADA" }, { "usuario", cuenta }, { "detalle", "Rol " + rol } },
                    new Dictionary<string, object> { { "id", 2 }, { "evento", "FALLO_APLICAR" }, { "usuario", ADM }, { "detalle", "SECRETO 51204" } },
                } },
        };
    }

    static string Ids(string cuerpo)
    {
        var filas = Campo(Json(cuerpo), "solicitudes") as System.Collections.ArrayList;
        if (filas == null) return "(sin lista)";
        var r = new List<string>();
        foreach (Dictionary<string, object> f in filas) r.Add(Convert.ToString(f["id"]));
        return string.Join(",", r.ToArray());
    }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesMisCambiosFalsos().Con(ADM, "ADM").Con(MOD, "MOD").Con(MODPO, "MOD");
        AccesoIniciativas.FuenteDuenos = new DuenosMisCambiosFalsos()
            .Persona("Juan Perez", "juanperez@soriana.com")
            .Persona("Mod Po", "t_modpo@soriana.com")
            .Persona("Mod Uno", "t_mod@soriana.com")
            .Persona("Nadie", "t_nadie@soriana.com")
            .Fila("Juan Perez", "Mod Po");
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = true;
        var lector = new LectorMisCambiosFalso();
        lector.Todas.Add(Fila(30, POSO, "PENDIENTE"));
        lector.Todas.Add(Fila(20, MODPO, "PENDIENTE", "MOD"));
        lector.Todas.Add(Fila(10, POSO.ToUpperInvariant(), "APLICADA"));
        lector.Todas.Add(Fila(11, POSO, "RECHAZADA"));
        lector.Todas.Add(Fila(90, ADM, "PENDIENTE", "ADM"));
        lector.Todas.Add(Fila(50, MOD, "PENDIENTE", "MOD"));
        lector.Todas.Add(Fila(51, MOD, "APLICADA", "MOD"));
        SolicitudesCambio.Mias = lector;
        var adm = new AlmacenAdmFalso();
        SolicitudesCambio.Almacen = adm;
        int st;
        string cuerpo;

        // ---------------- A: acceso ----------------
        foreach (var c in new[] { new[] { "anonimo", "" }, new[] { "VIEWER sin PO/SO", VIEWER } })
            foreach (var q in new[] { "accion=listar", "accion=listar&estado=PENDIENTE", "accion=detalle&id=30" })
            {
                lector.Llamadas.Clear();
                cuerpo = Mias(q, c[1], out st);
                Check("A1 " + c[0] + " " + q + ": 403 sin tocar el lector", "403|AccesoDenegado|0|False",
                      st + "|" + Campo(Json(cuerpo), "tipo") + "|" + lector.Llamadas.Count + "|" + cuerpo.Contains("Cambio"));
            }
        lector.Llamadas.Clear();
        Mias("accion=listar", null, out st);
        Check("A1 sin usuario: 403 sin tocar el lector", "403|0", st + "|" + lector.Llamadas.Count);
        foreach (var c in new[] { new[] { "ADM", ADM }, new[] { "MOD", MOD }, new[] { "MOD PO/SO", MODPO }, new[] { "PO/SO sin rol", POSO } })
        {
            Mias("accion=listar", c[1], out st);
            Check("A2 " + c[0] + ": 200", 200, st);
        }
        foreach (var c in new[] { "", VIEWER, MOD, ADM, MODPO, POSO })
        {
            Mias("accion=listar", c, out st);
            Check("A3 " + (c.Length == 0 ? "anonimo" : c) + ": entra = solicitante de admin_sesion", Solicitante(c), st == 200);
        }

        // ---------------- M: modulo y cola de ADM ----------------
        const string R = "~/handlers/admin_iniciativas_mis_cambios.ashx";
        foreach (var c in new[] { new[] { "VIEWER", VIEWER, "403" }, new[] { "anonimo", "", "403" },
                                  new[] { "PO/SO sin rol", POSO, "pasa" }, new[] { "MOD sin PO/SO", MOD, "pasa" }, new[] { "ADM", ADM, "pasa" } })
            Check("M1 modulo: Mis cambios, " + c[0], c[2], Modulo(R, c[1]));
        Check("M1 ... es ruta del solicitante y protegida", "True|True",
              AccesoIniciativas.EsRutaSolicitante(R) + "|" + AccesoAdmin.EsRutaProtegida(R));
        foreach (var c in new[] { new[] { "PO/SO sin rol", POSO }, new[] { "MOD", MOD }, new[] { "MOD PO/SO", MODPO } })
            foreach (var q in new[] { "accion=listar", "accion=listar&estado=PENDIENTE", "accion=detalle&id=30" })
            {
                adm.Llamadas = 0;
                Correr(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx", "GET", q, c[1], out st);
                Check("M2 " + c[0] + ": cola de ADM " + q + " sigue 403", "403|0", st + "|" + adm.Llamadas);
            }
        foreach (var c in new[] { new[] { "PO/SO sin rol", POSO }, new[] { "MOD", MOD } })
            foreach (var q in new[] { "accion=aplicar", "accion=rechazar" })
            {
                adm.Llamadas = 0;
                Correr(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx", "POST", q + "&id=30", c[1], out st);
                Check("M3 " + c[0] + ": " + q + " sigue 403 (sin permiso nuevo de revision)", "403|0", st + "|" + adm.Llamadas);
            }
        foreach (var q in new[] { "accion=aplicar", "accion=rechazar", "accion=enviar" })
        {
            lector.Llamadas.Clear(); adm.Llamadas = 0;
            Mias(q, POSO, out st);
            Check("M4 Mis cambios no tiene " + q + ": 400 sin leer ni escribir", "400|0|0", st + "|" + lector.Llamadas.Count + "|" + adm.Llamadas);
        }
        adm.Llamadas = 0;
        Correr(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx", "GET", "accion=listar", ADM, out st);
        Check("M5 ADM: la cola completa sigue igual (lee el almacen de ADM)", "200|1", st + "|" + adm.Llamadas);

        // ---------------- C: de quien ----------------
        cuerpo = Mias("accion=listar", POSO, out st);
        Check("C1 PO/SO: solo las suyas (sin distinguir mayusculas)", "200|30,10,11", st + "|" + Ids(cuerpo));
        cuerpo = Mias("accion=listar", MOD, out st);
        Check("C2 MOD: solo las suyas", "50,51", Ids(cuerpo));
        cuerpo = Mias("accion=listar", MODPO, out st);
        Check("C2 MOD PO/SO: solo la suya", "20", Ids(cuerpo));
        cuerpo = Mias("accion=listar", ADM, out st);
        Check("C3 ADM: aqui tambien solo las suyas (las de todos van por la cola)", "90", Ids(cuerpo));
        lector.Llamadas.Clear();
        cuerpo = Mias("accion=listar&cuenta=" + Uri.EscapeDataString(MOD) + "&usuario=" + Uri.EscapeDataString(MOD) + "&solicitado_por=" + Uri.EscapeDataString(MOD), POSO, out st);
        Check("C4 ?cuenta= / ?usuario= / ?solicitado_por= no cambian de quien", "30,10,11|listar:" + POSO,
              Ids(cuerpo) + "|" + lector.Llamadas[lector.Llamadas.Count - 1]);
        foreach (var c in new[] { new[] { "20", POSO }, new[] { "30", MOD }, new[] { "90", POSO }, new[] { "999", POSO } })
        {
            cuerpo = Mias("accion=detalle&id=" + c[0], c[1], out st);
            Check("C5 detalle " + c[0] + " de OTRA cuenta (o inexistente): 404 sin datos", "404|SolicitudNoExiste|False",
                  st + "|" + Campo(Json(cuerpo), "tipo") + "|" + cuerpo.Contains("Cambio"));
        }
        cuerpo = Mias("accion=detalle&id=30", POSO, out st);
        Check("C6 detalle de la suya: 200 con su id y su historial", "200|30|2",
              st + "|" + Campo(Json(cuerpo), "id") + "|" + ((System.Collections.ArrayList)Campo(Json(cuerpo), "eventos")).Count);
        lector.Llamadas.Clear();
        Mias("accion=detalle&id=30", POSO, out st);
        Check("C7 el lector recibe solo id y la cuenta de IIS (nada de duenos de hoy)", "detalle:30:" + POSO, lector.Llamadas[0]);

        // ---------------- E: filtro Estado ----------------
        foreach (var c in new[] { new[] { "PENDIENTE", "30" }, new[] { "APLICADA", "10" }, new[] { "RECHAZADA", "11" }, new[] { "", "30,10,11" } })
        {
            cuerpo = Mias("accion=listar" + (c[0].Length == 0 ? "" : "&estado=" + c[0]), POSO, out st);
            Check("E1 PO/SO estado=" + (c[0].Length == 0 ? "(todas)" : c[0]), "200|" + c[1], st + "|" + Ids(cuerpo));
        }
        cuerpo = Mias("accion=listar&estado=APLICADA", MOD, out st);
        Check("E2 MOD APLICADA: solo la suya", "51", Ids(cuerpo));
        cuerpo = Mias("accion=listar&estado=RECHAZADA", MOD, out st);
        Check("E2 MOD RECHAZADA: ninguna (la 11 es de otra cuenta)", "200|", st + "|" + Ids(cuerpo));
        foreach (var q in new[] { "ENVIADA", "pendiente", "TODAS", "PENDIENTE' OR 1=1--" })
        {
            lector.Llamadas.Clear();
            cuerpo = Mias("accion=listar&estado=" + Uri.EscapeDataString(q), POSO, out st);
            Check("E3 estado desconocido '" + q + "': 400 sin leer", "400|EstadoDesconocido|0", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + lector.Llamadas.Count);
        }

        // ---------------- S: lo de ADM no sale ----------------
        cuerpo = Mias("accion=listar", POSO, out st);
        Check("S1 lista sin intentos / ultimo_error / fecha_ultimo_intento_utc / sin_clasificar", "False|False|False|False",
              cuerpo.Contains("\"intentos\"") + "|" + cuerpo.Contains("ultimo_error") + "|" + cuerpo.Contains("fecha_ultimo_intento_utc") + "|" + cuerpo.Contains("sin_clasificar"));
        Check("S2 nada del error interno en la lista", false, cuerpo.Contains("SECRETO"));
        cuerpo = Mias("accion=detalle&id=11", POSO, out st);
        var det = Json(cuerpo);
        var evs = (System.Collections.ArrayList)Campo(det, "eventos");
        Check("S3 detalle: el evento FALLO_APLICAR se ve, sin su detalle; ENVIADA conserva el suyo", "FALLO_APLICAR||ENVIADA|Rol PSO",
              Campo((Dictionary<string, object>)evs[1], "evento") + "|" + Campo((Dictionary<string, object>)evs[1], "detalle") + "|" +
              Campo((Dictionary<string, object>)evs[0], "evento") + "|" + Campo((Dictionary<string, object>)evs[0], "detalle"));
        Check("S4 detalle: sin SECRETO ni ultimo_error", "False|False", cuerpo.Contains("SECRETO") + "|" + cuerpo.Contains("ultimo_error"));
        Check("S5 detalle: estado, revisor y comentario de rechazo si se ven", "RECHAZADA|" + ADM + "|No procede",
              Campo(det, "estado") + "|" + Campo(det, "revisado_por") + "|" + Campo(det, "comentario_revision"));
        Check("S6 el lector conserva sus filas (el handler quita campos de una copia)", "SECRETO error interno",
              lector.Todas[0]["ultimo_error"]);

        // ---------------- L: respuestas ----------------
        foreach (var q in new[] { "accion=detalle", "accion=detalle&id=abc", "accion=detalle&id=0", "accion=detalle&id=-3" })
        {
            cuerpo = Mias(q, POSO, out st);
            Check("L1 " + q + ": 400 SinSolicitud", "400|SinSolicitud", st + "|" + Campo(Json(cuerpo), "tipo"));
        }
        Mias("accion=borrar", POSO, out st);
        Check("L2 accion desconocida: 400", 400, st);
        Mias("", POSO, out st);
        Check("L2 sin accion: 400", 400, st);
        Mias("accion=listar", POSO, out st, "POST");
        Check("L3 POST: 405", 405, st);
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = false;
        lector.Llamadas.Clear();
        cuerpo = Mias("accion=listar", POSO, out st);
        Check("L4 sin sql/22: 501 PersistenciaNoHabilitada sin leer", "501|PersistenciaNoHabilitada|0", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + lector.Llamadas.Count);
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = true;
        {
            var t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_mis_cambios.ashx"));
            Check("L5 solo lectura: el handler no escribe, no llama procedimientos ni al almacen de ADM", "False|False|False|False|False",
                  t.Contains("ExecuteNonQuery") + "|" + t.Contains("usp_") + "|" + t.Contains("SqlCommand") + "|" +
                  t.Contains("SolicitudesCambio.Almacen") + "|" + t.Contains("AccesoAdmin.ExigirAdm("));
            Check("L6 la cuenta sale de IdentidadEscritura, nunca de la URL ni del formulario", "True|False|False",
                  t.Contains("AccesoAdmin.IdentidadEscritura(context)") + "|" + t.Contains("QueryString[\"cuenta") + "|" + t.Contains("Form["));
            var a = File.ReadAllText(Path.Combine("App_Code", "SolicitudCambioAdmin.cs"));
            Check("L7 el filtro por cuenta es un parametro (@cuenta), nunca texto armado", "True|False",
                  a.Contains("UPPER(s.SolicitadoPor) = UPPER(@cuenta)") + "|" + a.Contains("+ cuenta +"));
        }

        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }
}
