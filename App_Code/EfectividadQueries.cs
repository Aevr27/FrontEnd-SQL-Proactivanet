// Capa de datos de la pestaña "Efectividad de iniciativas" (efectividad/).
//
// EL CALCULO NO SE HACE AQUI. Lo deja hecho la base, una vez al dia, el
// procedimiento del 60 (60_efectividad_iniciativas.sql): una fila por
// iniciativa y categoria en dbo.ExpEfectividad y el resumen de la corrida en
// dbo.ExpEfectividadCorrida. Aqui solo se leen.
//
// QUE DEVUELVE
// ------------
//   hay_calculo   false si el 60 no esta instalado, la cuenta no puede leer
//                 sus tablas (para OBJECT_ID es lo mismo) o no hay corrida.
//   corrida       la ultima fila de dbo.ExpEfectividadCorrida.
//   filas         TODAS las filas de dbo.ExpEfectividad, tambien las que no
//                 se pueden calificar (Orden distinto de 14 y 15), con su
//                 Motivo: la lista "No se puede calificar" sale de ahi. Cada
//                 una con el titulo y el agrupador de su iniciativa, y con el
//                 C1 y el C1&C2 con los que se filtra.
//   categorias    las categorias del tablero de Experiencia (C1 y C2) con sus
//                 cuatro dueños, y los catalogos de los selects (directores,
//                 managers, jerarquia, jerarquia_mgr).
//
// POR QUE SE REUSA ExperienciaQueries.Construir
// ---------------------------------------------
// La pestaña tiene que dar, con los mismos filtros, la misma cifra que la
// tarjeta "% Efectividad Reducción" de Experiencia. Esa tarjeta deja pasar
// una fila si su C1&C2, o su C1, es una de las categorias que pasan el filtro
// de dueños (efectividadDe en experiencia.js), y el universo de categorias y
// sus dueños los arma Construir (volumen + iniciativas + DirectorioOrganiza-
// cional). Armar aqui otro universo "casi igual" daria cifras distintas en
// los casos raros. Se paga una lectura de las vistas de volumen, la misma que
// hace la pestaña de Experiencia al abrir, y ExperienciaQueries no cambia.
//
// El C1 y el C1&C2 de cada fila tambien son los de la tarjeta: para las
// medidas y las en medicion se toman de efectividad.filas de Construir (por
// folio y ruta que se cuenta); para las demas, que la tarjeta no publica, se
// cortan de la ruta del Excel, que es lo mismo que hace la tarjeta cuando la
// iniciativa no esta en el detalle.
//
// Solo lectura. Lo que lee la cuenta del tablero: lo de Experiencia, mas
// dbo.ExpEfectividad, dbo.ExpEfectividadCorrida, dbo.Problem y
// dbo.ProblemCategoria (las cuatro ya las lee Experiencia).

