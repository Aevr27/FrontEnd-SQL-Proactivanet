/* =========================================================================
   sql/diag/diag_qare_tecnicos_prototipo.sql - Lee el prototipo de Daniela
   (usp_QARE_* y cualquier objeto de patrones) si existe en esta base.
   SOLO LECTURA.

   Las reglas de inválida, incompleta y patrón viven en ese código
   (sql/docs/PROPUESTA_qare_tecnicos.md, sección 9). Imprime cada cuerpo una
   fila por línea porque la cuadrícula de SSMS trunca OBJECT_DEFINITION.
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
