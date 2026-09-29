/* =========================================================================
   sql/diag_qare_filtros_org.sql - v2. Camino exacto de Servicio (C1), Grupo
   y Lider en el Backlog, y cobertura de QARE contra esos catalogos.

   v1 (2026-09-28) confirmo: vw_CorreoQARECierre_Base trae Grupo y Categoria,
   pero no C1 ni Lider; el snapshot lo escriben usp_CorreoBacklog_PrepararCorte
   y usp_CorreoBacklog_Backfill; existe dbo.CatLiderGrupo (59 filas) y la
   vista dbo.vw_TicketsConLider. Las definiciones salieron recortadas (limite
   de 256 caracteres de Results to Text) y la seccion 4 fallo (error 130).

   v2 lee las definiciones LINEA POR LINEA con sp_helptext (cada linea cabe
   en 256 caracteres, no hace falta tocar opciones de SSMS) y rehace la
   cobertura sin agregados sobre subconsultas.

   OBJETIVO
     1. De donde sale el C1 del Backlog (Categoria -> C1).
     2. De donde sale el Lider del Backlog y por que llave (Grupo -> Lider).
     3. Que hace el Backlog con un ticket sin Lider.
     4. Como filtran @C1 / @Grupos / @Lideres en usp_CorreoBacklog_Principal.
     5. Que devuelve usp_CorreoBacklog_Catalogos (de donde salen las listas).
     6. Cobertura de los tickets QARE contra esas listas.

   ES DE SOLO LECTURA
   - Sin CREATE, ALTER, DROP, UPDATE, DELETE, MERGE, TRUNCATE, GRANT ni
     REVOKE. No ejecuta ningun procedimiento del tablero ni del correo.
   - Los UNICOS INSERT/DELETE son sobre VARIABLES DE TABLA (@...) de esta
     conexion, para capturar la salida de sp_helptext (procedimiento del
     sistema, solo lee la definicion). No tocan ninguna tabla de
     Tickets_Proactivanet.

   COMO CORRERLO (SSMS, base Tickets_Proactivanet, en la VM)
     Results to Text (Ctrl+T) o to File (Ctrl+Shift+F). F5. Pegar TODO.
   ========================================================================= */

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- ------------------------------------------------------------ ajustes
DECLARE @Dias int = 30;   -- ventana de QARE para la cobertura (dias naturales, incluye hoy)

/* =========================================================================
   1. Definiciones completas, linea por linea
   ========================================================================= */
PRINT N'==== 1. Definiciones (sp_helptext, linea por linea) ====';

DECLARE @Objetos TABLE (Orden int, Nombre nvarchar(256));
INSERT @Objetos VALUES
    (1,  N'dbo.usp_CorreoBacklog_PrepararCorte'),   -- escribe el corte de hoy: C1 y Lider
    (2,  N'dbo.usp_CorreoBacklog_Backfill'),        -- escribe cortes pasados: C1 y Lider
    (3,  N'dbo.usp_CorreoBacklog_Catalogos'),       -- las listas de los filtros
    (4,  N'dbo.usp_CorreoBacklog_Principal'),       -- el filtro @C1/@Grupos/@Lideres
    (5,  N'dbo.vw_Backlog'),                        -- de donde lee PrepararCorte
    (6,  N'dbo.vw_TicketsConLider'),                -- candidata a fuente del Lider
    (7,  N'dbo.usp_CargarCatLiderGrupo'),           -- como se llena CatLiderGrupo
    (8,  N'dbo.fn_CategoriaC1'),
    (9,  N'dbo.fn_NormalizaCategoria'),
    (10, N'dbo.vw_CorreoQARECierre_Base'),
    (11, N'dbo.vw_Cerrados');                       -- tambien tiene Lider (tickets cerrados)

