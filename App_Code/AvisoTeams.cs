// Aviso a Microsoft Teams por el webhook de Power Automate (NEW_REQUEST,
// REQUEST_APPROVED, REQUEST_REJECTED). Lo usan los flujos reales
// (NEW_REQUEST: App_Code/AvisoNuevaSolicitud.cs; aprobar / rechazar:
// App_Code/AvisoRevisionSolicitud.cs), la prueba manual de Admin en la VM
// (App_Code/PruebaAvisoTeams.cs, por AvisoTeams.Sitio) y el panel de pruebas
// local (App_Code/PruebasPowerAutomate.cs).
//
// RESTRICCIONES
//   - El URL vive SOLO en Web.config del servidor (appSettings
//     TeamsWebhookUrl). Vacio o ausente = avisos apagados, sin error. El URL
//     lleva la firma (sig=) del trigger: es la credencial, asi que nunca se
//     escribe en la traza, en un mensaje ni en la respuesta al navegador.
//   - Enviar NUNCA lanza: el aviso es secundario a crear / aprobar /
//     rechazar, que ya quedaron confirmados en la base. Un fallo se registra
//     (DashboardHandler.Registrar) con un texto armado aqui, nunca con el
//     ex.Message de la red (puede llevar el host del webhook).
//   - Es SINCRONO con timeout corto: Registrar escribe en HttpContext.Trace,
//     que no existe fuera del request. Llamarlo despues del COMMIT, nunca
//     dentro de una transaccion.
//   - HttpWebRequest (System.dll) y no HttpClient: App_Code se compila sin
//     referencia a System.Net.Http y agregarla exige tocar Web.config.
//
// FORMATO (TeamsWebhookFormato): el flujo de Power Automate lee el TEXTO de
// un TextBlock dentro de una Adaptive Card, con SEIS campos en posiciones
// fijas separadas por "|" (sin estado: el evento ya lo dice):
//     NEW_REQUEST|tipo|correo|nombre|numero|fecha          (fecha aaaa-mm-dd)
//     REQUEST_APPROVED|tipo|correo|nombre|numero|codigo
//     REQUEST_REJECTED|tipo|correo|nombre|numero|comentario
// Ese es el formato por omision ("texto"). "json" manda los campos con
// nombre (ComoJson) y exige cambiar el flujo antes de usarlo (ver
// DASHBOARD.md). Cualquier otro valor: no se envia (Invalido).
// En "texto" un "|" dentro de un valor se cambia por "/" y los saltos de
// linea por espacios: si no, correrian las posiciones. Un valor vacio deja
// su posicion vacia. NEW_REQUEST va al chat de revisores (el correo es
// informativo); aprobar / rechazar son mensajes privados al correo.
//
// Pruebas: tools/tests/AvisoTeamsSmoke.cs (sin red externa).

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Globalization;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

public enum ResultadoAvisoTeams
{
    Enviado,      // el webhook respondio 2xx
    Desactivado,  // sin TeamsWebhookUrl: no se intento
    Invalido,     // configuracion o aviso mal formados: no se intento
    Fallido,      // red, timeout o respuesta no 2xx
}

// El resultado con lo que se puede mostrar sin exponer nada: el codigo HTTP
// o el estado de red (WebExceptionStatus). Nunca el URL ni el cuerpo.
public sealed class EnvioAvisoTeams
{
    public ResultadoAvisoTeams Resultado;
    public int? Http;
    public string Red;
}

// Lo que se notifica. Los campos que no apliquen o no se conozcan van null
// (p. ej. codigo en un rechazo, nombre sin resolver): no se inventan.
public sealed class AvisoSolicitud
{
    public string Evento;
    public string Tipo;
    public string SolicitanteEmail;
    public string SolicitanteNombre;
    public string RequestNumber;
    public string Estado;
    public string Codigo;
    public string Comentario;
    // aaaa-mm-dd. Solo la usa NEW_REQUEST (posicion 5).
    public string Fecha;
}

