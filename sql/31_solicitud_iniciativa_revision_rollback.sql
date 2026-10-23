/* =========================================================================
   sql/31_solicitud_iniciativa_revision_rollback.sql - deshace sql/31.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     Quita adm.usp_SolicitudIniciativa_Aprobar / _Rechazar,
     CK_SolicitudIniciativa_Revision / _Rechazo y las 4 columnas de sql/31;
     CK_SolicitudIniciativa_Estado y CK_SolicitudIniciativaEvento_Evento
     vuelven a sql/29 (solo ENVIADA). No toca _Crear, el contador, las
     filas ni los eventos de ENVIADA, los DENY de sql/29 ni nada de dbo.

   SE NIEGA SIEMPRE (sin bandera para forzarlo) si ya hay alguna solicitud
     revisada: una fila que no es ENVIADA o con revisor / fecha / comentario,
     o un evento que no es ENVIADA o con Detalle. Las decisiones son
     finales (2026-10-23) y borrar sus columnas las perderia. Antes de
     deshacer, el sitio tiene que dejar de ofrecer la revision (el handler
     responde 501 solo, sin los procedimientos).

   PRECONDICION: las 6 piezas de sql/31 y los procedimientos con su hash:
     Aprobar   0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
     Rechazar  0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
   POSTCONDICION: sin piezas de 31; los dos CHECK con el texto de sql/29;
     _Crear con el hash de sql/29; mismas filas, eventos y contador; los 9
     DENY de sql/29 (si existe PROACTIVANETAD).

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'31';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'31'
BEGIN
    RAISERROR (N'Rollback 31 SIN APROBAR: declara aprobar_migracion = 31 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hAprobar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hRechazar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @piezas31 int = (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'RevisadoPor') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaRevisionUtc') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'ComentarioRevision') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Detalle') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN @hAprobar IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN @hRechazar IS NULL THEN 0 ELSE 1 END);
DECLARE @revisadas int = 0;
IF @piezas31 = 6
    -- UPDLOCK + HOLDLOCK: nadie revisa mientras se decide (y se deshace).
    EXEC sys.sp_executesql N'SELECT @n =
        (SELECT COUNT(*) FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK)
         WHERE Estado <> ''ENVIADA'' OR RevisadoPor IS NOT NULL OR FechaRevisionUtc IS NOT NULL OR ComentarioRevision IS NOT NULL)
      + (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento WITH (UPDLOCK, HOLDLOCK)
         WHERE Evento <> ''ENVIADA'' OR Detalle IS NOT NULL)',
        N'@n int OUTPUT', @n = @revisadas OUTPUT;
IF @piezas31 <> 6 OR @hAprobar <> 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906 OR @hRechazar <> 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416 OR @revisadas > 0
BEGIN
    ROLLBACK;
    IF @piezas31 = 0
        RAISERROR (N'Rollback 31: sql/31 no esta aplicada. No se toca nada.', 16, 1);
    ELSE IF @piezas31 <> 6
        RAISERROR (N'Rollback 31: hay %d de 6 piezas de sql/31 (a medias o a mano). No se toca nada.', 16, 1, @piezas31);
    ELSE IF @revisadas > 0
        RAISERROR (N'Rollback 31: ya hay solicitudes revisadas (%d fila(s) de revision); las decisiones son finales y se perderian. No se toca nada.', 16, 1, @revisadas);
    ELSE
        RAISERROR (N'Rollback 31: _Aprobar o _Rechazar no son los de sql/31 (cambiados a mano). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('tempdb..#antes31r') IS NOT NULL DROP TABLE #antes31r;
SELECT Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa),
       Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento),
       Ultimo = (SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1)
INTO #antes31r;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP PROCEDURE adm.usp_SolicitudIniciativa_Aprobar;
DROP PROCEDURE adm.usp_SolicitudIniciativa_Rechazar;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Revision;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Rechazo;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Estado;
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_Estado CHECK (Estado IN ('ENVIADA'));
ALTER TABLE adm.SolicitudIniciativaEvento DROP CONSTRAINT CK_SolicitudIniciativaEvento_Evento;
ALTER TABLE adm.SolicitudIniciativaEvento ADD CONSTRAINT CK_SolicitudIniciativaEvento_Evento CHECK (Evento IN ('ENVIADA'));
ALTER TABLE adm.SolicitudIniciativa DROP COLUMN RevisadoPor, FechaRevisionUtc, ComentarioRevision;
ALTER TABLE adm.SolicitudIniciativaEvento DROP COLUMN Detalle;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- Postcondicion ---------- */
DECLARE @hash2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento')));
DECLARE @esperados int = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 9 END;
IF @hash2 = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   AND @deny = @esperados
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'RevisadoPor') IS NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaRevisionUtc') IS NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'ComentarioRevision') IS NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Detalle') IS NULL
   AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P') IS NULL
   AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_Revision', N'C') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_Rechazo', N'C') IS NULL
   AND (SELECT definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa')
        AND name = N'CK_SolicitudIniciativa_Estado') = N'([Estado]=''ENVIADA'')'
   AND (SELECT definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativaEvento')
        AND name = N'CK_SolicitudIniciativaEvento_Evento') = N'([Evento]=''ENVIADA'')'
   AND EXISTS (SELECT 1 FROM #antes31r AS a
               WHERE a.Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa)
                 AND a.Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)
                 AND ISNULL(a.Ultimo, -1) = ISNULL((SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1), -1))
BEGIN
    COMMIT;
    SELECT Rollback31 = 'DESHECHA', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 31: no quedo como sql/29; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
