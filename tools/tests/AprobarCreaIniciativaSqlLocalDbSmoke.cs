// Prueba de INTEGRACION de sql/32_solicitud_iniciativa_aprobar_crea.sql
// (+ _rollback) con App_Code/RevisionSolicitudesIniciativa.cs
// (RevisorSolicitudesIniciativaSql.AprobarYCrear, AprobacionIniciativa) y el
// registro de lectura, contra bases REALES pero DESECHABLES de SQL Server
// LocalDB: GestionAdminPrueba_A32<n> con la replica, el cargador 174bb51,
// las vistas del backend, sql/18, 20, 21, 22 + permisos, 23, 26, 27 (la VM:
// Crear con el hash de sql/27), 29 y 31, y la cuenta del sitio como en la VM.
// Corre como la cuenta del sitio y BORRA las bases al final. Nunca toca la
// VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: sin aprobar (otra base) se niega; sin sql/31 se niega; con
//      Crear cambiado se niega; aplicada: filas, eventos, contador y los 4
//      procedimientos IGUALES, ninguna con Codigo; volver a aplicar no toca.
//   R  rollback sin ligas: vuelve exacto a sql/31 y se puede volver a aplicar.
//   A  aprobar crea UNA iniciativa con la alta de Crear: el Codigo devuelto
//      es el siguiente del prefijo y anio; cada campo de la solicitud llega a
//      su columna (mapeo de AprobacionIniciativa + PlanificadorGestionAdmin);
//      la solicitud queda APROBADA con su Codigo y el evento; el registro lo
//      lee.
//   D  reintento (con o sin plan, otro revisor): el MISMO Codigo, Nueva =
//      false, nada nuevo en dbo ni en la bitacora.
//   C  concurrencia: 8 aprobaciones a la vez = 1 iniciativa y el mismo Codigo
//      para todas; aprobar y rechazar a la vez: un solo final coherente.
//   F  falla de la alta (categoria no vigente 51015, tope 51010, Estado que
//      no existe 51013, prefijo distinto 51415): el error de Crear sube tal
//      cual, la solicitud sigue ENVIADA sin evento, dbo intacta y el Codigo
//      no se consume.
//   L  una APROBADA de sql/31 (sin Codigo, como la #0000002): 51414 y nada
//      cambia; no se reprocesa.
//   X  51411 / 51412 / 51410.
//   J  rechazar sigue igual (sin Codigo); rechazar una aprobada: 51412.
//   P  cuenta del sitio: ejecuta _AprobarYCrear, sigue VIENDO _Aprobar y
//      _Rechazar (la deteccion de sql/31 no se apaga), no escribe las tablas
//      a mano; ningun permiso nuevo.
//   K  CHECK / indice: Codigo en una ENVIADA o vacio (547), repetido (2601).
//   M  Crear a mano sigue igual y su Codigo sigue la serie.
//   B  rollback con ligas: se niega y no toca nada.
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

public static class AprobarCreaIniciativaSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Crear27 = "0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD";
    const string ADM = @"SORIANA\t_adm";
    static readonly DateTime Hoy = new DateTime(2026, 10, 21);
    static readonly string EnAnalisis = "En An" + (char)0xE1 + "lisis";
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
    static string Script(string db, string sql) { using (var cn = Abrir(db)) return LotesError(cn, sql); }
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorRevisionSolicitudIniciativa ex) { return ex.Numero.ToString(); }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }
    static string ComoSitioError(string sql)
    {
        try { using (var cn = ComoSitio()) Exec(cn, sql); return "sin error"; }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }
    static string DboError(string sql)
    {
        try { Exec(sql); return "sin error"; }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    static RevisorSolicitudesIniciativaSql Revisor() { return new RevisorSolicitudesIniciativaSql(ComoSitio); }
    static LectorSolicitudesIniciativaSql Lector() { return new LectorSolicitudesIniciativaSql(ComoSitio); }

    static int Solicitud(string titulo, string categoria, decimal pct, int volumetria)
    {
        var g = new AlmacenSolicitudesSql(ComoSitio).Crear(new AltaSolicitud
        {
            Cuenta = @"SORIANA\andresvr", Token = Guid.NewGuid(), Tipo = "PRB", Po = "Jesus Campa Morones", So = "SO 1",
            Categoria = categoria, Director = "Dir 1", Titulo = titulo, Descripcion = "Desc " + titulo, Observaciones = "Obs " + titulo,
            Volumetria = volumetria, Pct = pct, RcaExtension = "PDF",
            SolicitanteNombre = "Andres Vera Rios", SolicitanteCorreo = "andresvr@soriana.com", ProductOwnerCorreo = "jesuscamor@soriana.com",
        });
        return g.Numero.Valor;
    }

    // Lo que hace el handler con una ENVIADA: la solicitud GUARDADA ->
    // peticion de Crear -> plan (la validacion de catalogo se prueba en el
    // smoke HTTP; aqui un resultado valido).
    static PlanCrearAdmin Plan(int numero, string estado)
    {
        var d = Lector().Detalle(numero);
        var p = AprobacionIniciativa.Peticion(d, estado);
        return PlanificadorGestionAdmin.Crear(p, new ResultadoGestionAdmin { Accion = "crear", CatalogoRevisado = true }, Hoy);
    }

    const string HashDe =
        "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'{0}', N'P')), " +
        "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)";
    static string Hashes()
    {
        return string.Join("|", new[] { "adm.usp_GestionAdmin_Crear", "adm.usp_SolicitudIniciativa_Crear", "adm.usp_SolicitudIniciativa_Aprobar",
                                        "adm.usp_SolicitudIniciativa_Rechazar" }.Select(p => Uno(string.Format(HashDe, p))));
    }
    const string HuellaSolicitudes =
        "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', ISNULL(STRING_AGG(CONVERT(nvarchar(max), CONCAT_WS(N'|', NumeroSolicitud, Token, Estado, TipoIniciativa, " +
        "ProductOwner, ServiceOwner, Categoria, Titulo, Volumetria, PctDisminucion, RevisadoPor, CONVERT(varchar(30), FechaRevisionUtc, 126), ComentarioRevision)), N'#') " +
        "WITHIN GROUP (ORDER BY NumeroSolicitud), N'')), 1) FROM adm.SolicitudIniciativa";
    const string HuellaEventos =
        "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', ISNULL(STRING_AGG(CONVERT(nvarchar(max), CONCAT_WS(N'|', IdEvento, NumeroSolicitud, Evento, EstadoAnterior, " +
        "EstadoNuevo, Usuario, Detalle)), N'#') WITHIN GROUP (ORDER BY IdEvento), N'')), 1) FROM adm.SolicitudIniciativaEvento";
    const string HuellaPermisos =
        "SELECT ISNULL(STRING_AGG(CONVERT(nvarchar(max), CONCAT_WS(N':', p.state_desc, p.permission_name, p.class_desc, " +
        "CASE p.class WHEN 1 THEN OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id) WHEN 3 THEN SCHEMA_NAME(p.major_id) ELSE N'' END)), N', ') " +
        "WITHIN GROUP (ORDER BY p.class, p.major_id, p.permission_name), N'') " +
        "FROM sys.database_permissions AS p WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')";
    const string HuellaDbo =
        "SELECT CONCAT_WS(N'|', (SELECT COUNT(*) FROM dbo.Problem), (SELECT CHECKSUM_AGG(CHECKSUM(*)) FROM dbo.Problem), " +
        "(SELECT COUNT(*) FROM dbo.ProblemCategoria), (SELECT CHECKSUM_AGG(CHECKSUM(*)) FROM dbo.ProblemCategoria), " +
        "(SELECT COUNT(*) FROM adm.IniciativaProtegida), (SELECT COUNT(*) FROM dbo.ProblemFechaEvento), (SELECT COUNT(*) FROM dbo.ProblemEstadoEvento))";
    static string Foto()
    {
        return string.Join(" ~ ", new[] { Uno(HuellaSolicitudes), Uno(HuellaEventos), Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"), Hashes() });
    }
    static string Piezas32()
    {
        return Uno("SELECT (CASE WHEN COL_LENGTH('adm.SolicitudIniciativa','CodigoIniciativa') IS NULL THEN 0 ELSE 1 END) " +
                   "+ (CASE WHEN OBJECT_ID('adm.CK_SolicitudIniciativa_Codigo','C') IS NULL THEN 0 ELSE 1 END) " +
                   "+ (CASE WHEN INDEXPROPERTY(OBJECT_ID('adm.SolicitudIniciativa'), 'UX_SolicitudIniciativa_CodigoIniciativa', 'IndexID') IS NULL THEN 0 ELSE 1 END) " +
                   "+ (CASE WHEN OBJECT_ID('adm.usp_SolicitudIniciativa_AprobarYCrear','P') IS NULL THEN 0 ELSE 1 END)");
    }
    static string DenyAprobar()
    {
        return Uno("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') " +
                   "AND state = 'D' AND permission_name = N'EXECUTE' AND major_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar')");
    }
    // Columnas de la solicitud separadas por '|' (NULL = vacio).
    static string Sol(int n, params string[] columnas)
    {
        return Uno("SELECT CONCAT(" + string.Join(", '|', ", columnas.Select(c => "ISNULL(CONVERT(nvarchar(max), " + c + "), N'')").ToArray()) +
                   ", N'') FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n);
    }
    static string Eventos(int n) { return Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n); }

    static void Preparar(string db, bool con31)
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
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia.sql"));
            Lotes(cn, Leer("sql", "20_gestion_admin_duenos.sql"));
            Lotes(cn, Leer("sql", "21_gestion_admin_agrupacion_acentos.sql"));
            Lotes(cn, Leer("sql", "22_solicitudes_cambio.sql"));
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            Lotes(cn, Leer("sql", "22_solicitudes_cambio_permisos.sql"));
            Lotes(cn, Leer("sql", "23_cambios_recientes.sql"));
            Lotes(cn, Leer("sql", "26_gestion_admin_crear_volumetria.sql"));
            Lotes(cn, Leer("sql", "27_gestion_admin_crear_subestado.sql"));
            Lotes(cn, Leer("sql", "29_solicitud_iniciativa.sql"));
            if (con31) Lotes(cn, Leer("sql", "31_solicitud_iniciativa_revision.sql"));
            Exec(cn, @"
DELETE FROM dbo.CatPersona;
INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES
 (N'Andres Vera Rios', N'andresvr@soriana.com', 1), (N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1);
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1), (N'ADO', N'Adopcion', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES
 (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1), (N'c3', N'/A/Cat 3', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado) VALUES
 (N'PRB 2026-000001', N'Problem', N'Semilla viva', N'" + EnAnalisis + @"', NULL),
 (N'PRB 2026-000005', N'Problem', N'Semilla cerrada', N'Cerrado', NULL);
-- /A/Cat 2 ya tiene 95% comprometido por una iniciativa viva: el tope.
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/A/Cat 2', N'Problem', N'Problem', 0.9500, 1);");
        }
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        var t = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        Base = "GestionAdminPrueba_A32" + t;
        var guarda = "A32Guarda_" + t;
        var sql31 = Leer("sql", "31_solicitud_iniciativa_revision.sql");
        var sql32 = Leer("sql", "32_solicitud_iniciativa_aprobar_crea.sql");
        var rb32 = Leer("sql", "32_solicitud_iniciativa_aprobar_crea_rollback.sql");
        try
        {
            Preparar(Base, false);

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                  Script(guarda, sql32).Contains("SIN APROBAR") + "|" + Script(guarda, rb32).Contains("SIN APROBAR"));
            Borrar(guarda);
            Check("G2 sin sql/31: se niega y no crea nada", "True|0", Script(Base, sql32).Contains("falta sql/31") + "|" + Piezas32());
            using (var cn = Abrir(Base)) Lotes(cn, sql31);
            Check("G3 la base de prueba tiene Crear de sql/27 (el de la VM)", Crear27, Uno(string.Format(HashDe, "adm.usp_GestionAdmin_Crear")));
            Check("G3b rollback antes de aplicar 32: se niega", true, Script(Base, rb32).Contains("no esta aplicada"));

            // Crear cambiado a mano: 32 no se aplica encima; se restaura.
            var defCrear = Uno("SELECT OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear'))");
            var alter = Regex.Replace(defCrear, @"^\s*(CREATE|ALTER)\s+PROC(EDURE)?", "ALTER PROCEDURE", RegexOptions.IgnoreCase);
            using (var cn = Abrir(Base))
            using (var c = new SqlCommand("EXEC (@d)", cn)) { c.Parameters.AddWithValue("@d", alter + " -- a mano"); c.ExecuteNonQuery(); }
            Check("G4 Crear distinto al de sql/27: se niega sin tocar nada", "True|0", Script(Base, sql32).Contains("no es la de sql/27") + "|" + Piezas32());
            using (var cn = Abrir(Base))
            using (var c = new SqlCommand("EXEC (@d)", cn)) { c.Parameters.AddWithValue("@d", alter); c.ExecuteNonQuery(); }
            Check("G4b Crear restaurado (hash de sql/27)", Crear27, Uno(string.Format(HashDe, "adm.usp_GestionAdmin_Crear")));

            // Datos de antes de 32: una ENVIADA y una APROBADA con sql/31 (como la #0000002).
            var legado = Solicitud("Legado", "/A/Cat 1", 1.0000m, 2);
            Revisor().Aprobar(legado, @"SORIANA\edgarrad", null);
            var e1 = Solicitud("Uno", "/A/Cat 1", 0.2000m, 120);
            var antes = Foto();
            var permisosAntes = Uno(HuellaPermisos);
            var dboAntes = Uno(HuellaDbo);

            var r = Script(Base, sql32);
            Check("G5 sql/32 se aplica", "sin error|4", r + "|" + Piezas32());
            Check("G6 filas, revisiones, eventos, contador y los 4 procedimientos IGUALES; dbo intacta", antes + "|" + dboAntes, Foto() + "|" + Uno(HuellaDbo));
            Check("G7 ninguna con Codigo (la APROBADA de 31 sigue sin iniciativa); sin permisos nuevos sobre _Aprobar", "0|APROBADA||0|" + permisosAntes,
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE CodigoIniciativa IS NOT NULL") + "|" + Sol(legado, "Estado", "CodigoIniciativa") + "|" + DenyAprobar() + "|" + Uno(HuellaPermisos));
            var hProc = Uno(string.Format(HashDe, "adm.usp_SolicitudIniciativa_AprobarYCrear"));
            Console.WriteLine("      (hash de _AprobarYCrear: " + hProc + ")");
            Check("G8 volver a aplicar: 'ya aplicada', no toca nada", "True|" + antes, Script(Base, sql32).Contains("ya aplicada") + "|" + Foto());
            Check("G9 el rollback pide exactamente este procedimiento (hash fijado)", true, rb32.Contains(hProc));

            // ---------------- R: rollback sin ligas ----------------
            r = Script(Base, rb32);
            Check("R1 rollback sin ligas: deshace", "sin error|0|0", r + "|" + Piezas32() + "|" + DenyAprobar());
            Check("R2 vuelve a sql/31 exacta y sin perder nada", antes + "|" + permisosAntes, Foto() + "|" + Uno(HuellaPermisos));
            Check("R3 aplicar otra vez", "sin error|4|0", Script(Base, sql32) + "|" + Piezas32() + "|" + DenyAprobar());

            // ---------------- A: aprobar crea la iniciativa ----------------
            var planA = Plan(e1, EnAnalisis);
            Check("A0 el plan sale de la solicitud guardada", "PRB|Problem|Problem|" + EnAnalisis + "|/A/Cat 1|0.2|120|2026-10-21",
                  planA.Prefijo + "|" + planA.TipoIniciativa + "|" + planA.TipoAgrupado + "|" + planA.Estado + "|" + planA.Categorias.Single().Ruta + "|" +
                  planA.Categorias.Single().Pct.Value.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + "|" + planA.Volumetria + "|" +
                  planA.FechaCreacion.ToString("yyyy-MM-dd"));
            var problemAntes = int.Parse(Uno("SELECT COUNT(*) FROM dbo.Problem"));
            var a = Revisor().AprobarYCrear(e1, ADM, "  Va  ", planA);
            Check("A1 el Codigo devuelto es el siguiente de PRB 2026 (semillas hasta 000005), nuevo", "PRB 2026-000006|True|" + ADM,
                  a.Codigo + "|" + a.Nueva + "|" + a.RevisadoPor);
            Check("A2 UNA iniciativa nueva", problemAntes + 1, int.Parse(Uno("SELECT COUNT(*) FROM dbo.Problem")));
            Check("A3 dbo.Problem: cada campo de la solicitud en su columna; fechas de Crear; sin Subestado",
                  "Problem|Uno|Desc Uno|Obs Uno|" + EnAnalisis + "|NULL|Jesus Campa Morones|SO 1|120|2026-10-21|2026-11-05|2026-10-21|1",
                  Uno("SELECT CONCAT_WS('|', TipoIniciativa, Titulo, Descripcion, Observaciones, Estado, ISNULL(Subestado, 'NULL'), OwnerProblem, OwnerServicio, " +
                      "VolumetriaOriginal, CONVERT(char(10), FechaCreacion, 23), CONVERT(char(10), FechaAnalisis, 23), CONVERT(char(10), FechaEntregaAnalisis, 23), VigenteEnOrigen) " +
                      "FROM dbo.Problem WHERE Codigo = N'" + a.Codigo + "'"));
            Check("A4 dbo.ProblemCategoria: la categoria con su % (fraccion) y los tipos", "1|/A/Cat 1|0.2000|Problem|Problem|1",
                  Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + a.Codigo + "'") + "|" +
                  Uno("SELECT CONCAT_WS('|', Categoria, PctDisminucion, TipoIniciativa, TipoAgrupado, VigenteEnOrigen) FROM dbo.ProblemCategoria WHERE Codigo = N'" + a.Codigo + "'"));
            Check("A5 protegida como ALTA firmada por el revisor", "ALTA|" + ADM,
                  Uno("SELECT CONCAT_WS('|', Motivo, Usuario) FROM adm.IniciativaProtegida WHERE Codigo = N'" + a.Codigo + "'"));
            Check("A6 la solicitud: APROBADA, revisor, comentario recortado, Codigo, fecha devuelta", "APROBADA|" + ADM + "|Va|" + a.Codigo + "|" + a.FechaRevisionUtc.ToString("yyyy-MM-ddTHH:mm:ss"),
                  Sol(e1, "Estado", "RevisadoPor", "ComentarioRevision", "CodigoIniciativa", "CONVERT(varchar(19), FechaRevisionUtc, 126)"));
            Check("A7 evento APROBADA con la misma fecha y el comentario", "2|APROBADA|ENVIADA|APROBADA|" + ADM + "|Va|1",
                  Eventos(e1) + "|" + Uno("SELECT TOP 1 CONCAT_WS('|', Evento, EstadoAnterior, EstadoNuevo, Usuario, Detalle) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + e1 + " ORDER BY IdEvento DESC") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento AS e JOIN adm.SolicitudIniciativa AS s ON s.NumeroSolicitud = e.NumeroSolicitud " +
                      "WHERE e.NumeroSolicitud = " + e1 + " AND e.Evento = 'APROBADA' AND e.FechaUtc = s.FechaRevisionUtc"));
            var dA = Lector().Detalle(e1);
            var lA = Lector().Listar(200);
            Check("A8 el registro lee el Codigo y crea_iniciativa", "True|" + a.Codigo + "|True|" + a.Codigo + "|NULL",
                  dA["crea_iniciativa"] + "|" + dA["codigo_iniciativa"] + "|" + lA.CreaIniciativa + "|" +
                  lA.Solicitudes.Single(s => (int)s["numero"] == e1)["codigo_iniciativa"] + "|" +
                  (lA.Solicitudes.Single(s => (int)s["numero"] == legado)["codigo_iniciativa"] ?? "NULL"));

            // ---------------- D: reintento ----------------
            var dbo1 = Uno(HuellaDbo);
            var ev1 = Uno(HuellaEventos);
            var d1 = Revisor().AprobarYCrear(e1, ADM, null, Plan(e1, "Cerrado"));
            var d2 = Revisor().AprobarYCrear(e1, @"SORIANA\otro_adm", "otra vez", null);
            Check("D1 reintento (con plan distinto / sin plan / otro ADM): el MISMO Codigo, Nueva=false, el revisor y la fecha originales",
                  a.Codigo + "|False|" + ADM + "|" + a.FechaRevisionUtc.ToString("s") + "|" + a.Codigo + "|False|" + ADM,
                  d1.Codigo + "|" + d1.Nueva + "|" + d1.RevisadoPor + "|" + d1.FechaRevisionUtc.ToString("s") + "|" + d2.Codigo + "|" + d2.Nueva + "|" + d2.RevisadoPor);
            Check("D2 ... sin nada nuevo en dbo ni en la bitacora; el Estado de la iniciativa no cambio", dbo1 + "|" + ev1 + "|" + EnAnalisis,
                  Uno(HuellaDbo) + "|" + Uno(HuellaEventos) + "|" + Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'" + a.Codigo + "'"));

            // ---------------- C: concurrencia ----------------
            var c1 = Solicitud("Concurrente", "/A/Cat 1", 0.0500m, 7);
            var planC = Plan(c1, "Cerrado");
            var problemC = int.Parse(Uno("SELECT COUNT(*) FROM dbo.Problem"));
            var res = new string[8];
            var barrera = new Barrier(8);
            var hilos = Enumerable.Range(0, 8).Select(i => new Thread(() =>
            {
                barrera.SignalAndWait();
                try { var x = Revisor().AprobarYCrear(c1, @"SORIANA\t_adm" + i, null, planC); res[i] = x.Codigo + "/" + x.Nueva; }
                catch (Exception ex) { res[i] = "ERR " + ex.GetType().Name + " " + ex.Message; }
            })).ToList();
            hilos.ForEach(h => h.Start());
            hilos.ForEach(h => h.Join());
            var codC = Sol(c1, "CodigoIniciativa");
            Check("C1 8 aprobaciones a la vez: 1 crea, 7 reciben el MISMO Codigo; ningun error", "1|7|0|1",
                  res.Count(x => x == codC + "/True") + "|" + res.Count(x => x == codC + "/False") + "|" + res.Count(x => x.StartsWith("ERR")) + "|" +
                  res.Select(x => x.Split('/')[0]).Distinct().Count());
            Check("C2 una sola iniciativa, un solo evento de aprobacion", (problemC + 1) + "|2|1",
                  Uno("SELECT COUNT(*) FROM dbo.Problem") + "|" + Eventos(c1) + "|" + Uno("SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'" + codC + "'"));

            var c2 = Solicitud("Aprobar o rechazar", "/A/Cat 1", 0.0100m, 1);
            var planC2 = Plan(c2, "Cerrado");
            var problemC2 = int.Parse(Uno("SELECT COUNT(*) FROM dbo.Problem"));
            var res2 = new string[8];
            barrera = new Barrier(8);
            hilos = Enumerable.Range(0, 8).Select(i => new Thread(() =>
            {
                barrera.SignalAndWait();
                res2[i] = (i % 2 == 0 ? "A:" : "R:") + Error(() =>
                {
                    if (i % 2 == 0) Revisor().AprobarYCrear(c2, @"SORIANA\t_adm" + i, null, planC2);
                    else Revisor().Rechazar(c2, @"SORIANA\t_adm" + i, "motivo " + i);
                });
            })).ToList();
            hilos.ForEach(h => h.Start());
            hilos.ForEach(h => h.Join());
            var finC2 = Sol(c2, "Estado");
            var coherente = finC2 == "APROBADA"
                ? res2.Count(x => x == "A:sin error") == 4 && res2.Count(x => x == "R:51412") == 4 && int.Parse(Uno("SELECT COUNT(*) FROM dbo.Problem")) == problemC2 + 1 && Sol(c2, "CodigoIniciativa") != ""
                : finC2 == "RECHAZADA" && res2.Count(x => x == "R:sin error") == 1 && res2.Count(x => x == "R:51412") == 3 && res2.Count(x => x == "A:51412") == 4
                  && int.Parse(Uno("SELECT COUNT(*) FROM dbo.Problem")) == problemC2 && Sol(c2, "CodigoIniciativa") == "";
            Check("C3 aprobar y rechazar a la vez: un final coherente (" + finC2 + ": " + string.Join(",", res2) + ")", "True|2", coherente + "|" + Eventos(c2));

            // ---------------- F: la alta falla -> nada queda ----------------
            Func<int, string> Intacta = n => Sol(n, "Estado", "RevisadoPor", "FechaRevisionUtc", "ComentarioRevision", "CodigoIniciativa") + "#" + Eventos(n) + "#" + Uno(HuellaDbo);
            var f1 = Solicitud("Cat 3 deja de estar vigente", "/A/Cat 3", 0.1000m, 3);
            var planF1 = Plan(f1, "Cerrado");
            Exec("UPDATE dbo.Categorias SET VigenteEnOrigen = 0 WHERE RutaCompleta = N'/A/Cat 3'");
            var antesF1 = Intacta(f1);
            Check("F1 categoria ya no vigente: sube el 51015 de Crear (no un 266 ni otro)", "51015", Error(() => Revisor().AprobarYCrear(f1, ADM, "x", planF1)));
            Check("F1b ... la solicitud sigue ENVIADA, sin revisor, Codigo ni evento; dbo y proteccion intactas", antesF1, Intacta(f1));
            Check("F1c ... sigue ENVIADA en texto claro", "ENVIADA|1", Sol(f1, "Estado") + "|" + Eventos(f1));
            Exec("UPDATE dbo.Categorias SET VigenteEnOrigen = 1 WHERE RutaCompleta = N'/A/Cat 3'");

            var f2 = Solicitud("Tope", "/A/Cat 2", 0.2000m, 4);
            var antesF2 = Intacta(f2);
            Check("F2 tope de 100% (viva, 95% ya comprometido): 51010 y nada queda", "51010|" + antesF2,
                  Error(() => Revisor().AprobarYCrear(f2, ADM, null, Plan(f2, EnAnalisis))) + "|" + Intacta(f2));
            Check("F3 Estado que no existe: 51013 y nada queda", "51013|" + antesF2,
                  Error(() => Revisor().AprobarYCrear(f2, ADM, null, Plan(f2, "Inventado"))) + "|" + Intacta(f2));
            var planOtro = Plan(f2, "Cerrado");
            planOtro.Prefijo = "ADO";
            Check("F4 prefijo distinto al de la solicitud guardada: 51415 y nada queda", "51415|" + antesF2,
                  Error(() => Revisor().AprobarYCrear(f2, ADM, null, planOtro)) + "|" + Intacta(f2));
            Check("F5 sin plan una ENVIADA no se crea (51415)", "51415|" + antesF2,
                  Error(() => Revisor().AprobarYCrear(f2, ADM, null, null)) + "|" + Intacta(f2));
            // Sin estado (NULL = Incompleta, la regla de Crear): no consume, no hay tope.
            var f2b = Revisor().AprobarYCrear(f2, ADM, null, Plan(f2, ""));
            Check("F6 despues de fallar, la misma solicitud se aprueba (sin estado: NULL, sin tope) y el Codigo NO se consumio en las fallas",
                  "True|NULL", (f2b.Codigo == "PRB 2026-" + (int.Parse(codC.Substring(9)) + (finC2 == "APROBADA" ? 2 : 1)).ToString("000000")) + "|" +
                  Uno("SELECT ISNULL(Estado, 'NULL') FROM dbo.Problem WHERE Codigo = N'" + f2b.Codigo + "'"));

            // ---------------- L: aprobada con sql/31, sin iniciativa ----------------
            var antesL = Intacta(legado);
            Check("L1 APROBADA de sql/31 sin Codigo: 51414, no se crea nada (ni con plan)", "51414|51414|" + antesL,
                  Error(() => Revisor().AprobarYCrear(legado, ADM, null, null)) + "|" +
                  Error(() => Revisor().AprobarYCrear(legado, ADM, null, planOtro)) + "|" + Intacta(legado));

            // ---------------- X ----------------
            Check("X1 no existe 51411; sin revisor 51410", "51411|51410|51410",
                  Error(() => Revisor().AprobarYCrear(9999, ADM, null, null)) + "|" + Error(() => Revisor().AprobarYCrear(e1, null, null, null)) + "|" +
                  Error(() => Revisor().AprobarYCrear(e1, "   ", null, null)));

            // ---------------- J: rechazar ----------------
            var j1 = Solicitud("Rechazo", "/A/Cat 1", 0.0100m, 1);
            var dboJ = Uno(HuellaDbo);
            Revisor().Rechazar(j1, ADM, "No procede");
            Check("J1 rechazar sigue igual: RECHAZADA con motivo, sin Codigo, dbo intacta", "RECHAZADA|No procede||" + dboJ,
                  Sol(j1, "Estado", "ComentarioRevision", "CodigoIniciativa") + "|" + Uno(HuellaDbo));
            Check("J2 aprobar una RECHAZADA: 51412; rechazar una aprobada: 51412", "51412|51412",
                  Error(() => Revisor().AprobarYCrear(j1, ADM, null, Plan(j1, "Cerrado"))) + "|" + Error(() => Revisor().Rechazar(e1, ADM, "x")));

            // ---------------- P: permisos ----------------
            var p1 = Solicitud("Permisos", "/A/Cat 1", 0.0100m, 1);
            Check("P1 la cuenta del sitio sigue detectando sql/31 (Disponible) y sql/32 (CreaIniciativa)", "True|True",
                  Revisor().Disponible() + "|" + Revisor().CreaIniciativa());
            using (var cn = ComoSitio())
            using (var c = new SqlCommand("SELECT CONCAT_WS('|', HAS_PERMS_BY_NAME('adm.usp_SolicitudIniciativa_AprobarYCrear', 'OBJECT', 'EXECUTE'), " +
                                          "HAS_PERMS_BY_NAME('adm.usp_SolicitudIniciativa_Aprobar', 'OBJECT', 'EXECUTE'), " +
                                          "HAS_PERMS_BY_NAME('adm.usp_SolicitudIniciativa_Rechazar', 'OBJECT', 'EXECUTE'), " +
                                          "HAS_PERMS_BY_NAME('adm.SolicitudIniciativa', 'OBJECT', 'UPDATE'), HAS_PERMS_BY_NAME('adm.IniciativaProtegida', 'OBJECT', 'INSERT'))", cn))
                Check("P2 como la cuenta del sitio: EXECUTE en _AprobarYCrear, _Aprobar y _Rechazar; sin UPDATE / INSERT a mano", "1|1|1|0|0", c.ExecuteScalar());
            Check("P3 a mano no liga un Codigo (229)", "229", ComoSitioError("UPDATE adm.SolicitudIniciativa SET CodigoIniciativa = N'PRB 2026-999999' WHERE NumeroSolicitud = " + p1));
            Check("P4 ningun permiso nuevo para PROACTIVANETAD", permisosAntes, Uno(HuellaPermisos));

            // ---------------- K: CHECK e indice ----------------
            Check("K1 a mano (dbo): Codigo en una ENVIADA o vacio (547); el mismo Codigo en otra solicitud (2601)", "547|547|2601",
                  DboError("UPDATE adm.SolicitudIniciativa SET CodigoIniciativa = N'PRB 2026-777777' WHERE NumeroSolicitud = " + p1) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET CodigoIniciativa = N'  ' WHERE NumeroSolicitud = " + legado) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET CodigoIniciativa = N'" + a.Codigo + "' WHERE NumeroSolicitud = " + legado));
            Check("K2 nada cambio", "ENVIADA||APROBADA|", Sol(p1, "Estado", "CodigoIniciativa") + "|" + Sol(legado, "Estado", "CodigoIniciativa"));

            // ---------------- M: Crear a mano sigue igual ----------------
            var ultimo = Uno("SELECT MAX(Codigo) FROM dbo.Problem WHERE Codigo LIKE N'PRB 2026-%'");
            var manual = new PlanCrearAdmin
            {
                Prefijo = "PRB", TipoIniciativa = "Problem", TipoAgrupado = "Problem", Estado = "Cerrado", Titulo = "A mano",
                FechaCreacion = Hoy, FechaAnalisis = Hoy.AddDays(15), FechaEntregaAnalisis = Hoy,
            };
            manual.Categorias.Add(new CategoriaPlan { Ruta = "/A/Cat 1", Pct = 0.01m, TipoIniciativa = "Problem", TipoAgrupado = "Problem" });
            string codM;
            using (var cn = ComoSitio()) codM = new EscritorGestionAdminSql().Crear(cn, null, manual, ADM);
            Check("M1 Crear a mano (cuenta del sitio) sigue funcionando y su Codigo sigue la serie", "PRB 2026-" + (int.Parse(ultimo.Substring(9)) + 1).ToString("000000"), codM);
            Check("M2 sin Codigos repetidos ni solicitudes ligadas a la de a mano", "0|0",
                  Uno("SELECT COUNT(*) FROM (SELECT Codigo FROM dbo.Problem GROUP BY Codigo HAVING COUNT(*) > 1) AS x") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE CodigoIniciativa = N'" + codM + "'"));
            Check("M3 los 4 procedimientos de antes siguen con su hash", antes.Split(new[] { " ~ " }, StringSplitOptions.None)[3], Hashes());

            // ---------------- B: rollback con ligas ----------------
            var fotoB = Foto() + Uno("SELECT STRING_AGG(CONCAT_WS('|', NumeroSolicitud, CodigoIniciativa), ',') WITHIN GROUP (ORDER BY NumeroSolicitud) FROM adm.SolicitudIniciativa");
            r = Script(Base, rb32);
            Check("B1 rollback con solicitudes ligadas: se niega", true, r.Contains("iniciativa ligada"));
            Check("B2 ... y no toca nada", "4|0|" + fotoB, Piezas32() + "|" + DenyAprobar() + "|" + Foto() +
                  Uno("SELECT STRING_AGG(CONCAT_WS('|', NumeroSolicitud, CodigoIniciativa), ',') WITHIN GROUP (ORDER BY NumeroSolicitud) FROM adm.SolicitudIniciativa"));
            var banderas = Regex.Matches(rb32 + sql32, @"SESSION_CONTEXT\(N'([a-z_0-9]+)'\)").Cast<Match>().Select(x => x.Groups[1].Value).Distinct().ToArray();
            Check("B3 sin banderas para forzar (solo aprobar_migracion)", "aprobar_migracion", string.Join(",", banderas));
            Check("B4 sql/32 no toca Cambios ni escribe dbo a mano", "False|False",
                  (sql32.Contains("SolicitudCambio") || rb32.Contains("SolicitudCambio")) + "|" +
                  Regex.IsMatch(sql32 + rb32, @"(ALTER|UPDATE|INSERT|DELETE|DROP)\s+(TABLE\s+|PROCEDURE\s+|FROM\s+)?dbo\.", RegexOptions.IgnoreCase));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            foreach (var db in new[] { Base, guarda })
                try { Borrar(db); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar " + db + ": " + ex.Message + ")"); }
        }
        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