// Envia el cuerpo y devuelve el codigo HTTP. Lanza WebException en fallos de
// red / timeout / protocolo. Las pruebas lo cambian por uno falso.
public interface ITransporteAvisoTeams
{
    int Post(Uri url, byte[] cuerpo, int timeoutMs);
}

public sealed class TransporteAvisoTeamsHttp : ITransporteAvisoTeams
{
    public int Post(Uri url, byte[] cuerpo, int timeoutMs)
    {
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.ContentType = "application/json; charset=utf-8";
        req.ContentLength = cuerpo.Length;
        req.Timeout = timeoutMs;
        req.ReadWriteTimeout = timeoutMs;
        // Una redireccion mandaria los datos del solicitante a otro host.
        req.AllowAutoRedirect = false;
        using (var s = req.GetRequestStream()) s.Write(cuerpo, 0, cuerpo.Length);
        try
        {
            using (var resp = (HttpWebResponse)req.GetResponse())
                return (int)resp.StatusCode;
        }
        catch (WebException ex)
        {
            // 4xx / 5xx llegan como ProtocolError: se devuelve el codigo.
            var r = ex.Response as HttpWebResponse;
            if (ex.Status == WebExceptionStatus.ProtocolError && r != null)
            {
                using (r) return (int)r.StatusCode;
            }
            throw;
        }
    }
}

// Lo que se registra: texto armado aqui, sin URL ni datos del solicitante.
public sealed class ErrorAvisoTeams : Exception
{
    public ErrorAvisoTeams(string mensaje) : base(mensaje) { }
}

public sealed class AvisoTeams
{
    public const string ClaveConfiguracion = "TeamsWebhookUrl";
    public const string ClaveFormato = "TeamsWebhookFormato";
    public const string FormatoTexto = "texto";
    public const string FormatoJson = "json";
    public const int TimeoutMsPorOmision = 5000;
    public const string CategoriaTraza = "AvisoTeams";

    public const string NuevaSolicitud = "NEW_REQUEST";
    public const string SolicitudAprobada = "REQUEST_APPROVED";
    public const string SolicitudRechazada = "REQUEST_REJECTED";

    public const string TipoIniciativa = "Initiative";
    public const string TipoCambio = "Change request";

    private static readonly string[] Eventos = { NuevaSolicitud, SolicitudAprobada, SolicitudRechazada };
    private static readonly string[] Tipos = { TipoIniciativa, TipoCambio };

    private readonly Func<string> _url;
    private readonly Func<string> _formato;
    private readonly ITransporteAvisoTeams _transporte;
    private readonly Action<string, Exception> _registrar;
    private readonly int _timeoutMs;

    // El del sitio: Web.config, HttpWebRequest y la traza de ASP.NET.
    public static AvisoTeams Sitio = new AvisoTeams(LeerConfiguracion, LeerFormato, new TransporteAvisoTeamsHttp(),
                                                    DashboardHandler.Registrar, TimeoutMsPorOmision);

    // Sin formato: "texto" (el del flujo actual).
    public AvisoTeams(Func<string> url, ITransporteAvisoTeams transporte, Action<string, Exception> registrar, int timeoutMs)
        : this(url, null, transporte, registrar, timeoutMs) { }

    public AvisoTeams(Func<string> url, Func<string> formato, ITransporteAvisoTeams transporte,
                      Action<string, Exception> registrar, int timeoutMs)
    {
        if (url == null) throw new ArgumentNullException("url");
        if (transporte == null) throw new ArgumentNullException("transporte");
        if (timeoutMs <= 0) throw new ArgumentOutOfRangeException("timeoutMs");
        _url = url;
        _formato = formato ?? delegate { return null; };
        _transporte = transporte;
        _registrar = registrar;
        _timeoutMs = timeoutMs;
    }

    public static string LeerConfiguracion() { return ConfigurationManager.AppSettings[ClaveConfiguracion]; }
    public static string LeerFormato() { return ConfigurationManager.AppSettings[ClaveFormato]; }

