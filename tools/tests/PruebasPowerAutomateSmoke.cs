// Prueba de humo SIN red ni SQL del panel "Pruebas de Power Automate"
// (App_Code/PruebasPowerAutomate.cs, handlers/admin_pruebas_power_automate.ashx).
//
//   A  Aviso: cada evento con sus datos sinteticos (TEST-PA-00x, estado,
//      codigo solo al aprobar, comentario solo al rechazar); otro evento = null.
//   D  Destinatario: TeamsPruebaDestinatario valido manda; invalido = null
//      (no cae a otra fuente); CatPersona resuelta (con nombre); sin ella
//      UsuariosAdmin; fuentes que lanzan; sin cuenta = null. Nunca se arma
//      cuenta@soriana.com si CatPersona no la resuelve.
//   G  Puerta: fuera de IIS Express (este exe) TODO request recibe 404
//      SoloLocalhost y no se envia nada, tambien con Host localhost, cuenta
//      de la whitelist y cabeceras del mismo origen. Correrlo dos veces: con
//      la libreria SIN DEBUG (como la VM) y CON DEBUG y AdminDevOverride=true
//      en el .config del exe (el proceso no es iisexpress: sigue cerrado).
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /target:library /out:adm.dll /r:System.dll /r:System.Core.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /target:library /out:hnd.dll /r:adm.dll /r:System.dll /r:System.Web.dll ...
//       h\admin_pruebas_power_automate.cs        (el .ashx sin la linea 1)
//   csc /out:PruebasPowerAutomateSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\PruebasPowerAutomateSmoke.cs
//   PruebasPowerAutomateSmoke.exe
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Web;

sealed class TransporteContador : ITransporteAvisoTeams
{
    public int Llamadas;
    public int Post(Uri url, byte[] cuerpo, int timeoutMs) { Llamadas++; return 202; }
}

