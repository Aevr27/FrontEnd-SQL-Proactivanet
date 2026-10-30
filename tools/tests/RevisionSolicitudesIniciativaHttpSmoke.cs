// Prueba de humo SIN SQL de handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx
// y App_Code/RevisionSolicitudesIniciativa.cs (aprobar / rechazar una Nueva
// solicitud, sql/31) con un revisor y roles falsos. La base de verdad se
// prueba en RevisionSolicitudesIniciativaSqlLocalDbSmoke.
//
//   A  acceso: anonimo, VIEWER (aunque sea solicitante PO/SO), MOD y
//      ADM+MOD reciben 403 y el revisor ni se toca; ADM entra.
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
//   N  sql/32, aprobar CREA la iniciativa: sin sql/32 501 (no aprueba sin
//      crear); Estado inicial obligatorio (ausente 422; "" = sin estado);
//      la peticion de la alta sale de la solicitud GUARDADA (campos del
//      formulario ignorados) con Clasificacion / Agrupacion de
//      TiposPorPrefijo; invalida 422 sin tocar la base; validacion caida
//      503; la alta rechaza (51010...) 409 aprobada=false; 51414 409;
//      ya no ENVIADA: sin validar, el procedimiento contesta (mismo codigo);
//      200 con el codigo DEVUELTO, iniciativa_nueva y faltantes; la vieja
//      _Aprobar ya no se llama.
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

sealed class RevisorFalso : IRevisorSolicitudesIniciativa
{
    public bool Hay = true, Crea = true, Nueva = true;
    public Exception LanzaDisponible, Lanza;
    public readonly List<string> Llamadas = new List<string>();
    public string UltimoRevisor, UltimoComentario = "(sin llamar)", Codigo = "PRB 2026-000042";
    public PlanCrearAdmin UltimoPlan;
    public static readonly DateTime Fecha = new DateTime(2026, 10, 23, 17, 5, 9, DateTimeKind.Utc);

    public bool CreaIniciativa() { Llamadas.Add("crea"); return Crea; }
    public AprobacionConIniciativa AprobarYCrear(int numero, string revisor, string comentario, PlanCrearAdmin plan)
    {
        UltimoPlan = plan;
        Hacer("aprobarycrear", numero, revisor, comentario);
        return new AprobacionConIniciativa { Codigo = Codigo, Nueva = Nueva, RevisadoPor = revisor, FechaRevisionUtc = Fecha };
    }

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

// La solicitud GUARDADA (RegistroSolicitudesIniciativa.Lector).
sealed class LectorRevisionFalso : ILectorSolicitudesIniciativa
{
    public string Estado = "ENVIADA";
    public bool Existe = true;
    public bool Disponible() { return true; }
    public LecturaSolicitudesIniciativa Listar(int maximo, string estado) { return new LecturaSolicitudesIniciativa(); }
    public Dictionary<string, object> Detalle(int numero)
    {
        if (!Existe) return null;
        return new Dictionary<string, object>
        {
            { "numero", numero }, { "estado", Estado }, { "tipo", "PRB" }, { "titulo", "Titulo guardado" },
            { "descripcion", "Desc guardada" }, { "observaciones", "Obs guardadas" }, { "po", "PO guardado" }, { "so", "SO guardado" },
            { "categoria", "/A/Cat 1" }, { "pct", "12.5" }, { "volumetria", 2 }, { "director", "Dir 1" },
            { "rca_extension", "PDF" }, { "solicitante_cuenta", @"SORIANA\otro" },
        };
    }
}

// Como el revisor real cuando el procedimiento no devuelve el Codigo.
sealed class RevisorSinCodigo : IRevisorSolicitudesIniciativa
{
    public bool Disponible() { return true; }
    public bool CreaIniciativa() { return true; }
    public DateTime Aprobar(int numero, string revisor, string comentario) { throw new NotSupportedException(); }
    public DateTime Rechazar(int numero, string revisor, string comentario) { throw new NotSupportedException(); }
    public AprobacionConIniciativa AprobarYCrear(int numero, string revisor, string comentario, PlanCrearAdmin plan)
    {
        throw new InvalidOperationException("adm.usp_SolicitudIniciativa_AprobarYCrear termino sin devolver el Codigo.");
    }
}

public static class RevisionSolicitudesIniciativaHttpSmoke
{
    static PeticionCrearAdmin ultimaPeticion;
    static int validaciones;
    static Exception validacionLanza;
    static string validacionError;
    static ResultadoGestionAdmin Validar(PeticionCrearAdmin p)
    {
        validaciones++;
        ultimaPeticion = p;
        if (validacionLanza != null) throw validacionLanza;
        var r = new ResultadoGestionAdmin { Accion = "crear", CatalogoRevisado = true };
        if (validacionError != null) r.Agregar("po", validacionError);
        r.Falta("rca", "RCA");
        return r;
    }

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
        CabeceraNavegador(req, "Sec-Fetch-Site", "same-origin");
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
        var rev = new RevisorFalso();
        RevisionSolicitudesIniciativa.Revisor = rev;
        var lector = new LectorRevisionFalso();
        RegistroSolicitudesIniciativa.Lector = lector;
        RevisionSolicitudesIniciativa.ValidarAlta = Validar;
        int st;
        string cuerpo;
        Dictionary<string, object> j;

