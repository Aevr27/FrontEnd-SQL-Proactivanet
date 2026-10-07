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
//
// ERRORES ({error, tipo}, como qare.ashx)
//   400  servicio o fechas mal puestos, o el servicio no existe.
//   405  no es GET.
//   500  la consulta fallo; mensaje saneado (DashboardHandler.MensajeSeguro).

using System;
using System.Collections.Generic;
using System.Globalization;
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

            var bloques = AnalisisQueries.Datos(servicio, desde, hastaExcluido);

            context.Response.Write(json.Serialize(new Dictionary<string, object>
            {
                { "servicio", servicio },
                { "desde", Dia(desde) },
                { "hasta", Dia(hastaExcluido.AddDays(-1)) },
                { "bloques", bloques },
            }));
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