static class PruebasPowerAutomateSmoke
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
        Console.WriteLine("Libreria compilada en DEBUG: " + AccesoDesarrolloLocal.CompiladoEnDebug);
        Avisos();
        Destinatario();
        Puerta();
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }

    static void Avisos()
    {
        var d = new DestinatarioPrueba { Correo = "dev@soriana.com", Nombre = "Dev", Fuente = "CATPERSONA" };
        var n = PruebasPowerAutomate.Aviso("NEW_REQUEST", d);
        Check("A nueva: numero", "TEST-PA-001", n.RequestNumber);
        Check("A nueva: estado", "ENVIADA", n.Estado);
        Check("A nueva: sin codigo ni comentario", true, n.Codigo == null && n.Comentario == null);
        Check("A nueva: tipo", "Initiative", n.Tipo);
        Check("A nueva: correo y nombre del destinatario", "dev@soriana.com/Dev", n.SolicitanteEmail + "/" + n.SolicitanteNombre);
        Check("A nueva: valida para AvisoTeams", null, AvisoTeams.MotivoInvalido(n));

        var a = PruebasPowerAutomate.Aviso("REQUEST_APPROVED", d);
        Check("A aprobada: numero", "TEST-PA-002", a.RequestNumber);
        Check("A aprobada: estado", "APROBADA", a.Estado);
        Check("A aprobada: codigo ficticio", "TEST-2026-000001", a.Codigo);
        Check("A aprobada: sin comentario", true, a.Comentario == null);
        Check("A aprobada: posicion 6 del texto", "TEST-2026-000001", AvisoTeams.ComoTexto(a).Split('|')[6]);

        var r = PruebasPowerAutomate.Aviso("REQUEST_REJECTED", d);
        Check("A rechazo: numero", "TEST-PA-003", r.RequestNumber);
        Check("A rechazo: estado", "RECHAZADA", r.Estado);
        Check("A rechazo: comentario ficticio", "Esta es una prueba de rechazo desde localhost.", r.Comentario);
        Check("A rechazo: sin codigo", true, r.Codigo == null);
        Check("A rechazo: texto completo",
              "REQUEST_REJECTED|Initiative|dev@soriana.com|Dev|TEST-PA-003|RECHAZADA|Esta es una prueba de rechazo desde localhost.",
              AvisoTeams.ComoTexto(r));

        Check("A evento desconocido = null", true, PruebasPowerAutomate.Aviso("REQUEST_DELETED", d) == null);
        Check("A evento null = null", true, PruebasPowerAutomate.Aviso(null, d) == null);
    }

    static IdentidadAcuse Acuse(string estado, string correo, string nombre)
    {
        return new IdentidadAcuse { Estado = estado, Correo = correo, Nombre = nombre };
    }

    static void Destinatario()
    {
        var cuenta = IdentidadWindows.Desde(@"SORIANA\t_dev", true);
        Func<IdentidadWindows, IdentidadAcuse> resuelta = id => Acuse(IdentidadAcuse.Resuelto, "t_dev@soriana.com", "Dev Pruebas");
        Func<IdentidadWindows, IdentidadAcuse> noEncontrada = id => Acuse(IdentidadAcuse.NoEncontrado, "t_dev@soriana.com", null);
        Func<IdentidadWindows, string> admin = id => " Dev.Admin@Soriana.com ";
        Func<IdentidadWindows, string> sinAdmin = id => null;
        int llamadas = 0;
        Func<IdentidadWindows, IdentidadAcuse> contada = id => { llamadas++; return Acuse(IdentidadAcuse.Resuelto, "t_dev@soriana.com", "Dev"); };

        var c = PruebasPowerAutomate.Resolver(" Pruebas@Soriana.com ", cuenta, contada, admin);
        Check("D configurado: correo normalizado", "pruebas@soriana.com", c == null ? null : c.Correo);
        Check("D configurado: fuente", "CONFIGURACION", c == null ? null : c.Fuente);
        Check("D configurado: no consulta CatPersona", 0, llamadas);
        Check("D configurado invalido = null (no cae a otra fuente)", true,
              PruebasPowerAutomate.Resolver("no-es-correo", cuenta, resuelta, admin) == null);

        var p = PruebasPowerAutomate.Resolver(null, cuenta, resuelta, admin);
        Check("D CatPersona: correo", "t_dev@soriana.com", p == null ? null : p.Correo);
        Check("D CatPersona: nombre", "Dev Pruebas", p == null ? null : p.Nombre);
        Check("D CatPersona: fuente", "CATPERSONA", p == null ? null : p.Fuente);

        var u = PruebasPowerAutomate.Resolver("  ", cuenta, noEncontrada, admin);
        Check("D sin CatPersona: UsuariosAdmin", "dev.admin@soriana.com", u == null ? null : u.Correo);
        Check("D sin CatPersona: fuente", "USUARIOSADMIN", u == null ? null : u.Fuente);
        Check("D sin CatPersona: nombre null", true, u != null && u.Nombre == null);

        Check("D sin ninguna fuente = null (no arma cuenta@soriana.com)", true,
              PruebasPowerAutomate.Resolver(null, cuenta, noEncontrada, sinAdmin) == null);
        var l = PruebasPowerAutomate.Resolver(null, cuenta, id => { throw new InvalidOperationException("sql"); }, admin);
        Check("D CatPersona lanza: UsuariosAdmin", "dev.admin@soriana.com", l == null ? null : l.Correo);
        Check("D las dos lanzan = null", true,
              PruebasPowerAutomate.Resolver(null, cuenta, id => { throw new InvalidOperationException(); }, id => { throw new InvalidOperationException(); }) == null);
        Check("D sin cuenta = null", true, PruebasPowerAutomate.Resolver(null, null, resuelta, admin) == null);
        Check("D cuenta anonima = null", true, PruebasPowerAutomate.Resolver(null, IdentidadWindows.Desde(null, false), resuelta, admin) == null);
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

    static string Correr(string metodo, string query, string[][] campos, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("admin_pruebas_power_automate.ashx",
            "http://localhost:8081/handlers/admin_pruebas_power_automate.ashx", query), new HttpResponse(sw));
        ctx.User = new GenericPrincipal(new GenericIdentity(@"SORIANA\t_andresvr", "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        var req = ctx.Request;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, metodo);
        Cabecera(req, "Sec-Fetch-Site", "same-origin");
        Cabecera(req, "Origin", "http://localhost:8081");
        if (campos != null)
        {
            var tipoForm = typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection");
            var form = (NameValueCollection)Activator.CreateInstance(tipoForm, true);
            foreach (var c in campos) form.Add(c[0], c[1]);
            typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, form);
        }
        new AdminPruebasPowerAutomate().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static void Puerta()
    {
        // Si la puerta fallara, el envio iria a este contador y no a la red.
        var t = new TransporteContador();
        AvisoTeams.Sitio = new AvisoTeams(delegate { return "https://prueba.invalid/x?sig=SECRETO"; }, null, t, null, 1000);

        Check("G Disponible(null) = false", false, PruebasPowerAutomate.Disponible(null));
        var casos = new[]
        {
            new object[] { "GET estado", "GET", "accion=estado", null },
            new object[] { "POST enviar NEW_REQUEST", "POST", "accion=enviar", new[] { new[] { "evento", "NEW_REQUEST" } } },
            new object[] { "POST enviar REQUEST_APPROVED", "POST", "accion=enviar", new[] { new[] { "evento", "REQUEST_APPROVED" } } },
            new object[] { "POST enviar REQUEST_REJECTED", "POST", "accion=enviar", new[] { new[] { "evento", "REQUEST_REJECTED" } } },
            new object[] { "POST sin accion", "POST", "", null },
        };
        foreach (var c in casos)
        {
            int estado;
            var cuerpo = Correr((string)c[1], (string)c[2], (string[][])c[3], out estado);
            Check("G " + c[0] + ": 404", 404, estado);
            Check("G " + c[0] + ": SoloLocalhost", true, cuerpo.Contains("\"tipo\":\"SoloLocalhost\""));
            Check("G " + c[0] + ": no expone el URL", false, cuerpo.Contains("prueba.invalid") || cuerpo.Contains("SECRETO"));
        }
        Check("G ningun envio llego al transporte", 0, t.Llamadas);
    }
}
