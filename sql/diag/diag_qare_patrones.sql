/* =========================================================================
   sql/diag/diag_qare_patrones.sql - Frecuencias, normalizacion y agrupaciones candidatas del texto para usp_QARE_PatronesSolucion
   SOLO LECTURA. Sin DDL ni DML sobre la base; la unica escritura es la
   tabla temporal #Q de la sesion (ver BLOQUE BASE).

   Mide: textos y palabras mas repetidos, cuanto junta la normalizacion,
   cuantos textos cubren el 80 % de las respuestas, los campos declarados
   (tipo, causa, evidencia), la cobertura y los empates de semillas sacadas
   del nombre de los 13 patrones del prototipo de Daniela, y si las frases
   de dbo.AnalisisRegla reconocen algo del texto QARE.

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

/* Semillas CANDIDATAS por patron. Salen del NOMBRE de los 13 patrones que se
   ven en el Pareto del prototipo de Daniela (propuesta 3.3), no de su codigo,
   que no tenemos. Sirven para medir si un catalogo de frases por patron es
   viable: cobertura, empates entre patrones y lo que queda sin patron. Se
   comparan al inicio de palabra; una semilla que termina en espacio exige
   la palabra completa. No es el catalogo. */
DECLARE @P TABLE (Orden int NOT NULL, Patron nvarchar(60) NOT NULL, Semilla nvarchar(40) NOT NULL);
INSERT @P (Orden, Patron, Semilla) VALUES
    (1, N'ACTUALIZACION / INSTALACION', N'ACTUALIZ'), (1, N'ACTUALIZACION / INSTALACION', N'INSTAL'),
    (1, N'ACTUALIZACION / INSTALACION', N'REINSTAL'), (1, N'ACTUALIZACION / INSTALACION', N'PARCHE'),
    (1, N'ACTUALIZACION / INSTALACION', N'VERSION'),
    (2, N'REINICIO / REACTIVACION', N'REINICI'), (2, N'REINICIO / REACTIVACION', N'REACTIV'),
    (2, N'REINICIO / REACTIVACION', N'REARRANC'), (2, N'REINICIO / REACTIVACION', N'RESTABLEC'),
    (2, N'REINICIO / REACTIVACION', N'LEVANTA'),
    (3, N'INDICACIONES / CANALIZACION', N'INDICACION'), (3, N'INDICACIONES / CANALIZACION', N'SE INDICA'),
    (3, N'INDICACIONES / CANALIZACION', N'CANALIZ'), (3, N'INDICACIONES / CANALIZACION', N'ORIENT'),
    (3, N'INDICACIONES / CANALIZACION', N'SE EXPLICA'), (3, N'INDICACIONES / CANALIZACION', N'SE INFORMA'),
    (3, N'INDICACIONES / CANALIZACION', N'ESCAL'), (3, N'INDICACIONES / CANALIZACION', N'SE TURNA'),
    (4, N'ROLES / PERMISOS', N'PERMISO'), (4, N'ROLES / PERMISOS', N'ROL '), (4, N'ROLES / PERMISOS', N'ROLES '),
    (4, N'ROLES / PERMISOS', N'PERFIL'), (4, N'ROLES / PERMISOS', N'ACCESO'), (4, N'ROLES / PERMISOS', N'AUTORIZACION'),
    (5, N'VALIDACION / SIN INTERVENCION', N'VALID'), (5, N'VALIDACION / SIN INTERVENCION', N'SIN INTERVENCION'),
    (5, N'VALIDACION / SIN INTERVENCION', N'FUNCIONA CORRECTAMENTE'), (5, N'VALIDACION / SIN INTERVENCION', N'YA FUNCIONA'),
    (5, N'VALIDACION / SIN INTERVENCION', N'OPERANDO'), (5, N'VALIDACION / SIN INTERVENCION', N'SE CONFIRMA'),
    (6, N'CONFIGURACION', N'CONFIGUR'), (6, N'CONFIGURACION', N'PARAMETR'), (6, N'CONFIGURACION', N'AJUST'),
    (7, N'CUENTAS / CREDENCIALES', N'CONTRASE'), (7, N'CUENTAS / CREDENCIALES', N'PASSWORD'),
    (7, N'CUENTAS / CREDENCIALES', N'DESBLOQUE'), (7, N'CUENTAS / CREDENCIALES', N'CREDENCIAL'),
    (7, N'CUENTAS / CREDENCIALES', N'CUENTA '), (7, N'CUENTAS / CREDENCIALES', N'USUARIO'),
    (7, N'CUENTAS / CREDENCIALES', N'ALTA '),
    (8, N'HARDWARE / REPARACION', N'REPAR'), (8, N'HARDWARE / REPARACION', N'REEMPLAZ'),
    (8, N'HARDWARE / REPARACION', N'SUSTITU'), (8, N'HARDWARE / REPARACION', N'CALIBR'),
    (8, N'HARDWARE / REPARACION', N'HARDWARE'), (8, N'HARDWARE / REPARACION', N'IMPRESORA'),
    (8, N'HARDWARE / REPARACION', N'BASCULA'), (8, N'HARDWARE / REPARACION', N'TECLADO'),
    (8, N'HARDWARE / REPARACION', N'PINPAD'), (8, N'HARDWARE / REPARACION', N'GAVETA'),
    (8, N'HARDWARE / REPARACION', N'CABLE'), (8, N'HARDWARE / REPARACION', N'EQUIPO'),
    (9, N'BASE DE DATOS / DML', N'BASE DE DATOS'), (9, N'BASE DE DATOS / DML', N'DML'),
    (9, N'BASE DE DATOS / DML', N'QUERY'), (9, N'BASE DE DATOS / DML', N'SCRIPT'),
    (9, N'BASE DE DATOS / DML', N'UPDATE'), (9, N'BASE DE DATOS / DML', N'TABLA'), (9, N'BASE DE DATOS / DML', N'BD '),
    (10, N'CANCELACION / CIERRE OPERATIVO', N'CANCEL'), (10, N'CANCELACION / CIERRE OPERATIVO', N'ANUL'),
    (10, N'CANCELACION / CIERRE OPERATIVO', N'CIERRE'), (10, N'CANCELACION / CIERRE OPERATIVO', N'ELIMIN'),
    (11, N'CAMBIO ADMINISTRATIVO', N'PRECIO'), (11, N'CAMBIO ADMINISTRATIVO', N'ADMINISTRATIV'),
    (11, N'CAMBIO ADMINISTRATIVO', N'CATALOGO'), (11, N'CAMBIO ADMINISTRATIVO', N'MATERIAL'),
    (11, N'CAMBIO ADMINISTRATIVO', N'PRESUPUEST'),
    (12, N'SEGURIDAD / CONECTIVIDAD', N'CONECT'), (12, N'SEGURIDAD / CONECTIVIDAD', N'RED '),
    (12, N'SEGURIDAD / CONECTIVIDAD', N'VPN'), (12, N'SEGURIDAD / CONECTIVIDAD', N'INTERNET'),
    (12, N'SEGURIDAD / CONECTIVIDAD', N'ENLACE'), (12, N'SEGURIDAD / CONECTIVIDAD', N'DOMINIO'),
    (12, N'SEGURIDAD / CONECTIVIDAD', N'ANTIVIRUS'), (12, N'SEGURIDAD / CONECTIVIDAD', N'CERTIFICADO'),
    (12, N'SEGURIDAD / CONECTIVIDAD', N'FIREWALL'), (12, N'SEGURIDAD / CONECTIVIDAD', N'IP '),
    (13, N'REPROCESO / REENVIO', N'REPROCES'), (13, N'REPROCESO / REENVIO', N'REENVI'),
    (13, N'REPROCESO / REENVIO', N'REINTENT'), (13, N'REPROCESO / REENVIO', N'SINCRONIZ'),
    (13, N'REPROCESO / REENVIO', N'REPLIC'), (13, N'REPROCESO / REENVIO', N'RECARG');

