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
//   3) C1 NULL sale como su propia fila, no se pierde.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:bl.dll /r:System.dll /r:System.Data.dll ^
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
                string[] pri = { "Crítica", "Critica", "Alta", "Media", "Baja" };
                string[] sla = { "Dentro SLA", "Fuera SLA", "Dentro SLA(Subestado)", "Tramite de compra", null };
                int n = 0;
                foreach (var corte in new[] { "2026-11-02", "2026-11-03" })
                    for (int i = 0; i < 400; i++)
                    {
                        var l = lid[rnd.Next(lid.Length)];
                        var g = l + "-G" + rnd.Next(3);
                        var s = rnd.Next(8);
                        using (var c = new SqlCommand(@"INSERT dbo.CorreoBacklogSnapshot
 (FechaCorte, CodigoTicket, Grupo, Lider, Prioridad, Aging, AgingSort, EstadoSLA, DiasBacklog, ReasignacionesGrupo, IntentosSolucion, Subestado, C1)
 VALUES (@f, @c, @g, @l, @p, @a, @s, @e, @d, @r, @i, @sub, @c1)", cn))
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
                            c.Parameters.AddWithValue("@c1", (object)c1s[rnd.Next(c1s.Length)] ?? DBNull.Value);
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
