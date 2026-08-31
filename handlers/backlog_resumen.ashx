<%@ WebHandler Language="C#" Class="BacklogResumen" %>

// Cuerpo del tablero de Backlog: KPIs, backlog por prioridad, antiguedad,
// SLA, reasignaciones y reaperturas de un corte de dbo.CorreoBacklogSnapshot.
//
// dashboard.js lo pide en cargarTodo() con los filtros del tablero
// (backlog_resumen.ashx?c1=...&grupos=...&lideres=...&fecha_corte=...) y
// espera:
//
//     { "kpis": { "BacklogTotal": 0, "Criticos": 0, "Altos": 0,
//                 "Mayor30Dias": 0, "Reasignados": 0, "Reabiertos": 0 },
//       "prioridad": [...], "aging": [...], "sla": [...],
//       "reasignaciones": [...], "reabiertos": [...] }
//
// dbo.usp_CorreoBacklog_Principal devuelve esos seis result sets en el mismo
// orden en que mock-data.js arma el objeto (mockBacklog): kpis primero, con
// una sola fila, y los cinco restantes como listas. Si alguno saliera vacio,
// revisar el orden dentro del procedimiento: aqui se mapea por posicion.
//
// Los filtros y la fecha de corte se leen con BacklogUtil, que ya existia en
// App_Code/DashboardDb.cs para estos handlers: lista vacia = NULL = sin
// filtro, y fecha_corte vacia = NULL = el corte mas reciente disponible.

using System;
using System.Collections.Generic;
using System.Web;

public class BacklogResumen : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var parametros = BacklogUtil.Filtros(context.Request);
            parametros["FechaCorte"] = BacklogUtil.FechaCorte(context.Request);

            var sets = DashboardDb.EjecutarMultiple("dbo.usp_CorreoBacklog_Principal", parametros);

            return new Dictionary<string, object>
            {
                { "kpis",          PrimeraFila(sets, 0) },
                { "prioridad",     Filas(sets, 1) },
                { "aging",         Filas(sets, 2) },
                { "sla",           Filas(sets, 3) },
                { "reasignaciones", Filas(sets, 4) },
                { "reabiertos",    Filas(sets, 5) },
            };
        });
    }

    private static List<Dictionary<string, object>> Filas(
        List<List<Dictionary<string, object>>> resultados, int indice)
    {
        if (resultados == null || indice < 0 || indice >= resultados.Count)
            return new List<Dictionary<string, object>>();
        return resultados[indice];
    }

    // Los KPIs viajan como objeto, no como lista: el procedimiento devuelve
    // una sola fila. Sin filas se devuelve un objeto vacio y el tablero pinta
    // los contadores en cero en vez de romperse.
    private static Dictionary<string, object> PrimeraFila(
        List<List<Dictionary<string, object>>> resultados, int indice)
    {
        var filas = Filas(resultados, indice);
        return filas.Count > 0 ? filas[0] : new Dictionary<string, object>();
    }

    public bool IsReusable { get { return false; } }
}
