/* =========================================================================
   sql/diag_qare_filtros_precheck.sql - Pre-check de los filtros Servicio /
   Grupo / Lider de QARE, con las expresiones EXACTAS del Backlog.

   Viene despues de sql/diag_qare_filtros_org.sql (v2, 2026-09-28), que
   encontro que el Backlog calcula:
       C1    = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(Categoria), N'Sin categoria')
       Lider = COALESCE(NULLIF(LTRIM(RTRIM(lg.Lider)), N''), N'Sin Torre')
               con LEFT JOIN dbo.CatLiderGrupo lg ON lg.Grupo = t.Grupo
       filtro: col IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@X))
   pero la cobertura se midio con fn_CategoriaC1 y con Grupo recortado.
   Aqui se repite con las expresiones del Backlog tal cual, sin recortar
   Grupo en el JOIN.

   PREGUNTAS
     1. Que hace de verdad fn_CorreoBacklog_CategoriaC1 (cuerpo + pruebas).
     2. Que hace de verdad fn_CorreoBacklog_SplitList: separador, recorte,
        vacios, NULL (cuerpo + pruebas).
     3. Cobertura exacta de QARE contra las listas de usp_CorreoBacklog_Catalogos
        (DISTINCT de TODO el historico de CorreoBacklogSnapshot).
     4. Que el JOIN con CatLiderGrupo no multiplique filas.
     5. Cuanto tarda calcular C1/Lider para 30 dias de QARE.

   ES DE SOLO LECTURA
   - Sin CREATE, ALTER, DROP, UPDATE, DELETE, MERGE, TRUNCATE, GRANT ni
     REVOKE sobre la base. No ejecuta ningun procedimiento del tablero ni del
     correo: solo sp_helptext (sistema) y SELECT, y llama a las dos funciones
     del Backlog, que son de lectura.
   - Los unicos INSERT/DELETE son sobre VARIABLES DE TABLA (@...) de esta
     conexion.

   COMO CORRERLO (SSMS, base Tickets_Proactivanet, en la VM)
     Results to Text (Ctrl+T). F5. Pegar TODO, incluido el RESUMEN del final.
   ========================================================================= */

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

DECLARE @Dias int = 30;

/* =========================================================================
   1. Cuerpos de las dos funciones del Backlog y de lo que llaman
   ========================================================================= */
PRINT N'==== 1a. Dependencias de las dos funciones ====';
SELECT Funcion = OBJECT_SCHEMA_NAME(d.referencing_id) + N'.' + OBJECT_NAME(d.referencing_id),
       Usa = ISNULL(d.referenced_schema_name + N'.', N'') + d.referenced_entity_name
FROM sys.sql_expression_dependencies AS d
WHERE d.referencing_id IN (OBJECT_ID(N'dbo.fn_CorreoBacklog_CategoriaC1'),
                           OBJECT_ID(N'dbo.fn_CorreoBacklog_SplitList'))
ORDER BY Funcion, Usa;

PRINT N'==== 1b. Tipo y columnas de salida ====';
SELECT Funcion = o.name, Tipo = o.type_desc
FROM sys.objects AS o
WHERE o.object_id IN (OBJECT_ID(N'dbo.fn_CorreoBacklog_CategoriaC1'),
                      OBJECT_ID(N'dbo.fn_CorreoBacklog_SplitList'));
SELECT Funcion = OBJECT_NAME(c.object_id), Columna = c.name, Tipo = t.name, Largo = c.max_length
FROM sys.columns AS c
JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.fn_CorreoBacklog_SplitList');

