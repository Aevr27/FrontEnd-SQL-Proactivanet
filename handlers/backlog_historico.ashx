<%@ WebHandler Language="C#" Class="BacklogHistorico" %>

// Series de tendencia del tablero de Backlog: el total por periodo y el
// desglose por lider, sobre los cortes guardados en
// dbo.CorreoBacklogSnapshot.
//
// dashboard.js lo pide en cargarTodo() con los filtros del tablero mas los
// dos controles propios de la grafica
// (backlog_historico.ashx?...&dias=30&granularidad=Dia) y espera:
//
//     { "total":    [ { "Periodo": "...", "TicketsBacklog": 0 }, ... ],
//       "porLider": [ { "FechaCorte": "...", "Lider": "...", "Tickets": 0 }, ... ] }
//
// Son dos procedimientos distintos, uno por serie:
// dbo.usp_CorreoBacklog_Historico para el total y
// dbo.usp_CorreoBacklog_HistoricoPorLider para el desglose, que es el
// formato que mock-data.js reproduce en mockBacklog().
//
// Los filtros se leen con BacklogUtil, igual que en los demas handlers de
// backlog. Los defaults de dias y granularidad son los mismos que trae el
// HTML, asi que una llamada sin esos parametros devuelve lo que muestra el
// tablero al abrirse.

using System;
using System.Collections.Generic;
using System.Web;

public class BacklogHistorico : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var parametros = BacklogUtil.Filtros(context.Request);
            parametros["Dias"] = DashboardParams.Entero(context.Request, "dias", 30);
            parametros["Granularidad"] = Granularidad(context.Request);

            return new Dictionary<string, object>
            {
                { "total",    DashboardDb.Ejecutar("dbo.usp_CorreoBacklog_Historico", parametros) },
                { "porLider", DashboardDb.Ejecutar("dbo.usp_CorreoBacklog_HistoricoPorLider", parametros) },
            };
        });
    }

    private static object Granularidad(HttpRequest request)
    {
        var valor = request.QueryString["granularidad"];
        // Los valores que manda el <select> son Dia / Semana / Mes.
        return string.IsNullOrWhiteSpace(valor) ? "Dia" : valor;
    }

    public bool IsReusable { get { return false; } }
}
