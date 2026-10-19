/* =====================================================================================
   diag_orquestacion_tablero.sql -- SOLO LECTURA. Antes y despues de instalar el 77.

   Base: Tickets_Proactivanet (la misma del 76). No crea, no cambia, no borra nada.
   Correr en SSMS (Resultados en cuadricula o texto) y mandar la salida.

   Responde lo que el paquete de Orquestacion no puede comprobar sin la base:
     1. Que objetos del 76 y del 77 existen.
     2. Si cada columna que leen el 77 y App_Code/OrquestacionQueries.cs existe
        con ese nombre (la lista sale de leer los dos archivos).
     3. Tipos: orq.Parametro.Valor (si es texto, la pestana lo convierte) y
        orq.CargaLote.FechaFin.
     4. Las cargas por estado y si FechaFin parece UTC o local.
     5. Valores de relleno repetidos bajo Latin1_General_CI_AI.
     6. JobName repetidos entre los vigentes (el 77 cruza decomisos por nombre).
     7. Quien tiene SELECT sobre el esquema orq (la cuenta del Web.config debe
        aparecer, directa o por rol).
     8. Con el 77 puesto: las cifras de la cabecera sin filtros.
   ===================================================================================== */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

/* 0. Donde estoy */
SELECT Base = DB_NAME(), Usuario = SUSER_SNAME(), UsuarioBase = USER_NAME(),
       Version = CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(30)),
       Compatibilidad = (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()),
       PuedoLeerOrq = HAS_PERMS_BY_NAME(N'orq', N'SCHEMA', N'SELECT');

/* 1. Objetos */
SELECT Objeto = o.n, Existe = CASE WHEN OBJECT_ID(o.n) IS NULL THEN 0 ELSE 1 END,
       Tipo = (SELECT type_desc FROM sys.objects WHERE object_id = OBJECT_ID(o.n))
FROM (VALUES (N'orq.vw_Job'), (N'orq.vw_JobResponsable'), (N'orq.ValorRelleno'), (N'orq.Decomiso'),
             (N'orq.CargaLote'), (N'orq.Advertencia'), (N'orq.Parametro'), (N'orq.AvanceDiario'),
             (N'orq.vw_TableroJob'), (N'orq.vw_TableroDecomiso'), (N'orq.vw_TableroDetalle')) AS o (n)
ORDER BY o.n;

