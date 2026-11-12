// tools/tests/ExpTicketsReduceCeilingSqlLocalDbSmoke.cs - prueba de
// INTEGRACION de sql/85_exp_tickets_reduce_ceiling.sql (+ _rollback) contra
// bases REALES pero DESECHABLES de SQL Server LocalDB (GestionAdminPrueba_S85*
// y S85Guarda*). Las crea, corre los casos y las BORRA. Nunca toca QA.
//
// LIMITE DECLARADO: el cuerpo real de dbo.usp_Exp_CalcularTicketsReduce
// (script 65) no esta en ningun repositorio. La prueba usa una REPLICA con
// la misma forma que dejaron ver los fragmentos de QA (S4/S5: #P con el %
// topado a 1, #Vol del SLOT 0 por ruta normalizada, DELETE + INSERT, la
// expresion ROUND exacta). Como la replica no es el texto de QA, la prueba
// reemplaza en los dos scripts las tres huellas de QA (hash normalizado,
// hash crudo, largo) por las de la replica ANTES de correrlos, y comprueba
// primero que esas huellas esten en los scripts. Asi se prueba la logica
// (guardas, transformacion, postcondicion, rollback exacto); que las
// huellas sean las de QA lo da el diagnostico S4, no esta prueba.
//
// Casos:
//   H  las huellas de QA estan, iguales, en migracion y rollback.
//   G  guarda: en una base que no es de prueba, sin aprobar / otra
//      aprobacion se niega; aprobada sin el procedimiento se niega.
//   R0 rollback antes de aplicar: 'no aplicada'.
//   V  version desconocida (un comentario de mas): se niega sin tocar;
//      sesion con QUOTED_IDENTIFIER distinto: se niega sin tocar.
//   A  aplicada: el texto es EXACTAMENTE el de antes con la expresion
//      cambiada, conserva permisos y opciones, no cambia datos; el ALTER no
//      recalcula; al correr, CEILING por iniciativa con tope, <= 0 y NULL;
//      otra vez: 'ya aplicada'.
//   B  rollback: hash crudo EXACTO del original, sin la propiedad, ROUND
//      otra vez, permisos conservados; otra vez 'no aplicada'; reaplicable;
//      con el procedimiento tocado despues de 85, el rollback se niega.
//   Q  sqlcmd -b -I (si esta en el PATH): aplica (0), la segunda sale 1.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /out:TrExp85.exe /r:System.dll /r:System.Data.dll tools\tests\ExpTicketsReduceCeilingSqlLocalDbSmoke.cs
//   TrExp85.exe

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

public static class ExpTicketsReduceCeiling85Prueba
{
    const string Instancia = @"(localdb)\MSSQLLocalDB";
    const string Proc = "dbo.usp_Exp_CalcularTicketsReduce";
    const string QaNorm = "0x46CAAC3F0F634A29C15E58A3168A4FF26467C98102C82FCBD56FBAC588DE6A82";
    const string QaCrudo = "0xBDF0894DA4DD356BF3ED1560792A43A42B7D71CF7C88C0BC4EA2173AA67384C8";
    const string QaLargo = "DECLARE @Largo   int           = 4153;";
    static int fallos, pasaron;

