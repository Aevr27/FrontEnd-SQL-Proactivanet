// =====================================================================
// SOLO DESARROLLO LOCAL - Admin -> Iniciativas como ADM sin Windows Auth
// =====================================================================
//
// IIS Express (dev-local.cmd) no tiene Autenticacion de Windows: todo request
// llega anonimo y Admin responderia 403. Para poder trabajar en local sin
// credenciales ni argumentos, en ESTE caso y solo en este el request se trata
// como ADM: se salta la whitelist y la consulta de rol a dbo.UsuariosAdmin.
//
// SE ACTIVA SOLO SI SE CUMPLEN LAS TRES A LA VEZ
//   1. Compilado en DEBUG. El sitio se compila en el servidor desde el
//      fuente y ASP.NET define DEBUG solo con <compilation debug="true"> en
//      Web.config (verificado en IIS Express). Con debug="false" el cuerpo
//      de Activo() ni siquiera se compila: devuelve false.
//   2. Request.IsLocal: el cliente es la misma maquina (loopback). Lo decide
//      la direccion de la conexion, no el host, la URL, cookies, headers ni
//      nada que mande el navegador.
//   3. El proceso es IIS Express (iisexpress.exe). En la VM el sitio corre en
//      IIS (w3wp.exe): aunque alguien dejara debug="true" en su Web.config y
//      abriera el sitio desde la propia VM (o hubiera un proxy local), aqui no
//      entra.
//
// Fuera de este caso NADA cambia: identidad Windows real -> whitelist
// temporal (AdminWhitelistTemporal) -> dbo.UsuariosAdmin -> rol.
//
// PARA QUITARLO: borrar este archivo y las llamadas a
// AccesoDesarrolloLocal.Activo en AccesoAdmin.cs y admin_sesion.ashx.

using System;
using System.Diagnostics;
using System.Web;

public static class AccesoDesarrolloLocal
{
    public const string ProcesoIisExpress = "iisexpress";

#if DEBUG
    public const bool CompiladoEnDebug = true;
#else
    public const bool CompiladoEnDebug = false;
#endif

    // La regla, sin HttpContext, para probarla con cada combinacion.
    public static bool Evaluar(bool compiladoEnDebug, bool esLocal, string proceso)
    {
        return compiladoEnDebug
            && esLocal
            && string.Equals(proceso, ProcesoIisExpress, StringComparison.OrdinalIgnoreCase);
    }

    // El request en curso. En un build sin DEBUG siempre es false.
    public static bool Activo(HttpContext ctx)
    {
#if DEBUG
        if (ctx == null) return false;
        bool local;
        try { local = ctx.Request.IsLocal; }
        catch { local = false; }
        return Evaluar(true, local, Proceso.Value);
#else
        return false;
#endif
    }

#if DEBUG
    private static readonly Lazy<string> Proceso = new Lazy<string>(delegate
    {
        try { return Process.GetCurrentProcess().ProcessName; }
        catch { return null; }
    });
#endif
}
