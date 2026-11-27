// Contrato de la pestaña Tecnicos: que procedimiento alimenta cada bloque,
// que columnas se esperan y en que orden viajan las filas.
//
// Parte PURA del modulo (sin SQL ni conexion), probada en
// tools/tests/TecnicosContratoSmoke.cs. La lectura vive en
// App_Code/TecnicosQueries.cs y el endpoint en handlers/tecnicos.ashx.
// Es independiente de QareContrato: otra pestaña, otros procedimientos.
//
// DE DONDE SALE EL CONTRATO
//   Los cuerpos reales de los cuatro SP del prototipo de Daniela, leidos en QA
//   el 2026-11-27, con sql/46 aplicado (sql/docs/PROPUESTA_qare_tecnicos.md,
//   seccion 14):
//     - parametros: @FechaInicio DATE, @FechaFin DATE (y los filtros de 14.3);
//     - fecha: FechaFirmaSolucion, @FechaFin INCLUSIVO (< @FechaFin + 1);
//     - inicio > fin: THROW 50001 en los cuatro;
//     - NULL/NULL = TODO el historial (no 15 dias como los SP QARE), por eso
//       el handler manda SIEMPRE las dos fechas;
//     - porcentajes ya calculados, escala 0-100, NULL si el denominador es 0;
//     - usp_QARE_PatronesSolucion devuelve TRES result sets: distribucion,
//       Pareto y resumen del texto evaluable, en ese orden.
//   Las filas viajan con TODAS sus columnas y su valor intacto: aqui no se
//   recalcula ni se reclasifica nada.
//
// FILTROS (lo que acepta cada SP, 14.3)
//   KPIs: solo fechas. Tecnicos: fechas, @Grupo. Patrones: fechas, @Grupo,
//   @FirmaSolucion, @Top. Detalle: fechas, @Grupo, @FirmaSolucion,
//   @Categoria, @EstadoDescripcion, @ClasificacionRespuesta.
//   Como KPIs no acepta grupo ni tecnico, esta primera version filtra SOLO
//   por fechas: un filtro que moviera unos bloques y otros no daria cifras
//   que no cuadran entre si (X4). Tampoco se simulan multiselecciones
//   sumando llamadas: los SP cuentan COUNT(DISTINCT) (X5).

using System;
using System.Collections.Generic;
using System.Globalization;

public sealed class TecnicosBloque
{
    public readonly string Clave;          // llave del JSON
    public readonly string Procedimiento;
    public readonly int ResultSet;         // 0, 1, 2 dentro de su procedimiento
    public readonly bool UnaFila;          // un objeto, no una lista
    public readonly string[] Columnas;     // las que el tablero lee

    public TecnicosBloque(string clave, string procedimiento, int resultSet, bool unaFila,
                          params string[] columnas)
    {
        Clave = clave;
        Procedimiento = procedimiento;
        ResultSet = resultSet;
        UnaFila = unaFila;
        Columnas = columnas;
    }
}

public sealed class TecnicosSolicitudInvalida : Exception
{
    public TecnicosSolicitudInvalida(string mensaje) : base(mensaje) { }
}

public static class TecnicosContrato
{
    public const string SpKpis = "dbo.usp_QARE_CalidadCaptura_KPIs";
    public const string SpPatrones = "dbo.usp_QARE_PatronesSolucion";
    public const string SpTecnicos = "dbo.usp_QARE_CalidadCaptura_Tecnicos";
    public const string SpDetalle = "dbo.usp_QARE_DetalleEvidencia";

    // Columna que sql/47 agrega al Detalle. Puede no existir todavia en la base.
    public const string ColumnaTipo = "TipoClasificacionRespuesta";

    public static readonly TecnicosBloque Kpis = new TecnicosBloque(
        "kpis", SpKpis, 0, true,
        "TicketsTotales", "TicketsSinInformacionQARE", "TicketsEvaluados",
        "TicketsNoEvaluables", "PctNoEvaluable", "TicketsTextoEvaluable", "PctTextoEvaluable");

    public static readonly TecnicosBloque Distribucion = new TecnicosBloque(
        "distribucion", SpPatrones, 0, false,
        "ClasificacionRespuesta", "TipoClasificacionRespuesta", "Tickets", "Porcentaje");

