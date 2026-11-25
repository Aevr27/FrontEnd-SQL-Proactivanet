// Prueba de humo SIN red externa de la prueba manual de avisos de Teams
// (App_Code/PruebaAvisoTeams.cs, handlers/admin_prueba_aviso_teams.ashx y la
// puerta de AdminAccesoModulo). Nunca llama al webhook real: AvisoTeams.Sitio
// se cambia por uno con transporte falso DESPUES de revisar el real.
//
//   A  los tres eventos x INICIATIVA / CAMBIO: seis posiciones en orden,
//      el dato en [5] (fecha / codigo / comentario), tipo del contrato.
//   B  vacios permitidos (NEW_REQUEST sin correo, nombre ni dato) y los que
//      no (aprobar / rechazar sin correo, sin numero).
//   C  "|" y saltos de linea en nombre / dato no corren posiciones.
//   D  combinaciones y valores invalidos: evento, tipo, correo, largos.
//   F  TeamsWebhookFormato ausente: el AvisoTeams.Sitio real dice "texto" y
//      el cuerpo es la Adaptive Card (ComoTarjeta), como en produccion.
//   S  mismo emisor: los flujos reales y el handler usan AvisoTeams.Sitio;
//      el handler no arma su propio HTTP.
//   H  handler: anonimo / VIEWER / MOD 403 sin enviar; POST de otra pagina
//      403; ADM GET estado sin URL; ADM POST envia una vez por el Sitio.
//   R  clasificacion: 2xx, no 2xx, timeout, red, sin webhook, URL invalido.
//   M  modulo: la pagina y el handler son solo ADM.
//   T  la traza no lleva URL, correo, nombre ni dato.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Core.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   (handlers\admin_prueba_aviso_teams.ashx sin su linea 1 -> h\admin_prueba_aviso_teams.cs)
//   csc /nologo /target:library /out:hnd.dll /r:adm.dll /r:System.dll /r:System.Web.dll ^
//       /r:System.Web.Extensions.dll h\admin_prueba_aviso_teams.cs
//   csc /nologo /out:PruebaAvisoTeamsSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\PruebaAvisoTeamsSmoke.cs
//   PruebaAvisoTeamsSmoke.exe
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Web;

sealed class TransportePrueba : ITransporteAvisoTeams
{
    public int Estado = 202;
    public Exception Lanza;
    public int Llamadas;
    public byte[] Cuerpo;
    public int Timeout;
    public int Post(Uri url, byte[] cuerpo, int timeoutMs)
    {
        Llamadas++; Cuerpo = cuerpo; Timeout = timeoutMs;
        if (Lanza != null) throw Lanza;
        return Estado;
    }
}

sealed class RolesPrueba : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim(), out f) ? f : new string[0];
    }
}

public static class PruebaAvisoTeamsSmoke
{
    const string UrlFalso = "https://ejemplo.invalid/flujo?sig=FIRMASECRETA0123456789abcdef";
    const string Adm = "SORIANA\\adm1";
    const string Mod = "SORIANA\\mod1";
    const string Viewer = "SORIANA\\viewer1";

    static int fallos;
    static readonly List<string> Traza = new List<string>();

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static EntradaPruebaAvisoTeams E(string evento, string tipo, string correo, string nombre, string numero, string dato)
    {
        return new EntradaPruebaAvisoTeams { Evento = evento, Tipo = tipo, Correo = correo, Nombre = nombre, Numero = numero, Dato = dato };
    }

    static AvisoSolicitud Armar(EntradaPruebaAvisoTeams e, out string codigo)
    {
        string motivo;
        return PruebaAvisoTeams.Armar(e, out codigo, out motivo);
    }

    static AvisoTeams Avisador(TransportePrueba t, string url, string formato)
    {
        return new AvisoTeams(delegate { return url; }, delegate { return formato; }, t,
            delegate (string c, Exception ex) { Traza.Add(c + ": " + ex.Message); }, AvisoTeams.TimeoutMsPorOmision);
    }

