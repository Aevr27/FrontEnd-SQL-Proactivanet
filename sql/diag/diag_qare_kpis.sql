/* =========================================================================
   sql/diag/diag_qare_kpis.sql - Denominadores de las cuatro tarjetas de usp_QARE_CalidadCaptura_KPIs
   SOLO LECTURA. Sin DDL ni DML sobre la base; la unica escritura es la
   tabla temporal #Q de la sesion (ver BLOQUE BASE).

   Mide: que campos se llenan juntos, cuantas definiciones posibles hay de
   "sin informacion QARE", que denominadores usa hoy usp_CorreoQARE_KPIs,
   si T = S + I + A cuadra con la clasificacion candidata, y si la falta de
   captura es un flujo (Tipo, Subestado, grupo) o un habito de pocas firmas.

   Las reglas que aparecen aqui son CANDIDATAS para medir, no reglas
   aprobadas. Contexto y resultados: sql/docs/PROPUESTA_qare_tecnicos.md,
   seccion 11. Correr en QA (AZVMBDCENTRALQA / Tickets_Proactivanet) con
   SSMS en cuadricula; la salida trae textos de tickets: no copiarla fuera
   de la red interna.
   ========================================================================= */

SET NOCOUNT ON;

/* ------------------------------------------------------------ BLOQUE BASE
   Identico en diag_qare_kpis / _patrones / _tecnicos / _evidencia /
   _reglas_calidad: si se cambia aqui, cambiarlo en los cinco.

   Ventana fija, la de los diag 1 y 2 (2026-10-29 a 2026-11-27, fin
   inclusivo), para que las cifras de los cinco scripts se puedan comparar
   entre si y con la seccion 4 de la propuesta. Una corrida posterior puede
   traer unos tickets mas del 27-nov (diag 2 vio 9 341 contra 9 310).

   La unica escritura es #Q, tabla temporal de la sesion en tempdb: se llena
   una vez para que todas las secciones clasifiquen igual y se borra al
   final. No toca objetos ni datos de la base. */
DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';

/* Normalizacion. Clave: mayusculas, saltos/tabuladores/NBSP y signos a
   espacio, espacios colapsados. Los acentos no se quitan: se comparan con
   Latin1_General_CI_AI. Es la normalizar() de analisis/motor.js en
   mayusculas (alli: minusculas, sin acentos, todo lo que no sea letra,
   numero o ":" a espacio). Texto: solo blancos normalizados, para mostrar. */
DECLARE @Blancos nvarchar(4)  = NCHAR(13) + NCHAR(10) + NCHAR(9) + NCHAR(160);
DECLARE @B       nvarchar(80) = @Blancos + N'.,;:-_/\()[]{}"''!?*#+=|<>~`^@&%$'
                              + NCHAR(161) + NCHAR(191) + NCHAR(176);  -- signos de apertura y grado, sin depender de la codificacion
DECLARE @BEsp    nvarchar(80) = REPLICATE(N' ', LEN(@B));

/* Listas CANDIDATAS (no aprobadas). Se miden por separado porque el negocio
   puede decidir distinto para cada una (propuesta, 9.4 y 9.5):
     G1 no-respuesta: negacion, afirmacion o relleno sin contenido.
     G2 solo estado:  dice que se resolvio sin decir que se hizo.
     G3 formulario:   respuesta a otra pregunta o frase de plantilla.
   Las claves van ya normalizadas (N/A -> "N A"). */
