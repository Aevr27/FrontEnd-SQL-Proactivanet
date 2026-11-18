/* =========================================================================
   sql/diag/DIAG_Concentracion_CoberturaDiaria.sql
   Cobertura diaria de la historia de tickets (pestaña "Vista general de
   servicios", grafica "Servicios con mayor cambio de tickets").

   PARA QUE
     Antes de implementar la ventana maxima comparable hay que saber, con los
     datos de QA y sin suponer ninguna fecha:
       - el primer y el ultimo dia con tickets;
       - los dias sin ningun ticket y si forman huecos dentro de la historia;
       - los dias con volumen anormalmente bajo (posible carga a medias);
       - si un dia en cero coincide con un feriado (posible cero legitimo) o
         si vw_Tickets si tiene tickets ese dia (el hueco seria del mapeo de
         servicio, no de la carga).
     La pestaña mide la cobertura sobre dbo.vw_ServicioTickets por
     FechaRegistroDia, con todos los tickets (antes de Service Owner y
     Grupo); este diagnostico usa la misma fuente y el mismo dia.

   ES DE SOLO LECTURA
     - Solo SELECT. No hay DDL ni DML de ningun tipo: ni CREATE / ALTER /
       DROP, ni INSERT / UPDATE / DELETE / MERGE, ni tablas temporales ni
       variables de tabla, ni EXEC de procedimientos, ni SQL dinamico.
     - Las unicas variables son escalares (DECLARE / SELECT @x = ...).
     - Por eso los CTE de dias se repiten en cada consulta: sin tablas
       auxiliares, cada grilla vuelve a leer el rango (ver "TIEMPO").

   COMO CORRERLO (SSMS)
     1. Conectar a AZVMBDCENTRALQA. La base la pone el USE de abajo.
     2. Query > Results To > Results to Grid (Ctrl+D).
     3. Pegar el script completo en una ventana nueva y F5 sin seleccionar
        nada (un solo lote, sin GO).
     4. Cada grilla trae en su primera columna "Seccion" su codigo:
          0  Contexto (servidor, base, hoy en Mexico, rango analizado)
          1  Resumen: primer/ultimo dia, dias sin tickets, dias bajos,
             inicio de la historia continua y ventana maxima (informativa)
          2  Tramos: bloques seguidos CON y SIN tickets (los huecos)
          3  Dias a revisar: sin tickets, muy bajos, bajos y feriados
          4  Diario completo, un renglon por dia
          5  Por mes
          6  Por dia de la semana (la referencia de "bajo")
          7  Consistencia de las vistas (fechas nulas, FechaRegistroDia vs
             FechaRegistro, filas vs tickets distintos, fechas futuras)
     5. Para devolver resultados: clic derecho en la grilla > Save Results
        As... (CSV), o copiar con encabezados (Ctrl+Shift+C). Lo minimo
        util: secciones 0, 1, 2, 3 y 7 completas.

   TIEMPO
     Lee dbo.vw_ServicioTickets (rango) unas 7 veces y la vista completa 1
     vez, y dbo.vw_Tickets otras tantas. Esperar del orden de segundos a un
     par de minutos segun la carga de QA. Si tarda demasiado, se puede
     cancelar sin efecto alguno (no escribe nada).
     El calendario sale de una tabla de numeros fija (0..999, VALUES), no de
     un CTE recursivo: el recursivo se estima en 1 fila y el plan vuelve a
     agregar la vista por cada dia (minutos en una replica con 120 mil
     filas). 999 dias alcanzan: el rango nunca pasa de 2 años.

   PARAMETROS (abajo)
     @DesdeMinimo   = 2025-08-01. El rango empieza ahi, o antes si la vista
                      tiene tickets anteriores (hasta 2 años atras), para
                      ver tickets sueltos previos a la historia continua.
     @UmbralMuyBajo = 0.25 y @UmbralBajo = 0.50: fraccion del promedio de
                      los mismos dias de la semana vecinos (4 antes y 4
                      despues, solo dias con tickets, sin el propio dia).

   QUE NO PUEDE DECIR
     Ni las vistas ni este script distinguen con certeza un dia real sin
     tickets de un dia que el ETL no cargo. La seccion 3 junta las pistas
     (feriado de referencia, vw_Tickets con o sin filas, horas cubiertas,
     volumen del mismo dia de la semana); la decision es de quien revisa.
     La lista de feriados es una referencia (LFT + dias de asueto comunes),
     no el calendario verificado de la empresa.
   ========================================================================= */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

DECLARE @DesdeMinimo   DATE          = '20250801';
DECLARE @UmbralMuyBajo DECIMAL(4, 2) = 0.25;
DECLARE @UmbralBajo    DECIMAL(4, 2) = 0.50;

-- Hoy de Mexico como lo calcula la vista: DATEADD(HOUR, -6, SYSUTCDATETIME()).
DECLARE @HoyMx  DATE = CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()));
DECLARE @Manana DATE = DATEADD(DAY, 1, @HoyMx);

