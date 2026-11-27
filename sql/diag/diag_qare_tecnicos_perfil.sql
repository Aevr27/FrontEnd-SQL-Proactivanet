/* =========================================================================
   sql/diag/diag_qare_tecnicos_perfil.sql - Perfil de datos para definir las
   reglas de la pestaña Técnicos / QARE. SOLO LECTURA.

   Por que existe: las tres clasificaciones que pide el tablero (respuesta
   invalida, patron reconocido, respuesta incompleta) no estan definidas en
   ningun objeto de la base ni en el repositorio (ver
   sql/docs/PROPUESTA_qare_tecnicos.md). Este script no las inventa: muestra
   como vienen los datos reales para que el negocio las defina y despues se
   escriban los tres procedimientos.

   - Solo SELECT sobre vistas y catalogos existentes. Sin DDL, sin DML, sin
     tablas temporales permanentes.
   - Misma poblacion que la pestaña QARE: dbo.vw_CorreoQARECierre_Base,
     FechaFirmaSolucion dentro de [@Fi, @Ff] con @Ff inclusivo.
   - Los textos se recortan a 200 caracteres: QARe_DescripcionSolucion es
     NVARCHAR(MAX) y puede traer datos de usuarios; no copiar la salida fuera
     de la red interna.
   - Correr en QA (AZVMBDCENTRALQA / Tickets_Proactivanet) con SSMS en modo
     cuadricula, o sqlcmd -y 0 para no truncar.
   ========================================================================= */

SET NOCOUNT ON;

DECLARE @Ff date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));   -- hoy en Mexico, como los SP QARE
DECLARE @Fi date = DATEADD(DAY, -29, @Ff);                                -- 30 dias naturales incluyendo hoy

-- ------------------------------------------------------------ 0. Prerrequisitos
SELECT Seccion = N'0. Objetos', Objeto = o.nombre,
       Existe = CASE WHEN OBJECT_ID(o.nombre) IS NULL THEN 0 ELSE 1 END
FROM (VALUES (N'dbo.vw_CorreoQARECierre_Base'), (N'dbo.vw_CorreoQA_Base'), (N'dbo.vw_Tickets'),
             (N'dbo.tvf_CorreoQARE_Base'), (N'dbo.CatCausaRaizAgrupador'),
             (N'dbo.fn_CorreoBacklog_CategoriaC1'), (N'dbo.fn_CorreoBacklog_SplitList'),
             (N'dbo.CatLiderGrupo')) AS o(nombre);

-- Cuerpos completos que hoy solo existen truncados en esquema_bd/ (250 caracteres).
-- Necesarios para saber de donde salen Tecnico y Validacion.
SELECT Seccion = N'0b. Definiciones', Objeto = o.nombre, Definicion = OBJECT_DEFINITION(OBJECT_ID(o.nombre))
FROM (VALUES (N'dbo.vw_CorreoQARECierre_Base'), (N'dbo.vw_CorreoQA_Base'),
             (N'dbo.usp_CorreoQARE_Detalle')) AS o(nombre);

-- ------------------------------------------------------------ 1. Poblacion
SELECT Seccion = N'1. Poblacion', FechaInicio = @Fi, FechaFin = @Ff,
       Filas = COUNT_BIG(*), TicketsDistintos = COUNT(DISTINCT CodigoTicket)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

-- ------------------------------------------------------------ 2. Tecnico / resolutor
-- 2a. Cobertura y nombres corruptos (U+FFFD viene de la importacion, no del tablero).
SELECT Seccion = N'2a. Tecnico cobertura',
       Tickets = COUNT(DISTINCT CodigoTicket),
       SinTecnico = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(Tecnico)), N'') IS NULL THEN CodigoTicket END),
       TecnicosDistintos = COUNT(DISTINCT NULLIF(LTRIM(RTRIM(Tecnico)), N'')),
       ConCaracterReemplazo = COUNT(DISTINCT CASE WHEN CHARINDEX(NCHAR(65533), Tecnico) > 0 THEN CodigoTicket END)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

