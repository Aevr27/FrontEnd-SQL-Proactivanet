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
//   - ADMIN_DEV_ROL solo con la identidad simulada;
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

        // ADMIN_DEV_ROL: la regla pura.
        Check("R7 dev ADM con identidad simulada", "ADM", RolAdmin.RolDesarrollo(true, "ADM"));
        Check("R7 dev MOD con identidad simulada", "MOD", RolAdmin.RolDesarrollo(true, " mod "));
        Check("R7 dev valor raro: ignorado", true, RolAdmin.RolDesarrollo(true, "ROOT") == null
                                                   && RolAdmin.RolDesarrollo(true, "") == null
                                                   && RolAdmin.RolDesarrollo(true, null) == null);
        Check("R7 dev sin identidad simulada: ignorado", true, RolAdmin.RolDesarrollo(false, "ADM") == null);
        var noUsar = new FuenteFalsa().Con(YO, "MOD");
        Check("R8 simulada + ADMIN_DEV_ROL=ADM: ADM sin consultar la base", "ADM|0",
              RolAdmin.Para(YO, true, noUsar, "ADM", null) + "|" + noUsar.Pedidas.Count);
        Check("R8 simulada + ADMIN_DEV_ROL=MOD: MOD aunque la tabla diga ADM", "MOD",
              RolAdmin.Para(YO, true, new FuenteFalsa().Con(YO, "ADM"), "MOD", null));
        Check("R8 simulada + valor raro: cae a la tabla", "ADM",
              RolAdmin.Para(YO, true, new FuenteFalsa().Con(YO, "ADM"), "root", null));
        Check("R8 identidad real + ADMIN_DEV_ROL=ADM: manda la tabla (MOD)", "MOD",
              RolAdmin.Para(YO, false, new FuenteFalsa().Con(YO, "MOD"), "ADM", null));
        Check("R8 anonimo: MOD", "MOD", RolAdmin.Para(IdentidadWindows.Desde(null, false), new FuenteFalsa().Con(YO, "ADM"), "ADM", null));
        var errores = new List<Exception>();
        Check("R8 la fuente falla: MOD y se registra", "MOD|1",
              RolAdmin.Para(YO, false, new FuenteFalsa { Falla = true }, null, errores.Add) + "|" + errores.Count);
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

        // ---- D) desarrollo local (IdentidadDesarrolloLocal) -----------------
        // La regla: las cuatro condiciones a la vez.
        const string EXP = "iisexpress";
        Check("D1 iisexpress + local + anonimo + variable: simula", YO,
              IdentidadDesarrolloLocal.Evaluar(EXP, true, false, " " + YO + " "));
        Check("D2 en IIS (w3wp): nunca", true, IdentidadDesarrolloLocal.Evaluar("w3wp", true, false, YO) == null);
        Check("D3 cliente remoto: nunca", true, IdentidadDesarrolloLocal.Evaluar(EXP, false, false, YO) == null);
        Check("D4 con identidad real: nunca la reemplaza", true, IdentidadDesarrolloLocal.Evaluar(EXP, true, true, YO) == null);
        Check("D5 sin variable: nada", true, IdentidadDesarrolloLocal.Evaluar(EXP, true, false, null) == null
                                             && IdentidadDesarrolloLocal.Evaluar(EXP, true, false, "  ") == null);
        Check("D6 variable sin dominio / sin cuenta: nada", true,
              IdentidadDesarrolloLocal.Evaluar(EXP, true, false, "t_andresvr") == null
              && IdentidadDesarrolloLocal.Evaluar(EXP, true, false, @"SORIANA\") == null
              && IdentidadDesarrolloLocal.Evaluar(EXP, true, false, @"\t_andresvr") == null);
        Check("D7 la simulada pasa por la whitelist: otra cuenta seguiria negada", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(
                  IdentidadDesarrolloLocal.Evaluar(EXP, true, false, @"SORIANA\t_otro"), true)));

        // Con la variable PUESTA en este proceso (que no es iisexpress y cuyo
        // request no es local): el camino normal no cambia en nada.
        Environment.SetEnvironmentVariable(IdentidadDesarrolloLocal.Variable, YO);
        try
        {
            foreach (var h in protegidos)
            {
                cuerpo = Correr(h, "admin_iniciativas_x.ashx", "categoria=/A", "", out estado);
                Check("D8 variable puesta, fuera de IIS Express: " + h.GetType().Name + " anonimo sigue en 403",
                      "403|True", estado + "|" + cuerpo.Contains("AccesoDenegado"));
            }
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, "", out estado);
            Check("D8 admin_sesion anonimo sigue sin autorizar", "{\"autorizado\":false}", cuerpo);

            // ADMIN_DEV_ROL puesto en este proceso (no es iisexpress): con la
            // identidad REAL se ignora y manda la tabla.
            Environment.SetEnvironmentVariable(IdentidadDesarrolloLocal.VariableRol, "ADM");
            AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "MOD");
            cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
            Check("D11 ADMIN_DEV_ROL=ADM fuera de IIS Express con identidad real MOD: 403 RolInsuficiente", "403|True",
                  estado + "|" + cuerpo.Contains("RolInsuficiente"));
            cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, "", out estado);
            Check("D11 ... y anonimo sigue en 403 AccesoDenegado", "403|True", estado + "|" + cuerpo.Contains("AccesoDenegado"));
            AccesoAdmin.FuenteRoles = fuente;
            cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, @"SORIANA\t_otro", out estado);
            Check("D9 identidad real no autorizada: 403 aunque la variable diga t_andresvr", 403, estado);
            var sw = new StringWriter();
            var ctxReal = Contexto("x.ashx", null, YO, sw);
            var idReal = IdentidadWindows.DesdeContexto(ctxReal);
            Check("D10 identidad real autorizada: es la real, no la simulada", "SORIANA\\t_andresvr|False",
                  idReal.Original + "|" + idReal.DesarrolloLocal);
            Environment.SetEnvironmentVariable(IdentidadDesarrolloLocal.Variable, @"SORIANA\t_otro");
            Check("D10 la variable no pisa a la identidad real", true,
                  AccesoAdmin.EstaAutorizado(IdentidadWindows.DesdeContexto(Contexto("x.ashx", null, YO, new StringWriter()))));
        }
        finally
        {
            Environment.SetEnvironmentVariable(IdentidadDesarrolloLocal.Variable, null);
            Environment.SetEnvironmentVariable(IdentidadDesarrolloLocal.VariableRol, null);
            HttpContext.Current = null;
        }

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : ("FALLOS: " + fallos));
        return fallos == 0 ? 0 : 1;
    }
}
