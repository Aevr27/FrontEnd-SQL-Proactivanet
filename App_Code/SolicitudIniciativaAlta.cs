// Nueva solicitud GUARDADA (sql/29_solicitud_iniciativa.sql): quien la
// manda, a que Product Owner va y el almacen que le da numero.
//
//   handlers/admin_iniciativas_validar.ashx
//       -> IniciativaService.Solicitar(solicitud, identidad)
//            ValidadorIniciativa            (las reglas del formulario)
//            DestinatariosSolicitud         (aqui: solicitante y correo del PO)
//            IAlmacenSolicitudes.Crear      (aqui: adm.usp_SolicitudIniciativa_Crear)
//
// IDENTIDAD DEL SOLICITANTE: la MISMA regla del acuse PO/SO
// (IdentidadAcuse.Resolver, App_Code/AcuseIniciativa.cs): la cuenta de IIS
// (AccesoAdmin.IdentidadEscritura) -> cuenta@soriana.com -> EXACTAMENTE una
// fila vigente de dbo.CatPersona con ese Correo, y su nombre no repetido en
// otra fila. Lo que se guarda es el Nombre y el Correo de ESA fila. Nada
// viene del navegador: ni nombre, ni cuenta, ni correo.
//
// ADM / MOD SIN CatPersona (2026-10-29, sql/35 + 36): dbo.UsuariosAdmin es la
// fuente de quien es ADM o MOD, y estar ahi basta para enviar. Si quien
// envia tiene rol ADM o MOD (AccesoAdmin.Rol: dbo.UsuariosAdmin, del
// servidor; nunca el navegador) y su cuenta no se resuelve a una persona
// con correo (no_encontrado, ambiguo, nombre_repetido o sin correo), el
// correo es el UNICO dbo.UsuariosAdmin.CorreoUsuario de su cuenta
// (CorreoAdmin.Para, por la cuenta autenticada) y el nombre queda null (no
// se arma con la cuenta). FuenteSolicitante = USUARIOSADMIN; la cuenta
// Windows va en SolicitanteCuenta como siempre. Sin CorreoUsuario unico y
// valido: error en "solicitante", nada se guarda. Quien SI se resuelve en
// CatPersona sigue por CatPersona (con su nombre), tenga o no rol. El rol
// derivado "solicitante" (PO/SO sin rol) sigue con la regla estricta de
// CatPersona. Guardar asi exige sql/36: adm.usp_SolicitudIniciativa_Crear
// decide la fuente con sus tablas y la MISMA regla (51405 / 51417 / 51418;
// CATPERSONA solo con el correo de la cuenta) y el nombre USUARIOSADMIN lo
// pone ella (dbo.UsuariosAdmin.NombreSolicitante de sql/35, NULL valido): lo
// guardado vuelve en SolicitudGuardada. Sin sql/36 IniciativaService lo
// rechaza antes del almacen (MensajeSinSql35).
//
// CORREO DEL PRODUCT OWNER: el PO elegido ya paso por ValidadorIniciativa
// (sale con SO y Categoria de una fila vigente de la cascada,
// CatalogoRutasIniciativa). Su correo es el de la UNICA fila vigente de
// dbo.CatPersona cuyo nombre es el mismo (IdentidadAcuse.ClaveNombre: sin
// acentos, mayusculas ni espacios de mas; es como se decide que alguien es
// el PO en el acuse). Cero filas, mas de una, o sin correo valido: no se
// guarda (no se elige uno ni se arma con el nombre).
//
// No manda correos: no hay mecanismo de aviso confirmado para una
// solicitud. Guardar y avisar quedan separados: los correos se guardan como
// foto del envio y un aviso futuro los lee de la fila, sin rehacer el alta.
//
// Se prueba sin SQL en tools/tests/SolicitudIniciativaAltaSmoke.cs y contra
// LocalDB en tools/tests/SolicitudIniciativaSqlLocalDbSmoke.cs.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Text.RegularExpressions;

// ---------------------------------------------------------------------------
// Solicitante y correo del PO
// ---------------------------------------------------------------------------
public sealed class DestinatariosSolicitud
{
    public const string CampoSolicitante = "solicitante";

    // Algo@algo.algo, sin espacios ni marcado (la forma de CorreoAdmin).
    private static readonly Regex Forma = new Regex(@"^[^\s@<>""']+@[^\s@<>""']+\.[^\s@<>""']+$", RegexOptions.CultureInvariant);

    // De donde salio el correo del solicitante (adm.SolicitudIniciativa.FuenteCorreos).
    public const string FuenteCatPersona = "CATPERSONA";
    public const string FuenteUsuariosAdmin = "USUARIOSADMIN";