    // "texto" (vacio o ausente), "json", o null si el valor no se reconoce.
    public static string NormalizarFormato(string valor)
    {
        var f = (valor ?? string.Empty).Trim().ToLowerInvariant();
        if (f.Length == 0 || f == FormatoTexto) return FormatoTexto;
        return f == FormatoJson ? FormatoJson : null;
    }

    // true si hay un URL configurado (sin decir cual). Para el panel de pruebas.
    public bool Configurado()
    {
        try { return !string.IsNullOrWhiteSpace(_url()); }
        catch (Exception) { return false; }
    }

    public string Formato()
    {
        try { return NormalizarFormato(_formato()); }
        catch (Exception) { return null; }
    }

    // Para la respuesta JSON de los handlers reales (llave "aviso_teams"): en
    // la VM la traza de ASP.NET esta apagada, asi que sin esto un aviso que
    // no sale no deja rastro. NoAplica = la regla decidio no avisar
    // (reintento, modificar, solicitud no guardada). Solo el resultado: nada
    // del URL ni del solicitante.
    public static string Diagnostico(ResultadoAvisoTeams? r)
    {
        return r.HasValue ? r.Value.ToString() : "NoAplica";
    }

    // Unico punto de envio. Nunca lanza.
    public ResultadoAvisoTeams Enviar(AvisoSolicitud aviso)
    {
        return EnviarConDetalle(aviso).Resultado;
    }

    public EnvioAvisoTeams EnviarConDetalle(AvisoSolicitud aviso)
    {
        var salida = new EnvioAvisoTeams { Resultado = ResultadoAvisoTeams.Fallido };
        try
        {
            string crudo;
            try { crudo = _url(); }
            catch (Exception)
            {
                Registrar("No se pudo leer la configuracion " + ClaveConfiguracion + ".");
                salida.Resultado = ResultadoAvisoTeams.Invalido;
                return salida;
            }
            if (string.IsNullOrWhiteSpace(crudo))
            {
                salida.Resultado = ResultadoAvisoTeams.Desactivado;
                return salida;
            }

            Uri url;
            if (!Uri.TryCreate(crudo.Trim(), UriKind.Absolute, out url) || url.Scheme != Uri.UriSchemeHttps)
            {
                Registrar(ClaveConfiguracion + " no es un URL https absoluto: no se envio el aviso.");
                salida.Resultado = ResultadoAvisoTeams.Invalido;
                return salida;
            }

            var formato = Formato();
            if (formato == null)
            {
                Registrar(ClaveFormato + " no es 'texto' ni 'json': no se envio el aviso.");
                salida.Resultado = ResultadoAvisoTeams.Invalido;
                return salida;
            }

            var motivo = MotivoInvalido(aviso);
            if (motivo != null)
            {
                Registrar("Aviso no enviado: " + motivo);
                salida.Resultado = ResultadoAvisoTeams.Invalido;
                return salida;
            }

            var cuerpo = Encoding.UTF8.GetBytes(formato == FormatoJson ? ComoJson(aviso) : ComoTarjeta(aviso));
            var estado = _transporte.Post(url, cuerpo, _timeoutMs);
            salida.Http = estado;
            if (estado >= 200 && estado < 300)
            {
                salida.Resultado = ResultadoAvisoTeams.Enviado;
                return salida;
            }
            Registrar("El webhook respondio HTTP " + estado.ToString(CultureInfo.InvariantCulture) + " (" + Describir(aviso) + ").");
            return salida;
        }
        catch (WebException ex)
        {
            salida.Red = ex.Status.ToString();
            Registrar("Fallo de red al enviar el aviso: " + ex.Status + " (" + Describir(aviso) + ").");
            return salida;
        }
        catch (Exception ex)
        {
            Registrar("Fallo al enviar el aviso: " + ex.GetType().Name + " (" + Describir(aviso) + ").");
            return salida;
        }
    }

