/* =========================================================================
   sql/44_tendencia_diaria_filtros.sql
   dbo.usp_DashboardServicios_TendenciaDiaria con los filtros de la pestaña
   "Vista general de servicios", para que la grafica "Tickets generados por
   dia" pueda leer de aqui en vez de calcular en C#
   (ConcentracionContrato.Tendencia).

   QUE CAMBIA (todo opcional: sin los parametros nuevos, el resultado es el
   mismo de antes, mas dos columnas al final en NULL)
     @TipoPeriodo nuevos:
       SLOTS  Slots 0..@Slot juntos (acumulado, como la pestaña y SLA);
              calendario completo hoy-(30*@Slot+29) .. hoy.
       MESES  @Meses = 'aaaa-mm|aaaa-mm' (no tienen que ser seguidos); el
              mes en curso llega hasta hoy; los meses de en medio no entran.
       En los dos: "hoy" = DATEADD(HOUR, -6, SYSUTCDATETIME()), el de la
       columna Slot de dbo.vw_Tickets, y el dia de cada ticket es
       FechaRegistroDia (lo que usa la pestaña). SLOT, MES y FECHAS no
       cambian (siguen con GETDATE() y CAST(FechaRegistro AS DATE)).
     @CodigosServicio = 'EQC|PU': agrupa por CODIGO (CatServicioCorreo.
       Servicio, como el Pareto: PU y WMS son una linea cada uno aunque
       tengan dos ramas). Excluye a @Servicios (ramas). Las filas traen
       CodigoServicio y NombreServicio; RamaServicio va en NULL.
     @ServiceOwners = 'Nombre|Nombre' ('(Sin Service Owner)' = sin dueño)
     @Grupos        = 'Grupo|Grupo'
       Se aplican en cualquier @TipoPeriodo, antes de contar.

   SERVICE OWNER: es la MISMA regla de App_Code/DirectorioOrganizacional.cs
   (la unica resolucion de dueños del sitio); si una cambia, la otra
   tambien. Dueño = el de la fila de dbo.CatCategoriaDueno del C1&C2 exacto
   del ticket (dbo.fn_CategoriaC1C2) y, si no hay o no trae SO, el del C1
   (vw_ServicioTickets.C1Raiz). Llaves y nombres normalizados como
   dbo.fn_NormalizaCategoria (NBSP a espacio, sin espacios en los extremos).
   Lee TODAS las filas, vigentes o no; con varias por llave gana la primera
   en el orden C1, vigentes primero, CategoriaN2. La prueba de paridad
   (tools/tests/ConcentracionContratoSmoke.cs, seccion 2e) compara la salida
   contra la pestaña.

   RIESGO
     - Reemplaza el procedimiento entero (ALTER): si el autor lo modifico
       despues del 2026-11-25 10:45:04 (sys.objects.modify_date), 44 se
       llevaria esos cambios. Comparar antes de correr.
     - Columnas nuevas al final (CodigoServicio, NombreServicio): un
       consumidor que lea por posicion o haga INSERT ... EXEC sin lista de
       columnas fallaria. Hoy no hay consumidores conocidos en el repo.
     - Lectura: con @ServiceOwners llama dbo.fn_CategoriaC1C2 una vez por
       categoria DISTINTA del periodo, no por ticket.
     - Permisos: los mismos (EXECUTE sobre el esquema dbo); ALTER los conserva.

   ROLLBACK: sql/44_tendencia_diaria_filtros_rollback.sql (la version de QA
   del 2026-11-25, sin tocar).

   CORRERLO (cuenta con ALTER sobre el esquema dbo; PROACTIVANETAD no la tiene):
       sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -E -i sql\44_tendencia_diaria_filtros.sql
   ========================================================================= */
