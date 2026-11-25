/* =========================================================================
   sql/diag/ADM_DIAG_usp_DashboardServicios_TendenciaDiaria.sql
   Diagnostico de SOLO LECTURA de dbo.usp_DashboardServicios_TendenciaDiaria,
   la fuente que se pidio para la grafica "Tickets generados por dia"
   (Vista general de servicios). Sirve para decidir si la pestaña puede
   llamarla en vez de calcular la tendencia en C# (ConcentracionContrato.Tendencia).

   QUE SE SABE (2026-11-25)
   - El cuerpo NO esta en el repo ni en el volcado esquema_bd (2026-10-13):
     es posterior. Se busca solo en la base.
   - Captura de su salida (dada por el usuario, sin parametros visibles):
     Fecha, RamaServicio ("S-Caja General", "S-Equipo de Computo",
     "S-Biometrico"), TicketsServicio, TicketsTotalDia. Trae filas en 0
     (dias sin tickets) y TicketsTotalDia = suma de los servicios devueltos
     ese dia, no el total de tickets del dia.
   - La pestaña agrupa por CODIGO de servicio (CatServicioCorreo.Servicio),
     no por RamaServicio, y filtra por Slot o varios meses, Service Owner y
     Grupo. Lo que hay que contestar con este diagnostico:
       1) parametros: fechas / Slot / mes; servicios elegidos o Top N;
          Service Owner; Grupo;
       2) de donde lee (vw_ServicioTickets u otra) y como define "dia";
       3) si agrupa por rama o por codigo, y como se pasa de uno a otro;
       4) quien la llama hoy y con que valores (plan en cache, jobs);
       5) si la cuenta del sitio puede ejecutarla.

   ES DE SOLO LECTURA
   - Sin CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, MERGE, TRUNCATE, GRANT,
     REVOKE, ni tablas temporales o variables de tabla. Sin SET de
     configuracion del servidor.
   - NO ejecuta el procedimiento. Lee catalogos (sys.*), OBJECT_DEFINITION,
     DMVs de estadisticas/planes y msdb (jobs). Unica ejecucion dinamica:
     sp_executesql con SELECT a sys.objects de otras bases (A2) y a msdb (E3),
     para que un permiso faltante no tumbe el lote.
   - Filas de negocio: solo el catalogo de servicios (seccion H: codigo,
     descripcion, habilitado y ramas), nunca correos ni tickets.
   - Cada seccion es un lote propio (GO) con TRY/CATCH donde puede fallar por
     permisos: si una falla, lo dice y las demas siguen.

   COMO CORRERLO
   Opcion 1, sqlcmd desde CMD (recomendada: texto completo, sin recortes):
       cd /d "<carpeta del repo>"
       sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -E -y 0 -i sql\diag\ADM_DIAG_usp_DashboardServicios_TendenciaDiaria.sql -o diag_tendencia_salida.txt
   (-E = cuenta Windows; con usuario SQL cambia -E por -U <usuario>.)
   Opcion 2, SSMS: Results to Text (Ctrl+T); Tools > Options > Query Results >
   SQL Server > Results to Text > "Maximum number of characters displayed in
   each column" = 8192; F5. Copiar la pestaña Messages + Results completa.
   La salida no va al repositorio.
   ========================================================================= */
USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
PRINT '=== 0) Contexto: servidor, base, cuenta, version';
SELECT Servidor    = @@SERVERNAME,
       Base        = DB_NAME(),
       Login       = SUSER_SNAME(),
       Usuario     = USER_NAME(),
       Hora        = CONVERT(VARCHAR(19), SYSDATETIME(), 120),
       Version     = CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(30)),
       Edicion     = CAST(SERVERPROPERTY('Edition') AS VARCHAR(60)),
       NivelCompat = (SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID());

PRINT '=== 0b) Permisos de la cuenta que corre el diagnostico (1 = si)';
SELECT VerDefinicionBase = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION'),
       VerEstadoBase     = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DATABASE STATE'),
       VerEstadoServidor = HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE'),
       EsDbOwner         = IS_MEMBER('db_owner'),
       EsDbDatareader    = IS_MEMBER('db_datareader');
GO

