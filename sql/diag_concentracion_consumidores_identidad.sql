/* =========================================================================
   sql/diag_concentracion_consumidores_identidad.sql

   Para correr en SSMS (un solo lote, F5, Results to Grid) cuando el dueño
   lo decida. NO lo corrio nadie todavia.

   OBJETIVO: lo que los repositorios NO pueden contestar.
     U) Quien mas usa dbo.usp_CorreoServicio_Pareto dentro de SQL Server:
        U1 otros objetos de la base que lo nombran (dependencias y texto);
        U2 pasos de jobs del SQL Agent que lo nombran (msdb);
        U3 cuantas veces se ha ejecutado desde que esta en la cache de
           planes y cuando fue la ultima. OJO: incluye las ejecuciones de
           sql/diag_concentracion_tickets_2.sql (2026-11-09 ~10:33, slots 0
           y 12) y las que haga la pestaña o diag_82. Si hay MAS ejecuciones
           que esas, alguien mas lo llama;
        U4 sesiones conectadas AHORA que lo estan ejecutando.
        Nada de esto ve a quien lo llamo y ya se desconecto, ni a otras
        bases o servidores, ni un Power BI / Excel / script que lo llame
        de vez en cuando: un resultado vacio NO prueba que no haya
        consumidores externos.
     I) Con que login se conecta el sitio del tablero: las sesiones abiertas
        por SqlClient (.NET) con su login y equipo. El sitio usa la cadena
        "TicketsProactivanet" de su Web.config; aqui se ve si llega como el
        usuario SQL PROACTIVANETAD o como una cuenta Windows. Abre el
        tablero en el servidor justo antes de correrlo para que haya sesion.

   ES DE SOLO LECTURA: solo SELECT sobre vistas de sistema (sys.*, msdb).
   Sin DDL, sin DML, sin EXEC de procedimientos, sin SQL dinamico. U2 y U3
   necesitan permiso de lectura en msdb y VIEW SERVER STATE; si falta, esa
   grilla da error y las demas siguen.
   ========================================================================= */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

SELECT Seccion = '0 Contexto', Servidor = @@SERVERNAME, Base = DB_NAME(), Cuenta = SUSER_SNAME(),
       Hora = CONVERT(VARCHAR(19), SYSDATETIME(), 120);

-- U1a: dependencias declaradas (otros objetos que lo referencian)
SELECT Seccion = 'U1a Dependencias', Objeto = OBJECT_SCHEMA_NAME(d.referencing_id) + '.' + OBJECT_NAME(d.referencing_id),
       Tipo = o.type_desc
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
WHERE d.referenced_id = OBJECT_ID(N'dbo.usp_CorreoServicio_Pareto');

-- U1b: texto de modulos que lo nombran (cubre llamadas armadas en texto)
SELECT Seccion = 'U1b Texto de modulos', Objeto = OBJECT_SCHEMA_NAME(m.object_id) + '.' + OBJECT_NAME(m.object_id),
       Tipo = o.type_desc, Modificado = CONVERT(VARCHAR(19), o.modify_date, 120)
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE N'%usp[_]CorreoServicio[_]Pareto%'
  AND m.object_id <> OBJECT_ID(N'dbo.usp_CorreoServicio_Pareto');

-- U2: pasos de jobs del SQL Agent
SELECT Seccion = 'U2 Jobs', Job = j.name, Habilitado = j.enabled, Paso = s.step_name, Subsistema = s.subsystem,
       Base = s.database_name
FROM msdb.dbo.sysjobsteps AS s
JOIN msdb.dbo.sysjobs AS j ON j.job_id = s.job_id
WHERE s.command LIKE N'%usp[_]CorreoServicio[_]Pareto%';

-- U3: ejecuciones registradas en la cache de planes (desde que se compilo)
SELECT Seccion = 'U3 Ejecuciones', Procedimiento = OBJECT_NAME(ps.object_id, ps.database_id),
       Ejecuciones = ps.execution_count,
       EnCacheDesde = CONVERT(VARCHAR(19), ps.cached_time, 120),
       UltimaEjecucion = CONVERT(VARCHAR(19), ps.last_execution_time, 120)
FROM sys.dm_exec_procedure_stats AS ps
WHERE ps.database_id = DB_ID()
  AND ps.object_id IN (OBJECT_ID(N'dbo.usp_CorreoServicio_Pareto'),
                       OBJECT_ID(N'dbo.usp_CorreoServicio_TicketsCategoria'),
                       OBJECT_ID(N'dbo.usp_CorreoServicio_TicketsGrupo'));

-- U4: quien lo esta ejecutando ahora mismo
SELECT Seccion = 'U4 Ejecutando ahora', s.session_id, s.login_name, s.host_name, s.program_name
FROM sys.dm_exec_requests AS r
JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
WHERE t.objectid = OBJECT_ID(N'dbo.usp_CorreoServicio_Pareto') AND t.dbid = DB_ID();

-- I: logins de las sesiones .NET (SqlClient) abiertas contra esta base
SELECT Seccion = 'I Sesiones SqlClient', s.login_name, TipoLogin = CASE WHEN s.nt_user_name = N'' THEN 'SQL' ELSE 'Windows' END,
       s.host_name, s.program_name, Sesiones = COUNT(*),
       UltimaActividad = CONVERT(VARCHAR(19), MAX(s.last_request_end_time), 120)
FROM sys.dm_exec_sessions AS s
WHERE s.database_id = DB_ID() AND s.program_name LIKE N'%SqlClient%'
GROUP BY s.login_name, CASE WHEN s.nt_user_name = N'' THEN 'SQL' ELSE 'Windows' END, s.host_name, s.program_name
ORDER BY s.login_name;
