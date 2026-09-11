// Consultas del tablero de SLA ejecutadas como texto parametrizado desde el
// handler, en vez de llamar a los procedimientos dbo.usp_Dash_*Multi.
//
// Motivo: los nombres de tecnico (vw_Dash_ProductividadBase.Tecnico, que sale
// de Tickets.TecnicoSegundaLinea) tienen el formato "Apellidos, Nombre", asi
// que SIEMPRE contienen una coma. Los procedimientos parten @Tecnicos con
// dbo.fn_Dash_SplitList, que separa por coma: "Lugo Solis, David" se rompia en
// 'Lugo Solis' y 'David', ninguno de los dos existe como Tecnico y los cinco
// endpoints devolvian cero filas (KPIs en cero y todas las graficas vacias).
// Ningun valor con coma puede sobrevivir a ese split, asi que no hay arreglo
// posible desde el navegador.
//
// Aqui la lista de tecnicos llega separada por '|' (dashboard.js ya la manda
// asi) y cada nombre viaja como su propio parametro dentro de un IN, sin
// separadores de por medio. Los grupos siguen separandose por coma: ningun
// nombre de grupo contiene comas.
//
// Esto NO toca la base de datos: no hace falta ejecutar ningun script ni
// permisos de DDL, solo copiar App_Code y los .ashx al sitio de IIS. ASP.NET
// compila App_Code solo en el primer request.
//
// OJO: mientras esto este activo, la logica de las consultas vive en dos
// sitios (estos textos y los procedimientos usp_Dash_*Multi). Si alguien
// cambia los procedimientos, el tablero no se entera. Si algun dia se ejecuta
// fix_tecnicos_separador_pipe.sql en la base, los handlers pueden volver a
// llamar a los procedimientos y este archivo se borra.
//
// Las consultas partieron como copia literal del cuerpo de los procedimientos
// (mismo campo b.Tecnico, mismo tope de filas). Ya NO lo son en fechas ni en
// SLA: ver SlaPorSolucion y Predicados() mas abajo. La semantica es la de
// 04_dashboard_sla.sql del repo de SQL, pero calculada aqui, sobre las
// columnas que la vista YA expone, sin tocar la base:
//   - el rango filtra por FechaFirmaSolucion (lo que se resolvio), salvo las
//     series de "creados", que van por FechaRegistro;
//   - el veredicto de SLA y las horas de resolucion se miden contra la firma
//     de solucion, no contra la de cierre;
//   - reabierto = IntentosSolucion > 1.
// El tecnico sigue siendo el ASIGNADO (b.Tecnico = TecnicoSegundaLinea): la
// vista no trae FirmaSolucion y no se une a dbo.Tickets para obtenerla.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Data;
using System.Data.SqlClient;
using System.Text;
using System.Web;

public static class DashboardQueries
{
    // ---------------------------------------------------------------------
    // Filtros comunes
    // ---------------------------------------------------------------------

    // Filtros de un request del tablero de SLA, ya listos para inyectarse en
    // una consulta de texto.
    public sealed class Filtros
    {
        public DateTime FechaInicio;
        public DateTime FechaFin;
        public List<string> Grupos = new List<string>();
        public List<string> Tecnicos = new List<string>();

        public static Filtros Desde(HttpRequest request)
        {
            string fi, ff;
            DashboardParams.RangoFechas(request, out fi, out ff);

            var f = new Filtros();
            f.FechaInicio = Fecha(fi);
            f.FechaFin = Fecha(ff);
            f.Grupos = Partir(request.QueryString["grupos"], ',');
            f.Tecnicos = Partir(request.QueryString["tecnicos"], '|');
            return f;
        }
    }

    // Las fechas del tablero viajan siempre como yyyy-MM-dd. Antes se pasaban
    // como texto y las convertia SQL Server; aqui se convierten en el handler,
    // asi que se fuerza la cultura invariante para no depender del idioma del
    // servidor de IIS.
    private static DateTime Fecha(string valor)
    {
        DateTime salida;
        if (DateTime.TryParseExact(valor, "yyyy-MM-dd",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out salida))
            return salida;

        return DateTime.Parse(valor, CultureInfo.InvariantCulture);
    }

