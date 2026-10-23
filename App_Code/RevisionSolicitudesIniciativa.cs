// ADM aprueba o rechaza una Nueva solicitud (sql/31). Vista "Iniciativas"
// de la pestaña Solicitudes (admin/solicitudes-nuevas.js), por
// handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx (ExigirAdm,
// solo POST). La lectura sigue en RegistroSolicitudesIniciativa (GET, solo
// lectura).
//
//   Aprobar(n, revisor, comentario)   adm.usp_SolicitudIniciativa_Aprobar
//   Rechazar(n, revisor, comentario)  adm.usp_SolicitudIniciativa_Rechazar
//
// APROBADA = aprobada para que ADM cree la iniciativa a mano (Administracion
// -> Crear): no se crea ni se toca ninguna iniciativa. APROBADA y RECHAZADA
// son finales. Sin correos ni avisos. El revisor lo pone el handler con la
// identidad Windows del servidor (AccesoAdmin.IdentidadEscritura), nunca el
// navegador. Aparte de Cambios (sql/22): no usa nada de SolicitudCambioAdmin.
//
// Se prueba sin SQL en tools/tests/RevisionSolicitudesIniciativaHttpSmoke.cs
// y contra LocalDB en tools/tests/RevisionSolicitudesIniciativaSqlLocalDbSmoke.cs.

using System;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public interface IRevisorSolicitudesIniciativa
{
    // Los dos procedimientos de sql/31 en la base. Un error de conexion se lanza.
    bool Disponible();
    // Devuelven la fecha de la revision (UTC). ErrorRevisionSolicitudIniciativa
    // si la base la rechaza a proposito (51410-51413).
    DateTime Aprobar(int numero, string revisor, string comentario);
    DateTime Rechazar(int numero, string revisor, string comentario);
}

// Un error que la base lanzo a proposito (51410-51413).
public sealed class ErrorRevisionSolicitudIniciativa : Exception
{
    public readonly int Numero;
    public ErrorRevisionSolicitudIniciativa(int numero, string mensaje) : base(mensaje) { Numero = numero; }

    public int EstadoHttp
    {
        get
        {
            if (Numero == 51411) return 404;
            if (Numero == 51412) return 409;
            if (Numero == 51413) return 422;
            return 400;
        }
    }

    public string Tipo
    {
        get
        {
            if (Numero == 51410) return "SinRevisor";
            if (Numero == 51411) return "SolicitudNoExiste";
            if (Numero == 51412) return "YaRevisada";
            if (Numero == 51413) return "FaltaMotivo";
            return "RevisionRechazada";
        }
    }
}

public sealed class RevisorSolicitudesIniciativaSql : IRevisorSolicitudesIniciativa
{
    private readonly Func<SqlConnection> abrir;
    public RevisorSolicitudesIniciativaSql() : this(null) { }
    public RevisorSolicitudesIniciativaSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    private SqlConnection Abierta()
    {
        var cn = abrir();
        if (cn.State != ConnectionState.Open) cn.Open();
        return cn;
    }

    public const string ConsultaProcedimientos =
        "SELECT CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P') IS NOT NULL THEN 1 ELSE 0 END";

    public bool Disponible()
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand(ConsultaProcedimientos, cn) { CommandTimeout = 15 })
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    public DateTime Aprobar(int numero, string revisor, string comentario)
    {
        return Ejecutar("adm.usp_SolicitudIniciativa_Aprobar", numero, revisor, comentario);
    }

    public DateTime Rechazar(int numero, string revisor, string comentario)
    {
        return Ejecutar("adm.usp_SolicitudIniciativa_Rechazar", numero, revisor, comentario);
    }

    private DateTime Ejecutar(string procedimiento, int numero, string revisor, string comentario)
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand(procedimiento, cn) { CommandType = CommandType.StoredProcedure, CommandTimeout = 30 })
        {
            cmd.Parameters.Add("@NumeroSolicitud", SqlDbType.Int).Value = numero;
            cmd.Parameters.Add("@Revisor", SqlDbType.NVarChar, 256).Value = (object)revisor ?? DBNull.Value;
            cmd.Parameters.Add("@Comentario", SqlDbType.NVarChar, 4000).Value = (object)comentario ?? DBNull.Value;
            var fecha = cmd.Parameters.Add("@FechaRevisionUtc", SqlDbType.DateTime2);
            fecha.Direction = ParameterDirection.Output;
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex)
            {
                if (ex.Number >= 51410 && ex.Number <= 51413) throw new ErrorRevisionSolicitudIniciativa(ex.Number, ex.Message);
                throw;
            }
            return DateTime.SpecifyKind((DateTime)fecha.Value, DateTimeKind.Utc);
        }
    }
}

// Lo que el handler usa; las pruebas lo cambian por uno falso.
public static class RevisionSolicitudesIniciativa
{
    public static IRevisorSolicitudesIniciativa Revisor = new RevisorSolicitudesIniciativaSql();

    // Cabe entero en SolicitudIniciativaEvento.Detalle (nvarchar(2000)): la
    // bitacora guarda el mismo comentario que la solicitud, sin cortar.
    public const int MaximoComentario = 2000;

    public const string MensajeSoloAdm = "Solo un administrador (ADM) puede aprobar o rechazar solicitudes de iniciativa.";
    public const string MotivoSinRevision =
        "Aprobar o rechazar todavía no está habilitado (falta aplicar sql/31 en la base, con su aprobación). No se cambió nada.";
    public const string MensajeFaltaMotivo = "Escribe por qué se rechaza.";
    public const string MensajeComentarioLargo = "El comentario no puede pasar de 2000 caracteres.";
}