DECLARE @G TABLE (Clave nvarchar(100) NOT NULL, Lista char(2) NOT NULL);
INSERT @G (Clave, Lista) VALUES
    (N'N A', 'G1'), (N'NA', 'G1'), (N'N', 'G1'), (N'NO', 'G1'), (N'SI', 'G1'), (N'S', 'G1'), (N'X', 'G1'),
    (N'XX', 'G1'), (N'XXX', 'G1'), (N'A', 'G1'), (N'OK', 'G1'), (N'NO APLICA', 'G1'), (N'NINGUNO', 'G1'),
    (N'NINGUNA', 'G1'), (N'NADA', 'G1'), (N'SIN RESPUESTA', 'G1'), (N'NO HAY', 'G1'), (N'SIN COMENTARIOS', 'G1'),
    (N'SIN INFORMACION', 'G1'), (N'SIN DATOS', 'G1'), (N'NULL', 'G1'), (N'PRUEBA', 'G1'), (N'ERROR', 'G1'),
    (N'S N', 'G1'), (N'SN', 'G1'), (N'ND', 'G1'), (N'N D', 'G1'), (N'NO SE', 'G1'), (N'NO APLICA NA', 'G1'),
    (N'RESUELTO', 'G2'), (N'SOLUCIONADO', 'G2'), (N'ATENDIDO', 'G2'), (N'LISTO', 'G2'), (N'CERRADO', 'G2'),
    (N'HECHO', 'G2'), (N'QUEDO', 'G2'), (N'YA QUEDO', 'G2'), (N'CORRECTO', 'G2'), (N'SE ATENDIO', 'G2'),
    (N'SE RESOLVIO', 'G2'), (N'SE SOLUCIONO', 'G2'), (N'INCIDENCIA RESUELTA', 'G2'), (N'TICKET RESUELTO', 'G2'),
    (N'NO SALE ERROR', 'G3'), (N'SIN RESPUESTA DEL USUARIO', 'G3'), (N'SE ANEXA EVIDENCIA', 'G3'),
    (N'NO SE ADJUNTO LO SOLICITADO', 'G3'), (N'SE ADJUNTA EVIDENCIA', 'G3'), (N'VER EVIDENCIA', 'G3'),
    (N'VER ADJUNTO', 'G3'), (N'EN ADJUNTO', 'G3');

/* Raices de verbos de accion y de palabras de problema: HIPOTESIS para medir
   "respuesta incompleta: solo describe el problema o no documenta una
   accion" (mockup de Daniela). Se comparan al inicio de palabra. */
DECLARE @Acc TABLE (Raiz nvarchar(40) NOT NULL);
INSERT @Acc (Raiz) VALUES
    (N'REINICI'), (N'REACTIV'), (N'ACTUALIZ'), (N'INSTAL'), (N'REINSTAL'), (N'CONFIGUR'), (N'OTORG'), (N'ASIGN'),
    (N'CAMBI'), (N'REEMPLAZ'), (N'SUSTITU'), (N'DESBLOQUE'), (N'RESTABLEC'), (N'RESETE'), (N'EJECUT'), (N'CARG'),
    (N'ALTA '), (N'BAJA '), (N'ELIMIN'), (N'BORR'), (N'CORRIG'), (N'REPAR'), (N'LIMPI'), (N'CONECT'),
    (N'HABILIT'), (N'DESHABILIT'), (N'LIBER'), (N'CANCEL'), (N'CREA'), (N'GENER'), (N'REENVI'), (N'REPROCES'),
    (N'DEPUR'), (N'MODIFIC'), (N'AJUST'), (N'SINCRONIZ'), (N'FORMATE'), (N'MIGR'), (N'RESPALD'), (N'RESTAUR'),
    (N'ACTIV'), (N'APLIC'), (N'PROGRAM'), (N'CALIBR'), (N'AGREG'), (N'DESCARG'), (N'ENVI'), (N'REGISTR'),
    (N'INDIC'), (N'CANALIZ'), (N'ESCAL'), (N'VALID'), (N'REVIS'), (N'VERIFIC'), (N'ORIENT'), (N'APOY');
