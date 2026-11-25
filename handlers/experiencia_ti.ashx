<%@ WebHandler Language="C#" Class="ExperienciaTIaTI" %>

// Requerimientos de TI a TI por categoria y periodo, para el boton "Sin TI a
// TI" de la pestana Experiencia (experiencia/experiencia.js). La regla vive
// en App_Code/TicketTIaTI.cs y la lectura en App_Code/ExperienciaTIaTI.cs.
//
// Parametros (opcional):
//     anio=2026   año de la serie por mes, el mismo con el que se pidio
//                 experiencia.ashx. Por omision, el actual.

using System;
using System.Web;

public class ExperienciaTIaTI : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var anio = DashboardParams.Entero(context.Request, "anio", DashboardDataInfo.HoyEnPresentacion().Year);
            return ExperienciaQueries.TIaTI(anio);
        });
    }

    public bool IsReusable { get { return false; } }
}
