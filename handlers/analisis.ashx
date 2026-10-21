<%@ WebHandler Language="C#" Class="AnalisisHandler" %>

// Pestaña "Analisis de servicios" (sitio/analisis/). La consulta vive en
// App_Code/AnalisisQueries.cs; los procedimientos, en
// 47_analisis_servicios.sql.
//
// Solo lectura: un EXEC de un procedimiento de lectura.
//
// PETICIONES
//   GET analisis.ashx?accion=servicios
//       -> { "servicios": [ { "Servicio", "Nombre", "Descripcion",
//                             "DesdeSugerido", "ReglasVersion", "Reglas",
//                             "Criterios", "Actualizado" } ] }
//
//   GET analisis.ashx?servicio=<clave>[&desde=aaaa-mm-dd][&hasta=aaaa-mm-dd]
//       hasta es el ULTIMO dia incluido (vacio = hoy, en Mexico); desde vacio
//       = los ultimos seis meses. Como mucho 400 dias.
//       -> { "servicio": "...", "desde": "...", "hasta": "...",
//            "bloques": { "parametros": {"columnas": [...], "filas": [[...]]},
//                         "reglas", "rutas", "grupos", "fuera", "tickets",
//                         "textos", "historial" } }
//       Todos los valores van como texto (o null), igual que en la salida
//       del 45: la pestaña los lee con el mismo motor.
//       Va en gzip si el navegador lo acepta (la respuesta de un servicio
//       grande pasa de 10 MB) y con Server-Timing: lo que tardo cada bloque
//       del procedimiento, con sus filas, y armar el JSON.
//
// ERRORES ({error, tipo}, como qare.ashx)
//   400  servicio o fechas mal puestos, o el servicio no existe.
//   405  no es GET.
//   500  la consulta fallo; mensaje saneado (DashboardHandler.MensajeSeguro).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Web;
using System.Web.Script.Serialization;

public class AnalisisHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        // Un servicio grande con sus textos pasa con mucho de los 2 MB por omision,
        // y puede tardar mas que los 110 s que ASP.NET le da a una peticion.
        var json = new JavaScriptSerializer();
        json.MaxJsonLength = int.MaxValue;
        context.Server.ScriptTimeout = AnalisisQueries.TIMEOUT_SEGUNDOS + 30;

        try
        {
            if (context.Request.HttpMethod != "GET")
            {
                context.Response.AppendHeader("Allow", "GET");
                Error(context, json, 405, "Solo se acepta GET.", "MetodoNoPermitido");
                return;
            }

            if (context.Request.QueryString["accion"] == "servicios")
            {
                context.Response.Write(json.Serialize(new Dictionary<string, object>
                {
                    { "servicios", AnalisisQueries.Servicios() },
                }));
                return;
            }

            string servicio = AnalisisQueries.Servicio(context.Request.QueryString["servicio"]);
            DateTime desde, hastaExcluido;
            AnalisisQueries.Periodo(
                context.Request.QueryString["desde"],
                context.Request.QueryString["hasta"],
                DashboardDataInfo.HoyEnPresentacion(),
                out desde, out hastaExcluido);

            var medicion = new AnalisisMedicion();
            var bloques = AnalisisQueries.Datos(servicio, desde, hastaExcluido, medicion);

            var reloj = Stopwatch.StartNew();
            string cuerpo = json.Serialize(new Dictionary<string, object>
            {
                { "servicio", servicio },
                { "desde", Dia(desde) },
                { "hasta", Dia(hastaExcluido.AddDays(-1)) },
                { "bloques", bloques },
            });
            medicion.Anotar("json", reloj.Elapsed);
            context.Response.AppendHeader("Server-Timing", medicion.ServerTiming());
            Comprimir(context);
            context.Response.Write(cuerpo);
        }
        catch (AnalisisSolicitudInvalida ex)
        {
            Error(context, json, 400, ex.Message, "SolicitudInvalida");
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("analisis.ashx", ex);
            Error(context, json, 500, DashboardHandler.MensajeSeguro(ex), ex.GetType().Name);
        }
    }

    // gzip a mano: IIS trae apagada la compresion dinamica y un .ashx es
    // dinamico. Si IIS tambien comprime, ve el Content-Encoding y no repite.
    // Fastest: con 28 MB de JSON sintetico tardo 0.17 s y dejo 1/8; Optimal
    // dejaba la mitad de eso pero tardaba el doble.
    private static void Comprimir(HttpContext context)
    {
        string acepta = context.Request.Headers["Accept-Encoding"] ?? "";
        if (acepta.IndexOf("gzip", StringComparison.OrdinalIgnoreCase) < 0) return;
        context.Response.Filter = new GZipStream(context.Response.Filter, CompressionLevel.Fastest);
        context.Response.AppendHeader("Content-Encoding", "gzip");
        context.Response.AppendHeader("Vary", "Accept-Encoding");
    }

    private static string Dia(DateTime d)
    {
        return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private static void Error(HttpContext context, JavaScriptSerializer json, int codigo,
                              string mensaje, string tipo)
    {
        context.Response.StatusCode = codigo;
        context.Response.TrySkipIisCustomErrors = true;
        context.Response.Write(json.Serialize(new Dictionary<string, object>
        {
            { "error", mensaje },
            { "tipo", tipo },
        }));
    }

    public bool IsReusable { get { return false; } }
}
