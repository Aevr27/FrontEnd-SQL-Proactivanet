/* =========================================================================
   sql/30_interruptor_iniciativas_rollback.sql - deshace sql/30.

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     Quita adm.Interruptor (el DENY se va con ella). No toca nada mas.
     Sin la tabla el sitio lee el interruptor como APAGADO (falla cerrado):
     las cuentas sin rol ADM/MOD dejan de ver Nueva solicitud; ADM y MOD
     siguen igual. Las solicitudes ya guardadas (sql/29) no se tocan.

   PERDIDA DE DATOS
     Solo el valor del interruptor y quien lo cambio por ultima vez.
     Respaldo previo (opcional):
       SELECT * FROM adm.Interruptor;

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'30';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'30'
BEGIN
    RAISERROR (N'Rollback 30 SIN APROBAR: declara aprobar_migracion = 30 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID(N'adm.Interruptor', N'U') IS NULL
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 30: adm.Interruptor no existe (no aplicada). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 30: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DROP TABLE adm.Interruptor;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 30: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.Interruptor', N'U') IS NULL
BEGIN
    COMMIT;
    SELECT Rollback30 = N'30', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 30: no quedo limpio; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
