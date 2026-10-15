/* =====================================================================================
   diag_admin_tipo_por_prefijo.sql

   SOLO LECTURA. Ningun INSERT / UPDATE / DELETE / DDL. Solo tablas temporales
   (#Ini, #Cat) en tempdb, que se borran al final.

   Pregunta: en "Crear iniciativa" (Admin), Clasificacion (TipoIniciativa) y
   Agrupacion (TipoAgrupado) se pueden DERIVAR del Tipo de iniciativa
   (prefijo del Codigo) y ocultar sus filas? Hoy la regla es "nunca se derivan
   del prefijo" porque no hay un mapeo verificado. Este script dice, con los
   datos vigentes, si cada prefijo tiene UN par dominante y si una iniciativa
   lleva el mismo tipo en todas sus categorias ("si es Problem en una, es
   Problem en todas").

     T1  prefijo -> TipoIniciativa (dbo.Problem): cuantos y % dentro del prefijo
     T2  prefijo -> TipoAgrupado (dbo.ProblemCategoria): cuantos y % del prefijo
     T3  prefijo -> par (TipoIniciativa, TipoAgrupado) por iniciativa, con %
         y si es el UNICO par del prefijo
     T4  iniciativas con MAS de un TipoAgrupado / TipoIniciativa entre sus
         categorias, o con el TipoIniciativa del detalle distinto del Problem
     T5  catalogo de prefijos (dbo.CatPrefijoProblem), con o sin datos
     T6  resumen: por prefijo, el par dominante, su % y un veredicto

   Complementa a diag_admin_iniciativas_contrato.sql A1/A2 (mismos cruces, sin
   % ni dominancia). Correr completo en la VM y pegar las 6 salidas.
   ===================================================================================== */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#Ini') IS NOT NULL DROP TABLE #Ini;
IF OBJECT_ID('tempdb..#Cat') IS NOT NULL DROP TABLE #Cat;

-- Una fila por iniciativa vigente: su prefijo y su TipoIniciativa.
SELECT p.Codigo,
       Prefijo        = LTRIM(RTRIM(p.Prefijo)),
       TipoIniciativa = NULLIF(LTRIM(RTRIM(p.TipoIniciativa)), N'')
INTO #Ini
FROM dbo.Problem AS p
WHERE p.VigenteEnOrigen = 1;

-- Una fila por categoria vigente de esas iniciativas.
SELECT pc.Codigo, i.Prefijo,
       TipoIniciativaCat = NULLIF(LTRIM(RTRIM(pc.TipoIniciativa)), N''),
       TipoAgrupado      = NULLIF(LTRIM(RTRIM(pc.TipoAgrupado)), N'')
INTO #Cat
FROM dbo.ProblemCategoria AS pc
JOIN #Ini AS i ON i.Codigo = pc.Codigo
WHERE pc.VigenteEnOrigen = 1;

-- T1
SELECT T1 = 'Prefijo x TipoIniciativa (Problem)', Prefijo,
       TipoIniciativa = ISNULL(TipoIniciativa, N'(vacio)'),
       Iniciativas = COUNT(*),
       PctDelPrefijo = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY Prefijo) AS decimal(5, 1))
FROM #Ini
GROUP BY Prefijo, TipoIniciativa
ORDER BY Prefijo, Iniciativas DESC;

-- T2
SELECT T2 = 'Prefijo x TipoAgrupado (ProblemCategoria)', Prefijo,
       TipoAgrupado = ISNULL(TipoAgrupado, N'(vacio)'),
       Filas = COUNT(*),
       Iniciativas = COUNT(DISTINCT Codigo),
       PctDelPrefijo = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY Prefijo) AS decimal(5, 1))
FROM #Cat
GROUP BY Prefijo, TipoAgrupado
ORDER BY Prefijo, Filas DESC;

-- T3: el par por iniciativa. Si sus categorias traen mas de un TipoAgrupado
-- se marca '(varios)' (ver T4); sin categorias, '(sin categoria)'.
WITH Agr AS (
    SELECT Codigo,
           TipoAgrupado = CASE WHEN COUNT(DISTINCT ISNULL(TipoAgrupado, N'(vacio)')) > 1 THEN N'(varios)'
                               ELSE MAX(ISNULL(TipoAgrupado, N'(vacio)')) END
    FROM #Cat GROUP BY Codigo
), Par AS (
    SELECT i.Prefijo, TipoIniciativa = ISNULL(i.TipoIniciativa, N'(vacio)'),
           TipoAgrupado = ISNULL(a.TipoAgrupado, N'(sin categoria)')
    FROM #Ini AS i LEFT JOIN Agr AS a ON a.Codigo = i.Codigo
)
SELECT T3 = 'Prefijo x par (TipoIniciativa, TipoAgrupado)', Prefijo, TipoIniciativa, TipoAgrupado,
       Iniciativas = COUNT(*),
       PctDelPrefijo = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY Prefijo) AS decimal(5, 1)),
       ParesDelPrefijo = COUNT(*) OVER (PARTITION BY Prefijo)
