// Contrato de la pestaña QARE: que procedimiento alimenta cada bloque, que
// columnas se esperan de el y en que orden viajan sus filas.
//
// Aqui no hay SQL ni conexion: es la parte PURA del modulo, la que se puede
// probar sin base (tools/tests/QareContratoSmoke.cs). La lectura vive en
// App_Code/QareQueries.cs y el endpoint en handlers/qare.ashx.
//
// DE DONDE SALE EL CONTRATO
//   Columnas: "Documentacion_Dashboard_QARE" (guia visual). Todo lo demas
//   se verifico en la VM con sql/diag_qare_contrato.sql (v2, 2026-09-25),
//   leyendo los cuerpos reales de los seis SP:
//     - parametros: @FechaInicio DATE = NULL, @FechaFin DATE = NULL;
//     - fecha oficial: FechaFirmaSolucion de dbo.vw_CorreoQARECierre_Base
//       (envoltorio de dbo.vw_CorreoQA_Base, la misma base que QA);
//     - @FechaFin INCLUSIVO: FechaFirmaSolucion >= @Fi
//       AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff). Probado: la suma de 7
//       dias sueltos = el rango de esos 7 dias;
//     - NULL/NULL: @Ff = hoy en Mexico (DATEADD(HOUR,-6,SYSUTCDATETIME())),
//       @Fi = @Ff - 14: 15 dias naturales INCLUYENDO hoy;
//     - porcentajes en escala 0-100 (DECIMAL(6,2)), cada uno con su propio
//       denominador (los KPIs traen TicketsConRespuesta*/TicketsConFrecuencia);
//     - EsInconsistencia = 1 solo si ConfirmacionUsuario = 'Sí' y
//       ValidacionQA = 'Incorrecto'.
//   Las filas viajan con TODAS las columnas del procedimiento y su valor
//   intacto; si falta una de las esperadas se avisa (Avisos).
//
// ORDEN
//   - Posicion ASC en Causa raiz, Recurrentes por categoria y Tipo de
//     solucion (lo pide la guia). Estable: a igual Posicion, el orden del
//     procedimiento; sin Posicion, al final.
//   - Frecuencia en el orden de la guia, nunca alfabetico ni por cantidad
//     (el SP ordena por CantidadTickets DESC). Ver NivelesFrecuencia.
//   - KPIs y Confirmacion vs QA, tal como los devuelve el procedimiento.
//
// FILTROS
//   Los seis procedimientos reciben solo @FechaInicio y @FechaFin y devuelven
//   agregados, asi que QARE no tiene filtros organizacionales: no hay nada en
//   la fila a lo que DirectorioOrganizacional pudiera aplicarse sin cambiar
//   los procedimientos.

using System;
using System.Collections.Generic;
using System.Globalization;

public sealed class QareBloque
{
    public readonly string Clave;          // llave del JSON
    public readonly string Procedimiento;  // siempre dbo.usp_CorreoQARE_*
    public readonly string[] Columnas;     // las de la guia visual
    public readonly bool UnaFila;          // KPIs: un objeto, no una lista

    public QareBloque(string clave, string procedimiento, bool unaFila, params string[] columnas)
    {
        Clave = clave;
        Procedimiento = procedimiento;
        UnaFila = unaFila;
        Columnas = columnas;
    }
}

public sealed class QareSolicitudInvalida : Exception
{
    public QareSolicitudInvalida(string mensaje) : base(mensaje) { }
}

public static class QareContrato
{
    public static readonly QareBloque Kpis = new QareBloque(
        "kpis", "dbo.usp_CorreoQARE_KPIs", true,
        "TotalTicketsPeriodo",
        "PorcentajeConfirmacion", "TicketsConfirmados",
        "PorcentajeRecurrencia", "TicketsRecurrentes",
        "PorcentajeCasosReutilizables", "CasosReutilizables",
        "PorcentajePotencialKB", "CasosPotencialKB");

    public static readonly QareBloque Frecuencia = new QareBloque(
        "frecuencia", "dbo.usp_CorreoQARE_Frecuencia", false,
        "Frecuencia", "CantidadTickets", "Porcentaje");

    public static readonly QareBloque CausaRaiz = new QareBloque(
        "causaRaiz", "dbo.usp_CorreoQARE_CausaRaiz", false,
        "CausaRaiz", "CantidadTickets", "Porcentaje", "PorcentajeAcumulado", "Posicion");

    public static readonly QareBloque RecurrentesCategoria = new QareBloque(
        "recurrentesCategoria", "dbo.usp_CorreoQARE_RecurrentesCategoria", false,
        "Categoria", "CantidadTickets", "PorcentajeRecurrentes", "Posicion");

