// =====================================================================
// SOLO DESARROLLO LOCAL - Panel "Pruebas de Power Automate" de
// admin/admin.html (admin/pruebas-power-automate.js,
// handlers/admin_pruebas_power_automate.ashx).
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
//
// PARA QUITARLO: borrar este archivo, el handler, admin/pruebas-power-automate.js,
// su <script> y su contenedor en admin/admin.html, y la prueba
// tools/tests/PruebasPowerAutomateSmoke.cs.

using System;
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

    // El aviso sintetico de cada evento, o null si el evento no es uno de los tres.
    public static AvisoSolicitud Aviso(string evento, DestinatarioPrueba d)
    {
        if (d == null) throw new ArgumentNullException("d");
        var a = new AvisoSolicitud
        {
            Evento = evento,
            Tipo = AvisoTeams.TipoIniciativa,
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
}
