/* =====================================================================
   DIAGNOSTICO -- dbo.usp_CorreoQARE_Detalle como fuente del export QARE

   SOLO LECTURA sobre la base. Ningun CREATE/ALTER/DROP de objetos de la
   base ni INSERT/UPDATE/DELETE en sus tablas. Lo unico que se escribe son
   tablas temporales locales (#...), que viven en tempdb y desaparecen al
   cerrar la sesion. Correr en la VM (SSMS, base Tickets_Proactivanet) y
   pegar la salida.

   Que contesta:
     0) El cuerpo COMPLETO del SP, en dos formas:
          0a) una celda XML: en modo cuadricula, clic y abre entero.
          0b) sp_helptext linea por linea, numerado. Cada linea mide <= 255,
              asi que "Results to Text" (tope por omision 256) no lo corta.
        Mas las lineas que tocan WHERE / fechas / QARe_VerificoClasificacion
        / los seis campos Es* y UsuarioConfirmo (0c), y la forma del primer
        result set (0d).
     1) Poblacion: filas y tickets del SP contra dbo.tvf_CorreoQARE_Base
        (sin filtros), en 15 y 30 dias, en ambos sentidos, y duplicados de
        CodigoTicket en el SP. Esperado: 0 diferencias y 0 duplicados.
     2) Muestras (TOP 20) de cada diferencia, con su FechaFirmaSolucion en
        dbo.vw_CorreoQARECierre_Base, para ver de donde sale la diferencia.

   Ventana: los N dias que terminan HOY en Mexico, como el tablero
   (qare.js rangoRapido: fin = hoy, inicio = fin - (N - 1)). Al SP y a la TVF
   se les pasan las MISMAS dos fechas DATE.
   ===================================================================== */

SET NOCOUNT ON;

DECLARE @Sp  NVARCHAR(300) = N'dbo.usp_CorreoQARE_Detalle';
DECLARE @Ff  DATE = CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()));


/* 0a) Cuerpo completo en una celda XML ---------------------------------- */
SELECT Prueba = '0a cuerpo (clic en la celda)',
       Cuerpo = CAST(N'<x><![CDATA[' + OBJECT_DEFINITION(OBJECT_ID(@Sp)) + N']]></x>' AS XML);


/* 0b) Cuerpo linea por linea -------------------------------------------- */
IF OBJECT_ID('tempdb..#cuerpo') IS NOT NULL DROP TABLE #cuerpo;
CREATE TABLE #cuerpo (Linea INT IDENTITY(1,1) PRIMARY KEY, Texto NVARCHAR(4000) NULL);
INSERT #cuerpo (Texto) EXEC sp_helptext @Sp;

SELECT Prueba = '0b cuerpo', Linea,
       Texto = REPLACE(REPLACE(Texto, CHAR(13), N''), CHAR(10), N'')
FROM #cuerpo ORDER BY Linea;


/* 0c) Lineas clave (atajo; el cuerpo completo manda) --------------------- */
SELECT Prueba = '0c lineas clave', Linea,
       Texto = REPLACE(REPLACE(Texto, CHAR(13), N''), CHAR(10), N'')
FROM #cuerpo
WHERE Texto LIKE N'%WHERE%' OR Texto LIKE N'%@FechaInicio%' OR Texto LIKE N'%@FechaFin%'
   OR Texto LIKE N'%DATEADD%' OR Texto LIKE N'%FechaFirmaSolucion%'
   OR Texto LIKE N'%VerificoClasificacion%' OR Texto LIKE N'%UsuarioConfirmo%'
   OR Texto LIKE N'%EsRecurrente%' OR Texto LIKE N'%EsCasoReutilizable%'
   OR Texto LIKE N'%EsPotencialKB%' OR Texto LIKE N'%EsInconsistencia%'
   OR Texto LIKE N'%EsOportunidadKB%' OR Texto LIKE N'% AND %' OR Texto LIKE N'%JOIN%'
ORDER BY Linea;


/* 0d) Forma del primer result set --------------------------------------- */
SELECT Prueba = '0d result set', r.column_ordinal, Columna = r.name, r.system_type_name,
       r.is_nullable, r.error_message
FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(@Sp), 0) AS r
WHERE r.is_hidden = 0 OR r.is_hidden IS NULL
ORDER BY r.column_ordinal;


/* 1) Poblacion SP vs TVF ------------------------------------------------ */
-- #det recibe la salida del SP. Sus columnas se copian de 0d (nombres y
-- tipos reales del SP): nada se escribe a mano. Se crea con una columna de
-- relleno y se ALTERa por SQL dinamico -una #tabla creada DENTRO del SQL
-- dinamico moriria al terminar ese EXEC-.
IF OBJECT_ID('tempdb..#det') IS NOT NULL DROP TABLE #det;
CREATE TABLE #det (__relleno BIT NULL);

