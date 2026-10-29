/* =========================================================================
   sql/35_usuarios_admin_nombre_solicitante.sql - nombre OPCIONAL del
   solicitante ADM / MOD que no esta en CatPersona.     ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitanteAdminPsoSqlLocalDbSmoke.cs).

   ORDEN: 35 -> 36 -> 37. Sustituye al borrador anterior de sql/35
     (35_solicitud_iniciativa_solicitante_admin.sql, nunca aplicado).

   QUE CAMBIA (una transaccion)
     dbo.UsuariosAdmin + NombreSolicitante nvarchar(255) NULL (al final).
     Filas existentes: NULL. Nada mas: ni datos, ni CHECK, ni permisos.
     sql/36 lo lee como el nombre que se guarda en una Nueva solicitud con
     FuenteCorreos USUARIOSADMIN (NULL valido: el registro muestra la cuenta).
     Lo llena un DBA a mano; el sitio solo lo lee.

   RIESGO CONOCIDO
     Una columna al final rompe un INSERT dbo.UsuariosAdmin VALUES (...) sin
     lista de columnas o un consumidor posicional de SELECT *. El sitio lee
     con columnas nombradas (RolAdmin, CorreoAdmin). Otros consumidores de la
     tabla fuera de este repo no estan revisados.

   PRECONDICION: dbo.UsuariosAdmin con Usuario, CorreoUsuario y Acceso, sin
     NombreSolicitante. POSTCONDICION: NombreSolicitante nvarchar(255) NULL.

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'35';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion: si algo falla, ROLLBACK de todo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'35'
BEGIN
    RAISERROR (N'Migracion 35 SIN APROBAR: declara aprobar_migracion = 35 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @col nvarchar(200) = (SELECT TYPE_NAME(c.user_type_id) + N'(' + CONVERT(nvarchar(10), c.max_length / 2) + N')' + CASE WHEN c.is_nullable = 1 THEN N' NULL' ELSE N' NOT NULL' END
                           FROM sys.columns AS c WHERE c.object_id = OBJECT_ID(N'dbo.UsuariosAdmin', N'U') AND c.name = N'NombreSolicitante');
IF OBJECT_ID(N'dbo.UsuariosAdmin', N'U') IS NULL OR COL_LENGTH(N'dbo.UsuariosAdmin', N'Usuario') IS NULL
   OR COL_LENGTH(N'dbo.UsuariosAdmin', N'CorreoUsuario') IS NULL OR COL_LENGTH(N'dbo.UsuariosAdmin', N'Acceso') IS NULL
   OR @col IS NOT NULL
BEGIN
    ROLLBACK;
    IF @col = N'nvarchar(255) NULL'
        RAISERROR (N'Migracion 35: ya aplicada (dbo.UsuariosAdmin.NombreSolicitante existe). No se toca nada.', 16, 1);
    ELSE IF @col IS NOT NULL
        RAISERROR (N'Migracion 35: dbo.UsuariosAdmin ya tiene un NombreSolicitante distinto (%s). No se toca nada.', 16, 1, @col);
    ELSE
        RAISERROR (N'Migracion 35: falta dbo.UsuariosAdmin o una de sus columnas (Usuario, CorreoUsuario, Acceso). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE dbo.UsuariosAdmin ADD NombreSolicitante nvarchar(255) NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF (SELECT TYPE_NAME(c.user_type_id) + N'(' + CONVERT(nvarchar(10), c.max_length / 2) + N')' + CASE WHEN c.is_nullable = 1 THEN N' NULL' ELSE N' NOT NULL' END FROM sys.columns AS c WHERE c.object_id = OBJECT_ID(N'dbo.UsuariosAdmin', N'U') AND c.name = N'NombreSolicitante') = N'nvarchar(255) NULL'
BEGIN
    COMMIT;
    SELECT Script = N'Migracion 35', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 35: NombreSolicitante no quedo como se esperaba; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
