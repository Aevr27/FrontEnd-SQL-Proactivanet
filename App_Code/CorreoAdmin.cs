// Correo de quien mira Admin -> Iniciativas, para mostrarlo en la cabecera.
//
// Fuente: dbo.UsuariosAdmin.CorreoUsuario de la MISMA fila que da el rol
// (RolAdmin: IdentidadWindows.Original contra Usuario, sin espacios a los
// lados y sin distinguir mayusculas). Es el correo capturado para esa cuenta;
// nunca se arma con la cuenta ni con el nombre (los correos corporativos no
// siguen una regla fija: CorreoCandidato es solo un candidato de busqueda).
//
// REGLA (ante la duda, nada)
//   - sin identidad autenticada, sin filas, consulta que falla: null;
//   - filas sin correo o con un valor que no parece correo: no cuentan;
//   - dos correos DISTINTOS para la misma cuenta (la tabla no tiene llave
//     unica): null, no se elige uno.
// Solo UX: no da ni quita acceso. Se prueba sin SQL con una fuente falsa
// (tools/tests/AccesoAdminHttpSmoke.cs).

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Text.RegularExpressions;

// Los CorreoUsuario de las filas de una cuenta, tal como estan. Lanza si no
// puede leerlos.
public interface IFuenteCorreoAdmin
{
    IList<string> CorreosDe(string cuenta);
}

// La real: SELECT sobre dbo.UsuariosAdmin (solo lectura).
public sealed class FuenteCorreoAdminSql : IFuenteCorreoAdmin
{
    public IList<string> CorreosDe(string cuenta)
    {
        const string sql = @"
SELECT CorreoUsuario
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

public static class CorreoAdmin
{
    public static IFuenteCorreoAdmin Fuente = new FuenteCorreoAdminSql();

    // Algo@algo.algo, sin espacios ni caracteres de marcado; el largo de la
    // columna (nvarchar(50)) con holgura.
    private static readonly Regex Forma = new Regex(@"^[^\s@<>""']+@[^\s@<>""']+\.[^\s@<>""']+$", RegexOptions.CultureInvariant);

    public static string Para(IdentidadWindows id, IFuenteCorreoAdmin fuente, Action<Exception> registrar)
    {
        if (id == null || !id.Autenticada || string.IsNullOrWhiteSpace(id.Original) || fuente == null) return null;
        IList<string> filas;
        try
        {
            filas = fuente.CorreosDe(id.Original.Trim());
        }
        catch (Exception ex)
        {
            if (registrar != null) registrar(ex);
            return null;
        }
        return Elegir(filas);
    }

    // El unico correo valido de las filas (sin distinguir mayusculas), o null.
    public static string Elegir(IEnumerable<string> filas)
    {
        if (filas == null) return null;
        string elegido = null;
        foreach (var f in filas)
        {
            var c = f == null ? null : f.Trim();
            if (string.IsNullOrEmpty(c) || c.Length > 100 || !Forma.IsMatch(c)) continue;
            if (elegido == null) { elegido = c; continue; }
            if (!string.Equals(elegido, c, StringComparison.OrdinalIgnoreCase)) return null;
        }
        return elegido;
    }
}
