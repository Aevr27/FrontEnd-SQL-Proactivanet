// Prueba de INTEGRACION de sql/22_solicitudes_cambio.sql (+ _permisos y
// _rollback) con App_Code/SolicitudCambioAdmin.cs (AlmacenSolicitudesCambioSql
// y AplicadorSolicitudCambio), contra bases REALES pero DESECHABLES de SQL
// Server LocalDB: crea GestionAdminPrueba_Sol<n>, aplica la replica
// (tools/tests/GestionAdminLocalDb_replica.sql), el cargador 174bb51, las
// vistas del backend, sql/18, 20, 21 (la VM hoy) y sql/22 + permisos; corre
// los casos y BORRA las bases al final. Nunca toca la VM ni
// Tickets_Proactivanet.
//
// La validacion C# de la aplicacion (ValidacionAplicar.ComoEdicionDirecta)
// lee el catalogo del sitio por la cadena de Web.config: aqui se reemplaza
// por una que siempre pasa (la regla de cuando se registra la falla se
// prueba en SolicitudesCambioHttpSmoke). La base vuelve a validar todo en
// adm.usp_GestionAdmin_Modificar.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otro nombre de base), ya aplicada, hashes.
//   E  enviar: anteriores leidos de la base, etapa, no toca la iniciativa,
//      misma llave, dos envios simultaneos, rechazos de formato de la base,
//      clasificacion derivada / sin resolver.
//   A  aplicar: Estado + fecha, historial (fechas y Estado) con
//      SolicitudId, quien envio / quien aplico, ADM la suya, dos ADM a la
//      vez, ya revisada.
//   D  desactualizada (varias pendientes por iniciativa).
//   F  falla al aplicar (tope): sigue PENDIENTE, registrada, todo o nada,
//      reintento.
//   K  clasificacion de ADM: falta, invalida, de mas, buena.
//   R  rechazo con comentario.
//   M  edicion directa (EscritorGestionAdminSql) sin cambios: historial sin
//      SolicitudId.
//   P  permisos: la cuenta del sitio no escribe las tablas a mano; si por
//      los procedimientos.
//   B  rollback (se niega con solicitudes; con la bandera vuelve a sql/21) y
//      volver a aplicar.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class SolicitudesCambioSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Modificar21 = "0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3";
    static readonly DateTime Hoy = new DateTime(2026, 10, 19);
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
    // Corre un script que debe negarse: el mensaje del primer error.
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
            Lotes(cn, Leer("sql", "18_gestion_admin_persistencia.sql"));
            Lotes(cn, Leer("sql", "20_gestion_admin_duenos.sql"));
            Lotes(cn, Leer("sql", "21_gestion_admin_agrupacion_acentos.sql"));
            // La cuenta del sitio, como en la VM (sin login: EXECUTE AS USER).
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD];");
            Exec(cn, @"
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1), (N'c3', N'/B/Cat 3', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, FechaAnalisis, FechaSolucion, FechaCierre) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'En Soluci" + "\u00f3" + @"n', NULL, '2026-08-01', '2026-11-15', '2026-12-20'),
 (N'PRB 2026-000002', N'Problem', N'Dos', N'En An" + "\u00e1" + @"lisis', NULL, '2026-09-01', NULL, NULL),
 (N'PRB 2026-000003', N'Problem', N'Tres', N'En Monitoreo', N'Solucionado', NULL, NULL, '2026-12-01'),
 (N'MAP 2026-000004', N'Problem', N'Cuatro', N'En An" + "\u00e1" + @"lisis', NULL, '2026-10-01', NULL, NULL),
 (N'PRB 2026-000005', N'Problem', N'Cinco', N'Cerrado', NULL, NULL, NULL, NULL);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/A/Cat 1', N'Problem', N'Problem', 0.3000, 1),
 (N'PRB 2026-000002', N'/A/Cat 2', N'Problem', N'Problem', 0.9500, 1);");
        }
    }

    static PeticionSolicitudCambio Peticion(params string[] kv)
    {
        var f = new NameValueCollection();
        for (var i = 0; i < kv.Length; i += 2) f.Add(kv[i], kv[i + 1]);
        if (f["llave"] == null) f["llave"] = Guid.NewGuid().ToString();
        var p = PeticionSolicitudCambio.DesdeFormulario(f);
        if (!p.Valida) throw new InvalidOperationException("peticion de prueba invalida: " + string.Join("; ", p.Errores.Select(e => e.Mensaje).ToArray()));
        return p;
    }

    static int ErrorDe(Action a)
    {
        try { a(); return 0; }
        catch (ErrorSolicitudCambio ex) { return ex.Numero; }
    }

    static List<Dictionary<string, object>> Cats(Dictionary<string, object> d)
    {
        return ((List<object>)d["categorias_detalle"]).Cast<Dictionary<string, object>>().ToList();
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        Base = "GestionAdminPrueba_Sol" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var guarda = "SolGuarda22_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql22 = Leer("sql", "22_solicitudes_cambio.sql");
        var rb22 = Leer("sql", "22_solicitudes_cambio_rollback.sql");
        var perm22 = Leer("sql", "22_solicitudes_cambio_permisos.sql");
        try
        {
            Preparar(Base);
            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
            {
                var r = LotesError(g, sql22);
                Check("G1 otra base sin aprobar: se niega", true, r.Contains("SIN APROBAR"));
            }
            Borrar(guarda);
            using (var cn = Abrir(Base))
            {
                Check("G2 sql/21 en la base antes (precondicion)", Modificar21,
                      Uno("SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Modificar')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)"));
                Lotes(cn, sql22);
                Check("G3 sql/22 aplicada: 3 tablas, 4 procedimientos de solicitudes, 2 tipos", "3|4|2",
                      Uno("SELECT CONVERT(varchar(3), (SELECT COUNT(*) FROM sys.tables WHERE SCHEMA_NAME(schema_id) = 'adm' AND name LIKE 'SolicitudCambio%')) + '|' + " +
                          "CONVERT(varchar(3), (SELECT COUNT(*) FROM sys.procedures WHERE SCHEMA_NAME(schema_id) = 'adm' AND name LIKE 'usp_SolicitudCambio%')) + '|' + " +
                          "CONVERT(varchar(3), (SELECT COUNT(*) FROM sys.table_types WHERE SCHEMA_NAME(schema_id) = 'adm' AND name LIKE 'Solicitud%'))"));
                Check("G4 aplicarla otra vez se niega sin tocar nada", true, LotesError(cn, sql22).Contains("ya aplicada"));
                Lotes(cn, perm22);
            }

            var alm = new AlmacenSolicitudesCambioSql(delegate { return Abrir(Base); });
            var aplicador = new AplicadorSolicitudCambio(alm, delegate { return new ValidacionAplicar { Valida = true }; });
            Func<string> problem1 = () => Uno("SELECT Estado + '|' + CONVERT(char(10), FechaAnalisis, 23) + '|' + CONVERT(char(10), FechaSolucion, 23) + '|' + CONVERT(char(10), FechaCierre, 23) FROM dbo.Problem WHERE Codigo = N'PRB 2026-000001'");
            var antes1 = problem1();

            // ---------------- E: enviar ----------------
            var llave = Guid.NewGuid().ToString();
            var pe = Peticion("folio", "PRB 2026-000001", "llave", llave, "tipo", "estado", "estado_nuevo", "En Monitoreo",
                              "campo_fecha", "f_solucion", "fecha_nueva", "2026-12-05", "motivo", "Pasa a monitoreo; la solucion se extiende");
            var e1 = alm.Enviar(pe, @"SORIANA\mod1", "MOD");
            var d1 = alm.Detalle(e1.IdSolicitud);
            Check("E1 Estado + fecha: PENDIENTE, anteriores leidos de la base, etapa Solucion", "PENDIENTE|En Soluci\u00f3n|2026-11-15|FechaSolucion|Soluci\u00f3n|False",
                  d1["estado"] + "|" + d1["estado_anterior"] + "|" + d1["fecha_anterior"] + "|" + d1["campo_fecha"] + "|" + d1["etapa"] + "|" + d1["desactualizada"]);
            Check("E2 enviar NO toca la iniciativa", antes1, problem1());
            var e2 = alm.Enviar(pe, @"SORIANA\mod1", "MOD");
            Check("E3 misma llave: la misma solicitud, Repetida, sin otra fila", e1.IdSolicitud + "|True|1",
                  e2.IdSolicitud + "|" + e2.Repetida + "|" + Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE LlaveIdempotencia = '" + llave + "'"));
            var e3 = alm.Enviar(pe, @"SORIANA\otro", "MOD");
            Check("E4 la misma llave de OTRO usuario es otra solicitud", true, e3.IdSolicitud != e1.IdSolicitud);

            // Dos envios simultaneos con la misma llave: se bloquea la tabla y se sueltan juntos.
            var llaveC = Guid.NewGuid().ToString();
            var pc = Peticion("folio", "PRB 2026-000003", "llave", llaveC, "tipo", "otros", "motivo", "doble clic");
            var ids = new int[2]; var errs = new string[2];
            using (var bloqueo = Abrir(Base))
            {
                var tx = bloqueo.BeginTransaction();
                using (var c = new SqlCommand("SELECT TOP (0) 1 FROM adm.SolicitudCambio WITH (TABLOCKX, HOLDLOCK)", bloqueo, tx)) c.ExecuteNonQuery();
                var hilos = Enumerable.Range(0, 2).Select(i => new Thread(() =>
                {
                    try { ids[i] = alm.Enviar(pc, @"SORIANA\mod9", "MOD").IdSolicitud; } catch (Exception ex) { errs[i] = ex.Message; }
                })).ToList();
                hilos.ForEach(h => h.Start());
                Thread.Sleep(1500);
                tx.Commit();
                hilos.ForEach(h => h.Join());
            }
            Check("E5 dos envios simultaneos, misma llave: una fila, el mismo numero, sin error", "1|True|True",
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE LlaveIdempotencia = '" + llaveC + "'") + "|" + (ids[0] == ids[1] && ids[0] > 0) + "|" + (errs[0] == null && errs[1] == null));

            var rechazos = new Dictionary<string, Func<PeticionSolicitudCambio>>
            {
                { "51218 misma fecha", () => Peticion("folio", "PRB 2026-000001", "tipo", "fecha", "campo_fecha", "f_cierre", "fecha_nueva", "2026-12-20", "motivo", "m") },
                { "51219 mismo Estado", () => Peticion("folio", "PRB 2026-000001", "tipo", "estado", "estado_nuevo", "En Soluci\u00f3n", "motivo", "m") },
                { "51013 Estado que no existe", () => Peticion("folio", "PRB 2026-000001", "tipo", "estado", "estado_nuevo", "Pausado", "motivo", "m") },
                { "51217 Subestado que no existe", () => Peticion("folio", "PRB 2026-000001", "tipo", "estado", "estado_nuevo", "Cerrado", "subestado_nuevo", "Otro", "motivo", "m") },
                { "51006 iniciativa que no existe", () => Peticion("folio", "PRB 2099-000001", "tipo", "otros", "motivo", "m") },
                { "51007 % de una no ligada", () => Peticion("folio", "PRB 2026-000001", "tipo", "categorias", "pct_categoria", "/B/Cat 3", "pct_valor", "20", "motivo", "m") },
                { "51008 agregar una ligada", () => Peticion("folio", "PRB 2026-000001", "tipo", "categorias", "agregar_categoria", "/A/Cat 1", "agregar_pct", "20", "motivo", "m") },
                { "51015 agregar fuera del catalogo", () => Peticion("folio", "PRB 2026-000001", "tipo", "categorias", "agregar_categoria", "/Z/Nada", "agregar_pct", "20", "motivo", "m") },
                { "51220 mismo %", () => Peticion("folio", "PRB 2026-000001", "tipo", "categorias", "pct_categoria", "/A/Cat 1", "pct_valor", "30", "motivo", "m") },
            };
            var filasAntes = Uno("SELECT COUNT(*) FROM adm.SolicitudCambio");
            foreach (var kv in rechazos)
            {
                var n = ErrorDe(() => alm.Enviar(kv.Value(), @"SORIANA\mod1", "MOD"));
                Check("E6 la base rechaza: " + kv.Key, kv.Key.Substring(0, 5), n);
            }
            Check("E6 ningun rechazo dejo filas", filasAntes, Uno("SELECT COUNT(*) FROM adm.SolicitudCambio"));
            Check("E7 rol que no es ADM ni MOD: 51210 (403)", "51210|403",
                  (ErrorDe(() => alm.Enviar(Peticion("folio", "PRB 2026-000001", "tipo", "otros", "motivo", "m"), @"SORIANA\x", "VWR"))) + "|" +
                  new ErrorSolicitudCambio(51210, "", null).EstadoHttp);

            var pcat = Peticion("folio", "PRB 2026-000001", "tipo", "categorias", "pct_categoria", "/A/Cat 1", "pct_valor", "40",
                                "agregar_categoria", "/A/Cat 2", "agregar_pct", "10", "motivo", "Se ajusta el alcance");
            var ecat = alm.Enviar(pcat, @"SORIANA\adm1", "ADM");
            var cats = Cats(alm.Detalle(ecat.IdSolicitud));
            Check("E8 categorias: PCT con su % anterior; AGREGAR con la clasificacion del prefijo PRB", "PCT|30|40|null|AGREGAR|10|Problem|Problem",
                  string.Join("|", new[] { cats.First(c => (string)c["accion"] == "PCT"), cats.First(c => (string)c["accion"] == "AGREGAR") }
                      .SelectMany(c => (string)c["accion"] == "PCT"
                          ? new[] { "PCT", (string)c["pct_anterior"], (string)c["pct_nuevo"], (string)c["tipo_iniciativa"] ?? "null" }
                          : new[] { "AGREGAR", (string)c["pct_nuevo"], (string)c["tipo_iniciativa"], (string)c["tipo_agrupado"] }).ToArray()));
            var pmap = Peticion("folio", "MAP 2026-000004", "tipo", "categorias", "agregar_categoria", "/B/Cat 3", "agregar_pct", "15", "motivo", "Nueva categoria");
            Check("E9 MAP: la regla da Mejora Aplicativo / Mejora", "Mejora Aplicativo|Mejora", pmap.Categorias[0].TipoIniciativa + "|" + pmap.Categorias[0].TipoAgrupado);
            var emap = alm.Enviar(pmap, @"SORIANA\mod1", "MOD");
            var dmap = alm.Detalle(emap.IdSolicitud);
            Check("E10 ... pero esos valores no existen en la base: se guarda SIN clasificacion (sin_clasificar 1), no se inventa", "1|null|null",
                  dmap["sin_clasificar"] + "|" + ((string)Cats(dmap)[0]["tipo_iniciativa"] ?? "null") + "|" + ((string)Cats(dmap)[0]["tipo_agrupado"] ?? "null"));

            // ---------------- A: aplicar ----------------
            var ultF = Uno("SELECT ISNULL(MAX(IdEvento), 0) FROM dbo.ProblemFechaEvento");
            var ultE = Uno("SELECT ISNULL(MAX(IdEvento), 0) FROM dbo.ProblemEstadoEvento");
            // Otra pendiente sobre la MISMA iniciativa y fecha (se permiten varias).
            var pOtra = Peticion("folio", "PRB 2026-000001", "tipo", "fecha", "campo_fecha", "f_solucion", "fecha_nueva", "2027-01-31", "motivo", "Otra extension");
            var eOtra = alm.Enviar(pOtra, @"SORIANA\mod2", "MOD");
            Check("A0 dos pendientes sobre la misma iniciativa se permiten", "PENDIENTE|PENDIENTE",
                  alm.Detalle(e1.IdSolicitud)["estado"] + "|" + alm.Detalle(eOtra.IdSolicitud)["estado"]);
            Check("A1 aplicar (validacion + base): sin respuesta de error", "null", aplicador.Aplicar(e1.IdSolicitud, @"SORIANA\adm2", "ok", null, Hoy) == null ? "null" : "error");
            Check("A2 Estado y SOLO la fecha de Solucion cambian", "En Monitoreo|2026-08-01|2026-12-05|2026-12-20", problem1());
            var da = alm.Detalle(e1.IdSolicitud);
            Check("A3 APLICADA; quien envio y quien aplico, aparte; Intentos 1", "APLICADA|SORIANA\\mod1|SORIANA\\adm2|1",
                  da["estado"] + "|" + da["solicitado_por"] + "|" + da["revisado_por"] + "|" + da["intentos"]);
            Check("A4 historial de fecha con SolicitudId y el revisor", "1",
                  Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE IdEvento > " + ultF + " AND Codigo = N'PRB 2026-000001' AND Campo = 'FechaSolucion' AND SolicitudId = " + e1.IdSolicitud + " AND Usuario = N'SORIANA\\adm2' AND Origen = 'ADMIN'"));
            Check("A5 historial de Estado con SolicitudId", "1",
                  Uno("SELECT COUNT(*) FROM dbo.ProblemEstadoEvento WHERE IdEvento > " + ultE + " AND Codigo = N'PRB 2026-000001' AND SolicitudId = " + e1.IdSolicitud));
            Check("A6 eventos: ENVIADA, APLICADA", "ENVIADA,APLICADA",
                  string.Join(",", ((List<object>)da["eventos"]).Cast<Dictionary<string, object>>().Select(x => (string)x["evento"]).ToArray()));
            Check("A7 aplicar dos veces: 51202 (409) y sin otro intento", "51202|1",
                  ErrorDe(() => aplicador.Aplicar(e1.IdSolicitud, @"SORIANA\adm3", null, null, Hoy)) + "|" + alm.Detalle(e1.IdSolicitud)["intentos"]);

            // ADM aplica la suya.
            var pPropia = Peticion("folio", "PRB 2026-000003", "tipo", "fecha", "campo_fecha", "f_cierre", "fecha_nueva", "2027-02-01", "motivo", "La mia");
            var ePropia = alm.Enviar(pPropia, @"SORIANA\adm1", "ADM");
            aplicador.Aplicar(ePropia.IdSolicitud, @"SORIANA\adm1", null, null, Hoy);
            var dp = alm.Detalle(ePropia.IdSolicitud);
            Check("A8 ADM aplica la suya (pruebas): APLICADA, solicitante y revisor la misma cuenta y los dos guardados", "APLICADA|SORIANA\\adm1|ADM|SORIANA\\adm1",
                  dp["estado"] + "|" + dp["solicitado_por"] + "|" + dp["rol_solicitante"] + "|" + dp["revisado_por"]);

            // Dos ADM a la vez sobre la misma: se bloquea la fila y se sueltan juntos.
            var pDos = Peticion("folio", "PRB 2026-000002", "tipo", "fecha", "campo_fecha", "f_analisis", "fecha_nueva", "2026-12-15", "motivo", "dos ADM");
            var eDos = alm.Enviar(pDos, @"SORIANA\mod1", "MOD");
            var res = new int[2];
            using (var bloqueo = Abrir(Base))
            {
                var tx = bloqueo.BeginTransaction();
                using (var c = new SqlCommand("SELECT Estado FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK) WHERE IdSolicitud = " + eDos.IdSolicitud, bloqueo, tx)) c.ExecuteScalar();
                var hilos = Enumerable.Range(0, 2).Select(i => new Thread(() =>
                {
                    res[i] = ErrorDe(() => alm.Aplicar(eDos.IdSolicitud, @"SORIANA\adm" + (5 + i), null, null, Hoy));
                })).ToList();
                hilos.ForEach(h => h.Start());
                Thread.Sleep(1500);
                tx.Commit();
                hilos.ForEach(h => h.Join());
            }
            var dDos = alm.Detalle(eDos.IdSolicitud);
            Check("A9 dos ADM aplican a la vez: uno gana, el otro 51202; un solo APLICADA e Intentos 1", "0,51202|APLICADA|1|1",
                  string.Join(",", res.OrderBy(x => x).Select(x => x.ToString()).ToArray()) + "|" + dDos["estado"] + "|" + dDos["intentos"] + "|" +
                  ((List<object>)dDos["eventos"]).Cast<Dictionary<string, object>>().Count(x => (string)x["evento"] == "APLICADA"));

            // ---------------- D: desactualizada ----------------
            var dO = alm.Detalle(eOtra.IdSolicitud);
            Check("D1 la otra pendiente ya se ve desactualizada en el detalle (lectura)", true, dO["desactualizada"]);
            Check("D2 aplicarla: 51204 (409), no aplica", "51204|409",
                  ErrorDe(() => aplicador.Aplicar(eOtra.IdSolicitud, @"SORIANA\adm2", null, null, Hoy)) + "|" + new ErrorSolicitudCambio(51204, "", null).EstadoHttp);
            dO = alm.Detalle(eOtra.IdSolicitud);
            Check("D3 sigue PENDIENTE, Intentos 1, UltimoError con el motivo, evento DESACTUALIZADA; la fecha no cambio", "PENDIENTE|1|True|True|2026-12-05",
                  dO["estado"] + "|" + dO["intentos"] + "|" + ((string)dO["ultimo_error"]).StartsWith("51204:") + "|" +
                  ((List<object>)dO["eventos"]).Cast<Dictionary<string, object>>().Any(x => (string)x["evento"] == "DESACTUALIZADA") + "|" +
                  Uno("SELECT CONVERT(char(10), FechaSolucion, 23) FROM dbo.Problem WHERE Codigo = N'PRB 2026-000001'"));

            // ---------------- F: falla al aplicar ----------------
            Check("F1 tope rebasado (/A/Cat 2 ya al 95%): 51010", 51010, ErrorDe(() => aplicador.Aplicar(ecat.IdSolicitud, @"SORIANA\adm2", null, null, Hoy)));
            var df = alm.Detalle(ecat.IdSolicitud);
            Check("F2 sigue PENDIENTE, registrada (FALLO_APLICAR); todo o nada: ni el % ni la categoria nueva", "PENDIENTE|1|True|0.3000|0",
                  df["estado"] + "|" + df["intentos"] + "|" + ((List<object>)df["eventos"]).Cast<Dictionary<string, object>>().Any(x => (string)x["evento"] == "FALLO_APLICAR") + "|" +
                  Uno("SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/A/Cat 1'") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/A/Cat 2'"));
            using (var cn = Abrir(Base)) Exec(cn, "UPDATE dbo.ProblemCategoria SET PctDisminucion = 0.5 WHERE Codigo = N'PRB 2026-000002'");
            aplicador.Aplicar(ecat.IdSolicitud, @"SORIANA\adm2", null, null, Hoy);
            df = alm.Detalle(ecat.IdSolicitud);
            Check("F3 reintento tras liberar el tope: APLICADA, Intentos 2, UltimoError limpio, % y categoria nueva", "APLICADA|2|NULL|0.4000|0.1000",
                  df["estado"] + "|" + df["intentos"] + "|" + (df["ultimo_error"] ?? "NULL") + "|" +
                  Uno("SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/A/Cat 1'") + "|" +
                  Uno("SELECT PctDisminucion FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/A/Cat 2'"));

            // ---------------- K: clasificacion de ADM ----------------
            var rk = aplicador.Aplicar(emap.IdSolicitud, @"SORIANA\adm2", null, null, Hoy);
            var dk = alm.Detalle(emap.IdSolicitud);
            Check("K1 sin clasificacion: FaltaClasificacion (409), registrada, PENDIENTE, sin ligar", "FaltaClasificacion|409|PENDIENTE|1|True|0",
                  rk["tipo"] + "|" + rk["estado_http"] + "|" + dk["estado"] + "|" + dk["intentos"] + "|" + ((string)dk["ultimo_error"]).StartsWith("51221:") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'MAP 2026-000004'"));
            Check("K2 clasificacion con valores que no existen: 51011 de Modificar, registrada; nada cambia", "51011|2|0",
                  ErrorDe(() => aplicador.Aplicar(emap.IdSolicitud, @"SORIANA\adm2", null,
                      new List<ClasificacionSolicitud> { new ClasificacionSolicitud { Categoria = "/B/Cat 3", TipoIniciativa = "Inventado", TipoAgrupado = "Problem" } }, Hoy))
                  + "|" + alm.Detalle(emap.IdSolicitud)["intentos"] + "|" + Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'MAP 2026-000004'"));
            Check("K3 clasificacion de una categoria que no la necesita: 51222, sin contar intento", "51222|2",
                  ErrorDe(() => alm.Aplicar(emap.IdSolicitud, @"SORIANA\adm2", null,
                      new List<ClasificacionSolicitud> { new ClasificacionSolicitud { Categoria = "/A/Cat 1", TipoIniciativa = "Problem", TipoAgrupado = "Problem" } }, Hoy))
                  + "|" + alm.Detalle(emap.IdSolicitud)["intentos"]);
            Check("K4 clasificacion incompleta: 51223", 51223,
                  ErrorDe(() => alm.Aplicar(emap.IdSolicitud, @"SORIANA\adm2", null,
                      new List<ClasificacionSolicitud> { new ClasificacionSolicitud { Categoria = "/B/Cat 3", TipoIniciativa = "Problem" } }, Hoy)));
            aplicador.Aplicar(emap.IdSolicitud, @"SORIANA\adm2", null,
                new List<ClasificacionSolicitud> { new ClasificacionSolicitud { Categoria = "/B/Cat 3", TipoIniciativa = "Problem", TipoAgrupado = "Problem" } }, Hoy);
            dk = alm.Detalle(emap.IdSolicitud);
            Check("K5 con clasificacion valida: APLICADA, queda en la solicitud y en el evento; categoria ligada con ella", "APLICADA|Problem|True|Problem|Problem",
                  dk["estado"] + "|" + Cats(dk)[0]["tipo_iniciativa"] + "|" +
                  ((List<object>)dk["eventos"]).Cast<Dictionary<string, object>>().Last()["detalle"].ToString().Contains("Clasificacion elegida por ADM") + "|" +
                  Uno("SELECT TipoIniciativa FROM dbo.ProblemCategoria WHERE Codigo = N'MAP 2026-000004' AND Categoria = N'/B/Cat 3'") + "|" +
                  Uno("SELECT TipoAgrupado FROM dbo.ProblemCategoria WHERE Codigo = N'MAP 2026-000004' AND Categoria = N'/B/Cat 3'"));

            // ---------------- R: rechazo ----------------
            var pR = Peticion("folio", "PRB 2026-000002", "tipo", "otros", "motivo", "Categoria equivocada");
            var eR = alm.Enviar(pR, @"SORIANA\mod1", "MOD");
            Check("R1 rechazo sin comentario: 51207 (422), sigue PENDIENTE", "51207|422|PENDIENTE",
                  ErrorDe(() => alm.Rechazar(eR.IdSolicitud, @"SORIANA\adm2", "  ")) + "|" + new ErrorSolicitudCambio(51207, "", null).EstadoHttp + "|" + alm.Detalle(eR.IdSolicitud)["estado"]);
            alm.Rechazar(eR.IdSolicitud, @"SORIANA\adm2", "No procede");
            var dr = alm.Detalle(eR.IdSolicitud);
            Check("R2 rechazada con comentario y revisor; evento RECHAZADA", "RECHAZADA|No procede|SORIANA\\adm2|True",
                  dr["estado"] + "|" + dr["comentario_revision"] + "|" + dr["revisado_por"] + "|" +
                  ((List<object>)dr["eventos"]).Cast<Dictionary<string, object>>().Any(x => (string)x["evento"] == "RECHAZADA"));
            Check("R3 rechazar o aplicar una rechazada: 51202", "51202|51202",
                  ErrorDe(() => alm.Rechazar(eR.IdSolicitud, @"SORIANA\adm2", "otra vez")) + "|" + ErrorDe(() => aplicador.Aplicar(eR.IdSolicitud, @"SORIANA\adm2", "x", null, Hoy)));
            Check("R4 registrar falla de una revisada: 51202", 51202, ErrorDe(() => alm.RegistrarFallo(eR.IdSolicitud, @"SORIANA\adm2", 1, "x")));

            // ---------------- M: edicion directa ----------------
            var plan = new PlanModificarAdmin { Codigo = "PRB 2026-000003", Hoy = Hoy };
            plan.Problem[PeticionModificarAdmin.CFCierre] = "2027-03-15";
            using (var cn = Abrir(Base)) new EscritorGestionAdminSql().Modificar(cn, null, plan, @"SORIANA\adm1");
            Check("M1 la edicion directa de ADM sigue igual: guarda y su historial NO lleva SolicitudId", "2027-03-15|NULL|SORIANA\\adm1",
                  Uno("SELECT CONVERT(char(10), FechaCierre, 23) FROM dbo.Problem WHERE Codigo = N'PRB 2026-000003'") + "|" +
                  Uno("SELECT TOP (1) SolicitudId FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000003' ORDER BY IdEvento DESC") + "|" +
                  Uno("SELECT TOP (1) Usuario FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000003' ORDER BY IdEvento DESC"));

            // ---------------- P: permisos de la cuenta del sitio ----------------
            var sitio = new AlmacenSolicitudesCambioSql(delegate
            {
                var cn = Abrir(Base);
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                return cn;
            });
            var eSitio = sitio.Enviar(Peticion("folio", "PRB 2026-000002", "tipo", "otros", "motivo", "como el sitio"), @"SORIANA\mod1", "MOD");
            Check("P1 como PROACTIVANETAD: envia, lista y lee el detalle por los procedimientos", "True|True|PENDIENTE",
                  (eSitio.IdSolicitud > 0) + "|" + sitio.Listar("PENDIENTE", 50).Any(x => (int)x["id"] == eSitio.IdSolicitud) + "|" + sitio.Detalle(eSitio.IdSolicitud)["estado"]);
            string directo;
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                var errs2 = new List<string>();
                foreach (var s in new[] {
                    "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia) VALUES (N'PRB 2026-000002', 'OTROS', N'm', N'SORIANA\\otro', 'ADM', NEWID())",
                    "UPDATE adm.SolicitudCambio SET Estado = 'APLICADA', RevisadoPor = N'x', FechaRevisionUtc = SYSUTCDATETIME() WHERE IdSolicitud = " + eSitio.IdSolicitud,
                    "DELETE adm.SolicitudCambioEvento" })
                {
                    try { Exec(cn, s); errs2.Add("0"); } catch (SqlException ex) { errs2.Add(ex.Number.ToString()); }
                }
                directo = string.Join(",", errs2.ToArray());
            }
            Check("P2 como PROACTIVANETAD NO escribe las tablas a mano (INSERT, UPDATE, DELETE: 229)", "229,229,229", directo);

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                string diag;
                try { Lotes(cn, Leer("sql", "diag_solicitudes_cambio.sql")); diag = "corre"; } catch (SqlException ex) { diag = ex.Message; }
                Check("B0 el diag (solo lectura) corre con solicitudes guardadas", "corre", diag);
                Check("B1 rollback con solicitudes guardadas: se niega", true, LotesError(cn, rb22).Contains("solicitudes guardadas"));
                Exec(cn, "EXEC sys.sp_set_session_context N'rollback_22_borrar_solicitudes', N'SI';");
                Lotes(cn, rb22);
                Check("B2 con la bandera: Modificar vuelve EXACTO a sql/21, sin objetos de 22", Modificar21 + "|0",
                      Uno("SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Modificar')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)") + "|" +
                      Uno("SELECT COUNT(*) FROM sys.objects WHERE SCHEMA_NAME(schema_id) = 'adm' AND name LIKE '%SolicitudCambio%'"));
                Lotes(cn, sql22);
                Check("B3 volver a aplicar sql/22 despues del rollback", "1", Uno("SELECT COUNT(*) FROM sys.tables WHERE SCHEMA_NAME(schema_id) = 'adm' AND name = 'SolicitudCambio'"));
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
