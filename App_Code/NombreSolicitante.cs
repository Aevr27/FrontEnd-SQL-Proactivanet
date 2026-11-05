// Como se MUESTRA a quien envio una solicitud (de cambio o de iniciativa) en
// las colas de ADM y en "Mis solicitudes". Solo pantalla: la cuenta Windows
// (SolicitadoPor / SolicitanteCuenta) sigue siendo la llave de autorizacion,
// propiedad, idempotencia y auditoria, y no cambia.
//
// PRIORIDAD (solicitante_mostrar + solicitante_mostrar_fuente)
//   1. NOMBRE_ADMIN       dbo.UsuariosAdmin.NombreSolicitante (sql/35, lo
//                         captura un DBA) de las filas de ESA cuenta: un solo
//                         nombre (sin acentos, mayusculas ni espacios de mas,
//                         IdentidadAcuse.ClaveNombre); vacio / solo espacios
//                         no cuenta; dos distintos = ninguno (como sql/36,
//                         51418).
//   2. NOMBRE_VERIFICADO  el nombre que ya se usaba: el de CatPersona de la
//                         cuenta (cambios, IdentidadAcuse) o el guardado al
//                         enviar (iniciativas, SolicitanteNombre). Asi un
//                         PO / SO que no esta en UsuariosAdmin no pierde su
//                         nombre.
//   3. CORREO             dbo.UsuariosAdmin.CorreoUsuario unico de la cuenta
//                         (CorreoAdmin.Elegir) o, si no, el verificado
//                         (CatPersona / el guardado al enviar).
//   4. CUENTA             la cuenta Windows tal cual.
//
// La busqueda es POR CUENTA (Usuario sin espacios a los lados ni mayusculas,
// la misma regla que RolAdmin, CorreoAdmin y sql/36), nunca por nombre: dos
// cuentas con nombres parecidos no se mezclan. Si UsuariosAdmin no se puede
// leer (o no tiene sql/35), se sigue con 2-4: la lista sale igual.
// Se prueba sin SQL en tools/tests/NombreSolicitanteSmoke.cs.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Linq;

// Lo capturado en dbo.UsuariosAdmin para UNA cuenta (todas sus filas).
public sealed class FichaUsuarioAdmin
{
    public readonly List<string> Nombres = new List<string>();
    public readonly List<string> Correos = new List<string>();
}

// Las fichas de varias cuentas, por NombreSolicitante.Clave(cuenta). Lanza si
// no puede leerlas.
public interface IFuenteFichasUsuariosAdmin
{
    Dictionary<string, FichaUsuarioAdmin> Leer(ICollection<string> claves);
}

// La real: SELECT sobre dbo.UsuariosAdmin (solo lectura, como RolAdmin y
// CorreoAdmin). Sin la columna de sql/35 lee solo los correos.
public sealed class FuenteFichasUsuariosAdminSql : IFuenteFichasUsuariosAdmin
{
    private readonly Func<SqlConnection> abrir;
    public FuenteFichasUsuariosAdminSql() : this(null) { }
    public FuenteFichasUsuariosAdminSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    public const int PorLote = 200;

    public Dictionary<string, FichaUsuarioAdmin> Leer(ICollection<string> claves)
    {
        var salida = new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
        if (claves == null || claves.Count == 0) return salida;
        var lista = claves.Where(c => !string.IsNullOrEmpty(c)).Distinct(StringComparer.Ordinal).ToList();
        if (lista.Count == 0) return salida;
        using (var cn = abrir())
        {
            if (cn.State != ConnectionState.Open) cn.Open();
            bool conNombre;
            using (var cmd = new SqlCommand("SELECT CASE WHEN COL_LENGTH(N'dbo.UsuariosAdmin', N'NombreSolicitante') IS NULL THEN 0 ELSE 1 END", cn) { CommandTimeout = 15 })
                conNombre = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
            for (var desde = 0; desde < lista.Count; desde += PorLote)
            {
                var lote = lista.Skip(desde).Take(PorLote).ToList();
                using (var cmd = new SqlCommand { Connection = cn, CommandTimeout = 30 })
                {
                    var nombres = new List<string>();
                    for (var i = 0; i < lote.Count; i++)
                    {
                        nombres.Add("@c" + i);
                        cmd.Parameters.Add("@c" + i, SqlDbType.NVarChar, 256).Value = lote[i];
                    }
                    cmd.CommandText = "SELECT u.Usuario, u.CorreoUsuario, " +
                        (conNombre ? "u.NombreSolicitante" : "NombreSolicitante = CONVERT(nvarchar(255), NULL)") +
                        " FROM dbo.UsuariosAdmin AS u WHERE UPPER(LTRIM(RTRIM(u.Usuario))) IN (" + string.Join(", ", nombres.ToArray()) + ");";
                    using (var r = cmd.ExecuteReader())
                        while (r.Read())
                        {
                            var clave = NombreSolicitante.Clave(r.IsDBNull(0) ? null : Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture));
                            if (clave == null) continue;
                            FichaUsuarioAdmin f;
                            if (!salida.TryGetValue(clave, out f)) salida[clave] = f = new FichaUsuarioAdmin();
                            f.Correos.Add(r.IsDBNull(1) ? null : Convert.ToString(r.GetValue(1), CultureInfo.InvariantCulture));
                            f.Nombres.Add(r.IsDBNull(2) ? null : Convert.ToString(r.GetValue(2), CultureInfo.InvariantCulture));
                        }
                }
            }
        }
        return salida;
    }
}

