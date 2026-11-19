/* =====================================================================================
   diag_admin_nueva_solicitud.sql

   SOLO LECTURA. Ningun INSERT / UPDATE / DELETE / DDL.

   Nueva solicitud (admin/iniciativas.html) ya captura Titulo, Descripcion,
   Observaciones, Volumetria y el % de disminucion de la Categoria. Lo que
   sigue NO se implemento porque en 13_experiencia_usuario.sql y
   cargar_experiencia.py esos datos llegan del Excel tal cual, sin regla en
   la base. Esto mide los datos reales para decidir cada uno:

     N1  % disminucion: rango, multiplos de 5, precision
     N2  Volumetria: VolumetriaOriginal / VolumenUltimoMes contra el volumen
         que la vista cuenta en dbo.Tickets
     N3  dueños del Problem contra los de la categoria:
         OwnerProblem ~ Product Owner?, OwnerServicio ~ Service Owner?,
         Direccion ~ Director PO?
     N4  valores en uso de Estado, Subestado, Gerencia, Macroproceso, Causa,
         Proceso, RCA y CuentaConWA (catalogo cerrado o texto libre?)
     N5  fechas: FechaEntregaAnalisis contra FechaCreacion (hay un plazo
         fijo?), fecha original contra la actual y su contador
     N6  con que Estado / Subestado nacen las iniciativas mas recientes

   El codigo (prefijo, año, consecutivo) ya lo mide la seccion B de
   diag_admin_iniciativas_contrato.sql.

   Base: Tickets_Proactivanet. SQL Server 2016+.
   ===================================================================================== */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

/* N1) % de disminucion (dbo.ProblemCategoria.PctDisminucion, fraccion). */
SELECT N1 = 'PctDisminucion',
       Filas = COUNT(*),
       Nulos = SUM(CASE WHEN PctDisminucion IS NULL THEN 1 ELSE 0 END),
       Minimo = MIN(PctDisminucion), Maximo = MAX(PctDisminucion),
       MayorQue1 = SUM(CASE WHEN PctDisminucion > 1 THEN 1 ELSE 0 END),
       Cero = SUM(CASE WHEN PctDisminucion = 0 THEN 1 ELSE 0 END),
       Multiplo5 = SUM(CASE WHEN PctDisminucion * 100 % 5 = 0 THEN 1 ELSE 0 END),
       NoMultiplo5 = SUM(CASE WHEN PctDisminucion * 100 % 5 <> 0 THEN 1 ELSE 0 END),
       ConDecimalesDePct = SUM(CASE WHEN PctDisminucion * 100 % 1 <> 0 THEN 1 ELSE 0 END)
FROM dbo.ProblemCategoria
WHERE VigenteEnOrigen = 1;

SELECT TOP (30) N1b = 'Valores distintos', PctDisminucion, Filas = COUNT(*)
FROM dbo.ProblemCategoria
WHERE VigenteEnOrigen = 1
GROUP BY PctDisminucion
ORDER BY Filas DESC;

/* N2) Volumetria. La vista abanica filas (ver ExperienciaQueries.LeerIniciativas):
   se toma una por (Codigo, Categoria) antes de sumar. */
IF OBJECT_ID('tempdb..#Vol') IS NOT NULL DROP TABLE #Vol;
SELECT Codigo, VolCategoria = SUM(VolumenCategoria), Vol30 = SUM(VolumenUltimos30)
INTO #Vol
FROM (SELECT DISTINCT Codigo, Categoria, VolumenCategoria, VolumenUltimos30
      FROM dbo.vw_ProblemCategoria WHERE VigenteEnOrigen = 1) AS v
GROUP BY Codigo;

SELECT N2 = 'Volumetria vs volumen contado',
       Problems = COUNT(*),
       ConVolumetriaOriginal = SUM(CASE WHEN p.VolumetriaOriginal IS NOT NULL THEN 1 ELSE 0 END),
       ConVolumenUltimoMes = SUM(CASE WHEN p.VolumenUltimoMes IS NOT NULL THEN 1 ELSE 0 END),
       OriginalIgualUltimoMes = SUM(CASE WHEN p.VolumetriaOriginal = p.VolumenUltimoMes THEN 1 ELSE 0 END),
       UltimoMesIgualVol30 = SUM(CASE WHEN p.VolumenUltimoMes = v.Vol30 THEN 1 ELSE 0 END),
       OriginalIgualVolCategoria = SUM(CASE WHEN p.VolumetriaOriginal = v.VolCategoria THEN 1 ELSE 0 END),
       ConCategoria = SUM(CASE WHEN v.Codigo IS NOT NULL THEN 1 ELSE 0 END)