    // Parte una lista del query string, recorta espacios y descarta vacios.
    // Equivale a dbo.fn_Dash_SplitList / fn_Dash_SplitListPipe.
    private static List<string> Partir(string lista, char separador)
    {
        var salida = new List<string>();
        if (string.IsNullOrWhiteSpace(lista)) return salida;

        foreach (var parte in lista.Split(separador))
        {
            var valor = parte.Trim();
            if (valor.Length > 0) salida.Add(valor);
        }
        return salida;
    }

    /* Los dos predicados WHERE de las consultas. Devuelve los textos y deja
       los parametros cargados en el comando. Una lista vacia = sin filtro,
       igual que el NULL que recibian los procedimientos.

       {0}, por FECHA DE SOLUCION, es el principal: el rango significa lo que
       el equipo resolvio en el periodo, sin importar cuando entro el ticket.
       {1}, por FECHA DE REGISTRO, solo lo usan las series de "creados": cada
       serie se cuenta por su propia fecha.

       Los IN de grupo y tecnico se arman UNA vez y se reusan en los dos: una
       segunda llamada a EnLista declararia @g0/@t0 otra vez y SqlCommand
       fallaria con "parameter has already been declared". */
    private static void Predicados(SqlCommand cmd, Filtros f,
                                   out string porSolucion, out string porRegistro)
    {
        cmd.Parameters.Add("@FechaInicio", SqlDbType.Date).Value = f.FechaInicio;
        cmd.Parameters.Add("@FechaFin", SqlDbType.Date).Value = f.FechaFin;

        string comunes = EnLista(cmd, "b.Grupo", "g", f.Grupos)
                       + EnLista(cmd, "b.Tecnico", "t", f.Tecnicos);

        porSolucion = "b.FechaFirmaSolucion >= @FechaInicio"
                    + " AND b.FechaFirmaSolucion < DATEADD(DAY, 1, @FechaFin)" + comunes;
        porRegistro = "b.FechaRegistro >= @FechaInicio"
                    + " AND b.FechaRegistro < DATEADD(DAY, 1, @FechaFin)" + comunes;
    }

    /* SLA, horas de resolucion y reabierto, medidos contra la FIRMA DE
       SOLUCION. Es la definicion de 04_dashboard_sla.sql, calculada aqui con
       columnas que la vista ya trae, porque la vista de la base sigue
       midiendo contra la firma de cierre y no se modifica.

       Va como CROSS APPLY con alias s, y las columnas se llaman IGUAL que las
       de la vista a proposito: una referencia sin prefijo seria ambigua y la
       consulta no compilaria, asi que es imposible leer por descuido el
       b.SlaVencido viejo en lugar del s.SlaVencido nuevo.

         SlaEvaluable     hay fecha compromiso (sin las ramas de Caducada,
                          que viene NULL en todo lo resuelto)
         SlaVencido       resuelto despues del compromiso; sin resolver y el
                          compromiso ya paso
         DentroSla        resuelto a tiempo; sin resolver y aun en tiempo
         HorasResolucion  de registro a firma de solucion; NULL si no hay
         EsReabierto      IntentosSolucion > 1 */
    private const string SlaPorSolucion = @"
CROSS APPLY (
    SELECT
        SlaEvaluable = CONVERT(bit, CASE WHEN b.FechaEstimadaResolucion IS NOT NULL THEN 1 ELSE 0 END),
        SlaVencido = CONVERT(bit, CASE
            WHEN b.FechaEstimadaResolucion IS NULL THEN 0
            WHEN b.FechaFirmaSolucion IS NOT NULL
                THEN CASE WHEN b.FechaFirmaSolucion > b.FechaEstimadaResolucion THEN 1 ELSE 0 END
            WHEN SYSDATETIME() > b.FechaEstimadaResolucion THEN 1
            ELSE 0 END),
        DentroSla = CONVERT(bit, CASE
            WHEN b.FechaEstimadaResolucion IS NULL THEN 0
            WHEN b.FechaFirmaSolucion IS NOT NULL
                THEN CASE WHEN b.FechaFirmaSolucion <= b.FechaEstimadaResolucion THEN 1 ELSE 0 END
            WHEN SYSDATETIME() <= b.FechaEstimadaResolucion THEN 1
            ELSE 0 END),
        HorasResolucion = CASE WHEN b.FechaFirmaSolucion IS NOT NULL
            THEN DATEDIFF(MINUTE, b.FechaRegistro, b.FechaFirmaSolucion) / 60.0 END,
        EsReabierto = CONVERT(bit, CASE WHEN b.IntentosSolucion > 1 THEN 1 ELSE 0 END)
) AS s";

