// Prueba de INTEGRACION de sql/35_solicitud_iniciativa_solicitante_admin.sql
// (+ _rollback) con App_Code/SolicitudIniciativaAlta.cs (AlmacenSolicitudesSql),
// IniciativaService y CorreoAdmin, contra una base REAL pero DESECHABLE de
// SQL Server LocalDB: crea GestionAdminPrueba_Adm<n> con la replica de dbo
// (tools/tests/GestionAdminLocalDb_replica.sql), sql/29 y sql/31, la cuenta
// del sitio como en la VM (db_datareader + db_datawriter + EXECUTE sobre
// adm) y dbo.UsuariosAdmin con la forma de la VM (Usuario nvarchar(50) NULL,
// CorreoUsuario nvarchar(50) NULL, Acceso nvarchar(3) NOT NULL CHECK MOD|ADM;
// diag del usuario 2026-10-05). Corre los casos y BORRA la base al final.
// Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: sin aprobar se niega; sin sql/29 o sin UsuariosAdmin se
//      niega; antes de 35 el sitio no la detecta y sin nombre es 51403;
//      aplicada (con sql/31 ya puesta): hash, columna, CHECK; reaplicar no
//      toca nada.
//   A  crear como la cuenta del sitio: ADM / MOD de UsuariosAdmin sin
//      CatPersona guardan (sin nombre, USUARIOSADMIN); cuenta fuera de
//      UsuariosAdmin, correo que no es el suyo, dos correos o ninguno: 51417
//      sin avanzar el contador; con nombre la regla de CatPersona de sql/29
//      (51405) aunque el correo este en UsuariosAdmin; 51403 / 51406 siguen;
//      CHECK de fuente y nombre; DENY de la cuenta del sitio.
//   E  de punta a punta: IniciativaService + CorreoAdmin.Para con la tabla
//      real; el registro de Nuevas lo lee (sin nombre, con la cuenta).
//   B  rollback: se niega con solicitudes USUARIOSADMIN; sin ellas deshace
//      al hash de sql/29; reaplicar.
//
// Compilar como SolicitudIniciativaSqlLocalDbSmoke (adm.dll) y correr con
// cwd = raiz del repo.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

// CorreoAdmin con la MISMA consulta que FuenteCorreoAdminSql, contra la base
// desechable (la real usa la cadena del sitio).
sealed class FuenteCorreoAdminLocal : IFuenteCorreoAdmin
{
    readonly Func<SqlConnection> abrir;
    public FuenteCorreoAdminLocal(Func<SqlConnection> abrir) { this.abrir = abrir; }
    public IList<string> CorreosDe(string cuenta)
    {
        var salida = new List<string>();
        using (var cn = abrir())
        using (var cmd = new SqlCommand("SELECT CorreoUsuario FROM dbo.UsuariosAdmin WHERE UPPER(LTRIM(RTRIM(Usuario))) = UPPER(LTRIM(RTRIM(@cuenta)));", cn))
        {
            cmd.Parameters.AddWithValue("@cuenta", cuenta ?? string.Empty);
            using (var r = cmd.ExecuteReader())
                while (r.Read()) salida.Add(r.IsDBNull(0) ? null : r.GetString(0));
        }
        return salida;
    }
}

