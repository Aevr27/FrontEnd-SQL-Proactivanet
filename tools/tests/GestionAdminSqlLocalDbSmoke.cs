// Prueba de INTEGRACION de sql/18_gestion_admin_persistencia.sql (diseno
// simplificado 2026-10-13: 0 tablas nuevas) con el escritor
// App_Code/EscritorGestionAdmin.cs, contra bases REALES pero DESECHABLES de
// SQL Server LocalDB: crea GestionAdminPrueba_<n>, aplica la replica
// (tools/tests/GestionAdminLocalDb_replica.sql), el cargador 174bb51 y la
// migracion, corre los casos y BORRA la base (y el login de prueba) al
// final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Tambien prueba los scripts del BACKEND que viven fuera de este repo
// (../backend_admin_persistencia: ADM_01 vw_ProblemCategoria, ADM_02
// vw_ProblemVencido, ADM_03 stub del cargador). Si esa carpeta no esta, esos
// casos se reportan como NO CORRIDOS (no como pasados).
//
// Lo que esto prueba es la migracion sobre una REPLICA: no hay
// trg_Problem_EstadoEvento (definicion no disponible), ni datos reales, y
// las funciones de categoria / nombres son stubs (ver la replica).
//
// Casos (prefijo del rotulo):
//   G  guardas: base con otro nombre, migracion repetida.
//   C  Codigo: siguiente del mayor (activo o no, mal formado legible, a mano),
//      anio, prefijo invalido, numero ilegible, desborde, concurrencia.
//   T  tipos / estado explicitos.
//   F  falla forzada a media alta: nada queda (ni historial ni numero).
//   D  fechas: iniciales heredan; ligada despues hoy/hoy+15; editar la
//      propia ('U', anterior crudo); editar la de una que hereda = la de la
//      iniciativa; la de la iniciativa no pisa las propias.
//   N  NroCambioFecha*.
//   K  tope 100%: exacto, reactivacion, agrupacion NULL, no agrupador,
//      concurrencia.
//   R  TicketsReduce.
//   H  lector C# del historial (HistorialFechas) y registro (fechas propias).
//   P  permisos con un login como el del sitio (datareader/datawriter +
//      EXECUTE dbo/adm) y sin EXECUTE en adm.
//   V  vistas del backend: semaforo de Experiencia y vencidas.
//   B  rollback de 18 (orden, datos, forzado).
//   S  stub del cargador y su rollback.
//
// Compilar (ver memoria csc): App_Code\*.cs + este archivo; correr con
// cwd = raiz del repo.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;

public static class GestionAdminSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    static int fallos = 0, noCorridas = 0;
    static string Base;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static void NoCorrida(string caso, string motivo)
    {
        noCorridas++;
        Console.WriteLine("NO CORRIDA  " + caso + " (" + motivo + ")");
    }

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection(Servidor + "Database=" + db + ";Pooling=false;");
        cn.Open();
        return cn;
    }

    static SqlConnection AbrirSql(string db, string login, string clave)
    {
        var cn = new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=" + db + ";User Id=" + login + ";Password=" + clave + ";Pooling=false;");
        cn.Open();
        return cn;
    }

    static void Lotes(SqlConnection cn, string sql)
    {
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (lote.Trim().Length > 0)
                using (var cmd = new SqlCommand(lote, cn) { CommandTimeout = 120 }) cmd.ExecuteNonQuery();
    }

    // Corre un script esperando que se niegue: devuelve el numero de error.
    static string LotesError(SqlConnection cn, string sql)
    {
        try { Lotes(cn, sql); return "sin error"; }
        catch (SqlException ex) { return ex.Number + ":" + ex.Message; }
        finally { using (var cmd = new SqlCommand("SET NOEXEC OFF; IF @@TRANCOUNT > 0 ROLLBACK;", cn)) cmd.ExecuteNonQuery(); }
    }

    static object Uno(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 120 }) { var v = cmd.ExecuteScalar(); return v == DBNull.Value ? null : v; }
    }

    static void Exec(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 120 }) cmd.ExecuteNonQuery();
    }

    static string Celda(object v)
    {
        if (v == null || v == DBNull.Value) return "NULL";
        if (v is DateTime) return ((DateTime)v).ToString("yyyy-MM-dd");
        if (v is bool) return (bool)v ? "1" : "0";
        return Convert.ToString(v, CultureInfo.InvariantCulture);
    }

    static string Filas(SqlConnection cn, string sql)
    {
        var salida = new List<string>();
        using (var cmd = new SqlCommand(sql, cn))
        using (var rd = cmd.ExecuteReader())
            while (rd.Read())
            {
                var partes = new List<string>();
                for (var i = 0; i < rd.FieldCount; i++) partes.Add(Celda(rd.GetValue(i)));
                salida.Add(string.Join("|", partes));
            }
        return string.Join(";", salida);
    }

    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static bool HayBackend() { return Directory.Exists(Backend); }
    static string LeerBackend(string archivo) { return File.ReadAllText(Path.Combine(Backend, archivo)); }

    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }

    static string HashDef(SqlConnection cn, string objeto)
    {
        return Celda(Uno(cn, "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(" +
            "OBJECT_DEFINITION(OBJECT_ID('" + objeto + "')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)"));
    }

    // ---------------------------------------------------------------------
    // Planes
    // ---------------------------------------------------------------------
    static PlanCrearAdmin AltaTipo(DateTime hoy, string prefijo, string agrup, string estado, params string[] rutaPct)
    {
        var p = new PeticionCrearAdmin
        {
            Tipo = prefijo, Titulo = "[PRUEBA] alta", TipoIniciativa = "Problem",
            TipoAgrupado = agrup, Estado = estado,
        };
        for (var i = 0; i < rutaPct.Length; i += 2) p.Categorias.Add(new PctCategoria { Categoria = rutaPct[i], Texto = rutaPct[i + 1] });
        return PlanificadorGestionAdmin.Crear(p, new ResultadoGestionAdmin { Accion = "crear" }, hoy);
    }

    static PlanCrearAdmin Alta(DateTime hoy, params string[] rutaPct)
    {
        return AltaTipo(hoy, "PRB", "Problem", "En Análisis", rutaPct);
    }

    static string Crear(SqlConnection cn, PlanCrearAdmin plan, string usuario = @"DOM\prueba")
    {
        return new EscritorGestionAdminSql().Crear(cn, null, plan, usuario);
    }

    static PlanModificarAdmin Mod(string codigo, DateTime hoy) { return new PlanModificarAdmin { Codigo = codigo, Hoy = hoy }; }

    static void Modificar(SqlConnection cn, PlanModificarAdmin plan, string usuario = @"DOM\prueba")
    {
        new EscritorGestionAdminSql().Modificar(cn, null, plan, usuario);
    }

    static CategoriaPlan Liga(string ruta, decimal? pct, string agrup = "Problem")
    {
        return new CategoriaPlan { Ruta = ruta, Pct = pct, TipoIniciativa = "Problem", TipoAgrupado = agrup };
    }

    // ---------------------------------------------------------------------
    // Base
    // ---------------------------------------------------------------------
    static readonly DateTime HoyReal = DateTime.UtcNow.AddHours(-6).Date;

    // Sin la carpeta del backend: lo minimo de dbo.vw_ProblemCategoria que
    // usan sql/18 (VolumenUltimos30) y los casos que no son V*.
    const string VistaStub = @"CREATE VIEW dbo.vw_ProblemCategoria AS