    public static readonly QareBloque ConfirmacionVsQa = new QareBloque(
        "confirmacionVsQa", "dbo.usp_CorreoQARE_ConfirmacionVsQA", false,
        "ConfirmacionUsuario", "ValidacionQA", "CantidadTickets", "PorcentajeDelTotal");

    public static readonly QareBloque TipoSolucion = new QareBloque(
        "tipoSolucion", "dbo.usp_CorreoQARE_TipoSolucion", false,
        "TipoSolucion", "CantidadTickets", "Porcentaje", "Posicion");

    // Los seis, en el orden en que se pintan.
    public static readonly QareBloque[] Bloques = new QareBloque[]
    {
        Kpis, Frecuencia, CausaRaiz, RecurrentesCategoria, ConfirmacionVsQa, TipoSolucion,
    };

    /* Escala de frecuencia, de menos a mas:
       Primera vez -> Ocasional -> Frecuente -> Siempre.

       UNICO sitio del mapeo guia <-> produccion: cada nivel lleva el rotulo
       que se pinta y los literales de produccion que caen en el.

       La guia visual (seccion 2) dice "Nunca" para el primer nivel, pero el
       literal real de dbo.usp_CorreoQARE_Frecuencia es "Primera vez" (diag
       v2, 365 dias: Primera vez, Ocasional, Frecuente, Siempre; "Nunca" no
       aparece). El usuario confirmo el 2026-09-25 que son el mismo nivel y
       pidio rotularlo con el texto de produccion, "Primera vez". La fila no
       se reescribe: Frecuencia sigue siendo el valor de SQL y el rotulo viaja
       aparte, en FrecuenciaGuia. */
    public sealed class NivelFrecuencia
    {
        public readonly string Rotulo;
        public readonly string[] Literales;

        public NivelFrecuencia(string rotulo, params string[] literales)
        {
            Rotulo = rotulo;
            Literales = literales;
        }
    }

    public static readonly NivelFrecuencia[] NivelesFrecuencia = new NivelFrecuencia[]
    {
        new NivelFrecuencia("Primera vez", "Primera vez"),
        new NivelFrecuencia("Ocasional", "Ocasional"),
        new NivelFrecuencia("Frecuente", "Frecuente"),
        new NivelFrecuencia("Siempre", "Siempre"),
    };

    // Columna que se agrega a cada fila de Frecuencia que cae en un nivel.
    public const string ColumnaRotuloFrecuencia = "FrecuenciaGuia";

    // Ventana por omision: 15 dias naturales INCLUYENDO hoy, la misma que
    // usan los seis SP cuando reciben NULL/NULL (verificado en la VM). Solo
    // aplica si el navegador no manda fechas; el tablero siempre las manda.
    public const int DiasVentana = 15;

    // Tope defensivo del rango: evita que un parametro absurdo ponga a los
    // seis procedimientos a recorrer la historia entera.
    public const int DiasMaximos = 366 * 3;

    // ------------------------------------------------------------ fechas

    /* Lee fecha_inicio / fecha_fin (aaaa-mm-dd). Las fechas se devuelven TAL
       CUAL las eligio el usuario: no se suma ni se resta ningun dia, porque
       los SP ya tratan @FechaFin como inclusivo (el dia fin entra entero).

       Sin fechas: los 15 dias que terminan HOY, igual que el default de los
       SP. 'hoy' entra como parametro: el handler pasa el dia de Mexico
       (DashboardDataInfo.HoyEnPresentacion), el mismo "hoy" que calculan los
       SP con DATEADD(HOUR,-6,SYSUTCDATETIME()), y no DateTime.Today del host
       de IIS. Asi ademas la prueba no depende del reloj. */
    public static void Rango(string textoInicio, string textoFin, DateTime hoy,
                             out DateTime inicio, out DateTime fin)
    {
        DateTime? fi = Fecha(textoInicio, "fecha_inicio");
        DateTime? ff = Fecha(textoFin, "fecha_fin");

        fin = ff ?? hoy.Date;
        inicio = fi ?? fin.AddDays(-(DiasVentana - 1));

        if (inicio > fin)
            throw new QareSolicitudInvalida(
                "El rango de fechas es invalido: 'fecha_inicio' es posterior a 'fecha_fin'.");
        if ((fin - inicio).TotalDays > DiasMaximos)
            throw new QareSolicitudInvalida(
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
            throw new QareSolicitudInvalida(
                "Parametro '" + nombre + "' invalido: se espera una fecha con el formato aaaa-mm-dd.");
        }
        return fecha.Date;
    }

    // ------------------------------------------------------------ filas

