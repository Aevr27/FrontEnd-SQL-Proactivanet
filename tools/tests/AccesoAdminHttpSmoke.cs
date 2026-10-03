// Prueba offline de la autorizacion de Admin A TRAVES DE LOS HANDLERS
// reales, con un HttpContext armado a mano (sin IIS y sin SQL Server). La
// identidad se pone en HttpContext.User, que es de donde la toma
// IdentidadWindows.DesdeContexto en IIS con Autenticacion de Windows.
//
// Solo se ejercitan caminos que NO tocan la base:
//   - cualquier handler con una identidad no autorizada: 403 antes de nada;
//   - capacidad autorizada sin ?categoria: 400 (paso Exigir, no llego a SQL);
//   - validar autorizada con GET: 405 (paso Exigir, no llego a SQL);
//   - admin_sesion.ashx sin ?persona: {"autorizado": ...} sin base.
//
// Compilar y correr desde la raiz del repo (los .ashx se compilan quitando
// la linea 1, como en csc-desde-git-bash):
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   (handlers admin_* sin su linea 1 -> h\*.cs)
//   csc /nologo /target:library /out:hnd.dll /r:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll h\*.cs
//   csc /nologo /out:AccesoAdminHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Web.dll ^
//       tools\tests\AccesoAdminHttpSmoke.cs
//   AccesoAdminHttpSmoke.exe
using System;
using System.IO;
using System.Security.Principal;
using System.Web;

public static class AccesoAdminHttpSmoke
{
    static int fallos = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // null = sin usuario; "" = anonimo (no autenticado).
    static HttpContext Contexto(string archivo, string query, string cuenta, StringWriter salida)
    {
        var ctx = new HttpContext(
            new HttpRequest(archivo, "http://localhost/handlers/" + archivo, query ?? ""),
            new HttpResponse(salida));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        return ctx;
    }

    static string Correr(IHttpHandler h, string archivo, string query, string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = Contexto(archivo, query, cuenta, sw);
        h.ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    public static int Main()
    {
        const string YO = @"SORIANA\t_andresvr";
        int estado;
        string cuerpo;

        // ---- Exigir directo ------------------------------------------------
        foreach (var caso in new[] { YO, @"soriana\T_ANDRESVR" })
        {
            var sw = new StringWriter();
            var ctx = Contexto("x.ashx", null, caso, sw);
            Check("E1 " + caso + ": Exigir deja pasar", true, AccesoAdmin.Exigir(ctx));
            Check("E1 " + caso + ": sin 403", 200, ctx.Response.StatusCode);
        }
        foreach (var caso in new[] { @"SORIANA\t_otro", @"OTRO\t_andresvr", "t_andresvr", "", null })
        {
            var sw = new StringWriter();
            var ctx = Contexto("x.ashx", null, caso, sw);
            var nombre = caso == null ? "(sin usuario)" : caso.Length == 0 ? "(anonimo)" : caso;
            Check("E2 " + nombre + ": Exigir rechaza", false, AccesoAdmin.Exigir(ctx));
            Check("E2 " + nombre + ": 403 AccesoDenegado", "403|True",
                  ctx.Response.StatusCode + "|" + sw.ToString().Contains("\"tipo\":\"AccesoDenegado\""));
        }

        // ---- handlers reales -------------------------------------------------
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, YO, out estado);
        Check("H1 admin_sesion: autorizado", "200|{\"autorizado\":true}", estado + "|" + cuerpo);
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, @"SORIANA\t_otro", out estado);
        Check("H1 admin_sesion: otra cuenta no", "200|{\"autorizado\":false}", estado + "|" + cuerpo);
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, "", out estado);
        Check("H1 admin_sesion: anonimo no", "200|{\"autorizado\":false}", estado + "|" + cuerpo);

        cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Check("H2 capacidad autorizada: pasa Exigir (400 por falta de categoria, sin SQL)", "400|True",
              estado + "|" + cuerpo.Contains("SolicitudInvalida"));
        cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, YO, out estado);
        Check("H3 validar autorizada: pasa Exigir (405 por GET, sin SQL)", "405|True",
              estado + "|" + cuerpo.Contains("MetodoNoPermitido"));

        IHttpHandler[] protegidos =
        {
            new AdminIniciativasCatalogos(), new AdminIniciativasCapacidad(), new AdminIniciativasValidar(),
            new AdminIniciativasRegistro(), new AdminIniciativasDiagnostico(),
        };
        foreach (var h in protegidos)
        {
            foreach (var cuenta in new[] { @"SORIANA\t_otro", "" })
            {
                cuerpo = Correr(h, "admin_iniciativas_x.ashx", "categoria=/A", cuenta, out estado);
                Check("H4 " + h.GetType().Name + " con " + (cuenta.Length == 0 ? "(anonimo)" : cuenta) + ": 403",
                      "403|True", estado + "|" + cuerpo.Contains("AccesoDenegado"));
            }
        }

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : ("FALLOS: " + fallos));
        return fallos == 0 ? 0 : 1;
    }
}
