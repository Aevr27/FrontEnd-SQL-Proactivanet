/* =========================================================================
   sql/diag/diag_qare_tecnicos_prototipo.sql - Lee el prototipo de Daniela
   (usp_QARE_* y cualquier objeto de patrones) si existe en esta base.
   SOLO LECTURA.

   Las reglas de inválida, incompleta y patrón viven en ese código
   (sql/docs/PROPUESTA_qare_tecnicos.md, sección 12). Imprime cada cuerpo una
   fila por línea porque la cuadrícula de SSMS trunca OBJECT_DEFINITION.

   Secciones 4-9 (2026-11-27): el diag de objetos encontró el prototipo en
   Tickets_Proactivanet (vw_QARE_CalidadCaptura y los catálogos
   CatQARE_RespuestaInvalida / CatQARE_PatronSolucion). Aquí se vuelca el
   contenido de los catálogos y se mide lo que clasifica la vista en la
   misma ventana que los demás diag (2026-10-29 a 2026-11-27).
   ========================================================================= */

SET NOCOUNT ON;

-- 1. Qué hay. Si no sale nada, el prototipo está en otra base.
SELECT Seccion = N'1. Objetos', Esquema = s.name, Objeto = o.name, o.type_desc, o.create_date, o.modify_date
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE (o.name LIKE N'%QARE[_]%' AND o.name NOT LIKE N'%CorreoQARE%')
   OR o.name LIKE N'%Patron%'
ORDER BY o.modify_date DESC;

