// Prueba offline del Correo RCA de prueba (App_Code/RcaCorreoPrueba.cs y
// handlers/admin_rca_correo.ashx). Sin IIS, sin SQL Server y SIN INTERNET: el
// HTTP hacia Microsoft (login.microsoftonline.com / graph.microsoft.com), el
// almacen de archivos y el cifrado son falsos (el bloque L abre un servidor
// SMTP solo en 127.0.0.1). NO prueba la entrega real a un
// buzon: eso es la prueba manual del README (DASHBOARD.md, "Correo RCA").
//
// Casos:
//   C  configuracion: leer sin archivo, guardar y releer, Para obligatorio,
//      CC opcional, una sola direccion, JSON corrupto, almacen que falla.
//   A  adjunto: extensiones permitidas, MIME, tamano, firma del archivo,
//      renombrado a Prueba_RCA.<ext original>, ruta de Windows.
//   T  titulo y asunto.
//   M  mensaje y JSON de Graph (Para, CC, sin CC, adjunto, base64).
//   E  envio: exito, refresh token rotado, cache del access token, 401 con
//      reintento, 400/403/429/500, invalid_grant, sin red, tiempo agotado
//      (resultado desconocido), sin destinatarios / remitente / config,
//      cuenta distinta, archivo invalido sin tocar la red.
//   V  destinatarios guardados invalidos (archivo editado): el envio los
//      revalida y no sale nada.
//   D  cifrado REAL con DPAPI de maquina: ida y vuelta, sin texto en claro,
//      blob alterado, y descifrado desde OTRO proceso (como un reciclado).
//   R  intentos repetidos: fallo y luego exito; dos exitos seguidos; un
//      segundo envio simultaneo recibe EnvioEnCurso.
//   K  conexion por codigo de dispositivo: pendiente, intervalo, exito,
//      cuenta distinta (no guarda), rechazo, expirado; Estado sin tokens.
//   S  modo SMTP (RcaModo=smtp) con SMTP falso: configuracion, contrasena
//      (cifrada, nunca en Estado), envio, relevo sin contrasena y la
//      traduccion de cada excepcion de SmtpClient.
//   L  SmtpClient REAL contra un servidor SMTP en 127.0.0.1 (sin internet):
//      mensaje armado (From, Cc, asunto UTF-8, adjunto), clave rechazada
//      (535 -> 530 como Gmail), destinatario rechazado y puerto cerrado.
//   H  handler: anonimo, VIEWER y MOD 403; ADM GET 200; ADM POST cross-site
//      403 OrigenNoPermitido; el fuente llama ExigirAdm antes que nada y no
//      toca SQL ni los flujos de iniciativas.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll /r:System.Core.dll App_Code\*.cs
//   (handlers\admin_rca_correo.ashx sin su linea 1 -> h\admin_rca_correo.cs)
//   csc /nologo /target:library /out:hnd.dll /r:adm.dll /r:System.dll /r:System.Web.dll ^
//       /r:System.Web.Extensions.dll /r:System.Core.dll h\admin_rca_correo.cs
//   csc /nologo /out:RcaSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Web.dll ^
//       /r:System.Web.Extensions.dll /r:System.Core.dll tools\tests\RcaCorreoPruebaSmoke.cs
//   RcaSmoke.exe
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web;
using System.Web.Script.Serialization;

sealed class AlmacenMemoria : IAlmacenRca
{
    public readonly Dictionary<string, string> Archivos = new Dictionary<string, string>();
    public bool FallaLeer, FallaEscribir;
    public int Escrituras;
    public string Leer(string n) { if (FallaLeer) throw new IOException("disco"); string v; return Archivos.TryGetValue(n, out v) ? v : null; }
    public void Escribir(string n, string c) { if (FallaEscribir) throw new UnauthorizedAccessException("sin permiso"); Escrituras++; Archivos[n] = c; }
    public void Borrar(string n) { Archivos.Remove(n); }
}

// "Cifra" con un prefijo + base64: basta para comprobar que lo guardado no
// es el token en claro y que se descifra al leer.
sealed class ProtectorFalso : IProtectorRca
{
    public string Proteger(string t) { return "P1:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(t)); }
    public string Desproteger(string p)
    {
        if (!p.StartsWith("P1:")) throw new InvalidOperationException("llave distinta");
        return Encoding.UTF8.GetString(Convert.FromBase64String(p.Substring(3)));
    }
}

sealed class Llamada { public string Metodo, Url, Cuerpo, Bearer; }

sealed class HttpFalso : IHttpRca
{
    public readonly List<Llamada> Llamadas = new List<Llamada>();
    // Respuestas por "pieza de URL", en orden de uso; la ultima se repite.
    public readonly Dictionary<string, Queue<Func<Llamada, RespuestaHttpRca>>> Guion = new Dictionary<string, Queue<Func<Llamada, RespuestaHttpRca>>>();
    private readonly Dictionary<string, Func<Llamada, RespuestaHttpRca>> _ultima = new Dictionary<string, Func<Llamada, RespuestaHttpRca>>();

    public HttpFalso Cuando(string pieza, int status, string cuerpo)
    {
        return Cuando(pieza, delegate (Llamada l) { return new RespuestaHttpRca { Status = status, Cuerpo = cuerpo }; });
    }

    public HttpFalso Cuando(string pieza, Func<Llamada, RespuestaHttpRca> f)
    {
        if (!Guion.ContainsKey(pieza)) Guion[pieza] = new Queue<Func<Llamada, RespuestaHttpRca>>();
        Guion[pieza].Enqueue(f);
        return this;
    }

    public RespuestaHttpRca Enviar(string metodo, string url, string contentType, string cuerpo, string bearer, int timeoutMs)
    {
        var l = new Llamada { Metodo = metodo, Url = url, Cuerpo = cuerpo, Bearer = bearer };
        lock (Llamadas) Llamadas.Add(l);
        foreach (var k in Guion.Keys)
        {
            if (url.IndexOf(k, StringComparison.Ordinal) < 0) continue;
            var q = Guion[k];
            if (q.Count > 0) _ultima[k] = q.Dequeue();
            Func<Llamada, RespuestaHttpRca> f;
            if (_ultima.TryGetValue(k, out f)) return f(l);
        }
        throw new InvalidOperationException("Llamada sin guion: " + url);
    }

    public int Cuantas(string pieza) { lock (Llamadas) return Llamadas.Count(l => l.Url.IndexOf(pieza, StringComparison.Ordinal) >= 0); }
}

// SMTP falso: guarda lo que se le pidio mandar; `Lanzar` simula a SmtpClient.
sealed class SmtpFalso : ISmtpRca
{
    public readonly List<MensajeRca> Enviados = new List<MensajeRca>();
    public readonly List<string> Claves = new List<string>();
    public Exception Lanzar;
    public void Enviar(OpcionesRca op, string clave, MensajeRca m, int timeoutMs)
    {
        Claves.Add(clave);
        if (Lanzar != null) throw Lanzar;
        Enviados.Add(m);
    }
}

static class RcaCorreoPruebaSmoke
{
    static int fallos, pasados;
    const string REM = "remitente.rca@outlook.com";
    const string TOKEN = "/oauth2/v2.0/token";
    const string SEND = "/me/sendMail";
    const string ME = "/v1.0/me?";
    static DateTime Ahora = new DateTime(2026, 11, 3, 10, 0, 0);

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static readonly byte[] PDF = Encoding.ASCII.GetBytes("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
    static readonly byte[] ZIP = new byte[] { 0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 1, 2, 3 };
    static readonly byte[] OLE = new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0 };

    static OpcionesRca Opciones()
    {
        return new OpcionesRca { Remitente = REM, ClientId = "00000000-1111-2222-3333-444444444444", Tenant = "consumers", DirDatos = "X:\\no-se-usa", MaxBytes = RcaAdjunto.MaxBytesTecnico };
    }

    static ServicioRca Servicio(AlmacenMemoria a, HttpFalso h, OpcionesRca op = null)
    {
        ServicioRca.ReiniciarEstado();
        return new ServicioRca(op ?? Opciones(), a, h, new ProtectorFalso(), () => Ahora);
    }

