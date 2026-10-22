/* =========================================================================
   sql/29_solicitud_iniciativa_rollback.sql - deshace sql/29.

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     Quita el procedimiento y las tres tablas de sql/29 (los DENY se van
     con ellas). No toca nada que existiera antes: sin estas piezas el sitio
     vuelve solo (AlmacenSolicitudesSql.Disponible) a validar sin guardar.

   PERDIDA DE DATOS
     Las solicitudes, sus numeros y la foto de los correos son historia que
     no se reconstruye. Si hay alguna solicitud se niega, salvo con:
       EXEC sys.sp_set_session_context N'rollback_29_perder_solicitudes', N'SI';
     Respaldo previo (recomendado):
       SELECT * FROM adm.SolicitudIniciativa;
       SELECT * FROM adm.SolicitudIniciativaEvento;
       SELECT * FROM adm.SolicitudIniciativaContador;

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'29';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'29'
BEGIN
    RAISERROR (N'Rollback 29 SIN APROBAR: declara aprobar_migracion = 29 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hay int = (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaContador', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaEvento', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P') IS NULL THEN 0 ELSE 1 END);
DECLARE @filas int = 0;
IF @hay = 4
    EXEC sys.sp_executesql N'SELECT @n = (SELECT COUNT(*) FROM adm.SolicitudIniciativa) + (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)',
                           N'@n int OUTPUT', @n = @filas OUTPUT;
DECLARE @perder bit = CASE WHEN ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'rollback_29_perder_solicitudes')), N'') = N'SI' THEN 1 ELSE 0 END;
IF @hay <> 4 OR (@filas > 0 AND @perder = 0)
BEGIN
    ROLLBACK;
    IF @hay <> 4
        RAISERROR (N'Rollback 29: hay %d de 4 objetos de sql/29 (no aplicada o a medias). No se toca nada.', 16, 1, @hay);
    ELSE
        RAISERROR (N'Rollback 29: hay %d filas de solicitudes / eventos. Se perderian: respaldalas y declara rollback_29_perder_solicitudes = SI. No se toca nada.', 16, 1, @filas);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 29: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP PROCEDURE adm.usp_SolicitudIniciativa_Crear;
DROP TABLE adm.SolicitudIniciativaEvento;
DROP TABLE adm.SolicitudIniciativa;
DROP TABLE adm.SolicitudIniciativaContador;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 29: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.SolicitudIniciativaContador', N'U') IS NULL AND OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NULL
   AND OBJECT_ID(N'adm.SolicitudIniciativaEvento', N'U') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P') IS NULL
BEGIN
    COMMIT;
    SELECT Rollback29 = N'29', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 29: no quedo limpio; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
