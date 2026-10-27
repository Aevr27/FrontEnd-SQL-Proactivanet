// Quien puede pedir una iniciativa por Nueva solicitud (la pagina
// admin/iniciativas.html y sus cuatro handlers). Quien entra sin rol en
// dbo.UsuariosAdmin es el rol DERIVADO "solicitante": no se guarda en
// ninguna tabla por persona; se calcula en cada request.
//
// LA REGLA (2026-10-26)
// ---------------------
//   ADM                 siempre (pruebas controladas). No mira el
//                       interruptor ni los dueños.
//   MOD                 solo si es PO o SO VIGENTE. No mira el interruptor
//                       (MOD nunca dependio de el). El resto de Admin para
//                       MOD no cambia: AccesoAdmin.Exigir.
//   cualquier otra      interruptor INICIATIVAS_ABIERTAS encendido Y PO o SO
//   cuenta autenticada  VIGENTE. Las dos condiciones.
//   anonimo             nunca.
//
// PO / SO VIGENTE: la cuenta de IIS (AccesoAdmin.IdentidadEscritura) se
// resuelve a UNA persona de dbo.CatPersona con la regla del acuse y de la
// solicitud (IdentidadAcuse.Resolver: cuenta@soriana.com -> exactamente una
// fila vigente con ese Correo y su nombre sin repetir). Esa persona es PO/SO
// vigente si su nombre (IdentidadAcuse.ClaveNombre) es el Product Owner o
// el Service Owner resuelto de alguna fila VIGENTE de dbo.CatCategoriaDueno
// (DirectorioOrganizacional.PoSoVigentes: N2 exacto o heredado del C1, la
// unica resolucion de dueños del sitio). Estar en CatPersona NO basta: solo
// sirve para saber quien es la cuenta. Si deja de ser dueño en una fila
// vigente (o la fila se da de baja), deja de calificar en el siguiente
// request. Cuenta sin resolver (no_encontrado, ambiguo, nombre_repetido),
// sin filas o consulta que falla: NO califica (falla cerrado; el error va a
// DashboardHandler.Registrar).
//
// INTERRUPTOR: fila INICIATIVAS_ABIERTAS de adm.Interruptor
// (sql/30_interruptor_iniciativas.sql). Web.config ya NO cuenta: la clave
// IniciativasAbiertas de appSettings se ignora.
//
//     Encendido = 1  abierto
//     Encendido = 0, sin fila, sin tabla, consulta que falla: APAGADO
//
// Encender / apagar: lo hace un operador autorizado con el UPDATE de la
// cabecera de sql/30 (la cuenta del sitio, PROACTIVANETAD, tiene DENY de
// escritura sobre la tabla). Nada del sitio lo cambia.
//
// Interruptor y dueños se leen como mucho una vez por request
// (HttpContext.Items: el modulo y el handler no repiten la consulta), nunca
// se guardan entre requests y solo cuando hacen falta: para ADM ninguno;
// para MOD solo los dueños; para los demas el interruptor y, solo si esta
// encendido, los dueños.
//
// QUE ABRE
//   la pagina admin/iniciativas.html, en modo solicitante (admin/
//   iniciativas.js, modoSolicitante: Nueva solicitud y Solicitudes), los
//   CUATRO handlers que el formulario usa y "Mis solicitudes":
//     admin_iniciativas_catalogos   (?rutas=1, la cascada; sin ?rutas, la
//                                    Cobertura del registro, sigue abierto a
//                                    ADM/MOD; ?duenos=1 y rutas_adm siguen ADM)
//     admin_iniciativas_capacidad   (capacidad de la categoria elegida)
//     admin_iniciativas_volumetria  (sin alcance=total, que sigue ADM)
//     admin_iniciativas_validar     (validar y guardar la solicitud)
//     admin_iniciativas_mis_solicitudes (2026-10-27; solo lectura, solo las
//                                    que envio la propia cuenta)
//   Todo lo demas de Admin (registro, solicitudes de cambio, acuse, gestion,
//   recientes, diagnostico, correos, alta de categoria) sigue exigiendo ADM
//   o MOD (AccesoAdmin.Exigir / ExigirAdm) y lo protege AdminAccesoModulo
//   igual que antes. Ningun otro modulo del tablero mira esta regla. No da
//   rol: quien entra por aqui sigue siendo VIEWER para AccesoAdmin.Rol.
//
// No es el ciclo de vida de una solicitud ni de una iniciativa: no cambia
// ningun estado, solo quien puede abrir el formulario y enviarlo. Quien
// firma y los correos siguen saliendo de la identidad Windows y de
// dbo.CatPersona (SolicitudIniciativaAlta), nunca del navegador.
//
// Se prueba sin IIS ni SQL en tools/tests/AccesoIniciativasHttpSmoke.cs, y
// la tabla en tools/tests/InterruptorIniciativasSqlLocalDbSmoke.cs.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Web;

