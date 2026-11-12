/* =========================================================================
   sql/diag_fecha_analisis_unica.sql - SOLO LECTURA (solo SELECT).
   Regla: una iniciativa tiene UNA fecha compromiso de analisis
   (dbo.Problem.FechaAnalisis), comun a todas sus categorias.

   Mide, en la base real (QA: Tickets_Proactivanet en AZVMBDCENTRALQA), lo
   que queda de las fechas por categoria de sql/18
   (dbo.ProblemCategoria.FechaAnalisisCategoria) y si las vistas del backend
   aun las usan como efectivas, antes de decidir el cambio de vistas
   (backend_admin_persistencia: rollback de ADM_01 / ADM_02).

   No escribe, no crea objetos, no abre transacciones. Correr completo en
   SSMS (Resultados a texto o cuadricula).

   @Folio: la iniciativa del reporte. Cambiarla para revisar otra.
   ========================================================================= */
SET NOCOUNT ON;
DECLARE @Folio nvarchar(100) = N'PRB 2026-000191';
DECLARE @Hoy date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));

/* 1. Version de las vistas desplegadas. ADM_01 / ADM_02 se reconocen por
      FechaAnalisisCategoria en su texto; 38 / 26 (los rollbacks) no la tienen. */
SELECT Seccion = '1 vistas',
       Objeto = o.name,
       Modificada = o.modify_date,
       UsaFechaCategoria = CASE WHEN m.definition LIKE N'%FechaAnalisisCategoria%' THEN 1 ELSE 0 END,
       MarcaADM01 = CASE WHEN m.definition LIKE N'%FechaAnalisisIniciativa = p.FechaAnalisis%' THEN 1 ELSE 0 END,
       MarcaADM02 = CASE WHEN m.definition LIKE N'%Heredan = SUM(%' THEN 1 ELSE 0 END,
       Huella = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(m.definition,
                N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
FROM sys.objects AS o
JOIN sys.sql_modules AS m ON m.object_id = o.object_id
WHERE o.object_id IN (OBJECT_ID('dbo.vw_ProblemCategoria'), OBJECT_ID('dbo.vw_ProblemVencido'));

/* 2. Quien mas lee las 3 columnas que ADM_01 agrego al final de
      dbo.vw_ProblemCategoria (el rollback de ADM_01 las quita) o
      FechaAnalisisCategoria. Busqueda de texto: sys.dm_sql_referenced_entities
      no ve todas las lecturas (ver ADM_04_diag_proteccion.sql). */
SELECT Seccion = '2 lectores',
       Objeto = SCHEMA_NAME(o.schema_id) + N'.' + o.name, Tipo = o.type_desc,
       FechaAnalisisIniciativa = CASE WHEN m.definition LIKE N'%FechaAnalisisIniciativa%' THEN 1 ELSE 0 END,
       FechaCreacionCategoria  = CASE WHEN m.definition LIKE N'%FechaCreacionCategoria%' THEN 1 ELSE 0 END,
       FechaAnalisisCategoria  = CASE WHEN m.definition LIKE N'%FechaAnalisisCategoria%' THEN 1 ELSE 0 END
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE (m.definition LIKE N'%FechaAnalisisIniciativa%'
    OR m.definition LIKE N'%FechaCreacionCategoria%'
    OR m.definition LIKE N'%FechaAnalisisCategoria%')
ORDER BY Objeto;

/* 3. Cuantas filas tienen fecha propia y cuantas difieren de la iniciativa. */
SELECT Seccion = '3 conteo',
       FilasConFechaPropia = COUNT(*),
       Vigentes = SUM(CASE WHEN pc.VigenteEnOrigen = 1 THEN 1 ELSE 0 END),
       VigentesDistintas = SUM(CASE WHEN pc.VigenteEnOrigen = 1
                                     AND (p.FechaAnalisis IS NULL
                                          OR pc.FechaAnalisisCategoria <> CONVERT(date, p.FechaAnalisis)) THEN 1 ELSE 0 END),
       IniciativasAfectadas = COUNT(DISTINCT CASE WHEN pc.VigenteEnOrigen = 1
                                     AND (p.FechaAnalisis IS NULL
                                          OR pc.FechaAnalisisCategoria <> CONVERT(date, p.FechaAnalisis)) THEN pc.Codigo END)
FROM dbo.ProblemCategoria AS pc
JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
WHERE pc.FechaAnalisisCategoria IS NOT NULL;

/* 4. Las iniciativas vivas donde la fecha por categoria cambia lo que se ve:
      semaforo de la vista vs. el de la iniciativa, y contador. */
SELECT Seccion = '4 afectadas',
       pc.Codigo, p.Estado, pc.Categoria,
       FechaIniciativa = CONVERT(date, p.FechaAnalisis),
       FechaCategoria = pc.FechaAnalisisCategoria,
       VencidaPorCategoria = CASE WHEN pc.FechaAnalisisCategoria < @Hoy THEN 1 ELSE 0 END,
       VencidaPorIniciativa = CASE WHEN CONVERT(date, p.FechaAnalisis) < @Hoy THEN 1 ELSE 0 END,
       p.NroCambioFechaAnalisis
FROM dbo.ProblemCategoria AS pc
JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
WHERE pc.VigenteEnOrigen = 1 AND p.VigenteEnOrigen = 1
  AND pc.FechaAnalisisCategoria IS NOT NULL
  AND (p.FechaAnalisis IS NULL OR pc.FechaAnalisisCategoria <> CONVERT(date, p.FechaAnalisis))
ORDER BY pc.Codigo, pc.Categoria;

/* 5. El folio del reporte: iniciativa, categorias, lo que dan las vistas
      y su historial de fechas de analisis (iniciativa y categorias). */
SELECT Seccion = '5a problem', Codigo, Estado, FechaCreacion, FechaAnalisis, NroCambioFechaAnalisis, VigenteEnOrigen
FROM dbo.Problem WHERE Codigo = @Folio;

SELECT Seccion = '5b categorias', Categoria, VigenteEnOrigen, FechaCreacionCategoria, FechaAnalisisCategoria
FROM dbo.ProblemCategoria WHERE Codigo = @Folio ORDER BY Categoria;

SELECT DISTINCT Seccion = '5c vw_ProblemCategoria', Categoria, FechaAnalisis, NroCambioFechaAnalisis, VigenteEnOrigen
FROM dbo.vw_ProblemCategoria WHERE Codigo = @Folio ORDER BY Categoria;

SELECT Seccion = '5d vw_ProblemVencido', Codigo, ClaveEstado, ColumnaRige, Compromiso, Veredicto, GeneraAviso
FROM dbo.vw_ProblemVencido WHERE Codigo = @Folio;

SELECT Seccion = '5e historial', IdEvento, Categoria, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario, FechaRegistro
FROM dbo.ProblemFechaEvento
WHERE Codigo = @Folio AND Campo = 'FechaAnalisis'
ORDER BY IdEvento;

/* 6. Avisos que cambiarian al dejar de usar la fecha por categoria
      (vw_ProblemVencido): compromiso de la vista vs. el de la iniciativa. */
SELECT Seccion = '6 avisos', v.Codigo, v.Compromiso, FechaIniciativa = p.FechaAnalisis, v.Veredicto,
       VeredictoConIniciativa = CASE WHEN p.FechaAnalisis IS NULL THEN N'SIN FECHA'
                                     WHEN CONVERT(date, p.FechaAnalisis) < @Hoy THEN N'VENCIDA'
                                     ELSE N'AL CORRIENTE' END
FROM dbo.vw_ProblemVencido AS v
JOIN dbo.Problem AS p ON p.Codigo = v.Codigo
WHERE v.ColumnaRige = N'FechaAnalisis'
  AND EXISTS (SELECT v.Compromiso EXCEPT SELECT p.FechaAnalisis)
ORDER BY v.Codigo;
