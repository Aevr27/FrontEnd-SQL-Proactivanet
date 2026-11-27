/* =========================================================================
   sql/diag/diag_qare_correcciones.sql - Evidencia para la lista de
   correcciones al prototipo QARE de Daniela (vw_QARE_CalidadCaptura y los
   cuatro usp_QARE_*). SOLO LECTURA.

   No modifica objetos ni datos. Las unicas escrituras son tablas temporales
   de la sesion (#T, #N, #C, #K, #D) en tempdb; INSERT ... EXEC solo captura
   lo que devuelven los SP para poder cuadrarlo.

   Secciones (sql/docs/PROPUESTA_qare_tecnicos.md, seccion 13):
     0. Intercalacion: como compara ESTA base invisibles, acentos y blancos.
     1. Respuestas frecuentes sin patron (ERROR, CARGA DE PRECIOS, ALTA SAP,
        SE BRINDA CONTACTO, NAVEGACION): variantes, contexto, catalogo.
     2. Normalizacion: reclasifica con la logica de la vista en cinco
        niveles y mide que tickets cambian en cada paso. El nivel 1 debe
        reproducir la vista (2a = 0 diferencias); si no, no leer el resto.
     3. Reglas: NO SALE ERROR, copia del tipo declarado, exacto contra
        parcial, reglas inactivas, familia SIN RESPUESTA.
     4. Consistencia entre los cuatro SP: cuerpos, poblacion, fechas,
        filtros, etiquetas y cuadre.

   Ventana fija 2026-10-29 a 2026-11-27 (fin inclusivo), la de los diag
   anteriores. Correr en QA (Tickets_Proactivanet) con SSMS en cuadricula,
   resultados a archivo (.rpt). La salida trae textos de tickets: no
   copiarla fuera de la red interna.

   Literales no ASCII con NCHAR(): SSMS puede abrir el archivo como cp1252.
   ========================================================================= */

SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#T') IS NOT NULL DROP TABLE #T;
IF OBJECT_ID('tempdb..#N') IS NOT NULL DROP TABLE #N;
IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;
IF OBJECT_ID('tempdb..#K') IS NOT NULL DROP TABLE #K;
IF OBJECT_ID('tempdb..#D') IS NOT NULL DROP TABLE #D;
IF OBJECT_ID('tempdb..#D2') IS NOT NULL DROP TABLE #D2;
IF OBJECT_ID('tempdb..#D3') IS NOT NULL DROP TABLE #D3;

DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';

/* Base: una fila por ticket de la vista en la ventana, con el contexto de
   vw_CorreoQARECierre_Base que la vista no expone (titulo, evidencia,
   mensaje de error, solucion al usuario). */
/* TxtB: llave de union entre #T y las tablas de la seccion 2. Binaria para
   que 'Error' y 'ERROR', o un texto con y sin espacio de ancho cero, no se
   fundan en uno; la clasificacion compara con su propia intercalacion. */
SELECT q.CodigoTicket, q.FechaFirmaSolucion, q.FirmaSolucion, q.Grupo, q.Categoria,
       Txt = q.QARe_DescripcionSolucion,
       TxtB = CAST(q.QARe_DescripcionSolucion AS nvarchar(4000)) COLLATE Latin1_General_BIN2,
       q.EstadoDescripcion, Tipo = q.TipoClasificacionRespuesta, Clasif = q.ClasificacionRespuesta,
       q.IdReglaClasificacion, q.FraseClasificacion,
       q.QARe_TipoSolucion, q.QARe_Causa,
       TipoTicket = b.Tipo, b.Titulo, b.QARe_Evidencia, b.SolucionUsuario, b.QA_MensajeError
INTO #T
FROM dbo.vw_QARE_CalidadCaptura AS q
OUTER APPLY (SELECT TOP (1) x.Tipo, x.Titulo, x.QARe_Evidencia, x.SolucionUsuario, x.QA_MensajeError
             FROM dbo.vw_CorreoQARECierre_Base AS x
             WHERE x.CodigoTicket = q.CodigoTicket) AS b
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

SELECT Seccion = N'B. Base', Filas = COUNT(*), Tickets = COUNT(DISTINCT CodigoTicket),
       TextoMas4000 = SUM(CASE WHEN LEN(Txt) > 4000 THEN 1 ELSE 0 END)
FROM #T;
GO

/* ================================================================ 0
   Intercalacion. En LocalDB (SQL 2025, sin datos de QA) se vio que
   Latin1_General_CI_AS NO iguala 'SIN RESPUESTA' con un espacio de ancho
   cero delante, pero Latin1_General_100_CI_AS SI (lo ignora) y entonces
   LIKE '%[ZW]%' no lo encuentra. Lo que vale es la intercalacion de QA. */
SELECT Seccion = N'0a. Intercalacion',
       Base = CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')),
       Columna = (SELECT c.collation_name FROM sys.columns AS c
                  WHERE c.object_id = OBJECT_ID('dbo.vw_QARE_CalidadCaptura') AND c.name = 'QARe_DescripcionSolucion'),
       PalabraClave = (SELECT c.collation_name FROM sys.columns AS c
                       WHERE c.object_id = OBJECT_ID('dbo.CatQARE_PatronSolucion') AND c.name = 'PalabraClave'),
       PalabraClaveTipo = (SELECT TYPE_NAME(c.user_type_id) FROM sys.columns AS c
                           WHERE c.object_id = OBJECT_ID('dbo.CatQARE_PatronSolucion') AND c.name = 'PalabraClave'),
       Version = CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion'));

/* Mismas pruebas que en LocalDB, con la intercalacion de la columna real.
   Cada valor de prueba se compara contra 'SIN RESPUESTA' con la expresion
   de la vista: UPPER(LTRIM(RTRIM(x))) = UPPER(LTRIM(RTRIM(valor))). */
;WITH P AS (
    SELECT Caso = N'ancho cero U+200C delante', V = NCHAR(8204) + N'SIN RESPUESTA' UNION ALL
    SELECT N'ancho cero U+200B delante', NCHAR(8203) + N'SIN RESPUESTA' UNION ALL
    SELECT N'BOM U+FEFF delante', NCHAR(65279) + N'SIN RESPUESTA' UNION ALL
    SELECT N'NBSP en medio', N'SIN' + NCHAR(160) + N'RESPUESTA' UNION ALL
    SELECT N'NBSP al final', N'SIN RESPUESTA' + NCHAR(160) UNION ALL
    SELECT N'tabulador al final', N'SIN RESPUESTA' + NCHAR(9) UNION ALL
    SELECT N'salto de linea al final', N'SIN RESPUESTA' + NCHAR(13) + NCHAR(10) UNION ALL
    SELECT N'doble espacio', N'SIN  RESPUESTA' UNION ALL
    SELECT N'espacios al final', N'SIN RESPUESTA   ' UNION ALL
    SELECT N'minusculas', N'sin respuesta' UNION ALL
    SELECT N'punto final', N'SIN RESPUESTA.'
)
SELECT Seccion = N'0b. Igualdad como la vista', Caso,
       IgualEnQA = CASE WHEN UPPER(LTRIM(RTRIM(t.Txt))) = UPPER(LTRIM(RTRIM(N'SIN RESPUESTA'))) THEN 1 ELSE 0 END
FROM P
CROSS APPLY (SELECT Txt = CAST(P.V AS nvarchar(100)) COLLATE DATABASE_DEFAULT) AS t;

SELECT Seccion = N'0c. Acento como la vista',
       NavegacionAcento = CASE WHEN N'NAVEGACI' + NCHAR(211) + N'N' COLLATE DATABASE_DEFAULT = N'NAVEGACION' THEN 1 ELSE 0 END,
       LikeAcento = CASE WHEN N'FALLA DE NAVEGACI' + NCHAR(211) + N'N' COLLATE DATABASE_DEFAULT LIKE N'%NAVEGACION%' THEN 1 ELSE 0 END,
       LikeGuionBajoComodin = CASE WHEN N'ALTAXSAP' COLLATE DATABASE_DEFAULT LIKE N'%ALTA_SAP%' THEN 1 ELSE 0 END;
GO

/* ================================================================ 1
   Respuestas frecuentes sin patron. Familias por contenido (sin acentos,
   blancos normalizados) para no perder variantes; la clasificacion que se
   muestra es la de la vista, sin cambios. */
IF OBJECT_ID('tempdb..#F') IS NOT NULL DROP TABLE #F;
CREATE TABLE #F (Familia nvarchar(40) NOT NULL, Patron nvarchar(100) NOT NULL);
INSERT #F VALUES
    (N'ERROR exacto',        N'ERROR'),
    (N'ERROR al inicio',     N'ERROR %'),
    (N'CARGA DE PRECIOS',    N'%CARGA DE PRECIO%'),
    (N'ALTA SAP',            N'%ALTA SAP%'),
    (N'BRINDA CONTACTO',     N'%BRINDA%CONTACTO%'),
    (N'NAVEGACION',          N'%NAVEG%'),
    (N'NAVEGACION (dedo)',   N'%NAVEAG%');

