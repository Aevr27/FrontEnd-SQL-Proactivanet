// Acuse "Estoy trabajando en ello" del PO / SO de una iniciativa Atrasada
// del semaforo, y su notificacion persistente para ADM dentro de la app
// (sql/28_acuse_po_so.sql, sql/PROPUESTA_acuse_po_so.md).
//
// IDENTIDAD (decidida 2026-10-22; cobertura medida en la VM ese dia)
//   cuenta de IIS (AccesoAdmin.IdentidadEscritura, la misma que firma toda
//   escritura de Admin) -> IdentidadWindows.CorreoCandidato()
//   ("SORIANA\edgarrad" -> "edgarrad@soriana.com", lo mismo que la
//   cabecera) -> dbo.CatPersona.Correo (vigente, sin mayusculas ni
//   espacios). Se exige EXACTAMENTE una fila; cero = no_encontrado, mas de
//   una = ambiguo. Ademas ninguna OTRA fila de CatPersona puede tener el
//   mismo nombre (ClaveNombre): si lo tuviera, un OwnerProblem con ese
//   nombre no se podria atribuir a una sola persona (nombre_repetido).
//   La persona es dueño de un rol si ClaveNombre(su nombre) =
//   ClaveNombre(OwnerProblem) para PO u OwnerServicio para SO.
//   Nada de esto lo manda el navegador: solo folio y rol, y los dos se
//   revalidan aqui y en adm.usp_Acuse_Registrar.
//   SUPUESTO: el correo armado con la cuenta es el de esa persona. Vale
//   cuando el correo guardado en CatPersona es cuenta@soriana.com; las
//   cuentas t_* nunca coinciden (no pueden acusar).
//
// ELEGIBLE = la categoria "Atrasadas" del semaforo, con los MISMOS datos
//   de la lista (ExperienciaQueries.RegistroIniciativas): activa, con
//   control de fecha y fecha_retrasada. Es semaforoFecha() de
//   admin/registro-iniciativas.js; no es el KPI Atrasadas.
//
// ACCESO: el handler esta detras de AccesoAdmin (ADM o MOD). No da acceso
// a nadie nuevo. La bandeja y marcar como leida son solo de ADM.
//
// El acuse no cambia nada de la iniciativa. Se prueba sin SQL en
// tools/tests/AcuseIniciativaHttpSmoke.cs y contra LocalDB en
// tools/tests/AcuseIniciativaSqlLocalDbSmoke.cs.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Text;

// ---------------------------------------------------------------------------
// Personas (dbo.CatPersona) e identidad
// ---------------------------------------------------------------------------
public sealed class PersonaCatalogo
{
    public string Nombre;
    public string Correo;
}

public interface IFuentePersonasAcuse
{
    List<PersonaCatalogo> Personas();
}

public sealed class FuentePersonasAcuseSql : IFuentePersonasAcuse
{
    private readonly Func<SqlConnection> abrir;
    public FuentePersonasAcuseSql() : this(null) { }
    public FuentePersonasAcuseSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    public List<PersonaCatalogo> Personas()
    {
        var l = new List<PersonaCatalogo>();
        using (var cn = abrir())
        {
            if (cn.State != ConnectionState.Open) cn.Open();
            using (var cmd = new SqlCommand("SELECT Nombre, Correo FROM dbo.CatPersona WHERE VigenteEnOrigen = 1", cn))
            using (var rd = cmd.ExecuteReader())
                while (rd.Read())
                    l.Add(new PersonaCatalogo
                    {
                        Nombre = rd.IsDBNull(0) ? null : rd.GetString(0),
                        Correo = rd.IsDBNull(1) ? null : rd.GetString(1),
                    });
        }
        return l;
    }
}

public sealed class IdentidadAcuse
{
    public const string Resuelto = "resuelto";
    public const string SinIdentidad = "sin_identidad";
    public const string NoEncontrado = "no_encontrado";
    public const string Ambiguo = "ambiguo";
    public const string NombreRepetido = "nombre_repetido";
    public const string Fuente = "CORREO_CANDIDATO";

