/* =========================================================================
   sql/39_solicitudes_vistas_rollback.sql - deshace sql/39.

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     Quita adm.usp_SolicitudVista_Marcar y adm.SolicitudVista (el DENY se va
     con la tabla). No toca las solicitudes ni su Estado: sin estas piezas el
     sitio deja de contar las no vistas solo (AlmacenVistasSql.Disponible) y
     el aviso de la pestaña Solicitudes queda en el punto de "hay
     pendientes", sin numero.

   PERDIDA DE DATOS
     Solo lo que cada ADM ya abrio: al volver a aplicar sql/39 todo lo
     pendiente cuenta otra vez como no visto. No se pierde ninguna solicitud.
     Respaldo previo (opcional): SELECT * FROM adm.SolicitudVista;

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'39';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'39'
BEGIN
    RAISERROR (N'Rollback 39 SIN APROBAR: declara aprobar_migracion = 39 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hay int = (CASE WHEN OBJECT_ID(N'adm.SolicitudVista', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudVista_Marcar', N'P') IS NULL THEN 0 ELSE 1 END);
IF @hay <> 2
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 39: hay %d de 2 objetos de sql/39 (no aplicada o a medias). No se toca nada.', 16, 1, @hay);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 39: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP PROCEDURE adm.usp_SolicitudVista_Marcar;
DROP TABLE adm.SolicitudVista;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 39: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.SolicitudVista', N'U') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudVista_Marcar', N'P') IS NULL
BEGIN
    COMMIT;
    SELECT Rollback39 = N'39', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 39: no quedo limpio; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
