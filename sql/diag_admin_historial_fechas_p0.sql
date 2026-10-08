/* =====================================================================
   diag_admin_historial_fechas_p0.sql

   P0 de PROPUESTA_historial_fechas.md (seccion 16): pre-vuelo antes del
   entorno de pruebas.

   SOLO LECTURA: unicamente SELECT sobre vistas de catalogo (sys.*),
   DMVs, msdb y dbo.Problem / dbo.ProblemFechaEvento. El SQL dinamico
   (sp_executesql) solo arma SELECT que dependen de un tipo o columna
   que tal vez no existe, para no romper el lote. No crea, cambia ni
   borra nada; no usa tablas temporales. Correr en la VM contra
   Tickets_Proactivanet y pasar la salida COMPLETA (todas las rejillas).

   Cierra / confirma:
     P0-1) O1, O2  Tipo, largo y collation de Problem.Codigo y Fecha*.
     P0-2)         dbo.ProblemFechaEvento YA EXISTE (visto 2026-10-08):
                   esquema real completo, computadas, CHECKs, FKs,
                   indices, triggers y filas. Sustituye "nombres libres".
     P0-3) O3, O5  Modulos que mencionan Problem (cualquier escritura),
                   OUTPUT sin INTO, triggers en Problem y de base.
     P0-4) O7      Reglas de las FKs de/hacia Problem.
     P0-5) O6      Logins y opciones SET de sesiones vivas (mejor si
                   corre una carga en ese momento).
     P0-6) O2      Horas distintas de 00:00 (solo si Fecha* es de fecha
                   y hora; si es date se salta solo).
     P0-7) O5      Pasos de SQL Agent que tocan Problem o el loader (si
                   no hay permiso sobre msdb se salta solo).
     P0-8)         Resumen en una fila para decidir rapido.
   ===================================================================== */

SET NOCOUNT ON;

/* P0-1) Tipos exactos y collation (O1, O2; llena {{TIPO_CODIGO}}). */
SELECT P01 = 'Columnas de Problem', c.name AS columna, t.name AS tipo, c.max_length,
       c.precision, c.scale, c.is_nullable, c.collation_name
FROM sys.columns AS c
JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Problem')
  AND c.name IN ('Codigo', 'FechaAnalisis', 'FechaSolucion', 'FechaCierre')
ORDER BY c.column_id;

SELECT P01b = 'Base', CollationBase = DATABASEPROPERTYEX(DB_NAME(), 'Collation'),
       Compatibilidad = (SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID());

/* P0-2) dbo.ProblemFechaEvento ya existe: esquema real. */
SELECT P02 = 'Objetos *ProblemFechaEvento*', OBJECT_SCHEMA_NAME(o.object_id) AS esquema,
       o.name, o.type_desc, o.create_date, o.modify_date,
       OBJECT_NAME(o.parent_object_id) AS padre
FROM sys.objects AS o
WHERE o.name LIKE '%ProblemFechaEvento%'
ORDER BY o.create_date;

SELECT P02b = 'Columnas de ProblemFechaEvento', c.column_id, c.name AS columna, t.name AS tipo,
       c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
       cc.definition AS def_computada, cc.is_persisted, dc.name AS default_nombre,
       dc.definition AS default_def, c.collation_name
FROM sys.columns AS c
JOIN sys.types AS t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.computed_columns AS cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
WHERE c.object_id = OBJECT_ID('dbo.ProblemFechaEvento')
ORDER BY c.column_id;

SELECT P02c = 'CHECKs de ProblemFechaEvento', ck.name, ck.definition, ck.is_disabled,
       ck.is_not_trusted
FROM sys.check_constraints AS ck
WHERE ck.parent_object_id = OBJECT_ID('dbo.ProblemFechaEvento')
ORDER BY ck.name;

SELECT P02d = 'FKs de ProblemFechaEvento', fk.name,
       OBJECT_NAME(fk.referenced_object_id) AS tabla_padre,
       cp.name AS columna_hija, cr.name AS columna_padre,
       fk.delete_referential_action_desc, fk.update_referential_action_desc,
       fk.is_disabled, fk.is_not_trusted
FROM sys.foreign_keys AS fk
JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns AS cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
JOIN sys.columns AS cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
WHERE fk.parent_object_id = OBJECT_ID('dbo.ProblemFechaEvento')
   OR fk.referenced_object_id = OBJECT_ID('dbo.ProblemFechaEvento');

SELECT P02e = 'Indices de ProblemFechaEvento', i.name, i.type_desc, i.is_primary_key,
       i.is_unique, i.has_filter, i.filter_definition, c.name AS columna,
       ic.key_ordinal, ic.is_included_column
FROM sys.indexes AS i
JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID('dbo.ProblemFechaEvento')
ORDER BY i.index_id, ic.key_ordinal, c.name;

SELECT P02f = 'Triggers en ProblemFechaEvento', tr.name, tr.is_disabled,
       tr.is_instead_of_trigger, te.type_desc AS evento, tr.create_date
