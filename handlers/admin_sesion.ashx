<%@ WebHandler Language="C#" Class="AdminSesion" %>

// "¿Puedo entrar a Admin?" para la interfaz: el tablero lo pide para mostrar
// u ocultar la entrada Administracion del menu, y admin/iniciativas.html para
// el saludo. Es SOLO comodidad visual: la seguridad esta en AccesoAdmin.Exigir
// de cada handler admin_iniciativas_* y en AdminAccesoModulo.
//
//   GET handlers/admin_sesion.ashx              -> { "autorizado": true|false }
//        y, si autorizado, "rol": "ADM" | "MOD" (RolAdmin: dbo.UsuariosAdmin,
//        o ADMIN_DEV_ROL con la identidad simulada local). Solo para que la
//        interfaz oculte lo que no le toca; los handlers lo exigen aparte.
//   GET handlers/admin_sesion.ashx?persona=1    -> ademas "nombre" (solo si
//        autorizado y la cuenta se resuelve en CatPersona / CatLiderGrupo)
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
            salida["autorizado"] = AccesoAdmin.EstaAutorizado(identidad);
            if ((bool)salida["autorizado"]) salida["rol"] = AccesoAdmin.Rol(context);
            // Solo para que se note en pantalla/red que es la identidad
            // simulada de IIS Express (IdentidadDesarrolloLocal).
            if (identidad.DesarrolloLocal) salida["desarrollo_local"] = true;

            if ((bool)salida["autorizado"] && context.Request.QueryString["persona"] == "1")
            {
                var nombre = NombreDe(identidad);
                if (nombre != null) salida["nombre"] = nombre;
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
