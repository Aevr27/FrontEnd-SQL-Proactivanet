/* =====================================================================================
   diag_cobertura_vs_nueva_iniciativa.sql  -  SOLO LECTURA.  (2026-11-11)
   Servidor: AZVMBDCENTRALQA   Base: Tickets_Proactivanet

   SEGURIDAD
     Solo SELECT (catalogos, OBJECT_DEFINITION, tablas y vistas existentes).
     Ningun INSERT / UPDATE / DELETE / MERGE, ningun CREATE / ALTER / DROP,
     ningun EXEC, ninguna transaccion, ninguna tabla temporal ni variable de
     tabla, nada de msdb ni de DMV de servidor. Cada seccion es su propio lote
     (GO): si una falla, las demas siguen. Se puede correr cuantas veces se
     quiera. Archivo solo ASCII (los acentos de las rutas van como '%').

   PARA QUE
     Comparar, para las rutas de la captura
       /S-Gestion de Inventarios y Recibo de mercancia/App Evolucion/...
       (Embarques, Devoluciones, Visualizar el Embarque, Eliminar Embarque,
        Embarques PMV)
     lo que usa "Categorias sin iniciativas" (Experiencia) contra lo que usa
     "Solicitar una iniciativa" (Admin -> Nueva solicitud):

       Experiencia (experiencia.js renderSin / ExperienciaQueries.ArmarCategoriasV2)
         volumen   = vw_TBSlotCAT SLOT 0, SUM([Total general]) - SorIA
                     (ExperienciaQueries.SinSorIA), por [Categoria V2]
         reduccion = SUM(TicketsReduce mostrado) de las filas de
                     vw_ProblemCategoria vigentes, ACTIVAS (En Analisis /
                     En Solucion / En Monitoreo) y con agrupador (Problem,
                     SorIA, Adopcion, Mejora); mostrado = ExpTicketsReduce si
                     su Pct = el % actual, si no ProblemCategoria.TicketsReduce
         cubierto  = MIN(reduccion, volumen); sin cubrir = MAX(0, vol - red)
         %         = cubierto / volumen   (se pinta Math.round(x*100) + '%')
       Nueva solicitud (admin/iniciativas.js + SolicitudIniciativa.cs)
         volumen   = vw_TBSlotCAT SLOT 0, SUM([Total general]) CON SorIA
                     (ExperienciaVolumetria)
         capacidad = MAX(0, 1 - SUM(PctDisminucion)) de las MISMAS filas
                     activas con agrupador, en PORCENTAJE, no en tickets

   SECCIONES
     D0  contexto y nivel de compatibilidad.
     D1  volumen por ruta: SLOT 0 total / SorIA / sin SorIA, foto
         (ExpTicketsReduce.Volumen30) y vivo (vw_ProblemCategoria.VolumenUltimos30).
     D2  cada fila de iniciativa en esas rutas (vigentes y no vigentes), con
         estado, agrupador, %, TicketsReduce de la fila y de la foto, cual se
         muestra y si cuenta.
     D3  por ruta: cobertura de Experiencia paso a paso contra la capacidad de
         Nueva solicitud, y la diferencia por redondear fila por fila.
     D4  en TODA la base: cuantas rutas dicen "sin cubrir" en Experiencia y
         "0% disponible" en Nueva solicitud (y al reves), hoy y con CEILING
         por fila (sql/85) sobre el volumen de la foto.
     D5  ventana real del SLOT 0: fechas minima/maxima de los tickets con
         Slot = 0 y Slot = 1 (dbo.vw_Tickets.Slot).
     D6  las dos rutas Soria del diagnostico anterior: tickets de 30 dias por
         Tipo en dbo.Tickets contra lo que trae vw_TBSlotCAT SLOT 0.
     D7  definiciones COMPLETAS, una fila por linea: dbo.vw_Tickets,
         dbo.vw_TicketsSlotsBase, dbo.vw_TBSlotCAT, dbo.vw_ProblemCategoria,
         dbo.usp_Exp_CalcularTicketsReduce.

   COMO CORRERLO
     SSMS -> AZVMBDCENTRALQA -> Tickets_Proactivanet -> abrir el archivo ->
     Resultados en cuadricula (Ctrl+D) -> F5. Copiar todas las cuadriculas
     (clic en la esquina de cada una -> Copiar con encabezados). D7 es largo:
     mejor "Guardar resultados como..." .csv. D5 y D6 leen dbo.vw_Tickets y
     dbo.Tickets: pueden tardar unos segundos.
   ===================================================================================== */
