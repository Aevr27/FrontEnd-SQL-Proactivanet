// Prueba de humo SIN SQL de handlers/admin_iniciativas_solicitudes_nuevas.ashx
// y App_Code/RegistroSolicitudesIniciativa.cs (vista "Nuevas" de la pestaña
// Solicitudes), con un lector y roles falsos. La lectura real contra sql/29
// se prueba en RegistroSolicitudesIniciativaSqlLocalDbSmoke.
//
//   A  acceso: anonimo, VIEWER, MOD y el solicitante del interruptor
//      (encendido) reciben 403 y el lector ni se toca; ADM entra.
//   L  listar: 200 con las filas, el total y el tope (200); sin filas, 200
//      con lista vacia; sin tablas 501 (no se lista); la base falla 500.
//   D  detalle: numero 142 / 0000142 / #0000142; invalido 400 sin leer;
//      no existe 404; con su historial.
//   M  metodo y accion: POST 405; aprobar / rechazar / borrar: 400.
//   R  solo lectura: el fuente no escribe; no es ruta del interruptor;
//      "De cambio" (admin_iniciativas_solicitudes.ashx) no se toco.
//
// Compilar y correr desde la raiz del repo (como SolicitudesCambioHttpSmoke):
//   csc /out:RegistroSolicitudesIniciativaHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\RegistroSolicitudesIniciativaHttpSmoke.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class RolesNuevasFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesNuevasFalsos Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class InterruptorNuevasFalso : IFuenteInterruptores
{
    public bool? Valor;
    public bool? Encendido(string clave) { return Valor; }
}

sealed class LectorFalso : ILectorSolicitudesIniciativa
{
    public bool Hay = true;
    public Exception LanzaDisponible, LanzaListar, LanzaDetalle;
    public LecturaSolicitudesIniciativa Lectura = new LecturaSolicitudesIniciativa();
    public Dictionary<int, Dictionary<string, object>> Detalles = new Dictionary<int, Dictionary<string, object>>();
    public readonly List<string> Llamadas = new List<string>();
    public int UltimoMaximo;

    public bool Disponible()
    {
        Llamadas.Add("disponible");
        if (LanzaDisponible != null) throw LanzaDisponible;
        return Hay;
    }
    public LecturaSolicitudesIniciativa Listar(int maximo)
    {
        Llamadas.Add("listar");
        UltimoMaximo = maximo;
        if (LanzaListar != null) throw LanzaListar;
        return Lectura;
    }
    public Dictionary<string, object> Detalle(int numero)
    {
        Llamadas.Add("detalle:" + numero);
        if (LanzaDetalle != null) throw LanzaDetalle;
        Dictionary<string, object> d;
        return Detalles.TryGetValue(numero, out d) ? d : null;
    }
}

