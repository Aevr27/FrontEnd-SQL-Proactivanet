/* =========================================================================
   sql/diag_concentracion_tickets.sql - Contrato REAL de los procedimientos
   de la pestaña "Concentracion de tickets".

   OBJETIVO
   Sacar de la base, sin suponer nada, lo que hace falta para construir la
   pestaña sobre los procedimientos que ya existen:
       dbo.usp_CorreoServicio_Pareto
       dbo.usp_CorreoServicio_TicketsCategoria
       dbo.usp_CorreoServicio_TicketsGrupo
     1. si existen, cuando se crearon y modificaron;
     2. su definicion completa;
     3. sus parametros (nombre, tipo, si tienen valor por omision);
     4. las columnas y tipos del primer result set;
     5. las tablas, vistas, funciones y procedimientos que leen (y, de esos,
        la definicion de las vistas y funciones);
     6. el catalogo dbo.CatServicioCategoria (Servicio -> PrefijoCategoria);
     7. los permisos EXECUTE de la cuenta que corre el script.

   ES DE SOLO LECTURA
   - No hay CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, MERGE, TRUNCATE,
     GRANT, REVOKE ni EXEC de ningun procedimiento de la base. Solo lee
     catalogos del sistema (sys.*), OBJECT_DEFINITION, sp_helptext y un
     SELECT a dbo.CatServicioCategoria (14 filas aprox.).
   - La seccion 2 marca cualquier linea de los tres procedimientos con
     INSERT/UPDATE/DELETE/MERGE/TRUNCATE, para que se vea si escriben (un
     INSERT a #temporal es normal y no toca tablas de la base).

   COMO CORRERLO (CMD, sin PowerShell)
       cd /d "<carpeta del repo>"
       sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -E -y 0 -i sql\diag_concentracion_tickets.sql -o diag_concentracion_salida.txt
   (-E usa la cuenta Windows; con usuario SQL cambia -E por -U <usuario> y
   sqlcmd pide la clave.) -y 0 evita que se recorten las definiciones.
   Pegar diag_concentracion_salida.txt completo. No va al repositorio.

   En SSMS: Results to Text (Ctrl+T), "Maximum number of characters
   displayed in each column" = 8192, F5.
   ========================================================================= */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

DECLARE @Objetos TABLE (Nombre SYSNAME PRIMARY KEY);
INSERT @Objetos (Nombre) VALUES
    (N'usp_CorreoServicio_Pareto'),
    (N'usp_CorreoServicio_TicketsCategoria'),
    (N'usp_CorreoServicio_TicketsGrupo');

PRINT '=== 0) Servidor, base y cuenta';
SELECT Servidor = @@SERVERNAME, Base = DB_NAME(), Cuenta = SUSER_SNAME(),
       Hora = CONVERT(VARCHAR(19), SYSDATETIME(), 120);

PRINT '=== 1) Existencia';
SELECT o.Nombre,
       Existe     = CASE WHEN p.object_id IS NULL THEN 'NO' ELSE 'SI' END,
       Tipo       = p.type_desc,
       Creado     = CONVERT(VARCHAR(19), p.create_date, 120),
       Modificado = CONVERT(VARCHAR(19), p.modify_date, 120)
FROM @Objetos AS o
LEFT JOIN sys.objects AS p ON p.object_id = OBJECT_ID(N'dbo.' + o.Nombre);

PRINT '=== 1b) Otros procedimientos usp_CorreoServicio_* (para comparar)';
SELECT Nombre = name, Creado = CONVERT(VARCHAR(19), create_date, 120),
       Modificado = CONVERT(VARCHAR(19), modify_date, 120)
FROM sys.procedures WHERE name LIKE N'usp[_]CorreoServicio[_]%' ORDER BY name;

PRINT '=== 2) Lineas que escriben (vacio = no escribe en tablas)';
DECLARE @n SYSNAME, @def NVARCHAR(MAX);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT Nombre FROM @Objetos WHERE OBJECT_ID(N'dbo.' + Nombre) IS NOT NULL ORDER BY Nombre;
OPEN c;
FETCH NEXT FROM c INTO @n;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @n));
    SELECT Procedimiento = @n, Linea = value
    FROM STRING_SPLIT(REPLACE(@def, CHAR(13), N''), CHAR(10))
    WHERE value LIKE N'%INSERT%' OR value LIKE N'%UPDATE%' OR value LIKE N'%DELETE%'
       OR value LIKE N'%MERGE%' OR value LIKE N'%TRUNCATE%';
    FETCH NEXT FROM c INTO @n;
