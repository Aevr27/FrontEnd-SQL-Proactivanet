// Registro de SOLO LECTURA de las Nuevas solicitudes guardadas por sql/29
// (adm.SolicitudIniciativa + adm.SolicitudIniciativaEvento). Pestaña
// Solicitudes -> "Nuevas" (admin/solicitudes-nuevas.js), por
// handlers/admin_iniciativas_solicitudes_nuevas.ashx (ExigirAdm).
//
//   Disponible()   las tres tablas de sql/29 en la base. A diferencia de
//                  AlmacenSolicitudesSql.Disponible (que traga el error y
//                  apaga el guardado), aqui un error de conexion o permisos
//                  SE LANZA: "faltan las tablas" (501) y "la base fallo"
//                  (500) se dicen distinto.
//   Listar(max, estado)  las mas recientes primero (el numero crece con
//                  el tiempo) y el total, para decir si hay mas de las que
//                  se muestran. estado (2026-10-29): ENVIADA (pendiente),
//                  APROBADA o RECHAZADA (Estados); null = todas. Filtra en
//                  la base, asi el tope y el total son los de ese estado.
//   Detalle(n)     la solicitud con su bitacora (orden de IdEvento); null
//                  si no existe.
//
// ListarDe / DetalleDe (2026-10-27): lo mismo, solo las solicitudes que
// envio UNA cuenta, para "Mis solicitudes" del PO / SO
// (handlers/admin_iniciativas_mis_solicitudes.ashx, ExigirSolicitud).
//
// Solo SELECT: la cuenta del sitio lee con db_datareader (el DENY de sql/29
// es de INSERT/UPDATE/DELETE). No cambia estado, no aprueba ni borra, y no
// guarda nada fuera de la base: cada request lee de nuevo.
//
// Con sql/31 (revision) tambien lee revisor, fecha y comentario de la
// revision y el Detalle de cada evento, y dice revision_disponible = true;
// sin sql/31 esas columnas salen NULL (como antes). Aprobar y rechazar son
// de RevisionSolicitudesIniciativa (otro handler, POST).
//
// Con sql/32 tambien lee CodigoIniciativa (la iniciativa que creo la
// aprobacion; NULL en una APROBADA de antes de sql/32) y dice
// crea_iniciativa = true; sin sql/32 sale NULL y crea_iniciativa = false.
//
// Se prueba sin SQL en tools/tests/RegistroSolicitudesIniciativaHttpSmoke.cs
// y contra LocalDB en tools/tests/RegistroSolicitudesIniciativaSqlLocalDbSmoke.cs.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public interface ILectorSolicitudesIniciativa
{
    bool Disponible();
    LecturaSolicitudesIniciativa Listar(int maximo, string estado);
    Dictionary<string, object> Detalle(int numero);
}

// "Mis solicitudes" (handlers/admin_iniciativas_mis_solicitudes.ashx): lo
// mismo, solo las de UNA cuenta (SolicitanteCuenta = la cuenta de IIS que
// la envio, sin distinguir mayusculas, como usp_SolicitudIniciativa_Crear).
// DetalleDe de una solicitud de otra cuenta: null, igual que si no existe.
public interface ILectorMisSolicitudesIniciativa
{
    bool Disponible();
    LecturaSolicitudesIniciativa ListarDe(string cuenta, int maximo);
    Dictionary<string, object> DetalleDe(int numero, string cuenta);
}

public sealed class LecturaSolicitudesIniciativa
{
    public int Total;
    public bool RevisionDisponible;    // sql/31 en la base: se puede aprobar / rechazar
    public bool CreaIniciativa;        // sql/32 en la base: aprobar crea la iniciativa
    public List<Dictionary<string, object>> Solicitudes = new List<Dictionary<string, object>>();
}

public sealed class LectorSolicitudesIniciativaSql : ILectorSolicitudesIniciativa, ILectorMisSolicitudesIniciativa
{
    private readonly Func<SqlConnection> abrir;
    public LectorSolicitudesIniciativaSql() : this(null) { }
    public LectorSolicitudesIniciativaSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    private SqlConnection Abierta()
    {
        var cn = abrir();
        if (cn.State != ConnectionState.Open) cn.Open();
        return cn;
    }

