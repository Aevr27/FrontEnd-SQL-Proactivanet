/* =========================================================================
   sql/32_solicitud_iniciativa_aprobar_crea_rollback.sql - deshace sql/32.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     Quita adm.usp_SolicitudIniciativa_AprobarYCrear, el indice
     UX_SolicitudIniciativa_CodigoIniciativa, CK_SolicitudIniciativa_Codigo y
     la columna CodigoIniciativa. No toca _Crear / _Aprobar / _Rechazar,
     adm.usp_GestionAdmin_Crear, permisos, filas, eventos, contador, los DENY
     de sql/29 ni nada de dbo.

   SE NIEGA SIEMPRE (sin bandera para forzarlo) si alguna solicitud ya tiene
     Codigo ligado: borrar la columna perderia que solicitud creo cual
     iniciativa, y la iniciativa (dbo.Problem) no se deshace aqui. Antes de
     deshacer, el sitio tiene que dejar de ofrecer aprobar (el handler
     responde 501 solo, sin el procedimiento).

   PRECONDICION: las 4 piezas de sql/32 y el procedimiento con su hash:
     AprobarYCrear  0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC
   POSTCONDICION: sin piezas de 32; los 4 hashes de sql/27, 29 y 31 iguales;
     mismas filas, eventos y contador; los 9 DENY de sql/29.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'32';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'32'
BEGIN
    RAISERROR (N'Rollback 32 SIN APROBAR: declara aprobar_migracion = 32 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hProc varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @piezas32 int = (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'CodigoIniciativa') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN OBJECT_ID(N'adm.CK_SolicitudIniciativa_Codigo', N'C') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN INDEXPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'UX_SolicitudIniciativa_CodigoIniciativa', 'IndexID') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN @hProc IS NULL THEN 0 ELSE 1 END);
DECLARE @ligadas int = 0;
IF @piezas32 = 4
    -- UPDLOCK + HOLDLOCK: nadie aprueba mientras se decide (y se deshace).
    EXEC sys.sp_executesql N'SELECT @n = COUNT(*) FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK) WHERE CodigoIniciativa IS NOT NULL',
        N'@n int OUTPUT', @n = @ligadas OUTPUT;
IF @piezas32 <> 4 OR @hProc <> 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC OR @ligadas > 0
BEGIN
    ROLLBACK;
    IF @piezas32 = 0
        RAISERROR (N'Rollback 32: sql/32 no esta aplicada. No se toca nada.', 16, 1);
    ELSE IF @piezas32 <> 4
        RAISERROR (N'Rollback 32: hay %d de 4 piezas de sql/32 (a medias o a mano). No se toca nada.', 16, 1, @piezas32);
    ELSE IF @ligadas > 0
        RAISERROR (N'Rollback 32: ya hay %d solicitud(es) con iniciativa ligada; se perderia la liga. No se toca nada.', 16, 1, @ligadas);
    ELSE
        RAISERROR (N'Rollback 32: _AprobarYCrear no es la de sql/32 (cambiada a mano). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('tempdb..#antes32r') IS NOT NULL DROP TABLE #antes32r;
SELECT Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa),
       Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento),
       Ultimo = (SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1)
INTO #antes32r;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP PROCEDURE adm.usp_SolicitudIniciativa_AprobarYCrear;
DROP INDEX UX_SolicitudIniciativa_CodigoIniciativa ON adm.SolicitudIniciativa;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Codigo;
ALTER TABLE adm.SolicitudIniciativa DROP COLUMN CodigoIniciativa;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- Postcondicion ---------- */
DECLARE @hGestion varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hCrear varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hAprobar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hRechazar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento')));
DECLARE @esperados int = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 9 END;
IF @hGestion = 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
   AND @hCrear = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   AND @hAprobar = 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
   AND @hRechazar = 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
   AND @deny = @esperados
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'CodigoIniciativa') IS NULL
   AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_Codigo', N'C') IS NULL
   AND EXISTS (SELECT 1 FROM #antes32r AS a
               WHERE a.Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa)
                 AND a.Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)
                 AND ISNULL(a.Ultimo, -1) = ISNULL((SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1), -1))
BEGIN
    COMMIT;
    SELECT Rollback32 = 'DESHECHA', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 32: no quedo como sql/31; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