    // Almacen con destinatarios y cuenta remitente ya conectada.
    static AlmacenMemoria Listo(string cuenta = REM, string cc = REM)
    {
        var a = new AlmacenMemoria();
        RcaConfiguracion.Guardar(a, REM, cc, "SORIANA\\adm", Ahora, new Dictionary<string, string>());
        var json = new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "refresh_token", "RT-1" }, { "cuenta", cuenta }, { "conectadoPor", "SORIANA\\adm" }, { "conectadoEl", "2026-11-03T09:00:00" } });
        a.Archivos[ServicioRca.ArchivoCuenta] = new ProtectorFalso().Proteger(json);
        a.Escrituras = 0;
        return a;
    }

    static string TokenOk(string access, string refresh) { return "{\"access_token\":\"" + access + "\",\"refresh_token\":\"" + refresh + "\",\"expires_in\":3600}"; }

    static Dictionary<string, object> Json(string s) { return new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Deserialize<Dictionary<string, object>>(s); }

    static int Main(string[] args)
    {
        // Proceso hijo de D7: descifra con DPAPI lo que cifro el padre.
        if (args.Length == 2 && args[0] == "--descifrar")
        {
            Console.WriteLine(new ProtectorRcaDpapi().Desproteger(File.ReadAllText(args[1])));
            return 0;
        }
        Configuracion();
        Adjunto();
        TituloAsunto();
        Mensaje();
        Envio();
        Repetidos();
        Conexion();
        Smtp();
        SmtpReal();
        Handler();
        Dpapi(System.Reflection.Assembly.GetExecutingAssembly().Location);
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }

    // ---- C ------------------------------------------------------------------
    static void Configuracion()
    {
        var a = new AlmacenMemoria();
        var d = RcaConfiguracion.Leer(a);
        Check("C1 sin archivo: vacio", "||False", d.Para + "|" + d.Cc + "|" + d.Completo);

        var err = new Dictionary<string, string>();
        d = RcaConfiguracion.Guardar(a, "  yo@outlook.com ", " yo@outlook.com", "SORIANA\\adm", Ahora, err);
        Check("C2 guardar recorta y no hay errores", "yo@outlook.com|yo@outlook.com|0", d.Para + "|" + d.Cc + "|" + err.Count);
        d = RcaConfiguracion.Leer(a);
        Check("C3 releer lo guardado (con quien y cuando)", "yo@outlook.com|yo@outlook.com|SORIANA\\adm|2026-11-03T10:00:00|True",
              d.Para + "|" + d.Cc + "|" + d.ModificadoPor + "|" + d.ModificadoEl + "|" + d.Completo);

        err.Clear();
        Check("C4 Para vacio: error y no guarda", "True|para|1",
              (RcaConfiguracion.Guardar(a, "", "", "x", Ahora, err) == null) + "|" + string.Join(",", err.Keys) + "|" + a.Escrituras);

        err.Clear();
        Check("C5 CC invalido: error", "cc", RcaConfiguracion.Guardar(a, "a@b.com", "no-es-correo", "x", Ahora, err) == null ? string.Join(",", err.Keys) : "guardo");
        err.Clear();
        Check("C6 dos direcciones en Para: error", "Solo una direccion de correo.",
              RcaConfiguracion.Guardar(a, "a@b.com; c@d.com", "", "x", Ahora, err) == null ? err["para"] : "guardo");
        err.Clear();
        Check("C7 dos direcciones con coma en CC: error", "Solo una direccion de correo.",
              RcaConfiguracion.Guardar(a, "a@b.com", "c@d.com,e@f.com", "x", Ahora, err) == null ? err["cc"] : "guardo");
        err.Clear();
        d = RcaConfiguracion.Guardar(a, "problemTI@soriana.com", "", "x", Ahora, err);
        Check("C8 CC vacio es valido (sin copia)", "problemTI@soriana.com||True", d.Para + "|" + d.Cc + "|" + RcaConfiguracion.Leer(a).Completo);
        err.Clear();
        Check("C9 marcado en el correo: error", "True", RcaConfiguracion.Guardar(a, "<x>@b.com", "", "x", Ahora, err) == null);

        a.Archivos[RcaConfiguracion.Archivo] = "{no es json";
        Check("C10 JSON corrupto: vacio, no truena", "|False", RcaConfiguracion.Leer(a).Para + "|" + RcaConfiguracion.Leer(a).Completo);

        var malo = new AlmacenMemoria { FallaLeer = true };
        Check("C11 almacen que no lee: AlmacenNoDisponible", "AlmacenNoDisponible", Codigo(() => RcaConfiguracion.Leer(malo)));
        var sinEscribir = new AlmacenMemoria { FallaEscribir = true };
        Check("C12 almacen que no escribe: AlmacenNoDisponible", "AlmacenNoDisponible",
              Codigo(() => RcaConfiguracion.Guardar(sinEscribir, "a@b.com", "", "x", Ahora, new Dictionary<string, string>())));

        // Almacen real en una carpeta temporal: escribe, reemplaza y borra.
        var dir = Path.Combine(Path.GetTempPath(), "rca-smoke-" + Guid.NewGuid().ToString("N"));
        try
        {
            var real = new AlmacenRcaArchivos(dir);
            real.Escribir("x.json", "uno");
            real.Escribir("x.json", "dos");
            Check("C13 almacen de archivos: reemplazo atomico y sin .tmp", "dos|1", real.Leer("x.json") + "|" + Directory.GetFiles(dir).Length);
            real.Borrar("x.json");
            Check("C14 almacen de archivos: borrar", "True", real.Leer("x.json") == null);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    static string Codigo(Action a)
    {
        try { a(); return "sin excepcion"; }
        catch (RcaException ex) { return ex.Codigo; }
    }

    // ---- A ------------------------------------------------------------------
    static string Val(string nombre, string mime, byte[] b, int max = RcaAdjunto.MaxBytesTecnico)
    {
        RcaAdjuntoValido r;
        var e = RcaAdjunto.Validar(nombre, mime, b, max, out r);
        return e ?? (r.NombreSalida + "|" + r.Mime);
    }

    static void Adjunto()
    {
        Check("A1 pdf valido -> Prueba_RCA.pdf", "Prueba_RCA.pdf|application/pdf", Val("RCA final v7.pdf", "application/pdf", PDF));
        Check("A2 conserva la grafia de la extension", "Prueba_RCA.PDF|application/pdf", Val("INFORME.PDF", "application/pdf", PDF));
        Check("A3 docx con octet-stream (equipo sin Office)", "Prueba_RCA.docx|application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              Val("rca.docx", "application/octet-stream", ZIP));
        Check("A4 xlsx con su MIME", "Prueba_RCA.xlsx|application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              Val("rca.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ZIP));
        Check("A5 doc (OLE)", "Prueba_RCA.doc|application/msword", Val("rca.doc", "application/msword", OLE));
        Check("A6 ruta de Windows (IE) -> solo el nombre", "Prueba_RCA.pdf|application/pdf", Val("C:\\Users\\x\\Desktop\\rca.pdf", "application/pdf", PDF));
        Check("A7 MIME con parametros", "Prueba_RCA.pdf|application/pdf", Val("rca.pdf", "application/pdf; charset=binary", PDF));
        Check("A8 .exe no permitido", true, Val("rca.exe", "application/octet-stream", new byte[] { 0x4D, 0x5A }).StartsWith("Tipo de documento no permitido"));
        Check("A9 sin extension", true, Val("rca", "application/pdf", PDF).StartsWith("Tipo de documento no permitido"));
        Check("A10 doble extension engañosa .pdf.exe", true, Val("rca.pdf.exe", "application/pdf", PDF).StartsWith("Tipo de documento no permitido"));
        Check("A11 vacio", "El documento esta vacio.", Val("rca.pdf", "application/pdf", new byte[0]));
        Check("A12 sin archivo", "Selecciona un documento.", Val(null, null, null));
        Check("A13 pasa del maximo", "El documento pasa del maximo de 3 MB.", Val("rca.pdf", "application/pdf", new byte[RcaAdjunto.MaxBytesTecnico + 1]));
        Check("A14 justo en el maximo configurado es valido", "Prueba_RCA.pdf|application/pdf", Val("rca.pdf", "application/pdf", PDF, PDF.Length));
        Check("A15 MIME que no corresponde (image/png como .pdf)", "El tipo del archivo (image/png) no corresponde a .pdf.", Val("rca.pdf", "image/png", PDF));
        Check("A16 MIME de otro documento (docx declarado como pdf)", true, Val("rca.pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", PDF).StartsWith("El tipo del archivo"));
        Check("A17 firma que no corresponde (.pdf con contenido zip)", "El contenido del archivo no corresponde a un .pdf.", Val("rca.pdf", "application/pdf", ZIP));
        Check("A18 .docx con contenido de texto", "El contenido del archivo no corresponde a un .docx.", Val("rca.docx", "", Encoding.ASCII.GetBytes("hola")));
        Check("A19 tope: 0 o mas de 3 MB -> 3 MB; menor se respeta", "3145728|3145728|1000",
              RcaAdjunto.Tope(0) + "|" + RcaAdjunto.Tope(50000000) + "|" + RcaAdjunto.Tope(1000));
    }

    // ---- T ------------------------------------------------------------------
    static void TituloAsunto()
    {
        string t;
        Check("T1 titulo recortado y asunto", "null|PRUEBA RCA - Caida WMS", (RcaMensaje.ValidarTitulo("  Caida WMS ", out t) ?? "null") + "|" + RcaMensaje.Asunto(t));
        Check("T2 titulo vacio", "Escribe el titulo de prueba.", RcaMensaje.ValidarTitulo("   ", out t));
        Check("T3 titulo de 150 es valido", "null", RcaMensaje.ValidarTitulo(new string('a', 150), out t) ?? "null");
        Check("T4 titulo de 151 no", "Maximo 150 caracteres.", RcaMensaje.ValidarTitulo(new string('a', 151), out t));
        Check("T5 salto de linea (inyeccion de cabecera) no", true, RcaMensaje.ValidarTitulo("a\r\nBcc: x@y.com", out t) != null);
        Check("T6 acentos y simbolos se conservan", "PRUEBA RCA - Análisis #1 (Sitio Ñ)", RcaMensaje.ValidarTitulo("Análisis #1 (Sitio Ñ)", out t) == null ? RcaMensaje.Asunto(t) : "rechazado");
    }

    // ---- M ------------------------------------------------------------------
    static RcaAdjuntoValido AdjPdf()
    {
        RcaAdjuntoValido r;
        RcaAdjunto.Validar("rca.pdf", "application/pdf", PDF, RcaAdjunto.MaxBytesTecnico, out r);
        return r;
    }

    static void Mensaje()
    {
        var d = new RcaDestinatarios { Para = "para@outlook.com", Cc = "cc@outlook.com" };
        var m = RcaMensaje.Armar(d, "Caida WMS", AdjPdf(), "SORIANA\\adm", Ahora);
        Check("M1 asunto, Para y CC", "PRUEBA RCA - Caida WMS|para@outlook.com|cc@outlook.com", m.Asunto + "|" + m.Para + "|" + m.Cc);
        Check("M2 cuerpo dice que es prueba y quien la mando", "True|True|True",
              m.Cuerpo.Contains("PRUEBA") + "|" + m.Cuerpo.Contains("SORIANA\\adm") + "|" + m.Cuerpo.Contains("no se creo ninguna iniciativa ni solicitud"));

        var j = Json(RcaMensaje.JsonGraph(m));
        var msg = (Dictionary<string, object>)j["message"];
        var to = (Dictionary<string, object>)((Dictionary<string, object>)((System.Collections.IList)msg["toRecipients"])[0])["emailAddress"];
        var cc = (Dictionary<string, object>)((Dictionary<string, object>)((System.Collections.IList)msg["ccRecipients"])[0])["emailAddress"];
        var adj = (Dictionary<string, object>)((System.Collections.IList)msg["attachments"])[0];
        Check("M3 JSON: asunto, Para, CC", "PRUEBA RCA - Caida WMS|para@outlook.com|cc@outlook.com", msg["subject"] + "|" + to["address"] + "|" + cc["address"]);
        Check("M4 JSON: un solo Para y un solo CC", "1|1", ((System.Collections.IList)msg["toRecipients"]).Count + "|" + ((System.Collections.IList)msg["ccRecipients"]).Count);
        Check("M5 JSON: adjunto renombrado, tipo y bytes intactos", "#microsoft.graph.fileAttachment|Prueba_RCA.pdf|application/pdf|True",
              adj["@odata.type"] + "|" + adj["name"] + "|" + adj["contentType"] + "|" + Convert.FromBase64String((string)adj["contentBytes"]).SequenceEqual(PDF));
        Check("M6 JSON: se guarda en Enviados", "True", j["saveToSentItems"]);
        Check("M7 JSON: el nombre original no viaja", "False", RcaMensaje.JsonGraph(m).Contains("rca.pdf"));

        var sinCc = RcaMensaje.Armar(new RcaDestinatarios { Para = "para@outlook.com", Cc = "" }, "x", AdjPdf(), null, Ahora);
        Check("M8 sin CC: no hay ccRecipients", "False", ((Dictionary<string, object>)Json(RcaMensaje.JsonGraph(sinCc))["message"]).ContainsKey("ccRecipients"));
        Check("M9 Para y CC iguales (la prueba inicial) se respetan", "a@outlook.com|a@outlook.com",
              RcaMensaje.Armar(new RcaDestinatarios { Para = "a@outlook.com", Cc = "a@outlook.com" }, "x", AdjPdf(), null, Ahora).Para + "|" +
              RcaMensaje.Armar(new RcaDestinatarios { Para = "a@outlook.com", Cc = "a@outlook.com" }, "x", AdjPdf(), null, Ahora).Cc);
        Check("M10 sin destinatarios validos: SinDestinatarios", "SinDestinatarios",
              Codigo(() => RcaMensaje.Armar(new RcaDestinatarios(), "x", AdjPdf(), null, Ahora)));
    }

    // ---- E ------------------------------------------------------------------
    static ResultadoEnvioRca Enviar(ServicioRca s, string titulo = "Caida WMS", string nombre = "rca.pdf", string mime = "application/pdf", byte[] b = null)
    {
        return s.EnviarPrueba(titulo, nombre, mime, b ?? PDF, "SORIANA\\adm");
    }

    static void Envio()
    {
        // E1 exito: refresh -> access -> sendMail con Bearer; token rotado guardado cifrado.
        var a = Listo();
        var h = new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT-1", "RT-2")).Cuando(SEND, 202, "");
        var s = Servicio(a, h);
        var r = Enviar(s);
        Check("E1 exito", "True|Enviado", r.Ok + "|" + r.Codigo);
        var tokenCall = h.Llamadas.First(l => l.Url.Contains(TOKEN));
        Check("E2 canje con refresh_token y Mail.Send", "True|True|True",
              tokenCall.Cuerpo.Contains("grant_type=refresh_token") + "|" + tokenCall.Cuerpo.Contains("refresh_token=RT-1") + "|" + tokenCall.Cuerpo.Contains("Mail.Send"));
        var send = h.Llamadas.First(l => l.Url.Contains(SEND));
        Check("E3 sendMail con el access token y el asunto", "AT-1|True|True", send.Bearer + "|" + send.Cuerpo.Contains("PRUEBA RCA - Caida WMS") + "|" + send.Cuerpo.Contains("Prueba_RCA.pdf"));
        string p;
        Check("E4 refresh token rotado: se guarda el nuevo, cifrado", "RT-2|False", s.LeerCuenta(out p).RefreshToken + "|" + a.Archivos[ServicioRca.ArchivoCuenta].Contains("RT-2"));
        Check("E5 el mensaje de exito nombra Para, CC y adjunto", "True|True|True", r.Mensaje.Contains(REM) + "|" + r.Mensaje.Contains("CC") + "|" + r.Mensaje.Contains("Prueba_RCA.pdf"));

        // E6 segundo envio reutiliza el access token en cache.
        r = Enviar(s);
        Check("E6 cache del access token: un solo canje para dos envios", "True|1|2", r.Ok + "|" + h.Cuantas(TOKEN) + "|" + h.Cuantas(SEND));

        // E7 401 -> renueva y reintenta una vez.
        h = new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT-1", "RT-1")).Cuando(TOKEN, 200, TokenOk("AT-2", "RT-1"))
                           .Cuando(SEND, 401, "{\"error\":{\"code\":\"InvalidAuthenticationToken\"}}").Cuando(SEND, 202, "");
        r = Enviar(Servicio(Listo(), h));
        Check("E7 401 y reintento con token nuevo", "True|2|2|AT-2", r.Ok + "|" + h.Cuantas(TOKEN) + "|" + h.Cuantas(SEND) + "|" + h.Llamadas.Last().Bearer);

        Check("E8 400 -> GraphRechazo con el codigo de Graph", "False|GraphRechazo|True",
              Res(new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, 400, "{\"error\":{\"code\":\"ErrorInvalidRecipients\",\"message\":\"x\"}}"), "ErrorInvalidRecipients"));
        Check("E9 403 -> GraphSinPermiso", "False|GraphSinPermiso|True",
              Res(new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, 403, "{\"error\":{\"code\":\"ErrorAccessDenied\"}}"), "Mail.Send"));
        Check("E10 429 -> GraphLimite", "False|GraphLimite|True",
              Res(new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, 429, ""), "Espera"));
        Check("E11 503 -> GraphNoDisponible", "False|GraphNoDisponible|True",
              Res(new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, 503, "<html>"), "No se envio"));
        Check("E12 invalid_grant -> ReconectarRemitente, sin sendMail", "False|ReconectarRemitente|True",
              Res(new HttpFalso().Cuando(TOKEN, 400, "{\"error\":\"invalid_grant\",\"error_description\":\"AADSTS70000: expired\"}"), "Vuelve a conectar"));

        h = new HttpFalso().Cuando(TOKEN, delegate (Llamada l) { throw new WebException("dns", WebExceptionStatus.NameResolutionFailure); });
        r = Enviar(Servicio(Listo(), h));
        Check("E13 sin red al pedir token -> SinConexion, nombra los hosts", "False|SinConexion|True", r.Ok + "|" + r.Codigo + "|" + r.Mensaje.Contains("graph.microsoft.com"));

        h = new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, delegate (Llamada l) { throw new WebException("timeout", WebExceptionStatus.Timeout); });
        r = Enviar(Servicio(Listo(), h));
        Check("E14 tiempo agotado en sendMail -> ResultadoDesconocido (pudo salir)", "False|ResultadoDesconocido|True", r.Ok + "|" + r.Codigo + "|" + r.Mensaje.Contains("PUDO"));

        h = new HttpFalso();
        var vacio = new AlmacenMemoria();
        r = Enviar(Servicio(vacio, h));
        Check("E15 sin destinatarios -> SinDestinatarios, sin red", "SinDestinatarios|0", r.Codigo + "|" + h.Llamadas.Count);

        var sinCuenta = Listo(); sinCuenta.Archivos.Remove(ServicioRca.ArchivoCuenta);
        r = Enviar(Servicio(sinCuenta, h));
        Check("E16 sin cuenta conectada -> SinRemitente, sin red", "SinRemitente|0", r.Codigo + "|" + h.Llamadas.Count);

        r = Enviar(Servicio(Listo("otra@outlook.com"), h));
        Check("E17 cuenta conectada distinta de RcaRemitente -> CuentaDistinta, sin red", "CuentaDistinta|0", r.Codigo + "|" + h.Llamadas.Count);

        var cifradoAjeno = Listo(); cifradoAjeno.Archivos[ServicioRca.ArchivoCuenta] = "OTRA-LLAVE";
        r = Enviar(Servicio(cifradoAjeno, h));
        Check("E18 token que no se descifra (otro servidor o danado) -> SinRemitente con aviso", "SinRemitente|True", r.Codigo + "|" + r.Mensaje.Contains("vuelve a conectarla"));

        var op = Opciones(); op.ClientId = null;
        r = Enviar(Servicio(Listo(), h, op));
        Check("E19 sin RcaOAuthClientId -> SinConfiguracion, sin red", "SinConfiguracion|True|0", r.Codigo + "|" + r.Mensaje.Contains("RcaOAuthClientId") + "|" + h.Llamadas.Count);

        r = Enviar(Servicio(Listo(), h), nombre: "virus.exe", mime: "application/octet-stream", b: new byte[] { 0x4D, 0x5A });
        Check("E20 archivo invalido -> AdjuntoInvalido, sin red", "AdjuntoInvalido|0", r.Codigo + "|" + h.Llamadas.Count);
        r = Enviar(Servicio(Listo(), h), titulo: "");
        Check("E21 sin titulo -> TituloInvalido, sin red", "TituloInvalido|0", r.Codigo + "|" + h.Llamadas.Count);

        var noRota = Listo(); var hn = new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-NUEVO")).Cuando(SEND, 202, "");
        var sn = Servicio(noRota, hn); noRota.FallaEscribir = true;
        r = Enviar(sn);
        Check("E22 no poder guardar el token rotado no impide enviar", "True", r.Ok);

        // V: destinatarios GUARDADOS que no pasan la regla (archivo editado a
        // mano o danado). El envio los revalida: nada sale y no hay red.
        var malos = new[]
        {
            new[] { "V1 Para con dos direcciones (;)",          "a@outlook.com;b@outlook.com", "",                 "Correo RCA" },
            new[] { "V2 Para con forma invalida",               "no-es-correo",                "",                 "Correo RCA" },
            new[] { "V3 Para con marcado",                      "<a>@outlook.com",             "",                 "Correo RCA" },
            new[] { "V4 Para de mas de 254 caracteres",         new string('a', 250) + "@x.com", "",               "Correo RCA" },
            new[] { "V5 CC con dos direcciones (,)",            REM,                           "a@x.com,b@x.com",  "CC RCA" },
            new[] { "V6 CC con salto de linea (inyeccion Bcc)", REM,                           "a@x.com\r\nBcc: z@x.com", "CC RCA" },
            new[] { "V7 CC con espacio interno",                REM,                           "a b@x.com",        "CC RCA" },
        };
        foreach (var c in malos)
        {
            var am = Listo();
            am.Archivos[RcaConfiguracion.Archivo] = new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "para", c[1] }, { "cc", c[2] } });
            var hv = new HttpFalso();
            r = Enviar(Servicio(am, hv));
            Check(c[0] + " guardado -> SinDestinatarios, nombra el campo, sin red", "False|SinDestinatarios|True|0",
                  r.Ok + "|" + r.Codigo + "|" + r.Mensaje.Contains(c[3] + " guardado no es valido") + "|" + hv.Llamadas.Count);
        }

        var ae = Listo(); ae.Archivos[RcaConfiguracion.Archivo] = "{\"para\":\"\",\"cc\":\"\"}";
        var he = new HttpFalso();
        r = Enviar(Servicio(ae, he));
        Check("V8 Para vacio guardado -> pide guardarlo, sin red", "SinDestinatarios|Guarda primero un Correo RCA.|0", r.Codigo + "|" + r.Mensaje + "|" + he.Llamadas.Count);

        var ab = Listo(); ab.Archivos[RcaConfiguracion.Archivo] = "{\"para\":\"  " + REM + "  \",\"cc\":\"\"}";
        var hb = new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, 202, "");
        r = Enviar(Servicio(ab, hb));
        Check("V9 espacios alrededor en lo guardado: se recortan y sale sin CC", "True|True|False",
              r.Ok + "|" + hb.Llamadas.Last().Cuerpo.Contains("\"address\":\"" + REM + "\"") + "|" + hb.Llamadas.Last().Cuerpo.Contains("ccRecipients"));
    }

    // ---- D: cifrado real (DPAPI de maquina) ----------------------------------
    static void Dpapi(string exe)
    {
        var p = new ProtectorRcaDpapi();
        var secreto = "{\"refresh_token\":\"M.C507_SECRETO-de-prueba\",\"cuenta\":\"" + REM + "\"}";
        var c1 = p.Proteger(secreto);
        Check("D1 ida y vuelta", secreto, p.Desproteger(c1));
        Check("D2 el cifrado no contiene el token ni la cuenta en claro, y lleva su prefijo", "False|False|True",
              c1.Contains("SECRETO") + "|" + c1.Contains("outlook") + "|" + c1.StartsWith("dpapi-m1:"));
        Check("D3 dos cifrados del mismo texto difieren (sal aleatoria)", "True", c1 != p.Proteger(secreto));
        Check("D4 otra instancia (nada en memoria) descifra", secreto, new ProtectorRcaDpapi().Desproteger(c1));
        var b = Convert.FromBase64String(c1.Substring(9)); b[b.Length - 5] ^= 0xFF;
        Check("D5 blob alterado: falla", "lanza", Lanza(() => p.Desproteger("dpapi-m1:" + Convert.ToBase64String(b))));
        Check("D6 formato desconocido (p. ej. el de MachineKey): falla", "lanza", Lanza(() => p.Desproteger("AAAA")));

        // D7 OTRO PROCESO (como un reciclado del App Pool: proceso nuevo, sin
        // nada en memoria) descifra lo que cifro este.
        var tmp = Path.Combine(Path.GetTempPath(), "rca-dpapi-" + Guid.NewGuid().ToString("N") + ".txt");
        try
        {
            File.WriteAllText(tmp, c1);
            var psi = new System.Diagnostics.ProcessStartInfo(exe, "--descifrar \"" + tmp + "\"") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true };
            using (var pr = System.Diagnostics.Process.Start(psi))
            {
                var salida = pr.StandardOutput.ReadToEnd().Trim();
                pr.WaitForExit();
                Check("D7 un proceso nuevo descifra el archivo (sobrevive a un reciclado)", "0|" + secreto, pr.ExitCode + "|" + salida);
            }
        }
        finally { File.Delete(tmp); }

        // D8 a traves del servicio: lo que guarda la conexion se lee despues.
        var a = new AlmacenMemoria();
        var h = new HttpFalso().Cuando("/devicecode", 200, "{\"device_code\":\"DC\",\"user_code\":\"U\",\"verification_uri\":\"https://www.microsoft.com/link\",\"expires_in\":900,\"interval\":5}")
            .Cuando(TOKEN, 200, TokenOk("AT", "RT-REAL")).Cuando(ME, 200, "{\"mail\":\"" + REM + "\"}");
        ServicioRca.ReiniciarEstado();
        var s = new ServicioRca(Opciones(), a, h, new ProtectorRcaDpapi(), () => Ahora);
        s.IniciarConexion("x"); Ahora = Ahora.AddSeconds(6); s.ConsultarConexion();
        ServicioRca.ReiniciarEstado();
        string prob;
        var leida = new ServicioRca(Opciones(), a, new HttpFalso(), new ProtectorRcaDpapi(), () => Ahora).LeerCuenta(out prob);
        Check("D8 cuenta guardada con DPAPI se relee tras reiniciar el estado", "RT-REAL|False",
              (leida == null ? "null:" + prob : leida.RefreshToken) + "|" + a.Archivos[ServicioRca.ArchivoCuenta].Contains("RT-REAL"));
    }

    static string Lanza(Action a)
    {
        try { a(); return "no lanza"; } catch (Exception) { return "lanza"; }
    }

    static string Res(HttpFalso h, string enMensaje)
    {
        var r = Enviar(Servicio(Listo(), h));
        return r.Ok + "|" + r.Codigo + "|" + r.Mensaje.Contains(enMensaje);
    }

    // ---- R ------------------------------------------------------------------
    static void Repetidos()
    {
        var a = Listo();
        var h = new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, 503, "").Cuando(SEND, 202, "");
        var s = Servicio(a, h);
        var r1 = Enviar(s);
        var r2 = Enviar(s);
        Check("R1 fallo y luego reintento con exito", "False|GraphNoDisponible|True|2", r1.Ok + "|" + r1.Codigo + "|" + r2.Ok + "|" + h.Cuantas(SEND));

        var r3 = Enviar(s, titulo: "Otra prueba");
        Check("R2 dos exitos seguidos: dos correos, cada uno su asunto", "True|3|True", r3.Ok + "|" + h.Cuantas(SEND) + "|" + h.Llamadas.Last().Cuerpo.Contains("PRUEBA RCA - Otra prueba"));

        // R3 un segundo envio mientras el primero esta en vuelo (otro hilo).
        ResultadoEnvioRca segundo = null;
        h = new HttpFalso().Cuando(TOKEN, 200, TokenOk("AT", "RT-1")).Cuando(SEND, delegate (Llamada l)
        {
            var hilo = new Thread(() => { segundo = Enviar(s2Ref); });
            hilo.Start(); hilo.Join();
            return new RespuestaHttpRca { Status = 202, Cuerpo = "" };
        });
        s2Ref = Servicio(Listo(), h);
        var primero = Enviar(s2Ref);
        Check("R3 envio simultaneo: el primero sale, el segundo EnvioEnCurso, un solo sendMail", "True|EnvioEnCurso|1",
              primero.Ok + "|" + (segundo == null ? "null" : segundo.Codigo) + "|" + h.Cuantas(SEND));
        var despues = Enviar(s2Ref);
        Check("R4 al terminar, el cerrojo se libera", "True", despues.Ok);
    }
    static ServicioRca s2Ref;

    // ---- K ------------------------------------------------------------------
    static void Conexion()
    {
        var dc = "{\"device_code\":\"DC-1\",\"user_code\":\"ABCD-EFGH\",\"verification_uri\":\"https://www.microsoft.com/link\",\"expires_in\":900,\"interval\":5}";
        var a = new AlmacenMemoria();
        var h = new HttpFalso().Cuando("/devicecode", 200, dc)
            .Cuando(TOKEN, 400, "{\"error\":\"authorization_pending\"}")
            .Cuando(TOKEN, 200, TokenOk("AT-C", "RT-C"))
            .Cuando(ME, 200, "{\"mail\":null,\"userPrincipalName\":\"Remitente.RCA@outlook.com\"}");
        var s = Servicio(a, h);
        var p = s.IniciarConexion("SORIANA\\adm");
        Check("K1 inicia: codigo y URL para la pagina, sin device_code", "ABCD-EFGH|https://www.microsoft.com/link|False",
              p["codigo"] + "|" + p["url"] + "|" + new JavaScriptSerializer().Serialize(p).Contains("DC-1"));
        Check("K2 pide Mail.Send, User.Read y offline_access", "True", h.Llamadas[0].Cuerpo.Contains("offline_access") && h.Llamadas[0].Cuerpo.Contains("Mail.Send") && h.Llamadas[0].Cuerpo.Contains("User.Read"));

        var e = s.ConsultarConexion();
        Check("K3 antes del intervalo: pendiente sin llamar a Microsoft", "pendiente|0", e["estado"] + "|" + h.Cuantas(TOKEN));
        Ahora = Ahora.AddSeconds(6);
        e = s.ConsultarConexion();
        Check("K4 authorization_pending: sigue pendiente", "pendiente|1", e["estado"] + "|" + h.Cuantas(TOKEN));
        Ahora = Ahora.AddSeconds(6);
        e = s.ConsultarConexion();
        string prob;
        var c = s.LeerCuenta(out prob);
        Check("K5 exito: conectada, guarda refresh token cifrado con la cuenta y quien conecto", "conectada|RT-C|Remitente.RCA@outlook.com|SORIANA\\adm|False",
              e["estado"] + "|" + c.RefreshToken + "|" + c.Cuenta + "|" + c.ConectadoPor + "|" + a.Archivos[ServicioRca.ArchivoCuenta].Contains("RT-C"));
        var estado = s.Estado();
        var estadoJson = new JavaScriptSerializer().Serialize(estado);
        Check("K6 Estado: conectada (sin distinguir mayusculas) y SIN tokens", "True|False|False", estado["conectada"] + "|" + estadoJson.Contains("RT-C") + "|" + estadoJson.Contains("AT-C"));
        Check("K7 tras conectar ya no hay conexion pendiente", "sin-conexion", s.ConsultarConexion()["estado"]);

        // Cuenta distinta: no guarda nada.
        a = new AlmacenMemoria();
        h = new HttpFalso().Cuando("/devicecode", 200, dc).Cuando(TOKEN, 200, TokenOk("AT", "RT-X")).Cuando(ME, 200, "{\"mail\":\"personal@outlook.com\"}");
        s = Servicio(a, h);
        s.IniciarConexion("SORIANA\\adm"); Ahora = Ahora.AddSeconds(6);
        Check("K8 otra cuenta: CuentaDistinta y no se guarda", "CuentaDistinta|0", Codigo(() => s.ConsultarConexion()) + "|" + a.Archivos.Count);

        h = new HttpFalso().Cuando("/devicecode", 200, dc).Cuando(TOKEN, 400, "{\"error\":\"authorization_declined\"}");
        s = Servicio(new AlmacenMemoria(), h);
        s.IniciarConexion("x"); Ahora = Ahora.AddSeconds(6);
        Check("K9 rechazada en Microsoft: ConexionRechazada", "ConexionRechazada", Codigo(() => s.ConsultarConexion()));

        h = new HttpFalso().Cuando("/devicecode", 200, dc);
        s = Servicio(new AlmacenMemoria(), h);
        s.IniciarConexion("x"); Ahora = Ahora.AddSeconds(901);
        Check("K10 codigo vencido: CodigoExpirado sin llamar al token", "CodigoExpirado|0", Codigo(() => s.ConsultarConexion()) + "|" + h.Cuantas(TOKEN));

        h = new HttpFalso().Cuando("/devicecode", 400, "{\"error\":\"unauthorized_client\",\"error_description\":\"AADSTS70002: The client does not exist or is not enabled for consumers.\\r\\nTrace ID: x\"}");
        s = Servicio(new AlmacenMemoria(), h);
        var msgErr = "";
        try { s.IniciarConexion("x"); } catch (RcaException ex) { msgErr = ex.Codigo + "|" + ex.Message.Contains("AADSTS70002") + "|" + ex.Message.Contains("Trace ID"); }
        Check("K11 app mal registrada: OAuth con el AADSTS, sin la traza", "OAuth|True|False", msgErr);

        var op = Opciones(); op.Remitente = "";
        s = Servicio(new AlmacenMemoria(), new HttpFalso(), op);
        Check("K12 sin RcaRemitente no se puede conectar", "SinConfiguracion", Codigo(() => s.IniciarConexion("x")));

        a = Listo();
        s = Servicio(a, new HttpFalso());
        s.Desconectar();
        Check("K13 desconectar borra la cuenta y deja los destinatarios", "False|True",
              a.Archivos.ContainsKey(ServicioRca.ArchivoCuenta) + "|" + a.Archivos.ContainsKey(RcaConfiguracion.Archivo));
    }

    // ---- S: modo SMTP (RcaModo = smtp) ----------------------------------------
    const string GMAIL = "remitente.rca@gmail.com";

    static OpcionesRca OpcionesSmtp()
    {
        return new OpcionesRca { Modo = "smtp", Remitente = GMAIL, SmtpServidor = "smtp.gmail.com", SmtpPuerto = 587, SmtpSsl = true, SmtpAutenticar = true, DirDatos = "X:\\no-se-usa", MaxBytes = RcaAdjunto.MaxBytesTecnico };
    }

    static ServicioRca ServicioSmtp(AlmacenMemoria a, SmtpFalso smtp, HttpFalso h = null, OpcionesRca op = null)
    {
        ServicioRca.ReiniciarEstado();
        return new ServicioRca(op ?? OpcionesSmtp(), a, h ?? new HttpFalso(), smtp, new ProtectorFalso(), () => Ahora);
    }

    static AlmacenMemoria ListoSmtp(bool conClave = true)
    {
        var a = new AlmacenMemoria();
        RcaConfiguracion.Guardar(a, REM, REM, "SORIANA\\adm", Ahora, new Dictionary<string, string>());
        if (conClave)
        {
            ServicioSmtp(a, new SmtpFalso()).GuardarClaveSmtp("abcd efgh ijkl mnop", "SORIANA\\adm");
        }
        a.Escrituras = 0;
        return a;
    }

    static string FallaS(Exception ex, string enMensaje)
    {
        var r = Enviar(ServicioSmtp(ListoSmtp(), new SmtpFalso { Lanzar = ex }));
        return r.Ok + "|" + r.Codigo + "|" + r.Mensaje.Contains(enMensaje);
    }

    static void Smtp()
    {
        // Configuracion
        var op = OpcionesSmtp();
        Check("S1 modo SMTP completo: sin faltantes (no pide ClientId)", "", op.Faltante() ?? "");
        op.SmtpServidor = null;
        Check("S2 sin RcaSmtpServidor", "True", (op.Faltante() ?? "").Contains("RcaSmtpServidor"));
        op = OpcionesSmtp(); op.SmtpPuerto = 465;
        Check("S3 puerto 465 con SSL: no lo soporta .NET, sugiere 587", "True", (op.Faltante() ?? "").Contains("587"));
        op = OpcionesSmtp(); op.SmtpServidor = "smtp.gmail.com/x";
        Check("S4 servidor con caracteres raros", "True", (op.Faltante() ?? "").Contains("no es un nombre"));
        op = OpcionesSmtp(); op.Modo = "pop3";
        Check("S5 RcaModo desconocido", "True", (op.Faltante() ?? "").Contains("graph o smtp"));
        Check("S6 sin Modo = graph (como antes)", "False|", Opciones().EsSmtp + "|" + (Opciones().Faltante() ?? ""));

        // Contrasena
        string limpia;
        Check("S7 clave de Google con espacios: se quitan", "null|abcdefghijklmnop", (ServicioRca.ValidarClave(" abcd efgh ijkl mnop ", out limpia) ?? "null") + "|" + limpia);
        Check("S8 otra clave con espacio interno se conserva", "null|mi clave 1", (ServicioRca.ValidarClave("mi clave 1", out limpia) ?? "null") + "|" + limpia);
        Check("S9 clave vacia / con control / muy larga", "True|True|True",
              (ServicioRca.ValidarClave("  ", out limpia) != null) + "|" + (ServicioRca.ValidarClave("a\nb", out limpia) != null) + "|" + (ServicioRca.ValidarClave(new string('x', 257), out limpia) != null));

        var a = new AlmacenMemoria();
        var s = ServicioSmtp(a, new SmtpFalso());
        var est = s.Estado();
        Check("S10 Estado sin clave: modo smtp, servidor, requiere clave, no conectada", "smtp|smtp.gmail.com:587|True|False",
              est["modo"] + "|" + est["smtpServidor"] + "|" + est["requiereClave"] + "|" + est["conectada"]);
        s.GuardarClaveSmtp("abcd efgh ijkl mnop", "SORIANA\\adm");
        est = s.Estado();
        var estJson = new JavaScriptSerializer().Serialize(est);
        Check("S11 guardada: cifrada (no en claro), Estado conectada y SIN la clave", "False|True|False|SORIANA\\adm",
              a.Archivos[ServicioRca.ArchivoSmtp].Contains("abcdefgh") + "|" + est["conectada"] + "|" + estJson.Contains("abcdefgh") + "|" + est["conectadoPor"]);
        Check("S12 no toca el archivo del token de Microsoft", "False", a.Archivos.ContainsKey(ServicioRca.ArchivoCuenta));
        Check("S13 clave invalida: ClaveInvalida y no guarda", "ClaveInvalida", Codigo(() => s.GuardarClaveSmtp("", "x")));
        Check("S14 conectar con Microsoft en modo SMTP: ModoIncorrecto", "ModoIncorrecto", Codigo(() => s.IniciarConexion("x")));
        Check("S15 guardar clave en modo graph: ModoIncorrecto", "ModoIncorrecto", Codigo(() => Servicio(new AlmacenMemoria(), new HttpFalso()).GuardarClaveSmtp("abc", "x")));
        var opRel = OpcionesSmtp(); opRel.SmtpAutenticar = false;
        Check("S16 relevo sin autenticacion: no acepta clave", "ModoIncorrecto", Codigo(() => ServicioSmtp(new AlmacenMemoria(), new SmtpFalso(), op: opRel).GuardarClaveSmtp("abc", "x")));
        var af = new AlmacenMemoria { FallaEscribir = true };
        Check("S17 no poder escribir la clave: AlmacenNoDisponible", "AlmacenNoDisponible", Codigo(() => ServicioSmtp(af, new SmtpFalso()).GuardarClaveSmtp("abc", "x")));

        // Envio
        var smtp = new SmtpFalso();
        var h = new HttpFalso();
        a = ListoSmtp();
        var r = Enviar(ServicioSmtp(a, smtp, h));
        var m = smtp.Enviados.FirstOrDefault();
        Check("S18 exito: Enviado, con la clave descifrada, sin llamar a Microsoft", "True|Enviado|abcdefghijklmnop|0",
              r.Ok + "|" + r.Codigo + "|" + smtp.Claves[0] + "|" + h.Llamadas.Count);
        Check("S19 el mensaje: Para, CC, asunto y adjunto renombrado", REM + "|" + REM + "|PRUEBA RCA - Caida WMS|Prueba_RCA.pdf|application/pdf",
              m.Para + "|" + m.Cc + "|" + m.Asunto + "|" + m.Adjunto.NombreSalida + "|" + m.Adjunto.Mime);
        Check("S20 el resultado nombra el servidor y no dice Microsoft", "True|False", r.Mensaje.Contains("smtp.gmail.com") + "|" + r.Mensaje.Contains("Microsoft"));

        smtp = new SmtpFalso();
        r = Enviar(ServicioSmtp(ListoSmtp(false), smtp));
        Check("S21 sin clave guardada: SinRemitente sin intentar SMTP", "SinRemitente|0", r.Codigo + "|" + smtp.Claves.Count);

        var ajena = ListoSmtp(); ajena.Archivos[ServicioRca.ArchivoSmtp] = "OTRA-LLAVE";
        r = Enviar(ServicioSmtp(ajena, smtp));
        Check("S22 clave que no se descifra: SinRemitente con aviso, sin SMTP", "SinRemitente|True|0", r.Codigo + "|" + r.Mensaje.Contains("vuelve a guardarla") + "|" + smtp.Claves.Count);

        var opOtro = OpcionesSmtp(); opOtro.Remitente = "otra@gmail.com";
        r = Enviar(ServicioSmtp(ListoSmtp(), smtp, op: opOtro));
        Check("S23 RcaRemitente cambio tras guardar la clave: CuentaDistinta, sin SMTP", "CuentaDistinta|0", r.Codigo + "|" + smtp.Claves.Count);

        var aRel = ListoSmtp(false);
        smtp = new SmtpFalso();
        var sRel = ServicioSmtp(aRel, smtp, op: opRel);
        r = Enviar(sRel);
        Check("S24 relevo sin autenticacion: conectada sin clave y envia con clave null", "True|True|null",
              sRel.Estado()["conectada"] + "|" + r.Ok + "|" + (smtp.Claves[0] ?? "null"));

        smtp = new SmtpFalso();
        r = Enviar(ServicioSmtp(new AlmacenMemoria(), smtp));
        Check("S25 sin destinatarios: SinDestinatarios, sin SMTP", "SinDestinatarios|0", r.Codigo + "|" + smtp.Claves.Count);
        r = Enviar(ServicioSmtp(ListoSmtp(), smtp), nombre: "virus.exe", mime: "application/octet-stream", b: new byte[] { 0x4D, 0x5A });
        Check("S26 archivo invalido: AdjuntoInvalido, sin SMTP", "AdjuntoInvalido|0", r.Codigo + "|" + smtp.Claves.Count);

        // Fallos de SmtpClient
        Check("S27 535 (usuario/clave) -> SmtpAutenticacion, menciona contrasena de aplicacion", "False|SmtpAutenticacion|True",
              FallaS(new System.Net.Mail.SmtpException((System.Net.Mail.SmtpStatusCode)535, "5.7.8 Username and Password not accepted"), "contrasena de aplicacion"));
        Check("S28 530 de Gmail (falta autenticar) -> SmtpAutenticacion", "False|SmtpAutenticacion|True",
              FallaS(new System.Net.Mail.SmtpException(System.Net.Mail.SmtpStatusCode.MustIssueStartTlsFirst, "5.7.0 Authentication Required"), "No se envio"));
        Check("S29 no conecta (Web -> Socket) -> SinConexion, no se envio", "False|SinConexion|True",
              FallaS(new System.Net.Mail.SmtpException("Failure sending mail.", new WebException("Unable to connect to the remote server", new System.Net.Sockets.SocketException(10060))), "No se envio"));
        Check("S30 corte a medio envio (IO) -> ResultadoDesconocido", "False|ResultadoDesconocido|True",
              FallaS(new System.Net.Mail.SmtpException("Failure sending mail.", new IOException("reset", new System.Net.Sockets.SocketException(10054))), "PUDO"));
        Check("S31 tiempo agotado (sin codigo) -> ResultadoDesconocido", "False|ResultadoDesconocido|True",
              FallaS(new System.Net.Mail.SmtpException("The operation has timed out."), "PUDO"));
        Check("S32 TLS falla -> SmtpTls", "False|SmtpTls|True",
              FallaS(new System.Net.Mail.SmtpException("Failure sending mail.", new System.Security.Authentication.AuthenticationException("handshake")), "TLS"));
        Check("S33 destinatario rechazado -> SmtpDestinatario con la direccion", "False|SmtpDestinatario|True",
              FallaS(new System.Net.Mail.SmtpFailedRecipientException(System.Net.Mail.SmtpStatusCode.MailboxUnavailable, "<x@y.com>"), "x@y.com"));
        Check("S34 421/451 temporal -> SmtpNoDisponible", "False|SmtpNoDisponible|True",
              FallaS(new System.Net.Mail.SmtpException(System.Net.Mail.SmtpStatusCode.ServiceNotAvailable, "4.7.0 Try again later"), "espera"));
        Check("S35 552 tamano -> SmtpTamano", "False|SmtpTamano|True",
              FallaS(new System.Net.Mail.SmtpException(System.Net.Mail.SmtpStatusCode.ExceededStorageAllocation, "5.3.4 too big"), "tamano"));
        Check("S36 554 otro rechazo -> SmtpRechazo", "False|SmtpRechazo|True",
              FallaS(new System.Net.Mail.SmtpException(System.Net.Mail.SmtpStatusCode.TransactionFailed, "5.7.1 spam"), "554"));
        Check("S37 excepcion inesperada -> SmtpError y pide revisar el buzon", "False|SmtpError|True",
              FallaS(new InvalidOperationException("x"), "buzon"));

        // Repeticion y cerrojo
        smtp = new SmtpFalso { Lanzar = new System.Net.Mail.SmtpException(System.Net.Mail.SmtpStatusCode.ServiceNotAvailable, "x") };
        s = ServicioSmtp(ListoSmtp(), smtp);
        var r1 = Enviar(s);
        smtp.Lanzar = null;
        var r2 = Enviar(s);
        Check("S38 fallo y luego reintento con exito", "False|True|1", r1.Ok + "|" + r2.Ok + "|" + smtp.Enviados.Count);

        // Borrar la clave
        a = ListoSmtp();
        s = ServicioSmtp(a, new SmtpFalso());
        a.Archivos[ServicioRca.ArchivoCuenta] = "token-graph";
        s.Desconectar();
        Check("S39 borrar en modo SMTP: quita la clave, deja destinatarios y el token de Graph", "False|True|True",
              a.Archivos.ContainsKey(ServicioRca.ArchivoSmtp) + "|" + a.Archivos.ContainsKey(RcaConfiguracion.Archivo) + "|" + a.Archivos.ContainsKey(ServicioRca.ArchivoCuenta));
    }

    // ---- L: SmtpClient REAL contra un servidor SMTP local (127.0.0.1) -------
    // Sin internet: comprueba que SmtpRcaReal arma el mensaje como se espera
    // y que las excepciones REALES de SmtpClient caen en el codigo correcto.
    sealed class ServidorSmtpLocal : IDisposable
    {
        readonly System.Net.Sockets.TcpListener _l;
        readonly Thread _hilo;
        public readonly string Clave;
        public readonly string RechazarRcpt;
        public string Datos, Usuario, ClaveRecibida;
        public readonly List<string> Rcpt = new List<string>();
        public int Puerto { get { return ((IPEndPoint)_l.LocalEndpoint).Port; } }

        public ServidorSmtpLocal(string clave, string rechazarRcpt = null)
        {
            Clave = clave; RechazarRcpt = rechazarRcpt;
            _l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
            _l.Start();
            _hilo = new Thread(Atender) { IsBackground = true };
            _hilo.Start();
        }

        void Atender()
        {
            try
            {
                using (var c = _l.AcceptTcpClient())
                using (var st = c.GetStream())
                using (var rd = new StreamReader(st, Encoding.ASCII))
                using (var wr = new StreamWriter(st, Encoding.ASCII) { NewLine = "\r\n", AutoFlush = true })
                {
                    wr.WriteLine("220 local ESMTP");
                    var autenticado = false;
                    string linea;
                    while ((linea = rd.ReadLine()) != null)
                    {
                        var u = linea.ToUpperInvariant();
                        if (u.StartsWith("EHLO")) { wr.WriteLine("250-local"); wr.WriteLine("250-AUTH LOGIN"); wr.WriteLine("250 OK"); }
                        else if (u.StartsWith("AUTH LOGIN"))
                        {
                            var resto = linea.Length > 10 ? linea.Substring(10).Trim() : "";
                            if (resto.Length == 0) { wr.WriteLine("334 VXNlcm5hbWU6"); resto = rd.ReadLine(); }
                            Usuario = Encoding.UTF8.GetString(Convert.FromBase64String(resto));
                            wr.WriteLine("334 UGFzc3dvcmQ6");
                            ClaveRecibida = Encoding.UTF8.GetString(Convert.FromBase64String(rd.ReadLine()));
                            autenticado = ClaveRecibida == Clave;
                            wr.WriteLine(autenticado ? "235 2.7.0 Accepted" : "535 5.7.8 Username and Password not accepted");
                        }
                        // Como Gmail: sin autenticar no acepta remitente. (SmtpClient,
                        // tras un 535, NO lanza: sigue sin autenticar y el error real
                        // llega aqui como 530.)
                        else if (u.StartsWith("MAIL FROM")) wr.WriteLine(autenticado ? "250 OK" : "530 5.7.0 Authentication Required");
                        else if (u.StartsWith("RCPT TO"))
                        {
                            Rcpt.Add(linea);
                            wr.WriteLine(RechazarRcpt != null && linea.Contains(RechazarRcpt) ? "550 5.1.1 No such user" : "250 OK");
                        }
                        else if (u == "DATA")
                        {
                            wr.WriteLine("354 Go");
                            var sb = new StringBuilder();
                            string d;
                            while ((d = rd.ReadLine()) != null && d != ".") sb.Append(d).Append("\r\n");
                            Datos = sb.ToString();
                            wr.WriteLine("250 2.0.0 queued");
                        }
                        else if (u == "QUIT") { wr.WriteLine("221 bye"); break; }
                        else wr.WriteLine("250 OK");
                    }
                }
            }
            catch (Exception) { }
        }

        public void Esperar() { _hilo.Join(5000); }
        public void Dispose() { try { _l.Stop(); } catch (Exception) { } }
    }

    static OpcionesRca OpcionesLocal(int puerto)
    {
        var op = OpcionesSmtp();
        op.SmtpServidor = "127.0.0.1"; op.SmtpPuerto = puerto; op.SmtpSsl = false;
        return op;
    }

    static void SmtpReal()
    {
        var a = ListoSmtp();
        using (var srv = new ServidorSmtpLocal("abcdefghijklmnop"))
        {
            var s = new ServicioRca(OpcionesLocal(srv.Puerto), a, new HttpFalso(), new SmtpRcaReal(), new ProtectorFalso(), () => Ahora);
            ServicioRca.ReiniciarEstado();
            var r = Enviar(s, titulo: "Caída WMS");
            srv.Esperar();
            var datos = srv.Datos ?? "";
            Check("L1 SmtpClient real: Enviado; usuario = RcaRemitente, clave sin espacios", "True|Enviado|" + GMAIL + "|abcdefghijklmnop",
                  r.Ok + "|" + r.Codigo + "|" + srv.Usuario + "|" + srv.ClaveRecibida);
            Check("L2 Para y CC llegan como RCPT", "2|True", srv.Rcpt.Count + "|" + srv.Rcpt.All(x => x.Contains(REM)));
            Check("L3 cabeceras: From, Cc, asunto UTF-8 codificado", "True|True|True",
                  datos.Contains("From: " + GMAIL) + "|" + datos.Contains("Cc: " + REM) + "|" + (datos.Contains("Subject: =?utf-8?") || datos.Contains("Subject: =?UTF-8?")));
            Check("L4 adjunto Prueba_RCA.pdf como application/pdf en base64", "True|True|True",
                  datos.Contains("Prueba_RCA.pdf") + "|" + datos.Contains("application/pdf") + "|" + datos.Contains(Convert.ToBase64String(PDF).Substring(0, 20)));
        }

        using (var srv = new ServidorSmtpLocal("otra-clave"))
        {
            var s = new ServicioRca(OpcionesLocal(srv.Puerto), ListoSmtp(), new HttpFalso(), new SmtpRcaReal(), new ProtectorFalso(), () => Ahora);
            ServicioRca.ReiniciarEstado();
            var r = Enviar(s);
            srv.Esperar();
            Check("L5 clave rechazada (535 y luego 530 en MAIL FROM, como Gmail) -> SmtpAutenticacion, sin DATA", "False|SmtpAutenticacion|True", r.Ok + "|" + r.Codigo + "|" + (srv.Datos == null));
        }

        using (var srv = new ServidorSmtpLocal("abcdefghijklmnop", rechazarRcpt: REM))
        {
            var s = new ServicioRca(OpcionesLocal(srv.Puerto), ListoSmtp(), new HttpFalso(), new SmtpRcaReal(), new ProtectorFalso(), () => Ahora);
            ServicioRca.ReiniciarEstado();
            var r = Enviar(s);
            srv.Esperar();
            Check("L6 550 real en RCPT -> SmtpDestinatario, sin DATA", "False|SmtpDestinatario|True", r.Ok + "|" + r.Codigo + "|" + (srv.Datos == null));
        }

        // Puerto cerrado: se abre y se cierra un listener para obtener uno libre.
        var tmp = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0); tmp.Start();
        var libre = ((IPEndPoint)tmp.LocalEndpoint).Port; tmp.Stop();
        var sc = new ServicioRca(OpcionesLocal(libre), ListoSmtp(), new HttpFalso(), new SmtpRcaReal(), new ProtectorFalso(), () => Ahora);
        ServicioRca.ReiniciarEstado();
        var rc = Enviar(sc);
        Check("L7 nadie escucha (conexion rechazada real) -> SinConexion", "False|SinConexion|True", rc.Ok + "|" + rc.Codigo + "|" + rc.Mensaje.Contains("No se envio"));
    }

    // ---- H ------------------------------------------------------------------
    sealed class RolesFalsos : IFuenteRolesAdmin
    {
        public readonly Dictionary<string, string> Filas = new Dictionary<string, string>();
        public IList<string> AccesosDe(string cuenta)
        {
            string r;
            return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out r) ? new[] { r } : new string[0];
        }
    }

    static void CabeceraNavegador(HttpRequest req, string nombre, string valor)
    {
        var hdr = req.Headers;
        var t = typeof(System.Collections.Specialized.NameObjectCollectionBase);
        var f = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
        var ro = t.GetProperty("IsReadOnly", f);
        ro.SetValue(hdr, false, null);
        t.GetMethod("BaseSet", f, null, new[] { typeof(string), typeof(object) }, null)
         .Invoke(hdr, new object[] { nombre, new System.Collections.ArrayList { valor } });
        ro.SetValue(hdr, true, null);
    }

    static string Correr(string cuenta, string metodo, string query, string secFetchSite, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("admin_rca_correo.ashx", "http://localhost/handlers/admin_rca_correo.ashx", query ?? ""), new HttpResponse(sw));
        if (cuenta != null) ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        if (metodo != "GET")
            typeof(HttpRequest).GetField("_httpMethod", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).SetValue(ctx.Request, metodo);
        if (secFetchSite != null) CabeceraNavegador(ctx.Request, "Sec-Fetch-Site", secFetchSite);
        HttpContext.Current = ctx;
        new AdminRcaCorreo().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static void Handler()
    {
        var roles = new RolesFalsos();
        roles.Filas["SORIANA\\ADM1"] = "ADM";
        roles.Filas["SORIANA\\MOD1"] = "MOD";
        AccesoAdmin.FuenteRoles = roles;
        int estado;

        var cuerpo = Correr("", "GET", null, null, out estado);
        Check("H1 anonimo: 403 AccesoDenegado", "403|True", estado + "|" + cuerpo.Contains("AccesoDenegado"));
        cuerpo = Correr("SORIANA\\viewer", "GET", null, null, out estado);
        Check("H2 VIEWER (sin fila): 403 AccesoDenegado", "403|True", estado + "|" + cuerpo.Contains("AccesoDenegado"));
        cuerpo = Correr("SORIANA\\mod1", "GET", null, null, out estado);
        Check("H3 MOD: 403 RolInsuficiente", "403|True|True", estado + "|" + cuerpo.Contains("RolInsuficiente") + "|" + cuerpo.Contains("correo RCA"));
        cuerpo = Correr("SORIANA\\mod1", "POST", "accion=guardar", "same-origin", out estado);
        Check("H4 MOD no puede guardar destinatarios: 403", "403|True", estado + "|" + cuerpo.Contains("RolInsuficiente"));
        cuerpo = Correr("SORIANA\\mod1", "POST", "accion=enviar", "same-origin", out estado);
        Check("H5 MOD no puede enviar: 403", "403|True", estado + "|" + cuerpo.Contains("RolInsuficiente"));
        cuerpo = Correr("SORIANA\\mod1", "POST", "accion=smtp-clave", "same-origin", out estado);
        Check("H5b MOD no puede guardar la contrasena SMTP: 403", "403|True", estado + "|" + cuerpo.Contains("RolInsuficiente"));
        cuerpo = Correr("SORIANA\\adm1", "POST", "accion=smtp-clave", "cross-site", out estado);
        Check("H5c ADM guardar contrasena desde otro sitio: 403 OrigenNoPermitido", "403|True", estado + "|" + cuerpo.Contains("OrigenNoPermitido"));
        cuerpo = Correr("SORIANA\\adm1", "GET", null, null, out estado);
        Check("H6 ADM GET: 200, sin configurar en esta maquina, sin tokens", "200|True|True|True",
              estado + "|" + cuerpo.Contains("\"configurado\":false") + "|" + cuerpo.Contains("\"extensiones\"") + "|" + !cuerpo.Contains("refresh"));
        cuerpo = Correr("SORIANA\\adm1", "POST", "accion=guardar", "cross-site", out estado);
        Check("H7 ADM POST desde otro sitio: 403 OrigenNoPermitido", "403|True", estado + "|" + cuerpo.Contains("OrigenNoPermitido"));
        cuerpo = Correr("SORIANA\\adm1", "POST", "accion=otra", "same-origin", out estado);
        Check("H8 accion desconocida: 400", "400|True", estado + "|" + cuerpo.Contains("AccionDesconocida"));
        cuerpo = Correr("SORIANA\\adm1", "PUT", null, "same-origin", out estado);
        Check("H9 otro metodo: 500 con JSON (HttpException 405 dentro de Responder)", "True", cuerpo.Contains("\"error\""));

        var fuente = File.ReadAllText("handlers/admin_rca_correo.ashx");
        var cuerpoPR = fuente.Substring(fuente.IndexOf("ProcessRequest", StringComparison.Ordinal));
        var primera = cuerpoPR.Split('\n').Select(l => l.Trim()).First(l => l.Length > 0 && !l.StartsWith("ProcessRequest") && l != "{");
        Check("H10 el handler llama ExigirAdm antes que nada", true, primera.StartsWith("if (!AccesoAdmin.ExigirAdm("));
        var app = File.ReadAllText("App_Code/RcaCorreoPrueba.cs");
        var codigo = string.Join("\n", (fuente + "\n" + app).Split('\n').Where(l => !l.TrimStart().StartsWith("//")));
        Check("H11 sin SQL ni flujos de iniciativas/solicitudes en el codigo", "False|False|False|False|False",
              codigo.Contains("SqlConnection") + "|" + codigo.Contains("DashboardDb") + "|" + codigo.Contains("SolicitudIniciativaAlta") +
              "|" + codigo.Contains("IniciativaService") + "|" + codigo.Contains("SolicitudCambio"));
        Check("H12 el documento no se escribe a disco (sin SaveAs/WriteAllBytes)", "False|False", codigo.Contains("SaveAs(") + "|" + codigo.Contains("WriteAllBytes"));
    }
}