    public string Estado;
    public string Cuenta;     // IdentidadWindows.Original
    public string Correo;     // el candidato buscado
    public string Nombre;     // CatPersona.Nombre (solo resuelto)
    public string Clave;      // ClaveNombre(Nombre)

    public bool EsResuelta { get { return Estado == Resuelto; } }

    // Nombre comparable: sin NBSP ni espacios de mas, sin acentos, sin
    // mayusculas. Es como compara el diag de la VM (COLLATE CI_AI).
    // Unicode invalido (un surrogate suelto): null, nunca una excepcion. Asi
    // un nombre mal capturado en CatPersona no tumba la resolucion de todos;
    // null no se iguala con nada (esa fila no resuelve a nadie ni repite el
    // nombre de nadie) y su propia cuenta queda sin resolver (no_encontrado).
    public static string ClaveNombre(string s)
    {
        s = DirectorioOrganizacional.Normaliza(s);
        if (s == null) return null;
        string d;
        try { d = s.Normalize(NormalizationForm.FormD); }
        catch (ArgumentException) { return null; }
        var sb = new StringBuilder();
        bool espacio = false;
        foreach (var ch in d)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsWhiteSpace(ch)) { espacio = true; continue; }
            if (espacio && sb.Length > 0) sb.Append(' ');
            espacio = false;
            sb.Append(char.ToUpperInvariant(ch));
        }
        return sb.Length == 0 ? null : sb.ToString();
    }

    public static string ClaveCorreo(string s)
    {
        if (s == null) return null;
        s = s.Trim().ToLowerInvariant();
        return s.Length == 0 ? null : s;
    }

    public static IdentidadAcuse Resolver(IdentidadWindows id, IList<PersonaCatalogo> personas)
    {
        var r = new IdentidadAcuse();
        if (id == null || !id.Autenticada || string.IsNullOrEmpty(id.Original))
        {
            r.Estado = SinIdentidad;
            return r;
        }
        r.Cuenta = id.Original;
        r.Correo = ClaveCorreo(id.CorreoCandidato());
        if (r.Correo == null) { r.Estado = SinIdentidad; return r; }

        var porCorreo = new List<PersonaCatalogo>();
        foreach (var p in personas ?? new List<PersonaCatalogo>())
            if (ClaveCorreo(p.Correo) == r.Correo) porCorreo.Add(p);
        if (porCorreo.Count == 0) { r.Estado = NoEncontrado; return r; }
        if (porCorreo.Count > 1) { r.Estado = Ambiguo; return r; }

        var clave = ClaveNombre(porCorreo[0].Nombre);
        if (clave == null) { r.Estado = NoEncontrado; return r; }
        int mismoNombre = 0;
        foreach (var p in personas)
            if (ClaveNombre(p.Nombre) == clave) mismoNombre++;
        if (mismoNombre != 1) { r.Estado = NombreRepetido; return r; }

        r.Estado = Resuelto;
        r.Nombre = porCorreo[0].Nombre.Trim();
        r.Clave = clave;
        return r;
    }

    // Si esta persona es el dueño `nombreDueno` (OwnerProblem / OwnerServicio).
    public bool EsDueno(string nombreDueno)
    {
        return EsResuelta && Clave != null && Clave == ClaveNombre(nombreDueno);
    }
}

// ---------------------------------------------------------------------------
// Datos de la iniciativa (los de la lista) y dueños capturados
// ---------------------------------------------------------------------------
public sealed class IniciativaAcuse
{
    public string Folio;
    public string Estado;
    public bool Activa;
    public bool? ControlFecha;   // null = el servidor no lo mando (cuenta como con control)
    public bool FechaRetrasada;
    public string Po;            // po_capturado (dbo.Problem.OwnerProblem)
    public string So;            // so_capturado (dbo.Problem.OwnerServicio)
    // La fecha compromiso del Estado tal como la vio la lista (null = sin
    // fecha): f_analisis (= dbo.Problem.FechaAnalisis, AplicarFechasPropias),
    // f_solucion o f_cierre (p.FechaSolucion / p.FechaCierre). Es el episodio
    // que se acusa; adm.usp_Acuse_Registrar la compara con la de ahora (51308).
    public DateTime? FechaCompromiso;

