// Prueba de INTEGRACION de sql/27_gestion_admin_crear_subestado.sql
// (+ _rollback) con el escritor de Admin (EscritorGestionAdminSql.Crear) y
// DeteccionSql27, contra bases REALES pero DESECHABLES de SQL Server LocalDB:
// crea GestionAdminPrueba_S27<n>, aplica la replica, el cargador 174bb51, las
// vistas del backend, sql/18, 20, 21, 22 + permisos y sql/23 (la VM hoy,
// mas sql/26), corre los casos y BORRA las bases al final. Nunca toca la VM
// ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base), exige sql/26 antes, hash y parametro,
//      ya aplicada, rollback antes de aplicarla.
//   S  DeteccionSql27 (lo que enciende el campo en el sitio): sin sql/27
//      apagada, con sql/27 encendida (tambien como la cuenta del sitio).
//   K  compatibilidad: el sitio sin el interruptor sigue creando sobre el
//      procedimiento de sql/27 (Subestado NULL); un EXEC de antes (sin
//      @Subestado) tambien.
//   C  guardado: el Subestado de ADM llega a dbo.Problem.Subestado en el
//      mismo INSERT; el Estado es el que se mando (no cambia); omitido o
//      vacio = NULL; recortado; uno que no existe 51029 y nada se guarda;
//      la Volumetria de sql/26 sigue; una sola fila de proteccion (ALTA).
//   R  la regla de la base = la del sitio: otra grafia, otro acento o un
//      valor solo de problemas no vigentes = 51029; paridad, texto por
//      texto, entre LeerEstadosProblem + Trim (sitio) y el procedimiento.
//   T  triggers de dbo.Problem: EstadoEvento y FechaEvento dan lo mismo con
//      y sin Subestado; solo Subestado (Estado NULL) no genera evento.
//   P  cuenta del sitio (EXECUTE AS PROACTIVANETAD) por encadenamiento.
//   B  rollback: Crear vuelve EXACTO a sql/26; los datos se quedan; la
//      deteccion la apaga; el sitio sigue creando; volver a aplicar.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

public static class CrearSubestadoSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Crear23 = "0x8032AA3EBEA8E44EFB1E58DF977824093B91BFACFEC2E5EB0684AEC1E52743E6";
    const string Crear26 = "0x80F079B26DC86BD070E7A529ECACE4FDCB5C9EF82887EC35EF20A805C783B44B";
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
    static string Hash()
    {
        return Uno("SELECT CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Crear')), " +
                   "N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)");
    }
    static string Parametro()
    {
        return Uno("SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Crear') AND name = N'@Subestado' " +
                   "AND TYPE_NAME(user_type_id) = N'nvarchar' AND max_length = 200");
    }

    // Lo que el sitio decide (DeteccionSql27 sobre la base, sin forzado);
    // comoSitio = EXECUTE AS PROACTIVANETAD.
    static bool Detecta(bool comoSitio)
    {
        var forzada = PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas;
        PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = null;
        PersistenciaGestionAdmin.OlvidarSql27ParaPruebas();
        try
        {
            using (var cn = Abrir(Base))
            {
                if (comoSitio) Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                return DeteccionSql27.Revisar(cn);
            }
        }
        finally { PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = forzada; }
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
            Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'ADO', N'Adopcion', 1);
INSERT dbo.Categorias (Id, RutaCompleta, VigenteEnOrigen) VALUES (N'c1', N'/A/Cat 1', 1), (N'c2', N'/A/Cat 2', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado) VALUES
 (N'ADO 2025-000001', N'Problem', N'Semilla', N'" + EnAnalisis + @"', N'Solucionado'),
 (N'ADO 2025-000002', N'Problem', N'Semilla 2', N'Cerrado', N' Cancelado ');