public static class RegistroSolicitudesIniciativaHttpSmoke
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

    static string Correr(string metodo, string query, string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("admin_iniciativas_solicitudes_nuevas.ashx",
            "http://localhost/handlers/admin_iniciativas_solicitudes_nuevas.ashx", query ?? ""), new HttpResponse(sw));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(ctx.Request, metodo);
        new AdminIniciativasSolicitudesNuevas().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static Dictionary<string, object> Json(string s)
    {
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s); }
        catch { return new Dictionary<string, object>(); }
    }
    static object Campo(Dictionary<string, object> j, string k) { object v; return j.TryGetValue(k, out v) ? v : "(falta)"; }

    static Dictionary<string, object> Fila(int n, string titulo)
    {
        return new Dictionary<string, object>
        {
            { "numero", n }, { "numero_texto", new NumeroSolicitud(n).ToString() }, { "estado", "ENVIADA" }, { "tipo", "ADO" },
            { "titulo", titulo }, { "solicitante_nombre", "Andres Vera Rios" }, { "solicitante_correo", "andresvr@soriana.com" },
            { "solicitante_cuenta", @"SORIANA\andresvr" }, { "po", "Jesus Campa Morones" }, { "so", "SO 1" },
            { "categoria", "/A/Cat 1" }, { "fecha_utc", "2026-10-22T15:00:00Z" },
        };
    }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesNuevasFalsos().Con(ADM, "ADM").Con(MOD, "MOD").Con(AMBOS, "ADM", "MOD");
        var interruptor = new InterruptorNuevasFalso { Valor = true };
        AccesoIniciativas.Fuente = interruptor;
        var lector = new LectorFalso();
        RegistroSolicitudesIniciativa.Lector = lector;
        lector.Lectura.Total = 2;
        lector.Lectura.Solicitudes.Add(Fila(2, "Dos"));
        lector.Lectura.Solicitudes.Add(Fila(1, "Uno"));
        var det = Fila(142, "Ciento cuarenta y dos");
        det["eventos"] = new List<object> { new Dictionary<string, object> { { "id", 7 }, { "evento", "ENVIADA" }, { "usuario", @"SORIANA\andresvr" } } };
        lector.Detalles[142] = det;
        int st;
        string cuerpo;

        // ---------------- A: acceso ----------------
        foreach (var c in new[] { new[] { "anonimo", "" }, new[] { "VIEWER", VIEWER }, new[] { "MOD", MOD }, new[] { "ADM+MOD (es MOD)", AMBOS } })
            foreach (var q in new[] { "accion=listar", "accion=detalle&numero=142" })
            {
                lector.Llamadas.Clear();
                cuerpo = Correr("GET", q, c[1], out st);
                Check("A1 " + c[0] + " " + q + ": 403 sin tocar el lector", "403|0", st + "|" + lector.Llamadas.Count);
            }
        lector.Llamadas.Clear();
        cuerpo = Correr("GET", "accion=listar", null, out st);
        Check("A1 sin usuario: 403", "403|0", st + "|" + lector.Llamadas.Count);
        cuerpo = Correr("GET", "accion=listar", MOD, out st);
        Check("A2 MOD: RolInsuficiente con el mensaje del registro", "RolInsuficiente|" + RegistroSolicitudesIniciativa.MensajeSoloAdm,
              Campo(Json(cuerpo), "tipo") + "|" + Campo(Json(cuerpo), "error"));
        interruptor.Valor = true;
        lector.Llamadas.Clear();
        cuerpo = Correr("GET", "accion=listar", VIEWER, out st);
        Check("A3 interruptor INICIATIVAS_ABIERTAS encendido: el solicitante sigue sin entrar", "403|0", st + "|" + lector.Llamadas.Count);
        Check("A3 no es ruta del solicitante", false, AccesoIniciativas.EsRutaSolicitante("~/handlers/admin_iniciativas_solicitudes_nuevas.ashx"));
        Check("A4 el modulo de acceso tambien la protege (prefijo admin_)", true,
              AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_solicitudes_nuevas.ashx"));
        cuerpo = Correr("GET", "accion=listar&rol=ADM&usuario=" + Uri.EscapeDataString(ADM), VIEWER, out st);
        Check("A5 rol / usuario en la URL no abren nada", 403, st);

        // ---------------- L: listar ----------------
        lector.Llamadas.Clear();
        cuerpo = Correr("GET", "accion=listar", ADM, out st);
        var j = Json(cuerpo);
        var filas = Campo(j, "solicitudes") as System.Collections.ArrayList;
        Check("L1 ADM: 200 con las filas (las mas recientes primero), total y tope", "200|2|#0000002|2|200|200",
              st + "|" + (filas == null ? -1 : filas.Count) + "|" + (filas == null ? "" : ((Dictionary<string, object>)filas[0])["numero_texto"]) + "|" +
              Campo(j, "total") + "|" + Campo(j, "maximo") + "|" + lector.UltimoMaximo);
        Check("L1 primero revisa las tablas y luego lista", "disponible,listar", string.Join(",", lector.Llamadas.ToArray()));

        var vacio = new LectorFalso();
        RegistroSolicitudesIniciativa.Lector = vacio;
        cuerpo = Correr("GET", "accion=listar", ADM, out st);
        j = Json(cuerpo);
        filas = Campo(j, "solicitudes") as System.Collections.ArrayList;
        Check("L2 sin solicitudes: 200 con lista vacia y total 0 (no es un error)", "200|0|0|(falta)",
              st + "|" + (filas == null ? -1 : filas.Count) + "|" + Campo(j, "total") + "|" + Campo(j, "error"));

        var sinTablas = new LectorFalso { Hay = false };
        RegistroSolicitudesIniciativa.Lector = sinTablas;
        foreach (var q in new[] { "accion=listar", "accion=detalle&numero=1" })
        {
            cuerpo = Correr("GET", q, ADM, out st);
            j = Json(cuerpo);
            Check("L3 sin tablas de sql/29 (" + q + "): 501 RegistroNoDisponible, no lee filas", "501|RegistroNoDisponible|disponible",
                  st + "|" + Campo(j, "tipo") + "|" + string.Join(",", sinTablas.Llamadas.ToArray()));
            sinTablas.Llamadas.Clear();
        }

        RegistroSolicitudesIniciativa.Lector = new LectorFalso { LanzaDisponible = new InvalidOperationException("conexion rechazada") };
        cuerpo = Correr("GET", "accion=listar", ADM, out st);
        j = Json(cuerpo);
        Check("L4 la base falla al revisar: 500 (no 501), con error y tipo", "500|True|True",
              st + "|" + (Campo(j, "error") is string) + "|" + (Campo(j, "tipo") is string && (string)Campo(j, "tipo") != "RegistroNoDisponible"));
        RegistroSolicitudesIniciativa.Lector = new LectorFalso { LanzaListar = new InvalidOperationException("timeout") };
        cuerpo = Correr("GET", "accion=listar", ADM, out st);
        Check("L5 la base falla al listar: 500", 500, st);
        RegistroSolicitudesIniciativa.Lector = new LectorFalso { LanzaDetalle = new InvalidOperationException("timeout") };
        cuerpo = Correr("GET", "accion=detalle&numero=5", ADM, out st);
        Check("L6 la base falla en el detalle: 500", 500, st);
        RegistroSolicitudesIniciativa.Lector = lector;

        // ---------------- D: detalle ----------------
        foreach (var n in new[] { "142", "0000142", "%230000142" })
        {
            lector.Llamadas.Clear();
            cuerpo = Correr("GET", "accion=detalle&numero=" + n, ADM, out st);
            j = Json(cuerpo);
            var ev = Campo(j, "eventos") as System.Collections.ArrayList;
            Check("D1 detalle numero=" + n + ": 200 con su historial", "200|#0000142|1|detalle:142",
                  st + "|" + Campo(j, "numero_texto") + "|" + (ev == null ? -1 : ev.Count) + "|" + lector.Llamadas[lector.Llamadas.Count - 1]);
        }
        foreach (var n in new[] { "", "0", "-3", "abc", "1.5", "10000000", "1;DROP TABLE x" })
        {
            lector.Llamadas.Clear();
            cuerpo = Correr("GET", "accion=detalle&numero=" + Uri.EscapeDataString(n), ADM, out st);
            Check("D2 numero invalido '" + n + "': 400 SinSolicitud sin leer la base", "400|SinSolicitud|0",
                  st + "|" + Campo(Json(cuerpo), "tipo") + "|" + lector.Llamadas.Count);
        }
        cuerpo = Correr("GET", "accion=detalle", ADM, out st);
        Check("D2 sin numero: 400", 400, st);
        cuerpo = Correr("GET", "accion=detalle&numero=9", ADM, out st);
        Check("D3 no existe: 404 SolicitudNoExiste", "404|SolicitudNoExiste", st + "|" + Campo(Json(cuerpo), "tipo"));

        // ---------------- M: metodo y accion ----------------
        foreach (var m in new[] { "POST", "PUT", "DELETE" })
        {
            lector.Llamadas.Clear();
            cuerpo = Correr(m, "accion=listar", ADM, out st);
            Check("M1 " + m + ": 405 sin leer", "405|0", st + "|" + lector.Llamadas.Count);
        }
        foreach (var a in new[] { "aprobar", "rechazar", "aplicar", "borrar", "estado", "" })
        {
            lector.Llamadas.Clear();
            cuerpo = Correr("GET", "accion=" + a + "&numero=1", ADM, out st);
            Check("M2 accion '" + a + "': 400 AccionDesconocida (el registro no escribe)", "400|AccionDesconocida|0",
                  st + "|" + Campo(Json(cuerpo), "tipo") + "|" + lector.Llamadas.Count);
        }

        // ---------------- N: numero ----------------
        Check("N1 RegistroSolicitudesIniciativa.Numero", "142|142|142|1|0|0|0|0|9999999|0",
              string.Join("|", new[] { "142", " 0000142 ", "#0000142", "1", "0", "#", null, "+5", "9999999", "10000000" }
                  .Select(x => RegistroSolicitudesIniciativa.Numero(x).ToString()).ToArray()));

        // ---------------- R: solo lectura y compatibilidad ----------------
        var hnd = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes_nuevas.ashx"));
        var proceso = hnd.Substring(hnd.IndexOf("public void ProcessRequest", StringComparison.Ordinal));
        var lec = File.ReadAllText(Path.Combine("App_Code", "RegistroSolicitudesIniciativa.cs"));
        var codigo = lec.Substring(lec.IndexOf("using System;", StringComparison.Ordinal));
        Check("R1 ExigirAdm es lo primero del handler", true,
              proceso.IndexOf("AccesoAdmin.ExigirAdm(context", StringComparison.Ordinal) > 0 &&
              proceso.IndexOf("AccesoAdmin.ExigirAdm(context", StringComparison.Ordinal) < proceso.IndexOf("DashboardHandler.Responder", StringComparison.Ordinal));
        // Palabras de SQL en mayusculas con su espacio (ExecuteReader no cuenta).
        Check("R2 el lector solo lee: sin INSERT/UPDATE/DELETE/MERGE/EXEC/procedimientos", "False|False|False|False|False|False|False",
              string.Join("|", new[] { "INSERT ", "UPDATE ", "DELETE ", "MERGE ", "EXEC ", "EXECUTE ", "CommandType.StoredProcedure" }
                  .Select(p => codigo.IndexOf(p, StringComparison.Ordinal) >= 0 ? "True" : "False").ToArray()));
        Check("R3 sin estado de maquina: ni archivos ni cache", "False|False|False",
              (codigo.Contains("File.") || hnd.Contains("File.")) + "|" + (codigo.Contains("HttpRuntime.Cache") || hnd.Contains("HttpRuntime.Cache")) + "|" +
              (codigo.Contains("MapPath") || hnd.Contains("MapPath")));
        Check("R4 el handler no menciona el interruptor", false, hnd.Contains("AccesoIniciativas"));
        var cambio = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes.ashx"));
        Check("R5 'De cambio' sigue igual: no conoce el registro nuevo", "False|False",
              cambio.Contains("RegistroSolicitudesIniciativa") + "|" + cambio.Contains("solicitudes_nuevas"));

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
