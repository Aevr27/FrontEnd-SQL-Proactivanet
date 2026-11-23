// =====================================================================
// SOLO DESARROLLO LOCAL - Panel "Pruebas de Power Automate" de
// admin/pruebas-power-automate.html (admin/pruebas-power-automate.js,
// handlers/admin_pruebas_power_automate.ashx). admin/admin.html no lo carga.
// Ninguna funcionalidad real depende de estos archivos: se excluyen del
// paquete de produccion.
// =====================================================================
//
// Manda a mano los tres eventos (NEW_REQUEST, REQUEST_APPROVED,
// REQUEST_REJECTED) por AvisoTeams con datos SINTETICOS (TEST-PA-00x): no lee
// ni escribe solicitudes, no consume consecutivos, no genera Codigos.
//
// FRONTERA: Disponible() es la UNICA puerta y se decide en el servidor con
// AccesoDesarrolloLocal (AdminDevOverride + DEBUG + Request.IsLocal + proceso
// iisexpress + base de desarrollo / QA + cuenta en la whitelist) y ademas rol
// ADM. En la VM (IIS, w3wp.exe, debug="false") siempre es false: el handler
// responde 404 sin enviar nada y la pagina no pinta el panel. Nada que mande
// el navegador la abre.
//
// DESTINATARIO: los mensajes privados de Teams necesitan un correo real.
// En orden: TeamsPruebaDestinatario del Web.config LOCAL (opcional); si no,
// la cuenta de desarrollo resuelta en dbo.CatPersona (IdentidadAcuse, la
// regla de Nueva solicitud); si no, su dbo.UsuariosAdmin.CorreoUsuario
// unico (CorreoAdmin). Sin ninguno, no se envia: nunca se arma un correo.
// El NOMBRE del aviso es siempre NombrePrueba, venga de donde venga el correo.
// Para enrutar los mensajes privados a una cuenta de QA fija (p. ej. el campo
// [2] de aprobar / rechazar) se pone TeamsPruebaDestinatario y se quita al
// terminar: no hay otro override y los flujos reales no lo leen.
//
// SOLICITANTE SIMULADO (accion=enviar_solicitante): en vez de lo anterior,
// pasa una solicitud sintetica por la resolucion REAL (ver EnviarComoSolicitante).
//
// TIPO: campo opcional "tipo" (Initiative por omision, o Change request). Solo
// cambia [1]: iniciativas y solicitudes de cambio usan los mismos tres eventos.
//
// PARA QUITARLO: borrar este archivo, el handler, admin/pruebas-power-automate.js,
// admin/pruebas-power-automate.html y la prueba
// tools/tests/PruebasPowerAutomateSmoke.cs.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Web;

public sealed class DestinatarioPrueba
{
    public string Correo;
    public string Nombre;   // null si no se conoce
    public string Fuente;   // CONFIGURACION | CATPERSONA | USUARIOSADMIN
}

public static class PruebasPowerAutomate
{
    public const string ClaveDestinatario = "TeamsPruebaDestinatario";
    // Nombre FIJO de los tres avisos de prueba. El destinatario de
    // TeamsPruebaDestinatario o de UsuariosAdmin no trae nombre, y el flujo
    // saludaba "Hola," vacio. Solo el panel lo usa: en los flujos reales un
    // nombre desconocido sigue viajando vacio (AvisoTeams no lo inventa).
    public const string NombrePrueba = "Usuario de Prueba";

    public static bool Disponible(HttpContext ctx)
    {
        try { return AccesoDesarrolloLocal.Rol(ctx) == RolAdmin.Adm; }
        catch (Exception) { return false; }
    }

    // El campo "tipo" del panel: vacio = Initiative; si no, uno de los dos
    // valores del contrato tal cual (null = desconocido). Viaja crudo en [1]:
    // el texto que ve Teams ("Iniciativa" / "Cambio") lo arma el flujo.
    public static string Tipo(string valor)
    {
        if (string.IsNullOrWhiteSpace(valor)) return AvisoTeams.TipoIniciativa;
        var v = valor.Trim();
        return v == AvisoTeams.TipoIniciativa || v == AvisoTeams.TipoCambio ? v : null;
    }

    public static AvisoSolicitud Aviso(string evento, DestinatarioPrueba d)
    {
        return Aviso(evento, AvisoTeams.TipoIniciativa, d);
    }

