<%@ WebHandler Language="C#" Class="Llamadas" %>

// Llamadas del Call Center para la pestana de SLA y productividad.
//
// Un solo handler para las tarjetas, las cuatro graficas y el catalogo de
// campanas: son tres procedimientos, pero el tablero los pide siempre juntos
// y separarlos en tres .ashx solo agregaria viajes.
//
// El filtro de grupo NO se pasa: una llamada no tiene grupo resolutor. El
// filtro propio es la campana.
//
// El de tecnicos solo mueve "Atencion por agente": con tecnicos elegidos ese
// result set se reemplaza por DashboardQueries.LlamadasPorAgente, que cruza
// la extension con el tecnico por dbo.vw_TecnicoAgente. Las tarjetas y las
// otras tres graficas son de toda la cola y no cambian. Sin tecnicos todo
// sale del procedimiento, como siempre.

using System.Collections.Generic;
using System.Web;

public class Llamadas : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            string fi, ff;
            DashboardParams.RangoFechas(context.Request, out fi, out ff);

            var parametros = new Dictionary<string, object>
            {
                { "FechaInicio", fi },
                { "FechaFin", ff },
                { "Campanas", DashboardParams.ListaONulo(context.Request, "campanas") },
            };

            var kpis = DashboardDb.Ejecutar("dbo.usp_Dash_LlamadasKpis", parametros);
            var graficas = DashboardDb.EjecutarMultiple("dbo.usp_Dash_LlamadasGraficas", parametros);
            var filtros = DashboardQueries.Filtros.Desde(context.Request);
            if (filtros.Tecnicos.Count > 0 && graficas.Count > 3)
            {
                graficas[3] = DashboardQueries.LlamadasPorAgente(
                    filtros, DashboardQueries.Lista(context.Request.QueryString["campanas"]), 15);
            }

            var campanas = DashboardDb.Ejecutar("dbo.usp_Dash_LlamadasCatalogos",
                                                new Dictionary<string, object>());

            var vacio = new List<Dictionary<string, object>>();
            return new Dictionary<string, object>
            {
                { "kpis", kpis.Count > 0 ? (object)kpis[0] : new Dictionary<string, object>() },
                { "tendencia", graficas.Count > 0 ? graficas[0] : vacio },
                { "campana",   graficas.Count > 1 ? graficas[1] : vacio },
                { "hora",      graficas.Count > 2 ? graficas[2] : vacio },
                { "agente",    graficas.Count > 3 ? graficas[3] : vacio },
                { "catalogo",  campanas },
            };
        });
    }

    public bool IsReusable { get { return false; } }
}
