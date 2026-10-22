/* =========================================================================
   sql/28_acuse_po_so_rollback.sql - deshace sql/28.

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     Quita los dos procedimientos y las tres tablas de sql/28 (los DENY se
     van con ellas). No toca nada que existiera antes: sin estas piezas el
     sitio deja de mostrar el acuse solo (DeteccionSql28) y el handler
     responde 501.

   PERDIDA DE DATOS
     Los acuses, sus notificaciones y lo leido son historia que no se
     reconstruye. Si hay alguna fila se niega, salvo con:
       EXEC sys.sp_set_session_context N'rollback_28_perder_acuses', N'SI';
     Respaldo previo (recomendado):
       SELECT * FROM adm.AcuseIniciativa;
       SELECT * FROM adm.NotificacionAdm;
       SELECT * FROM adm.NotificacionLectura;

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'28';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'28'
BEGIN
    RAISERROR (N'Rollback 28 SIN APROBAR: declara aprobar_migracion = 28 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hay int = (CASE WHEN OBJECT_ID(N'adm.AcuseIniciativa', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.NotificacionAdm', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.NotificacionLectura', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_Acuse_Registrar', N'P') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_Notificacion_MarcarLeida', N'P') IS NULL THEN 0 ELSE 1 END);
DECLARE @filas int = 0;
IF @hay = 5
    EXEC sys.sp_executesql N'SELECT @n = (SELECT COUNT(*) FROM adm.AcuseIniciativa) + (SELECT COUNT(*) FROM adm.NotificacionAdm)
                                        + (SELECT COUNT(*) FROM adm.NotificacionLectura)', N'@n int OUTPUT', @n = @filas OUTPUT;
DECLARE @perder bit = CASE WHEN ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'rollback_28_perder_acuses')), N'') = N'SI' THEN 1 ELSE 0 END;
IF @hay <> 5 OR (@filas > 0 AND @perder = 0)
BEGIN
    ROLLBACK;
    IF @hay <> 5
        RAISERROR (N'Rollback 28: hay %d de 5 objetos de sql/28 (no aplicada o a medias). No se toca nada.', 16, 1, @hay);
    ELSE
        RAISERROR (N'Rollback 28: hay %d filas de acuses / notificaciones / lecturas. Se perderian: respaldalas y declara rollback_28_perder_acuses = SI. No se toca nada.', 16, 1, @filas);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 28: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP PROCEDURE adm.usp_Notificacion_MarcarLeida;
DROP PROCEDURE adm.usp_Acuse_Registrar;
DROP TABLE adm.NotificacionLectura;
DROP TABLE adm.NotificacionAdm;
DROP TABLE adm.AcuseIniciativa;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 28: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.AcuseIniciativa', N'U') IS NULL AND OBJECT_ID(N'adm.NotificacionAdm', N'U') IS NULL
   AND OBJECT_ID(N'adm.NotificacionLectura', N'U') IS NULL AND OBJECT_ID(N'adm.usp_Acuse_Registrar', N'P') IS NULL
   AND OBJECT_ID(N'adm.usp_Notificacion_MarcarLeida', N'P') IS NULL
BEGIN
    COMMIT;
    SELECT Rollback28 = N'28', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 28: no quedo limpio; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