-- 2b. vw_CorreoQA_Base trae Tecnico y TecnicoAsignado; la vista QARE solo Tecnico.
--     Cuantos tickets difieren decide cual es "el resolutor".
SELECT Seccion = N'2b. Tecnico vs TecnicoAsignado',
       Tickets = COUNT(DISTINCT q.CodigoTicket),
       Iguales = COUNT(DISTINCT CASE WHEN ISNULL(LTRIM(RTRIM(q.Tecnico)), N'') = ISNULL(LTRIM(RTRIM(q.TecnicoAsignado)), N'') THEN q.CodigoTicket END),
       Distintos = COUNT(DISTINCT CASE WHEN ISNULL(LTRIM(RTRIM(q.Tecnico)), N'') <> ISNULL(LTRIM(RTRIM(q.TecnicoAsignado)), N'') THEN q.CodigoTicket END)
FROM dbo.vw_CorreoQA_Base AS q
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

SELECT TOP (30) Seccion = N'2c. Ejemplos Tecnico <> TecnicoAsignado',
       q.CodigoTicket, q.Grupo, q.Tecnico, q.TecnicoAsignado, t.TecnicoSegundaLinea
FROM dbo.vw_CorreoQA_Base AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
  AND ISNULL(LTRIM(RTRIM(q.Tecnico)), N'') <> ISNULL(LTRIM(RTRIM(q.TecnicoAsignado)), N'')
ORDER BY q.CodigoTicket;

-- 2d. Tecnico de la vista QARE contra el campo crudo de vw_Tickets.
SELECT Seccion = N'2d. Tecnico vs vw_Tickets.TecnicoSegundaLinea',
       Tickets = COUNT(DISTINCT q.CodigoTicket),
       SinFilaEnVwTickets = COUNT(DISTINCT CASE WHEN t.CodigoTicket IS NULL THEN q.CodigoTicket END),
       Iguales = COUNT(DISTINCT CASE WHEN ISNULL(LTRIM(RTRIM(q.Tecnico)), N'') = ISNULL(LTRIM(RTRIM(t.TecnicoSegundaLinea)), N'') THEN q.CodigoTicket END)
FROM dbo.vw_CorreoQARECierre_Base AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

SELECT TOP (40) Seccion = N'2e. Tickets por tecnico',
       Tecnico = ISNULL(NULLIF(LTRIM(RTRIM(Tecnico)), N''), N'<vacio>'),
       Tickets = COUNT(DISTINCT CodigoTicket),
       Grupos = COUNT(DISTINCT Grupo)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(Tecnico)), N''), N'<vacio>')
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ 3. Texto de la respuesta
-- 3a. Largo del texto recortado. Un umbral de "invalida" o "incompleta" basado
--     en largo saldria de aqui, no de una suposicion.
;WITH T AS (
    SELECT CodigoTicket, L = LEN(LTRIM(RTRIM(ISNULL(QARe_DescripcionSolucion, N''))))
    FROM dbo.vw_CorreoQARECierre_Base
    WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
)
SELECT Seccion = N'3a. Largo DescripcionSolucion',
       Rango = CASE WHEN L = 0 THEN N'00 vacio/NULL' WHEN L < 10 THEN N'01 1-9'
                    WHEN L < 20 THEN N'02 10-19' WHEN L < 50 THEN N'03 20-49'
                    WHEN L < 100 THEN N'04 50-99' WHEN L < 200 THEN N'05 100-199'
                    WHEN L < 500 THEN N'06 200-499' ELSE N'07 500+' END,
       Tickets = COUNT(DISTINCT CodigoTicket),
       Porcentaje = CAST(100.0 * COUNT(DISTINCT CodigoTicket) / NULLIF(SUM(COUNT(DISTINCT CodigoTicket)) OVER (), 0) AS decimal(6,2))
FROM T
GROUP BY CASE WHEN L = 0 THEN N'00 vacio/NULL' WHEN L < 10 THEN N'01 1-9'
              WHEN L < 20 THEN N'02 10-19' WHEN L < 50 THEN N'03 20-49'
              WHEN L < 100 THEN N'04 50-99' WHEN L < 200 THEN N'05 100-199'
              WHEN L < 500 THEN N'06 200-499' ELSE N'07 500+' END
