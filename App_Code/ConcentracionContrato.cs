// Contrato de la pestaña "Vista general de servicios" (carpeta concentracion/,
// handlers/concentracion.ashx): filtros, periodos y la cuenta de las tres
// graficas.
//
// Aqui no hay SQL ni conexion: es la parte PURA del modulo, la que se puede
// probar sin base (tools/tests/ConcentracionContratoSmoke.cs). La lectura vive
// en App_Code/ConcentracionQueries.cs y el endpoint en handlers/concentracion.ashx.
//
// DE DONDE SALEN LOS DATOS (decidido el 2026-11-09)
//   Los tres SP dbo.usp_CorreoServicio_* (sql/81) solo aceptan @Slot: no
//   pueden filtrar por Mes, Service Owner ni Grupo. La pestaña ya no los
//   llama (siguen en la base, sin tocar). Lee las filas de ticket del periodo
//   de la MISMA fuente que ellos, dbo.vw_ServicioTickets (un renglon por
//   ticket, verificado en QA: diag 2, D4/D5a/D6), y aqui se hace la misma
//   cuenta que hacian:
//     - CantidadTickets = tickets distintos de cada etiqueta;
//     - TotalTickets    = suma de CantidadTickets de TODAS las etiquetas;
//     - Posicion        = orden CantidadTickets DESC, etiqueta ASC;
//     - Porcentaje y PorcentajeAcumulado = 100 * x / TotalTickets, redondeo a
//       2 decimales como CAST(... AS DECIMAL(6,2));
//     - etiqueta vacia o NULL: fuera (cada grafica con su propio total).
//   El Pareto agrupa por el CODIGO de servicio (CatServicioCorreo.Servicio),
//   con su Descripcion como NombreServicio: PU y WMS son una barra cada uno.
//   Es lo que proponia sql/82 sin cambiar el SP (82 sigue pendiente y ya no
//   hace falta para la pestaña).
//
// PERIODO: Slot O Mes, nunca los dos
//   Slot = la columna Slot de dbo.vw_Tickets, sin cambiar su calculo:
//     Slot k = hoy-(30k+29) .. hoy-30k (hoy por UTC-6 fijo, como la vista).
//     ACUMULADO (2026-11-10, como el SLOT del tablero de SLA): elegir el
//     Slot N trae los Slots 0..N juntos, hoy-(30N+29) .. hoy, un solo rango
//     sin hueco. ?slot= sigue siendo un numero 0..12.
//   Mes  = mes calendario por FechaRegistro, de los ultimos 13 (el actual y
//     los 12 anteriores, el mismo alcance que los Slots 0..12). El mes en
//     curso llega hasta hoy. VARIOS (2026-11-10): ?mes=aaaa-mm|aaaa-mm...
//     trae la union de esos meses (no tienen que ser seguidos); las tres
//     graficas, los totales y la cobertura usan los mismos.
//   Juntarlos daria la interseccion parcial de dos ventanas distintas; el
//   usuario elige UNA (modo=slot|mes) y la pestaña dice cual y sus fechas.
//
// FILTROS SOBRE EL PERIODO
//   Service Owner: el de la categoria del ticket segun DirectorioOrganizacional
//     (dbo.CatCategoriaDueno: C1&C2 exacto y, si no, el de su C1), la UNICA
//     resolucion de dueños del sitio, la misma de Experiencia, con
//     C1 = fn_CategoriaC1(Categoria) y C1C2 = fn_CategoriaC1C2(Categoria).
//     Ticket sin SO resuelto = SinServiceOwner.
//   Grupo: dbo.vw_ServicioTickets.Grupo (el grupo asignado del ticket).
//   Varios valores de un filtro = cualquiera de ellos; filtros distintos = y.
//   Los dos filtros se aplican a las TRES graficas y a la comparacion.
//
// COMPARACION CON EL PERIODO ANTERIOR (2026-11-18; grafica "Servicios con
// mayor cambio de tickets"): ver PeriodoAnterior y Cambios. No usa
// dbo.usp_DashboardServicios_Comparativo (agrupa por rama, no filtra por SO
// ni Grupo y no tiene dueño confirmado; diag sql/diag/ADM_DIAG_...).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public sealed class ConcentracionSolicitudInvalida : Exception
{
    public ConcentracionSolicitudInvalida(string mensaje) : base(mensaje) { }
}

// Un ticket del periodo, con lo necesario para filtrar y contar.
public sealed class ConcentracionTicket
{
    public string Codigo;
    public string Servicio;        // codigo de CatServicioCorreo
    public string NombreServicio;  // su Descripcion
    public string Categoria;       // ruta completa
    public string Grupo;
    public string C1;
    public string C1C2;
    public DateTime? Dia;          // FechaRegistroDia
    public string ServiceOwner;    // resuelto; null = sin SO
}

