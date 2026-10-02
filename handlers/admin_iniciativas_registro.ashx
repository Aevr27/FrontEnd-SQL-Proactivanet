<%@ WebHandler Language="C#" Class="AdminIniciativasRegistro" %>

// Registro de iniciativas de admin/iniciativas.html (vista Iniciativas):
// las iniciativas que hoy pinta Experiencia, una por folio, con sus
// categorias. admin/registro-iniciativas.js lo pide una vez al abrir la
// pagina, sin query string, y espera:
//
//     { "iniciativas": [ { folio, titulo, agrup, estado, tickets_reduce,
//                          vol_reduce_folio, riesgo_folio, retrazado,
//                          sem_fecha, fecha_retrasada, f_analisis, f_solucion,
//                          f_cierre, n_analisis, n_solucion, n_cierre,
//                          antiguedad, po, so, director, manager,
//                          descripcion, observaciones, titulo_problem,
//                          activa, seguimiento, sin_categoria,
//                          tipo_iniciativa,
//                          categorias: [ { categoria, tickets_reduce,
//                                          pct_dism, po, so, director } ] } ],
//       "estados_activos": [...], "agrupadores": [...], "fecha_gen": "dd/MM/yyyy" }
//
// Toda la logica es la de Experiencia: ExperienciaQueries.RegistroIniciativas
// (App_Code/ExperienciaRegistro.cs) reusa sus lecturas y su semaforo.
//
// SOLO LECTURA: SELECT sobre dbo.vw_ProblemCategoria, dbo.Problem,
// dbo.CatPrefijoProblem, dbo.ProblemCategoria, dbo.CatCategoriaDueno y
// dbo.CatPersona (y dbo.Problem.TipoIniciativa por folio). No crea ni cambia nada en la base.
//
// ACCESO: solo las cuentas de AdminAllowedUsers (AccesoAdmin.Exigir); el
// resto recibe 403 antes de tocar la base.
//
// POR QUE NO USA DashboardHandler.Responder: el mismo motivo que
// experiencia.ashx. Descripcion y Observaciones de ~1000 iniciativas pueden
// pasar el MaxJsonLength de 2 MB de ese helper; aqui se sube el tope y el
// error sale con el mismo formato {error, tipo} y HTTP 500.

using System;
using System.Collections.Generic;
using System.Web;
using System.Web.Script.Serialization;

public class AdminIniciativasRegistro : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.Exigir(context)) return;

        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        var serializador = new JavaScriptSerializer();
        serializador.MaxJsonLength = int.MaxValue;

        try
        {
            context.Response.Write(serializador.Serialize(ExperienciaQueries.RegistroIniciativas()));
        }
        catch (Exception ex)
        {
            context.Response.StatusCode = 500;
            context.Response.TrySkipIisCustomErrors = true;
            DashboardHandler.Registrar("admin_iniciativas_registro.ashx", ex);

            var error = new Dictionary<string, object>
            {
                { "error", DashboardHandler.MensajeSeguro(ex) },
                { "tipo", ex.GetType().Name },
            };
            context.Response.Write(serializador.Serialize(error));
        }
    }

    public bool IsReusable { get { return false; } }
}
