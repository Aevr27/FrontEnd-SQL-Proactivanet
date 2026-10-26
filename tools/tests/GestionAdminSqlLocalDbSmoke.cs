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
// Lo que esto prueba es la migracion sobre una REPLICA: sin datos reales, y
// las funciones de categoria / nombres son stubs (ver la replica). Los
// triggers de historial (fechas y Estado) son los desplegados en la VM; el
// de Estado (dbo.ProblemEstadoEvento) solo si la replica local lo trae: si
// no, sus casos (E15b) salen como NO CORRIDOS.
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
//   M  Modificar de punta a punta: todos los campos en una llamada y leidos
//      de vuelta; fallas a media transaccion (tope, categoria no ligada,
//      estado, repetida) sin dejar nada; quitar rechazado; concurrencia al
//      subir el %. Fecha de cierre (extender cuenta, adelantar no) y
//      historial de Estado (dbo.ProblemEstadoEvento) con su atribucion.
//   H  lector C# del historial (HistorialFechas) y registro (fechas propias).
//   P  permisos con un login como el del sitio (datareader/datawriter +
//      EXECUTE dbo/adm) y sin EXECUTE en adm.
//   V  vistas del backend: semaforo de Experiencia y vencidas.
//   A  sql/21 (Agrupacion COLLATE CI_AI en el tope), en una base aparte: el
//      defecto antes ("Adopcion" con tilde no cuenta ni se revisa), hashes,
//      tope con tilde en alta / Modificar / RevisarTope, cerrada no
//      consume, datos sin tocar, repetida, postcondicion, rollback exacto,
//      mezcla rechazada, reaplicable.
//   B  rollback de 18 (orden, datos, forzado).
//   S  stub del cargador y su rollback.
//   E  proteccion del cargador (ADM_04 + adm.IniciativaProtegida): el
//      cargador 174bb51 parchado, corrido de verdad contra staging, no pisa
//      ni da de baja iniciativas protegidas ni sus categorias; las demas
//      siguen igual; registro atomico; fallas cerradas; concurrencia con
//      dos conexiones; rollback. Modificar protege solo con cambio real
//      (E31*). Cuentas como la del operador (stg de otro dueno, como en la
//      VM: E29/E29b) y la del sitio con y sin DENY (E30/E30n). Rollback de
//      ADM_04 + ADM_03 en una transaccion con una carga en medio (E32/E32n).
//      Diag secciones 10 (cuentas) y 11 (hash de sql/18) (E33-E35).
//
// stg: en la VM es de SORIANA\edgarrad; aqui de SORIANA_edgarrad (usuario
// sin login), porque un nombre con dominio no se puede crear sin el dominio.
// La replica no se toca: el cambio de dueno se hace al preparar la base.
//
// Compilar (ver memoria csc): App_Code\*.cs + este archivo; correr con
// cwd = raiz del repo.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;