DECLARE @Prob TABLE (Frase nvarchar(40) NOT NULL);
INSERT @Prob (Frase) VALUES
    (N'NO FUNCIONA'), (N'NO PERMITE'), (N'NO PUEDE'), (N'NO CARGA'), (N'NO ENCIENDE'), (N'NO IMPRIME'),
    (N'NO ABRE'), (N'NO DEJA'), (N'NO SALE'), (N'NO HAY'), (N'NO SE PUEDE'), (N'MARCA ERROR'), (N'ERROR'),
    (N'FALLA'), (N'PROBLEMA'), (N'LENTITUD'), (N'INTERMITEN'), (N'SIN SERVICIO'), (N'SIN SISTEMA'), (N'CAIDO');

IF OBJECT_ID(N'tempdb..#Q') IS NOT NULL DROP TABLE #Q;

SELECT x.*,
       /* Clasificacion CANDIDATA, excluyente, gana la primera. Los prefijos dicen
          que tan respaldada esta cada una por los diag 1 y 2:
            S   sin informacion QARE (texto vacio)
            I*  candidatas a "invalida" respaldadas por los ejemplos (basura evidente)
            Q*  dudosas: los ejemplos mezclan basura y respuestas con contenido, o
                son decision de negocio (invalida o incompleta)
            A   resto = analizable candidata
          Ninguna es regla aprobada. */
       Regla = CASE
           WHEN x.HayDesc = 0                          THEN N'S  sin informacion (texto vacio)'
           WHEN x.Letras = 0                           THEN N'I1 sin letras'
           WHEN x.Lista = 'G1'                         THEN N'I2 lista G1 no-respuesta'
           WHEN x.Lista = 'G3'                         THEN N'I3 lista G3 frase de formulario'
           WHEN x.Clave = x.ClaveT AND x.ClaveT <> N'' THEN N'Q1 copia del tipo declarado'
           WHEN x.Lista = 'G2'                         THEN N'Q2 lista G2 solo estado'
           WHEN x.Largo < 10                           THEN N'Q3 menos de 10 caracteres'
           WHEN x.Clave = x.ClaveM AND x.ClaveM <> N'' THEN N'Q4 copia de QA_MensajeError'
           WHEN x.Clave = x.ClaveU AND x.ClaveU <> N'' THEN N'Q5 copia de SolucionUsuario'
           ELSE N'A  resto' END
