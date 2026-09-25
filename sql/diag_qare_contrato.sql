/* =========================================================================
   sql/diag_qare_contrato.sql - v2. Contrato REAL de los procedimientos QARE.

   OBJETIVO
   Sacar de la base, sin suponer nada, lo que la guia visual no dice:
     1. si @FechaFin es inclusivo;
     2. que columna de fecha filtra cada SP;
     3. los literales exactos de Frecuencia, ConfirmacionUsuario, ValidacionQA;
     4. como se calcula EsInconsistencia;
     5. la escala real de los porcentajes;
     6. que columnas llegan en NULL;
     7. que hace cada SP con @FechaInicio / @FechaFin en NULL;
     8. los permisos EXECUTE de la cuenta que corre el script.

   ES DE SOLO LECTURA
   - No hay CREATE, ALTER, DROP, UPDATE, DELETE, MERGE, TRUNCATE, GRANT ni
     REVOKE sobre ningun objeto de la base.
   - Los UNICOS INSERT son a VARIABLES DE TABLA (@...) declaradas aqui: viven
     en la memoria de esta conexion, desaparecen al terminar el lote y no
     tocan ninguna tabla de Tickets_Proactivanet. Hacen falta para capturar la
     salida de los SP (INSERT @t EXEC ...) y poder resumirla (DISTINCT, MIN,
     MAX, conteos de NULL, prueba de inclusividad).
   - Ejecuta SOLO los seis SP de reporte dbo.usp_CorreoQARE_* y los del
     sistema sp_helptext / sp_executesql (este ultimo solo con SELECT
     armados aqui, para contar filas de la vista por dia).
   - Si quieres ver primero los cuerpos antes de ejecutar ningun SP, pon
     @EjecutarSps = 0 abajo: corre las secciones 1, 2, 3, 6 (texto) y 7.
     La seccion 2 marca cualquier linea con INSERT/UPDATE/DELETE/MERGE/
     TRUNCATE dentro de los SP para que se vea que no escriben.

   COMO CORRERLO (SSMS, base Tickets_Proactivanet)
   1. Tools > Options > Query Results > SQL Server > Results to Text >
      "Maximum number of characters displayed in each column" = 8192.
   2. Query > Results To > Results to File (Ctrl+Shift+F) o to Text (Ctrl+T).
      En texto los separadores (mensajes) y los resultados salen en orden.
   3. F5. Tarda lo que tarden ~20 ejecuciones de los SP mas unos conteos de
      la vista sobre 7 dias.
   4. Pegar el archivo/salida completo.

   La cuenta: los permisos de la seccion 7 son los de QUIEN CORRE el script.
   Para los del sitio, correrlo con el login de Web.config o usar el bloque
   EXECUTE AS comentado de la seccion 7. Nunca se imprime cadena de conexion
   ni contraseña: solo nombres de usuario/login de SQL.
   ========================================================================= */

SET NOCOUNT ON;
SET XACT_ABORT OFF;

-- ---------------------------------------------------------------- ajustes
DECLARE @EjecutarSps bit = 1;          -- 0 = solo metadatos y definiciones
DECLARE @DiasAmplio  int = 365;        -- ventana ancha para ver mas literales

-- Fechas de muestra: las que pide la verificacion. GETDATE() es el reloj del
-- servidor SQL (la seccion 6 imprime en que zona esta).
DECLARE @Hoy        date = CAST(GETDATE() AS DATE);
DECLARE @MuestraIni date = DATEADD(DAY, -14, @Hoy);
DECLARE @MuestraFin date = @Hoy;
DECLARE @AmplioIni  date = DATEADD(DAY, -@DiasAmplio, @Hoy);
-- Prueba de inclusividad: los 7 dias COMPLETOS anteriores a hoy.
DECLARE @D1 date = DATEADD(DAY, -7, @Hoy);
DECLARE @D7 date = DATEADD(DAY, -1, @Hoy);

-- ---------------------------------------------------------- objetos
DECLARE @obj TABLE (Orden int, Nombre sysname, EsVista bit);
INSERT @obj (Orden, Nombre, EsVista) VALUES
    (1, N'vw_CorreoQARECierre_Base',            1),
    (2, N'usp_CorreoQARE_KPIs',                 0),
    (3, N'usp_CorreoQARE_Frecuencia',           0),
    (4, N'usp_CorreoQARE_CausaRaiz',            0),
    (5, N'usp_CorreoQARE_RecurrentesCategoria', 0),
    (6, N'usp_CorreoQARE_ConfirmacionVsQA',     0),
    (7, N'usp_CorreoQARE_TipoSolucion',         0);

-- Definiciones partidas en lineas numeradas (para citar WHERE, CASE, etc.).
DECLARE @lineas TABLE (Objeto sysname, Linea int, Texto nvarchar(max));
WITH d AS (
    SELECT o.Nombre AS Objeto,
           CAST(REPLACE(m.definition, NCHAR(13), N'') + NCHAR(10) AS nvarchar(max)) AS t
    FROM @obj AS o
    JOIN sys.sql_modules AS m ON m.object_id = OBJECT_ID(N'dbo.' + o.Nombre)
), l AS (
    SELECT Objeto, 1 AS Linea,
           CAST(LEFT(t, CHARINDEX(NCHAR(10), t) - 1) AS nvarchar(max)) AS Texto,
           CAST(STUFF(t, 1, CHARINDEX(NCHAR(10), t), N'') AS nvarchar(max)) AS Resto
    FROM d
    UNION ALL
    SELECT Objeto, Linea + 1,
           CAST(LEFT(Resto, CHARINDEX(NCHAR(10), Resto) - 1) AS nvarchar(max)),
           CAST(STUFF(Resto, 1, CHARINDEX(NCHAR(10), Resto), N'') AS nvarchar(max))
    FROM l
    WHERE CHARINDEX(NCHAR(10), Resto) > 0
)
INSERT @lineas (Objeto, Linea, Texto)
SELECT Objeto, Linea, REPLACE(Texto, NCHAR(9), N'    ') FROM l
OPTION (MAXRECURSION 0);

-- Columnas de fecha de la vista (candidatas a filtro).
DECLARE @fechasVista TABLE (Columna sysname, Tipo sysname);
INSERT @fechasVista (Columna, Tipo)
SELECT c.name, TYPE_NAME(c.system_type_id)
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'dbo.vw_CorreoQARECierre_Base')
  AND TYPE_NAME(c.system_type_id) IN (N'date', N'datetime', N'datetime2', N'smalldatetime', N'datetimeoffset');

-- Errores de cualquier paso: se listan al final, nada se pierde en silencio.
DECLARE @errores TABLE (Seccion nvarchar(20), Objeto nvarchar(200), Mensaje nvarchar(2048));

-- Capturas de los SP (tipos anchos: si el contrato real difiere, no trunca).
DECLARE @kpi TABLE (
    Id int IDENTITY(1,1),
    TotalTicketsPeriodo int, TicketsConFrecuencia int, TicketsRecurrentes int,
    PorcentajeRecurrencia decimal(19,6), TicketsConRespuestaConfirmacion int,
    TicketsConfirmados int, PorcentajeConfirmacion decimal(19,6),
    TicketsConRespuestaReutilizacion int, CasosReutilizables int,
    PorcentajeCasosReutilizables decimal(19,6), TicketsConRespuestaKB int,
    CasosPotencialKB int, PorcentajePotencialKB decimal(19,6));
DECLARE @kpiRun TABLE (Orden int, Corrida nvarchar(40), Ini date NULL, Fin date NULL,
                       IdFila int NULL, Filas int NULL, Error nvarchar(2048) NULL);
DECLARE @frec       TABLE (Frecuencia nvarchar(max), CantidadTickets int, Porcentaje decimal(19,6));
DECLARE @frecAmplio TABLE (Frecuencia nvarchar(max), CantidadTickets int, Porcentaje decimal(19,6));
DECLARE @causa TABLE (Posicion bigint, CausaRaiz nvarchar(max), CantidadTickets int,
                      TotalTicketsConCausa int, Porcentaje decimal(19,6), PorcentajeAcumulado decimal(19,6));
DECLARE @rec   TABLE (FechaInicio date, FechaFin date, Posicion bigint, Categoria nvarchar(max),
                      CantidadTickets int, TotalTicketsRecurrentes int, PorcentajeRecurrentes decimal(19,6));
DECLARE @conf       TABLE (FechaInicio date, FechaFin date, ConfirmacionUsuario nvarchar(max), ValidacionQA nvarchar(max),
                           CantidadTickets int, PorcentajeDelTotal decimal(19,6), EsInconsistencia int);
