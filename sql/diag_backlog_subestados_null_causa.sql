/* =====================================================================================
   diag_backlog_subestados_null_causa.sql  -  SOLO LECTURA (ningun INSERT/UPDATE/DELETE/DDL,
   ni tablas temporales)

   Para que sirve: diag_backlog_subestados.sql (2026-10-19) encontro Subestado NULL
   en dbo.CorreoBacklogSnapshot: 0 en el corte actual, pero miles por corte en los
   del Backfill (2026-01-01 a 2026-08-23), cientos a miles en los del correo del
   2026-08-17 al 2026-08-25, 1-3 por dia del 2026-09-01 al 2026-10-02 y ninguno
   despues. Esto prueba de donde salen, antes de proponer ninguna correccion.

   Hipotesis que se prueban:
     H1 (Backfill)  usp_CorreoBacklog_Backfill arma cortes pasados desde dbo.Tickets
                    con el Subestado de HOY (t.Subestado), no el del dia del corte.
                    Un ticket que ya se cerro hoy no tiene subestado, asi que el
                    corte viejo lo hereda en NULL. Si es asi: (2) los NULL del
                    Backfill son tickets hoy cerrados con Subestado NULL hoy, y (3)
                    dbo.TicketsHist si tenia un subestado vigente ese dia.
     H2 (correo ago) los cortes del correo de agosto se re-escribieron despues
                    -FechaHoraSnapshot posterior al envio- o se tomaron cuando
                    el ETL aun no traia Subestado. (1) lo distingue.
     H3 (sep-oct)   los pocos NULL de septiembre-octubre eran tickets que en ese
                    momento de verdad no tenian subestado en Proactivanet. (4)
                    muestra cada uno con su historia.

   Como correrlo: SSMS, resultados en CUADRICULA. Puede tardar: (2) y (3) recorren
   todos los NULL de la tabla (~1 millon de filas).
   ===================================================================================== */
SET NOCOUNT ON;

/* 1) Cortes con NULL: cuando se escribieron sus filas contra el envio del correo.
      FilasEscritasDespuesDelEnvio > 0 = el corte se re-escribio despues (H2). */
SELECT s.FechaCorte,
       Origen        = CASE WHEN e.FechaCorte IS NULL THEN N'Backfill' ELSE N'PrepararCorte (correo)' END,
       Tickets       = COUNT(*),
       SubestadoNull = SUM(CASE WHEN s.Subestado IS NULL THEN 1 ELSE 0 END),
       SnapshotMin   = MIN(s.FechaHoraSnapshot),
       SnapshotMax   = MAX(s.FechaHoraSnapshot),
       EnvioInicio   = MIN(e.FechaHoraInicio),
       FilasEscritasDespuesDelEnvio = SUM(CASE WHEN e.FechaHoraFin IS NOT NULL
                                                AND s.FechaHoraSnapshot > e.FechaHoraFin THEN 1 ELSE 0 END)
FROM dbo.CorreoBacklogSnapshot AS s
OUTER APPLY (SELECT TOP (1) x.FechaCorte, x.FechaHoraInicio, x.FechaHoraFin
             FROM dbo.CorreoBacklogEjecucion AS x
             WHERE x.FechaCorte = s.FechaCorte
             ORDER BY x.IdEjecucion DESC) AS e
WHERE s.FechaCorte >= '20260810'
GROUP BY s.FechaCorte, CASE WHEN e.FechaCorte IS NULL THEN N'Backfill' ELSE N'PrepararCorte (correo)' END
HAVING SUM(CASE WHEN s.Subestado IS NULL THEN 1 ELSE 0 END) > 0
ORDER BY s.FechaCorte DESC;

/* 2) H1: los NULL contra el estado y subestado de HOY en dbo.Tickets */
SELECT o.Origen,
       EstadoHoy      = ISNULL(t.Estado, N'(no esta en dbo.Tickets)'),
       SubestadoHoyNull = CASE WHEN t.Subestado IS NULL THEN 1 ELSE 0 END,
       EstadoEnCorte  = s.Estado,
       Filas          = COUNT(*)