INTO #Q
FROM (
SELECT q.CodigoTicket, q.FechaFirmaSolucion, Dia = CONVERT(date, q.FechaFirmaSolucion),
       q.Tecnico, q.FirmaSolucion, q.Grupo, q.Categoria, q.Validacion, q.Tipo, q.TipoRelacion, q.Subestado,
       q.IntentosSolucion, HayRevocacion = CASE WHEN NULLIF(LTRIM(RTRIM(q.FirmaCierreRevocacion)), N'') IS NULL THEN 0 ELSE 1 END,
       TipoSolucion = NULLIF(LTRIM(RTRIM(q.QARe_TipoSolucion)), N''),
       Causa     = LEFT(n.TxtC, 200),
       Evidencia = LEFT(n.TxtE, 200),
       Texto     = LEFT(n.Txt, 300),
       Clave  = CONVERT(nvarchar(4000), LEFT(n.Clave, 4000)),
       ClaveU = CONVERT(nvarchar(4000), LEFT(n.ClaveU, 4000)),
       ClaveM = CONVERT(nvarchar(4000), LEFT(n.ClaveM, 4000)),
       ClaveT = CONVERT(nvarchar(4000), LEFT(n.ClaveT, 4000)),
       ClaveC = CONVERT(nvarchar(4000), LEFT(n.ClaveC, 4000)),
       ClaveE = CONVERT(nvarchar(4000), LEFT(n.ClaveE, 4000)),
       HayDesc     = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_DescripcionSolucion)), N'') IS NULL THEN 0 ELSE 1 END,
       HayTipo     = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_TipoSolucion)), N'')        IS NULL THEN 0 ELSE 1 END,
       HayCausa    = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_Causa)), N'')               IS NULL THEN 0 ELSE 1 END,
       HayEvid     = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_Evidencia)), N'')           IS NULL THEN 0 ELSE 1 END,
       HayAplica   = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_AplicaOtrosCasos)), N'')    IS NULL THEN 0 ELSE 1 END,
       HayGenerar  = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_GenerarArticulo)), N'')     IS NULL THEN 0 ELSE 1 END,
       HayVerifico = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_VerificoClasificacion)), N'') IS NULL THEN 0 ELSE 1 END,
       HayConfirmo = CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_UsuarioConfirmo)), N'')     IS NULL THEN 0 ELSE 1 END,
       Letras   = CASE WHEN PATINDEX(N'%[A-Z]%', n.Clave COLLATE Latin1_General_CI_AI) > 0 THEN 1 ELSE 0 END,
       Largo    = LEN(n.Clave),
       Palabras = CASE WHEN n.Clave = N'' THEN 0 ELSE LEN(n.Clave) - LEN(REPLACE(n.Clave, N' ', N'')) + 1 END,
       -- Igual que Analisis (47): NBSP a espacio y recorte; SLA compara exacto.
       EsNoPersona = CASE WHEN EXISTS (SELECT 1 FROM dbo.CatCuentaNoPersona AS c
                                       WHERE c.Habilitado = 1
                                         AND REPLACE(c.Cuenta, NCHAR(160), N' ') = LTRIM(RTRIM(REPLACE(q.Tecnico, NCHAR(160), N' '))))
                          THEN 1 ELSE 0 END,
       EsProveedor = CASE WHEN q.Tecnico LIKE N'%, Proveedor%' OR q.Tecnico LIKE N'Soporte, %' THEN 1 ELSE 0 END,
       Lista = (SELECT TOP (1) g.Lista FROM @G AS g WHERE g.Clave = n.Clave COLLATE Latin1_General_CI_AI),
       Accion = CASE WHEN EXISTS (SELECT 1 FROM @Acc AS a
                                  WHERE (N' ' + n.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + a.Raiz + N'%')
                     THEN 1 ELSE 0 END,
       Problema = CASE WHEN EXISTS (SELECT 1 FROM @Prob AS p
                                    WHERE (N' ' + n.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + p.Frase + N'%')
                       THEN 1 ELSE 0 END
FROM dbo.vw_CorreoQARECierre_Base AS q
CROSS APPLY (SELECT
        tD = TRANSLATE(UPPER(ISNULL(q.QARe_DescripcionSolucion, N'')), @Blancos, N'    '),
        tC = TRANSLATE(UPPER(ISNULL(q.QARe_Causa, N'')),               @Blancos, N'    '),
        tE = TRANSLATE(UPPER(ISNULL(q.QARe_Evidencia, N'')),           @Blancos, N'    '),
        kD = TRANSLATE(UPPER(ISNULL(q.QARe_DescripcionSolucion, N'')), @B, @BEsp),
        kU = TRANSLATE(UPPER(ISNULL(q.SolucionUsuario, N'')),          @B, @BEsp),
        kM = TRANSLATE(UPPER(ISNULL(q.QA_MensajeError, N'')),          @B, @BEsp),
        kT = TRANSLATE(UPPER(ISNULL(q.QARe_TipoSolucion, N'')),        @B, @BEsp),
        kC = TRANSLATE(UPPER(ISNULL(q.QARe_Causa, N'')),               @B, @BEsp),
        kE = TRANSLATE(UPPER(ISNULL(q.QARe_Evidencia, N'')),           @B, @BEsp)) AS a
-- Colapso de espacios: ' ' -> ' '+BEL, BEL+' ' -> '', BEL -> ''.
CROSS APPLY (SELECT
        Txt    = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.tD, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        TxtC   = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.tC, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        TxtE   = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.tE, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        Clave  = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.kD, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        ClaveU = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.kU, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        ClaveM = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.kM, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        ClaveT = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.kT, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        ClaveC = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.kC, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N''))),
        ClaveE = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(a.kE, N' ', N' ' + NCHAR(7)), NCHAR(7) + N' ', N''), NCHAR(7), N'')))) AS n
