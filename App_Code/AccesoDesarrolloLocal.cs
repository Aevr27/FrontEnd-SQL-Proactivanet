// =====================================================================
// SOLO DESARROLLO LOCAL - Admin -> Iniciativas sin Windows Auth
// =====================================================================
//
// IIS Express (dev-local.cmd) no tiene Autenticacion de Windows: todo request
// llega anonimo y Admin responderia 403. Para trabajar en local, la cuenta de
// desarrollo la declara QUIEN ARRANCA el servidor (variable de entorno del
// proceso ADMIN_DEV_IDENTIDAD, que pone dev-local.cmd; por omision
// SORIANA\t_andresvr) y tiene que estar en la whitelist de desarrollo
// (AdminWhitelistTemporal). Solo entonces el request recibe el rol de
// desarrollo (ADMIN_DEV_ROL: ADM por omision, o MOD) sin consultar
// dbo.UsuariosAdmin. Restaura el comportamiento anterior a 9dcb71c (cuenta
// simulada + whitelist), dentro de la puerta de entorno que puso 9dcb71c.
//
// EL ENTORNO: LAS CUATRO A LA VEZ
//   0. Interruptor explicito, APAGADO por omision: la clave
//      <add key="AdminDevOverride" value="true" /> en appSettings del
//      Web.config LOCAL (esta en .gitignore). Ausente, vacia o cualquier
//      otro valor ("1", "yes", "True " con basura...) = apagado. Solo se
//      acepta "true" (sin distinguir mayusculas, sin espacios alrededor).
//      Web.config.ejemplo NO la trae: copiar el ejemplo a la VM no la
//      enciende; y aunque alguien la copiara alli, 1-3 la siguen cortando.
//   1. Compilado en DEBUG. El sitio se compila en el servidor desde el
//      fuente y ASP.NET define DEBUG solo con <compilation debug="true"> en
//      Web.config (verificado en IIS Express). Con debug="false" el cuerpo
//      de Activo()/Rol() ni siquiera se compila: no hay atajo.
//   2. Request.IsLocal: el cliente es la misma maquina (loopback). Lo decide
//      la direccion de la conexion, no el host, la URL, cookies, headers ni
//      nada que mande el navegador.
//   3. El proceso es IIS Express. En la VM el sitio corre en IIS (w3wp.exe):
//      aunque alguien dejara debug="true" en su Web.config y abriera el
//      sitio desde la propia VM (o hubiera un proxy local), aqui no entra.
//
// Y ADEMAS LA CUENTA
//   4. La identidad real del request si IIS Express autentico a alguien; si
//      no, la de ADMIN_DEV_IDENTIDAD (entorno del PROCESO, no del request).
//   5. Esa cuenta esta en AdminWhitelistTemporal. Otra cuenta, sin dominio,
//      o sin variable: no hay atajo y sigue la regla normal (anonimo ->
//      VIEWER -> 403). ADMIN_DEV_ROL con un valor que no sea ADM ni MOD:
//      tampoco (falla cerrado).
//
// Nada de esto lo puede activar el navegador: no se lee ningun header,
// query, cookie ni formulario. Fuera de este caso NADA cambia: identidad
// Windows real -> dbo.UsuariosAdmin -> rol; la whitelist no interviene.
//
// Alcance: solo el ROL de Admin del request (ADM o MOD) en esta maquina. No
// toca la cadena de conexion ni los permisos SQL (la web sigue con su cuenta
// de servicio), no salta validaciones de los handlers, no escribe en
// dbo.UsuariosAdmin ni cambia el rol de nadie mas. Lo que escribe a la base
// lo firma AccesoAdmin.IdentidadEscritura: la identidad Windows real si la
// hay; si no, la cuenta de desarrollo que el atajo ya valido (Identidad()),
// nunca algo que mande el navegador. Sin ninguna de las dos: 403 SinUsuario.
//
// PARA QUITARLO: borrar este archivo, las llamadas a AccesoDesarrolloLocal
// en AccesoAdmin.cs y admin_sesion.ashx, y los argumentos de dev-local.cmd.

using System;
using System.Configuration;
using System.Diagnostics;
using System.Web;

