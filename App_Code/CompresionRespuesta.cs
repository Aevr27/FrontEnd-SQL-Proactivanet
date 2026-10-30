// gzip de las respuestas JSON grandes, hecho por la aplicacion. Lo usan
// analisis.ashx (de donde sale), admin_iniciativas_registro.ashx y
// admin_iniciativas_catalogos.ashx.
//
// POR QUE AQUI Y NO EN IIS
// ------------------------
// En la VM la compresion dinamica de IIS esta apagada (lo dejo escrito
// analisis.ashx, que ya comprimia a mano) y un .ashx es contenido dinamico.
// Encenderla no es de Web.config: hay que instalar la caracteristica
// "Compresion de contenido dinamico" en el servidor, y application/json
// tiene que estar en httpCompression/dynamicTypes, seccion que IIS bloquea a
// nivel de sitio. Ademas <urlCompression doDynamicCompression="true"/>
// comprimiria TODO lo dinamico, tambien las descargas .xlsx, que ya vienen
// comprimidas. Aqui solo se comprime lo que cada handler pide.
//
// UNA SOLA CAPA
// -------------
// Si la respuesta ya trae Content-Encoding, no se toca. Y si algun dia IIS
// tiene la compresion dinamica encendida, su modulo ve el
// "Content-Encoding: gzip" que se pone aqui y no comprime otra vez
// (comportamiento de IIS que no se pudo comprobar en la VM).
//
// QUIEN NO LA PIDE
// ----------------
// Recibe el JSON tal cual. Solo se comprime si Accept-Encoding acepta gzip
// (o *) con q distinto de 0. Vary: Accept-Encoding va siempre, para que un
// proxy no le sirva la version comprimida a quien no la pidio.
//
// LONGITUD Y ERRORES
// ------------------
// Con la salida en buffer (como en estos handlers) ASP.NET pone el
// Content-Length al final, ya con el cuerpo comprimido. Se decide al final,
// con el cuerpo YA serializado: si algo truena antes, el handler escribe su
// error por su catch sin filtro puesto. Si el filtro no se puede poner (una
// respuesta sin HttpWriter, como en las pruebas sin IIS), sale sin comprimir
// y sin Content-Encoding.

using System;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Web;

public static class CompresionRespuesta
{
    // Por debajo de esto gzip no ahorra lo que cuesta.
    public const int MinimoCaracteres = 1024;

    public static void EscribirJson(HttpContext context, string cuerpo)
    {
        var r = context.Response;
        r.AppendHeader("Vary", "Accept-Encoding");
        if (cuerpo != null && cuerpo.Length >= MinimoCaracteres
            && AceptaGzip(context.Request.Headers["Accept-Encoding"])
            && !YaCodificada(r))
        {
            Stream destino;
            try { destino = r.Filter; }
            catch (HttpException) { destino = null; }
            if (destino != null)
            {
                // Fastest: con 28 MB de JSON sintetico tardo 0.17 s y dejo
                // 1/8 (medicion de analisis.ashx); Optimal dejaba la mitad de
                // eso pero tardaba el doble.
                r.Filter = new GZipStream(destino, CompressionLevel.Fastest);
                r.AppendHeader("Content-Encoding", "gzip");
            }
        }
        r.Write(cuerpo);
    }

    // Accept-Encoding: "gzip", "gzip, deflate, br", "gzip;q=0", "*;q=0.5"...
    // gzip (o x-gzip) manda sobre *; q=0 o un q ilegible es "no".
    public static bool AceptaGzip(string aceptadas)
    {
        if (string.IsNullOrEmpty(aceptadas)) return false;
        bool? gzip = null, comodin = null;
        foreach (var parte in aceptadas.Split(','))
        {
            var trozos = parte.Split(';');
            var nombre = trozos[0].Trim();
            var q = 1.0;
            for (var i = 1; i < trozos.Length; i++)
            {
                var p = trozos[i].Trim();
                if (!p.StartsWith("q=", StringComparison.OrdinalIgnoreCase)) continue;
                double v;
                q = double.TryParse(p.Substring(2).Trim(), NumberStyles.AllowDecimalPoint,
                                    CultureInfo.InvariantCulture, out v) ? v : 0;
            }
            if (nombre.Equals("gzip", StringComparison.OrdinalIgnoreCase)
                || nombre.Equals("x-gzip", StringComparison.OrdinalIgnoreCase))
                gzip = q > 0;
            else if (nombre == "*")
                comodin = q > 0;
        }
        return gzip ?? comodin ?? false;
    }

    // Response.Headers solo existe en el pipeline integrado; si no se puede
    // leer, nadie de esta aplicacion pone Content-Encoding antes.
    private static bool YaCodificada(HttpResponse r)
    {
        try { return !string.IsNullOrEmpty(r.Headers["Content-Encoding"]); }
        catch (PlatformNotSupportedException) { return false; }
    }
}