    public static readonly TecnicosBloque Pareto = new TecnicosBloque(
        "pareto", SpPatrones, 1, false,
        "Posicion", "PatronSolucion", "Tickets", "Porcentaje", "TicketsAcumulados", "PctAcumulado");

    public static readonly TecnicosBloque Resumen = new TecnicosBloque(
        "resumen", SpPatrones, 2, true,
        "TotalTextoEvaluable", "TicketsConPatron", "PctConPatron", "TicketsCalidad", "PctCalidad",
        "TicketsSinPatron", "PctSinPatron");

    public static readonly TecnicosBloque Tecnicos = new TecnicosBloque(
        "tecnicos", SpTecnicos, 0, false,
        "FirmaSolucion", "TicketsTotales", "TicketsSinInformacionQARE", "TicketsEvaluados",
        "TicketsNoEvaluables", "PctNoEvaluable", "TicketsTextoEvaluable", "PctTextoEvaluable",
        "TicketsConPatron", "PctConPatron", "TicketsCalidad", "PctCalidad",
        "TicketsSinPatron", "PctSinPatron");

    public static readonly TecnicosBloque Detalle = new TecnicosBloque(
        "detalle", SpDetalle, 0, false,
        "CodigoTicket", "FechaFirmaSolucion", "FirmaSolucion", "Grupo", "Categoria", "Validacion",
        "QARe_Causa", "QARe_AplicaOtrosCasos", "QARe_GenerarArticulo", "QARe_VerificoClasificacion",
        "QARe_TipoSolucion", "QARe_DescripcionSolucion", "EstadoDescripcionVisual", "ClasificacionRespuesta");

    public static readonly TecnicosBloque[] Bloques = new TecnicosBloque[]
    {
        Kpis, Distribucion, Pareto, Resumen, Tecnicos, Detalle,
    };

    // Los cuatro procedimientos, cada uno con sus bloques en orden de result set.
    public static readonly string[] Procedimientos = new string[] { SpKpis, SpPatrones, SpTecnicos, SpDetalle };

    public static List<TecnicosBloque> BloquesDe(string procedimiento)
    {
        var salida = new List<TecnicosBloque>();
        foreach (var b in Bloques) if (b.Procedimiento == procedimiento) salida.Add(b);
        salida.Sort((a, b) => a.ResultSet.CompareTo(b.ResultSet));
        return salida;
    }

    // Ventana por omision: 15 dias naturales incluyendo hoy (la de QARE).
    public const int DiasVentana = 15;

    // Tope del rango. El Detalle devuelve UNA fila por ticket con sus textos y
    // no tiene paginacion en SQL: ~9 500 tickets por mes. Tres meses mantienen
    // la respuesta manejable; un rango mayor se rechaza en vez de colgar la
    // pestaña.
    public const int DiasMaximos = 93;

    // ------------------------------------------------------------ fechas

    /* fecha_inicio / fecha_fin (aaaa-mm-dd) tal como las eligio el usuario: no
       se corre ningun dia, los SP ya tratan @FechaFin como inclusivo. Sin
       fechas, los 15 dias que terminan 'hoy' (el dia de Mexico que pasa el
       handler). Nunca devuelve una fecha nula: con NULL los SP leerian todo
       el historial. */
    public static void Rango(string textoInicio, string textoFin, DateTime hoy,
                             out DateTime inicio, out DateTime fin)
    {
        DateTime? fi = Fecha(textoInicio, "fecha_inicio");
        DateTime? ff = Fecha(textoFin, "fecha_fin");

        fin = ff ?? hoy.Date;
        inicio = fi ?? fin.AddDays(-(DiasVentana - 1));

        if (inicio > fin)
            throw new TecnicosSolicitudInvalida(
                "El rango de fechas es invalido: 'fecha_inicio' es posterior a 'fecha_fin'.");
        if ((fin - inicio).TotalDays + 1 > DiasMaximos)
            throw new TecnicosSolicitudInvalida(
                "El rango de fechas es demasiado largo: el maximo es de " +
                DiasMaximos.ToString(CultureInfo.InvariantCulture) + " dias.");
    }