    static void Check(string titulo, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        if (e == o) { pasaron++; Console.WriteLine("PASS  " + titulo); }
        else { fallos++; Console.WriteLine("FAIL  " + titulo + "  esperado=" + e + "  obtenido=" + o); }
    }

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection("Server=" + Instancia + ";Integrated Security=true;Database=" + db + ";");
        cn.Open();
        return cn;
    }
    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn)) { c.CommandTimeout = 120; c.ExecuteNonQuery(); } }
    static string Uno(string db, string sql)
    {
        using (var cn = Abrir(db)) using (var c = new SqlCommand(sql, cn))
        { var v = c.ExecuteScalar(); return v == null || v is DBNull ? "NULL" : Convert.ToString(v); }
    }
    static IEnumerable<string> Lotes(string script)
    {
        foreach (var l in Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (l.Trim().Length > 0) yield return l;
    }
    // Corre un script por lotes en UNA conexion (SET NOEXEC sigue entre lotes).
    // -> 'sin error' + la primera celda de las filas que devolvio, o los errores.
    static string Correr(string db, string script, string antes)
    {
        var errores = new List<string>(); var celdas = new List<string>();
        using (var cn = Abrir(db))
        {
            if (antes != null) Exec(cn, antes);
            foreach (var lote in Lotes(script))
            {
                try
                {
                    using (var c = new SqlCommand(lote, cn)) using (var rd = c.ExecuteReader())
                        do { while (rd.Read()) for (int i = 0; i < rd.FieldCount; i++) if (rd.GetName(i) == "Resultado") celdas.Add(Convert.ToString(rd.GetValue(i))); }
                        while (rd.NextResult());
                }
                catch (SqlException ex) { errores.Add(ex.Message); }
            }
        }
        return errores.Count == 0 ? "sin error" + (celdas.Count > 0 ? ":" + string.Join(",", celdas) : "") : string.Join(" || ", errores);
    }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }

    // La replica (ver LIMITE DECLARADO). Expresion de redondeo identica a QA.
    const string Replica =
