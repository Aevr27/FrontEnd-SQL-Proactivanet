// REQUEST_APPROVED / REQUEST_REJECTED de verdad: mensaje privado de Teams
// (Power Automate, App_Code/AvisoTeams.cs) al SOLICITANTE ORIGINAL cuando ADM
// revisa su solicitud. Contrato (AvisoTeams.ComoTexto):
//     REQUEST_APPROVED|tipo|correo|nombre|numero|codigo
//     REQUEST_REJECTED|tipo|correo|nombre|numero|comentario
//
//   IniciativaAprobada   handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx
//                        (Aprobar, tras adm.usp_SolicitudIniciativa_AprobarYCrear)
//   IniciativaRechazada  el mismo handler (rechazar, tras adm.usp_SolicitudIniciativa_Rechazar)
//   CambioAprobado       handlers/admin_iniciativas_solicitudes.ashx
//                        (Aplicar, tras adm.usp_SolicitudCambio_Aplicar)
//   CambioRechazado      el mismo handler (rechazar, tras adm.usp_SolicitudCambio_Rechazar)
//
// DESTINATARIO: nunca quien revisa. El correo [2] y el nombre [3] salen de la
// solicitud GUARDADA:
//   Initiative: SolicitanteCorreo / SolicitanteNombre de adm.SolicitudIniciativa
//     (la foto que tomo el alta).
//   Change request: la base solo guarda la cuenta (SolicitadoPor) y el rol CON
//     EL QUE ENVIO (RolSolicitante: ADM, MOD o PSO, CHECK de sql/37). Se
//     resuelve con la misma regla que NEW_REQUEST
//     (AvisoNuevaSolicitud.ResolverSolicitanteCambio) pero con ESE rol, no
//     con el del revisor (siempre ADM): con el del revisor un PO/SO sin
//     CatPersona tomaria por error el respaldo de UsuariosAdmin.
//   Sin correo valido no se envia (AvisoTeams.MotivoInvalido lo rechaza y lo
//   registra): un mensaje privado nunca va a otra persona.
//
// UNA VEZ: Initiative aprobada solo con Nueva = true (el reintento u otro ADM
// que gano devuelven Nueva = false con el mismo Codigo). Un rechazo o un
// cambio ya revisado no llega aqui: el procedimiento lanza 51412 / 51202
// (409). Rechazos y cambio aplicado releen la solicitud DESPUES del COMMIT y
// solo avisan si quedo en el estado final esperado (RECHAZADA / APLICADA).
// Sin reintentos: un reenvio podria duplicar el mensaje.
//
// AVISO PERDIDO (aceptado, no se resuelve en la base): si el COMMIT ocurre
// pero la llamada falla antes de devolver (500 RevisionNoConfirmada /
// AplicacionNoConfirmada), no se avisa; el reintento devuelve Nueva = false o
// 409 y tampoco avisa.
//
// NUNCA LANZA y nunca cambia la respuesta: la revision ya esta guardada.
// Sin TeamsWebhookUrl no hace nada, ni relee la base (Detalle).
//
// Pruebas: tools/tests/AvisoRevisionSolicitudSmoke.cs (sin red ni SQL) y las
// secciones AR de SolicitudesCambioHttpSmoke y RevisionSolicitudesIniciativaHttpSmoke.

using System;
using System.Collections.Generic;
using System.Globalization;

public static class AvisoRevisionSolicitud
{
    // Las pruebas cambian estas dos; el sitio usa las de abajo.
    public static Func<AvisoTeams> Avisador = delegate { return AvisoTeams.Sitio; };
    public static Func<IdentidadWindows, string, SolicitanteAviso> SolicitanteCambio = AvisoNuevaSolicitud.ResolverSolicitanteCambio;

    public const string EstadoIniciativaRechazada = "RECHAZADA";
    public const string EstadoCambioAplicado = "APLICADA";
    public const string EstadoCambioRechazado = "RECHAZADA";

    // Relee la solicitud despues del COMMIT. null si los avisos estan
    // apagados (no se consulta la base) o si la lectura falla: un aviso que
    // no puede salir nunca convierte la revision en error.
    public static Dictionary<string, object> Detalle(Func<Dictionary<string, object>> leer)
    {
        try
        {
            var avisador = Avisador();
            if (avisador == null || !avisador.Configurado() || leer == null) return null;
            return leer();
        }
        catch (Exception ex)
        {
            Registrar("Solicitud revisada no releida para el aviso: " + ex.GetType().Name + ".");
            return null;
        }
    }

    // detalle: RegistroSolicitudesIniciativa.Lector.Detalle leido ANTES de
    // aprobar (solicitante_* no cambia al aprobar). null = no aplica.
    public static ResultadoAvisoTeams? IniciativaAprobada(Dictionary<string, object> detalle, string codigo, bool nueva)
    {
        try
        {
            if (!nueva || detalle == null || string.IsNullOrWhiteSpace(codigo)) return null;
            return EnviarIniciativa(AvisoTeams.SolicitudAprobada, detalle, codigo);
        }
        catch (Exception ex) { return Fallo("REQUEST_APPROVED de iniciativa", ex); }
    }

