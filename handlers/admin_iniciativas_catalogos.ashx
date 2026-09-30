<%@ WebHandler Language="C#" Class="AdminIniciativasCatalogos" %>

// Catalogo de los selects encadenados de "Nueva solicitud"
// (admin/iniciativas.html): Director -> Product Owner -> Service Owner ->
// Categoria.
//
// admin/iniciativas.js lo pide una sola vez al abrir la pagina, sin query
// string, y espera:
//
//     { "asignaciones": [ { "director": "...", "po": "...", "so": "...",
//                           "categoria": "..." }, ... ],
//       "omitidas": 0 }
//
// Una fila por categoria vigente de dbo.CatCategoriaDueno, con sus dueños
// resueltos por DirectorioOrganizacional (la misma regla N2 -> C1 del resto
// del sitio). La cascada se arma en el navegador filtrando estas filas.
//
// SOLO LECTURA: dos SELECT (CatCategoriaDueno y CatPersona, los de
// DirectorioOrganizacional.Cargar). No crea ni cambia nada en la base.
// Sin autenticacion propia todavia, como el resto de admin/.

using System;
using System.Data.SqlClient;
using System.Web;

public class AdminIniciativasCatalogos : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
            {
                cn.Open();
                return DirectorioOrganizacional.Cargar(cn).AsignacionesVigentes();
            }
        });
    }

    public bool IsReusable { get { return false; } }
}
