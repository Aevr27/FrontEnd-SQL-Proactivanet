/* diag_grupos_proveedor_candidatos.sql
   SOLO LECTURA. Investiga que grupos de dbo.CorreoBacklogSnapshot podrian ser
   proveedores ademas de los 'Proveedor%', con foco en los 'Soporte%'.
   No crea, altera ni borra nada. Correr en la VM contra Tickets_Proactivanet
   y pegar TODAS las rejillas de resultado (o exportarlas a texto). */

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

/* 0. Columnas reales de la tabla (para no suponer nombres). */
SELECT c.column_id, c.name AS Columna, t.name AS Tipo
FROM sys.columns AS c
JOIN sys.types   AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.CorreoBacklogSnapshot')
ORDER BY c.column_id;

DECLARE @Corte date = (SELECT MAX(FechaCorte) FROM dbo.CorreoBacklogSnapshot);
SELECT UltimoCorte = @Corte,
       FilasCorte  = (SELECT COUNT(*) FROM dbo.CorreoBacklogSnapshot WHERE FechaCorte = @Corte),
       Cortes      = (SELECT COUNT(DISTINCT FechaCorte) FROM dbo.CorreoBacklogSnapshot);

/* 1. TODOS los grupos (ultimo corte + historico), con lideres y clase por nombre.
      Clase por nombre es solo para ordenar la revision, NO es la clasificacion. */
