/* =========================================================================
   sql/46_qare_correcciones_detalle_vista_kpis_rollback.sql - Deshace
   sql/46: devuelve dbo.vw_QARE_CalidadCaptura,
   dbo.usp_QARE_DetalleEvidencia y dbo.usp_QARE_CalidadCaptura_KPIs al
   texto que tenian en QA el 2026-11-27 (ALTER; conserva permisos).

   PRECONDICION: los tres hashes de la postcondicion de sql/46. Si ya
     tienen los originales: "sql/46 no aplicada". Otro texto: se niega.
   POSTCONDICION: los hashes originales (precondicion de sql/46). Si no,
     ROLLBACK de los tres.

   COMO CORRERLO (solo con OK), conectado a Tickets_Proactivanet:
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'46R';
     y el script completo (SSMS o sqlcmd -f 65001). UTF-8 con BOM, como
     sql/46.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'QarePrueba[_]%'
   AND (DB_NAME() <> N'Tickets_Proactivanet'
        OR ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'46R')
BEGIN
    RAISERROR (N'Rollback 46 SIN APROBAR: solo corre en Tickets_Proactivanet con aprobar_migracion = 46R en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @vw varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.vw_QARE_CalidadCaptura')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @det varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.usp_QARE_DetalleEvidencia')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @kpis varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.usp_QARE_CalidadCaptura_KPIs')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));

SELECT Momento = 'antes', Objeto = v.Objeto, Hash = CONVERT(varchar(70), v.Hash, 1)
FROM (VALUES ('vista', @vw), ('Detalle', @det), ('KPIs', @kpis)) AS v (Objeto, Hash);

IF @vw = 0x694ADEA4074727AAEF80C7D51C9869288E4F21913BA73D986B0F65492BC3FFDE AND @det = 0xA550312C52A826D8393C3DD7699B02467DB55905DF55C6CB02C90574441AD0B3 AND @kpis = 0x16BDA99F58438F35F2C8626A146DEBE1608E6A93D7D9894DF147D26854E6C9C2
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 46: sql/46 no aplicada (ya estan los originales). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF @vw IS NULL OR @det IS NULL OR @kpis IS NULL
     OR @vw <> 0xB439CDAB6732CFF718E647DDC05453664DB0BEEB8312F6E290BC02DADFCF4C60 OR @det <> 0x39AAF29386370C5BF87B2EE2843B4163907216C3809C501B0D5A8E8954FD3115 OR @kpis <> 0xEBAECA25172A93B09E4DA8A3258D9301E89C6A7EB1C888A562B8696AF4B3D3B1
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 46: el texto de algun objeto no es el de sql/46 (ver hashes "antes"). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF EXISTS (SELECT 1 FROM sys.sql_expression_dependencies
                WHERE referenced_id = OBJECT_ID('dbo.vw_QARE_CalidadCaptura')
                  AND is_schema_bound_reference = 1)
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 46: hay objetos con SCHEMABINDING sobre la vista. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 46: la transaccion se cerro por un error anterior. No se aplico nada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER VIEW [dbo].[vw_QARE_CalidadCaptura]
AS

SELECT
    t.CodigoTicket,
    t.FechaRegistroDia,
    t.FechaFirmaSolucion,
    t.FirmaSolucion,
    t.Grupo,
    t.Categoria,
    t.Validacion,
    t.Slot,

    /* =========================================================
       DESCRIPCION ABIERTA QARE
       ========================================================= */

    t.QARe_DescripcionSolucion,

    flags.SolucionNoDescriptiva,


    /* =========================================================
       1. ESTADO DEL TEXTO

       Solo responde:
       ¿Existe texto que pueda analizarse?

       Valores:
       - SIN INFORMACION QARE
       - NO EVALUABLE
       - TEXTO EVALUABLE
       ========================================================= */

    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
        THEN 'SIN INFORMACION QARE'

        WHEN flags.SolucionNoDescriptiva = 1
        THEN 'NO EVALUABLE'

        ELSE 'TEXTO EVALUABLE'

    END AS EstadoDescripcion,


    /* =========================================================
       2. CLASIFICACION DE LA RESPUESTA

       Solo aplica cuando el texto es evaluable.

       Prioridad:
       1. Regla CALIDAD
       2. Regla PATRON_SOLUCION
       3. SIN PATRON IDENTIFICADO
       ========================================================= */

    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
        THEN NULL

        WHEN flags.SolucionNoDescriptiva = 1
        THEN NULL

        /* Problema/no solucion o sin accion documentada */
        WHEN calidad.ClasificacionCalidad IS NOT NULL
        THEN calidad.ClasificacionCalidad

        /* Patron de solucion reconocido */
        WHEN patron.PatronSolucion IS NOT NULL
        THEN patron.PatronSolucion

        /* Hay texto pero no podemos determinar qué representa */
        ELSE 'SIN PATRON IDENTIFICADO'

    END AS ClasificacionRespuesta,


    /* =========================================================
       3. PATRON SOLUCION

       Se conserva temporalmente para no romper los SP actuales.

       IMPORTANTE:
       Solo contiene patrones de solucion reales.

       Las reglas CALIDAD no aparecen aqui.
       ========================================================= */

    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
        THEN NULL

        WHEN flags.SolucionNoDescriptiva = 1
        THEN NULL

        WHEN calidad.ClasificacionCalidad IS NOT NULL
        THEN NULL

        ELSE COALESCE(
            patron.PatronSolucion,
            'SIN CLASIFICAR'
        )

    END AS PatronSolucion,


    /* =========================================================
       4. AUDITORIA DEL PATRON DE SOLUCION
       ========================================================= */

    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
          OR flags.SolucionNoDescriptiva = 1
          OR calidad.ClasificacionCalidad IS NOT NULL
        THEN NULL

        ELSE patron.IdReglaPatron

    END AS IdReglaPatron,


    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
          OR flags.SolucionNoDescriptiva = 1
          OR calidad.ClasificacionCalidad IS NOT NULL
        THEN NULL

        ELSE patron.FrasePatron

    END AS FrasePatron,


    /* =========================================================
       5. AUDITORIA DE CLASIFICACION CALIDAD
       ========================================================= */

    calidad.IdReglaCalidad,
    calidad.FraseCalidad,


    /* =========================================================
       6. REGLA FINAL QUE CLASIFICO LA RESPUESTA

       Muy util para auditoria futura.
       ========================================================= */

    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
          OR flags.SolucionNoDescriptiva = 1
        THEN NULL

        WHEN calidad.IdReglaCalidad IS NOT NULL
        THEN calidad.IdReglaCalidad

        ELSE patron.IdReglaPatron

    END AS IdReglaClasificacion,


    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
          OR flags.SolucionNoDescriptiva = 1
        THEN NULL

        WHEN calidad.FraseCalidad IS NOT NULL
        THEN calidad.FraseCalidad

        ELSE patron.FrasePatron

    END AS FraseClasificacion,


    /* =========================================================
       7. TIPO DE CLASIFICACION
       ========================================================= */

    CASE

        WHEN t.QARe_DescripcionSolucion IS NULL
          OR LTRIM(RTRIM(t.QARe_DescripcionSolucion)) = ''
          OR flags.SolucionNoDescriptiva = 1
        THEN NULL

        WHEN calidad.ClasificacionCalidad IS NOT NULL
        THEN 'CALIDAD'

        WHEN patron.PatronSolucion IS NOT NULL
        THEN 'PATRON_SOLUCION'

        ELSE 'SIN PATRON'

    END AS TipoClasificacionRespuesta,


    /* =========================================================
       PREGUNTAS CERRADAS
       ========================================================= */

    t.QARe_Causa,
    t.QARe_AplicaOtrosCasos,
    t.QARe_GenerarArticulo,
    t.QARe_VerificoClasificacion,
    t.QARe_TipoSolucion


