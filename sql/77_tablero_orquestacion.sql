/* =====================================================================================
   77_tablero_orquestacion.sql -- lo que lee la pestaña "Orquestación" del tablero

   Base destino: Tickets_Proactivanet (o la base nueva del R-04, junto con el 76)
   Requiere:     76_orquestacion.sql (el esquema orq y sus tablas)
   Lo lee:       sitio/App_Code/OrquestacionQueries.cs (handlers/orquestacion.ashx)

   Solo vistas: no escribe nada ni toca nada fuera de orq. La cuenta del tablero solo
   necesita SELECT sobre el esquema orq (al final).

   LAS REGLAS VIVEN AQUI
   ---------------------
   orq.vw_TableroJob trae un renglon por job vigente con cada indicador del
   "Dashboard Avance Registro" del Excel ya resuelto (1 = cuenta, 0 = no). La
   pestaña solo filtra por Direccion, N3 y candidato, y suma. Las formulas del
   Excel, con las correcciones decididas el 2026-10-17:

     Activos en Control-M      Estatus control-M = Activos
     Completamente orquestados activo, Migrado, Optimizado, con alertamiento,
                               sin redundancia y con nombre de SLA en la
                               columna AZ (el Excel compara la AY, que trae
                               Si/No/--, contra los nombres: daba 0)
     Candidatos a migrar       ¿Es candidato? = Si; migrados con exito: ademas
                               activos
     Ejecuciones pendientes    promedio diario de los candidatos (Si) que estan
                               N/A en Control-M
     Costos, esquema hibrido   JOB y Tarea entre los Migrados, los Si y los
                               "Migrados / candidato a reduccion" (el Excel
                               cuenta estos ultimos como Tarea en las dos
                               sumas: en la de JOB se toman como JOB)
     Madurez                   cada medidor con su propio universo, como las
                               formulas B15:F19
     Direccion -> N3           candidatos a reduccion parcial ("Migrados /
                               candidato a reduccion"), reducciones exitosas
                               ("Reduccion exitosa" en W), candidatos a
                               depuracion (activos "Para decomiso"),
                               depurados exitosos ("Decomisado": la formula
                               del Excel mira columnas corridas y siempre da
                               0), nuevos a orquestacion (Si) y orquestados
                               (Si y activos), huerfanos en adopcion ("Adoptar")

   Los decomisos (orq.vw_TableroDecomiso) cuentan sin el encabezado de la hoja.
   Huerfano y las dos completitudes son las de orq.vw_Job.

   Usa STRING_AGG: SQL Server 2017 o mas (la instancia es 2022).

   2026-10-19 (claude-branch): Campos con OUTER APPLY TOP (1) a orq.ValorRelleno en vez de
   LEFT JOIN; un relleno repetido bajo CI_AI ya no duplica el campo. Lo prueba
   tools/tests/OrquestacionLocalDb.sh.
   Se puede volver a correr. Lleva acentos: abrirlo como archivo (trae BOM).
   ===================================================================================== */

USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
GO

-- Sin el 76 no sigue: SET NOEXEC deja de ejecutar el resto del archivo.
IF OBJECT_ID(N'orq.vw_Job', N'V') IS NULL
BEGIN
    RAISERROR(N'Falta el 76 (76_orquestacion.sql): no existe orq.vw_Job. No se creo nada.', 16, 1);
    SET NOEXEC ON;
END;
GO

