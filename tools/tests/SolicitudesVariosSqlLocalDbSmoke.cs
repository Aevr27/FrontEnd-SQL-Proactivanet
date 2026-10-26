// Prueba de INTEGRACION de sql/34_solicitudes_cambio_varios.sql (+ _rollback)
// con el almacen real de solicitudes (AlmacenSolicitudesCambioSql, con
// PersistenciaSolicitudesCambio.SolicitaVarios forzado en la prueba), contra
// bases REALES pero DESECHABLES de SQL Server LocalDB: crea
// GestionAdminPrueba_S34<n>, aplica la replica, el cargador 174bb51, las
// vistas del backend, sql/18, 20, 21, 22 + permisos, 23, 24 y 25, corre los
// casos y BORRA las bases al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base), exige sql/25 antes, hashes y firma,
//      ya aplicada, Modificar sin cambio, el rollback de 25 se niega encima.
//   X  DeteccionSolicitudesCambio (sin forzar, como la cuenta del sitio):
//      antes de 34, con 34 y con 34 deshecha.
//   K  compatibilidad: el sitio sin el interruptor (sin los parametros
//      nuevos) envia y aplica FECHA y Estado + fecha igual que antes.
//   V  VARIOS: enviar guarda el "anterior" de cada cambio sin tocar la
//      iniciativa; aplicar los aplica TODOS (una llamada a Modificar, con
//      su historial); rechazar no aplica ninguno; desactualizada (51204) y
//      una falla DENTRO de Modificar (51015) no dejan NADA aplicado y la
//      solicitud sigue PENDIENTE; reintento con la misma llave no duplica;
//      aplicar dos veces no aplica dos veces (51202); reglas de forma (51214,
//      51218, 51219) y CHECK de la tabla.
//   C  dos ADM a la vez sobre la MISMA solicitud: carrera forzada con
//      bloqueos (los dos esperan de verdad), carreras libres repetidas y
//      aplicar contra rechazar. Una sola decision gana; nunca se aplica dos
//      veces ni a medias.
//   P  cuenta del sitio (EXECUTE AS PROACTIVANETAD): aplica VARIOS por
//      encadenamiento de propietario; no escribe la tabla a mano.
//   B  rollback: se niega con solicitudes VARIOS; en una base sin ellas,
//      Crear / Aplicar vuelven EXACTOS a sql/25, sin columnas; despues el
//      rollback de 25 ya puede; volver a aplicar 25 y 34.
//
//   --hashes  solo aplica sql/34 sin su postcondicion e imprime los hashes
//             de Crear / Aplicar para fijarlos en el script (y nada mas).
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

