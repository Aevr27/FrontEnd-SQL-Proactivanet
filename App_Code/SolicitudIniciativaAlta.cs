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
    // sql/42 (Modificar = reemplazo): la solicitud ENVIADA que esta corrige
    // (0 = envio nuevo) y por que se cancela la original.
    public int ReemplazaA;
    public string MotivoCancelacion;
}

// Un error que la base lanzo a proposito (51401-51409; 51417 y 51418 de
// sql/36; 51411 y 51419-51424 de cancelar / reemplazar, sql/42).
public sealed class ErrorSolicitud : Exception
{
    public readonly int Numero;
    public ErrorSolicitud(int numero, string mensaje) : base(MensajeDe(numero, mensaje)) { Numero = numero; }

    // sql/42: un texto para quien envio (el de la base no lleva acentos).
    // Los numeros de antes conservan el de la base.
    public static string MensajeDe(int numero, string mensaje)
    {
        switch (numero)
        {
            case 51411: return "La solicitud no existe.";
            case 51419: return "Explica por qu\u00e9 cancelas la solicitud.";
            case 51420: return "El motivo de la cancelaci\u00f3n no puede pasar de 2000 caracteres.";
            case 51421: return "La solicitud ya no est\u00e1 pendiente: un administrador la revis\u00f3 (aprob\u00f3 o rechaz\u00f3) o ya estaba cancelada. No se cambi\u00f3 nada; actualiza para ver su estado.";
            case 51422: return "No se pudo reemplazar la solicitud (transacci\u00f3n anidada). No se cambi\u00f3 nada.";
            case 51423: return "Este borrador ya se us\u00f3 en otra solicitud. Vuelve a abrir \u00abModificar\u00bb y env\u00edala de nuevo.";
            case 51424: return "No se cre\u00f3 la solicitud nueva: la original sigue pendiente y no se cambi\u00f3 nada.";
            default: return mensaje;
        }
    }

    public static bool EsDeCancelacion(int numero) { return numero == 51411 || (numero >= 51419 && numero <= 51424); }

    // Solo para cancelar / reemplazar (los demas los decide el handler como siempre).
    public int EstadoHttp
    {
        get
        {
            if (Numero == 51411) return 404;
            if (Numero == 51421 || Numero == 51423 || Numero == 51409) return 409;
            if (Numero == 51422 || Numero == 51424) return 500;
            return 422;
        }
    }

    public string Tipo
    {
        get
        {
            switch (Numero)
            {
                case 51411: return "SolicitudNoExiste";
                case 51419: return "FaltaMotivoCancelacion";
                case 51420: return "MotivoCancelacionLargo";
                case 51421: return "SolicitudNoPendiente";
                case 51422: return "ReemplazoNoConfirmado";
                case 51423: return "TokenUsado";
                case 51424: return "ReemplazoNoCreado";
                case 51409: return "TokenAjeno";
                default: return "SolicitudRechazada";
            }
        }
    }
}

// CANCELAR / REEMPLAZAR una Nueva solicitud ENVIADA por QUIEN LA ENVIO
// (sql/42). usuario = la cuenta de IIS, nunca del navegador. La base vuelve
// a comprobar que es suya y ENVIADA con el MISMO candado que Aprobar /
// Rechazar / AprobarYCrear (gana el primero: 51421 al que llega tarde).
// Reemplazar crea la nueva con adm.usp_SolicitudIniciativa_Crear TAL CUAL
// (otro numero del contador, ENVIADA, ReemplazaA = la original) y cancela
// la original, todo o nada.
public interface ICancelacionSolicitudesIniciativa
{
    bool Disponible();   // los dos procedimientos de sql/42; un error = false
    void Cancelar(int numero, string usuario, string motivo);
    SolicitudGuardada Reemplazar(AltaSolicitud a);   // a.ReemplazaA > 0
}

public interface IAlmacenSolicitudes
{
    bool Disponible();
    // sql/36: _Crear acepta un solicitante ADM/MOD de dbo.UsuariosAdmin sin
    // CatPersona (FuenteCorreos USUARIOSADMIN, nombre de UsuariosAdmin o NULL).
    bool AceptaSolicitanteAdmin();
    SolicitudGuardada Crear(AltaSolicitud a);
}

