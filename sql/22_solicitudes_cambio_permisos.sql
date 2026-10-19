/* =========================================================================
   sql/22_solicitudes_cambio_permisos.sql - permisos del sitio sobre lo que
   crea sql/22. Va APARTE y DESPUES de sql/22, con su propio OK (como el
   GRANT/DENY de sql/18 seccion 8, runbook ADM_04 paso 3b).

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   El sitio entra con PROACTIVANETAD: db_datareader + db_datawriter +
   EXECUTE sobre dbo y adm (verificado 2026-10-13/14). Por eso:
     - LEE las tablas nuevas (cola de ADM, detalle, "mis solicitudes"): no
       hace falta GRANT SELECT.
     - db_datawriter le dejaria escribirlas A MANO: crear una solicitud con
       otro solicitante, marcarla APLICADA sin aplicarla o borrar la
       bitacora. El DENY de abajo lo impide; los procedimientos siguen
       escribiendo por encadenamiento de propietario (adm y dbo son de dbo).
     - EXECUTE sobre adm ya cubre los tres procedimientos y el tipo
       adm.SolicitudCategoriaTipo (igual que adm.CategoriaPctTipo hoy).
   La base no distingue ADM de MOD (todos llegan como PROACTIVANETAD): quien
   puede aplicar o rechazar lo decide el handler (AccesoAdmin.ExigirAdm).

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'22P';
     y el script completo. Rollback: los REVOKE del final (comentados).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'22P'
BEGIN
    RAISERROR (N'Permisos 22 SIN APROBAR: declara aprobar_migracion = 22P en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF OBJECT_ID('adm.SolicitudCambio', 'U') IS NULL OR OBJECT_ID('adm.SolicitudCambioCategoria', 'U') IS NULL
   OR OBJECT_ID('adm.SolicitudCambioEvento', 'U') IS NULL
BEGIN
    RAISERROR (N'Permisos 22: sql/22 no esta aplicada. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL
BEGIN
    RAISERROR (N'Permisos 22: no existe el usuario PROACTIVANETAD en esta base. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DENY INSERT, UPDATE, DELETE ON adm.SolicitudCambio          TO [PROACTIVANETAD];
DENY INSERT, UPDATE, DELETE ON adm.SolicitudCambioCategoria TO [PROACTIVANETAD];
DENY INSERT, UPDATE, DELETE ON adm.SolicitudCambioEvento    TO [PROACTIVANETAD];

-- Postcondicion: los 9 DENY y EXECUTE sobre adm (de sql/18).
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1
                       AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID('adm.SolicitudCambio'), OBJECT_ID('adm.SolicitudCambioCategoria'),
                                          OBJECT_ID('adm.SolicitudCambioEvento')));
DECLARE @exec int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state IN ('G', 'W') AND p.class = 3 AND p.major_id = SCHEMA_ID(N'adm')
                       AND p.permission_name = N'EXECUTE');
IF @deny = 9 AND @exec = 1
BEGIN
    COMMIT;
    SELECT Permisos = N'22', Resultado = 'APLICADOS';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Permisos 22: quedaron %d de 9 DENY y %d EXECUTE sobre adm (falta el GRANT de sql/18); ROLLBACK.', 16, 1, @deny, @exec);
END;
GO
SET NOEXEC OFF;
GO
/* Rollback (solo con OK; antes de _rollback.sql de 22):
REVOKE INSERT, UPDATE, DELETE ON adm.SolicitudCambio          FROM [PROACTIVANETAD];
REVOKE INSERT, UPDATE, DELETE ON adm.SolicitudCambioCategoria FROM [PROACTIVANETAD];
REVOKE INSERT, UPDATE, DELETE ON adm.SolicitudCambioEvento    FROM [PROACTIVANETAD];
*/
