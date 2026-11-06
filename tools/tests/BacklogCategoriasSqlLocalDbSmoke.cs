// Prueba en SQL Server LocalDB de App_Code/BacklogCategorias.cs (pestaña
// "Lider (Categoria)" del Backlog). NO forma parte del sitio.
//
// Arma una base desechable con dbo.CorreoBacklogSnapshot (solo las columnas
// que leen el procedimiento y la consulta), un dbo.fn_CorreoBacklog_SplitList
// de prueba (STRING_SPLIT, mismo contrato: columna Valor) y, si se le pasa,
// la definicion RECONSTRUIDA de dbo.usp_CorreoBacklog_Principal
// (esquema_bd/respaldos, fuera del repo). Comprueba:
//
//   1) por (Lider, Grupo), la suma de las filas por C1 de BacklogCategorias.SQL
//      cuadra con el procedimiento: Total y Critica/Alta (result set 2),
//      +30 dias = AgingSort >= 5 (result set 3), Fuera SLA (result set 6);
//   2) mismos filtros: C1, Grupos y Lideres (listas con coma) y el corte;
//      sin fecha = el corte mas reciente;
//   3) C1 NULL sale como su propia fila, no se pierde;
//   4) jerarquia: para CADA nodo que arman las rutas (lider, C1 y cada
//      prefijo de la ruta, tambien "solo en el nodo"), la suma de las filas
//      agregadas bajo el nodo = los tickets que da SQL_TICKETS + Filtrar,
//      con y sin filtros y con el cross-filter de grupo; las hojas suman el
//      total; tickets del mas viejo al mas nuevo (sin fecha al final) y tope;
//   5) codificacion (EN1-EN3): IIS compila App_Code sin BOM con la codepage
//      ANSI del servidor (1252, no hay <globalization fileEncoding>), y un
//      N'í' crudo llegaba a SQL como N'Ã' + U+00AD: REPLACE no hacia nada,
//      'Crítica' <> 'Critica' con la intercalacion CI_AS y "Criticos" salia en
//      0 en "Lider (Categoria)". EN1 cuenta las 'Crítica' de verdad SIN
//      depender del procedimiento; EN2 exige SQL puro ASCII (falla con
//      cualquier codepage); EN3 revisa los fuentes sin BOM.
//
// Compilar y correr desde la raiz del repo. /codepage:1252 = como compila IIS
// los archivos sin BOM (sin el, EN1 no ve el mojibake del servidor):
//   csc /nologo /target:library /codepage:1252 /out:bl.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /r:bl.dll /r:System.Data.dll /out:BacklogCategoriasSqlLocalDbSmoke.exe ^
//       tools\tests\BacklogCategoriasSqlLocalDbSmoke.cs
//   BacklogCategoriasSqlLocalDbSmoke.exe [ruta\dbo.usp_CorreoBacklog_Principal_*.sql]
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

public static class BacklogCategoriasSqlLocalDbSmoke
{
    const string MAESTRA = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;Database=master";
    const string BASE = "BacklogCategoriasSmoke";
    static int fallos = 0;

