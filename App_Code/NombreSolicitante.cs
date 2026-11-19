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
    // fichas: las de UsuariosAdmin ya leidas (null = se leen aqui).
    public static void Agregar(IList<Dictionary<string, object>> filas, string campoCuenta,
                               Func<Dictionary<string, object>, string> nombre, Func<Dictionary<string, object>, string> correo,
                               Dictionary<string, FichaUsuarioAdmin> fichasLeidas = null)
    {
        if (filas == null || filas.Count == 0) return;
        Func<Dictionary<string, object>, string> cuenta = f => { object v; return f.TryGetValue(campoCuenta, out v) ? v as string : null; };
        var fichas = fichasLeidas ?? LeerSinFallar(filas.Select(cuenta));
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

    // =====================================================================
    // CUALQUIER CUENTA (2026-11-05): quien reviso, quien cancelo, los
    // eventos del historial de una solicitud, el Historial de peticiones,
    // Cambios recientes y el historial de fechas de una iniciativa. La MISMA
    // prioridad (Elegir):
    //   1. UsuariosAdmin.NombreSolicitante unico de la cuenta;
    //   2. el nombre verificado: el que la respuesta ya trae para ESA cuenta
    //      (Guardar: p. ej. el SolicitanteNombre de la solicitud de
    //      iniciativa) o, si no, CatPersona por la cuenta (IdentidadAcuse:
    //      cuenta@soriana.com -> UNA persona con nombre unico; nunca por
    //      nombre);
    //   3. el correo (UsuariosAdmin unico o el verificado);
    //   4. la cuenta.
    // Solo pantalla: cada campo de cuenta se queda igual y al lado va
    // <campo>_mostrar (eventos: usuario_mostrar). Una lectura de
    // UsuariosAdmin por respuesta y, solo si a alguna cuenta le falta
    // nombre, una de CatPersona.
    // =====================================================================

    // CatPersona vigente (Nombre, Correo). Las pruebas la cambian.
    public static Func<IList<PersonaCatalogo>> Personas = delegate { return new FuentePersonasAcuseSql().Personas(); };

    // Lo verificado que la respuesta ya trae para una cuenta.
    public sealed class Verificado
    {
        public string Nombre;
        public string Correo;
        public bool Conflicto;   // la misma cuenta con dos nombres distintos: no se usa
    }

    // Anota lo verificado de UNA cuenta. Dos nombres distintos (ClaveNombre)
    // para la misma cuenta = ninguno (Conflicto); el correo, el primero.
    public static void Guardar(Dictionary<string, Verificado> guardados, string cuenta, string nombre, string correo)
    {
        var k = Clave(cuenta);
        if (guardados == null || k == null) return;
        var n = IdentidadAcuse.ClaveNombre(nombre) == null ? null : nombre.Trim();
        Verificado v;
        if (!guardados.TryGetValue(k, out v)) { guardados[k] = new Verificado { Nombre = n, Correo = correo }; return; }
        if (n != null && !v.Conflicto)
        {
            if (v.Nombre == null) v.Nombre = n;
            else if (IdentidadAcuse.ClaveNombre(v.Nombre) != IdentidadAcuse.ClaveNombre(n)) { v.Nombre = null; v.Conflicto = true; }
        }
        if (v.Correo == null) v.Correo = correo;
    }

    private static IList<PersonaCatalogo> PersonasSinFallar(Func<IList<PersonaCatalogo>> personas)
    {
        if (personas == null) return null;
        try { return personas(); }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("NombreSolicitante.Personas", ex);
            return null;
        }
    }

    // Clave(cuenta) -> como se muestra, para un lote de cuentas.
    // guardados: lo verificado de la respuesta (puede ser null). personas:
    // CatPersona (null = no se consulta); se lee una vez y solo si hace falta.
    // fichas: las de UsuariosAdmin ya leidas para estas cuentas (null = se leen aqui).
    public static Dictionary<string, SolicitanteVisible> Resolver(IEnumerable<string> cuentas,
        Dictionary<string, Verificado> guardados, Func<IList<PersonaCatalogo>> personas,
        Dictionary<string, FichaUsuarioAdmin> fichas = null)
    {
        var salida = new Dictionary<string, SolicitanteVisible>(StringComparer.Ordinal);
        var originales = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var c in cuentas ?? new string[0])
        {
            var k = Clave(c);
            if (k != null && !originales.ContainsKey(k)) originales[k] = c.Trim();
        }
        if (originales.Count == 0) return salida;
        if (fichas == null) fichas = LeerSinFallar(originales.Values);
        IList<PersonaCatalogo> catalogo = null;
        var leido = false;
        foreach (var par in originales)
        {
            FichaUsuarioAdmin ficha;
            fichas.TryGetValue(par.Key, out ficha);
            Verificado v = null;
            if (guardados != null) guardados.TryGetValue(par.Key, out v);
            string nombre = v == null || v.Conflicto ? null : v.Nombre;
            string correo = v == null ? null : v.Correo;
            // CatPersona solo si ni UsuariosAdmin ni lo guardado dan nombre.
            if (nombre == null && (ficha == null || NombreUnico(ficha.Nombres) == null))
            {
                if (!leido) { catalogo = PersonasSinFallar(personas); leido = true; }
                if (catalogo != null)
                {
                    try
                    {
                        var r = IdentidadAcuse.Resolver(IdentidadWindows.Desde(par.Value, true), catalogo);
                        if (r.EsResuelta) { nombre = r.Nombre; if (correo == null) correo = r.Correo; }
                    }
                    catch (Exception ex) { DashboardHandler.Registrar("NombreSolicitante.Resolver", ex); }
                }
            }
            salida[par.Key] = Elegir(par.Value, ficha, nombre, correo);
        }
        return salida;
    }

    // Lo que se muestra de una cuenta ya resuelta (null si no hay cuenta).
    public static string TextoDe(Dictionary<string, SolicitanteVisible> resueltos, string cuenta)
    {
        var k = Clave(cuenta);
        SolicitanteVisible v;
        if (k == null || resueltos == null || !resueltos.TryGetValue(k, out v)) return null;
        return v.Texto;
    }

    // Pone <campo>_mostrar en cada objeto que tiene ese campo de cuenta, y
    // usuario_mostrar en cada uno de sus "eventos" (conEventos). Un solo
    // Resolver para todo.
    public static void AnotarCuentas(IList<Dictionary<string, object>> objetos, string[] campos, bool conEventos,
        Dictionary<string, Verificado> guardados, Func<IList<PersonaCatalogo>> personas,
        Dictionary<string, FichaUsuarioAdmin> fichas = null)
    {
        if (objetos == null || objetos.Count == 0) return;
        var resueltos = Resolver(CuentasDe(objetos, campos, conEventos), guardados, personas, fichas);
        AnotarResueltas(objetos, campos, conEventos, resueltos);
    }

    // Las cuentas de esos campos (y de los eventos) de los objetos.
    public static List<string> CuentasDe(IList<Dictionary<string, object>> objetos, string[] campos, bool conEventos)
    {
        var cuentas = new List<string>();
        foreach (var o in objetos ?? new List<Dictionary<string, object>>())
        {
            if (o == null) continue;
            foreach (var c in campos ?? new string[0]) cuentas.Add(Texto(o, c));
            foreach (var e in EventosDe(o, conEventos)) cuentas.Add(Texto(e, "usuario"));
        }
        return cuentas;
    }

    private static List<Dictionary<string, object>> EventosDe(Dictionary<string, object> o, bool conEventos)
    {
        var l = new List<Dictionary<string, object>>();
        object ev;
        if (conEventos && o.TryGetValue("eventos", out ev) && ev is IEnumerable<object>)
            foreach (var e in (IEnumerable<object>)ev) { var d = e as Dictionary<string, object>; if (d != null) l.Add(d); }
        return l;
    }

    private static void AnotarResueltas(IList<Dictionary<string, object>> objetos, string[] campos, bool conEventos,
        Dictionary<string, SolicitanteVisible> resueltos)
    {
        campos = campos ?? new string[0];
        foreach (var o in objetos)
        {
            if (o == null) continue;
            foreach (var c in campos) if (o.ContainsKey(c)) o[c + "_mostrar"] = TextoDe(resueltos, Texto(o, c));
            foreach (var e in EventosDe(o, conEventos)) e["usuario_mostrar"] = TextoDe(resueltos, Texto(e, "usuario"));
        }
    }

    // DETALLE de una solicitud de iniciativa (ADM y Mis solicitudes): quien
    // la envio con la regla de siempre (AgregarIniciativas) y ademas quien
    // la reviso, quien la cancelo y cada evento. Lo guardado al enviar es lo
    // verificado de la cuenta que la envio (asi "Cancelada por" dice lo
    // mismo que "Solicito"); las demas cuentas, CatPersona.
    public static readonly string[] CamposDetalle = { "revisado_por", "cancelado_por" };
    public static void AgregarDetalleIniciativa(Dictionary<string, object> d)
    {
        if (d == null) return;
        var una = new List<Dictionary<string, object>> { d };
        // UNA lectura de UsuariosAdmin para quien la envio y las demas cuentas.
        var cuentas = CuentasDe(una, CamposDetalle, true);
        cuentas.Add(Texto(d, "solicitante_cuenta"));
        var fichas = LeerSinFallar(cuentas);
        Agregar(una, "solicitante_cuenta", f => Texto(f, "solicitante_nombre"), f => Texto(f, "solicitante_correo"), fichas);
        var guardados = new Dictionary<string, Verificado>(StringComparer.Ordinal);
        Guardar(guardados, Texto(d, "solicitante_cuenta"), Texto(d, "solicitante_nombre"), Texto(d, "solicitante_correo"));
        AnotarCuentas(una, CamposDetalle, true, guardados, Personas, fichas);
    }

    // ---- Las demas pantallas de Admin (cada una, UN lote por respuesta) ----

    // Historial de peticiones (solo ADM): solicitante_mostrar por fila con la
    // regla de las listas; lo verificado de la fila es el nombre guardado de
    // la iniciativa o el de CatPersona del cambio (NombrarCambios).
    public static void AgregarHistorialPeticiones(Dictionary<string, object> json)
    {
        Agregar(Filas(json, "peticiones"), "solicitante_cuenta", f => Texto(f, "solicitante_nombre"), f => Texto(f, "solicitante_correo"));
    }

    // Cambios recientes (solo ADM): usuario_mostrar de quien guardo.
    public static readonly string[] CampoUsuario = { "usuario" };
    public static void AgregarCambiosRecientes(Dictionary<string, object> json)
    {
        AnotarCuentas(Filas(json, "cambios"), CampoUsuario, false, null, Personas);
    }

    // Registro de Iniciativas: el "Quien" del historial de fechas de cada
    // iniciativa y de sus categorias (usuario_mostrar), todas en UN lote.
    public static void AgregarRegistro(Dictionary<string, object> registro)
    {
        var filas = new List<Dictionary<string, object>>();
        foreach (var i in Filas(registro, "iniciativas"))
        {
            filas.AddRange(Filas(i, "historial"));
            filas.AddRange(Filas(i, "historial_categorias"));
        }
        AnotarCuentas(filas, CampoUsuario, false, null, Personas);
    }

    private static List<Dictionary<string, object>> Filas(Dictionary<string, object> d, string k)
    {
        var l = new List<Dictionary<string, object>>();
        object v;
        if (d != null && d.TryGetValue(k, out v) && v is IEnumerable<object>)
            foreach (var o in (IEnumerable<object>)v) { var f = o as Dictionary<string, object>; if (f != null) l.Add(f); }
        return l;
    }
}