"\r\n/* =====================================================================================\r\n" +
"   2) El calculo (REPLICA de prueba, no el texto de QA)\r\n" +
"   ===================================================================================== */\r\n" +
"CREATE   PROCEDURE dbo.usp_Exp_CalcularTicketsReduce\r\n" +
"    @SoloSiNoHoy BIT = 0          -- 1: si ya hay un calculo de hoy, no hace nada\r\n" +
"AS\r\n" +
"BEGIN\r\n" +
"    SET NOCOUNT ON; SET XACT_ABORT ON;\r\n" +
"    DECLARE @Hoy DATE = CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())), @Ahora DATETIME2(0) = DATEADD(HOUR, -6, SYSUTCDATETIME());\r\n" +
"    IF @SoloSiNoHoy = 1 AND EXISTS (SELECT 1 FROM dbo.ExpTicketsReduce WHERE Hoy = @Hoy) RETURN 0;\r\n" +
"    BEGIN TRY\r\n" +
"        SELECT Ruta = s.[Categoria V2], N = SUM(s.[Total general]) INTO #Vol FROM dbo.vw_TBSlotCAT AS s WHERE s.Slot = 0 GROUP BY s.[Categoria V2];\r\n" +
"        SELECT pc.Codigo, pc.Categoria, Ruta = dbo.fn_NormalizaCategoria(pc.Categoria),\r\n" +
"               Pct = CASE WHEN pc.PctDisminucion > 1 THEN CONVERT(DECIMAL(9,4), 1) ELSE pc.PctDisminucion END,\r\n" +
"               Excel = pc.TicketsReduce\r\n" +
"        INTO #P FROM dbo.ProblemCategoria AS pc WHERE pc.VigenteEnOrigen = 1;\r\n" +
"        BEGIN TRANSACTION;\r\n" +
"        DELETE FROM dbo.ExpTicketsReduce;\r\n" +
"        INSERT INTO dbo.ExpTicketsReduce\r\n" +
"            (Codigo, Categoria, Ruta, Pct, Volumen30, TicketsReduce, TicketsReduceExcel, Hoy, FechaCalculo)\r\n" +
"        SELECT p.Codigo, p.Categoria, p.Ruta, p.Pct,\r\n" +
"               CONVERT(INT, ISNULL(v.N, 0)),\r\n" +
"               CASE WHEN p.Pct IS NULL THEN NULL\r\n" +
"                    WHEN p.Pct <= 0    THEN 0\r\n" +
"                    ELSE CONVERT(INT, ROUND(p.Pct * ISNULL(v.N, 0), 0)) END,\r\n" +
"               p.Excel, @Hoy, @Ahora\r\n" +
"        FROM #P AS p\r\n" +
"        LEFT JOIN #Vol AS v ON v.Ruta = p.Ruta;\r\n" +
"        COMMIT TRANSACTION;\r\n" +
"        SELECT Resultado = 'calculado', Filas = COUNT(*) FROM dbo.ExpTicketsReduce;\r\n" +
"    END TRY\r\n" +
"    BEGIN CATCH\r\n" +
"        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\r\n" +
"        THROW;\r\n" +
"    END CATCH;\r\n" +
"END;\r\n";

    // Casos de calculo: (codigo, ruta, %, volumen de la ruta en SLOT 0).
    static readonly object[][] Filas = {
        new object[] { "C01", "/T/V7a",  "0.9900", 7 },     // 6.93   -> ROUND 7  CEIL 7
        new object[] { "C02", "/T/V7b",  "0.0946", 7 },     // 0.6622 -> 1 / 1
        new object[] { "C03", "/T/V418", "0.1000", 418 },   // 41.8   -> 42 / 42
        new object[] { "C04", "/T/V1247","0.1250", 1247 },  // 155.875-> 156 / 156
        new object[] { "C05", "/T/V30",  "0.5000", 30 },    // 15     -> 15 / 15 (exacto)
        new object[] { "C06", "/T/V120", "0.2000", 120 },   // 24     -> 24 / 24 (exacto)
        new object[] { "C07", "/T/V7c",  "0.0500", 7 },     // 0.35   -> 0 / 1
        new object[] { "C08", "/T/V7d",  "0.0000", 7 },     // 0      -> 0 / 0
        new object[] { "C09", "/T/V0",   "0.5000", 0 },     // sin volumen -> 0 / 0
        new object[] { "C10", "/T/V7e",  "1.0000", 7 },     // 7 / 7
        new object[] { "C11", "/T/V7f",  "1.5000", 7 },     // topado a 1 -> 7 / 7
        new object[] { "C12", "/T/V7g",  "-0.1000", 7 },    // <= 0 -> 0 / 0
        new object[] { "C13", "/T/V7h",  null, 7 },         // sin % -> NULL / NULL
        new object[] { "C14", "/T/V7i",  "0.0700", 7 },     // 0.49   -> 0 / 1
        new object[] { "C15", "/T/V7j",  "0.0715", 7 },     // 0.5005 -> 1 / 1
    };
    const string RoundEsperado   = "7|1|42|156|15|24|0|0|0|7|7|0|NULL|0|1";
    const string CeilingEsperado = "7|1|42|156|15|24|1|0|0|7|7|0|NULL|1|1";

    static void Preparar(string db)
    {
        Borrar(db);
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + db + "]");
        using (var cn = Abrir(db))
        {
            Exec(cn, "CREATE TABLE dbo.ProblemCategoria (Codigo nvarchar(100) NOT NULL, Categoria nvarchar(450) NOT NULL, PctDisminucion decimal(9,4) NULL, TicketsReduce int NULL, VigenteEnOrigen bit NOT NULL DEFAULT 1);");
            Exec(cn, "CREATE TABLE dbo.ExpTicketsReduce (Codigo nvarchar(100) NOT NULL, Categoria nvarchar(450) NOT NULL, Ruta nvarchar(500) NULL, Pct decimal(9,4) NULL, Volumen30 int NOT NULL, TicketsReduce int NULL, TicketsReduceExcel int NULL, Hoy date NOT NULL, FechaCalculo datetime2(0) NOT NULL);");
            Exec(cn, "CREATE TABLE dbo.SlotDatos (Slot numeric(17,0) NOT NULL, Ruta nvarchar(500) NOT NULL, Total bigint NOT NULL);");
            Exec(cn, "CREATE VIEW dbo.vw_TBSlotCAT AS SELECT Slot, [Categoria V2] = Ruta, [Total general] = Total FROM dbo.SlotDatos;");
            Exec(cn, "CREATE FUNCTION dbo.fn_NormalizaCategoria (@s nvarchar(500)) RETURNS nvarchar(500) AS BEGIN RETURN LTRIM(RTRIM(@s)); END;");
            Exec(cn, "SET ANSI_NULLS ON;");
            using (var c = new SqlCommand("SET QUOTED_IDENTIFIER ON;", cn)) c.ExecuteNonQuery();
            Exec(cn, Replica);
            Exec(cn, "CREATE USER S85Etl WITHOUT LOGIN; GRANT EXECUTE ON dbo.usp_Exp_CalcularTicketsReduce TO S85Etl;");
            var sb = new StringBuilder();
            foreach (var f in Filas)
            {
                sb.Append("INSERT dbo.ProblemCategoria (Codigo, Categoria, PctDisminucion, TicketsReduce) VALUES (N'" + f[0] + "', N'" + f[1] + "', " +
                          (f[2] == null ? "NULL" : (string)f[2]) + ", 99);");
                if ((int)f[3] > 0) sb.Append("INSERT dbo.SlotDatos VALUES (0, N'" + f[1] + "', " + f[3] + ");");
            }
            sb.Append("INSERT dbo.SlotDatos VALUES (1, N'/T/V7a', 500);");   // otro slot: no cuenta
            Exec(cn, sb.ToString());
        }
    }
    static string Calcular(string db)
    {
        using (var cn = Abrir(db)) Exec(cn, "EXEC " + Proc + ";");
        return Uno(db, "SELECT STRING_AGG(ISNULL(CONVERT(varchar(10), TicketsReduce), 'NULL'), '|') WITHIN GROUP (ORDER BY Codigo) FROM dbo.ExpTicketsReduce");
    }
    static string Huellas(string db)
    {
        return Uno(db, "DECLARE @d nvarchar(max) = OBJECT_DEFINITION(OBJECT_ID('" + Proc + "')); " +
            "SELECT CONCAT(CONVERT(varchar(66), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(@d, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1), '|', " +
            "CONVERT(varchar(66), HASHBYTES('SHA2_256', @d), 1), '|', DATALENGTH(@d) / 2)");
    }
    static string Crudo(string db) { return Huellas(db).Split('|')[1]; }
    static string Marca(string db)
    {
        return Uno(db, "SELECT CONVERT(nvarchar(50), value) FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND major_id = OBJECT_ID('" + Proc + "') AND name = N'TicketsReduceRedondeo'");
    }
    static string Permiso(string db)
    {
        return Uno(db, "SELECT COUNT(*) FROM sys.database_permissions WHERE major_id = OBJECT_ID('" + Proc + "') AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'S85Etl') AND permission_name = N'EXECUTE' AND state = 'G'");
    }
    static string Opciones(string db)
    {
        return Uno(db, "SELECT CONCAT(uses_ansi_nulls, '|', uses_quoted_identifier) FROM sys.sql_modules WHERE object_id = OBJECT_ID('" + Proc + "')");
    }
    static string Datos(string db)
    {
        return Uno(db, "SELECT CONCAT((SELECT CHECKSUM_AGG(CHECKSUM(*)) FROM dbo.ExpTicketsReduce), '|', (SELECT COUNT(*) FROM dbo.ExpTicketsReduce), '|', " +
                       "(SELECT CHECKSUM_AGG(CHECKSUM(*)) FROM dbo.ProblemCategoria), '|', (SELECT COUNT(*) FROM dbo.ProblemCategoria))");
    }
    static string Definicion(string db) { return Uno(db, "SELECT OBJECT_DEFINITION(OBJECT_ID('" + Proc + "'))"); }
    static string Sqlcmd(string db, string archivo, string aprobacion, out int salida)
    {
        var psi = new ProcessStartInfo("sqlcmd", "-S \"" + Instancia + "\" -E -b -I -d " + db + " -i \"" + archivo + "\"")
        { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        // La aprobacion no hace falta en GestionAdminPrueba_*; se pasa igual en otra base.
        using (var p = Process.Start(psi)) { var o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd(); p.WaitForExit(); salida = p.ExitCode; return o; }
    }

    public static int Main(string[] args)
    {
        var dir = args.Length > 0 ? args[0] : "sql";
        var m85 = File.ReadAllText(Path.Combine(dir, "85_exp_tickets_reduce_ceiling.sql"));
        var r85 = File.ReadAllText(Path.Combine(dir, "85_exp_tickets_reduce_ceiling_rollback.sql"));
        var sello = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var db = "GestionAdminPrueba_S85" + sello;
        var guarda = "S85Guarda" + sello;
        try
        {
            Check("H1 las huellas de QA estan en la migracion y en el rollback (las mismas)", "True|True|True|True|True|True",
                  m85.Contains(QaNorm) + "|" + m85.Contains(QaCrudo) + "|" + m85.Contains(QaLargo) + "|" +
                  r85.Contains(QaNorm) + "|" + r85.Contains(QaCrudo) + "|" + r85.Contains(QaLargo));
            Check("H2 la expresion: ROUND -> CEILING, nada mas", "True|True",
                  m85.Contains("N'CONVERT(INT, ROUND(p.Pct * ISNULL(v.N, 0), 0))'") + "|" + m85.Contains("N'CONVERT(INT, CEILING(p.Pct * ISNULL(v.N, 0)))'"));

            // G: guarda, en una base que NO es de prueba.
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            Check("G1 sin aprobar: migracion y rollback se niegan", "True|True",
                  Correr(guarda, m85, null).Contains("SIN APROBAR") + "|" + Correr(guarda, r85, null).Contains("SIN APROBAR"));
            Check("G2 otra aprobacion (84) no sirve", true,
                  Correr(guarda, m85, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'84';").Contains("SIN APROBAR"));
            Check("G3 aprobada (85) sin el procedimiento: se niega, no lo crea", "True|NULL",
                  Correr(guarda, m85, "EXEC sys.sp_set_session_context N'aprobar_migracion', N'85';").Contains("falta dbo.usp_Exp_CalcularTicketsReduce") + "|" +
                  Uno(guarda, "SELECT OBJECT_ID('" + Proc + "')"));

            Preparar(db);
            var h = Huellas(db).Split('|');
            var mig = m85.Replace(QaNorm, h[0]).Replace(QaCrudo, h[1]).Replace(QaLargo, "DECLARE @Largo   int           = " + h[2] + ";");
            var rol = r85.Replace(QaNorm, h[0]).Replace(QaCrudo, h[1]).Replace(QaLargo, "DECLARE @Largo   int           = " + h[2] + ";");
            var original = Definicion(db);
            var crudo0 = h[1];

            Check("A0 replica antes de 85: ROUND", RoundEsperado, Calcular(db));
            Check("R0 rollback antes de aplicar: 'no aplicada', sin tocar", "True|" + crudo0,
                  Correr(db, rol, null).Contains("sql/85 no aplicada") + "|" + Crudo(db));

            // V: version desconocida y sesion con otras opciones.
            Check("V1 con QA sin la huella (otra version): se niega sin tocar", "True|" + crudo0,
                  Correr(db, m85, null).Contains("no es la version de QA") + "|" + Crudo(db));
            Check("V2 sesion con QUOTED_IDENTIFIER OFF: se niega sin tocar", "True|" + crudo0 + "|1|1",
                  Correr(db, "SET QUOTED_IDENTIFIER OFF;\r\nGO\r\n" + mig, null).Contains("QUOTED_IDENTIFIER") + "|" + Crudo(db) + "|" + Opciones(db));

            // A: aplicar.
            var datos0 = Datos(db);
            var a1 = Correr(db, mig, null);
            var esperadoTexto = original.Replace("CONVERT(INT, ROUND(p.Pct * ISNULL(v.N, 0), 0))", "CONVERT(INT, CEILING(p.Pct * ISNULL(v.N, 0)))");
            Check("A1 aplicada: texto EXACTO de antes con la expresion cambiada, marca, permiso, opciones, datos iguales",
                  "sin error:APLICADA|True|CEILING (sql/85)|1|1|1|" + datos0,
                  a1 + "|" + (Definicion(db) == esperadoTexto) + "|" + Marca(db) + "|" + Permiso(db) + "|" + Opciones(db) + "|" + Datos(db));
            Check("A2 el ALTER no recalcula: la foto sigue con ROUND hasta volver a correr", RoundEsperado,
                  Uno(db, "SELECT STRING_AGG(ISNULL(CONVERT(varchar(10), TicketsReduce), 'NULL'), '|') WITHIN GROUP (ORDER BY Codigo) FROM dbo.ExpTicketsReduce"));
            Check("A3 CEILING por iniciativa: 7x99%=7, 7x9.46%=1, 418x10%=42, 1247x12.5%=156, 30x50%=15, 120x20%=24, 7x5%=1, 7x0%=0, vol 0=0, 7x100%=7, 7x150%=7 (tope), -10%=0, sin %=NULL, 7x7%=1, 7x7.15%=1",
                  CeilingEsperado, Calcular(db));
            Check("A4 ningun resultado pasa del volumen de su ruta", "0",
                  Uno(db, "SELECT COUNT(*) FROM dbo.ExpTicketsReduce WHERE TicketsReduce > Volumen30"));
            Check("A5 otra vez: 'ya aplicada', sin tocar", "True|" + Crudo(db),
                  Correr(db, mig, null).Contains("ya aplicada") + "|" + Crudo(db));

            // B: rollback.
            Check("B1 rollback: hash crudo EXACTO del original, sin marca, permiso y opciones",
                  "sin error:DESHECHA|" + crudo0 + "|True|NULL|1|1|1",
                  Correr(db, rol, null) + "|" + Crudo(db) + "|" + (Definicion(db) == original) + "|" + Marca(db) + "|" + Permiso(db) + "|" + Opciones(db));
            Check("B2 tras el rollback vuelve ROUND", RoundEsperado, Calcular(db));
            Check("B3 rollback otra vez: 'no aplicada'", true, Correr(db, rol, null).Contains("sql/85 no aplicada"));
            Check("B4 se puede volver a aplicar", "sin error:APLICADA|" + CeilingEsperado, Correr(db, mig, null) + "|" + Calcular(db));
            using (var cn = Abrir(db))
            {
                var tocado = Definicion(db).Replace("SET NOCOUNT ON; SET XACT_ABORT ON;", "SET NOCOUNT ON; SET XACT_ABORT ON; -- tocado");
                var pos = tocado.IndexOf("CREATE", StringComparison.Ordinal);
                Exec(cn, tocado.Substring(0, pos) + "ALTER" + tocado.Substring(pos + 6));
            }
            var crudoTocado = Crudo(db);
            Check("B5 procedimiento tocado despues de 85: el rollback se niega sin tocar", "True|" + crudoTocado,
                  Correr(db, rol, null).Contains("no es el que dejo sql/85") + "|" + Crudo(db));

            // Q: sqlcmd -b -I sobre una base nueva.
            try
            {
                Preparar(db);
                h = Huellas(db).Split('|');
                var tmp = Path.Combine(Path.GetTempPath(), "s85_" + sello + ".sql");
                File.WriteAllText(tmp, m85.Replace(QaNorm, h[0]).Replace(QaCrudo, h[1]).Replace(QaLargo, "DECLARE @Largo   int           = " + h[2] + ";"));
                int s1, s2;
                var o1 = Sqlcmd(db, tmp, "85", out s1);
                var o2 = Sqlcmd(db, tmp, "85", out s2);
                File.Delete(tmp);
                Check("Q1 sqlcmd -b -I: aplica (0, APLICADA) y la segunda sale con error (1, ya aplicada)", "0|True|1|True",
                      s1 + "|" + o1.Contains("APLICADA") + "|" + s2 + "|" + o2.Contains("ya aplicada"));
            }
            catch (System.ComponentModel.Win32Exception) { Console.WriteLine("SKIP  Q1 sin sqlcmd en el PATH"); }
        }
        catch (Exception ex) { fallos++; Console.WriteLine("FAIL  excepcion: " + ex); }
        finally
        {
            try { Borrar(db); } catch { }
            try { Borrar(guarda); } catch { }
        }
        Console.WriteLine(pasaron + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }
}