/* ===================================================================================== un job */
CREATE OR ALTER VIEW orq.vw_TableroJob
AS
SELECT
    j.JobId,
    Dir         = j.DireccionDashboard,
    N3          = j.N3Dashboard,
    Herramienta = ISNULL(j.Herramienta, N'(sin herramienta)'),
    Candidato   = ISNULL(j.EsCandidato, N'(vacío)'),
    Clasif      = CASE WHEN j.Clasificacion LIKE N'Alta%'  THEN N'Alta'
                       WHEN j.Clasificacion LIKE N'Media%' THEN N'Media'
                       WHEN j.Clasificacion LIKE N'Baja%'  THEN N'Baja'
                       WHEN j.Clasificacion COLLATE Latin1_General_CI_AI LIKE N'Unica%' THEN N'Única' END,
    j.EsquemaConsiderado,
    Prom        = ISNULL(j.PromedioDiario, 0),
    j.CamposLlenosExcel,
    j.CamposLlenosEstricta,
    -- Los 14 campos de W a AJ, en ese orden: 0 vacio, 1 relleno, 2 documentado.
    Campos      = c.Campos,
    j.EsHuerfano,
    Activo      = f.Activo,
    CandSi      = f.CandSi,
    OrqCompleto = CASE WHEN f.Activo = 1
                        AND j.Migrado COLLATE Latin1_General_CI_AI = N'Migrado'
                        AND j.Optimizado COLLATE Latin1_General_CI_AI = N'Optimizado'
                        AND j.ConAlertamiento COLLATE Latin1_General_CI_AI = N'Si'
                        AND j.SinRedundancia COLLATE Latin1_General_CI_AI = N'Sin redundancia'
                        AND s.ConNombreSla = 1 THEN 1 ELSE 0 END,
    PendMigrar  = CASE WHEN f.CandSi = 1 AND j.EstatusControlM COLLATE Latin1_General_CI_AI = N'N/A' THEN 1 ELSE 0 END,
    CostoJob    = CASE WHEN f.CandCosto = 1 AND j.EsquemaConsiderado = N'JOB' THEN 1 ELSE 0 END,
    CostoTarea  = CASE WHEN f.CandCosto = 1 AND j.EsquemaConsiderado = N'Tarea' THEN 1 ELSE 0 END,
    -- Madurez (formulas B15:F19 del Excel): el universo de cada medidor y lo logrado.
    MadMigrado  = CASE WHEN j.Migrado COLLATE Latin1_General_CI_AI = N'Migrado' THEN 1 ELSE 0 END,
    MadOptBase  = CASE WHEN j.Optimizado COLLATE Latin1_General_CI_AI IN (N'Candidato', N'Por validar', N'Optimizado') THEN 1 ELSE 0 END,
    MadOpt      = CASE WHEN j.Optimizado COLLATE Latin1_General_CI_AI = N'Optimizado' THEN 1 ELSE 0 END,
    MadAlertBase = CASE WHEN j.ConAlertamiento COLLATE Latin1_General_CI_AI IN (N'Por Migrar', N'Si') THEN 1 ELSE 0 END,
    MadAlert    = CASE WHEN j.ConAlertamiento COLLATE Latin1_General_CI_AI = N'Si' THEN 1 ELSE 0 END,
    MadRedBase  = CASE WHEN j.SinRedundancia COLLATE Latin1_General_CI_AI IN (N'Sin redundancia', N'Con redundancia', N'Por Migrar') THEN 1 ELSE 0 END,
    MadRed      = CASE WHEN j.SinRedundancia COLLATE Latin1_General_CI_AI = N'Sin redundancia' THEN 1 ELSE 0 END,
    MadSlaBase  = CASE WHEN j.ConSlaActivo COLLATE Latin1_General_CI_AI IN (N'Si', N'No', N'--')
                         OR (j.ConSlaActivo COLLATE Latin1_General_CI_AI = N'N/A'
                             AND j.Migrado COLLATE Latin1_General_CI_AI = N'Migrado') THEN 1 ELSE 0 END,
    MadSla      = CASE WHEN j.ConSlaActivo COLLATE Latin1_General_CI_AI = N'Si'
                         OR (j.ConSlaActivo COLLATE Latin1_General_CI_AI = N'N/A'
                             AND j.Migrado COLLATE Latin1_General_CI_AI = N'Migrado') THEN 1 ELSE 0 END,
    -- Direccion -> N3 (columnas H a P del Excel).
    RedCand     = CASE WHEN j.EsCandidato COLLATE Latin1_General_CI_AI = N'Migrados / candidato a reduccion' THEN 1 ELSE 0 END,
    RedExito    = CASE WHEN j.ReduccionPosible COLLATE Latin1_General_CI_AI = N'Reduccion exitosa' THEN 1 ELSE 0 END,
    DepCand     = CASE WHEN f.Activo = 1 AND j.EsCandidato COLLATE Latin1_General_CI_AI = N'Para decomiso' THEN 1 ELSE 0 END,
    DepExito    = CASE WHEN j.EsCandidato COLLATE Latin1_General_CI_AI = N'Decomisado' THEN 1 ELSE 0 END,
    Adopcion    = CASE WHEN j.ProcesoNegocio COLLATE Latin1_General_CI_AI = N'Adoptar' THEN 1 ELSE 0 END
