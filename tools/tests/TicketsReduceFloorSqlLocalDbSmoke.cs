// Prueba de INTEGRACION de sql/33_tickets_reduce_floor.sql (+ _rollback)
// contra bases REALES pero DESECHABLES de SQL Server LocalDB: crea
// GestionAdminPrueba_S33<n>, aplica la replica, el cargador 174bb51, las
// vistas del backend y sql/18 (la unica migracion que define
// adm.usp_GestionAdmin_TicketsReduce), corre los casos y BORRA las bases al
// final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   H  hashes: el de sql/18 de la cabecera = el de ADM_04 sec 11 = el de la
//      base recien creada con sql/18.
//   G  migracion: guarda (otra base: sin aprobar, aprobacion equivocada,
//      aprobada sin el procedimiento), rollback antes de aplicarla, version
//      desconocida (ni migracion ni rollback la sobrescriben), aplicada (hash
//      exacto), ya aplicada (no se aplica dos veces), sin cambio de datos,
//      permisos y opciones del modulo conservados.
//   F  calculo: con sql/18 ROUND, con sql/33 FLOOR (7 x 50% = 3, 7 x 100% =
//      7, 7 x 9.46% = 0, sin tickets en 30 dias = 0, sin % = NULL).
//   B  rollback: hash EXACTO de sql/18, vuelve ROUND, no se deshace dos
//      veces, se puede volver a aplicar.
//   Q  sqlcmd -b -I (si sqlcmd esta en el PATH): sin aprobar sale con error;
//      el rollback y la migracion corren como dice la cabecera.
//   D  diag ADM_04 seccion 11 (../backend_admin_persistencia), la fila de
//      TicketsReduce en cada estado: sql/18 = 'anterior' (falta sql/33),
//      sql/33 = 'vigente', version desconocida = 'OTRA: revisar', sin el
//      procedimiento = 'FALTA', cuenta sin VIEW DEFINITION = 'sin VIEW
//      DEFINITION'; el diag completo no cambia nada.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /out:TrFloor.exe /r:System.dll /r:System.Data.dll tools\tests\TicketsReduceFloorSqlLocalDbSmoke.cs
//   TrFloor.exe

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;

