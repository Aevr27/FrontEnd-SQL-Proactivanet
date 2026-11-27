<%@ WebHandler Language="C#" Class="Tecnicos" %>

// tecnicos.ashx - API de solo lectura de la pestaña Tecnicos (tecnicos/tecnicos.js).
//
// Aqui solo se leen los parametros, se serializa y se traducen los errores.
// El contrato (que SP y que result set alimenta cada bloque) es de
// App_Code/TecnicosContrato.cs; la lectura, de App_Code/TecnicosQueries.cs.
//
// PETICION
//   GET tecnicos.ashx[?fecha_inicio=aaaa-mm-dd][&fecha_fin=aaaa-mm-dd]
//   Sin fechas: los 15 dias que terminan HOY (dia de Mexico). Las dos fechas
//   llegan SIEMPRE a los cuatro SP: con NULL leerian todo el historial.
//   No hay mas filtros en esta version: ver TecnicosContrato, FILTROS.
//
// RESPUESTA 200
//   {
//     fechaInicio, fechaFin,       // "aaaa-mm-dd", las que se usaron
//     kpis:         { ... } | null,   // usp_QARE_CalidadCaptura_KPIs
//     distribucion: [ ... ] | null,   // usp_QARE_PatronesSolucion, result set 1
//     pareto:       [ ... ] | null,   //   result set 2, Posicion ASC
//     resumen:      { ... } | null,   //   result set 3
//     tecnicos:     [ ... ] | null,   // usp_QARE_CalidadCaptura_Tecnicos, orden del SP
//     detalle:      [ ... ] | null,   // usp_QARE_DetalleEvidencia, orden del SP
//     detalleTraeTipo: bool,          // el Detalle trae TipoClasificacionRespuesta (sql/47)
//     errores: { <bloque>: "mensaje" },
//     avisos:  [ "..." ],
//     dataInfo: { ...DashboardDataInfo... }
//   }
//   null = ese bloque fallo (ver errores); [] = sin datos en el rango.
//
// ERRORES ({error, tipo}, como DashboardHandler.Responder)
//   400  fecha mal formada o rango invalido.
//   500  fallaron los cuatro procedimientos, o falta la cadena de conexion.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web;
using System.Web.Script.Serialization;

public class Tecnicos : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        // El Detalle trae una fila por ticket con sus textos: el tope por
        // omision del serializador (2 MB) se queda corto con un mes de datos.
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        try
        {
            DateTime inicio, fin;
            TecnicosContrato.Rango(
                context.Request.QueryString["fecha_inicio"],
                context.Request.QueryString["fecha_fin"],
                DashboardDataInfo.HoyEnPresentacion(),
                out inicio, out fin);

            var r = TecnicosQueries.Consultar(inicio, fin);

            foreach (var fallo in r.Fallos)
                DashboardHandler.Registrar("tecnicos.ashx " + fallo.Key, fallo.Value);

            context.Response.Write(json.Serialize(Salida(r)));
        }
        catch (TecnicosSolicitudInvalida ex)
        {
            Error(context, json, 400, ex.Message, "SolicitudInvalida");
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("tecnicos.ashx", ex);
            Error(context, json, 500, DashboardHandler.MensajeSeguro(ex), ex.GetType().Name);
        }
    }

    private static Dictionary<string, object> Salida(TecnicosResultado r)
    {
        var salida = new Dictionary<string, object>();
        salida["fechaInicio"] = Dia(r.FechaInicio);
        salida["fechaFin"] = Dia(r.FechaFin);
        foreach (var b in TecnicosContrato.Bloques) salida[b.Clave] = r.Bloques[b.Clave];
        salida["detalleTraeTipo"] = r.DetalleTraeTipo;
        salida["errores"] = r.Errores;
        salida["avisos"] = r.Avisos;
        salida["dataInfo"] = DashboardDataInfo.Periodo(
            "Técnicos",
            DashboardDataInfo.LeerUltimoEtlTickets(),
            ZonaSello.YaLocal,
            Dia(r.FechaInicio),
            Dia(r.FechaFin),
            "dbo.EtlLog (Proactivanet tickets) sobre dbo.vw_QARE_CalidadCaptura").AJson();
        return salida;
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
