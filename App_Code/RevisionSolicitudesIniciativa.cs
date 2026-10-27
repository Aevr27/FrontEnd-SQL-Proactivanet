// ADM aprueba o rechaza una Nueva solicitud (sql/31, sql/32). Vista
// "Iniciativas" de la pestaña Solicitudes (admin/solicitudes-nuevas.js), por
// handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx (ExigirAdm,
// solo POST). La lectura sigue en RegistroSolicitudesIniciativa (GET, solo
// lectura).
//
//   AprobarYCrear(n, revisor, comentario, plan)
//                                     adm.usp_SolicitudIniciativa_AprobarYCrear (sql/32)
//   Rechazar(n, revisor, comentario)  adm.usp_SolicitudIniciativa_Rechazar
//   Aprobar(n, revisor, comentario)   adm.usp_SolicitudIniciativa_Aprobar (sql/31:
//                                     aprueba SIN crear; el sitio ya no la usa
//                                     y sql/32 le quita el EXECUTE)
//
// Desde sql/32 APROBADA = la iniciativa se creo con la alta de
// Administracion -> Crear (adm.usp_GestionAdmin_Crear) en la MISMA
// transaccion, y la solicitud guarda su Codigo. El plan (Clasificacion,
// Agrupacion, Estado inicial elegido por ADM, hoy) sale de la solicitud
// GUARDADA y de ValidadorGestionAdmin, como en Crear (AprobacionIniciativa,
// abajo); el resto de los campos los lee el procedimiento de la fila.
// APROBADA y RECHAZADA son finales. Sin correos ni avisos. El revisor lo pone
// el handler con la identidad Windows del servidor
// (AccesoAdmin.IdentidadEscritura), nunca el navegador. Aparte de Cambios
// (sql/22): no usa nada de SolicitudCambioAdmin.
//
// Se prueba sin SQL en tools/tests/RevisionSolicitudesIniciativaHttpSmoke.cs
// y contra LocalDB en tools/tests/RevisionSolicitudesIniciativaSqlLocalDbSmoke.cs
// (sql/31) y tools/tests/AprobarCreaIniciativaSqlLocalDbSmoke.cs (sql/32).

using System;
using System.Collections.Generic;
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
    // sql/32 en la base (columna CodigoIniciativa y _AprobarYCrear). Un
    // error de conexion se lanza.
    bool CreaIniciativa();
    // Aprueba y crea la iniciativa en una transaccion. plan: el de
    // PlanificadorGestionAdmin.Crear sobre la solicitud guardada (null si la
    // solicitud ya no esta ENVIADA: solo se pide el resultado). Errores:
    // ErrorRevisionSolicitudIniciativa (51410-51416) o
    // ErrorEscrituraGestionAdmin (los de adm.usp_GestionAdmin_Crear).
    AprobacionConIniciativa AprobarYCrear(int numero, string revisor, string comentario, PlanCrearAdmin plan);
}

// Lo que devuelve _AprobarYCrear: el Codigo emitido (Nueva = true) o el que
// ya tenia la solicitud (Nueva = false: reintento, otro ADM gano).
public sealed class AprobacionConIniciativa
{
    public string Codigo;
    public bool Nueva;
    public string RevisadoPor;
    public DateTime FechaRevisionUtc;
}

// Un error que la base lanzo a proposito (51410-51416).
public sealed class ErrorRevisionSolicitudIniciativa : Exception
{
    public readonly int Numero;
    public ErrorRevisionSolicitudIniciativa(int numero, string mensaje) : base(mensaje) { Numero = numero; }

