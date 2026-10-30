// Prueba contra LocalDB de App_Code/HistorialPeticiones.cs
// (FuenteHistorialPeticionesSql), leyendo como la cuenta del sitio
// (PROACTIVANETAD, db_datareader).
//
//   T  sin tablas: nada disponible y sin error; solo sql/29: iniciativas si,
//      cambios no.
//   R  rango: desde incluido, hasta EXCLUIDO (el inicio del dia siguiente),
//      asi que una peticion a las 23:59:59 del ultimo dia entra y una a las
//      00:00:00 del dia siguiente no; total = filas.
//   K  tipo: INICIATIVA / CAMBIO / los dos; cada peticion una sola vez aunque
//      dbo.Problem tuviera el codigo repetido (OUTER APPLY TOP 1).
//   O  orden por fecha de ENVIO (no la de revision), mas reciente primero.
//   S  solo lectura: leer no cambia ninguna tabla.
//
// adm.SolicitudIniciativa sale del sql/29 real. adm.SolicitudCambio es una
// replica minima con las columnas que lee el historial (el sql/22 real
// necesita el backend de origen; su lectura de siempre la prueba
// SolicitudesCambioSqlLocalDbSmoke).
//
// Compilar: App_Code\*.cs en adm.dll y este archivo con /r:adm.dll
// /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz del repo.
using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

