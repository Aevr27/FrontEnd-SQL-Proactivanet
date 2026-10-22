/* =========================================================================
   sql/diag_solicitud_iniciativa_correos.sql - SOLO LECTURA (SELECT).

   Antes de aplicar sql/29 y de encender IniciativasAbiertas: cuantos Product
   Owners de la cascada tienen UN correo claro en dbo.CatPersona, y si la
   base ya tiene las piezas de sql/29. No escribe nada; se puede correr en
   la VM sin aprobacion.

   La regla del sitio (App_Code/SolicitudIniciativaAlta.cs) compara nombres
   sin acentos, mayusculas ni espacios de mas (IdentidadAcuse.ClaveNombre);
   aqui se aproxima con COLLATE Latin1_General_CI_AI y LTRIM/RTRIM (no
   colapsa espacios dobles internos: puede dar algun "no_encontrado" que el
   sitio si resuelve).

   Secciones
     1  piezas de sql/29 y permisos de PROACTIVANETAD sobre adm
     2  POs vigentes de CatCategoriaDueno: estado de su correo
     3  resumen de la seccion 2
     4  correos repetidos en CatPersona (vigente): esas cuentas no pueden
        solicitar (ambiguo)
   ========================================================================= */
SET NOCOUNT ON;

/* 1 --------------------------------------------------------------------- */
SELECT Seccion = 1,
       Contador  = CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaContador', N'U') IS NULL THEN 0 ELSE 1 END,
       Solicitud = CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NULL THEN 0 ELSE 1 END,
       Evento    = CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaEvento', N'U') IS NULL THEN 0 ELSE 1 END,
       Crear     = CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P') IS NULL THEN 0 ELSE 1 END,
       ExecuteAdm = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.class = 3 AND p.major_id = SCHEMA_ID(N'adm')
                       AND p.permission_name = N'EXECUTE' AND p.state IN ('G', 'W'));

/* 2 --------------------------------------------------------------------- */
;WITH po AS (
    SELECT DISTINCT Po = LTRIM(RTRIM(d.ProductOwner))
    FROM dbo.CatCategoriaDueno AS d
    WHERE d.VigenteEnOrigen = 1 AND NULLIF(LTRIM(RTRIM(d.ProductOwner)), N'') IS NOT NULL
), cruce AS (
    SELECT po.Po,
           Filas   = COUNT(p.Nombre),
           Correos = COUNT(DISTINCT LOWER(NULLIF(LTRIM(RTRIM(p.Correo)), N''))),
           Correo  = MIN(LOWER(NULLIF(LTRIM(RTRIM(p.Correo)), N'')))
    FROM po
    LEFT JOIN dbo.CatPersona AS p
           ON p.VigenteEnOrigen = 1
          AND LTRIM(RTRIM(p.Nombre)) COLLATE Latin1_General_CI_AI = po.Po COLLATE Latin1_General_CI_AI
    GROUP BY po.Po
)
SELECT Seccion = 2, Po, Filas, Correo,
       Estado = CASE WHEN Filas = 0 THEN 'no_encontrado'
                     WHEN Filas > 1 THEN 'ambiguo'
                     WHEN Correos = 0 OR Correo NOT LIKE N'_%@_%._%' THEN 'sin_correo'
                     ELSE 'resuelto' END
INTO #po
FROM cruce;
SELECT * FROM #po ORDER BY CASE Estado WHEN 'resuelto' THEN 1 ELSE 0 END, Po;

/* 3 --------------------------------------------------------------------- */
SELECT Seccion = 3, Estado, POs = COUNT(*) FROM #po GROUP BY Estado ORDER BY Estado;

/* 4 --------------------------------------------------------------------- */
SELECT Seccion = 4, Correo = LOWER(LTRIM(RTRIM(p.Correo))), Personas = COUNT(*)
FROM dbo.CatPersona AS p
WHERE p.VigenteEnOrigen = 1 AND NULLIF(LTRIM(RTRIM(p.Correo)), N'') IS NOT NULL
GROUP BY LOWER(LTRIM(RTRIM(p.Correo)))
HAVING COUNT(*) > 1
ORDER BY Personas DESC, Correo;

DROP TABLE #po;