DECLARE @Lineas TABLE (Id int IDENTITY(1, 1), Texto nvarchar(max));
DECLARE @Salida TABLE (Orden int, Objeto nvarchar(256), Linea int, Texto nvarchar(max));
DECLARE @Orden int, @Nombre nvarchar(256);

DECLARE objs CURSOR LOCAL FAST_FORWARD FOR SELECT Orden, Nombre FROM @Objetos ORDER BY Orden;
OPEN objs;
FETCH NEXT FROM objs INTO @Orden, @Nombre;
WHILE @@FETCH_STATUS = 0
BEGIN
    DELETE @Lineas;
    IF OBJECT_ID(@Nombre) IS NULL
        INSERT @Salida VALUES (@Orden, @Nombre, 0, N'(NO EXISTE)');
    ELSE
    BEGIN
        BEGIN TRY
            INSERT @Lineas (Texto) EXEC sys.sp_helptext @Nombre;
            INSERT @Salida
            SELECT @Orden, @Nombre, ROW_NUMBER() OVER (ORDER BY Id),
                   RTRIM(REPLACE(REPLACE(Texto, NCHAR(13), N''), NCHAR(10), N' '))
            FROM @Lineas;
        END TRY
        BEGIN CATCH
            INSERT @Salida VALUES (@Orden, @Nombre, 0, N'(sin permiso o cifrado: ' + ERROR_MESSAGE() + N')');
        END CATCH
    END
    FETCH NEXT FROM objs INTO @Orden, @Nombre;
END
CLOSE objs;
DEALLOCATE objs;

SELECT Objeto, Linea, Texto FROM @Salida ORDER BY Orden, Linea;

/* =========================================================================
   2. dbo.CatLiderGrupo: columnas, contenido y ambiguedades
   ========================================================================= */
PRINT N'==== 2a. Columnas de CatLiderGrupo y vw_TicketsConLider ====';
SELECT Objeto = OBJECT_NAME(c.object_id), Ordinal = c.column_id, Columna = c.name, Tipo = t.name
FROM sys.columns AS c
JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id IN (OBJECT_ID(N'dbo.CatLiderGrupo'), OBJECT_ID(N'dbo.vw_TicketsConLider'))
ORDER BY Objeto, Ordinal;

PRINT N'==== 2b. Contenido de CatLiderGrupo (59 filas, sin correos) ====';
-- Se lista todo menos CorreoLider: no hace falta para el diagnostico.
DECLARE @cols nvarchar(max) = (
    SELECT STRING_AGG(QUOTENAME(c.name), N', ') WITHIN GROUP (ORDER BY c.column_id)
    FROM sys.columns AS c
    WHERE c.object_id = OBJECT_ID(N'dbo.CatLiderGrupo') AND c.name <> N'CorreoLider');
DECLARE @sql nvarchar(max);
IF @cols IS NOT NULL
BEGIN
    SET @sql = N'SELECT ' + @cols + N' FROM dbo.CatLiderGrupo ORDER BY 1;';
    EXEC sys.sp_executesql @sql;
END

PRINT N'==== 2c. Grupos con mas de un Lider en CatLiderGrupo (duplicarian filas en un JOIN) ====';
IF COL_LENGTH(N'dbo.CatLiderGrupo', N'Grupo') IS NOT NULL
BEGIN
    SET @sql = N'
    SELECT Grupo = LTRIM(RTRIM(Grupo)), Filas = COUNT(*), Lideres = COUNT(DISTINCT LTRIM(RTRIM(Lider)))
    FROM dbo.CatLiderGrupo
    GROUP BY LTRIM(RTRIM(Grupo))
    HAVING COUNT(*) > 1
    ORDER BY Filas DESC, Grupo;';
    EXEC sys.sp_executesql @sql;
END
ELSE
    PRINT N'CatLiderGrupo no tiene columna Grupo: ver 2a para la llave real.';

/* =========================================================================
   3. Como se ve el Lider/C1 en el snapshot (comportamiento sin Lider)
   ========================================================================= */