public sealed class ConcentracionFiltros
{
    public string Modo = ConcentracionContrato.ModoSlot;
    public int Slot;
    public DateTime Mes;           // primer dia del mes mas reciente elegido (modo mes)
    // Todos los meses elegidos (modo mes), del mas reciente al mas viejo, sin
    // repetir. Mes es Meses[0].
    public readonly List<DateTime> Meses = new List<DateTime>();
    public readonly List<string> ServiceOwners = new List<string>();
    public readonly List<string> Grupos = new List<string>();
    // Codigos de servicio elegidos para la tendencia (solo esa grafica); vacio = Top 3.
    public readonly List<string> Servicios = new List<string>();
}

public static class ConcentracionContrato
{
    public const string ModoSlot = "slot";
    public const string ModoMes = "mes";

    public const int SlotMinimo = 0;
    public const int SlotMaximo = 12;
    public const int DiasSlot = 30;           // = DashboardDataInfo.DiasSlot
    public const int MesesAtras = 12;         // el actual y los 12 anteriores

    // Valor del filtro de Service Owner para los tickets sin SO resuelto.
    public const string SinServiceOwner = "(Sin Service Owner)";

    // Desfase de la vista: DATEADD(HOUR, -6, SYSUTCDATETIME()).
    private const int HorasMexico = -6;

    // Orden de etiquetas a igual cantidad. Cultural e insensible a
    // mayusculas, como la collation de la base (SQL_Latin1_General_CP1_CI_AS
    // ordena "S-FENIX" como "SFENIX"; la comparacion cultural de .NET tambien
    // ignora el guion).
    private static readonly CompareInfo Comparacion = CultureInfo.GetCultureInfo("es-MX").CompareInfo;
    public static int CompararEtiquetas(string a, string b)
    {
        return Comparacion.Compare(a ?? "", b ?? "", CompareOptions.IgnoreCase);
    }

    // ------------------------------------------------------------ parametros
    public static string LeerModo(string valor)
    {
        if (valor == null || valor.Trim().Length == 0) return ModoSlot;
        var v = valor.Trim().ToLowerInvariant();
        if (v == ModoSlot || v == ModoMes) return v;
        throw new ConcentracionSolicitudInvalida("El periodo debe ser 'slot' o 'mes'.");
    }

    /* ?slot= vacio o ausente = 0. Cualquier otra cosa que no sea un entero de
       0 a 12 es un 400: no se acota en silencio, porque el rotulo diria un
       periodo distinto del que se pidio. */
    public static int LeerSlot(string valor)
    {
        if (valor == null || valor.Trim().Length == 0) return SlotMinimo;
        int slot;
        if (!int.TryParse(valor.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out slot)
            || slot < SlotMinimo || slot > SlotMaximo)
        {
            throw new ConcentracionSolicitudInvalida(
                "El slot debe ser un numero entero de " + SlotMinimo + " a " + SlotMaximo + ".");
        }
        return slot;
    }

