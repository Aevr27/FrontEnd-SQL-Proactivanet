<%@ WebHandler Language="C#" Class="ExperienciaAutomatizados" %>

// Automatizados SLA de Experiencia por periodo y por dueño, en UNA peticion
// (pedirAutomatizados en experiencia/experiencia.js). Sustituye las 10-12
// llamadas a kpis.ashx -una por periodo- que hacia el tablero. La regla y el
// reparto viven en ExperienciaQueries.Automatizados.
//
// Solo lectura: un SELECT sobre vw_Dash_ProductividadBase y los catalogos de
// dueños.
//
// Parametros (GET):
//
//     modo=slot|mes          obligatorio.
//     fecha_inicio, fecha_fin aaaa-mm-dd, los dos incluidos. slot: SLOTs
//                            completos de 30 dias que acaban en fecha_fin;
//                            mes: meses completos de un solo año.
//     tipo=inc|req           opcional, el mismo de kpis.ashx (TipoRegistroSla).
//
// Respuesta:
//
//     { "modo": "slot", "fechaInicio": "...", "fechaFin": "...",
//       "periodos": [ { "periodo": 0, "automatizados": 1500, "resueltos": 9000 } ],
//       "duenos":   [ { "periodo": 0, "director": "...", "po": "...",
//                       "manager": "...", "so": "...", "automatizados": 12 } ] }
//
// Errores como kpis.ashx: 500 con {error, tipo} (DashboardHandler.Responder).

using System;
using System.Globalization;
using System.Web;

public class ExperienciaAutomatizados : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var q = context.Request.QueryString;
            var modo = (q["modo"] ?? "").Trim().ToLowerInvariant();
            return ExperienciaQueries.Automatizados(modo, Fecha(q["fecha_inicio"]), Fecha(q["fecha_fin"]),
                DashboardQueries.TipoRegistroSla.Desde(context.Request));
        });
    }

    private static DateTime Fecha(string valor)
    {
        DateTime salida;
        if (DateTime.TryParseExact((valor ?? "").Trim(), "yyyy-MM-dd",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out salida))
            return salida;
        throw new ArgumentException("Las fechas van como aaaa-mm-dd.");
    }

    public bool IsReusable { get { return false; } }
}
