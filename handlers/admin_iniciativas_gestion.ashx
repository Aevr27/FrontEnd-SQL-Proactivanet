<%@ WebHandler Language="C#" Class="AdminIniciativasGestion" %>

// Gestion directa de ADM: "Crear iniciativa" (Administracion) y "Modificar"
// (detalle del registro). VALIDA EN EL SERVIDOR Y NO GUARDA: la persistencia
// no esta habilitada (PersistenciaGestionAdmin, App_Code/GestionIniciativaAdmin.cs).
//
//   POST handlers/admin_iniciativas_gestion.ashx   (multipart/form-data)
//     accion=crear      tipo, po, so, titulo, descripcion, observaciones,
//                       pares cat_ruta / cat_pct (cero o mas categorias,
//                       cada una con su % en %) y el archivo "rca" (se mira
//                       que llego; no se guarda). La volumetria no se
//                       captura: es calculada (admin_iniciativas_volumetria.ashx).
//     accion=modificar  folio (identifica; nunca cambia), titulo,
//                       descripcion, observaciones, f_analisis, f_solucion,
//                       f_cierre, estado, subestado (cada uno solo si se
//                       envia), pares pct_categoria / pct_valor (las YA
//                       ligadas), pares agregar_categoria / agregar_pct y
//                       quitar_categoria (repetible)
//
//   501  valida: { "valida": true, "guardada": false,
//                  "persistencia": "no_habilitada", "persistencia_motivo",
//                  "bloqueos": [...], "cambios", "faltantes", "advertencias",
//                  "codigo": null, ... , "error", "tipo": "PersistenciaNoHabilitada" }
//        501 y no 200 a proposito: nada se guardo, ningun cliente debe
//        poder leerlo como exito.
//   422  invalida: la misma forma con "valida": false y errores [{campo, mensaje}]
//        (con "catalogo_revisado": false si fallo el formato y no se llego a
//        la base).
//   503  no se pudo leer el catalogo o el registro: { error, tipo:
//        "ValidacionNoDisponible" }. No dice que sea valida.
//   400  accion desconocida;  405 si no es POST;  413 cuerpo demasiado grande.
//   403  AccesoAdmin.ExigirAdm: VIEWER, anonimo, consulta de rol fallida
//        (AccesoDenegado) y MOD (RolInsuficiente),
//        antes de leer nada.
//
// SOLO LECTURA. No escribe en dbo.Problem, dbo.ProblemCategoria ni en el
// historial de fechas, no genera codigo y no sube archivos.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasGestion : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) puede crear o modificar iniciativas directamente.")) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            if (!string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa POST.", "MetodoNoPermitido");

            string accion;
            PeticionCrearAdmin crear = null;
            PeticionModificarAdmin modificar = null;
            try
            {
                accion = req.Form["accion"];
                if (accion == "crear")
                {
                    var rca = req.Files[SolicitudIniciativa.CRca];
                    crear = PeticionCrearAdmin.DesdeFormulario(req.Form, rca != null && rca.ContentLength > 0);
                }
                else if (accion == "modificar")
                {
                    modificar = PeticionModificarAdmin.DesdeFormulario(req.Form);
                }
                else return Error(context, 400, "Acci\u00f3n desconocida: usa crear o modificar.", "AccionDesconocida");
            }
            catch (HttpException ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_gestion.ashx", ex);
                return Error(context, 413, "La petici\u00f3n o el archivo adjunto son demasiado grandes.", "SolicitudDemasiadoGrande");
            }

            // 1) Formato, sin base.
            var validador = new ValidadorGestionAdmin();
            var formato = crear != null ? validador.FormatoCrear(crear) : validador.FormatoModificar(modificar);
            if (!formato.Valida) return Invalida(context, formato);

            // 2) Catalogo / registro: la autoridad. Si no se puede leer, no se
            //    dice nada de la validez.
            ResultadoGestionAdmin r;
            try
            {
                var servicio = new GestionIniciativaAdminService();
                r = crear != null ? servicio.Crear(crear) : servicio.Modificar(modificar);
            }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_gestion.ashx", ex);
                return Error(context, 503,
                    "No se pudo validar contra el cat\u00e1logo: " + DashboardHandler.MensajeSeguro(ex), "ValidacionNoDisponible");
            }
            if (!r.Valida) return Invalida(context, r);

            // 3) Valida, pero sin persistencia: nada se guarda.
            context.Response.StatusCode = 501;
            context.Response.TrySkipIisCustomErrors = true;
            var salida = r.ComoJson();
            salida["error"] = PersistenciaGestionAdmin.Motivo;
            salida["tipo"] = "PersistenciaNoHabilitada";
            return salida;
        });
    }

    private static object Invalida(HttpContext context, ResultadoGestionAdmin r)
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
