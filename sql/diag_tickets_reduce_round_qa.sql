/* =====================================================================================
   diag_tickets_reduce_round_qa.sql  -  SOLO LECTURA.  (2026-11-11)
   Servidor: AZVMBDCENTRALQA   Base: Tickets_Proactivanet

   SEGURIDAD
     Solo SELECT sobre metadatos (OBJECT_DEFINITION, sys.*, HASHBYTES) y sobre
     tablas/vistas existentes, y SELECT a msdb / DMV dentro de TRY/CATCH.
     Ningun INSERT / UPDATE / DELETE / MERGE, ningun CREATE / ALTER / DROP,
     ningun EXEC de procedimientos de la aplicacion ni de sistema, ninguna
     tabla temporal ni variable de tabla, ningun cambio de SESSION_CONTEXT.
     No abre transacciones. Se puede correr completo (F5) cuantas veces se
     quiera. Cada seccion es su propio lote (GO): si una falla por permisos,
     las demas siguen. Requiere SQL Server 2016+ (SESSION_CONTEXT no se usa;
     nada posterior a 2016).

   PARA QUE (revision "Tickets a reducir", regla objetivo ROUND(x, 0))
     S0  contexto: servidor, base, cuenta, version, VIEW DEFINITION.
     S1  adm.usp_GestionAdmin_TicketsReduce: hash y version
           sql/18 (ROUND)   0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46  = objetivo
           sql/33 (FLOOR)   0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F
           sql/84 (CEILING) 0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591  (borrador, nunca en repo)
         (regla de hash de sql/20 a 33 y ADM_04 sec 11: SHA2_256 de
         OBJECT_DEFINITION sin espacios, tabs ni saltos de linea).
     S2  propiedades extendidas del procedimiento (marca TicketsReduceAntes).
     S3  definicion COMPLETA de adm.usp_GestionAdmin_TicketsReduce, en trozos.
     S4  dbo.usp_Exp_CalcularTicketsReduce (foto diaria, script 65, cuerpo NO
         disponible en ningun repositorio): fechas, hash, redondeos y donde.
     S5  definicion COMPLETA de dbo.usp_Exp_CalcularTicketsReduce, en trozos.
     S6  modulos que referencian los dos procedimientos y dbo.ExpTicketsReduce.
     S7  trabajos del Agente SQL que los corren (msdb; puede faltar permiso).
     S8  permisos declarados sobre los dos procedimientos.
     S9  objetos/columnas que el procedimiento usa (tipos y CHECK).
     S10 regla REAL de la foto inferida de sus datos (ROUND / FLOOR / CEILING,
         separando fraccion < .5, = .5 y > .5).
     S11 cuantas filas leen Experiencia / Registro desde la foto y no desde
         ProblemCategoria.TicketsReduce (ExperienciaQueries.LeerIniciativas).
     S12 % raros (NULL, 0, > 1, negativos).
     S13 lo guardado HOY en ProblemCategoria.TicketsReduce contra ROUND / FLOOR
         / CEILING con el VolumenUltimos30 de AHORA (estimado: la ventana se mueve).
     S14 ventana de volumen: foto (Volumen30) contra Admin (VolumenUltimos30).
     S15 ultimas ejecuciones en cache (VIEW SERVER STATE; puede faltar permiso).
     S16 "Iniciativas sin categoria": la regla EXACTA del sitio
         (ExperienciaQueries.LeerIniciativasSinCategoria: Problem vigente sin
         NINGUNA fila vigente en ProblemCategoria) y si esas iniciativas tienen
         filas NO vigentes (lo que explicaria el sintoma sin redondeo).
     S17 filas cuyo Tickets a reducir MOSTRADO cambiaria de 0 a > 0 (o al
         reves) con ROUND: las unicas en que el redondeo podria cambiar que una
         rama de Experiencia se vea (tieneDatos: volumen > 0 o ini_total > 0).
     S18 marca de Migracion 83 (solo para confirmar que no se toca: lectura).

   COMO CORRERLO
     SSMS -> conectar a AZVMBDCENTRALQA -> base Tickets_Proactivanet -> abrir
     este archivo -> Resultados en cuadricula (Ctrl+D) -> F5. Copiar TODAS las
     cuadriculas (o "Guardar resultados como" .csv por seccion). S3 y S5
     traen la definicion en trozos de 3000 caracteres: pegarlos en orden.
   ===================================================================================== */
SET NOCOUNT ON;
GO

/* S0) Contexto */
SELECT Seccion = 'S0', Servidor = @@SERVERNAME, Base = DB_NAME(), Cuenta = SUSER_SNAME(), Usuario = USER_NAME(),
       VersionSql = CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion')),
       VerDefinicion = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION'),
       Ahora = SYSDATETIME();
