// Correo RCA de PRUEBA (admin/admin.html, seccion "Correo RCA";
// handlers/admin_rca_correo.ashx). Solo ADM.
//
// QUE ES
// ------
// Una prueba AISLADA de la entrega por correo de un documento RCA: un
// titulo de prueba y UN documento salen como
//     Asunto:  PRUEBA RCA - <Titulo de prueba>
//     Adjunto: Prueba_RCA.<extension original>
// hacia el "Correo RCA" (Para) y el "CC RCA" guardados en el servidor.
//
// QUE NO HACE (a proposito)
// -------------------------
//   - No crea iniciativas ni solicitudes, no consume consecutivos, no toca
//     SQL Server (ni lee ni escribe) ni ningun flujo de Iniciativas.
//   - No guarda el documento: se lee a memoria (byte[]), se valida, se manda
//     y se descarta. No se escribe a disco en ningun momento. (ASP.NET puede
//     bufferizar el request en su carpeta temporal; eso lo crea y lo borra
//     ASP.NET al terminar el request.)
//
// REMITENTE: Microsoft Graph + OAuth 2.0 (flujo de codigo de dispositivo)
// -------------------------------------------------------------------------
// Outlook.com ya no acepta autenticacion basica (usuario + contrasena) para
// aplicaciones de terceros: SMTP AUTH con contrasena no es una opcion. Lo
// soportado es OAuth 2.0 ("autenticacion moderna"). Se usa Graph
// (POST /me/sendMail, permiso delegado Mail.Send) y no SMTP con XOAUTH2
// porque System.Net.Mail.SmtpClient no implementa XOAUTH2 y este sitio no
// tiene paquetes NuGet (App_Code lo compila IIS).
//
//   - Web.config (appSettings, solo servidor): RcaRemitente (la cuenta que
//     envia), RcaOAuthClientId (id de la aplicacion registrada en Microsoft
//     Entra; NO es un secreto: es un cliente publico sin client secret),
//     RcaOAuthTenant (consumers para cuentas Outlook.com). Ver
//     Web.config.ejemplo.
//   - La cuenta se conecta UNA vez desde la pagina (solo ADM): el servidor
//     pide un codigo de dispositivo, quien administra entra en
//     microsoft.com/link con la cuenta remitente y escribe el codigo. El
//     servidor recibe el refresh token, comprueba que la cuenta conectada
//     sea RcaRemitente y lo guarda CIFRADO (DPAPI de Windows, ambito de maquina; ver ProtectorRcaDpapi) en
//     RcaDirDatos (por omision ~/App_Data/rca, que IIS no sirve). El token
//     nunca va al navegador ni al repositorio.
//   - Cada envio canjea el refresh token por un access token (cache en
//     memoria hasta que expira) y guarda el refresh token nuevo si Microsoft
//     lo rota.
//
// DESTINATARIOS
// -------------
// "Correo RCA" (obligatorio) y "CC RCA" (opcional), UNA direccion cada uno,
// en RcaDirDatos\destinatarios.json. Solo ADM los cambia (el handler). El
// envio usa SIEMPRE los guardados, nunca los que mande el navegador al
// enviar.
//
// Pruebas sin IIS, sin SQL y sin red: tools/tests/RcaCorreoPruebaSmoke.cs
// (HTTP, almacen y cifrado falsos).

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Hosting;
using System.Web.Script.Serialization;


// ---------------------------------------------------------------------------
// Opciones (Web.config)
// ---------------------------------------------------------------------------
public sealed class OpcionesRca
{
    public const string ClaveRemitente = "RcaRemitente";
    public const string ClaveClientId = "RcaOAuthClientId";
    public const string ClaveTenant = "RcaOAuthTenant";
    public const string ClaveDirDatos = "RcaDirDatos";
    public const string ClaveMaxBytes = "RcaMaxBytes";

    public const string TenantPorOmision = "consumers";
    public const string DirDatosPorOmision = "~/App_Data/rca";

    // Graph: Mail.Send para mandar; User.Read para comprobar QUE cuenta se
    // conecto; offline_access para tener refresh token.
    public const string Scope = "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access";

    public string Remitente;
    public string ClientId;
    public string Tenant;
    public string DirDatos;   // ruta fisica
    public int MaxBytes;

    public static OpcionesRca DesdeConfig()
    {
        var s = ConfigurationManager.AppSettings;
        var o = new OpcionesRca
        {
            Remitente = Limpio(s[ClaveRemitente]),
            ClientId = Limpio(s[ClaveClientId]),
            Tenant = Limpio(s[ClaveTenant]) ?? TenantPorOmision,
        };
        var dir = Limpio(s[ClaveDirDatos]) ?? DirDatosPorOmision;
        o.DirDatos = dir.StartsWith("~", StringComparison.Ordinal) ? HostingEnvironment.MapPath(dir) : dir;
        int max;
        o.MaxBytes = int.TryParse(Limpio(s[ClaveMaxBytes]), NumberStyles.Integer, CultureInfo.InvariantCulture, out max)
            ? RcaAdjunto.Tope(max) : RcaAdjunto.MaxBytesTecnico;
        return o;
    }

    // Lo que falta para poder conectar o enviar; null = completo.
    public string Faltante()
    {
        if (string.IsNullOrEmpty(Remitente)) return "Falta " + ClaveRemitente + " en Web.config.";
        if (!RcaCorreo.EsValido(Remitente)) return ClaveRemitente + " de Web.config no es un correo valido.";
        if (string.IsNullOrEmpty(ClientId)) return "Falta " + ClaveClientId + " en Web.config.";
        if (!Regex.IsMatch(Tenant ?? "", "^[A-Za-z0-9.-]{1,100}$")) return ClaveTenant + " de Web.config no es valido.";
        if (string.IsNullOrEmpty(DirDatos)) return "No se pudo resolver " + ClaveDirDatos + ".";
        return null;
    }

    public string UrlLogin(string ruta)
    {
        return "https://login.microsoftonline.com/" + Uri.EscapeDataString(Tenant) + "/oauth2/v2.0/" + ruta;
    }