    // La categoria Atrasadas del semaforo (semaforoFecha en el navegador):
    // activa, con control de fecha y con la fecha del estado vencida.
    public bool Atrasada { get { return Activa && ControlFecha != false && FechaRetrasada; } }

    public string DuenoDe(string rol)
    {
        return rol == "PO" ? Po : rol == "SO" ? So : null;
    }

    public static IniciativaAcuse DesdeRegistro(IDictionary i)
    {
        if (i == null) return null;
        Func<string, object> v = delegate (string k) { return i.Contains(k) ? i[k] : null; };
        return new IniciativaAcuse
        {
            Folio = v("folio") as string,
            Estado = v("estado") as string,
            Activa = v("activa") is bool && (bool)v("activa"),
            ControlFecha = v("control_fecha") is bool ? (bool?)(bool)v("control_fecha") : null,
            FechaRetrasada = v("fecha_retrasada") is bool && (bool)v("fecha_retrasada"),
            Po = v("po_capturado") as string,
            So = v("so_capturado") as string,
            FechaCompromiso = FechaIso(v(CampoFechaDe(v("estado") as string))),
        };
    }

    // La columna de fecha de cada estado activo (FECHA_DEL_ESTADO del
    // navegador, Semaforo del servidor), sin acentos ni mayusculas como
    // compara la base (COLLATE CI_AI). Otro estado: ninguna.
    public static string CampoFechaDe(string estado)
    {
        var k = IdentidadAcuse.ClaveNombre(estado);
        return k == "EN ANALISIS" ? "f_analisis" : k == "EN SOLUCION" ? "f_solucion" : k == "EN MONITOREO" ? "f_cierre" : "";
    }

    // "aaaa-mm-dd" -> fecha; vacio o invalido -> null.
    public static DateTime? FechaIso(object v)
    {
        DateTime d;
        var s = v as string;
        return !string.IsNullOrEmpty(s) && DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d)
            ? (DateTime?)d : null;
    }
}

public interface IFuenteIniciativasAcuse
{
    // La iniciativa tal como la arma la lista, o null si no esta.
    IniciativaAcuse Iniciativa(string folio);
    // Folio -> { PO, SO } capturados (vigentes). Barato: solo dbo.Problem.
    List<IniciativaAcuse> Duenos();
}

public sealed class FuenteIniciativasAcuseSql : IFuenteIniciativasAcuse
{
    public IniciativaAcuse Iniciativa(string folio)
    {
        var reg = ExperienciaQueries.RegistroIniciativas();
        var lista = reg["iniciativas"] as IEnumerable;
        if (lista == null) return null;
        foreach (var o in lista)
        {
            var d = o as IDictionary;
            if (d != null && string.Equals(d["folio"] as string, folio, StringComparison.Ordinal))
                return IniciativaAcuse.DesdeRegistro(d);
        }
        return null;
    }

    public List<IniciativaAcuse> Duenos()
    {
        var l = new List<IniciativaAcuse>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            using (var cmd = new SqlCommand(
                "SELECT Codigo, OwnerProblem, OwnerServicio FROM dbo.Problem WHERE VigenteEnOrigen = 1", cn))
            using (var rd = cmd.ExecuteReader())
                while (rd.Read())
                    l.Add(new IniciativaAcuse
                    {
                        Folio = rd.IsDBNull(0) ? null : rd.GetString(0),
                        Po = rd.IsDBNull(1) ? null : rd.GetString(1),
                        So = rd.IsDBNull(2) ? null : rd.GetString(2),
                    });
        }
        return l;
    }
}