public sealed class AlmacenSolicitudesSql : IAlmacenSolicitudes, ICancelacionSolicitudesIniciativa
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

    // sql/42: los dos procedimientos (la cuenta del sitio ve sys.procedures).
    public const string ConsultaCancelacion =
        "SELECT CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NOT NULL " +
        " AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NOT NULL THEN 1 ELSE 0 END";

    bool ICancelacionSolicitudesIniciativa.Disponible()
    {
        try
        {
            using (var cn = Abierta())
            using (var cmd = new SqlCommand(ConsultaCancelacion, cn) { CommandTimeout = 15 })
                return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
        }
        catch (SqlException) { return false; }
    }

    public void Cancelar(int numero, string usuario, string motivo)
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand("adm.usp_SolicitudIniciativa_Cancelar", cn) { CommandType = CommandType.StoredProcedure, CommandTimeout = 30 })
        {
            cmd.Parameters.Add("@NumeroSolicitud", SqlDbType.Int).Value = numero;
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = (object)usuario ?? DBNull.Value;
            cmd.Parameters.Add("@Motivo", SqlDbType.NVarChar, 4000).Value = (object)motivo ?? DBNull.Value;
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex)
            {
                if (ex.Number == 51401 || ErrorSolicitud.EsDeCancelacion(ex.Number)) throw new ErrorSolicitud(ex.Number, ex.Message);
                throw;
            }
        }
    }

    public SolicitudGuardada Crear(AltaSolicitud a)
    {
        if (a == null) throw new ArgumentNullException("a");
        return Guardar("adm.usp_SolicitudIniciativa_Crear", a, false);
    }

    // sql/42: los MISMOS parametros que Crear mas la original y el motivo.
    // @FuenteSolicitante / @NombreGuardado siempre (Reemplazar los tiene).
    public SolicitudGuardada Reemplazar(AltaSolicitud a)
    {
        if (a == null) throw new ArgumentNullException("a");
        if (a.ReemplazaA <= 0) throw new ArgumentOutOfRangeException("a", "ReemplazaA");
        return Guardar("adm.usp_SolicitudIniciativa_Reemplazar", a, true);
    }

    private SolicitudGuardada Guardar(string procedimiento, AltaSolicitud a, bool reemplazo)
    {
        using (var cn = Abierta())
        using (var cmd = new SqlCommand(procedimiento, cn) { CommandType = CommandType.StoredProcedure })
        {
            if (reemplazo)
            {
                cmd.Parameters.Add("@ReemplazaA", SqlDbType.Int).Value = a.ReemplazaA;
                cmd.Parameters.Add("@MotivoCancelacion", SqlDbType.NVarChar, 4000).Value = (object)a.MotivoCancelacion ?? DBNull.Value;
            }
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
            if (a.ConFuente || reemplazo)
            {
                fuente = cmd.Parameters.Add("@FuenteSolicitante", SqlDbType.VarChar, 16); fuente.Direction = ParameterDirection.Output;
                nombre = cmd.Parameters.Add("@NombreGuardado", SqlDbType.NVarChar, 255); nombre.Direction = ParameterDirection.Output;
            }
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex)
            {
                if ((ex.Number >= 51401 && ex.Number <= 51409) || ex.Number == 51417 || ex.Number == 51418) throw new ErrorSolicitud(ex.Number, ex.Message);
                if (reemplazo && ErrorSolicitud.EsDeCancelacion(ex.Number)) throw new ErrorSolicitud(ex.Number, ex.Message);
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
    // Cancelar / reemplazar por quien la envio (sql/42).
    public static ICancelacionSolicitudesIniciativa Cancelaciones = new AlmacenSolicitudesSql();
    public const int MaximoMotivoCancelacion = 2000;
    public static IFuentePersonasAcuse Personas = new FuentePersonasAcuseSql();

    // El token del borrador ("token" del formulario), o Guid.Empty si no
    // vino o no es un GUID. Solo evita duplicados: no dice quien es nadie.
    public static Guid Token(string valor)
    {
        Guid g;
        return valor != null && Guid.TryParse(valor.Trim(), out g) ? g : Guid.Empty;
    }
}