    public string Cuenta;              // IdentidadWindows.Original
    public string SolicitanteEstado;   // IdentidadAcuse.Estado
    public string SolicitanteNombre;   // null con FuenteUsuariosAdmin
    public string SolicitanteCorreo;
    public string FuenteSolicitante;   // FuenteCatPersona | FuenteUsuariosAdmin | null (sin resolver)
    public string ProductOwnerCorreo;

    public const string MensajeSinSql35 =
        "Tu cuenta es ADM o MOD pero no est\u00e1 en el directorio de personas (CatPersona), y la base todav\u00eda no acepta solicitudes de ADM/MOD sin CatPersona (faltan sql/35 y sql/36). No se guard\u00f3 nada.";

    public bool Resuelto { get { return SolicitanteCorreo != null && ProductOwnerCorreo != null; } }

    public static bool EsCorreo(string c)
    {
        return c != null && c.Length <= 255 && Forma.IsMatch(c);
    }

    // Resuelve y agrega a `r` los errores (campo solicitante / po). `po` es
    // el Product Owner tal como lo valido ValidadorIniciativa; si el PO ya
    // tiene error ahi, no se busca su correo. `rol`: AccesoAdmin.Rol que ya
    // resolvio el servidor; `correoUsuariosAdmin`: CorreoAdmin.Para de la
    // cuenta autenticada, solo se pide si hace falta (ver ADM / MOD SIN
    // CatPersona arriba).
    public static DestinatariosSolicitud Resolver(IdentidadWindows id, string po, IList<PersonaCatalogo> personas,
                                                  ValidadorIniciativa.Resultado r, string rol = null,
                                                  Func<string> correoUsuariosAdmin = null)
    {
        personas = personas ?? new List<PersonaCatalogo>();
        var d = new DestinatariosSolicitud();
        d.Cuenta = id != null && id.Autenticada ? id.Original : null;

        var yo = IdentidadAcuse.Resolver(id, personas);
        d.SolicitanteEstado = yo.Estado;
        if (yo.EsResuelta)
        {
            PersonaCatalogo fila = null;
            foreach (var p in personas)
                if (IdentidadAcuse.ClaveCorreo(p.Correo) == yo.Correo) { fila = p; break; }
            var correo = fila == null ? null : IdentidadAcuse.ClaveCorreo(fila.Correo);
            if (EsCorreo(correo))
            {
                d.SolicitanteNombre = yo.Nombre;
                d.SolicitanteCorreo = correo;
                d.FuenteSolicitante = FuenteCatPersona;
            }
            else d.SolicitanteEstado = DirectorioPersonas.SinCorreo;
        }
        if (d.SolicitanteCorreo == null)
        {
            if (RolAdmin.EsElevado(rol) && d.Cuenta != null && d.SolicitanteEstado != IdentidadAcuse.SinIdentidad)
            {
                var c = correoUsuariosAdmin == null ? null : IdentidadAcuse.ClaveCorreo(correoUsuariosAdmin());
                if (EsCorreo(c))
                {
                    d.SolicitanteCorreo = c;
                    d.FuenteSolicitante = FuenteUsuariosAdmin;
                }
                else if (r != null) r.Agregar(CampoSolicitante, MensajeSinCorreoAdmin(d.Cuenta));
            }
            else if (r != null) r.Agregar(CampoSolicitante, MensajeSolicitante(d.SolicitanteEstado, id));
        }

        if (r != null && r.TieneError(SolicitudIniciativa.CPo)) return d;
        var clave = IdentidadAcuse.ClaveNombre(po);
        if (clave == null)
        {
            // Vacio: "Falta el Product Owner" ya lo dijo el validador. Con
            // texto: Unicode invalido (ClaveNombre), no se busca su correo.
            if (DirectorioOrganizacional.Normaliza(po) != null && r != null)
                r.Agregar(SolicitudIniciativa.CPo, "El nombre del Product Owner tiene caracteres inv\u00e1lidos; no se puede buscar su correo.");
            return d;
        }
        var filas = new List<PersonaCatalogo>();
        foreach (var p in personas)
            if (IdentidadAcuse.ClaveNombre(p.Nombre) == clave) filas.Add(p);
        string motivo = null;
        if (filas.Count == 0) motivo = "El Product Owner no est\u00e1 en el directorio de personas (CatPersona); no se sabe a qu\u00e9 correo avisarle.";
        else if (filas.Count > 1) motivo = "Hay m\u00e1s de una persona con el nombre del Product Owner en CatPersona; no se puede saber cu\u00e1l es su correo.";
        else
        {
            var c = IdentidadAcuse.ClaveCorreo(filas[0].Correo);
            if (EsCorreo(c)) d.ProductOwnerCorreo = c;
            else motivo = "El Product Owner no tiene un correo v\u00e1lido en CatPersona.";
        }
        if (motivo != null && r != null) r.Agregar(SolicitudIniciativa.CPo, motivo);
        return d;
    }

