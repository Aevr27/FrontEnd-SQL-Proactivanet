<%@ WebHandler Language="C#" Class="AdminIniciativasSolicitudesAviso" %>

// Aviso de la pestaña Solicitudes (admin/aviso-solicitudes.js): cuantas
// solicitudes estan pendientes y cuantas no ha abierto ESTE ADM
// (App_Code/SolicitudesVistas.cs, sql/39_solicitudes_vistas.sql).
//
//   GET  ?accion=resumen   -> 200 { pendientes, no_vistas (null sin sql/39),
//                                   vistas_disponibles, cambio: {...},
//                                   nuevas: {...} }
//   POST ?accion=marcar    tipo (CAMBIO | NUEVA), id (IdSolicitud o
//                          NumeroSolicitud). Solo marca "vista" para la
//                          cuenta de IIS; NO cambia el Estado ni lo de otro ADM.
//        -> 200 { vista: true, nueva }   400 tipo / id   404 no existe
//           501 PersistenciaNoHabilitada sin sql/39 (nada se guarda)
//
//   403 antes de leer nada: ExigirAdm (las dos colas son de ADM). 405 metodo
//   equivocado; 400 accion desconocida. El usuario sale SIEMPRE de la
//   identidad (AccesoAdmin.IdentidadEscritura), nunca del request.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasSolicitudesAviso : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, AvisoSolicitudes.MensajeSoloAdm)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            var accion = req.QueryString["accion"];
            var esPost = string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase);
            if (accion == "resumen") { if (esPost) return Error(context, 405, "Usa GET.", "MetodoNoPermitido"); }
            else if (accion == "marcar") { if (!esPost) return Error(context, 405, "Usa POST.", "MetodoNoPermitido"); }
            else return Error(context, 400, "Acci\u00f3n desconocida.", "AccionDesconocida");

            var id = AccesoAdmin.IdentidadEscritura(context) ?? IdentidadWindows.Desde(null, false);
            var usuario = AvisoSolicitudes.Usuario(id);
            if (accion == "resumen") return AvisoSolicitudes.Json(AvisoSolicitudes.Almacen.Resumen(usuario));

            if (usuario == null) return Error(context, 403, "Sin usuario autenticado no se guarda nada.", "SinUsuario");
            var tipo = req.Form["tipo"];
            if (!AvisoSolicitudes.EsTipo(tipo)) return Error(context, 400, "Tipo de solicitud desconocido.", "TipoDesconocido");
            var n = AvisoSolicitudes.Numero(req.Form["id"]);
            if (n == 0) return Error(context, 400, "Falta la solicitud.", "SinSolicitud");
            if (!AvisoSolicitudes.Almacen.Disponible())
                return Error(context, 501, "Lo visto por cada ADM todav\u00eda no est\u00e1 habilitado en la base de datos (sql/39).",
                    "PersistenciaNoHabilitada");
            try
            {
                var nueva = AvisoSolicitudes.Almacen.Marcar(usuario, tipo, n);
                return new Dictionary<string, object> { { "vista", true }, { "nueva", nueva } };
            }
            catch (ErrorVistaSolicitud ex)
            {
                return Error(context, ex.Numero == 51393 ? 404 : 400, ex.Message, "Base" + ex.Numero);
            }
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
