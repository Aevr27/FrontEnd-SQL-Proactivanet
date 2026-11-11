/* =========================================================================
   sql/84_tickets_reduce_ceiling_rollback_a_33.sql - deshace sql/84 cuando
   ANTES estaba sql/33 (FLOOR): adm.usp_GestionAdmin_TicketsReduce
   vuelve EXACTO al texto de sql/33. El otro rollback es para sql/18.

   PRECONDICION: TicketsReduce tiene EXACTAMENTE el hash de sql/84
     0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591
     y su propiedad TicketsReduceAntes = 'sql/33' (la dejo sql/84). Si
     dice la otra version, se niega: usa el otro rollback. Si ya es la de
     sql/33, "sql/84 no aplicada". Otra version: se niega sin tocarla.
   POSTCONDICION: TicketsReduce = sql/33 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
     y sin la propiedad TicketsReduceAntes. Si no, ROLLBACK.

   DATOS: los TicketsReduce calculados con CEILING mientras sql/84 estuvo
   aplicada SE QUEDAN (no se recalcula nada).

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'84R33';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'84R33'
BEGIN
    RAISERROR (N'Rollback 84 a sql/33 SIN APROBAR: declara aprobar_migracion = 84R33 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @antes nvarchar(20) = CONVERT(nvarchar(20), (SELECT value FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P') AND minor_id = 0 AND name = N'TicketsReduceAntes'));
IF @h IS NULL OR @h <> 0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591 OR ISNULL(@antes, N'') <> N'sql/33'
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h, 1), N'NULL');
    IF @h = 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
        RAISERROR (N'Rollback 84 a sql/33: sql/84 no aplicada (ya es sql/33). No se toca nada.', 16, 1);
    ELSE IF @h = 0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591
        RAISERROR (N'Rollback 84 a sql/33: antes de sql/84 estaba %s, no sql/33: usa el otro rollback. No se toca nada.', 16, 1, @antes);
    ELSE
        RAISERROR (N'Rollback 84 a sql/33: adm.usp_GestionAdmin_TicketsReduce no es la de sql/84 (hash %s). No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 84 a sql/33: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* TicketsReduce = FLOOR(VolumenUltimos30 x PctDisminucion) de las filas
   (@Codigo, Categoria) dadas, con el VolumenUltimos30 de la MISMA vista que
   lo publica (dbo.vw_ProblemCategoria); no se repite su conteo aqui. Sin %
   = NULL. Lo llaman Crear y Modificar dentro de su transaccion. */
ALTER PROCEDURE adm.usp_GestionAdmin_TicketsReduce
    @Codigo     nvarchar(100),
    @Categorias adm.CategoriaPctTipo READONLY   -- solo se lee Categoria
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    UPDATE pc SET
        pc.TicketsReduce = CASE WHEN pc.PctDisminucion IS NULL THEN NULL
                                ELSE CONVERT(int, FLOOR(v.VolumenUltimos30 *
                                     CASE WHEN pc.PctDisminucion > 1 THEN 1.0 ELSE pc.PctDisminucion END)) END
    FROM dbo.ProblemCategoria AS pc
    INNER JOIN @Categorias AS c
            ON pc.Categoria = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))
    OUTER APPLY (SELECT TOP (1) VolumenUltimos30 = ISNULL(x.VolumenUltimos30, 0)
                 FROM dbo.vw_ProblemCategoria AS x
                 WHERE x.Codigo = pc.Codigo AND x.Categoria = pc.Categoria) AS v
    WHERE pc.Codigo = @Codigo;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 84 a sql/33: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
EXEC sys.sp_dropextendedproperty @name = N'TicketsReduceAntes',
     @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'usp_GestionAdmin_TicketsReduce';
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 84 a sql/33: nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @h2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h2 = 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F AND CONVERT(nvarchar(20), (SELECT value FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P') AND minor_id = 0 AND name = N'TicketsReduceAntes')) IS NULL
BEGIN
    COMMIT;
    SELECT Migracion = N'Rollback 84 a sql/33', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex2 nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h2, 1), N'NULL');
    RAISERROR (N'Rollback 84 a sql/33: adm.usp_GestionAdmin_TicketsReduce no quedo como se esperaba (hash %s); ROLLBACK de todo.', 16, 1, @hex2);
END;
GO
SET NOEXEC OFF;
GO
