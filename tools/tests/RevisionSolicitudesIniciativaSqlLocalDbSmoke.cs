// Prueba de INTEGRACION de sql/31_solicitud_iniciativa_revision.sql (+
// _rollback) con App_Code/RevisionSolicitudesIniciativa.cs y el registro de
// lectura, contra bases REALES pero DESECHABLES de SQL Server LocalDB:
// GestionAdminPrueba_Rev<n> con la replica de dbo
// (tools/tests/GestionAdminLocalDb_replica.sql), sql/29 y la cuenta del sitio
// como en la VM (db_datareader + db_datawriter + EXECUTE sobre adm). Corre
// como la cuenta del sitio y BORRA las bases al final. Nunca toca la VM ni
// Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: sin aprobar (otra base) se niega; sin sql/29 se niega; con
//      _Crear cambiado se niega; aplicada: filas, eventos, contador, otros
//      CHECK, permisos y _Crear IGUALES; los CHECK nuevos; volver a aplicar
//      no toca nada.
//   R  rollback sin revisiones: vuelve a sql/29 exacta y sin perder nada; y
//      se puede volver a aplicar.
//   N  crear sigue igual despues de sql/31 (ENVIADA sin revision).
//   A  aprobar: estado, revisor, fecha, comentario opcional y el evento
//      (ENVIADA -> APROBADA, misma fecha, Detalle). ADM revisa la suya.
//   X  transiciones invalidas: rechazo sin motivo 51413; ya revisada 51412
//      (sin evento de mas); no existe 51411; sin revisor 51410.
//   C  concurrencia: 8 revisores a la vez (aprobar y rechazar) = 1 gana,
//      7 reciben 51412, un solo evento de revision.
//   P  permisos: la cuenta del sitio NO escribe las tablas a mano (229) y SI
//      ejecuta los dos procedimientos; ningun GRANT nuevo.
//   K  los CHECK nuevos detienen una escritura a mano (dbo) incoherente.
//   I  aprobar no crea ni toca ninguna iniciativa (dbo.Problem*, igual).
//   L  el registro de lectura muestra revision, comentario y Detalle.
//   B  rollback con revisiones: se niega (sin bandera) y no toca nada.
//
// Compilar (como SolicitudIniciativaSqlLocalDbSmoke): App_Code\*.cs en
// adm.dll y este archivo con /r:adm.dll /r:System.Core.dll /r:System.Data.dll;
// correr con cwd = raiz del repo.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class RevisionSolicitudesIniciativaSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string ADM = @"SORIANA\t_adm";
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
    // "sin error" o el mensaje; deja la sesion limpia (NOEXEC / transaccion).
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

    static int Crear(string cuenta, string titulo)
    {
        var g = new AlmacenSolicitudesSql(ComoSitio).Crear(new AltaSolicitud
        {
            Cuenta = cuenta, Token = Guid.NewGuid(), Tipo = "ADO", Po = "Jesus Campa Morones", So = "SO 1",
            Categoria = "/A/Cat 1", Director = "Dir 1", Titulo = titulo, Descripcion = "D", Observaciones = "O",
            Volumetria = 120, Pct = 0.2000m, RcaExtension = null,
            SolicitanteNombre = "Andres Vera Rios", SolicitanteCorreo = "andresvr@soriana.com", ProductOwnerCorreo = "jesuscamor@soriana.com",
        });
        return g.Numero.Valor;
    }

    // Huellas de lo que sql/31 NO debe cambiar.
    const string HuellaSolicitudes =
        "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', ISNULL(STRING_AGG(CONVERT(nvarchar(max), CONCAT_WS(N'|', NumeroSolicitud, Token, Estado, TipoIniciativa, " +
        "ProductOwner, ServiceOwner, Categoria, Director, Titulo, Descripcion, Observaciones, Volumetria, PctDisminucion, RcaExtension, SolicitanteCuenta, " +
        "SolicitanteNombre, SolicitanteCorreo, ProductOwnerCorreo, FuenteCorreos, CONVERT(varchar(30), FechaUtc, 126))), N'#') WITHIN GROUP (ORDER BY NumeroSolicitud), N'')), 1) " +
        "FROM adm.SolicitudIniciativa";
    const string HuellaEventos =
        "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', ISNULL(STRING_AGG(CONVERT(nvarchar(max), CONCAT_WS(N'|', IdEvento, NumeroSolicitud, Evento, EstadoAnterior, " +
        "EstadoNuevo, Usuario, CONVERT(varchar(30), FechaUtc, 126))), N'#') WITHIN GROUP (ORDER BY IdEvento), N'')), 1) FROM adm.SolicitudIniciativaEvento";
    const string HuellaPermisos =
        "SELECT ISNULL(STRING_AGG(CONVERT(nvarchar(max), CONCAT_WS(N':', p.state_desc, p.permission_name, p.class_desc, " +
        "CASE p.class WHEN 1 THEN OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id) WHEN 3 THEN SCHEMA_NAME(p.major_id) ELSE N'' END)), N', ') " +
        "WITHIN GROUP (ORDER BY p.class, p.major_id, p.permission_name), N'') " +
        "FROM sys.database_permissions AS p WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')";
    const string HuellaOtrosCheck =
        "SELECT STRING_AGG(CONVERT(nvarchar(max), name + N'=' + definition), N'; ') WITHIN GROUP (ORDER BY name) FROM sys.check_constraints " +
        "WHERE parent_object_id IN (OBJECT_ID(N'adm.SolicitudIniciativa'), OBJECT_ID(N'adm.SolicitudIniciativaEvento'), OBJECT_ID(N'adm.SolicitudIniciativaContador')) " +
        "AND name NOT IN (N'CK_SolicitudIniciativa_Estado', N'CK_SolicitudIniciativaEvento_Evento', N'CK_SolicitudIniciativa_Revision', N'CK_SolicitudIniciativa_Rechazo')";
    const string HashCrear =
        "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), " +
        "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)";
    const string HuellaIniciativas =
        "SELECT CONCAT_WS(N'|', (SELECT COUNT(*) FROM dbo.Problem), (SELECT CHECKSUM_AGG(CHECKSUM(*)) FROM dbo.Problem), " +
        "(SELECT COUNT(*) FROM dbo.ProblemCategoria), (SELECT CHECKSUM_AGG(CHECKSUM(*)) FROM dbo.ProblemCategoria), " +
        "(SELECT COUNT(*) FROM dbo.ProblemFechaEvento), (SELECT COUNT(*) FROM dbo.ProblemEstadoEvento))";

    static string Foto()
    {
        return string.Join(" ~ ", new[] { Uno(HuellaSolicitudes), Uno(HuellaEventos), Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"),
                                          Uno(HuellaPermisos), Uno(HuellaOtrosCheck), Uno(HashCrear) });
    }
    static string Definicion(string tabla, string ck)
    {
        return Uno("SELECT definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'" + tabla + "') AND name = N'" + ck + "'");
    }
    static string Piezas31()
    {
        return Uno("SELECT (CASE WHEN COL_LENGTH('adm.SolicitudIniciativa','RevisadoPor') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN COL_LENGTH('adm.SolicitudIniciativa','FechaRevisionUtc') IS NULL THEN 0 ELSE 1 END) " +
                   "+ (CASE WHEN COL_LENGTH('adm.SolicitudIniciativa','ComentarioRevision') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN COL_LENGTH('adm.SolicitudIniciativaEvento','Detalle') IS NULL THEN 0 ELSE 1 END) " +
                   "+ (CASE WHEN OBJECT_ID('adm.usp_SolicitudIniciativa_Aprobar','P') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.usp_SolicitudIniciativa_Rechazar','P') IS NULL THEN 0 ELSE 1 END)");
    }

    public static int Main()
    {
        var t = Environment.TickCount.ToString().Replace("-", "");
        Base = "GestionAdminPrueba_Rev" + t;
        var otra = "GestionAdminPrueba_RevB" + t;
        var guarda = "RevisionGuarda" + t;
        var sql29 = Leer("sql", "29_solicitud_iniciativa.sql");
        var sql31 = Leer("sql", "31_solicitud_iniciativa_revision.sql");
        var rb31 = Leer("sql", "31_solicitud_iniciativa_revision_rollback.sql");
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
                Exec(cn, "DELETE FROM dbo.CatPersona;" +
                         "INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES " +
                         "(N'Andres Vera Rios', N'andresvr@soriana.com', 1), (N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1);");
            }

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                  Script(guarda, sql31).Contains("SIN APROBAR") + "|" + Script(guarda, rb31).Contains("SIN APROBAR"));
            Borrar(guarda);
            Check("G2 sin sql/29: se niega y no crea nada", "True|0", Script(Base, sql31).Contains("falta sql/29") + "|" + Piezas31());
            using (var cn = Abrir(Base)) Lotes(cn, sql29);
            Check("G3 rollback antes de aplicar 31: se niega", true, Script(Base, rb31).Contains("no esta aplicada"));

            // _Crear cambiado a mano (otra base): 31 no se aplica encima.
            Borrar(otra);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + otra + "]");
            using (var cn = Abrir(otra))
            {
                Exec(cn, "EXEC (N'CREATE SCHEMA adm'); CREATE TABLE dbo.CatPersona (Nombre nvarchar(255), Correo nvarchar(255), VigenteEnOrigen bit);");
                Lotes(cn, sql29);
                Exec(cn, "DECLARE @d nvarchar(max) = REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear')), N'CREATE PROCEDURE', N'ALTER PROCEDURE') + N' -- a mano'; EXEC (@d);");
            }
            var rOtra = Script(otra, sql31);
            string piezasOtra;
            using (var cn = Abrir(otra))
            using (var c = new SqlCommand("SELECT (CASE WHEN COL_LENGTH('adm.SolicitudIniciativa','RevisadoPor') IS NULL THEN 0 ELSE 1 END) " +
                                          "+ (CASE WHEN OBJECT_ID('adm.usp_SolicitudIniciativa_Aprobar','P') IS NULL THEN 0 ELSE 1 END)", cn))
                piezasOtra = Convert.ToString(c.ExecuteScalar());
            Check("G4 _Crear distinto al de sql/29: se niega sin tocar nada", "True|0", rOtra.Contains("no es la esperada") + "|" + piezasOtra);
            Borrar(otra);

            // Datos que ya existen antes de 31.
            var n1 = Crear(@"SORIANA\andresvr", "Uno");
            var n2 = Crear(@"SORIANA\andresvr", "Dos");
            var n3 = Crear(@"SORIANA\andresvr", "Tres");
            var antes = Foto();
            var antesL = Lector().Detalle(n1);
            Check("G5 antes de 31 el registro no ofrece revisar y sin campos de revision", "False||",
                  antesL["revision_disponible"] + "|" + antesL["revisado_por"] + "|" + ((Dictionary<string, object>)((List<object>)antesL["eventos"])[0])["detalle"]);

            var r = Script(Base, sql31);
            Check("G6 sql/31 se aplica", "sin error|6", r + "|" + Piezas31());
            Check("G7 filas, eventos, contador, permisos, otros CHECK y _Crear IGUALES", antes, Foto());
            Check("G8 todas siguen ENVIADA sin revision; eventos sin Detalle", "3|0|0",
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE Estado = 'ENVIADA' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL AND ComentarioRevision IS NULL") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE Estado <> 'ENVIADA'") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE Detalle IS NOT NULL"));
            Check("G9 CHECK nuevos", "([Estado]='RECHAZADA' OR [Estado]='APROBADA' OR [Estado]='ENVIADA')|([Evento]='RECHAZADA' OR [Evento]='APROBADA' OR [Evento]='ENVIADA')|True|True",
                  Definicion("adm.SolicitudIniciativa", "CK_SolicitudIniciativa_Estado") + "|" + Definicion("adm.SolicitudIniciativaEvento", "CK_SolicitudIniciativaEvento_Evento") + "|" +
                  (Definicion("adm.SolicitudIniciativa", "CK_SolicitudIniciativa_Revision") != "NULL") + "|" + (Definicion("adm.SolicitudIniciativa", "CK_SolicitudIniciativa_Rechazo") != "NULL"));
            Check("G10 volver a aplicar: 'ya aplicada', no toca nada", "True|" + antes, Script(Base, sql31).Contains("ya aplicada") + "|" + Foto());

            // ---------------- R: rollback sin revisiones (ida y vuelta) ----------------
            r = Script(Base, rb31);
            Check("R1 rollback sin revisiones: deshace", "sin error|0", r + "|" + Piezas31());
            Check("R2 vuelve a sql/29 exacta y sin perder nada", "([Estado]='ENVIADA')|([Evento]='ENVIADA')|" + antes,
                  Definicion("adm.SolicitudIniciativa", "CK_SolicitudIniciativa_Estado") + "|" + Definicion("adm.SolicitudIniciativaEvento", "CK_SolicitudIniciativaEvento_Evento") + "|" + Foto());
            Check("R3 aplicar otra vez despues del rollback", "sin error|6|" + antes, Script(Base, sql31) + "|" + Piezas31() + "|" + Foto());

            // ---------------- N: crear sigue igual ----------------
            var n4 = Crear(@"SORIANA\andresvr", "Cuatro");
            Check("N1 crear despues de 31: siguiente numero, ENVIADA, sin revision, evento sin Detalle", (n3 + 1) + "|ENVIADA|NULL|NULL|1|NULL",
                  n4 + "|" + Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n4) + "|" +
                  Uno("SELECT RevisadoPor FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n4) + "|" +
                  Uno("SELECT ComentarioRevision FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n4) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n4) + "|" +
                  Uno("SELECT Detalle FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n4));

            var iniciativasAntes = Uno(HuellaIniciativas);

            // ---------------- A: aprobar ----------------
            var f1 = Revisor().Aprobar(n1, ADM, null);
            Check("A1 aprobar sin comentario: APROBADA, revisor, fecha, comentario NULL",
                  "APROBADA|" + ADM + "|" + f1.ToString("yyyy-MM-ddTHH:mm:ss") + "|NULL",
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n1) + "|" +
                  Uno("SELECT RevisadoPor FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n1) + "|" +
                  Uno("SELECT CONVERT(varchar(19), FechaRevisionUtc, 126) FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n1) + "|" +
                  Uno("SELECT ComentarioRevision FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n1));
            Check("A2 evento: ENVIADA -> APROBADA, quien, la MISMA fecha, sin Detalle", "2|APROBADA|ENVIADA|APROBADA|" + ADM + "|1|NULL",
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n1) + "|" +
                  Uno("SELECT TOP 1 CONCAT_WS('|', Evento, EstadoAnterior, EstadoNuevo, Usuario) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n1 + " ORDER BY IdEvento DESC") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento AS e JOIN adm.SolicitudIniciativa AS s ON s.NumeroSolicitud = e.NumeroSolicitud " +
                      "WHERE e.NumeroSolicitud = " + n1 + " AND e.Evento = 'APROBADA' AND e.FechaUtc = s.FechaRevisionUtc") + "|" +
                  Uno("SELECT TOP 1 Detalle FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n1 + " ORDER BY IdEvento DESC"));
            Revisor().Aprobar(n2, ADM, "  Va, crearla en Crear  ");
            Check("A3 aprobar con comentario: recortado, en la solicitud y en el evento", "Va, crearla en Crear|Va, crearla en Crear",
                  Uno("SELECT ComentarioRevision FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n2) + "|" +
                  Uno("SELECT TOP 1 Detalle FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n2 + " ORDER BY IdEvento DESC"));
            var propia = Crear(ADM, "Mia");
            Revisor().Aprobar(propia, ADM, null);
            Check("A4 ADM revisa la suya (fase de pruebas): permitido, solicitante y revisor aparte", "APROBADA|" + ADM + "|" + ADM,
                  Uno("SELECT CONCAT_WS('|', Estado, SolicitanteCuenta, RevisadoPor) FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + propia));

            // ---------------- X: transiciones invalidas ----------------
            var ev3 = Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n3);
            Check("X1 rechazo sin motivo (NULL / vacio / espacios): 51413 y nada cambia", "51413|51413|51413|ENVIADA|" + ev3,
                  Error(() => Revisor().Rechazar(n3, ADM, null)) + "|" + Error(() => Revisor().Rechazar(n3, ADM, "")) + "|" +
                  Error(() => Revisor().Rechazar(n3, ADM, "   ")) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n3) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n3));
            Revisor().Rechazar(n3, ADM, "No hay capacidad");
            Check("X2 rechazar con motivo: RECHAZADA con comentario y evento", "RECHAZADA|No hay capacidad|RECHAZADA|ENVIADA|No hay capacidad",
                  Uno("SELECT CONCAT_WS('|', Estado, ComentarioRevision) FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n3) + "|" +
                  Uno("SELECT TOP 1 CONCAT_WS('|', Evento, EstadoAnterior, Detalle) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n3 + " ORDER BY IdEvento DESC"));
            var evTotal = Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento");
            var estados = Uno("SELECT STRING_AGG(CONCAT(NumeroSolicitud, Estado), ',') WITHIN GROUP (ORDER BY NumeroSolicitud) FROM adm.SolicitudIniciativa");
            Check("X3 ya revisada (final): aprobar o rechazar otra vez = 51412, sin evento ni cambio",
                  "51412|51412|51412|51412|" + evTotal + "|" + estados,
                  Error(() => Revisor().Aprobar(n1, ADM, null)) + "|" + Error(() => Revisor().Rechazar(n1, ADM, "x")) + "|" +
                  Error(() => Revisor().Aprobar(n3, ADM, null)) + "|" + Error(() => Revisor().Rechazar(n3, ADM, "otra vez")) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento") + "|" +
                  Uno("SELECT STRING_AGG(CONCAT(NumeroSolicitud, Estado), ',') WITHIN GROUP (ORDER BY NumeroSolicitud) FROM adm.SolicitudIniciativa"));
            Check("X4 no existe: 51411; sin revisor (NULL / espacios): 51410", "51411|51411|51410|51410",
                  Error(() => Revisor().Aprobar(999, ADM, null)) + "|" + Error(() => Revisor().Rechazar(999, ADM, "x")) + "|" +
                  Error(() => Revisor().Aprobar(n4, null, null)) + "|" + Error(() => Revisor().Rechazar(n4, "  ", "x")));

            // ---------------- C: concurrencia ----------------
            var nc = Crear(@"SORIANA\andresvr", "Concurrente");
            var resultados = new string[8];
            var barrera = new Barrier(8);
            var hilos = Enumerable.Range(0, 8).Select(i => new Thread(() =>
            {
                barrera.SignalAndWait();
                resultados[i] = (i % 2 == 0 ? "A:" : "R:") +
                                Error(() => { if (i % 2 == 0) Revisor().Aprobar(nc, @"SORIANA\t_adm" + i, null); else Revisor().Rechazar(nc, @"SORIANA\t_adm" + i, "motivo " + i); });
            })).ToList();
            hilos.ForEach(h => h.Start());
            hilos.ForEach(h => h.Join());
            var ganador = resultados.Single(x => x.EndsWith("sin error"));
            Check("C1 8 revisores a la vez: 1 gana y 7 reciben 51412", "1|7", resultados.Count(x => x.EndsWith("sin error")) + "|" + resultados.Count(x => x.EndsWith("51412")));
            Check("C2 un solo evento de revision y el estado del que gano", "2|" + (ganador.StartsWith("A") ? "APROBADA" : "RECHAZADA") + "|1",
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + nc) + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + nc) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento AS e JOIN adm.SolicitudIniciativa AS s ON s.NumeroSolicitud = e.NumeroSolicitud " +
                      "WHERE e.NumeroSolicitud = " + nc + " AND e.Evento = s.Estado AND e.Usuario = s.RevisadoPor AND e.FechaUtc = s.FechaRevisionUtc"));

            // ---------------- P: permisos ----------------
            Check("P1 la cuenta del sitio NO escribe a mano (229 en las 3 tablas)", "229|229|229|229|229",
                  ComoSitioError("UPDATE adm.SolicitudIniciativa SET Estado = 'APROBADA', RevisadoPor = 'x', FechaRevisionUtc = SYSUTCDATETIME() WHERE NumeroSolicitud = " + n4) + "|" +
                  ComoSitioError("INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoNuevo, Usuario) VALUES (" + n4 + ", 'APROBADA', 'APROBADA', 'x')") + "|" +
                  ComoSitioError("DELETE FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = " + n1) + "|" +
                  ComoSitioError("UPDATE adm.SolicitudIniciativaContador SET Ultimo = Ultimo + 1") + "|" +
                  ComoSitioError("DELETE FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n4));
            using (var cn = ComoSitio())
            using (var c = new SqlCommand("SELECT CONCAT_WS('|', HAS_PERMS_BY_NAME('adm.usp_SolicitudIniciativa_Aprobar', 'OBJECT', 'EXECUTE'), " +
                                          "HAS_PERMS_BY_NAME('adm.usp_SolicitudIniciativa_Rechazar', 'OBJECT', 'EXECUTE'), " +
                                          "HAS_PERMS_BY_NAME('adm.SolicitudIniciativa', 'OBJECT', 'UPDATE'), HAS_PERMS_BY_NAME('adm.SolicitudIniciativaEvento', 'OBJECT', 'INSERT'))", cn))
                Check("P2 como la cuenta del sitio: EXECUTE en los 2 procedimientos, sin UPDATE / INSERT en las tablas", "1|1|0|0", c.ExecuteScalar());
            Check("P3 ningun permiso nuevo para PROACTIVANETAD (solo el EXECUTE de esquema de sql/18 y los 9 DENY)", antes.Split(new[] { " ~ " }, StringSplitOptions.None)[3],
                  Uno(HuellaPermisos));

            // ---------------- K: los CHECK nuevos ----------------
            // Cada caso por separado sobre la ENVIADA n4 (si uno pasara, los demas no se contaminan: se verifica abajo).
            Check("K1 a mano (dbo): estados y revision incoherentes se rechazan (547), incluidos los NULL",
                  "547|547|547|547|547|547|547|547|547",
                  DboError("UPDATE adm.SolicitudIniciativa SET Estado = 'APROBADA' WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET Estado = 'RECHAZADA', RevisadoPor = 'x', FechaRevisionUtc = SYSUTCDATETIME() WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET Estado = 'RECHAZADA', RevisadoPor = 'x', FechaRevisionUtc = SYSUTCDATETIME(), ComentarioRevision = N'   ' WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET Estado = 'APROBADA', RevisadoPor = NULL, FechaRevisionUtc = SYSUTCDATETIME() WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET Estado = 'APROBADA', RevisadoPor = '   ', FechaRevisionUtc = SYSUTCDATETIME() WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET Estado = 'CANCELADA' WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET RevisadoPor = 'x' WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("UPDATE adm.SolicitudIniciativa SET ComentarioRevision = N'x' WHERE NumeroSolicitud = " + n4) + "|" +
                  DboError("INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoNuevo, Usuario) VALUES (" + n4 + ", 'BORRADA', 'BORRADA', 'x')"));
            Check("K2 la ENVIADA de prueba sigue intacta", "ENVIADA|NULL", Uno("SELECT Estado FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n4) + "|" +
                  Uno("SELECT RevisadoPor FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n4));

            // ---------------- I: no toca iniciativas ----------------
            Check("I1 aprobar / rechazar no crea ni toca iniciativas (dbo.Problem*, igual)", iniciativasAntes, Uno(HuellaIniciativas));

            // ---------------- L: registro de lectura ----------------
            var d2 = Lector().Detalle(n2);
            var ev2 = (List<object>)d2["eventos"];
            var ult = (Dictionary<string, object>)ev2[ev2.Count - 1];
            Check("L1 detalle: revision, comentario y Detalle del evento",
                  "True|APROBADA|" + ADM + "|True|Va, crearla en Crear|APROBADA|Va, crearla en Crear",
                  d2["revision_disponible"] + "|" + d2["estado"] + "|" + d2["revisado_por"] + "|" + ((string)d2["fecha_revision_utc"]).EndsWith("Z") + "|" +
                  d2["comentario_revision"] + "|" + ult["evento"] + "|" + ult["detalle"]);
            var lista = Lector().Listar(200);
            Check("L2 lista: revision_disponible y estados", "True|RECHAZADA|No hay capacidad",
                  lista.RevisionDisponible + "|" + lista.Solicitudes.Single(s => (int)s["numero"] == n3)["estado"] + "|" +
                  lista.Solicitudes.Single(s => (int)s["numero"] == n3)["comentario_revision"]);

            // ---------------- B: rollback con revisiones ----------------
            var fotoB = Foto() + Uno("SELECT STRING_AGG(CONCAT_WS('|', NumeroSolicitud, Estado, RevisadoPor, ComentarioRevision), ',') WITHIN GROUP (ORDER BY NumeroSolicitud) FROM adm.SolicitudIniciativa") +
                        Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE Detalle IS NOT NULL");
            r = Script(Base, rb31);
            Check("B1 rollback con solicitudes revisadas: se niega", true, r.Contains("ya hay solicitudes revisadas"));
            Check("B2 ... y no toca nada (piezas, filas, revisiones, eventos)", "6|" + fotoB,
                  Piezas31() + "|" + Foto() + Uno("SELECT STRING_AGG(CONCAT_WS('|', NumeroSolicitud, Estado, RevisadoPor, ComentarioRevision), ',') WITHIN GROUP (ORDER BY NumeroSolicitud) FROM adm.SolicitudIniciativa") +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WHERE Detalle IS NOT NULL"));
            var sinBandera = Regex.Matches(rb31, @"SESSION_CONTEXT\(N'([a-z_0-9]+)'\)").Cast<Match>().Select(x => x.Groups[1].Value).Distinct().ToArray();
            Check("B3 el rollback no tiene bandera para forzarlo (solo aprobar_migracion)", "aprobar_migracion", string.Join(",", sinBandera));
            Check("B4 sql/31 y su rollback no tocan Cambios (sql/22) ni dbo", "False|False",
                  (sql31.Contains("SolicitudCambio") || rb31.Contains("SolicitudCambio")) + "|" +
                  Regex.IsMatch(sql31 + rb31, @"(ALTER|UPDATE|INSERT|DELETE|DROP)\s+(TABLE\s+|PROCEDURE\s+|FROM\s+)?dbo\.", RegexOptions.IgnoreCase));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            foreach (var db in new[] { Base, otra, guarda })
                try { Borrar(db); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar " + db + ": " + ex.Message + ")"); }
        }
        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