GO

/* S1) Version de adm.usp_GestionAdmin_TicketsReduce */
SELECT Seccion = 'S1', Objeto = N'adm.usp_GestionAdmin_TicketsReduce',
       Existe     = CASE WHEN o.object_id IS NULL THEN 0 ELSE 1 END,
       Hash       = CONVERT(varchar(66), h.Hash, 1),
       Revision   = CASE WHEN h.Hash = 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46 THEN 'sql/18 (ROUND) = OBJETIVO ROUND'
                         WHEN h.Hash = 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F THEN 'sql/33 (FLOOR)'
                         WHEN h.Hash = 0xD6C0873670C7832F0A9B7AAC6935B5592885C58C056B06218ACC2E0195468591 THEN 'sql/84 BORRADOR CEILING - APLICADO (inesperado)'
                         WHEN o.object_id IS NULL THEN 'NO EXISTE'
                         WHEN d.Def IS NULL THEN 'SIN VIEW DEFINITION'
                         ELSE 'OTRA: revisar' END,
       UsaRound   = CASE WHEN d.Def LIKE N'%ROUND(%'   THEN 1 ELSE 0 END,
       UsaFloor   = CASE WHEN d.Def LIKE N'%FLOOR(%'   THEN 1 ELSE 0 END,
       UsaCeiling = CASE WHEN d.Def LIKE N'%CEILING(%' THEN 1 ELSE 0 END,
       HashCrudo  = CONVERT(varchar(66), HASHBYTES('SHA2_256', d.Def), 1),
       Caracteres = DATALENGTH(d.Def) / 2,
       o.create_date, o.modify_date