/* 2. Columnas que se leen y no estan (vacio = todo en su lugar) */
SELECT Objeto = e.o, ColumnaQueFalta = e.c
FROM (VALUES
  (N'orq.vw_Job', N'JobId'), (N'orq.vw_Job', N'JobName'), (N'orq.vw_Job', N'FilaExcel'),
  (N'orq.vw_Job', N'VigenteEnOrigen'), (N'orq.vw_Job', N'DireccionDashboard'), (N'orq.vw_Job', N'N3Dashboard'),
  (N'orq.vw_Job', N'Herramienta'), (N'orq.vw_Job', N'EsCandidato'), (N'orq.vw_Job', N'Clasificacion'),
  (N'orq.vw_Job', N'EsquemaConsiderado'), (N'orq.vw_Job', N'PromedioDiario'), (N'orq.vw_Job', N'PromedioDiarioTexto'),
  (N'orq.vw_Job', N'CamposLlenosExcel'), (N'orq.vw_Job', N'CamposLlenosEstricta'), (N'orq.vw_Job', N'EsHuerfano'),
  (N'orq.vw_Job', N'EstatusControlM'), (N'orq.vw_Job', N'Migrado'), (N'orq.vw_Job', N'Optimizado'),
  (N'orq.vw_Job', N'ConAlertamiento'), (N'orq.vw_Job', N'SinRedundancia'), (N'orq.vw_Job', N'ConSlaActivo'),
  (N'orq.vw_Job', N'NombreSla'), (N'orq.vw_Job', N'ReduccionPosible'), (N'orq.vw_Job', N'SigueEjecutandose'),
  (N'orq.vw_Job', N'Horario'), (N'orq.vw_Job', N'Justificacion'), (N'orq.vw_Job', N'Criticidad'),
  (N'orq.vw_Job', N'AccionesFalla'), (N'orq.vw_Job', N'Escalacion1'), (N'orq.vw_Job', N'Escalacion2'),
  (N'orq.vw_Job', N'Escalacion3'), (N'orq.vw_Job', N'Aplicacion'), (N'orq.vw_Job', N'AplicacionId'),
  (N'orq.vw_Job', N'ProductOwnerN3'), (N'orq.vw_Job', N'ServiceOwnerN2'), (N'orq.vw_Job', N'DirectorPO'),
  (N'orq.vw_Job', N'ProcesoNegocio'),
  (N'orq.vw_JobResponsable', N'JobId'), (N'orq.vw_JobResponsable', N'PersonaId'),
  (N'orq.ValorRelleno', N'Valor'),
  (N'orq.Decomiso', N'DecomisoId'), (N'orq.Decomiso', N'JobName'), (N'orq.Decomiso', N'VigenteEnOrigen'),
  (N'orq.Decomiso', N'DirectorPO'), (N'orq.Decomiso', N'ProductOwnerN3'), (N'orq.Decomiso', N'Resultado'),
  (N'orq.Decomiso', N'EstatusDecomiso'), (N'orq.Decomiso', N'EstadoCAB'), (N'orq.Decomiso', N'FechaCompromiso'),
  (N'orq.Decomiso', N'FechaReal'), (N'orq.Decomiso', N'Categoria'),
  (N'orq.CargaLote', N'LoteId'), (N'orq.CargaLote', N'Numero'), (N'orq.CargaLote', N'Archivo'),
  (N'orq.CargaLote', N'FechaFin'), (N'orq.CargaLote', N'Estado'), (N'orq.CargaLote', N'JobsEnExcel'),
  (N'orq.CargaLote', N'JobsNuevos'), (N'orq.CargaLote', N'JobsCambiados'), (N'orq.CargaLote', N'JobsBaja'),
  (N'orq.CargaLote', N'Advertencias'),
  (N'orq.Advertencia', N'LoteId'), (N'orq.Advertencia', N'Hoja'), (N'orq.Advertencia', N'Tipo'),
  (N'orq.Advertencia', N'Clave'),
  (N'orq.Parametro', N'Clave'), (N'orq.Parametro', N'Valor'),
  (N'orq.AvanceDiario', N'Fecha'), (N'orq.AvanceDiario', N'Origen'), (N'orq.AvanceDiario', N'UniversoJobs'),
  (N'orq.AvanceDiario', N'Candidatos'), (N'orq.AvanceDiario', N'Migrados'), (N'orq.AvanceDiario', N'MigradosNuevos'),
  (N'orq.AvanceDiario', N'CandidatosDecomiso'), (N'orq.AvanceDiario', N'Huerfanos'),
  (N'orq.AvanceDiario', N'TotalDecomisos'), (N'orq.AvanceDiario', N'PctAvanceDecomisos'),
  (N'orq.AvanceDiario', N'PendientesAdopcion'), (N'orq.AvanceDiario', N'EjecucionesDiarias')
) AS e (o, c)
WHERE OBJECT_ID(e.o) IS NULL
   OR NOT EXISTS (SELECT 1 FROM sys.columns AS sc WHERE sc.object_id = OBJECT_ID(e.o) AND sc.name = e.c)
ORDER BY e.o, e.c;

/* 3. Tipos que importan */
SELECT Objeto = OBJECT_SCHEMA_NAME(c.object_id) + N'.' + OBJECT_NAME(c.object_id), Columna = c.name,
       Tipo = TYPE_NAME(c.user_type_id), c.max_length, c.precision, c.scale, Collation = c.collation_name
FROM sys.columns AS c
WHERE (c.object_id = OBJECT_ID(N'orq.Parametro') AND c.name IN (N'Clave', N'Valor'))
   OR (c.object_id = OBJECT_ID(N'orq.CargaLote') AND c.name IN (N'LoteId', N'FechaFin', N'Numero'))
   OR (c.object_id = OBJECT_ID(N'orq.vw_Job') AND c.name IN (N'PromedioDiario', N'EsHuerfano', N'JobName'));