    // Solo las tablas: leer no necesita el procedimiento ni el contador.
    public const string ConsultaTablas =
        "SELECT CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.SolicitudIniciativaEvento', N'U') IS NOT NULL THEN 1 ELSE 0 END";

    public bool Disponible()
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand(ConsultaTablas, cn) { CommandTimeout = 15 })
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    // sql/31 (revision): las 4 columnas y los 2 procedimientos. Sin ellos las
    // columnas de la revision se leen como NULL y no se ofrece revisar.
    public const string ConsultaRevision =
        "SELECT CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'RevisadoPor') IS NOT NULL " +
        " AND COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaRevisionUtc') IS NOT NULL " +
        " AND COL_LENGTH(N'adm.SolicitudIniciativa', N'ComentarioRevision') IS NOT NULL " +
        " AND COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Detalle') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P') IS NOT NULL THEN 1 ELSE 0 END";

    private static bool ConRevision(SqlConnection cn)
    {
        using (var cmd = new SqlCommand(ConsultaRevision, cn) { CommandTimeout = 15 })
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    // sql/32: la columna y el procedimiento (la misma consulta del revisor).
    private static bool ConCodigo(SqlConnection cn)
    {
        using (var cmd = new SqlCommand(RevisorSolicitudesIniciativaSql.ConsultaCreaIniciativa, cn) { CommandTimeout = 15 })
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    private static string Columnas(bool revision, bool codigo)
    {
        return @"
       s.NumeroSolicitud, s.Estado, s.TipoIniciativa, s.Titulo, s.SolicitanteNombre, s.SolicitanteCorreo, s.SolicitanteCuenta,
       s.ProductOwner, s.ProductOwnerCorreo, s.ServiceOwner, s.Categoria, s.Director, s.FechaUtc,
       Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento AS e WHERE e.NumeroSolicitud = s.NumeroSolicitud),
" + (revision
            ? "       s.RevisadoPor, s.FechaRevisionUtc, s.ComentarioRevision"
            : "       RevisadoPor = CONVERT(nvarchar(256), NULL), FechaRevisionUtc = CONVERT(datetime2(0), NULL), ComentarioRevision = CONVERT(nvarchar(4000), NULL)")
            + (codigo ? ", s.CodigoIniciativa" : ", CodigoIniciativa = CONVERT(nvarchar(100), NULL)");
    }

    // Solo las de una cuenta (null = todas: nunca para "Mis solicitudes").
    private const string FiltroCuenta = "UPPER(s.SolicitanteCuenta) = UPPER(@cuenta)";

    public LecturaSolicitudesIniciativa Listar(int maximo) { return Leer(null, maximo, null); }

    // estado: uno de RegistroSolicitudesIniciativa.Estados o null (todas).
    public LecturaSolicitudesIniciativa Listar(int maximo, string estado)
    {
        if (estado != null && !RegistroSolicitudesIniciativa.EsEstado(estado)) throw new ArgumentOutOfRangeException("estado");
        return Leer(null, maximo, estado);
    }

    public LecturaSolicitudesIniciativa ListarDe(string cuenta, int maximo)
    {
        if (string.IsNullOrEmpty(cuenta)) throw new ArgumentNullException("cuenta");
        return Leer(cuenta, maximo, null);
    }

    private LecturaSolicitudesIniciativa Leer(string cuenta, int maximo, string estado)
    {
        var l = new LecturaSolicitudesIniciativa();
        using (var cn = Abierta())
        {
            l.RevisionDisponible = ConRevision(cn);
            l.CreaIniciativa = l.RevisionDisponible && ConCodigo(cn);
            var filtros = new List<string>();
            if (cuenta != null) filtros.Add(FiltroCuenta);
            if (estado != null) filtros.Add("s.Estado = @estado");
            var donde = filtros.Count == 0 ? "" : " WHERE " + string.Join(" AND ", filtros.ToArray());
            var sql = "SELECT TOP (@max)" + Columnas(l.RevisionDisponible, l.CreaIniciativa) + @"
FROM adm.SolicitudIniciativa AS s" + donde + @"
ORDER BY s.NumeroSolicitud DESC;
SELECT COUNT(*) FROM adm.SolicitudIniciativa AS s" + donde + ";";
            using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 60 })
            {
                cmd.Parameters.Add("@max", SqlDbType.Int).Value = Math.Max(1, Math.Min(maximo, 500));
                if (cuenta != null) cmd.Parameters.Add("@cuenta", SqlDbType.NVarChar, 256).Value = cuenta;
                if (estado != null) cmd.Parameters.Add("@estado", SqlDbType.VarChar, 20).Value = estado;
                using (var r = cmd.ExecuteReader())
                {
                    while (r.Read()) l.Solicitudes.Add(Fila(r));
                    if (r.NextResult() && r.Read()) l.Total = Convert.ToInt32(r.GetValue(0), CultureInfo.InvariantCulture);
                }
            }
        }
        return l;
    }

    public Dictionary<string, object> Detalle(int numero) { return Detalle(numero, null); }

    public Dictionary<string, object> DetalleDe(int numero, string cuenta)
    {
        if (string.IsNullOrEmpty(cuenta)) throw new ArgumentNullException("cuenta");
        return Detalle(numero, cuenta);
    }

    private Dictionary<string, object> Detalle(int numero, string cuenta)
    {
        using (var cn = Abierta())
        {
            var revision = ConRevision(cn);
            var codigo = revision && ConCodigo(cn);
            // Con cuenta, los eventos solo si la solicitud es suya (el EXISTS).
            var deCuenta = cuenta == null ? "" : " AND " + FiltroCuenta;
            var sql = "SELECT" + Columnas(revision, codigo) + @",
       s.Descripcion, s.Observaciones, s.Volumetria, s.PctDisminucion, s.RcaExtension, s.FuenteCorreos
FROM adm.SolicitudIniciativa AS s
WHERE s.NumeroSolicitud = @n" + deCuenta + @";
SELECT e.IdEvento, e.Evento, e.EstadoAnterior, e.EstadoNuevo, e.Usuario, e.FechaUtc, " +
                (revision ? "e.Detalle" : "Detalle = CONVERT(nvarchar(2000), NULL)") + @"
FROM adm.SolicitudIniciativaEvento AS e WHERE e.NumeroSolicitud = @n" +
                (cuenta == null ? "" : " AND EXISTS (SELECT 1 FROM adm.SolicitudIniciativa AS s WHERE s.NumeroSolicitud = @n" + deCuenta + ")") + @"
ORDER BY e.IdEvento;";
            using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 30 })
            {
                cmd.Parameters.Add("@n", SqlDbType.Int).Value = numero;
                if (cuenta != null) cmd.Parameters.Add("@cuenta", SqlDbType.NVarChar, 256).Value = cuenta;
                using (var r = cmd.ExecuteReader())
                {
                    if (!r.Read()) return null;
                    var d = Fila(r);
                    d["revision_disponible"] = revision;
                    d["crea_iniciativa"] = codigo;
                    d["descripcion"] = Texto(r, "Descripcion");
                    d["observaciones"] = Texto(r, "Observaciones");
                    d["volumetria"] = r.IsDBNull(r.GetOrdinal("Volumetria")) ? (object)null : Convert.ToInt32(r["Volumetria"], CultureInfo.InvariantCulture);
                    d["pct"] = Pct(r, "PctDisminucion");
                    d["rca_extension"] = Texto(r, "RcaExtension");
                    d["fuente_correos"] = Texto(r, "FuenteCorreos");
                    var eventos = new List<object>();
                    if (r.NextResult())
                        while (r.Read())
                            eventos.Add(new Dictionary<string, object>
                            {
                                { "id", Convert.ToInt32(r["IdEvento"], CultureInfo.InvariantCulture) },
                                { "evento", Texto(r, "Evento") },
                                { "estado_anterior", Texto(r, "EstadoAnterior") },
                                { "estado_nuevo", Texto(r, "EstadoNuevo") },
                                { "usuario", Texto(r, "Usuario") },
                                { "fecha_utc", Utc(r, "FechaUtc") },
                                { "detalle", Texto(r, "Detalle") },
                            });
                    d["eventos"] = eventos;
                    return d;
                }
            }
        }
    }

    private static Dictionary<string, object> Fila(SqlDataReader r)
    {
        var n = Convert.ToInt32(r["NumeroSolicitud"], CultureInfo.InvariantCulture);
        return new Dictionary<string, object>
        {
            { "numero", n }, { "numero_texto", new NumeroSolicitud(n).ToString() },
            { "estado", Texto(r, "Estado") }, { "tipo", Texto(r, "TipoIniciativa") }, { "titulo", Texto(r, "Titulo") },
            { "solicitante_nombre", Texto(r, "SolicitanteNombre") }, { "solicitante_correo", Texto(r, "SolicitanteCorreo") },
            { "solicitante_cuenta", Texto(r, "SolicitanteCuenta") },
            { "po", Texto(r, "ProductOwner") }, { "po_correo", Texto(r, "ProductOwnerCorreo") }, { "so", Texto(r, "ServiceOwner") },
            { "categoria", Texto(r, "Categoria") }, { "director", Texto(r, "Director") },
            { "fecha_utc", Utc(r, "FechaUtc") }, { "eventos_total", Convert.ToInt32(r["Eventos"], CultureInfo.InvariantCulture) },
            { "revisado_por", Texto(r, "RevisadoPor") }, { "fecha_revision_utc", Utc(r, "FechaRevisionUtc") },
            { "comentario_revision", Texto(r, "ComentarioRevision") },
            { "codigo_iniciativa", Texto(r, "CodigoIniciativa") },
        };
    }

    private static string Texto(SqlDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture);
    }
    // FechaUtc de sql/29 es SYSUTCDATETIME(): se marca con Z, como la cola de cambios.
    private static string Utc(SqlDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : Convert.ToDateTime(r.GetValue(i)).ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "Z";
    }
    // Fraccion 0-1 -> % en texto ("20", "12.5"), como la cola de cambios.
    private static string Pct(SqlDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        if (r.IsDBNull(i)) return null;
        return (Convert.ToDecimal(r.GetValue(i)) * 100m).ToString("0.##", CultureInfo.InvariantCulture);
    }
}