DECLARE @Corte date = (SELECT MAX(FechaCorte) FROM dbo.CorreoBacklogSnapshot);

PRINT N'==== 3a. Lider en el ultimo corte: NULL, vacio y etiquetas de respaldo ====';
SELECT UltimoCorte = @Corte,
       Filas = COUNT(*),
       LiderNull = SUM(CASE WHEN s.Lider IS NULL THEN 1 ELSE 0 END),
       LiderVacio = SUM(CASE WHEN s.Lider IS NOT NULL AND LTRIM(RTRIM(s.Lider)) = N'' THEN 1 ELSE 0 END),
       C1Null = SUM(CASE WHEN s.C1 IS NULL THEN 1 ELSE 0 END),
       C1Vacio = SUM(CASE WHEN s.C1 IS NOT NULL AND LTRIM(RTRIM(s.C1)) = N'' THEN 1 ELSE 0 END)
FROM dbo.CorreoBacklogSnapshot AS s
WHERE s.FechaCorte = @Corte;

-- Todos los lideres del corte con su volumen: aqui se ve si hay "Sin Torre"
-- u otra etiqueta de respaldo y cuantos tickets lleva.
SELECT Lider = ISNULL(s.Lider, N'(NULL)'), Tickets = COUNT(*),
       Grupos = COUNT(DISTINCT s.Grupo)
FROM dbo.CorreoBacklogSnapshot AS s
WHERE s.FechaCorte = @Corte
GROUP BY s.Lider
ORDER BY Tickets DESC;

PRINT N'==== 3b. Grupos del snapshot con mas de un Lider en el ultimo corte ====';
SELECT Grupo = s.Grupo, Lideres = COUNT(DISTINCT ISNULL(s.Lider, N'(NULL)'))
FROM dbo.CorreoBacklogSnapshot AS s
WHERE s.FechaCorte = @Corte
GROUP BY s.Grupo
HAVING COUNT(DISTINCT ISNULL(s.Lider, N'(NULL)')) > 1
ORDER BY Grupo;

PRINT N'==== 3c. Snapshot vs CatLiderGrupo: el Lider del corte coincide con el del catalogo? ====';
IF COL_LENGTH(N'dbo.CatLiderGrupo', N'Grupo') IS NOT NULL
BEGIN
    SET @sql = N'
    ;WITH s AS (
        SELECT s.Grupo, s.Lider,
               LiderCat = (SELECT TOP (1) c.Lider FROM dbo.CatLiderGrupo AS c
                           WHERE LTRIM(RTRIM(c.Grupo)) = LTRIM(RTRIM(s.Grupo))
                           ORDER BY c.Lider)
        FROM dbo.CorreoBacklogSnapshot AS s
        WHERE s.FechaCorte = @Corte
    )
    SELECT Filas = COUNT(*),
           IgualAlCatalogo = SUM(CASE WHEN ISNULL(Lider, N''~'') = ISNULL(LiderCat, N''~'') THEN 1 ELSE 0 END),
           GrupoSinCatalogo = SUM(CASE WHEN LiderCat IS NULL THEN 1 ELSE 0 END),
           DistintoAlCatalogo = SUM(CASE WHEN LiderCat IS NOT NULL AND ISNULL(Lider, N''~'') <> LiderCat THEN 1 ELSE 0 END)
    FROM s;

    -- Ejemplos de lo que no coincide (grupo, lider del corte, lider del catalogo).
    ;WITH s AS (
        SELECT s.Grupo, s.Lider,
               LiderCat = (SELECT TOP (1) c.Lider FROM dbo.CatLiderGrupo AS c
                           WHERE LTRIM(RTRIM(c.Grupo)) = LTRIM(RTRIM(s.Grupo))
                           ORDER BY c.Lider)
        FROM dbo.CorreoBacklogSnapshot AS s
        WHERE s.FechaCorte = @Corte
    )
    SELECT TOP (25) Grupo, LiderCorte = ISNULL(Lider, N''(NULL)''), LiderCatalogo = ISNULL(LiderCat, N''(sin fila)''), Tickets = COUNT(*)
    FROM s
    WHERE ISNULL(Lider, N''~'') <> ISNULL(LiderCat, N''~'')
    GROUP BY Grupo, Lider, LiderCat
    ORDER BY Tickets DESC;';
    EXEC sys.sp_executesql @sql, N'@Corte date', @Corte;