FROM dbo.vw_CorreoQARECierre_Base AS t


/* =============================================================
   CATALOGO RESPUESTAS INVALIDAS
   ============================================================= */

LEFT JOIN dbo.CatQARE_RespuestaInvalida AS s

    ON s.Campo = 'QARe_DescripcionSolucion'
    AND s.Activo = 1

    AND UPPER(
        LTRIM(RTRIM(t.QARe_DescripcionSolucion))
    )
    =
    UPPER(
        LTRIM(RTRIM(s.Valor))
    )


/* =============================================================
   VALIDACION BASICA

   Determina únicamente si el texto puede evaluarse.
   ============================================================= */

CROSS APPLY
(
    SELECT

        CASE

            WHEN s.Valor IS NOT NULL
            THEN 1


            WHEN LTRIM(
                    RTRIM(
                        ISNULL(
                            t.QARe_DescripcionSolucion,
                            ''
                        )
                    )
                 ) <> ''

             AND LTRIM(
                    RTRIM(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                        REPLACE(
                            ISNULL(
                                t.QARe_DescripcionSolucion,
                                ''
                            ),
                            '.', ''),
                            ',', ''),
                            '*', ''),
                            '-', ''),
                            '_', ''),
                            '/', ''),
                            '\', ''),
                            ';', ''),
                            ':', ''),
                            CHAR(9), ''),
                            ' ', '')
                    )
                 ) = ''

            THEN 1


            ELSE 0

        END AS SolucionNoDescriptiva

) AS flags