    public static string MensajeSinCorreoAdmin(string cuenta)
    {
        return "Tu cuenta (" + cuenta + ") es ADM o MOD pero no est\u00e1 en el directorio de personas (CatPersona) ni tiene un correo \u00fanico y v\u00e1lido en dbo.UsuariosAdmin (CorreoUsuario). Pide que lo registren para poder enviar solicitudes.";
    }

    public static string MensajeSolicitante(string estado, IdentidadWindows id)
    {
        var cuenta = id != null && id.Autenticada ? id.Original : null;
        if (estado == IdentidadAcuse.SinIdentidad || cuenta == null)
            return "No hay una cuenta Windows autenticada: la solicitud no se puede atribuir a nadie.";
        var correo = id.CorreoCandidato();
        if (estado == IdentidadAcuse.Ambiguo)
            return "El correo " + correo + " de tu cuenta (" + cuenta + ") est\u00e1 en m\u00e1s de una persona de CatPersona. Pide que se corrija el directorio.";
        if (estado == IdentidadAcuse.NombreRepetido)
            return "Tu nombre en CatPersona est\u00e1 repetido en otra persona; la solicitud no se puede atribuir a una sola. Pide que se corrija el directorio.";
        if (estado == DirectorioPersonas.SinCorreo)
            return "Tu persona en CatPersona no tiene un correo v\u00e1lido. Pide que se corrija el directorio.";
        return "Tu cuenta (" + cuenta + ") no est\u00e1 en el directorio de personas (CatPersona) con el correo " + correo +
               ". Pide que te registren para poder enviar solicitudes.";
    }
}

// ---------------------------------------------------------------------------
// Almacen (sql/29)
// ---------------------------------------------------------------------------
public sealed class SolicitudGuardada
{
    public NumeroSolicitud Numero;
    public bool Nuevo;          // false = ya estaba (mismo token)
    public DateTime FechaUtc;
    // sql/36: lo que la base GUARDO (null sin sql/36 o sin AltaSolicitud.ConFuente).
    public string Fuente;
    public string NombreGuardado;
}

// Lo que se guarda: lo validado + la foto de los destinatarios.
public sealed class AltaSolicitud
{
    public string Cuenta;
    public Guid Token;
    public string Tipo, Po, So, Categoria, Director, Titulo, Descripcion, Observaciones, RcaExtension;
    public int Volumetria;
    public decimal Pct;
    public string SolicitanteNombre, SolicitanteCorreo, ProductOwnerCorreo;
    // La base tiene sql/36 (AceptaSolicitanteAdmin): pedir @FuenteSolicitante
    // y @NombreGuardado. Sin sql/36 esos parametros no existen.
    public bool ConFuente;
}

// Un error que la base lanzo a proposito (51401-51409; 51417 y 51418 de sql/36).
public sealed class ErrorSolicitud : Exception
{
    public readonly int Numero;
    public ErrorSolicitud(int numero, string mensaje) : base(mensaje) { Numero = numero; }
}

public interface IAlmacenSolicitudes
{
    bool Disponible();
    // sql/36: _Crear acepta un solicitante ADM/MOD de dbo.UsuariosAdmin sin
    // CatPersona (FuenteCorreos USUARIOSADMIN, nombre de UsuariosAdmin o NULL).
    bool AceptaSolicitanteAdmin();
    SolicitudGuardada Crear(AltaSolicitud a);
}

public sealed class AlmacenSolicitudesSql : IAlmacenSolicitudes
{
    private readonly Func<SqlConnection> abrir;
    public AlmacenSolicitudesSql() : this(null) { }
    public AlmacenSolicitudesSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    private SqlConnection Abierta()
    {
        var cn = abrir();
        if (cn.State != ConnectionState.Open) cn.Open();
        return cn;
    }

    // Las cuatro piezas de sql/29. Un error al revisar cuenta como "sin sql/29".
    public const string ConsultaDeteccion =
        "SELECT CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaContador', N'U') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.SolicitudIniciativaEvento', N'U') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P') IS NOT NULL THEN 1 ELSE 0 END";

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

    // sql/36 por el parametro @FuenteSolicitante de _Crear: la cuenta del
    // sitio ve sys.parameters (no el texto del procedimiento; probado en
    // LocalDB). El rollback de procedimiento de 36 lo quita y el sitio vuelve
    // a la regla de sql/29. Un error al revisar cuenta como "sin sql/36".
    public const string ConsultaSolicitanteAdmin =
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P') " +
        " AND name = N'@FuenteSolicitante') THEN 1 ELSE 0 END";

