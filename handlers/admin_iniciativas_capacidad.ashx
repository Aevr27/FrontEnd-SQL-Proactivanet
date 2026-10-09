<%@ WebHandler Language="C#" Class="AdminIniciativasCapacidad" %>

// Capacidad de reduccion de UNA categoria, para Nueva solicitud
// (admin/iniciativas.js la pide al elegir la Categoria):
//
//   GET handlers/admin_iniciativas_capacidad.ashx?categoria=/A/B
//     -> { "categoria", "total": 1.0, "usado", "disponible", "determinable",
//          "excedida", "folios": [...], "rutas_relacionadas": [...] }
//
// Fracciones como ProblemCategoria.PctDisminucion (0.4 = 40%). Es solo lo
// que se MUESTRA: al enviar, admin_iniciativas_validar.ashx lo recalcula y
// es quien decide. Regla y fuente: IniciativaService / ExperienciaCapacidad.
//
// SOLO LECTURA. ACCESO: AccesoAdmin.Exigir (whitelist + rol ADM o MOD; 403
// antes de tocar la base). Solo lo usa Nueva solicitud, que es de ADM y MOD.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasCapacidad : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.Exigir(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            var categoria = context.Request.QueryString["categoria"];
            if (string.IsNullOrWhiteSpace(categoria))
            {
                context.Response.StatusCode = 400;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "error", "Falta la categoria." },
                    { "tipo", "SolicitudInvalida" },
                };
            }
            return new IniciativaService().Capacidad(categoria);
        });
    }

    public bool IsReusable { get { return false; } }
}
