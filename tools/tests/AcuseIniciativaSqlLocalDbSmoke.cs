// Prueba de INTEGRACION de sql/28_acuse_po_so.sql (+ _rollback) con
// App_Code/AcuseIniciativa.cs (AlmacenAcusesSql), contra una base REAL pero
// DESECHABLE de SQL Server LocalDB: crea GestionAdminPrueba_Acu<n> con la
// replica de dbo (tools/tests/GestionAdminLocalDb_replica.sql), el esquema
// adm y la cuenta del sitio como en la VM (db_datareader + db_datawriter +
// EXECUTE sobre adm); corre los casos y BORRA la base al final. Nunca toca
// la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base sin aprobar), deteccion antes/despues,
//      5 objetos y 9 DENY, volver a aplicar no toca nada.
//   R  registrar: nuevo, duplicado, PO/SO independientes, nuevo episodio
//      (otra fecha), fecha NULL, dueño o Estado cambiado (51305/51306), no
//      vigente / no existe (51304), rol / usuario / dueño invalidos;
//      dbo.Problem sin cambios; concurrencia (8 a la vez = 1 acuse).
//   P  cuenta del sitio: registra y lee por los procedimientos, NO escribe
//      las tablas a mano (229).
//   L  bandeja: no leidas por usuario, listar no marca, marcar 1 vez, 51307.
//   B  rollback: se niega con datos; con la bandera quita todo; reaplicar.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class AcuseIniciativaSqlLocalDbSmoke
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
        catch (ErrorAcuse ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }
    // Huella de la fila de dbo.Problem (todas las columnas).
    static string Huella(string codigo)
    {
        return Uno("SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', (SELECT * FROM dbo.Problem WHERE Codigo = N'" + codigo + "' FOR XML RAW, BINARY BASE64)), 1)");
    }
    static int Cuenta(string tabla) { return int.Parse(Uno("SELECT COUNT(*) FROM " + tabla)); }

    static AlmacenAcusesSql Sitio() { return new AlmacenAcusesSql(ComoSitio); }

    public static int Main()
    {
        Base = "GestionAdminPrueba_Acu" + Environment.TickCount.ToString().Replace("-", "");
        var guarda = "AcuseGuarda" + Environment.TickCount.ToString().Replace("-", "");
        var sql28 = Leer("sql", "28_acuse_po_so.sql");
        var rb28 = Leer("sql", "28_acuse_po_so_rollback.sql");
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
                Exec(cn, "DELETE FROM dbo.Problem;" +
                         "INSERT dbo.Problem (Codigo, Titulo, Estado, OwnerProblem, OwnerServicio, FechaAnalisis, FechaSolucion, FechaCierre, VigenteEnOrigen) VALUES " +
                         "(N'PRB 2026-000001', N'Uno', N'En Soluci" + "\u00f3" + "n', N'Jesus Campa Morones', N'Edgar Ramos Davalos', '2026-08-01', '2026-09-01', NULL, 1)," +
                         "(N'PRB 2026-000002', N'Dos', N'En An" + "\u00e1" + "lisis', N'Jesus Campa Morones', N'Otra', NULL, NULL, NULL, 1)," +
                         "(N'PRB 2026-000003', N'Tres', N'En Monitoreo', N'Jesus Campa Morones', N'Otra', NULL, NULL, '2026-09-15', 0);");
            }

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql28).Contains("SIN APROBAR") + "|" + LotesError(g, rb28).Contains("SIN APROBAR"));
            Borrar(guarda);
            Check("G2 deteccion antes de sql/28: no disponible (sin error)", false, Sitio().Disponible());
            using (var cn = Abrir(Base))
            {
                Check("G3 rollback antes de aplicar: se niega", true, LotesError(cn, rb28).Contains("0 de 5"));
                Lotes(cn, sql28);
            }
            Check("G4 aplicada: 5 objetos, 9 DENY de PROACTIVANETAD, UNIQUE de acuse y de notificacion", "5|9|2",
                  Uno("SELECT (CASE WHEN OBJECT_ID('adm.AcuseIniciativa') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.NotificacionAdm') IS NULL THEN 0 ELSE 1 END) " +
                      "+ (CASE WHEN OBJECT_ID('adm.NotificacionLectura') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.usp_Acuse_Registrar') IS NULL THEN 0 ELSE 1 END) " +
                      "+ (CASE WHEN OBJECT_ID('adm.usp_Notificacion_MarcarLeida') IS NULL THEN 0 ELSE 1 END)") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND state = 'D' " +
                      "AND major_id IN (OBJECT_ID('adm.AcuseIniciativa'), OBJECT_ID('adm.NotificacionAdm'), OBJECT_ID('adm.NotificacionLectura'))") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.key_constraints WHERE type = 'UQ' AND name IN ('UQ_AcuseIniciativa', 'UQ_NotificacionAdm_Acuse')"));
            Check("G5 deteccion despues (como el sitio): disponible", true, Sitio().Disponible());
            using (var cn = Abrir(Base))
                Check("G6 volver a aplicar: 'ya aplicada', no toca nada", true, LotesError(cn, sql28).Contains("ya aplicada"));

            // ---------------- R: registrar ----------------
            var h1 = Huella("PRB 2026-000001");
            var s = Sitio();
            var r1 = s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000001", "PO", "Jesus Campa Morones", "En Soluci\u00f3n");
            Check("R1 nuevo: acuse + 1 notificacion; fecha compromiso = FechaSolucion (Estado En Solucion)", "True|1|1|2026-09-01|CORREO_CANDIDATO",
                  r1.Nuevo + "|" + Cuenta("adm.AcuseIniciativa") + "|" + Cuenta("adm.NotificacionAdm") + "|" +
                  Uno("SELECT CONVERT(char(10), FechaCompromiso, 126) FROM adm.AcuseIniciativa") + "|" + Uno("SELECT FuenteIdentidad FROM adm.AcuseIniciativa"));
            var r2 = s.Registrar(@"SORIANA\JESUSCAMOR", "PRB 2026-000001", "PO", "Jesus Campa Morones", "En Soluci\u00f3n");
            Check("R2 duplicado (cuenta en otras mayusculas): mismo id, nuevo=false, sin otra notificacion", "False|" + r1.IdAcuse + "|1|1",
                  r2.Nuevo + "|" + r2.IdAcuse + "|" + Cuenta("adm.AcuseIniciativa") + "|" + Cuenta("adm.NotificacionAdm"));
            var r3 = s.Registrar(@"SORIANA\edgarrad", "PRB 2026-000001", "SO", "Edgar Ramos Davalos", "En Soluci\u00f3n");
            Check("R3 SO independiente: otro acuse y otra notificacion", "True|2|2", r3.Nuevo + "|" + Cuenta("adm.AcuseIniciativa") + "|" + Cuenta("adm.NotificacionAdm"));
            Check("R4 dbo.Problem no cambia (huella de toda la fila)", h1, Huella("PRB 2026-000001"));

            Check("R5 due\u00f1o cambiado (otro OwnerProblem): 51305 y nada nuevo", "51305|2",
                  Error(() => s.Registrar(@"SORIANA\x", "PRB 2026-000001", "PO", "Otra Persona", "En Soluci\u00f3n")) + "|" + Cuenta("adm.AcuseIniciativa"));
            Check("R6 Estado cambiado: 51306", "51306", Error(() => s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000001", "PO", "Jesus Campa Morones", "En Monitoreo")));
            Check("R7 no vigente / no existe: 51304", "51304|51304",
                  Error(() => s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000003", "PO", "Jesus Campa Morones", "En Monitoreo")) + "|" +
                  Error(() => s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-999999", "PO", "Jesus Campa Morones", "En Soluci\u00f3n")));
            Check("R8 sin usuario 51301; rol XX 51302; sin due\u00f1o 51303", "51301|51302|51303",
                  Error(() => s.Registrar("  ", "PRB 2026-000001", "PO", "Jesus Campa Morones", "En Soluci\u00f3n")) + "|" +
                  Error(() => s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000001", "XX", "Jesus Campa Morones", "En Soluci\u00f3n")) + "|" +
                  Error(() => s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000001", "PO", " ", "En Soluci\u00f3n")));
            using (var cn = Abrir(Base)) Exec(cn, "UPDATE dbo.Problem SET FechaSolucion = '2026-10-01' WHERE Codigo = N'PRB 2026-000001'");
            var r4 = s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000001", "PO", "Jesus Campa Morones", "En Soluci\u00f3n");
            Check("R9 nuevo episodio (otra fecha compromiso): se puede acusar otra vez", "True|3|3", r4.Nuevo + "|" + Cuenta("adm.AcuseIniciativa") + "|" + Cuenta("adm.NotificacionAdm"));
            var n1 = s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000002", "PO", "Jesus Campa Morones", "En An\u00e1lisis");
            var n2 = s.Registrar(@"SORIANA\jesuscamor", "PRB 2026-000002", "PO", "Jesus Campa Morones", "En An\u00e1lisis");
            Check("R10 fecha compromiso NULL (atrasada por categoria): un solo acuse", "True|False|NULL|4",
                  n1.Nuevo + "|" + n2.Nuevo + "|" + Uno("SELECT FechaCompromiso FROM adm.AcuseIniciativa WHERE Codigo = N'PRB 2026-000002'") + "|" + Cuenta("adm.AcuseIniciativa"));

            // Concurrencia: 8 envios del mismo episodio a la vez.
            using (var cn = Abrir(Base)) Exec(cn, "UPDATE dbo.Problem SET FechaSolucion = '2026-10-05' WHERE Codigo = N'PRB 2026-000001'");
            var nuevos = 0; var errores = new List<string>();
            var hilos = Enumerable.Range(0, 8).Select(k => new Thread(() =>
            {
                try
                {
                    if (Sitio().Registrar(@"SORIANA\edgarrad", "PRB 2026-000001", "SO", "Edgar Ramos Davalos", "En Soluci\u00f3n").Nuevo)
                        Interlocked.Increment(ref nuevos);
                }
                catch (Exception ex) { lock (errores) errores.Add(ex.Message); }
            })).ToList();
            hilos.ForEach(t => t.Start()); hilos.ForEach(t => t.Join());
            Check("R11 concurrencia: 8 a la vez -> 1 nuevo, 1 acuse y 1 notificacion de ese episodio, sin errores", "1|1|1|0",
                  nuevos + "|" + Uno("SELECT COUNT(*) FROM adm.AcuseIniciativa WHERE Rol = 'SO' AND FechaCompromiso = '2026-10-05'") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.NotificacionAdm n JOIN adm.AcuseIniciativa a ON a.IdAcuse = n.IdAcuse WHERE a.Rol = 'SO' AND a.FechaCompromiso = '2026-10-05'") + "|" + errores.Count);

            // ---------------- P: cuenta del sitio ----------------
            string directo;
            using (var cn = ComoSitio())
                directo = Error(() => Exec(cn, "INSERT adm.NotificacionLectura (IdNotificacion, Usuario) VALUES (1, N'falso')")) + "|" +
                          Error(() => Exec(cn, "UPDATE adm.AcuseIniciativa SET Cuenta = N'otro'")) + "|" +
                          Error(() => Exec(cn, "DELETE FROM adm.NotificacionAdm"));
            Check("P1 como PROACTIVANETAD NO escribe las tablas a mano (229)", "229|229|229", directo);
            // PRB 1: PO y SO del episodio 01/09, PO del 01/10 y SO del 05/10 (R11).
            Check("P2 como PROACTIVANETAD lee los acuses de una iniciativa (mas reciente primero)", "4|SO",
                  s.DeIniciativa("PRB 2026-000001").Count + "|" + s.DeIniciativa("PRB 2026-000001")[0].Rol);

            // ---------------- L: bandeja ----------------
            var total = Cuenta("adm.NotificacionAdm");
            var b1 = s.Bandeja(@"SORIANA\adm1", 50);
            var b1b = s.Bandeja(@"SORIANA\adm1", 50);
            Check("L1 todas no leidas; listar dos veces NO marca nada", total + "|" + total + "|" + total + "|0",
                  b1.NoLeidas + "|" + b1b.NoLeidas + "|" + b1.Notificaciones.Count + "|" + Cuenta("adm.NotificacionLectura"));
            var id0 = b1.Notificaciones[0].IdNotificacion;
            Check("L2 marcar: nueva, luego no; una sola fila", "True|False|1",
                  s.MarcarLeida(@"SORIANA\adm1", id0) + "|" + s.MarcarLeida(@"SORIANA\ADM1", id0) + "|" + Cuenta("adm.NotificacionLectura"));
            var b2 = s.Bandeja(@"SORIANA\adm1", 50);
            Check("L3 leida para ese ADM (hora puesta); otro ADM la sigue sin leer", (total - 1) + "|True|" + total,
                  b2.NoLeidas + "|" + b2.Notificaciones.First(n => n.IdNotificacion == id0).LeidaUtc.HasValue + "|" + s.Bandeja(@"SORIANA\adm2", 50).NoLeidas);
            Check("L4 limite: TOP n, no_leidas cuenta todas", "1|" + (total - 1), s.Bandeja(@"SORIANA\adm1", 1).Notificaciones.Count + "|" + s.Bandeja(@"SORIANA\adm1", 1).NoLeidas);
            Check("L5 notificacion inexistente: 51307; sin usuario: 51301", "51307|51301",
                  Error(() => s.MarcarLeida(@"SORIANA\adm1", 9999)) + "|" + Error(() => s.MarcarLeida(" ", id0)));

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                Check("B1 rollback con datos: se niega sin tocar nada", "True|5",
                      LotesError(cn, rb28).Contains("Se perderian") + "|" + Uno("SELECT COUNT(*) FROM sys.objects WHERE name IN ('AcuseIniciativa','NotificacionAdm','NotificacionLectura','usp_Acuse_Registrar','usp_Notificacion_MarcarLeida')"));
                Exec(cn, "EXEC sys.sp_set_session_context N'rollback_28_perder_acuses', N'SI';");
                Lotes(cn, rb28);
            }
            Check("B2 con la bandera: no queda ningun objeto; el sitio ve 'no disponible'; dbo.Problem intacto", "0|False|3",
                  Uno("SELECT COUNT(*) FROM sys.objects WHERE name IN ('AcuseIniciativa','NotificacionAdm','NotificacionLectura','usp_Acuse_Registrar','usp_Notificacion_MarcarLeida')") + "|" +
                  Sitio().Disponible() + "|" + Cuenta("dbo.Problem"));
            using (var cn = Abrir(Base)) Lotes(cn, sql28);
            Check("B3 reaplicar despues del rollback: limpio y disponible", "True|0", Sitio().Disponible() + "|" + Cuenta("adm.AcuseIniciativa"));
        }
        finally
        {
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("No se pudo borrar la base de prueba: " + ex.Message); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
