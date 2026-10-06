/* =====================================================================
   diag_admin_roles_tipos_historial.sql

   SOLO LECTURA: unicamente SELECT sobre tablas y vistas de catalogo
   (sys.*, INFORMATION_SCHEMA). No crea, cambia ni borra nada; no usa
   tablas temporales. Correr en la VM contra Tickets_Proactivanet y pasar
   la salida COMPLETA (todas las rejillas).

   Responde, antes de escribir codigo o DDL:
     A) dbo.UsuariosAdmin: columnas, restricciones, filas, formato de la
        cuenta y quien puede leerla.
     B) dbo.CatPrefijoProblem: columnas, filas y relacion con
        dbo.Problem.Prefijo / dbo.Problem.TipoIniciativa.
     C) Fechas de compromiso de dbo.Problem: columnas, contadores
        NroCambioFecha*, y que objetos de la base las escriben.
     D) Numero de solicitud: si ya existe algo (esquema adm, secuencias,
        tablas Solicitud/Contador).
     F) Auditoria/historial reutilizable: triggers, tablas temporales
        (system-versioned), CDC, Change Tracking, tablas con Hist, Log,
        Audit o Bitacora en el nombre.
   ===================================================================== */

SET NOCOUNT ON;

/* ---------------------------------------------------------------------
   A) dbo.UsuariosAdmin
   --------------------------------------------------------------------- */
SELECT A1 = 'Columnas UsuariosAdmin', c.column_id, c.name, t.name AS tipo,
       c.max_length, c.is_nullable, c.is_identity,
       dc.definition AS default_def
FROM sys.columns AS c
JOIN sys.types AS t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
WHERE c.object_id = OBJECT_ID('dbo.UsuariosAdmin')
ORDER BY c.column_id;

SELECT A2 = 'Restricciones UsuariosAdmin', k.name, k.type_desc, NULL AS definicion
FROM sys.key_constraints AS k WHERE k.parent_object_id = OBJECT_ID('dbo.UsuariosAdmin')
UNION ALL
SELECT 'Restricciones UsuariosAdmin', cc.name, cc.type_desc, cc.definition
FROM sys.check_constraints AS cc WHERE cc.parent_object_id = OBJECT_ID('dbo.UsuariosAdmin')
UNION ALL
SELECT 'Restricciones UsuariosAdmin', i.name, 'INDEX ' + i.type_desc + CASE WHEN i.is_unique = 1 THEN ' UNIQUE' ELSE '' END, NULL
FROM sys.indexes AS i WHERE i.object_id = OBJECT_ID('dbo.UsuariosAdmin') AND i.type > 0;

/* Filas tal cual + como se veria la cuenta: con o sin dominio, espacios,
   mayusculas, duplicados. El sitio compara DOMINIO\cuenta. */
