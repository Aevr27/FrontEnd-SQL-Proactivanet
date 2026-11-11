// tools/tests/TicketsReduceCeilingSqlLocalDbSmoke.cs - prueba de INTEGRACION
// de sql/84_tickets_reduce_ceiling.sql (+ _rollback_a_18 / _rollback_a_33)
// contra bases REALES pero DESECHABLES de SQL Server LocalDB: crea
// GestionAdminPrueba_S84<sello>, aplica la replica, el cargador 174bb51, las
// vistas del backend (../backend_admin_persistencia/_origen) y sql/18, corre
// los casos y BORRA la base al final. Nunca toca QA ni Tickets_Proactivanet.
//
// Regla (negocio, 2026-11-11): TicketsReduce = CEILING(VolumenUltimos30 x
// MIN(%, 1)) por iniciativa; sin % = NULL.
//
// Casos (prefijo del rotulo):
//   H  hashes: sql/18 de la cabecera = ADM_04 = base recien creada; los de
//      18 y 33 en la precondicion, el de 84 en la postcondicion y rollbacks.
//   G  guarda de aprobacion (sin aprobar, otra aprobacion, la del rollback).
//   R0 rollback antes de aplicarla: 'no aplicada'.
//   A  desde sql/18: aplicada, hash exacto, TicketsReduceAntes = sql/18, sin
//      cambio de datos/permisos/opciones; el ALTER no recalcula; CEILING al
//      llamar; no se aplica dos veces; rollback equivocado se niega.
//   B  rollback a 18: hash EXACTO de sql/18, ROUND otra vez; se reaplica.
//   C  desde sql/33 (el estado de QA): aplicada, CEILING; C1b 7 x 99% = 7,
//      0% = 0, % > 1 topado al volumen, % negativo; rollback a 33: hash
//      EXACTO de sql/33 y FLOOR otra vez.
//   V  version desconocida / sin procedimiento: todo se niega sin tocar.
//   P  con TicketsReduceAntes ya puesta: se niega.
//   Q  sqlcmd -b -I: aplica (0), segunda vez error (1), rollback (0).
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /out:TrCeil.exe /r:System.dll /r:System.Data.dll tools\tests\TicketsReduceCeilingSqlLocalDbSmoke.cs
//   TrCeil.exe            (lee sql\84_*.sql; opcional: otra carpeta como primer argumento)

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;

