// Prueba offline del interruptor IniciativasAbiertas
// (App_Code/AccesoIniciativas.cs) A TRAVES DE LOS HANDLERS reales y de
// AdminAccesoModulo.Revisar (la pagina estatica), con un HttpContext armado
// a mano: sin IIS y sin SQL Server. El rol (dbo.UsuariosAdmin) sale de una
// fuente falsa; el interruptor, de AccesoIniciativas.LeerConfig.
//
// Matriz (interruptor ENCENDIDO / APAGADO x VIEWER / ADM / MOD / anonimo):
//   C   el valor: solo "true" (sin mayusculas ni espacios) enciende.
//   V   cuenta comun (sin fila): ON entra a la pagina y a los 4 handlers de
//       Nueva solicitud (400/405/no-403: paso la puerta, no llego a SQL);
//       OFF 403 AccesoDenegado con el mensaje de "no esta abierta".
//   A/M ADM y MOD: igual en ON y en OFF; el interruptor ni se lee.
//   N   anonimo: 403 en ON y en OFF.
//   X   lo de Admin que NO es Nueva solicitud (registro, solicitudes,
//       acuse, gestion, recientes, diagnostico, correos, alta de
//       categoria, ?duenos=1, volumetria total, la pagina para un anonimo)
//       sigue 403 para la cuenta comun en ON y en OFF; el modulo tambien.
//   R   la cuenta comun sigue siendo VIEWER (no gana rol).
//   U   rutas de otros modulos del tablero: el modulo no las toca.
//   S   admin_sesion: "solicitante" segun la matriz; "autorizado" no cambia.
//   F   el fuente: los 4 handlers usan ExigirSolicitud; ningun otro handler
//       admin_* menciona AccesoIniciativas.
//
// Compilar como AccesoAdminHttpSmoke (adm.dll + hnd.dll) y correr con cwd =
// raiz del repo.
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Principal;
using System.Web;

sealed class RolesFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

public static class AccesoIniciativasHttpSmoke
{
    static int fallos = 0, pasados = 0;
    static int lecturasConfig = 0;
    static string valorConfig = null;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // null = sin usuario; "" = anonimo.
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
        try { h.ProcessRequest(ctx); }
        catch (Exception ex) { sw.Write("EXCEPCION " + ex.GetType().Name); }
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    // AdminAccesoModulo sobre una ruta: "pasa" o "403|html|AccesoDenegado".
    static string Modulo(string ruta, string cuenta)
    {
        var sw = new StringWriter();
        var ctx = Contexto("x", null, cuenta, sw);
        var sigue = AdminAccesoModulo.Revisar(ctx, ruta);
        HttpContext.Current = null;
        if (sigue) return "pasa";
        var cuerpo = sw.ToString();
        return ctx.Response.StatusCode + "|" + (cuerpo.StartsWith("<!doctype") ? "html" : "json") + "|" +
               (cuerpo.Contains("no est\u00e1 abierta") ? "cerrada" : "admin");
    }

    static bool Denegado(string cuerpo) { return cuerpo.Contains("\"tipo\":\"AccesoDenegado\""); }