-- ------------------------------------------------------------ 1. Textos mas repetidos (normalizados)
-- Solo analizables candidatos (Regla A o Q*). Variantes = cuantas escrituras
-- crudas distintas colapsan en la misma clave: mide lo que gana normalizar.
SELECT TOP (100) Seccion = N'1. Claves mas repetidas', Clave = LEFT(Clave, 120) COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*), Variantes = COUNT(DISTINCT Texto), Tecnicos = COUNT(DISTINCT Tecnico),
       Grupos = COUNT(DISTINCT Grupo), Regla = MIN(Regla)
FROM #Q
WHERE Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%'
GROUP BY LEFT(Clave, 120) COLLATE Latin1_General_CI_AI
ORDER BY Tickets DESC;

-- 1b. Concentracion: cuantos textos distintos cubren el 50/80/90 % de los
--     analizables. Si pocos textos cubren mucho, un catalogo de frases exactas
--     alcanza; si no, hace falta coincidencia por palabras.
;WITH F AS (
    SELECT Clave = LEFT(Clave, 120) COLLATE Latin1_General_CI_AI, Tickets = COUNT(*)
    FROM #Q WHERE Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%'
    GROUP BY LEFT(Clave, 120) COLLATE Latin1_General_CI_AI
), A AS (
    SELECT Tickets, Acum = SUM(Tickets) OVER (ORDER BY Tickets DESC, Clave ROWS UNBOUNDED PRECEDING),
           Total = SUM(Tickets) OVER (), n = ROW_NUMBER() OVER (ORDER BY Tickets DESC, Clave)
    FROM F
)
SELECT Seccion = N'1b. Concentracion de textos',
       TextosDistintos = COUNT(*), TicketsAnalizables = MAX(Total),
       TextosUnicos = SUM(CASE WHEN Tickets = 1 THEN 1 ELSE 0 END),
       TextosPara50 = MIN(CASE WHEN Acum >= 0.5 * Total THEN n END),
       TextosPara80 = MIN(CASE WHEN Acum >= 0.8 * Total THEN n END),
       TextosPara90 = MIN(CASE WHEN Acum >= 0.9 * Total THEN n END)