END

PRINT N'==== 3d. Snapshot vs fn_CategoriaC1: el C1 del corte = fn_CategoriaC1(Categoria)? ====';
IF OBJECT_ID(N'dbo.fn_CategoriaC1') IS NOT NULL
BEGIN
    SET @sql = N'
    ;WITH s AS (
        SELECT s.C1, C1Fn = dbo.fn_CategoriaC1(s.Categoria)
        FROM dbo.CorreoBacklogSnapshot AS s
        WHERE s.FechaCorte = @Corte
    )
    SELECT Filas = COUNT(*),
           IgualAFuncion = SUM(CASE WHEN ISNULL(C1, N''~'') = ISNULL(C1Fn, N''~'') THEN 1 ELSE 0 END),
           Distinto = SUM(CASE WHEN ISNULL(C1, N''~'') <> ISNULL(C1Fn, N''~'') THEN 1 ELSE 0 END)
    FROM s;

    SELECT TOP (15) C1Corte = ISNULL(s.C1, N''(NULL)''), C1Funcion = dbo.fn_CategoriaC1(s.Categoria), Tickets = COUNT(*)
    FROM dbo.CorreoBacklogSnapshot AS s
    WHERE s.FechaCorte = @Corte
      AND ISNULL(s.C1, N''~'') <> ISNULL(dbo.fn_CategoriaC1(s.Categoria), N''~'')
    GROUP BY s.C1, dbo.fn_CategoriaC1(s.Categoria)
    ORDER BY Tickets DESC;';
    EXEC sys.sp_executesql @sql, N'@Corte date', @Corte;
END

/* =========================================================================
   4. Cobertura de QARE contra las listas del Backlog
   -------------------------------------------------------------------------
   Las listas se aproximan de DOS formas porque su regla exacta esta en
   usp_CorreoBacklog_Catalogos (seccion 1): el ultimo corte, y todo el
   historico del snapshot. El reporte final usa la que coincida con el SP.
   Sin agregados sobre subconsultas: primero se marca cada ticket (0/1) en
   una tabla derivada y despues se cuenta.
   ========================================================================= */
PRINT N'==== 4. Cobertura de QARE (ultimos @Dias dias) ====';

DECLARE @Ff date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
DECLARE @Fi date = DATEADD(DAY, 1 - @Dias, @Ff);

