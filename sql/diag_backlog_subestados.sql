/* =====================================================================================
   diag_backlog_subestados.sql  -  SOLO LECTURA (ningun INSERT/UPDATE/DELETE/DDL)

   Para que sirve: antes de agregar el result set 7 (subestados por Lider/Grupo)
   a dbo.usp_CorreoBacklog_Principal hay que trabajar sobre la definicion REAL del
   procedimiento, no sobre 07_correo_backlog.sql (copia de agosto; el objeto se
   modifico el 2026-09-25), y saber si dbo.CorreoBacklogSnapshot.Subestado trae
   NULL o vacios, y por que.

   Como correrlo: SSMS, Resultados en CUADRICULA (no en texto: el modo texto corta
   cada celda a 256). Guardar la salida FUERA del repo (el repo es publico), por
   ejemplo junto a esquema_bd\.

     1) Contexto y metadatos del procedimiento (fechas, largo, hash).
     2) RESPALDO de la definicion: clic en la celda XML abre el texto completo;
        ademas va en trozos de 250 numerados para copiarlo sin depender del XML.
        LargoDefinicion y HashSha256 de (1) sirven para comprobar el respaldo.
     3) Lo que hay dentro de la definicion: si ya menciona Subestado, cuantos
        "Result set" declara, y quien mas lo referencia en SQL.
     4) Nulabilidad de Subestado en la tabla, la vista y las fuentes.
     5) Datos del corte mas reciente (el que abre el tablero): NULL, vacios,
        espacios sobrantes y la lista completa de subestados con su conteo.
     6) NULL / vacios a lo largo de los cortes, separando los del correo diario
        (hay fila en CorreoBacklogEjecucion) de los del Backfill.
     7) Causa de los NULL del corte mas reciente: por Estado y Tipo, y contra el
        valor que tienen HOY en dbo.Tickets y en dbo.vw_Backlog.
     8) Valores de EstadoSLA del corte mas reciente (tarjeta Dentro/Fuera SLA).

   Esperado si no hay NULL: (5) SubestadoNull = 0 y SubestadoVacio = 0, y (6) y (7)
   sin filas.
   ===================================================================================== */
SET NOCOUNT ON;

DECLARE @Def NVARCHAR(MAX) = OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CorreoBacklog_Principal'));
DECLARE @F DATE = (SELECT MAX(FechaCorte) FROM dbo.CorreoBacklogSnapshot);

/* 1) Contexto y metadatos */
SELECT Servidor        = @@SERVERNAME,
       BaseDeDatos     = DB_NAME(),
       Ahora           = SYSDATETIME(),
       Procedimiento   = N'dbo.usp_CorreoBacklog_Principal',
       Existe          = CASE WHEN @Def IS NULL THEN 0 ELSE 1 END,
       Creado          = o.create_date,
       Modificado      = o.modify_date,
       LargoDefinicion = LEN(@Def),
       HashSha256      = CONVERT(VARCHAR(66), HASHBYTES('SHA2_256', CAST(@Def AS VARBINARY(MAX))), 1),
       CorteMasReciente = @F
FROM sys.objects AS o
WHERE o.object_id = OBJECT_ID(N'dbo.usp_CorreoBacklog_Principal');

/* 2a) Respaldo completo: clic en la celda para abrirlo entero */
SELECT DefinicionCompleta = CAST(N'<?def --' + NCHAR(13) + NCHAR(10)
                                 + REPLACE(@Def, N'?>', N'? >')
                                 + NCHAR(13) + NCHAR(10) + N'--?>' AS XML);

/* 2b) Respaldo en trozos de 250 (concatenar en orden de Trozo) */
;WITH n AS (
    SELECT TOP (CASE WHEN @Def IS NULL THEN 0 ELSE (LEN(@Def) + 249) / 250 END)
           Trozo = ROW_NUMBER() OVER (ORDER BY (SELECT NULL))
    FROM sys.all_objects AS a CROSS JOIN sys.all_objects AS b
)
SELECT Trozo, Texto = SUBSTRING(@Def, (Trozo - 1) * 250 + 1, 250)
FROM n
ORDER BY Trozo;

/* 3) Contenido de la definicion y dependencias */
SELECT MencionaSubestado   = CASE WHEN CHARINDEX(N'Subestado', @Def) > 0 THEN 1 ELSE 0 END,
       PrimeraMencion      = CHARINDEX(N'Subestado', @Def),
       ResultSetsDeclarados = (LEN(@Def) - LEN(REPLACE(@Def, N'Result set', N''))) / LEN(N'Result set'),
       UsaTablaCorte       = CASE WHEN CHARINDEX(N'#Corte', @Def) > 0 THEN 1 ELSE 0 END;

SELECT Referencia = OBJECT_SCHEMA_NAME(d.referencing_id) + N'.' + OBJECT_NAME(d.referencing_id),
       Tipo       = o.type_desc
FROM sys.sql_expression_dependencies AS d
INNER JOIN sys.objects AS o ON o.object_id = d.referencing_id
WHERE d.referenced_id = OBJECT_ID(N'dbo.usp_CorreoBacklog_Principal');

/* 4) Nulabilidad de Subestado de la tabla del corte hacia atras */
SELECT Objeto   = OBJECT_SCHEMA_NAME(c.object_id) + N'.' + OBJECT_NAME(c.object_id),
       Columna  = c.name,
       Tipo     = TYPE_NAME(c.user_type_id) + N'(' + CAST(c.max_length / 2 AS NVARCHAR(10)) + N')',
       AdmiteNull = c.is_nullable
