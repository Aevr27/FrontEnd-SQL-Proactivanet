// tools/tests/AnalisisModoAutonomoHandlerSmoke.cs - prueba de humo, sin base, de
// analisis.ashx?accion=modo_autonomo (App_Code/AnalisisQueries.cs).
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Sin base no se puede llamar a usp_Analisis_ModoAutonomo (97 no esta en este
// repositorio); lo que si se prueba:
//   - ModoAutonomoEnLista: solo la clave exacta en la lista de
//     usp_Analisis_Servicios (Activo = 1) deja pasar la peticion.
//   - El handler: fechas mal puestas = 400 antes de tocar la base; POST = 405;
//     sin cadena de conexion = 500 con JSON y sin traza.
//
// Compilar y correr (sin .config, para que falte la cadena a proposito):
//   tail -n +2 handlers/analisis.ashx > <scratch>/analisis_handler.cs
//   csc -out:<scratch>/AnalisisModoAutonomoHandlerSmoke.exe -r:System.Data.dll -r:System.Web.dll
//       -r:System.Web.Extensions.dll -r:System.Configuration.dll
//       App_Code\*.cs <scratch>/analisis_handler.cs tools\tests\AnalisisModoAutonomoHandlerSmoke.cs
//   AnalisisModoAutonomoHandlerSmoke.exe   # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.IO;
using System.Web;
using System.Web.Script.Serialization;

public static class AnalisisModoAutonomoHandlerSmoke
{
    static int fallas = 0;

    static void Ver(bool ok, string que, string detalle = "")
    {
        Console.WriteLine((ok ? "   PASS  " : "   FAIL  ") + que + (ok || detalle == "" ? "" : ": " + detalle));
        if (!ok) fallas++;
    }

    static Dictionary<string, object> Fila(object servicio)
    {
        return new Dictionary<string, object> { { "Servicio", servicio }, { "Nombre", "x" } };
    }

    static string Pedir(string metodo, string consulta, out int estado)
    {
        var salida = new StringWriter();
        var req = new HttpRequest("analisis.ashx", "http://localhost/handlers/analisis.ashx", consulta);
        var resp = new HttpResponse(salida);
        var ctx = new HttpContext(req, resp);
        if (metodo != "GET")
        {
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

    static Dictionary<string, object> Json(string texto)
    {
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(texto); }
        catch (Exception) { return null; }
    }

    public static int Main(string[] args)
    {
        Console.WriteLine("A) la lista de servicios activos decide");
        Ver(!AnalisisQueries.ModoAutonomoEnLista(null), "sin lista: no");
        Ver(!AnalisisQueries.ModoAutonomoEnLista(new List<Dictionary<string, object>>()), "lista vacia: no");
        Ver(!AnalisisQueries.ModoAutonomoEnLista(new List<Dictionary<string, object>> { Fila("biometrico"), Fila("s_abasto") }),
            "solo otros servicios: no");
        Ver(!AnalisisQueries.ModoAutonomoEnLista(new List<Dictionary<string, object>> { Fila("Modo_Autonomo") }),
            "la clave con mayusculas no cuenta");
        Ver(!AnalisisQueries.ModoAutonomoEnLista(new List<Dictionary<string, object>> { Fila(null) }), "Servicio nulo: no");
        Ver(!AnalisisQueries.ModoAutonomoEnLista(new List<Dictionary<string, object>> { new Dictionary<string, object>() }),
            "fila sin columna Servicio: no");
        Ver(AnalisisQueries.ModoAutonomoEnLista(new List<Dictionary<string, object>> { Fila("biometrico"), Fila("modo_autonomo") }),
            "con modo_autonomo: si");
        Ver(string.Join(",", AnalisisQueries.BLOQUES_MODO_AUTONOMO) == "parametros,eventos,incidentes", "orden de los bloques");

        Console.WriteLine("B) el handler, sin base");
        int estado;
        var r = Json(Pedir("GET", "accion=modo_autonomo&desde=2026-13-01", out estado));
        Ver(estado == 400 && r != null && (string)r["tipo"] == "SolicitudInvalida", "fecha mal escrita = 400", estado + "");
        r = Json(Pedir("GET", "accion=modo_autonomo&desde=2026-05-01&hasta=2026-04-01", out estado));
        Ver(estado == 400 && r != null && (string)r["tipo"] == "SolicitudInvalida", "desde despues de hasta = 400", estado + "");
        r = Json(Pedir("GET", "accion=modo_autonomo&desde=2025-01-01&hasta=2026-06-01", out estado));
        Ver(estado == 400 && r != null && ((string)r["error"]).Contains("400 dias"), "mas de 400 dias = 400", estado + "");
        r = Json(Pedir("POST", "accion=modo_autonomo", out estado));
        Ver(estado == 405 && r != null, "POST = 405", estado + "");
        var cuerpo = Pedir("GET", "accion=modo_autonomo&desde=2026-01-01&hasta=2026-01-31", out estado);
        r = Json(cuerpo);
        Ver(estado == 500 && r != null && r.ContainsKey("error"), "sin cadena de conexion = 500 con JSON", estado + " " + cuerpo);
        Ver(cuerpo.IndexOf(" at ", StringComparison.Ordinal) < 0 && cuerpo.IndexOf("bloques", StringComparison.Ordinal) < 0,
            "el 500 no trae traza ni bloques", cuerpo);

        Console.WriteLine(fallas == 0 ? "TODO PASA" : fallas + " FALLA(S)");
        return fallas == 0 ? 0 : 1;
    }
}