/* =============================================================
   REGLAS TIPO CALIDAD

   Ejemplo:
   FALLA IMPRESORA
       -> PROBLEMA / NO SOLUCION

   FALTA DE INFORMACION
       -> RESPUESTA SIN ACCION DOCUMENTADA

   Coincidencia exacta para mantener precisión.
   ============================================================= */

OUTER APPLY
(
    SELECT TOP (1)

        r.Patron AS ClasificacionCalidad,
        r.IdRegla AS IdReglaCalidad,
        r.PalabraClave AS FraseCalidad

    FROM dbo.CatQARE_PatronSolucion AS r

    WHERE
        r.Activo = 1

        AND r.TipoClasificacion = 'CALIDAD'

        AND t.QARe_DescripcionSolucion IS NOT NULL

        AND UPPER(
                LTRIM(
                    RTRIM(t.QARe_DescripcionSolucion)
                )
            )
            =
            UPPER(
                LTRIM(
                    RTRIM(r.PalabraClave)
                )
            )

    ORDER BY
        r.Orden,
        LEN(r.PalabraClave) DESC,
        r.IdRegla

) AS calidad


/* =============================================================
   REGLAS TIPO PATRON_SOLUCION

   Busca una acción reconocible dentro de la descripción.
   ============================================================= */

OUTER APPLY
(
    SELECT TOP (1)

        r.Patron AS PatronSolucion,
        r.IdRegla AS IdReglaPatron,
        r.PalabraClave AS FrasePatron

    FROM dbo.CatQARE_PatronSolucion AS r

    WHERE
        r.Activo = 1

        AND r.TipoClasificacion = 'PATRON_SOLUCION'

        AND t.QARe_DescripcionSolucion IS NOT NULL

        AND LTRIM(
                RTRIM(t.QARe_DescripcionSolucion)
            ) <> ''

        AND UPPER(t.QARe_DescripcionSolucion)
            LIKE '%' + UPPER(r.PalabraClave) + '%'

    ORDER BY
        r.Orden,
        LEN(r.PalabraClave) DESC,
        r.IdRegla

) AS patron;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 46: la transaccion se cerro por un error anterior. No se aplico nada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER PROCEDURE dbo.usp_QARE_DetalleEvidencia
    @FechaInicio            DATE = NULL,
    @FechaFin               DATE = NULL,
    @Grupo                  VARCHAR(250) = NULL,
    @FirmaSolucion          VARCHAR(250) = NULL,
    @Categoria              VARCHAR(500) = NULL,
    @EstadoDescripcion      VARCHAR(50) = NULL,
    @ClasificacionRespuesta VARCHAR(150) = NULL
