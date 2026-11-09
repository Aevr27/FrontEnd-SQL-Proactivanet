<%@ WebHandler Language="C#" Class="Concentracion" %>

// concentracion.ashx - API de solo lectura de la pestaña "Concentracion de
// tickets" (concentracion/concentracion.js).
//
// Aqui solo se lee el parametro, se serializa y se traducen los errores. Que
// procedimiento alimenta cada grafica, el periodo de cada Slot y el orden de
// las filas son de App_Code/ConcentracionContrato.cs; la lectura, de
// App_Code/ConcentracionQueries.cs.
//
// PETICION
//   GET concentracion.ashx[?slot=N]      N entero 0..12; sin slot = 0.
//   El MISMO @Slot va a los tres procedimientos. No hay filtro de servicio:
//   la vista es global (todos los servicios habilitados del catalogo).
//
// RESPUESTA 200
//   {
//     slot: 0, slotMaximo: 12,
//     periodo: { desde: "aaaa-mm-dd", hasta: "aaaa-mm-dd", dias: 30 },
//     pareto:     [ ... ] | null,   // Posicion ASC, TODAS las filas
//     categorias: [ ... ] | null,   // Posicion ASC, TODAS las filas
//     grupos:     [ ... ] | null,   // Posicion ASC, TODAS las filas
//     errores: { <grafica>: "mensaje" },   // solo las que fallaron
//     avisos:  [ "..." ],                  // diferencias con el contrato
//     dataInfo: { ...DashboardDataInfo... }
//   }
//   Cada fila lleva las columnas del procedimiento con su nombre original.
//   null = esa grafica fallo (ver errores); [] = sin tickets en el slot.
//   El Top 10 / 15 lo aplica la pestaña al pintar: el acumulado y el corte
//   del 80 % vienen calculados sobre todas las filas.
//
// ERRORES (mismo formato que DashboardHandler.Responder: {error, tipo})
//   400  slot fuera de 0..12 o no numerico.
//   500  fallaron los tres procedimientos, o falta la cadena de conexion.

using System;
using System.Collections.Generic;
using System.Web;
using System.Web.Script.Serialization;

public class Concentracion : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        var json = new JavaScriptSerializer();
        json.MaxJsonLength = int.MaxValue;   // ~450 categorias con su ruta completa

        try
        {
            int slot = ConcentracionContrato.LeerSlot(context.Request.QueryString["slot"]);
            var r = ConcentracionQueries.Consultar(slot);

            foreach (var fallo in r.Fallos)
                DashboardHandler.Registrar("concentracion.ashx " + fallo.Key, fallo.Value);

            context.Response.Write(json.Serialize(Salida(r)));
        }
        catch (ConcentracionSolicitudInvalida ex)
        {
            Error(context, json, 400, ex.Message, "SolicitudInvalida");
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("concentracion.ashx", ex);
            Error(context, json, 500, DashboardHandler.MensajeSeguro(ex), ex.GetType().Name);
        }
    }

    private static Dictionary<string, object> Salida(ConcentracionResultado r)
    {
        var salida = new Dictionary<string, object>();
        salida["slot"] = r.Slot;
        salida["slotMaximo"] = ConcentracionContrato.SlotMaximo;
        salida["periodo"] = new Dictionary<string, object>
        {
            { "desde", ConcentracionContrato.Dia(r.Desde) },
            { "hasta", ConcentracionContrato.Dia(r.Hasta) },
            { "dias", ConcentracionContrato.DiasSlot },
        };
        foreach (var b in ConcentracionContrato.Bloques) salida[b.Clave] = r.Bloques[b.Clave];
        salida["errores"] = r.Errores;
        salida["avisos"] = r.Avisos;
        /* Frescura y periodo en el contrato compartido: el sello es el fin del
           ultimo ETL de tickets (dbo.EtlLog), como SLA, QA y QARE, guardado en
           la hora local del SQL Server (YaLocal). El periodo son las fechas
           de negocio del Slot. */
        salida["dataInfo"] = DashboardDataInfo.Periodo(
            "Concentracion de tickets",
            DashboardDataInfo.LeerUltimoEtlTickets(),
            ZonaSello.YaLocal,
            ConcentracionContrato.Dia(r.Desde),
            ConcentracionContrato.Dia(r.Hasta),
            "dbo.EtlLog (Proactivanet tickets) sobre dbo.vw_ServicioTickets").AJson();
        return salida;
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