    public static int Main()
    {
        // ---- F (antes de tocar AvisoTeams.Sitio): el del sitio, sin claves en la configuracion
        Check("F Sitio real sin TeamsWebhookFormato = texto", "texto", AvisoTeams.Sitio.Formato());
        Check("F Sitio real sin TeamsWebhookUrl = no configurado", false, AvisoTeams.Sitio.Configurado());
        Check("F LeerFormato ausente = null", true, AvisoTeams.LeerFormato() == null);
        Check("F NormalizarFormato(null) = texto", "texto", AvisoTeams.NormalizarFormato(null));
        string c0;
        var real = AvisoTeams.Sitio.EnviarConDetalle(Armar(E("NEW_REQUEST", "INICIATIVA", null, null, "1", null), out c0));
        Check("F Sitio real sin URL = Desactivado, sin red", "Desactivado", real.Resultado);
        Check("F Desactivado se clasifica SinWebhook", "SinWebhook", PruebaAvisoTeams.Clasificar(real));

        // ---- S mismo emisor
        Check("S AvisoNuevaSolicitud usa AvisoTeams.Sitio", true, ReferenceEquals(AvisoNuevaSolicitud.Avisador(), AvisoTeams.Sitio));
        Check("S AvisoRevisionSolicitud usa AvisoTeams.Sitio", true, ReferenceEquals(AvisoRevisionSolicitud.Avisador(), AvisoTeams.Sitio));
        var fuente = File.ReadAllText(Path.Combine("handlers", "admin_prueba_aviso_teams.ashx"));
        Check("S handler envia con AvisoTeams.Sitio.EnviarConDetalle", true,
              fuente.Contains("var avisador = AvisoTeams.Sitio;") && fuente.Contains("avisador.EnviarConDetalle(aviso)"));
        Check("S handler no arma su propio HTTP ni otro AvisoTeams", false,
              fuente.Contains("WebRequest") || fuente.Contains("HttpClient") || fuente.Contains("TransporteAvisoTeamsHttp") || fuente.Contains("new AvisoTeams("));
        Check("S handler no fuerza formato ni lee otras claves", false,
              fuente.Contains("\"texto\"") || fuente.Contains("\"json\"") || fuente.Contains("AppSettings") || fuente.Contains("TeamsPruebaDestinatario"));
        var fuenteClase = File.ReadAllText(Path.Combine("App_Code", "PruebaAvisoTeams.cs"));
        Check("S clase no lee configuracion ni red", false,
              fuenteClase.Contains("AppSettings") || fuenteClase.Contains("WebRequest") || fuenteClase.Contains("ITransporteAvisoTeams"));

        // ---- A tres eventos x dos tipos
        var casos = new[]
        {
            new[] { "NEW_REQUEST", "INICIATIVA", "Initiative", "2026-11-25" },
            new[] { "NEW_REQUEST", "CAMBIO", "Change request", "2026-11-25" },
            new[] { "REQUEST_APPROVED", "INICIATIVA", "Initiative", "INI-2026-000123" },
            new[] { "REQUEST_APPROVED", "CAMBIO", "Change request", "INI-2026-000124" },
            new[] { "REQUEST_REJECTED", "INICIATIVA", "Initiative", "Falta justificacion" },
            new[] { "REQUEST_REJECTED", "CAMBIO", "Change request", "No procede" },
        };
        foreach (var c in casos)
        {
            string cod;
            var a = Armar(E(c[0], c[1], "ana.perez@soriana.com", "Ana Perez", "#0000142", c[3]), out cod);
            var p = a == null ? new string[0] : AvisoTeams.ComoTexto(a).Split('|');
            Check("A " + c[0] + " " + c[1] + " armado", true, a != null && cod == null);
            Check("A " + c[0] + " " + c[1] + " seis campos en orden", c[0] + "|" + c[2] + "|ana.perez@soriana.com|Ana Perez|#0000142|" + c[3],
                  string.Join("|", p));
            Check("A " + c[0] + " " + c[1] + " estado no viaja (como produccion)", true, a != null && a.Estado == null);
        }
        string ct;
        Check("A tipo del contrato tambien se acepta", "Change request", Armar(E("NEW_REQUEST", "Change request", null, null, "1", null), out ct).Tipo);

        // ---- B vacios
        string cb;
        var nuevaVacia = Armar(E("NEW_REQUEST", "INICIATIVA", "", "  ", "7", ""), out cb);
        Check("B NEW_REQUEST sin correo / nombre / dato se arma", true, nuevaVacia != null);
        Check("B posiciones vacias", "NEW_REQUEST|Initiative|||7|", AvisoTeams.ComoTexto(nuevaVacia));
        Check("B REQUEST_APPROVED sin correo = AvisoInvalido", "AvisoInvalido", Codigo(E("REQUEST_APPROVED", "INICIATIVA", "", "n", "7", "x")));
        Check("B REQUEST_REJECTED sin correo = AvisoInvalido", "AvisoInvalido", Codigo(E("REQUEST_REJECTED", "CAMBIO", null, "n", "7", "x")));
        Check("B sin numero = AvisoInvalido", "AvisoInvalido", Codigo(E("NEW_REQUEST", "INICIATIVA", null, null, " ", null)));
        Check("B aprobar sin codigo se arma (dato opcional)", null, Codigo(E("REQUEST_APPROVED", "INICIATIVA", "a@b.com", null, "7", "")));

        // ---- C "|" y saltos
        string cc;
        var raro = Armar(E("REQUEST_REJECTED", "INICIATIVA", "a@b.com", "Ana | Perez\r\nLopez", "#9", "linea 1\nlinea|2\r\n\tfin"), out cc);
        var pr = AvisoTeams.ComoTexto(raro).Split('|');
        Check("C siguen siendo seis campos", 6, pr.Length);
        Check("C nombre neutralizado", "Ana / Perez  Lopez", pr[3]);
        Check("C comentario neutralizado", "linea 1 linea/2   fin", pr[5]);
        var tarjeta = Encoding.UTF8.GetString(Encoding.UTF8.GetBytes(AvisoTeams.ComoTarjeta(raro)));
        Check("C tarjeta sin saltos crudos", false, tarjeta.Contains("\n") || tarjeta.Contains("\r"));

        // ---- D invalidos
        Check("D evento desconocido", "EventoDesconocido", Codigo(E("REQUEST_DELETED", "INICIATIVA", "a@b.com", null, "1", null)));
        Check("D evento vacio", "EventoDesconocido", Codigo(E(null, "INICIATIVA", "a@b.com", null, "1", null)));
        Check("D evento en minusculas no es del contrato", "EventoDesconocido", Codigo(E("new_request", "INICIATIVA", null, null, "1", null)));
        Check("D tipo desconocido", "TipoDesconocido", Codigo(E("NEW_REQUEST", "Iniciativa", null, null, "1", null)));
        Check("D tipo vacio", "TipoDesconocido", Codigo(E("NEW_REQUEST", "", null, null, "1", null)));
        Check("D CHANGE_REQUEST como evento", "EventoDesconocido", Codigo(E("CHANGE_REQUEST", "CAMBIO", null, null, "1", null)));
        Check("D correo sin forma", "CorreoInvalido", Codigo(E("REQUEST_APPROVED", "INICIATIVA", "no-es-correo", null, "1", null)));
        Check("D correo con marcado", "CorreoInvalido", Codigo(E("REQUEST_APPROVED", "INICIATIVA", "<a>@b.com", null, "1", null)));
        Check("D numero largo", "CampoDemasiadoLargo", Codigo(E("NEW_REQUEST", "INICIATIVA", null, null, new string('9', 51), null)));
        Check("D dato largo", "CampoDemasiadoLargo", Codigo(E("REQUEST_REJECTED", "INICIATIVA", "a@b.com", null, "1", new string('x', 2001))));
        Check("D nombre largo", "CampoDemasiadoLargo", Codigo(E("NEW_REQUEST", "INICIATIVA", null, new string('n', 201), "1", null)));
        Check("D dato en el limite se arma", null, Codigo(E("REQUEST_REJECTED", "INICIATIVA", "a@b.com", null, "1", new string('x', 2000))));

        // ---- R clasificacion (instancia con transporte falso)
        var t = new TransportePrueba();
        string cr;
        var av = Armar(E("REQUEST_APPROVED", "CAMBIO", "a@b.com", "Ana", "#57", "INI-1"), out cr);
        t.Estado = 202;
        Check("R 202 = Aceptado", "Aceptado", PruebaAvisoTeams.Clasificar(Avisador(t, UrlFalso, null).EnviarConDetalle(av)));
        Check("R timeout de produccion", AvisoTeams.TimeoutMsPorOmision, t.Timeout);
        t.Estado = 500;
        var e500 = Avisador(t, UrlFalso, null).EnviarConDetalle(av);
        Check("R 500 = HttpNoExitoso", "HttpNoExitoso", PruebaAvisoTeams.Clasificar(e500));
        Check("R 500 conserva el codigo", 500, e500.Http);
        t.Estado = 202; t.Lanza = new WebException("x", WebExceptionStatus.Timeout);
        Check("R timeout = TiempoAgotado", "TiempoAgotado", PruebaAvisoTeams.Clasificar(Avisador(t, UrlFalso, null).EnviarConDetalle(av)));
        t.Lanza = new WebException("x", WebExceptionStatus.ConnectFailure);
        Check("R conexion = FalloRed", "FalloRed", PruebaAvisoTeams.Clasificar(Avisador(t, UrlFalso, null).EnviarConDetalle(av)));
        t.Lanza = new InvalidOperationException("x");
        Check("R otra excepcion = FalloInterno", "FalloInterno", PruebaAvisoTeams.Clasificar(Avisador(t, UrlFalso, null).EnviarConDetalle(av)));
        t.Lanza = null;
        Check("R URL http = ConfiguracionInvalida", "ConfiguracionInvalida",
              PruebaAvisoTeams.Clasificar(Avisador(t, "http://ejemplo.invalid/x", null).EnviarConDetalle(av)));
        Check("R formato raro = ConfiguracionInvalida", "ConfiguracionInvalida",
              PruebaAvisoTeams.Clasificar(Avisador(t, UrlFalso, "xml").EnviarConDetalle(av)));
        Check("R URL vacio = SinWebhook", "SinWebhook", PruebaAvisoTeams.Clasificar(Avisador(t, "", null).EnviarConDetalle(av)));

        // ---- H handler (Sitio con transporte falso)
        var roles = new RolesPrueba();
        roles.Filas[Adm] = new[] { "ADM" };
        roles.Filas[Mod] = new[] { "MOD" };
        roles.Filas[Viewer] = new[] { "VIEWER" };
        AccesoAdmin.FuenteRoles = roles;
        var tSitio = new TransportePrueba();
        AvisoTeams.Sitio = Avisador(tSitio, UrlFalso, null);   // formato ausente, como la VM

        var campos = new[]
        {
            new[] { "evento", "NEW_REQUEST" }, new[] { "tipo", "CAMBIO" }, new[] { "correo", "ana.perez@soriana.com" },
            new[] { "nombre", "Ana | Perez" }, new[] { "numero", "#57" }, new[] { "dato", "2026-11-25" },
        };
        int estado; string cuerpo;
        foreach (var quien in new[] { null, "", Viewer, Mod })
        {
            cuerpo = Post(quien, campos, true, out estado);
            var nombreCaso = quien == null ? "sin usuario" : quien.Length == 0 ? "anonimo" : quien;
            Check("H POST " + nombreCaso + " = 403", 403, estado);
            Check("H POST " + nombreCaso + " no envia", 0, tSitio.Llamadas);
        }
        cuerpo = Post(Mod, campos, true, out estado);
        Check("H MOD = RolInsuficiente", true, cuerpo.Contains("RolInsuficiente"));
        cuerpo = Get(Viewer, out estado);
        Check("H GET VIEWER = 403", 403, estado);
        cuerpo = Post(Adm, campos, false, out estado);
        Check("H ADM POST de otra pagina = 403 OrigenNoPermitido", true, estado == 403 && cuerpo.Contains("OrigenNoPermitido"));
        Check("H ADM POST de otra pagina no envia", 0, tSitio.Llamadas);

        cuerpo = Get(Adm, out estado);
        Check("H ADM GET = 200", 200, estado);
        Check("H ADM GET formato texto, ausente", true,
              cuerpo.Contains("\"formato\":\"texto\"") && cuerpo.Contains("\"formato_explicito\":false") && cuerpo.Contains("\"webhook_configurado\":true"));
        Check("H GET no envia", 0, tSitio.Llamadas);

        cuerpo = Post(Adm, campos, true, out estado);
        Check("H ADM POST = 200 Aceptado", true, estado == 200 && cuerpo.Contains("\"clase\":\"Aceptado\"") && cuerpo.Contains("\"http\":202"));
        Check("H ADM POST envia una vez por AvisoTeams.Sitio", 1, tSitio.Llamadas);
        string ch;
        var esperado = AvisoTeams.ComoTarjeta(Armar(E("NEW_REQUEST", "CAMBIO", "ana.perez@soriana.com", "Ana | Perez", "#57", "2026-11-25"), out ch));
        Check("H cuerpo = ComoTarjeta de produccion", esperado, Encoding.UTF8.GetString(tSitio.Cuerpo));
        Check("H texto enviado", "NEW_REQUEST|Change request|ana.perez@soriana.com|Ana / Perez|#57|2026-11-25",
              PruebasTexto(Encoding.UTF8.GetString(tSitio.Cuerpo)));

        foreach (var r in new[] { Get(Adm, out estado), Post(Adm, campos, true, out estado) })
            Check("H respuesta sin URL ni firma", false, r.Contains("ejemplo.invalid") || r.Contains("sig=") || r.Contains("FIRMASECRETA"));

        var antes = tSitio.Llamadas;
        cuerpo = Post(Adm, new[] { new[] { "evento", "NEW_REQUEST" }, new[] { "tipo", "OTRO" }, new[] { "numero", "1" } }, true, out estado);
        Check("H tipo invalido = 400 sin enviar", true, estado == 400 && cuerpo.Contains("TipoDesconocido") && tSitio.Llamadas == antes);
        cuerpo = Post(Adm, new[] { new[] { "evento", "REQUEST_APPROVED" }, new[] { "tipo", "INICIATIVA" }, new[] { "numero", "1" } }, true, out estado);
        Check("H aprobar sin correo = 400 AvisoInvalido sin enviar", true, estado == 400 && cuerpo.Contains("AvisoInvalido") && tSitio.Llamadas == antes);

        tSitio.Lanza = new WebException("x", WebExceptionStatus.Timeout);
        cuerpo = Post(Adm, campos, true, out estado);
        Check("H timeout = 504 TiempoAgotado", true, estado == 504 && cuerpo.Contains("TiempoAgotado") && cuerpo.Contains("\"enviado\":false"));
        tSitio.Lanza = null; tSitio.Estado = 400;
        cuerpo = Post(Adm, campos, true, out estado);
        Check("H HTTP 400 = 502 HttpNoExitoso con codigo", true, estado == 502 && cuerpo.Contains("HttpNoExitoso") && cuerpo.Contains("\"http\":400"));

        // ---- M modulo
        Check("M pagina ADM pasa", true, Modulo("~/admin/prueba-aviso-teams.html", Adm, out estado));
        Check("M pagina MOD = 403", true, !Modulo("~/admin/prueba-aviso-teams.html", Mod, out estado) && estado == 403);
        Check("M pagina VIEWER = 403", true, !Modulo("~/admin/prueba-aviso-teams.html", Viewer, out estado) && estado == 403);
        Check("M pagina anonimo = 403", true, !Modulo("~/admin/prueba-aviso-teams.html", "", out estado) && estado == 403);
        Check("M pagina mayusculas = 403", true, !Modulo("~/ADMIN/Prueba-Aviso-Teams.html", Mod, out estado) && estado == 403);
        Check("M handler MOD = 403", true, !Modulo("~/handlers/admin_prueba_aviso_teams.ashx", Mod, out estado) && estado == 403);
        Check("M admin.html sigue sin puerta del modulo", true, Modulo("~/admin/admin.html", Viewer, out estado));

        // ---- T traza
        var todo = string.Join("\n", Traza);
        Check("T hay traza de los fallos", true, todo.Contains("AvisoTeams"));
        Check("T sin URL, correo, nombre ni dato", false,
              todo.Contains("ejemplo.invalid") || todo.Contains("FIRMASECRETA") || todo.Contains("soriana.com") || todo.Contains("a@b.com")
              || todo.Contains("Ana") || todo.Contains("2026-11-25") || todo.Contains("INI-1"));
        var intento = PruebaAvisoTeams.DescribirIntento("REQUEST_APPROVED", "Initiative", "HttpNoExitoso", new EnvioAvisoTeams { Http = 500 });
        Check("T intento", "Prueba manual REQUEST_APPROVED Initiative: HttpNoExitoso HTTP 500.", intento);

        Console.WriteLine(fallos == 0 ? "OK" : fallos + " FALLOS");
        return fallos == 0 ? 0 : 1;
    }

