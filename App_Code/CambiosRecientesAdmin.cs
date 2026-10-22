// "Cambios recientes" de Admin/Iniciativas (pestaña Administracion, solo
// ADM): las ultimas iniciativas con un cambio REAL guardado DESDE EL
// DASHBOARD (alta directa, edicion directa o solicitud aplicada).
//
// FUENTE: adm.IniciativaProtegida.UltimoCambioUtc / UltimoCambioUsuario
// (sql/23_cambios_recientes.sql). Los sella adm.usp_GestionAdmin_Crear y
// adm.usp_GestionAdmin_Modificar en la misma transaccion que el cambio, y
// solo si algo cambio de verdad. NO cubre lo hecho en SSMS ni por la carga
// del Excel (no pasan por esos procedimientos). No es bitacora: hasta DOS
// eventos por iniciativa, los unicos que la base guarda:
//   alta       Motivo = 'ALTA' (solo lo escribe adm.usp_GestionAdmin_Crear),
//              a la hora FechaAltaUtc y por Usuario (el que la creo).
//   cambio     el ultimo sello UltimoCambioUtc / UltimoCambioUsuario, si NO
//              es el del alta (el alta sella con la misma hora, a +-1 s).
//   solicitud  ese mismo sello cuando coincide (+-1 s y mismo usuario) con
//              una adm.SolicitudCambio APLICADA de la iniciativa:
//              usp_SolicitudCambio_Aplicar llama a Modificar y marca
//              FechaRevisionUtc / RevisadoPor en la misma transaccion. Sin
//              sql/22 (sin la tabla) todo sello es "cambio".
// Antes (2026-10-21 a 10-22) solo salia el ultimo sello: una iniciativa
// creada y luego editada perdia su alta y se veia como "Cambio". No se
// inventa nada: las altas anteriores a sql/23 salen con la FechaAltaUtc y
// el Usuario que Crear ya guardo; MIGRACION y MODIFICACION no son altas.
// Las ediciones de en medio no existen en la base y no se muestran.
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
    public const string AccionAlta = "alta";
    public const string AccionCambio = "cambio";
    public const string AccionSolicitud = "solicitud";

    public string Folio;
    public DateTime FechaUtc;
    public string Usuario;
    // AccionAlta | AccionCambio | AccionSolicitud. null = el de EsAlta.
    public string Accion;
    public bool EsAlta;      // compatibilidad: true = alta cuando Accion es null

    public string AccionEfectiva { get { return Accion ?? (EsAlta ? AccionAlta : AccionCambio); } }
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
            bool conSolicitudes;
            using (var cmd = new SqlCommand(
                "SELECT CASE WHEN OBJECT_ID(N'adm.SolicitudCambio', N'U') IS NULL THEN 0 ELSE 1 END", cn))
                conSolicitudes = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
            using (var cmd = new SqlCommand(Consulta(conSolicitudes), cn))
            {
                cmd.Parameters.Add("@n", SqlDbType.Int).Value = limite;
                using (var rd = cmd.ExecuteReader())
                {
                    while (rd.Read())
                    {
                        var accion = rd.GetString(3);
                        r.Cambios.Add(new CambioRecienteAdmin
                        {
                            Folio = rd.GetString(0),
                            FechaUtc = rd.GetDateTime(1),
                            Usuario = rd.IsDBNull(2) ? null : rd.GetString(2),
                            Accion = accion,
                            EsAlta = accion == CambioRecienteAdmin.AccionAlta,
                        });
                    }
                }
            }
        }
        return r;
    }

    // Los eventos (ver la cabecera), el mas reciente primero. El alta usa
    // el sello de ms cuando es el suyo (mismo instante) y si no FechaAltaUtc
    // (datetime2(0)). Empates de hora: por Codigo y luego la accion (el
    // alta antes que su propio cambio), para que el orden no cambie entre
    // lecturas. Usuarios y Codigo con COLLATE DATABASE_DEFAULT: las dos
    // tablas no tienen por que compartir intercalacion.
    public static string Consulta(bool conSolicitudes)
    {
        const string mismoSelloQueAlta =
            "p.Motivo = 'ALTA' AND p.UltimoCambioUtc IS NOT NULL AND DATEDIFF(SECOND, p.FechaAltaUtc, p.UltimoCambioUtc) BETWEEN -1 AND 1";
        var accionSello = conSolicitudes
            ? "CASE WHEN EXISTS (SELECT 1 FROM adm.SolicitudCambio AS s " +
              "                  WHERE s.Codigo COLLATE DATABASE_DEFAULT = p.Codigo COLLATE DATABASE_DEFAULT " +
              "                    AND s.Estado = 'APLICADA' " +
              "                    AND s.RevisadoPor COLLATE DATABASE_DEFAULT = p.UltimoCambioUsuario COLLATE DATABASE_DEFAULT " +
              "                    AND DATEDIFF(SECOND, s.FechaRevisionUtc, p.UltimoCambioUtc) BETWEEN -1 AND 1) " +
              "     THEN 'solicitud' ELSE 'cambio' END"
            : "'cambio'";
        return
            "SELECT TOP (@n) e.Codigo, e.Fecha, e.Usuario, e.Accion FROM ( " +
            "  SELECT p.Codigo, CASE WHEN " + mismoSelloQueAlta + " THEN p.UltimoCambioUtc " +
            "                        ELSE CONVERT(datetime2(3), p.FechaAltaUtc) END AS Fecha, " +
            "         p.Usuario, 'alta' AS Accion " +
            "  FROM adm.IniciativaProtegida AS p WHERE p.Motivo = 'ALTA' " +
            "  UNION ALL " +
            "  SELECT p.Codigo, p.UltimoCambioUtc, p.UltimoCambioUsuario, " + accionSello + " " +
            "  FROM adm.IniciativaProtegida AS p " +
            "  WHERE p.UltimoCambioUtc IS NOT NULL AND NOT (" + mismoSelloQueAlta + ") " +
            ") AS e " +
            "ORDER BY e.Fecha DESC, e.Codigo, CASE e.Accion WHEN 'alta' THEN 1 ELSE 0 END";
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
                { "accion", c.AccionEfectiva },
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
