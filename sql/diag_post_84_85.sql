/* =====================================================================================
   diag_post_84_85.sql  -  SOLO LECTURA.  (2026-11-11)
   Servidor: AZVMBDCENTRALQA   Base: Tickets_Proactivanet

   Solo SELECT sobre catalogos, OBJECT_DEFINITION, HASHBYTES y tablas existentes.
   Ningun INSERT/UPDATE/DELETE/MERGE, ningun DDL, ningun EXEC de procedimientos,
   ninguna transaccion. Cada seccion es su propio lote (GO). V6c lee una DMV
   dentro de TRY/CATCH: si no hay VIEW SERVER STATE devuelve el error y sigue.

   V1  migracion 84: hash y marca de adm.usp_GestionAdmin_TicketsReduce
   V2  migracion 85: marca, expresion, largo y "solo cambio la expresion"
   V3  texto alrededor del CEILING (tope 100%, NULL, <= 0) para leerlo
   V4  permisos, dueno, EXECUTE AS y opciones de modulo
   V5  procedimientos NO relacionados: hashes y todo lo modificado hoy
   V6  ETL: foto (Hoy/FechaCalculo) contra la hora del ALTER de 85, EtlLog, DMV
   V7  la foto ya es CEILING? (regla inferida de los datos, como S10) + topes/NULL
   V8  filas de la foto en las rutas de App Evolucion (comparar con el baseline)
   ===================================================================================== */
SET NOCOUNT ON;
GO

/* V1) Migracion 84 */
SELECT Seccion = 'V1', Objeto = N'adm.usp_GestionAdmin_TicketsReduce',
       Existe = CASE WHEN OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P') IS NULL THEN 0 ELSE 1 END,
       HashNormalizado = CONVERT(varchar(66), h.H, 1),
       Es_sql84 = CASE WHEN h.H = 0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591 THEN 'SI' ELSE 'NO' END,
       Es_sql33 = CASE WHEN h.H = 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F THEN 'SI' ELSE 'NO' END,
       Es_sql18 = CASE WHEN h.H = 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46 THEN 'SI' ELSE 'NO' END,
       TicketsReduceAntes = CONVERT(nvarchar(20), (SELECT ep.value FROM sys.extended_properties AS ep
                              WHERE ep.class = 1 AND ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = N'TicketsReduceAntes')),
       VecesCEILING = (LEN(d.D) - LEN(REPLACE(d.D, N'CEILING(', N''))) / 8,
       VecesFLOOR   = (LEN(d.D) - LEN(REPLACE(d.D, N'FLOOR(', N''))) / 6,
       VecesROUND   = (LEN(d.D) - LEN(REPLACE(d.D, N'ROUND(', N''))) / 6,
       o.create_date, o.modify_date