/* Clave de familia: invisibles fuera, blancos a espacio, espacios
   colapsados. Solo para agrupar en esta seccion. Se guarda con la
   intercalacion de la base para poder compararla con los catalogos. */
IF OBJECT_ID('tempdb..#FT') IS NOT NULL DROP TABLE #FT;
SELECT t.*, Clave = CAST(LTRIM(RTRIM(
           REPLACE(REPLACE(REPLACE(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                   UPPER(CAST(t.Txt AS nvarchar(4000))) COLLATE Latin1_General_BIN,
                   NCHAR(8203), N''), NCHAR(8204), N''), NCHAR(8205), N''), NCHAR(8206), N''), NCHAR(8207), N''), NCHAR(65279), N''),
                   NCHAR(160), N' '), NCHAR(9), N' '), NCHAR(13), N' '), NCHAR(10), N' '),
               N' ', NCHAR(14) + NCHAR(15)), NCHAR(15) + NCHAR(14), N''), NCHAR(14) + NCHAR(15), N' '))) AS nvarchar(4000)) COLLATE DATABASE_DEFAULT
INTO #FT
FROM #T AS t
WHERE t.EstadoDescripcion <> 'SIN INFORMACION QARE';

/* 1a. Variantes tal como estan guardadas. Marcadores visibles: [ ] = inicio
   y fin reales, <ZW> ancho cero, <NBSP>, <TAB>, <CR>, <LF>, ~~ doble espacio. */
;WITH X AS (
    SELECT f.Familia, ft.*,
           Visible = N'[' + REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                         CAST(ft.Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN,
                         NCHAR(8203), N'<ZW>'), NCHAR(8204), N'<ZW>'), NCHAR(65279), N'<ZW>'),
                         NCHAR(160), N'<NBSP>'), NCHAR(9), N'<TAB>'), NCHAR(13), N'<CR>'), NCHAR(10), N'<LF>'),
                         N'  ', N'~~') + N']'
    FROM #F AS f
    JOIN #FT AS ft ON ft.Clave COLLATE Latin1_General_CI_AI LIKE f.Patron COLLATE Latin1_General_CI_AI
), G AS (
    SELECT Familia, Visible = LEFT(Visible, 150), Largo = LEN(Txt), EstadoDescripcion, Tipo, Clasif, IdReglaClasificacion,
           Tickets = COUNT(*), Firmas = COUNT(DISTINCT FirmaSolucion), Grupos = COUNT(DISTINCT Grupo),
           Rk = ROW_NUMBER() OVER (PARTITION BY Familia ORDER BY COUNT(*) DESC, LEFT(Visible, 150))
    FROM X
    GROUP BY Familia, LEFT(Visible, 150), LEN(Txt), EstadoDescripcion, Tipo, Clasif, IdReglaClasificacion
)
SELECT Seccion = N'1a. Variantes', Familia, Visible, Largo, EstadoDescripcion, Tipo, Clasif, IdReglaClasificacion, Tickets, Firmas, Grupos
FROM G WHERE Rk <= 30
ORDER BY Familia, Rk;

-- 1b. Totales por familia y resultado de la vista.
SELECT Seccion = N'1b. Familia x resultado', f.Familia, ft.EstadoDescripcion, ft.Tipo, ft.Clasif,
       Tickets = COUNT(*), TextosDistintos = COUNT(DISTINCT ft.Clave)
FROM #F AS f
JOIN #FT AS ft ON ft.Clave COLLATE Latin1_General_CI_AI LIKE f.Patron COLLATE Latin1_General_CI_AI
GROUP BY f.Familia, ft.EstadoDescripcion, ft.Tipo, ft.Clasif
ORDER BY f.Familia, Tickets DESC;

/* 1c. Contexto: donde se concentra cada familia. Si una familia sale casi
   toda de un grupo o categoria, el texto puede ser un rotulo de esa mesa y
   no una descripcion de la solucion. */
;WITH X AS (
    SELECT f.Familia, ft.*
    FROM #F AS f
    JOIN #FT AS ft ON ft.Clave COLLATE Latin1_General_CI_AI LIKE f.Patron COLLATE Latin1_General_CI_AI
), D AS (
    SELECT Familia, Dimension = N'Grupo', Valor = CAST(Grupo AS nvarchar(500)), Tickets = COUNT(*) FROM X GROUP BY Familia, Grupo
    UNION ALL SELECT Familia, N'Categoria', CAST(Categoria AS nvarchar(500)), COUNT(*) FROM X GROUP BY Familia, Categoria
    UNION ALL SELECT Familia, N'TipoSolucion', CAST(QARe_TipoSolucion AS nvarchar(500)), COUNT(*) FROM X GROUP BY Familia, QARe_TipoSolucion
    UNION ALL SELECT Familia, N'Causa', CAST(LEFT(QARe_Causa, 200) AS nvarchar(500)), COUNT(*) FROM X GROUP BY Familia, LEFT(QARe_Causa, 200)
    UNION ALL SELECT Familia, N'TipoTicket', CAST(TipoTicket AS nvarchar(500)), COUNT(*) FROM X GROUP BY Familia, TipoTicket
    UNION ALL SELECT Familia, N'FirmasDistintas', NULL, COUNT(DISTINCT FirmaSolucion) FROM X GROUP BY Familia
), R AS (
    SELECT *, Rk = ROW_NUMBER() OVER (PARTITION BY Familia, Dimension ORDER BY Tickets DESC, Valor) FROM D
)
SELECT Seccion = N'1c. Contexto', Familia, Dimension, Valor, Tickets
FROM R WHERE Rk <= 6
ORDER BY Familia, Dimension, Rk;

/* 1d. Ejemplos con contexto del ticket, los 6 mas recientes por familia.
   Titulo y solucion al usuario dicen que se hizo cuando la respuesta QARE
   no lo dice. */
;WITH X AS (
    SELECT f.Familia, ft.*,
           Rk = ROW_NUMBER() OVER (PARTITION BY f.Familia ORDER BY ft.FechaFirmaSolucion DESC, ft.CodigoTicket)
    FROM #F AS f
    JOIN #FT AS ft ON ft.Clave COLLATE Latin1_General_CI_AI LIKE f.Patron COLLATE Latin1_General_CI_AI
)
SELECT Seccion = N'1d. Ejemplos', Familia, CodigoTicket, Fecha = CAST(FechaFirmaSolucion AS date), Grupo,
       Categoria = LEFT(Categoria, 120), Texto = LEFT(Clave, 150), Clasif,
       QARe_TipoSolucion, Causa = LEFT(QARe_Causa, 60), Evidencia = LEFT(QARe_Evidencia, 80),
       Titulo = LEFT(Titulo, 150), SolucionUsuario = LEFT(SolucionUsuario, 200), MensajeError = LEFT(QA_MensajeError, 80)
FROM X WHERE Rk <= 6
ORDER BY Familia, Rk;

/* 1e. Que dicen los catalogos de cada familia (filas activas e inactivas).
   Busqueda amplia por palabra suelta para ver tambien las reglas apagadas
   o mal escritas que podrian haberla cubierto. */
;WITH Tok AS (
    SELECT * FROM (VALUES (N'ERROR', N'%ERROR%'), (N'CARGA DE PRECIOS', N'%CARGA%'), (N'CARGA DE PRECIOS', N'%PRECIO%'),
                          (N'ALTA SAP', N'%ALTA%'), (N'ALTA SAP', N'%SAP%'), (N'BRINDA CONTACTO', N'%CONTACT%'),
                          (N'NAVEGACION', N'%NAVEG%'), (N'NAVEGACION', N'%NAVEAG%')) AS v(Familia, Token)
)
SELECT DISTINCT Seccion = N'1e. CatQARE_PatronSolucion', k.Familia, p.IdRegla, p.TipoClasificacion, p.Patron, p.Orden,
       PalabraClave = N'[' + p.PalabraClave + N']', p.Activo
FROM Tok AS k
JOIN dbo.CatQARE_PatronSolucion AS p ON p.PalabraClave COLLATE Latin1_General_CI_AI LIKE k.Token
ORDER BY k.Familia, p.Activo DESC, p.TipoClasificacion, p.Orden, p.IdRegla;

SELECT Seccion = N'1e. CatQARE_RespuestaInvalida', r.IdRespuestaInvalida, r.Campo, Valor = N'[' + r.Valor + N']', r.Motivo, r.Activo
FROM dbo.CatQARE_RespuestaInvalida AS r
WHERE r.Valor COLLATE Latin1_General_CI_AI LIKE N'%ERROR%' OR r.Valor COLLATE Latin1_General_CI_AI LIKE N'%CONTACT%'
   OR r.Valor COLLATE Latin1_General_CI_AI LIKE N'%NAVEG%' OR r.Valor COLLATE Latin1_General_CI_AI LIKE N'%PRECIO%'
   OR r.Valor COLLATE Latin1_General_CI_AI LIKE N'%SAP%';
GO

