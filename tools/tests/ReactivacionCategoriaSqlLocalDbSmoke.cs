// Prueba de INTEGRACION de sql/83_reactivacion_categoria_historica.sql
// (+ _rollback, sql/baseline_83_export.sql y sql/diag_83_reactivacion.sql)
// contra bases REALES pero DESECHABLES de SQL Server LocalDB:
// GestionAdminPrueba_R83<n> con la replica de dbo y las migraciones reales
// 18, 20-27, 29, 31, 32, 34-42 (la VM QA segun su diagnostico 2026-11-10:
// Modificar sql/24, Aplicar sql/40, Crear sql/38, 41 y 42 aplicadas), con la
// cuenta del sitio como en la VM (PROACTIVANETAD). BORRA las bases al final.
// Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  guardas: sin aprobar en otra base; Modificar alterado a mano; rollback
//      antes de 83; aplicar / ya aplicada; deteccion del sitio (propiedades),
//      ReglaPso intacta, parametros sin cambio.
//   S  solicitud (Crear): AGREGAR de una de baja se acepta; de una vigente 51008.
//   D  edicion directa de ADM: reactiva la MISMA fila (sin fila nueva), % pedido,
//      fechas y clasificacion historica intactas, sin evento de fecha, sello,
//      TicketsReduce; clasificacion vacia se llena; conflicto 51034 (CI_AS:
//      mayusculas no es conflicto); no ADM 51032; catalogo de baja 51015;
//      quitar y agregar la misma 51018; agregar nuevo y quitar como antes.
//   A  aprobar: reactiva exactamente lo pedido; @SolicitudId rechazado /
//      inexistente / de otra iniciativa / sin esa categoria 51033; revisor
//      no ADM 51032 (registrado, sigue PENDIENTE); desactualizada si la fila
//      ya esta vigente (51204); clasificacion parcial 51221 / 51222 / 51223;
//      AGREGAR nuevos con la regla de siempre; reemplazar (sql/41).
//   T  tope de 100% con la Agrupacion EFECTIVA (historica): edicion directa
//      y solicitud.
//   K  carrera: Cancelar tiene la solicitud; Modificar con ese @SolicitudId
//      espera el MISMO candado y luego ve CANCELADA (51033).
//   L  baseline + diagnostico: huella SHA-256 reproducible (tambien en C#),
//      lista lo reactivado con su evidencia; una linea alterada = INVALIDA y
//      no atribuye nada.
//   B  rollback: huellas EXACTAS de 24 / 40 / 38, sin propiedades, ReglaPso
//      intacta, filas reactivadas siguen vigentes, 51008 otra vez; reaplicar.
//
// Necesita ../backend_admin_persistencia (vistas de origen). Compilar con
// adm.dll (receta en AccesoAdminHttpSmoke.cs) y correr con cwd = raiz.
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Collections.Specialized;
using System.Configuration;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web;

// dbo.UsuariosAdmin de mentira para AccesoAdmin (la base tiene la suya para 51032).
sealed class RolesR83 : IFuenteRolesAdmin
{
    public IList<string> AccesosDe(string cuenta)
    {
        var c = (cuenta ?? "").Trim().ToUpperInvariant();
        return c == @"SORIANA\T_ADM" ? new[] { "ADM" } : c == @"SORIANA\T_MOD" ? new[] { "MOD" } : new string[0];
    }
}