        // ---------------- A: acceso ----------------
        foreach (var c in new[] { new[] { "anonimo", "" }, new[] { "VIEWER / solicitante PO/SO", VIEWER },
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
        Check("A4 no es ruta del solicitante; el modulo de acceso si la protege", "False|True",
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
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "#0000004", "estado", "Cerrado"), out st);
        Check("V6 aprobar sin comentario: se aprueba con comentario NULL", "200|aprobarycrear:4|True", st + "|" + rev.Llamadas.Last() + "|" + (rev.UltimoComentario == null));
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "4", "comentario", "   ", "estado", "Cerrado"), out st);
        Check("V6 comentario en blanco al aprobar = sin comentario", true, rev.UltimoComentario == null);
        cuerpo = Revisar("POST", "accion=rechazar", ADM, F("numero", "4", "comentario", "  falta el RCA  "), out st);
        Check("V7 el motivo llega recortado", "falta el RCA", rev.UltimoComentario);

        // ---------------- I: quien revisa ----------------
        cuerpo = Revisar("POST", "accion=aprobar&revisor=SORIANA%5Cjefe&usuario=SORIANA%5Cjefe", ADM,
                         F("numero", "6", "estado", "Cerrado", "revisor", @"SORIANA\jefe", "usuario", @"SORIANA\jefe", "revisado_por", @"SORIANA\jefe"), out st);
        j = Json(cuerpo);
        Check("I1 el revisor es la cuenta Windows del servidor, no la del formulario", ADM + "|" + ADM, rev.UltimoRevisor + "|" + Campo(j, "revisado_por"));