    /* ?mes=aaaa-mm, uno de Meses(hoy). Vacio = el mes en curso. */
    public static DateTime LeerMes(string valor, DateTime hoy)
    {
        var actual = new DateTime(hoy.Year, hoy.Month, 1);
        if (valor == null || valor.Trim().Length == 0) return actual;
        DateTime mes;
        if (!DateTime.TryParseExact(valor.Trim(), "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out mes)
            || mes > actual || mes < actual.AddMonths(-MesesAtras))
        {
            throw new ConcentracionSolicitudInvalida(
                "El mes debe ser aaaa-mm, entre " + Mes(actual.AddMonths(-MesesAtras)) + " y " + Mes(actual) + ".");
        }
        return mes;
    }

    /* ?mes=aaaa-mm|aaaa-mm... (varios meses). Cada uno con la regla de
       LeerMes; vacio = el mes en curso. Sin repetir, del mas reciente al mas
       viejo. Un mes invalido es un 400 para toda la peticion. */
    public static List<DateTime> LeerMeses(string valor, DateTime hoy)
    {
        var salida = new List<DateTime>();
        if (valor != null)
            foreach (var parte in valor.Split('|'))
            {
                if (parte.Trim().Length == 0) continue;
                var m = LeerMes(parte, hoy);
                if (!salida.Contains(m)) salida.Add(m);
            }
        if (salida.Count == 0) salida.Add(LeerMes(null, hoy));
        salida.Sort((a, b) => b.CompareTo(a));
        return salida;
    }

    // Lista separada por '|' (los nombres de persona pueden llevar comas).
    public static List<string> LeerLista(string valor)
    {
        var salida = new List<string>();
        if (valor == null) return salida;
        foreach (var parte in valor.Split('|'))
        {
            var t = parte.Trim();
            if (t.Length > 0 && !salida.Contains(t)) salida.Add(t);
        }
        return salida;
    }

    // El mes en curso y los 12 anteriores, del mas reciente al mas viejo.
    public static List<DateTime> Meses(DateTime hoy)
    {
        var actual = new DateTime(hoy.Year, hoy.Month, 1);
        var lista = new List<DateTime>();
        for (int i = 0; i <= MesesAtras; i++) lista.Add(actual.AddMonths(-i));
        return lista;
    }

    // ------------------------------------------------------------ periodos
    // El dia "hoy" de la vista para el instante utc dado.
    public static DateTime HoyMexico(DateTime utc)
    {
        if (utc.Kind == DateTimeKind.Local) utc = utc.ToUniversalTime();
        return utc.AddHours(HorasMexico).Date;
    }

    // Slot k = hoy-(30k+29) .. hoy-30k, los dos incluidos.
    public static void Periodo(int slot, DateTime hoy, out DateTime desde, out DateTime hasta)
    {
        hasta = hoy.Date.AddDays(-DiasSlot * slot);
        desde = hasta.AddDays(-(DiasSlot - 1));
    }

    /* Slots 0..N ACUMULADOS (lo que trae elegir el Slot N): del inicio del
       Slot N al fin del Slot 0 (hoy). Sin hueco ni solape entre Slots, asi
       que es un solo rango: hoy-(30N+29) .. hoy. */
    public static void PeriodoAcumulado(int slot, DateTime hoy, out DateTime desde, out DateTime hasta)
    {
        DateTime d0;
        Periodo(0, hoy, out d0, out hasta);
        DateTime hN;
        Periodo(slot, hoy, out desde, out hN);
    }

    // Mes calendario; el mes en curso llega hasta hoy.
    public static void PeriodoMes(DateTime mes, DateTime hoy, out DateTime desde, out DateTime hasta)
    {
        desde = new DateTime(mes.Year, mes.Month, 1);
        var fin = desde.AddMonths(1).AddDays(-1);
        hasta = fin > hoy.Date ? hoy.Date : fin;
    }

    /* COBERTURA (aviso de periodo incompleto)
       Ni la vista ni los SP dicen cuantos dias del periodo tienen datos, y el
       primer registro de la base no sirve (en QA hay diez tickets sueltos,
       uno por dia, del 2025-08-19 al 2025-11-28; la historia continua empieza
       el 2025-12-01: sql/diag/DIAG_Concentracion_CoberturaDiaria.sql). Se
       mide cuantos dias distintos del periodo tienen al menos un ticket, sobre
       TODOS los tickets del periodo (antes de Service Owner / Grupo: es
       cobertura de datos, no del filtro). Se esperan todos los dias del
       periodo SIN contar hoy (dia en curso). En QA todo Slot completo tiene
       30 de 30. */
    public static int DiasEsperados(DateTime desde, DateTime hasta, DateTime hoy)
    {
        var ultimo = hasta.Date >= hoy.Date ? hoy.Date.AddDays(-1) : hasta.Date;
        return ultimo < desde.Date ? 0 : (ultimo - desde.Date).Days + 1;
    }

    public static Dictionary<string, object> Cobertura(IList<ConcentracionTicket> periodo,
                                                       DateTime desde, DateTime hasta, DateTime hoy)
    {
        return Cobertura(periodo, new[] { new KeyValuePair<DateTime, DateTime>(desde, hasta) }, hoy);
    }

    /* Lo mismo sobre varios rangos (varios meses, no siempre seguidos): los
       dias esperados son la suma de los de cada rango; solo cuentan los dias
       con tickets que caen dentro de alguno. hasta mas alto >= hoy = excluye hoy. */
    public static Dictionary<string, object> Cobertura(IList<ConcentracionTicket> periodo,
                                                       IList<KeyValuePair<DateTime, DateTime>> rangos, DateTime hoy)
    {
        var dias = new HashSet<DateTime>();
        DateTime? primero = null, ultimo = null;
        foreach (var t in periodo)
        {
            if (!t.Dia.HasValue) continue;
            var d = t.Dia.Value.Date;
            if (d < hoy.Date && rangos.Any(r => d >= r.Key.Date && d <= r.Value.Date)) dias.Add(d);
            if (!primero.HasValue || d < primero.Value) primero = d;
            if (!ultimo.HasValue || d > ultimo.Value) ultimo = d;
        }
        int esperados = rangos.Sum(r => DiasEsperados(r.Key, r.Value, hoy));
        var hasta = rangos.Max(r => r.Value);
        return new Dictionary<string, object>
        {
            { "diasConTickets", dias.Count },
            { "diasEsperados", esperados },
            { "primerDia", primero.HasValue ? (object)Dia(primero.Value) : null },
            { "ultimoDia", ultimo.HasValue ? (object)Dia(ultimo.Value) : null },
            { "completa", dias.Count >= esperados },
            { "excluyeHoy", hasta.Date >= hoy.Date },
        };
    }

    // ------------------------------------------------------------ filtros
    public static List<ConcentracionTicket> Filtrar(IEnumerable<ConcentracionTicket> periodo, ConcentracionFiltros f)
    {
        var so = new HashSet<string>(f.ServiceOwners, StringComparer.OrdinalIgnoreCase);
        var gr = new HashSet<string>(f.Grupos, StringComparer.OrdinalIgnoreCase);
        return periodo.Where(t =>
            (so.Count == 0 || so.Contains(t.ServiceOwner ?? SinServiceOwner)) &&
            (gr.Count == 0 || (t.Grupo != null && gr.Contains(t.Grupo)))).ToList();
    }

    /* Opciones de un filtro: los valores presentes en el periodo (antes de
       los filtros), con cuantos tickets tienen, de mas a menos. Los valores
       elegidos que ya no aparecen se agregan con 0, para que el filtro no se
       pierda en silencio al cambiar de periodo. */
    public static List<Dictionary<string, object>> Opciones(IEnumerable<string> valores, IEnumerable<string> elegidos)
    {
        var cuenta = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var v in valores)
        {
            if (string.IsNullOrEmpty(v)) continue;
            int n; cuenta.TryGetValue(v, out n); cuenta[v] = n + 1;
        }
        foreach (var e in elegidos) if (!cuenta.ContainsKey(e)) cuenta[e] = 0;
        return cuenta.OrderByDescending(kv => kv.Value)
                     .ThenBy(kv => kv.Key, Comparer<string>.Create(CompararEtiquetas))
                     .Select(kv => new Dictionary<string, object> { { "valor", kv.Key }, { "tickets", kv.Value } })
                     .ToList();
    }

