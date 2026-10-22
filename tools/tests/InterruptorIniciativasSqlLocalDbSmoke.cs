// Prueba de INTEGRACION de sql/30_interruptor_iniciativas.sql (+ _rollback)
// con App_Code/AccesoIniciativas.cs (FuenteInterruptoresSql y Leer) contra
// una base REAL pero DESECHABLE de SQL Server LocalDB: crea
// GestionAdminPrueba_Int<n> con el esquema adm y la cuenta del sitio como en
// la VM (db_datareader + db_datawriter + EXECUTE sobre adm); corre los casos
// y BORRA la base al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base sin aprobar), rollback antes de aplicar
//      se niega, tabla + fila APAGADA + 3 DENY, volver a aplicar no toca nada.
//   S  el sitio (EXECUTE AS PROACTIVANETAD) lee: recien aplicada = cerrado.
//   O  el operador con los UPDATE de la cabecera de sql/30 (texto exacto):
//      encender = abierto en la siguiente lectura, apagar = cerrado; solo
//      cambia esa fila y deja quien y cuando.
//   P  la cuenta del sitio NO puede encender, insertar ni borrar (229).
//   F  falla cerrado: sin fila, sin tabla (rollback), base inalcanzable.
//   B  rollback: quita la tabla; reaplicar vuelve APAGADO.
//
// Compilar: App_Code\*.cs en adm.dll y este archivo con /r:adm.dll
// /r:System.Data.dll; correr con cwd = raiz del repo.

using System;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