// ---------------------------------------------------------------------------
// Almacen (sql/28)
// ---------------------------------------------------------------------------
public sealed class AcuseGuardado
{
    public int IdAcuse;
    public string Folio;
    public string Rol;
    public string Cuenta;
    public string NombreDueno;
    public string Estado;
    public DateTime? FechaCompromiso;
    public DateTime FechaUtc;
}

public sealed class NotificacionAcuse
{
    public int IdNotificacion;
    public DateTime FechaUtc;
    public AcuseGuardado Acuse;
    public DateTime? LeidaUtc;
}

public sealed class RegistroAcuse
{
    public int IdAcuse;
    public bool Nuevo;
    public DateTime FechaUtc;
}

public sealed class BandejaAcuses
{
    public int NoLeidas;
    public List<NotificacionAcuse> Notificaciones = new List<NotificacionAcuse>();
}

// Un error que la base lanzo a proposito (51301-51308).
public sealed class ErrorAcuse : Exception
{
    public readonly int Numero;
    public ErrorAcuse(int numero, string mensaje) : base(mensaje) { Numero = numero; }
}

public interface IAlmacenAcuses
{
    bool Disponible();
    RegistroAcuse Registrar(string cuenta, string folio, string rol, string nombreDueno, string estado, DateTime? fechaCompromiso);
    List<AcuseGuardado> DeIniciativa(string folio);
    BandejaAcuses Bandeja(string usuario, int limite);
    bool MarcarLeida(string usuario, int idNotificacion);
}

public sealed class AlmacenAcusesSql : IAlmacenAcuses
{
    private readonly Func<SqlConnection> abrir;
    public AlmacenAcusesSql() : this(null) { }
    public AlmacenAcusesSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    private SqlConnection Abierta()
    {
        var cn = abrir();
        if (cn.State != ConnectionState.Open) cn.Open();
        return cn;
    }

    // Las cinco piezas de sql/28. Un error al revisar cuenta como "sin sql/28".
    public const string ConsultaDeteccion =
        "SELECT CASE WHEN OBJECT_ID(N'adm.AcuseIniciativa', N'U') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.NotificacionAdm', N'U') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.NotificacionLectura', N'U') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_Acuse_Registrar', N'P') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_Notificacion_MarcarLeida', N'P') IS NOT NULL THEN 1 ELSE 0 END";

    public bool Disponible()
    {
        try
        {
            using (var cn = Abierta())
            using (var cmd = new SqlCommand(ConsultaDeteccion, cn) { CommandTimeout = 15 })
                return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
        }
        catch (SqlException) { return false; }
    }

    private static Exception Traducir(SqlException ex)
    {
        return ex.Number >= 51301 && ex.Number <= 51308 ? (Exception)new ErrorAcuse(ex.Number, ex.Message) : ex;
    }