    // detalle: releido despues del COMMIT (Detalle). null = no aplica.
    public static ResultadoAvisoTeams? IniciativaRechazada(Dictionary<string, object> detalle, string comentario)
    {
        try
        {
            if (detalle == null || Texto(detalle, "estado") != EstadoIniciativaRechazada) return null;
            return EnviarIniciativa(AvisoTeams.SolicitudRechazada, detalle, comentario);
        }
        catch (Exception ex) { return Fallo("REQUEST_REJECTED de iniciativa", ex); }
    }

    // detalle: SolicitudesCambio.Almacen.Detalle releido despues del COMMIT.
    // [5] = folio: el Codigo de la iniciativa modificada (adm.SolicitudCambio.Codigo),
    // no el IdSolicitud.
    public static ResultadoAvisoTeams? CambioAprobado(Dictionary<string, object> detalle)
    {
        try
        {
            if (detalle == null || Texto(detalle, "estado") != EstadoCambioAplicado) return null;
            return EnviarCambio(AvisoTeams.SolicitudAprobada, detalle, Texto(detalle, "folio"));
        }
        catch (Exception ex) { return Fallo("REQUEST_APPROVED de solicitud de cambio", ex); }
    }

    public static ResultadoAvisoTeams? CambioRechazado(Dictionary<string, object> detalle, string comentario)
    {
        try
        {
            if (detalle == null || Texto(detalle, "estado") != EstadoCambioRechazado) return null;
            return EnviarCambio(AvisoTeams.SolicitudRechazada, detalle, comentario);
        }
        catch (Exception ex) { return Fallo("REQUEST_REJECTED de solicitud de cambio", ex); }
    }

    private static ResultadoAvisoTeams? EnviarIniciativa(string evento, Dictionary<string, object> d, string quinto)
    {
        var numero = Texto(d, "numero_texto");
        if (numero == null) return null;
        var avisador = Avisador();
        if (avisador == null || !avisador.Configurado()) return ResultadoAvisoTeams.Desactivado;
        return avisador.Enviar(Aviso(evento, AvisoTeams.TipoIniciativa, Correo(Texto(d, "solicitante_correo")),
                                     Texto(d, "solicitante_nombre"), numero, quinto));
    }

    private static ResultadoAvisoTeams? EnviarCambio(string evento, Dictionary<string, object> d, string quinto)
    {
        object idCrudo;
        if (!d.TryGetValue("id", out idCrudo) || !(idCrudo is int) || (int)idCrudo <= 0) return null;
        var numero = "#" + ((int)idCrudo).ToString(CultureInfo.InvariantCulture);
        var avisador = Avisador();
        if (avisador == null || !avisador.Configurado()) return ResultadoAvisoTeams.Desactivado;

        SolicitanteAviso s = null;
        var cuenta = Texto(d, "solicitado_por");
        if (cuenta != null)
        {
            try { s = SolicitanteCambio(IdentidadWindows.Desde(cuenta, true), Texto(d, "rol_solicitante")); }
            catch (Exception ex)
            {
                // Sin solicitante no hay a quien avisar: AvisoTeams lo rechaza abajo.
                Registrar("Solicitante de la solicitud de cambio " + numero + " no leido: " + ex.GetType().Name + ".");
            }
        }
        return avisador.Enviar(Aviso(evento, AvisoTeams.TipoCambio, s == null ? null : Correo(s.Correo),
                                     s == null ? null : s.Nombre, numero, quinto));
    }

    private static AvisoSolicitud Aviso(string evento, string tipo, string correo, string nombre, string numero, string quinto)
    {
        var a = new AvisoSolicitud
        {
            Evento = evento, Tipo = tipo, SolicitanteEmail = correo, SolicitanteNombre = nombre, RequestNumber = numero,
        };
        if (evento == AvisoTeams.SolicitudAprobada) a.Codigo = quinto; else a.Comentario = quinto;
        return a;
    }

    // Solo un correo con forma valida; si no, null y el aviso no sale.
    private static string Correo(string c)
    {
        c = c == null ? null : c.Trim();
        return DestinatariosSolicitud.EsCorreo(c) ? c : null;
    }

    private static string Texto(Dictionary<string, object> d, string llave)
    {
        object v;
        if (d == null || !d.TryGetValue(llave, out v) || v == null) return null;
        var s = Convert.ToString(v, CultureInfo.InvariantCulture).Trim();
        return s.Length == 0 ? null : s;
    }

    private static ResultadoAvisoTeams? Fallo(string que, Exception ex)
    {
        Registrar("Aviso " + que + " no enviado: " + ex.GetType().Name + ".");
        return ResultadoAvisoTeams.Fallido;
    }

    private static void Registrar(string mensaje)
    {
        try { DashboardHandler.Registrar(AvisoTeams.CategoriaTraza, new ErrorAvisoTeams(mensaje)); }
        catch (Exception) { }
    }
}