/* ================================================================ 2
   Normalizacion. #N tiene una clave por texto distinto y por nivel:
     1 = la vista: UPPER(LTRIM(RTRIM())) para igualdad, UPPER(texto) para LIKE.
     2 = 1 + quita ancho cero/BOM, NBSP/TAB/CR/LF a espacio, recorta.
     3 = 2 + colapsa espacios repetidos.
     4 = 3 + compara sin acentos (Latin1_General_CI_AI).
     5 = 4 + quita hasta dos signos . , ; : al final.
     9 = nivel 1 con TODAS las reglas de CatQARE_PatronSolucion (activas e
         inactivas): mide que pasaria si se reactivaran.
   El catalogo se normaliza igual que el texto en cada nivel. Cada nivel
   cambia una sola cosa para que su efecto se lea solo. */
/* Intercalaciones: Txt va en binario (llave, ver #T.TxtB); K y KLike con
   la de la base, como la vista. Las columnas se declaran explicitas porque
   tempdb puede tener otra intercalacion y la comparacion fallaria o
   cambiaria de resultado. */
IF OBJECT_ID('tempdb..#Txt') IS NOT NULL DROP TABLE #Txt;
SELECT DISTINCT Txt = TxtB
INTO #Txt
FROM #T
WHERE Txt IS NOT NULL AND LTRIM(RTRIM(Txt)) <> N'';

CREATE TABLE #N (Nivel tinyint NOT NULL,
                 Txt nvarchar(4000) COLLATE Latin1_General_BIN2 NOT NULL,
                 K nvarchar(4000) COLLATE DATABASE_DEFAULT NOT NULL,
                 KLike nvarchar(4000) COLLATE DATABASE_DEFAULT NOT NULL);

INSERT #N SELECT 1, Txt, UPPER(LTRIM(RTRIM(Txt COLLATE DATABASE_DEFAULT))), UPPER(Txt COLLATE DATABASE_DEFAULT) FROM #Txt;
INSERT #N SELECT 9, Txt, UPPER(LTRIM(RTRIM(Txt COLLATE DATABASE_DEFAULT))), UPPER(Txt COLLATE DATABASE_DEFAULT) FROM #Txt;

INSERT #N
SELECT 2, Txt, k2, k2
FROM #Txt
CROSS APPLY (SELECT k2 = LTRIM(RTRIM(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        UPPER(Txt) COLLATE Latin1_General_BIN,
        NCHAR(8203), N''), NCHAR(8204), N''), NCHAR(8205), N''), NCHAR(8206), N''), NCHAR(8207), N''), NCHAR(65279), N''),
        NCHAR(160), N' '), NCHAR(9), N' '), NCHAR(13), N' '), NCHAR(10), N' ')))) AS a;

INSERT #N
SELECT 3, Txt, k3, k3
FROM #N AS n
CROSS APPLY (SELECT k3 = REPLACE(REPLACE(REPLACE(n.K COLLATE Latin1_General_BIN,
                 N' ', NCHAR(14) + NCHAR(15)), NCHAR(15) + NCHAR(14), N''), NCHAR(14) + NCHAR(15), N' ')) AS a
WHERE n.Nivel = 2;

INSERT #N SELECT 4, Txt, K, KLike FROM #N WHERE Nivel = 3;

INSERT #N
SELECT 5, n.Txt, k5, k5
FROM #N AS n
CROSS APPLY (SELECT k1 = CASE WHEN RIGHT(n.K, 1) IN (N'.', N',', N';', N':') THEN RTRIM(LEFT(n.K, LEN(n.K) - 1)) ELSE n.K END) AS a
CROSS APPLY (SELECT k5 = CASE WHEN RIGHT(a.k1, 1) IN (N'.', N',', N';', N':') THEN RTRIM(LEFT(a.k1, LEN(a.k1) - 1)) ELSE a.k1 END) AS b
WHERE n.Nivel = 4;

-- Catalogos normalizados por nivel (mismas transformaciones).
IF OBJECT_ID('tempdb..#CatP') IS NOT NULL DROP TABLE #CatP;
SELECT lv.Nivel, p.IdRegla, p.Orden, p.Patron, p.TipoClasificacion, p.Activo, p.PalabraClave,
       KEq = CAST(CASE WHEN lv.Nivel IN (1, 9) THEN CAST(UPPER(LTRIM(RTRIM(p.PalabraClave))) AS nvarchar(400)) COLLATE Latin1_General_BIN
                       ELSE c3.k END AS nvarchar(400)) COLLATE DATABASE_DEFAULT,
       KLk = CAST(CASE WHEN lv.Nivel IN (1, 9) THEN CAST(UPPER(p.PalabraClave) AS nvarchar(400)) COLLATE Latin1_General_BIN
                       ELSE c3.k END AS nvarchar(400)) COLLATE DATABASE_DEFAULT
INTO #CatP
FROM dbo.CatQARE_PatronSolucion AS p
CROSS JOIN (VALUES (1), (2), (3), (4), (5), (9)) AS lv(Nivel)
CROSS APPLY (SELECT k = LTRIM(RTRIM(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        UPPER(CAST(p.PalabraClave AS nvarchar(400))) COLLATE Latin1_General_BIN,
        NCHAR(8203), N''), NCHAR(8204), N''), NCHAR(8205), N''), NCHAR(8206), N''), NCHAR(8207), N''), NCHAR(65279), N''),
        NCHAR(160), N' '), NCHAR(9), N' '), NCHAR(13), N' '), NCHAR(10), N' ')))) AS c2
CROSS APPLY (SELECT k = CASE WHEN lv.Nivel = 2 THEN c2.k
                             ELSE REPLACE(REPLACE(REPLACE(c2.k, N' ', NCHAR(14) + NCHAR(15)), NCHAR(15) + NCHAR(14), N''), NCHAR(14) + NCHAR(15), N' ') END) AS c3
WHERE p.PalabraClave IS NOT NULL
  AND (p.Activo = 1 OR lv.Nivel = 9);

IF OBJECT_ID('tempdb..#CatI') IS NOT NULL DROP TABLE #CatI;
SELECT lv.Nivel, r.IdRespuestaInvalida, r.Valor,
       KEq = CAST(CASE WHEN lv.Nivel IN (1, 9) THEN CAST(UPPER(LTRIM(RTRIM(r.Valor))) AS nvarchar(400)) COLLATE Latin1_General_BIN
                  ELSE REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                           UPPER(CAST(r.Valor AS nvarchar(400))) COLLATE Latin1_General_BIN,
                           NCHAR(8203), N''), NCHAR(8204), N''), NCHAR(65279), N''), NCHAR(160), N' '), NCHAR(9), N' '), NCHAR(10), N' '))),
                           N' ', NCHAR(14) + NCHAR(15)), NCHAR(15) + NCHAR(14), N''), NCHAR(14) + NCHAR(15), N' ') END
                  AS nvarchar(400)) COLLATE DATABASE_DEFAULT
INTO #CatI
FROM dbo.CatQARE_RespuestaInvalida AS r
CROSS JOIN (VALUES (1), (2), (3), (4), (5), (9)) AS lv(Nivel)
WHERE r.Campo = 'QARe_DescripcionSolucion' AND r.Activo = 1 AND r.Valor IS NOT NULL;

/* Clasificacion por nivel con el orden de la vista: invalida (catalogo o
   solo signos) > CALIDAD exacta > PATRON_SOLUCION por LIKE > SIN PATRON.
   Desempate igual que la vista: Orden, frase mas larga, IdRegla. Los
   niveles 4 y 5 comparan con Latin1_General_CI_AI; los demas con la
   intercalacion de la base, como la vista. */
SELECT n.Nivel, n.Txt, n.K,
       Estado = CASE WHEN n.K = N'' THEN 'VACIO TRAS NORMALIZAR'
                     WHEN inv.Id IS NOT NULL OR sg.SoloSignos = 1 THEN 'NO EVALUABLE'
                     ELSE 'TEXTO EVALUABLE' END,
       Tipo = CASE WHEN n.K = N'' OR inv.Id IS NOT NULL OR sg.SoloSignos = 1 THEN NULL
                   WHEN cal.IdRegla IS NOT NULL THEN 'CALIDAD'
                   WHEN pat.IdRegla IS NOT NULL THEN 'PATRON_SOLUCION'
                   ELSE 'SIN PATRON' END,
       Clasif = CASE WHEN n.K = N'' OR inv.Id IS NOT NULL OR sg.SoloSignos = 1 THEN NULL
                     WHEN cal.IdRegla IS NOT NULL THEN cal.Patron
                     WHEN pat.IdRegla IS NOT NULL THEN pat.Patron
                     ELSE 'SIN PATRON IDENTIFICADO' END,
       IdRegla = CASE WHEN n.K = N'' OR inv.Id IS NOT NULL OR sg.SoloSignos = 1 THEN NULL
                      ELSE COALESCE(cal.IdRegla, pat.IdRegla) END,
       IdInvalida = inv.Id
INTO #C
FROM #N AS n
CROSS APPLY (SELECT SoloSignos = CASE WHEN LTRIM(RTRIM(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            CASE WHEN n.Nivel IN (1, 9) THEN n.Txt COLLATE DATABASE_DEFAULT ELSE n.K END,
            '.', ''), ',', ''), '*', ''), '-', ''), '_', ''), '/', ''), '\', ''), ';', ''), ':', ''), CHAR(9), ''), ' ', ''))) = ''
        THEN 1 ELSE 0 END) AS sg