    // "AND columna IN (@t0, @t1, ...)" con un parametro por valor: los nombres
    // nunca se concatenan en el SQL, asi que las comas que llevan dentro dan
    // igual y no hay forma de inyectar.
    private static string EnLista(SqlCommand cmd, string columna, string prefijo, List<string> valores)
    {
        if (valores == null || valores.Count == 0) return string.Empty;

        var sb = new StringBuilder();
        sb.Append(" AND ").Append(columna).Append(" IN (");
        for (int i = 0; i < valores.Count; i++)
        {
            var nombre = "@" + prefijo + i;
            if (i > 0) sb.Append(", ");
            sb.Append(nombre);
            cmd.Parameters.Add(nombre, SqlDbType.NVarChar, 4000).Value = valores[i];
        }
        sb.Append(")");
        return sb.ToString();
    }

    // ---------------------------------------------------------------------
    // Ejecucion
    // ---------------------------------------------------------------------

    // Mismo contrato de salida que DashboardDb.EjecutarMultiple (DBNull -> null,
    // DateTime -> ISO 8601) para que el JSON no cambie ni una coma.
    private static List<List<Dictionary<string, object>>> Ejecutar(
        string sql, Filtros f, Action<SqlCommand> extra)
    {
        var resultados = new List<List<Dictionary<string, object>>>();

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand())
        {
            cmd.Connection = cn;
            cmd.CommandType = CommandType.Text;
            // {0} = por fecha de solucion, {1} = por fecha de registro. Una
            // consulta que solo use {0} ignora el segundo sin problema.
            string porSolucion, porRegistro;
            Predicados(cmd, f, out porSolucion, out porRegistro);
            cmd.CommandText = string.Format(sql, porSolucion, porRegistro);
            if (extra != null) extra(cmd);

            cn.Open();
            using (var reader = cmd.ExecuteReader())
            {
                do
                {
                    var filas = new List<Dictionary<string, object>>();
                    while (reader.Read())
                    {
                        var fila = new Dictionary<string, object>();
                        for (int i = 0; i < reader.FieldCount; i++)
                        {
                            object valor = reader.GetValue(i);
                            if (valor is DBNull)
                                valor = null;
                            else if (valor is DateTime)
                                valor = ((DateTime)valor).ToString("yyyy-MM-ddTHH:mm:ss");

                            fila[reader.GetName(i)] = valor;
                        }
                        filas.Add(fila);
                    }
                    resultados.Add(filas);
                } while (reader.NextResult());
            }
        }

