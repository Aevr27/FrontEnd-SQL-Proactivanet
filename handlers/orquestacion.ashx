<%@ WebHandler Language="C#" Class="OrquestacionHandler" %>

// Pestaña "Orquestación" (sitio/orquestacion/). La lectura vive en
// App_Code/OrquestacionQueries.cs; las reglas de cada indicador, en las vistas
// del 77 (77_tablero_orquestacion.sql) sobre el esquema orq.
//
// Solo lectura.
//
// PETICION
//   GET orquestacion.ashx
//       -> { "hay_datos": bool,
//            "carga": { numero, archivo, fecha, jobs_en_excel, advertencias,
//                       advertencias_por_tipo: [ { hoja, tipo, cuantas } ] },
//            "parametros": { EjecucionesConsumidasDia },   (sin costos: ver
//                            OrquestacionQueries.LeerParametros)
//            "jobs":      { cols: [...], filas: [[...]] }   (orq.vw_TableroJob)
//            "decomisos": { cols, filas }                    (orq.vw_TableroDecomiso)
//            "historico": { cols, filas }                    (orq.AvanceDiario)
//            "campos": [ { letra, nombre } ], "meta", "hoy" }
//   GET orquestacion.ashx?detalle=1
//       -> { "hay_datos": bool, "detalle": { cols, filas } } (orq.vw_TableroDetalle)
//
// ERRORES ({error, tipo}, como efectividad.ashx)
//   405  no es GET.
//   500  la consulta fallo; mensaje saneado (DashboardHandler.MensajeSeguro).

using System;
using System.Collections.Generic;
using System.Web;
using System.Web.Script.Serialization;

public class OrquestacionHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

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

            var detalle = context.Request.QueryString["detalle"] == "1";
            context.Response.Write(json.Serialize(detalle
                ? OrquestacionQueries.Detalle()
                : OrquestacionQueries.Construir()));
        }
        catch (Exception ex)
        {
            // Ni la traza ni el mensaje crudo de SQL Server salen del
            // servidor: el mismo criterio que efectividad.ashx.
            DashboardHandler.Registrar("orquestacion.ashx", ex);
            Error(context, json, 500, DashboardHandler.MensajeSeguro(ex), ex.GetType().Name);
        }
    }

    private static void Error(HttpContext context, JavaScriptSerializer json, int codigo, string mensaje, string tipo)
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
