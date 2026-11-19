/* =========================================================================
   sql/85_exp_tickets_reduce_ceiling.sql - la foto diaria de Tickets a
   reducir (dbo.ExpTicketsReduce) redondea HACIA ARRIBA.
                                         ROLLBACK: _rollback.sql

   ESTADO: NO EJECUTADA EN QA NI EN NINGUNA BASE COMPARTIDA. Solo se corrio
   en bases DESECHABLES de LocalDB (GestionAdminPrueba_S85*,
   tools/tests/ExpTicketsReduceCeilingSqlLocalDbSmoke.cs). Aplicarla en QA
   requiere el OK explicito del usuario.

   REGLA (confirmada por el negocio 2026-11-11): cada iniciativa redondea
   HACIA ARRIBA por separado; un ticket fraccionario es un ticket que hay
   que atender. 7 x 99% = 6.93 -> 7. Es la misma regla que sql/84 deja en
   adm.usp_GestionAdmin_TicketsReduce y que usa el navegador (ticketsDe /
   MetaCategoria.tickets).

   QUE CAMBIA (ALTER; conserva permisos y opciones del modulo)
     dbo.usp_Exp_CalcularTicketsReduce, UNA expresion:
         CONVERT(INT, ROUND(p.Pct * ISNULL(v.N, 0), 0))
      -> CONVERT(INT, CEILING(p.Pct * ISNULL(v.N, 0)))
     Todo lo demas queda igual: el tope de 100% (p.Pct ya llega topado a 1),
     % NULL -> NULL, % <= 0 -> 0, el volumen (SLOT 0 de dbo.vw_TBSlotCAT por
     ruta normalizada), el candado, la transaccion, el resumen.
     Y una propiedad extendida del procedimiento, TicketsReduceRedondeo =
     'CEILING (sql/85)': la marca de "ya aplicada".
     0 tablas, 0 columnas, 0 datos: el ALTER no recalcula. dbo.ExpTicketsReduce
     cambia la siguiente vez que el ETL (o alguien) corra el procedimiento.

   COMO SE HACE SIN RECONSTRUIR EL CUERPO
     El cuerpo del script 65 no esta en ningun repositorio. Esta migracion
     NO lo reescribe de memoria: lee OBJECT_DEFINITION del procedimiento
     VIVO, exige que sea EXACTAMENTE el de QA (3 huellas, abajo), cambia
     solo la expresion de arriba (debe aparecer una sola vez) y la palabra
     CREATE inicial por ALTER, y ejecuta ese texto. SQL Server guarda la
     definicion con su CREATE original (comprobado en LocalDB), asi que el
     resultado es el texto de QA con esa unica expresion cambiada.

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     Las tres huellas de dbo.usp_Exp_CalcularTicketsReduce en QA
     (sql/diag_tickets_reduce_round_qa.sql S4, 2026-11-11 11:34):
       hash normalizado (sin espacios, tabs ni saltos; regla de sql/20-33)
         0x46CAAC3F0F634A29C15E58A3168A4FF26467C98102C82FCBD56FBAC588DE6A82
       hash crudo (SHA2_256 de OBJECT_DEFINITION tal cual)
         0xBDF0894DA4DD356BF3ED1560792A43A42B7D71CF7C88C0BC4EA2173AA67384C8
       largo  4153 caracteres
     la expresion ROUND exactamente una vez y ningun CEILING(;
     ANSI_NULLS y QUOTED_IDENTIFIER de la sesion = los del modulo (si no,
     se niega: el ALTER los cambiaria).
     Con la propiedad TicketsReduceRedondeo ya puesta: "ya aplicada".
   POSTCONDICION (si no, ROLLBACK)
     La definicion nueva es EXACTAMENTE la de QA con la expresion cambiada
     (mismo hash crudo que el texto esperado), ANSI_NULLS/QUOTED_IDENTIFIER
     iguales, la propiedad puesta.

   COMO CORRERLO (solo con OK)
     SSMS, base Tickets_Proactivanet, con
       SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;   (los de SSMS por omision)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'85';
     y el script completo. O sqlcmd -b -I. Una sola transaccion. Sale
     'APLICADA' o un error que dice por que no.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'85'
BEGIN
    RAISERROR (N'Migracion 85 SIN APROBAR: declara aprobar_migracion = 85 en esta sesion.', 16, 1);
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
DECLARE @ValorM  nvarchar(50)  = N'CEILING (sql/85)';

BEGIN TRAN;
DECLARE @id int = OBJECT_ID(@Proc, N'P');
DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id);
DECLARE @msg nvarchar(400);

IF @id IS NOT NULL AND EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = @id AND minor_id = 0 AND name = @Marca)
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 85: ya aplicada (el procedimiento tiene la propiedad TicketsReduceRedondeo). No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;
IF @id IS NULL OR @def IS NULL
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 85: falta dbo.usp_Exp_CalcularTicketsReduce o no hay VIEW DEFINITION. No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;

DECLARE @hn varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(@def, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hc varbinary(32) = HASHBYTES('SHA2_256', @def);
DECLARE @ln int = DATALENGTH(@def) / 2;
IF @hn <> @HNorm OR @hc <> @HCrudo OR @ln <> @Largo
BEGIN
    ROLLBACK;
    SET @msg = N'Migracion 85: dbo.usp_Exp_CalcularTicketsReduce no es la version de QA (hash ' + CONVERT(nvarchar(70), @hn, 1) +
               N', crudo ' + CONVERT(nvarchar(70), @hc, 1) + N', largo ' + CONVERT(nvarchar(12), @ln) + N'). No se toca nada.';
    RAISERROR (@msg, 16, 1);
    SET NOEXEC ON; RETURN;
END;

DECLARE @veces int = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @Viejo, N''))) / DATALENGTH(@Viejo);
IF @veces <> 1 OR CHARINDEX(N'CEILING(', @def) > 0
BEGIN
    ROLLBACK;
    SET @msg = N'Migracion 85: la expresion ROUND aparece ' + CONVERT(nvarchar(12), @veces) + N' veces (se espera 1) o ya hay CEILING(. No se toca nada.';
    RAISERROR (@msg, 16, 1);
    SET NOEXEC ON; RETURN;
END;

IF (SELECT uses_ansi_nulls FROM sys.sql_modules WHERE object_id = @id) <> CONVERT(bit, SESSIONPROPERTY('ANSI_NULLS'))
   OR (SELECT uses_quoted_identifier FROM sys.sql_modules WHERE object_id = @id) <> CONVERT(bit, SESSIONPROPERTY('QUOTED_IDENTIFIER'))
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 85: ANSI_NULLS / QUOTED_IDENTIFIER de la sesion no son los del procedimiento; el ALTER los cambiaria. Ajusta la sesion (SET ... ON/OFF) y vuelve a correrla. No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;

/* La palabra CREATE de la cabecera: la primera CREATE seguida solo de
   espacios / saltos y de PROCEDURE dbo.usp_Exp_CalcularTicketsReduce. */
