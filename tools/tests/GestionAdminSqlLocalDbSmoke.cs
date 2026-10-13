// Prueba de INTEGRACION de la propuesta sql/18_gestion_admin_persistencia.sql
// con el escritor App_Code/EscritorGestionAdmin.cs, contra una base REAL pero
// DESECHABLE de SQL Server LocalDB: crea GestionAdminPrueba_<n>, aplica la
// replica (tools/tests/GestionAdminLocalDb_replica.sql) y la propuesta, corre
// los casos y BORRA la base al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Lo que esto prueba es la PROPUESTA sobre una replica del esquema, no la
// base desplegada: no hay trg_Problem_EstadoEvento (definicion no
// disponible), ni datos reales, ni la cuenta SQL del sitio.
//
// Casos:
//   G)  la guarda: la propuesta no corre en una base con otro nombre.
//   A)  alta multi-categoria: Codigo sembrado del maximo, fechas compartidas,
//       historial 'I' ADMIN con usuario; codigo que ya existe se salta.
//   R)  rollback: tope excedido en la 2a categoria y falla forzada DESPUES
//       del INSERT de Problem: nada queda, ni el numero de codigo.
//   L)  ligar despues: fechas propias hoy / hoy + 15; las del problema y las
//       iniciales intactas; historial de categoria; repetida rechazada.
//   M)  modificar Solucion / Cierre: historial nuevo ADMIN, el anterior
//       intacto; Codigo y FechaCreacion intactos; codigo inexistente.
//   K)  tope exacto 100% y 100.01%.
//   C)  concurrencia: dos altas al 60% sobre la misma ruta; la segunda
//       espera el candado y despues se rechaza.
//
// Compilar (Git Bash, ver memoria csc): App_Code\*.cs + este archivo; correr
// con cwd = raiz del repo.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class GestionAdminSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    static int fallos = 0;
    static string Base;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, System.Globalization.CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, System.Globalization.CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection(Servidor + "Database=" + db + ";Pooling=false;");
        cn.Open();
        return cn;
    }

    static void Lotes(SqlConnection cn, string sql)
    {
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (lote.Trim().Length > 0)
                using (var cmd = new SqlCommand(lote, cn) { CommandTimeout = 120 }) cmd.ExecuteNonQuery();
    }

    static object Uno(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn)) { var v = cmd.ExecuteScalar(); return v == DBNull.Value ? null : v; }
    }

    static void Exec(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn)) cmd.ExecuteNonQuery();
    }

    static string Fecha(object v) { return v == null ? "NULL" : ((DateTime)v).ToString("yyyy-MM-dd"); }

    static List<string> Filas(SqlConnection cn, string sql)
    {
        var salida = new List<string>();
        using (var cmd = new SqlCommand(sql, cn))
        using (var rd = cmd.ExecuteReader())
            while (rd.Read())
            {
                var partes = new List<string>();
                for (var i = 0; i < rd.FieldCount; i++)
                    partes.Add(rd.IsDBNull(i) ? "NULL" : rd.GetValue(i) is DateTime ? Fecha(rd.GetValue(i)) : Convert.ToString(rd.GetValue(i), System.Globalization.CultureInfo.InvariantCulture));
                salida.Add(string.Join("|", partes));
            }
        return salida;
    }

    static PlanCrearAdmin PlanAlta(DateTime hoy, params object[] rutaPct)
    {
        var p = new PeticionCrearAdmin { Tipo = "PRB", Titulo = "[PRUEBA] alta" };
        for (var i = 0; i < rutaPct.Length; i += 2)
            p.Categorias.Add(new PctCategoria { Categoria = (string)rutaPct[i], Texto = (string)rutaPct[i + 1] });
        return PlanificadorGestionAdmin.Crear(p, new ResultadoGestionAdmin { Accion = "crear" }, hoy);
    }

    static readonly DatosAltaDeclarados Declarados =
        new DatosAltaDeclarados { TipoIniciativa = "Problem", TipoAgrupado = "Problem", Estado = "En Análisis" };

    static string Alta(SqlConnection cn, PlanCrearAdmin plan, out ErrorEscrituraGestionAdmin error)
    {
        error = null;
        try { return new EscritorGestionAdminSql().Crear(cn, null, plan, Declarados, @"DOM\prueba"); }
        catch (ErrorEscrituraGestionAdmin ex) { error = ex; return null; }
        // Otro error de SQL (p. ej. el CHECK forzado de R2): tambien cuenta.
        catch (SqlException ex) { error = new ErrorEscrituraGestionAdmin(ex.Number, ex.Message, ex); return null; }
    }

    static PlanModificarAdmin PlanMod(string codigo, DateTime hoy)
    {
        return new PlanModificarAdmin { Codigo = codigo, Hoy = hoy };
    }

    static ErrorEscrituraGestionAdmin Mod(SqlConnection cn, PlanModificarAdmin plan)
    {
        try { new EscritorGestionAdminSql().Modificar(cn, null, plan, @"DOM\prueba"); return null; }
        catch (ErrorEscrituraGestionAdmin ex) { return ex; }
    }

    static string Alter(string definicion)
    {
        return Regex.Replace(definicion, @"CREATE\s+PROCEDURE", "ALTER PROCEDURE");
    }

    // Dos ligados de la misma ruta al 60% desde PRB 2026-000006 y 000008: el
    // primero en una transaccion abierta; el segundo en paralelo. Devuelve el
    // % total que queda en la ruta.
    static string Carrera(SqlConnection cn, string ruta)
    {
        var dia = new DateTime(2026, 11, 3);
        using (var cnA = Abrir(Base))
        using (var cnB = Abrir(Base))
        {
            var a = PlanMod("PRB 2026-000006", dia);
            a.Agregar.Add(new CategoriaPlan { Ruta = ruta, Pct = 0.6m });
            var b = PlanMod("PRB 2026-000008", dia);
            b.Agregar.Add(new CategoriaPlan { Ruta = ruta, Pct = 0.6m });
            var txA = cnA.BeginTransaction();
            new EscritorGestionAdminSql().Modificar(cnA, txA, a, @"DOM\a");
            var hilo = new Thread(() =>
            {
                try { new EscritorGestionAdminSql().Modificar(cnB, null, b, @"DOM\b"); }
                catch (Exception) { }
            });
            hilo.Start();
            hilo.Join(1500);
            txA.Commit();
            hilo.Join(30000);
        }
        return Convert.ToString(Uno(cn, "SELECT SUM(PctDisminucion) FROM dbo.ProblemCategoria WHERE Categoria = N'" + ruta + "'"),
                                System.Globalization.CultureInfo.InvariantCulture);
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        var replica = File.ReadAllText(Path.Combine("tools", "tests", "GestionAdminLocalDb_replica.sql"));
        var propuesta = File.ReadAllText(Path.Combine("sql", "18_gestion_admin_persistencia.sql"));
        try
        {
            using (var m = Abrir("master"))
            {
                Console.WriteLine("LocalDB " + Uno(m, "SELECT CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion'))") + " -> " + Base);
                // ---- G ----
                var guarda = "";
                try { Lotes(m, propuesta); } catch (SqlException ex) { guarda = ex.Message.Contains("SIN APROBAR") ? "detenida" : ex.Message; }
                Exec(m, "SET NOEXEC OFF;");
                Check("G1 la migracion 18 se detiene fuera de GestionAdminPrueba_* sin aprobacion (master)", "detenida", guarda);
                Check("G2 y no creo nada en master", 0, Uno(m, "SELECT COUNT(*) FROM sys.schemas WHERE name = 'adm'"));
                Exec(m, "CREATE DATABASE [" + Base + "]");
                // READ_COMMITTED_SNAPSHOT: las lecturas no esperan a escrituras
                // sin confirmar. Es el caso dificil para el tope: solo el
                // candado por ruta serializa (ver C5-C8).
                Exec(m, "ALTER DATABASE [" + Base + "] SET READ_COMMITTED_SNAPSHOT ON");
            }

            using (var cn = Abrir(Base))
            {
                Lotes(cn, replica);
                Lotes(cn, propuesta);

                // Datos de partida "del Excel" (sin contexto ADMIN).
                Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, ControlDeFecha) VALUES (N'PRB', 1), (N'ADO', 1);
INSERT dbo.Problem (Codigo, Titulo, Estado, FechaCreacion, FechaAnalisis)
VALUES (N'PRB 2026-000005', N'Excel', N'En An" + "á" + @"lisis', '2026-09-01', '2026-09-16'),
       (N'ADO 2026-000001', N'Excel ADO', N'En Soluci" + "ó" + @"n', '2026-08-01', '2026-08-16');
UPDATE dbo.Problem SET FechaAnalisis = '2026-09-20' WHERE Codigo = N'PRB 2026-000005';
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoAgrupado, PctDisminucion)
VALUES (N'ADO 2026-000001', N'/A/Cat 1', N'Adopcion', 0.6000),
       (N'ADO 2026-000001', N'/K/Cat 9', N'Adopcion', 0.6000);");
                var historialPrevio = Filas(cn, "SELECT IdEvento, Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, ISNULL(Usuario,'-') FROM dbo.ProblemFechaEvento ORDER BY IdEvento");
                Check("A0 historial de partida (Excel): 3 eventos NO_DECLARADO", "3|3",
                      historialPrevio.Count + "|" + historialPrevio.Count(f => f.Contains("NO_DECLARADO")));

                // ---- A ----
                var hoy = new DateTime(2026, 10, 13);
                ErrorEscrituraGestionAdmin err;
                var cod1 = Alta(cn, PlanAlta(hoy, "/A/Cat 2", "30", "/A/Cat 3", "20"), out err);
                Check("A1 alta: Codigo sembrado del maximo existente (000005 -> 000006)", "PRB 2026-000006", cod1);
                Check("A2 alta: fechas del problema hoy / hoy + 15", "2026-10-13|2026-10-28",
                      Filas(cn, "SELECT FechaCreacion, FechaAnalisis FROM dbo.Problem WHERE Codigo = N'PRB 2026-000006'").FirstOrDefault());
                Check("A3 alta: 2 categorias iniciales sin fechas propias (comparten las del problema)",
                      "/A/Cat 2|0.3000|NULL|NULL;/A/Cat 3|0.2000|NULL|NULL",
                      string.Join(";", Filas(cn, "SELECT Categoria, PctDisminucion, FechaCreacionCategoria, FechaAnalisisCategoria FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000006' ORDER BY Categoria")));
                Check("A4 alta: fecha efectiva de las 2 = la del problema (COALESCE)", "2026-10-28;2026-10-28",
                      string.Join(";", Filas(cn, "SELECT COALESCE(pc.FechaAnalisisCategoria, CONVERT(date, p.FechaAnalisis)) FROM dbo.ProblemCategoria AS pc JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo WHERE pc.Codigo = N'PRB 2026-000006' ORDER BY pc.Categoria")));
                Check("A5 historial del alta: 'I' FechaAnalisis ADMIN con usuario", "FechaAnalisis|NULL|2026-10-28|I|ADMIN|DOM\\prueba",
                      string.Join(";", Filas(cn, "SELECT Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000006'")));
                Check("A6 sin contexto ADMIN colgado en la sesion despues del alta", "NULL",
                      Uno(cn, "SELECT CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen'))") ?? "NULL");
                Exec(cn, "INSERT dbo.Problem (Codigo, Titulo) VALUES (N'PRB 2026-000007', N'Excel emitio este')");
                var cod2 = Alta(cn, PlanAlta(hoy, "/A/Cat 4", "10"), out err);
                Check("A7 el Excel ya emitio 000007: el contador lo salta", "PRB 2026-000008", cod2);
                var codAnio = Alta(cn, PlanAlta(new DateTime(2027, 1, 2), "/A/Cat 5", "10"), out err);
                Check("A8 reinicio anual: primer codigo de 2027", "PRB 2027-000001", codAnio);

                // ---- R ----
                var antesP = Uno(cn, "SELECT COUNT(*) FROM dbo.Problem");
                var antesC = Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria");
                var antesH = Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento");
                var codR = Alta(cn, PlanAlta(hoy, "/A/Cat 6", "10", "/A/Cat 1", "50"), out err);
                Check("R1 2a categoria excede (60 de otros + 50): se rechaza como tope", "True|", (err != null && err.EsTope) + "|" + codR);
                Exec(cn, "ALTER TABLE dbo.ProblemCategoria ADD CONSTRAINT CK_Prueba_Forzada CHECK (Categoria <> N'/Falla/Forzada')");
                codR = Alta(cn, PlanAlta(hoy, "/A/Cat 7", "10", "/Falla/Forzada", "10"), out err);
                Exec(cn, "ALTER TABLE dbo.ProblemCategoria DROP CONSTRAINT CK_Prueba_Forzada");
                Check("R2 falla DESPUES de insertar Problem (CHECK forzado): error", "547|", (err == null ? "-" : err.Numero.ToString()) + "|" + codR);
                Check("R3 tras las dos fallas: Problem, ProblemCategoria e historial sin cambios",
                      antesP + "|" + antesC + "|" + antesH,
                      Uno(cn, "SELECT COUNT(*) FROM dbo.Problem") + "|" + Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria") + "|" + Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento"));
                Check("R4 el numero de codigo no se consumio", "PRB 2026-000009", Alta(cn, PlanAlta(hoy, "/A/Cat 8", "10"), out err));

                // ---- L ----
                var dia2 = new DateTime(2026, 11, 2);
                var liga = PlanMod("PRB 2026-000006", dia2);
                liga.Agregar.Add(new CategoriaPlan { Ruta = "/B/Cat 5", Pct = 0.1m, FechaCreacion = dia2, FechaAnalisis = FechasGestionAdmin.Analisis(dia2) });
                Check("L1 ligar /B/Cat 5 el 2026-11-02: sin error", "", Mod(cn, liga) == null ? "" : "error");
                Check("L2 la ligada lleva SUS fechas: 2026-11-02 / 2026-11-17", "2026-11-02|2026-11-17",
                      Filas(cn, "SELECT FechaCreacionCategoria, FechaAnalisisCategoria FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000006' AND Categoria = N'/B/Cat 5'").FirstOrDefault());
                Check("L3 las del problema NO cambiaron", "2026-10-13|2026-10-28",
                      Filas(cn, "SELECT FechaCreacion, FechaAnalisis FROM dbo.Problem WHERE Codigo = N'PRB 2026-000006'").FirstOrDefault());
                Check("L4 las iniciales siguen sin fechas propias", "NULL|NULL;NULL|NULL",
                      string.Join(";", Filas(cn, "SELECT FechaCreacionCategoria, FechaAnalisisCategoria FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000006' AND Categoria <> N'/B/Cat 5' ORDER BY Categoria")));
                Check("L5 historial de categoria: 2 eventos 'I' ADMIN de /B/Cat 5",
                      "/B/Cat 5|FechaAnalisisCategoria|2026-11-17|I|ADMIN;/B/Cat 5|FechaCreacionCategoria|2026-11-02|I|ADMIN",
                      string.Join(";", Filas(cn, "SELECT Categoria, Campo, FechaNueva, Operacion, Origen FROM dbo.ProblemCategoriaFechaEvento ORDER BY Campo")));
                Check("L6 ligar no escribio historial de fechas del problema", 0,
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento WHERE Codigo = N'PRB 2026-000006' AND Operacion = 'U'"));
                var rep = PlanMod("PRB 2026-000006", dia2);
                rep.Agregar.Add(new CategoriaPlan { Ruta = " /a/cat 2 ", Pct = 0.05m });
                var eRep = Mod(cn, rep);
                Check("L7 ligar una ya ligada (otra grafia): rechazada como repetida", true, eRep != null && eRep.EsRepetida);
                Check("L8 sin duplicar: siguen 3 categorias", 3, Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'PRB 2026-000006'"));

                // ---- M ----
                var ultimoId = Uno(cn, "SELECT MAX(IdEvento) FROM dbo.ProblemFechaEvento");
                var historialAntesM = Filas(cn, "SELECT IdEvento, Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, ISNULL(Usuario,'-') FROM dbo.ProblemFechaEvento ORDER BY IdEvento");
                var mod = PlanMod("PRB 2026-000006", dia2);
                mod.Problem[PeticionModificarAdmin.CFSolucion] = "2026-12-01";
                mod.Problem[PeticionModificarAdmin.CFCierre] = "2027-01-31";
                Check("M1 editar Solucion y Cierre: sin error", "", Mod(cn, mod) == null ? "" : "error");
                Check("M2 Solucion / Cierre guardadas; Creacion y Analisis intactas", "2026-10-13|2026-10-28|2026-12-01|2027-01-31",
                      Filas(cn, "SELECT FechaCreacion, FechaAnalisis, FechaSolucion, FechaCierre FROM dbo.Problem WHERE Codigo = N'PRB 2026-000006'").FirstOrDefault());
                Check("M3 historial: 2 eventos nuevos ADMIN (Solucion, Cierre)", "FechaCierre|ADMIN;FechaSolucion|ADMIN",
                      string.Join(";", Filas(cn, "SELECT Campo, Origen FROM dbo.ProblemFechaEvento WHERE IdEvento > " + ultimoId + " ORDER BY Campo")));
                var historialDespues = Filas(cn, "SELECT IdEvento, Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, ISNULL(Usuario,'-') FROM dbo.ProblemFechaEvento ORDER BY IdEvento");
                Check("M4 historial previo (Excel + alta) intacto, fila por fila", true,
                      historialAntesM.SequenceEqual(historialDespues.Take(historialAntesM.Count)) &&
                      historialPrevio.SequenceEqual(historialDespues.Take(historialPrevio.Count)));
                var mod2 = PlanMod("PRB 2026-000006", dia2);
                mod2.Problem[PeticionModificarAdmin.CFCierre] = "2027-01-31";
                mod2.Problem[SolicitudIniciativa.CTitulo] = "[PRUEBA] titulo nuevo";
                Mod(cn, mod2);
                Check("M5 reescribir Cierre con el mismo valor: 0 eventos nuevos", historialDespues.Count,
                      Uno(cn, "SELECT COUNT(*) FROM dbo.ProblemFechaEvento"));
                Check("M6 Codigo intacto y unico tras modificar", 1, Uno(cn, "SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'PRB 2026-000006' AND Titulo = N'[PRUEBA] titulo nuevo'"));
                var noExiste = Mod(cn, PlanMod("PRB 2026-999999", dia2));
                Check("M7 modificar un codigo inexistente: 51006, no crea nada", "51006|0",
                      (noExiste == null ? 0 : noExiste.Numero) + "|" + Uno(cn, "SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'PRB 2026-999999'"));
                Check("M8 el procedimiento no tiene parametro para Codigo nuevo ni FechaCreacion", 0,
                      Uno(cn, "SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar') AND (name LIKE '%Creacion%' OR name LIKE '%Nuevo%')"));

                // ---- K ----
                Check("K1 tope exacto: 60 + 40 = 100% se guarda", true, Alta(cn, PlanAlta(hoy, "/A/Cat 1", "40"), out err) != null);
                Alta(cn, PlanAlta(hoy, "/A/Cat 1", "0.01"), out err);
                Check("K2 tope: 100% + 0.01 se rechaza", true, err != null && err.EsTope);
                var subir = PlanMod("PRB 2026-000006", dia2);
                subir.Pcts.Add(new CategoriaPlan { Ruta = "/A/Cat 2", Pct = 1.0m, PctAnterior = 0.3m });
                Check("K3 subir el % de una ligada a 100% (ruta sin otros): se guarda", "", Mod(cn, subir) == null ? "" : "error");

                // ---- C ----
                using (var cnA = Abrir(Base))
                using (var cnB = Abrir(Base))
                {
                    var txA = cnA.BeginTransaction();
                    var codA = new EscritorGestionAdminSql().Crear(cnA, txA, PlanAlta(hoy, "/C/Cat 1", "60"), Declarados, @"DOM\a");
                    ErrorEscrituraGestionAdmin errB = null;
                    Exception otroB = null;
                    string codB = null;
                    var hilo = new Thread(() =>
                    {
                        try { codB = new EscritorGestionAdminSql().Crear(cnB, null, PlanAlta(hoy, "/C/Cat 1", "60"), Declarados, @"DOM\b"); }
                        catch (ErrorEscrituraGestionAdmin ex) { errB = ex; }
                        catch (Exception ex) { otroB = ex; }
                    });
                    hilo.Start();
                    var esperaba = !hilo.Join(2000);
                    Check("C1 la 2a alta ESPERA el candado de la ruta mientras la 1a no confirma", true, esperaba);
                    txA.Commit();
                    hilo.Join(30000);
                    Check("C2 la 1a guardo su 60%", true, codA != null);
                    Check("C3 la 2a, al seguir, ve el 60% y se rechaza por tope", "True|", (errB != null && errB.EsTope) + "|" + codB + (otroB == null ? "" : otroB.Message));
                    Check("C4 la ruta quedo en 60%, no en 120%", "0.6000",
                          Convert.ToString(Uno(cn, "SELECT SUM(PctDisminucion) FROM dbo.ProblemCategoria WHERE Categoria = N'/C/Cat 1'"), System.Globalization.CultureInfo.InvariantCulture));
                }

                // C5-C8: LIGAR la misma ruta desde dos problemas distintos (sin
                // contador de codigo de por medio). Control negativo: sin el
                // candado por ruta las dos pasan (120%); con el, no.
                var original = (string)Uno(cn, "SELECT OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_RevisarTope'))");
                var originalMod = (string)Uno(cn, "SELECT OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_Modificar'))");
                var candado = Regex.Match(original, @"EXEC @rc = sp_getapplock[^;]*;");
                Check("C5 el candado esta en RevisarTope", true, candado.Success);
                // El chequeo de "ya ligada" usa UPDLOCK, HOLDLOCK y, segun el
                // plan, tambien frena a otra iniciativa con la misma ruta. Es
                // incidental: se quita para medir el candado por ruta solo.
                var pista = "INNER JOIN dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)";
                Check("C5b la pista del chequeo de repetida esta en Modificar", true, originalMod.Contains(pista));
                var modSinPista = Alter(originalMod.Replace(pista, "INNER JOIN dbo.ProblemCategoria AS pc"));
                Lotes(cn, modSinPista);
                Lotes(cn, Alter(original.Replace(candado.Value, "SET @rc = 0;")));
                Check("C6 CONTROL sin candados: dos ligados al 60% en paralelo dejan la ruta en 120% (la prueba detecta la carrera)",
                      "1.2000", Carrera(cn, "/D/Cat 1"));
                Lotes(cn, Alter(original));
                Check("C7 solo con el candado por ruta: la misma carrera deja la ruta en 60%", "0.6000", Carrera(cn, "/D/Cat 2"));
                Lotes(cn, Alter(originalMod));
                Check("C7b con todo como en la propuesta: 60%", "0.6000", Carrera(cn, "/D/Cat 3"));
                Check("C8 RCSI activo en la base de prueba", true,
                      Convert.ToBoolean(Uno(cn, "SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = DB_NAME()")));
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try
            {
                using (var m = Abrir("master"))
                    Exec(m, "IF DB_ID(N'" + Base + "') IS NOT NULL BEGIN ALTER DATABASE [" + Base + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + Base + "]; END");
                Console.WriteLine("Base " + Base + " borrada.");
            }
            catch (Exception ex) { Console.WriteLine("No se pudo borrar " + Base + ": " + ex.Message); }
        }
        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
