<%@ WebHandler Language="C#" Class="AdminIniciativasValidar" %>

// Validacion en el SERVIDOR de una Nueva solicitud y, si la base tiene
// sql/29, su ALTA (numero + foto de los correos del solicitante y del PO).
//
//   POST handlers/admin_iniciativas_validar.ashx   (multipart/form-data)
//     campos: tipo, po, so, categoria, titulo, descripcion, observaciones,
//             volumetria, pct (en %, no fraccion), token (GUID del
//             borrador), disponible_cliente (informativo, se ignora) y el
//             archivo "rca" (opcional salvo Problem).
//     200  { "valida": true, "errores": [], ..., "guardada": true|false,
//            "nuevo": true|false, "numero_solicitud": "#0000142" | null,
//            "numero_pendiente": "<motivo>" | null,
//            "solicitante": { "nombre", "correo" },
//            "product_owner_correo", "pendientes": [...] }
//          Sin sql/29: guardada = false, numero_solicitud = null (como
//          antes). Con sql/29: guardada = true; el mismo token otra vez
//          devuelve el MISMO numero con nuevo = false (no duplica).
//     422  la misma forma con "valida": false y errores [{campo, mensaje}]:
//          tambien si la cuenta no se resuelve a UNA persona con correo en
//          dbo.CatPersona y no es ADM/MOD con CorreoUsuario unico en
//          dbo.UsuariosAdmin (campo "solicitante"), o el PO no tiene un
//          correo unico (campo "po"), o la base rechaza los correos
//          (51405/51406/51417/51418).
//     409  el token es de otra cuenta (51409).
//     403  SinUsuario: no hay cuenta que firme.
//     405  si no es POST;  413  si el archivo pasa el tope de ASP.NET.
//
//   MODIFICAR (sql/42) = REEMPLAZAR: el MISMO POST con reemplaza_a (el
//     numero de una solicitud ENVIADA de esta cuenta) y motivo_cancelacion
//     (obligatorio, hasta 2000). Las MISMAS reglas que un envio nuevo
//     (ExigirSolicitud, validador, catalogo y capacidad leidos de nuevo,
//     solicitante resuelto por el servidor) y luego
//     adm.usp_SolicitudIniciativa_Reemplazar: una solicitud NUEVA (otro
//     numero, ENVIADA, ADM la revisa desde el principio) y la original
//     CANCELADA con un evento REEMPLAZADA, en UNA transaccion. Si algo no
//     pasa, la original sigue ENVIADA.
//     200  como arriba, con reemplaza_a = "#0000123"
//     400  SinSolicitud (reemplaza_a invalido); 422 motivo_cancelacion
//     404  SolicitudNoExiste (no existe o es de otra cuenta: igual)
//     409  SolicitudNoPendiente (ADM la reviso antes: gana el primero) /
//          TokenUsado;  501 CancelacionNoHabilitada (sin sql/42)
//
//   POST accion=cancelar (en el cuerpo)   numero, motivo (obligatorio, hasta 2000)
//     Quien la envio cancela su solicitud ENVIADA
//     (adm.usp_SolicitudIniciativa_Cancelar: la base decide si es suya y si
//     sigue ENVIADA, con el candado de Aprobar / Rechazar). Nada se borra.
//     200 { cancelada: true, numero }; 404 / 409 / 422 / 501 como arriba;
//     500 { cancelada: null } (no se sabe si quedo).
//
// Quien solicita es la cuenta de IIS (AccesoAdmin.IdentidadEscritura):
// ningun campo del formulario (nombre, cuenta, correo) se lee para eso. El
// catalogo y la capacidad se vuelven a leer aqui (IniciativaService): lo
// que el navegador calculo no cuenta. El archivo del RCA solo se mira (que
// llego y no esta vacio); se guarda su extension, no el archivo (no hay
// destino confirmado). No se manda ningun correo.
//
// ADM / MOD SIN CatPersona (sql/35 + 36): con rol ADM o MOD (AccesoAdmin.Rol:
// dbo.UsuariosAdmin, del servidor) una cuenta que no esta en CatPersona
// envia con el UNICO CorreoUsuario de su fila de dbo.UsuariosAdmin
// (CorreoAdmin.Para, por la cuenta autenticada); el nombre lo pone la base
// (UsuariosAdmin.NombreSolicitante o NULL). Sin ese correo, o sin sql/36 en
// la base, 422 en "solicitante" y nada se guarda
// (ver App_Code/SolicitudIniciativaAlta.cs). PO/SO sin rol: sin cambios.
//
// ACCESO: AccesoIniciativas.ExigirSolicitud: rol ADM o MOD; los demas si
// son Product Owner o Service Owner vigentes (403 AccesoDenegado antes de
// leer nada en otro caso). Su UNICO llamador es Nueva solicitud
// (admin/iniciativas.js); no aprueba ni crea iniciativas. La creacion
// directa (solo ADM) NO pasa por este handler: va a
// admin_iniciativas_gestion.ashx, que usa ExigirAdm.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasValidar : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoIniciativas.ExigirSolicitud(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            if (!string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa POST.", "MetodoNoPermitido");
            SolicitudIniciativa solicitud;
            try
            {
                // accion (del cuerpo): vacia = enviar / modificar; cancelar (sql/42).
                var accion = req.Form["accion"];
                if (!string.IsNullOrEmpty(accion) && accion != "cancelar")
                    return Error(context, 400, "Acci\u00f3n desconocida.", "AccionDesconocida");
                if (accion == "cancelar") return Cancelar(context);
                var rca = req.Files[SolicitudIniciativa.CRca];
                var hayRca = SolicitudIniciativa.RcaEnSitio && rca != null && rca.ContentLength > 0;
                solicitud = SolicitudIniciativa.DesdeFormulario(req.Form, hayRca, hayRca ? rca.FileName : null);
            }
            catch (HttpException ex)
            {
                // maxRequestLength: el cuerpo no se pudo leer.
                DashboardHandler.Registrar("admin_iniciativas_validar.ashx", ex);
                return Error(context, 413, "La solicitud o el archivo adjunto son demasiado grandes.", "SolicitudDemasiadoGrande");
            }

            var identidad = AccesoAdmin.IdentidadEscritura(context);
            if (identidad == null)
                return Error(context, 403, "Sin usuario autenticado no se puede enviar la solicitud.", "SinUsuario");

            // Modificar (sql/42): reemplaza a una solicitud ENVIADA de esta cuenta.
            int reemplazaA = 0;
            string motivoCancelacion = null;
            if (!string.IsNullOrEmpty(req.Form["reemplaza_a"]))
            {
                reemplazaA = RegistroSolicitudesIniciativa.Numero(req.Form["reemplaza_a"]);
                if (reemplazaA == 0) return Error(context, 400, "Falta el n\u00famero de la solicitud que se corrige.", "SinSolicitud");
                motivoCancelacion = (req.Form["motivo_cancelacion"] ?? "").Trim();
                var malo = ErrorMotivo(context, motivoCancelacion, "motivo_cancelacion");
                if (malo != null) return malo;
                if (!SolicitudesIniciativa.Cancelaciones.Disponible())
                    return Error(context, 501, MotivoSinSql42, "CancelacionNoHabilitada");
            }

            ValidadorIniciativa.Resultado resultado;
            try
            {
                resultado = new IniciativaService().Solicitar(solicitud, identidad, AccesoAdmin.Rol(context), delegate
                {
                    return CorreoAdmin.Para(identidad, CorreoAdmin.Fuente,
                        delegate (Exception e) { DashboardHandler.Registrar("admin_iniciativas_validar.ashx", e); });
                }, reemplazaA, motivoCancelacion);
            }
            catch (ErrorSolicitud ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_validar.ashx", ex);
                if (reemplazaA > 0 && ErrorSolicitud.EsDeCancelacion(ex.Numero))
                    return DeLaCancelacion(context, ex, "guardada", reemplazaA, identidad.Original);
                if (ex.Numero == 51409)
                    return Error(context, 409, "Este borrador ya se envi\u00f3 con otra cuenta. Recarga la p\u00e1gina.", "TokenAjeno");
                var campo = ex.Numero == 51405 || ex.Numero == 51417 || ex.Numero == 51418 ? DestinatariosSolicitud.CampoSolicitante
                          : ex.Numero == 51406 ? SolicitudIniciativa.CPo : null;
                context.Response.StatusCode = 422;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "valida", false }, { "guardada", false },
                    { "errores", new List<object> { new Dictionary<string, object> { { "campo", campo }, { "mensaje", ex.Message } } } },
                };
            }
            if (!resultado.Valida)
            {
                context.Response.StatusCode = 422;
                context.Response.TrySkipIisCustomErrors = true;
            }
            return IniciativaService.ComoJson(resultado);
        });
    }

    public const string MotivoSinSql42 =
        "Cancelar o modificar una solicitud todav\u00eda no est\u00e1 habilitado (falta aplicar sql/42 en la base, con su aprobaci\u00f3n). No se cambi\u00f3 nada.";

    // Motivo de la cancelacion: obligatorio y hasta 2000 (los mismos limites
    // que la base, 51419 / 51420), con la forma de errores de este handler.
    private static object ErrorMotivo(HttpContext context, string motivo, string campo)
    {
        int numero = motivo.Length == 0 ? 51419 : motivo.Length > SolicitudesIniciativa.MaximoMotivoCancelacion ? 51420 : 0;
        if (numero == 0) return null;
        context.Response.StatusCode = 422;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object>
        {
            { "valida", false }, { "guardada", false }, { "cancelada", false },
            { "tipo", numero == 51419 ? "FaltaMotivoCancelacion" : "MotivoCancelacionLargo" },
            { "error", ErrorSolicitud.MensajeDe(numero, null) },
            { "errores", new List<object> { new Dictionary<string, object> { { "campo", campo }, { "mensaje", ErrorSolicitud.MensajeDe(numero, null) } } } },
        };
    }

    // POST ?accion=cancelar: quien la envio la cancela (sql/42).
    private static object Cancelar(HttpContext context)
    {
        var identidad = AccesoAdmin.IdentidadEscritura(context);
        if (identidad == null || !identidad.Autenticada || string.IsNullOrEmpty(identidad.Original))
            return Error(context, 403, "Sin usuario autenticado no se puede cancelar la solicitud.", "SinUsuario");
        var numero = RegistroSolicitudesIniciativa.Numero(context.Request.Form["numero"]);
        if (numero == 0) return Error(context, 400, "Falta el n\u00famero de la solicitud.", "SinSolicitud");
        var motivo = (context.Request.Form["motivo"] ?? "").Trim();
        var malo = ErrorMotivo(context, motivo, "motivo");
        if (malo != null) return malo;
        var c = SolicitudesIniciativa.Cancelaciones;
        if (!c.Disponible()) return Error(context, 501, MotivoSinSql42, "CancelacionNoHabilitada");
        try
        {
            c.Cancelar(numero, identidad.Original, motivo);
            return new Dictionary<string, object>
            {
                { "cancelada", true }, { "numero", numero }, { "numero_texto", new NumeroSolicitud(numero).ToString() },
            };
        }
        catch (ErrorSolicitud ex) { return DeLaCancelacion(context, ex, "cancelada", numero, identidad.Original); }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("admin_iniciativas_validar.ashx", ex);
            context.Response.StatusCode = 500;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object>
            {
                { "error", "No se pudo confirmar la cancelaci\u00f3n. Actualiza tus solicitudes antes de reintentar." },
                { "tipo", "CancelacionNoConfirmada" }, { "cancelada", null },
            };
        }
    }

    // Un error de Cancelar / Reemplazar. 51421 (ADM la reviso antes): dice
    // como quedo, leida SOLO dentro de la cuenta (DetalleDe).
    private static object DeLaCancelacion(HttpContext context, ErrorSolicitud ex, string llave, int original, string cuenta)
    {
        context.Response.StatusCode = ex.EstadoHttp;
        context.Response.TrySkipIisCustomErrors = true;
        var campo = ex.Numero == 51419 || ex.Numero == 51420 ? (llave == "cancelada" ? "motivo" : "motivo_cancelacion") : null;
        var salida = new Dictionary<string, object>
        {
            { "error", ex.Message }, { "numero_error", ex.Numero }, { "tipo", ex.Tipo }, { llave, false },
            { "valida", false },
            { "errores", new List<object> { new Dictionary<string, object> { { "campo", campo }, { "mensaje", ex.Message } } } },
        };
        if (ex.Numero == 51421)
        {
            Dictionary<string, object> d = null;
            try { d = RegistroSolicitudesIniciativa.Mias.DetalleDe(original, cuenta); }
            catch (Exception e) { DashboardHandler.Registrar("admin_iniciativas_validar.ashx", e); }
            if (d != null)
            {
                var e = d["estado"] as string;
                salida["estado_actual"] = e;
                string m = null;
                if (e == "APROBADA") m = "Un administrador ya aprob\u00f3 esta solicitud: no se cambi\u00f3 nada.";
                else if (e == "RECHAZADA") m = "Un administrador ya rechaz\u00f3 esta solicitud: no se cambi\u00f3 nada.";
                else if (e == "CANCELADA") m = "La solicitud ya estaba cancelada: no se cambi\u00f3 nada.";
                if (m != null)
                {
                    salida["error"] = m;
                    salida["errores"] = new List<object> { new Dictionary<string, object> { { "campo", null }, { "mensaje", m } } };
                }
            }
        }
        return salida;
    }

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
