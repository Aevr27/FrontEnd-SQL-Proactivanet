<%@ WebHandler Language="C#" Class="AdminCategoriasAlta" %>

// Alta de categoria en Proactivanet: PREPARACION SIN LLAMADA EXTERNA
// (App_Code/AltaCategoriaProactivanet.cs). Este handler no tiene cliente
// HTTP: no puede crear nada en Proactivanet.
//
//   GET  handlers/admin_categorias_alta.ashx
//        200 { "rutas": [ "<ruta activa>", ... ] }   (para elegir el padre)
//   POST handlers/admin_categorias_alta.ashx   (form)
//        padre, nombre, descripcion, orden, incidentes/problemas/cambios/kb (= "1")
//        501 valida: { "valida": true, "enviada": false, "creada": false,
//                      "integracion": "no_habilitada", "envio": { metodo, ruta, cuerpo },
//                      "bloqueos", "advertencias", "ruta_resultante",
//                      "tipo": "IntegracionNoHabilitada" }
//        422 invalida: errores [{campo, mensaje}]
//        503 no se pudo leer el catalogo local: { error, tipo: "ValidacionNoDisponible" }
//   403  AccesoAdmin.ExigirAdm (VIEWER, anonimo, MOD) antes de leer nada.
//
// SOLO LECTURA de dbo.Categorias (RutaCompleta, VigenteEnOrigen, Inactiva).

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Web;

public class AdminCategoriasAlta : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) puede preparar el alta de categor\u00edas.")) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            if (string.Equals(req.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                var activas = new List<string>();
                foreach (var x in LeerRutas()) if (x.Activa && !activas.Contains(x.Ruta)) activas.Add(x.Ruta);
                activas.Sort(StringComparer.OrdinalIgnoreCase);
                return new Dictionary<string, object> { { "rutas", activas } };
            }
            if (!string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa GET o POST.", "MetodoNoPermitido");

            var p = PeticionAltaCategoria.DesdeFormulario(req.Form);
            var validador = new ValidadorAltaCategoria();
            var formato = validador.Formato(p);
            if (!formato.Valida) return Invalida(context, formato);

            ResultadoAltaCategoria r;
            try { r = validador.Validar(p, LeerRutas()); }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_categorias_alta.ashx", ex);
                return Error(context, 503,
                    "No se pudo validar contra el cat\u00e1logo: " + DashboardHandler.MensajeSeguro(ex), "ValidacionNoDisponible");
            }
            if (!r.Valida) return Invalida(context, r);

            context.Response.StatusCode = 501;
            context.Response.TrySkipIisCustomErrors = true;
            var salida = r.ComoJson();
            salida["error"] = IntegracionCategoriasProactivanet.Motivo;
            salida["tipo"] = "IntegracionNoHabilitada";
            return salida;
        });
    }

    private static List<RutaCategoria> LeerRutas()
    {
        const string sql = @"
SELECT RutaCompleta,
       CASE WHEN VigenteEnOrigen = 1 AND ISNULL(Inactiva, 0) = 0 THEN 1 ELSE 0 END AS Activa
FROM dbo.Categorias
WHERE RutaCompleta IS NOT NULL;";
        var salida = new List<RutaCategoria>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand(sql, cn))
        {
            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read())
                {
                    var ruta = DirectorioOrganizacional.Normaliza(rd.GetString(0));
                    if (ruta != null) salida.Add(new RutaCategoria { Ruta = ruta, Activa = rd.GetInt32(1) == 1 });
                }
        }
        return salida;
    }

    private static object Invalida(HttpContext context, ResultadoAltaCategoria r)
    {
        context.Response.StatusCode = 422;
        context.Response.TrySkipIisCustomErrors = true;
        var salida = r.ComoJson();
        salida["tipo"] = "ValidacionFallida";
        return salida;
    }

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
