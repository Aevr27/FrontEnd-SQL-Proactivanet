/* =========================================================================
   sql/44_tendencia_diaria_filtros_rollback.sql
   ROLLBACK de sql/44_tendencia_diaria_filtros.sql: deja
   dbo.usp_DashboardServicios_TendenciaDiaria EXACTAMENTE como estaba en QA
   antes de 44.

   Fuente: sp_helptext en AZVMBDCENTRALQA / Tickets_Proactivanet el
   2026-11-25 12:13 (procedimiento creado 2026-11-24 18:27, modificado
   2026-11-25 10:45). El cuerpo va sin tocar una linea; lo unico distinto es
   la primera palabra: CREATE OR ALTER en vez de CREATE, para poder correrlo
   sobre el procedimiento ya existente. ALTER conserva los permisos.

   Si el autor lo modifico despues de esa hora, este archivo ya no es su
   version: antes de correr 44, compara la fecha de modificacion
   (sys.objects.modify_date) con 2026-11-25 10:45:04.
   ========================================================================= */
USE [Tickets_Proactivanet];
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_DashboardServicios_TendenciaDiaria]
(
    ------------------------------------------------------------
    -- TIPOS DE PERIODO
    --
    -- SLOT:
    -- Utiliza Slot de vw_ServicioTickets
    --
    -- MES:
    -- Utiliza Calendar_YearMonth
    --
    -- FECHAS:
    -- Utiliza FechaRegistro
    --
    -- DEFAULT = SLOT 0
    ------------------------------------------------------------
    @TipoPeriodo VARCHAR(20) = 'SLOT',

    ------------------------------------------------------------
    -- SLOT
    -- Default = 0
    ------------------------------------------------------------
    @Slot INT = 0,

    ------------------------------------------------------------
    -- MES
    -- Ejemplo:
    -- '2026-11'
    ------------------------------------------------------------
    @CalendarYearMonth VARCHAR(7) = NULL,

    ------------------------------------------------------------
    -- FECHAS PERSONALIZADAS
    ------------------------------------------------------------
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,

    ------------------------------------------------------------
    -- SERVICIOS
    --
    -- NULL o vacío:
    -- devuelve TOTAL de todos los servicios.
    --
    -- Uno:
    -- N'S-Equipo de Computo'
    --
    -- Varios:
    -- N'S-Equipo de Computo|S-Biometrico|S-Caja General'
    ------------------------------------------------------------
    @Servicios NVARCHAR(MAX) = NULL
)
AS
BEGIN

    SET NOCOUNT ON;

    ------------------------------------------------------------
    -- 1. NORMALIZAR PARAMETROS
    ------------------------------------------------------------
    SET @TipoPeriodo =
        UPPER(LTRIM(RTRIM(@TipoPeriodo)));

    SET @Servicios =
        NULLIF(
            LTRIM(RTRIM(@Servicios)),
            N''
        );


    ------------------------------------------------------------
    -- 2. VALIDAR TIPO DE PERIODO
    ------------------------------------------------------------
    IF @TipoPeriodo NOT IN
    (
        'SLOT',
        'MES',
        'FECHAS'
    )
    BEGIN

        RAISERROR(
            'El @TipoPeriodo debe ser SLOT, MES o FECHAS.',
            16,
            1
        );

        RETURN;

    END;


    ------------------------------------------------------------
    -- 3. TABLA TEMPORAL DE SERVICIOS SELECCIONADOS
    ------------------------------------------------------------
    CREATE TABLE #ServiciosSeleccionados
    (
        RamaServicio NVARCHAR(255) NOT NULL
            PRIMARY KEY
    );


    ------------------------------------------------------------
    -- Separar servicios recibidos
    ------------------------------------------------------------
    IF @Servicios IS NOT NULL
    BEGIN

        INSERT INTO #ServiciosSeleccionados
        (
            RamaServicio
        )

        SELECT DISTINCT

            LTRIM(RTRIM(value))

        FROM STRING_SPLIT(
            @Servicios,
            '|'
        )

        WHERE NULLIF(
            LTRIM(RTRIM(value)),
            N''
        ) IS NOT NULL;

    END;


    ------------------------------------------------------------
    -- 4. SLOT
    ------------------------------------------------------------
    IF @TipoPeriodo = 'SLOT'
    BEGIN

        IF @Slot IS NULL
            SET @Slot = 0;


        IF @Slot < 0
        BEGIN

            RAISERROR(
                '@Slot no puede ser negativo.',
                16,
                1
            );

            RETURN;

        END;


        --------------------------------------------------------
        -- Tomar rango real existente para ese Slot
        --------------------------------------------------------
        SELECT

            @FechaInicio =
                MIN(
                    CAST(
                        FechaRegistro AS DATE
                    )
                ),

            @FechaFin =
                MAX(
                    CAST(
                        FechaRegistro AS DATE
                    )
                )

        FROM dbo.vw_ServicioTickets

        WHERE Slot = @Slot;


        IF @FechaInicio IS NULL
           OR @FechaFin IS NULL
        BEGIN

            RAISERROR(
                'No se encontraron tickets para el Slot solicitado.',
                16,
                1
            );

            RETURN;

        END;

    END;


    ------------------------------------------------------------
    -- 5. MES
    ------------------------------------------------------------
    IF @TipoPeriodo = 'MES'
    BEGIN

        IF @CalendarYearMonth IS NULL
           OR LTRIM(RTRIM(@CalendarYearMonth)) = ''
        BEGIN

            RAISERROR(
                'Para MES debes enviar @CalendarYearMonth. Ejemplo: 2026-11.',
                16,
                1
            );

            RETURN;

        END;


        --------------------------------------------------------
        -- Convertir YYYY-MM a primer día del mes
        --------------------------------------------------------
        SET @FechaInicio =
            TRY_CONVERT(
                DATE,
                @CalendarYearMonth + '-01'
            );


        IF @FechaInicio IS NULL
        BEGIN

            RAISERROR(
                '@CalendarYearMonth debe tener formato YYYY-MM.',
                16,
                1
            );

            RETURN;

        END;


        --------------------------------------------------------
        -- Mes actual = hasta hoy
        -- Mes histórico = mes completo
        --------------------------------------------------------
        IF YEAR(@FechaInicio) = YEAR(GETDATE())
           AND MONTH(@FechaInicio) = MONTH(GETDATE())
        BEGIN

            SET @FechaFin =
                CAST(GETDATE() AS DATE);

        END;

        ELSE
        BEGIN

            SET @FechaFin =
                EOMONTH(@FechaInicio);

        END;


        --------------------------------------------------------
        -- No permitir meses futuros
        --------------------------------------------------------
        IF @FechaInicio > CAST(GETDATE() AS DATE)
        BEGIN

            RAISERROR(
                'No se puede consultar un mes futuro.',
                16,
                1
            );

            RETURN;

        END;


        --------------------------------------------------------
        -- Validar existencia del mes
        --------------------------------------------------------
        IF NOT EXISTS
        (
            SELECT 1

            FROM dbo.vw_ServicioTickets

            WHERE Calendar_YearMonth =
                @CalendarYearMonth
        )
        BEGIN

            RAISERROR(
                'No se encontraron tickets para el mes solicitado.',
                16,
                1
            );

            RETURN;

        END;

    END;


    ------------------------------------------------------------
    -- 6. FECHAS PERSONALIZADAS
    ------------------------------------------------------------
    IF @TipoPeriodo = 'FECHAS'
    BEGIN

        IF @FechaInicio IS NULL
           OR @FechaFin IS NULL
        BEGIN

            RAISERROR(
                'Para FECHAS debes enviar @FechaInicio y @FechaFin.',
                16,
                1
            );

            RETURN;

        END;


        IF @FechaInicio > @FechaFin
        BEGIN

            RAISERROR(
                '@FechaInicio no puede ser mayor que @FechaFin.',
                16,
                1
            );

            RETURN;

        END;


        IF @FechaFin > CAST(GETDATE() AS DATE)
        BEGIN

            RAISERROR(
         '@FechaFin no puede ser una fecha futura.',
                16,
                1
            );

            RETURN;

        END;

    END;


    ------------------------------------------------------------
    -- 7. VALIDAR SELECCION DE SERVICIOS
    ------------------------------------------------------------
    IF @Servicios IS NOT NULL

       AND NOT EXISTS
       (
           SELECT 1
           FROM #ServiciosSeleccionados
       )
    BEGIN

        RAISERROR(
            'No se recibieron servicios validos.',
            16,
            1
        );

        RETURN;

    END;


    ------------------------------------------------------------
    -- 8. CONTAR SERVICIOS SELECCIONADOS
    ------------------------------------------------------------
    DECLARE @CantidadServicios INT;

    IF @Servicios IS NULL
    BEGIN

        SET @CantidadServicios =

        (
            SELECT
                COUNT(
                    DISTINCT
                    LTRIM(RTRIM(RamaServicio))
                )

            FROM dbo.vw_ServicioTickets

            WHERE NULLIF(
                LTRIM(RTRIM(RamaServicio)),
                N''
            ) IS NOT NULL
        );

    END;

    ELSE
    BEGIN

        SELECT
            @CantidadServicios = COUNT(*)

        FROM #ServiciosSeleccionados;

    END;


    ------------------------------------------------------------
    -- 9. GENERAR CALENDARIO DEL PERIODO
    ------------------------------------------------------------
    ;WITH Fechas AS
    (
        SELECT
            @FechaInicio AS Fecha

        UNION ALL

        SELECT
            DATEADD(
                DAY,
                1,
                Fecha
            )

        FROM Fechas

        WHERE Fecha < @FechaFin
    ),


    ------------------------------------------------------------
    -- 10. TICKETS BASE
    --
    -- Primero filtramos exactamente el universo correspondiente.
    ------------------------------------------------------------
    TicketsBase AS
    (
        SELECT

            CAST(
                V.FechaRegistro AS DATE
            ) AS Fecha,

            LTRIM(
                RTRIM(
                    V.RamaServicio
                )
            ) AS RamaServicio,

            V.CodigoTicket

        FROM dbo.vw_ServicioTickets V

        WHERE
            V.RamaServicio IS NOT NULL

            AND NULLIF(
                LTRIM(
                    RTRIM(
                        V.RamaServicio
                    )
                ),
                N''
            ) IS NOT NULL


            ----------------------------------------------------
            -- Servicio seleccionado
            ----------------------------------------------------
            AND
            (
                @Servicios IS NULL

                OR EXISTS
                (
                    SELECT 1

                    FROM #ServiciosSeleccionados SS

                    WHERE SS.RamaServicio =
                        LTRIM(
                            RTRIM(
                                V.RamaServicio
                            )
                        )
                )
            )


            ----------------------------------------------------
            -- SLOT
            ----------------------------------------------------
            AND
            (
                @TipoPeriodo <> 'SLOT'

                OR V.Slot = @Slot
            )


            ----------------------------------------------------
            -- MES
            ----------------------------------------------------
            AND
            (
                @TipoPeriodo <> 'MES'

                OR V.Calendar_YearMonth =
                    @CalendarYearMonth
            )


            ----------------------------------------------------
            -- Fecha
            ----------------------------------------------------
            AND V.FechaRegistro >= @FechaInicio

            AND V.FechaRegistro <
                DATEADD(
                    DAY,
                    1,
                    @FechaFin
                )
    ),


    ------------------------------------------------------------
    -- 11. TOTAL DIARIO
    --
    -- Sirve tanto para TOTAL como para mostrar el total combinado
    -- cuando existen varios servicios seleccionados.
    ------------------------------------------------------------
    TotalDiario AS
    (
        SELECT

            Fecha,

            COUNT(
                DISTINCT CodigoTicket
            ) AS TicketsTotalDia

        FROM TicketsBase

        GROUP BY Fecha
    ),


    ------------------------------------------------------------
    -- 12. TICKETS POR SERVICIO/DIA
    ------------------------------------------------------------
    TicketsPorServicio AS
    (
        SELECT

            Fecha,

            RamaServicio,

            COUNT(
                DISTINCT CodigoTicket
            ) AS TicketsServicio

        FROM TicketsBase

        GROUP BY
            Fecha,
            RamaServicio
    ),


    ------------------------------------------------------------
    -- 13. CALENDARIO DE SERVICIOS
    --
    -- Solo se requiere cuando hay servicios seleccionados.
    -- Nos permite regresar 0 cuando un servicio no tuvo tickets.
    ------------------------------------------------------------
    FechaServicio AS
    (
        SELECT

            F.Fecha,

            SS.RamaServicio

        FROM Fechas F

        CROSS JOIN #ServiciosSeleccionados SS
    ),


    ------------------------------------------------------------
    -- 14. RESULTADO INTERMEDIO
    ------------------------------------------------------------
    Resultado AS
    (
        --------------------------------------------------------
        -- CASO A:
        -- No se seleccionó ningún servicio.
        --
        -- Regresamos una sola serie TOTAL.
        --------------------------------------------------------
        SELECT

            F.Fecha,

            CAST(
                'TOTAL'
                AS NVARCHAR(255)
            ) AS RamaServicio,

            ISNULL(
                TD.TicketsTotalDia,
                0
            ) AS TicketsServicio,

            ISNULL(
                TD.TicketsTotalDia,
                0
            ) AS TicketsTotalDia

        FROM Fechas F

        LEFT JOIN TotalDiario TD
            ON TD.Fecha = F.Fecha

        WHERE @Servicios IS NULL


        UNION ALL


        --------------------------------------------------------
        -- CASO B:
        -- Uno o varios servicios seleccionados.
        --
        -- Regresamos una fila por servicio/día.
        --------------------------------------------------------
        SELECT

            FS.Fecha,

            FS.RamaServicio,

            ISNULL(
                TPS.TicketsServicio,
                0
            ) AS TicketsServicio,

            ISNULL(
                TD.TicketsTotalDia,
                0
            ) AS TicketsTotalDia

        FROM FechaServicio FS

        LEFT JOIN TicketsPorServicio TPS

            ON TPS.Fecha =
                FS.Fecha

           AND TPS.RamaServicio =
                FS.RamaServicio

        LEFT JOIN TotalDiario TD

            ON TD.Fecha =
                FS.Fecha

        WHERE @Servicios IS NOT NULL
    )


    ------------------------------------------------------------
    -- 15. RESULTADO FINAL
    ------------------------------------------------------------
    SELECT

        @TipoPeriodo
            AS TipoPeriodo,


        CASE

            WHEN @TipoPeriodo = 'SLOT'
                THEN @Slot

            ELSE NULL

        END AS Slot,


        CASE

            WHEN @TipoPeriodo = 'MES'
                THEN @CalendarYearMonth

            ELSE NULL

        END AS CalendarYearMonth,


        @FechaInicio
            AS FechaInicioPeriodo,


        @FechaFin
            AS FechaFinPeriodo,


        CASE

            ----------------------------------------------------
            -- Ningún servicio
            ----------------------------------------------------
            WHEN @Servicios IS NULL
                THEN 'TODOS LOS SERVICIOS'


            ----------------------------------------------------
            -- Uno
            ----------------------------------------------------
            WHEN @CantidadServicios = 1
                THEN
                (
                    SELECT TOP 1
                        RamaServicio

                    FROM #ServiciosSeleccionados
                )


            ----------------------------------------------------
            -- Varios
            ----------------------------------------------------
            ELSE
                CONCAT(
                    @CantidadServicios,
                    ' SERVICIOS SELECCIONADOS'
                )

        END AS SeleccionServicios,


        @CantidadServicios
            AS CantidadServiciosSeleccionados,


        R.Fecha,


        R.RamaServicio,


        R.TicketsServicio,


        R.TicketsTotalDia


    FROM Resultado R


    ORDER BY

        R.Fecha,

        R.RamaServicio


    OPTION (MAXRECURSION 0);

END
GO
