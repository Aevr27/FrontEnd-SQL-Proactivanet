// =====================================================================
// TODO(TEMPORAL) - WHITELIST DE PRUEBA DE ADMIN -> INICIATIVAS
// =====================================================================
//
// USO ACTUAL: SOLO DESARROLLO LOCAL. Desde 2026-10-09 el sitio desplegado
// decide la entrada solo con el rol de dbo.UsuariosAdmin; esta lista ya no
// deja entrar ni deja fuera a nadie en la VM ni en produccion. La lee
// AccesoDesarrolloLocal: en IIS Express (DEBUG + loopback + iisexpress)
// la cuenta de desarrollo (ADMIN_DEV_IDENTIDAD, la pone dev-local.cmd)
// tiene que estar aqui para entrar a Admin sin Windows Auth. Otra cuenta
// local no entra. Lo de abajo describe como funcionaba como puerta.
//
// ESTE ARCHIVO ES TEMPORAL. La autorizacion de Admin ya es DB-backed
// (dbo.UsuariosAdmin, RolAdmin); queda solo para el atajo de desarrollo
// local y se elimina junto con el (ver AccesoDesarrolloLocal.cs).
//
// HISTORIA (antes de 2026-10-09). Por que existia: el ambiente desplegado
// ya tiene Windows Authentication, pero no tenemos acceso a su Web.config,
// asi que la clave AdminAllowedUsers no se puede llenar alli. Mientras
// tanto, esta era la UNICA lista de cuentas con acceso a Admin ->
// Iniciativas. Ninguna otra parte del proyecto debe nombrar estas cuentas.
//
// Como se usa HOY: AccesoAdmin.Configurada() la lee con el MISMO parser
// (ListaAutorizados.Leer: "DOMINIO\cuenta", sin distinguir mayusculas,
// entradas sin dominio ignoradas) y solo AccesoDesarrolloLocal la consulta.
// Exigir() en cada handler admin_iniciativas_*, AdminAccesoModulo y
// admin_sesion.ashx deciden con AccesoAdmin.PuedeEntrar (rol de
// dbo.UsuariosAdmin), no con esta lista.
//
// PARA QUITARLA (junto con el atajo de desarrollo local):
//   1. Borrar este archivo.
//   2. En AccesoAdmin.Configurada(), cambiar la linea marcada
//      "TODO(TEMPORAL)" por la fuente definitiva.
//   3. En tools/tests/IdentidadAdminSmoke.cs, quitar el bloque marcado
//      "TODO(TEMPORAL)".
// =====================================================================

public static class AdminWhitelistTemporal
{
    // Separadas por ";" como AdminAllowedUsers. SOLO esta cuenta, por ahora.
    public const string Cuentas = @"SORIANA\t_andresvr";
}
