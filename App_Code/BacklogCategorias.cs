// Backlog por Lider, Grupo y Categoria para la pestaña "Lider (Categoria)"
// del tablero de Backlog (backlog/backlog.js, renderLideresCategoria).
//
// POR QUE NO SALE DEL PROCEDIMIENTO
// ---------------------------------
// dbo.usp_CorreoBacklog_Principal agrupa sus result sets SOLO por (Lider,
// Grupo) y lo comparte el correo diario de direccion: no se toca. Esta
// consulta lee la MISMA tabla (dbo.CorreoBacklogSnapshot), con el MISMO corte
// y los MISMOS tres filtros que el procedimiento arma en #Corte -incluida
// dbo.fn_CorreoBacklog_SplitList para las listas-, y agrega ademas por C1 y
// por la ruta completa de la categoria. Solo lectura: SELECTs, ningun
// INSERT/UPDATE/DELETE ni DDL.
//
// QUE CUENTA CADA COLUMNA (mismas expresiones que el procedimiento / el
// tablero, para que las cifras cuadren con "Lider (Grupo)"):
//
//   Critica   REPLACE(Prioridad, 'í', 'i') = 'Critica'   (result set 2)
//             En el SQL de abajo la 'í' va como NCHAR(237): este archivo no
//             tiene BOM e IIS lo compila con la codepage ANSI (1252), que
//             convertia N'í' en N'Ã'+U+00AD; REPLACE no hacia nada y, con la
//             intercalacion CI_AS, 'Crítica' <> 'Critica': Critica salia en 0.
//             El SQL debe quedarse en ASCII puro.
//   Alta      Prioridad = 'Alta'                         (result set 2)
//   Total     COUNT(*)                                   (result set 2)
//   Mas30     AgingSort >= 5: "mas de 30 dias", el mismo
//             corte que SORT_MAS_30 en backlog.js aplica
//             sobre el result set 3
//   FueraSLA  EstadoSLA = 'Fuera SLA'                    (result set 6)
//
// JERARQUIA. Cada fila del corte es UN ticket y trae su ruta completa en
// Categoria ('/S-Punto de Venta/Aplicativo/X') y su C1, que el corte guarda
// con dbo.fn_CorreoBacklog_CategoriaC1 (el primer segmento, recortado). La
// consulta agrupa por (Lider, Grupo, C1, Categoria): el navegador arma el
// arbol Lider -> C1 -> segundo segmento -> ... partiendo cada ruta con
// Segmentos() -su copia en JS es segmentosCategoria-, y cada nodo suma las
// filas de su subarbol. Como cada ticket tiene UNA ruta, cae en un solo
// camino del arbol y ningun nodo lo cuenta dos veces. Los niveles son los
// que traen las rutas: no se inventa ninguno.
//
// Se agrupa tambien por Grupo para que el cross-filter por grupo del tablero
// (porLiderGrupo) siga siendo exacto; el navegador suma los grupos.
//
// TICKETS DE UN NODO (Tickets): los del corte con los mismos filtros, el
// lider del nodo, su C1 y -si hay- el grupo del cross-filter; despues se
// quedan los que caen bajo la ruta del nodo con la MISMA regla de Segmentos.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;

public static class BacklogCategorias
{
    // Igual que SORT_MAS_30 de backlog/backlog.js.
    public const int SORT_MAS_30 = 5;

    // Tickets que viajan al navegador al abrir un nodo. El total del nodo
    // viaja aparte, completo.
    public const int TOPE_TICKETS = 500;

    const string CORTE_Y_FILTROS = @"
DECLARE @F DATE = ISNULL(@FechaCorte, (SELECT MAX(FechaCorte) FROM dbo.CorreoBacklogSnapshot));
";
    const string WHERE_FILTROS = @"
WHERE FechaCorte = @F
  AND (NULLIF(LTRIM(RTRIM(@C1)), N'')      IS NULL OR C1    IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@C1)))
  AND (NULLIF(LTRIM(RTRIM(@Grupos)), N'')  IS NULL OR Grupo IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Grupos)))
  AND (NULLIF(LTRIM(RTRIM(@Lideres)), N'') IS NULL OR Lider IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Lideres)))";

    public const string SQL = CORTE_Y_FILTROS + @"
