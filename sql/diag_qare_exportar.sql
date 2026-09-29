/* =====================================================================
   DIAGNOSTICO -- export "⬇ Descargar QARE"
   handlers/qare_exportar.ashx -> App_Code/QareExportar.cs

   SOLO LECTURA. Ningun INSERT/UPDATE/DELETE/MERGE/TRUNCATE ni DDL sobre
   objetos de la base; solo se escribe en una variable de tabla (seccion 5).
   Correr en la VM (SSMS, base Tickets_Proactivanet) y pegar la salida.

   Que contesta:
     1) Que existen los objetos y las 11 columnas de dbo.vw_Tickets que lee
        el export.
     2) Todas las columnas de dbo.vw_CorreoQARECierre_Base (para decidir si
        vale agregar alguna al libro; hoy el export solo usa las de la TVF).
     3) Filas vs tickets de dbo.tvf_CorreoQARE_Base en 15 / 30 / 90 dias:
        si Filas > Tickets, el libro traeria un ticket repetido.
     4) El LEFT JOIN a vw_Tickets: cuantos tickets QARE no tienen fila (salen
        con esas columnas vacias) y si alguno la tiene repetida (duplicaria).
     5) Tiempo y peso de la consulta REAL del export en 30 dias, sin filtros.
     6) Permisos: la TVF se lee con SELECT directo (no por un SP), asi que la
        cuenta del sitio necesita SELECT sobre ella, no solo EXECUTE.

   Ventana: los N dias que terminan HOY en Mexico, como el tablero.
   ===================================================================== */

SET NOCOUNT ON;

DECLARE @Ff DATE = CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()));
DECLARE @Principal SYSNAME = N'%PROACTIVANET%';   -- patron de la cuenta del sitio (PROACTIVANETAD)


/* 1) Objetos y columnas de vw_Tickets ----------------------------------- */
SELECT Prueba = '1 objeto', Objeto = o.nombre,
       Existe = CASE WHEN OBJECT_ID(o.nombre) IS NULL THEN 'FALTA' ELSE 'ok' END
FROM (VALUES (N'dbo.tvf_CorreoQARE_Base'), (N'dbo.vw_CorreoQARECierre_Base'),
             (N'dbo.vw_Tickets'), (N'dbo.CatLiderGrupo'),
             (N'dbo.fn_CorreoBacklog_CategoriaC1'), (N'dbo.fn_CorreoBacklog_SplitList')) AS o(nombre);

SELECT Prueba = '1 columna vw_Tickets', Columna = e.c,
       Existe = CASE WHEN c.name IS NULL THEN 'FALTA' ELSE 'ok' END,
       Tipo = TYPE_NAME(c.user_type_id)
FROM (VALUES (N'CodigoTicket'), (N'Titulo'), (N'Descripcion'), (N'SolucionUsuario'),
             (N'TecnicoSegundaLinea'), (N'Subestado'), (N'Prioridad'), (N'Cliente'),
             (N'Sucursal'), (N'FechaFirmaCierre'), (N'Tipo'), (N'RegistradoPor')) AS e(c)
LEFT JOIN sys.columns AS c ON c.object_id = OBJECT_ID(N'dbo.vw_Tickets') AND c.name = e.c;


/* 2) Columnas de la vista QARE ------------------------------------------ */
SELECT Prueba = '2 vw_CorreoQARECierre_Base', Ordinal = c.column_id, Columna = c.name,
       Tipo = TYPE_NAME(c.user_type_id), c.max_length, c.is_nullable
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'dbo.vw_CorreoQARECierre_Base')
ORDER BY c.column_id;


/* 3) Filas vs tickets de la TVF (sin filtros) --------------------------- */
SELECT Prueba = '3 volumen', Dias = v.d,
       FechaInicio = DATEADD(DAY, 1 - v.d, @Ff), FechaFin = @Ff,
       Filas = (SELECT COUNT_BIG(*) FROM dbo.tvf_CorreoQARE_Base(DATEADD(DAY, 1 - v.d, @Ff), @Ff, NULL, NULL, NULL)),
       Tickets = (SELECT COUNT(DISTINCT CodigoTicket) FROM dbo.tvf_CorreoQARE_Base(DATEADD(DAY, 1 - v.d, @Ff), @Ff, NULL, NULL, NULL))
FROM (VALUES (15), (30), (90)) AS v(d);

-- Si 3) da Filas > Tickets: los repetidos, con lo que cambia entre filas.
SELECT TOP (20) Prueba = '3 repetidos (30 dias)', q.CodigoTicket, Filas = COUNT(*),
       FechasDistintas = COUNT(DISTINCT q.FechaFirmaSolucion),
       CausasDistintas = COUNT(DISTINCT q.QARe_Causa),
       FrecuenciasDistintas = COUNT(DISTINCT q.QA_Frecuencia)