    // El aviso sintetico de cada evento, o null si el evento no es uno de los
    // tres o el tipo no es del contrato.
    public static AvisoSolicitud Aviso(string evento, string tipo, DestinatarioPrueba d)
    {
        if (d == null) throw new ArgumentNullException("d");
        if (tipo != AvisoTeams.TipoIniciativa && tipo != AvisoTeams.TipoCambio) return null;
        var a = new AvisoSolicitud
        {
            Evento = evento,
            Tipo = tipo,
            SolicitanteEmail = d.Correo,
            SolicitanteNombre = NombrePrueba,
        };
        if (evento == AvisoTeams.NuevaSolicitud)
        {
            a.RequestNumber = "TEST-PA-001";
            a.Estado = "ENVIADA";
            // Como el NEW_REQUEST real (seis campos, con fecha), para que la
            // rama NEW_REQUEST del flujo se pruebe con este boton.
            a.Fecha = AvisoNuevaSolicitud.Fecha(AvisoNuevaSolicitud.AhoraUtc());
        }
        else if (evento == AvisoTeams.SolicitudAprobada)
        {
            a.RequestNumber = "TEST-PA-002";
            a.Estado = "APROBADA";
            a.Codigo = "TEST-2026-000001";
        }
        else if (evento == AvisoTeams.SolicitudRechazada)
        {
            a.RequestNumber = "TEST-PA-003";
            a.Estado = "RECHAZADA";
            a.Comentario = "Esta es una prueba de rechazo desde localhost.";
        }
        else return null;
        return a;
    }

    // La regla de DESTINATARIO, sin SQL ni HttpContext (las pruebas pasan falsos).
    public static DestinatarioPrueba Resolver(string configurado, IdentidadWindows cuenta,
                                              Func<IdentidadWindows, IdentidadAcuse> catPersona,
                                              Func<IdentidadWindows, string> usuariosAdmin)
    {
        var c = configurado == null ? null : configurado.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(c))
            return DestinatariosSolicitud.EsCorreo(c) ? new DestinatarioPrueba { Correo = c, Fuente = "CONFIGURACION" } : null;
        if (cuenta == null || !cuenta.Autenticada) return null;

        IdentidadAcuse yo = null;
        try { yo = catPersona == null ? null : catPersona(cuenta); }
        catch (Exception ex) { DashboardHandler.Registrar("PruebasPowerAutomate", ex); }
        if (yo != null && yo.EsResuelta && DestinatariosSolicitud.EsCorreo(yo.Correo))
            return new DestinatarioPrueba { Correo = yo.Correo, Nombre = yo.Nombre, Fuente = "CATPERSONA" };

