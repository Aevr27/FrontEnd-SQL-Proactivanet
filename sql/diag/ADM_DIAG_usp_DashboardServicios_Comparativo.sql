/* =========================================================================
   sql/diag/ADM_DIAG_usp_DashboardServicios_Comparativo.sql
   Diagnostico de SOLO LECTURA: existe dbo.usp_DashboardServicios_Comparativo,
   que hace, de que depende y que otros objetos podrian dar "tickets actuales
   contra anteriores por servicio" para la grafica "Servicios con mayor
   cambio de tickets" (Vista general de servicios).

   CONTEXTO VERIFICADO EN EL REPO (2026-11-18)
   - El nombre no aparece en ningun archivo del repositorio: se busca solo en
     la base, sin suponer que existe.
   - La pestana hoy lee dbo.vw_ServicioTickets (+ dbo.CatServicioCorreo,
     dbo.CatCategoriaDueno, dbo.CatPersona, dbo.fn_CategoriaC1C2) desde
     App_Code/ConcentracionQueries.cs. No calcula periodo anterior, diferencia
     ni variacion. Esas fuentes se describen en la seccion F como referencia.

   ES DE SOLO LECTURA
   - Sin CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, MERGE, TRUNCATE, GRANT,
     REVOKE, ni tablas temporales o variables de tabla. Sin SET de
     configuracion del servidor.
   - NO ejecuta el procedimiento investigado. Solo lee catalogos (sys.*),
     OBJECT_DEFINITION y funciones de metadatos. La unica ejecucion dinamica
     es la seccion A2: sp_executesql con un SELECT a <base>.sys.objects de
     cada base accesible, para saber si el nombre vive en otra base.
   - No lee filas de negocio.
   - Cada seccion es un lote propio (GO) con TRY/CATCH donde puede fallar por
     permisos: si una falla, lo dice y las demas siguen.

   COMO CORRERLO
   Opcion 1, sqlcmd desde CMD (recomendada: texto completo, sin recortes):
       cd /d "<carpeta del repo>"
       sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -E -y 0 -i sql\diag\ADM_DIAG_usp_DashboardServicios_Comparativo.sql -o diag_comparativo_salida.txt
   (-E = cuenta Windows; con usuario SQL cambia -E por -U <usuario>.)
   Opcion 2, SSMS: Results to Text (Ctrl+T); Tools > Options > Query Results >
   SQL Server > Results to Text > "Maximum number of characters displayed in
   each column" = 8192; F5. Copiar la pestana Messages + Results completa.
   La salida no va al repositorio.
   ========================================================================= */
USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
PRINT '=== 0) Contexto: servidor, base, cuenta, version';
SELECT Servidor   = @@SERVERNAME,
       Base       = DB_NAME(),
       Login      = SUSER_SNAME(),
       Usuario    = USER_NAME(),
       Hora       = CONVERT(VARCHAR(19), SYSDATETIME(), 120),
       Version    = CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(30)),
       Edicion    = CAST(SERVERPROPERTY('Edition') AS VARCHAR(60)),
       NivelCompat = (SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID());

PRINT '=== 0b) Permisos de la cuenta en esta base (1 = si)';
SELECT VerDefinicionBase   = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION'),
       VerEstadoBase       = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DATABASE STATE'),
       EsDbOwner           = IS_MEMBER('db_owner'),
       EsDbDatareader      = IS_MEMBER('db_datareader');
GO

