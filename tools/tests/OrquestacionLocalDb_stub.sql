/* =====================================================================================
   OrquestacionLocalDb_stub.sql -- un esquema orq de MENTIRA para probar el 77 y
   OrquestacionQueries en LocalDB.

   NO es el 76 (76_orquestacion.sql no esta en este repositorio). Solo trae las
   tablas y columnas que el 77 y App_Code/OrquestacionQueries.cs leen, con los
   tipos que se suponen. Si el 76 real usa otros nombres o tipos, este stub no
   lo detecta: eso solo se ve corriendo el 77 en la base real.

   Cinco jobs vigentes y uno de baja, dos decomisos, tres cargas. Nombres
   inventados. Las cifras esperadas estan en OrquestacionLocalDbSmoke.js.

   Lo corre tools/tests/OrquestacionLocalDb.sh sobre una base desechable.
   ===================================================================================== */
SET NOCOUNT ON;
GO
IF SCHEMA_ID(N'orq') IS NULL EXEC (N'CREATE SCHEMA orq');
GO

CREATE TABLE orq.ValorRelleno (Valor NVARCHAR(200) NOT NULL PRIMARY KEY);

CREATE TABLE orq.JobStub (
    JobId INT NOT NULL PRIMARY KEY, JobName NVARCHAR(200) NOT NULL, FilaExcel INT NULL,
    VigenteEnOrigen BIT NOT NULL,
    DireccionDashboard NVARCHAR(200) NULL, N3Dashboard NVARCHAR(200) NULL,
    Herramienta NVARCHAR(100) NULL, EsCandidato NVARCHAR(100) NULL,
    Clasificacion NVARCHAR(100) NULL, EsquemaConsiderado NVARCHAR(20) NULL,
    PromedioDiario DECIMAL(18, 4) NULL, PromedioDiarioTexto NVARCHAR(100) NULL,
    CamposLlenosExcel INT NOT NULL, CamposLlenosEstricta INT NOT NULL, EsHuerfano BIT NOT NULL,
    EstatusControlM NVARCHAR(50) NULL, Migrado NVARCHAR(50) NULL, Optimizado NVARCHAR(50) NULL,
    ConAlertamiento NVARCHAR(50) NULL, SinRedundancia NVARCHAR(50) NULL,
    ConSlaActivo NVARCHAR(50) NULL, NombreSla NVARCHAR(200) NULL,
    ReduccionPosible NVARCHAR(200) NULL, SigueEjecutandose NVARCHAR(200) NULL, Horario NVARCHAR(200) NULL,
    Justificacion NVARCHAR(MAX) NULL, Criticidad NVARCHAR(100) NULL, AccionesFalla NVARCHAR(MAX) NULL,
    Escalacion1 NVARCHAR(200) NULL, Escalacion2 NVARCHAR(200) NULL, Escalacion3 NVARCHAR(200) NULL,
    Aplicacion NVARCHAR(200) NULL, AplicacionId INT NULL,
    ProductOwnerN3 NVARCHAR(200) NULL, ServiceOwnerN2 NVARCHAR(200) NULL, DirectorPO NVARCHAR(200) NULL,
    ProcesoNegocio NVARCHAR(200) NULL);
GO
CREATE VIEW orq.vw_Job AS SELECT * FROM orq.JobStub;
GO
CREATE TABLE orq.ResponsableStub (JobId INT NOT NULL, PersonaId INT NULL);
GO
CREATE VIEW orq.vw_JobResponsable AS SELECT JobId, PersonaId FROM orq.ResponsableStub;
GO
CREATE TABLE orq.Decomiso (
    DecomisoId INT NOT NULL PRIMARY KEY, JobName NVARCHAR(200) NOT NULL, VigenteEnOrigen BIT NOT NULL,
    DirectorPO NVARCHAR(200) NULL, ProductOwnerN3 NVARCHAR(200) NULL, Resultado NVARCHAR(50) NULL,
    EstatusDecomiso NVARCHAR(50) NULL, EstadoCAB NVARCHAR(50) NULL,
    FechaCompromiso DATE NULL, FechaReal DATE NULL, Categoria NVARCHAR(100) NULL);
CREATE TABLE orq.CargaLote (
    LoteId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, Numero INT NOT NULL, Archivo NVARCHAR(260) NULL,
    FechaFin DATETIME2(0) NULL, Estado NVARCHAR(20) NOT NULL, JobsEnExcel INT NULL, JobsNuevos INT NULL,
    JobsCambiados INT NULL, JobsBaja INT NULL, Advertencias INT NULL);
CREATE TABLE orq.Advertencia (LoteId UNIQUEIDENTIFIER NOT NULL, Hoja NVARCHAR(100) NOT NULL,
    Tipo NVARCHAR(100) NOT NULL, Clave NVARCHAR(200) NULL);
-- Valor como TEXTO a proposito: OrquestacionQueries tiene que entregarlo como numero.
CREATE TABLE orq.Parametro (Clave NVARCHAR(100) NOT NULL PRIMARY KEY, Valor NVARCHAR(100) NULL);
CREATE TABLE orq.AvanceDiario (
    Fecha DATE NOT NULL, Origen NVARCHAR(20) NOT NULL, UniversoJobs INT NULL, Candidatos INT NULL,
    Migrados INT NULL, MigradosNuevos INT NULL, CandidatosDecomiso INT NULL, Huerfanos INT NULL,
    TotalDecomisos INT NULL, PctAvanceDecomisos DECIMAL(9, 4) NULL, PendientesAdopcion INT NULL,
    EjecucionesDiarias DECIMAL(18, 4) NULL);
GO

