/* =========================================================================
   sql/16_qare_filtros_org_rollback.sql - Deshace sql/16_qare_filtros_org.sql.

   Deja los seis dbo.usp_CorreoQARE_* como estaban antes de los filtros
   (solo @FechaInicio / @FechaFin, leyendo dbo.vw_CorreoQARECierre_Base) y
   borra dbo.tvf_CorreoQARE_Base. Los cuerpos son los que devolvio el diag v2
   en la VM (2026-09-25), sin comentarios; 16_qare_filtros_org.sql comprobo
   con los datos reales que dan la misma salida que los nuevos sin filtros.

   OJO: despues de correr esto, el sitio con los filtros de QARE puestos
   recibe error 8144 en los seis bloques (el handler solo manda @C1/@Grupos/
   @Lideres cuando hay algo elegido). Sin filtros sigue funcionando.

   COMO CORRERLO: SSMS, base Tickets_Proactivanet, F5.
   ========================================================================= */


CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_KPIs
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    SELECT
        TotalTicketsPeriodo = COUNT(DISTINCT CodigoTicket),
        TicketsConFrecuencia = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'') IS NOT NULL THEN CodigoTicket END),
        TicketsRecurrentes = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N'FRECUENTE', N'SIEMPRE') THEN CodigoTicket END),
        PorcentajeRecurrencia = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N'FRECUENTE', N'SIEMPRE') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaConfirmacion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARE_VerificoClasificacion)), N'') IS NOT NULL THEN CodigoTicket END),
        TicketsConfirmados = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARE_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN CodigoTicket END),
        PorcentajeConfirmacion = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARE_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARE_VerificoClasificacion)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaReutilizacion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_AplicaOtrosCasos)), N'') IS NOT NULL THEN CodigoTicket END),
        CasosReutilizables = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos))) IN (N'SI', N'SÍ') THEN CodigoTicket END),
        PorcentajeCasosReutilizables = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos))) IN (N'SI', N'SÍ') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_AplicaOtrosCasos)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaKB = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_GenerarArticulo)), N'') IS NOT NULL THEN CodigoTicket END),
        CasosPotencialKB = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_GenerarArticulo))) IN (N'SI', N'SÍ') THEN CodigoTicket END),
        PorcentajePotencialKB = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_GenerarArticulo))) IN (N'SI', N'SÍ') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_GenerarArticulo)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2))
    FROM dbo.vw_CorreoQARECierre_Base
    WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_Frecuencia
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    SELECT Frecuencia = LTRIM(RTRIM(QA_Frecuencia)), CantidadTickets = COUNT(DISTINCT CodigoTicket),
           Porcentaje = CAST(100.0 * COUNT(DISTINCT CodigoTicket) / NULLIF(SUM(COUNT(DISTINCT CodigoTicket)) OVER (), 0) AS DECIMAL(6,2))
    FROM dbo.vw_CorreoQARECierre_Base
    WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'') IS NOT NULL
    GROUP BY LTRIM(RTRIM(QA_Frecuencia))
    ORDER BY CantidadTickets DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_CausaRaiz
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH A AS (
        SELECT CausaRaiz = LTRIM(RTRIM(QARe_Causa)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND NULLIF(LTRIM(RTRIM(QARe_Causa)), N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(QARe_Causa))
    ), P AS (
        SELECT CausaRaiz, CantidadTickets, TotalTicketsConCausa = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, CausaRaiz ASC),
               Porcentaje = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
               PorcentajeAcumulado = CAST(100.0 * SUM(CantidadTickets) OVER (ORDER BY CantidadTickets DESC, CausaRaiz ASC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT Posicion, CausaRaiz, CantidadTickets, TotalTicketsConCausa, Porcentaje, PorcentajeAcumulado
    FROM P ORDER BY Posicion;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_RecurrentesCategoria
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH A AS (
        SELECT Categoria = LTRIM(RTRIM(Categoria)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N'FRECUENTE', N'SIEMPRE')
          AND NULLIF(LTRIM(RTRIM(Categoria)), N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(Categoria))
    ), R AS (
        SELECT Categoria, CantidadTickets, TotalTicketsRecurrentes = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, Categoria ASC),
               PorcentajeRecurrentes = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, Posicion, Categoria, CantidadTickets, TotalTicketsRecurrentes, PorcentajeRecurrentes
    FROM R ORDER BY Posicion;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_ConfirmacionVsQA
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH M AS (
        SELECT ConfirmacionUsuario = CASE
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN N'Sí'
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) = N'NO' THEN N'No'
                   ELSE N'Sin respuesta' END,
               ValidacionQA = ISNULL(NULLIF(LTRIM(RTRIM(Validacion)), N''), N'Sin validación'),
               CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND NULLIF(LTRIM(RTRIM(QARe_VerificoClasificacion)), N'') IS NOT NULL
        GROUP BY CASE
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN N'Sí'
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) = N'NO' THEN N'No'
                   ELSE N'Sin respuesta' END,
                 ISNULL(NULLIF(LTRIM(RTRIM(Validacion)), N''), N'Sin validación')
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, ConfirmacionUsuario, ValidacionQA, CantidadTickets,
           PorcentajeDelTotal = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
           EsInconsistencia = CASE WHEN ConfirmacionUsuario = N'Sí' AND ValidacionQA = N'Incorrecto' THEN 1 ELSE 0 END
    FROM M
    ORDER BY CASE ConfirmacionUsuario WHEN N'Sí' THEN 1 WHEN N'No' THEN 2 ELSE 3 END,
             CASE ValidacionQA WHEN N'OK' THEN 1 WHEN N'Valido' THEN 2 WHEN N'Incorrecto' THEN 3 WHEN N'Sin catalogo' THEN 4 ELSE 5 END;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_TipoSolucion
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH A AS (
        SELECT TipoSolucion = LTRIM(RTRIM(QARe_TipoSolucion)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND NULLIF(LTRIM(RTRIM(QARe_TipoSolucion)), N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(QARe_TipoSolucion))
    ), R AS (
        SELECT TipoSolucion, CantidadTickets, TotalTicketsConTipoSolucion = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, TipoSolucion ASC),
               Porcentaje = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, Posicion, TipoSolucion, CantidadTickets, TotalTicketsConTipoSolucion, Porcentaje
    FROM R ORDER BY Posicion;
END;
GO

DROP FUNCTION IF EXISTS dbo.tvf_CorreoQARE_Base;
GO