/* -------------------------------------------------------------------------
   A) Existencia y familia. A3 lista TODOS los usp_DashboardServicios_*:
      si los servicios elegidos llegan de otro procedimiento (catalogo,
      Top N), sale aqui.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== A1) Existencia en esta base (vacio = no existe o la cuenta no lo ve)';
SELECT Esquema     = SCHEMA_NAME(o.schema_id),
       Nombre      = o.name,
       TipoDesc    = o.type_desc,
       ObjectId    = o.object_id,
       Creado      = CONVERT(VARCHAR(19), o.create_date, 120),
       Modificado  = CONVERT(VARCHAR(19), o.modify_date, 120)
FROM sys.objects AS o
WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria';

SELECT ExisteDboExacto = CASE WHEN OBJECT_ID(N'dbo.usp_DashboardServicios_TendenciaDiaria') IS NULL
                              THEN 'NO' ELSE 'SI' END;

PRINT '=== A1b) Sinonimos con ese nombre o que apunten a el';
SELECT Esquema = SCHEMA_NAME(s.schema_id), Sinonimo = s.name, ApuntaA = s.base_object_name
FROM sys.synonyms AS s
WHERE s.name LIKE N'%TendenciaDiaria%'
   OR s.base_object_name LIKE N'%usp[_]DashboardServicios[_]TendenciaDiaria%';

PRINT '=== A3) Familia usp_DashboardServicios_* (y modulos con "Tendencia" en el nombre)';
SELECT Esquema     = SCHEMA_NAME(o.schema_id),
       Nombre      = o.name,
       TipoDesc    = o.type_desc,
       Creado      = CONVERT(VARCHAR(19), o.create_date, 120),
       Modificado  = CONVERT(VARCHAR(19), o.modify_date, 120),
       Parametros  = (SELECT COUNT(*) FROM sys.parameters AS p WHERE p.object_id = o.object_id AND p.parameter_id > 0)
FROM sys.objects AS o
WHERE o.is_ms_shipped = 0
  AND o.type IN ('P', 'V', 'FN', 'IF', 'TF')
  AND (o.name LIKE N'%DashboardServicios%' OR o.name LIKE N'%Tendencia%')
ORDER BY Nombre;
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
   B) Definicion completa, linea por linea (para que no la recorte el
      limite por columna). NULL = cifrado o sin VIEW DEFINITION.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== B1) Estado de la definicion';
SELECT Esquema     = SCHEMA_NAME(o.schema_id),
       Nombre      = o.name,
       Cifrado     = OBJECTPROPERTY(o.object_id, 'IsEncrypted'),
       PuedeVerDef = HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
                                       'OBJECT', 'VIEW DEFINITION'),
       Disponible  = CASE WHEN OBJECT_DEFINITION(o.object_id) IS NULL THEN 'NO' ELSE 'SI' END,
       Caracteres  = LEN(OBJECT_DEFINITION(o.object_id)),
       AnsiNulls   = m.uses_ansi_nulls,
       QuotedIdent = m.uses_quoted_identifier,
       EjecutaComo = CASE WHEN m.execute_as_principal_id IS NULL THEN 'CALLER/OWNER (por omision)'
                          ELSE USER_NAME(m.execute_as_principal_id) END
FROM sys.objects AS o
LEFT JOIN sys.sql_modules AS m ON m.object_id = o.object_id
WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria';

PRINT '=== B2) Definicion, linea por linea';
;WITH src AS (
    SELECT Objeto = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
           def    = REPLACE(OBJECT_DEFINITION(o.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM sys.objects AS o
    WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
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

PRINT '=== B3) Lineas con escritura, SQL dinamico o TOP (vacio = nada de eso)';
PRINT '        INSERT/UPDATE a #temporal o @tabla es normal y no toca tablas de la base.';
PRINT '        TOP / ROW_NUMBER / RANK suelen ser el corte de "los N servicios".';
;WITH src AS (
    SELECT Objeto = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
           def    = REPLACE(OBJECT_DEFINITION(o.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM sys.objects AS o
    WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
      AND OBJECT_DEFINITION(o.object_id) IS NOT NULL
), lin AS (
    SELECT Objeto, n = 1, ini = CAST(1 AS BIGINT), fin = CAST(CHARINDEX(NCHAR(10), def) AS BIGINT), def
    FROM src
    UNION ALL
    SELECT Objeto, n + 1, fin + 1, CAST(CHARINDEX(NCHAR(10), def, fin + 1) AS BIGINT), def
    FROM lin
    WHERE CHARINDEX(NCHAR(10), def, fin + 1) > 0
), t AS (
    SELECT Objeto, n, Texto = SUBSTRING(def, ini, fin - ini) FROM lin
)
SELECT Objeto, Linea = n, Texto,
       Marca = CASE WHEN Texto LIKE N'%INSERT%' OR Texto LIKE N'%UPDATE%' OR Texto LIKE N'%DELETE%'
                      OR Texto LIKE N'%MERGE%' OR Texto LIKE N'%TRUNCATE%' THEN 'escritura'
                    WHEN Texto LIKE N'%EXEC%' OR Texto LIKE N'%sp[_]executesql%' THEN 'dinamico/llamada'
                    ELSE 'corte (TOP/ranking)' END
FROM t
WHERE Texto LIKE N'%INSERT%' OR Texto LIKE N'%UPDATE%' OR Texto LIKE N'%DELETE%'
   OR Texto LIKE N'%MERGE%'  OR Texto LIKE N'%TRUNCATE%' OR Texto LIKE N'%EXEC%'
   OR Texto LIKE N'%sp[_]executesql%'
   OR Texto LIKE N'%TOP%' OR Texto LIKE N'%ROW[_]NUMBER%' OR Texto LIKE N'%RANK%'
ORDER BY Objeto, n
OPTION (MAXRECURSION 0);
GO

/* -------------------------------------------------------------------------
   C) Parametros y forma de la salida. has_default_value solo es confiable
      en CLR: en T-SQL el valor por omision esta en el texto, por eso
      DeclaracionEnTexto (heuristica: confirmar contra B2). Si un parametro
      es de tipo tabla (TVP, EsReadOnly = 1), C1b da sus columnas: asi se
      pasarian "varios servicios seleccionados".
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== C1) Parametros (vacio = sin parametros, o el procedimiento no existe)';
SELECT Orden         = p.parameter_id,
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
WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
  AND p.parameter_id > 0
ORDER BY Orden;

PRINT '=== C1b) Columnas de los parametros tipo tabla (vacio = no usa TVP)';
SELECT Parametro  = p.name,
       TipoTabla  = SCHEMA_NAME(tt.schema_id) + N'.' + tt.name,
       Orden      = c.column_id,
       Columna    = c.name,
       Tipo       = TYPE_NAME(c.user_type_id),
       LargoBytes = c.max_length,
       Nulable    = c.is_nullable
FROM sys.objects AS o
JOIN sys.parameters AS p ON p.object_id = o.object_id
JOIN sys.table_types AS tt ON tt.user_type_id = p.user_type_id
JOIN sys.columns AS c ON c.object_id = tt.type_table_object_id
WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
ORDER BY Parametro, Orden;

PRINT '=== C2) Forma del primer result set (no ejecuta; error_message explica si no se pudo deducir)';
BEGIN TRY
    SELECT r.column_ordinal, r.name, r.system_type_name, r.is_nullable,
           r.error_number, r.error_message
    FROM sys.objects AS o
    CROSS APPLY sys.dm_exec_describe_first_result_set_for_object(o.object_id, 0) AS r
    WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
    ORDER BY r.column_ordinal;
END TRY
BEGIN CATCH
    PRINT '   C2 no disponible: ' + ERROR_MESSAGE();
END CATCH;
GO

/* -------------------------------------------------------------------------
   D) Dependencias. Lo que arme con SQL dinamico NO sale aqui: ver B3.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== D1) Objetos referenciados (catalogo de dependencias)';
SELECT BaseReferida    = d.referenced_database_name,
       EsquemaReferido = d.referenced_schema_name,
       ObjetoReferido  = d.referenced_entity_name,
       ReferencedId    = d.referenced_id,
       TipoReferido    = COALESCE(r.type_desc,
                                  CASE WHEN d.referenced_class = 6 THEN 'TIPO (tabla o alias de usuario)'
                                       WHEN d.referenced_database_name IS NOT NULL THEN '(otra base: no se resuelve aqui)'
                                       WHEN d.referenced_entity_name LIKE N'#%' THEN '(#temporal)'
                                       ELSE '(NO RESUELTO: no existe o la cuenta no lo ve)' END),
       EsAmbiguo       = d.is_ambiguous
FROM sys.objects AS o
JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = o.object_id
LEFT JOIN sys.objects AS r ON r.object_id = d.referenced_id
WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
ORDER BY TipoReferido, ObjetoReferido;
GO

SET NOCOUNT ON;
PRINT '=== D2) Entidades y columnas referenciadas (resolucion del motor)';
IF OBJECT_ID(N'dbo.usp_DashboardServicios_TendenciaDiaria') IS NULL
    PRINT '   (dbo.usp_DashboardServicios_TendenciaDiaria no existe: D2 se omite)';
ELSE
BEGIN
BEGIN TRY
    SELECT EsquemaReferido = e.referenced_schema_name,
           ObjetoReferido  = e.referenced_entity_name,
           Columna         = e.referenced_minor_name,
           SeSelecciona    = e.is_selected,
           SeActualiza     = e.is_updated
    FROM sys.dm_sql_referenced_entities(N'dbo.usp_DashboardServicios_TendenciaDiaria', 'OBJECT') AS e
    ORDER BY ObjetoReferido, Columna;
END TRY
BEGIN CATCH
    PRINT '   no se pudo resolver (error ' + CAST(ERROR_NUMBER() AS VARCHAR(10)) + '): ' + ERROR_MESSAGE();
END CATCH;
END;
GO

SET NOCOUNT ON;
PRINT '=== D3) Segundo nivel: lo que leen las vistas y funciones que usa';
;WITH n1 AS (
    SELECT DISTINCT d.referenced_id
    FROM sys.objects AS o
    JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = o.object_id
    WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
      AND d.referenced_id IS NOT NULL
)
SELECT Desde          = QUOTENAME(OBJECT_SCHEMA_NAME(d.referencing_id)) + N'.' + QUOTENAME(OBJECT_NAME(d.referencing_id)),
       ObjetoReferido = ISNULL(d.referenced_schema_name + N'.', N'') + d.referenced_entity_name,
       TipoReferido   = ISNULL(r.type_desc, '(no resuelto / otra base)')
FROM sys.sql_expression_dependencies AS d
JOIN n1 ON n1.referenced_id = d.referencing_id
LEFT JOIN sys.objects AS r ON r.object_id = d.referenced_id
ORDER BY Desde, ObjetoReferido;

PRINT '=== D4) Modulos de la base que lo referencian (por dependencia o por texto)';
SELECT DISTINCT Referenciador = QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name),
       Tipo = o.type_desc
FROM sys.objects AS o
JOIN sys.sql_modules AS m ON m.object_id = o.object_id
WHERE o.name <> N'usp_DashboardServicios_TendenciaDiaria'
  AND (m.definition LIKE N'%usp[_]DashboardServicios[_]TendenciaDiaria%'
       OR EXISTS (SELECT 1 FROM sys.sql_expression_dependencies AS d
                  WHERE d.referencing_id = o.object_id
                    AND d.referenced_entity_name = N'usp_DashboardServicios_TendenciaDiaria'));
GO

/* -------------------------------------------------------------------------
   E) Quien lo usa hoy y con que valores.
      E1 estadisticas desde que su plan entro a cache (se pierden al
         reiniciar o recompilar): ejecuciones, ultima, duracion y lecturas.
      E2 valores con los que se COMPILO el plan en cache (los de la primera
         llamada que lo compilo, no de todas): dice que fechas/servicios
         manda quien lo llama hoy. Son parametros, no filas de tickets.
      E3 jobs del Agente que lo mencionan.
      Las tres requieren VIEW SERVER STATE o acceso a msdb; sin el, lo dicen.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== E1) Estadisticas de ejecucion de la familia usp_DashboardServicios_* (vacio = sin plan en cache)';
BEGIN TRY
    EXEC sys.sp_executesql N'
    SELECT Procedimiento   = OBJECT_NAME(ps.object_id, ps.database_id),
           EnCacheDesde    = CONVERT(VARCHAR(19), ps.cached_time, 120),
           UltimaEjecucion = CONVERT(VARCHAR(19), ps.last_execution_time, 120),
           Ejecuciones     = ps.execution_count,
           MsPromedio      = ps.total_elapsed_time / NULLIF(ps.execution_count, 0) / 1000,
           MsMaximo        = ps.max_elapsed_time / 1000,
           LecturasPromedio = ps.total_logical_reads / NULLIF(ps.execution_count, 0)
    FROM sys.dm_exec_procedure_stats AS ps
    WHERE ps.database_id = DB_ID()
      AND OBJECT_NAME(ps.object_id, ps.database_id) LIKE N''usp[_]DashboardServicios[_]%''
    ORDER BY Procedimiento;';
END TRY
BEGIN CATCH
    PRINT '   E1 no disponible: ' + ERROR_MESSAGE();
END CATCH;
GO

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- los metodos XML lo exigen; sqlcmd arranca con OFF
PRINT '=== E2) Valores de compilacion del plan en cache de TendenciaDiaria (vacio = sin plan en cache)';
BEGIN TRY
    EXEC sys.sp_executesql N'
    WITH XMLNAMESPACES (DEFAULT ''http://schemas.microsoft.com/sqlserver/2004/07/showplan'')
    SELECT DISTINCT
           EnCacheDesde       = CONVERT(VARCHAR(19), ps.cached_time, 120),
           Parametro          = x.c.value(''@Column'', ''NVARCHAR(128)''),
           ValorCompilado     = x.c.value(''@ParameterCompiledValue'', ''NVARCHAR(4000)''),
           ValorEnEjecucion   = x.c.value(''@ParameterRuntimeValue'', ''NVARCHAR(4000)'')
    FROM sys.dm_exec_procedure_stats AS ps
    CROSS APPLY sys.dm_exec_query_plan(ps.plan_handle) AS qp
    CROSS APPLY qp.query_plan.nodes(''//ParameterList/ColumnReference'') AS x(c)
    WHERE ps.database_id = DB_ID()
      AND ps.object_id = OBJECT_ID(N''dbo.usp_DashboardServicios_TendenciaDiaria'')
    ORDER BY Parametro;';
END TRY
BEGIN CATCH
    PRINT '   E2 no disponible: ' + ERROR_MESSAGE();
END CATCH;
GO

SET NOCOUNT ON;
PRINT '=== E3) Jobs del Agente que mencionan DashboardServicios (vacio = ninguno)';
BEGIN TRY
    EXEC sys.sp_executesql N'
    SELECT Job = j.name, Habilitado = j.enabled, Paso = s.step_id, NombrePaso = s.step_name,
           Base = s.database_name, Subsistema = s.subsystem
    FROM msdb.dbo.sysjobsteps AS s
    JOIN msdb.dbo.sysjobs AS j ON j.job_id = s.job_id
    WHERE s.command LIKE N''%DashboardServicios%''
    ORDER BY Job, Paso;';
END TRY
BEGIN CATCH
    PRINT '   E3 no disponible (sin acceso a msdb): ' + ERROR_MESSAGE();
END CATCH;
GO

/* -------------------------------------------------------------------------
   F) Permisos: quien puede ejecutarlo. El sitio usa el usuario SQL
      PROACTIVANETAD (en QA: db_datareader + EXECUTE sobre el esquema dbo,
      verificado el 2026-11-09 para la pestaña). Se confirma aqui para este
      objeto. Solo se ven los permisos que la cuenta del diagnostico puede ver.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== F1) EXECUTE / CONTROL concedidos sobre el procedimiento, el esquema dbo o la base';
SELECT Principal = pr.name,
       TipoPrincipal = pr.type_desc,
       Permiso   = dp.permission_name,
       Estado    = dp.state_desc,
       Alcance   = dp.class_desc,
       Sobre     = CASE dp.class WHEN 1 THEN OBJECT_SCHEMA_NAME(dp.major_id) + N'.' + OBJECT_NAME(dp.major_id)
                                 WHEN 3 THEN SCHEMA_NAME(dp.major_id)
                                 ELSE DB_NAME() END
FROM sys.database_permissions AS dp
JOIN sys.database_principals AS pr ON pr.principal_id = dp.grantee_principal_id
WHERE dp.permission_name IN ('EXECUTE', 'CONTROL')
  AND (   (dp.class = 1 AND dp.major_id = OBJECT_ID(N'dbo.usp_DashboardServicios_TendenciaDiaria'))
       OR (dp.class = 3 AND dp.major_id = SCHEMA_ID(N'dbo'))
       OR  dp.class = 0)
ORDER BY Alcance, Principal;

PRINT '=== F2) Roles de PROACTIVANETAD en esta base (vacio = el usuario no existe o no se ve)';
SELECT Usuario = u.name, Rol = r.name
FROM sys.database_principals AS u
LEFT JOIN sys.database_role_members AS rm ON rm.member_principal_id = u.principal_id
LEFT JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
WHERE u.name = N'PROACTIVANETAD';
GO

/* -------------------------------------------------------------------------
   G) Definiciones de los demas usp_DashboardServicios_* y de las vistas y
      funciones que usa TendenciaDiaria (nivel 1), mas dbo.vw_ServicioTickets
      (fuente actual de la pestaña: ahi se calcula RamaServicio). Para
      comparar como define rama, dia y periodo contra la pestaña.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== G) Definiciones relacionadas, linea por linea';
;WITH candidatos AS (
    SELECT o.object_id
    FROM sys.objects AS o
    WHERE o.type IN ('P', 'V', 'FN', 'IF', 'TF') AND o.is_ms_shipped = 0
      AND o.name LIKE N'%DashboardServicios%'
      AND o.name <> N'usp_DashboardServicios_TendenciaDiaria'    -- ya esta en B2
    UNION
    SELECT d.referenced_id
    FROM sys.objects AS o
    JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = o.object_id
    JOIN sys.objects AS r ON r.object_id = d.referenced_id AND r.type IN ('V', 'FN', 'IF', 'TF')
    WHERE o.name = N'usp_DashboardServicios_TendenciaDiaria'
    UNION
    SELECT OBJECT_ID(N'dbo.vw_ServicioTickets')
), src AS (
    SELECT Objeto = QUOTENAME(OBJECT_SCHEMA_NAME(c.object_id)) + N'.' + QUOTENAME(OBJECT_NAME(c.object_id)),
           def    = REPLACE(OBJECT_DEFINITION(c.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM candidatos AS c
    WHERE c.object_id IS NOT NULL
      AND OBJECT_DEFINITION(c.object_id) IS NOT NULL
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
   H) Rama de servicio <-> codigo de servicio. La USP devuelve RamaServicio
      ("S-Caja General"); la pestaña agrupa por CatServicioCorreo.Servicio
      (PU y WMS tienen varias ramas). Solo catalogo: codigo, descripcion,
      habilitado y prefijos; sin destinatarios de correo.
      Columnas segun esquema_bd (2026-10-13); si fallan, lo dice.
   ------------------------------------------------------------------------- */
