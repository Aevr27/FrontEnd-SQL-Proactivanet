/* =====================================================================================
   81_concentracion_tickets.sql

   Los tres procedimientos dbo.usp_CorreoServicio_Pareto / _TicketsCategoria /
   _TicketsGrupo TAL COMO ESTAN en QA.

   Desde el 2026-11-09 la pestaña "Vista general de servicios" (antes
   "Concentracion de tickets") YA NO LOS LLAMA: necesitaba filtros (Mes,
   Service Owner, Grupo) que solo aceptan @Slot. Lee la misma vista,
   dbo.vw_ServicioTickets, y hace la misma cuenta en App_Code/
   ConcentracionContrato.cs; tools/tests/ConcentracionContratoSmoke.cs
   comprueba sobre LocalDB que categorias y grupos salen identicos a estos
   procedimientos. Siguen en la base sin tocar.

   QUE ES ESTE ARCHIVO
   Un espejo para versionarlos: ya existian en la base pero en ningun
   repositorio. El cuerpo de cada uno es el que devolvio
   sql/diag_concentracion_tickets.sql (seccion 8) el 2026-11-09 en
   AZVMBDCENTRALQA / Tickets_Proactivanet, sin tocar una linea. Lo unico
   distinto es la primera palabra: CREATE OR ALTER en vez de CREATE, para que
   el archivo se pueda volver a correr.

     dbo.usp_CorreoServicio_Pareto            creado 2026-11-03, modificado 2026-11-05 18:01:28
     dbo.usp_CorreoServicio_TicketsCategoria  creado 2026-11-06, modificado 2026-11-06 11:50:29
     dbo.usp_CorreoServicio_TicketsGrupo      creado 2026-11-06, modificado 2026-11-06 11:51:33

   NO HACE FALTA CORRERLO en QA: ya estan asi. Sirve para recrearlos en otra
   base (produccion, LocalDB de pruebas) y es el ROLLBACK del cambio
   propuesto al Pareto (82_pareto_por_servicio_rollback.sql copia su bloque).

   QUE LEEN (diag 1, secciones 5 y 5b; verificado)
     Los tres leen SOLO dbo.vw_ServicioTickets, que a su vez lee:
       dbo.vw_Tickets            el ticket, Categoria, Grupo y el Slot
       dbo.CatServicioCategoria  Servicio -> PrefijoCategoria (las ramas)
       dbo.CatServicioCorreo     solo servicios con Habilitado = 1
       dbo.CatCedis, dbo.CatCausaRaizAgrupador (columnas que aqui no se usan)
       dbo.fn_RutaServicio, fn_CategoriaC1, fn_CategoriaNivel, fn_CategoriaRelativa

   CONTRATO (diag 1 seccion 4; diag 2 seccion C)
     Parametro: @Slot INT = 0.
     Slot (dbo.vw_Tickets): DATEDIFF(DAY, FechaRegistro,
       DATEADD(HOUR, -6, SYSUTCDATETIME())) / 30.0 truncado, o sea
       Slot k = hoy-(30k+29) .. hoy-30k, dias de Mexico, los dos incluidos.
       Slot 0 incluye HOY (diag 2, A3/A5/A6).
     Salida: Posicion BIGINT, <Servicio|Categoria|Grupo>, CantidadTickets INT,
       TotalTickets INT, Porcentaje DECIMAL(6,2), PorcentajeAcumulado
       DECIMAL(6,2), escala 0-100, ordenado por Posicion.
     Devuelven TODAS las filas (sin TOP): el acumulado y el corte del 80 %
       son sobre la poblacion completa del slot. El Top 10 / 15 lo pone la
       pestaña al pintar.
     Excluyen la etiqueta vacia o NULL (RamaServicio, Categoria, Grupo), asi
       que cada uno tiene su propio TotalTickets.

   PERMISOS
     PROACTIVANETAD (usuario SQL del sitio) tiene EXECUTE sobre el esquema
     dbo (diag 2, B2): no hace falta GRANT.
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

CREATE OR ALTER PROCEDURE [dbo].[usp_CorreoServicio_TicketsCategoria]

    -- Por default Slot = 0
    @Slot INT = 0

AS
BEGIN

    SET NOCOUNT ON;


    ;WITH A AS
    (
        SELECT
            Categoria = LTRIM(RTRIM(Categoria)),

            CantidadTickets = COUNT(DISTINCT CodigoTicket)

        FROM dbo.vw_ServicioTickets

        WHERE Slot = @Slot
          AND NULLIF(LTRIM(RTRIM(Categoria)), N'') IS NOT NULL

        GROUP BY
            LTRIM(RTRIM(Categoria))
    ),

    P AS
    (
        SELECT
            Categoria,
            CantidadTickets,

            TotalTickets =
                SUM(CantidadTickets) OVER (),

            Posicion =
                ROW_NUMBER() OVER
                (
                    ORDER BY
                        CantidadTickets DESC,
                        Categoria ASC
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
                            Categoria ASC

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
        Categoria,
        CantidadTickets,
        TotalTickets,
        Porcentaje,
        PorcentajeAcumulado

    FROM P

    ORDER BY Posicion;

END;
GO

CREATE OR ALTER PROCEDURE [dbo].[usp_CorreoServicio_TicketsGrupo]

    -- Por default Slot = 0
    @Slot INT = 0

AS
BEGIN

    SET NOCOUNT ON;


    ;WITH A AS
    (
        SELECT
            Grupo = LTRIM(RTRIM(Grupo)),

            CantidadTickets = COUNT(DISTINCT CodigoTicket)

        FROM dbo.vw_ServicioTickets

        WHERE Slot = @Slot
          AND NULLIF(LTRIM(RTRIM(Grupo)), N'') IS NOT NULL

        GROUP BY
            LTRIM(RTRIM(Grupo))
    ),

    P AS
    (
        SELECT
            Grupo,
            CantidadTickets,

            TotalTickets =
                SUM(CantidadTickets) OVER (),

            Posicion =
                ROW_NUMBER() OVER
                (
                    ORDER BY
                        CantidadTickets DESC,
                        Grupo ASC
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
                            Grupo ASC
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
        Grupo,
        CantidadTickets,
        TotalTickets,
        Porcentaje,
        PorcentajeAcumulado

    FROM P

    ORDER BY Posicion;

END;
GO