public static class SolicitudesVariosSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Crear25 = "0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203";
    const string Aplicar25 = "0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1";
    const string Modificar24 = "0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77";
    static readonly DateTime Hoy = new DateTime(2026, 10, 26);
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
    static string Hash(string db, string objeto)
    {
        return Uno(db, "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('" + objeto +
                   "')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)");
    }
    // -> "Activa|SolicitaDatosActiva|SolicitaVariosActiva", sin forzar.
    static string Detectar(string db, bool sitio)
    {
        var f = PersistenciaSolicitudesCambio.ForzadaParaPruebas;
        var fd = PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas;
        var fv = PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas;
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = null;
        PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = null;
        PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = null;
        PersistenciaSolicitudesCambio.OlvidarParaPruebas();
        try
        {
            using (var cn = Abrir(db))
            {
                if (sitio) Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                DeteccionSolicitudesCambio.Revisar(cn);
            }
            return PersistenciaSolicitudesCambio.Activa() + "|" + PersistenciaSolicitudesCambio.SolicitaDatosActiva() + "|" +
                   PersistenciaSolicitudesCambio.SolicitaVariosActiva();
        }
        finally
        {
            PersistenciaSolicitudesCambio.OlvidarParaPruebas();
            PersistenciaSolicitudesCambio.ForzadaParaPruebas = f;
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = fd;
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = fv;
        }
    }
    static string ParametrosCrear(string db) { return Uno(db, "SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_SolicitudCambio_Crear')"); }
    static string Columnas34(string db)
    {
        return Uno(db, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('adm.SolicitudCambio') AND name IN (N'CambiaFAnalisis', N'FAnalisisAnterior', " +
                       "N'FAnalisisNueva', N'CambiaFSolucion', N'FSolucionAnterior', N'FSolucionNueva', N'CambiaFCierre', N'FCierreAnterior', N'FCierreNueva')");
    }

    // La VM despues de sql/25 (22 + permisos, 23, 24, 25).
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
            Lotes(cn, Leer("sql", "22_solicitudes_cambio.sql"));
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            Lotes(cn, Leer("sql", "22_solicitudes_cambio_permisos.sql"));
            Lotes(cn, Leer("sql", "23_cambios_recientes.sql"));
            Lotes(cn, Leer("sql", "24_gestion_admin_modificar_duenos_quitar.sql"));
            Lotes(cn, Leer("sql", "25_solicitudes_cambio_datos.sql"));
            Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, FechaAnalisis, FechaSolucion, FechaCierre, OwnerProblem, OwnerServicio) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'En Soluci" + "\u00f3" + @"n', NULL, '2026-08-01', '2026-11-15', '2026-12-20', N'PO viejo', N'SO viejo'),
 (N'PRB 2026-000002', N'Problem', N'Dos', N'En An" + "\u00e1" + @"lisis', NULL, '2026-09-01', NULL, NULL, NULL, NULL),
 (N'PRB 2026-000003', N'Problem', N'Tres', N'En An" + "\u00e1" + @"lisis', NULL, '2026-09-01', NULL, NULL, N'PO tres', NULL),
 (N'PRB 2026-000004', N'Problem', N'Cuatro', N'En An" + "\u00e1" + @"lisis', NULL, '2026-09-01', NULL, NULL, NULL, NULL);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/A/Cat 1', N'Problem', N'Problem', 0.3000, 1),
 (N'PRB 2026-000002', N'/A/Cat 2', N'Problem', N'Problem', 0.5000, 1);");
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
        if (!p.Valida) throw new InvalidOperationException("formulario invalido: " + p.Errores[0].Mensaje);
        return alm.Enviar(p, @"SORIANA\mod1", "MOD").IdSolicitud;
    }

    // Estado|FAnalisis|FSolucion|FCierre|Titulo|% de /A/Cat 1|categorias ligadas
    static string Problem(string codigo)
    {
        return Uno("SELECT p.Estado + '|' + ISNULL(CONVERT(varchar(10), p.FechaAnalisis, 23), 'NULL') + '|' + ISNULL(CONVERT(varchar(10), p.FechaSolucion, 23), 'NULL') + '|' + " +
                   "ISNULL(CONVERT(varchar(10), p.FechaCierre, 23), 'NULL') + '|' + ISNULL(p.Titulo, 'NULL') + '|' + " +
                   "ISNULL((SELECT CONVERT(varchar(10), PctDisminucion) FROM dbo.ProblemCategoria WHERE Codigo = p.Codigo AND Categoria = N'/A/Cat 1'), 'NULL') + '|' + " +
                   "CONVERT(varchar(5), (SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = p.Codigo)) FROM dbo.Problem AS p WHERE p.Codigo = N'" + codigo + "'");
    }

    // Tipo|Estado|Estado ant>nuevo|FA b:ant>nueva|FS ...|FC ...|CambiaTitulo:ant>nuevo|CampoFecha
    static string Fila(int id)
    {
        return Uno("SELECT Tipo + '|' + Estado + '|' + ISNULL(EstadoAnterior, 'NULL') + '>' + ISNULL(EstadoNuevo, 'NULL') + '|' + " +
                   "CONVERT(varchar(1), CambiaFAnalisis) + ':' + ISNULL(CONVERT(varchar(10), FAnalisisAnterior, 23), 'NULL') + '>' + ISNULL(CONVERT(varchar(10), FAnalisisNueva, 23), 'NULL') + '|' + " +
                   "CONVERT(varchar(1), CambiaFSolucion) + ':' + ISNULL(CONVERT(varchar(10), FSolucionAnterior, 23), 'NULL') + '>' + ISNULL(CONVERT(varchar(10), FSolucionNueva, 23), 'NULL') + '|' + " +
                   "CONVERT(varchar(1), CambiaFCierre) + ':' + ISNULL(CONVERT(varchar(10), FCierreAnterior, 23), 'NULL') + '>' + ISNULL(CONVERT(varchar(10), FCierreNueva, 23), 'NULL') + '|' + " +
                   "CONVERT(varchar(1), CambiaTitulo) + ':' + ISNULL(TituloAnterior, 'NULL') + '>' + ISNULL(TituloNuevo, 'NULL') + '|' + ISNULL(CampoFecha, 'NULL') " +
                   "FROM adm.SolicitudCambio WHERE IdSolicitud = " + id);
    }

    static string Script34Sin(string sql34)
    {
        // Para --hashes: sin la postcondicion (COMMIT directo) y con hashes
        // de relleno donde el script todavia no los tiene.
        var corte = sql34.IndexOf("/* ---------- 5. Postcondicion");
        return sql34.Substring(0, corte).Replace("__HASH_CREAR34__", "0x00").Replace("__HASH_APLICAR34__", "0x00") + "COMMIT;\r\nGO\r\nSET NOEXEC OFF;\r\nGO\r\n";
    }

    public static int Main(string[] args)
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        var sello = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        Base = "GestionAdminPrueba_S34" + sello;
        var otra = "GestionAdminPrueba_S34b" + sello;
        var guarda = "S34Guarda_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql34 = Leer("sql", "34_solicitudes_cambio_varios.sql");
        var rb34 = Leer("sql", "34_solicitudes_cambio_varios_rollback.sql");
        var rb25 = Leer("sql", "25_solicitudes_cambio_datos_rollback.sql");

        if (args.Length > 0 && args[0] == "--hashes")
        {
            try
            {
                Preparar(Base);
                using (var cn = Abrir(Base)) Lotes(cn, Script34Sin(sql34));
                Console.WriteLine("Crear34=" + Hash(Base, "adm.usp_SolicitudCambio_Crear"));
                Console.WriteLine("Aplicar34=" + Hash(Base, "adm.usp_SolicitudCambio_Aplicar"));
                Console.WriteLine("Parametros=" + ParametrosCrear(Base) + " Columnas=" + Columnas34(Base));
            }
            finally { Borrar(Base); }
            return 0;
        }

        var post = Regex.Match(sql34, @"POSTCONDICION \(si no, ROLLBACK\)\s+Crear\s+(0x[0-9A-F]{64})\s+Aplicar\s+(0x[0-9A-F]{64})");
        if (!post.Success)
        {
            Console.WriteLine("NO CORRIDO: sql/34 todavia no tiene sus hashes (corre con --hashes y fijalos).");
            return 2;
        }
        var hCrear34 = post.Groups[1].Value;
        var hAplicar34 = post.Groups[2].Value;
        try
        {
            Preparar(Base);
            var alm = new AlmacenSolicitudesCambioSql(delegate { return Abrir(Base); });
            var aplicador = new AplicadorSolicitudCambio(alm, delegate { return new ValidacionAplicar { Valida = true }; });

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql34).Contains("SIN APROBAR") + "|" + LotesError(g, rb34).Contains("SIN APROBAR"));
            Borrar(guarda);
            Check("X1 deteccion con sql/25 (cuenta del sitio): VARIOS apagado", "True|True|False", Detectar(Base, true));
            // Pendientes de ANTES de sql/34 (como las que haya en la VM).
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = true;
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = false;
            var k0a = Enviar(alm, "folio", "PRB 2026-000004", "tipo", "estado", "estado_nuevo", "En Soluci\u00f3n",
                             "campo_fecha", "f_solucion", "fecha_nueva", "2026-12-05");
            var k0b = Enviar(alm, "folio", "PRB 2026-000004", "tipo", "datos", "titulo_nuevo", "Cuatro nuevo");
            using (var cn = Abrir(Base))
            {
                Check("G2 rollback de 34 antes de aplicarla: se niega sin tocar nada", "True|" + Crear25,
                      LotesError(cn, rb34).Contains("no es la de sql/34") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear"));
                var r34 = LotesError(cn, sql34);
                Check("G3 aplicada: hashes de la cabecera, 25 parametros, 9 columnas, Modificar sin cambio",
                      "sin error|" + hCrear34 + "|" + hAplicar34 + "|25|9|" + Modificar24,
                      r34 + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Aplicar") + "|" +
                      ParametrosCrear(Base) + "|" + Columnas34(Base) + "|" + Hash(Base, "adm.usp_GestionAdmin_Modificar"));
                Check("X2 deteccion con sql/34 (cuenta del sitio): VARIOS encendido", "True|True|True", Detectar(Base, true));
                Check("G4 aplicarla otra vez: 'ya aplicada', sin tocar nada", "True|" + hCrear34,
                      LotesError(cn, sql34).Contains("ya aplicada") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear"));
                Check("G5 con 34 aplicada, el rollback de 25 se niega (deshacer 34 primero)", "True|" + hCrear34,
                      LotesError(cn, rb25).Contains("no es la de sql/25") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear"));
            }
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = true;
            Check("K0 pendientes de antes de sql/34: siguen PENDIENTES, sin banderas de fecha, no desactualizadas",
                  "PENDIENTE|PENDIENTE|0|0|0:NULL>NULL|False|False",
                  alm.Detalle(k0a)["estado"] + "|" + alm.Detalle(k0b)["estado"] + "|" + ((List<object>)alm.Detalle(k0a)["fechas_varias"]).Count + "|" +
                  ((List<object>)alm.Detalle(k0b)["fechas_varias"]).Count + "|" + Fila(k0a).Split('|')[3] + "|" + alm.Detalle(k0a)["desactualizada"] + "|" +
                  alm.Detalle(k0b)["desactualizada"]);
            aplicador.Aplicar(k0a, @"SORIANA\adm2", null, null, Hoy);
            aplicador.Aplicar(k0b, @"SORIANA\adm2", null, null, Hoy);
            Check("K0b ... y el Aplicar de sql/34 las aplica como antes (Estado + fecha, luego Titulo)",
                  "APLICADA|APLICADA|En Soluci\u00f3n|2026-09-01|2026-12-05|NULL|Cuatro nuevo|NULL|0",
                  alm.Detalle(k0a)["estado"] + "|" + alm.Detalle(k0b)["estado"] + "|" + Problem("PRB 2026-000004"));

            // ---------------- K: compatibilidad ----------------
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = true;
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = false;
            var k1 = Enviar(alm, "folio", "PRB 2026-000002", "tipo", "estado", "estado_nuevo", "En Soluci\u00f3n",
                            "campo_fecha", "f_solucion", "fecha_nueva", "2026-12-05");
            Check("K1 sin el interruptor se envia Estado + fecha como siempre; la cola no ve fechas por etapa", "ESTADO|0|FechaSolucion",
                  Fila(k1).Split('|')[0] + "|" + ((List<object>)alm.Detalle(k1)["fechas_varias"]).Count + "|" + Fila(k1).Split('|')[7]);
            aplicador.Aplicar(k1, @"SORIANA\adm2", "ok", null, Hoy);
            Check("K2 ... y Aplicar de sql/34 la aplica igual que antes", "APLICADA|En Soluci\u00f3n|2026-09-01|2026-12-05|NULL|Dos|NULL|1",
                  alm.Detalle(k1)["estado"] + "|" + Problem("PRB 2026-000002"));
            var pOff = PeticionSolicitudCambio.DesdeFormulario(Form("folio", "PRB 2026-000001", "tipo", "varios", "estado_nuevo", "Cerrado"));
            Check("K3 sin el interruptor, varios no pasa el formulario", "False|tipo", pOff.Valida + "|" + pOff.Errores[0].Campo);

            // ---------------- V: VARIOS ----------------
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = true;
            var antes1 = Problem("PRB 2026-000001");
            var v1 = Enviar(alm, "folio", "PRB 2026-000001", "tipo", "varios", "estado_nuevo", "En An\u00e1lisis",
                            "f_analisis_nueva", "2026-08-15", "f_cierre_nueva", "2027-01-31",
                            "pct_categoria", "/A/Cat 1", "pct_valor", "40", "titulo_nuevo", "Uno varios");
            Check("V1 enviar VARIOS: UNA fila con el anterior de cada cambio; la iniciativa NO cambia",
                  "VARIOS|PENDIENTE|En Soluci\u00f3n>En An\u00e1lisis|1:2026-08-01>2026-08-15|0:NULL>NULL|1:2026-12-20>2027-01-31|1:Uno>Uno varios|NULL|1|" + antes1,
                  Fila(v1) + "|" + Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE Tipo = 'VARIOS'") + "|" + Problem("PRB 2026-000001"));
            var det1 = alm.Detalle(v1);
            Check("V2 detalle: fechas por etapa con anterior / nueva / actual; categoria; no desactualizada",
                  "FechaAnalisis:2026-08-01>2026-08-15=2026-08-01,FechaCierre:2026-12-20>2027-01-31=2026-12-20|/A/Cat 1:30>40|False",
                  string.Join(",", SolicitudesCambio.FechasVarias(det1).Select(x => x["campo"] + ":" + x["anterior"] + ">" + x["nueva"] + "=" + x["actual"]).ToArray()) + "|" +
                  string.Join(",", ((List<object>)det1["categorias_detalle"]).Cast<Dictionary<string, object>>().Select(c => c["categoria"] + ":" + c["pct_anterior"] + ">" + c["pct_nuevo"]).ToArray()) + "|" +
                  det1["desactualizada"]);
            var fm = SolicitudesCambio.ComoModificar(det1, null);
            Check("V3 se valida como UNA edicion directa con todos los cambios", "En An\u00e1lisis|2026-08-15|NULL|2027-01-31|Uno varios|/A/Cat 1|40",
                  fm["estado"] + "|" + fm["f_analisis"] + "|" + (fm["f_solucion"] ?? "NULL") + "|" + fm["f_cierre"] + "|" + fm["titulo"] + "|" + fm["pct_categoria"] + "|" + fm["pct_valor"]);
            aplicador.Aplicar(v1, @"SORIANA\adm2", "ok", null, Hoy);
            Check("V4 aplicar: TODOS los cambios en la iniciativa; APLICADA; historial de las dos fechas con la solicitud",
                  "En An\u00e1lisis|2026-08-15|2026-11-15|2027-01-31|Uno varios|0.4000|1|APLICADA|2",
                  Problem("PRB 2026-000001") + "|" + alm.Detalle(v1)["estado"] + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE SolicitudId = " + v1));
            var eventos1 = Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000001'");
            Check("V5 aplicar otra vez: 51202 y nada se aplica dos veces", "51202|" + eventos1 + "|APLICADA",
                  Error(() => aplicador.Aplicar(v1, @"SORIANA\adm3", "otra", null, Hoy)) + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000001'") + "|" + alm.Detalle(v1)["estado"]);

            // Rechazar: nada cambia.
            var antes2 = Problem("PRB 2026-000002");
            var v2 = Enviar(alm, "folio", "PRB 2026-000002", "tipo", "varios", "estado_nuevo", "En An\u00e1lisis", "f_cierre_nueva", "2027-03-01",
                            "titulo_nuevo", "Dos varios");
            alm.Rechazar(v2, @"SORIANA\adm2", "No procede");
            Check("V6 rechazar VARIOS: RECHAZADA y la iniciativa no cambia en nada", "RECHAZADA|" + antes2,
                  alm.Detalle(v2)["estado"] + "|" + Problem("PRB 2026-000002"));

            // Desactualizada: una de las fechas cambio antes de aplicar.
            var v3 = Enviar(alm, "folio", "PRB 2026-000002", "tipo", "varios", "f_analisis_nueva", "2026-09-20", "titulo_nuevo", "Dos varios");
            using (var cn = Abrir(Base))
                Exec(cn, "EXEC adm.usp_GestionAdmin_Modificar @Usuario = N'SORIANA\\adm1', @Codigo = N'PRB 2026-000002', @CambiaFAnalisis = 1, @FAnalisis = '2026-09-10'");
            var antes3 = Problem("PRB 2026-000002");
            Check("V7 el detalle ya avisa desactualizada", "True", alm.Detalle(v3)["desactualizada"]);
            Check("V8 aplicar desactualizada: 51204, NADA aplicado (ni el Titulo), sigue PENDIENTE con 1 intento",
                  "51204|" + antes3 + "|PENDIENTE|1|DESACTUALIZADA",
                  Error(() => aplicador.Aplicar(v3, @"SORIANA\adm2", null, null, Hoy)) + "|" + Problem("PRB 2026-000002") + "|" +
                  alm.Detalle(v3)["estado"] + "|" + alm.Detalle(v3)["intentos"] + "|" +
                  Uno("SELECT TOP (1) Evento FROM adm.SolicitudCambioEvento WHERE IdSolicitud = " + v3 + " ORDER BY IdEvento DESC"));

            // Falla DENTRO de Modificar (la categoria por agregar deja de estar
            // vigente en el catalogo): ni el Estado ni la fecha quedan.
            var v4 = Enviar(alm, "folio", "PRB 2026-000003", "tipo", "varios", "estado_nuevo", "En Soluci\u00f3n", "f_analisis_nueva", "2026-09-20",
                            "agregar_categoria", "/A/Cat 2", "agregar_pct", "10");
            var cls = new List<ClasificacionSolicitud> { new ClasificacionSolicitud { Categoria = "/A/Cat 2", TipoIniciativa = "Problem", TipoAgrupado = "Problem" } };
            var antes4 = Problem("PRB 2026-000003");
            var sinClas = alm.Detalle(v4)["sin_clasificar"];
            // La clasificacion de ADM solo si el prefijo no la dio (si no, 51222).
            if (sinClas.ToString() == "0") cls = null;
            using (var cn = Abrir(Base)) Exec(cn, "UPDATE dbo.Categorias SET VigenteEnOrigen = 0 WHERE RutaCompleta = N'/A/Cat 2'");
            Check("V9 una falla dentro de Modificar (51015): NADA aplicado, sigue PENDIENTE con 1 intento y FALLO_APLICAR",
                  "51015|" + antes4 + "|PENDIENTE|1|FALLO_APLICAR|" + sinClas,
                  Error(() => aplicador.Aplicar(v4, @"SORIANA\adm2", null, cls, Hoy)) + "|" + Problem("PRB 2026-000003") + "|" +
                  alm.Detalle(v4)["estado"] + "|" + alm.Detalle(v4)["intentos"] + "|" +
                  Uno("SELECT TOP (1) Evento FROM adm.SolicitudCambioEvento WHERE IdSolicitud = " + v4 + " ORDER BY IdEvento DESC") + "|" +
                  alm.Detalle(v4)["sin_clasificar"]);
            using (var cn = Abrir(Base)) Exec(cn, "UPDATE dbo.Categorias SET VigenteEnOrigen = 1 WHERE RutaCompleta = N'/A/Cat 2'");
            aplicador.Aplicar(v4, @"SORIANA\adm2", null, cls, Hoy);
            Check("V10 corregida la causa, reintentar la aplica ENTERA", "En Soluci\u00f3n|2026-09-20|NULL|NULL|Tres|NULL|1|APLICADA|2",
                  Problem("PRB 2026-000003") + "|" + alm.Detalle(v4)["estado"] + "|" + alm.Detalle(v4)["intentos"]);

            // Reintento del envio: la misma llave no duplica.
            var llave = Guid.NewGuid().ToString();
            var fr = Form("folio", "PRB 2026-000002", "tipo", "varios", "estado_nuevo", "En An\u00e1lisis", "titulo_nuevo", "Dos otra");
            fr["llave"] = llave;
            var r1 = alm.Enviar(PeticionSolicitudCambio.DesdeFormulario(fr), @"SORIANA\mod1", "MOD");
            var r2 = alm.Enviar(PeticionSolicitudCambio.DesdeFormulario(fr), @"SORIANA\mod1", "MOD");
            Check("V11 reintento con la misma llave: la misma solicitud, Repetida, una sola fila", "True|False|True|1",
                  (r1.IdSolicitud == r2.IdSolicitud) + "|" + r1.Repetida + "|" + r2.Repetida + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE LlaveIdempotencia = '" + llave + "'"));

            using (var cn = Abrir(Base))
            {
                Func<string, string> crear = extra => Error(() => Exec(cn,
                    "DECLARE @id int, @r bit, @c adm.SolicitudCategoriaTipo; EXEC adm.usp_SolicitudCambio_Crear @Usuario = N'SORIANA\\mod1', @Rol = 'MOD', " +
                    "@Llave = '" + Guid.NewGuid() + "', @Codigo = N'PRB 2026-000002', @Motivo = N'm', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT, " + extra));
                Check("V12 forma: VARIOS vacio, con CampoFecha, Subestado sin Estado, bandera sin fecha; FECHA con bandera de etapa = 51214",
                      "51214|51214|51214|51214|51214",
                      crear("@Tipo = 'VARIOS'") + "|" +
                      crear("@Tipo = 'VARIOS', @CampoFecha = 'FechaAnalisis', @FechaNueva = '2027-01-01'") + "|" +
                      crear("@Tipo = 'VARIOS', @SubestadoNuevo = N'x', @CambiaTitulo = 1, @TituloNuevo = N't'") + "|" +
                      crear("@Tipo = 'VARIOS', @CambiaFCierre = 1") + "|" +
                      crear("@Tipo = 'FECHA', @CampoFecha = 'FechaAnalisis', @FechaNueva = '2027-01-01', @CambiaFCierre = 1, @FCierreNueva = '2027-02-01'"));
                var faActual = Uno("SELECT CONVERT(varchar(10), FechaAnalisis, 23) FROM dbo.Problem WHERE Codigo = N'PRB 2026-000002'");
                Check("V13 VARIOS con una fecha igual a la actual = 51218; con el mismo Estado = 51219", "51218|51219",
                      crear("@Tipo = 'VARIOS', @CambiaFAnalisis = 1, @FAnalisisNueva = '" + faActual + "', @CambiaTitulo = 1, @TituloNuevo = N'otro'") + "|" +
                      crear("@Tipo = 'VARIOS', @EstadoNuevo = N'" + Uno("SELECT Estado FROM dbo.Problem WHERE Codigo = N'PRB 2026-000002'") + "'"));
                Check("V14 CHECK de la tabla (INSERT a mano como dbo): VARIOS con CampoFecha y OTROS con bandera de fecha = 547", "547|547",
                      Error(() => Exec(cn, "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia, CampoFecha, FechaNueva) " +
                                           "VALUES (N'PRB 2026-000002', 'VARIOS', N'm', N'u', 'MOD', NEWID(), 'FechaAnalisis', '2027-01-01')")) + "|" +
                      Error(() => Exec(cn, "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia, CambiaFCierre, FCierreNueva) " +
                                           "VALUES (N'PRB 2026-000002', 'OTROS', N'm', N'u', 'MOD', NEWID(), 1, '2027-01-01')")));
            }
            Check("V15 la cola lista las VARIOS con sus fechas por etapa", "True",
                  alm.Listar(null, 50).Exists(s => (string)s["tipo"] == "VARIOS" && ((List<object>)s["fechas_varias"]).Count == 2));

            // ---------------- P: cuenta del sitio ----------------
            var vp = Enviar(alm, "folio", "PRB 2026-000002", "tipo", "varios", "f_cierre_nueva", "2027-04-01", "titulo_nuevo", "Dos sitio");
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                Exec(cn, "DECLARE @c adm.SolicitudClasificacionTipo; EXEC adm.usp_SolicitudCambio_Aplicar @IdSolicitud = " + vp + ", @Revisor = N'SORIANA\\adm9', @Clasificaciones = @c");
            }
            Check("P1 como PROACTIVANETAD: aplica VARIOS por el procedimiento (encadenamiento de propietario)", "2027-04-01|Dos sitio|APLICADA",
                  Problem("PRB 2026-000002").Split('|')[3] + "|" + Problem("PRB 2026-000002").Split('|')[4] + "|" + alm.Detalle(vp)["estado"]);
            string directo;
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                directo = Error(() => Exec(cn, "UPDATE adm.SolicitudCambio SET FCierreNueva = '2030-01-01' WHERE IdSolicitud = " + vp));
            }
            Check("P2 ... pero no puede escribir la tabla a mano (229)", "229", directo);

            // ---------------- C: dos ADM a la vez ----------------
            // C1 carrera forzada: otra sesion retiene dbo.Problem; A toma la
            // solicitud (UPDLOCK) y espera a dbo.Problem; B espera a A en la
            // solicitud. Al soltar, A aplica y B ve la solicitud ya revisada.
            var vc = Enviar(alm, "folio", "PRB 2026-000004", "tipo", "varios", "estado_nuevo", "En An\u00e1lisis",
                            "f_cierre_nueva", "2027-05-01", "titulo_nuevo", "Cuatro C");
            var fechasAntesC = int.Parse(Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000004'"));
            string resA = null, resB = null, esperando, bloqueadas;
            using (var bloqueo = Abrir(Base))
            {
                Exec(bloqueo, "BEGIN TRAN; SELECT Codigo FROM dbo.Problem WITH (UPDLOCK, HOLDLOCK) WHERE Codigo = N'PRB 2026-000004';");
                var tA = System.Threading.Tasks.Task.Run(() => { resA = Error(() => alm.Aplicar(vc, @"SORIANA\admA", null, null, Hoy)); });
                System.Threading.Thread.Sleep(1500);
                var tB = System.Threading.Tasks.Task.Run(() => { resB = Error(() => alm.Aplicar(vc, @"SORIANA\admB", null, null, Hoy)); });
                System.Threading.Thread.Sleep(1500);
                esperando = (!tA.IsCompleted && !tB.IsCompleted).ToString();
                bloqueadas = Uno("master", "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id <> 0 AND database_id = DB_ID(N'" + Base + "')");
                Exec(bloqueo, "COMMIT;");
                System.Threading.Tasks.Task.WaitAll(new[] { tA, tB }, 60000);
            }
            Check("C1 carrera forzada: los dos ADM esperaban de verdad (2 sesiones bloqueadas)", "True|2", esperando + "|" + bloqueadas);
            Check("C2 ... gana A, B recibe 51202; APLICADA una vez, 1 intento, por A; un solo evento APLICADA y ningun FALLO",
                  "sin error|51202|APLICADA|1|SORIANA\\admA|1|0",
                  resA + "|" + resB + "|" + alm.Detalle(vc)["estado"] + "|" + alm.Detalle(vc)["intentos"] + "|" + alm.Detalle(vc)["revisado_por"] + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambioEvento WHERE IdSolicitud = " + vc + " AND Evento = 'APLICADA'") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambioEvento WHERE IdSolicitud = " + vc + " AND Evento IN ('FALLO_APLICAR', 'DESACTUALIZADA')"));
            Check("C3 ... la iniciativa recibio TODO una sola vez (una fila de historial de la fecha, no dos)",
                  "En An\u00e1lisis|2027-05-01|Cuatro C|" + (fechasAntesC + 1) + "|1",
                  Problem("PRB 2026-000004").Split('|')[0] + "|" + Problem("PRB 2026-000004").Split('|')[3] + "|" + Problem("PRB 2026-000004").Split('|')[4] + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000004'") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE SolicitudId = " + vc));

            // C4 carreras libres: los dos salen a la vez (Barrier), 8 veces.
            var malas = new List<string>();
            for (var ronda = 0; ronda < 8; ronda++)
            {
                var vr = Enviar(alm, "folio", "PRB 2026-000004", "tipo", "varios", "f_solucion_nueva", "2027-07-" + (10 + ronda),
                                "titulo_nuevo", "Cuatro r" + ronda);
                var barrera = new System.Threading.Barrier(2);
                string rc1 = null, rc2 = null;
                var t1 = System.Threading.Tasks.Task.Run(() => { barrera.SignalAndWait(); rc1 = Error(() => alm.Aplicar(vr, @"SORIANA\admA", null, null, Hoy)); });
                var t2 = System.Threading.Tasks.Task.Run(() => { barrera.SignalAndWait(); rc2 = Error(() => alm.Aplicar(vr, @"SORIANA\admB", null, null, Hoy)); });
                System.Threading.Tasks.Task.WaitAll(new[] { t1, t2 }, 60000);
                var res = new[] { rc1, rc2 }.OrderBy(x => x).ToArray();
                var estadoR = Uno("SELECT Estado + '|' + CONVERT(varchar(5), Intentos) FROM adm.SolicitudCambio WHERE IdSolicitud = " + vr);
                var historial = Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE SolicitudId = " + vr);
                var problema = Problem("PRB 2026-000004").Split('|');
                if (res[0] != "51202" || res[1] != "sin error" || estadoR != "APLICADA|1" || historial != "1"
                    || problema[2] != "2027-07-" + (10 + ronda) || problema[4] != "Cuatro r" + ronda)
                    malas.Add(ronda + ":" + rc1 + "/" + rc2 + "/" + estadoR + "/" + historial + "/" + problema[2] + "/" + problema[4]);
            }
            Check("C4 8 carreras libres: siempre una aplica y la otra 51202; 1 intento; historial 1 vez; todos los cambios", "",
                  string.Join(" ; ", malas.ToArray()));

            // C5 aplicar contra rechazar a la vez, 6 veces: gana una sola
            // decision y la iniciativa queda acorde (rechazada = sin cambios).
            var incoherentes = new List<string>();
            int aplicadas = 0, rechazadas = 0;
            for (var ronda = 0; ronda < 6; ronda++)
            {
                var antesR = Problem("PRB 2026-000004");
                var vr = Enviar(alm, "folio", "PRB 2026-000004", "tipo", "varios", "f_analisis_nueva", "2026-10-" + (10 + ronda),
                                "titulo_nuevo", "Cuatro x" + ronda);
                var barrera = new System.Threading.Barrier(2);
                string ra = null, rr = null;
                var ta = System.Threading.Tasks.Task.Run(() => { barrera.SignalAndWait(); ra = Error(() => alm.Aplicar(vr, @"SORIANA\admA", null, null, Hoy)); });
                var tr = System.Threading.Tasks.Task.Run(() => { barrera.SignalAndWait(); rr = Error(() => alm.Rechazar(vr, @"SORIANA\admB", "No procede")); });
                System.Threading.Tasks.Task.WaitAll(new[] { ta, tr }, 60000);
                var est = Uno("SELECT Estado FROM adm.SolicitudCambio WHERE IdSolicitud = " + vr);
                var ahora = Problem("PRB 2026-000004");
                var ok = est == "APLICADA" ? ra == "sin error" && rr == "51202" && ahora.Split('|')[4] == "Cuatro x" + ronda && ahora.Split('|')[1] == "2026-10-" + (10 + ronda)
                       : est == "RECHAZADA" ? rr == "sin error" && ra == "51202" && ahora == antesR
                       : false;
                if (est == "APLICADA") aplicadas++; else if (est == "RECHAZADA") rechazadas++;
                if (!ok) incoherentes.Add(ronda + ":" + est + "/" + ra + "/" + rr);
            }
            Check("C5 aplicar contra rechazar: una sola decision cada vez y la iniciativa coherente con ella (" + aplicadas + " aplicadas, " + rechazadas + " rechazadas)",
                  "", string.Join(" ; ", incoherentes.ToArray()));

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
                Check("B1 con solicitudes VARIOS el rollback se niega sin tocar nada", "True|" + hCrear34 + "|9",
                      LotesError(cn, rb34).Contains("solicitud(es) VARIOS") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear") + "|" + Columnas34(Base));
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = null;
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = null;
            Preparar(otra);
            using (var cn = Abrir(otra))
            {
                Lotes(cn, sql34);
                var rb = LotesError(cn, rb34);
                Check("B2 sin VARIOS: deshecha; Crear / Aplicar EXACTOS a sql/25, 19 parametros, sin columnas ni CHECK de 34",
                      "sin error|" + Crear25 + "|" + Aplicar25 + "|19|0|NULL|NULL",
                      rb + "|" + Hash(otra, "adm.usp_SolicitudCambio_Crear") + "|" + Hash(otra, "adm.usp_SolicitudCambio_Aplicar") + "|" +
                      ParametrosCrear(otra) + "|" + Columnas34(otra) + "|" + Uno(otra, "SELECT OBJECT_ID('adm.CK_SolicitudCambio_Varios', 'C')") + "|" +
                      Uno(otra, "SELECT OBJECT_ID('adm.CK_SolicitudCambio_FechasVarias', 'C')"));
                Check("X3 deteccion con sql/34 deshecha: VARIOS se apaga solo, lo demas sigue", "True|True|False", Detectar(otra, true));
                Check("B3 los CHECK vuelven a los de sql/25 (VARIOS = 547; ESTADO con Estado sigue)", "547|sin error",
                      Error(() => Exec(cn, "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia, CambiaTitulo, TituloNuevo) " +
                                           "VALUES (N'PRB 2026-000002', 'VARIOS', N'm', N'u', 'MOD', NEWID(), 1, N't')")) + "|" +
                      Error(() => Exec(cn, "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia, EstadoNuevo) " +
                                           "VALUES (N'PRB 2026-000002', 'ESTADO', N'm', N'u', 'MOD', NEWID(), N'En Soluci\u00f3n')")));
                Check("B4 ahora el rollback de 25 si puede (orden 34 -> 25)", "sin error", LotesError(cn, rb25));
                Lotes(cn, Leer("sql", "25_solicitudes_cambio_datos.sql"));
                Check("B5 volver a aplicar 25 y 34", "sin error|" + hCrear34 + "|9", LotesError(cn, sql34) + "|" + Hash(otra, "adm.usp_SolicitudCambio_Crear") + "|" + Columnas34(otra));
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = null;
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = null;
            try { Borrar(Base); Borrar(otra); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        var vm = "GestionAdminPrueba_S34vm" + sello;
        try
        {
            var sql32 = Environment.GetEnvironmentVariable("SQL32_VM");
            Preparar(vm);
            using (var cn = Abrir(vm))
            {
                foreach (var n in new[] { "26_gestion_admin_crear_volumetria.sql", "27_gestion_admin_crear_subestado.sql", "28_acuse_po_so.sql",
                                          "29_solicitud_iniciativa.sql", "30_interruptor_iniciativas.sql", "31_solicitud_iniciativa_revision.sql" })
                    Lotes(cn, Leer("sql", n));
                if (!string.IsNullOrEmpty(sql32) && File.Exists(sql32)) Lotes(cn, File.ReadAllText(sql32));
                Check("Z1 base como la VM (22-31" + (string.IsNullOrEmpty(sql32) ? "" : " + 32") + "): Crear / Aplicar / Modificar con los hashes que exige sql/34",
                      Crear25 + "|" + Aplicar25 + "|" + Modificar24,
                      Hash(vm, "adm.usp_SolicitudCambio_Crear") + "|" + Hash(vm, "adm.usp_SolicitudCambio_Aplicar") + "|" + Hash(vm, "adm.usp_GestionAdmin_Modificar"));
                Check("Z2 ... y sql/34 se aplica encima", "sin error|" + hCrear34 + "|" + hAplicar34,
                      LotesError(cn, sql34) + "|" + Hash(vm, "adm.usp_SolicitudCambio_Crear") + "|" + Hash(vm, "adm.usp_SolicitudCambio_Aplicar"));
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion (Z): " + ex.Message);
        }
        finally { try { Borrar(vm); } catch (Exception) { } }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
