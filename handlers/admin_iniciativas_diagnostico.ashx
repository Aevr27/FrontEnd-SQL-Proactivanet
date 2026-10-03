<%@ WebHandler Language="C#" Class="AdminIniciativasDiagnostico" %>

// Diagnostico de identidad y destinatarios CANDIDATOS de Admin -> Iniciativas.
// Para revisar con datos reales, antes de cablear cualquier envio, quien es
// el usuario y a quien le llegaria un aviso. No envia nada.
//
//   GET handlers/admin_iniciativas_diagnostico.ashx
//         [?categoria=<CategoriaN2 de CatCategoriaDueno>]
//         [&so=<nombre de un Service Owner>]
//
// Respuesta (DestinatariosIniciativa.Resolver):
//   { identidad: { windows_identity, normalized_username,
//                  lookup_email_candidate },
//     solicitante: { estado, nombre, correo, fuente, rol, manager,
//                    product_owner, director, candidatos, manager_correo },
//     categoria: { categoria, estado, vigente, director, product_owner,
//                  product_owner_correo, service_owner,
//                  service_owner_correo },                 (solo con ?categoria)
//     service_owner_a_product_owner: { service_owner, origen, estado,
//                  product_owner, product_owner_correo, candidatos,
//                  catpersona_product_owner },
//     lider_so: { service_owner, estado: "sin_regla_confirmada", lider_so,
//                 lider_so_correo, evidencia_catlidergrupo } }
//
// estado: resuelto | no_encontrado | ambiguo | sin_correo. Lo que no se
// resuelve va null; nunca se inventa.
//
// ACCESO: solo AdminAllowedUsers (AccesoAdmin.Exigir), 403 al resto.
// SOLO LECTURA: SELECT sobre dbo.CatPersona, dbo.CatLiderGrupo y
// dbo.CatCategoriaDueno. No crea ni cambia nada en la base.

using System;
using System.Data.SqlClient;
using System.Web;

public class AdminIniciativasDiagnostico : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.Exigir(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
            {
                cn.Open();
                return DestinatariosIniciativa
                    .Cargar(cn, IdentidadWindows.DesdeContexto(context))
                    .Resolver(context.Request.QueryString["categoria"],
                              context.Request.QueryString["so"]);
            }
        });
    }

    public bool IsReusable { get { return false; } }
}