    // ------------------------------------------------------------ la cuenta
    /* La misma cuenta de los SP (ver cabecera). `etiqueta` da la llave de
       agrupacion; `extra` agrega columnas por llave (NombreServicio). Las
       filas salen con los nombres de columna de los SP. */
    public static List<Dictionary<string, object>> Agregar(
        IEnumerable<ConcentracionTicket> tickets, string columna,
        Func<ConcentracionTicket, string> etiqueta,
        Action<string, ConcentracionTicket, Dictionary<string, object>> extra)
    {
        var porLlave = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var muestra = new Dictionary<string, ConcentracionTicket>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tickets)
        {
            var k = etiqueta(t);
            if (k == null || k.Trim().Length == 0) continue;
            k = k.Trim();
            HashSet<string> set;
            if (!porLlave.TryGetValue(k, out set)) { set = new HashSet<string>(StringComparer.OrdinalIgnoreCase); porLlave[k] = set; muestra[k] = t; }
            set.Add(t.Codigo);
        }

        var orden = porLlave.Select(kv => new { Llave = kv.Key, N = kv.Value.Count }).ToList();
        orden.Sort((a, b) => a.N != b.N ? b.N.CompareTo(a.N) : CompararEtiquetas(a.Llave, b.Llave));
        int total = orden.Sum(x => x.N);