SELECT pc.Codigo, pc.Categoria, p.FechaAnalisis, pc.VigenteEnOrigen,
       VolumenUltimos30 = (SELECT COUNT_BIG(*) FROM dbo.Tickets AS t WHERE t.Categoria = pc.Categoria
                           AND t.FechaRegistro >= DATEADD(DAY, -30, DATEADD(HOUR, -6, SYSUTCDATETIME())))
FROM dbo.ProblemCategoria AS pc INNER JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo;";

    static void Sembrar(SqlConnection cn)
    {
        Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES
 (N'PRB', N'Problem', 1), (N'ADO', N'Adopcion', 1), (N'HAR', N'Hardware', 1), (N'SOR', N'SorIA', 1),
 (N'MAP', N'Mejora', 1), (N'REQ', N'Requerimiento', 0), (N'SEMC', N'Cuatro letras', 1);
INSERT dbo.Categorias (Id, RutaCompleta, Inactiva, VigenteEnOrigen)
SELECT CONVERT(nvarchar(10), ROW_NUMBER() OVER (ORDER BY r)), r, 0, 1
FROM (VALUES (N'/S/Cat 1'), (N'/S/Cat 2'), (N'/S/Cat 3'), (N'/S/Nueva'), (N'/S/Otra'), (N'/K/Cat 1'), (N'/C/Carrera'),
             (N'/T/Vol'), (N'/R/Reac'), (N'/N/Nulo'), (N'/N/Otra'), (N'/Q/Req'), (N'/F/Falla'), (N'/V/Vence'), (N'/V/Inicial'),
             (N'/D/Uno'), (N'/D/Dos'), (N'/D/Tres'), (N'/N/Solo'), (N'/P/Sitio 1'), (N'/P/Sitio 2'), (N'/P/Sitio 3')) AS v (r);
INSERT dbo.Categorias (Id, RutaCompleta, Inactiva, VigenteEnOrigen) VALUES (N'99', N'/X/Vieja', 1, 0);
-- Lo que ya trae el Excel (valores existentes de Estado / tipos).
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaCreacion, FechaAnalisis, VigenteEnOrigen) VALUES
 (N'PRB 2026-000005', N'Problem',  N'Excel 5',  N'En Análisis',  '2026-09-01', '2026-09-16', 1),
 (N'PRB 2026-000009', N'Problem',  N'Excel 9 inactiva', N'Cerrado', '2026-09-05', '2026-09-20', 0),
 (N'PRB 2026-00012',  N'Mejora',   N'Excel 12 mal formado', N'Cerrado', '2026-09-06', NULL, 1),
 (N'ADO 2026-00A001', N'Adopción', N'Excel ilegible', N'Cerrado', '2026-09-06', NULL, 1),
 (N'HAR 2026-999999', N'Problem',  N'Excel tope', N'Cerrado', '2026-09-06', NULL, 1),
 (N'ADO 2025-000001', N'Adopción', N'Excel K', N'En Análisis', '2025-09-01', '2025-09-16', 1),
 (N'SOR 2026-000001', N'Problem',  N'Excel cerrada', N'Cerrado', '2026-09-01', '2026-09-16', 1),
 (N'MAP 2026-000001', N'Mejora',   N'Excel viva', N'En Solución', '2026-09-01', '2026-09-16', 1),
 (N'PRB 2025-000100', N'Problem',  N'Excel sin agrupacion', N'En Solución', '2025-09-01', '2025-09-16', 1),
 (N'REQ 2026-000001', N'Problem',  N'Excel req', N'En Monitoreo', '2026-09-01', '2026-09-16', 1);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion) VALUES
 (N'PRB 2026-000005', N'/S/Otra',   N'Problem', N'Problem', 0.0000),
 (N'ADO 2025-000001', N'/K/Cat 1',  N'Adopción', N'Adopcion', 0.6000),
 (N'SOR 2026-000001', N'/R/Reac',   N'Problem', N'SorIA', 0.7000),
 (N'MAP 2026-000001', N'/R/Reac',   N'Mejora', N'Mejora', 0.5000),
 (N'PRB 2025-000100', N'/N/Nulo',   N'Problem', NULL, 0.1000),
 (N'PRB 2025-000100', N'/N/Otra',   N'Problem', N'Problem', 0.1000),
 (N'REQ 2026-000001', N'/Q/Req',    N'Problem', N'Requerimiento', 0.9000),
 (N'MAP 2026-000001', N'/N/Solo',   N'Mejora', NULL, 0.7000);   -- viva y SIN agrupacion