PRINT N'==== 1c. Definiciones (linea por linea) ====';
DECLARE @Objetos TABLE (Orden int, Nombre nvarchar(256));
INSERT @Objetos VALUES (1, N'dbo.fn_CorreoBacklog_CategoriaC1'), (2, N'dbo.fn_CorreoBacklog_SplitList');
-- Y cualquier funcion propia que llamen (p. ej. una de normalizacion).
INSERT @Objetos
SELECT DISTINCT 10, N'dbo.' + d.referenced_entity_name
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referenced_id AND o.type IN ('FN', 'IF', 'TF')
WHERE d.referencing_id IN (OBJECT_ID(N'dbo.fn_CorreoBacklog_CategoriaC1'),
                           OBJECT_ID(N'dbo.fn_CorreoBacklog_SplitList'));

DECLARE @Lineas TABLE (Id int IDENTITY(1, 1), Texto nvarchar(max));
DECLARE @Salida TABLE (Orden int, Objeto nvarchar(256), Linea int, Texto nvarchar(max));
DECLARE @Orden int, @Nombre nvarchar(256);
DECLARE objs CURSOR LOCAL FAST_FORWARD FOR SELECT Orden, Nombre FROM @Objetos ORDER BY Orden, Nombre;
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
SELECT Objeto, Linea, Texto FROM @Salida ORDER BY Orden, Objeto, Linea;

/* =========================================================================
   2. Comportamiento con entradas de prueba
   -------------------------------------------------------------------------
   Los corchetes [ ] dejan ver espacios al inicio o al final.
   ========================================================================= */
DECLARE @sql nvarchar(max);

PRINT N'==== 2a. fn_CorreoBacklog_CategoriaC1 con entradas de prueba ====';
IF OBJECT_ID(N'dbo.fn_CorreoBacklog_CategoriaC1') IS NOT NULL
BEGIN
    SET @sql = N'
    SELECT Caso = e.Caso,
           Entrada = N''['' + ISNULL(e.Categoria, N''(NULL)'') + N'']'',
           Resultado = N''['' + ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(e.Categoria), N''(NULL)'') + N'']'',
           ConFallback = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(e.Categoria), N''Sin categoria''),
           fn_CategoriaC1 = N''['' + ISNULL(dbo.fn_CategoriaC1(e.Categoria), N''(NULL)'') + N'']''
    FROM (VALUES
        (1,  CAST(NULL AS nvarchar(500))),
        (2,  N''''),
        (3,  N''   ''),
        (4,  N''/S-Punto de Venta/Aplicativo/Error X''),
        (5,  N''S-Punto de Venta/Aplicativo''),
        (6,  N''/Procesos comerciales de tienda (SAP)/''),
        (7,  N''  /S-Punto de Venta/Aplicativo  ''),
        (8,  N''/S-Punto'' + NCHAR(160) + N''de Venta/Aplicativo''),
        (9,  N''SinBarras''),
        (10, N''/''),
        (11, N''//X'')
    ) AS e(Caso, Categoria)
    ORDER BY e.Caso;';
    EXEC sys.sp_executesql @sql;
END
ELSE PRINT N'dbo.fn_CorreoBacklog_CategoriaC1 NO EXISTE.';

PRINT N'==== 2b. fn_CorreoBacklog_SplitList con entradas de prueba ====';
IF OBJECT_ID(N'dbo.fn_CorreoBacklog_SplitList') IS NOT NULL
BEGIN
    SET @sql = N'
    SELECT Caso = e.Caso,
           Entrada = N''['' + ISNULL(e.Lista, N''(NULL)'') + N'']'',
           Valor = N''['' + ISNULL(CONVERT(nvarchar(4000), s.Valor), N''(NULL)'') + N'']'',
           LargoValor = LEN(CONVERT(nvarchar(4000), s.Valor))
    FROM (VALUES
        (1, CAST(NULL AS nvarchar(max))),
        (2, N''''),
        (3, N''a,b''),
        (4, N'' a , b ''),
        (5, N''a,,b''),
        (6, N''a,''),
        (7, N''a;b''),
        (8, N''a|b''),
        (9, N''Proveedor  e-Consultores,Service Desk''),
        (10, N''Sin Torre''),
        (11, N''Jesus Campa,Laura Cardenas'')
    ) AS e(Caso, Lista)
    OUTER APPLY dbo.fn_CorreoBacklog_SplitList(e.Lista) AS s
    ORDER BY e.Caso;';
    EXEC sys.sp_executesql @sql;
END
ELSE PRINT N'dbo.fn_CorreoBacklog_SplitList NO EXISTE.';

/* =========================================================================
   3. Cobertura exacta de QARE contra los catalogos del Backlog
   -------------------------------------------------------------------------
   Catalogo = lo que devuelve usp_CorreoBacklog_Catalogos: DISTINCT C1 /
   Grupo / Lider NOT NULL de TODO CorreoBacklogSnapshot. Comparacion con =
   (la colacion de la base, igual que el IN del Backlog), SIN recortar.
   ========================================================================= */
PRINT N'==== 3. Cobertura exacta (ultimos @Dias dias de QARE) ====';

DECLARE @Ff date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
DECLARE @Fi date = DATEADD(DAY, 1 - @Dias, @Ff);
DECLARE @t0 datetime2 = SYSDATETIME();

SET @sql = N'
DECLARE @M TABLE (CodigoTicket nvarchar(200), Grupo nvarchar(500), C1 nvarchar(500),
                  Lider nvarchar(500), GrupoEnCat bit, C1EnCat bit, LiderEnCat bit,
                  TieneFilaCat bit, C1ViejaIgual bit);

INSERT @M
SELECT q.CodigoTicket, q.Grupo, x.C1, x.Lider,
       GrupoEnCat = CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogSnapshot s WHERE s.Grupo = q.Grupo) THEN 1 ELSE 0 END,
       C1EnCat    = CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogSnapshot s WHERE s.C1 = x.C1) THEN 1 ELSE 0 END,
       LiderEnCat = CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogSnapshot s WHERE s.Lider = x.Lider) THEN 1 ELSE 0 END,
       TieneFilaCat = CASE WHEN lg.Grupo IS NULL THEN 0 ELSE 1 END,
       C1ViejaIgual = CASE WHEN ISNULL(dbo.fn_CategoriaC1(q.Categoria), N''~'') = x.C1 THEN 1 ELSE 0 END
