/* =========================================================================
   sql/diag/diag_qare_tecnicos_perfil_2.sql - Segunda pasada del perfil de
   Técnicos / QARE. SOLO LECTURA.

   Cierra lo que dejo abierto diag_qare_tecnicos_perfil.sql (2026-11-27):
     A. Cuerpo completo de las vistas: la cuadricula de SSMS lo trunco. Aqui
        sale una fila por linea.
     B. De donde sale Tecnico (48 % no es TecnicoSegundaLinea).
     C. Cuentas que no son personas (dbo.CatCuentaNoPersona) en la poblacion.
     D. Simulacion de reglas CANDIDATAS de "respuesta invalida". No son reglas
        aprobadas: cuentan cuantos tickets caeria en cada una para que el
        negocio decida con numeros. Cascada excluyente: gana la primera.
   ========================================================================= */

SET NOCOUNT ON;

DECLARE @Ff date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
DECLARE @Fi date = DATEADD(DAY, -29, @Ff);

-- ------------------------------------------------------------ A. Definiciones, una fila por linea
-- STRING_SPLIT no garantiza orden en compatibilidad 150; el CTE recursivo si.
;WITH D AS (
    SELECT Objeto = o.nombre, Def = REPLACE(OBJECT_DEFINITION(OBJECT_ID(o.nombre)), NCHAR(13), N'') + NCHAR(10)
    FROM (VALUES (N'dbo.vw_CorreoQA_Base'), (N'dbo.vw_CorreoQARECierre_Base')) AS o(nombre)
), L AS (
    SELECT Objeto, Linea = 1, Texto = LEFT(Def, CHARINDEX(NCHAR(10), Def) - 1),
           Resto = STUFF(Def, 1, CHARINDEX(NCHAR(10), Def), N'')
    FROM D WHERE Def IS NOT NULL
    UNION ALL
    SELECT Objeto, Linea + 1, LEFT(Resto, CHARINDEX(NCHAR(10), Resto) - 1),
           STUFF(Resto, 1, CHARINDEX(NCHAR(10), Resto), N'')
    FROM L WHERE CHARINDEX(NCHAR(10), Resto) > 0
)
SELECT Seccion = N'A. Definicion', Objeto, Linea, Texto
FROM L
ORDER BY Objeto, Linea
OPTION (MAXRECURSION 0);

-- ------------------------------------------------------------ B. Origen de Tecnico
-- En la vista del SLA (04_dashboard_sla.sql) Tecnico es la firma de solucion
-- con respaldo en el asignado. Se mide si aqui es igual.
SELECT Seccion = N'B. Tecnico = ?',
       Tickets = COUNT(*),
       IgualFirmaSolucion = SUM(CASE WHEN LTRIM(RTRIM(q.Tecnico)) = LTRIM(RTRIM(q.FirmaSolucion)) THEN 1 ELSE 0 END),
       IgualResponsableUltMod = SUM(CASE WHEN LTRIM(RTRIM(q.Tecnico)) = LTRIM(RTRIM(q.ResponsableUltimaModificacion)) THEN 1 ELSE 0 END),
       IgualTecnicoSegundaLinea = SUM(CASE WHEN LTRIM(RTRIM(q.Tecnico)) = LTRIM(RTRIM(t.TecnicoSegundaLinea)) THEN 1 ELSE 0 END),
       IgualCoalesceFirmaSegunda = SUM(CASE WHEN LTRIM(RTRIM(q.Tecnico)) = COALESCE(NULLIF(LTRIM(RTRIM(q.FirmaSolucion)), N''), LTRIM(RTRIM(t.TecnicoSegundaLinea))) THEN 1 ELSE 0 END),
       FirmaSolucionVacia = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(q.FirmaSolucion)), N'') IS NULL THEN 1 ELSE 0 END)
FROM dbo.vw_CorreoQARECierre_Base AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);

