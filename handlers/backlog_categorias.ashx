<%@ WebHandler Language="C#" Class="BacklogCategoriasHandler" %>

// Backlog por Lider, Grupo y Categoria (C1) de un corte de
// dbo.CorreoBacklogSnapshot, para la pestaña "Lider (Categoria)" del tablero
// de Backlog. La consulta y por que no sale de usp_CorreoBacklog_Principal
// viven en App_Code/BacklogCategorias.cs.
//
// backlog/backlog.js lo pide en cargarTodo() con los mismos filtros que
// backlog_resumen.ashx (?c1=...&grupos=...&lideres=...&fecha_corte=...) y
// espera:
//
//     { "filas": [ { "Lider": "...", "Grupo": "...", "C1": "...",
//                    "Critica": 0, "Alta": 0, "Mas30": 0,
//                    "FueraSLA": 0, "Total": 0 }, ... ] }
//
// Solo lectura. Errores como el resto de handlers (DashboardHandler).

using System.Collections.Generic;
using System.Web;

public class BacklogCategoriasHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var filtros = BacklogUtil.Filtros(context.Request);
            var corte = BacklogUtil.FechaCorte(context.Request);
            return new Dictionary<string, object>
            {
                { "filas", BacklogCategorias.Leer(filtros, corte) },
            };
        });
    }

    public bool IsReusable { get { return false; } }
}