        return resultados;
    }

    private static List<Dictionary<string, object>> Unico(
        string sql, Filtros f, Action<SqlCommand> extra)
    {
        var resultados = Ejecutar(sql, f, extra);
        return resultados.Count > 0 ? resultados[0] : new List<Dictionary<string, object>>();
    }

    // ---------------------------------------------------------------------
    // Las cinco consultas ({0} = por solucion, {1} = por registro)
    // ---------------------------------------------------------------------

    /* KPIs. Todo sale de lo RESUELTO en el rango ({0}), salvo TicketsCreados.

       Los campos de siempre se conservan para no romper el tablero, pero con
       el rango por fecha de solucion cambian de significado:
         TicketsTotales   = resueltos en el rango (igual a TicketsResueltos)
         TicketsCerrados  = de esos, los que ya tienen firma de cierre
         TicketsAbiertos  = de esos, los resueltos que aun esperan el cierre */
    public static Dictionary<string, object> Kpis(Filtros f)
    {
        const string sql = @"
;WITH base AS
(
    SELECT
        b.Grupo, b.Tecnico, b.Prioridad, b.EstaCerrado, b.EstaAbierto,
        b.HorasCiclo, b.ReasignacionesGrupo,
        s.SlaEvaluable, s.SlaVencido, s.DentroSla, s.HorasResolucion, s.EsReabierto
    FROM dbo.vw_Dash_ProductividadBase b" + SlaPorSolucion + @"
    WHERE {0}
),
/* Mediana y p90 de las horas de resolucion: la distribucion tiene cola larga
   y el promedio lo decide un punado de tickets de semanas. TOP (1) porque
   PERCENTILE_CONT es de ventana y repite el valor en cada fila. */
pct AS
(
    SELECT TOP (1)
        Mediana = PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY HorasResolucion) OVER (),
        P90     = PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY HorasResolucion) OVER ()
    FROM base
    WHERE HorasResolucion IS NOT NULL
)
SELECT
    FechaInicio = @FechaInicio,
    FechaFin = @FechaFin,
    TicketsTotales = COUNT_BIG(*),
    TicketsResueltos = COUNT_BIG(*),
    -- Lo que entro en el mismo periodo, contado por SU fecha: el balance
    -- contra lo resuelto dice si el backlog crecio.
    TicketsCreados = (SELECT COUNT_BIG(*) FROM dbo.vw_Dash_ProductividadBase b WHERE {1}),
    TicketsCerrados = SUM(CASE WHEN EstaCerrado = 1 THEN 1 ELSE 0 END),
    TicketsAbiertos = SUM(CASE WHEN EstaAbierto = 1 THEN 1 ELSE 0 END),
    TicketsReabiertos = SUM(CASE WHEN EsReabierto = 1 THEN 1 ELSE 0 END),
    ReabiertosPct = CAST(
        100.0 * SUM(CASE WHEN EsReabierto = 1 THEN 1 ELSE 0 END)
        / NULLIF(COUNT_BIG(*), 0) AS DECIMAL(6,2)),
    TicketsSlaEvaluable = SUM(CASE WHEN SlaEvaluable = 1 THEN 1 ELSE 0 END),
    TicketsSlaVencidos = SUM(CASE WHEN SlaVencido = 1 THEN 1 ELSE 0 END),
    TicketsDentroSla = SUM(CASE WHEN DentroSla = 1 THEN 1 ELSE 0 END),
    CumplimientoSlaPct = CAST(
        100.0 * SUM(CASE WHEN SlaEvaluable = 1 AND DentroSla = 1 THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN SlaEvaluable = 1 THEN 1 ELSE 0 END), 0)
        AS DECIMAL(6,2)
    ),
    GruposActivos = COUNT(DISTINCT Grupo),
    TecnicosActivos = COUNT(DISTINCT Tecnico),
    HorasResolucionPromedio = CAST(AVG(HorasResolucion) AS DECIMAL(18,2)),
    -- Subconsultas y no JOIN contra pct: si nada tiene horas, pct no trae
    -- filas y un CROSS JOIN dejaria el tablero sin KPIs.
    HorasResolucionMediana = (SELECT TOP (1) CAST(Mediana AS DECIMAL(18,2)) FROM pct),
    HorasResolucionP90     = (SELECT TOP (1) CAST(P90     AS DECIMAL(18,2)) FROM pct),
    HorasCicloPromedio = CAST(AVG(HorasCiclo) AS DECIMAL(18,2)),
    ReasignacionesPromedio = CAST(AVG(CAST(ReasignacionesGrupo AS DECIMAL(18,2))) AS DECIMAL(18,2)),
    TicketsAltaPrioridad = SUM(CASE WHEN Prioridad IN (N'Alta', N'Crítica', N'Critica', N'Urgente') THEN 1 ELSE 0 END),
    -- Fin del ultimo ETL de tickets, para el sello del encabezado. dbo.EtlLog
    -- guarda la hora en UTC; se convierte a hora local de Mexico aqui para que
    -- el navegador solo tenga que formatearla (AT TIME ZONE: SQL Server 2016+).
    UltimaActualizacionEtl = (
        SELECT CAST(
            MAX(l.Fin) AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time (Mexico)'
            AS DATETIME2(0))
        FROM dbo.EtlLog l
        WHERE l.Proceso = N'Proactivanet tickets'
    )