        string correo = null;
        try { correo = usuariosAdmin == null ? null : usuariosAdmin(cuenta); }
        catch (Exception ex) { DashboardHandler.Registrar("PruebasPowerAutomate", ex); }
        correo = correo == null ? null : correo.Trim().ToLowerInvariant();
        return DestinatariosSolicitud.EsCorreo(correo) ? new DestinatarioPrueba { Correo = correo, Fuente = "USUARIOSADMIN" } : null;
    }

    // La regla con las fuentes del sitio y la cuenta de desarrollo del request.
    public static DestinatarioPrueba ResolverSitio(HttpContext ctx)
    {
        string configurado;
        try { configurado = ConfigurationManager.AppSettings[ClaveDestinatario]; }
        catch (Exception) { configurado = null; }
        return Resolver(configurado, AccesoAdmin.IdentidadEscritura(ctx),
            delegate (IdentidadWindows id) { return IdentidadAcuse.Resolver(id, new FuentePersonasAcuseSql().Personas()); },
            delegate (IdentidadWindows id)
            {
                return CorreoAdmin.Para(id, CorreoAdmin.Fuente,
                    delegate (Exception e) { DashboardHandler.Registrar("PruebasPowerAutomate", e); });
            });
    }

    // ---- SOLICITANTE SIMULADO ---------------------------------------------
    // Prueba la resolucion REAL del destinatario: arma la fila de la solicitud
    // como la leeria la base y la pasa por AvisoRevisionSolicitud (la misma
    // ruta que aprobar / rechazar / aplicar). NO usa ResolverSitio ni
    // TeamsPruebaDestinatario, y el contrato no se toca despues de armarlo:
    // solo se registra el cuerpo que sale hacia la red.
    //   Initiative: la fila lleva solicitante_correo / solicitante_nombre, la
    //     foto que guarda el alta en adm.SolicitudIniciativa (el fixture).
    //   Change request: la fila lleva solicitado_por y rol_solicitante; el
    //     correo lo resuelve ResolverSolicitanteCambio contra CatPersona /
    //     UsuariosAdmin de la base local (solo lectura). Una cuenta que no
    //     este ahi no recibe nada: no hay respaldo por configuracion.
    public const int IdCambioPrueba = 999001;
    public const string CodigoPrueba = "TEST-2026-000001";
    public const string ComentarioPrueba = "Esta es una prueba de rechazo desde localhost.";
    public const string NumeroAprobadaPrueba = "TEST-PA-002";
    public const string NumeroRechazadaPrueba = "TEST-PA-003";
    public static readonly string[] RolesSolicitante = { "ADM", "MOD", "PSO" };

    public sealed class EnvioSolicitante
    {
        public ResultadoAvisoTeams? Resultado;
        public string Cuerpo;   // tal cual salio hacia el webhook; null si no se envio
        public string Texto;    // el TextBlock del contrato (formato "texto"), o null
        public int? Http;
    }

    // Registra el cuerpo y el codigo; el envio lo hace el transporte real.
    private sealed class TransporteCaptura : ITransporteAvisoTeams
    {
        private readonly ITransporteAvisoTeams _red;
        public byte[] Cuerpo;
        public int? Http;
        public TransporteCaptura(ITransporteAvisoTeams red) { _red = red; }
        public int Post(Uri url, byte[] cuerpo, int timeoutMs)
        {
            Cuerpo = cuerpo;
            var h = _red.Post(url, cuerpo, timeoutMs);
            Http = h;
            return h;
        }
    }

    public static Dictionary<string, object> FilaIniciativa(string evento, string correo, string nombre)
    {
        var aprobada = evento == AvisoTeams.SolicitudAprobada;
        return new Dictionary<string, object>
        {
            { "numero_texto", aprobada ? NumeroAprobadaPrueba : NumeroRechazadaPrueba },
            { "estado", aprobada ? "ENVIADA" : AvisoRevisionSolicitud.EstadoIniciativaRechazada },
            { "solicitante_correo", correo },
            { "solicitante_nombre", string.IsNullOrWhiteSpace(nombre) ? NombrePrueba : nombre.Trim() },
        };
    }

    public static Dictionary<string, object> FilaCambio(string evento, string cuenta, string rol)
    {
        return new Dictionary<string, object>
        {
            { "id", IdCambioPrueba },
            { "estado", evento == AvisoTeams.SolicitudAprobada ? AvisoRevisionSolicitud.EstadoCambioAplicado : AvisoRevisionSolicitud.EstadoCambioRechazado },
            { "folio", CodigoPrueba },
            { "solicitado_por", cuenta },
            { "rol_solicitante", rol },
        };
    }

    // evento: REQUEST_APPROVED | REQUEST_REJECTED. Initiative usa correo /
    // nombre; Change request usa cuenta / rol. red: el transporte real del
    // sitio (o uno falso en las pruebas).
    public static EnvioSolicitante EnviarComoSolicitante(string evento, string tipo, string correo, string nombre,
                                                         string cuenta, string rol, Func<string> url, Func<string> formato,
                                                         ITransporteAvisoTeams red, Action<string, Exception> registrar)
    {
        var captura = new TransporteCaptura(red);
        var avisador = new AvisoTeams(url, formato, captura, registrar, AvisoTeams.TimeoutMsPorOmision);
        Func<AvisoTeams> fuente = delegate { return avisador; };
        var aprobada = evento == AvisoTeams.SolicitudAprobada;
        ResultadoAvisoTeams? r;
        if (tipo == AvisoTeams.TipoIniciativa)
            r = aprobada
                ? AvisoRevisionSolicitud.IniciativaAprobada(fuente, FilaIniciativa(evento, correo, nombre), CodigoPrueba, true)
                : AvisoRevisionSolicitud.IniciativaRechazada(fuente, FilaIniciativa(evento, correo, nombre), ComentarioPrueba);
        else
            r = aprobada
                ? AvisoRevisionSolicitud.CambioAprobado(fuente, FilaCambio(evento, cuenta, rol))
                : AvisoRevisionSolicitud.CambioRechazado(fuente, FilaCambio(evento, cuenta, rol), ComentarioPrueba);

        var salida = new EnvioSolicitante { Resultado = r, Http = captura.Http };
        if (captura.Cuerpo != null)
        {
            salida.Cuerpo = System.Text.Encoding.UTF8.GetString(captura.Cuerpo);
            salida.Texto = TextoDeTarjeta(salida.Cuerpo);
        }
        return salida;
    }

    // attachments[0].content.body[0].text del sobre "texto"; null si el
    // cuerpo es de otro formato ("json").
    public static string TextoDeTarjeta(string cuerpo)
    {
        try
        {
            var m = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(cuerpo);
            var adj = (Dictionary<string, object>)((System.Collections.ArrayList)m["attachments"])[0];
            var tarjeta = (Dictionary<string, object>)adj["content"];
            var bloque = (Dictionary<string, object>)((System.Collections.ArrayList)tarjeta["body"])[0];
            return bloque["text"] as string;
        }
        catch (Exception) { return null; }
    }
}