FROM sys.triggers AS tr
JOIN sys.trigger_events AS te ON te.object_id = tr.object_id
WHERE tr.parent_id = OBJECT_ID('dbo.ProblemFechaEvento');

SELECT P02g = 'Filas en ProblemFechaEvento', Filas = SUM(p.rows)
FROM sys.partitions AS p
WHERE p.object_id = OBJECT_ID('dbo.ProblemFechaEvento') AND p.index_id IN (0, 1);

/* Desglose solo si existen las columnas que espera la propuesta; si
   tienen otro nombre, P02b lo muestra y esto se salta. */
IF COL_LENGTH('dbo.ProblemFechaEvento', 'Origen') IS NOT NULL
   AND COL_LENGTH('dbo.ProblemFechaEvento', 'Operacion') IS NOT NULL
   AND COL_LENGTH('dbo.ProblemFechaEvento', 'Campo') IS NOT NULL
   AND COL_LENGTH('dbo.ProblemFechaEvento', 'FechaRegistro') IS NOT NULL
    EXEC sys.sp_executesql N'
        SELECT P02h = ''Desglose ProblemFechaEvento'', Origen, Operacion, Campo,
               Filas = COUNT(*), Primera = MIN(FechaRegistro), Ultima = MAX(FechaRegistro)
        FROM dbo.ProblemFechaEvento
        GROUP BY Origen, Operacion, Campo
        ORDER BY Origen, Operacion, Campo;';
ELSE
    SELECT P02h = 'Desglose omitido: faltan Origen/Operacion/Campo/FechaRegistro (ver P02b)';

/* P0-3) Modulos que mencionan Problem en cualquier forma (O3, O5).
   LIKE es aproximado: tambien cae ProblemCategoria, etc. Un 1 pide
   leer el cuerpo; el 0 en todo descarta. OutputClause busca OUTPUT
   seguido de inserted./deleted. (no los parametros OUTPUT). */
SELECT P03 = 'Modulos que mencionan Problem', OBJECT_SCHEMA_NAME(m.object_id) AS esquema,
       OBJECT_NAME(m.object_id) AS objeto, o.type_desc, o.modify_date,
       EscribeProblem = CASE WHEN m.definition LIKE '%UPDATE%Problem%'
                               OR m.definition LIKE '%INSERT%Problem%'
                               OR m.definition LIKE '%MERGE%Problem%'
                               OR m.definition LIKE '%DELETE%Problem%'
                               OR m.definition LIKE '%TRUNCATE%Problem%' THEN 1 ELSE 0 END,
       OutputClause   = CASE WHEN m.definition LIKE '%OUTPUT%inserted.%'
                               OR m.definition LIKE '%OUTPUT%deleted.%' THEN 1 ELSE 0 END,
       OutputConInto  = CASE WHEN m.definition LIKE '%OUTPUT%inserted.%INTO%'
                               OR m.definition LIKE '%OUTPUT%deleted.%INTO%' THEN 1 ELSE 0 END,
       UsaDelete      = CASE WHEN m.definition LIKE '%DELETE%' THEN 1 ELSE 0 END,
       UsaTruncate    = CASE WHEN m.definition LIKE '%TRUNCATE%' THEN 1 ELSE 0 END,
       UsaBulk        = CASE WHEN m.definition LIKE '%BULK%'
                               OR m.definition LIKE '%OPENROWSET%' THEN 1 ELSE 0 END,
       UsaSessionCtx  = CASE WHEN m.definition LIKE '%SESSION_CONTEXT%'
                               OR m.definition LIKE '%CONTEXT_INFO%' THEN 1 ELSE 0 END,
       m.uses_ansi_nulls, m.uses_quoted_identifier
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE '%Problem%'
ORDER BY EscribeProblem DESC, objeto;

/* Triggers en Problem (V5 decia 0 el 2026-10-07; se revisa porque la
   tabla de eventos aparecio despues) y triggers DDL de base. */
SELECT P03b = 'Triggers en Problem', tr.name, tr.is_disabled, tr.is_instead_of_trigger,
       te.type_desc AS evento, tr.create_date
FROM sys.triggers AS tr
JOIN sys.trigger_events AS te ON te.object_id = tr.object_id
WHERE tr.parent_id = OBJECT_ID('dbo.Problem');

SELECT P03c = 'Triggers DDL de base', tr.name, tr.is_disabled, tr.create_date
FROM sys.triggers AS tr
WHERE tr.parent_class = 0;

/* P0-4) Reglas de FKs de/hacia Problem (O7). */
SELECT P04 = 'FKs de/hacia Problem', fk.name,
       OBJECT_NAME(fk.parent_object_id) AS tabla_hija,
       OBJECT_NAME(fk.referenced_object_id) AS tabla_padre,
       fk.delete_referential_action_desc, fk.update_referential_action_desc,
       fk.is_disabled
FROM sys.foreign_keys AS fk
WHERE fk.parent_object_id = OBJECT_ID('dbo.Problem')
   OR fk.referenced_object_id = OBJECT_ID('dbo.Problem');

