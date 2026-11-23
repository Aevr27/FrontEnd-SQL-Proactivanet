<%@ WebHandler Language="C#" Class="AdminPruebasPowerAutomate" %>

// SOLO DESARROLLO LOCAL: panel "Pruebas de Power Automate" de admin/admin.html
// (App_Code/PruebasPowerAutomate.cs). Fuera de localhost de desarrollo
// (PruebasPowerAutomate.Disponible = false) TODO request recibe 404
// SoloLocalhost antes de leer nada: ni estado, ni envio.
//
//   GET  ?accion=estado  -> { disponible: true, webhook_configurado, formato,
//                            destinatario: { correo, nombre, fuente } | null,
//                            nombre_prueba }   (el que llevan los tres avisos)
//   POST ?accion=enviar  evento = NEW_REQUEST | REQUEST_APPROVED | REQUEST_REJECTED
//        (AccesoAdmin.ExigirMismoOrigen: de otra pagina, aunque sea en esta
//        misma maquina, 403 OrigenNoPermitido)
//        -> 200 { enviado: true, evento, numero, http }
//           503 SinWebhook (TeamsWebhookUrl vacio) | 422 SinDestinatario |
//           422 ConfiguracionInvalida | 502 EnvioFallido { http | red } |
//           409 EnvioEnCurso | 400 EventoDesconocido
//
// Nunca devuelve el URL del webhook ni el cuerpo que manda Power Automate.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Web;

public class AdminPruebasPowerAutomate : IHttpHandler
{
    // Un envio a la vez en el proceso: dos clics rapidos no mandan dos avisos.
    private static int enCurso;

    public void ProcessRequest(HttpContext context)
    {
        if (!PruebasPowerAutomate.Disponible(context))
        {
            var r = context.Response;
            r.Clear();
            r.StatusCode = 404;
            r.TrySkipIisCustomErrors = true;
            r.ContentType = "application/json; charset=utf-8";
            r.Cache.SetCacheability(HttpCacheability.NoCache);
            r.Write("{\"error\":\"Solo disponible en localhost de desarrollo.\",\"tipo\":\"SoloLocalhost\"}");
            return;
        }
        // Request.IsLocal no frena a otra pagina abierta en el mismo navegador.
        if (!AccesoAdmin.ExigirMismoOrigen(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            var accion = req.QueryString["accion"];
            var esPost = string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase);
            if (accion == "estado")
            {
                if (esPost) return Error(context, 405, "Usa GET.", "MetodoNoPermitido");
                var d = PruebasPowerAutomate.ResolverSitio(context);
                return new Dictionary<string, object>
                {
                    { "disponible", true },
                    { "webhook_configurado", AvisoTeams.Sitio.Configurado() },
                    { "formato", AvisoTeams.Sitio.Formato() },
                    { "destinatario", d == null ? null : new Dictionary<string, object>
                        { { "correo", d.Correo }, { "nombre", d.Nombre }, { "fuente", d.Fuente } } },
                    { "nombre_prueba", PruebasPowerAutomate.NombrePrueba },
                };
            }
            if (accion != "enviar") return Error(context, 400, "Accion desconocida.", "AccionDesconocida");
            if (!esPost) return Error(context, 405, "Usa POST.", "MetodoNoPermitido");

            var evento = req.Form["evento"];
            if (evento != AvisoTeams.NuevaSolicitud && evento != AvisoTeams.SolicitudAprobada && evento != AvisoTeams.SolicitudRechazada)
                return Error(context, 400, "Evento desconocido.", "EventoDesconocido");
            if (!AvisoTeams.Sitio.Configurado())
                return Error(context, 503, "Falta configurar TeamsWebhookUrl.", "SinWebhook");
            var destino = PruebasPowerAutomate.ResolverSitio(context);
            if (destino == null)
                return Error(context, 422, "No se pudo resolver el correo del destinatario de pruebas.", "SinDestinatario");

            if (Interlocked.CompareExchange(ref enCurso, 1, 0) != 0)
                return Error(context, 409, "Ya hay un envio en curso.", "EnvioEnCurso");
            try
            {
                var aviso = PruebasPowerAutomate.Aviso(evento, destino);
                var e = AvisoTeams.Sitio.EnviarConDetalle(aviso);
                if (e.Resultado == ResultadoAvisoTeams.Enviado)
                    return new Dictionary<string, object>
                    {
                        { "enviado", true }, { "evento", evento }, { "numero", aviso.RequestNumber }, { "http", e.Http },
                        { "formato", AvisoTeams.Sitio.Formato() },
                    };
                if (e.Resultado == ResultadoAvisoTeams.Desactivado)
                    return Error(context, 503, "Falta configurar TeamsWebhookUrl.", "SinWebhook");
                if (e.Resultado == ResultadoAvisoTeams.Invalido)
                    return Error(context, 422, "Configuracion del webhook invalida (URL https o formato).", "ConfiguracionInvalida");
                var fallo = Error(context, 502, "No se pudo enviar la notificacion.", "EnvioFallido");
                fallo["http"] = e.Http;
                fallo["red"] = e.Red;
                fallo["enviado"] = false;
                return fallo;
            }
            finally { Interlocked.Exchange(ref enCurso, 0); }
        });
    }

    private static Dictionary<string, object> Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
