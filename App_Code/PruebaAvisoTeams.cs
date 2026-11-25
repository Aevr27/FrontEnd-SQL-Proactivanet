// Prueba MANUAL de un aviso de Teams (admin/prueba-aviso-teams.html,
// handlers/admin_prueba_aviso_teams.ashx). Disponible en la VM, solo ADM.
//
// Aqui solo se traducen los seis campos que escribe el administrador a un
// AvisoSolicitud igual al que arman los flujos reales; el envio lo hace
// AvisoTeams.Sitio.EnviarConDetalle, la misma instancia que usan
// AvisoNuevaSolicitud y AvisoRevisionSolicitud (configuracion, formato por
// omision, HTTP, timeout y traza). No se fuerza formato ni se lee otra clave.
//
// No confundir con el panel SOLO LOCALHOST (App_Code/PruebasPowerAutomate.cs):
// ese manda datos sinteticos fijos y se excluye del paquete.

using System;
using System.Globalization;

public sealed class EntradaPruebaAvisoTeams
{
    public string Evento;
    public string Tipo;
    public string Correo;
    public string Nombre;
    public string Numero;
    public string Dato;
}

public static class PruebaAvisoTeams
{
    public const int MaxCorreo = 255;
    public const int MaxNombre = 200;
    public const int MaxNumero = 50;
    public const int MaxDato = 2000;

    // El panel ofrece INICIATIVA / CAMBIO; al webhook viaja el valor del
    // contrato (Initiative / Change request), que es lo que lee el flujo.
    public static string Tipo(string valor)
    {
        var v = (valor ?? string.Empty).Trim();
        if (v == "INICIATIVA" || v == AvisoTeams.TipoIniciativa) return AvisoTeams.TipoIniciativa;
        if (v == "CAMBIO" || v == AvisoTeams.TipoCambio) return AvisoTeams.TipoCambio;
        return null;
    }

    public static bool EventoConocido(string e)
    {
        return e == AvisoTeams.NuevaSolicitud || e == AvisoTeams.SolicitudAprobada || e == AvisoTeams.SolicitudRechazada;
    }

    // El aviso, o null con `codigo` / `motivo` del rechazo (nada se envia).
    // Los textos no se limpian aqui: "|" y saltos de linea los neutraliza
    // AvisoTeams al armar el TextBlock, como en produccion. Un correo que no
    // tiene forma de correo se rechaza: los flujos reales lo dejarian en null
    // (AvisoRevisionSolicitud.Correo) y el panel no debe enviar otra cosa.
    public static AvisoSolicitud Armar(EntradaPruebaAvisoTeams e, out string codigo, out string motivo)
    {
        codigo = null; motivo = null;
        if (e == null) { codigo = "SinDatos"; motivo = "Sin datos."; return null; }
        var evento = (e.Evento ?? string.Empty).Trim();
        if (!EventoConocido(evento)) { codigo = "EventoDesconocido"; motivo = "Evento desconocido."; return null; }
        var tipo = Tipo(e.Tipo);
        if (tipo == null) { codigo = "TipoDesconocido"; motivo = "Tipo desconocido: INICIATIVA o CAMBIO."; return null; }

        if (Largo(e.Correo) > MaxCorreo || Largo(e.Nombre) > MaxNombre || Largo(e.Numero) > MaxNumero || Largo(e.Dato) > MaxDato)
        {
            codigo = "CampoDemasiadoLargo";
            motivo = string.Format(CultureInfo.InvariantCulture,
                "Algun campo excede su largo maximo (correo {0}, nombre {1}, numero {2}, dato {3}).", MaxCorreo, MaxNombre, MaxNumero, MaxDato);
            return null;
        }

        var correo = Vacio(e.Correo) ? null : e.Correo.Trim();
        if (correo != null && !DestinatariosSolicitud.EsCorreo(correo))
        {
            codigo = "CorreoInvalido"; motivo = "El correo no tiene forma de correo."; return null;
        }

        var aviso = new AvisoSolicitud
        {
            Evento = evento,
            Tipo = tipo,
            SolicitanteEmail = correo,
            SolicitanteNombre = Vacio(e.Nombre) ? null : e.Nombre,
            RequestNumber = Vacio(e.Numero) ? null : e.Numero,
        };
        var dato = Vacio(e.Dato) ? null : e.Dato;
        if (evento == AvisoTeams.NuevaSolicitud) aviso.Fecha = dato;
        else if (evento == AvisoTeams.SolicitudAprobada) aviso.Codigo = dato;
        else aviso.Comentario = dato;

        // La misma regla que aplica EnviarConDetalle; se revisa antes para
        // decir "aviso invalido" y no confundirlo con configuracion invalida.
        var invalido = AvisoTeams.MotivoInvalido(aviso);
        if (invalido != null) { codigo = "AvisoInvalido"; motivo = "Aviso no enviable: " + invalido; return null; }
        return aviso;
    }

    // Clasifica el resultado para el panel. Solo usa lo que EnvioAvisoTeams
    // ya expone (resultado, codigo HTTP, WebExceptionStatus): nada del URL.
    public static string Clasificar(EnvioAvisoTeams e)
    {
        if (e == null) return "FalloInterno";
        switch (e.Resultado)
        {
            case ResultadoAvisoTeams.Enviado: return "Aceptado";
            case ResultadoAvisoTeams.Desactivado: return "SinWebhook";
            case ResultadoAvisoTeams.Invalido: return "ConfiguracionInvalida";
        }
        if (e.Http.HasValue) return "HttpNoExitoso";
        if (e.Red == "Timeout") return "TiempoAgotado";
        if (e.Red != null) return "FalloRed";
        // Fallido sin HTTP ni estado de red: excepcion al serializar o
        // antes de la red (ver la traza AvisoTeams).
        return "FalloInterno";
    }

    // Para la traza: sin correo, nombre, numero ni dato (texto libre).
    public static string DescribirIntento(string evento, string tipo, string clase, EnvioAvisoTeams e)
    {
        var s = "Prueba manual " + (evento ?? "?") + " " + (tipo ?? "?") + ": " + clase;
        if (e != null && e.Http.HasValue) s += " HTTP " + e.Http.Value.ToString(CultureInfo.InvariantCulture);
        if (e != null && e.Red != null) s += " " + e.Red;
        return s + ".";
    }

    private static bool Vacio(string s) { return string.IsNullOrWhiteSpace(s); }
    private static int Largo(string s) { return s == null ? 0 : s.Length; }
}
