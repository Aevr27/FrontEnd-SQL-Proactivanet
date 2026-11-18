/* =====================================================================================
   diag_experiencia_tipos_vistas.sql  -  SOLO LECTURA.  (2026-11-11)
   Servidor: AZVMBDCENTRALQA   Base: Tickets_Proactivanet

   Solo SELECT sobre catalogos, OBJECT_DEFINITION y las vistas de volumen. Ningun
   INSERT/UPDATE/DELETE/MERGE, ningun DDL, ningun EXEC, ninguna transaccion.

   Para el cambio de Experiencia que agrupa Incidentes = 'Incidencia' + 'SorIA
   Incidentes' y Requerimientos = 'Peticion de Servicio' + 'SorIA Peticiones'
   (ExperienciaQueries.VolumenDeColumnas). Lo que el repo NO puede verificar:
   el texto de dbo.vw_TBMesCAT / dbo.vw_TicketsMesBase (09_slots_por_mes.sql no
   esta en ningun repositorio).

   T1  definiciones reales de las cuatro vistas (texto completo + marcas)
   T2  valores de TipoTicket en SLOT 0 y en el mes en curso (grafias, mayusculas)
   T3  mismo ticket, mismo TipoTicket en las dos vistas base (SLOT 0)
   T4  sin doble cuenta: filas vs tickets distintos en las dos vistas base
   T5  antes / despues por tipo: SLOT 0 y mes en curso (lo que vera el tablero)
   T6  SLOT 0 contra el mismo rango de fechas leido de la vista por mes
   ===================================================================================== */
SET NOCOUNT ON;
GO