FROM base;";

        var filas = Unico(sql, f, null);
        return filas.Count > 0 ? filas[0] : new Dictionary<string, object>();
    }

    /* Entra vs sale, por dia. Cada serie por su propia fecha: creados por
       registro ({1}), resueltos y SLA por solucion ({0}). FULL OUTER porque
       hay dias con solo entradas o solo salidas.

       TicketsCerrados se conserva para el tablero actual y ahora ES la serie
       de resueltos del dia (mismo valor que TicketsResueltos). Evaluable y
       dentro van como conteos, no como porcentaje: el tablero agrupa por dia,
       mes o SLOT, y un porcentaje diario no se puede promediar. */
    public static List<Dictionary<string, object>> Tendencia(Filtros f)
    {
        const string sql = @"
;WITH cre AS
(
    SELECT Fecha = b.FechaRegistroDia, TicketsCreados = COUNT_BIG(*)
    FROM dbo.vw_Dash_ProductividadBase b
    WHERE {1}
    GROUP BY b.FechaRegistroDia
),
res AS
(
    SELECT
        Fecha = CONVERT(DATE, b.FechaFirmaSolucion),
        TicketsResueltos    = COUNT_BIG(*),
        TicketsSlaVencidos  = SUM(CASE WHEN s.SlaVencido = 1 THEN 1 ELSE 0 END),
        TicketsSlaEvaluable = SUM(CASE WHEN s.SlaEvaluable = 1 THEN 1 ELSE 0 END),
        TicketsDentroSla    = SUM(CASE WHEN s.SlaEvaluable = 1 AND s.DentroSla = 1 THEN 1 ELSE 0 END),
        TicketsReabiertos   = SUM(CASE WHEN s.EsReabierto = 1 THEN 1 ELSE 0 END)
    FROM dbo.vw_Dash_ProductividadBase b" + SlaPorSolucion + @"
    WHERE {0}
    GROUP BY CONVERT(DATE, b.FechaFirmaSolucion)
)
SELECT
    Fecha               = COALESCE(c.Fecha, r.Fecha),
    TicketsCreados      = ISNULL(c.TicketsCreados, 0),
    TicketsCerrados     = ISNULL(r.TicketsResueltos, 0),
    TicketsResueltos    = ISNULL(r.TicketsResueltos, 0),
    TicketsSlaVencidos  = ISNULL(r.TicketsSlaVencidos, 0),
    TicketsSlaEvaluable = ISNULL(r.TicketsSlaEvaluable, 0),
    TicketsDentroSla    = ISNULL(r.TicketsDentroSla, 0),
    TicketsReabiertos   = ISNULL(r.TicketsReabiertos, 0)
FROM cre AS c
FULL OUTER JOIN res AS r ON r.Fecha = c.Fecha
ORDER BY COALESCE(c.Fecha, r.Fecha);";

        return Unico(sql, f, null);
    }

    /* Productividad por tecnico (asignado) sobre lo RESUELTO en el rango.

       Se conservan todas las columnas que pinta la barra de tres tramos. Con
       el rango por solucion, TicketsTotales = resueltos, TicketsCerrados =
       resueltos ya cerrados y TicketsAbiertos = resueltos que esperan el
       cierre; los *SlaVencidos usan el veredicto contra la solucion.

       Nuevas, aditivas: TicketsResueltos, TicketsDentroSla,
       TicketsSinSlaEvaluable -las tres parten TicketsResueltos exacto:
       dentro + vencidos + sin evaluable- y TicketsReabiertos. */
    public static List<Dictionary<string, object>> Productividad(Filtros f)
    {
        const string sql = @"
SELECT
    b.Tecnico,
    Grupo = MAX(b.Grupo),
    TicketsTotales = COUNT_BIG(*),
    TicketsResueltos = COUNT_BIG(*),
    TicketsCerrados = SUM(CASE WHEN b.EstaCerrado = 1 THEN 1 ELSE 0 END),
    TicketsAbiertos = SUM(CASE WHEN b.EstaAbierto = 1 THEN 1 ELSE 0 END),
    TicketsSlaVencidos = SUM(CASE WHEN s.SlaVencido = 1 THEN 1 ELSE 0 END),
    TicketsCerradosSlaVencidos = SUM(CASE WHEN b.EstaCerrado = 1 AND s.SlaVencido = 1 THEN 1 ELSE 0 END),
    TicketsAbiertosSlaVencidos = SUM(CASE WHEN b.EstaAbierto = 1 AND s.SlaVencido = 1 THEN 1 ELSE 0 END),
    TicketsDentroSla = SUM(CASE WHEN s.SlaEvaluable = 1 AND s.DentroSla = 1 THEN 1 ELSE 0 END),
    TicketsSinSlaEvaluable = SUM(CASE WHEN s.SlaEvaluable = 0 THEN 1 ELSE 0 END),
    TicketsReabiertos = SUM(CASE WHEN s.EsReabierto = 1 THEN 1 ELSE 0 END),
    CumplimientoSlaPct = CAST(
        100.0 * SUM(CASE WHEN s.SlaEvaluable = 1 AND s.DentroSla = 1 THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN s.SlaEvaluable = 1 THEN 1 ELSE 0 END), 0)
        AS DECIMAL(6,2)
    ),
    HorasResolucionPromedio = CAST(AVG(s.HorasResolucion) AS DECIMAL(18,2))