    static void Chk(string caso, object esperado, object obtenido)
    {
        bool ok = Equals(Convert.ToString(esperado), Convert.ToString(obtenido));
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + esperado + "  obtenido=" + obtenido));
    }

    static void Exec(SqlConnection cn, string sql)
    {
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (lote.Trim().Length > 0) using (var c = new SqlCommand(lote, cn)) c.ExecuteNonQuery();
    }

    static List<Dictionary<string, object>> Leer(SqlDataReader rd)
    {
        var l = new List<Dictionary<string, object>>();
        while (rd.Read())
        {
            var f = new Dictionary<string, object>();
            for (int i = 0; i < rd.FieldCount; i++) f[rd.GetName(i)] = rd.IsDBNull(i) ? null : rd.GetValue(i);
            l.Add(f);
        }
        return l;
    }

    static List<Dictionary<string, object>> Consulta(SqlConnection cn, string corte, string c1, string grupos, string lideres)
    {
        using (var cmd = new SqlCommand(BacklogCategorias.SQL, cn))
        {
            cmd.Parameters.Add("@FechaCorte", SqlDbType.NVarChar, 10).Value = (object)corte ?? DBNull.Value;
            cmd.Parameters.Add("@SortMas30", SqlDbType.Int).Value = BacklogCategorias.SORT_MAS_30;
            cmd.Parameters.Add("@C1", SqlDbType.NVarChar, -1).Value = (object)c1 ?? DBNull.Value;
            cmd.Parameters.Add("@Grupos", SqlDbType.NVarChar, -1).Value = (object)grupos ?? DBNull.Value;
            cmd.Parameters.Add("@Lideres", SqlDbType.NVarChar, -1).Value = (object)lideres ?? DBNull.Value;
            using (var rd = cmd.ExecuteReader()) return Leer(rd);
        }
    }

    static List<List<Dictionary<string, object>>> Procedimiento(SqlConnection cn, string corte, string c1, string grupos, string lideres)
    {
        using (var cmd = new SqlCommand("dbo.usp_CorreoBacklog_Principal", cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.Parameters.AddWithValue("@FechaCorte", (object)corte ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@C1", (object)c1 ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@Grupos", (object)grupos ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@Lideres", (object)lideres ?? DBNull.Value);
            var sets = new List<List<Dictionary<string, object>>>();
            using (var rd = cmd.ExecuteReader()) do { sets.Add(Leer(rd)); } while (rd.NextResult());
            return sets;
        }
    }

    static int I(object o) { return o == null ? 0 : Convert.ToInt32(o); }
    static string K(Dictionary<string, object> f) { return f["Lider"] + "|" + f["Grupo"]; }

    static void Cuadrar(SqlConnection cn, string caso, string corte, string c1, string grupos, string lideres)
    {
        var q = Consulta(cn, corte, c1, grupos, lideres);
        var sp = Procedimiento(cn, corte, c1, grupos, lideres);
        var porLG = q.GroupBy(K).ToDictionary(g => g.Key, g => new[] {
            g.Sum(x => I(x["Total"])), g.Sum(x => I(x["Critica"])), g.Sum(x => I(x["Alta"])),
            g.Sum(x => I(x["Mas30"])), g.Sum(x => I(x["FueraSLA"])) });
        var esperado = new Dictionary<string, int[]>();
        foreach (var f in sp[1]) esperado[K(f)] = new[] { I(f["Total"]), I(f["Critica"]), I(f["Alta"]), 0, 0 };
        foreach (var f in sp[2]) if (I(f["AgingSort"]) >= 5) esperado[K(f)][3] += I(f["Tickets"]);
        foreach (var f in sp[5]) if (Convert.ToString(f["EstadoSLA"]) == "Fuera SLA") esperado[K(f)][4] += I(f["Tickets"]);
        Func<Dictionary<string, int[]>, string> txt = d => string.Join(";", d.OrderBy(x => x.Key, StringComparer.Ordinal)
            .Select(x => x.Key + "=" + string.Join(",", x.Value)));
        Chk(caso + ": por (Lider, Grupo) cuadra con el procedimiento", txt(esperado), txt(porLG));
        Chk(caso + ": total = KPI BacklogTotal", I(sp[0][0]["BacklogTotal"]), q.Sum(x => I(x["Total"])));
    }

    static bool Igual(string a, string b) { return string.Equals(a, b, StringComparison.OrdinalIgnoreCase); }
    static string S(object o) { return o == null || o is DBNull ? null : o.ToString(); }

    // Los tickets de un nodo como los pide el navegador.
    static Dictionary<string, object> TicketsNodo(SqlConnection cn, string corte, string c1, string grupos, string lideres,
        BacklogCategorias.Nodo nodo)
    {
        using (var cmd = new SqlCommand(BacklogCategorias.SQL_TICKETS, cn))
        {
            var f = new Dictionary<string, object> { { "C1", c1 }, { "Grupos", grupos }, { "Lideres", lideres } };
            BacklogCategorias.Parametros(cmd, f, corte, nodo);
            using (var rd = cmd.ExecuteReader()) return BacklogCategorias.Filtrar(Leer(rd), nodo);
        }
    }

    // Cada nodo del arbol (como lo arma backlog.js): su cifra agregada = sus tickets.
    static void Jerarquia(SqlConnection cn, string caso, string corte, string c1, string grupos, string lideres, string grupoCruzado)
    {
        var filas = Consulta(cn, corte, c1, grupos, lideres)
            .Where(x => grupoCruzado == null || S(x["Grupo"]) == grupoCruzado).ToList();
        // (lider, c1, ruta, exacto) de todos los nodos: cada prefijo de cada ruta.
        var nodos = new Dictionary<string, BacklogCategorias.Nodo>();
        int hojas = 0;
        foreach (var x in filas)
        {
            bool coincide;
            var sub = BacklogCategorias.Segmentos(S(x["Categoria"]), S(x["C1"]), out coincide);
            for (int k = 0; k <= sub.Count; k++)
                foreach (var exacto in new[] { false, true })
                {
                    var n = new BacklogCategorias.Nodo { Lider = S(x["Lider"]), C1 = string.IsNullOrWhiteSpace(S(x["C1"])) ? null : S(x["C1"]),
                        Grupo = grupoCruzado, Exacto = exacto };
                    n.Ruta.AddRange(sub.Take(k));
                    nodos[(n.Lider + "|" + n.C1 + "|" + string.Join("/", n.Ruta) + "|" + exacto).ToLowerInvariant()] = n;
                }
            hojas += I(x["Total"]);
        }
        int malos = 0, revisados = 0, profundo = 0;
        foreach (var n in nodos.Values)
        {
            var esperado = filas.Where(x => S(x["Lider"]) == n.Lider
                    && (n.C1 == null ? string.IsNullOrWhiteSpace(S(x["C1"])) : Igual(S(x["C1"]), n.C1)))
                .Where(x => { bool c; return BacklogCategorias.BajoRuta(BacklogCategorias.Segmentos(S(x["Categoria"]), S(x["C1"]), out c), n.Ruta, n.Exacto); })
                .Sum(x => I(x["Total"]));
            var r = TicketsNodo(cn, corte, c1, grupos, lideres, n);
            revisados++;
            profundo = Math.Max(profundo, n.Ruta.Count);
            if (I(r["total"]) != esperado)
            {
                malos++;
                Console.WriteLine("   nodo " + n.Lider + " / " + n.C1 + " / " + string.Join("/", n.Ruta) + (n.Exacto ? " (exacto)" : "")
                    + ": fila=" + esperado + " tickets=" + r["total"]);
            }
            var lista = (List<Dictionary<string, object>>)r["tickets"];
            for (int k = 1; k < lista.Count; k++)
            {
                var a = lista[k - 1]["FechaRegistro"]; var b = lista[k]["FechaRegistro"];
                if (a == null && b != null) { malos++; Console.WriteLine("   orden: sin fecha antes que con fecha"); break; }
                if (a != null && b != null && ((DateTime)a) > ((DateTime)b)) { malos++; Console.WriteLine("   orden: no es del mas viejo al mas nuevo"); break; }
            }
        }
        Chk(caso + ": cada nodo (" + revisados + ", hasta " + profundo + " niveles bajo C1) cuadra con sus tickets", 0, malos);
        Chk(caso + ": hay nodos de 3 niveles bajo C1", true, profundo >= 3);
        // Las hojas: cada fila agregada acaba en un solo nodo exacto.
        int sumaExactos = nodos.Values.Where(n => n.Exacto).Sum(n => filas.Where(x => S(x["Lider"]) == n.Lider
                && (n.C1 == null ? string.IsNullOrWhiteSpace(S(x["C1"])) : Igual(S(x["C1"]), n.C1)))
            .Where(x => { bool c; return BacklogCategorias.BajoRuta(BacklogCategorias.Segmentos(S(x["Categoria"]), S(x["C1"]), out c), n.Ruta, true); })
            .Sum(x => I(x["Total"])));
        Chk(caso + ": los nodos exactos suman el total (ningun ticket dos veces)", hojas, sumaExactos);
    }

    // Criticas por lider en el corte mas reciente, contadas sin literal no ASCII.
    static string CriticasPorLider(SqlConnection cn)
    {
        using (var c = new SqlCommand(@"SELECT Lider = ISNULL(Lider, N''),
  N = SUM(CASE WHEN Prioridad IN (N'Cr' + NCHAR(237) + N'tica', N'Critica') THEN 1 ELSE 0 END)
FROM dbo.CorreoBacklogSnapshot WHERE FechaCorte = (SELECT MAX(FechaCorte) FROM dbo.CorreoBacklogSnapshot)
GROUP BY ISNULL(Lider, N'')", cn))
        using (var rd = c.ExecuteReader())
        {
            var l = new List<KeyValuePair<string, int>>();
            while (rd.Read()) l.Add(new KeyValuePair<string, int>(rd.GetString(0), rd.GetInt32(1)));
            return string.Join(";", l.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key + "=" + x.Value));
        }
    }

    // Posiciones de los caracteres no ASCII de un texto, o "".
    static string NoAscii(string nombre, string texto)
    {
        var malas = new List<string>();
        for (int i = 0; i < texto.Length; i++)
            if (texto[i] > 127) malas.Add(nombre + "[" + i + "]=U+" + ((int)texto[i]).ToString("X4"));
        return string.Join(" ", malas.ToArray());
    }

    // Archivos sin BOM con caracteres no ASCII fuera de comentarios (como
    // GestionIniciativaAdminSmoke.NoAsciiEnCodigo). Rutas desde la raiz del repo.
    static string NoAsciiEnCodigo(params string[] archivos)
    {
        var malas = new List<string>();
        foreach (var a in archivos)
        {
            if (!File.Exists(a)) { malas.Add(a + ":no existe (correr desde la raiz del repo)"); continue; }
            var b = File.ReadAllBytes(a);
            if (b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF) continue;
            var lineas = System.Text.Encoding.GetEncoding(28591).GetString(b).Split('\n');
            var enBloque = false;
            for (var i = 0; i < lineas.Length; i++)
            {
                var l = lineas[i].Trim();
                if (enBloque) { if (l.Contains("*/")) enBloque = false; continue; }
                if (l.StartsWith("/*")) { enBloque = !l.Contains("*/"); continue; }
                if (l.StartsWith("//") || l.StartsWith("<%--")) continue;
                var codigo = l.IndexOf("//") >= 0 && !l.Contains("://") ? l.Substring(0, l.IndexOf("//")) : l;
                if (codigo.Any(ch => ch > 127)) malas.Add(a + ":" + (i + 1));
            }
        }
        return string.Join(" ", malas.ToArray());
    }

    public static int Main(string[] args)
    {
        string spPath = args.Length > 0 ? args[0] : null;
        using (var m = new SqlConnection(MAESTRA))
        {
            m.Open();
            Exec(m, "IF DB_ID('" + BASE + "') IS NOT NULL BEGIN ALTER DATABASE " + BASE +
                    " SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE " + BASE + "; END; CREATE DATABASE " + BASE + ";");
        }
        try
        {
            using (var cn = new SqlConnection(MAESTRA.Replace("Database=master", "Database=" + BASE)))
            {
                cn.Open();
                Exec(cn, @"
CREATE TABLE dbo.CorreoBacklogSnapshot (
  FechaCorte date NOT NULL, CodigoTicket nvarchar(100) NOT NULL, Grupo nvarchar(255), Lider nvarchar(255),
  Prioridad nvarchar(100), Aging nvarchar(50), AgingSort int, EstadoSLA nvarchar(100), DiasBacklog int,
  ReasignacionesGrupo int, IntentosSolucion int, Subestado nvarchar(255), C1 nvarchar(255),
  Categoria nvarchar(1000), FechaRegistro datetime2(0), Titulo nvarchar(max), Descripcion nvarchar(max),
  TecnicoSegundaLinea nvarchar(255),
  FechaHoraSnapshot datetime2(0) NOT NULL DEFAULT SYSDATETIME());
GO
CREATE FUNCTION dbo.fn_CorreoBacklog_SplitList(@Lista nvarchar(max)) RETURNS TABLE AS RETURN
  SELECT Valor = LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Lista, N',') WHERE LTRIM(RTRIM(value)) <> N'';
GO");
                // Datos sinteticos: 2 cortes, 3 lideres, grupos repartidos en varias C1, C1 NULL,
                // prioridades con y sin acento, cubos de antiguedad y estados SLA mezclados.
                var rnd = new Random(7);
                string[] lid = { "Laura", "Jesus", "Sin Torre" };
                string[] c1s = { "S-Punto de Venta", "S-Logistica", "S-Finanzas", null };
                // í (no el caracter crudo): el dato sembrado no depende de
                // la codepage con que se compile esta prueba.
                string[] pri = { "Crítica", "Critica", "Alta", "Media", "Baja" };
                string[] sla = { "Dentro SLA", "Fuera SLA", "Dentro SLA(Subestado)", "Tramite de compra", null };
                // Rutas por C1: varios niveles, ruta que acaba en un nodo intermedio,
                // variantes de mayusculas / espacios / '/' final, y una que no empieza por su C1.
                var rutas = new Dictionary<string, string[]> {
                    { "S-Punto de Venta", new[] { "/S-Punto de Venta/Aplicativo/Caja", "/S-Punto de Venta/Aplicativo",
                        "/S-Punto de Venta/Hardware/Impresora/Termica", "/S-Punto de Venta/Hardware/Impresora/Laser",
                        "/S-Punto de Venta", " /s-punto de venta / aplicativo /Caja/", "/Otra Cosa/Aplicativo", null } },
                    { "S-Logistica", new[] { "/S-Logistica/CEDIS", "/S-Logistica/CEDIS/Andenes", "S-Logistica/Transporte" } },
                    { "S-Finanzas", new[] { "/S-Finanzas/SAP/FI", "/S-Finanzas/SAP/CO", "/S-Finanzas" } },
                    { "", new[] { null, "/Algo/Sin C1" } },
                };
                int n = 0;
                foreach (var corte in new[] { "2026-11-02", "2026-11-03" })
                    for (int i = 0; i < 400; i++)
                    {
                        var l = lid[rnd.Next(lid.Length)];
                        var g = l + "-G" + rnd.Next(3);
                        var s = rnd.Next(8);
                        using (var c = new SqlCommand(@"INSERT dbo.CorreoBacklogSnapshot
 (FechaCorte, CodigoTicket, Grupo, Lider, Prioridad, Aging, AgingSort, EstadoSLA, DiasBacklog, ReasignacionesGrupo, IntentosSolucion, Subestado, C1, Categoria, FechaRegistro, Titulo)
 VALUES (@f, @c, @g, @l, @p, @a, @s, @e, @d, @r, @i, @sub, @c1, @cat, @fr, @ti)", cn))
                        {
                            c.Parameters.AddWithValue("@f", corte);
                            c.Parameters.AddWithValue("@c", "T" + (n++));
                            c.Parameters.AddWithValue("@g", g);
                            c.Parameters.AddWithValue("@l", l);
                            c.Parameters.AddWithValue("@p", pri[rnd.Next(pri.Length)]);
                            c.Parameters.AddWithValue("@a", "A" + s);
                            c.Parameters.AddWithValue("@s", s);
                            c.Parameters.AddWithValue("@e", (object)sla[rnd.Next(sla.Length)] ?? DBNull.Value);
                            c.Parameters.AddWithValue("@d", s * 10);
                            c.Parameters.AddWithValue("@r", rnd.Next(3));
                            c.Parameters.AddWithValue("@i", rnd.Next(3));
                            c.Parameters.AddWithValue("@sub", "Sub" + rnd.Next(3));
                            var c1 = c1s[rnd.Next(c1s.Length)];
                            var rs = rutas[c1 ?? ""];
                            c.Parameters.AddWithValue("@c1", (object)c1 ?? DBNull.Value);
                            c.Parameters.AddWithValue("@cat", (object)rs[rnd.Next(rs.Length)] ?? DBNull.Value);
                            c.Parameters.AddWithValue("@fr", rnd.Next(10) == 0 ? (object)DBNull.Value : new DateTime(2026, 1, 1).AddDays(rnd.Next(300)));
                            c.Parameters.AddWithValue("@ti", "Titulo " + n);
                            c.ExecuteNonQuery();
                        }
                    }

                // Sin procedimiento: solo las comprobaciones propias de la consulta.
                var todo = Consulta(cn, null, null, null, null);
                Chk("sin fecha = corte mas reciente (400 tickets)", 400, todo.Sum(x => I(x["Total"])));
                Chk("corte 2026-11-02 explicito (400 tickets)", 400, Consulta(cn, "2026-11-02", null, null, null).Sum(x => I(x["Total"])));
                Chk("C1 NULL tiene su propia fila", true, todo.Any(x => x["C1"] == null));
                Chk("filtro C1 lista: solo esas C1", "S-Finanzas,S-Logistica",
                    string.Join(",", Consulta(cn, null, "S-Logistica, S-Finanzas", null, null).Select(x => (string)x["C1"]).Distinct().OrderBy(x => x)));
                Chk("filtro Lideres: solo Laura", "Laura",
                    string.Join(",", Consulta(cn, null, null, null, "Laura").Select(x => (string)x["Lider"]).Distinct()));

                // EN1: Critica de la consulta = tickets con prioridad critica,
                // con y sin acento, contados aqui con NCHAR(237) (sin literal
                // no ASCII). Es la regresion de "Criticos" en 0.
                int conAcento, sinAcento;
                using (var c = new SqlCommand(@"SELECT
  ConAcento = SUM(CASE WHEN Prioridad = N'Cr' + NCHAR(237) + N'tica' THEN 1 ELSE 0 END),
  SinAcento = SUM(CASE WHEN Prioridad = N'Critica' THEN 1 ELSE 0 END)
FROM dbo.CorreoBacklogSnapshot WHERE FechaCorte = (SELECT MAX(FechaCorte) FROM dbo.CorreoBacklogSnapshot)", cn))
                using (var rd = c.ExecuteReader())
                {
                    rd.Read();
                    conAcento = rd.GetInt32(0); sinAcento = rd.GetInt32(1);
                }
                Chk("EN1 hay 'Crítica' con acento en el corte (la prueba tiene con que fallar)", true, conAcento > 0);
                Chk("EN1 Critica de la consulta = 'Crítica' + 'Critica' del corte", conAcento + sinAcento, todo.Sum(x => I(x["Critica"])));
                Chk("EN1 por lider: Critica = sus 'Crítica' + 'Critica'", CriticasPorLider(cn),
                    string.Join(";", todo.GroupBy(x => S(x["Lider"]) ?? "").OrderBy(g => g.Key, StringComparer.Ordinal)
                        .Select(g => g.Key + "=" + g.Sum(x => I(x["Critica"])))));
                Chk("EN2 SQL y SQL_TICKETS sin caracteres no ASCII (no dependen de la codepage del servidor)", "",
                    NoAscii("SQL", BacklogCategorias.SQL) + NoAscii("SQL_TICKETS", BacklogCategorias.SQL_TICKETS));
                Chk("EN3 fuentes sin BOM: ningun caracter no ASCII fuera de comentarios", "",
                    NoAsciiEnCodigo(@"App_Code\BacklogCategorias.cs", @"handlers\backlog_categorias.ashx"));

                Jerarquia(cn, "sin filtros", null, null, null, null, null);
                Jerarquia(cn, "corte anterior + C1 + Lideres", "2026-11-02", "S-Punto de Venta,S-Finanzas", null, "Laura,Jesus", null);
                Jerarquia(cn, "cross-filter grupo Laura-G1", null, null, null, null, "Laura-G1");
                Jerarquia(cn, "filtro Grupos", null, null, "Laura-G0,Jesus-G2", null, null);

                // Tope: el total cuenta todo, la lista se corta.
                var muchas = new List<Dictionary<string, object>>();
                for (int k = 0; k < BacklogCategorias.TOPE_TICKETS + 100; k++)
                    muchas.Add(new Dictionary<string, object> { { "C1", "X" }, { "Categoria", "/X/A" }, { "CodigoTicket", "M" + k } });
                var nx = new BacklogCategorias.Nodo { Lider = "L", C1 = "X" };
                nx.Ruta.Add("a");
                var rx = BacklogCategorias.Filtrar(muchas, nx);
                Chk("tope: total completo, lista cortada", (BacklogCategorias.TOPE_TICKETS + 100) + "/" + BacklogCategorias.TOPE_TICKETS,
                    rx["total"] + "/" + ((List<Dictionary<string, object>>)rx["tickets"]).Count);

                if (spPath == null || !File.Exists(spPath))
                {
                    Console.WriteLine("AVISO  sin ruta al procedimiento reconstruido: no se cuadra contra usp_CorreoBacklog_Principal");
                }
                else
                {
                    var def = File.ReadAllText(spPath);
                    def = def.Substring(def.IndexOf("CREATE", StringComparison.OrdinalIgnoreCase));
                    Exec(cn, def);
                    Cuadrar(cn, "sin filtros", null, null, null, null);
                    Cuadrar(cn, "corte anterior", "2026-11-02", null, null, null);
                    Cuadrar(cn, "C1 + Lideres", null, "S-Punto de Venta,S-Finanzas", null, "Laura,Jesus");
                    Cuadrar(cn, "Grupos", "2026-11-02", null, "Laura-G0,Jesus-G2", null);
                }
            }
        }
        finally
        {
            using (var m = new SqlConnection(MAESTRA))
            {
                m.Open();
                Exec(m, "ALTER DATABASE " + BASE + " SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE " + BASE + ";");
            }
        }
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