-- 93 tickets de /T/Vol en los ultimos 30 dias y 10 viejos (no cuentan).
INSERT dbo.Tickets (CodigoTicket, FechaRegistro, Tipo, Categoria)
SELECT N'T' + CONVERT(nvarchar(10), n), DATEADD(DAY, CASE WHEN n <= 93 THEN -2 ELSE -60 END, SYSUTCDATETIME()), N'Incidencia', N'/T/Vol'
FROM (SELECT TOP (103) n = ROW_NUMBER() OVER (ORDER BY (SELECT 1)) FROM sys.all_objects) AS x;");
    }

    static void Preparar(string db)
    {
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + db + "]");
        using (var cn = Abrir(db))
        {
            Lotes(cn, Leer("tools", "tests", "GestionAdminLocalDb_replica.sql"));
            Lotes(cn, Leer("tools", "tests", "usp_CargarExperiencia_174bb51.sql"));
            // Las vistas del backend, tal cual su origen (fuera de este repo publico).
            if (HayBackend())
            {
                Lotes(cn, LeerBackend(Path.Combine("_origen", "vw_ProblemCategoria_38.sql")));
                Lotes(cn, LeerBackend(Path.Combine("_origen", "vw_ProblemVencido_26.sql")));
            }
            else
                Lotes(cn, VistaStub);
            Sembrar(cn);
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia.sql"));
        }
    }

    // =====================================================================
    public static int Main()
    {
        Base = "GestionAdminPrueba_" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var login = "GestionAdminSitio_" + DateTime.UtcNow.ToString("HHmmssfff");
        var loginSinAdm = login + "_x";
        var clave = "Gp!" + Guid.NewGuid().ToString("N");
        var hoy = new DateTime(2026, 10, 13);
        try
        {
            using (var m = Abrir("master"))
            {
                Console.WriteLine("LocalDB " + Uno(m, "SELECT CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion'))") + " -> " + Base);
                // G1: en una base que no es de prueba (master) y sin aprobacion, no corre.
                var g1 = LotesError(m, Leer("sql", "18_gestion_admin_persistencia.sql"));
                Check("G1 la migracion no corre fuera de GestionAdminPrueba_* sin aprobacion", "True|0",
                      g1.Contains("SIN APROBAR") + "|" + Uno(m, "SELECT COUNT(*) FROM sys.schemas WHERE name = N'adm'"));
            }
            Preparar(Base);
            using (var cn = Abrir(Base))
            {
                Check("G2 aplicada: columnas, FK compuesta, CHECK de nivel, trigger, 4 procedimientos, 0 tablas en adm",
                      "1|1|1|1|1|4|0|2",
                      Filas(cn, "SELECT CASE WHEN COL_LENGTH('dbo.ProblemCategoria','FechaAnalisisCategoria') IS NULL THEN 0 ELSE 1 END, " +
                                "CASE WHEN COL_LENGTH('dbo.ProblemFechaEvento','Categoria') IS NULL THEN 0 ELSE 1 END, " +
                                "CASE WHEN OBJECT_ID('dbo.FK_ProblemFechaEvento_ProblemCategoria','F') IS NULL THEN 0 ELSE 1 END, " +
                                "CASE WHEN OBJECT_ID('dbo.CK_ProblemFechaEvento_Nivel','C') IS NULL THEN 0 ELSE 1 END, " +
                                "CASE WHEN OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento','TR') IS NULL THEN 0 ELSE 1 END, " +
                                "(SELECT COUNT(*) FROM sys.procedures WHERE schema_id = SCHEMA_ID('adm')), " +
                                "(SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID('adm')), " +
                                "(SELECT COUNT(*) FROM sys.types WHERE schema_id = SCHEMA_ID('adm'))"));
                Check("G3 collation de ProblemFechaEvento.Categoria = la de ProblemCategoria.Categoria", "1",
                      Uno(cn, "SELECT CASE WHEN (SELECT collation_name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProblemFechaEvento') AND name = 'Categoria') " +
                              "= (SELECT collation_name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProblemCategoria') AND name = 'Categoria') THEN 1 ELSE 0 END"));
                Check("G4 los eventos existentes (Categoria NULL) pasan la FK compuesta y el CHECK: siguen todos", "0",
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Categoria IS NOT NULL"));
                var g5 = LotesError(cn, Leer("sql", "18_gestion_admin_persistencia.sql"));
                Check("G5 correrla otra vez se niega sin tocar nada", "True", g5.Contains("ya aplicada"));
                Check("G6 FK compuesta: un evento de categoria inexistente se rechaza (547)", "547",
                      Error(() => Exec(cn, "INSERT dbo.ProblemFechaEvento (Codigo, Categoria, Campo, FechaNueva, Operacion, Origen) " +
                                           "VALUES (N'PRB 2026-000005', N'/No/Existe', 'FechaAnalisis', '2026-10-01', 'I', 'NO_DECLARADO')")));
                Check("G7 CHECK de nivel: un evento de categoria de FechaCierre se rechaza (547)", "547",
                      Error(() => Exec(cn, "INSERT dbo.ProblemFechaEvento (Codigo, Categoria, Campo, FechaNueva, Operacion, Origen) " +
                                           "VALUES (N'PRB 2026-000005', N'/S/Otra', 'FechaCierre', '2026-10-01', 'I', 'NO_DECLARADO')")));

                // ---------------- C: Codigo ----------------
                string c1 = null;
                Check("C1 alta: sin error", "sin error", Error(() => c1 = Crear(cn, Alta(hoy, "/S/Cat 1", "30", "/S/Cat 2", "20"))));
                Check("C2 siguiente del mayor: 000005 activo, 000009 inactivo, '00012' mal formado legible -> 000013", "PRB 2026-000013", c1);
                Check("C3 la siguiente es 000014", "PRB 2026-000014", Crear(cn, Alta(hoy, "/S/Cat 3", "")));
                Exec(cn, "INSERT dbo.Problem (Codigo, Titulo, Estado) VALUES (N'PRB 2026-000500', N'a mano', N'Cerrado')");
                Check("C4 codigo tecleado a mano (000500): la siguiente es 000501", "PRB 2026-000501", Crear(cn, Alta(hoy)));
                Check("C5 otro anio (FechaCreacion 2027-01-02): empieza en 000001", "PRB 2027-000001", Crear(cn, Alta(new DateTime(2027, 1, 2))));
                Check("C6 prefijo de cuatro letras del catalogo (SEMC): 51021", "51021", Error(() => Crear(cn, AltaTipo(hoy, "SEMC", "Problem", "En Análisis"))));
                Check("C7 prefijo fuera del catalogo (XYZ): 51002", "51002", Error(() => Crear(cn, AltaTipo(hoy, "XYZ", "Problem", "En Análisis"))));
                Check("C8 codigo del mismo prefijo/anio con numero ilegible (ADO 2026-00A001): 51023", "51023",
                      Error(() => Crear(cn, AltaTipo(hoy, "ADO", "Adopcion", "En Análisis"))));
                Check("C9 desborde (HAR 2026-999999): 51022", "51022", Error(() => Crear(cn, AltaTipo(hoy, "HAR", "Problem", "En Análisis"))));
                Check("C10 ninguno de los rechazados dejo filas", "0",
                      Uno(cn, "SELECT COUNT(*) FROM dbo.Problem WHERE Codigo LIKE N'ADO 2026-0000%' OR Codigo LIKE N'HAR 2026-0%' OR Codigo LIKE N'SEMC%'"));
                Check("C11 el procedimiento de Modificar no tiene parametro de Codigo nuevo ni de FechaCreacion", "1|0",
                      Filas(cn, "SELECT SUM(CASE WHEN name = '@Codigo' THEN 1 ELSE 0 END), SUM(CASE WHEN name LIKE '%Creacion%' OR name LIKE '%CodigoNuevo%' THEN 1 ELSE 0 END) " +
                                "FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')"));

                // C12: dos altas simultaneas del mismo prefijo/anio -> codigos distintos.
                string codA = null, codB = null, errB = null;
                bool espero;
                using (var cnA = Abrir(Base))
                using (var cnB = Abrir(Base))
                {
                    var txA = cnA.BeginTransaction();
                    codA = new EscritorGestionAdminSql().Crear(cnA, txA, Alta(hoy, "/C/Carrera", "10"), @"DOM\a");
                    var hilo = new Thread(() =>
                    {
                        try { codB = Crear(cnB, Alta(hoy, "/S/Nueva", "10"), @"DOM\b"); }
                        catch (Exception ex) { errB = ex.Message; }
                    });
                    hilo.Start();
                    espero = !hilo.Join(2000);
                    txA.Commit();
                    hilo.Join(30000);
                }
                Check("C12 concurrencia: la 2a alta espera el candado del Codigo y sale con el siguiente", "True|PRB 2026-000502|PRB 2026-000503|",
                      espero + "|" + codA + "|" + codB + "|" + errB);

                // ---------------- T: tipos y estado OPCIONALES (validados si vienen) ----------------
                var sinNada = AltaTipo(hoy, "PRB", null, null, "/S/Cat 3", "5");
                sinNada.TipoIniciativa = null;
                string cSin = null;
                Check("T1 alta sin Clasificacion, Agrupacion ni Estado: se crea (Admin crea cuando falta informacion)", "sin error",
                      Error(() => cSin = Crear(cn, sinNada)));
                Check("T1b quedan NULL (no se derivan del prefijo), en el Problem y en su categoria", "NULL|NULL|NULL|NULL",
                      Filas(cn, "SELECT p.TipoIniciativa, p.Estado, pc.TipoIniciativa, pc.TipoAgrupado FROM dbo.Problem AS p " +
                                "JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = p.Codigo WHERE p.Codigo = N'" + cSin + "'"));
                Check("T2 Agrupacion que no existe: 51012", "51012", Error(() => Crear(cn, AltaTipo(hoy, "PRB", "Inventada", "En Análisis"))));
                var tipoMalo = Alta(hoy); tipoMalo.TipoIniciativa = "Inventado";
                Check("T3 TipoIniciativa que no existe: 51011", "51011", Error(() => Crear(cn, tipoMalo)));
                Check("T4 Estado que no existe: 51013", "51013", Error(() => Crear(cn, AltaTipo(hoy, "PRB", "Problem", "Inventado"))));
                Check("T5 categoria fuera del catalogo vigente (/X/Vieja): 51015", "51015", Error(() => Crear(cn, Alta(hoy, "/X/Vieja", "5"))));
                var liSinTipo = Mod(c1, hoy); liSinTipo.Agregar.Add(new CategoriaPlan { Ruta = "/S/Cat 3", Pct = 0.05m });
                Check("T6 ligar sin tipos: se liga con NULL (no se copian de las hermanas)", "sin error|NULL|NULL",
                      Error(() => Modificar(cn, liSinTipo)) + "|" +
                      Filas(cn, "SELECT TipoIniciativa, TipoAgrupado FROM dbo.ProblemCategoria WHERE Codigo = N'" + c1 + "' AND Categoria = N'/S/Cat 3'"));
                Check("T7 nada de T2-T5 quedo escrito", "0",
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Categoria = N'/X/Vieja'"));

                // ---------------- F: falla forzada a media alta ----------------
                var antesF = Filas(cn, "SELECT COUNT(*), (SELECT COUNT(*) FROM dbo.ProblemFechaEvento), (SELECT COUNT(*) FROM dbo.ProblemCategoria) FROM dbo.Problem");
                Exec(cn, "ALTER TABLE dbo.ProblemCategoria ADD CONSTRAINT CK_Prueba_Falla CHECK (Categoria <> N'/F/Falla')");
                Check("F1 alta cuya 2a categoria falla DESPUES de insertar el Problem: error", "547",
                      Error(() => Crear(cn, Alta(hoy, "/S/Cat 1", "1", "/F/Falla", "1"))));
                Exec(cn, "ALTER TABLE dbo.ProblemCategoria DROP CONSTRAINT CK_Prueba_Falla");
                Check("F2 rollback completo: mismas filas en Problem, eventos y categorias", antesF,
                      Filas(cn, "SELECT COUNT(*), (SELECT COUNT(*) FROM dbo.ProblemFechaEvento), (SELECT COUNT(*) FROM dbo.ProblemCategoria) FROM dbo.Problem"));
                Check("F3 el numero no se consumio: la siguiente alta es 000505 (000504 = T1)", "PRB 2026-000505", Crear(cn, Alta(hoy, "/S/Cat 1", "1")));
                Check("F4 la sesion quedo sin atribucion (SESSION_CONTEXT limpio)", "NULL|NULL",
                      Filas(cn, "SELECT CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen')), CONVERT(nvarchar(50), SESSION_CONTEXT(N'pfe_usuario'))"));

                // ---------------- D: fechas ----------------
                var alta = Alta(hoy, "/D/Uno", "10", "/D/Dos", "10");
                alta.FechaEntregaAnalisis = new DateTime(2026, 10, 20);
                var cd = Crear(cn, alta);
                Check("D1 alta: creacion hoy, analisis hoy+15, entrega la del formulario, vigente, contadores 0",
                      "2026-10-13|2026-10-28|2026-10-20|1|0|0|0",
                      Filas(cn, "SELECT FechaCreacion, FechaAnalisis, FechaEntregaAnalisis, VigenteEnOrigen, NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre FROM dbo.Problem WHERE Codigo = N'" + cd + "'"));
                Check("D2 FechaEntregaAnalisis por omision = hoy", "2026-10-13",
                      Celda(Uno(cn, "SELECT FechaEntregaAnalisis FROM dbo.Problem WHERE Codigo = N'" + c1 + "'")));
                Check("D3 iniciales heredan (sin fechas propias), vigentes y con los tipos declarados",
                      "/D/Dos|NULL|NULL|1|Problem|Problem;/D/Uno|NULL|NULL|1|Problem|Problem",
                      Filas(cn, "SELECT Categoria, FechaCreacionCategoria, FechaAnalisisCategoria, VigenteEnOrigen, TipoIniciativa, TipoAgrupado FROM dbo.ProblemCategoria WHERE Codigo = N'" + cd + "' ORDER BY Categoria"));
                Check("D4 historial del alta: 'I' de FechaAnalisis de la iniciativa, ADMIN, con usuario; ninguno de categoria",
                      "NULL|FechaAnalisis|NULL|2026-10-28|I|ADMIN|DOM\\prueba",
                      Filas(cn, "SELECT Categoria, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cd + "'"));
                var liga = Mod(cd, new DateTime(2026, 11, 2));
                liga.Agregar.Add(Liga("/D/Tres", 0.05m));
                Modificar(cn, liga);
                Check("D5 ligada despues: fechas propias 11-02 / 11-17; las de la iniciativa y las iniciales intactas",
                      "2026-10-13|2026-10-28;/D/Dos|NULL|NULL;/D/Tres|2026-11-02|2026-11-17;/D/Uno|NULL|NULL",
                      Filas(cn, "SELECT FechaCreacion, FechaAnalisis FROM dbo.Problem WHERE Codigo = N'" + cd + "'") + ";" +
                      Filas(cn, "SELECT Categoria, FechaCreacionCategoria, FechaAnalisisCategoria FROM dbo.ProblemCategoria WHERE Codigo = N'" + cd + "' ORDER BY Categoria"));
                Check("D6 evento 'I' de la categoria: anterior NULL (heredaba), Campo FechaAnalisis, ADMIN",
                      "/D/Tres|FechaAnalisis|NULL|2026-11-17|I|ADMIN|DOM\\prueba",
                      Filas(cn, "SELECT Categoria, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cd + "' AND Categoria IS NOT NULL"));
                var fPropia = Mod(cd, new DateTime(2026, 11, 3));
                fPropia.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = "/D/Tres", FechaAnalisis = new DateTime(2026, 11, 30) });
                Modificar(cn, fPropia);
                Check("D7 editar la fecha propia: 'U' con el anterior crudo; la de la iniciativa no se mueve",
                      "/D/Tres|2026-11-17|2026-11-30|U;2026-10-28",
                      Filas(cn, "SELECT Categoria, FechaAnterior, FechaNueva, Operacion FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cd + "' AND Categoria IS NOT NULL AND Operacion = 'U'") + ";" +
                      Celda(Uno(cn, "SELECT FechaAnalisis FROM dbo.Problem WHERE Codigo = N'" + cd + "'")));
                var fHereda = Mod(cd, new DateTime(2026, 11, 3));
                fHereda.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = "/D/Uno", FechaAnalisis = new DateTime(2026, 11, 10) });
                Modificar(cn, fHereda);
                Check("D8 la fecha de una inicial (hereda) = la de la INICIATIVA: Problem cambia, la categoria sigue sin fecha propia, sin evento de categoria",
                      "2026-11-10|NULL|NULL|1",
                      Celda(Uno(cn, "SELECT FechaAnalisis FROM dbo.Problem WHERE Codigo = N'" + cd + "'")) + "|" +
                      Filas(cn, "SELECT FechaCreacionCategoria, FechaAnalisisCategoria FROM dbo.ProblemCategoria WHERE Codigo = N'" + cd + "' AND Categoria = N'/D/Uno'") + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cd + "' AND Categoria IS NOT NULL AND Operacion = 'U'"));
                var fIni = Mod(cd, new DateTime(2026, 11, 4));
                fIni.Problem[PeticionModificarAdmin.CFAnalisis] = "2026-12-01";
                Modificar(cn, fIni);
                Check("D9 cambiar la de la iniciativa no pisa la propia de /D/Tres", "2026-12-01|2026-11-30",
                      Celda(Uno(cn, "SELECT FechaAnalisis FROM dbo.Problem WHERE Codigo = N'" + cd + "'")) + "|" +
                      Celda(Uno(cn, "SELECT FechaAnalisisCategoria FROM dbo.ProblemCategoria WHERE Codigo = N'" + cd + "' AND Categoria = N'/D/Tres'")));
                var fDos = Mod(cd, hoy);
                fDos.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = "/D/Uno", FechaAnalisis = new DateTime(2026, 12, 2) });
                fDos.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = "/D/Dos", FechaAnalisis = new DateTime(2026, 12, 3) });
                Check("D10 dos iniciales con fechas distintas: 51016", "51016", Error(() => Modificar(cn, fDos)));
                Check("D11 vaciar la fecha de una categoria: 51017", "51017",
                      Error(() => Exec(cn, "DECLARE @p adm.CategoriaPctTipo, @a adm.CategoriaPctTipo, @f adm.CategoriaFechaTipo; " +
                                           "INSERT @f VALUES (N'/D/Tres', NULL); EXEC adm.usp_GestionAdmin_Modificar @Usuario = N'x', @Codigo = N'" + cd + "', @Pcts = @p, @Agregar = @a, @FechasCategoria = @f;")));
                var fAjena = Mod(cd, hoy);
                fAjena.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = "/S/Cat 1", FechaAnalisis = new DateTime(2026, 12, 2) });
                Check("D12 fecha de una categoria no ligada: 51007", "51007", Error(() => Modificar(cn, fAjena)));
                Check("D13 Codigo y FechaCreacion intactos tras todo", cd + "|2026-10-13",
                      Filas(cn, "SELECT Codigo, FechaCreacion FROM dbo.Problem WHERE Codigo = N'" + cd + "'"));

                // ---------------- N: NroCambioFecha* ----------------
                var n1 = Mod(cd, hoy);
                n1.Problem[PeticionModificarAdmin.CFSolucion] = "2027-01-15";   // NULL -> fecha: no cuenta
                n1.Problem[PeticionModificarAdmin.CFCierre] = "2027-02-15";
                Modificar(cn, n1);
                var n2 = Mod(cd, hoy);
                n2.Problem[PeticionModificarAdmin.CFSolucion] = "2027-01-10";   // adelanto de Solucion: cuenta
                n2.Problem[PeticionModificarAdmin.CFCierre] = "2027-02-10";     // adelanto de Cierre: NO cuenta
                Modificar(cn, n2);
                var n3 = Mod(cd, hoy);
                n3.Problem[PeticionModificarAdmin.CFCierre] = "2027-03-01";     // extension de Cierre: cuenta
                Modificar(cn, n3);
                Check("N1 contadores: Analisis 2 (D8, D9), Solucion 1 (asignar no cuenta), Cierre 1 (solo la extension)", "2|1|1",
                      Filas(cn, "SELECT NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre FROM dbo.Problem WHERE Codigo = N'" + cd + "'"));
                Exec(cn, "UPDATE dbo.Problem SET NroCambioFechaAnalisis = 7 WHERE Codigo = N'PRB 2026-000005'");
                var n4 = Mod("PRB 2026-000005", hoy);
                n4.Problem[PeticionModificarAdmin.CFAnalisis] = "2026-09-30";
                Modificar(cn, n4);
                Check("N2 un contador del Excel (7) se conserva como base: +1 = 8", "8",
                      Uno(cn, "SELECT NroCambioFechaAnalisis FROM dbo.Problem WHERE Codigo = N'PRB 2026-000005'"));
                var n5 = Mod("PRB 2026-000005", hoy);
                n5.Problem[SolicitudIniciativa.CTitulo] = "solo titulo";
                Modificar(cn, n5);
                Check("N3 un cambio sin fechas no mueve contadores", "8",
                      Uno(cn, "SELECT NroCambioFechaAnalisis FROM dbo.Problem WHERE Codigo = N'PRB 2026-000005'"));

                // ---------------- K: tope ----------------
                Check("K1 tope exacto: 60 de otra + 40 = 100: sin error", "sin error", Error(() => Crear(cn, Alta(hoy, "/K/Cat 1", "40"))));
                Check("K2 +0.01 sobre 100: 51010", "51010", Error(() => Crear(cn, Alta(hoy, "/K/Cat 1", "0.01"))));
                var nuevaAntes = Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Categoria = N'/S/Nueva'");
                Check("K3 alta con la 2a categoria excedida: 51010 y nada escrito", "51010|" + nuevaAntes,
                      Error(() => Crear(cn, Alta(hoy, "/S/Nueva", "10", "/K/Cat 1", "5"))) + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Categoria = N'/S/Nueva'"));
                Check("K2b sin Agrupacion (viva) se revisa como si consumiera: /K/Cat 1 lleno -> 51010", "51010",
                      Error(() => Crear(cn, AltaTipo(hoy, "PRB", null, "En Análisis", "/K/Cat 1", "1"))));
                Check("K2c sin Estado no consume (no esta viva): /K/Cat 1 al 1%: sin error", "sin error",
                      Error(() => Crear(cn, AltaTipo(hoy, "PRB", null, null, "/K/Cat 1", "1"))));
                Check("K4 alta cerrada no consume: /K/Cat 1 al 50% con estado Cerrado: sin error", "sin error",
                      Error(() => Crear(cn, AltaTipo(hoy, "PRB", "Problem", "Cerrado", "/K/Cat 1", "50"))));
                var re = Mod("SOR 2026-000001", hoy);
                re.Problem[PeticionModificarAdmin.CEstado] = "En Análisis";
                Check("K5 reactivar (Cerrado -> En Analisis) con 70% sobre una ruta con 50% vivo: 51010", "51010", Error(() => Modificar(cn, re)));
                Check("K6 la reactivacion rechazada no cambio el estado", "Cerrado", Uno(cn, "SELECT Estado FROM dbo.Problem WHERE Codigo = N'SOR 2026-000001'"));
                var nulo = Mod("PRB 2025-000100", hoy);
                nulo.Pcts.Add(new CategoriaPlan { Ruta = "/N/Otra", Pct = 0.2m });
                Check("K7 viva con una categoria sin Agrupacion: cambiar el % de otra pasa (la Agrupacion es opcional)", "sin error", Error(() => Modificar(cn, nulo)));
                var nuloOk = Mod("PRB 2025-000100", hoy);
                nuloOk.Pcts.Add(new CategoriaPlan { Ruta = "/N/Otra", Pct = 0.2m });
                nuloOk.Pcts.Add(new CategoriaPlan { Ruta = "/N/Nulo", Pct = 0.1m, TipoAgrupado = "Problem" });
                Check("K8 declarando la Agrupacion de esa categoria, el cambio pasa", "sin error|Problem|0.2000",
                      Error(() => Modificar(cn, nuloOk)) + "|" +
                      Uno(cn, "SELECT TipoAgrupado FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2025-000100' AND Categoria = N'/N/Nulo'") + "|" +
                      Celda(Uno(cn, "SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2025-000100' AND Categoria = N'/N/Otra'")));
                Check("K9 un agrupador que no consume (Requerimiento al 90%) no cuenta: 50% Problem en /Q/Req: sin error", "sin error",
                      Error(() => Crear(cn, Alta(hoy, "/Q/Req", "50"))));
                var baja = Mod("ADO 2025-000001", hoy);
                baja.Pcts.Add(new CategoriaPlan { Ruta = "/K/Cat 1", Pct = 0.6m });
                Check("K10 ruta ya llena: dejar igual el propio % no se bloquea", "sin error", Error(() => Modificar(cn, baja)));
                string resB = null;
                using (var cnA = Abrir(Base))
                using (var cnB = Abrir(Base))
                {
                    var pa = Mod(c1, hoy); pa.Agregar.Add(Liga("/C/Carrera", 0.6m));
                    var pb = Mod(cd, hoy); pb.Agregar.Add(Liga("/C/Carrera", 0.35m));
                    var txA = cnA.BeginTransaction();
                    new EscritorGestionAdminSql().Modificar(cnA, txA, pa, @"DOM\a");
                    var hilo = new Thread(() => { resB = Error(() => Modificar(cnB, pb, @"DOM\b")); });
                    hilo.Start();
                    espero = !hilo.Join(2000);
                    txA.Commit();
                    hilo.Join(30000);
                }
                Check("K11 concurrencia: 10 (C12) + 60 ligada en una tx abierta; la otra (35) espera el candado y se rechaza", "True|51010|0.7000",
                      espero + "|" + resB + "|" + Celda(Uno(cn, "SELECT SUM(PctDisminucion) FROM dbo.ProblemCategoria WHERE Categoria = N'/C/Carrera'")));

                Check("K12 una fila viva SIN agrupacion de otra iniciativa cuenta contra el tope: 70 + 40 -> 51010", "51010",
                      Error(() => Crear(cn, Alta(hoy, "/N/Solo", "40"))));
                Check("K13 ... y 70 + 30 = 100 pasa", "sin error", Error(() => Crear(cn, Alta(hoy, "/N/Solo", "30"))));

                // ---------------- R: TicketsReduce ----------------
                var cr = Crear(cn, Alta(hoy, "/T/Vol", "50", "/S/Cat 2", ""));
                Check("R1 TicketsReduce = ROUND(93 x 0.50) = 47 (los 10 viejos no cuentan); sin % = NULL", "/S/Cat 2|NULL;/T/Vol|47",
                      Filas(cn, "SELECT Categoria, TicketsReduce FROM dbo.ProblemCategoria WHERE Codigo = N'" + cr + "' ORDER BY Categoria"));
                var rMod = Mod(cr, hoy); rMod.Pcts.Add(new CategoriaPlan { Ruta = "/T/Vol", Pct = 0.35m });
                Modificar(cn, rMod);
                Check("R2 al cambiar el %: ROUND(93 x 0.35 = 32.55) = 33", "33",
                      Uno(cn, "SELECT TicketsReduce FROM dbo.ProblemCategoria WHERE Codigo = N'" + cr + "' AND Categoria = N'/T/Vol'"));
                Check("R3 coincide con VolumenUltimos30 de dbo.vw_ProblemCategoria", "93",
                      Uno(cn, "SELECT VolumenUltimos30 FROM dbo.vw_ProblemCategoria WHERE Codigo = N'" + cr + "' AND Categoria = N'/T/Vol'"));

                // ---------------- H: lectores C# ----------------
                var h = HistorialFechas.Leer(cn);
                var ini = h.Para(cd);
                var cats = h.CategoriasPara(cd);
                Check("H1 HistorialFechas: estado ok; la iniciativa sin eventos de categoria; las categorias aparte", "ok|0|2",
                      h.Estado + "|" + Contar(ini, "categoria") + "|" + cats.Count);
                var primera = (Dictionary<string, object>)cats[0];
                Check("H2 el 'I' de la categoria viaja con anterior null (crudo) y su categoria", "/D/Tres|NULL|2026-11-17|I",
                      primera["categoria"] + "|" + Celda(primera["anterior"]) + "|" + primera["nuevo"] + "|" + primera["operacion"]);
                Check("H3 la iniciativa conserva su numeracion: sus 'U' de FechaAnalisis son 2", "2",
                      ContarCampo(ini, "FechaAnalisis", "U"));
                var fp = Invocar("LeerFechasPropias", cn);
                var porCat = (IDictionary)Campo(fp, "PorCategoria");
                var analisisIni = (IDictionary)Campo(fp, "AnalisisIniciativa");
                Check("H4 registro: fechas propias solo de la ligada despues; la de la iniciativa aparte", "1|2026-11-02|2026-11-30|2026-12-01",
                      Contar(porCat, cd) + "|" + string.Join("|", (string[])porCat[cd + " /D/Tres"]) + "|" + analisisIni[cd]);
            }

            // ---------------- P: permisos como el sitio ----------------
            using (var m = Abrir("master"))
            {
                Exec(m, "CREATE LOGIN [" + login + "] WITH PASSWORD = N'" + clave + "', CHECK_POLICY = OFF, DEFAULT_DATABASE = [" + Base + "];");
                Exec(m, "CREATE LOGIN [" + loginSinAdm + "] WITH PASSWORD = N'" + clave + "', CHECK_POLICY = OFF, DEFAULT_DATABASE = [" + Base + "];");
            }
            using (var cn = Abrir(Base))
            {
                // Lo que tiene PROACTIVANETAD en la VM (diag p2 Q3) + el GRANT de la seccion 8 de sql/18.
                Exec(cn, "CREATE USER [sitio] FOR LOGIN [" + login + "]; ALTER ROLE db_datareader ADD MEMBER [sitio]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [sitio]; GRANT EXECUTE ON SCHEMA::dbo TO [sitio]; GRANT EXECUTE ON SCHEMA::adm TO [sitio];");
                Exec(cn, "CREATE USER [sinadm] FOR LOGIN [" + loginSinAdm + "]; ALTER ROLE db_datareader ADD MEMBER [sinadm]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [sinadm]; GRANT EXECUTE ON SCHEMA::dbo TO [sinadm];");
            }
            using (var s = AbrirSql(Base, login, clave))
            {
                string cs = null;
                Check("P1 alta con el principal del sitio por EXECUTE: sin error", "sin error",
                      Error(() => cs = Crear(s, Alta(hoy, "/P/Sitio 1", "10", "/P/Sitio 2", "10"), @"DOM\sitio")));
                var l = Mod(cs, hoy); l.Agregar.Add(Liga("/P/Sitio 3", 0.1m));
                Check("P2 ligar con el principal del sitio: sin error", "sin error", Error(() => Modificar(s, l, @"DOM\sitio")));
                Check("P3 atribucion: Usuario = el de la app, LoginBD = el login del sitio, en iniciativa y categoria",
                      "NULL|I|ADMIN|DOM\\sitio|" + login + ";/P/Sitio 3|I|ADMIN|DOM\\sitio|" + login,
                      Filas(s, "SELECT Categoria, Operacion, Origen, Usuario, LoginBD FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cs + "' ORDER BY IdEvento"));
            }
            using (var s = AbrirSql(Base, loginSinAdm, clave))
                Check("P4 sin GRANT EXECUTE en adm: el procedimiento se niega (229)", "229", Error(() => Crear(s, Alta(hoy, "/S/Cat 1", "1"), @"DOM\x")));
            using (var cn = Abrir(Base))
            {
                Exec(cn, "SET XACT_ABORT OFF; BEGIN TRAN; EXEC sys.sp_set_session_context N'pfe_origen', 'ADMIN';");
                var sinUsuario = Error(() => Exec(cn, "UPDATE dbo.ProblemCategoria SET FechaAnalisisCategoria = '2027-01-01' WHERE Categoria = N'/P/Sitio 3'"));
                Exec(cn, "IF @@TRANCOUNT > 0 ROLLBACK; EXEC sys.sp_set_session_context N'pfe_origen', NULL;");
                Check("P5 ADMIN sin usuario en un evento de categoria: rechazado por CK_ProblemFechaEvento_Atribucion (547)", "547", sinUsuario);
            }

            // ---------------- V: vistas del backend ----------------
            Vistas(hoy);

            // ---------------- S: stub del cargador ----------------
            Stub();

            // ---------------- B: rollback de 18 ----------------
            Rollback18();
        }
        catch (Exception ex) { fallos++; Console.WriteLine("FAIL  excepcion: " + ex); }
        finally
        {
            try { Borrar(Base); Console.WriteLine("   base " + Base + " borrada"); } catch (Exception ex) { Console.WriteLine("No se pudo borrar " + Base + ": " + ex.Message); }
            try
            {
                using (var m = Abrir("master"))
                    Exec(m, "IF SUSER_ID(N'" + login + "') IS NOT NULL DROP LOGIN [" + login + "]; IF SUSER_ID(N'" + loginSinAdm + "') IS NOT NULL DROP LOGIN [" + loginSinAdm + "];");
                Console.WriteLine("   logins de prueba borrados");
            }
            catch (Exception ex) { Console.WriteLine("No se pudieron borrar los logins: " + ex.Message); }
        }
        Console.WriteLine();
        Console.WriteLine((fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)") + (noCorridas > 0 ? " · " + noCorridas + " NO CORRIDA(S)" : ""));
        return fallos == 0 ? 0 : 1;
    }

    static void Vistas(DateTime hoyAlta)
    {
        if (!HayBackend()) { NoCorrida("V*", "falta " + Backend); return; }
        using (var cn = Abrir(Base))
        {
            // Una iniciativa viva cuya fecha de iniciativa no vence, con una
            // categoria ligada despues cuya fecha propia ya paso (hoy real - 3).
            var hoy = HoyReal;
            var cv = Crear(cn, Alta(hoy, "/V/Inicial", "5"));
            var l = Mod(cv, hoy); l.Agregar.Add(Liga("/V/Vence", 0.05m));
            Modificar(cn, l);
            var f = Mod(cv, hoy); f.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = "/V/Vence", FechaAnalisis = hoy.AddDays(-3) });
            Modificar(cn, f);

            Check("V1 antes de ADM_01: la vista da la fecha de la iniciativa en las dos categorias", "2",
                  Uno(cn, "SELECT COUNT(*) FROM dbo.vw_ProblemCategoria WHERE Codigo = N'" + cv + "' AND FechaAnalisis = '" + hoy.AddDays(15).ToString("yyyy-MM-dd") + "'"));
            Check("V2 antes de ADM_02: la iniciativa sale AL CORRIENTE", "AL CORRIENTE",
                  Uno(cn, "SELECT Veredicto FROM dbo.vw_ProblemVencido WHERE Codigo = N'" + cv + "'"));
            var antes01 = HashDef(cn, "dbo.vw_ProblemCategoria");
            var antes02 = HashDef(cn, "dbo.vw_ProblemVencido");
            var filasAntes = Uno(cn, "SELECT COUNT(*) FROM dbo.vw_ProblemCategoria");
            var columnasAntes = Columnas(cn);

            Lotes(cn, LeerBackend("ADM_01_vw_ProblemCategoria_fecha_categoria.sql"));
            Lotes(cn, LeerBackend("ADM_02_vw_ProblemVencido_fecha_categoria.sql"));
            Check("V3 ADM_01: misma cantidad de filas (una por fila de la tabla)", filasAntes, Uno(cn, "SELECT COUNT(*) FROM dbo.vw_ProblemCategoria"));
            Check("V4 ADM_01: FechaAnalisis efectiva por categoria; NroCambio de la propia = sus 'U' (1); columnas nuevas al final",
                  "/V/Inicial|" + Iso(hoy.AddDays(15)) + "|0|" + Iso(hoy.AddDays(15)) + "|NULL;/V/Vence|" + Iso(hoy.AddDays(-3)) + "|1|" + Iso(hoy.AddDays(15)) + "|" + Iso(hoy.AddDays(-3)),
                  Filas(cn, "SELECT Categoria, FechaAnalisis, NroCambioFechaAnalisis, FechaAnalisisIniciativa, FechaAnalisisCategoria FROM dbo.vw_ProblemCategoria WHERE Codigo = N'" + cv + "' ORDER BY Categoria"));
            Check("V5 ADM_01: las columnas de antes, en el mismo orden, + 3 nuevas al final", columnasAntes + ",FechaAnalisisIniciativa,FechaCreacionCategoria,FechaAnalisisCategoria",
                  Columnas(cn));
            Check("V6 ADM_02: la categoria vencida vence la iniciativa (Compromiso = su fecha)", "VENCIDA|" + Iso(hoy.AddDays(-3)) + "|3|1",
                  Filas(cn, "SELECT Veredicto, Compromiso, DiasVencida, GeneraAviso FROM dbo.vw_ProblemVencido WHERE Codigo = N'" + cv + "'"));
            Check("V7 ADM_02: una iniciativa sin fechas propias (PRB 2026-000005) sigue igual", "FechaAnalisis|2026-09-30|VENCIDA",
                  Filas(cn, "SELECT ColumnaRige, Compromiso, Veredicto FROM dbo.vw_ProblemVencido WHERE Codigo = N'PRB 2026-000005'"));
            // Semaforo de Experiencia: el mismo LeerIniciativas que pinta el tablero.
            var det = (IList)Invocar("LeerIniciativas", cn, HoyReal);
            var sem = new List<string>();
            foreach (var d in det)
                if ((string)Campo(d, "Folio") == cv) sem.Add(Campo(d, "Categoria") + "=" + Campo(d, "FAnalisis") + ":" + Campo(d, "Retrasada"));
            sem.Sort(StringComparer.Ordinal);
            Check("V8 Experiencia (LeerIniciativas): solo la categoria con fecha propia vencida va retrasada",
                  "/V/Inicial=" + Iso(hoy.AddDays(15)) + ":False|/V/Vence=" + Iso(hoy.AddDays(-3)) + ":True", string.Join("|", sem));

            Check("V9 ADM_01 / ADM_02 no corren dos veces", "True|True",
                  LotesError(cn, LeerBackend("ADM_01_vw_ProblemCategoria_fecha_categoria.sql")).Contains("ya tiene el cambio") + "|" +
                  LotesError(cn, LeerBackend("ADM_02_vw_ProblemVencido_fecha_categoria.sql")).Contains("ya tiene el cambio"));
            Check("V10 el rollback de 18 se niega mientras las vistas usan sus columnas (51091)", "True",
                  LotesError(cn, Leer("sql", "18_gestion_admin_persistencia_rollback.sql")).StartsWith("51091"));
            Lotes(cn, LeerBackend("ADM_01_vw_ProblemCategoria_fecha_categoria_rollback.sql"));
            Lotes(cn, LeerBackend("ADM_02_vw_ProblemVencido_fecha_categoria_rollback.sql"));
            Check("V11 rollback ADM_01 / ADM_02: las definiciones vuelven exactas (hash)", antes01 + "|" + antes02,
                  HashDef(cn, "dbo.vw_ProblemCategoria") + "|" + HashDef(cn, "dbo.vw_ProblemVencido"));
        }
    }

    static void Stub()
    {
        if (!HayBackend()) { NoCorrida("S*", "falta " + Backend); return; }
        using (var cn = Abrir(Base))
        {
            var original = HashDef(cn, "dbo.usp_CargarExperiencia");
            Check("S1 el cargador de la replica es el verificado (174bb51)", "0x3BC236C22F81E7A07A4F221A012D54669742BE96A3E31C55DFE7F848D19C67DD", original);
            Lotes(cn, LeerBackend("ADM_03_usp_CargarExperiencia_retirado.sql"));
            Exec(cn, "INSERT stg.Problems (Codigo, Titulo, Estado) VALUES (N'PRB 2026-000005', N'pisado por el Excel', N'Cerrado');");
            var antes = Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(CHECKSUM(Codigo, Titulo, Estado, VigenteEnOrigen)) FROM dbo.Problem") + "/" +
                        Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(CHECKSUM(Codigo, Categoria, PctDisminucion, VigenteEnOrigen)) FROM dbo.ProblemCategoria");
            Check("S2 el stub falla con 51900", "51900", Error(() => Exec(cn, "EXEC dbo.usp_CargarExperiencia;")));
            Check("S3 con @Simulacion = 1 tambien (misma firma)", "51900", Error(() => Exec(cn, "EXEC dbo.usp_CargarExperiencia @Simulacion = 1;")));
            Check("S4 no cambio ninguna fila de Problem ni ProblemCategoria", antes,
                  Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(CHECKSUM(Codigo, Titulo, Estado, VigenteEnOrigen)) FROM dbo.Problem") + "/" +
                  Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(CHECKSUM(Codigo, Categoria, PctDisminucion, VigenteEnOrigen)) FROM dbo.ProblemCategoria"));
            Check("S5 instalarlo otra vez se niega (la definicion ya no es la verificada)", "True",
                  LotesError(cn, LeerBackend("ADM_03_usp_CargarExperiencia_retirado.sql")).Contains("NO es la verificada"));
            Lotes(cn, LeerBackend("ADM_03_usp_CargarExperiencia_retirado_rollback.sql"));
            Check("S6 rollback: vuelve la definicion exacta (hash 174bb51)", original, HashDef(cn, "dbo.usp_CargarExperiencia"));
            Exec(cn, "DELETE stg.Problems;");
        }
    }

    static void Rollback18()
    {
        using (var cn = Abrir(Base))
        {
            var iniAntes = Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Categoria IS NULL");
            Check("B1 con fechas por categoria escritas, el rollback se niega sin forzar (51090)", "True",
                  LotesError(cn, Leer("sql", "18_gestion_admin_persistencia_rollback.sql")).StartsWith("51090"));
            Check("B2 ... y no quito nada", "1|1",
                  Filas(cn, "SELECT CASE WHEN SCHEMA_ID('adm') IS NULL THEN 0 ELSE 1 END, CASE WHEN COL_LENGTH('dbo.ProblemFechaEvento','Categoria') IS NULL THEN 0 ELSE 1 END"));
            Exec(cn, "EXEC sys.sp_set_session_context N'forzar_rollback_18', N'SI';");
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia_rollback.sql"));
            Check("B3 forzado: sin adm, sin columnas, sin trigger; los eventos de la iniciativa intactos", "0|0|0|0|" + iniAntes,
                  Filas(cn, "SELECT CASE WHEN SCHEMA_ID('adm') IS NULL THEN 0 ELSE 1 END, " +
                            "CASE WHEN COL_LENGTH('dbo.ProblemFechaEvento','Categoria') IS NULL THEN 0 ELSE 1 END, " +
                            "CASE WHEN COL_LENGTH('dbo.ProblemCategoria','FechaAnalisisCategoria') IS NULL THEN 0 ELSE 1 END, " +
                            "CASE WHEN OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento') IS NULL THEN 0 ELSE 1 END, " +
                            "(SELECT COUNT(*) FROM dbo.ProblemFechaEvento)"));
            Exec(cn, "EXEC sys.sp_set_session_context N'forzar_rollback_18', NULL;");
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia.sql"));
            Check("B4 y se puede volver a aplicar", "1", Uno(cn, "SELECT CASE WHEN OBJECT_ID('adm.usp_GestionAdmin_Crear') IS NULL THEN 0 ELSE 1 END"));
        }
    }

    // ---------------------------------------------------------------------
    // Reflexion sobre ExperienciaQueries (privados que usa el tablero).
    // ---------------------------------------------------------------------
    static object Invocar(string metodo, params object[] args)
    {
        var m = typeof(ExperienciaQueries).GetMethod(metodo, BindingFlags.NonPublic | BindingFlags.Static);
        return m.Invoke(null, args);
    }

    static object Campo(object o, string nombre)
    {
        var f = o.GetType().GetField(nombre, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        return f.GetValue(o);
    }

    static string Iso(DateTime d) { return d.ToString("yyyy-MM-dd"); }

    static string Columnas(SqlConnection cn)
    {
        return Filas(cn, "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.vw_ProblemCategoria') ORDER BY column_id").Replace(';', ',');
    }

    static int Contar(List<object> eventos, string clave)
    {
        var n = 0;
        foreach (Dictionary<string, object> e in eventos) if (e.ContainsKey(clave)) n++;
        return n;
    }

    static int Contar(IDictionary d, string prefijo)
    {
        var n = 0;
        foreach (var k in d.Keys) if (((string)k).StartsWith(prefijo, StringComparison.Ordinal)) n++;
        return n;
    }

    static int ContarCampo(List<object> eventos, string campo, string operacion)
    {
        var n = 0;
        foreach (Dictionary<string, object> e in eventos)
            if ((string)e["campo"] == campo && (string)e["operacion"] == operacion) n++;
        return n;
    }
}
