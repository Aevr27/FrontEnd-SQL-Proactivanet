// Prueba de INTEGRACION de las categorias que ADM puede elegir (Crear /
// Modificar) contra una base REAL pero DESECHABLE de SQL Server LocalDB:
// crea GestionAdminPrueba_CatAdm, aplica la replica, el cargador 174bb51,
// las vistas del backend y sql/18, 20, 21, 22 (la VM hoy); corre los casos y
// BORRA la base al final. Nunca toca la VM ni Tickets_Proactivanet.
//
// Lo que reproduce: una categoria ACTIVA que esta en dbo.Categorias Y en
// dbo.CatCategoriaDueno, pero a la que le falta un dueño (PO NULL), no
// aparecia ni se podia guardar en Crear / Modificar: CatalogoRutasIniciativa
// la descartaba (rutas_sin_duenos) y el validador de ADM usaba ese mismo
// catalogo. Ahora ADM usa ElegiblesAdm; la cascada (Nueva solicitud) no
// cambia.
//
// Casos:
//   R  lectura: LeerRutasActivas + ElegiblesAdm (activas, sin inactivas ni
//      no vigentes, sin repetidas por mayusculas / espacios / NBSP, dueños
//      tal cual o null) y Asignaciones (la cascada) sin cambio.
//   V  validador con el catalogo de ADM: acepta la ruta sin PO (avisa), la
//      sin fila de dueños y la de dueños dados de baja; rechaza inactiva y
//      no vigente. Con el catalogo de la cascada, la sin PO se rechaza (el
//      comportamiento de antes, que sigue siendo el de Nueva solicitud).
//   C  Crear real (adm.usp_GestionAdmin_Crear) con la ruta sin PO: se emite
//      el Codigo y queda la fila de ProblemCategoria; dueños NULL.
//   M  Modificar real: agregar una ruta sin fila de dueños + Titulo: el
//      Codigo no cambia, no hay Problem nuevo, la ruta queda ligada.
//   K  Codigo inmutable: 'codigo' (y 'CODIGO') en la peticion se rechaza;
//      el plan usa el folio LEIDO; adm.usp_GestionAdmin_Modificar no tiene
//      parametro con que cambiarlo.
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

