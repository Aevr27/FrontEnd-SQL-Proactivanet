<%@ WebHandler Language="C#" Class="AdminIniciativasSolicitudesNuevas" %>

// Registro de SOLO LECTURA de las Nuevas solicitudes (sql/29), para la vista
// "Nuevas" de la pestaña Solicitudes (admin/solicitudes-nuevas.js). Lee con
// RegistroSolicitudesIniciativa.Lector (App_Code/RegistroSolicitudesIniciativa.cs).
//
//   GET ?accion=listar              -> 200 { solicitudes: [...], total, maximo }
//   GET ?accion=detalle&numero=N    -> 200 { ...la solicitud, eventos: [...] }
//                                      Una ENVIADA con sql/32 (crea_iniciativa)
//                                      trae estados_problem: las opciones del
//                                      Estado inicial al aprobar (las de Crear);
//                                      null si no se pudieron leer.
//                                      400 SinSolicitud (numero invalido)
//                                      404 SolicitudNoExiste
//   501 RegistroNoDisponible  faltan las tablas de sql/29 (nada que leer)
//   500 { error, tipo }       la base fallo (DashboardHandler.Responder)
//   403 antes de leer nada: ExigirAdm (anonimo, VIEWER, PO/SO sin rol y
//       MOD). 405 si no es GET; 400 accion desconocida.
//
// No escribe: sin aprobar, rechazar, borrar ni cambiar estado. NO es una
// de las rutas del solicitante (Nueva solicitud / Mis solicitudes).

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasSolicitudesNuevas : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, RegistroSolicitudesIniciativa.MensajeSoloAdm)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            if (!string.Equals(req.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa GET.", "MetodoNoPermitido");
            var accion = req.QueryString["accion"];
            if (accion != "listar" && accion != "detalle")
                return Error(context, 400, "Acción desconocida.", "AccionDesconocida");

            int numero = 0;
            if (accion == "detalle")
            {
                numero = RegistroSolicitudesIniciativa.Numero(req.QueryString["numero"]);
                if (numero == 0) return Error(context, 400, "Falta el número de la solicitud.", "SinSolicitud");
            }

            var lector = RegistroSolicitudesIniciativa.Lector;
            if (!lector.Disponible())
                return Error(context, 501, RegistroSolicitudesIniciativa.MotivoSinTablas, "RegistroNoDisponible");

            if (accion == "listar")
            {
                var l = lector.Listar(RegistroSolicitudesIniciativa.Maximo);
                return new Dictionary<string, object>
                {
                    { "solicitudes", l.Solicitudes }, { "total", l.Total }, { "maximo", RegistroSolicitudesIniciativa.Maximo },
                    { "revision_disponible", l.RevisionDisponible }, { "crea_iniciativa", l.CreaIniciativa },
                };
            }
            var d = lector.Detalle(numero);
            if (d == null) return Error(context, 404, "La solicitud no existe.", "SolicitudNoExiste");
            object crea;
            if (d.TryGetValue("estado", out crea) && crea as string == "ENVIADA"
                && d.TryGetValue("crea_iniciativa", out crea) && crea is bool && (bool)crea)
            {
                try { d["estados_problem"] = RevisionSolicitudesIniciativa.EstadosIniciales(); }
                catch (Exception ex)
                {
                    // Sin opciones no se ofrece aprobar; la solicitud si se muestra.
                    DashboardHandler.Registrar("admin_iniciativas_solicitudes_nuevas.ashx", ex);
                    d["estados_problem"] = null;
                }
            }
            return d;
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