FROM (SELECT object_id = OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P')) AS x
LEFT JOIN sys.objects AS o ON o.object_id = x.object_id
OUTER APPLY (SELECT Def = OBJECT_DEFINITION(x.object_id)) AS d
OUTER APPLY (SELECT Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(d.Def, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h;
GO

/* S2) Propiedades extendidas del procedimiento (TicketsReduceAntes solo existe si se aplico el borrador CEILING sql/84) */
SELECT Seccion = 'S2', Propiedad = ep.name, Valor = CONVERT(nvarchar(200), ep.value)
FROM sys.extended_properties AS ep
WHERE ep.class = 1 AND ep.minor_id = 0
  AND ep.major_id = OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P');
SELECT Seccion = 'S2', TicketsReduceAntesExiste =
       CASE WHEN EXISTS (SELECT 1 FROM sys.extended_properties
                         WHERE class = 1 AND minor_id = 0 AND name = N'TicketsReduceAntes'
                           AND major_id = OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P')) THEN 1 ELSE 0 END;
GO

/* S3) Definicion completa de adm.usp_GestionAdmin_TicketsReduce, en trozos de 3000 (pegar en orden) */
WITH n AS (SELECT TOP (400) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 FROM sys.all_objects)
SELECT Seccion = 'S3', Parte = n.i + 1, Texto = SUBSTRING(d.Def, n.i * 3000 + 1, 3000)
FROM (SELECT Def = OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'))) AS d
CROSS JOIN n
WHERE d.Def IS NOT NULL AND n.i * 3000 < DATALENGTH(d.Def) / 2
ORDER BY n.i;
GO

/* S4) dbo.usp_Exp_CalcularTicketsReduce: metadatos y redondeo */
SELECT Seccion = 'S4', Objeto = N'dbo.usp_Exp_CalcularTicketsReduce',
       Existe     = CASE WHEN o.object_id IS NULL THEN 0 ELSE 1 END,
       Hash       = CONVERT(varchar(66), HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(d.Def, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1),
       HashCrudo  = CONVERT(varchar(66), HASHBYTES('SHA2_256', d.Def), 1),
       Caracteres = DATALENGTH(d.Def) / 2,
       UsaRound   = CASE WHEN d.Def LIKE N'%ROUND(%'   THEN 1 ELSE 0 END,
       UsaFloor   = CASE WHEN d.Def LIKE N'%FLOOR(%'   THEN 1 ELSE 0 END,
       UsaCeiling = CASE WHEN d.Def LIKE N'%CEILING(%' THEN 1 ELSE 0 END,
       UsaConvertInt = CASE WHEN d.Def LIKE N'%CONVERT(int%' OR d.Def LIKE N'%CAST(%AS int%' THEN 1 ELSE 0 END,
       o.create_date, o.modify_date
FROM (SELECT object_id = OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P')) AS x
LEFT JOIN sys.objects AS o ON o.object_id = x.object_id
OUTER APPLY (SELECT Def = OBJECT_DEFINITION(x.object_id)) AS d;

/* Parametros */
SELECT Seccion = 'S4', Parametro = p.name, Tipo = TYPE_NAME(p.user_type_id), p.max_length, p.has_default_value
FROM sys.parameters AS p WHERE p.object_id = OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P') ORDER BY p.parameter_id;

/* Cada aparicion de ROUND( / FLOOR( / CEILING( / CONVERT(int / TicketsReduce, con 150 caracteres alrededor */
WITH n AS (SELECT TOP (200000) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) FROM sys.all_objects AS a CROSS JOIN sys.all_objects AS b),
     d AS (SELECT Def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'))),
     f AS (SELECT Funcion FROM (VALUES (N'ROUND('), (N'FLOOR('), (N'CEILING('), (N'CONVERT(int'), (N'TicketsReduce')) AS v (Funcion))
SELECT Seccion = 'S4', f.Funcion, Posicion = n.i,
       Fragmento = SUBSTRING(d.Def, CASE WHEN n.i > 150 THEN n.i - 150 ELSE 1 END, 300)
FROM d CROSS JOIN f CROSS JOIN n
WHERE d.Def IS NOT NULL AND n.i <= DATALENGTH(d.Def) / 2
  AND SUBSTRING(d.Def, n.i, LEN(f.Funcion)) = f.Funcion
ORDER BY f.Funcion, n.i;
GO

/* S5) Definicion completa de dbo.usp_Exp_CalcularTicketsReduce, en trozos de 3000 (pegar en orden) */
WITH n AS (SELECT TOP (400) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 FROM sys.all_objects)
SELECT Seccion = 'S5', Parte = n.i + 1, Texto = SUBSTRING(d.Def, n.i * 3000 + 1, 3000)
FROM (SELECT Def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'))) AS d
CROSS JOIN n
WHERE d.Def IS NOT NULL AND n.i * 3000 < DATALENGTH(d.Def) / 2
ORDER BY n.i;
GO

/* S6) Quien los referencia dentro de la base (texto de modulos + dependencias declaradas) */
SELECT Seccion = 'S6', Referenciado = t.Nombre,
       Modulo = OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id),
       Tipo = o.type_desc, o.modify_date
FROM (VALUES (N'usp_GestionAdmin_TicketsReduce'), (N'usp_Exp_CalcularTicketsReduce'), (N'ExpTicketsReduce')) AS t (Nombre)
INNER JOIN sys.sql_modules AS m ON m.definition LIKE N'%' + t.Nombre + N'%'
INNER JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE o.name <> t.Nombre
ORDER BY t.Nombre, Modulo;

SELECT Seccion = 'S6', Origen = OBJECT_SCHEMA_NAME(d.referencing_id) + N'.' + OBJECT_NAME(d.referencing_id),
       Referencia = ISNULL(d.referenced_schema_name + N'.', N'') + d.referenced_entity_name
FROM sys.sql_expression_dependencies AS d
WHERE d.referenced_entity_name IN (N'usp_GestionAdmin_TicketsReduce', N'usp_Exp_CalcularTicketsReduce', N'ExpTicketsReduce')
   OR d.referencing_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'), OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'))
ORDER BY Origen, Referencia;
GO

/* S7) Trabajos del Agente SQL (msdb). Si falla por permiso, anotar el error y seguir. */
BEGIN TRY
    SELECT Seccion = 'S7', Trabajo = j.name, Habilitado = j.enabled, Paso = s.step_id, NombrePaso = s.step_name,
           s.subsystem, s.database_name, Comando = LEFT(s.command, 400)
    FROM msdb.dbo.sysjobs AS j
    INNER JOIN msdb.dbo.sysjobsteps AS s ON s.job_id = j.job_id
    WHERE s.command LIKE N'%usp_Exp_CalcularTicketsReduce%'
       OR s.command LIKE N'%usp_GestionAdmin_TicketsReduce%'
       OR s.command LIKE N'%etl_proactivanet%'
       OR s.command LIKE N'%cargar_experiencia%';
END TRY
BEGIN CATCH
    SELECT Seccion = 'S7', Error = ERROR_NUMBER(), Mensaje = ERROR_MESSAGE();
END CATCH;
GO

/* S8) Permisos declarados sobre los dos procedimientos */
SELECT Seccion = 'S8', Objeto = OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id),
       Principal = USER_NAME(p.grantee_principal_id), p.permission_name, p.state_desc
FROM sys.database_permissions AS p
WHERE p.class = 1 AND p.major_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'), OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'))
ORDER BY Objeto, Principal;
GO

/* S9) Objetos y columnas que adm.usp_GestionAdmin_TicketsReduce (sql/18 / sql/33) necesita */
SELECT Seccion = 'S9', Chequeo, Ok
FROM (VALUES
  (N'tipo adm.CategoriaPctTipo',                  CASE WHEN TYPE_ID(N'adm.CategoriaPctTipo') IS NOT NULL THEN 1 ELSE 0 END),
  (N'tabla dbo.ProblemCategoria',                 CASE WHEN OBJECT_ID(N'dbo.ProblemCategoria', N'U') IS NOT NULL THEN 1 ELSE 0 END),
  (N'ProblemCategoria.TicketsReduce',             CASE WHEN COL_LENGTH(N'dbo.ProblemCategoria', N'TicketsReduce') IS NOT NULL THEN 1 ELSE 0 END),
  (N'ProblemCategoria.PctDisminucion',            CASE WHEN COL_LENGTH(N'dbo.ProblemCategoria', N'PctDisminucion') IS NOT NULL THEN 1 ELSE 0 END),
  (N'vista dbo.vw_ProblemCategoria',              CASE WHEN OBJECT_ID(N'dbo.vw_ProblemCategoria', N'V') IS NOT NULL THEN 1 ELSE 0 END),
  (N'vw_ProblemCategoria.VolumenUltimos30',       CASE WHEN COL_LENGTH(N'dbo.vw_ProblemCategoria', N'VolumenUltimos30') IS NOT NULL THEN 1 ELSE 0 END),
  (N'tabla dbo.ExpTicketsReduce (foto)',          CASE WHEN OBJECT_ID(N'dbo.ExpTicketsReduce', N'U') IS NOT NULL THEN 1 ELSE 0 END)
) AS v (Chequeo, Ok);

SELECT Seccion = 'S9', Tabla = OBJECT_SCHEMA_NAME(c.object_id) + N'.' + OBJECT_NAME(c.object_id), Columna = c.name,
       Tipo = TYPE_NAME(c.user_type_id), c.precision, c.scale, c.is_nullable
FROM sys.columns AS c
WHERE (c.object_id = OBJECT_ID(N'dbo.ProblemCategoria')   AND c.name IN (N'PctDisminucion', N'TicketsReduce'))
   OR (c.object_id = OBJECT_ID(N'dbo.vw_ProblemCategoria') AND c.name IN (N'PctDisminucion', N'VolumenUltimos30', N'TicketsReduce'))
   OR (c.object_id = OBJECT_ID(N'dbo.ExpTicketsReduce'))
ORDER BY Tabla, c.column_id;

SELECT Seccion = 'S9', Restriccion = cc.name, Tabla = OBJECT_NAME(cc.parent_object_id), cc.definition
FROM sys.check_constraints AS cc
WHERE cc.parent_object_id IN (OBJECT_ID(N'dbo.ProblemCategoria'), OBJECT_ID(N'dbo.ExpTicketsReduce'));
GO

/* S10) Regla REAL de la foto, inferida de sus datos. Para cada fila con % y
   volumen: si lo guardado coincide con ROUND / FLOOR / CEILING de
   Volumen30 x Pct (topado a 1 y sin topar). "Distinguibles" = filas donde
   FLOOR <> CEILING (las unicas que dicen algo). */
SELECT Seccion = 'S10',
       Filas            = COUNT(*),
       ConPctYVolumen   = SUM(CASE WHEN x.Pct IS NOT NULL AND x.Volumen30 IS NOT NULL THEN 1 ELSE 0 END),
       TicketsNull      = SUM(CASE WHEN x.TicketsReduce IS NULL THEN 1 ELSE 0 END),
       Distinguibles    = SUM(CASE WHEN c.Fl <> c.Ce THEN 1 ELSE 0 END),
       Dist_Round       = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce = c.Ro THEN 1 ELSE 0 END),
       Dist_Floor       = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce = c.Fl THEN 1 ELSE 0 END),
       Dist_Ceiling     = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       Dist_Ninguna     = SUM(CASE WHEN c.Fl <> c.Ce AND x.TicketsReduce NOT IN (c.Ro, c.Fl, c.Ce) THEN 1 ELSE 0 END),
       MediosExactos    = SUM(CASE WHEN c.EsMedio = 1 THEN 1 ELSE 0 END),
       Medios_Round     = SUM(CASE WHEN c.EsMedio = 1 AND x.TicketsReduce = c.Ro THEN 1 ELSE 0 END),
       FracBajo         = SUM(CASE WHEN c.Fr > 0 AND c.Fr < 0.5 THEN 1 ELSE 0 END),
       FracBajo_EsFloor = SUM(CASE WHEN c.Fr > 0 AND c.Fr < 0.5 AND x.TicketsReduce = c.Fl THEN 1 ELSE 0 END),
       FracBajo_EsCeil  = SUM(CASE WHEN c.Fr > 0 AND c.Fr < 0.5 AND x.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       FracAlto         = SUM(CASE WHEN c.Fr > 0.5 THEN 1 ELSE 0 END),
       FracAlto_EsFloor = SUM(CASE WHEN c.Fr > 0.5 AND x.TicketsReduce = c.Fl THEN 1 ELSE 0 END),
       FracAlto_EsCeil  = SUM(CASE WHEN c.Fr > 0.5 AND x.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       Medio_EsArriba   = SUM(CASE WHEN c.Fr = 0.5 AND x.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       Medio_EsAbajo    = SUM(CASE WHEN c.Fr = 0.5 AND x.TicketsReduce = c.Fl THEN 1 ELSE 0 END),
       Medio_EsPar      = SUM(CASE WHEN c.Fr = 0.5 AND x.TicketsReduce % 2 = 0 AND x.TicketsReduce IN (c.Fl, c.Ce) THEN 1 ELSE 0 END),
       PctMayorQue1     = SUM(CASE WHEN x.Pct > 1 THEN 1 ELSE 0 END),
       PctMayor1_Topado = SUM(CASE WHEN x.Pct > 1 AND x.TicketsReduce IN (c.Ro, c.Fl, c.Ce) THEN 1 ELSE 0 END),
       UltimoHoy        = MAX(x.Hoy),
       UltimoCalculo    = MAX(x.FechaCalculo)
FROM dbo.ExpTicketsReduce AS x
CROSS APPLY (SELECT P = CONVERT(decimal(19,6), x.Volumen30) * CASE WHEN x.Pct > 1 THEN 1.0 ELSE x.Pct END) AS p
CROSS APPLY (SELECT Ro = CONVERT(int, ROUND(p.P, 0)), Fl = CONVERT(int, FLOOR(p.P)), Ce = CONVERT(int, CEILING(p.P)),
                    EsMedio = CASE WHEN p.P - FLOOR(p.P) = 0.5 THEN 1 ELSE 0 END,
                    Fr = p.P - FLOOR(p.P)) AS c;

/* Las 30 filas distinguibles, para ver ejemplos concretos */
SELECT TOP (30) Seccion = 'S10', x.Codigo, x.Categoria, x.Pct, x.Volumen30, Guardado = x.TicketsReduce,
       Producto = p.P, c.Ro, c.Fl, c.Ce, x.TicketsReduceExcel, x.Hoy
FROM dbo.ExpTicketsReduce AS x
CROSS APPLY (SELECT P = CONVERT(decimal(19,6), x.Volumen30) * CASE WHEN x.Pct > 1 THEN 1.0 ELSE x.Pct END) AS p
CROSS APPLY (SELECT Ro = CONVERT(int, ROUND(p.P, 0)), Fl = CONVERT(int, FLOOR(p.P)), Ce = CONVERT(int, CEILING(p.P))) AS c
WHERE c.Fl <> c.Ce
ORDER BY x.Codigo, x.Categoria;
GO

/* S11) Cuanto pesa la foto: lo que leen Experiencia y el Registro de Admin
   (ExperienciaQueries.LeerIniciativas: foto si tr.Pct = % actual; si no,
   ProblemCategoria.TicketsReduce). */
SELECT Seccion = 'S11',
       FilasVigentes   = COUNT(*),
       UsanFoto        = SUM(CASE WHEN tr.Codigo IS NOT NULL AND (tr.Pct = pc.PctDisminucion OR (tr.Pct IS NULL AND pc.PctDisminucion IS NULL)) THEN 1 ELSE 0 END),
       UsanFila        = SUM(CASE WHEN tr.Codigo IS NOT NULL AND (tr.Pct = pc.PctDisminucion OR (tr.Pct IS NULL AND pc.PctDisminucion IS NULL)) THEN 0 ELSE 1 END),
       FotoDistintaFila = SUM(CASE WHEN tr.Codigo IS NOT NULL AND tr.Pct = pc.PctDisminucion
                                     AND ISNULL(tr.TicketsReduce, -1) <> ISNULL(pc.TicketsReduce, -1) THEN 1 ELSE 0 END)
FROM dbo.ProblemCategoria AS pc
LEFT JOIN dbo.ExpTicketsReduce AS tr ON tr.Codigo = pc.Codigo AND tr.Categoria = pc.Categoria
WHERE pc.VigenteEnOrigen = 1;
GO

/* S12) Datos de % que cualquier redondeo trata raro */
SELECT Seccion = 'S12',
       Filas       = COUNT(*),
       PctNull     = SUM(CASE WHEN PctDisminucion IS NULL THEN 1 ELSE 0 END),
       PctNegativo = SUM(CASE WHEN PctDisminucion < 0 THEN 1 ELSE 0 END),
       PctCero     = SUM(CASE WHEN PctDisminucion = 0 THEN 1 ELSE 0 END),
       PctUno      = SUM(CASE WHEN PctDisminucion = 1 THEN 1 ELSE 0 END),
       PctMayor1   = SUM(CASE WHEN PctDisminucion > 1 THEN 1 ELSE 0 END),
       TicketsNegativos = SUM(CASE WHEN TicketsReduce < 0 THEN 1 ELSE 0 END)
FROM dbo.ProblemCategoria
WHERE VigenteEnOrigen = 1;
GO

/* S13) Impacto estimado: lo guardado HOY en ProblemCategoria.TicketsReduce
   contra ROUND / FLOOR / CEILING con el VolumenUltimos30 de AHORA (la misma
   fuente del procedimiento). El volumen se mueve con los dias: esto estima,
   no prueba la regla guardada. Nada se recalcula. */
SELECT Seccion = 'S13',
       ConPct            = COUNT(*),
       Guardado_Igual_Round   = SUM(CASE WHEN pc.TicketsReduce = c.Ro THEN 1 ELSE 0 END),
       Guardado_Igual_Floor   = SUM(CASE WHEN pc.TicketsReduce = c.Fl THEN 1 ELSE 0 END),
       Guardado_Igual_Ceiling = SUM(CASE WHEN pc.TicketsReduce = c.Ce THEN 1 ELSE 0 END),
       RoundDistintoDeGuardado   = SUM(CASE WHEN ISNULL(pc.TicketsReduce, -1) <> c.Ro THEN 1 ELSE 0 END),
       CeilingDistintoDeGuardado = SUM(CASE WHEN ISNULL(pc.TicketsReduce, -1) <> c.Ce THEN 1 ELSE 0 END),
       SumaGuardado = SUM(CONVERT(bigint, pc.TicketsReduce)),
       SumaCeiling  = SUM(CONVERT(bigint, c.Ce)),
       SumaFloor    = SUM(CONVERT(bigint, c.Fl)),
       SumaRound    = SUM(CONVERT(bigint, c.Ro))
FROM dbo.ProblemCategoria AS pc
OUTER APPLY (SELECT TOP (1) VolumenUltimos30 = ISNULL(x.VolumenUltimos30, 0)
             FROM dbo.vw_ProblemCategoria AS x
             WHERE x.Codigo = pc.Codigo AND x.Categoria = pc.Categoria) AS v
CROSS APPLY (SELECT P = v.VolumenUltimos30 * CASE WHEN pc.PctDisminucion > 1 THEN 1.0 ELSE pc.PctDisminucion END) AS p
CROSS APPLY (SELECT Ro = CONVERT(int, ROUND(p.P, 0)), Fl = CONVERT(int, FLOOR(p.P)), Ce = CONVERT(int, CEILING(p.P))) AS c
WHERE pc.VigenteEnOrigen = 1 AND pc.PctDisminucion IS NOT NULL;
GO

/* S14) Ventana de volumen: la foto (ExpTicketsReduce.Volumen30, ultimo Hoy)
   contra la de Admin (vw_ProblemCategoria.VolumenUltimos30, AHORA). Si
   difieren mucho, las dos rutas no usan la misma ventana (o la foto es de
   otro dia). Junto con S5 dice cual es la ventana de la foto. */
SELECT Seccion = 'S14',
       HoyFoto       = MAX(x.Hoy),
       CalculoFoto   = MAX(x.FechaCalculo),
       Ahora         = SYSDATETIME(),
       Filas         = COUNT(*),
       ConVistaFila  = SUM(CASE WHEN v.VolumenUltimos30 IS NOT NULL THEN 1 ELSE 0 END),
       Iguales       = SUM(CASE WHEN x.Volumen30 = v.VolumenUltimos30 THEN 1 ELSE 0 END),
       FotoMayor     = SUM(CASE WHEN x.Volumen30 > v.VolumenUltimos30 THEN 1 ELSE 0 END),
       FotoMenor     = SUM(CASE WHEN x.Volumen30 < v.VolumenUltimos30 THEN 1 ELSE 0 END),
       DifPromedio   = AVG(CONVERT(decimal(18,2), x.Volumen30 - v.VolumenUltimos30)),
       DifMaxAbs     = MAX(ABS(CONVERT(bigint, x.Volumen30) - v.VolumenUltimos30)),
       SumaFoto      = SUM(CONVERT(bigint, x.Volumen30)),
       SumaVista     = SUM(v.VolumenUltimos30)
FROM dbo.ExpTicketsReduce AS x
OUTER APPLY (SELECT TOP (1) y.VolumenUltimos30 FROM dbo.vw_ProblemCategoria AS y
             WHERE y.Codigo = x.Codigo AND y.Categoria = x.Categoria) AS v
WHERE x.Hoy = (SELECT MAX(Hoy) FROM dbo.ExpTicketsReduce);

SELECT TOP (25) Seccion = 'S14', x.Codigo, x.Categoria, x.Ruta, FotoVolumen30 = x.Volumen30,
       VistaVolumenUltimos30 = v.VolumenUltimos30, x.Hoy, x.FechaCalculo
FROM dbo.ExpTicketsReduce AS x
OUTER APPLY (SELECT TOP (1) y.VolumenUltimos30 FROM dbo.vw_ProblemCategoria AS y
             WHERE y.Codigo = x.Codigo AND y.Categoria = x.Categoria) AS v
WHERE x.Hoy = (SELECT MAX(Hoy) FROM dbo.ExpTicketsReduce)
  AND ISNULL(v.VolumenUltimos30, -1) <> x.Volumen30
ORDER BY ABS(CONVERT(bigint, x.Volumen30) - ISNULL(v.VolumenUltimos30, 0)) DESC;
GO

/* S15) Ultimas ejecuciones en cache (necesita VIEW SERVER STATE; si falla,
   anotar el error). Dice si el ETL corre la foto y cuando. */
BEGIN TRY
    SELECT Seccion = 'S15', Objeto = OBJECT_SCHEMA_NAME(ps.object_id, ps.database_id) + N'.' + OBJECT_NAME(ps.object_id, ps.database_id),
           ps.cached_time, ps.last_execution_time, ps.execution_count
    FROM sys.dm_exec_procedure_stats AS ps
    WHERE ps.database_id = DB_ID()
      AND ps.object_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_TicketsReduce', N'P'), OBJECT_ID(N'dbo.usp_Exp_CalcularTicketsReduce', N'P'));
END TRY
BEGIN CATCH
    SELECT Seccion = 'S15', Error = ERROR_NUMBER(), Mensaje = ERROR_MESSAGE();
END CATCH;
GO

/* S16) "Iniciativas sin categoria". Regla exacta del sitio
   (ExperienciaQueries.LeerIniciativasSinCategoriaDe): dbo.Problem con
   VigenteEnOrigen = 1 y SIN ninguna fila de dbo.ProblemCategoria con
   VigenteEnOrigen = 1. TicketsReduce / PctDisminucion NO participan.
   ConFilasNoVigentes = tienen categorias, pero ninguna vigente: el sintoma
   saldria de la vigencia, no del redondeo. */
SELECT Seccion = 'S16',
       ProblemsVigentes       = COUNT(*),
       SinCategoriaVigente    = SUM(CASE WHEN s.Vigentes = 0 THEN 1 ELSE 0 END),
       SinNingunaFila         = SUM(CASE WHEN s.Todas = 0 THEN 1 ELSE 0 END),
       ConFilasNoVigentes     = SUM(CASE WHEN s.Vigentes = 0 AND s.Todas > 0 THEN 1 ELSE 0 END),
       SinCat_Activas         = SUM(CASE WHEN s.Vigentes = 0 AND (p.Estado LIKE N'En An%lisis' OR p.Estado LIKE N'En Soluci%n' OR p.Estado = N'En Monitoreo') THEN 1 ELSE 0 END)
FROM dbo.Problem AS p
CROSS APPLY (SELECT Todas    = COUNT(*),
                    Vigentes = SUM(CASE WHEN pc.VigenteEnOrigen = 1 THEN 1 ELSE 0 END)
             FROM dbo.ProblemCategoria AS pc WHERE pc.Codigo = p.Codigo) AS s0
CROSS APPLY (SELECT Todas = s0.Todas, Vigentes = ISNULL(s0.Vigentes, 0)) AS s
WHERE p.VigenteEnOrigen = 1;

/* Por estado y tipo (las que Experiencia cuenta: activas de un agrupador) */
SELECT Seccion = 'S16', p.Estado, p.TipoIniciativa,
       SinCategoriaVigente = COUNT(*),
       ConFilasNoVigentes  = SUM(CASE WHEN s.Todas > 0 THEN 1 ELSE 0 END)
FROM dbo.Problem AS p
CROSS APPLY (SELECT Todas = COUNT(*), Vigentes = SUM(CASE WHEN pc.VigenteEnOrigen = 1 THEN 1 ELSE 0 END)
             FROM dbo.ProblemCategoria AS pc WHERE pc.Codigo = p.Codigo) AS s
WHERE p.VigenteEnOrigen = 1 AND ISNULL(s.Vigentes, 0) = 0
GROUP BY p.Estado, p.TipoIniciativa
ORDER BY COUNT(*) DESC;

/* Detalle (hasta 100) de las sin categoria vigente que SI tienen filas no
   vigentes: % y TicketsReduce de esas filas, para ver que no influyen. */
SELECT TOP (100) Seccion = 'S16', p.Codigo, p.Estado, p.TipoIniciativa,
       pc.Categoria, pc.VigenteEnOrigen, pc.PctDisminucion, pc.TicketsReduce
FROM dbo.Problem AS p
INNER JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = p.Codigo
WHERE p.VigenteEnOrigen = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS v WHERE v.Codigo = p.Codigo AND v.VigenteEnOrigen = 1)
ORDER BY p.Codigo, pc.Categoria;

/* Filas vigentes de ProblemCategoria que la vista no devuelve (no saldrian
   ni "con" ni "sin" categoria en LeerIniciativas). */
SELECT Seccion = 'S16', VigentesFueraDeLaVista = COUNT(*)
FROM dbo.ProblemCategoria AS pc
WHERE pc.VigenteEnOrigen = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.vw_ProblemCategoria AS v
                  WHERE v.Codigo = pc.Codigo AND v.Categoria = pc.Categoria AND v.VigenteEnOrigen = 1);
GO

/* S17) Sensibilidad al redondeo de lo MOSTRADO. Mostrado = lo que lee
   ExperienciaQueries.LeerIniciativas (foto si su Pct = el % actual; si no,
   ProblemCategoria.TicketsReduce). Se compara con ROUND(VolumenUltimos30 x %)
   de AHORA. Solo cuentan los cruces 0 <-> > 0: son los unicos que pueden
   cambiar que una rama se vea en Experiencia. Nada se recalcula. */
SELECT Seccion = 'S17',
       FilasConPct        = COUNT(*),
       Mostrado0_Round1Mas = SUM(CASE WHEN m.Mostrado = 0 AND c.Ro > 0 THEN 1 ELSE 0 END),
       MostradoMas_Round0  = SUM(CASE WHEN m.Mostrado > 0 AND c.Ro = 0 THEN 1 ELSE 0 END),
       MostradoDistintoRound = SUM(CASE WHEN ISNULL(m.Mostrado, -1) <> c.Ro THEN 1 ELSE 0 END),
       DesdeFoto          = SUM(CASE WHEN f.DeFoto = 1 THEN 1 ELSE 0 END)
FROM dbo.ProblemCategoria AS pc
LEFT JOIN dbo.ExpTicketsReduce AS tr ON tr.Codigo = pc.Codigo AND tr.Categoria = pc.Categoria
OUTER APPLY (SELECT TOP (1) VolumenUltimos30 = ISNULL(x.VolumenUltimos30, 0)
             FROM dbo.vw_ProblemCategoria AS x
             WHERE x.Codigo = pc.Codigo AND x.Categoria = pc.Categoria) AS v
CROSS APPLY (SELECT DeFoto = CASE WHEN tr.Codigo IS NOT NULL AND (tr.Pct = pc.PctDisminucion OR (tr.Pct IS NULL AND pc.PctDisminucion IS NULL)) THEN 1 ELSE 0 END) AS f
CROSS APPLY (SELECT Mostrado = CASE WHEN f.DeFoto = 1 THEN tr.TicketsReduce ELSE pc.TicketsReduce END) AS m
CROSS APPLY (SELECT Ro = CONVERT(int, ROUND(ISNULL(v.VolumenUltimos30, 0) * CASE WHEN pc.PctDisminucion > 1 THEN 1.0 ELSE pc.PctDisminucion END, 0))) AS c
WHERE pc.VigenteEnOrigen = 1 AND pc.PctDisminucion IS NOT NULL;
GO

/* S18) Migracion 83: solo lectura, para confirmar que sigue como se aplico
   2026-11-11 (este diagnostico no la toca). Objetos que la mencionan. */
SELECT Seccion = 'S18', Modulo = OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id), o.modify_date
FROM sys.sql_modules AS m
INNER JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE N'%sql/83%' OR m.definition LIKE N'%Migracion 83%'
ORDER BY o.modify_date DESC;
GO