AS
BEGIN

    SET NOCOUNT ON;


    /* ============================================================
       VALIDACION DE PARAMETROS
       ============================================================ */

    IF @FechaInicio IS NOT NULL
       AND @FechaFin IS NOT NULL
       AND @FechaInicio > @FechaFin
    BEGIN

        THROW 50001,
              'La FechaInicio no puede ser mayor que la FechaFin.',
              1;

    END;


    /* ============================================================
       DETALLE QARE POR TICKET

       Objetivo:
       Mostrar evidencia completa para auditoria/exploracion.

       Incluye:
       - contexto del ticket
       - pregunta abierta
       - estado de la respuesta abierta
       - clasificacion encontrada
       - regla que genero la clasificacion
       - preguntas cerradas QARE

       IMPORTANTE:
       Este SP NO vuelve a clasificar.
       Consume el resultado de vw_QARE_CalidadCaptura.
       ============================================================ */

    SELECT

        /* =====================================================
           IDENTIFICACION DEL TICKET
           ===================================================== */

        q.CodigoTicket,
        --q.FechaRegistroDia,
        q.FechaFirmaSolucion,
        q.FirmaSolucion,
        q.Grupo,
        q.Categoria,
        q.Validacion,
        --q.Slot,

		q.QARe_Causa,
        q.QARe_AplicaOtrosCasos,
        q.QARe_GenerarArticulo,
        q.QARe_VerificoClasificacion,
        q.QARe_TipoSolucion,

        /* =====================================================
           PREGUNTA ABIERTA
           ===================================================== */

        q.QARe_DescripcionSolucion,


        /* Estado técnico guardado en la vista */
        --q.EstadoDescripcion,


        /* Etiqueta amigable para dashboard */
        CASE

            WHEN q.EstadoDescripcion = 'SIN INFORMACION QARE'
            THEN 'SIN INFORMACION QARE'

            WHEN q.EstadoDescripcion = 'NO EVALUABLE'
            THEN 'RESPUESTA INVALIDA'

            WHEN q.EstadoDescripcion = 'TEXTO EVALUABLE'
            THEN 'RESPUESTA ANALIZABLE'

            ELSE q.EstadoDescripcion

        END AS EstadoDescripcionVisual,


        /* =====================================================
           CLASIFICACION DE LA RESPUESTA ABIERTA

           Ejemplos:
           CONFIGURACION
           REINICIO / REACTIVACION
           PROBLEMA / NO SOLUCION
           RESPUESTA SIN ACCION DOCUMENTADA
           SIN PATRON IDENTIFICADO
           ===================================================== */

        q.ClasificacionRespuesta


        /* Tipo interno:
           PATRON_SOLUCION
           CALIDAD
           SIN PATRON
        */

        --q.TipoClasificacionRespuesta,


        /* Etiqueta visual */
        --CASE

            --WHEN q.TipoClasificacionRespuesta = 'PATRON_SOLUCION'
            --THEN 'SOLUCION IDENTIFICADA'

            --WHEN q.TipoClasificacionRespuesta = 'CALIDAD'
            --THEN 'RESPUESTA INCOMPLETA'

            --WHEN q.TipoClasificacionRespuesta = 'SIN PATRON'
            --THEN 'SIN CLASIFICAR'

            --ELSE NULL

        --END AS TipoClasificacionVisual,


        /* =====================================================
           AUDITORIA

           Permite saber qué regla del catálogo provocó
           la clasificación.
           ===================================================== */

        --q.IdReglaClasificacion,
        --q.FraseClasificacion,


        /* =====================================================
           PREGUNTAS CERRADAS QARE

           Se muestran TAL CUAL fueron registradas.

           Si contienen NA, N/A, vacíos, etc.,
           aquí podremos verlo directamente.
           ===================================================== */




    FROM dbo.vw_QARE_CalidadCaptura AS q


    WHERE

        /* =====================================================
           PERIODO
           ===================================================== */

        (
            @FechaInicio IS NULL
            OR q.FechaFirmaSolucion >= @FechaInicio
        )

        AND

        (
            @FechaFin IS NULL
            OR q.FechaFirmaSolucion < DATEADD(DAY, 1, @FechaFin)
        )


        /* =====================================================
           GRUPO
           ===================================================== */

        AND
        (
            @Grupo IS NULL
            OR q.Grupo = @Grupo
        )


        /* =====================================================
           TECNICO
           ===================================================== */

        AND
        (
            @FirmaSolucion IS NULL
            OR q.FirmaSolucion = @FirmaSolucion
        )


        /* =====================================================
           CATEGORIA
           ===================================================== */

        AND
        (
            @Categoria IS NULL
            OR q.Categoria = @Categoria
        )


        /* =====================================================
           ESTADO DE LA RESPUESTA ABIERTA
           ===================================================== */

        AND
        (
            @EstadoDescripcion IS NULL
            OR q.EstadoDescripcion = @EstadoDescripcion
        )


        /* =====================================================
           CLASIFICACION
           ===================================================== */

        AND
        (
            @ClasificacionRespuesta IS NULL
            OR q.ClasificacionRespuesta =
               @ClasificacionRespuesta
        )


    ORDER BY

        q.FechaFirmaSolucion DESC,
        q.CodigoTicket DESC;