FROM Par
GROUP BY Prefijo, TipoIniciativa, TipoAgrupado
ORDER BY Prefijo, Iniciativas DESC;

-- T4: iniciativas donde las categorias NO llevan todas el mismo tipo.
SELECT TOP (50) T4 = 'Tipos mezclados en una iniciativa', c.Prefijo, c.Codigo,
       TipoIniciativaProblem = MAX(i.TipoIniciativa),
       TiposAgrupado = COUNT(DISTINCT ISNULL(c.TipoAgrupado, N'(vacio)')),
       TiposIniciativaCat = COUNT(DISTINCT ISNULL(c.TipoIniciativaCat, N'(vacio)')),
       DetalleDistintoDelProblem = SUM(CASE WHEN ISNULL(c.TipoIniciativaCat, N'') <> ISNULL(i.TipoIniciativa, N'') THEN 1 ELSE 0 END),
       Categorias = COUNT(*)
FROM #Cat AS c JOIN #Ini AS i ON i.Codigo = c.Codigo
GROUP BY c.Prefijo, c.Codigo
HAVING COUNT(DISTINCT ISNULL(c.TipoAgrupado, N'(vacio)')) > 1
    OR COUNT(DISTINCT ISNULL(c.TipoIniciativaCat, N'(vacio)')) > 1
    OR SUM(CASE WHEN ISNULL(c.TipoIniciativaCat, N'') <> ISNULL(i.TipoIniciativa, N'') THEN 1 ELSE 0 END) > 0
ORDER BY c.Prefijo, c.Codigo;

SELECT T4b = 'Total iniciativas con tipos mezclados', Prefijo, Iniciativas = COUNT(*)
FROM (
    SELECT c.Prefijo, c.Codigo
    FROM #Cat AS c JOIN #Ini AS i ON i.Codigo = c.Codigo
    GROUP BY c.Prefijo, c.Codigo
    HAVING COUNT(DISTINCT ISNULL(c.TipoAgrupado, N'(vacio)')) > 1
        OR COUNT(DISTINCT ISNULL(c.TipoIniciativaCat, N'(vacio)')) > 1
        OR SUM(CASE WHEN ISNULL(c.TipoIniciativaCat, N'') <> ISNULL(i.TipoIniciativa, N'') THEN 1 ELSE 0 END) > 0
) AS x
GROUP BY Prefijo
ORDER BY Prefijo;

-- T5
SELECT T5 = 'CatPrefijoProblem', cp.Prefijo, cp.Descripcion, cp.ControlDeFecha,
       IniciativasVigentes = (SELECT COUNT(*) FROM #Ini AS i WHERE i.Prefijo = cp.Prefijo)
FROM dbo.CatPrefijoProblem AS cp
ORDER BY cp.Prefijo;

-- T6: veredicto por prefijo con el par dominante (sin contar vacios ni
-- '(varios)' / '(sin categoria)' como par valido).
WITH Agr AS (
    SELECT Codigo,
           TipoAgrupado = CASE WHEN COUNT(DISTINCT ISNULL(TipoAgrupado, N'(vacio)')) > 1 THEN N'(varios)'
                               ELSE MAX(ISNULL(TipoAgrupado, N'(vacio)')) END
    FROM #Cat GROUP BY Codigo
), Par AS (
    SELECT i.Prefijo, TipoIniciativa = ISNULL(i.TipoIniciativa, N'(vacio)'),
           TipoAgrupado = ISNULL(a.TipoAgrupado, N'(sin categoria)')
    FROM #Ini AS i LEFT JOIN Agr AS a ON a.Codigo = i.Codigo
), Cuenta AS (
    SELECT Prefijo, TipoIniciativa, TipoAgrupado, N = COUNT(*),
           Total = SUM(COUNT(*)) OVER (PARTITION BY Prefijo),
           Orden = ROW_NUMBER() OVER (PARTITION BY Prefijo ORDER BY
                     CASE WHEN TipoIniciativa = N'(vacio)' OR TipoAgrupado LIKE N'(%' THEN 1 ELSE 0 END, COUNT(*) DESC)
    FROM Par GROUP BY Prefijo, TipoIniciativa, TipoAgrupado
)
SELECT T6 = 'Veredicto por prefijo', Prefijo, TipoIniciativa, TipoAgrupado,
       Iniciativas = N, TotalPrefijo = Total,
       PctDominante = CAST(100.0 * N / Total AS decimal(5, 1)),
       Veredicto = CASE WHEN TipoIniciativa = N'(vacio)' OR TipoAgrupado LIKE N'(%' THEN 'SIN PAR VALIDO'
                        WHEN N = Total THEN 'UNICO'
                        WHEN 100.0 * N / Total >= 95 THEN 'DOMINANTE (>=95%)'
                        ELSE 'AMBIGUO' END
FROM Cuenta
WHERE Orden = 1
ORDER BY Prefijo;

DROP TABLE #Cat;
DROP TABLE #Ini;