public static class AccesoDesarrolloLocal
{
    public const string ProcesoIisExpress = "iisexpress";
    public const string VariableIdentidad = "ADMIN_DEV_IDENTIDAD";
    public const string VariableRol = "ADMIN_DEV_ROL";
    public const string ClaveHabilitar = "AdminDevOverride";

#if DEBUG
    public const bool CompiladoEnDebug = true;
#else
    public const bool CompiladoEnDebug = false;
#endif

    // El interruptor (0): solo "true" lo enciende; todo lo demas, apagado.
    public static bool Habilitado(string valorConfig)
    {
        return string.Equals((valorConfig ?? string.Empty).Trim(), "true", StringComparison.OrdinalIgnoreCase);
    }

    // El entorno (0-3), sin HttpContext, para probarlo con cada combinacion.
    public static bool Evaluar(bool habilitado, bool compiladoEnDebug, bool esLocal, string proceso)
    {
        return habilitado
            && compiladoEnDebug
            && esLocal
            && string.Equals(proceso, ProcesoIisExpress, StringComparison.OrdinalIgnoreCase);
    }

    // La regla completa (1-5), sin HttpContext: el rol de desarrollo (ADM o
    // MOD) o null = sin atajo, regla normal.
    public static string RolPara(bool entorno, IdentidadWindows identidad,
                                 AccesoAdmin.ListaAutorizados whitelist, string rolConfigurado)
    {
        if (!entorno || whitelist == null || !whitelist.Permite(identidad)) return null;
        var rol = (rolConfigurado ?? string.Empty).Trim().ToUpperInvariant();
        if (rol.Length == 0) return RolAdmin.Adm;
        return rol == RolAdmin.Adm || rol == RolAdmin.Mod ? rol : null;
    }

    // La cuenta de desarrollo (4): la real si IIS Express autentico a
    // alguien; si no, la que declaro quien arranco el proceso.
    public static IdentidadWindows IdentidadPara(IdentidadWindows real, string declarada)
    {
        if (real != null && real.Autenticada) return real;
        if (string.IsNullOrWhiteSpace(declarada)) return real ?? IdentidadWindows.Desde(null, false);
        return IdentidadWindows.Desde(declarada.Trim(), true);
    }

    // El rol de desarrollo para el request en curso, o null. En un build sin
    // DEBUG siempre es null.
    public static string Rol(HttpContext ctx)
    {
        IdentidadWindows cuenta;
        return Resolver(ctx, out cuenta);
    }

    // La cuenta a la que el atajo dio el rol (la MISMA que paso por la
    // whitelist en Resolver), para firmar lo que se escribe cuando IIS
    // Express no trae identidad Windows; null si el atajo no aplica. En un
    // build sin DEBUG siempre es null.
    public static IdentidadWindows Identidad(HttpContext ctx)
    {
        IdentidadWindows cuenta;
        return Resolver(ctx, out cuenta) == null ? null : cuenta;
    }

    // Rol y cuenta salen de una sola evaluacion: no hay forma de obtener la
    // cuenta sin haber pasado interruptor, entorno y whitelist.
    private static string Resolver(HttpContext ctx, out IdentidadWindows cuenta)
    {
        cuenta = null;
#if DEBUG
        if (ctx == null) return null;
        if (!Habilitado(Config(ClaveHabilitar))) return null;
        bool local;
        try { local = ctx.Request.IsLocal; }
        catch { local = false; }
        if (!Evaluar(true, true, local, Proceso.Value)) return null;
        var id = IdentidadPara(IdentidadWindows.DesdeContexto(ctx), Entorno(VariableIdentidad));
        var rol = RolPara(true, id, AccesoAdmin.Configurada(), Entorno(VariableRol));
        if (rol != null) cuenta = id;
        return rol;
#else
        return null;
#endif
    }

    // true si el request en curso entra por el atajo de desarrollo local.
    public static bool Activo(HttpContext ctx)
    {
        return Rol(ctx) != null;
    }

#if DEBUG
    private static readonly Lazy<string> Proceso = new Lazy<string>(delegate
    {
        try { return Process.GetCurrentProcess().ProcessName; }
        catch { return null; }
    });

    private static string Config(string clave)
    {
        try { return ConfigurationManager.AppSettings[clave]; }
        catch { return null; }
    }

    private static string Entorno(string variable)
    {
        try { return Environment.GetEnvironmentVariable(variable); }
        catch { return null; }
    }
#endif
}