IF OBJECT_ID(N'orq.Parametro') IS NOT NULL
    EXEC (N'SELECT Clave, Valor, EsNumero = CASE WHEN TRY_CONVERT(FLOAT, Valor) IS NULL THEN 0 ELSE 1 END
            FROM orq.Parametro ORDER BY Clave;');

/* 4. Cargas. FechaFin contra la hora del servidor (local y UTC): si la ultima
      carga se parece a la UTC, la pestana la mostraria seis horas corrida. */
IF OBJECT_ID(N'orq.CargaLote') IS NOT NULL
BEGIN
    EXEC (N'SELECT Estado, Cargas = COUNT(*), Ultima = MAX(Numero) FROM orq.CargaLote GROUP BY Estado;');
    EXEC (N'SELECT TOP (3) Numero, Estado, Archivo, FechaFin, AhoraServidor = SYSDATETIME(),
                 AhoraUtc = SYSUTCDATETIME(), JobsEnExcel, Advertencias
            FROM orq.CargaLote ORDER BY Numero DESC;');
END;

/* 5. Relleno repetido bajo CI_AI (el 77 ya lo tolera; para saberlo) */
IF OBJECT_ID(N'orq.ValorRelleno') IS NOT NULL
    EXEC (N'SELECT ValorCiAi = Valor COLLATE Latin1_General_CI_AI, Veces = COUNT(*)
            FROM orq.ValorRelleno GROUP BY Valor COLLATE Latin1_General_CI_AI HAVING COUNT(*) > 1;');

/* 6. JobName repetido entre vigentes: un decomiso con ese nombre saldria dos
      veces en orq.vw_TableroDecomiso. Vacio = no pasa. */
IF OBJECT_ID(N'orq.vw_Job') IS NOT NULL
    EXEC (N'SELECT JobName, Vigentes = COUNT(*) FROM orq.vw_Job WHERE VigenteEnOrigen = 1
            GROUP BY JobName HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC;');
IF OBJECT_ID(N'orq.vw_Job') IS NOT NULL AND OBJECT_ID(N'orq.Decomiso') IS NOT NULL
    EXEC (N'SELECT DecomisosVigentes = (SELECT COUNT(*) FROM orq.Decomiso WHERE VigenteEnOrigen = 1),
                 DecomisosConMasDeUnJob = (SELECT COUNT(*) FROM orq.Decomiso AS d WHERE d.VigenteEnOrigen = 1
                     AND (SELECT COUNT(*) FROM orq.vw_Job AS j WHERE j.JobName = d.JobName AND j.VigenteEnOrigen = 1) > 1);');

/* 7. Quien puede leer orq (permiso sobre el esquema o sobre cada objeto) */
SELECT Principal = pr.name, TipoPrincipal = pr.type_desc, p.permission_name, p.state_desc,
       Sobre = CASE p.class WHEN 3 THEN N'SCHEMA::' + SCHEMA_NAME(p.major_id)
                            ELSE OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id) END
FROM sys.database_permissions AS p
JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE (p.class = 3 AND p.major_id = SCHEMA_ID(N'orq'))
   OR (p.class = 1 AND OBJECT_SCHEMA_NAME(p.major_id) = N'orq')
ORDER BY pr.name;

/* 8. Con el 77: lo que deberia decir la cabecera sin filtros */
IF OBJECT_ID(N'orq.vw_TableroJob') IS NOT NULL AND OBJECT_ID(N'orq.vw_TableroDecomiso') IS NOT NULL
BEGIN
    EXEC (N'SELECT Jobs = COUNT(*), Huerfanos = SUM(CAST(EsHuerfano AS INT)), Activos = SUM(Activo),
                 Orquestados = SUM(OrqCompleto), Candidatos = SUM(CandSi),
                 MigradosExito = SUM(CASE WHEN CandSi = 1 AND Activo = 1 THEN 1 ELSE 0 END),
                 EjecPendientes = SUM(CASE WHEN PendMigrar = 1 THEN Prom ELSE 0 END),
                 CostoJob = SUM(CostoJob), CostoTarea = SUM(CostoTarea),
                 CamposMalArmados = SUM(CASE WHEN LEN(Campos) <> 14 THEN 1 ELSE 0 END)
            FROM orq.vw_TableroJob;');
    EXEC (N'SELECT Decomisos = COUNT(*), Exitosos = SUM(Exitoso), SinJob = SUM(CASE WHEN JobId IS NULL THEN 1 ELSE 0 END)
            FROM orq.vw_TableroDecomiso;');
END;
