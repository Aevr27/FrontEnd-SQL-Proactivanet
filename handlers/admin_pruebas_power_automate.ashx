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
//        tipo = Initiative (vacio o ausente) | Change request: solo el
//        campo [1]; no hay un evento propio para las solicitudes de cambio
//        (AccesoAdmin.ExigirMismoOrigen: de otra pagina, aunque sea en esta
//        misma maquina, 403 OrigenNoPermitido)
//        -> 200 { enviado: true, evento, tipo_solicitud, numero, http }
//        (en los errores "tipo" es la clase de error, no el campo [1])
//           503 SinWebhook (TeamsWebhookUrl vacio) | 422 SinDestinatario |
//           422 ConfiguracionInvalida | 502 EnvioFallido { http | red } |
//           409 EnvioEnCurso | 400 EventoDesconocido | 400 TipoDesconocido
//   POST ?accion=enviar_solicitante  resolucion REAL del destinatario
//        (PruebasPowerAutomate.EnviarComoSolicitante; sin TeamsPruebaDestinatario)
//        evento = REQUEST_APPROVED | REQUEST_REJECTED, tipo,
//        Initiative: correo (+ nombre opcional) guardados en la fila simulada;
//        Change request: cuenta (DOMINIO\cuenta) + rol (ADM | MOD | PSO)
//        -> 200 { enviado, evento, tipo_solicitud, http, texto, campo2,
//                 destinatario_origen: SOLICITANTE_SIMULADO,
//                 usa_teams_prueba_destinatario: false }
//           422 SinCorreoSolicitante | 400 FaltaSolicitante | 503 | 502 | 409
//
// Nunca devuelve el URL del webhook. Solo enviar_solicitante devuelve el
// texto enviado (sin URL), para ver que [2] sale de la resolucion real.

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
            if (accion == "enviar_solicitante")
            {
                if (!esPost) return Error(context, 405, "Usa POST.", "MetodoNoPermitido");
                return EnviarComoSolicitante(context, req);
            }
            if (accion != "enviar") return Error(context, 400, "Accion desconocida.", "AccionDesconocida");
            if (!esPost) return Error(context, 405, "Usa POST.", "MetodoNoPermitido");

            var evento = req.Form["evento"];
            if (evento != AvisoTeams.NuevaSolicitud && evento != AvisoTeams.SolicitudAprobada && evento != AvisoTeams.SolicitudRechazada)
                return Error(context, 400, "Evento desconocido.", "EventoDesconocido");
            var tipo = PruebasPowerAutomate.Tipo(req.Form["tipo"]);
            if (tipo == null) return Error(context, 400, "Tipo desconocido.", "TipoDesconocido");
            if (!AvisoTeams.Sitio.Configurado())
                return Error(context, 503, "Falta configurar TeamsWebhookUrl.", "SinWebhook");
            var destino = PruebasPowerAutomate.ResolverSitio(context);
            if (destino == null)
                return Error(context, 422, "No se pudo resolver el correo del destinatario de pruebas.", "SinDestinatario");

            if (Interlocked.CompareExchange(ref enCurso, 1, 0) != 0)
                return Error(context, 409, "Ya hay un envio en curso.", "EnvioEnCurso");
            try
            {
                var aviso = PruebasPowerAutomate.Aviso(evento, tipo, destino);
                var e = AvisoTeams.Sitio.EnviarConDetalle(aviso);
                if (e.Resultado == ResultadoAvisoTeams.Enviado)
                    return new Dictionary<string, object>
                    {
                        { "enviado", true }, { "evento", evento }, { "tipo_solicitud", tipo }, { "numero", aviso.RequestNumber }, { "http", e.Http },
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

    // Resolucion REAL del destinatario con un solicitante simulado. No llama a
    // ResolverSitio: TeamsPruebaDestinatario no participa.
    private static Dictionary<string, object> EnviarComoSolicitante(HttpContext context, HttpRequest req)
    {
        var evento = req.Form["evento"];
        if (evento != AvisoTeams.SolicitudAprobada && evento != AvisoTeams.SolicitudRechazada)
            return Error(context, 400, "Solo REQUEST_APPROVED o REQUEST_REJECTED.", "EventoDesconocido");
        var tipo = PruebasPowerAutomate.Tipo(req.Form["tipo"]);
        if (tipo == null) return Error(context, 400, "Tipo desconocido.", "TipoDesconocido");
        var correo = Recortar(req.Form["correo"]);
        var nombre = Recortar(req.Form["nombre"]);
        var cuenta = Recortar(req.Form["cuenta"]);
        var rol = Recortar(req.Form["rol"]);
        if (tipo == AvisoTeams.TipoIniciativa && correo == null)
            return Error(context, 400, "Falta el correo guardado del solicitante.", "FaltaSolicitante");
        if (tipo == AvisoTeams.TipoCambio && (cuenta == null || Array.IndexOf(PruebasPowerAutomate.RolesSolicitante, rol) < 0))
            return Error(context, 400, "Falta la cuenta (DOMINIO\\cuenta) o el rol (ADM, MOD, PSO) del solicitante.", "FaltaSolicitante");
        if (!AvisoTeams.Sitio.Configurado())
            return Error(context, 503, "Falta configurar TeamsWebhookUrl.", "SinWebhook");

        if (Interlocked.CompareExchange(ref enCurso, 1, 0) != 0)
            return Error(context, 409, "Ya hay un envio en curso.", "EnvioEnCurso");
        try
        {
            var e = PruebasPowerAutomate.EnviarComoSolicitante(evento, tipo, correo, nombre, cuenta, rol,
                AvisoTeams.LeerConfiguracion, AvisoTeams.LeerFormato, new TransporteAvisoTeamsHttp(), DashboardHandler.Registrar);
            var campos = e.Texto == null ? null : e.Texto.Split('|');
            var r = new Dictionary<string, object>
            {
                { "enviado", e.Resultado == ResultadoAvisoTeams.Enviado },
                { "evento", evento }, { "tipo_solicitud", tipo }, { "http", e.Http },
                { "destinatario_origen", "SOLICITANTE_SIMULADO" },
                { "usa_teams_prueba_destinatario", false },
                { "texto", e.Texto },
                { "campo2", campos != null && campos.Length > 2 ? campos[2] : null },
                { "formato", AvisoTeams.Sitio.Formato() },
            };
            if (e.Texto == null && e.Cuerpo != null) r["cuerpo"] = e.Cuerpo;   // formato "json"
            if (e.Resultado == ResultadoAvisoTeams.Enviado) return r;
            if (e.Resultado == ResultadoAvisoTeams.Invalido)
            {
                context.Response.StatusCode = 422; context.Response.TrySkipIisCustomErrors = true;
                r["error"] = "No se envio: la resolucion real no dio un correo valido para ese solicitante (o la configuracion del webhook es invalida).";
                r["tipo"] = "SinCorreoSolicitante";
                return r;
            }
            context.Response.StatusCode = e.Resultado == ResultadoAvisoTeams.Desactivado ? 503 : 502;
            context.Response.TrySkipIisCustomErrors = true;
            r["error"] = "No se pudo enviar la notificacion.";
            r["tipo"] = e.Resultado == ResultadoAvisoTeams.Desactivado ? "SinWebhook" : "EnvioFallido";
            return r;
        }
        finally { Interlocked.Exchange(ref enCurso, 0); }
    }

    private static string Recortar(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        return s.Length > 256 ? s.Substring(0, 256) : s;
    }

    private static Dictionary<string, object> Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
