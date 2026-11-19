// Asociaciones HISTORICAS de una iniciativa: filas de dbo.ProblemCategoria
// con VigenteEnOrigen = 0 (se dieron de baja: Quitar de sql/24 o el
// cargador). Con sql/83 (PersistenciaSolicitudesCambio.ReactivacionActiva)
// volver a agregar una de ellas la REACTIVA: la base actualiza la MISMA fila
// (sus fechas no cambian) y conserva su clasificacion historica no vacia;
// solo se llena la que falta.
//
// Aqui: la lectura (SOLO LECTURA) y la regla de la clasificacion EFECTIVA,
// para que el sitio diga lo mismo que la base:
//   vacia     NULL, '' o solo espacios (NULLIF(LTRIM(RTRIM(x)), '') de T-SQL:
//             LTRIM / RTRIM recortan espacios, no otros blancos)
//   efectiva  la historica no vacia; si falta, la que llega
//   conflicto historica no vacia y una que llega no vacia y distinta, sin
//             distinguir mayusculas (CI_AS de la base). La base decide al
//             final (51034); esto es para responder 422 antes.
// Nunca da permisos: quien puede pedir o reactivar sigue igual.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public sealed class CategoriaHistorica
{
    public string Ruta;            // normalizada (DirectorioOrganizacional.Normaliza)
    public string TipoIniciativa;  // null = vacia
    public string TipoAgrupado;    // null = vacia
    public decimal? Pct;           // fraccion, como PctDisminucion
    public string FCreacion;       // yyyy-MM-dd o null
    public string FAnalisis;       // yyyy-MM-dd o null
}

public static class CategoriasHistoricas
{
    public const string Consulta =
        "SELECT Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, FechaCreacionCategoria, FechaAnalisisCategoria " +
        "FROM dbo.ProblemCategoria WHERE Codigo = @f AND VigenteEnOrigen = 0 ORDER BY Categoria;";

    // Para las pruebas sin SQL: null = la lectura real.
    public static Func<string, List<CategoriaHistorica>> LeerParaPruebas;

    // Con una conexion abierta del que llama.
    public static List<CategoriaHistorica> Leer(SqlConnection cn, string folio)
    {
        if (LeerParaPruebas != null) return LeerParaPruebas(folio);
        if (cn == null) throw new ArgumentNullException("cn");
        var salida = new List<CategoriaHistorica>();
        using (var cmd = new SqlCommand(Consulta, cn) { CommandTimeout = 30 })
        {
            cmd.Parameters.Add("@f", SqlDbType.NVarChar, 100).Value = (folio ?? "").Trim();
            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    var ruta = DirectorioOrganizacional.Normaliza(rd.IsDBNull(0) ? null : Convert.ToString(rd.GetValue(0), CultureInfo.InvariantCulture));
                    if (ruta == null) continue;
                    salida.Add(new CategoriaHistorica
                    {
                        Ruta = ruta,
                        TipoIniciativa = Vacio(rd.IsDBNull(1) ? null : Convert.ToString(rd.GetValue(1), CultureInfo.InvariantCulture)),
                        TipoAgrupado = Vacio(rd.IsDBNull(2) ? null : Convert.ToString(rd.GetValue(2), CultureInfo.InvariantCulture)),
                        Pct = rd.IsDBNull(3) ? (decimal?)null : decimal.Round(Convert.ToDecimal(rd.GetValue(3), CultureInfo.InvariantCulture), 4),
                        FCreacion = rd.IsDBNull(4) ? null : Convert.ToDateTime(rd.GetValue(4)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        FAnalisis = rd.IsDBNull(5) ? null : Convert.ToDateTime(rd.GetValue(5)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    });
                }
            }
        }
        return salida;
    }

    // Abre su propia conexion.
    public static List<CategoriaHistorica> Leer(string folio)
    {
        if (LeerParaPruebas != null) return LeerParaPruebas(folio);
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            return Leer(cn, folio);
        }
    }

    // NULLIF(LTRIM(RTRIM(x)), N''): solo espacios a los lados.
    public static string Vacio(string s)
    {
        if (s == null) return null;
        var t = s.Trim(' ');
        return t.Length == 0 ? null : t;
    }

    public static string Efectiva(string historica, string entrada)
    {
        return Vacio(historica) ?? Vacio(entrada);
    }

    public static bool Conflicto(string historica, string entrada)
    {
        var h = Vacio(historica);
        var e = Vacio(entrada);
        return h != null && e != null && !string.Equals(h, e, StringComparison.OrdinalIgnoreCase);
    }

    // La historica de esa ruta (normalizada, sin distinguir mayusculas), o null.
    public static CategoriaHistorica Buscar(IEnumerable<CategoriaHistorica> lista, string ruta)
    {
        var k = DirectorioOrganizacional.Normaliza(ruta);
        if (lista == null || k == null) return null;
        foreach (var h in lista)
            if (string.Equals(h.Ruta, k, StringComparison.OrdinalIgnoreCase)) return h;
        return null;
    }

    // La forma JSON que ven el formulario de cambios y el editor de ADM.
    public static List<object> ComoJson(IEnumerable<CategoriaHistorica> lista)
    {
        var salida = new List<object>();
        if (lista == null) return salida;
        foreach (var h in lista)
        {
            salida.Add(new Dictionary<string, object>
            {
                { "categoria", h.Ruta },
                { "tipo_iniciativa", h.TipoIniciativa }, { "tipo_agrupado", h.TipoAgrupado },
                { "pct_dism", h.Pct.HasValue ? (object)(double)h.Pct.Value : null },
                { "f_creacion", h.FCreacion }, { "f_analisis", h.FAnalisis },
            });
        }
        return salida;
    }
}
