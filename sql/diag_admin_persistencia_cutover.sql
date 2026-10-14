/* =========================================================================
   sql/diag_admin_persistencia_cutover.sql - Diagnostico de SOLO LECTURA
   antes de la migracion 18 / retiro del cargador / encendido de la
   persistencia de Admin.

   SOLO SELECT: no crea, cambia ni borra nada (ni tablas temporales). Correr
   en la base del tablero con una cuenta de DBA (algunas secciones leen msdb
   o usan EXECUTE AS USER para ver los permisos efectivos del sitio; si no hay
   permiso, esa seccion lo dice y sigue).

   COMO: SSMS -> Resultados a TEXTO (Ctrl+T), y en Opciones -> Resultados a
   texto subir "Numero maximo de caracteres por columna" a 8192 (o dejar 256:
   la seccion D3 parte las definiciones en trozos de 250). Pegar la salida.

   Ajustar @UsuarioSitio al usuario de base del login que usa el sitio (la
   cadena TicketsProactivanet de su Web.config). El diag p2 del 2026-10-13
   lo dio como PROACTIVANETAD; confirmar.
   ========================================================================= */
SET NOCOUNT ON;
DECLARE @UsuarioSitio sysname = N'PROACTIVANETAD';
DECLARE @HashCargador varbinary(32) = 0x3BC236C22F81E7A07A4F221A012D54669742BE96A3E31C55DFE7F848D19C67DD;  -- 174bb51
DECLARE @Hoy date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));

/* ---------- D1. Servidor, base, aislamiento ---------- */
SELECT D1 = 'servidor', Version = CONVERT(nvarchar(40), SERVERPROPERTY('ProductVersion')), Base = DB_NAME(),
       Compat = d.compatibility_level, RCSI = d.is_read_committed_snapshot_on, SnapshotIso = d.snapshot_isolation_state_desc,
       Collation = d.collation_name, QuienCorre = ORIGINAL_LOGIN(), HoyMexico = @Hoy
FROM sys.databases AS d WHERE d.database_id = DB_ID();

/* ---------- D2. Objetos de los que depende la migracion: existencia, fechas y hash ---------- */
SELECT D2 = 'objetos', o.Objeto, Existe = CASE WHEN OBJECT_ID(o.Objeto) IS NULL THEN 0 ELSE 1 END,
       Creado = so.create_date, Modificado = so.modify_date,
       Largo = LEN(OBJECT_DEFINITION(OBJECT_ID(o.Objeto))),
       HashSinEspacios = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(o.Objeto)),
                         N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       Esperado = o.Esperado
FROM (VALUES (N'dbo.usp_CargarExperiencia',      N'hash 174bb51 (ver CargadorEsVerificado)'),
             (N'dbo.vw_ProblemCategoria',        N'38 c041fe1: marcas vw_DuenoPorC1 + VolumenUltimos30, sin FechaAnalisisCategoria'),
             (N'dbo.vw_ProblemVencido',          N'26 e0335c1: marcas ColumnaRige + GeneraAviso, sin FechaAnalisisCategoria'),
             (N'dbo.vw_ProblemVencidoAviso',     N'lee vw_ProblemVencido'),
             (N'dbo.usp_Exp_CalcularTicketsReduce', N'65: formula a comparar con adm.usp_GestionAdmin_TicketsReduce'),
             (N'dbo.usp_Exp_CalcularEfectividad', N'60: confirmar que no exige columnas que Admin deja NULL'),
             (N'dbo.trg_Problem_FechaEvento',    N'sql/17'),
             (N'dbo.trg_Problem_EstadoEvento',   N'script 62 (no esta en ningun repo)'),
             (N'dbo.usp_AvisoProblems_Pendientes', N'lee vw_ProblemVencidoAviso')) AS o (Objeto, Esperado)
LEFT JOIN sys.objects AS so ON so.object_id = OBJECT_ID(o.Objeto);

