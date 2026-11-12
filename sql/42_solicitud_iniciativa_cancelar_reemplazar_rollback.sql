/* =========================================================================
   sql/42_solicitud_iniciativa_cancelar_reemplazar_rollback.sql - deshace
   sql/42 COMPLETA: adm.SolicitudIniciativa y su bitacora vuelven a la forma
   de sql/29 (+31, 32, 36) en lo que 42 toco.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitudesCancelarReemplazarSqlLocalDbSmoke.cs).

   QUE HACE (una transaccion)
     DROP de adm.usp_SolicitudIniciativa_Reemplazar y _Cancelar (si
       existen; sirve tambien despues de _rollback_procedimiento.sql).
     CHECK: CK_SolicitudIniciativa_EstadoCancelada, _RevisionCancelacion,
       _ReemplazaA y CK_SolicitudIniciativaEvento_EventoCancelada fuera;
       CK_SolicitudIniciativa_Estado, CK_SolicitudIniciativa_Revision y
       CK_SolicitudIniciativaEvento_Evento de vuelta con el texto EXACTO de
       sql/31.
     UX_SolicitudIniciativa_ReemplazaA, FK_SolicitudIniciativa_ReemplazaA y
       las columnas ReemplazaA, CanceladoPor, FechaCancelacionUtc,
       MotivoCancelacion fuera.
   NO TOCA: Crear, Aprobar, Rechazar, AprobarYCrear, contador, filas,
     permisos.

   SE NIEGA, sin tocar nada, si hay CUALQUIER rastro de uso: una solicitud
     CANCELADA, una columna de 42 con valor, o un evento CANCELADA /
     REEMPLAZADA. Esos datos no caben en los CHECK de sql/31 y NO se borran
     ni se reescriben aqui. Mientras, usar _rollback_procedimiento.sql.
     Tambien se niega si un procedimiento de 42 tiene otra huella o si 42 no
     esta.

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'42';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'42'
BEGIN
    RAISERROR (N'Rollback 42 SIN APROBAR: declara aprobar_migracion = 42 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hC varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hR varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @esta42 bit = CASE WHEN OBJECT_ID(N'adm.CK_SolicitudIniciativa_EstadoCancelada', N'C') IS NOT NULL
                             AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_RevisionCancelacion', N'C') IS NOT NULL
                             AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_ReemplazaA', N'C') IS NOT NULL
                             AND OBJECT_ID(N'adm.CK_SolicitudIniciativaEvento_EventoCancelada', N'C') IS NOT NULL
                             AND COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @usadas int = 0;
IF @esta42 = 1
    -- TABLOCKX + HOLDLOCK: nadie cancela ni reemplaza mientras se cuenta y se deshace.
    EXEC sys.sp_executesql N'SELECT @n = (SELECT COUNT(*) FROM adm.SolicitudIniciativa WITH (TABLOCKX, HOLDLOCK)
              WHERE Estado = ''CANCELADA'' OR ReemplazaA IS NOT NULL OR CanceladoPor IS NOT NULL
                 OR FechaCancelacionUtc IS NOT NULL OR MotivoCancelacion IS NOT NULL)
            + (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WITH (TABLOCKX, HOLDLOCK) WHERE Evento IN (''CANCELADA'', ''REEMPLAZADA''));',
        N'@n int OUTPUT', @n = @usadas OUTPUT;
IF @esta42 = 0 OR @usadas > 0
   OR (OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NOT NULL AND (@hC IS NULL OR @hC <> 0x03ACC642CE1A390F1FF9EBC7D09903DA6696003184B7B0C4041AF53A79C8DE62)) -- huella:adm.usp_SolicitudIniciativa_Cancelar
   OR (OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NOT NULL AND (@hR IS NULL OR @hR <> 0xBEA3AA16CABFB80C1DC829C9BB371BC46AA25BCC6D58E9A2E6E4FE3636B1238E)) -- huella:adm.usp_SolicitudIniciativa_Reemplazar
BEGIN
    ROLLBACK;
    IF @esta42 = 0
        RAISERROR (N'Rollback 42: sql/42 no esta aplicada (faltan sus CHECK o columnas). No se toca nada.', 16, 1);
    ELSE IF @usadas > 0
        RAISERROR (N'Rollback 42: %d fila(s) o evento(s) ya usan cancelar / reemplazar y no caben en los CHECK de sql/31. No se toca nada (usa _rollback_procedimiento.sql).', 16, 1, @usadas);
    ELSE
        RAISERROR (N'Rollback 42: Cancelar o Reemplazar no tienen la huella de sql/42. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudIniciativa_Reemplazar;
IF OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudIniciativa_Cancelar;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE adm.SolicitudIniciativaEvento DROP CONSTRAINT CK_SolicitudIniciativaEvento_EventoCancelada;
ALTER TABLE adm.SolicitudIniciativaEvento WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativaEvento_Evento
    CHECK (Evento IN ('ENVIADA', 'APROBADA', 'RECHAZADA'));
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_ReemplazaA;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_RevisionCancelacion;
ALTER TABLE adm.SolicitudIniciativa WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativa_Revision
    CHECK ((Estado = 'ENVIADA' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL AND ComentarioRevision IS NULL)
        OR (Estado <> 'ENVIADA' AND RevisadoPor IS NOT NULL AND LEN(LTRIM(RTRIM(RevisadoPor))) > 0 AND FechaRevisionUtc IS NOT NULL));
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_EstadoCancelada;
ALTER TABLE adm.SolicitudIniciativa WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativa_Estado
    CHECK (Estado IN ('ENVIADA', 'APROBADA', 'RECHAZADA'));
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP INDEX UX_SolicitudIniciativa_ReemplazaA ON adm.SolicitudIniciativa;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT FK_SolicitudIniciativa_ReemplazaA;
ALTER TABLE adm.SolicitudIniciativa DROP COLUMN ReemplazaA, CanceladoPor, FechaCancelacionUtc, MotivoCancelacion;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @checks int = (SELECT COUNT(*) FROM sys.check_constraints AS c
    WHERE c.is_disabled = 0 AND c.is_not_trusted = 0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = CASE c.name
          WHEN N'CK_SolicitudIniciativa_Estado' THEN N'Estado=''RECHAZADA''OREstado=''APROBADA''OREstado=''ENVIADA'''
          WHEN N'CK_SolicitudIniciativa_Revision' THEN N'Estado=''ENVIADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLOREstado<>''ENVIADA''ANDRevisadoPorISNOTNULLANDlenltrimrtrimRevisadoPor>0ANDFechaRevisionUtcISNOTNULL'
          WHEN N'CK_SolicitudIniciativa_Rechazo' THEN N'Estado<>''RECHAZADA''ORComentarioRevisionISNOTNULLANDlenltrimrtrimComentarioRevision>0'
          WHEN N'CK_SolicitudIniciativa_Codigo' THEN N'CodigoIniciativaISNULLOREstado=''APROBADA''ANDlenltrimrtrimCodigoIniciativa>0'
          WHEN N'CK_SolicitudIniciativaEvento_Evento' THEN N'Evento=''RECHAZADA''OREvento=''APROBADA''OREvento=''ENVIADA'''
      END);
IF @checks = 5
   AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') IS NULL AND COL_LENGTH(N'adm.SolicitudIniciativa', N'CanceladoPor') IS NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaCancelacionUtc') IS NULL AND COL_LENGTH(N'adm.SolicitudIniciativa', N'MotivoCancelacion') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_EstadoCancelada', N'C') IS NULL AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_RevisionCancelacion', N'C') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_ReemplazaA', N'C') IS NULL AND OBJECT_ID(N'adm.CK_SolicitudIniciativaEvento_EventoCancelada', N'C') IS NULL
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 42', Resultado = 'APLICADO';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 42: la tabla no volvio a la forma de sql/31; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
