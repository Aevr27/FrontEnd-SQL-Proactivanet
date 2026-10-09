// tools/tests/AnalisisDatosSmoke.cs - prueba de humo de la pestaña "Analisis de servicios"
// (handlers/analisis.ashx -> App_Code/AnalisisQueries.cs -> 47_analisis_servicios.sql).
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Que prueba:
//   A) Sin base: la clave del servicio y el periodo (por omision seis meses,
//      hasta incluido, tope de 400 dias, fechas mal escritas).
//   B) Contra una base con 47 y 48 corridos: la lista de servicios, los ocho
//      bloques de usp_Analisis_Datos en su orden y con las columnas que lee
//      analisis.js, los tickets del servicio, los textos completos en una
//      parte, y que un servicio que no existe sale como solicitud invalida.
//   C) El handler de punta a punta (un HttpContext armado a mano): 200 con el
//      contrato, 400 con mensaje, 405 si no es GET.
//
// Con un segundo argumento, escribe la respuesta del handler (JSON) en ese
// archivo: la usan analisis_servicio/prueba_tablero.js y la prueba en
// navegador de la pestaña.
//
// Compilar y correr (pruebas/correr_analisis_servicios.sh lo hace con Mono
// contra el SQL Server de Docker; en Windows, igual que QareExportarSmoke.cs):
//   tail -n +2 handlers/analisis.ashx > <scratch>/analisis_handler.cs
//   csc /out:<scratch>/AnalisisDatosSmoke.exe /r:System.Data.dll /r:System.Web.dll
//       /r:System.Web.Extensions.dll /r:System.Configuration.dll
//       App_Code\*.cs <scratch>/analisis_handler.cs tools\tests\AnalisisDatosSmoke.cs
//   AnalisisDatosSmoke.exe.config con la cadena "TicketsProactivanet" de una base de prueba.
//   AnalisisDatosSmoke.exe [respuesta.json]   # PASS/FAIL por caso, sale 0 si todo paso
//   AnalisisDatosSmoke.exe --sin-base         # solo A
//
// En este repositorio no estan ni los scripts 47/48 ni los datos de prueba de
// B y C (pruebas/, analisis_servicio/): sin esa base solo corre A.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web;
using System.Web.Script.Serialization;

public static class AnalisisDatosSmoke
{
    static int fallas = 0;

    static void Ver(bool ok, string que, string detalle = "")
    {
        Console.WriteLine((ok ? "   PASS  " : "   FAIL  ") + que + (ok || detalle == "" ? "" : ": " + detalle));
        if (!ok) fallas++;
    }

    static bool Lanza<T>(Action a) where T : Exception
    {
        try { a(); return false; } catch (T) { return true; }
    }

    static List<object> Columnas(Dictionary<string, object> bloques, string nombre)
    {
        var b = (Dictionary<string, object>)bloques[nombre];
        return ((List<string>)b["columnas"]).Cast<object>().ToList();
    }

    static List<object[]> Filas(Dictionary<string, object> bloques, string nombre)
    {
        return (List<object[]>)((Dictionary<string, object>)bloques[nombre])["filas"];
    }