;WITH g AS (
    SELECT GrupoLimpio = LTRIM(RTRIM(s.Grupo)),
           TicketsUltimoCorte = SUM(CASE WHEN s.FechaCorte = @Corte THEN 1 ELSE 0 END),
           FilasHistorico     = COUNT(*),
           CortesPresente     = COUNT(DISTINCT s.FechaCorte),
           PrimerCorte        = MIN(s.FechaCorte),
           UltimoCortePresente= MAX(s.FechaCorte)
    FROM dbo.CorreoBacklogSnapshot AS s
    GROUP BY LTRIM(RTRIM(s.Grupo))
)
SELECT
    ClasePorNombre = CASE
        WHEN g.GrupoLimpio LIKE N'Proveedor%' THEN N'1-Proveedor%'
        WHEN g.GrupoLimpio LIKE N'Soporte%'   THEN N'2-Soporte%'
        WHEN g.GrupoLimpio LIKE N'%vendor%' OR g.GrupoLimpio LIKE N'%proveed%'
          OR g.GrupoLimpio LIKE N'%extern%' OR g.GrupoLimpio LIKE N'%tercer%'
          OR g.GrupoLimpio LIKE N'%outsourc%' OR g.GrupoLimpio LIKE N'%partner%'
          OR g.GrupoLimpio LIKE N'%fabricante%' OR g.GrupoLimpio LIKE N'%contrat%'
          OR g.GrupoLimpio LIKE N'%3rd%' OR g.GrupoLimpio LIKE N'%third%'
                                              THEN N'3-Palabra clave'
        ELSE N'4-Resto' END,
    Grupo = g.GrupoLimpio,
    g.TicketsUltimoCorte, g.FilasHistorico, g.CortesPresente,
    g.PrimerCorte, g.UltimoCortePresente,
    LideresUltimoCorte = STUFF((
        SELECT DISTINCT N' | ' + ISNULL(LTRIM(RTRIM(x.Lider)), N'(null)')
        FROM dbo.CorreoBacklogSnapshot AS x
        WHERE LTRIM(RTRIM(x.Grupo)) = g.GrupoLimpio AND x.FechaCorte = @Corte
        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 3, N''),
    LideresHistorico = STUFF((
        SELECT DISTINCT N' | ' + ISNULL(LTRIM(RTRIM(x.Lider)), N'(null)')
        FROM dbo.CorreoBacklogSnapshot AS x
        WHERE LTRIM(RTRIM(x.Grupo)) = g.GrupoLimpio
        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 3, N'')
FROM g
ORDER BY ClasePorNombre, g.GrupoLimpio;

/* 2. Por lider: cuantos grupos Proveedor% / Soporte% / resto y tickets.
      Sirve para ver si Vendor Managment y los Soporte% caen bajo el mismo
      lider que los Proveedor% (indicio, no prueba). */
SELECT Lider = LTRIM(RTRIM(s.Lider)),
       GruposProveedor = COUNT(DISTINCT CASE WHEN LTRIM(s.Grupo) LIKE N'Proveedor%' THEN LTRIM(RTRIM(s.Grupo)) END),
       GruposSoporte   = COUNT(DISTINCT CASE WHEN LTRIM(s.Grupo) LIKE N'Soporte%'   THEN LTRIM(RTRIM(s.Grupo)) END),
       GruposResto     = COUNT(DISTINCT CASE WHEN LTRIM(s.Grupo) NOT LIKE N'Proveedor%' AND LTRIM(s.Grupo) NOT LIKE N'Soporte%' THEN LTRIM(RTRIM(s.Grupo)) END),
       Tickets         = COUNT(*)
FROM dbo.CorreoBacklogSnapshot AS s
WHERE s.FechaCorte = @Corte
GROUP BY LTRIM(RTRIM(s.Lider))
ORDER BY LTRIM(RTRIM(s.Lider));

/* 3. Detalle de Soporte% y Vendor Managment: tecnicos y subestados del ultimo
      corte. Un tecnico con nombre de empresa, o subestados tipo "En espera de
      proveedor", apuntan a proveedor; tecnicos con nombre de persona interna,
      a equipo propio. Solo si existen esas columnas (paso 0). */
IF COL_LENGTH(N'dbo.CorreoBacklogSnapshot', N'TecnicoSegundaLinea') IS NOT NULL
   AND COL_LENGTH(N'dbo.CorreoBacklogSnapshot', N'Subestado') IS NOT NULL
    EXEC sp_executesql N'
    SELECT Grupo   = LTRIM(RTRIM(s.Grupo)),
           Tecnico = ISNULL(LTRIM(RTRIM(s.TecnicoSegundaLinea)), N''(sin tecnico)''),
           Tickets = COUNT(*),
           Subestados = STUFF((
               SELECT DISTINCT N'' | '' + ISNULL(x.Subestado, N''(null)'')
               FROM dbo.CorreoBacklogSnapshot AS x
               WHERE x.FechaCorte = @Corte
                 AND LTRIM(RTRIM(x.Grupo)) = LTRIM(RTRIM(s.Grupo))
                 AND ISNULL(LTRIM(RTRIM(x.TecnicoSegundaLinea)), N''(sin tecnico)'')
                   = ISNULL(LTRIM(RTRIM(s.TecnicoSegundaLinea)), N''(sin tecnico)'')
               FOR XML PATH(''''), TYPE).value(''.'', ''nvarchar(max)''), 1, 3, N'''')
    FROM dbo.CorreoBacklogSnapshot AS s
    WHERE s.FechaCorte = @Corte
      AND (LTRIM(s.Grupo) LIKE N''Soporte%'' OR LTRIM(s.Grupo) LIKE N''Vendor%'')
    GROUP BY LTRIM(RTRIM(s.Grupo)), ISNULL(LTRIM(RTRIM(s.TecnicoSegundaLinea)), N''(sin tecnico)'')
    ORDER BY Grupo, Tickets DESC;', N'@Corte date', @Corte = @Corte;
ELSE
    SELECT Aviso = N'Paso 3 omitido: faltan TecnicoSegundaLinea o Subestado; ver paso 0.';

/* 4. Subestados que mencionan proveedor/tercero, por grupo: senal de que el
      grupo delega en externos aunque su nombre no lo diga. */
IF COL_LENGTH(N'dbo.CorreoBacklogSnapshot', N'Subestado') IS NOT NULL
    EXEC sp_executesql N'
    SELECT Grupo = LTRIM(RTRIM(s.Grupo)), s.Subestado, Tickets = COUNT(*)
    FROM dbo.CorreoBacklogSnapshot AS s
    WHERE s.FechaCorte = @Corte
      AND (s.Subestado LIKE N''%proveed%'' OR s.Subestado LIKE N''%vendor%''
        OR s.Subestado LIKE N''%tercer%''  OR s.Subestado LIKE N''%extern%''
        OR s.Subestado LIKE N''%fabricante%'')
    GROUP BY LTRIM(RTRIM(s.Grupo)), s.Subestado
    ORDER BY Grupo, Tickets DESC;', N'@Corte date', @Corte = @Corte;
