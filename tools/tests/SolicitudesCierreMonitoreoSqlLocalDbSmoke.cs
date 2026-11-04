// Prueba de INTEGRACION de sql/40_solicitud_cambio_cierre_monitoreo.sql
// (+ _rollback) con el almacen real de solicitudes
// (AlmacenSolicitudesCambioSql + AplicadorSolicitudCambio), contra una base
// REAL pero DESECHABLE de SQL Server LocalDB: crea
// GestionAdminPrueba_S40<n>, aplica la replica, el cargador 174bb51, las
// vistas del backend, sql/18, 20, 21, 22 + permisos, 23, 24, 25 y 34 (la VM
// segun el preflight 2026-10-29), corre los casos y BORRA las bases al
// final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base), exige sql/34 antes, hash de la
//      cabecera, ya aplicada, Modificar sin cambio, rollback antes de 40.
//   A  antes de sql/40: cerrar desde En Monitoreo por solicitud deja la
//      FechaCierre compromiso (el comportamiento que se corrige).
//   M  con sql/40: En Monitoreo -> Cerrado (compromiso futuro, vencido, ya
//      hoy, sin fecha, ESTADO con fecha pedida, VARIOS con fecha pedida,
//      Estado escrito en mayusculas), sin @Hoy (Mexico UTC-06 en SQL),
//      historial de fecha y de estado con SolicitudId.
//   O  otras transiciones: En Solucion -> Cerrado (con y sin fecha), En
//      Monitoreo -> En Solucion, iniciativa ya Cerrada (DATOS): sin cambios.
//   F  falla dentro de Modificar (51015): nada aplicado (ni Estado ni
//      FechaCierre), sin eventos, solicitud PENDIENTE; reintento la aplica.
//   V  una solicitud no puede pedir FechaCierre vacia (CHECK / 51214).
//   B  rollback: Aplicar vuelve EXACTO a sql/34 y el cierre vuelve a dejar
//      la fecha compromiso; volver a aplicar 40.
//
// Compilar (ver memoria csc): App_Code\*.cs + este archivo con
// /r:System.Core.dll /r:System.Data.dll ...; correr con cwd = raiz.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

public static class SolicitudesCierreMonitoreoSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Aplicar34 = "0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804";
    const string Aplicar25 = "0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1";
    const string Modificar24 = "0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77";
    static readonly DateTime Hoy = new DateTime(2026, 10, 26);
    const string HoyIso = "2026-10-26";
    const string ADM = @"SORIANA\adm2";
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
    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 }) c.ExecuteNonQuery(); }
    static string Uno(string sql) { return Uno(Base, sql); }
    static string Uno(string db, string sql)
    {
        using (var cn = Abrir(db)) using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 })
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
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    static string Hash(string objeto)
    {
        return Uno("SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('" + objeto +
                   "')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)");
    }

    static readonly string[] Iniciativas =
    {
        // Codigo, Estado, FechaCierre
        "PRB 2026-000101|En Monitoreo|2026-11-30",   // M1 compromiso futuro
        "PRB 2026-000102|En Monitoreo|2026-10-01",   // M2 compromiso vencido
        "PRB 2026-000103|En Monitoreo|" + HoyIso,    // M3 ya hoy
        "PRB 2026-000104|En Monitoreo|2026-11-30",   // M4 ESTADO con fecha pedida
        "PRB 2026-000105|En Monitoreo|2026-11-30",   // M5 VARIOS con fecha pedida
        "PRB 2026-000106|En Monitoreo|NULL",         // M6 sin FechaCierre
        "PRB 2026-000107|EN MONITOREO|2026-11-30",   // M7 escritura de la base
        "PRB 2026-000108|En Monitoreo|2026-11-30",   // M8 sin @Hoy
        "PRB 2026-000111|En Solución|2026-11-30", // O1
        "PRB 2026-000112|En Solución|NULL",       // O2
        "PRB 2026-000113|En Monitoreo|2026-11-30",   // O3 -> En Solucion
        "PRB 2026-000115|En Solución|NULL",      // queda En Solucion (Estado existente para O3)
        "PRB 2026-000114|Cerrado|2026-10-01",        // O4 ya cerrada
        "PRB 2026-000121|En Monitoreo|2026-11-30",   // F falla
        "PRB 2026-000131|En Monitoreo|2026-11-30",   // A antes de 40
        "PRB 2026-000132|En Monitoreo|2026-11-30",   // B despues del rollback
        "PRB 2026-000133|En Monitoreo|2026-11-30",   // B2 re-aplicada
    };

    // La VM: hasta sql/34 (22 + permisos, 23, 24, 25, 34).
    static void Preparar(string db, bool con34)
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
            Lotes(cn, Leer("sql", "24_gestion_admin_modificar_duenos_quitar.sql"));
            Lotes(cn, Leer("sql", "25_solicitudes_cambio_datos.sql"));
            if (con34) Lotes(cn, Leer("sql", "34_solicitudes_cambio_varios.sql"));
            var filas = new List<string>();
            foreach (var i in Iniciativas)
            {
                var c = i.Split('|');
                filas.Add("(N'" + c[0] + "', N'Problem', N'T " + c[0] + "', N'" + c[1] + "', '2026-08-01', '2026-09-01', " +
                          (c[2] == "NULL" ? "NULL" : "'" + c[2] + "'") + ")");
            }
            Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, FechaAnalisis, FechaSolucion, FechaCierre) VALUES " + string.Join(",\r\n", filas.ToArray()) + @";
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000101', N'/A/Cat 1', N'Problem', N'Problem', 0.1000, 1);");
        }
    }

    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorSolicitudCambio ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    static NameValueCollection Form(params string[] kv)
    {
        var f = new NameValueCollection { { "llave", Guid.NewGuid().ToString() }, { "motivo", "m" } };
        for (var i = 0; i < kv.Length; i += 2) f[kv[i]] = kv[i + 1];
        return f;
    }

    static int Enviar(AlmacenSolicitudesCambioSql alm, params string[] kv)
    {
        var p = PeticionSolicitudCambio.DesdeFormulario(Form(kv));
        if (!p.Valida) throw new InvalidOperationException("formulario invalido: " + p.Errores[0].Campo + " " + p.Errores[0].Mensaje);
        return alm.Enviar(p, @"SORIANA\mod1", "MOD").IdSolicitud;
    }
    static int Cerrar(AlmacenSolicitudesCambioSql alm, string codigo, params string[] extra)
    {
        var kv = new List<string> { "folio", codigo, "tipo", "estado", "estado_nuevo", "Cerrado" };
        kv.AddRange(extra);
        return Enviar(alm, kv.ToArray());
    }

    // Estado|FAnalisis|FSolucion|FCierre|Titulo
    static string Problem(string codigo)
    {
        return Uno("SELECT p.Estado + '|' + ISNULL(CONVERT(varchar(10), p.FechaAnalisis, 23), 'NULL') + '|' + ISNULL(CONVERT(varchar(10), p.FechaSolucion, 23), 'NULL') + '|' + " +
                   "ISNULL(CONVERT(varchar(10), p.FechaCierre, 23), 'NULL') + '|' + ISNULL(p.Titulo, 'NULL') FROM dbo.Problem AS p WHERE p.Codigo = N'" + codigo + "'");
    }
    static string FCierre(string codigo)
    {
        return Uno("SELECT ISNULL(CONVERT(varchar(10), FechaCierre, 23), 'NULL') FROM dbo.Problem WHERE Codigo = N'" + codigo + "'");
    }
    // Eventos de FechaCierre de la solicitud: anterior>nueva;...
    static string EventosFC(int id)
    {
        return Uno("SELECT ISNULL(STUFF((SELECT ';' + ISNULL(CONVERT(varchar(10), FechaAnterior, 23), 'NULL') + '~' + ISNULL(CONVERT(varchar(10), FechaNueva, 23), 'NULL') " +
                   "FROM dbo.ProblemFechaEvento WHERE SolicitudId = " + id + " AND Campo = 'FechaCierre' ORDER BY IdEvento FOR XML PATH('')), 1, 1, ''), '')");
    }
    static string EventosFecha(string codigo)
    {
        return Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + codigo + "'");
    }
    // Eventos de Estado de la solicitud: anterior>nuevo;...
    static string EventosEstado(int id)
    {
        return Uno("SELECT ISNULL(STUFF((SELECT ';' + ISNULL(EstadoAnterior, 'NULL') + '~' + ISNULL(EstadoNuevo, 'NULL') " +
                   "FROM dbo.ProblemEstadoEvento WHERE SolicitudId = " + id + " ORDER BY IdEvento FOR XML PATH('')), 1, 1, ''), '')");
    }

    public static int Main(string[] args)
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        var sello = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        Base = "GestionAdminPrueba_S40" + sello;
        var b25 = "GestionAdminPrueba_S40b" + sello;
        var guarda = "S40Guarda_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql40 = Leer("sql", "40_solicitud_cambio_cierre_monitoreo.sql");
        var rb40 = Leer("sql", "40_solicitud_cambio_cierre_monitoreo_rollback.sql");
        var post = Regex.Match(sql40, @"POSTCONDICION Aplicar = (0x[0-9A-F]{64})");
        if (!post.Success) { Console.WriteLine("NO CORRIDO: sql/40 sin su hash de postcondicion."); return 2; }
        var hAplicar40 = post.Groups[1].Value;
        try
        {
            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql40).Contains("SIN APROBAR") + "|" + LotesError(g, rb40).Contains("SIN APROBAR"));
            Borrar(guarda);

            Preparar(b25, false);
            var baseReal = Base; Base = b25;
            using (var cn = Abrir(b25))
                Check("G2 sin sql/34 (Aplicar de sql/25): se niega y no toca nada", "True|" + Aplicar25,
                      LotesError(cn, sql40).Contains("no es la esperada") + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
            Base = baseReal;
            Borrar(b25);

            Preparar(Base, true);
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = true;
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = true;
            var alm = new AlmacenSolicitudesCambioSql(delegate { return Abrir(Base); });
            var aplicador = new AplicadorSolicitudCambio(alm, delegate { return new ValidacionAplicar { Valida = true }; });
            Check("G3 base de partida = VM (Aplicar de sql/34, Modificar de sql/24)", Aplicar34 + "|" + Modificar24,
                  Hash("adm.usp_SolicitudCambio_Aplicar") + "|" + Hash("adm.usp_GestionAdmin_Modificar"));

            // ---------------- A: antes de sql/40 ----------------
            var a1 = Cerrar(alm, "PRB 2026-000131");
            aplicador.Aplicar(a1, ADM, null, null, Hoy);
            Check("A1 sin sql/40: cerrar desde En Monitoreo deja la FechaCierre compromiso (lo que se corrige)",
                  "Cerrado|2026-11-30|", Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000131'") + "|" + FCierre("PRB 2026-000131") + "|" + EventosFC(a1));

            using (var cn = Abrir(Base))
            {
                Check("G4 rollback de 40 antes de aplicarla: 'ya deshecho', sin tocar nada", "True|" + Aplicar34,
                      LotesError(cn, rb40).Contains("ya deshecho") + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
                Check("G5 aplicada: hash de la cabecera; Modificar sin cambio", "sin error|" + hAplicar40 + "|" + Modificar24,
                      LotesError(cn, sql40) + "|" + Hash("adm.usp_SolicitudCambio_Aplicar") + "|" + Hash("adm.usp_GestionAdmin_Modificar"));
                Check("G6 aplicarla otra vez: 'ya aplicado', sin tocar nada", "True|" + hAplicar40,
                      LotesError(cn, sql40).Contains("ya aplicado") + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
                Check("G7 parametros de Aplicar sin cambio (5)", "5",
                      Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_SolicitudCambio_Aplicar')"));
            }

            // ---------------- M: En Monitoreo -> Cerrado ----------------
            var m1 = Cerrar(alm, "PRB 2026-000101");
            aplicador.Aplicar(m1, ADM, "ok", null, Hoy);
            Check("M1 compromiso futuro: FechaCierre = hoy; resto intacto; APLICADA",
                  "Cerrado|2026-08-01|2026-09-01|" + HoyIso + "|T PRB 2026-000101|APLICADA", Problem("PRB 2026-000101") + "|" + alm.Detalle(m1)["estado"]);
            Check("M1 ... historial de fecha (trigger sql/17) con la solicitud", "2026-11-30~" + HoyIso, EventosFC(m1));
            Check("M1 ... historial de estado con la solicitud", "En Monitoreo~Cerrado", EventosEstado(m1));
            Check("M1 ... la categoria no se toca", "0.1000",
                  Uno("SELECT CONVERT(varchar(10), PctDisminucion) FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000101'"));

            var m2 = Cerrar(alm, "PRB 2026-000102");
            aplicador.Aplicar(m2, ADM, null, null, Hoy);
            Check("M2 compromiso vencido: FechaCierre = hoy, con su evento", "Cerrado|" + HoyIso + "|2026-10-01~" + HoyIso,
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000102'") + "|" + FCierre("PRB 2026-000102") + "|" + EventosFC(m2));

            var ev3 = EventosFecha("PRB 2026-000103");
            var m3 = Cerrar(alm, "PRB 2026-000103");
            aplicador.Aplicar(m3, ADM, null, null, Hoy);
            Check("M3 FechaCierre ya hoy: no se reescribe; ningun evento de fecha nuevo; el estado si",
                  "Cerrado|" + HoyIso + "||" + ev3 + "|En Monitoreo~Cerrado",
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000103'") + "|" + FCierre("PRB 2026-000103") + "|" + EventosFC(m3) + "|" +
                  EventosFecha("PRB 2026-000103") + "|" + EventosEstado(m3));

            var m4 = Cerrar(alm, "PRB 2026-000104", "campo_fecha", "f_cierre", "fecha_nueva", "2026-10-20");
            aplicador.Aplicar(m4, ADM, null, null, Hoy);
            Check("M4 ESTADO con FechaCierre pedida: se respeta la pedida", "Cerrado|2026-10-20|2026-11-30~2026-10-20",
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000104'") + "|" + FCierre("PRB 2026-000104") + "|" + EventosFC(m4));

            var m5 = Enviar(alm, "folio", "PRB 2026-000105", "tipo", "varios", "estado_nuevo", "Cerrado", "f_cierre_nueva", "2026-10-22", "titulo_nuevo", "Cinco");
            aplicador.Aplicar(m5, ADM, null, null, Hoy);
            Check("M5 VARIOS con FechaCierre pedida: se respeta; lo demas se aplica", "Cerrado|2026-08-01|2026-09-01|2026-10-22|Cinco|2026-11-30~2026-10-22",
                  Problem("PRB 2026-000105") + "|" + EventosFC(m5));

            var m6 = Cerrar(alm, "PRB 2026-000106");
            aplicador.Aplicar(m6, ADM, null, null, Hoy);
            Check("M6 sin FechaCierre: hoy (asignacion NULL -> hoy)", "Cerrado|" + HoyIso + "|NULL~" + HoyIso,
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000106'") + "|" + FCierre("PRB 2026-000106") + "|" + EventosFC(m6));

            var m7 = Cerrar(alm, "PRB 2026-000107");
            aplicador.Aplicar(m7, ADM, null, null, Hoy);
            Check("M7 'EN MONITOREO' (otra escritura) -> Cerrado: tambien hoy", "Cerrado|" + HoyIso,
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000107'") + "|" + FCierre("PRB 2026-000107"));

            var m8 = Cerrar(alm, "PRB 2026-000108");
            var hoySql = Uno("SELECT CONVERT(varchar(10), CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())), 23)");
            using (var cn = Abrir(Base))
                Exec(cn, "DECLARE @c adm.SolicitudClasificacionTipo; EXEC adm.usp_SolicitudCambio_Aplicar @IdSolicitud = " + m8 +
                         ", @Revisor = N'" + ADM + "', @Clasificaciones = @c;");
            Check("M8 sin @Hoy: el dia de Mexico (UTC-06) en SQL, como Modificar", "Cerrado|" + hoySql,
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000108'") + "|" + FCierre("PRB 2026-000108"));

            // ---------------- O: otras transiciones ----------------
            var o1 = Cerrar(alm, "PRB 2026-000111");
            aplicador.Aplicar(o1, ADM, null, null, Hoy);
            Check("O1 En Solucion -> Cerrado con FechaCierre: se conserva (como antes)", "Cerrado|2026-11-30|",
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000111'") + "|" + FCierre("PRB 2026-000111") + "|" + EventosFC(o1));
            var o2 = Cerrar(alm, "PRB 2026-000112");
            aplicador.Aplicar(o2, ADM, null, null, Hoy);
            Check("O2 En Solucion -> Cerrado sin FechaCierre: sigue NULL por solicitud (como antes)", "Cerrado|NULL|",
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000112'") + "|" + FCierre("PRB 2026-000112") + "|" + EventosFC(o2));
            var o3 = Enviar(alm, "folio", "PRB 2026-000113", "tipo", "estado", "estado_nuevo", "En Solución");
            aplicador.Aplicar(o3, ADM, null, null, Hoy);
            Check("O3 En Monitoreo -> En Solucion: FechaCierre no se toca", "En Solución|2026-11-30|",
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000113'") + "|" + FCierre("PRB 2026-000113") + "|" + EventosFC(o3));
            var ev4 = EventosFecha("PRB 2026-000114");
            var o4 = Enviar(alm, "folio", "PRB 2026-000114", "tipo", "datos", "titulo_nuevo", "Ya cerrada");
            aplicador.Aplicar(o4, ADM, null, null, Hoy);
            Check("O4 ya Cerrada, solicitud de otro dato: FechaCierre igual, ningun evento de fecha", "Cerrado|2026-08-01|2026-09-01|2026-10-01|Ya cerrada|" + ev4,
                  Problem("PRB 2026-000114") + "|" + EventosFecha("PRB 2026-000114"));
            using (var cn = Abrir(Base))
                Check("O5 ya Cerrada: pedir Cerrado otra vez = 51219 (mismo estado), nada se envia", "51219",
                      Error(() => Exec(cn, "DECLARE @id int, @r bit, @c adm.SolicitudCategoriaTipo; EXEC adm.usp_SolicitudCambio_Crear @Usuario = N'SORIANA\\mod1', @Rol = 'MOD', " +
                                           "@Llave = '" + Guid.NewGuid() + "', @Codigo = N'PRB 2026-000114', @Motivo = N'm', @Categorias = @c, @IdSolicitud = @id OUTPUT, " +
                                           "@Repetida = @r OUTPUT, @Tipo = 'ESTADO', @EstadoNuevo = N'Cerrado'")));

            // ---------------- F: falla = nada ----------------
            var f1 = Enviar(alm, "folio", "PRB 2026-000121", "tipo", "varios", "estado_nuevo", "Cerrado",
                            "agregar_categoria", "/A/Cat 2", "agregar_pct", "10");
            var cls = new List<ClasificacionSolicitud> { new ClasificacionSolicitud { Categoria = "/A/Cat 2", TipoIniciativa = "Problem", TipoAgrupado = "Problem" } };
            if (alm.Detalle(f1)["sin_clasificar"].ToString() == "0") cls = null;
            var antesF = Problem("PRB 2026-000121");
            var evF = EventosFecha("PRB 2026-000121");
            using (var cn = Abrir(Base)) Exec(cn, "UPDATE dbo.Categorias SET VigenteEnOrigen = 0 WHERE RutaCompleta = N'/A/Cat 2'");
            Check("F1 falla dentro de Modificar (51015): ni Estado ni FechaCierre; sin eventos; PENDIENTE con 1 intento",
                  "51015|" + antesF + "|" + evF + "||PENDIENTE|1",
                  Error(() => aplicador.Aplicar(f1, ADM, null, cls, Hoy)) + "|" + Problem("PRB 2026-000121") + "|" + EventosFecha("PRB 2026-000121") + "|" +
                  EventosEstado(f1) + "|" + alm.Detalle(f1)["estado"] + "|" + alm.Detalle(f1)["intentos"]);
            using (var cn = Abrir(Base)) Exec(cn, "UPDATE dbo.Categorias SET VigenteEnOrigen = 1 WHERE RutaCompleta = N'/A/Cat 2'");
            aplicador.Aplicar(f1, ADM, null, cls, Hoy);
            Check("F2 corregida la causa, reintentar la aplica entera, con FechaCierre = hoy", "Cerrado|" + HoyIso + "|APLICADA|2026-11-30~" + HoyIso,
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000121'") + "|" + FCierre("PRB 2026-000121") + "|" + alm.Detalle(f1)["estado"] + "|" + EventosFC(f1));

            // ---------------- V: FechaCierre vacia no se puede pedir ----------------
            using (var cn = Abrir(Base))
            {
                Func<string, string> crear = extra => Error(() => Exec(cn,
                    "DECLARE @id int, @r bit, @c adm.SolicitudCategoriaTipo; EXEC adm.usp_SolicitudCambio_Crear @Usuario = N'SORIANA\\mod1', @Rol = 'MOD', " +
                    "@Llave = '" + Guid.NewGuid() + "', @Codigo = N'PRB 2026-000133', @Motivo = N'm', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT, " + extra));
                Check("V1 vaciar FechaCierre por solicitud no existe: ESTADO con CampoFecha sin fecha y VARIOS con bandera sin fecha se niegan",
                      "51214|51214",
                      crear("@Tipo = 'ESTADO', @EstadoNuevo = N'Cerrado', @CampoFecha = 'FechaCierre'") + "|" +
                      crear("@Tipo = 'VARIOS', @EstadoNuevo = N'Cerrado', @CambiaFCierre = 1"));
            }

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
                Check("B1 rollback: Aplicar vuelve EXACTO a sql/34; Modificar sin cambio", "sin error|" + Aplicar34 + "|" + Modificar24,
                      LotesError(cn, rb40) + "|" + Hash("adm.usp_SolicitudCambio_Aplicar") + "|" + Hash("adm.usp_GestionAdmin_Modificar"));
            Check("B2 lo ya aplicado se queda", HoyIso, FCierre("PRB 2026-000101"));
            var b1 = Cerrar(alm, "PRB 2026-000132");
            aplicador.Aplicar(b1, ADM, null, null, Hoy);
            Check("B3 deshecha: cerrar desde En Monitoreo vuelve a dejar la fecha compromiso", "Cerrado|2026-11-30",
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000132'") + "|" + FCierre("PRB 2026-000132"));
            using (var cn = Abrir(Base))
            {
                Check("B4 rollback otra vez: se niega sin tocar nada", "True|" + Aplicar34,
                      LotesError(cn, rb40).Contains("ya deshecho") + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
                Check("B5 volver a aplicar 40", "sin error|" + hAplicar40, LotesError(cn, sql40) + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
            }
            var b2 = Cerrar(alm, "PRB 2026-000133");
            aplicador.Aplicar(b2, ADM, null, null, Hoy);
            Check("B6 re-aplicada: el cierre vuelve a poner hoy", "Cerrado|" + HoyIso,
                  Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000133'") + "|" + FCierre("PRB 2026-000133"));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(b25); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("aviso: no se pudo borrar: " + ex.Message); }
        }
        Console.WriteLine(fallos == 0 ? "TODO PASO (" + pasados + ")" : fallos + " FALLO(S), " + pasados + " pasaron");
        return fallos == 0 ? 0 : 1;
    }
}