    /* Deja las filas de un bloque en el orden del contrato y anota en 'avisos'
       lo que no cuadra con la guia. No quita, no renombra y no calcula
       columnas. */
    public static List<Dictionary<string, object>> Preparar(
        QareBloque bloque, List<Dictionary<string, object>> filas, List<string> avisos)
    {
        filas = filas ?? new List<Dictionary<string, object>>();

        foreach (var falta in ColumnasFaltantes(filas, bloque.Columnas))
            avisos.Add(bloque.Procedimiento + " no devolvio la columna '" + falta + "'.");

        if (bloque == Frecuencia) return OrdenarFrecuencia(filas);
        if (bloque == CausaRaiz || bloque == RecurrentesCategoria || bloque == TipoSolucion)
        {
            var ordenadas = OrdenarPorPosicion(filas);
            if (bloque == CausaRaiz) RevisarAcumulado(ordenadas, avisos);
            return ordenadas;
        }
        return filas;
    }

    // Sin filas no se puede decir que falte nada: un rango vacio no es un
    // contrato roto.
    public static List<string> ColumnasFaltantes(List<Dictionary<string, object>> filas, string[] esperadas)
    {
        var faltan = new List<string>();
        if (filas == null || filas.Count == 0) return faltan;
        foreach (var col in esperadas)
            if (!filas[0].ContainsKey(col)) faltan.Add(col);
        return faltan;
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
            if (pa.HasValue != pb.HasValue) return pa.HasValue ? -1 : 1;   // sin Posicion, al final
            return a.Key.CompareTo(b.Key);
        });

        var salida = new List<Dictionary<string, object>>(filas.Count);
        foreach (var kv in indexadas) salida.Add(kv.Value);
        return salida;
    }

    public static List<Dictionary<string, object>> OrdenarFrecuencia(List<Dictionary<string, object>> filas)
    {
        var salida = new List<Dictionary<string, object>>(filas.Count);
        var usadas = new bool[filas.Count];

        foreach (var nivel in NivelesFrecuencia)
        {
            for (int i = 0; i < filas.Count; i++)
            {
                if (usadas[i]) continue;
                var valor = Texto(filas[i], "Frecuencia");
                foreach (var literal in nivel.Literales)
                {
                    if (!string.Equals(valor, literal, StringComparison.OrdinalIgnoreCase)) continue;
                    // El valor de SQL no se toca; el rotulo de la guia va aparte.
                    filas[i][ColumnaRotuloFrecuencia] = nivel.Rotulo;
                    salida.Add(filas[i]);
                    usadas[i] = true;
                    break;
                }
            }
        }
        // Lo que no es ninguno de los cuatro niveles (un NULL, un texto nuevo):
        // detras, en el orden del procedimiento, con su valor intacto y sin
        // rotulo de la guia.
        for (int i = 0; i < filas.Count; i++)
            if (!usadas[i]) salida.Add(filas[i]);

        return salida;
    }

    /* El acumulado lo calcula el procedimiento. Aqui solo se comprueba que,
       ya en orden de Posicion, no baje y no pase de 100: si baja, el orden y
       el acumulado no son la misma cuenta; si el ultimo vale 1 o menos, la
       escala parece 0-1 y la grafica (eje de 0 a 100 %) lo pintaria plano. */
    private static void RevisarAcumulado(List<Dictionary<string, object>> filas, List<string> avisos)
    {
        decimal? previo = null;
        decimal? ultimo = null;
        foreach (var fila in filas)
        {
            var v = Numero(fila, "PorcentajeAcumulado");
            if (!v.HasValue) continue;
            if (previo.HasValue && v.Value < previo.Value)
            {
                avisos.Add(CausaRaiz.Procedimiento + ": PorcentajeAcumulado baja al ordenar por Posicion.");
                return;
            }
            previo = v;
            ultimo = v;
        }
        if (ultimo.HasValue && ultimo.Value > 100.5m)
            avisos.Add(CausaRaiz.Procedimiento + ": PorcentajeAcumulado pasa de 100.");
        else if (ultimo.HasValue && ultimo.Value <= 1m && filas.Count > 1)
            avisos.Add(CausaRaiz.Procedimiento + ": PorcentajeAcumulado termina en " +
                       ultimo.Value.ToString(CultureInfo.InvariantCulture) +
                       "; la escala parece 0-1 y el tablero espera 0-100.");
    }

    // ------------------------------------------------------------ lectura

    public static decimal? Numero(Dictionary<string, object> fila, string columna)
    {
        object v;
        if (fila == null || !fila.TryGetValue(columna, out v) || v == null) return null;
        try { return Convert.ToDecimal(v, CultureInfo.InvariantCulture); }
        catch (FormatException) { return null; }
        catch (InvalidCastException) { return null; }
        catch (OverflowException) { return null; }
    }

    private static string Texto(Dictionary<string, object> fila, string columna)
    {
        object v;
        if (fila == null || !fila.TryGetValue(columna, out v) || v == null) return null;
        return Convert.ToString(v, CultureInfo.InvariantCulture).Trim();
    }
}