FROM A;

-- ------------------------------------------------------------ 2. Palabras y arranques
-- 2a. Palabras mas frecuentes (por ticket, no por aparicion). Los verbos de
--     accion candidatos a semilla salen de aqui.
SELECT TOP (150) Seccion = N'2a. Palabras', Palabra = s.value COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(DISTINCT q.CodigoTicket), Tecnicos = COUNT(DISTINCT q.Tecnico)
FROM #Q AS q
CROSS APPLY STRING_SPLIT(q.Clave, N' ') AS s
WHERE q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
  AND LEN(s.value) > 2
  AND s.value NOT IN (N'SE', N'DE', N'LA', N'EL', N'LOS', N'LAS', N'DEL', N'POR', N'CON', N'PARA', N'QUE', N'UNA', N'UN', N'EN', N'AL', N'SUS', N'SU', N'LE', N'LES', N'YA')
GROUP BY s.value COLLATE Latin1_General_CI_AI
ORDER BY Tickets DESC;

-- 2b. Primeras dos palabras: "SE REINICIA", "SE OTORGAN"... Un arranque con
--     verbo es la forma tipica de documentar una accion.
SELECT TOP (80) Seccion = N'2b. Arranques', Arranque = LEFT(Clave, CASE WHEN CHARINDEX(N' ', Clave, CHARINDEX(N' ', Clave) + 1) > 0
                                                       THEN CHARINDEX(N' ', Clave, CHARINDEX(N' ', Clave) + 1) - 1 ELSE LEN(Clave) END)
                                     COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*), Tecnicos = COUNT(DISTINCT Tecnico)
FROM #Q
WHERE Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%'
GROUP BY LEFT(Clave, CASE WHEN CHARINDEX(N' ', Clave, CHARINDEX(N' ', Clave) + 1) > 0
                          THEN CHARINDEX(N' ', Clave, CHARINDEX(N' ', Clave) + 1) - 1 ELSE LEN(Clave) END) COLLATE Latin1_General_CI_AI
ORDER BY Tickets DESC;

-- 2c. Textos parecidos: misma clave en sus primeros 20 caracteres pero
--     escrituras distintas. Candidatos a la misma frase del catalogo.
SELECT TOP (60) Seccion = N'2c. Mismo inicio, distinta escritura', Inicio = LEFT(Clave, 20) COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*), ClavesDistintas = COUNT(DISTINCT Clave),
       Ejemplo1 = MIN(LEFT(Clave, 100)), Ejemplo2 = MAX(LEFT(Clave, 100))