/* T1) Definiciones. TipoTicketIgual = la expresion de TipoTicket del script v2. */
SELECT Seccion = 'T1', Vista = v.Nombre,
       Existe = CASE WHEN OBJECT_ID(v.Nombre, N'V') IS NULL THEN 0 ELSE 1 END,
       TipoTicketIgual = CASE WHEN REPLACE(d.D, N' ', N'') LIKE N'%TipoTicket=ISNULL(NULLIF(LTRIM(RTRIM(t.Tipo)),N''''),N''Sintipo'')%' THEN 'SI' ELSE 'NO' END,
       TieneSorIAIncidentes = CASE WHEN d.D LIKE N'%SorIA Incidentes%' THEN 'SI' ELSE 'NO' END,
       TieneSorIAPeticiones = CASE WHEN d.D LIKE N'%SorIA Peticiones%' THEN 'SI' ELSE 'NO' END,
       Largo = LEN(d.D), o.modify_date, Definicion = d.D
FROM (VALUES (N'dbo.vw_TicketsSlotsBase'), (N'dbo.vw_TBSlotCAT'),
             (N'dbo.vw_TicketsMesBase'), (N'dbo.vw_TBMesCAT')) AS v(Nombre)
LEFT JOIN sys.objects AS o ON o.object_id = OBJECT_ID(v.Nombre, N'V')
OUTER APPLY (SELECT D = OBJECT_DEFINITION(o.object_id)) AS d;
GO

/* T2) Grafias reales de TipoTicket. Una variante que no sea exactamente uno de
   los cuatro tipos (o 'Sin tipo') NO entra en Incidentes ni en Requerimientos. */
SELECT Seccion = 'T2', Vista = 'SLOT 0', b.TipoTicket, Tickets = COUNT_BIG(*)
FROM dbo.vw_TicketsSlotsBase AS b
WHERE b.Slot = 0
GROUP BY b.TipoTicket
UNION ALL
SELECT 'T2', 'Mes en curso', b.TipoTicket, COUNT_BIG(*)
FROM dbo.vw_TicketsMesBase AS b
WHERE b.Anio = YEAR(GETDATE()) AND b.Mes = MONTH(GETDATE())
GROUP BY b.TipoTicket
ORDER BY 2, 4 DESC;
GO

/* T3) Un ticket del SLOT 0 con TipoTicket distinto en la vista por mes. Esperado: 0
   filas en Distintos y SoloEnSlot = 0. */
SELECT Seccion = 'T3',
       EnSlot0 = COUNT_BIG(*),
       SoloEnSlot = SUM(CASE WHEN m.CodigoTicket IS NULL THEN 1 ELSE 0 END),
       Distintos = SUM(CASE WHEN m.CodigoTicket IS NOT NULL AND m.TipoTicket <> s.TipoTicket THEN 1 ELSE 0 END)
FROM dbo.vw_TicketsSlotsBase AS s
LEFT JOIN dbo.vw_TicketsMesBase AS m ON m.CodigoTicket = s.CodigoTicket
WHERE s.Slot = 0;
GO

/* T4) Sin doble cuenta: cada vista base, una fila por ticket. Esperado Filas = Distintos. */
SELECT Seccion = 'T4', Vista = 'vw_TicketsSlotsBase SLOT 0', Filas = COUNT_BIG(*), Distintos = COUNT_BIG(DISTINCT CodigoTicket)
FROM dbo.vw_TicketsSlotsBase WHERE Slot = 0
UNION ALL
SELECT 'T4', 'vw_TicketsMesBase mes en curso', COUNT_BIG(*), COUNT_BIG(DISTINCT CodigoTicket)
FROM dbo.vw_TicketsMesBase WHERE Anio = YEAR(GETDATE()) AND Mes = MONTH(GETDATE());
GO

/* T5) Antes / despues, desde las vistas de agregado que lee el tablero.
   Antes: Todos = Total - SorIA, Inc = [Incidencia]. Despues: Todos = Total,
   Inc = [Incidencia] + [SorIA Incidentes]. Requerimientos antes / despues
   sale en T6 (la columna de peticiones lleva tilde y este archivo es ASCII). */
SELECT Seccion = 'T5', Periodo = 'SLOT 0',
       Total = SUM([Total general]),
       Incidencia = SUM(ISNULL([Incidencia], 0)),
       SorIAIncidentes = SUM(ISNULL([SorIA Incidentes], 0)),
       SorIAPeticiones = SUM(ISNULL([SorIA Peticiones], 0)),
       TodosAntes = SUM([Total general]) - SUM(ISNULL([SorIA Incidentes], 0) + ISNULL([SorIA Peticiones], 0)),
       TodosDespues = SUM([Total general]),
       IncAntes = SUM(ISNULL([Incidencia], 0)),
       IncDespues = SUM(ISNULL([Incidencia], 0) + ISNULL([SorIA Incidentes], 0))
FROM dbo.vw_TBSlotCAT WHERE Slot = 0
UNION ALL
SELECT 'T5', 'Mes en curso',
       SUM([Total general]), SUM(ISNULL([Incidencia], 0)), SUM(ISNULL([SorIA Incidentes], 0)), SUM(ISNULL([SorIA Peticiones], 0)),
       SUM([Total general]) - SUM(ISNULL([SorIA Incidentes], 0) + ISNULL([SorIA Peticiones], 0)),
       SUM([Total general]),
       SUM(ISNULL([Incidencia], 0)),
       SUM(ISNULL([Incidencia], 0) + ISNULL([SorIA Incidentes], 0))
FROM dbo.vw_TBMesCAT WHERE Anio = YEAR(GETDATE()) AND Mes = MONTH(GETDATE());
GO

/* T6) Periodo equivalente: los tickets del SLOT 0 contados por tipo en cada vista
   base, sobre los MISMOS CodigoTicket. Esperado: las dos filas iguales. Req
   cuenta 'Peticion de Servicio' con y sin tilde (NCHAR(243) = o con tilde). */
DECLARE @PetTilde nvarchar(40) = N'Petici' + NCHAR(243) + N'n de Servicio';
WITH s AS (SELECT CodigoTicket, TipoTicket FROM dbo.vw_TicketsSlotsBase WHERE Slot = 0),
     m AS (SELECT b.CodigoTicket, b.TipoTicket FROM dbo.vw_TicketsMesBase AS b
           WHERE b.CodigoTicket IN (SELECT CodigoTicket FROM s))
SELECT Seccion = 'T6', Vista = x.Vista,
       Total = COUNT_BIG(*),
       IncAntes = SUM(CASE WHEN x.TipoTicket = N'Incidencia' THEN 1 ELSE 0 END),
       IncDespues = SUM(CASE WHEN x.TipoTicket IN (N'Incidencia', N'SorIA Incidentes') THEN 1 ELSE 0 END),
       ReqAntes = SUM(CASE WHEN x.TipoTicket IN (@PetTilde, N'Peticion de Servicio') THEN 1 ELSE 0 END),
       ReqDespues = SUM(CASE WHEN x.TipoTicket IN (@PetTilde, N'Peticion de Servicio', N'SorIA Peticiones') THEN 1 ELSE 0 END),
       Resto = SUM(CASE WHEN x.TipoTicket IN (N'Incidencia', N'SorIA Incidentes', @PetTilde, N'Peticion de Servicio', N'SorIA Peticiones') THEN 0 ELSE 1 END)
FROM (SELECT Vista = 'SLOT 0 (slots base)', TipoTicket FROM s
      UNION ALL
      SELECT 'Mismos tickets (mes base)', TipoTicket FROM m) AS x
GROUP BY x.Vista;
GO