/* -------------------------------------------------------------------------
   A) Existencia. Por nombre exacto en CUALQUIER esquema (no solo dbo), mas
      sinonimos con ese nombre o que apunten a el.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== A1) Existencia en esta base (vacio = no existe o la cuenta no lo ve)';
SELECT Esquema    = SCHEMA_NAME(o.schema_id),
       Nombre     = o.name,
       Tipo       = o.type,
       TipoDesc   = o.type_desc,
       ObjectId   = o.object_id,
       Creado     = CONVERT(VARCHAR(19), o.create_date, 120),
       Modificado = CONVERT(VARCHAR(19), o.modify_date, 120),
       EsMsShipped = o.is_ms_shipped
FROM sys.objects AS o
WHERE o.name = N'usp_DashboardServicios_Comparativo';

SELECT ExisteDboExacto = CASE WHEN OBJECT_ID(N'dbo.usp_DashboardServicios_Comparativo') IS NULL
                              THEN 'NO' ELSE 'SI' END;

PRINT '=== A1b) Sinonimos con ese nombre o que apunten a el';
SELECT Esquema = SCHEMA_NAME(s.schema_id), Sinonimo = s.name, ApuntaA = s.base_object_name
FROM sys.synonyms AS s
WHERE s.name LIKE N'%DashboardServicios%'
   OR s.base_object_name LIKE N'%usp[_]DashboardServicios[_]Comparativo%';
GO

SET NOCOUNT ON;
PRINT '=== A2) El mismo nombre en OTRAS bases del servidor (solo bases accesibles por la cuenta)';
DECLARE @base SYSNAME, @sql NVARCHAR(MAX);
DECLARE bases CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.databases
    WHERE state_desc = 'ONLINE' AND HAS_DBACCESS(name) = 1 AND database_id <> DB_ID()
    ORDER BY name;
OPEN bases;
FETCH NEXT FROM bases INTO @base;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'IF EXISTS (SELECT 1 FROM ' + QUOTENAME(@base) + N'.sys.objects
                            WHERE name LIKE N''%DashboardServicios%'')
                 SELECT Base = @b, Esquema = s.name, Nombre = o.name, TipoDesc = o.type_desc,
                        Creado = CONVERT(VARCHAR(19), o.create_date, 120),
                        Modificado = CONVERT(VARCHAR(19), o.modify_date, 120)
                 FROM ' + QUOTENAME(@base) + N'.sys.objects AS o
                 JOIN ' + QUOTENAME(@base) + N'.sys.schemas AS s ON s.schema_id = o.schema_id
                 WHERE o.name LIKE N''%DashboardServicios%'';';
    BEGIN TRY
        EXEC sys.sp_executesql @sql, N'@b SYSNAME', @b = @base;
    END TRY
    BEGIN CATCH
        PRINT '   [' + @base + '] no se pudo leer: ' + ERROR_MESSAGE();
    END CATCH;
    FETCH NEXT FROM bases INTO @base;
END;
CLOSE bases; DEALLOCATE bases;
PRINT '   (fin de A2: solo salen bases con coincidencias)';
GO

/* -------------------------------------------------------------------------
   B) Definicion completa. NULL = cifrado, o la cuenta no tiene VIEW
      DEFINITION. Se muestra linea por linea para que no la recorte el
      limite de caracteres por columna.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== B1) Estado de la definicion';
SELECT Esquema       = SCHEMA_NAME(o.schema_id),
       Nombre        = o.name,
       Cifrado       = OBJECTPROPERTY(o.object_id, 'IsEncrypted'),
       PuedeVerDef   = HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
                                         'OBJECT', 'VIEW DEFINITION'),
       Disponible    = CASE WHEN OBJECT_DEFINITION(o.object_id) IS NULL THEN 'NO' ELSE 'SI' END,
       Caracteres    = LEN(OBJECT_DEFINITION(o.object_id)),
       AnsiNulls     = m.uses_ansi_nulls,
       QuotedIdent   = m.uses_quoted_identifier,
       EjecutaComo   = CASE WHEN m.execute_as_principal_id IS NULL THEN 'CALLER/OWNER (por omision)'
                            ELSE USER_NAME(m.execute_as_principal_id) END
FROM sys.objects AS o
LEFT JOIN sys.sql_modules AS m ON m.object_id = o.object_id
WHERE o.name = N'usp_DashboardServicios_Comparativo';

PRINT '=== B2) Definicion, linea por linea';
;WITH src AS (
    SELECT Objeto = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
           def    = REPLACE(OBJECT_DEFINITION(o.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM sys.objects AS o
    WHERE o.name = N'usp_DashboardServicios_Comparativo'
      AND OBJECT_DEFINITION(o.object_id) IS NOT NULL
), lin AS (
    SELECT Objeto, n = 1, ini = CAST(1 AS BIGINT), fin = CAST(CHARINDEX(NCHAR(10), def) AS BIGINT), def
    FROM src
    UNION ALL
    SELECT Objeto, n + 1, fin + 1, CAST(CHARINDEX(NCHAR(10), def, fin + 1) AS BIGINT), def
    FROM lin
    WHERE CHARINDEX(NCHAR(10), def, fin + 1) > 0
)
SELECT Objeto, Linea = n, Texto = SUBSTRING(def, ini, fin - ini)
FROM lin
ORDER BY Objeto, n
OPTION (MAXRECURSION 0);

PRINT '=== B3) Lineas con escritura o SQL dinamico (vacio = no escribe ni arma SQL dinamico)';
PRINT '        INSERT/UPDATE a #temporal o @tabla es normal y no toca tablas de la base.';
;WITH src AS (
    SELECT Objeto = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
           def    = REPLACE(OBJECT_DEFINITION(o.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM sys.objects AS o
    WHERE o.name = N'usp_DashboardServicios_Comparativo'
      AND OBJECT_DEFINITION(o.object_id) IS NOT NULL
), lin AS (
    SELECT Objeto, n = 1, ini = CAST(1 AS BIGINT), fin = CAST(CHARINDEX(NCHAR(10), def) AS BIGINT), def
    FROM src
    UNION ALL
    SELECT Objeto, n + 1, fin + 1, CAST(CHARINDEX(NCHAR(10), def, fin + 1) AS BIGINT), def
    FROM lin
    WHERE CHARINDEX(NCHAR(10), def, fin + 1) > 0
)
SELECT Objeto, Linea = n, Texto = SUBSTRING(def, ini, fin - ini)
FROM lin
WHERE SUBSTRING(def, ini, fin - ini) LIKE N'%INSERT%'
   OR SUBSTRING(def, ini, fin - ini) LIKE N'%UPDATE%'
   OR SUBSTRING(def, ini, fin - ini) LIKE N'%DELETE%'
   OR SUBSTRING(def, ini, fin - ini) LIKE N'%MERGE%'
   OR SUBSTRING(def, ini, fin - ini) LIKE N'%TRUNCATE%'
   OR SUBSTRING(def, ini, fin - ini) LIKE N'%EXEC%'
   OR SUBSTRING(def, ini, fin - ini) LIKE N'%sp[_]executesql%'
ORDER BY Objeto, n
OPTION (MAXRECURSION 0);
GO

/* -------------------------------------------------------------------------
   C) Parametros. sys.parameters.has_default_value solo es confiable para
      CLR; en T-SQL el valor por omision solo esta en el texto, asi que
      DeclaracionEnTexto muestra la linea donde aparece el parametro por
      primera vez (heuristica: confirmar contra B2).
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== C) Parametros (vacio = sin parametros, o el procedimiento no existe)';
SELECT Procedimiento = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
       Orden         = p.parameter_id,
       Parametro     = p.name,
       Tipo          = TYPE_NAME(p.user_type_id),
       TipoBase      = TYPE_NAME(p.system_type_id),
       LargoBytes    = p.max_length,          -- -1 = MAX; NVARCHAR: bytes = 2 x caracteres
       Precision     = p.precision,
       Escala        = p.scale,
       EsOutput      = p.is_output,
       EsReadOnly    = p.is_readonly,         -- 1 = parametro tabla (TVP)
       TieneDefaultCatalogo = p.has_default_value,
       DeclaracionEnTexto =
           CASE WHEN OBJECT_DEFINITION(o.object_id) IS NULL THEN '(definicion no disponible)'
                WHEN CHARINDEX(p.name, OBJECT_DEFINITION(o.object_id)) = 0 THEN '(no encontrado)'
                ELSE LEFT(
                    SUBSTRING(OBJECT_DEFINITION(o.object_id), CHARINDEX(p.name, OBJECT_DEFINITION(o.object_id)), 300),
                    CHARINDEX(NCHAR(10),
                        SUBSTRING(OBJECT_DEFINITION(o.object_id), CHARINDEX(p.name, OBJECT_DEFINITION(o.object_id)), 300)
                        + NCHAR(10)) - 1)
           END
FROM sys.objects AS o
JOIN sys.parameters AS p ON p.object_id = o.object_id
WHERE o.name = N'usp_DashboardServicios_Comparativo'
  AND p.parameter_id > 0
ORDER BY Procedimiento, Orden;

PRINT '=== C2) Forma del primer result set (no ejecuta el procedimiento; error_message explica si no se pudo deducir)';
BEGIN TRY
    SELECT Procedimiento = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
           r.column_ordinal, r.name, r.system_type_name, r.is_nullable,
           r.error_number, r.error_message
    FROM sys.objects AS o
    CROSS APPLY sys.dm_exec_describe_first_result_set_for_object(o.object_id, 0) AS r
    WHERE o.name = N'usp_DashboardServicios_Comparativo'
    ORDER BY Procedimiento, r.column_ordinal;
END TRY
BEGIN CATCH
    PRINT '   C2 no disponible: ' + ERROR_MESSAGE();
END CATCH;
GO

/* -------------------------------------------------------------------------
   D) Dependencias.
      D1 sys.sql_expression_dependencies: incluye las no resueltas
         (ReferencedId NULL), las de otra base y las ambiguas.
      D2 sys.dm_sql_referenced_entities: resuelve hasta columna; falla si
         el procedimiento referencia algo inexistente (ese error tambien es
         un hallazgo).
      D3 segundo nivel: lo que leen las vistas y funciones de D1.
      D4 quien llama o referencia al procedimiento.
      Lo que se arma con SQL dinamico NO aparece en ninguna: ver B3.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== D1) Objetos referenciados (catalogo de dependencias)';
SELECT Procedimiento   = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
       BaseReferida    = d.referenced_database_name,
       EsquemaReferido = d.referenced_schema_name,
       ObjetoReferido  = d.referenced_entity_name,
       ReferencedId    = d.referenced_id,
       TipoReferido    = COALESCE(r.type_desc,
                                  CASE WHEN d.referenced_database_name IS NOT NULL THEN '(otra base: no se resuelve aqui)'
                                       WHEN d.referenced_entity_name LIKE N'#%' THEN '(#temporal)'
                                       ELSE '(NO RESUELTO: no existe o la cuenta no lo ve)' END),
       EsAmbiguo       = d.is_ambiguous,
       DependeDeEsquema = d.is_schema_bound_reference,
       PorLlamada      = d.is_caller_dependent
FROM sys.objects AS o
JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = o.object_id
LEFT JOIN sys.objects AS r ON r.object_id = d.referenced_id
WHERE o.name = N'usp_DashboardServicios_Comparativo'
ORDER BY Procedimiento, TipoReferido, ObjetoReferido;
GO

SET NOCOUNT ON;
PRINT '=== D2) Entidades y columnas referenciadas (resolucion del motor)';
DECLARE @obj NVARCHAR(600);
DECLARE objs CURSOR LOCAL FAST_FORWARD FOR
    SELECT QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name)
    FROM sys.objects WHERE name = N'usp_DashboardServicios_Comparativo';
OPEN objs;
FETCH NEXT FROM objs INTO @obj;
IF @@FETCH_STATUS <> 0 PRINT '   (no existe en esta base: D2 se omite)';
WHILE @@FETCH_STATUS = 0
BEGIN
    BEGIN TRY
        SELECT Procedimiento = @obj,
               EsquemaReferido = e.referenced_schema_name,
               ObjetoReferido  = e.referenced_entity_name,
               Columna         = e.referenced_minor_name,
               Clase           = e.referenced_class_desc,
               SeSelecciona    = e.is_selected,
               SeActualiza     = e.is_updated,
               TodasColumnas   = e.is_select_all
        FROM sys.dm_sql_referenced_entities(@obj, 'OBJECT') AS e
        ORDER BY ObjetoReferido, Columna;
    END TRY
    BEGIN CATCH
        PRINT '   ' + @obj + ' no se pudo resolver (error ' + CAST(ERROR_NUMBER() AS VARCHAR(10)) + '): ' + ERROR_MESSAGE();
    END CATCH;
    FETCH NEXT FROM objs INTO @obj;
END;
CLOSE objs; DEALLOCATE objs;
GO

SET NOCOUNT ON;
PRINT '=== D3) Segundo nivel: lo que leen las vistas y funciones que usa el procedimiento';
;WITH n1 AS (
    SELECT DISTINCT d.referenced_id
    FROM sys.objects AS o
    JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = o.object_id
    WHERE o.name = N'usp_DashboardServicios_Comparativo'
      AND d.referenced_id IS NOT NULL
)
SELECT Desde          = QUOTENAME(OBJECT_SCHEMA_NAME(d.referencing_id)) + N'.' + QUOTENAME(OBJECT_NAME(d.referencing_id)),
       BaseReferida   = d.referenced_database_name,
       ObjetoReferido = ISNULL(d.referenced_schema_name + N'.', N'') + d.referenced_entity_name,
       TipoReferido   = ISNULL(r.type_desc, '(no resuelto / otra base)')
FROM sys.sql_expression_dependencies AS d
JOIN n1 ON n1.referenced_id = d.referencing_id
LEFT JOIN sys.objects AS r ON r.object_id = d.referenced_id
ORDER BY Desde, ObjetoReferido;

PRINT '=== D4) Quien referencia al procedimiento (otros procedimientos, vistas, jobs no incluidos)';
SELECT Referenciador = QUOTENAME(OBJECT_SCHEMA_NAME(d.referencing_id)) + N'.' + QUOTENAME(OBJECT_NAME(d.referencing_id)),
       Tipo          = o.type_desc
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
WHERE d.referenced_entity_name = N'usp_DashboardServicios_Comparativo';
GO

/* -------------------------------------------------------------------------
   E) Objetos relacionados por NOMBRE o por TEXTO. Que aparezcan aqui no
      significa que sirvan: E3 da su definicion para revisarla.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== E1) Por nombre (procedimientos, vistas, funciones, tablas)';
SELECT Esquema    = SCHEMA_NAME(o.schema_id),
       Nombre     = o.name,
       TipoDesc   = o.type_desc,
       Creado     = CONVERT(VARCHAR(19), o.create_date, 120),
       Modificado = CONVERT(VARCHAR(19), o.modify_date, 120),
       Patron     = CASE WHEN o.name LIKE N'%DashboardServ%'   THEN 'DashboardServ'
                         WHEN o.name LIKE N'%Comparativ%'      THEN 'Comparativ'
                         WHEN o.name LIKE N'%Concentraci%'     THEN 'Concentracion'
                         WHEN o.name LIKE N'%ServicioTicket%'  THEN 'ServicioTicket'
                         WHEN o.name LIKE N'%CorreoServicio%'  THEN 'CorreoServicio'
                         WHEN o.name LIKE N'%Anterior%'        THEN 'Anterior'
                         WHEN o.name LIKE N'%Variacion%'       THEN 'Variacion'
                         WHEN o.name LIKE N'%Tendencia%'       THEN 'Tendencia'
                    END
FROM sys.objects AS o
WHERE o.type IN ('P', 'V', 'FN', 'IF', 'TF', 'U', 'SN')
  AND o.is_ms_shipped = 0
  AND (   o.name LIKE N'%DashboardServ%'
       OR o.name LIKE N'%Comparativ%'
       OR o.name LIKE N'%Concentraci%'
       OR o.name LIKE N'%ServicioTicket%'
       OR o.name LIKE N'%CorreoServicio%'
       OR o.name LIKE N'%Anterior%'
       OR o.name LIKE N'%Variacion%'
       OR o.name LIKE N'%Tendencia%')
ORDER BY Patron, TipoDesc, Nombre;

PRINT '=== E2) Por texto de su definicion (modulos que hablan de actual/anterior o comparativo)';
SELECT Esquema    = SCHEMA_NAME(o.schema_id),
       Nombre     = o.name,
       TipoDesc   = o.type_desc,
       Modificado = CONVERT(VARCHAR(19), o.modify_date, 120),
       TicketsActual    = CASE WHEN m.definition LIKE N'%TicketsActual%'    THEN 1 ELSE 0 END,
       TicketsAnterior  = CASE WHEN m.definition LIKE N'%TicketsAnterior%'  THEN 1 ELSE 0 END,
       PeriodoAnterior  = CASE WHEN m.definition LIKE N'%PeriodoAnterior%'  THEN 1 ELSE 0 END,
       MesAnterior      = CASE WHEN m.definition LIKE N'%MesAnterior%'      THEN 1 ELSE 0 END,
       Comparativo      = CASE WHEN m.definition LIKE N'%Comparativ%'       THEN 1 ELSE 0 END,
       DashboardServ    = CASE WHEN m.definition LIKE N'%DashboardServ%'    THEN 1 ELSE 0 END,
       ServicioTickets  = CASE WHEN m.definition LIKE N'%vw[_]ServicioTickets%' THEN 1 ELSE 0 END
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE o.is_ms_shipped = 0
  AND (   m.definition LIKE N'%TicketsActual%'
       OR m.definition LIKE N'%TicketsAnterior%'
       OR m.definition LIKE N'%PeriodoAnterior%'
       OR m.definition LIKE N'%MesAnterior%'
       OR m.definition LIKE N'%Comparativ%'
       OR m.definition LIKE N'%DashboardServ%'
       OR m.definition LIKE N'%vw[_]ServicioTickets%')
ORDER BY TipoDesc, Nombre;
GO

SET NOCOUNT ON;
PRINT '=== E3) Definiciones de los modulos de E1 y E2 (y de las vistas/funciones de D1), linea por linea';
;WITH candidatos AS (
    SELECT o.object_id
    FROM sys.objects AS o
    WHERE o.type IN ('P', 'V', 'FN', 'IF', 'TF') AND o.is_ms_shipped = 0
      AND (   o.name LIKE N'%DashboardServ%' OR o.name LIKE N'%Comparativ%'
           OR o.name LIKE N'%Concentraci%'   OR o.name LIKE N'%ServicioTicket%'
           OR o.name LIKE N'%CorreoServicio%' OR o.name LIKE N'%Anterior%'
           OR o.name LIKE N'%Variacion%'     OR o.name LIKE N'%Tendencia%')
    UNION
    SELECT m.object_id
    FROM sys.sql_modules AS m
    JOIN sys.objects AS o ON o.object_id = m.object_id
    WHERE o.is_ms_shipped = 0
      AND (   m.definition LIKE N'%TicketsActual%'   OR m.definition LIKE N'%TicketsAnterior%'
           OR m.definition LIKE N'%PeriodoAnterior%' OR m.definition LIKE N'%MesAnterior%'
           OR m.definition LIKE N'%Comparativ%'      OR m.definition LIKE N'%DashboardServ%'
           OR m.definition LIKE N'%vw[_]ServicioTickets%')
    UNION
    SELECT d.referenced_id
    FROM sys.objects AS o
    JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = o.object_id
    JOIN sys.objects AS r ON r.object_id = d.referenced_id AND r.type IN ('V', 'FN', 'IF', 'TF')
    WHERE o.name = N'usp_DashboardServicios_Comparativo'
    UNION
    SELECT OBJECT_ID(N'dbo.vw_ServicioTickets')   -- fuente actual de la pestana (repo)
), src AS (
    SELECT Objeto = QUOTENAME(OBJECT_SCHEMA_NAME(c.object_id)) + N'.' + QUOTENAME(OBJECT_NAME(c.object_id)),
           def    = REPLACE(OBJECT_DEFINITION(c.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM candidatos AS c
    WHERE c.object_id IS NOT NULL
      AND OBJECT_DEFINITION(c.object_id) IS NOT NULL
      AND OBJECT_NAME(c.object_id) <> N'usp_DashboardServicios_Comparativo'   -- ya esta en B2
), lin AS (
    SELECT Objeto, n = 1, ini = CAST(1 AS BIGINT), fin = CAST(CHARINDEX(NCHAR(10), def) AS BIGINT), def
    FROM src
    UNION ALL
    SELECT Objeto, n + 1, fin + 1, CAST(CHARINDEX(NCHAR(10), def, fin + 1) AS BIGINT), def
    FROM lin
    WHERE CHARINDEX(NCHAR(10), def, fin + 1) > 0
)
SELECT Objeto, Linea = n, Texto = SUBSTRING(def, ini, fin - ini)
FROM lin
ORDER BY Objeto, n
OPTION (MAXRECURSION 0);
GO

/* -------------------------------------------------------------------------
   F) Estructura (columnas, sin filas) de las tablas y vistas que usa el
      procedimiento (niveles 1 y 2) y, como referencia, de las fuentes que
      la pestana ya lee segun el repo.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== F) Columnas de tablas y vistas relevantes';
;WITH n1 AS (
    SELECT DISTINCT d.referenced_id
    FROM sys.objects AS o
    JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = o.object_id
    WHERE o.name = N'usp_DashboardServicios_Comparativo' AND d.referenced_id IS NOT NULL
), n2 AS (
    SELECT DISTINCT d.referenced_id
    FROM sys.sql_expression_dependencies AS d
    JOIN n1 ON n1.referenced_id = d.referencing_id
    WHERE d.referenced_id IS NOT NULL
), objetos AS (
    SELECT object_id = referenced_id, Origen = 'Dependencia nivel 1' FROM n1
    UNION
    SELECT referenced_id, 'Dependencia nivel 2' FROM n2
    UNION
    SELECT x.id, 'Fuente actual de la pestana (repo)'
    FROM (VALUES (OBJECT_ID(N'dbo.vw_ServicioTickets')),
                 (OBJECT_ID(N'dbo.vw_Tickets')),
                 (OBJECT_ID(N'dbo.CatServicioCorreo')),
                 (OBJECT_ID(N'dbo.CatCategoriaDueno'))) AS x(id)
    WHERE x.id IS NOT NULL
)
SELECT Origen      = MIN(ob.Origen),
       Objeto      = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
       TipoDesc    = o.type_desc,
       Orden       = c.column_id,
       Columna     = c.name,
       Tipo        = TYPE_NAME(c.user_type_id),
       LargoBytes  = c.max_length,
       Precision   = c.precision,
       Escala      = c.scale,
       Nulable     = c.is_nullable,
       Calculada   = c.is_computed,
       Identidad   = c.is_identity
FROM objetos AS ob
JOIN sys.objects AS o ON o.object_id = ob.object_id AND o.type IN ('U', 'V')
JOIN sys.columns AS c ON c.object_id = o.object_id
GROUP BY o.schema_id, o.name, o.type_desc, c.column_id, c.name, c.user_type_id,
         c.max_length, c.precision, c.scale, c.is_nullable, c.is_computed, c.is_identity
ORDER BY Objeto, Orden;

PRINT '=== FIN del diagnostico';
GO
