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
// EXCEPCION ADM (pruebas controladas): si quien envia es ADM (el rol lo
// resuelve el servidor, AccesoAdmin.Rol; nunca el navegador) y su cuenta no
// se resuelve a una persona (no_encontrado, ambiguo, nombre_repetido o sin
// correo), la solicitud NO se rechaza por eso: nombre y correo quedan null
// (no se inventan ni se elige una fila), SolicitanteEstado guarda el motivo
// real y Cuenta la identidad Windows. Sin identidad autenticada no hay
// excepcion. MOD y el rol derivado "solicitante" siguen con la regla
// estricta. SOLO valida: con sql/29 no se puede guardar sin correo de
// CatPersona (NOT NULL + 51405 en adm.usp_SolicitudIniciativa_Crear), asi
// que IniciativaService la rechaza antes de llamar al almacen
// (MensajeExcepcionSinGuardar).
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

    public string Cuenta;              // IdentidadWindows.Original
    public string SolicitanteEstado;   // IdentidadAcuse.Estado
    public string SolicitanteNombre;
    public string SolicitanteCorreo;
    public string ProductOwnerCorreo;
    public bool ExcepcionAdm;          // ADM sin persona: valida sin nombre ni correo

    public const string MensajeExcepcionSinGuardar =
        "Como ADM puedes validar la solicitud sin estar en CatPersona, pero para guardarla la base exige el correo de una persona vigente de CatPersona. Pide que te registren.";

    public bool Resuelto { get { return SolicitanteCorreo != null && ProductOwnerCorreo != null; } }

    public static bool EsCorreo(string c)
    {
        return c != null && c.Length <= 255 && Forma.IsMatch(c);
    }

    // Resuelve y agrega a `r` los errores (campo solicitante / po). `po` es
    // el Product Owner tal como lo valido ValidadorIniciativa; si el PO ya
    // tiene error ahi, no se busca su correo. `esAdm`: el rol ADM que ya
    // resolvio el servidor (ver EXCEPCION ADM arriba).
    public static DestinatariosSolicitud Resolver(IdentidadWindows id, string po, IList<PersonaCatalogo> personas,
                                                  ValidadorIniciativa.Resultado r, bool esAdm = false)
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
            }
            else d.SolicitanteEstado = DirectorioPersonas.SinCorreo;
        }
        if (d.SolicitanteCorreo == null)
        {
            if (esAdm && d.Cuenta != null && d.SolicitanteEstado != IdentidadAcuse.SinIdentidad) d.ExcepcionAdm = true;
            else if (r != null) r.Agregar(CampoSolicitante, MensajeSolicitante(d.SolicitanteEstado, id));
        }

        if (r != null && r.TieneError(SolicitudIniciativa.CPo)) return d;
        var clave = IdentidadAcuse.ClaveNombre(po);
        if (clave == null) return d;   // "Falta el Product Owner" ya lo dijo el validador
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
}

// Un error que la base lanzo a proposito (51401-51409).
public sealed class ErrorSolicitud : Exception
{
    public readonly int Numero;
    public ErrorSolicitud(int numero, string mensaje) : base(mensaje) { Numero = numero; }
}

public interface IAlmacenSolicitudes
{
    bool Disponible();
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
            try { cmd.ExecuteNonQuery(); }
            catch (SqlException ex)
            {
                if (ex.Number >= 51401 && ex.Number <= 51409) throw new ErrorSolicitud(ex.Number, ex.Message);
                throw;
            }
            return new SolicitudGuardada
            {
                Numero = new NumeroSolicitud((int)num.Value),
                Nuevo = (bool)nuevo.Value,
                FechaUtc = (DateTime)fecha.Value,
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