END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 46: la transaccion se cerro por un error anterior. No se aplico nada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER PROCEDURE dbo.usp_QARE_CalidadCaptura_KPIs
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL
AS
BEGIN

    SET NOCOUNT ON;


    SELECT

        /* =====================================================
           1. TOTAL DE TICKETS
           ===================================================== */

        COUNT(DISTINCT CodigoTicket)
            AS TicketsTotales,


        /* =====================================================
           2. SIN INFORMACION QARE

           La pregunta no tiene contenido.
           ===================================================== */

        COUNT(
            DISTINCT CASE
                WHEN EstadoDescripcion = 'SIN INFORMACION QARE'
                THEN CodigoTicket
            END
        ) AS TicketsSinInformacionQARE,


        /* =====================================================
           3. TICKETS EVALUADOS

           Todo ticket que sí tiene contenido QARE.
           ===================================================== */

        COUNT(
            DISTINCT CASE
                WHEN EstadoDescripcion <> 'SIN INFORMACION QARE'
                THEN CodigoTicket
            END
        ) AS TicketsEvaluados,


        /* =====================================================
           4. NO EVALUABLE

           Respuestas inválidas:
           NA, N/A, 0, símbolos, etc.
           ===================================================== */

        COUNT(
            DISTINCT CASE
                WHEN EstadoDescripcion = 'NO EVALUABLE'
                THEN CodigoTicket
            END
        ) AS TicketsNoEvaluables,


        CAST(
            100.0 *
            COUNT(
                DISTINCT CASE
                    WHEN EstadoDescripcion = 'NO EVALUABLE'
                    THEN CodigoTicket
                END
            )
            /
            NULLIF(
                COUNT(
                    DISTINCT CASE
                        WHEN EstadoDescripcion <> 'SIN INFORMACION QARE'
                        THEN CodigoTicket
                    END
                ),
                0
            )
            AS DECIMAL(10,2)
        ) AS PctNoEvaluable,


        /* =====================================================
           5. TEXTO EVALUABLE

           Tiene contenido suficiente para intentar clasificarlo.
           ===================================================== */

        COUNT(
            DISTINCT CASE
                WHEN EstadoDescripcion = 'TEXTO EVALUABLE'
                THEN CodigoTicket
            END
        ) AS TicketsTextoEvaluable,


        CAST(
            100.0 *
            COUNT(
                DISTINCT CASE
                    WHEN EstadoDescripcion = 'TEXTO EVALUABLE'
                    THEN CodigoTicket
                END
            )
            /
            NULLIF(
                COUNT(
                    DISTINCT CASE
                        WHEN EstadoDescripcion <> 'SIN INFORMACION QARE'
                        THEN CodigoTicket
                    END
                ),
                0
            )
            AS DECIMAL(10,2)
        ) AS PctTextoEvaluable


    FROM dbo.vw_QARE_CalidadCaptura

    WHERE

        (
            @FechaInicio IS NULL
            OR FechaFirmaSolucion >= @FechaInicio
        )

        AND

        (
            @FechaFin IS NULL
            OR FechaFirmaSolucion < DATEADD(DAY, 1, @FechaFin)
        );

END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 46: la transaccion se cerro por un error anterior. No se aplico nada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @vw varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.vw_QARE_CalidadCaptura')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @det varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.usp_QARE_DetalleEvidencia')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @kpis varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.usp_QARE_CalidadCaptura_KPIs')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));

IF @vw IS NULL OR @det IS NULL OR @kpis IS NULL
   OR @vw <> 0x694ADEA4074727AAEF80C7D51C9869288E4F21913BA73D986B0F65492BC3FFDE OR @det <> 0xA550312C52A826D8393C3DD7699B02467DB55905DF55C6CB02C90574441AD0B3 OR @kpis <> 0x16BDA99F58438F35F2C8626A146DEBE1608E6A93D7D9894DF147D26854E6C9C2
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 46: el texto final no es el esperado (encoding del archivo?). Se deshizo todo.', 16, 1);
    SET NOEXEC ON;
END
ELSE
    COMMIT TRANSACTION;

SELECT Momento = 'despues', Objeto = v.Objeto, Hash = CONVERT(varchar(70), v.Hash, 1)
FROM (VALUES ('vista', @vw), ('Detalle', @det), ('KPIs', @kpis)) AS v (Objeto, Hash);

SELECT Momento = 'despues', Filas = COUNT(*), Tickets = COUNT(DISTINCT CodigoTicket)
FROM dbo.vw_QARE_CalidadCaptura;
GO
SET NOEXEC OFF;
GO
