/* =========================================================================
   sql/diag_solicitudes_cambio.sql - diagnostico de sql/22. SOLO LECTURA
   (SELECT): se puede correr en la VM sin OK, antes y despues de sql/22.

   1  objetos de sql/22 y hash de los procedimientos
   2  historial: triggers que leen pfe_solicitud y columnas SolicitudId
   3  permisos de PROACTIVANETAD (DENY de _permisos.sql, EXECUTE sobre adm)
   4  solicitudes por estado; pendientes mas viejas (respaldo antes de un
      rollback)
   5  fallas al aplicar (ultimos 30 dias)
   6  consistencia: aplicadas sin historial, historial con SolicitudId que
      no existe, revisadas sin evento
   Antes de sql/22 las secciones 4-6 dicen "sql/22 no aplicada".
   ========================================================================= */
SET NOCOUNT ON;

-- 1. Objetos y hashes (regla de sql/20 y sql/21).
SELECT Seccion = 1, Objeto = v.Objeto,
       Existe = CASE WHEN OBJECT_ID(v.Objeto) IS NOT NULL OR TYPE_ID(v.Objeto) IS NOT NULL THEN 'SI' ELSE 'NO' END,
       Hash = CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                  OBJECT_DEFINITION(OBJECT_ID(v.Objeto)), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1),
       Esperado = v.Esperado,
       Lectura = CASE WHEN v.Esperado IS NULL THEN '' WHEN CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                  OBJECT_DEFINITION(OBJECT_ID(v.Objeto)), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1) = v.Esperado
                      THEN 'sql/22' WHEN v.Objeto = N'adm.usp_GestionAdmin_Modificar' AND CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                  OBJECT_DEFINITION(OBJECT_ID(v.Objeto)), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)
                      = '0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3' THEN 'sql/21 (22 sin aplicar)' ELSE 'OTRA: revisar' END
FROM (VALUES (N'adm.SolicitudCategoriaTipo', NULL),
             (N'adm.SolicitudCambio', NULL), (N'adm.SolicitudCambioCategoria', NULL), (N'adm.SolicitudCambioEvento', NULL),
             (N'adm.usp_GestionAdmin_Modificar', '0x8E0848187A529F6E0C2D9D8B30820F0EA19CCDEC7C7937EFB41BF33108084BA9'),
             (N'adm.usp_SolicitudCambio_Crear', '0xC72A0ABC9E5F63D4D5F41FBE5AD02E99438CE3BA376B4C968720BB0568C9EC7E'),
             (N'adm.usp_SolicitudCambio_Rechazar', '0xFC91FF5A0C7F5F445A1EEA168C20D696DE7D3D0943499D9EC1CF604F5987EF24'),
             (N'adm.usp_SolicitudCambio_Aplicar', '0xFD5E86A0903267BC4D09271CE96D44E560785CD47F3B359798FDF5399A2B0FF4')) AS v (Objeto, Esperado);

-- 2. Historial: quien llena SolicitudId.
SELECT Seccion = 2, Objeto = OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id),
       LeePfeSolicitud = CASE WHEN m.definition LIKE N'%pfe_solicitud%' THEN 'SI' ELSE 'NO' END
FROM sys.sql_modules AS m
WHERE m.object_id IN (OBJECT_ID('dbo.trg_Problem_FechaEvento'), OBJECT_ID('dbo.trg_Problem_EstadoEvento'),
                      OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento'), OBJECT_ID('adm.usp_GestionAdmin_Modificar'));
SELECT Seccion = 2, Tabla = v.Tabla,
       TieneSolicitudId = CASE WHEN COL_LENGTH(v.Tabla, 'SolicitudId') IS NOT NULL THEN 'SI' ELSE 'NO' END
FROM (VALUES (N'dbo.ProblemFechaEvento'), (N'dbo.ProblemEstadoEvento')) AS v (Tabla);

-- 3. Permisos del sitio.
SELECT Seccion = 3, Permiso = p.permission_name, Estado = p.state_desc,
       Sobre = CASE p.class WHEN 3 THEN N'SCHEMA::' + SCHEMA_NAME(p.major_id)
                            ELSE OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id) END
FROM sys.database_permissions AS p
WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
  AND ((p.class = 3 AND p.major_id = SCHEMA_ID(N'adm'))
       OR (p.class = 1 AND OBJECT_SCHEMA_NAME(p.major_id) = N'adm'))
ORDER BY Sobre, Permiso;

-- 4-6 solo si sql/22 esta aplicada (SQL dinamico: antes no compila).
IF OBJECT_ID('adm.SolicitudCambio', 'U') IS NULL
    SELECT Seccion = 4, Nota = 'sql/22 no aplicada';
ELSE
    EXEC (N'
SELECT Seccion = 4, Estado, Solicitudes = COUNT(*), MasVieja = MIN(FechaSolicitudUtc), MasReciente = MAX(FechaSolicitudUtc)
FROM adm.SolicitudCambio GROUP BY Estado ORDER BY Estado;
SELECT TOP (20) Seccion = 4, IdSolicitud, Codigo, Tipo, CampoFecha, SolicitadoPor, RolSolicitante, FechaSolicitudUtc, Intentos, UltimoError
FROM adm.SolicitudCambio WHERE Estado = ''PENDIENTE'' ORDER BY FechaSolicitudUtc;

SELECT Seccion = 5, e.Evento, Eventos = COUNT(*), Ultimo = MAX(e.FechaUtc)
FROM adm.SolicitudCambioEvento AS e
WHERE e.Evento IN (''FALLO_APLICAR'', ''DESACTUALIZADA'') AND e.FechaUtc >= DATEADD(DAY, -30, SYSUTCDATETIME())
GROUP BY e.Evento;

-- 6a aplicadas (no Otros) sin ninguna fila de historial ligada: normal
--    solo si la solicitud era de categorias sin cambio de fecha.
SELECT Seccion = 6, Revision = ''aplicada sin historial'', s.IdSolicitud, s.Tipo, s.Codigo
FROM adm.SolicitudCambio AS s
WHERE s.Estado = ''APLICADA'' AND s.Tipo IN (''FECHA'', ''ESTADO'')
  AND NOT EXISTS (SELECT 1 FROM dbo.ProblemFechaEvento AS f WHERE f.SolicitudId = s.IdSolicitud)
  AND NOT EXISTS (SELECT 1 FROM dbo.ProblemEstadoEvento AS e WHERE e.SolicitudId = s.IdSolicitud);
-- 6b historial con un SolicitudId que no existe (p. ej. tras un rollback).
SELECT Seccion = 6, Revision = ''historial sin solicitud'', f.SolicitudId, Filas = COUNT(*)
FROM (SELECT SolicitudId FROM dbo.ProblemFechaEvento WHERE SolicitudId IS NOT NULL
      UNION ALL SELECT SolicitudId FROM dbo.ProblemEstadoEvento WHERE SolicitudId IS NOT NULL) AS f
WHERE NOT EXISTS (SELECT 1 FROM adm.SolicitudCambio AS s WHERE s.IdSolicitud = f.SolicitudId)
GROUP BY f.SolicitudId;
-- 6c revisadas sin su evento final.
SELECT Seccion = 6, Revision = ''revisada sin evento'', s.IdSolicitud, s.Estado
FROM adm.SolicitudCambio AS s
WHERE s.Estado <> ''PENDIENTE''
  AND NOT EXISTS (SELECT 1 FROM adm.SolicitudCambioEvento AS e WHERE e.IdSolicitud = s.IdSolicitud AND e.Evento = s.Estado);');
