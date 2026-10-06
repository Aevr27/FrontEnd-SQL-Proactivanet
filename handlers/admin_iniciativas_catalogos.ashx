<%@ WebHandler Language="C#" Class="AdminIniciativasCatalogos" %>

// Catalogos de Admin -> Iniciativas.
//
//   GET admin_iniciativas_catalogos.ashx
//       (admin/registro-iniciativas.js, Cobertura de categorias): tipos +
//       asignaciones por CategoriaN2. SIN CAMBIOS.
//   GET admin_iniciativas_catalogos.ashx?rutas=1
//       (admin/iniciativas.js, Nueva solicitud): lo mismo MAS "rutas", las
//       categorias REALES (ruta completa) que se pueden elegir. La ruta es
//       la llave de capacidad: cada una con su propio 100%.
//
//     { "tipos": [ { "prefijo": "PRB", "nombre": "Problem" }, ... ],
//       "tipo_problem": "PRB" | null,
//       "asignaciones": [ { "director", "po", "so", "categoria" (N2) }, ... ],
//       "omitidas": 0,
//       "rutas": [ { "director", "po", "so", "categoria" (ruta) }, ... ],   (?rutas=1)
//       "rutas_sin_duenos": 0, "rutas_duenos_no_vigentes": 0 }               (?rutas=1)
//
//   tipos          DashboardCatalogos.PrefijosIniciativa: TODAS las filas de
//                  dbo.CatPrefijoProblem (llave Prefijo, texto
//                  Descripcion), con Problem (PRB) primero. NO es
//                  dbo.Problem.TipoIniciativa.
//   tipo_problem   el prefijo de esa lista que es Problem (exige RCA), o
//                  null si el catalogo no lo trae. El navegador no lo
//                  escribe a mano: lo toma de aqui.
//   asignaciones   una fila por categoria vigente de dbo.CatCategoriaDueno,
//                  con sus dueños resueltos por DirectorioOrganizacional (la
//                  misma regla N2 -> C1 del resto del sitio).
//   rutas          CatalogoRutasIniciativa: dbo.Categorias activas con sus
//                  dueños por la misma regla (C1&C2 exacto o C1).
//
// La cascada se arma en el navegador filtrando las filas.
//
// No usa DashboardHandler.Responder: con ?rutas=1 son miles de filas y
// pueden pasar el MaxJsonLength de 2 MB de ese helper (mismo motivo que
// admin_iniciativas_registro.ashx). Errores con el mismo {error, tipo} y 500.
//
// SOLO LECTURA (CatPrefijoProblem, CatCategoriaDueno, CatPersona y, con ?rutas=1,
// Categorias). No crea ni cambia nada en la base.
//
// ACCESO: AccesoAdmin.Exigir; el resto recibe 403 antes de tocar la base.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Web;
using System.Web.Script.Serialization;

public class AdminIniciativasCatalogos : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.Exigir(context)) return;

        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Cache.SetCacheability(HttpCacheability.NoCache);

        var serializador = new JavaScriptSerializer();
        serializador.MaxJsonLength = int.MaxValue;

        try
        {
            using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
            {
                cn.Open();
                var dir = DirectorioOrganizacional.Cargar(cn);
                var salida = dir.AsignacionesVigentes();
                var tipos = DashboardCatalogos.PrefijosIniciativa(cn);
                salida["tipos"] = tipos;
                salida["tipo_problem"] = TiposSolicitud.ValorProblem(DashboardCatalogos.Llaves(tipos));
                if (context.Request.QueryString["rutas"] == "1")
                {
                    foreach (var kv in CatalogoRutasIniciativa.Cargar(cn, dir)) salida[kv.Key] = kv.Value;
                }
                context.Response.Write(serializador.Serialize(salida));
            }
        }
        catch (Exception ex)
        {
            context.Response.StatusCode = 500;
            context.Response.TrySkipIisCustomErrors = true;
            DashboardHandler.Registrar("admin_iniciativas_catalogos.ashx", ex);
            context.Response.Write(serializador.Serialize(new Dictionary<string, object>
            {
                { "error", DashboardHandler.MensajeSeguro(ex) },
                { "tipo", ex.GetType().Name },
            }));
        }
    }

    public bool IsReusable { get { return false; } }
}
