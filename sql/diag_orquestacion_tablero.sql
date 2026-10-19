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
     9. Quien ya lee orq por un rol de base (db_datareader/db_owner): esa cuenta
        no necesita GRANT.
    10. Que cuentas estan conectadas a esta base y desde que programa (para
        identificar la del sitio; sin VIEW SERVER STATE solo sale la propia).
    11. Las llaves UNIQUE de JobName y si las definiciones instaladas son las
        del 76 entregado el 2026-10-19 (huella esperada en el comentario).
   ===================================================================================== */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

/* 0. Donde estoy */
SELECT Base = DB_NAME(), Usuario = SUSER_SNAME(), UsuarioBase = USER_NAME(),
       Version = CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(30)),
       Compatibilidad = (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()),
       PuedoLeerOrq = HAS_PERMS_BY_NAME(N'orq', N'SCHEMA', N'SELECT'),
       -- Sin estos dos, las secciones 1, 2, 7, 9, 10 y 11 salen RECORTADAS sin
       -- dar error (SQL Server oculta lo que no se puede ver): con un 0 aqui,
       -- un vacio o un NULL abajo no prueba nada. Correrlo con una cuenta que
       -- tenga los dos (o pedirlo al DBA).
       VerDefiniciones = HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'VIEW DEFINITION'),
       VerSesiones = HAS_PERMS_BY_NAME(NULL, NULL, N'VIEW SERVER STATE');

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
      veces en orq.vw_TableroDecomiso. Con UQ_orq_Job y UQ_orq_Decomiso del 76
      (seccion 11) no puede pasar; si sale algo, la base no tiene esas llaves. */
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

/* 9. Miembros de los roles que ya leen todo (no hace falta GRANT para ellos).
      Sin VIEW DEFINITION la lista puede salir recortada sin error. */
SELECT Rol = r.name, Miembro = m.name, TipoMiembro = m.type_desc,
       ListaCompleta = CASE WHEN HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'VIEW DEFINITION') = 1
                            THEN N'si' ELSE N'NO: puede faltar gente' END
FROM sys.database_role_members AS rm
JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals AS m ON m.principal_id = rm.member_principal_id
WHERE r.name IN (N'db_datareader', N'db_owner')
ORDER BY r.name, m.name;

/* 10. Quien esta conectado a esta base (la cuenta del sitio suele salir como
       ".Net SqlClient Data Provider" desde el servidor de IIS). Sin VIEW SERVER
       STATE SQL Server NO da error: devuelve solo la sesion propia. Por eso
       cada renglon dice si la lista es completa. */
BEGIN TRY
    EXEC (N'SELECT DISTINCT login_name, program_name, host_name,
                   ListaCompleta = CASE WHEN HAS_PERMS_BY_NAME(NULL, NULL, N''VIEW SERVER STATE'') = 1
                                        THEN N''si'' ELSE N''NO: solo la sesion propia'' END
            FROM sys.dm_exec_sessions WHERE database_id = DB_ID() AND is_user_process = 1
            ORDER BY login_name;');
END TRY
BEGIN CATCH
    SELECT Seccion10 = N'No se pudieron leer las sesiones: ' + ERROR_MESSAGE();
END CATCH;

/* 11. Llaves UNIQUE de JobName (con ellas un decomiso cruza con un solo job)
       y huella de las definiciones: SHA-256 del texto sin retornos de carro,
       primeros 8 bytes. Esperado con el 76 entregado el 2026-10-19 y el 77 de
       claude-branch:
         vw_Job E5BE644D843846CF, vw_JobResponsable A0FB285598B1FE2E,
         usp_CargarOrquestacion 83B73A919221FC39, usp_FotoAvance E22489212BB4D319,
         vw_TableroJob 9414A33277E555FC (CF399A69093FAAC1 = el 77 del paquete),
         vw_TableroDecomiso 8A32FCCA5E677F8D, vw_TableroDetalle 822994950143C0DA.
       Otra huella = otra version instalada: avisar antes de correr nada. */
SELECT Tabla = OBJECT_SCHEMA_NAME(i.object_id) + N'.' + OBJECT_NAME(i.object_id), Indice = i.name,
       i.is_unique, Columna = COL_NAME(ic.object_id, ic.column_id),
       Collation = (SELECT c.collation_name FROM sys.columns AS c
                    WHERE c.object_id = ic.object_id AND c.column_id = ic.column_id)
FROM sys.indexes AS i
JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
WHERE i.object_id IN (OBJECT_ID(N'orq.Job'), OBJECT_ID(N'orq.Decomiso'), OBJECT_ID(N'orq.ValorRelleno'))
  AND i.is_unique = 1;

SELECT Objeto = o.name, Tipo = o.type_desc, o.create_date, o.modify_date,
       -- Sin VIEW DEFINITION la definicion llega NULL y los procedimientos ni
       -- aparecen: eso NO es otra version, es falta de permiso.
       Huella = ISNULL(CONVERT(VARCHAR(16), HASHBYTES('SHA2_256', REPLACE(OBJECT_DEFINITION(o.object_id), NCHAR(13), N'')), 2),
                       'SIN PERMISO')
FROM sys.objects AS o
WHERE o.schema_id = SCHEMA_ID(N'orq') AND o.type IN ('V', 'P')
ORDER BY o.name;
