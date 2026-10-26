/* =========================================================================
   sql/33_tickets_reduce_floor_rollback.sql - deshace sql/33:
   adm.usp_GestionAdmin_TicketsReduce vuelve EXACTO al de sql/18 (ROUND,
   con su comentario original).

   PRECONDICION: TicketsReduce tiene EXACTAMENTE el hash de sql/33
     0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
     Si ya es el de sql/18, se niega ("sql/33 no aplicada"). Si no existe o
     es otra version, se niega sin sobrescribirla.
   POSTCONDICION: TicketsReduce = sql/18 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46
     (el valor de ADM_04 sec 11). Si no, ROLLBACK.

   DATOS: los TicketsReduce que se calcularon con FLOOR mientras sql/33
   estuvo aplicada SE QUEDAN (no se recalcula nada); vuelven a ROUND cuando
   Crear / Modificar / Aplicar solicitud recalculen esa fila.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'33R';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'33R'
BEGIN
    RAISERROR (N'Rollback 33 SIN APROBAR: declara aprobar_migracion = 33R en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h IS NULL OR @h <> 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h, 1), N'NULL');
    IF @h = 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46
        RAISERROR (N'Rollback 33: TicketsReduce ya es la de sql/18 (sql/33 no aplicada). No se toca nada.', 16, 1);
    ELSE IF @h IS NULL
        RAISERROR (N'Rollback 33: falta adm.usp_GestionAdmin_TicketsReduce. No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 33: adm.usp_GestionAdmin_TicketsReduce no es la de sql/33 (hash %s). No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 33: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* TicketsReduce = ROUND(VolumenUltimos30 x PctDisminucion, 0) de las filas
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
                                ELSE CONVERT(int, ROUND(v.VolumenUltimos30 *
                                     CASE WHEN pc.PctDisminucion > 1 THEN 1.0 ELSE pc.PctDisminucion END, 0)) END
    FROM dbo.ProblemCategoria AS pc
    INNER JOIN @Categorias AS c
            ON pc.Categoria = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))
    OUTER APPLY (SELECT TOP (1) VolumenUltimos30 = ISNULL(x.VolumenUltimos30, 0)
                 FROM dbo.vw_ProblemCategoria AS x
                 WHERE x.Codigo = pc.Codigo AND x.Categoria = pc.Categoria) AS v
    WHERE pc.Codigo = @Codigo;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 33: nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @h2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                             OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                             N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h2 = 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46
BEGIN
    COMMIT;
    SELECT Migracion = N'Rollback 33', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex2 nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h2, 1), N'NULL');
    RAISERROR (N'Rollback 33: adm.usp_GestionAdmin_TicketsReduce no quedo como se esperaba (hash %s); ROLLBACK de todo.', 16, 1, @hex2);
END;
GO
SET NOEXEC OFF;
GO