public static class HistorialPeticionesSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    static string Base;
    static int fallos = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (!ok) fallos++;
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
        using (var cn = Abrir(Base)) using (var c = new SqlCommand(sql, cn)) return Convert.ToString(c.ExecuteScalar());
    }
    static void Lotes(SqlConnection cn, string sql)
    {
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (lote.Trim().Length > 0) Exec(cn, lote);
    }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    static LecturaHistorial Leer(string desde, string hasta, string tipo)
    {
        var f = new FiltroHistorial { Tipo = tipo };
        if (desde != null) f.DesdeUtc = DateTime.SpecifyKind(DateTime.Parse(desde), DateTimeKind.Utc);
        if (hasta != null) f.HastaUtc = DateTime.SpecifyKind(DateTime.Parse(hasta), DateTimeKind.Utc);
        return new FuenteHistorialPeticionesSql(ComoSitio).Leer(f, HistorialPeticiones.Maximo);
    }
    static string Ids(LecturaHistorial l)
    {
        var j = HistorialPeticiones.Json(l, HistorialPeticiones.Maximo);
        var s = new List<string>();
        foreach (Dictionary<string, object> p in (List<object>)j["peticiones"]) s.Add((p["tipo"].ToString() == "CAMBIO" ? "C" : "I") + p["id"]);
        return string.Join(",", s.ToArray());
    }
    static string Ini(int n, string fecha)
    {
        return "INSERT adm.SolicitudIniciativa (NumeroSolicitud, Token, Estado, TipoIniciativa, ProductOwner, ServiceOwner, Categoria, Director, Titulo, " +
               "Descripcion, Observaciones, Volumetria, PctDisminucion, SolicitanteCuenta, SolicitanteNombre, SolicitanteCorreo, ProductOwnerCorreo, FuenteCorreos, FechaUtc) " +
               "VALUES (" + n + ", NEWID(), 'ENVIADA', N'PRB', N'PO', N'SO', N'/A/Cat', N'Dir', N'Titulo " + n + "', N'D', N'O', 10, 0.1, " +
               "N'SORIANA\\ana', N'Ana Lopez', N'ana@soriana.com', N'po@soriana.com', 'CATPERSONA', '" + fecha + "');";
    }
    static string Cam(string codigo, string fecha, string estado, string revision)
    {
        return "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, FechaSolicitudUtc, Estado, RevisadoPor, FechaRevisionUtc) " +
               "VALUES (N'" + codigo + "', 'OTROS', N'm', N'SORIANA\\t_mod', 'MOD', '" + fecha + "', '" + estado + "', " +
               (revision == null ? "NULL, NULL" : "N'SORIANA\\t_adm', '" + revision + "'") + ");";
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_Hist" + Environment.TickCount.ToString().Replace("-", "");
        try
        {
            Borrar(Base);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + Base + "]");
            using (var cn = Abrir(Base))
            {
                Lotes(cn, File.ReadAllText(Path.Combine("tools", "tests", "GestionAdminLocalDb_replica.sql")));
                Exec(cn, "IF SCHEMA_ID(N'adm') IS NULL EXEC (N'CREATE SCHEMA adm');");
                Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD];");
            }
            var l = Leer(null, null, null);
            Check("T1 sin tablas: nada disponible, sin error, vacio", "False|False|0", l.IniciativasDisponible + "|" + l.CambiosDisponible + "|" + l.Peticiones.Count);

            using (var cn = Abrir(Base)) Lotes(cn, File.ReadAllText(Path.Combine("sql", "29_solicitud_iniciativa.sql")));
            l = Leer(null, null, null);
            Check("T2 con sql/29: iniciativas si, cambios no", "True|False", l.IniciativasDisponible + "|" + l.CambiosDisponible);

            using (var cn = Abrir(Base))
            {
                Exec(cn, @"CREATE TABLE adm.SolicitudCambio (
                    IdSolicitud int IDENTITY(1,1) NOT NULL PRIMARY KEY, Codigo nvarchar(100) NOT NULL, Tipo varchar(10) NOT NULL,
                    Motivo nvarchar(4000) NOT NULL, SolicitadoPor nvarchar(256) NOT NULL, RolSolicitante varchar(3) NOT NULL,
                    FechaSolicitudUtc datetime2(0) NOT NULL DEFAULT (SYSUTCDATETIME()), Estado varchar(10) NOT NULL DEFAULT ('PENDIENTE'),
                    RevisadoPor nvarchar(256) NULL, FechaRevisionUtc datetime2(0) NULL);");
                // dbo.Problem: titulo del cambio; un codigo repetido a proposito
                // (si la replica lo permite) para probar que no duplica filas.
                var conPk = Uno("SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Problem') AND is_unique = 1");
                Exec(cn, "INSERT dbo.Problem (Codigo, Titulo) VALUES (N'PRB 2026-000001', N'Problema uno');");
                if (conPk == "0") Exec(cn, "INSERT dbo.Problem (Codigo, Titulo) VALUES (N'PRB 2026-000001', N'Problema uno (copia)');");
                // Dia 2026-10-02 en Mexico (UTC-6) = [2026-10-02T06:00Z, 2026-10-03T06:00Z).
                Exec(cn, Ini(1, "2026-10-02T05:59:59") + Ini(2, "2026-10-02T06:00:00") + Ini(3, "2026-10-03T05:59:59") + Ini(4, "2026-10-03T06:00:00"));
                Exec(cn, Cam("PRB 2026-000001", "2026-10-02T12:00:00", "PENDIENTE", null) +
                         Cam("PRB 2026-000001", "2026-10-01T12:00:00", "APLICADA", "2026-10-02T23:00:00") +
                         Cam("PRB 2099-999999", "2026-10-03T00:30:00", "RECHAZADA", "2026-10-04T00:00:00"));
            }
            var antes = Uno("SELECT CONCAT((SELECT COUNT(*) FROM adm.SolicitudIniciativa), '|', (SELECT COUNT(*) FROM adm.SolicitudCambio), '|', (SELECT COUNT(*) FROM dbo.Problem))");

            l = Leer(null, null, null);
            Check("O1 todo, mas reciente primero por fecha de ENVIO (C2 se reviso el 02 pero se envio el 01)",
                  "I4,I3,C3,C1,I2,I1,C2", Ids(l));
            Check("K1 cada peticion una vez y totales de la base", "7|4|3", l.Peticiones.Count + "|" + l.TotalIniciativas + "|" + l.TotalCambios);

            l = Leer("2026-10-02T06:00:00", "2026-10-03T06:00:00", null);
            Check("R1 un dia local: entran 06:00:00 y 05:59:59 del siguiente; quedan fuera 05:59:59 de antes y 06:00:00 del siguiente",
                  "I3|C3|C1|I2", Ids(l).Replace(",", "|"));
            Check("R2 totales del rango", "2|2", l.TotalIniciativas + "|" + l.TotalCambios);

            l = Leer("2026-10-02T06:00:00", "2026-10-03T06:00:00", "INICIATIVA");
            Check("K2 tipo INICIATIVA: solo iniciativas y total de cambios 0", "I3,I2|0", Ids(l) + "|" + l.TotalCambios);
            l = Leer(null, null, "CAMBIO");
            Check("K3 tipo CAMBIO: solo cambios", "C3,C1,C2|0", Ids(l) + "|" + l.TotalIniciativas);
            var c1 = l.Peticiones.Find(p => p.Id == 1);
            var c3 = l.Peticiones.Find(p => p.Id == 3);
            Check("K4 cambio: titulo de dbo.Problem; codigo sin Problem -> titulo vacio; cuenta y rol", "Problema uno|True|SORIANA\\t_mod|MOD|#1",
                  (c1.IniciativaTitulo ?? "").Replace(" (copia)", "") + "|" + (c3.IniciativaTitulo == null) + "|" + c1.SolicitanteCuenta + "|" + c1.RolSolicitante + "|" + c1.FolioTexto);
            l = Leer("2026-10-02T06:00:00", null, "INICIATIVA");
            var i3 = l.Peticiones.Find(p => p.Id == 3);
            Check("K5 iniciativa: folio, solicitante, titulo pedido, estado guardado, sin codigo (sin sql/32)", "#0000003|Ana Lopez|SORIANA\\ana|ana@soriana.com|Titulo 3|ENVIADA|True",
                  i3.FolioTexto + "|" + i3.SolicitanteNombre + "|" + i3.SolicitanteCuenta + "|" + i3.SolicitanteCorreo + "|" + i3.IniciativaTitulo + "|" + i3.Estado + "|" + (i3.IniciativaCodigo == null));
            l = Leer("2030-01-01T06:00:00", "2030-01-02T06:00:00", null);
            Check("R3 rango sin peticiones: vacio, sin error", "0|0", l.Peticiones.Count + "|" + (l.TotalIniciativas + l.TotalCambios));

            Check("S1 leer no cambio ninguna tabla", antes,
                  Uno("SELECT CONCAT((SELECT COUNT(*) FROM adm.SolicitudIniciativa), '|', (SELECT COUNT(*) FROM adm.SolicitudCambio), '|', (SELECT COUNT(*) FROM dbo.Problem))"));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); } catch (Exception) { }
        }
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