FROM sys.columns AS c
WHERE c.name = N'Subestado'
  AND c.object_id IN (OBJECT_ID(N'dbo.CorreoBacklogSnapshot'), OBJECT_ID(N'dbo.vw_Backlog'),
                      OBJECT_ID(N'dbo.Tickets'), OBJECT_ID(N'dbo.TicketsHist'), OBJECT_ID(N'stg.Tickets'))
ORDER BY Objeto;

/* 5a) Corte mas reciente: resumen */
SELECT FechaCorte        = @F,
       Tickets           = COUNT(*),
       SubestadoNull     = SUM(CASE WHEN Subestado IS NULL THEN 1 ELSE 0 END),
       SubestadoVacio    = SUM(CASE WHEN Subestado IS NOT NULL
                                     AND LTRIM(RTRIM(REPLACE(Subestado, NCHAR(160), N' '))) = N'' THEN 1 ELSE 0 END),
       ConEspacioSobrante = SUM(CASE WHEN Subestado <> LTRIM(RTRIM(Subestado))
                                       OR DATALENGTH(Subestado) <> DATALENGTH(RTRIM(Subestado)) THEN 1 ELSE 0 END),
       SubestadosDistintos = COUNT(DISTINCT Subestado)
FROM dbo.CorreoBacklogSnapshot
WHERE FechaCorte = @F;

/* 5b) Corte mas reciente: lista completa (las categorias de la grafica) */
SELECT Subestado,
       EsNull  = CASE WHEN Subestado IS NULL THEN 1 ELSE 0 END,
       Largo   = LEN(Subestado),
       Bytes   = DATALENGTH(Subestado),
       Tickets = COUNT(*)
FROM dbo.CorreoBacklogSnapshot
WHERE FechaCorte = @F
GROUP BY Subestado
ORDER BY COUNT(*) DESC, Subestado;

/* 6) NULL / vacios por corte: correo diario vs Backfill */
SELECT s.FechaCorte,
       Origen        = CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogEjecucion AS e
                                         WHERE e.FechaCorte = s.FechaCorte)
                            THEN N'PrepararCorte (correo)' ELSE N'Backfill' END,
       Tickets       = COUNT(*),
       SubestadoNull = SUM(CASE WHEN s.Subestado IS NULL THEN 1 ELSE 0 END),
       SubestadoVacio = SUM(CASE WHEN s.Subestado IS NOT NULL
                                  AND LTRIM(RTRIM(REPLACE(s.Subestado, NCHAR(160), N' '))) = N'' THEN 1 ELSE 0 END)
FROM dbo.CorreoBacklogSnapshot AS s
GROUP BY s.FechaCorte
HAVING SUM(CASE WHEN s.Subestado IS NULL
                  OR LTRIM(RTRIM(REPLACE(s.Subestado, NCHAR(160), N' '))) = N'' THEN 1 ELSE 0 END) > 0
ORDER BY s.FechaCorte DESC;

/* 7a) Causa: NULL / vacios del corte mas reciente por Estado y Tipo */
SELECT s.Estado, s.Tipo, Tickets = COUNT(*)
FROM dbo.CorreoBacklogSnapshot AS s
WHERE s.FechaCorte = @F
  AND (s.Subestado IS NULL OR LTRIM(RTRIM(REPLACE(s.Subestado, NCHAR(160), N' '))) = N'')
GROUP BY s.Estado, s.Tipo
ORDER BY COUNT(*) DESC;

/* 7b) Causa: muestra contra el valor de HOY en dbo.Tickets y dbo.vw_Backlog.
   Si la fuente tambien viene sin subestado, el NULL nace en la carga (ETL /
   Proactivanet); si la fuente si lo tiene, nace al tomar el corte. */
SELECT TOP (50)
       s.CodigoTicket, s.Estado, s.Tipo, s.Grupo, s.Lider, s.FechaRegistro,
       SubestadoCorte    = s.Subestado,
       SubestadoTickets  = t.Subestado,
       EstadoTickets     = t.Estado,
       SubestadoVista    = b.Subestado,
       t.FechaUltimaModificacion, t.FechaUltimaCargaDW, s.FechaHoraSnapshot
FROM dbo.CorreoBacklogSnapshot AS s
LEFT JOIN dbo.Tickets AS t ON t.CodigoTicket = s.CodigoTicket
LEFT JOIN dbo.vw_Backlog AS b ON b.CodigoTicket = s.CodigoTicket
WHERE s.FechaCorte = @F
  AND (s.Subestado IS NULL OR LTRIM(RTRIM(REPLACE(s.Subestado, NCHAR(160), N' '))) = N'')
ORDER BY s.FechaRegistro, s.CodigoTicket;

/* 7c) Lo mismo en vivo: tickets abiertos sin subestado en dbo.vw_Backlog hoy */
SELECT b.Estado, Tickets = COUNT(*)
FROM dbo.vw_Backlog AS b
WHERE b.Subestado IS NULL OR LTRIM(RTRIM(REPLACE(b.Subestado, NCHAR(160), N' '))) = N''
GROUP BY b.Estado
ORDER BY COUNT(*) DESC;

/* 8) EstadoSLA del corte mas reciente */
SELECT EstadoSLA, Tickets = COUNT(*)
FROM dbo.CorreoBacklogSnapshot
WHERE FechaCorte = @F
GROUP BY EstadoSLA
ORDER BY COUNT(*) DESC;