public static class TicketsReduceFloorSqlLocalDbSmoke
{
    const string Instancia = @"(localdb)\MSSQLLocalDB";
    const string Servidor = @"Server=" + Instancia + ";Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Proc = "adm.usp_GestionAdmin_TicketsReduce";
    // ADM_04_diag_proteccion.sql sec 11: TicketsReduce de sql/18 (vigente).
    const string H18Adm04 = "0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46";
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
    static string Uno(string db, string sql)
    {
        using (var cn = Abrir(db)) using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 })
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
    // Todas las filas de todos los resultados, "col|col|..." (la forma de
    // GestionAdminSqlLocalDbSmoke.LotesFilas).
    static string LotesFilas(SqlConnection cn, string sql)
    {
        var salida = new List<string>();
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (lote.Trim().Length == 0) continue;
            using (var cmd = new SqlCommand(lote, cn) { CommandTimeout = 120 })
            using (var rd = cmd.ExecuteReader())
                do
                    while (rd.Read())
                    {
                        var partes = new List<string>();
                        for (var i = 0; i < rd.FieldCount; i++)
                        {
                            var v = rd.GetValue(i);
                            partes.Add(v == null || v == DBNull.Value ? "NULL" : v is bool ? ((bool)v ? "1" : "0")
                                       : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture));
                        }
                        salida.Add(string.Join("|", partes));
                    }
                while (rd.NextResult());
        }
        return string.Join("\n", salida);
    }
    // La fila de TicketsReduce de la seccion 11 en la salida del diag.
    static string Fila11(string salida)
    {
        foreach (var l in salida.Split('\n')) if (l.StartsWith("11 sql/18-21|" + Proc + "|")) return l;
        return "(sin fila)";
    }
    static string Diag11(SqlConnection cn, string seccion11) { return Fila11(LotesFilas(cn, seccion11)); }
    static string Esperada11(string existe, string version, string hash)
    {
        return "11 sql/18-21|" + Proc + "|" + existe + "|" + version + "|" + hash;
    }
    const string Anterior = " (anterior: falta la siguiente migracion)";
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    // La regla del proyecto (sql/20-27, ADM_04 sec 11).
    static string Hash(string db)
    {
        return Uno(db, "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('" + Proc + "')), " +
                       "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)");
    }
    // uses_ansi_nulls|uses_quoted_identifier del modulo.
    static string Opciones()
    {
        return Uno(Base, "SELECT CONCAT(m.uses_ansi_nulls, '|', m.uses_quoted_identifier) FROM sys.sql_modules AS m WHERE m.object_id = OBJECT_ID('" + Proc + "')");
    }
    static string Permisos()
    {
        return Uno(Base, "SELECT COUNT(*) FROM sys.database_permissions AS p WHERE p.major_id = OBJECT_ID('" + Proc + "') " +
                         "AND p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'S33Lector') AND p.permission_name = N'EXECUTE' AND p.state = 'G'");
    }

    static readonly string[] Codigos = { "PRB 2026-000001", "PRB 2026-000002", "PRB 2026-000003", "PRB 2026-000004", "PRB 2026-000005" };
    static readonly string[] Rutas = { "/T/Siete", "/T/Siete", "/T/Siete", "/T/Vieja", "/T/Siete" };

    // Llama al procedimiento para cada fila (como Crear / Modificar) y
    // devuelve los TicketsReduce en orden (NULL explicito).
    static string Calcular()
    {
        using (var cn = Abrir(Base))
            for (var i = 0; i < Codigos.Length; i++)
                Exec(cn, "DECLARE @c adm.CategoriaPctTipo; INSERT @c (Categoria) VALUES (N'" + Rutas[i] + "'); " +
                         "EXEC " + Proc + " @Codigo = N'" + Codigos[i] + "', @Categorias = @c;");
        return Guardados();
    }
    static string Guardados()
    {
        return Uno(Base, "SELECT STRING_AGG(ISNULL(CONVERT(varchar(10), TicketsReduce), 'NULL'), '|') WITHIN GROUP (ORDER BY Codigo) FROM dbo.ProblemCategoria");
    }
    // Lo que el ALTER no debe tocar: filas y eventos.
    static string Datos()
    {
        return Uno(Base, "SELECT CONCAT((SELECT COUNT(*) FROM dbo.ProblemCategoria), '|', (SELECT COUNT(*) FROM dbo.Problem), '|', " +
                         "(SELECT COUNT(*) FROM dbo.ProblemFechaEvento), '|', (SELECT COUNT(*) FROM dbo.Tickets))");
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
            // Un permiso propio del procedimiento: ALTER lo debe conservar.
            Exec(cn, "CREATE USER [S33Lector] WITHOUT LOGIN; GRANT EXECUTE ON " + Proc + " TO [S33Lector];");
            // 7 tickets de /T/Siete en los ultimos 30 dias (hora de Mexico,
            // la de VolumenUltimos30); /T/Vieja solo tiene tickets de hace 60.
            Exec(cn, @"
DECLARE @ahora datetime2(0) = DATEADD(HOUR, -6, SYSUTCDATETIME());
INSERT dbo.Tickets (CodigoTicket, FechaRegistro, Tipo, Categoria)
SELECT N'S' + CONVERT(nvarchar(10), n), DATEADD(DAY, -1, @ahora), N'Incidencia', N'/T/Siete'
FROM (VALUES (1), (2), (3), (4), (5), (6), (7)) AS x (n);
INSERT dbo.Tickets (CodigoTicket, FechaRegistro, Tipo, Categoria)
SELECT N'V' + CONVERT(nvarchar(10), n), DATEADD(DAY, -60, @ahora), N'Incidencia', N'/T/Vieja'
FROM (VALUES (1), (2), (3)) AS x (n);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado) VALUES
 (N'PRB 2026-000001', N'Problem', N'50%', N'Cerrado'),
 (N'PRB 2026-000002', N'Problem', N'100%', N'Cerrado'),
 (N'PRB 2026-000003', N'Problem', N'9.46%', N'Cerrado'),
 (N'PRB 2026-000004', N'Problem', N'sin tickets en 30 dias', N'Cerrado'),
 (N'PRB 2026-000005', N'Problem', N'sin %', N'Cerrado');
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/T/Siete', N'Problem', N'Problem', 0.5000, 1),
 (N'PRB 2026-000002', N'/T/Siete', N'Problem', N'Problem', 1.0000, 1),
 (N'PRB 2026-000003', N'/T/Siete', N'Problem', N'Problem', 0.0946, 1),
 (N'PRB 2026-000004', N'/T/Vieja', N'Problem', N'Problem', 1.0000, 1),
 (N'PRB 2026-000005', N'/T/Siete', N'Problem', N'Problem', NULL, 1);");
        }
    }

    // sqlcmd -b -I, como dice la cabecera. -> "codigo de salida|salida".
    static string Sqlcmd(string db, string archivo, string aprobacion)
    {
        var tmp = Path.Combine(Path.GetTempPath(), "s33_" + Guid.NewGuid().ToString("N") + ".sql");
        try
        {
            File.WriteAllText(tmp, (aprobacion == null ? "" : "EXEC sys.sp_set_session_context N'aprobar_migracion', N'" + aprobacion + "';\r\nGO\r\n") +
                                   File.ReadAllText(archivo));
            var pi = new ProcessStartInfo("sqlcmd", "-S \"" + Instancia + "\" -E -d " + db + " -b -I -i \"" + tmp + "\"")
            { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
            using (var p = Process.Start(pi))
            {
                var salida = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit();
                return p.ExitCode + "|" + salida;
            }
        }
        finally { File.Delete(tmp); }
    }
    static bool HaySqlcmd()
    {
        try
        {
            using (var p = Process.Start(new ProcessStartInfo("sqlcmd", "-?") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true }))
            { p.StandardOutput.ReadToEnd(); p.WaitForExit(); return true; }
        }
        catch (Exception) { return false; }
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        Base = "GestionAdminPrueba_S33" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var guarda = "S33Guarda_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql33 = Leer("sql", "33_tickets_reduce_floor.sql");
        var rb33 = Leer("sql", "33_tickets_reduce_floor_rollback.sql");
        var h18 = Regex.Match(sql33, @"TicketsReduce = sql/18\s+(0x[0-9A-F]{64})").Groups[1].Value;
        var h33 = Regex.Match(sql33, @"POSTCONDICION \(si no, ROLLBACK\)\s+TicketsReduce\s+(0x[0-9A-F]{64})").Groups[1].Value;
        // El lote EXACTO de sql/18, para volver a dejarlo despues de una
        // version desconocida (como ALTER).
        var lote18 = Array.Find(Regex.Split(Leer("sql", "18_gestion_admin_persistencia.sql"), @"^\s*GO\s*$", RegexOptions.Multiline),
                                l => l.Contains("CREATE PROCEDURE " + Proc));
        var alter18 = lote18.Replace("CREATE PROCEDURE " + Proc, "ALTER PROCEDURE " + Proc);
        // El diag ADM_04 completo y solo su seccion 11 (desde su comentario).
        var adm04 = Path.Combine(Backend, "ADM_04_diag_proteccion.sql");
        var diag = File.Exists(adm04) ? File.ReadAllText(adm04) : "";
        var i11 = diag.IndexOf("/* 11. Lo que instalan");
        var seccion11 = i11 < 0 ? "" : "SET NOCOUNT ON;\r\n" + diag.Substring(i11);
        try
        {
            // ---------------- H: hashes ----------------
            Check("H1 cabeceras = ADM_04 sec 11: sql/18 (anterior) y sql/33 (vigente); el rollback espera los mismos", "True|True|True|True|True|True|True",
                  (h18 == H18Adm04) + "|" + diag.Contains("(N'" + Proc + "',   " + H18Adm04 + ", 'sql/18', 0)") + "|" +
                  diag.Contains("(N'" + Proc + "',   " + h33 + ", 'sql/33', 1)") + "|" +
                  (h33.Length == 66 && h33 != h18) + "|" + rb33.Contains(h33) + "|" + rb33.Contains(h18) + "|" + (i11 > 0));

            // ---------------- G: guarda (otra base) ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
            {
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql33).Contains("Migracion 33 SIN APROBAR") + "|" + LotesError(g, rb33).Contains("Rollback 33 SIN APROBAR"));
                Exec(g, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'27';");
                Check("G1b aprobacion de otra migracion (27): se niegan igual", "True|True",
                      LotesError(g, sql33).Contains("SIN APROBAR") + "|" + LotesError(g, rb33).Contains("SIN APROBAR"));
                Exec(g, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'33R';");
                Check("G1c la del rollback (33R) no aprueba la migracion", true, LotesError(g, sql33).Contains("SIN APROBAR"));
                Exec(g, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'33';");
                Check("G1d aprobada pero sin el procedimiento (sin sql/18): se niega y no crea nada", "True|NULL",
                      LotesError(g, sql33).Contains("falta " + Proc) + "|" + Uno(guarda, "SELECT OBJECT_ID('" + Proc + "')"));
                Check("D1 diag sec 11 sin el procedimiento: FALTA", Esperada11("0", "FALTA", "NULL"), Diag11(g, seccion11));
            }
            Borrar(guarda);

            Preparar(Base);
            Check("H2 la base con sql/18 tiene el hash de la cabecera (y de ADM_04)", H18Adm04, Hash(Base));
            using (var cn = Abrir(Base))
            {
                var antesDiag = Hash(Base) + "|" + Guardados() + "|" + Datos();
                var completo = LotesFilas(cn, diag);
                Check("D2 diag COMPLETO con sql/18: TicketsReduce 'anterior' (falta sql/33) y no cambia nada (hash, datos)",
                      Esperada11("1", "sql/18" + Anterior, H18Adm04) + "|" + antesDiag, Fila11(completo) + "|" + Hash(Base) + "|" + Guardados() + "|" + Datos());
                Console.WriteLine("   diag " + Fila11(completo));
                Exec(cn, "EXECUTE AS USER = N'S33Lector';");
                var sinVer = Diag11(cn, seccion11);
                Exec(cn, "REVERT;");
                Check("D3 cuenta con EXECUTE y sin VIEW DEFINITION: 'sin VIEW DEFINITION' (ni FALTA ni una version)",
                      Esperada11("1", "sin VIEW DEFINITION", "NULL"), sinVer);
            }
            var opciones18 = Opciones();
            Check("F1 con sql/18: ROUND (7x50% = 4, 7x100% = 7, 7x9.46% = 1, sin 30 dias = 0, sin % = NULL)", "4|7|1|0|NULL", Calcular());
            var antes = Datos();

            using (var cn = Abrir(Base))
            {
                Check("G2 rollback antes de aplicarla: se niega sin tocar nada", "True|" + h18,
                      LotesError(cn, rb33).Contains("sql/33 no aplicada") + "|" + Hash(Base));

                // Version desconocida: ni la migracion ni el rollback la pisan.
                Exec(cn, alter18.Replace("SET NOCOUNT ON; SET XACT_ABORT ON;", "SET NOCOUNT ON; SET XACT_ABORT ON; -- version local"));
                var hOtra = Hash(Base);
                Check("G3 version desconocida: la migracion se niega y la deja igual", "True|True|" + hOtra,
                      (hOtra != h18 && hOtra != h33) + "|" + LotesError(cn, sql33).Contains("no es la de sql/18") + "|" + Hash(Base));
                Check("G3b ... y el rollback tambien", "True|" + hOtra, LotesError(cn, rb33).Contains("no es la de sql/33") + "|" + Hash(Base));
                Check("D4 diag sec 11 con una version desconocida: OTRA: revisar", Esperada11("1", "OTRA: revisar", hOtra), Diag11(cn, seccion11));
                Exec(cn, alter18);
                Check("G3c el lote exacto de sql/18 vuelve al hash de sql/18", h18, Hash(Base));

                var r33 = LotesError(cn, sql33);
                Console.WriteLine("      hash TicketsReduce 33 = " + Hash(Base) + "  (" + r33 + ")");
                Check("G4 aplicada: TicketsReduce con el hash EXACTO de sql/33", "sin error|" + h33, r33 + "|" + Hash(Base));
                Check("G5 el ALTER no cambia datos: TicketsReduce guardados, filas y eventos iguales", "4|7|1|0|NULL|" + antes, Guardados() + "|" + Datos());
                Check("G6 conserva el permiso propio y las opciones del modulo", "1|" + opciones18, Permisos() + "|" + Opciones());
                Check("G7 aplicarla otra vez: 'ya aplicada', sin tocar nada", "True|" + h33, LotesError(cn, sql33).Contains("ya aplicada") + "|" + Hash(Base));
                Check("D5 diag sec 11 con sql/33: sql/33 (vigente)", Esperada11("1", "sql/33 (vigente)", h33), Diag11(cn, seccion11));
            }
            Check("F2 con sql/33: FLOOR (7x50% = 3, 7x100% = 7, 7x9.46% = 0, sin 30 dias = 0, sin % = NULL)", "3|7|0|0|NULL", Calcular());
            Check("F3 resultados enteros y nunca negativos", "0|0",
                  Uno(Base, "SELECT CONCAT(SUM(CASE WHEN TicketsReduce < 0 THEN 1 ELSE 0 END), '|', " +
                            "SUM(CASE WHEN TicketsReduce IS NOT NULL AND TicketsReduce <> FLOOR(TicketsReduce) THEN 1 ELSE 0 END)) FROM dbo.ProblemCategoria"));

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                var rb = LotesError(cn, rb33);
                Check("B1 rollback: TicketsReduce EXACTO de sql/18 (hash de ADM_04), permiso y opciones", "sin error|" + H18Adm04 + "|1|" + opciones18,
                      rb + "|" + Hash(Base) + "|" + Permisos() + "|" + Opciones());
                Check("B2 los datos calculados con FLOOR se quedan (no se recalcula nada)", "3|7|0|0|NULL", Guardados());
                Check("B3 rollback otra vez: 'sql/33 no aplicada', sin tocar nada", "True|" + h18, LotesError(cn, rb33).Contains("sql/33 no aplicada") + "|" + Hash(Base));
                Check("D6 diag sec 11 tras el rollback: otra vez sql/18 (anterior), el hash exacto", Esperada11("1", "sql/18" + Anterior, H18Adm04), Diag11(cn, seccion11));
            }
            Check("B4 tras el rollback vuelve ROUND", "4|7|1|0|NULL", Calcular());
            using (var cn = Abrir(Base))
            {
                Lotes(cn, sql33);
                Check("B5 volver a aplicar sql/33 despues del rollback", h33, Hash(Base));
            }
            Check("B6 ... y vuelve FLOOR", "3|7|0|0|NULL", Calcular());

            // ---------------- Q: sqlcmd -b -I ----------------
            if (!HaySqlcmd())
            {
                Console.WriteLine("NO CORRIDO  Q*: sqlcmd no esta en el PATH (no se da por pasado).");
            }
            else
            {
                Borrar(guarda);
                using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
                var q1 = Sqlcmd(guarda, Path.Combine("sql", "33_tickets_reduce_floor.sql"), null);
                Check("Q1 sqlcmd -b sin aprobar (otra base): sale con error y lo dice", "True|True", (!q1.StartsWith("0|")) + "|" + q1.Contains("SIN APROBAR"));
                Borrar(guarda);
                var q2 = Sqlcmd(Base, Path.Combine("sql", "33_tickets_reduce_floor_rollback.sql"), "33R");
                Check("Q2 sqlcmd -b -I rollback aprobado: sale 0, DESHECHA, hash de sql/18", "True|True|" + h18, q2.StartsWith("0|") + "|" + q2.Contains("DESHECHA") + "|" + Hash(Base));
                var q3 = Sqlcmd(Base, Path.Combine("sql", "33_tickets_reduce_floor.sql"), "33");
                Check("Q3 sqlcmd -b -I migracion aprobada: sale 0, APLICADA, hash de sql/33, QUOTED_IDENTIFIER del modulo", "True|True|" + h33 + "|" + opciones18,
                      q3.StartsWith("0|") + "|" + q3.Contains("APLICADA") + "|" + Hash(Base) + "|" + Opciones());
                var q4 = Sqlcmd(Base, Path.Combine("sql", "33_tickets_reduce_floor.sql"), "33");
                Check("Q4 sqlcmd -b otra vez: sale con error ('ya aplicada') y no toca nada", "True|True|" + h33,
                      (!q4.StartsWith("0|")) + "|" + q4.Contains("ya aplicada") + "|" + Hash(Base));
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
