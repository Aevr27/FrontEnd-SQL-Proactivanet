/* =========================================================================
   sql/42_solicitud_iniciativa_cancelar_reemplazar_rollback_procedimiento.sql
   - APAGA cancelar y reemplazar de sql/42 sin tocar datos.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitudesCancelarReemplazarSqlLocalDbSmoke.cs).

   QUE HACE (una transaccion): DROP de adm.usp_SolicitudIniciativa_Cancelar
     y adm.usp_SolicitudIniciativa_Reemplazar (solo si tienen la huella de
     sql/42).
   NO TOCA: columnas, CHECK, indice, FK ni filas. Las CANCELADA y los
     reemplazos ya guardados se quedan y se siguen leyendo; nadie puede
     cancelar ni reemplazar hasta volver a correr sql/42 (en este estado
     solo vuelve a crear los procedimientos: REACTIVADA).
   Sirve cuando el rollback completo se niega porque ya hay canceladas.

   SE NIEGA, sin tocar nada, si un procedimiento existe con otra huella, o
     si ya no existe ninguno (ya corrido).

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'42';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'42'
BEGIN
    RAISERROR (N'Rollback 42 (procedimiento) SIN APROBAR: declara aprobar_migracion = 42 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hC varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hR varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF (OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NULL)
   OR (OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NOT NULL AND (@hC IS NULL OR @hC <> 0x03ACC642CE1A390F1FF9EBC7D09903DA6696003184B7B0C4041AF53A79C8DE62)) -- huella:adm.usp_SolicitudIniciativa_Cancelar
   OR (OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NOT NULL AND (@hR IS NULL OR @hR <> 0xBEA3AA16CABFB80C1DC829C9BB371BC46AA25BCC6D58E9A2E6E4FE3636B1238E)) -- huella:adm.usp_SolicitudIniciativa_Reemplazar
BEGIN
    ROLLBACK;
    IF OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NULL
        RAISERROR (N'Rollback 42 (procedimiento): no hay procedimientos de 42 (ya corrido o 42 no aplicada). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 42 (procedimiento): Cancelar o Reemplazar no tienen la huella de sql/42. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 42 (procedimiento): transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudIniciativa_Reemplazar;
IF OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NOT NULL DROP PROCEDURE adm.usp_SolicitudIniciativa_Cancelar;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 42 (procedimiento): transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NULL
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 42 (procedimiento)', Resultado = 'APLICADO',
           Canceladas = (SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE Estado = 'CANCELADA'),
           Reemplazos = (SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE ReemplazaA IS NOT NULL);
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 42 (procedimiento): los procedimientos siguen ahi; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
