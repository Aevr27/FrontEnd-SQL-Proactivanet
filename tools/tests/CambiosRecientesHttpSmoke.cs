// Prueba de humo SIN SQL de handlers/admin_iniciativas_recientes.ashx y de
// App_Code/CambiosRecientesAdmin.cs: solo ADM lee (MOD, VIEWER y anonimo
// reciben 403 SIN que se consulte la fuente), solo GET, nada de la query
// cambia el limite, la forma del JSON, sin_columna y el 500 saneado. La base
// de verdad (sql/23) se prueba en CambiosRecientesSqlLocalDbSmoke.
//
// Compilar y correr desde la raiz del repo (como SolicitudesCambioHttpSmoke):
//   csc /target:library /out:adm.dll ... App_Code\*.cs
//   csc /target:library /out:hnd.dll /r:adm.dll ... h\*.cs   (handlers sin la linea 1)
//   csc /out:CambiosRecientesHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\CambiosRecientesHttpSmoke.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class RolesFalsosRecientes : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesFalsosRecientes Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class FuenteFalsa : IFuenteCambiosRecientes
{
    public readonly List<int> Llamadas = new List<int>();
    public LecturaCambiosRecientes Devolver = new LecturaCambiosRecientes();
    public Exception Lanzar;
    public LecturaCambiosRecientes Leer(int limite)
    {
        Llamadas.Add(limite);
        if (Lanzar != null) throw Lanzar;
        return Devolver;
    }
}

public static class CambiosRecientesHttpSmoke
{
    static int fallos = 0;
    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    const string ADM = @"SORIANA\t_adm";
    const string MOD = @"SORIANA\t_mod";
    const string VIEWER = @"SORIANA\t_nadie";

    static string Correr(string metodo, string query, string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("admin_iniciativas_recientes.ashx",
            "http://localhost/handlers/admin_iniciativas_recientes.ashx", query ?? ""), new HttpResponse(sw));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(ctx.Request, metodo);
        new AdminIniciativasRecientes().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static Dictionary<string, object> Json(string s) { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s); }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesFalsosRecientes().Con(ADM, "ADM").Con(MOD, "MOD");
        var fuente = new FuenteFalsa();
        CambiosRecientesAdmin.Fuente = fuente;
        int estado;

        // ---- quien puede ----
        foreach (var caso in new[] { new[] { "MOD", MOD, "RolInsuficiente" }, new[] { "VIEWER", VIEWER, "AccesoDenegado" },
                                     new[] { "anonimo", "", "AccesoDenegado" }, new[] { "sin usuario", null, "AccesoDenegado" } })
        {
            var cuerpo = Correr("GET", "", caso[1], out estado);
            Check("A1 " + caso[0] + ": 403 " + caso[2] + " y la fuente NO se consulta", "403|" + caso[2] + "|0",
                  estado + "|" + Json(cuerpo)["tipo"] + "|" + fuente.Llamadas.Count);
        }
        var r = Correr("POST", "", MOD, out estado);
        Check("A2 MOD con POST: 403 antes del metodo", "403|0", estado + "|" + fuente.Llamadas.Count);

        // ---- ADM ----
        fuente.Devolver = new LecturaCambiosRecientes();
        fuente.Devolver.Cambios.Add(new CambioRecienteAdmin { Folio = "PRB 2026-000002", FechaUtc = new DateTime(2026, 10, 20, 16, 5, 9), Usuario = @"SORIANA\t_adm", EsAlta = false });
        fuente.Devolver.Cambios.Add(new CambioRecienteAdmin { Folio = "PRB 2026-000190", FechaUtc = new DateTime(2026, 10, 20, 15, 0, 0), Usuario = @"SORIANA\t_otro", EsAlta = true });
        var j = Json(Correr("GET", "limite=500&usuario=SORIANA%5Cx", ADM, out estado));
        var cambios = (System.Collections.ArrayList)j["cambios"];
        var c0 = (Dictionary<string, object>)cambios[0];
        var c1 = (Dictionary<string, object>)cambios[1];
        Check("B1 ADM: 200, estado ok, limite fijo 10 (la query no lo cambia), orden de la fuente", "200|ok|10|10|PRB 2026-000002,PRB 2026-000190",
              estado + "|" + j["estado"] + "|" + j["limite"] + "|" + fuente.Llamadas[fuente.Llamadas.Count - 1] + "|" + c0["folio"] + "," + c1["folio"]);
        Check("B2 fila: fecha UTC con Z, usuario del sello (no de la query), accion", "2026-10-20T16:05:09Z|SORIANA\\t_adm|cambio|alta",
              c0["fecha_utc"] + "|" + c0["usuario"] + "|" + c0["accion"] + "|" + c1["accion"]);
        Check("B3 el alcance dice que solo es lo guardado desde el Dashboard (no SSMS ni Excel)", "True|True|True",
              ((string)j["alcance"]).Contains("desde el Dashboard") + "|" + ((string)j["alcance"]).Contains("Management Studio") + "|" + ((string)j["alcance"]).Contains("Excel"));
        Correr("POST", "", ADM, out estado);
        Check("B4 ADM con POST: 405", 405, estado);

        fuente.Devolver = new LecturaCambiosRecientes { Estado = LecturaCambiosRecientes.EstadoSinColumna };
        j = Json(Correr("GET", "", ADM, out estado));
        Check("B5 sin sql/23: 200 sin_columna y lista vacia", "200|sin_columna|0", estado + "|" + j["estado"] + "|" + ((System.Collections.ArrayList)j["cambios"]).Count);

        fuente.Lanzar = new InvalidOperationException("Login failed for user 'PROACTIVANETAD' Server=AZVM...");
        j = Json(Correr("GET", "", ADM, out estado));
        Check("B6 falla de lectura: 500 {error, tipo}", "500|True", estado + "|" + (j.ContainsKey("error") && j.ContainsKey("tipo")));

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