SET NOCOUNT ON;
GO

/* D0) Contexto */
SELECT Seccion = 'D0', Servidor = @@SERVERNAME, Base = DB_NAME(), Cuenta = SUSER_SNAME(),
       VersionSql = CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion')),
       Compatibilidad = (SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID()),
       Ahora = SYSDATETIME(), AhoraUtc = SYSUTCDATETIME(),
       FotoHoy = (SELECT MAX(Hoy) FROM dbo.ExpTicketsReduce),
       FotoCalculo = (SELECT MAX(FechaCalculo) FROM dbo.ExpTicketsReduce);
GO

/* D1) Volumen por ruta */
DECLARE @pat nvarchar(200) = N'/S-Gesti%n de Inventarios y Recibo de mercancia/App Evolucion/%';
WITH s0 AS (
    SELECT Ruta = s.[Categoria V2],
           Total = SUM(s.[Total general]),
           SorIA = SUM(ISNULL(s.[SorIA Peticiones], 0) + ISNULL(s.[SorIA Incidentes], 0))
    FROM dbo.vw_TBSlotCAT AS s
    WHERE s.Slot = 0 AND s.[Categoria V2] LIKE @pat
    GROUP BY s.[Categoria V2]),
r AS (
    SELECT Ruta FROM s0
    UNION SELECT pc.Categoria FROM dbo.ProblemCategoria AS pc WHERE pc.Categoria LIKE @pat
    UNION SELECT x.Categoria FROM dbo.ExpTicketsReduce AS x WHERE x.Categoria LIKE @pat)
SELECT Seccion = 'D1', r.Ruta,
       Slot0Total          = s0.Total,
       Slot0SorIA          = s0.SorIA,
       VolExperiencia      = CASE WHEN s0.Total - s0.SorIA > 0 THEN s0.Total - s0.SorIA ELSE 0 END,
       VolNuevaSolicitud   = ISNULL(s0.Total, 0),
       FotoVolumen30       = (SELECT MAX(x.Volumen30) FROM dbo.ExpTicketsReduce AS x WHERE x.Categoria = r.Ruta),
       VivoVolumenUltimos30 = (SELECT MAX(v.VolumenUltimos30) FROM dbo.vw_ProblemCategoria AS v WHERE v.Categoria = r.Ruta),
       LargoRuta = LEN(r.Ruta), RutaHex = CONVERT(varchar(100), CONVERT(varbinary(50), RIGHT(r.Ruta, 25)), 1)
FROM r
LEFT JOIN s0 ON s0.Ruta = r.Ruta
ORDER BY r.Ruta;
GO

/* D2) Filas de iniciativa en esas rutas. Fila = la de vw_ProblemCategoria
   deduplicada por (Codigo, Categoria) como LeerIniciativas. Cuenta = activa Y
   con agrupador: es lo que suma Experiencia y lo que consume capacidad. */
DECLARE @pat nvarchar(200) = N'/S-Gesti%n de Inventarios y Recibo de mercancia/App Evolucion/%';
WITH v AS (
    SELECT DISTINCT v.Codigo, v.Categoria, v.Estado, v.TipoAgrupado, v.PctDisminucion,
           FilaTicketsReduce = v.TicketsReduce, v.VolumenUltimos30, v.VigenteEnOrigen
    FROM dbo.vw_ProblemCategoria AS v
    WHERE v.Categoria LIKE @pat)
SELECT Seccion = 'D2', v.Categoria, v.Codigo, v.VigenteEnOrigen, v.Estado, v.TipoAgrupado,
       v.PctDisminucion, v.FilaTicketsReduce, v.VolumenUltimos30,
       FotoPct = tr.Pct, FotoVolumen30 = tr.Volumen30, FotoTicketsReduce = tr.TicketsReduce,
       DeFoto   = f.DeFoto,
       Mostrado = CASE WHEN f.DeFoto = 1 THEN tr.TicketsReduce ELSE v.FilaTicketsReduce END,
       Activa   = a.Activa, Agrupador = a.Agrupador,
       Cuenta   = CASE WHEN v.VigenteEnOrigen = 1 AND a.Activa = 1 AND a.Agrupador = 1 THEN 1 ELSE 0 END