    public RegistroAcuse Registrar(string cuenta, string folio, string rol, string nombreDueno, string estado, DateTime? fechaCompromiso)
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand("adm.usp_Acuse_Registrar", cn) { CommandType = CommandType.StoredProcedure })
        {
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = (object)cuenta ?? DBNull.Value;
            cmd.Parameters.Add("@Codigo", SqlDbType.NVarChar, 100).Value = (object)folio ?? DBNull.Value;
            cmd.Parameters.Add("@Rol", SqlDbType.Char, 2).Value = (object)rol ?? DBNull.Value;
            cmd.Parameters.Add("@NombreDueno", SqlDbType.NVarChar, 4000).Value = (object)nombreDueno ?? DBNull.Value;
            cmd.Parameters.Add("@EstadoIniciativa", SqlDbType.NVarChar, 100).Value = (object)estado ?? DBNull.Value;
            cmd.Parameters.Add("@FechaCompromiso", SqlDbType.Date).Value = fechaCompromiso.HasValue ? (object)fechaCompromiso.Value.Date : DBNull.Value;
            cmd.Parameters.Add("@FuenteIdentidad", SqlDbType.VarChar, 16).Value = IdentidadAcuse.Fuente;
            var id = cmd.Parameters.Add("@IdAcuse", SqlDbType.Int); id.Direction = ParameterDirection.Output;
            var nuevo = cmd.Parameters.Add("@Nuevo", SqlDbType.Bit); nuevo.Direction = ParameterDirection.Output;
            var fecha = cmd.Parameters.Add("@FechaUtc", SqlDbType.DateTime2); fecha.Direction = ParameterDirection.Output;
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex) { throw Traducir(ex); }
            return new RegistroAcuse
            {
                IdAcuse = (int)id.Value,
                Nuevo = (bool)nuevo.Value,
                FechaUtc = (DateTime)fecha.Value,
            };
        }
    }

    private const string Columnas =
        "a.IdAcuse, a.Codigo, a.Rol, a.Cuenta, a.NombreDueno, a.EstadoIniciativa, a.FechaCompromiso, a.FechaUtc";

    private static AcuseGuardado LeerAcuse(SqlDataReader rd, int o)
    {
        return new AcuseGuardado
        {
            IdAcuse = rd.GetInt32(o),
            Folio = rd.GetString(o + 1),
            Rol = rd.GetString(o + 2),
            Cuenta = rd.GetString(o + 3),
            NombreDueno = rd.GetString(o + 4),
            Estado = rd.GetString(o + 5),
            FechaCompromiso = rd.IsDBNull(o + 6) ? (DateTime?)null : rd.GetDateTime(o + 6),
            FechaUtc = rd.GetDateTime(o + 7),
        };
    }

    public List<AcuseGuardado> DeIniciativa(string folio)
    {
        var l = new List<AcuseGuardado>();
        using (var cn = Abierta())
        using (var cmd = new SqlCommand("SELECT " + Columnas + " FROM adm.AcuseIniciativa AS a " +
                                        "WHERE a.Codigo = @c ORDER BY a.FechaUtc DESC, a.IdAcuse DESC", cn))
        {
            cmd.Parameters.Add("@c", SqlDbType.NVarChar, 100).Value = folio ?? "";
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) l.Add(LeerAcuse(rd, 0));
        }
        return l;
    }

    public BandejaAcuses Bandeja(string usuario, int limite)
    {
        var b = new BandejaAcuses();
        using (var cn = Abierta())
        {
            using (var cmd = new SqlCommand(
                "SELECT TOP (@n) n.IdNotificacion, n.FechaUtc, l.LeidaUtc, " + Columnas + " " +
                "FROM adm.NotificacionAdm AS n " +
                "INNER JOIN adm.AcuseIniciativa AS a ON a.IdAcuse = n.IdAcuse " +
                "LEFT JOIN adm.NotificacionLectura AS l ON l.IdNotificacion = n.IdNotificacion AND l.Usuario = @u " +
                "ORDER BY n.FechaUtc DESC, n.IdNotificacion DESC", cn))
            {
                cmd.Parameters.Add("@n", SqlDbType.Int).Value = limite;
                cmd.Parameters.Add("@u", SqlDbType.NVarChar, 256).Value = usuario ?? "";
                using (var rd = cmd.ExecuteReader())
                    while (rd.Read())
                        b.Notificaciones.Add(new NotificacionAcuse
                        {
                            IdNotificacion = rd.GetInt32(0),
                            FechaUtc = rd.GetDateTime(1),
                            LeidaUtc = rd.IsDBNull(2) ? (DateTime?)null : rd.GetDateTime(2),
                            Acuse = LeerAcuse(rd, 3),
                        });
            }
            using (var cmd = new SqlCommand(
                "SELECT COUNT(*) FROM adm.NotificacionAdm AS n WHERE NOT EXISTS " +
                "(SELECT 1 FROM adm.NotificacionLectura AS l WHERE l.IdNotificacion = n.IdNotificacion AND l.Usuario = @u)", cn))
            {
                cmd.Parameters.Add("@u", SqlDbType.NVarChar, 256).Value = usuario ?? "";
                b.NoLeidas = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
            }
        }
        return b;
    }

    public bool MarcarLeida(string usuario, int idNotificacion)
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand("adm.usp_Notificacion_MarcarLeida", cn) { CommandType = CommandType.StoredProcedure })
        {
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = (object)usuario ?? DBNull.Value;
            cmd.Parameters.Add("@IdNotificacion", SqlDbType.Int).Value = idNotificacion;
            var nueva = cmd.Parameters.Add("@Nueva", SqlDbType.Bit); nueva.Direction = ParameterDirection.Output;
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex) { throw Traducir(ex); }
            return (bool)nueva.Value;
        }
    }
}