-- "Huerfanos" y "Huérfanos": distintos para la PK, el mismo para el 77 (CI_AI).
INSERT orq.ValorRelleno VALUES (N'N/A'), (N'Ejecucion unica'), (N'Huerfanos'), (N'Huérfanos');

-- 1 completo y orquestado; 2 candidato pendiente (N/A en Control-M); 3 para
-- decomiso; 4 candidato a reduccion; 5 huerfano en adopcion; 6 de baja.
INSERT orq.JobStub (JobId, JobName, FilaExcel, VigenteEnOrigen, DireccionDashboard, N3Dashboard, Herramienta,
    EsCandidato, Clasificacion, EsquemaConsiderado, PromedioDiario, CamposLlenosExcel, CamposLlenosEstricta,
    EsHuerfano, EstatusControlM, Migrado, Optimizado, ConAlertamiento, SinRedundancia, ConSlaActivo, NombreSla,
    ReduccionPosible, SigueEjecutandose, Horario, Justificacion, Criticidad, AccionesFalla,
    Escalacion1, Escalacion2, Escalacion3, Aplicacion, AplicacionId, ProductOwnerN3, ServiceOwnerN2,
    DirectorPO, ProcesoNegocio)
VALUES
 (1, N'JOB_A', 2, 1, N'Dir Uno', N'PO Uno', N'Control-M', N'Si', N'Alta frecuencia', N'JOB', 10, 14, 13, 0,
  N'Activos', N'Migrado', N'Optimizado', N'Si', N'Sin redundancia', N'Si', N'SLA_A',
  N'Reduccion exitosa', N'Si', N'N/A', N'Cierre diario', N'Alta', N'Reintentar', N'e1', N'e2', N'e3',
  N'App Uno', 7, N'PO Uno', N'SO Uno', N'Dir Uno', N'Cierre'),
 (2, N'JOB_B', 3, 1, N'Dir Uno', N'PO Dos', N'Tareas Windows', N'Si', N'Media', N'Tarea', 5, 6, 6, 0,
  N'N/A', NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, N'Si', NULL, N'Carga', NULL, NULL, N'e1', NULL, NULL,
  N'App Dos', NULL, N'PO Dos', NULL, N'Dir Uno', NULL),
 (3, N'JOB_C', 4, 1, N'Dir Dos', N'PO Tres', N'Control-M', N'Para decomiso', N'Baja', N'JOB', 2, 3, 3, 0,
  N'Activos', NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  N'App Tres', NULL, N'PO Tres', N'Huerfanos', N'Dir Dos', NULL),
 (4, N'JOB_D', 5, 1, N'Dir Dos', N'PO Tres', N'Control-M', N'Migrados / candidato a reduccion', N'Unica vez', N'Tarea',
  3, 5, 5, 0, N'Activos', N'Migrado', N'Candidato', N'Por Migrar', N'Con redundancia', N'N/A', N'N/A',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  N'App Fuera', NULL, N'PO Tres', NULL, N'Dir Dos', NULL),
 (5, N'JOB_E', 6, 1, N'Huérfanos', N'Sin N3', N'Cron', NULL, NULL, NULL, NULL, 1, 0, 1,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, N'Adoptar'),
 (6, N'JOB_BAJA', 7, 0, N'Dir Uno', N'PO Uno', N'Control-M', N'Si', N'Alta', N'JOB', 99, 14, 14, 0,
  N'Activos', N'Migrado', N'Optimizado', N'Si', N'Sin redundancia', N'Si', N'SLA_X',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT orq.ResponsableStub VALUES (1, 10), (1, NULL), (2, 11);

INSERT orq.Decomiso (DecomisoId, JobName, VigenteEnOrigen, DirectorPO, ProductOwnerN3, Resultado)
VALUES (1, N'JOB_C', 1, NULL, NULL, N'Exitoso'),
       (2, N'JOB_YA_NO_ESTA', 1, N'#N/A', NULL, N'Pendiente'),
       (3, N'JOB_C', 0, NULL, NULL, N'Exitoso');

DECLARE @l1 UNIQUEIDENTIFIER = NEWID(), @l2 UNIQUEIDENTIFIER = NEWID(), @l3 UNIQUEIDENTIFIER = NEWID();
INSERT orq.CargaLote (LoteId, Numero, Archivo, FechaFin, Estado, JobsEnExcel, JobsNuevos, JobsCambiados, JobsBaja, Advertencias)
VALUES (@l1, 1, N'viejo.xlsx', '2026-10-01T09:00:00', N'Aplicado', 6, 6, 0, 0, 1),
       (@l2, 2, N'nuevo.xlsx', '2026-10-17T10:30:00', N'Aplicado', 6, 0, 2, 1, 2),
       (@l3, 3, N'roto.xlsx',  '2026-10-18T08:00:00', N'Fallido',  0, 0, 0, 0, 0);
INSERT orq.Advertencia VALUES
    (@l1, N'bd Jobs', N'Viejo', N'JOB_A'),
    (@l2, N'bd Jobs', N'Nombre repetido', N'JOB_B'),
    (@l2, N'bd Jobs', N'Promedio no numerico', N'JOB_B'),
    (@l3, N'bd Jobs', N'De la carga fallida', N'JOB_A');

INSERT orq.Parametro VALUES (N'CostoTareaAnual', N'100'), (N'CostoJobAnual', N'1000.5'),
    (N'CostoLicenciaActual', N'5000'), (N'EjecucionesConsumidasDia', N'17');

INSERT orq.AvanceDiario (Fecha, Origen, UniversoJobs, Candidatos, Migrados) VALUES
    ('2026-10-01', N'Excel', 6, 2, 1), ('2026-10-17', N'Base', 5, 2, 1);
GO
