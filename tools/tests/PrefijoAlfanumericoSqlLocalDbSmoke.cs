// Prueba de INTEGRACION de sql/43_gestion_admin_crear_prefijo_alfanumerico.sql
// (+ _rollback) contra bases REALES pero DESECHABLES de SQL Server LocalDB:
// crea GestionAdminPrueba_P43<n>, aplica la replica, el cargador 174bb51,
// las vistas del backend, sql/18, 20-23, 26, 27, 29, 31 y 32 (Crear con el
// hash de sql/27, como la VM), corre los casos y BORRA las bases al final.
// Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: otra base sin aprobar se niega; rollback antes de aplicar
//      se niega; el hash medido es el fijado; firma, permisos y opciones SET
//      iguales; volver a aplicar = "ya aplicada".
//   X  sin sql/43 (hoy): aprobar una S2L da 51021 y la solicitud sigue ENVIADA.
//   A  S2L: sigue la serie que ya hay (S2L 2026-000001 -> 000002), aprobar
//      crea y liga el Codigo, Prefijo calculado = S2L, dos altas a la vez no
//      repiten, un Codigo S2L ilegible = 51023.
//   K  los demas prefijos: ADO / PRB siguen su serie; SEMC (cuatro), 2SL
//      (digito primero), S2 (dos) y una letra acentuada = 51021; fuera del
//      catalogo = 51002; minusculas entran por el UPPER de siempre.
//   R  rechazar una S2L sigue igual y no crea nada.
//   P  la cuenta del sitio (EXECUTE AS PROACTIVANETAD) sigue ejecutando Crear.
//   C  compatibilidad: con 43 aplicada, el rollback de sql/32 y el de sql/27
//      se niegan sin tocar nada.
//   B  rollback: Crear vuelve EXACTO a sql/27; las S2L creadas se quedan;
//      S2L vuelve a 51021; ADO sigue; volver a aplicar 43.
//
// Uso: cwd = raiz del repo. Argumento opcional: carpeta con los dos scripts
// de sql/43 (por omision, sql/).
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class PrefijoAlfanumericoSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Crear27 = "0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD";
    const string Crear43 = "0x0B39CE7220342B020F37DAFA5CD15540D35A3E2A074D043D54EEB6A9FDEA704E";
    const string ADM = @"SORIANA\t_adm";
    static readonly DateTime Hoy = new DateTime(2026, 10, 21);
    static readonly string Adopcion = "Adopci" + (char)0xF3 + "n";
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
    // Como sqlcmd sin -I (u otra herramienta con las opciones apagadas): el
    // script tiene que dejar Crear con las dos en ON por si mismo.
    static string ScriptOpcionesOff(string db, string sql)
    {
        using (var cn = Abrir(db)) { Exec(cn, "SET ANSI_NULLS OFF; SET QUOTED_IDENTIFIER OFF;"); return LotesError(cn, sql); }
    }
    static string Opciones()
    {
        return Uno("SELECT CONCAT(uses_ansi_nulls, uses_quoted_identifier) FROM sys.sql_modules WHERE object_id = OBJECT_ID(N'adm.usp_GestionAdmin_Crear')");
    }
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

    const string HashDe =
        "SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'{0}', N'P')), " +
        "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)";
    static string HashCrear() { return Uno(string.Format(HashDe, "adm.usp_GestionAdmin_Crear")); }
    // Firma, permisos y opciones SET de Crear: lo que el ALTER no debe cambiar.
    static string Huella()
    {
        // Tres consultas: los catalogos del sistema mezclan intercalaciones.
        return Uno("SELECT STRING_AGG(CONCAT_WS(N':', parameter_id, name, TYPE_NAME(user_type_id), max_length, is_output, has_default_value), N',') " +
                   "WITHIN GROUP (ORDER BY parameter_id) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_GestionAdmin_Crear')") + " # " +
               Uno("SELECT STRING_AGG(CONCAT_WS(N':', USER_NAME(grantee_principal_id), permission_name, state_desc), N',') " +
                   "FROM sys.database_permissions WHERE class = 1 AND major_id = OBJECT_ID(N'adm.usp_GestionAdmin_Crear')") + " # " +
               Uno("SELECT CONCAT(uses_quoted_identifier, uses_ansi_nulls) FROM sys.sql_modules WHERE object_id = OBJECT_ID(N'adm.usp_GestionAdmin_Crear')");
    }
    static string Fila(string codigo)
    {
        return Uno("SELECT CONCAT_WS('|', Codigo, Prefijo, ISNULL(TipoIniciativa, 'NULL'), VigenteEnOrigen) FROM dbo.Problem WHERE Codigo = N'" + codigo + "'");
    }

    // EXEC directo de Crear (como Administracion -> Crear), sin estado: no
    // pasa por el tope.
    static string Crear(string prefijo, bool comoSitio = false)
    {
        using (var cn = comoSitio ? ComoSitio() : Abrir(Base))
        using (var c = new SqlCommand(
            "DECLARE @c adm.CategoriaPctTipo; INSERT @c (Categoria, Pct) VALUES (N'/A/Cat 1', 0.01); DECLARE @cod nvarchar(100); " +
            "EXEC adm.usp_GestionAdmin_Crear @Usuario = N'SORIANA\\directo', @Prefijo = @p, @TipoIniciativa = NULL, @TipoAgrupado = NULL, " +
            "@Estado = NULL, @Titulo = N'Directo', @Descripcion = NULL, @Observaciones = NULL, @Categorias = @c, @Hoy = '2026-10-21', " +
            "@Codigo = @cod OUTPUT; SELECT @cod;", cn) { CommandTimeout = 120 })
        {
            c.Parameters.AddWithValue("@p", prefijo);
            return Convert.ToString(c.ExecuteScalar());
        }
    }
    static string CrearError(string prefijo) { string r = null; var e = Error(() => r = Crear(prefijo)); return e == "sin error" ? r : e; }

    static RevisorSolicitudesIniciativaSql Revisor() { return new RevisorSolicitudesIniciativaSql(ComoSitio); }
    static LectorSolicitudesIniciativaSql Lector() { return new LectorSolicitudesIniciativaSql(ComoSitio); }
    static int Solicitud(string tipo, string titulo)
    {
        return new AlmacenSolicitudesSql(ComoSitio).Crear(new AltaSolicitud
        {
            Cuenta = @"SORIANA\andresvr", Token = Guid.NewGuid(), Tipo = tipo, Po = "Jesus Campa Morones", So = "SO 1",
            Categoria = "/A/Cat 1", Director = "Dir 1", Titulo = titulo, Descripcion = "Desc " + titulo, Observaciones = "Obs " + titulo,
            Volumetria = 10, Pct = 0.1000m, RcaExtension = "PDF",
            SolicitanteNombre = "Andres Vera Rios", SolicitanteCorreo = "andresvr@soriana.com", ProductOwnerCorreo = "jesuscamor@soriana.com",
        }).Numero.Valor;
    }
    // Lo que hace el handler con una ENVIADA: solicitud GUARDADA -> peticion
    // -> plan. Estado "" = sin estado (Incompleta), como en Crear.
    static PlanCrearAdmin Plan(int numero)
    {
        var p = AprobacionIniciativa.Peticion(Lector().Detalle(numero), "");
        return PlanificadorGestionAdmin.Crear(p, new ResultadoGestionAdmin { Accion = "crear", CatalogoRevisado = true }, Hoy);
    }
    static string Sol(int n, string columnas)
    {
        return Uno("SELECT CONCAT_WS('|', " + columnas + ") FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = " + n);
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
            Lotes(cn, Leer("sql", "23_cambios_recientes.sql"));
            Lotes(cn, Leer("sql", "26_gestion_admin_crear_volumetria.sql"));
            Lotes(cn, Leer("sql", "27_gestion_admin_crear_subestado.sql"));
            Lotes(cn, Leer("sql", "29_solicitud_iniciativa.sql"));
            Lotes(cn, Leer("sql", "31_solicitud_iniciativa_revision.sql"));
            Lotes(cn, Leer("sql", "32_solicitud_iniciativa_aprobar_crea.sql"));
            // Catalogo como la VM (S2L, SEMC) mas dos prefijos invalidos que
            // solo existen para probar la regla.
            Exec(cn, @"
DELETE FROM dbo.CatPersona;
INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES
 (N'Andres Vera Rios', N'andresvr@soriana.com', 1), (N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1);
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES
 (N'PRB', N'Problem', 1), (N'ADO', N'Adopcion', 1), (N'S2L', N'Shift to Left', 1), (N'SEMC', N'Semaforo', 1),
 (N'2SL', N'Digito primero', 1), (N'S2', N'Dos', 1), (N'" + "S" + (char)0xC1 + @"L', N'Acento', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado) VALUES
 (N'PRB 2026-000005', N'Problem', N'Semilla PRB', N'Cerrado'),
 (N'S2L 2026-000001', N'Shift Left Administrador', N'Semilla S2L (como la VM)', N'Cerrado');
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'S2L 2026-000001', N'/A/Cat 2', N'Shift Left Administrador', N'" + Adopcion + @"', 0, 1);");
        }
    }

    public static int Main(string[] args)
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        var dir = args.Length > 0 ? args[0] : "sql";
        var sql43 = File.ReadAllText(Path.Combine(dir, "43_gestion_admin_crear_prefijo_alfanumerico.sql"));
        var rb43 = File.ReadAllText(Path.Combine(dir, "43_gestion_admin_crear_prefijo_alfanumerico_rollback.sql"));
        var rb32 = Leer("sql", "32_solicitud_iniciativa_aprobar_crea_rollback.sql");
        var rb27 = Leer("sql", "27_gestion_admin_crear_subestado_rollback.sql");
        var t = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        Base = "GestionAdminPrueba_P43" + t;
        var guarda = "P43Guarda_" + t;
        try
        {
            Preparar(Base);

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                  Script(guarda, sql43).Contains("SIN APROBAR") + "|" + Script(guarda, rb43).Contains("SIN APROBAR"));
            Borrar(guarda);
            Check("G2 la base de prueba tiene Crear de sql/27 (el de la VM)", Crear27, HashCrear());
            var huella = Huella();
            Console.WriteLine("      (firma/permisos/opciones de Crear: " + huella + ")");
            Check("G3 rollback antes de aplicar: 'no aplicada', no toca nada", "True|" + Crear27,
                  Script(Base, rb43).Contains("sql/43 no aplicada") + "|" + HashCrear());

            // ---------------- X: hoy (sin 43) ----------------
            var sx = Solicitud("S2L", "Antes de 43");
            Check("X1 sin 43: aprobar una S2L da 51021 y sigue ENVIADA sin Codigo", "51021|ENVIADA|",
                  Error(() => Revisor().AprobarYCrear(sx, ADM, null, Plan(sx))) + "|" + Sol(sx, "Estado, ISNULL(CodigoIniciativa, N'')"));
            var problemAntes = Uno("SELECT COUNT(*) FROM dbo.Problem");

            Check("G4a opciones de Crear ANTES (sql/27): ANSI_NULLS y QUOTED_IDENTIFIER ON", "11", Opciones());
            Check("G4b el script fija las dos en ON antes del ALTER", "True|True",
                  Regex.IsMatch(sql43, @"SET ANSI_NULLS ON;\s*SET QUOTED_IDENTIFIER ON;\s*GO\s*ALTER PROCEDURE adm\.usp_GestionAdmin_Crear") + "|" +
                  Regex.IsMatch(rb43, @"SET ANSI_NULLS ON;\s*SET QUOTED_IDENTIFIER ON;\s*GO\s*ALTER PROCEDURE adm\.usp_GestionAdmin_Crear"));
            var r = ScriptOpcionesOff(Base, sql43);
            Check("G4 sql/43 se aplica desde una sesion con las dos opciones en OFF", "sin error", r);
            Check("G4c opciones de Crear DESPUES: siguen ON", "11", Opciones());
            var medido = HashCrear();
            Console.WriteLine("      (hash de Crear MEDIDO en SQL Server: " + medido + ")");
            Check("G5 hash medido = el fijado en la migracion y en esta prueba", "True|" + Crear43, sql43.Contains(medido) + "|" + medido);
            Check("G6 firma, permisos y opciones SET iguales; dbo.Problem sin filas nuevas", huella + "|" + problemAntes,
                  Huella() + "|" + Uno("SELECT COUNT(*) FROM dbo.Problem"));
            Check("G7 volver a aplicar: 'ya aplicada', no toca nada", "True|" + Crear43, Script(Base, sql43).Contains("ya aplicada") + "|" + HashCrear());
            Check("G8 el rollback pide exactamente este hash", true, rb43.Contains(medido));
            var cuerpo = Uno("SELECT OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear'))");
            Check("G9 la regla quedo en la definicion", "True|False", cuerpo.Contains("N'[A-Z][A-Z0-9][A-Z0-9]'") + "|" + cuerpo.Contains("N'[A-Z][A-Z][A-Z]'"));

            // ---------------- A: S2L ----------------
            var c1 = Crear("S2L");
            Check("A1 Crear S2L sigue la serie existente (S2L 2026-000001 -> 000002); Prefijo calculado S2L",
                  "S2L 2026-000002|S2L|NULL|1", Fila(c1));
            Check("A2 aprobar la S2L que antes fallaba: APROBADA con el siguiente Codigo", "S2L 2026-000003|True|APROBADA|S2L 2026-000003",
                  Revisor().AprobarYCrear(sx, ADM, null, Plan(sx)).Codigo + "|" + "True" + "|" + Sol(sx, "Estado, CodigoIniciativa"));
            Check("A3 la iniciativa aprobada: tipo y agrupacion de S2L (TiposPorPrefijo)", "Shift Left Administrador|" + Adopcion + "|/A/Cat 1",
                  Uno("SELECT CONCAT_WS('|', p.TipoIniciativa, c.TipoAgrupado, c.Categoria) FROM dbo.Problem AS p JOIN dbo.ProblemCategoria AS c ON c.Codigo = p.Codigo " +
                      "WHERE p.Codigo = N'S2L 2026-000003'"));
            var s2 = Solicitud("S2L", "Reintento");
            var a2 = Revisor().AprobarYCrear(s2, ADM, null, Plan(s2));
            var a2b = Revisor().AprobarYCrear(s2, ADM, null, null);
            Check("A4 reintento: el MISMO Codigo, no otro", "S2L 2026-000004|True|S2L 2026-000004|False",
                  a2.Codigo + "|" + a2.Nueva + "|" + a2b.Codigo + "|" + a2b.Nueva);

            // Dos altas S2L a la vez: el candado adm.codigo:S2L:2026 las ordena.
            var codigos = new string[2];
            var hilos = Enumerable.Range(0, 2).Select(i => new Thread(() => { codigos[i] = CrearError("S2L"); })).ToArray();
            foreach (var h in hilos) h.Start();
            foreach (var h in hilos) h.Join();
            Array.Sort(codigos, StringComparer.Ordinal);
            Check("A5 dos altas S2L a la vez: consecutivos distintos", "S2L 2026-000005,S2L 2026-000006", string.Join(",", codigos));

            // ---------------- K: los demas prefijos ----------------
            Check("K1 ADO y PRB siguen su serie", "ADO 2026-000001|PRB 2026-000006", CrearError("ADO") + "|" + CrearError("PRB"));
            Check("K2 SEMC (cuatro letras del catalogo): 51021", "51021", CrearError("SEMC"));
            Check("K3 2SL (digito primero): 51021", "51021", CrearError("2SL"));
            Check("K4 S2 (dos caracteres): 51021", "51021", CrearError("S2"));
            Check("K5 letra acentuada (S" + (char)0xC1 + "L): 51021", "51021", CrearError("S" + (char)0xC1 + "L"));
            Check("K6 fuera del catalogo (X9Z): 51002 antes que el formato", "51002", CrearError("X9Z"));
            Check("K7 minusculas entran por el UPPER de siempre", "S2L 2026-000007", CrearError(" s2l "));

            // ---------------- R: rechazar ----------------
            var sr = Solicitud("S2L", "Rechazo");
            var antesR = Uno("SELECT COUNT(*) FROM dbo.Problem");
            Revisor().Rechazar(sr, ADM, "No procede");
            Check("R1 rechazar una S2L: RECHAZADA, sin Codigo, sin iniciativa", "RECHAZADA||" + antesR,
                  Sol(sr, "Estado, ISNULL(CodigoIniciativa, N'')") + "|" + Uno("SELECT COUNT(*) FROM dbo.Problem"));
            Check("R2 aprobar la rechazada: 51412, nada se crea", "51412|" + antesR,
                  Error(() => Revisor().AprobarYCrear(sr, ADM, null, null)) + "|" + Uno("SELECT COUNT(*) FROM dbo.Problem"));

            // ---------------- P: cuenta del sitio ----------------
            Check("P1 la cuenta del sitio ejecuta Crear S2L (permisos conservados)", "S2L 2026-000008", Crear("S2L", true));

            // ---------------- C: compatibilidad con 32 y 27 ----------------
            var ligas = Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE CodigoIniciativa IS NOT NULL");
            var r32 = Script(Base, rb32);
            Check("C1 con 43: el rollback de sql/32 se niega y no toca nada", "False|" + Crear43 + "|" + ligas + "|1",
                  r32.StartsWith("sin error") + "|" + HashCrear() + "|" + Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE CodigoIniciativa IS NOT NULL") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.procedures WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear')"));
            var r27 = Script(Base, rb27);
            Check("C2 con 43: el rollback de sql/27 se niega (no es la de 27) y no toca nada", "True|" + Crear43,
                  r27.Contains("no es la de sql/27") + "|" + HashCrear());

            // ---------------- B: rollback ----------------
            var s2lAntes = Uno("SELECT COUNT(*) FROM dbo.Problem WHERE Prefijo = N'S2L'");
            r = ScriptOpcionesOff(Base, rb43);
            Check("B1 rollback (sesion con opciones OFF): Crear EXACTO a sql/27, misma firma/permisos, opciones ON", "sin error|" + Crear27 + "|" + huella + "|11",
                  r + "|" + HashCrear() + "|" + Huella() + "|" + Opciones());
            Check("B2 las S2L creadas se quedan", s2lAntes, Uno("SELECT COUNT(*) FROM dbo.Problem WHERE Prefijo = N'S2L'"));
            Check("B3 S2L vuelve a 51021; ADO sigue", "51021|ADO 2026-000002", CrearError("S2L") + "|" + CrearError("ADO"));
            Check("B4 rollback otra vez: 'no aplicada'", true, Script(Base, rb43).Contains("sql/43 no aplicada"));
            Check("B5 volver a aplicar 43 y sigue la serie S2L", "sin error|" + Crear43 + "|S2L 2026-000009",
                  Script(Base, sql43) + "|" + HashCrear() + "|" + CrearError("S2L"));

            // Al final: los eventos de dbo.Problem solo agregan y esta fila no
            // se puede quitar; desde aqui S2L 2026 queda bloqueado en la base.
            Exec("INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado) VALUES (N'S2L 2026-00A', NULL, N'Ilegible', N'Cerrado');");
            Check("A6 un Codigo S2L ilegible: 51023 (no se adivina); ADO no se afecta", "51023|ADO 2026-000003", CrearError("S2L") + "|" + CrearError("ADO"));

            var banderas = Regex.Matches(sql43 + rb43, @"SESSION_CONTEXT\(N'([a-z_0-9]+)'\)").Cast<Match>().Select(x => x.Groups[1].Value).Distinct().ToArray();
            Check("Z1 sin banderas para forzar (solo aprobar_migracion)", "aprobar_migracion", string.Join(",", banderas));
            // Fuera del cuerpo de Crear (sus INSERT son los de siempre).
            var fuera = Regex.Replace(sql43 + rb43, @"^ALTER PROCEDURE.*?^GO\s*$", "", RegexOptions.Singleline | RegexOptions.Multiline);
            Check("Z2 sql/43 no escribe tablas: solo ALTER de Crear", "False|1|1",
                  Regex.IsMatch(fuera, @"^\s*(UPDATE|INSERT|DELETE|DROP|ALTER\s+TABLE)\b", RegexOptions.IgnoreCase | RegexOptions.Multiline) + "|" +
                  Regex.Matches(sql43, @"^ALTER PROCEDURE", RegexOptions.Multiline).Count + "|" + Regex.Matches(rb43, @"^ALTER PROCEDURE", RegexOptions.Multiline).Count);
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