    public int EstadoHttp
    {
        get
        {
            if (Numero == 51411) return 404;
            if (Numero == 51412 || Numero == 51414 || Numero == 51415) return 409;
            if (Numero == 51413) return 422;
            if (Numero == 51416) return 500;
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
            if (Numero == 51414) return "AprobadaSinIniciativa";
            if (Numero == 51415) return "TipoNoCoincide";
            if (Numero == 51416) return "CodigoNoDevuelto";
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

    public const string ConsultaCreaIniciativa =
        "SELECT CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'CodigoIniciativa') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P') IS NOT NULL THEN 1 ELSE 0 END";

    public bool CreaIniciativa()
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand(ConsultaCreaIniciativa, cn) { CommandTimeout = 15 })
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    // Una llamada = una transaccion dentro del procedimiento (sql/32): la
    // aprobacion, la iniciativa y el evento quedan juntos o no queda nada.
    public AprobacionConIniciativa AprobarYCrear(int numero, string revisor, string comentario, PlanCrearAdmin plan)
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand("adm.usp_SolicitudIniciativa_AprobarYCrear", cn) { CommandType = CommandType.StoredProcedure, CommandTimeout = 60 })
        {
            cmd.Parameters.Add("@NumeroSolicitud", SqlDbType.Int).Value = numero;
            cmd.Parameters.Add("@Revisor", SqlDbType.NVarChar, 256).Value = Db(revisor);
            cmd.Parameters.Add("@Comentario", SqlDbType.NVarChar, 4000).Value = Db(comentario);
            cmd.Parameters.Add("@Prefijo", SqlDbType.NVarChar, 10).Value = plan == null ? DBNull.Value : Db(plan.Prefijo);
            cmd.Parameters.Add("@TipoIniciativa", SqlDbType.NVarChar, 100).Value = plan == null ? DBNull.Value : Db(plan.TipoIniciativa);
            cmd.Parameters.Add("@TipoAgrupado", SqlDbType.NVarChar, 100).Value = plan == null ? DBNull.Value : Db(plan.TipoAgrupado);
            cmd.Parameters.Add("@Estado", SqlDbType.NVarChar, 100).Value = plan == null ? DBNull.Value : Db(plan.Estado);
            // El mismo "hoy" del plan (FechaCreacion / FechaAnalisis), como Crear.
            cmd.Parameters.Add("@Hoy", SqlDbType.Date).Value = plan == null ? (object)DBNull.Value : plan.FechaCreacion.Date;
            var codigo = cmd.Parameters.Add("@CodigoIniciativa", SqlDbType.NVarChar, 100);
            codigo.Direction = ParameterDirection.Output;
            var nueva = cmd.Parameters.Add("@Nueva", SqlDbType.Bit);
            nueva.Direction = ParameterDirection.Output;
            var quien = cmd.Parameters.Add("@RevisadoPor", SqlDbType.NVarChar, 256);
            quien.Direction = ParameterDirection.Output;
            var fecha = cmd.Parameters.Add("@FechaRevisionUtc", SqlDbType.DateTime2);
            fecha.Direction = ParameterDirection.Output;
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex)
            {
                if (ex.Number >= 51410 && ex.Number <= 51419) throw new ErrorRevisionSolicitudIniciativa(ex.Number, ex.Message);
                // Los de la alta (adm.usp_GestionAdmin_Crear): THROW antes de
                // cualquier COMMIT, asi que nada se guardo.
                if (ex.Number >= 51000 && ex.Number < 52000 || ex.Number == 2627 || ex.Number == 2601)
                    throw new ErrorEscrituraGestionAdmin(ex.Number, ex.Message, ex);
                throw;
            }
            var c = codigo.Value as string;
            // Sin Codigo no hay exito que reportar: no se sabe que paso.
            if (string.IsNullOrEmpty(c) || !(fecha.Value is DateTime))
                throw new InvalidOperationException("adm.usp_SolicitudIniciativa_AprobarYCrear termino sin devolver el Codigo.");
            return new AprobacionConIniciativa
            {
                Codigo = c,
                Nueva = nueva.Value is bool && (bool)nueva.Value,
                RevisadoPor = quien.Value as string,
                FechaRevisionUtc = DateTime.SpecifyKind((DateTime)fecha.Value, DateTimeKind.Utc),
            };
        }
    }

    private static object Db(string s)
    {
        return string.IsNullOrEmpty(s) ? (object)DBNull.Value : s;
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
    public const string MotivoSinIniciativa =
        "Aprobar ahora crea la iniciativa y eso todavía no está en la base (falta aplicar sql/32, con su aprobación). No se cambió nada.";
    public const string MensajeFaltaEstado =
        "Elige el Estado inicial de la iniciativa que se va a crear (o «sin estado»: queda Incompleta, como en Crear).";

    // La validacion de la alta de Administracion -> Crear (catalogo, PO / SO,
    // capacidad, valores existentes). Las pruebas la cambian por una falsa.
    public static Func<PeticionCrearAdmin, ResultadoGestionAdmin> ValidarAlta =
        delegate (PeticionCrearAdmin p) { return new GestionIniciativaAdminService().Crear(p); };

    // Los Estado que ya existen en dbo.Problem vigente: las opciones del
    // Estado inicial (las mismas de Crear, estados_problem del registro).
    public static Func<List<string>> EstadosIniciales = delegate
    {
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            var l = new List<string>(ExperienciaQueries.LeerEstadosProblem(cn).Valores.Estados);
            l.Sort(StringComparer.Ordinal);
            return l;
        }
    };
}

// La solicitud GUARDADA (RegistroSolicitudesIniciativa.Lector.Detalle) como
// la peticion de Administracion -> Crear, para validarla y planearla con lo
// mismo que Crear. Puro: sin SQL.
//   tipo -> Tipo (prefijo); Clasificacion y Agrupacion de TiposPorPrefijo
//   titulo / descripcion / observaciones / po / so -> los mismos
//   categoria + pct ("%" en texto, como lo lee el registro) -> una categoria
//   volumetria -> Volumetria (dbo.Problem.VolumetriaOriginal, sql/26)
//   estado -> el que ADM eligio al aprobar ("" = sin estado)
// Director, solicitante y RCA no tienen destino en la alta: se quedan en la
// solicitud (ligada por su Codigo). TieneRca = false: el archivo nunca se
// guardo (solo su extension).
public static class AprobacionIniciativa
{
    public static PeticionCrearAdmin Peticion(Dictionary<string, object> solicitud, string estado)
    {
        if (solicitud == null) throw new ArgumentNullException("solicitud");
        var p = new PeticionCrearAdmin
        {
            Tipo = Texto(solicitud, "tipo"),
            Po = Texto(solicitud, "po"),
            So = Texto(solicitud, "so"),
            Titulo = Texto(solicitud, "titulo"),
            Descripcion = Texto(solicitud, "descripcion"),
            Observaciones = Texto(solicitud, "observaciones"),
            Estado = estado,
            Volumetria = Texto(solicitud, "volumetria"),
            TieneRca = false,
        };
        p.TipoIniciativa = TiposPorPrefijo.Clasificacion(p.Tipo);
        p.TipoAgrupado = TiposPorPrefijo.Agrupacion(p.TipoIniciativa);
        var categoria = Texto(solicitud, "categoria");
        if (categoria != null) p.Categorias.Add(new PctCategoria { Categoria = categoria, Texto = Texto(solicitud, "pct") ?? "" });
        return p;
    }

    private static string Texto(Dictionary<string, object> d, string k)
    {
        object v;
        if (!d.TryGetValue(k, out v) || v == null) return null;
        return Convert.ToString(v, CultureInfo.InvariantCulture);
    }
}