        var salida = new List<Dictionary<string, object>>();
        int acumulado = 0, posicion = 0;
        foreach (var x in orden)
        {
            acumulado += x.N;
            var f = new Dictionary<string, object>();
            f["Posicion"] = ++posicion;
            f[columna] = x.Llave;
            f["CantidadTickets"] = x.N;
            f["TotalTickets"] = total;
            f["Porcentaje"] = Pct(x.N, total);
            f["PorcentajeAcumulado"] = Pct(acumulado, total);
            if (extra != null) extra(x.Llave, muestra[x.Llave], f);
            salida.Add(f);
        }
        return salida;
    }

    // CAST(100.0 * n / total AS DECIMAL(6,2)): redondeo a 2, mitad hacia arriba.
    public static decimal Pct(int n, int total)
    {
        if (total == 0) return 0m;
        return Math.Round(100m * n / total, 2, MidpointRounding.AwayFromZero);
    }

    public static List<Dictionary<string, object>> Pareto(IEnumerable<ConcentracionTicket> t)
    {
        return Agregar(t, "Servicio", x => x.Servicio, (llave, m, f) =>
            f["NombreServicio"] = string.IsNullOrWhiteSpace(m.NombreServicio) ? llave : m.NombreServicio.Trim());
    }

    public static List<Dictionary<string, object>> Categorias(IEnumerable<ConcentracionTicket> t)
    {
        return Agregar(t, "Categoria", x => x.Categoria, null);
    }

    public static List<Dictionary<string, object>> Grupos(IEnumerable<ConcentracionTicket> t)
    {
        return Agregar(t, "Grupo", x => x.Grupo, null);
    }

    // ------------------------------------------------------------ comparacion
    public const int TopCambios = 5;
    public const string CambiosOk = "ok";
    public const string CambiosHistoriaInsuficiente = "historiaInsuficiente";
    public const string CambiosError = "error";

    // Por que no hay comparacion (cambios.motivo, solo con historiaInsuficiente).
    public const string MotivoVentanaMinima = "ventanaMinima";    // la acotada saldria de menos de 28 dias
    public const string MotivoNoConsecutivos = "noConsecutivos";  // meses con hueco: no hay ventana continua

    public const int VentanaMinimaDias = 28;
    public const int DiasSemana = 7;

    // Los meses del filtro (Meses; si viene vacio, Mes: quien solo fijo Mes).
    public static List<DateTime> MesesElegidos(ConcentracionFiltros f)
    {
        return f.Meses.Count > 0 ? new List<DateTime>(f.Meses) : new List<DateTime> { f.Mes };
    }

    /* El periodo con el que se compara, de la MISMA duracion e inmediatamente
       antes del elegido. Nunca se enciman con el actual.
         Slot N (acumulado, 30(N+1) dias): los 30(N+1) dias anteriores a su
           inicio (= los Slots N+1..2N+1 por fecha).
         Meses: cada mes elegido se corre hacia atras el mismo numero de meses,
           el del tramo que cubre la seleccion (del mas viejo al mas reciente,
           ambos incluidos). Un mes = el anterior; Sep-Oct-Nov = Jun-Jul-Ago;
           Sep y Nov (sin Oct) = Jun y Ago: se conserva el patron, nunca se
           rellena el hueco. Mes cerrado -> el mes completo; el mes de hoy
           (del 1 a hoy) -> los mismos dias de su mes, acotados a su ultimo
           dia (31 de marzo -> 1..28 de febrero).
       Del mas reciente al mas viejo, como los rangos del actual. */
    public static List<KeyValuePair<DateTime, DateTime>> PeriodoAnterior(ConcentracionFiltros f, DateTime hoy)
    {
        var salida = new List<KeyValuePair<DateTime, DateTime>>();
        if (f.Modo == ModoMes)
        {
            var meses = MesesElegidos(f).ConvertAll(m => new DateTime(m.Year, m.Month, 1));
            meses.Sort((a, b) => b.CompareTo(a));
            DateTime viejo = meses[meses.Count - 1], nuevo = meses[0];
            int tramo = (nuevo.Year - viejo.Year) * 12 + nuevo.Month - viejo.Month + 1;
            foreach (var m in meses)
            {
                DateTime d, h;
                PeriodoMes(m, hoy, out d, out h);
                var inicio = m.AddMonths(-tramo);
                var finMes = inicio.AddMonths(1).AddDays(-1);
                // Por el mes de hoy, no por el largo: el ultimo dia del mes
                // sigue en curso y compara contra los mismos dias, no contra
                // el mes anterior completo (30 de nov -> 1..30 de oct).
                bool enCurso = m.Year == hoy.Year && m.Month == hoy.Month;
                var fin = enCurso ? inicio.AddDays(Math.Min((h - d).Days, (finMes - inicio).Days)) : finMes;
                salida.Add(new KeyValuePair<DateTime, DateTime>(inicio, fin));
            }
        }
        else
        {
            DateTime d, h;
            PeriodoAcumulado(f.Slot, hoy, out d, out h);
            int dias = (h - d).Days + 1;
            salida.Add(new KeyValuePair<DateTime, DateTime>(d.AddDays(-dias), d.AddDays(-1)));
        }
        return salida;
    }

    /* Una sola ventana continua: el Slot acumulado siempre; meses, si no hay
       hueco entre el mas viejo y el mas reciente. Con hueco, una ventana
       acotada meteria meses que el usuario no eligio. */
    public static bool SeleccionContinua(ConcentracionFiltros f)
    {
        if (f.Modo != ModoMes) return true;
        var meses = MesesElegidos(f).ConvertAll(m => new DateTime(m.Year, m.Month, 1));
        DateTime viejo = meses.Min(), nuevo = meses.Max();
        int tramo = (nuevo.Year - viejo.Year) * 12 + nuevo.Month - viejo.Month + 1;
        return tramo == meses.Distinct().Count();
    }

    public sealed class VentanaComparada
    {
        public DateTime HistoriaDesde;   // primer dia de la historia continua
        public int DiasPorLado;          // lo que alcanza antes de redondear: floor(T/2)
        public int Dias;                 // L: a semanas completas y sin pasar de lo pedido
        public bool Valida;              // L >= VentanaMinimaDias
        public KeyValuePair<DateTime, DateTime> Actual, Anterior;
    }

    /* VENTANA MAXIMA COMPARABLE (2026-11-18), cuando el periodo anterior
       pedido cae antes de la historia.
       La historia continua empieza el dia siguiente al ULTIMO dia sin ningun
       ticket de [desde, fin] (hoy no cuenta: va a medias). Solo un cero es
       hueco: en QA cada dia desde 2025-12-01 tiene tickets y los dias bajos
       son feriados reales (1 de enero, 80; 25 de diciembre, 135), asi que
       tomarlos como hueco recortaria la ventana sin razon. Antes de ese
       primer dia solo hay tickets sueltos, que el ultimo cero deja fuera.
       Con T = fin - inicio + 1 dias cubiertos:
         L = floor(min(lo pedido, floor(T/2)) / 7) * 7
       a semanas completas para que los dos lados tengan los mismos dias de la
       semana (un domingo trae ~1/5 de un lunes). Actual = los ultimos L dias
       hasta fin; anterior = los L inmediatamente antes. Mismo largo, pegados,
       sin solape. Valida solo si L >= 28. */
    public static VentanaComparada VentanaComparable(ICollection<DateTime> diasConTickets, DateTime desde, DateTime fin,
                                                     DateTime hoy, int diasPedidos)
    {
        var ultimoCompleto = fin.Date < hoy.Date ? fin.Date : hoy.Date.AddDays(-1);
        DateTime inicio = desde.Date;
        for (var d = ultimoCompleto; d >= desde.Date; d = d.AddDays(-1))
            if (!diasConTickets.Contains(d)) { inicio = d.AddDays(1); break; }

        int t = (fin.Date - inicio).Days + 1;
        var v = new VentanaComparada { HistoriaDesde = inicio, DiasPorLado = Math.Max(0, t / 2) };
        v.Dias = Math.Min(diasPedidos, v.DiasPorLado) / DiasSemana * DiasSemana;
        v.Valida = v.Dias >= VentanaMinimaDias;
        v.Actual = new KeyValuePair<DateTime, DateTime>(fin.Date.AddDays(-v.Dias + 1), fin.Date);
        v.Anterior = new KeyValuePair<DateTime, DateTime>(fin.Date.AddDays(-2 * v.Dias + 1), fin.Date.AddDays(-v.Dias));
        return v;
    }

    // Los tickets cuyo dia cae en el rango (los dos extremos incluidos).
    public static List<ConcentracionTicket> EnRango(IEnumerable<ConcentracionTicket> tickets, KeyValuePair<DateTime, DateTime> rango)
    {
        return tickets.Where(t => t.Dia.HasValue && t.Dia.Value.Date >= rango.Key && t.Dia.Value.Date <= rango.Value).ToList();
    }

    /* Servicios con mayor cambio: tickets distintos por CODIGO de servicio
       (como el Pareto: un servicio es una sola entrada aunque sus tickets
       vengan de dos ramas de categoria) en cada periodo, ya filtrados.
       Diferencia = actual - anterior; los de diferencia 0 no salen.
         aumentos:    diferencia > 0, de mayor a menor;
         reducciones: diferencia < 0, de la mas negativa a la menos;
       a igual diferencia, por codigo (CompararEtiquetas), para que el corte
       del Top sea estable. Top `top` de cada lado; serviciosAumento /
       serviciosReduccion cuentan todos. VariacionPorcentaje = 100 * dif /
       anterior a 2 decimales (como Pct), null si el anterior es 0. */
    public static Dictionary<string, object> Cambios(IEnumerable<ConcentracionTicket> actual,
                                                     IEnumerable<ConcentracionTicket> anterior, int top)
    {
        var nombres = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var a = TicketsPorServicio(actual, nombres);
        var p = TicketsPorServicio(anterior, nombres);
        var filas = new List<Dictionary<string, object>>();
        foreach (var k in a.Keys.Union(p.Keys, StringComparer.OrdinalIgnoreCase))
        {
            HashSet<string> sa, sp;
            int na = a.TryGetValue(k, out sa) ? sa.Count : 0;
            int np = p.TryGetValue(k, out sp) ? sp.Count : 0;
            if (na == np) continue;
            var nombre = nombres[k];
            filas.Add(new Dictionary<string, object>
            {
                { "Servicio", k },
                { "NombreServicio", string.IsNullOrWhiteSpace(nombre) ? k : nombre.Trim() },
                { "TicketsActual", na },
                { "TicketsAnterior", np },
                { "Diferencia", na - np },
                { "VariacionPorcentaje", np == 0 ? (object)null
                    : Math.Round(100m * (na - np) / np, 2, MidpointRounding.AwayFromZero) },
            });
        }
        Func<Dictionary<string, object>, int> dif = x => (int)x["Diferencia"];
        var aumentos = filas.Where(x => dif(x) > 0).ToList();
        aumentos.Sort((x, y) => dif(x) != dif(y) ? dif(y).CompareTo(dif(x)) : CompararEtiquetas((string)x["Servicio"], (string)y["Servicio"]));
        var reducciones = filas.Where(x => dif(x) < 0).ToList();
        reducciones.Sort((x, y) => dif(x) != dif(y) ? dif(x).CompareTo(dif(y)) : CompararEtiquetas((string)x["Servicio"], (string)y["Servicio"]));
        return new Dictionary<string, object>
        {
            { "aumentos", aumentos.Take(top).ToList() },
            { "reducciones", reducciones.Take(top).ToList() },
            { "serviciosAumento", aumentos.Count },
            { "serviciosReduccion", reducciones.Count },
            { "ticketsActual", a.Values.Sum(s => s.Count) },
            { "ticketsAnterior", p.Values.Sum(s => s.Count) },
        };
    }

    // Codigo de servicio (recortado, sin distinguir mayusculas) -> tickets
    // distintos. Sin codigo: fuera, como en el Pareto. El primer nombre visto
    // de cada codigo queda en `nombres` (el periodo actual se lee primero).
    private static Dictionary<string, HashSet<string>> TicketsPorServicio(IEnumerable<ConcentracionTicket> tickets,
                                                                          Dictionary<string, string> nombres)
    {
        var salida = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tickets)
        {
            if (t.Servicio == null || t.Servicio.Trim().Length == 0) continue;
            var k = t.Servicio.Trim();
            HashSet<string> set;
            if (!salida.TryGetValue(k, out set)) { set = new HashSet<string>(StringComparer.OrdinalIgnoreCase); salida[k] = set; }
            set.Add(t.Codigo);
            if (!nombres.ContainsKey(k)) nombres[k] = t.NombreServicio;
        }
        return salida;
    }

    // Rangos -> { rangos: [{desde, hasta}], dias } para el JSON.
    public static Dictionary<string, object> RangosJson(IList<KeyValuePair<DateTime, DateTime>> rangos)
    {
        return new Dictionary<string, object>
        {
            { "rangos", rangos.Select(x => new Dictionary<string, object> { { "desde", Dia(x.Key) }, { "hasta", Dia(x.Value) } }).ToList() },
            { "dias", rangos.Sum(x => (x.Value - x.Key).Days + 1) },
        };
    }

    // ------------------------------------------------------------ C1&C2
    /* Replica de dbo.fn_CategoriaC1C2 (2026-11-11), para calcularla UNA vez
       por categoria distinta en vez de una vez por ticket dentro de la
       consulta. Texto de QA (verificado por largo + SHA2_256 en
       LOCALDB_PERMISSION_CHANGES/scripts/dev_db/10_cadena_volumetria.sql):

         fn_NormalizaCategoria: LTRIM(RTRIM(REPLACE(ISNULL(@c, N''), NCHAR(160), N' ')))
         fn_CategoriaC1C2:      @s NVARCHAR(500) = normalizada; '' -> '';
                                sin '/' al inicio se le antepone (y se corta a 500);
                                hasta antes del tercer '/' (o todo si no hay).

       LTRIM/RTRIM de SQL solo quitan U+0020 (no tabuladores ni saltos).

       SOLO es exacta para texto de C1C2Verificable: la collation de la base
       (SQL_Latin1_General_CP1_CI_AS) compara por reglas Unicode, y con otros
       caracteres CHARINDEX/LEFT/'=' no son comparaciones caracter a caracter
       (medido en LocalDB: el '/' de ancho completo U+FF0F cuenta como '/',
       U+0000 o U+3000 solos valen N'', NBSP + acento combinado no se
       reemplaza). Esas categorias las calcula la funcion real
       (ConcentracionQueries.C1C2DeCategorias). La paridad la prueba
       tools/tests/ConcentracionContratoSmoke.cs contra el texto de QA.

       Entrada: la Categoria tal como la entrega LTRIM(RTRIM(v.Categoria))
       (fn(LTRIM(RTRIM(x))) = fn(x): la funcion ya quita esos espacios).
       Salida: lo que devolveria la funcion, sin el recorte de Texto(). */
    public static string C1C2(string categoria)
    {
        var s = (categoria ?? "").Replace((char)0xA0, (char)0x20).Trim((char)0x20);
        if (s.Length == 0) return "";
        if (s[0] != '/')
        {
            s = "/" + s;
            if (s.Length > 500) s = s.Substring(0, 500);   // @s NVARCHAR(500)
        }
        int p2 = s.IndexOf('/', 1);
        if (p2 < 0) return s;
        int p3 = s.IndexOf('/', p2 + 1);
        if (p3 < 0) return s;
        return s.Substring(0, p3);
    }

    /* Texto con el que C1C2 es exacta: tabulador, CR, LF, ASCII imprimible
       (U+0020..U+007E) y Latin-1 U+00A0..U+00FF salvo el guion suave U+00AD
       (ignorable en la collation). Es el conjunto comprobado en LocalDB contra
       el texto de QA (0 diferencias en 64 123 cadenas, 2026-11-11). NULL y ''
       tambien. */
    public static bool C1C2Verificable(string categoria)
    {
        if (categoria == null) return true;
        foreach (var c in categoria)
        {
            if (c == '\t' || c == '\r' || c == '\n') continue;
            if (c >= 0x20 && c <= 0x7E) continue;
            if (c >= 0xA0 && c <= 0xFF && c != 0xAD) continue;
            return false;
        }
        return true;
    }

    // ------------------------------------------------------------ tendencia diaria
    // Tope de lineas, por omision (Top N) y elegidas: una por color de la
    // paleta de la grafica (COLOR_TENDENCIA en concentracion.js).
    public const int TopTendencia = 3;
    public const int MaxServiciosTendencia = 3;
    public const string TendenciaTop = "top";
    public const string TendenciaElegidos = "elegidos";

    // ?servicios=COD|COD: codigos de servicio para la tendencia, a lo mas 3.
    public static List<string> LeerServicios(string valor)
    {
        var l = LeerLista(valor);
        if (l.Count > MaxServiciosTendencia)
            throw new ConcentracionSolicitudInvalida("servicios: a lo mas " + MaxServiciosTendencia + " a la vez.");
        return l;
    }

    /* "Tickets generados por dia": una serie diaria por servicio (codigo de
       CatServicioCorreo, como el Pareto).
         Sin `elegidos`: los primeros `top` del Pareto ya filtrado, tomados de
           `pareto` (sin reordenar) para que sean SIEMPRE sus primeras barras.
         Con `elegidos`: esos, en el orden en que llegan (el color sigue a la
           eleccion, no al ranking del periodo). Uno sin tickets con estos
           filtros sale en 0; su nombre, del periodo sin filtrar o el codigo.
       Las series se cuentan sobre `filtrados`: Slot/Mes, Service Owner y
       Grupo ya aplicados. La grafica toma dias y conteos de
       dbo.usp_DashboardServicios_TendenciaDiaria (ConcentracionQueries.
       TendenciaDesdeSp); de aqui salen las lineas, nombres y opciones, y
       estas cuentas son el oraculo de la prueba de paridad.
       Dias = cada dia de los rangos del periodo, en orden; un servicio sin
       tickets ese dia vale 0. Los huecos entre meses NO elegidos no son dias
       del periodo y no se rellenan. Un ticket sin Dia o fuera de los rangos
       no cae en ningun dia (sigue contando en el Pareto).
       TicketsTotalDia = suma de las series pintadas ese dia, como la columna
       del mismo nombre de la USP: no es el total de tickets del dia.
       opciones = los servicios del Pareto filtrado (mas los elegidos que no
       esten, con 0), para el selector de la grafica. */
    public static Dictionary<string, object> Tendencia(IEnumerable<ConcentracionTicket> filtrados,
        IList<Dictionary<string, object>> pareto, IEnumerable<KeyValuePair<DateTime, DateTime>> rangos, int top,
        IList<string> elegidos, IEnumerable<ConcentracionTicket> periodo)
    {
        pareto = pareto ?? new List<Dictionary<string, object>>();
        elegidos = elegidos ?? new List<string>();
        var dias = new SortedSet<DateTime>();
        foreach (var r in rangos)
            for (var d = r.Key.Date; d <= r.Value.Date; d = d.AddDays(1)) dias.Add(d);
        var listaDias = dias.ToList();
        var indice = new Dictionary<DateTime, int>();
        for (int i = 0; i < listaDias.Count; i++) indice[listaDias[i]] = i;

        var nombres = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var enPareto = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in pareto)
        {
            nombres[(string)p["Servicio"]] = (string)p["NombreServicio"];
            enPareto.Add((string)p["Servicio"]);
        }
        // Codigo como lo escribe la base: el parametro puede llegar en otra caja.
        var codigos = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var k in nombres.Keys) codigos[k] = k;
        foreach (var e in elegidos)
        {
            if (codigos.ContainsKey(e)) continue;
            var t = (periodo ?? Enumerable.Empty<ConcentracionTicket>())
                .FirstOrDefault(x => x.Servicio != null && string.Equals(x.Servicio.Trim(), e, StringComparison.OrdinalIgnoreCase));
            var codigo = t != null ? t.Servicio.Trim() : e;
            codigos[e] = codigo;
            nombres[codigo] = t != null && !string.IsNullOrWhiteSpace(t.NombreServicio) ? t.NombreServicio.Trim() : codigo;
        }

        var lineas = elegidos.Count > 0
            ? elegidos.Select(e => codigos[e]).ToList()
            : pareto.Take(top).Select(p => (string)p["Servicio"]).ToList();
        var porServicio = new Dictionary<string, List<HashSet<string>>>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in lineas)
            porServicio[c] = listaDias.Select(_ => new HashSet<string>(StringComparer.OrdinalIgnoreCase)).ToList();

        foreach (var t in filtrados)
        {
            if (t.Servicio == null || !t.Dia.HasValue) continue;
            List<HashSet<string>> serie;
            int i;
            if (!porServicio.TryGetValue(t.Servicio.Trim(), out serie)) continue;
            if (!indice.TryGetValue(t.Dia.Value.Date, out i)) continue;
            serie[i].Add(t.Codigo);
        }

        var totales = new int[listaDias.Count];
        var series = new List<Dictionary<string, object>>();
        foreach (var c in lineas)
        {
            var cuentas = porServicio[c].Select(x => x.Count).ToList();
            for (int i = 0; i < cuentas.Count; i++) totales[i] += cuentas[i];
            series.Add(new Dictionary<string, object>
            {
                { "Servicio", c },
                { "NombreServicio", nombres[c] },
                { "TicketsServicio", cuentas },
                { "Total", cuentas.Sum() },
            });
        }

        var opciones = pareto.Select(p => new Dictionary<string, object>
        {
            { "valor", p["Servicio"] }, { "etiqueta", p["NombreServicio"] }, { "tickets", p["CantidadTickets"] },
        }).ToList();
        foreach (var c in lineas.Where(c => !enPareto.Contains(c)))
            opciones.Add(new Dictionary<string, object> { { "valor", c }, { "etiqueta", nombres[c] }, { "tickets", 0 } });

        return new Dictionary<string, object>
        {
            { "modo", elegidos.Count > 0 ? TendenciaElegidos : TendenciaTop },
            { "elegidos", elegidos.Select(e => codigos[e]).ToList() },
            { "maximo", MaxServiciosTendencia },
            { "dias", listaDias.ConvertAll(Dia) },
            { "series", series },
            { "TicketsTotalDia", totales.ToList() },
            { "servicios", pareto.Count },
            { "opciones", opciones },
        };
    }

    // ------------------------------------------------------------ formatos
    public static string Dia(DateTime d)
    {
        return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    public static string Mes(DateTime d)
    {
        return d.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    }

    private static readonly string[] NombresMes = { "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
        "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre" };
    public static string NombreMes(DateTime d)
    {
        return NombresMes[d.Month - 1] + " " + d.Year.ToString(CultureInfo.InvariantCulture);
    }
}
