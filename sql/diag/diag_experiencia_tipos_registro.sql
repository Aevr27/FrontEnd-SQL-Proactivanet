/* =====================================================================
   DIAGNOSTICO -- selector Todos / Incidentes / Requerimientos (Experiencia)
   ExperienciaQueries.LeerVolumen -> vol_slot / vol_mes / vol_tipo

   SOLO LECTURA. Ningun INSERT/UPDATE/DELETE/MERGE/TRUNCATE ni DDL.
   Correr en la VM contra Tickets_Proactivanet.

   Definicion (script "Descargar script v2 usando vw_Tickets.sql"):
     vw_TBSlotCAT = GROUP BY Slot, CategoriaV2, Aplica, TipoRelacion
       [Incidencia]            SUM(TipoTicket = 'Incidencia')
       [Petición de Servicio]  SUM(TipoTicket IN ('Petición de Servicio',
                                                  'Peticion de Servicio'))
       [SorIA Peticiones]      SUM(TipoTicket = 'SorIA Peticiones')
       [SorIA Incidentes]      SUM(TipoTicket = 'SorIA Incidentes')
       [Total general]         COUNT_BIG(*)  -- de ESA fila, no un total
     TipoTicket = ISNULL(NULLIF(TRIM(vw_Tickets.Tipo), ''), 'Sin tipo')

   Que contesta:
     1) que valores de Tipo existen y en que columna cae cada uno
        (los que no caen en ninguna solo cuentan en Todos);
     2) granularidad: ninguna llave (Slot, Categoria V2, Aplica, Tipo
        relacion) se repite -no hay filas de total ni de subtotal-;
     3) por slot: Todos, Incidentes, Requerimientos, SorIA y resto, y que
        Todos = suma de las cinco partes;
     4) que la vista cuadra ticket por ticket con su base;
     5) lo mismo para vw_TBMesCAT en el año en curso.
   ===================================================================== */

SET NOCOUNT ON;

DECLARE @Anio INT = YEAR(GETDATE());


/* 1) Valores de Tipo en la ventana de slots ---------------------------- */
SELECT Prueba   = '1 Tipos',
       TipoTicket,
       Columna  = CASE
                    WHEN TipoTicket = N'Incidencia' THEN 'Incidentes'
                    WHEN TipoTicket IN (N'Petición de Servicio', N'Peticion de Servicio') THEN 'Requerimientos'
                    WHEN TipoTicket IN (N'SorIA Peticiones', N'SorIA Incidentes') THEN 'Solo Todos (SorIA)'
                    ELSE 'Solo Todos (sin columna)'
                  END,
       Tickets  = COUNT_BIG(*)
FROM dbo.vw_TicketsSlotsBase
GROUP BY TipoTicket
ORDER BY Tickets DESC;


/* 2) Granularidad: debe salir 0 filas ---------------------------------- */
SELECT Prueba = '2 Llave repetida (esperado: ninguna fila)',
       Slot, [Categoria V2], Aplica, [Tipo relación], Filas = COUNT(*)
FROM dbo.vw_TBSlotCAT
GROUP BY Slot, [Categoria V2], Aplica, [Tipo relación]
HAVING COUNT(*) > 1;


/* 3) Totales por slot --------------------------------------------------- */
SELECT Prueba          = '3 Slot',
       Slot,
       Todos           = SUM([Total general]),
       Incidentes      = SUM(ISNULL([Incidencia], 0)),
       Requerimientos  = SUM(ISNULL([Petición de Servicio], 0)),
       SorIA           = SUM(ISNULL([SorIA Peticiones], 0) + ISNULL([SorIA Incidentes], 0)),
       Resto           = SUM([Total general]
                             - ISNULL([Incidencia], 0) - ISNULL([Petición de Servicio], 0)
                             - ISNULL([SorIA Peticiones], 0) - ISNULL([SorIA Incidentes], 0)),
       FilasImposibles = SUM(CASE WHEN ISNULL([Incidencia], 0) + ISNULL([Petición de Servicio], 0)
                                       > [Total general] THEN 1 ELSE 0 END)   -- esperado 0
FROM dbo.vw_TBSlotCAT
GROUP BY Slot
ORDER BY Slot;


/* 4) Vista contra su base, por slot: Diferencia esperada 0 -------------- */
SELECT Prueba      = '4 Vista vs base',
       b.Slot,
       Base        = b.Tickets,
       Vista       = v.Todos,
       Diferencia  = b.Tickets - ISNULL(v.Todos, 0),
       BaseInc     = b.Inc,
       VistaInc    = v.Inc,
       BaseReq     = b.Req,
       VistaReq    = v.Req
FROM (SELECT Slot, Tickets = COUNT_BIG(*),
             Inc = SUM(CASE WHEN TipoTicket = N'Incidencia' THEN 1 ELSE 0 END),
             Req = SUM(CASE WHEN TipoTicket IN (N'Petición de Servicio', N'Peticion de Servicio') THEN 1 ELSE 0 END)
      FROM dbo.vw_TicketsSlotsBase GROUP BY Slot) AS b
LEFT JOIN (SELECT Slot, Todos = SUM([Total general]),
                  Inc = SUM(ISNULL([Incidencia], 0)), Req = SUM(ISNULL([Petición de Servicio], 0))
           FROM dbo.vw_TBSlotCAT GROUP BY Slot) AS v
       ON v.Slot = b.Slot
ORDER BY b.Slot;


/* 5) Mes calendario del año en curso ----------------------------------- */
SELECT Prueba          = '5 Mes',
       Mes,
       Todos           = SUM([Total general]),
       Incidentes      = SUM(ISNULL([Incidencia], 0)),
       Requerimientos  = SUM(ISNULL([Petición de Servicio], 0)),
       Resto           = SUM([Total general] - ISNULL([Incidencia], 0) - ISNULL([Petición de Servicio], 0))
FROM dbo.vw_TBMesCAT
WHERE Anio = @Anio
GROUP BY Mes
ORDER BY Mes;