FROM dbo.Problem AS p
LEFT JOIN #Vol AS v ON v.Codigo = p.Codigo
WHERE p.VigenteEnOrigen = 1;

SELECT TOP (20) N2b = 'Ejemplos', p.Codigo, p.FechaCreacion, p.VolumetriaOriginal, p.VolumenUltimoMes,
       v.VolCategoria, v.Vol30
FROM dbo.Problem AS p
INNER JOIN #Vol AS v ON v.Codigo = p.Codigo
WHERE p.VigenteEnOrigen = 1 AND (p.VolumetriaOriginal IS NOT NULL OR p.VolumenUltimoMes IS NOT NULL)
ORDER BY p.FechaCreacion DESC;

/* N3) Dueños capturados en el Problem contra los de su(s) categoria(s). Un
   Problem coincide si ALGUNA de sus categorias trae ese mismo nombre. */
IF OBJECT_ID('tempdb..#Due') IS NOT NULL DROP TABLE #Due;
SELECT DISTINCT Codigo, ProductOwner, ServiceOwner, DirectorPO
INTO #Due
FROM dbo.vw_ProblemCategoria WHERE VigenteEnOrigen = 1;

-- SQL Server no admite subconsultas dentro de SUM (Msg 130): las banderas
-- se calculan por fila en la tabla derivada y se suman afuera.
SELECT N3 = 'Problem vs dueños de la categoria',
       ConCategoria = COUNT(*),
       OwnerProblem_Lleno = SUM(f.OwnerProblem_Lleno),
       OwnerProblem_EsPO = SUM(f.OwnerProblem_EsPO),
       OwnerServicio_Lleno = SUM(f.OwnerServicio_Lleno),
       OwnerServicio_EsSO = SUM(f.OwnerServicio_EsSO),
       Direccion_Llena = SUM(f.Direccion_Llena),
       Direccion_EsDirectorPO = SUM(f.Direccion_EsDirectorPO),
       Direccion_EsPersona = SUM(f.Direccion_EsPersona)
FROM (
    SELECT
       OwnerProblem_Lleno = CASE WHEN p.OwnerProblem IS NOT NULL THEN 1 ELSE 0 END,
       OwnerProblem_EsPO = CASE WHEN EXISTS (SELECT 1 FROM #Due d WHERE d.Codigo = p.Codigo
                                AND LTRIM(RTRIM(d.ProductOwner)) = LTRIM(RTRIM(p.OwnerProblem))) THEN 1 ELSE 0 END,
       OwnerServicio_Lleno = CASE WHEN p.OwnerServicio IS NOT NULL THEN 1 ELSE 0 END,
       OwnerServicio_EsSO = CASE WHEN EXISTS (SELECT 1 FROM #Due d WHERE d.Codigo = p.Codigo
                                 AND LTRIM(RTRIM(d.ServiceOwner)) = LTRIM(RTRIM(p.OwnerServicio))) THEN 1 ELSE 0 END,
       Direccion_Llena = CASE WHEN p.Direccion IS NOT NULL THEN 1 ELSE 0 END,
       Direccion_EsDirectorPO = CASE WHEN EXISTS (SELECT 1 FROM #Due d WHERE d.Codigo = p.Codigo
                                    AND LTRIM(RTRIM(d.DirectorPO)) = LTRIM(RTRIM(p.Direccion))) THEN 1 ELSE 0 END,
       -- Direccion como persona del catalogo Equipo, o como texto de area?
       Direccion_EsPersona = CASE WHEN EXISTS (SELECT 1 FROM dbo.CatPersona c
                                 WHERE LTRIM(RTRIM(c.Nombre)) = LTRIM(RTRIM(p.Direccion))) THEN 1 ELSE 0 END
    FROM dbo.Problem AS p
    WHERE p.VigenteEnOrigen = 1 AND EXISTS (SELECT 1 FROM #Due d WHERE d.Codigo = p.Codigo)
) AS f;

SELECT TOP (20) N3b = 'OwnerProblem distinto del PO', p.Codigo, p.OwnerProblem, d.ProductOwner,
       p.OwnerServicio, d.ServiceOwner, p.Direccion, d.DirectorPO
FROM dbo.Problem AS p
INNER JOIN #Due AS d ON d.Codigo = p.Codigo
WHERE p.VigenteEnOrigen = 1 AND p.OwnerProblem IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM #Due x WHERE x.Codigo = p.Codigo
                  AND LTRIM(RTRIM(x.ProductOwner)) = LTRIM(RTRIM(p.OwnerProblem)))
ORDER BY p.Codigo;

