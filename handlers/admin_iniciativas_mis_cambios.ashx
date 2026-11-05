<%@ WebHandler Language="C#" Class="AdminIniciativasMisCambios" %>

// "Mis solicitudes de cambio" (2026-11-04): las solicitudes de cambio
// (sql/22, adm.SolicitudCambio) que envio la cuenta que pregunta, de SOLO
// LECTURA, para la pestana Solicitudes de quien no es ADM
// (admin/solicitudes-cambio.js, MisCambios). ADM sigue con la cola completa
// (admin_iniciativas_solicitudes.ashx, ExigirAdm), sin cambios.
//
//   GET ?accion=listar[&estado=PENDIENTE|APLICADA|RECHAZADA]
//                                   -> 200 { solicitudes: [...], maximo }
//                                      sin estado (o vacio): todas las suyas;
//                                      otro valor: 400 EstadoDesconocido sin
//                                      leer. El filtro va DENTRO de la cuenta.
//   GET ?accion=detalle&id=N        -> 200 { ...la solicitud, categorias_detalle, eventos }
//                                      400 SinSolicitud (id invalido)
//                                      404 SolicitudNoExiste (no existe o
//                                      es de otra cuenta: no se distingue)
//   501 PersistenciaNoHabilitada  sin sql/22 (nada que leer)
//   500 { error, tipo }       la base fallo (DashboardHandler.Responder)
//   403 antes de leer nada: AccesoIniciativas.ExigirSolicitud, la MISMA
//       regla que "Mis solicitudes" de iniciativa (ADM y MOD siempre; los
//       demas, PO/SO vigente). Sin identidad que firme
//       (AccesoAdmin.IdentidadEscritura): 403 SinUsuario. 405 si no es GET;
//       400 accion desconocida.
//
// De quien: SOLO SolicitadoPor = la cuenta de IIS (la misma que firmo al
// enviar); nada de la URL la cambia, y el dueno de HOY de la iniciativa no
// cuenta (una PSO sigue siendo de quien la envio aunque el folio cambie de
// PO / SO). Lo interno de la revision de ADM no sale
// (SolicitudesCambio.ParaSolicitante). No escribe: sin aplicar, rechazar
// ni borrar. Es una de las rutas de AccesoIniciativas.RutasSolicitante.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasMisCambios : IHttpHandler
{
    public const int Maximo = 200;

    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoIniciativas.ExigirSolicitud(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            var id = AccesoAdmin.IdentidadEscritura(context);
            if (id == null || !id.Autenticada || string.IsNullOrEmpty(id.Original))
                return Error(context, 403, "Sin usuario autenticado no se pueden leer tus solicitudes.", "SinUsuario");
            var req = context.Request;
            if (!string.Equals(req.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa GET.", "MetodoNoPermitido");
            var accion = req.QueryString["accion"];
            if (accion != "listar" && accion != "detalle")
                return Error(context, 400, "Acci00f3n desconocida.", "AccionDesconocida");

            var estado = accion == "listar" ? req.QueryString["estado"] : null;
            if (string.IsNullOrEmpty(estado)) estado = null;
            else if (!SolicitudesCambio.EsEstadoCola(estado))
                return Error(context, 400, "Estado de solicitud desconocido.", "EstadoDesconocido");

            int n = 0;
            if (accion == "detalle" && (!int.TryParse(req.QueryString["id"], out n) || n <= 0))
                return Error(context, 400, "Falta el n00famero de la solicitud.", "SinSolicitud");

            // sql/22 en la base (DeteccionSolicitudesCambio); si no se puede, apagado.
            try { DeteccionSolicitudesCambio.Revisar(); }
            catch (Exception ex) { DashboardHandler.Registrar("admin_iniciativas_mis_cambios.ashx", ex); }
            if (!PersistenciaSolicitudesCambio.Activa())
                return Error(context, 501, PersistenciaSolicitudesCambio.MotivoCola, "PersistenciaNoHabilitada");

            if (accion == "listar")
            {
                var lista = SolicitudesCambio.Mias.ListarDe(id.Original, estado, Maximo);
                foreach (var f in lista) { SolicitudesCambio.ParaSolicitante(f); SolicitudesCambio.MarcarPropia(f, id.Original); }
                // Como se muestra quien la envio (solo pantalla; la cuenta no cambia).
                SolicitudesCambio.AgregarNombreSolicitante(lista);
                return new Dictionary<string, object> { { "solicitudes", lista }, { "maximo", Maximo } };
            }
            var d = SolicitudesCambio.ParaSolicitante(SolicitudesCambio.Mias.DetalleDe(n, id.Original));
            if (d == null) return Error(context, 404, "La solicitud no existe.", "SolicitudNoExiste");
            // Solo pantalla: los botones Cancelar / Modificar (sql/41). Quien
            // decide es la base, en admin_iniciativas_solicitudes.ashx.
            SolicitudesCambio.MarcarPropia(d, id.Original);
            SolicitudesCambio.AgregarNombreSolicitante(new List<Dictionary<string, object>> { d });
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
