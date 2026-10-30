// Prueba de humo SIN SQL de handlers/admin_iniciativas_historial.ashx y de
// App_Code/HistorialPeticiones.cs: solo ADM lee (MOD, VIEWER y anonimo
// reciben 403 SIN que se consulte la fuente), solo GET, el filtro (fechas
// UTC, hasta excluido, desde >= hasta y tipo desconocido = 400 sin leer),
// la union de los dos tipos (mas reciente primero, sin repetir, recorte a
// Maximo con el total) y el 500 saneado.
//
// Compilar y correr desde la raiz del repo (como CambiosRecientesHttpSmoke):
//   csc /target:library /out:adm.dll ... App_Code\*.cs
//   csc /target:library /out:hnd.dll /r:adm.dll ... h\*.cs   (handlers sin la linea 1)
//   csc /out:HistorialPeticionesHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\HistorialPeticionesHttpSmoke.cs
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class RolesFalsosHistorial : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesFalsosHistorial Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class FuenteHistorialFalsa : IFuenteHistorialPeticiones
{
    public readonly List<FiltroHistorial> Llamadas = new List<FiltroHistorial>();
    public LecturaHistorial Devolver = new LecturaHistorial();
    public Exception Lanzar;
    public LecturaHistorial Leer(FiltroHistorial filtro, int maximo)
    {
        Llamadas.Add(filtro);
        if (Lanzar != null) throw Lanzar;
        return Devolver;
    }
}