public static class SolicitanteAdminSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string H29 = "0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A";
    const string H35 = "0x307A180FFC5DFD95356CF6A9F2B8868A33BE52892037819091D133B47BF1243F";
    static string Base;
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection(Servidor + "Database=" + db + ";Pooling=false;");
        cn.Open();
        return cn;
    }
    static SqlConnection ComoSitio()
    {
        var cn = Abrir(Base);
        Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
        return cn;
    }
    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 }) c.ExecuteNonQuery(); }
    static void Exec(string sql) { using (var cn = Abrir(Base)) Exec(cn, sql); }
    static string Uno(string sql)
    {
        using (var cn = Abrir(Base)) using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 })
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
    static string LotesError(SqlConnection cn, string sql)
    {
        try { Lotes(cn, sql); return "sin error"; }
        catch (SqlException ex) { return ex.Number + ":" + ex.Message; }
        finally { Exec(cn, "SET NOEXEC OFF; IF @@TRANCOUNT > 0 ROLLBACK;"); }
    }
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorSolicitud ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }
    static int Cuenta(string tabla) { return int.Parse(Uno("SELECT COUNT(*) FROM " + tabla)); }
    static string Ultimo() { return Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"); }
    static string HashCrear()
    {
        return Uno("SELECT HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), " +
                   "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))");
    }

    static AlmacenSolicitudesSql Sitio() { return new AlmacenSolicitudesSql(ComoSitio); }

    // nombre null = el camino ADM/MOD de UsuariosAdmin.
    static AltaSolicitud Alta(string cuenta, string nombre, string solCorreo, string poCorreo = "jesuscamor@soriana.com")
    {
        return new AltaSolicitud
        {
            Cuenta = cuenta, Token = Guid.NewGuid(), Tipo = "ADO", Po = "Jesus Campa Morones", So = "Edgar Ramos Davalos",
            Categoria = "/A/Cat 1", Director = "Dir 1", Titulo = "T", Descripcion = "D", Observaciones = "O",
            Volumetria = 120, Pct = 0.2000m, RcaExtension = null,
            SolicitanteNombre = nombre, SolicitanteCorreo = solCorreo, ProductOwnerCorreo = poCorreo,
        };
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_Adm" + Environment.TickCount.ToString().Replace("-", "");
        var guarda = "SolicitanteGuarda" + Environment.TickCount.ToString().Replace("-", "");
        var sql35 = Leer("sql", "35_solicitud_iniciativa_solicitante_admin.sql");
        var rb35 = Leer("sql", "35_solicitud_iniciativa_solicitante_admin_rollback.sql");
        try
        {
            Borrar(Base);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + Base + "]");
            using (var cn = Abrir(Base))
            {
                Lotes(cn, Leer("tools", "tests", "GestionAdminLocalDb_replica.sql"));
                Exec(cn, "IF SCHEMA_ID(N'adm') IS NULL EXEC (N'CREATE SCHEMA adm');");
                Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD];");
                Exec(cn, "DELETE FROM dbo.CatPersona;" +
                         "INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES " +
                         "(N'Andres Vera Rios', N'andresvr@soriana.com', 1)," +
                         "(N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1);");
            }

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql35).Contains("SIN APROBAR") + "|" + LotesError(g, rb35).Contains("SIN APROBAR"));
            Borrar(guarda);
            using (var cn = Abrir(Base))
                Check("G2 sin sql/29: se niega", true, LotesError(cn, sql35).Contains("falta sql/29"));
            using (var cn = Abrir(Base))
            {
                Lotes(cn, Leer("sql", "29_solicitud_iniciativa.sql"));
                Lotes(cn, Leer("sql", "31_solicitud_iniciativa_revision.sql"));
            }
            using (var cn = Abrir(Base))
                Check("G3 sin dbo.UsuariosAdmin: se niega sin tocar nada", "True|" + H29,
                      LotesError(cn, sql35).Contains("falta dbo.UsuariosAdmin") + "|" + HashCrear());
            Exec("CREATE TABLE dbo.UsuariosAdmin (Usuario nvarchar(50) NULL, CorreoUsuario nvarchar(50) NULL, " +
                 "Acceso nvarchar(3) NOT NULL CONSTRAINT CK_UsuariosAdmin_Acceso CHECK (Acceso IN (N'MOD', N'ADM')) CONSTRAINT DF_UsuariosAdmin_Acceso DEFAULT (N'MOD'));" +
                 "INSERT dbo.UsuariosAdmin (Usuario, CorreoUsuario, Acceso) VALUES " +
                 "(N'SORIANA\\t_olgado', N't_olgado@soriana.com', N'MOD')," +
                 "(N' SORIANA\\T_AndresVR ', N' T_AndresVR@Soriana.com ', N'ADM')," +
                 "(N'SORIANA\\mixto', N'mixto@soriana.com', N'ADM')," +
                 "(N'SORIANA\\mixto', N'MIXTO@soriana.com', N'MOD')," +
                 "(N'SORIANA\\doscorreos', N'uno@soriana.com', N'ADM')," +
                 "(N'SORIANA\\doscorreos', N'dos@soriana.com', N'ADM')," +
                 "(N'SORIANA\\sincorreo', NULL, N'MOD')," +
                 "(N'SORIANA\\vacio', N'  ', N'MOD');");
            Check("G4 antes de 35: el sitio NO la detecta; sin nombre = 51403 de sql/29", "False|51403|0",
                  Sitio().AceptaSolicitanteAdmin() + "|" + Error(() => Sitio().Crear(Alta(@"SORIANA\t_olgado", null, "t_olgado@soriana.com"))) + "|" + Ultimo());
            using (var cn = Abrir(Base))
                Check("G5 rollback antes de aplicar: se niega", true, LotesError(cn, rb35).Contains("no esta aplicada"));
            using (var cn = Abrir(Base)) Lotes(cn, sql35);
            Check("G6 aplicada (con sql/31 puesta): hash de 35, nombre opcional, 2 CHECK confiables, 9 DENY intactos",
                  H35 + "|1|2|9",
                  HashCrear() + "|" + Uno("SELECT COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull')") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') " +
                      "AND name IN (N'CK_SolicitudIniciativa_Fuente', N'CK_SolicitudIniciativa_FuenteNombre') AND is_disabled = 0 AND is_not_trusted = 0") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND state = 'D' " +
                      "AND major_id IN (OBJECT_ID('adm.SolicitudIniciativaContador'), OBJECT_ID('adm.SolicitudIniciativa'), OBJECT_ID('adm.SolicitudIniciativaEvento'))"));
            Check("G7 el sitio la detecta (como la cuenta del sitio)", true, Sitio().AceptaSolicitanteAdmin());
            using (var cn = Abrir(Base))
                Check("G8 volver a aplicar: 'ya aplicada', no toca nada", "True|" + H35, LotesError(cn, sql35).Contains("ya aplicada") + "|" + HashCrear());

            // ---------------- A: crear como la cuenta del sitio ----------------
            var r1 = Sitio().Crear(Alta(@"SORIANA\t_olgado", null, "t_olgado@soriana.com"));
            Check("A1 MOD de UsuariosAdmin sin CatPersona: guarda #0000001 sin nombre, USUARIOSADMIN, evento por su cuenta",
                  @"#0000001|True|SORIANA\t_olgado|NULL|t_olgado@soriana.com|USUARIOSADMIN|jesuscamor@soriana.com|SORIANA\t_olgado",
                  r1.Numero + "|" + r1.Nuevo + "|" + Uno("SELECT SolicitanteCuenta FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1") + "|" +
                  Uno("SELECT SolicitanteNombre FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1") + "|" +
                  Uno("SELECT SolicitanteCorreo + '|' + FuenteCorreos + '|' + ProductOwnerCorreo FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1") + "|" +
                  Uno("SELECT Usuario FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = 1"));
            var r2 = Sitio().Crear(Alta(@"soriana\t_andresvr", null, "t_andresvr@soriana.com"));
            var r3 = Sitio().Crear(Alta(@"SORIANA\mixto", null, "mixto@soriana.com"));
            Check("A2 ADM (cuenta y correo con otra grafia/espacios en la tabla) y ADM+MOD: guardan", "#0000002|#0000003|USUARIOSADMIN|USUARIOSADMIN",
                  r2.Numero + "|" + r3.Numero + "|" + Uno("SELECT FuenteCorreos FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 2") + "|" +
                  Uno("SELECT FuenteCorreos FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 3"));
            Check("A3 cuenta que NO esta en UsuariosAdmin (aunque su correo exista ahi): 51417, contador sin avanzar", "51417|51417|3",
                  Error(() => Sitio().Crear(Alta(@"SORIANA\nadie", null, "nadie@soriana.com"))) + "|" +
                  Error(() => Sitio().Crear(Alta(@"SORIANA\nadie", null, "t_olgado@soriana.com"))) + "|" + Ultimo());
            Check("A4 cuenta ADM/MOD con un correo que no es su CorreoUsuario (otro de la tabla o de CatPersona): 51417", "51417|51417|3",
                  Error(() => Sitio().Crear(Alta(@"SORIANA\t_olgado", null, "t_andresvr@soriana.com"))) + "|" +
                  Error(() => Sitio().Crear(Alta(@"SORIANA\t_olgado", null, "andresvr@soriana.com"))) + "|" + Ultimo());
            Check("A5 dos CorreoUsuario distintos / ninguno / vacio: 51417", "51417|51417|51417|3",
                  Error(() => Sitio().Crear(Alta(@"SORIANA\doscorreos", null, "uno@soriana.com"))) + "|" +
                  Error(() => Sitio().Crear(Alta(@"SORIANA\sincorreo", null, "sincorreo@soriana.com"))) + "|" +
                  Error(() => Sitio().Crear(Alta(@"SORIANA\vacio", null, "vacio@soriana.com"))) + "|" + Ultimo());
            var r6 = Sitio().Crear(Alta(@"SORIANA\andresvr", "Andres Vera Rios", "andresvr@soriana.com"));
            Check("A6 CON nombre (PO/SO o quien esta en CatPersona): regla de sql/29 sin cambios", "#0000004|CATPERSONA|Andres Vera Rios",
                  r6.Numero + "|" + Uno("SELECT FuenteCorreos + '|' + SolicitanteNombre FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 4"));
            Check("A6 con nombre y un correo que solo esta en UsuariosAdmin: 51405 (UsuariosAdmin no abre el camino de CatPersona)", "51405|4",
                  Error(() => Sitio().Crear(Alta(@"SORIANA\t_olgado", "Olga Inventada", "t_olgado@soriana.com"))) + "|" + Ultimo());
            var sinTitulo = Alta(@"SORIANA\t_olgado", null, "t_olgado@soriana.com"); sinTitulo.Titulo = " ";
            Check("A7 sin nombre siguen 51403 (titulo), 51406 (PO inventado), 51401 (sin usuario)", "51403|51406|51401|4",
                  Error(() => Sitio().Crear(sinTitulo)) + "|" +
                  Error(() => Sitio().Crear(Alta(@"SORIANA\t_olgado", null, "t_olgado@soriana.com", "po@evil.com"))) + "|" +
                  Error(() => Sitio().Crear(Alta(" ", null, "t_olgado@soriana.com"))) + "|" + Ultimo());
            var tk = Guid.NewGuid();
            var conToken = Alta(@"SORIANA\t_olgado", null, "t_olgado@soriana.com"); conToken.Token = tk;
            var ajeno = Alta(@"SORIANA\mixto", null, "mixto@soriana.com"); ajeno.Token = tk;
            var rt = Sitio().Crear(conToken);
            Check("A8 mismo token: misma solicitud; con otra cuenta 51409", "#0000005|False|51409|5",
                  rt.Numero + "|" + Sitio().Crear(conToken).Nuevo + "|" + Error(() => Sitio().Crear(ajeno)) + "|" + Ultimo());
            Check("A9 CHECK: USUARIOSADMIN con nombre / CATPERSONA sin nombre / otra fuente: rechazados (aun como dbo)", "547|547|547",
                  Error(() => Exec("UPDATE adm.SolicitudIniciativa SET SolicitanteNombre = N'X' WHERE NumeroSolicitud = 1")) + "|" +
                  Error(() => Exec("UPDATE adm.SolicitudIniciativa SET SolicitanteNombre = NULL WHERE NumeroSolicitud = 4")) + "|" +
                  Error(() => Exec("UPDATE adm.SolicitudIniciativa SET FuenteCorreos = 'NAVEGADOR' WHERE NumeroSolicitud = 1")));
            string deny;
            using (var cn = ComoSitio())
            {
                try { Exec(cn, "UPDATE adm.SolicitudIniciativa SET SolicitanteCorreo = N'x@soriana.com' WHERE NumeroSolicitud = 1"); deny = "sin error"; }
                catch (SqlException ex) { deny = ex.Number.ToString(); }
            }
            Check("A10 la cuenta del sitio sigue sin escribir la tabla a mano (DENY)", "229", deny);

            // ---------------- E: de punta a punta ----------------
            var catalogo = new CatalogoSolicitud(new object[] { "ADO" }, new[] {
                new CatalogoSolicitud.Asignacion { Po = "Jesus Campa Morones", So = "Edgar Ramos Davalos", Categoria = "/A/Cat 1", Director = "Dir 1" } });
            var f = new NameValueCollection();
            f["tipo"] = "ADO"; f["po"] = "Jesus Campa Morones"; f["so"] = "Edgar Ramos Davalos"; f["categoria"] = "/A/Cat 1";
            f["titulo"] = "Punta a punta MOD"; f["descripcion"] = "D"; f["observaciones"] = "O"; f["volumetria"] = "7"; f["pct"] = "10";
            f["token"] = Guid.NewGuid().ToString(); f["correo"] = "atacante@evil.com"; f["nombre"] = "Inventado";
            var svc = new IniciativaService(new GeneradorNumeroSolicitudPendiente(), Sitio(), new FuentePersonasAcuseSql(ComoSitio));
            var olga = IdentidadWindows.Desde(@"SORIANA\t_olgado", true);
            var fuenteCorreo = new FuenteCorreoAdminLocal(ComoSitio);
            var res = svc.Solicitar(SolicitudIniciativa.DesdeFormulario(f, false, null), olga, catalogo,
                                    new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]), RolAdmin.Mod,
                                    delegate { return CorreoAdmin.Para(olga, fuenteCorreo, null); });
            Check("E1 MOD sin CatPersona por IniciativaService + CorreoAdmin: guarda con su CorreoUsuario, nada del formulario",
                  @"True|True|#0000006|Punta a punta MOD|SORIANA\t_olgado|NULL|t_olgado@soriana.com|USUARIOSADMIN",
                  res.Valida + "|" + res.Guardada + "|" + res.Numero + "|" +
                  Uno("SELECT Titulo + '|' + SolicitanteCuenta FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 6") + "|" +
                  Uno("SELECT SolicitanteNombre FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 6") + "|" +
                  Uno("SELECT SolicitanteCorreo + '|' + FuenteCorreos FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 6"));
            f["token"] = Guid.NewGuid().ToString();
            var nadie = IdentidadWindows.Desde(@"SORIANA\nadie", true);
            var resV = svc.Solicitar(SolicitudIniciativa.DesdeFormulario(f, false, null), nadie, catalogo,
                                     new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]), RolAdmin.Viewer,
                                     delegate { return CorreoAdmin.Para(nadie, fuenteCorreo, null); });
            Check("E2 VIEWER fuera de CatPersona: rechazado en 'solicitante', nada guardado", "False|False|solicitante|6",
                  resV.Valida + "|" + resV.Guardada + "|" + resV.Errores[0].Campo + "|" + Cuenta("adm.SolicitudIniciativa"));
            var lista = new LectorSolicitudesIniciativaSql(ComoSitio).Listar(200);
            Dictionary<string, object> fila6 = null;
            foreach (var s in lista.Solicitudes) if ((int)s["numero"] == 6) fila6 = s;
            Check("E3 el registro de Nuevas la lee: sin nombre, con cuenta y correo", @"|SORIANA\t_olgado|t_olgado@soriana.com",
                  fila6["solicitante_nombre"] + "|" + fila6["solicitante_cuenta"] + "|" + fila6["solicitante_correo"]);
            Check("E3 Mis solicitudes de la cuenta MOD: las suyas", "3",
                  new LectorSolicitudesIniciativaSql(ComoSitio).ListarDe(@"SORIANA\t_olgado", 200).Total);

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
                Check("B1 rollback con solicitudes USUARIOSADMIN: se niega, no toca nada", "True|" + H35,
                      LotesError(cn, rb35).Contains("USUARIOSADMIN sin nombre") + "|" + HashCrear());
            Exec("DELETE FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud IN (SELECT NumeroSolicitud FROM adm.SolicitudIniciativa WHERE FuenteCorreos = 'USUARIOSADMIN');" +
                 "DELETE FROM adm.SolicitudIniciativa WHERE FuenteCorreos = 'USUARIOSADMIN';");
            using (var cn = Abrir(Base)) Lotes(cn, rb35);
            Check("B2 sin ellas: deshecha; _Crear vuelve al hash de sql/29, nombre NOT NULL, CHECK de sql/29, el sitio ya no la detecta",
                  H29 + "|0|([FuenteCorreos]='CATPERSONA')|0|False|1",
                  HashCrear() + "|" + Uno("SELECT COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull')") + "|" +
                  Uno("SELECT definition FROM sys.check_constraints WHERE name = N'CK_SolicitudIniciativa_Fuente'") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.check_constraints WHERE name = N'CK_SolicitudIniciativa_FuenteNombre'") + "|" +
                  Sitio().AceptaSolicitanteAdmin() + "|" + Cuenta("adm.SolicitudIniciativa"));
            using (var cn = Abrir(Base)) Lotes(cn, sql35);
            Check("B3 reaplicar despues del rollback", H35, HashCrear());
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("aviso: no se borro la base: " + ex.Message); }
        }
        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