/* P0-5) Sesiones de usuario vivas (O6). Sin VIEW SERVER STATE solo se
   ve la propia; anotarlo si sale una sola fila. */
SELECT P05 = 'Sesiones vivas', s.session_id, s.login_name, s.original_login_name,
       s.program_name, s.host_name, s.quoted_identifier, s.ansi_nulls, s.arithabort,
       s.login_time, DB_NAME(s.database_id) AS base
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1
ORDER BY s.login_time;

/* P0-6) Horas distintas de 00:00 (O2). CAST(date AS time) es error, por
   eso solo corre si alguna Fecha* es de fecha y hora. */
IF EXISTS (SELECT 1
           FROM sys.columns AS c
           JOIN sys.types AS t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.Problem')
             AND c.name IN ('FechaAnalisis', 'FechaSolucion', 'FechaCierre')
             AND t.name IN ('datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'))
    EXEC sys.sp_executesql N'
        SELECT P06 = ''Horas distintas de 00:00'',
               ConHoraAnalisis = SUM(CASE WHEN CAST(FechaAnalisis AS time) <> ''00:00'' THEN 1 ELSE 0 END),
               ConHoraSolucion = SUM(CASE WHEN CAST(FechaSolucion AS time) <> ''00:00'' THEN 1 ELSE 0 END),
               ConHoraCierre   = SUM(CASE WHEN CAST(FechaCierre   AS time) <> ''00:00'' THEN 1 ELSE 0 END),
               Filas = COUNT(*)
        FROM dbo.Problem;';
ELSE
    SELECT P06 = 'Omitido: ninguna Fecha* es de fecha y hora (ver P01)';

/* P0-7) Pasos de SQL Agent que tocan Problem o el loader (O5). */
IF HAS_PERMS_BY_NAME('msdb.dbo.sysjobsteps', 'OBJECT', 'SELECT') = 1
   AND HAS_PERMS_BY_NAME('msdb.dbo.sysjobs', 'OBJECT', 'SELECT') = 1
    EXEC sys.sp_executesql N'
        SELECT P07 = ''Pasos de Agent'', j.name, j.enabled, s.step_id, s.step_name,
               s.subsystem, s.database_name
        FROM msdb.dbo.sysjobs AS j
        JOIN msdb.dbo.sysjobsteps AS s ON s.job_id = j.job_id
        WHERE s.command LIKE ''%Problem%'' OR s.command LIKE ''%CargarExperiencia%''
           OR s.command LIKE ''%cargar_experiencia%''
        ORDER BY j.name, s.step_id;';
ELSE
    SELECT P07 = 'Omitido: sin permiso SELECT en msdb (preguntar al DBA)';

/* P0-8) Resumen. CodigoCoincide = 1 si la columna Codigo de la tabla de
   eventos tiene el mismo tipo, largo y collation que Problem.Codigo
   (requisito de la FK). */
DECLARE @tipoP sysname, @largoP smallint, @collP sysname,
        @tipoE sysname, @largoE smallint, @collE sysname;

SELECT @tipoP = t.name, @largoP = c.max_length, @collP = c.collation_name
FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Problem') AND c.name = 'Codigo';

SELECT @tipoE = t.name, @largoE = c.max_length, @collE = c.collation_name
FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.ProblemFechaEvento') AND c.name = 'Codigo';

SELECT P08 = 'Resumen',
       CodigoProblem   = CONCAT(@tipoP, '(', CASE WHEN @tipoP LIKE 'n%' THEN @largoP / 2 ELSE @largoP END, ') ', @collP),
       CodigoEvento    = CONCAT(@tipoE, '(', CASE WHEN @tipoE LIKE 'n%' THEN @largoE / 2 ELSE @largoE END, ') ', @collE),
       CodigoCoincide  = CASE WHEN @tipoP = @tipoE AND @largoP = @largoE AND @collP = @collE THEN 1 ELSE 0 END,
       FechasNoTexto   = CASE WHEN EXISTS (
                             SELECT 1 FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
                             WHERE c.object_id = OBJECT_ID('dbo.Problem')
                               AND c.name IN ('FechaAnalisis', 'FechaSolucion', 'FechaCierre')
                               AND t.name NOT IN ('date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'))
                         THEN 0 ELSE 1 END,
       TriggersProblem = (SELECT COUNT(*) FROM sys.triggers WHERE parent_id = OBJECT_ID('dbo.Problem')),
       TriggersEvento  = (SELECT COUNT(*) FROM sys.triggers WHERE parent_id = OBJECT_ID('dbo.ProblemFechaEvento')),
       FilasEvento     = (SELECT SUM(rows) FROM sys.partitions
                          WHERE object_id = OBJECT_ID('dbo.ProblemFechaEvento') AND index_id IN (0, 1)),
       FkEventoProblem = CASE WHEN EXISTS (
                             SELECT 1 FROM sys.foreign_keys
                             WHERE parent_object_id = OBJECT_ID('dbo.ProblemFechaEvento')
                               AND referenced_object_id = OBJECT_ID('dbo.Problem'))
                         THEN 1 ELSE 0 END;
