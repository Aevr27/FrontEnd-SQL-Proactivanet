// Aviso de la pestaña Solicitudes (admin/aviso-solicitudes.js): cuantas
// solicitudes estan PENDIENTES y cuantas de esas NO ha abierto el ADM que
// pregunta (sql/39_solicitudes_vistas.sql).
//
// PENDIENTE = adm.SolicitudCambio con Estado PENDIENTE (sql/22) + adm.
//   SolicitudIniciativa con Estado ENVIADA (sql/29): las dos colas que revisa
//   ADM en la pestaña. Se lee en cada consulta: al aplicar / aprobar /
//   rechazar deja de contar sin tocar nada aqui.
// NO VISTA = pendiente sin fila en adm.SolicitudVista para ESE usuario. Por
//   usuario: lo que abre un ADM no cambia lo de otro, ni el Estado.
// Sin sql/39 se sabe lo pendiente pero no lo visto: no_vistas = null y el
//   navegador muestra solo el punto. Sin sql/22 o sql/29, esa cola cuenta 0.
//
// USUARIO: la cuenta de IIS (AccesoAdmin.IdentidadEscritura), sin espacios y
// en minusculas (Usuario()), igual que adm.usp_SolicitudVista_Marcar.
//
// ACCESO: handlers/admin_iniciativas_aviso_solicitudes.ashx exige ADM, como
// las dos colas. Se prueba contra LocalDB en
// tools/tests/SolicitudesVistasSqlLocalDbSmoke.cs.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public sealed class ResumenAvisoSolicitudes
{
    public int PendientesCambio;
    public int PendientesNuevas;
    public int? NoVistasCambio;     // null = sin sql/39 (no se sabe)
    public int? NoVistasNuevas;
    public bool VistasDisponibles;

    public int Pendientes { get { return PendientesCambio + PendientesNuevas; } }
    public int? NoVistas
    {
        get { return VistasDisponibles ? (int?)((NoVistasCambio ?? 0) + (NoVistasNuevas ?? 0)) : null; }
    }
}

// Un error que la base lanzo a proposito (51391-51393).
public sealed class ErrorVistaSolicitud : Exception
{
    public readonly int Numero;
    public ErrorVistaSolicitud(int numero, string mensaje) : base(mensaje) { Numero = numero; }
}

public interface IAlmacenVistasSolicitud
{
    // La tabla y el procedimiento de sql/39.
    bool Disponible();
    ResumenAvisoSolicitudes Resumen(string usuario);
    // true = primera vez que ese usuario la ve.
    bool Marcar(string usuario, string tipo, int id);
}

public sealed class AlmacenVistasSql : IAlmacenVistasSolicitud
{
    private readonly Func<SqlConnection> abrir;
    public AlmacenVistasSql() : this(null) { }
    public AlmacenVistasSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    private SqlConnection Abierta()
    {
        var cn = abrir();
        if (cn.State != ConnectionState.Open) cn.Open();
        return cn;
    }

    // cambio | nuevas | vistas (sql/22 | sql/29 | sql/39), en una vuelta.
    public const string ConsultaDeteccion =
        "SELECT CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'Estado') IS NOT NULL THEN 1 ELSE 0 END, " +
        " CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'Estado') IS NOT NULL THEN 1 ELSE 0 END, " +
        " CASE WHEN OBJECT_ID(N'adm.SolicitudVista', N'U') IS NOT NULL " +
        "  AND OBJECT_ID(N'adm.usp_SolicitudVista_Marcar', N'P') IS NOT NULL THEN 1 ELSE 0 END";

    private static bool[] Detectar(SqlConnection cn)
    {
        using (var cmd = new SqlCommand(ConsultaDeteccion, cn) { CommandTimeout = 15 })
        using (var rd = cmd.ExecuteReader())
        {
            rd.Read();
            return new[] { rd.GetInt32(0) == 1, rd.GetInt32(1) == 1, rd.GetInt32(2) == 1 };
        }
    }

    public bool Disponible()
    {
        try
        {
            using (var cn = Abierta()) return Detectar(cn)[2];
        }
        catch (SqlException) { return false; }
    }