DECLARE @cols NVARCHAR(MAX), @errForma NVARCHAR(4000);
SELECT @errForma = MAX(r.error_message)
FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(@Sp), 0) AS r;
SELECT @cols = STRING_AGG(CAST(QUOTENAME(r.name) + N' ' + r.system_type_name + N' NULL' AS NVARCHAR(MAX)), N', ')
               WITHIN GROUP (ORDER BY r.column_ordinal)
FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(@Sp), 0) AS r
WHERE r.is_hidden = 0 AND r.error_message IS NULL;

IF @cols IS NULL
BEGIN
    SELECT Prueba = '1 ERROR', Detalle = N'No se pudo leer la forma del result set: '
                                        + ISNULL(@errForma, N'(sin mensaje)');
    RETURN;
END

DECLARE @ddl NVARCHAR(MAX) = N'ALTER TABLE #det ADD ' + @cols + N'; ALTER TABLE #det DROP COLUMN __relleno;';
EXEC sys.sp_executesql @ddl;

IF OBJECT_ID('tempdb..#pobDet') IS NOT NULL DROP TABLE #pobDet;
IF OBJECT_ID('tempdb..#pobTvf') IS NOT NULL DROP TABLE #pobTvf;
IF OBJECT_ID('tempdb..#corrida') IS NOT NULL DROP TABLE #corrida;
CREATE TABLE #pobDet (Dias INT, CodigoTicket NVARCHAR(100) COLLATE DATABASE_DEFAULT NULL,
                      FechaFirmaSolucion DATETIME2(0) NULL);
CREATE TABLE #pobTvf (Dias INT, CodigoTicket NVARCHAR(100) COLLATE DATABASE_DEFAULT NULL,
                      FechaFirmaSolucion DATETIME2(0) NULL);
CREATE TABLE #corrida (Dias INT, FechaInicio DATE, FechaFin DATE, MsDetalle INT NULL,
                       MsTvf INT NULL, Error NVARCHAR(4000) NULL);

DECLARE @Ventanas TABLE (Dias INT);
INSERT @Ventanas VALUES (15), (30);

DECLARE @d INT, @Fi DATE, @t0 DATETIME2, @msDet INT, @msTvf INT, @err NVARCHAR(4000);
DECLARE @copia NVARCHAR(MAX) =
    N'INSERT #pobDet (Dias, CodigoTicket, FechaFirmaSolucion)
      SELECT @Dias, CAST(CodigoTicket AS NVARCHAR(100)), CAST(FechaFirmaSolucion AS DATETIME2(0)) FROM #det;';

DECLARE ventanas CURSOR LOCAL STATIC FOR SELECT Dias FROM @Ventanas ORDER BY Dias;
OPEN ventanas;
FETCH NEXT FROM ventanas INTO @d;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @Fi = DATEADD(DAY, 1 - @d, @Ff);
    SELECT @err = NULL, @msDet = NULL, @msTvf = NULL;

    BEGIN TRY
        TRUNCATE TABLE #det;
        SET @t0 = SYSDATETIME();
        INSERT #det EXEC dbo.usp_CorreoQARE_Detalle @FechaInicio = @Fi, @FechaFin = @Ff;
        SET @msDet = DATEDIFF(MILLISECOND, @t0, SYSDATETIME());
        -- Por SQL dinamico: #det no tenia estas columnas al compilar el lote.
        EXEC sys.sp_executesql @copia, N'@Dias INT', @Dias = @d;
    END TRY
    BEGIN CATCH
        SET @err = N'SP: ' + ERROR_MESSAGE();
    END CATCH;

    SET @t0 = SYSDATETIME();
    INSERT #pobTvf (Dias, CodigoTicket, FechaFirmaSolucion)
    SELECT @d, q.CodigoTicket, q.FechaFirmaSolucion
    FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, NULL, NULL, NULL) AS q;
    SET @msTvf = DATEDIFF(MILLISECOND, @t0, SYSDATETIME());

    INSERT #corrida VALUES (@d, @Fi, @Ff, @msDet, @msTvf, @err);
    FETCH NEXT FROM ventanas INTO @d;
END
CLOSE ventanas; DEALLOCATE ventanas;