SELECT
    Lider, Grupo, C1, Categoria,
    Critica  = SUM(CASE WHEN REPLACE(Prioridad, NCHAR(237), N'i') = N'Critica' THEN 1 ELSE 0 END),
    Alta     = SUM(CASE WHEN Prioridad = N'Alta' THEN 1 ELSE 0 END),
    Mas30    = SUM(CASE WHEN AgingSort >= @SortMas30 THEN 1 ELSE 0 END),
    FueraSLA = SUM(CASE WHEN EstadoSLA = N'Fuera SLA' THEN 1 ELSE 0 END),
    Total    = COUNT(*)
FROM dbo.CorreoBacklogSnapshot" + WHERE_FILTROS + @"
GROUP BY Lider, Grupo, C1, Categoria
ORDER BY Lider, C1, Categoria, Grupo;";

    // Del mas viejo al mas nuevo por FechaRegistro (sin fecha al final),
    // empates por CodigoTicket: el criterio de "Tickets mas antiguos".
    public const string SQL_TICKETS = CORTE_Y_FILTROS + @"
SELECT
    CodigoTicket, Lider, Grupo, C1, Categoria, Prioridad, FechaRegistro,
    DiasBacklog, AgingSort, EstadoSLA, Subestado, TecnicoSegundaLinea,
    Titulo = LEFT(Titulo, 120), Descripcion = LEFT(Descripcion, 300)
FROM dbo.CorreoBacklogSnapshot" + WHERE_FILTROS + @"
  AND ((@SinLider = 1 AND Lider IS NULL) OR (@SinLider = 0 AND Lider = @NodoLider))
  AND ((@SinC1 = 1 AND NULLIF(C1, N'') IS NULL) OR (@SinC1 = 0 AND C1 = @NodoC1))
  AND (@NodoGrupo IS NULL OR Grupo = @NodoGrupo)
