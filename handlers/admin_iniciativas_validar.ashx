<%@ WebHandler Language="C#" Class="AdminIniciativasValidar" %>

// Validacion en el SERVIDOR de una Nueva solicitud. NO la guarda.
//
//   POST handlers/admin_iniciativas_validar.ashx   (multipart/form-data)
//     campos: tipo, po, so, categoria, titulo, descripcion, observaciones,
//             volumetria, pct (en %, no fraccion), disponible_cliente
//             (informativo, se ignora) y el archivo "rca" (opcional salvo
//             Problem).
//     200  { "valida": true,  "errores": [], ..., "guardada": false,
//            "numero_solicitud": null, "numero_pendiente": "<motivo>",
//            "pendientes": [...] }
//          numero_solicitud ("#0000142") solo saldra cuando exista un emisor
//          persistente (IGeneradorNumeroSolicitud); una solicitud invalida
//          nunca pide numero.
//     422  la misma forma con "valida": false y errores [{campo, mensaje}]
//     405  si no es POST;  413  si el archivo pasa el tope de ASP.NET.
//
// El catalogo y la capacidad se vuelven a leer aqui (IniciativaService):
// lo que el navegador calculo no cuenta. El archivo del RCA solo se mira
// (que llego y no esta vacio); no se guarda en ningun lado porque no hay
// destino confirmado.
//
// ACCESO: AccesoAdmin.ExigirAdm: whitelist y ademas rol ADM de
// dbo.UsuariosAdmin (403 antes de leer nada). Crear es solo de ADM; MOD
// recibe 403 { tipo: "RolInsuficiente" }.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasValidar : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            if (!string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa POST.", "MetodoNoPermitido");

            SolicitudIniciativa solicitud;
            try
            {
                var rca = req.Files[SolicitudIniciativa.CRca];
                var hayRca = rca != null && rca.ContentLength > 0;
                solicitud = SolicitudIniciativa.DesdeFormulario(req.Form, hayRca, hayRca ? rca.FileName : null);
            }
            catch (HttpException ex)
            {
                // maxRequestLength: el cuerpo no se pudo leer.
                DashboardHandler.Registrar("admin_iniciativas_validar.ashx", ex);
                return Error(context, 413, "La solicitud o el archivo adjunto son demasiado grandes.", "SolicitudDemasiadoGrande");
            }

            var resultado = new IniciativaService().Solicitar(solicitud);
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