OUTER APPLY (SELECT TOP (1) Id = i.IdRespuestaInvalida FROM #CatI AS i
             WHERE i.Nivel = n.Nivel
               AND (   (n.Nivel IN (1, 2, 3, 9) AND i.KEq = n.K)
                    OR (n.Nivel IN (4, 5) AND i.KEq COLLATE Latin1_General_CI_AI = n.K COLLATE Latin1_General_CI_AI))
             ORDER BY i.IdRespuestaInvalida) AS inv
OUTER APPLY (SELECT TOP (1) p.IdRegla, p.Patron FROM #CatP AS p
             WHERE p.Nivel = n.Nivel AND p.TipoClasificacion = 'CALIDAD'
               AND (   (n.Nivel IN (1, 2, 3, 9) AND p.KEq = n.K)
                    OR (n.Nivel IN (4, 5) AND p.KEq COLLATE Latin1_General_CI_AI = n.K COLLATE Latin1_General_CI_AI))
             ORDER BY p.Orden, LEN(p.PalabraClave) DESC, p.IdRegla) AS cal
OUTER APPLY (SELECT TOP (1) p.IdRegla, p.Patron FROM #CatP AS p
             WHERE p.Nivel = n.Nivel AND p.TipoClasificacion = 'PATRON_SOLUCION'
               AND (   (n.Nivel IN (1, 2, 3, 9) AND n.KLike LIKE N'%' + p.KLk + N'%')
                    OR (n.Nivel IN (4, 5) AND n.KLike COLLATE Latin1_General_CI_AI LIKE N'%' + p.KLk + N'%' COLLATE Latin1_General_CI_AI))
             ORDER BY p.Orden, LEN(p.PalabraClave) DESC, p.IdRegla) AS pat;

/* 2a. Control: el nivel 1 debe dar lo mismo que la vista ticket por
   ticket. Diferencias > 0 = este simulador no replica la vista y las
   secciones 2b-2e no son validas. */
SELECT Seccion = N'2a. Nivel 1 contra la vista',
       Tickets = COUNT(*),
       Diferencias = SUM(CASE WHEN ISNULL(c.Estado, '') <> ISNULL(t.EstadoDescripcion, '')
                                OR ISNULL(c.Tipo, '') <> ISNULL(t.Tipo, '')
                                OR ISNULL(c.Clasif, '') <> ISNULL(t.Clasif, '') THEN 1 ELSE 0 END)
FROM #T AS t
JOIN #C AS c ON c.Nivel = 1 AND c.Txt = t.TxtB
WHERE t.EstadoDescripcion <> 'SIN INFORMACION QARE';

SELECT TOP (20) Seccion = N'2a. Diferencias (muestra)', t.CodigoTicket, Texto = LEFT(c.K, 100),
       VistaEstado = t.EstadoDescripcion, VistaClasif = t.Clasif, SimEstado = c.Estado, SimClasif = c.Clasif
FROM #T AS t
JOIN #C AS c ON c.Nivel = 1 AND c.Txt = t.TxtB
WHERE t.EstadoDescripcion <> 'SIN INFORMACION QARE'
  AND (ISNULL(c.Estado, '') <> ISNULL(t.EstadoDescripcion, '') OR ISNULL(c.Clasif, '') <> ISNULL(t.Clasif, ''));

-- 2b. Totales por nivel (tickets, no textos).
SELECT Seccion = N'2b. Totales por nivel', c.Nivel, c.Estado, c.Tipo, Tickets = COUNT(*)
FROM #T AS t
JOIN #C AS c ON c.Txt = t.TxtB
GROUP BY c.Nivel, c.Estado, c.Tipo
ORDER BY c.Nivel, c.Estado, c.Tipo;

/* 2c. Transiciones entre niveles consecutivos (1->2, 2->3, 3->4, 4->5) y
   1->9: cuantos tickets cambian y hacia donde. */
;WITH Par AS (
    SELECT * FROM (VALUES (1, 2), (2, 3), (3, 4), (4, 5), (1, 9)) AS v(Desde, Hasta)
)
SELECT Seccion = N'2c. Transiciones', Paso = CONCAT(p.Desde, '->', p.Hasta),
       Antes = ISNULL(a.Clasif, a.Estado), Despues = ISNULL(b.Clasif, b.Estado),
       Tickets = COUNT(*), Textos = COUNT(DISTINCT a.Txt)
FROM Par AS p
JOIN #C AS a ON a.Nivel = p.Desde
JOIN #C AS b ON b.Nivel = p.Hasta AND b.Txt = a.Txt
JOIN #T AS t ON t.TxtB = a.Txt
WHERE ISNULL(a.Clasif, a.Estado) <> ISNULL(b.Clasif, b.Estado)
GROUP BY p.Desde, p.Hasta, ISNULL(a.Clasif, a.Estado), ISNULL(b.Clasif, b.Estado)
ORDER BY p.Desde, p.Hasta, Tickets DESC;

/* 2d. Textos que cambian en cada paso, para revisar si el cambio respeta
   el significado. Un texto que pasa de SIN PATRON a un patron por quitar
   un acento es tecnico; uno que pasa de patron a otro patron hay que
   leerlo. */