SELECT D2b = 'marcas', CargadorEsVerificado =
         CASE WHEN HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_CargarExperiencia')),
              N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) = @HashCargador THEN 1 ELSE 0 END,
       VistaCategoriaEs38 = CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.vw_ProblemCategoria')) LIKE N'%vw_DuenoPorC1%'
                                  AND OBJECT_DEFINITION(OBJECT_ID('dbo.vw_ProblemCategoria')) LIKE N'%VolumenUltimos30%'
                                  AND OBJECT_DEFINITION(OBJECT_ID('dbo.vw_ProblemCategoria')) NOT LIKE N'%FechaAnalisisCategoria%' THEN 1 ELSE 0 END,
       VistaVencidoEs26 = CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.vw_ProblemVencido')) LIKE N'%ColumnaRige%'
                                AND OBJECT_DEFINITION(OBJECT_ID('dbo.vw_ProblemVencido')) LIKE N'%GeneraAviso%'
                                AND OBJECT_DEFINITION(OBJECT_ID('dbo.vw_ProblemVencido')) NOT LIKE N'%FechaAnalisisCategoria%' THEN 1 ELSE 0 END,
       CargadorEsStub = CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.usp_CargarExperiencia')) LIKE N'%THROW 51900%' THEN 1 ELSE 0 END;

/* ---------- D3. Definiciones completas en trozos de 250 (para guardar y comparar) ---------- */
WITH n AS (SELECT TOP (400) i = ROW_NUMBER() OVER (ORDER BY (SELECT 1)) FROM sys.all_columns),
     o AS (SELECT Objeto, Def = OBJECT_DEFINITION(OBJECT_ID(Objeto))
           FROM (VALUES (N'dbo.usp_Exp_CalcularTicketsReduce'), (N'dbo.usp_Exp_CalcularEfectividad'),
                        (N'dbo.vw_ProblemCategoria'), (N'dbo.vw_ProblemVencido'), (N'dbo.trg_Problem_EstadoEvento'),
                        (N'dbo.trg_Problem_FechaEvento')) AS x (Objeto))
SELECT D3 = 'definicion', o.Objeto, Trozo = n.i, Texto = SUBSTRING(o.Def, (n.i - 1) * 250 + 1, 250)
FROM o JOIN n ON (n.i - 1) * 250 < LEN(o.Def)
ORDER BY o.Objeto, n.i;

