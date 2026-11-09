/* =========================================================================
   sql/diag_concentracion_consumidores_identidad.sql

   Para correr en SSMS contra AZVMBDCENTRALQA (un solo lote, F5, Results to
   Grid). Cada grilla empieza con la columna "Seccion".

   OBJETIVO: lo que los repositorios NO pueden contestar.
     P) Que permisos tiene QUIEN corre el script: sin ellos varias grillas
        salen vacias o parciales, y P lo dice antes de leerlas.
     U) Quien mas usa dbo.usp_CorreoServicio_Pareto (y sus dos hermanos)
        dentro de ESTA instancia de SQL Server:
        U1 otros objetos de la base que lo nombran (dependencias y texto);
        U2 jobs del SQL Agent: pasos que lo nombran, y pasos que llaman a
           los scripts de correo por servicio (un job PowerShell/CmdExec
           que corre Enviar_CorreoServicio.ps1 no nombra el SP), con su
           horario y su ultima corrida;
        U3 ejecuciones en la cache de planes (desde que se compilo);
        U4 Query Store: primera y ultima ejecucion de las sentencias de
           dentro de los SP y a que hora del dia corren (un patron diario
           fijo apunta a un proceso programado);
        U5 sesiones que lo estan ejecutando AHORA.
        OJO con U3/U4: incluyen las ejecuciones que hicimos nosotros
        (diag_concentracion_tickets_2.sql, 2026-11-09 ~10:33, slots 0 y 12;
        y las de la pestaña si se probo). Si hay MAS que esas, alguien mas
        lo llama.
     I) Con que login se conecta el sitio del tablero: sesiones .NET
        (SqlClient) abiertas contra esta base, con login, tipo (SQL /
        Windows) y equipo. Abre el tablero justo antes de correrlo para
        que haya sesion; el pool de conexiones la deja abierta unos minutos.

   ES DE SOLO LECTURA
   - Solo SELECT sobre vistas y funciones de sistema (sys.*, msdb.dbo.*) y
     escritura a VARIABLES DE TABLA de esta conexion.
   - No crea ni cambia objetos, permisos, jobs, trazas, auditorias ni
     Query Store; sin EXEC de procedimientos; sin SQL dinamico.
   - Cada lectura que necesita un permiso especial va en TRY/CATCH: si
     falta, su grilla trae el error en la columna Error y el resto sigue.

   PERMISOS POR GRILLA (los muestra P)
     U1      basta con poder ver la definicion de los objetos (VIEW
             DEFINITION, db_owner la tiene).
     U2      leer msdb (SQLAgentReaderRole, sysadmin, o SELECT sobre
             msdb.dbo.sysjobs / sysjobsteps / sysjobschedules / sysjobhistory).
     U3, U5  VIEW SERVER STATE (en SQL Server 2022, VIEW SERVER PERFORMANCE
             STATE); sin el, la cache sale vacia y en U5 / I solo se ve la
             propia sesion.
     U4      VIEW DATABASE STATE (db_owner la tiene) y Query Store encendido.
     I       igual que U5: sin VIEW SERVER STATE solo se ve la propia sesion.
   ========================================================================= */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

DECLARE @Objetos TABLE (Nombre SYSNAME PRIMARY KEY);
INSERT @Objetos VALUES (N'usp_CorreoServicio_Pareto'), (N'usp_CorreoServicio_TicketsCategoria'), (N'usp_CorreoServicio_TicketsGrupo');

SELECT Seccion = '0 Contexto', Servidor = @@SERVERNAME, Base = DB_NAME(), Cuenta = SUSER_SNAME(),
       Version = CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(20)),
       Hora = CONVERT(VARCHAR(19), SYSDATETIME(), 120);

/* ------------------------------------------------------------------ P */
SELECT Seccion = 'P Permisos de quien corre el script',
       DbOwner = IS_ROLEMEMBER(N'db_owner'),
       Sysadmin = IS_SRVROLEMEMBER(N'sysadmin'),
       ViewServerState = HAS_PERMS_BY_NAME(NULL, NULL, N'VIEW SERVER STATE'),
       ViewDatabaseState = HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'VIEW DATABASE STATE'),
       LeeMsdbJobs = HAS_PERMS_BY_NAME(N'msdb.dbo.sysjobs', N'OBJECT', N'SELECT'),
       LeeMsdbPasos = HAS_PERMS_BY_NAME(N'msdb.dbo.sysjobsteps', N'OBJECT', N'SELECT'),
       QueryStore = (SELECT actual_state_desc FROM sys.database_query_store_options),
       -- Con AUTO_CLOSE = 1 la cache de planes (U3) se vacia cada vez que se
       -- cierra la ultima conexion: U3 vacio no significaria nada.
       AutoClose = (SELECT is_auto_close_on FROM sys.databases WHERE database_id = DB_ID()),
       ServidorIniciado = (SELECT CONVERT(VARCHAR(19), sqlserver_start_time, 120) FROM sys.dm_os_sys_info);