SET NOCOUNT ON;
PRINT '=== H1) Codigos con sus ramas (PrefijoCategoria). Ramas > 1 = un servicio con varias lineas si se agrupa por rama';
BEGIN TRY
    EXEC sys.sp_executesql N'
    SELECT Servicio  = c.Servicio,
           Descripcion = c.Descripcion,
           Habilitado = c.Habilitado,
           Ramas     = COUNT(sc.PrefijoCategoria) OVER (PARTITION BY c.Servicio),
           Prefijo   = sc.PrefijoCategoria
    FROM dbo.CatServicioCorreo AS c
    LEFT JOIN dbo.CatServicioCategoria AS sc ON sc.Servicio = c.Servicio
    ORDER BY c.Servicio, sc.PrefijoCategoria;';
END TRY
BEGIN CATCH
    PRINT '   H1 no disponible: ' + ERROR_MESSAGE();
END CATCH;

PRINT '=== H2) Ramas de la captura: a que codigo pertenecen (sin acentos ni mayusculas; Servicio NULL = no coincide)';
BEGIN TRY
    EXEC sys.sp_executesql N'
    SELECT Rama = x.Rama, Servicio = sc.Servicio, Prefijo = sc.PrefijoCategoria
    FROM (VALUES (N''S-Caja General''), (N''S-Equipo de Computo''), (N''S-Biometrico'')) AS x(Rama)
    LEFT JOIN dbo.CatServicioCategoria AS sc
           ON sc.PrefijoCategoria COLLATE Latin1_General_CI_AI LIKE N''%'' + x.Rama + N''%''
    ORDER BY x.Rama;';
END TRY
BEGIN CATCH
    PRINT '   H2 no disponible: ' + ERROR_MESSAGE();
END CATCH;

PRINT '=== FIN del diagnostico';
GO
