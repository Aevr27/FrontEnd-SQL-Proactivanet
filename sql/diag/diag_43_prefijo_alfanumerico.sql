/* =========================================================================
   diag_43_prefijo_alfanumerico.sql - SOLO LECTURA. Antes de proponer sql/43.
   Ningun INSERT/UPDATE/DELETE/DDL. Correr en la base de GestionAdmin de la VM.
   ========================================================================= */
SET NOCOUNT ON;

DECLARE @hoyMx date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
DECLARE @anio char(4) = CONVERT(char(4), YEAR(@hoyMx));

/* D1. Prefijos del catalogo: largo, formato y cuantos Problem los usan. */
SELECT c.Prefijo, c.Descripcion, c.ControlDeFecha,
       Largo = LEN(c.Prefijo), Bytes = DATALENGTH(c.Prefijo),
       Formato = CASE
           WHEN c.Prefijo COLLATE Latin1_General_BIN LIKE N'[A-Z][A-Z][A-Z]'             THEN N'3 letras (pasa hoy)'
           WHEN c.Prefijo COLLATE Latin1_General_BIN LIKE N'[A-Z][A-Z0-9][A-Z0-9]'       THEN N'letra + 2 alfanum (pasaria con 43)'
           ELSE N'otro (51021 antes y despues)' END,
       ProblemTotal   = (SELECT COUNT(*) FROM dbo.Problem AS p WHERE p.Prefijo = c.Prefijo),
       ProblemVigente = (SELECT COUNT(*) FROM dbo.Problem AS p WHERE p.Prefijo = c.Prefijo AND p.VigenteEnOrigen = 1)
FROM dbo.CatPrefijoProblem AS c
ORDER BY Formato, c.Prefijo;

/* D2. dbo.Problem.Prefijo: columna calculada o cargada; triggers de Problem. */
SELECT Columna = c.name, EsCalculada = c.is_computed, Definicion = cc.definition, Persistida = cc.is_persisted
FROM sys.columns AS c
LEFT JOIN sys.computed_columns AS cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
WHERE c.object_id = OBJECT_ID(N'dbo.Problem') AND c.name IN (N'Prefijo', N'Codigo');
SELECT Trigger_ = t.name, t.is_disabled FROM sys.triggers AS t WHERE t.parent_id = OBJECT_ID(N'dbo.Problem');

/* D3. Codigos S2L existentes, por anio, con la MISMA lectura de Crear. */
SELECT TOP 50 p.Codigo, p.Prefijo, p.VigenteEnOrigen, p.FechaCreacion
FROM dbo.Problem AS p
WHERE UPPER(LTRIM(p.Codigo)) LIKE N'S2L%' OR p.Prefijo = N'S2L'
ORDER BY p.Codigo DESC;

DECLARE @raiz nvarchar(20) = N'S2L' + @anio;
SELECT Anio = @anio,
       Encontrados = COUNT(*),
       MaxNumero = MAX(n.Numero),
       Ilegible = MIN(CASE WHEN n.Numero IS NULL THEN p.Codigo END),   -- no NULL = Crear daria 51023
       SiguienteCodigo = N'S2L ' + @anio + N'-' + RIGHT(N'000000' + CONVERT(nvarchar(6), ISNULL(MAX(n.Numero), 0) + 1), 6)
FROM dbo.Problem AS p
CROSS APPLY (SELECT Plano = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.Codigo)),
                    N' ', N''), N'-', N''), NCHAR(160), N''), NCHAR(9), N''))) AS x
CROSS APPLY (SELECT Resto = SUBSTRING(x.Plano, LEN(@raiz) + 1, 100)) AS r
CROSS APPLY (SELECT Numero = CASE WHEN r.Resto <> N'' AND r.Resto NOT LIKE N'%[^0-9]%' AND LEN(r.Resto) <= 9
                                  THEN CONVERT(int, r.Resto) END) AS n
WHERE LEFT(x.Plano, LEN(@raiz)) = @raiz;

/* D4. adm.usp_GestionAdmin_Crear: hash (regla de sql/20-32), opciones SET,
   firma, permisos y si tiene la regla de tres letras. */
SELECT Objeto = N'adm.usp_GestionAdmin_Crear',
       Hash = CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                  OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P')),
                  N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1),
       EsSql27 = CASE WHEN HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                  OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P')),
                  N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
                  = 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD THEN 1 ELSE 0 END,
       TieneReglaTresLetras = CASE WHEN CHARINDEX(N'[A-Z][A-Z][A-Z]', OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P'))) > 0 THEN 1 ELSE 0 END,
       m.uses_quoted_identifier, m.uses_ansi_nulls,
       Modificado = o.modify_date
FROM sys.sql_modules AS m JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.object_id = OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P');

SELECT p.parameter_id, p.name, Tipo = TYPE_NAME(p.user_type_id), p.max_length, p.is_output, p.has_default_value
FROM sys.parameters AS p WHERE p.object_id = OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P') ORDER BY p.parameter_id;

SELECT Quien = USER_NAME(dp.grantee_principal_id), dp.permission_name, dp.state_desc
FROM sys.database_permissions AS dp WHERE dp.class = 1 AND dp.major_id = OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P');

-- Definicion completa (copiar el texto si hace falta compararlo con sql/27):
SELECT Definicion = OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P'));

/* D5. Hashes que sql/32 y su rollback comprueban (estado actual). */
SELECT v.Objeto, v.Esperado, v.Origen,
       Actual = CONVERT(varchar(70), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                    OBJECT_DEFINITION(OBJECT_ID(v.Objeto, N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1)
FROM (VALUES (N'adm.usp_GestionAdmin_Crear',                N'0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD', N'sql/27'),
             (N'adm.usp_SolicitudIniciativa_Crear',         N'0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A', N'sql/29 (sql/36 lo cambio)'),
             (N'adm.usp_SolicitudIniciativa_Aprobar',       N'0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906', N'sql/31 (sql/42 pudo cambiarlo)'),
             (N'adm.usp_SolicitudIniciativa_Rechazar',      N'0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416', N'sql/31 (sql/42 pudo cambiarlo)'),
             (N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC', N'sql/32 (sql/42 pudo cambiarlo)')
     ) AS v (Objeto, Esperado, Origen);

/* D6. Las solicitudes afectadas (S2L ENVIADA) y si alguna ya tiene Codigo. */
SELECT s.NumeroSolicitud, s.Estado, s.TipoIniciativa, s.CodigoIniciativa, s.Categoria, s.FechaUtc
FROM adm.SolicitudIniciativa AS s
WHERE UPPER(LTRIM(RTRIM(s.TipoIniciativa))) = N'S2L'
ORDER BY s.NumeroSolicitud;

/* D7. Lo que aprobar una S2L le manda a Crear (TiposPorPrefijo,
   App_Code/GestionIniciativaAdmin.cs): si no existe, Crear da 51011 / 51012
   aunque sql/43 este aplicada. Agrupacion = 'Adopcion' con acento (U+00F3). */
SELECT Clasificacion = (SELECT COUNT(*) FROM dbo.Problem WHERE LTRIM(RTRIM(TipoIniciativa)) = N'Shift Left Administrador'),
       Agrupacion    = (SELECT COUNT(*) FROM dbo.ProblemCategoria WHERE LTRIM(RTRIM(TipoAgrupado)) = N'Adopci' + NCHAR(243) + N'n');