/* ------------------------------------------------------------------ U1 */
SELECT Seccion = 'U1a Dependencias', Referenciado = OBJECT_NAME(d.referenced_id),
       Objeto = OBJECT_SCHEMA_NAME(d.referencing_id) + '.' + OBJECT_NAME(d.referencing_id), Tipo = o.type_desc
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
WHERE d.referenced_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos);

SELECT Seccion = 'U1b Texto de otros modulos', Objeto = OBJECT_SCHEMA_NAME(m.object_id) + '.' + OBJECT_NAME(m.object_id),
       Tipo = o.type_desc, Modificado = CONVERT(VARCHAR(19), o.modify_date, 120)
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE (m.definition LIKE N'%usp[_]CorreoServicio[_]Pareto%'
    OR m.definition LIKE N'%usp[_]CorreoServicio[_]TicketsCategoria%'
    OR m.definition LIKE N'%usp[_]CorreoServicio[_]TicketsGrupo%')
  AND m.object_id NOT IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos);

/* ------------------------------------------------------------------ U2 */
DECLARE @J TABLE (Job SYSNAME, Habilitado TINYINT, Paso SYSNAME, Subsistema NVARCHAR(40), Base SYSNAME NULL,
                  NombraElSP BIT, NombraCorreoServicio BIT, Comando NVARCHAR(400),
                  Horarios NVARCHAR(400), UltimaCorrida VARCHAR(19), UltimoResultado VARCHAR(20));
