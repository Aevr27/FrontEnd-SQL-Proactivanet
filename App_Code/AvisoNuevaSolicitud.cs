// NEW_REQUEST de verdad: aviso al chat de revisores (Power Automate,
// App_Code/AvisoTeams.cs) cuando una solicitud NUEVA quedo guardada.
// Contrato (AvisoTeams.ComoTexto): NEW_REQUEST|tipo|correo|nombre|numero|fecha.
//
//   Iniciativa(resultado)   handlers/admin_iniciativas_validar.ashx, despues de
//                           IniciativaService.Solicitar (adm.usp_SolicitudIniciativa_Crear).
//   Cambio(id, repetida, quien, rol)
//                           handlers/admin_iniciativas_solicitudes.ashx (accion=enviar),
//                           despues de SolicitudesCambio.Almacen.Enviar
//                           (adm.usp_SolicitudCambio_Crear).
//
// CUANDO: solo con la solicitud confirmada. Los dos procedimientos devuelven
// sus OUTPUT despues de su COMMIT (un error lanza y aqui no se llega). Solo
// una NUEVA: Initiative exige Guardada y Nuevo (el mismo token devuelve
// Nuevo = false); Change request exige Repetida = false (la misma llave
// devuelve Repetida = 1). Modificar / reemplazar (sql/41, sql/42) NO avisa
// todavia: es una decision pendiente.
//
// NUNCA LANZA y nunca cambia la respuesta: la solicitud ya esta guardada. Un
// fallo (Power Automate, la lectura del solicitante) se registra en la traza
// (categoria AvisoTeams) sin URL ni datos personales. Sin TeamsWebhookUrl no
// hace nada, ni consulta la base.
//
// DATOS
//   Initiative: correo y nombre GUARDADOS por el alta (resultado.Destinatarios:
//     la foto de adm.SolicitudIniciativa.SolicitanteCorreo / SolicitanteNombre)
//     y el numero que devolvio (#0000142).
//   Change request: la base solo guarda la cuenta (SolicitadoPor = quien).
//     Correo: el de CatPersona si la cuenta se resuelve a UNA persona
//     (SolicitudesCambio.CorreosSolicitante, la regla de IdentidadAcuse); si
//     no y el rol es ADM / MOD, el UNICO dbo.UsuariosAdmin.CorreoUsuario
//     (CorreoAdmin.Elegir) - la misma regla que Nueva solicitud
//     (DestinatariosSolicitud.Resolver). Nombre: el que muestra la cola de
//     cambios (NombreSolicitante.Elegir: UsuariosAdmin.NombreSolicitante,
//     luego CatPersona). Numero #<IdSolicitud> (como la pantalla).
//   Sin correo o sin nombre inequivoco: su posicion va vacia y el aviso sale
//     igual (es para los revisores, no enruta). Nunca se inventa ni se arma
//     cuenta@soriana.com.
//   Fecha: la del servidor al avisar, en la zona de presentacion del sitio
//     (DashboardDataInfo.UtcAPresentacion: Mexico, UTC-06 fijo), aaaa-mm-dd.
//     No la del navegador.
//
// Pruebas: tools/tests/AvisoNuevaSolicitudSmoke.cs y la seccion AV de
// tools/tests/SolicitudesCambioHttpSmoke.cs (sin red ni SQL).

using System;
using System.Collections.Generic;
using System.Globalization;

public sealed class SolicitanteAviso
{
    public string Correo;   // null si no hay uno inequivoco
    public string Nombre;   // null si no hay uno verificado
}

public static class AvisoNuevaSolicitud
{
    // Las pruebas cambian estas tres; el sitio usa las de abajo.
    public static Func<AvisoTeams> Avisador = delegate { return AvisoTeams.Sitio; };
    public static Func<DateTime> AhoraUtc = delegate { return DateTime.UtcNow; };
    public static Func<IdentidadWindows, string, SolicitanteAviso> SolicitanteCambio = ResolverSolicitanteCambio;

