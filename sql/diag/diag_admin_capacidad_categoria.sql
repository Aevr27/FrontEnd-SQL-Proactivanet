/* =====================================================================
   diag_admin_capacidad_categoria.sql

   SOLO LECTURA (SELECT y tablas temporales #). No crea, cambia ni borra
   nada en la base. Correr en la VM contra Tickets_Proactivanet y pasar la
   salida completa.

   Pregunta: ¿la Categoria que elige Nueva solicitud (CategoriaN2 de
   dbo.CatCategoriaDueno, la que manda admin/iniciativas.js como
   `categoria`) es la MISMA granularidad que dbo.ProblemCategoria.Categoria
   (ruta completa), que es contra la que se suma la capacidad?

   Regla de consumo que usa hoy el sitio (ExperienciaQueries
   .ConsumeCapacidad, la de ini_total de Experiencia):
     vw_ProblemCategoria.VigenteEnOrigen = 1
     Estado en En Análisis / En Solución / En Monitoreo (sin acentos ni
       mayusculas)
     TipoAgrupado en Problem / SorIA / Adopcion / Mejora
   Una fila por (Codigo, Categoria): la vista abanica por C1.

   Comparacion actual (CapacidadCategoria.Para):
     exacta        Categoria = N2               -> suma
     descendiente  Categoria = N2 + '/...'      -> NO DETERMINABLE (rechaza)
     ancestro      N2 = Categoria + '/...'      -> NO DETERMINABLE (rechaza)

   G1  profundidad de las rutas de ProblemCategoria (todas / que consumen)
   G2  profundidad de CategoriaN2 vigentes (lo que ofrece el selector)
   G3  por N2: consumo exacto vs en subcategorias vs en ancestros
   G4  resumen: cuantas N2 serian determinables hoy
   G5  ejemplos de iniciativas que consumen en una subcategoria de una N2
   G6  dbo.Categorias (catalogo de rutas completas), si existe
   ===================================================================== */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#R') IS NOT NULL DROP TABLE #R;
IF OBJECT_ID('tempdb..#N') IS NOT NULL DROP TABLE #N;

/* Rutas de iniciativas, una por (Codigo, Categoria). */
SELECT Codigo, Ruta, Estado, TipoAgrupado, PctDisminucion,
       Consume = CASE WHEN LTRIM(RTRIM(Estado)) COLLATE Latin1_General_CI_AI
                           IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
                       AND LTRIM(RTRIM(TipoAgrupado)) COLLATE Latin1_General_CI_AI
                           IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora')
                      THEN 1 ELSE 0 END,
       Nivel = LEN(Ruta) - LEN(REPLACE(Ruta, N'/', N''))
INTO #R
FROM (SELECT DISTINCT v.Codigo,
             Ruta = LTRIM(RTRIM(REPLACE(v.Categoria, NCHAR(160), N' '))),
             v.Estado, v.TipoAgrupado, v.PctDisminucion
      FROM dbo.vw_ProblemCategoria AS v
      WHERE v.VigenteEnOrigen = 1) AS q;

/* N2 vigentes del catalogo de dueños (lo que ofrece el selector). */
SELECT DISTINCT N2 = LTRIM(RTRIM(REPLACE(CategoriaN2, NCHAR(160), N' ')))
INTO #N
FROM dbo.CatCategoriaDueno
WHERE VigenteEnOrigen = 1 AND CategoriaN2 IS NOT NULL;

/* G1 */
SELECT G1 = 'Profundidad ProblemCategoria.Categoria (segmentos "/")',
       Nivel, Filas = COUNT(*), QueConsumen = SUM(Consume)
FROM #R GROUP BY Nivel ORDER BY Nivel;

/* G2 */
SELECT G2 = 'Profundidad CategoriaN2 vigentes',
       Nivel = LEN(N2) - LEN(REPLACE(N2, N'/', N'')), N2s = COUNT(*)
FROM #N GROUP BY LEN(N2) - LEN(REPLACE(N2, N'/', N'')) ORDER BY 2;

