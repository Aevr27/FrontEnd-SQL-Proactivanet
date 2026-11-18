/* =====================================================================
   diag_admin_historial_fechas.sql

   SOLO LECTURA: unicamente SELECT sobre vistas de catalogo (sys.*) y
   SERVERPROPERTY. No crea, cambia ni borra nada; no usa tablas
   temporales. Correr en la VM contra Tickets_Proactivanet y pasar la
   salida COMPLETA (todas las rejillas).

   Complementa diag_admin_roles_tipos_historial.sql (C1, C4, F1-F6) y
   diag_admin_nueva_solicitud.sql (N5b, N5c). Responde lo que falta para
   decidir como capturar el historial de FechaAnalisis/Solucion/Cierre:
     H1) Version de SQL Server y nivel de compatibilidad de la base.
     H2) Llave primaria / UNIQUE de dbo.Problem: ¿Codigo sirve para FK?
     H3) Como escribe el loader dbo.Problem: UPDATE/MERGE (un trigger
         AFTER UPDATE veria antes/despues) o DELETE/TRUNCATE + INSERT
         (el trigger veria solo altas y habria que capturar en el loader).
     H4) Triggers que ya existan sobre dbo.Problem.
   ===================================================================== */

SET NOCOUNT ON;

/* H1) Version y compatibilidad. */
SELECT H1 = 'Version',
       ProductVersion = SERVERPROPERTY('ProductVersion'),
       ProductLevel   = SERVERPROPERTY('ProductLevel'),
       Edition        = SERVERPROPERTY('Edition'),
       Compatibilidad = (SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID());

/* H2) Llaves e indices unicos de dbo.Problem, con sus columnas. */
SELECT H2 = 'Llaves/unicos de Problem', i.name, i.type_desc, i.is_primary_key,
       i.is_unique, i.is_unique_constraint, c.name AS columna, ic.key_ordinal
FROM sys.indexes AS i
JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID('dbo.Problem') AND (i.is_primary_key = 1 OR i.is_unique = 1)
ORDER BY i.name, ic.key_ordinal;

/* Columnas identity de Problem (por si existe un Id sustituto). */
SELECT H2b = 'Identity en Problem', c.name, t.name AS tipo
FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Problem') AND c.is_identity = 1;

/* FKs que apuntan a Problem o salen de ella. */
SELECT H2c = 'FKs de/hacia Problem', fk.name,
       OBJECT_NAME(fk.parent_object_id) AS tabla_hija,
       OBJECT_NAME(fk.referenced_object_id) AS tabla_padre
FROM sys.foreign_keys AS fk
WHERE fk.parent_object_id = OBJECT_ID('dbo.Problem')
   OR fk.referenced_object_id = OBJECT_ID('dbo.Problem');

/* H3) Forma de escritura de los modulos que tocan dbo.Problem. Solo
   banderas; la definicion no se copia aqui. LIKE es aproximado: un 1
   pide mirar el cuerpo, un 0 en todo descarta. */
SELECT H3 = 'Como escriben Problem', OBJECT_SCHEMA_NAME(m.object_id) AS esquema,
       OBJECT_NAME(m.object_id) AS objeto, o.type_desc, o.modify_date,
       UpdateProblem   = CASE WHEN m.definition LIKE '%UPDATE%dbo.Problem%'
                                OR m.definition LIKE '%UPDATE p%FROM dbo.Problem%' THEN 1 ELSE 0 END,
       MergeProblem    = CASE WHEN m.definition LIKE '%MERGE%dbo.Problem%' THEN 1 ELSE 0 END,
       InsertProblem   = CASE WHEN m.definition LIKE '%INSERT%INTO%dbo.Problem%' THEN 1 ELSE 0 END,
       DeleteProblem   = CASE WHEN m.definition LIKE '%DELETE%dbo.Problem%' THEN 1 ELSE 0 END,
       TruncateProblem = CASE WHEN m.definition LIKE '%TRUNCATE%TABLE%dbo.Problem%' THEN 1 ELSE 0 END,
       UsaHashFila     = CASE WHEN m.definition LIKE '%HashFila%' THEN 1 ELSE 0 END,
       UsaSessionCtx   = CASE WHEN m.definition LIKE '%SESSION_CONTEXT%' OR m.definition LIKE '%CONTEXT_INFO%' THEN 1 ELSE 0 END
FROM sys.sql_modules AS m JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE '%dbo.Problem%'
ORDER BY objeto;

/* H4) Triggers sobre dbo.Problem (incluye deshabilitados). */
SELECT H4 = 'Triggers en Problem', tr.name, tr.is_disabled, tr.is_instead_of_trigger,
       te.type_desc AS evento
FROM sys.triggers AS tr
JOIN sys.trigger_events AS te ON te.object_id = tr.object_id
WHERE tr.parent_id = OBJECT_ID('dbo.Problem');