public static class ReactivacionCategoriaSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string M83 = "83_reactivacion_categoria_historica";
    const string R83 = "83_reactivacion_categoria_historica_rollback";
    const string Modificar24 = "0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77";
    const string Aplicar40 = "0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB";
    const string Crear38 = "0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F";
    const string ADM = @"SORIANA\t_adm";
    const string MOD = @"SORIANA\t_mod";
    const string MIX = @"SORIANA\t_mix";      // filas ADM y MOD: no es ADM (RolAdmin)
    const string NADIE = @"SORIANA\t_nadie";  // sin fila en dbo.UsuariosAdmin
    const string F10 = "PRB 2026-000010";
    const string F11 = "PRB 2026-000011";
    const string F12 = "PRB 2026-000012";
    static readonly string EnAnalisis = "En An" + (char)0xE1 + "lisis";
    static readonly string Rara = "/R/Rara" + (char)0xA0 + (char)0xF1 + " ";   // NBSP, enie y espacio al final
    static string Base;
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }
    static SqlConnection Abrir(string db) { var cn = new SqlConnection(Servidor + "Database=" + db + ";Pooling=false;"); cn.Open(); return cn; }
    static SqlConnection ComoSitio() { var cn = Abrir(Base); Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';"); return cn; }
    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn) { CommandTimeout = 300 }) c.ExecuteNonQuery(); }
    static void Exec(string sql) { using (var cn = Abrir(Base)) Exec(cn, sql); }
    static string Uno(string sql)
    {
        using (var cn = Abrir(Base)) using (var c = new SqlCommand(sql, cn) { CommandTimeout = 300 })
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
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    // Un script de sql/: el Resultado ("APLICADA", "DESHECHA") o el mensaje con que se niega.
    static string Script(string archivo, string db = null)
    {
        try
        {
            using (var cn = Abrir(db ?? Base))
            {
                string ultimo = "ok";
                foreach (var lote in Regex.Split(Leer("sql", archivo + ".sql"), @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
                {
                    if (lote.Trim().Length == 0) continue;
                    using (var c = new SqlCommand(lote, cn) { CommandTimeout = 300 })
                    using (var r = c.ExecuteReader())
                        do { if (r.FieldCount >= 2 && r.GetName(1) == "Resultado") while (r.Read()) ultimo = r.GetValue(1).ToString(); } while (r.NextResult());
                }
                return ultimo;
            }
        }
        catch (SqlException ex) { return ex.Message; }
    }
    // Todos los resultados de un lote (sin GO): filas como texto separado por '|'.
    static List<List<string>> Resultados(string sql)
    {
        var salida = new List<List<string>>();
        using (var cn = Abrir(Base))
        using (var c = new SqlCommand(sql, cn) { CommandTimeout = 300 })
        using (var r = c.ExecuteReader())
        {
            do
            {
                var filas = new List<string>();
                while (r.Read())
                {
                    var celdas = new string[r.FieldCount];
                    for (var i = 0; i < r.FieldCount; i++)
                        celdas[i] = r.IsDBNull(i) ? "NULL" : Convert.ToString(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
                    filas.Add(string.Join("|", celdas));
                }
                salida.Add(filas);
            } while (r.NextResult());
        }
        return salida;
    }

    // Ejecuta como el sitio; devuelve el SELECT final o "E<numero>".
    static string Sitio(string sql, params object[] kv)
    {
        try
        {
            using (var cn = ComoSitio())
            using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 })
            {
                for (var i = 0; i < kv.Length; i += 2) c.Parameters.AddWithValue((string)kv[i], kv[i + 1] ?? DBNull.Value);
                var v = c.ExecuteScalar();
                return v == null || v == DBNull.Value ? "NULL" : Convert.ToString(v);
            }
        }
        catch (SqlException ex) { return "E" + ex.Number; }
    }

    const string ModificarSql = @"DECLARE @p adm.CategoriaPctTipo, @a adm.CategoriaPctTipo, @f adm.CategoriaFechaTipo, @q adm.CategoriaPctTipo;
IF @cat IS NOT NULL INSERT @a (Categoria, Pct, TipoIniciativa, TipoAgrupado) VALUES (@cat, @pct, @ti, @ta);
IF @quitar IS NOT NULL INSERT @q (Categoria) VALUES (@quitar);
EXEC adm.usp_GestionAdmin_Modificar @Usuario = @u, @Codigo = @folio, @Pcts = @p, @Agregar = @a, @FechasCategoria = @f,
     @Hoy = '2026-11-10', @SolicitudId = @sol, @Quitar = @q;
SELECT 'ok';";
    // Edicion directa (o con @SolicitudId, como la llamaria Aplicar).
    static string Modificar(string usuario, string folio, string cat, decimal? pct, string ti = null, string ta = null, int? sol = null, string quitar = null)
    {
        return Sitio(ModificarSql, "@u", usuario, "@folio", folio, "@cat", cat, "@pct", pct, "@ti", ti, "@ta", ta, "@sol", sol, "@quitar", quitar);
    }
    const string CrearSql = @"DECLARE @c adm.SolicitudCategoriaTipo, @id int, @r bit;
INSERT @c (Categoria, Accion, Pct, TipoIniciativa, TipoAgrupado) VALUES (@cat, 'AGREGAR', @pct, @ti, @ta);
EXEC adm.usp_SolicitudCambio_Crear @Usuario = @u, @Rol = @rol, @Llave = @llave, @Codigo = @folio, @Tipo = 'CATEGORIAS',
     @Motivo = N'reactivar', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT;
SELECT @id;";
    static string Pedir(string folio, string cat, decimal pct, string ti = null, string ta = null, string cuenta = MOD, string rol = "MOD")
    {
        return Sitio(CrearSql, "@u", cuenta, "@rol", rol, "@llave", Guid.NewGuid(), "@folio", folio, "@cat", cat, "@pct", pct, "@ti", ti, "@ta", ta);
    }
    const string ReemplazarSql = @"DECLARE @c adm.SolicitudCategoriaTipo, @id int, @r bit;
INSERT @c (Categoria, Accion, Pct, TipoIniciativa, TipoAgrupado) VALUES (@cat, 'AGREGAR', @pct, NULL, NULL);
EXEC adm.usp_SolicitudCambio_Reemplazar @ReemplazaA = @orig, @MotivoCancelacion = N'otro %',
     @Usuario = @u, @Rol = N'MOD', @Llave = @llave, @Codigo = @folio, @Tipo = 'CATEGORIAS',
     @Motivo = N'reactivar', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT;
SELECT @id;";
    const string AplicarSql = @"DECLARE @k adm.SolicitudClasificacionTipo;
IF @ccat IS NOT NULL INSERT @k (Categoria, TipoIniciativa, TipoAgrupado) VALUES (@ccat, @cti, @cta);
EXEC adm.usp_SolicitudCambio_Aplicar @IdSolicitud = @id, @Revisor = @r, @Comentario = NULL, @Clasificaciones = @k, @Hoy = '2026-11-10';
SELECT 'ok';";
    static string Aplicar(int id, string ccat = null, string cti = null, string cta = null, string revisor = ADM)
    {
        return Sitio(AplicarSql, "@id", id, "@r", revisor, "@ccat", ccat, "@cti", cti, "@cta", cta);
    }
    static string Rechazar(int id) { return Sitio("EXEC adm.usp_SolicitudCambio_Rechazar @IdSolicitud = @id, @Revisor = @r, @Comentario = N'no'; SELECT 'ok';", "@id", id, "@r", ADM); }
    static int Id(string r) { return int.Parse(r); }

    // La fila: vigente|%|TipoIniciativa|TipoAgrupado|creacion|analisis|TicketsReduce
    static string Fila(string cat, string folio = F10)
    {
        return Uno("SELECT CONCAT(CONVERT(int, VigenteEnOrigen), '|', ISNULL(CONVERT(varchar(12), PctDisminucion), 'NULL'), '|', ISNULL(TipoIniciativa, 'NULL'), '|', " +
                   "ISNULL(TipoAgrupado, 'NULL'), '|', ISNULL(CONVERT(varchar(10), FechaCreacionCategoria, 23), 'NULL'), '|', " +
                   "ISNULL(CONVERT(varchar(10), FechaAnalisisCategoria, 23), 'NULL'), '|', ISNULL(CONVERT(varchar(12), TicketsReduce), 'NULL')) " +
                   "FROM dbo.ProblemCategoria WHERE Codigo = N'" + folio + "' AND Categoria = N'" + cat.Replace("'", "''") + "'");
    }
    static string Filas(string folio = F10) { return Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + folio + "'"); }
    static string EventosFecha(string folio = F10) { return Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + folio + "'"); }
    static string Solicitud(int id) { return Uno("SELECT CONCAT(Estado, '|', Intentos) FROM adm.SolicitudCambio WHERE IdSolicitud = " + id); }
    static string Hash(string objeto)
    {
        return Uno("SELECT CONVERT(varchar(66), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'" + objeto +
                   "', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)");
    }
    static string Huellas() { return Hash("adm.usp_GestionAdmin_Modificar") + "|" + Hash("adm.usp_SolicitudCambio_Aplicar") + "|" + Hash("adm.usp_SolicitudCambio_Crear"); }
    static string Propiedades(string nombre)
    {
        return Uno("SELECT COUNT(*) FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND name = N'" + nombre + "' AND major_id IN " +
                   "(OBJECT_ID(N'adm.usp_GestionAdmin_Modificar'), OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar'), OBJECT_ID(N'adm.usp_SolicitudCambio_Crear'))");
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
            foreach (var s in new[] { "18_gestion_admin_persistencia", "20_gestion_admin_duenos", "21_gestion_admin_agrupacion_acentos", "22_solicitudes_cambio" })
                Lotes(cn, Leer("sql", s + ".sql"));
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            foreach (var s in new[] { "22_solicitudes_cambio_permisos", "23_cambios_recientes", "24_gestion_admin_modificar_duenos_quitar",
                                      "25_solicitudes_cambio_datos", "26_gestion_admin_crear_volumetria", "27_gestion_admin_crear_subestado",
                                      "29_solicitud_iniciativa", "31_solicitud_iniciativa_revision", "32_solicitud_iniciativa_aprobar_crea",
                                      "34_solicitudes_cambio_varios" })
                Lotes(cn, Leer("sql", s + ".sql"));
            Exec(cn, @"
DELETE FROM dbo.CatPersona;
INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES (N'Andres Vera Rios', N'andresvr@soriana.com', 1);
CREATE TABLE dbo.UsuariosAdmin (Usuario nvarchar(50) NULL, CorreoUsuario nvarchar(50) NULL,
    Acceso nvarchar(3) NOT NULL CONSTRAINT CK_UsuariosAdmin_Acceso CHECK (Acceso IN (N'MOD', N'ADM')) CONSTRAINT DF_UsuariosAdmin_Acceso DEFAULT (N'MOD'));
INSERT dbo.UsuariosAdmin (Usuario, CorreoUsuario, Acceso) VALUES
 (N'SORIANA\t_adm', N't_adm@soriana.com', N'ADM'), (N'SORIANA\t_mod', N't_mod@soriana.com', N'MOD'),
 (N'SORIANA\t_mix', N't_mix@soriana.com', N'ADM'), (N'SORIANA\t_mix', N't_mix@soriana.com', N'MOD');
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);");
            foreach (var s in new[] { "35_usuarios_admin_nombre_solicitante", "36_solicitud_iniciativa_solicitante_admin", "37_solicitudes_cambio_pso",
                                      "38_solicitudes_cambio_pso_equipo", "39_solicitudes_vistas", "40_solicitud_cambio_cierre_monitoreo",
                                      "41_solicitudes_cambio_cancelar_reemplazar", "42_solicitud_iniciativa_cancelar_reemplazar" })
                Lotes(cn, Leer("sql", s + ".sql"));
            // Datos de la prueba. Activas del catalogo: todas las /R/* menos /R/Baja.
            Exec(cn, @"
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES
 (N'r01', N'/R/Activa', 1), (N'r02', N'/R/Hist', 1), (N'r03', N'/R/Hist2', 1), (N'r04', N'/R/Hist3', 1), (N'r05', N'/R/Hist4', 1),
 (N'r06', N'/R/HistVacia', 1), (N'r07', N'/R/HistConf', 1), (N'r08', N'/R/HistParcial', 1), (N'r09', N'/R/Nueva', 1),
 (N'r10', N'/R/Nueva2', 1), (N'r11', N'/R/Cap', 1), (N'r12', N'/R/CapReq', 1), (N'r13', N'/R/Baja', 0), (N'r14', N'/R/Mod', 1),
 (N'r15', N'/R/H10', 1), (N'r16', N'/R/H21', 1), (N'r17', N'/R/Otra', 1), (N'r18', N'/R/HistE', 1), (N'r19', N'/R/HistE2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, OwnerProblem, OwnerServicio) VALUES
 (N'PRB 2026-000010', N'Problem', N'Diez', N'" + EnAnalisis + @"', NULL, N'Andres Vera Rios', N'SO 1'),
 (N'PRB 2026-000011', N'Problem', N'Once', N'" + EnAnalisis + @"', NULL, NULL, NULL),
 (N'PRB 2026-000012', N'Problem', N'Doce', N'" + EnAnalisis + @"', NULL, NULL, NULL),
 (N'PRB 2026-000013', N'Mejora',  N'Trece', N'" + EnAnalisis + @"', NULL, NULL, NULL);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen, FechaCreacionCategoria, FechaAnalisisCategoria, TicketsReduce) VALUES
 (N'PRB 2026-000010', N'/R/Activa',      N'Problem', N'Problem', 0.1000, 1, NULL, NULL, NULL),
 (N'PRB 2026-000010', N'/R/Hist',        N'Problem', N'Problem', 0.2000, 0, '2026-01-05', '2026-01-20', 99),
 (N'PRB 2026-000010', N'/R/Hist2',       N'Problem', N'Problem', 0.2000, 0, '2026-02-01', '2026-02-16', NULL),
 (N'PRB 2026-000010', N'/R/Hist3',       N'Problem', N'Problem', 0.2000, 0, '2026-03-01', '2026-03-16', NULL),
 (N'PRB 2026-000010', N'/R/Hist4',       N'Problem', N'Problem', 0.2000, 0, '2026-03-02', '2026-03-17', NULL),
 (N'PRB 2026-000010', N'/R/HistVacia',   N'Problem', N'  ',      0.2000, 0, '2026-04-01', '2026-04-16', NULL),
 (N'PRB 2026-000010', N'/R/HistConf',    N'Problem', N'Problem', 0.2000, 0, '2026-05-01', '2026-05-16', NULL),
 (N'PRB 2026-000010', N'/R/HistParcial', N'Problem', NULL,       0.2000, 0, '2026-06-01', '2026-06-16', NULL),
 (N'PRB 2026-000010', N'/R/Cap',         N'Problem', N'Problem', 0.2000, 0, '2026-07-01', '2026-07-16', NULL),
 (N'PRB 2026-000010', N'/R/CapReq',      N'Problem', N'ReqOpr',  0.2000, 0, '2026-07-02', '2026-07-17', NULL),
 (N'PRB 2026-000010', N'/R/Baja',        N'Problem', N'Problem', 0.2000, 0, '2026-08-01', '2026-08-16', NULL),
 (N'PRB 2026-000010', N'/R/Mod',         N'Problem', N'Problem', 0.2000, 0, '2026-08-02', '2026-08-17', NULL),
 (N'PRB 2026-000010', N'/R/H10',         N'Problem', N'Problem', 0.2000, 0, '2026-09-01', '2026-09-16', NULL),
 (N'PRB 2026-000010', N'/R/H21',         N'Problem', N'Problem', 0.2000, 0, '2026-09-02', '2026-09-17', NULL),
 (N'PRB 2026-000010', N'/R/HistE',       N'Problem', NULL,       0.2000, 0, '2026-10-01', '2026-10-16', NULL),
 (N'PRB 2026-000010', N'/R/HistE2',      NULL,       N'Problem', 0.2000, 0, '2026-10-02', '2026-10-17', NULL),
 (N'PRB 2026-000011', N'/R/Cap',         N'Problem', N'Problem', 0.9000, 1, NULL, NULL, NULL),
 (N'PRB 2026-000011', N'/R/CapReq',      N'Problem', N'Problem', 0.9000, 1, NULL, NULL, NULL),
 (N'PRB 2026-000013', N'/R/Otra',        N'Mejora',  N'Mejora',  0.1000, 1, NULL, NULL, NULL),
 (N'PRB 2026-000013', N'" + Rara + @"',  N'Mejora',  N'Mejora',  0.1000, 0, NULL, NULL, NULL);");
        }
    }

    // A abre transaccion y corre `primero` (toma el candado, sin COMMIT); B
    // corre `segundo` en otro hilo. -> si B espero | lo de A | lo de B.
    static string Carrera(string primero, Func<string> segundo)
    {
        using (var a = ComoSitio())
        {
            Exec(a, "BEGIN TRAN;");
            string resA;
            try { using (var c = new SqlCommand(primero, a)) resA = Convert.ToString(c.ExecuteScalar()); }
            catch (SqlException ex) { resA = "E" + ex.Number; }
            string resB = null;
            var hilo = new Thread(() => { resB = segundo(); });
            hilo.Start();
            var espero = !hilo.Join(1500);
            if (a.State == ConnectionState.Open) { try { Exec(a, "IF @@TRANCOUNT > 0 COMMIT;"); } catch (SqlException) { } }
            hilo.Join(30000);
            return espero + "|" + resA + "|" + resB;
        }
    }

    // ---- F: deteccion del sitio (la cuenta PROACTIVANETAD, sin VIEW DEFINITION) ----
    // -> "ReactivacionActiva|Activa (sql/22)" tras una revision desde cero.
    static string Deteccion()
    {
        using (var cn = ComoSitio())
        {
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            DeteccionSolicitudesCambio.Revisar(cn);
            return PersistenciaSolicitudesCambio.ReactivacionActiva() + "|" + PersistenciaSolicitudesCambio.Activa();
        }
    }
    static readonly string[] ProcsReactivacion = { "usp_GestionAdmin_Modificar", "usp_SolicitudCambio_Aplicar", "usp_SolicitudCambio_Crear" };
    static void Propiedad(string proc, bool poner, string valor = "HISTORICA")
    {
        Exec(poner
            ? "EXEC sys.sp_addextendedproperty @name = N'ReglaReactivacion', @value = N'" + valor + "', @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'" + proc + "';"
            : "EXEC sys.sp_dropextendedproperty @name = N'ReglaReactivacion', @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'" + proc + "';");
    }

    // ---- E: el handler REAL de la edicion directa (admin_iniciativas_gestion.ashx) ----
    // App_Code lee "TicketsProactivanet" de ConfigurationManager: se apunta a la
    // base desechable por reflexion, sin escribir un .config (como
    // RegistroIniciativaFolioSqlLocalDbSmoke).
    static void ApuntarA(string cadena)
    {
        var lista = ConfigurationManager.ConnectionStrings;
        for (var t = lista.GetType(); t != null; t = t.BaseType)
            foreach (var f in t.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                if (f.FieldType == typeof(bool) && f.Name.IndexOf("ReadOnly", StringComparison.OrdinalIgnoreCase) >= 0)
                    f.SetValue(lista, false);
        lista.Remove("TicketsProactivanet");
        lista.Add(new ConnectionStringSettings("TicketsProactivanet", cadena, "System.Data.SqlClient"));
    }
    static void CabeceraNavegador(HttpRequest req, string nombre, string valor)
    {
        var h = req.Headers;
        var t = typeof(NameObjectCollectionBase);
        var f = BindingFlags.NonPublic | BindingFlags.Instance;
        var ro = t.GetProperty("IsReadOnly", f);
        ro.SetValue(h, false, null);
        t.GetMethod("BaseSet", f, null, new[] { typeof(string), typeof(object) }, null).Invoke(h, new object[] { nombre, new System.Collections.ArrayList { valor } });
        ro.SetValue(h, true, null);
    }
    // POST accion=modificar como ADM (t_adm) -> "estado|cuerpo".
    static string Gestion(params string[] kv)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("admin_iniciativas_gestion.ashx", "http://localhost/handlers/admin_iniciativas_gestion.ashx", ""), new HttpResponse(sw));
        ctx.User = new GenericPrincipal(new GenericIdentity(ADM, "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        var req = ctx.Request;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, "POST");
        CabeceraNavegador(req, "Sec-Fetch-Site", "same-origin");
        var form = (NameValueCollection)Activator.CreateInstance(typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection"), true);
        for (var i = 0; i < kv.Length; i += 2) form.Add(kv[i], kv[i + 1]);
        typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, form);
        new AdminIniciativasGestion().ProcessRequest(ctx);
        HttpContext.Current = null;
        return ctx.Response.StatusCode + "|" + sw.ToString();
    }
    static string Agregar(string cat, string pct, string ti, string ta)
    {
        return Gestion("accion", "modificar", "folio", F10, "agregar_categoria", cat, "agregar_pct", pct, "agregar_tipo_iniciativa", ti, "agregar_tipo_agrupado", ta);
    }

    // La MISMA serializacion canonica que sql/baseline_83_export.sql, en C#.
    static string HuellaCSharp(List<KeyValuePair<string, string>> pares)
    {
        var orden = pares.OrderBy(p => p.Key, StringComparer.Ordinal).ThenBy(p => p.Value, StringComparer.Ordinal).ToList();
        var sb = new StringBuilder();
        foreach (var p in orden) sb.Append(p.Key.Length).Append(':').Append(p.Key).Append('|').Append(p.Value.Length).Append(':').Append(p.Value).Append(';');
        using (var sha = SHA256.Create())
            return "0x" + BitConverter.ToString(sha.ComputeHash(Encoding.Unicode.GetBytes(sb.ToString()))).Replace("-", "");
    }

    public static int Main()
    {
        var sufijo = DateTime.Now.ToString("HHmmss");
        Base = "GestionAdminPrueba_R83" + sufijo;
        var guarda = "PruebaGuardaR83" + sufijo;   // NO empieza con GestionAdminPrueba_: la guarda de aprobacion actua
        try
        {
            // ---------------- G: guardas ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            Check("G1 83 y su rollback sin aprobar en una base que no es de prueba: se niegan", "True|True",
                  Script(M83, guarda).Contains("SIN APROBAR") + "|" + Script(R83, guarda).Contains("SIN APROBAR"));
            using (var cn = Abrir(guarda))
            using (var c = new SqlCommand("SELECT COUNT(*) FROM sys.objects WHERE is_ms_shipped = 0", cn))
                Check("G1 ... y no crean nada", 0, c.ExecuteScalar());
            Borrar(guarda);

            Preparar(Base);
            Check("G2 la cadena reproduce las huellas de la VM QA (Modificar 24, Aplicar 40, Crear 38)", Modificar24 + "|" + Aplicar40 + "|" + Crear38, Huellas());

            // ---------------- L (1/2): baseline ANTES de 83 ----------------
            var exp = Resultados(Leer("sql", "baseline_83_export.sql"));
            var cab = exp[0][0].Split('|');   // Cabecera|TomadaUtc|Base|Servidor|Filas|HuellaSha256
            var lineas = exp[1];
            var pares = Resultados("SELECT Codigo, Categoria FROM dbo.ProblemCategoria WHERE VigenteEnOrigen = 0")[0]
                .Select(f => { var x = f.Split('|'); return new KeyValuePair<string, string>(x[0], x[1]); }).ToList();
            Check("L1 baseline: filas = inactivas, una linea por par, huella = la misma serializacion calculada en C#",
                  pares.Count + "|" + pares.Count + "|" + HuellaCSharp(pares), cab[4] + "|" + lineas.Count + "|" + cab[5]);

            // Modificar alterado a mano: 83 se niega y no toca nada.
            var defMod = Uno("SELECT OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Modificar'))");
            Exec("EXEC sys.sp_executesql N'" + defMod.Replace("'", "''").Replace("CREATE PROCEDURE", "ALTER PROCEDURE").Replace("SET NOCOUNT ON;", "SET NOCOUNT ON; /* a mano */") + "'");
            var huellaAMano = Hash("adm.usp_GestionAdmin_Modificar");
            Check("G3 Modificar alterado a mano: 83 se niega (no son los de sql/24) y no toca nada", "True|" + huellaAMano + "|0",
                  Script(M83).Contains("no son los de sql/24") + "|" + Hash("adm.usp_GestionAdmin_Modificar") + "|" + Propiedades("ReglaReactivacion"));
            Exec("EXEC sys.sp_executesql N'" + defMod.Replace("'", "''").Replace("CREATE PROCEDURE", "ALTER PROCEDURE") + "'");
            Check("G4 rollback de 83 sin 83: ya deshecha, no toca nada", "True|" + Modificar24 + "|" + Aplicar40 + "|" + Crear38,
                  Script(R83).Contains("ya deshecha") + "|" + Huellas());

            // Antes de 83: una de baja no se vuelve a ligar (el comportamiento que se corrige).
            Check("G5 antes de 83: ADM directo / solicitud de una de baja = 51008", "E51008|E51008",
                  Modificar(ADM, F10, "/R/Hist2", 0.3m, "Problem", "Problem") + "|" + Pedir(F10, "/R/Hist", 0.25m));

            Check("F0 sin 83 (0 propiedades): el sitio NO la activa (y sql/22 si)", "0|False|True", Propiedades("ReglaReactivacion") + "|" + Deteccion());

            var r83 = Script(M83);
            Check("G6 83 sobre la cadena de la VM: APLICADA", "APLICADA", r83);
            Console.WriteLine("      huellas con 83: " + Huellas());
            Check("G6 otra vez: ya aplicada", true, Script(M83).Contains("ya aplicada"));
            Check("G7 el sitio (sin VIEW DEFINITION) ve las 3 propiedades; ReglaPso intacta; parametros 28 / 5 / 25", "3|EQUIPO_PO|28|5|25",
                  Sitio("SELECT COUNT(*) FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND name = N'ReglaReactivacion' AND CONVERT(nvarchar(30), value) = N'HISTORICA'") + "|" +
                  Uno("SELECT CONVERT(nvarchar(30), value) FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND major_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear') AND name = N'ReglaPso'") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_GestionAdmin_Modificar')") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar')") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear')"));

            // ---------------- F: despliegue a medias (propiedades) ----------------
            Check("F1 con 83 (3 propiedades HISTORICA): el sitio la activa", "3|True|True", Propiedades("ReglaReactivacion") + "|" + Deteccion());
            Propiedad(ProcsReactivacion[2], false);
            Check("F2 2 propiedades (falta la de Crear): NO se activa", "2|False|True", Propiedades("ReglaReactivacion") + "|" + Deteccion());
            Propiedad(ProcsReactivacion[1], false);
            Check("F3 1 propiedad (solo Modificar): NO se activa", "1|False|True", Propiedades("ReglaReactivacion") + "|" + Deteccion());
            Propiedad(ProcsReactivacion[0], false);
            Check("F4 0 propiedades con los procedimientos de 83: NO se activa", "0|False|True", Propiedades("ReglaReactivacion") + "|" + Deteccion());
            foreach (var p in ProcsReactivacion) Propiedad(p, true, p == ProcsReactivacion[1] ? "OTRA" : "HISTORICA");
            Check("F5 3 propiedades pero una con otro valor: NO se activa", "False|True", Deteccion());
            Propiedad(ProcsReactivacion[1], false); Propiedad(ProcsReactivacion[1], true);
            Check("F6 las 3 otra vez: se activa; huellas de 83 intactas", "True|True|" + Huellas(), Deteccion() + "|" +
                  "0x68331AC9641DBFD6A83213F5E74E23A5FA4F4CC8BC03F040A965269AC98B1054|0x8464627C052EA87A5792C1CE27477D3D04638A391FD29C66352BA66C295B218D|0x08CED77CF27E9E929F264377B1059541E8C6CBD050B909D03FA58952613EE842");

            // ---------------- E: el handler REAL de la edicion directa de ADM ----------------
            ApuntarA(Servidor + "Database=" + Base + ";Pooling=false;");
            AccesoAdmin.FuenteRoles = new RolesR83();
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            var eFilas = Filas();
            var e1 = Agregar("/R/HistE", "25", "Mejora", "Mejora");
            Check("E1 Clasificacion distinta de la historica no vacia: HTTP 422 (valida false, el motivo), sin cambios en la fila ni filas nuevas",
                  "422|True|True|0|0.2000|Problem|NULL|2026-10-01|2026-10-16|NULL|" + eFilas,
                  e1.Split('|')[0] + "|" + e1.Contains("\"valida\":false") + "|" + e1.Contains("se conserva y no se cambia") + "|" + Fila("/R/HistE") + "|" + Filas());
            var e2 = Agregar("/R/HistE2", "25", "Mejora", "Mejora");
            Check("E2 lo mismo con la Agrupacion historica: HTTP 422 y sin cambios", "422|0|0.2000|NULL|Problem",
                  e2.Split('|')[0] + "|" + string.Join("|", Fila("/R/HistE2").Split('|').Take(4)));
            var e3 = Agregar("/R/HistE", "25", "", "Mejora");
            Check("E3 solo el campo que falta (Agrupacion): guardado; la Clasificacion historica y las fechas ORIGINALES se conservan; la misma fila",
                  "200|True|1|0.2500|Problem|Mejora|2026-10-01|2026-10-16|" + eFilas,
                  e3.Split('|')[0] + "|" + e3.Contains("\"guardada\":true") + "|" + string.Join("|", Fila("/R/HistE").Split('|').Take(6)) + "|" + Filas());
            var e4 = Agregar("/R/HistE2", "25", "Mejora", "");
            Check("E4 solo el que falta (Clasificacion): guardado; la Agrupacion historica y las fechas se conservan",
                  "200|1|0.2500|Mejora|Problem|2026-10-02|2026-10-17",
                  e4.Split('|')[0] + "|" + string.Join("|", Fila("/R/HistE2").Split('|').Take(6)));
            Check("E5 el aviso de reactivacion viaja en la respuesta del handler", true, e3.Contains("se reactivar\\u00e1 la MISMA asociaci\\u00f3n") || e3.Contains("se reactivará la MISMA asociación"));

            // ---------------- S: solicitud (Crear) ----------------
            var s1 = Pedir(F10, "/R/Hist", 0.25m);
            Check("S1 AGREGAR de una de baja: se acepta (PENDIENTE)", "PENDIENTE|0", Solicitud(Id(s1)));
            Check("S2 AGREGAR de una VIGENTE: 51008", "E51008", Pedir(F10, "/R/Activa", 0.25m));

            // ---------------- D: edicion directa de ADM ----------------
            var filasAntes = Filas();
            var eventosAntes = EventosFecha();
            var selloAntes = Uno("SELECT ISNULL(CONVERT(varchar(30), UltimoCambioUtc, 126), 'NULL') FROM adm.IniciativaProtegida WHERE Codigo = N'" + F10 + "'");
            Check("D1 ADM reactiva /R/Hist2 (con la misma clasificacion): ok", "ok", Modificar(ADM, F10, "/R/Hist2", 0.3m, "Problem", "Problem"));
            Check("D2 la MISMA fila: sin fila nueva, vigente, % pedido, clasificacion y fechas historicas", filasAntes + "|1|0.3000|Problem|Problem|2026-02-01|2026-02-16|0",
                  Filas() + "|" + Fila("/R/Hist2"));
            Check("D3 sin evento de fecha (fechas intactas) y sello de proteccion por ADM", eventosAntes + "|True|" + ADM,
                  EventosFecha() + "|" + (Uno("SELECT ISNULL(CONVERT(varchar(30), UltimoCambioUtc, 126), 'NULL') FROM adm.IniciativaProtegida WHERE Codigo = N'" + F10 + "'") != selloAntes) + "|" +
                  Uno("SELECT UltimoCambioUsuario FROM adm.IniciativaProtegida WHERE Codigo = N'" + F10 + "'"));
            Check("D4 clasificacion vacia ('  ') se llena con la de ADM; la no vacia se conserva", "ok|1|0.2500|Problem|Mejora|2026-04-01|2026-04-16|0",
                  Modificar(ADM, F10, "/R/HistVacia", 0.25m, "", "Mejora") + "|" + Fila("/R/HistVacia"));
            Check("D5 conflicto con la historica no vacia: 51034 y no cambia nada", "E51034|0|0.2000|Problem|Problem|2026-05-01|2026-05-16|NULL",
                  Modificar(ADM, F10, "/R/HistConf", 0.25m, "Mejora", "Problem") + "|" + Fila("/R/HistConf"));
            Check("D6 solo mayusculas distintas (CI_AS) no es conflicto; se guarda la historica", "ok|1|0.2500|Problem|Problem|2026-05-01|2026-05-16|0",
                  Modificar(ADM, F10, "/R/HistConf", 0.25m, "PROBLEM", "problem") + "|" + Fila("/R/HistConf"));
            Check("D7 no ADM (MOD, sin fila, filas ADM + MOD): 51032 y no cambia nada", "E51032|E51032|E51032|0|0.2000",
                  Modificar(MOD, F10, "/R/Mod", 0.3m) + "|" + Modificar(NADIE, F10, "/R/Mod", 0.3m) + "|" + Modificar(MIX, F10, "/R/Mod", 0.3m) + "|" +
                  Fila("/R/Mod").Split('|')[0] + "|" + Fila("/R/Mod").Split('|')[1]);
            Check("D8 categoria de baja en el catalogo, tambien para ADM: 51015", "E51015|0", Modificar(ADM, F10, "/R/Baja", 0.1m) + "|" + Fila("/R/Baja").Split('|')[0]);
            Check("D9 quitar y agregar la misma en un guardado: 51018", "E51018", Modificar(ADM, F10, "/R/Activa", 0.1m, null, null, null, "/R/Activa"));
            Check("D10 agregar una NUEVA (sin historica): fila nueva con fechas de hoy y hoy + 15", "ok|1|0.1000|Problem|Problem|2026-11-10|2026-11-25|0",
                  Modificar(ADM, F10, "/R/Nueva2", 0.1m, "Problem", "Problem") + "|" + Fila("/R/Nueva2"));
            Check("D11 quitar como antes; volver a agregarla la reactiva (fechas NULL intactas)", "ok|0|ok|1|0.1500|Problem|Problem|NULL|NULL|0",
                  Modificar(ADM, F10, null, null, null, null, null, "/R/Activa") + "|" + Fila("/R/Activa").Split('|')[0] + "|" +
                  Modificar(ADM, F10, "/R/Activa", 0.15m) + "|" + Fila("/R/Activa"));
            Check("D12 una VIGENTE sigue siendo 51008 en la edicion directa", "E51008", Modificar(ADM, F10, "/R/Activa", 0.15m));

            // ---------------- T: tope con la Agrupacion efectiva ----------------
            Check("T1 reactivar /R/Cap (historica Problem, otra iniciativa con 90%): tope 51010, sin cambio", "E51010|0",
                  Modificar(ADM, F10, "/R/Cap", 0.2m) + "|" + Fila("/R/Cap").Split('|')[0]);
            Check("T2 /R/CapReq: Agrupacion distinta de la historica (ReqOpr) = 51034", "E51034", Modificar(ADM, F10, "/R/CapReq", 0.2m, null, "Problem"));
            Check("T3 /R/CapReq con su historica ReqOpr (no consume): se reactiva aunque la otra tenga 90%", "ok|1|0.2000|Problem|ReqOpr",
                  Modificar(ADM, F10, "/R/CapReq", 0.2m) + "|" + string.Join("|", Fila("/R/CapReq").Split('|').Take(4)));
            var t4 = Id(Pedir(F10, "/R/Cap", 0.2m, "Problem", "ReqOpr"));
            Check("T4 solicitud de /R/Cap pidiendo ReqOpr: la efectiva es la historica (Problem) y el tope la detiene; registrada, PENDIENTE",
                  "E51010|PENDIENTE|1|0", Aplicar(t4) + "|" + Solicitud(t4) + "|" + Fila("/R/Cap").Split('|')[0]);

            // ---------------- A: aprobar ----------------
            var eventosA = EventosFecha();
            Check("A1 aprobar la solicitud de /R/Hist (sin clasificacion: la historica esta completa): reactiva la MISMA fila", "ok|APLICADA|1|1|0.2500|Problem|Problem|2026-01-05|2026-01-20|0",
                  Aplicar(Id(s1)) + "|" + Solicitud(Id(s1)) + "|" + Fila("/R/Hist"));
            Check("A2 TicketsReduce recalculado (99 -> 0 sin volumen) y sin evento de fecha", eventosA, EventosFecha());
            var a3 = Id(Pedir(F10, "/R/H10", 0.3m));
            Rechazar(a3);
            var a3otra = Id(Pedir(F12, "/R/H10", 0.3m));
            var a3sin = Id(Pedir(F10, "/R/Nueva", 0.3m, "Problem", "Problem"));
            Check("A3 @SolicitudId rechazada / inexistente / de otra iniciativa / sin esa categoria: 51033; la fila no cambia", "E51033|E51033|E51033|E51033|0",
                  Modificar(ADM, F10, "/R/H10", 0.3m, null, null, a3) + "|" + Modificar(ADM, F10, "/R/H10", 0.3m, null, null, 999999) + "|" +
                  Modificar(ADM, F10, "/R/H10", 0.3m, null, null, a3otra) + "|" + Modificar(ADM, F10, "/R/H10", 0.3m, null, null, a3sin) + "|" +
                  Fila("/R/H10").Split('|')[0]);
            var a4 = Id(Pedir(F10, "/R/Mod", 0.3m));
            Check("A4 revisor no ADM (defensa de la base): 51032, registrada, sigue PENDIENTE; con ADM se aplica", "E51032|PENDIENTE|1|ok|1",
                  Aplicar(a4, null, null, null, MOD) + "|" + Solicitud(a4) + "|" + Aplicar(a4) + "|" + Fila("/R/Mod").Split('|')[0]);
            var a5 = Id(Pedir(F10, "/R/Hist3", 0.3m));
            Modificar(ADM, F10, "/R/Hist3", 0.2m);
            Check("A5 la fila se reactivo despues de enviar: desactualizada 51204, PENDIENTE con su intento", "E51204|PENDIENTE|1", Aplicar(a5) + "|" + Solicitud(a5));
            var a6 = Id(Pedir(F10, "/R/HistParcial", 0.3m));
            Check("A6 parcial (historica sin Agrupacion): sin clasificar 51221 (registrada)", "E51221|PENDIENTE|1", Aplicar(a6) + "|" + Solicitud(a6));
            Check("A7 parcial: traer el campo que NO falta 51222; dejar vacio el que falta 51223", "E51222|E51223",
                  Aplicar(a6, "/R/HistParcial", "Mejora", "Problem") + "|" + Aplicar(a6, "/R/HistParcial", "", ""));
            Check("A8 parcial: solo el que falta -> se aplica; la historica se conserva y se llena la Agrupacion", "ok|1|0.3000|Problem|Mejora|2026-06-01|2026-06-16",
                  Aplicar(a6, "/R/HistParcial", "", "Mejora") + "|" + string.Join("|", Fila("/R/HistParcial").Split('|').Take(6)));
            Check("A9 la solicitud guarda solo el campo que faltaba", "NULL|Mejora",
                  Uno("SELECT CONCAT(ISNULL(TipoIniciativa, 'NULL'), '|', ISNULL(TipoAgrupado, 'NULL')) FROM adm.SolicitudCambioCategoria WHERE IdSolicitud = " + a6));
            var a10 = Id(Pedir(F10, "/R/Nueva", 0.05m));
            Check("A10 AGREGAR nuevo (sin historica), la regla de siempre: sin clasificar 51221; parcial 51223; completa se aplica con fechas de hoy",
                  "E51221|E51223|ok|1|0.0500|Problem|Problem|2026-11-10|2026-11-25",
                  Aplicar(a10) + "|" + Aplicar(a10, "/R/Nueva", "Problem", "") + "|" + Aplicar(a10, "/R/Nueva", "Problem", "Problem") + "|" +
                  string.Join("|", Fila("/R/Nueva").Split('|').Take(6)));
            var a11 = Id(Pedir(F10, "/R/H21", 0.1m));
            var a11b = Sitio(ReemplazarSql, "@orig", a11, "@u", MOD, "@llave", Guid.NewGuid(), "@folio", F10, "@cat", "/R/H21", "@pct", 0.12m);
            Check("A11 reemplazar (sql/41) una reactivacion: la nueva se aplica y reactiva la fila", "CANCELADA|0|ok|1|0.1200|2026-09-02",
                  Solicitud(a11) + "|" + Aplicar(Id(a11b)) + "|" + Fila("/R/H21").Split('|')[0] + "|" + Fila("/R/H21").Split('|')[1] + "|" + Fila("/R/H21").Split('|')[4]);
            Check("A12 los demas AGREGAR / quitar / ESTADO siguen igual: pedir una VIGENTE 51008; pedir la misma de baja dos veces se acepta", "E51008|PENDIENTE",
                  Pedir(F10, "/R/Hist2", 0.1m) + "|" + Solicitud(Id(Pedir(F10, "/R/Hist4", 0.1m))).Split('|')[0]);

            // ---------------- K: carrera ----------------
            var k1 = Id(Pedir(F10, "/R/Hist4", 0.2m));
            Check("K1 Cancelar tiene la solicitud; Modificar con ese @SolicitudId espera el MISMO candado y luego ve CANCELADA (51033); la fila no cambia",
                  "True|ok|E51033|0",
                  Carrera("EXEC adm.usp_SolicitudCambio_Cancelar @IdSolicitud = " + k1 + ", @Usuario = N'" + MOD + "', @Motivo = N'ya no'; SELECT 'ok';",
                          () => Modificar(ADM, F10, "/R/Hist4", 0.2m, null, null, k1)) + "|" + Fila("/R/Hist4").Split('|')[0]);

            // ---------------- L (2/2): diagnostico contra la baseline ----------------
            var diag = Leer("sql", "diag_83_reactivacion.sql")
                .Replace("DECLARE @TomadaUtc      datetime2(7)  = NULL;", "DECLARE @TomadaUtc      datetime2(7)  = '" + cab[1] + "';")
                .Replace("DECLARE @FilasEsperadas int           = NULL;", "DECLARE @FilasEsperadas int           = " + cab[4] + ";")
                .Replace("DECLARE @HuellaEsperada varbinary(32) = NULL;", "DECLARE @HuellaEsperada varbinary(32) = " + cab[5] + ";");
            var pegado = diag.Replace("(NULL, NULL)   -- centinela: no borrar", string.Join(Environment.NewLine, lineas) + Environment.NewLine + "(NULL, NULL)   -- centinela: no borrar");
            var d = Resultados(pegado);   // A, V, R
            var reactivadas = d[2].Select(f => f.Split('|')).OrderBy(x => x[2], StringComparer.Ordinal)
                                  .Select(x => x[2] + "=" + x[x.Length - 1]).ToList();
            Check("L2 diagnostico: A dice sql/83 en los tres; baseline VALIDA", "sql/83|sql/83|sql/83|BASELINE VALIDA",
                  string.Join("|", d[0].Select(f => f.Split('|')[3])) + "|" + d[1][0].Split('|').Last());
            Check("L3 lista lo reactivado despues de la baseline, con su evidencia",
                  "/R/CapReq=ADM DIRECTO (probable)|/R/H21=SOLICITUD APLICADA|/R/Hist=SOLICITUD APLICADA|/R/Hist2=ADM DIRECTO (probable)|" +
                  "/R/Hist3=ADM DIRECTO (probable)|/R/HistConf=ADM DIRECTO (probable)|/R/HistE=ADM DIRECTO (probable)|/R/HistE2=ADM DIRECTO (probable)|/R/HistParcial=SOLICITUD APLICADA|/R/HistVacia=ADM DIRECTO (probable)|/R/Mod=SOLICITUD APLICADA",
                  string.Join("|", reactivadas));
            var alterada = lineas.ToList();
            alterada[0] = alterada[0].Substring(0, 5) + (alterada[0][5] == 'A' ? 'B' : 'A') + alterada[0].Substring(6);
            var dMal = Resultados(diag.Replace("(NULL, NULL)   -- centinela: no borrar", string.Join(Environment.NewLine, alterada) + Environment.NewLine + "(NULL, NULL)   -- centinela: no borrar"));
            Check("L4 una linea alterada: BASELINE INVALIDA y no atribuye nada", "BASELINE INVALIDA: no se atribuye nada|0", dMal[1][0].Split('|').Last() + "|" + dMal[2].Count);
            var dSin = Resultados(diag);
            Check("L5 sin baseline pegada (valores NULL): INVALIDA y no atribuye nada", "BASELINE INVALIDA: no se atribuye nada|0", dSin[1][0].Split('|').Last() + "|" + dSin[2].Count);
            Check("L6 el par con NBSP, enie y espacio final viaja exacto en la baseline (sigue de baja, no se lista)", "True|0",
                  lineas.Any(l => l.Contains("A000F1002000")) + "|" + Fila(Rara, "PRB 2026-000013").Split('|')[0]);

            // ---------------- B: rollback ----------------
            Check("B1 rollback: DESHECHA; huellas EXACTAS de 24 / 40 / 38; sin propiedades; ReglaPso intacta", "DESHECHA|" + Modificar24 + "|" + Aplicar40 + "|" + Crear38 + "|0|EQUIPO_PO",
                  Script(R83) + "|" + Huellas() + "|" + Propiedades("ReglaReactivacion") + "|" +
                  Uno("SELECT CONVERT(nvarchar(30), value) FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND major_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear') AND name = N'ReglaPso'"));
            Check("B2 lo reactivado se queda vigente; reactivar otra vez = 51008 (como antes de 83)", "1|1|E51008|E51008",
                  Fila("/R/Hist2").Split('|')[0] + "|" + Fila("/R/Hist").Split('|')[0] + "|" + Modificar(ADM, F10, "/R/Hist4", 0.2m) + "|" + Pedir(F10, "/R/Hist4", 0.2m));
            Check("F7 despues del rollback: 0 propiedades y el sitio vuelve a lo de antes (no la activa)", "0|False|True", Propiedades("ReglaReactivacion") + "|" + Deteccion());
            Check("B3 rollback otra vez: ya deshecha", true, Script(R83).Contains("ya deshecha"));
            Check("B4 reaplicar 83 despues del rollback: APLICADA y funciona", "APLICADA|ok|1",
                  Script(M83) + "|" + Modificar(ADM, F10, "/R/Hist4", 0.2m) + "|" + Fila("/R/Hist4").Split('|')[0]);
            Check("F8 reaplicada: 3 propiedades y se activa otra vez", "3|True|True", Propiedades("ReglaReactivacion") + "|" + Deteccion());
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("ERROR  " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(guarda); } catch (Exception) { }
        }
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }
}