SELECT TOP (20) Seccion = N'B2. Tecnico no explicado',
       q.CodigoTicket, q.Tecnico, q.FirmaSolucion, q.ResponsableUltimaModificacion, t.TecnicoSegundaLinea
FROM dbo.vw_CorreoQARECierre_Base AS q
LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
  AND ISNULL(LTRIM(RTRIM(q.Tecnico)), N'') <> ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(q.FirmaSolucion)), N''), LTRIM(RTRIM(t.TecnicoSegundaLinea))), N'')
ORDER BY q.CodigoTicket;

-- ------------------------------------------------------------ C. Cuentas que no son personas
SELECT Seccion = N'C1. CatCuentaNoPersona', c.Cuenta, c.Tipo, c.Habilitado, c.Nota,
       TicketsEnPeriodo = (SELECT COUNT(*) FROM dbo.vw_CorreoQARECierre_Base AS q
                           WHERE q.Tecnico = c.Cuenta
                             AND q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff))
FROM dbo.CatCuentaNoPersona AS c
ORDER BY TicketsEnPeriodo DESC;

-- Tecnicos con forma de cuenta (", Proveedor", "User, ", "Customer Service")
-- que NO estan en el catalogo: candidatos a darlos de alta, decision del negocio.
SELECT Seccion = N'C2. Posibles cuentas fuera del catalogo', q.Tecnico, Tickets = COUNT(*), Grupos = COUNT(DISTINCT q.Grupo)
FROM dbo.vw_CorreoQARECierre_Base AS q
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
  AND (q.Tecnico LIKE N'%, Proveedor%' OR q.Tecnico LIKE N'User,%' OR q.Tecnico LIKE N'%Customer Service%'
       OR q.Tecnico LIKE N'Soporte,%' OR q.Tecnico LIKE N'Desk,%')
  AND NOT EXISTS (SELECT 1 FROM dbo.CatCuentaNoPersona AS c WHERE c.Cuenta = q.Tecnico AND c.Habilitado = 1)
GROUP BY q.Tecnico
ORDER BY Tickets DESC;

-- ------------------------------------------------------------ D. Reglas candidatas de "invalida"
;WITH B AS (
    SELECT q.CodigoTicket, q.Tecnico,
           Txt = UPPER(LTRIM(RTRIM(REPLACE(ISNULL(q.QARe_DescripcionSolucion, N''), NCHAR(160), N' ')))),
           Tipo = UPPER(LTRIM(RTRIM(ISNULL(q.QARe_TipoSolucion, N'')))),
           SolU = UPPER(LTRIM(RTRIM(ISNULL(q.SolucionUsuario, N'')))),
           MsjE = UPPER(LTRIM(RTRIM(ISNULL(q.QA_MensajeError, N''))))
    FROM dbo.vw_CorreoQARECierre_Base AS q
    WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
), C AS (
    SELECT CodigoTicket, Tecnico, Txt,
           Regla = CASE
               WHEN Txt = N''                                                     THEN N'R0 sin captura QARE / vacio'
               WHEN PATINDEX(N'%[A-Z]%', Txt COLLATE Latin1_General_CI_AI) = 0    THEN N'R1 sin letras (. - 0 1 ,)'
               WHEN Txt IN (N'N/A', N'NA', N'NO', N'SI', N'SÍ', N'A', N'ERROR', N'OK',
                            N'SIN RESPUESTA', N'NO  SALE ERROR', N'NO SALE ERROR',
                            N'SIN RESPUESTA DEL USUARIO', N'SE ANEXA EVIDENCIA',
                            N'NO SE ADJUNTO LO SOLICITADO')                       THEN N'R2 literal generico'
               WHEN Txt = MsjE AND MsjE <> N''                                    THEN N'R3 copia de QA_MensajeError'
               WHEN Txt = Tipo AND Tipo <> N''                                    THEN N'R4 copia del Tipo de solucion'
               WHEN LEN(Txt) < 10                                                 THEN N'R5 menos de 10 caracteres'
               WHEN Txt = SolU                                                    THEN N'R6 copia de SolucionUsuario'
               ELSE N'Z  pasa todas (analizable candidata)' END
    FROM B
)
SELECT Seccion = N'D1. Cascada candidata', Regla,
       Tickets = COUNT(*),
       Porcentaje = CAST(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0) AS decimal(6,2)),
       Tecnicos = COUNT(DISTINCT Tecnico)
