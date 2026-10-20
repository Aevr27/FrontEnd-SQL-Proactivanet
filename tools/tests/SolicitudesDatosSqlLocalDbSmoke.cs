// Prueba de INTEGRACION de sql/25_solicitudes_cambio_datos.sql (+ _rollback)
// con el almacen real de solicitudes (AlmacenSolicitudesCambioSql, con
// PersistenciaSolicitudesCambio.SolicitaDatos forzado en la prueba) y la
// lectura del registro (duenos capturados), contra bases REALES pero
// DESECHABLES de SQL Server LocalDB: crea GestionAdminPrueba_S25<n>, aplica
// la replica, el cargador 174bb51, las vistas del backend, sql/18, 20, 21,
// 22 + permisos (la VM hoy), corre los casos y BORRA las bases al final.
// Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base), exige sql/24 antes, hashes y firma,
//      ya aplicada, Modificar sin cambio, el rollback de 24 se niega encima.
//   K  compatibilidad: el sitio sin el interruptor (sin los parametros
//      nuevos) envia y aplica igual sobre los procedimientos de sql/25.
//   D  DATOS: enviar guarda el "anterior" sin tocar la iniciativa; aplicar
//      cambia Titulo / PO / SO capturados (y solo eso), el registro lo ve al
//      refrescar; vaciar; mismo valor (51224); 255 (51027); forma (51214);
//      CHECK de la tabla; desactualizada (51204, sigue PENDIENTE); el
//      Codigo no se puede pedir ni cambiar.
//   P  cuenta del sitio (EXECUTE AS PROACTIVANETAD): envia y aplica DATOS
//      por encadenamiento de propietario; no escribe la tabla a mano.
//   B  rollback: se niega con solicitudes DATOS; en una base sin ellas,
//      Crear / Aplicar vuelven EXACTOS a sql/22, sin columnas; despues el
//      rollback de 24 ya puede; volver a aplicar 25.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data.SqlClient;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;