/* -------------------------------------------------------------------------
   Lectura unica de las vistas completas (sin filtro de fecha): extremos y
   consistencia. Solo asignacion a variables escalares.
   ------------------------------------------------------------------------- */
DECLARE @SrvPrimerDia DATE, @SrvUltimoDia DATE, @SrvFilas BIGINT, @SrvTickets BIGINT,
        @SrvFechaNula BIGINT, @SrvDiaNulo BIGINT, @SrvDiaDistinto BIGINT, @SrvFuturas BIGINT,
        @SrvPrimerRegistro DATETIME2(0), @SrvUltimoRegistro DATETIME2(0);

SELECT @SrvPrimerDia      = MIN(CONVERT(DATE, v.FechaRegistroDia)),
       @SrvUltimoDia      = MAX(CONVERT(DATE, v.FechaRegistroDia)),
       @SrvPrimerRegistro = MIN(v.FechaRegistro),
       @SrvUltimoRegistro = MAX(v.FechaRegistro),
       @SrvFilas          = COUNT_BIG(*),
       @SrvTickets        = COUNT_BIG(DISTINCT v.CodigoTicket),
       @SrvFechaNula      = SUM(CASE WHEN v.FechaRegistro IS NULL THEN 1 ELSE 0 END),
       @SrvDiaNulo        = SUM(CASE WHEN v.FechaRegistroDia IS NULL THEN 1 ELSE 0 END),
       @SrvDiaDistinto    = SUM(CASE WHEN CONVERT(DATE, v.FechaRegistro) <> CONVERT(DATE, v.FechaRegistroDia) THEN 1 ELSE 0 END),
       @SrvFuturas        = SUM(CASE WHEN v.FechaRegistro >= @Manana THEN 1 ELSE 0 END)
FROM dbo.vw_ServicioTickets AS v;

DECLARE @TkPrimerDia DATE, @TkUltimoDia DATE, @TkFilas BIGINT, @TkFechaNula BIGINT;
SELECT @TkPrimerDia = MIN(CONVERT(DATE, t.FechaRegistro)),
       @TkUltimoDia = MAX(CONVERT(DATE, t.FechaRegistro)),
       @TkFilas     = COUNT_BIG(*),
       @TkFechaNula = SUM(CASE WHEN t.FechaRegistro IS NULL THEN 1 ELSE 0 END)
FROM dbo.vw_Tickets AS t;

-- Rango: desde @DesdeMinimo, o desde el primer ticket si es anterior, pero
-- nunca mas de 2 años atras (un ticket con fecha basura no infla la grilla).
DECLARE @Desde DATE = CASE WHEN @SrvPrimerDia IS NOT NULL AND @SrvPrimerDia < @DesdeMinimo
                           THEN @SrvPrimerDia ELSE @DesdeMinimo END;
IF @Desde < DATEADD(YEAR, -2, @HoyMx) SET @Desde = DATEADD(YEAR, -2, @HoyMx);

/* -------------------------------------------------------------------------
   0) Contexto
   ------------------------------------------------------------------------- */
SELECT Seccion       = '0 Contexto',
       Servidor      = @@SERVERNAME,
       Base          = DB_NAME(),
       Cuenta        = SUSER_SNAME(),
       Version       = CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(20)),
       HoraServidor  = CONVERT(VARCHAR(19), SYSDATETIME(), 120),
       HoraUtc       = CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120),
       HoyMexico     = CONVERT(VARCHAR(10), @HoyMx, 120),
       RangoDesde    = CONVERT(VARCHAR(10), @Desde, 120),
       RangoHasta    = CONVERT(VARCHAR(10), @HoyMx, 120),
       Nota          = 'Hoy (dia en curso) sale en las grillas pero no cuenta como hueco ni como dia bajo.';

/* -------------------------------------------------------------------------
   1) Resumen
   InicioHistoriaContinua = dia siguiente al ULTIMO dia sin tickets antes de
   hoy (si no hay ninguno en el rango, la historia continua empieza en o
   antes de RangoDesde). InicioSinDiaFrontera = un dia despues (el primer dia
   tras un hueco puede ser una carga a medias). Las variantes "...SiBajos..."
   tratan tambien los dias MUY BAJOS como hueco. VentanaMaxima* = la regla
   aprobada (mitad de los dias cubiertos hasta hoy, a semanas completas,
   minimo 28), SOLO INFORMATIVA: no es lo que hace hoy la grafica.
   ------------------------------------------------------------------------- */
