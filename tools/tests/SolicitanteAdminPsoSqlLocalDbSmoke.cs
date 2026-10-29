// Prueba de INTEGRACION de los scripts FINALES sql/35, 36 y 37 (y sus
// rollbacks) con App_Code real (DestinatariosSolicitud, IdentidadAcuse,
// AlmacenSolicitudesSql, Revisor / Lector de solicitudes, Almacen y Aplicador
// de solicitudes de cambio), contra una base DESECHABLE de SQL Server
// LocalDB: GestionAdminPrueba_Spso<n> con la replica de dbo, las migraciones
// reales 18, 20-27, 29, 31, 32 y 34, la cuenta del sitio como en la VM
// (PROACTIVANETAD: db_datareader + db_datawriter + EXECUTE sobre adm) y
// dbo.UsuariosAdmin con la forma de la VM. BORRA la base al final. Nunca
// toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   M  orden y negativas: 36 sin 35 y 37 sin 36 se niegan; ya aplicada;
//      rollback de 35 con nombres o con 36 puesta se niega.
//   N  identidad: lo que manda el sitio -> lo que decide la base (S3: el
//      correo CATPERSONA es el de la cuenta).
//   U  S4: un nombre con Unicode invalido en CatPersona no tumba a nadie mas
//      y su propia cuenta no se resuelve.
//   A  aprobar / rechazar solicitudes USUARIOSADMIN (sql/31 + 32).
//   R  rollbacks de 36: completo se niega con filas incompatibles; el de
//      procedimiento vuelve al hash de sql/29 sin perder filas; reaplicar.
//   P  PSO (sql/37): re-chequeo de dueno, 51225/51226/51227, ADM/MOD igual,
//      rollbacks de 37 y deteccion del sitio (CK_SolicitudCambio_RolPso).
//   Q  sql/38: el SO del equipo del PO (fila vigente de CatCategoriaDueno
//      con ese ProductOwner) tambien es PSO; el sitio (Evaluar con el
//      directorio real) decide lo mismo que la base; rollback y deteccion
//      (propiedad ReglaPso, visible para la cuenta del sitio).
//   Z  vuelta completa 37 -> 36 -> 35 y reaplicar 35 -> 36 -> 37.
//
// Necesita ../backend_admin_persistencia (vistas de origen). Compilar con
// adm.dll y hnd.dll (receta en AccesoAdminHttpSmoke.cs) y correr con cwd =
// raiz del repo.
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

public static class SolicitanteAdminPsoSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string H29 = "0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A";
    const string H34 = "0x2F495E310DCB799201BE1A449AAE283AFFE6F8936105547572E7EE21556E389D";
    const string H36 = "0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A";
    const string H37 = "0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642";
    const string H38 = "0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F";
    const string ADM = @"SORIANA\t_adm";
    static readonly DateTime Hoy = new DateTime(2026, 10, 21);
    static readonly string EnAnalisis = "En An" + (char)0xE1 + "lisis";
    static string Base;
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }
    static SqlConnection Abrir(string db) { var cn = new SqlConnection(Servidor + "Database=" + db + ";Pooling=false;"); cn.Open(); return cn; }
    static SqlConnection ComoSitio() { var cn = Abrir(Base); Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';"); return cn; }
    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn) { CommandTimeout = 300 }) c.ExecuteNonQuery(); }
    static void Exec(string sql) { using (var cn = Abrir(Base)) Exec(cn, sql); }
    static string Uno(string sql)
    {
        using (var cn = Abrir(Base)) using (var c = new SqlCommand(sql, cn) { CommandTimeout = 300 })
        {
            var v = c.ExecuteScalar();
            if (v is byte[]) return "0x" + BitConverter.ToString((byte[])v).Replace("-", "");
            return v == null || v == DBNull.Value ? "NULL" : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
        }
    }
    static void Lotes(SqlConnection cn, string sql)
    {
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (lote.Trim().Length > 0) Exec(cn, lote);
    }
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    static string Hash(string proc)
    {
        return Uno("SELECT HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'" + proc + "', N'P')), " +
                   "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))");
    }
    static string Err(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorSolicitudCambio ex) { return ex.Numero.ToString(); }
        catch (ErrorRevisionSolicitudIniciativa ex) { return ex.Numero.ToString(); }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
        catch (ErrorSolicitud ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    // ---- Nueva solicitud: _Crear de sql/36 como la cuenta del sitio ----
    static int ultimoNumero;
    static string Crear(string cuenta, string nombre, string correo, string poCorreo = "jesuscamor@soriana.com", string titulo = "T")
    {
        try
        {
            using (var cn = ComoSitio())
            using (var c = new SqlCommand("adm.usp_SolicitudIniciativa_Crear", cn) { CommandType = CommandType.StoredProcedure })
            {
                Func<string, object> v = s => (object)s ?? DBNull.Value;
                c.Parameters.AddWithValue("@Usuario", v(cuenta)); c.Parameters.AddWithValue("@Token", Guid.NewGuid());
                c.Parameters.AddWithValue("@TipoIniciativa", "PRB"); c.Parameters.AddWithValue("@ProductOwner", "Jesus Campa Morones");
                c.Parameters.AddWithValue("@ServiceOwner", "SO 1"); c.Parameters.AddWithValue("@Categoria", "/A/Cat 1");
                c.Parameters.AddWithValue("@Director", "Dir 1"); c.Parameters.AddWithValue("@Titulo", titulo);
                c.Parameters.AddWithValue("@Descripcion", "D"); c.Parameters.AddWithValue("@Observaciones", "O");
                c.Parameters.AddWithValue("@Volumetria", 100); c.Parameters.Add("@PctDisminucion", SqlDbType.Decimal).Value = 0.0100m;
                c.Parameters["@PctDisminucion"].Precision = 9; c.Parameters["@PctDisminucion"].Scale = 4;
                c.Parameters.AddWithValue("@RcaExtension", "PDF");
                c.Parameters.AddWithValue("@SolicitanteNombre", v(nombre)); c.Parameters.AddWithValue("@SolicitanteCorreo", v(correo));
                c.Parameters.AddWithValue("@ProductOwnerCorreo", v(poCorreo));
                var n = c.Parameters.Add("@NumeroSolicitud", SqlDbType.Int); n.Direction = ParameterDirection.Output;
                c.Parameters.Add("@Nuevo", SqlDbType.Bit).Direction = ParameterDirection.Output;
                c.Parameters.Add("@FechaUtc", SqlDbType.DateTime2).Direction = ParameterDirection.Output;
                var f = c.Parameters.Add("@FuenteSolicitante", SqlDbType.VarChar, 16); f.Direction = ParameterDirection.Output;
                var g = c.Parameters.Add("@NombreGuardado", SqlDbType.NVarChar, 255); g.Direction = ParameterDirection.Output;
                c.ExecuteNonQuery();
                ultimoNumero = (int)n.Value;
                return "ok|" + f.Value + "|" + (g.Value == DBNull.Value ? "NULL" : g.Value) + "|" +
                       Uno("SELECT FuenteCorreos + '|' + ISNULL(SolicitanteNombre, 'NULL') + '|' + SolicitanteCorreo FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n.Value);
            }
        }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    // Lo que manda el SITIO: DestinatariosSolicitud.Resolver real, con el rol
    // y el CorreoUsuario de la tabla. "nombre|correo" (NULL sin nombre) o
    // "SITIO:<motivo>".
    static string Sitio(string cuenta)
    {
        var personas = new FuentePersonasAcuseSql(ComoSitio).Personas();
        var id = IdentidadWindows.Desde(cuenta, true);
        var rol = RolAdmin.Para(id, new RolesLocal(), null);
        var d = DestinatariosSolicitud.Resolver(id, null, personas, null, rol, () => CorreoAdmin.Para(id, new CorreosLocal(), null));
        if (d.SolicitanteCorreo == null) return "SITIO:" + (RolAdmin.EsElevado(rol) ? "sin_correo_usuariosadmin" : d.SolicitanteEstado);
        return (d.SolicitanteNombre ?? "NULL") + "|" + d.SolicitanteCorreo;
    }
    sealed class RolesLocal : IFuenteRolesAdmin
    {
        public IList<string> AccesosDe(string cuenta) { return Col("Acceso", cuenta); }
    }
    sealed class CorreosLocal : IFuenteCorreoAdmin
    {
        public IList<string> CorreosDe(string cuenta) { return Col("CorreoUsuario", cuenta); }
    }
    static IList<string> Col(string col, string cuenta)
    {
        var l = new List<string>();
        using (var cn = ComoSitio())
        using (var c = new SqlCommand("SELECT " + col + " FROM dbo.UsuariosAdmin WHERE UPPER(LTRIM(RTRIM(Usuario))) = UPPER(LTRIM(RTRIM(@c)))", cn))
        {
            c.Parameters.AddWithValue("@c", cuenta);
            using (var r = c.ExecuteReader()) while (r.Read()) l.Add(r.IsDBNull(0) ? null : r.GetString(0));
        }
        return l;
    }
    // Lo que manda el sitio -> lo que decide la base.
    static string SitioYBase(string cuenta)
    {
        var s = Sitio(cuenta);
        if (s.StartsWith("SITIO:")) return s;
        var partes = s.Split('|');
        return Crear(cuenta, partes[0] == "NULL" ? null : partes[0], partes[1]);
    }

    // ---- Solicitar cambios (sql/37) ----
    static string Pre(string s, int n) { return string.Join("|", s.Split('|').Take(n)); }
    static NameValueCollection Form(params string[] kv)
    {
        var f = new NameValueCollection { { "llave", Guid.NewGuid().ToString() }, { "motivo", "m" } };
        for (var i = 0; i < kv.Length; i += 2) f[kv[i]] = kv[i + 1];
        return f;
    }
    static string Cambio(string cuenta, string rol, string folio, string subestado = null)
    {
        var kv = new List<string> { "folio", folio, "tipo", "estado", "estado_nuevo", "Cerrado" };
        if (subestado != null) { kv.Add("subestado_nuevo"); kv.Add(subestado); }
        var p = PeticionSolicitudCambio.DesdeFormulario(Form(kv.ToArray()));
        if (!p.Valida) return "FORM:" + p.Errores[0].Mensaje;
        var alm = new AlmacenSolicitudesCambioSql(ComoSitio);
        try { var r = alm.Enviar(p, cuenta, rol); return "ok|" + Uno("SELECT RolSolicitante + '|' + SolicitadoPor FROM adm.SolicitudCambio WHERE IdSolicitud = " + r.IdSolicitud) + "|" + r.IdSolicitud; }
        catch (ErrorSolicitudCambio ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    static void Preparar()
    {
        Borrar(Base);
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + Base + "]");
        using (var cn = Abrir(Base))
        {
            Lotes(cn, Leer("tools", "tests", "GestionAdminLocalDb_replica.sql"));
            Exec(cn, "CREATE USER [SORIANA_edgarrad] WITHOUT LOGIN; ALTER AUTHORIZATION ON SCHEMA::stg TO [SORIANA_edgarrad];");
            Lotes(cn, Leer("tools", "tests", "usp_CargarExperiencia_174bb51.sql"));
            Lotes(cn, File.ReadAllText(Path.Combine(Backend, "_origen", "vw_ProblemCategoria_38.sql")));
            Lotes(cn, File.ReadAllText(Path.Combine(Backend, "_origen", "vw_ProblemVencido_26.sql")));
            foreach (var m in new[] { "18_gestion_admin_persistencia", "20_gestion_admin_duenos", "21_gestion_admin_agrupacion_acentos", "22_solicitudes_cambio" })
                Lotes(cn, Leer("sql", m + ".sql"));
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            foreach (var m in new[] { "22_solicitudes_cambio_permisos", "23_cambios_recientes", "24_gestion_admin_modificar_duenos_quitar",
                                      "25_solicitudes_cambio_datos", "26_gestion_admin_crear_volumetria", "27_gestion_admin_crear_subestado",
                                      "29_solicitud_iniciativa", "31_solicitud_iniciativa_revision", "32_solicitud_iniciativa_aprobar_crea",
                                      "34_solicitudes_cambio_varios" })
                Lotes(cn, Leer("sql", m + ".sql"));
            Exec(cn, @"
DELETE FROM dbo.CatPersona;
INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES
 (N'Andres Vera Rios', N'andresvr@soriana.com', 1), (N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1),
 (N'Edgar Ramos', N'edgarrad@soriana.com', 1),
 (N'Rep Nombre', N'rep1@soriana.com', 1), (N'REP  NOMBRE', N'rep2@soriana.com', 1),
 (N'Ana Uno', N'compartido@soriana.com', 1), (N'Ana Dos', N'compartido@soriana.com', 1),
 (N'Luc" + "\u00ed" + @"a Pe" + "\u00f1" + @"a', N'  LuciaP@Soriana.com' + NCHAR(9), 1),
 (N'Baja Persona', N'baja@soriana.com', 0),
 (N'Mal' + NCHAR(65535) + N'nombre', N'malnombre@soriana.com', 1);
CREATE TABLE dbo.UsuariosAdmin (Usuario nvarchar(50) NULL, CorreoUsuario nvarchar(50) NULL,
    Acceso nvarchar(3) NOT NULL CONSTRAINT CK_UsuariosAdmin_Acceso CHECK (Acceso IN (N'MOD', N'ADM')) CONSTRAINT DF_UsuariosAdmin_Acceso DEFAULT (N'MOD'));
INSERT dbo.UsuariosAdmin (Usuario, CorreoUsuario, Acceso) VALUES
 (N'SORIANA\t_olgado', N't_olgado@soriana.com', N'MOD'), (N'SORIANA\t_andresvr', N'T_AndresVR@Soriana.com ', N'ADM'),
 (N'SORIANA\edgarrad', N'edgarrad@soriana.com', N'ADM'), (N'SORIANA\rep1', N'rep1@soriana.com', N'ADM'),
 (N'SORIANA\compartido', N'compartido@soriana.com', N'MOD'), (N'SORIANA\jcm', N'jesuscamor@soriana.com', N'ADM'),
 (N'SORIANA\dosnombres', N'dosnombres@soriana.com', N'ADM'), (N'SORIANA\dosnombres', N'dosnombres@soriana.com', N'MOD'),
 (N'SORIANA\mismonombre', N'mismonombre@soriana.com', N'ADM'), (N'SORIANA\mismonombre', N'mismonombre@soriana.com', N'ADM'),
 (N'SORIANA\doscorreos', N'a@soriana.com', N'ADM'), (N'SORIANA\doscorreos', N'b@soriana.com', N'ADM'),
 (N'SORIANA\baja', N'baja@soriana.com', N'MOD');
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, OwnerProblem, OwnerServicio) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'" + EnAnalisis + @"', NULL, N'Andres Vera Rios', N'LUCIA  PENA'),
 (N'PRB 2026-000002', N'Problem', N'Dos', N'" + EnAnalisis + @"', NULL, N'Jesus Campa Morones', N'SO 1'),
 (N'PRB 2026-000003', N'Problem', N'Tres', N'" + EnAnalisis + @"', NULL, N'Rep Nombre', N'Ana Uno'),
 (N'PRB 2026-000005', N'Problem', N'Cinco', N'Cerrado', NULL, NULL, NULL);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/A/Cat 2', N'Problem', N'Problem', 0.1000, 1);");
        }
    }

    // ---- Scripts finales de sql/: "ok" o el mensaje con que se niegan ----
    static string Script(string archivo)
    {
        try { using (var cn = Abrir(Base)) Lotes(cn, Leer("sql", archivo + ".sql")); return "ok"; }
        catch (SqlException ex) { return ex.Message; }
    }
    // adm.fn_ClaveCorreo / fn_ClaveNombre contra IdentidadAcuse en `n`
    // textos al azar (semilla fija): ASCII imprimible con rachas de espacios
    // (el atajo de las funciones) y, con `mezcla`, letras acentuadas, NBSP y
    // tabs (el ciclo). Devuelve cuantas claves difieren.
    static int Difieren(int n, bool mezcla)
    {
        var rnd = new Random(mezcla ? 3637 : 36);
        var alfabeto = "aZ09 .-_@'~" + (mezcla ? "\u00e1\u00c9\u00f1\u00a0\t\u0301" : "");
        var textos = new List<string>();
        for (var i = 0; i < n; i++)
        {
            var sb = new System.Text.StringBuilder();
            var largo = rnd.Next(0, 14);
            for (var k = 0; k < largo; k++)
            {
                var c = alfabeto[rnd.Next(alfabeto.Length)];
                sb.Append(c == ' ' ? new string(' ', rnd.Next(1, 4)) : c.ToString());
            }
            textos.Add(sb.ToString());
        }
        var malos = 0;
        using (var cn = Abrir(Base))
            foreach (var s in textos)
                using (var c = new SqlCommand("SELECT adm.fn_ClaveCorreo(@s), adm.fn_ClaveNombre(@s)", cn))
                {
                    c.Parameters.Add("@s", System.Data.SqlDbType.NVarChar, 4000).Value = s;
                    using (var r = c.ExecuteReader())
                    {
                        r.Read();
                        var correo = r.IsDBNull(0) ? null : r.GetString(0);
                        var nombre = r.IsDBNull(1) ? null : r.GetString(1);
                        if (correo != IdentidadAcuse.ClaveCorreo(s) || nombre != IdentidadAcuse.ClaveNombre(s)) malos++;
                    }
                }
        return malos;
    }
    static string Tiene(string texto, string fragmento) { return texto.Contains(fragmento) ? fragmento : texto; }
    const string S35 = "35_usuarios_admin_nombre_solicitante", S36 = "36_solicitud_iniciativa_solicitante_admin", S37 = "37_solicitudes_cambio_pso",
                 S38 = "38_solicitudes_cambio_pso_equipo";
    static string Detecta38()
    {
        using (var cn = ComoSitio())
        {
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            DeteccionSolicitudesCambio.Revisar(cn);
            var r = (PersistenciaSolicitudesCambio.SolicitaPsoActiva() ? 1 : 0) + "|" + (PersistenciaSolicitudesCambio.SolicitaPsoEquipoActiva() ? 1 : 0);
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            return r;
        }
    }
    // Lo que decide el sitio (SolicitudCambioPso.Evaluar con CatPersona, el
    // directorio de CatCategoriaDueno y los duenos de dbo.Problem leidos como
    // la cuenta del sitio; motivo null = ya paso como PO/SO vigente).
    static string SitioPso(string cuenta, string folio, bool equipo)
    {
        var personas = new FuentePersonasAcuseSql(ComoSitio).Personas();
        DirectorioOrganizacional dir;
        using (var cn = ComoSitio()) dir = DirectorioOrganizacional.Cargar(cn);
        Func<string, string[]> duenos = delegate (string f)
        {
            using (var cn = ComoSitio())
            using (var c = new SqlCommand("SELECT OwnerProblem, OwnerServicio FROM dbo.Problem WHERE Codigo = @f", cn))
            {
                c.Parameters.AddWithValue("@f", f);
                using (var r = c.ExecuteReader())
                    return r.Read() ? new[] { r.IsDBNull(0) ? null : r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1) } : new string[] { null, null };
            }
        };
        var d = SolicitudCambioPso.Evaluar(IdentidadWindows.Desde(cuenta, true), true, null, personas, folio, duenos, equipo ? dir : null);
        return d.Puede ? "puede" : d.Tipo;
    }
    static string Detecta36() { return Uno("EXECUTE AS USER = N'PROACTIVANETAD'; SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear') AND name = N'@FuenteSolicitante'; REVERT;"); }
    static string Detecta37() { return Uno("EXECUTE AS USER = N'PROACTIVANETAD'; SELECT CASE WHEN OBJECT_ID(N'adm.CK_SolicitudCambio_RolPso', N'C') IS NULL THEN 0 ELSE 1 END; REVERT;"); }
    const string Filas = "SELECT CONCAT(COUNT(*), '|', SUM(CASE WHEN FuenteCorreos = 'USUARIOSADMIN' THEN 1 ELSE 0 END), '|', SUM(CASE WHEN SolicitanteNombre IS NULL THEN 1 ELSE 0 END)) FROM adm.SolicitudIniciativa";

    public static int Main(string[] args)
    {
        if (!Directory.Exists(Backend)) { Console.WriteLine("NO CORRIDO: falta " + Backend); return 2; }
        Base = "GestionAdminPrueba_Spso" + DateTime.UtcNow.ToString("HHmmssfff");
        try
        {
            Preparar();
            Check("G0 cadena 18-34 aplicada: _Crear de sql/29 y de sql/34, AprobarYCrear de sql/32", H29 + "|" + H34 + "|1",
                  Hash("adm.usp_SolicitudIniciativa_Crear") + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.objects WHERE name = N'usp_SolicitudIniciativa_AprobarYCrear'"));

            // ---------------- M: orden y negativas de los scripts ----------------
            Check("M1 36 antes que 35: se niega sin tocar nada", "aplica sql/35 antes|" + H29,
                  Tiene(Script(S36), "aplica sql/35 antes") + "|" + Hash("adm.usp_SolicitudIniciativa_Crear"));
            Check("M2 37 antes que 36: se niega sin tocar nada", "aplica sql/36 antes|" + H34 + "|0",
                  Tiene(Script(S37), "aplica sql/36 antes") + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" + Detecta37());
            Check("M2b 38 antes que 37: se niega sin tocar nada", "aplica sql/37 antes|" + H34,
                  Tiene(Script(S38), "aplica sql/37 antes") + "|" + Hash("adm.usp_SolicitudCambio_Crear"));
            Check("M3 35 se aplica; otra vez: ya aplicada", "ok|ya aplicada|1",
                  Script(S35) + "|" + Tiene(Script(S35), "ya aplicada") + "|" +
                  Uno("SELECT COLUMNPROPERTY(OBJECT_ID(N'dbo.UsuariosAdmin'), N'NombreSolicitante', 'AllowsNull')"));
            Check("M4 rollback de 35 sin nombres ni 36: deshace; reaplicar", "ok|NULL|ok",
                  Script(S35 + "_rollback") + "|" + Uno("SELECT COL_LENGTH(N'dbo.UsuariosAdmin', N'NombreSolicitante')") + "|" + Script(S35));
            Exec("UPDATE dbo.UsuariosAdmin SET NombreSolicitante = N'  Andres Vera (externo) ' WHERE Usuario = N'SORIANA\\t_andresvr';" +
                 "UPDATE dbo.UsuariosAdmin SET NombreSolicitante = N'Nombre Uno' WHERE Usuario = N'SORIANA\\dosnombres' AND Acceso = N'ADM';" +
                 "UPDATE dbo.UsuariosAdmin SET NombreSolicitante = N'Nombre Dos' WHERE Usuario = N'SORIANA\\dosnombres' AND Acceso = N'MOD';" +
                 "UPDATE dbo.UsuariosAdmin SET NombreSolicitante = N'Jos" + "\u00e9" + " Ruiz' WHERE Usuario = N'SORIANA\\mismonombre';" +
                 "UPDATE TOP (1) dbo.UsuariosAdmin SET NombreSolicitante = N'JOSE  RUIZ' WHERE Usuario = N'SORIANA\\mismonombre';");
            Check("M5 rollback de 35 con nombres capturados: se niega", "se perderia", Tiene(Script(S35 + "_rollback"), "se perderia"));
            Check("M6 antes de 36 el sitio no la detecta", "0", Detecta36());
            Check("M7 36 se aplica; otra vez: ya aplicada; el sitio la detecta", "ok|ya aplicada|1|" + H36,
                  Script(S36) + "|" + Tiene(Script(S36), "ya aplicada") + "|" + Detecta36() + "|" + Hash("adm.usp_SolicitudIniciativa_Crear"));
            Check("F1 funciones = sitio en 3000 textos ASCII al azar (atajo) y 3000 con acentos, NBSP y tabs (ciclo)", "0|0",
                  Difieren(3000, false) + "|" + Difieren(3000, true));
            Check("M8 rollback de 35 con 36 puesta: se niega (deshaz 36 antes)", "deshaz sql/36 antes", Tiene(Script(S35 + "_rollback"), "deshaz sql/36 antes"));
            Check("M9 CHECK nuevos confiables", "0",
                  Uno("SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND is_not_trusted = 1"));

            // ---------------- N: identidad, sitio (DestinatariosSolicitud real) -> base ----------------
            Check("N1 PO/SO en CatPersona: CATPERSONA con su nombre", "ok|CATPERSONA|Andres Vera Rios|CATPERSONA|Andres Vera Rios|andresvr@soriana.com", SitioYBase(@"SORIANA\andresvr"));
            Check("N2 MOD sin CatPersona ni nombre: USUARIOSADMIN, NULL", "ok|USUARIOSADMIN|NULL|USUARIOSADMIN|NULL|t_olgado@soriana.com", SitioYBase(@"SORIANA\t_olgado"));
            Check("N3 ADM con NombreSolicitante (y CorreoUsuario con mayusculas/espacio): el de UsuariosAdmin",
                  "ok|USUARIOSADMIN|Andres Vera (externo)|USUARIOSADMIN|Andres Vera (externo)|t_andresvr@soriana.com", SitioYBase(@"SORIANA\t_andresvr"));
            Check("N4 ADM que esta en CatPersona: CATPERSONA", "ok|CATPERSONA|Edgar Ramos|CATPERSONA|Edgar Ramos|edgarrad@soriana.com", SitioYBase(@"SORIANA\edgarrad"));
            Check("N5 ADM con nombre REPETIDO en CatPersona: USUARIOSADMIN", "ok|USUARIOSADMIN|NULL|USUARIOSADMIN|NULL|rep1@soriana.com", SitioYBase(@"SORIANA\rep1"));
            Check("N6 MOD con correo en DOS personas: USUARIOSADMIN", "ok|USUARIOSADMIN|NULL|USUARIOSADMIN|NULL|compartido@soriana.com", SitioYBase(@"SORIANA\compartido"));
            Check("N7 PO/SO (sin rol) con nombre repetido: el sitio lo rechaza; la base tambien (51405)", "SITIO:nombre_repetido|51405",
                  SitioYBase(@"SORIANA\rep2") + "|" + Crear(@"SORIANA\rep2", "REP  NOMBRE", "rep2@soriana.com"));
            Check("N8 correo de CatPersona con mayusculas, espacios y TAB: sitio y base igual",
                  "ok|CATPERSONA|Luc\u00eda Pe\u00f1a|CATPERSONA|Luc\u00eda Pe\u00f1a|luciap@soriana.com", SitioYBase(@"SORIANA\luciap"));
            Check("N9 (S3) ADM cuyo CorreoUsuario es de OTRA persona de CatPersona: USUARIOSADMIN, no esa persona",
                  "ok|USUARIOSADMIN|NULL|USUARIOSADMIN|NULL|jesuscamor@soriana.com", SitioYBase(@"SORIANA\jcm"));
            Check("N10 dos NombreSolicitante distintos: 51418", "51418", SitioYBase(@"SORIANA\dosnombres"));
            Check("N11 mismo nombre con otra grafia: NO es conflicto", "ok|USUARIOSADMIN|", SitioYBase(@"SORIANA\mismonombre").Substring(0, 17));
            Check("N12 dos CorreoUsuario: el sitio no elige; la base tampoco (51417)", "SITIO:sin_correo_usuariosadmin|51417",
                  SitioYBase(@"SORIANA\doscorreos") + "|" + Crear(@"SORIANA\doscorreos", null, "a@soriana.com"));
            Check("N13 MOD cuya persona esta dada de baja: USUARIOSADMIN", "ok|USUARIOSADMIN|NULL|USUARIOSADMIN|NULL|baja@soriana.com", SitioYBase(@"SORIANA\baja"));
            Check("N14 cuenta fuera de todo: el sitio rechaza; la base 51405", "SITIO:no_encontrado|51405",
                  SitioYBase(@"SORIANA\nadie") + "|" + Crear(@"SORIANA\nadie", null, "nadie@soriana.com"));
            Check("N15 nombre mandado por el sitio en USUARIOSADMIN: se ignora", "ok|USUARIOSADMIN|NULL|USUARIOSADMIN|NULL|t_olgado@soriana.com",
                  Crear(@"SORIANA\t_olgado", "Inventado", "t_olgado@soriana.com"));
            Check("N16 cuenta ADM con correo ajeno: 51417; sin titulo: 51403; PO inventado: 51406", "51417|51403|51406",
                  Crear(@"SORIANA\t_olgado", null, "t_andresvr@soriana.com") + "|" + Crear(@"SORIANA\t_olgado", null, "t_olgado@soriana.com", titulo: " ") + "|" +
                  Crear(@"SORIANA\t_olgado", null, "t_olgado@soriana.com", poCorreo: "po@evil.com"));
            Check("N17 (S3) PO/SO sin rol que manda correo y nombre de OTRA persona: 51405", "51405",
                  Crear(@"SORIANA\andresvr", "Jesus Campa Morones", "jesuscamor@soriana.com"));
            Check("N18 (S3) ADM en CatPersona que manda correo y nombre de OTRA persona: 51417", "51417",
                  Crear(@"SORIANA\edgarrad", "Andres Vera Rios", "andresvr@soriana.com"));
            Check("N19 (S3) la cuenta con mayusculas y espacios sigue siendo la suya", "ok|CATPERSONA|Andres Vera Rios",
                  Pre(Crear(@"  SORIANA\AndresVR ", "Andres Vera Rios", "andresvr@soriana.com"), 3));
            Check("N20 (S3) cuenta sin dominio: cuenta@soriana.com", "ok|CATPERSONA|Edgar Ramos", Pre(Crear("edgarrad", "Edgar Ramos", "edgarrad@soriana.com"), 3));

            // ---------------- E: el sitio con sql/36 (AlmacenSolicitudesSql) ----------------
            var almI = new AlmacenSolicitudesSql(ComoSitio);
            Func<string, string, AltaSolicitud> alta = (cuenta, correo) => new AltaSolicitud { Cuenta = cuenta, Token = Guid.NewGuid(),
                Tipo = "PRB", Po = "Jesus Campa Morones", So = "SO 1", Categoria = "/A/Cat 1", Director = "D", Titulo = "E", Descripcion = "D",
                Observaciones = "O", Volumetria = 1, Pct = 0.01m, SolicitanteCorreo = correo, ProductOwnerCorreo = "jesuscamor@soriana.com", ConFuente = true };
            Check("E1 el sitio detecta sql/36 (AceptaSolicitanteAdmin)", "True", almI.AceptaSolicitanteAdmin().ToString());
            SolicitudGuardada gE = null;
            Check("E2 Crear con ConFuente devuelve lo GUARDADO: USUARIOSADMIN con el nombre de UsuariosAdmin", "sin error|USUARIOSADMIN|Andres Vera (externo)",
                  Err(() => gE = almI.Crear(alta(@"SORIANA\t_andresvr", "t_andresvr@soriana.com"))) + "|" + (gE == null ? "" : gE.Fuente) + "|" + (gE == null ? "" : gE.NombreGuardado));
            Check("E3 51418 llega al sitio como ErrorSolicitud", "51418", Err(() => almI.Crear(alta(@"SORIANA\dosnombres", "dosnombres@soriana.com"))));

            // ---------------- U: S4, nombre con Unicode invalido en CatPersona ----------------
            Check("U1 ClaveNombre con no-caracter U+FFFF: null, sin excepcion", "NULL|False",
                  (IdentidadAcuse.ClaveNombre("Mal\uFFFFnombre") ?? "NULL") + "|" +
                  IdentidadAcuse.Resolver(IdentidadWindows.Desde(@"SORIANA\andresvr", true), new FuentePersonasAcuseSql(ComoSitio).Personas()).EsDueno("Mal\uFFFFnombre"));
            Check("U2 la fila mala NO tumba a los demas (N1-N20 corrieron con ella) ni repite nombres", "Andres Vera Rios|andresvr@soriana.com",
                  Sitio(@"SORIANA\andresvr"));
            Check("U3 la cuenta de la fila mala no se resuelve (fail closed): sitio no_encontrado", "SITIO:no_encontrado", Sitio(@"SORIANA\malnombre"));
            var rPo = new ValidadorIniciativa.Resultado();
            DestinatariosSolicitud.Resolver(IdentidadWindows.Desde(@"SORIANA\andresvr", true), "Mal\uFFFFnombre",
                                            new FuentePersonasAcuseSql(ComoSitio).Personas(), rPo);
            Check("U4 PO con Unicode invalido: error en po, no excepcion", "True", rPo.TieneError(SolicitudIniciativa.CPo).ToString());

            // ---------------- A: aprobar / rechazar (sql/31 + 32) ----------------
            var revisor = new RevisorSolicitudesIniciativaSql(ComoSitio);
            var lector = new LectorSolicitudesIniciativaSql(ComoSitio);
            Crear(@"SORIANA\t_olgado", null, "t_olgado@soriana.com", titulo: "MOD sin nombre"); var sinNombre = ultimoNumero;
            Crear(@"SORIANA\t_andresvr", null, "t_andresvr@soriana.com", titulo: "ADM con nombre"); var conNombre = ultimoNumero;
            Crear(@"SORIANA\t_olgado", null, "t_olgado@soriana.com", titulo: "Para rechazar"); var aRechazar = ultimoNumero;
            Func<int, PlanCrearAdmin> plan = n => PlanificadorGestionAdmin.Crear(AprobacionIniciativa.Peticion(lector.Detalle(n), EnAnalisis),
                                                                                 new ResultadoGestionAdmin { Accion = "crear", CatalogoRevisado = true }, Hoy);
            AprobacionConIniciativa a1 = null, a2 = null;
            Check("A1 aprobar USUARIOSADMIN sin nombre: crea la iniciativa", "sin error", Err(() => a1 = revisor.AprobarYCrear(sinNombre, ADM, "ok", plan(sinNombre))));
            Check("A2 aprobar USUARIOSADMIN con nombre: crea la iniciativa", "sin error", Err(() => a2 = revisor.AprobarYCrear(conNombre, ADM, null, plan(conNombre))));
            Check("A3 las dos APROBADAS con su Codigo; iniciativas en dbo.Problem", "APROBADA|APROBADA|1|1",
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + sinNombre) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + conNombre) + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'" + (a1 == null ? "" : a1.Codigo) + "'") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'" + (a2 == null ? "" : a2.Codigo) + "'"));
            Check("A4 rechazar USUARIOSADMIN", "sin error|RECHAZADA", Err(() => revisor.Rechazar(aRechazar, ADM, "No procede")) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + aRechazar));
            var fila = lector.Listar(200).Solicitudes.Single(s => (int)s["numero"] == sinNombre);
            Check("A5 el registro: sin nombre, con cuenta y correo; Mis solicitudes de la cuenta", @"|SORIANA\t_olgado|t_olgado@soriana.com|True",
                  fila["solicitante_nombre"] + "|" + fila["solicitante_cuenta"] + "|" + fila["solicitante_correo"] + "|" +
                  (lector.ListarDe(@"SORIANA\t_olgado", 200).Total >= 3));

            // ---------------- R: rollbacks de 36 ----------------
            var filas = Uno(Filas);
            Check("R1 rollback COMPLETO de 36 con filas USUARIOSADMIN / sin nombre: se niega sin tocar nada", "no caben|" + H36 + "|" + filas,
                  Tiene(Script(S36 + "_rollback"), "no caben") + "|" + Hash("adm.usp_SolicitudIniciativa_Crear") + "|" + Uno(Filas));
            Check("R2 rollback de PROCEDIMIENTO de 36: hash de sql/29; mismas filas; el sitio deja de detectarla",
                  "ok|" + H29 + "|" + filas + "|0", Script(S36 + "_rollback_procedimiento") + "|" + Hash("adm.usp_SolicitudIniciativa_Crear") + "|" + Uno(Filas) + "|" + Detecta36());
            Check("E4 tras el rollback de procedimiento el sitio deja de detectar 36", "False", almI.AceptaSolicitanteAdmin().ToString());
            Check("R3 otra vez: ya es la de sql/29", "ya es la de sql/29", Tiene(Script(S36 + "_rollback_procedimiento"), "ya es la de sql/29"));
            Check("R4 tras el rollback de procedimiento: PO/SO sigue guardando con el _Crear de sql/29",
                  "sin error", Err(() => new AlmacenSolicitudesSql(ComoSitio).Crear(new AltaSolicitud { Cuenta = @"SORIANA\andresvr", Token = Guid.NewGuid(),
                      Tipo = "PRB", Po = "Jesus Campa Morones", So = "SO 1", Categoria = "/A/Cat 1", Director = "D", Titulo = "Post", Descripcion = "D",
                      Observaciones = "O", Volumetria = 1, Pct = 0.01m, SolicitanteNombre = "Andres Vera Rios", SolicitanteCorreo = "andresvr@soriana.com",
                      ProductOwnerCorreo = "jesuscamor@soriana.com" })));
            Check("R5 la USUARIOSADMIN aprobada sigue legible", "APROBADA|NULL",
                  Uno("SELECT Estado + '|' + ISNULL(SolicitanteNombre, 'NULL') FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + sinNombre));
            Check("R6 reaplicar 36 sobre la tabla ya cambiada", "ok|" + H36 + "|1", Script(S36) + "|" + Hash("adm.usp_SolicitudIniciativa_Crear") + "|" + Detecta36());

            // ---------------- P: Solicitar cambios para PO/SO (sql/37) ----------------
            Check("P0 antes de 37: PSO rechazado por la base (51210); el sitio no la detecta", "51210|0", Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000001") + "|" + Detecta37());
            Check("P0b 37 se aplica; otra vez: ya aplicada; el sitio la detecta", "ok|ya aplicada|1|" + H37,
                  Script(S37) + "|" + Tiene(Script(S37), "ya aplicada") + "|" + Detecta37() + "|" + Hash("adm.usp_SolicitudCambio_Crear"));
            Check("P1 PO de la iniciativa: guarda como PSO", "ok|PSO", Pre(Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000001"), 2));
            Check("P2 SO de la iniciativa (nombre con otra grafia: 'LUCIA  PENA'): guarda", "ok|PSO", Pre(Cambio(@"SORIANA\luciap", "PSO", "PRB 2026-000001"), 2));
            Check("P3 PO/SO de OTRA iniciativa (rol PSO forzado): 51226", "51226", Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000002"));
            Check("P4 nombre repetido en CatPersona: 51226", "51226", Cambio(@"SORIANA\rep1", "PSO", "PRB 2026-000003"));
            Check("P5 correo en dos personas: 51226", "51226", Cambio(@"SORIANA\compartido", "PSO", "PRB 2026-000003"));
            Check("P6 cuenta inexistente / dada de baja / nombre invalido: 51226", "51226|51226|51226", Cambio(@"SORIANA\nadie", "PSO", "PRB 2026-000001") + "|" +
                  Cambio(@"SORIANA\baja", "PSO", "PRB 2026-000001") + "|" + Cambio(@"SORIANA\malnombre", "PSO", "PRB 2026-000001"));
            Check("P7 PSO pidiendo Subestado: 51227", "51227", Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000001", subestado: "X"));
            Check("P8 folio inexistente: 51006 (como siempre)", "51006", Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000099"));
            Check("P9 rol inventado: 51210; ADM y MOD siguen igual", "51210|ok|ADM|ok|MOD",
                  Cambio(@"SORIANA\andresvr", "XYZ", "PRB 2026-000001") + "|" + Pre(Cambio(ADM, "ADM", "PRB 2026-000002"), 2) + "|" +
                  Pre(Cambio(@"SORIANA\t_olgado", "MOD", "PRB 2026-000002"), 2));
            var pso = Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000001");
            var idPso = int.Parse(pso.Split('|').Last());
            var alm = new AlmacenSolicitudesCambioSql(ComoSitio);
            Check("P10 ADM aplica la de PSO (Aplicar sin cambios)", "sin error|APLICADA",
                  Err(() => new AplicadorSolicitudCambio(alm, delegate { return new ValidacionAplicar { Valida = true }; }).Aplicar(idPso, ADM, null, null, Hoy)) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + idPso));
            Check("P11 CHECK: otro RolSolicitante, aun como dbo: 547", "547",
                  Err(() => Exec("UPDATE adm.SolicitudCambio SET RolSolicitante = 'XYZ' WHERE IdSolicitud = " + idPso)));
            Check("P12 la cuenta del sitio no escribe la tabla a mano (DENY)", "229",
                  Err(() => { using (var cn = ComoSitio()) Exec(cn, "UPDATE adm.SolicitudCambio SET RolSolicitante = 'ADM' WHERE IdSolicitud = " + idPso); }));
            Check("P13 rollback COMPLETO de 36 con 37 puesta: se niega (deshaz 37 antes)", "deshaz sql/37 antes", Tiene(Script(S36 + "_rollback"), "deshaz sql/37 antes"));
            var nPso = Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE RolSolicitante = 'PSO'");
            Check("P14 rollback de PROCEDIMIENTO de 37: hash de sql/34; PSO se quedan; PSO -> 51210; el sitio deja de detectarla",
                  "ok|" + H34 + "|" + nPso + "|51210|0", Script(S37 + "_rollback_procedimiento") + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE RolSolicitante = 'PSO'") + "|" + Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000001") + "|" + Detecta37());
            Check("P15 rollback COMPLETO de 37 con filas PSO: se niega sin tocar nada", "no caben|" + H34,
                  Tiene(Script(S37 + "_rollback"), "no caben") + "|" + Hash("adm.usp_SolicitudCambio_Crear"));
            Check("P16 reaplicar 37 tras el rollback de procedimiento", "ok|" + H37 + "|1", Script(S37) + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" + Detecta37());

            // ---------------- Q: sql/38, el SO del equipo del PO ----------------
            // PRB-000002: PO 'Jesus Campa Morones' / SO 'SO 1'. Lucia es SO de
            // Jesus en otra categoria; Andres, con el PO escrito en mayusculas;
            // Edgar solo en una fila NO vigente; una fila sin PO.
            Exec(@"INSERT dbo.CatCategoriaDueno (CategoriaN2, ProductOwner, ServiceOwner, DirectorPO, C1, VigenteEnOrigen) VALUES
 (N'/Q/Equipo', N'Jesus Campa Morones', N'Luc" + "\u00ed" + @"a Pe" + "\u00f1" + @"a', N'Dir', N'/Q', 1),
 (N'/Q/Mayus', N'JESUS  CAMPA MORONES', N'Andres Vera Rios', N'Dir', N'/Q', 1),
 (N'/Q/Baja', N'Rep Nombre', N'Edgar Ramos', N'Dir', N'/Q', 0),
 (N'/Q/SinPo', NULL, N'Edgar Ramos', N'Dir', N'/Q', 1);");
            Check("Q0 con 37 (sin 38): el SO del equipo -> 51226; el sitio ve 37 y no 38", "51226|1|0",
                  Cambio(@"SORIANA\luciap", "PSO", "PRB 2026-000002") + "|" + Detecta38());
            Check("Q1 38 se aplica; otra vez: ya aplicada; el sitio la detecta", "ok|ya aplicada|" + H38 + "|1|1",
                  Script(S38) + "|" + Tiene(Script(S38), "ya aplicada") + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" + Detecta38());
            Check("Q2 SO del equipo del PO (otra categoria): guarda como PSO", "ok|PSO", Pre(Cambio(@"SORIANA\luciap", "PSO", "PRB 2026-000002"), 2));
            Check("Q3 el PO de su fila escrito distinto (mayusculas, espacios): guarda", "ok|PSO", Pre(Cambio(@"SORIANA\andresvr", "PSO", "PRB 2026-000002"), 2));
            Check("Q4 SO solo en fila NO vigente del PO: 51226", "51226", Cambio(@"SORIANA\edgarrad", "PSO", "PRB 2026-000003"));
            Check("Q5 iniciativa sin PO; SO de una fila sin PO: 51226", "51226", Cambio(@"SORIANA\edgarrad", "PSO", "PRB 2026-000005"));
            // PRB-000001 ya quedo Cerrado (P10): 51219 = paso el re-chequeo de dueno.
            Check("Q6 lo de 37 sigue: dueno capturado pasa (51219, ya Cerrado); nombre repetido y correo en dos personas 51226; Subestado 51227", "51219|51226|51226|51227",
                  Cambio(@"SORIANA\luciap", "PSO", "PRB 2026-000001") + "|" + Cambio(@"SORIANA\rep1", "PSO", "PRB 2026-000003") + "|" +
                  Cambio(@"SORIANA\compartido", "PSO", "PRB 2026-000003") + "|" + Cambio(@"SORIANA\luciap", "PSO", "PRB 2026-000002", subestado: "X"));
            {
                // El sitio decide lo mismo que la base en cada par cuenta x folio.
                var cuentas = new[] { @"SORIANA\andresvr", @"SORIANA\luciap", @"SORIANA\edgarrad", @"SORIANA\jcm", @"SORIANA\rep1", @"SORIANA\compartido", @"SORIANA\nadie" };
                var folios = new[] { "PRB 2026-000001", "PRB 2026-000002", "PRB 2026-000003", "PRB 2026-000005" };
                var distintos = new List<string>();
                foreach (var c in cuentas)
                    foreach (var f in folios)
                    {
                        var sitio = SitioPso(c, f, true) == "puede";
                        var b = Cambio(c, "PSO", f);
                        var bOk = b.StartsWith("ok") || b == "51219";
                        if (sitio != bOk) distintos.Add(c + " " + f + " sitio=" + sitio + " base=" + b);
                    }
                Check("Q7 sitio (Evaluar con el directorio real) = base en 7 cuentas x 4 folios", "", string.Join("; ", distintos));
                Check("Q7b sin el equipo el sitio vuelve a la regla de 37", "NoEsDueno|puede",
                      SitioPso(@"SORIANA\luciap", "PRB 2026-000002", false) + "|" + SitioPso(@"SORIANA\luciap", "PRB 2026-000002", true));
            }
            var nPso38 = Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE RolSolicitante = 'PSO'");
            Check("Q8 rollback de 38: Crear de sql/37, sin propiedad, filas PSO intactas, el SO del equipo -> 51226; el sitio ve 37 y no 38",
                  "ok|" + H37 + "|" + nPso38 + "|51226|1|0",
                  Script(S38 + "_rollback") + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE RolSolicitante = 'PSO'") + "|" + Cambio(@"SORIANA\luciap", "PSO", "PRB 2026-000002") + "|" + Detecta38());
            Check("Q9 rollback de 38 otra vez: no esta aplicada", "no esta aplicada|" + H37, Tiene(Script(S38 + "_rollback"), "no esta aplicada") + "|" + Hash("adm.usp_SolicitudCambio_Crear"));
            Check("Q10 reaplicar 38 y deshacerla (Z parte de 37)", "ok|" + H38 + "|ok|" + H37,
                  Script(S38) + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" + Script(S38 + "_rollback") + "|" + Hash("adm.usp_SolicitudCambio_Crear"));

            // ---------------- Z: vuelta completa sin filas incompatibles ----------------
            Exec("UPDATE adm.SolicitudCambio SET RolSolicitante = 'ADM' WHERE RolSolicitante = 'PSO';" +
                 "UPDATE adm.SolicitudIniciativa SET FuenteCorreos = 'CATPERSONA', SolicitanteNombre = ISNULL(SolicitanteNombre, N'x') WHERE FuenteCorreos = 'USUARIOSADMIN' OR SolicitanteNombre IS NULL;" +
                 "UPDATE dbo.UsuariosAdmin SET NombreSolicitante = NULL;");
            Check("Z1 rollback completo de 37: Crear de sql/34 y CHECK viejo (PSO -> 547)", "ok|" + H34 + "|0|547",
                  Script(S37 + "_rollback") + "|" + Hash("adm.usp_SolicitudCambio_Crear") + "|" + Detecta37() + "|" +
                  Err(() => Exec("UPDATE TOP (1) adm.SolicitudCambio SET RolSolicitante = 'PSO'")));
            Check("Z2 rollback completo de 36: _Crear de sql/29, NOT NULL, sin funciones", "ok|" + H29 + "|0|0",
                  Script(S36 + "_rollback") + "|" + Hash("adm.usp_SolicitudIniciativa_Crear") + "|" +
                  Uno("SELECT COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull')") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.objects WHERE schema_id = SCHEMA_ID(N'adm') AND name IN (N'fn_ClaveCorreo', N'fn_ClaveNombre')"));
            Check("Z3 rollback de 35: sin columna", "ok|NULL", Script(S35 + "_rollback") + "|" + Uno("SELECT COL_LENGTH(N'dbo.UsuariosAdmin', N'NombreSolicitante')"));
            Check("Z4 reaplicar 35 -> 36 -> 37", "ok|ok|ok|" + H36 + "|" + H37,
                  Script(S35) + "|" + Script(S36) + "|" + Script(S37) + "|" + Hash("adm.usp_SolicitudIniciativa_Crear") + "|" + Hash("adm.usp_SolicitudCambio_Crear"));
        }
        catch (Exception ex) { fallos++; Console.WriteLine("FAIL  excepcion: " + ex); }
        finally { try { Borrar(Base); } catch (Exception ex) { Console.WriteLine("aviso: " + ex.Message); } }
        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos + " (pasaron " + pasados + ")");
        return fallos == 0 ? 0 : 1;
    }
}
