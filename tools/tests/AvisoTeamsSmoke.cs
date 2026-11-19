// Prueba de humo SIN red externa de App_Code/AvisoTeams.cs. Nunca llama al
// webhook real: el envio va a un transporte falso o a un servidor TCP propio
// en 127.0.0.1.
//
//   C  configuracion: ausente / vacia / espacios = Desactivado sin llamar ni
//      registrar; http, relativo o ilegible = Invalido; leerla lanza = Invalido.
//   T  formato "texto" (por omision, el del flujo actual): sobre de webhook de
//      Teams con UNA Adaptive Card y UN TextBlock; siete posiciones; la 6 es
//      codigo / comentario / vacia segun el evento; "|" y saltos dentro de un
//      valor no corren posiciones; acentos en UTF-8.
//   F  TeamsWebhookFormato: vacio / texto / json (sin distinguir mayusculas);
//      otro valor o leerlo lanza = Invalido sin llamar. Configurado() y el
//      detalle (Http / Red) de EnviarConDetalle.
//   J  formato "json": las ocho llaves siempre, null donde no aplica, UTF-8 (a con
//      acento = C3 A1), acentos y enie de ida y vuelta.
//   P  comentario con "|", CR/LF y comillas: llega identico, sin saltos crudos.
//   V  aviso invalido (evento / tipo desconocido, sin correo, sin numero):
//      no se envia.
//   H  respuestas: 200 / 202 Enviado; 400 / 500 Fallido.
//   E  excepciones del transporte (timeout, conexion, cualquiera) y un
//      registrador que lanza: Enviar nunca lanza.
//   S  la traza nunca lleva el URL, la firma, el correo ni el comentario.
//   R  TransporteAvisoTeamsHttp de verdad contra 127.0.0.1: 202 con el cuerpo
//      UTF-8 y Content-Type; 500 devuelve 500; 302 no se sigue; servidor mudo
//      = WebException Timeout dentro del limite.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Core.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:AvisoTeamsSmoke.exe /r:adm.dll /r:System.dll /r:System.Core.dll ^
//       /r:System.Web.Extensions.dll tools\tests\AvisoTeamsSmoke.cs
//   AvisoTeamsSmoke.exe
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

sealed class TransporteFalso : ITransporteAvisoTeams
{
    public int Estado = 202;
    public Exception Lanza;
    public int Llamadas;
    public Uri Url;
    public byte[] Cuerpo;
    public int Timeout;
    public int Post(Uri url, byte[] cuerpo, int timeoutMs)
    {
        Llamadas++;
        Url = url; Cuerpo = cuerpo; Timeout = timeoutMs;
        if (Lanza != null) throw Lanza;
        return Estado;
    }
}

static class AvisoTeamsSmoke
{
    const string UrlFalso = "https://prueba.invalid/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=SECRETO123";

    static int fallos, pasados;
    static readonly List<string> Traza = new List<string>();

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // Las pruebas J / P / V / H / E / S / C usan "json" (leen las llaves por
    // nombre); T y F prueban "texto", el formato por omision.
    static AvisoTeams Nuevo(Func<string> url, ITransporteAvisoTeams t)
    {
        return NuevoCon(url, delegate { return "json"; }, t);
    }

    static AvisoTeams NuevoCon(Func<string> url, Func<string> formato, ITransporteAvisoTeams t)
    {
        return new AvisoTeams(url, formato, t, delegate (string cat, Exception ex) { Traza.Add(cat + ": " + ex.GetType().Name + ": " + ex.Message); }, 5000);
    }

    static string Ch(int codigo) { return ((char)codigo).ToString(); }

    // El text del TextBlock del sobre "texto", o null si el sobre no tiene la forma esperada.
    static string TextoDeTarjeta(byte[] cuerpo, out Dictionary<string, object> mensaje)
    {
        mensaje = Leer(cuerpo);
        try
        {
            var adj = (Dictionary<string, object>)((System.Collections.ArrayList)mensaje["attachments"])[0];
            var tarjeta = (Dictionary<string, object>)adj["content"];
            var bloque = (Dictionary<string, object>)((System.Collections.ArrayList)tarjeta["body"])[0];
            return bloque["text"] as string;
        }
        catch (Exception) { return null; }
    }