-- 2. Cuerpo completo de los módulos encontrados (SP, funciones, vistas).
;WITH M AS (
    SELECT Objeto = s.name + N'.' + o.name,
           Def = REPLACE(OBJECT_DEFINITION(o.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM sys.objects AS o
    JOIN sys.schemas AS s ON s.schema_id = o.schema_id
    WHERE ((o.name LIKE N'%QARE[_]%' AND o.name NOT LIKE N'%CorreoQARE%') OR o.name LIKE N'%Patron%')
      AND OBJECT_DEFINITION(o.object_id) IS NOT NULL
), L AS (
    SELECT Objeto, Linea = 1, Texto = LEFT(Def, CHARINDEX(NCHAR(10), Def) - 1),
           Resto = STUFF(Def, 1, CHARINDEX(NCHAR(10), Def), N'')
    FROM M
    UNION ALL
    SELECT Objeto, Linea + 1, LEFT(Resto, CHARINDEX(NCHAR(10), Resto) - 1),
           STUFF(Resto, 1, CHARINDEX(NCHAR(10), Resto), N'')
    FROM L WHERE CHARINDEX(NCHAR(10), Resto) > 0
)
SELECT Seccion = N'2. Definicion', Objeto, Linea, Texto
FROM L
ORDER BY Objeto, Linea
OPTION (MAXRECURSION 0);

-- 3. Tablas encontradas: columnas y filas (un catálogo de patrones sería una de estas).
SELECT Seccion = N'3. Columnas de tablas', Tabla = s.name + N'.' + t.name, c.column_id, Columna = c.name,
       Tipo = TYPE_NAME(c.user_type_id), c.max_length,
       Filas = (SELECT SUM(p.rows) FROM sys.partitions AS p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1))
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
WHERE (t.name LIKE N'%QARE[_]%' AND t.name NOT LIKE N'%CorreoQARE%') OR t.name LIKE N'%Patron%'
ORDER BY Tabla, c.column_id;

DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';

-- 4. Catálogo de respuestas inválidas: la vista compara por igualdad exacta
--    después de UPPER(LTRIM(RTRIM())).
SELECT Seccion = N'4. CatQARE_RespuestaInvalida', *
FROM dbo.CatQARE_RespuestaInvalida
ORDER BY 2, 3;

-- 5. Catálogo de patrones y reglas CALIDAD. CALIDAD compara por igualdad
--    exacta; PATRON_SOLUCION por LIKE '%frase%'; gana Orden, luego la frase
--    más larga.
SELECT Seccion = N'5. CatQARE_PatronSolucion', *
FROM dbo.CatQARE_PatronSolucion
ORDER BY TipoClasificacion, Orden, IdRegla;

SELECT Seccion = N'5b. Reglas por patron', TipoClasificacion, Patron, Activas = SUM(CASE WHEN Activo = 1 THEN 1 ELSE 0 END), Total = COUNT(*)
FROM dbo.CatQARE_PatronSolucion
GROUP BY TipoClasificacion, Patron
ORDER BY TipoClasificacion, Patron;

-- 6. La vista hace LEFT JOIN al catálogo de inválidas: un valor repetido
--    (tras UPPER/TRIM) duplicaría el ticket en todos los SP.
SELECT Seccion = N'6a. Valores invalidos repetidos', Valor = UPPER(LTRIM(RTRIM(Valor))), Filas = COUNT(*)
FROM dbo.CatQARE_RespuestaInvalida
WHERE Campo = 'QARe_DescripcionSolucion' AND Activo = 1
GROUP BY UPPER(LTRIM(RTRIM(Valor)))
HAVING COUNT(*) > 1;

SELECT Seccion = N'6b. Filas de la vista vs tickets', Filas = COUNT(*), Tickets = COUNT(DISTINCT CodigoTicket)
FROM dbo.vw_QARE_CalidadCaptura
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

-- 7. Lo que clasifica la vista en la ventana (comparable con diag_qare_kpis 5).
SELECT Seccion = N'7a. Estado x tipo', EstadoDescripcion, TipoClasificacionRespuesta, Tickets = COUNT(DISTINCT CodigoTicket)
FROM dbo.vw_QARE_CalidadCaptura
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY EstadoDescripcion, TipoClasificacionRespuesta
ORDER BY EstadoDescripcion, TipoClasificacionRespuesta;

SELECT Seccion = N'7b. ClasificacionRespuesta', TipoClasificacionRespuesta, ClasificacionRespuesta, Tickets = COUNT(DISTINCT CodigoTicket)
FROM dbo.vw_QARE_CalidadCaptura
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY TipoClasificacionRespuesta, ClasificacionRespuesta
ORDER BY TipoClasificacionRespuesta, Tickets DESC;

-- 8. Textos más repetidos por resultado: qué deja pasar o atrapa cada regla.
;WITH T AS (
    SELECT Resultado = ISNULL(TipoClasificacionRespuesta, EstadoDescripcion),
           Texto = LEFT(UPPER(LTRIM(RTRIM(QARe_DescripcionSolucion))), 120)
    FROM dbo.vw_QARE_CalidadCaptura
    WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
      AND EstadoDescripcion <> 'SIN INFORMACION QARE'
), R AS (
    SELECT Resultado, Texto, Tickets = COUNT(*),
           Rk = ROW_NUMBER() OVER (PARTITION BY Resultado ORDER BY COUNT(*) DESC, Texto)
    FROM T GROUP BY Resultado, Texto
)
SELECT Seccion = N'8. Textos por resultado', Resultado, Texto, Tickets
FROM R WHERE Rk <= 40
ORDER BY Resultado, Rk;

-- 9. Caracteres invisibles (espacio de ancho cero, BOM): la igualdad exacta
--    del catálogo no los quita. motor.js sí.
SELECT Seccion = N'9. Textos con caracteres invisibles',
       Tickets = COUNT(*),
       ConAnchoCero = SUM(CASE WHEN QARe_DescripcionSolucion LIKE N'%[' + NCHAR(8203) + NCHAR(8204) + NCHAR(8205) + NCHAR(8206) + NCHAR(8207) + NCHAR(65279) + N']%' THEN 1 ELSE 0 END),
       ConNBSP = SUM(CASE WHEN CHARINDEX(NCHAR(160), QARe_DescripcionSolucion) > 0 THEN 1 ELSE 0 END),
       ConSalto = SUM(CASE WHEN QARe_DescripcionSolucion LIKE N'%[' + NCHAR(10) + NCHAR(13) + N']%' THEN 1 ELSE 0 END)
FROM dbo.vw_QARE_CalidadCaptura
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
  AND QARe_DescripcionSolucion IS NOT NULL;