// El valor de un interruptor de adm.Interruptor: true/false si hay fila,
// null si no la hay. Lanza si no puede leerlo (eso cuenta como apagado).
public interface IFuenteInterruptores
{
    bool? Encendido(string clave);
}

// La real: SELECT sobre adm.Interruptor (solo lectura).
public sealed class FuenteInterruptoresSql : IFuenteInterruptores
{
    private readonly Func<SqlConnection> abrir;
    public FuenteInterruptoresSql() : this(null) { }
    public FuenteInterruptoresSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    public bool? Encendido(string clave)
    {
        const string sql = "SELECT Encendido FROM adm.Interruptor WHERE Clave = @clave;";
        using (var cn = abrir())
        using (var cmd = new SqlCommand(sql, cn) { CommandType = CommandType.Text, CommandTimeout = 15 })
        {
            cmd.Parameters.Add("@clave", SqlDbType.VarChar, 64).Value = clave ?? string.Empty;
            if (cn.State != ConnectionState.Open) cn.Open();
            var v = cmd.ExecuteScalar();
            if (v == null || v is DBNull) return null;
            return Convert.ToBoolean(v);
        }
    }
}

// Lo que hace falta para saber si una cuenta es PO/SO vigente: las personas
// vigentes de dbo.CatPersona (quien es la cuenta) y el directorio de dueños
// de dbo.CatCategoriaDueno (quien es dueño).
public sealed class DuenosVigentes
{
    public List<PersonaCatalogo> Personas;
    public DirectorioOrganizacional Directorio;
}

// Lanza si no puede leer (eso cuenta como "no es PO/SO").
public interface IFuenteDuenosVigentes
{
    DuenosVigentes Leer();
}

// La real: los mismos SELECT de solo lectura que ya usan el acuse
// (FuentePersonasAcuseSql) y el directorio (DirectorioOrganizacional.Cargar).
public sealed class FuenteDuenosVigentesSql : IFuenteDuenosVigentes
{
    private readonly Func<SqlConnection> abrir;
    public FuenteDuenosVigentesSql() : this(null) { }
    public FuenteDuenosVigentesSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    public DuenosVigentes Leer()
    {
        var d = new DuenosVigentes();
        d.Personas = new FuentePersonasAcuseSql(abrir).Personas();
        using (var cn = abrir())
        {
            if (cn.State != ConnectionState.Open) cn.Open();
            d.Directorio = DirectorioOrganizacional.Cargar(cn);
        }
        return d;
    }
}

public static class AccesoIniciativas
{
    // Clave de la fila en adm.Interruptor.
    public const string ClaveInterruptor = "INICIATIVAS_ABIERTAS";

    // Rutas (relativas a la aplicacion) de Nueva solicitud y Solicitudes.
    public static readonly string[] RutasSolicitante =
    {
        AccesoAdmin.PaginaProtegida,
        "~/handlers/admin_iniciativas_catalogos.ashx",
        "~/handlers/admin_iniciativas_capacidad.ashx",
        "~/handlers/admin_iniciativas_volumetria.ashx",
        "~/handlers/admin_iniciativas_validar.ashx",
        // Solicitudes: las que envio la propia cuenta (misma regla).
        "~/handlers/admin_iniciativas_mis_solicitudes.ashx",
    };

    public const string MensajeCerrado =
        "La solicitud de iniciativas no está abierta para tu cuenta.";

    public const string MensajeSoloDuenos =
        "La solicitud de iniciativas está disponible únicamente para Product Owners (PO) y Service Owners (SO) vigentes.";

    // De donde salen el interruptor y los dueños. Las reales leen la base;
    // las pruebas ponen las suyas para no necesitar SQL Server. Nada del
    // sitio las cambia.
    public static IFuenteInterruptores Fuente = new FuenteInterruptoresSql();
    public static IFuenteDuenosVigentes FuenteDuenos = new FuenteDuenosVigentesSql();

    private const string ClaveRequest = "AccesoIniciativas.Abiertas";
    private const string ClaveDuenosRequest = "AccesoIniciativas.PoSoVigente";

    // La regla sin HttpContext: solo una fila con Encendido = 1 abre. Sin
    // fuente, sin fila o con error: cerrado. `registrar` recibe el error.
    public static bool Leer(IFuenteInterruptores fuente, Action<Exception> registrar)
    {
        if (fuente == null) return false;
        try
        {
            return fuente.Encendido(ClaveInterruptor) == true;
        }
        catch (Exception ex)
        {
            if (registrar != null) registrar(ex);
            return false;
        }
    }