ORDER BY Rango;

-- 3b. Textos repetidos tal cual (mayusculas, sin espacios extremos). Los que se
--     repiten mucho suelen ser las respuestas genericas ("ok", "se atendio",
--     ".") que el negocio querra llamar invalidas; la lista la decide el negocio.
SELECT TOP (60) Seccion = N'3b. Textos mas repetidos',
       Texto = LEFT(UPPER(LTRIM(RTRIM(QARe_DescripcionSolucion))), 200),
       Largo = LEN(LTRIM(RTRIM(QARe_DescripcionSolucion))),
       Tickets = COUNT(DISTINCT CodigoTicket),
       Tecnicos = COUNT(DISTINCT Tecnico)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
  AND NULLIF(LTRIM(RTRIM(QARe_DescripcionSolucion)), N'') IS NOT NULL
GROUP BY LEFT(UPPER(LTRIM(RTRIM(QARe_DescripcionSolucion))), 200), LEN(LTRIM(RTRIM(QARe_DescripcionSolucion)))
HAVING COUNT(DISTINCT CodigoTicket) > 1
ORDER BY Tickets DESC;

-- 3c. ¿El tecnico copia la solucion al usuario en el campo QARE?
SELECT Seccion = N'3c. DescripcionSolucion vs SolucionUsuario',
       Tickets = COUNT(DISTINCT CodigoTicket),
       AmbasVacias = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_DescripcionSolucion)), N'') IS NULL AND NULLIF(LTRIM(RTRIM(SolucionUsuario)), N'') IS NULL THEN CodigoTicket END),
       SoloSolucionUsuario = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_DescripcionSolucion)), N'') IS NULL AND NULLIF(LTRIM(RTRIM(SolucionUsuario)), N'') IS NOT NULL THEN CodigoTicket END),
       TextoIdentico = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_DescripcionSolucion)), N'') IS NOT NULL
                                            AND LTRIM(RTRIM(QARe_DescripcionSolucion)) = LTRIM(RTRIM(SolucionUsuario)) THEN CodigoTicket END)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

-- ------------------------------------------------------------ 4. Respuesta declarada
-- 4a. QARe_TipoSolucion es la unica respuesta codificada sobre la solucion.
SELECT Seccion = N'4a. QARe_TipoSolucion',
       TipoSolucion = N'[' + ISNULL(LTRIM(RTRIM(QARe_TipoSolucion)), N'<NULL>') + N']',
       Tickets = COUNT(DISTINCT CodigoTicket),
       ConTexto = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_DescripcionSolucion)), N'') IS NOT NULL THEN CodigoTicket END)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY ISNULL(LTRIM(RTRIM(QARe_TipoSolucion)), N'<NULL>')
ORDER BY Tickets DESC;

-- 4b. Respuestas cortas de los demas campos QARE (literales exactos, para
--     que ninguna regla compare contra un texto que no existe).
SELECT Seccion = N'4b. Literales QARE', Campo = c.Campo,
       Valor = N'[' + ISNULL(c.Valor, N'<NULL>') + N']', Tickets = COUNT(DISTINCT q.CodigoTicket)
FROM dbo.vw_CorreoQARECierre_Base AS q
CROSS APPLY (VALUES (N'QARe_UsuarioConfirmo', LTRIM(RTRIM(q.QARe_UsuarioConfirmo))),
                    (N'QARe_VerificoClasificacion', LTRIM(RTRIM(q.QARe_VerificoClasificacion))),
                    (N'QARe_AplicaOtrosCasos', LTRIM(RTRIM(q.QARe_AplicaOtrosCasos))),
                    (N'QARe_GenerarArticulo', LTRIM(RTRIM(q.QARe_GenerarArticulo))),
                    (N'Validacion', LTRIM(RTRIM(q.Validacion)))) AS c(Campo, Valor)
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY c.Campo, c.Valor
ORDER BY c.Campo, Tickets DESC;