/* ---------- D4. Precondiciones de sql/18 ---------- */
SELECT D4 = 'precondiciones 18',
       ColumnasCategoriaYaExisten = CASE WHEN COL_LENGTH('dbo.ProblemCategoria', 'FechaAnalisisCategoria') IS NULL THEN 0 ELSE 1 END,
       ColumnaCategoriaEnEventos  = CASE WHEN COL_LENGTH('dbo.ProblemFechaEvento', 'Categoria') IS NULL THEN 0 ELSE 1 END,
       EsquemaAdmExiste           = CASE WHEN SCHEMA_ID('adm') IS NULL THEN 0 ELSE 1 END,
       TriggerFechaProblem        = (SELECT CASE WHEN is_disabled = 0 THEN 'activo' ELSE 'DESACTIVADO' END
                                     FROM sys.triggers WHERE object_id = OBJECT_ID('dbo.trg_Problem_FechaEvento')),
       TriggersEnProblemCategoria = (SELECT COUNT(*) FROM sys.triggers WHERE parent_id = OBJECT_ID('dbo.ProblemCategoria')),
       TriggersEnProblemFechaEvento = (SELECT COUNT(*) FROM sys.triggers WHERE parent_id = OBJECT_ID('dbo.ProblemFechaEvento')),
       CategoriaTipo = (SELECT TYPE_NAME(user_type_id) + '(' + CONVERT(varchar(10), max_length / 2) + ') ' + collation_name
                        FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProblemCategoria') AND name = 'Categoria'),
       FilasEventos = (SELECT COUNT_BIG(*) FROM dbo.ProblemFechaEvento),
       FilasProblem = (SELECT COUNT_BIG(*) FROM dbo.Problem),
       FilasCategoria = (SELECT COUNT_BIG(*) FROM dbo.ProblemCategoria);
SELECT D4b = 'checks ProblemFechaEvento', name, definition, is_disabled
FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.ProblemFechaEvento') ORDER BY name;
-- Modulos que hacen INSERT sobre ProblemCategoria / ProblemFechaEvento (las
-- columnas nuevas aceptan NULL; un INSERT sin lista de columnas fallaria).
SELECT D4c = 'escriben las tablas', Modulo = OBJECT_SCHEMA_NAME(m.object_id) + '.' + OBJECT_NAME(m.object_id),
       Tabla = t.Tabla
FROM sys.sql_modules AS m
CROSS APPLY (VALUES (N'ProblemCategoria'), (N'ProblemFechaEvento')) AS t (Tabla)
WHERE m.definition LIKE N'%INSERT%' + t.Tabla + N'%' OR m.definition LIKE N'%MERGE%' + t.Tabla + N'%'
ORDER BY 2, 3;

/* ---------- D5. Identidad del sitio y permisos efectivos ---------- */
SELECT D5 = 'principal del sitio', dp.name, dp.type_desc, dp.authentication_type_desc, Login = SUSER_SNAME(dp.sid)
FROM sys.database_principals AS dp WHERE dp.name = @UsuarioSitio;
SELECT D5b = 'roles', Rol = r.name
FROM sys.database_role_members AS rm
JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals AS u ON u.principal_id = rm.member_principal_id
WHERE u.name = @UsuarioSitio;
SELECT D5c = 'permisos explicitos', p.state_desc, p.permission_name, p.class_desc,
       Sobre = CASE p.class WHEN 3 THEN SCHEMA_NAME(p.major_id) WHEN 1 THEN OBJECT_SCHEMA_NAME(p.major_id) + '.' + OBJECT_NAME(p.major_id) ELSE '(base)' END
FROM sys.database_permissions AS p
JOIN sys.database_principals AS u ON u.principal_id = p.grantee_principal_id
WHERE u.name = @UsuarioSitio
ORDER BY 2, 4;
BEGIN TRY
    EXECUTE AS USER = @UsuarioSitio;
    SELECT D5d = 'efectivos (como el sitio)',
           LeeProblem = HAS_PERMS_BY_NAME('dbo.Problem', 'OBJECT', 'SELECT'),
           LeeEventos = HAS_PERMS_BY_NAME('dbo.ProblemFechaEvento', 'OBJECT', 'SELECT'),
           LeeVistaCategoria = HAS_PERMS_BY_NAME('dbo.vw_ProblemCategoria', 'OBJECT', 'SELECT'),
           EjecutaDbo = HAS_PERMS_BY_NAME('dbo', 'SCHEMA', 'EXECUTE'),
           EjecutaAdm = CASE WHEN SCHEMA_ID('adm') IS NULL THEN NULL ELSE HAS_PERMS_BY_NAME('adm', 'SCHEMA', 'EXECUTE') END,
           EjecutaCrear = HAS_PERMS_BY_NAME('adm.usp_GestionAdmin_Crear', 'OBJECT', 'EXECUTE'),
           Usuario = USER_NAME();
    REVERT;
END TRY
BEGIN CATCH
    IF USER_NAME() = @UsuarioSitio REVERT;
    SELECT D5d = 'efectivos: no se pudo suplantar', Error = ERROR_MESSAGE();
END CATCH;

/* ---------- D6. Cargador del Excel: version y ultimas cargas ---------- */
-- Dinamico: si stg.Problems o dbo.ExpTicketsReduce no existen, el lote no compilaria.
DECLARE @stg datetime2(0), @tr datetime2(0);
IF OBJECT_ID('stg.Problems', 'U') IS NOT NULL
    EXEC sys.sp_executesql N'SELECT @x = MAX(FechaCargaStg) FROM stg.Problems;', N'@x datetime2(0) OUTPUT', @x = @stg OUTPUT;
IF OBJECT_ID('dbo.ExpTicketsReduce', 'U') IS NOT NULL
    EXEC sys.sp_executesql N'SELECT @x = MAX(FechaCalculo) FROM dbo.ExpTicketsReduce;', N'@x datetime2(0) OUTPUT', @x = @tr OUTPUT;
SELECT D6 = 'cargas', UltimaCargaProblem = (SELECT MAX(FechaUltimaCargaDW) FROM dbo.Problem),
       UltimaCargaCategoria = (SELECT MAX(FechaUltimaCargaDW) FROM dbo.ProblemCategoria),
       UltimoStgProblems = @stg, UltimoCalculoTicketsReduce = @tr;
-- Quien mas llama al cargador desde la base (los .py no se ven desde aqui).
SELECT D6b = 'llaman al cargador', Modulo = OBJECT_SCHEMA_NAME(object_id) + '.' + OBJECT_NAME(object_id)
FROM sys.sql_modules WHERE definition LIKE N'%usp_CargarExperiencia%' AND object_id <> OBJECT_ID('dbo.usp_CargarExperiencia');
BEGIN TRY
    SELECT D6c = 'jobs de SQL Agent', j.name, j.enabled, s.step_name, s.subsystem, Comando = LEFT(s.command, 200)
    FROM msdb.dbo.sysjobs AS j JOIN msdb.dbo.sysjobsteps AS s ON s.job_id = j.job_id
    WHERE s.command LIKE N'%CargarExperiencia%' OR s.command LIKE N'%cargar_experiencia%' OR s.command LIKE N'%ExpTicketsReduce%'
       OR s.command LIKE N'%CalcularTicketsReduce%';
END TRY
BEGIN CATCH SELECT D6c = 'jobs: sin permiso en msdb', Error = ERROR_MESSAGE(); END CATCH;

/* ---------- D7. Datos que afectan las reglas de Admin ---------- */
-- a) Codigos de este anio por prefijo: el siguiente que emitiria Admin y los
--    que BLOQUEARIAN el alta de ese prefijo (51023: numero ilegible).
WITH c AS (
    SELECT pre.Prefijo, p.Codigo, p.VigenteEnOrigen,
           Resto = SUBSTRING(x.Plano, LEN(pre.Prefijo) + 5, 100)
    FROM dbo.CatPrefijoProblem AS pre
    JOIN dbo.Problem AS p ON 1 = 1
    CROSS APPLY (SELECT Plano = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.Codigo)), N' ', N''), N'-', N''), NCHAR(160), N''), NCHAR(9), N''))) AS x
    WHERE LEFT(x.Plano, LEN(pre.Prefijo) + 4) = UPPER(pre.Prefijo) + CONVERT(char(4), YEAR(@Hoy)))