FROM orq.vw_Job AS j
CROSS APPLY (SELECT
    Activo    = CASE WHEN j.EstatusControlM COLLATE Latin1_General_CI_AI = N'Activos' THEN 1 ELSE 0 END,
    CandSi    = CASE WHEN j.EsCandidato COLLATE Latin1_General_CI_AI = N'Si' THEN 1 ELSE 0 END,
    CandCosto = CASE WHEN j.EsCandidato COLLATE Latin1_General_CI_AI
                          IN (N'Migrados', N'Si', N'Migrados / candidato a reduccion') THEN 1 ELSE 0 END) AS f
CROSS APPLY (SELECT ConNombreSla = CASE WHEN j.NombreSla IS NOT NULL
                                          AND NOT EXISTS (SELECT 1 FROM orq.ValorRelleno AS r
                                                          WHERE r.Valor = j.NombreSla COLLATE Latin1_General_CI_AI)
                                        THEN 1 ELSE 0 END) AS s
CROSS APPLY (
    -- OUTER APPLY TOP (1) y no LEFT JOIN: si orq.ValorRelleno trae dos valores
    -- que bajo Latin1_General_CI_AI son el mismo ("Huerfanos" y "Huérfanos"),
    -- el JOIN duplicaba el campo y la cadena pasaba de 14 caracteres. (Un
    -- EXISTS dentro del STRING_AGG no se puede: es una subconsulta.)
    SELECT Campos = STRING_AGG(CASE WHEN v.x IS NULL THEN '0' WHEN r.Hay = 1 THEN '1' ELSE '2' END, '')
                    WITHIN GROUP (ORDER BY v.n)
    FROM (VALUES (1, j.ReduccionPosible), (2, j.SigueEjecutandose), (3, j.Horario),
                 (4, CONVERT(NVARCHAR(4000), j.Justificacion)), (5, j.Criticidad),
                 (6, CONVERT(NVARCHAR(4000), j.AccionesFalla)), (7, j.Escalacion1), (8, j.Escalacion2),
                 (9, j.Escalacion3), (10, j.Aplicacion), (11, j.ProductOwnerN3), (12, j.ServiceOwnerN2),
                 (13, j.DirectorPO), (14, j.ProcesoNegocio)) AS v (n, x)
    OUTER APPLY (SELECT TOP (1) Hay = 1 FROM orq.ValorRelleno AS r0
                 WHERE r0.Valor = v.x COLLATE Latin1_General_CI_AI) AS r
) AS c
WHERE j.VigenteEnOrigen = 1;
GO

