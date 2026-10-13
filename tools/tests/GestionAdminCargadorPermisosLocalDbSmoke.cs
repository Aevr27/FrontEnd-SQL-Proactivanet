// Prueba de INTEGRACION en SQL Server LocalDB, sobre bases DESECHABLES
// GestionAdminPrueba_* (se crean y se borran aqui; nunca la VM):
//
//   1) sql/19_cargador_respeta_admin.sql y el usp_CargarExperiencia parchado
//      contra datos sinteticos: un codigo de Admin que SI viene en el libro,
//      uno de Admin que NO viene, y codigos normales del Excel (actualizado,
//      ausente y nuevo). Control: el cargador SIN parche (174bb51) sobre los
//      mismos datos, dentro de una transaccion que se deshace.
//   2) Los procedimientos de sql/18 con un LOGIN SQL dedicado que solo tiene
//      EXECUTE sobre el esquema adm (+ SELECT de las tablas de historial de
//      categoria, como dice la seccion 6 de sql/18): crear, modificar, ligar,
//      rollback, tope (exacto, excedido y concurrente) y escritura directa
//      denegada.
//
// Limites: replica minima del esquema (tools/tests/GestionAdminLocalDb_
// replica.sql), sin trg_Problem_EstadoEvento (definicion no disponible), sin
// las vistas ni datos reales; el cargador es la copia 174bb51, no
// necesariamente el desplegado (eso lo dice D10 del diag).
//
// Compilar con App_Code\*.cs; correr con cwd = raiz del repo.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class GestionAdminCargadorPermisosLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;";
    static int fallos = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, System.Globalization.CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, System.Globalization.CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection(Servidor + "Integrated Security=true;Database=" + db + ";Pooling=false;");
        cn.Open();
        return cn;
    }

    static SqlConnection AbrirSql(string db, string login, string clave)
    {
        var cn = new SqlConnection(Servidor + "Database=" + db + ";User Id=" + login + ";Password=" + clave + ";Pooling=false;");
        cn.Open();
        return cn;
    }

    static void Lotes(SqlConnection cn, string sql)
    {
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (lote.Trim().Length > 0)
                using (var cmd = new SqlCommand(lote, cn) { CommandTimeout = 120 }) cmd.ExecuteNonQuery();
    }

    static object Uno(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn)) { var v = cmd.ExecuteScalar(); return v == DBNull.Value ? null : v; }
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
        return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
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

    // Todos los conjuntos que devuelve un EXEC: "columna1=valor|...".
    static List<string> Conjuntos(SqlConnection cn, string sql)
    {
        var salida = new List<string>();
        using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 120 })
        using (var rd = cmd.ExecuteReader())
        {
            do
            {
                var filas = new List<string>();
                while (rd.Read())
                {
                    var partes = new List<string>();
                    for (var i = 0; i < rd.FieldCount; i++) partes.Add(rd.GetName(i) + "=" + Celda(rd.GetValue(i)));
                    filas.Add(string.Join("|", partes));
                }
                salida.Add(string.Join(";", filas));
            } while (rd.NextResult());
        }
        return salida;
    }

    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (SqlException ex) { return ex.Number.ToString(); }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
    }

    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }

    static string Base(string sufijo) { return "GestionAdminPrueba_" + sufijo + DateTime.UtcNow.ToString("HHmmssfff"); }

    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }

    static string Hash(SqlConnection cn)
    {
        return (string)Uno(cn, "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(" +
            "OBJECT_DEFINITION(OBJECT_ID('dbo.usp_CargarExperiencia')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)");
    }

    // Base con replica + cargador 174bb51 + sql/18.
    static void Preparar(string db)
    {
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + db + "]");
        using (var cn = Abrir(db))
        {
            Lotes(cn, Leer("tools", "tests", "GestionAdminLocalDb_replica.sql"));
            Lotes(cn, Leer("tools", "tests", "usp_CargarExperiencia_174bb51.sql"));
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia.sql"));
            Exec(cn, "INSERT dbo.CatPrefijoProblem (Prefijo, ControlDeFecha) VALUES (N'PRB', 1), (N'ADO', 1);");
        }
    }

    static PlanCrearAdmin PlanAlta(DateTime hoy, string titulo, params string[] rutaPct)
    {
        var p = new PeticionCrearAdmin { Tipo = "PRB", Titulo = titulo };
        for (var i = 0; i < rutaPct.Length; i += 2) p.Categorias.Add(new PctCategoria { Categoria = rutaPct[i], Texto = rutaPct[i + 1] });
        return PlanificadorGestionAdmin.Crear(p, new ResultadoGestionAdmin { Accion = "crear" }, hoy);
    }

    static readonly DatosAltaDeclarados Declarados =
        new DatosAltaDeclarados { TipoIniciativa = "Problem", TipoAgrupado = "Problem", Estado = "En Análisis" };

    // =====================================================================
    // 1) Cargador
    // =====================================================================
    static void PruebaCargador()
    {
        var db = Base("carga");
        Console.WriteLine("-- 1) cargador: " + db);
        try
        {
            Preparar(db);
            using (var cn = Abrir(db))
            {
                var hoy = new DateTime(2026, 10, 13);
                // Codigos "del Excel" ya cargados (sin contexto ADMIN, como el cargador).
                Exec(cn, @"
INSERT dbo.Problem (Codigo, Titulo, Estado, FechaCreacion, FechaAnalisis) VALUES
 (N'PRB 2026-000001', N'Excel normal', N'En Analisis', '2026-09-01', '2026-09-16'),
 (N'PRB 2026-000002', N'Excel que ya no viene', N'En Analisis', '2026-09-02', '2026-09-17');
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoAgrupado, PctDisminucion) VALUES
 (N'PRB 2026-000001', N'/X/Cat 1', N'Problem', 0.1000),
 (N'PRB 2026-000002', N'/X/Cat 2', N'Problem', 0.1000);");
                // Dos de Admin: 000003 (vendra en el libro = conflicto) y 000004 (no vendra).
                var esc = new EscritorGestionAdminSql();
                var a1 = esc.Crear(cn, null, PlanAlta(hoy, "Admin en el libro", "/A/Cat 1", "20", "/A/Cat 2", "10"), Declarados, @"DOM\adm");
                var a2 = esc.Crear(cn, null, PlanAlta(hoy, "Admin fuera del libro", "/A/Cat 3", "30"), Declarados, @"DOM\adm");
                Check("C0 codigos de Admin emitidos tras los del Excel", "PRB 2026-000003|PRB 2026-000004", a1 + "|" + a2);
                // Ligar despues en a1 (fechas propias) para ver que el cargador no las toca.
                var liga = new PlanModificarAdmin { Codigo = a1, Hoy = new DateTime(2026, 11, 2) };
                liga.Agregar.Add(new CategoriaPlan { Ruta = "/A/Cat 9", Pct = 0.05m });
                esc.Modificar(cn, null, liga, @"DOM\adm");

                // El libro: 000001 cambia titulo y %, 000002 ya no viene,
                // 000005 es nuevo, y trae a1 (000003) con otro titulo, otra
                // categoria nueva y otro % en una existente.
                Exec(cn, @"
INSERT stg.Problems (Codigo, Titulo, Estado, FechaCreacion, FechaAnalisis, FechaSolucion) VALUES
 (N'PRB 2026-000001', N'Excel normal v2', N'En Analisis', N'2026-09-01', N'2026-09-16', N'2026-12-01'),
 (N'PRB 2026-000003', N'EXCEL PISARIA', N'Cerrado', N'2026-01-01', N'2026-01-16', NULL),
 (N'PRB 2026-000005', N'Excel nuevo', N'En Analisis', N'2026-10-10', N'2026-10-25', NULL);
INSERT stg.Iniciativas (Codigo, Categoria, TipoAgrupado, PctDisminucion) VALUES
 (N'PRB 2026-000001', N'/X/Cat 1', N'Problem', N'0.2'),
 (N'PRB 2026-000003', N'/A/Cat 1', N'Problem', N'0.9'),
 (N'PRB 2026-000003', N'/Z/Del Excel', N'Problem', N'0.5'),
 (N'PRB 2026-000005', N'/X/Cat 5', N'Problem', N'0.3');");

                var antesAdmin = Filas(cn, "SELECT p.Codigo, p.Titulo, p.Estado, p.FechaCreacion, p.FechaAnalisis, p.FechaSolucion, p.VigenteEnOrigen FROM dbo.Problem AS p JOIN adm.ProblemaAdmin AS a ON a.Codigo = p.Codigo ORDER BY p.Codigo");
                var antesAdminCat = Filas(cn, "SELECT pc.Codigo, pc.Categoria, pc.PctDisminucion, pc.FechaCreacionCategoria, pc.FechaAnalisisCategoria, pc.VigenteEnOrigen FROM dbo.ProblemCategoria AS pc JOIN adm.ProblemaAdmin AS a ON a.Codigo = pc.Codigo ORDER BY pc.Codigo, pc.Categoria");
                var antesHist = Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo IN (N'PRB 2026-000003', N'PRB 2026-000004')");

                // ---- Control: cargador SIN parche, deshecho al final ----
                Exec(cn, "BEGIN TRAN;");
                Conjuntos(cn, "EXEC dbo.usp_CargarExperiencia;");
                Check("CN1 CONTROL sin parche: pisa el titulo de Admin en el libro", "EXCEL PISARIA",
                      Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2026-000003'"));
                Check("CN2 CONTROL sin parche: desactiva al de Admin fuera del libro y las categorias ligadas por Admin", "0|0",
                      Celda(Uno(cn, "SELECT VigenteEnOrigen FROM dbo.Problem WHERE Codigo = N'PRB 2026-000004'")) + "|" +
                      Celda(Uno(cn, "SELECT VigenteEnOrigen FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000003' AND Categoria = N'/A/Cat 9'")));
                Exec(cn, "ROLLBACK;");
                Check("CN3 control deshecho: Admin como antes", antesAdmin,
                      Filas(cn, "SELECT p.Codigo, p.Titulo, p.Estado, p.FechaCreacion, p.FechaAnalisis, p.FechaSolucion, p.VigenteEnOrigen FROM dbo.Problem AS p JOIN adm.ProblemaAdmin AS a ON a.Codigo = p.Codigo ORDER BY p.Codigo"));

                // ---- sql/19 ----
                Check("P0 antes de 19, el desplegado es la copia 174bb51", "0x3BC236C22F81E7A07A4F221A012D54669742BE96A3E31C55DFE7F848D19C67DD", Hash(cn));
                Lotes(cn, Leer("sql", "19_cargador_respeta_admin.sql"));
                Check("P1 19 aplicada: hash = el parche esperado por el rollback", "0x0474F86A3A1D2BE50AB130903546F742C430ACB4C20BF9F1D59C55E60ABC8287", Hash(cn));
                var otraVez = "";
                try { Lotes(cn, Leer("sql", "19_cargador_respeta_admin.sql")); } catch (SqlException ex) { otraVez = ex.Message.Contains("NO es la esperada") ? "se niega" : ex.Message; }
                Exec(cn, "SET NOEXEC OFF;");
                Check("P2 19 por segunda vez (desplegado ya no es 174bb51): se niega", "se niega", otraVez);

                // Simulacion: reporta, no escribe.
                var problemAntes = Filas(cn, "SELECT Codigo, Titulo, VigenteEnOrigen FROM dbo.Problem ORDER BY Codigo");
                var sim = Conjuntos(cn, "EXEC dbo.usp_CargarExperiencia @Simulacion = 1;");
                Check("S1 simulacion reporta 3 conflictos de Admin", true, sim.Any(c => c == "ConflictosAdmin=3"));
                Check("S2 simulacion lista los conflictos (hoja, codigo, categoria)",
                      "Hoja=DBIniciativas|Codigo=PRB 2026-000003|Categoria=/A/Cat 1;Hoja=DBIniciativas|Codigo=PRB 2026-000003|Categoria=/Z/Del Excel;Hoja=DBProblems|Codigo=PRB 2026-000003|Categoria=NULL",
                      sim.FirstOrDefault(c => c.StartsWith("Hoja=")) == null ? "" :
                      string.Join(";", sim.First(c => c.StartsWith("Hoja=")).Split(';').OrderBy(x => x).ToArray()));
                Check("S3 simulacion no escribio nada", problemAntes, Filas(cn, "SELECT Codigo, Titulo, VigenteEnOrigen FROM dbo.Problem ORDER BY Codigo"));

                // Carga real (parchada).
                var res = Conjuntos(cn, "EXEC dbo.usp_CargarExperiencia;");
                Check("L1 resumen: 1 insertado, 1 actualizado (Problem); 1 insertada, 1 actualizada (categorias); 3 conflictos",
                      "ProblemsInsertados=1|ProblemsActualizados=1|CategoriasInsertadas=1|CategoriasActualizadas=1|DetalleHuerfano=0|ConflictosAdmin=3", res[0]);
                Check("L2 aviso de conflictos tras la carga (3 filas, todas de PRB 2026-000003)", "3|True",
                      res.Count > 1 ? res[1].Split(';').Length + "|" + res[1].Split(';').All(f => f.StartsWith("AvisoCodigoDeAdmin=PRB 2026-000003")) : "sin aviso");

                Check("L3 Admin (en el libro y fuera): Problem identico", antesAdmin,
                      Filas(cn, "SELECT p.Codigo, p.Titulo, p.Estado, p.FechaCreacion, p.FechaAnalisis, p.FechaSolucion, p.VigenteEnOrigen FROM dbo.Problem AS p JOIN adm.ProblemaAdmin AS a ON a.Codigo = p.Codigo ORDER BY p.Codigo"));
                Check("L4 Admin: categorias identicas (% y fechas propias), ninguna desactivada", antesAdminCat,
                      Filas(cn, "SELECT pc.Codigo, pc.Categoria, pc.PctDisminucion, pc.FechaCreacionCategoria, pc.FechaAnalisisCategoria, pc.VigenteEnOrigen FROM dbo.ProblemCategoria AS pc JOIN adm.ProblemaAdmin AS a ON a.Codigo = pc.Codigo ORDER BY pc.Codigo, pc.Categoria"));
                Check("L5 la categoria que el libro trae para Admin (/Z/Del Excel) NO se inserto", 0,
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Categoria = N'/Z/Del Excel'"));
                Check("L6 sin historial nuevo de fechas para Admin", antesHist,
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo IN (N'PRB 2026-000003', N'PRB 2026-000004')"));

                Check("L7 normal en el libro: actualizado (titulo, FechaSolucion, %)", "Excel normal v2|2026-12-01|1|0.2000|1",
                      Filas(cn, "SELECT p.Titulo, p.FechaSolucion, p.VigenteEnOrigen, pc.PctDisminucion, pc.VigenteEnOrigen FROM dbo.Problem AS p JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = p.Codigo WHERE p.Codigo = N'PRB 2026-000001'"));
                Check("L8 normal fuera del libro: desactivado (Problem y categoria)", "0|0",
                      Filas(cn, "SELECT p.VigenteEnOrigen, pc.VigenteEnOrigen FROM dbo.Problem AS p JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = p.Codigo WHERE p.Codigo = N'PRB 2026-000002'"));
                Check("L9 normal nuevo: insertado con su categoria", "Excel nuevo|/X/Cat 5|0.3000",
                      Filas(cn, "SELECT p.Titulo, pc.Categoria, pc.PctDisminucion FROM dbo.Problem AS p JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = p.Codigo WHERE p.Codigo = N'PRB 2026-000005'"));
                Check("L10 historial del cargador: % de 000001 (alta 'I' al sembrar, luego 0.1 -> 0.2 'U') y Solucion NULL -> 2026-12-01, todo NO_DECLARADO",
                      "NULL|0.1000|I|NO_DECLARADO;0.1000|0.2000|U|NO_DECLARADO;FechaSolucion|NULL|2026-12-01|U|NO_DECLARADO",
                      Filas(cn, "SELECT PctAnterior, PctNuevo, Operacion, Origen FROM dbo.ProblemCategoriaPctEvento WHERE Codigo = N'PRB 2026-000001' ORDER BY IdEvento") + ";" +
                      Filas(cn, "SELECT Campo, FechaAnterior, FechaNueva, Operacion, Origen FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000001' AND Campo = 'FechaSolucion'"));
                var pctAntes = Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoriaPctEvento");
                Conjuntos(cn, "EXEC dbo.usp_CargarExperiencia;");
                Check("L11 la misma carga otra vez: 0 eventos de % nuevos (mismo valor)", pctAntes, Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoriaPctEvento"));

                // ---- Rollback 19 ----
                Lotes(cn, Leer("sql", "19_cargador_respeta_admin_rollback.sql"));
                Check("R1 rollback 19: vuelve exactamente a 174bb51", "0x3BC236C22F81E7A07A4F221A012D54669742BE96A3E31C55DFE7F848D19C67DD", Hash(cn));
                var rb2 = "";
                try { Lotes(cn, Leer("sql", "19_cargador_respeta_admin_rollback.sql")); } catch (SqlException ex) { rb2 = ex.Message.Contains("NO es la esperada") ? "se niega" : ex.Message; }
                Exec(cn, "SET NOEXEC OFF;");
                Check("R2 rollback por segunda vez: se niega", "se niega", rb2);
            }
        }
        catch (Exception ex) { fallos++; Console.WriteLine("FAIL  excepcion: " + ex); }
        finally { try { Borrar(db); Console.WriteLine("   base " + db + " borrada"); } catch (Exception ex) { Console.WriteLine("No se pudo borrar " + db + ": " + ex.Message); } }
    }

    // =====================================================================
    // 2) Permisos minimos
    // =====================================================================
    static void PruebaPermisos()
    {
        var db = Base("perm");
        var login = "GestionAdminSitio_" + DateTime.UtcNow.ToString("HHmmssfff");
        var clave = "Gp!" + Guid.NewGuid().ToString("N");
        Console.WriteLine("-- 2) permisos: " + db + " / login " + login);
        try
        {
            Preparar(db);
            using (var m = Abrir("master"))
                Exec(m, "CREATE LOGIN [" + login + "] WITH PASSWORD = N'" + clave + "', CHECK_POLICY = OFF, DEFAULT_DATABASE = [" + db + "];");
            using (var cn = Abrir(db))
            {
                // Lo que pide la seccion 6 de sql/18, y nada mas.
                Exec(cn, "CREATE USER [sitio] FOR LOGIN [" + login + "];" +
                         "GRANT EXECUTE ON SCHEMA::adm TO [sitio];" +
                         "GRANT SELECT ON dbo.ProblemCategoriaFechaEvento TO [sitio];" +
                         "GRANT SELECT ON dbo.ProblemCategoriaPctEvento TO [sitio];");
                Exec(cn, "INSERT dbo.Problem (Codigo, Titulo, Estado, FechaCreacion, FechaAnalisis) VALUES (N'ADO 2026-000001', N'Excel', N'En Analisis', '2026-09-01', '2026-09-16');" +
                         "INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoAgrupado, PctDisminucion) VALUES (N'ADO 2026-000001', N'/K/Cat 1', N'Adopcion', 0.6000);");
                Check("K0 el usuario no es db_owner ni tiene roles de datos", "0|0|0",
                      Filas(cn, "SELECT IS_ROLEMEMBER('db_owner','sitio'), IS_ROLEMEMBER('db_datawriter','sitio'), IS_ROLEMEMBER('db_datareader','sitio')"));
            }

            var hoy = new DateTime(2026, 10, 13);
            var esc = new EscritorGestionAdminSql();
            using (var s = AbrirSql(db, login, clave))
            {
                Check("K1 conectado como el login SQL dedicado", login + "|sitio", Filas(s, "SELECT SUSER_SNAME(), USER_NAME()"));
                // Escritura y lectura directas: denegadas (229).
                Check("K2 INSERT directo en dbo.Problem: denegado", "229", Error(() => Exec(s, "INSERT dbo.Problem (Codigo) VALUES (N'PRB 2026-999999')")));
                Check("K3 UPDATE directo en dbo.ProblemCategoria: denegado", "229", Error(() => Exec(s, "UPDATE dbo.ProblemCategoria SET PctDisminucion = 1")));
                Check("K4 DELETE directo en dbo.Problem: denegado", "229", Error(() => Exec(s, "DELETE dbo.Problem")));
                Check("K5 SELECT directo de dbo.Problem: denegado", "229", Error(() => Uno(s, "SELECT COUNT(*) FROM dbo.Problem")));
                Check("K6 escribir el contador de codigos directo: denegado", "229", Error(() => Exec(s, "UPDATE adm.ContadorCodigo SET Ultimo = 0")));
                Check("K7 insertar en adm.ProblemaAdmin directo: denegado", "229", Error(() => Exec(s, "INSERT adm.ProblemaAdmin (Codigo, Origen, Usuario) VALUES (N'ADO 2026-000001', 'TOMADO', N'x')")));

                // Crear (multi-categoria) por el procedimiento.
                string cod = null;
                Check("K8 crear con 2 categorias por EXECUTE: sin error", "sin error",
                      Error(() => cod = esc.Crear(s, null, PlanAlta(hoy, "[PRUEBA] sitio", "/S/Cat 1", "30", "/S/Cat 2", "20"), Declarados, @"DOM\sitio")));
                Check("K9 codigo emitido", "PRB 2026-000001", cod);
                // Modificar Solucion / Cierre.
                var mod = new PlanModificarAdmin { Codigo = cod, Hoy = new DateTime(2026, 11, 2) };
                mod.Problem[PeticionModificarAdmin.CFSolucion] = "2026-12-01";
                mod.Problem[PeticionModificarAdmin.CFCierre] = "2027-01-31";
                Check("K10 modificar Solucion y Cierre: sin error", "sin error", Error(() => esc.Modificar(s, null, mod, @"DOM\sitio")));
                // Ligar despues.
                var liga = new PlanModificarAdmin { Codigo = cod, Hoy = new DateTime(2026, 11, 2) };
                liga.Agregar.Add(new CategoriaPlan { Ruta = "/S/Cat 3", Pct = 0.1m });
                Check("K11 ligar categoria despues: sin error", "sin error", Error(() => esc.Modificar(s, null, liga, @"DOM\sitio")));
                var dup = new PlanModificarAdmin { Codigo = cod, Hoy = hoy };
                dup.Agregar.Add(new CategoriaPlan { Ruta = "/S/Cat 3", Pct = 0.1m });
                Check("K12 ligar la misma otra vez: 51008", "51008", Error(() => esc.Modificar(s, null, dup, @"DOM\sitio")));
                // Excel: sin tomarlo, rechazado.
                var excel = new PlanModificarAdmin { Codigo = "ADO 2026-000001", Hoy = hoy };
                excel.Problem[SolicitudIniciativa.CTitulo] = "x";
                Check("K13 modificar un codigo del Excel sin tomarlo: 51009", "51009", Error(() => esc.Modificar(s, null, excel, @"DOM\sitio")));
                // Tope: 60 de otros + 40 = 100 ok; + 0.01 no; rollback de un alta con la 2a categoria excedida.
                Check("K14 tope exacto 100% (60 + 40): sin error", "sin error",
                      Error(() => esc.Crear(s, null, PlanAlta(hoy, "t", "/K/Cat 1", "40"), Declarados, @"DOM\sitio")));
                Check("K15 tope excedido (+0.01): 51010", "51010",
                      Error(() => esc.Crear(s, null, PlanAlta(hoy, "t", "/K/Cat 1", "0.01"), Declarados, @"DOM\sitio")));
                Check("K16 alta con 2a categoria excedida: 51010", "51010",
                      Error(() => esc.Crear(s, null, PlanAlta(hoy, "t", "/S/Nueva", "10", "/K/Cat 1", "5"), Declarados, @"DOM\sitio")));
                Check("K17 historial de categoria legible con su GRANT", "/S/Cat 3|FechaAnalisisCategoria|2026-11-17|ADMIN|DOM\\sitio;/S/Cat 3|FechaCreacionCategoria|2026-11-02|ADMIN|DOM\\sitio",
                      Filas(s, "SELECT Categoria, Campo, FechaNueva, Origen, Usuario FROM dbo.ProblemCategoriaFechaEvento ORDER BY Campo"));
            }

            // Verificacion (con la cuenta de prueba de Windows, solo lectura).
            using (var cn = Abrir(db))
            {
                Check("V1 lo guardado: 2 altas (PRB 000001 y 000002), sin rastro del alta fallida", "PRB 2026-000001|PRB 2026-000002",
                      string.Join("|", Filas(cn, "SELECT Codigo FROM dbo.Problem WHERE Codigo LIKE N'PRB%' ORDER BY Codigo").Split(';')));
                Check("V2 /S/Nueva no existe (rollback completo) y el contador quedo en 2", "0|2",
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Categoria = N'/S/Nueva'") + "|" + Uno(cn, "SELECT Ultimo FROM adm.ContadorCodigo WHERE Prefijo = N'PRB'"));
                Check("V3 fechas: problema 10-13/10-28 + Solucion/Cierre; iniciales sin propias; ligada con propias",
                      "2026-10-13|2026-10-28|2026-12-01|2027-01-31;/S/Cat 1|NULL|NULL;/S/Cat 2|NULL|NULL;/S/Cat 3|2026-11-02|2026-11-17",
                      Filas(cn, "SELECT FechaCreacion, FechaAnalisis, FechaSolucion, FechaCierre FROM dbo.Problem WHERE Codigo = N'PRB 2026-000001'") + ";" +
                      Filas(cn, "SELECT Categoria, FechaCreacionCategoria, FechaAnalisisCategoria FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001' ORDER BY Categoria"));
                Check("V4 historial de fechas del problema atribuido al usuario de la app y al LOGIN dedicado",
                      "FechaAnalisis|I|ADMIN|DOM\\sitio|" + login + ";FechaCierre|U|ADMIN|DOM\\sitio|" + login + ";FechaSolucion|U|ADMIN|DOM\\sitio|" + login,
                      Filas(cn, "SELECT Campo, Operacion, Origen, Usuario, LoginBD FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000001' ORDER BY Campo"));
                Check("V5 el codigo del Excel no se toco ni se tomo", "Excel|0",
                      Uno(cn, "SELECT Titulo FROM dbo.Problem WHERE Codigo = N'ADO 2026-000001'") + "|" + Uno(cn, "SELECT COUNT(*) FROM adm.ProblemaAdmin WHERE Codigo = N'ADO 2026-000001'"));
                Check("V6 /K/Cat 1 quedo en 100%, no mas", "1.0000",
                      Celda(Uno(cn, "SELECT SUM(PctDisminucion) FROM dbo.ProblemCategoria WHERE Categoria = N'/K/Cat 1'")));
            }

            // Concurrencia con el login dedicado: dos ligados al 60% de la misma ruta.
            using (var a = AbrirSql(db, login, clave))
            using (var b = AbrirSql(db, login, clave))
            {
                string cod2 = null;
                cod2 = esc.Crear(a, null, PlanAlta(hoy, "otro", "/S/Otra", "10"), Declarados, @"DOM\sitio");
                var pa = new PlanModificarAdmin { Codigo = "PRB 2026-000001", Hoy = hoy };
                pa.Agregar.Add(new CategoriaPlan { Ruta = "/C/Carrera", Pct = 0.6m });
                var pb = new PlanModificarAdmin { Codigo = cod2, Hoy = hoy };
                pb.Agregar.Add(new CategoriaPlan { Ruta = "/C/Carrera", Pct = 0.6m });
                var txA = a.BeginTransaction();
                esc.Modificar(a, txA, pa, @"DOM\a");
                string resB = null;
                var hilo = new Thread(() => { resB = Error(() => esc.Modificar(b, null, pb, @"DOM\b")); });
                hilo.Start();
                var espero = !hilo.Join(2000);
                txA.Commit();
                hilo.Join(30000);
                Check("K18 concurrencia con el login dedicado: la 2a espera el candado y se rechaza (51010)", "True|51010", espero + "|" + resB);
            }
            using (var cn = Abrir(db))
                Check("K19 la ruta quedo en 60%", "0.6000", Celda(Uno(cn, "SELECT SUM(PctDisminucion) FROM dbo.ProblemCategoria WHERE Categoria = N'/C/Carrera'")));
        }
        catch (Exception ex) { fallos++; Console.WriteLine("FAIL  excepcion: " + ex); }
        finally
        {
            try { Borrar(db); Console.WriteLine("   base " + db + " borrada"); } catch (Exception ex) { Console.WriteLine("No se pudo borrar " + db + ": " + ex.Message); }
            try
            {
                using (var m = Abrir("master"))
                    Exec(m, "IF SUSER_ID(N'" + login + "') IS NOT NULL DROP LOGIN [" + login + "];");
                Console.WriteLine("   login " + login + " borrado");
            }
            catch (Exception ex) { Console.WriteLine("No se pudo borrar el login " + login + ": " + ex.Message); }
        }
    }

    public static int Main()
    {
        using (var m = Abrir("master"))
            Console.WriteLine("LocalDB " + Uno(m, "SELECT CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion'))"));
        PruebaCargador();
        PruebaPermisos();
        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
