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
// GET ?export=1 (solo al pulsar "Descargar iniciativas"): las columnas que
// el registro no trae y el Excel si, de todas las vigentes:
//     { "iniciativas": [ { folio, gerencia, direccion, tipo_iniciativa,
//                          prioridad, impacto, rca, volumetria_original,
//                          f_entrega_prb } ],                (dbo.Problem)
//       "categorias":  [ { folio, categoria, tipo_ticket, tipo_iniciativa,
//                          mes_reduccion } ] }      (dbo.ProblemCategoria)
// (ExperienciaQueries.RegistroExportExtra). El navegador las cruza con lo
// que ya filtro; el servidor no recibe folios. export distinto de 1: 400.
//
// SOLO LECTURA: SELECT sobre dbo.vw_ProblemCategoria, dbo.Problem,
// dbo.CatPrefijoProblem, dbo.ProblemCategoria, dbo.CatCategoriaDueno y
// dbo.CatPersona (y dbo.Problem.Prefijo por folio + dbo.CatPrefijoProblem para el
// filtro de Tipo de iniciativa) y dbo.ProblemFechaEvento (historial de fechas).
// No crea ni cambia nada en la base.
//
// ACCESO: AccesoIniciativas.ExigirRegistro: todos, tambien anonimos
// (2026-10-29; no depende de dbo.UsuariosAdmin, PO/SO ni del interruptor).
// Que un anonimo llegue depende de la autenticacion del sitio en IIS. "subestado" de cada
// iniciativa y "subestados_problem" salen solo con rol ADM.
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
        if (!AccesoIniciativas.ExigirRegistro(context)) return;

        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        var serializador = new JavaScriptSerializer();
        serializador.MaxJsonLength = int.MaxValue;

        try
        {
            // ?export=1: SOLO las columnas extra de "Descargar iniciativas"
            // (ExperienciaQueries.RegistroExportExtra, dos SELECT), detras
            // del mismo ExigirRegistro. Sin el parametro, el registro de
            // siempre, que no las lee. Otro valor: 400.
            var export = context.Request.QueryString["export"];
            if (export != null)
            {
                if (export != "1")
                {
                    context.Response.StatusCode = 400;
                    context.Response.TrySkipIisCustomErrors = true;
                    var malo = new Dictionary<string, object>
                    {
                        { "error", "Parametro export invalido: solo se acepta export=1." },
                        { "tipo", "ParametroInvalido" },
                    };
                    context.Response.Write(serializador.Serialize(malo));
                    return;
                }
                context.Response.Write(serializador.Serialize(ExperienciaQueries.RegistroExportExtra()));
                return;
            }

            var registro = ExperienciaQueries.RegistroIniciativas();
            // Subestado: solo ADM lo ve (ExperienciaQueries.OcultarSubestado).
            // Ocultarlo en la pagina no basta: sin ADM no sale del servidor.
            if (AccesoAdmin.Rol(context) != RolAdmin.Adm) ExperienciaQueries.OcultarSubestado(registro);
            // Si "Crear iniciativa" / "Modificar" guardan o solo validan
            // (PersistenciaGestionAdmin, const): la pagina rotula sus botones
            // con esto y nunca promete un guardado que no ocurre.
            registro["persistencia_admin"] = PersistenciaGestionAdmin.Activa();
            // Lo mismo para "Solicitar cambios" (sql/22): con false la
            // solicitud se prepara pero no se envia, y la pagina lo dice.
            // Se revisa en la base (DeteccionSolicitudesCambio, tambien
            // sql/25); si no se puede, apagado.
            try { DeteccionSolicitudesCambio.Revisar(); }
            catch (Exception ex) { DashboardHandler.Registrar("admin_iniciativas_registro.ashx", ex); }
            registro["persistencia_solicitudes"] = PersistenciaSolicitudesCambio.Activa();
            // Solicitar cambios de Titulo / PO / SO (tipo datos, sql/25).
            registro["solicitudes_datos"] = PersistenciaSolicitudesCambio.SolicitaDatosActiva();
            // Varios cambios en UNA solicitud (tipo varios, sql/34).
            registro["solicitudes_varios"] = PersistenciaSolicitudesCambio.SolicitaVariosActiva();
            // Modificar con PO / SO capturados y quitar categoria (sql/24):
            // sin esto la pagina no los ofrece (el servidor los rechazaria).
            // Se revisa en la base (DeteccionSql24); si no se puede, apagado.
            bool duenosYQuitar;
            try { duenosYQuitar = DeteccionSql24.Revisar(); }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_registro.ashx", ex);
                duenosYQuitar = false;
            }
            registro["edicion_duenos_quitar"] = duenosYQuitar;
            // Crear con Volumetria fijada por ADM (sql/26, DeteccionSql26):
            // sin esto la pagina no ofrece el campo (el servidor lo rechazaria).
            bool volumetriaManual;
            try { volumetriaManual = DeteccionSql26.Revisar(); }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_registro.ashx", ex);
                volumetriaManual = false;
            }
            registro["volumetria_manual"] = volumetriaManual;
            // Crear con Subestado inicial (sql/27, DeteccionSql27): igual.
            bool subestadoAlta;
            try { subestadoAlta = DeteccionSql27.Revisar(); }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_registro.ashx", ex);
                subestadoAlta = false;
            }
            registro["subestado_alta"] = subestadoAlta;
            // "Solicitar cambios" del PO / SO (sql/37): los folios a los que
            // esta cuenta SIN rol de Admin puede pedir cambios (los suyos).
            // Solo pinta el boton; el envio vuelve a decidir (SolicitudCambioPso).
            registro["cambios_pso"] = FoliosPso(context, registro);
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

    // ADM / MOD: vacio (usan su rol). Sin sql/37, sin ser PO/SO vigente o
    // con un error al leer: vacio (falla cerrado; el error se registra).
    private static List<string> FoliosPso(HttpContext context, Dictionary<string, object> registro)
    {
        try
        {
            if (RolAdmin.EsElevado(AccesoAdmin.Rol(context)) || !PersistenciaSolicitudesCambio.SolicitaPsoActiva()
                || AccesoIniciativas.Motivo(context) != null) return new List<string>();
            object filas;
            registro.TryGetValue("iniciativas", out filas);
            var lectura = AccesoIniciativas.Lectura(context);
            return SolicitudCambioPso.FoliosPropios(AccesoAdmin.IdentidadEscritura(context), lectura.Personas,
                                                    filas as System.Collections.IEnumerable,
                                                    PersistenciaSolicitudesCambio.SolicitaPsoEquipoActiva() ? lectura.Directorio : null);
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("admin_iniciativas_registro.ashx", ex);
            return new List<string>();
        }
    }

    public bool IsReusable { get { return false; } }
}