DECLARE @confAmplio TABLE (FechaInicio date, FechaFin date, ConfirmacionUsuario nvarchar(max), ValidacionQA nvarchar(max),
                           CantidadTickets int, PorcentajeDelTotal decimal(19,6), EsInconsistencia int);
DECLARE @confNull   TABLE (FechaInicio date, FechaFin date, ConfirmacionUsuario nvarchar(max), ValidacionQA nvarchar(max),
                           CantidadTickets int, PorcentajeDelTotal decimal(19,6), EsInconsistencia int);
DECLARE @tipo     TABLE (FechaInicio date, FechaFin date, Posicion bigint, TipoSolucion nvarchar(max),
                         CantidadTickets int, TotalTicketsConTipoSolucion int, Porcentaje decimal(19,6));
DECLARE @tipoNull TABLE (FechaInicio date, FechaFin date, Posicion bigint, TipoSolucion nvarchar(max),
                         CantidadTickets int, TotalTicketsConTipoSolucion int, Porcentaje decimal(19,6));

DECLARE @i int, @n int, @nombre nvarchar(300), @msg nvarchar(400);


/* ==========================================================================
   SECTION 1 - OBJECTS / PARAMETERS
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 1 - OBJECTS / PARAMETERS', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

SELECT o.Orden, Objeto = N'dbo.' + o.Nombre,
       Existe = CASE WHEN so.object_id IS NULL THEN N'NO' ELSE N'SI' END,
       so.type_desc, so.create_date, so.modify_date,
       LineasDefinicion = (SELECT COUNT(*) FROM @lineas AS l WHERE l.Objeto = o.Nombre)
FROM @obj AS o
LEFT JOIN sys.objects AS so ON so.object_id = OBJECT_ID(N'dbo.' + o.Nombre)
ORDER BY o.Orden;

/* has_default_value de sys.parameters vale 0 SIEMPRE en procedimientos T-SQL
   (solo se llena para CLR), asi que NO prueba que no haya default. El
   default real se lee de la linea de la definicion donde se declara el
   parametro: columna DeclaracionEnDefinicion. */
SELECT Procedimiento = o.Nombre,
       Parametro = p.name,
       Tipo = TYPE_NAME(p.user_type_id),
       p.max_length,
       p.parameter_id,
       has_default_value_metadata = p.has_default_value,
       DefaultSegunDefinicion = CASE WHEN decl.Texto LIKE N'%=%' THEN N'SI' ELSE N'NO' END,
       DeclaracionEnDefinicion = LTRIM(RTRIM(decl.Texto))
FROM @obj AS o
JOIN sys.parameters AS p ON p.object_id = OBJECT_ID(N'dbo.' + o.Nombre)
OUTER APPLY (
    SELECT TOP (1) l.Texto
    FROM @lineas AS l
    WHERE l.Objeto = o.Nombre
      AND (N' ' + l.Texto + N' ') LIKE N'%' + p.name + N'[^A-Za-z0-9_]%'
    ORDER BY l.Linea
) AS decl
ORDER BY o.Orden, p.parameter_id;

-- Columnas de la vista (todas), para saber de que se puede filtrar.
SELECT Vista = N'dbo.vw_CorreoQARECierre_Base', Ordinal = c.column_id, Columna = c.name,
       Tipo = TYPE_NAME(c.user_type_id), c.max_length, c.is_nullable
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'dbo.vw_CorreoQARECierre_Base')
ORDER BY c.column_id;


/* ==========================================================================
   SECTION 2 - COMPLETE DEFINITIONS
   sp_helptext devuelve la definicion en filas de hasta 255 caracteres, asi
   que en Results to Text / to File no se corta. 2B repite solo las lineas
   que importan, numeradas.
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 2A - COMPLETE DEFINITIONS (sp_helptext)', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

SET @i = 1;
WHILE @i <= 7
BEGIN
    SELECT @nombre = N'dbo.' + Nombre FROM @obj WHERE Orden = @i;
    RAISERROR(N'', 0, 1) WITH NOWAIT;
    RAISERROR(N'---------- DEFINICION COMPLETA: %s ----------', 0, 1, @nombre) WITH NOWAIT;
    BEGIN TRY
        EXEC sys.sp_helptext @objname = @nombre;
    END TRY
    BEGIN CATCH
        INSERT @errores VALUES (N'2A', @nombre, ERROR_MESSAGE());
        SET @msg = N'  ERROR: ' + LEFT(ERROR_MESSAGE(), 380);
        RAISERROR(@msg, 0, 1) WITH NOWAIT;
    END CATCH
    RAISERROR(N'---------- FIN: %s ----------', 0, 1, @nombre) WITH NOWAIT;
    SET @i += 1;
END

/* Alternativa en modo Grid: descomentar y hacer clic en la celda XML; SSMS
   abre la definicion entera en otra pestaña.
SELECT o.Nombre,
       Definicion = CAST(N'<?def --' + NCHAR(10) + OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + o.Nombre)) + NCHAR(10) + N'--?>' AS xml)
FROM @obj AS o ORDER BY o.Orden;
*/

RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 2B - KEY LINES (numeradas)', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

SELECT l.Objeto, l.Linea,
       Motivo = CASE
           WHEN l.Texto LIKE N'%INSERT%' OR l.Texto LIKE N'%UPDATE%' OR l.Texto LIKE N'%DELETE%'
             OR l.Texto LIKE N'%MERGE%'  OR l.Texto LIKE N'%TRUNCATE%'           THEN N'ESCRITURA?'
           WHEN l.Texto LIKE N'%@FechaInicio%' OR l.Texto LIKE N'%@FechaFin%'   THEN N'PARAM FECHA'
           WHEN l.Texto LIKE N'%EsInconsistencia%'                              THEN N'INCONSISTENCIA'
           WHEN l.Texto LIKE N'%Porcentaje%' OR l.Texto LIKE N'%100.0%'
             OR l.Texto LIKE N'%NULLIF%'                                        THEN N'PORCENTAJE'
           WHEN l.Texto LIKE N'%WHERE%' OR l.Texto LIKE N'% AND %'
             OR l.Texto LIKE N'% OR %'                                          THEN N'FILTRO'
           WHEN l.Texto LIKE N'%CASE%' OR l.Texto LIKE N'%WHEN%'
             OR l.Texto LIKE N'%THEN%' OR l.Texto LIKE N'%ELSE%'                THEN N'CASE/LITERAL'
           WHEN l.Texto LIKE N'%DATEADD%' OR l.Texto LIKE N'%DATEDIFF%'
             OR l.Texto LIKE N'%GETDATE%' OR l.Texto LIKE N'%SYSDATETIME%'
             OR l.Texto LIKE N'%SYSUTCDATETIME%' OR l.Texto LIKE N'%CURRENT_TIMESTAMP%'
             OR l.Texto LIKE N'%CAST(%' OR l.Texto LIKE N'%CONVERT(%'           THEN N'FECHA/CONVERSION'
           WHEN l.Texto LIKE N'%ISNULL%' OR l.Texto LIKE N'%COALESCE%'
             OR l.Texto LIKE N'%IS NULL%' OR l.Texto LIKE N'%IS NOT NULL%'      THEN N'NULL'
           WHEN l.Texto LIKE N'%Fecha%'                                         THEN N'COLUMNA FECHA'
           ELSE N'' END,
       Texto = RTRIM(l.Texto)
FROM @lineas AS l
JOIN @obj AS o ON o.Nombre = l.Objeto
WHERE l.Texto LIKE N'%@Fecha%' OR l.Texto LIKE N'%WHERE%' OR l.Texto LIKE N'% AND %' OR l.Texto LIKE N'% OR %'
   OR l.Texto LIKE N'%CASE%' OR l.Texto LIKE N'%WHEN%' OR l.Texto LIKE N'%THEN%' OR l.Texto LIKE N'%ELSE%'
   OR l.Texto LIKE N'%DATEADD%' OR l.Texto LIKE N'%DATEDIFF%' OR l.Texto LIKE N'%GETDATE%'
   OR l.Texto LIKE N'%SYSDATETIME%' OR l.Texto LIKE N'%SYSUTCDATETIME%' OR l.Texto LIKE N'%CURRENT_TIMESTAMP%'
   OR l.Texto LIKE N'%EsInconsistencia%' OR l.Texto LIKE N'%Porcentaje%' OR l.Texto LIKE N'%NULLIF%'
   OR l.Texto LIKE N'%ISNULL%' OR l.Texto LIKE N'%COALESCE%' OR l.Texto LIKE N'%NULL%'
   OR l.Texto LIKE N'%Fecha%' OR l.Texto LIKE N'%INSERT%' OR l.Texto LIKE N'%UPDATE%'
   OR l.Texto LIKE N'%DELETE%' OR l.Texto LIKE N'%MERGE%' OR l.Texto LIKE N'%TRUNCATE%'