public static class GestionAdminSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    // adm.usp_GestionAdmin_Crear tras sql/20 (misma regla de hash que el diag
    // ADM_04 seccion 11). Si sql/20 cambia, cambia esto y el diag.
    const string HashCrearSql20 = "0x77292B7976EAF0670BE8961824D212EEEFB218343A816CE83BB6F3FE8934C297";
    static int pasadas = 0, fallos = 0, noCorridas = 0;
    static string Base;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, CultureInfo.InvariantCulture);
        var ok = e == o;
        if (ok) pasadas++; else fallos++;
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

    // Corre un script que debe negarse de las dos formas en que se corre en la
    // VM: sqlcmd -b (se para en el primer error) y SSMS (sigue con los lotes
    // que quedan; ahi actua SET NOEXEC ON). Devuelve, por forma, si el
    // mensaje trae 'motivo' y el @@TRANCOUNT ANTES de limpiar:
    // "True|0|True|0" = se nego bien y no dejo transaccion abierta.
    static string Rechazo(SqlConnection cn, string sql, string motivo)
    {
        var r = new List<string>();
        foreach (var comoSsms in new[] { false, true })
        {
            var msg = "";
            foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            {
                if (lote.Trim().Length == 0) continue;
                try { using (var cmd = new SqlCommand(lote, cn) { CommandTimeout = 120 }) cmd.ExecuteNonQuery(); }
                catch (SqlException ex) { msg += ex.Message + " "; if (!comoSsms) break; }
            }
            // NOEXEC OFF primero: si quedo en ON, el SELECT no correria.
            r.Add(msg.Contains(motivo) + "|" + Celda(Uno(cn, "SET NOEXEC OFF; SELECT @@TRANCOUNT")));
            Exec(cn, "IF @@TRANCOUNT > 0 ROLLBACK;");
        }
        return string.Join("|", r);
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
            // En la VM stg es de SORIANA\edgarrad, no de dbo (diag ADM_04 sec 8,
            // 2026-10-14): el cargador (dbo) NO encadena hacia stg. Ese nombre no
            // se puede crear sin el dominio; un usuario sin login hace lo mismo.
            Exec(cn, "CREATE USER [" + DuenoStg + "] WITHOUT LOGIN; ALTER AUTHORIZATION ON SCHEMA::stg TO [" + DuenoStg + "];");
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
            // El escritor manda PO / SO (GuardaDuenos = true): sin sql/20 cada
            // alta fallaria. Va como en la VM: despues de sql/18.
            Lotes(cn, Leer("sql", "20_gestion_admin_duenos.sql"));
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
                Check("G2 aplicada: columnas, FK compuesta, CHECK de nivel, trigger, 4 procedimientos, 1 tabla en adm (IniciativaProtegida)",
                      "1|1|1|1|1|4|1|2",
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

                // ---------------- O: PO / SO del alta (sql/20) ----------------
                Exec(cn, "INSERT dbo.Categorias (Id, RutaCompleta, Inactiva, VigenteEnOrigen) VALUES (N'O1', N'/O/Duenos 1', 0, 1), (N'O2', N'/O/Duenos 2', 0, 1)");
                Check("O1 sql/20 aplicada: Crear tiene @OwnerProblem y @OwnerServicio", "2",
                      Uno(cn, "SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear') AND name IN (N'@OwnerProblem', N'@OwnerServicio')"));
                Check("O1b correr sql/20 otra vez se niega sin tocar nada", "True",
                      LotesError(cn, Leer("sql", "20_gestion_admin_duenos.sql")).Contains("ya tiene @OwnerProblem"));
                // Solo el Tipo: el plan sale del planificador real (sin titulo,
                // sin PO / SO, sin categorias).
                var soloTipo = PlanificadorGestionAdmin.Crear(new PeticionCrearAdmin { Tipo = "SOR", Titulo = "   " },
                                                              new ResultadoGestionAdmin { Accion = "crear" }, hoy);
                string oT = null;
                Check("O2 solo el Tipo: se crea", "sin error", Error(() => oT = Crear(cn, soloTipo)));
                Check("O2 ... codigo de la base; PO, SO, titulo, tipos y estado NULL; 0 categorias; protegida", "True|1|1|1|1|0|1",
                      Regex.IsMatch(oT ?? "", @"^SOR 2026-[0-9]{6}$") + "|" + Filas(cn, "SELECT CASE WHEN OwnerProblem IS NULL AND OwnerServicio IS NULL THEN 1 ELSE 0 END, " +
                                           "CASE WHEN Titulo IS NULL THEN 1 ELSE 0 END, CASE WHEN TipoIniciativa IS NULL THEN 1 ELSE 0 END, " +
                                           "CASE WHEN Estado IS NULL THEN 1 ELSE 0 END, " +
                                           "(SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + oT + "'), " +
                                           "(SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'" + oT + "') " +
                                           "FROM dbo.Problem WHERE Codigo = N'" + oT + "'"));
                Func<string, string, string[], PlanCrearAdmin> conDuenos = (po, so, rp) =>
                {
                    var pl = AltaTipo(hoy, "SOR", "Problem", "En Análisis", rp);
                    pl.Po = po; pl.So = so;
                    return pl;
                };
                Func<string, string> duenos = cod => Filas(cn, "SELECT ISNULL(OwnerProblem, N'(null)'), ISNULL(OwnerServicio, N'(null)') FROM dbo.Problem WHERE Codigo = N'" + cod + "'");
                var oPo = Crear(cn, conDuenos("PO Solo", null, new string[0]));
                Check("O3 solo PO: guardado, SO NULL", "PO Solo|(null)", duenos(oPo));
                var oSo = Crear(cn, conDuenos(null, "SO Solo", new string[0]));
                Check("O3 solo SO: guardado, PO NULL", "(null)|SO Solo", duenos(oSo));
                var oCat = Crear(cn, conDuenos(null, null, new[] { "/O/Duenos 1", "" }));
                Check("O3 solo categoria: PO y SO NULL, la categoria ligada", "(null)|(null)|1",
                      duenos(oCat) + "|" + Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + oCat + "'"));
                // La base no conoce cascada: cualquier combinacion se guarda tal cual.
                var oTres = Crear(cn, conDuenos("PO Cualquiera", "SO De Otra Rama", new[] { "/O/Duenos 2", "" }));
                Check("O4 PO + SO + categoria sin relacion entre si: guardados tal cual", "PO Cualquiera|SO De Otra Rama|1",
                      duenos(oTres) + "|" + Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + oTres + "'"));
                // Directo al procedimiento (lo que el planificador ya evita):
                // solo espacios = NULL; mas de 255 = 51027 sin dejar filas.
                Func<string, string, string> sp = (po, so) =>
                {
                    using (var cmd = new SqlCommand("adm.usp_GestionAdmin_Crear", cn))
                    {
                        cmd.CommandType = System.Data.CommandType.StoredProcedure;
                        cmd.Parameters.AddWithValue("@Usuario", @"DOM\prueba");
                        cmd.Parameters.AddWithValue("@Prefijo", "SOR");
                        foreach (var n in new[] { "@TipoIniciativa", "@TipoAgrupado", "@Estado", "@Titulo", "@Descripcion", "@Observaciones" })
                            cmd.Parameters.AddWithValue(n, DBNull.Value);
                        var t = cmd.Parameters.AddWithValue("@Categorias", new System.Data.DataTable { Columns = { "Categoria", { "Pct", typeof(decimal) }, "TipoIniciativa", "TipoAgrupado" } });
                        t.SqlDbType = System.Data.SqlDbType.Structured; t.TypeName = "adm.CategoriaPctTipo";
                        cmd.Parameters.AddWithValue("@Hoy", hoy);
                        cmd.Parameters.Add("@OwnerProblem", System.Data.SqlDbType.NVarChar, 4000).Value = (object)po ?? DBNull.Value;
                        cmd.Parameters.Add("@OwnerServicio", System.Data.SqlDbType.NVarChar, 4000).Value = (object)so ?? DBNull.Value;
                        var c = cmd.Parameters.Add("@Codigo", System.Data.SqlDbType.NVarChar, 100);
                        c.Direction = System.Data.ParameterDirection.Output;
                        cmd.ExecuteNonQuery();
                        return c.Value as string;
                    }
                };
                var oEsp = sp("   ", "");
                Check("O5 solo espacios / vacio en el procedimiento = NULL", "(null)|(null)", duenos(oEsp));
                var oRec = sp("  PO Recortado ", null);
                Check("O5 espacios de mas: se recortan, el texto no cambia", "PO Recortado|(null)", duenos(oRec));
                var antesLargo = Uno(cn, "SELECT COUNT(*) FROM dbo.Problem");
                Check("O6 PO de 256 caracteres: 51027", "51027", Error(() => sp(new string('x', 256), null)));
                Check("O6 ... sin filas nuevas", antesLargo, Uno(cn, "SELECT COUNT(*) FROM dbo.Problem"));
                // Lectura: lo guardado vuelve por el lector del registro.
                var cap = (Dictionary<string, string[]>)Invocar("LeerDuenosCapturados", cn);
                Check("O7 el registro devuelve lo guardado (con y sin categoria) y null si no hay", "PO Cualquiera|SO De Otra Rama|PO Solo|(null)|(null)",
                      cap[oTres][0] + "|" + cap[oTres][1] + "|" + cap[oPo][0] + "|" + (cap[oPo][1] ?? "(null)") + "|" + (cap[oT][0] ?? "(null)"));
                // Rollback de 20: el procedimiento vuelve al de sql/18 (hash
                // exacto) y lo guardado se queda. Despues se reaplica.
                var hash20 = HashDef(cn, "adm.usp_GestionAdmin_Crear");
                Console.WriteLine("INFO  hash adm.usp_GestionAdmin_Crear con sql/20 = " + hash20);
                // Definicion inesperada (un cambio a mano que conserva firma y
                // nombres): las guardas por hash la rechazan sin tocarla. Se
                // restaura con el texto original (SQL Server guarda el ALTER
                // como CREATE: mismo hash).
                Func<string> defCrear = () => (string)Uno(cn, "SELECT OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear'))");
                Action<string> redefinir = d => Exec(cn, "ALTER" + d.Substring(d.IndexOf("CREATE", StringComparison.Ordinal) + 6));
                Func<string, string> aMano = d => d.Replace("SET NOCOUNT ON;", "SET NOCOUNT ON; /* cambio a mano */");
                const string negocioO = "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Problem";
                var negocioAntesO = Filas(cn, negocioO);
                var def20 = defCrear();
                redefinir(aMano(def20));
                var hashMano20 = HashDef(cn, "adm.usp_GestionAdmin_Crear");
                Check("O8c rollback sobre una Crear con @OwnerProblem pero no la de sql/20: se niega, sin transaccion abierta, no la toca", "True|0|True|0|True",
                      Rechazo(cn, Leer("sql", "20_gestion_admin_duenos_rollback.sql"), "no es la de sql/20") + "|" + (HashDef(cn, "adm.usp_GestionAdmin_Crear") == hashMano20 && hashMano20 != hash20));
                redefinir(def20);
                Check("O8c ... restaurada al texto de sql/20", hash20, HashDef(cn, "adm.usp_GestionAdmin_Crear"));
                // Postcondicion: si el ALTER deja otra cosa (aqui, el script con
                // el cuerpo cambiado en memoria), ROLLBACK y queda la de antes.
                Func<string, string> cuerpoCambiado = t => t.Replace("SET NOCOUNT ON; SET XACT_ABORT ON;", "SET NOCOUNT ON; SET XACT_ABORT ON; /* x */");
                Check("O8d rollback cuyo ALTER no deja la de sql/18: ROLLBACK, sin transaccion abierta, sigue la de sql/20", "True|0|True|0|" + hash20,
                      Rechazo(cn, cuerpoCambiado(Leer("sql", "20_gestion_admin_duenos_rollback.sql")), "no quedo como el de sql/18") + "|" +
                      HashDef(cn, "adm.usp_GestionAdmin_Crear"));
                Lotes(cn, Leer("sql", "20_gestion_admin_duenos_rollback.sql"));
                Check("O8 rollback: sin parametros nuevos, hash = el de sql/18 revisado (diag ADM_04 sec 11), datos intactos",
                      "0|0x1183206C8BF1CFB33675A44D104D65F8660BCC0FF88CC63E40324DB7FBAF21E8|PO Cualquiera|SO De Otra Rama",
                      Uno(cn, "SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear') AND name LIKE N'@Owner%'") + "|" +
                      HashDef(cn, "adm.usp_GestionAdmin_Crear") + "|" + duenos(oTres));
                Check("O8b rollback otra vez se niega", "True",
                      LotesError(cn, Leer("sql", "20_gestion_admin_duenos_rollback.sql")).Contains("sql/20 no aplicada"));
                // Con la guarda vieja esta pasaba: protege y no tiene @OwnerProblem.
                var def18 = defCrear();
                var hash18 = HashDef(cn, "adm.usp_GestionAdmin_Crear");
                redefinir(aMano(def18));
                var hashMano18 = HashDef(cn, "adm.usp_GestionAdmin_Crear");
                Check("O1c sql/20 sobre una Crear sin @OwnerProblem pero no la de sql/18: se niega, sin transaccion abierta, no la toca", "True|0|True|0|True|0",
                      Rechazo(cn, Leer("sql", "20_gestion_admin_duenos.sql"), "no es la de sql/18") + "|" + (HashDef(cn, "adm.usp_GestionAdmin_Crear") == hashMano18 && hashMano18 != hash18) + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear') AND name LIKE N'@Owner%'"));
                redefinir(def18);
                Check("O1c ... restaurada al texto de sql/18", hash18, HashDef(cn, "adm.usp_GestionAdmin_Crear"));
                Check("O1d sql/20 cuyo ALTER no deja la de sql/20: ROLLBACK, sin transaccion abierta, sigue la de sql/18", "True|0|True|0|" + hash18,
                      Rechazo(cn, cuerpoCambiado(Leer("sql", "20_gestion_admin_duenos.sql")), "no quedo como el de sql/20") + "|" +
                      HashDef(cn, "adm.usp_GestionAdmin_Crear"));
                Lotes(cn, Leer("sql", "20_gestion_admin_duenos.sql"));
                Check("O9b iniciativas intactas tras rollback, rechazos y reaplicacion", negocioAntesO, Filas(cn, negocioO));
                Check("O9 hash de Crear con sql/20 = el esperado (diag ADM_04 sec 11 por actualizar)", HashCrearSql20, hash20);
                Check("O9 reaplicada: mismo hash que la primera vez", hash20, HashDef(cn, "adm.usp_GestionAdmin_Crear"));

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

                // ---------------- M: Modificar de punta a punta ----------------
                // Todo lo que "Modificar" guarda, en UNA llamada, leido de vuelta;
                // y llamadas que fallan a media transaccion sin dejar nada.
                Exec(cn, "INSERT dbo.Categorias (Id, RutaCompleta, Inactiva, VigenteEnOrigen) VALUES " +
                         "(N'M1', N'/M/Uno', 0, 1), (N'M2', N'/M/Dos', 0, 1), (N'M3', N'/M/Tres', 0, 1), (N'M4', N'/M/Carrera', 0, 1);");
                var cm = Crear(cn, Alta(hoy, "/M/Uno", "20"));
                var mTodo = Mod(cm, new DateTime(2026, 10, 20));
                mTodo.Problem[SolicitudIniciativa.CTitulo] = "Titulo M";
                mTodo.Problem[SolicitudIniciativa.CDescripcion] = "Descripcion M";
                mTodo.Problem[SolicitudIniciativa.CObservaciones] = "Observaciones M";
                mTodo.Problem[PeticionModificarAdmin.CEstado] = "En Solución";
                mTodo.Problem[PeticionModificarAdmin.CSubestado] = "Sub M";
                mTodo.Problem[PeticionModificarAdmin.CFAnalisis] = "2026-11-05";
                mTodo.Problem[PeticionModificarAdmin.CFSolucion] = "2026-12-05";
                mTodo.Problem[PeticionModificarAdmin.CFCierre] = "2027-01-05";
                mTodo.Pcts.Add(new CategoriaPlan { Ruta = "/M/Uno", Pct = 0.3m });
                mTodo.Agregar.Add(Liga("/M/Dos", 0.15m));
                Check("M1 titulo, descripcion, observaciones, estado, subestado, 3 fechas, % y categoria nueva en una llamada: sin error", "sin error",
                      Error(() => Modificar(cn, mTodo)));
                Check("M2 dbo.Problem leido de vuelta: cada campo guardado; Codigo y FechaCreacion intactos",
                      cm + "|Titulo M|Descripcion M|Observaciones M|En Solución|Sub M|2026-11-05|2026-12-05|2027-01-05|2026-10-13",
                      Filas(cn, "SELECT Codigo, Titulo, Descripcion, Observaciones, Estado, Subestado, FechaAnalisis, FechaSolucion, FechaCierre, FechaCreacion FROM dbo.Problem WHERE Codigo = N'" + cm + "'"));
                Check("M3 categorias: % cambiado; la nueva con su %, fechas propias (hoy / hoy+15) y tipos; la inicial sigue heredando",
                      "/M/Dos|0.1500|2026-10-20|2026-11-04|Problem|Problem;/M/Uno|0.3000|NULL|NULL|Problem|Problem",
                      Filas(cn, "SELECT Categoria, PctDisminucion, FechaCreacionCategoria, FechaAnalisisCategoria, TipoIniciativa, TipoAgrupado FROM dbo.ProblemCategoria WHERE Codigo = N'" + cm + "' ORDER BY Categoria"));
                Check("M4 contadores: solo el cambio de Analisis cuenta (asignar Solucion/Cierre no)", "1|0|0",
                      Filas(cn, "SELECT NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre FROM dbo.Problem WHERE Codigo = N'" + cm + "'"));
                Check("M5 historial: 'U' de FechaAnalisis de la iniciativa y 'I' de la categoria nueva, ADMIN con el usuario",
                      "/M/Dos|FechaAnalisis|NULL|2026-11-04|I|ADMIN|DOM\\prueba;NULL|FechaAnalisis|2026-10-28|2026-11-05|U|ADMIN|DOM\\prueba",
                      Filas(cn, "SELECT Categoria, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cm + "' " +
                                "AND Campo = 'FechaAnalisis' AND NOT (Operacion = 'I' AND Categoria IS NULL) ORDER BY Categoria DESC"));
                Check("M6 la proteccion del alta se conserva (una fila, ALTA)", "1|ALTA",
                      Filas(cn, "SELECT COUNT(*), MIN(Motivo) FROM adm.IniciativaProtegida WHERE Codigo = N'" + cm + "'"));
                Check("M7 lector del registro: el Subestado guardado", "Sub M",
                      ExperienciaQueries.LeerEstadosProblem(cn).SubestadoPorFolio[cm]);
                Check("M8 TicketsReduce de las dos categorias recalculado (sin tickets = 0)", "/M/Dos|0;/M/Uno|0",
                      Filas(cn, "SELECT Categoria, ISNULL(TicketsReduce, 0) FROM dbo.ProblemCategoria WHERE Codigo = N'" + cm + "' ORDER BY Categoria"));

                // ---------------- MF: fecha al entrar a Cerrado ----------------
                // El plan del planificador (no uno armado a mano) por el mismo
                // procedimiento: entrar a Cerrado llena FechaCierre vacia con el
                // "hoy" del plan y nunca pisa una existente; asignar no suma a
                // NroCambioFecha*. Entrar a En Solucion NO llena FechaSolucion
                // (fecha compromiso): solo se guarda la que pide el formulario.
                Exec(cn, "INSERT dbo.Categorias (Id, RutaCompleta, Inactiva, VigenteEnOrigen) VALUES (N'MF1', N'/MF/Uno', 0, 1);");
                var cf = Crear(cn, Alta(hoy, "/MF/Uno", "10"));
                Func<string, DateTime, string, PlanModificarAdmin> aEstadoCon = (estado, dia, fSolucion) =>
                {
                    var fila = Filas(cn, "SELECT Estado, FechaSolucion, FechaCierre FROM dbo.Problem WHERE Codigo = N'" + cf + "'").Split('|');
                    Func<string, object> f = v => v == "NULL" ? null : v;
                    var a = IniciativaActual.DesdeRegistro(new Dictionary<string, object>
                    {
                        { "folio", cf }, { "estado", fila[0] }, { "f_solucion", f(fila[1]) }, { "f_cierre", f(fila[2]) },
                        { "categorias", new List<object>() },
                    });
                    var r = new ResultadoGestionAdmin { Accion = "modificar", Folio = cf };
                    if (estado != null) r.Cambio(PeticionModificarAdmin.CEstado, "Estado", a.Estado, estado);
                    else if (fSolucion == null) r.Cambio(SolicitudIniciativa.CTitulo, "Título", null, "Titulo MF " + dia.Day);
                    if (fSolucion != null) r.Cambio(PeticionModificarAdmin.CFSolucion, "Fecha compromiso de Solución", a.FSolucion, fSolucion);
                    var form = new System.Collections.Specialized.NameValueCollection { { "folio", cf } };
                    return PlanificadorGestionAdmin.Modificar(PeticionModificarAdmin.DesdeFormulario(form), a, r, dia);
                };
                Func<string, DateTime, PlanModificarAdmin> aEstado = (estado, dia) => aEstadoCon(estado, dia, null);
                Func<string> fechasMf = () => Filas(cn, "SELECT Estado, FechaSolucion, FechaCierre, NroCambioFechaSolucion, NroCambioFechaCierre FROM dbo.Problem WHERE Codigo = N'" + cf + "'");
                Func<string> eventosMf = () => Filas(cn, "SELECT Campo, FechaAnterior, FechaNueva FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cf + "' AND Campo IN ('FechaSolucion', 'FechaCierre') AND Categoria IS NULL AND Operacion = 'U' ORDER BY IdEvento");
                Check("MF0 alta: En Analisis, sin FechaSolucion ni FechaCierre", "En Análisis|NULL|NULL|0|0", fechasMf());
                Check("MF1 entrar a En Solucion con FechaSolucion NULL: sin error", "sin error",
                      Error(() => Modificar(cn, aEstado("En Solución", new DateTime(2026, 10, 21)))));
                Check("MF1 ... FechaSolucion sigue NULL (no se llena con hoy); FechaCierre NULL; contadores en 0",
                      "En Solución|NULL|NULL|0|0", fechasMf());
                Check("MF1 ... ningun evento de fecha", "", eventosMf());
                Modificar(cn, aEstadoCon(null, new DateTime(2026, 10, 22), "2026-11-30"));
                Check("MF2 FechaSolucion pedida por el formulario: se guarda; asignar no cuenta", "En Solución|2026-11-30|NULL|0|0", fechasMf());
                Check("MF2 ... el trigger registra la asignacion NULL -> fecha", "FechaSolucion|NULL|2026-11-30", eventosMf());
                Modificar(cn, aEstado("Cerrado", new DateTime(2026, 10, 25)));
                Check("MF3 entrar a Cerrado con FechaCierre NULL: hoy; FechaSolucion intacta", "Cerrado|2026-11-30|2026-10-25|0|0", fechasMf());
                Check("MF3 ... el trigger registra la asignacion de FechaCierre", "FechaSolucion|NULL|2026-11-30;FechaCierre|NULL|2026-10-25", eventosMf());
                Modificar(cn, aEstado(null, new DateTime(2026, 10, 26)));
                Check("MF4 guardar otra cosa ya Cerrado: la fecha no se toca", "Cerrado|2026-11-30|2026-10-25|0|0", fechasMf());
                Modificar(cn, aEstado("En Solución", new DateTime(2026, 10, 30)));
                Modificar(cn, aEstado("Cerrado", new DateTime(2026, 11, 2)));
                Check("MF5 volver a entrar a En Solucion y a Cerrado con fechas puestas: ninguna se pisa", "Cerrado|2026-11-30|2026-10-25|0|0", fechasMf());
                Check("MF5 ... sin eventos de fecha nuevos", "FechaSolucion|NULL|2026-11-30;FechaCierre|NULL|2026-10-25", eventosMf());
                Modificar(cn, aEstadoCon(null, new DateTime(2026, 11, 3), "2026-12-15"));
                Check("MF6 cambiar FechaSolucion a mano (fecha -> fecha): se guarda y cuenta como cambio", "Cerrado|2026-12-15|2026-10-25|1|0", fechasMf());

                // Atomicidad: varios campos + una categoria que excede el tope
                // (/K/Cat 1 lleno, K1). Una iniciativa del Excel aun sin proteger.
                const string mapa = "MAP 2026-000001";
                Func<string> fotoMap = () =>
                    Filas(cn, "SELECT * FROM dbo.Problem WHERE Codigo = N'" + mapa + "'") + " // " +
                    Filas(cn, "SELECT * FROM dbo.ProblemCategoria WHERE Codigo = N'" + mapa + "' ORDER BY Categoria") + " // " +
                    Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + mapa + "'") + " // " +
                    Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemEstadoEvento WHERE Codigo = N'" + mapa + "'") + " // " +
                    Uno(cn, "SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'" + mapa + "'");
                var antesMap = fotoMap();
                Check("M9 la iniciativa del Excel parte sin proteger", "0", Uno(cn, "SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'" + mapa + "'"));
                var mTope = Mod(mapa, hoy);
                mTope.Problem[SolicitudIniciativa.CTitulo] = "no debe quedar";
                mTope.Problem[SolicitudIniciativa.CObservaciones] = "no debe quedar";
                mTope.Problem[PeticionModificarAdmin.CEstado] = "En Monitoreo";
                mTope.Problem[PeticionModificarAdmin.CFAnalisis] = "2026-12-24";
                mTope.Pcts.Add(new CategoriaPlan { Ruta = "/R/Reac", Pct = 0.4m });
                mTope.Agregar.Add(Liga("/K/Cat 1", 0.05m));
                Check("M10 varios campos + una categoria sobre el tope: 51010", "51010", Error(() => Modificar(cn, mTope)));
                Check("M10 ... nada quedo: Problem, categorias, historiales (fechas y estado) y proteccion identicos", antesMap, fotoMap());
                Check("M10 ... la sesion quedo sin atribucion", "NULL|NULL",
                      Celda(Uno(cn, "SELECT SESSION_CONTEXT(N'pfe_origen')")) + "|" + Celda(Uno(cn, "SELECT SESSION_CONTEXT(N'pfe_usuario')")));
                var mAjena = Mod(mapa, hoy);
                mAjena.Problem[SolicitudIniciativa.CTitulo] = "no debe quedar";
                mAjena.Pcts.Add(new CategoriaPlan { Ruta = "/M/Tres", Pct = 0.1m });
                Check("M11 titulo + % de una categoria no ligada (seleccion vieja): 51007 y nada queda", "51007|" + antesMap,
                      Error(() => Modificar(cn, mAjena)) + "|" + fotoMap());
                var mEstado = Mod(mapa, hoy);
                mEstado.Problem[SolicitudIniciativa.CTitulo] = "no debe quedar";
                mEstado.Problem[PeticionModificarAdmin.CEstado] = "Inventado";
                Check("M12 titulo + Estado que no existe: 51013 y nada queda", "51013|" + antesMap,
                      Error(() => Modificar(cn, mEstado)) + "|" + fotoMap());
                var mRepetida = Mod(cm, hoy);
                mRepetida.Problem[SolicitudIniciativa.CTitulo] = "no debe quedar";
                mRepetida.Agregar.Add(Liga("/M/Uno", 0.1m));
                Check("M13 agregar una categoria ya ligada: 51008 y el titulo no cambia", "51008|Titulo M",
                      Error(() => Modificar(cn, mRepetida)) + "|" + Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'" + cm + "'"));
                var mQuitar = Mod(cm, hoy);
                mQuitar.Problem[SolicitudIniciativa.CTitulo] = "no debe quedar";
                mQuitar.Quitar.Add("/M/Dos");
                string quitar;
                try { Modificar(cn, mQuitar); quitar = "sin error"; }
                catch (InvalidOperationException) { quitar = "rechazada"; }
                Check("M14 quitar categoria (sin regla): el escritor la rechaza antes de la base; nada cambia", "rechazada|Titulo M|2",
                      quitar + "|" + Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'" + cm + "'") + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + cm + "' AND VigenteEnOrigen = 1"));

                // Concurrencia al SUBIR el % de una ligada (K11 cubre ligar): A
                // sube 50 -> 55 con la tx abierta; B (40 -> 50) espera el candado
                // y se rechaza: la ruta nunca pasa de 100.
                var ca = Crear(cn, Alta(hoy, "/M/Carrera", "50"));
                var cb = Crear(cn, Alta(hoy, "/M/Carrera", "40"));
                string resM = null;
                bool esperoM;
                using (var cnA = Abrir(Base))
                using (var cnB = Abrir(Base))
                {
                    var pa = Mod(ca, hoy); pa.Pcts.Add(new CategoriaPlan { Ruta = "/M/Carrera", Pct = 0.55m });
                    var pb = Mod(cb, hoy); pb.Pcts.Add(new CategoriaPlan { Ruta = "/M/Carrera", Pct = 0.5m });
                    var txA = cnA.BeginTransaction();
                    new EscritorGestionAdminSql().Modificar(cnA, txA, pa, @"DOM\a");
                    var hilo = new Thread(() => { resM = Error(() => Modificar(cnB, pb, @"DOM\b")); });
                    hilo.Start();
                    esperoM = !hilo.Join(2000);
                    txA.Commit();
                    hilo.Join(30000);
                }
                Check("M15 concurrencia al subir %: B espera el candado de A y se rechaza; total 95, B sigue en 40", "True|51010|0.9500|0.4000",
                      esperoM + "|" + resM + "|" + Celda(Uno(cn, "SELECT SUM(PctDisminucion) FROM dbo.ProblemCategoria WHERE Categoria = N'/M/Carrera'")) + "|" +
                      Celda(Uno(cn, "SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'" + cb + "' AND Categoria = N'/M/Carrera'")));
                Check("M16 Codigo intacto tras todo: una sola fila con ese Codigo, ningun Codigo nuevo por Modificar", "1",
                      Uno(cn, "SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'" + cm + "'"));

                // Historial de Estado del M1 (En Análisis -> En Solución), por
                // dbo.trg_Problem_EstadoEvento con la atribucion de la sesion.
                Check("M17 Estado cambiado por Modificar: 'U' En Análisis -> En Solución, ADMIN con el usuario, sin solicitud",
                      "En Análisis|En Solución|U|ADMIN|DOM\\prueba|NULL|0",
                      Filas(cn, "SELECT EstadoAnterior, EstadoNuevo, Operacion, Origen, Usuario, SolicitudId, Reconstruido FROM dbo.ProblemEstadoEvento " +
                                "WHERE Codigo = N'" + cm + "' AND Operacion = 'U'"));
                Check("M17 ... sin cambio de Estado no hay evento nuevo (M13-M16 no lo tocaron): uno 'I' del alta y uno 'U'", "I:1;U:1",
                      Filas(cn, "SELECT Operacion + ':' + CONVERT(varchar(10), COUNT(*)) FROM dbo.ProblemEstadoEvento WHERE Codigo = N'" + cm + "' GROUP BY Operacion ORDER BY Operacion"));

                // Fecha de cierre: asignar (NULL -> 15/10), extender (15/10 ->
                // 30/10) y adelantar (30/10 -> 20/10). Solo la extension cuenta.
                var cc = Crear(cn, Alta(hoy, "/M/Tres", "10"));
                Func<string, string> cierre = f =>
                {
                    var m = Mod(cc, hoy);
                    m.Problem[PeticionModificarAdmin.CFCierre] = f;
                    return Error(() => Modificar(cn, m));
                };
                Func<string> cierreYContador = () =>
                    Filas(cn, "SELECT FechaCierre, NroCambioFechaCierre FROM dbo.Problem WHERE Codigo = N'" + cc + "'");
                Func<string> eventosCierre = () =>
                    Filas(cn, "SELECT FechaAnterior, FechaNueva, Operacion, Origen, Usuario FROM dbo.ProblemFechaEvento " +
                              "WHERE Codigo = N'" + cc + "' AND Campo = 'FechaCierre' AND Categoria IS NULL AND Operacion = 'U' ORDER BY IdEvento");
                Check("M18 asignar FechaCierre 2026-10-15 (antes NULL): guardada, el contador no sube", "sin error|2026-10-15|0",
                      cierre("2026-10-15") + "|" + cierreYContador());
                Check("M19 extender FechaCierre 2026-10-15 -> 2026-10-30: dbo.Problem la guarda y el contador sube a 1", "sin error|2026-10-30|1",
                      cierre("2026-10-30") + "|" + cierreYContador());
                Check("M19 ... dbo.ProblemFechaEvento: 'U' 2026-10-15 -> 2026-10-30, ADMIN con el usuario",
                      "NULL|2026-10-15|U|ADMIN|DOM\\prueba;2026-10-15|2026-10-30|U|ADMIN|DOM\\prueba",
                      eventosCierre());
                Check("M20 adelantar FechaCierre 2026-10-30 -> 2026-10-20: se guarda y queda en el historial, pero el contador sigue en 1",
                      "sin error|2026-10-20|1|2026-10-30|2026-10-20|U|ADMIN|DOM\\prueba",
                      cierre("2026-10-20") + "|" + cierreYContador() + "|" +
                      Filas(cn, "SELECT TOP (1) FechaAnterior, FechaNueva, Operacion, Origen, Usuario FROM dbo.ProblemFechaEvento " +
                                "WHERE Codigo = N'" + cc + "' AND Campo = 'FechaCierre' ORDER BY IdEvento DESC"));
                Check("M20 ... misma fecha otra vez: sin evento nuevo ni cambio del contador", "sin error|3|2026-10-20|1",
                      cierre("2026-10-20") + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cc + "' AND Campo = 'FechaCierre' AND Operacion = 'U'") + "|" +
                      cierreYContador());
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

            // ---------------- E: proteccion del cargador (ADM_04) ----------------
            Proteccion(hoy);

            // ---------------- A: sql/21 (Agrupacion sin acentos), base propia ----------------
            Acentos21(hoy);

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
        Console.WriteLine(pasadas + " PASARON · " + fallos + " FALLARON · " + noCorridas + " NO CORRIDAS (no cuentan como pasadas)");
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

    // ---------------------------------------------------------------------
    // E: proteccion del cargador (ADM_04)
    // ---------------------------------------------------------------------
    const string Adm04 = "ADM_04_usp_CargarExperiencia_proteccion.sql";
    const string Adm04Rollback = "ADM_04_usp_CargarExperiencia_proteccion_rollback.sql";
    const string Hash174bb51 = "0x3BC236C22F81E7A07A4F221A012D54669742BE96A3E31C55DFE7F848D19C67DD";
    const string DuenoStg = "SORIANA_edgarrad";

    // Staging como lo deja cargar_experiencia.py: las cuatro tablas, borradas y
    // llenas. problems: Codigo|Titulo|Estado; iniciativas: Codigo|Categoria|Pct.
    static void Staging(SqlConnection cn, string[] problems, string[] iniciativas)
    {
        Exec(cn, "DELETE stg.Problems; DELETE stg.Iniciativas; DELETE stg.CatPersona; DELETE stg.CatCategoriaDueno;");
        foreach (var p in problems)
        {
            var c = p.Split('|');
            using (var cmd = new SqlCommand("INSERT stg.Problems (Codigo, Titulo, Estado, TipoIniciativa) VALUES (@c, @t, @e, N'Problem')", cn))
            {
                cmd.Parameters.AddWithValue("@c", c[0]); cmd.Parameters.AddWithValue("@t", c[1]); cmd.Parameters.AddWithValue("@e", c[2]);
                cmd.ExecuteNonQuery();
            }
        }
        foreach (var i in iniciativas)
        {
            var c = i.Split('|');
            using (var cmd = new SqlCommand("INSERT stg.Iniciativas (Codigo, Categoria, PctDisminucion, TipoAgrupado, TipoIniciativa) VALUES (@c, @k, @p, N'Problem', N'Problem')", cn))
            {
                cmd.Parameters.AddWithValue("@c", c[0]); cmd.Parameters.AddWithValue("@k", c[1]); cmd.Parameters.AddWithValue("@p", c[2]);
                cmd.ExecuteNonQuery();
            }
        }
    }

    // Corre el cargador como cargar_experiencia.py y devuelve la columna
    // ProtegidasOmitidas del primer resultado (o "sin columna").
    static string Cargar(SqlConnection cn, SqlTransaction tx = null)
    {
        using (var cmd = new SqlCommand("dbo.usp_CargarExperiencia", cn, tx) { CommandType = System.Data.CommandType.StoredProcedure, CommandTimeout = 120 })
        {
            cmd.Parameters.AddWithValue("@Simulacion", false);
            using (var rd = cmd.ExecuteReader())
            {
                string omitidas = "sin columna";
                if (rd.Read())
                    for (var i = 0; i < rd.FieldCount; i++)
                        if (rd.GetName(i) == "ProtegidasOmitidas") omitidas = Celda(rd.GetValue(i));
                while (rd.NextResult()) { }
                return omitidas;
            }
        }
    }

    // Corre un script por lotes y junta las filas de todos sus resultados.
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
                        for (var i = 0; i < rd.FieldCount; i++) partes.Add(Celda(rd.GetValue(i)));
                        salida.Add(string.Join("|", partes));
                    }
                while (rd.NextResult());
        }
        return string.Join("\n", salida);
    }

    static string FilasDe(SqlConnection cn, string codigos)
    {
        return Filas(cn, "SELECT * FROM dbo.Problem WHERE Codigo IN (" + codigos + ") ORDER BY Codigo") + " // " +
               Filas(cn, "SELECT * FROM dbo.ProblemCategoria WHERE Codigo IN (" + codigos + ") ORDER BY Codigo, Categoria");
    }

    static string Todo(SqlConnection cn)
    {
        return Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Problem") + "/" +
               Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.ProblemCategoria") + "/" +
               Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.ProblemFechaEvento") + "/" +
               (HayHistorialEstado(cn) ? Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.ProblemEstadoEvento") : "sin historial de Estado") + "/" +
               Filas(cn, "SELECT COUNT(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM adm.IniciativaProtegida");
    }

    // dbo.ProblemEstadoEvento (y su trigger) solo estan en la replica local con
    // lo copiado de la VM; la del repo no la trae. Sin ella, los casos de
    // historial de Estado se reportan como NO CORRIDOS.
    static bool HayHistorialEstado(SqlConnection cn)
    {
        return Uno(cn, "SELECT OBJECT_ID(N'dbo.ProblemEstadoEvento', N'U')") != null;
    }

    static PlanModificarAdmin Titulo(string codigo, DateTime hoy, string titulo)
    {
        var p = Mod(codigo, hoy);
        p.Problem[SolicitudIniciativa.CTitulo] = titulo;
        return p;
    }

    static void Proteccion(DateTime hoy)
    {
        if (!HayBackend()) { NoCorrida("E*", "falta " + Backend); return; }
        using (var m = Abrir("master"))
            Check("E1 ADM_04 no corre fuera de GestionAdminPrueba_* sin aprobar_backend = ADM_04", "True",
                  LotesError(m, LeerBackend(Adm04)).Contains("ADM_04 SIN APROBAR"));

        using (var cn = Abrir(Base))
        {
            Check("E2 la base parte del cargador verificado (174bb51)", Hash174bb51, HashDef(cn, "dbo.usp_CargarExperiencia"));
            Exec(cn, "EXEC sp_rename N'adm.IniciativaProtegida', N'IniciativaProtegidaX';");
            Check("E3 sin adm.IniciativaProtegida (sql/18), ADM_04 se niega y no toca el cargador", "True|" + Hash174bb51,
                  LotesError(cn, LeerBackend(Adm04)).Contains("falta adm.IniciativaProtegida") + "|" + HashDef(cn, "dbo.usp_CargarExperiencia"));
            Exec(cn, "EXEC sp_rename N'adm.IniciativaProtegidaX', N'IniciativaProtegida';");

            Lotes(cn, LeerBackend(Adm04));
            var hashAdm04 = HashDef(cn, "dbo.usp_CargarExperiencia");
            Console.WriteLine("   hash ADM_04 = " + hashAdm04);
            Check("E4 instalado: la definicion cambio y el rollback trae ese hash", "True|True",
                  (hashAdm04 != Hash174bb51) + "|" + LeerBackend(Adm04Rollback).Contains(hashAdm04));
            Check("E5 instalarlo otra vez se niega (ya no es 174bb51)", "True",
                  LotesError(cn, LeerBackend(Adm04)).Contains("NO es la verificada"));
            Check("E6 ADM_03 (retiro) tambien se niega sobre ADM_04: no se apilan", "True",
                  LotesError(cn, LeerBackend("ADM_03_usp_CargarExperiencia_retirado.sql")).Contains("NO es la verificada"));

            // Iniciativas del Excel (sin proteger) y categorias de prueba.
            Exec(cn, @"
INSERT dbo.Categorias (Id, RutaCompleta, Inactiva, VigenteEnOrigen) VALUES
 (N'E1', N'/E/Uno', 0, 1), (N'E2', N'/E/Dos', 0, 1), (N'E3', N'/E/Tres', 0, 1), (N'E4', N'/E/Excel', 0, 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaCreacion, FechaAnalisis, VigenteEnOrigen) VALUES
 (N'PRB 2024-000501', N'Problem', N'Excel 501', N'Cerrado', '2024-01-01', '2024-01-16', 1),
 (N'PRB 2024-000502', N'Problem', N'Excel 502', N'Cerrado', '2024-01-01', '2024-01-16', 1),
 (N'PRB 2024-000503', N'Problem', N'Excel 503', N'Cerrado', '2024-01-01', '2024-01-16', 1),
 (N'PRB 2024-000504', N'Problem', N'Excel 504', N'Cerrado', '2024-01-01', '2024-01-16', 1),
 (N'PRB 2024-000505', N'Problem', N'Excel 505', N'Cerrado', '2024-01-01', '2024-01-16', 1);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion) VALUES
 (N'PRB 2024-000502', N'/E/Tres', N'Problem', N'Problem', 0.1000),
 (N'PRB 2024-000503', N'/E/Tres', N'Problem', N'Problem', 0.1000),
 (N'PRB 2024-000504', N'/E/Tres', N'Problem', N'Problem', 0.1000),
 (N'PRB 2024-000504', N'/E/Uno',  N'Problem', N'Problem', 0.1000);");

            // Alta de Admin con dos categorias; dos del Excel que Admin modifica.
            var a = Crear(cn, Alta(hoy, "/E/Uno", "20", "/E/Dos", "30"));
            Modificar(cn, Titulo("PRB 2024-000503", hoy, "Admin 503"));
            Modificar(cn, Titulo("PRB 2024-000504", hoy, "Admin 504"));
            Check("E7 (6) alta y modificacion quedan protegidas en su misma transaccion", "ALTA|DOM\\prueba;MODIFICACION|DOM\\prueba;MODIFICACION|DOM\\prueba",
                  Filas(cn, "SELECT Motivo, Usuario FROM adm.IniciativaProtegida WHERE Codigo IN (N'" + a + "', N'PRB 2024-000503', N'PRB 2024-000504') " +
                            "ORDER BY CASE Codigo WHEN N'" + a + "' THEN 0 WHEN N'PRB 2024-000503' THEN 1 ELSE 2 END"));
            Modificar(cn, Titulo("PRB 2024-000504", hoy, "Admin 504 bis"));
            Check("E8 una segunda modificacion no duplica ni cambia el registro", "1|MODIFICACION",
                  Filas(cn, "SELECT COUNT(*), MIN(Motivo) FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2024-000504'"));

            var prot = "N'" + a + "', N'PRB 2024-000503', N'PRB 2024-000504'";
            var antesProt = FilasDe(cn, prot);
            var eventosAntes = Filas(cn, "SELECT IdEvento, Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen FROM dbo.ProblemFechaEvento ORDER BY IdEvento");
            var hayEstado = HayHistorialEstado(cn);
            var estadosAntes = hayEstado ? Filas(cn, "SELECT IdEvento, Codigo, EstadoAnterior, EstadoNuevo, Operacion, Origen, Usuario FROM dbo.ProblemEstadoEvento ORDER BY IdEvento") : null;
            var maxEstado = hayEstado ? Celda(Uno(cn, "SELECT ISNULL(MAX(IdEvento), 0) FROM dbo.ProblemEstadoEvento")) : null;
            var registroAntes = Filas(cn, "SELECT * FROM adm.IniciativaProtegida ORDER BY Codigo");
            var maxEvento = Celda(Uno(cn, "SELECT ISNULL(MAX(IdEvento), 0) FROM dbo.ProblemFechaEvento"));

            // El Excel: trae a la de Admin (con otro titulo, otro %, una categoria
            // nueva y SIN /E/Dos), a 504 sin /E/Tres, a 501 y 505; no trae 502 ni 503.
            Staging(cn,
                new[] { a + "|pisado por el Excel|Cerrado", "PRB 2024-000504|pisado 504|Cerrado",
                        "PRB 2024-000501|Excel 501 nuevo|En Solución", "PRB 2024-000505|Excel 505|Cerrado" },
                new[] { a + "|/E/Uno|0.9", a + "|/E/Excel|0.5", "PRB 2024-000504|/E/Uno|0.9",
                        "PRB 2024-000501|/E/Uno|0.4" });
            var omitidas = Cargar(cn);
            Check("E9 la carga reporta las protegidas que vinieron en el Excel", "2", omitidas);
            Check("E10 (1)(3) protegidas en el Excel: Problem y TODAS sus categorias identicas (ni %, ni alta, ni baja)", antesProt, FilasDe(cn, prot));
            Check("E11 (2) protegida que no viene en el Excel: sigue vigente, con su titulo", "1|Admin 503",
                  Filas(cn, "SELECT VigenteEnOrigen, Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2024-000503'"));
            Check("E12 (3) no se le agrego la categoria del Excel ni se dio de baja /E/Dos", "0|1",
                  Filas(cn, "SELECT (SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + a + "' AND Categoria = N'/E/Excel'), " +
                            "(SELECT VigenteEnOrigen FROM dbo.ProblemCategoria WHERE Codigo = N'" + a + "' AND Categoria = N'/E/Dos')"));
            Check("E13 (4) sin proteger en el Excel: se actualiza y se le agrega la categoria, como antes", "Excel 501 nuevo|En Solución|1;/E/Uno|0.4000|1",
                  Filas(cn, "SELECT Titulo, Estado, VigenteEnOrigen FROM dbo.Problem WHERE Codigo = N'PRB 2024-000501'") + ";" +
                  Filas(cn, "SELECT Categoria, PctDisminucion, VigenteEnOrigen FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2024-000501'"));
            Check("E14 (5) sin proteger y fuera del Excel: baja de la iniciativa y su categoria, como antes", "0|0",
                  Filas(cn, "SELECT (SELECT VigenteEnOrigen FROM dbo.Problem WHERE Codigo = N'PRB 2024-000502'), " +
                            "(SELECT VigenteEnOrigen FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2024-000502')"));
            var eventosDespues = Filas(cn, "SELECT IdEvento, Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen FROM dbo.ProblemFechaEvento ORDER BY IdEvento");
            Check("E15 (11) el historial previo sigue intacto y no hay eventos nuevos de protegidas", "True|0",
                  eventosDespues.StartsWith(eventosAntes) + "|" +
                  Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo IN (" + prot + ") AND IdEvento > " + maxEvento));
            const string e15b = "E15b (11) historial de Estado (trigger real de la VM): lo previo intacto, ningun evento nuevo de protegidas, y si el de 501 (sin proteger, cambio de estado)";
            if (!hayEstado) NoCorrida(e15b, "la replica no trae dbo.ProblemEstadoEvento");
            else
            {
                var estadosDespues = Filas(cn, "SELECT IdEvento, Codigo, EstadoAnterior, EstadoNuevo, Operacion, Origen, Usuario FROM dbo.ProblemEstadoEvento ORDER BY IdEvento");
                Check(e15b, "True|0|1",
                      estadosDespues.StartsWith(estadosAntes) + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemEstadoEvento WHERE Codigo IN (" + prot + ") AND IdEvento > " + maxEstado) + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemEstadoEvento WHERE Codigo = N'PRB 2024-000501' AND IdEvento > " + maxEstado + " AND Origen = 'NO_DECLARADO'"));
            }
            Cargar(cn); Cargar(cn);
            Check("E16 (10) tres corridas: el registro de protegidas y sus filas no cambian", registroAntes + " // " + antesProt,
                  Filas(cn, "SELECT * FROM adm.IniciativaProtegida ORDER BY Codigo") + " // " + FilasDe(cn, prot));

            // (7) Registrar la proteccion falla: no se guarda nada de Admin.
            Exec(cn, "CREATE TRIGGER adm.trg_PruebaFallaProteccion ON adm.IniciativaProtegida INSTEAD OF INSERT AS THROW 50999, N'falla forzada', 1;");
            var antesFalla = Todo(cn);
            var codigoFalla = "sin intento";
            var errAlta = Error(() => { codigoFalla = Crear(cn, Alta(hoy, "/E/Tres", "5")); });
            var errMod = Error(() => Modificar(cn, Titulo("PRB 2024-000505", hoy, "Admin 505 sin proteger")));
            Check("E17 (7) si no se puede proteger, el alta y la modificacion fallan y no queda nada", "50999|50999|" + antesFalla,
                  errAlta + "|" + errMod + "|" + Todo(cn));
            Exec(cn, "DROP TRIGGER adm.trg_PruebaFallaProteccion;");

            // (8) La consulta de protegidas falla: el cargador no escribe nada.
            var antesSinTabla = Todo(cn);
            Exec(cn, "EXEC sp_rename N'adm.IniciativaProtegida', N'IniciativaProtegidaX';");
            var errSinTabla = Error(() => Cargar(cn));
            Exec(cn, "EXEC sp_rename N'adm.IniciativaProtegidaX', N'IniciativaProtegida';");
            Check("E18 (8) sin la tabla de protegidas el cargador falla (208) y no escribe", "208|" + antesSinTabla, errSinTabla + "|" + Todo(cn));

            // (8) El candado no se obtiene (Admin guardando > 30 s): falla cerrada.
            using (var b = Abrir(Base))
            {
                Exec(b, "BEGIN TRAN; EXEC sp_getapplock @Resource = N'adm.proteccion', @LockMode = 'Shared', @LockOwner = 'Transaction';");
                var antesCandado = Todo(cn);
                var errCandado = Error(() => Cargar(cn));
                Exec(b, "ROLLBACK;");
                Check("E19 (8) sin el candado adm.proteccion en 30 s el cargador falla (51951) y no escribe", "51951|" + antesCandado, errCandado + "|" + Todo(cn));
            }

            // (9a) Admin primero: su transaccion sigue abierta cuando arranca la carga.
            Staging(cn, new[] { "PRB 2024-000505|pisado concurrente|Cerrado" }, new string[0]);
            using (var b = Abrir(Base))
            {
                var tx = b.BeginTransaction();
                new EscritorGestionAdminSql().Modificar(b, tx, Titulo("PRB 2024-000505", hoy, "Admin 505"), @"DOM\prueba");
                string resultado = null;
                var hilo = new Thread(() => { using (var c = Abrir(Base)) resultado = Error(() => Cargar(c)); });
                hilo.Start();
                var esperaba = !hilo.Join(2000);
                tx.Commit();
                hilo.Join();
                Check("E20 (9) Admin primero: la carga espera al COMMIT de Admin y luego respeta la proteccion", "True|sin error|Admin 505|1",
                      esperaba + "|" + resultado + "|" + Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2024-000505'") + "|" +
                      Uno(cn, "SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2024-000505'"));
            }

            // (9b) La carga primero: Admin espera a que termine y escribe despues.
            Exec(cn, "INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaCreacion, VigenteEnOrigen) VALUES (N'PRB 2024-000506', N'Problem', N'Excel 506', N'Cerrado', '2024-01-01', 1);");
            Staging(cn, new[] { "PRB 2024-000506|Excel 506 carga|Cerrado" }, new string[0]);
            using (var c = Abrir(Base))
            {
                var tx = c.BeginTransaction();
                Cargar(c, tx);
                string resultado = null;
                var hilo = new Thread(() => { using (var b = Abrir(Base)) resultado = Error(() => Modificar(b, Titulo("PRB 2024-000506", hoy, "Admin 506"))); });
                hilo.Start();
                var esperaba = !hilo.Join(2000);
                tx.Commit();
                hilo.Join();
                Staging(cn, new[] { "PRB 2024-000506|pisado despues|Cerrado" }, new string[0]);
                Cargar(cn);
                Check("E21 (9) carga primero: Admin espera, escribe despues y la siguiente carga ya no lo pisa", "True|sin error|Admin 506|1",
                      esperaba + "|" + resultado + "|" + Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2024-000506'") + "|" +
                      Celda(Uno(cn, "SELECT VigenteEnOrigen FROM dbo.Problem WHERE Codigo = N'PRB 2024-000506'")));
            }

            // Cuenta como la del operador del Excel: EXECUTE sobre el cargador y,
            // como stg no es de dbo, lo minimo de stg (cargar_experiencia.py
            // borra e inserta; el cargador lee). Nada sobre dbo.Problem ni adm:
            // OBJECT_ID no ve adm.IniciativaProtegida con ella (la version con
            // esa guarda fallaba en cada carga); el cargador tiene que funcionar igual.
            var loginEtl = "CargaExcel_" + DateTime.UtcNow.ToString("HHmmssfff");
            var claveEtl = "Ce!" + Guid.NewGuid().ToString("N");
            try
            {
                using (var m = Abrir("master")) Exec(m, "CREATE LOGIN [" + loginEtl + "] WITH PASSWORD = N'" + claveEtl + "', CHECK_POLICY = OFF;");
                Exec(cn, "CREATE USER [" + loginEtl + "] FOR LOGIN [" + loginEtl + "]; GRANT EXECUTE ON dbo.usp_CargarExperiencia TO [" + loginEtl + "]; " +
                         "GRANT SELECT, INSERT, DELETE ON SCHEMA::stg TO [" + loginEtl + "];");
                // Sin SELECT en stg (solo EXECUTE, lo que bastaba con stg de dbo): 229 antes de escribir.
                Exec(cn, "DENY SELECT ON SCHEMA::stg TO [" + loginEtl + "];");
                Staging(cn, new[] { a + "|pisado sin permiso en stg|Cerrado" }, new string[0]);
                var antesSinStg = Todo(cn);
                string resultadoSinStg;
                using (var e = AbrirSql(Base, loginEtl, claveEtl)) resultadoSinStg = Error(() => Cargar(e));
                Check("E29b stg de otro dueno (como la VM): solo con EXECUTE el cargador no lee stg (229) y no escribe nada", "229|" + antesSinStg,
                      resultadoSinStg + "|" + Todo(cn));
                Exec(cn, "REVOKE SELECT ON SCHEMA::stg FROM [" + loginEtl + "]; GRANT SELECT ON SCHEMA::stg TO [" + loginEtl + "];");
                Exec(cn, "INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaCreacion, VigenteEnOrigen) VALUES (N'PRB 2024-000507', N'Problem', N'Excel 507', N'Cerrado', '2024-01-01', 1);");
                Staging(cn, new[] { a + "|pisado por la cuenta del ETL|Cerrado", "PRB 2024-000507|Excel 507 por la cuenta del ETL|Cerrado" }, new string[0]);
                var antesEtl = FilasDe(cn, prot);
                string verObjeto, resultadoEtl;
                using (var e = AbrirSql(Base, loginEtl, claveEtl))
                {
                    verObjeto = Celda(Uno(e, "SELECT OBJECT_ID(N'adm.IniciativaProtegida', N'U')"));
                    resultadoEtl = Error(() => Cargar(e));
                }
                Check("E29 con EXECUTE + stg (como el operador): OBJECT_ID no ve la tabla, pero la carga corre, respeta las protegidas y carga la otra",
                      "NULL|sin error|True|Excel 507 por la cuenta del ETL",
                      verObjeto + "|" + resultadoEtl + "|" + (antesEtl == FilasDe(cn, prot)) + "|" +
                      Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2024-000507'"));
            }
            finally
            {
                Exec(cn, "IF USER_ID(N'" + loginEtl + "') IS NOT NULL DROP USER [" + loginEtl + "];");
                using (var m = Abrir("master")) Exec(m, "IF SUSER_ID(N'" + loginEtl + "') IS NOT NULL DROP LOGIN [" + loginEtl + "];");
            }

            // Cuenta como la del sitio con la seccion 8 de sql/18 completa (GRANT
            // + DENY): Admin sigue protegiendo por encadenamiento de propietario,
            // pero a mano no se puede quitar ni cambiar una proteccion.
            var loginSitio = "SitioDeny_" + DateTime.UtcNow.ToString("HHmmssfff");
            var claveSitio = "Sd!" + Guid.NewGuid().ToString("N");
            try
            {
                using (var m = Abrir("master")) Exec(m, "CREATE LOGIN [" + loginSitio + "] WITH PASSWORD = N'" + claveSitio + "', CHECK_POLICY = OFF;");
                Exec(cn, "CREATE USER [" + loginSitio + "] FOR LOGIN [" + loginSitio + "]; ALTER ROLE db_datareader ADD MEMBER [" + loginSitio + "]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [" + loginSitio + "]; GRANT EXECUTE ON SCHEMA::dbo TO [" + loginSitio + "]; " +
                         "GRANT EXECUTE ON SCHEMA::adm TO [" + loginSitio + "]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [" + loginSitio + "];");
                var antesDeny = Filas(cn, "SELECT * FROM adm.IniciativaProtegida ORDER BY Codigo");
                string nuevo = null, borrar, cambiar, agregar;
                using (var s = AbrirSql(Base, loginSitio, claveSitio))
                {
                    nuevo = Crear(s, Alta(hoy, "/E/Tres", "5"), @"DOM\sitio");
                    borrar = Error(() => Exec(s, "DELETE adm.IniciativaProtegida WHERE Codigo = N'PRB 2024-000503';"));
                    cambiar = Error(() => Exec(s, "UPDATE adm.IniciativaProtegida SET Motivo = 'MIGRACION' WHERE Codigo = N'PRB 2024-000503';"));
                    agregar = Error(() => Exec(s, "INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario) VALUES (N'PRB 2024-000501', 'MIGRACION', N'x');"));
                }
                Check("E30 sitio con GRANT + DENY de sql/18 seccion 8: el alta se protege (encadenamiento); DELETE/UPDATE/INSERT directos se niegan (229) y nada mas cambia",
                      "ALTA|DOM\\sitio|229|229|229|" + antesDeny,
                      Filas(cn, "SELECT Motivo, Usuario FROM adm.IniciativaProtegida WHERE Codigo = N'" + nuevo + "'") + "|" + borrar + "|" + cambiar + "|" + agregar + "|" +
                      Filas(cn, "SELECT * FROM adm.IniciativaProtegida WHERE Codigo <> N'" + nuevo + "' ORDER BY Codigo"));
            }
            finally
            {
                Exec(cn, "IF USER_ID(N'" + loginSitio + "') IS NOT NULL DROP USER [" + loginSitio + "];");
                using (var m = Abrir("master")) Exec(m, "IF SUSER_ID(N'" + loginSitio + "') IS NOT NULL DROP LOGIN [" + loginSitio + "];");
            }

            // Control de E30: la MISMA cuenta sin el DENY. Si el 229 de E30 no
            // viniera del DENY, aqui tambien saldria.
            var loginSinDeny = "SitioSinDeny_" + DateTime.UtcNow.ToString("HHmmssfff");
            var claveSinDeny = "Sn!" + Guid.NewGuid().ToString("N");
            try
            {
                using (var m = Abrir("master")) Exec(m, "CREATE LOGIN [" + loginSinDeny + "] WITH PASSWORD = N'" + claveSinDeny + "', CHECK_POLICY = OFF;");
                Exec(cn, "CREATE USER [" + loginSinDeny + "] FOR LOGIN [" + loginSinDeny + "]; ALTER ROLE db_datareader ADD MEMBER [" + loginSinDeny + "]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [" + loginSinDeny + "]; GRANT EXECUTE ON SCHEMA::dbo TO [" + loginSinDeny + "]; " +
                         "GRANT EXECUTE ON SCHEMA::adm TO [" + loginSinDeny + "];");
                var antesSin = Filas(cn, "SELECT * FROM adm.IniciativaProtegida ORDER BY Codigo");
                string nuevoSin, fila, upd, trasUpd, del, trasDel, ins;
                using (var s = AbrirSql(Base, loginSinDeny, claveSinDeny))
                {
                    nuevoSin = Crear(s, Alta(hoy, "/E/Tres", "5"), @"DOM\sitio");
                    fila = Filas(cn, "SELECT Motivo, Usuario, CONVERT(varchar(30), FechaAltaUtc, 126) FROM adm.IniciativaProtegida WHERE Codigo = N'" + nuevoSin + "'");
                    upd = Error(() => Exec(s, "UPDATE adm.IniciativaProtegida SET Motivo = 'MIGRACION' WHERE Codigo = N'" + nuevoSin + "';"));
                    trasUpd = Filas(cn, "SELECT Motivo FROM adm.IniciativaProtegida WHERE Codigo = N'" + nuevoSin + "'");
                    del = Error(() => Exec(s, "DELETE adm.IniciativaProtegida WHERE Codigo = N'" + nuevoSin + "';"));
                    trasDel = Celda(Uno(cn, "SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'" + nuevoSin + "'"));
                    // Se deja como estaba (motivo, usuario y fecha) para no mover los casos de despues.
                    var f = fila.Split('|');
                    ins = Error(() => Exec(s, "INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario, FechaAltaUtc) VALUES (N'" + nuevoSin + "', N'" + f[0] + "', N'" + f[1] + "', '" + f[2] + "');"));
                }
                Check("E30n control de E30: la misma cuenta SIN el DENY si cambia, borra y agrega a mano (el 229 de E30 es del DENY)",
                      "sin error|MIGRACION|sin error|0|sin error|" + fila,
                      upd + "|" + trasUpd + "|" + del + "|" + trasDel + "|" + ins + "|" +
                      Filas(cn, "SELECT Motivo, Usuario, CONVERT(varchar(30), FechaAltaUtc, 126) FROM adm.IniciativaProtegida WHERE Codigo = N'" + nuevoSin + "'"));
                Check("E30n ... y las demas protegidas no se movieron", antesSin,
                      Filas(cn, "SELECT * FROM adm.IniciativaProtegida WHERE Codigo <> N'" + nuevoSin + "' ORDER BY Codigo"));
            }
            finally
            {
                Exec(cn, "IF USER_ID(N'" + loginSinDeny + "') IS NOT NULL DROP USER [" + loginSinDeny + "];");
                using (var m = Abrir("master")) Exec(m, "IF SUSER_ID(N'" + loginSinDeny + "') IS NOT NULL DROP LOGIN [" + loginSinDeny + "];");
            }

            // Modificar sin cambio real NO protege; con cambio real protege la
            // iniciativa ENTERA. Llamadas directas al procedimiento (el sitio ni
            // llega con cero cambios: GestionIniciativaAdmin.cs, "No hay cambios que guardar.").
            Exec(cn, @"
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaCreacion, FechaAnalisis, VigenteEnOrigen) VALUES
 (N'PRB 2024-000508', N'Problem', N'Excel 508', N'Cerrado', '2024-01-01', '2024-01-16', 1),
 (N'PRB 2024-000509', N'Problem', N'Excel 509', N'Cerrado', '2024-01-01', '2024-01-16', 1);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion) VALUES
 (N'PRB 2024-000508', N'/E/Uno',  N'Problem', N'Problem', 0.1000),
 (N'PRB 2024-000508', N'/E/Tres', N'Problem', N'Problem', 0.1000),
 (N'PRB 2024-000509', N'/E/Tres', N'Problem', N'Problem', 0.2000);");
            Func<string, string> modSql = cuerpo => Error(() => Exec(cn,
                "DECLARE @p adm.CategoriaPctTipo, @a adm.CategoriaPctTipo, @f adm.CategoriaFechaTipo; " + cuerpo));
            const string p509 = "N'PRB 2024-000509'", p508 = "N'PRB 2024-000508'";
            var antes509 = FilasDe(cn, p509) + "|" + Todo(cn);
            var r0 = modSql("EXEC adm.usp_GestionAdmin_Modificar @Usuario = N'DOM\\e31', @Codigo = " + p509 + ", @Pcts = @p, @Agregar = @a, @FechasCategoria = @f;");
            Check("E31 Modificar SIN cambios (Cambia* = 0, tablas vacias): sin error, no toca nada y NO protege", "sin error|" + antes509 + "|0",
                  r0 + "|" + FilasDe(cn, p509) + "|" + Todo(cn) + "|" + Celda(Uno(cn, "SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = " + p509)));
            var r1 = modSql("INSERT @p (Categoria, Pct) VALUES (N'/E/Tres', 0.2000); " +
                            "EXEC adm.usp_GestionAdmin_Modificar @Usuario = N'DOM\\e31', @Codigo = " + p509 + ", @CambiaTitulo = 1, @Titulo = N'Excel 509', " +
                            "@CambiaEstado = 1, @Estado = N'Cerrado', @Pcts = @p, @Agregar = @a, @FechasCategoria = @f;");
            Check("E31a Modificar con los MISMOS valores (titulo, estado, %): no protege", "sin error|0",
                  r1 + "|" + Celda(Uno(cn, "SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = " + p509)));
            var r2 = modSql("EXEC adm.usp_GestionAdmin_Modificar @Usuario = N'DOM\\e31', @Codigo = " + p509 + ", @CambiaTitulo = 1, @Titulo = N'EXCEL 509', " +
                            "@Pcts = @p, @Agregar = @a, @FechasCategoria = @f;");
            Check("E31b un cambio solo de mayusculas SI es cambio: protege", "sin error|EXCEL 509|MODIFICACION|DOM\\e31",
                  r2 + "|" + Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = " + p509) + "|" +
                  Filas(cn, "SELECT Motivo, Usuario FROM adm.IniciativaProtegida WHERE Codigo = " + p509));
            // Cambio real solo del % de UNA categoria: la proteccion cubre la
            // iniciativa entera; la carga siguiente no toca ni la otra categoria.
            var r3 = modSql("INSERT @p (Categoria, Pct) VALUES (N'/E/Uno', 0.3000); " +
                            "EXEC adm.usp_GestionAdmin_Modificar @Usuario = N'DOM\\e31', @Codigo = " + p508 + ", @Pcts = @p, @Agregar = @a, @FechasCategoria = @f;");
            var antes508 = FilasDe(cn, p508);
            Staging(cn, new[] { "PRB 2024-000508|pisado 508|Cerrado" },
                        new[] { "PRB 2024-000508|/E/Uno|0.9", "PRB 2024-000508|/E/Tres|0.9", "PRB 2024-000508|/E/Dos|0.9" });
            Cargar(cn);
            Check("E31c cambio real solo del % de /E/Uno: protege, y la carga no toca el Problem ni NINGUNA de sus categorias (ni agrega /E/Dos)",
                  "sin error|MODIFICACION|0.3000;0.1000|" + antes508,
                  r3 + "|" + Celda(Uno(cn, "SELECT Motivo FROM adm.IniciativaProtegida WHERE Codigo = " + p508)) + "|" +
                  Filas(cn, "SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = " + p508 + " ORDER BY Categoria DESC") + "|" + FilasDe(cn, p508));

            Check("E22@Simulacion = 1 sigue sin escribir con el parche", "True",
                  ((Func<bool>)(() => { var antes = Todo(cn); Exec(cn, "EXEC dbo.usp_CargarExperiencia @Simulacion = 1;"); return antes == Todo(cn); }))());

            // Diagnostico de solo lectura.
            var antesDiag = Todo(cn);
            var diag = LotesFilas(cn, LeerBackend("ADM_04_diag_proteccion.sql"));
            foreach (var l in diag.Split('\n')) if (l.StartsWith("7 ")) Console.WriteLine("   diag " + l);
            Check("E26 diag: no escribe; ve ADM_04, la tabla, y al cargador y a Admin como escritores cubiertos", "True|True|True|True|True|False",
                  (antesDiag == Todo(cn)) + "|" + diag.Contains("ADM_04 (con proteccion)|1") + "|" + diag.Contains("2 protegidas|1|TOTAL|") + "|" +
                  diag.Contains("dbo.usp_CargarExperiencia|SQL_STORED_PROCEDURE|1|1|cargador: ADM_04") + "|" +
                  diag.Contains("adm.usp_GestionAdmin_Modificar|SQL_STORED_PROCEDURE|1|1|Admin") + "|" +
                  diag.Contains("cargador SIN proteccion"));
            Check("E28 diag seccion 9: trae completas las definiciones del cargador y de los triggers de historial (la replica no tiene usp_Exp_*)", "True|True|True",
                  diag.Contains("9 definicion|dbo.usp_CargarExperiencia|") + "|" +
                  diag.Contains("9 definicion|dbo.trg_Problem_FechaEvento|") + "|" +
                  diag.Contains("9 definicion|dbo.trg_ProblemCategoria_FechaEvento|"));

            // Diag seccion 10 (cuentas) con cuentas de prueba sin login: la del
            // sitio con el DENY, una con db_datawriter sin DENY, una db_owner y
            // una como el operador del Excel (EXECUTE + stg). Solo catalogo.
            var sufijo = DateTime.UtcNow.ToString("HHmmssfff");
            string uDeny = "D10Deny_" + sufijo, uWriter = "D10Writer_" + sufijo, uOwner = "D10Owner_" + sufijo, uOper = "D10Oper_" + sufijo;
            string diag10;
            try
            {
                Exec(cn, "CREATE USER [" + uDeny + "] WITHOUT LOGIN; ALTER ROLE db_datawriter ADD MEMBER [" + uDeny + "]; " +
                         "DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [" + uDeny + "]; " +
                         "CREATE USER [" + uWriter + "] WITHOUT LOGIN; ALTER ROLE db_datawriter ADD MEMBER [" + uWriter + "]; " +
                         "CREATE USER [" + uOwner + "] WITHOUT LOGIN; ALTER ROLE db_owner ADD MEMBER [" + uOwner + "]; " +
                         "CREATE USER [" + uOper + "] WITHOUT LOGIN; GRANT EXECUTE ON dbo.usp_CargarExperiencia TO [" + uOper + "]; " +
                         "GRANT SELECT, INSERT, DELETE ON SCHEMA::stg TO [" + uOper + "];");
                var antesD10 = Todo(cn);
                diag10 = LotesFilas(cn, LeerBackend("ADM_04_diag_proteccion.sql"));
                Check("E33 diag seccion 10: DENY = NO; db_datawriter sin DENY = SI; db_owner = SI (puede quitarse el DENY); operador = no, corre el cargador y lee stg; no escribe",
                      "True|True|True|True|True|True",
                      diag10.Contains("10 cuentas|" + uDeny + "|SQL_USER|NO (DENY)|1|0|0|") + "|" +
                      diag10.Contains("10 cuentas|" + uWriter + "|SQL_USER|SI|1|0|0|") + "|" +
                      diag10.Contains("10 cuentas|" + uOwner + "|SQL_USER|SI (db_owner: se puede quitar el DENY)|1|1|1|") + "|" +
                      diag10.Contains("10 cuentas|" + uOper + "|SQL_USER|no|0|1|1|0|0|0|GRANT EXECUTE dbo.usp_CargarExperiencia; GRANT DELETE SCHEMA::stg; GRANT INSERT SCHEMA::stg; GRANT SELECT SCHEMA::stg") + "|" +
                      diag10.Contains("10 sysadmin|") + "|" + (antesD10 == Todo(cn)));
            }
            finally
            {
                foreach (var u in new[] { uDeny, uWriter, uOwner, uOper })
                    Exec(cn, "IF USER_ID(N'" + u + "') IS NOT NULL DROP USER [" + u + "];");
            }
            foreach (var l in diag10.Split('\n')) if (l.StartsWith("11 ")) Console.WriteLine("   diag " + l);
            // Esta base tiene sql/18 + sql/20: el diag (con sus revisiones de
            // sql/18, 20, 21 y 33) dice Crear = sql/20, Modificar / RevisarTope =
            // sql/18 y TicketsReduce = sql/18, los tres 'anterior' (faltan sql/21
            // y sql/33), y el trigger = sql/18 vigente. Las 5 filas exactas.
            const string Ant = " (anterior: falta la siguiente migracion)|";
            Check("E34 diag seccion 11: Crear = sql/20; Modificar, RevisarTope y TicketsReduce = sql/18 (anterior); trigger = sql/18 (vigente)",
                  "True|True|True|True|True|5",
                  diag10.Contains("11 sql/18-21|adm.usp_GestionAdmin_Crear|1|sql/20" + Ant + HashCrearSql20) + "|" +
                  diag10.Contains("11 sql/18-21|adm.usp_GestionAdmin_Modificar|1|sql/18" + Ant + HashModSql18) + "|" +
                  diag10.Contains("11 sql/18-21|adm.usp_GestionAdmin_RevisarTope|1|sql/18" + Ant + HashTopeSql18) + "|" +
                  diag10.Contains("11 sql/18-21|adm.usp_GestionAdmin_TicketsReduce|1|sql/18" + Ant +
                                  "0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46") + "|" +
                  diag10.Contains("11 sql/18-21|dbo.trg_ProblemCategoria_FechaEvento|1|sql/18 (vigente)|" +
                                  "0x820900AC17857D03793A807397456D27E94DCB0A845E6CAEB2D34A46515DDD03") + "|" +
                  Regex.Matches(diag10, @"^11 sql/18-21\|", RegexOptions.Multiline).Count);
            Check("E35 diag seccion 8: stg es de otro dueno, como en la VM", "True", diag10.Contains("8 duenos de esquema|stg|" + DuenoStg));

            Check("E27 la unica FK de la tabla SALE de ella hacia dbo.Problem, sin cascada (NO_ACTION/NO_ACTION); ninguna FK llega a ella; sin triggers",
                  "1|FK_IniciativaProtegida_Problem|Problem|NO_ACTION|NO_ACTION|0|0",
                  Filas(cn, "SELECT (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('adm.IniciativaProtegida')), f.name, " +
                            "OBJECT_NAME(f.referenced_object_id), f.delete_referential_action_desc, f.update_referential_action_desc, " +
                            "(SELECT COUNT(*) FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID('adm.IniciativaProtegida')), " +
                            "(SELECT COUNT(*) FROM sys.triggers WHERE parent_id = OBJECT_ID('adm.IniciativaProtegida')) " +
                            "FROM sys.foreign_keys AS f WHERE f.parent_object_id = OBJECT_ID('adm.IniciativaProtegida')"));

            // Retiro / rollback.
            Check("E23 con ADM_04 instalado, el rollback de 18 se niega aun forzado (51093, nombra al cargador)", "True|1",
                  ((Func<string>)(() =>
                  {
                      Exec(cn, "EXEC sys.sp_set_session_context N'forzar_rollback_18', N'SI';");
                      var r = LotesError(cn, Leer("sql", "18_gestion_admin_persistencia_rollback.sql")).StartsWith("51093:Rollback 18: dbo.usp_CargarExperiencia lee");
                      Exec(cn, "EXEC sys.sp_set_session_context N'forzar_rollback_18', NULL;");
                      return r + "|" + Uno(cn, "SELECT CASE WHEN OBJECT_ID('adm.IniciativaProtegida') IS NULL THEN 0 ELSE 1 END");
                  }))());
            var antesRollback = Todo(cn);
            Check("E24 (12) rollback de ADM_04 con protegidas y sin programador_desactivado: se niega", "True|" + hashAdm04,
                  LotesError(cn, LeerBackend(Adm04Rollback)).Contains("programador_desactivado = SI") + "|" + HashDef(cn, "dbo.usp_CargarExperiencia"));
            Exec(cn, "EXEC sys.sp_set_session_context N'programador_desactivado', N'SI';");
            Lotes(cn, LeerBackend(Adm04Rollback));
            Exec(cn, "EXEC sys.sp_set_session_context N'programador_desactivado', NULL;");
            Check("E25 (12) rollback: vuelve 174bb51 exacto y no cambia ninguna fila (ni las protegidas registradas)", Hash174bb51 + "|" + antesRollback,
                  HashDef(cn, "dbo.usp_CargarExperiencia") + "|" + Todo(cn));

            // ADM_04 -> rollback -> ADM_03 como dice el runbook: los DOS scripts
            // reales en UNA transaccion. El ALTER deja el cargador con candado de
            // esquema hasta el COMMIT: una carga lanzada en medio espera y luego
            // se encuentra el stub (51900); nunca corre 174bb51 sin proteccion.
            Lotes(cn, LeerBackend(Adm04));
            Staging(cn, new[] { "PRB 2024-000503|pisado en el hueco|Cerrado" }, new string[0]);
            var antesHueco = Todo(cn);
            string resultadoHueco = null, versionDentro, terminoEnHueco;
            var bloqueado = false;
            using (var b = Abrir(Base))
            {
                var spidA = Celda(Uno(cn, "SELECT @@SPID"));
                var spidB = Celda(Uno(b, "SELECT @@SPID"));
                Exec(cn, "BEGIN TRAN; EXEC sys.sp_set_session_context N'programador_desactivado', N'SI';");
                Lotes(cn, LeerBackend(Adm04Rollback));
                var hilo = new Thread(() => resultadoHueco = Error(() => Cargar(b)));
                hilo.Start();
                using (var o = Abrir(Base))
                    for (var i = 0; i < 100 && !bloqueado; i++)
                    {
                        bloqueado = Convert.ToInt32(Uno(o, "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id = " + spidB +
                                                           " AND blocking_session_id = " + spidA)) > 0;
                        if (!bloqueado) Thread.Sleep(100);
                    }
                terminoEnHueco = (!hilo.IsAlive).ToString();
                Lotes(cn, LeerBackend("ADM_03_usp_CargarExperiencia_retirado.sql"));
                versionDentro = Celda(Uno(cn, "SELECT CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.usp_CargarExperiencia')) LIKE N'%THROW 51900%' THEN 'ADM_03' ELSE 'OTRA' END"));
                Exec(cn, "EXEC sys.sp_set_session_context N'programador_desactivado', NULL; COMMIT;");
                hilo.Join();
            }
            Check("E32 rollback de ADM_04 + ADM_03 en UNA transaccion: la carga lanzada en medio queda bloqueada por esa sesion, no termina en el hueco, " +
                  "recibe el stub (51900) y no escribe nada",
                  "True|False|ADM_03|51900|" + antesHueco,
                  bloqueado + "|" + terminoEnHueco + "|" + versionDentro + "|" + resultadoHueco + "|" + Todo(cn));
            Lotes(cn, LeerBackend("ADM_03_usp_CargarExperiencia_retirado_rollback.sql"));
            Check("E32 ... y el rollback de ADM_03 deja 174bb51", Hash174bb51, HashDef(cn, "dbo.usp_CargarExperiencia"));

            // Control: los mismos scripts SIN la transaccion. En el hueco corre
            // 174bb51 y pisa la protegida: el riesgo que E32 cierra es real.
            Lotes(cn, LeerBackend(Adm04));
            Exec(cn, "EXEC sys.sp_set_session_context N'programador_desactivado', N'SI';");
            Lotes(cn, LeerBackend(Adm04Rollback));
            Exec(cn, "EXEC sys.sp_set_session_context N'programador_desactivado', NULL;");
            using (var b = Abrir(Base)) Cargar(b);
            Check("E32n control: sin la transaccion, una carga entre el rollback y ADM_03 SI pisa la protegida", "pisado en el hueco",
                  Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2024-000503'"));
            Exec(cn, "DELETE stg.Problems; DELETE stg.Iniciativas;");
        }
    }

    // ---------------------------------------------------------------------
    // A: sql/21 (Agrupacion sin acentos en el tope), en su PROPIA base
    // desechable: la principal sigue con sql/18 + sql/20, que es lo que
    // revisan E34 y el diag ADM_04 sec 11.
    // ---------------------------------------------------------------------
    const string HashTopeSql18 = "0x5C43DEBA819BA2D1AC3C13E1A32E409EC5BE1729BE9991DB5D73B64C48C43898";
    const string HashModSql18 = "0x9D98582F2D08B1599CADFDE7BEB0C86168483E311758E6F9FA3B317AD529293E";
    const string HashTopeSql21 = "0x8F654F5AD01FD49C974F2CD707DA696FCC7F04067F213CB0E1E8C37C2FB4DFB7";
    const string HashCrearSql21 = "0x540F83EF4AF3AB4A3D3E2E8E7B6D4DE75B7731E98085DAD11CF54B14A4478D79";
    const string HashModSql21 = "0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3";

    static string Hashes21(SqlConnection cn)
    {
        return HashDef(cn, "adm.usp_GestionAdmin_RevisarTope") + "|" + HashDef(cn, "adm.usp_GestionAdmin_Crear") + "|" +
               HashDef(cn, "adm.usp_GestionAdmin_Modificar");
    }

    static void Acentos21(DateTime hoy)
    {
        var antes = HashTopeSql18 + "|" + HashCrearSql20 + "|" + HashModSql18;
        var despues = HashTopeSql21 + "|" + HashCrearSql21 + "|" + HashModSql21;
        var sql21 = Leer("sql", "21_gestion_admin_agrupacion_acentos.sql");
        var rb21 = Leer("sql", "21_gestion_admin_agrupacion_acentos_rollback.sql");
        using (var m = Abrir("master"))
            Check("A0 sql/21 no corre fuera de GestionAdminPrueba_* sin aprobar_migracion = 21", "True",
                  LotesError(m, sql21).Contains("Migracion 21 SIN APROBAR"));

        var db = Base + "_a21";
        try
        {
            Preparar(db);
            using (var cn = Abrir(db))
            {
                // "Adopcion" con tilde (NCHAR(243)), como la guarda el alta de Admin.
                Exec(cn, @"
DECLARE @ado nvarchar(100) = N'Adopci' + NCHAR(243) + N'n';
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaCreacion, FechaAnalisis, VigenteEnOrigen) VALUES
 (N'ADO 2026-000801', @ado, N'Adopcion con tilde A', N'En Análisis', '2026-09-01', '2026-09-16', 1),
 (N'PRB 2026-000802', N'Problem', N'Problem vivo', N'En Solución', '2026-09-01', '2026-09-16', 1),
 (N'ADO 2026-000803', @ado, N'Adopcion con tilde B', N'En Análisis', '2026-09-01', '2026-09-16', 1);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion) VALUES
 (N'ADO 2026-000801', N'/D/Uno', @ado, @ado, 0.6000),
 (N'ADO 2026-000801', N'/D/Dos', @ado, @ado, 0.6000),
 (N'PRB 2026-000802', N'/D/Tres', N'Problem', N'Problem', 0.6000),
 (N'PRB 2026-000802', N'/P/Sitio 1', N'Problem', N'Problem', 0.6000),
 (N'PRB 2026-000802', N'/P/Sitio 2', N'Problem', N'Problem', 0.6000),
 (N'PRB 2026-000802', N'/P/Sitio 3', N'Problem', N'Problem', 0.6000),
 (N'ADO 2026-000803', N'/P/Sitio 2', @ado, @ado, 0.3000),
 (N'ADO 2026-000803', N'/P/Sitio 3', @ado, @ado, 0.3000);");
                var ado = "Adopción";
                Check("A1 la base parte de sql/18 + sql/20 (hashes del diag ADM_04 sec 11)", antes, Hashes21(cn));

                // Sin sql/21: el defecto (lo que se arregla).
                Check("A2 sin sql/21: 60% de Adopcion con tilde en /D/Uno no cuenta: +50% Problem pasa (110%)", "sin error",
                      Error(() => Crear(cn, Alta(hoy, "/D/Uno", "50"))));
                Check("A2b sin sql/21: alta Adopcion con tilde no revisa el tope: +50% sobre 60% Problem pasa", "sin error",
                      Error(() => Crear(cn, AltaTipo(hoy, "PRB", ado, "En Análisis", "/D/Tres", "50"))));
                var subeAntes = Mod("ADO 2026-000803", hoy);
                subeAntes.Pcts.Add(new CategoriaPlan { Ruta = "/P/Sitio 2", Pct = 0.5m });
                Check("A2c sin sql/21: subir 30% -> 50% una categoria Adopcion con tilde sobre 60% vivo pasa", "sin error",
                      Error(() => Modificar(cn, subeAntes)));

                // Postcondicion: un cuerpo distinto al esperado -> ROLLBACK.
                Func<string, string> cuerpoCambiado = t => t.Replace("SET NOCOUNT ON; SET XACT_ABORT ON;", "SET NOCOUNT ON; SET XACT_ABORT ON; /* x */");
                Check("A3 sql/21 cuyo ALTER no deja el hash de sql/21: ROLLBACK, sin transaccion abierta, siguen los de antes", "True|0|True|0|" + antes,
                      Rechazo(cn, cuerpoCambiado(sql21), "no quedo como se esperaba") + "|" + Hashes21(cn));

                Lotes(cn, sql21);
                Check("A4 sql/21 aplicada: los tres procedimientos con el hash de sql/21", despues, Hashes21(cn));
                Check("A4b parametros sin cambio (Crear sigue con @OwnerProblem/@OwnerServicio de sql/20)", "2",
                      Uno(cn, "SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear') AND name IN (N'@OwnerProblem', N'@OwnerServicio')"));

                Check("A5 con sql/21: 60% Adopcion con tilde en /D/Dos cuenta: +50% Problem -> 51010", "51010",
                      Error(() => Crear(cn, Alta(hoy, "/D/Dos", "50"))));
                Check("A5b ... y +40% (100% exacto) pasa", "sin error", Error(() => Crear(cn, Alta(hoy, "/D/Dos", "40"))));
                Check("A6 alta Adopcion con tilde revisa el tope: +50% sobre 60% Problem -> 51010", "51010",
                      Error(() => Crear(cn, AltaTipo(hoy, "PRB", ado, "En Análisis", "/P/Sitio 1", "50"))));
                Check("A6b alta Adopcion con tilde CERRADA no consume (el estado sigue decidiendo): sin error", "sin error",
                      Error(() => Crear(cn, AltaTipo(hoy, "PRB", ado, "Cerrado", "/P/Sitio 1", "50"))));
                var sube = Mod("ADO 2026-000803", hoy);
                sube.Pcts.Add(new CategoriaPlan { Ruta = "/P/Sitio 3", Pct = 0.5m });
                Check("A7 subir 30% -> 50% una categoria Adopcion con tilde sobre 60% vivo -> 51010, sin cambio", "51010|0.3000",
                      Error(() => Modificar(cn, sube)) + "|" +
                      Celda(Uno(cn, "SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'ADO 2026-000803' AND Categoria = N'/P/Sitio 3'")));
                Check("A7b los datos guardados no cambiaron de grafia (sigue con tilde)", "4",
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE TipoAgrupado = N'Adopci' + NCHAR(243) + N'n' COLLATE Latin1_General_BIN2 AND Codigo IN (N'ADO 2026-000801', N'ADO 2026-000803')"));

                Check("A8 correr sql/21 otra vez se niega ('ya aplicada'), sin transaccion abierta, sin tocar nada", "True|0|True|0|" + despues,
                      Rechazo(cn, sql21, "ya aplicada") + "|" + Hashes21(cn));
                Check("A9 rollback cuyo ALTER no deja los de antes: ROLLBACK, siguen los de sql/21", "True|0|True|0|" + despues,
                      Rechazo(cn, cuerpoCambiado(rb21), "no quedo como se esperaba") + "|" + Hashes21(cn));

                Lotes(cn, rb21);
                Check("A10 rollback: vuelven EXACTOS los de sql/18 / sql/20", antes, Hashes21(cn));
                Check("A10b ... y el defecto vuelve (prueba de que el rollback deshace)", "sin error",
                      Error(() => Crear(cn, AltaTipo(hoy, "PRB", ado, "En Análisis", "/P/Sitio 1", "50"))));
                Check("A11 rollback otra vez se niega ('no aplicada')", "True|0|True|0|" + antes,
                      Rechazo(cn, rb21, "sql/21 no aplicada") + "|" + Hashes21(cn));

                // Mezcla: solo RevisarTope con el texto de sql/21 -> los dos se niegan.
                var loteTope = Regex.Split(sql21, @"^\s*GO\s*$", RegexOptions.Multiline)
                    .First(l => l.Contains("ALTER PROCEDURE adm.usp_GestionAdmin_RevisarTope"));
                Exec(cn, "BEGIN TRAN;"); Exec(cn, loteTope); Exec(cn, "COMMIT;");
                Check("A12 mezcla (solo RevisarTope de sql/21): sql/21 se niega sin tocar nada", "True|0|True|0|" +
                      HashTopeSql21 + "|" + HashCrearSql20 + "|" + HashModSql18,
                      Rechazo(cn, sql21, "adm.usp_GestionAdmin_RevisarTope (hash") + "|" + Hashes21(cn));
                Check("A12b ... y el rollback tambien", "True|0|True|0",
                      Rechazo(cn, rb21, "no es la esperada"));
                var loteTopeRb = Regex.Split(rb21, @"^\s*GO\s*$", RegexOptions.Multiline)
                    .First(l => l.Contains("ALTER PROCEDURE adm.usp_GestionAdmin_RevisarTope"));
                Exec(cn, "BEGIN TRAN;"); Exec(cn, loteTopeRb); Exec(cn, "COMMIT;");
                Lotes(cn, sql21);
                Check("A13 se puede volver a aplicar despues del rollback", despues, Hashes21(cn));
            }
        }
        finally
        {
            try { Borrar(db); Console.WriteLine("   base " + db + " borrada"); } catch (Exception ex) { Console.WriteLine("No se pudo borrar " + db + ": " + ex.Message); }
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
            // Negocio antes de quitar adm.IniciativaProtegida (con filas): solo
            // columnas que el rollback no quita.
            const string negocio = "SELECT (SELECT COUNT(*) FROM dbo.Problem), (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Problem), " +
                                   "(SELECT COUNT(*) FROM dbo.ProblemCategoria), " +
                                   "(SELECT CHECKSUM_AGG(CHECKSUM(Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, TicketsReduce, VigenteEnOrigen)) FROM dbo.ProblemCategoria), " +
                                   "(SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Categoria IS NULL)";
            var protegidasAntes = Uno(cn, "SELECT COUNT(*) FROM adm.IniciativaProtegida");
            var negocioAntes = Filas(cn, negocio);
            Exec(cn, "EXEC sys.sp_set_session_context N'forzar_rollback_18', N'SI';");
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia_rollback.sql"));
            Check("B5 quitar adm.IniciativaProtegida (" + Celda(protegidasAntes) + " filas) no toca Problem, ProblemCategoria ni el historial de la iniciativa",
                  negocioAntes, Filas(cn, negocio.Replace("WHERE Categoria IS NULL", "")));
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