    static AvisoSolicitud Rechazo()
    {
        return new AvisoSolicitud
        {
            Evento = AvisoTeams.SolicitudRechazada, Tipo = AvisoTeams.TipoIniciativa,
            SolicitanteEmail = "usuario@soriana.com", SolicitanteNombre = "Jos\u00e9 Pe\u00f1a",
            RequestNumber = "#0000142", Estado = "RECHAZADA", Codigo = null,
            Comentario = "La informaci\u00f3n est\u00e1 incompleta.",
        };
    }

    static Dictionary<string, object> Leer(byte[] cuerpo)
    {
        return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(cuerpo));
    }

    static int Main()
    {
        Configuracion();
        Texto();
        Formato();
        Json();
        Separadores();
        Validacion();
        Respuestas();
        Excepciones();
        Seguridad();
        TransporteReal();
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }

    static void Configuracion()
    {
        foreach (var valor in new[] { null, "", "   " })
        {
            Traza.Clear();
            var t = new TransporteFalso();
            var r = Nuevo(delegate { return valor; }, t).Enviar(Rechazo());
            var nombre = valor == null ? "null" : "'" + valor + "'";
            Check("C desactivado con " + nombre, ResultadoAvisoTeams.Desactivado, r);
            Check("C sin llamar con " + nombre, 0, t.Llamadas);
            Check("C sin traza con " + nombre, 0, Traza.Count);
        }
        foreach (var valor in new[] { "http://prueba.invalid/x?sig=SECRETO123", "/relativo?sig=SECRETO123", "no es url", "ftp://x/y" })
        {
            Traza.Clear();
            var t = new TransporteFalso();
            var r = Nuevo(delegate { return valor; }, t).Enviar(Rechazo());
            Check("C invalido '" + valor + "'", ResultadoAvisoTeams.Invalido, r);
            Check("C invalido sin llamar '" + valor + "'", 0, t.Llamadas);
            Check("C invalido registrado '" + valor + "'", 1, Traza.Count);
        }
        {
            var t = new TransporteFalso();
            var r = Nuevo(delegate { throw new System.Configuration.ConfigurationErrorsException("Web.config roto"); }, t).Enviar(Rechazo());
            Check("C leer configuracion lanza", ResultadoAvisoTeams.Invalido, r);
        }
        {
            var t = new TransporteFalso();
            Nuevo(delegate { return "  " + UrlFalso + "  "; }, t).Enviar(Rechazo());
            Check("C URL con espacios se recorta", UrlFalso, t.Url == null ? null : t.Url.OriginalString);
            Check("C timeout del constructor", 5000, t.Timeout);
        }
        // El del sitio sin la clave (este exe no tiene app.config): apagado.
        Check("C Sitio sin clave en configuracion", ResultadoAvisoTeams.Desactivado, AvisoTeams.Sitio.Enviar(Rechazo()));
    }

    static void Json()
    {
        var t = new TransporteFalso();
        var r = Nuevo(delegate { return UrlFalso; }, t).Enviar(Rechazo());
        Check("J enviado", ResultadoAvisoTeams.Enviado, r);
        var d = Leer(t.Cuerpo);
        Check("J ocho llaves", 8, d.Count);
        Check("J llaves en orden", "evento,tipo,solicitanteEmail,solicitanteNombre,requestNumber,estado,codigo,comentario",
              string.Join(",", new List<string>(d.Keys).ToArray()));
        Check("J evento", "REQUEST_REJECTED", d["evento"]);
        Check("J tipo", "Initiative", d["tipo"]);
        Check("J correo", "usuario@soriana.com", d["solicitanteEmail"]);
        Check("J numero", "#0000142", d["requestNumber"]);
        Check("J estado", "RECHAZADA", d["estado"]);
        Check("J codigo null presente", true, d.ContainsKey("codigo") && d["codigo"] == null);
        Check("J nombre con acento y enie", "Jos\u00e9 Pe\u00f1a", d["solicitanteNombre"]);
        Check("J comentario con acentos", "La informaci\u00f3n est\u00e1 incompleta.", d["comentario"]);

        var acentos = "\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1 \u00c1\u00c9\u00cd\u00d3\u00da\u00d1 \u00fc";
        var a = Rechazo(); a.Comentario = acentos; a.SolicitanteNombre = acentos;
        Nuevo(delegate { return UrlFalso; }, t).Enviar(a);
        var d2 = Leer(t.Cuerpo);
        Check("J acentos ida y vuelta (comentario)", acentos, d2["comentario"]);
        Check("J acentos ida y vuelta (nombre)", acentos, d2["solicitanteNombre"]);
        // a con acento en UTF-8 = C3 A1 (no Latin-1 E1 ni \u escapado obligatorio).
        var hex = BitConverter.ToString(t.Cuerpo);
        Check("J cuerpo UTF-8 (a acentuada = C3-A1)", true, hex.Contains("C3-A1"));
        Check("J sin BOM", false, t.Cuerpo.Length >= 3 && t.Cuerpo[0] == 0xEF && t.Cuerpo[1] == 0xBB && t.Cuerpo[2] == 0xBF);

        var ap = new AvisoSolicitud
        {
            Evento = AvisoTeams.SolicitudAprobada, Tipo = AvisoTeams.TipoIniciativa, SolicitanteEmail = "u@soriana.com",
            SolicitanteNombre = null, RequestNumber = "#0000143", Estado = "APROBADA", Codigo = "PRB 2026-000123", Comentario = null,
        };
        Nuevo(delegate { return UrlFalso; }, t).Enviar(ap);
        var d3 = Leer(t.Cuerpo);
        Check("J aprobada codigo", "PRB 2026-000123", d3["codigo"]);
        Check("J aprobada nombre null presente", true, d3.ContainsKey("solicitanteNombre") && d3["solicitanteNombre"] == null);
        Check("J aprobada comentario null presente", true, d3.ContainsKey("comentario") && d3["comentario"] == null);
    }

    static void Separadores()
    {
        var comentario = "Falta | el RCA\r\nY la volumetr\u00eda\nno cuadra | \"revisar\"\t\\fin";
        var a = Rechazo(); a.Comentario = comentario; a.SolicitanteNombre = "Ana | Ru\u00edz";
        var t = new TransporteFalso();
        Check("P enviado", ResultadoAvisoTeams.Enviado, Nuevo(delegate { return UrlFalso; }, t).Enviar(a));
        var json = Encoding.UTF8.GetString(t.Cuerpo);
        var d = Leer(t.Cuerpo);
        Check("P comentario identico", comentario, d["comentario"]);
        Check("P nombre con | identico", "Ana | Ru\u00edz", d["solicitanteNombre"]);
        Check("P ocho llaves (el | no parte campos)", 8, d.Count);
        Check("P sin CR/LF crudos en el JSON", false, json.Contains("\r") || json.Contains("\n"));
        Check("P es una sola linea JSON", true, json.StartsWith("{") && json.EndsWith("}"));
    }

    static void Texto()
    {
        // Constructor de 4 argumentos = sin formato = "texto".
        var t = new TransporteFalso();
        var porOmision = new AvisoTeams(delegate { return UrlFalso; }, t, null, 5000);
        Check("T enviado por omision", ResultadoAvisoTeams.Enviado, porOmision.Enviar(Rechazo()));
        Dictionary<string, object> m;
        var texto = TextoDeTarjeta(t.Cuerpo, out m);
        Check("T type message", "message", m["type"]);
        var adj = (Dictionary<string, object>)((System.Collections.ArrayList)m["attachments"])[0];
        Check("T un adjunto", 1, ((System.Collections.ArrayList)m["attachments"]).Count);
        Check("T contentType", "application/vnd.microsoft.card.adaptive", adj["contentType"]);
        var tarjeta = (Dictionary<string, object>)adj["content"];
        Check("T AdaptiveCard", "AdaptiveCard", tarjeta["type"]);
        var cuerpoTarjeta = (System.Collections.ArrayList)tarjeta["body"];
        Check("T un bloque", 1, cuerpoTarjeta.Count);
        Check("T TextBlock", "TextBlock", ((Dictionary<string, object>)cuerpoTarjeta[0])["type"]);
        var nombre = "Jos" + Ch(0xE9) + " Pe" + Ch(0xF1) + "a";
        var comentario = "La informaci" + Ch(0xF3) + "n est" + Ch(0xE1) + " incompleta.";
        Check("T rechazo: siete posiciones",
              "REQUEST_REJECTED|Initiative|usuario@soriana.com|" + nombre + "|#0000142|RECHAZADA|" + comentario, texto);
        Check("T cuerpo UTF-8 (a acentuada = C3-A1)", true, BitConverter.ToString(t.Cuerpo).Contains("C3-A1"));

        var ap = Rechazo(); ap.Evento = AvisoTeams.SolicitudAprobada; ap.Estado = "APROBADA"; ap.Codigo = "TEST-2026-000001";
        porOmision.Enviar(ap);
        texto = TextoDeTarjeta(t.Cuerpo, out m);
        Check("T aprobacion: posicion 6 = codigo (no el comentario)", "TEST-2026-000001", texto == null ? null : texto.Split('|')[6]);

        var nueva = Rechazo(); nueva.Evento = AvisoTeams.NuevaSolicitud; nueva.Estado = "ENVIADA"; nueva.Codigo = "X"; nueva.SolicitanteNombre = null;
        porOmision.Enviar(nueva);
        texto = TextoDeTarjeta(t.Cuerpo, out m);
        Check("T nueva: posicion 6 vacia y nombre null vacio",
              "NEW_REQUEST|Initiative|usuario@soriana.com||#0000142|ENVIADA|", texto);

        var raro = Rechazo(); raro.Comentario = "Falta | el RCA\r\nY\tya"; raro.SolicitanteNombre = "Ana | Ruiz";
        porOmision.Enviar(raro);
        texto = TextoDeTarjeta(t.Cuerpo, out m);
        var partes = texto == null ? new string[0] : texto.Split('|');
        Check("T | y saltos no corren posiciones", 7, partes.Length);
        Check("T | del nombre cambia a /", "Ana / Ruiz", partes.Length == 7 ? partes[3] : null);
        Check("T | y CR/LF/tab del comentario", "Falta / el RCA  Y ya", partes.Length == 7 ? partes[6] : null);
    }

    static void Formato()
    {
        foreach (var valor in new[] { null, "", "  ", "texto", "TEXTO", " Texto " })
        {
            var t = new TransporteFalso();
            var v = valor;
            Check("F '" + valor + "' = texto", "texto", NuevoCon(delegate { return UrlFalso; }, delegate { return v; }, t).Formato());
            NuevoCon(delegate { return UrlFalso; }, delegate { return v; }, t).Enviar(Rechazo());
            Dictionary<string, object> m;
            Check("F '" + valor + "' manda la tarjeta", true, TextoDeTarjeta(t.Cuerpo, out m) != null);
        }
        {
            var t = new TransporteFalso();
            NuevoCon(delegate { return UrlFalso; }, delegate { return " JSON "; }, t).Enviar(Rechazo());
            Check("F ' JSON ' manda campos con nombre", "usuario@soriana.com", Leer(t.Cuerpo)["solicitanteEmail"]);
        }
        foreach (var valor in new[] { "xml", "text", "json2" })
        {
            Traza.Clear();
            var t = new TransporteFalso();
            var v = valor;
            var r = NuevoCon(delegate { return UrlFalso; }, delegate { return v; }, t).Enviar(Rechazo());
            Check("F '" + valor + "' Invalido", ResultadoAvisoTeams.Invalido, r);
            Check("F '" + valor + "' sin llamar", 0, t.Llamadas);
            Check("F '" + valor + "' registrado", 1, Traza.Count);
        }
        {
            var t = new TransporteFalso();
            var r = NuevoCon(delegate { return UrlFalso; }, delegate { throw new InvalidOperationException("x"); }, t).Enviar(Rechazo());
            Check("F leer formato lanza = Invalido", ResultadoAvisoTeams.Invalido, r);
            Check("F leer formato lanza sin llamar", 0, t.Llamadas);
        }
        Check("F Configurado con URL", true, Nuevo(delegate { return UrlFalso; }, new TransporteFalso()).Configurado());
        Check("F Configurado vacio", false, Nuevo(delegate { return " "; }, new TransporteFalso()).Configurado());
        Check("F Configurado que lanza", false, Nuevo(delegate { throw new InvalidOperationException(); }, new TransporteFalso()).Configurado());

        var d500 = Nuevo(delegate { return UrlFalso; }, new TransporteFalso { Estado = 500 }).EnviarConDetalle(Rechazo());
        Check("F detalle 500: Fallido", ResultadoAvisoTeams.Fallido, d500.Resultado);
        Check("F detalle 500: Http", 500, d500.Http);
        var d202 = Nuevo(delegate { return UrlFalso; }, new TransporteFalso()).EnviarConDetalle(Rechazo());
        Check("F detalle 202: Http", 202, d202.Http);
        var dTo = Nuevo(delegate { return UrlFalso; }, new TransporteFalso { Lanza = new WebException("t", WebExceptionStatus.Timeout) }).EnviarConDetalle(Rechazo());
        Check("F detalle timeout: Red", "Timeout", dTo.Red);
        Check("F detalle timeout: sin Http", true, dTo.Http == null);
    }

    static void Validacion()
    {
        var casos = new Dictionary<string, Action<AvisoSolicitud>>
        {
            { "evento desconocido", delegate (AvisoSolicitud a) { a.Evento = "REQUEST_DELETED"; } },
            { "evento null", delegate (AvisoSolicitud a) { a.Evento = null; } },
            { "evento en minusculas", delegate (AvisoSolicitud a) { a.Evento = "request_rejected"; } },
            { "tipo desconocido", delegate (AvisoSolicitud a) { a.Tipo = "Otro"; } },
            { "sin correo", delegate (AvisoSolicitud a) { a.SolicitanteEmail = " "; } },
            { "sin numero", delegate (AvisoSolicitud a) { a.RequestNumber = null; } },
        };
        foreach (var c in casos)
        {
            var t = new TransporteFalso();
            var a = Rechazo(); c.Value(a);
            Check("V " + c.Key, ResultadoAvisoTeams.Invalido, Nuevo(delegate { return UrlFalso; }, t).Enviar(a));
            Check("V " + c.Key + " sin llamar", 0, t.Llamadas);
        }
        Check("V aviso null", ResultadoAvisoTeams.Invalido, Nuevo(delegate { return UrlFalso; }, new TransporteFalso()).Enviar(null));
        var cambio = Rechazo(); cambio.Tipo = AvisoTeams.TipoCambio; cambio.Evento = AvisoTeams.NuevaSolicitud; cambio.Estado = "PENDIENTE"; cambio.Comentario = null;
        Check("V Change request NEW_REQUEST valido", ResultadoAvisoTeams.Enviado, Nuevo(delegate { return UrlFalso; }, new TransporteFalso()).Enviar(cambio));
    }

    static void Respuestas()
    {
        foreach (var par in new[] { new[] { 200, 0 }, new[] { 202, 0 }, new[] { 204, 0 }, new[] { 400, 1 }, new[] { 401, 1 }, new[] { 500, 1 }, new[] { 302, 1 } })
        {
            Traza.Clear();
            var t = new TransporteFalso { Estado = par[0] };
            var r = Nuevo(delegate { return UrlFalso; }, t).Enviar(Rechazo());
            Check("H HTTP " + par[0], par[1] == 0 ? ResultadoAvisoTeams.Enviado : ResultadoAvisoTeams.Fallido, r);
            Check("H HTTP " + par[0] + " trazas", par[1], Traza.Count);
        }
    }

    static void Excepciones()
    {
        var lanzadas = new Dictionary<string, Exception>
        {
            { "timeout", new WebException("The operation has timed out", WebExceptionStatus.Timeout) },
            { "conexion", new WebException("Unable to connect to prueba.invalid", WebExceptionStatus.ConnectFailure) },
            { "nombre", new WebException("The remote name could not be resolved: 'prueba.invalid'", WebExceptionStatus.NameResolutionFailure) },
            { "io", new IOException("cortado") },
            { "cualquiera", new InvalidOperationException("raro") },
        };
        foreach (var c in lanzadas)
        {
            Traza.Clear();
            ResultadoAvisoTeams r;
            try { r = Nuevo(delegate { return UrlFalso; }, new TransporteFalso { Lanza = c.Value }).Enviar(Rechazo()); }
            catch (Exception ex) { Check("E " + c.Key + " no propaga", "sin excepcion", ex.GetType().Name); continue; }
            Check("E " + c.Key + " Fallido", ResultadoAvisoTeams.Fallido, r);
            Check("E " + c.Key + " registrado", 1, Traza.Count);
        }
        Traza.Clear();
        Nuevo(delegate { return UrlFalso; }, new TransporteFalso { Lanza = lanzadas["timeout"] }).Enviar(Rechazo());
        Check("E timeout dice Timeout", true, Traza.Count == 1 && Traza[0].Contains("Timeout"));

        // Un registrador que lanza tampoco sale.
        var malo = new AvisoTeams(delegate { return UrlFalso; }, new TransporteFalso { Estado = 500 },
                                  delegate (string c, Exception e) { throw new InvalidOperationException("traza caida"); }, 5000);
        try { Check("E registrador que lanza", ResultadoAvisoTeams.Fallido, malo.Enviar(Rechazo())); }
        catch (Exception ex) { Check("E registrador que lanza no propaga", "sin excepcion", ex.GetType().Name); }
        // Sin registrador: igual.
        var mudo = new AvisoTeams(delegate { return UrlFalso; }, new TransporteFalso { Estado = 500 }, null, 5000);
        Check("E sin registrador", ResultadoAvisoTeams.Fallido, mudo.Enviar(Rechazo()));
    }

    static void Seguridad()
    {
        Traza.Clear();
        var a = Rechazo(); a.Comentario = "comentario-privado|x";
        Nuevo(delegate { return UrlFalso; }, new TransporteFalso { Estado = 500 }).Enviar(a);
        Nuevo(delegate { return UrlFalso; }, new TransporteFalso { Lanza = new WebException("fallo hacia " + UrlFalso, WebExceptionStatus.ConnectFailure) }).Enviar(a);
        Nuevo(delegate { return UrlFalso; }, new TransporteFalso { Lanza = new InvalidOperationException(UrlFalso) }).Enviar(a);
        Nuevo(delegate { return UrlFalso.Replace("https", "http"); }, new TransporteFalso()).Enviar(a);
        var b = Rechazo(); b.Evento = "X";
        Nuevo(delegate { return UrlFalso; }, new TransporteFalso()).Enviar(b);
        var todo = string.Join("\n", Traza.ToArray());
        Check("S hubo trazas", 5, Traza.Count);
        Check("S sin firma", false, todo.Contains("SECRETO123"));
        Check("S sin host", false, todo.Contains("prueba.invalid"));
        Check("S sin correo", false, todo.Contains("usuario@soriana.com"));
        Check("S sin comentario", false, todo.Contains("comentario-privado"));
        Check("S con numero de solicitud", true, todo.Contains("#0000142"));
        Check("S categoria", true, Traza.TrueForAll(x => x.StartsWith("AvisoTeams: ErrorAvisoTeams: ")));
    }

    // ---- Servidor HTTP minimo en 127.0.0.1 (TcpListener: sin reserva de URL) ----
    sealed class Servidor : IDisposable
    {
        readonly TcpListener l = new TcpListener(IPAddress.Loopback, 0);
        readonly Thread hilo;
        public string Recibido;      // cabeceras + cuerpo, en UTF-8
        public byte[] Cuerpo;
        public readonly ManualResetEvent Listo = new ManualResetEvent(false);
        public int Puerto { get { return ((IPEndPoint)l.LocalEndpoint).Port; } }

        // estado = 0: nunca responde (para el timeout).
        public Servidor(int estado)
        {
            l.Start();
            hilo = new Thread(delegate ()
            {
                try
                {
                    using (var c = l.AcceptTcpClient())
                    {
                        var s = c.GetStream();
                        var buf = new MemoryStream();
                        var b = new byte[4096];
                        int fin = -1, largo = 0;
                        while (true)
                        {
                            var n = s.Read(b, 0, b.Length);
                            if (n <= 0) break;
                            buf.Write(b, 0, n);
                            var texto = Encoding.ASCII.GetString(buf.ToArray());
                            if (fin < 0)
                            {
                                fin = texto.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                                if (fin >= 0)
                                {
                                    foreach (var linea in texto.Substring(0, fin).Split(new[] { "\r\n" }, StringSplitOptions.None))
                                        if (linea.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                                            largo = int.Parse(linea.Substring(15).Trim());
                                }
                            }
                            if (fin >= 0 && buf.Length >= fin + 4 + largo) break;
                        }
                        var todo = buf.ToArray();
                        Cuerpo = new byte[largo];
                        Array.Copy(todo, fin + 4, Cuerpo, 0, largo);
                        Recibido = Encoding.UTF8.GetString(todo);
                        Listo.Set();
                        if (estado == 0) { Thread.Sleep(4000); return; }
                        var ubicacion = estado == 302 ? "Location: http://127.0.0.1:1/otro\r\n" : "";
                        var resp = Encoding.ASCII.GetBytes("HTTP/1.1 " + estado + " X\r\n" + ubicacion + "Content-Length: 0\r\nConnection: close\r\n\r\n");
                        s.Write(resp, 0, resp.Length);
                    }
                }
                catch (Exception) { Listo.Set(); }
            });
            hilo.IsBackground = true;
            hilo.Start();
        }

        public void Dispose() { try { l.Stop(); } catch (Exception) { } }
    }

    static void TransporteReal()
    {
        var cuerpo = Encoding.UTF8.GetBytes(AvisoTeams.ComoJson(Rechazo()));
        var t = new TransporteAvisoTeamsHttp();

        using (var srv = new Servidor(202))
        {
            int estado = -1;
            try { estado = t.Post(new Uri("http://127.0.0.1:" + srv.Puerto + "/hook"), cuerpo, 3000); }
            catch (Exception ex) { Console.WriteLine("      " + ex.GetType().Name + ": " + ex.Message); }
            srv.Listo.WaitOne(3000);
            Check("R 202 devuelve 202", 202, estado);
            Check("R POST", true, srv.Recibido != null && srv.Recibido.StartsWith("POST /hook "));
            Check("R Content-Type JSON UTF-8", true, srv.Recibido != null && srv.Recibido.Contains("Content-Type: application/json; charset=utf-8"));
            Check("R cuerpo identico (bytes)", Convert.ToBase64String(cuerpo), srv.Cuerpo == null ? null : Convert.ToBase64String(srv.Cuerpo));
        }

        using (var srv = new Servidor(500))
        {
            int estado = -1;
            try { estado = t.Post(new Uri("http://127.0.0.1:" + srv.Puerto + "/hook"), cuerpo, 3000); }
            catch (Exception ex) { Console.WriteLine("      " + ex.GetType().Name + ": " + ex.Message); }
            Check("R 500 devuelve 500 (no lanza)", 500, estado);
        }

        using (var srv = new Servidor(302))
        {
            int estado = -1;
            try { estado = t.Post(new Uri("http://127.0.0.1:" + srv.Puerto + "/hook"), cuerpo, 3000); }
            catch (Exception ex) { Console.WriteLine("      " + ex.GetType().Name + ": " + ex.Message); }
            Check("R 302 no se sigue (devuelve 302)", 302, estado);
        }

        using (var srv = new Servidor(0))
        {
            var reloj = Stopwatch.StartNew();
            string obtenido = "sin excepcion";
            try { t.Post(new Uri("http://127.0.0.1:" + srv.Puerto + "/hook"), cuerpo, 1000); }
            catch (WebException ex) { obtenido = "WebException " + ex.Status; }
            catch (Exception ex) { obtenido = ex.GetType().Name; }
            reloj.Stop();
            Check("R servidor mudo = Timeout", "WebException Timeout", obtenido);
            Check("R timeout dentro del limite (< 3 s)", true, reloj.ElapsedMilliseconds < 3000);
        }
    }
}
