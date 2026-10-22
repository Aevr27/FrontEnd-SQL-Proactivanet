// Prueba de INTEGRACION de sql/23_cambios_recientes.sql (+ _rollback) con
// App_Code/CambiosRecientesAdmin.cs (FuenteCambiosRecientesSql), el escritor
// de Admin (EscritorGestionAdminSql) y el de solicitudes
// (AlmacenSolicitudesCambioSql), contra bases REALES pero DESECHABLES de SQL
// Server LocalDB: crea GestionAdminPrueba_Rec<n>, aplica la replica, el
// cargador 174bb51, las vistas del backend, sql/18, 20, 21, 22 + permisos
// (la VM hoy) y el DENY de sql/18 sec. 8; corre los casos y BORRA las bases
// al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base), precondicion, columnas/CHECK/hashes,
//      ya aplicada, filas existentes en NULL.
//   L  lector antes de sql/23 (sin_columna) y vacio despues.
//   C  Crear sella el alta (usuario del servidor).
//   M  Modificar: cambio real sella (inserta o actualiza); sin cambio real
//      no toca nada; Motivo/Usuario/FechaAltaUtc no cambian; falla a media
//      transaccion no deja ni cambio ni sello.
//   A  Aplicar: sella con quien aplico; Otros y desactualizada no sellan.
//   R  lector: orden descendente, limite, sin MIGRACION ni NULL, empates.
//   P  cuenta del sitio: lee; no puede escribir el sello a mano; los
//      procedimientos si sellan.
//   B  rollback: se niega con sellos; con la bandera vuelve EXACTO a
//      sql/21 / sql/22; volver a aplicar.
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

public static class CambiosRecientesSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Crear21 = "0x540F83EF4AF3AB4A3D3E2E8E7B6D4DE75B7731E98085DAD11CF54B14A4478D79";
    const string Modificar22 = "0x8E0848187A529F6E0C2D9D8B30820F0EA19CCDEC7C7937EFB41BF33108084BA9";
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
            // La cuenta del sitio, como en la VM (sin login: EXECUTE AS USER),
            // con el GRANT/DENY de sql/18 sec. 8 y los permisos de sql/22.
            Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                     "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::dbo TO [PROACTIVANETAD]; " +
                     "GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD]; DENY INSERT, UPDATE, DELETE ON adm.IniciativaProtegida TO [PROACTIVANETAD];");
            Lotes(cn, Leer("sql", "22_solicitudes_cambio_permisos.sql"));
            Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1), (N'c3', N'/B/Cat 3', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, FechaAnalisis, FechaSolucion, FechaCierre) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'En Soluci" + "ó" + @"n', NULL, '2026-08-01', '2026-11-15', '2026-12-20'),
 (N'PRB 2026-000002', N'Problem', N'Dos', N'En An" + "á" + @"lisis', NULL, '2026-09-01', NULL, NULL),
 (N'PRB 2026-000003', N'Problem', N'Tres', N'En Monitoreo', N'Solucionado', NULL, NULL, '2026-12-01'),
 (N'PRB 2026-000004', N'Problem', N'Cuatro', N'En An" + "á" + @"lisis', NULL, '2026-10-01', NULL, NULL),
 (N'PRB 2026-000005', N'Problem', N'Cinco', N'Cerrado', NULL, NULL, NULL, NULL);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/A/Cat 1', N'Problem', N'Problem', 0.3000, 1),
 (N'PRB 2026-000002', N'/A/Cat 2', N'Problem', N'Problem', 0.5000, 1);
