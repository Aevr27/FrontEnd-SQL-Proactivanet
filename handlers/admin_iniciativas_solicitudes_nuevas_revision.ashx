<%@ WebHandler Language="C#" Class="AdminIniciativasSolicitudesNuevasRevision" %>

// ADM aprueba o rechaza una Nueva solicitud (sql/31, sql/32). Vista
// "Iniciativas" de la pestaña Solicitudes (admin/solicitudes-nuevas.js).
// Escribe con RevisionSolicitudesIniciativa.Revisor
// (App_Code/RevisionSolicitudesIniciativa.cs). La lectura es aparte y sigue
// de solo lectura (admin_iniciativas_solicitudes_nuevas.ashx).
//
//   POST ?accion=aprobar    numero, estado (OBLIGATORIO: el Estado inicial de
//                           la iniciativa; "" = sin estado, queda Incompleta
//                           como en Crear), comentario (opcional)
//     -> 200 { aprobada: true, numero, estado: APROBADA, codigo,
//              iniciativa_nueva (false = ya estaba creada: reintento u otro
//              ADM gano; el MISMO codigo), revisado_por, fecha_revision_utc,
//              faltantes (lo que la iniciativa no tiene: queda Incompleta),
//              advertencias }
//        422 FaltaEstado; 422 IniciativaInvalida { errores, aprobada: false }
//            (la alta de Crear no la acepta con los datos guardados)
//        503 ValidacionNoDisponible (no se pudo leer el catalogo: nada cambia)
//        409 TopeExcedido | CategoriaRepetida | DatoInvalido | CodigoNoEmitido
//            | EscrituraRechazada (adm.usp_GestionAdmin_Crear rechazo: nada
//            se guardo, la solicitud sigue ENVIADA)
//        409 AprobadaSinIniciativa (aprobada con sql/31: no se reprocesa)
//        501 IniciativaNoDisponible (sin sql/32: no se aprueba nada; aprobar
//            sin crear ya no existe)
//   POST ?accion=rechazar   numero, comentario (obligatorio)
//     -> 200 { rechazada: true, numero, estado, revisado_por, fecha_revision_utc }
//   Las dos:
//        400 SinSolicitud / AccionDesconocida;  422 FaltaMotivo / ComentarioLargo
//        404 SolicitudNoExiste;  409 YaRevisada (otro ADM gano, o ya es final)
//        501 RevisionNoDisponible (sin sql/31: nada cambia)
//        500 { tipo: RevisionNoConfirmada, aprobada|rechazada: null } (no se sabe;
//            reintentar aprobar es seguro: devuelve el mismo codigo)
//   403 antes de leer nada: ExigirAdm (anonimo, VIEWER, MOD, solicitante del
//   interruptor). 405 si no es POST.
//
// Quien revisa (y firma la alta) es la identidad Windows del servidor
// (IdentidadEscritura), nunca un campo del formulario. Los datos de la
// iniciativa son los GUARDADOS en la solicitud, nunca los del navegador:
// del formulario solo se toman numero, estado y comentario. No manda
// correos. No toca Cambios (sql/22).

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
            // Estado inicial: tiene que venir (aunque sea vacio = sin estado).
            // No hay uno por omision: lo decide ADM en cada aprobacion.
            var estado = accion == "aprobar" ? req.Form["estado"] : null;
            if (accion == "aprobar" && estado == null)
                return Error(context, 422, RevisionSolicitudesIniciativa.MensajeFaltaEstado, "FaltaEstado");

            var revisor = RevisionSolicitudesIniciativa.Revisor;
            if (!revisor.Disponible())
                return Error(context, 501, RevisionSolicitudesIniciativa.MotivoSinRevision, "RevisionNoDisponible");

            if (accion == "aprobar") return Aprobar(context, revisor, numero, id.Original, comentario, estado.Trim());

            DateTime fecha;
            try
            {
                fecha = revisor.Rechazar(numero, id.Original, comentario);
            }
            catch (ErrorRevisionSolicitudIniciativa ex)
            {
                return ErrorRevision(context, ex, llave);
            }
            catch (Exception ex)
            {
                return NoConfirmada(context, ex, llave);
            }
            return new Dictionary<string, object>
            {
                { llave, true }, { "numero", numero }, { "estado", "RECHAZADA" },
                { "revisado_por", id.Original }, { "fecha_revision_utc", Utc(fecha) },
            };
        });
    }

    private static object Aprobar(HttpContext context, IRevisorSolicitudesIniciativa revisor, int numero,
                                  string firma, string comentario, string estado)
    {
        if (!revisor.CreaIniciativa())
            return Error(context, 501, RevisionSolicitudesIniciativa.MotivoSinIniciativa, "IniciativaNoDisponible");

        // La solicitud GUARDADA: de ella sale la iniciativa.
        var solicitud = RegistroSolicitudesIniciativa.Lector.Detalle(numero);
        if (solicitud == null) return Error(context, 404, "La solicitud no existe.", "SolicitudNoExiste");

        // Solo una ENVIADA se valida y planea. Si ya no lo esta, el
        // procedimiento dice que paso (la misma iniciativa, 51412 o 51414).
        PlanCrearAdmin plan = null;
        ResultadoGestionAdmin r = null;
        if (solicitud["estado"] as string == "ENVIADA")
        {
            var p = AprobacionIniciativa.Peticion(solicitud, estado);
            try
            {
                r = RevisionSolicitudesIniciativa.ValidarAlta(p);
            }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_solicitudes_nuevas_revision.ashx", ex);
                return Error(context, 503, "No se pudo validar la iniciativa contra el catálogo: " + DashboardHandler.MensajeSeguro(ex) +
                             " No se aprobó nada.", "ValidacionNoDisponible");
            }
            if (!r.Valida)
            {
                context.Response.StatusCode = 422;
                context.Response.TrySkipIisCustomErrors = true;
                var salida = r.ComoJson();
                salida["error"] = "No se aprobó: la iniciativa no se puede crear con los datos de la solicitud.";
                salida["tipo"] = "IniciativaInvalida";
                salida["aprobada"] = false;
                return salida;
            }
            plan = PlanificadorGestionAdmin.Crear(p, r, DashboardDataInfo.HoyEnPresentacion());
            if (plan.Pendientes.Count > 0)
            {
                context.Response.StatusCode = 409;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "error", "No se aprobó: " + string.Join(" ", plan.Pendientes.ToArray()) },
                    { "tipo", "PendienteSinRegla" }, { "pendientes", plan.Pendientes }, { "aprobada", false },
                };
            }
        }

        AprobacionConIniciativa a;
        try
        {
            a = revisor.AprobarYCrear(numero, firma, comentario.Length == 0 ? null : comentario, plan);
        }
        catch (ErrorRevisionSolicitudIniciativa ex)
        {
            return ErrorRevision(context, ex, "aprobada");
        }
        catch (ErrorEscrituraGestionAdmin ex)
        {
            // La alta la rechazo: THROW antes del COMMIT, nada se guardo.
            DashboardHandler.Registrar("admin_iniciativas_solicitudes_nuevas_revision.ashx", ex);
            context.Response.StatusCode = 409;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object>
            {
                { "error", "No se aprobó ni se creó la iniciativa: " + ex.Message }, { "numero_error", ex.Numero },
                { "tipo", ex.Tipo }, { "aprobada", false },
            };
        }
        catch (Exception ex)
        {
            return NoConfirmada(context, ex, "aprobada");
        }
        return new Dictionary<string, object>
        {
            { "aprobada", true }, { "numero", numero }, { "estado", "APROBADA" },
            { "codigo", a.Codigo }, { "iniciativa_nueva", a.Nueva },
            { "revisado_por", a.RevisadoPor }, { "fecha_revision_utc", Utc(a.FechaRevisionUtc) },
            { "faltantes", r == null || !a.Nueva ? new List<Dictionary<string, object>>() : r.Faltantes },
            { "advertencias", r == null || !a.Nueva ? new List<string>() : r.Advertencias },
        };
    }

    private static object ErrorRevision(HttpContext context, ErrorRevisionSolicitudIniciativa ex, string llave)
    {
        context.Response.StatusCode = ex.EstadoHttp;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object>
        {
            { "error", ex.Message }, { "numero_error", ex.Numero }, { "tipo", ex.Tipo }, { llave, false },
        };
    }

    // Se mando a la base y no se sabe si quedo: que no se reintente a ciegas.
    private static object NoConfirmada(HttpContext context, Exception ex, string llave)
    {
        DashboardHandler.Registrar("admin_iniciativas_solicitudes_nuevas_revision.ashx", ex);
        context.Response.StatusCode = 500;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object>
        {
            { "error", "No se pudo confirmar la revisión. Actualiza la lista antes de reintentar." },
            { "tipo", "RevisionNoConfirmada" }, { llave, null },
        };
    }

    private static string Utc(DateTime fecha)
    {
        return fecha.ToString("yyyy-MM-ddTHH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) + "Z";
    }

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
