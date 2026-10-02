// =====================================================================
// TODO(TEMPORAL) - WHITELIST DE PRUEBA DE ADMIN -> INICIATIVAS
// =====================================================================
//
// ESTE ARCHIVO ES TEMPORAL Y SE ELIMINA cuando la autorizacion de Admin
// pase a ser DB-backed (hito posterior; la tabla todavia NO existe y no se
// crea aqui).
//
// Por que existe: el ambiente desplegado ya tiene Windows Authentication,
// pero no tenemos acceso a su Web.config, asi que la clave AdminAllowedUsers
// no se puede llenar alli. Mientras tanto, esta es la UNICA lista de cuentas
// con acceso a Admin -> Iniciativas. Ninguna otra parte del proyecto debe
// nombrar estas cuentas.
//
// Como se usa: AccesoAdmin.Configurada() la lee con el MISMO parser
// (ListaAutorizados.Leer: "DOMINIO\cuenta", sin distinguir mayusculas,
// entradas sin dominio ignoradas). Todo lo demas no cambia: Exigir() en
// cada handler admin_iniciativas_*, AdminAccesoModulo y admin_sesion.ashx
// pasan por AccesoAdmin.EstaAutorizado. No es un bypass: la identidad sigue
// siendo la que entrega IIS (HttpContext.User.Identity.Name); quien no este
// autenticado o no este en la lista recibe 403.
//
// PARA QUITARLA (al tener autorizacion en base):
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