// Lo que el handler usa; las pruebas lo cambian por uno falso.
public static class RegistroSolicitudesIniciativa
{
    public static ILectorSolicitudesIniciativa Lector = new LectorSolicitudesIniciativaSql();
    // "Mis solicitudes": la misma lectura real, filtrada por cuenta.
    public static ILectorMisSolicitudesIniciativa Mias = new LectorSolicitudesIniciativaSql();
    // Otras iniciativas activas de la categoria, con su % (categoria,
    // folio que se excluye). Solo el detalle de ADM las pide.
    public static Func<string, string, List<Dictionary<string, object>>> OtrasIniciativas = IniciativaService.OtrasIniciativas;

    // Como la cola de cambios (admin_iniciativas_solicitudes.ashx): 200.
    public const int Maximo = 200;

    // Los valores de adm.SolicitudIniciativa.Estado (CHECK de sql/29 y
    // sql/31). ENVIADA es la pendiente de revision; las otras dos son finales.
    public const string Pendiente = "ENVIADA";
    public static readonly string[] Estados = { Pendiente, "APROBADA", "RECHAZADA" };

    public static bool EsEstado(string estado)
    {
        return Array.IndexOf(Estados, estado) >= 0;
    }

    public const string MensajeSoloAdm = "Solo un administrador (ADM) puede ver el registro de solicitudes nuevas.";
    public const string MotivoSinTablas =
        "El registro de solicitudes nuevas no está en la base (faltan las tablas de sql/29): no hay solicitudes que mostrar.";

    // "?numero=" acepta 142, "0000142" o "#0000142". 0 = no es un numero valido.
    public static int Numero(string texto)
    {
        if (texto == null) return 0;
        texto = texto.Trim().TrimStart('#');
        int n;
        return int.TryParse(texto, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n >= 1 && n <= NumeroSolicitud.Maximo ? n : 0;
    }
}
