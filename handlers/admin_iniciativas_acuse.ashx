<%@ WebHandler Language="C#" Class="AdminIniciativasAcuse" %>

// Acuse "Estoy trabajando en ello" de PO / SO y la bandeja de ADM
// (App_Code/AcuseIniciativa.cs, sql/28_acuse_po_so.sql).
//
//   (accion siempre en la URL: ?accion=...)
//   GET  accion=mio                  Exigir (ADM o MOD)
//        -> { disponible, identidad: { estado, nombre }, roles: { folio: ["PO"|"SO"] } }
//   GET  accion=iniciativa&folio=X   Exigir
//        -> { disponible, folio, acuses: [ { id, rol, cuenta, nombre, estado,
//             fecha_compromiso, fecha_utc } ] }
//   POST accion=acusar  folio, rol (PO | SO)   Exigir
//        La cuenta sale de IIS (AccesoAdmin.IdentidadEscritura); NADA del
//        formulario la sustituye. -> 200 { acusado, nuevo, id, rol, nombre,
//        fecha_utc } (nuevo = false: ya estaba, no se duplico);
//        400 SinFolio / RolInvalido; 403 SinUsuario / IdentidadNoResuelta /
//        NoEsDueno; 404 IniciativaNoExiste; 409 NoElegible / dueño o
//        Estado cambiado (Base51305 / Base51306).
//   GET  accion=bandeja               ExigirAdm
//        -> { disponible, no_leidas, limite, notificaciones: [ ... + id_notificacion,
//             notificada_utc, leida, leida_utc ] }   (listar NO marca nada)
//   POST accion=leida  id             ExigirAdm  -> { leida: true, nueva }
//
//   Sin sql/28 en la base: GET -> { disponible: false }; POST -> 501
//   PersistenciaNoHabilitada. 403 antes de leer nada (VIEWER, anonimo;
//   MOD en lo que es de ADM). 405 metodo equivocado.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasAcuse : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.Exigir(context)) return;
        var req = context.Request;
        var accion = req.QueryString["accion"];
        if ((accion == "bandeja" || accion == "leida")
            && !AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) ve los avisos de los due\u00f1os.")) return;

        DashboardHandler.Responder(context, delegate
        {
            var esPost = string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase);
            if (accion == "acusar" || accion == "leida")
            {
                if (!esPost) return Error(context, 405, "Usa POST.", "MetodoNoPermitido");
            }
            else if (accion == "mio" || accion == "iniciativa" || accion == "bandeja")
            {
                if (esPost) return Error(context, 405, "Usa GET.", "MetodoNoPermitido");
            }
            else return Error(context, 400, "Acci\u00f3n desconocida.", "AccionDesconocida");

            if (!AcusesIniciativa.Almacen.Disponible())
            {
                if (!esPost) return new Dictionary<string, object> { { "disponible", false } };
                return Error(context, 501, "El acuse de due\u00f1os todav\u00eda no est\u00e1 habilitado en la base de datos (sql/28).",
                    "PersistenciaNoHabilitada");
            }

            // Quien es: SIEMPRE la cuenta de IIS (o, solo en desarrollo
            // local, la del atajo ya validado). Nunca un campo del request.
            var id = AccesoAdmin.IdentidadEscritura(context) ?? IdentidadWindows.Desde(null, false);

            if (accion == "mio") return AcusesIniciativa.Mio(id);
            if (accion == "iniciativa")
            {
                var folio = (req.QueryString["folio"] ?? "").Trim();
                if (folio.Length == 0) return Error(context, 400, "Falta la iniciativa.", "SinFolio");
                return AcusesIniciativa.DeIniciativa(folio);
            }
            if (!id.Autenticada || string.IsNullOrEmpty(id.Original))
                return Error(context, 403, "Sin usuario autenticado no se guarda nada.", "SinUsuario");
            if (accion == "acusar")
            {
                var r = AcusesIniciativa.Acusar(id, req.Form["folio"], req.Form["rol"]);
                if (r.Http != 200)
                {
                    context.Response.StatusCode = r.Http;
                    context.Response.TrySkipIisCustomErrors = true;
                }
                return r.Cuerpo;
            }
            if (accion == "bandeja") return AcusesIniciativa.Bandeja(id.Original);

            int n;
            if (!int.TryParse(req.Form["id"], out n) || n <= 0) return Error(context, 400, "Falta la notificaci\u00f3n.", "SinNotificacion");
            try
            {
                var nueva = AcusesIniciativa.Almacen.MarcarLeida(id.Original, n);
                return new Dictionary<string, object> { { "leida", true }, { "id_notificacion", n }, { "nueva", nueva } };
            }
            catch (ErrorAcuse ex)
            {
                return Error(context, ex.Numero == 51307 ? 404 : 400, ex.Message, "Base" + ex.Numero);
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
