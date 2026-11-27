/* =========================================================================
   sql/diag/diag_qare_evidencia.sql - Columnas disponibles y ejemplos de evidencia para usp_QARE_DetalleEvidencia
   SOLO LECTURA. Sin DDL ni DML sobre la base; la unica escritura es la
   tabla temporal #Q de la sesion (ver BLOQUE BASE).

   Mide: que las 12 columnas de origen del detalle de Daniela existen, el
   llenado de todas las columnas de la vista, los literales de las
   respuestas cerradas, que trae QARe_Evidencia, cuanto repite el texto a
   los campos declarados, y una muestra de cinco tickets por regla
   candidata (sin nombre de tecnico).

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

-- ------------------------------------------------------------ 1. Columnas del contrato de Daniela
-- Las 14 columnas de su salida (propuesta 3.5). Las 12 de origen deben
-- existir en la vista; EstadoDescripcionVisual y ClasificacionRespuesta son
-- calculadas y no deben existir.
SELECT Seccion = N'1. Columnas del detalle', c.Columna, c.Resalte,
       EnVistaQARE = CASE WHEN COL_LENGTH(N'dbo.vw_CorreoQARECierre_Base', c.Columna) IS NULL THEN 0 ELSE 1 END
FROM (VALUES (1, N'CodigoTicket', N'amarillo'), (2, N'FechaFirmaSolucion', N'verde'), (3, N'FirmaSolucion', N'verde'),
             (4, N'Grupo', N'verde'), (5, N'Categoria', N'verde'), (6, N'Validacion', N'verde'),
             (7, N'QARe_Causa', N'amarillo'), (8, N'QARe_AplicaOtrosCasos', N'amarillo'),
             (9, N'QARe_GenerarArticulo', N'amarillo'), (10, N'QARe_VerificoClasificacion', N'amarillo'),
             (11, N'QARe_TipoSolucion', N'amarillo'), (12, N'QARe_DescripcionSolucion', N'amarillo'),
             (13, N'EstadoDescripcionVisual', N'amarillo'), (14, N'ClasificacionRespuesta', N'amarillo')) AS c(n, Columna, Resalte)
ORDER BY c.n;

-- ------------------------------------------------------------ 2. Perfil de todas las columnas de la vista
-- Llenado, distintos y largo maximo. Las columnas casi vacias no sirven para
-- "Contexto y trazabilidad"; las llenas si. Nombres y textos no salen: solo
-- conteos.
;WITH V AS (
    SELECT q.*
    FROM dbo.vw_CorreoQARECierre_Base AS q
    WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
)
SELECT Seccion = N'2. Perfil de columnas', x.Columna,
       Llenos = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(x.Valor)), N'') IS NULL THEN 0 ELSE 1 END),
       PctLleno = CAST(100.0 * SUM(CASE WHEN NULLIF(LTRIM(RTRIM(x.Valor)), N'') IS NULL THEN 0 ELSE 1 END) / COUNT(*) AS decimal(6,2)),
       Distintos = COUNT(DISTINCT x.Valor),
       LargoMax = MAX(LEN(x.Valor))
FROM V
CROSS APPLY (VALUES
    (N'Tipo', CONVERT(nvarchar(4000), V.Tipo)), (N'TipoRelacion', V.TipoRelacion), (N'Estado', V.Estado),
    (N'Subestado', V.Subestado), (N'Categoria', V.Categoria), (N'Grupo', V.Grupo), (N'Tecnico', V.Tecnico),
    (N'Cliente', V.Cliente), (N'Sucursal', V.Sucursal), (N'Tienda', V.Tienda), (N'Titulo', CONVERT(nvarchar(4000), LEFT(V.Titulo, 4000))),
    (N'Prioridad', V.Prioridad), (N'Descripcion', CONVERT(nvarchar(4000), LEFT(V.Descripcion, 4000))), (N'SolucionUsuario', CONVERT(nvarchar(4000), LEFT(V.SolucionUsuario, 4000))),
    (N'FechaEstimadaResolucion', CONVERT(nvarchar(30), V.FechaEstimadaResolucion, 120)),
    (N'FechaFirmaCierre', CONVERT(nvarchar(30), V.FechaFirmaCierre, 120)),
    (N'FirmaCierreRevocacion', V.FirmaCierreRevocacion), (N'FirmaSolucion', V.FirmaSolucion),
    (N'ResponsableUltimaModificacion', V.ResponsableUltimaModificacion), (N'NotificadoPor', V.NotificadoPor),
    (N'TiempoResolucion', V.TiempoResolucion), (N'IntentosSolucion', CONVERT(nvarchar(20), V.IntentosSolucion)),
    (N'ReasignacionesGrupo', CONVERT(nvarchar(20), V.ReasignacionesGrupo)), (N'Caducada', CONVERT(nvarchar(5), V.Caducada)),
    (N'RegistradoPor', V.RegistradoPor), (N'QA_MensajeError', CONVERT(nvarchar(4000), LEFT(V.QA_MensajeError, 4000))),
    (N'QA_Frecuencia', V.QA_Frecuencia), (N'QA_Aplicacion', V.QA_Aplicacion), (N'QA_PasoAPaso', CONVERT(nvarchar(4000), LEFT(V.QA_PasoAPaso, 4000))),
    (N'QARe_Causa', CONVERT(nvarchar(4000), LEFT(V.QARe_Causa, 4000))), (N'QARe_UsuarioConfirmo', V.QARe_UsuarioConfirmo),
    (N'QARe_AplicaOtrosCasos', V.QARe_AplicaOtrosCasos), (N'QARe_GenerarArticulo', V.QARe_GenerarArticulo),
    (N'QARe_VerificoClasificacion', V.QARe_VerificoClasificacion), (N'QARe_Evidencia', CONVERT(nvarchar(4000), LEFT(V.QARe_Evidencia, 4000))),
    (N'QARe_DescripcionSolucion', CONVERT(nvarchar(4000), LEFT(V.QARe_DescripcionSolucion, 4000))), (N'QARe_TipoSolucion', V.QARe_TipoSolucion),
    (N'GrupoCorrecto', V.GrupoCorrecto), (N'Validacion', V.Validacion)) AS x(Columna, Valor)
GROUP BY x.Columna
ORDER BY x.Columna;

-- ------------------------------------------------------------ 3. Literales de las respuestas cerradas
-- Valores exactos que veria la tabla (Si/No/NULL...), para que el frontend y
-- cualquier regla comparen contra lo que realmente viene.
SELECT Seccion = N'3. Literales', x.Campo, Valor = ISNULL(x.Valor, N'(NULL)'), Tickets = COUNT(*)
FROM dbo.vw_CorreoQARECierre_Base AS q
CROSS APPLY (VALUES (N'QARe_AplicaOtrosCasos', q.QARe_AplicaOtrosCasos), (N'QARe_GenerarArticulo', q.QARe_GenerarArticulo),
                    (N'QARe_VerificoClasificacion', q.QARe_VerificoClasificacion), (N'QARe_UsuarioConfirmo', q.QARe_UsuarioConfirmo),
                    (N'Validacion', q.Validacion), (N'GrupoCorrecto', LEFT(q.GrupoCorrecto, 100))) AS x(Campo, Valor)
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY x.Campo, x.Valor
ORDER BY x.Campo, Tickets DESC;

-- ------------------------------------------------------------ 4. QARe_Evidencia
-- Pregunta del formulario: "Adjunta evidencia de la solucion" (generar_sql.py).
-- Se mide si trae texto, nombre de archivo, liga o lo mismo que la
-- descripcion: decide si la columna sirve en el detalle.
SELECT Seccion = N'4. Forma de QARe_Evidencia',
       ConEvidencia = SUM(HayEvid),
       IgualDescripcion = SUM(CASE WHEN HayEvid = 1 AND ClaveE = Clave THEN 1 ELSE 0 END),
       IgualCausa = SUM(CASE WHEN HayEvid = 1 AND ClaveE = ClaveC THEN 1 ELSE 0 END),
       ConLiga = SUM(CASE WHEN ClaveE LIKE N'%HTTP%' OR ClaveE LIKE N'%WWW%' THEN 1 ELSE 0 END),
       ConArchivo = SUM(CASE WHEN ClaveE LIKE N'% PNG%' OR ClaveE LIKE N'% JPG%' OR ClaveE LIKE N'% JPEG%' OR ClaveE LIKE N'% PDF%'
                               OR ClaveE LIKE N'% DOCX%' OR ClaveE LIKE N'% XLSX%' THEN 1 ELSE 0 END),
       DiceAdjunto = SUM(CASE WHEN ClaveE LIKE N'%ADJUNT%' OR ClaveE LIKE N'%ANEX%' OR ClaveE LIKE N'%CAPTURA%' THEN 1 ELSE 0 END),
       SinLetras = SUM(CASE WHEN HayEvid = 1 AND PATINDEX(N'%[A-Z]%', ClaveE COLLATE Latin1_General_CI_AI) = 0 THEN 1 ELSE 0 END),
       LargoMediano = (SELECT DISTINCT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY LEN(e.ClaveE)) OVER () FROM #Q AS e WHERE e.HayEvid = 1)
FROM #Q;

-- ------------------------------------------------------------ 5. Lo declarado contra lo escrito
-- La tabla se llama "compara lo declarado con lo escrito". Se mide que tan
-- seguido el texto repite un campo declarado y si el tipo "no se hizo nada"
-- convive con un verbo de accion en el texto.
SELECT Seccion = N'5a. Texto repite un campo', Analizables = SUM(CASE WHEN Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' THEN 1 ELSE 0 END),
       IgualTipo = SUM(CASE WHEN HayDesc = 1 AND Clave = ClaveT THEN 1 ELSE 0 END),
       IgualCausa = SUM(CASE WHEN HayDesc = 1 AND Clave = ClaveC THEN 1 ELSE 0 END),
       IgualEvidencia = SUM(CASE WHEN HayDesc = 1 AND Clave = ClaveE THEN 1 ELSE 0 END),
       IgualSolucionUsuario = SUM(CASE WHEN HayDesc = 1 AND Clave = ClaveU THEN 1 ELSE 0 END),
       IgualMensajeError = SUM(CASE WHEN HayDesc = 1 AND Clave = ClaveM THEN 1 ELSE 0 END),
       ContieneSolucionUsuario = SUM(CASE WHEN HayDesc = 1 AND LEN(ClaveU) >= 15 AND Clave <> ClaveU AND CHARINDEX(ClaveU, Clave) > 0 THEN 1 ELSE 0 END)
FROM #Q;

SELECT Seccion = N'5b. Tipo declarado x verbo de accion', TipoSolucion,
       Analizables = COUNT(*),
       ConVerboAccion = SUM(Accion), SinVerboAccion = SUM(1 - Accion),
       PctSinVerbo = CAST(100.0 * SUM(1 - Accion) / COUNT(*) AS decimal(6,2)),
       ConPalabraProblema = SUM(Problema)
FROM #Q
WHERE Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%'
GROUP BY TipoSolucion
ORDER BY Analizables DESC;

-- ------------------------------------------------------------ 6. Muestra estratificada
-- Cinco tickets por regla candidata, con las columnas amarillas de Daniela
-- y el contexto minimo. Sin nombre de tecnico. Textos recortados.
;WITH M AS (
    SELECT q.*, Rk = ROW_NUMBER() OVER (PARTITION BY q.Regla ORDER BY CHECKSUM(q.CodigoTicket))
    FROM #Q AS q
)
SELECT Seccion = N'6. Muestra por regla', Regla, CodigoTicket, Dia, Grupo, Validacion,
       Causa = LEFT(Causa, 60), TipoSolucion, Descripcion = LEFT(Texto, 150), Evidencia = LEFT(Evidencia, 60),
       Accion, Problema
FROM M
WHERE Rk <= 5
ORDER BY Regla, Rk;

-- ------------------------------------------------------------ 7. Contexto extra fuera de la vista
-- Campos de vw_Tickets que la vista QARE no trae y podrian ir en la fila
-- expandible. Solo llenado; el nombre de las columnas sale del diag de
-- objetos (seccion 2b).
SELECT Seccion = N'7. Llenado de campos solo en vw_Tickets',
       Tickets = COUNT(*),
       ConCausaRaizFenix  = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(t.CausaRaizFenix)), N'') IS NULL THEN 0 ELSE 1 END),
       ConCausaRaizGrupos = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(t.CausaRaizGrupos)), N'') IS NULL THEN 0 ELSE 1 END),
       ConLider = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(t.Lider)), N'') IS NULL THEN 0 ELSE 1 END),
       ConTecnicoSegundaLinea = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(t.TecnicoSegundaLinea)), N'') IS NULL THEN 0 ELSE 1 END)
FROM #Q AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket;

DROP TABLE #Q;