public sealed class SolicitanteVisible
{
    public string Texto;
    public string Fuente;   // NOMBRE_ADMIN | NOMBRE_VERIFICADO | CORREO | CUENTA | null (sin cuenta)
}

public static class NombreSolicitante
{
    // Las pruebas la cambian por una falsa.
    public static IFuenteFichasUsuariosAdmin Fuente = new FuenteFichasUsuariosAdminSql();

    public const string FuenteNombreAdmin = "NOMBRE_ADMIN";
    public const string FuenteNombreVerificado = "NOMBRE_VERIFICADO";
    public const string FuenteCorreo = "CORREO";
    public const string FuenteCuenta = "CUENTA";

    // La llave de la cuenta: sin espacios a los lados y en mayusculas (la de
    // RolAdmin, CorreoAdmin y sql/36). null si no hay cuenta.
    public static string Clave(string cuenta)
    {
        if (cuenta == null) return null;
        var c = cuenta.Trim();
        return c.Length == 0 ? null : c.ToUpperInvariant();
    }

    // El unico NombreSolicitante de la cuenta (recortado), o null: vacio,
    // solo espacios o invalido no cuentan; dos distintos (por ClaveNombre) = null.
    public static string NombreUnico(IEnumerable<string> nombres)
    {
        if (nombres == null) return null;
        string elegido = null, clave = null;
        foreach (var n in nombres)
        {
            var k = IdentidadAcuse.ClaveNombre(n);
            if (k == null) continue;
            if (clave == null) { clave = k; elegido = n.Trim(); continue; }
            if (k != clave) return null;
        }
        return elegido;
    }

    public static SolicitanteVisible Elegir(string cuenta, FichaUsuarioAdmin ficha, string nombreVerificado, string correoVerificado)
    {
        var nombreAdmin = ficha == null ? null : NombreUnico(ficha.Nombres);
        if (nombreAdmin != null) return new SolicitanteVisible { Texto = nombreAdmin, Fuente = FuenteNombreAdmin };
        if (!string.IsNullOrWhiteSpace(nombreVerificado)) return new SolicitanteVisible { Texto = nombreVerificado.Trim(), Fuente = FuenteNombreVerificado };
        var correo = (ficha == null ? null : CorreoAdmin.Elegir(ficha.Correos)) ?? CorreoAdmin.Elegir(new[] { correoVerificado });
        if (correo != null) return new SolicitanteVisible { Texto = correo, Fuente = FuenteCorreo };
        if (Clave(cuenta) != null) return new SolicitanteVisible { Texto = cuenta.Trim(), Fuente = FuenteCuenta };
        return new SolicitanteVisible { Texto = null, Fuente = null };
    }

    // Las fichas de esas cuentas; si UsuariosAdmin no se puede leer, ninguna
    // (se registra y la lista sale con lo verificado / la cuenta).
    public static Dictionary<string, FichaUsuarioAdmin> LeerSinFallar(IEnumerable<string> cuentas)
    {
        var claves = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in cuentas ?? new string[0]) { var k = Clave(c); if (k != null) claves.Add(k); }
        if (claves.Count == 0) return new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
        try { return Fuente.Leer(claves) ?? new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal); }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("NombreSolicitante.LeerSinFallar", ex);
            return new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
        }
    }

    // Pone solicitante_mostrar y solicitante_mostrar_fuente en cada fila.
    // campoCuenta: solicitado_por (cambios) o solicitante_cuenta (iniciativas).
    // nombre / correo: lo verificado de la fila (puede ser null).
    public static void Agregar(IList<Dictionary<string, object>> filas, string campoCuenta,
                               Func<Dictionary<string, object>, string> nombre, Func<Dictionary<string, object>, string> correo)
    {
        if (filas == null || filas.Count == 0) return;
        Func<Dictionary<string, object>, string> cuenta = f => { object v; return f.TryGetValue(campoCuenta, out v) ? v as string : null; };
        var fichas = LeerSinFallar(filas.Select(cuenta));
        foreach (var f in filas)
        {
            var c = cuenta(f);
            FichaUsuarioAdmin ficha;
            var k = Clave(c);
            fichas.TryGetValue(k ?? "", out ficha);
            var v = Elegir(c, ficha, nombre == null ? null : nombre(f), correo == null ? null : correo(f));
            f["solicitante_mostrar"] = v.Texto;
            f["solicitante_mostrar_fuente"] = v.Fuente;
        }
    }

    // Iniciativas: lo guardado al enviar (SolicitanteNombre / SolicitanteCorreo) es lo verificado.
    public static void AgregarIniciativas(IList<Dictionary<string, object>> filas)
    {
        Agregar(filas, "solicitante_cuenta", f => Texto(f, "solicitante_nombre"), f => Texto(f, "solicitante_correo"));
    }

    private static string Texto(Dictionary<string, object> f, string k) { object v; return f.TryGetValue(k, out v) ? v as string : null; }
}
