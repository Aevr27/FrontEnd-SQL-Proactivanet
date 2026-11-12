// Prueba de INTEGRACION de la CAPA DE APLICACION de sql/41 y sql/42
// (cancelar / reemplazar por quien la envio) contra una base DESECHABLE de
// SQL Server LocalDB (GestionAdminPrueba_CcrApp<hhmmss>: replica de dbo +
// migraciones reales 18-40 con 38, y luego 41 y 42), con la cuenta del sitio
// como en la VM (PROACTIVANETAD, EXECUTE AS USER). Usa las clases REALES del
// sitio: AlmacenSolicitudesCambioSql, AplicadorSolicitudCambio,
// DeteccionSolicitudesCambio, AlmacenSolicitudesSql, LectorSolicitudesIniciativaSql,
// RevisorSolicitudesIniciativaSql y AlmacenVistasSql. BORRA la base al final.
// Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   D  deteccion: sin 41/42 todo apagado y las lecturas siguen iguales
//      (columnas nuevas en null); con 41/42, encendido.
//   C  cambio: cancelar la suya (historial completo, sin borrar), otra
//      cuenta / motivo / ya no pendiente, ADM (Aplicador / Rechazar) contra
//      una CANCELADA, filtros (CANCELADA, Pendientes, Todas, cola de ADM).
//   R  cambio: reemplazar (nueva con numero nuevo, PENDIENTE, enlaces en
//      los dos sentidos, idempotencia), fallas (otra iniciativa, validacion
//      de Crear) sin tocar la original, enlaces ajenos ocultos en "Mis".
//   I  iniciativa: lo mismo con adm.SolicitudIniciativa (sql/42).
//   K  carreras con dos conexiones: ADM y el solicitante sobre la misma
//      solicitud: gana el primero; el segundo recibe el error esperado.
//   V  el aviso de ADM no cuenta canceladas.
//
// Necesita ../backend_admin_persistencia (vistas de origen). Compilar con
// adm.dll (receta en AccesoAdminHttpSmoke.cs) y correr con cwd = raiz.
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class SolicitudesCancelarReemplazarAppLocalDbSmoke
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


    // ---- solo de esta prueba ----
    static string Num(object v) { return v == null ? "null" : Convert.ToString(v); }
    static string NumIni(object v)
    {
        var d = v as Dictionary<string, object>;
        return d == null ? "null" : Convert.ToString(d["numero"]);
    }
    static string Eventos(Dictionary<string, object> d)
    {
        return string.Join(",", ((List<object>)d["eventos"]).Cast<Dictionary<string, object>>().Select(e => (string)e["evento"]).ToArray());
    }
    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorSolicitudCambio ex) { return "E" + ex.Numero + ":" + ex.EstadoHttp + ":" + ex.Tipo; }
        catch (ErrorSolicitud ex) { return "E" + ex.Numero + ":" + ex.EstadoHttp + ":" + ex.Tipo; }
        catch (ErrorRevisionSolicitudIniciativa ex) { return "E" + ex.Numero + ":" + ex.EstadoHttp + ":" + ex.Tipo; }
    }
    static PeticionSolicitudCambio Peticion(string folio, string tipo, string motivo, Guid llave, string estadoNuevo = null)
    {
        var f = new NameValueCollection();
        f["folio"] = folio; f["llave"] = llave.ToString(); f["tipo"] = tipo; f["motivo"] = motivo;
        if (estadoNuevo != null) f["estado_nuevo"] = estadoNuevo;
        return PeticionSolicitudCambio.DesdeFormulario(f);
    }
    static AltaSolicitud Alta(int reemplazaA, string motivo, Guid token, string titulo, string poCorreo = "jesuscamor@soriana.com")
    {
        return new AltaSolicitud
        {
            Cuenta = ANDRES, Token = token, Tipo = "PRB", Po = "Jesus Campa Morones", So = "SO 1", Categoria = "/A/Cat 1", Director = "Dir 1",
            Titulo = titulo, Descripcion = "D", Observaciones = "O", Volumetria = 100, Pct = 0.0100m, RcaExtension = null,
            SolicitanteNombre = "Andres Vera Rios", SolicitanteCorreo = "andresvr@soriana.com", ProductOwnerCorreo = poCorreo,
            ConFuente = true, ReemplazaA = reemplazaA, MotivoCancelacion = motivo,
        };
    }
    // A (sitio) toma el candado con `primero` sin COMMIT; B corre `segundo`
    // (la capa de aplicacion) en otro hilo. -> si B espero | lo que dio B.
    static string CarreraApp(string primero, Func<string> segundo)
    {
        using (var a = ComoSitio())
        {
            Exec(a, "BEGIN TRAN;");
            using (var c = new SqlCommand(primero, a)) c.ExecuteNonQuery();
            string resB = null;
            var hilo = new Thread(() => { resB = segundo(); });
            hilo.Start();
            var espero = !hilo.Join(1500);
            Exec(a, "IF @@TRANCOUNT > 0 COMMIT;");
            hilo.Join(30000);
            return espero + "|" + resB;
        }
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_CcrApp" + DateTime.Now.ToString("HHmmss");
        try
        {
            Preparar(Base, true);
            var almC = new AlmacenSolicitudesCambioSql(ComoSitio);
            var almI = new AlmacenSolicitudesSql(ComoSitio);
            var cancI = (ICancelacionSolicitudesIniciativa)almI;
            var lect = new LectorSolicitudesIniciativaSql(ComoSitio);
            var revisor = new RevisorSolicitudesIniciativaSql(ComoSitio);

            // ---------------- D: deteccion ----------------
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            using (var cn = ComoSitio()) DeteccionSolicitudesCambio.Revisar(cn);
            Check("D1 sin sql/41 (cuenta del sitio): sql/22 si; cancelar y columnas no", "True|False|False",
                  PersistenciaSolicitudesCambio.Activa() + "|" + PersistenciaSolicitudesCambio.CancelacionActiva() + "|" + PersistenciaSolicitudesCambio.ColumnasCancelacionActivas());
            Check("D2 sin sql/42: cancelar iniciativas no disponible", false, cancI.Disponible());
            var cPre = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001", "OTROS"));
            var dPre = almC.DetalleDe(cPre, MOD);
            Check("D3 sin sql/41 el detalle y la lista se leen igual (enlaces y cancelacion null)", "PENDIENTE|null|null|null|1",
                  dPre["estado"] + "|" + Num(dPre["reemplaza_a"]) + "|" + Num(dPre["reemplazada_por"]) + "|" + Num(dPre["cancelado_por"]) + "|" +
                  almC.ListarDe(MOD, null, 50).Count);
            var iPre = IdDe(Ini(ANDRES));
            var lPre = lect.ListarDe(ANDRES, 50, null);
            Check("D4 sin sql/42 la lista de iniciativas se lee igual (CancelacionDisponible false, enlaces null)", "False|1|null",
                  lPre.CancelacionDisponible + "|" + lPre.Solicitudes.Count + "|" + NumIni(lPre.Solicitudes[0]["reemplaza_a"]));
            Check("D5 sin sql/41 el filtro CANCELADA no falla (lista vacia)", "0|0",
                  almC.ListarDe(MOD, "CANCELADA", 50).Count + "|" + lect.ListarDe(ANDRES, 50, "CANCELADA").Solicitudes.Count);
            Check("D6 se aplican 41 y 42 en la base desechable", "APLICADA|APLICADA", Script(M41) + "|" + Script(M42));
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            using (var cn = ComoSitio()) DeteccionSolicitudesCambio.Revisar(cn);
            Check("D7 con sql/41 (sin VIEW DEFINITION): cancelar y columnas encendidos", "True|True",
                  PersistenciaSolicitudesCambio.CancelacionActiva() + "|" + PersistenciaSolicitudesCambio.ColumnasCancelacionActivas());
            Check("D8 con sql/42: disponible; el detalle lo dice", "True|True", cancI.Disponible() + "|" + lect.DetalleDe(iPre, ANDRES)["cancelacion_disponible"]);

            // ---------------- C: cancelar un cambio ----------------
            var c1 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            Check("C1 motivo vacio 51228 (422), largo 51229 (422), otra cuenta 51201 (404); nada cambia",
                  "E51228:422:FaltaMotivoCancelacion|E51229:422:MotivoCancelacionLargo|E51201:404:SolicitudNoExiste|PENDIENTE",
                  Error(() => almC.Cancelar(c1, MOD, "  ")) + "|" + Error(() => almC.Cancelar(c1, MOD, new string('x', 2001))) + "|" +
                  Error(() => almC.Cancelar(c1, OTRO, "m")) + "|" + almC.Detalle(c1)["estado"]);
            almC.Cancelar(c1, MOD, "  Ya no aplica ");
            var d1 = almC.DetalleDe(c1, MOD);
            Check("C2 la suya: CANCELADA con quien / cuando / por que; historial completo (ENVIADA + CANCELADA); nada se borra",
                  "CANCELADA|" + MOD + "|True|Ya no aplica|ENVIADA,CANCELADA|1",
                  d1["estado"] + "|" + d1["cancelado_por"] + "|" + (d1["fecha_cancelacion_utc"] != null) + "|" + d1["motivo_cancelacion"] + "|" + Eventos(d1) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE IdSolicitud = " + c1));
            Check("C3 otra vez: 51230 (409 SolicitudNoPendiente)", "E51230:409:SolicitudNoPendiente", Error(() => almC.Cancelar(c1, MOD, "m")));
            var apl = new AplicadorSolicitudCambio(almC, delegate { return new ValidacionAplicar { Valida = true }; })
                .Aplicar(c1, ADM, "x", new List<ClasificacionSolicitud>(), DateTime.Today);
            Check("C4 ADM aplica una CANCELADA: 409 SolicitudCancelada, sin intento registrado", "SolicitudCancelada|409|0",
                  apl["tipo"] + "|" + apl["estado_http"] + "|" + Uno("SELECT Intentos FROM adm.SolicitudCambio WHERE IdSolicitud = " + c1));
            string inner = "";
            try { almC.Rechazar(c1, ADM, "no"); } catch (ErrorSolicitudCambio ex) { inner = ex.Numero + "|" + (ex.InnerException is SqlException); }
            Check("C5 ADM rechaza una CANCELADA: 51202 desde la base (el handler relee y dice SolicitudCancelada)", "51202|True", inner);
            Check("C6 filtros: CANCELADA la trae, Pendientes no, Todas si; la cola de ADM tambien la filtra", "True|False|True|True",
                  almC.ListarDe(MOD, "CANCELADA", 50).Any(x => (int)x["id"] == c1) + "|" + almC.ListarDe(MOD, "PENDIENTE", 50).Any(x => (int)x["id"] == c1) + "|" +
                  almC.ListarDe(MOD, null, 50).Any(x => (int)x["id"] == c1) + "|" + almC.Listar("CANCELADA", 50).Any(x => (int)x["id"] == c1));
            var dm = almC.DetalleDe(c1, MOD);
            SolicitudesCambio.MarcarPropia(dm, MOD);
            Check("C7 MarcarPropia: suya pero CANCELADA, no se puede cancelar", "True|False", dm["es_propia"] + "|" + dm["puede_cancelar"]);

            // ---------------- R: reemplazar un cambio ----------------
            var r0 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001", "OTROS"));
            var filas = Uno("SELECT COUNT(*) FROM adm.SolicitudCambio");
            Check("R1 otra iniciativa: 51233 (422); Crear rechaza el dato (Estado = el actual): 51219; otra cuenta 51201; nada cambia",
                  "E51233:422:OtraIniciativa|E51219|E51201:404:SolicitudNoExiste|" + filas + "|PENDIENTE|ENVIADA",
                  Error(() => almC.Reemplazar(r0, "m", Peticion("PRB 2026-000002", "otros", "x", Guid.NewGuid()), MOD, "MOD")) + "|" +
                  Error(() => almC.Reemplazar(r0, "m", Peticion("PRB 2026-000001", "estado", "x", Guid.NewGuid(), EnAnalisis), MOD, "MOD")).Split(':')[0] + "|" +
                  Error(() => almC.Reemplazar(r0, "m", Peticion("PRB 2026-000001", "otros", "x", Guid.NewGuid()), OTRO, "MOD")) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio") + "|" + almC.Detalle(r0)["estado"] + "|" + Eventos(almC.Detalle(r0)));
            var llave = Guid.NewGuid();
            var nueva = almC.Reemplazar(r0, " Me equivoque ", Peticion("PRB 2026-000001", "otros", "Texto corregido", llave), MOD, "MOD");
            var dn = almC.DetalleDe(nueva.IdSolicitud, MOD);
            var dO = almC.DetalleDe(r0, MOD);
            Check("R2 nueva: otro numero (mayor), PENDIENTE (ADM la revisa desde el principio), sin revisor, reemplaza_a = original, el texto nuevo",
                  "True|False|PENDIENTE||" + r0 + "|Texto corregido|ENVIADA",
                  (nueva.IdSolicitud > r0) + "|" + nueva.Repetida + "|" + dn["estado"] + "|" + dn["revisado_por"] + "|" + Num(dn["reemplaza_a"]) + "|" + dn["motivo"] + "|" + Eventos(dn));
            Check("R3 original: CANCELADA (motivo de la cancelacion), reemplazada_por = nueva, historial ENVIADA + REEMPLAZADA, su texto intacto",
                  "CANCELADA|Me equivoque|" + nueva.IdSolicitud + "|ENVIADA,REEMPLAZADA|motivo",
                  dO["estado"] + "|" + dO["motivo_cancelacion"] + "|" + Num(dO["reemplazada_por"]) + "|" + Eventos(dO) + "|" + dO["motivo"]);
            var otraVez = almC.Reemplazar(r0, "m", Peticion("PRB 2026-000001", "otros", "Texto corregido", llave), MOD, "MOD");
            Check("R4 reintento con la misma llave: la misma nueva, Repetida", nueva.IdSolicitud + "|True", otraVez.IdSolicitud + "|" + otraVez.Repetida);
            Check("R5 reemplazar la ya CANCELADA con llave nueva: 51230 (409)", "E51230:409:SolicitudNoPendiente",
                  Error(() => almC.Reemplazar(r0, "m", Peticion("PRB 2026-000001", "otros", "x", Guid.NewGuid()), MOD, "MOD")));
            Check("R6 la cola de ADM ve los dos enlaces", r0 + "|" + nueva.IdSolicitud,
                  Num(almC.Detalle(nueva.IdSolicitud)["reemplaza_a"]) + "|" + Num(almC.Detalle(r0)["reemplazada_por"]));
            Check("R7 otra cuenta no ve ninguna de las dos (404)", "True|True", (almC.DetalleDe(r0, OTRO) == null) + "|" + (almC.DetalleDe(nueva.IdSolicitud, OTRO) == null));
            // Un enlace con una solicitud de OTRA cuenta (no lo hace Reemplazar; se fuerza como dbo):
            // "Mis" no lo enseña, ADM si.
            var mia = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001", "OTROS"));
            var ajena = IdDe(Cambio(OTRO, "MOD", "PRB 2026-000001", "OTROS"));
            Exec("UPDATE adm.SolicitudCambio SET ReemplazaA = " + mia + " WHERE IdSolicitud = " + ajena);
            Check("R8 enlace con una ajena: Mis solicitudes no da su numero; ADM si", "null|" + ajena,
                  Num(almC.DetalleDe(mia, MOD)["reemplazada_por"]) + "|" + Num(almC.Detalle(mia)["reemplazada_por"]));
            Check("R8 ... y la lista tampoco", "null", Num(almC.ListarDe(MOD, null, 200).First(x => (int)x["id"] == mia)["reemplazada_por"]));
            var aplNueva = new AplicadorSolicitudCambio(almC, delegate { return new ValidacionAplicar { Valida = true }; })
                .Aplicar(nueva.IdSolicitud, ADM, "Atendida", new List<ClasificacionSolicitud>(), DateTime.Today);
            Check("R9 la nueva sigue el flujo normal de ADM: se aplica (Otros con comentario)", "True|APLICADA",
                  (aplNueva == null) + "|" + almC.Detalle(nueva.IdSolicitud)["estado"]);

            // ---------------- I: iniciativas (sql/42) ----------------
            var i1 = IdDe(Ini(ANDRES));
            Check("I1 motivo vacio 51419, largo 51420, otra cuenta 51411 (404); nada cambia",
                  "E51419:422:FaltaMotivoCancelacion|E51420:422:MotivoCancelacionLargo|E51411:404:SolicitudNoExiste|ENVIADA",
                  Error(() => cancI.Cancelar(i1, ANDRES, " ")) + "|" + Error(() => cancI.Cancelar(i1, ANDRES, new string('x', 2001))) + "|" +
                  Error(() => cancI.Cancelar(i1, OTRO, "m")) + "|" + lect.Detalle(i1)["estado"]);
            cancI.Cancelar(i1, ANDRES, " No va ");
            var di = lect.DetalleDe(i1, ANDRES);
            Check("I2 la suya: CANCELADA con quien / cuando / por que; historial ENVIADA + CANCELADA",
                  "CANCELADA|" + ANDRES + "|True|No va|ENVIADA,CANCELADA",
                  di["estado"] + "|" + di["cancelado_por"] + "|" + (di["fecha_cancelacion_utc"] != null) + "|" + di["motivo_cancelacion"] + "|" + Eventos(di));
            Check("I3 otra vez 51421 (409); ADM aprueba o rechaza una CANCELADA: 51412", "E51421:409:SolicitudNoPendiente|E51412:409:YaRevisada|E51412:409:YaRevisada",
                  Error(() => cancI.Cancelar(i1, ANDRES, "m")) + "|" + Error(() => revisor.Rechazar(i1, ADM, "no")) + "|" +
                  Error(() => revisor.AprobarYCrear(i1, ADM, null, null)));
            var i2 = IdDe(Ini(ANDRES, null, "Original"));
            var contador = Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador");
            Check("I4 reemplazo que Crear rechaza (correo del PO): 51406 y nada cambia (contador, original)", "51406|" + contador + "|ENVIADA",
                  Error(() => cancI.Reemplazar(Alta(i2, "m", Guid.NewGuid(), "T2", "nadie@soriana.com"))).Split(':')[0].Substring(1) + "|" +
                  Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador") + "|" + lect.Detalle(i2)["estado"]);
            var token = Guid.NewGuid();
            var g = cancI.Reemplazar(Alta(i2, "Cambio el titulo", token, "Corregida"));
            var dni = lect.DetalleDe(g.Numero.Valor, ANDRES);
            var doi = lect.DetalleDe(i2, ANDRES);
            Check("I5 nueva: el siguiente numero del contador, ENVIADA, reemplaza_a = original, titulo nuevo",
                  (int.Parse(contador) + 1) + "|True|ENVIADA|" + i2 + "|Corregida",
                  g.Numero.Valor + "|" + g.Nuevo + "|" + dni["estado"] + "|" + NumIni(dni["reemplaza_a"]) + "|" + dni["titulo"]);
            Check("I6 original: CANCELADA, reemplazada_por = nueva, historial ENVIADA + REEMPLAZADA, titulo intacto",
                  "CANCELADA|" + g.Numero.Valor + "|ENVIADA,REEMPLAZADA|Original|Cambio el titulo",
                  doi["estado"] + "|" + NumIni(doi["reemplazada_por"]) + "|" + Eventos(doi) + "|" + doi["titulo"] + "|" + doi["motivo_cancelacion"]);
            var g2 = cancI.Reemplazar(Alta(i2, "m", token, "Corregida"));
            Check("I7 reintento con el mismo token: el mismo numero, Nuevo false", g.Numero.Valor + "|False", g2.Numero.Valor + "|" + g2.Nuevo);
            Check("I8 filtros: CANCELADA trae las dos; Pendientes ninguna de ellas; Todas si; ADM tambien", "True|False|True|True",
                  lect.ListarDe(ANDRES, 200, "CANCELADA").Solicitudes.Count(x => (int)x["numero"] == i1 || (int)x["numero"] == i2).Equals(2) + "|" +
                  lect.ListarDe(ANDRES, 200, "ENVIADA").Solicitudes.Any(x => (int)x["numero"] == i1 || (int)x["numero"] == i2) + "|" +
                  lect.ListarDe(ANDRES, 200, null).Solicitudes.Any(x => (int)x["numero"] == i2) + "|" +
                  lect.Listar(200, "CANCELADA").Solicitudes.Any(x => (int)x["numero"] == i2));
            Check("I9 otra cuenta no ve ninguna (404)", "True|True", (lect.DetalleDe(i2, OTRO) == null) + "|" + (lect.DetalleDe(g.Numero.Valor, OTRO) == null));
            var miaI = IdDe(Ini(ANDRES));
            var ajenaI = IdDe(Ini(OTRO));
            Exec("UPDATE adm.SolicitudIniciativa SET ReemplazaA = " + miaI + " WHERE NumeroSolicitud = " + ajenaI);
            Check("I10 enlace con una ajena: Mis solicitudes no da su numero; ADM si", "null|" + ajenaI,
                  NumIni(lect.DetalleDe(miaI, ANDRES)["reemplazada_por"]) + "|" + NumIni(lect.Detalle(miaI)["reemplazada_por"]));
            var dMia = lect.DetalleDe(miaI, ANDRES);
            RegistroSolicitudesIniciativa.MarcarPropia(dMia, ANDRES);
            Check("I11 MarcarPropia con la base real: suya, ENVIADA, sql/42 -> puede_cancelar", "True|True", dMia["es_propia"] + "|" + dMia["puede_cancelar"]);

            // ---------------- K: carreras ----------------
            var k1 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            Check("K1 ADM rechaza (sin COMMIT) y el solicitante cancela por la aplicacion: espera y pierde (51230 409)",
                  "True|E51230:409:SolicitudNoPendiente|RECHAZADA",
                  CarreraApp("EXEC adm.usp_SolicitudCambio_Rechazar @IdSolicitud = " + k1 + ", @Revisor = N'" + ADM + "', @Comentario = N'no';",
                             () => Error(() => almC.Cancelar(k1, MOD, "m"))) + "|" + almC.Detalle(k1)["estado"]);
            var k2 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001"));
            Check("K2 el solicitante cancela (sin COMMIT) y ADM rechaza: espera y pierde (51202); queda CANCELADA",
                  "True|E51202:409:SolicitudYaRevisada|CANCELADA",
                  CarreraApp("EXEC adm.usp_SolicitudCambio_Cancelar @IdSolicitud = " + k2 + ", @Usuario = N'" + MOD + "', @Motivo = N'm';",
                             () => Error(() => almC.Rechazar(k2, ADM, "no"))) + "|" + almC.Detalle(k2)["estado"]);
            var k3 = IdDe(Cambio(MOD, "MOD", "PRB 2026-000001", "OTROS"));
            var filasK = Uno("SELECT COUNT(*) FROM adm.SolicitudCambio");
            Check("K3 ADM rechaza (sin COMMIT) y el solicitante reemplaza: espera y pierde (51230), sin fila nueva",
                  "True|E51230:409:SolicitudNoPendiente|" + filasK,
                  CarreraApp("EXEC adm.usp_SolicitudCambio_Rechazar @IdSolicitud = " + k3 + ", @Revisor = N'" + ADM + "', @Comentario = N'no';",
                             () => Error(() => almC.Reemplazar(k3, "m", Peticion("PRB 2026-000001", "otros", "x", Guid.NewGuid()), MOD, "MOD"))) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio"));
            var k4 = IdDe(Ini(ANDRES));
            Check("K4 iniciativa: ADM rechaza (sin COMMIT) y el solicitante cancela: espera y pierde (51421)",
                  "True|E51421:409:SolicitudNoPendiente|RECHAZADA",
                  CarreraApp("DECLARE @f datetime2(0); EXEC adm.usp_SolicitudIniciativa_Rechazar @NumeroSolicitud = " + k4 + ", @Revisor = N'" + ADM + "', @Comentario = N'no', @FechaRevisionUtc = @f OUTPUT;",
                             () => Error(() => cancI.Cancelar(k4, ANDRES, "m"))) + "|" + lect.Detalle(k4)["estado"]);
            var k5 = IdDe(Ini(ANDRES));
            Check("K5 iniciativa: el solicitante cancela (sin COMMIT) y ADM rechaza: espera y pierde (51412); queda CANCELADA",
                  "True|E51412:409:YaRevisada|CANCELADA",
                  CarreraApp("EXEC adm.usp_SolicitudIniciativa_Cancelar @NumeroSolicitud = " + k5 + ", @Usuario = N'" + ANDRES + "', @Motivo = N'm';",
                             () => Error(() => revisor.Rechazar(k5, ADM, "no"))) + "|" + lect.Detalle(k5)["estado"]);

            // ---------------- U: nombre a mostrar (dbo.UsuariosAdmin, sql/35) ----------------
            const string MIG = @"SORIANA\miguel.lopez", MIG2 = @"SORIANA\miguel.lopezm", VACIO = @"SORIANA\t_vacio", NADIE = @"SORIANA\nadie";
            Exec("INSERT dbo.UsuariosAdmin (Usuario, CorreoUsuario, Acceso, NombreSolicitante) VALUES " +
                 "(N'  " + MIG.ToUpperInvariant().Replace("SORIANA", "soriana") + " ', N'miguel@soriana.com', N'MOD', N'Miguel Lopez Ruiz'), " +
                 "(N'" + MIG2 + "', N'miguel.m@soriana.com', N'MOD', N'Miguel Lopez Martinez'), " +
                 "(N'" + VACIO + "', N'vacio@soriana.com', N'MOD', N'   ');");
            var fu = new FuenteFichasUsuariosAdminSql(ComoSitio).Leer(new[] { MIG, MIG2, VACIO, MOD, NADIE }.Select(NombreSolicitante.Clave).ToList());
            Func<string, string> ver = c =>
            {
                FichaUsuarioAdmin f; fu.TryGetValue(NombreSolicitante.Clave(c), out f);
                var v = NombreSolicitante.Elegir(c, f, null, null);
                return v.Fuente + ":" + v.Texto;
            };
            Check("U1 la cuenta del sitio lee UsuariosAdmin por cuenta normalizada: nombre / parecido / vacio -> correo / sin nombre -> correo / sin fila -> cuenta",
                  "NOMBRE_ADMIN:Miguel Lopez Ruiz|NOMBRE_ADMIN:Miguel Lopez Martinez|CORREO:vacio@soriana.com|CORREO:t_mod@soriana.com|CUENTA:" + NADIE,
                  ver(MIG) + "|" + ver(MIG2) + "|" + ver(VACIO) + "|" + ver(MOD) + "|" + ver(NADIE));

            // ---------------- V: aviso de ADM ----------------
            var res = new AlmacenVistasSql(ComoSitio).Resumen(ADM);
            Check("V1 el aviso cuenta solo pendientes (las CANCELADA no cuentan)",
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE Estado = 'PENDIENTE'") + "|" + Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE Estado = 'ENVIADA'"),
                  res.PendientesCambio + "|" + res.PendientesNuevas);
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            try { Borrar(Base); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
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
