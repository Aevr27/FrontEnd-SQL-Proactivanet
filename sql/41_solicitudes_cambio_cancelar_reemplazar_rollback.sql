/* =========================================================================
   sql/41_solicitudes_cambio_cancelar_reemplazar_rollback.sql - deshace
   sql/41 COMPLETA: adm.SolicitudCambio y su bitacora vuelven a la forma de
   sql/22 (+25, 34, 37) en lo que 41 toco.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitudesCancelarReemplazarSqlLocalDbSmoke.cs).

   QUE HACE (una transaccion)
     DROP de adm.usp_SolicitudCambio_Reemplazar y _Cancelar (si existen;
       sirve tambien despues de _rollback_procedimiento.sql).
     CHECK: CK_SolicitudCambio_EstadoCancelada, _RevisionCancelacion,
       _ReemplazaA y CK_SolicitudCambioEvento_EventoCancelada fuera;
       CK_SolicitudCambio_Estado, CK_SolicitudCambio_Revision y
       CK_SolicitudCambioEvento_Evento de vuelta con el texto EXACTO de sql/22.
     UX_SolicitudCambio_ReemplazaA, FK_SolicitudCambio_ReemplazaA y las
       columnas ReemplazaA, CanceladoPor, FechaCancelacionUtc,
       MotivoCancelacion fuera.
   NO TOCA: Crear, Aplicar, Rechazar, RegistrarFallo, filas, permisos.

   SE NIEGA, sin tocar nada, si hay CUALQUIER rastro de uso: una solicitud
     CANCELADA, una columna de 41 con valor, o un evento CANCELADA /
     REEMPLAZADA. Esos datos no caben en los CHECK de sql/22 y NO se borran
     ni se reescriben aqui (que hacer con ellos es otra decision). Mientras,
     usar _rollback_procedimiento.sql (apaga el flujo sin tocar datos).
     Tambien se niega si un procedimiento de 41 tiene otra huella o si 41
     no esta (sus CHECK nuevos).

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'41';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'41'
BEGIN
    RAISERROR (N'Rollback 41 SIN APROBAR: declara aprobar_migracion = 41 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hC varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hR varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @esta41 bit = CASE WHEN OBJECT_ID(N'adm.CK_SolicitudCambio_EstadoCancelada', N'C') IS NOT NULL
                             AND OBJECT_ID(N'adm.CK_SolicitudCambio_RevisionCancelacion', N'C') IS NOT NULL
                             AND OBJECT_ID(N'adm.CK_SolicitudCambio_ReemplazaA', N'C') IS NOT NULL
                             AND OBJECT_ID(N'adm.CK_SolicitudCambioEvento_EventoCancelada', N'C') IS NOT NULL
                             AND COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @usadas int = 0;
IF @esta41 = 1
    -- TABLOCKX + HOLDLOCK: nadie cancela ni reemplaza mientras se cuenta y se deshace.
    EXEC sys.sp_executesql N'SELECT @n = (SELECT COUNT(*) FROM adm.SolicitudCambio WITH (TABLOCKX, HOLDLOCK)
              WHERE Estado = ''CANCELADA'' OR ReemplazaA IS NOT NULL OR CanceladoPor IS NOT NULL
                 OR FechaCancelacionUtc IS NOT NULL OR MotivoCancelacion IS NOT NULL)
            + (SELECT COUNT(*) FROM adm.SolicitudCambioEvento WITH (TABLOCKX, HOLDLOCK) WHERE Evento IN (''CANCELADA'', ''REEMPLAZADA''));',
        N'@n int OUTPUT', @n = @usadas OUTPUT;
IF @esta41 = 0 OR @usadas > 0
   OR (OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NOT NULL AND (@hC IS NULL OR @hC <> 0x79C8DC9E935CE4720CC23A9D8BBDB06F8927EA06F77ACB8E377D745D148B3554)) -- huella:adm.usp_SolicitudCambio_Cancelar
   OR (OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NOT NULL AND (@hR IS NULL OR @hR <> 0x66A1837626A021F6A170069C646DB07765BD8C179DA3C13092575FA525338880)) -- huella:adm.usp_SolicitudCambio_Reemplazar
BEGIN
    ROLLBACK;
    IF @esta41 = 0
        RAISERROR (N'Rollback 41: sql/41 no esta aplicada (faltan sus CHECK o columnas). No se toca nada.', 16, 1);
    ELSE IF @usadas > 0
        RAISERROR (N'Rollback 41: %d fila(s) o evento(s) ya usan cancelar / reemplazar y no caben en los CHECK de sql/22. No se toca nada (usa _rollback_procedimiento.sql).', 16, 1, @usadas);
    ELSE
        RAISERROR (N'Rollback 41: Cancelar o Reemplazar no tienen la huella de sql/41. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudCambio_Reemplazar;
IF OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudCambio_Cancelar;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE adm.SolicitudCambioEvento DROP CONSTRAINT CK_SolicitudCambioEvento_EventoCancelada;
ALTER TABLE adm.SolicitudCambioEvento WITH CHECK ADD CONSTRAINT CK_SolicitudCambioEvento_Evento
    CHECK (Evento IN ('ENVIADA', 'APLICADA', 'RECHAZADA', 'FALLO_APLICAR', 'DESACTUALIZADA'));
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_ReemplazaA;
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_RevisionCancelacion;
ALTER TABLE adm.SolicitudCambio WITH CHECK ADD CONSTRAINT CK_SolicitudCambio_Revision
    CHECK ((Estado = 'PENDIENTE' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL)
        OR (Estado <> 'PENDIENTE' AND RevisadoPor IS NOT NULL AND FechaRevisionUtc IS NOT NULL));
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_EstadoCancelada;
ALTER TABLE adm.SolicitudCambio WITH CHECK ADD CONSTRAINT CK_SolicitudCambio_Estado
    CHECK (Estado IN ('PENDIENTE', 'APLICADA', 'RECHAZADA'));
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP INDEX UX_SolicitudCambio_ReemplazaA ON adm.SolicitudCambio;
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT FK_SolicitudCambio_ReemplazaA;
ALTER TABLE adm.SolicitudCambio DROP COLUMN ReemplazaA, CanceladoPor, FechaCancelacionUtc, MotivoCancelacion;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @checks int = (SELECT COUNT(*) FROM sys.check_constraints AS c
    WHERE c.is_disabled = 0 AND c.is_not_trusted = 0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = CASE c.name
          WHEN N'CK_SolicitudCambio_Estado' THEN N'Estado=''RECHAZADA''OREstado=''APLICADA''OREstado=''PENDIENTE'''
          WHEN N'CK_SolicitudCambio_Revision' THEN N'Estado=''PENDIENTE''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLOREstado<>''PENDIENTE''ANDRevisadoPorISNOTNULLANDFechaRevisionUtcISNOTNULL'
          WHEN N'CK_SolicitudCambio_Rechazo' THEN N'Estado<>''RECHAZADA''ORlenltrimrtrimComentarioRevision>0'
          WHEN N'CK_SolicitudCambioEvento_Evento' THEN N'Evento=''DESACTUALIZADA''OREvento=''FALLO_APLICAR''OREvento=''RECHAZADA''OREvento=''APLICADA''OREvento=''ENVIADA'''
      END);
IF @checks = 4
   AND OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NULL
   AND COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') IS NULL AND COL_LENGTH(N'adm.SolicitudCambio', N'CanceladoPor') IS NULL
   AND COL_LENGTH(N'adm.SolicitudCambio', N'FechaCancelacionUtc') IS NULL AND COL_LENGTH(N'adm.SolicitudCambio', N'MotivoCancelacion') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudCambio_EstadoCancelada', N'C') IS NULL AND OBJECT_ID(N'adm.CK_SolicitudCambio_RevisionCancelacion', N'C') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudCambio_ReemplazaA', N'C') IS NULL AND OBJECT_ID(N'adm.CK_SolicitudCambioEvento_EventoCancelada', N'C') IS NULL
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 41', Resultado = 'APLICADO';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 41: la tabla no volvio a la forma de sql/22; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