    // null si se puede enviar. Solo lo que el flujo necesita para enrutar:
    // evento y tipo conocidos, numero y, en los mensajes privados (aprobar /
    // rechazar), a quien avisar. NEW_REQUEST va al chat de revisores: el
    // correo es informativo y puede ir vacio. Lo demas puede ir null.
    public static string MotivoInvalido(AvisoSolicitud a)
    {
        if (a == null) return "sin aviso.";
        if (Array.IndexOf(Eventos, a.Evento) < 0) return "evento desconocido.";
        if (Array.IndexOf(Tipos, a.Tipo) < 0) return "tipo desconocido.";
        if (a.Evento != NuevaSolicitud && string.IsNullOrWhiteSpace(a.SolicitanteEmail)) return "sin correo del solicitante.";
        if (string.IsNullOrWhiteSpace(a.RequestNumber)) return "sin numero de solicitud.";
        return null;
    }

    // Formato "json": campos con nombre, las ocho llaves siempre (null si no aplican).
    public static string ComoJson(AvisoSolicitud a)
    {
        var d = new Dictionary<string, object>
        {
            { "evento", a.Evento },
            { "tipo", a.Tipo },
            { "solicitanteEmail", a.SolicitanteEmail },
            { "solicitanteNombre", a.SolicitanteNombre },
            { "requestNumber", a.RequestNumber },
            { "estado", a.Estado },
            { "codigo", a.Codigo },
            { "comentario", a.Comentario },
        };
        return new JavaScriptSerializer().Serialize(d);
    }

    // Formato "texto": los seis campos de cualquier evento. La posicion 5 es la
    // fecha en una nueva, el Codigo al aprobar y el comentario al rechazar.
    // El estado no viaja. Un valor vacio deja su posicion vacia.
    public static string ComoTexto(AvisoSolicitud a)
    {
        var quinto = a.Evento == NuevaSolicitud ? a.Fecha
                   : a.Evento == SolicitudAprobada ? a.Codigo
                   : a.Evento == SolicitudRechazada ? a.Comentario : null;
        return string.Join("|", new[]
        {
            Campo(a.Evento), Campo(a.Tipo), Campo(a.SolicitanteEmail), Campo(a.SolicitanteNombre),
            Campo(a.RequestNumber), Campo(quinto),
        });
    }

    // El sobre de "texto": mensaje de webhook de Teams con UNA Adaptive Card
    // y UN TextBlock cuyo text es ComoTexto. El flujo lo lee en
    // attachments[0].content.body[0].text.
    public static string ComoTarjeta(AvisoSolicitud a)
    {
        var bloque = new Dictionary<string, object> { { "type", "TextBlock" }, { "text", ComoTexto(a) }, { "wrap", true } };
        var tarjeta = new Dictionary<string, object>
        {
            { "$schema", "http://adaptivecards.io/schemas/adaptive-card.json" },
            { "type", "AdaptiveCard" },
            { "version", "1.4" },
            { "body", new object[] { bloque } },
        };
        var adjunto = new Dictionary<string, object>
        {
            { "contentType", "application/vnd.microsoft.card.adaptive" },
            { "contentUrl", null },
            { "content", tarjeta },
        };
        var mensaje = new Dictionary<string, object> { { "type", "message" }, { "attachments", new object[] { adjunto } } };
        return new JavaScriptSerializer().Serialize(mensaje);
    }

    private static string Campo(string s)
    {
        if (s == null) return string.Empty;
        var b = new StringBuilder(s.Length);
        foreach (var c in s)
        {
            if (c == '|') b.Append('/');
            else if (c == '\r' || c == '\n' || c == '\t') b.Append(' ');
            else b.Append(c);
        }
        return b.ToString().Trim();
    }

    // Para la traza: evento, tipo y numero. Sin correo, nombre ni comentario.
    private static string Describir(AvisoSolicitud a)
    {
        if (a == null) return "sin aviso";
        return (a.Evento ?? "?") + " " + (a.Tipo ?? "?") + " " + (a.RequestNumber ?? "?");
    }

    private void Registrar(string mensaje)
    {
        if (_registrar == null) return;
        try { _registrar(CategoriaTraza, new ErrorAvisoTeams(mensaje)); }
        catch (Exception) { }
    }
}
