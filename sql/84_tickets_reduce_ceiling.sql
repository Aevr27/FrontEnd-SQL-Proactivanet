/* =========================================================================
   sql/84_tickets_reduce_ceiling.sql - Tickets a reducir redondeado SIEMPRE
   hacia ARRIBA.          ROLLBACK: _rollback_a_18.sql o _rollback_a_33.sql

   ESTADO: NO EJECUTADA EN QA NI EN NINGUNA BASE COMPARTIDA. Solo se corrio
   en bases DESECHABLES de LocalDB (GestionAdminPrueba_S84*,
   tools/tests/TicketsReduceCeilingSqlLocalDbSmoke.cs). Aplicarla en QA
   requiere el OK explicito del usuario.
   QA (diag_tickets_reduce_round_qa.sql S1, 2026-11-11 11:34): el
   procedimiento tiene EXACTAMENTE el hash de sql/33 (FLOOR, modificado
   2026-10-26) y no tiene TicketsReduceAntes: el rollback que corresponde
   en QA es _rollback_a_33.sql.

   REGLA (confirmada por el negocio 2026-11-11): cada iniciativa redondea
   HACIA ARRIBA por separado; un ticket fraccionario es un ticket que hay
   que atender. 7 x 99% = 6.93 -> 7. La foto diaria (dbo.ExpTicketsReduce)
   pasa a la misma regla con sql/85.

   POR QUE (2026-11-10)
     Se decide volver a redondear HACIA ARRIBA: Tickets a reducir =
     CEILING(VolumenUltimos30 x %). Con FLOOR (sql/33) 7 x 9.46% = 0.66
     guarda 0 y 418 x 10% = 41.8 guarda 41; con CEILING, 1 y 42. Lo exacto no
     sube (30 x 50% = 15). El navegador (ticketsDe de admin/iniciativas.js y
     MetaCategoria.tickets de admin/iniciativa-admin.js) ya calcula asi.

   QUE CAMBIA (ALTER; conserva permisos)
     adm.usp_GestionAdmin_TicketsReduce, SOLO el redondeo, sobre el texto EXACTO
     de sql/33: FLOOR( -> CEILING( en la expresion y en su comentario. Misma
     fuente (VolumenUltimos30 de dbo.vw_ProblemCategoria), mismo tope de
     100%, sin % = NULL, mismas filas, mismos parametros. PctDisminucion es
     decimal(9,4): el producto es decimal exacto, sin coma flotante.
     Y una propiedad extendida del procedimiento, TicketsReduceAntes =
     'sql/18' o 'sql/33': la version que habia, para que el rollback la
     deje EXACTA. 0 tablas, 0 columnas, 0 datos: el ALTER no recalcula
     ninguna fila; las guardadas conservan su TicketsReduce hasta que Crear /
     Modificar / Aplicar solicitud vuelvan a llamar al procedimiento.

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     TicketsReduce = sql/18 (ROUND) 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46
                  o sql/33 (FLOOR) 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
     (sql/diag_tickets_reduce_redondeo.sql dice cual hay; en el repo sql/33
     figura sin aplicar). Con el de sql/84, "ya aplicada". Otra version o
     sin el procedimiento: se niega sin sobrescribir.
   POSTCONDICION (si no, ROLLBACK)
     TicketsReduce   0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591
     y TicketsReduceAntes = la version de la precondicion.

   LO QUE NO CAMBIA (y hay que saber)
     dbo.ExpTicketsReduce (foto diaria de dbo.usp_Exp_CalcularTicketsReduce,
     script 65 del repo de integracion, cuyo cuerpo no esta en este repo)
     no la toca esta migracion; Experiencia y el registro de Admin la
     prefieren cuando el % no cambio. La alinea sql/85 (otra migracion,
     otro OK). El VOLUMEN tampoco cambia: aqui es VolumenUltimos30 (30 dias
     vivos); la foto usa el SLOT 0 de vw_TBSlotCAT. Mismo redondeo no
     garantiza el mismo numero si los volumenes difieren.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'84';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'84'
BEGIN
    RAISERROR (N'Migracion 84 SIN APROBAR: declara aprobar_migracion = 84 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h = 0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 84: ya aplicada (TicketsReduce tiene el hash de sql/84). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF @h IS NULL OR (@h <> 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46 AND @h <> 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F)
BEGIN
    ROLLBACK;
    DECLARE @hex nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h, 1), N'NULL');
    IF @h IS NULL
        RAISERROR (N'Migracion 84: falta adm.usp_GestionAdmin_TicketsReduce. No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 84: adm.usp_GestionAdmin_TicketsReduce no es la de sql/18 ni la de sql/33 (hash %s). No se toca nada.', 16, 1, @hex);
    SET NOEXEC ON;
END
ELSE IF CONVERT(nvarchar(20), (SELECT value FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P') AND minor_id = 0 AND name = N'TicketsReduceAntes')) IS NOT NULL
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 84: el procedimiento ya tiene TicketsReduceAntes (un rollback a medias?). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END
ELSE
BEGIN
    DECLARE @antes nvarchar(20) = CASE WHEN @h = 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46 THEN N'sql/18' ELSE N'sql/33' END;
    EXEC sys.sp_set_session_context N'm84_antes', @antes, @read_only = 0;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 84: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* TicketsReduce = CEILING(VolumenUltimos30 x PctDisminucion) de las filas
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
                                ELSE CONVERT(int, CEILING(v.VolumenUltimos30 *
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 84: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @antes nvarchar(20) = CONVERT(nvarchar(20), SESSION_CONTEXT(N'm84_antes'));
EXEC sys.sp_addextendedproperty @name = N'TicketsReduceAntes', @value = @antes,
     @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'usp_GestionAdmin_TicketsReduce';
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 84: nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @h2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                            OBJECT_DEFINITION(OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P')),
                            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @antes2 nvarchar(20) = CONVERT(nvarchar(20), SESSION_CONTEXT(N'm84_antes'));
IF @h2 = 0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591 AND @antes2 IN (N'sql/18', N'sql/33') AND CONVERT(nvarchar(20), (SELECT value FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P') AND minor_id = 0 AND name = N'TicketsReduceAntes')) = @antes2
BEGIN
    COMMIT;
    SELECT Migracion = N'Migracion 84', Resultado = 'APLICADA', Antes = @antes2;
END
ELSE
BEGIN
    ROLLBACK;
    DECLARE @hex2 nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @h2, 1), N'NULL');
    RAISERROR (N'Migracion 84: adm.usp_GestionAdmin_TicketsReduce no quedo como se esperaba (hash %s); ROLLBACK de todo.', 16, 1, @hex2);
END;
EXEC sys.sp_set_session_context N'm84_antes', NULL;
GO
SET NOEXEC OFF;
GO
