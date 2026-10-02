<%@ WebHandler Language="C#" Class="AdminIniciativasCatalogos" %>

// Catalogos de "Nueva solicitud" (admin/iniciativas.html): el Tipo de
// iniciativa y la cascada Product Owner -> Service Owner -> Categoria, con el
// Director derivado de la categoria.
//
// admin/iniciativas.js lo pide una sola vez al abrir la pagina, sin query
// string (y admin/registro-iniciativas.js, al abrir la Cobertura de
// categorias, para el universo de categorias), y espera:
//
//     { "tipos": ["...", ...],
//       "tipo_problem": "Problem" | null,
//       "asignaciones": [ { "director": "...", "po": "...", "so": "...",
//                           "categoria": "..." }, ... ],
//       "omitidas": 0 }
//
//   tipos          DashboardCatalogos.TiposIniciativa: los TipoIniciativa en
//                  uso en dbo.Problem (vigentes), con Problem primero si
//                  esta.
//   tipo_problem   el valor de esa lista que es Problem (exige RCA), o null
//                  si el catalogo no lo trae. El navegador no lo escribe a
//                  mano: lo toma de aqui.
//   asignaciones   una fila por categoria vigente de dbo.CatCategoriaDueno,
//                  con sus dueños resueltos por DirectorioOrganizacional (la
//                  misma regla N2 -> C1 del resto del sitio).
//
// La cascada se arma en el navegador filtrando las asignaciones.
//
// SOLO LECTURA: tres SELECT (Problem, CatCategoriaDueno y CatPersona) sobre
// una conexion. No crea ni cambia nada en la base.
//
// ACCESO: solo las cuentas de AdminAllowedUsers (AccesoAdmin.Exigir); el
// resto recibe 403 antes de tocar la base.

using System;
using System.Data.SqlClient;
using System.Web;

public class AdminIniciativasCatalogos : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.Exigir(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
            {
                cn.Open();
                var salida = DirectorioOrganizacional.Cargar(cn).AsignacionesVigentes();
                var tipos = DashboardCatalogos.TiposIniciativa(cn);
                salida["tipos"] = tipos;
                salida["tipo_problem"] = TiposSolicitud.ValorProblem(tipos);
                return salida;
            }
        });
    }

    public bool IsReusable { get { return false; } }
}
