<%@ WebHandler Language="C#" Class="BacklogAntiguos" %>

// Listado de los tickets mas viejos que siguen en backlog, para la tabla
// "Tickets mas antiguos" del tablero de Backlog.
//
// dashboard.js lo pide en cargarTodo() con los filtros del tablero
// (backlog_antiguos.ashx?c1=...&grupos=...&lideres=...&fecha_corte=...) y
// espera:
//
//     { "diasMinimo": 120, "tickets": [ { "Lider": "...", "Grupo": "...",
//                                         "Prioridad": "...", ... }, ... ] }
//
// diasMinimo es solo para el texto de la tabla ("tickets con mas de N dias",
// y los meses que dashboard.js calcula dividiendo entre 30); las filas salen
// de dbo.usp_CorreoBacklog_Datos. El tablero no manda ese umbral, asi que se
// usa el que documenta DASHBOARD.md para esta tabla, mas de 4 meses = 120
// dias, y se devuelve el mismo valor que se le paso al procedimiento para
// que el texto y los datos no se contradigan.

using System;
using System.Collections.Generic;
using System.Web;

public class BacklogAntiguos : IHttpHandler
{
    private const int DiasMinimoPorDefecto = 120;

    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var diasMinimo = DashboardParams.Entero(
                context.Request, "dias_minimo", DiasMinimoPorDefecto);

            var parametros = BacklogUtil.Filtros(context.Request);
            parametros["FechaCorte"] = BacklogUtil.FechaCorte(context.Request);
            parametros["DiasMinimo"] = diasMinimo;

            return new Dictionary<string, object>
            {
                { "diasMinimo", diasMinimo },
                { "tickets", DashboardDb.Ejecutar("dbo.usp_CorreoBacklog_Datos", parametros) },
            };
        });
    }

    public bool IsReusable { get { return false; } }
}