SET @sql = N'
;WITH q AS (
    SELECT DISTINCT
        q.CodigoTicket,
        Grupo = LTRIM(RTRIM(q.Grupo)),
        C1 = dbo.fn_CategoriaC1(q.Categoria)
    FROM dbo.vw_CorreoQARECierre_Base AS q
    WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
), gUlt AS (
    SELECT DISTINCT Grupo = LTRIM(RTRIM(Grupo)) FROM dbo.CorreoBacklogSnapshot WHERE FechaCorte = @Corte
), gHis AS (
    SELECT DISTINCT Grupo = LTRIM(RTRIM(Grupo)) FROM dbo.CorreoBacklogSnapshot
), cUlt AS (
    SELECT DISTINCT C1 = LTRIM(RTRIM(C1)) FROM dbo.CorreoBacklogSnapshot WHERE FechaCorte = @Corte
), cHis AS (
    SELECT DISTINCT C1 = LTRIM(RTRIM(C1)) FROM dbo.CorreoBacklogSnapshot
), m AS (
    SELECT q.CodigoTicket, q.Grupo, q.C1,
           GrupoEnUlt = CASE WHEN g1.Grupo IS NULL THEN 0 ELSE 1 END,
           GrupoEnHis = CASE WHEN g2.Grupo IS NULL THEN 0 ELSE 1 END,
           C1EnUlt    = CASE WHEN c1.C1 IS NULL THEN 0 ELSE 1 END,
           C1EnHis    = CASE WHEN c2.C1 IS NULL THEN 0 ELSE 1 END
    FROM q
    LEFT JOIN gUlt AS g1 ON g1.Grupo = q.Grupo
    LEFT JOIN gHis AS g2 ON g2.Grupo = q.Grupo
    LEFT JOIN cUlt AS c1 ON c1.C1 = LTRIM(RTRIM(q.C1))
    LEFT JOIN cHis AS c2 ON c2.C1 = LTRIM(RTRIM(q.C1))
)
SELECT
    VentanaInicio = @Fi, VentanaFin = @Ff, UltimoCorte = @Corte,
    TicketsQare = COUNT(DISTINCT CodigoTicket),
    GruposQare  = COUNT(DISTINCT Grupo),
    C1Qare      = COUNT(DISTINCT C1),
    -- Grupo
    TicketsGrupoFuera_UltCorte = COUNT(DISTINCT CASE WHEN GrupoEnUlt = 0 THEN CodigoTicket END),
    GruposFuera_UltCorte       = COUNT(DISTINCT CASE WHEN GrupoEnUlt = 0 THEN Grupo END),
    TicketsGrupoFuera_Historico= COUNT(DISTINCT CASE WHEN GrupoEnHis = 0 THEN CodigoTicket END),
    GruposFuera_Historico      = COUNT(DISTINCT CASE WHEN GrupoEnHis = 0 THEN Grupo END),
    -- C1
    TicketsC1Fuera_UltCorte    = COUNT(DISTINCT CASE WHEN C1EnUlt = 0 THEN CodigoTicket END),
    C1Fuera_UltCorte           = COUNT(DISTINCT CASE WHEN C1EnUlt = 0 THEN C1 END),
    TicketsC1Fuera_Historico   = COUNT(DISTINCT CASE WHEN C1EnHis = 0 THEN CodigoTicket END),
    C1Fuera_Historico          = COUNT(DISTINCT CASE WHEN C1EnHis = 0 THEN C1 END)
FROM m;

-- Detalle: grupos y C1 de QARE que no estan en el historico del snapshot.
;WITH q AS (
    SELECT DISTINCT q.CodigoTicket, Grupo = LTRIM(RTRIM(q.Grupo))
    FROM dbo.vw_CorreoQARECierre_Base AS q
    WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
)
SELECT TOP (40) GrupoQareFueraDelBacklog = ISNULL(q.Grupo, N''(NULL)''), Tickets = COUNT(*)
FROM q
WHERE NOT EXISTS (SELECT 1 FROM dbo.CorreoBacklogSnapshot AS s WHERE LTRIM(RTRIM(s.Grupo)) = q.Grupo)
GROUP BY q.Grupo
ORDER BY Tickets DESC;

;WITH q AS (
    SELECT DISTINCT q.CodigoTicket, C1 = LTRIM(RTRIM(dbo.fn_CategoriaC1(q.Categoria)))
    FROM dbo.vw_CorreoQARECierre_Base AS q
    WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
)
SELECT TOP (40) C1QareFueraDelBacklog = ISNULL(q.C1, N''(NULL)''), Tickets = COUNT(*)
FROM q
WHERE NOT EXISTS (SELECT 1 FROM dbo.CorreoBacklogSnapshot AS s WHERE LTRIM(RTRIM(s.C1)) = q.C1)
GROUP BY q.C1
ORDER BY Tickets DESC;';
EXEC sys.sp_executesql @sql, N'@Fi date, @Ff date, @Corte date', @Fi, @Ff, @Corte;

