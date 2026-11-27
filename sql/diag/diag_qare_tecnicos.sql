/* =========================================================================
   sql/diag/diag_qare_tecnicos.sql - Atribucion del tecnico y metricas por persona para usp_QARE_CalidadCaptura_Tecnicos
   SOLO LECTURA. Sin DDL ni DML sobre la base; la unica escritura es la
   tabla temporal #Q de la sesion (ver BLOQUE BASE).

   Mide: Tecnico contra FirmaSolucion, TecnicoSegundaLinea, TecnicoAsignado
   y el tecnico del SLA; nombres escritos de varias formas; cuentas que no
   son personas (comparacion exacta del SLA contra la normalizada de
   Analisis); la tabla por tecnico con la forma del prototipo y su
   reconciliacion contra el global. La seccion 4 lista nombres de firmas.

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

-- ------------------------------------------------------------ 1. De donde sale Tecnico
-- Diag 2: Tecnico = COALESCE(FirmaSolucion, TecnicoSegundaLinea, 'Sin tecnico')
-- en vw_CorreoQA_Base. Se compara contra los cinco candidatos, incluido el
-- TecnicoAsignado de vw_CorreoQA_Base y el TecnicoResolvio del SLA.
SELECT Seccion = N'1a. Tecnico contra candidatos',
       Tickets = COUNT(*),
       IgualFirmaSolucion        = SUM(CASE WHEN q.Tecnico = LTRIM(RTRIM(q.FirmaSolucion)) THEN 1 ELSE 0 END),
       IgualTecnicoSegundaLinea  = SUM(CASE WHEN q.Tecnico = LTRIM(RTRIM(t.TecnicoSegundaLinea)) THEN 1 ELSE 0 END),
       IgualTecnicoAsignado      = SUM(CASE WHEN q.Tecnico = LTRIM(RTRIM(b.TecnicoAsignado)) THEN 1 ELSE 0 END),
       IgualResponsableUltMod    = SUM(CASE WHEN q.Tecnico = LTRIM(RTRIM(t.ResponsableUltimaModificacion)) THEN 1 ELSE 0 END),
       IgualTecnicoSla           = SUM(CASE WHEN q.Tecnico = p.Tecnico THEN 1 ELSE 0 END),
       IgualTecnicoResolvioSla   = SUM(CASE WHEN q.Tecnico = p.TecnicoResolvio THEN 1 ELSE 0 END),
       FirmaSolucionVacia        = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(q.FirmaSolucion)), N'') IS NULL THEN 1 ELSE 0 END),
       SinTecnico                = SUM(CASE WHEN q.Tecnico = N'Sin tecnico' THEN 1 ELSE 0 END),
       FueraDelSla               = SUM(CASE WHEN p.CodigoTicket IS NULL THEN 1 ELSE 0 END)
FROM #Q AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
LEFT JOIN dbo.vw_CorreoQA_Base AS b ON b.CodigoTicket = q.CodigoTicket
LEFT JOIN dbo.vw_Dash_ProductividadBase AS p ON p.CodigoTicket = q.CodigoTicket;

-- 1b. Cuando la firma no es el asignado: quien cierra el ticket de otro?
--     Cuenta parejas (sin nombres en la salida) por tipo de firmante.
SELECT Seccion = N'1b. Firma distinta del asignado',
       Firmante = CASE WHEN q.EsNoPersona = 1 THEN N'Cuenta no persona' WHEN q.EsProveedor = 1 THEN N'Proveedor' ELSE N'Persona' END,
       Asignado = CASE WHEN NULLIF(LTRIM(RTRIM(t.TecnicoSegundaLinea)), N'') IS NULL THEN N'Sin asignado'
                       WHEN LTRIM(RTRIM(t.TecnicoSegundaLinea)) = q.Tecnico THEN N'Mismo'
                       ELSE N'Otra persona' END,
       Tickets = COUNT(*),
       SinInformacion = SUM(1 - q.HayDesc)
FROM #Q AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
GROUP BY CASE WHEN q.EsNoPersona = 1 THEN N'Cuenta no persona' WHEN q.EsProveedor = 1 THEN N'Proveedor' ELSE N'Persona' END,
         CASE WHEN NULLIF(LTRIM(RTRIM(t.TecnicoSegundaLinea)), N'') IS NULL THEN N'Sin asignado'
              WHEN LTRIM(RTRIM(t.TecnicoSegundaLinea)) = q.Tecnico THEN N'Mismo'
              ELSE N'Otra persona' END
ORDER BY Firmante, Asignado;

-- ------------------------------------------------------------ 2. Identidad del nombre
-- 2a. Un mismo tecnico escrito de varias formas (acentos, mayusculas,
--     espacios, NBSP). Si aparece, agrupar por el texto crudo lo parte en
--     dos filas.
SELECT Seccion = N'2a. Nombres que colapsan',
       Clave = UPPER(LTRIM(RTRIM(REPLACE(Tecnico, NCHAR(160), N' ')))) COLLATE Latin1_General_CI_AI,
       Escrituras = COUNT(DISTINCT Tecnico COLLATE Latin1_General_CS_AS), Tickets = COUNT(*)
FROM #Q
GROUP BY UPPER(LTRIM(RTRIM(REPLACE(Tecnico, NCHAR(160), N' ')))) COLLATE Latin1_General_CI_AI
HAVING COUNT(DISTINCT Tecnico COLLATE Latin1_General_CS_AS) > 1;

-- 2b. Caracteres raros: U+FFFD (acentos rotos de la importacion) y NBSP.
SELECT Seccion = N'2b. Caracteres raros en Tecnico',
       ConFFFD = COUNT(DISTINCT CASE WHEN CHARINDEX(NCHAR(65533), Tecnico) > 0 THEN Tecnico END),
       ConNBSP = COUNT(DISTINCT CASE WHEN CHARINDEX(NCHAR(160), Tecnico) > 0 THEN Tecnico END),
       ConEspaciosOrilla = COUNT(DISTINCT CASE WHEN Tecnico <> LTRIM(RTRIM(Tecnico)) THEN Tecnico END)
FROM #Q;

-- 2c. Alias conocidos: vw_TecnicoAgente apunta nombres viejos al principal
--     (solo cubre a quien tiene extension de Call Center).
SELECT Seccion = N'2c. Alias en vw_TecnicoAgente', a.EsAlias,
       TecnicosEnPeriodo = COUNT(DISTINCT q.Tecnico), Tickets = COUNT(*)
FROM #Q AS q
JOIN dbo.vw_TecnicoAgente AS a ON a.TecnicoEnTickets = q.Tecnico
GROUP BY a.EsAlias;

SELECT Seccion = N'2d. Cobertura de CatAgenteTecnico',
       TecnicosEnPeriodo = COUNT(DISTINCT q.Tecnico),
       TecnicosConExtension = COUNT(DISTINCT CASE WHEN a.TecnicoEnTickets IS NOT NULL THEN q.Tecnico END)
FROM #Q AS q
LEFT JOIN dbo.vw_TecnicoAgente AS a ON a.TecnicoEnTickets = q.Tecnico;

-- ------------------------------------------------------------ 3. Cuentas que no son personas
-- SLA compara CatCuentaNoPersona.Cuenta = Tecnico exacto (DashboardQueries);
-- Analisis (47) normaliza NBSP y recorta. Si dan distinto, hay que elegir.
SELECT Seccion = N'3a. Comparacion exacta vs normalizada',
       ExactaSLA = SUM(e.Exacta),
       NormalizadaAnalisis = SUM(q.EsNoPersona)
FROM #Q AS q
CROSS APPLY (SELECT Exacta = CASE WHEN EXISTS (SELECT 1 FROM dbo.CatCuentaNoPersona AS c
                                               WHERE c.Habilitado = 1 AND c.Cuenta = q.Tecnico) THEN 1 ELSE 0 END) AS e;

-- 3b. Tipos de firmante: personas, cuentas del catalogo y cuentas de
--     proveedor fuera del catalogo. Con su captura, para ver si excluirlas
--     cambia los indicadores.
SELECT Seccion = N'3b. Tipo de firmante',
       Firmante = CASE WHEN EsNoPersona = 1 THEN N'CatCuentaNoPersona' WHEN EsProveedor = 1 THEN N'Proveedor (fuera del catalogo)' ELSE N'Persona' END,
       Firmas = COUNT(DISTINCT Tecnico), Tickets = COUNT(*),
       SinInformacion = SUM(CASE WHEN Regla LIKE N'S%' THEN 1 ELSE 0 END),
       InvalidasMinima = SUM(CASE WHEN Regla LIKE N'I%' THEN 1 ELSE 0 END),
       Analizables = SUM(CASE WHEN Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' THEN 1 ELSE 0 END)
FROM #Q
GROUP BY CASE WHEN EsNoPersona = 1 THEN N'CatCuentaNoPersona' WHEN EsProveedor = 1 THEN N'Proveedor (fuera del catalogo)' ELSE N'Persona' END
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 4. Tabla por tecnico (forma del prototipo)
-- Columnas y denominadores del prototipo de Daniela (propuesta 3.4 y 8.1),
-- con la variante minima de invalida. Patron, incompleta y sin patron no
-- tienen regla: salen NULL a proposito. Cuenta no persona y proveedor van
-- como columna para decidir (9.2) sin quitarlas aqui.
;WITH T AS (
    SELECT FirmaSolucion = Tecnico, EsNoPersona = MAX(EsNoPersona), EsProveedor = MAX(EsProveedor),
           Grupos = COUNT(DISTINCT Grupo),
           TicketsTotales = COUNT(*),
           TicketsSinInfo = SUM(CASE WHEN Regla LIKE N'S%' THEN 1 ELSE 0 END),
           TicketsNoEvaluables = SUM(CASE WHEN Regla LIKE N'I%' THEN 1 ELSE 0 END),
           TicketsDudosos = SUM(CASE WHEN Regla LIKE N'Q%' THEN 1 ELSE 0 END),
           TicketsTextoEvaluable = SUM(CASE WHEN Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' THEN 1 ELSE 0 END)
    FROM #Q
    GROUP BY Tecnico
)
SELECT Seccion = N'4. Por tecnico (variante minima)', FirmaSolucion, EsNoPersona, EsProveedor, Grupos,
       TicketsTotales, TicketsSinInfo,
       TicketsEvaluados = TicketsTotales - TicketsSinInfo,
       TicketsNoEvaluables,
       PctNoEvaluable = CAST(100.0 * TicketsNoEvaluables / NULLIF(TicketsTotales - TicketsSinInfo, 0) AS decimal(6,2)),
       TicketsTextoEvaluable,
       PctTextoEvaluable = CAST(100.0 * TicketsTextoEvaluable / NULLIF(TicketsTotales - TicketsSinInfo, 0) AS decimal(6,2)),
       TicketsDudosos,
       TicketsConPatron = CAST(NULL AS int), TicketsCalidad = CAST(NULL AS int), TicketsSinPatron = CAST(NULL AS int)
FROM T
ORDER BY TicketsTotales DESC;

-- 4b. Reconciliacion: la suma por tecnico = el global (prueba 8.3.5).
;WITH T AS (
    SELECT Tecnico, Tot = COUNT(*),
           S = SUM(CASE WHEN Regla LIKE N'S%' THEN 1 ELSE 0 END),
           I = SUM(CASE WHEN Regla LIKE N'I%' THEN 1 ELSE 0 END),
           A = SUM(CASE WHEN Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' THEN 1 ELSE 0 END)
    FROM #Q GROUP BY Tecnico
)
SELECT Seccion = N'4b. Suma por tecnico vs global',
       SumaTotales = SUM(Tot), Global = (SELECT COUNT(*) FROM #Q),
       SumaSinInfo = SUM(S), SumaInvalidas = SUM(I), SumaAnalizables = SUM(A),
       Cuadra = CASE WHEN SUM(Tot) = (SELECT COUNT(*) FROM #Q) AND SUM(Tot) = SUM(S) + SUM(I) + SUM(A) THEN 1 ELSE 0 END,
       TicketsSinTecnico = (SELECT COUNT(*) FROM #Q WHERE Tecnico IS NULL)
FROM T;

-- ------------------------------------------------------------ 5. Volumen por tecnico
-- Un % sobre 3 tickets no dice nada. Distribucion de tickets por firma para
-- decidir si la tabla necesita un minimo (decision de negocio).
SELECT Seccion = N'5. Firmas por volumen',
       Rango = CASE WHEN n < 5 THEN N'a. 1-4' WHEN n < 20 THEN N'b. 5-19' WHEN n < 100 THEN N'c. 20-99'
                    WHEN n < 300 THEN N'd. 100-299' ELSE N'e. 300+' END,
       Firmas = COUNT(*), Tickets = SUM(n)
FROM (SELECT Tecnico, n = COUNT(*) FROM #Q GROUP BY Tecnico) AS x
GROUP BY CASE WHEN n < 5 THEN N'a. 1-4' WHEN n < 20 THEN N'b. 5-19' WHEN n < 100 THEN N'c. 20-99'
              WHEN n < 300 THEN N'd. 100-299' ELSE N'e. 300+' END
ORDER BY Rango;

-- 5b. Tecnicos en varios grupos: con filtro de Grupo, su fila cambia.
SELECT Seccion = N'5b. Firmas por cantidad de grupos', Grupos = CASE WHEN g >= 4 THEN 4 ELSE g END,
       Firmas = COUNT(*), Tickets = SUM(n)
FROM (SELECT Tecnico, g = COUNT(DISTINCT Grupo), n = COUNT(*) FROM #Q GROUP BY Tecnico) AS x
GROUP BY CASE WHEN g >= 4 THEN 4 ELSE g END
ORDER BY Grupos;

-- ------------------------------------------------------------ 6. Habito por tecnico
-- Concentracion de cada regla candidata: si pocas firmas explican casi todo,
-- es habito de captura y la tabla por tecnico lo va a mostrar asi.
;WITH R AS (
    SELECT Regla, Tecnico, n = COUNT(*),
           Rk = ROW_NUMBER() OVER (PARTITION BY Regla ORDER BY COUNT(*) DESC, Tecnico)
    FROM #Q GROUP BY Regla, Tecnico
)
SELECT Seccion = N'6. Concentracion por regla', Regla,
       Tickets = SUM(n), Firmas = COUNT(*),
       Top3 = SUM(CASE WHEN Rk <= 3 THEN n ELSE 0 END),
       PctTop3 = CAST(100.0 * SUM(CASE WHEN Rk <= 3 THEN n ELSE 0 END) / SUM(n) AS decimal(6,2)),
       Top10 = SUM(CASE WHEN Rk <= 10 THEN n ELSE 0 END)
FROM R
GROUP BY Regla
ORDER BY Regla;

DROP TABLE #Q;
