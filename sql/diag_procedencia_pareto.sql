/* =========================================================================
   sql/diag_procedencia_pareto.sql - Quien creo y quien modifico
   dbo.usp_CorreoServicio_Pareto (y sus dos hermanos), y quien lo ejecuta.

   Para correr en SSMS contra AZVMBDCENTRALQA (un solo lote, F5, Results to
   Grid). Cada grilla empieza con la columna "Seccion".

   QUE SE BUSCA (fechas de sys.objects, hora del servidor, UTC-6):
     usp_CorreoServicio_Pareto            creado 2026-11-03 12:52:44, modificado 2026-11-05 18:01:28
     usp_CorreoServicio_TicketsCategoria  creado 2026-11-06 11:40:10, modificado 2026-11-06 11:50:29
     usp_CorreoServicio_TicketsGrupo      creado 2026-11-06 11:51:33

   SECCIONES
     T  Default Trace: si esta encendido, que periodo cubren sus archivos y
        los eventos Object:Created (46) / Object:Altered (164) /
        Object:Deleted (47) de esos objetos con LoginName, NTUserName,
        HostName y ApplicationName. Tambien todos los DDL de la base entre
        el 2026-11-03 y el 2026-11-07 (contexto: que mas se hizo en esa
        sesion). Si los archivos ya no llegan al 3 o 5 de noviembre, el
        trace no sirve y T1 lo dice.
     A  SQL Server Audit: auditorias de servidor y de base, si hay; si alguna
        escribe a archivo, sus eventos sobre estos objetos.
     D  Otros mecanismos que ya existan: triggers DDL de base y de servidor
        (con su definicion), tablas con nombre de bitacora, sesiones de
        Extended Events.
     Q  Query Store: si esta encendido, cuando se ejecutaron por primera y
        ultima vez las consultas DE DENTRO de los tres procedimientos y en
        que horas (un patron diario a la misma hora apunta a un proceso
        programado, p. ej. un correo). No guarda el login.
     M  Metadatos del objeto: dueño, propiedades extendidas, SET con que se
        compilo (QUOTED_IDENTIFIER OFF suele indicar sqlcmd; ON, SSMS o .NET)
        y los objetos de la base creados o modificados del 2026-11-01 al
        2026-11-07.

   ES DE SOLO LECTURA
   - Solo SELECT sobre vistas y funciones de sistema (sys.*, msdb,
     fn_trace_gettable, fn_get_audit_file) y escritura a VARIABLES DE TABLA
     de esta conexion. No enciende ni cambia trazas, auditorias, Query
     Store ni sesiones XE; no crea objetos; sin EXEC de procedimientos; sin
     SQL dinamico.
   - Permisos: T necesita ALTER TRACE; A, CONTROL SERVER para leer el
     archivo; Q, VIEW DATABASE STATE. Cada lectura va en TRY/CATCH: si falta
     un permiso, su grilla dice el error y el resto sigue.
   ========================================================================= */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

DECLARE @Objetos TABLE (Nombre SYSNAME PRIMARY KEY);
INSERT @Objetos VALUES (N'usp_CorreoServicio_Pareto'), (N'usp_CorreoServicio_TicketsCategoria'), (N'usp_CorreoServicio_TicketsGrupo');
DECLARE @Desde DATETIME = '2026-11-01T00:00:00', @Hasta DATETIME = '2026-11-08T00:00:00';

SELECT Seccion = '0 Contexto', Servidor = @@SERVERNAME, Base = DB_NAME(), Cuenta = SUSER_SNAME(),
       Version = CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(20)),
       HoraServidor = CONVERT(VARCHAR(19), SYSDATETIME(), 120), HoraUtc = CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120);

