/* =========================================================================
   sql/diag_acuse_identidad_po_so.sql - SOLO LECTURA (ningun INSERT, UPDATE,
   DELETE ni DDL). Para correr en la VM ANTES de aprobar el acuse PO/SO
   (sql/PROPUESTA_acuse_po_so.md, decision de identidad).

   Pregunta: con lo que YA esta en la base, se puede saber de forma unica
   que cuenta Windows es el PO (dbo.Problem.OwnerProblem) o el SO
   (OwnerServicio) de una iniciativa?

   La unica cadena automatica que existe hoy en el sitio:
     cuenta IIS -> dbo.UsuariosAdmin.Usuario (ADM/MOD; solo ellos entran a
     Admin y el acuse NO da acceso nuevo) -> CorreoUsuario (guardado) ->
     dbo.CatPersona.Correo (vigente) -> CatPersona.Nombre -> igual al nombre
     capturado en OwnerProblem / OwnerServicio.
   Y la que usa la cabecera (IdentidadWindows.CorreoCandidato):
     cuenta + '@soriana.com' -> CatPersona.Correo. Es solo un candidato.

   Los nombres se comparan sin mayusculas, acentos ni espacios a los lados
   (COLLATE Latin1_General_CI_AI). Es una APROXIMACION de
   DirectorioOrganizacional.Normaliza (que ademas colapsa espacios
   internos): sirve para medir, no para autorizar.

   RESULTADO EN LA VM (2026-10-22, corrido por el usuario)
     6 ADM/MOD: 2 resueltos por cuenta@soriana.com Y por CorreoUsuario
     (jesuscamor = PO de 12 activas, edgarrad = SO de 10); los otros 4 sin
     persona. Los 20 PO y 22 SO de activas: exactamente 1 persona con su
     nombre cada uno (ningun ambiguo ni no_encontrado); 40 sin usuario ADM/MOD.
   METODO ELEGIDO: cuenta@soriana.com (IdentidadWindows.CorreoCandidato) ->
     CatPersona (exactamente 1) -> nombre = OwnerProblem / OwnerServicio
     (App_Code/AcuseIniciativa.cs). Ver sql/PROPUESTA_acuse_po_so.md.

   Seccion 1: cada usuario ADM/MOD y hasta donde llega su cadena.
   Seccion 2: cada PO/SO capturado en iniciativas activas y si hay un
              usuario ADM/MOD unico que lo sea.
   Seccion 3: resumen.
   ========================================================================= */
SET NOCOUNT ON;

IF OBJECT_ID(N'tempdb..#per') IS NOT NULL DROP TABLE #per;
IF OBJECT_ID(N'tempdb..#usr') IS NOT NULL DROP TABLE #usr;
IF OBJECT_ID(N'tempdb..#own') IS NOT NULL DROP TABLE #own;

SELECT LTRIM(RTRIM(Nombre)) AS Nombre, LOWER(LTRIM(RTRIM(Correo))) AS Correo
INTO #per
FROM dbo.CatPersona
WHERE VigenteEnOrigen = 1 AND NULLIF(LTRIM(RTRIM(Nombre)), N'') IS NOT NULL;