    public bool AceptaSolicitanteAdmin()
    {
        try
        {
            using (var cn = Abierta())
            using (var cmd = new SqlCommand(ConsultaSolicitanteAdmin, cn) { CommandTimeout = 15 })
                return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
        }
        catch (SqlException) { return false; }
    }

    public SolicitudGuardada Crear(AltaSolicitud a)
    {
        if (a == null) throw new ArgumentNullException("a");
        using (var cn = Abierta())
        using (var cmd = new SqlCommand("adm.usp_SolicitudIniciativa_Crear", cn) { CommandType = CommandType.StoredProcedure })
        {
            Func<string, object> v = delegate (string s) { return (object)s ?? DBNull.Value; };
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = v(a.Cuenta);
            cmd.Parameters.Add("@Token", SqlDbType.UniqueIdentifier).Value = a.Token == Guid.Empty ? (object)DBNull.Value : a.Token;
            cmd.Parameters.Add("@TipoIniciativa", SqlDbType.NVarChar, 100).Value = v(a.Tipo);
            cmd.Parameters.Add("@ProductOwner", SqlDbType.NVarChar, 255).Value = v(a.Po);
            cmd.Parameters.Add("@ServiceOwner", SqlDbType.NVarChar, 255).Value = v(a.So);
            cmd.Parameters.Add("@Categoria", SqlDbType.NVarChar, 450).Value = v(a.Categoria);
            cmd.Parameters.Add("@Director", SqlDbType.NVarChar, 255).Value = v(a.Director);
            cmd.Parameters.Add("@Titulo", SqlDbType.NVarChar, -1).Value = v(a.Titulo);
            cmd.Parameters.Add("@Descripcion", SqlDbType.NVarChar, -1).Value = v(a.Descripcion);
            cmd.Parameters.Add("@Observaciones", SqlDbType.NVarChar, -1).Value = v(a.Observaciones);
            cmd.Parameters.Add("@Volumetria", SqlDbType.Int).Value = a.Volumetria;
            var pct = cmd.Parameters.Add("@PctDisminucion", SqlDbType.Decimal); pct.Precision = 9; pct.Scale = 4; pct.Value = a.Pct;
            cmd.Parameters.Add("@RcaExtension", SqlDbType.NVarChar, 10).Value = v(a.RcaExtension);
            cmd.Parameters.Add("@SolicitanteNombre", SqlDbType.NVarChar, 255).Value = v(a.SolicitanteNombre);
            cmd.Parameters.Add("@SolicitanteCorreo", SqlDbType.NVarChar, 255).Value = v(a.SolicitanteCorreo);
            cmd.Parameters.Add("@ProductOwnerCorreo", SqlDbType.NVarChar, 255).Value = v(a.ProductOwnerCorreo);
            var num = cmd.Parameters.Add("@NumeroSolicitud", SqlDbType.Int); num.Direction = ParameterDirection.Output;
            var nuevo = cmd.Parameters.Add("@Nuevo", SqlDbType.Bit); nuevo.Direction = ParameterDirection.Output;
            var fecha = cmd.Parameters.Add("@FechaUtc", SqlDbType.DateTime2); fecha.Direction = ParameterDirection.Output;
            SqlParameter fuente = null, nombre = null;
            if (a.ConFuente)
            {
                fuente = cmd.Parameters.Add("@FuenteSolicitante", SqlDbType.VarChar, 16); fuente.Direction = ParameterDirection.Output;
                nombre = cmd.Parameters.Add("@NombreGuardado", SqlDbType.NVarChar, 255); nombre.Direction = ParameterDirection.Output;
            }
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex)
            {
                if ((ex.Number >= 51401 && ex.Number <= 51409) || ex.Number == 51417 || ex.Number == 51418) throw new ErrorSolicitud(ex.Number, ex.Message);
                throw;
            }
            return new SolicitudGuardada
            {
                Numero = new NumeroSolicitud((int)num.Value),
                Nuevo = (bool)nuevo.Value,
                FechaUtc = (DateTime)fecha.Value,
                Fuente = fuente == null || fuente.Value == DBNull.Value ? null : (string)fuente.Value,
                NombreGuardado = nombre == null || nombre.Value == DBNull.Value ? null : (string)nombre.Value,
            };
        }
    }
}

// Lo que el handler usa; las pruebas lo cambian por falsos.
public static class SolicitudesIniciativa
{
    public static IAlmacenSolicitudes Almacen = new AlmacenSolicitudesSql();
    public static IFuentePersonasAcuse Personas = new FuentePersonasAcuseSql();

    // El token del borrador ("token" del formulario), o Guid.Empty si no
    // vino o no es un GUID. Solo evita duplicados: no dice quien es nadie.
    public static Guid Token(string valor)
    {
        Guid g;
        return valor != null && Guid.TryParse(valor.Trim(), out g) ? g : Guid.Empty;
    }
}