FROM dbo.vw_Dash_ProductividadBase b" + SlaPorSolucion + @"
WHERE {0}
GROUP BY b.Tecnico
ORDER BY TicketsTotales DESC, b.Tecnico;";

        return Unico(sql, f, null);
    }

    /* Tres result sets sobre lo RESUELTO en el rango, materializado una vez,
       en el orden en que los lee distribucion.ashx:
         [0] prioridad
         [1] vencidos por grupo (top 12, solo grupos con algun vencido)
         [2] reabiertos por grupo (top 12 por %, minimo 50 resueltos: con
             menos, el porcentaje es ruido)
       Eran cinco: estado y aging se quitaron con sus graficas -eran la foto
       de hoy, que contesta el Backlog-. */
    public static List<List<Dictionary<string, object>>> Distribucion(Filtros f)
    {
        const string sql = @"
SET NOCOUNT ON;

SELECT
    b.Grupo,
    b.Prioridad,
    s.SlaEvaluable,
    s.SlaVencido,
    s.DentroSla,
    s.EsReabierto
INTO #DistribucionBase
FROM dbo.vw_Dash_ProductividadBase b" + SlaPorSolucion + @"
WHERE {0};

SELECT
    Valor = ISNULL(NULLIF(LTRIM(RTRIM(Prioridad)), N''), N'Sin prioridad'),
    Tickets = COUNT_BIG(*)
FROM #DistribucionBase
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(Prioridad)), N''), N'Sin prioridad')
ORDER BY Tickets DESC;