    static string Pedir(string metodo, string consulta, out int estado)
    {
        var salida = new StringWriter();
        var req = new HttpRequest("analisis.ashx", "http://localhost/handlers/analisis.ashx", consulta);
        var resp = new HttpResponse(salida);
        var ctx = new HttpContext(req, resp);
        if (metodo != "GET")
        {
            // HttpRequest no deja cambiar el metodo; se usa su campo interno, solo en la
            // prueba: _httpMethod en .NET Framework, http_method en Mono.
            foreach (var nombre in new[] { "_httpMethod", "http_method" })
            {
                var campo = typeof(HttpRequest).GetField(nombre,
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (campo != null) campo.SetValue(req, metodo);
            }
        }
        new AnalisisHandler().ProcessRequest(ctx);
        estado = resp.StatusCode;
        return salida.ToString();
    }

    public static int Main(string[] args)
    {
        Console.WriteLine("A) clave y periodo, sin base");
        Ver(AnalisisQueries.Servicio(" biometrico ") == "biometrico", "la clave se recorta");
        Ver(Lanza<AnalisisSolicitudInvalida>(() => AnalisisQueries.Servicio("S-Biometrico")), "con mayusculas no es clave");
        Ver(Lanza<AnalisisSolicitudInvalida>(() => AnalisisQueries.Servicio("x'; DROP TABLE t; --")), "ni con comillas");
        Ver(Lanza<AnalisisSolicitudInvalida>(() => AnalisisQueries.Servicio(null)), "ni vacia");
        DateTime d, h;
        var hoy = new DateTime(2026, 10, 6);
        AnalisisQueries.Periodo(null, null, hoy, out d, out h);
        Ver(d == new DateTime(2026, 5, 1) && h == new DateTime(2026, 10, 7), "sin fechas: del 1 de mayo a hoy, incluido",
            d.ToString("yyyy-MM-dd") + " " + h.ToString("yyyy-MM-dd"));
        AnalisisQueries.Periodo("2026-01-01", "2026-03-31", hoy, out d, out h);
        Ver(d == new DateTime(2026, 1, 1) && h == new DateTime(2026, 4, 1), "hasta incluido sale como el dia siguiente");
        Ver(Lanza<AnalisisSolicitudInvalida>(() => AnalisisQueries.Periodo("2026-04-01", "2026-03-31", hoy, out d, out h)), "desde despues de hasta");
        Ver(Lanza<AnalisisSolicitudInvalida>(() => AnalisisQueries.Periodo("2025-01-01", "2026-03-31", hoy, out d, out h)), "mas de 400 dias");
        Ver(Lanza<AnalisisSolicitudInvalida>(() => AnalisisQueries.Periodo("01/01/2026", null, hoy, out d, out h)), "fecha mal escrita");

        if (args.Length > 0 && args[0] == "--sin-base")
        {
            Console.WriteLine("(B y C omitidos: sin base)");
            Console.WriteLine(fallas == 0 ? "TODO PASA" : fallas + " FALLA(S)");
            return fallas == 0 ? 0 : 1;
        }

        Console.WriteLine("B) contra la base");
        var servicios = AnalisisQueries.Servicios();
        var bio = servicios.FirstOrDefault(s => (string)s["Servicio"] == "biometrico");
        Ver(bio != null && Convert.ToInt32(bio["Reglas"]) == 19 && Convert.ToInt32(bio["Criterios"]) == 4,
            "la lista trae S-Biometrico con 19 reglas y 4 criterios");
        var bloques = AnalisisQueries.Datos("biometrico", new DateTime(2026, 1, 1), new DateTime(2026, 10, 7));
        Ver(string.Join(",", bloques.Keys) == string.Join(",", AnalisisQueries.BLOQUES), "los ocho bloques, en orden",
            string.Join(",", bloques.Keys));
        var ct = Columnas(bloques, "tickets");
        Ver(new[] { "Origen", "CodigoTicket", "FechaRegistro", "TipoSitio", "SitioNumero", "Tienda", "Grupo",
                    "TecnicoResolvio", "FechaEstimadaResolucion", "FechaFirmaSolucion", "IntentosSolucion" }
                .All(c => ct.Contains(c)), "el bloque de tickets trae las columnas que lee el motor");
        var tickets = Filas(bloques, "tickets");
        int iCod = ct.IndexOf("CodigoTicket");
        var codigos = tickets.Select(f => (string)f[iCod]).OrderBy(x => x).ToList();
        Ver(string.Join(",", codigos) == "INC 2026-000001,INC 2026-000002,INC 2026-000003,INC 2026-000005,INC 2026-000006,INC 2026-000010,REQ 2026-000004",
            "los siete tickets del servicio, los mismos que saca el 45 (sin el del bot ni el de la cuenta)", string.Join(",", codigos));
        var cx = Columnas(bloques, "textos");
        var desc = Filas(bloques, "textos").FirstOrDefault(f => (string)f[cx.IndexOf("CodigoTicket")] == "INC 2026-000001"
                                                                 && (string)f[cx.IndexOf("Campo")] == "Descripcion");
        // La de prueba (pruebas/correr_extraccion_servicio.sh) mide 601 con su salto de
        // linea y su tabulador, que se vuelven espacios: 601 mas el "|" final.
        Ver(desc != null && ((string)desc[cx.IndexOf("Texto")]).Length == 602 && (string)desc[cx.IndexOf("Parte")] == "1",
            "la descripcion larga llega completa, en una parte, con su |",
            desc == null ? "no vino" : ((string)desc[cx.IndexOf("Texto")]).Length.ToString());
        var cp = Columnas(bloques, "parametros");
        var parametros = Filas(bloques, "parametros").ToDictionary(f => (string)f[cp.IndexOf("Clave")] + "#" + f[cp.IndexOf("Valor")], f => 1);
        Ver(parametros.Keys.Any(k => k == "Version#tablero v1") && parametros.Keys.Any(k => k.StartsWith("Extraido#2")) &&
            parametros.Keys.Any(k => k == "ServicioClave#biometrico") && parametros.Keys.Any(k => k == "Grupo#Proveedor RODHE"),
            "parametros: version, corte, servicio y criterios");
        Ver(parametros.ContainsKey("ExcluidosBot#1") && parametros.ContainsKey("ExcluidosCuenta#1"),
            "parametros: uno fuera por el bot (grupo SorIA) y uno por la cuenta (CatCuentaNoPersona)");
        Ver(Filas(bloques, "reglas").Count == 19, "las 19 reglas");
        Ver(Lanza<AnalisisSolicitudInvalida>(() => AnalisisQueries.Datos("no_existe", new DateTime(2026, 1, 1), new DateTime(2026, 2, 1))),
            "un servicio que no existe sale como solicitud invalida (400), no como falla");

        Console.WriteLine("C) el handler");
        int estado;
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        string cuerpo = Pedir("GET", "servicio=biometrico&desde=2026-01-01&hasta=2026-10-06", out estado);
        var r = json.Deserialize<Dictionary<string, object>>(cuerpo);
        Ver(estado == 200 && (string)r["servicio"] == "biometrico" && (string)r["desde"] == "2026-01-01" && (string)r["hasta"] == "2026-10-06"
            && ((Dictionary<string, object>)r["bloques"]).Count == 8, "200 con servicio, periodo y ocho bloques", estado + " " + cuerpo.Substring(0, Math.Min(160, cuerpo.Length)));
        if (args.Length > 0) { File.WriteAllText(args[0], cuerpo); Console.WriteLine("   (respuesta en " + args[0] + ")"); }
        string lista = Pedir("GET", "accion=servicios", out estado);
        Ver(estado == 200 && lista.Contains("\"Servicio\":\"biometrico\""), "accion=servicios");
        string mal = Pedir("GET", "servicio=biometrico&desde=2026-05-01&hasta=2026-04-01", out estado);
        Ver(estado == 400 && mal.Contains("\"error\"") && mal.Contains("SolicitudInvalida"), "400 con mensaje si el periodo esta al reves", estado + " " + mal);
        string noHay = Pedir("GET", "servicio=no_existe", out estado);
        Ver(estado == 400 && noHay.Contains("no existe"), "400 si el servicio no existe", estado + " " + noHay);
        string post = Pedir("POST", "servicio=biometrico", out estado);
        Ver(estado == 405, "405 si no es GET", estado + " " + post);

        Console.WriteLine();
        Console.WriteLine(fallas == 0 ? "TODO PASA" : fallas + " FALLA(S)");
        return fallas == 0 ? 0 : 1;
    }
}