-- Solo en un problema NO vigente: el sitio no lo ofrece (LeerEstadosProblem
-- lee vigentes) y la base tampoco lo acepta.
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, VigenteEnOrigen) VALUES
 (N'ADO 2024-000001', N'Problem', N'Vieja', N'Cerrado', N'Historico', 0);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'ADO 2025-000001', N'/A/Cat 2', N'Problem', N'Problem', 0.0100, 1);");
        }
    }

    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
        catch (InvalidOperationException ex) { return "IOE:" + ex.Message; }
    }

    static string ErrorTipo(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex.Tipo; }
        catch (Exception ex) { return ex.GetType().Name; }
    }

    static PlanCrearAdmin Plan(string subestado, string estado)
    {
        var p = new PlanCrearAdmin
        {
            Prefijo = "ADO", TipoIniciativa = "Problem", TipoAgrupado = "Problem", Estado = estado, Subestado = subestado,
            Titulo = "Alta",
            FechaCreacion = Hoy, FechaAnalisis = Hoy.AddDays(15), FechaEntregaAnalisis = Hoy,
        };
        p.Categorias.Add(new CategoriaPlan { Ruta = "/A/Cat 1", Pct = 0.05m, TipoIniciativa = "Problem", TipoAgrupado = "Problem" });
        return p;
    }
    static string Crear(PlanCrearAdmin plan, string usuario)
    {
        using (var cn = Abrir(Base)) return new EscritorGestionAdminSql().Crear(cn, null, plan, usuario);
    }
    // Estado|Subestado|VolumetriaOriginal de una fila (NULL explicito).
    static string Fila(string codigo)
    {
        return Uno("SELECT ISNULL(Estado, 'NULL') + '|' + ISNULL(Subestado, 'NULL') + '|' + ISNULL(CONVERT(varchar(20), VolumetriaOriginal), 'NULL') " +
                   "FROM dbo.Problem WHERE Codigo = N'" + codigo + "'");
    }
    // Un EXEC directo (como un llamador de antes o uno que manda texto
    // crudo). subestado = null: sin el parametro.
    static string ExecDirecto(string subestado)
    {
        using (var cn = Abrir(Base))
        {
            var sql = "DECLARE @c adm.CategoriaPctTipo; INSERT @c (Categoria, Pct) VALUES (N'/A/Cat 2', 0.01); DECLARE @cod nvarchar(100); " +
                      "EXEC adm.usp_GestionAdmin_Crear @Usuario = N'SORIANA\\directo', @Prefijo = N'ADO', @TipoIniciativa = N'Problem', " +
                      "@TipoAgrupado = N'Problem', @Estado = N'Cerrado', @Titulo = N'Directo', @Descripcion = NULL, @Observaciones = NULL, " +
                      "@Categorias = @c, @Hoy = '2026-10-21', " + (subestado == null ? "" : "@Subestado = @s, ") + "@Codigo = @cod OUTPUT; SELECT @cod;";
            using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 })
            {
                if (subestado != null) c.Parameters.AddWithValue("@s", subestado);
                return Convert.ToString(c.ExecuteScalar());
            }
        }
    }

    public static int Main()
    {
        if (!Directory.Exists(Backend))
        {
            Console.WriteLine("NO CORRIDO: falta ../backend_admin_persistencia (vistas del backend). Nada se dio por pasado.");
            return 2;
        }
        Base = "GestionAdminPrueba_S27" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var guarda = "S27Guarda_" + DateTime.UtcNow.ToString("HHmmssfff");
        var sql26 = Leer("sql", "26_gestion_admin_crear_volumetria.sql");
        var sql27 = Leer("sql", "27_gestion_admin_crear_subestado.sql");
        var rb27 = Leer("sql", "27_gestion_admin_crear_subestado_rollback.sql");
        var h27 = Regex.Match(sql27, @"POSTCONDICION \(si no, ROLLBACK\)\s+Crear\s+(0x[0-9A-F]{64})").Groups[1].Value;
        try
        {
            Preparar(Base);
            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
            {
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql27).Contains("SIN APROBAR") + "|" + LotesError(g, rb27).Contains("SIN APROBAR"));
            }
            Borrar(guarda);
            using (var cn = Abrir(Base))
            {
                Check("G2 con sql/23 (sin sql/26): se niega pidiendo sql/26; Crear sigue siendo el de sql/23", "True|" + Crear23 + "|0",
                      LotesError(cn, sql27).Contains("Aplica sql/26 antes") + "|" + Hash() + "|" + Parametro());
                Lotes(cn, sql26);
                Check("S1 con sql/26 sin sql/27: la deteccion la deja apagada (sitio y cuenta del sitio)", "False|False", Detecta(false) + "|" + Detecta(true));
                Check("G3 rollback de 27 antes de aplicarla: se niega sin tocar nada", "True|" + Crear26,
                      LotesError(cn, rb27).Contains("sql/27 no aplicada") + "|" + Hash());
            }
            // K antes de aplicar: el sitio de hoy (sin Subestado) sobre sql/26.
            PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = false;
            Check("K0 sin sql/27 y con Subestado en el plan: el escritor se niega (no lo tira en silencio)", "True",
                  Error(() => Crear(Plan("Solucionado", null), @"SORIANA\adm1")).StartsWith("IOE:"));
            var k0 = Crear(Plan(null, EnAnalisis), @"SORIANA\adm1");
            Check("K0b sin sql/27 y sin Subestado: el sitio de hoy crea igual", EnAnalisis + "|NULL|NULL", Fila(k0));
            using (var cn = Abrir(Base))
            {
                var r27 = LotesError(cn, sql27);
                Console.WriteLine("      hash Crear 27 = " + Hash() + "  (" + r27 + ")");
                Check("G4 aplicada: Crear con el hash de sql/27 y @Subestado nvarchar(100)", "sin error|" + h27 + "|1", r27 + "|" + Hash() + "|" + Parametro());
                Check("G5 aplicarla otra vez: 'ya aplicada', sin tocar nada", "True|" + h27, LotesError(cn, sql27).Contains("ya aplicada") + "|" + Hash());
            }

            // ---------------- K: compatibilidad ----------------
            var k1 = Crear(Plan(null, EnAnalisis), @"SORIANA\adm1");
            Check("K1 el sitio SIN el interruptor (no manda @Subestado) sigue creando: Subestado NULL", EnAnalisis + "|NULL|NULL", Fila(k1));
            var k2 = ExecDirecto(null);
            Check("K2 un EXEC de antes (sin @Subestado, por nombre) sigue creando: NULL", "Cerrado|NULL|NULL", Fila(k2));

            // ---------------- C: guardado ----------------
            PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = true;
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = true;
            var c1 = Crear(Plan("Solucionado", EnAnalisis), @"SORIANA\adm2");
            Check("C1 el Subestado de ADM llega a dbo.Problem.Subestado; el Estado es el mandado", EnAnalisis + "|Solucionado|NULL", Fila(c1));
            Check("C2 con el interruptor y sin Subestado: NULL", "Cerrado|NULL|NULL", Fila(Crear(Plan(null, "Cerrado"), @"SORIANA\adm2")));
            Check("C3 Subestado sin Estado: se guarda y el Estado sigue NULL (no se deriva)", "NULL|Cancelado|NULL",
                  Fila(Crear(Plan("Cancelado", null), @"SORIANA\adm2")));
            Check("C4 EXEC directo con '   ': NULL (vacio = sin elegir)", "Cerrado|NULL|NULL", Fila(ExecDirecto("   ")));
            Check("C5 EXEC directo con ' Solucionado ': se guarda recortado", "Cerrado|Solucionado|NULL", Fila(ExecDirecto(" Solucionado ")));
            Check("C6 un valor guardado con espacios en la base (' Cancelado ') cuenta como existente", "Cerrado|Cancelado|NULL", Fila(ExecDirecto("Cancelado")));
            var antes = Uno("SELECT COUNT(*) FROM dbo.Problem") + "|" + Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria") + "|" +
                        Uno("SELECT COUNT(*) FROM adm.IniciativaProtegida");
            Check("C7 uno que no existe por el escritor: 51029 y no se crea nada", "51029|" + antes,
                  Error(() => Crear(Plan("Inventado", EnAnalisis), @"SORIANA\adm2")) + "|" + Uno("SELECT COUNT(*) FROM dbo.Problem") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria") + "|" + Uno("SELECT COUNT(*) FROM adm.IniciativaProtegida"));
            Check("C8 el escritor traduce 51029 como DatoInvalido", "DatoInvalido", ErrorTipo(() => Crear(Plan("Inventado", null), @"SORIANA\adm2")));
            Check("C9 EXEC directo con uno que no existe: 51029", "51029", Error(() => ExecDirecto("Inventado")));
            var pv = Plan("Solucionado", EnAnalisis); pv.Volumetria = 900;
            Check("C10 con la Volumetria de sql/26 en el mismo alta: las dos se guardan", EnAnalisis + "|Solucionado|900", Fila(Crear(pv, @"SORIANA\adm2")));
            Check("C11 el alta sigue protegida y sellada (sql/18 + sql/23), una sola fila", "1|ALTA|SORIANA\\adm2",
                  Uno("SELECT CONVERT(varchar(5), COUNT(*)) + '|' + MAX(Motivo) + '|' + MAX(UltimoCambioUsuario) FROM adm.IniciativaProtegida WHERE Codigo = N'" + c1 + "'"));

            // ---------------- R: la regla de la base = la del sitio ----------------
            Check("R1 otra grafia ('solucionado' / 'SOLUCIONADO' con solo 'Solucionado' en la base): 51029, como el sitio", "51029|51029",
                  Error(() => ExecDirecto("solucionado")) + "|" + Error(() => ExecDirecto("SOLUCIONADO")));
            Check("R2 un Subestado que solo esta en un problema NO vigente: 51029, como el sitio", "51029", Error(() => ExecDirecto("Historico")));
            Check("R3 otro acento ('Canc" + (char)0xE9 + "lado'): 51029", "51029", Error(() => ExecDirecto("Canc" + (char)0xE9 + "lado")));
            // Paridad: para cada texto crudo del formulario, lo que decide el
            // sitio (la lista de LeerEstadosProblem + Trim, ValidadorGestionAdmin)
            // y lo que decide la base con lo que el escritor le manda (recortado).
            EstadosProblem lista;
            using (var cn = Abrir(Base)) lista = ExperienciaQueries.LeerEstadosProblem(cn).Valores;
            var crudos = new[] { "Solucionado", " Solucionado ", "Solucionado\t", "solucionado", "SOLUCIONADO", "Cancelado", " Cancelado ",
                                 "Historico", "Inventado", "Canc" + (char)0xE9 + "lado", "Solucionado" + (char)0xA0 };
            var distintas = new List<string>();
            foreach (var crudo in crudos)
            {
                var limpio = crudo.Trim();
                var sitio = lista.Subestados.Contains(limpio);
                var r = Error(() => ExecDirecto(limpio));
                var baseAcepta = r == "sin error";
                if (!baseAcepta && r != "51029") distintas.Add(crudo + ":error " + r);
                else if (sitio != baseAcepta) distintas.Add(crudo + ":sitio=" + sitio + ",base=" + baseAcepta);
            }
            Check("R4 paridad sitio/base en " + crudos.Length + " textos (grafia, acento, vigencia, blancos, NBSP)", "", string.Join("; ", distintas.ToArray()));
            Check("R5 directo a la base, un blanco que no es espacio no se recorta ('Solucionado\\t'): 51029 (mas estricta, nunca mas laxa)", "51029",
                  Error(() => ExecDirecto("Solucionado\t")));

            // ---------------- T: triggers de dbo.Problem ----------------
            // trg_Problem_EstadoEvento (definicion de la replica, copiada de la
            // VM) solo mira Estado; trg_Problem_FechaEvento (sql/17) solo fechas.
            var tSin = Crear(Plan(null, EnAnalisis), @"SORIANA\adm6");
            var tCon = Crear(Plan("Solucionado", EnAnalisis), @"SORIANA\adm6");
            var tSoloSub = Crear(Plan("Solucionado", null), @"SORIANA\adm6");
            Func<string, string> eventos = cod => Uno(
                "SELECT CONVERT(varchar(5), COUNT(*)) + '|' + ISNULL(MAX(Operacion), '-') + '|' + ISNULL(MAX(EstadoNuevo), '-') + '|' + " +
                "ISNULL(MAX(Origen), '-') + '|' + ISNULL(MAX(Usuario), '-') FROM dbo.ProblemEstadoEvento WHERE Codigo = N'" + cod + "'");
            Func<string, string> fechas = cod => Uno("SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'" + cod + "'");
            Check("T1 EstadoEvento: con y sin Subestado, el mismo evento I del Estado (ADMIN, usuario)",
                  "1|I|" + EnAnalisis + "|ADMIN|SORIANA\\adm6", eventos(tCon));
            Check("T2 EstadoEvento igual con y sin Subestado", eventos(tSin), eventos(tCon));
            Check("T3 solo Subestado (Estado NULL): ningun evento de Estado, como un alta sin Estado", "0|-|-|-|-", eventos(tSoloSub));
            Check("T4 FechaEvento: los mismos eventos con y sin Subestado", fechas(tSin), fechas(tCon));
            Check("T5 la tabla de eventos de Estado no tiene columna de Subestado", "0",
                  Uno("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProblemEstadoEvento') AND name LIKE N'%Subestado%'"));

            // ---------------- P: cuenta del sitio ----------------
            string p1;
            using (var cn = Abrir(Base))
            {
                Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
                p1 = new EscritorGestionAdminSql().Crear(cn, null, Plan("Cancelado", "Cerrado"), @"SORIANA\adm3");
            }
            Check("P1 como PROACTIVANETAD: el Subestado se guarda por el procedimiento", "Cerrado|Cancelado|NULL", Fila(p1));

            // ---------------- S: deteccion real ----------------
            Check("S2 con sql/27: la deteccion la enciende (tambien como PROACTIVANETAD)", "True|True", Detecta(false) + "|" + Detecta(true));
            PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = null;
            Check("S3 sin forzado, tras detectar: activa y por ese camino se guarda", "True|Solucionado",
                  Detecta(false) + "|" + Fila(Crear(Plan("Solucionado", null), @"SORIANA\adm4")).Split('|')[1]);

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                Lotes(cn, rb27);
                Check("B1 rollback: Crear EXACTO de sql/26, sin el parametro", Crear26 + "|0", Hash() + "|" + Parametro());
                Check("B2 los datos se quedan", EnAnalisis + "|Solucionado|NULL", Fila(c1));
                Check("B3 tras el rollback la deteccion la apaga sola", false, Detecta(false));
                Check("B4 apagada por la deteccion, el sitio sigue creando sobre sql/26", "Cerrado|NULL|NULL", Fila(Crear(Plan(null, "Cerrado"), @"SORIANA\adm5")));
                Lotes(cn, sql27);
                Check("B5 volver a aplicar sql/27 despues del rollback", h27 + "|1", Hash() + "|" + Parametro());
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = null;
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = null;
            PersistenciaGestionAdmin.OlvidarSql27ParaPruebas();
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