    public static int Main()
    {
        const string ADM = @"SORIANA\t_adm", MOD = @"SORIANA\t_mod", COMUN = @"SORIANA\juanperez";
        var roles = new RolesFalsos();
        roles.Filas[ADM.ToUpperInvariant()] = new[] { "ADM" };
        roles.Filas[MOD.ToUpperInvariant()] = new[] { "MOD" };
        AccesoAdmin.FuenteRoles = roles;
        AccesoIniciativas.LeerConfig = delegate { lecturasConfig++; return valorConfig; };
        int estado;
        string cuerpo;

        // ---- C: el valor ------------------------------------------------
        foreach (var v in new[] { "true", "TRUE", " True " })
            Check("C1 '" + v + "' enciende", true, AccesoIniciativas.Habilitado(v));
        foreach (var v in new[] { null, "", "false", "1", "yes", "si", "truee" })
            Check("C2 '" + (v ?? "(ausente)") + "' no enciende", false, AccesoIniciativas.Habilitado(v));

        foreach (var on in new[] { true, false })
        {
            valorConfig = on ? "true" : null;
            var E = on ? "ON " : "OFF ";

            // ---- V: cuenta comun ------------------------------------------
            Check(E + "V1 pagina admin/iniciativas.html", on ? "pasa" : "403|html|cerrada", Modulo("~/admin/iniciativas.html", COMUN));
            foreach (var h in new[] { "catalogos", "capacidad", "volumetria", "validar" })
                Check(E + "V2 modulo: handler " + h, on ? "pasa" : "403|json|cerrada",
                      Modulo("~/handlers/admin_iniciativas_" + h + ".ashx", COMUN));

            cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, COMUN, out estado);
            Check(E + "V3 capacidad sin categoria", on ? "400|False" : "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, COMUN, out estado);
            Check(E + "V4 validar con GET", on ? "405|False" : "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasVolumetria(), "admin_iniciativas_volumetria.ashx", null, COMUN, out estado);
            Check(E + "V5 volumetria sin ruta", on ? "400|False" : "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "rutas=1", COMUN, out estado);
            Check(E + "V6 catalogos ?rutas=1 (ON: paso la puerta, sin SQL)", on ? "False" : "True", estado == 403);
            if (!on) Check("OFF V7 el 403 dice que no esta abierta", true, cuerpo.Contains("no est\u00e1 abierta") && Denegado(cuerpo));

            // ---- R: no gana rol -------------------------------------------
            {
                var sw = new StringWriter();
                var ctx = Contexto("x.ashx", null, COMUN, sw);
                Check(E + "R1 sigue VIEWER y PuedeEntrar false", "VIEWER|False", AccesoAdmin.Rol(ctx) + "|" + AccesoAdmin.PuedeEntrar(ctx));
                Check(E + "R2 EsSoloSolicitante", on, AccesoIniciativas.EsSoloSolicitante(ctx));
                HttpContext.Current = null;
            }

            // ---- X: el resto de Admin sigue cerrado para la cuenta comun ----
            foreach (var r in new[] { "registro", "solicitudes", "acuse", "gestion", "recientes", "diagnostico" })
                Check(E + "X1 modulo: admin_iniciativas_" + r, "403|json|admin", Modulo("~/handlers/admin_iniciativas_" + r + ".ashx", COMUN));
            var otros = new Dictionary<string, IHttpHandler>
            {
                { "admin_iniciativas_registro.ashx", new AdminIniciativasRegistro() },
                { "admin_iniciativas_solicitudes.ashx", new AdminIniciativasSolicitudes() },
                { "admin_iniciativas_acuse.ashx", new AdminIniciativasAcuse() },
                { "admin_iniciativas_gestion.ashx", new AdminIniciativasGestion() },
                { "admin_iniciativas_recientes.ashx", new AdminIniciativasRecientes() },
                { "admin_iniciativas_diagnostico.ashx", new AdminIniciativasDiagnostico() },
                { "admin_correos.ashx", new AdminCorreos() },
                { "admin_categorias_alta.ashx", new AdminCategoriasAlta() },
            };
            foreach (var kv in otros)
            {
                cuerpo = Correr(kv.Value, kv.Key, null, COMUN, out estado);
                Check(E + "X2 " + kv.Key + ": 403 AccesoDenegado", "403|True", estado + "|" + Denegado(cuerpo));
            }
            cuerpo = Correr(new AdminIniciativasCatalogos(), "admin_iniciativas_catalogos.ashx", "duenos=1", COMUN, out estado);
            Check(E + "X3 catalogos ?duenos=1 (solo ADM)", "403|True", estado + "|" + Denegado(cuerpo));
            cuerpo = Correr(new AdminIniciativasVolumetria(), "admin_iniciativas_volumetria.ashx", "alcance=total&ruta=/A", COMUN, out estado);
            Check(E + "X4 volumetria alcance=total (solo ADM)", "403|True", estado + "|" + Denegado(cuerpo));

            // ---- N: anonimo y sin usuario ----------------------------------
            foreach (var anon in new[] { "", null })
            {
                var n = anon == null ? "sin usuario" : "anonimo";
                Check(E + "N1 " + n + ": pagina", "403|html|cerrada", Modulo("~/admin/iniciativas.html", anon));
                cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, anon, out estado);
                Check(E + "N2 " + n + ": capacidad 403", "403|True", estado + "|" + Denegado(cuerpo));
                cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, anon, out estado);
                Check(E + "N3 " + n + ": validar 403", "403|True", estado + "|" + Denegado(cuerpo));
            }

            // ---- A/M: ADM y MOD, igual que siempre ------------------------
            foreach (var quien in new[] { ADM, MOD })
            {
                var q = quien == ADM ? "ADM" : "MOD";
                var antes = lecturasConfig;
                Check(E + "A1 " + q + ": pagina", "pasa", Modulo("~/admin/iniciativas.html", quien));
                cuerpo = Correr(new AdminIniciativasCapacidad(), "admin_iniciativas_capacidad.ashx", null, quien, out estado);
                Check(E + "A2 " + q + ": capacidad sin categoria 400", 400, estado);
                cuerpo = Correr(new AdminIniciativasValidar(), "admin_iniciativas_validar.ashx", null, quien, out estado);
                Check(E + "A3 " + q + ": validar GET 405", 405, estado);
                Check(E + "A4 " + q + ": registro por el modulo", "pasa", Modulo("~/handlers/admin_iniciativas_registro.ashx", quien));
                Check(E + "A5 " + q + ": el interruptor ni se lee", antes, lecturasConfig);
                cuerpo = Correr(new AdminIniciativasGestion(), "admin_iniciativas_gestion.ashx", null, quien, out estado);
                Check(E + "A6 " + q + ": gestion (solo ADM)", quien == ADM ? "False" : "True",
                      estado == 403 && cuerpo.Contains("RolInsuficiente"));
                cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, quien, out estado);
                Check(E + "S1 " + q + ": admin_sesion", "{\"autorizado\":true,\"rol\":\"" + q + "\",\"solicitante\":true}", cuerpo);
            }

            // ---- S: admin_sesion para la cuenta comun y el anonimo ---------
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, COMUN, out estado);
            Check(E + "S2 cuenta comun: admin_sesion", "{\"autorizado\":false,\"solicitante\":" + (on ? "true" : "false") + "}", cuerpo);
            cuerpo = Correr(new AdminSesion(), "admin_sesion.ashx", null, "", out estado);
            Check(E + "S3 anonimo: admin_sesion", "{\"autorizado\":false,\"solicitante\":false}", cuerpo);

