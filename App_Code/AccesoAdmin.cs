// Autorizacion del modulo Admin -> Iniciativas.
//
// QUIEN ENTRA
// -----------
// TODO(TEMPORAL): HOY la lista sale de AdminWhitelistTemporal (App_Code/
// AdminWhitelistTemporal.cs), no de Web.config; ver Configurada(). Lo de
// abajo describe el formato, que es el mismo.
//
// Las cuentas Windows de la clave AdminAllowedUsers de Web.config
// (appSettings), separadas por ";" (tambien se acepta ","):
//
//     <add key="AdminAllowedUsers"
//          value="SORIANA\user1;SORIANA\user2;SORIANA\user3;SORIANA\user4" />
//
// La comparacion es contra la identidad de SEGURIDAD (IdentidadWindows:
// dominio + cuenta), sin distinguir mayusculas y sin espacios. Cada entrada
// TIENE que llevar dominio: "user1" a secas se ignora, porque casaria con la
// misma cuenta de cualquier dominio. Sin la clave, o vacia, no entra nadie
// (falla cerrado).
//
// No depende de la base: ni de CatPersona ni del correo. Alguien autorizado
// entra aunque no exista en ningun catalogo. Sin tabla de seguridad, sin
// contraseñas ni secretos en la configuracion.
//
// DONDE SE APLICA (en el SERVIDOR; ocultar la entrada del menu es solo UX)
// ---------------
//   1. Cada handler de Admin -> Iniciativas llama a Exigir() antes de hacer
//      nada: 403 si no esta autorizado. No depende de Web.config.
//   2. AdminAccesoModulo (abajo), registrado en <system.webServer><modules>,
//      cubre ademas la pagina estatica admin/iniciativas.html, que ningun
//      handler sirve. Ver Web.config.ejemplo.
//
// ROL (ADM / MOD) DESPUES DE ENTRAR
// ---------------------------------
// Pasar la whitelist solo da entrada. Lo que es exclusivo de ADM (crear
// iniciativas) llama a ExigirAdm(): primero Exigir() y despues el rol de
// dbo.UsuariosAdmin (RolAdmin, App_Code/RolAdmin.cs). Quien no es ADM
// recibe 403 { "tipo": "RolInsuficiente" }. Sin fila o con la consulta
// fallando el rol es MOD: nunca ADM por error.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Web;
using System.Web.Script.Serialization;

public static class AccesoAdmin
{
    public const string ClaveConfig = "AdminAllowedUsers";

    // Lo que protege el modulo HTTP. La pagina, y TODO handler cuyo nombre
    // empiece por admin_iniciativas_ (los de hoy y los que vengan), comparado
    // sin distinguir mayusculas contra la ruta relativa a la aplicacion.
    public const string PaginaProtegida = "~/admin/iniciativas.html";
    public const string PrefijoHandlers = "~/handlers/admin_iniciativas_";

    // La lista ya leida y normalizada: "dominio\cuenta" en minusculas.
    public sealed class ListaAutorizados
    {
        private readonly HashSet<string> _cuentas = new HashSet<string>(StringComparer.Ordinal);

        public int Ignoradas { get; private set; }
        public int Total { get { return _cuentas.Count; } }

        public static ListaAutorizados Leer(string crudo)
        {
            var lista = new ListaAutorizados();
            foreach (var parte in (crudo ?? string.Empty).Split(new[] { ';', ',' }))
            {
                if (parte.Trim().Length == 0) continue;

                string dominio, usuario;
                IdentidadWindows.Separar(parte, out dominio, out usuario);
                if (dominio == null || usuario == null) { lista.Ignoradas++; continue; }

                lista._cuentas.Add(dominio + "\\" + usuario);
            }
            return lista;
        }

        public bool Permite(IdentidadWindows id)
        {
            if (id == null || !id.Autenticada || id.Dominio == null || id.Usuario == null)
                return false;
            return _cuentas.Contains(id.Dominio + "\\" + id.Usuario);
        }
    }

    // TODO(TEMPORAL): mientras no haya autorizacion en base, la lista es la
    // de AdminWhitelistTemporal y NO la de Web.config (AdminAllowedUsers se
    // ignora: el Web.config desplegado no esta a nuestro alcance). Al pasar
    // a autorizacion DB-backed, cambiar esta linea y borrar ese archivo.
    public static ListaAutorizados Configurada()
    {
        return ListaAutorizados.Leer(AdminWhitelistTemporal.Cuentas);
    }

    public static bool EstaAutorizado(IdentidadWindows id)
    {
        return Configurada().Permite(id);
    }

