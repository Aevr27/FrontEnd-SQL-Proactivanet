// Interruptor global "Iniciativas abiertas": deja que cualquier cuenta
// Windows autenticada (sin rol en dbo.UsuariosAdmin) pida una iniciativa
// por Nueva solicitud.
//
// CONFIGURACION: appSettings de Web.config
//
//     <add key="IniciativasAbiertas" value="true" />
//
// Solo "true" (sin distinguir mayusculas) lo enciende; ausente, vacio o
// cualquier otro valor: APAGADO (falla cerrado). Se lee en cada request: un
// cambio en Web.config reinicia la aplicacion y vale en el siguiente.
//
// QUE ABRE (solo esto, y solo con el interruptor encendido)
//   la pagina admin/iniciativas.html, en modo "solo Nueva solicitud"
//   (admin/iniciativas.js, modoSolicitante) y los CUATRO handlers que ese
//   formulario usa:
//     admin_iniciativas_catalogos   (tipos y cascada; ?duenos=1 sigue ADM;
//                                    rutas_adm sigue ADM)
//     admin_iniciativas_capacidad   (capacidad de la categoria elegida)
//     admin_iniciativas_volumetria  (sin alcance=total, que sigue ADM)
//     admin_iniciativas_validar     (validar y guardar la solicitud)
//   Todo lo demas de Admin (registro, solicitudes de cambio, acuse, gestion,
//   recientes, diagnostico, correos, alta de categoria) sigue exigiendo ADM
//   o MOD (AccesoAdmin.Exigir / ExigirAdm) y lo protege AdminAccesoModulo
//   igual que antes. Ningun otro modulo del tablero mira este interruptor.
//
// ADM y MOD no dependen del interruptor: entran como siempre
// (AccesoAdmin.PuedeEntrar). El interruptor no da rol: quien entra por aqui
// sigue siendo VIEWER para AccesoAdmin.Rol.
//
// No es el ciclo de vida de una solicitud ni de una iniciativa: no cambia
// ningun estado, solo quien puede abrir el formulario y enviarlo.
//
// Se prueba sin IIS ni SQL en tools/tests/AccesoIniciativasHttpSmoke.cs.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Web;
using System.Web.Script.Serialization;

public static class AccesoIniciativas
{
    public const string ClaveConfig = "IniciativasAbiertas";

    // Rutas (relativas a la aplicacion) que abre el interruptor.
    public static readonly string[] RutasSolicitante =
    {
        AccesoAdmin.PaginaProtegida,
        "~/handlers/admin_iniciativas_catalogos.ashx",
        "~/handlers/admin_iniciativas_capacidad.ashx",
        "~/handlers/admin_iniciativas_volumetria.ashx",
        "~/handlers/admin_iniciativas_validar.ashx",
    };

    public const string MensajeCerrado =
        "La solicitud de iniciativas no est\u00e1 abierta para tu cuenta.";

    // De donde sale el valor del interruptor. La real lee Web.config; las
    // pruebas ponen la suya. Nada del sitio la cambia.
    public static Func<string> LeerConfig = delegate
    {
        try { return ConfigurationManager.AppSettings[ClaveConfig]; }
        catch { return null; }
    };

    public static bool Habilitado(string valorConfig)
    {
        return string.Equals((valorConfig ?? string.Empty).Trim(), "true", StringComparison.OrdinalIgnoreCase);
    }

    public static bool Abiertas()
    {
        return Habilitado(LeerConfig == null ? null : LeerConfig());
    }

    public static bool EsRutaSolicitante(string rutaRelativa)
    {
        if (string.IsNullOrEmpty(rutaRelativa)) return false;
        foreach (var r in RutasSolicitante)
            if (string.Equals(rutaRelativa, r, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // La regla sin HttpContext: ADM/MOD siempre; si no, solo con el
    // interruptor y una identidad Windows autenticada.
    public static bool Evaluar(bool puedeEntrarAdmin, bool abiertas, IdentidadWindows id)
    {
        if (puedeEntrarAdmin) return true;
        return abiertas && id != null && id.Autenticada;
    }

    // Puede abrir Nueva solicitud y enviarla. ADM/MOD primero (no cambia
    // nada para ellos); el interruptor solo se lee para los demas.
    public static bool PuedeSolicitar(HttpContext context)
    {
        if (AccesoAdmin.PuedeEntrar(context)) return true;
        return Evaluar(false, Abiertas(), IdentidadWindows.DesdeContexto(context));
    }

    // Entro por el interruptor (no es ADM/MOD). Solo para la interfaz.
    public static bool EsSoloSolicitante(HttpContext context)
    {
        return !AccesoAdmin.PuedeEntrar(context) && PuedeSolicitar(context);
    }

    // Para los cuatro handlers de Nueva solicitud: true si sigue; si no, ya
    // respondio 403 AccesoDenegado en JSON y hay que salir.
    public static bool ExigirSolicitud(HttpContext context)
    {
        if (PuedeSolicitar(context)) return true;
        Rechazar(context, true);
        return false;
    }

    // El 403 de AccesoAdmin (mismo {error, tipo: AccesoDenegado}) con el
    // mensaje de que la solicitud no esta abierta.
    public static void Rechazar(HttpContext context, bool json)
    {
        AccesoAdmin.Rechazar(context, json, MensajeCerrado);
    }
}
