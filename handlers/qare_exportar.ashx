<%@ WebHandler Language="C#" Class="QareExportarHandler" %>

// Tickets del boton "⬇ Descargar QARE" (descargar en qare/qare.js).
//
// Devuelve los tickets QARE del rango y los filtros que esta viendo el
// tablero; el XLSX lo arma el navegador. La consulta vive en
// App_Code/QareExportar.cs y lee la MISMA fuente filtrada que los seis
// dbo.usp_CorreoQARE_* (dbo.tvf_CorreoQARE_Base).
//
// Solo lectura: un SELECT, ningun INSERT/UPDATE/DELETE.
//
// PETICION (los mismos parametros que qare.ashx)
//   GET qare_exportar.ashx[?fecha_inicio=aaaa-mm-dd][&fecha_fin=aaaa-mm-dd]
//                         [&c1=...][&grupos=...][&lideres=...]
//   Fechas: QareContrato.Rango, el mismo default (15 dias que terminan hoy
//   en Mexico) y el mismo dia fin incluido. Filtros: BacklogUtil.Filtros,
//   listas separadas por comas; vacio = sin filtro.
//
// RESPUESTA 200
//   { "fechaInicio": "aaaa-mm-dd", "fechaFin": "aaaa-mm-dd", "total": 1234,
//     "tickets": [ { "codigo": "...", ... } ] }   // llaves: QareExportar.Columnas
//
// ERRORES ({error, tipo}, como qare.ashx)
//   400  fecha mal formada o rango invalido.
//   405  no es GET.
//   500  la consulta fallo; mensaje saneado (DashboardHandler.MensajeSeguro).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web;
using System.Web.Script.Serialization;

public class QareExportarHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        // Un rango largo pasa con facilidad de los 2 MB por omision.
        var json = new JavaScriptSerializer();
        json.MaxJsonLength = int.MaxValue;

        try
        {
            if (context.Request.HttpMethod != "GET")
            {
                context.Response.AppendHeader("Allow", "GET");
                Error(context, json, 405, "Solo se acepta GET.", "MetodoNoPermitido");
                return;
            }

            DateTime inicio, fin;
            QareContrato.Rango(
                context.Request.QueryString["fecha_inicio"],
                context.Request.QueryString["fecha_fin"],
                DashboardDataInfo.HoyEnPresentacion(),
                out inicio, out fin);

            var tickets = QareExportar.Tickets(inicio, fin, BacklogUtil.Filtros(context.Request));

            context.Response.Write(json.Serialize(new Dictionary<string, object>
            {
                { "fechaInicio", Dia(inicio) },
                { "fechaFin", Dia(fin) },
                { "total", tickets.Count },
                { "tickets", tickets },
            }));
        }
        catch (QareSolicitudInvalida ex)
        {
            Error(context, json, 400, ex.Message, "SolicitudInvalida");
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("qare_exportar.ashx", ex);
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