ORDER BY o.Orden, l.Linea;


/* ==========================================================================
   SECTION 3 - COLUMN CONTRACT (metadatos, sin ejecutar)
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 3 - COLUMN CONTRACT', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

DECLARE @cols TABLE (Procedimiento sysname, Ordinal int NULL, Columna sysname NULL,
                     Tipo nvarchar(256) NULL, Nullable bit NULL, Error nvarchar(2048) NULL);
INSERT @cols SELECT N'usp_CorreoQARE_KPIs', column_ordinal, name, system_type_name, is_nullable, error_message
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = NULL, @FechaFin = NULL', NULL, 0);
INSERT @cols SELECT N'usp_CorreoQARE_Frecuencia', column_ordinal, name, system_type_name, is_nullable, error_message
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_Frecuencia @FechaInicio = NULL, @FechaFin = NULL', NULL, 0);
INSERT @cols SELECT N'usp_CorreoQARE_CausaRaiz', column_ordinal, name, system_type_name, is_nullable, error_message
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_CausaRaiz @FechaInicio = NULL, @FechaFin = NULL', NULL, 0);
INSERT @cols SELECT N'usp_CorreoQARE_RecurrentesCategoria', column_ordinal, name, system_type_name, is_nullable, error_message
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_RecurrentesCategoria @FechaInicio = NULL, @FechaFin = NULL', NULL, 0);
INSERT @cols SELECT N'usp_CorreoQARE_ConfirmacionVsQA', column_ordinal, name, system_type_name, is_nullable, error_message
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio = NULL, @FechaFin = NULL', NULL, 0);
INSERT @cols SELECT N'usp_CorreoQARE_TipoSolucion', column_ordinal, name, system_type_name, is_nullable, error_message
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_TipoSolucion @FechaInicio = NULL, @FechaFin = NULL', NULL, 0);

SELECT Procedimiento, Ordinal, Columna, Tipo, Nullable, Error
FROM @cols ORDER BY Procedimiento, Ordinal;

-- Columnas de la guia visual: 29 pares SP/columna (21 nombres distintos).
DECLARE @esperadas TABLE (Procedimiento sysname, Columna sysname);
INSERT @esperadas VALUES
    (N'usp_CorreoQARE_KPIs', N'TotalTicketsPeriodo'), (N'usp_CorreoQARE_KPIs', N'PorcentajeConfirmacion'),
    (N'usp_CorreoQARE_KPIs', N'TicketsConfirmados'), (N'usp_CorreoQARE_KPIs', N'PorcentajeRecurrencia'),
    (N'usp_CorreoQARE_KPIs', N'TicketsRecurrentes'), (N'usp_CorreoQARE_KPIs', N'PorcentajeCasosReutilizables'),
    (N'usp_CorreoQARE_KPIs', N'CasosReutilizables'), (N'usp_CorreoQARE_KPIs', N'PorcentajePotencialKB'),
    (N'usp_CorreoQARE_KPIs', N'CasosPotencialKB'),
    (N'usp_CorreoQARE_Frecuencia', N'Frecuencia'), (N'usp_CorreoQARE_Frecuencia', N'CantidadTickets'),
    (N'usp_CorreoQARE_Frecuencia', N'Porcentaje'),
    (N'usp_CorreoQARE_CausaRaiz', N'CausaRaiz'), (N'usp_CorreoQARE_CausaRaiz', N'CantidadTickets'),
    (N'usp_CorreoQARE_CausaRaiz', N'Porcentaje'), (N'usp_CorreoQARE_CausaRaiz', N'PorcentajeAcumulado'),
    (N'usp_CorreoQARE_CausaRaiz', N'Posicion'),
    (N'usp_CorreoQARE_RecurrentesCategoria', N'Categoria'), (N'usp_CorreoQARE_RecurrentesCategoria', N'CantidadTickets'),
    (N'usp_CorreoQARE_RecurrentesCategoria', N'PorcentajeRecurrentes'), (N'usp_CorreoQARE_RecurrentesCategoria', N'Posicion'),
    (N'usp_CorreoQARE_ConfirmacionVsQA', N'ConfirmacionUsuario'), (N'usp_CorreoQARE_ConfirmacionVsQA', N'ValidacionQA'),
    (N'usp_CorreoQARE_ConfirmacionVsQA', N'CantidadTickets'), (N'usp_CorreoQARE_ConfirmacionVsQA', N'PorcentajeDelTotal'),
    (N'usp_CorreoQARE_TipoSolucion', N'TipoSolucion'), (N'usp_CorreoQARE_TipoSolucion', N'CantidadTickets'),
    (N'usp_CorreoQARE_TipoSolucion', N'Porcentaje'), (N'usp_CorreoQARE_TipoSolucion', N'Posicion');

SELECT e.Procedimiento, e.Columna,
       Estado = CASE WHEN c.Columna IS NULL THEN N'FALTA' ELSE N'OK' END,
       c.Tipo, c.Nullable
FROM @esperadas AS e
LEFT JOIN @cols AS c ON c.Procedimiento = e.Procedimiento AND c.Columna = e.Columna
ORDER BY e.Procedimiento, e.Columna;


/* ==========================================================================
   SECTION 4 - SAMPLE EXECUTION
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 4 - SAMPLE EXECUTION', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

SELECT Muestra = N'principal', FechaInicio = @MuestraIni, FechaFin = @MuestraFin
UNION ALL SELECT N'amplia (solo Frecuencia y ConfirmacionVsQA)', @AmplioIni, @MuestraFin
UNION ALL SELECT N'inclusividad (seccion 5)', @D1, @D7;

IF @EjecutarSps = 1
BEGIN
    -- KPIs: muestra, 7 dias sueltos, el rango de esos 7 dias y NULL/NULL.
    DECLARE @plan TABLE (Orden int IDENTITY(1,1), Corrida nvarchar(40), Ini date NULL, Fin date NULL);
    INSERT @plan (Corrida, Ini, Fin) VALUES (N'muestra', @MuestraIni, @MuestraFin);
    SET @i = 7;
    WHILE @i >= 1
    BEGIN
        INSERT @plan (Corrida, Ini, Fin)
        VALUES (N'dia -' + CAST(@i AS nvarchar(2)), DATEADD(DAY, -@i, @Hoy), DATEADD(DAY, -@i, @Hoy));
        SET @i -= 1;
    END
    INSERT @plan (Corrida, Ini, Fin) VALUES (N'rango -7..-1', @D1, @D7);
    INSERT @plan (Corrida, Ini, Fin) VALUES (N'defaults NULL/NULL', NULL, NULL);

    DECLARE @o int = 1, @maxPlan int, @c nvarchar(40), @a date, @b date;
    SELECT @maxPlan = MAX(Orden) FROM @plan;
    WHILE @o <= @maxPlan
    BEGIN
        SELECT @c = Corrida, @a = Ini, @b = Fin FROM @plan WHERE Orden = @o;
        BEGIN TRY
            INSERT @kpi (TotalTicketsPeriodo, TicketsConFrecuencia, TicketsRecurrentes, PorcentajeRecurrencia,
                         TicketsConRespuestaConfirmacion, TicketsConfirmados, PorcentajeConfirmacion,
                         TicketsConRespuestaReutilizacion, CasosReutilizables, PorcentajeCasosReutilizables,
                         TicketsConRespuestaKB, CasosPotencialKB, PorcentajePotencialKB)
            EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = @a, @FechaFin = @b;
            SET @n = @@ROWCOUNT;
            INSERT @kpiRun VALUES (@o, @c, @a, @b,
                                   CASE WHEN @n = 1 THEN (SELECT MAX(Id) FROM @kpi) END, @n, NULL);
        END TRY
        BEGIN CATCH
            INSERT @kpiRun VALUES (@o, @c, @a, @b, NULL, 0, ERROR_MESSAGE());
            INSERT @errores VALUES (N'4/5/6', N'usp_CorreoQARE_KPIs ' + @c, ERROR_MESSAGE());
        END CATCH
        RAISERROR(N'  KPIs corrida %d de %d', 0, 1, @o, @maxPlan) WITH NOWAIT;
        SET @o += 1;
    END

    BEGIN TRY
        INSERT @frec EXEC dbo.usp_CorreoQARE_Frecuencia @FechaInicio = @MuestraIni, @FechaFin = @MuestraFin;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'4', N'usp_CorreoQARE_Frecuencia muestra', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @frecAmplio EXEC dbo.usp_CorreoQARE_Frecuencia @FechaInicio = @AmplioIni, @FechaFin = @MuestraFin;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'4', N'usp_CorreoQARE_Frecuencia amplia', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @causa EXEC dbo.usp_CorreoQARE_CausaRaiz @FechaInicio = @MuestraIni, @FechaFin = @MuestraFin;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'4', N'usp_CorreoQARE_CausaRaiz muestra', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @rec EXEC dbo.usp_CorreoQARE_RecurrentesCategoria @FechaInicio = @MuestraIni, @FechaFin = @MuestraFin;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'4', N'usp_CorreoQARE_RecurrentesCategoria muestra', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @conf EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio = @MuestraIni, @FechaFin = @MuestraFin;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'4', N'usp_CorreoQARE_ConfirmacionVsQA muestra', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @confAmplio EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio = @AmplioIni, @FechaFin = @MuestraFin;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'4', N'usp_CorreoQARE_ConfirmacionVsQA amplia', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @confNull EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio = NULL, @FechaFin = NULL;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'6', N'usp_CorreoQARE_ConfirmacionVsQA NULL/NULL', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @tipo EXEC dbo.usp_CorreoQARE_TipoSolucion @FechaInicio = @MuestraIni, @FechaFin = @MuestraFin;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'4', N'usp_CorreoQARE_TipoSolucion muestra', ERROR_MESSAGE()); END CATCH
    BEGIN TRY
        INSERT @tipoNull EXEC dbo.usp_CorreoQARE_TipoSolucion @FechaInicio = NULL, @FechaFin = NULL;
    END TRY BEGIN CATCH INSERT @errores VALUES (N'6', N'usp_CorreoQARE_TipoSolucion NULL/NULL', ERROR_MESSAGE()); END CATCH
END
ELSE
    RAISERROR(N'  @EjecutarSps = 0: no se ejecuto ningun SP (secciones 4 y 5 vacias).', 0, 1) WITH NOWAIT;

-- 4A KPIs de la muestra.
RAISERROR(N'--- 4A KPIs (muestra) ---', 0, 1) WITH NOWAIT;
SELECT r.Corrida, r.Ini, r.Fin, k.*, r.Error
FROM @kpiRun AS r LEFT JOIN @kpi AS k ON k.Id = r.IdFila
WHERE r.Corrida = N'muestra';

-- 4B Frecuencia: todas las filas (es un agregado corto), muestra y amplia.
RAISERROR(N'--- 4B Frecuencia (todas las filas) ---', 0, 1) WITH NOWAIT;
SELECT Muestra = N'principal', Valor = N'[' + Frecuencia + N']', Largo = LEN(Frecuencia),
       Bytes = DATALENGTH(Frecuencia), CantidadTickets, Porcentaje
FROM @frec
UNION ALL
SELECT N'amplia', N'[' + Frecuencia + N']', LEN(Frecuencia), DATALENGTH(Frecuencia), CantidadTickets, Porcentaje
FROM @frecAmplio;

-- 4C ConfirmacionVsQA: todas las filas.
RAISERROR(N'--- 4C ConfirmacionVsQA (todas las filas) ---', 0, 1) WITH NOWAIT;
SELECT Muestra = N'principal', FechaInicio, FechaFin,
       Confirmacion = N'[' + ConfirmacionUsuario + N']', Validacion = N'[' + ValidacionQA + N']',
       CantidadTickets, PorcentajeDelTotal, EsInconsistencia
FROM @conf
UNION ALL
SELECT N'amplia', FechaInicio, FechaFin, N'[' + ConfirmacionUsuario + N']', N'[' + ValidacionQA + N']',
       CantidadTickets, PorcentajeDelTotal, EsInconsistencia
FROM @confAmplio;

-- 4D TipoSolucion: primeras 50 por Posicion + total de filas.
RAISERROR(N'--- 4D TipoSolucion (top 50 por Posicion) ---', 0, 1) WITH NOWAIT;
SELECT TOP (50) FechaInicio, FechaFin, Posicion, TipoSolucion = LEFT(TipoSolucion, 150),
       CantidadTickets, TotalTicketsConTipoSolucion, Porcentaje
FROM @tipo ORDER BY Posicion;
SELECT FilasTipoSolucion = COUNT(*) FROM @tipo;

-- 4E CausaRaiz: primeras 25, la ultima y el total de filas.
RAISERROR(N'--- 4E CausaRaiz (top 25 + ultima fila) ---', 0, 1) WITH NOWAIT;
SELECT x.* FROM (
    SELECT TOP (25) Posicion, CausaRaiz = CAST(LEFT(CausaRaiz, 150) AS nvarchar(150)), CantidadTickets,
           TotalTicketsConCausa, Porcentaje, PorcentajeAcumulado
    FROM @causa ORDER BY Posicion
) AS x
UNION
SELECT y.* FROM (
    SELECT TOP (1) Posicion, CAST(LEFT(CausaRaiz, 150) AS nvarchar(150)) AS CausaRaiz, CantidadTickets,
           TotalTicketsConCausa, Porcentaje, PorcentajeAcumulado
    FROM @causa ORDER BY Posicion DESC
) AS y
ORDER BY Posicion;
SELECT FilasCausaRaiz = COUNT(*), CausasDistintas = COUNT(DISTINCT CausaRaiz),
       PosicionesDistintas = COUNT(DISTINCT Posicion) FROM @causa;

-- 4F RecurrentesCategoria: primeras 25 + total de filas.
RAISERROR(N'--- 4F RecurrentesCategoria (top 25 por Posicion) ---', 0, 1) WITH NOWAIT;
SELECT TOP (25) FechaInicio, FechaFin, Posicion, Categoria = LEFT(Categoria, 150),
       CantidadTickets, TotalTicketsRecurrentes, PorcentajeRecurrentes
FROM @rec ORDER BY Posicion;
SELECT FilasRecurrentes = COUNT(*), PosicionesDistintas = COUNT(DISTINCT Posicion) FROM @rec;

-- 4G Literales DISTINCT (con corchetes para ver espacios, y bytes para
--    detectar caracteres raros como NBSP).
RAISERROR(N'--- 4G Literales distintos ---', 0, 1) WITH NOWAIT;
SELECT Campo = N'Frecuencia', Valor = N'[' + ISNULL(v, N'<NULL>') + N']', Largo = LEN(v), Bytes = DATALENGTH(v),
       FilasMuestra = SUM(m), FilasAmplia = SUM(a)
FROM (SELECT Frecuencia AS v, 1 AS m, 0 AS a FROM @frec UNION ALL SELECT Frecuencia, 0, 1 FROM @frecAmplio) AS t
GROUP BY v
UNION ALL
SELECT N'ConfirmacionUsuario', N'[' + ISNULL(v, N'<NULL>') + N']', LEN(v), DATALENGTH(v), SUM(m), SUM(a)
FROM (SELECT ConfirmacionUsuario AS v, 1 AS m, 0 AS a FROM @conf UNION ALL SELECT ConfirmacionUsuario, 0, 1 FROM @confAmplio) AS t
GROUP BY v
UNION ALL
SELECT N'ValidacionQA', N'[' + ISNULL(v, N'<NULL>') + N']', LEN(v), DATALENGTH(v), SUM(m), SUM(a)
FROM (SELECT ValidacionQA AS v, 1 AS m, 0 AS a FROM @conf UNION ALL SELECT ValidacionQA, 0, 1 FROM @confAmplio) AS t
GROUP BY v
UNION ALL
SELECT N'EsInconsistencia', N'[' + ISNULL(CAST(v AS nvarchar(20)), N'<NULL>') + N']', NULL, NULL, SUM(m), SUM(a)
FROM (SELECT EsInconsistencia AS v, 1 AS m, 0 AS a FROM @conf UNION ALL SELECT EsInconsistencia, 0, 1 FROM @confAmplio) AS t
GROUP BY v
ORDER BY 1, 2;

-- 4H EsInconsistencia por par (Confirmacion, Validacion) en la muestra amplia.
RAISERROR(N'--- 4H EsInconsistencia por par ---', 0, 1) WITH NOWAIT;
SELECT Confirmacion = N'[' + ConfirmacionUsuario + N']', Validacion = N'[' + ValidacionQA + N']',
       ValoresEsInconsistencia = COUNT(DISTINCT EsInconsistencia),
       MinEsInc = MIN(EsInconsistencia), MaxEsInc = MAX(EsInconsistencia),
       Tickets = SUM(CantidadTickets)
FROM (SELECT * FROM @conf UNION ALL SELECT * FROM @confAmplio) AS t
GROUP BY ConfirmacionUsuario, ValidacionQA
ORDER BY 1, 2;

-- 4I Porcentajes: min / max / suma por columna (escala 0-100 o 0-1).
RAISERROR(N'--- 4I Porcentajes ---', 0, 1) WITH NOWAIT;
SELECT Origen = N'KPIs.PorcentajeConfirmacion', Minimo = MIN(PorcentajeConfirmacion), Maximo = MAX(PorcentajeConfirmacion), Suma = NULL, Filas = COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.PorcentajeRecurrencia', MIN(PorcentajeRecurrencia), MAX(PorcentajeRecurrencia), NULL, COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.PorcentajeCasosReutilizables', MIN(PorcentajeCasosReutilizables), MAX(PorcentajeCasosReutilizables), NULL, COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.PorcentajePotencialKB', MIN(PorcentajePotencialKB), MAX(PorcentajePotencialKB), NULL, COUNT(*) FROM @kpi
UNION ALL SELECT N'Frecuencia.Porcentaje', MIN(Porcentaje), MAX(Porcentaje), SUM(Porcentaje), COUNT(*) FROM @frec
UNION ALL SELECT N'CausaRaiz.Porcentaje', MIN(Porcentaje), MAX(Porcentaje), SUM(Porcentaje), COUNT(*) FROM @causa
UNION ALL SELECT N'CausaRaiz.PorcentajeAcumulado', MIN(PorcentajeAcumulado), MAX(PorcentajeAcumulado), NULL, COUNT(*) FROM @causa
UNION ALL SELECT N'Recurrentes.PorcentajeRecurrentes', MIN(PorcentajeRecurrentes), MAX(PorcentajeRecurrentes), SUM(PorcentajeRecurrentes), COUNT(*) FROM @rec
UNION ALL SELECT N'ConfirmacionVsQA.PorcentajeDelTotal', MIN(PorcentajeDelTotal), MAX(PorcentajeDelTotal), SUM(PorcentajeDelTotal), COUNT(*) FROM @conf
UNION ALL SELECT N'TipoSolucion.Porcentaje', MIN(Porcentaje), MAX(Porcentaje), SUM(Porcentaje), COUNT(*) FROM @tipo;

-- Comprobacion del denominador: Porcentaje vs CantidadTickets / Total*100.
SELECT Origen = N'CausaRaiz', Filas = COUNT(*),
       FilasQueCuadran = SUM(CASE WHEN ABS(Porcentaje - 100.0 * CantidadTickets / NULLIF(TotalTicketsConCausa, 0)) < 0.01 THEN 1 ELSE 0 END)
FROM @causa
UNION ALL
SELECT N'RecurrentesCategoria', COUNT(*),
       SUM(CASE WHEN ABS(PorcentajeRecurrentes - 100.0 * CantidadTickets / NULLIF(TotalTicketsRecurrentes, 0)) < 0.01 THEN 1 ELSE 0 END)
FROM @rec
UNION ALL
SELECT N'TipoSolucion', COUNT(*),
       SUM(CASE WHEN ABS(Porcentaje - 100.0 * CantidadTickets / NULLIF(TotalTicketsConTipoSolucion, 0)) < 0.01 THEN 1 ELSE 0 END)
FROM @tipo;

-- 4J NULL por columna en lo que devolvieron los SP.
RAISERROR(N'--- 4J NULL por columna ---', 0, 1) WITH NOWAIT;
DECLARE @nulos TABLE (Origen nvarchar(80), Nulos int, Filas int);
INSERT @nulos
SELECT N'KPIs.TotalTicketsPeriodo', SUM(CASE WHEN TotalTicketsPeriodo IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.TicketsConFrecuencia', SUM(CASE WHEN TicketsConFrecuencia IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.TicketsRecurrentes', SUM(CASE WHEN TicketsRecurrentes IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.PorcentajeRecurrencia', SUM(CASE WHEN PorcentajeRecurrencia IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.TicketsConRespuestaConfirmacion', SUM(CASE WHEN TicketsConRespuestaConfirmacion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.TicketsConfirmados', SUM(CASE WHEN TicketsConfirmados IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.PorcentajeConfirmacion', SUM(CASE WHEN PorcentajeConfirmacion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.TicketsConRespuestaReutilizacion', SUM(CASE WHEN TicketsConRespuestaReutilizacion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.CasosReutilizables', SUM(CASE WHEN CasosReutilizables IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.PorcentajeCasosReutilizables', SUM(CASE WHEN PorcentajeCasosReutilizables IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.TicketsConRespuestaKB', SUM(CASE WHEN TicketsConRespuestaKB IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.CasosPotencialKB', SUM(CASE WHEN CasosPotencialKB IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'KPIs.PorcentajePotencialKB', SUM(CASE WHEN PorcentajePotencialKB IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @kpi
UNION ALL SELECT N'Frecuencia.Frecuencia', SUM(CASE WHEN Frecuencia IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @frecAmplio
UNION ALL SELECT N'Frecuencia.CantidadTickets', SUM(CASE WHEN CantidadTickets IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @frecAmplio
UNION ALL SELECT N'Frecuencia.Porcentaje', SUM(CASE WHEN Porcentaje IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @frecAmplio
UNION ALL SELECT N'CausaRaiz.Posicion', SUM(CASE WHEN Posicion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @causa
UNION ALL SELECT N'CausaRaiz.CausaRaiz', SUM(CASE WHEN CausaRaiz IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @causa
UNION ALL SELECT N'CausaRaiz.CantidadTickets', SUM(CASE WHEN CantidadTickets IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @causa
UNION ALL SELECT N'CausaRaiz.TotalTicketsConCausa', SUM(CASE WHEN TotalTicketsConCausa IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @causa
UNION ALL SELECT N'CausaRaiz.Porcentaje', SUM(CASE WHEN Porcentaje IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @causa
UNION ALL SELECT N'CausaRaiz.PorcentajeAcumulado', SUM(CASE WHEN PorcentajeAcumulado IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @causa
UNION ALL SELECT N'Recurrentes.Posicion', SUM(CASE WHEN Posicion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @rec
UNION ALL SELECT N'Recurrentes.Categoria', SUM(CASE WHEN Categoria IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @rec
UNION ALL SELECT N'Recurrentes.CantidadTickets', SUM(CASE WHEN CantidadTickets IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @rec
UNION ALL SELECT N'Recurrentes.TotalTicketsRecurrentes', SUM(CASE WHEN TotalTicketsRecurrentes IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @rec
UNION ALL SELECT N'Recurrentes.PorcentajeRecurrentes', SUM(CASE WHEN PorcentajeRecurrentes IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @rec
UNION ALL SELECT N'ConfVsQA.CantidadTickets', SUM(CASE WHEN CantidadTickets IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @confAmplio
UNION ALL SELECT N'ConfVsQA.PorcentajeDelTotal', SUM(CASE WHEN PorcentajeDelTotal IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @confAmplio
UNION ALL SELECT N'TipoSolucion.Posicion', SUM(CASE WHEN Posicion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @tipo
UNION ALL SELECT N'TipoSolucion.TipoSolucion', SUM(CASE WHEN TipoSolucion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @tipo
UNION ALL SELECT N'TipoSolucion.CantidadTickets', SUM(CASE WHEN CantidadTickets IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @tipo
UNION ALL SELECT N'TipoSolucion.TotalTicketsConTipoSolucion', SUM(CASE WHEN TotalTicketsConTipoSolucion IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @tipo
UNION ALL SELECT N'TipoSolucion.Porcentaje', SUM(CASE WHEN Porcentaje IS NULL THEN 1 ELSE 0 END), COUNT(*) FROM @tipo;
SELECT Origen, Nulos = ISNULL(Nulos, 0), Filas FROM @nulos ORDER BY Origen;


/* ==========================================================================
   SECTION 5 - DATE INCLUSIVITY TEST

   Metodo (no depende de adivinar la columna de fecha):
     - KPIs con @FechaInicio = @FechaFin = cada uno de los 7 dias completos
       anteriores a hoy, y KPIs con el rango de esos 7 dias.
     - INCLUSIVO: los dias sueltos traen tickets y su suma = el rango.
     - EXCLUSIVO (< @FechaFin): todos los dias sueltos dan 0 y el rango no.
   Se usa KPIs porque TotalTicketsPeriodo es un conteo directo de tickets.

   Ademas, para identificar la columna: conteo directo de la vista por dia
   en cada columna de fecha que aparece junto a @FechaInicio/@FechaFin en
   la definicion de KPIs (o en todas las de fecha de la vista, si ninguna).
   Si una coincide dia a dia con TotalTicketsPeriodo, es la del filtro. Si
   ninguna coincide exacto, el SP filtra algo mas: mandan las lineas 2B.
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 5 - DATE INCLUSIVITY TEST', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

-- Evidencia textual: columnas de fecha de la vista que aparecen en una linea
-- que tambien menciona @FechaInicio / @FechaFin, por SP.
DECLARE @evid TABLE (Procedimiento sysname, Columna sysname, LineasConParamFecha int, Lineas nvarchar(max));
INSERT @evid
SELECT o.Nombre, f.Columna,
       SUM(CASE WHEN l.Texto LIKE N'%@Fecha%' THEN 1 ELSE 0 END),
       STUFF((SELECT N', ' + CAST(l2.Linea AS nvarchar(10))
              FROM @lineas AS l2
              WHERE l2.Objeto = o.Nombre AND l2.Texto LIKE N'%@Fecha%'
                AND (N' ' + l2.Texto + N' ') LIKE N'%[^A-Za-z0-9_]' + f.Columna + N'[^A-Za-z0-9_]%'
              ORDER BY l2.Linea FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'')
FROM @obj AS o
JOIN @lineas AS l ON l.Objeto = o.Nombre
CROSS JOIN @fechasVista AS f
WHERE o.EsVista = 0
  AND (N' ' + l.Texto + N' ') LIKE N'%[^A-Za-z0-9_]' + f.Columna + N'[^A-Za-z0-9_]%'
GROUP BY o.Nombre, f.Columna;

SELECT Procedimiento, Columna, LineasConParamFecha, LineasNumero = Lineas
FROM @evid ORDER BY Procedimiento, LineasConParamFecha DESC, Columna;

-- KPIs por dia y por rango.
SELECT r.Corrida, r.Ini, r.Fin, k.TotalTicketsPeriodo, r.Error
FROM @kpiRun AS r LEFT JOIN @kpi AS k ON k.Id = r.IdFila
WHERE r.Corrida LIKE N'dia%' OR r.Corrida LIKE N'rango%'
ORDER BY r.Orden;

-- Conteo directo de la vista por dia, por columna candidata.
DECLARE @cand TABLE (Orden int IDENTITY(1,1), Columna sysname);
INSERT @cand (Columna)
SELECT Columna FROM @evid WHERE Procedimiento = N'usp_CorreoQARE_KPIs' AND LineasConParamFecha > 0;
IF NOT EXISTS (SELECT 1 FROM @cand)
    INSERT @cand (Columna) SELECT Columna FROM @fechasVista;

DECLARE @vistaDia TABLE (Columna sysname, Dia date, Conteo bigint);
DECLARE @col sysname, @sql nvarchar(max), @maxCand int;
SELECT @maxCand = MAX(Orden) FROM @cand;
SET @i = 1;
WHILE @EjecutarSps = 1 AND @i <= ISNULL(@maxCand, 0)
BEGIN
    SELECT @col = Columna FROM @cand WHERE Orden = @i;
    SET @sql = N'SELECT @c, CONVERT(date, ' + QUOTENAME(@col) + N'), COUNT_BIG(*) '
             + N'FROM dbo.vw_CorreoQARECierre_Base '
             + N'WHERE ' + QUOTENAME(@col) + N' >= @a AND ' + QUOTENAME(@col) + N' < DATEADD(DAY, 1, @b) '
             + N'GROUP BY CONVERT(date, ' + QUOTENAME(@col) + N');';
    BEGIN TRY
        INSERT @vistaDia (Columna, Dia, Conteo)
        EXEC sys.sp_executesql @sql, N'@c sysname, @a date, @b date', @c = @col, @a = @D1, @b = @D7;
    END TRY
    BEGIN CATCH
        INSERT @errores VALUES (N'5', N'vista por ' + @col, ERROR_MESSAGE());
    END CATCH
    RAISERROR(N'  conteo de la vista por %s', 0, 1, @col) WITH NOWAIT;
    SET @i += 1;
END

SELECT Dia = r.Ini, TotalSP_KPIs = k.TotalTicketsPeriodo, c.Columna, ConteoVista = ISNULL(v.Conteo, 0),
       Coincide = CASE WHEN k.TotalTicketsPeriodo = ISNULL(v.Conteo, 0) THEN N'SI' ELSE N'no' END
FROM @kpiRun AS r
LEFT JOIN @kpi AS k ON k.Id = r.IdFila
CROSS JOIN @cand AS c
LEFT JOIN @vistaDia AS v ON v.Columna = c.Columna AND v.Dia = r.Ini
WHERE r.Corrida LIKE N'dia%'
ORDER BY c.Columna, r.Ini;

-- Veredicto.
DECLARE @S bigint, @R bigint, @Z int, @Nd int, @Veredicto nvarchar(400);
SELECT @S = SUM(CAST(k.TotalTicketsPeriodo AS bigint)),
       @Z = SUM(CASE WHEN k.TotalTicketsPeriodo > 0 THEN 1 ELSE 0 END),
       @Nd = COUNT(k.Id)
FROM @kpiRun AS r LEFT JOIN @kpi AS k ON k.Id = r.IdFila
WHERE r.Corrida LIKE N'dia%';
SELECT @R = k.TotalTicketsPeriodo
FROM @kpiRun AS r JOIN @kpi AS k ON k.Id = r.IdFila
WHERE r.Corrida LIKE N'rango%';

SET @Veredicto =
    CASE
        WHEN @EjecutarSps = 0 THEN N'NO EJECUTADO (@EjecutarSps = 0)'
        WHEN @Nd < 7 OR @R IS NULL THEN N'NO CONCLUYENTE: alguna corrida de KPIs fallo (ver errores)'
        WHEN @R = 0 THEN N'NO CONCLUYENTE: sin tickets en ' + CONVERT(nvarchar(10), @D1, 23) + N'..' + CONVERT(nvarchar(10), @D7, 23)
        WHEN @Z > 0 AND @S = @R THEN N'INCLUSIVO: @FechaInicio = @FechaFin = dia devuelve los tickets de ese dia y la suma de los 7 dias ('
                                     + CAST(@S AS nvarchar(20)) + N') = el rango (' + CAST(@R AS nvarchar(20)) + N')'
        WHEN @Z = 0 AND @R > 0 THEN N'EXCLUSIVO: cada dia suelto da 0 y el rango da ' + CAST(@R AS nvarchar(20))
        ELSE N'NO CONCLUYENTE: suma de dias = ' + CAST(ISNULL(@S, 0) AS nvarchar(20)) + N', rango = '
             + CAST(@R AS nvarchar(20)) + N'; revisar las lineas PARAM FECHA de la seccion 2B'
    END;
SELECT VeredictoInclusividad = @Veredicto;


/* ==========================================================================
   SECTION 6 - DEFAULT DATE BEHAVIOR
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 6 - DEFAULT DATE BEHAVIOR', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

-- Reloj del servidor: de aqui sale el "hoy" de cualquier default con GETDATE().
SELECT ServidorGETDATE = GETDATE(), ServidorSYSDATETIMEOFFSET = SYSDATETIMEOFFSET(),
       UTC = SYSUTCDATETIME(), MexicoUTC6 = DATEADD(HOUR, -6, SYSUTCDATETIME());

-- Lineas que resuelven @FechaInicio / @FechaFin cuando llegan en NULL.
SELECT l.Objeto, l.Linea, Texto = RTRIM(l.Texto)
FROM @lineas AS l
JOIN @obj AS o ON o.Nombre = l.Objeto
WHERE (l.Texto LIKE N'%@FechaInicio%' OR l.Texto LIKE N'%@FechaFin%')
  AND (l.Texto LIKE N'%NULL%' OR l.Texto LIKE N'%ISNULL%' OR l.Texto LIKE N'%COALESCE%'
       OR l.Texto LIKE N'%GETDATE%' OR l.Texto LIKE N'%SYSDATETIME%' OR l.Texto LIKE N'%SYSUTCDATETIME%'
       OR l.Texto LIKE N'%CURRENT_TIMESTAMP%' OR l.Texto LIKE N'%DATEADD%' OR l.Texto LIKE N'% SET %'
       OR l.Texto LIKE N'SET %' OR l.Texto LIKE N'%SELECT @Fecha%')
ORDER BY o.Orden, l.Linea;

-- Prueba en vivo: que fechas usaron los SP con NULL/NULL (eco de las
-- columnas FechaInicio/FechaFin) y si KPIs NULL/NULL = KPIs explicito.
SELECT Fuente = N'ConfirmacionVsQA NULL/NULL', FechaInicioEfectiva = MIN(FechaInicio), FechaFinEfectiva = MAX(FechaFin), Filas = COUNT(*) FROM @confNull
UNION ALL
SELECT N'TipoSolucion NULL/NULL', MIN(FechaInicio), MAX(FechaFin), COUNT(*) FROM @tipoNull;

SELECT r.Corrida, r.Ini, r.Fin, k.TotalTicketsPeriodo, k.TicketsConfirmados, k.TicketsRecurrentes,
       k.CasosReutilizables, k.CasosPotencialKB, r.Error
FROM @kpiRun AS r LEFT JOIN @kpi AS k ON k.Id = r.IdFila
WHERE r.Corrida IN (N'muestra', N'defaults NULL/NULL')
ORDER BY r.Orden;


/* ==========================================================================
   SECTION 7 - EXECUTE PERMISSION
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SECTION 7 - EXECUTE PERMISSION', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

-- Quien corre el script (nombres, nunca credenciales).
SELECT UsuarioBD = USER_NAME(), Login = SUSER_SNAME(), LoginOriginal = ORIGINAL_LOGIN(),
       BaseDeDatos = DB_NAME(), EsDbOwner = IS_MEMBER(N'db_owner'),
       EsSysadmin = IS_SRVROLEMEMBER(N'sysadmin');

SELECT Objeto = N'dbo.' + o.Nombre,
       Permiso = CASE WHEN o.EsVista = 1 THEN N'SELECT' ELSE N'EXECUTE' END,
       Tiene = HAS_PERMS_BY_NAME(N'dbo.' + o.Nombre, N'OBJECT',
                                 CASE WHEN o.EsVista = 1 THEN N'SELECT' ELSE N'EXECUTE' END)
FROM @obj AS o ORDER BY o.Orden;

-- Concesiones explicitas que alcanzan a estos objetos (objeto, esquema dbo o
-- base entera), y a quien. Sirve para ver si la cuenta del SITIO las tiene
-- aunque el script lo corra otra persona.
SELECT Ambito = dp.class_desc,
       Objeto = CASE dp.class WHEN 1 THEN OBJECT_NAME(dp.major_id)
                              WHEN 3 THEN SCHEMA_NAME(dp.major_id) ELSE DB_NAME() END,
       dp.permission_name, dp.state_desc,
       Beneficiario = pr.name, TipoBeneficiario = pr.type_desc
FROM sys.database_permissions AS dp
JOIN sys.database_principals AS pr ON pr.principal_id = dp.grantee_principal_id
WHERE (dp.class = 1 AND dp.major_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @obj))
   OR (dp.class = 3 AND dp.major_id = SCHEMA_ID(N'dbo') AND dp.permission_name IN (N'EXECUTE', N'SELECT'))
   OR (dp.class = 0 AND dp.permission_name IN (N'EXECUTE', N'SELECT'))
ORDER BY Ambito, Objeto, Beneficiario;

/* Opcional: permisos del usuario del sitio sin conocer su contraseña.
   Requiere IMPERSONATE sobre ese usuario (o ser db_owner). Solo lee.
EXECUTE AS USER = N'<usuario de base de Web.config>';
SELECT UsuarioBD = USER_NAME(), Objeto = N'dbo.' + Nombre,
       Tiene = HAS_PERMS_BY_NAME(N'dbo.' + Nombre, N'OBJECT', CASE WHEN EsVista = 1 THEN N'SELECT' ELSE N'EXECUTE' END)
FROM @obj ORDER BY Orden;
REVERT;
*/