    private static string Limpio(string v)
    {
        v = v == null ? null : v.Trim();
        return string.IsNullOrEmpty(v) ? null : v;
    }
}

// ---------------------------------------------------------------------------
// Excepcion con codigo estable (el handler la traduce a JSON + status)
// ---------------------------------------------------------------------------
public sealed class RcaException : Exception
{
    public string Codigo { get; private set; }
    public int Status { get; private set; }

    public RcaException(string codigo, int status, string mensaje, Exception interna = null)
        : base(mensaje, interna)
    {
        Codigo = codigo;
        Status = status;
    }
}

// ---------------------------------------------------------------------------
// Correo: una sola direccion
// ---------------------------------------------------------------------------
public static class RcaCorreo
{
    // La misma forma que CorreoAdmin: algo@algo.algo sin espacios ni marcado.
    // Ademas sin ; ni , (una sola direccion) y hasta 254 caracteres (RFC 5321).
    private static readonly Regex Forma = new Regex(@"^[^\s@<>""';,]+@[^\s@<>""';,]+\.[^\s@<>""';,]+$", RegexOptions.CultureInvariant);

    public static bool EsValido(string v)
    {
        return !string.IsNullOrEmpty(v) && v.Length <= 254 && Forma.IsMatch(v);
    }

    // null = valido (en `limpio`, sin espacios a los lados); si no, el motivo.
    public static string Validar(string v, bool obligatorio, out string limpio)
    {
        limpio = (v ?? "").Trim();
        if (limpio.Length == 0) { limpio = ""; return obligatorio ? "Es obligatorio." : null; }
        if (limpio.IndexOfAny(new[] { ';', ',' }) >= 0 || Regex.IsMatch(limpio, @"\s"))
            return "Solo una direccion de correo.";
        return EsValido(limpio) ? null : "No es un correo valido.";
    }
}

// ---------------------------------------------------------------------------
// Almacen de archivos del servidor (RcaDirDatos)
// ---------------------------------------------------------------------------
public interface IAlmacenRca
{
    string Leer(string nombre);                    // null si no existe
    void Escribir(string nombre, string contenido); // reemplazo atomico
    void Borrar(string nombre);
}

public sealed class AlmacenRcaArchivos : IAlmacenRca
{
    private readonly string _dir;

    public AlmacenRcaArchivos(string dir) { _dir = dir; }

    private string Ruta(string nombre)
    {
        if (string.IsNullOrEmpty(_dir)) throw new RcaException("SinConfiguracion", 500, "No hay carpeta de datos para el correo RCA.");
        return Path.Combine(_dir, nombre);
    }

    public string Leer(string nombre)
    {
        var r = Ruta(nombre);
        return File.Exists(r) ? File.ReadAllText(r, Encoding.UTF8) : null;
    }

    public void Escribir(string nombre, string contenido)
    {
        var r = Ruta(nombre);
        Directory.CreateDirectory(_dir);
        var tmp = r + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(tmp, contenido, new UTF8Encoding(false));
            if (File.Exists(r)) File.Replace(tmp, r, null);
            else File.Move(tmp, r);
        }
        finally
        {
            if (File.Exists(tmp)) File.Delete(tmp);
        }
    }

    public void Borrar(string nombre)
    {
        var r = Ruta(nombre);
        if (File.Exists(r)) File.Delete(r);
    }
}

// ---------------------------------------------------------------------------
// Destinatarios (Correo RCA / CC RCA)
// ---------------------------------------------------------------------------
public sealed class RcaDestinatarios
{
    public string Para = "";
    public string Cc = "";
    public string ModificadoPor;
    public string ModificadoEl;   // ISO 8601, hora local del servidor

    public bool Completo { get { return RcaCorreo.EsValido(Para) && (Cc.Length == 0 || RcaCorreo.EsValido(Cc)); } }
}

public static class RcaConfiguracion
{
    public const string Archivo = "destinatarios.json";

    // Sin archivo, o ilegible: vacio (la pagina pide capturarlos).
    public static RcaDestinatarios Leer(IAlmacenRca almacen)
    {
        var d = new RcaDestinatarios();
        string json;
        try { json = almacen.Leer(Archivo); }
        catch (RcaException) { throw; }
        catch (Exception ex) { throw new RcaException("AlmacenNoDisponible", 500, "No se pudo leer la configuracion del correo RCA.", ex); }
        if (string.IsNullOrWhiteSpace(json)) return d;
        try
        {
            var o = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            d.Para = Texto(o, "para");
            d.Cc = Texto(o, "cc");
            d.ModificadoPor = Texto(o, "modificadoPor");
            d.ModificadoEl = Texto(o, "modificadoEl");
        }
        catch (Exception) { return new RcaDestinatarios(); }
        return d;
    }

    // Valida y guarda. `errores` por campo (para, cc); con errores no guarda.
    public static RcaDestinatarios Guardar(IAlmacenRca almacen, string para, string cc, string usuario, DateTime ahora, Dictionary<string, string> errores)
    {
        string p, c;
        var ep = RcaCorreo.Validar(para, true, out p);
        var ec = RcaCorreo.Validar(cc, false, out c);
        if (ep != null) errores["para"] = ep;
        if (ec != null) errores["cc"] = ec;
        if (errores.Count > 0) return null;

        var d = new RcaDestinatarios
        {
            Para = p, Cc = c,
            ModificadoPor = string.IsNullOrEmpty(usuario) ? null : usuario,
            ModificadoEl = ahora.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
        };
        var json = new JavaScriptSerializer().Serialize(new Dictionary<string, object>
        {
            { "para", d.Para }, { "cc", d.Cc },
            { "modificadoPor", d.ModificadoPor }, { "modificadoEl", d.ModificadoEl },
        });
        try { almacen.Escribir(Archivo, json); }
        catch (RcaException) { throw; }
        catch (Exception ex) { throw new RcaException("AlmacenNoDisponible", 500, "No se pudo guardar la configuracion del correo RCA. Revisa el permiso de escritura de la cuenta del App Pool en la carpeta de datos.", ex); }
        return d;
    }

