// Filtros Servicio (C1) / Grupos / Lideres de la pestana QA: los mismos tres
// de QARE y del Backlog, con sus mismas listas (backlog_catalogos.ashx) y la
// MISMA regla para calcular C1 y Lider de un ticket.
//
// POR QUE AQUI Y NO EN LA BASE
//   QARE los aplica en SQL: sql/16_qare_filtros_org.sql agrego @C1 / @Grupos
//   / @Lideres a sus seis procedimientos sobre una fuente comun
//   (dbo.tvf_CorreoQARE_Base). QA no tiene nada parecido: dbo.usp_CorreoQA_*
//   solo reciben el rango, y aqui no se toca la base. Asi que la regla se
//   reproduce en los dos sitios donde QA ya lee:
//     - las filas de dbo.usp_CorreoQA_Detalle (resumen, distribucion por
//       estado, detalle y descarga) se filtran en C#, con C1De y LiderDe;
//     - los KPIs, que son una consulta de solo lectura sobre
//       dbo.vw_CorreoQA_Base (QaDb.KpisUnaPasada), llevan el mismo filtro en
//       su WHERE (FragmentoJoin / FragmentoWhere).
//
// LA REGLA (la de dbo.tvf_CorreoQARE_Base, que es la del Backlog)
//   C1    = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(Categoria), N'Sin categoria')
//   Lider = LEFT JOIN dbo.CatLiderGrupo ON Grupo = Grupo (igualdad exacta)
//           -> COALESCE(NULLIF(LTRIM(RTRIM(Lider)), N''), N'Sin Torre')
//   Filtro: lista vacia = sin filtro; si no, la columna IN la lista partida
//           por comas, con cada valor recortado y los vacios fuera
//           (dbo.fn_CorreoBacklog_SplitList).
//   El cuerpo de fn_CorreoBacklog_CategoriaC1 es el que leyo
//   sql/diag_qare_filtros_precheck.sql en la VM (copiado en
//   tools/tests/QareExportarSmoke.cs); C1De y C1Sql lo reproducen paso a
//   paso. tools/tests/QaFiltrosSqlLocalDbSmoke.cs compara los dos contra esa
//   funcion.
//
// COMPARACIONES
//   La colacion de la base (SQL_Latin1_General_CP1_CI_AS) no distingue
//   mayusculas y el '=' de SQL ignora los espacios al final. Aqui se compara
//   igual: OrdinalIgnoreCase y TrimEnd(' ').
//
// Solo lectura. Nada de lo que llega por el query string se concatena a una
// consulta: los valores viajan como SqlParameter.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Text;
using System.Web;
using System.Web.Caching;

public sealed class QaFiltroOrg
{
    public const string SinCategoria = "Sin categoria";
    public const string SinTorre = "Sin Torre";

    // Los nombres del query string, iguales a los de qare.ashx y backlog.
    public static readonly string[] Claves = { "c1", "grupos", "lideres" };

    private static readonly StringComparer Comparador = StringComparer.OrdinalIgnoreCase;

    private const int SegundosCacheLideres = 300;
    private const string ClaveCacheLideres = "qa:catLiderGrupo";

    public readonly List<string> C1;
    public readonly List<string> Grupos;
    public readonly List<string> Lideres;

    private readonly HashSet<string> _c1;
    private readonly HashSet<string> _grupos;
    private readonly HashSet<string> _lideres;
    private Dictionary<string, string> _mapaLideres;

    public static readonly QaFiltroOrg Ninguno = new QaFiltroOrg(null, null, null);

    public QaFiltroOrg(string c1, string grupos, string lideres)
    {
        C1 = Partir(c1);
        Grupos = Partir(grupos);
        Lideres = Partir(lideres);
        _c1 = new HashSet<string>(C1, Comparador);
        _grupos = new HashSet<string>(Grupos, Comparador);
        _lideres = new HashSet<string>(Lideres, Comparador);
    }

    public static QaFiltroOrg Leer(HttpRequest request)
    {
        var f = new QaFiltroOrg(request.QueryString["c1"], request.QueryString["grupos"],
                                request.QueryString["lideres"]);
        return f.Activo ? f : Ninguno;
    }