// ---------------------------------------------------------------------------
// Servicio: lo que decide el handler
// ---------------------------------------------------------------------------
public sealed class ResultadoAcuse
{
    public int Http = 200;
    public Dictionary<string, object> Cuerpo = new Dictionary<string, object>();

    public static ResultadoAcuse Error(int http, string tipo, string mensaje)
    {
        var r = new ResultadoAcuse { Http = http };
        r.Cuerpo["error"] = mensaje;
        r.Cuerpo["tipo"] = tipo;
        return r;
    }
}

public static class AcusesIniciativa
{
    public const int LimiteBandeja = 50;

    // OCULTO PENDIENTE DE APROBACION (2026-10-22): el acuse de PO / SO y los
    // avisos de ADM no estan aprobados por direccion. Con false el handler
    // responde { disponible: false } a todo GET y 403 FuncionNoAprobada a
    // todo POST, sin leer ni escribir la base (sql/28 queda como esta).
    // Reactivar: true aqui Y AcuseIniciativa.HABILITADO = true en
    // admin/acuse-iniciativa.js. Solo las pruebas lo cambian en ejecucion.
    public static bool Habilitado = false;

    // El handler usa estas; las pruebas las cambian por falsas.
    public static IAlmacenAcuses Almacen = new AlmacenAcusesSql();
    public static IFuentePersonasAcuse Personas = new FuentePersonasAcuseSql();
    public static IFuenteIniciativasAcuse Iniciativas = new FuenteIniciativasAcuseSql();

    public static string Fecha(DateTime utc)
    {
        return utc.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "Z";
    }

    public static Dictionary<string, object> Json(AcuseGuardado a)
    {
        return new Dictionary<string, object>
        {
            { "id", a.IdAcuse }, { "folio", a.Folio }, { "rol", a.Rol }, { "cuenta", a.Cuenta },
            { "nombre", a.NombreDueno }, { "estado", a.Estado },
            { "fecha_compromiso", a.FechaCompromiso.HasValue ? a.FechaCompromiso.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null },
            { "fecha_utc", Fecha(a.FechaUtc) },
        };
    }

    // GET mio: quien soy para el acuse y de que folios soy PO / SO. Sin la
    // regla Atrasada (la pinta el navegador con la lista que ya tiene; el
    // POST la revalida). Una identidad no resuelta no tiene roles.
    public static Dictionary<string, object> Mio(IdentidadWindows id)
    {
        var yo = IdentidadAcuse.Resolver(id, Personas.Personas());
        var roles = new Dictionary<string, object>(StringComparer.Ordinal);
        if (yo.EsResuelta)
        {
            foreach (var d in Iniciativas.Duenos())
            {
                if (string.IsNullOrEmpty(d.Folio)) continue;
                var r = new List<object>();
                if (yo.EsDueno(d.Po)) r.Add("PO");
                if (yo.EsDueno(d.So)) r.Add("SO");
                if (r.Count > 0) roles[d.Folio] = r;
            }
        }
        return new Dictionary<string, object>
        {
            { "disponible", true },
            { "identidad", new Dictionary<string, object> { { "estado", yo.Estado }, { "nombre", yo.Nombre } } },
            { "roles", roles },
        };
    }

    public static Dictionary<string, object> DeIniciativa(string folio)
    {
        var lista = new List<object>();
        foreach (var a in Almacen.DeIniciativa(folio)) lista.Add(Json(a));
        return new Dictionary<string, object> { { "disponible", true }, { "folio", folio }, { "acuses", lista } };
    }

