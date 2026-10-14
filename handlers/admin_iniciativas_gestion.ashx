<%@ WebHandler Language="C#" Class="AdminIniciativasGestion" %>

// Gestion directa de ADM: "Crear iniciativa" (Administracion) y "Modificar"
// (detalle del registro). VALIDA EN EL SERVIDOR Y NO GUARDA: la persistencia
// no esta habilitada (PersistenciaGestionAdmin, App_Code/GestionIniciativaAdmin.cs).
//
//   POST handlers/admin_iniciativas_gestion.ashx   (multipart/form-data)
//     accion=crear      tipo (prefijo), tipo_iniciativa, tipo_agrupado,
//                       estado (declarados: no se derivan del prefijo),
//                       f_entrega_analisis (aaaa-mm-dd; vacio = hoy), po,
//                       so, titulo, descripcion, observaciones, pares
//                       cat_ruta / cat_pct (cero o mas categorias, cada una
//                       con su % en %) y el archivo "rca" (se mira que
//                       llego; no se guarda). La volumetria no se captura:
//                       es calculada (admin_iniciativas_volumetria.ashx).
//     accion=modificar  folio (identifica; nunca cambia), titulo,
//                       descripcion, observaciones, f_analisis, f_solucion,
//                       f_cierre, estado, subestado (cada uno solo si se
//                       envia), pares pct_categoria / pct_valor (las YA
//                       ligadas; pct_tipo_agrupado paralelo y opcional:
//                       declara la agrupacion de una ligada que no la
//                       tiene), agregar_categoria / agregar_pct /
//                       agregar_tipo_iniciativa / agregar_tipo_agrupado
//                       (paralelos; tipos obligatorios), pares
//                       fcat_categoria / fcat_analisis (fecha de analisis
//                       de una ligada: la propia, o la de la iniciativa si
//                       la categoria la hereda) y quitar_categoria
//                       (repetible)
//
//   501  valida: { "valida": true, "guardada": false, "plan" (lo que se
//                  guardaria: fechas del alta, de cada categoria ligada y
//                  "pendientes"; PlanGestionAdmin.cs),
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
// HOY SOLO LECTURA: PersistenciaGestionAdmin.Habilitada = const false, asi
// que la rama 4 (EscritorGestionAdminSql -> adm.usp_GestionAdmin_*, de
// sql/18) nunca corre. Con ella activa: 200 { guardada: true, codigo } (el
// Codigo solo existe si la base confirmo el alta); 409 { error, numero,
// tipo: TopeExcedido | CategoriaRepetida | DatoInvalido | CodigoNoEmitido |
// EscrituraRechazada } si el procedimiento rechaza (nada se guarda).

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
            var servicio = new GestionIniciativaAdminService();
            try
            {
                r = crear != null ? servicio.Crear(crear) : servicio.Modificar(modificar);
            }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_gestion.ashx", ex);
                return Error(context, 503,
                    "No se pudo validar contra el cat\u00e1logo: " + DashboardHandler.MensajeSeguro(ex), "ValidacionNoDisponible");
            }
            if (!r.Valida) return Invalida(context, r);

            // 3) El plan: lo que se guardaria (fechas incluidas).
            var hoy = DashboardDataInfo.HoyEnPresentacion();
            var planCrear = crear != null ? PlanificadorGestionAdmin.Crear(crear, r, hoy) : null;
            var planMod = crear == null ? PlanificadorGestionAdmin.Modificar(modificar, servicio.Actual, r, hoy) : null;
            var pendientes = planCrear != null ? planCrear.Pendientes : planMod.Pendientes;
            var salida = r.ComoJson();
            salida["plan"] = planCrear != null ? planCrear.ComoJson() : planMod.ComoJson();

            // 4) Escritura: SOLO con la persistencia activa (hoy const false,
            //    PersistenciaGestionAdmin) y sin pendientes. Depende de
            //    sql/18 aplicada y del cargador del Excel retirado: sin aprobar.
            if (PersistenciaGestionAdmin.Activa() && pendientes.Count == 0)
            {
                var id = IdentidadWindows.DesdeContexto(context);
                if (!id.Autenticada || string.IsNullOrEmpty(id.Original))
                    return Error(context, 403, "Sin usuario autenticado no se guarda nada.", "SinUsuario");
                try
                {
                    salida["codigo"] = servicio.Guardar(planCrear, planMod, id.Original);
                }
                catch (ErrorEscrituraGestionAdmin ex)
                {
                    DashboardHandler.Registrar("admin_iniciativas_gestion.ashx", ex);
                    context.Response.StatusCode = 409;
                    context.Response.TrySkipIisCustomErrors = true;
                    return new Dictionary<string, object>
                    {
                        { "error", ex.Message }, { "numero", ex.Numero },
                        { "tipo", ex.Tipo },
                        { "guardada", false },
                    };
                }
                salida["guardada"] = true;
                salida["persistencia"] = "habilitada";
                salida["persistencia_motivo"] = null;
                return salida;
            }

            // 5) Valida, pero sin persistencia: nada se guarda.
            context.Response.StatusCode = 501;
            context.Response.TrySkipIisCustomErrors = true;
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
