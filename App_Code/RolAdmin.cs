// Rol dentro de Admin -> Iniciativas: ADM, MOD o VIEWER.
//
// ORDEN (cada request, sin cache)
// -------------------------------
//   1. Identidad: IdentidadWindows (IIS Windows Auth).
//   2. (Ya no hay whitelist en el camino desde 2026-10-09; ver AccesoAdmin.)
//   3. Rol: dbo.UsuariosAdmin.Acceso de esa cuenta (esta clase). Sin
//      identidad autenticada no se consulta: VIEWER.
//   4. Entrada: AccesoAdmin.Exigir deja pasar solo ADM o MOD; VIEWER recibe
//      403 en la pagina y en todo handler admin_iniciativas_*.
//   5. Permiso: AccesoAdmin.ExigirAdm para lo que es solo de ADM (hoy la
//      consola de correos, admin_correos; y la creacion directa cuando tenga
//      handler). Nueva solicitud (admin_iniciativas_validar y
//      admin_iniciativas_capacidad) es de ADM y MOD: Exigir.
//
// REGLA (falla hacia el MENOR privilegio)
// ---------------------------------------
//   ADM     solo si la cuenta tiene al menos una fila en dbo.UsuariosAdmin y
//           TODAS sus filas dicen Acceso = 'ADM' (la tabla no tiene llave
//           unica: un duplicado con 'MOD' no da ADM).
//   MOD     hay filas, todas son ADM o MOD y al menos una es MOD.
//   VIEWER  todo lo demas: sin fila, algun valor que no es ADM ni MOD
//           (NULL incluido), consulta que falla, sin identidad. VIEWER no
//           entra a Admin. Nunca se concede ADM ni MOD por un error ni por
//           falta de fila (antes, sin fila se caia a MOD: quitado).
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
// no puede leerlos (eso cuenta como VIEWER: sin acceso).
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
    public const string Viewer = "VIEWER";

    // ADM o MOD: los unicos roles que entran a Admin.
    public static bool EsElevado(string rol)
    {
        return string.Equals(rol, Adm, StringComparison.Ordinal)
            || string.Equals(rol, Mod, StringComparison.Ordinal);
    }

    // Sin filas o con algun valor que no sea ADM/MOD: VIEWER. Todas ADM:
    // ADM. Si no (ADM y MOD, o solo MOD): MOD.
    public static string Resolver(IEnumerable<string> accesos)
    {
        if (accesos == null) return Viewer;
        var hay = false;
        var todasAdm = true;
        foreach (var a in accesos)
        {
            hay = true;
            var v = Limpio(a);
            if (string.Equals(v, Adm, StringComparison.Ordinal)) continue;
            if (string.Equals(v, Mod, StringComparison.Ordinal)) { todasAdm = false; continue; }
            return Viewer;
        }
        if (!hay) return Viewer;
        return todasAdm ? Adm : Mod;
    }

    // La regla completa, sin HttpContext. `registrar` recibe el error de la
    // fuente (puede ser null).
    public static string Para(IdentidadWindows id, IFuenteRolesAdmin fuente, Action<Exception> registrar)
    {
        if (id == null || !id.Autenticada) return Viewer;
        return Para(id.Original, fuente, registrar);
    }

    public static string Para(string cuenta, IFuenteRolesAdmin fuente, Action<Exception> registrar)
    {
        if (string.IsNullOrWhiteSpace(cuenta)) return Viewer;
        if (fuente == null) return Viewer;
        try
        {
            return Resolver(fuente.AccesosDe(cuenta.Trim()));
        }
        catch (Exception ex)
        {
            if (registrar != null) registrar(ex);
            return Viewer;
        }
    }

    private static string Limpio(string s)
    {
        return s == null ? null : s.Trim().ToUpperInvariant();
    }
}