SELECT TOP (12)
    Valor      = ISNULL(NULLIF(LTRIM(RTRIM(Grupo)), N''), N'Sin grupo'),
    Vencidos   = SUM(CASE WHEN SlaVencido = 1 THEN 1 ELSE 0 END),
    Evaluables = SUM(CASE WHEN SlaEvaluable = 1 THEN 1 ELSE 0 END),
    -- El porcentaje junto al volumen: un grupo chico con 8 de 10 vencidos
    -- esta peor que uno grande con 50 de 5,000.
    CumplimientoPct = CAST(
        100.0 * SUM(CASE WHEN SlaEvaluable = 1 AND DentroSla = 1 THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN SlaEvaluable = 1 THEN 1 ELSE 0 END), 0)
        AS DECIMAL(6,2))
FROM #DistribucionBase
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(Grupo)), N''), N'Sin grupo')
HAVING SUM(CASE WHEN SlaVencido = 1 THEN 1 ELSE 0 END) > 0
ORDER BY Vencidos DESC;

SELECT TOP (12)
    Valor      = ISNULL(NULLIF(LTRIM(RTRIM(Grupo)), N''), N'Sin grupo'),
    Resueltos  = COUNT_BIG(*),
    Reabiertos = SUM(CASE WHEN EsReabierto = 1 THEN 1 ELSE 0 END),
    ReabiertosPct = CAST(
        100.0 * SUM(CASE WHEN EsReabierto = 1 THEN 1 ELSE 0 END)
        / NULLIF(COUNT_BIG(*), 0) AS DECIMAL(6,2))
FROM #DistribucionBase
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(Grupo)), N''), N'Sin grupo')
HAVING COUNT_BIG(*) >= 50
   AND SUM(CASE WHEN EsReabierto = 1 THEN 1 ELSE 0 END) > 0
ORDER BY ReabiertosPct DESC;

