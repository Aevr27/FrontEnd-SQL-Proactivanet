/* =====================================================================================
   diag_tickets_reduce_foto.sql  -  SOLO LECTURA (ningun INSERT/UPDATE/DELETE/DDL)

   Para que sirve: ExperienciaQueries.LeerIniciativas usa la foto diaria
   dbo.ExpTicketsReduce (script 65) solo si su Pct es el % actual de la fila
   (dbo.ProblemCategoria.PctDisminucion); si no, usa ProblemCategoria.TicketsReduce,
   que Admin recalcula al cambiar el %. Esto confirma, antes de desplegar, que
   ExpTicketsReduce.Pct guarda el MISMO valor (fraccion 0-1, decimal(9,4)) y no
   un % x 100 o topado: si no fuera asi, el registro dejaria de usar la foto.

   Esperado: Iguales = FilasFoto - CambiadasDespues (las que Admin cambio desde
   el ultimo calculo); PctMayorQue1 = 0; Distintas listadas = solo editadas.
   ===================================================================================== */
SET NOCOUNT ON;

/* 1) Resumen */
SELECT FilasFoto        = COUNT(*),
       Iguales          = SUM(CASE WHEN tr.Pct = pc.PctDisminucion
                                     OR (tr.Pct IS NULL AND pc.PctDisminucion IS NULL) THEN 1 ELSE 0 END),
       Distintas        = SUM(CASE WHEN tr.Pct = pc.PctDisminucion
                                     OR (tr.Pct IS NULL AND pc.PctDisminucion IS NULL) THEN 0 ELSE 1 END),
       PctFotoMayorQue1 = SUM(CASE WHEN tr.Pct > 1 THEN 1 ELSE 0 END),
       PctFilaMayorQue1 = SUM(CASE WHEN pc.PctDisminucion > 1 THEN 1 ELSE 0 END),
       UltimoCalculo    = MAX(tr.FechaCalculo)
FROM dbo.ExpTicketsReduce AS tr
INNER JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = tr.Codigo AND pc.Categoria = tr.Categoria
WHERE pc.VigenteEnOrigen = 1;

/* 2) Las distintas: deberian ser solo las que Admin modifico desde el calculo */
SELECT TOP (50) tr.Codigo, tr.Categoria,
       PctFoto = tr.Pct, PctFila = pc.PctDisminucion,
       TrFoto = tr.TicketsReduce, TrFila = pc.TicketsReduce,
       tr.Volumen30, tr.FechaCalculo,
       Protegida = CASE WHEN OBJECT_ID(N'adm.IniciativaProtegida', N'U') IS NULL THEN NULL
                        WHEN EXISTS (SELECT 1 FROM adm.IniciativaProtegida AS ip WHERE ip.Codigo = tr.Codigo) THEN 1 ELSE 0 END
FROM dbo.ExpTicketsReduce AS tr
INNER JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = tr.Codigo AND pc.Categoria = tr.Categoria
WHERE pc.VigenteEnOrigen = 1
  AND NOT (tr.Pct = pc.PctDisminucion OR (tr.Pct IS NULL AND pc.PctDisminucion IS NULL))
ORDER BY tr.Codigo, tr.Categoria;
