/* =========================================================================
   sql/18_gestion_admin_persistencia_rollback.sql - Deshace sql/18.

   ORDEN: primero los scripts del backend que leen las columnas nuevas
   (vw_ProblemCategoria / vw_ProblemVencido con fecha por categoria tienen
   su propio rollback). Si algun modulo fuera de los de sql/18 todavia
   menciona FechaAnalisisCategoria, FechaCreacionCategoria o la columna
   Categoria de dbo.ProblemFechaEvento, este script se niega.

   SE NIEGA si Admin ya escribio fechas por categoria (filas con fecha
   propia o eventos con Categoria): quitar las columnas las perderia y un
   evento de categoria sin su Categoria se leeria como de la iniciativa.
   Igual si adm.IniciativaProtegida tiene filas (forzado: se pierde el
   registro, no las iniciativas). Y SIEMPRE, aun forzado, si otro modulo
   la lee (el cargador con ADM_04): primero el rollback de ADM_04.
   Para forzarlo, en la misma sesion:
       EXEC sys.sp_set_session_context N'forzar_rollback_18', N'SI';
   Forzado: BORRA los eventos con Categoria (no se pueden conservar sin la
   columna) y quita las columnas. NO borra filas de dbo.Problem /
   dbo.ProblemCategoria creadas por Admin ni toca los eventos de la
   iniciativa (Categoria NULL): esos se quedan como estan.

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

-- Modulos ajenos a sql/18 que usan las columnas nuevas (vistas del backend).
DECLARE @ajeno nvarchar(300) = (
    SELECT TOP (1) OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id)
    FROM sys.sql_modules AS m
    WHERE (m.definition LIKE N'%FechaAnalisisCategoria%' OR m.definition LIKE N'%FechaCreacionCategoria%'
           OR m.definition LIKE N'%e.Categoria IS NULL%')
      AND m.object_id NOT IN (OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento'),
                              ISNULL(OBJECT_ID('adm.usp_GestionAdmin_Crear'), 0),
                              ISNULL(OBJECT_ID('adm.usp_GestionAdmin_Modificar'), 0),
                              ISNULL(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce'), 0),
                              ISNULL(OBJECT_ID('adm.usp_GestionAdmin_RevisarTope'), 0))
    ORDER BY 1);
IF @ajeno IS NOT NULL
BEGIN
    DECLARE @m nvarchar(500) = N'Rollback 18: ' + @ajeno + N' todavia usa las columnas de sql/18. Deshaz primero su script del backend.';
    THROW 51091, @m, 1;
END;

-- adm.IniciativaProtegida: si el cargador parchado (ADM_04) u otro modulo
-- la lee, quitarla lo dejaria fallando en cada corrida. Ni forzado:
-- primero el rollback de ADM_04 (con el programador apagado).
DECLARE @lector nvarchar(300) = (
    SELECT TOP (1) OBJECT_SCHEMA_NAME(d.referencing_id) + N'.' + OBJECT_NAME(d.referencing_id)
    FROM sys.sql_expression_dependencies AS d
    WHERE d.referenced_id = OBJECT_ID('adm.IniciativaProtegida')
      AND d.referencing_id NOT IN (ISNULL(OBJECT_ID('adm.usp_GestionAdmin_Crear'), 0),
                                   ISNULL(OBJECT_ID('adm.usp_GestionAdmin_Modificar'), 0))
      -- Sus propias restricciones (CHECK / DEFAULT) no cuentan.
      AND d.referencing_id NOT IN (SELECT o.object_id FROM sys.objects AS o
                                   WHERE o.parent_object_id = OBJECT_ID('adm.IniciativaProtegida'))
    ORDER BY 1);
IF @lector IS NOT NULL
BEGIN
    DECLARE @m2 nvarchar(500) = N'Rollback 18: ' + @lector + N' lee adm.IniciativaProtegida. Deshaz primero ADM_04 (backend).';
    THROW 51093, @m2, 1;
END;

DECLARE @hayDatos bit = 0;
-- Iniciativas protegidas registradas: quitar la tabla pierde el registro
-- (las filas de dbo.Problem / dbo.ProblemCategoria se quedan).
IF OBJECT_ID('adm.IniciativaProtegida', 'U') IS NOT NULL
    EXEC sys.sp_executesql
        N'IF EXISTS (SELECT 1 FROM adm.IniciativaProtegida) SET @h = 1;',
        N'@h bit OUTPUT', @h = @hayDatos OUTPUT;
IF COL_LENGTH('dbo.ProblemCategoria', 'FechaCreacionCategoria') IS NOT NULL
    -- Dinamico: si la columna no existe, el lote no compilaria.
    EXEC sys.sp_executesql
        N'IF EXISTS (SELECT 1 FROM dbo.ProblemCategoria WHERE FechaCreacionCategoria IS NOT NULL OR FechaAnalisisCategoria IS NOT NULL) SET @h = 1;',
        N'@h bit OUTPUT', @h = @hayDatos OUTPUT;
IF COL_LENGTH('dbo.ProblemFechaEvento', 'Categoria') IS NOT NULL
    EXEC sys.sp_executesql
        N'IF EXISTS (SELECT 1 FROM dbo.ProblemFechaEvento WHERE Categoria IS NOT NULL) SET @h = 1;',
        N'@h bit OUTPUT', @h = @hayDatos OUTPUT;
IF @hayDatos = 1 AND ISNULL(CONVERT(nvarchar(5), SESSION_CONTEXT(N'forzar_rollback_18')), N'') <> N'SI'
    THROW 51090, N'Rollback 18: ya hay fechas o eventos por categoria. No se deshace sin forzar_rollback_18 = SI (borra esos eventos).', 1;

IF OBJECT_ID('adm.usp_GestionAdmin_Modificar', 'P') IS NOT NULL DROP PROCEDURE adm.usp_GestionAdmin_Modificar;
IF OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P') IS NOT NULL DROP PROCEDURE adm.usp_GestionAdmin_Crear;
IF OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P') IS NOT NULL DROP PROCEDURE adm.usp_GestionAdmin_TicketsReduce;
IF OBJECT_ID('adm.usp_GestionAdmin_RevisarTope', 'P') IS NOT NULL DROP PROCEDURE adm.usp_GestionAdmin_RevisarTope;
IF OBJECT_ID('adm.IniciativaProtegida', 'U') IS NOT NULL DROP TABLE adm.IniciativaProtegida;
IF TYPE_ID('adm.CategoriaPctTipo') IS NOT NULL DROP TYPE adm.CategoriaPctTipo;
IF TYPE_ID('adm.CategoriaFechaTipo') IS NOT NULL DROP TYPE adm.CategoriaFechaTipo;
IF OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento', 'TR') IS NOT NULL DROP TRIGGER dbo.trg_ProblemCategoria_FechaEvento;
IF OBJECT_ID('dbo.FK_ProblemFechaEvento_ProblemCategoria', 'F') IS NOT NULL
    ALTER TABLE dbo.ProblemFechaEvento DROP CONSTRAINT FK_ProblemFechaEvento_ProblemCategoria;
IF OBJECT_ID('dbo.CK_ProblemFechaEvento_Nivel', 'C') IS NOT NULL
    ALTER TABLE dbo.ProblemFechaEvento DROP CONSTRAINT CK_ProblemFechaEvento_Nivel;
IF COL_LENGTH('dbo.ProblemFechaEvento', 'Categoria') IS NOT NULL
    EXEC (N'DELETE dbo.ProblemFechaEvento WHERE Categoria IS NOT NULL; ALTER TABLE dbo.ProblemFechaEvento DROP COLUMN Categoria;');
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
