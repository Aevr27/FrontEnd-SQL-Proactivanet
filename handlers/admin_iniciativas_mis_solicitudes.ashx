<%@ WebHandler Language="C#" Class="AdminIniciativasMisSolicitudes" %>

// "Mis solicitudes": las Nuevas solicitudes (sql/29) que envio la cuenta que
// pregunta, de SOLO LECTURA, para la pestaña Solicitudes de quien no es ADM
// (admin/solicitudes-nuevas.js, MisSolicitudes). ADM sigue con el registro
// completo (admin_iniciativas_solicitudes_nuevas.ashx, ExigirAdm).
//
//   GET ?accion=listar              -> 200 { solicitudes: [...], total, maximo }
//   GET ?accion=detalle&numero=N    -> 200 { ...la solicitud, eventos: [...] }
//                                      400 SinSolicitud (numero invalido)
//                                      404 SolicitudNoExiste (no existe o
//                                      es de otra cuenta: no se distingue)
//   501 RegistroNoDisponible  faltan las tablas de sql/29
//   500 { error, tipo }       la base fallo (DashboardHandler.Responder)
//   403 antes de leer nada: AccesoIniciativas.ExigirSolicitud, la MISMA
//       regla que "Solicitar una iniciativa" (ADM siempre; MOD solo PO/SO
//       vigente; los demas, interruptor INICIATIVAS_ABIERTAS y PO/SO
//       vigente). Sin identidad que firme (AccesoAdmin.IdentidadEscritura):
//       403 SinUsuario. 405 si no es GET; 400 accion desconocida.
//
// La cuenta es la de IIS (la misma que guardo SolicitanteCuenta al enviar);
// nada de la URL la cambia. No escribe: sin aprobar, rechazar ni borrar.
// Es una de las rutas de AccesoIniciativas.RutasSolicitante.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasMisSolicitudes : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoIniciativas.ExigirSolicitud(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            var id = AccesoAdmin.IdentidadEscritura(context);
            if (id == null)
                return Error(context, 403, "Sin usuario autenticado no se pueden leer tus solicitudes.", "SinUsuario");
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

            var lector = RegistroSolicitudesIniciativa.Mias;
            if (!lector.Disponible())
                return Error(context, 501, RegistroSolicitudesIniciativa.MotivoSinTablas, "RegistroNoDisponible");

            if (accion == "listar")
            {
                var l = lector.ListarDe(id.Original, RegistroSolicitudesIniciativa.Maximo);
                return new Dictionary<string, object>
                {
                    { "solicitudes", l.Solicitudes }, { "total", l.Total }, { "maximo", RegistroSolicitudesIniciativa.Maximo },
                };
            }
            var d = lector.DetalleDe(numero, id.Original);
            if (d == null) return Error(context, 404, "La solicitud no existe.", "SolicitudNoExiste");
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