WHERE q.FechaFirmaSolucion >= @Fi
  AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
) AS x;

/* ------------------------------------------------------------ FIN BLOQUE BASE */

-- ------------------------------------------------------------ 1. Poblacion
-- T de las tarjetas. La TVF de QARE con filtros NULL debe dar lo mismo que
-- la vista: si no, la pestana nueva y la de QARE contarian distinto.
SELECT Seccion = N'1. Poblacion', FechaInicio = @Fi, FechaFin = @Ff,
       Filas = COUNT(*), Tickets = COUNT(DISTINCT CodigoTicket),
       Dias = COUNT(DISTINCT Dia),
       TicketsTVF = (SELECT COUNT(DISTINCT t.CodigoTicket) FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, NULL, NULL, NULL) AS t)
FROM #Q;

-- ------------------------------------------------------------ 2. Que campos se llenan juntos
-- Una letra por campo lleno: T tipo, C causa, E evidencia, D descripcion,
-- A aplica a otros casos, G generar articulo, V verifico clasificacion,
-- U usuario confirmo. Decide que significa "sin informacion QARE".
SELECT Seccion = N'2. Patron de llenado',
       Patron = CONCAT(CASE WHEN HayTipo = 1 THEN N'T' ELSE N'-' END, CASE WHEN HayCausa = 1 THEN N'C' ELSE N'-' END,
                       CASE WHEN HayEvid = 1 THEN N'E' ELSE N'-' END, CASE WHEN HayDesc = 1 THEN N'D' ELSE N'-' END,
                       CASE WHEN HayAplica = 1 THEN N'A' ELSE N'-' END, CASE WHEN HayGenerar = 1 THEN N'G' ELSE N'-' END,
                       CASE WHEN HayVerifico = 1 THEN N'V' ELSE N'-' END, CASE WHEN HayConfirmo = 1 THEN N'U' ELSE N'-' END),
       Tickets = COUNT(*),
       Porcentaje = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(6,2))
FROM #Q
GROUP BY HayTipo, HayCausa, HayEvid, HayDesc, HayAplica, HayGenerar, HayVerifico, HayConfirmo
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 3. Definiciones candidatas de "sin informacion"
-- S1 es la de la tarjeta si "evalua unicamente la pregunta abierta". Las
-- demas se miden para saber cuanto cambia el numero si se elige otra.
SELECT Seccion = N'3. Sin informacion: definiciones', Definicion = d.Definicion, Tickets = d.Tickets,
       DiferenciaContraS1 = d.Tickets - SUM(CASE WHEN d.Definicion LIKE N'S1%' THEN d.Tickets END) OVER ()
FROM (
    SELECT N'S1 texto abierto vacio', SUM(CASE WHEN HayDesc = 0 THEN 1 ELSE 0 END) FROM #Q UNION ALL
    SELECT N'S2 todos los campos QARE vacios', SUM(CASE WHEN HayTipo + HayCausa + HayEvid + HayDesc + HayAplica + HayGenerar + HayVerifico = 0 THEN 1 ELSE 0 END) FROM #Q UNION ALL
    SELECT N'S3 tipo de solucion vacio', SUM(CASE WHEN HayTipo = 0 THEN 1 ELSE 0 END) FROM #Q UNION ALL
    SELECT N'S4 texto vacio pero algun otro campo lleno', SUM(CASE WHEN HayDesc = 0 AND HayTipo + HayCausa + HayEvid + HayAplica + HayGenerar + HayVerifico > 0 THEN 1 ELSE 0 END) FROM #Q UNION ALL
    SELECT N'S5 texto lleno pero sin letras ni numeros', SUM(CASE WHEN HayDesc = 1 AND Clave = N'' THEN 1 ELSE 0 END) FROM #Q
) AS d(Definicion, Tickets)
ORDER BY d.Definicion;