public static class SolicitudesDatosSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Crear22 = "0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71";
    const string Aplicar22 = "0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1";
    const string Modificar24 = "0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77";
    static readonly DateTime Hoy = new DateTime(2026, 10, 20);
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
    static string ParametrosCrear(string db) { return Uno(db, "SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_SolicitudCambio_Crear')"); }
    static string Columnas25(string db)
    {
        return Uno(db, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('adm.SolicitudCambio') AND name IN (N'CambiaTitulo', N'TituloAnterior', " +
                       "N'TituloNuevo', N'CambiaOwnerProblem', N'OwnerProblemAnterior', N'OwnerProblemNuevo', N'CambiaOwnerServicio', " +
                       "N'OwnerServicioAnterior', N'OwnerServicioNuevo')");
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
            Lotes(cn, Leer("sql", "22_solicitudes_cambio.sql"));
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            Lotes(cn, Leer("sql", "22_solicitudes_cambio_permisos.sql"));
            Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, FechaAnalisis, FechaSolucion, FechaCierre, OwnerProblem, OwnerServicio) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'En Soluci" + "ó" + @"n', NULL, '2026-08-01', '2026-11-15', '2026-12-20', N'PO viejo', N'SO viejo'),
 (N'PRB 2026-000002', N'Problem', N'Dos', N'En An" + "á" + @"lisis', NULL, '2026-09-01', NULL, NULL, NULL, NULL),
 (N'PRB 2026-000003', N'Problem', N'Tres', N'En An" + "á" + @"lisis', NULL, '2026-09-01', NULL, NULL, N'PO tres', NULL);
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

    static string Problem(string codigo)
    {
        return Uno("SELECT ISNULL(Titulo, 'NULL') + '|' + ISNULL(OwnerProblem, 'NULL') + '|' + ISNULL(OwnerServicio, 'NULL') FROM dbo.Problem WHERE Codigo = N'" + codigo + "'");
    }

    static string Fila(int id)
    {
        return Uno("SELECT Tipo + '|' + Estado + '|' + CONVERT(varchar(1), CambiaTitulo) + ISNULL(':' + TituloAnterior + '>' + TituloNuevo, '') + '|' + " +
                   "CONVERT(varchar(1), CambiaOwnerProblem) + ':' + ISNULL(OwnerProblemAnterior, 'NULL') + '>' + ISNULL(OwnerProblemNuevo, 'NULL') + '|' + " +
                   "CONVERT(varchar(1), CambiaOwnerServicio) + ':' + ISNULL(OwnerServicioAnterior, 'NULL') + '>' + ISNULL(OwnerServicioNuevo, 'NULL') " +
                   "FROM adm.SolicitudCambio WHERE IdSolicitud = " + id);
    }

    // La MISMA lectura que el registro (ExperienciaRegistro.LeerDuenosCapturados
    // + AplicarDuenosCapturados): lo que ADM ve al refrescar.
    static string RegistroCapturados(string codigo)
    {
        var tipo = typeof(PlanificadorGestionAdmin).Assembly.GetType("ExperienciaQueries");
        var leer = tipo.GetMethod("LeerDuenosCapturados", BindingFlags.NonPublic | BindingFlags.Static);
        var aplicar = tipo.GetMethod("AplicarDuenosCapturados", BindingFlags.NonPublic | BindingFlags.Static);
        var i = new Dictionary<string, object> { { "folio", codigo } };
        var salida = new Dictionary<string, object> { { "iniciativas", new List<object> { i } } };
        using (var cn = Abrir(Base)) aplicar.Invoke(null, new[] { salida, leer.Invoke(null, new object[] { cn }) });
        return (i["po_capturado"] ?? "NULL") + "|" + (i["so_capturado"] ?? "NULL");
    }

    static void Aplicar23y24(SqlConnection cn)
    {
        Lotes(cn, Leer("sql", "23_cambios_recientes.sql"));
        Lotes(cn, Leer("sql", "24_gestion_admin_modificar_duenos_quitar.sql"));
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        var sello = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        Base = "GestionAdminPrueba_S25" + sello;
        var otra = "GestionAdminPrueba_S25b" + sello;
        var guarda = "S25Guarda_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql25 = Leer("sql", "25_solicitudes_cambio_datos.sql");
        var rb25 = Leer("sql", "25_solicitudes_cambio_datos_rollback.sql");
        var rb24 = Leer("sql", "24_gestion_admin_modificar_duenos_quitar_rollback.sql");
        var post = Regex.Match(sql25, @"POSTCONDICION \(si no, ROLLBACK\)\s+Crear\s+(0x[0-9A-F]{64})\s+Aplicar\s+(0x[0-9A-F]{64})");
        var hCrear25 = post.Groups[1].Value;
        var hAplicar25 = post.Groups[2].Value;
        try
        {
            Preparar(Base);
            var alm = new AlmacenSolicitudesCambioSql(delegate { return Abrir(Base); });
            var aplicador = new AplicadorSolicitudCambio(alm, delegate { return new ValidacionAplicar { Valida = true }; });

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
            {
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql25).Contains("SIN APROBAR") + "|" + LotesError(g, rb25).Contains("SIN APROBAR"));
            }
            Borrar(guarda);
            using (var cn = Abrir(Base))
            {
                Check("G2 con sql/22 sola (sin 23 / 24): se niega pidiendo 23 y 24; Crear sigue siendo el de sql/22, sin columnas", "True|" + Crear22 + "|13|0",
                      LotesError(cn, sql25).Contains("Aplica sql/23 y sql/24 antes") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear") + "|" +
                      ParametrosCrear(Base) + "|" + Columnas25(Base));
                Lotes(cn, Leer("sql", "23_cambios_recientes.sql"));
                Check("G3 con sql/23 sin sql/24: tambien se niega", "True|0",
                      LotesError(cn, sql25).Contains("no es la esperada") + "|" + Columnas25(Base));
                Lotes(cn, Leer("sql", "24_gestion_admin_modificar_duenos_quitar.sql"));
                Check("G4 rollback de 25 antes de aplicarla: se niega sin tocar nada", "True|" + Crear22,
                      LotesError(cn, rb25).Contains("no es la de sql/25") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear"));
                var r25 = LotesError(cn, sql25);
                Console.WriteLine("      hash Crear 25 = " + Hash(Base, "adm.usp_SolicitudCambio_Crear") + ", Aplicar 25 = " + Hash(Base, "adm.usp_SolicitudCambio_Aplicar") + "  (" + r25 + ")");
                Check("G5 aplicada: hashes de la cabecera, 19 parametros, 9 columnas, Modificar sin cambio",
                      "sin error|" + hCrear25 + "|" + hAplicar25 + "|19|9|" + Modificar24,
                      r25 + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Aplicar") + "|" +
                      ParametrosCrear(Base) + "|" + Columnas25(Base) + "|" + Hash(Base, "adm.usp_GestionAdmin_Modificar"));
                Check("G6 aplicarla otra vez: 'ya aplicada', sin tocar nada", "True|" + hCrear25,
                      LotesError(cn, sql25).Contains("ya aplicada") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear"));
                Check("G7 con 25 aplicada, el rollback de 24 se niega (deshacer 25 primero)", "True|" + Modificar24,
                      LotesError(cn, rb24).Contains("no es la de sql/24") + "|" + Hash(Base, "adm.usp_GestionAdmin_Modificar"));
            }

            // ---------------- K: compatibilidad ----------------
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = false;
            var k1 = Enviar(alm, "folio", "PRB 2026-000002", "tipo", "fecha", "campo_fecha", "f_analisis", "fecha_nueva", "2026-12-15");
            var detK = alm.Detalle(k1);
            Check("K1 sin el interruptor (sin parametros nuevos) se envia; la cola lee las banderas en false", "FECHA|0:NULL>NULL|False|False",
                  Fila(k1).Split('|')[0] + "|" + Fila(k1).Split('|')[3] + "|" + detK["cambia_titulo"] + "|" + detK["cambia_po"]);
            aplicador.Aplicar(k1, @"SORIANA\adm2", "ok", null, Hoy);
            Check("K2 ... y Aplicar de sql/25 aplica una FECHA igual que antes (sin tocar Titulo / PO / SO)", "APLICADA|2026-12-15|Dos|NULL|NULL",
                  alm.Detalle(k1)["estado"] + "|" + Uno("SELECT CONVERT(varchar(10), FechaAnalisis, 23) FROM dbo.Problem WHERE Codigo = N'PRB 2026-000002'") + "|" +
                  Problem("PRB 2026-000002"));
            var pOff = PeticionSolicitudCambio.DesdeFormulario(Form("folio", "PRB 2026-000001", "tipo", "datos", "titulo_nuevo", "x"));
            Check("K3 sin el interruptor, datos no pasa el formulario", "False|tipo", pOff.Valida + "|" + pOff.Errores[0].Campo);

            // ---------------- D: DATOS ----------------
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = true;
            var cats1 = Uno("SELECT STRING_AGG(Categoria + '=' + CONVERT(varchar(10), PctDisminucion) + '/' + CONVERT(varchar(1), VigenteEnOrigen), ',') FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001'");
            var d1 = Enviar(alm, "folio", "PRB 2026-000001", "tipo", "datos", "titulo_nuevo", "Uno nuevo", "po_nuevo", "PO nuevo",
                            "codigo", "PRB 2026-999999");
            Check("D1 enviar: guarda el anterior de cada dato pedido; el SO no se pide; la iniciativa NO cambia",
                  "DATOS|PENDIENTE|1:Uno>Uno nuevo|1:PO viejo>PO nuevo|0:NULL>NULL|Uno|PO viejo|SO viejo",
                  Fila(d1) + "|" + Problem("PRB 2026-000001"));
            var det1 = alm.Detalle(d1);
            Check("D2 detalle: banderas, anterior / nuevo y lo de ahora; no desactualizada",
                  "True|Uno|Uno nuevo|True|PO viejo|PO nuevo|False|Uno|PO viejo|SO viejo|False",
                  det1["cambia_titulo"] + "|" + det1["titulo_anterior"] + "|" + det1["titulo_nuevo"] + "|" + det1["cambia_po"] + "|" + det1["po_anterior"] + "|" +
                  det1["po_nuevo"] + "|" + det1["cambia_so"] + "|" + ((Dictionary<string, object>)det1["actual"])["titulo"] + "|" +
                  ((Dictionary<string, object>)det1["actual"])["po"] + "|" + ((Dictionary<string, object>)det1["actual"])["so"] + "|" + det1["desactualizada"]);
            aplicador.Aplicar(d1, @"SORIANA\adm2", "ok", null, Hoy);
            Check("D3 aplicar: Titulo y PO capturados cambian, el SO no; APLICADA; protegida y sellada por quien aplico",
                  "Uno nuevo|PO nuevo|SO viejo|APLICADA|MODIFICACION|SORIANA\\adm2",
                  Problem("PRB 2026-000001") + "|" + alm.Detalle(d1)["estado"] + "|" +
                  Uno("SELECT Motivo + '|' + UltimoCambioUsuario FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2026-000001'"));
            Check("D4 ... y el registro lo ve al refrescar (po_capturado / so_capturado)", "PO nuevo|SO viejo", RegistroCapturados("PRB 2026-000001"));
            Check("D5 las categorias de la iniciativa no cambian (ni %, ni vigencia)", cats1,
                  Uno("SELECT STRING_AGG(Categoria + '=' + CONVERT(varchar(10), PctDisminucion) + '/' + CONVERT(varchar(1), VigenteEnOrigen), ',') FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001'"));
            Check("D6 el Codigo colado no hizo nada: ninguna iniciativa nueva, ninguna solicitud de otro folio", "3|0",
                  Uno("SELECT COUNT(*) FROM dbo.Problem") + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE Codigo NOT IN (N'PRB 2026-000001', N'PRB 2026-000002', N'PRB 2026-000003')"));

            var d2 = Enviar(alm, "folio", "PRB 2026-000003", "tipo", "datos", "po_nuevo", "", "so_nuevo", "SO tres");
            aplicador.Aplicar(d2, @"SORIANA\adm2", null, null, Hoy);
            Check("D7 vaciar el PO y poner SO (iniciativa sin categoria): NULL / SO tres", "1:PO tres>NULL|Tres|NULL|SO tres|APLICADA",
                  Fila(d2).Split('|')[3] + "|" + Problem("PRB 2026-000003") + "|" + alm.Detalle(d2)["estado"]);
            Check("D8 pedir el MISMO valor (con espacios de mas): 51224, nada se guarda", "51224|2",
                  Error(() => Enviar(alm, "folio", "PRB 2026-000001", "tipo", "datos", "so_nuevo", "  SO viejo ")) + "|" +
                  Uno("SELECT COUNT(*) FROM adm.SolicitudCambio WHERE Tipo = 'DATOS'"));
            Check("D9 mismo Titulo pero con otras mayusculas: SI es un cambio (binario)", "sin error",
                  Error(() => Enviar(alm, "folio", "PRB 2026-000001", "tipo", "datos", "titulo_nuevo", "UNO NUEVO")));

            using (var cn = Abrir(Base))
            {
                Func<string, string> crear = extra => Error(() => Exec(cn,
                    "DECLARE @id int, @r bit, @c adm.SolicitudCategoriaTipo; EXEC adm.usp_SolicitudCambio_Crear @Usuario = N'SORIANA\\mod1', @Rol = 'MOD', " +
                    "@Llave = '" + Guid.NewGuid() + "', @Codigo = N'PRB 2026-000002', @Motivo = N'm', @Categorias = @c, @IdSolicitud = @id OUTPUT, @Repetida = @r OUTPUT, " + extra));
                Check("D10 directo al procedimiento: PO de 256 = 51027", "51027",
                      crear("@Tipo = 'DATOS', @CambiaOwnerProblem = 1, @OwnerProblemNuevo = N'" + new string('x', 256) + "'"));
                Check("D11 FECHA con una bandera de datos = 51214", "51214",
                      crear("@Tipo = 'FECHA', @CampoFecha = 'FechaAnalisis', @FechaNueva = '2027-01-01', @CambiaTitulo = 1, @TituloNuevo = N't'"));
                Check("D12 DATOS sin bandera = 51214; valor sin su bandera = 51214", "51214|51214",
                      crear("@Tipo = 'DATOS'") + "|" + crear("@Tipo = 'DATOS', @CambiaTitulo = 1, @TituloNuevo = N't', @OwnerServicioNuevo = N'SO'"));
                Check("D13 DATOS con Estado = 51214", "51214", crear("@Tipo = 'DATOS', @CambiaTitulo = 1, @TituloNuevo = N't', @EstadoNuevo = N'Cerrado'"));
                Check("D14 CHECK de la tabla (INSERT a mano como dbo): DATOS sin bandera y OTROS con bandera = 547", "547|547",
                      Error(() => Exec(cn, "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia) " +
                                           "VALUES (N'PRB 2026-000002', 'DATOS', N'm', N'u', 'MOD', NEWID())")) + "|" +
                      Error(() => Exec(cn, "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia, CambiaTitulo, TituloNuevo) " +
                                           "VALUES (N'PRB 2026-000002', 'OTROS', N'm', N'u', 'MOD', NEWID(), 1, N't')")));
                Check("D15 el procedimiento no tiene parametro para el Codigo nuevo (solo @Codigo, el que se pide)", "0",
                      Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id IN (OBJECT_ID('adm.usp_SolicitudCambio_Crear'), OBJECT_ID('adm.usp_SolicitudCambio_Aplicar'), " +
                          "OBJECT_ID('adm.usp_GestionAdmin_Modificar')) AND name LIKE N'%Codigo%' AND name <> N'@Codigo'"));
            }

            // Desactualizada: otro cambio llega antes de aplicar.
            var d3 = Enviar(alm, "folio", "PRB 2026-000002", "tipo", "datos", "so_nuevo", "SO dos");
            using (var cn = Abrir(Base))
                Exec(cn, "EXEC adm.usp_GestionAdmin_Modificar @Usuario = N'SORIANA\\adm1', @Codigo = N'PRB 2026-000002', @CambiaOwnerServicio = 1, @OwnerServicio = N'SO directo'");
            Check("D16 el detalle ya avisa desactualizada", "True", alm.Detalle(d3)["desactualizada"]);
            Check("D17 aplicar desactualizada: 51204, sigue PENDIENTE con 1 intento y evento DESACTUALIZADA; el SO de la edicion directa se queda",
                  "51204|PENDIENTE|1|DESACTUALIZADA|SO directo",
                  Error(() => aplicador.Aplicar(d3, @"SORIANA\adm2", null, null, Hoy)) + "|" + alm.Detalle(d3)["estado"] + "|" +
                  alm.Detalle(d3)["intentos"] + "|" + Uno("SELECT TOP (1) Evento FROM adm.SolicitudCambioEvento WHERE IdSolicitud = " + d3 + " ORDER BY IdEvento DESC") + "|" +
                  Problem("PRB 2026-000002").Split('|')[2]);
            alm.Rechazar(d3, @"SORIANA\adm2", "Ya se cambio directo");
            Check("D18 rechazar una DATOS: RECHAZADA, la iniciativa no se toca", "RECHAZADA|SO directo",
                  alm.Detalle(d3)["estado"] + "|" + Problem("PRB 2026-000002").Split('|')[2]);
            Check("D19 la cola lista las DATOS con sus banderas", "True",
                  alm.Listar(null, 50).Exists(s => (string)s["tipo"] == "DATOS" && (bool)s["cambia_so"]));

            // ---------------- P: cuenta del sitio ----------------
            var dp = Enviar(alm, "folio", "PRB 2026-000002", "tipo", "datos", "titulo_nuevo", "Dos sitio");
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                Exec(cn, "DECLARE @c adm.SolicitudClasificacionTipo; EXEC adm.usp_SolicitudCambio_Aplicar @IdSolicitud = " + dp + ", @Revisor = N'SORIANA\\adm9', @Clasificaciones = @c");
            }
            Check("P1 como PROACTIVANETAD: aplica DATOS por el procedimiento (encadenamiento de propietario)", "Dos sitio|APLICADA",
                  Problem("PRB 2026-000002").Split('|')[0] + "|" + alm.Detalle(dp)["estado"]);
            string directo;
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                directo = Error(() => Exec(cn, "UPDATE adm.SolicitudCambio SET TituloNuevo = N'x' WHERE IdSolicitud = " + dp));
            }
            Check("P2 ... pero no puede escribir la tabla a mano (229)", "229", directo);

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                Check("B1 con solicitudes DATOS el rollback se niega sin tocar nada", "True|" + hCrear25 + "|9",
                      LotesError(cn, rb25).Contains("solicitud(es) DATOS") + "|" + Hash(Base, "adm.usp_SolicitudCambio_Crear") + "|" + Columnas25(Base));
            }
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = null;
            Preparar(otra);
            using (var cn = Abrir(otra))
            {
                Aplicar23y24(cn);
                Lotes(cn, sql25);
                var rb = LotesError(cn, rb25);
                Check("B2 sin DATOS: deshecha; Crear / Aplicar EXACTOS a sql/22, 13 parametros, sin columnas ni CHECK de 25",
                      "sin error|" + Crear22 + "|" + Aplicar22 + "|13|0|NULL",
                      rb + "|" + Hash(otra, "adm.usp_SolicitudCambio_Crear") + "|" + Hash(otra, "adm.usp_SolicitudCambio_Aplicar") + "|" +
                      ParametrosCrear(otra) + "|" + Columnas25(otra) + "|" + Uno(otra, "SELECT OBJECT_ID('adm.CK_SolicitudCambio_Datos', 'C')"));
                Check("B3 el CHECK de Tipo vuelve a sus 4 valores (DATOS = 547)", "547",
                      Error(() => Exec(cn, "INSERT adm.SolicitudCambio (Codigo, Tipo, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia) " +
                                           "VALUES (N'PRB 2026-000002', 'DATOS', N'm', N'u', 'MOD', NEWID())")));
                var almOtra = new AlmacenSolicitudesCambioSql(delegate { return Abrir(otra); });
                var kb = almOtra.Enviar(PeticionSolicitudCambio.DesdeFormulario(Form("folio", "PRB 2026-000002", "tipo", "otros")), @"SORIANA\mod1", "MOD");
                Check("B4 con 25 deshecha y el interruptor apagado el sitio sigue enviando y leyendo la cola", "OTROS|False",
                      almOtra.Detalle(kb.IdSolicitud)["tipo"] + "|" + almOtra.Detalle(kb.IdSolicitud)["cambia_titulo"]);
                Check("B5 ahora el rollback de 24 si puede (orden 25 -> 24)", "sin error", LotesError(cn, rb24));
                Lotes(cn, Leer("sql", "24_gestion_admin_modificar_duenos_quitar.sql"));
                Check("B6 volver a aplicar 24 y 25", "sin error|" + hCrear25 + "|9", LotesError(cn, sql25) + "|" + Hash(otra, "adm.usp_SolicitudCambio_Crear") + "|" + Columnas25(otra));
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
            try { Borrar(Base); Borrar(otra); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