    static string Codigo(EntradaPruebaAvisoTeams e)
    {
        string c;
        Armar(e, out c);
        return c;
    }

    static string PruebasTexto(string cuerpo)
    {
        var m = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(cuerpo);
        var adj = (Dictionary<string, object>)((System.Collections.ArrayList)m["attachments"])[0];
        var tarjeta = (Dictionary<string, object>)adj["content"];
        var bloque = (Dictionary<string, object>)((System.Collections.ArrayList)tarjeta["body"])[0];
        return (string)bloque["text"];
    }

    // null = sin usuario; "" = anonimo.
    static HttpContext Contexto(string archivo, string query, string cuenta, StringWriter salida)
    {
        var ctx = new HttpContext(new HttpRequest(archivo, "http://localhost/handlers/" + archivo, query ?? ""), new HttpResponse(salida));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        return ctx;
    }

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

    static string Get(string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = Contexto("admin_prueba_aviso_teams.ashx", null, cuenta, sw);
        new AdminPruebaAvisoTeams().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static string Post(string cuenta, string[][] campos, bool mismoOrigen, out int estado)
    {
        var sw = new StringWriter();
        var ctx = Contexto("admin_prueba_aviso_teams.ashx", "accion=enviar", cuenta, sw);
        var req = ctx.Request;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, "POST");
        Cabecera(req, "Sec-Fetch-Site", mismoOrigen ? "same-origin" : "cross-site");
        var tipoForm = typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection");
        var form = (NameValueCollection)Activator.CreateInstance(tipoForm, true);
        foreach (var c in campos) form.Add(c[0], c[1]);
        typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, form);
        new AdminPruebaAvisoTeams().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static bool Modulo(string ruta, string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = Contexto("x", null, cuenta, sw);
        var r = AdminAccesoModulo.Revisar(ctx, ruta);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return r;
    }
}