    private static string Conteo(string tabla, string llave, string pendiente, string tipo, bool vistas)
    {
        return "SELECT COUNT(*), " +
               (vistas ? "SUM(CASE WHEN v.Usuario IS NULL THEN 1 ELSE 0 END)" : "CAST(NULL AS int)") +
               " FROM " + tabla + " AS s" +
               (vistas ? " LEFT JOIN adm.SolicitudVista AS v ON v.Tipo = '" + tipo + "' AND v.IdSolicitud = s." + llave + " AND v.Usuario = @u" : "") +
               " WHERE s.Estado = '" + pendiente + "'";
    }

    private static void Contar(SqlConnection cn, string sql, string usuario, out int pendientes, out int? noVistas)
    {
        using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 30 })
        {
            cmd.Parameters.Add("@u", SqlDbType.NVarChar, 256).Value = usuario ?? "";
            using (var rd = cmd.ExecuteReader())
            {
                rd.Read();
                pendientes = rd.GetInt32(0);
                noVistas = rd.IsDBNull(1) ? (pendientes == 0 ? (int?)0 : null) : rd.GetInt32(1);
            }
        }
    }

    public ResumenAvisoSolicitudes Resumen(string usuario)
    {
        var r = new ResumenAvisoSolicitudes();
        using (var cn = Abierta())
        {
            var hay = Detectar(cn);
            // Sin usuario no se sabe que vio: solo lo pendiente.
            r.VistasDisponibles = hay[2] && !string.IsNullOrEmpty(usuario);
            int p; int? nv;
            if (hay[0])
            {
                Contar(cn, Conteo("adm.SolicitudCambio", "IdSolicitud", "PENDIENTE", "CAMBIO", r.VistasDisponibles), usuario, out p, out nv);
                r.PendientesCambio = p; r.NoVistasCambio = nv;
            }
            if (hay[1])
            {
                Contar(cn, Conteo("adm.SolicitudIniciativa", "NumeroSolicitud", "ENVIADA", "NUEVA", r.VistasDisponibles), usuario, out p, out nv);
                r.PendientesNuevas = p; r.NoVistasNuevas = nv;
            }
        }
        return r;
    }

    public bool Marcar(string usuario, string tipo, int id)
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand("adm.usp_SolicitudVista_Marcar", cn) { CommandType = CommandType.StoredProcedure })
        {
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = (object)usuario ?? DBNull.Value;
            cmd.Parameters.Add("@Tipo", SqlDbType.VarChar, 6).Value = (object)tipo ?? DBNull.Value;
            cmd.Parameters.Add("@IdSolicitud", SqlDbType.Int).Value = id;
            var nueva = cmd.Parameters.Add("@Nueva", SqlDbType.Bit); nueva.Direction = ParameterDirection.Output;
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex)
            {
                if (ex.Number >= 51391 && ex.Number <= 51393) throw new ErrorVistaSolicitud(ex.Number, ex.Message);
                throw;
            }
            return (bool)nueva.Value;
        }
    }
}

public static class AvisoSolicitudes
{
    public const string MensajeSoloAdm = "Solo un administrador (ADM) revisa las solicitudes.";

    // El handler usa este; las pruebas lo cambian por uno falso.
    public static IAlmacenVistasSolicitud Almacen = new AlmacenVistasSql();

    public static string Usuario(IdentidadWindows id)
    {
        if (id == null || !id.Autenticada || string.IsNullOrEmpty(id.Original)) return null;
        var u = id.Original.Trim().ToLowerInvariant();
        return u.Length == 0 ? null : u;
    }

    public static bool EsTipo(string tipo) { return tipo == "CAMBIO" || tipo == "NUEVA"; }

    public static Dictionary<string, object> Json(ResumenAvisoSolicitudes r)
    {
        return new Dictionary<string, object>
        {
            { "pendientes", r.Pendientes },
            { "no_vistas", r.NoVistas },
            { "vistas_disponibles", r.VistasDisponibles },
            { "cambio", new Dictionary<string, object> { { "pendientes", r.PendientesCambio }, { "no_vistas", r.VistasDisponibles ? r.NoVistasCambio : null } } },
            { "nuevas", new Dictionary<string, object> { { "pendientes", r.PendientesNuevas }, { "no_vistas", r.VistasDisponibles ? r.NoVistasNuevas : null } } },
        };
    }

    public static int Numero(string texto)
    {
        int n;
        return int.TryParse(texto, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n > 0 ? n : 0;
    }
}
