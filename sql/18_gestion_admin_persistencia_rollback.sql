/* =========================================================================
   sql/18_gestion_admin_persistencia_rollback.sql - Deshace sql/18.

   SE NIEGA si Admin ya escribio algo (filas en adm.ProblemaAdmin, fechas
   propias en ProblemCategoria o eventos ADMIN en las tablas nuevas): en ese
   punto ya no es "deshacer una instalacion" sino perder datos, y eso se
   decide aparte. Para forzarlo, en la misma sesion:
       EXEC sys.sp_set_session_context N'forzar_rollback_18', N'SI';
   Aun forzado NO borra filas de dbo.Problem / dbo.ProblemCategoria creadas
   por Admin: solo quita los objetos de sql/18.

   Misma guarda de aprobacion que sql/18 (aprobar_migracion = '18' o base
   GestionAdminPrueba_*). Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'18'
BEGIN
    RAISERROR (N'Rollback 18 SIN APROBAR: declara aprobar_migracion = 18 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @hayDatos bit = 0;
IF OBJECT_ID('adm.ProblemaAdmin', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM adm.ProblemaAdmin) SET @hayDatos = 1;
IF COL_LENGTH('dbo.ProblemCategoria', 'FechaCreacionCategoria') IS NOT NULL
    -- Dinamico: si la columna no existe, el lote no compilaria.
    EXEC sys.sp_executesql
        N'IF EXISTS (SELECT 1 FROM dbo.ProblemCategoria WHERE FechaCreacionCategoria IS NOT NULL) SET @h = 1;',
        N'@h bit OUTPUT', @h = @hayDatos OUTPUT;
IF @hayDatos = 1 AND ISNULL(CONVERT(nvarchar(5), SESSION_CONTEXT(N'forzar_rollback_18')), N'') <> N'SI'
    THROW 51090, N'Rollback 18: Admin ya escribio datos con estos objetos. No se deshace sin forzar_rollback_18 = SI.', 1;

IF OBJECT_ID('adm.usp_GestionAdmin_Modificar', 'P') IS NOT NULL DROP PROCEDURE adm.usp_GestionAdmin_Modificar;
IF OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P') IS NOT NULL DROP PROCEDURE adm.usp_GestionAdmin_Crear;
IF OBJECT_ID('adm.usp_GestionAdmin_RevisarTope', 'P') IS NOT NULL DROP PROCEDURE adm.usp_GestionAdmin_RevisarTope;
IF OBJECT_ID('adm.usp_SiguienteCodigoProblem', 'P') IS NOT NULL DROP PROCEDURE adm.usp_SiguienteCodigoProblem;
IF TYPE_ID('adm.CategoriaPctTipo') IS NOT NULL DROP TYPE adm.CategoriaPctTipo;
IF OBJECT_ID('adm.ContadorCodigo', 'U') IS NOT NULL DROP TABLE adm.ContadorCodigo;
IF OBJECT_ID('adm.ProblemaAdmin', 'U') IS NOT NULL DROP TABLE adm.ProblemaAdmin;
IF OBJECT_ID('dbo.trg_ProblemCategoria_PctEvento', 'TR') IS NOT NULL DROP TRIGGER dbo.trg_ProblemCategoria_PctEvento;
IF OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento', 'TR') IS NOT NULL DROP TRIGGER dbo.trg_ProblemCategoria_FechaEvento;
IF OBJECT_ID('dbo.ProblemCategoriaPctEvento', 'U') IS NOT NULL DROP TABLE dbo.ProblemCategoriaPctEvento;
IF OBJECT_ID('dbo.ProblemCategoriaFechaEvento', 'U') IS NOT NULL DROP TABLE dbo.ProblemCategoriaFechaEvento;
IF OBJECT_ID('dbo.CK_ProblemCategoria_FechasCategoria', 'C') IS NOT NULL
    ALTER TABLE dbo.ProblemCategoria DROP CONSTRAINT CK_ProblemCategoria_FechasCategoria;
IF COL_LENGTH('dbo.ProblemCategoria', 'FechaAnalisisCategoria') IS NOT NULL
    ALTER TABLE dbo.ProblemCategoria DROP COLUMN FechaAnalisisCategoria;
IF COL_LENGTH('dbo.ProblemCategoria', 'FechaCreacionCategoria') IS NOT NULL
    ALTER TABLE dbo.ProblemCategoria DROP COLUMN FechaCreacionCategoria;
GO
IF @@TRANCOUNT > 0 AND SCHEMA_ID('adm') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.objects WHERE schema_id = SCHEMA_ID('adm'))
   AND NOT EXISTS (SELECT 1 FROM sys.types WHERE schema_id = SCHEMA_ID('adm'))
    EXEC (N'DROP SCHEMA adm');
GO
IF @@TRANCOUNT > 0
BEGIN
    COMMIT;
    SELECT Migracion = 18, Resultado = 'DESHECHA';
END;
GO
SET NOEXEC OFF;
GO
