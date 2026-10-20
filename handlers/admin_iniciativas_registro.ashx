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
//                          prefijo,
//                          categorias: [ { categoria, tickets_reduce,
//                                          pct_dism, po, so, director,
//                                          n2 } ],
//                          historial: [ { id, campo, anterior, nuevo,
//                                         operacion, origen, usuario,
//                                         solicitud, fecha, reconstruido } ] } ],
//       "historial_estado": "ok" | "sin_tabla" | "error",
//       "historial_desde": "dd/MM/yyyy" | null,       (App_Code/HistorialFechas.cs)
//       "estados_activos": [...], "agrupadores": [...], "fecha_gen": "dd/MM/yyyy",
//       "tipos_iniciativa": [ { prefijo, nombre } ] }   (dbo.CatPrefijoProblem)
//
// Toda la logica es la de Experiencia: ExperienciaQueries.RegistroIniciativas
// (App_Code/ExperienciaRegistro.cs) reusa sus lecturas y su semaforo.
//
// SOLO LECTURA: SELECT sobre dbo.vw_ProblemCategoria, dbo.Problem,
// dbo.CatPrefijoProblem, dbo.ProblemCategoria, dbo.CatCategoriaDueno y
// dbo.CatPersona (y dbo.Problem.Prefijo por folio + dbo.CatPrefijoProblem para el
// filtro de Tipo de iniciativa) y dbo.ProblemFechaEvento (historial de fechas).
// No crea ni cambia nada en la base.
//
// ACCESO: AccesoAdmin.Exigir (rol ADM o MOD en dbo.UsuariosAdmin); el
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
            var registro = ExperienciaQueries.RegistroIniciativas();
            // Si "Crear iniciativa" / "Modificar" guardan o solo validan
            // (PersistenciaGestionAdmin, const): la pagina rotula sus botones
            // con esto y nunca promete un guardado que no ocurre.
            registro["persistencia_admin"] = PersistenciaGestionAdmin.Activa();
            // Lo mismo para "Solicitar cambios" (sql/22): con false la
            // solicitud se prepara pero no se envia, y la pagina lo dice.
            registro["persistencia_solicitudes"] = PersistenciaSolicitudesCambio.Activa();
            // Solicitar cambios de Titulo / PO / SO (tipo datos, sql/25).
            registro["solicitudes_datos"] = PersistenciaSolicitudesCambio.SolicitaDatosActiva();
            // Modificar con PO / SO capturados y quitar categoria (sql/24):
            // sin esto la pagina no los ofrece (el servidor los rechazaria).
            registro["edicion_duenos_quitar"] = PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva();
            context.Response.Write(serializador.Serialize(registro));
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