WITH Cal AS (
    SELECT d = DATEADD(DAY, n.i, @Desde)
    FROM (SELECT i = a.i * 100 + b.i * 10 + c.i
          FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS a (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS b (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS c (i)) AS n
    WHERE n.i <= DATEDIFF(DAY, @Desde, @HoyMx)
), Srv AS (
    SELECT d = CONVERT(DATE, v.FechaRegistroDia), Tickets = COUNT(DISTINCT v.CodigoTicket)
    FROM dbo.vw_ServicioTickets AS v
    WHERE v.FechaRegistro >= @Desde AND v.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, v.FechaRegistroDia)
), Dia AS (
    SELECT c.d, Dow = DATEDIFF(DAY, '19000101', c.d) % 7, Tickets = ISNULL(s.Tickets, 0)
    FROM Cal AS c LEFT JOIN Srv AS s ON s.d = c.d
), Ref AS (
    SELECT d, Tickets,
           SumaVecinos = SUM(CASE WHEN Tickets > 0 AND d < @HoyMx THEN Tickets END)
                         OVER (PARTITION BY Dow ORDER BY d ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING),
           CuentaVecinos = COUNT(CASE WHEN Tickets > 0 AND d < @HoyMx THEN 1 END)
                         OVER (PARTITION BY Dow ORDER BY d ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
    FROM Dia
), Marca AS (
    SELECT d, Tickets,
           Referencia = CAST(ISNULL(SumaVecinos, 0) - CASE WHEN Tickets > 0 AND d < @HoyMx THEN Tickets ELSE 0 END AS DECIMAL(18, 2))
                        / NULLIF(CuentaVecinos - CASE WHEN Tickets > 0 AND d < @HoyMx THEN 1 ELSE 0 END, 0)
    FROM Ref
), Agg AS (
    SELECT DiasAnalizados = SUM(CASE WHEN d < @HoyMx THEN 1 ELSE 0 END),
           DiasConTickets = SUM(CASE WHEN d < @HoyMx AND Tickets > 0 THEN 1 ELSE 0 END),
           DiasSinTickets = SUM(CASE WHEN d < @HoyMx AND Tickets = 0 THEN 1 ELSE 0 END),
           DiasMuyBajos   = SUM(CASE WHEN d < @HoyMx AND Tickets > 0 AND Tickets < @UmbralMuyBajo * Referencia THEN 1 ELSE 0 END),
           DiasBajos      = SUM(CASE WHEN d < @HoyMx AND Tickets > 0 AND Tickets >= @UmbralMuyBajo * Referencia
                                                      AND Tickets < @UmbralBajo * Referencia THEN 1 ELSE 0 END),
           PrimerDiaConTickets = MIN(CASE WHEN Tickets > 0 THEN d END),
           UltimoDiaConTickets = MAX(CASE WHEN Tickets > 0 THEN d END),
           UltimoDiaSinTickets = MAX(CASE WHEN d < @HoyMx AND Tickets = 0 THEN d END),
           UltimoDiaSinOMuyBajo = MAX(CASE WHEN d < @HoyMx AND (Tickets = 0 OR Tickets < @UmbralMuyBajo * Referencia) THEN d END),
           TicketsRango = SUM(CAST(Tickets AS BIGINT))
    FROM Marca
), Ini AS (
    SELECT a.*,
           Inicio       = CASE WHEN a.UltimoDiaSinTickets  IS NULL THEN @Desde ELSE DATEADD(DAY, 1, a.UltimoDiaSinTickets) END,
           InicioBajos  = CASE WHEN a.UltimoDiaSinOMuyBajo IS NULL THEN @Desde ELSE DATEADD(DAY, 1, a.UltimoDiaSinOMuyBajo) END
    FROM Agg AS a
), Ven AS (
    SELECT i.*,
           InicioFrontera      = CASE WHEN i.UltimoDiaSinTickets  IS NULL THEN i.Inicio      ELSE DATEADD(DAY, 1, i.Inicio) END,
           InicioBajosFrontera = CASE WHEN i.UltimoDiaSinOMuyBajo IS NULL THEN i.InicioBajos ELSE DATEADD(DAY, 1, i.InicioBajos) END
    FROM Ini AS i
)
SELECT Seccion = '1 Resumen',
       PrimerDiaVista_ServicioTickets = CONVERT(VARCHAR(10), @SrvPrimerDia, 120),
       UltimoDiaVista_ServicioTickets = CONVERT(VARCHAR(10), @SrvUltimoDia, 120),
       PrimerDiaVista_Tickets         = CONVERT(VARCHAR(10), @TkPrimerDia, 120),
       UltimoDiaVista_Tickets         = CONVERT(VARCHAR(10), @TkUltimoDia, 120),
       PrimerDiaConTicketsEnRango     = CONVERT(VARCHAR(10), PrimerDiaConTickets, 120),
       UltimoDiaConTicketsEnRango     = CONVERT(VARCHAR(10), UltimoDiaConTickets, 120),
       DiasAnalizados_SinHoy          = DiasAnalizados,
       DiasConTickets, DiasSinTickets, DiasMuyBajos, DiasBajos, TicketsRango,
       UltimoDiaSinTickets            = CONVERT(VARCHAR(10), UltimoDiaSinTickets, 120),
       InicioHistoriaContinua         = CONVERT(VARCHAR(10), Inicio, 120)
                                        + CASE WHEN UltimoDiaSinTickets IS NULL THEN ' (o antes: sin huecos en el rango)' ELSE '' END,
       InicioSinDiaFrontera           = CONVERT(VARCHAR(10), InicioFrontera, 120),
       DiasCubiertosHastaHoy          = DATEDIFF(DAY, InicioFrontera, @HoyMx) + 1,
       VentanaMaxima_Informativa      = CASE WHEN ((DATEDIFF(DAY, InicioFrontera, @HoyMx) + 1) / 2) / 7 * 7 >= 28
                                             THEN ((DATEDIFF(DAY, InicioFrontera, @HoyMx) + 1) / 2) / 7 * 7 END,
       InicioSiBajosCuentanComoHueco  = CONVERT(VARCHAR(10), InicioBajosFrontera, 120),
       VentanaMaxima_SiBajosCuentan   = CASE WHEN ((DATEDIFF(DAY, InicioBajosFrontera, @HoyMx) + 1) / 2) / 7 * 7 >= 28
                                             THEN ((DATEDIFF(DAY, InicioBajosFrontera, @HoyMx) + 1) / 2) / 7 * 7 END
FROM Ven;

/* -------------------------------------------------------------------------
   2) Tramos: bloques seguidos de dias CON tickets y SIN tickets (sin hoy).
   Un tramo SIN TICKETS entre dos CON TICKETS es un hueco dentro de la
   historia. FeriadosEnTramo cuenta los feriados de referencia que caen en
   el tramo (un hueco de 1 dia que es feriado puede ser un cero legitimo).
   ------------------------------------------------------------------------- */
WITH Cal AS (
    SELECT d = DATEADD(DAY, n.i, @Desde)
    FROM (SELECT i = a.i * 100 + b.i * 10 + c.i
          FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS a (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS b (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS c (i)) AS n
    WHERE n.i <= DATEDIFF(DAY, @Desde, @HoyMx)
), Feriado AS (
    SELECT d = CONVERT(DATE, f.d, 112), f.Nombre FROM (VALUES
        ('20250101', N'Año Nuevo'), ('20250203', N'Constitución (LFT)'), ('20250317', N'Natalicio de Juárez (LFT)'),
        ('20250417', N'Jueves Santo (asueto común)'), ('20250418', N'Viernes Santo (asueto común)'),
        ('20250501', N'Día del Trabajo'), ('20250916', N'Independencia'), ('20251102', N'Día de Muertos (asueto común)'),
        ('20251117', N'Revolución (LFT)'), ('20251212', N'Virgen de Guadalupe (asueto común)'),
        ('20251224', N'Nochebuena (asueto común)'), ('20251225', N'Navidad'), ('20251231', N'Fin de año (asueto común)'),
        ('20260101', N'Año Nuevo'), ('20260202', N'Constitución (LFT)'), ('20260316', N'Natalicio de Juárez (LFT)'),
        ('20260402', N'Jueves Santo (asueto común)'), ('20260403', N'Viernes Santo (asueto común)'),
        ('20260501', N'Día del Trabajo'), ('20260916', N'Independencia'), ('20261102', N'Día de Muertos (asueto común)'),
        ('20261116', N'Revolución (LFT)')
    ) AS f (d, Nombre)
), Srv AS (
    SELECT d = CONVERT(DATE, v.FechaRegistroDia), Tickets = COUNT(DISTINCT v.CodigoTicket)
    FROM dbo.vw_ServicioTickets AS v
    WHERE v.FechaRegistro >= @Desde AND v.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, v.FechaRegistroDia)
), Dia AS (
    SELECT c.d, Tickets = ISNULL(s.Tickets, 0), ConTickets = CASE WHEN s.Tickets > 0 THEN 1 ELSE 0 END,
           EsFeriado = CASE WHEN fe.d IS NULL THEN 0 ELSE 1 END
    FROM Cal AS c
    LEFT JOIN Srv AS s ON s.d = c.d
    LEFT JOIN Feriado AS fe ON fe.d = c.d
    WHERE c.d < @HoyMx
), Isla AS (
    SELECT *, Grupo = ROW_NUMBER() OVER (ORDER BY d) - ROW_NUMBER() OVER (PARTITION BY ConTickets ORDER BY d)
    FROM Dia
), Tramo AS (
    SELECT ConTickets, Desde = MIN(d), Hasta = MAX(d), Dias = COUNT(*),
           Tickets = SUM(CAST(Tickets AS BIGINT)), FeriadosEnTramo = SUM(EsFeriado)
    FROM Isla
    GROUP BY ConTickets, Grupo
)
SELECT Seccion = '2 Tramos',
       Tipo    = CASE WHEN ConTickets = 1 THEN 'CON TICKETS'
                      WHEN Desde > (SELECT MIN(Desde) FROM Tramo WHERE ConTickets = 1)
                       AND Hasta < (SELECT MAX(Hasta) FROM Tramo WHERE ConTickets = 1) THEN 'HUECO (sin tickets dentro de la historia)'
                      ELSE 'SIN TICKETS (fuera de la historia)' END,
       Desde   = CONVERT(VARCHAR(10), Desde, 120),
       Hasta   = CONVERT(VARCHAR(10), Hasta, 120),
       Dias, Tickets,
       PromedioPorDia = CASE WHEN ConTickets = 1 THEN CAST(1.0 * Tickets / Dias AS DECIMAL(10, 1)) END,
       FeriadosEnTramo
FROM Tramo
ORDER BY Desde;

/* -------------------------------------------------------------------------
   3) Dias a revisar: sin tickets, muy bajos, bajos, y todos los feriados de
   referencia (aunque esten normales: muestran como se ve un feriado real).
   Solo desde el primer dia con tickets: lo anterior es un solo bloque sin
   historia y ya sale en la seccion 2.
   TicketsVwTickets > 0 con Tickets = 0 -> la carga si llego, el ticket no
   tiene servicio en vw_ServicioTickets (no es hueco de ETL).
   ------------------------------------------------------------------------- */
WITH Cal AS (
    SELECT d = DATEADD(DAY, n.i, @Desde)
    FROM (SELECT i = a.i * 100 + b.i * 10 + c.i
          FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS a (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS b (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS c (i)) AS n
    WHERE n.i <= DATEDIFF(DAY, @Desde, @HoyMx)
), Feriado AS (
    SELECT d = CONVERT(DATE, f.d, 112), f.Nombre FROM (VALUES
        ('20250101', N'Año Nuevo'), ('20250203', N'Constitución (LFT)'), ('20250317', N'Natalicio de Juárez (LFT)'),
        ('20250417', N'Jueves Santo (asueto común)'), ('20250418', N'Viernes Santo (asueto común)'),
        ('20250501', N'Día del Trabajo'), ('20250916', N'Independencia'), ('20251102', N'Día de Muertos (asueto común)'),
        ('20251117', N'Revolución (LFT)'), ('20251212', N'Virgen de Guadalupe (asueto común)'),
        ('20251224', N'Nochebuena (asueto común)'), ('20251225', N'Navidad'), ('20251231', N'Fin de año (asueto común)'),
        ('20260101', N'Año Nuevo'), ('20260202', N'Constitución (LFT)'), ('20260316', N'Natalicio de Juárez (LFT)'),
        ('20260402', N'Jueves Santo (asueto común)'), ('20260403', N'Viernes Santo (asueto común)'),
        ('20260501', N'Día del Trabajo'), ('20260916', N'Independencia'), ('20261102', N'Día de Muertos (asueto común)'),
        ('20261116', N'Revolución (LFT)')
    ) AS f (d, Nombre)
), Srv AS (
    SELECT d = CONVERT(DATE, v.FechaRegistroDia), Tickets = COUNT(DISTINCT v.CodigoTicket),
           Horas = COUNT(DISTINCT DATEPART(HOUR, v.FechaRegistro)),
           Primera = MIN(v.FechaRegistro), Ultima = MAX(v.FechaRegistro)
    FROM dbo.vw_ServicioTickets AS v
    WHERE v.FechaRegistro >= @Desde AND v.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, v.FechaRegistroDia)
), Tk AS (
    SELECT d = CONVERT(DATE, t.FechaRegistro), Filas = COUNT_BIG(*)
    FROM dbo.vw_Tickets AS t
    WHERE t.FechaRegistro >= @Desde AND t.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, t.FechaRegistro)
), Dia AS (
    SELECT c.d, Dow = DATEDIFF(DAY, '19000101', c.d) % 7, Tickets = ISNULL(s.Tickets, 0),
           s.Horas, s.Primera, s.Ultima, FilasVwTickets = ISNULL(k.Filas, 0), Feriado = fe.Nombre
    FROM Cal AS c
    LEFT JOIN Srv AS s ON s.d = c.d
    LEFT JOIN Tk AS k ON k.d = c.d
    LEFT JOIN Feriado AS fe ON fe.d = c.d
), Ref AS (
    SELECT *,
           SumaVecinos = SUM(CASE WHEN Tickets > 0 AND d < @HoyMx THEN Tickets END)
                         OVER (PARTITION BY Dow ORDER BY d ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING),
           CuentaVecinos = COUNT(CASE WHEN Tickets > 0 AND d < @HoyMx THEN 1 END)
                         OVER (PARTITION BY Dow ORDER BY d ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
    FROM Dia
), Marca AS (
    SELECT *,
           Referencia = CAST(ISNULL(SumaVecinos, 0) - CASE WHEN Tickets > 0 AND d < @HoyMx THEN Tickets ELSE 0 END AS DECIMAL(18, 2))
                        / NULLIF(CuentaVecinos - CASE WHEN Tickets > 0 AND d < @HoyMx THEN 1 ELSE 0 END, 0)
    FROM Ref
), Estado AS (
    SELECT *,
           Estado = CASE WHEN d = @HoyMx                              THEN 'HOY (en curso)'
                         WHEN Tickets = 0 AND FilasVwTickets > 0     THEN 'SIN TICKETS DE SERVICIO (vw_Tickets si tiene)'
                         WHEN Tickets = 0                            THEN 'SIN TICKETS'
                         WHEN Referencia IS NULL                     THEN 'SIN REFERENCIA'
                         WHEN Tickets < @UmbralMuyBajo * Referencia  THEN 'MUY BAJO'
                         WHEN Tickets < @UmbralBajo * Referencia     THEN 'BAJO'
                         ELSE 'OK' END
    FROM Marca
)
SELECT Seccion          = '3 Revisar',
       Dia              = CONVERT(VARCHAR(10), d, 120),
       DiaSemana        = CHOOSE(Dow + 1, N'Lun', N'Mar', N'Mié', N'Jue', N'Vie', N'Sáb', N'Dom'),
       Estado,
       Feriado          = ISNULL(Feriado, N''),
       Tickets,
       Referencia       = CAST(Referencia AS DECIMAL(10, 1)),
       PorcentajeDeReferencia = CAST(100.0 * Tickets / NULLIF(Referencia, 0) AS DECIMAL(6, 1)),
       FilasVwTickets,
       HorasConTickets  = Horas,
       PrimerRegistro   = CONVERT(VARCHAR(8), Primera, 108),
       UltimoRegistro   = CONVERT(VARCHAR(8), Ultima, 108)
FROM Estado
WHERE (Estado NOT IN ('OK', 'HOY (en curso)') OR Feriado IS NOT NULL)
  AND d >= ISNULL(@SrvPrimerDia, @Desde)
ORDER BY d;

/* -------------------------------------------------------------------------
   4) Diario completo (mismas columnas que la 3, todos los dias).
   ------------------------------------------------------------------------- */
WITH Cal AS (
    SELECT d = DATEADD(DAY, n.i, @Desde)
    FROM (SELECT i = a.i * 100 + b.i * 10 + c.i
          FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS a (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS b (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS c (i)) AS n
    WHERE n.i <= DATEDIFF(DAY, @Desde, @HoyMx)
), Feriado AS (
    SELECT d = CONVERT(DATE, f.d, 112), f.Nombre FROM (VALUES
        ('20250101', N'Año Nuevo'), ('20250203', N'Constitución (LFT)'), ('20250317', N'Natalicio de Juárez (LFT)'),
        ('20250417', N'Jueves Santo (asueto común)'), ('20250418', N'Viernes Santo (asueto común)'),
        ('20250501', N'Día del Trabajo'), ('20250916', N'Independencia'), ('20251102', N'Día de Muertos (asueto común)'),
        ('20251117', N'Revolución (LFT)'), ('20251212', N'Virgen de Guadalupe (asueto común)'),
        ('20251224', N'Nochebuena (asueto común)'), ('20251225', N'Navidad'), ('20251231', N'Fin de año (asueto común)'),
        ('20260101', N'Año Nuevo'), ('20260202', N'Constitución (LFT)'), ('20260316', N'Natalicio de Juárez (LFT)'),
        ('20260402', N'Jueves Santo (asueto común)'), ('20260403', N'Viernes Santo (asueto común)'),
        ('20260501', N'Día del Trabajo'), ('20260916', N'Independencia'), ('20261102', N'Día de Muertos (asueto común)'),
        ('20261116', N'Revolución (LFT)')
    ) AS f (d, Nombre)
), Srv AS (
    SELECT d = CONVERT(DATE, v.FechaRegistroDia), Tickets = COUNT(DISTINCT v.CodigoTicket),
           Horas = COUNT(DISTINCT DATEPART(HOUR, v.FechaRegistro)),
           Primera = MIN(v.FechaRegistro), Ultima = MAX(v.FechaRegistro)
    FROM dbo.vw_ServicioTickets AS v
    WHERE v.FechaRegistro >= @Desde AND v.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, v.FechaRegistroDia)
), Tk AS (
    SELECT d = CONVERT(DATE, t.FechaRegistro), Filas = COUNT_BIG(*)
    FROM dbo.vw_Tickets AS t
    WHERE t.FechaRegistro >= @Desde AND t.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, t.FechaRegistro)
), Dia AS (
    SELECT c.d, Dow = DATEDIFF(DAY, '19000101', c.d) % 7, Tickets = ISNULL(s.Tickets, 0),
           s.Horas, s.Primera, s.Ultima, FilasVwTickets = ISNULL(k.Filas, 0), Feriado = fe.Nombre
    FROM Cal AS c
    LEFT JOIN Srv AS s ON s.d = c.d
    LEFT JOIN Tk AS k ON k.d = c.d
    LEFT JOIN Feriado AS fe ON fe.d = c.d
), Ref AS (
    SELECT *,
           SumaVecinos = SUM(CASE WHEN Tickets > 0 AND d < @HoyMx THEN Tickets END)
                         OVER (PARTITION BY Dow ORDER BY d ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING),
           CuentaVecinos = COUNT(CASE WHEN Tickets > 0 AND d < @HoyMx THEN 1 END)
                         OVER (PARTITION BY Dow ORDER BY d ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
    FROM Dia
), Marca AS (
    SELECT *,
           Referencia = CAST(ISNULL(SumaVecinos, 0) - CASE WHEN Tickets > 0 AND d < @HoyMx THEN Tickets ELSE 0 END AS DECIMAL(18, 2))
                        / NULLIF(CuentaVecinos - CASE WHEN Tickets > 0 AND d < @HoyMx THEN 1 ELSE 0 END, 0)
    FROM Ref
), Estado AS (
    SELECT *,
           Estado = CASE WHEN d = @HoyMx                              THEN 'HOY (en curso)'
                         WHEN Tickets = 0 AND FilasVwTickets > 0     THEN 'SIN TICKETS DE SERVICIO (vw_Tickets si tiene)'
                         WHEN Tickets = 0                            THEN 'SIN TICKETS'
                         WHEN Referencia IS NULL                     THEN 'SIN REFERENCIA'
                         WHEN Tickets < @UmbralMuyBajo * Referencia  THEN 'MUY BAJO'
                         WHEN Tickets < @UmbralBajo * Referencia     THEN 'BAJO'
                         ELSE 'OK' END
    FROM Marca
)
SELECT Seccion          = '4 Diario',
       Dia              = CONVERT(VARCHAR(10), d, 120),
       DiaSemana        = CHOOSE(Dow + 1, N'Lun', N'Mar', N'Mié', N'Jue', N'Vie', N'Sáb', N'Dom'),
       Estado,
       Feriado          = ISNULL(Feriado, N''),
       Tickets,
       Referencia       = CAST(Referencia AS DECIMAL(10, 1)),
       PorcentajeDeReferencia = CAST(100.0 * Tickets / NULLIF(Referencia, 0) AS DECIMAL(6, 1)),
       FilasVwTickets,
       HorasConTickets  = Horas,
       PrimerRegistro   = CONVERT(VARCHAR(8), Primera, 108),
       UltimoRegistro   = CONVERT(VARCHAR(8), Ultima, 108)
FROM Estado
ORDER BY d;

/* -------------------------------------------------------------------------
   5) Por mes (hoy no cuenta en dias ni en promedios; si en Tickets).
   ------------------------------------------------------------------------- */
WITH Cal AS (
    SELECT d = DATEADD(DAY, n.i, @Desde)
    FROM (SELECT i = a.i * 100 + b.i * 10 + c.i
          FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS a (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS b (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS c (i)) AS n
    WHERE n.i <= DATEDIFF(DAY, @Desde, @HoyMx)
), Srv AS (
    SELECT d = CONVERT(DATE, v.FechaRegistroDia), Tickets = COUNT(DISTINCT v.CodigoTicket)
    FROM dbo.vw_ServicioTickets AS v
    WHERE v.FechaRegistro >= @Desde AND v.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, v.FechaRegistroDia)
), Dia AS (
    SELECT c.d, Mes = DATEFROMPARTS(YEAR(c.d), MONTH(c.d), 1), Tickets = ISNULL(s.Tickets, 0)
    FROM Cal AS c LEFT JOIN Srv AS s ON s.d = c.d
)
SELECT Seccion           = '5 Mes',
       Mes               = CONVERT(VARCHAR(7), Mes, 120),
       DiasCalendario    = SUM(CASE WHEN d < @HoyMx THEN 1 ELSE 0 END),
       DiasConTickets    = SUM(CASE WHEN d < @HoyMx AND Tickets > 0 THEN 1 ELSE 0 END),
       DiasSinTickets    = SUM(CASE WHEN d < @HoyMx AND Tickets = 0 THEN 1 ELSE 0 END),
       PrimerDiaConTickets = CONVERT(VARCHAR(10), MIN(CASE WHEN Tickets > 0 THEN d END), 120),
       UltimoDiaConTickets = CONVERT(VARCHAR(10), MAX(CASE WHEN Tickets > 0 THEN d END), 120),
       Tickets           = SUM(CAST(Tickets AS BIGINT)),
       PromedioDiaConTickets = CAST(AVG(CASE WHEN d < @HoyMx AND Tickets > 0 THEN 1.0 * Tickets END) AS DECIMAL(10, 1)),
       MinimoDiaConTickets   = MIN(CASE WHEN d < @HoyMx AND Tickets > 0 THEN Tickets END),
       MaximoDia             = MAX(CASE WHEN d < @HoyMx THEN Tickets END),
       Completo          = CASE WHEN SUM(CASE WHEN d < @HoyMx AND Tickets = 0 THEN 1 ELSE 0 END) = 0 THEN 'SI' ELSE 'NO' END
FROM Dia
GROUP BY Mes
ORDER BY Mes;

/* -------------------------------------------------------------------------
   6) Por dia de la semana (dias con tickets, sin hoy): de donde sale la
   "Referencia" de las secciones 3 y 4 y que tan bajo es normal un sabado o
   domingo. DiasSinTickets por dia de la semana: si los ceros se concentran
   en domingo, sugiere cero legitimo; si caen en dias habiles, carga faltante.
   ------------------------------------------------------------------------- */
WITH Cal AS (
    SELECT d = DATEADD(DAY, n.i, @Desde)
    FROM (SELECT i = a.i * 100 + b.i * 10 + c.i
          FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS a (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS b (i)
          CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS c (i)) AS n
    WHERE n.i <= DATEDIFF(DAY, @Desde, @HoyMx)
), Srv AS (
    SELECT d = CONVERT(DATE, v.FechaRegistroDia), Tickets = COUNT(DISTINCT v.CodigoTicket)
    FROM dbo.vw_ServicioTickets AS v
    WHERE v.FechaRegistro >= @Desde AND v.FechaRegistro < @Manana
    GROUP BY CONVERT(DATE, v.FechaRegistroDia)
), Dia AS (
    SELECT c.d, Dow = DATEDIFF(DAY, '19000101', c.d) % 7, Tickets = ISNULL(s.Tickets, 0)
    FROM Cal AS c LEFT JOIN Srv AS s ON s.d = c.d
    WHERE c.d < @HoyMx
), Med AS (
    SELECT DISTINCT Dow,
           Mediana = PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY Tickets) OVER (PARTITION BY Dow)
    FROM Dia
    WHERE Tickets > 0
)
SELECT Seccion        = '6 DiaSemana',
       DiaSemana      = CHOOSE(d.Dow + 1, N'Lun', N'Mar', N'Mié', N'Jue', N'Vie', N'Sáb', N'Dom'),
       Dias           = COUNT(*),
       DiasConTickets = SUM(CASE WHEN d.Tickets > 0 THEN 1 ELSE 0 END),
       DiasSinTickets = SUM(CASE WHEN d.Tickets = 0 THEN 1 ELSE 0 END),
       Promedio       = CAST(AVG(CASE WHEN d.Tickets > 0 THEN 1.0 * d.Tickets END) AS DECIMAL(10, 1)),
       Mediana        = CAST(MAX(m.Mediana) AS DECIMAL(10, 1)),
       Minimo         = MIN(CASE WHEN d.Tickets > 0 THEN d.Tickets END),
       Maximo         = MAX(d.Tickets)
FROM Dia AS d
LEFT JOIN Med AS m ON m.Dow = d.Dow
GROUP BY d.Dow
ORDER BY d.Dow;

/* -------------------------------------------------------------------------
   7) Consistencia de las vistas completas (de la lectura inicial).
   DiaDistintoDeFechaRegistro > 0: FechaRegistroDia (lo que usa la pestaña
   para la cobertura) no es CONVERT(DATE, FechaRegistro) (lo que usan los
   rangos de mes y del periodo anterior); habria que revisar antes de
   implementar. FilasMenosTickets > 0: hay tickets en mas de un renglon.
   ------------------------------------------------------------------------- */
SELECT Seccion                    = '7 Consistencia',
       Vista                      = 'dbo.vw_ServicioTickets',
       Filas                      = @SrvFilas,
       TicketsDistintos           = @SrvTickets,
       FilasMenosTickets          = @SrvFilas - @SrvTickets,
       FechaRegistroNula          = @SrvFechaNula,
       FechaRegistroDiaNula       = @SrvDiaNulo,
       DiaDistintoDeFechaRegistro = @SrvDiaDistinto,
       RegistrosDespuesDeHoyMx    = @SrvFuturas,
       PrimerRegistro             = CONVERT(VARCHAR(19), @SrvPrimerRegistro, 120),
       UltimoRegistro             = CONVERT(VARCHAR(19), @SrvUltimoRegistro, 120)
UNION ALL
SELECT '7 Consistencia', 'dbo.vw_Tickets', @TkFilas, NULL, NULL, @TkFechaNula, NULL, NULL, NULL,
       CONVERT(VARCHAR(10), @TkPrimerDia, 120), CONVERT(VARCHAR(10), @TkUltimoDia, 120);
