<%@ WebHandler Language="C#" Class="AdminIniciativasVolumetria" %>

// Volumetria de una o varias categorias (ruta completa) para Admin:
// Crear, Modificar y Solicitar cambios la piden al elegir o cambiar una
// categoria y la pintan de solo lectura.
//
//   GET admin_iniciativas_volumetria.ashx?ruta=/A/B/C&ruta=/D/E
//
//   200 { "slot": 0, "dias": 30, "desde": "aaaa-mm-dd", "hasta": "aaaa-mm-dd",
//         "rutas": [ { "ruta", "llave", "estado": ok|cero|sin_datos|ruta_invalida,
//                      "volumetria": n | null }, ... ] }
//   400 sin ruta, mas de VolumetriaCategoria.MAX_RUTAS o una ruta demasiado larga
//   405 si no es GET
//   503 no se pudo leer la vista: { error, tipo: "VolumetriaNoDisponible" }.
//       Nunca se responde 0 cuando no se pudo leer.
//   403 AccesoIniciativas.ExigirSolicitud (ADM o MOD, o cualquier cuenta
//       Windows autenticada con el interruptor IniciativasAbiertas: Nueva
//       solicitud la pide), antes de tocar la base.
//
//   GET ...?alcance=total&ruta=...   SOLO ADM (Crear / Modificar de ADM)
//   200 { "alcance": "total", "rutas": [ { "ruta", "llave", "estado": ok|cero|ruta_invalida,
//         "volumetria": total | null, "ultimos30": n | null }, ... ] }
//       volumetria = VolumenCategoria de dbo.vw_ProblemCategoria (todos los
//       tickets de la ruta); ultimos30 = su VolumenUltimos30, la base del
//       TicketsReduce que guarda la base (VolumetriaTotalCategoria en
//       App_Code/ExperienciaVolumetria.cs). Sin cache: un COUNT por ruta
//       sobre IX_Tickets_Categoria.
//   403 AccesoAdmin.ExigirAdm (MOD y los demas), antes de tocar la base.
//   400 alcance desconocido. Sin alcance = SLOT 0, igual que siempre.
//
// La consulta, la llave y el significado de SLOT 0 son los de Experiencia:
// ver App_Code/ExperienciaVolumetria.cs. El SLOT 0 completo se guarda
// CACHE_MINUTOS en memoria (la vista barre dbo.Tickets con funciones
// escalares; el ETL de tickets carga una vez al dia), asi que cambiar de
// categoria no vuelve a barrerla cada vez.
//
// SOLO LECTURA: el SELECT de LeerVolumen sobre dbo.vw_TBSlotCAT.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.Web;
using System.Web.Caching;

public class AdminIniciativasVolumetria : IHttpHandler
{
    private const string CACHE_LLAVE = "admin_volumetria_slot0";
    private const int CACHE_MINUTOS = 10;
    private static readonly object Candado = new object();

    public void ProcessRequest(HttpContext context)
    {
        var alcance = context.Request.QueryString["alcance"];
        var total = string.Equals(alcance, VolumetriaTotalCategoria.ALCANCE, StringComparison.Ordinal);
        if (total ? !AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) consulta la volumetria total.")
                  : !AccesoIniciativas.ExigirSolicitud(context)) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            if (!string.Equals(req.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa GET.", "MetodoNoPermitido");

            var rutas = req.QueryString.GetValues("ruta") ?? new string[0];
            if (rutas.Length == 0)
                return Error(context, 400, "Falta la categoría (ruta).", "ParametroInvalido");
            if (rutas.Length > VolumetriaCategoria.MAX_RUTAS)
                return Error(context, 400, "Demasiadas categorías en una sola consulta.", "ParametroInvalido");
            foreach (var r in rutas)
                if (r != null && r.Length > VolumetriaCategoria.MAX_LARGO)
                    return Error(context, 400, "La ruta de la categoría es demasiado larga.", "ParametroInvalido");

            if (alcance != null && !total)
                return Error(context, 400, "Alcance desconocido: usa alcance=total o ninguno.", "ParametroInvalido");
            if (total)
            {
                List<object> filas;
                try
                {
                    using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
                    {
                        cn.Open();
                        filas = VolumetriaTotalCategoria.Leer(cn, rutas);
                    }
                }
                catch (Exception ex)
                {
                    DashboardHandler.Registrar("admin_iniciativas_volumetria.ashx", ex);
                    return Error(context, 503,
                        "No se pudo leer la volumetria: " + DashboardHandler.MensajeSeguro(ex), "VolumetriaNoDisponible");
                }
                return new Dictionary<string, object> { { "alcance", VolumetriaTotalCategoria.ALCANCE }, { "rutas", filas } };
            }

            Dictionary<string, int> slot0;
            try
            {
                slot0 = Slot0();
            }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_volumetria.ashx", ex);
                return Error(context, 503,
                    "No se pudo leer la volumetría: " + DashboardHandler.MensajeSeguro(ex), "VolumetriaNoDisponible");
            }

            var hoy = DashboardDataInfo.HoyEnPresentacion();
            return new Dictionary<string, object>
            {
                { "slot", 0 },
                { "dias", DashboardDataInfo.DiasSlot },
                { "desde", hoy.AddDays(-DashboardDataInfo.DiasSlot).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) },
                { "hasta", hoy.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) },
                { "rutas", VolumetriaCategoria.Resolver(rutas, slot0) },
            };
        });
    }

    private static Dictionary<string, int> Slot0()
    {
        var cache = HttpRuntime.Cache;
        var guardado = cache[CACHE_LLAVE] as Dictionary<string, int>;
        if (guardado != null) return guardado;
        lock (Candado)
        {
            guardado = cache[CACHE_LLAVE] as Dictionary<string, int>;
            if (guardado != null) return guardado;
            using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
            {
                cn.Open();
                var leido = ExperienciaQueries.VolumenSlot0PorCategoria(cn);
                cache.Insert(CACHE_LLAVE, leido, null, DateTime.UtcNow.AddMinutes(CACHE_MINUTOS), Cache.NoSlidingExpiration);
                return leido;
            }
        }
    }

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