SELECT A3 = 'Filas UsuariosAdmin',
       Usuario, CorreoUsuario, Acceso,
       TieneDominio   = CASE WHEN CHARINDEX('\', Usuario) > 0 THEN 1 ELSE 0 END,
       LargoUsuario   = LEN(Usuario),
       ConEspacios    = CASE WHEN Usuario <> LTRIM(RTRIM(Usuario)) THEN 1 ELSE 0 END,
       Repetidas      = COUNT(*) OVER (PARTITION BY LOWER(LTRIM(RTRIM(Usuario))))
FROM dbo.UsuariosAdmin
ORDER BY Acceso, Usuario;

/* Permisos explicitos sobre la tabla y quien es lector de la base: la web
   conecta con una cuenta de servicio y necesita SELECT aqui. */
SELECT A4 = 'Permisos sobre UsuariosAdmin', pr.name AS principal, pr.type_desc,
       p.permission_name, p.state_desc
FROM sys.database_permissions AS p
JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE p.major_id = OBJECT_ID('dbo.UsuariosAdmin');

SELECT A5 = 'Miembros de db_datareader / db_owner', r.name AS rol, m.name AS miembro, m.type_desc
FROM sys.database_role_members AS rm
JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals AS m ON m.principal_id = rm.member_principal_id
WHERE r.name IN ('db_datareader', 'db_owner')
ORDER BY r.name, m.name;

/* ¿Algo mas ya usa la tabla? (vistas, SP, funciones) */
SELECT A6 = 'Modulos que mencionan UsuariosAdmin', OBJECT_SCHEMA_NAME(m.object_id) AS esquema,
       OBJECT_NAME(m.object_id) AS objeto, o.type_desc
FROM sys.sql_modules AS m JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE '%UsuariosAdmin%';

/* ---------------------------------------------------------------------
   B) dbo.CatPrefijoProblem y su relacion con Problem
   --------------------------------------------------------------------- */
SELECT B1 = 'Columnas CatPrefijoProblem', c.column_id, c.name, t.name AS tipo,
       c.max_length, c.is_nullable
FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.CatPrefijoProblem')
ORDER BY c.column_id;

SELECT B2 = 'Llaves CatPrefijoProblem', k.name, k.type_desc
FROM sys.key_constraints AS k WHERE k.parent_object_id = OBJECT_ID('dbo.CatPrefijoProblem');

SELECT B3 = 'Filas CatPrefijoProblem', * FROM dbo.CatPrefijoProblem ORDER BY 2;

/* Prefijo x TipoIniciativa en Problem (todas las filas y solo vigentes).
   Si cada prefijo cae en UN TipoIniciativa, ese es el mapeo; si no, el
   catalogo no basta para filtrar por tipo y hay que verlo. */
SELECT B4 = 'Problem: Prefijo x TipoIniciativa', p.Prefijo, p.TipoIniciativa,
       Total = COUNT(*), Vigentes = SUM(CASE WHEN p.VigenteEnOrigen = 1 THEN 1 ELSE 0 END),
       EnCatalogo = MAX(CASE WHEN cp.Prefijo IS NULL THEN 0 ELSE 1 END)
FROM dbo.Problem AS p
LEFT JOIN dbo.CatPrefijoProblem AS cp ON cp.Prefijo = p.Prefijo
GROUP BY p.Prefijo, p.TipoIniciativa
ORDER BY p.Prefijo, Total DESC;

/* Prefijos del catalogo sin ningun Problem, y Problem vigentes sin prefijo
   en el catalogo. */
SELECT B5 = 'Catalogo sin Problem', cp.Prefijo
FROM dbo.CatPrefijoProblem AS cp
WHERE NOT EXISTS (SELECT 1 FROM dbo.Problem AS p WHERE p.Prefijo = cp.Prefijo);

SELECT B6 = 'Problem vigentes sin prefijo de catalogo', p.Prefijo, Filas = COUNT(*)
FROM dbo.Problem AS p
WHERE p.VigenteEnOrigen = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.CatPrefijoProblem AS cp WHERE cp.Prefijo = p.Prefijo)
GROUP BY p.Prefijo;

/* ¿Prefijo de la columna = primeras letras del Codigo? */
SELECT B7 = 'Prefijo vs Codigo', Coinciden = SUM(CASE WHEN p.Codigo LIKE p.Prefijo + ' %' THEN 1 ELSE 0 END),
       NoCoinciden = SUM(CASE WHEN p.Codigo LIKE p.Prefijo + ' %' THEN 0 ELSE 1 END)
FROM dbo.Problem AS p WHERE p.VigenteEnOrigen = 1;

/* ---------------------------------------------------------------------
   C) Fechas de compromiso de dbo.Problem
   --------------------------------------------------------------------- */
SELECT C1 = 'Columnas fecha/cambio de Problem', c.column_id, c.name, t.name AS tipo, c.is_nullable
FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Problem')
  AND (c.name LIKE '%Fecha%' OR c.name LIKE '%Compromiso%' OR c.name LIKE 'NroCambio%'
       OR c.name LIKE '%Modific%' OR c.name LIKE '%Usuario%' OR c.name LIKE 'Hash%')
ORDER BY c.column_id;

/* Mismo vistazo en ProblemCategoria (por si la fecha vive por categoria). */
SELECT C2 = 'Columnas fecha/cambio de ProblemCategoria', c.column_id, c.name, t.name AS tipo, c.is_nullable
FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.ProblemCategoria')
  AND (c.name LIKE '%Fecha%' OR c.name LIKE '%Compromiso%' OR c.name LIKE 'NroCambio%')
ORDER BY c.column_id;

/* Que tan seguido cambian hoy: distribucion de los contadores en vigentes. */
SELECT C3 = 'NroCambioFecha* en vigentes',
       ConCambioAnalisis = SUM(CASE WHEN NroCambioFechaAnalisis > 0 THEN 1 ELSE 0 END),
       ConCambioSolucion = SUM(CASE WHEN NroCambioFechaSolucion > 0 THEN 1 ELSE 0 END),
       ConCambioCierre   = SUM(CASE WHEN NroCambioFechaCierre   > 0 THEN 1 ELSE 0 END),
       MaxAnalisis = MAX(NroCambioFechaAnalisis), MaxSolucion = MAX(NroCambioFechaSolucion),
       MaxCierre = MAX(NroCambioFechaCierre), Vigentes = COUNT(*)
