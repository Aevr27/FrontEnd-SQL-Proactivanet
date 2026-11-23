<%@ WebHandler Language="C#" Class="AdminRcaCorreo" %>

// Correo RCA de PRUEBA (admin/admin.html, seccion "Correo RCA"). La logica
// vive en App_Code/RcaCorreoPrueba.cs; aqui solo se traduce el request.
//
// ACCESO: solo ADM (AccesoAdmin.ExigirAdm, ANTES de leer nada): MOD recibe
// 403 RolInsuficiente; VIEWER y anonimo, 403 AccesoDenegado. ExigirAdm
// tambien exige que un POST venga de una pagina de este sitio (CSRF).
//
//   GET                              -> { remitente, configurado, conectada,
//                                         destinatarios, maxBytes, extensiones, ... }
//   POST accion=guardar  para, cc    -> { ok, destinatarios } | 400 { ok:false, errores }
//   POST accion=enviar   titulo, archivo (multipart; UN archivo)
//                                     -> { ok, codigo, mensaje }
//   POST accion=conectar             -> { ok, conexionPendiente: { codigo, url, expira, intervalo } }
//   POST accion=conectar-estado      -> { ok, estado: pendiente | conectada | sin-conexion }
//   POST accion=desconectar          -> { ok }   (en modo SMTP borra la contrasena)
//   POST accion=smtp-clave  clave    -> { ok }   (solo RcaModo=smtp; se guarda cifrada)
//
// Nunca toca SQL Server, nunca crea iniciativas ni solicitudes y nunca
// devuelve tokens ni contrasenas. El envio usa SIEMPRE los destinatarios guardados.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web;

public class AdminRcaCorreo : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, "Solo un administrador (ADM) puede usar la prueba de correo RCA.")) return;

        DashboardHandler.Responder(context, delegate
        {
            var req = context.Request;
            // Los 4xx/5xx de abajo llevan su JSON: que IIS no lo cambie por
            // su pagina de error.
            context.Response.TrySkipIisCustomErrors = true;
            var servicio = ServicioRca.Real();

            if (string.Equals(req.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                return Estado(servicio);

            if (!string.Equals(req.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                throw new HttpException(405, "Solo GET y POST.");

            var usuario = Usuario(context);
            try
            {
                switch ((req.QueryString["accion"] ?? "").Trim().ToLowerInvariant())
                {
                    case "guardar": return Guardar(context, servicio, usuario);
                    case "enviar": return Enviar(context, servicio, usuario);
                    case "conectar":
                        return new Dictionary<string, object> { { "ok", true }, { "conexionPendiente", servicio.IniciarConexion(usuario) } };
                    case "conectar-estado":
                        var e = servicio.ConsultarConexion();
                        e["ok"] = true;
                        return e;
                    case "desconectar":
                        servicio.Desconectar();
                        return new Dictionary<string, object> { { "ok", true } };
                    case "smtp-clave":
                        // Sin la validacion de ASP.NET: una contrasena puede
                        // llevar "<" y nunca se pinta en ninguna pagina.
                        servicio.GuardarClaveSmtp(req.Unvalidated.Form["clave"], usuario);
                        return new Dictionary<string, object> { { "ok", true } };
                }
            }
            catch (RcaException ex)
            {
                if (ex.InnerException != null) DashboardHandler.Registrar("RcaCorreo", ex.InnerException);
                return Error(context, ex.Status, ex.Codigo, ex.Message);
            }
            return Error(context, 400, "AccionDesconocida", "Accion no valida.");
        });
    }

    private static Dictionary<string, object> Estado(ServicioRca servicio)
    {
        var e = servicio.Estado();
        RcaDestinatarios d;
        try { d = RcaConfiguracion.Leer(servicio.Almacen); }
        catch (RcaException) { d = new RcaDestinatarios(); e["problemaDestinatarios"] = "No se pudo leer la configuracion guardada."; }
        e["destinatarios"] = Destinatarios(d);
        e["maxBytes"] = servicio.Opciones.MaxBytes;
        e["extensiones"] = RcaAdjunto.Extensiones.ToArray();
        e["prefijoAsunto"] = RcaMensaje.PrefijoAsunto;
        e["nombreAdjunto"] = RcaAdjunto.NombreBase;
        e["maxTitulo"] = RcaMensaje.MaxTitulo;
        return e;
    }

    private static object Guardar(HttpContext context, ServicioRca servicio, string usuario)
    {
        var errores = new Dictionary<string, string>();
        var d = RcaConfiguracion.Guardar(servicio.Almacen, context.Request.Form["para"], context.Request.Form["cc"], usuario, DateTime.Now, errores);
        if (d == null)
        {
            context.Response.StatusCode = 400;
            return new Dictionary<string, object> { { "ok", false }, { "codigo", "Validacion" }, { "mensaje", "Revisa los correos." }, { "errores", errores } };
        }
        return new Dictionary<string, object> { { "ok", true }, { "destinatarios", Destinatarios(d) } };
    }

    private static object Enviar(HttpContext context, ServicioRca servicio, string usuario)
    {
        var req = context.Request;
        HttpFileCollection archivos;
        try { archivos = req.Files; }
        catch (HttpException ex)
        {
            // maxRequestLength: el archivo ni siquiera se pudo leer.
            DashboardHandler.Registrar("RcaCorreo.Archivo", ex);
            return Error(context, 413, "AdjuntoInvalido", "El documento es demasiado grande (maximo " + RcaAdjunto.Mb(servicio.Opciones.MaxBytes) + ").");
        }
        if (archivos.Count != 1)
            return Error(context, 400, "AdjuntoInvalido", archivos.Count == 0 ? "Selecciona un documento." : "Solo se permite un documento por prueba.");

        var f = archivos[0];
        byte[] bytes = null;
        if (f != null && f.ContentLength > 0 && f.ContentLength <= servicio.Opciones.MaxBytes)
        {
            // A memoria y nada mas: no se escribe a disco.
            using (var ms = new MemoryStream(f.ContentLength))
            {
                f.InputStream.CopyTo(ms);
                bytes = ms.ToArray();
            }
        }
        else if (f != null && f.ContentLength > servicio.Opciones.MaxBytes)
        {
            return Error(context, 400, "AdjuntoInvalido", "El documento pasa del maximo de " + RcaAdjunto.Mb(servicio.Opciones.MaxBytes) + ".");
        }

        var r = servicio.EnviarPrueba(req.Form["titulo"], f == null ? null : f.FileName, f == null ? null : f.ContentType, bytes ?? new byte[0], usuario);
        if (!r.Ok) context.Response.StatusCode = r.Status;
        return new Dictionary<string, object> { { "ok", r.Ok }, { "codigo", r.Codigo }, { "mensaje", r.Mensaje } };
    }

    private static Dictionary<string, object> Destinatarios(RcaDestinatarios d)
    {
        return new Dictionary<string, object>
        {
            { "para", d.Para }, { "cc", d.Cc },
            { "modificadoPor", d.ModificadoPor }, { "modificadoEl", d.ModificadoEl },
        };
    }

    private static object Error(HttpContext context, int status, string codigo, string mensaje)
    {
        context.Response.StatusCode = status;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "ok", false }, { "codigo", codigo }, { "mensaje", mensaje } };
    }

    private static string Usuario(HttpContext context)
    {
        var id = AccesoAdmin.IdentidadEscritura(context);
        return id == null ? null : id.Original;
    }

    public bool IsReusable { get { return false; } }
}
