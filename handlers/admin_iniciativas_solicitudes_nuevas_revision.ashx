<%@ WebHandler Language="C#" Class="AdminIniciativasSolicitudesNuevasRevision" %>

// ADM aprueba o rechaza una Nueva solicitud (sql/31). Vista "Iniciativas"
// de la pestaña Solicitudes (admin/solicitudes-nuevas.js). Escribe con
// RevisionSolicitudesIniciativa.Revisor (App_Code/RevisionSolicitudesIniciativa.cs).
// La lectura es aparte y sigue de solo lectura
// (admin_iniciativas_solicitudes_nuevas.ashx).
//
//   POST ?accion=aprobar    numero, comentario (opcional)
//   POST ?accion=rechazar   numero, comentario (obligatorio)
//     -> 200 { aprobada|rechazada: true, numero, estado, revisado_por, fecha_revision_utc }
//        400 SinSolicitud / AccionDesconocida;  422 FaltaMotivo / ComentarioLargo
//        404 SolicitudNoExiste;  409 YaRevisada (otro ADM gano, o ya es final)
//        501 RevisionNoDisponible (sin sql/31: nada cambia)
//        500 { tipo: RevisionNoConfirmada, aprobada|rechazada: null } (no se sabe)
//   403 antes de leer nada: ExigirAdm (anonimo, VIEWER, MOD, solicitante del
//   interruptor). 405 si no es POST.
//
// Quien revisa es la identidad Windows del servidor (IdentidadEscritura),
// nunca un campo del formulario. APROBADA no crea ninguna iniciativa. No
// manda correos. No toca Cambios (sql/22).

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasSolicitudesNuevasRevision : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, RevisionSolicitudesIniciativa.MensajeSoloAdm)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            if (!string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa POST.", "MetodoNoPermitido");
            // La accion va en la URL: se decide sin leer el cuerpo.
            var accion = req.QueryString["accion"];
            if (accion != "aprobar" && accion != "rechazar")
                return Error(context, 400, "Acción desconocida.", "AccionDesconocida");
            var llave = accion == "aprobar" ? "aprobada" : "rechazada";

            var id = AccesoAdmin.IdentidadEscritura(context);
            if (id == null)
                return Error(context, 403, "Sin usuario autenticado no se puede revisar la solicitud.", "SinUsuario");

            var numero = RegistroSolicitudesIniciativa.Numero(req.Form["numero"]);
            if (numero == 0) return Error(context, 400, "Falta el número de la solicitud.", "SinSolicitud");
            var comentario = (req.Form["comentario"] ?? "").Trim();
            if (accion == "rechazar" && comentario.Length == 0)
                return Error(context, 422, RevisionSolicitudesIniciativa.MensajeFaltaMotivo, "FaltaMotivo");
            if (comentario.Length > RevisionSolicitudesIniciativa.MaximoComentario)
                return Error(context, 422, RevisionSolicitudesIniciativa.MensajeComentarioLargo, "ComentarioLargo");

            var revisor = RevisionSolicitudesIniciativa.Revisor;
            if (!revisor.Disponible())
                return Error(context, 501, RevisionSolicitudesIniciativa.MotivoSinRevision, "RevisionNoDisponible");

            DateTime fecha;
            try
            {
                fecha = accion == "aprobar"
                    ? revisor.Aprobar(numero, id.Original, comentario.Length == 0 ? null : comentario)
                    : revisor.Rechazar(numero, id.Original, comentario);
            }
            catch (ErrorRevisionSolicitudIniciativa ex)
            {
                context.Response.StatusCode = ex.EstadoHttp;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "error", ex.Message }, { "numero_error", ex.Numero }, { "tipo", ex.Tipo }, { llave, false },
                };
            }
            catch (Exception ex)
            {
                // Se mando a la base y no se sabe si quedo: que no se reintente a ciegas.
                DashboardHandler.Registrar("admin_iniciativas_solicitudes_nuevas_revision.ashx", ex);
                context.Response.StatusCode = 500;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "error", "No se pudo confirmar la revisión. Actualiza la lista antes de reintentar." },
                    { "tipo", "RevisionNoConfirmada" }, { llave, null },
                };
            }
            return new Dictionary<string, object>
            {
                { llave, true }, { "numero", numero }, { "estado", accion == "aprobar" ? "APROBADA" : "RECHAZADA" },
                { "revisado_por", id.Original },
                { "fecha_revision_utc", fecha.ToString("yyyy-MM-ddTHH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) + "Z" },
            };
        });
    }

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