/* ==========================================================================
   ERRORS
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'ERRORS (vacio = ninguno)', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
SELECT Seccion, Objeto, Mensaje FROM @errores;


/* ==========================================================================
   SUMMARY
   Lo que se pudo establecer con datos de la base va a VERIFIED; lo que no,
   a UNKNOWN con el motivo. No hay recomendaciones.
   ========================================================================== */
RAISERROR(N'', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;
RAISERROR(N'SUMMARY', 0, 1) WITH NOWAIT;
RAISERROR(N'========================================', 0, 1) WITH NOWAIT;

DECLARE @res TABLE (Orden int, Clave nvarchar(60), Verificado bit, Valor nvarchar(max));
DECLARE @v nvarchar(max), @ok bit;

-- parameter types
DECLARE @pTot int, @pDate int;
SELECT @pTot = COUNT(*),
       @pDate = SUM(CASE WHEN TYPE_NAME(p.user_type_id) = N'date' AND p.name IN (N'@FechaInicio', N'@FechaFin') THEN 1 ELSE 0 END)
FROM sys.parameters AS p JOIN @obj AS o ON p.object_id = OBJECT_ID(N'dbo.' + o.Nombre);
SET @v = CAST(@pDate AS nvarchar(10)) + N' de ' + CAST(@pTot AS nvarchar(10))
       + N' parametros son @FechaInicio/@FechaFin DATE (esperado 12 de 12). Otros: '
       + ISNULL(STUFF((SELECT N', ' + o.Nombre + N'.' + p.name + N' ' + TYPE_NAME(p.user_type_id)
                       FROM sys.parameters AS p JOIN @obj AS o ON p.object_id = OBJECT_ID(N'dbo.' + o.Nombre)
                       WHERE NOT (TYPE_NAME(p.user_type_id) = N'date' AND p.name IN (N'@FechaInicio', N'@FechaFin'))
                       FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N''), N'ninguno');
INSERT @res VALUES (1, N'parameter types', CASE WHEN @pTot = 12 AND @pDate = 12 THEN 1 ELSE 0 END, @v);

-- expected columns
SET @v = STUFF((SELECT N', ' + e.Procedimiento + N'.' + e.Columna
                FROM @esperadas AS e
                LEFT JOIN @cols AS c ON c.Procedimiento = e.Procedimiento AND c.Columna = e.Columna
                WHERE c.Columna IS NULL
                FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'');
INSERT @res VALUES (2, N'expected columns',
    CASE WHEN @v IS NULL AND NOT EXISTS (SELECT 1 FROM @cols WHERE Error IS NOT NULL) THEN 1 ELSE 0 END,
    CASE WHEN @v IS NULL THEN N'las ' + CAST((SELECT COUNT(*) FROM @esperadas) AS nvarchar(10)) + N' presentes'
         ELSE N'FALTAN: ' + @v END
    + ISNULL(N'; errores de describe: ' + STUFF((SELECT N', ' + Procedimiento + N': ' + Error FROM @cols WHERE Error IS NOT NULL
                                                FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N''), N''));

-- percentage scale
DECLARE @maxAcum decimal(19,6), @sumFrec decimal(19,6), @sumConf decimal(19,6), @maxPct decimal(19,6);
SELECT @maxAcum = MAX(PorcentajeAcumulado) FROM @causa;
SELECT @sumFrec = SUM(Porcentaje) FROM @frec;
SELECT @sumConf = SUM(PorcentajeDelTotal) FROM @conf;
SELECT @maxPct = MAX(x) FROM (
    SELECT MAX(Porcentaje) AS x FROM @frec UNION ALL SELECT MAX(Porcentaje) FROM @causa
    UNION ALL SELECT MAX(PorcentajeRecurrentes) FROM @rec UNION ALL SELECT MAX(PorcentajeDelTotal) FROM @conf
    UNION ALL SELECT MAX(Porcentaje) FROM @tipo UNION ALL SELECT MAX(PorcentajeConfirmacion) FROM @kpi) AS t;
SET @v = N'max PorcentajeAcumulado = ' + ISNULL(CAST(@maxAcum AS nvarchar(40)), N'NULL')
       + N'; suma Frecuencia.Porcentaje = ' + ISNULL(CAST(@sumFrec AS nvarchar(40)), N'NULL')
       + N'; suma ConfVsQA.PorcentajeDelTotal = ' + ISNULL(CAST(@sumConf AS nvarchar(40)), N'NULL')
       + N'; max de cualquier porcentaje = ' + ISNULL(CAST(@maxPct AS nvarchar(40)), N'NULL');
SET @ok = CASE WHEN (@maxAcum BETWEEN 99 AND 100.5) OR (@sumFrec BETWEEN 99 AND 101) OR (@sumConf BETWEEN 99 AND 101) THEN 1 ELSE 0 END;
INSERT @res VALUES (3, N'percentage scale', @ok,
    CASE WHEN @ok = 1 THEN N'0-100. ' WHEN @maxPct > 0 AND @maxPct <= 1 THEN N'parece 0-1. ' ELSE N'no concluyente. ' END + @v);

-- literales
SET @v = STUFF((SELECT N' | [' + ISNULL(v, N'<NULL>') + N']'
                FROM (SELECT Frecuencia AS v FROM @frec UNION SELECT Frecuencia FROM @frecAmplio) AS t
                ORDER BY v FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 3, N'');
INSERT @res VALUES (4, N'exact frequency literals', CASE WHEN @v IS NULL THEN 0 ELSE 1 END,
    ISNULL(N'observados (' + CAST(@DiasAmplio AS nvarchar(10)) + N' dias): ' + @v
           + N'. Solo aparecen los que tienen tickets; el conjunto completo lo fija la definicion (2B).', N'sin filas'));

SET @v = STUFF((SELECT N' | [' + v + N']'
                FROM (SELECT ConfirmacionUsuario AS v FROM @conf UNION SELECT ConfirmacionUsuario FROM @confAmplio) AS t
                ORDER BY v FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 3, N'');
INSERT @res VALUES (5, N'exact confirmation literals', CASE WHEN @v IS NULL THEN 0 ELSE 1 END,
    ISNULL(N'observados: ' + @v + N'. Conjunto completo: CASE de la definicion (2B).', N'sin filas'));

SET @v = STUFF((SELECT N' | [' + v + N']'
                FROM (SELECT ValidacionQA AS v FROM @conf UNION SELECT ValidacionQA FROM @confAmplio) AS t
                ORDER BY v FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 3, N'');
INSERT @res VALUES (6, N'exact QA validation literals', CASE WHEN @v IS NULL THEN 0 ELSE 1 END,
    ISNULL(N'observados: ' + @v + N'. Conjunto completo: CASE de la definicion (2B).', N'sin filas'));

-- EsInconsistencia: mapa observado par -> valor, y las lineas que lo calculan.
SET @v = STUFF((SELECT N' | ' + ConfirmacionUsuario + N'/' + ValidacionQA + N'=' + CAST(MIN(EsInconsistencia) AS nvarchar(10))
                       + CASE WHEN MIN(EsInconsistencia) <> MAX(EsInconsistencia) THEN N'(VARIA)' ELSE N'' END
                FROM (SELECT * FROM @conf UNION ALL SELECT * FROM @confAmplio) AS t
                GROUP BY ConfirmacionUsuario, ValidacionQA
                ORDER BY ConfirmacionUsuario, ValidacionQA FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 3, N'');
INSERT @res VALUES (7, N'EsInconsistencia meaning',
    CASE WHEN @v IS NOT NULL AND @v NOT LIKE N'%(VARIA)%' THEN 1 ELSE 0 END,
    ISNULL(N'mapa observado: ' + @v, N'sin filas')
    + ISNULL(N'. Definicion: lineas ' + STUFF((SELECT N', ' + l.Objeto + N':' + CAST(l.Linea AS nvarchar(10))
                                              FROM @lineas AS l WHERE l.Texto LIKE N'%EsInconsistencia%'
                                              ORDER BY l.Objeto, l.Linea FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N''),
             N'. EsInconsistencia no aparece en ninguna definicion'));

-- date column: textual por SP + coincidencia empirica en KPIs.
DECLARE @colsTexto int, @spsConCol int;
SELECT @colsTexto = COUNT(DISTINCT Columna), @spsConCol = COUNT(DISTINCT Procedimiento)
FROM @evid WHERE LineasConParamFecha > 0;
SET @v = ISNULL(STUFF((SELECT N' | ' + Procedimiento + N': ' + Columna + N' (lineas ' + Lineas + N')'
                       FROM @evid WHERE LineasConParamFecha > 0
                       ORDER BY Procedimiento, Columna FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 3, N''),
                N'ninguna columna de fecha de la vista aparece junto a @FechaInicio/@FechaFin')
       + N'. Coincidencia dia a dia con KPIs: '
       + ISNULL(STUFF((SELECT N', ' + c.Columna FROM @cand AS c
                       WHERE @EjecutarSps = 1
                         AND NOT EXISTS (
                             SELECT 1 FROM @kpiRun AS r
                             LEFT JOIN @kpi AS k ON k.Id = r.IdFila
                             LEFT JOIN @vistaDia AS vd ON vd.Columna = c.Columna AND vd.Dia = r.Ini
                             WHERE r.Corrida LIKE N'dia%'
                               AND (k.TotalTicketsPeriodo IS NULL OR k.TotalTicketsPeriodo <> ISNULL(vd.Conteo, 0)))
                       FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N''), N'ninguna exacta');
INSERT @res VALUES (8, N'date column', CASE WHEN @colsTexto = 1 AND @spsConCol = 6 THEN 1 ELSE 0 END, @v);

-- inclusividad
INSERT @res VALUES (9, N'@FechaFin inclusive/exclusive',
    CASE WHEN @Veredicto LIKE N'INCLUSIVO%' OR @Veredicto LIKE N'EXCLUSIVO%' THEN 1 ELSE 0 END, @Veredicto);

-- NULL / default
DECLARE @nIni date, @nFin date, @kNull int, @kMuestra int;
SELECT @nIni = MIN(FechaInicio), @nFin = MAX(FechaFin)
FROM (SELECT FechaInicio, FechaFin FROM @confNull UNION ALL SELECT FechaInicio, FechaFin FROM @tipoNull) AS t;
SELECT @kNull = k.TotalTicketsPeriodo FROM @kpiRun AS r JOIN @kpi AS k ON k.Id = r.IdFila WHERE r.Corrida = N'defaults NULL/NULL';
SELECT @kMuestra = k.TotalTicketsPeriodo FROM @kpiRun AS r JOIN @kpi AS k ON k.Id = r.IdFila WHERE r.Corrida = N'muestra';
SET @v = N'con NULL/NULL los SP usaron ' + ISNULL(CONVERT(nvarchar(10), @nIni, 23), N'?') + N'..'
       + ISNULL(CONVERT(nvarchar(10), @nFin, 23), N'?') + N' (eco de ConfVsQA/TipoSolucion; hoy servidor = '
       + CONVERT(nvarchar(10), @Hoy, 23) + N'); KPIs NULL/NULL = ' + ISNULL(CAST(@kNull AS nvarchar(20)), N'?')
       + N' vs explicito ' + CONVERT(nvarchar(10), @MuestraIni, 23) + N'..' + CONVERT(nvarchar(10), @MuestraFin, 23)
       + N' = ' + ISNULL(CAST(@kMuestra AS nvarchar(20)), N'?')
       + N'. Columnas con NULL en la muestra: '
       + ISNULL(STUFF((SELECT N', ' + Origen + N'(' + CAST(Nulos AS nvarchar(10)) + N')' FROM @nulos WHERE Nulos > 0
                       ORDER BY Origen FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N''), N'ninguna');
INSERT @res VALUES (10, N'NULL/default behavior',
    CASE WHEN @nIni IS NOT NULL OR (@kNull IS NOT NULL AND @kNull = @kMuestra) THEN 1 ELSE 0 END, @v);

-- execute permissions
DECLARE @perm int;
SELECT @perm = SUM(HAS_PERMS_BY_NAME(N'dbo.' + Nombre, N'OBJECT', N'EXECUTE')) FROM @obj WHERE EsVista = 0;
INSERT @res VALUES (11, N'execute permissions', CASE WHEN @perm = 6 THEN 1 ELSE 0 END,
    CAST(ISNULL(@perm, 0) AS nvarchar(10)) + N' de 6 para el usuario ' + USER_NAME() + N' (login ' + SUSER_SNAME()
    + N'). Para la cuenta del sitio: ver concesiones explicitas en la seccion 7.');

RAISERROR(N'VERIFIED:', 0, 1) WITH NOWAIT;
SELECT Clave, Valor FROM @res WHERE Verificado = 1 ORDER BY Orden;
RAISERROR(N'UNKNOWN:', 0, 1) WITH NOWAIT;
SELECT Clave, Valor FROM @res WHERE Verificado = 0 ORDER BY Orden;