    public static string Fecha(DateTime utc)
    {
        return DashboardDataInfo.UtcAPresentacion(utc).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    // null = no aplica (no es una solicitud nueva confirmada): no se intento.
    public static ResultadoAvisoTeams? Iniciativa(ValidadorIniciativa.Resultado r)
    {
        try
        {
            if (r == null || !r.Valida || !r.Guardada || !r.Nuevo || r.ReemplazaA > 0 || r.Numero == null) return null;
            var avisador = Avisador();
            if (avisador == null || !avisador.Configurado()) return ResultadoAvisoTeams.Desactivado;
            var d = r.Destinatarios;
            return avisador.Enviar(Aviso(AvisoTeams.TipoIniciativa, d == null ? null : d.SolicitanteCorreo,
                                         d == null ? null : d.SolicitanteNombre, r.Numero.ToString()));
        }
        catch (Exception ex)
        {
            Registrar("Aviso NEW_REQUEST de iniciativa no enviado: " + ex.GetType().Name + ".");
            return ResultadoAvisoTeams.Fallido;
        }
    }

    // null = no aplica (repetida o id invalido): no se intento.
    public static ResultadoAvisoTeams? Cambio(int idSolicitud, bool repetida, IdentidadWindows quien, string rol)
    {
        var numero = "#" + idSolicitud.ToString(CultureInfo.InvariantCulture);
        try
        {
            if (idSolicitud <= 0 || repetida) return null;
            var avisador = Avisador();
            if (avisador == null || !avisador.Configurado()) return ResultadoAvisoTeams.Desactivado;
            SolicitanteAviso s = null;
            try { s = SolicitanteCambio(quien, rol); }
            catch (Exception ex)
            {
                // Sin solicitante el aviso sale igual (posiciones vacias).
                Registrar("Solicitante de la solicitud de cambio " + numero + " no leido: " + ex.GetType().Name + ".");
            }
            return avisador.Enviar(Aviso(AvisoTeams.TipoCambio, s == null ? null : s.Correo, s == null ? null : s.Nombre, numero));
        }
        catch (Exception ex)
        {
            Registrar("Aviso NEW_REQUEST de la solicitud de cambio " + numero + " no enviado: " + ex.GetType().Name + ".");
            return ResultadoAvisoTeams.Fallido;
        }
    }

    private static AvisoSolicitud Aviso(string tipo, string correo, string nombre, string numero)
    {
        return new AvisoSolicitud
        {
            Evento = AvisoTeams.NuevaSolicitud, Tipo = tipo, SolicitanteEmail = correo, SolicitanteNombre = nombre,
            RequestNumber = numero, Fecha = Fecha(AhoraUtc()),
        };
    }

    // La regla de DATOS (Change request) con las fuentes del sitio
    // (SolicitudesCambio.PersonasSolicitante y NombreSolicitante.Fuente, que
    // las pruebas cambian). Correo y Nombre pueden venir null; null entero
    // solo sin cuenta autenticada.
    public static SolicitanteAviso ResolverSolicitanteCambio(IdentidadWindows quien, string rol)
    {
        if (quien == null || !quien.Autenticada || string.IsNullOrWhiteSpace(quien.Original)) return null;
        var cuenta = quien.Original;
        var cuentas = new[] { cuenta };

        IList<PersonaCatalogo> personas = null;
        try { personas = SolicitudesCambio.PersonasSolicitante(); }
        catch (Exception ex) { DashboardHandler.Registrar("AvisoNuevaSolicitud", ex); }
        string correoCat = null, nombreCat = null;
        if (personas != null)
        {
            SolicitudesCambio.CorreosSolicitante(cuentas, personas).TryGetValue(cuenta, out correoCat);
            IdentidadAcuse.NombresPorCuenta(cuentas, personas).TryGetValue(cuenta, out nombreCat);
        }

        FichaUsuarioAdmin ficha;
        NombreSolicitante.LeerSinFallar(cuentas).TryGetValue(NombreSolicitante.Clave(cuenta) ?? "", out ficha);

        var correo = correoCat;
        if (correo == null && RolAdmin.EsElevado(rol) && ficha != null) correo = CorreoAdmin.Elegir(ficha.Correos);
        correo = IdentidadAcuse.ClaveCorreo(correo);
        if (!DestinatariosSolicitud.EsCorreo(correo)) correo = null;

        var visible = NombreSolicitante.Elegir(cuenta, ficha, nombreCat, null);
        var esNombre = visible.Fuente == NombreSolicitante.FuenteNombreAdmin || visible.Fuente == NombreSolicitante.FuenteNombreVerificado;
        return new SolicitanteAviso { Correo = correo, Nombre = esNombre ? visible.Texto : null };
    }

    private static void Registrar(string mensaje)
    {
        try { DashboardHandler.Registrar(AvisoTeams.CategoriaTraza, new ErrorAvisoTeams(mensaje)); }
        catch (Exception) { }
    }
}
