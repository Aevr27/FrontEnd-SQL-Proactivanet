/* =====================================================================================
   82_pareto_por_servicio_rollback.sql

   Deshace 82_pareto_por_servicio.sql: deja dbo.usp_CorreoServicio_Pareto
   EXACTAMENTE como estaba en QA el 2026-11-09 (agrupado por RamaServicio,
   seis columnas, sin NombreServicio). Es el mismo bloque de
   81_concentracion_tickets.sql.

   La pestaña del tablero ya no llama a este procedimiento, asi que el
   rollback no requiere tocar el sitio.
   ===================================================================================== */

USE [Tickets_Proactivanet];
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_CorreoServicio_Pareto]

    -- Slot a analizar
    -- Por default = 0
    @Slot INT = 0

AS
BEGIN

    SET NOCOUNT ON;


    ;WITH A AS
    (
        SELECT
            Servicio = LTRIM(RTRIM(RamaServicio)),

            CantidadTickets = COUNT(DISTINCT CodigoTicket)

        FROM dbo.vw_ServicioTickets

        WHERE Slot = @Slot
          AND NULLIF(LTRIM(RTRIM(RamaServicio)), N'') IS NOT NULL

        GROUP BY
            LTRIM(RTRIM(RamaServicio))
    ),

    P AS
    (
        SELECT
            Servicio,
            CantidadTickets,

            TotalTickets =
                SUM(CantidadTickets) OVER (),

            Posicion =
                ROW_NUMBER() OVER
                (
                    ORDER BY
                        CantidadTickets DESC,
                        Servicio ASC
                ),

            Porcentaje =
                CAST
                (
                    100.0 * CantidadTickets
                    / NULLIF(
                        SUM(CantidadTickets) OVER (),
                        0
                    )
                    AS DECIMAL(6,2)
                ),

            PorcentajeAcumulado =
                CAST
                (
                    100.0 *
                    SUM(CantidadTickets) OVER
                    (
                        ORDER BY
                            CantidadTickets DESC,
                            Servicio ASC
                        ROWS BETWEEN
                            UNBOUNDED PRECEDING
                            AND CURRENT ROW
                    )
                    /
                    NULLIF(
                        SUM(CantidadTickets) OVER (),
                        0
                    )
                    AS DECIMAL(6,2)
                )

        FROM A
    )

    SELECT
        Posicion,
        Servicio,
        CantidadTickets,
        TotalTickets,
        Porcentaje,
        PorcentajeAcumulado

    FROM P

    ORDER BY Posicion;

END;
GO
