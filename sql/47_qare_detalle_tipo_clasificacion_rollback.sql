/* =========================================================================
   sql/47_qare_detalle_tipo_clasificacion_rollback.sql - Deshace sql/47:
   dbo.usp_QARE_DetalleEvidencia vuelve al texto de sql/46 (14 columnas).
   ALTER; conserva permisos.

   PRECONDICION: el hash de sql/47 0xD7AC3BB0EA0DB1897F20BF73E702A70CD804E24438B8140BA7BF62D0112B2A47
     Si ya esta el de sql/46: "sql/47 no aplicada". Otro texto: se niega.
   POSTCONDICION: el hash de sql/46 0x39AAF29386370C5BF87B2EE2843B4163907216C3809C501B0D5A8E8954FD3115

   COMO CORRERLO (solo con OK), conectado a Tickets_Proactivanet:
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'47R';
     y el script COMPLETO (SSMS o sqlcmd -f 65001). UTF-8 con BOM.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'QarePrueba[_]%'
   AND (DB_NAME() <> N'Tickets_Proactivanet'
        OR ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'47R')
BEGIN
    RAISERROR (N'Rollback 47 SIN APROBAR: solo corre en Tickets_Proactivanet con aprobar_migracion = 47R en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @det varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.usp_QARE_DetalleEvidencia')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));

SELECT Momento = 'antes', Objeto = 'Detalle',
       Estado = CASE WHEN @det IS NULL THEN 'NO EXISTE'
                     WHEN @det = 0xD7AC3BB0EA0DB1897F20BF73E702A70CD804E24438B8140BA7BF62D0112B2A47 THEN 'con sql/47'
                     WHEN @det = 0x39AAF29386370C5BF87B2EE2843B4163907216C3809C501B0D5A8E8954FD3115 THEN 'con sql/46'
                     ELSE 'OTRO TEXTO (no es ni sql/46 ni sql/47)' END,
       Encontrado = CONVERT(varchar(70), @det, 1);

IF @det = 0x39AAF29386370C5BF87B2EE2843B4163907216C3809C501B0D5A8E8954FD3115
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 47: sql/47 no aplicada (ya esta el texto de sql/46). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF @det IS NULL OR @det <> 0xD7AC3BB0EA0DB1897F20BF73E702A70CD804E24438B8140BA7BF62D0112B2A47
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 47: el Detalle no tiene el texto de sql/47. No se modifico nada; ver la columna Estado de "antes". No forzar: volver a leer la definicion.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF COL_LENGTH('dbo.vw_QARE_CalidadCaptura', 'TipoClasificacionRespuesta') IS NULL
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 47: la vista no tiene TipoClasificacionRespuesta. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 47: la transaccion se cerro por un error anterior. No se aplico nada.', 16, 1); SET NOEXEC ON; END;
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


    /* La salida muestra EstadoDescripcionVisual: el filtro acepta esa
       etiqueta o el valor interno de la vista. */
    DECLARE @EstadoInterno VARCHAR(50) =
        CASE @EstadoDescripcion
            WHEN 'RESPUESTA INVALIDA'   THEN 'NO EVALUABLE'
            WHEN 'RESPUESTA ANALIZABLE' THEN 'TEXTO EVALUABLE'
            ELSE @EstadoDescripcion
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
            OR q.EstadoDescripcion = @EstadoInterno
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 47: la transaccion se cerro por un error anterior. No se aplico nada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @det varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.usp_QARE_DetalleEvidencia')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));

IF @det IS NULL OR @det <> 0x39AAF29386370C5BF87B2EE2843B4163907216C3809C501B0D5A8E8954FD3115
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (N'Rollback 47: el texto final no es el esperado (el ALTER fallo, ver mensajes anteriores, o el archivo no se leyo como UTF-8). Se deshizo: el Detalle queda como estaba.', 16, 1);
END
ELSE
BEGIN
    COMMIT TRANSACTION;
    PRINT N'Rollback 47: aplicado. El Detalle vuelve al texto de sql/46.';
END;

-- Se vuelve a leer: tras un ROLLBACK el valor de arriba ya no es el vigente.
SET @det = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
    OBJECT_DEFINITION(OBJECT_ID('dbo.usp_QARE_DetalleEvidencia')) COLLATE Latin1_General_BIN2,
    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
SELECT Momento = 'despues', Objeto = 'Detalle',
       Estado = CASE WHEN @det IS NULL THEN 'NO EXISTE'
                     WHEN @det = 0xD7AC3BB0EA0DB1897F20BF73E702A70CD804E24438B8140BA7BF62D0112B2A47 THEN 'con sql/47'
                     WHEN @det = 0x39AAF29386370C5BF87B2EE2843B4163907216C3809C501B0D5A8E8954FD3115 THEN 'con sql/46'
                     ELSE 'OTRO TEXTO (no es ni sql/46 ni sql/47)' END,
       Encontrado = CONVERT(varchar(70), @det, 1);
GO
SET NOEXEC OFF;
GO
