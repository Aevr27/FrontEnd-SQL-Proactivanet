// Prueba offline de App_Code/CompresionRespuesta.cs y de la configuracion de
// cache de Web.config.ejemplo. Sin IIS ni SQL Server.
//
// Casos:
//   A  AceptaGzip: gzip / x-gzip / *, q=0, q ilegible, mayusculas, vacio;
//      gzip manda sobre *.
//   E  EscribirJson sin HttpWriter (HttpResponse sobre un TextWriter, como
//      en las pruebas HTTP): el JSON sale tal cual, sin Content-Encoding,
//      con Vary; tambien con "Accept-Encoding: gzip".
//   H  los tres handlers escriben por EscribirJson y ningun handler pone
//      Response.Filter por su cuenta (una sola capa de gzip).
//   W  Web.config.ejemplo: exceljs.min.js y xlsx.mini.min.js de analisis /
//      efectividad con max-age de 7 dias (no 365), las demas vendor siguen
//      igual, y no hay doDynamicCompression encendido.
//
// La prueba en IIS Express de verdad (cabeceras, Content-Length, gzip que
// se descomprime al mismo JSON) se hizo a mano; ver el mensaje del commit.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:Compresion.exe /r:adm.dll /r:System.dll /r:System.Web.dll /r:System.Xml.dll ^
//       tools\tests\CompresionRespuestaSmoke.cs
//   Compresion.exe
using System;
using System.Collections.Specialized;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Web;
using System.Xml;

static class CompresionRespuestaSmoke
{
    static int fallos, pasados;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static int Main()
    {
        var casos = new[]
        {
            new object[] { "gzip", true },
            new object[] { "gzip, deflate, br", true },
            new object[] { "GZIP", true },
            new object[] { "x-gzip", true },
            new object[] { "deflate, br", false },
            new object[] { "gzip;q=0", false },
            new object[] { "gzip; q=0.0, deflate", false },
            new object[] { "gzip;q=0.5", true },
            new object[] { "gzip;q=abc", false },
            new object[] { "*", true },
            new object[] { "*;q=0", false },
            new object[] { "gzip;q=0, *", false },
            new object[] { "*;q=0, gzip", true },
            new object[] { "identity", false },
            new object[] { "", false },
            new object[] { null, false },
        };
        foreach (var c in casos)
            Check("A AceptaGzip(" + (c[0] == null ? "null" : "'" + c[0] + "'") + ")", c[1], CompresionRespuesta.AceptaGzip((string)c[0]));

        var grande = "{\"x\":\"" + new string('a', 5000) + "\"}";
        foreach (var ae in new[] { null, "gzip" })
        {
            var sw = new StringWriter();
            var ctx = new HttpContext(new HttpRequest("x.ashx", "http://localhost/handlers/x.ashx", ""), new HttpResponse(sw));
            if (ae != null) Cabecera(ctx.Request, "Accept-Encoding", ae);
            CompresionRespuesta.EscribirJson(ctx, grande);
            Check("E sin HttpWriter, Accept-Encoding=" + (ae ?? "(nada)") + ": cuerpo tal cual", "True", sw.ToString() == grande);
            Check("E sin HttpWriter, Accept-Encoding=" + (ae ?? "(nada)") + ": Vary y sin Content-Encoding",
                "Accept-Encoding|", Guardada(ctx.Response, "_cacheHeaders", "Vary") + "|" + Guardada(ctx.Response, "_customHeaders", "Content-Encoding"));
        }

        foreach (var h in new[] { "analisis.ashx", "admin_iniciativas_registro.ashx", "admin_iniciativas_catalogos.ashx" })
            Check("H " + h + " escribe por CompresionRespuesta.EscribirJson", "True",
                File.ReadAllText(Path.Combine("handlers", h)).Contains("CompresionRespuesta.EscribirJson("));
        var conFiltro = "";
        foreach (var f in Directory.GetFiles("handlers", "*.ashx"))
            if (Regex.IsMatch(File.ReadAllText(f), @"Response\.Filter\s*=")) conFiltro += Path.GetFileName(f) + " ";
        Check("H ningun handler pone Response.Filter por su cuenta", "", conFiltro.Trim());

        var xml = new XmlDocument();
        xml.Load("Web.config.ejemplo");
        Check("W exceljs.min.js de analisis: 7 dias", "UseMaxAge|7.00:00:00", Cache(xml, "analisis/vendor/exceljs.min.js"));
        Check("W xlsx.mini.min.js de efectividad: 7 dias", "UseMaxAge|7.00:00:00", Cache(xml, "efectividad/vendor/xlsx.mini.min.js"));
        foreach (var p in new[] { "assets/vendor", "experiencia/vendor", "orquestacion/vendor" })
            Check("W " + p + " sin cambio (365 dias)", "UseMaxAge|365.00:00:00", Cache(xml, p));
        Check("W regla general sin cambio (DisableCache)", "DisableCache",
            ((XmlElement)xml.SelectSingleNode("/configuration/system.webServer/staticContent/clientCache")).GetAttribute("cacheControlMode"));
        Check("W sin urlCompression ni httpCompression en la plantilla", "0",
            xml.SelectNodes("//urlCompression|//httpCompression").Count);

        Console.WriteLine(pasados + " PASARON, " + fallos + " FALLARON");
        return fallos == 0 ? 0 : 1;
    }

    static string Cache(XmlDocument xml, string ruta)
    {
        var n = (XmlElement)xml.SelectSingleNode("/configuration/location[@path='" + ruta + "']/system.webServer/staticContent/clientCache");
        return n == null ? "(sin regla)" : n.GetAttribute("cacheControlMode") + "|" + n.GetAttribute("cacheControlMaxAge");
    }

    // HttpRequest sin IIS: las cabeceras son de solo lectura; se pone por
    // reflexion, como CabeceraNavegador de AccesoAdminHttpSmoke.cs.
    static void Cabecera(HttpRequest req, string nombre, string valor)
    {
        var h = req.Headers;
        var t = typeof(NameObjectCollectionBase);
        var f = BindingFlags.NonPublic | BindingFlags.Instance;
        var ro = t.GetProperty("IsReadOnly", f);
        ro.SetValue(h, false, null);
        t.GetMethod("BaseSet", f, null, new[] { typeof(string), typeof(object) }, null)
         .Invoke(h, new object[] { nombre, new System.Collections.ArrayList { valor } });
        ro.SetValue(h, true, null);
    }

    // Una cabecera entre las que AppendHeader guardo (sin pipeline integrado
    // Response.Headers no existe). ASP.NET guarda Vary en _cacheHeaders y
    // las demas en _customHeaders.
    static string Guardada(HttpResponse r, string campoLista, string nombre)
    {
        var campo = typeof(HttpResponse).GetField(campoLista, BindingFlags.NonPublic | BindingFlags.Instance);
        var lista = campo == null ? null : campo.GetValue(r) as System.Collections.ArrayList;
        if (lista == null) return "";
        var salida = "";
        foreach (var o in lista)
        {
            var t = o.GetType();
            var n = (string)t.GetProperty("Name", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(o, null);
            var v = (string)t.GetProperty("Value", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(o, null);
            if (string.Equals(n, nombre, StringComparison.OrdinalIgnoreCase)) salida += v;
        }
        return salida;
    }
}