FROM sys.objects AS o
CROSS APPLY (SELECT D = OBJECT_DEFINITION(o.object_id)) AS d
CROSS APPLY (SELECT H = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(d.D, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h
WHERE o.object_id = OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P');
GO

/* V2) Migracion 85. RevertidoEsQA = 'SI' prueba que lo UNICO distinto de la
   version de QA (hash crudo 0xBDF0...84C8, 4153 caracteres) es la expresion. */
DECLARE @Viejo nvarchar(100) = N'CONVERT(INT, ROUND(p.Pct * ISNULL(v.N, 0), 0))';
DECLARE @Nuevo nvarchar(100) = N'CONVERT(INT, CEILING(p.Pct * ISNULL(v.N, 0)))';
SELECT Seccion = 'V2', Objeto = N'dbo.usp_Exp_CalcularTicketsReduce',
       Marca = CONVERT(nvarchar(50), (SELECT ep.value FROM sys.extended_properties AS ep
                 WHERE ep.class = 1 AND ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = N'TicketsReduceRedondeo')),
       Largo = DATALENGTH(d.D) / 2,                       -- esperado 4152
       VecesNueva = (DATALENGTH(d.D) - DATALENGTH(REPLACE(d.D, @Nuevo, N''))) / DATALENGTH(@Nuevo),   -- esperado 1
       VecesVieja = (DATALENGTH(d.D) - DATALENGTH(REPLACE(d.D, @Viejo, N''))) / DATALENGTH(@Viejo),   -- esperado 0
       VecesROUND = (LEN(d.D) - LEN(REPLACE(d.D, N'ROUND(', N''))) / 6,
       RevertidoEsQA = CASE WHEN HASHBYTES('SHA2_256', REPLACE(d.D, @Nuevo, @Viejo)) = 0xBDF0894DA4DD356BF3ED1560792A43A42B7D71CF7C88C0BC4EA2173AA67384C8 THEN 'SI' ELSE 'NO' END,
       HashNormalizado = CONVERT(varchar(66), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(d.D, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1),
       HashCrudo = CONVERT(varchar(66), HASHBYTES('SHA2_256', d.D), 1),
       CabeceraCREATE = CASE WHEN PATINDEX(N'%CREATE%PROC%usp_Exp_CalcularTicketsReduce%', d.D) > 0 THEN 'SI' ELSE 'NO' END,
       o.create_date, o.modify_date
FROM sys.objects AS o
CROSS APPLY (SELECT D = OBJECT_DEFINITION(o.object_id)) AS d
WHERE o.object_id = OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P');
GO

/* V3) Texto para leer: adm completo; usp_Exp 900 caracteres alrededor del CEILING */
SELECT Seccion = 'V3', Objeto = N'adm.usp_GestionAdmin_TicketsReduce',
       Texto = OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'));
SELECT Seccion = 'V3', Objeto = N'dbo.usp_Exp_CalcularTicketsReduce',
       Texto = SUBSTRING(d.D, CASE WHEN p.P > 600 THEN p.P - 600 ELSE 1 END, 900)
FROM (SELECT D = OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'))) AS d
CROSS APPLY (SELECT P = CHARINDEX(N'CEILING(', d.D)) AS p;
GO

/* V4) Permisos y propiedades del modulo (ALTER no los cambia; esto lo comprueba) */
SELECT Seccion = 'V4', Nivel = 'OBJETO', Objeto = OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id),
       Principal = pr.name, p.permission_name, p.state_desc
FROM sys.database_permissions AS p
INNER JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE p.class = 1 AND p.major_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'), OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'))
UNION ALL
SELECT 'V4', 'ESQUEMA', s.name, pr.name, p.permission_name, p.state_desc
FROM sys.database_permissions AS p
INNER JOIN sys.schemas AS s ON s.schema_id = p.major_id
INNER JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE p.class = 3 AND s.name IN (N'adm', N'dbo')
ORDER BY 2, 3, 4, 5;

SELECT Seccion = 'V4', Objeto = OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id),
       DuenoExplicito = USER_NAME(o.principal_id),     -- NULL = dueno del esquema (lo normal)
       DuenoEsquema = USER_NAME(s.principal_id),
       ExecuteAs = CASE WHEN m.execute_as_principal_id IS NULL THEN 'CALLER' ELSE USER_NAME(m.execute_as_principal_id) END,
       m.uses_ansi_nulls, m.uses_quoted_identifier, m.is_schema_bound
FROM sys.sql_modules AS m
INNER JOIN sys.objects AS o ON o.object_id = m.object_id
INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE m.object_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'), OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'));

/* Cuentas: EXECUTE efectivo de la cuenta del sitio sobre los dos procedimientos */
SELECT Seccion = 'V4', Cuenta = dp.name, dp.type_desc,
       ExecAdmTicketsReduce = HAS_PERMS_BY_NAME(N'adm.usp_GestionAdmin_TicketsReduce', N'OBJECT', N'EXECUTE'),
       Nota = 'HAS_PERMS_BY_NAME es de la cuenta que corre ESTE script, no de dp.name'
FROM sys.database_principals AS dp WHERE dp.name = N'PROACTIVANETAD';
GO

/* V5) Procedimientos NO relacionados. Modificar/Aplicar/Crear deben tener el
   hash que tenian ANTES de 84/85 (pre-83 = sql/24, sql/40, sql/38; post-83 si
   ya se aplico la 83). La segunda consulta lista TODO lo modificado desde
   2026-11-10: solo deberian aparecer los dos de 84/85 (y lo de 83 si se aplico). */
SELECT Seccion = 'V5', n.Objeto,
       HashNormalizado = CONVERT(varchar(66), h.H, 1),
       Version = CASE WHEN h.H = n.Pre THEN n.PreNombre WHEN h.H = n.Post83 THEN 'post-83' WHEN h.H IS NULL THEN 'FALTA' ELSE 'OTRA' END,
       o.modify_date
FROM (VALUES (N'adm.usp_GestionAdmin_Modificar', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 'sql/24', 0x68331AC9641DBFD6A83213F5E74E23A5FA4F4CC8BC03F040A965269AC98B1054),
             (N'adm.usp_SolicitudCambio_Aplicar', 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 'sql/40', 0x8464627C052EA87A5792C1CE27477D3D04638A391FD29C66352BA66C295B218D),
             (N'adm.usp_SolicitudCambio_Crear',   0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F, 'sql/38', 0x08CED77CF27E9E929F264377B1059541E8C6CBD050B909D03FA58952613EE842))
     AS n (Objeto, Pre, PreNombre, Post83)