/* G3 */
IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;
SELECT n.N2,
       Exactas      = SUM(CASE WHEN r.Ruta = n.N2 THEN 1 ELSE 0 END),
       PctExacto    = SUM(CASE WHEN r.Ruta = n.N2 THEN r.PctDisminucion ELSE 0 END),
       EnSubcats    = SUM(CASE WHEN r.Ruta <> n.N2 AND LEFT(r.Ruta, LEN(n.N2)) = n.N2
                                AND LTRIM(SUBSTRING(r.Ruta, LEN(n.N2) + 1, 4000)) LIKE N'/%' THEN 1 ELSE 0 END),
       PctSubcats   = SUM(CASE WHEN r.Ruta <> n.N2 AND LEFT(r.Ruta, LEN(n.N2)) = n.N2
                                AND LTRIM(SUBSTRING(r.Ruta, LEN(n.N2) + 1, 4000)) LIKE N'/%' THEN r.PctDisminucion ELSE 0 END),
       EnAncestros  = SUM(CASE WHEN r.Ruta <> n.N2 AND LEFT(n.N2, LEN(r.Ruta)) = r.Ruta
                                AND LTRIM(SUBSTRING(n.N2, LEN(r.Ruta) + 1, 4000)) LIKE N'/%' THEN 1 ELSE 0 END)
INTO #C
FROM #N AS n
LEFT JOIN #R AS r ON r.Consume = 1
GROUP BY n.N2;

SELECT TOP 40 G3 = 'N2 con consumo (top 40 por subcategorias)', *
FROM #C WHERE Exactas + EnSubcats + EnAncestros > 0
ORDER BY EnSubcats DESC, Exactas DESC, N2;

/* G4 */
SELECT G4 = 'Resumen con la regla actual',
       N2Vigentes        = COUNT(*),
       SinConsumo        = SUM(CASE WHEN Exactas + EnSubcats + EnAncestros = 0 THEN 1 ELSE 0 END),
       SoloExactas       = SUM(CASE WHEN Exactas > 0 AND EnSubcats + EnAncestros = 0 THEN 1 ELSE 0 END),
       NoDeterminables   = SUM(CASE WHEN EnSubcats + EnAncestros > 0 THEN 1 ELSE 0 END),
       ExactasYSubcats   = SUM(CASE WHEN Exactas > 0 AND EnSubcats > 0 THEN 1 ELSE 0 END),
       ExactoPasaDe100   = SUM(CASE WHEN PctExacto > 1 THEN 1 ELSE 0 END)
FROM #C;

SELECT G4b = 'Rutas que consumen y NO caen en ninguna N2 vigente (ni exacta ni debajo)',
       Filas = COUNT(*)
FROM #R AS r
WHERE r.Consume = 1
  AND NOT EXISTS (SELECT 1 FROM #N AS n
                  WHERE r.Ruta = n.N2
                     OR (LEFT(r.Ruta, LEN(n.N2)) = n.N2
                         AND LTRIM(SUBSTRING(r.Ruta, LEN(n.N2) + 1, 4000)) LIKE N'/%'));

/* G5 */
SELECT TOP 30 G5 = 'Ejemplos: consumo en subcategoria de una N2', n.N2, r.Ruta, r.Codigo,
       r.Estado, r.TipoAgrupado, r.PctDisminucion
FROM #N AS n
JOIN #R AS r ON r.Consume = 1 AND r.Ruta <> n.N2 AND LEFT(r.Ruta, LEN(n.N2)) = n.N2
            AND LTRIM(SUBSTRING(r.Ruta, LEN(n.N2) + 1, 4000)) LIKE N'/%'
ORDER BY n.N2, r.Ruta, r.Codigo;

/* G6 */
IF OBJECT_ID('dbo.Categorias', 'U') IS NOT NULL OR OBJECT_ID('dbo.Categorias', 'V') IS NOT NULL
BEGIN
    EXEC (N'
    SELECT G6 = ''dbo.Categorias: profundidad'', Nivel = LEN(RutaCompleta) - LEN(REPLACE(RutaCompleta, N''/'', N'''')),
           Rutas = COUNT(*)
    FROM dbo.Categorias GROUP BY LEN(RutaCompleta) - LEN(REPLACE(RutaCompleta, N''/'', N'''')) ORDER BY 2;

    SELECT G6b = ''Rutas de iniciativas presentes en dbo.Categorias'',
           Rutas = COUNT(DISTINCT r.Ruta),
           EnCatalogo = COUNT(DISTINCT CASE WHEN c.RutaCompleta IS NOT NULL THEN r.Ruta END)
    FROM #R AS r LEFT JOIN dbo.Categorias AS c ON c.RutaCompleta = r.Ruta;');
END
ELSE
    SELECT G6 = 'dbo.Categorias no existe';