    public bool Activo { get { return C1.Count > 0 || Grupos.Count > 0 || Lideres.Count > 0; } }

    // Parte de la llave de cache. Vacia sin filtros: asi la llave de siempre
    // no cambia y la cache de la vista sin filtrar se sigue compartiendo.
    public string Clave
    {
        get
        {
            if (!Activo) return "";
            return ":c1=" + Unir(C1) + ":g=" + Unir(Grupos) + ":l=" + Unir(Lideres);
        }
    }

    // Eco para la respuesta (source.filtros): las listas tal como se aplicaron.
    public Dictionary<string, object> AJson()
    {
        var salida = new Dictionary<string, object>();
        salida["c1"] = C1.ToArray();
        salida["grupos"] = Grupos.ToArray();
        salida["lideres"] = Lideres.ToArray();
        return salida;
    }

    // dbo.fn_CorreoBacklog_SplitList: comas, cada valor recortado, sin vacios.
    // Un valor repetido se queda una vez (en un IN no cuenta dos veces).
    public static List<string> Partir(string lista)
    {
        var salida = new List<string>();
        if (string.IsNullOrEmpty(lista)) return salida;
        var vistos = new HashSet<string>(Comparador);
        foreach (var parte in lista.Split(','))
        {
            var v = parte.Trim(' ');
            if (v.Length == 0 || !vistos.Add(v)) continue;
            salida.Add(v);
        }
        return salida;
    }

    private static string Unir(List<string> valores)
    {
        var orden = new List<string>(valores);
        orden.Sort(StringComparer.OrdinalIgnoreCase);
        return string.Join("\u0001", orden).ToLowerInvariant();
    }

    // ------------------------------------------------------------ la regla
    // dbo.fn_CorreoBacklog_CategoriaC1, paso a paso (cuerpo de la VM):
    //   @s = LTRIM(RTRIM(REPLACE(ISNULL(@Categoria, N''), NCHAR(160), N' ')))
    //   '' -> NULL; se salta una '/' inicial; hasta la siguiente '/';
    //   recortado; '' -> NULL; el resultado es NVARCHAR(255).
    public static string C1De(string categoria)
    {
        var s = (categoria ?? "").Replace('\u00A0', ' ');
        if (s.Length > 1000) s = s.Substring(0, 1000);   // @Categoria NVARCHAR(1000)
        s = s.Trim(' ');
        if (s.Length == 0) return null;
        int inicio = s[0] == '/' ? 1 : 0;
        int siguiente = s.IndexOf('/', inicio);
        var c1 = (siguiente < 0 ? s.Substring(inicio) : s.Substring(inicio, siguiente - inicio)).Trim(' ');
        if (c1.Length == 0) return null;
        return c1.Length > 255 ? c1.Substring(0, 255) : c1;
    }

    // ISNULL(..., N'Sin categoria'), como la TVF.
    public static string C1Etiqueta(string categoria)
    {
        return C1De(categoria) ?? SinCategoria;
    }

    public static string LiderDe(string grupo, IDictionary<string, string> mapa)
    {
        string lider = null;
        if (grupo != null && mapa != null) mapa.TryGetValue(grupo.TrimEnd(' '), out lider);
        lider = lider == null ? null : lider.Trim(' ');
        return string.IsNullOrEmpty(lider) ? SinTorre : lider;
    }

    // El mapa Grupo -> Lider solo hace falta si se filtra por Lider. Se pide
    // antes de recorrer el detalle, en el hilo del request.
    public void Preparar()
    {
        if (Lideres.Count > 0 && _mapaLideres == null) _mapaLideres = MapaLideres();
    }

    public bool Coincide(string categoria, string grupo)
    {
        if (!Activo) return true;
        if (_c1.Count > 0 && !_c1.Contains(C1Etiqueta(categoria))) return false;
        if (_grupos.Count > 0 && (grupo == null || !_grupos.Contains(grupo.TrimEnd(' ')))) return false;
        if (_lideres.Count > 0)
        {
            if (_mapaLideres == null) Preparar();
            if (!_lideres.Contains(LiderDe(grupo, _mapaLideres))) return false;
        }
        return true;
    }

