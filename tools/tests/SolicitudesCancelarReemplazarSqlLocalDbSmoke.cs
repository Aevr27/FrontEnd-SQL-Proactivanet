// Prueba de INTEGRACION de sql/41 (solicitudes de cambio) y sql/42 (Nuevas
// solicitudes de iniciativa): cancelar y reemplazar por quien la envio,
// con sus rollbacks, contra bases DESECHABLES de SQL Server LocalDB:
// GestionAdminPrueba_Ccr<n> (replica de dbo + migraciones reales 18, 20-27,
// 29, 31, 32, 34-40 con 38) y GestionAdminPrueba_Ccr37<n> (igual sin 38),
// con la cuenta del sitio como en la VM (PROACTIVANETAD: db_datareader +
// db_datawriter + EXECUTE sobre adm, y los DENY de 22P / 29). BORRA las
// bases al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  guardas: sin aprobar en una base que no es de prueba; precondicion
//      (un CHECK cambiado, Crear de otra huella); 41 con Crear de sql/37;
//      ya aplicada; deteccion del sitio por nombres de CHECK.
//   C  cancelar un cambio: quien, cuando, motivo, evento CANCELADA, la
//      bitacora anterior intacta; motivo vacio / largo; otra cuenta o
//      inexistente; revisada o ya cancelada; Aplicar / Rechazar /
//      RegistrarFallo de una CANCELADA; DENY directo; CHECK.
//   R  reemplazar un cambio: nueva con ReemplazaA, original CANCELADA con
//      REEMPLAZADA, mismas validaciones de Crear (todo o nada), re-chequeo
//      PSO, misma iniciativa, idempotencia por llave, cadena de reemplazos,
//      la nueva sigue el flujo normal (aplicar / rechazar), indice unico y
//      CHECK de orden.
//   K  carreras con dos conexiones: Rechazar / Cancelar / Reemplazar se
//      esperan en el MISMO candado; gana el primero.
//   I  lo mismo para Nuevas solicitudes (sql/42): cancelar, reemplazar
//      (numero nuevo del contador, todo o nada), Aprobar / Rechazar /
//      AprobarYCrear de una CANCELADA, carrera, idempotencia por token.
//   V  el aviso de ADM (sql/39, AlmacenVistasSql) no cuenta canceladas.
//   B  rollbacks: completo se niega con datos (nada cambia); el de
//      procedimiento apaga sin tocar datos; volver a correr = REACTIVADA;
//      completo sin datos vuelve a la forma vieja; y reaplicar.
//
// Necesita ../backend_admin_persistencia (vistas de origen). Compilar con
// adm.dll (receta en AccesoAdminHttpSmoke.cs) y correr con cwd = raiz.
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class SolicitudesCancelarReemplazarSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string M41 = "41_solicitudes_cambio_cancelar_reemplazar";
    const string M42 = "42_solicitud_iniciativa_cancelar_reemplazar";
    const string ANDRES = @"SORIANA\andresvr";     // PO de PRB-1 en CatPersona (PSO)
    const string MOD = @"SORIANA\t_mod";
    const string OTRO = @"SORIANA\t_otro";
    const string ADM = @"SORIANA\t_adm";
    static readonly string EnAnalisis = "En An" + (char)0xE1 + "lisis";
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
    // Un script de sql/: el Resultado ("APLICADA", "REACTIVADA", "APLICADO") o el mensaje con que se niega.
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

    // ---- Solicitudes de cambio (como las manda el sitio) ----
    const string CrearCambioSql = @"DECLARE @c adm.SolicitudCategoriaTipo, @id int, @r bit;
EXEC adm.usp_SolicitudCambio_Crear @Usuario = @u, @Rol = @rol, @Llave = @llave, @Codigo = @folio, @Tipo = @tipo,
     @EstadoNuevo = @estado, @Motivo = N'motivo', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT;
SELECT CONCAT(@id, '|', CONVERT(int, @r));";
    const string ReemplazarCambioSql = @"DECLARE @c adm.SolicitudCategoriaTipo, @id int, @r bit;
EXEC adm.usp_SolicitudCambio_Reemplazar @ReemplazaA = @orig, @MotivoCancelacion = @mc,
     @Usuario = @u, @Rol = @rol, @Llave = @llave, @Codigo = @folio, @Tipo = @tipo,
     @EstadoNuevo = @estado, @Motivo = N'motivo nuevo', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT;
