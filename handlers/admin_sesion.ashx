<%@ WebHandler Language="C#" Class="AdminSesion" %>

// "¿Puedo entrar a Admin?" para la interfaz: el tablero lo pide para mostrar
// u ocultar la entrada Administracion del menu, y admin/iniciativas.html para
// el saludo. Es SOLO comodidad visual: la seguridad esta en AccesoAdmin.Exigir
// de cada handler admin_iniciativas_* y en AdminAccesoModulo.
//
//   GET handlers/admin_sesion.ashx              -> { "autorizado": true|false }
//        autorizado = AccesoAdmin.PuedeEntrar: rol ADM o MOD en la base. Un
//        VIEWER (sin fila en dbo.UsuariosAdmin, valor raro o consulta que
//        falla) sale false y sin rol: el menu no muestra Administracion.
//        y, si autorizado, "rol": "ADM" | "MOD" (RolAdmin: dbo.UsuariosAdmin;
//        o el de ADMIN_DEV_ROL con el atajo de desarrollo local,
//        AccesoDesarrolloLocal: cuenta de desarrollo en la whitelist).
//        Solo para que la interfaz oculte lo que no le toca; los handlers lo
//        exigen aparte.
//        "solicitante": true|false = AccesoIniciativas.PuedeSolicitar: puede
//        abrir Nueva solicitud y ver "Solicitar una iniciativa" (ADM
//        siempre; MOD solo si es Product Owner o Service Owner vigente; los
//        demas con el interruptor INICIATIVAS_ABIERTAS de adm.Interruptor y
//        siendo PO/SO vigente). Con autorizado false y solicitante true, la pagina
//        se abre en modo "solo Nueva solicitud" y el menu muestra la entrada
//        Iniciativas en vez de Administracion. Tambien solo UX: los cuatro
//        handlers de Nueva solicitud lo exigen con ExigirSolicitud.
//        "verificacion": "incompleta" SOLO si alguna consulta de este request
//        fallo (dbo.UsuariosAdmin, adm.Interruptor o los dueños PO/SO): lo
//        demas ya fallo cerrado, pero no es una negativa confirmada. La
//        interfaz no la toma como "sin rol" (SesionAdmin: incierto).
//   GET handlers/admin_sesion.ashx?persona=1    -> ademas "nombre" (solo si
//        autorizado o solicitante y la cuenta se resuelve en CatPersona /
//        CatLiderGrupo)
//        y "correo" (solo si autorizado y dbo.UsuariosAdmin.CorreoUsuario de
//        la cuenta da UN correo claro: App_Code/CorreoAdmin.cs)
//
// Responde a cualquiera (no es una ruta protegida): solo dice si quien
// pregunta esta autorizado. No devuelve la lista ni la cuenta Windows.
// Sin ?persona solo toca la base para el rol (y solo si esta autorizado). Con ?persona, un fallo al buscar a la persona
// NO es un error: simplemente no va "nombre".

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Web;

public class AdminSesion : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var identidad = IdentidadWindows.DesdeContexto(context);
            var salida = new Dictionary<string, object>();
            salida["autorizado"] = AccesoAdmin.PuedeEntrar(context);
            if ((bool)salida["autorizado"]) salida["rol"] = AccesoAdmin.Rol(context);
            salida["solicitante"] = AccesoIniciativas.PuedeSolicitar(context);
            // Solo para que se note en pantalla/red que es el atajo de
            // desarrollo local (AdminDevOverride + DEBUG + local + IIS Express + whitelist).
            if (AccesoDesarrolloLocal.Activo(context)) salida["desarrollo_local"] = true;
            // Una consulta de autorizacion fallo (rol, interruptor o dueños):
            // autorizado/solicitante ya fallaron cerrado; esto solo le dice a
            // la interfaz que NO es una negativa confirmada (no cambia de
            // Administracion a Iniciativas por un error). No da nada.
            if (AccesoAdmin.VerificacionIncompleta(context)) salida["verificacion"] = "incompleta";

            if (((bool)salida["autorizado"] || (bool)salida["solicitante"]) && context.Request.QueryString["persona"] == "1")
            {
                var nombre = NombreDe(identidad);
                if (nombre != null) salida["nombre"] = nombre;
            }
            if ((bool)salida["autorizado"] && context.Request.QueryString["persona"] == "1")
            {
                // El de dbo.UsuariosAdmin.CorreoUsuario (App_Code/CorreoAdmin.cs);
                // sin uno claro, no se manda.
                var correo = CorreoAdmin.Para(identidad, CorreoAdmin.Fuente,
                    delegate (Exception ex) { DashboardHandler.Registrar("admin_sesion.ashx", ex); });
                if (correo != null) salida["correo"] = correo;
            }
            return salida;
        });
    }

    private static string NombreDe(IdentidadWindows identidad)
    {
        try
        {
            using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
            {
                cn.Open();
                var p = DirectorioPersonas.Cargar(cn).BuscarPorCorreo(identidad.CorreoCandidato());
                return p.Estado == DirectorioPersonas.Resuelto ? p.Nombre : null;
            }
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("admin_sesion.ashx", ex);
            return null;
        }
    }

    public bool IsReusable { get { return false; } }
}