    /* dbo.CatLiderGrupo entera, sin filtrar por VigenteEnOrigen: la TVF de
       QARE hace el LEFT JOIN contra la tabla completa. Una fila por Grupo
       (usp_CargarCatLiderGrupo deduplica). La lectura es la misma clase de
       SELECT que ya hacen DashboardCatalogos y DirectorioPersonas. */
    public static Dictionary<string, string> MapaLideres()
    {
        var cache = HttpRuntime.Cache;
        var guardado = cache == null ? null : cache[ClaveCacheLideres] as Dictionary<string, string>;
        if (guardado != null) return guardado;

        if (QaDb.ModoSnapshot)
            throw new QaSolicitudInvalida(
                "Los filtros Servicio / Grupos / Lideres no estan disponibles en modo snapshot.");

        var mapa = new Dictionary<string, string>(Comparador);
        foreach (var fila in QaDb.Consulta("SELECT Grupo, Lider FROM dbo.CatLiderGrupo;", null))
        {
            var grupo = QaDb.Texto(fila, "Grupo");
            if (grupo == null) continue;
            var llave = grupo.TrimEnd(' ');
            if (!mapa.ContainsKey(llave)) mapa[llave] = QaDb.Texto(fila, "Lider");
        }

        if (cache != null)
        {
            cache.Insert(ClaveCacheLideres, mapa, null,
                         DateTime.UtcNow.AddSeconds(SegundosCacheLideres),
                         Cache.NoSlidingExpiration);
        }
        return mapa;
    }

    // ------------------------------------------------------ la regla en SQL
    // Para la consulta de KPIs, que lee la vista y no el detalle. Mismo corte
    // que C1De, expresion por expresion, sobre la fila `b` de la vista.
    public const string C1Sql = @"
CROSS APPLY (SELECT s = LTRIM(RTRIM(REPLACE(ISNULL(CONVERT(NVARCHAR(1000), b.Categoria), N''), NCHAR(160), N' ')))) AS fo_s
CROSS APPLY (SELECT i = CASE WHEN LEFT(fo_s.s, 1) = N'/' THEN 2 ELSE 1 END) AS fo_i
CROSS APPLY (SELECT n = CHARINDEX(N'/', fo_s.s, fo_i.i)) AS fo_n
CROSS APPLY (SELECT C1 = ISNULL(CONVERT(NVARCHAR(255), NULLIF(LTRIM(RTRIM(
                    CASE WHEN fo_s.s = N'' THEN N''
                         WHEN fo_n.n = 0 THEN SUBSTRING(fo_s.s, fo_i.i, 1000)
                         ELSE SUBSTRING(fo_s.s, fo_i.i, fo_n.n - fo_i.i) END)), N'')), N'Sin categoria'),
                    Lider = COALESCE(NULLIF(LTRIM(RTRIM(fo_lg.Lider)), N''), N'Sin Torre')) AS fo";

    // El JOIN y el CROSS APPLY que necesita el WHERE. Vacio sin filtros: la
    // consulta queda como siempre.
    public string FragmentoJoin()
    {
        if (!Activo) return "";
        return "\nLEFT JOIN dbo.CatLiderGrupo AS fo_lg ON fo_lg.Grupo = b.Grupo" + C1Sql;
    }

    // Los predicados, con un parametro por valor (como DashboardQueries
    // .EnLista): el texto solo lleva nombres de parametro, nunca un valor.
    public string FragmentoWhere(SqlCommand cmd)
    {
        if (!Activo) return "";
        var sql = new StringBuilder();
        En(sql, cmd, "fo.C1", "@fo_c1_", C1);
        En(sql, cmd, "b.Grupo", "@fo_g_", Grupos);
        En(sql, cmd, "fo.Lider", "@fo_l_", Lideres);
        return sql.ToString();
    }

    private static void En(StringBuilder sql, SqlCommand cmd, string columna, string prefijo,
                           List<string> valores)
    {
        if (valores.Count == 0) return;
        sql.Append("\n  AND ").Append(columna).Append(" IN (");
        for (int i = 0; i < valores.Count; i++)
        {
            var nombre = prefijo + i;
            if (i > 0) sql.Append(", ");
            sql.Append(nombre);
            cmd.Parameters.Add(nombre, SqlDbType.NVarChar, 4000).Value = valores[i];
        }
        sql.Append(")");
    }
}