-- 4c. Llenado de los campos libres que podrian sostener "respuesta completa".
SELECT Seccion = N'4c. Llenado campos libres',
       Tickets = COUNT(DISTINCT CodigoTicket),
       ConCausa = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_Causa)), N'') IS NOT NULL THEN CodigoTicket END),
       ConEvidencia = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_Evidencia)), N'') IS NOT NULL THEN CodigoTicket END),
       ConDescripcion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_DescripcionSolucion)), N'') IS NOT NULL THEN CodigoTicket END),
       ConTipoSolucion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_TipoSolucion)), N'') IS NOT NULL THEN CodigoTicket END),
       ConLosCuatro = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_Causa)), N'') IS NOT NULL
                                           AND NULLIF(LTRIM(RTRIM(QARe_Evidencia)), N'') IS NOT NULL
                                           AND NULLIF(LTRIM(RTRIM(QARe_DescripcionSolucion)), N'') IS NOT NULL
                                           AND NULLIF(LTRIM(RTRIM(QARe_TipoSolucion)), N'') IS NOT NULL THEN CodigoTicket END)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

-- ------------------------------------------------------------ 5. Catalogo candidato a "patron"
-- dbo.CatCausaRaizAgrupador (135 filas) agrupa vw_Tickets.CausaRaizFenix, un
-- campo de Proactivanet, NO el texto QARE. Se mide si cubre la poblacion para
-- decidir si "patron" puede ser su Agrupador o si hace falta un catalogo nuevo.
SELECT Seccion = N'5a. CausaRaizFenix / Agrupador',
       Tickets = COUNT(DISTINCT q.CodigoTicket),
       ConCausaRaizFenix = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(t.CausaRaizFenix)), N'') IS NOT NULL THEN q.CodigoTicket END),
       ConAgrupador = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(a.Agrupador)), N'') IS NOT NULL THEN q.CodigoTicket END)
FROM dbo.vw_CorreoQARECierre_Base AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
LEFT JOIN dbo.CatCausaRaizAgrupador AS a ON a.CausaRaizFenix = LTRIM(RTRIM(t.CausaRaizFenix))
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

SELECT TOP (40) Seccion = N'5b. Agrupadores',
       Agrupador = ISNULL(a.Agrupador, N'<sin agrupador>'), Tickets = COUNT(DISTINCT q.CodigoTicket)
FROM dbo.vw_CorreoQARECierre_Base AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
LEFT JOIN dbo.CatCausaRaizAgrupador AS a ON a.CausaRaizFenix = LTRIM(RTRIM(t.CausaRaizFenix))
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY ISNULL(a.Agrupador, N'<sin agrupador>')
ORDER BY Tickets DESC;

-- 5c. QARe_Causa (texto libre del tecnico) contra el mismo catalogo, por si
--     el negocio pensaba en ese cruce.
SELECT Seccion = N'5c. QARe_Causa en CatCausaRaizAgrupador',
       ConCausa = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_Causa)), N'') IS NOT NULL THEN q.CodigoTicket END),
       CausaEnCatalogo = COUNT(DISTINCT CASE WHEN a.CausaRaizFenix IS NOT NULL THEN q.CodigoTicket END)
FROM dbo.vw_CorreoQARECierre_Base AS q
LEFT JOIN dbo.CatCausaRaizAgrupador AS a ON a.CausaRaizFenix = LEFT(LTRIM(RTRIM(q.QARe_Causa)), 450)
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

-- ------------------------------------------------------------ 6. Grupo y categoria
SELECT Seccion = N'6. Grupo / Categoria',
       Tickets = COUNT(DISTINCT CodigoTicket),
       SinGrupo = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(Grupo)), N'') IS NULL THEN CodigoTicket END),
       SinCategoria = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(Categoria)), N'') IS NULL THEN CodigoTicket END),
       Grupos = COUNT(DISTINCT Grupo), Categorias = COUNT(DISTINCT Categoria)
FROM dbo.vw_CorreoQARECierre_Base
WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);
