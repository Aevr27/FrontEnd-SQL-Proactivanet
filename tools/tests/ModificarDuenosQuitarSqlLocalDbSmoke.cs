// Prueba de INTEGRACION de sql/24_gestion_admin_modificar_duenos_quitar.sql
// (+ _rollback) con el escritor de Admin (EscritorGestionAdminSql, con
// PersistenciaGestionAdmin.ModificaDuenosYQuita forzado en la prueba) y la
// lectura del registro (due\u00f1os capturados e iniciativas sin categoria),
// contra bases REALES pero DESECHABLES de SQL Server LocalDB: crea
// GestionAdminPrueba_Q24<n>, aplica la replica, el cargador 174bb51, las
// vistas del backend, sql/18, 20, 21, 22 + permisos (la VM hoy), corre los
// casos y BORRA las bases al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base), exige sql/23 antes, hash y firma,
//      ya aplicada, Aplicar sin cambio.
//   K  compatibilidad: el sitio sin el interruptor y Aplicar (sql/22) siguen
//      igual sobre el procedimiento de sql/24.
//   D  PO / SO capturados: se guardan, se vacian, 255, se ven en la MISMA
//      lectura del registro; los de la categoria no cambian; proteccion y
//      sello solo con cambio real.
//   Q  quitar: VigenteEnOrigen = 0 (la fila se queda, el historial con FK
//      tambien), solo esa asociacion, libera capacidad, reemplazar en un
//      guardado, atomico ante tope, errores 51007 / 51018 / 51008.
//   P  cuenta del sitio (EXECUTE AS PROACTIVANETAD): owners y quitar por
//      encadenamiento de propietario.
//   B  rollback: Modificar vuelve EXACTO a sql/23; los datos se quedan;
//      volver a aplicar.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;

public static class ModificarDuenosQuitarSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Modificar22 = "0x8E0848187A529F6E0C2D9D8B30820F0EA19CCDEC7C7937EFB41BF33108084BA9";
    const string Modificar23 = "0x816268254935C77FEE7F325E7E2663D828410EA9242E1037AB1BC3BD4D3F8CB7";
    const string Aplicar22 = "0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1";
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
    static string Parametros() { return Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')"); }

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
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1), (N'c3', N'/B/Cat 3', 1), (N'c4', N'/B/Cat 4', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, FechaAnalisis, FechaSolucion, FechaCierre, OwnerProblem, OwnerServicio) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'En Soluci" + "\u00f3" + @"n', NULL, '2026-08-01', '2026-11-15', '2026-12-20', N'PO viejo', N'SO viejo'),
 (N'PRB 2026-000002', N'Problem', N'Dos', N'En An" + "\u00e1" + @"lisis', NULL, '2026-09-01', NULL, NULL, NULL, NULL),
 (N'PRB 2026-000003', N'Problem', N'Tres sin categoria', N'En An" + "\u00e1" + @"lisis', NULL, '2026-09-01', NULL, NULL, NULL, NULL);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/A/Cat 1', N'Problem', N'Problem', 0.3000, 1),
 (N'PRB 2026-000001', N'/A/Cat 2', N'Problem', N'Problem', 0.2000, 1),
 (N'PRB 2026-000002', N'/A/Cat 2', N'Problem', N'Problem', 0.5000, 1);");
        }
    }

    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    static void Modificar(PlanModificarAdmin plan, string usuario)
    {
        using (var cn = Abrir(Base)) new EscritorGestionAdminSql().Modificar(cn, null, plan, usuario);
    }
    static PlanModificarAdmin Plan(string codigo, params string[] kv)
    {
        var p = new PlanModificarAdmin { Codigo = codigo, Hoy = Hoy };
        for (var i = 0; i < kv.Length; i += 2) p.Problem[kv[i]] = kv[i + 1];
        return p;
    }
    static PlanModificarAdmin Quitar(string codigo, params string[] rutas)
    {
        var p = Plan(codigo);
        p.Quitar.AddRange(rutas);
        return p;
    }
    static CategoriaPlan Agregar(string ruta, decimal pct)
    {
        return new CategoriaPlan { Ruta = ruta, Pct = pct, TipoIniciativa = "Problem", TipoAgrupado = "Problem", FechaCreacion = Hoy, FechaAnalisis = Hoy.AddDays(15) };
    }
    static string Owners(string codigo)
    {
        return Uno("SELECT ISNULL(OwnerProblem, 'NULL') + '|' + ISNULL(OwnerServicio, 'NULL') FROM dbo.Problem WHERE Codigo = N'" + codigo + "'");
    }
    static string Vigentes(string codigo)
    {
        return Uno("SELECT ISNULL(STRING_AGG(Categoria + '=' + CONVERT(varchar(1), VigenteEnOrigen), ',') WITHIN GROUP (ORDER BY Categoria), '') " +
                   "FROM dbo.ProblemCategoria WHERE Codigo = N'" + codigo + "'");
    }
    static string Protegida(string codigo)
    {
        return Uno("SELECT ISNULL(MAX(Motivo + '|' + ISNULL(UltimoCambioUsuario, 'NULL')), 'NO') FROM adm.IniciativaProtegida WHERE Codigo = N'" + codigo + "'");
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

    // Iniciativas sin categoria del registro (ExperienciaQueries.
    // LeerIniciativasSinCategoria): su po / so son los del Problem.
    static string RegistroSinCategoria(string codigo)
    {
        var tipo = typeof(PlanificadorGestionAdmin).Assembly.GetType("ExperienciaQueries");
        var leer = tipo.GetMethod("LeerIniciativasSinCategoria", BindingFlags.NonPublic | BindingFlags.Static);
        using (var cn = Abrir(Base))
        {
            var filas = (IEnumerable)leer.Invoke(null, new object[] { cn, Hoy, DirectorioOrganizacional.Cargar(cn) });
            foreach (Dictionary<string, object> f in filas)
                if ((string)f["folio"] == codigo) return (f["po"] ?? "NULL") + "|" + (f["so"] ?? "NULL");
        }
        return "no esta";
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        Base = "GestionAdminPrueba_Q24" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var guarda = "Q24Guarda_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql23 = Leer("sql", "23_cambios_recientes.sql");
        var sql24 = Leer("sql", "24_gestion_admin_modificar_duenos_quitar.sql");
        var rb24 = Leer("sql", "24_gestion_admin_modificar_duenos_quitar_rollback.sql");
        var h24 = Regex.Match(sql24, @"POSTCONDICION \(si no, ROLLBACK\)\s+Modificar (0x[0-9A-F]{64})").Groups[1].Value;
        try
        {
            Preparar(Base);
            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
            {
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql24).Contains("SIN APROBAR") + "|" + LotesError(g, rb24).Contains("SIN APROBAR"));
            }
            Borrar(guarda);
            using (var cn = Abrir(Base))
            {
                Check("G2 con sql/22 sola (sin sql/23): se niega pidiendo sql/23; Modificar sigue siendo el de sql/22", "True|" + Modificar22 + "|23",
                      LotesError(cn, sql24).Contains("Aplica sql/23 antes") + "|" + Hash("adm.usp_GestionAdmin_Modificar") + "|" + Parametros());
                Lotes(cn, sql23);
                Check("G3 rollback de 24 antes de aplicarla: se niega sin tocar nada", "True|" + Modificar23,
                      LotesError(cn, rb24).Contains("no es la de sql/24") + "|" + Hash("adm.usp_GestionAdmin_Modificar"));
                var r24 = LotesError(cn, sql24);
                Console.WriteLine("      hash Modificar 24 = " + Hash("adm.usp_GestionAdmin_Modificar") + "  (" + r24 + ")");
                Check("G4 aplicada: Modificar con el hash de sql/24, 28 parametros, Aplicar sin cambio", "sin error|" + h24 + "|28|" + Aplicar22,
                      r24 + "|" + Hash("adm.usp_GestionAdmin_Modificar") + "|" + Parametros() + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
                Check("G5 aplicarla otra vez: 'ya aplicada', sin tocar nada", "True|" + h24,
                      LotesError(cn, sql24).Contains("ya aplicada") + "|" + Hash("adm.usp_GestionAdmin_Modificar"));
            }

            // ---------------- K: compatibilidad ----------------
            PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = false;
            Modificar(Plan("PRB 2026-000002", SolicitudIniciativa.CTitulo, "Dos editado"), @"SORIANA\adm1");
            Check("K1 el sitio SIN el interruptor (no manda owners ni @Quitar) sigue guardando", "Dos editado|NULL|NULL",
                  Uno("SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2026-000002'") + "|" + Owners("PRB 2026-000002"));
            var alm = new AlmacenSolicitudesCambioSql(delegate { return Abrir(Base); });
            var aplicador = new AplicadorSolicitudCambio(alm, delegate { return new ValidacionAplicar { Valida = true }; });
            var pf = new NameValueCollection { { "folio", "PRB 2026-000002" }, { "tipo", "fecha" }, { "campo_fecha", "f_analisis" },
                                               { "fecha_nueva", "2026-12-15" }, { "motivo", "m" }, { "llave", Guid.NewGuid().ToString() } };
            var eF = alm.Enviar(PeticionSolicitudCambio.DesdeFormulario(pf), @"SORIANA\mod1", "MOD");
            aplicador.Aplicar(eF.IdSolicitud, @"SORIANA\adm2", "ok", null, Hoy);
            Check("K2 Aplicar de sql/22 (llama a Modificar sin los parametros nuevos) sigue aplicando", "APLICADA|2026-12-15",
                  alm.Detalle(eF.IdSolicitud)["estado"] + "|" + Uno("SELECT CONVERT(varchar(10), FechaAnalisis, 23) FROM dbo.Problem WHERE Codigo = N'PRB 2026-000002'"));

            PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = true;
            // ---------------- D: PO / SO capturados ----------------
            var catAntes = Uno("SELECT COUNT(*) FROM dbo.CatCategoriaDueno") + "|" + Uno("SELECT COUNT(*) FROM dbo.Categorias");
            // Contenido (no solo cuantas filas) del catalogo de duenos y de
            // las categorias ligadas, y los owners de OTRA iniciativa.
            const string SumaCat =
                "SELECT CONVERT(varchar(20), ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.CatCategoriaDueno), 0)) + '|' + " +
                "CONVERT(varchar(20), ISNULL((SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.ProblemCategoria), 0))";
            var sumaAntes = Uno(SumaCat);
            var otraAntes = Owners("PRB 2026-000002");
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CPo, "PO nuevo"), @"SORIANA\adm3");
            Check("D1 PO: OwnerProblem cambia; OwnerServicio igual", "PO nuevo|SO viejo", Owners("PRB 2026-000001"));
            Check("D2 ... y el registro lo ve al refrescar (po_capturado / so_capturado)", "PO nuevo|SO viejo", RegistroCapturados("PRB 2026-000001"));
            Check("D3 cambio real de PO: protege y sella con el usuario (sql/18 + sql/23)", "MODIFICACION|SORIANA\\adm3", Protegida("PRB 2026-000001"));
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CSo, "SO nuevo"), @"SORIANA\adm4");
            Check("D4 SO: OwnerServicio cambia; OwnerProblem igual; sella", "PO nuevo|SO nuevo|MODIFICACION|SORIANA\\adm4",
                  Owners("PRB 2026-000001") + "|" + Protegida("PRB 2026-000001"));
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CPo, "PO nuevo"), @"SORIANA\adm5");
            Check("D5 mismo PO (sin cambio real): el sello NO cambia", "MODIFICACION|SORIANA\\adm4", Protegida("PRB 2026-000001"));
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CPo, ""), @"SORIANA\adm5");
            Check("D6 vaciar el PO: NULL (no '')", "NULL|SO nuevo", Owners("PRB 2026-000001"));
            Check("D7 PO de 256 caracteres: 51027 y nada cambia", "51027|NULL|SO nuevo",
                  Error(() => Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CPo, new string('x', 256)), @"SORIANA\adm5")) + "|" + Owners("PRB 2026-000001"));
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CPo, "  PO recortado  "), @"SORIANA\adm5");
            Check("D8 PO con espacios: se guarda recortado (como en Crear)", "PO recortado|SO nuevo", Owners("PRB 2026-000001"));
            Modificar(Plan("PRB 2026-000003", SolicitudIniciativa.CPo, "PO suelto", SolicitudIniciativa.CSo, "SO suelto",
                           SolicitudIniciativa.CTitulo, "Tres editado"), @"SORIANA\adm6");
            Check("D9 sin categoria: titulo + PO + SO en un guardado; el registro (sin categoria) los muestra en po / so", "Tres editado|PO suelto|SO suelto",
                  Uno("SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2026-000003'") + "|" + RegistroSinCategoria("PRB 2026-000003"));
            Check("D10 los duenos de la categoria y el catalogo no se tocan", catAntes,
                  Uno("SELECT COUNT(*) FROM dbo.CatCategoriaDueno") + "|" + Uno("SELECT COUNT(*) FROM dbo.Categorias"));
            Check("D11 PO / SO capturados: ni el contenido de CatCategoriaDueno ni el de ProblemCategoria cambian", sumaAntes, Uno(SumaCat));
            Check("D12 PO / SO capturados: otra iniciativa (PRB 2) conserva sus owners", otraAntes, Owners("PRB 2026-000002"));

            // ---------------- Q: quitar ----------------
            Check("Q0 tope: PRB 2 no puede ligar /A/Cat 1 al 75% con PRB 1 al 30% (51010)", "51010",
                  Error(() => { var p = Plan("PRB 2026-000002"); p.Agregar.Add(Agregar("/A/Cat 1", 0.75m)); Modificar(p, @"SORIANA\adm7"); }));
            Modificar(Quitar("PRB 2026-000001", "/A/Cat 1"), @"SORIANA\adm7");
            Check("Q1 quitar /A/Cat 1 de PRB 1: VigenteEnOrigen = 0, la fila se queda; /A/Cat 2 igual", "/A/Cat 1=0,/A/Cat 2=1", Vigentes("PRB 2026-000001"));
            Check("Q2 solo la asociacion: la categoria sigue en el catalogo y en otras iniciativas", "1|/A/Cat 2=1",
                  Uno("SELECT COUNT(*) FROM dbo.Categorias WHERE RutaCompleta = N'/A/Cat 1' AND VigenteEnOrigen = 1") + "|" + Vigentes("PRB 2026-000002"));
            Check("Q3 quitar es cambio real: sella", "MODIFICACION|SORIANA\\adm7", Protegida("PRB 2026-000001"));
            Check("Q4 la vista del registro ya no la trae (VigenteEnOrigen = 1)", "0",
                  Uno("SELECT COUNT(*) FROM dbo.vw_ProblemCategoria WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/A/Cat 1' AND VigenteEnOrigen = 1"));
            Check("Q5 libera capacidad: ahora PRB 2 SI liga /A/Cat 1 al 75%", "sin error",
                  Error(() => { var p = Plan("PRB 2026-000002"); p.Agregar.Add(Agregar("/A/Cat 1", 0.75m)); Modificar(p, @"SORIANA\adm7"); }));
            Check("Q6 quitar una no ligada (o ya quitada): 51007", "51007|51007",
                  Error(() => Modificar(Quitar("PRB 2026-000001", "/B/Cat 3"), @"SORIANA\adm7")) + "|" +
                  Error(() => Modificar(Quitar("PRB 2026-000001", "/A/Cat 1"), @"SORIANA\adm7")));
            Check("Q7 volver a ligar la quitada: 51008 (como hoy)", "51008",
                  Error(() => { var p = Plan("PRB 2026-000001"); p.Agregar.Add(Agregar("/A/Cat 1", 0.1m)); Modificar(p, @"SORIANA\adm7"); }));
            Check("Q8 cambiar el % y quitar la misma: 51018, nada cambia", "51018|/A/Cat 1=0,/A/Cat 2=1",
                  Error(() => { var p = Quitar("PRB 2026-000001", "/A/Cat 2"); p.Pcts.Add(new CategoriaPlan { Ruta = "/A/Cat 2", Pct = 0.1m }); Modificar(p, @"SORIANA\adm7"); }) + "|" +
                  Vigentes("PRB 2026-000001"));
            Check("Q9 quitar repetida: 51003", "51003", Error(() => Modificar(Quitar("PRB 2026-000001", "/A/Cat 2", " /A/Cat 2"), @"SORIANA\adm7")));
            var p90 = Plan("PRB 2026-000002"); p90.Agregar.Add(Agregar("/B/Cat 4", 0.9m)); Modificar(p90, @"SORIANA\adm7");
            Check("Q10 reemplazar por encima del tope (quitar /A/Cat 2 + ligar /B/Cat 4 al 15% con otro al 90%): 51010 y NO se quita (atomico)",
                  "51010|/A/Cat 1=0,/A/Cat 2=1",
                  Error(() => { var p = Quitar("PRB 2026-000001", "/A/Cat 2"); p.Agregar.Add(Agregar("/B/Cat 4", 0.15m)); Modificar(p, @"SORIANA\adm7"); }) + "|" +
                  Vigentes("PRB 2026-000001"));
            // Ligada con fecha PROPIA y un evento de historial (FK a la fila).
            var pl = Plan("PRB 2026-000001"); pl.Agregar.Add(Agregar("/B/Cat 3", 0.1m)); Modificar(pl, @"SORIANA\adm8");
            var pf2 = Plan("PRB 2026-000001"); pf2.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = "/B/Cat 3", FechaAnalisis = Hoy.AddDays(30) }); Modificar(pf2, @"SORIANA\adm8");
            var eventos = Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/B/Cat 3'");
            var pr = Quitar("PRB 2026-000001", "/A/Cat 2"); pr.Agregar.Add(Agregar("/B/Cat 4", 0.1m)); Modificar(pr, @"SORIANA\adm8");
            Check("Q11 reemplazar en UN guardado (quitar /A/Cat 2 + ligar /B/Cat 4)", "/A/Cat 1=0,/A/Cat 2=0,/B/Cat 3=1,/B/Cat 4=1", Vigentes("PRB 2026-000001"));
            Modificar(Quitar("PRB 2026-000001", "/B/Cat 3"), @"SORIANA\adm8");
            Check("Q12 quitar una con historial: sin DELETE (la FK no estorba) y el historial se queda", "/B/Cat 3=0|" + eventos + "|True",
                  Uno("SELECT Categoria + '=' + CONVERT(varchar(1), VigenteEnOrigen) FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/B/Cat 3'") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000001' AND Categoria = N'/B/Cat 3'") + "|" + (eventos != "0"));
            Modificar(Quitar("PRB 2026-000001", "/B/Cat 4"), @"SORIANA\adm8");
            Check("Q13 quitar la ultima: la iniciativa pasa a 'sin categoria' en el registro (po / so del Problem)", "PO recortado|SO nuevo",
                  RegistroSinCategoria("PRB 2026-000001"));

            // ---------------- P: cuenta del sitio ----------------
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                var p = Plan("PRB 2026-000002", SolicitudIniciativa.CSo, "SO sitio"); p.Quitar.Add("/A/Cat 1");
                new EscritorGestionAdminSql().Modificar(cn, null, p, @"SORIANA\adm9");
            }
            Check("P1 como PROACTIVANETAD: SO y quitar por el procedimiento (encadenamiento de propietario)", "NULL|SO sitio|/A/Cat 1=0,/A/Cat 2=1,/B/Cat 4=1",
                  Owners("PRB 2026-000002") + "|" + Vigentes("PRB 2026-000002"));
            string directo;
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                directo = Error(() => Exec(cn, "UPDATE adm.IniciativaProtegida SET Motivo = 'ALTA' WHERE Codigo = N'PRB 2026-000002'"));
            }
            Check("P2 ... pero sigue sin poder escribir la proteccion a mano (229)", "229", directo);

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                Lotes(cn, rb24);
                Check("B1 rollback: Modificar EXACTO de sql/23, 23 parametros; Aplicar igual", Modificar23 + "|23|" + Aplicar22,
                      Hash("adm.usp_GestionAdmin_Modificar") + "|" + Parametros() + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
                Check("B2 los datos se quedan (owners y bajas)", "NULL|SO sitio|/A/Cat 1=0,/A/Cat 2=1,/B/Cat 4=1",
                      Owners("PRB 2026-000002") + "|" + Vigentes("PRB 2026-000002"));
                PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = true;
                Check("B3 con 24 deshecha y el interruptor encendido: el guardado falla con 349 (por eso se apaga ANTES)", "349",
                      Error(() => Modificar(Plan("PRB 2026-000002", SolicitudIniciativa.CPo, "x"), @"SORIANA\adm9")));
                PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = false;
                Modificar(Plan("PRB 2026-000002", SolicitudIniciativa.CTitulo, "Dos tras rollback"), @"SORIANA\adm9");
                Check("B4 con el interruptor apagado el sitio sigue guardando sobre sql/23", "Dos tras rollback",
                      Uno("SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2026-000002'"));
                Lotes(cn, sql24);
                Check("B5 volver a aplicar sql/24 despues del rollback", h24 + "|28", Hash("adm.usp_GestionAdmin_Modificar") + "|" + Parametros());
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = null;
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