    private static string Texto(Dictionary<string, object> o, string k)
    {
        object v;
        return o != null && o.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture).Trim() : "";
    }
}

// ---------------------------------------------------------------------------
// Adjunto: un documento, validado por extension, tipo MIME, tamano y firma
// ---------------------------------------------------------------------------
public sealed class RcaAdjuntoValido
{
    public string Extension;     // tal como venia (grafia original)
    public string Mime;          // el que se manda, decidido por el servidor
    public byte[] Bytes;
    public string NombreSalida;  // Prueba_RCA.<ext>
}

public static class RcaAdjunto
{
    public const string NombreBase = "Prueba_RCA";

    // Graph /me/sendMail lleva el adjunto en base64 dentro de un JSON que no
    // puede pasar de 4 MB: 3 MB de archivo (4 MB en base64) es el tope real.
    public const int MaxBytesTecnico = 3 * 1024 * 1024;

    public static int Tope(int configurado)
    {
        return configurado <= 0 || configurado > MaxBytesTecnico ? MaxBytesTecnico : configurado;
    }

    private enum Firma { Pdf, Zip, Ole }

    private sealed class Tipo
    {
        public string Mime;
        public string[] Aceptados;
        public Firma Firma;
    }

    // Documentos de Office y PDF. Cada uno con su firma de archivo: la
    // extension y el tipo MIME los manda el navegador y no prueban nada.
    private static readonly Dictionary<string, Tipo> Tipos = new Dictionary<string, Tipo>(StringComparer.OrdinalIgnoreCase)
    {
        { "pdf",  new Tipo { Firma = Firma.Pdf, Mime = "application/pdf", Aceptados = new[] { "application/pdf", "application/x-pdf" } } },
        { "docx", new Tipo { Firma = Firma.Zip, Mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Aceptados = new[] { "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } } },
        { "xlsx", new Tipo { Firma = Firma.Zip, Mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Aceptados = new[] { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } } },
        { "pptx", new Tipo { Firma = Firma.Zip, Mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation", Aceptados = new[] { "application/vnd.openxmlformats-officedocument.presentationml.presentation" } } },
        { "doc",  new Tipo { Firma = Firma.Ole, Mime = "application/msword", Aceptados = new[] { "application/msword" } } },
        { "xls",  new Tipo { Firma = Firma.Ole, Mime = "application/vnd.ms-excel", Aceptados = new[] { "application/vnd.ms-excel" } } },
        { "ppt",  new Tipo { Firma = Firma.Ole, Mime = "application/vnd.ms-powerpoint", Aceptados = new[] { "application/vnd.ms-powerpoint" } } },
    };

    // Lo que algunos navegadores mandan cuando el equipo no conoce el tipo
    // (p. ej. .docx sin Office instalado). Se admite: la firma decide.
    private static readonly string[] Genericos = { "", "application/octet-stream", "application/x-zip-compressed", "application/zip" };

    public static IEnumerable<string> Extensiones { get { return Tipos.Keys; } }

    // null = valido (en `r`); si no, el motivo para quien sube el archivo.
    public static string Validar(string nombreOriginal, string contentType, byte[] bytes, int maxBytes, out RcaAdjuntoValido r)
    {
        r = null;
        if (bytes == null || string.IsNullOrEmpty(nombreOriginal)) return "Selecciona un documento.";
        if (bytes.Length == 0) return "El documento esta vacio.";
        if (bytes.Length > maxBytes) return "El documento pasa del maximo de " + Mb(maxBytes) + ".";

        var ext = NumeroSolicitud.ExtensionSegura(nombreOriginal);
        Tipo t;
        if (ext == null || !Tipos.TryGetValue(ext, out t))
            return "Tipo de documento no permitido. Permitidos: " + string.Join(", ", Tipos.Keys) + ".";

        var mime = (contentType ?? "").Split(';')[0].Trim().ToLowerInvariant();
        if (Array.IndexOf(t.Aceptados, mime) < 0 && Array.IndexOf(Genericos, mime) < 0)
            return "El tipo del archivo (" + mime + ") no corresponde a ." + ext.ToLowerInvariant() + ".";

        if (!TieneFirma(bytes, t.Firma))
            return "El contenido del archivo no corresponde a un ." + ext.ToLowerInvariant() + ".";

        r = new RcaAdjuntoValido
        {
            Extension = ext,
            Mime = t.Mime,
            Bytes = bytes,
            NombreSalida = NombreBase + "." + ext,
        };
        return null;
    }

    private static bool TieneFirma(byte[] b, Firma f)
    {
        switch (f)
        {
            case Firma.Pdf: return Empieza(b, 0x25, 0x50, 0x44, 0x46, 0x2D);                      // %PDF-
            case Firma.Zip: return Empieza(b, 0x50, 0x4B, 0x03, 0x04);                            // PK..
            case Firma.Ole: return Empieza(b, 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1);    // OLE2
        }
        return false;
    }

    private static bool Empieza(byte[] b, params int[] firma)
    {
        if (b.Length < firma.Length) return false;
        for (var i = 0; i < firma.Length; i++) if (b[i] != firma[i]) return false;
        return true;
    }

    public static string Mb(int bytes)
    {
        return (bytes / 1048576.0).ToString("0.#", CultureInfo.InvariantCulture) + " MB";
    }
}

// ---------------------------------------------------------------------------
// Mensaje
// ---------------------------------------------------------------------------
public sealed class MensajeRca
{
    public string Para;
    public string Cc;          // "" = sin copia
    public string Asunto;
    public string Cuerpo;
    public RcaAdjuntoValido Adjunto;
}

public static class RcaMensaje
{
    public const string PrefijoAsunto = "PRUEBA RCA - ";
    public const int MaxTitulo = 150;

    // null = valido (en `limpio`); si no, el motivo.
    public static string ValidarTitulo(string titulo, out string limpio)
    {
        limpio = (titulo ?? "").Trim();
        if (limpio.Length == 0) return "Escribe el titulo de prueba.";
        if (limpio.Length > MaxTitulo) return "Maximo " + MaxTitulo + " caracteres.";
        foreach (var ch in limpio) if (char.IsControl(ch)) return "El titulo no puede llevar saltos de linea ni caracteres de control.";
        return null;
    }

    public static string Asunto(string tituloLimpio) { return PrefijoAsunto + tituloLimpio; }

    public static MensajeRca Armar(RcaDestinatarios d, string tituloLimpio, RcaAdjuntoValido adjunto, string usuario, DateTime ahora)
    {
        if (d == null || !d.Completo) throw new RcaException("SinDestinatarios", 409, "Guarda primero un Correo RCA valido.");
        if (adjunto == null) throw new ArgumentNullException("adjunto");
        return new MensajeRca
        {
            Para = d.Para,
            Cc = d.Cc ?? "",
            Asunto = Asunto(tituloLimpio),
            Adjunto = adjunto,
            Cuerpo =
                "Correo de PRUEBA del envio de RCA desde el Dashboard de Proactivanet (Administracion).\r\n\r\n" +
                "Titulo de prueba: " + tituloLimpio + "\r\n" +
                "Documento adjunto: " + adjunto.NombreSalida + "\r\n" +
                "Enviado por: " + (string.IsNullOrEmpty(usuario) ? "(sin identidad)" : usuario) + "\r\n" +
                "Fecha: " + ahora.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture) + "\r\n\r\n" +
                "Es solo una prueba: no se creo ninguna iniciativa ni solicitud.",
        };
    }

    // Cuerpo de POST /me/sendMail.
    public static string JsonGraph(MensajeRca m)
    {
        var mensaje = new Dictionary<string, object>
        {
            { "subject", m.Asunto },
            { "body", new Dictionary<string, object> { { "contentType", "Text" }, { "content", m.Cuerpo } } },
            { "toRecipients", new object[] { Destinatario(m.Para) } },
            { "attachments", new object[] { new Dictionary<string, object>
                {
                    { "@odata.type", "#microsoft.graph.fileAttachment" },
                    { "name", m.Adjunto.NombreSalida },
                    { "contentType", m.Adjunto.Mime },
                    { "contentBytes", Convert.ToBase64String(m.Adjunto.Bytes) },
                } } },
        };
        if (!string.IsNullOrEmpty(m.Cc)) mensaje["ccRecipients"] = new object[] { Destinatario(m.Cc) };
        var s = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        return s.Serialize(new Dictionary<string, object> { { "message", mensaje }, { "saveToSentItems", true } });
    }

    private static object Destinatario(string correo)
    {
        return new Dictionary<string, object> { { "emailAddress", new Dictionary<string, object> { { "address", correo } } } };
    }
}

// ---------------------------------------------------------------------------
// HTTP y cifrado (interfaces para probar sin red ni ASP.NET)
// ---------------------------------------------------------------------------
public sealed class RespuestaHttpRca
{
    public int Status;
    public string Cuerpo;
}

public interface IHttpRca
{
    // Lanza WebException (sin respuesta: red, DNS, proxy, tiempo agotado).
    RespuestaHttpRca Enviar(string metodo, string url, string contentType, string cuerpo, string bearer, int timeoutMs);
}

public sealed class HttpRcaReal : IHttpRca
{
    public RespuestaHttpRca Enviar(string metodo, string url, string contentType, string cuerpo, string bearer, int timeoutMs)
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = metodo;
        req.Timeout = timeoutMs;
        req.ReadWriteTimeout = timeoutMs;
        req.Accept = "application/json";
        if (bearer != null) req.Headers[HttpRequestHeader.Authorization] = "Bearer " + bearer;
        if (cuerpo != null)
        {
            var datos = Encoding.UTF8.GetBytes(cuerpo);
            req.ContentType = contentType;
            req.ContentLength = datos.Length;
            using (var s = req.GetRequestStream()) s.Write(datos, 0, datos.Length);
        }
        HttpWebResponse resp;
        try { resp = (HttpWebResponse)req.GetResponse(); }
        catch (WebException ex)
        {
            resp = ex.Response as HttpWebResponse;
            if (resp == null) throw;
        }
        using (resp)
        using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            return new RespuestaHttpRca { Status = (int)resp.StatusCode, Cuerpo = sr.ReadToEnd() };
    }
}

public interface IProtectorRca
{
    string Proteger(string texto);
    string Desproteger(string protegido);   // lanza si no se puede
}

// Cifrado con DPAPI de Windows en ambito de MAQUINA (CryptProtectData con
// CRYPTPROTECT_LOCAL_MACHINE), llamado directo a crypt32.dll.
//
// POR QUE NO MachineKey.Protect: sin <machineKey> explicito (ni el sitio ni
// el machine.config / web.config raiz lo tienen) ASP.NET usa una llave
// autogenerada cuya persistencia depende de la identidad del App Pool y de
// "Cargar perfil de usuario": en algunas configuraciones se regenera en cada
// reciclado y el token guardado dejaria de leerse. Y ProtectedData
// (System.Security.dll) no esta entre los ensamblados con que IIS compila
// App_Code.
//
// DPAPI de maquina: la llave la custodia Windows (LSA), no esta en ningun
// archivo ni en Web.config, no depende del perfil del App Pool y sobrevive a
// reciclados, reinicios de IIS y del servidor. Queda atada a ESA maquina:
// copiar remitente.token a otro servidor no sirve (hay que volver a
// conectar). Cualquier proceso de la maquina podria descifrarlo, asi que el
// archivo se protege con los permisos NTFS de RcaDirDatos; la "entropia" de
// abajo solo evita confundirlo con otros blobs DPAPI.
public sealed class ProtectorRcaDpapi : IProtectorRca
{
    private const string Prefijo = "dpapi-m1:";
    private static readonly byte[] Entropia = Encoding.UTF8.GetBytes("Proactivanet.Dashboard.RcaCorreoPrueba.RefreshToken.v1");
    private const int CRYPTPROTECT_UI_FORBIDDEN = 0x1;
    private const int CRYPTPROTECT_LOCAL_MACHINE = 0x4;

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct DATA_BLOB { public int cbData; public IntPtr pbData; }

    [System.Runtime.InteropServices.DllImport("crypt32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern bool CryptProtectData(ref DATA_BLOB pDataIn, string szDataDescr, ref DATA_BLOB pOptionalEntropy, IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, ref DATA_BLOB pDataOut);

    [System.Runtime.InteropServices.DllImport("crypt32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern bool CryptUnprotectData(ref DATA_BLOB pDataIn, IntPtr ppszDataDescr, ref DATA_BLOB pOptionalEntropy, IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, ref DATA_BLOB pDataOut);

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);

    public string Proteger(string texto)
    {
        return Prefijo + Convert.ToBase64String(Llamar(Encoding.UTF8.GetBytes(texto), true));
    }

    public string Desproteger(string protegido)
    {
        var p = (protegido ?? "").Trim();
        if (!p.StartsWith(Prefijo, StringComparison.Ordinal)) throw new InvalidOperationException("Formato de token cifrado desconocido.");
        return Encoding.UTF8.GetString(Llamar(Convert.FromBase64String(p.Substring(Prefijo.Length)), false));
    }

    private static byte[] Llamar(byte[] datos, bool proteger)
    {
        var hDatos = System.Runtime.InteropServices.GCHandle.Alloc(datos, System.Runtime.InteropServices.GCHandleType.Pinned);
        var hEnt = System.Runtime.InteropServices.GCHandle.Alloc(Entropia, System.Runtime.InteropServices.GCHandleType.Pinned);
        var salida = new DATA_BLOB();
        try
        {
            var entrada = new DATA_BLOB { cbData = datos.Length, pbData = hDatos.AddrOfPinnedObject() };
            var ent = new DATA_BLOB { cbData = Entropia.Length, pbData = hEnt.AddrOfPinnedObject() };
            var ok = proteger
                ? CryptProtectData(ref entrada, "RcaCorreoPrueba", ref ent, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN | CRYPTPROTECT_LOCAL_MACHINE, ref salida)
                : CryptUnprotectData(ref entrada, IntPtr.Zero, ref ent, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, ref salida);
            if (!ok) throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
            var r = new byte[salida.cbData];
            System.Runtime.InteropServices.Marshal.Copy(salida.pbData, r, 0, salida.cbData);
            return r;
        }
        finally
        {
            if (salida.pbData != IntPtr.Zero) LocalFree(salida.pbData);
            hDatos.Free();
            hEnt.Free();
        }
    }
}

// ---------------------------------------------------------------------------
// Cuenta remitente: conexion (codigo de dispositivo), tokens y envio
// ---------------------------------------------------------------------------
public sealed class CuentaRca
{
    public string RefreshToken;
    public string Cuenta;          // la cuenta que se conecto (Graph /me)
    public string ConectadoPor;
    public string ConectadoEl;
}

public sealed class ResultadoEnvioRca
{
    public bool Ok;
    public string Codigo;
    public string Mensaje;
    public int Status;
}

public sealed class ServicioRca
{
    public const string ArchivoCuenta = "remitente.token";

    private readonly OpcionesRca _op;
    private readonly IAlmacenRca _almacen;
    private readonly IHttpRca _http;
    private readonly IProtectorRca _protector;
    private readonly Func<DateTime> _ahora;

    public ServicioRca(OpcionesRca op, IAlmacenRca almacen, IHttpRca http, IProtectorRca protector, Func<DateTime> ahora)
    {
        _op = op; _almacen = almacen; _http = http; _protector = protector; _ahora = ahora;
    }

    public static ServicioRca Real()
    {
        var op = OpcionesRca.DesdeConfig();
        return new ServicioRca(op, new AlmacenRcaArchivos(op.DirDatos), new HttpRcaReal(), new ProtectorRcaDpapi(), () => DateTime.Now);
    }

    public OpcionesRca Opciones { get { return _op; } }
    public IAlmacenRca Almacen { get { return _almacen; } }

    // ---- Estado compartido del proceso ------------------------------------
    // Un solo envio a la vez (en todo el sitio): un doble clic, otra pestana u
    // otro ADM reciben EnvioEnCurso en vez de mandar dos correos.
    private static readonly object CerrojoEnvio = new object();
    private static readonly object CerrojoToken = new object();
    private static string _accessToken;
    private static string _accessTokenDe;     // refresh token del que salio
    private static DateTime _accessTokenExpira;
    private static Pendiente _pendiente;      // conexion en curso (una)

    private sealed class Pendiente
    {
        public string DeviceCode;
        public string UserCode;
        public string Url;
        public DateTime Expira;
        public int Intervalo;
        public DateTime ProximaConsulta;
        public string IniciadoPor;
    }

    // Para las pruebas: vuelve al estado de un proceso nuevo.
    public static void ReiniciarEstado()
    {
        lock (CerrojoToken) { _accessToken = null; _accessTokenDe = null; _accessTokenExpira = DateTime.MinValue; _pendiente = null; }
    }

    // ---- Cuenta guardada ---------------------------------------------------
    public CuentaRca LeerCuenta(out string problema)
    {
        problema = null;
        string protegido;
        try { protegido = _almacen.Leer(ArchivoCuenta); }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("RcaCorreo.LeerCuenta", ex);
            problema = "No se pudo leer la cuenta remitente guardada.";
            return null;
        }
        if (string.IsNullOrWhiteSpace(protegido)) return null;
        try
        {
            var o = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(_protector.Desproteger(protegido));
            var c = new CuentaRca
            {
                RefreshToken = Txt(o, "refresh_token"),
                Cuenta = Txt(o, "cuenta"),
                ConectadoPor = Txt(o, "conectadoPor"),
                ConectadoEl = Txt(o, "conectadoEl"),
            };
            if (string.IsNullOrEmpty(c.RefreshToken)) { problema = "La cuenta remitente guardada esta incompleta: vuelve a conectarla."; return null; }
            return c;
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("RcaCorreo.LeerCuenta", ex);
            problema = "No se pudo descifrar la cuenta remitente guardada (se cifro en otro servidor o el archivo esta danado): vuelve a conectarla.";
            return null;
        }
    }

    private void GuardarCuenta(CuentaRca c)
    {
        var json = new JavaScriptSerializer().Serialize(new Dictionary<string, object>
        {
            { "refresh_token", c.RefreshToken }, { "cuenta", c.Cuenta },
            { "conectadoPor", c.ConectadoPor }, { "conectadoEl", c.ConectadoEl },
        });
        try { _almacen.Escribir(ArchivoCuenta, _protector.Proteger(json)); }
        catch (Exception ex)
        {
            throw new RcaException("AlmacenNoDisponible", 500, "No se pudo guardar la cuenta remitente. Revisa el permiso de escritura de la cuenta del App Pool en la carpeta de datos.", ex);
        }
    }

    public void Desconectar()
    {
        lock (CerrojoToken)
        {
            _almacen.Borrar(ArchivoCuenta);
            _accessToken = null; _accessTokenDe = null; _pendiente = null;
        }
    }

    // ---- Estado para la pagina (nunca tokens) ------------------------------
    public Dictionary<string, object> Estado()
    {
        var falta = _op.Faltante();
        string problema = null;
        var c = falta == null ? LeerCuenta(out problema) : null;
        var conectada = c != null && string.Equals(c.Cuenta, _op.Remitente, StringComparison.OrdinalIgnoreCase);
        if (c != null && !conectada)
            problema = "La cuenta conectada (" + c.Cuenta + ") no es la de " + OpcionesRca.ClaveRemitente + ": vuelve a conectarla.";
        Pendiente p;
        lock (CerrojoToken) p = _pendiente != null && _pendiente.Expira > _ahora() ? _pendiente : null;
        return new Dictionary<string, object>
        {
            { "remitente", _op.Remitente },
            { "configurado", falta == null },
            { "problemaConfig", falta },
            { "conectada", conectada },
            { "problemaCuenta", problema },
            { "conectadoPor", conectada ? c.ConectadoPor : null },
            { "conectadoEl", conectada ? c.ConectadoEl : null },
            { "conexionPendiente", p == null ? null : PendienteJson(p) },
        };
    }

    private static Dictionary<string, object> PendienteJson(Pendiente p)
    {
        return new Dictionary<string, object>
        {
            { "codigo", p.UserCode }, { "url", p.Url },
            { "expira", p.Expira.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) },
            { "intervalo", p.Intervalo },
        };
    }

    // ---- Conexion: codigo de dispositivo -----------------------------------
    public Dictionary<string, object> IniciarConexion(string usuario)
    {
        ExigirConfig();
        var r = Llamar("POST", _op.UrlLogin("devicecode"), null, Form("client_id", _op.ClientId, "scope", OpcionesRca.Scope), null, 30000, "conectar");
        var o = Json(r.Cuerpo);
        if (r.Status != 200 || string.IsNullOrEmpty(Txt(o, "device_code")))
            throw ErrorOAuth(o, "No se pudo iniciar la conexion con Microsoft");
        int expira, intervalo;
        int.TryParse(Txt(o, "expires_in"), out expira);
        int.TryParse(Txt(o, "interval"), out intervalo);
        var p = new Pendiente
        {
            DeviceCode = Txt(o, "device_code"),
            UserCode = Txt(o, "user_code"),
            Url = Txt(o, "verification_uri"),
            Expira = _ahora().AddSeconds(expira > 0 ? expira : 900),
            Intervalo = intervalo > 0 ? intervalo : 5,
            IniciadoPor = usuario,
        };
        p.ProximaConsulta = _ahora().AddSeconds(p.Intervalo);
        lock (CerrojoToken) _pendiente = p;
        return PendienteJson(p);
    }

    // Una consulta (la pagina la repite cada `intervalo` s). estado:
    // pendiente | conectada | sin-conexion; con error lanza RcaException.
    public Dictionary<string, object> ConsultarConexion()
    {
        ExigirConfig();
        Pendiente p;
        lock (CerrojoToken) p = _pendiente;
        if (p == null) return Estado1("sin-conexion", null);
        if (p.Expira <= _ahora())
        {
            lock (CerrojoToken) if (_pendiente == p) _pendiente = null;
            throw new RcaException("CodigoExpirado", 409, "El codigo expiro sin que se completara el inicio de sesion. Vuelve a conectar.");
        }
        if (_ahora() < p.ProximaConsulta) return Estado1("pendiente", PendienteJson(p));

        var r = Llamar("POST", _op.UrlLogin("token"), null, Form(
            "grant_type", "urn:ietf:params:oauth:grant-type:device_code",
            "client_id", _op.ClientId, "device_code", p.DeviceCode), null, 30000, "conectar");
        var o = Json(r.Cuerpo);
        if (r.Status != 200)
        {
            var err = Txt(o, "error");
            if (err == "authorization_pending" || err == "slow_down")
            {
                if (err == "slow_down") p.Intervalo += 5;
                p.ProximaConsulta = _ahora().AddSeconds(p.Intervalo);
                return Estado1("pendiente", PendienteJson(p));
            }
            lock (CerrojoToken) if (_pendiente == p) _pendiente = null;
            if (err == "authorization_declined") throw new RcaException("ConexionRechazada", 409, "Se rechazo el permiso en la pagina de Microsoft. Vuelve a conectar.");
            if (err == "expired_token") throw new RcaException("CodigoExpirado", 409, "El codigo expiro. Vuelve a conectar.");
            throw ErrorOAuth(o, "Microsoft rechazo la conexion");
        }

        var access = Txt(o, "access_token");
        var refresh = Txt(o, "refresh_token");
        if (string.IsNullOrEmpty(access) || string.IsNullOrEmpty(refresh))
        {
            lock (CerrojoToken) if (_pendiente == p) _pendiente = null;
            throw new RcaException("SinRefreshToken", 502, "Microsoft no devolvio un refresh token (falta el permiso offline_access en la aplicacion registrada).");
        }

        // QUE cuenta se conecto: tiene que ser la de RcaRemitente.
        var cuenta = CuentaDe(access);
        lock (CerrojoToken) if (_pendiente == p) _pendiente = null;
        if (!string.Equals(cuenta, _op.Remitente, StringComparison.OrdinalIgnoreCase))
            throw new RcaException("CuentaDistinta", 409, "Se inicio sesion con " + (cuenta ?? "otra cuenta") + ", pero el remitente configurado es " + _op.Remitente + ". No se guardo nada: vuelve a conectar con la cuenta correcta.");

        GuardarCuenta(new CuentaRca
        {
            RefreshToken = refresh, Cuenta = cuenta,
            ConectadoPor = p.IniciadoPor,
            ConectadoEl = _ahora().ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
        });
        GuardarAccess(access, refresh, Txt(o, "expires_in"));
        return Estado1("conectada", null);
    }

    private static Dictionary<string, object> Estado1(string estado, object pendiente)
    {
        return new Dictionary<string, object> { { "estado", estado }, { "conexionPendiente", pendiente } };
    }

    private string CuentaDe(string access)
    {
        var r = Llamar("GET", "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", null, null, access, 30000, "conectar");
        if (r.Status != 200) throw new RcaException("GraphNoDisponible", 502, "No se pudo comprobar la cuenta conectada (Graph respondio " + r.Status + ").");
        var o = Json(r.Cuerpo);
        var mail = Txt(o, "mail");
        return string.IsNullOrEmpty(mail) ? Txt(o, "userPrincipalName") : mail;
    }

    // ---- Access token -----------------------------------------------------
    private string AccessToken(CuentaRca c, bool forzar)
    {
        lock (CerrojoToken)
        {
            if (!forzar && _accessToken != null && _accessTokenDe == c.RefreshToken && _accessTokenExpira > _ahora().AddMinutes(2))
                return _accessToken;
        }
        var r = Llamar("POST", _op.UrlLogin("token"), null, Form(
            "grant_type", "refresh_token", "client_id", _op.ClientId,
            "refresh_token", c.RefreshToken, "scope", OpcionesRca.Scope), null, 30000, "token");
        var o = Json(r.Cuerpo);
        if (r.Status != 200 || string.IsNullOrEmpty(Txt(o, "access_token")))
        {
            if (Txt(o, "error") == "invalid_grant")
                throw new RcaException("ReconectarRemitente", 409, "Microsoft ya no acepta la conexion guardada de la cuenta remitente (expiro, se revoco o cambio la contrasena). Vuelve a conectar la cuenta.");
            throw ErrorOAuth(o, "No se pudo obtener el permiso de envio");
        }
        var nuevo = Txt(o, "refresh_token");
        if (!string.IsNullOrEmpty(nuevo) && nuevo != c.RefreshToken)
        {
            // Microsoft rota el refresh token: se guarda el nuevo. Si no se
            // pudiera guardar, el viejo sigue sirviendo hasta que expire.
            c.RefreshToken = nuevo;
            try { GuardarCuenta(c); } catch (RcaException ex) { DashboardHandler.Registrar("RcaCorreo.Rotar", ex); }
        }
        return GuardarAccess(Txt(o, "access_token"), c.RefreshToken, Txt(o, "expires_in"));
    }

    private string GuardarAccess(string access, string deRefresh, string expiraEn)
    {
        int s;
        if (!int.TryParse(expiraEn, out s) || s <= 0) s = 3600;
        lock (CerrojoToken) { _accessToken = access; _accessTokenDe = deRefresh; _accessTokenExpira = _ahora().AddSeconds(s); }
        return access;
    }

    // ---- Envio de prueba ----------------------------------------------------
    // Valida todo ANTES de tocar la red; un solo envio a la vez.
    public ResultadoEnvioRca EnviarPrueba(string titulo, string nombreArchivo, string contentType, byte[] bytes, string usuario)
    {
        if (!System.Threading.Monitor.TryEnter(CerrojoEnvio))
            return Falla("EnvioEnCurso", 409, "Ya hay un correo RCA de prueba enviandose. Espera el resultado antes de volver a intentar.");
        try
        {
            string tituloLimpio;
            var et = RcaMensaje.ValidarTitulo(titulo, out tituloLimpio);
            if (et != null) return Falla("TituloInvalido", 400, et);
            RcaAdjuntoValido adjunto;
            var ea = RcaAdjunto.Validar(nombreArchivo, contentType, bytes, _op.MaxBytes, out adjunto);
            if (ea != null) return Falla("AdjuntoInvalido", 400, ea);

            var falta = _op.Faltante();
            if (falta != null) return Falla("SinConfiguracion", 503, "El remitente no esta configurado: " + falta);
            var d = RcaConfiguracion.Leer(_almacen);
            // Lo guardado se vuelve a validar AQUI, con la misma regla que al
            // guardar (una sola direccion, forma valida, <= 254): el archivo
            // pudo editarse a mano o danarse. Nada sale si no pasa.
            string paraOk, ccOk;
            var ePara = RcaCorreo.Validar(d.Para, true, out paraOk);
            if (ePara != null)
                return Falla("SinDestinatarios", 409, d.Para.Length == 0 ? "Guarda primero un Correo RCA." : "El Correo RCA guardado no es valido (" + ePara + "). Corrigelo y guardalo de nuevo.");
            var eCc = RcaCorreo.Validar(d.Cc, false, out ccOk);
            if (eCc != null)
                return Falla("SinDestinatarios", 409, "El CC RCA guardado no es valido (" + eCc + "). Corrigelo y guardalo de nuevo.");
            d.Para = paraOk;
            d.Cc = ccOk;

            string problema;
            var c = LeerCuenta(out problema);
            if (c == null) return Falla("SinRemitente", 409, problema ?? "Conecta primero la cuenta remitente.");
            if (!string.Equals(c.Cuenta, _op.Remitente, StringComparison.OrdinalIgnoreCase))
                return Falla("CuentaDistinta", 409, "La cuenta conectada (" + c.Cuenta + ") no es la de " + OpcionesRca.ClaveRemitente + ": vuelve a conectarla.");

            var m = RcaMensaje.Armar(d, tituloLimpio, adjunto, usuario, _ahora());
            var json = RcaMensaje.JsonGraph(m);

            var r = Llamar("POST", "https://graph.microsoft.com/v1.0/me/sendMail", "application/json", json, AccessToken(c, false), 90000, "enviar");
            if (r.Status == 401)
                r = Llamar("POST", "https://graph.microsoft.com/v1.0/me/sendMail", "application/json", json, AccessToken(c, true), 90000, "enviar");
            if (r.Status == 202 || r.Status == 200)
                return new ResultadoEnvioRca { Ok = true, Codigo = "Enviado", Status = 200,
                    Mensaje = "Microsoft acepto el correo \"" + m.Asunto + "\" para " + m.Para + (m.Cc.Length > 0 ? " (CC " + m.Cc + ")" : "") + " con " + adjunto.NombreSalida + ". Revisa el buzon." };
            return FallaGraph(r);
        }
        catch (RcaException ex)
        {
            return Falla(ex.Codigo, ex.Status, ex.Message);
        }
        finally
        {
            System.Threading.Monitor.Exit(CerrojoEnvio);
        }
    }

    private static ResultadoEnvioRca FallaGraph(RespuestaHttpRca r)
    {
        var o = Json(r.Cuerpo);
        var err = o != null && o.ContainsKey("error") ? o["error"] as Dictionary<string, object> : null;
        var codigo = Txt(err, "code");
        var detalle = codigo.Length > 0 ? " (" + codigo + ")" : "";
        switch (r.Status)
        {
            case 400: return Falla("GraphRechazo", 502, "Microsoft rechazo el mensaje" + detalle + ". No se envio.");
            case 401:
            case 403: return Falla("GraphSinPermiso", 502, "La cuenta remitente no tiene permiso para enviar" + detalle + ". Revisa el permiso Mail.Send de la aplicacion y vuelve a conectar la cuenta.");
            case 413: return Falla("GraphTamano", 502, "Microsoft rechazo el tamano del mensaje. No se envio.");
            case 429: return Falla("GraphLimite", 503, "Microsoft limito los envios de la cuenta" + detalle + ". Espera unos minutos y vuelve a intentar.");
        }
        if (r.Status >= 500) return Falla("GraphNoDisponible", 503, "El servicio de Microsoft no esta disponible (" + r.Status + "). No se envio; vuelve a intentar mas tarde.");
        return Falla("GraphRechazo", 502, "Microsoft respondio " + r.Status + detalle + ". No se envio.");
    }

    private static ResultadoEnvioRca Falla(string codigo, int status, string mensaje)
    {
        return new ResultadoEnvioRca { Ok = false, Codigo = codigo, Status = status, Mensaje = mensaje };
    }

    // ---- Utilidades --------------------------------------------------------
    private void ExigirConfig()
    {
        var falta = _op.Faltante();
        if (falta != null) throw new RcaException("SinConfiguracion", 503, "El remitente no esta configurado: " + falta);
    }

    // `paso`: conectar | token | enviar. Sin respuesta en "enviar" el
    // resultado es DESCONOCIDO (el correo pudo salir): se dice asi para que
    // nadie reintente a ciegas.
    private RespuestaHttpRca Llamar(string metodo, string url, string contentType, string cuerpo, string bearer, int timeoutMs, string paso)
    {
        try
        {
            if (contentType == null && cuerpo != null && metodo == "POST") contentType = "application/x-www-form-urlencoded";
            return _http.Enviar(metodo, url, contentType, cuerpo, bearer, timeoutMs);
        }
        catch (WebException ex)
        {
            DashboardHandler.Registrar("RcaCorreo.Http", ex);
            if (paso == "enviar" && ex.Status == WebExceptionStatus.Timeout)
                throw new RcaException("ResultadoDesconocido", 504, "Microsoft no respondio a tiempo. El correo PUDO haberse enviado: revisa el buzon antes de volver a intentar.", ex);
            throw new RcaException("SinConexion", 503, "El servidor no pudo conectarse con Microsoft (" + ex.Status + "). Revisa la salida a internet o el proxy del servidor hacia login.microsoftonline.com y graph.microsoft.com.", ex);
        }
    }

    private static RcaException ErrorOAuth(Dictionary<string, object> o, string que)
    {
        var err = Txt(o, "error");
        // error_description puede ser largo; el codigo AADSTS va al principio.
        var desc = Txt(o, "error_description");
        var corte = desc.IndexOfAny(new[] { '\r', '\n' });
        if (corte > 0) desc = desc.Substring(0, corte);
        if (desc.Length > 300) desc = desc.Substring(0, 300);
        return new RcaException("OAuth", 502, que + (err.Length > 0 ? " (" + err + (desc.Length > 0 ? ": " + desc : "") + ")" : "") + ".");
    }

    private static string Form(params string[] pares)
    {
        var sb = new StringBuilder();
        for (var i = 0; i + 1 < pares.Length; i += 2)
        {
            if (sb.Length > 0) sb.Append('&');
            sb.Append(Uri.EscapeDataString(pares[i])).Append('=').Append(Uri.EscapeDataString(pares[i + 1] ?? ""));
        }
        return sb.ToString();
    }

    private static Dictionary<string, object> Json(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return new Dictionary<string, object>();
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s) ?? new Dictionary<string, object>(); }
        catch (Exception) { return new Dictionary<string, object>(); }
    }

    private static string Txt(Dictionary<string, object> o, string k)
    {
        object v;
        return o != null && o.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
    }
}