DECLARE @esperado nvarchar(max) = REPLACE(@def, @Viejo, @Nuevo);
DECLARE @pos int = PATINDEX(N'%CREATE%PROCEDURE%dbo.usp_Exp_CalcularTicketsReduce%', @esperado);
DECLARE @pp int = CASE WHEN @pos > 0 THEN CHARINDEX(N'PROCEDURE', @esperado, @pos) ELSE 0 END;
DECLARE @entre nvarchar(200) = CASE WHEN @pp > @pos + 6 THEN SUBSTRING(@esperado, @pos + 6, @pp - @pos - 6) ELSE N'' END;
IF @pos = 0 OR @pp = 0 OR LEN(REPLACE(REPLACE(REPLACE(REPLACE(@entre, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) <> 0
   OR SUBSTRING(@esperado, @pp + 9, 1) NOT IN (N' ', NCHAR(9), NCHAR(13), NCHAR(10))
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 85: no se encontro la cabecera CREATE PROCEDURE esperada. No se toca nada.', 16, 1);
    SET NOEXEC ON; RETURN;
END;
DECLARE @alter nvarchar(max) = STUFF(@esperado, @pos, 6, N'ALTER');
EXEC sys.sp_executesql @alter;

DECLARE @def2 nvarchar(max) = OBJECT_DEFINITION(@id);
IF HASHBYTES('SHA2_256', @def2) <> HASHBYTES('SHA2_256', @esperado)
   OR (SELECT uses_ansi_nulls FROM sys.sql_modules WHERE object_id = @id) <> CONVERT(bit, SESSIONPROPERTY('ANSI_NULLS'))
   OR (SELECT uses_quoted_identifier FROM sys.sql_modules WHERE object_id = @id) <> CONVERT(bit, SESSIONPROPERTY('QUOTED_IDENTIFIER'))
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 85: la definicion no quedo como se esperaba; ROLLBACK de todo.', 16, 1);
    SET NOEXEC ON; RETURN;
END;

EXEC sys.sp_addextendedproperty @name = @Marca, @value = @ValorM,
     @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'PROCEDURE', @level1name = N'usp_Exp_CalcularTicketsReduce';

COMMIT;
SELECT Migracion = N'Migracion 85', Resultado = 'APLICADA',
       HashNormalizado = CONVERT(varchar(66), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(@def2, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1),
       HashCrudo = CONVERT(varchar(66), HASHBYTES('SHA2_256', @def2), 1);
GO
SET NOEXEC OFF;
GO