-- Resumen. Esperado: SoloDetalle = SoloTvf = 0, FilasDuplicadasDetalle = 0,
-- CodigoNuloDetalle = 0 y DetalleFilas = DetalleTickets = TvfTickets.
SELECT Prueba = '1 poblacion', c.Dias, c.FechaInicio, c.FechaFin,
       DetalleFilas   = (SELECT COUNT_BIG(*) FROM #pobDet d WHERE d.Dias = c.Dias),
       DetalleTickets = (SELECT COUNT(DISTINCT d.CodigoTicket) FROM #pobDet d WHERE d.Dias = c.Dias),
       TvfFilas       = (SELECT COUNT_BIG(*) FROM #pobTvf t WHERE t.Dias = c.Dias),
       TvfTickets     = (SELECT COUNT(DISTINCT t.CodigoTicket) FROM #pobTvf t WHERE t.Dias = c.Dias),
       SoloDetalle    = (SELECT COUNT(*) FROM (SELECT CodigoTicket FROM #pobDet WHERE Dias = c.Dias
                                               EXCEPT
                                               SELECT CodigoTicket FROM #pobTvf WHERE Dias = c.Dias) x),
       SoloTvf        = (SELECT COUNT(*) FROM (SELECT CodigoTicket FROM #pobTvf WHERE Dias = c.Dias
                                               EXCEPT
                                               SELECT CodigoTicket FROM #pobDet WHERE Dias = c.Dias) x),
       -- Filas del SP cuyo CodigoTicket aparece mas de una vez (todas sus filas).
       FilasDuplicadasDetalle = (SELECT ISNULL(SUM(n), 0) FROM (SELECT n = COUNT(*) FROM #pobDet
                                  WHERE Dias = c.Dias GROUP BY CodigoTicket HAVING COUNT(*) > 1) x),
       TicketsDuplicadosDetalle = (SELECT COUNT(*) FROM (SELECT CodigoTicket FROM #pobDet
                                  WHERE Dias = c.Dias GROUP BY CodigoTicket HAVING COUNT(*) > 1) x),
       CodigoNuloDetalle = (SELECT COUNT(*) FROM #pobDet d WHERE d.Dias = c.Dias AND d.CodigoTicket IS NULL),
       -- Rango real de FechaFirmaSolucion en cada lado: confirma el fin inclusivo.
       DetalleMinFirma = (SELECT MIN(d.FechaFirmaSolucion) FROM #pobDet d WHERE d.Dias = c.Dias),
       DetalleMaxFirma = (SELECT MAX(d.FechaFirmaSolucion) FROM #pobDet d WHERE d.Dias = c.Dias),
       TvfMinFirma     = (SELECT MIN(t.FechaFirmaSolucion) FROM #pobTvf t WHERE t.Dias = c.Dias),
       TvfMaxFirma     = (SELECT MAX(t.FechaFirmaSolucion) FROM #pobTvf t WHERE t.Dias = c.Dias),
       c.MsDetalle, c.MsTvf, c.Error
FROM #corrida c ORDER BY c.Dias;


/* 2) Muestras de cada diferencia (30 dias) ------------------------------ */
SELECT TOP (20) Prueba = '2 solo en detalle (30 dias)', x.CodigoTicket,
       FirmaEnDetalle = (SELECT MAX(d.FechaFirmaSolucion) FROM #pobDet d WHERE d.Dias = 30 AND d.CodigoTicket = x.CodigoTicket),
       FirmaEnVista   = (SELECT MAX(v.FechaFirmaSolucion) FROM dbo.vw_CorreoQARECierre_Base v WHERE v.CodigoTicket = x.CodigoTicket),
       FilasEnVista   = (SELECT COUNT(*) FROM dbo.vw_CorreoQARECierre_Base v WHERE v.CodigoTicket = x.CodigoTicket)
FROM (SELECT CodigoTicket FROM #pobDet WHERE Dias = 30
      EXCEPT SELECT CodigoTicket FROM #pobTvf WHERE Dias = 30) x
ORDER BY x.CodigoTicket;

SELECT TOP (20) Prueba = '2 solo en TVF (30 dias)', x.CodigoTicket,
       FirmaEnTvf   = (SELECT MAX(t.FechaFirmaSolucion) FROM #pobTvf t WHERE t.Dias = 30 AND t.CodigoTicket = x.CodigoTicket),
       FirmaEnVista = (SELECT MAX(v.FechaFirmaSolucion) FROM dbo.vw_CorreoQARECierre_Base v WHERE v.CodigoTicket = x.CodigoTicket),
       FilasEnVista = (SELECT COUNT(*) FROM dbo.vw_CorreoQARECierre_Base v WHERE v.CodigoTicket = x.CodigoTicket)
FROM (SELECT CodigoTicket FROM #pobTvf WHERE Dias = 30
      EXCEPT SELECT CodigoTicket FROM #pobDet WHERE Dias = 30) x
ORDER BY x.CodigoTicket;

SELECT TOP (20) Prueba = '2 duplicados en detalle (30 dias)', d.CodigoTicket, Filas = COUNT(*),
       FirmasDistintas = COUNT(DISTINCT d.FechaFirmaSolucion)
FROM #pobDet d WHERE d.Dias = 30
GROUP BY d.CodigoTicket HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, d.CodigoTicket;