SELECT CONCAT(@id, '|', CONVERT(int, @r));";
    static string Cambio(string cuenta, string rol, string folio, string tipo = "ESTADO", string estado = "Cerrado", Guid? llave = null)
    {
        return Sitio(CrearCambioSql, "@u", cuenta, "@rol", rol, "@llave", llave ?? Guid.NewGuid(), "@folio", folio, "@tipo", tipo,
                     "@estado", tipo == "ESTADO" ? estado : null);
    }
    static int IdDe(string r) { return int.Parse(r.Split('|')[0]); }
    static string Reemplazar(int orig, string mc, string cuenta, string rol, string folio, string tipo = "ESTADO", string estado = "Cerrado", Guid? llave = null)
    {
        return Sitio(ReemplazarCambioSql, "@orig", orig, "@mc", mc, "@u", cuenta, "@rol", rol, "@llave", llave ?? Guid.NewGuid(), "@folio", folio,
                     "@tipo", tipo, "@estado", tipo == "ESTADO" ? estado : null);
    }
    static string Cancelar(int id, string cuenta, string motivo)
    {
        return Sitio("EXEC adm.usp_SolicitudCambio_Cancelar @IdSolicitud = @id, @Usuario = @u, @Motivo = @m; SELECT 'ok';", "@id", id, "@u", cuenta, "@m", motivo);
    }
    static string Rechazar(int id) { return Sitio("EXEC adm.usp_SolicitudCambio_Rechazar @IdSolicitud = @id, @Revisor = @r, @Comentario = N'no'; SELECT 'ok';", "@id", id, "@r", ADM); }
    static string Aplicar(int id, string comentario = null)
    {
        return Sitio("DECLARE @k adm.SolicitudClasificacionTipo; EXEC adm.usp_SolicitudCambio_Aplicar @IdSolicitud = @id, @Revisor = @r, @Comentario = @c, @Clasificaciones = @k; SELECT 'ok';",
                     "@id", id, "@r", ADM, "@c", comentario);
    }
    static string Fila(int id)
    {
        return Uno("SELECT CONCAT(Estado, '|', ISNULL(CanceladoPor, 'NULL'), '|', CASE WHEN FechaCancelacionUtc IS NULL THEN 'NULL' ELSE 'fecha' END, '|', ISNULL(MotivoCancelacion, 'NULL'), '|', ISNULL(CONVERT(varchar(12), ReemplazaA), 'NULL'), '|', ISNULL(RevisadoPor, 'NULL'))" +
                   " FROM adm.SolicitudCambio WHERE IdSolicitud = " + id);
    }
    static string Eventos(int id)
    {
        return Uno("SELECT STRING_AGG(CONCAT(Evento, ':', Usuario, ':', ISNULL(Detalle, '')), ' / ') WITHIN GROUP (ORDER BY IdEvento) FROM adm.SolicitudCambioEvento WHERE IdSolicitud = " + id);
    }
    static string Cuenta(string tabla) { return Uno("SELECT COUNT(*) FROM " + tabla); }

    // ---- Nuevas solicitudes de iniciativa ----
    const string CamposIni = @"@Usuario = @u, @Token = @t, @TipoIniciativa = N'PRB', @ProductOwner = N'Jesus Campa Morones', @ServiceOwner = N'SO 1',
     @Categoria = N'/A/Cat 1', @Director = N'Dir 1', @Titulo = @titulo, @Descripcion = N'D', @Observaciones = N'O', @Volumetria = 100,
     @PctDisminucion = 0.0100, @RcaExtension = NULL, @SolicitanteNombre = @sn, @SolicitanteCorreo = @sc,
     @ProductOwnerCorreo = @poc, @NumeroSolicitud = @n OUTPUT, @Nuevo = @nv OUTPUT, @FechaUtc = @f OUTPUT";
    static string Ini(string cuenta, Guid? token = null, string titulo = "T", string poCorreo = "jesuscamor@soriana.com")
    {
        return Sitio("DECLARE @n int, @nv bit, @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Crear " + CamposIni + "; SELECT CONCAT(@n, '|', CONVERT(int, @nv));",
                     "@u", cuenta, "@t", token ?? Guid.NewGuid(), "@titulo", titulo, "@poc", poCorreo, "@sn", NombreDe(cuenta), "@sc", CorreoDe(cuenta));
    }
    // El solicitante que manda el sitio: la persona de CatPersona de esa cuenta.
    static string NombreDe(string cuenta) { return cuenta.Trim().ToUpperInvariant() == OTRO.ToUpperInvariant() ? "Otro Usuario" : "Andres Vera Rios"; }
    static string CorreoDe(string cuenta) { return cuenta.Trim().ToUpperInvariant() == OTRO.ToUpperInvariant() ? "t_otro@soriana.com" : "andresvr@soriana.com"; }
    static string IniReemplazar(int orig, string mc, string cuenta, Guid? token = null, string titulo = "T2", string poCorreo = "jesuscamor@soriana.com")
    {
        return Sitio("DECLARE @n int, @nv bit, @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Reemplazar @ReemplazaA = @orig, @MotivoCancelacion = @mc, " + CamposIni +
                     "; SELECT CONCAT(@n, '|', CONVERT(int, @nv));",
                     "@orig", orig, "@mc", mc, "@u", cuenta, "@t", token ?? Guid.NewGuid(), "@titulo", titulo, "@poc", poCorreo, "@sn", NombreDe(cuenta), "@sc", CorreoDe(cuenta));
    }
    static string IniCancelar(int n, string cuenta, string motivo)
    {
        return Sitio("EXEC adm.usp_SolicitudIniciativa_Cancelar @NumeroSolicitud = @n, @Usuario = @u, @Motivo = @m; SELECT 'ok';", "@n", n, "@u", cuenta, "@m", motivo);
    }
    static string IniFila(int n)
    {
        return Uno("SELECT CONCAT(Estado, '|', ISNULL(CanceladoPor, 'NULL'), '|', CASE WHEN FechaCancelacionUtc IS NULL THEN 'NULL' ELSE 'fecha' END, '|', ISNULL(MotivoCancelacion, 'NULL'), '|', ISNULL(CONVERT(varchar(12), ReemplazaA), 'NULL'), '|', Titulo)" +
                   " FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n);
    }
    static string IniEventos(int n)
    {
        return Uno("SELECT STRING_AGG(CONCAT(Evento, ':', ISNULL(EstadoAnterior, '-'), '>', EstadoNuevo, ':', Usuario, ':', ISNULL(Detalle, '')), ' / ') WITHIN GROUP (ORDER BY IdEvento) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n);
    }

    // Carrera: A abre transaccion y toma el candado con `primero` (sin
    // COMMIT); B corre `segundo` en otro hilo. Devuelve si B espero, lo que
    // devolvio B despues del COMMIT de A, y el resultado de A.
    static string Carrera(string primero, string segundo)
    {
        using (var a = ComoSitio())
        {
            Exec(a, "BEGIN TRAN;");
            string resA;
            try { using (var c = new SqlCommand(primero, a)) resA = Convert.ToString(c.ExecuteScalar()); }
            catch (SqlException ex) { resA = "E" + ex.Number; }
            string resB = null;
            var hilo = new Thread(() => { resB = Sitio(segundo); });
            hilo.Start();
            var espero = !hilo.Join(1500);
            if (a.State == ConnectionState.Open) { try { Exec(a, "IF @@TRANCOUNT > 0 COMMIT;"); } catch (SqlException) { } }
            hilo.Join(30000);
            return espero + "|" + resA + "|" + resB;
        }
    }

    static void Preparar(string db, bool con38)
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
INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES
 (N'Andres Vera Rios', N'andresvr@soriana.com', 1), (N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1),
 (N'Otro Usuario', N't_otro@soriana.com', 1);
CREATE TABLE dbo.UsuariosAdmin (Usuario nvarchar(50) NULL, CorreoUsuario nvarchar(50) NULL,
    Acceso nvarchar(3) NOT NULL CONSTRAINT CK_UsuariosAdmin_Acceso CHECK (Acceso IN (N'MOD', N'ADM')) CONSTRAINT DF_UsuariosAdmin_Acceso DEFAULT (N'MOD'));
INSERT dbo.UsuariosAdmin (Usuario, CorreoUsuario, Acceso) VALUES (N'SORIANA\t_adm', N't_adm@soriana.com', N'ADM'), (N'SORIANA\t_mod', N't_mod@soriana.com', N'MOD');
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, OwnerProblem, OwnerServicio) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'" + EnAnalisis + @"', NULL, N'Andres Vera Rios', N'SO 1'),
 (N'PRB 2026-000002', N'Problem', N'Dos', N'" + EnAnalisis + @"', NULL, N'Jesus Campa Morones', N'SO 1'),
 (N'PRB 2026-000005', N'Problem', N'Cinco', N'Cerrado', NULL, NULL, NULL);");
            var resto = con38
                ? new[] { "35_usuarios_admin_nombre_solicitante", "36_solicitud_iniciativa_solicitante_admin", "37_solicitudes_cambio_pso", "38_solicitudes_cambio_pso_equipo", "39_solicitudes_vistas", "40_solicitud_cambio_cierre_monitoreo" }
                : new[] { "35_usuarios_admin_nombre_solicitante", "36_solicitud_iniciativa_solicitante_admin", "37_solicitudes_cambio_pso", "39_solicitudes_vistas", "40_solicitud_cambio_cierre_monitoreo" };
            foreach (var s in resto) Lotes(cn, Leer("sql", s + ".sql"));
        }
    }

    public static int Main()
    {
        var sufijo = DateTime.Now.ToString("HHmmss");
        Base = "GestionAdminPrueba_Ccr" + sufijo;
        var base37 = "GestionAdminPrueba_Ccr37" + sufijo;
        var guarda = "PruebaGuardaCcr" + sufijo;   // NO empieza con GestionAdminPrueba_: la guarda de aprobacion actua
        try
        {
            // ---------------- G: guardas ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            Check("G1 41 sin aprobar en una base que no es de prueba: se niega", true, Script(M41, guarda).Contains("SIN APROBAR"));
            Check("G1 42 sin aprobar en una base que no es de prueba: se niega", true, Script(M42, guarda).Contains("SIN APROBAR"));
            using (var cn = Abrir(guarda))
            using (var c = new SqlCommand("SELECT COUNT(*) FROM sys.objects WHERE is_ms_shipped = 0", cn))
                Check("G1 ... y no crea nada", 0, c.ExecuteScalar());
            Borrar(guarda);

            Preparar(base37, false);
            Check("G2 41 con Crear de sql/37 (sin 38): APLICADA", "APLICADA", Script(M41, base37));
            Check("G2 42 en la misma base: APLICADA", "APLICADA", Script(M42, base37));
            Borrar(base37);

            Preparar(Base, true);
            Exec("ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_Rechazo; " +
                 "ALTER TABLE adm.SolicitudCambio ADD CONSTRAINT CK_SolicitudCambio_Rechazo CHECK (Estado <> 'RECHAZADA' OR ComentarioRevision IS NOT NULL);");
            Check("G3 41 con un CHECK de sql/22 cambiado: se niega y no toca nada", "True|NULL",
                  Script(M41).Contains("CHECK") + "|" + Uno("SELECT COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA')"));
            Exec("ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_Rechazo; " +
                 "ALTER TABLE adm.SolicitudCambio ADD CONSTRAINT CK_SolicitudCambio_Rechazo CHECK (Estado <> 'RECHAZADA' OR LEN(LTRIM(RTRIM(ComentarioRevision))) > 0);");
            var defCrear = Uno("SELECT OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear'))");
            Exec("EXEC sys.sp_executesql N'" + defCrear.Replace("'", "''").Replace("CREATE PROCEDURE", "ALTER PROCEDURE").Replace("SET NOCOUNT ON;", "SET NOCOUNT ON; /* a mano */") + "'");
            Check("G3 42 con Crear de iniciativa alterado a mano: se niega y no toca nada", "True|NULL",
                  Script(M42).Contains("sql/36") + "|" + Uno("SELECT COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA')"));
            Exec("EXEC sys.sp_executesql N'" + defCrear.Replace("'", "''").Replace("CREATE PROCEDURE", "ALTER PROCEDURE") + "'");

            Check("G4 41 y 42 sobre la cadena 18-40 (con 38): APLICADA", "APLICADA|APLICADA", Script(M41) + "|" + Script(M42));
            Check("G4 otra vez: se niegan (ya aplicada)", "True|True", Script(M41).Contains("ya aplicada") + "|" + Script(M42).Contains("ya aplicada"));
            Check("G5 el sitio (sin VIEW DEFINITION) ve los CHECK nuevos y los procedimientos: deteccion", "2|2",
                  Sitio("SELECT COUNT(*) FROM sys.check_constraints WHERE name IN (N'CK_SolicitudCambio_EstadoCancelada', N'CK_SolicitudIniciativa_EstadoCancelada')") + "|" +
                  Sitio("SELECT COUNT(*) FROM sys.procedures WHERE name IN (N'usp_SolicitudCambio_Cancelar', N'usp_SolicitudIniciativa_Cancelar')"));
            Check("G6 DENY intactos (9 de 22P + 9 de 29) y el sitio no escribe a mano las columnas nuevas", "18|E229",
                  Uno("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND state = 'D' AND major_id IN " +
                      "(OBJECT_ID(N'adm.SolicitudCambio'), OBJECT_ID(N'adm.SolicitudCambioCategoria'), OBJECT_ID(N'adm.SolicitudCambioEvento'), OBJECT_ID(N'adm.SolicitudIniciativa'), OBJECT_ID(N'adm.SolicitudIniciativaEvento'), OBJECT_ID(N'adm.SolicitudIniciativaContador'))") + "|" +
                  Sitio("UPDATE adm.SolicitudCambio SET MotivoCancelacion = N'x' WHERE 1 = 0; SELECT 'ok';"));

            // ---------------- C: cancelar un cambio ----------------
            var c1 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            var antes = Eventos(c1);
            Check("C1 motivo vacio / solo espacios / NULL: 51228; largo: 51229; sin usuario: 51001", "E51228|E51228|E51228|E51229|E51001",
                  Cancelar(c1, MOD, "") + "|" + Cancelar(c1, MOD, "   ") + "|" + Cancelar(c1, MOD, null) + "|" + Cancelar(c1, MOD, new string('x', 2001)) + "|" + Cancelar(c1, " ", "m"));
            Check("C2 otra cuenta o inexistente: 51201 (no se distingue); nada cambia", "E51201|E51201|PENDIENTE|NULL|NULL|NULL|NULL|NULL",
                  Cancelar(c1, OTRO, "m") + "|" + Cancelar(999999, MOD, "m") + "|" + Fila(c1));
            Check("C3 la suya, cuenta con otras mayusculas y espacios: CANCELADA con quien, fecha y motivo", "ok|CANCELADA|SORIANA\\T_MOD|fecha|Ya no aplica|NULL|NULL",
                  Cancelar(c1, "  SORIANA\\T_MOD ", "  Ya no aplica ") + "|" + Fila(c1));
            Check("C4 bitacora: lo anterior intacto + evento CANCELADA con quien y motivo", antes + " / CANCELADA:SORIANA\\T_MOD:Ya no aplica", Eventos(c1));
            Check("C5 cancelar otra vez: 51230; Aplicar / Rechazar una CANCELADA: 51202, sin intento registrado", "E51230|E51202|E51202|0|CANCELADA",
                  Cancelar(c1, MOD, "m") + "|" + Aplicar(c1, "x") + "|" + Rechazar(c1) + "|" + Uno("SELECT Intentos FROM adm.SolicitudCambio WHERE IdSolicitud = " + c1) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + c1));
            Check("C5 RegistrarFallo de una CANCELADA: 51202", "E51202",
                  Sitio("EXEC adm.usp_SolicitudCambio_RegistrarFallo @IdSolicitud = @id, @Revisor = N'x', @Numero = 1, @Mensaje = N'x'; SELECT 'ok';", "@id", c1));
            var c2 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001", "OTROS"));
            var c3 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            Check("C6 aplicada o rechazada: no se cancela (51230) y queda igual", "ok|ok|E51230|E51230|APLICADA|RECHAZADA",
                  Aplicar(c2, "atendida") + "|" + Rechazar(c3) + "|" + Cancelar(c2, MOD, "m") + "|" + Cancelar(c3, MOD, "m") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + c2) + "|" + Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + c3));
            var c4 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            string chk;
            try { Exec("UPDATE adm.SolicitudCambio SET Estado = 'CANCELADA', CanceladoPor = N'SORIANA\\otro', FechaCancelacionUtc = SYSUTCDATETIME(), MotivoCancelacion = N'm' WHERE IdSolicitud = " + c4); chk = "sin error"; }
            catch (SqlException ex) { chk = ex.Number.ToString(); }
            string chk2;
            try { Exec("UPDATE adm.SolicitudCambio SET Estado = 'CANCELADA', CanceladoPor = N'SORIANA\\t_mod', FechaCancelacionUtc = SYSUTCDATETIME(), MotivoCancelacion = N'  ' WHERE IdSolicitud = " + c4); chk2 = "sin error"; }
            catch (SqlException ex) { chk2 = ex.Number.ToString(); }
            string chk3;
            try { Exec("UPDATE adm.SolicitudCambio SET Estado = 'APLICADA', RevisadoPor = N'x', FechaRevisionUtc = SYSUTCDATETIME(), CanceladoPor = N'SORIANA\\t_mod' WHERE IdSolicitud = " + c4); chk3 = "sin error"; }
            catch (SqlException ex) { chk3 = ex.Number.ToString(); }
            Check("C7 CHECK (como dbo): cancelada por otra cuenta, sin motivo, o revisada con cancelacion: 547", "547|547|547", chk + "|" + chk2 + "|" + chk3);

            // ---------------- R: reemplazar un cambio ----------------
            var r0 = IdDe(Cambio(ANDRES, "PSO", "PRB 2026-000001"));
            var r0ev = Eventos(r0);
            var nAntes = Cuenta("adm.SolicitudCambio");
            Check("R1 sin motivo de cancelacion: 51228; otra cuenta: 51201; otra iniciativa: 51233; nada cambia", "E51228|E51201|E51233|" + nAntes + "|PENDIENTE",
                  Reemplazar(r0, " ", ANDRES, "PSO", "PRB 2026-000001") + "|" + Reemplazar(r0, "m", OTRO, "MOD", "PRB 2026-000001") + "|" +
                  Reemplazar(r0, "m", ANDRES, "PSO", "PRB 2026-000002") + "|" + Cuenta("adm.SolicitudCambio") + "|" + Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + r0));
            Check("R2 una validacion de Crear falla (Estado igual al actual): 51219 y TODO o nada (sin fila nueva, original PENDIENTE, sin evento)",
                  "E51219|" + nAntes + "|PENDIENTE|" + r0ev,
                  Reemplazar(r0, "m", ANDRES, "PSO", "PRB 2026-000001", "ESTADO", EnAnalisis) + "|" + Cuenta("adm.SolicitudCambio") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + r0) + "|" + Eventos(r0));
            Exec("UPDATE dbo.Problem SET OwnerProblem = N'Jesus Campa Morones' WHERE Codigo = N'PRB 2026-000001'");
            Check("R3 re-chequeo de PSO de Crear: el folio ya no es suyo -> 51226 y nada cambia", "E51226|" + nAntes + "|PENDIENTE",
                  Reemplazar(r0, "m", ANDRES, "PSO", "PRB 2026-000001") + "|" + Cuenta("adm.SolicitudCambio") + "|" + Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + r0));
            Exec("UPDATE dbo.Problem SET OwnerProblem = N'Andres Vera Rios' WHERE Codigo = N'PRB 2026-000001'");
            var llave = Guid.NewGuid();
            var rr = Reemplazar(r0, "  Me equivoque de estado ", "soriana\\ANDRESVR", "PSO", "PRB 2026-000001", "OTROS", null, llave);
            var r1 = IdDe(rr);
            Check("R4 reemplazo: nueva (id mayor, Repetida 0) PENDIENTE con ReemplazaA; rol PSO del servidor", "True|0|PENDIENTE|NULL|NULL|NULL|" + r0 + "|NULL|PSO",
                  (r1 > r0) + "|" + rr.Split('|')[1] + "|" + Fila(r1) + "|" + Uno("SELECT RolSolicitante FROM adm.SolicitudCambio WHERE IdSolicitud = " + r1));
            Check("R5 original: CANCELADA por quien la envio, motivo, sin revisor", "CANCELADA|soriana\\ANDRESVR|fecha|Me equivoque de estado|NULL|NULL", Fila(r0));
            Check("R6 bitacoras: original intacta + REEMPLAZADA (\"Reemplazada por #N: motivo\"); nueva con su ENVIADA",
                  r0ev + " / REEMPLAZADA:soriana\\ANDRESVR:Reemplazada por #" + r1 + ": Me equivoque de estado|ENVIADA:soriana\\ANDRESVR:Rol PSO",
                  Eventos(r0) + "|" + Eventos(r1));
            var nDespues = Cuenta("adm.SolicitudCambio");
            Check("R7 mismo reemplazo otra vez (misma llave): la misma nueva, Repetida 1, sin filas", r1 + "|1|" + nDespues,
                  Reemplazar(r0, "m", ANDRES, "PSO", "PRB 2026-000001", "OTROS", null, llave) + "|" + Cuenta("adm.SolicitudCambio"));
            var otraLlave = Guid.NewGuid();
            var suelta = IdDe(Cambio(ANDRES, "PSO", "PRB 2026-000001", "OTROS", null, otraLlave));
            Check("R8 llave de otra solicitud: 51232; reemplazar la ya CANCELADA con llave nueva: 51230", "E51232|E51230",
                  Reemplazar(suelta, "m", ANDRES, "PSO", "PRB 2026-000001", "OTROS", null, llave) + "|" + Reemplazar(r0, "m", ANDRES, "PSO", "PRB 2026-000001", "OTROS"));
            Check("R8 reemplazar una aplicada o rechazada: 51230", "E51230|E51230",
                  Reemplazar(c2, "m", MOD, "MOD", "PRB 2026-000001", "OTROS") + "|" + Reemplazar(c3, "m", MOD, "MOD", "PRB 2026-000001", "OTROS"));
            var r2 = IdDe(Reemplazar(r1, "otra vez", ANDRES, "PSO", "PRB 2026-000001", "OTROS"));
            Check("R9 cadena: el reemplazo tambien se reemplaza (r0 <- r1 <- r2)", "CANCELADA|" + r0 + "|PENDIENTE|" + r1,
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + r1) + "|" + Uno("SELECT ReemplazaA FROM adm.SolicitudCambio WHERE IdSolicitud = " + r1) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + r2) + "|" + Uno("SELECT ReemplazaA FROM adm.SolicitudCambio WHERE IdSolicitud = " + r2));
            Check("R10 la nueva sigue el flujo normal: ADM la aplica (Otros, con comentario)", "ok|APLICADA|" + ADM,
                  Aplicar(r2, "atendida") + "|" + Uno("SELECT Estado + '|' + RevisadoPor FROM adm.SolicitudCambio WHERE IdSolicitud = " + r2));
            var r3 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            var r4 = IdDe(Reemplazar(r3, "m", MOD, "MOD", "PRB 2026-000001", "OTROS"));
            Check("R10 ... o la rechaza", "ok|RECHAZADA", Rechazar(r4) + "|" + Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + r4));
            Check("R11 Reemplazar dentro de otra transaccion: 51231", "E51231",
                  Sitio("BEGIN TRAN; DECLARE @c adm.SolicitudCategoriaTipo, @id int, @r bit; " +
                        "EXEC adm.usp_SolicitudCambio_Reemplazar @ReemplazaA = 1, @MotivoCancelacion = N'm', @Usuario = N'x', @Rol = 'MOD', @Llave = @l, @Codigo = N'PRB 2026-000001', " +
                        "@Tipo = 'OTROS', @Motivo = N'm', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT; COMMIT; SELECT 'ok';", "@l", Guid.NewGuid()));
            string ux, ord;
            try { Exec("UPDATE adm.SolicitudCambio SET ReemplazaA = " + r0 + " WHERE IdSolicitud = " + r4); ux = "sin error"; } catch (SqlException ex) { ux = ex.Number.ToString(); }
            try { Exec("UPDATE adm.SolicitudCambio SET ReemplazaA = " + r4 + " WHERE IdSolicitud = " + r3); ord = "sin error"; } catch (SqlException ex) { ord = ex.Number.ToString(); }
            Check("R12 una original se reemplaza una sola vez (indice unico 2601); el reemplazo es posterior (CHECK 547)", "2601|547", ux + "|" + ord);

            // ---------------- K: carreras (mismo candado) ----------------
            var k1 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            Check("K1 ADM rechaza (sin COMMIT) y el solicitante cancela: espera; gana el rechazo, cancelar da 51230", "True|ok|E51230|RECHAZADA",
                  Carrera("EXEC adm.usp_SolicitudCambio_Rechazar @IdSolicitud = " + k1 + ", @Revisor = N'" + ADM + "', @Comentario = N'no'; SELECT 'ok';",
                          "EXEC adm.usp_SolicitudCambio_Cancelar @IdSolicitud = " + k1 + ", @Usuario = N'" + MOD + "', @Motivo = N'm'; SELECT 'ok';") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + k1));
            var k2 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            Check("K2 el solicitante cancela (sin COMMIT) y ADM rechaza: espera; gana cancelar, rechazar da 51202", "True|ok|E51202|CANCELADA",
                  Carrera("EXEC adm.usp_SolicitudCambio_Cancelar @IdSolicitud = " + k2 + ", @Usuario = N'" + MOD + "', @Motivo = N'm'; SELECT 'ok';",
                          "EXEC adm.usp_SolicitudCambio_Rechazar @IdSolicitud = " + k2 + ", @Revisor = N'" + ADM + "', @Comentario = N'no'; SELECT 'ok';") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + k2));
            var k3 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            var nK = Cuenta("adm.SolicitudCambio");
            Check("K3 ADM rechaza (sin COMMIT) y el solicitante reemplaza: espera en el candado de la original; 51230 y SIN fila nueva",
                  "True|ok|E51230|RECHAZADA|" + (int.Parse(nK)),
                  Carrera("EXEC adm.usp_SolicitudCambio_Rechazar @IdSolicitud = " + k3 + ", @Revisor = N'" + ADM + "', @Comentario = N'no'; SELECT 'ok';",
                          "DECLARE @c adm.SolicitudCategoriaTipo, @id int, @r bit; EXEC adm.usp_SolicitudCambio_Reemplazar @ReemplazaA = " + k3 + ", @MotivoCancelacion = N'm', @Usuario = N'" + MOD +
                          "', @Rol = 'MOD', @Llave = '" + Guid.NewGuid() + "', @Codigo = N'PRB 2026-000001', @Tipo = 'OTROS', @Motivo = N'm', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT; SELECT 'ok';") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + k3) + "|" + Cuenta("adm.SolicitudCambio"));
            var k4 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            Check("K4 alguien tiene la fila con UPDLOCK (como Aplicar) y el solicitante cancela: espera y despues cancela", "True|" + k4 + "|ok|CANCELADA",
                  Carrera("SELECT IdSolicitud FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK) WHERE IdSolicitud = " + k4 + ";",
                          "EXEC adm.usp_SolicitudCambio_Cancelar @IdSolicitud = " + k4 + ", @Usuario = N'" + MOD + "', @Motivo = N'm'; SELECT 'ok';") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + k4));

            // ---------------- I: Nuevas solicitudes (sql/42) ----------------
            var i1 = IdDe(Ini(ANDRES));
            var i1ev = IniEventos(i1);
            Check("I1 cancelar: motivo vacio 51419, largo 51420, otra cuenta / inexistente 51411; nada cambia", "E51419|E51420|E51411|E51411|ENVIADA",
                  IniCancelar(i1, ANDRES, " ") + "|" + IniCancelar(i1, ANDRES, new string('x', 2001)) + "|" + IniCancelar(i1, OTRO, "m") + "|" +
                  IniCancelar(9999999, ANDRES, "m") + "|" + Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + i1));
            Check("I2 la suya: CANCELADA con quien, fecha, motivo; evento ENVIADA -> CANCELADA; lo anterior intacto",
                  "ok|CANCELADA|SORIANA\\ANDRESVR|fecha|No va|NULL|T|" + i1ev + " / CANCELADA:ENVIADA>CANCELADA:SORIANA\\ANDRESVR:No va",
                  IniCancelar(i1, "SORIANA\\ANDRESVR", "No va") + "|" + IniFila(i1) + "|" + IniEventos(i1));
            Check("I3 cancelar otra vez 51421; Aprobar / Rechazar / AprobarYCrear de una CANCELADA: 51412", "E51421|E51412|E51412|E51412",
                  IniCancelar(i1, ANDRES, "m") + "|" +
                  Sitio("DECLARE @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Aprobar @NumeroSolicitud = @n, @Revisor = N'x', @Comentario = NULL, @FechaRevisionUtc = @f OUTPUT; SELECT 'ok';", "@n", i1) + "|" +
                  Sitio("DECLARE @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Rechazar @NumeroSolicitud = @n, @Revisor = N'x', @Comentario = N'no', @FechaRevisionUtc = @f OUTPUT; SELECT 'ok';", "@n", i1) + "|" +
                  Sitio(AprobarYCrearSql, "@n", i1));
            var i2 = IdDe(Ini(ANDRES, null, "Original"));
            var contador = Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador");
            var nIni = Cuenta("adm.SolicitudIniciativa");
            Check("I4 reemplazo con un dato que Crear rechaza (correo de PO que no existe): 51406 y todo o nada (contador, filas, original)",
                  "E51406|" + contador + "|" + nIni + "|ENVIADA",
                  IniReemplazar(i2, "m", ANDRES, null, "T2", "nadie@soriana.com") + "|" + Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador") + "|" +
                  Cuenta("adm.SolicitudIniciativa") + "|" + Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + i2));
            Check("I4 otra cuenta 51411; sin motivo 51419", "E51411|E51419", IniReemplazar(i2, "m", OTRO) + "|" + IniReemplazar(i2, "", ANDRES));
            var token = Guid.NewGuid();
            var ir = IniReemplazar(i2, "Cambio el titulo", ANDRES, token, "Corregida");
            var i3 = IdDe(ir);
            Check("I5 reemplazo: numero nuevo (el siguiente del contador), Nuevo 1, ENVIADA con ReemplazaA y los datos nuevos",
                  (int.Parse(contador) + 1) + "|1|ENVIADA|NULL|NULL|NULL|" + i2 + "|Corregida",
                  i3 + "|" + ir.Split('|')[1] + "|" + IniFila(i3));
            Check("I6 original CANCELADA + REEMPLAZADA con el numero de 7 digitos; nueva con su ENVIADA",
                  "CANCELADA|SORIANA\\andresvr|fecha|Cambio el titulo|NULL|Original|REEMPLAZADA:ENVIADA>CANCELADA:SORIANA\\andresvr:Reemplazada por #" + i3.ToString("0000000") + ": Cambio el titulo|ENVIADA:->ENVIADA:SORIANA\\andresvr:",
                  IniFila(i2) + "|" + IniEventos(i2).Split(new[] { " / " }, StringSplitOptions.None).Last() + "|" + IniEventos(i3));
            var deOtro = IdDe(Ini(OTRO));
            var nIni3 = Cuenta("adm.SolicitudIniciativa");
            Check("I7 mismo token otra vez: el mismo numero, Nuevo 0, sin filas", i3 + "|0|" + nIni3,
                  IniReemplazar(i2, "m", ANDRES, token) + "|" + Cuenta("adm.SolicitudIniciativa"));
            Check("I7 otra cuenta: con ese token sobre la original de Andres 51411 (no es suya); sobre la suya 51409 (token ajeno); la suya sigue ENVIADA",
                  "E51411|E51409|ENVIADA",
                  IniReemplazar(i2, "m", OTRO, token) + "|" + IniReemplazar(deOtro, "m", OTRO, token) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + deOtro));
            var tok2 = Guid.NewGuid();
            var i4 = IdDe(Ini(ANDRES, tok2));
            Check("I7 token de otra solicitud de la cuenta: 51423; reemplazar la CANCELADA: 51421", "E51423|E51421",
                  IniReemplazar(i3, "m", ANDRES, tok2) + "|" + IniReemplazar(i2, "m", ANDRES));
            Check("I8 la nueva sigue el flujo normal: ADM la rechaza (sql/31)", "ok|RECHAZADA",
                  Sitio("DECLARE @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Rechazar @NumeroSolicitud = @n, @Revisor = @r, @Comentario = N'no', @FechaRevisionUtc = @f OUTPUT; SELECT 'ok';", "@n", i3, "@r", ADM) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + i3));
            Check("I8 ... y una aprobada no se cancela ni reemplaza (51421)", "ok|E51421|E51421",
                  Sitio("DECLARE @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Aprobar @NumeroSolicitud = @n, @Revisor = @r, @Comentario = NULL, @FechaRevisionUtc = @f OUTPUT; SELECT 'ok';", "@n", i4, "@r", ADM) + "|" +
                  IniCancelar(i4, ANDRES, "m") + "|" + IniReemplazar(i4, "m", ANDRES));
            Check("I9 Reemplazar dentro de otra transaccion: 51422", "E51422",
                  Sitio("BEGIN TRAN; DECLARE @n int, @nv bit, @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Reemplazar @ReemplazaA = 1, @MotivoCancelacion = N'm', " + CamposIni + "; COMMIT; SELECT 'ok';",
                        "@u", ANDRES, "@t", Guid.NewGuid(), "@titulo", "x", "@poc", "jesuscamor@soriana.com", "@sn", NombreDe(ANDRES), "@sc", CorreoDe(ANDRES)));
            var i5 = IdDe(Ini(ANDRES));
            Check("I10 carrera: ADM rechaza (sin COMMIT) y el solicitante cancela: espera; gana el rechazo (51421)", "True|ok|E51421|RECHAZADA",
                  Carrera("DECLARE @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Rechazar @NumeroSolicitud = " + i5 + ", @Revisor = N'" + ADM + "', @Comentario = N'no', @FechaRevisionUtc = @f OUTPUT; SELECT 'ok';",
                          "EXEC adm.usp_SolicitudIniciativa_Cancelar @NumeroSolicitud = " + i5 + ", @Usuario = N'" + ANDRES + "', @Motivo = N'm'; SELECT 'ok';") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + i5));
            var i6 = IdDe(Ini(ANDRES));
            Check("I10 carrera: el solicitante cancela (sin COMMIT) y ADM aprueba: espera; gana cancelar (51412)", "True|ok|E51412|CANCELADA",
                  Carrera("EXEC adm.usp_SolicitudIniciativa_Cancelar @NumeroSolicitud = " + i6 + ", @Usuario = N'" + ANDRES + "', @Motivo = N'm'; SELECT 'ok';",
                          "DECLARE @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Aprobar @NumeroSolicitud = " + i6 + ", @Revisor = N'" + ADM + "', @Comentario = NULL, @FechaRevisionUtc = @f OUTPUT; SELECT 'ok';") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + i6));
            string iux;
            try { Exec("UPDATE adm.SolicitudIniciativa SET ReemplazaA = " + i2 + " WHERE NumeroSolicitud = " + i4); iux = "sin error"; } catch (SqlException ex) { iux = ex.Number.ToString(); }
            Check("I11 una original se reemplaza una sola vez (indice unico)", "2601", iux);

            // ---------------- V: aviso de ADM (sql/39) ----------------
            var pend = Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE Estado = 'PENDIENTE'") + "|" + Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE Estado = 'ENVIADA'");
            var res = new AlmacenVistasSql(ComoSitio).Resumen(ADM);
            Check("V1 el aviso cuenta solo pendientes: las CANCELADA no cuentan (ni como no vistas)",
                  pend + "|" + pend.Replace("|", "+"),
                  res.PendientesCambio + "|" + res.PendientesNuevas + "|" + res.NoVistasCambio + "+" + res.NoVistasNuevas);
            Check("V1 ... y hay canceladas en las dos tablas", "True|True",
                  (int.Parse(Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE Estado = 'CANCELADA'")) > 0) + "|" +
                  (int.Parse(Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE Estado = 'CANCELADA'")) > 0));

            // ---------------- B: rollbacks ----------------
            var foto = Uno("SELECT CONCAT((SELECT COUNT(*) FROM adm.SolicitudCambio), '/', (SELECT COUNT(*) FROM adm.SolicitudCambioEvento), '/', " +
                           "(SELECT COUNT(*) FROM adm.SolicitudIniciativa), '/', (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento))");
            Check("B1 rollback completo con canceladas: se niega (41 y 42) y nada cambia", "True|True|" + foto,
                  Script(M41 + "_rollback").Contains("no caben") + "|" + Script(M42 + "_rollback").Contains("no caben") + "|" +
                  Uno("SELECT CONCAT((SELECT COUNT(*) FROM adm.SolicitudCambio), '/', (SELECT COUNT(*) FROM adm.SolicitudCambioEvento), '/', " +
                      "(SELECT COUNT(*) FROM adm.SolicitudIniciativa), '/', (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento))"));
            Check("B2 rollback de procedimiento: apaga (sin procedimientos) y los datos se quedan", "APLICADO|APLICADO|0|" + foto + "|CANCELADA|" + r0,
                  Script(M41 + "_rollback_procedimiento") + "|" + Script(M42 + "_rollback_procedimiento") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.procedures WHERE name LIKE N'usp_Solicitud%[_]Cancelar' OR name LIKE N'usp_Solicitud%[_]Reemplazar'") + "|" +
                  Uno("SELECT CONCAT((SELECT COUNT(*) FROM adm.SolicitudCambio), '/', (SELECT COUNT(*) FROM adm.SolicitudCambioEvento), '/', " +
                      "(SELECT COUNT(*) FROM adm.SolicitudIniciativa), '/', (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento))") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + r0) + "|" + Uno("SELECT ReemplazaA FROM adm.SolicitudCambio WHERE IdSolicitud = " + r1));
            Check("B2 apagado: el sitio ya no puede cancelar (2812)", "E2812", Cancelar(r3, MOD, "m"));
            Check("B3 volver a correr 41 / 42: REACTIVADA (solo los procedimientos) y funcionan", "REACTIVADA|REACTIVADA|ok",
                  Script(M41) + "|" + Script(M42) + "|" + Cancelar(IdDe(Cambio(MOD, "MOD", "PRB 2026-000001")), MOD, "m"));
            // Rollback completo en una base limpia (sin datos de 41/42).
            Exec("DELETE FROM adm.SolicitudVista; DELETE FROM adm.SolicitudCambioEvento; DELETE FROM adm.SolicitudCambioCategoria; " +
                 "UPDATE adm.SolicitudCambio SET ReemplazaA = NULL; DELETE FROM adm.SolicitudCambio; " +
                 "DELETE FROM adm.SolicitudIniciativaEvento; UPDATE adm.SolicitudIniciativa SET ReemplazaA = NULL; DELETE FROM adm.SolicitudIniciativa;");
            var p1 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            var p2 = IdDe(Ini(ANDRES));
            Check("B4 rollback completo sin datos de 41/42 (con pendientes normales): APLICADO y las filas se quedan", "APLICADO|APLICADO|PENDIENTE|ENVIADA",
                  Script(M41 + "_rollback") + "|" + Script(M42 + "_rollback") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + p1) + "|" + Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + p2));
            Check("B5 forma vieja: sin columnas, CHECK viejos con su texto (41 y 42 vuelven a aplicar)", "NULL|NULL|APLICADA|APLICADA",
                  Uno("SELECT COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA')") + "|" + Uno("SELECT COL_LENGTH(N'adm.SolicitudIniciativa', N'CanceladoPor')") + "|" +
                  Script(M41) + "|" + Script(M42));
            Check("B6 las huellas de los procedimientos de antes no cambiaron (Crear 38, Aplicar 40, Crear 36, AprobarYCrear 32)",
                  "0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F|0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB|0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A|0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC",
                  string.Join("|", new[] { "adm.usp_SolicitudCambio_Crear", "adm.usp_SolicitudCambio_Aplicar", "adm.usp_SolicitudIniciativa_Crear", "adm.usp_SolicitudIniciativa_AprobarYCrear" }
                      .Select(p => Uno("SELECT CONVERT(varchar(66), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'" + p + "')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)"))));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(base37); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar una base: " + ex.Message + ")"); }
        }
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }

    const string AprobarYCrearSql = @"DECLARE @c nvarchar(100), @nv bit, @rp nvarchar(256), @f datetime2(0);
EXEC adm.usp_SolicitudIniciativa_AprobarYCrear @NumeroSolicitud = @n, @Revisor = N'x', @Comentario = NULL, @Prefijo = N'PRB',
     @TipoIniciativa = N'Problem', @TipoAgrupado = N'Problem', @Estado = N'Cerrado',
     @CodigoIniciativa = @c OUTPUT, @Nueva = @nv OUTPUT, @RevisadoPor = @rp OUTPUT, @FechaRevisionUtc = @f OUTPUT;
SELECT 'ok';";
}
