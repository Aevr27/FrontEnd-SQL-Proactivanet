// Prueba de humo SIN SQL de handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx
// y App_Code/RevisionSolicitudesIniciativa.cs (aprobar / rechazar una Nueva
// solicitud, sql/31) con un revisor y roles falsos. La base de verdad se
// prueba en RevisionSolicitudesIniciativaSqlLocalDbSmoke.
//
//   A  acceso: anonimo, VIEWER, MOD, ADM+MOD y el solicitante del
//      interruptor reciben 403 y el revisor ni se toca; ADM entra.
//   V  validacion antes de la base: GET 405, accion desconocida 400, numero
//      invalido 400, rechazo sin motivo (o en blanco) 422, comentario de mas
//      de 2000 422; aprobar sin comentario si.
//   I  quien revisa: la cuenta Windows del servidor; revisor / usuario /
//      rol del formulario o la URL no cuentan.
//   D  sin sql/31: 501 sin revisar; la base falla al detectar: 500 sin revisar.
//   E  errores de la base: 51411 404, 51412 409 (con aprobada=false), 51413
//      422; otra falla al revisar: 500 con aprobada=null (no se sabe).
//   K  200: aprobada / rechazada true, estado, revisor y fecha UTC.
//   S  separado: el GET sigue sin aceptar POST; el fuente no usa nada de
//      Cambios ni del interruptor; ExigirAdm va primero.
//
// Compilar y correr desde la raiz del repo (como SolicitudesCambioHttpSmoke):
//   csc /out:RevisionSolicitudesIniciativaHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\RevisionSolicitudesIniciativaHttpSmoke.cs
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class RolesRevisionFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesRevisionFalsos Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class InterruptorRevisionFalso : IFuenteInterruptores
{
    public bool? Encendido(string clave) { return true; }
}

sealed class RevisorFalso : IRevisorSolicitudesIniciativa
{
    public bool Hay = true;
    public Exception LanzaDisponible, Lanza;
    public readonly List<string> Llamadas = new List<string>();
    public string UltimoRevisor, UltimoComentario = "(sin llamar)";
    public static readonly DateTime Fecha = new DateTime(2026, 10, 23, 17, 5, 9, DateTimeKind.Utc);

    public bool Disponible()
    {
        Llamadas.Add("disponible");
        if (LanzaDisponible != null) throw LanzaDisponible;
        return Hay;
    }
    public DateTime Aprobar(int numero, string revisor, string comentario) { return Hacer("aprobar", numero, revisor, comentario); }
    public DateTime Rechazar(int numero, string revisor, string comentario) { return Hacer("rechazar", numero, revisor, comentario); }
    DateTime Hacer(string accion, int numero, string revisor, string comentario)
    {
        Llamadas.Add(accion + ":" + numero);
        UltimoRevisor = revisor;
        UltimoComentario = comentario;
        if (Lanza != null) throw Lanza;
        return Fecha;
    }
}

public static class RevisionSolicitudesIniciativaHttpSmoke
{
    static int fallos = 0, pasados = 0;
    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    const string ADM = @"SORIANA\t_adm";
    const string MOD = @"SORIANA\t_mod";
    const string AMBOS = @"SORIANA\t_ambos";
    const string VIEWER = @"SORIANA\t_nadie";