END;
CLOSE c; DEALLOCATE c;

PRINT '=== 3) Parametros';
SELECT Procedimiento = OBJECT_NAME(p.object_id), Orden = p.parameter_id,
       Parametro = p.name, Tipo = TYPE_NAME(p.user_type_id),
       Largo = p.max_length, p.precision, p.scale,
       EsSalida = p.is_output, TieneDefault = p.has_default_value
FROM sys.parameters AS p
WHERE p.object_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos)
ORDER BY Procedimiento, Orden;

PRINT '=== 4) Primer result set (si falla por #temporales, error_message lo dice)';
SELECT Procedimiento = o.Nombre, r.column_ordinal, r.name, r.system_type_name,
       r.is_nullable, r.error_message
FROM @Objetos AS o
CROSS APPLY sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(N'dbo.' + o.Nombre), 0) AS r
WHERE OBJECT_ID(N'dbo.' + o.Nombre) IS NOT NULL
ORDER BY o.Nombre, r.column_ordinal;

PRINT '=== 5) Dependencias (lo que lee cada procedimiento)';
SELECT Procedimiento = OBJECT_NAME(d.referencing_id),
       Esquema = ISNULL(d.referenced_schema_name, 'dbo'),
       Objeto = d.referenced_entity_name,
       Tipo = ISNULL(o.type_desc, '(no resuelto / #temporal)')
FROM sys.sql_expression_dependencies AS d
LEFT JOIN sys.objects AS o ON o.object_id = d.referenced_id
WHERE d.referencing_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos)
ORDER BY Procedimiento, Objeto;

PRINT '=== 5b) Dependencias de segundo nivel (lo que leen esas vistas y funciones)';
;WITH n1 AS (
    SELECT DISTINCT d.referenced_id
    FROM sys.sql_expression_dependencies AS d
    WHERE d.referencing_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos)
      AND d.referenced_id IS NOT NULL
)
SELECT Desde = OBJECT_NAME(d.referencing_id), Objeto = d.referenced_entity_name,
       Tipo = ISNULL(o.type_desc, '(no resuelto)')
FROM sys.sql_expression_dependencies AS d
JOIN n1 ON n1.referenced_id = d.referencing_id
LEFT JOIN sys.objects AS o ON o.object_id = d.referenced_id
ORDER BY Desde, Objeto;

PRINT '=== 6) Catalogo dbo.CatServicioCategoria';
IF OBJECT_ID(N'dbo.CatServicioCategoria', 'U') IS NOT NULL
    SELECT Servicio, PrefijoCategoria, Nota FROM dbo.CatServicioCategoria ORDER BY Servicio, PrefijoCategoria;

PRINT '=== 7) Permisos EXECUTE de la cuenta que corre el script';
SELECT o.Nombre, PuedeEjecutar = HAS_PERMS_BY_NAME(N'dbo.' + o.Nombre, 'OBJECT', 'EXECUTE')
FROM @Objetos AS o;

PRINT '=== 8) Definiciones completas (procedimientos y, despues, las vistas y funciones que leen)';
DECLARE @obj NVARCHAR(300);
DECLARE d CURSOR LOCAL FAST_FORWARD FOR
    SELECT N'dbo.' + Nombre FROM @Objetos WHERE OBJECT_ID(N'dbo.' + Nombre) IS NOT NULL
    UNION
    SELECT QUOTENAME(OBJECT_SCHEMA_NAME(o.object_id)) + N'.' + QUOTENAME(o.name)
    FROM sys.sql_expression_dependencies AS dd
    JOIN sys.objects AS o ON o.object_id = dd.referenced_id
    WHERE dd.referencing_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos)
      AND o.type IN ('V', 'FN', 'IF', 'TF', 'P');
OPEN d;
FETCH NEXT FROM d INTO @obj;
WHILE @@FETCH_STATUS = 0
BEGIN
    PRINT '----- ' + @obj + ' -----';
    EXEC sys.sp_helptext @obj;
    FETCH NEXT FROM d INTO @obj;
END;
CLOSE d; DEALLOCATE d;

PRINT '=== Fin';
