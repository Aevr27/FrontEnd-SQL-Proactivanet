// Prueba de INTEGRACION de sql/26_gestion_admin_crear_volumetria.sql
// (+ _rollback) con el escritor de Admin (EscritorGestionAdminSql.Crear) y
// DeteccionSql26, contra bases REALES pero DESECHABLES de SQL Server LocalDB:
// crea GestionAdminPrueba_V26<n>, aplica la replica, el cargador 174bb51, las
// vistas del backend, sql/18, 20, 21, 22 + permisos (la VM hoy), corre los
// casos y BORRA las bases al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base), exige sql/23 antes, hash y parametro,
//      ya aplicada, rollback antes de aplicarla.
//   S  DeteccionSql26 (lo que enciende el campo en el sitio): sin sql/26
//      apagada, con sql/26 encendida (tambien como la cuenta del sitio).
//   K  compatibilidad: el sitio sin el interruptor sigue creando sobre el
//      procedimiento de sql/26 (VolumetriaOriginal NULL).
//   C  guardado: la volumetria de ADM llega a dbo.Problem.VolumetriaOriginal;
//      sin ella NULL; 0 es 0; negativa 51028 y nada se guarda; el % y
//      TicketsReduce son los mismos que sin volumetria (no la usan).
//   P  cuenta del sitio (EXECUTE AS PROACTIVANETAD) por encadenamiento.
//   B  rollback: Crear vuelve EXACTO a sql/23; los datos se quedan; la
//      deteccion la apaga; el sitio sigue creando; volver a aplicar.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