        // ---------------- D: sin sql/31 / la base falla ----------------
        var sin = new RevisorFalso { Hay = false };
        RevisionSolicitudesIniciativa.Revisor = sin;
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "1", "estado", "Cerrado"), out st);
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
                cuerpo = Revisar("POST", "accion=" + a, ADM, F("numero", "2", "comentario", "x", "estado", "Cerrado"), out st);
                j = Json(cuerpo);
                var llave = a == "aprobar" ? "aprobada" : "rechazada";
                Check("E1 " + caso[0] + " al " + a + ": " + caso[1] + " " + caso[2] + " con " + llave + "=false",
                      caso[1] + "|" + caso[2] + "|False|msg " + caso[0] + "|" + caso[0],
                      st + "|" + Campo(j, "tipo") + "|" + Campo(j, llave) + "|" + Campo(j, "error") + "|" + Campo(j, "numero_error"));
            }
        foreach (var a in new[] { "aprobar", "rechazar" })
        {
            RevisionSolicitudesIniciativa.Revisor = new RevisorFalso { Lanza = new TimeoutException("se corto") };
            cuerpo = Revisar("POST", "accion=" + a, ADM, F("numero", "2", "comentario", "x", "estado", "Cerrado"), out st);
            j = Json(cuerpo);
            var llave = a == "aprobar" ? "aprobada" : "rechazada";
            Check("E2 otra falla al " + a + ": 500 RevisionNoConfirmada con " + llave + "=null (no se sabe)", "500|RevisionNoConfirmada|null",
                  st + "|" + Campo(j, "tipo") + "|" + Campo(j, llave));
        }

        // ---------------- K: 200 ----------------
        var ok = new RevisorFalso();
        RevisionSolicitudesIniciativa.Revisor = ok;
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "142", "comentario", "va", "estado", "Cerrado"), out st);
        j = Json(cuerpo);
        Check("K1 aprobada: estado, numero, revisor, fecha UTC y el codigo devuelto", "200|True|APROBADA|142|" + ADM + "|2026-10-23T17:05:09Z|aprobarycrear:142|PRB 2026-000042|True",
              st + "|" + Campo(j, "aprobada") + "|" + Campo(j, "estado") + "|" + Campo(j, "numero") + "|" + Campo(j, "revisado_por") + "|" +
              Campo(j, "fecha_revision_utc") + "|" + ok.Llamadas.Last() + "|" + Campo(j, "codigo") + "|" + Campo(j, "iniciativa_nueva"));
        cuerpo = Revisar("POST", "accion=rechazar", ADM, F("numero", "143", "comentario", "no procede"), out st);
        j = Json(cuerpo);
        Check("K2 rechazada", "200|True|RECHAZADA|rechazar:143|no procede",
              st + "|" + Campo(j, "rechazada") + "|" + Campo(j, "estado") + "|" + ok.Llamadas.Last() + "|" + ok.UltimoComentario);

        // ---------------- N: aprobar crea la iniciativa (sql/32) ----------------
        var nr = new RevisorFalso();
        RevisionSolicitudesIniciativa.Revisor = nr;
        lector.Estado = "ENVIADA";
        validaciones = 0;
        foreach (var c in new[] { "VIEWER", "MOD" })
        {
            nr.Llamadas.Clear();
            cuerpo = Revisar("POST", "accion=aprobar", c == "MOD" ? MOD : VIEWER, F("numero", "9", "estado", "Cerrado"), out st);
            Check("N0 " + c + " (no ADM): 403, ni valida ni crea", "403|0|0", st + "|" + nr.Llamadas.Count + "|" + validaciones);
        }
        var sin32 = new RevisorFalso { Crea = false };
        RevisionSolicitudesIniciativa.Revisor = sin32;
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
        Check("N1 sin sql/32: 501 IniciativaNoDisponible; no aprueba (ni con la vieja _Aprobar) ni valida", "501|IniciativaNoDisponible|disponible,crea|0",
              st + "|" + Campo(Json(cuerpo), "tipo") + "|" + string.Join(",", sin32.Llamadas.ToArray()) + "|" + validaciones);
        cuerpo = Revisar("POST", "accion=rechazar", ADM, F("numero", "9", "comentario", "no"), out st);
        Check("N1b sin sql/32 rechazar sigue igual", "200|rechazar:9", st + "|" + sin32.Llamadas.Last());
        RevisionSolicitudesIniciativa.Revisor = nr;

        nr.Llamadas.Clear();
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9"), out st);
        Check("N2 sin Estado inicial: 422 FaltaEstado, sin validar ni tocar la base", "422|FaltaEstado|0|0",
              st + "|" + Campo(Json(cuerpo), "tipo") + "|" + nr.Llamadas.Count + "|" + validaciones);

        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "  En Analisis  ", "titulo", "DEL NAVEGADOR", "tipo", "REQ",
                                                          "po", "PO del navegador", "cat_ruta", "/X", "cat_pct", "99", "volumetria", "999"), out st);
        j = Json(cuerpo);
        Check("N3 la alta sale de la solicitud GUARDADA (formulario ignorado), estado recortado",
              "PRB|Problem|Problem|En Analisis|Titulo guardado|Desc guardada|Obs guardadas|PO guardado|SO guardado|/A/Cat 1|12.5|2|False",
              ultimaPeticion.Tipo + "|" + ultimaPeticion.TipoIniciativa + "|" + ultimaPeticion.TipoAgrupado + "|" + ultimaPeticion.Estado + "|" +
              ultimaPeticion.Titulo + "|" + ultimaPeticion.Descripcion + "|" + ultimaPeticion.Observaciones + "|" + ultimaPeticion.Po + "|" +
              ultimaPeticion.So + "|" + ultimaPeticion.Categorias.Single().Categoria + "|" + ultimaPeticion.Categorias.Single().Texto + "|" +
              ultimaPeticion.Volumetria + "|" + ultimaPeticion.TieneRca);
        Check("N4 el plan que llega al procedimiento: prefijo, tipos, estado, hoy, fraccion y volumetria",
              "PRB|Problem|Problem|En Analisis|" + DashboardDataInfo.HoyEnPresentacion().ToString("yyyy-MM-dd") + "|0.125|2",
              nr.UltimoPlan.Prefijo + "|" + nr.UltimoPlan.TipoIniciativa + "|" + nr.UltimoPlan.TipoAgrupado + "|" + nr.UltimoPlan.Estado + "|" +
              nr.UltimoPlan.FechaCreacion.ToString("yyyy-MM-dd") + "|" + nr.UltimoPlan.Categorias.Single().Pct.Value.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + "|" + nr.UltimoPlan.Volumetria);
        Check("N5 200: codigo devuelto, iniciativa_nueva, faltantes de la validacion", "200|PRB 2026-000042|True|rca",
              st + "|" + Campo(j, "codigo") + "|" + Campo(j, "iniciativa_nueva") + "|" +
              string.Join(",", ((System.Collections.ArrayList)j["faltantes"]).Cast<Dictionary<string, object>>().Select(f => (string)f["clave"]).ToArray()));
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", ""), out st);
        Check("N6 estado vacio = sin estado (NULL), como Crear", "200|True", st + "|" + (nr.UltimoPlan.Estado == null));

        validacionError = "El Product Owner no est\u00e1 en el cat\u00e1logo vigente.";
        nr.Llamadas.Clear();
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
        j = Json(cuerpo);
        Check("N7 la alta no es valida: 422 IniciativaInvalida aprobada=false con los errores; la base ni se toca", "422|IniciativaInvalida|False|po|0",
              st + "|" + Campo(j, "tipo") + "|" + Campo(j, "aprobada") + "|" +
              (string)((Dictionary<string, object>)((System.Collections.ArrayList)j["errores"])[0])["campo"] + "|" + nr.Llamadas.Count(x => x.StartsWith("aprobar")));
        validacionError = null;
        validacionLanza = new InvalidOperationException("catalogo caido");
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
        Check("N8 no se pudo validar: 503 ValidacionNoDisponible, nada se aprueba", "503|ValidacionNoDisponible|0",
              st + "|" + Campo(Json(cuerpo), "tipo") + "|" + nr.Llamadas.Count(x => x.StartsWith("aprobar")));
        validacionLanza = null;

        foreach (var caso in new[] { new object[] { 51010, "TopeExcedido" }, new object[] { 51015, "DatoInvalido" }, new object[] { 51025, "CodigoNoEmitido" } })
        {
            RevisionSolicitudesIniciativa.Revisor = new RevisorFalso { Lanza = new ErrorEscrituraGestionAdmin((int)caso[0], "msg " + caso[0], null) };
            cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
            j = Json(cuerpo);
            Check("N9 la alta rechaza (" + caso[0] + "): 409 " + caso[1] + " aprobada=false, sin codigo", "409|" + caso[1] + "|False|(falta)|" + caso[0],
                  st + "|" + Campo(j, "tipo") + "|" + Campo(j, "aprobada") + "|" + Campo(j, "codigo") + "|" + Campo(j, "numero_error"));
        }
        foreach (var caso in new[] { new object[] { 51414, 409, "AprobadaSinIniciativa" }, new object[] { 51415, 409, "TipoNoCoincide" }, new object[] { 51416, 500, "CodigoNoDevuelto" } })
        {
            RevisionSolicitudesIniciativa.Revisor = new RevisorFalso { Lanza = new ErrorRevisionSolicitudIniciativa((int)caso[0], "msg") };
            cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
            j = Json(cuerpo);
            Check("N10 " + caso[0] + ": " + caso[1] + " " + caso[2] + " aprobada=false", caso[1] + "|" + caso[2] + "|False",
                  st + "|" + Campo(j, "tipo") + "|" + Campo(j, "aprobada"));
        }

        var yaAprobada = new RevisorFalso { Nueva = false };
        RevisionSolicitudesIniciativa.Revisor = yaAprobada;
        lector.Estado = "APROBADA";
        validaciones = 0;
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
        j = Json(cuerpo);
        Check("N11 reintento (ya APROBADA): sin validar ni plan; el procedimiento devuelve el MISMO codigo, iniciativa_nueva=false",
              "200|0|True|PRB 2026-000042|False|0",
              st + "|" + validaciones + "|" + (yaAprobada.UltimoPlan == null) + "|" + Campo(j, "codigo") + "|" + Campo(j, "iniciativa_nueva") + "|" +
              ((System.Collections.ArrayList)j["faltantes"]).Count);
        lector.Existe = false;
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
        Check("N12 la solicitud no existe: 404", "404|SolicitudNoExiste", st + "|" + Campo(Json(cuerpo), "tipo"));
        lector.Existe = true;
        lector.Estado = "ENVIADA";
        RevisionSolicitudesIniciativa.Revisor = new RevisorSinCodigo();
        cuerpo = Revisar("POST", "accion=aprobar", ADM, F("numero", "9", "estado", "Cerrado"), out st);
        Check("N13 el revisor real termina sin codigo (InvalidOperationException): 500 aprobada=null, nunca exito", "500|RevisionNoConfirmada|null",
              st + "|" + Campo(Json(cuerpo), "tipo") + "|" + Campo(Json(cuerpo), "aprobada"));

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
        Check("S4 solo llama a los procedimientos de sql/31 y sql/32; la alta va por _AprobarYCrear (nunca directo ni con SQL a mano)", "True|True|True|False",
              codigoCls.Contains("\"adm.usp_SolicitudIniciativa_Aprobar\"") + "|" + codigoCls.Contains("\"adm.usp_SolicitudIniciativa_Rechazar\"") + "|" +
              codigoCls.Contains("\"adm.usp_SolicitudIniciativa_AprobarYCrear\"") + "|" +
              (codigoCls.Contains("usp_SolicitudCambio") || codigoCls.Contains("\"adm.usp_GestionAdmin") || codigoCls.Contains("INSERT ") || codigoCls.Contains("UPDATE ")));
        Check("S6 el handler ya no llama a la vieja Aprobar (aprobaria sin crear)", false, proceso.Contains("revisor.Aprobar("));
        var cambio = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes.ashx"));
        Check("S5 'Cambios' no conoce la revision nueva", "False|False",
              cambio.Contains("RevisionSolicitudesIniciativa") + "|" + cambio.Contains("solicitudes_nuevas_revision"));

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
