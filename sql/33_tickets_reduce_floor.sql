/* =========================================================================
   sql/33_tickets_reduce_floor.sql - Tickets a reducir redondeado SIEMPRE
   hacia abajo.                                ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA. NO EJECUTADA EN LA VM NI APROBADA. Solo se corrio en
   bases DESECHABLES de LocalDB (GestionAdminPrueba_S33*,
   tools/tests/TicketsReduceFloorSqlLocalDbSmoke.cs) para comprobar que
   compila y fijar los hashes de abajo. Aplicarla es otro paso, con su OK.

   POR QUE (2026-10-26)
     Admin / Iniciativas mostraba en Volumetria el total historico de la
     categoria (VolumenCategoria: 74) y la base guardaba Tickets a reducir
     sobre los ultimos 30 dias (VolumenUltimos30: 7). La regla que se fija
     es Tickets a reducir = FLOOR(VolumenUltimos30 x %): entero, siempre
     hacia abajo. Hoy la base guarda ROUND(..., 0): con 7 x 50% = 3.5 guarda
     4 (FLOOR: 3); con 7 x 9.46% = 0.6622 guarda 1 (FLOOR: 0).

   QUE CAMBIA (ALTER; conserva permisos)
     adm.usp_GestionAdmin_TicketsReduce, SOLO el redondeo:
       CONVERT(int, ROUND(v.VolumenUltimos30 * <pct topado>, 0))
         -> CONVERT(int, FLOOR(v.VolumenUltimos30 * <pct topado>))
     y la formula del comentario que va dentro de la definicion (la primera
     linea: "ROUND(VolumenUltimos30 x PctDisminucion, 0)" -> "FLOOR(...)"),
     para que la definicion no diga lo contrario de lo que hace. Todo lo
     demas es el texto EXACTO de sql/18: misma fuente (VolumenUltimos30 de
     dbo.vw_ProblemCategoria), mismo tope de 100%, sin % = NULL, mismas
     filas (@Codigo + @Categorias), mismos parametros.
     PctDisminucion es decimal(9,4) (esquema_bd/02_columnas): el producto con
     el COUNT_BIG de la vista es decimal exacto, sin coma flotante.
     0 tablas, 0 columnas, 0 datos: el ALTER no recalcula ninguna fila. Las
     ya guardadas conservan su TicketsReduce hasta que Crear / Modificar /
     Aplicar solicitud vuelvan a llamar al procedimiento para ellas.

   ORDEN: despues de sql/18 (unica migracion que define este procedimiento;
     ADM_04 sec 11: "TicketsReduce: solo sql/18"). Independiente de sql/20
     a sql/32 (ninguna lo redefine).

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     TicketsReduce = sql/18  0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46
     (regla del hash: SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni
     saltos de linea; la de sql/20 a 27 y del diag ADM_04 sec 11, que tiene
     este mismo valor para sql/18).
     Si ya tiene el de sql/33, se niega ("ya aplicada"). Si no existe o es
     otra version, se niega sin sobrescribirla.
   POSTCONDICION (si no, ROLLBACK)
     TicketsReduce   0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F

   DIAG ADM_04 (repo del backend), seccion 11: ya registra este hash.
     Antes de aplicarla, TicketsReduce sale 'sql/18 (anterior: falta la
     siguiente migracion)'; despues, 'sql/33 (vigente)'; tras el rollback,
     otra vez 'sql/18 (anterior...)'. 'OTRA: revisar' = ninguna de las dos.

   LO QUE NO CAMBIA (y hay que saber)
     dbo.ExpTicketsReduce (foto diaria de dbo.usp_Exp_CalcularTicketsReduce,
     script 65 del repo de integracion) sigue con su propia regla; el
     registro de Admin y Experiencia la prefieren cuando el % no cambio.
     Alinearla es una propuesta aparte (falta leer el 65).

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'33';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'33'
BEGIN
    RAISERROR (N'Migracion 33 SIN APROBAR: declara aprobar_migracion = 33 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h IS NULL OR @h <> 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h, 1), N'NULL');
    IF @h = 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
        RAISERROR (N'Migracion 33: ya aplicada (TicketsReduce tiene el hash de sql/33). No se toca nada.', 16, 1);
    ELSE IF @h IS NULL
        RAISERROR (N'Migracion 33: falta adm.usp_GestionAdmin_TicketsReduce (sql/18). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 33: adm.usp_GestionAdmin_TicketsReduce no es la de sql/18 (hash %s). No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 33: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 33: nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @h2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                             OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                             N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h2 = 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
BEGIN
    COMMIT;
    SELECT Migracion = N'Migracion 33', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex2 nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h2, 1), N'NULL');
    RAISERROR (N'Migracion 33: adm.usp_GestionAdmin_TicketsReduce no quedo como se esperaba (hash %s); ROLLBACK de todo.', 16, 1, @hex2);
END;
GO
SET NOEXEC OFF;
GO