public static class InterruptorIniciativasSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
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
    static int Filas(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 }) return c.ExecuteNonQuery(); }
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
    static string ErrorSql(Action a)
    {
        try { a(); return "sin error"; }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    // Lo que decide el sitio: AccesoIniciativas.Leer con la fuente SQL como
    // PROACTIVANETAD. "abierto" / "cerrado" y, si hubo, el error registrado.
    static string Sitio()
    {
        string error = null;
        var v = AccesoIniciativas.Leer(new FuenteInterruptoresSql(ComoSitio), delegate (Exception ex) { error = ex.GetType().Name; });
        return (v ? "abierto" : "cerrado") + (error == null ? "" : "|" + error);
    }

    // Los dos UPDATE de la cabecera de sql/30, tal cual (la prueba usa el
    // texto que lee el operador, no una copia).
    static string Operacion(string sql30, string encendido)
    {
        var m = Regex.Match(sql30, @"UPDATE adm\.Interruptor\s+SET Encendido = " + encendido + @",[^;]*;");
        if (!m.Success) throw new InvalidOperationException("sql/30 no documenta el UPDATE Encendido = " + encendido);
        return m.Value;
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_Int" + Environment.TickCount.ToString().Replace("-", "");
        var guarda = "InterruptorGuarda" + Environment.TickCount.ToString().Replace("-", "");
        var sql30 = Leer("sql", "30_interruptor_iniciativas.sql");
        var rb30 = Leer("sql", "30_interruptor_iniciativas_rollback.sql");
        var encender = Operacion(sql30, "1");
        var apagar = Operacion(sql30, "0");
        try
        {
            Borrar(Base);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + Base + "]");
            using (var cn = Abrir(Base))
            {
                Exec(cn, "IF SCHEMA_ID(N'adm') IS NULL EXEC (N'CREATE SCHEMA adm');");
                Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD];");
                // Una tabla vecina de adm para comprobar que operar no la toca.
                Exec(cn, "CREATE TABLE adm.Vecina (Id int PRIMARY KEY, V nvarchar(10)); INSERT adm.Vecina VALUES (1, N'x'), (2, N'y');");
            }

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql30).Contains("SIN APROBAR") + "|" + LotesError(g, rb30).Contains("SIN APROBAR"));
            Borrar(guarda);
            Check("F1 antes de sql/30 (sin tabla): cerrado y el error se registra", "cerrado|SqlException", Sitio());
            using (var cn = Abrir(Base))
            {
                Check("G2 rollback antes de aplicar: se niega", true, LotesError(cn, rb30).Contains("no aplicada"));
                Lotes(cn, sql30);
            }
            Check("G3 aplicada: tabla, 1 fila APAGADA, 3 DENY de PROACTIVANETAD", "1|INICIATIVAS_ABIERTAS|0|3",
                  Uno("SELECT CASE WHEN OBJECT_ID('adm.Interruptor', 'U') IS NULL THEN 0 ELSE 1 END") + "|" +
                  Uno("SELECT STRING_AGG(Clave, ',') FROM adm.Interruptor") + "|" +
                  Uno("SELECT CONVERT(int, Encendido) FROM adm.Interruptor") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') " +
                      "AND state = 'D' AND major_id = OBJECT_ID('adm.Interruptor')"));
            using (var cn = Abrir(Base))
                Check("G4 volver a aplicar: 'ya aplicada', no toca nada", "True|1|0",
                      LotesError(cn, sql30).Contains("ya aplicada") + "|" + Uno("SELECT COUNT(*) FROM adm.Interruptor") + "|" +
                      Uno("SELECT CONVERT(int, Encendido) FROM adm.Interruptor"));
            Check("G5 CHECK de la clave: minusculas o simbolos se rechazan", "547|547",
                  ErrorSql(delegate { Exec("INSERT adm.Interruptor (Clave) VALUES ('otro_interruptor')"); }) + "|" +
                  ErrorSql(delegate { Exec("INSERT adm.Interruptor (Clave) VALUES ('X-Y')"); }));

            // ---------------- S: el sitio lee ----------------
            Check("S1 recien aplicada: cerrado (sin error)", "cerrado", Sitio());

            // ---------------- O: operador ----------------
            using (var cn = Abrir(Base))
                Check("O1 encender (UPDATE de la cabecera): 1 fila", 1, Filas(cn, encender));
            Check("O2 la siguiente lectura del sitio: abierto", "abierto", Sitio());
            Check("O3 deja quien y cuando; la tabla vecina intacta", "True|True|2",
                  (Uno("SELECT ModificadoPor FROM adm.Interruptor") == Uno("SELECT SUSER_SNAME()")) + "|" +
                  (Uno("SELECT CASE WHEN ModificadoUtc >= DATEADD(MINUTE, -5, SYSUTCDATETIME()) THEN 1 ELSE 0 END FROM adm.Interruptor") == "1") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.Vecina WHERE (Id = 1 AND V = N'x') OR (Id = 2 AND V = N'y')"));
            using (var cn = Abrir(Base))
                Check("O4 apagar (UPDATE de la cabecera): 1 fila", 1, Filas(cn, apagar));
            Check("O5 la siguiente lectura del sitio: cerrado", "cerrado", Sitio());

            // ---------------- P: la cuenta del sitio no lo cambia ----------------
            Check("P1 el sitio no puede encender, insertar ni borrar (229)", "229|229|229",
                  ErrorSql(delegate { using (var cn = ComoSitio()) Exec(cn, encender); }) + "|" +
                  ErrorSql(delegate { using (var cn = ComoSitio()) Exec(cn, "INSERT adm.Interruptor (Clave, Encendido) VALUES ('OTRO', 1)"); }) + "|" +
                  ErrorSql(delegate { using (var cn = ComoSitio()) Exec(cn, "DELETE adm.Interruptor"); }));
            Check("P2 ... y sigue cerrado", "cerrado|0", Sitio() + "|" + Uno("SELECT CONVERT(int, Encendido) FROM adm.Interruptor"));

            // ---------------- F: falla cerrado ----------------
            Exec("DELETE adm.Interruptor");
            Check("F2 sin fila: cerrado (sin error)", "cerrado", Sitio());
            Exec("INSERT adm.Interruptor (Clave, Encendido) VALUES ('INICIATIVAS_ABIERTAS', 1)");
            Check("F3 fila de vuelta encendida: abierto", "abierto", Sitio());
            {
                string error = null;
                var v = AccesoIniciativas.Leer(new FuenteInterruptoresSql(delegate
                {
                    return new SqlConnection(@"Server=(localdb)\NoExisteInterruptor;Integrated Security=true;Connect Timeout=2;");
                }), delegate (Exception ex) { error = ex.GetType().Name; });
                Check("F4 base inalcanzable: cerrado y el error se registra", "False|SqlException", v + "|" + error);
            }

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base)) Lotes(cn, rb30);
            Check("B1 rollback (con el interruptor encendido): sin tabla; vecina intacta", "0|2",
                  Uno("SELECT CASE WHEN OBJECT_ID('adm.Interruptor', 'U') IS NULL THEN 0 ELSE 1 END") + "|" + Uno("SELECT COUNT(*) FROM adm.Vecina"));
            Check("B2 sin tabla: el sitio queda cerrado (falla cerrado)", "cerrado|SqlException", Sitio());
            using (var cn = Abrir(Base)) Lotes(cn, sql30);
            Check("B3 reaplicar: vuelve APAGADO", "cerrado|0", Sitio() + "|" + Uno("SELECT CONVERT(int, Encendido) FROM adm.Interruptor"));
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

    static void Exec(string sql) { using (var cn = Abrir(Base)) Exec(cn, sql); }
}