USE [Tickets_Proactivanet];
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_DashboardServicios_TendenciaDiaria]
(
    ------------------------------------------------------------
    -- TIPOS DE PERIODO
    --
    -- SLOT:   un Slot (columna Slot de vw_ServicioTickets)
    -- SLOTS:  Slots 0..@Slot acumulados (calendario completo)
    -- MES:    un mes (Calendar_YearMonth)
    -- MESES:  varios meses (@Meses)
    -- FECHAS: @FechaInicio..@FechaFin (FechaRegistro)
    --
    -- DEFAULT = SLOT 0
    ------------------------------------------------------------
    @TipoPeriodo VARCHAR(20) = 'SLOT',

    @Slot INT = 0,

    -- MES. Ejemplo: '2026-11'
    @CalendarYearMonth VARCHAR(7) = NULL,

    -- FECHAS
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,

    ------------------------------------------------------------
    -- SERVICIOS POR RAMA
    -- NULL o vacio: una serie TOTAL.
    -- N'S-Equipo de Computo|S-Biometrico|S-Caja General'
    ------------------------------------------------------------
    @Servicios NVARCHAR(MAX) = NULL,

    -- MESES. Ejemplo: '2026-11|2026-09'
    @Meses NVARCHAR(MAX) = NULL,

    -- SERVICIOS POR CODIGO (excluye @Servicios). Ejemplo: 'EQC|PU|BIO'
    @CodigosServicio NVARCHAR(MAX) = NULL,

    -- FILTROS. '(Sin Service Owner)' = tickets sin dueño resuelto.
    @ServiceOwners NVARCHAR(MAX) = NULL,
    @Grupos        NVARCHAR(MAX) = NULL
)
AS
BEGIN

    SET NOCOUNT ON;

    ------------------------------------------------------------
    -- 1. NORMALIZAR PARAMETROS
    ------------------------------------------------------------
    SET @TipoPeriodo     = UPPER(LTRIM(RTRIM(@TipoPeriodo)));
    SET @Servicios       = NULLIF(LTRIM(RTRIM(@Servicios)), N'');
    SET @Meses           = NULLIF(LTRIM(RTRIM(@Meses)), N'');
    SET @CodigosServicio = NULLIF(LTRIM(RTRIM(@CodigosServicio)), N'');
    SET @ServiceOwners   = NULLIF(LTRIM(RTRIM(@ServiceOwners)), N'');
    SET @Grupos          = NULLIF(LTRIM(RTRIM(@Grupos)), N'');

    DECLARE @PorCodigo BIT = CASE WHEN @CodigosServicio IS NOT NULL THEN 1 ELSE 0 END;
    -- La seleccion activa: ramas o codigos. #ServiciosSeleccionados guarda la que sea.
    DECLARE @Seleccion NVARCHAR(MAX) = COALESCE(@CodigosServicio, @Servicios);
    -- El "hoy" de la columna Slot de vw_Tickets (Mexico, UTC-6 fijo).
    DECLARE @Hoy DATE = CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()));


    ------------------------------------------------------------
    -- 2. VALIDAR
    ------------------------------------------------------------
    IF @TipoPeriodo NOT IN ('SLOT', 'SLOTS', 'MES', 'MESES', 'FECHAS')
    BEGIN
        RAISERROR('El @TipoPeriodo debe ser SLOT, SLOTS, MES, MESES o FECHAS.', 16, 1);
        RETURN;
    END;

    IF @Servicios IS NOT NULL AND @CodigosServicio IS NOT NULL
    BEGIN
        RAISERROR('Usa @Servicios (ramas) o @CodigosServicio (codigos), no los dos.', 16, 1);
        RETURN;
    END;


    ------------------------------------------------------------
    -- 3. LISTAS RECIBIDAS
    ------------------------------------------------------------
    CREATE TABLE #ServiciosSeleccionados
    (
        RamaServicio NVARCHAR(255) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY
    );

    IF @Seleccion IS NOT NULL
        INSERT INTO #ServiciosSeleccionados (RamaServicio)
        SELECT DISTINCT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@Seleccion, '|')
        WHERE NULLIF(LTRIM(RTRIM(value)), N'') IS NOT NULL;

    -- Nombres como los normaliza DirectorioOrganizacional.
    CREATE TABLE #FiltroSO (Nombre NVARCHAR(255) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY);
    IF @ServiceOwners IS NOT NULL
        INSERT INTO #FiltroSO (Nombre)
        SELECT DISTINCT LTRIM(RTRIM(REPLACE(value, NCHAR(160), N' ')))
        FROM STRING_SPLIT(@ServiceOwners, '|')
        WHERE NULLIF(LTRIM(RTRIM(REPLACE(value, NCHAR(160), N' '))), N'') IS NOT NULL;

    CREATE TABLE #FiltroGrupo (Grupo NVARCHAR(255) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY);
    IF @Grupos IS NOT NULL
        INSERT INTO #FiltroGrupo (Grupo)
        SELECT DISTINCT LTRIM(RTRIM(value))
        FROM STRING_SPLIT(@Grupos, '|')
        WHERE NULLIF(LTRIM(RTRIM(value)), N'') IS NOT NULL;

    IF (@ServiceOwners IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #FiltroSO))
       OR (@Grupos IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #FiltroGrupo))
    BEGIN
        RAISERROR('No se recibieron Service Owners o Grupos validos.', 16, 1);
        RETURN;
    END;

    -- Dias del periodo, en uno o varios tramos (MESES puede tener huecos).
    CREATE TABLE #Rangos (Desde DATE NOT NULL, Hasta DATE NOT NULL);


    ------------------------------------------------------------
    -- 4. SLOT (sin cambios)
    ------------------------------------------------------------
    IF @TipoPeriodo = 'SLOT'
    BEGIN

        IF @Slot IS NULL
            SET @Slot = 0;

        IF @Slot < 0
        BEGIN
            RAISERROR('@Slot no puede ser negativo.', 16, 1);
            RETURN;
        END;

        -- Tomar rango real existente para ese Slot
        SELECT
            @FechaInicio = MIN(CAST(FechaRegistro AS DATE)),
            @FechaFin    = MAX(CAST(FechaRegistro AS DATE))
        FROM dbo.vw_ServicioTickets
        WHERE Slot = @Slot;

        IF @FechaInicio IS NULL OR @FechaFin IS NULL
        BEGIN
            RAISERROR('No se encontraron tickets para el Slot solicitado.', 16, 1);
            RETURN;
        END;

    END;


    ------------------------------------------------------------
    -- 4b. SLOTS: 0..@Slot, calendario completo aunque haya dias
    --     sin tickets (Slot k = hoy-(30k+29) .. hoy-30k).
    ------------------------------------------------------------
    IF @TipoPeriodo = 'SLOTS'
    BEGIN

        IF @Slot IS NULL
            SET @Slot = 0;

        IF @Slot < 0
        BEGIN
            RAISERROR('@Slot no puede ser negativo.', 16, 1);
            RETURN;
        END;

        SET @FechaInicio = DATEADD(DAY, -(30 * @Slot + 29), @Hoy);
        SET @FechaFin    = @Hoy;

    END;


    ------------------------------------------------------------
    -- 5. MES (sin cambios)
    ------------------------------------------------------------
    IF @TipoPeriodo = 'MES'
    BEGIN

        IF @CalendarYearMonth IS NULL OR LTRIM(RTRIM(@CalendarYearMonth)) = ''
        BEGIN
            RAISERROR('Para MES debes enviar @CalendarYearMonth. Ejemplo: 2026-11.', 16, 1);
            RETURN;
        END;

        SET @FechaInicio = TRY_CONVERT(DATE, @CalendarYearMonth + '-01');

        IF @FechaInicio IS NULL
        BEGIN
            RAISERROR('@CalendarYearMonth debe tener formato YYYY-MM.', 16, 1);
            RETURN;
        END;

        -- Mes actual = hasta hoy; mes historico = mes completo
        IF YEAR(@FechaInicio) = YEAR(GETDATE()) AND MONTH(@FechaInicio) = MONTH(GETDATE())
            SET @FechaFin = CAST(GETDATE() AS DATE);
        ELSE
            SET @FechaFin = EOMONTH(@FechaInicio);

        IF @FechaInicio > CAST(GETDATE() AS DATE)
        BEGIN
            RAISERROR('No se puede consultar un mes futuro.', 16, 1);
            RETURN;
        END;

        IF NOT EXISTS (SELECT 1 FROM dbo.vw_ServicioTickets WHERE Calendar_YearMonth = @CalendarYearMonth)
        BEGIN
            RAISERROR('No se encontraron tickets para el mes solicitado.', 16, 1);
            RETURN;
        END;

    END;


    ------------------------------------------------------------
    -- 5b. MESES: cada mes es un tramo; el en curso llega a hoy.
    ------------------------------------------------------------
    IF @TipoPeriodo = 'MESES'
    BEGIN

        IF @Meses IS NULL
        BEGIN
            RAISERROR('Para MESES debes enviar @Meses. Ejemplo: 2026-11|2026-09.', 16, 1);
            RETURN;
        END;

        CREATE TABLE #MesesPedidos (Texto NVARCHAR(20) COLLATE DATABASE_DEFAULT NOT NULL, Desde DATE NULL);

        INSERT INTO #MesesPedidos (Texto, Desde)
        SELECT DISTINCT LTRIM(RTRIM(value)),
               CASE WHEN LTRIM(RTRIM(value)) LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                    THEN TRY_CONVERT(DATE, LTRIM(RTRIM(value)) + '-01', 23) END
        FROM STRING_SPLIT(@Meses, '|')
        WHERE NULLIF(LTRIM(RTRIM(value)), N'') IS NOT NULL;

        IF NOT EXISTS (SELECT 1 FROM #MesesPedidos)
           OR EXISTS (SELECT 1 FROM #MesesPedidos WHERE Desde IS NULL)
        BEGIN
            RAISERROR('@Meses debe ser una lista YYYY-MM separada por |.', 16, 1);
            RETURN;
        END;

        IF EXISTS (SELECT 1 FROM #MesesPedidos WHERE Desde > @Hoy)
        BEGIN
            RAISERROR('No se puede consultar un mes futuro.', 16, 1);
            RETURN;
        END;

        INSERT INTO #Rangos (Desde, Hasta)
        SELECT DISTINCT Desde, CASE WHEN EOMONTH(Desde) > @Hoy THEN @Hoy ELSE EOMONTH(Desde) END
        FROM #MesesPedidos;

        SELECT @FechaInicio = MIN(Desde), @FechaFin = MAX(Hasta) FROM #Rangos;

    END;


    ------------------------------------------------------------
    -- 6. FECHAS PERSONALIZADAS (sin cambios)
    ------------------------------------------------------------
    IF @TipoPeriodo = 'FECHAS'
    BEGIN

        IF @FechaInicio IS NULL OR @FechaFin IS NULL
        BEGIN
            RAISERROR('Para FECHAS debes enviar @FechaInicio y @FechaFin.', 16, 1);
            RETURN;
        END;

        IF @FechaInicio > @FechaFin
        BEGIN
            RAISERROR('@FechaInicio no puede ser mayor que @FechaFin.', 16, 1);
            RETURN;
        END;

        IF @FechaFin > CAST(GETDATE() AS DATE)
        BEGIN
            RAISERROR('@FechaFin no puede ser una fecha futura.', 16, 1);
            RETURN;
        END;

    END;

    -- Un solo tramo para todo lo que no es MESES.
    IF @TipoPeriodo <> 'MESES'
        INSERT INTO #Rangos (Desde, Hasta) VALUES (@FechaInicio, @FechaFin);


    ------------------------------------------------------------
    -- 7. VALIDAR SELECCION DE SERVICIOS
    ------------------------------------------------------------
    IF @Seleccion IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #ServiciosSeleccionados)
    BEGIN
        RAISERROR('No se recibieron servicios validos.', 16, 1);
        RETURN;
    END;


    ------------------------------------------------------------
    -- 8. CONTAR SERVICIOS SELECCIONADOS (sin seleccion: ramas, como antes)
    ------------------------------------------------------------
    DECLARE @CantidadServicios INT;

    IF @Seleccion IS NULL
        SET @CantidadServicios =
        (
            SELECT COUNT(DISTINCT LTRIM(RTRIM(RamaServicio)))
            FROM dbo.vw_ServicioTickets
            WHERE NULLIF(LTRIM(RTRIM(RamaServicio)), N'') IS NOT NULL
        );
    ELSE
        SELECT @CantidadServicios = COUNT(*) FROM #ServiciosSeleccionados;


    ------------------------------------------------------------
    -- 9. CALENDARIO DEL PERIODO (un dia por fila, de todos los tramos)
    ------------------------------------------------------------
    CREATE TABLE #Dias (Fecha DATE NOT NULL PRIMARY KEY);

    ;WITH D AS
    (
        SELECT Desde AS Fecha, Hasta FROM #Rangos
        UNION ALL
        SELECT DATEADD(DAY, 1, Fecha), Hasta FROM D WHERE Fecha < Hasta
    )
    INSERT INTO #Dias (Fecha)
    SELECT DISTINCT Fecha FROM D
    OPTION (MAXRECURSION 0);


    ------------------------------------------------------------
    -- 10. TICKETS BASE: periodo, servicio y Grupo
    --     Clave = la rama o el codigo, segun la seleccion.
    ------------------------------------------------------------
    CREATE TABLE #Base
    (
        Fecha        DATE NULL,
        Clave        NVARCHAR(255) COLLATE DATABASE_DEFAULT NULL,
        CodigoTicket NVARCHAR(100) COLLATE DATABASE_DEFAULT NULL,
        Categoria    NVARCHAR(500) COLLATE DATABASE_DEFAULT NULL,
        C1           NVARCHAR(500) COLLATE DATABASE_DEFAULT NULL
    );

    INSERT INTO #Base (Fecha, Clave, CodigoTicket, Categoria, C1)
    SELECT
        CASE WHEN @TipoPeriodo IN ('SLOTS', 'MESES') THEN V.FechaRegistroDia
             ELSE CAST(V.FechaRegistro AS DATE) END,
        CASE WHEN @PorCodigo = 1 THEN LTRIM(RTRIM(V.Servicio))
             ELSE LTRIM(RTRIM(V.RamaServicio)) END,
        V.CodigoTicket,
        LTRIM(RTRIM(V.Categoria)),
        V.C1Raiz
    FROM dbo.vw_ServicioTickets V
    WHERE
        -- Con rama (como antes) o con codigo, segun la seleccion
        (
            (@PorCodigo = 0 AND NULLIF(LTRIM(RTRIM(V.RamaServicio)), N'') IS NOT NULL)
            OR (@PorCodigo = 1 AND NULLIF(LTRIM(RTRIM(V.Servicio)), N'') IS NOT NULL)
        )

        AND
        (
            @Seleccion IS NULL
            OR EXISTS
            (
                SELECT 1 FROM #ServiciosSeleccionados SS
                WHERE SS.RamaServicio = CASE WHEN @PorCodigo = 1 THEN LTRIM(RTRIM(V.Servicio))
                                             ELSE LTRIM(RTRIM(V.RamaServicio)) END
            )
        )

        -- Periodo
        AND (@TipoPeriodo <> 'SLOT'  OR V.Slot = @Slot)
        AND (@TipoPeriodo <> 'SLOTS' OR (V.Slot >= 0 AND V.Slot <= @Slot))
        AND (@TipoPeriodo <> 'MES'   OR V.Calendar_YearMonth = @CalendarYearMonth)
        AND (@TipoPeriodo <> 'MESES'
             OR EXISTS (SELECT 1 FROM #Rangos R
                        WHERE V.FechaRegistro >= R.Desde AND V.FechaRegistro < DATEADD(DAY, 1, R.Hasta)))
        AND V.FechaRegistro >= @FechaInicio
        AND V.FechaRegistro <  DATEADD(DAY, 1, @FechaFin)

        -- Grupo
        AND (@Grupos IS NULL
             OR EXISTS (SELECT 1 FROM #FiltroGrupo G WHERE G.Grupo = LTRIM(RTRIM(V.Grupo))));


    ------------------------------------------------------------
    -- 11. SERVICE OWNER (regla de DirectorioOrganizacional; ver cabecera)
    ------------------------------------------------------------
    IF @ServiceOwners IS NOT NULL
    BEGIN

        CREATE TABLE #DuenoN2 (Llave NVARCHAR(500) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY, SO NVARCHAR(255) COLLATE DATABASE_DEFAULT NULL);
        CREATE TABLE #DuenoC1 (Llave NVARCHAR(500) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY, SO NVARCHAR(255) COLLATE DATABASE_DEFAULT NULL);

        -- Orden = el ORDER BY de DirectorioOrganizacional.LeerDuenos: con
        -- varias filas por llave gana la primera (no es cosmetico).
        ;WITH D AS
        (
            SELECT
                N2 = NULLIF(LTRIM(RTRIM(REPLACE(ISNULL(CategoriaN2, N''), NCHAR(160), N' '))), N''),
                C1 = NULLIF(LTRIM(RTRIM(REPLACE(ISNULL(C1, N''), NCHAR(160), N' '))), N''),
                SO = NULLIF(LTRIM(RTRIM(REPLACE(ISNULL(ServiceOwner, N''), NCHAR(160), N' '))), N''),
                Orden = ROW_NUMBER() OVER (ORDER BY C1, CASE WHEN VigenteEnOrigen = 1 THEN 0 ELSE 1 END, CategoriaN2)
            FROM dbo.CatCategoriaDueno
        )
        SELECT N2, C1, SO, Orden INTO #Duenos FROM D;

        INSERT INTO #DuenoN2 (Llave, SO)
        SELECT N2, SO FROM (SELECT N2, SO, rn = ROW_NUMBER() OVER (PARTITION BY N2 ORDER BY Orden)
                            FROM #Duenos WHERE N2 IS NOT NULL) x
        WHERE rn = 1;

        INSERT INTO #DuenoC1 (Llave, SO)
        SELECT C1, SO FROM (SELECT C1, SO, rn = ROW_NUMBER() OVER (PARTITION BY C1 ORDER BY Orden)
                            FROM #Duenos WHERE C1 IS NOT NULL) x
        WHERE rn = 1;

        -- Una llamada a fn_CategoriaC1C2 por categoria distinta, no por ticket.
        CREATE TABLE #CategoriaSO
        (
            Categoria NVARCHAR(500) COLLATE DATABASE_DEFAULT NULL,
            C1        NVARCHAR(500) COLLATE DATABASE_DEFAULT NULL,
            SO        NVARCHAR(255) COLLATE DATABASE_DEFAULT NULL
        );

        INSERT INTO #CategoriaSO (Categoria, C1, SO)
        SELECT c.Categoria, c.C1, COALESCE(n2.SO, c1.SO)
        FROM (SELECT DISTINCT Categoria, C1 FROM #Base) c
        OUTER APPLY (SELECT Llave = NULLIF(dbo.fn_CategoriaC1C2(c.Categoria), N'')) k
        LEFT JOIN #DuenoN2 n2 ON n2.Llave = k.Llave
        LEFT JOIN #DuenoC1 c1 ON c1.Llave = NULLIF(LTRIM(RTRIM(REPLACE(ISNULL(c.C1, N''), NCHAR(160), N' '))), N'');

        DELETE B
        FROM #Base B
        LEFT JOIN #CategoriaSO S
               ON EXISTS (SELECT B.Categoria, B.C1 INTERSECT SELECT S.Categoria, S.C1)   -- iguala tambien NULL con NULL
        WHERE NOT EXISTS (SELECT 1 FROM #FiltroSO F WHERE F.Nombre = ISNULL(S.SO, N'(Sin Service Owner)'));

    END;


    ------------------------------------------------------------
    -- 12. CONTEOS
    ------------------------------------------------------------
    ;WITH TotalDiario AS
    (
        SELECT Fecha, COUNT(DISTINCT CodigoTicket) AS TicketsTotalDia
        FROM #Base
        GROUP BY Fecha
    ),

    TicketsPorServicio AS
    (
        SELECT Fecha, Clave, COUNT(DISTINCT CodigoTicket) AS TicketsServicio
        FROM #Base
        GROUP BY Fecha, Clave
    ),

    Resultado AS
    (
        -- CASO A: sin seleccion, una serie TOTAL
        SELECT
            F.Fecha,
            CAST('TOTAL' AS NVARCHAR(255)) AS Clave,
            ISNULL(TD.TicketsTotalDia, 0) AS TicketsServicio,
            ISNULL(TD.TicketsTotalDia, 0) AS TicketsTotalDia
        FROM #Dias F
        LEFT JOIN TotalDiario TD ON TD.Fecha = F.Fecha
        WHERE @Seleccion IS NULL

        UNION ALL

        -- CASO B: una fila por servicio/dia, 0 donde no hubo tickets
        SELECT
            F.Fecha,
            SS.RamaServicio,
            ISNULL(TPS.TicketsServicio, 0),
            ISNULL(TD.TicketsTotalDia, 0)
        FROM #Dias F
        CROSS JOIN #ServiciosSeleccionados SS
        LEFT JOIN TicketsPorServicio TPS ON TPS.Fecha = F.Fecha AND TPS.Clave = SS.RamaServicio
        LEFT JOIN TotalDiario TD ON TD.Fecha = F.Fecha
        WHERE @Seleccion IS NOT NULL
    )


    ------------------------------------------------------------
    -- 13. RESULTADO FINAL (mismas columnas y orden de antes; dos nuevas al final)
    ------------------------------------------------------------
    SELECT
        @TipoPeriodo AS TipoPeriodo,

        CASE WHEN @TipoPeriodo IN ('SLOT', 'SLOTS') THEN @Slot END AS Slot,

        CASE WHEN @TipoPeriodo = 'MES' THEN @CalendarYearMonth END AS CalendarYearMonth,

        @FechaInicio AS FechaInicioPeriodo,

        @FechaFin AS FechaFinPeriodo,

        CASE
            WHEN @Seleccion IS NULL THEN 'TODOS LOS SERVICIOS'
            WHEN @CantidadServicios = 1 THEN (SELECT TOP 1 RamaServicio FROM #ServiciosSeleccionados)
            ELSE CONCAT(@CantidadServicios, ' SERVICIOS SELECCIONADOS')
        END AS SeleccionServicios,

        @CantidadServicios AS CantidadServiciosSeleccionados,

        R.Fecha,

        CASE WHEN @PorCodigo = 1 THEN NULL ELSE R.Clave END AS RamaServicio,

        R.TicketsServicio,

        R.TicketsTotalDia,

        CASE WHEN @PorCodigo = 1 THEN R.Clave END AS CodigoServicio,

        CASE WHEN @PorCodigo = 1
             THEN ISNULL(NULLIF(LTRIM(RTRIM(C.Descripcion)), N''), R.Clave) END AS NombreServicio

    FROM Resultado R
    LEFT JOIN dbo.CatServicioCorreo C
           ON @PorCodigo = 1 AND C.Servicio = R.Clave

    ORDER BY
        R.Fecha,
        R.Clave;

END
GO
