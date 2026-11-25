<%@ WebHandler Language="C#" Class="AdminPruebaAvisoTeams" %>

// Prueba MANUAL de un aviso de Teams (admin/prueba-aviso-teams.html,
// App_Code/PruebaAvisoTeams.cs). Solo ADM: AccesoAdmin.ExigirAdm antes de
// leer nada (MOD 403 RolInsuficiente; VIEWER y anonimo 403 AccesoDenegado;
// un POST de otra pagina 403 OrigenNoPermitido). AdminAccesoModulo repite la
// puerta para esta ruta y para la pagina.
//
//   GET                -> { webhook_configurado, formato, formato_explicito }
//   POST accion=enviar evento, tipo (INICIATIVA | CAMBIO), correo, nombre,
//                      numero, dato
//        -> 200 { enviado: true, clase: Aceptado, http, formato, contenido }
//           400 { clase: EventoDesconocido | TipoDesconocido | CorreoInvalido |
//                 CampoDemasiadoLargo | AvisoInvalido | TextoNoPermitido }
//           503 SinWebhook | 422 ConfiguracionInvalida | 409 EnvioEnCurso
//           502 HttpNoExitoso { http } | FalloRed { red } | FalloInterno
//           504 TiempoAgotado
//
// Nunca devuelve ni registra el URL del webhook. "contenido" es lo que arma
// AvisoTeams con lo que escribio el propio administrador.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Web;

public class AdminPruebaAvisoTeams : IHttpHandler
{
    // Un envio a la vez en el proceso: dos clics rapidos no mandan dos avisos.
    private static int enCurso;

    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, AccesoAdmin.MensajeSoloAdmAviso)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            context.Response.TrySkipIisCustomErrors = true;
            var avisador = AvisoTeams.Sitio;

            if (string.Equals(req.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                return new Dictionary<string, object>
                {
                    { "webhook_configurado", avisador.Configurado() },
                    { "formato", avisador.Formato() },
                    { "formato_explicito", !string.IsNullOrWhiteSpace(LeerFormato()) },
                };

            if (!string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "MetodoNoPermitido", "Solo GET y POST.");
            if (req.QueryString["accion"] != "enviar")
                return Error(context, 400, "AccionDesconocida", "Accion no valida.");

            EntradaPruebaAvisoTeams entrada;
            try
            {
                var f = req.Form;
                entrada = new EntradaPruebaAvisoTeams
                {
                    Evento = f["evento"], Tipo = f["tipo"], Correo = f["correo"],
                    Nombre = f["nombre"], Numero = f["numero"], Dato = f["dato"],
                };
            }
            catch (HttpRequestValidationException)
            {
                return Error(context, 400, "TextoNoPermitido", "ASP.NET rechazo el texto (marcado HTML como \"<x\").");
            }

            string codigo, motivo;
            var aviso = PruebaAvisoTeams.Armar(entrada, out codigo, out motivo);
            if (aviso == null) return Error(context, 400, codigo, motivo);

            if (Interlocked.CompareExchange(ref enCurso, 1, 0) != 0)
                return Error(context, 409, "EnvioEnCurso", "Ya hay un envio en curso.");
            try
            {
                var e = avisador.EnviarConDetalle(aviso);
                var clase = PruebaAvisoTeams.Clasificar(e);
                DashboardHandler.Registrar(AvisoTeams.CategoriaTraza,
                    new ErrorAvisoTeams(PruebaAvisoTeams.DescribirIntento(aviso.Evento, aviso.Tipo, clase, e)));

                var formato = avisador.Formato();
                var r = new Dictionary<string, object>
                {
                    { "enviado", e.Resultado == ResultadoAvisoTeams.Enviado },
                    { "clase", clase },
                    { "http", e.Http },
                    { "red", e.Red },
                    { "formato", formato },
                    { "evento", aviso.Evento },
                    { "tipo_solicitud", aviso.Tipo },
                    { "contenido", formato == AvisoTeams.FormatoJson ? AvisoTeams.ComoJson(aviso)
                                 : formato == AvisoTeams.FormatoTexto ? AvisoTeams.ComoTexto(aviso) : null },
                };
                context.Response.StatusCode = Estado(clase);
                return r;
            }
            finally { Interlocked.Exchange(ref enCurso, 0); }
        });
    }

    private static string LeerFormato()
    {
        try { return AvisoTeams.LeerFormato(); }
        catch (Exception) { return null; }
    }

    private static int Estado(string clase)
    {
        switch (clase)
        {
            case "Aceptado": return 200;
            case "SinWebhook": return 503;
            case "ConfiguracionInvalida": return 422;
            case "TiempoAgotado": return 504;
            default: return 502;
        }
    }

    private static Dictionary<string, object> Error(HttpContext context, int estado, string clase, string mensaje)
    {
        context.Response.StatusCode = estado;
        return new Dictionary<string, object> { { "error", mensaje }, { "clase", clase }, { "enviado", false } };
    }

    public bool IsReusable { get { return false; } }
}
