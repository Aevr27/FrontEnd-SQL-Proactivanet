<%@ WebHandler Language="C#" Class="BacklogCategoriasHandler" %>

// Backlog por Lider, Grupo y Categoria de un corte de
// dbo.CorreoBacklogSnapshot, para la pestaña "Lider (Categoria)" del tablero
// de Backlog. La consulta, la jerarquia y por que no sale de
// usp_CorreoBacklog_Principal viven en App_Code/BacklogCategorias.cs.
//
// backlog/backlog.js lo pide en cargarTodo() con los mismos filtros que
// backlog_resumen.ashx (?c1=...&grupos=...&lideres=...&fecha_corte=...) y
// espera:
//
//     { "filas": [ { "Lider": "...", "Grupo": "...", "C1": "...",
//                    "Categoria": "/C1/C2/...", "Critica": 0, "Alta": 0,
//                    "Mas30": 0, "FueraSLA": 0, "Total": 0 }, ... ] }
//
// Con modo=tickets devuelve los tickets de UN nodo del arbol, con los mismos
// filtros mas:
//
//     nodo_lider / nodo_sin_lider=1   el lider de la rama
//     nodo_c1    / nodo_sin_c1=1      su C1
//     nodo_ruta                       JSON: segmentos bajo C1, en orden
//                                     ([] o ausente = el C1 entero)
//     nodo_exacto=1                   solo los registrados en el nodo mismo
//     nodo_grupo                      el grupo del cross-filter, si hay
//
//     { "tickets": [ ... ], "total": 123, "tope": 500 }
//
// Solo lectura. Errores como el resto de handlers (DashboardHandler).

using System.Collections.Generic;
using System.Web;
using System.Web.Script.Serialization;

public class BacklogCategoriasHandler : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var q = context.Request.QueryString;
            var filtros = BacklogUtil.Filtros(context.Request);
            var corte = BacklogUtil.FechaCorte(context.Request);
            if (q["modo"] == "tickets")
            {
                var nodo = new BacklogCategorias.Nodo
                {
                    Lider = q["nodo_sin_lider"] == "1" ? null : (q["nodo_lider"] ?? ""),
                    C1 = q["nodo_sin_c1"] == "1" ? null : q["nodo_c1"],
                    Grupo = string.IsNullOrEmpty(q["nodo_grupo"]) ? null : q["nodo_grupo"],
                    Exacto = q["nodo_exacto"] == "1",
                };
                var ruta = q["nodo_ruta"];
                if (!string.IsNullOrEmpty(ruta))
                    foreach (var seg in new JavaScriptSerializer().Deserialize<List<string>>(ruta))
                        nodo.Ruta.Add(seg ?? "");
                return BacklogCategorias.Tickets(filtros, corte, nodo);
            }
            return new Dictionary<string, object>
            {
                { "filas", BacklogCategorias.Leer(filtros, corte) },
            };
        });
    }

    public bool IsReusable { get { return false; } }
}
