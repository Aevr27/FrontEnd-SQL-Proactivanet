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
//   Los dos filtros se aplican a las TRES graficas.

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
       primer registro de la base no sirve (en QA hay tickets sueltos del
       2025-10-09 y 2025-10-21 aunque la historia empieza el 2025-11-19). Se
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
