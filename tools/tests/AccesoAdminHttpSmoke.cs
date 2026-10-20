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
//   - el atajo de desarrollo local (AccesoDesarrolloLocal) solo con
//     AdminDevOverride=true + DEBUG + request local + IIS Express; aqui
//     nunca se activa;
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
//   csc /nologo /out:AccesoAdminHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Web.dll /r:System.Configuration.dll ^
//       tools\tests\AccesoAdminHttpSmoke.cs
//   AccesoAdminHttpSmoke.exe
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Reflection;
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

// CorreoUsuario de mentira: cuenta (mayusculas) -> filas.
sealed class FuenteCorreoFalsa : IFuenteCorreoAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public bool Falla;
    public readonly List<string> Pedidas = new List<string>();

    public IList<string> CorreosDe(string cuenta)
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

    // POST multipart como el del navegador (sin IIS): el metodo y el Form se
    // fijan por reflexion. Solo para caminos que deben cortar ANTES de leer
    // el formulario (403): nunca llegan a la base.
    static string CorrerPost(IHttpHandler h, string archivo, string cuenta, string[][] campos, out int estado, out string metodo)
    {
        var sw = new StringWriter();
        var ctx = Contexto(archivo, null, cuenta, sw);
        var req = ctx.Request;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, "POST");
        var tipoForm = typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection");
        var form = (NameValueCollection)Activator.CreateInstance(tipoForm, true);
        foreach (var c in campos) form.Add(c[0], c[1]);
        typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, form);
        metodo = req.HttpMethod;
        h.ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
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

        // ---- correo de la cabecera (App_Code/CorreoAdmin.cs) ------------------
        var correos = new FuenteCorreoFalsa();
        correos.Filas[YO.ToUpperInvariant()] = new[] { " andresvr@soriana.com " };
        correos.Filas[@"SORIANA\T_DOS"] = new[] { "uno@soriana.com", "otro@soriana.com" };
        correos.Filas[@"SORIANA\T_REPETIDO"] = new[] { "Uno@Soriana.com", null, "uno@soriana.com", "" };
        correos.Filas[@"SORIANA\T_RARO"] = new[] { "sin arroba", "<b>x</b>@a.com" };
        Check("CO1 correo de la fila de la cuenta, sin espacios", "andresvr@soriana.com",
              CorreoAdmin.Para(IdentidadWindows.Desde(YO, true), correos, null));
        Check("CO1 la cuenta se busca con DOMINIO\\cuenta (Original), como el rol", YO, correos.Pedidas[0]);
        Check("CO2 dos correos distintos: ninguno (no se elige)", "",
              CorreoAdmin.Para(IdentidadWindows.Desde(@"SORIANA\t_dos", true), correos, null) ?? "");
        Check("CO3 el mismo repetido (y filas vacias): ese", "Uno@Soriana.com",
              CorreoAdmin.Para(IdentidadWindows.Desde(@"SORIANA\t_repetido", true), correos, null) ?? "");
        Check("CO4 valores sin forma de correo o con marcado: ninguno", "",
              CorreoAdmin.Para(IdentidadWindows.Desde(@"SORIANA\t_raro", true), correos, null) ?? "");
        Check("CO5 sin fila: ninguno (nunca se arma con la cuenta)", "",
              CorreoAdmin.Para(IdentidadWindows.Desde(@"SORIANA\t_nadie", true), correos, null) ?? "");
        var pedidasAntes = correos.Pedidas.Count;
        Check("CO6 anonimo: ninguno y sin consultar", "|" + pedidasAntes,
              (CorreoAdmin.Para(IdentidadWindows.Desde("", false), correos, null) ?? "") + "|" + correos.Pedidas.Count);
        correos.Falla = true;
        var registrado = false;
        Check("CO7 consulta que falla: ninguno y se registra", "|True",
              (CorreoAdmin.Para(IdentidadWindows.Desde(YO, true), correos, delegate { registrado = true; }) ?? "") + "|" + registrado);

        cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, YO, out estado);
        Check("H2 capacidad ADM: pasa Exigir (400 por falta de categoria, sin SQL)", "400|True",
              estado + "|" + cuerpo.Contains("SolicitudInvalida"));
        cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, YO, out estado);
        Check("H3 validar ADM: pasa Exigir (405 por GET, sin SQL)", "405|True",
              estado + "|" + cuerpo.Contains("MetodoNoPermitido"));
        cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "duenos=1", YO, out estado);
        Check("H3 catalogos?duenos=1 ADM: pasa ExigirAdm (sin 403)", "False|False",
              (estado == 403) + "|" + cuerpo.Contains("RolInsuficiente"));
        cuerpo = Correr(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", null, YO, out estado);
        Check("H3 gestion ADM: pasa ExigirAdm (405 por GET, sin SQL)", "405|True",
              estado + "|" + cuerpo.Contains("MetodoNoPermitido"));

        // ---- R) rol (dbo.UsuariosAdmin) despues de la whitelist -------------
        // Los dos handlers de Nueva solicitud (ADM y MOD).
        IHttpHandler[] solicitud = { new AdminIniciativasCapacidad(), new AdminIniciativasValidar() };
        IHttpHandler[] paraMod = { new AdminIniciativasRegistro(), new AdminIniciativasCatalogos() };
        IHttpHandler[] todosAdmin =
        {
            new AdminIniciativasCatalogos(), new AdminIniciativasCapacidad(), new AdminIniciativasValidar(),
            new AdminIniciativasRegistro(), new AdminIniciativasDiagnostico(), new AdminIniciativasGestion(), new AdminCategoriasAlta(),
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
            cuerpo = Correr(new AdminCategoriasAlta(), "admin_categorias_alta.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": alta de categoria 403 RolInsuficiente (antes de leer la base)", "403|True",
                  estado + "|" + cuerpo.Contains("RolInsuficiente"));
            cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "duenos=1", YO, out estado);
            Check("R1 " + c.nombre + ": catalogos?duenos=1 (gestion de duenos) 403 RolInsuficiente", "403|True",
                  estado + "|" + cuerpo.Contains("RolInsuficiente"));
            cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "rutas=1", YO, out estado);
            Check("R1 " + c.nombre + ": catalogos?rutas=1 sigue abierto a MOD (sin 403)", "False|False",
                  (estado == 403) + "|" + cuerpo.Contains("RolInsuficiente"));
            cuerpo = Correr(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": crear/modificar directo (gestion) 403 RolInsuficiente", "403|True|False",
                  estado + "|" + cuerpo.Contains("RolInsuficiente") + "|" + cuerpo.Contains("MetodoNoPermitido"));
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, YO, out estado);
            Check("R1 " + c.nombre + ": admin_sesion entra como MOD", "{\"autorizado\":true,\"rol\":\"MOD\"}", cuerpo);
        }

        // ---- X) Edicion directa (accion=modificar por POST) sin ADM ----------
        // El detalle de Iniciativas manda el mismo POST que el antiguo
        // "Modificar". Sin rol ADM en dbo.UsuariosAdmin el handler corta con
        // 403 antes de leer el formulario; un "rol" que mande el navegador
        // (campo o lo que sea) no cuenta.
        var postModificar = new[]
        {
            new[] { "accion", "modificar" }, new[] { "folio", "PRB 2026-000001" }, new[] { "titulo", "Cambiado" },
            new[] { "f_cierre", "2027-01-31" }, new[] { "rol", "ADM" }, new[] { "Acceso", "ADM" },
        };
        var casosPost = new[]
        {
            new { nombre = "MOD", cuenta = YO, f = new FuenteFalsa().Con(YO, "MOD"), tipo = "RolInsuficiente" },
            new { nombre = "ADM + MOD", cuenta = YO, f = new FuenteFalsa().Con(YO, "ADM", "MOD"), tipo = "RolInsuficiente" },
            new { nombre = "VIEWER (sin fila)", cuenta = YO, f = new FuenteFalsa(), tipo = "AccesoDenegado" },
            new { nombre = "consulta de rol que falla", cuenta = YO, f = new FuenteFalsa { Falla = true }, tipo = "AccesoDenegado" },
            new { nombre = "otra cuenta (sin fila)", cuenta = @"SORIANA\t_otro", f = new FuenteFalsa().Con(YO, "ADM"), tipo = "AccesoDenegado" },
            new { nombre = "anonimo", cuenta = "", f = new FuenteFalsa().Con(YO, "ADM"), tipo = "AccesoDenegado" },
        };
        foreach (var c in casosPost)
        {
            AccesoAdmin.FuenteRoles = c.f;
            string metodo;
            cuerpo = CorrerPost(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", c.cuenta, postModificar, out estado, out metodo);
            Check("X1 " + c.nombre + ": POST accion=modificar (con rol=ADM en el formulario) 403 " + c.tipo + ", sin validar ni guardar",
                  "POST|403|True|False|False",
                  metodo + "|" + estado + "|" + cuerpo.Contains("\"tipo\":\"" + c.tipo + "\"") + "|" +
                  cuerpo.Contains("\"valida\"") + "|" + cuerpo.Contains("\"guardada\""));
        }
        // PO / SO con sql/24 ya vista en la base: la edicion encendida es
        // solo de ADM; MOD y los demas siguen en 403 antes de leer nada.
        var postDuenos = new[]
        {
            new[] { "accion", "modificar" }, new[] { "folio", "PRB 2026-000001" }, new[] { "po", "PO 2" }, new[] { "so", "SO y" },
        };
        PersistenciaGestionAdmin.AnotarSql24(true, DateTime.UtcNow);
        foreach (var c in casosPost)
        {
            AccesoAdmin.FuenteRoles = c.f;
            string metodo;
            cuerpo = CorrerPost(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", c.cuenta, postDuenos, out estado, out metodo);
            Check("X2 " + c.nombre + ": POST modificar PO / SO con sql/24 activa 403 " + c.tipo + ", sin validar ni guardar",
                  "True|403|True|False|False",
                  PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva() + "|" + estado + "|" + cuerpo.Contains("\"tipo\":\"" + c.tipo + "\"") + "|" +
                  cuerpo.Contains("\"valida\"") + "|" + cuerpo.Contains("\"guardada\""));
        }
        PersistenciaGestionAdmin.OlvidarSql24ParaPruebas();
        AccesoAdmin.FuenteRoles = fuente;

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
            new AdminIniciativasRegistro(), new AdminIniciativasDiagnostico(), new AdminIniciativasGestion(), new AdminCategoriasAlta(),
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
        Check("D3 Rol: el rol de desarrollo local (whitelist) va antes de tocar la base", true,
              rolFn.IndexOf("AccesoDesarrolloLocal.Rol(context)") > 0 &&
              rolFn.IndexOf("if (local != null) return local;") > 0 &&
              rolFn.IndexOf("AccesoDesarrolloLocal.Rol(context)") < rolFn.IndexOf("RolAdmin.Para("));
        Check("D3 Rol: ya no hay ADM fijo para todo request local", false,
              fuenteAcceso.Contains("AccesoDesarrolloLocal.Activo(context)) return RolAdmin.Adm;"));
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
        // La regla: AdminDevOverride=true + DEBUG + request local + IIS Express, las cuatro.
        const string EXP = "iisexpress";
        Check("L1 interruptor + local + DEBUG + IIS Express: ADM", true, AccesoDesarrolloLocal.Evaluar(true, true, true, EXP));
        Check("L1 nombre del proceso sin distinguir mayusculas", true, AccesoDesarrolloLocal.Evaluar(true, true, true, "IISExpress"));
        Check("L0 interruptor apagado (todo lo demas local): autorizacion normal", false, AccesoDesarrolloLocal.Evaluar(false, true, true, EXP));
        Check("L2 no local (remoto): autorizacion normal", false, AccesoDesarrolloLocal.Evaluar(true, true, false, EXP));
        Check("L3 sin DEBUG (Release): autorizacion normal", false, AccesoDesarrolloLocal.Evaluar(true, false, true, EXP));
        Check("L4 IIS de la VM (w3wp) aunque sea local, DEBUG y con interruptor: normal", false, AccesoDesarrolloLocal.Evaluar(true, true, true, "w3wp"));
        Check("L4 sin proceso conocido: normal", false, AccesoDesarrolloLocal.Evaluar(true, true, true, null));
        Check("L5 nada de lo anterior: normal", false, AccesoDesarrolloLocal.Evaluar(false, false, false, "w3wp"));
        // El interruptor: solo "true" (sin distinguir mayusculas, sin espacios alrededor) lo enciende.
        foreach (var v in new[] { "true", "TRUE", " True " })
            Check("L0 AdminDevOverride='" + v + "': encendido", true, AccesoDesarrolloLocal.Habilitado(v));
        foreach (var v in new[] { null, "", " ", "false", "1", "yes", "on", "truee", "true;", "\"true\"" })
            Check("L0 AdminDevOverride=" + (v == null ? "(ausente)" : "'" + v + "'") + ": apagado", false, AccesoDesarrolloLocal.Habilitado(v));

        // ---- W) whitelist de desarrollo local (AccesoDesarrolloLocal.RolPara) --
        // La regla completa sin HttpContext: entorno (DEBUG + loopback + IIS
        // Express, arriba) Y la cuenta de desarrollo en AdminWhitelistTemporal.
        var lista = AccesoAdmin.Configurada();
        Func<string, IdentidadWindows> dev = delegate (string n)
        {
            return AccesoDesarrolloLocal.IdentidadPara(IdentidadWindows.Desde(null, false), n);
        };
        // 1) la cuenta de la whitelist entra en el entorno de desarrollo
        Check("W1 entorno + SORIANA\\t_andresvr: ADM", "ADM", AccesoDesarrolloLocal.RolPara(true, dev(YO), lista, null));
        Check("W1 mayusculas/espacios no importan", "ADM", AccesoDesarrolloLocal.RolPara(true, dev(@"  soriana\T_ANDRESVR "), lista, ""));
        Check("W1 ADMIN_DEV_ROL=MOD: MOD", "MOD", AccesoDesarrolloLocal.RolPara(true, dev(YO), lista, "mod"));
        // 2) otra cuenta local NO entra sola
        foreach (var otra in new[] { @"SORIANA\omaralus", @"SORIANA\danielalc", @"SORIANA\t_otro", @"OTRO\t_andresvr", "t_andresvr", "", null })
            Check("W2 entorno + " + (otra == null ? "(sin variable)" : otra.Length == 0 ? "(vacia)" : otra) + ": sin atajo",
                  null, AccesoDesarrolloLocal.RolPara(true, dev(otra), lista, "ADM"));
        Check("W2 ADMIN_DEV_ROL raro (VIEWER/ADMIN): sin atajo", "|",
              AccesoDesarrolloLocal.RolPara(true, dev(YO), lista, "VIEWER") + "|" + AccesoDesarrolloLocal.RolPara(true, dev(YO), lista, "ADMIN"));
        Check("W2 sin whitelist: sin atajo", null, AccesoDesarrolloLocal.RolPara(true, dev(YO), null, null));
        var real = AccesoDesarrolloLocal.IdentidadPara(IdentidadWindows.Desde(@"SORIANA\t_otro", true), YO);
        Check("W2 identidad real autenticada manda sobre la declarada", @"soriana\t_otro", real.Dominio + "\\" + real.Usuario);
        Check("W2 real de otra cuenta + variable de la whitelist: sin atajo", null, AccesoDesarrolloLocal.RolPara(true, real, lista, null));
        // 3) fuera del entorno (VM, produccion, remoto, Release) la whitelist no da nada
        var fueras = new[] {
            new object[] { false, true,  true,  EXP,    "interruptor apagado (local)" },
            new object[] { true,  true,  false, EXP,    "remoto" },
            new object[] { true,  false, true,  EXP,    "Release" },
            new object[] { true,  true,  true,  "w3wp", "IIS de la VM (w3wp) con interruptor" },
            new object[] { false, false, false, "w3wp", "produccion" } };
        foreach (var e in fueras)
        {
            var entorno = AccesoDesarrolloLocal.Evaluar((bool)e[0], (bool)e[1], (bool)e[2], (string)e[3]);
            Check("W3 " + e[4] + " + SORIANA\\t_andresvr: sin atajo", null, AccesoDesarrolloLocal.RolPara(entorno, dev(YO), lista, "ADM"));
            Check("W3 " + e[4] + " + rol MOD: sin atajo", null, AccesoDesarrolloLocal.RolPara(entorno, dev(YO), lista, "MOD"));
        }
        // 3b) por HTTP, fuera del entorno local: la cuenta de la whitelist sin
        // fila en dbo.UsuariosAdmin NO entra (la base manda); con fila MOD
        // entra con SU rol, no con el de desarrollo.
        AccesoAdmin.FuenteRoles = new FuenteFalsa();
        cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, YO, out estado);
        Check("W3 whitelist sin fila en UsuariosAdmin: admin_sesion no autoriza", "{\"autorizado\":false}", cuerpo);
        foreach (var h in protegidos)
        {
            cuerpo = Correr(h, "admin_iniciativas_x.ashx", "categoria=/A", YO, out estado);
            Check("W3 whitelist sin fila: " + h.GetType().Name + " 403 AccesoDenegado", "403|True",
                  estado + "|" + cuerpo.Contains("AccesoDenegado"));
        }
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "MOD");
        cuerpo = Correr(new AdminCorreos(), "admin_correos.ashx", null, YO, out estado);
        Check("W3 whitelist con fila MOD: el rol de la base manda (403 RolInsuficiente)", "403|True",
              estado + "|" + cuerpo.Contains("RolInsuficiente"));
        AccesoAdmin.FuenteRoles = fuente;
        // 4) lo del cliente no cuenta: ningun header/query/cookie activa nada
        var fuenteRol = File.ReadAllText(Path.Combine("App_Code", "AccesoDesarrolloLocal.cs")).Replace("\r\n", "\n");
        Check("W4 la regla no lee host/URL/query/cookie/header/form", false,
              System.Text.RegularExpressions.Regex.IsMatch(fuenteRol,
                  @"\.(Url|Host|QueryString|Cookies|Headers|Form|Params|ServerVariables|UserAgent|UserHostAddress)\b"));
        Check("W4 la cuenta declarada sale del entorno del PROCESO", true,
              fuenteRol.Contains("Environment.GetEnvironmentVariable(variable)") && fuenteRol.Contains("Entorno(VariableIdentidad)"));

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
        Check("L7 Activo = Rol(ctx) != null", true, activo.Contains("return Rol(ctx) != null;"));
        // Rol() e Identidad() salen de Resolver(): la regla vive ahi.
        Check("L7 Rol e Identidad delegan en Resolver", true,
              fuenteDev.Contains("public static string Rol(HttpContext ctx)\n    {\n        IdentidadWindows cuenta;\n        return Resolver(ctx, out cuenta);") &&
              fuenteDev.Contains("return Resolver(ctx, out cuenta) == null ? null : cuenta;"));
        var rolDev = fuenteDev.Substring(fuenteDev.IndexOf("private static string Resolver(HttpContext ctx, out IdentidadWindows cuenta)"));
        rolDev = rolDev.Substring(0, rolDev.IndexOf("\n    }") + 6);
        Check("L7 Resolver: #if DEBUG ... #else return null", true,
              rolDev.Contains("#if DEBUG") && rolDev.Contains("#else\n        return null;\n#endif"));
        Check("L7 Resolver: la cuenta solo sale si la whitelist dio rol", true,
              rolDev.Contains("cuenta = null;") && rolDev.Contains("if (rol != null) cuenta = id;"));
        Check("L7 Rol: interruptor primero, despues entorno, despues la whitelist", true,
              rolDev.IndexOf("Habilitado(Config(ClaveHabilitar))") > 0 &&
              rolDev.IndexOf("Habilitado(Config(ClaveHabilitar))") < rolDev.IndexOf("Evaluar(true, true, local, Proceso.Value)") &&
              rolDev.IndexOf("Evaluar(true, true, local, Proceso.Value)") < rolDev.IndexOf("AccesoAdmin.Configurada()"));
        Check("L7 el interruptor sale del Web.config del servidor (appSettings)", true,
              fuenteDev.Contains("ConfigurationManager.AppSettings[clave]") && fuenteDev.Contains("ClaveHabilitar = \"AdminDevOverride\""));
        // Este proceso de prueba no trae la clave: el interruptor esta apagado.
        Check("L8 sin AdminDevOverride en la configuracion: apagado", false,
              AccesoDesarrolloLocal.Habilitado(System.Configuration.ConfigurationManager.AppSettings[AccesoDesarrolloLocal.ClaveHabilitar]));
        // Copiar el ejemplo a la VM no lo enciende: fuera de comentarios no
        // aparece la clave.
        var ejemplo = System.Text.RegularExpressions.Regex.Replace(File.ReadAllText("Web.config.ejemplo"), "<!--.*?-->", "",
                          System.Text.RegularExpressions.RegexOptions.Singleline);
        Check("L8 Web.config.ejemplo no trae AdminDevOverride fuera de comentarios", false, ejemplo.Contains("AdminDevOverride"));
        activo = rolDev;
        Check("L7 sin host/URL/query/cookie/header en la regla", false,
              System.Text.RegularExpressions.Regex.IsMatch(activo, @"Url|Host|QueryString|Cookies|Headers|Form|Params|ServerVariables"));

        // ---- F) quien firma la escritura (AccesoAdmin.IdentidadEscritura) ----
        // Antes: crear/modificar en IIS Express pasaban ExigirAdm con el rol
        // del atajo, pero firmaban con IdentidadWindows.DesdeContexto
        // (anonima) -> 403 SinUsuario. La firma ahora es la identidad Windows
        // real, o la cuenta que el atajo ya valido; nunca otra cosa.
        var anon = IdentidadWindows.Desde(null, false);
        var realOtro = IdentidadWindows.Desde(@"SORIANA\t_otro", true);
        var cuentaDev = AccesoDesarrolloLocal.IdentidadPara(anon, YO);
        Func<IdentidadWindows, string> txt = delegate (IdentidadWindows i) { return i == null ? "(nadie)" : i.Original; };
        Check("F1 identidad Windows real: firma ella aunque haya cuenta de desarrollo", @"SORIANA\t_otro",
              txt(AccesoAdmin.IdentidadEscrituraPara(realOtro, cuentaDev)));
        Check("F2 sin Windows auth + cuenta del atajo: firma la cuenta del atajo", YO,
              txt(AccesoAdmin.IdentidadEscrituraPara(anon, cuentaDev)));
        Check("F3 sin Windows auth y sin atajo: nadie (403 SinUsuario)", "(nadie)",
              txt(AccesoAdmin.IdentidadEscrituraPara(anon, null)));
        Check("F3 null / cuenta no autenticada: nadie", "(nadie)|(nadie)",
              txt(AccesoAdmin.IdentidadEscrituraPara(null, null)) + "|" + txt(AccesoAdmin.IdentidadEscrituraPara(anon, anon)));
        // Con HttpContext: aqui el atajo no aplica (ni iisexpress ni local),
        // asi que la firma es exactamente la identidad del request.
        var ctxF = Contexto("admin_iniciativas_gestion.ashx", null, YO, new StringWriter());
        Check("F4 request con Windows auth: firma su cuenta", YO, txt(AccesoAdmin.IdentidadEscritura(ctxF)));
        ctxF = Contexto("admin_iniciativas_gestion.ashx", "ADMIN_DEV_IDENTIDAD=SORIANA%5Ct_andresvr", "", new StringWriter());
        Check("F4 anonimo (con la cuenta en la query): nadie y sin cuenta del atajo", "(nadie)|(nadie)",
              txt(AccesoAdmin.IdentidadEscritura(ctxF)) + "|" + txt(AccesoDesarrolloLocal.Identidad(ctxF)));
        Check("F4 Identidad(null): nadie", "(nadie)", txt(AccesoDesarrolloLocal.Identidad(null)));
        HttpContext.Current = null;
        // El POST real de modificar con ADM de la base (produccion): pasa
        // ExigirAdm y la firma, y corta en el formato (422), sin SQL.
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "ADM");
        string metodoF;
        cuerpo = CorrerPost(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", YO,
                            new[] { new[] { "accion", "modificar" }, new[] { "folio", "" } }, out estado, out metodoF);
        Check("F5 POST modificar ADM con Windows auth: pasa rol y firma (422 de formato, sin SinUsuario)", "422|True|False",
              estado + "|" + cuerpo.Contains("ValidacionFallida") + "|" + cuerpo.Contains("SinUsuario"));
        // Anonimo y MOD siguen cortando en ExigirAdm, antes de la firma.
        cuerpo = CorrerPost(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", "",
                            new[] { new[] { "accion", "crear" } }, out estado, out metodoF);
        Check("F6 POST crear anonimo (sin atajo): 403 AccesoDenegado", "403|True", estado + "|" + cuerpo.Contains("AccesoDenegado"));
        AccesoAdmin.FuenteRoles = new FuenteFalsa().Con(YO, "MOD");
        cuerpo = CorrerPost(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", YO,
                            new[] { new[] { "accion", "crear" } }, out estado, out metodoF);
        Check("F6 POST crear MOD: 403 RolInsuficiente (sin cambios)", "403|True", estado + "|" + cuerpo.Contains("RolInsuficiente"));
        AccesoAdmin.FuenteRoles = fuente;
        // Fuente: los handlers que escriben firman con IdentidadEscritura, y
        // gestion lo resuelve antes de leer el catalogo.
        var gestion = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_gestion.ashx")).Replace("\r\n", "\n");
        var solicitudes = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes.ashx")).Replace("\r\n", "\n");
        Check("F7 gestion: firma con AccesoAdmin.IdentidadEscritura, no con IdentidadWindows.DesdeContexto", "True|False|True",
              gestion.Contains("firma = AccesoAdmin.IdentidadEscritura(context);") + "|" + gestion.Contains("IdentidadWindows.DesdeContexto") + "|" +
              gestion.Contains("servicio.Guardar(planCrear, planMod, firma.Original)"));
        Check("F7 gestion: ExigirAdm, luego firma, luego el catalogo", true,
              gestion.IndexOf("AccesoAdmin.ExigirAdm(") < gestion.IndexOf("AccesoAdmin.IdentidadEscritura(context)") &&
              gestion.IndexOf("AccesoAdmin.IdentidadEscritura(context)") < gestion.IndexOf("new GestionIniciativaAdminService()"));
        Check("F7 solicitudes: firma con AccesoAdmin.IdentidadEscritura", "True|False",
              solicitudes.Contains("AccesoAdmin.IdentidadEscritura(context)") + "|" + solicitudes.Contains("IdentidadWindows.DesdeContexto"));
        var fuenteAccF = File.ReadAllText(Path.Combine("App_Code", "AccesoAdmin.cs")).Replace("\r\n", "\n");
        var firmaFn = fuenteAccF.Substring(fuenteAccF.IndexOf("public static IdentidadWindows IdentidadEscrituraPara("));
        firmaFn = firmaFn.Substring(0, firmaFn.IndexOf("\n    }") + 6);
        Check("F8 la real va primero; la de desarrollo solo sin real", true,
              firmaFn.IndexOf("if (Firma(real)) return real;") > 0 &&
              firmaFn.IndexOf("if (Firma(real)) return real;") < firmaFn.IndexOf("Firma(desarrollo)"));

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : ("FALLOS: " + fallos));
        return fallos == 0 ? 0 : 1;
    }
}
