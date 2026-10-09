// Prueba offline de la autorizacion de Admin A TRAVES DE LOS HANDLERS
// reales, con un HttpContext armado a mano (sin IIS y sin SQL Server). La
// identidad se pone en HttpContext.User, que es de donde la toma
// IdentidadWindows.DesdeContexto en IIS con Autenticacion de Windows.
//
// Solo se ejercitan caminos que NO tocan la base de datos real; el rol
// (dbo.UsuariosAdmin) sale de una fuente falsa (AccesoAdmin.FuenteRoles):
//   - cualquier handler con una identidad no autorizada: 403 antes de nada;
//   - capacidad ADM sin ?categoria: 400 (paso Exigir, no llego a SQL);
//   - validar ADM con GET: 405 (paso Exigir, no llego a SQL);
//   - Nueva solicitud es de ADM y MOD: capacidad/validar con MOD pasan
//     igual (400 / 405, sin RolInsuficiente); registro/catalogos con MOD:
//     NO 403 (pasan al SQL); lo solo-ADM (admin_correos) sigue 403
//     RolInsuficiente para MOD (parte C);
//   - VIEWER (sin fila en UsuariosAdmin, con un valor que no es ADM/MOD, o
//     con la consulta fallando; este en la whitelist o no): 403
//     AccesoDenegado en TODOS los handlers admin_iniciativas_*, PuedeEntrar
//     false (la pagina, via AdminAccesoModulo) y admin_sesion
//     {"autorizado":false};
//   - R4) LA BASE MANDA: fuera de la whitelist con fila ADM/MOD entra con
//     ese rol; en la whitelist sin rol valido no entra; anonimo nunca
//     consulta la base;
//   - D) el atajo local va primero en PuedeEntrar y Rol (revision del fuente);
//   - el atajo de desarrollo local (AccesoDesarrolloLocal) solo con DEBUG +
//     request local + IIS Express; aqui nunca se activa;
//   - admin_sesion.ashx sin ?persona: {"autorizado", "rol"}.
//   - C) admin_correos.ashx (consola de correos, lanza powershell.exe): solo
//     ADM. Se ejercita con GET (metadatos: nunca lanza nada); el permiso se
//     revisa antes de mirar el metodo, y el fuente se revisa para que
//     ExigirAdm vaya antes de cualquier otra cosa. Ninguna prueba hace POST
//     de un flujo real: no se ejecuta PowerShell ni se manda correo.
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
        Check("H2 capacidad ADM: pasa Exigir (400 por falta de categoria, sin SQL)", "400|True",
              estado + "|" + cuerpo.Contains("SolicitudInvalida"));
        cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, YO, out estado);
        Check("H3 validar ADM: pasa Exigir (405 por GET, sin SQL)", "405|True",
              estado + "|" + cuerpo.Contains("MetodoNoPermitido"));

        // ---- R) rol (dbo.UsuariosAdmin) despues de la whitelist -------------
        // Los dos handlers de Nueva solicitud (ADM y MOD).
        IHttpHandler[] solicitud = { new AdminIniciativasCapacidad(), new AdminIniciativasValidar() };
        IHttpHandler[] paraMod = { new AdminIniciativasRegistro(), new AdminIniciativasCatalogos() };
        IHttpHandler[] todosAdmin =
        {
            new AdminIniciativasCatalogos(), new AdminIniciativasCapacidad(), new AdminIniciativasValidar(),
            new AdminIniciativasRegistro(), new AdminIniciativasDiagnostico(),
        };
        var casosMod = new[]
        {
            new { nombre = "MOD", f = new FuenteFalsa().Con(YO, "MOD") },
            new { nombre = "duplicado ADM + MOD", f = new FuenteFalsa().Con(YO, "ADM", "MOD") },
        };
        foreach (var c in casosMod)
        {
            AccesoAdmin.FuenteRoles = c.f;
            cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": capacidad pasa (400 sin categoria, sin 403)", "400|True|False|False",
                  estado + "|" + cuerpo.Contains("SolicitudInvalida") + "|" + cuerpo.Contains("RolInsuficiente") +
                  "|" + cuerpo.Contains("AccesoDenegado"));
            cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": validar pasa (405 por GET, sin 403)", "405|True|False|False",
                  estado + "|" + cuerpo.Contains("MetodoNoPermitido") + "|" + cuerpo.Contains("RolInsuficiente") +
                  "|" + cuerpo.Contains("AccesoDenegado"));
            cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": lo solo-ADM (correos) sigue 403 RolInsuficiente", "403|True",
                  estado + "|" + cuerpo.Contains("RolInsuficiente"));
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": admin_sesion entra como MOD", "{\"autorizado\":true,\"rol\":\"MOD\"}", cuerpo);
        }

        // ---- V) VIEWER: en la whitelist pero sin rol valido ------------------
        var casosViewer = new[]
        {
            new { nombre = "sin fila en UsuariosAdmin", f = new FuenteFalsa() },
            new { nombre = "consulta que falla", f = new FuenteFalsa { Falla = true } },
            new { nombre = "valor raro", f = new FuenteFalsa().Con(YO, "ROOT") },
            new { nombre = "Acceso NULL", f = new FuenteFalsa().Con(YO, new string[] { null }) },
            new { nombre = "MOD + valor raro", f = new FuenteFalsa().Con(YO, "MOD", "ROOT") },
        };
        foreach (var c in casosViewer)
        {
            AccesoAdmin.FuenteRoles = c.f;
            foreach (var h in todosAdmin)
            {
                cuerpo = Correr(h, "admin_iniciativas_x.ashx", "categoria=/A", YO, out estado);
                Check("V1 " + c.nombre + ": " + h.GetType().Name + " 403 AccesoDenegado", "403|True|False",
                      estado + "|" + cuerpo.Contains("\"tipo\":\"AccesoDenegado\"") + "|" + cuerpo.Contains("RolInsuficiente"));
            }
            var sw = new StringWriter();
            var ctx = Contexto("iniciativas.html", null, YO, sw);
            Check("V2 " + c.nombre + ": PuedeEntrar false (pagina y modulo)", false, AccesoAdmin.PuedeEntrar(ctx));
            Check("V2 " + c.nombre + ": rol VIEWER", RolAdmin.Viewer, AccesoAdmin.Rol(ctx));
            HttpContext.Current = null;
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, YO, out estado);
            Check("V3 " + c.nombre + ": admin_sesion sin autorizar y sin rol", "200|{\"autorizado\":false}", estado + "|" + cuerpo);
        }
        Check("V4 la pagina y los handlers son rutas protegidas", "True|True|False",
              AccesoAdmin.EsRutaProtegida("~/admin/iniciativas.html") + "|" +
              AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_registro.ashx") + "|" +
              AccesoAdmin.EsRutaProtegida("~/dashboard.html"));
        foreach (var rol in new[] { "ADM", "MOD" })
        {
            AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, rol);
            var ctx = Contexto("iniciativas.html", null, YO, new StringWriter());
            Check("V5 " + rol + ": PuedeEntrar true", true, AccesoAdmin.PuedeEntrar(ctx));
            HttpContext.Current = null;
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

        // ---- R4) LA BASE MANDA: la whitelist temporal ya no es puerta ------
        // Cuenta ficticia, FUERA de AdminWhitelistTemporal, con fila ADM.
        const string FUERA = @"SORIANA\t_fuera_de_lista";
        Check("R4 la cuenta de prueba no esta en la whitelist", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(FUERA, true)));
        var otroAdm = new FuenteFalsa().Con(FUERA, "ADM");
        AccesoAdmin.FuenteRoles = otroAdm;
        cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, FUERA, out estado);
        Check("R4 ADM de la base, fuera de la lista: capacidad pasa (400 sin categoria)", 400, estado);
        cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, FUERA, out estado);
        Check("R4 ... validar pasa (405 por GET)", 405, estado);
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, FUERA, out estado);
        Check("R4 ... admin_sesion autorizado como ADM", "{\"autorizado\":true,\"rol\":\"ADM\"}", cuerpo);
        Check("R4 ... se consulta la tabla una vez por request", 3, otroAdm.Pedidas.Count);

        // Cuenta EN la whitelist pero sin rol valido: la lista no la deja pasar.
        AccesoAdmin.FuenteRoles = new FuenteFalsa();
        cuerpo = Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", null, YO, out estado);
        Check("R4b en la whitelist y sin fila: 403 AccesoDenegado (el nombre solo no basta)", "403|True",
              estado + "|" + cuerpo.Contains("AccesoDenegado"));

        // Anonimo / sin usuario: nunca se consulta la base.
        foreach (var cuenta in new[] { "", (string)null })
        {
            var contadaAnon = new FuenteFalsa().Con(YO, "ADM");
            AccesoAdmin.FuenteRoles = contadaAnon;
            cuerpo = Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", null, cuenta, out estado);
            Check("R4c " + (cuenta == null ? "sin usuario" : "anonimo") + ": 403 y sin consultar la tabla", "403|0",
                  estado + "|" + contadaAnon.Pedidas.Count);
        }

        var contada = new FuenteFalsa().Con(YO, "ADM");
        AccesoAdmin.FuenteRoles = contada;
        Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, @"  soriana\T_ANDRESVR ", out estado);
        Check("R5 se consulta con la cuenta original (sin espacios) y pasa", "400|soriana\\T_ANDRESVR",
              estado + "|" + (contada.Pedidas.Count > 0 ? contada.Pedidas[0] : ""));
        Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Check("R6 sin cache: una consulta por request (rol + Exigir no repiten)", 3, contada.Pedidas.Count);

        Check("R8 anonimo: VIEWER", "VIEWER", RolAdmin.Para(IdentidadWindows.Desde(null, false), new FuenteFalsa().Con(YO, "ADM"), null));
        var errores = new List<Exception>();
        Check("R8 la fuente falla: VIEWER y se registra", "VIEWER|1",
              RolAdmin.Para(YO, new FuenteFalsa { Falla = true }, errores.Add) + "|" + errores.Count);
        Check("R8 Resolver: vacio/null = VIEWER", "VIEWER|VIEWER", RolAdmin.Resolver(new string[0]) + "|" + RolAdmin.Resolver(null));
        Check("R8 sin fuente o cuenta vacia: VIEWER", "VIEWER|VIEWER",
              RolAdmin.Para(YO, null, null) + "|" + RolAdmin.Para("  ", new FuenteFalsa().Con(YO, "ADM"), null));
        Check("R9 Resolver: ADM / MOD / ADM+MOD / ' mod ' / MOD+NULL", "ADM|MOD|MOD|MOD|VIEWER",
              RolAdmin.Resolver(new[] { "ADM" }) + "|" + RolAdmin.Resolver(new[] { "MOD" }) + "|" +
              RolAdmin.Resolver(new[] { "ADM", "MOD" }) + "|" + RolAdmin.Resolver(new[] { " mod " }) + "|" +
              RolAdmin.Resolver(new[] { "MOD", null }));
        Check("R9 EsElevado: solo ADM y MOD", "True|True|False|False",
              RolAdmin.EsElevado("ADM") + "|" + RolAdmin.EsElevado("MOD") + "|" +
              RolAdmin.EsElevado("VIEWER") + "|" + RolAdmin.EsElevado(null));
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

        // ---- C) admin_correos.ashx: solo ADM -----------------------------------
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "ADM");
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, YO, out estado);
        Check("C1 ADM: pasa (GET de metadatos, sin 403)", "True|False|False",
              (estado != 403) + "|" + cuerpo.Contains("AccesoDenegado") + "|" + cuerpo.Contains("RolInsuficiente"));

        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "MOD");
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, YO, out estado);
        Check("C2 MOD: 403 RolInsuficiente con su mensaje", "403|True|True|False",
              estado + "|" + cuerpo.Contains("\"tipo\":\"RolInsuficiente\"") + "|" +
              cuerpo.Contains("consola de correos") + "|" + cuerpo.Contains("fechaCorte"));
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "ADM", "MOD");
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, YO, out estado);
        Check("C2 ADM + MOD (= MOD): 403 RolInsuficiente", "403|True", estado + "|" + cuerpo.Contains("RolInsuficiente"));

        var casosCorreoDenegado = new[]
        {
            new { nombre = "VIEWER sin fila", cuenta = YO, f = new FuenteFalsa() },
            new { nombre = "consulta de rol que falla", cuenta = YO, f = new FuenteFalsa { Falla = true } },
            new { nombre = "Acceso NULL", cuenta = YO, f = new FuenteFalsa().Con(YO, new string[] { null }) },
            new { nombre = "cuenta sin fila en la tabla", cuenta = @"SORIANA\t_otro", f = new FuenteFalsa().Con(YO, "ADM") },
            new { nombre = "anonimo", cuenta = "", f = new FuenteFalsa().Con(YO, "ADM") },
            new { nombre = "sin usuario", cuenta = (string)null, f = new FuenteFalsa().Con(YO, "ADM") },
        };
        foreach (var c in casosCorreoDenegado)
        {
            AccesoAdmin.FuenteRoles = c.f;
            cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, c.cuenta, out estado);
            Check("C3 " + c.nombre + ": 403 AccesoDenegado, sin metadatos", "403|True|False",
                  estado + "|" + cuerpo.Contains("\"tipo\":\"AccesoDenegado\"") + "|" + cuerpo.Contains("fechaCorte"));
        }
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(@"SORIANA\t_fuera_de_lista", "ADM");
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, @"SORIANA\t_fuera_de_lista", out estado);
        Check("C4 ADM de la base fuera de la whitelist: la consola de correos lo deja pasar", "True|False|False",
              (estado != 403) + "|" + cuerpo.Contains("AccesoDenegado") + "|" + cuerpo.Contains("RolInsuficiente"));
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(@"SORIANA\t_fuera_de_lista", "MOD");
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, @"SORIANA\t_fuera_de_lista", out estado);
        Check("C4 MOD de la base fuera de la whitelist: correos 403 RolInsuficiente", "403|True",
              estado + "|" + cuerpo.Contains("RolInsuficiente"));

        // ---- O) SORIANA\omaralus: FUERA de la whitelist; manda su rol ------
        const string OMAR = @"SORIANA\omaralus";
        Check("O0 Omar no esta en la whitelist temporal (quitado a proposito)", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(OMAR, true)));
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(OMAR, "ADM");
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, OMAR, out estado);
        Check("O1 Omar ADM: admin_sesion autorizado como ADM", "200|{\"autorizado\":true,\"rol\":\"ADM\"}", estado + "|" + cuerpo);
        cuerpo = Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", null, OMAR, out estado);
        Check("O1 Omar ADM: registro no da 403", "True|False", (estado != 403) + "|" + cuerpo.Contains("AccesoDenegado"));
        cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, OMAR, out estado);
        Check("O1 Omar ADM: capacidad pasa (400 sin categoria)", 400, estado);
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, OMAR, out estado);
        Check("O1 Omar ADM: lo solo-ADM (correos, GET de metadatos) pasa", "True|False|False",
              (estado != 403) + "|" + cuerpo.Contains("AccesoDenegado") + "|" + cuerpo.Contains("RolInsuficiente"));

        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(OMAR, "MOD");
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, OMAR, out estado);
        Check("O2 Omar con rol MOD: lo solo-ADM sigue 403 RolInsuficiente", "403|True", estado + "|" + cuerpo.Contains("RolInsuficiente"));
        cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, OMAR, out estado);
        Check("O2 Omar con rol MOD: Nueva solicitud si (405 por GET)", 405, estado);

        foreach (var c in new[]
        {
            new { nombre = "sin fila", f = new FuenteFalsa() },
            new { nombre = "consulta que falla", f = new FuenteFalsa { Falla = true } },
        })
        {
            AccesoAdmin.FuenteRoles = c.f;
            cuerpo = Correr(new AdminIniciativasRegistro(), "admin_iniciativas_registro.ashx", null, OMAR, out estado);
            Check("O3 Omar " + c.nombre + ": sin rol valido no entra (403 AccesoDenegado)", "403|True",
                  estado + "|" + cuerpo.Contains("AccesoDenegado"));
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, OMAR, out estado);
            Check("O3 Omar " + c.nombre + ": admin_sesion sin autorizar", "{\"autorizado\":false}", cuerpo);
        }

        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "ADM");
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, YO, out estado);
        Check("O4 t_andresvr sigue igual: ADM", "{\"autorizado\":true,\"rol\":\"ADM\"}", cuerpo);
        // Cuenta de prueba MOD, fuera de la whitelist: entra como MOD.
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(@"SORIANA\danielalc", "MOD");
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, @"SORIANA\danielalc", out estado);
        Check("O5 fila MOD fuera de la whitelist: admin_sesion MOD", "{\"autorizado\":true,\"rol\":\"MOD\"}", cuerpo);
        cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, @"SORIANA\danielalc", out estado);
        Check("O5 ... Nueva solicitud si (405 por GET)", 405, estado);
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, @"SORIANA\danielalc", out estado);
        Check("O5 ... lo solo-ADM no (403 RolInsuficiente)", "403|True", estado + "|" + cuerpo.Contains("RolInsuficiente"));

        // ---- D) el atajo de desarrollo local sigue igual y va PRIMERO -------
        var fuenteAcceso = File.ReadAllText(Path.Combine("App_Code", "AccesoAdmin.cs")).Replace("\r\n", "\n");
        var puede = fuenteAcceso.Substring(fuenteAcceso.IndexOf("public static bool PuedeEntrar("));
        puede = puede.Substring(0, puede.IndexOf("\n    }") + 6);
        Check("D1 PuedeEntrar: primero el atajo local (true), despues el rol de la base", true,
              puede.IndexOf("AccesoDesarrolloLocal.Activo(context)) return true;") > 0 &&
              puede.IndexOf("AccesoDesarrolloLocal.Activo(context)") < puede.IndexOf("RolAdmin.EsElevado(Rol(context))"));
        Check("D2 PuedeEntrar ya no usa la whitelist", false, puede.Contains("EstaAutorizado") || puede.Contains("Configurada"));
        var rolFn = fuenteAcceso.Substring(fuenteAcceso.IndexOf("public static string Rol(HttpContext context)"));
        rolFn = rolFn.Substring(0, rolFn.IndexOf("\n    }") + 6);
        Check("D3 Rol: el atajo local da ADM antes de tocar la base", true,
              rolFn.IndexOf("AccesoDesarrolloLocal.Activo(context)) return RolAdmin.Adm;") > 0 &&
              rolFn.IndexOf("AccesoDesarrolloLocal.Activo") < rolFn.IndexOf("RolAdmin.Para("));
        Check("D4 la whitelist sigue existiendo (solo t_andresvr) y se sigue leyendo bien", "SORIANA\\t_andresvr|1|0",
              AdminWhitelistTemporal.Cuentas + "|" + AccesoAdmin.Configurada().Total + "|" + AccesoAdmin.Configurada().Ignoradas);

        var fuenteCorreos = File.ReadAllText(Path.Combine("handlers", "admin_correos.ashx")).Replace("\r\n", "\n");
        var proceso = fuenteCorreos.Substring(fuenteCorreos.IndexOf("public void ProcessRequest(HttpContext context)"));
        var iExigir = proceso.IndexOf("AccesoAdmin.ExigirAdm(context");
        var iResponder = proceso.IndexOf("DashboardHandler.Responder");
        Check("C5 fuente: ExigirAdm es lo primero, antes de Responder", true, iExigir > 0 && iExigir < iResponder);
        Check("C5 fuente: ExigirAdm antes de cualquier Process.Start", true,
              fuenteCorreos.IndexOf("AccesoAdmin.ExigirAdm(context") < fuenteCorreos.IndexOf("Process.Start("));
        Check("C5 fuente: un solo punto de entrada al handler", 1,
              System.Text.RegularExpressions.Regex.Matches(fuenteCorreos, @"public void ProcessRequest").Count);
        AccesoAdmin.FuenteRoles = fuente;

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