SELECT D7a = 'codigos ' + CONVERT(char(4), YEAR(@Hoy)), Prefijo,
       Codigos = COUNT(*), Inactivos = SUM(CASE WHEN VigenteEnOrigen = 0 THEN 1 ELSE 0 END),
       MaxNumero = MAX(CASE WHEN Resto <> N'' AND Resto NOT LIKE N'%[^0-9]%' AND LEN(Resto) <= 9 THEN CONVERT(int, Resto) END),
       MalFormadosLegibles = SUM(CASE WHEN Resto <> N'' AND Resto NOT LIKE N'%[^0-9]%' AND LEN(Resto) <= 9
                                       AND Codigo NOT LIKE Prefijo + N' [0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]' THEN 1 ELSE 0 END),
       Ilegibles_BloqueanAlta = SUM(CASE WHEN NOT (Resto <> N'' AND Resto NOT LIKE N'%[^0-9]%' AND LEN(Resto) <= 9) THEN 1 ELSE 0 END)
FROM c GROUP BY Prefijo ORDER BY Prefijo;
WITH c AS (
    SELECT pre.Prefijo, p.Codigo, Resto = SUBSTRING(x.Plano, LEN(pre.Prefijo) + 5, 100)
    FROM dbo.CatPrefijoProblem AS pre JOIN dbo.Problem AS p ON 1 = 1
    CROSS APPLY (SELECT Plano = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.Codigo)), N' ', N''), N'-', N''), NCHAR(160), N''), NCHAR(9), N''))) AS x
    WHERE LEFT(x.Plano, LEN(pre.Prefijo) + 4) = UPPER(pre.Prefijo) + CONVERT(char(4), YEAR(@Hoy)))
SELECT D7a2 = 'codigos que bloquean', Prefijo, Codigo FROM c
WHERE NOT (Resto <> N'' AND Resto NOT LIKE N'%[^0-9]%' AND LEN(Resto) <= 9) ORDER BY Prefijo, Codigo;
SELECT D7a3 = 'prefijos del catalogo que no forman Codigo', Prefijo FROM dbo.CatPrefijoProblem
WHERE Prefijo COLLATE Latin1_General_BIN NOT LIKE N'[A-Z][A-Z][A-Z]';

