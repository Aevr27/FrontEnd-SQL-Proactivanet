// =====================================================================
// SOLO DESARROLLO LOCAL (IIS Express) - identidad simulada para Admin
// =====================================================================
//
// En local, IIS Express (dev-local.cmd) no tiene Autenticacion de Windows y
// la PC no esta en el dominio: todo request llega ANONIMO y Admin responde
// 403. Esto permite probar Admin en local SIN tocar la autorizacion:
//
//   - NO es un bypass de la whitelist: solo pone una identidad donde IIS no
//     entrego ninguna, y esa identidad pasa por AccesoAdmin igual que la
//     real (si no esta en AdminWhitelistTemporal, 403).
//   - NUNCA reemplaza una identidad real: si IIS autentico a alguien, se usa
//     esa y esto ni se consulta.
//
// SE ACTIVA SOLO SI SE CUMPLEN LAS CUATRO A LA VEZ
//   1. el proceso que hospeda el sitio es iisexpress.exe (en la VM es IIS:
//      w3wp.exe);
//   2. el request viene de la misma maquina (Request.IsLocal, loopback);
//   3. el request NO trae identidad Windows autenticada;
//   4. existe la variable de entorno ADMIN_DEV_IDENTIDAD con una cuenta
//      "DOMINIO\cuenta". Solo la pone dev-local.cmd cuando se le pasa la
//      cuenta como segundo argumento; no esta en Web.config ni en el repo.
//
// En la VM fallan al menos la 1 y la 3 (IIS + Windows Authentication), asi
// que aunque alguien definiera la variable ahi, no hace nada.
//
// PARA QUITARLO: borrar este archivo y la rama marcada "DESARROLLO LOCAL" en
// IdentidadWindows.DesdeContexto.

using System;
using System.Diagnostics;
using System.Web;

public static class IdentidadDesarrolloLocal
{
    public const string Variable = "ADMIN_DEV_IDENTIDAD";
    public const string ProcesoIisExpress = "iisexpress";

    private static readonly Lazy<string> _proceso = new Lazy<string>(delegate
    {
        try { return Process.GetCurrentProcess().ProcessName; }
        catch { return null; }
    });

    // La regla, sin HttpContext ni entorno, para probarla. Devuelve la
    // cuenta a simular o null.
    public static string Evaluar(string proceso, bool clienteLocal, bool hayIdentidadReal, string configurada)
    {
        if (hayIdentidadReal) return null;
        if (!clienteLocal) return null;
        if (!string.Equals(proceso, ProcesoIisExpress, StringComparison.OrdinalIgnoreCase)) return null;
        if (string.IsNullOrWhiteSpace(configurada)) return null;

        var cuenta = configurada.Trim();
        var barra = cuenta.LastIndexOf('\\');
        // Con dominio y cuenta, como exige la whitelist.
        if (barra <= 0 || barra == cuenta.Length - 1) return null;
        return cuenta;
    }

    // La del request en curso (solo se llama si IIS no autentico a nadie).
    public static string Para(HttpContext ctx)
    {
        if (ctx == null) return null;
        var configurada = Environment.GetEnvironmentVariable(Variable);
        if (string.IsNullOrWhiteSpace(configurada)) return null;   // lo comun: no hay nada que mirar

        bool local;
        try { local = ctx.Request.IsLocal; }
        catch { local = false; }

        return Evaluar(_proceso.Value, local, false, configurada);
    }
}
