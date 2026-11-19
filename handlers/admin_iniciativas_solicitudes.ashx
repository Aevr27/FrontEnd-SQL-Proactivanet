<%@ WebHandler Language="C#" Class="AdminIniciativasSolicitudes" %>

// Solicitudes de cambio de una iniciativa (App_Code/SolicitudCambioAdmin.cs,
// sql/22). Quien envia, su rol y quien revisa salen SIEMPRE de la identidad
// Windows y de dbo.UsuariosAdmin (AccesoAdmin), nunca del formulario.
//
//   (accion siempre en la URL: ?accion=...)
//   POST accion=enviar     Exigir (ADM o MOD) o, sin rol, el PO / SO de ESA
//        iniciativa (App_Code/SolicitudCambioPso.cs, sql/37): PO/SO vigente
//        como en Nueva solicitud, cuenta resuelta a UNA persona de CatPersona
//        y su nombre es el OwnerProblem / OwnerServicio capturado del folio.
//        Solo entonces el SERVIDOR firma con rol PSO (nunca del formulario).
//        Si no: 403 AccesoDenegado / IdentidadNoResuelta / NoEsDueno (o 503
//        DuenosNoDisponibles sin poder leerlos); nada se guarda. La base lo
//        vuelve a comprobar en su transaccion (51225 404, 51226 403).
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
//           422 { errores, tipo: CapacidadExcedida } tope de 100% por
//               categoria (categorias / estado / varios; la regla de aplicar)
//           503 { tipo: CapacidadNoDisponible } sin poder leer la capacidad
//           501 { tipo: PersistenciaNoHabilitada } sin sql/22: nada se guarda
//           500 { tipo: EnvioNoConfirmado, enviada: null } (no se sabe)
//        NUNCA escribe la iniciativa.
//   POST accion=cancelar   id, motivo (obligatorio, hasta 2000)   (sql/41)
//        Como enviar: Exigir (ADM o MOD) o AccesoIniciativas.ExigirSolicitud.
//        SOLO quien la envio (SolicitadoPor = la cuenta de IIS, nunca del
//        formulario) y SOLO PENDIENTE: lo decide la base con el candado de
//        Aplicar / Rechazar (adm.usp_SolicitudCambio_Cancelar). Nada se
//        borra: la fila queda CANCELADA con quien, cuando y por que, y un
//        evento CANCELADA.
//        -> 200 { cancelada: true, id_solicitud }
//           404 SolicitudNoExiste (no existe o es de otra cuenta: igual)
//           409 SolicitudNoPendiente (ADM la reviso antes: gana el primero;
//               estado_actual dice como quedo)
//           422 FaltaMotivoCancelacion / MotivoCancelacionLargo
//           501 CancelacionNoHabilitada (sin sql/41)
//           500 { cancelada: null } (no se sabe si quedo)
//   POST accion=reemplazar  reemplaza_a, motivo_cancelacion + TODOS los
//        campos de enviar (con su llave nueva). La MISMA autorizacion y
//        validacion que enviar (PSO, catalogo, tope de 100%, formato) y
//        luego adm.usp_SolicitudCambio_Reemplazar: crea una solicitud NUEVA
//        (otro numero, PENDIENTE, ADM la revisa desde el principio,
//        ReemplazaA = la original) y cancela la original con un evento
//        REEMPLAZADA, en UNA transaccion. Si algo no pasa, la original sigue
//        PENDIENTE y no se guarda nada.
//        -> 200 { enviada: true, reemplazada: true, id_solicitud (la nueva),
//                 reemplaza_a, repetida }
//           los mismos 4xx / 5xx de enviar y de cancelar (ademas 422
//           OtraIniciativa y 409 LlaveUsada).
//   GET  accion=listar[&estado=PENDIENTE|APLICADA|RECHAZADA|CANCELADA]   ExigirAdm
//   GET  accion=detalle&id=N                                    ExigirAdm
//        Las dos agregan solicitante_nombre (solo pantalla): solicitado_por
//        resuelta a CatPersona.Nombre (SolicitudesCambio.NombresSolicitante);
//        null si no resuelve o es ambigua. solicitado_por no cambia.
//        detalle agrega es_propia (la envio la cuenta de IIS que pregunta) y
//        puede_cancelar (es_propia, PENDIENTE y sql/41): solo pantalla; la
//        base decide al cancelar.
//   POST accion=rechazar  id, comentario (obligatorio)          ExigirAdm
//   POST accion=aplicar   id, comentario (obligatorio en Otros), pares
//        clas_categoria / clas_tipo_iniciativa / clas_tipo_agrupado (solo
//        categorias por agregar sin clasificacion)              ExigirAdm
//        Valida como la edicion directa y aplica en una transaccion
//        (adm.usp_SolicitudCambio_Aplicar). Necesita tambien la persistencia
//        de la edicion directa (PersistenciaGestionAdmin): escribe la
//        iniciativa.
//        -> 200 { aplicada: true };  409 desactualizada / ya revisada / tope /
//           sin clasificacion / SolicitudCancelada (quien la envio la
//           cancelo o reemplazo antes: gana el primero);
//           422 validacion o comentario;  404 no existe;
//           500 { tipo: AplicacionNoConfirmada, aplicada: null }.
//        Toda falla de validacion o de la base deja la solicitud PENDIENTE y
//        registrada (Intentos, UltimoError, evento).
//
//   GET  accion=historicas&folio=X   (sql/83) SOLO LECTURA, solo pantalla:
//        las asociaciones de baja (VigenteEnOrigen = 0) de ESA iniciativa, que
//        volver a agregar REACTIVA. La MISMA autorizacion que enviar: ADM o
//        MOD; sin rol, el PO / SO de ESA iniciativa (SolicitudCambioPso,
//        sql/37 / 38). ADM las ve todas; MOD y PSO solo las del catalogo del
//        par PO / SO capturado (lo que de verdad pueden pedir: ExigirCatalogo).
//        La base vuelve a decidir al enviar y al aplicar; esto no da permisos.
//        -> 200 { disponible, folio, filtro, historicas: [ {categoria,
//           tipo_iniciativa, tipo_agrupado, pct_dism, f_creacion, f_analisis} ] }
//           { disponible: false } sin sql/83;  400 SinFolio;  403 / 503 como enviar.
//
//   403 antes de leer nada: Exigir (VIEWER, anonimo, rol que falla; para
//   enviar sin rol, AccesoIniciativas.ExigirSolicitud) y, en lo que es de
//   ADM, ExigirAdm (MOD y PO/SO: RolInsuficiente). 405 metodo equivocado.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

