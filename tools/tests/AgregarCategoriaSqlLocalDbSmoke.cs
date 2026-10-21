// Prueba de INTEGRACION del flujo "Modificar > agregar categoria" de ADM
// sobre la base como esta HOY en la VM (sql/18, 20, 21, 22 + permisos, 23 y
// 26; SIN sql/24), contra bases REALES pero DESECHABLES de SQL Server
// LocalDB: crea GestionAdminPrueba_AC<n>, corre los casos y la BORRA. Nunca
// toca la VM ni Tickets_Proactivanet.
//
// Por que existe (2026-10-21): en la VM "agregar una categoria y guardar"
// fallaba. La causa era el mismo borrador quitando la categoria padre
// (quitar exige sql/24 -> 409 PendienteSinRegla y no se guarda nada), no el
// contrato del procedimiento. Esto fija que agregar SI guarda en ese estado.
//
// Casos (prefijo del rotulo):
//   D  deteccion: sin sql/24 la edicion de PO / SO y quitar sigue apagada.
//   A  agregar con %, Clasificacion y Agrupacion (con tilde) como la cuenta
//      del sitio (EXECUTE AS PROACTIVANETAD, con su DENY): se guarda, con
//      fechas propias hoy / hoy + 15, y la iniciativa queda protegida.
//   Q  el mismo borrador con "quitar": el plan lo deja pendiente y el
//      escritor se niega (nada viaja, nada cambia).
//   V  VolumetriaTotalCategoria.Leer = VolumenCategoria / VolumenUltimos30
//      de dbo.vw_ProblemCategoria para una ruta ligada, y funciona para una
//      ruta sin ligar; como la cuenta del sitio.
//   T  TicketsReduce guardado = ROUND(VolumenUltimos30 x %), NO la meta en
//      tickets calculada con la volumetria total (la diferencia que la
//      pantalla avisa).
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.
// Requiere ../backend_admin_persistencia (vistas del backend); sin ella, NO
// CORRIDO (nunca "pasado").

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