public static class HistorialPeticionesHttpSmoke
{
    static int fallos = 0;
    static void CabeceraNavegador(HttpRequest req, string nombre, string valor)
    {
        var h = req.Headers;
        var t = typeof(System.Collections.Specialized.NameObjectCollectionBase);
        var f = BindingFlags.NonPublic | BindingFlags.Instance;
        var ro = t.GetProperty("IsReadOnly", f);
        ro.SetValue(h, false, null);
        t.GetMethod("BaseSet", f, null, new[] { typeof(string), typeof(object) }, null)
         .Invoke(h, new object[] { nombre, new ArrayList { valor } });
        ro.SetValue(h, true, null);
    }

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
        var ctx = new HttpContext(new HttpRequest("admin_iniciativas_historial.ashx",
            "http://localhost/handlers/admin_iniciativas_historial.ashx", query ?? ""), new HttpResponse(sw));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(ctx.Request, metodo);
        CabeceraNavegador(ctx.Request, "Sec-Fetch-Site", "same-origin");
        new AdminIniciativasHistorial().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static Dictionary<string, object> Json(string s) { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s); }
    static Dictionary<string, object> Fila(Dictionary<string, object> j, int i) { return (Dictionary<string, object>)((ArrayList)j["peticiones"])[i]; }

    static PeticionHistorial Ini(int n, DateTime f, string estado)
    {
        return new PeticionHistorial { Tipo = PeticionHistorial.TipoIniciativa, Id = n, FolioTexto = new NumeroSolicitud(n).ToString(), FechaUtc = f,
            Estado = estado, SolicitanteNombre = "Ana", SolicitanteCuenta = @"SORIANA\ana", IniciativaTitulo = "T" + n };
    }
    static PeticionHistorial Cam(int id, DateTime f, string estado)
    {
        return new PeticionHistorial { Tipo = PeticionHistorial.TipoCambio, Id = id, FolioTexto = "#" + id, FechaUtc = f, Estado = estado,
            SolicitanteCuenta = @"SORIANA\t_mod", RolSolicitante = "MOD", IniciativaCodigo = "PRB 2026-000001" };
    }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesFalsosHistorial().Con(ADM, "ADM").Con(MOD, "MOD");
        var fuente = new FuenteHistorialFalsa();
        HistorialPeticiones.Fuente = fuente;
        int estado;

        // ---- A) quien puede: la fuente NO se consulta sin ADM ----
        foreach (var caso in new[] { new[] { "MOD", MOD, "RolInsuficiente" }, new[] { "VIEWER", VIEWER, "AccesoDenegado" },
                                     new[] { "anonimo", "", "AccesoDenegado" }, new[] { "sin usuario", null, "AccesoDenegado" } })
        {
            var cuerpo = Correr("GET", "", caso[1], out estado);
            Check("A1 " + caso[0] + ": 403 " + caso[2] + " y la fuente NO se consulta", "403|" + caso[2] + "|0",
                  estado + "|" + Json(cuerpo)["tipo"] + "|" + fuente.Llamadas.Count);
        }
        Correr("GET", "tipo=CAMBIO&desde=2026-10-01T06:00:00Z", MOD, out estado);
        Check("A2 MOD con filtros: 403 igual, sin leer", "403|0", estado + "|" + fuente.Llamadas.Count);
        Correr("POST", "", ADM, out estado);
        Check("A3 ADM con POST: 405, sin leer", "405|0", estado + "|" + fuente.Llamadas.Count);

        // ---- F) filtro ----
        foreach (var q in new[] { "desde=2026-10-01", "hasta=ayer", "desde=2026-10-02T06:00:00Z&hasta=2026-10-02T06:00:00Z",
                                  "desde=2026-10-05T06:00:00Z&hasta=2026-10-02T06:00:00Z", "tipo=OTRO", "tipo=cambio" })
        {
            var j = Json(Correr("GET", q, ADM, out estado));
            Check("F1 " + q + ": 400 FiltroInvalido sin leer", "400|FiltroInvalido|0", estado + "|" + j["tipo"] + "|" + fuente.Llamadas.Count);
        }
        Correr("GET", "desde=2026-10-01T06:00:00Z&hasta=2026-10-03T06:00:00Z&tipo=INICIATIVA", ADM, out estado);
        var fl = fuente.Llamadas[fuente.Llamadas.Count - 1];
        Check("F2 fechas UTC tal cual (hasta excluido) y tipo", "200|2026-10-01 06:00:00|Utc|2026-10-03 06:00:00|INICIATIVA",
              estado + "|" + fl.DesdeUtc.Value.ToString("yyyy-MM-dd HH:mm:ss") + "|" + fl.DesdeUtc.Value.Kind + "|" +
              fl.HastaUtc.Value.ToString("yyyy-MM-dd HH:mm:ss") + "|" + fl.Tipo);
        Correr("GET", "", ADM, out estado);
        fl = fuente.Llamadas[fuente.Llamadas.Count - 1];
        Check("F3 sin filtros: todo, los dos tipos", "200|False|False|", estado + "|" + fl.DesdeUtc.HasValue + "|" + fl.HastaUtc.HasValue + "|" + fl.Tipo);

        // ---- U) union ----
        fuente.Devolver = new LecturaHistorial { IniciativasDisponible = true, CambiosDisponible = true, TotalIniciativas = 2, TotalCambios = 2 };
        fuente.Devolver.Peticiones.Add(Ini(12, new DateTime(2026, 10, 20, 15, 0, 0), "ENVIADA"));
        fuente.Devolver.Peticiones.Add(Ini(11, new DateTime(2026, 10, 18, 9, 0, 0), "APROBADA"));
        fuente.Devolver.Peticiones.Add(Cam(7, new DateTime(2026, 10, 21, 1, 30, 0), "PENDIENTE"));
        fuente.Devolver.Peticiones.Add(Cam(6, new DateTime(2026, 10, 20, 15, 0, 0), "RECHAZADA"));
        var r = Json(Correr("GET", "", ADM, out estado));
        var orden = new List<string>();
        foreach (Dictionary<string, object> p in (ArrayList)r["peticiones"]) orden.Add(p["tipo"] + p["folio"].ToString());
        Check("U1 mas reciente primero; empate de hora: iniciativa antes que cambio; cada una una vez",
              "CAMBIO#7,INICIATIVA#0000012,CAMBIO#6,INICIATIVA#0000011", string.Join(",", orden));
        var c0 = Fila(r, 0); var i0 = Fila(r, 1);
        Check("U2 fila de cambio: fecha UTC con Z, cuenta y rol, iniciativa, estado guardado", "2026-10-21T01:30:00Z|SORIANA\\t_mod|MOD|PRB 2026-000001|PENDIENTE|7",
              c0["fecha_utc"] + "|" + c0["solicitante_cuenta"] + "|" + c0["rol_solicitante"] + "|" + c0["iniciativa_codigo"] + "|" + c0["estado"] + "|" + c0["id"]);
        Check("U3 fila de iniciativa: nombre, titulo pedido, codigo vacio sin aprobar", "Ana|T12||ENVIADA",
              i0["solicitante_nombre"] + "|" + i0["iniciativa_titulo"] + "|" + i0["iniciativa_codigo"] + "|" + i0["estado"]);
        Check("U4 totales y disponibilidad", "4|2|2|True|True|500", r["total"] + "|" + r["total_iniciativas"] + "|" + r["total_cambios"] + "|" +
              r["iniciativas_disponible"] + "|" + r["cambios_disponible"] + "|" + r["maximo"]);

        // ---- M) recorte a Maximo: se dice cuantas habia ----
        var mucho = new LecturaHistorial { IniciativasDisponible = true, CambiosDisponible = true, TotalIniciativas = 700, TotalCambios = 600 };
        var t0 = new DateTime(2026, 1, 1);
        for (int k = 1; k <= HistorialPeticiones.Maximo; k++)
        {
            mucho.Peticiones.Add(Ini(k, t0.AddMinutes(2 * k), "ENVIADA"));
            mucho.Peticiones.Add(Cam(k, t0.AddMinutes(2 * k + 1), "PENDIENTE"));
        }
        var jm = HistorialPeticiones.Json(mucho, HistorialPeticiones.Maximo);
        var lm = (List<object>)jm["peticiones"];
        var ultima = (Dictionary<string, object>)lm[lm.Count - 1];
        Check("M1 la union se recorta a Maximo con las mas recientes y el total real", "500|1300|INICIATIVA|251",
              lm.Count + "|" + jm["total"] + "|" + ultima["tipo"] + "|" + ultima["id"]);

        // ---- D) sin una de las tablas ----
        fuente.Devolver = new LecturaHistorial { IniciativasDisponible = true, CambiosDisponible = false, TotalIniciativas = 1 };
        fuente.Devolver.Peticiones.Add(Ini(3, t0, "RECHAZADA"));
        r = Json(Correr("GET", "", ADM, out estado));
        Check("D1 sin sql/22: 200, solo iniciativas y cambios_disponible false", "200|1|False", estado + "|" + ((ArrayList)r["peticiones"]).Count + "|" + r["cambios_disponible"]);

        // ---- E) falla de lectura ----
        fuente.Lanzar = new InvalidOperationException("Login failed for user 'PROACTIVANETAD' Server=AZVM...");
        r = Json(Correr("GET", "", ADM, out estado));
        Check("E1 falla de lectura: 500 {error, tipo}", "500|True", estado + "|" + (r.ContainsKey("error") && r.ContainsKey("tipo")));

        // ---- S) la consulta: solo SELECT, titulo sin JOIN que duplique, rango con hasta excluido ----
        var sqlC = FuenteHistorialPeticionesSql.ConsultaCambios;
        var sqlI = FuenteHistorialPeticionesSql.ConsultaIniciativas(true);
        Check("S1 solo lectura y OUTER APPLY TOP (1) para el titulo", "False|False|False|True",
              (sqlC + sqlI).ToUpperInvariant().Contains("INSERT") + "|" + (sqlC + sqlI).ToUpperInvariant().Contains("UPDATE") + "|" +
              (sqlC + sqlI).ToUpperInvariant().Contains("DELETE") + "|" + sqlC.Contains("OUTER APPLY (SELECT TOP (1)"));
        Check("S2 fecha de ENVIO (no la de revision), hasta excluido", "True|True|True|False",
              sqlC.Contains("s.FechaSolicitudUtc < @hasta") + "|" + sqlI.Contains("s.FechaUtc < @hasta") + "|" + sqlI.Contains("s.FechaUtc >= @desde") + "|" +
              (sqlC + sqlI).Contains("FechaRevisionUtc"));
        Check("S3 sin sql/32 no se pide CodigoIniciativa de la tabla", false, FuenteHistorialPeticionesSql.ConsultaIniciativas(false).Contains("s.CodigoIniciativa"));

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