-- ------------------------------------------------------------ 4. Denominadores que ya usa el tablero
-- usp_CorreoQARE_KPIs divide cada % entre los tickets que CONTESTARON esa
-- pregunta, no entre el total. El prototipo de Daniela hace lo mismo:
-- PctNoEvaluable sobre TicketsEvaluados (propuesta 8.1).
SELECT Seccion = N'4. Denominadores existentes',
       TotalTicketsPeriodo = COUNT(*),
       ConRespuestaConfirmacion  = SUM(HayVerifico),
       ConRespuestaReutilizacion = SUM(HayAplica),
       ConRespuestaKB            = SUM(HayGenerar),
       ConTipoSolucion           = SUM(HayTipo),
       ConCausa                  = SUM(HayCausa),
       ConTextoAbierto           = SUM(HayDesc),
       ValidacionIncorrecto      = SUM(CASE WHEN Validacion = N'Incorrecto' THEN 1 ELSE 0 END)
FROM #Q;

-- ------------------------------------------------------------ 5. Cuatro tarjetas con la clasificacion candidata
-- Dos variantes de "invalida" para acotar el rango:
--   minima = I1 + I2 + I3 (basura evidente en los ejemplos del diag 2)
--   maxima = minima + Q1 + Q2 + Q3 (lo dudoso contado como invalido)
-- Comprueba T = S + I + A en cada variante (Cuadra = 1).
;WITH V AS (
    SELECT Variante = N'minima', CodigoTicket,
           Estado = CASE WHEN Regla LIKE N'S%' THEN 'S' WHEN Regla LIKE N'I%' THEN 'I' ELSE 'A' END
    FROM #Q
    UNION ALL
    SELECT N'maxima', CodigoTicket,
           CASE WHEN Regla LIKE N'S%' THEN 'S'
                WHEN Regla LIKE N'I%' OR Regla LIKE N'Q1%' OR Regla LIKE N'Q2%' OR Regla LIKE N'Q3%' THEN 'I'
                ELSE 'A' END
    FROM #Q
)
SELECT Seccion = N'5. Tarjetas candidatas', Variante,
       TotalTickets = COUNT(*),
       SinInformacion = SUM(CASE WHEN Estado = 'S' THEN 1 ELSE 0 END),
       Evaluados = SUM(CASE WHEN Estado <> 'S' THEN 1 ELSE 0 END),
       Invalidas = SUM(CASE WHEN Estado = 'I' THEN 1 ELSE 0 END),
       Analizables = SUM(CASE WHEN Estado = 'A' THEN 1 ELSE 0 END),
       PctInvalidasSobreEvaluados = CAST(100.0 * SUM(CASE WHEN Estado = 'I' THEN 1 ELSE 0 END)
                                         / NULLIF(SUM(CASE WHEN Estado <> 'S' THEN 1 ELSE 0 END), 0) AS decimal(6,2)),
       PctInvalidasSobreTotal = CAST(100.0 * SUM(CASE WHEN Estado = 'I' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS decimal(6,2)),
       Cuadra = CASE WHEN COUNT(*) = SUM(CASE WHEN Estado = 'S' THEN 1 ELSE 0 END)
                                   + SUM(CASE WHEN Estado = 'I' THEN 1 ELSE 0 END)
                                   + SUM(CASE WHEN Estado = 'A' THEN 1 ELSE 0 END) THEN 1 ELSE 0 END
FROM V
GROUP BY Variante
ORDER BY Variante DESC;

-- ------------------------------------------------------------ 6. Estabilidad por dia
-- Si la suma de los dias no da el total, el fin inclusivo o la zona horaria
-- estan mal (prueba 8.3.8 de la propuesta).
SELECT Seccion = N'6. Por dia (variante minima)', Dia,
       Total = COUNT(*),
       SinInformacion = SUM(CASE WHEN Regla LIKE N'S%' THEN 1 ELSE 0 END),
       Invalidas = SUM(CASE WHEN Regla LIKE N'I%' THEN 1 ELSE 0 END),
       Analizables = SUM(CASE WHEN Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' THEN 1 ELSE 0 END),
       PctSinInformacion = CAST(100.0 * SUM(CASE WHEN Regla LIKE N'S%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(6,2))
FROM #Q
GROUP BY Dia
ORDER BY Dia;

-- ------------------------------------------------------------ 7. Sin informacion: es flujo o habito?
-- El diag 2 vio el 97.5 % de los sin captura en cuatro firmas. Si se
-- concentra en un Tipo, TipoRelacion o Subestado, es un flujo donde el
-- formulario QARE no aparece (pendiente 9.14) y quiza no deba contar.
SELECT Seccion = N'7a. Sin informacion por Tipo/TipoRelacion', Tipo, TipoRelacion,
       Tickets = COUNT(*), SinInformacion = SUM(1 - HayDesc),
       Pct = CAST(100.0 * SUM(1 - HayDesc) / COUNT(*) AS decimal(6,2))
FROM #Q
GROUP BY Tipo, TipoRelacion
ORDER BY SinInformacion DESC;

SELECT TOP (25) Seccion = N'7b. Sin informacion por Subestado', Subestado,
       Tickets = COUNT(*), SinInformacion = SUM(1 - HayDesc),
       Pct = CAST(100.0 * SUM(1 - HayDesc) / COUNT(*) AS decimal(6,2))
FROM #Q
GROUP BY Subestado
ORDER BY SinInformacion DESC;

SELECT Seccion = N'7c. Sin informacion por senales de flujo',
       Senal = s.Senal, Tickets = COUNT(*), SinInformacion = SUM(1 - q.HayDesc),
       Pct = CAST(100.0 * SUM(1 - q.HayDesc) / COUNT(*) AS decimal(6,2))
FROM #Q AS q
CROSS APPLY (VALUES
    (CASE WHEN q.EsNoPersona = 1 THEN N'Firma de CatCuentaNoPersona' ELSE N'Firma de persona' END),
    (CASE WHEN q.EsProveedor = 1 THEN N'Firma de proveedor (fuera del catalogo)' ELSE N'Firma sin forma de proveedor' END),
    (CASE WHEN q.HayRevocacion = 1 THEN N'Con FirmaCierreRevocacion' ELSE N'Sin FirmaCierreRevocacion' END),
    (CASE WHEN q.IntentosSolucion > 1 THEN N'Reabierto (IntentosSolucion > 1)' ELSE N'Un solo intento' END),
    (N'Validacion = ' + ISNULL(q.Validacion, N'(NULL)'))) AS s(Senal)
GROUP BY s.Senal
ORDER BY s.Senal;

-- 7d. Grupos con mas sin informacion: si un grupo entero no captura, es su
--     flujo; si solo una persona del grupo, es habito.
SELECT TOP (20) Seccion = N'7d. Sin informacion por grupo', Grupo,
       Tickets = COUNT(*), SinInformacion = SUM(1 - HayDesc),
       Pct = CAST(100.0 * SUM(1 - HayDesc) / COUNT(*) AS decimal(6,2)),
       Tecnicos = COUNT(DISTINCT Tecnico),
       TecnicosConSinInformacion = COUNT(DISTINCT CASE WHEN HayDesc = 0 THEN Tecnico END)
FROM #Q
GROUP BY Grupo
ORDER BY SinInformacion DESC;

-- ------------------------------------------------------------ 8. Por servicio (C1), como filtra QARE
SELECT TOP (30) Seccion = N'8. Por C1', C1 = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(Categoria), N'Sin categoria'),
       Tickets = COUNT(*),
       SinInformacion = SUM(CASE WHEN Regla LIKE N'S%' THEN 1 ELSE 0 END),
       InvalidasMinima = SUM(CASE WHEN Regla LIKE N'I%' THEN 1 ELSE 0 END),
       Analizables = SUM(CASE WHEN Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' THEN 1 ELSE 0 END)
FROM #Q
GROUP BY ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(Categoria), N'Sin categoria')
ORDER BY Tickets DESC;

DROP TABLE #Q;