    static string Correr(IHttpHandler h, string archivo, string metodo, string query, string cuenta, string[][] campos, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest(archivo, "http://localhost/handlers/" + archivo, query ?? ""), new HttpResponse(sw));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        var req = ctx.Request;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, metodo);
        if (campos != null)
        {
            var tipoForm = typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection");
            var form = (NameValueCollection)Activator.CreateInstance(tipoForm, true);
            foreach (var c in campos) form.Add(c[0], c[1]);
            typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, form);
        }
        h.ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static string Revisar(string metodo, string query, string cuenta, string[][] campos, out int estado)
    {
        return Correr(new AdminIniciativasSolicitudesNuevasRevision(), "admin_iniciativas_solicitudes_nuevas_revision.ashx",
                      metodo, query, cuenta, campos, out estado);
    }

    static string[][] F(params string[] kv)
    {
        var l = new List<string[]>();
        for (var i = 0; i < kv.Length; i += 2) l.Add(new[] { kv[i], kv[i + 1] });
        return l.ToArray();
    }

    static Dictionary<string, object> Json(string s)
    {
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s); }
        catch { return new Dictionary<string, object>(); }
    }
    static object Campo(Dictionary<string, object> j, string k) { object v; return j.TryGetValue(k, out v) ? (v ?? "null") : "(falta)"; }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesRevisionFalsos().Con(ADM, "ADM").Con(MOD, "MOD").Con(AMBOS, "ADM", "MOD");
        AccesoIniciativas.Fuente = new InterruptorRevisionFalso();   // el interruptor ENCENDIDO no abre la revision
        var rev = new RevisorFalso();
        RevisionSolicitudesIniciativa.Revisor = rev;
        int st;
        string cuerpo;
        Dictionary<string, object> j;

        // ---------------- A: acceso ----------------
        foreach (var c in new[] { new[] { "anonimo", "" }, new[] { "VIEWER / solicitante (interruptor encendido)", VIEWER },
                                  new[] { "MOD", MOD }, new[] { "ADM+MOD (es MOD)", AMBOS } })
            foreach (var a in new[] { "aprobar", "rechazar" })
            {
                rev.Llamadas.Clear();
                cuerpo = Revisar("POST", "accion=" + a, c[1], F("numero", "1", "comentario", "x"), out st);
                Check("A1 " + c[0] + " " + a + ": 403 sin tocar el revisor", "403|0", st + "|" + rev.Llamadas.Count);
            }
        rev.Llamadas.Clear();
        cuerpo = Revisar("POST", "accion=aprobar", null, F("numero", "1"), out st);
        Check("A1 sin usuario: 403", "403|0", st + "|" + rev.Llamadas.Count);
        cuerpo = Revisar("POST", "accion=aprobar", MOD, F("numero", "1"), out st);
        Check("A2 MOD: RolInsuficiente con el mensaje de la revision", "RolInsuficiente|" + RevisionSolicitudesIniciativa.MensajeSoloAdm,
              Campo(Json(cuerpo), "tipo") + "|" + Campo(Json(cuerpo), "error"));
        cuerpo = Revisar("POST", "accion=aprobar&rol=ADM", VIEWER, F("numero", "1", "rol", "ADM"), out st);
        Check("A3 rol=ADM en URL o formulario no abre nada", 403, st);
        Check("A4 no es ruta del interruptor; el modulo de acceso si la protege", "False|True",
              AccesoIniciativas.EsRutaSolicitante("~/handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx") + "|" +
              AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx"));

        // ---------------- V: validacion antes de la base ----------------
        foreach (var m in new[] { "GET", "PUT", "DELETE" })
        {
            rev.Llamadas.Clear();
            cuerpo = Revisar(m, "accion=aprobar", ADM, F("numero", "1"), out st);
            Check("V1 " + m + ": 405 sin revisar", "405|0", st + "|" + rev.Llamadas.Count);
        }
        foreach (var a in new[] { "", "aplicar", "borrar", "reabrir", "estado", "listar" })
        {
            rev.Llamadas.Clear();
            cuerpo = Revisar("POST", "accion=" + a, ADM, F("numero", "1", "comentario", "x"), out st);
            Check("V2 accion '" + a + "': 400 AccionDesconocida", "400|AccionDesconocida|0", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + rev.Llamadas.Count);
        }
        foreach (var n in new[] { "", "0", "-1", "abc", "1.5", "10000000" })
        {
            rev.Llamadas.Clear();
            cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", n), out st);
            Check("V3 numero '" + n + "': 400 SinSolicitud sin revisar", "400|SinSolicitud|0", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + rev.Llamadas.Count);
        }
        rev.Llamadas.Clear();
        cuerpo = Revisar("POST", "accion=aprobar&numero=5", ADM, F("comentario", "x"), out st);
        Check("V3 el numero va en el formulario, no en la URL", "400|0", st + "|" + rev.Llamadas.Count);
        foreach (var c in new[] { null, "", "   ", "\r\n\t" })
        {
            rev.Llamadas.Clear();
            cuerpo = Revisar("POST", "accion=rechazar", ADM, c == null ? F("numero", "3") : F("numero", "3", "comentario", c), out st);
            Check("V4 rechazar sin motivo (" + (c == null ? "ausente" : "'" + c.Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t") + "'") + "): 422 FaltaMotivo sin revisar",
                  "422|FaltaMotivo|0", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + rev.Llamadas.Count);
        }
        foreach (var a in new[] { "aprobar", "rechazar" })
        {
            rev.Llamadas.Clear();
            cuerpo = Revisar("POST", "accion=" + a, ADM, F("numero", "3", "comentario", new string('x', 2001)), out st);
            Check("V5 " + a + " con 2001 caracteres: 422 ComentarioLargo", "422|ComentarioLargo|0", st + "|" + Campo(Json(cuerpo), "tipo") + "|" + rev.Llamadas.Count);
        }
        rev.Llamadas.Clear();
        cuerpo = Revisar("POST", "accion=rechazar", ADM, F("numero", "3", "comentario", new string('x', 2000)), out st);
        Check("V5 2000 caracteres si caben", "200|rechazar:3", st + "|" + rev.Llamadas.Last());
        rev.Llamadas.Clear();
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "#0000004"), out st);
        Check("V6 aprobar sin comentario: se aprueba con comentario NULL", "200|aprobar:4|True", st + "|" + rev.Llamadas.Last() + "|" + (rev.UltimoComentario == null));
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "4", "comentario", "   "), out st);
        Check("V6 comentario en blanco al aprobar = sin comentario", true, rev.UltimoComentario == null);
        cuerpo = Revisar("POST", "accion=rechazar", ADM, F("numero", "4", "comentario", "  falta el RCA  "), out st);
        Check("V7 el motivo llega recortado", "falta el RCA", rev.UltimoComentario);

        // ---------------- I: quien revisa ----------------
        cuerpo = Revisar("POST", "accion=aprobar&revisor=SORIANA%5Cjefe&usuario=SORIANA%5Cjefe", ADM,
                         F("numero", "6", "revisor", @"SORIANA\jefe", "usuario", @"SORIANA\jefe", "revisado_por", @"SORIANA\jefe"), out st);
        j = Json(cuerpo);
        Check("I1 el revisor es la cuenta Windows del servidor, no la del formulario", ADM + "|" + ADM, rev.UltimoRevisor + "|" + Campo(j, "revisado_por"));

        // ---------------- D: sin sql/31 / la base falla ----------------
        var sin = new RevisorFalso { Hay = false };
        RevisionSolicitudesIniciativa.Revisor = sin;
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "1"), out st);
        Check("D1 sin sql/31: 501 RevisionNoDisponible, no revisa", "501|RevisionNoDisponible|disponible",
              st + "|" + Campo(Json(cuerpo), "tipo") + "|" + string.Join(",", sin.Llamadas.ToArray()));
        var caida = new RevisorFalso { LanzaDisponible = new InvalidOperationException("conexion rechazada") };
        RevisionSolicitudesIniciativa.Revisor = caida;
        cuerpo = Revisar("POST", "accion=rechazar", ADM, F("numero", "1", "comentario", "x"), out st);
        Check("D2 la base falla al detectar: 500, no revisa", "500|disponible", st + "|" + string.Join(",", caida.Llamadas.ToArray()));

        // ---------------- E: errores de la base ----------------
        foreach (var caso in new[] { new object[] { 51411, 404, "SolicitudNoExiste" }, new object[] { 51412, 409, "YaRevisada" },
                                     new object[] { 51413, 422, "FaltaMotivo" }, new object[] { 51410, 400, "SinRevisor" } })
            foreach (var a in new[] { "aprobar", "rechazar" })
            {
                var r = new RevisorFalso { Lanza = new ErrorRevisionSolicitudIniciativa((int)caso[0], "msg " + caso[0]) };
                RevisionSolicitudesIniciativa.Revisor = r;
                cuerpo = Revisar("POST", "accion=" + a, ADM, F("numero", "2", "comentario", "x"), out st);
                j = Json(cuerpo);
                var llave = a == "aprobar" ? "aprobada" : "rechazada";
                Check("E1 " + caso[0] + " al " + a + ": " + caso[1] + " " + caso[2] + " con " + llave + "=false",
                      caso[1] + "|" + caso[2] + "|False|msg " + caso[0] + "|" + caso[0],
                      st + "|" + Campo(j, "tipo") + "|" + Campo(j, llave) + "|" + Campo(j, "error") + "|" + Campo(j, "numero_error"));
            }
        foreach (var a in new[] { "aprobar", "rechazar" })
        {
            RevisionSolicitudesIniciativa.Revisor = new RevisorFalso { Lanza = new TimeoutException("se corto") };
            cuerpo = Revisar("POST", "accion=" + a, ADM, F("numero", "2", "comentario", "x"), out st);
            j = Json(cuerpo);
            var llave = a == "aprobar" ? "aprobada" : "rechazada";
            Check("E2 otra falla al " + a + ": 500 RevisionNoConfirmada con " + llave + "=null (no se sabe)", "500|RevisionNoConfirmada|null",
                  st + "|" + Campo(j, "tipo") + "|" + Campo(j, llave));
        }

        // ---------------- K: 200 ----------------
        var ok = new RevisorFalso();
        RevisionSolicitudesIniciativa.Revisor = ok;
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "142", "comentario", "va"), out st);
        j = Json(cuerpo);
        Check("K1 aprobada: estado, numero, revisor y fecha UTC", "200|True|APROBADA|142|" + ADM + "|2026-10-23T17:05:09Z|aprobar:142",
              st + "|" + Campo(j, "aprobada") + "|" + Campo(j, "estado") + "|" + Campo(j, "numero") + "|" + Campo(j, "revisado_por") + "|" +
              Campo(j, "fecha_revision_utc") + "|" + ok.Llamadas.Last());
        cuerpo = Revisar("POST", "accion=rechazar", ADM, F("numero", "143", "comentario", "no procede"), out st);
        j = Json(cuerpo);
        Check("K2 rechazada", "200|True|RECHAZADA|rechazar:143|no procede",
              st + "|" + Campo(j, "rechazada") + "|" + Campo(j, "estado") + "|" + ok.Llamadas.Last() + "|" + ok.UltimoComentario);

        // ---------------- S: separado ----------------
        cuerpo = Correr(new AdminIniciativasSolicitudesNuevas(), "admin_iniciativas_solicitudes_nuevas.ashx",
                        "POST", "accion=aprobar", ADM, F("numero", "1"), out st);
        Check("S1 el GET de la lista sigue de solo lectura: POST 405", 405, st);
        cuerpo = Correr(new AdminIniciativasSolicitudesNuevas(), "admin_iniciativas_solicitudes_nuevas.ashx",
                        "GET", "accion=aprobar&numero=1", ADM, null, out st);
        Check("S1 ... y GET accion=aprobar: 400", 400, st);
        var hnd = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes_nuevas_revision.ashx"));
        var proceso = hnd.Substring(hnd.IndexOf("public void ProcessRequest", StringComparison.Ordinal));
        var cls = File.ReadAllText(Path.Combine("App_Code", "RevisionSolicitudesIniciativa.cs"));
        var codigoCls = cls.Substring(cls.IndexOf("using System;", StringComparison.Ordinal));
        Check("S2 ExigirAdm es lo primero del handler", true,
              proceso.IndexOf("AccesoAdmin.ExigirAdm(context", StringComparison.Ordinal) > 0 &&
              proceso.IndexOf("AccesoAdmin.ExigirAdm(context", StringComparison.Ordinal) < proceso.IndexOf("DashboardHandler.Responder", StringComparison.Ordinal));
        Check("S3 no usa nada de Cambios (sql/22) ni del interruptor", "False|False|False|False",
              (proceso.Contains("SolicitudCambio") || codigoCls.Contains("SolicitudCambio")) + "|" +
              (proceso.Contains("SolicitudesCambio") || codigoCls.Contains("SolicitudesCambio")) + "|" +
              (hnd.Contains("admin_iniciativas_solicitudes.ashx") || codigoCls.Contains("admin_iniciativas_solicitudes.ashx")) + "|" +
              hnd.Contains("AccesoIniciativas"));
        Check("S4 solo llama a los dos procedimientos de sql/31", "True|True|False",
              codigoCls.Contains("\"adm.usp_SolicitudIniciativa_Aprobar\"") + "|" + codigoCls.Contains("\"adm.usp_SolicitudIniciativa_Rechazar\"") + "|" +
              (codigoCls.Contains("usp_SolicitudCambio") || codigoCls.Contains("usp_GestionAdmin") || codigoCls.Contains("INSERT ") || codigoCls.Contains("UPDATE ")));
        var cambio = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes.ashx"));
        Check("S5 'Cambios' no conoce la revision nueva", "False|False",
              cambio.Contains("RevisionSolicitudesIniciativa") + "|" + cambio.Contains("solicitudes_nuevas_revision"));

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