using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public static class EfectividadQueries
{
    // Separador de llaves compuestas: un espacio duro no puede venir dentro
    // de una ruta ya normalizada (fn_NormalizaCategoria lo cambia por espacio).
    // Escrito como  : App_Code va sin BOM y IIS lo compila en ANSI.
    private const string SEP = " ";

    // Las llaves de Construir que la pestaña usa tal cual.
    private static readonly string[] CATALOGOS = { "directores", "managers", "jerarquia", "jerarquia_mgr" };

    public static Dictionary<string, object> Construir()
    {
        var hoy = DashboardDataInfo.HoyEnPresentacion();
        var exp = ExperienciaQueries.Construir(hoy.Year);

        var salida = new Dictionary<string, object>();
        salida["categorias"] = Categorias(exp.ContainsKey("categorias") ? exp["categorias"] as IList : null);
        foreach (var k in CATALOGOS)
            salida[k] = exp.ContainsKey(k) ? exp[k] : null;

        var cortes = CortesDeLaTarjeta(exp.ContainsKey("efectividad") ? exp["efectividad"] as IDictionary : null);

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();

            var corrida = LeerCorrida(cn);
            salida["hay_calculo"] = corrida != null;
            salida["corrida"] = corrida;
            salida["filas"] = corrida == null ? new List<object>() : LeerFilas(cn, cortes);

            object fecha = corrida == null ? null : corrida["fecha_calculo_dt"];
            if (corrida != null) corrida.Remove("fecha_calculo_dt");
            var info = DashboardDataInfo.Corte(
                "Efectividad de iniciativas", fecha, ZonaSello.YaLocal,
                "dbo.ExpEfectividadCorrida (60_efectividad_iniciativas.sql)");
            salida["meta"] = info.AJson();
        }

        salida["hoy"] = Fecha(hoy);
        return salida;
    }

    // ------------------------------------------------------------------
    // Categorias del tablero, solo lo que hace falta para filtrar
    // ------------------------------------------------------------------

    private static List<object> Categorias(IList origen)
    {
        var salida = new List<object>();
        if (origen == null) return salida;
        foreach (var o in origen)
        {
            var c = o as IDictionary;
            if (c == null) continue;
            var f = new Dictionary<string, object>();
            foreach (var k in new[] { "categoria", "nivel", "c1", "director", "po", "so", "manager" })
                f[k] = c.Contains(k) ? c[k] : null;
            salida.Add(f);
        }
        return salida;
    }

    // (folio, ruta que se cuenta) -> (c1, c1c2) de la tarjeta.
    private static Dictionary<string, string[]> CortesDeLaTarjeta(IDictionary efectividad)
    {
        var cortes = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        if (efectividad == null || !efectividad.Contains("filas")) return cortes;
        var filas = efectividad["filas"] as IList;
        if (filas == null) return cortes;
        foreach (var o in filas)
        {
            var f = o as IDictionary;
            if (f == null) continue;
            var k = Convert.ToString(f["folio"]) + SEP + Convert.ToString(f["categoria"]);
            if (!cortes.ContainsKey(k))
                cortes[k] = new[] { f["c1"] as string, f["c1c2"] as string };
        }
        return cortes;
    }

    // ------------------------------------------------------------------
    // La corrida
    // ------------------------------------------------------------------

    private static Dictionary<string, object> LeerCorrida(SqlConnection cn)
    {
        using (var cmd = new SqlCommand(
            "SELECT CASE WHEN OBJECT_ID(N'dbo.ExpEfectividad', N'U') IS NOT NULL " +
            "             AND OBJECT_ID(N'dbo.ExpEfectividadCorrida', N'U') IS NOT NULL THEN 1 ELSE 0 END", cn))
        {
            if (Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 0) return null;
        }

        const string SQL =
            "SELECT TOP (1) FechaCalculo, Hoy, InicioHistorial, Equivalencias, Filas, " +
            "       IniciativasMedidas, CategoriasMedidas, Compromiso, Logro, Efectividad, " +
            "       IniciativasEnMedicion, PrimeraEnMedirse, IniciativasEfectivas, " +
            "       EvaluablesRebote, ConRebote, TicketsEvitados, SinBaseIniciativas " +
            "FROM dbo.ExpEfectividadCorrida ORDER BY Id DESC";

        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            if (!rd.Read()) return null;
            var c = new Dictionary<string, object>();
            c["fecha_calculo_dt"] = rd.IsDBNull(0) ? null : (object)rd.GetDateTime(0);
            c["fecha_calculo"] = FechaHora(rd.GetValue(0));
            c["hoy"] = Fecha(rd.GetValue(1));
            c["inicio_historial"] = Fecha(rd.GetValue(2));
            c["equivalencias"] = EnteroONulo(rd.GetValue(3));
            c["filas"] = EnteroONulo(rd.GetValue(4));
            c["iniciativas_medidas"] = EnteroONulo(rd.GetValue(5));
            c["categorias_medidas"] = EnteroONulo(rd.GetValue(6));
            c["compromiso"] = Numero(rd.GetValue(7));
            c["logro"] = Numero(rd.GetValue(8));
            c["efectividad"] = Numero(rd.GetValue(9));
            c["iniciativas_en_medicion"] = EnteroONulo(rd.GetValue(10));
            c["primera_en_medirse"] = Fecha(rd.GetValue(11));
            c["iniciativas_efectivas"] = EnteroONulo(rd.GetValue(12));
            c["evaluables_rebote"] = EnteroONulo(rd.GetValue(13));
            c["con_rebote"] = EnteroONulo(rd.GetValue(14));
            c["tickets_evitados"] = Numero(rd.GetValue(15));
            c["sin_base_iniciativas"] = EnteroONulo(rd.GetValue(16));
            return c;
        }
    }

    // ------------------------------------------------------------------
    // Las filas del calculo
    // ------------------------------------------------------------------

    private sealed class Titulo
    {
        public string Texto;
        public string Agrup;
    }

    private static List<object> LeerFilas(SqlConnection cn, Dictionary<string, string[]> cortes)
    {
        var titulos = LeerTitulos(cn);

        const string SQL =
            "SELECT Codigo, Prefijo, Estado, CategoriaExcel, Categoria, EsRama, Traducida, " +
            "       Orden, Motivo, Pct, Creacion, Cierre, SeMideDesde, DiasBase, TicketsTablero, " +
            "       BaseMes, Compromiso, DespuesMes, Factor, EsperadoMes, ReduccionMes, " +
            "       Parte, Asignada, Logro, HoyMes, ReduccionHoy, EvaluaRebote, Evitados " +
            "FROM dbo.ExpEfectividad " +
            "ORDER BY Codigo, Categoria";

        var filas = new List<object>();
        using (var cmd = new SqlCommand(SQL, cn))
        {
            cmd.CommandType = CommandType.Text;
            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    var f = new Dictionary<string, object>();
                    var folio = Texto(rd.GetValue(0));
                    var excel = DirectorioOrganizacional.Normaliza(Texto(rd.GetValue(3)));
                    var categoria = Texto(rd.GetValue(4));

                    f["folio"] = folio;
                    f["prefijo"] = Texto(rd.GetValue(1)) ?? Prefijo(folio);
                    f["estado"] = Texto(rd.GetValue(2));
                    f["categoria_excel"] = excel;
                    f["categoria"] = categoria;
                    f["es_rama"] = Bool(rd.GetValue(5));
                    f["traducida"] = Bool(rd.GetValue(6));
                    f["orden"] = EnteroONulo(rd.GetValue(7));
                    f["motivo"] = Texto(rd.GetValue(8));
                    f["pct"] = Numero(rd.GetValue(9));
                    f["creacion"] = Fecha(rd.GetValue(10));
                    f["cierre"] = Fecha(rd.GetValue(11));
                    f["se_mide_desde"] = Fecha(rd.GetValue(12));
                    f["dias_base"] = EnteroONulo(rd.GetValue(13));
                    f["tickets_tablero"] = EnteroONulo(rd.GetValue(14));
                    f["base_mes"] = Numero(rd.GetValue(15));
                    f["comp"] = Numero(rd.GetValue(16));
                    f["despues_mes"] = Numero(rd.GetValue(17));
                    f["factor"] = Numero(rd.GetValue(18));
                    f["esperado_mes"] = Numero(rd.GetValue(19));
                    f["reduccion_mes"] = Numero(rd.GetValue(20));
                    f["parte"] = Numero(rd.GetValue(21));
                    f["asignada"] = Numero(rd.GetValue(22));
                    f["logro"] = Numero(rd.GetValue(23));
                    f["hoy_mes"] = Numero(rd.GetValue(24));
                    f["reduccion_hoy"] = Numero(rd.GetValue(25));
                    f["evalua_rebote"] = rd.IsDBNull(26) ? null : (object)Bool(rd.GetValue(26));
                    f["evitados"] = Numero(rd.GetValue(27));

                    // Los cortes con los que se filtra: los de la tarjeta si
                    // los publica (medidas y en medicion), si no los de la
                    // ruta del Excel.
                    string[] corte;
                    if (cortes.TryGetValue((folio ?? "") + SEP + (categoria ?? ""), out corte))
                    {
                        f["c1"] = corte[0];
                        f["c1c2"] = corte[1];
                    }
                    else
                    {
                        f["c1"] = C1De(excel);
                        f["c1c2"] = C1C2De(excel);
                    }

                    // El titulo: el de la iniciativa en esa categoria del Excel,
                    // si no el de cualquiera de sus categorias, si no el del Problem.
                    Titulo t;
                    if (!titulos.TryGetValue((folio ?? "") + SEP + (excel ?? ""), out t))
                        titulos.TryGetValue((folio ?? "") + SEP, out t);
                    f["titulo"] = t == null ? null : t.Texto;
                    f["agrup"] = t == null ? null : t.Agrup;

                    filas.Add(f);
                }
            }
        }
        return filas;
    }

    // (folio, ruta del Excel normalizada) y (folio, "") -> titulo y agrupador.
    //   por ruta   el titulo de la iniciativa en esa categoria
    //              (ProblemCategoria.TituloIniciativa) o, si no lo capturaron,
    //              el del Problem: lo mismo que pinta Experiencia.
    //   por folio  para las filas cuya ruta no esta en ProblemCategoria (N/A,
    //              vacia): el primer titulo de iniciativa del folio o, si no
    //              hay, el del Problem.
    // Se cruza en memoria y no con dbo.fn_NormalizaCategoria en el SELECT: la
    // cuenta del tablero lee tablas y vistas, y no hace falta pedirle EXECUTE
    // sobre una funcion. Son unos pocos miles de filas.
    private static Dictionary<string, Titulo> LeerTitulos(SqlConnection cn)
    {
        const string SQL =
            "SELECT p.Codigo, pc.Categoria, pc.TituloIniciativa, pc.TipoAgrupado, p.Titulo " +
            "FROM dbo.Problem AS p " +
            "LEFT JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = p.Codigo " +
            "WHERE p.Codigo IN (SELECT Codigo FROM dbo.ExpEfectividad) " +
            "ORDER BY p.Codigo, pc.Categoria";

        var salida = new Dictionary<string, Titulo>(StringComparer.OrdinalIgnoreCase);
        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                var folio = Texto(rd.GetValue(0)) ?? "";
                var ruta = DirectorioOrganizacional.Normaliza(Texto(rd.GetValue(1)));
                var deIniciativa = Texto(rd.GetValue(2));
                var agrup = Texto(rd.GetValue(3));
                var delProblem = Texto(rd.GetValue(4));

                if (ruta != null && !salida.ContainsKey(folio + SEP + ruta))
                    salida[folio + SEP + ruta] = new Titulo { Texto = deIniciativa ?? delProblem, Agrup = agrup };

                Titulo f;
                if (!salida.TryGetValue(folio + SEP, out f))
                {
                    salida[folio + SEP] = new Titulo { Texto = deIniciativa ?? delProblem, Agrup = agrup };
                }
                else
                {
                    if (deIniciativa != null && f.Texto == delProblem) f.Texto = deIniciativa;
                    if (f.Agrup == null) f.Agrup = agrup;
                }
            }
        }
        return salida;
    }

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    // "/A/B/C" -> "A". Mismo corte que dbo.fn_CategoriaC1 (y que
    // ExperienciaQueries.C1De).
    public static string C1De(string ruta)
    {
        if (string.IsNullOrEmpty(ruta)) return ruta;
        var partes = ruta.Split('/');
        for (int i = 0; i < partes.Length; i++)
            if (partes[i].Length > 0)
                return partes[i];
        return ruta;
    }

    // "/A/B/C" -> "/A/B". Mismo corte que dbo.fn_CategoriaC1C2 (y que
    // ExperienciaQueries.C1C2De).
    public static string C1C2De(string ruta)
    {
        if (string.IsNullOrEmpty(ruta)) return ruta;
        var s = ruta[0] == '/' ? ruta : "/" + ruta;
        var p2 = s.IndexOf('/', 1);
        if (p2 < 0) return s;
        var p3 = s.IndexOf('/', p2 + 1);
        if (p3 < 0) return s;
        return s.Substring(0, p3);
    }

    private static string Prefijo(string folio)
    {
        if (string.IsNullOrEmpty(folio)) return null;
        return folio.Length <= 3 ? folio.ToUpperInvariant() : folio.Substring(0, 3).ToUpperInvariant();
    }

    private static string Texto(object v)
    {
        if (v == null || v is DBNull) return null;
        var s = Convert.ToString(v, CultureInfo.InvariantCulture);
        return string.IsNullOrEmpty(s) ? null : s;
    }

    private static object EnteroONulo(object v)
    {
        if (v == null || v is DBNull) return null;
        return Convert.ToInt64(v, CultureInfo.InvariantCulture);
    }

    // Los DECIMAL(19,6) van como double redondeado: el navegador solo
    // necesita cuatro decimales y asi el JSON no lleva colas de ceros.
    private static object Numero(object v)
    {
        if (v == null || v is DBNull) return null;
        return Math.Round(Convert.ToDouble(v, CultureInfo.InvariantCulture), 4);
    }

    private static bool Bool(object v)
    {
        if (v == null || v is DBNull) return false;
        return Convert.ToBoolean(v, CultureInfo.InvariantCulture);
    }

    // Como en Experiencia: yyyy-MM-dd, que el navegador parte con split('-').
    private static string Fecha(object v)
    {
        if (v == null || v is DBNull) return null;
        return Convert.ToDateTime(v, CultureInfo.InvariantCulture)
                      .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private static string FechaHora(object v)
    {
        if (v == null || v is DBNull) return null;
        return Convert.ToDateTime(v, CultureInfo.InvariantCulture)
                      .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
    }
}