DROP TABLE #DistribucionBase;";

        // SELECT ... INTO no abre result set en el reader, asi que los tres
        // que salen son prioridad, vencidos y reabiertos.
        return Ejecutar(sql, f, null);
    }

    /* Detalle de lo RESUELTO en el rango, con el mismo tope de filas.
       SlaVencido, DentroSla y HorasResolucion mantienen nombre pero ya salen
       contra la firma de solucion. Nuevas, aditivas: FechaFirmaSolucion (el
       cross-filter la necesita para reagrupar por la fecha que filtra),
       TecnicoAsignado, IntentosSolucion y EsReabierto. Orden por solucion:
       arriba lo recien resuelto. */
    public static List<Dictionary<string, object>> Detalle(Filtros f, int top)
    {
        const string sql = @"
SELECT TOP (@TopSeguro)
    b.CodigoTicket,
    b.FechaRegistro,
    b.FechaFirmaSolucion,
    b.Grupo,
    b.Tecnico,
    TecnicoAsignado = ISNULL(NULLIF(LTRIM(RTRIM(b.TecnicoSegundaLinea)), N''), N'Sin asignar'),
    b.Estado,
    b.Subestado,
    b.Prioridad,
    b.Tipo,
    b.SLA,
    b.Categoria,
    b.Titulo,
    b.FechaEstimadaResolucion,
    b.FechaFirmaCierre,
    b.Caducada,
    s.SlaVencido,
    s.DentroSla,
    HorasResolucion = CAST(s.HorasResolucion AS DECIMAL(18,2)),
    HorasAbierto = CAST(b.HorasAbierto AS DECIMAL(18,2)),
    b.AgingBucket,
    b.ReasignacionesGrupo,
    b.IntentosSolucion,
    s.EsReabierto,
    b.Tienda
FROM dbo.vw_Dash_ProductividadBase b" + SlaPorSolucion + @"
WHERE {0}
ORDER BY b.FechaFirmaSolucion DESC;";

        int topSeguro = (top <= 0) ? 500 : (top > 5000 ? 5000 : top);
        return Unico(sql, f, delegate(SqlCommand cmd)
        {
            cmd.Parameters.Add("@TopSeguro", SqlDbType.Int).Value = topSeguro;
        });
    }

    // ---------------------------------------------------------------------
    // Catalogo propio del Call Center
    // ---------------------------------------------------------------------

    // Los grupos que atienden telefono. Es el mismo par que ya usaba
    // carga_combinada.ashx como valor por omision de su parametro @Grupos:
    // fuera de estos dos no hay nadie que conteste llamadas, asi que la
    // pestana de Call Center no tiene por que ofrecer el resto.
    //
    // El nombre viaja tal cual esta escrito en vw_Dash_ProductividadBase.Grupo
    // porque es el mismo texto que llena las <option> del filtro: si aqui se
    // escribiera distinto, el valor seleccionado no casaria con el catalogo.
    public static readonly string[] GruposCallCenter = { "Service Desk", "End User" };

    /* Grupos y tecnicos del Call Center, para acotar los dos <select> cuando
       la barra de filtros esta en esa pestana.

       Va APARTE de dbo.usp_Dash_Catalogos -que sigue sirviendo las listas
       completas del tablero de SLA, sin tocar- y sale de la misma vista que
       el resto de las consultas de este archivo, asi que la relacion
       tecnico -> grupo es la que ya existe en los datos: no hay ninguna lista
       de nombres escrita a mano.

       Sin filtro de fechas, igual que el catalogo de SLA: la lista de un
       filtro no puede encogerse por el rango que el usuario tenga puesto, o
       el tecnico que eligio desapareceria al mover una fecha.

       Los grupos se devuelven leidos de la vista y no desde la constante para
       que salgan con la grafia y el espaciado exactos con que estan grabados
       -el IN los encuentra igual, la colacion del servidor no distingue
       mayusculas- y para que un grupo que no exista en los datos no aparezca
       en el desplegable. */
    public static Dictionary<string, object> CatalogosCallCenter()
    {
        const string sql = @"
SELECT DISTINCT Grupo
FROM dbo.vw_Dash_ProductividadBase
WHERE Grupo IN ({0})
ORDER BY Grupo;

SELECT DISTINCT Tecnico
FROM dbo.vw_Dash_ProductividadBase
WHERE Tecnico IS NOT NULL AND LTRIM(RTRIM(Tecnico)) <> N''
  AND Grupo IN ({0})
ORDER BY Tecnico;";

        var resultados = new List<List<Dictionary<string, object>>>();

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand())
        {
            // Un parametro por grupo, como en EnLista(): los nombres no se
            // concatenan nunca dentro del SQL.
            var marcas = new StringBuilder();
            for (int i = 0; i < GruposCallCenter.Length; i++)
            {
                var nombre = "@gcc" + i;
                if (i > 0) marcas.Append(", ");
                marcas.Append(nombre);
                cmd.Parameters.Add(nombre, SqlDbType.NVarChar, 4000).Value = GruposCallCenter[i];
            }

            cmd.Connection = cn;
            cmd.CommandType = CommandType.Text;
            cmd.CommandText = string.Format(sql, marcas.ToString());

            cn.Open();
            using (var reader = cmd.ExecuteReader())
            {
                do
                {
                    var filas = new List<Dictionary<string, object>>();
                    while (reader.Read())
                    {
                        var fila = new Dictionary<string, object>();
                        for (int i = 0; i < reader.FieldCount; i++)
                        {
                            object valor = reader.GetValue(i);
                            fila[reader.GetName(i)] = (valor is DBNull) ? null : valor;
                        }
                        filas.Add(fila);
                    }
                    resultados.Add(filas);
                } while (reader.NextResult());
            }
        }

        return new Dictionary<string, object>
        {
            { "grupos",   Columna(resultados, 0) },
            { "tecnicos", Columna(resultados, 1) },
        };
    }

    // Aplana un result set de una sola columna a ["valor", "valor", ...].
    private static List<object> Columna(
        List<List<Dictionary<string, object>>> resultados, int indice)
    {
        var salida = new List<object>();
        if (resultados == null || indice < 0 || indice >= resultados.Count) return salida;

        foreach (var fila in resultados[indice])
        {
            foreach (var valor in fila.Values)
            {
                if (valor != null) salida.Add(valor);
                break;
            }
        }
        return salida;
    }
}
