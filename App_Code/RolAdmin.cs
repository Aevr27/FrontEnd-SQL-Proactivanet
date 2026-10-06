// Rol dentro de Admin -> Iniciativas: ADM o MOD.
//
// ORDEN (cada request, sin cache)
// -------------------------------
//   1. Identidad: IdentidadWindows (IIS Windows Auth).
//   2. Entrada: AccesoAdmin.Exigir (whitelist temporal). Sin pasarla no hay
//      rol que resolver: 403.
//   3. Rol: dbo.UsuariosAdmin.Acceso de esa cuenta (esta clase).
//   4. Permiso: AccesoAdmin.ExigirAdm para lo que es solo de ADM (crear
//      iniciativas: admin_iniciativas_validar y admin_iniciativas_capacidad).
//
// REGLA (falla hacia el MENOR privilegio)
// ---------------------------------------
//   ADM  solo si la cuenta tiene al menos una fila en dbo.UsuariosAdmin y
//        TODAS sus filas dicen Acceso = 'ADM' (la tabla no tiene llave
//        unica: un duplicado con 'MOD' u otro valor no da ADM).
//   MOD  todo lo demas: sin fila, valor raro, consulta que falla, sin
//        identidad. Nunca se concede ADM por un error.
//
// La cuenta se compara con IdentidadWindows.Original contra Usuario, sin
// espacios a los lados y sin distinguir mayusculas ("SORIANA\cuenta"; el
// diagnostico de la VM confirmo que la tabla guarda ese formato).
//
// DESARROLLO LOCAL: no pasa por aqui. AccesoAdmin.Rol devuelve ADM antes de
// llamar a esta clase cuando AccesoDesarrolloLocal.Activo (DEBUG + request
// local + IIS Express). Ver App_Code/AccesoDesarrolloLocal.cs.
//
// La fuente de roles es una interfaz para probar sin SQL Server
// (tools/tests/IdentidadAdminSmoke.cs y AccesoAdminHttpSmoke.cs).

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

// Los valores de Acceso de las filas de una cuenta, tal como estan. Lanza si
// no puede leerlos (eso cuenta como MOD, no como ADM).
public interface IFuenteRolesAdmin
{
    IList<string> AccesosDe(string cuenta);
}

// La real: SELECT sobre dbo.UsuariosAdmin (solo lectura).
public sealed class FuenteRolesAdminSql : IFuenteRolesAdmin
{
    public IList<string> AccesosDe(string cuenta)
    {
        const string sql = @"
SELECT Acceso
FROM dbo.UsuariosAdmin
WHERE UPPER(LTRIM(RTRIM(Usuario))) = UPPER(LTRIM(RTRIM(@cuenta)));";

        var salida = new List<string>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand(sql, cn))
        {
            cmd.CommandType = CommandType.Text;
            cmd.Parameters.Add("@cuenta", SqlDbType.NVarChar, 256).Value = cuenta ?? string.Empty;
            cn.Open();
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                    salida.Add(reader.IsDBNull(0) ? null : Convert.ToString(reader.GetValue(0), CultureInfo.InvariantCulture));
            }
        }
        return salida;
    }
}

public static class RolAdmin
{
    public const string Adm = "ADM";
    public const string Mod = "MOD";

    // ADM solo si hay filas y todas son ADM.
    public static string Resolver(IEnumerable<string> accesos)
    {
        if (accesos == null) return Mod;
        var hay = false;
        foreach (var a in accesos)
        {
            hay = true;
            if (!string.Equals(Limpio(a), Adm, StringComparison.Ordinal)) return Mod;
        }
        return hay ? Adm : Mod;
    }

    // La regla completa, sin HttpContext. `registrar` recibe el error de la
    // fuente (puede ser null).
    public static string Para(IdentidadWindows id, IFuenteRolesAdmin fuente, Action<Exception> registrar)
    {
        if (id == null || !id.Autenticada) return Mod;
        return Para(id.Original, fuente, registrar);
    }

    public static string Para(string cuenta, IFuenteRolesAdmin fuente, Action<Exception> registrar)
    {
        if (string.IsNullOrWhiteSpace(cuenta)) return Mod;
        if (fuente == null) return Mod;
        try
        {
            return Resolver(fuente.AccesosDe(cuenta.Trim()));
        }
        catch (Exception ex)
        {
            if (registrar != null) registrar(ex);
            return Mod;
        }
    }

    private static string Limpio(string s)
    {
        return s == null ? null : s.Trim().ToUpperInvariant();
    }
}
