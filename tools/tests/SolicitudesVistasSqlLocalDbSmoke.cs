// Prueba de INTEGRACION de sql/39_solicitudes_vistas.sql (+ _rollback) con
// App_Code/SolicitudesVistas.cs (AlmacenVistasSql), contra una base REAL pero
// DESECHABLE de SQL Server LocalDB: crea GestionAdminPrueba_V39<n> con el
// esquema adm, la cuenta del sitio como en la VM (db_datareader +
// db_datawriter + EXECUTE sobre adm) y SOLO las columnas de sql/22 / sql/29
// que sql/39 lee (IdSolicitud / NumeroSolicitud y Estado); corre los casos y
// BORRA la base al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base sin aprobar), sin sql/22-29 se niega,
//      deteccion antes/despues, 2 objetos y 3 DENY, reaplicar no toca nada.
//   S  sin sql/39: pendientes de las dos colas, no_vistas null.
//   V  vistas: por usuario (mayusculas/espacios = el mismo), marcar no
//      cambia Estado, resolver deja de contar en las dos, idempotente,
//      51391/51392/51393, el sitio no escribe la tabla a mano (229).
//   B  rollback: quita todo; el resumen vuelve a no_vistas null; reaplicar.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

public static class SolicitudesVistasSqlLocalDbSmoke
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
    static void Exec(string sql) { using (var cn = Abrir(Base)) Exec(cn, sql); }
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
    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorVistaSolicitud ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    static AlmacenVistasSql Sitio() { return new AlmacenVistasSql(ComoSitio); }
    // pendientes|no_vistas|cambio.no_vistas|nuevas.no_vistas
    static string R(string usuario)
    {
        var r = Sitio().Resumen(usuario);
        return r.Pendientes + "|" + (r.NoVistas.HasValue ? r.NoVistas.Value.ToString() : "null") + "|" +
               (r.VistasDisponibles ? r.NoVistasCambio + "|" + r.NoVistasNuevas : "-|-");
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_V39" + Environment.TickCount.ToString().Replace("-", "");
        var guarda = "VistasGuarda" + Environment.TickCount.ToString().Replace("-", "");
        var sql39 = Leer("sql", "39_solicitudes_vistas.sql");
        var rb39 = Leer("sql", "39_solicitudes_vistas_rollback.sql");
        const string Ana = @"soriana\ana", Beto = @"soriana\beto";
        try
        {
            Borrar(Base);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + Base + "]");
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXEC (N'CREATE SCHEMA adm');");
                Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD];");
            }

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql39).Contains("SIN APROBAR") + "|" + LotesError(g, rb39).Contains("SIN APROBAR"));
            Borrar(guarda);
            using (var cn = Abrir(Base))
                Check("G2 sin sql/22 ni sql/29: se niega sin crear nada", "True|NULL",
                      LotesError(cn, sql39).Contains("falta sql/22") + "|" + Uno("SELECT OBJECT_ID(N'adm.SolicitudVista')"));
            Check("G3 resumen sin ninguna cola: 0 pendientes, sin error", "0|null|-|-", R(Ana));

            // Las columnas que sql/39 usa de sql/22 y sql/29 (mismos tipos).
            Exec("CREATE TABLE adm.SolicitudCambio (IdSolicitud int IDENTITY(1,1) NOT NULL PRIMARY KEY, Estado varchar(10) NOT NULL);" +
                 "CREATE TABLE adm.SolicitudIniciativa (NumeroSolicitud int NOT NULL PRIMARY KEY, Estado varchar(20) NOT NULL);" +
                 "INSERT adm.SolicitudCambio (Estado) VALUES ('PENDIENTE'), ('PENDIENTE'), ('APLICADA'), ('RECHAZADA');" +
                 "INSERT adm.SolicitudIniciativa (NumeroSolicitud, Estado) VALUES (1, 'ENVIADA'), (2, 'APROBADA');");

            // ---------------- S: sin sql/39 ----------------
            Check("S1 sin sql/39: 3 pendientes (2 cambio + 1 nueva), no_vistas null", "3|null|-|-", R(Ana));
            Check("S2 deteccion antes de sql/39: no disponible", false, Sitio().Disponible());

            using (var cn = Abrir(Base))
            {
                Check("G4 rollback antes de aplicar: se niega", true, LotesError(cn, rb39).Contains("0 de 2"));
                Lotes(cn, sql39);
            }
            Check("G5 aplicada: 2 objetos y 3 DENY de PROACTIVANETAD", "2|3",
                  Uno("SELECT (CASE WHEN OBJECT_ID('adm.SolicitudVista') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.usp_SolicitudVista_Marcar') IS NULL THEN 0 ELSE 1 END)") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND state = 'D' AND major_id = OBJECT_ID('adm.SolicitudVista')"));
            Check("G6 deteccion despues (como el sitio): disponible", true, Sitio().Disponible());
            using (var cn = Abrir(Base))
                Check("G7 volver a aplicar: 'ya aplicada', no toca nada", true, LotesError(cn, sql39).Contains("ya aplicada"));

            // ---------------- V: vistas por usuario ----------------
            var s = Sitio();
            Check("V1 nadie ha visto nada: 3 no vistas para Ana y para Beto", "3|3|2|1 3|3|2|1", R(Ana) + " " + R(Beto));
            Check("V2 Ana ve la #1 de cambio: primera vez", true, s.Marcar(@"SORIANA\Ana ", "CAMBIO", 1));
            Check("V3 otra vez (otras mayusculas): no es nueva, una sola fila", "False|1",
                  s.Marcar(Ana, "CAMBIO", 1) + "|" + Uno("SELECT COUNT(*) FROM adm.SolicitudVista"));
            Check("V4 Ana 2 no vistas; Beto sigue con 3", "3|2|1|1 3|3|2|1", R(Ana) + " " + R(Beto));
            Check("V5 marcar no cambia el Estado", "PENDIENTE", Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = 1"));
            s.Marcar(Ana, "CAMBIO", 2); s.Marcar(Ana, "NUEVA", 1);
            Check("V6 Ana vio las 3: pendientes 3, no vistas 0 (el punto)", "3|0|0|0", R(Ana));
            Exec("UPDATE adm.SolicitudCambio SET Estado = 'APLICADA' WHERE IdSolicitud = 2;" +
                 "UPDATE adm.SolicitudIniciativa SET Estado = 'RECHAZADA' WHERE NumeroSolicitud = 1;");
            Check("V7 se resuelven 2: no cuentan para nadie (vistas o no)", "1|0|0|0 1|1|1|0", R(Ana) + " " + R(Beto));
            Exec("INSERT adm.SolicitudCambio (Estado) VALUES ('PENDIENTE'); INSERT adm.SolicitudIniciativa VALUES (3, 'ENVIADA');");
            Check("V8 llegan 2 nuevas: Ana 2 no vistas de 3", "3|2|1|1", R(Ana));
            Check("V9 una resuelta tambien se puede marcar (no estorba al conteo)", "True|3|2", s.Marcar(Ana, "CAMBIO", 3) + "|" + R(Ana).Substring(0, 3));
            Check("V10 sin usuario 51391; tipo XX 51392; no existe 51393 (cambio y nueva)", "51391|51392|51393|51393",
                  Error(() => s.Marcar("  ", "CAMBIO", 1)) + "|" + Error(() => s.Marcar(Ana, "XX", 1)) + "|" +
                  Error(() => s.Marcar(Ana, "CAMBIO", 999)) + "|" + Error(() => s.Marcar(Ana, "NUEVA", 999)));
            Check("V11 resumen sin usuario: pendientes si, no vistas no (no se sabe quien)", "3|null|-|-", R(null));
            Check("V12 el sitio no escribe la tabla a mano: 229", "229", Error(() =>
            {
                using (var cn = ComoSitio()) Exec(cn, "INSERT adm.SolicitudVista (Tipo, IdSolicitud, Usuario) VALUES ('CAMBIO', 1, N'soriana\\beto')");
            }));
            Check("V13 la misma persona con espacios/mayusculas = una sola vista", "3|2|1|1", R(Ana));

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base)) Lotes(cn, rb39);
            Check("B1 rollback: sin objetos; el resumen vuelve a no_vistas null; Estados intactos", "NULL|NULL|3|null|-|-|PENDIENTE",
                  Uno("SELECT OBJECT_ID(N'adm.SolicitudVista')") + "|" + Uno("SELECT OBJECT_ID(N'adm.usp_SolicitudVista_Marcar')") + "|" + R(Ana) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = 1"));
            using (var cn = Abrir(Base)) Lotes(cn, sql39);
            Check("B2 reaplicar despues del rollback: todo pendiente vuelve a no visto", "3|3|2|1", R(Ana));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base de prueba: " + ex.Message + ")"); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron.");
        return fallos == 0 ? 0 : 1;
    }
}
