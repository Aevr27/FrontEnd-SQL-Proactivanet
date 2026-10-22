// Interruptor global "Iniciativas abiertas": deja que cualquier cuenta
// Windows autenticada (sin rol en dbo.UsuariosAdmin) pida una iniciativa
// por Nueva solicitud. Quien entra asi es el rol DERIVADO "solicitante": no
// se guarda en ninguna tabla por persona; se calcula en cada request.
//
// CONFIGURACION: la BASE, fila INICIATIVAS_ABIERTAS de adm.Interruptor
// (sql/30_interruptor_iniciativas.sql). Web.config ya NO cuenta: la clave
// IniciativasAbiertas de appSettings se ignora.
//
//     Encendido = 1  abierto
//     Encendido = 0, sin fila, sin tabla, consulta que falla: APAGADO
//     (falla cerrado; el error va a DashboardHandler.Registrar).
//
// Se lee como mucho una vez por request (HttpContext.Items: el modulo y el
// handler no repiten la consulta) y nunca se guarda entre requests: apagarlo
// en la base vale en el siguiente request, sin reiniciar la aplicacion. Solo
// se lee para una cuenta autenticada que NO es ADM/MOD.
//
// Encender / apagar: lo hace un operador autorizado con el UPDATE de la
// cabecera de sql/30 (la cuenta del sitio, PROACTIVANETAD, tiene DENY de
// escritura sobre la tabla). Nada del sitio lo cambia.
//
// QUE ABRE (solo esto, y solo con el interruptor encendido)
//   la pagina admin/iniciativas.html, en modo "solo Nueva solicitud"
//   (admin/iniciativas.js, modoSolicitante) y los CUATRO handlers que ese
//   formulario usa:
//     admin_iniciativas_catalogos   (tipos y cascada; ?duenos=1 sigue ADM;
//                                    rutas_adm sigue ADM)
//     admin_iniciativas_capacidad   (capacidad de la categoria elegida)
//     admin_iniciativas_volumetria  (sin alcance=total, que sigue ADM)
//     admin_iniciativas_validar     (validar y guardar la solicitud)
//   Todo lo demas de Admin (registro, solicitudes de cambio, acuse, gestion,
//   recientes, diagnostico, correos, alta de categoria) sigue exigiendo ADM
//   o MOD (AccesoAdmin.Exigir / ExigirAdm) y lo protege AdminAccesoModulo
//   igual que antes. Ningun otro modulo del tablero mira este interruptor.
//
// ADM y MOD no dependen del interruptor: entran como siempre
// (AccesoAdmin.PuedeEntrar) y para ellos ni se lee. El interruptor no da
// rol: quien entra por aqui sigue siendo VIEWER para AccesoAdmin.Rol.
//
// No es el ciclo de vida de una solicitud ni de una iniciativa: no cambia
// ningun estado, solo quien puede abrir el formulario y enviarlo. Quien
// firma y los correos siguen saliendo de la identidad Windows y de
// dbo.CatPersona (SolicitudIniciativaAlta), nunca del navegador.
//
// Se prueba sin IIS ni SQL en tools/tests/AccesoIniciativasHttpSmoke.cs, y
// la tabla en tools/tests/InterruptorIniciativasSqlLocalDbSmoke.cs.

using System;
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

public static class AccesoIniciativas
{
    // Clave de la fila en adm.Interruptor.
    public const string ClaveInterruptor = "INICIATIVAS_ABIERTAS";

    // Rutas (relativas a la aplicacion) que abre el interruptor.
    public static readonly string[] RutasSolicitante =
    {
        AccesoAdmin.PaginaProtegida,
        "~/handlers/admin_iniciativas_catalogos.ashx",
        "~/handlers/admin_iniciativas_capacidad.ashx",
        "~/handlers/admin_iniciativas_volumetria.ashx",
        "~/handlers/admin_iniciativas_validar.ashx",
    };

    public const string MensajeCerrado =
        "La solicitud de iniciativas no está abierta para tu cuenta.";

    // De donde sale el interruptor. La real lee adm.Interruptor; las pruebas
    // ponen la suya para no necesitar SQL Server. Nada del sitio la cambia.
    public static IFuenteInterruptores Fuente = new FuenteInterruptoresSql();

    private const string ClaveRequest = "AccesoIniciativas.Abiertas";

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
        var v = Leer(Fuente, delegate (Exception ex) { DashboardHandler.Registrar("AccesoIniciativas.Abiertas", ex); });
        if (context != null) context.Items[ClaveRequest] = v;
        return v;
    }

    public static bool EsRutaSolicitante(string rutaRelativa)
    {
        if (string.IsNullOrEmpty(rutaRelativa)) return false;
        foreach (var r in RutasSolicitante)
            if (string.Equals(rutaRelativa, r, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // La regla sin HttpContext: ADM/MOD siempre; si no, solo con el
    // interruptor y una identidad Windows autenticada.
    public static bool Evaluar(bool puedeEntrarAdmin, bool abiertas, IdentidadWindows id)
    {
        if (puedeEntrarAdmin) return true;
        return abiertas && id != null && id.Autenticada;
    }

    // Puede abrir Nueva solicitud y enviarla. ADM/MOD primero (no cambia
    // nada para ellos); el interruptor solo se lee para una cuenta
    // autenticada que no es ADM/MOD.
    public static bool PuedeSolicitar(HttpContext context)
    {
        if (AccesoAdmin.PuedeEntrar(context)) return true;
        var id = IdentidadWindows.DesdeContexto(context);
        if (id == null || !id.Autenticada) return false;
        return Evaluar(false, Abiertas(context), id);
    }

    // Entro por el interruptor (no es ADM/MOD). Solo para la interfaz.
    public static bool EsSoloSolicitante(HttpContext context)
    {
        return !AccesoAdmin.PuedeEntrar(context) && PuedeSolicitar(context);
    }

    // Para los cuatro handlers de Nueva solicitud: true si sigue; si no, ya
    // respondio 403 AccesoDenegado en JSON y hay que salir.
    public static bool ExigirSolicitud(HttpContext context)
    {
        if (PuedeSolicitar(context)) return true;
        Rechazar(context, true);
        return false;
    }

    // El 403 de AccesoAdmin (mismo {error, tipo: AccesoDenegado}) con el
    // mensaje de que la solicitud no esta abierta.
    public static void Rechazar(HttpContext context, bool json)
    {
        AccesoAdmin.Rechazar(context, json, MensajeCerrado);
    }
}
