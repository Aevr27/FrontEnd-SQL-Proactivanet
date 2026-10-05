// Prueba offline de la autorizacion de Admin A TRAVES DE LOS HANDLERS
// reales, con un HttpContext armado a mano (sin IIS y sin SQL Server). La
// identidad se pone en HttpContext.User, que es de donde la toma
// IdentidadWindows.DesdeContexto en IIS con Autenticacion de Windows.
//
// Solo se ejercitan caminos que NO tocan la base de datos real; el rol
// (dbo.UsuariosAdmin) sale de una fuente falsa (AccesoAdmin.FuenteRoles):
//   - cualquier handler con una identidad no autorizada: 403 antes de nada;
//   - capacidad ADM sin ?categoria: 400 (paso ExigirAdm, no llego a SQL);
//   - validar ADM con GET: 405 (paso ExigirAdm, no llego a SQL);
//   - capacidad/validar con MOD, sin fila o con la fuente fallando: 403
//     RolInsuficiente; registro/catalogos con MOD: NO 403 (pasan al SQL);
//   - fuera de la whitelist, aunque la tabla diga ADM: 403 AccesoDenegado
//     sin consultar la tabla;
//   - el atajo de desarrollo local (AccesoDesarrolloLocal) solo con DEBUG +
//     request local + IIS Express; aqui nunca se activa;
//   - admin_sesion.ashx sin ?persona: {"autorizado", "rol"}.
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
using System.Collections.Generic;
using System.IO;
using System.Security.Principal;
using System.Web;