public static class AgregarCategoriaSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Folio = "PRB 2026-000190";
    static string Base;
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, CultureInfo.InvariantCulture); var o = Convert.ToString(obtenido, CultureInfo.InvariantCulture);
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
            return v == null || v == DBNull.Value ? "NULL" : Convert.ToString(v, CultureInfo.InvariantCulture);
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

    static readonly string Tilde = "Adopci" + (char)0xF3 + "n";
    static readonly string Analisis = "En An" + (char)0xE1 + "lisis";

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
            foreach (var s in new[] { "18_gestion_admin_persistencia.sql", "20_gestion_admin_duenos.sql",
                                      "21_gestion_admin_agrupacion_acentos.sql", "22_solicitudes_cambio.sql" })
                Lotes(cn, Leer("sql", s));
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            Lotes(cn, Leer("sql", "22_solicitudes_cambio_permisos.sql"));
            Lotes(cn, Leer("sql", "23_cambios_recientes.sql"));
            Lotes(cn, Leer("sql", "26_gestion_admin_crear_volumetria.sql"));
            // La iniciativa de la captura del 2026-10-21: /S-Logistica al
            // 100% y se agrega una hija. Tickets: 12 de la hija (4 en los
            // ultimos 30 dias) y 3 del padre.
            var hoy = "DATEADD(HOUR, -6, SYSUTCDATETIME())";
            var tickets = new List<string>();
            for (var i = 0; i < 12; i++)
                tickets.Add("(N'T" + i + "', DATEADD(DAY, " + (i < 4 ? -i : -40 - i) + ", " + hoy + "), N'Incidente', N'/S-Logistica/FENIX WMS')");
            for (var i = 0; i < 3; i++)
                tickets.Add("(N'P" + i + "', DATEADD(DAY, -1, " + hoy + "), N'Incidente', N'/S-Logistica')");
            Exec(cn,
                "INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/S-Logistica', 1), (N'c2', N'/S-Logistica/FENIX WMS', 1);" +
                "INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaAnalisis) VALUES (N'" + Folio + "', N'Problem', N'Semilla', N'" + Analisis + "', '20261105');" +
                "INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES " +
                " (N'" + Folio + "', N'/S-Logistica', N'Problem', N'" + Tilde + "', 1.0000, 1);" +
                "INSERT dbo.Tickets (CodigoTicket, FechaRegistro, Tipo, Categoria) VALUES " + string.Join(", ", tickets.ToArray()) + ";");
        }
    }

    static string Intentar(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(CultureInfo.InvariantCulture); }
        catch (SqlException ex) { return "sql " + ex.Number + ": " + ex.Message; }
        catch (InvalidOperationException ex) { return "IOE:" + ex.Message; }
    }

    static void ComoSitio(Action<SqlConnection> a)
    {
        using (var cn = Abrir(Base))
        {
            Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
            a(cn);
        }
    }

    static string Fila(string ruta)
    {
        return Uno("SELECT CONCAT(CONVERT(varchar(20), PctDisminucion), '|', TipoIniciativa, '|', TipoAgrupado, '|', TicketsReduce, '|', " +
                   "CONVERT(char(10), FechaCreacionCategoria, 23), '|', CONVERT(char(10), FechaAnalisisCategoria, 23), '|', VigenteEnOrigen) " +
                   "FROM dbo.ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'" + ruta + "'");
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        Base = "GestionAdminPrueba_AC" + DateTime.UtcNow.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
        var hoy = new DateTime(2026, 10, 21);
        try
        {
            Preparar(Base);

            // ---------------- D: deteccion ----------------
            PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = null;
            PersistenciaGestionAdmin.OlvidarSql24ParaPruebas();
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                Check("D1 estado VM (23 + 26, sin 24): quitar / PO-SO apagados para la cuenta del sitio", "False", DeteccionSql24.Revisar(cn));
            }

            // ---------------- V: volumetria total ----------------
            List<object> vt = null;
            ComoSitio(cn => vt = VolumetriaTotalCategoria.Leer(cn, new[] { "/S-Logistica", " /S-Logistica/FENIX WMS ", "", "/No/Existe" }));
            Func<int, string, string> v = (i, k) => Convert.ToString(((Dictionary<string, object>)vt[i])[k] ?? "null", CultureInfo.InvariantCulture);
            Check("V1 ligada: total y ultimos 30 = VolumenCategoria / VolumenUltimos30 de la vista",
                Uno("SELECT TOP (1) CONCAT(VolumenCategoria, '|', VolumenUltimos30) FROM dbo.vw_ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'/S-Logistica'"),
                v(0, "volumetria") + "|" + v(0, "ultimos30"));
            Check("V2 sin ligar (la hija, con espacios): 12 en total, 4 en 30 dias; no es la del padre", "ok|12|4",
                v(1, "estado") + "|" + v(1, "volumetria") + "|" + v(1, "ultimos30"));
            Check("V3 vacia invalida; ruta sin tickets = cero real", "ruta_invalida|null|cero|0",
                v(2, "estado") + "|" + v(2, "volumetria") + "|" + v(3, "estado") + "|" + v(3, "volumetria"));

            // ---------------- Q: quitar sin sql/24 ----------------
            var actual = new IniciativaActual { Folio = Folio, Estado = Analisis, Titulo = "Semilla", FAnalisis = "2026-11-05", FSolucion = "", FCierre = "" };
            actual.Categorias.Add(new IniciativaActual.Categoria { Ruta = "/S-Logistica", Pct = 1.0m, Agrup = "Adopcion" });
            var f = new System.Collections.Specialized.NameValueCollection();
            f.Add("folio", Folio);
            f.Add("quitar_categoria", "/S-Logistica");
            f.Add("agregar_categoria", "/S-Logistica/FENIX WMS"); f.Add("agregar_pct", "50");
            f.Add("agregar_tipo_iniciativa", "Problem"); f.Add("agregar_tipo_agrupado", Tilde);
            var pet = PeticionModificarAdmin.DesdeFormulario(f);
            var r = new ResultadoGestionAdmin { Accion = "modificar", Folio = Folio };
            r.Cambio("quitar_categoria", "Quitar", "/S-Logistica", "");
            var planQ = PlanificadorGestionAdmin.Modificar(pet, actual, r, hoy);
            Check("Q1 la captura (quitar padre + agregar hija): el plan deja quitar pendiente (409 en el handler)", "1|True",
                planQ.Pendientes.Count + "|" + planQ.Pendientes[0].Contains("sql/24"));
            string q = null;
            ComoSitio(cn => q = Intentar(() => new EscritorGestionAdminSql().Modificar(cn, null, planQ, @"SORIANA\t_andresvr")));
            Check("Q2 el escritor se niega sin sql/24 y nada cambia", "True|1.0000|Adopci" + (char)0xF3 + "n|NULL",
                q.StartsWith("IOE:") + "|" + Uno("SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'/S-Logistica'") +
                "|" + Uno("SELECT TipoAgrupado FROM dbo.ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'/S-Logistica'") +
                "|" + Uno("SELECT Categoria FROM dbo.ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'/S-Logistica/FENIX WMS'"));

            // ---------------- A: agregar sin quitar ----------------
            var f2 = new System.Collections.Specialized.NameValueCollection();
            f2.Add("folio", Folio);
            f2.Add("agregar_categoria", "/S-Logistica/FENIX WMS"); f2.Add("agregar_pct", "50");
            f2.Add("agregar_tipo_iniciativa", "Problem"); f2.Add("agregar_tipo_agrupado", Tilde);
            var r2 = new ResultadoGestionAdmin { Accion = "modificar", Folio = Folio };
            r2.Cambio("agregar_categoria", "Agregar", "", "/S-Logistica/FENIX WMS");
            var plan = PlanificadorGestionAdmin.Modificar(PeticionModificarAdmin.DesdeFormulario(f2), actual, r2, hoy);
            string a = null;
            ComoSitio(cn => a = Intentar(() => new EscritorGestionAdminSql().Modificar(cn, null, plan, @"SORIANA\t_andresvr")));
            Check("A1 agregar (50%, Problem, Agrupacion con tilde) como la cuenta del sitio: se guarda", "0|sin error", plan.Pendientes.Count + "|" + a);
            Check("A2 la fila: % 0.5, tipos, TicketsReduce, fechas propias hoy / hoy + 15, vigente",
                "0.5000|Problem|" + Tilde + "|2|2026-10-21|2026-11-05|1", Fila("/S-Logistica/FENIX WMS"));
            Check("A3 la ligada no cambia; la iniciativa queda protegida y sellada", "1.0000|MODIFICACION|SORIANA\\t_andresvr",
                Uno("SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'/S-Logistica'") + "|" +
                Uno("SELECT CONCAT(Motivo, '|', UltimoCambioUsuario) FROM adm.IniciativaProtegida WHERE Codigo = N'" + Folio + "'"));

            // ---------------- T: TicketsReduce guardado ----------------
            // Meta en tickets: 6 de 12 (volumetria total) = 50%. La base guarda
            // ROUND(VolumenUltimos30 (4) x 0.5) = 2, no 6.
            Check("T1 TicketsReduce = ROUND(VolumenUltimos30 x %) = 2 (la meta en tickets sobre el total era 6)", "2|4",
                Uno("SELECT TicketsReduce FROM dbo.ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'/S-Logistica/FENIX WMS'") + "|" +
                Uno("SELECT TOP (1) VolumenUltimos30 FROM dbo.vw_ProblemCategoria WHERE Codigo = N'" + Folio + "' AND Categoria = N'/S-Logistica/FENIX WMS'"));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            PersistenciaGestionAdmin.OlvidarSql24ParaPruebas();
            try { Borrar(Base); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar " + Base + ": " + ex.Message + ")"); }
        }
        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO (" + pasados + ")" : fallos + " FALLO(S), " + pasados + " pasaron");
        return fallos == 0 ? 0 : 1;
    }
}