/* ------------------------------------------------------------------ T */
DECLARE @TraceOn INT = (SELECT CONVERT(INT, value_in_use) FROM sys.configurations WHERE name = N'default trace enabled');
DECLARE @TracePath NVARCHAR(520) = (SELECT path FROM sys.traces WHERE is_default = 1);
DECLARE @TraceBase NVARCHAR(520) =
    CASE WHEN @TracePath IS NULL THEN NULL
         ELSE REVERSE(SUBSTRING(REVERSE(@TracePath), CHARINDEX(N'\', REVERSE(@TracePath)), 520)) + N'log.trc' END;

DECLARE @T TABLE (StartTime DATETIME, EventClass INT, EventSubClass INT, DatabaseName NVARCHAR(256), ObjectName NVARCHAR(256),
                  ObjectType INT, LoginName NVARCHAR(256), SessionLoginName NVARCHAR(256), NTDomainName NVARCHAR(256),
                  NTUserName NVARCHAR(256), HostName NVARCHAR(256), ApplicationName NVARCHAR(256), SPID INT);
DECLARE @TCobertura TABLE (Primero DATETIME, Ultimo DATETIME, Eventos INT);
DECLARE @TError NVARCHAR(4000) = NULL;

IF @TraceBase IS NOT NULL
BEGIN
BEGIN TRY
    INSERT @TCobertura SELECT MIN(StartTime), MAX(StartTime), COUNT(*) FROM sys.fn_trace_gettable(@TraceBase, DEFAULT);
    INSERT @T
    SELECT StartTime, EventClass, EventSubClass, DatabaseName, ObjectName, ObjectType, LoginName, SessionLoginName,
           NTDomainName, NTUserName, HostName, ApplicationName, SPID
    FROM sys.fn_trace_gettable(@TraceBase, DEFAULT)
    WHERE EventClass IN (46, 47, 164)
      AND (DatabaseName = DB_NAME() OR DatabaseID = DB_ID())
      AND (ObjectName IN (SELECT Nombre FROM @Objetos) OR (StartTime >= '2026-11-03' AND StartTime < '2026-11-07'));
END TRY
BEGIN CATCH
    SET @TError = ERROR_MESSAGE();
END CATCH;
END;

SELECT Seccion = 'T1 Default Trace', Encendido = @TraceOn, ArchivoActual = @TracePath, LeidoDesde = @TraceBase,
       PrimerEvento = CONVERT(VARCHAR(19), c.Primero, 120), UltimoEvento = CONVERT(VARCHAR(19), c.Ultimo, 120), c.Eventos,
       CubreCreacion = CASE WHEN c.Primero <= '2026-11-03T12:52:44' THEN 'SI' ELSE 'NO' END,
       CubreModificacion = CASE WHEN c.Primero <= '2026-11-05T18:01:28' THEN 'SI' ELSE 'NO' END,
       Error = @TError
FROM (SELECT 1 AS x) AS uno LEFT JOIN @TCobertura AS c ON 1 = 1;

SELECT Seccion = 'T2 DDL de los tres SP', Hora = CONVERT(VARCHAR(23), StartTime, 121),
       Evento = CASE EventClass WHEN 46 THEN 'Object:Created' WHEN 164 THEN 'Object:Altered' WHEN 47 THEN 'Object:Deleted' END,
       Fase = CASE EventSubClass WHEN 0 THEN 'Begin' WHEN 1 THEN 'Commit' WHEN 2 THEN 'Rollback' ELSE CAST(EventSubClass AS VARCHAR(5)) END,
       ObjectName, LoginName, SessionLoginName, NTDomainName, NTUserName, HostName, ApplicationName, SPID
FROM @T WHERE ObjectName IN (SELECT Nombre FROM @Objetos)
ORDER BY StartTime;

SELECT TOP (300) Seccion = 'T3 Todo el DDL de la base 2026-11-03..06', Hora = CONVERT(VARCHAR(23), StartTime, 121),
       Evento = CASE EventClass WHEN 46 THEN 'Object:Created' WHEN 164 THEN 'Object:Altered' WHEN 47 THEN 'Object:Deleted' END,
       Fase = EventSubClass, ObjectName, ObjectType, LoginName, NTUserName, HostName, ApplicationName, SPID
FROM @T WHERE StartTime >= '2026-11-03' AND StartTime < '2026-11-07' AND EventSubClass IN (0, 1)
ORDER BY StartTime;

/* ------------------------------------------------------------------ A */
SELECT Seccion = 'A1 Auditorias de servidor', a.name, a.type_desc, a.is_state_enabled, f.log_file_path, f.log_file_name
FROM sys.server_audits AS a LEFT JOIN sys.server_file_audits AS f ON f.audit_id = a.audit_id;

SELECT Seccion = 'A2 Especificaciones', Nivel = 'Servidor', s.name, s.is_state_enabled, d.audit_action_name, d.class_desc
FROM sys.server_audit_specifications AS s JOIN sys.server_audit_specification_details AS d ON d.server_specification_id = s.server_specification_id
UNION ALL
SELECT 'A2 Especificaciones', 'Base', s.name, s.is_state_enabled, d.audit_action_name, d.class_desc
FROM sys.database_audit_specifications AS s JOIN sys.database_audit_specification_details AS d ON d.database_specification_id = s.database_specification_id;

DECLARE @A TABLE (Hora DATETIME2(3), Accion NVARCHAR(100), Objeto NVARCHAR(256), Login NVARCHAR(256), Servidor NVARCHAR(256),
                  Aplicacion NVARCHAR(256), Sentencia NVARCHAR(4000));
DECLARE @AError NVARCHAR(4000) = NULL, @AudPath NVARCHAR(520);
SELECT TOP (1) @AudPath = f.log_file_path + N'*'
FROM sys.server_audits AS a JOIN sys.server_file_audits AS f ON f.audit_id = a.audit_id
WHERE a.is_state_enabled = 1;
IF @AudPath IS NOT NULL
BEGIN
BEGIN TRY
    INSERT @A
    SELECT event_time, action_id, object_name, server_principal_name, server_instance_name, application_name, LEFT(statement, 4000)
    FROM sys.fn_get_audit_file(@AudPath, DEFAULT, DEFAULT)
    WHERE object_name IN (SELECT Nombre FROM @Objetos);
END TRY
BEGIN CATCH
    SET @AError = ERROR_MESSAGE();
END CATCH;
END;
SELECT Seccion = 'A3 Eventos de auditoria', ArchivoLeido = @AudPath, Error = @AError, Hora = CONVERT(VARCHAR(23), a.Hora, 121),
       a.Accion, a.Objeto, a.Login, a.Aplicacion, a.Sentencia
FROM (SELECT 1 AS x) AS uno LEFT JOIN @A AS a ON 1 = 1
ORDER BY a.Hora;

/* ------------------------------------------------------------------ D */
SELECT Seccion = 'D1 Triggers DDL de base', t.name, t.is_disabled, Creado = CONVERT(VARCHAR(19), t.create_date, 120),
       Definicion = (SELECT OBJECT_DEFINITION(t.object_id) AS [processing-instruction(definicion)] FOR XML PATH(''), TYPE)
FROM sys.triggers AS t WHERE t.parent_class = 0;

SELECT Seccion = 'D2 Triggers de servidor', t.name, t.is_disabled, Creado = CONVERT(VARCHAR(19), t.create_date, 120)
FROM sys.server_triggers AS t;

SELECT Seccion = 'D3 Tablas con nombre de bitacora', Tabla = SCHEMA_NAME(t.schema_id) + '.' + t.name,
       Filas = (SELECT SUM(p.rows) FROM sys.partitions AS p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)),
       Creada = CONVERT(VARCHAR(19), t.create_date, 120)
FROM sys.tables AS t
WHERE t.name LIKE N'%DDL%' OR t.name LIKE N'%Audit%' OR t.name LIKE N'%Auditoria%' OR t.name LIKE N'%Bitacora%'
   OR t.name LIKE N'%Despliegue%' OR t.name LIKE N'%Deploy%' OR t.name LIKE N'%Version%' OR t.name LIKE N'%Cambio%'
ORDER BY t.name;

SELECT Seccion = 'D4 Sesiones XE', s.name, Eventos = (SELECT STUFF((SELECT N', ' + e.name FROM sys.server_event_session_events AS e
                                         WHERE e.event_session_id = s.event_session_id FOR XML PATH('')), 1, 2, N'')),
       Activa = CASE WHEN EXISTS (SELECT 1 FROM sys.dm_xe_sessions AS x WHERE x.name = s.name) THEN 1 ELSE 0 END
FROM sys.server_event_sessions AS s;

/* ------------------------------------------------------------------ Q */
DECLARE @Q TABLE (Procedimiento SYSNAME, Primera DATETIMEOFFSET, Ultima DATETIMEOFFSET, Ejecuciones BIGINT, HoraDelDia INT, EjecucionesHora BIGINT);
DECLARE @QError NVARCHAR(4000) = NULL;
DECLARE @QEstado NVARCHAR(60) = (SELECT actual_state_desc FROM sys.database_query_store_options);
BEGIN TRY
    INSERT @Q
    SELECT OBJECT_NAME(q.object_id), MIN(rs.first_execution_time), MAX(rs.last_execution_time), SUM(rs.count_executions),
           DATEPART(HOUR, SWITCHOFFSET(rs.first_execution_time, '-06:00')), SUM(rs.count_executions)
    FROM sys.query_store_query AS q
    JOIN sys.query_store_plan AS p ON p.query_id = q.query_id
    JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
    WHERE q.object_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos)
    GROUP BY OBJECT_NAME(q.object_id), DATEPART(HOUR, SWITCHOFFSET(rs.first_execution_time, '-06:00'));
END TRY
BEGIN CATCH
    SET @QError = ERROR_MESSAGE();
END CATCH;

SELECT Seccion = 'Q1 Query Store resumen', Estado = @QEstado, Error = @QError, q.Procedimiento,
       PrimeraEjecucion = CONVERT(VARCHAR(19), MIN(q.Primera), 120), UltimaEjecucion = CONVERT(VARCHAR(19), MAX(q.Ultima), 120),
       Ejecuciones = SUM(q.Ejecuciones)
FROM (SELECT 1 AS x) AS uno LEFT JOIN @Q AS q ON 1 = 1
GROUP BY q.Procedimiento;

SELECT Seccion = 'Q2 Ejecuciones por hora del dia (Mexico)', Procedimiento, HoraDelDia, Ejecuciones = SUM(EjecucionesHora)
FROM @Q GROUP BY Procedimiento, HoraDelDia ORDER BY Procedimiento, HoraDelDia;

/* ------------------------------------------------------------------ M */
SELECT Seccion = 'M1 Objeto', o.name, Esquema = SCHEMA_NAME(o.schema_id),
       Dueno = USER_NAME(ISNULL(o.principal_id, (SELECT s.principal_id FROM sys.schemas AS s WHERE s.schema_id = o.schema_id))),
       Creado = CONVERT(VARCHAR(19), o.create_date, 120), Modificado = CONVERT(VARCHAR(19), o.modify_date, 120),
       m.uses_ansi_nulls, m.uses_quoted_identifier, m.is_schema_bound, m.execute_as_principal_id,
       PropiedadesExtendidas = (SELECT STUFF((SELECT N' | ' + ep.name + N'=' + CONVERT(NVARCHAR(400), ep.value)
                                              FROM sys.extended_properties AS ep
                                              WHERE ep.major_id = o.object_id FOR XML PATH('')), 1, 3, N''))
FROM sys.objects AS o JOIN sys.sql_modules AS m ON m.object_id = o.object_id
WHERE o.name IN (SELECT Nombre FROM @Objetos)
   OR o.name LIKE N'usp[_]CorreoServicio[_]%' OR o.name = N'vw_ServicioTickets'
ORDER BY o.create_date;

SELECT Seccion = 'M2 Objetos creados o modificados 2026-11-01..07', o.name, o.type_desc,
       Creado = CONVERT(VARCHAR(19), o.create_date, 120), Modificado = CONVERT(VARCHAR(19), o.modify_date, 120)
FROM sys.objects AS o
WHERE o.is_ms_shipped = 0
  AND ((o.create_date >= @Desde AND o.create_date < @Hasta) OR (o.modify_date >= @Desde AND o.modify_date < @Hasta))
ORDER BY CASE WHEN o.create_date >= @Desde THEN o.create_date ELSE o.modify_date END;

SELECT Seccion = 'M3 Usuarios de la base con permiso de crear o alterar', Principal = dp.name, dp.type_desc,
       Via = 'rol ' + r.name
FROM sys.database_role_members AS rm
JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals AS dp ON dp.principal_id = rm.member_principal_id
WHERE r.name IN (N'db_owner', N'db_ddladmin')
UNION ALL
SELECT 'M3 Usuarios de la base con permiso de crear o alterar', pr.name, pr.type_desc, p.permission_name + ' ' + p.state_desc
FROM sys.database_permissions AS p JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE p.permission_name IN (N'ALTER', N'CREATE PROCEDURE', N'CONTROL', N'ALTER ANY SCHEMA')
ORDER BY 2;