    private static DateTime? Fecha(string valor, string nombre)
    {
        if (string.IsNullOrWhiteSpace(valor)) return null;
        DateTime fecha;
        if (!DateTime.TryParseExact(valor.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                                    DateTimeStyles.None, out fecha))
        {
            throw new TecnicosSolicitudInvalida(
                "Parametro '" + nombre + "' invalido: se espera una fecha con el formato aaaa-mm-dd.");
        }
        return fecha.Date;
    }

    // ------------------------------------------------------------ filas

    /* Deja las filas en el orden del contrato y anota lo que no cuadra. No
       quita, no renombra y no calcula columnas. Solo el Pareto se ordena (por
       Posicion, estable): el SP ya lo entrega asi y es lo que mide su
       acumulado. Tecnicos y Detalle conservan el orden del procedimiento. */
    public static List<Dictionary<string, object>> Preparar(
        TecnicosBloque bloque, List<Dictionary<string, object>> filas, List<string> avisos)
    {
        filas = filas ?? new List<Dictionary<string, object>>();

        foreach (var falta in ColumnasFaltantes(filas, bloque.Columnas))
            avisos.Add(bloque.Procedimiento + " (result set " + (bloque.ResultSet + 1).ToString(CultureInfo.InvariantCulture) +
                       ") no devolvio la columna '" + falta + "'.");

        if (bloque == Pareto)
        {
            var ordenadas = OrdenarPorPosicion(filas);
            RevisarAcumulado(ordenadas, avisos);
            return ordenadas;
        }
        return filas;
    }

    // Un rango sin filas no es un contrato roto: no se puede decir que falte nada.
    public static List<string> ColumnasFaltantes(List<Dictionary<string, object>> filas, string[] esperadas)
    {
        var faltan = new List<string>();
        if (filas == null || filas.Count == 0) return faltan;
        foreach (var col in esperadas)
            if (!filas[0].ContainsKey(col)) faltan.Add(col);
        return faltan;
    }

    // sql/47 aplicado o no: el tablero muestra la columna solo si llego.
    public static bool DetalleTraeTipo(List<Dictionary<string, object>> filas)
    {
        return filas != null && filas.Count > 0 && filas[0].ContainsKey(ColumnaTipo);
    }

    public static List<Dictionary<string, object>> OrdenarPorPosicion(List<Dictionary<string, object>> filas)
    {
        // List.Sort no es estable: el indice original desempata.
        var indexadas = new List<KeyValuePair<int, Dictionary<string, object>>>();
        for (int i = 0; i < filas.Count; i++)
            indexadas.Add(new KeyValuePair<int, Dictionary<string, object>>(i, filas[i]));

        indexadas.Sort((a, b) =>
        {
            decimal? pa = Numero(a.Value, "Posicion");
            decimal? pb = Numero(b.Value, "Posicion");
            if (pa.HasValue && pb.HasValue && pa.Value != pb.Value) return pa.Value.CompareTo(pb.Value);
            if (pa.HasValue != pb.HasValue) return pa.HasValue ? -1 : 1;
            return a.Key.CompareTo(b.Key);
        });

        var salida = new List<Dictionary<string, object>>(filas.Count);
        foreach (var kv in indexadas) salida.Add(kv.Value);
        return salida;
    }

    /* El acumulado lo calcula el SP sobre TODOS los tickets con patron. Aqui
       solo se avisa si baja o pasa de 100: no se corrige. */
    private static void RevisarAcumulado(List<Dictionary<string, object>> filas, List<string> avisos)
    {
        decimal? previo = null;
        foreach (var fila in filas)
        {
            var v = Numero(fila, "PctAcumulado");
            if (!v.HasValue) continue;
            if (previo.HasValue && v.Value < previo.Value)
            {
                avisos.Add(SpPatrones + ": PctAcumulado baja al ordenar por Posicion.");
                return;
            }
            previo = v;
        }
        if (previo.HasValue && previo.Value > 100.5m)
            avisos.Add(SpPatrones + ": PctAcumulado pasa de 100.");
    }

    public static decimal? Numero(Dictionary<string, object> fila, string columna)
    {
        object v;
        if (fila == null || !fila.TryGetValue(columna, out v) || v == null) return null;
        try { return Convert.ToDecimal(v, CultureInfo.InvariantCulture); }
        catch (FormatException) { return null; }
        catch (InvalidCastException) { return null; }
        catch (OverflowException) { return null; }
    }
}