public class AdminIniciativasSolicitudes : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        // Primero quien es, antes de leer el cuerpo. La accion va en la URL
        // (?accion=): se decide el permiso sin leer el cuerpo. ADM o MOD; o,
        // SOLO para enviar, un PO/SO vigente (si el folio es suyo se decide
        // en Enviar, con el folio del formulario).
        var req = context.Request;
        var accion = req.QueryString["accion"];
        // Enviar, cancelar y reemplazar son del SOLICITANTE (la base decide
        // si la solicitud es suya); lo demas, de ADM.
        var delSolicitante = accion == "enviar" || accion == "cancelar" || accion == "reemplazar" || accion == "historicas";
        if (delSolicitante && !AccesoAdmin.PuedeEntrar(context))
        {
            if (!AccesoIniciativas.ExigirSolicitud(context)) return;
        }
        else if (!AccesoAdmin.Exigir(context)) return;
        if (!delSolicitante
            && !AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) revisa, aplica o rechaza solicitudes de cambio.")) return;

        DashboardHandler.Responder(context, delegate
        {
            // sql/22 / sql/25 en la base (DeteccionSolicitudesCambio), antes de
            // validar: el tipo datos depende de ella. Si no se puede, apagado.
            try { DeteccionSolicitudesCambio.Revisar(); }
            catch (Exception ex) { DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex); }
            var esPost = string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase);
            var escribe = accion == "enviar" || accion == "rechazar" || accion == "aplicar" || accion == "cancelar" || accion == "reemplazar";
            if (escribe)
            {
                if (!esPost) return Error(context, 405, "Usa POST.", "MetodoNoPermitido");
            }
            else if (accion == "listar" || accion == "detalle" || accion == "historicas")
            {
                if (esPost) return Error(context, 405, "Usa GET.", "MetodoNoPermitido");
            }
            else return Error(context, 400, "Acci\u00f3n desconocida.", "AccionDesconocida");

            // Lo que escribe necesita quien firme (atribucion): la cuenta
            // Windows o, solo en desarrollo local, la del atajo
            // (AccesoAdmin.IdentidadEscritura). Leer la cola solo necesita el
            // permiso de arriba.
            var id = AccesoAdmin.IdentidadEscritura(context) ?? IdentidadWindows.Desde(null, false);
            if (escribe && (!id.Autenticada || string.IsNullOrEmpty(id.Original)))
                return Error(context, 403, "Sin usuario autenticado no se guarda nada.", "SinUsuario");
            var rol = AccesoAdmin.Rol(context);

            if (accion == "historicas") return Historicas(context, id, rol);
            if (accion == "enviar") return Enviar(context, id, rol, 0, null);
            if (accion == "cancelar") return Cancelar(context, id);
            if (accion == "reemplazar")
            {
                int original;
                if (!int.TryParse(req.Form["reemplaza_a"], out original) || original <= 0)
                    return Error(context, 400, "Falta el n\u00famero de la solicitud que se corrige.", "SinSolicitud");
                var motivoCancelacion = (req.Form["motivo_cancelacion"] ?? "").Trim();
                var malo = ErrorMotivoCancelacion(context, motivoCancelacion);
                if (malo != null) return malo;
                if (!PersistenciaSolicitudesCambio.CancelacionActiva())
                    return Error(context, 501, PersistenciaSolicitudesCambio.MotivoCancelacion, "CancelacionNoHabilitada");
                return Enviar(context, id, rol, original, motivoCancelacion);
            }
            if (!PersistenciaSolicitudesCambio.Activa())
                return Error(context, 501, PersistenciaSolicitudesCambio.MotivoCola, "PersistenciaNoHabilitada");
            try
            {
                if (accion == "listar")
                {
                    var estado = req.QueryString["estado"];
                    if (!string.IsNullOrEmpty(estado) && !SolicitudesCambio.EsEstadoCola(estado))
                        return Error(context, 400, "Estado de solicitud desconocido.", "EstadoDesconocido");
                    var lista = SolicitudesCambio.Almacen.Listar(string.IsNullOrEmpty(estado) ? null : estado, 200);
                    // Nombre de quien envio, solo para mostrar (solicitado_por no cambia).
                    SolicitudesCambio.AgregarNombreSolicitante(lista);
                    return new Dictionary<string, object> { { "solicitudes", lista } };
                }
                int n;
                var texto = accion == "detalle" ? req.QueryString["id"] : req.Form["id"];
                if (!int.TryParse(texto, out n) || n <= 0) return Error(context, 400, "Falta el n\u00famero de la solicitud.", "SinSolicitud");
                if (accion == "detalle")
                {
                    var d = SolicitudesCambio.Almacen.Detalle(n);
                    if (d == null) return Error(context, 404, "La solicitud no existe.", "SolicitudNoExiste");
                    // Otras iniciativas activas de cada categoria (ya es ADM).
                    SolicitudesCambio.AgregarOtrasIniciativas(d);
                    SolicitudesCambio.AgregarIdentidadesDetalle(d);
                    SolicitudesCambio.MarcarPropia(d, id.Original);
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
                // Carrera con quien la envio: si ya la cancelo (o reemplazo),
                // se dice eso y no "ya revisada".
                int n2;
                if ((accion == "aplicar" || accion == "rechazar") && ex.Numero == 51202 && ex.InnerException is System.Data.SqlClient.SqlException
                    && int.TryParse(req.Form["id"], out n2))
                {
                    var cancelada = SinFallar(delegate { return SolicitudesCambio.Almacen.Detalle(n2); });
                    if (cancelada != null && cancelada["estado"] as string == "CANCELADA")
                        return Cancelada(context, cancelada, accion == "aplicar" ? "aplicada" : "rechazada");
                }
                return DeLaBase(context, ex, accion == "aplicar" ? "aplicada" : accion == "rechazar" ? "rechazada" : null);
            }
        });
    }

    // Lo que ve ADM cuando quien la envio la cancelo o la reemplazo antes.
    private static object Cancelada(HttpContext context, Dictionary<string, object> d, string llave)
    {
        context.Response.StatusCode = 409;
        context.Response.TrySkipIisCustomErrors = true;
        var nueva = d.ContainsKey("reemplazada_por") ? d["reemplazada_por"] : null;
        return new Dictionary<string, object>
        {
            { "error", nueva != null
                ? "Quien la envi\u00f3 la reemplaz\u00f3 por la solicitud #" + nueva + " antes de tu revisi\u00f3n: esta qued\u00f3 cancelada y no se cambi\u00f3 nada. Revisa la nueva."
                : "Quien la envi\u00f3 la cancel\u00f3 antes de tu revisi\u00f3n: no se cambi\u00f3 nada." },
            { "numero", 51202 }, { "tipo", "SolicitudCancelada" }, { llave, false }, { "estado_actual", "CANCELADA" },
            { "reemplazada_por", nueva },
        };
    }

    // Una lectura para mejorar un mensaje: si falla, sin ella.
    private static Dictionary<string, object> SinFallar(Func<Dictionary<string, object>> leer)
    {
        try { return leer(); }
        catch (Exception ex) { DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex); return null; }
    }

    private static object ErrorMotivoCancelacion(HttpContext context, string motivo)
    {
        if (motivo.Length == 0)
            return Error(context, 422, ErrorSolicitudCambio.MensajeDe(51228, null), "FaltaMotivoCancelacion");
        if (motivo.Length > SolicitudesCambio.MaximoMotivoCancelacion)
            return Error(context, 422, ErrorSolicitudCambio.MensajeDe(51229, null), "MotivoCancelacionLargo");
        return null;
    }

    // sql/41: quien la envio la cancela. La base decide si es suya y si
    // sigue PENDIENTE (con el candado de Aplicar / Rechazar).
    private static object Cancelar(HttpContext context, IdentidadWindows id)
    {
        int n;
        if (!int.TryParse(context.Request.Form["id"], out n) || n <= 0)
            return Error(context, 400, "Falta el n\u00famero de la solicitud.", "SinSolicitud");
        var motivo = (context.Request.Form["motivo"] ?? "").Trim();
        var malo = ErrorMotivoCancelacion(context, motivo);
        if (malo != null) return malo;
        if (!PersistenciaSolicitudesCambio.CancelacionActiva())
            return Error(context, 501, PersistenciaSolicitudesCambio.MotivoCancelacion, "CancelacionNoHabilitada");
        try
        {
            SolicitudesCambio.Cancelaciones.Cancelar(n, id.Original, motivo);
            return new Dictionary<string, object> { { "cancelada", true }, { "id_solicitud", n } };
        }
        catch (ErrorSolicitudCambio ex) { return DeLaCancelacion(context, ex, "cancelada", n, id.Original); }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
            context.Response.StatusCode = 500;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object>
            {
                { "error", "No se pudo confirmar la cancelaci\u00f3n: " + DashboardHandler.MensajeSeguro(ex) + " Actualiza tus solicitudes antes de reintentar." },
                { "tipo", "CancelacionNoConfirmada" }, { "cancelada", null },
            };
        }
    }

    // Un error de Cancelar / Reemplazar. 51230 (ADM la reviso antes): dice
    // como quedo, leida SOLO dentro de la cuenta (DetalleDe).
    private static object DeLaCancelacion(HttpContext context, ErrorSolicitudCambio ex, string llave, int original, string cuenta)
    {
        var salida = (Dictionary<string, object>)DeLaBase(context, ex, llave);
        if (ex.Numero == 51230)
        {
            var d = SinFallar(delegate { return SolicitudesCambio.Mias.DetalleDe(original, cuenta); });
            if (d != null)
            {
                salida["estado_actual"] = d["estado"];
                var e = d["estado"] as string;
                if (e == "APLICADA") salida["error"] = "Un administrador ya aplic\u00f3 esta solicitud: no se cambi\u00f3 nada.";
                else if (e == "RECHAZADA") salida["error"] = "Un administrador ya rechaz\u00f3 esta solicitud: no se cambi\u00f3 nada.";
                else if (e == "CANCELADA") salida["error"] = "La solicitud ya estaba cancelada: no se cambi\u00f3 nada.";
            }
        }
        return salida;
    }

    // sql/83: las asociaciones de baja de ESA iniciativa (solo pantalla). La
    // MISMA autorizacion que Enviar; MOD y PSO ven solo las que pueden pedir
    // (el catalogo del par PO / SO capturado), ADM todas.
    private static object Historicas(HttpContext context, IdentidadWindows id, string rol)
    {
        var folio = (context.Request.QueryString["folio"] ?? "").Trim();
        if (folio.Length == 0) return Error(context, 400, "Falta el folio de la iniciativa.", "SinFolio");
        if (!PersistenciaSolicitudesCambio.ReactivacionActiva())
            return new Dictionary<string, object> { { "disponible", false }, { "folio", folio }, { "historicas", new List<object>() } };
        if (!RolAdmin.EsElevado(rol))
        {
            DecisionCambioPso d;
            try
            {
                var lectura = AccesoIniciativas.Lectura(context);
                d = SolicitudCambioPso.Evaluar(id, PersistenciaSolicitudesCambio.SolicitaPsoActiva(), AccesoIniciativas.Motivo(context),
                                               lectura.Personas, folio, SolicitudesCambio.DuenosCapturados,
                                               PersistenciaSolicitudesCambio.SolicitaPsoEquipoActiva() ? lectura.Directorio : null);
            }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
                return Error(context, 503, "No se pudo comprobar que la iniciativa es tuya. Int00e9ntalo de nuevo.", "DuenosNoDisponibles");
            }
            if (!d.Puede) return Error(context, d.Http, d.Mensaje, d.Tipo);
        }
        List<CategoriaHistorica> lista;
        var esAdm = rol == RolAdmin.Adm;
        try
        {
            lista = CategoriasHistoricas.Leer(folio);
            if (!esAdm)
            {
                // Lo que ExigirCatalogo deja pedir: el catalogo del par capturado.
                var duenos = SolicitudesCambio.DuenosCapturados(folio) ?? new string[] { null, null };
                var rutas = duenos[0] != null && duenos[1] != null ? SolicitudesCambio.RutasAgregables(duenos[0], duenos[1]) : null;
                lista = rutas == null ? new List<CategoriaHistorica>()
                                      : lista.Where(h => rutas.Contains(DirectorioOrganizacional.Normaliza(h.Ruta))).ToList();
            }
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
            return Error(context, 503, "No se pudieron leer las categor00edas que estuvieron ligadas.", "HistoricasNoDisponibles");
        }
        return new Dictionary<string, object>
        {
            { "disponible", true }, { "folio", folio }, { "filtro", esAdm ? "todas" : "par_po_so" },
            { "historicas", CategoriasHistoricas.ComoJson(lista) },
        };
    }

    // reemplazaA > 0: reemplazo (sql/41) de esa solicitud, con la MISMA
    // autorizacion y validacion que un envio nuevo.
    private static object Enviar(HttpContext context, IdentidadWindows id, string rol, int reemplazaA, string motivoCancelacion)
    {
        var usuario = id.Original;
        var p = PeticionSolicitudCambio.DesdeFormulario(context.Request.Form);
        // Sin rol de Admin: solo el PO / SO de ESTE folio, y entonces el rol
        // es PSO, puesto aqui (SolicitudCambioPso). Nada del formulario lo cambia.
        if (!RolAdmin.EsElevado(rol))
        {
            DecisionCambioPso d;
            try
            {
                var lectura = AccesoIniciativas.Lectura(context);
                d = SolicitudCambioPso.Evaluar(id, PersistenciaSolicitudesCambio.SolicitaPsoActiva(), AccesoIniciativas.Motivo(context),
                                               lectura.Personas, p.Folio, SolicitudesCambio.DuenosCapturados,
                                               PersistenciaSolicitudesCambio.SolicitaPsoEquipoActiva() ? lectura.Directorio : null);
            }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
                context.Response.StatusCode = 503;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "error", "No se pudo comprobar que la iniciativa es tuya: no se envi\u00f3 la solicitud. Int\u00e9ntalo de nuevo." },
                    { "tipo", "DuenosNoDisponibles" }, { "enviada", false },
                };
            }
            if (!d.Puede)
            {
                context.Response.StatusCode = d.Http;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object> { { "error", d.Mensaje }, { "tipo", d.Tipo }, { "enviada", false } };
            }
            rol = SolicitudCambioPso.Rol;
        }
        p.ExigirSubestadoDeAdm(rol);
        // Categorias por AGREGAR: solo del PO / SO capturados de la
        // iniciativa, en el catalogo de la cascada, revisado aqui y no solo
        // en el navegador. Sin poder leerlo no se envia (503).
        if (p.Valida && p.AgregaCategorias())
        {
            string[] duenos;
            ICollection<string> rutas;
            try
            {
                duenos = SolicitudesCambio.DuenosCapturados(p.Folio) ?? new string[] { null, null };
                rutas = duenos[0] != null && duenos[1] != null ? SolicitudesCambio.RutasAgregables(duenos[0], duenos[1]) : null;
            }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
                context.Response.StatusCode = 503;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "error", "No se pudo revisar el cat\u00e1logo de categor\u00edas: no se envi\u00f3 la solicitud. Int\u00e9ntalo de nuevo." },
                    { "tipo", "CatalogoNoDisponible" }, { "enviada", false },
                };
            }
            p.ExigirCatalogo(duenos[0], duenos[1], rutas);
        }
        if (!p.Valida)
        {
            context.Response.StatusCode = 422;
            context.Response.TrySkipIisCustomErrors = true;
            return new Dictionary<string, object> { { "errores", Errores(p.Errores) }, { "tipo", "ValidacionFallida" }, { "enviada", false } };
        }
        // Tope de 100% por categoria (categorias, Estado y varios): la MISMA
        // regla que al aplicar (SolicitudesCambio.ErroresCapacidad), antes de
        // guardar. Sin poder leer la capacidad no se envia (503).
        if (SolicitudesCambio.RevisaCapacidad(p))
        {
            List<string> motivos;
            try { motivos = SolicitudesCambio.ErroresCapacidad(p, SolicitudesCambio.LeerCapacidad(p.Folio)); }
            catch (Exception ex)
            {
                DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex);
                context.Response.StatusCode = 503;
                context.Response.TrySkipIisCustomErrors = true;
                return new Dictionary<string, object>
                {
                    { "error", "No se pudo revisar la capacidad de las categor\u00edas (tope de 100%): no se envi\u00f3 la solicitud. Int\u00e9ntalo de nuevo." },
                    { "tipo", "CapacidadNoDisponible" }, { "enviada", false },
                };
            }
            if (motivos.Count > 0)
            {
                context.Response.StatusCode = 422;
                context.Response.TrySkipIisCustomErrors = true;
                var errores = new List<object>();
                foreach (var m in motivos) errores.Add(new Dictionary<string, object> { { "campo", "categoria" }, { "mensaje", m } });
                return new Dictionary<string, object> { { "errores", errores }, { "tipo", "CapacidadExcedida" }, { "enviada", false } };
            }
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
            if (reemplazaA > 0)
            {
                var nueva = SolicitudesCambio.Cancelaciones.Reemplazar(reemplazaA, motivoCancelacion, p, usuario, rol);
                return new Dictionary<string, object>
                {
                    { "enviada", true }, { "reemplazada", true }, { "id_solicitud", nueva.IdSolicitud },
                    { "reemplaza_a", reemplazaA }, { "repetida", nueva.Repetida },
                };
            }
            var r = SolicitudesCambio.Almacen.Enviar(p, usuario, rol);
            return new Dictionary<string, object> { { "enviada", true }, { "id_solicitud", r.IdSolicitud }, { "repetida", r.Repetida } };
        }
        catch (ErrorSolicitudCambio ex)
        {
            return reemplazaA > 0 ? DeLaCancelacion(context, ex, "enviada", reemplazaA, usuario) : DeLaBase(context, ex, "enviada");
        }
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
