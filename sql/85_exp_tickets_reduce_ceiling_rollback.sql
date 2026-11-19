/* =========================================================================
   sql/85_exp_tickets_reduce_ceiling_rollback.sql - deshace sql/85:
   dbo.usp_Exp_CalcularTicketsReduce vuelve EXACTO al texto de QA (ROUND).

   COMO: lee la definicion viva, cambia la UNICA expresion
         CONVERT(INT, CEILING(p.Pct * ISNULL(v.N, 0)))
      -> CONVERT(INT, ROUND(p.Pct * ISNULL(v.N, 0), 0))
   y exige, ANTES de ejecutar, que el texto resultante tenga las tres
   huellas de QA (las mismas de la precondicion de sql/85). Si no, no toca
   nada: no se puede volver "al original" desde otra version.

   PRECONDICION: la propiedad TicketsReduceRedondeo existe (la dejo sql/85),
     la expresion CEILING aparece una vez y ROUND ninguna, y el texto
     revertido = QA (hash normalizado, hash crudo, largo). Sin la propiedad:
     "sql/85 no aplicada".
   POSTCONDICION: hash crudo de la definicion = el de QA
     0xBDF0894DA4DD356BF3ED1560792A43A42B7D71CF7C88C0BC4EA2173AA67384C8,
     sin la propiedad. Si no, ROLLBACK.

   DATOS: lo que la foto calculo con CEILING se queda hasta la siguiente
   corrida del procedimiento (no se recalcula nada).

   COMO CORRERLO (solo con OK)
       SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'85R';
     y el script completo. Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'85R'
BEGIN
    RAISERROR (N'Rollback 85 SIN APROBAR: declara aprobar_migracion = 85R en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
SET NOCOUNT ON;
DECLARE @Proc    sysname       = N'dbo.usp_Exp_CalcularTicketsReduce';
DECLARE @HNorm   varbinary(32) = 0x46CAAC3F0F634A29C15E58A3168A4FF26467C98102C82FCBD56FBAC588DE6A82;
DECLARE @HCrudo  varbinary(32) = 0xBDF0894DA4DD356BF3ED1560792A43A42B7D71CF7C88C0BC4EA2173AA67384C8;
DECLARE @Largo   int           = 4153;
DECLARE @Viejo   nvarchar(100) = N'CONVERT(INT, ROUND(p.Pct * ISNULL(v.N, 0), 0))';
DECLARE @Nuevo   nvarchar(100) = N'CONVERT(INT, CEILING(p.Pct * ISNULL(v.N, 0)))';
DECLARE @Marca   sysname       = N'TicketsReduceRedondeo';

BEGIN TRAN;
DECLARE @id int = OBJECT_ID(@Proc, N'P');
DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id);

IF @id IS NULL OR @def IS NULL
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 85: falta dbo.usp_Exp_CalcularTicketsReduce o no hay VIEW DEFINITION. No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = @id AND minor_id = 0 AND name = @Marca)
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 85: sql/85 no aplicada (falta la propiedad TicketsReduceRedondeo). No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;

DECLARE @veces int = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @Nuevo, N''))) / DATALENGTH(@Nuevo);
DECLARE @original nvarchar(max) = REPLACE(@def, @Nuevo, @Viejo);
IF @veces <> 1 OR CHARINDEX(@Viejo, @def) > 0
   OR HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(@original, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) <> @HNorm
   OR HASHBYTES('SHA2_256', @original) <> @HCrudo OR DATALENGTH(@original) / 2 <> @Largo
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 85: el procedimiento no es el que dejo sql/85 (revertido no da el texto de QA). No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;
IF (SELECT uses_ansi_nulls FROM sys.sql_modules WHERE object_id = @id) <> CONVERT(bit, SESSIONPROPERTY('ANSI_NULLS'))
   OR (SELECT uses_quoted_identifier FROM sys.sql_modules WHERE object_id = @id) <> CONVERT(bit, SESSIONPROPERTY('QUOTED_IDENTIFIER'))
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 85: ANSI_NULLS / QUOTED_IDENTIFIER de la sesion no son los del procedimiento. Ajusta la sesion y vuelve a correrlo. No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;

DECLARE @pos int = PATINDEX(N'%CREATE%PROCEDURE%dbo.usp_Exp_CalcularTicketsReduce%', @original);
DECLARE @pp int = CASE WHEN @pos > 0 THEN CHARINDEX(N'PROCEDURE', @original, @pos) ELSE 0 END;
DECLARE @entre nvarchar(200) = CASE WHEN @pp > @pos + 6 THEN SUBSTRING(@original, @pos + 6, @pp - @pos - 6) ELSE N'' END;
IF @pos = 0 OR @pp = 0 OR LEN(REPLACE(REPLACE(REPLACE(REPLACE(@entre, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) <> 0
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 85: no se encontro la cabecera CREATE PROCEDURE esperada. No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;
DECLARE @alter nvarchar(max) = STUFF(@original, @pos, 6, N'ALTER');
EXEC sys.sp_executesql @alter;

EXEC sys.sp_dropextendedproperty @name = @Marca,
     @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'PROCEDURE', @level1name = N'usp_Exp_CalcularTicketsReduce';

IF HASHBYTES('SHA2_256', OBJECT_DEFINITION(@id)) <> @HCrudo
   OR EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = @id AND minor_id = 0 AND name = @Marca)
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 85: el procedimiento no quedo EXACTO al de QA; ROLLBACK de todo.', 16, 1);
    SET NOEXEC ON; RETURN;
END;

COMMIT;
SELECT Migracion = N'Rollback 85', Resultado = 'DESHECHA', HashCrudo = CONVERT(varchar(66), HASHBYTES('SHA2_256', OBJECT_DEFINITION(@id)), 1);
GO
SET NOEXEC OFF;
GO