FROM C
GROUP BY Regla
ORDER BY Regla;

-- D2. Ejemplos de las reglas mas discutibles (R5, R6 y lo que pasa), para
--     ver si la cascada se come respuestas validas cortas o deja pasar basura.
;WITH B AS (
    SELECT q.CodigoTicket,
           Txt = UPPER(LTRIM(RTRIM(REPLACE(ISNULL(q.QARe_DescripcionSolucion, N''), NCHAR(160), N' ')))),
           Tipo = UPPER(LTRIM(RTRIM(ISNULL(q.QARe_TipoSolucion, N'')))),
           SolU = UPPER(LTRIM(RTRIM(ISNULL(q.SolucionUsuario, N'')))),
           MsjE = UPPER(LTRIM(RTRIM(ISNULL(q.QA_MensajeError, N''))))
    FROM dbo.vw_CorreoQARECierre_Base AS q
    WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
), C AS (
    SELECT Txt, Regla = CASE
               WHEN Txt = N'' THEN N'R0'
               WHEN PATINDEX(N'%[A-Z]%', Txt COLLATE Latin1_General_CI_AI) = 0 THEN N'R1'
               WHEN Txt IN (N'N/A', N'NA', N'NO', N'SI', N'SÍ', N'A', N'ERROR', N'OK',
                            N'SIN RESPUESTA', N'NO  SALE ERROR', N'NO SALE ERROR',
                            N'SIN RESPUESTA DEL USUARIO', N'SE ANEXA EVIDENCIA',
                            N'NO SE ADJUNTO LO SOLICITADO') THEN N'R2'
               WHEN Txt = MsjE AND MsjE <> N'' THEN N'R3'
               WHEN Txt = Tipo AND Tipo <> N'' THEN N'R4'
               WHEN LEN(Txt) < 10 THEN N'R5'
               WHEN Txt = SolU THEN N'R6'
               ELSE N'Z' END
    FROM B
), R AS (
    SELECT Regla, Texto = LEFT(Txt, 200), Tickets = COUNT(*),
           n = ROW_NUMBER() OVER (PARTITION BY Regla ORDER BY COUNT(*) DESC, LEFT(Txt, 200))
    FROM C WHERE Regla IN (N'R3', N'R4', N'R5', N'R6', N'Z')
    GROUP BY Regla, LEFT(Txt, 200)
)
SELECT Seccion = N'D2. Ejemplos', Regla, Texto, Tickets
FROM R WHERE n <= 25
ORDER BY Regla, n;

-- D3. Respuestas QARE vacias por tecnico: si se concentran en pocos, es
--     habito de captura; si estan repartidas, puede ser el formulario.
SELECT TOP (25) Seccion = N'D3. Sin captura QARE por tecnico', q.Tecnico,
       Tickets = COUNT(*),
       SinCaptura = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_DescripcionSolucion)), N'') IS NULL THEN 1 ELSE 0 END),
       PorcentajeSinCaptura = CAST(100.0 * SUM(CASE WHEN NULLIF(LTRIM(RTRIM(q.QARe_DescripcionSolucion)), N'') IS NULL THEN 1 ELSE 0 END) / COUNT(*) AS decimal(6,2))
FROM dbo.vw_CorreoQARECierre_Base AS q
WHERE q.FechaFirmaSolucion >= @Fi AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
GROUP BY q.Tecnico
ORDER BY SinCaptura DESC;