SELECT u.Usuario, u.Acceso,
       LOWER(LTRIM(RTRIM(u.CorreoUsuario))) AS CorreoUsuario,
       LOWER(CASE WHEN CHARINDEX(N'\', u.Usuario) > 0
                  THEN SUBSTRING(u.Usuario, CHARINDEX(N'\', u.Usuario) + 1, 256) ELSE u.Usuario END) + N'@soriana.com' AS CorreoCandidato
INTO #usr
FROM dbo.UsuariosAdmin AS u
WHERE u.Acceso IN (N'ADM', N'MOD');

SELECT x.Rol, MIN(LTRIM(RTRIM(x.Nombre))) AS Nombre, COUNT(*) AS Iniciativas
INTO #own
FROM (SELECT 'PO' AS Rol, OwnerProblem AS Nombre, Estado FROM dbo.Problem WHERE VigenteEnOrigen = 1
      UNION ALL
      SELECT 'SO', OwnerServicio, Estado FROM dbo.Problem WHERE VigenteEnOrigen = 1) AS x
WHERE NULLIF(LTRIM(RTRIM(x.Nombre)), N'') IS NOT NULL
  AND x.Estado COLLATE Latin1_General_CI_AI IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
GROUP BY x.Rol, LTRIM(RTRIM(x.Nombre)) COLLATE Latin1_General_CI_AI;

/* ---------- 1. Usuarios ADM/MOD ---------- */
SELECT u.Usuario, u.Acceso,
       CASE WHEN u.CorreoUsuario IS NULL OR u.CorreoUsuario = N'' THEN 'sin CorreoUsuario' ELSE 'con CorreoUsuario' END AS Correo,
       (SELECT COUNT(*) FROM #per p WHERE p.Correo = u.CorreoUsuario) AS PersonasPorCorreoUsuario,
       (SELECT COUNT(*) FROM #per p WHERE p.Correo = u.CorreoCandidato) AS PersonasPorCorreoCandidato,
       (SELECT TOP (1) p.Nombre FROM #per p WHERE p.Correo = u.CorreoUsuario
         AND (SELECT COUNT(*) FROM #per q WHERE q.Correo = u.CorreoUsuario) = 1) AS NombreSiUnico,
       (SELECT SUM(o.Iniciativas) FROM #own o
         WHERE o.Rol = 'PO' AND o.Nombre COLLATE Latin1_General_CI_AI IN
               (SELECT p.Nombre COLLATE Latin1_General_CI_AI FROM #per p WHERE p.Correo = u.CorreoUsuario)) AS ActivasComoPO,
       (SELECT SUM(o.Iniciativas) FROM #own o
         WHERE o.Rol = 'SO' AND o.Nombre COLLATE Latin1_General_CI_AI IN
               (SELECT p.Nombre COLLATE Latin1_General_CI_AI FROM #per p WHERE p.Correo = u.CorreoUsuario)) AS ActivasComoSO
FROM #usr AS u
ORDER BY u.Acceso, u.Usuario;

/* ---------- 2. PO/SO capturados en iniciativas activas ---------- */
SELECT o.Rol, o.Nombre, o.Iniciativas,
       (SELECT COUNT(*) FROM #per p WHERE p.Nombre COLLATE Latin1_General_CI_AI = o.Nombre COLLATE Latin1_General_CI_AI) AS PersonasConEseNombre,
       (SELECT COUNT(DISTINCT u.Usuario) FROM #usr u INNER JOIN #per p ON p.Correo = u.CorreoUsuario
         WHERE p.Nombre COLLATE Latin1_General_CI_AI = o.Nombre COLLATE Latin1_General_CI_AI) AS UsuariosAdmModQueLoSon,
       CASE WHEN (SELECT COUNT(*) FROM #per p WHERE p.Nombre COLLATE Latin1_General_CI_AI = o.Nombre COLLATE Latin1_General_CI_AI) = 0 THEN 'no_encontrado'
            WHEN (SELECT COUNT(*) FROM #per p WHERE p.Nombre COLLATE Latin1_General_CI_AI = o.Nombre COLLATE Latin1_General_CI_AI) > 1 THEN 'ambiguo'
            WHEN (SELECT COUNT(DISTINCT u.Usuario) FROM #usr u INNER JOIN #per p ON p.Correo = u.CorreoUsuario
                   WHERE p.Nombre COLLATE Latin1_General_CI_AI = o.Nombre COLLATE Latin1_General_CI_AI) = 1 THEN 'resuelto'
            ELSE 'sin_usuario_admin' END AS Resultado
FROM #own AS o
ORDER BY o.Rol, o.Iniciativas DESC, o.Nombre;

/* ---------- 3. Resumen ---------- */
SELECT r.Rol, r.Resultado, COUNT(*) AS Personas, SUM(r.Iniciativas) AS Iniciativas
FROM (
    SELECT o.Rol, o.Iniciativas,
           CASE WHEN n.Personas = 0 THEN 'no_encontrado'
                WHEN n.Personas > 1 THEN 'ambiguo'
                WHEN n.Usuarios = 1 THEN 'resuelto'
                ELSE 'sin_usuario_admin' END AS Resultado
    FROM #own AS o
    CROSS APPLY (SELECT (SELECT COUNT(*) FROM #per p WHERE p.Nombre COLLATE Latin1_General_CI_AI = o.Nombre COLLATE Latin1_General_CI_AI) AS Personas,
                        (SELECT COUNT(DISTINCT u.Usuario) FROM #usr u INNER JOIN #per p ON p.Correo = u.CorreoUsuario
                          WHERE p.Nombre COLLATE Latin1_General_CI_AI = o.Nombre COLLATE Latin1_General_CI_AI) AS Usuarios) AS n
) AS r
GROUP BY r.Rol, r.Resultado
ORDER BY r.Rol, r.Resultado;

DROP TABLE #per; DROP TABLE #usr; DROP TABLE #own;
