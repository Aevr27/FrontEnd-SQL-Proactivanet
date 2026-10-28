/* =====================================================================================
   diag_tickets_reduce_redondeo.sql  -  SOLO LECTURA (ningun INSERT/UPDATE/DELETE/DDL,
   ningun EXEC, ninguna tabla temporal ni variable de tabla: solo SELECT sobre
   OBJECT_DEFINITION, HASHBYTES y sys.objects). Base: Tickets_Proactivanet.

   Para que sirve (2026-10-28): saber con que redondeo calcula HOY la base los
   Tickets a reducir, antes de afirmar que el navegador (FLOOR: ticketsDe /
   MetaCategoria) y la base coinciden. La regla decidida es FLOOR.

     adm.usp_GestionAdmin_TicketsReduce   lo que guarda Crear / Modificar /
                                          aplicar una solicitud.
       sql/18 = ROUND(..., 0)   hash 0xDCDAE267...1B46
       sql/33 = FLOOR(...)      hash 0x41356110...949F   (propuesta, sin aplicar
                                                          segun el repositorio)
     dbo.usp_Exp_CalcularTicketsReduce    la foto diaria (dbo.ExpTicketsReduce,
                                          script 65 del repo de integracion; su
                                          cuerpo no esta en el repositorio).

   Hash: la regla de sql/20 a 33 y del diag ADM_04 sec 11 (SHA2_256 de
   OBJECT_DEFINITION sin espacios, tabs ni saltos de linea).

   QUE DEVUELVE
     1) Por procedimiento: si existe, su hash, a que revision corresponde
        (sql/18 | sql/33 | OTRA), si su texto tiene ROUND( / FLOOR( / CEILING(
        y su fecha de modificacion.
     2) Los fragmentos del texto donde aparece cada funcion de redondeo (hasta
        200 caracteres alrededor), para leer la expresion exacta.

   Que se espera: si 1) dice 'sql/18' y UsaRound = 1, la base guarda ROUND y NO
   coincide con el navegador en los medios (7 x 50% = 3.5: base 4, pantalla 3).
   ===================================================================================== */
SET NOCOUNT ON;

/* 1) Resumen por procedimiento */
SELECT p.Objeto,
       Existe     = CASE WHEN OBJECT_ID(p.Objeto, N'P') IS NULL THEN 0 ELSE 1 END,
       Hash       = CONVERT(varchar(66), h.Hash, 1),
       Revision   = CASE WHEN p.Objeto <> N'adm.usp_GestionAdmin_TicketsReduce' THEN N'(sin revisiones conocidas)'
                         WHEN h.Hash = 0xDCDAE267E6ABE7243A823EAA02FC069983381079CB0AC9E7B46219EF9D861B46 THEN N'sql/18 (ROUND)'
                         WHEN h.Hash = 0x41356110A3825747DFA0326229DADAE2FE9F21560FA81ADB4873DC8F73A1949F THEN N'sql/33 (FLOOR)'
                         WHEN h.Hash IS NULL THEN N'(no existe o sin permiso de ver la definicion)'
                         ELSE N'OTRA: revisar' END,
       UsaRound   = CASE WHEN d.Def LIKE N'%ROUND(%'   THEN 1 ELSE 0 END,
       UsaFloor   = CASE WHEN d.Def LIKE N'%FLOOR(%'   THEN 1 ELSE 0 END,
       UsaCeiling = CASE WHEN d.Def LIKE N'%CEILING(%' THEN 1 ELSE 0 END,
       Modificado = o.modify_date,
       Largo      = LEN(d.Def)
FROM (VALUES (N'adm.usp_GestionAdmin_TicketsReduce'), (N'dbo.usp_Exp_CalcularTicketsReduce')) AS p (Objeto)
OUTER APPLY (SELECT Def = OBJECT_DEFINITION(OBJECT_ID(p.Objeto, N'P'))) AS d
OUTER APPLY (SELECT Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(d.Def, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h
LEFT JOIN sys.objects AS o ON o.object_id = OBJECT_ID(p.Objeto, N'P');

/* 2) Donde aparece cada redondeo (texto alrededor) */
SELECT p.Objeto, f.Funcion,
       Fragmento = SUBSTRING(d.Def, CASE WHEN CHARINDEX(f.Funcion, d.Def) > 100 THEN CHARINDEX(f.Funcion, d.Def) - 100 ELSE 1 END, 200)
FROM (VALUES (N'adm.usp_GestionAdmin_TicketsReduce'), (N'dbo.usp_Exp_CalcularTicketsReduce')) AS p (Objeto)
CROSS APPLY (SELECT Def = OBJECT_DEFINITION(OBJECT_ID(p.Objeto, N'P'))) AS d
CROSS APPLY (VALUES (N'ROUND('), (N'FLOOR('), (N'CEILING(')) AS f (Funcion)
WHERE d.Def IS NOT NULL AND CHARINDEX(f.Funcion, d.Def) > 0;

/* 3) Definicion completa de cada procedimiento (NULL = no existe o sin permiso VIEW DEFINITION) */
SELECT p.Objeto, Definicion = OBJECT_DEFINITION(OBJECT_ID(p.Objeto, N'P'))
FROM (VALUES (N'adm.usp_GestionAdmin_TicketsReduce'), (N'dbo.usp_Exp_CalcularTicketsReduce')) AS p (Objeto);