FROM #Q
WHERE Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' AND LEN(Clave) >= 20
GROUP BY LEFT(Clave, 20) COLLATE Latin1_General_CI_AI
HAVING COUNT(DISTINCT Clave) > 1
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 3. Campos declarados
-- 3a. Tipo de solucion: catalogo cerrado de 11 valores (diag 1).
SELECT Seccion = N'3a. QARe_TipoSolucion', TipoSolucion, Tickets = COUNT(*),
       Analizables = SUM(CASE WHEN Regla NOT LIKE N'S%' AND Regla NOT LIKE N'I%' THEN 1 ELSE 0 END),
       Invalidas = SUM(CASE WHEN Regla LIKE N'I%' THEN 1 ELSE 0 END)
FROM #Q
GROUP BY TipoSolucion
ORDER BY Tickets DESC;

-- 3b. Causa: valores mas repetidos. Si es catalogo cerrado o texto libre.
SELECT TOP (40) Seccion = N'3b. QARe_Causa', Causa = LEFT(ClaveC, 120) COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*), Variantes = COUNT(DISTINCT Causa)
FROM #Q
WHERE HayCausa = 1
GROUP BY LEFT(ClaveC, 120) COLLATE Latin1_General_CI_AI
ORDER BY Tickets DESC;

SELECT Seccion = N'3c. QARe_Causa: forma', CausasDistintas = COUNT(DISTINCT ClaveC COLLATE Latin1_General_CI_AI),
       TicketsConCausa = SUM(HayCausa),
       CausaIgualTexto = SUM(CASE WHEN HayCausa = 1 AND ClaveC = Clave THEN 1 ELSE 0 END)
FROM #Q;