FROM v
LEFT JOIN dbo.ExpTicketsReduce AS tr ON tr.Codigo = v.Codigo AND tr.Categoria = v.Categoria
CROSS APPLY (SELECT DeFoto = CASE WHEN tr.Codigo IS NOT NULL AND (tr.Pct = v.PctDisminucion OR (tr.Pct IS NULL AND v.PctDisminucion IS NULL)) THEN 1 ELSE 0 END) AS f
CROSS APPLY (SELECT Activa = CASE WHEN LTRIM(RTRIM(v.Estado)) LIKE N'En An_lisis' OR LTRIM(RTRIM(v.Estado)) LIKE N'En Soluci_n'
                                    OR LTRIM(RTRIM(v.Estado)) = N'En Monitoreo' THEN 1 ELSE 0 END,
                    Agrupador = CASE WHEN LTRIM(RTRIM(v.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Mejora')
                                       OR LTRIM(RTRIM(v.TipoAgrupado)) LIKE N'Adopci_n' THEN 1 ELSE 0 END) AS a
ORDER BY v.Categoria, v.Codigo;

/* Filas NO vigentes de ProblemCategoria en esas rutas (no cuentan en ningun lado) */
SELECT Seccion = 'D2', Nota = 'ProblemCategoria NO vigente', pc.Categoria, pc.Codigo, pc.PctDisminucion, pc.TicketsReduce, p.Estado
FROM dbo.ProblemCategoria AS pc
LEFT JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
WHERE pc.Categoria LIKE @pat AND pc.VigenteEnOrigen = 0
ORDER BY pc.Categoria, pc.Codigo;
GO

/* D3) Por ruta: Experiencia contra Nueva solicitud, paso a paso.
   SumaRoundFilas   = SUM(Mostrado) (lo que suma Experiencia: un ROUND por fila)
   RoundDeLaSuma    = ROUND(MIN(SUM(%),1) x FotoVolumen30, 0) (un solo redondeo)
   PerdidaRedondeo  = RoundDeLaSuma - SumaRoundFilas */
DECLARE @pat nvarchar(200) = N'/S-Gesti%n de Inventarios y Recibo de mercancia/App Evolucion/%';
WITH v AS (
    SELECT DISTINCT v.Codigo, v.Categoria, v.Estado, v.TipoAgrupado, v.PctDisminucion,
           FilaTicketsReduce = v.TicketsReduce, v.VigenteEnOrigen
    FROM dbo.vw_ProblemCategoria AS v
    WHERE v.Categoria LIKE @pat AND v.VigenteEnOrigen = 1),
c AS (
    SELECT v.Categoria, v.PctDisminucion,
           Mostrado = CASE WHEN tr.Codigo IS NOT NULL AND (tr.Pct = v.PctDisminucion OR (tr.Pct IS NULL AND v.PctDisminucion IS NULL))
                           THEN tr.TicketsReduce ELSE v.FilaTicketsReduce END,
           FotoVol = tr.Volumen30,
           Ceil = CASE WHEN v.PctDisminucion IS NULL OR v.PctDisminucion <= 0 THEN 0
                       ELSE CONVERT(int, CEILING(CASE WHEN v.PctDisminucion > 1 THEN 1.0 ELSE v.PctDisminucion END * ISNULL(tr.Volumen30, 0))) END
    FROM v
    LEFT JOIN dbo.ExpTicketsReduce AS tr ON tr.Codigo = v.Codigo AND tr.Categoria = v.Categoria
    WHERE (LTRIM(RTRIM(v.Estado)) LIKE N'En An_lisis' OR LTRIM(RTRIM(v.Estado)) LIKE N'En Soluci_n' OR LTRIM(RTRIM(v.Estado)) = N'En Monitoreo')
      AND (LTRIM(RTRIM(v.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Mejora') OR LTRIM(RTRIM(v.TipoAgrupado)) LIKE N'Adopci_n')),
agg AS (
    SELECT Categoria, Iniciativas = COUNT(*), SumaPct = SUM(ISNULL(PctDisminucion, 0)),
           SumaRoundFilas = SUM(ISNULL(Mostrado, 0)), SumaCeilingFilas = SUM(Ceil), FotoVol = MAX(FotoVol)
    FROM c GROUP BY Categoria),
s0 AS (
    SELECT Ruta = s.[Categoria V2], Total = SUM(s.[Total general]),
           SorIA = SUM(ISNULL(s.[SorIA Peticiones], 0) + ISNULL(s.[SorIA Incidentes], 0))
    FROM dbo.vw_TBSlotCAT AS s WHERE s.Slot = 0 AND s.[Categoria V2] LIKE @pat
    GROUP BY s.[Categoria V2]),
r AS (SELECT Ruta FROM s0 UNION SELECT Categoria FROM agg)
SELECT Seccion = 'D3', r.Ruta,
       VolExperiencia  = e.Vol,
       IniciativasQueCuentan = ISNULL(agg.Iniciativas, 0),
       ReduccionExp    = ISNULL(agg.SumaRoundFilas, 0),
       CubiertoExp     = CASE WHEN ISNULL(agg.SumaRoundFilas, 0) < e.Vol THEN ISNULL(agg.SumaRoundFilas, 0) ELSE e.Vol END,
       SinCubrirExp    = CASE WHEN e.Vol - ISNULL(agg.SumaRoundFilas, 0) > 0 THEN e.Vol - ISNULL(agg.SumaRoundFilas, 0) ELSE 0 END,
       PctCoberturaExp = CASE WHEN e.Vol > 0 THEN CONVERT(decimal(9,4), 1.0 * CASE WHEN ISNULL(agg.SumaRoundFilas, 0) < e.Vol THEN ISNULL(agg.SumaRoundFilas, 0) ELSE e.Vol END / e.Vol) END,
       VolNuevaSolicitud = ISNULL(s0.Total, 0),
       PctUsadoNS      = ISNULL(agg.SumaPct, 0),
       PctDisponibleNS = CASE WHEN ISNULL(agg.SumaPct, 0) >= 1 THEN 0 ELSE 1 - ISNULL(agg.SumaPct, 0) END,
       FotoVolumen30   = agg.FotoVol,
       RoundDeLaSuma   = CONVERT(int, ROUND(CASE WHEN ISNULL(agg.SumaPct, 0) > 1 THEN 1.0 ELSE ISNULL(agg.SumaPct, 0) END * ISNULL(agg.FotoVol, 0), 0)),
       PerdidaRedondeo = CONVERT(int, ROUND(CASE WHEN ISNULL(agg.SumaPct, 0) > 1 THEN 1.0 ELSE ISNULL(agg.SumaPct, 0) END * ISNULL(agg.FotoVol, 0), 0)) - ISNULL(agg.SumaRoundFilas, 0),
       ConCeiling_Reduccion = ISNULL(agg.SumaCeilingFilas, 0),
       ConCeiling_SinCubrir = CASE WHEN e.Vol - ISNULL(agg.SumaCeilingFilas, 0) > 0 THEN e.Vol - ISNULL(agg.SumaCeilingFilas, 0) ELSE 0 END,
       ConCeiling_PctCobertura = CASE WHEN e.Vol > 0 THEN CONVERT(decimal(9,4), 1.0 * CASE WHEN ISNULL(agg.SumaCeilingFilas, 0) < e.Vol THEN ISNULL(agg.SumaCeilingFilas, 0) ELSE e.Vol END / e.Vol) END
FROM r
LEFT JOIN s0 ON s0.Ruta = r.Ruta
LEFT JOIN agg ON agg.Categoria = r.Ruta
CROSS APPLY (SELECT Vol = CASE WHEN ISNULL(s0.Total, 0) - ISNULL(s0.SorIA, 0) > 0 THEN ISNULL(s0.Total, 0) - ISNULL(s0.SorIA, 0) ELSE 0 END) AS e
ORDER BY r.Ruta;
GO

/* D4) Toda la base, mismas cuentas por ruta. Clases:
     A  Experiencia: sin cubrir > 0   y  Nueva solicitud: 0% disponible
     B  Experiencia: cubierta (0 sin cubrir) y Nueva solicitud: > 0% disponible
   (rutas con volumen de Experiencia > 0 y al menos una iniciativa que cuenta) */
WITH v AS (
    SELECT DISTINCT v.Codigo, v.Categoria, v.Estado, v.TipoAgrupado, v.PctDisminucion, FilaTicketsReduce = v.TicketsReduce
    FROM dbo.vw_ProblemCategoria AS v
    WHERE v.VigenteEnOrigen = 1),
c AS (
    SELECT v.Categoria, v.PctDisminucion,
           Mostrado = CASE WHEN tr.Codigo IS NOT NULL AND (tr.Pct = v.PctDisminucion OR (tr.Pct IS NULL AND v.PctDisminucion IS NULL))
                           THEN tr.TicketsReduce ELSE v.FilaTicketsReduce END,
           Ceil = CASE WHEN v.PctDisminucion IS NULL OR v.PctDisminucion <= 0 THEN 0
                       ELSE CONVERT(int, CEILING(CASE WHEN v.PctDisminucion > 1 THEN 1.0 ELSE v.PctDisminucion END * ISNULL(tr.Volumen30, 0))) END
    FROM v
    LEFT JOIN dbo.ExpTicketsReduce AS tr ON tr.Codigo = v.Codigo AND tr.Categoria = v.Categoria
    WHERE (LTRIM(RTRIM(v.Estado)) LIKE N'En An_lisis' OR LTRIM(RTRIM(v.Estado)) LIKE N'En Soluci_n' OR LTRIM(RTRIM(v.Estado)) = N'En Monitoreo')
      AND (LTRIM(RTRIM(v.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Mejora') OR LTRIM(RTRIM(v.TipoAgrupado)) LIKE N'Adopci_n')),
agg AS (SELECT Categoria, N = COUNT(*), SumaPct = SUM(ISNULL(PctDisminucion, 0)), Red = SUM(ISNULL(Mostrado, 0)), RedC = SUM(Ceil) FROM c GROUP BY Categoria),
s0 AS (
    SELECT Ruta = s.[Categoria V2], Total = SUM(s.[Total general]),
           SorIA = SUM(ISNULL(s.[SorIA Peticiones], 0) + ISNULL(s.[SorIA Incidentes], 0))
    FROM dbo.vw_TBSlotCAT AS s WHERE s.Slot = 0 GROUP BY s.[Categoria V2]),
x AS (
    SELECT agg.Categoria, agg.N, agg.SumaPct, agg.Red, agg.RedC,
           Vol = CASE WHEN ISNULL(s0.Total, 0) - ISNULL(s0.SorIA, 0) > 0 THEN ISNULL(s0.Total, 0) - ISNULL(s0.SorIA, 0) ELSE 0 END
    FROM agg LEFT JOIN s0 ON s0.Ruta = agg.Categoria)
SELECT Seccion = 'D4',
       RutasConIniciativa = COUNT(*),
       ConVolumen         = SUM(CASE WHEN Vol > 0 THEN 1 ELSE 0 END),
       A_SinCubrir_Y_0Disponible = SUM(CASE WHEN Vol > 0 AND Vol - Red > 0 AND SumaPct >= 1 THEN 1 ELSE 0 END),
       A_TicketsSinCubrir        = SUM(CASE WHEN Vol > 0 AND Vol - Red > 0 AND SumaPct >= 1 THEN Vol - Red ELSE 0 END),
       B_Cubierta_Y_HayDisponible = SUM(CASE WHEN Vol > 0 AND Vol - Red <= 0 AND SumaPct < 1 THEN 1 ELSE 0 END),
       SumaPctMayor1 = SUM(CASE WHEN SumaPct > 1 THEN 1 ELSE 0 END),
       -- lo mismo si cada fila fuera CEILING(% x Volumen30 de la foto) (sql/85):
       Ceil_A_SinCubrir_Y_0Disponible  = SUM(CASE WHEN Vol > 0 AND Vol - RedC > 0 AND SumaPct >= 1 THEN 1 ELSE 0 END),
       Ceil_A_TicketsSinCubrir         = SUM(CASE WHEN Vol > 0 AND Vol - RedC > 0 AND SumaPct >= 1 THEN Vol - RedC ELSE 0 END),
       Ceil_B_Cubierta_Y_HayDisponible = SUM(CASE WHEN Vol > 0 AND Vol - RedC <= 0 AND SumaPct < 1 THEN 1 ELSE 0 END),
       Ceil_B_PuntosPctDisponibles     = SUM(CASE WHEN Vol > 0 AND Vol - RedC <= 0 AND SumaPct < 1 THEN 1 - SumaPct ELSE 0 END)
FROM x;

/* Las 40 rutas de la clase A, para ver ejemplos */
WITH v AS (
    SELECT DISTINCT v.Codigo, v.Categoria, v.Estado, v.TipoAgrupado, v.PctDisminucion, FilaTicketsReduce = v.TicketsReduce
    FROM dbo.vw_ProblemCategoria AS v WHERE v.VigenteEnOrigen = 1),
c AS (
    SELECT v.Categoria, v.PctDisminucion,
           Mostrado = CASE WHEN tr.Codigo IS NOT NULL AND (tr.Pct = v.PctDisminucion OR (tr.Pct IS NULL AND v.PctDisminucion IS NULL))
                           THEN tr.TicketsReduce ELSE v.FilaTicketsReduce END
    FROM v LEFT JOIN dbo.ExpTicketsReduce AS tr ON tr.Codigo = v.Codigo AND tr.Categoria = v.Categoria
    WHERE (LTRIM(RTRIM(v.Estado)) LIKE N'En An_lisis' OR LTRIM(RTRIM(v.Estado)) LIKE N'En Soluci_n' OR LTRIM(RTRIM(v.Estado)) = N'En Monitoreo')
      AND (LTRIM(RTRIM(v.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Mejora') OR LTRIM(RTRIM(v.TipoAgrupado)) LIKE N'Adopci_n')),
agg AS (SELECT Categoria, N = COUNT(*), SumaPct = SUM(ISNULL(PctDisminucion, 0)), Red = SUM(ISNULL(Mostrado, 0)) FROM c GROUP BY Categoria),
s0 AS (
    SELECT Ruta = s.[Categoria V2], Total = SUM(s.[Total general]),
           SorIA = SUM(ISNULL(s.[SorIA Peticiones], 0) + ISNULL(s.[SorIA Incidentes], 0))
    FROM dbo.vw_TBSlotCAT AS s WHERE s.Slot = 0 GROUP BY s.[Categoria V2])
SELECT TOP (40) Seccion = 'D4', agg.Categoria, Iniciativas = agg.N, agg.SumaPct, ReduccionExp = agg.Red,
       Slot0Total = s0.Total, Slot0SorIA = s0.SorIA
FROM agg LEFT JOIN s0 ON s0.Ruta = agg.Categoria
WHERE agg.SumaPct >= 1
  AND ISNULL(s0.Total, 0) - ISNULL(s0.SorIA, 0) - agg.Red > 0
ORDER BY ISNULL(s0.Total, 0) - ISNULL(s0.SorIA, 0) - agg.Red DESC, agg.Categoria;
GO

/* D5) Ventana real de los Slots 0 y 1 (dbo.vw_Tickets.Slot) */
SELECT Seccion = 'D5', t.Slot, Tickets = COUNT_BIG(*),
       PrimerRegistro = MIN(t.FechaRegistro), UltimoRegistro = MAX(t.FechaRegistro)
FROM dbo.vw_Tickets AS t
WHERE t.Slot IN (0, 1)
GROUP BY t.Slot
ORDER BY t.Slot;
SELECT Seccion = 'D5', TicketsSinSlotUltimos40Dias = COUNT_BIG(*),
       PrimerRegistro = MIN(t.FechaRegistro), UltimoRegistro = MAX(t.FechaRegistro)
FROM dbo.vw_Tickets AS t
WHERE t.Slot IS NULL AND t.FechaRegistro >= DATEADD(DAY, -40, SYSDATETIME());
SELECT Seccion = 'D5', TicketsUltimos40DiasEnTabla = COUNT_BIG(*), EnVista = (SELECT COUNT_BIG(*) FROM dbo.vw_Tickets AS t WHERE t.FechaRegistro >= DATEADD(DAY, -40, SYSDATETIME())),
       UltimoRegistroTabla = MAX(FechaRegistro), UltimaCargaDW = MAX(FechaUltimaCargaDW)
FROM dbo.Tickets
WHERE FechaRegistro >= DATEADD(DAY, -40, SYSDATETIME());
GO

/* D6) Rutas Soria del diagnostico anterior y una de la captura: dbo.Tickets
   por Tipo / TipoRelacion (ultimos 31 dias) contra vw_Tickets por Slot y la
   categoria que trae vw_TBSlotCAT. */
SELECT Seccion = 'D6', Fuente = 'dbo.Tickets 31 dias', t.Categoria, t.Tipo, t.TipoRelacion, Tickets = COUNT_BIG(*),
       Primer = MIN(t.FechaRegistro), Ultimo = MAX(t.FechaRegistro)
FROM dbo.Tickets AS t
WHERE t.FechaRegistro >= DATEADD(DAY, -31, SYSDATETIME())
  AND (t.Categoria IN (N'/Soria/Punto de Venta/Precios', N'/Soria/SAP/Desbloqueo&Reseteo')
       OR t.Categoria LIKE N'/S-Gesti%n de Inventarios y Recibo de mercancia/App Evolucion/Embarques')
GROUP BY t.Categoria, t.Tipo, t.TipoRelacion
ORDER BY t.Categoria, Tickets DESC;

SELECT Seccion = 'D6', Fuente = 'dbo.vw_Tickets por Slot', t.Categoria, t.Slot, Tickets = COUNT_BIG(*)
FROM dbo.vw_Tickets AS t
WHERE t.FechaRegistro >= DATEADD(DAY, -70, SYSDATETIME())
  AND (t.Categoria IN (N'/Soria/Punto de Venta/Precios', N'/Soria/SAP/Desbloqueo&Reseteo')
       OR t.Categoria LIKE N'/S-Gesti%n de Inventarios y Recibo de mercancia/App Evolucion/Embarques')
GROUP BY t.Categoria, t.Slot
ORDER BY t.Categoria, t.Slot;

SELECT Seccion = 'D6', Fuente = 'vw_TBSlotCAT Slot 0', s.[Categoria V2], s.Aplica,
       Total = SUM(s.[Total general]), SorIA = SUM(ISNULL(s.[SorIA Peticiones], 0) + ISNULL(s.[SorIA Incidentes], 0)),
       Incidencia = SUM(ISNULL(s.Incidencia, 0))
FROM dbo.vw_TBSlotCAT AS s
WHERE s.Slot = 0
  AND (s.[Categoria V2] LIKE N'/Soria/Punto de Venta/Precios%' OR s.[Categoria V2] LIKE N'/Soria/SAP/Desbloqueo%'
       OR s.[Categoria V2] LIKE N'/S-Gesti%n de Inventarios y Recibo de mercancia/App Evolucion/Embarques')
GROUP BY s.[Categoria V2], s.Aplica
ORDER BY s.[Categoria V2];
GO

/* D7) Definiciones completas, una fila por linea (copiar Texto en orden de Linea) */
WITH o AS (
    SELECT Objeto = n.Nombre, Def = OBJECT_DEFINITION(OBJECT_ID(n.Nombre))
    FROM (VALUES (N'dbo.vw_Tickets'), (N'dbo.vw_TicketsSlotsBase'), (N'dbo.vw_TBSlotCAT'),
                 (N'dbo.vw_ProblemCategoria'), (N'dbo.usp_Exp_CalcularTicketsReduce')) AS n (Nombre)),
l AS (
    SELECT o.Objeto, Linea = CONVERT(int, 1), Ini = CONVERT(bigint, 1),
           Fin = CONVERT(bigint, CHARINDEX(NCHAR(10), o.Def + NCHAR(10)))
    FROM o WHERE o.Def IS NOT NULL
    UNION ALL
    SELECT l.Objeto, l.Linea + 1, l.Fin + 1, CONVERT(bigint, CHARINDEX(NCHAR(10), o.Def + NCHAR(10), l.Fin + 1))
    FROM l INNER JOIN o ON o.Objeto = l.Objeto
    WHERE l.Fin < DATALENGTH(o.Def) / 2)
SELECT Seccion = 'D7', l.Objeto, l.Linea,
       Texto = REPLACE(SUBSTRING(o.Def, l.Ini, l.Fin - l.Ini), NCHAR(13), N'')
FROM l INNER JOIN o ON o.Objeto = l.Objeto
ORDER BY l.Objeto, l.Linea
OPTION (MAXRECURSION 0);

SELECT Seccion = 'D7', Objeto = n.Nombre, Existe = CASE WHEN OBJECT_ID(n.Nombre) IS NULL THEN 0 ELSE 1 END,
       ConDefinicion = CASE WHEN OBJECT_DEFINITION(OBJECT_ID(n.Nombre)) IS NULL THEN 0 ELSE 1 END,
       Caracteres = DATALENGTH(OBJECT_DEFINITION(OBJECT_ID(n.Nombre))) / 2
FROM (VALUES (N'dbo.vw_Tickets'), (N'dbo.vw_TicketsSlotsBase'), (N'dbo.vw_TBSlotCAT'),
             (N'dbo.vw_ProblemCategoria'), (N'dbo.usp_Exp_CalcularTicketsReduce')) AS n (Nombre);
GO
