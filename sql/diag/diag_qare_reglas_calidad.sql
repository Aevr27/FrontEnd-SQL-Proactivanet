/* =========================================================================
   sql/diag/diag_qare_reglas_calidad.sql - Comparacion cuantitativa de las reglas candidatas de calidad del texto
   SOLO LECTURA. Sin DDL ni DML sobre la base; la unica escritura es la
   tabla temporal #Q de la sesion (ver BLOQUE BASE).

   Mide cada criterio por separado (vacio, sin letras, listas de genericos,
   copias de otro campo, largo, una palabra, verbo de accion, palabra de
   problema), sus solapamientos, la cascada candidata, un barrido de umbral
   de largo, candidatos a la lista de genericos y las senales de
   "respuesta incompleta". Amplia la seccion D del diag 2.

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

-- ------------------------------------------------------------ 1. Cada criterio por separado
-- NO excluyente: un ticket cuenta en cada criterio que cumple. Las cinco
-- reglas del diag anterior (vacio, sin letras, generico, copia, < 10) mas
-- las listas separadas y las senales de accion / problema.
SELECT Seccion = N'1. Criterios independientes', c.Criterio,
       Tickets = SUM(c.Cumple),
       PctDelTotal = CAST(100.0 * SUM(c.Cumple) / COUNT(*) AS decimal(6,2)),
       PctDeConTexto = CAST(100.0 * SUM(CASE WHEN q.HayDesc = 1 THEN c.Cumple ELSE 0 END) / NULLIF(SUM(q.HayDesc), 0) AS decimal(6,2)),
       Tecnicos = COUNT(DISTINCT CASE WHEN c.Cumple = 1 THEN q.Tecnico END)
FROM #Q AS q
CROSS APPLY (VALUES
    (N'01 vacio', 1 - q.HayDesc),
    (N'02 sin letras', CASE WHEN q.HayDesc = 1 AND q.Letras = 0 THEN 1 ELSE 0 END),
    (N'03 lista G1 no-respuesta', CASE WHEN q.Lista = 'G1' THEN 1 ELSE 0 END),
    (N'04 lista G2 solo estado', CASE WHEN q.Lista = 'G2' THEN 1 ELSE 0 END),
    (N'05 lista G3 formulario', CASE WHEN q.Lista = 'G3' THEN 1 ELSE 0 END),
    (N'06 copia tipo declarado', CASE WHEN q.HayDesc = 1 AND q.Clave = q.ClaveT THEN 1 ELSE 0 END),
    (N'07 copia SolucionUsuario', CASE WHEN q.HayDesc = 1 AND q.Clave = q.ClaveU THEN 1 ELSE 0 END),
    (N'08 copia QA_MensajeError', CASE WHEN q.HayDesc = 1 AND q.Clave = q.ClaveM THEN 1 ELSE 0 END),
    (N'09 copia QARe_Causa', CASE WHEN q.HayDesc = 1 AND q.Clave = q.ClaveC THEN 1 ELSE 0 END),
    (N'10 menos de 10 caracteres', CASE WHEN q.HayDesc = 1 AND q.Largo < 10 THEN 1 ELSE 0 END),
    (N'11 una sola palabra', CASE WHEN q.Palabras = 1 THEN 1 ELSE 0 END),
    (N'12 con verbo de accion', CASE WHEN q.HayDesc = 1 THEN q.Accion ELSE 0 END),
    (N'13 con palabra de problema', CASE WHEN q.HayDesc = 1 THEN q.Problema ELSE 0 END),
    (N'14 problema sin accion', CASE WHEN q.HayDesc = 1 AND q.Problema = 1 AND q.Accion = 0 THEN 1 ELSE 0 END)) AS c(Criterio, Cumple)
GROUP BY c.Criterio
ORDER BY c.Criterio;

-- ------------------------------------------------------------ 2. Solapamientos
-- Cuantos tickets cumplen dos criterios a la vez. Si "menos de 10" casi
-- siempre es tambien "sin letras" o "generico", no aporta; lo que aporta es
-- lo que cae SOLO en el.
;WITH C AS (
    SELECT q.CodigoTicket, c.Criterio
    FROM #Q AS q
    CROSS APPLY (VALUES
        (N'sin letras', CASE WHEN q.HayDesc = 1 AND q.Letras = 0 THEN 1 ELSE 0 END),
        (N'G1', CASE WHEN q.Lista = 'G1' THEN 1 ELSE 0 END),
        (N'G2', CASE WHEN q.Lista = 'G2' THEN 1 ELSE 0 END),
        (N'G3', CASE WHEN q.Lista = 'G3' THEN 1 ELSE 0 END),
        (N'copia tipo', CASE WHEN q.HayDesc = 1 AND q.Clave = q.ClaveT THEN 1 ELSE 0 END),
        (N'copia solucion usuario', CASE WHEN q.HayDesc = 1 AND q.Clave = q.ClaveU THEN 1 ELSE 0 END),
        (N'copia mensaje error', CASE WHEN q.HayDesc = 1 AND q.Clave = q.ClaveM THEN 1 ELSE 0 END),
        (N'< 10', CASE WHEN q.HayDesc = 1 AND q.Largo < 10 THEN 1 ELSE 0 END)) AS c(Criterio, Cumple)
    WHERE c.Cumple = 1
)
SELECT Seccion = N'2. Solapamientos', A = a.Criterio, B = b.Criterio, Tickets = COUNT(*)
FROM C AS a
JOIN C AS b ON b.CodigoTicket = a.CodigoTicket AND b.Criterio > a.Criterio
GROUP BY a.Criterio, b.Criterio
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 3. Cascada candidata
-- La del bloque base. Comparar con D1 del diag 2: I1+I2+I3 deberia dar un
-- poco mas que R1+R2 (3 287) porque la normalizacion junta variantes.
SELECT Seccion = N'3. Cascada candidata', Regla, Tickets = COUNT(*),
       PctDelTotal = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(6,2)),
       Tecnicos = COUNT(DISTINCT Tecnico),
       ConVerboAccion = SUM(Accion)
FROM #Q
GROUP BY Regla
ORDER BY Regla;

-- 3b. Ejemplos de cada escalon de la cascada (textos mas repetidos).
;WITH E AS (
    SELECT Regla, Clave = LEFT(Clave, 120) COLLATE Latin1_General_CI_AI, Tickets = COUNT(*),
           Rk = ROW_NUMBER() OVER (PARTITION BY Regla ORDER BY COUNT(*) DESC, LEFT(Clave, 120) COLLATE Latin1_General_CI_AI)
    FROM #Q
    WHERE Regla NOT LIKE N'S%'
    GROUP BY Regla, LEFT(Clave, 120) COLLATE Latin1_General_CI_AI
)
SELECT Seccion = N'3b. Ejemplos por escalon', Regla, Clave, Tickets
FROM E WHERE Rk <= 20
ORDER BY Regla, Rk;

-- ------------------------------------------------------------ 4. Barrido de largo
-- Para cada umbral N: cuantos textos con menos de N caracteres son basura
-- ya detectada (sin letras o lista G1/G3) y cuantos quedarian marcados SOLO
-- por el largo. Si no hay un N donde lo segundo sea casi cero, el largo no
-- sirve como regla.
;WITH N AS (SELECT n FROM (VALUES (3), (4), (5), (6), (8), (10), (12), (15), (20), (25), (30)) AS v(n))
SELECT Seccion = N'4. Barrido de largo', Umbral = N.n,
       MenoresQueN = SUM(CASE WHEN q.HayDesc = 1 AND q.Largo < N.n THEN 1 ELSE 0 END),
       YaBasura = SUM(CASE WHEN q.HayDesc = 1 AND q.Largo < N.n AND (q.Letras = 0 OR q.Lista IN ('G1', 'G3')) THEN 1 ELSE 0 END),
       SoloPorLargo = SUM(CASE WHEN q.HayDesc = 1 AND q.Largo < N.n AND q.Letras = 1 AND ISNULL(q.Lista, '') NOT IN ('G1', 'G3') THEN 1 ELSE 0 END),
       SoloPorLargoConVerbo = SUM(CASE WHEN q.HayDesc = 1 AND q.Largo < N.n AND q.Letras = 1 AND ISNULL(q.Lista, '') NOT IN ('G1', 'G3') THEN q.Accion ELSE 0 END)
FROM N
CROSS JOIN #Q AS q
GROUP BY N.n
ORDER BY N.n;

-- 4b. Cortos con letras que ninguna lista atrapa: la evidencia de que "menos
--     de 10" se come respuestas con significado (REINICIO, PINPAD...).
SELECT TOP (60) Seccion = N'4b. Cortos fuera de listas', Clave = Clave COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*), Tecnicos = COUNT(DISTINCT Tecnico), ConVerbo = MAX(Accion)
FROM #Q
WHERE HayDesc = 1 AND Largo < 10 AND Letras = 1 AND ISNULL(Lista, '') NOT IN ('G1', 'G3')
GROUP BY Clave COLLATE Latin1_General_CI_AI
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 5. Candidatos a la lista de genericos
-- Textos cortos (hasta 3 palabras), repetidos por varios tecnicos y que NO
-- estan en ninguna lista. El negocio decide cuales son genericos; aqui solo
-- se ordenan por evidencia.
SELECT TOP (80) Seccion = N'5. Candidatos a generico', Clave = Clave COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*), Tecnicos = COUNT(DISTINCT Tecnico), Grupos = COUNT(DISTINCT Grupo),
       ConVerbo = MAX(Accion), ConProblema = MAX(Problema)
FROM #Q
WHERE HayDesc = 1 AND Letras = 1 AND Lista IS NULL AND Palabras <= 3
GROUP BY Clave COLLATE Latin1_General_CI_AI
HAVING COUNT(*) >= 5 AND COUNT(DISTINCT Tecnico) >= 2
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 6. "Respuesta incompleta"
-- Mockup: "solo describe el problema o no documenta una accion". Dos
-- senales candidatas entre los analizables (A y Q*): sin verbo de accion y
-- con palabra de problema. Cuantos y como se ven.
SELECT Seccion = N'6a. Senales de incompleta (analizables)',
       Analizables = COUNT(*),
       ConVerbo = SUM(Accion),
       SinVerbo = SUM(1 - Accion),
       SinVerboConProblema = SUM(CASE WHEN Accion = 0 AND Problema = 1 THEN 1 ELSE 0 END),
       SinVerboSinProblema = SUM(CASE WHEN Accion = 0 AND Problema = 0 THEN 1 ELSE 0 END),
       ConVerboYProblema = SUM(CASE WHEN Accion = 1 AND Problema = 1 THEN 1 ELSE 0 END)
FROM #Q
WHERE Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%';

;WITH E AS (
    SELECT Grupo = CASE WHEN Accion = 0 AND Problema = 1 THEN N'sin verbo, con problema'
                        WHEN Accion = 0 THEN N'sin verbo, sin problema'
                        WHEN Problema = 1 THEN N'con verbo y problema' END,
           Clave = LEFT(Clave, 120) COLLATE Latin1_General_CI_AI
    FROM #Q
    WHERE Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' AND (Accion = 0 OR Problema = 1)
), R AS (
    SELECT Grupo, Clave, Tickets = COUNT(*),
           Rk = ROW_NUMBER() OVER (PARTITION BY Grupo ORDER BY COUNT(*) DESC, Clave)
    FROM E GROUP BY Grupo, Clave
)
SELECT Seccion = N'6b. Ejemplos de incompleta candidata', Grupo, Clave, Tickets
FROM R WHERE Rk <= 25
ORDER BY Grupo, Rk;

-- 6c. Frases de cierre sin accion que ya se vieron en el grupo Z del diag 2
--     y en los motivos genericos de AnalisisRegla ("sin respuesta").
SELECT Seccion = N'6c. Frases de cierre sin accion', f.Frase, Tickets = COUNT(q.CodigoTicket)
FROM (VALUES (N'SE BRINDA CONTACTO'), (N'CONFIRMAN EL CIERRE'), (N'CONFIRMA EL CIERRE'), (N'INCIDENCIA GENERAL'),
             (N'SE DAN INDICACIONES'), (N'SE DA INDICACIONES'), (N'SIN RESPUESTA'), (N'NO SE OBTUVO RESPUESTA'),
             (N'NO SE RECIBIO RESPUESTA'), (N'SE CIERRA'), (N'SE CANALIZA'), (N'SE ESCALA'), (N'DUPLICADO'),
             (N'YA FUNCIONA'), (N'FUNCIONA CORRECTAMENTE'), (N'SE VALIDA'), (N'SE REVISA')) AS f(Frase)
LEFT JOIN #Q AS q ON (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + f.Frase + N'%'
                 AND q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
GROUP BY f.Frase
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 7. Estabilidad semanal
-- Si el % de cada escalon cambia mucho entre semanas, una lista fija se va
-- a desactualizar; si es estable, se puede revisar por periodo.
SELECT Seccion = N'7. Por semana', Semana = DATEADD(DAY, -((DATEPART(WEEKDAY, Dia) + @@DATEFIRST - 2) % 7), Dia),
       Total = COUNT(*),
       PctS = CAST(100.0 * SUM(CASE WHEN Regla LIKE N'S%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(6,2)),
       PctI = CAST(100.0 * SUM(CASE WHEN Regla LIKE N'I%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(6,2)),
       PctQ = CAST(100.0 * SUM(CASE WHEN Regla LIKE N'Q%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(6,2)),
       PctA = CAST(100.0 * SUM(CASE WHEN Regla LIKE N'A%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(6,2))
FROM #Q
GROUP BY DATEADD(DAY, -((DATEPART(WEEKDAY, Dia) + @@DATEFIRST - 2) % 7), Dia)
ORDER BY Semana;

DROP TABLE #Q;
