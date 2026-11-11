<%@ WebHandler Language="C#" Class="Concentracion" %>

// concentracion.ashx - API de solo lectura de la pestaña "Vista general de
// servicios" (concentracion/concentracion.js; el nombre de archivo se quedo
// del primer titulo, "Concentracion de tickets").
//
// Aqui solo se leen los parametros, se serializa y se traducen los errores.
// Periodos, filtros y la cuenta son de App_Code/ConcentracionContrato.cs; la
// lectura, de App_Code/ConcentracionQueries.cs.
//
// PETICION
//   GET concentracion.ashx?modo=slot&slot=N            N 0..12 (sin slot = 0): los
//                                                      Slots 0..N juntos (acumulado)
//   GET concentracion.ashx?modo=mes&mes=aaaa-mm[|aaaa-mm...]  uno o varios del
//                                                      actual y los 12 anteriores (sin mes = el actual)
//       [&so=Nombre|Nombre...]     Service Owner; "(Sin Service Owner)" = sin SO
//       [&grupo=Grupo|Grupo...]    Grupo del ticket
//   Sin modo = slot. Slot y Mes no se combinan: cada modo ignora el otro
//   parametro. Listas separadas por "|".
//
// RESPUESTA 200
//   {
//     modo, slot, mes (el mas reciente elegido), mesesElegidos: ["aaaa-mm", ...],
//     slotMaximo: 12,
//     meses: [ { valor: "aaaa-mm", etiqueta: "Noviembre 2026", enCurso } ],
//     periodo: { desde, hasta, dias, rangos: [ { desde, hasta } ] },  // dias = los de los rangos
//     filtros: { serviceOwners: [...], grupos: [...] },   // los aplicados
//     opciones: { serviceOwners: [ {valor, tickets} ], grupos: [ ... ] },
//     ticketsPeriodo, ticketsFiltrados,
//     cobertura: { diasConTickets, diasEsperados, primerDia, ultimoDia, completa, excluyeHoy },
//     pareto:     [ { Posicion, Servicio, NombreServicio, CantidadTickets, TotalTickets, Porcentaje, PorcentajeAcumulado } ],
//     categorias: [ { Posicion, Categoria, ... } ],
//     grupos:     [ { Posicion, Grupo, ... } ],
//     errores: {}, avisos: [ "..." ],
//     dataInfo: { ...DashboardDataInfo... }
//   }
//   TODAS las filas de cada grafica, con el acumulado y el 80 % sobre todas;
//   el Top 10 / 15 lo aplica la pestaña al pintar. [] = sin tickets.
//
// ERRORES (mismo formato que DashboardHandler.Responder: {error, tipo})
//   400  modo, slot o mes invalidos.
//   500  no se pudo leer el periodo (o el catalogo de dueños con un filtro de
//        Service Owner puesto), o falta la cadena de conexion.

using System;
using System.Collections.Generic;
using System.Linq;
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
            var q = context.Request.QueryString;
            var hoy = ConcentracionContrato.HoyMexico(DateTime.UtcNow);
            var f = new ConcentracionFiltros();
            f.Modo = ConcentracionContrato.LeerModo(q["modo"]);
            if (f.Modo == ConcentracionContrato.ModoMes)
            {
                f.Meses.AddRange(ConcentracionContrato.LeerMeses(q["mes"], hoy));
                f.Mes = f.Meses[0];
            }
            else f.Slot = ConcentracionContrato.LeerSlot(q["slot"]);
            f.ServiceOwners.AddRange(ConcentracionContrato.LeerLista(q["so"]));
            f.Grupos.AddRange(ConcentracionContrato.LeerLista(q["grupo"]));

            var r = ConcentracionQueries.Consultar(f, hoy);
            if (r.FalloDirectorio != null)
                DashboardHandler.Registrar("concentracion.ashx directorio", r.FalloDirectorio);

            context.Response.Write(json.Serialize(Salida(r)));
        }
        catch (ConcentracionSolicitudInvalida ex)
        {
            Error(context, json, 400, ex.Message, "SolicitudInvalida");
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("concentracion.ashx", ex);
            Error(context, json, 500, ConcentracionQueries.MensajeError(ex), ex.GetType().Name);
        }
    }

    private static Dictionary<string, object> Salida(ConcentracionResultado r)
    {
        var f = r.Filtros;
        var meses = new List<Dictionary<string, object>>();
        foreach (var m in ConcentracionContrato.Meses(r.Hoy))
        {
            meses.Add(new Dictionary<string, object>
            {
                { "valor", ConcentracionContrato.Mes(m) },
                { "etiqueta", ConcentracionContrato.NombreMes(m) },
                { "enCurso", m.Year == r.Hoy.Year && m.Month == r.Hoy.Month },
            });
        }

        var salida = new Dictionary<string, object>();
        salida["modo"] = f.Modo;
        salida["slot"] = f.Modo == ConcentracionContrato.ModoSlot ? (object)f.Slot : null;
        salida["mes"] = f.Modo == ConcentracionContrato.ModoMes ? ConcentracionContrato.Mes(f.Mes) : null;
        salida["mesesElegidos"] = f.Modo == ConcentracionContrato.ModoMes
            ? (object)ConcentracionQueries.MesesDe(f).ConvertAll(ConcentracionContrato.Mes) : null;
        salida["slotMaximo"] = ConcentracionContrato.SlotMaximo;
        salida["meses"] = meses;
        salida["periodo"] = new Dictionary<string, object>
        {
            { "desde", ConcentracionContrato.Dia(r.Desde) },
            { "hasta", ConcentracionContrato.Dia(r.Hasta) },
            { "dias", r.Rangos.Sum(x => (x.Value - x.Key).Days + 1) },
            { "rangos", r.Rangos.ConvertAll(x => new Dictionary<string, object>
                { { "desde", ConcentracionContrato.Dia(x.Key) }, { "hasta", ConcentracionContrato.Dia(x.Value) } }) },
        };
        salida["filtros"] = new Dictionary<string, object>
        {
            { "serviceOwners", f.ServiceOwners }, { "grupos", f.Grupos },
        };
        salida["opciones"] = new Dictionary<string, object>
        {
            { "serviceOwners", r.OpcionesServiceOwner }, { "grupos", r.OpcionesGrupo },
        };
        salida["ticketsPeriodo"] = r.TicketsPeriodo;
        salida["ticketsFiltrados"] = r.TicketsFiltrados;
        salida["cobertura"] = r.Cobertura;
        salida["pareto"] = r.Pareto;
        salida["categorias"] = r.Categorias;
        salida["grupos"] = r.Grupos;
        salida["errores"] = new Dictionary<string, object>();
        salida["avisos"] = r.Avisos;
        /* Sello del ETL (dbo.EtlLog), como SLA, QA y QARE, en la hora local del
           SQL Server (YaLocal). El periodo son las fechas de negocio de los Slots
           o de los meses: del dia mas viejo al mas reciente (con meses no
           seguidos, los de en medio no cuentan: ver periodo.rangos). */
        salida["dataInfo"] = DashboardDataInfo.Periodo(
            "Vista general de servicios",
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
