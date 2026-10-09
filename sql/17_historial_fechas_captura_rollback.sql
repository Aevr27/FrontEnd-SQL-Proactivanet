/* =========================================================================
   sql/17_historial_fechas_captura_rollback.sql - Deshace
   sql/17_historial_fechas_captura.sql.

   Paso 1 (siempre): quita dbo.trg_Problem_FechaEvento. La carga del Excel
   vuelve a ser exactamente la de antes. Los eventos ya guardados se quedan.

   Paso 2 (solo si se decide): borrar la linea base ('B'). Va comentado.
   Los cambios capturados ('I'/'U' posteriores a la importacion) NO se
   pueden regenerar: el valor anterior ya no existe en dbo.Problem.

   COMO CORRERLO: SSMS, base Tickets_Proactivanet, F5.
   ========================================================================= */
SET NOCOUNT ON;

DROP TRIGGER IF EXISTS dbo.trg_Problem_FechaEvento;

SELECT TriggerExiste = CASE WHEN OBJECT_ID(N'dbo.trg_Problem_FechaEvento', N'TR') IS NULL THEN 0 ELSE 1 END,
       FilasPorOperacion = (SELECT STRING_AGG(CONCAT(Operacion, '=', n), ', ')
                            FROM (SELECT Operacion, n = COUNT(*) FROM dbo.ProblemFechaEvento GROUP BY Operacion) AS x);

-- Paso 2 (opcional, borra la linea base):
-- DELETE FROM dbo.ProblemFechaEvento WHERE Operacion = 'B';