-- b) Filas vivas SIN agrupacion: la base (sql/18) las cuenta contra el tope;
--    el tablero no.
SELECT D7b = 'vivas sin agrupacion', pc.Codigo, pc.Categoria, pc.PctDisminucion, p.Estado
FROM dbo.ProblemCategoria AS pc JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
WHERE pc.VigenteEnOrigen = 1 AND p.VigenteEnOrigen = 1
  AND LTRIM(RTRIM(p.Estado)) COLLATE Latin1_General_CI_AI IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
  AND NULLIF(LTRIM(RTRIM(pc.TipoAgrupado)), N'') IS NULL
ORDER BY pc.Categoria, pc.Codigo;

-- c) Rutas por encima de 100% hoy: con la regla del tablero y con la de la
--    base (que suma las vivas sin agrupacion). Ahi solo se podra bajar o dejar igual.
SELECT D7c = 'rutas > 100%', Ruta, PctTablero, PctBase
FROM (
    SELECT Ruta = LTRIM(RTRIM(REPLACE(pc.Categoria, NCHAR(160), N' '))),
           PctTablero = SUM(CASE WHEN LTRIM(RTRIM(pc.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora') THEN ISNULL(pc.PctDisminucion, 0) ELSE 0 END),
           PctBase = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(pc.TipoAgrupado)), N'') IS NULL
                                OR LTRIM(RTRIM(pc.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora') THEN ISNULL(pc.PctDisminucion, 0) ELSE 0 END)
    FROM dbo.ProblemCategoria AS pc JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
    WHERE pc.VigenteEnOrigen = 1 AND p.VigenteEnOrigen = 1
      AND LTRIM(RTRIM(p.Estado)) COLLATE Latin1_General_CI_AI IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
    GROUP BY LTRIM(RTRIM(REPLACE(pc.Categoria, NCHAR(160), N' ')))) AS r
WHERE PctTablero > 1 OR PctBase > 1
ORDER BY PctBase DESC;

-- d) Lo que ofrecera el formulario (valores que ya existen).
SELECT D7d = 'valores', Campo = 'Estado', Valor = LTRIM(RTRIM(Estado)), Filas = COUNT(*) FROM dbo.Problem GROUP BY LTRIM(RTRIM(Estado))
UNION ALL SELECT 'D7d', 'TipoIniciativa', LTRIM(RTRIM(TipoIniciativa)), COUNT(*) FROM dbo.Problem GROUP BY LTRIM(RTRIM(TipoIniciativa))
UNION ALL SELECT 'D7d', 'TipoAgrupado', LTRIM(RTRIM(TipoAgrupado)), COUNT(*) FROM dbo.ProblemCategoria GROUP BY LTRIM(RTRIM(TipoAgrupado))
ORDER BY 2, 3;

/* ---------- D8. Quien lee columnas que Admin deja NULL o que el cargador mantenia ---------- */
SELECT D8 = 'consumidores', Columna = c.Col, Modulo = OBJECT_SCHEMA_NAME(m.object_id) + '.' + OBJECT_NAME(m.object_id),
       Tipo = o.type_desc
FROM sys.sql_modules AS m JOIN sys.objects AS o ON o.object_id = m.object_id
CROSS APPLY (VALUES (N'EstadoProblem'), (N'CierreProblem'), (N'MejorFecha'), (N'FechaOriginalCierre'),
                    (N'FechaOriginalSolucion'), (N'OwnerProblem'), (N'OwnerServicio'), (N'Direccion'),
                    (N'TituloIniciativa'), (N'MesReduccion'), (N'TipoTicket'), (N'NroCambioFecha')) AS c (Col)
WHERE m.definition LIKE N'%' + c.Col + N'%'
  AND m.object_id NOT IN (OBJECT_ID('dbo.usp_CargarExperiencia'))
ORDER BY 2, 3;

/* ---------- D9. Respaldo (para el rollback) ---------- */
BEGIN TRY
    SELECT D9 = 'ultimo respaldo', b.type, Ultimo = MAX(b.backup_finish_date)
    FROM msdb.dbo.backupset AS b WHERE b.database_name = DB_NAME() GROUP BY b.type;
END TRY
BEGIN CATCH SELECT D9 = 'respaldos: sin permiso en msdb', Error = ERROR_MESSAGE(); END CATCH;