;WITH Par AS (
    SELECT * FROM (VALUES (1, 2), (2, 3), (3, 4), (4, 5), (1, 9)) AS v(Desde, Hasta)
), X AS (
    SELECT Paso = CONCAT(p.Desde, '->', p.Hasta), Texto = LEFT(a.K, 120),
           Antes = ISNULL(a.Clasif, a.Estado), Despues = ISNULL(b.Clasif, b.Estado),
           ReglaDespues = b.IdRegla, InvalidaDespues = b.IdInvalida,
           Tickets = (SELECT COUNT(*) FROM #T AS t WHERE t.TxtB = a.Txt)
    FROM Par AS p
    JOIN #C AS a ON a.Nivel = p.Desde
    JOIN #C AS b ON b.Nivel = p.Hasta AND b.Txt = a.Txt
    WHERE ISNULL(a.Clasif, a.Estado) <> ISNULL(b.Clasif, b.Estado)
), R AS (
    SELECT *, Rk = ROW_NUMBER() OVER (PARTITION BY Paso ORDER BY Tickets DESC, Texto) FROM X
)
SELECT Seccion = N'2d. Textos que cambian', Paso, Texto, Antes, Despues, ReglaDespues, InvalidaDespues, Tickets
FROM R WHERE Rk <= 40
ORDER BY Paso, Rk;

/* 2e. Inventario de caracteres en el texto lleno (no SIN INFORMACION).
   LIKE con BIN para que la intercalacion no ignore los invisibles. */
SELECT Seccion = N'2e. Caracteres',
       TextoLleno = COUNT(*),
       AnchoCero = SUM(CASE WHEN CAST(Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN LIKE N'%[' + NCHAR(8203) + NCHAR(8204) + NCHAR(8205) + NCHAR(8206) + NCHAR(8207) + NCHAR(65279) + N']%' THEN 1 ELSE 0 END),
       AnchoCeroAlInicio = SUM(CASE WHEN LEFT(CAST(Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN, 1) IN (NCHAR(8203), NCHAR(8204), NCHAR(8205), NCHAR(65279)) THEN 1 ELSE 0 END),
       NBSP = SUM(CASE WHEN CHARINDEX(NCHAR(160), CAST(Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN) > 0 THEN 1 ELSE 0 END),
       Tab = SUM(CASE WHEN CHARINDEX(NCHAR(9), CAST(Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN) > 0 THEN 1 ELSE 0 END),
       SaltoLinea = SUM(CASE WHEN CAST(Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN LIKE N'%[' + NCHAR(10) + NCHAR(13) + N']%' THEN 1 ELSE 0 END),
       EspacioInicio = SUM(CASE WHEN LEFT(CAST(Txt AS nvarchar(4000)), 1) = N' ' AND DATALENGTH(LEFT(CAST(Txt AS nvarchar(4000)), 1)) = 2 THEN 1 ELSE 0 END),
       EspacioFinal = SUM(CASE WHEN DATALENGTH(CAST(Txt AS nvarchar(4000))) > DATALENGTH(RTRIM(CAST(Txt AS nvarchar(4000)))) THEN 1 ELSE 0 END),
       DobleEspacio = SUM(CASE WHEN CHARINDEX(N'  ', LTRIM(RTRIM(CAST(Txt AS nvarchar(4000))))) > 0 THEN 1 ELSE 0 END),
       Minusculas = SUM(CASE WHEN CAST(Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN <> UPPER(CAST(Txt AS nvarchar(4000))) COLLATE Latin1_General_BIN THEN 1 ELSE 0 END),
       SignoFinal = SUM(CASE WHEN RIGHT(RTRIM(CAST(Txt AS nvarchar(4000))), 1) IN (N'.', N',', N';', N':') THEN 1 ELSE 0 END)
FROM #T
WHERE EstadoDescripcion <> 'SIN INFORMACION QARE';

-- 2e2. Cuantos de esos tickets cambia la vista hoy por cada rasgo (vista vs nivel 5).
SELECT Seccion = N'2e2. Rasgo que cambia clasificacion',
       Rasgo = CASE WHEN CAST(t.Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN LIKE N'%[' + NCHAR(8203) + NCHAR(8204) + NCHAR(8205) + NCHAR(65279) + N']%' THEN N'ancho cero'
                    WHEN CAST(t.Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN LIKE N'%[' + NCHAR(160) + NCHAR(9) + NCHAR(10) + NCHAR(13) + N']%' THEN N'NBSP/TAB/salto'
                    WHEN CHARINDEX(N'  ', LTRIM(RTRIM(CAST(t.Txt AS nvarchar(4000))))) > 0 THEN N'doble espacio'
                    WHEN RIGHT(RTRIM(CAST(t.Txt AS nvarchar(4000))), 1) IN (N'.', N',', N';', N':') THEN N'signo final'
                    ELSE N'acento u otro' END,
       Tickets = COUNT(*)
FROM #T AS t
JOIN #C AS a ON a.Nivel = 1 AND a.Txt = t.TxtB
JOIN #C AS b ON b.Nivel = 5 AND b.Txt = a.Txt
WHERE ISNULL(a.Clasif, a.Estado) <> ISNULL(b.Clasif, b.Estado)
GROUP BY CASE WHEN CAST(t.Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN LIKE N'%[' + NCHAR(8203) + NCHAR(8204) + NCHAR(8205) + NCHAR(65279) + N']%' THEN N'ancho cero'
              WHEN CAST(t.Txt AS nvarchar(4000)) COLLATE Latin1_General_BIN LIKE N'%[' + NCHAR(160) + NCHAR(9) + NCHAR(10) + NCHAR(13) + N']%' THEN N'NBSP/TAB/salto'
              WHEN CHARINDEX(N'  ', LTRIM(RTRIM(CAST(t.Txt AS nvarchar(4000))))) > 0 THEN N'doble espacio'
              WHEN RIGHT(RTRIM(CAST(t.Txt AS nvarchar(4000))), 1) IN (N'.', N',', N';', N':') THEN N'signo final'
              ELSE N'acento u otro' END;

/* 2f. Higiene del catalogo de patrones: espacios al borde (con LIKE un
   espacio final exige un espacio en el texto), comodines de LIKE dentro de
   la frase (_ % [ ), y frases que se vuelven iguales sin acentos pero con
   Patron, Orden o Activo distintos. */
SELECT Seccion = N'2f. Frases con bordes o comodines', IdRegla, TipoClasificacion, Patron, Orden, Activo,
       PalabraClave = N'[' + PalabraClave + N']',
       Rasgo = CONCAT(CASE WHEN PalabraClave LIKE N' %' THEN N'espacio inicial ' END,
                      CASE WHEN DATALENGTH(PalabraClave) > DATALENGTH(RTRIM(PalabraClave)) THEN N'espacio final ' END,
                      CASE WHEN CHARINDEX(N'  ', PalabraClave) > 0 THEN N'doble espacio ' END,
                      CASE WHEN PalabraClave LIKE N'%[_]%' THEN N'comodin _ ' END,
                      CASE WHEN PalabraClave LIKE N'%[%]%' THEN N'comodin % ' END,
                      CASE WHEN PalabraClave LIKE N'%[[]%' THEN N'corchete ' END)
FROM dbo.CatQARE_PatronSolucion
WHERE PalabraClave LIKE N' %' OR DATALENGTH(PalabraClave) > DATALENGTH(RTRIM(PalabraClave))
   OR CHARINDEX(N'  ', PalabraClave) > 0 OR PalabraClave LIKE N'%[_]%' OR PalabraClave LIKE N'%[%]%' OR PalabraClave LIKE N'%[[]%'
ORDER BY IdRegla;

;WITH P AS (
    SELECT IdRegla, TipoClasificacion, Patron, Orden, Activo,
           K = UPPER(LTRIM(RTRIM(PalabraClave))) COLLATE Latin1_General_CI_AI
    FROM dbo.CatQARE_PatronSolucion
)
SELECT Seccion = N'2f. Frases iguales sin acento', K = MIN(K), Filas = COUNT(*),
       Patrones = COUNT(DISTINCT Patron), Ordenes = COUNT(DISTINCT Orden), Tipos = COUNT(DISTINCT TipoClasificacion),
       Activas = SUM(CASE WHEN Activo = 1 THEN 1 ELSE 0 END),
       Ids = STRING_AGG(CONVERT(nvarchar(20), IdRegla), N',')
FROM P
GROUP BY K
HAVING COUNT(*) > 1
ORDER BY CASE WHEN COUNT(DISTINCT Patron) > 1 OR COUNT(DISTINCT Orden) > 1
                OR (SUM(CASE WHEN Activo = 1 THEN 1 ELSE 0 END) BETWEEN 1 AND COUNT(*) - 1) THEN 0 ELSE 1 END, K;

/* 2g. Frases PATRON_SOLUCION activas que tapan a otra: una frase contenida
   en otra frase de otro patron con Orden menor o igual gana siempre que el
   texto contiene la larga (ejemplo: 'CONTRASE' dentro de 'NUEVA
   CONTRASENA'). Solo pares con patron distinto. */
SELECT TOP (60) Seccion = N'2g. Frase corta que gana a una larga',
       Corta = a.PalabraClave, PatronCorta = a.Patron, OrdenCorta = a.Orden,
       Larga = b.PalabraClave, PatronLarga = b.Patron, OrdenLarga = b.Orden
FROM dbo.CatQARE_PatronSolucion AS a
JOIN dbo.CatQARE_PatronSolucion AS b
  ON b.IdRegla <> a.IdRegla AND b.Patron <> a.Patron
 AND UPPER(b.PalabraClave) LIKE N'%' + UPPER(a.PalabraClave) + N'%'
 AND a.Orden < b.Orden
WHERE a.Activo = 1 AND b.Activo = 1
  AND a.TipoClasificacion = 'PATRON_SOLUCION' AND b.TipoClasificacion = 'PATRON_SOLUCION'
ORDER BY a.Orden, a.PalabraClave;
GO

/* ================================================================ 3
   Reglas existentes. Clasificacion de la vista, sin cambios; #FT trae la
   clave sin invisibles ni espacios repetidos. */

/* 3a. NO SALE ERROR. Tambien se cruza con QA_MensajeError del mismo
   ticket: si alli tambien dice "no sale error", la respuesta puede venir
   de copiar el formulario de alta y no describir la solucion. */
SELECT Seccion = N'3a. NO SALE ERROR variantes',
       Visible = LEFT(N'[' + REPLACE(CAST(Txt AS nvarchar(4000)), N'  ', N'~~') + N']', 120),
       EsTextoCompleto = CASE WHEN Clave COLLATE Latin1_General_CI_AI = N'NO SALE ERROR' THEN 1 ELSE 0 END,
       EstadoDescripcion, Tipo, Clasif, IdReglaClasificacion, FraseClasificacion,
       Tickets = COUNT(*), Firmas = COUNT(DISTINCT FirmaSolucion), Grupos = COUNT(DISTINCT Grupo)
FROM #FT
WHERE Clave COLLATE Latin1_General_CI_AI LIKE N'%NO SALE ERROR%'
GROUP BY LEFT(N'[' + REPLACE(CAST(Txt AS nvarchar(4000)), N'  ', N'~~') + N']', 120),
         CASE WHEN Clave COLLATE Latin1_General_CI_AI = N'NO SALE ERROR' THEN 1 ELSE 0 END,
         EstadoDescripcion, Tipo, Clasif, IdReglaClasificacion, FraseClasificacion
ORDER BY Tickets DESC;

;WITH X AS (SELECT * FROM #FT WHERE Clave COLLATE Latin1_General_CI_AI = N'NO SALE ERROR')
SELECT Seccion = N'3a2. NO SALE ERROR contexto', Dimension, Valor, Tickets
FROM (
    SELECT Dimension = N'Grupo', Valor = CAST(Grupo AS nvarchar(500)), Tickets = COUNT(*) FROM X GROUP BY Grupo
    UNION ALL SELECT N'Categoria', CAST(LEFT(Categoria, 200) AS nvarchar(500)), COUNT(*) FROM X GROUP BY LEFT(Categoria, 200)
    UNION ALL SELECT N'TipoSolucion', CAST(QARe_TipoSolucion AS nvarchar(500)), COUNT(*) FROM X GROUP BY QARe_TipoSolucion
    UNION ALL SELECT N'Causa', CAST(LEFT(QARe_Causa, 200) AS nvarchar(500)), COUNT(*) FROM X GROUP BY LEFT(QARe_Causa, 200)
    UNION ALL SELECT N'MensajeErrorTambienNoSale',
                     CASE WHEN QA_MensajeError COLLATE Latin1_General_CI_AI LIKE N'%NO%SALE%ERROR%' THEN N'si' ELSE N'no' END, COUNT(*)
              FROM X GROUP BY CASE WHEN QA_MensajeError COLLATE Latin1_General_CI_AI LIKE N'%NO%SALE%ERROR%' THEN N'si' ELSE N'no' END
    UNION ALL SELECT N'FirmasDistintas', NULL, COUNT(DISTINCT FirmaSolucion) FROM X
) AS d
ORDER BY Dimension, Tickets DESC;

;WITH X AS (SELECT *, Rk = ROW_NUMBER() OVER (ORDER BY FechaFirmaSolucion DESC, CodigoTicket)
            FROM #FT WHERE Clave COLLATE Latin1_General_CI_AI = N'NO SALE ERROR')
SELECT Seccion = N'3a3. NO SALE ERROR ejemplos', CodigoTicket, Fecha = CAST(FechaFirmaSolucion AS date), Grupo,
       Categoria = LEFT(Categoria, 120), QARe_TipoSolucion, Causa = LEFT(QARe_Causa, 60),
       Titulo = LEFT(Titulo, 150), SolucionUsuario = LEFT(SolucionUsuario, 200), MensajeError = LEFT(QA_MensajeError, 80)
FROM X WHERE Rk <= 8;

/* 3b. Texto igual al tipo de solucion declarado (o que empieza con el).
   El catalogo no tiene una regla general para esto: depende de que cada
   rotulo este cargado como frase. */
;WITH X AS (
    SELECT ft.*,
           TipoK = UPPER(LTRIM(RTRIM(ft.QARe_TipoSolucion))) COLLATE Latin1_General_CI_AI
    FROM #FT AS ft
    WHERE ft.QARe_TipoSolucion IS NOT NULL AND LTRIM(RTRIM(ft.QARe_TipoSolucion)) <> N''
)
SELECT Seccion = N'3b. Texto = tipo declarado',
       Relacion = CASE WHEN Clave COLLATE Latin1_General_CI_AI = TipoK THEN N'igual'
                       WHEN Clave COLLATE Latin1_General_CI_AI LIKE TipoK + N'%' THEN N'empieza con el tipo'
                       WHEN TipoK LIKE Clave COLLATE Latin1_General_CI_AI + N'%' AND LEN(Clave) >= 10 THEN N'tipo truncado' END,
       QARe_TipoSolucion, EstadoDescripcion, Tipo, Clasif, Tickets = COUNT(*)
FROM X
WHERE Clave COLLATE Latin1_General_CI_AI = TipoK
   OR Clave COLLATE Latin1_General_CI_AI LIKE TipoK + N'%'
   OR (TipoK LIKE Clave COLLATE Latin1_General_CI_AI + N'%' AND LEN(Clave) >= 10)
GROUP BY CASE WHEN Clave COLLATE Latin1_General_CI_AI = TipoK THEN N'igual'
              WHEN Clave COLLATE Latin1_General_CI_AI LIKE TipoK + N'%' THEN N'empieza con el tipo'
              WHEN TipoK LIKE Clave COLLATE Latin1_General_CI_AI + N'%' AND LEN(Clave) >= 10 THEN N'tipo truncado' END,
         QARe_TipoSolucion, EstadoDescripcion, Tipo, Clasif
ORDER BY Tickets DESC;

-- 3b2. Catalogo de tipos declarados en la ventana (para ver los rotulos completos).
SELECT Seccion = N'3b2. QARe_TipoSolucion', QARe_TipoSolucion, Tickets = COUNT(*)
FROM #T
GROUP BY QARe_TipoSolucion
ORDER BY Tickets DESC;

/* 3c. Exacto contra parcial en reglas CALIDAD activas: tickets que la
   regla atrapa por igualdad y tickets que contienen la misma frase con mas
   texto, y a donde fueron estos ultimos. */
;WITH R AS (
    SELECT IdRegla, Patron, PalabraClave, K = UPPER(LTRIM(RTRIM(PalabraClave)))
    FROM dbo.CatQARE_PatronSolucion
    WHERE Activo = 1 AND TipoClasificacion = 'CALIDAD'
), M AS (
    SELECT r.IdRegla, r.Patron, r.PalabraClave,
           Exacto = SUM(CASE WHEN t.IdReglaClasificacion = r.IdRegla THEN 1 ELSE 0 END),
           Contiene = SUM(CASE WHEN t.IdReglaClasificacion <> r.IdRegla OR t.IdReglaClasificacion IS NULL THEN 1 ELSE 0 END),
           ContieneSinPatron = SUM(CASE WHEN (t.IdReglaClasificacion <> r.IdRegla OR t.IdReglaClasificacion IS NULL) AND t.Tipo = 'SIN PATRON' THEN 1 ELSE 0 END),
           ContienePatron = SUM(CASE WHEN (t.IdReglaClasificacion <> r.IdRegla OR t.IdReglaClasificacion IS NULL) AND t.Tipo = 'PATRON_SOLUCION' THEN 1 ELSE 0 END),
           ContieneOtraCalidad = SUM(CASE WHEN (t.IdReglaClasificacion <> r.IdRegla OR t.IdReglaClasificacion IS NULL) AND t.Tipo = 'CALIDAD' THEN 1 ELSE 0 END)
    FROM R AS r
    JOIN #FT AS t ON t.Clave LIKE N'%' + r.K + N'%'
    WHERE t.EstadoDescripcion = 'TEXTO EVALUABLE'
    GROUP BY r.IdRegla, r.Patron, r.PalabraClave
)
SELECT Seccion = N'3c. CALIDAD exacto vs parcial', *
FROM M
WHERE Contiene > 0
ORDER BY Contiene DESC, IdRegla;

-- 3c2. Ejemplos de textos parciales de las reglas CALIDAD con mas casos.
;WITH R AS (
    SELECT IdRegla, Patron, K = UPPER(LTRIM(RTRIM(PalabraClave)))
    FROM dbo.CatQARE_PatronSolucion
    WHERE Activo = 1 AND TipoClasificacion = 'CALIDAD'
), X AS (
    SELECT r.IdRegla, FraseCalidad = r.K, Texto = LEFT(t.Clave, 120), t.Tipo, t.Clasif, Tickets = COUNT(*)
    FROM R AS r
    JOIN #FT AS t ON t.Clave LIKE N'%' + r.K + N'%'
    WHERE t.EstadoDescripcion = 'TEXTO EVALUABLE' AND (t.IdReglaClasificacion <> r.IdRegla OR t.IdReglaClasificacion IS NULL)
    GROUP BY r.IdRegla, r.K, LEFT(t.Clave, 120), t.Tipo, t.Clasif
), Rk AS (
    SELECT *, N = ROW_NUMBER() OVER (PARTITION BY IdRegla ORDER BY Tickets DESC, Texto),
           TotRegla = SUM(Tickets) OVER (PARTITION BY IdRegla) FROM X
)
SELECT TOP (120) Seccion = N'3c2. Parciales (ejemplos)', IdRegla, FraseCalidad, Texto, Tipo, Clasif, Tickets
FROM Rk WHERE N <= 5
ORDER BY TotRegla DESC, IdRegla, N;

/* 3d. Reglas inactivas: tickets evaluables que cada una atraparia (misma
   comparacion que la vista: igualdad para CALIDAD, LIKE para patron) y que
   tienen hoy. Muchos casos en "PATRON_SOLUCION" hoy = la regla coincidia
   de mas o es redundante; muchos en "SIN PATRON" = deja huecos. */
;WITH R AS (
    SELECT IdRegla, TipoClasificacion, Patron, Orden, PalabraClave
    FROM dbo.CatQARE_PatronSolucion
    WHERE Activo = 0 AND PalabraClave IS NOT NULL
), M AS (
    SELECT r.IdRegla, r.TipoClasificacion, r.Patron, r.Orden, PalabraClave = N'[' + r.PalabraClave + N']', t.Tipo, Tickets = COUNT(*),
           Ejemplo = MIN(LEFT(t.Clave, 80))
    FROM R AS r
    JOIN #T AS t0 ON t0.EstadoDescripcion = 'TEXTO EVALUABLE'
    JOIN #FT AS t ON t.CodigoTicket = t0.CodigoTicket
    WHERE (r.TipoClasificacion = 'CALIDAD' AND UPPER(LTRIM(RTRIM(t0.Txt))) = UPPER(LTRIM(RTRIM(r.PalabraClave))))
       OR (r.TipoClasificacion = 'PATRON_SOLUCION' AND UPPER(t0.Txt) LIKE N'%' + UPPER(r.PalabraClave) + N'%')
    GROUP BY r.IdRegla, r.TipoClasificacion, r.Patron, r.Orden, r.PalabraClave, t.Tipo
)
SELECT Seccion = N'3d. Reglas inactivas', *
FROM M
ORDER BY IdRegla, Tipo;

-- 3d2. Textos SIN PATRON que una regla inactiva atraparia: los 5 mas frecuentes por regla.
;WITH R AS (
    SELECT IdRegla, Patron, PalabraClave FROM dbo.CatQARE_PatronSolucion
    WHERE Activo = 0 AND TipoClasificacion = 'PATRON_SOLUCION' AND PalabraClave IS NOT NULL
), X AS (
    SELECT r.IdRegla, r.Patron, r.PalabraClave, Texto = LEFT(t.Clave, 120), Tickets = COUNT(*)
    FROM R AS r
    JOIN #FT AS t ON t.Tipo = 'SIN PATRON' AND UPPER(t.Txt) LIKE N'%' + UPPER(r.PalabraClave) + N'%'
    GROUP BY r.IdRegla, r.Patron, r.PalabraClave, LEFT(t.Clave, 120)
), Rk AS (SELECT *, N = ROW_NUMBER() OVER (PARTITION BY IdRegla ORDER BY Tickets DESC, Texto) FROM X)
SELECT Seccion = N'3d2. Huecos de reglas inactivas', IdRegla, Patron, PalabraClave, Texto, Tickets
FROM Rk WHERE N <= 5
ORDER BY IdRegla, N;

-- 3d3. Valores inactivos del catalogo de invalidas que hoy coinciden con textos evaluables.
SELECT Seccion = N'3d3. Invalidas inactivas', r.IdRespuestaInvalida, Valor = N'[' + r.Valor + N']', r.Motivo,
       t.Tipo, t.Clasif, Tickets = COUNT(*)
FROM dbo.CatQARE_RespuestaInvalida AS r
JOIN #T AS t ON UPPER(LTRIM(RTRIM(t.Txt))) = UPPER(LTRIM(RTRIM(r.Valor)))
WHERE r.Campo = 'QARe_DescripcionSolucion' AND r.Activo = 0
GROUP BY r.IdRespuestaInvalida, r.Valor, r.Motivo, t.Tipo, t.Clasif
ORDER BY Tickets DESC;

-- 3e. Familia "sin respuesta": todas las formas y como cae cada una.
SELECT Seccion = N'3e. SIN RESPUESTA', Texto = LEFT(Clave, 120), EstadoDescripcion, Tipo, Clasif, IdReglaClasificacion,
       Tickets = COUNT(*)
FROM #FT
WHERE Clave COLLATE Latin1_General_CI_AI LIKE N'%SIN RESPUESTA%'
   OR Clave COLLATE Latin1_General_CI_AI LIKE N'%NO HAY RESPUESTA%'
   OR Clave COLLATE Latin1_General_CI_AI LIKE N'%NO RESPONDE%'
   OR Clave COLLATE Latin1_General_CI_AI LIKE N'%NO CONTESTA%'
GROUP BY LEFT(Clave, 120), EstadoDescripcion, Tipo, Clasif, IdReglaClasificacion
HAVING COUNT(*) >= 2
ORDER BY Tickets DESC;
GO

/* ================================================================ 4
   Consistencia entre los cuatro SP. */

-- 4a. Cuerpos completos (la cuadricula trunca OBJECT_DEFINITION).
;WITH M AS (
    SELECT Objeto = o.name, Def = REPLACE(OBJECT_DEFINITION(o.object_id), NCHAR(13), N'') + NCHAR(10)
    FROM sys.objects AS o
    WHERE o.object_id IN (OBJECT_ID('dbo.usp_QARE_CalidadCaptura_KPIs'), OBJECT_ID('dbo.usp_QARE_CalidadCaptura_Tecnicos'),
                          OBJECT_ID('dbo.usp_QARE_PatronesSolucion'), OBJECT_ID('dbo.usp_QARE_DetalleEvidencia'))
), L AS (
    SELECT Objeto, Linea = 1, Texto = LEFT(Def, CHARINDEX(NCHAR(10), Def) - 1), Resto = STUFF(Def, 1, CHARINDEX(NCHAR(10), Def), N'')
    FROM M
    UNION ALL
    SELECT Objeto, Linea + 1, LEFT(Resto, CHARINDEX(NCHAR(10), Resto) - 1), STUFF(Resto, 1, CHARINDEX(NCHAR(10), Resto), N'')
    FROM L WHERE CHARINDEX(NCHAR(10), Resto) > 0
)
SELECT Seccion = N'4a. Definicion', Objeto, Linea, Texto
FROM L
WHERE LTRIM(Texto) <> N''
ORDER BY Objeto, Linea
OPTION (MAXRECURSION 0);

SELECT Seccion = N'4a2. Modificado', Objeto = name, create_date, modify_date
FROM sys.objects
WHERE name IN ('usp_QARE_CalidadCaptura_KPIs', 'usp_QARE_CalidadCaptura_Tecnicos', 'usp_QARE_PatronesSolucion',
               'usp_QARE_DetalleEvidencia', 'vw_QARE_CalidadCaptura');

SELECT Seccion = N'4b. Parametros', Objeto = OBJECT_NAME(p.object_id), p.parameter_id, Parametro = p.name,
       Tipo = TYPE_NAME(p.user_type_id), p.max_length, p.has_default_value
FROM sys.parameters AS p
WHERE p.object_id IN (OBJECT_ID('dbo.usp_QARE_CalidadCaptura_KPIs'), OBJECT_ID('dbo.usp_QARE_CalidadCaptura_Tecnicos'),
                      OBJECT_ID('dbo.usp_QARE_PatronesSolucion'), OBJECT_ID('dbo.usp_QARE_DetalleEvidencia'))
ORDER BY Objeto, p.parameter_id;

/* 4c. Hechos de la poblacion de la vista en TODO el historial: los SP con
   fechas NULL leen todo, incluidos tickets sin FechaFirmaSolucion, que
   cualquier filtro de fecha deja fuera. */
SELECT Seccion = N'4c. Vista completa',
       Filas = COUNT(*), Tickets = COUNT(DISTINCT CodigoTicket),
       SinFechaFirma = SUM(CASE WHEN FechaFirmaSolucion IS NULL THEN 1 ELSE 0 END),
       SinFirma = SUM(CASE WHEN FirmaSolucion IS NULL THEN 1 ELSE 0 END),
       FirmaVacia = SUM(CASE WHEN FirmaSolucion IS NOT NULL AND LTRIM(RTRIM(FirmaSolucion)) = N'' THEN 1 ELSE 0 END),
       SinGrupo = SUM(CASE WHEN Grupo IS NULL THEN 1 ELSE 0 END),
       SinCategoria = SUM(CASE WHEN Categoria IS NULL THEN 1 ELSE 0 END),
       PrimeraFirma = MIN(FechaFirmaSolucion), UltimaFirma = MAX(FechaFirmaSolucion),
       ConHora = SUM(CASE WHEN CAST(FechaFirmaSolucion AS time) <> '00:00' THEN 1 ELSE 0 END),
       Cuentas = (SELECT COUNT(*) FROM dbo.vw_QARE_CalidadCaptura AS v
                  WHERE EXISTS (SELECT 1 FROM dbo.CatCuentaNoPersona AS c WHERE c.Habilitado = 1 AND c.Cuenta = v.FirmaSolucion))
FROM dbo.vw_QARE_CalidadCaptura;

/* 4d. Limite final: tickets firmados el ultimo dia despues de las 00:00.
   Un filtro "<= @FechaFin" sobre datetime2 los deja fuera; "< @FechaFin + 1"
   los incluye. Se comparan con lo que devuelve cada SP en 4e. */
DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';
SELECT Seccion = N'4d. Limites de fecha',
       Inclusivo = SUM(CASE WHEN FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff) THEN 1 ELSE 0 END),
       MenorIgualFin = SUM(CASE WHEN FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion <= @Ff THEN 1 ELSE 0 END),
       PorFechaCast = SUM(CASE WHEN CAST(FechaFirmaSolucion AS date) BETWEEN @Fi AND @Ff THEN 1 ELSE 0 END),
       UltimoDia = SUM(CASE WHEN CAST(FechaFirmaSolucion AS date) = @Ff THEN 1 ELSE 0 END),
       PrimerDia = SUM(CASE WHEN CAST(FechaFirmaSolucion AS date) = @Fi THEN 1 ELSE 0 END)
FROM dbo.vw_QARE_CalidadCaptura;

-- 4d2. Totales esperados en la ventana, calculados directo de la vista (COUNT DISTINCT como los SP).
SELECT Seccion = N'4d2. Esperado ventana',
       Totales = COUNT(DISTINCT CodigoTicket),
       SinInfo = COUNT(DISTINCT CASE WHEN EstadoDescripcion = 'SIN INFORMACION QARE' THEN CodigoTicket END),
       Evaluados = COUNT(DISTINCT CASE WHEN EstadoDescripcion <> 'SIN INFORMACION QARE' THEN CodigoTicket END),
       NoEvaluables = COUNT(DISTINCT CASE WHEN EstadoDescripcion = 'NO EVALUABLE' THEN CodigoTicket END),
       TextoEvaluable = COUNT(DISTINCT CASE WHEN EstadoDescripcion = 'TEXTO EVALUABLE' THEN CodigoTicket END),
       Patron = COUNT(DISTINCT CASE WHEN TipoClasificacionRespuesta = 'PATRON_SOLUCION' THEN CodigoTicket END),
       Calidad = COUNT(DISTINCT CASE WHEN TipoClasificacionRespuesta = 'CALIDAD' THEN CodigoTicket END),
       SinPatron = COUNT(DISTINCT CASE WHEN TipoClasificacionRespuesta = 'SIN PATRON' THEN CodigoTicket END),
       ConFirma = COUNT(DISTINCT CASE WHEN FirmaSolucion IS NOT NULL THEN CodigoTicket END),
       DeCuentasNoPersona = COUNT(DISTINCT CASE WHEN c.Cuenta IS NOT NULL THEN CodigoTicket END)
FROM dbo.vw_QARE_CalidadCaptura AS v
LEFT JOIN dbo.CatCuentaNoPersona AS c ON c.Habilitado = 1 AND c.Cuenta = v.FirmaSolucion
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);
GO

/* 4e. Lo que devuelve cada SP para la misma ventana. KPIs y Detalle se
   capturan con INSERT ... EXEC en tablas temporales para cuadrarlos; Tecnicos
   y Patrones se muestran tal cual (varios result sets o columnas no
   verificadas). Si un EXEC falla, el error sale en Mensajes y el resto
   sigue en el siguiente lote. */
DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';

CREATE TABLE #K (TicketsTotales int, TicketsSinInformacionQARE int, TicketsEvaluados int, TicketsNoEvaluables int,
                 PctNoEvaluable decimal(18, 2), TicketsTextoEvaluable int, PctTextoEvaluable decimal(18, 2));
INSERT #K EXEC dbo.usp_QARE_CalidadCaptura_KPIs @FechaInicio = @Fi, @FechaFin = @Ff;
SELECT Seccion = N'4e. KPIs ventana', * FROM #K;
GO

DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';
/* Tres capturas del mismo SP en tablas separadas: ventana sin filtros,
   filtro con la etiqueta que muestra la salida ('RESPUESTA INVALIDA') y
   filtro con el valor interno de la vista ('NO EVALUABLE'). El SP compara
   @EstadoDescripcion contra el valor interno: si la pantalla devuelve la
   etiqueta que muestra, el filtro no trae nada. */
CREATE TABLE #D (CodigoTicket nvarchar(100), FechaFirmaSolucion datetime2, FirmaSolucion nvarchar(255),
                 Grupo nvarchar(255), Categoria nvarchar(500), Validacion nvarchar(50), QARe_Causa nvarchar(max),
                 QARe_AplicaOtrosCasos nvarchar(255), QARe_GenerarArticulo nvarchar(255), QARe_VerificoClasificacion nvarchar(255),
                 QARe_TipoSolucion nvarchar(255), QARe_DescripcionSolucion nvarchar(max), EstadoDescripcionVisual nvarchar(100),
                 ClasificacionRespuesta nvarchar(255));
SELECT TOP (0) * INTO #D2 FROM #D;
SELECT TOP (0) * INTO #D3 FROM #D;

INSERT #D  EXEC dbo.usp_QARE_DetalleEvidencia @FechaInicio = @Fi, @FechaFin = @Ff;
INSERT #D2 EXEC dbo.usp_QARE_DetalleEvidencia @FechaInicio = @Fi, @FechaFin = @Ff, @EstadoDescripcion = 'RESPUESTA INVALIDA';
INSERT #D3 EXEC dbo.usp_QARE_DetalleEvidencia @FechaInicio = @Fi, @FechaFin = @Ff, @EstadoDescripcion = 'NO EVALUABLE';

-- Un agregado por captura: una corrida vacia sale con 0 en vez de desaparecer.
SELECT Seccion = N'4e. Detalle', Corrida = N'ventana', Filas = COUNT(*), Tickets = COUNT(DISTINCT CodigoTicket),
       SinInfo = SUM(CASE WHEN EstadoDescripcionVisual = 'SIN INFORMACION QARE' THEN 1 ELSE 0 END),
       Invalida = SUM(CASE WHEN EstadoDescripcionVisual = 'RESPUESTA INVALIDA' THEN 1 ELSE 0 END),
       Analizable = SUM(CASE WHEN EstadoDescripcionVisual = 'RESPUESTA ANALIZABLE' THEN 1 ELSE 0 END),
       UltimoDia = SUM(CASE WHEN CAST(FechaFirmaSolucion AS date) = @Ff THEN 1 ELSE 0 END)
FROM #D
UNION ALL
SELECT N'4e. Detalle', N'filtro etiqueta visual', COUNT(*), COUNT(DISTINCT CodigoTicket), NULL, NULL, NULL, NULL FROM #D2
UNION ALL
SELECT N'4e. Detalle', N'filtro valor interno', COUNT(*), COUNT(DISTINCT CodigoTicket), NULL, NULL, NULL, NULL FROM #D3;

-- Cuadre Detalle (ventana) contra KPIs: 0 en todas = coinciden.
SELECT Seccion = N'4e. Cuadre Detalle vs KPIs',
       DifTotales = k.TicketsTotales - d.Tickets, DifSinInfo = k.TicketsSinInformacionQARE - d.SinInfo,
       DifNoEvaluables = k.TicketsNoEvaluables - d.Invalida, DifTextoEvaluable = k.TicketsTextoEvaluable - d.Analizable
FROM #K AS k
CROSS JOIN (SELECT Tickets = COUNT(DISTINCT CodigoTicket),
                   SinInfo = COUNT(DISTINCT CASE WHEN EstadoDescripcionVisual = 'SIN INFORMACION QARE' THEN CodigoTicket END),
                   Invalida = COUNT(DISTINCT CASE WHEN EstadoDescripcionVisual = 'RESPUESTA INVALIDA' THEN CodigoTicket END),
                   Analizable = COUNT(DISTINCT CASE WHEN EstadoDescripcionVisual = 'RESPUESTA ANALIZABLE' THEN CodigoTicket END)
            FROM #D) AS d;
GO

DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';
-- 4f. Tecnicos y Patrones tal cual, misma ventana y sin filtros.
EXEC dbo.usp_QARE_CalidadCaptura_Tecnicos @FechaInicio = @Fi, @FechaFin = @Ff;
GO

DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';
EXEC dbo.usp_QARE_PatronesSolucion @FechaInicio = @Fi, @FechaFin = @Ff;
GO

/* 4g. Filtro de Grupo: el grupo con mas tickets en la ventana. KPIs no
   recibe @Grupo; Tecnicos y Patrones si. Se muestra lo esperado de la
   vista para comparar con las salidas de 4g2. */
DECLARE @Fi date = '20261029';
DECLARE @Ff date = '20261127';
DECLARE @G nvarchar(255) = (SELECT TOP (1) Grupo FROM #T GROUP BY Grupo ORDER BY COUNT(*) DESC);

SELECT Seccion = N'4g. Esperado por grupo', Grupo = @G,
       Totales = COUNT(*),
       SinInfo = SUM(CASE WHEN EstadoDescripcion = 'SIN INFORMACION QARE' THEN 1 ELSE 0 END),
       NoEvaluables = SUM(CASE WHEN EstadoDescripcion = 'NO EVALUABLE' THEN 1 ELSE 0 END),
       TextoEvaluable = SUM(CASE WHEN EstadoDescripcion = 'TEXTO EVALUABLE' THEN 1 ELSE 0 END),
       Patron = SUM(CASE WHEN Tipo = 'PATRON_SOLUCION' THEN 1 ELSE 0 END),
       Calidad = SUM(CASE WHEN Tipo = 'CALIDAD' THEN 1 ELSE 0 END),
       SinPatron = SUM(CASE WHEN Tipo = 'SIN PATRON' THEN 1 ELSE 0 END)
FROM #T WHERE Grupo = @G;

DECLARE @Gv varchar(250) = CAST(@G AS varchar(250));
SELECT Seccion = N'4g. Grupo pasa por VARCHAR sin perdida', Igual = CASE WHEN CAST(@Gv AS nvarchar(255)) = @G THEN 1 ELSE 0 END;

-- 4g2. Patrones con el grupo (la barra, tercer result set, debe dar TextoEvaluable/Patron/Calidad/SinPatron de 4g).
EXEC dbo.usp_QARE_PatronesSolucion @FechaInicio = @Fi, @FechaFin = @Ff, @Grupo = @Gv;
GO

/* 4h. Nombres de grupo, firma y categoria que no sobreviven a VARCHAR
   (los parametros de los SP son VARCHAR; la columna es NVARCHAR): esos
   valores nunca coincidirian con el filtro. */
SELECT Seccion = N'4h. Valores que VARCHAR altera', Dimension, Valor, Tickets
FROM (
    SELECT Dimension = N'Grupo', Valor = Grupo, Tickets = COUNT(*) FROM #T
    WHERE CAST(CAST(Grupo AS varchar(250)) AS nvarchar(255)) <> Grupo GROUP BY Grupo
    UNION ALL
    SELECT N'FirmaSolucion', FirmaSolucion, COUNT(*) FROM #T
    WHERE CAST(CAST(FirmaSolucion AS varchar(250)) AS nvarchar(255)) <> FirmaSolucion GROUP BY FirmaSolucion
    UNION ALL
    SELECT N'Categoria', LEFT(Categoria, 200), COUNT(*) FROM #T
    WHERE CAST(CAST(Categoria AS varchar(500)) AS nvarchar(500)) <> Categoria GROUP BY LEFT(Categoria, 200)
) AS x
ORDER BY Dimension, Tickets DESC;

DROP TABLE #T; DROP TABLE #N; DROP TABLE #C; DROP TABLE #K; DROP TABLE #D;
DROP TABLE #D2; DROP TABLE #D3; DROP TABLE #F; DROP TABLE #FT; DROP TABLE #Txt; DROP TABLE #CatP; DROP TABLE #CatI;