DECLARE @JError NVARCHAR(4000) = NULL;
BEGIN TRY
    INSERT @J
    SELECT j.name, j.enabled, s.step_name, s.subsystem, s.database_name,
           CASE WHEN s.command LIKE N'%usp[_]CorreoServicio[_]%' THEN 1 ELSE 0 END,
           CASE WHEN s.command LIKE N'%CorreoServicio%' OR s.command LIKE N'%Correo%Servicio%' THEN 1 ELSE 0 END,
           LEFT(REPLACE(REPLACE(s.command, CHAR(13), N' '), CHAR(10), N' '), 400),
           (SELECT STUFF((SELECT N' | ' + sc.name + N' (activo=' + CAST(sc.enabled AS NVARCHAR(1))
                                 + N', freq_type=' + CAST(sc.freq_type AS NVARCHAR(10))
                                 + N', hora=' + CAST(sc.active_start_time AS NVARCHAR(10)) + N')'
                          FROM msdb.dbo.sysjobschedules AS js
                          JOIN msdb.dbo.sysschedules AS sc ON sc.schedule_id = js.schedule_id
                          WHERE js.job_id = j.job_id FOR XML PATH('')), 1, 3, N'')),
           (SELECT TOP (1) STUFF(STUFF(CAST(h.run_date AS VARCHAR(8)), 7, 0, '-'), 5, 0, '-') + ' '
                   + STUFF(STUFF(RIGHT('000000' + CAST(h.run_time AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':')
            FROM msdb.dbo.sysjobhistory AS h WHERE h.job_id = j.job_id AND h.step_id = 0 ORDER BY h.instance_id DESC),
           (SELECT TOP (1) CASE h.run_status WHEN 0 THEN 'Fallo' WHEN 1 THEN 'Exito' WHEN 2 THEN 'Reintento'
                                             WHEN 3 THEN 'Cancelado' ELSE CAST(h.run_status AS VARCHAR(5)) END
            FROM msdb.dbo.sysjobhistory AS h WHERE h.job_id = j.job_id AND h.step_id = 0 ORDER BY h.instance_id DESC)
    FROM msdb.dbo.sysjobsteps AS s
    JOIN msdb.dbo.sysjobs AS j ON j.job_id = s.job_id
    WHERE s.command LIKE N'%usp[_]CorreoServicio[_]%'
       OR s.command LIKE N'%CorreoServicio%'
       OR s.command LIKE N'%Correo%Servicio%';
END TRY
BEGIN CATCH
    SET @JError = ERROR_MESSAGE();
END CATCH;

SELECT Seccion = 'U2 Jobs del Agent', Error = @JError, j.*
FROM (SELECT 1 AS x) AS uno LEFT JOIN @J AS j ON 1 = 1
ORDER BY j.Job, j.Paso;

/* ------------------------------------------------------------------ U3 */
DECLARE @C TABLE (Procedimiento SYSNAME, Ejecuciones BIGINT, EnCacheDesde VARCHAR(19), UltimaEjecucion VARCHAR(19));
DECLARE @CError NVARCHAR(4000) = NULL;
BEGIN TRY
    INSERT @C
    SELECT OBJECT_NAME(ps.object_id, ps.database_id), ps.execution_count,
           CONVERT(VARCHAR(19), ps.cached_time, 120), CONVERT(VARCHAR(19), ps.last_execution_time, 120)
    FROM sys.dm_exec_procedure_stats AS ps
    WHERE ps.database_id = DB_ID()
      AND ps.object_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos);
END TRY
BEGIN CATCH
    SET @CError = ERROR_MESSAGE();
END CATCH;

SELECT Seccion = 'U3 Ejecuciones en cache', Error = @CError, c.*
FROM (SELECT 1 AS x) AS uno LEFT JOIN @C AS c ON 1 = 1;

/* ------------------------------------------------------------------ U4 */
DECLARE @Q TABLE (Procedimiento SYSNAME, Dia DATE, HoraDelDia INT, Ejecuciones BIGINT);
DECLARE @QError NVARCHAR(4000) = NULL;
BEGIN TRY
    INSERT @Q
    SELECT OBJECT_NAME(q.object_id),
           CONVERT(DATE, SWITCHOFFSET(i.start_time, '-06:00')),
           DATEPART(HOUR, SWITCHOFFSET(i.start_time, '-06:00')),
           SUM(rs.count_executions)
    FROM sys.query_store_query AS q
    JOIN sys.query_store_plan AS p ON p.query_id = q.query_id
    JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
    JOIN sys.query_store_runtime_stats_interval AS i ON i.runtime_stats_interval_id = rs.runtime_stats_interval_id
    WHERE q.object_id IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos)
    GROUP BY OBJECT_NAME(q.object_id), CONVERT(DATE, SWITCHOFFSET(i.start_time, '-06:00')),
             DATEPART(HOUR, SWITCHOFFSET(i.start_time, '-06:00'));
END TRY
BEGIN CATCH
    SET @QError = ERROR_MESSAGE();
END CATCH;

-- U4a: un renglon por procedimiento.
SELECT Seccion = 'U4a Query Store resumen', Error = @QError, q.Procedimiento,
       PrimerDia = MIN(q.Dia), UltimoDia = MAX(q.Dia), DiasConEjecuciones = COUNT(DISTINCT q.Dia),
       Ejecuciones = SUM(q.Ejecuciones)
FROM (SELECT 1 AS x) AS uno LEFT JOIN @Q AS q ON 1 = 1
GROUP BY q.Procedimiento;

-- U4b: cada dia y hora (Mexico) con ejecuciones. Ojo: 2026-11-09 incluye las nuestras.
SELECT Seccion = 'U4b Query Store por dia y hora', Procedimiento, Dia, HoraDelDia, Ejecuciones
FROM @Q ORDER BY Procedimiento, Dia, HoraDelDia;

/* ------------------------------------------------------------------ U5 */
DECLARE @S TABLE (session_id INT, login_name NVARCHAR(256), host_name NVARCHAR(256), program_name NVARCHAR(256), Inicio VARCHAR(19));
DECLARE @SError NVARCHAR(4000) = NULL;
BEGIN TRY
    INSERT @S
    SELECT s.session_id, s.login_name, s.host_name, s.program_name, CONVERT(VARCHAR(19), r.start_time, 120)
    FROM sys.dm_exec_requests AS r
    JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
    CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
    WHERE t.dbid = DB_ID() AND t.objectid IN (SELECT OBJECT_ID(N'dbo.' + Nombre) FROM @Objetos);
END TRY
BEGIN CATCH
    SET @SError = ERROR_MESSAGE();
END CATCH;

SELECT Seccion = 'U5 Ejecutando ahora', Error = @SError,
       VeTodasLasSesiones = HAS_PERMS_BY_NAME(NULL, NULL, N'VIEW SERVER STATE'), s.*
FROM (SELECT 1 AS x) AS uno LEFT JOIN @S AS s ON 1 = 1;

/* ------------------------------------------------------------------- I */
DECLARE @I TABLE (login_name NVARCHAR(256), TipoLogin VARCHAR(10), host_name NVARCHAR(256), program_name NVARCHAR(256),
                  Sesiones INT, UltimaActividad VARCHAR(19));
DECLARE @IError NVARCHAR(4000) = NULL;
BEGIN TRY
    INSERT @I
    SELECT s.login_name, CASE WHEN ISNULL(s.nt_user_name, N'') = N'' THEN 'SQL' ELSE 'Windows' END,
           s.host_name, s.program_name, COUNT(*), CONVERT(VARCHAR(19), MAX(s.last_request_end_time), 120)
    FROM sys.dm_exec_sessions AS s
    WHERE s.database_id = DB_ID() AND s.program_name LIKE N'%SqlClient%'
    GROUP BY s.login_name, CASE WHEN ISNULL(s.nt_user_name, N'') = N'' THEN 'SQL' ELSE 'Windows' END, s.host_name, s.program_name;
END TRY
BEGIN CATCH
    SET @IError = ERROR_MESSAGE();
END CATCH;

SELECT Seccion = 'I Sesiones SqlClient', Error = @IError,
       VeTodasLasSesiones = HAS_PERMS_BY_NAME(NULL, NULL, N'VIEW SERVER STATE'), i.*
FROM (SELECT 1 AS x) AS uno LEFT JOIN @I AS i ON 1 = 1
ORDER BY i.login_name;

SELECT Seccion = 'FIN', Mensaje = 'Diagnostico terminado';