    // El interruptor para el request en curso: una lectura por request
    // (HttpContext.Items), nunca guardado entre requests.
    public static bool Abiertas(HttpContext context)
    {
        var guardado = context == null ? null : context.Items[ClaveRequest] as bool?;
        if (guardado.HasValue) return guardado.Value;
        var v = Leer(Fuente, delegate (Exception ex) { AccesoAdmin.MarcarVerificacionIncompleta(context); DashboardHandler.Registrar("AccesoIniciativas.Abiertas", ex); });
        if (context != null) context.Items[ClaveRequest] = v;
        return v;
    }

    // La regla de dueños sin HttpContext: la cuenta se resuelve a UNA
    // persona (IdentidadAcuse.Resolver) y su nombre es PO o SO de una fila
    // vigente (DirectorioOrganizacional.PoSoVigentes). Cualquier otra cosa: false.
    public static bool EsPoSoVigente(IdentidadWindows id, DuenosVigentes d)
    {
        if (d == null || d.Directorio == null) return false;
        var yo = IdentidadAcuse.Resolver(id, d.Personas);
        if (!yo.EsResuelta) return false;
        foreach (var nombre in d.Directorio.PoSoVigentes())
            if (yo.EsDueno(nombre)) return true;
        return false;
    }

    // Lo mismo con la fuente: sin fuente o con error, false. `registrar`
    // recibe el error.
    public static bool LeerPoSoVigente(IFuenteDuenosVigentes fuente, IdentidadWindows id, Action<Exception> registrar)
    {
        if (fuente == null || id == null || !id.Autenticada) return false;
        try
        {
            return EsPoSoVigente(id, fuente.Leer());
        }
        catch (Exception ex)
        {
            if (registrar != null) registrar(ex);
            return false;
        }
    }

    // PO/SO vigente para el request en curso: una lectura por request.
    public static bool PoSoVigente(HttpContext context, IdentidadWindows id)
    {
        var guardado = context == null ? null : context.Items[ClaveDuenosRequest] as bool?;
        if (guardado.HasValue) return guardado.Value;
        var v = LeerPoSoVigente(FuenteDuenos, id, delegate (Exception ex) { AccesoAdmin.MarcarVerificacionIncompleta(context); DashboardHandler.Registrar("AccesoIniciativas.PoSoVigente", ex); });
        if (context != null) context.Items[ClaveDuenosRequest] = v;
        return v;
    }

    public static bool EsRutaSolicitante(string rutaRelativa)
    {
        if (string.IsNullOrEmpty(rutaRelativa)) return false;
        foreach (var r in RutasSolicitante)
            if (string.Equals(rutaRelativa, r, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // La regla sin HttpContext (ver LA REGLA arriba). null = puede; si no,
    // el mensaje del 403. `rol`: el de AccesoAdmin solo si entra a Admin
    // (null para los demas). Interruptor y dueños se piden solo si hacen
    // falta, en ese orden.
    public static string Evaluar(string rol, IdentidadWindows id, Func<bool> abiertas, Func<bool> poSoVigente)
    {
        if (rol == RolAdmin.Adm) return null;
        if (id == null || !id.Autenticada) return MensajeCerrado;
        if (rol != RolAdmin.Mod && !abiertas()) return MensajeCerrado;
        return poSoVigente() ? null : MensajeSoloDuenos;
    }

    // Por que no puede abrir Nueva solicitud ni enviarla, o null si puede.
    public static string Motivo(HttpContext context)
    {
        var rol = AccesoAdmin.PuedeEntrar(context) ? AccesoAdmin.Rol(context) : null;
        var id = AccesoAdmin.IdentidadEscritura(context);
        return Evaluar(rol, id,
            delegate { return Abiertas(context); },
            delegate { return PoSoVigente(context, id); });
    }

    public static bool PuedeSolicitar(HttpContext context)
    {
        return Motivo(context) == null;
    }

    // Entro sin rol ADM/MOD (interruptor + PO/SO). Solo para la interfaz.
    public static bool EsSoloSolicitante(HttpContext context)
    {
        return !AccesoAdmin.PuedeEntrar(context) && PuedeSolicitar(context);
    }

    // Para los cuatro handlers de Nueva solicitud: true si sigue; si no, ya
    // respondio 403 AccesoDenegado en JSON y hay que salir.
    public static bool ExigirSolicitud(HttpContext context)
    {
        var motivo = Motivo(context);
        if (motivo == null) return true;
        Rechazar(context, true, motivo);
        return false;
    }

    // El 403 de AccesoAdmin (mismo {error, tipo: AccesoDenegado}) con el
    // mensaje de por que no puede (por omision, el de Motivo).
    public static void Rechazar(HttpContext context, bool json, string mensaje = null)
    {
        AccesoAdmin.Rechazar(context, json, mensaje ?? Motivo(context) ?? MensajeCerrado);
    }
}
