// "Cambios recientes" de Admin/Iniciativas (pestaña Administracion, solo
// ADM): las ultimas iniciativas con un cambio REAL guardado DESDE EL
// DASHBOARD (alta directa, edicion directa o solicitud aplicada).
//
// FUENTE: adm.IniciativaProtegida.UltimoCambioUtc / UltimoCambioUsuario
// (sql/23_cambios_recientes.sql). Los sella adm.usp_GestionAdmin_Crear y
// adm.usp_GestionAdmin_Modificar en la misma transaccion que el cambio, y
// solo si algo cambio de verdad. NO cubre lo hecho en SSMS ni por la carga
// del Excel (no pasan por esos procedimientos). No es bitacora: una fila
// por iniciativa, el ultimo cambio.
//
// Por que no otra columna: dbo.Problem no tiene fecha de modificacion;
// FechaUltimaCargaDW es la carga del Excel; FechaCierre es un dato; los
// historiales de fechas y de Estado no cubren el resto de los campos;
// FechaAltaUtc es la PRIMERA vez que Admin la toco.
//
// Sin sql/23 aplicada (columna inexistente) responde estado "sin_columna"
// y la pagina lo dice; un error de lectura se lanza (el handler da 500).
//
// SOLO LECTURA. Se prueba sin SQL en tools/tests/CambiosRecientesHttpSmoke.cs
// y contra LocalDB en tools/tests/CambiosRecientesSqlLocalDbSmoke.cs.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public sealed class CambioRecienteAdmin
{
    public string Folio;
    public DateTime FechaUtc;
    public string Usuario;
    public bool EsAlta;      // el ultimo cambio fue el alta (Motivo ALTA, sin cambios despues)
}

public sealed class LecturaCambiosRecientes
{
    public const string EstadoOk = "ok";
    public const string EstadoSinColumna = "sin_columna";

    public string Estado = EstadoOk;
    public List<CambioRecienteAdmin> Cambios = new List<CambioRecienteAdmin>();
}

public interface IFuenteCambiosRecientes
{
    LecturaCambiosRecientes Leer(int limite);
}

public sealed class FuenteCambiosRecientesSql : IFuenteCambiosRecientes
{
    private readonly Func<SqlConnection> abrir;

    public FuenteCambiosRecientesSql() : this(null) { }
    // abrir: para las pruebas (LocalDB). null = la cadena del sitio.
    public FuenteCambiosRecientesSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    public LecturaCambiosRecientes Leer(int limite)
    {
        var r = new LecturaCambiosRecientes();
        using (var cn = abrir())
        {
            if (cn.State != ConnectionState.Open) cn.Open();
            // Comando aparte: si la columna no existe, el SELECT de abajo ni
            // compilaria.
            using (var cmd = new SqlCommand(
                "SELECT CASE WHEN COL_LENGTH(N'adm.IniciativaProtegida', N'UltimoCambioUtc') IS NULL THEN 0 ELSE 1 END", cn))
            {
                if (Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 0)
                {
                    r.Estado = LecturaCambiosRecientes.EstadoSinColumna;
                    return r;
                }
            }
            // Empates de hora (datetime2(3)): por Codigo, para que el orden
            // no cambie entre lecturas. EsAlta: el sello es el del alta y no
            // hubo otro cambio despues (el alta sella con la misma hora, a
            // segundos de FechaAltaUtc).
            using (var cmd = new SqlCommand(
                "SELECT TOP (@n) Codigo, UltimoCambioUtc, UltimoCambioUsuario, " +
                "       CASE WHEN Motivo = 'ALTA' AND DATEDIFF(SECOND, FechaAltaUtc, UltimoCambioUtc) BETWEEN -1 AND 1 THEN 1 ELSE 0 END " +
                "FROM adm.IniciativaProtegida " +
                "WHERE UltimoCambioUtc IS NOT NULL " +
                "ORDER BY UltimoCambioUtc DESC, Codigo", cn))
            {
                cmd.Parameters.Add("@n", SqlDbType.Int).Value = limite;
                using (var rd = cmd.ExecuteReader())
                {
                    while (rd.Read())
                    {
                        r.Cambios.Add(new CambioRecienteAdmin
                        {
                            Folio = rd.GetString(0),
                            FechaUtc = rd.GetDateTime(1),
                            Usuario = rd.IsDBNull(2) ? null : rd.GetString(2),
                            EsAlta = Convert.ToInt32(rd.GetValue(3), CultureInfo.InvariantCulture) == 1,
                        });
                    }
                }
            }
        }
        return r;
    }
}

public static class CambiosRecientesAdmin
{
    // Lista corta a proposito: "lo ultimo que se toco", no un historial.
    public const int Limite = 10;

    public const string Alcance =
        "Solo cambios guardados desde el Dashboard (alta, edici\u00f3n o solicitud aplicada). " +
        "No incluye cambios hechos en SQL Server Management Studio ni por la carga del Excel.";

    // El handler usa esta; las pruebas la cambian por una falsa.
    public static IFuenteCambiosRecientes Fuente = new FuenteCambiosRecientesSql();

    public static Dictionary<string, object> Json(LecturaCambiosRecientes l)
    {
        var lista = new List<object>();
        foreach (var c in l.Cambios)
        {
            lista.Add(new Dictionary<string, object>
            {
                { "folio", c.Folio },
                { "fecha_utc", c.FechaUtc.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "Z" },
                { "usuario", c.Usuario },
                { "accion", c.EsAlta ? "alta" : "cambio" },
            });
        }
        return new Dictionary<string, object>
        {
            { "estado", l.Estado },
            { "limite", Limite },
            { "alcance", Alcance },
            { "cambios", lista },
        };
    }
}