/* ===================================================================================== un decomiso */
-- Con la Direccion, el N3 y el candidato de su job (para que los filtros de
-- la pestaña valgan igual); si el job ya no esta, los de la hoja Decomisos.
CREATE OR ALTER VIEW orq.vw_TableroDecomiso
AS
SELECT
    d.DecomisoId,
    d.JobName,
    JobId     = j.JobId,
    Dir       = COALESCE(j.DireccionDashboard,
                         CASE WHEN d.DirectorPO IS NULL OR d.DirectorPO COLLATE Latin1_General_CI_AI IN (N'N/A', N'#N/A')
                              THEN N'Huérfanos' ELSE d.DirectorPO END),
    N3        = COALESCE(j.N3Dashboard,
                         CASE WHEN d.ProductOwnerN3 IS NULL OR d.ProductOwnerN3 COLLATE Latin1_General_CI_AI IN (N'N/A', N'#N/A')
                              THEN N'Sin N3' ELSE d.ProductOwnerN3 END),
    Candidato = ISNULL(j.EsCandidato, N'(vacío)'),
    Exitoso   = CASE WHEN d.Resultado COLLATE Latin1_General_CI_AI = N'Exitoso' THEN 1 ELSE 0 END,
    d.Resultado, d.EstatusDecomiso, d.EstadoCAB, d.FechaCompromiso, d.FechaReal, d.Categoria
FROM orq.Decomiso AS d
LEFT JOIN orq.vw_Job AS j ON j.JobName = d.JobName AND j.VigenteEnOrigen = 1
WHERE d.VigenteEnOrigen = 1;
GO

/* ===================================================================================== el detalle */
-- Para la lista de jobs y su Excel. Las advertencias son las de la ultima
-- carga aplicada que se refieren a ese renglon (repetido, nombre distinto en
-- A y F, promedio que no es numero, clasificacion); la aplicacion fuera del
-- catalogo y los responsables fuera de Datos salen del job mismo.
CREATE OR ALTER VIEW orq.vw_TableroDetalle
AS
SELECT
    j.JobId, j.JobName, j.FilaExcel, j.Herramienta, j.EstatusControlM, j.EsCandidato,
    j.PromedioDiario, j.PromedioDiarioTexto, j.Clasificacion, j.EsquemaConsiderado,
    j.Aplicacion,
    AplicacionEnCatalogo = CASE WHEN j.AplicacionId IS NOT NULL THEN 1
                                WHEN j.Aplicacion IS NULL OR EXISTS (SELECT 1 FROM orq.ValorRelleno AS r
                                                                     WHERE r.Valor = j.Aplicacion COLLATE Latin1_General_CI_AI)
                                THEN NULL ELSE 0 END,
    Dir = j.DireccionDashboard, N3 = j.N3Dashboard, j.ServiceOwnerN2,
    j.Escalacion1, j.Escalacion2, j.Escalacion3, j.Criticidad, j.ProcesoNegocio,
    j.CamposLlenosExcel, j.CamposLlenosEstricta, j.EsHuerfano,
    j.Migrado, j.Optimizado, j.ConAlertamiento, j.SinRedundancia, j.ConSlaActivo, j.NombreSla,
    PersonasFueraDeDatos = (SELECT COUNT(*) FROM orq.vw_JobResponsable AS p
                            WHERE p.JobId = j.JobId AND p.PersonaId IS NULL),
    Advertencias = (SELECT STRING_AGG(a.Tipo, N'; ') WITHIN GROUP (ORDER BY a.Tipo)
                    FROM orq.Advertencia AS a
                    WHERE a.Hoja = N'bd Jobs' AND a.Clave = j.JobName
                      AND a.LoteId = (SELECT TOP (1) l.LoteId FROM orq.CargaLote AS l
                                      WHERE l.Estado = N'Aplicado' ORDER BY l.Numero DESC))
FROM orq.vw_Job AS j
WHERE j.VigenteEnOrigen = 1;
GO

/* ===================================================================================== permisos (ejemplo)
     GRANT SELECT ON SCHEMA::orq TO [usuario_del_tablero];
   ===================================================================================== */

SELECT Objeto = CONCAT(SCHEMA_NAME(o.schema_id), N'.', o.name), Tipo = o.type_desc
FROM sys.objects AS o
WHERE o.schema_id = SCHEMA_ID(N'orq') AND o.name LIKE N'vw[_]Tablero%'
ORDER BY o.name;
GO
SET NOEXEC OFF;
GO
