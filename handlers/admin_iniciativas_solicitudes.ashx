<%@ WebHandler Language="C#" Class="AdminIniciativasSolicitudes" %>

// Solicitudes de cambio de una iniciativa (App_Code/SolicitudCambioAdmin.cs,
// sql/22). Quien envia, su rol y quien revisa salen SIEMPRE de la identidad
// Windows y de dbo.UsuariosAdmin (AccesoAdmin), nunca del formulario.
//
//   (accion siempre en la URL: ?accion=...)
//   POST accion=enviar     Exigir (ADM o MOD; ADM tambien, fase de pruebas)
//        folio, llave (GUID por borrador: el reintento no duplica), tipo
//        (fecha | estado | categorias | otros | datos), campo_fecha (f_analisis |
//        f_solucion | f_cierre) + fecha_nueva (aaaa-mm-dd), estado_nuevo,
//        subestado_nuevo (solo ADM: con otro rol 422 en subestado_nuevo),
//        pares pct_categoria / pct_valor (ligadas, en %),
//        agregar_categoria / agregar_pct (del catalogo, en %), motivo.
//        tipo datos (sql/25, PersistenciaSolicitudesCambio.SolicitaDatos):
//        titulo_nuevo / po_nuevo / so_nuevo, la clave PRESENTE = se pide
//        (presente y vacia = 422: nunca se pide dejarlo vacio); PO / SO del
//        catalogo se revisan al aplicar.
//        tipo varios (sql/34, PersistenciaSolicitudesCambio.SolicitaVarios):
//        UNA solicitud con cualquier combinacion de estado_nuevo, las fechas
//        por etapa f_analisis_nueva / f_solucion_nueva / f_cierre_nueva (la
//        clave PRESENTE = se pide; nunca campo_fecha), los pares de
//        categorias y titulo_nuevo / po_nuevo / so_nuevo. Sin sql/34 = 422.
//        Aplicar la aplica entera o nada (adm.usp_SolicitudCambio_Aplicar).
//        -> 200 { enviada: true, id_solicitud, repetida }
//           422 { errores } formato;  4xx de la base (ErrorSolicitudCambio)
//           501 { tipo: PersistenciaNoHabilitada } sin sql/22: nada se guarda
//           500 { tipo: EnvioNoConfirmado, enviada: null } (no se sabe)
//        NUNCA escribe la iniciativa.
//   GET  accion=listar[&estado=PENDIENTE|APLICADA|RECHAZADA]   ExigirAdm
//   GET  accion=detalle&id=N                                    ExigirAdm
//   POST accion=rechazar  id, comentario (obligatorio)          ExigirAdm
//   POST accion=aplicar   id, comentario (obligatorio en Otros), pares
//        clas_categoria / clas_tipo_iniciativa / clas_tipo_agrupado (solo
//        categorias por agregar sin clasificacion)              ExigirAdm
//        Valida como la edicion directa y aplica en una transaccion
//        (adm.usp_SolicitudCambio_Aplicar). Necesita tambien la persistencia
//        de la edicion directa (PersistenciaGestionAdmin): escribe la
//        iniciativa.
//        -> 200 { aplicada: true };  409 desactualizada / ya revisada / tope /
//           sin clasificacion;  422 validacion o comentario;  404 no existe;
//           500 { tipo: AplicacionNoConfirmada, aplicada: null }.
//        Toda falla de validacion o de la base deja la solicitud PENDIENTE y
//        registrada (Intentos, UltimoError, evento).
//
//   403 antes de leer nada: Exigir (VIEWER, anonimo, rol que falla) y, en lo
//   que es de ADM, ExigirAdm (MOD: RolInsuficiente). 405 metodo equivocado.

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasSolicitudes : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        // Primero quien es (ADM o MOD), antes de leer el cuerpo.
        if (!AccesoAdmin.Exigir(context)) return;
        var req = context.Request;
        // La accion va en la URL (?accion=): se decide el permiso sin leer el cuerpo.
        var accion = req.QueryString["accion"];
        if (accion != "enviar"
            && !AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) revisa, aplica o rechaza solicitudes de cambio.")) return;

        DashboardHandler.Responder(context, delegate
        {
            // sql/22 / sql/25 en la base (DeteccionSolicitudesCambio), antes de
            // validar: el tipo datos depende de ella. Si no se puede, apagado.
            try { DeteccionSolicitudesCambio.Revisar(); }
            catch (Exception ex) { DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex); }
            var esPost = string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase);
            if (accion == "enviar" || accion == "rechazar" || accion == "aplicar")
            {
                if (!esPost) return Error(context, 405, "Usa POST.", "MetodoNoPermitido");
            }
            else if (accion == "listar" || accion == "detalle")
            {
                if (esPost) return Error(context, 405, "Usa GET.", "MetodoNoPermitido");
            }
            else return Error(context, 400, "Acci\u00f3n desconocida.", "AccionDesconocida");

            // Lo que escribe necesita quien firme (atribucion): la cuenta
            // Windows o, solo en desarrollo local, la del atajo
            // (AccesoAdmin.IdentidadEscritura). Leer la cola solo necesita el
            // permiso de arriba.
            var id = AccesoAdmin.IdentidadEscritura(context) ?? IdentidadWindows.Desde(null, false);
            if ((accion == "enviar" || accion == "rechazar" || accion == "aplicar") && (!id.Autenticada || string.IsNullOrEmpty(id.Original)))
                return Error(context, 403, "Sin usuario autenticado no se guarda nada.", "SinUsuario");
            var rol = AccesoAdmin.Rol(context);

            if (accion == "enviar") return Enviar(context, id.Original, rol);
            if (!PersistenciaSolicitudesCambio.Activa())
                return Error(context, 501, PersistenciaSolicitudesCambio.MotivoCola, "PersistenciaNoHabilitada");
            try
            {
                if (accion == "listar")
                {
                    var estado = req.QueryString["estado"];
                    if (!string.IsNullOrEmpty(estado) && estado != "PENDIENTE" && estado != "APLICADA" && estado != "RECHAZADA")
                        return Error(context, 400, "Estado de solicitud desconocido.", "EstadoDesconocido");
                    return new Dictionary<string, object>
                    {
                        { "solicitudes", SolicitudesCambio.Almacen.Listar(string.IsNullOrEmpty(estado) ? null : estado, 200) },
                    };
                }
                int n;
                var texto = accion == "detalle" ? req.QueryString["id"] : req.Form["id"];
                if (!int.TryParse(texto, out n) || n <= 0) return Error(context, 400, "Falta el n\u00famero de la solicitud.", "SinSolicitud");
                if (accion == "detalle")
                {
                    var d = SolicitudesCambio.Almacen.Detalle(n);
                    if (d == null) return Error(context, 404, "La solicitud no existe.", "SolicitudNoExiste");
                    return d;
                }
                if (accion == "rechazar")
                {
                    var comentario = (req.Form["comentario"] ?? "").Trim();
                    if (comentario.Length == 0) return Error(context, 422, "Explica por qu\u00e9 se rechaza.", "FaltaComentario");
                    SolicitudesCambio.Almacen.Rechazar(n, id.Original, comentario);
                    return new Dictionary<string, object> { { "rechazada", true }, { "id_solicitud", n } };
                }
                return Aplicar(context, n, id.Original);
            }
            catch (ErrorSolicitudCambio ex)
            {
                return DeLaBase(context, ex, accion == "aplicar" ? "aplicada" : accion == "rechazar" ? "rechazada" : null);
            }
        });
    }

    private static object Enviar(HttpContext context, string usuario, string rol)
    {
        var p = PeticionSolicitudCambio.DesdeFormulario(context.Request.Form);
        p.ExigirSubestadoDeAdm(rol);
        if (!p.Valida)
        {
            context.Response.StatusCode = 422;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object> { { "errores", Errores(p.Errores) }, { "tipo", "ValidacionFallida" }, { "enviada", false } };
        }
        if (!PersistenciaSolicitudesCambio.Activa())
        {
            context.Response.StatusCode = 501;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object>
            {
                { "error", PersistenciaSolicitudesCambio.Motivo }, { "tipo", "PersistenciaNoHabilitada" }, { "enviada", false },
            };
        }
        try
        {
            var r = SolicitudesCambio.Almacen.Enviar(p, usuario, rol);
            return new Dictionary<string, object> { { "enviada", true }, { "id_solicitud", r.IdSolicitud }, { "repetida", r.Repetida } };
        }
        catch (ErrorSolicitudCambio ex) { return DeLaBase(context, ex, "enviada"); }
        catch (Exception ex)
        {
            // Un tiempo agotado puede llegar despues del COMMIT: no se afirma
            // que no se envio. Reintentar con la MISMA llave no duplica.
            DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
            context.Response.StatusCode = 500;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object>
            {
                { "error", "No se pudo confirmar el env\u00edo: " + DashboardHandler.MensajeSeguro(ex) + " Reint\u00e9ntalo: la misma solicitud no se duplica." },
                { "tipo", "EnvioNoConfirmado" }, { "enviada", null },
            };
        }
    }

    private static object Aplicar(HttpContext context, int n, string revisor)
    {
        if (!PersistenciaGestionAdmin.Activa())
            return Error(context, 501, PersistenciaGestionAdmin.Motivo, "PersistenciaNoHabilitada");
        var f = context.Request.Form;
        var cls = new List<ClasificacionSolicitud>();
        var rutas = f.GetValues("clas_categoria") ?? new string[0];
        var ti = f.GetValues("clas_tipo_iniciativa") ?? new string[0];
        var ta = f.GetValues("clas_tipo_agrupado") ?? new string[0];
        if (ti.Length != rutas.Length || ta.Length != rutas.Length)
            return Error(context, 422, "Cada categor\u00eda a clasificar necesita Tipo de iniciativa y Agrupaci\u00f3n.", "ClasificacionInvalida");
        for (var i = 0; i < rutas.Length; i++)
            cls.Add(new ClasificacionSolicitud { Categoria = rutas[i], TipoIniciativa = ti[i], TipoAgrupado = ta[i] });
        var comentario = (f["comentario"] ?? "").Trim();
        try
        {
            var r = new AplicadorSolicitudCambio(SolicitudesCambio.Almacen, SolicitudesCambio.ValidarAplicacion)
                .Aplicar(n, revisor, comentario.Length == 0 ? null : comentario, cls, DashboardDataInfo.HoyEnPresentacion());
            if (r != null)
            {
                context.Response.StatusCode = (int)r["estado_http"];
                context.Response.TrySkipIisCustomErrors = true;
                r.Remove("estado_http");
                return r;
            }
            return new Dictionary<string, object> { { "aplicada", true }, { "id_solicitud", n } };
        }
        catch (ErrorSolicitudCambio) { throw; }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
            context.Response.StatusCode = 500;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object>
            {
                { "error", "No se pudo confirmar la aplicaci\u00f3n: " + DashboardHandler.MensajeSeguro(ex) + " Revisa la solicitud y la iniciativa antes de reintentar." },
                { "tipo", "AplicacionNoConfirmada" }, { "aplicada", null },
            };
        }
    }

    private static object DeLaBase(HttpContext context, ErrorSolicitudCambio ex, string llave)
    {
        context.Response.StatusCode = ex.EstadoHttp;
        context.Response.TrySkipIisCustomErrors = true;
        var salida = new Dictionary<string, object> { { "error", ex.Message }, { "numero", ex.Numero }, { "tipo", ex.Tipo } };
        if (llave != null) salida[llave] = false;
        return salida;
    }

    private static List<object> Errores(List<ErrorCampo> errores)
    {
        var l = new List<object>();
        foreach (var e in errores) l.Add(new Dictionary<string, object> { { "campo", e.Campo }, { "mensaje", e.Mensaje } });
        return l;
    }

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