// dbo.UsuariosAdmin de mentira: cuenta (sin espacios, mayusculas) -> filas.
sealed class FuenteFalsa : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public bool Falla;
    public readonly List<string> Pedidas = new List<string>();

    public FuenteFalsa Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }

    public IList<string> AccesosDe(string cuenta)
    {
        Pedidas.Add(cuenta);
        if (Falla) throw new InvalidOperationException("sin SQL");
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

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
        // Por omision YO es ADM (como en la tabla real).
        var fuente = new FuenteFalsa().Con(YO, "ADM");
        AccesoAdmin.FuenteRoles = fuente;

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
        Check("H1 admin_sesion: autorizado, con su rol", "200|{\"autorizado\":true,\"rol\":\"ADM\"}", estado + "|" + cuerpo);
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, @"SORIANA\t_otro", out estado);
        Check("H1 admin_sesion: otra cuenta no", "200|{\"autorizado\":false}", estado + "|" + cuerpo);
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, "", out estado);
        Check("H1 admin_sesion: anonimo no", "200|{\"autorizado\":false}", estado + "|" + cuerpo);

        cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Check("H2 capacidad ADM: pasa ExigirAdm (400 por falta de categoria, sin SQL)", "400|True",
              estado + "|" + cuerpo.Contains("SolicitudInvalida"));
        cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, YO, out estado);
        Check("H3 validar ADM: pasa ExigirAdm (405 por GET, sin SQL)", "405|True",
              estado + "|" + cuerpo.Contains("MetodoNoPermitido"));

        // ---- R) rol (dbo.UsuariosAdmin) despues de la whitelist -------------
        IHttpHandler[] soloAdm = { new AdminIniciativasCapacidad(), new AdminIniciativasValidar() };
        IHttpHandler[] paraMod = { new AdminIniciativasRegistro(), new AdminIniciativasCatalogos() };
        var casosNoAdm = new[]
        {
            new { nombre = "MOD", f = new FuenteFalsa().Con(YO, "MOD") },
            new { nombre = "sin fila en UsuariosAdmin", f = new FuenteFalsa() },
            new { nombre = "consulta que falla", f = new FuenteFalsa { Falla = true } },
            new { nombre = "duplicado ADM + MOD", f = new FuenteFalsa().Con(YO, "ADM", "MOD") },
            new { nombre = "valor raro", f = new FuenteFalsa().Con(YO, "ROOT") },
            new { nombre = "Acceso NULL", f = new FuenteFalsa().Con(YO, new string[] { null }) },
        };
        foreach (var c in casosNoAdm)
        {
            AccesoAdmin.FuenteRoles = c.f;
            foreach (var h in soloAdm)
            {
                cuerpo = Correr(h, "admin_iniciativas_x.ashx", null, YO, out estado);
                Check("R1 " + c.nombre + ": " + h.GetType().Name + " 403 RolInsuficiente", "403|True",
                      estado + "|" + cuerpo.Contains("\"tipo\":\"RolInsuficiente\""));
            }
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": admin_sesion entra como MOD", "{\"autorizado\":true,\"rol\":\"MOD\"}", cuerpo);
        }

        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "MOD");
        foreach (var h in paraMod)
        {
            try { cuerpo = Correr(h, "admin_iniciativas_x.ashx", null, YO, out estado); }
            catch (Exception) { cuerpo = ""; estado = -1; }   // llego al SQL: no hay base aqui
            Check("R2 MOD: " + h.GetType().Name + " no lo bloquea el rol", "True|False",
                  (estado != 403) + "|" + cuerpo.Contains("RolInsuficiente"));
        }

        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "ADM", " adm ");
        cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Check("R3 duplicado ADM + ADM: sigue ADM", 400, estado);

        var otroAdm = new FuenteFalsa().Con(@"SORIANA\omaralus", "ADM");
        AccesoAdmin.FuenteRoles = otroAdm;
        foreach (var h in soloAdm)
        {
            cuerpo = Correr(h, "admin_iniciativas_x.ashx", null, @"SORIANA\omaralus", out estado);
            Check("R4 ADM en la tabla pero fuera de la whitelist: " + h.GetType().Name + " 403 AccesoDenegado", "403|True",
                  estado + "|" + cuerpo.Contains("AccesoDenegado"));
        }
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, @"SORIANA\omaralus", out estado);
        Check("R4 admin_sesion fuera de la whitelist: sin rol", "{\"autorizado\":false}", cuerpo);
        Check("R4 ni siquiera se consulta la tabla", 0, otroAdm.Pedidas.Count);

        var contada = new FuenteFalsa().Con(YO, "ADM");
        AccesoAdmin.FuenteRoles = contada;
        Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, @"  soriana\T_ANDRESVR ", out estado);
        Check("R5 se consulta con la cuenta original (sin espacios) y pasa", "400|soriana\\T_ANDRESVR",
              estado + "|" + (contada.Pedidas.Count > 0 ? contada.Pedidas[0] : ""));
        Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Check("R6 sin cache: una consulta por request (rol + Exigir no repiten)", 3, contada.Pedidas.Count);

        Check("R8 anonimo: MOD", "MOD", RolAdmin.Para(IdentidadWindows.Desde(null, false), new FuenteFalsa().Con(YO, "ADM"), null));
        var errores = new List<Exception>();
        Check("R8 la fuente falla: MOD y se registra", "MOD|1",
              RolAdmin.Para(YO, new FuenteFalsa { Falla = true }, errores.Add) + "|" + errores.Count);
        Check("R8 Resolver: vacio/null = MOD", "MOD|MOD", RolAdmin.Resolver(new string[0]) + "|" + RolAdmin.Resolver(null));
        AccesoAdmin.FuenteRoles = fuente;

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

        // ---- L) atajo de desarrollo local (AccesoDesarrolloLocal) ----------
        // La regla: DEBUG + request local + IIS Express, las tres.
        const string EXP = "iisexpress";
        Check("L1 local + DEBUG + IIS Express: ADM", true, AccesoDesarrolloLocal.Evaluar(true, true, EXP));
        Check("L1 nombre del proceso sin distinguir mayusculas", true, AccesoDesarrolloLocal.Evaluar(true, true, "IISExpress"));
        Check("L2 no local (remoto): autorizacion normal", false, AccesoDesarrolloLocal.Evaluar(true, false, EXP));
        Check("L3 sin DEBUG (Release): autorizacion normal", false, AccesoDesarrolloLocal.Evaluar(false, true, EXP));
        Check("L4 IIS de la VM (w3wp) aunque sea local y DEBUG: normal", false, AccesoDesarrolloLocal.Evaluar(true, true, "w3wp"));
        Check("L4 sin proceso conocido: normal", false, AccesoDesarrolloLocal.Evaluar(true, true, null));
        Check("L5 nada de lo anterior: normal", false, AccesoDesarrolloLocal.Evaluar(false, false, "w3wp"));

        // Este proceso no es IIS Express y el request armado no es local: en
        // cualquier build (DEBUG o no) los handlers siguen la regla normal.
        Console.WriteLine("      (build de App_Code con DEBUG = " + AccesoDesarrolloLocal.CompiladoEnDebug + ")");
        Check("L6 este request no activa el atajo", false, AccesoDesarrolloLocal.Activo(Contexto("x.ashx", null, "", new StringWriter())));
        foreach (var h in protegidos)
        {
            cuerpo = Correr(h, "admin_iniciativas_x.ashx", "categoria=/A", "", out estado);
            Check("L6 anonimo no local: " + h.GetType().Name + " 403 AccesoDenegado", "403|True",
                  estado + "|" + cuerpo.Contains("AccesoDenegado"));
        }
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, "", out estado);
        Check("L6 admin_sesion anonimo no local: sin autorizar ni marca de desarrollo", "{\"autorizado\":false}", cuerpo);
        Check("L6 null: no activa", false, AccesoDesarrolloLocal.Activo(null));

        // En un build sin DEBUG, Activo ni siquiera tiene la logica: el
        // fuente lo deja dentro de #if DEBUG con #else return false.
        var fuenteDev = File.ReadAllText(Path.Combine("App_Code", "AccesoDesarrolloLocal.cs")).Replace("\r\n", "\n");
        var activo = fuenteDev.Substring(fuenteDev.IndexOf("public static bool Activo("));
        activo = activo.Substring(0, activo.IndexOf("\n    }") + 6);
        Check("L7 Activo: #if DEBUG ... #else return false", true,
              activo.Contains("#if DEBUG") && activo.Contains("#else\n        return false;\n#endif"));
        Check("L7 sin host/URL/query/cookie/header en la regla", false,
              System.Text.RegularExpressions.Regex.IsMatch(activo, @"Url|Host|QueryString|Cookies|Headers|Form|Params|ServerVariables"));

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : ("FALLOS: " + fallos));
        return fallos == 0 ? 0 : 1;
    }
}