FROM dbo.Problem WHERE VigenteEnOrigen = 1;

/* Objetos de la base que ESCRIBEN Problem o sus fechas (el loader y lo
   que haya). Solo el nombre; la definicion no se copia aqui. */
SELECT C4 = 'Modulos que escriben Problem', OBJECT_SCHEMA_NAME(m.object_id) AS esquema,
       OBJECT_NAME(m.object_id) AS objeto, o.type_desc, o.modify_date,
       MencionaFechaSolucion = CASE WHEN m.definition LIKE '%FechaSolucion%' THEN 1 ELSE 0 END,
       MencionaNroCambio     = CASE WHEN m.definition LIKE '%NroCambioFecha%' THEN 1 ELSE 0 END
FROM sys.sql_modules AS m JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE '%UPDATE%Problem%' OR m.definition LIKE '%INSERT%Problem%'
   OR m.definition LIKE '%MERGE%Problem%'
ORDER BY objeto;

/* ---------------------------------------------------------------------
   D) Numero de solicitud: ¿ya hay algo?
   --------------------------------------------------------------------- */
SELECT D1 = 'Esquema adm', Existe = CASE WHEN SCHEMA_ID('adm') IS NULL THEN 0 ELSE 1 END;

SELECT D2 = 'Secuencias', SCHEMA_NAME(s.schema_id) AS esquema, s.name, s.current_value
FROM sys.sequences AS s;

SELECT D3 = 'Tablas candidatas (Solicitud/Contador/Folio/Consecutivo)',
       SCHEMA_NAME(t.schema_id) AS esquema, t.name, t.create_date
FROM sys.tables AS t
WHERE t.name LIKE '%Solicitud%' OR t.name LIKE '%Contador%' OR t.name LIKE '%Consecutiv%'
   OR t.name LIKE '%Folio%' OR t.name LIKE '%Request%' OR SCHEMA_NAME(t.schema_id) = 'adm'
ORDER BY esquema, t.name;

/* ---------------------------------------------------------------------
   F) Auditoria / historial reutilizable
   --------------------------------------------------------------------- */
SELECT F1 = 'Triggers', OBJECT_SCHEMA_NAME(tr.parent_id) AS esquema,
       OBJECT_NAME(tr.parent_id) AS tabla, tr.name, tr.is_disabled
FROM sys.triggers AS tr WHERE tr.parent_class = 1
ORDER BY tabla;

SELECT F2 = 'Tablas temporales (system-versioned)', SCHEMA_NAME(t.schema_id) AS esquema,
       t.name, t.temporal_type_desc, OBJECT_NAME(t.history_table_id) AS historial
FROM sys.tables AS t WHERE t.temporal_type <> 0;

SELECT F3 = 'CDC / Change Tracking en la base', name,
       is_cdc_enabled,
       ChangeTracking = CASE WHEN EXISTS (SELECT 1 FROM sys.change_tracking_databases WHERE database_id = DB_ID()) THEN 1 ELSE 0 END
FROM sys.databases WHERE database_id = DB_ID();

SELECT F4 = 'Tablas con Change Tracking', OBJECT_SCHEMA_NAME(object_id) AS esquema, OBJECT_NAME(object_id) AS tabla
FROM sys.change_tracking_tables;

SELECT F5 = 'Tablas tipo bitacora', SCHEMA_NAME(t.schema_id) AS esquema, t.name, t.create_date
FROM sys.tables AS t
WHERE t.name LIKE '%Hist%' OR t.name LIKE '%Log%' OR t.name LIKE '%Audit%'
   OR t.name LIKE '%Bitacora%' OR t.name LIKE '%Evento%' OR t.name LIKE '%Cambio%'
ORDER BY esquema, t.name;

/* Columnas de esas tablas, para ver si alguna sirve (campo, antes,
   despues, cuando, quien). */
SELECT F6 = 'Columnas de tablas tipo bitacora', SCHEMA_NAME(t.schema_id) AS esquema, t.name AS tabla,
       c.column_id, c.name, ty.name AS tipo, c.max_length
FROM sys.tables AS t
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE t.name LIKE '%Hist%' OR t.name LIKE '%Log%' OR t.name LIKE '%Audit%'
   OR t.name LIKE '%Bitacora%' OR t.name LIKE '%Evento%' OR t.name LIKE '%Cambio%'
ORDER BY esquema, tabla, c.column_id;