FROM dbo.CorreoBacklogSnapshot AS s
CROSS APPLY (SELECT Origen = CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogEjecucion AS e
                                                 WHERE e.FechaCorte = s.FechaCorte)
                                    THEN N'PrepararCorte (correo)' ELSE N'Backfill' END) AS o
LEFT JOIN dbo.Tickets AS t ON t.CodigoTicket = s.CodigoTicket
WHERE s.Subestado IS NULL
GROUP BY o.Origen,
         ISNULL(t.Estado, N'(no esta en dbo.Tickets)'),
         CASE WHEN t.Subestado IS NULL THEN 1 ELSE 0 END,
         s.Estado
ORDER BY o.Origen, Filas DESC;

/* 3) H1: el subestado que dbo.TicketsHist tenia vigente al cierre del dia del corte.
      ConHistorialNoNull alto = el dato SI existia ese dia y se perdio al armar el corte. */
SELECT o.Origen,
       FilasNull            = COUNT(*),
       ConHistorialNoNull   = SUM(CASE WHEN h.Subestado IS NOT NULL THEN 1 ELSE 0 END),
       ConHistorialNull     = SUM(CASE WHEN h.TicketHistId IS NOT NULL AND h.Subestado IS NULL THEN 1 ELSE 0 END),
       SinHistorialEseDia   = SUM(CASE WHEN h.TicketHistId IS NULL THEN 1 ELSE 0 END),
       PrimerVigenteDesde   = (SELECT MIN(VigenteDesde) FROM dbo.TicketsHist)
FROM dbo.CorreoBacklogSnapshot AS s
CROSS APPLY (SELECT Origen = CASE WHEN EXISTS (SELECT 1 FROM dbo.CorreoBacklogEjecucion AS e
                                                 WHERE e.FechaCorte = s.FechaCorte)
                                    THEN N'PrepararCorte (correo)' ELSE N'Backfill' END) AS o
OUTER APPLY (SELECT TOP (1) th.TicketHistId, th.Subestado
             FROM dbo.TicketsHist AS th
             WHERE th.CodigoTicket = s.CodigoTicket
               AND th.VigenteDesde < DATEADD(DAY, 1, CAST(s.FechaCorte AS DATETIME2(0)))
               AND (th.VigenteHasta IS NULL OR th.VigenteHasta >= DATEADD(DAY, 1, CAST(s.FechaCorte AS DATETIME2(0))))
             ORDER BY th.VigenteDesde DESC) AS h
WHERE s.Subestado IS NULL
GROUP BY o.Origen;

/* 4) H3: cada NULL desde septiembre, con su historia en dbo.TicketsHist */
SELECT s.FechaCorte, s.CodigoTicket, s.Estado, s.Tipo, s.Grupo, s.FechaRegistro, s.FechaHoraSnapshot,
       EstadoHoy = t.Estado, SubestadoHoy = t.Subestado,
       h.VersionFila, HistEstado = h.Estado, HistSubestado = h.Subestado, h.VigenteDesde, h.VigenteHasta
FROM dbo.CorreoBacklogSnapshot AS s
LEFT JOIN dbo.Tickets AS t ON t.CodigoTicket = s.CodigoTicket
LEFT JOIN dbo.TicketsHist AS h ON h.CodigoTicket = s.CodigoTicket
WHERE s.Subestado IS NULL
  AND s.FechaCorte >= '20260901'
ORDER BY s.FechaCorte DESC, s.CodigoTicket, h.VersionFila;

/* 5) Hoy en la fuente: Subestado NULL en dbo.Tickets por Estado (contexto de H1/H3) */
SELECT t.Estado, SubestadoNull = SUM(CASE WHEN t.Subestado IS NULL THEN 1 ELSE 0 END), Tickets = COUNT(*)
FROM dbo.Tickets AS t
GROUP BY t.Estado
ORDER BY SubestadoNull DESC;