public static class CrearVolumetriaSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Crear21 = "0x540F83EF4AF3AB4A3D3E2E8E7B6D4DE75B7731E98085DAD11CF54B14A4478D79";
    const string Crear23 = "0x8032AA3EBEA8E44EFB1E58DF977824093B91BFACFEC2E5EB0684AEC1E52743E6";
    static readonly DateTime Hoy = new DateTime(2026, 10, 21);
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
    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 }) c.ExecuteNonQuery(); }
    static string Uno(string sql)
    {
        using (var cn = Abrir(Base)) using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 })
        {
            var v = c.ExecuteScalar();
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
    static string Hash()
    {
        return Uno("SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear')), " +
                   "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)");
    }
    static string Parametro() { return Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear') AND name = N'@VolumetriaOriginal'"); }

    // Lo que el sitio decide (DeteccionSql26 sobre la base, sin forzado);
    // comoSitio = EXECUTE AS PROACTIVANETAD.
    static bool Detecta(bool comoSitio)
    {
        var forzada = PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas;
        PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = null;
        PersistenciaGestionAdmin.OlvidarSql26ParaPruebas();
        try
        {
            using (var cn = Abrir(Base))
            {
                if (comoSitio) Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                return DeteccionSql26.Revisar(cn);
            }
        }
        finally { PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = forzada; }
    }

    static void Preparar(string db)
    {
        Borrar(db);
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + db + "]");
        using (var cn = Abrir(db))
        {
            Lotes(cn, Leer("tools", "tests", "GestionAdminLocalDb_replica.sql"));
            Exec(cn, "CREATE USER [SORIANA_edgarrad] WITHOUT LOGIN; ALTER AUTHORIZATION ON SCHEMA::stg TO [SORIANA_edgarrad];");
            Lotes(cn, Leer("tools", "tests", "usp_CargarExperiencia_174bb51.sql"));
            Lotes(cn, File.ReadAllText(Path.Combine(Backend, "_origen", "vw_ProblemCategoria_38.sql")));
            Lotes(cn, File.ReadAllText(Path.Combine(Backend, "_origen", "vw_ProblemVencido_26.sql")));
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia.sql"));
            Lotes(cn, Leer("sql", "20_gestion_admin_duenos.sql"));
            Lotes(cn, Leer("sql", "21_gestion_admin_agrupacion_acentos.sql"));
            Lotes(cn, Leer("sql", "22_solicitudes_cambio.sql"));
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            Lotes(cn, Leer("sql", "22_solicitudes_cambio_permisos.sql"));
            Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'ADO', N'Adopcion', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado) VALUES (N'ADO 2025-000001', N'Problem', N'Semilla', N'En An" + "á" + @"lisis');
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'ADO 2025-000001', N'/A/Cat 2', N'Problem', N'Problem', 0.0100, 1);");
        }
    }

    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
        catch (InvalidOperationException ex) { return "IOE:" + ex.Message; }
    }

    static PlanCrearAdmin Plan(int? volumetria, decimal? pct)
    {
        var p = new PlanCrearAdmin
        {
            Prefijo = "ADO", TipoIniciativa = "Problem", TipoAgrupado = "Problem", Estado = null,
            Titulo = "Alta", Volumetria = volumetria,
            FechaCreacion = Hoy, FechaAnalisis = Hoy.AddDays(15), FechaEntregaAnalisis = Hoy,
        };
        p.Categorias.Add(new CategoriaPlan { Ruta = "/A/Cat 1", Pct = pct, TipoIniciativa = "Problem", TipoAgrupado = "Problem" });
        return p;
    }
    static string Crear(PlanCrearAdmin plan, string usuario)
    {
        using (var cn = Abrir(Base)) return new EscritorGestionAdminSql().Crear(cn, null, plan, usuario);
    }
    static string Fila(string codigo)
    {
        return Uno("SELECT ISNULL(CONVERT(varchar(20), p.VolumetriaOriginal), 'NULL') + '|' + ISNULL(CONVERT(varchar(20), pc.PctDisminucion), 'NULL') + '|' + " +
                   "ISNULL(CONVERT(varchar(20), pc.TicketsReduce), 'NULL') FROM dbo.Problem AS p " +
                   "LEFT JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = p.Codigo WHERE p.Codigo = N'" + codigo + "'");
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        Base = "GestionAdminPrueba_V26" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var guarda = "V26Guarda_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql23 = Leer("sql", "23_cambios_recientes.sql");
        var sql26 = Leer("sql", "26_gestion_admin_crear_volumetria.sql");
        var rb26 = Leer("sql", "26_gestion_admin_crear_volumetria_rollback.sql");
        var h26 = Regex.Match(sql26, @"POSTCONDICION \(si no, ROLLBACK\)\s+Crear\s+(0x[0-9A-F]{64})").Groups[1].Value;
        try
        {
            Preparar(Base);
            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
            {
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql26).Contains("SIN APROBAR") + "|" + LotesError(g, rb26).Contains("SIN APROBAR"));
            }
            Borrar(guarda);
            using (var cn = Abrir(Base))
            {
                Check("G2 con sql/21 (sin sql/23): se niega pidiendo sql/23; Crear sigue siendo el de sql/21", "True|" + Crear21 + "|0",
                      LotesError(cn, sql26).Contains("Aplica sql/23 antes") + "|" + Hash() + "|" + Parametro());
                Lotes(cn, sql23);
                Check("S1 con sql/23 sin sql/26: la deteccion la deja apagada (sitio y cuenta del sitio)", "False|False", Detecta(false) + "|" + Detecta(true));
                Check("G3 rollback de 26 antes de aplicarla: se niega sin tocar nada", "True|" + Crear23,
                      LotesError(cn, rb26).Contains("sql/26 no aplicada") + "|" + Hash());
            }
            // K antes de aplicar: el sitio de hoy (sin volumetria) sobre sql/23.
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = false;
            Check("K0 sin sql/26 y con volumetria en el plan: el escritor se niega (no la tira en silencio)", "True",
                  Error(() => Crear(Plan(10, 0.1m), @"SORIANA\adm1")).StartsWith("IOE:"));
            using (var cn = Abrir(Base))
            {
                var r26 = LotesError(cn, sql26);
                Console.WriteLine("      hash Crear 26 = " + Hash() + "  (" + r26 + ")");
                Check("G4 aplicada: Crear con el hash de sql/26 y @VolumetriaOriginal", "sin error|" + h26 + "|1", r26 + "|" + Hash() + "|" + Parametro());
                Check("G5 aplicarla otra vez: 'ya aplicada', sin tocar nada", "True|" + h26, LotesError(cn, sql26).Contains("ya aplicada") + "|" + Hash());
            }

            // ---------------- K: compatibilidad ----------------
            var k1 = Crear(Plan(null, 0.1m), @"SORIANA\adm1");
            Check("K1 el sitio SIN el interruptor (no manda @VolumetriaOriginal) sigue creando: NULL", "NULL", Fila(k1).Split('|')[0]);

            // ---------------- C: guardado ----------------
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = true;
            var c1 = Crear(Plan(1500, 0.1m), @"SORIANA\adm2");
            Check("C1 la volumetria de ADM llega a dbo.Problem.VolumetriaOriginal", "1500", Fila(c1).Split('|')[0]);
            Check("C2 el % y TicketsReduce son los mismos que sin volumetria (TicketsReduce no la usa)",
                  Fila(k1).Split('|')[1] + "|" + Fila(k1).Split('|')[2], Fila(c1).Split('|')[1] + "|" + Fila(c1).Split('|')[2]);
            Check("C3 con el interruptor y sin volumetria: NULL (no 0)", "NULL", Fila(Crear(Plan(null, 0.1m), @"SORIANA\adm2")).Split('|')[0]);
            Check("C4 volumetria 0: se guarda 0", "0", Fila(Crear(Plan(0, 0.1m), @"SORIANA\adm2")).Split('|')[0]);
            var antes = Uno("SELECT COUNT(*) FROM dbo.Problem");
            Check("C5 negativa directo al procedimiento: 51028 y no se crea nada", "51028|" + antes,
                  Error(() => Crear(Plan(-1, 0.1m), @"SORIANA\adm2")) + "|" + Uno("SELECT COUNT(*) FROM dbo.Problem"));
            Check("C6 el maximo de int se guarda tal cual", "2147483647", Fila(Crear(Plan(int.MaxValue, null), @"SORIANA\adm2")).Split('|')[0]);
            Check("C7 el alta sigue protegida y sellada (sql/18 + sql/23)", "ALTA|SORIANA\\adm2",
                  Uno("SELECT Motivo + '|' + UltimoCambioUsuario FROM adm.IniciativaProtegida WHERE Codigo = N'" + c1 + "'"));

            // ---------------- P: cuenta del sitio ----------------
            string p1;
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                p1 = new EscritorGestionAdminSql().Crear(cn, null, Plan(321, 0.05m), @"SORIANA\adm3");
            }
            Check("P1 como PROACTIVANETAD: la volumetria se guarda por el procedimiento", "321", Fila(p1).Split('|')[0]);

            // ---------------- S: deteccion real ----------------
            Check("S2 con sql/26: la deteccion la enciende (tambien como PROACTIVANETAD)", "True|True", Detecta(false) + "|" + Detecta(true));
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = null;
            Check("S3 sin forzado, tras detectar: activa y por ese camino se guarda", "True|777",
                  Detecta(false) + "|" + Fila(Crear(Plan(777, 0.1m), @"SORIANA\adm4")).Split('|')[0]);

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                Lotes(cn, rb26);
                Check("B1 rollback: Crear EXACTO de sql/23, sin el parametro", Crear23 + "|0", Hash() + "|" + Parametro());
                Check("B2 los datos se quedan", "1500", Fila(c1).Split('|')[0]);
                Check("B3 tras el rollback la deteccion la apaga sola", false, Detecta(false));
                Check("B4 apagada por la deteccion, el sitio sigue creando sobre sql/23", "NULL", Fila(Crear(Plan(null, 0.1m), @"SORIANA\adm5")).Split('|')[0]);
                Lotes(cn, sql26);
                Check("B5 volver a aplicar sql/26 despues del rollback", h26 + "|1", Hash() + "|" + Parametro());
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = null;
            PersistenciaGestionAdmin.OlvidarSql26ParaPruebas();
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