-- Protegidas ANTES de sql/23: una por alta y otra MIGRACION.
INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario, FechaAltaUtc) VALUES
 (N'PRB 2026-000004', 'MODIFICACION', N'SORIANA\viejo', '2026-10-01T10:00:00'),
 (N'PRB 2026-000005', 'MIGRACION', N'SORIANA\viejo', '2026-10-01T11:00:00');");
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

    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
        catch (ErrorSolicitudCambio ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }

    // Sello completo de un Codigo: "Motivo|Usuario|FechaAltaUtc|UltimoCambioUtc|UltimoCambioUsuario".
    static string Fila(string codigo)
    {
        return Uno("SELECT Motivo + '|' + Usuario + '|' + CONVERT(varchar(19), FechaAltaUtc, 126) + '|' + " +
                   "ISNULL(CONVERT(varchar(23), UltimoCambioUtc, 126), 'NULL') + '|' + ISNULL(UltimoCambioUsuario, 'NULL') " +
                   "FROM adm.IniciativaProtegida WHERE Codigo = N'" + codigo + "'");
    }
    static string Sello(string codigo)
    {
        return Uno("SELECT ISNULL(CONVERT(varchar(23), UltimoCambioUtc, 126), 'NULL') + '|' + ISNULL(UltimoCambioUsuario, 'NULL') " +
                   "FROM adm.IniciativaProtegida WHERE Codigo = N'" + codigo + "'");
    }

    static void Modificar(PlanModificarAdmin plan, string usuario)
    {
        using (var cn = Abrir(Base)) new EscritorGestionAdminSql().Modificar(cn, null, plan, usuario);
    }
    static PlanModificarAdmin Plan(string codigo, string campo, string valor)
    {
        var p = new PlanModificarAdmin { Codigo = codigo, Hoy = Hoy };
        if (campo != null) p.Problem[campo] = valor;
        return p;
    }
    static string Folios(LecturaCambiosRecientes l)
    {
        return string.Join(",", l.Cambios.Select(c => c.Folio.Substring(9)).ToArray());
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        Base = "GestionAdminPrueba_Rec" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var guarda = "RecGuarda23_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql23 = Leer("sql", "23_cambios_recientes.sql");
        var rb23 = Leer("sql", "23_cambios_recientes_rollback.sql");
        var lector = new FuenteCambiosRecientesSql(delegate { return Abrir(Base); });
        try
        {
            Preparar(Base);
            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
            {
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql23).Contains("SIN APROBAR") + "|" + LotesError(g, rb23).Contains("SIN APROBAR"));
            }
            Borrar(guarda);
            Check("G2 precondicion: Crear de sql/21, Modificar y Aplicar de sql/22", Crear21 + "|" + Modificar22 + "|" + Aplicar22,
                  Hash("adm.usp_GestionAdmin_Crear") + "|" + Hash("adm.usp_GestionAdmin_Modificar") + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
            var l0 = lector.Leer(10);
            Check("L1 lector ANTES de sql/23: sin_columna, sin filas (no falla)", "sin_columna|0", l0.Estado + "|" + l0.Cambios.Count);
            using (var cn = Abrir(Base))
            {
                Check("G3 rollback antes de aplicar: se niega sin tocar nada", true, LotesError(cn, rb23).Contains("no es la de sql/23"));
                Lotes(cn, sql23);
                Console.WriteLine("      hash Crear 23     = " + Hash("adm.usp_GestionAdmin_Crear"));
                Console.WriteLine("      hash Modificar 23 = " + Hash("adm.usp_GestionAdmin_Modificar"));
                Check("G4 aplicada: 2 columnas, CHECK, Aplicar sin cambio", "2|1|" + Aplicar22,
                      Uno("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('adm.IniciativaProtegida') AND name IN ('UltimoCambioUtc', 'UltimoCambioUsuario')") + "|" +
                      Uno("SELECT COUNT(*) FROM sys.check_constraints WHERE name = 'CK_IniciativaProtegida_UltimoCambio'") + "|" + Hash("adm.usp_SolicitudCambio_Aplicar"));
                Check("G5 aplicarla otra vez: 'ya aplicada', sin tocar nada", true, LotesError(cn, sql23).Contains("ya aplicada"));
            }
            Check("G6 filas existentes quedan en NULL (MODIFICACION y MIGRACION; Motivo/Usuario/FechaAltaUtc igual)",
                  "MODIFICACION|SORIANA\\viejo|2026-10-01T10:00:00|NULL|NULL // MIGRACION|SORIANA\\viejo|2026-10-01T11:00:00|NULL|NULL",
                  Fila("PRB 2026-000004") + " // " + Fila("PRB 2026-000005"));
            var l1 = lector.Leer(10);
            Check("L2 lector despues de sql/23, sin cambios guardados: ok y vacio", "ok|0", l1.Estado + "|" + l1.Cambios.Count);
            Check("G7 CHECK: sello sin usuario o usuario sin sello se rechazan (547)", "547|547",
                  Error(() => { using (var cn = Abrir(Base)) Exec(cn, "UPDATE adm.IniciativaProtegida SET UltimoCambioUtc = SYSUTCDATETIME() WHERE Codigo = N'PRB 2026-000004'"); }) + "|" +
                  Error(() => { using (var cn = Abrir(Base)) Exec(cn, "UPDATE adm.IniciativaProtegida SET UltimoCambioUsuario = N'  ' WHERE Codigo = N'PRB 2026-000004'"); }));

            // ---------------- C: Crear ----------------
            var antes = DateTime.UtcNow.AddSeconds(-2);
            var plan = new PlanCrearAdmin
            {
                Prefijo = "PRB", TipoIniciativa = "Problem", TipoAgrupado = "Problem", Estado = "En Análisis",
                Titulo = "[PRUEBA] alta", FechaCreacion = Hoy, FechaAnalisis = Hoy.AddDays(15), FechaEntregaAnalisis = Hoy,
            };
            plan.Categorias.Add(new CategoriaPlan { Ruta = "/B/Cat 3", Pct = 0.1m });
            string nuevo;
            using (var cn = Abrir(Base)) nuevo = new EscritorGestionAdminSql().Crear(cn, null, plan, @"SORIANA\adm1");
            Check("C1 Crear: fila ALTA con sello del mismo usuario, hora UTC de ahora", "ALTA|SORIANA\\adm1|SORIANA\\adm1|True",
                  Uno("SELECT Motivo + '|' + Usuario + '|' + UltimoCambioUsuario + '|' + CASE WHEN UltimoCambioUtc BETWEEN '" +
                      antes.ToString("yyyy-MM-ddTHH:mm:ss") + "' AND DATEADD(SECOND, 5, SYSUTCDATETIME()) THEN 'True' ELSE 'False' END " +
                      "FROM adm.IniciativaProtegida WHERE Codigo = N'" + nuevo + "'"));
            var lc = lector.Leer(10);
            Check("C2 lector: el alta aparece como 'alta'", nuevo + "|True|SORIANA\\adm1", lc.Cambios[0].Folio + "|" + lc.Cambios[0].EsAlta + "|" + lc.Cambios[0].Usuario);

            // ---------------- M: Modificar ----------------
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CTitulo, "Uno"), @"SORIANA\adm2");
            Check("M1 sin cambio real (mismo titulo) en una NO protegida: ni fila ni sello", "0",
                  Uno("SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2026-000001'"));
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CTitulo, "Uno editado"), @"SORIANA\adm2");
            var s1 = Sello("PRB 2026-000001");
            Check("M2 cambio real en una NO protegida: MODIFICACION + sello con el usuario", "MODIFICACION|SORIANA\\adm2|SORIANA\\adm2",
                  Uno("SELECT Motivo + '|' + Usuario + '|' + UltimoCambioUsuario FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2026-000001'"));
            Thread.Sleep(30);
            Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CTitulo, "Uno editado"), @"SORIANA\adm3");
            Check("M3 sin cambio real en una protegida: el sello NO cambia (ni hora ni usuario)", s1, Sello("PRB 2026-000001"));
            var plCat = new PlanModificarAdmin { Codigo = "PRB 2026-000001", Hoy = Hoy };
            plCat.Pcts.Add(new CategoriaPlan { Ruta = "/A/Cat 1", Pct = 0.3m });
            Modificar(plCat, @"SORIANA\adm3");
            Check("M4 mismo % de categoria (sin cambio real): el sello NO cambia", s1, Sello("PRB 2026-000001"));
            var filaAntes4 = Fila("PRB 2026-000004");
            Modificar(Plan("PRB 2026-000004", PeticionModificarAdmin.CSubestado, "Solucionado"), @"SORIANA\adm3");
            var f4 = Fila("PRB 2026-000004").Split('|');
            Check("M5 cambio real (Subestado) en una ya protegida: actualiza el sello; Motivo/Usuario/FechaAltaUtc igual",
                  "MODIFICACION|SORIANA\\viejo|2026-10-01T10:00:00|True|SORIANA\\adm3",
                  f4[0] + "|" + f4[1] + "|" + f4[2] + "|" + (f4[3] != "NULL") + "|" + f4[4]);
            Thread.Sleep(30);
            var plPct = new PlanModificarAdmin { Codigo = "PRB 2026-000001", Hoy = Hoy };
            plPct.Pcts.Add(new CategoriaPlan { Ruta = "/A/Cat 1", Pct = 0.35m });
            Modificar(plPct, @"SORIANA\adm4");
            var s2 = Sello("PRB 2026-000001");
            Check("M6 cambio real solo de % (no hay historial para eso): sella con hora posterior y el nuevo usuario", "True|SORIANA\\adm4",
                  (string.CompareOrdinal(s2.Split('|')[0], s1.Split('|')[0]) > 0) + "|" + s2.Split('|')[1]);

            // Falla DESPUES del sello, en la misma transaccion: no queda nada.
            var tituloAntes = Uno("SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2026-000001'");
            using (var cn = Abrir(Base))
                Exec(cn, "CREATE TRIGGER adm.trg_Prueba_FallaSello ON adm.IniciativaProtegida AFTER UPDATE AS BEGIN " +
                         "IF UPDATE(UltimoCambioUtc) THROW 50999, N'falla forzada despues del sello', 1; END");
            var err = Error(() => Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CTitulo, "No debe quedar"), @"SORIANA\adm5"));
            using (var cn = Abrir(Base)) Exec(cn, "DROP TRIGGER adm.trg_Prueba_FallaSello");
            Check("M7 falla en la misma transaccion tras sellar: ni titulo ni sello cambian (atomico)", "50999|" + tituloAntes + "|" + s2,
                  err + "|" + Uno("SELECT Titulo FROM dbo.Problem WHERE Codigo = N'PRB 2026-000001'") + "|" + Sello("PRB 2026-000001"));
            Check("M8 Modificar rechazado por la base (Estado inexistente): ni cambio ni sello", "51013|" + s2,
                  Error(() => Modificar(Plan("PRB 2026-000001", PeticionModificarAdmin.CEstado, "Pausado"), @"SORIANA\adm5")) + "|" + Sello("PRB 2026-000001"));
            Check("M9 sin usuario: 51001 y nada sellado", "51001|" + s2,
                  Error(() => Modificar(Plan("PRB 2026-000001", SolicitudIniciativa.CTitulo, "x"), "  ")) + "|" + Sello("PRB 2026-000001"));

            // ---------------- A: Aplicar ----------------
            var alm = new AlmacenSolicitudesCambioSql(delegate { return Abrir(Base); });
            var aplicador = new AplicadorSolicitudCambio(alm, delegate { return new ValidacionAplicar { Valida = true }; });
            var eF = alm.Enviar(Peticion("folio", "PRB 2026-000002", "tipo", "fecha", "campo_fecha", "f_analisis", "fecha_nueva", "2026-12-15", "motivo", "m"), @"SORIANA\mod1", "MOD");
            Check("A0 enviar NO sella (solo guarda la solicitud)", "0", Uno("SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2026-000002'"));
            var eOtra = alm.Enviar(Peticion("folio", "PRB 2026-000002", "tipo", "fecha", "campo_fecha", "f_analisis", "fecha_nueva", "2026-12-20", "motivo", "otra"), @"SORIANA\mod1", "MOD");
            aplicador.Aplicar(eF.IdSolicitud, @"SORIANA\adm6", "ok", null, Hoy);
            var sA = Sello("PRB 2026-000002");
            Check("A1 aplicar: sella con QUIEN APLICO (revisor), no con quien envio", "True|SORIANA\\adm6",
                  (sA.Split('|')[0] != "NULL") + "|" + sA.Split('|')[1]);
            Check("A2 desactualizada (51204): sello igual", "51204|" + sA,
                  Error(() => aplicador.Aplicar(eOtra.IdSolicitud, @"SORIANA\adm7", null, null, Hoy)) + "|" + Sello("PRB 2026-000002"));
            var eO = alm.Enviar(Peticion("folio", "PRB 2026-000003", "tipo", "otros", "motivo", "explicacion"), @"SORIANA\mod1", "MOD");
            aplicador.Aplicar(eO.IdSolicitud, @"SORIANA\adm7", "corregido a mano", null, Hoy);
            Check("A3 Otros aplicada: no toca la iniciativa, no sella", "APLICADA|0",
                  alm.Detalle(eO.IdSolicitud)["estado"] + "|" + Uno("SELECT COUNT(*) FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2026-000003'"));

            // ---------------- R: lector ----------------
            var lr = lector.Leer(10);
            Check("R1 orden: mas reciente primero (Aplicar, % , Subestado, alta); sin MIGRACION ni NULL",
                  "000002,000001,000004," + nuevo.Substring(9), Folios(lr));
            Check("R2 'cambio' para lo modificado, usuario del sello", "False|SORIANA\\adm6", lr.Cambios[0].EsAlta + "|" + lr.Cambios[0].Usuario);
            Check("R2b accion: solicitud aplicada (000002), cambio directo (000001, 000004), alta (nueva)",
                  "solicitud,cambio,cambio,alta", string.Join(",", lr.Cambios.Select(c => c.Accion).ToArray()));
            Check("R2c historia: MODIFICACION previa (000004) nunca sale como alta; MIGRACION (000005) no sale",
                  "0|0", lr.Cambios.Count(c => c.Folio == "PRB 2026-000004" && c.Accion == "alta") + "|" + lr.Cambios.Count(c => c.Folio == "PRB 2026-000005"));
            Check("R3 limite", "2|000002,000001", lector.Leer(2).Cambios.Count + "|" + Folios(lector.Leer(2)));
            // Orden con horas fijas (solo para probar el lector; como dbo, sin el DENY).
            using (var cn = Abrir(Base))
                Exec(cn, "UPDATE adm.IniciativaProtegida SET UltimoCambioUtc = '2026-10-20T10:00:00', UltimoCambioUsuario = N'x' WHERE Codigo IN (N'PRB 2026-000001', N'PRB 2026-000004'); " +
                         "UPDATE adm.IniciativaProtegida SET UltimoCambioUtc = '2026-10-20T09:00:00' WHERE Codigo = N'PRB 2026-000002'; " +
                         "UPDATE adm.IniciativaProtegida SET UltimoCambioUtc = '2026-10-20T08:00:00', FechaAltaUtc = '2026-10-20T07:00:00' WHERE Codigo = N'" + nuevo + "';");
            Check("R4 empate de hora: por Codigo, estable", "000001,000004,000002", string.Join(",", lector.Leer(3).Cambios.Select(c => c.Folio.Substring(9)).ToArray()));
            var j = CambiosRecientesAdmin.Json(lector.Leer(1));
            var c0 = (Dictionary<string, object>)((List<object>)j["cambios"])[0];
            Check("R5 JSON: fecha UTC con Z, accion, estado y limite", "2026-10-20T10:00:00Z|cambio|ok|10",
                  c0["fecha_utc"] + "|" + c0["accion"] + "|" + j["estado"] + "|" + j["limite"]);
            // La nueva, editada despues de su alta: salen los DOS eventos
            // (antes solo "cambio" y el alta se perdia). 000002 ya no
            // coincide con la hora de su solicitud: "cambio".
            var todos = lector.Leer(10);
            Check("R6 alta + cambio posterior: dos filas del mismo folio, cada una con su hora y usuario",
                  "000001:cambio,000004:cambio,000002:cambio," + nuevo.Substring(9) + ":cambio," + nuevo.Substring(9) + ":alta|SORIANA\\adm1|2026-10-20 07:00:00",
                  string.Join(",", todos.Cambios.Select(c => c.Folio.Substring(9) + ":" + c.Accion).ToArray()) + "|" +
                  todos.Cambios[4].Usuario + "|" + todos.Cambios[4].FechaUtc.ToString("yyyy-MM-dd HH:mm:ss"));

            // ---------------- P: cuenta del sitio ----------------
            var sitio = new FuenteCambiosRecientesSql(delegate { var cn = Abrir(Base); Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';"); return cn; });
            Check("P1 como PROACTIVANETAD: lee la lista (incluido el cruce con adm.SolicitudCambio)", "ok|5", sitio.Leer(10).Estado + "|" + sitio.Leer(10).Cambios.Count);
            string directo;
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                directo = Error(() => Exec(cn, "UPDATE adm.IniciativaProtegida SET UltimoCambioUtc = SYSUTCDATETIME(), UltimoCambioUsuario = N'falso' WHERE Codigo = N'PRB 2026-000003'"));
            }
            Check("P2 como PROACTIVANETAD NO escribe el sello a mano (229)", "229", directo);
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                new EscritorGestionAdminSql().Modificar(cn, null, Plan("PRB 2026-000003", SolicitudIniciativa.CTitulo, "Tres editado"), @"SORIANA\adm8");
            }
            Check("P3 ... pero Modificar como PROACTIVANETAD si sella (encadenamiento de propietario)", "MODIFICACION|SORIANA\\adm8",
                  Uno("SELECT Motivo + '|' + UltimoCambioUsuario FROM adm.IniciativaProtegida WHERE Codigo = N'PRB 2026-000003'"));

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                Check("B1 rollback con sellos: se niega", true, LotesError(cn, rb23).Contains("sellos de ultimo cambio"));
                Check("B2 ... y no toco nada", "2", Uno("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('adm.IniciativaProtegida') AND name LIKE 'UltimoCambio%'"));
                Exec(cn, "EXEC sys.sp_set_session_context N'rollback_23_perder_sellos', N'SI';");
                Lotes(cn, rb23);
                Check("B3 con la bandera: Crear = sql/21, Modificar = sql/22 EXACTOS; sin columnas; protegidas intactas", Crear21 + "|" + Modificar22 + "|0|6",
                      Hash("adm.usp_GestionAdmin_Crear") + "|" + Hash("adm.usp_GestionAdmin_Modificar") + "|" +
                      Uno("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('adm.IniciativaProtegida') AND name LIKE 'UltimoCambio%'") + "|" +
                      Uno("SELECT COUNT(*) FROM adm.IniciativaProtegida"));
                var lb = lector.Leer(10);
                Check("B4 lector tras el rollback: sin_columna (no falla)", "sin_columna", lb.Estado);
                Exec(cn, "EXEC sys.sp_set_session_context N'rollback_23_perder_sellos', NULL;");
                Lotes(cn, sql23);
                Check("B5 volver a aplicar sql/23 despues del rollback", "2", Uno("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('adm.IniciativaProtegida') AND name LIKE 'UltimoCambio%'"));
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