PRINT N'==== 4b. Tickets QARE sin Lider (por CatLiderGrupo y por vw_TicketsConLider) ====';
-- Dos candidatos: la regla real sale de la seccion 1 (PrepararCorte /
-- Backfill). Cada uno solo corre si sus columnas existen.
IF COL_LENGTH(N'dbo.CatLiderGrupo', N'Grupo') IS NOT NULL
BEGIN
    SET @sql = N'
    ;WITH q AS (
        SELECT DISTINCT q.CodigoTicket, Grupo = LTRIM(RTRIM(q.Grupo))
        FROM dbo.vw_CorreoQARECierre_Base AS q
        WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
    ), m AS (
        SELECT q.CodigoTicket, q.Grupo,
               TieneLider = CASE WHEN EXISTS (SELECT 1 FROM dbo.CatLiderGrupo AS c
                                              WHERE LTRIM(RTRIM(c.Grupo)) = q.Grupo
                                                AND NULLIF(LTRIM(RTRIM(c.Lider)), N'''') IS NOT NULL)
                                 THEN 1 ELSE 0 END
        FROM q
    )
    SELECT Via = N''CatLiderGrupo por Grupo'',
           TicketsQare = COUNT(*), TicketsSinLider = SUM(1 - TieneLider),
           GruposSinLider = COUNT(DISTINCT CASE WHEN TieneLider = 0 THEN Grupo END)
    FROM m;

    ;WITH q AS (
        SELECT DISTINCT q.CodigoTicket, Grupo = LTRIM(RTRIM(q.Grupo))
        FROM dbo.vw_CorreoQARECierre_Base AS q
        WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
    )
    SELECT TOP (40) GrupoQareSinLider = ISNULL(q.Grupo, N''(NULL)''), Tickets = COUNT(*)
    FROM q
    WHERE NOT EXISTS (SELECT 1 FROM dbo.CatLiderGrupo AS c
                      WHERE LTRIM(RTRIM(c.Grupo)) = q.Grupo
                        AND NULLIF(LTRIM(RTRIM(c.Lider)), N'''') IS NOT NULL)
    GROUP BY q.Grupo
    ORDER BY Tickets DESC;';
    EXEC sys.sp_executesql @sql, N'@Fi date, @Ff date', @Fi, @Ff;
END

IF COL_LENGTH(N'dbo.vw_TicketsConLider', N'CodigoTicket') IS NOT NULL
   AND COL_LENGTH(N'dbo.vw_TicketsConLider', N'Lider') IS NOT NULL
BEGIN
    SET @sql = N'
    ;WITH q AS (
        SELECT DISTINCT q.CodigoTicket
        FROM dbo.vw_CorreoQARECierre_Base AS q
        WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
    ), m AS (
        SELECT q.CodigoTicket,
               TieneFila  = CASE WHEN EXISTS (SELECT 1 FROM dbo.vw_TicketsConLider AS t
                                              WHERE t.CodigoTicket = q.CodigoTicket) THEN 1 ELSE 0 END,
               TieneLider = CASE WHEN EXISTS (SELECT 1 FROM dbo.vw_TicketsConLider AS t
                                              WHERE t.CodigoTicket = q.CodigoTicket
                                                AND NULLIF(LTRIM(RTRIM(t.Lider)), N'''') IS NOT NULL) THEN 1 ELSE 0 END
        FROM q
    )
    SELECT Via = N''vw_TicketsConLider por CodigoTicket'',
           TicketsQare = COUNT(*),
           SinFilaEnVista = SUM(1 - TieneFila),
           TicketsSinLider = SUM(1 - TieneLider)
    FROM m;';
    EXEC sys.sp_executesql @sql, N'@Fi date, @Ff date', @Fi, @Ff;
END
ELSE
    PRINT N'vw_TicketsConLider no tiene CodigoTicket/Lider: ver 2a.';