    // POST acusar. Revalida TODO con datos del servidor: identidad, que la
    // iniciativa exista, que este Atrasada en el semaforo y que la persona
    // sea el dueño de ESE rol. Despues la base vuelve a revisar dueño,
    // Estado y fecha compromiso en la transaccion (51305 / 51306 / 51308).
    public static ResultadoAcuse Acusar(IdentidadWindows id, string folio, string rol)
    {
        folio = folio == null ? null : folio.Trim();
        if (string.IsNullOrEmpty(folio)) return ResultadoAcuse.Error(400, "SinFolio", "Falta la iniciativa.");
        if (rol != "PO" && rol != "SO") return ResultadoAcuse.Error(400, "RolInvalido", "El rol del acuse es PO o SO.");

        var yo = IdentidadAcuse.Resolver(id, Personas.Personas());
        if (yo.Estado == IdentidadAcuse.SinIdentidad)
            return ResultadoAcuse.Error(403, "SinUsuario", "Sin usuario autenticado no se registra el acuse.");
        if (!yo.EsResuelta)
            return ResultadoAcuse.Error(403, "IdentidadNoResuelta",
                "No se pudo identificar con certeza a la persona de tu cuenta en el cat\u00e1logo de personas (" + yo.Estado + ").");

        var i = Iniciativas.Iniciativa(folio);
        if (i == null) return ResultadoAcuse.Error(404, "IniciativaNoExiste", "La iniciativa no est\u00e1 en el registro.");
        var dueno = i.DuenoDe(rol);
        if (!yo.EsDueno(dueno))
            return ResultadoAcuse.Error(403, "NoEsDueno",
                "Solo el " + (rol == "PO" ? "Product Owner" : "Service Owner") + " asignado a esta iniciativa puede acusarla en ese rol.");
        if (!i.Atrasada)
            return ResultadoAcuse.Error(409, "NoElegible", "La iniciativa ya no est\u00e1 Atrasada en el sem\u00e1foro: no hay nada que acusar.");

        try
        {
            var g = Almacen.Registrar(yo.Cuenta, folio, rol, dueno.Trim(), i.Estado, i.FechaCompromiso);
            var r = new ResultadoAcuse();
            r.Cuerpo["acusado"] = true;
            r.Cuerpo["nuevo"] = g.Nuevo;
            r.Cuerpo["id"] = g.IdAcuse;
            r.Cuerpo["rol"] = rol;
            r.Cuerpo["nombre"] = yo.Nombre;
            r.Cuerpo["fecha_utc"] = Fecha(g.FechaUtc);
            return r;
        }
        catch (ErrorAcuse ex)
        {
            int http = ex.Numero == 51304 ? 404 : ex.Numero == 51305 || ex.Numero == 51306 || ex.Numero == 51308 ? 409 : ex.Numero == 51301 ? 403 : 400;
            var r = ResultadoAcuse.Error(http, "Base" + ex.Numero.ToString(CultureInfo.InvariantCulture), ex.Message);
            r.Cuerpo["acusado"] = false;
            return r;
        }
    }

    public static Dictionary<string, object> Bandeja(string usuario)
    {
        var b = Almacen.Bandeja(usuario, LimiteBandeja);
        var lista = new List<object>();
        foreach (var n in b.Notificaciones)
        {
            var d = Json(n.Acuse);
            d["id_notificacion"] = n.IdNotificacion;
            d["notificada_utc"] = Fecha(n.FechaUtc);
            d["leida"] = n.LeidaUtc.HasValue;
            d["leida_utc"] = n.LeidaUtc.HasValue ? Fecha(n.LeidaUtc.Value) : null;
            lista.Add(d);
        }
        return new Dictionary<string, object>
        {
            { "disponible", true }, { "no_leidas", b.NoLeidas }, { "limite", LimiteBandeja }, { "notificaciones", lista },
        };
    }
}
