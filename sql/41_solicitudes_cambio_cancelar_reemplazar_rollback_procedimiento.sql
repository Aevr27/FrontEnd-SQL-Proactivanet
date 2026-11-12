/* =========================================================================
   sql/41_solicitudes_cambio_cancelar_reemplazar_rollback_procedimiento.sql
   - APAGA cancelar y reemplazar de sql/41 sin tocar datos.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitudesCancelarReemplazarSqlLocalDbSmoke.cs).

   QUE HACE (una transaccion): DROP de adm.usp_SolicitudCambio_Cancelar y
     adm.usp_SolicitudCambio_Reemplazar (solo si tienen la huella de sql/41).
   NO TOCA: columnas, CHECK, indice, FK ni filas. Las CANCELADA y los
     reemplazos ya guardados se quedan como estan y se siguen leyendo;
     nadie puede cancelar ni reemplazar hasta volver a correr sql/41 (en
     este estado solo vuelve a crear los procedimientos: REACTIVADA) o
     aplicar el rollback completo (que exige que no haya ninguna).
   Sirve cuando el rollback completo se niega porque ya hay canceladas.

   SE NIEGA, sin tocar nada, si un procedimiento existe con otra huella, o
     si ya no existe ninguno (ya corrido).

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'41';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'41'
BEGIN
    RAISERROR (N'Rollback 41 (procedimiento) SIN APROBAR: declara aprobar_migracion = 41 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hC varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hR varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF (OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NULL)
   OR (OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NOT NULL AND (@hC IS NULL OR @hC <> 0x79C8DC9E935CE4720CC23A9D8BBDB06F8927EA06F77ACB8E377D745D148B3554)) -- huella:adm.usp_SolicitudCambio_Cancelar
   OR (OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NOT NULL AND (@hR IS NULL OR @hR <> 0x66A1837626A021F6A170069C646DB07765BD8C179DA3C13092575FA525338880)) -- huella:adm.usp_SolicitudCambio_Reemplazar
BEGIN
    ROLLBACK;
    IF OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NULL
        RAISERROR (N'Rollback 41 (procedimiento): no hay procedimientos de 41 (ya corrido o 41 no aplicada). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 41 (procedimiento): Cancelar o Reemplazar no tienen la huella de sql/41. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 41 (procedimiento): transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudCambio_Reemplazar;
IF OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudCambio_Cancelar;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 41 (procedimiento): transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NULL
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 41 (procedimiento)', Resultado = 'APLICADO',
           Canceladas = (SELECT COUNT(*) FROM adm.SolicitudCambio WHERE Estado = 'CANCELADA'),
           Reemplazos = (SELECT COUNT(*) FROM adm.SolicitudCambio WHERE ReemplazaA IS NOT NULL);
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 41 (procedimiento): los procedimientos siguen ahi; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