/* N4) Valores en uso: pocos distintos = catalogo; muchos = texto libre. */
SELECT N4 = 'Distintos por columna',
       Estado = COUNT(DISTINCT Estado), Subestado = COUNT(DISTINCT Subestado),
       Gerencia = COUNT(DISTINCT Gerencia), Direccion = COUNT(DISTINCT Direccion),
       Macroproceso = COUNT(DISTINCT Macroproceso), Causa = COUNT(DISTINCT Causa),
       Proceso = COUNT(DISTINCT Proceso), RCA = COUNT(DISTINCT RCA),
       CuentaConWA = COUNT(DISTINCT CuentaConWA), Vigentes = COUNT(*)
FROM dbo.Problem WHERE VigenteEnOrigen = 1;

SELECT N4b = 'Valores', Columna, Valor, Filas = COUNT(*)
FROM dbo.Problem AS p
CROSS APPLY (VALUES (N'Estado', p.Estado), (N'Subestado', p.Subestado), (N'Gerencia', p.Gerencia),
                    (N'Macroproceso', p.Macroproceso), (N'Causa', p.Causa), (N'Proceso', p.Proceso),
                    (N'RCA', p.RCA), (N'CuentaConWA', p.CuentaConWA)) AS x (Columna, Valor)
WHERE p.VigenteEnOrigen = 1
GROUP BY Columna, Valor
ORDER BY Columna, Filas DESC;

-- Gerencia: depende de la Direccion (cada Direccion con una sola Gerencia)?
SELECT N4c = 'Gerencias por Direccion', Direccion, Gerencias = COUNT(DISTINCT Gerencia), Filas = COUNT(*)
FROM dbo.Problem WHERE VigenteEnOrigen = 1 AND Direccion IS NOT NULL
GROUP BY Direccion ORDER BY Gerencias DESC, Filas DESC;

/* N5) Fechas. */
SELECT N5 = 'Dias de FechaCreacion a FechaEntregaAnalisis',
       Dias = DATEDIFF(DAY, FechaCreacion, FechaEntregaAnalisis), Filas = COUNT(*)
FROM dbo.Problem
WHERE VigenteEnOrigen = 1 AND FechaCreacion IS NOT NULL AND FechaEntregaAnalisis IS NOT NULL
GROUP BY DATEDIFF(DAY, FechaCreacion, FechaEntregaAnalisis)
ORDER BY Filas DESC;

-- Original contra actual: con 0 cambios, deberian ser iguales; con cambios,
-- distintas. Si no, el contador no cuenta lo que su nombre dice.
SELECT N5b = 'Original vs actual vs contador', Fecha, Cambios,
       Iguales = SUM(CASE WHEN Original = Actual THEN 1 ELSE 0 END),
       Distintas = SUM(CASE WHEN Original <> Actual THEN 1 ELSE 0 END),
       SinOriginal = SUM(CASE WHEN Original IS NULL AND Actual IS NOT NULL THEN 1 ELSE 0 END),
       SinActual = SUM(CASE WHEN Actual IS NULL AND Original IS NOT NULL THEN 1 ELSE 0 END)
FROM dbo.Problem AS p
CROSS APPLY (VALUES
    (N'Solucion', p.FechaOriginalSolucion, p.FechaSolucion,
     CASE WHEN p.NroCambioFechaSolucion IS NULL THEN N'null' WHEN p.NroCambioFechaSolucion = 0 THEN N'0' ELSE N'>0' END),
    (N'Cierre', p.FechaOriginalCierre, p.FechaCierre,
     CASE WHEN p.NroCambioFechaCierre IS NULL THEN N'null' WHEN p.NroCambioFechaCierre = 0 THEN N'0' ELSE N'>0' END)
) AS x (Fecha, Original, Actual, Cambios)
WHERE p.VigenteEnOrigen = 1
GROUP BY Fecha, Cambios
ORDER BY Fecha, Cambios;

-- Analisis no tiene "original": como se ve su contador.
SELECT N5c = 'Analisis', Cambios = NroCambioFechaAnalisis,
       ConFecha = SUM(CASE WHEN FechaAnalisis IS NOT NULL THEN 1 ELSE 0 END), Filas = COUNT(*)
FROM dbo.Problem WHERE VigenteEnOrigen = 1
GROUP BY NroCambioFechaAnalisis ORDER BY NroCambioFechaAnalisis;

/* N6) Con que nacen: las 30 iniciativas creadas mas recientemente. */
SELECT TOP (30) N6 = 'Recientes', Codigo, FechaCreacion, Estado, Subestado,
       FechaEntregaAnalisis, FechaAnalisis, FechaOriginalSolucion, FechaSolucion,
       NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre,
       RCA, CuentaConWA, VolumetriaOriginal, VolumenUltimoMes
FROM dbo.Problem
WHERE VigenteEnOrigen = 1
ORDER BY FechaCreacion DESC;

DROP TABLE #Vol; DROP TABLE #Due;
