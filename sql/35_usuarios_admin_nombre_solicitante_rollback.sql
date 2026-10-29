/* =========================================================================
   sql/35_usuarios_admin_nombre_solicitante_rollback.sql - deshace sql/35.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitanteAdminPsoSqlLocalDbSmoke.cs).

   QUE HACE (una transaccion): quita dbo.UsuariosAdmin.NombreSolicitante.

   SE NIEGA, sin tocar nada, si:
     - la columna no existe (35 no aplicada);
     - un procedimiento, funcion o vista la menciona (sql/36: deshacer 36
       antes, al menos su procedimiento);
     - alguna cuenta tiene NombreSolicitante (se perderia). Vaciarlo es una
       decision aparte.

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'35';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion: si algo falla, ROLLBACK de todo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'35'
BEGIN
    RAISERROR (N'Rollback 35 SIN APROBAR: declara aprobar_migracion = 35 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @usa nvarchar(300) = (SELECT TOP (1) OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id)
                              FROM sys.sql_modules AS m WHERE m.definition LIKE N'%NombreSolicitante%' ORDER BY 1);
DECLARE @con int = 0;
IF COL_LENGTH(N'dbo.UsuariosAdmin', N'NombreSolicitante') IS NOT NULL
    EXEC sys.sp_executesql N'SELECT @n = COUNT(*) FROM dbo.UsuariosAdmin WITH (TABLOCKX, HOLDLOCK) WHERE NULLIF(LTRIM(RTRIM(NombreSolicitante)), N'''') IS NOT NULL',
                           N'@n int OUTPUT', @n = @con OUTPUT;
IF COL_LENGTH(N'dbo.UsuariosAdmin', N'NombreSolicitante') IS NULL OR @usa IS NOT NULL OR @con > 0
BEGIN
    ROLLBACK;
    IF COL_LENGTH(N'dbo.UsuariosAdmin', N'NombreSolicitante') IS NULL
        RAISERROR (N'Rollback 35: no aplicada (no existe dbo.UsuariosAdmin.NombreSolicitante). No se toca nada.', 16, 1);
    ELSE IF @usa IS NOT NULL
        RAISERROR (N'Rollback 35: %s usa NombreSolicitante; deshaz sql/36 antes. No se toca nada.', 16, 1, @usa);
    ELSE
        RAISERROR (N'Rollback 35: %d cuenta(s) tienen NombreSolicitante; se perderia. No se toca nada.', 16, 1, @con);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE dbo.UsuariosAdmin DROP COLUMN NombreSolicitante;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF COL_LENGTH(N'dbo.UsuariosAdmin', N'NombreSolicitante') IS NULL
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 35', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 35: la columna no quedo como se esperaba; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
