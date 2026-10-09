// Autorizacion del modulo Admin -> Iniciativas.
//
// REGLA VIGENTE (2026-10-09): la PUERTA es el rol de dbo.UsuariosAdmin
// (RolAdmin): ADM o MOD entran, todo lo demas (VIEWER, sin fila, valor
// raro, consulta fallida, sin identidad Windows) no. La whitelist de abajo
// YA NO es puerta: EstaAutorizado/Configurada siguen existiendo pero
// PuedeEntrar no las llama. En local manda el atajo AccesoDesarrolloLocal,
// igual que antes. Lo que sigue describe la whitelist como referencia.
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
// ROL (ADM / MOD / VIEWER)
// ------------------------
// Entrar exige un rol ADM o MOD en dbo.UsuariosAdmin (RolAdmin,
// App_Code/RolAdmin.cs) para la identidad Windows del request. Sin fila,
// con un valor que no es ADM ni MOD, sin identidad o con la consulta
// fallando, el rol es VIEWER y Exigir() responde 403 AccesoDenegado (falla
// cerrado). Lo que es exclusivo de ADM (la consola de
// correos; la creacion directa cuando tenga handler) llama a ExigirAdm():
// quien entra como MOD recibe 403 { "tipo": "RolInsuficiente" }. Nueva
// solicitud (validar, capacidad) es de ADM y MOD: Exigir(). El rol se
// consulta una vez por request (HttpContext.Items); sin identidad
// autenticada no se consulta.

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

    // TODO(TEMPORAL): la lista es la de AdminWhitelistTemporal y NO la de
    // Web.config (AdminAllowedUsers se ignora). Desde 2026-10-09 NO decide
    // la entrada (PuedeEntrar ya no la usa); se conserva sin cambios.
    public static ListaAutorizados Configurada()
    {
        return ListaAutorizados.Leer(AdminWhitelistTemporal.Cuentas);
    }

    public static bool EstaAutorizado(IdentidadWindows id)
    {
        return Configurada().Permite(id);
    }

    // La entrada a Admin para el request en curso: el atajo de desarrollo
    // local (AccesoDesarrolloLocal: DEBUG + request local + IIS Express),
    // SIN CAMBIOS; o la identidad Windows real con rol ADM o MOD en
    // dbo.UsuariosAdmin. El rol de la base manda: la whitelist temporal ya
    // no deja fuera a un ADM/MOD ni deja entrar a nadie por su nombre.
    // VIEWER (sin fila, valor raro, error, anonimo) no entra.
    public static bool PuedeEntrar(HttpContext context)
    {
        if (AccesoDesarrolloLocal.Activo(context)) return true;   // SOLO DESARROLLO LOCAL
        return RolAdmin.EsElevado(Rol(context));
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

    private const string ClaveRolRequest = "AccesoAdmin.Rol";

    // El rol de quien hace el request (ADM, MOD o VIEWER), resuelto una vez
    // por request (HttpContext.Items: el modulo, Exigir y ExigirAdm no
    // repiten la consulta) y nunca guardado entre requests. Sin identidad
    // autenticada no consulta la base: VIEWER (RolAdmin.Para).
    public static string Rol(HttpContext context)
    {
        if (AccesoDesarrolloLocal.Activo(context)) return RolAdmin.Adm;   // SOLO DESARROLLO LOCAL
        var guardado = context == null ? null : context.Items[ClaveRolRequest] as string;
        if (guardado != null) return guardado;
        var rol = RolAdmin.Para(IdentidadWindows.DesdeContexto(context), FuenteRoles,
            delegate (Exception ex) { DashboardHandler.Registrar("AccesoAdmin.Rol", ex); });
        if (context != null) context.Items[ClaveRolRequest] = rol;
        return rol;
    }

    // Para lo que es solo de ADM: whitelist y ademas rol ADM. true si sigue;
    // si no, ya respondio 403 y hay que salir. `mensaje` cambia solo el
    // texto del 403 RolInsuficiente (p. ej. la consola de correos); la regla
    // es la misma.
    public static bool ExigirAdm(HttpContext context, string mensaje = null)
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
            { "error", mensaje ?? "Solo un administrador (ADM) puede crear iniciativas." },
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
