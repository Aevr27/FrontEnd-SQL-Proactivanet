<%@ WebHandler Language="C#" Class="AdminIniciativasRecientes" %>

// "Cambios recientes" de Admin/Iniciativas (admin/cambios-recientes.js,
// pestaña Administracion). App_Code/CambiosRecientesAdmin.cs, sql/23.
//
//   GET  -> 200 { estado: "ok" | "sin_columna", limite, alcance,
//                 cambios: [ { folio, fecha_utc ("aaaa-mm-ddThh:mm:ssZ"),
//                              usuario, accion: "alta" | "cambio" | "solicitud" } ] }
//           (hasta dos eventos por folio: su alta y su ultimo cambio)
//           (mas reciente primero; solo folios: el detalle completo lo pone
//           la pagina con el registro que ya cargo)
//   403 antes de leer nada: AccesoAdmin.ExigirAdm (VIEWER, anonimo, rol
//       que falla: AccesoDenegado; MOD: RolInsuficiente).
//   405 cualquier otro metodo.   500 { error, tipo } si la lectura falla.
//
// Solo cambios guardados DESDE EL DASHBOARD; no lo hecho en SSMS ni la
// carga del Excel. SOLO LECTURA. No recibe parametros: el limite es fijo.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasRecientes : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) ve los cambios recientes.")) return;

        DashboardHandler.Responder(context, delegate
        {
            if (!string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = 405;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object> { { "error", "Usa GET." }, { "tipo", "MetodoNoPermitido" } };
            }
            return CambiosRecientesAdmin.Json(CambiosRecientesAdmin.Fuente.Leer(CambiosRecientesAdmin.Limite));
        });
    }

    public bool IsReusable { get { return false; } }
}