    // La entrada a Admin para el request en curso: el atajo de desarrollo
    // local (AccesoDesarrolloLocal: DEBUG + request local + IIS Express) o,
    // como siempre, la identidad Windows real contra la whitelist.
    public static bool PuedeEntrar(HttpContext context)
    {
        if (AccesoDesarrolloLocal.Activo(context)) return true;   // SOLO DESARROLLO LOCAL
        return EstaAutorizado(IdentidadWindows.DesdeContexto(context));
    }

    public static bool EsRutaProtegida(string rutaRelativa)
    {
        if (string.IsNullOrEmpty(rutaRelativa)) return false;
        return string.Equals(rutaRelativa, PaginaProtegida, StringComparison.OrdinalIgnoreCase)
            || rutaRelativa.StartsWith(PrefijoHandlers, StringComparison.OrdinalIgnoreCase);
    }

    // Para los handlers: true si sigue; si no, ya respondio 403 en JSON
    // ({error, tipo}, el contrato de DashboardHandler) y hay que salir.
    public static bool Exigir(HttpContext context)
    {
        if (PuedeEntrar(context)) return true;
        Rechazar(context, true);
        return false;
    }

    // De donde sale el rol. La real lee dbo.UsuariosAdmin; las pruebas
    // ponen una propia para no necesitar SQL Server. Nada del sitio la
    // cambia.
    public static IFuenteRolesAdmin FuenteRoles = new FuenteRolesAdminSql();

    // El rol de quien hace el request (ADM o MOD), resuelto cada vez. No
    // revisa la whitelist: llamarlo despues de Exigir/EstaAutorizado.
    public static string Rol(HttpContext context)
    {
        if (AccesoDesarrolloLocal.Activo(context)) return RolAdmin.Adm;   // SOLO DESARROLLO LOCAL
        return RolAdmin.Para(IdentidadWindows.DesdeContexto(context), FuenteRoles,
            delegate (Exception ex) { DashboardHandler.Registrar("AccesoAdmin.Rol", ex); });
    }

    // Para lo que es solo de ADM: whitelist y ademas rol ADM. true si sigue;
    // si no, ya respondio 403 y hay que salir.
    public static bool ExigirAdm(HttpContext context)
    {
        if (!Exigir(context)) return false;
        if (Rol(context) == RolAdmin.Adm) return true;

        var r = context.Response;
        r.Clear();
        r.StatusCode = 403;
        r.TrySkipIisCustomErrors = true;
        r.Cache.SetCacheability(HttpCacheability.NoCache);
        r.ContentType = "application/json; charset=utf-8";
        r.Write(new JavaScriptSerializer().Serialize(new Dictionary<string, object>
        {
            { "error", "Solo un administrador (ADM) puede crear iniciativas." },
            { "tipo", "RolInsuficiente" },
        }));
        return false;
    }

    public static void Rechazar(HttpContext context, bool json)
    {
        var r = context.Response;
        r.Clear();
        r.StatusCode = 403;
        r.TrySkipIisCustomErrors = true;
        r.Cache.SetCacheability(HttpCacheability.NoCache);

        const string Mensaje = "No tienes acceso a la administracion de iniciativas.";
        if (json)
        {
            r.ContentType = "application/json; charset=utf-8";
            r.Write(new JavaScriptSerializer().Serialize(new Dictionary<string, object>
            {
                { "error", Mensaje },
                { "tipo", "AccesoDenegado" },
            }));
        }
        else
        {
            r.ContentType = "text/html; charset=utf-8";
            r.Write("<!doctype html><meta charset=\"utf-8\"><title>Acceso restringido</title>" +
                    "<p>" + Mensaje + "</p><p><a href=\"../dashboard.html\">Volver al tablero</a></p>");
        }
    }
}

// Protege la pagina estatica y, de paso, los handlers (segunda capa). Va sin
// preCondition="managedHandler" en Web.config para que corra tambien con los
// archivos estaticos. Si no se registra, los handlers siguen protegidos por
// Exigir(); solo la pagina (sin datos) quedaria a la vista.
public sealed class AdminAccesoModulo : IHttpModule
{
    public void Init(HttpApplication app)
    {
        app.AuthorizeRequest += delegate (object sender, EventArgs e)
        {
            var ctx = ((HttpApplication)sender).Context;
            var ruta = ctx.Request.AppRelativeCurrentExecutionFilePath;
            if (!AccesoAdmin.EsRutaProtegida(ruta)) return;
            if (AccesoAdmin.PuedeEntrar(ctx)) return;

            var esHandler = ruta.EndsWith(".ashx", StringComparison.OrdinalIgnoreCase);
            AccesoAdmin.Rechazar(ctx, esHandler);
            ((HttpApplication)sender).CompleteRequest();
        };
    }

    public void Dispose() { }
}