            // ---- U: otros modulos del tablero -----------------------------
            foreach (var u in new[] { "~/dashboard.html", "~/handlers/kpis.ashx", "~/handlers/experiencia.ashx",
                                       "~/handlers/qa.ashx", "~/handlers/backlog_resumen.ashx", "~/experiencia/experiencia.html" })
            {
                Check(E + "U1 " + u + ": el modulo no la toca (comun)", "pasa", Modulo(u, COMUN));
                Check(E + "U2 " + u + ": el modulo no la toca (anonimo)", "pasa", Modulo(u, ""));
                Check(E + "U3 " + u + ": no es ruta de solicitante", false, AccesoIniciativas.EsRutaSolicitante(u));
            }
        }

        // ---- F: el fuente ----------------------------------------------
        foreach (var h in new[] { "catalogos", "capacidad", "volumetria", "validar" })
        {
            var t = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_" + h + ".ashx"));
            Check("F1 " + h + " usa ExigirSolicitud y no Exigir a secas", "True|False",
                  t.Contains("AccesoIniciativas.ExigirSolicitud(context)") + "|" + t.Contains("AccesoAdmin.Exigir(context)"));
        }
        foreach (var f in Directory.GetFiles("handlers", "admin_*.ashx"))
        {
            var n = Path.GetFileName(f);
            if (n == "admin_iniciativas_catalogos.ashx" || n == "admin_iniciativas_capacidad.ashx" ||
                n == "admin_iniciativas_volumetria.ashx" || n == "admin_iniciativas_validar.ashx" || n == "admin_sesion.ashx") continue;
            Check("F2 " + n + " no mira el interruptor", false, File.ReadAllText(f).Contains("AccesoIniciativas"));
        }
        Check("F3 son exactamente 5 rutas de solicitante (pagina + 4)", 5, AccesoIniciativas.RutasSolicitante.Length);

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