FROM dbo.vw_CorreoQARECierre_Base AS q
LEFT JOIN dbo.CatLiderGrupo AS lg ON lg.Grupo = q.Grupo
CROSS APPLY (SELECT C1    = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(q.Categoria), N''Sin categoria''),
                    Lider = COALESCE(NULLIF(LTRIM(RTRIM(lg.Lider)), N''''), N''Sin Torre'')) AS x
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

-- Filas sin JOIN, para ver si el JOIN multiplica.
DECLARE @FilasVista bigint = (
    SELECT COUNT_BIG(*) FROM dbo.vw_CorreoQARECierre_Base AS q
    WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff));

SELECT VentanaInicio = @Fi, VentanaFin = @Ff,
       FilasVista = @FilasVista,
       FilasConJoin = COUNT_BIG(*),
       JoinMultiplica = CASE WHEN COUNT_BIG(*) <> @FilasVista THEN N''SI'' ELSE N''no'' END,
       TicketsQare = COUNT(DISTINCT CodigoTicket),
       GruposQare  = COUNT(DISTINCT Grupo),
       C1Qare      = COUNT(DISTINCT C1),
       LideresQare = COUNT(DISTINCT Lider),
       TicketsGrupoFuera = COUNT(DISTINCT CASE WHEN GrupoEnCat = 0 THEN CodigoTicket END),
       GruposFuera       = COUNT(DISTINCT CASE WHEN GrupoEnCat = 0 THEN Grupo END),
       TicketsC1Fuera    = COUNT(DISTINCT CASE WHEN C1EnCat = 0 THEN CodigoTicket END),
       C1Fuera           = COUNT(DISTINCT CASE WHEN C1EnCat = 0 THEN C1 END),
       TicketsLiderFuera = COUNT(DISTINCT CASE WHEN LiderEnCat = 0 THEN CodigoTicket END),
       LideresFuera      = COUNT(DISTINCT CASE WHEN LiderEnCat = 0 THEN Lider END),
       TicketsSinTorre   = COUNT(DISTINCT CASE WHEN TieneFilaCat = 0 THEN CodigoTicket END),
       TicketsSinCategoria = COUNT(DISTINCT CASE WHEN C1 = N''Sin categoria'' THEN CodigoTicket END),
       TicketsC1DistintaAfnCategoriaC1 = COUNT(DISTINCT CASE WHEN C1ViejaIgual = 0 THEN CodigoTicket END)
FROM @M;

-- Detalle de lo que quede fuera (vacio si todo cubre).
SELECT TOP (40) Que = N''Grupo fuera del catalogo'', Valor = N''['' + ISNULL(Grupo, N''(NULL)'') + N'']'', Tickets = COUNT(DISTINCT CodigoTicket)
FROM @M WHERE GrupoEnCat = 0 GROUP BY Grupo
UNION ALL
SELECT TOP (40) N''C1 fuera del catalogo'', N''['' + C1 + N'']'', COUNT(DISTINCT CodigoTicket)
FROM @M WHERE C1EnCat = 0 GROUP BY C1
UNION ALL
SELECT TOP (40) N''Lider fuera del catalogo'', N''['' + Lider + N'']'', COUNT(DISTINCT CodigoTicket)
FROM @M WHERE LiderEnCat = 0 GROUP BY Lider
UNION ALL
SELECT TOP (40) N''Grupo sin fila en CatLiderGrupo (Sin Torre)'', N''['' + ISNULL(Grupo, N''(NULL)'') + N'']'', COUNT(DISTINCT CodigoTicket)
FROM @M WHERE TieneFilaCat = 0 GROUP BY Grupo
UNION ALL
SELECT TOP (40) N''C1 distinta a fn_CategoriaC1'', N''['' + C1 + N'']'', COUNT(DISTINCT CodigoTicket)
FROM @M WHERE C1ViejaIgual = 0 GROUP BY C1
ORDER BY 1, 3 DESC;

-- Los Lider y C1 de QARE con su volumen: lo que ofrecerian los desplegables.
SELECT Lider, Tickets = COUNT(DISTINCT CodigoTicket), Grupos = COUNT(DISTINCT Grupo)
FROM @M GROUP BY Lider ORDER BY Tickets DESC;';

IF OBJECT_ID(N'dbo.fn_CorreoBacklog_CategoriaC1') IS NOT NULL
    EXEC sys.sp_executesql @sql, N'@Fi date, @Ff date', @Fi, @Ff;
ELSE
    PRINT N'Sin fn_CorreoBacklog_CategoriaC1 no se puede medir la cobertura exacta.';

PRINT N'==== 4. Tiempo de la seccion 3 (ms) ====';
SELECT Milisegundos = DATEDIFF(MILLISECOND, @t0, SYSDATETIME());

/* =========================================================================
   5. Las etiquetas de respaldo existen en los catalogos?
   -------------------------------------------------------------------------
   Si 'Sin Torre' o 'Sin categoria' no estan en el historico del snapshot,
   un ticket QARE con esa etiqueta no se podria elegir en el desplegable.
   ========================================================================= */
PRINT N'==== 5. Fallbacks en el catalogo ====';
SELECT Etiqueta = N'Sin Torre (Lider)',
       EnCatalogo = CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogSnapshot WHERE Lider = N'Sin Torre') THEN 1 ELSE 0 END
UNION ALL
SELECT N'Sin categoria (C1)',
       CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogSnapshot WHERE C1 = N'Sin categoria') THEN 1 ELSE 0 END;

PRINT N'==== FIN ====';