LEFT JOIN sys.objects AS o ON o.object_id = OBJECT_ID(n.Objeto, N'P')
OUTER APPLY (SELECT H = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(o.object_id), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h;

SELECT Seccion = 'V5', Objeto = SCHEMA_NAME(o.schema_id) + N'.' + o.name, o.type_desc, o.create_date, o.modify_date
FROM sys.objects AS o
WHERE o.modify_date >= '2026-11-10' AND o.is_ms_shipped = 0
ORDER BY o.modify_date;
GO

/* V6) ETL despues de la 85. Regla: la foto es post-85 solo si FechaCalculo es
   POSTERIOR a modify_date de dbo.usp_Exp_CalcularTicketsReduce (mismo reloj del
   servidor solo si el procedimiento llena FechaCalculo con la hora del
   servidor: NO verificado; V7 lo confirma con los datos, sin depender del reloj). */
SELECT Seccion = 'V6a',
       AlterDe85 = (SELECT modify_date FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P')),
       AlterDe84 = (SELECT modify_date FROM sys.objects WHERE object_id = OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P')),
       Ahora = SYSDATETIME(), AhoraUtc = SYSUTCDATETIME();
SELECT TOP (10) Seccion = 'V6a', x.Hoy, x.FechaCalculo, Filas = COUNT(*),
       PosteriorA85 = CASE WHEN x.FechaCalculo > (SELECT modify_date FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P')) THEN 'SI' ELSE 'NO' END
FROM dbo.ExpTicketsReduce AS x
GROUP BY x.Hoy, x.FechaCalculo
ORDER BY x.FechaCalculo DESC;

SELECT TOP (15) Seccion = 'V6b', l.EtlLogId, l.Proceso, l.Inicio, l.Fin, l.Modo, l.Estatus,
       l.FilasApi, l.FilasInsertadas, l.FilasActualizadas, Mensaje = LEFT(l.Mensaje, 300)
FROM dbo.EtlLog AS l
ORDER BY l.EtlLogId DESC;
GO
BEGIN TRY
    SELECT Seccion = 'V6c', Objeto = OBJECT_SCHEMA_NAME(ps.object_id, ps.database_id) + N'.' + OBJECT_NAME(ps.object_id, ps.database_id),
           ps.cached_time, ps.last_execution_time, ps.execution_count
    FROM sys.dm_exec_procedure_stats AS ps
    WHERE ps.database_id = DB_ID()
      AND ps.object_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'), OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'));
END TRY
BEGIN CATCH
    SELECT Seccion = 'V6c', Error = ERROR_NUMBER(), Mensaje = ERROR_MESSAGE();
END CATCH;
GO

/* V7) Regla de la foto inferida de los datos (ultimo Hoy). Antes de la 85
   (QA 2026-11-11 08:56): 916 filas, 303 distinguibles, 303 = ROUND, 139 = CEILING.
   Despues de un ETL con la 85: Dist_Ceiling = Distinguibles, Dist_Floor = 0.
   Topes: Pct > 1 -> Volumen30; Pct NULL -> NULL; Pct <= 0 -> 0. */
SELECT Seccion = 'V7', Hoy = MAX(x.Hoy), Calculo = MAX(x.FechaCalculo),
       Filas          = COUNT(*),
       Distinguibles  = SUM(CASE WHEN c.Fl <> c.Ce THEN 1 ELSE 0 END),
       Dist_Ceiling   = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       Dist_Round     = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce = c.Ro THEN 1 ELSE 0 END),
       Dist_Floor     = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce = c.Fl THEN 1 ELSE 0 END),
       Dist_Ninguna   = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce NOT IN (c.Ro, c.Fl, c.Ce) THEN 1 ELSE 0 END),
       FracBajo_Ceil  = SUM(CASE WHEN c.Fr > 0 AND c.Fr < 0.5 AND x.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       FracBajo_Total = SUM(CASE WHEN c.Fr > 0 AND c.Fr < 0.5 THEN 1 ELSE 0 END),
       Exactos_Bien   = SUM(CASE WHEN x.Pct > 0 AND c.Fl = c.Ce AND x.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       Exactos_Total  = SUM(CASE WHEN x.Pct > 0 AND c.Fl = c.Ce THEN 1 ELSE 0 END),
       PctMayor1      = SUM(CASE WHEN x.Pct > 1 THEN 1 ELSE 0 END),
       PctMayor1_Bien = SUM(CASE WHEN x.Pct > 1 AND x.TicketsReduce = x.Volumen30 THEN 1 ELSE 0 END),
       PctNull        = SUM(CASE WHEN x.Pct IS NULL THEN 1 ELSE 0 END),
       PctNull_Bien   = SUM(CASE WHEN x.Pct IS NULL AND x.TicketsReduce IS NULL THEN 1 ELSE 0 END),
       PctCeroONeg    = SUM(CASE WHEN x.Pct <= 0 THEN 1 ELSE 0 END),
       PctCeroONeg_Bien = SUM(CASE WHEN x.Pct <= 0 AND x.TicketsReduce = 0 THEN 1 ELSE 0 END),
       SumaTickets    = SUM(CONVERT(bigint, x.TicketsReduce))
FROM dbo.ExpTicketsReduce AS x
CROSS APPLY (SELECT P = CONVERT(decimal(19,6), ISNULL(x.Volumen30, 0)) * CASE WHEN x.Pct > 1 THEN 1.0 ELSE x.Pct END) AS p
CROSS APPLY (SELECT Ro = CONVERT(int, ROUND(p.P, 0)), Fl = CONVERT(int, FLOOR(p.P)), Ce = CONVERT(int, CEILING(p.P)),
                    Fr = p.P - FLOOR(p.P)) AS c
WHERE x.Hoy = (SELECT MAX(Hoy) FROM dbo.ExpTicketsReduce);

/* ProblemCategoria.TicketsReduce (lo que escribe la 84). Solo cambia cuando
   Admin crea/modifica/aplica una solicitud: NO se espera que todo sea CEILING.
   Filas tocadas despues del ALTER de 84 si deben ser CEILING. */
SELECT Seccion = 'V7', Fuente = 'ProblemCategoria vigente',
       Filas = COUNT(*),
       Distinguibles = SUM(CASE WHEN c.Fl <> c.Ce THEN 1 ELSE 0 END),
       Dist_Ceiling  = SUM(CASE WHEN c.Fl <> c.Ce AND v.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       Dist_Round    = SUM(CASE WHEN c.Fl <> c.Ce AND v.TicketsReduce = c.Ro THEN 1 ELSE 0 END),
       Dist_Floor    = SUM(CASE WHEN c.Fl <> c.Ce AND v.TicketsReduce = c.Fl THEN 1 ELSE 0 END),
       PctNull_ConTickets = SUM(CASE WHEN v.PctDisminucion IS NULL AND v.TicketsReduce IS NOT NULL THEN 1 ELSE 0 END)
FROM (SELECT DISTINCT y.Codigo, y.Categoria, y.PctDisminucion, y.TicketsReduce, y.VolumenUltimos30
      FROM dbo.vw_ProblemCategoria AS y WHERE y.VigenteEnOrigen = 1) AS v
CROSS APPLY (SELECT P = CONVERT(decimal(19,6), ISNULL(v.VolumenUltimos30, 0)) * CASE WHEN v.PctDisminucion > 1 THEN 1.0 ELSE v.PctDisminucion END) AS p
CROSS APPLY (SELECT Ro = CONVERT(int, ROUND(p.P, 0)), Fl = CONVERT(int, FLOOR(p.P)), Ce = CONVERT(int, CEILING(p.P))) AS c;
GO

/* V8) Foto en las rutas de App Evolucion, fila por fila (el baseline pre-85
   solo tiene 26 de estas filas: TOP 30 de S10). Mostrado = lo que usa el tablero. */
SELECT Seccion = 'V8', Ruta = REPLACE(x.Categoria, N'/S-Gesti' + NCHAR(243) + N'n de Inventarios y Recibo de mercancia/App Evolucion/', N''),
       x.Codigo, x.Pct, x.Volumen30, Foto = x.TicketsReduce,
       Producto = CONVERT(decimal(19,6), x.Volumen30) * CASE WHEN x.Pct > 1 THEN 1.0 ELSE x.Pct END,
       ComoRound = CONVERT(int, ROUND(CONVERT(decimal(19,6), x.Volumen30) * CASE WHEN x.Pct > 1 THEN 1.0 ELSE x.Pct END, 0)),
       ComoCeiling = CONVERT(int, CEILING(CONVERT(decimal(19,6), x.Volumen30) * CASE WHEN x.Pct > 1 THEN 1.0 ELSE x.Pct END)),
       PctActual = pc.PctDisminucion, FilaTicketsReduce = pc.TicketsReduce,
       DeFoto = CASE WHEN x.Pct = pc.PctDisminucion OR (x.Pct IS NULL AND pc.PctDisminucion IS NULL) THEN 1 ELSE 0 END,
       p.Estado, p.TipoIniciativa, x.Hoy, x.FechaCalculo
FROM dbo.ExpTicketsReduce AS x
LEFT JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = x.Codigo AND pc.Categoria = x.Categoria
LEFT JOIN dbo.Problem AS p ON p.Codigo = x.Codigo
WHERE x.Categoria LIKE N'/S-Gesti%n de Inventarios y Recibo de mercancia/App Evolucion/%'
  AND x.Hoy = (SELECT MAX(Hoy) FROM dbo.ExpTicketsReduce)
ORDER BY x.Categoria, x.Codigo;
GO
