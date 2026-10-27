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
//          dbo.CatPersona (campo "solicitante") o el PO no tiene un correo
//          unico (campo "po"), o la base rechaza los correos (51405/51406).
//     409  el token es de otra cuenta (51409).
//     403  SinUsuario: no hay cuenta que firme.
//     405  si no es POST;  413  si el archivo pasa el tope de ASP.NET.
//
// Quien solicita es la cuenta de IIS (AccesoAdmin.IdentidadEscritura):
// ningun campo del formulario (nombre, cuenta, correo) se lee para eso. El
// catalogo y la capacidad se vuelven a leer aqui (IniciativaService): lo
// que el navegador calculo no cuenta. El archivo del RCA solo se mira (que
// llego y no esta vacio); se guarda su extension, no el archivo (no hay
// destino confirmado). No se manda ningun correo.
//
// EXCEPCION ADM: con rol ADM (AccesoAdmin.Rol, del servidor) una cuenta que
// no esta en CatPersona valida igual; sin sql/29 no se guarda nada y con
// sql/29 se rechaza en "solicitante" (ver App_Code/SolicitudIniciativaAlta.cs).
//
// ACCESO: AccesoIniciativas.ExigirSolicitud: rol ADM; MOD si es Product
// Owner o Service Owner vigente; los demas si el interruptor
// INICIATIVAS_ABIERTAS esta encendido Y son PO/SO vigentes (403
// AccesoDenegado antes de leer nada en otro caso). Su UNICO llamador es Nueva solicitud
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

            ValidadorIniciativa.Resultado resultado;
            try
            {
                resultado = new IniciativaService().Solicitar(solicitud, identidad, AccesoAdmin.Rol(context) == RolAdmin.Adm);
            }
            catch (ErrorSolicitud ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_validar.ashx", ex);
                if (ex.Numero == 51409)
                    return Error(context, 409, "Este borrador ya se envi\u00f3 con otra cuenta. Recarga la p\u00e1gina.", "TokenAjeno");
                var campo = ex.Numero == 51405 ? DestinatariosSolicitud.CampoSolicitante
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

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
