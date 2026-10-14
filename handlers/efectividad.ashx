<%@ WebHandler Language="C#" Class="EfectividadHandler" %>

// Pestaña "Efectividad de iniciativas" (sitio/efectividad/). La lectura vive
// en App_Code/EfectividadQueries.cs; el calculo, en la base
// (60_efectividad_iniciativas.sql, una vez al dia).
//
// Solo lectura.
//
// PETICION
//   GET efectividad.ashx
//       -> { "hay_calculo": bool,
//            "corrida": { fecha_calculo, hoy, compromiso, logro, efectividad,
//                         iniciativas_medidas, iniciativas_en_medicion, ... },
//            "filas": [ { folio, titulo, prefijo, estado, categoria, orden,
//                         motivo, pct, comp, logro, base_mes, esperado_mes,
//                         despues_mes, hoy_mes, se_mide_desde, c1, c1c2, ... } ],
//            "categorias": [ { categoria, nivel, c1, director, po, so, manager } ],
//            "directores", "managers", "jerarquia", "jerarquia_mgr",
//            "meta", "hoy" }
//
// ERRORES ({error, tipo}, como experiencia.ashx)
//   405  no es GET.
//   500  la consulta fallo; mensaje saneado (DashboardHandler.MensajeSeguro).

using System;
using System.Collections.Generic;
using System.Web;
using System.Web.Script.Serialization;

public class EfectividadHandler : IHttpHandler
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

            context.Response.Write(json.Serialize(EfectividadQueries.Construir()));
        }
        catch (Exception ex)
        {
            // Ni la traza ni el mensaje crudo de SQL Server salen del
            // servidor: el mismo criterio que experiencia.ashx.
            DashboardHandler.Registrar("efectividad.ashx", ex);
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
