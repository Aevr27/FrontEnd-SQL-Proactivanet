<%@ WebHandler Language="C#" Class="Qare" %>

// qare.ashx - API de solo lectura de la pestaña QARE (qare/qare.js).
//
// Aqui solo se leen los parametros, se serializa y se traducen los errores.
// Que procedimiento alimenta cada bloque y en que orden van sus filas es de
// App_Code/QareContrato.cs; la lectura, de App_Code/QareQueries.cs.
//
// PETICION
//   GET qare.ashx[?fecha_inicio=aaaa-mm-dd][&fecha_fin=aaaa-mm-dd]
//   Sin fechas: los 15 dias naturales que terminan HOY (dia de Mexico), el
//   mismo default que los SP. Las fechas llegan a @FechaInicio / @FechaFin
//   TAL CUAL, sin sumar ni restar dias: los SP filtran FechaFirmaSolucion con
//   el dia fin incluido (verificado en la VM, sql/diag_qare_contrato.sql).
//
// RESPUESTA 200
//   {
//     fechaInicio, fechaFin,          // "aaaa-mm-dd", las que se usaron
//     kpis:                 { ...usp_CorreoQARE_KPIs... } | null,
//     frecuencia:           [ ... ] | null,   // orden de la guia; + FrecuenciaGuia
//                                             // (ver QareContrato.NivelesFrecuencia)
//     causaRaiz:            [ ... ] | null,   // Posicion ASC
//     recurrentesCategoria: [ ... ] | null,   // Posicion ASC
//     confirmacionVsQa:     [ ... ] | null,   // orden del procedimiento
//     tipoSolucion:         [ ... ] | null,   // Posicion ASC
//     errores: { <bloque>: "mensaje" },       // solo los bloques que fallaron
//     avisos:  [ "..." ],                     // diferencias con la guia visual
//     dataInfo: { ...DashboardDataInfo... }
//   }
//   Cada fila lleva las columnas del procedimiento con su nombre original.
//   null = ese bloque fallo (ver errores); [] = sin datos en el rango.
//
// ERRORES (mismo formato que DashboardHandler.Responder: {error, tipo})
//   400  fecha mal formada o rango invalido.
//   500  fallaron los seis procedimientos, o falta la cadena de conexion.
//   El mensaje nunca lleva servidor, base, login ni traza; el detalle va a la
//   traza de ASP.NET (DashboardHandler.Registrar).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web;
using System.Web.Script.Serialization;

public class Qare : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        // El tablero se refresca a mano; nunca conviene servirlo de cache.
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        var json = new JavaScriptSerializer();

        try
        {
            DateTime inicio, fin;
            QareContrato.Rango(
                context.Request.QueryString["fecha_inicio"],
                context.Request.QueryString["fecha_fin"],
                DashboardDataInfo.HoyEnPresentacion(),
                out inicio, out fin);

            var r = QareQueries.Consultar(inicio, fin);

            // Los bloques que fallaron: el navegador ya recibe su mensaje en
            // "errores"; el detalle completo, a la traza.
            foreach (var fallo in r.Fallos)
                DashboardHandler.Registrar("qare.ashx " + fallo.Key, fallo.Value);

            context.Response.Write(json.Serialize(Salida(r)));
        }
        catch (QareSolicitudInvalida ex)
        {
            Error(context, json, 400, ex.Message, "SolicitudInvalida");
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("qare.ashx", ex);
            Error(context, json, 500, DashboardHandler.MensajeSeguro(ex), ex.GetType().Name);
        }
    }

    private static Dictionary<string, object> Salida(QareResultado r)
    {
        var salida = new Dictionary<string, object>();
        salida["fechaInicio"] = Dia(r.FechaInicio);
        salida["fechaFin"] = Dia(r.FechaFin);
        foreach (var b in QareContrato.Bloques) salida[b.Clave] = r.Bloques[b.Clave];
        salida["errores"] = r.Errores;
        salida["avisos"] = r.Avisos;
        salida["dataInfo"] = DatosInfo(r).AJson();
        return salida;
    }

    /* Frescura y periodo en el contrato compartido (DashboardDataInfo).

       El sello es el fin del ultimo ETL de tickets en dbo.EtlLog, el mismo que
       publican SLA y QA: vw_CorreoQARECierre_Base vive sobre las tablas que
       carga ese ETL en esta misma base. Esta guardado en UTC y se declara
       como tal; lo pasa a UTC-06 DashboardDataInfo y nadie mas. El periodo
       son las dos fechas de negocio que se mandaron a los procedimientos y
       no cambian de zona. */
    private static DashboardDataInfo DatosInfo(QareResultado r)
    {
        return DashboardDataInfo.Periodo(
            "QARE",
            DashboardDataInfo.LeerUltimoEtlTickets(),
            ZonaSello.Utc,
            Dia(r.FechaInicio),
            Dia(r.FechaFin),
            "dbo.EtlLog (Proactivanet tickets) sobre dbo.vw_CorreoQARECierre_Base");
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