public static class CategoriasAdmSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    const string Backend = @"..\backend_admin_persistencia";
    const string Base = "GestionAdminPrueba_CatAdm";
    static readonly DateTime Hoy = new DateTime(2026, 10, 20);
    static readonly string NBSP = ((char)0xA0).ToString();
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
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }

    static void Preparar()
    {
        Borrar(Base);
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + Base + "]");
        using (var cn = Abrir(Base))
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
            Exec(cn, @"
INSERT dbo.CatPrefijoProblem (Prefijo, Descripcion, ControlDeFecha) VALUES (N'PRB', N'Problem', 1);
-- Rutas: completa, sin PO, duenos dados de baja, sin fila de duenos,
-- inactiva, no vigente y tres grafias repetidas de la completa (mayusculas
-- + espacio, NBSP) mas un Id inactivo de la ruta sin PO.
INSERT dbo.Categorias (Id, RutaCompleta, Inactiva, VigenteEnOrigen) VALUES
 (N'k1', N'/A/Completa/Hoja', 0, 1),
 (N'k2', N'/B/SinPo/Hoja', NULL, 1),
 (N'k3', N'/C/Baja/Hoja', 0, 1),
 (N'k4', N'/D/SinFila/Hoja', 0, 1),
 (N'k5', N'/E/Inactiva/Hoja', 1, 1),
 (N'k6', N'/E/NoVigente/Hoja', 0, 0),
 (N'k7', N' /a/completa/hoja ', 0, 1),
 (N'k8', N'/A/Completa/Hoja' + NCHAR(160), 0, 1),
 (N'k9', N'/B/SinPo/Hoja', 1, 1);
INSERT dbo.CatCategoriaDueno (CategoriaN2, ProductOwner, ServiceOwner, DirectorPO, C1, VigenteEnOrigen) VALUES
 (N'/A/Completa', N'PO Uno', N'SO Uno', N'Dir Uno', N'A', 1),
 (N'/B/SinPo', NULL, N'SO Dos', N'Dir Dos', N'B', 1),
 (N'/C/Baja', N'PO Tres', N'SO Tres', N'Dir Tres', N'C', 0),
 (N'/E/Inactiva', N'PO Cinco', N'SO Cinco', N'Dir Cinco', N'E', 1);
INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Estado, Subestado, FechaAnalisis, FechaCreacion) VALUES
 (N'PRB 2026-000001', N'Problem', N'Uno', N'En An" + "á" + @"lisis', NULL, '2026-09-01', '2026-09-01');
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'/A/Completa/Hoja', N'Problem', N'Problem', 0.2000, 1);");
        }
    }

    static NameValueCollection F(params string[] kv)
    {
        var f = new NameValueCollection();
        for (var i = 0; i < kv.Length; i += 2) f.Add(kv[i], kv[i + 1]);
        return f;
    }

    static string Rutas(System.Collections.IEnumerable filas)
    {
        var l = new List<string>();
        foreach (Dictionary<string, object> f in filas)
            l.Add((string)f["categoria"] + "[" + (f["director"] ?? "null") + "," + (f["po"] ?? "null") + "," + (f["so"] ?? "null") + "]");
        return string.Join(" ; ", l.ToArray());
    }

    static string Errores(ResultadoGestionAdmin r)
    {
        return string.Join(" | ", r.Errores.Select(e => e.Campo + ":" + e.Mensaje).ToArray());
    }

    public static int Main()
    {
        try
        {
            Preparar();
            CatalogoSolicitud catAdm, catCascada;
            List<object> tipos;
            EstadosProblem estados;
            List<CapacidadCategoria.Compromiso> compromisos;
            using (var cn = Abrir(Base))
            {
                var dir = DirectorioOrganizacional.Cargar(cn);
                var activas = CatalogoRutasIniciativa.LeerRutasActivas(cn);
                var cascada = CatalogoRutasIniciativa.Asignaciones(activas, dir);
                var adm = CatalogoRutasIniciativa.ElegiblesAdm(activas, dir);

                // ---------------- R: lectura ----------------
                Check("R1 ElegiblesAdm: activas y unicas, con o sin duenos (null si faltan); sin inactiva ni no vigente",
                      "/A/Completa/Hoja[Dir Uno,PO Uno,SO Uno] ; /B/SinPo/Hoja[Dir Dos,null,SO Dos] ; " +
                      "/C/Baja/Hoja[Dir Tres,PO Tres,SO Tres] ; /D/SinFila/Hoja[null,null,null]",
                      Rutas((System.Collections.IEnumerable)adm["rutas_adm"]));
                Check("R2 ElegiblesAdm cuenta las rutas a las que les falta algun dueno", 2, adm["rutas_adm_sin_duenos"]);
                Check("R3 cascada (Nueva solicitud) SIN CAMBIO: solo la completa y vigente; el resto contado aparte",
                      "/A/Completa/Hoja[Dir Uno,PO Uno,SO Uno]|2|1",
                      Rutas((System.Collections.IEnumerable)cascada["rutas"]) + "|" + cascada["rutas_sin_duenos"] + "|" + cascada["rutas_duenos_no_vigentes"]);
                Check("R4 RutasAdm: solo las rutas", "/A/Completa/Hoja,/B/SinPo/Hoja,/C/Baja/Hoja,/D/SinFila/Hoja",
                      string.Join(",", CatalogoRutasIniciativa.RutasAdm(adm).ToArray()));

                tipos = DashboardCatalogos.Llaves(DashboardCatalogos.PrefijosIniciativa(cn));
                catAdm = CatalogoSolicitud.ParaAdm(tipos, (System.Collections.IEnumerable)cascada["rutas"], (System.Collections.IEnumerable)adm["rutas_adm"]);
                catCascada = CatalogoSolicitud.Desde(tipos, (System.Collections.IEnumerable)cascada["rutas"]);
                estados = ExperienciaQueries.LeerEstadosProblem(cn).Valores;
                compromisos = ExperienciaQueries.CompromisosCapacidad(cn);
            }
            var capacidad = new CapacidadCategoria(compromisos);
            var v = new ValidadorGestionAdmin();

            // ---------------- V: validador ----------------
            Func<string, PeticionCrearAdmin> alta = ruta => PeticionCrearAdmin.DesdeFormulario(
                F("tipo", "PRB", "titulo", "[PRUEBA 676767] categoria sin duenos", "estado", "En Análisis", "cat_ruta", ruta, "cat_pct", "10"), false);
            var rSinPo = v.Crear(alta("/B/SinPo/Hoja"), catAdm, capacidad, "PRB", estados);
            Check("V1 ADM: ruta activa sin PO es valida y avisa lo que falta (sin inventarlo)", "True|True|",
                  rSinPo.Valida + "|" + rSinPo.Advertencias.Any(a => a.Contains("/B/SinPo/Hoja") && a.Contains("Product Owner") && !a.Contains("Service Owner")) +
                  "|" + Errores(rSinPo));
            Check("V2 ADM: el Director que se ve es el que resolvio el catalogo", "Dir Dos", rSinPo.Director);
            var rSinFila = v.Crear(alta("/D/SinFila/Hoja"), catAdm, capacidad, "PRB", estados);
            Check("V3 ADM: ruta sin fila de duenos es valida; sin Director", "True|", rSinFila.Valida + "|" + rSinFila.Director);
            var rBaja = v.Crear(alta("/C/Baja/Hoja"), catAdm, capacidad, "PRB", estados);
            Check("V4 ADM: ruta con duenos dados de baja es valida y lo avisa", "True|True",
                  rBaja.Valida + "|" + rBaja.Advertencias.Any(a => a.Contains("/C/Baja/Hoja") && a.Contains("dada de baja")));
            var rCompleta = v.Crear(alta("/A/Completa/Hoja"), catAdm, capacidad, "PRB", estados);
            Check("V5 ADM: ruta completa sigue valida y sin aviso de duenos", "True|False",
                  rCompleta.Valida + "|" + rCompleta.Advertencias.Any(a => a.Contains("catálogo de dueños")));
            Check("V6 ADM: inactiva y no vigente se rechazan", "False|False",
                  v.Crear(alta("/E/Inactiva/Hoja"), catAdm, capacidad, "PRB", estados).Valida + "|" +
                  v.Crear(alta("/E/NoVigente/Hoja"), catAdm, capacidad, "PRB", estados).Valida);
            Check("V7 cascada (sin rutas ADM): la ruta sin PO se rechaza como antes", "False",
                  v.Crear(alta("/B/SinPo/Hoja"), catCascada, capacidad, "PRB", estados).Valida);
            Check("V8 grafia distinta de una ruta (no exacta) no se acepta", "False",
                  v.Crear(alta("/a/completa/hoja"), catAdm, capacidad, "PRB", estados).Valida);

            // ---------------- C: Crear real ----------------
            var pc = alta("/B/SinPo/Hoja");
            var plan = PlanificadorGestionAdmin.Crear(pc, rSinPo, Hoy);
            string nuevo;
            using (var cn = Abrir(Base)) nuevo = new EscritorGestionAdminSql().Crear(cn, null, plan, @"SORIANA\adm1");
            Check("C1 Crear con la ruta sin PO: el procedimiento emite el Codigo", true, nuevo != null && nuevo.StartsWith("PRB 2026-"));
            Check("C2 la ruta queda ligada con su %; duenos capturados NULL (no se inventan)", "1|0.1000|NULL|NULL",
                  Uno("SELECT CONVERT(varchar(10), COUNT(*)) + '|' + CONVERT(varchar(10), MAX(pc.PctDisminucion)) + '|' + " +
                      "ISNULL(MAX(p.OwnerProblem), 'NULL') + '|' + ISNULL(MAX(p.OwnerServicio), 'NULL') " +
                      "FROM dbo.ProblemCategoria AS pc JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo " +
                      "WHERE pc.Codigo = N'" + nuevo + "' AND pc.Categoria = N'/B/SinPo/Hoja' AND pc.VigenteEnOrigen = 1"));

            // ---------------- M: Modificar real ----------------
            var actual = IniciativaActual.DesdeRegistro(new Dictionary<string, object>
            {
                { "folio", nuevo }, { "titulo_problem", "[PRUEBA 676767] categoria sin duenos" }, { "estado", "En Análisis" },
                { "categorias", new List<object> { new Dictionary<string, object>
                    { { "categoria", "/B/SinPo/Hoja" }, { "pct_dism", 0.1 }, { "agrup", "Problem" } } } },
            });
            var problemasAntes = Uno("SELECT COUNT(*) FROM dbo.Problem");
            var pm = PeticionModificarAdmin.DesdeFormulario(F("folio", nuevo, "titulo", "[PRUEBA 676767] editada",
                "agregar_categoria", "/D/SinFila/Hoja", "agregar_pct", "5",
                "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"));
            var rm = v.Modificar(pm, actual, compromisos, catAdm, estados);
            Check("M1 ADM: agregar una ruta sin fila de duenos es valido y lo avisa", "True|True|",
                  rm.Valida + "|" + rm.Advertencias.Any(a => a.Contains("/D/SinFila/Hoja") && a.Contains("Director")) + "|" + Errores(rm));
            var planM = PlanificadorGestionAdmin.Modificar(pm, actual, rm, Hoy);
            using (var cn = Abrir(Base)) new EscritorGestionAdminSql().Modificar(cn, null, planM, @"SORIANA\adm2");
            Check("M2 Modificar: mismo Codigo, ningun Problem nuevo, titulo cambiado, dos rutas ligadas",
                  nuevo + "|" + problemasAntes + "|[PRUEBA 676767] editada|2",
                  planM.Codigo + "|" + Uno("SELECT COUNT(*) FROM dbo.Problem") + "|" +
                  Uno("SELECT Titulo FROM dbo.Problem WHERE Codigo = N'" + nuevo + "'") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE Codigo = N'" + nuevo + "' AND VigenteEnOrigen = 1"));
            Check("M3 cascada (sin rutas ADM): agregar la ruta sin duenos se rechaza como antes", "False",
                  v.Modificar(PeticionModificarAdmin.DesdeFormulario(F("folio", nuevo, "agregar_categoria", "/C/Baja/Hoja", "agregar_pct", "1")),
                              actual, compromisos, catCascada, estados).Valida);

            // ---------------- K: Codigo inmutable ----------------
            foreach (var clave in new[] { "codigo", "CODIGO" })
            {
                var rk = v.Modificar(PeticionModificarAdmin.DesdeFormulario(F("folio", nuevo, clave, "PRB 2026-999999", "titulo", "x")),
                                     actual, compromisos, catAdm, estados);
                Check("K1 '" + clave + "' en la peticion se rechaza (campo codigo)", "False|True",
                      rk.Valida + "|" + rk.Errores.Any(e => e.Campo == "codigo"));
            }
            Check("K2 adm.usp_GestionAdmin_Modificar: el unico parametro de Codigo es @Codigo (identifica)", "@Codigo",
                  Uno("SELECT STRING_AGG(name, ',') FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar') AND name LIKE N'%Codigo%'"));
            Check("K3 el Codigo emitido sigue existiendo y el falso no", "1|0",
                  Uno("SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'" + nuevo + "'") + "|" +
                  Uno("SELECT COUNT(*) FROM dbo.Problem WHERE Codigo = N'PRB 2026-999999'"));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar la base: " + ex.Message + ")"); }
        }
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        Console.WriteLine(fallos == 0 ? "TODO PASO" : "HAY FALLAS");
        return fallos == 0 ? 0 : 1;
    }
}