FROM dbo.tvf_CorreoQARE_Base(DATEADD(DAY, -29, @Ff), @Ff, NULL, NULL, NULL) AS q
GROUP BY q.CodigoTicket
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;


/* 4) LEFT JOIN a vw_Tickets (30 dias) ----------------------------------- */
;WITH q AS (
    SELECT DISTINCT CodigoTicket
    FROM dbo.tvf_CorreoQARE_Base(DATEADD(DAY, -29, @Ff), @Ff, NULL, NULL, NULL)
)
SELECT Prueba = '4 join vw_Tickets',
       TicketsQare = (SELECT COUNT(*) FROM q),
       SinFilaEnVwTickets = (SELECT COUNT(*) FROM q WHERE NOT EXISTS
                                (SELECT 1 FROM dbo.vw_Tickets AS t WHERE t.CodigoTicket = q.CodigoTicket)),
       ConFilaRepetida = (SELECT COUNT(*) FROM q WHERE
                                (SELECT COUNT(*) FROM dbo.vw_Tickets AS t WHERE t.CodigoTicket = q.CodigoTicket) > 1);


/* 5) La consulta REAL del export, 30 dias, sin filtros ------------------ */
DECLARE @x TABLE (CodigoTicket nvarchar(100), Largo bigint);
DECLARE @Fi30 DATE = DATEADD(DAY, -29, @Ff);
DECLARE @t0 DATETIME2 = SYSDATETIME();
INSERT @x (CodigoTicket, Largo)
SELECT q.CodigoTicket,
       ISNULL(DATALENGTH(q.QARe_Causa), 0) + ISNULL(DATALENGTH(q.Categoria), 0) +
       ISNULL(DATALENGTH(t.Titulo), 0) + ISNULL(DATALENGTH(t.Descripcion), 0) +
       ISNULL(DATALENGTH(t.SolucionUsuario), 0)
FROM dbo.tvf_CorreoQARE_Base(@Fi30, @Ff, NULL, NULL, NULL) AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket;
SELECT Prueba = '5 export 30 dias', Filas = COUNT(*),
       Milisegundos = DATEDIFF(MILLISECOND, @t0, SYSDATETIME()),
       MBTextoLargo = CAST(SUM(Largo) / 1048576.0 AS DECIMAL(10,1)),
       MaxCaracteresTexto = MAX(Largo) / 2
FROM @x;


/* 6) Permisos de la cuenta del sitio ------------------------------------ */
-- Sus roles.
SELECT Prueba = '6 roles', Principal = dp.name, dp.type_desc, Rol = r.name
FROM sys.database_principals AS dp
LEFT JOIN sys.database_role_members AS rm ON rm.member_principal_id = dp.principal_id
LEFT JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
WHERE dp.name LIKE @Principal;

-- Permisos explicitos suyos y de sus roles (db_datareader no sale aqui:
-- es rol fijo; si aparece en '6 roles', ya tiene SELECT sobre dbo).
SELECT Prueba = '6 permisos', Beneficiario = g.name, p.state_desc, p.permission_name, p.class_desc,
       Sobre = CASE p.class WHEN 0 THEN N'(base)' WHEN 3 THEN SCHEMA_NAME(p.major_id)
                            ELSE OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id) END
FROM sys.database_permissions AS p
JOIN sys.database_principals AS g ON g.principal_id = p.grantee_principal_id
WHERE g.name LIKE @Principal
   OR g.principal_id IN (SELECT rm.role_principal_id
                         FROM sys.database_role_members AS rm
                         JOIN sys.database_principals AS dp ON dp.principal_id = rm.member_principal_id
                         WHERE dp.name LIKE @Principal)
ORDER BY g.name, p.permission_name;

-- La prueba directa, si quien corre esto puede suplantar a la cuenta.
DECLARE @usuario SYSNAME = (SELECT TOP (1) name FROM sys.database_principals
                            WHERE name LIKE @Principal AND type IN ('S', 'U', 'G') ORDER BY name);
BEGIN TRY
    EXECUTE AS USER = @usuario;
    SELECT Prueba = '6 efectivo', Usuario = USER_NAME(),
           SelectTvf = HAS_PERMS_BY_NAME(N'dbo.tvf_CorreoQARE_Base', N'OBJECT', N'SELECT'),
           SelectVwTickets = HAS_PERMS_BY_NAME(N'dbo.vw_Tickets', N'OBJECT', N'SELECT');
    REVERT;
END TRY
BEGIN CATCH
    IF @usuario IS NOT NULL AND USER_NAME() = @usuario REVERT;
    SELECT Prueba = '6 efectivo', Usuario = @usuario, Error = ERROR_MESSAGE();
END CATCH;