-- 3d. Evidencia: valores mas repetidos (que se escribe en "Adjunta evidencia").
SELECT TOP (40) Seccion = N'3d. QARe_Evidencia', Evidencia = LEFT(ClaveE, 120) COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*)
FROM #Q
WHERE HayEvid = 1
GROUP BY LEFT(ClaveE, 120) COLLATE Latin1_General_CI_AI
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 4. Semillas candidatas por patron
-- 4a. Cobertura por patron (NO excluyente: un ticket cuenta en cada patron
--     que toca). La suma pasa del total cuando hay empates.
;WITH M AS (
    SELECT DISTINCT q.CodigoTicket, p.Orden, p.Patron
    FROM #Q AS q
    JOIN @P AS p ON (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + p.Semilla + N'%'
    WHERE q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
)
SELECT Seccion = N'4a. Cobertura por patron', Orden, Patron, Tickets = COUNT(*)
FROM M
GROUP BY Orden, Patron
ORDER BY Orden;

-- 4b. Cuantos patrones toca cada ticket analizable. 0 = "sin patron"
--     candidato; 2 o mas = hay que decidir prioridad o doble conteo (9.9).
;WITH M AS (
    SELECT q.CodigoTicket, q.Regla,
           Patrones = (SELECT COUNT(DISTINCT p.Orden) FROM @P AS p
                       WHERE (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + p.Semilla + N'%')
    FROM #Q AS q
    WHERE q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
)
SELECT Seccion = N'4b. Patrones por ticket', Patrones = CASE WHEN Patrones >= 3 THEN 3 ELSE Patrones END,
       Tickets = COUNT(*),
       Pct = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(6,2))
FROM M
GROUP BY CASE WHEN Patrones >= 3 THEN 3 ELSE Patrones END
ORDER BY Patrones;

-- 4c. Pares de patrones que mas empatan.
;WITH M AS (
    SELECT DISTINCT q.CodigoTicket, p.Orden, p.Patron
    FROM #Q AS q
    JOIN @P AS p ON (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + p.Semilla + N'%'
    WHERE q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
)
SELECT TOP (20) Seccion = N'4c. Empates', PatronA = a.Patron, PatronB = b.Patron, Tickets = COUNT(*)
FROM M AS a
JOIN M AS b ON b.CodigoTicket = a.CodigoTicket AND b.Orden > a.Orden
GROUP BY a.Patron, b.Patron
ORDER BY Tickets DESC;

-- 4d. Pareto con desempate por el orden del prototipo (gana el primero).
--     Misma forma que el contrato: Posicion, PatronSolucion, Tickets,
--     Porcentaje, TicketsAcumulados, PctAcumulado. Comprueba que la suma
--     del Pareto = tickets con patron (prueba 8.3.4).
;WITH M AS (
    SELECT q.CodigoTicket,
           Patron = (SELECT TOP (1) p.Patron FROM @P AS p
                     WHERE (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + p.Semilla + N'%'
                     ORDER BY p.Orden)
    FROM #Q AS q
    WHERE q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
), C AS (
    SELECT PatronSolucion = Patron, Tickets = COUNT(*)
    FROM M WHERE Patron IS NOT NULL
    GROUP BY Patron
)
SELECT Seccion = N'4d. Pareto candidato',
       Posicion = ROW_NUMBER() OVER (ORDER BY Tickets DESC, PatronSolucion),
       PatronSolucion, Tickets,
       Porcentaje = CAST(100.0 * Tickets / SUM(Tickets) OVER () AS decimal(6,2)),
       TicketsAcumulados = SUM(Tickets) OVER (ORDER BY Tickets DESC, PatronSolucion ROWS UNBOUNDED PRECEDING),
       PctAcumulado = CAST(100.0 * SUM(Tickets) OVER (ORDER BY Tickets DESC, PatronSolucion ROWS UNBOUNDED PRECEDING)
                           / SUM(Tickets) OVER () AS decimal(6,2)),
       TicketsConPatron = SUM(Tickets) OVER ()
FROM C
ORDER BY Posicion;

-- 4e. Lo que queda sin patron: los textos mas repetidos. De aqui salen las
--     semillas que faltan o las frases de "respuesta incompleta".
;WITH M AS (
    SELECT q.Clave, q.Tecnico, q.Accion, q.Problema
    FROM #Q AS q
    WHERE q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
      AND NOT EXISTS (SELECT 1 FROM @P AS p
                      WHERE (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + p.Semilla + N'%')
)
SELECT TOP (80) Seccion = N'4e. Sin patron mas repetidos', Clave = LEFT(Clave, 120) COLLATE Latin1_General_CI_AI,
       Tickets = COUNT(*), Tecnicos = COUNT(DISTINCT Tecnico),
       ConVerboAccion = MAX(Accion), ConPalabraProblema = MAX(Problema)
FROM M
GROUP BY LEFT(Clave, 120) COLLATE Latin1_General_CI_AI
ORDER BY Tickets DESC;

-- 4f. El tipo declarado contra el patron candidato del texto: si el tipo ya
--     predice el patron, el Pareto podria partir del tipo y no del texto.
;WITH M AS (
    SELECT q.TipoSolucion,
           Patron = ISNULL((SELECT TOP (1) p.Patron FROM @P AS p
                            WHERE (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'% ' + p.Semilla + N'%'
                            ORDER BY p.Orden), N'(sin patron)')
    FROM #Q AS q
    WHERE q.Regla NOT LIKE N'S%' AND q.Regla NOT LIKE N'I%'
)
SELECT Seccion = N'4f. Tipo declarado x patron candidato', TipoSolucion, Patron, Tickets = COUNT(*),
       PctDelTipo = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY TipoSolucion) AS decimal(6,2))
FROM M
GROUP BY TipoSolucion, Patron
ORDER BY TipoSolucion, Tickets DESC;

-- ------------------------------------------------------------ 5. Frases de Analisis sobre el texto QARE
-- Las frases de dbo.AnalisisRegla (Campo S) ya estan normalizadas en
-- minusculas sin acentos; la comparacion CI_AI las hace equivalentes. Mide
-- si algun motivo existente (sobre todo los genericos: "sin respuesta",
-- "duplicado") reconoce textos QARE. Solo cobertura, sin decidir nada.
;WITH R AS (
    SELECT r.Servicio, r.Regla, r.Motivo, Frase = j.value
    FROM dbo.AnalisisRegla AS r
    CROSS APPLY OPENJSON(r.Frases) AS j
    WHERE r.Campo IN ('S', 'DS') AND ISJSON(r.Frases) = 1
)
SELECT TOP (60) Seccion = N'5. AnalisisRegla sobre QARE', R.Motivo,
       Servicios = COUNT(DISTINCT R.Servicio),
       Tickets = COUNT(DISTINCT q.CodigoTicket),
       Ejemplo = MIN(LEFT(q.Clave, 120))
FROM R
JOIN #Q AS q ON (N' ' + q.Clave + N' ') COLLATE Latin1_General_CI_AI LIKE N'%' + R.Frase + N'%'
WHERE q.HayDesc = 1
GROUP BY R.Motivo
ORDER BY Tickets DESC;

DROP TABLE #Q;