ORDER BY CASE WHEN FechaRegistro IS NULL THEN 1 ELSE 0 END, FechaRegistro, CodigoTicket;";

    /* Los segmentos de la ruta que cuelgan de C1. Misma regla que
       fn_CategoriaC1: se quita UNA '/' inicial, se parte por '/' y se
       recorta cada segmento; las '/' finales no crean niveles vacios.
       - Si el primer segmento es el C1 de la fila (sin distinguir
         mayusculas, como la intercalacion CI de la base), lo que sigue son
         sus subniveles.
       - Si no coincide (o no hay ruta), la fila se queda en el nivel C1, sin
         subniveles: no se inventa donde va. coincide = false lo marca.
       Copia en JS: segmentosCategoria (backlog/backlog.js). */
    public static List<string> Segmentos(string categoria, string c1, out bool coincide)
    {
        var sub = new List<string>();
        coincide = true;
        if (string.IsNullOrWhiteSpace(c1)) return sub;
        var s = (categoria ?? "").Trim();
        if (s.StartsWith("/")) s = s.Substring(1);
        var partes = new List<string>();
        foreach (var p in s.Split('/')) partes.Add(p.Trim());
        while (partes.Count > 0 && partes[partes.Count - 1].Length == 0) partes.RemoveAt(partes.Count - 1);
        if (partes.Count == 0 || !string.Equals(partes[0], c1.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            coincide = false;
            return sub;
        }
        for (int i = 1; i < partes.Count; i++) sub.Add(partes[i]);
        return sub;
    }

    // La ruta del nodo, bajo su C1, cae al principio de la del ticket.
    // exacto: el ticket esta EN el nodo, no en uno de sus hijos.
    public static bool BajoRuta(List<string> sub, IList<string> ruta, bool exacto)
    {
        if (sub.Count < ruta.Count || (exacto && sub.Count != ruta.Count)) return false;
        for (int i = 0; i < ruta.Count; i++)
            if (!string.Equals(sub[i], ruta[i], StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }

    // filtros: los de BacklogUtil.Filtros (C1, Grupos, Lideres); fechaCorte:
    // BacklogUtil.FechaCorte (null = el corte mas reciente).
    public static List<Dictionary<string, object>> Leer(Dictionary<string, object> filtros, object fechaCorte)
    {
        return Ejecutar(SQL, filtros, fechaCorte, null);
    }

    public class Nodo
    {
        public string Lider;      // null = filas sin lider
        public string C1;         // null o vacio = "(sin categoria)"
        public string Grupo;      // cross-filter por grupo; null = todos
        public List<string> Ruta = new List<string>();  // segmentos bajo C1
        public bool Exacto;       // solo los registrados en el nodo mismo
    }

    // Los tickets del nodo, del mas viejo al mas nuevo, y cuantos son.
    public static Dictionary<string, object> Tickets(Dictionary<string, object> filtros, object fechaCorte, Nodo nodo)
    {
        var r = Filtrar(Ejecutar(SQL_TICKETS, filtros, fechaCorte, nodo), nodo);
        BacklogTicketIds.Agregar((List<Dictionary<string, object>>)r["tickets"], "backlog_categorias");
        return r;
    }

    // De las filas de SQL_TICKETS (ya del lider, C1 y grupo del nodo), las
    // que caen bajo su ruta, en el orden que traen; tickets = las primeras
    // TOPE_TICKETS, total = todas.
    public static Dictionary<string, object> Filtrar(List<Dictionary<string, object>> filas, Nodo nodo)
    {
        var salida = new List<Dictionary<string, object>>();
        int total = 0;
        foreach (var t in filas)
        {
            bool coincide;
            var sub = Segmentos(Texto(t, "Categoria"), Texto(t, "C1"), out coincide);
            if (!BajoRuta(sub, nodo.Ruta, nodo.Exacto)) continue;
            total++;
            if (salida.Count < TOPE_TICKETS) salida.Add(t);
        }
        return new Dictionary<string, object>
        {
            { "tickets", salida },
            { "total", total },
            { "tope", TOPE_TICKETS },
        };
    }

    static string Texto(Dictionary<string, object> fila, string campo)
    {
        object v;
        return fila.TryGetValue(campo, out v) && v != null && !(v is DBNull) ? v.ToString() : null;
    }

    static List<Dictionary<string, object>> Ejecutar(string sql, Dictionary<string, object> filtros, object fechaCorte, Nodo nodo)
    {
        var filas = new List<Dictionary<string, object>>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand(sql, cn))
        {
            cmd.CommandType = CommandType.Text;
            Parametros(cmd, filtros, fechaCorte, nodo);
            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) filas.Add(SqlRowMapper.Fila(rd));
        }
        return filas;
    }

    public static void Parametros(SqlCommand cmd, Dictionary<string, object> filtros, object fechaCorte, Nodo nodo)
    {
        // Texto aaaa-mm-dd del <input type=date>, como lo recibe el
        // procedimiento: SQL lo convierte a DATE (formato ISO, sin
        // depender del idioma de la sesion).
        cmd.Parameters.Add("@FechaCorte", SqlDbType.NVarChar, 10).Value = fechaCorte ?? (object)DBNull.Value;
        cmd.Parameters.Add("@SortMas30", SqlDbType.Int).Value = SORT_MAS_30;
        foreach (var k in new[] { "C1", "Grupos", "Lideres" })
        {
            object v;
            filtros.TryGetValue(k, out v);
            cmd.Parameters.Add("@" + k, SqlDbType.NVarChar, -1).Value = v ?? DBNull.Value;
        }
        if (nodo == null) return;
        cmd.Parameters.Add("@SinLider", SqlDbType.Bit).Value = nodo.Lider == null;
        cmd.Parameters.Add("@NodoLider", SqlDbType.NVarChar, 255).Value = (object)nodo.Lider ?? DBNull.Value;
        bool sinC1 = string.IsNullOrWhiteSpace(nodo.C1);
        cmd.Parameters.Add("@SinC1", SqlDbType.Bit).Value = sinC1;
        cmd.Parameters.Add("@NodoC1", SqlDbType.NVarChar, 255).Value = sinC1 ? (object)DBNull.Value : nodo.C1;
        cmd.Parameters.Add("@NodoGrupo", SqlDbType.NVarChar, 255).Value = (object)nodo.Grupo ?? DBNull.Value;
    }
}