public static class TicketsReduceCeiling84Prueba
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
                         "AND p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'S84Lector') AND p.permission_name = N'EXECUTE' AND p.state = 'G'");
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
            Exec(cn, "CREATE USER [S84Lector] WITHOUT LOGIN; GRANT EXECUTE ON " + Proc + " TO [S84Lector];");
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
        var tmp = Path.Combine(Path.GetTempPath(), "s84_" + Guid.NewGuid().ToString("N") + ".sql");
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


    // ---------------------------------------------------------------
    // Prueba de la PROPUESTA sql/84 (solo scratchpad, LocalDB desechable).
    // Uso: Prueba84.exe <carpeta de los .sql de 84> [hash]
    //   hash: solo aplica el lote de 84 sobre sql/18 e imprime su hash.
    // ---------------------------------------------------------------
    static string Dir84;
    static string L84(string n) { return File.ReadAllText(Path.Combine(Dir84, n)); }
    static string Correr(string db, string sql)
    {
        using (var cn = Abrir(db)) return LotesError(cn, sql);
    }
    static string Correr(string sql) { return Correr(Base, sql); }
    static string Antes(string db)
    {
        return Uno(db, "SELECT CONVERT(nvarchar(20), value) FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID('" + Proc + "') AND minor_id = 0 AND name = N'TicketsReduceAntes'");
    }
    // Filas 1..5: 7 x 50% = 3.5, 7 x 100% = 7, 7 x 20% = 1.4, /T/Vieja 0 en 30 dias, sin %.
    //   ROUND 4|7|1|0|NULL   FLOOR 3|7|1|0|NULL   CEILING 4|7|2|0|NULL
    const string Round = "4|7|1|0|NULL", Floor = "3|7|1|0|NULL", Ceiling = "4|7|2|0|NULL";
    static void Ajustar(string db)
    {
        using (var cn = Abrir(db))
            Exec(cn, "UPDATE dbo.ProblemCategoria SET PctDisminucion = 0.2000 WHERE Codigo = N'PRB 2026-000003';");
    }

    public static int Main(string[] args)
    {
        if (!Directory.Exists(Backend)) { Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia"); return 2; }
        Dir84 = args.Length > 0 ? args[0] : "sql";
        var sello = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        Base = "GestionAdminPrueba_S84" + sello;
        var sql18 = Leer("sql", "18_gestion_admin_persistencia.sql");
        var sql33 = Leer("sql", "33_tickets_reduce_floor.sql");
        var m84 = L84("84_tickets_reduce_ceiling.sql");
        var r18 = L84("84_tickets_reduce_ceiling_rollback_a_18.sql");
        var r33 = L84("84_tickets_reduce_ceiling_rollback_a_33.sql");
        const string H18 = "0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46";
        const string H33 = "0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F";
        var h84 = Regex.Match(m84, @"POSTCONDICION \(si no, ROLLBACK\)\s+TicketsReduce\s+(0x[0-9A-F]{64})").Groups[1].Value;
        var bases = new List<string> { Base };
        try
        {
            Preparar(Base);
            if (args.Length > 1 && args[1] == "hash")
            {
                Correr(L84("lote84.sql"));
                Console.WriteLine("HASH84 " + Hash(Base));
                return 0;
            }
            Ajustar(Base);
            var datos0 = Datos();
            Check("H1 parte de sql/18 (hash de ADM_04) y calcula ROUND", H18 + "|" + Round, Hash(Base) + "|" + Calcular());
            Check("H2 los hashes del texto: 18 y 33 en la precondicion, 84 en la postcondicion y en los dos rollbacks",
                  "True|True|True|True", m84.Contains(H18) + "|" + m84.Contains(H33) + "|" + r18.Contains(h84) + "|" + r33.Contains(h84));

            // G: guardas fuera de una base de prueba.
            var guarda = "S84Guarda_" + sello; bases.Add(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");   // vacia: la replica solo va en GestionAdminPrueba_*
            using (var g = Abrir(guarda))
            {
                Check("G1 sin aprobar: migracion y los dos rollbacks se niegan", "True|True|True",
                      LotesError(g, m84).Contains("Migracion 84 SIN APROBAR") + "|" + LotesError(g, r18).Contains("SIN APROBAR") + "|" + LotesError(g, r33).Contains("SIN APROBAR"));
                Exec(g, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'33';");
                Check("G2 otra aprobacion (33) no sirve", true, LotesError(g, m84).Contains("SIN APROBAR"));
                Exec(g, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'84R18';");
                Check("G3 la del rollback (84R18) no aprueba la migracion", true, LotesError(g, m84).Contains("SIN APROBAR"));
                Exec(g, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'84';");
                Check("G4 aprobada (84) en una base que no es de prueba: pasa la guarda y se detiene en la precondicion (no hay procedimiento)", "False|True",
                      LotesError(g, m84).Contains("SIN APROBAR") + "|" + LotesError(g, m84).Contains("falta " + Proc));
            }

            // A: desde sql/18.
            Check("R0 rollback antes de aplicarla: 'no aplicada', sin tocar", "True|" + H18, Correr(r18).Contains("sql/84 no aplicada") + "|" + Hash(Base));
            var opc = Opciones(); var per = Permisos();
            var a1 = Correr(m84);
            Check("A1 desde sql/18: aplicada, hash de 84, Antes = sql/18, sin cambiar datos, permisos ni opciones",
                  "sin error|" + h84 + "|sql/18|" + datos0 + "|" + per + "|" + opc, a1 + "|" + Hash(Base) + "|" + Antes(Base) + "|" + Datos() + "|" + Permisos() + "|" + Opciones());
            Check("A2 el ALTER no recalcula: siguen los de ROUND hasta volver a llamar", Round, Guardados());
            Check("A3 CEILING al llamar (3.5 -> 4, 7 exacto, 1.4 -> 2, sin tickets 0, sin % NULL)", Ceiling, Calcular());
            Check("A4 otra vez: 'ya aplicada', sin tocar", "True|" + h84 + "|sql/18", Correr(m84).Contains("ya aplicada") + "|" + Hash(Base) + "|" + Antes(Base));
            Check("A5 rollback equivocado (a 33) cuando antes era 18: se niega, sin tocar", "True|" + h84 + "|sql/18",
                  Correr(r33).Contains("usa el otro rollback") + "|" + Hash(Base) + "|" + Antes(Base));
            Check("B1 rollback a 18: hash EXACTO de sql/18, sin la propiedad, ROUND otra vez", "sin error|" + H18 + "|NULL|" + Round + "|" + per + "|" + opc,
                  Correr(r18) + "|" + Hash(Base) + "|" + Antes(Base) + "|" + Calcular() + "|" + Permisos() + "|" + Opciones());
            Check("B2 rollback otra vez: 'no aplicada'", true, Correr(r18).Contains("sql/84 no aplicada"));
            Check("B3 se puede volver a aplicar", "sin error|" + h84 + "|" + Ceiling, Correr(m84) + "|" + Hash(Base) + "|" + Calcular());
            Correr(r18);

            // C: desde sql/33 (FLOOR).
            Check("C0 sql/33 sobre sql/18: FLOOR", "sin error|" + H33 + "|" + Floor, Correr(sql33) + "|" + Hash(Base) + "|" + Calcular());
            Check("C1 desde sql/33: aplicada, Antes = sql/33, CEILING", "sin error|" + h84 + "|sql/33|" + Ceiling, Correr(m84) + "|" + Hash(Base) + "|" + Antes(Base) + "|" + Calcular());
            // C1b: la fila PRB 2026-000003 (/T/Siete, 7 tickets en 30 dias) con
            // otros %: 99% -> 6.93 -> 7; 0% -> 0; 150% -> topado a 100% -> 7;
            // -10% -> -0.7 -> CEILING 0 (el procedimiento no trata aparte los
            // negativos; con FLOOR era -1). Luego vuelve a 20%.
            {
                var vals = new List<string>();
                foreach (var pct in new[] { "0.9900", "0.0000", "1.5000", "-0.1000" })
                {
                    using (var cn = Abrir(Base))
                        Exec(cn, "UPDATE dbo.ProblemCategoria SET PctDisminucion = " + pct + " WHERE Codigo = N'PRB 2026-000003';");
                    vals.Add(Calcular().Split('|')[2]);
                }
                Ajustar(Base);
                Check("C1b CEILING por iniciativa: 7 x 99% = 7, 7 x 0% = 0, 7 x 150% = 7 (tope), 7 x -10% = 0; nunca mas que el volumen",
                      "7|0|7|0|" + Ceiling, string.Join("|", vals) + "|" + Calcular());
            }
            Check("C2 rollback equivocado (a 18) cuando antes era 33: se niega, sin tocar", "True|" + h84,
                  Correr(r18).Contains("usa el otro rollback") + "|" + Hash(Base));
            Check("C3 rollback a 33: hash EXACTO de sql/33, sin la propiedad, FLOOR otra vez", "sin error|" + H33 + "|NULL|" + Floor,
                  Correr(r33) + "|" + Hash(Base) + "|" + Antes(Base) + "|" + Calcular());
            Check("C4 rollback a 33 otra vez: 'no aplicada'", true, Correr(r33).Contains("sql/84 no aplicada"));

            // V: version desconocida y procedimiento ausente.
            using (var cn = Abrir(Base))
                Exec(cn, "ALTER PROCEDURE " + Proc + " @Codigo nvarchar(100), @Categorias adm.CategoriaPctTipo READONLY AS BEGIN SET NOCOUNT ON; END;");
            var hOtra = Hash(Base);
            Check("V1 otra version: la migracion se niega sin sobrescribirla; los rollbacks tambien", "True|True|True|" + hOtra,
                  Correr(m84).Contains("no es la de sql/18 ni la de sql/33") + "|" + Correr(r18).Contains("no es la de sql/84") + "|" +
                  Correr(r33).Contains("no es la de sql/84") + "|" + Hash(Base));
            using (var cn = Abrir(Base)) Exec(cn, "DROP PROCEDURE " + Proc + ";");
            Check("V2 sin el procedimiento: se niega y no lo crea", "True|NULL", Correr(m84).Contains("falta " + Proc) + "|" + Uno(Base, "SELECT OBJECT_ID('" + Proc + "')"));

            // P: propiedad sobrante (rollback a medias) -> la migracion se niega.
            var b2 = "GestionAdminPrueba_S84b" + sello; bases.Add(b2);
            Preparar(b2);
            using (var cn = Abrir(b2))
                Exec(cn, "EXEC sys.sp_addextendedproperty @name = N'TicketsReduceAntes', @value = N'sql/18', @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'usp_GestionAdmin_TicketsReduce';");
            Check("P1 con TicketsReduceAntes ya puesta: se niega, sin tocar", "True|" + H18, Correr(b2, m84).Contains("ya tiene TicketsReduceAntes") + "|" + Hash(b2));

            // Q: sqlcmd -b -I como dice la cabecera.
            if (HaySqlcmd())
            {
                var b3 = "GestionAdminPrueba_S84q" + sello; bases.Add(b3);
                Preparar(b3);
                var tmpDir = Dir84;
                var q1 = Sqlcmd(b3, Path.Combine(tmpDir, "84_tickets_reduce_ceiling.sql"), "84");
                var q2 = Sqlcmd(b3, Path.Combine(tmpDir, "84_tickets_reduce_ceiling.sql"), "84");
                var q3 = Sqlcmd(b3, Path.Combine(tmpDir, "84_tickets_reduce_ceiling_rollback_a_18.sql"), "84R18");
                Check("Q1 sqlcmd -b -I: aplica (0), la segunda sale con error (1), el rollback a 18 (0)", "0|True|1|0|True|" + H18,
                      q1.Split('|')[0] + "|" + q1.Contains("APLICADA") + "|" + q2.Split('|')[0] + "|" + q3.Split('|')[0] + "|" + q3.Contains("DESHECHA") + "|" + Hash(b3));
            }
            else Console.WriteLine("SIN sqlcmd: Q no corrido (no se da por pasado)");
        }
        catch (Exception ex) { fallos++; Console.WriteLine("ERROR " + ex); }
        finally { foreach (var b in bases) try { Borrar(b); } catch (Exception) { } }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }
}
