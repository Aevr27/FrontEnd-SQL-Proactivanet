/* =========================================================================
   sql/16_qare_filtros_org.sql - Filtros Servicio (C1) / Grupo / Lider en
   los seis dbo.usp_CorreoQARE_*.

   QUE HACE
   1. Crea dbo.tvf_CorreoQARE_Base(@FechaInicio, @FechaFin, @C1, @Grupos,
      @Lideres): la fuente UNICA ya filtrada de los seis procedimientos. C1 y
      Lider se calculan EXACTAMENTE como el Backlog, reusando sus funciones
      (dbo.fn_CorreoBacklog_CategoriaC1, dbo.CatLiderGrupo, 'Sin categoria',
      'Sin Torre') y el filtro es el de usp_CorreoBacklog_Principal
      (dbo.fn_CorreoBacklog_SplitList). Verificado en la VM el 2026-09-28 con
      sql/diag_qare_filtros_org.sql y sql/diag_qare_filtros_precheck.sql.
   2. Agrega @C1 / @Grupos / @Lideres NVARCHAR(MAX) = NULL a los seis SP y
      cambia SOLO su FROM (vista + rango de fechas -> la TVF). Los calculos,
      columnas y ORDER BY no cambian. Quien no manda los filtros (el correo
      QARE) recibe exactamente lo mismo que antes.

   COMO SE PRUEBA QUE NO CAMBIA NADA (lo hace este mismo script)
   a. ANTES de tocar nada, corre los seis SP actuales en seis ventanas (el
      default NULL/NULL, 15, 30, 60-30 y 90 dias, y ayer) y guarda la salida.
   b. Dentro de UNA transaccion crea la TVF y altera los seis SP.
   c. Corre los seis SP nuevos SIN filtros en las mismas ventanas y compara
      fila por fila (EXCEPT en los dos sentidos + numero de filas).
   d. Prueba los filtros contra la propia TVF: para cada Lider, Grupo y C1 de
      los ultimos 30 dias, filtrar por ese valor debe dar lo mismo que
      agrupar; una lista de dos lideres = la suma; C1 + Lider = su cruce; y el
      KPI de un SP filtrado = la TVF filtrada.
   e. Si CUALQUIER comparacion falla, ROLLBACK de todo (TVF y los seis SP
      quedan como estaban) y el error dice que fallo. Si todo cuadra, COMMIT.

   Es UN solo lote (sin GO): los cuerpos van por sp_executesql para que el
   cambio completo quede dentro de la transaccion.

   COMO CORRERLO (SSMS, base Tickets_Proactivanet, en la VM)
   - Results to Text (Ctrl+T). F5. Pegar la salida completa.
   - Tarda lo que tarden ~72 ejecuciones de los SP QARE mas las pruebas de la
     TVF. Mientras la transaccion esta abierta, la pestaña QARE espera.
   - Deshacer: sql/16_qare_filtros_org_rollback.sql.

   PERMISOS: la TVF es de dbo como los SP y la vista, asi que el encadenamiento
   de propietarios cubre la llamada; la cuenta del sitio no necesita nada nuevo.
   ========================================================================= */

SET NOCOUNT ON;
SET XACT_ABORT ON;


-- Cuerpos nuevos (van por sp_executesql para que todo el cambio quede
-- dentro de UNA transaccion y se revierta completo si algo falla).

DECLARE @ddl_tvf nvarchar(max) = N'CREATE OR ALTER FUNCTION dbo.tvf_CorreoQARE_Base
(
    @FechaInicio DATE,
    @FechaFin    DATE,
    @C1          NVARCHAR(MAX),
    @Grupos      NVARCHAR(MAX),
    @Lideres     NVARCHAR(MAX)
)
RETURNS TABLE
AS
/* Fuente UNICA y ya filtrada de los seis dbo.usp_CorreoQARE_*: el rango de
   FechaFirmaSolucion (@FechaFin inclusivo) y los filtros organizacionales del
   tablero. Servicio (C1) y Lider se calculan EXACTAMENTE como el Backlog
   (usp_CorreoBacklog_PrepararCorte / _Backfill), reusando sus funciones:
     C1    = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(Categoria), N''Sin categoria'')
     Lider = LEFT JOIN dbo.CatLiderGrupo ON Grupo = Grupo (igualdad exacta)
             -> COALESCE(NULLIF(LTRIM(RTRIM(Lider)), N''''), N''Sin Torre'')
   y el filtro es el de usp_CorreoBacklog_Principal: NULL/vacio = sin filtro;
   si no, la columna IN dbo.fn_CorreoBacklog_SplitList(lista separada por comas).
   CatLiderGrupo tiene una fila por Grupo (usp_CargarCatLiderGrupo deduplica),
   asi que el JOIN no multiplica filas. */
RETURN
(
    SELECT q.CodigoTicket, q.FechaFirmaSolucion, q.Categoria, q.Grupo,
           q.QA_Frecuencia, q.QARe_Causa, q.QARe_VerificoClasificacion,
           q.QARe_AplicaOtrosCasos, q.QARe_GenerarArticulo, q.QARe_TipoSolucion,
           q.Validacion,
           o.C1, o.Lider
    FROM dbo.vw_CorreoQARECierre_Base AS q
    LEFT JOIN dbo.CatLiderGrupo AS lg ON lg.Grupo = q.Grupo
    CROSS APPLY (SELECT C1    = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(q.Categoria), N''Sin categoria''),
                        Lider = COALESCE(NULLIF(LTRIM(RTRIM(lg.Lider)), N''''), N''Sin Torre'')) AS o
    WHERE q.FechaFirmaSolucion >= @FechaInicio
      AND q.FechaFirmaSolucion < DATEADD(DAY, 1, @FechaFin)
      AND (NULLIF(LTRIM(RTRIM(@C1)), N'''')      IS NULL OR o.C1     IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@C1)))
      AND (NULLIF(LTRIM(RTRIM(@Grupos)), N'''')  IS NULL OR q.Grupo  IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Grupos)))
      AND (NULLIF(LTRIM(RTRIM(@Lideres)), N'''') IS NULL OR o.Lider  IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Lideres)))
);';

DECLARE @ddl_usp_CorreoQARE_KPIs nvarchar(max) = N'CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_KPIs
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,
    -- Filtros del tablero, con la misma convencion que usp_CorreoBacklog_Principal:
    -- NULL/vacio = sin filtro. El correo QARE los omite y devuelve lo mismo que antes.
    @C1      NVARCHAR(MAX) = NULL,
    @Grupos  NVARCHAR(MAX) = NULL,
    @Lideres NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    SELECT
        TotalTicketsPeriodo = COUNT(DISTINCT CodigoTicket),
        TicketsConFrecuencia = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'''') IS NOT NULL THEN CodigoTicket END),
        TicketsRecurrentes = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N''FRECUENTE'', N''SIEMPRE'') THEN CodigoTicket END),
        PorcentajeRecurrencia = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N''FRECUENTE'', N''SIEMPRE'') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'''') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaConfirmacion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARE_VerificoClasificacion)), N'''') IS NOT NULL THEN CodigoTicket END),
        TicketsConfirmados = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARE_VerificoClasificacion))) IN (N''SI'', N''SÍ'') THEN CodigoTicket END),
        PorcentajeConfirmacion = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARE_VerificoClasificacion))) IN (N''SI'', N''SÍ'') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARE_VerificoClasificacion)), N'''') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaReutilizacion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_AplicaOtrosCasos)), N'''') IS NOT NULL THEN CodigoTicket END),
        CasosReutilizables = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos))) IN (N''SI'', N''SÍ'') THEN CodigoTicket END),
        PorcentajeCasosReutilizables = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos))) IN (N''SI'', N''SÍ'') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_AplicaOtrosCasos)), N'''') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaKB = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_GenerarArticulo)), N'''') IS NOT NULL THEN CodigoTicket END),
        CasosPotencialKB = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_GenerarArticulo))) IN (N''SI'', N''SÍ'') THEN CodigoTicket END),
        PorcentajePotencialKB = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_GenerarArticulo))) IN (N''SI'', N''SÍ'') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_GenerarArticulo)), N'''') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2))
    FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, @C1, @Grupos, @Lideres);
END;';

DECLARE @ddl_usp_CorreoQARE_Frecuencia nvarchar(max) = N'CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_Frecuencia
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,
    -- Filtros del tablero, con la misma convencion que usp_CorreoBacklog_Principal:
    -- NULL/vacio = sin filtro. El correo QARE los omite y devuelve lo mismo que antes.
    @C1      NVARCHAR(MAX) = NULL,
    @Grupos  NVARCHAR(MAX) = NULL,
    @Lideres NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    SELECT Frecuencia = LTRIM(RTRIM(QA_Frecuencia)), CantidadTickets = COUNT(DISTINCT CodigoTicket),
           Porcentaje = CAST(100.0 * COUNT(DISTINCT CodigoTicket) / NULLIF(SUM(COUNT(DISTINCT CodigoTicket)) OVER (), 0) AS DECIMAL(6,2))
    FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, @C1, @Grupos, @Lideres)
    WHERE NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'''') IS NOT NULL
    GROUP BY LTRIM(RTRIM(QA_Frecuencia))
    ORDER BY CantidadTickets DESC;
END;';

DECLARE @ddl_usp_CorreoQARE_CausaRaiz nvarchar(max) = N'CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_CausaRaiz
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,
    -- Filtros del tablero, con la misma convencion que usp_CorreoBacklog_Principal:
    -- NULL/vacio = sin filtro. El correo QARE los omite y devuelve lo mismo que antes.
    @C1      NVARCHAR(MAX) = NULL,
    @Grupos  NVARCHAR(MAX) = NULL,
    @Lideres NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH A AS (
        SELECT CausaRaiz = LTRIM(RTRIM(QARe_Causa)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, @C1, @Grupos, @Lideres)
        WHERE NULLIF(LTRIM(RTRIM(QARe_Causa)), N'''') IS NOT NULL
        GROUP BY LTRIM(RTRIM(QARe_Causa))
    ), P AS (
        SELECT CausaRaiz, CantidadTickets, TotalTicketsConCausa = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, CausaRaiz ASC),
               Porcentaje = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
               PorcentajeAcumulado = CAST(100.0 * SUM(CantidadTickets) OVER (ORDER BY CantidadTickets DESC, CausaRaiz ASC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT Posicion, CausaRaiz, CantidadTickets, TotalTicketsConCausa, Porcentaje, PorcentajeAcumulado
    FROM P ORDER BY Posicion;
END;';

DECLARE @ddl_usp_CorreoQARE_RecurrentesCategoria nvarchar(max) = N'CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_RecurrentesCategoria
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,
    -- Filtros del tablero, con la misma convencion que usp_CorreoBacklog_Principal:
    -- NULL/vacio = sin filtro. El correo QARE los omite y devuelve lo mismo que antes.
    @C1      NVARCHAR(MAX) = NULL,
    @Grupos  NVARCHAR(MAX) = NULL,
    @Lideres NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH A AS (
        SELECT Categoria = LTRIM(RTRIM(Categoria)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, @C1, @Grupos, @Lideres)
        WHERE UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N''FRECUENTE'', N''SIEMPRE'')
          AND NULLIF(LTRIM(RTRIM(Categoria)), N'''') IS NOT NULL
        GROUP BY LTRIM(RTRIM(Categoria))
    ), R AS (
        SELECT Categoria, CantidadTickets, TotalTicketsRecurrentes = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, Categoria ASC),
               PorcentajeRecurrentes = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, Posicion, Categoria, CantidadTickets, TotalTicketsRecurrentes, PorcentajeRecurrentes
    FROM R ORDER BY Posicion;
END;';

DECLARE @ddl_usp_CorreoQARE_ConfirmacionVsQA nvarchar(max) = N'CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_ConfirmacionVsQA
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,
    -- Filtros del tablero, con la misma convencion que usp_CorreoBacklog_Principal:
    -- NULL/vacio = sin filtro. El correo QARE los omite y devuelve lo mismo que antes.
    @C1      NVARCHAR(MAX) = NULL,
    @Grupos  NVARCHAR(MAX) = NULL,
    @Lideres NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH M AS (
        SELECT ConfirmacionUsuario = CASE
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) IN (N''SI'', N''SÍ'') THEN N''Sí''
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) = N''NO'' THEN N''No''
                   ELSE N''Sin respuesta'' END,
               ValidacionQA = ISNULL(NULLIF(LTRIM(RTRIM(Validacion)), N''''), N''Sin validación''),
               CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, @C1, @Grupos, @Lideres)
        WHERE NULLIF(LTRIM(RTRIM(QARe_VerificoClasificacion)), N'''') IS NOT NULL
        GROUP BY CASE
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) IN (N''SI'', N''SÍ'') THEN N''Sí''
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) = N''NO'' THEN N''No''
                   ELSE N''Sin respuesta'' END,
                 ISNULL(NULLIF(LTRIM(RTRIM(Validacion)), N''''), N''Sin validación'')
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, ConfirmacionUsuario, ValidacionQA, CantidadTickets,
           PorcentajeDelTotal = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
           EsInconsistencia = CASE WHEN ConfirmacionUsuario = N''Sí'' AND ValidacionQA = N''Incorrecto'' THEN 1 ELSE 0 END
    FROM M
    ORDER BY CASE ConfirmacionUsuario WHEN N''Sí'' THEN 1 WHEN N''No'' THEN 2 ELSE 3 END,
             CASE ValidacionQA WHEN N''OK'' THEN 1 WHEN N''Valido'' THEN 2 WHEN N''Incorrecto'' THEN 3 WHEN N''Sin catalogo'' THEN 4 ELSE 5 END;
END;';

DECLARE @ddl_usp_CorreoQARE_TipoSolucion nvarchar(max) = N'CREATE OR ALTER PROCEDURE dbo.usp_CorreoQARE_TipoSolucion
    @FechaInicio DATE = NULL,
    @FechaFin    DATE = NULL,
    -- Filtros del tablero, con la misma convencion que usp_CorreoBacklog_Principal:
    -- NULL/vacio = sin filtro. El correo QARE los omite y devuelve lo mismo que antes.
    @C1      NVARCHAR(MAX) = NULL,
    @Grupos  NVARCHAR(MAX) = NULL,
    @Lideres NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    ;WITH A AS (
        SELECT TipoSolucion = LTRIM(RTRIM(QARe_TipoSolucion)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.tvf_CorreoQARE_Base(@Fi, @Ff, @C1, @Grupos, @Lideres)
        WHERE NULLIF(LTRIM(RTRIM(QARe_TipoSolucion)), N'''') IS NOT NULL
        GROUP BY LTRIM(RTRIM(QARe_TipoSolucion))
    ), R AS (
        SELECT TipoSolucion, CantidadTickets, TotalTicketsConTipoSolucion = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, TipoSolucion ASC),
               Porcentaje = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, Posicion, TipoSolucion, CantidadTickets, TotalTicketsConTipoSolucion, Porcentaje
    FROM R ORDER BY Posicion;
END;';

-- ------------------------------------------------------------ 0. Prerrequisitos
DECLARE @falta nvarchar(max) = N'';
SELECT @falta = @falta + CASE WHEN OBJECT_ID(o.nombre) IS NULL THEN o.nombre + N' ' ELSE N'' END
FROM (VALUES (N'dbo.vw_CorreoQARECierre_Base'), (N'dbo.CatLiderGrupo'),
             (N'dbo.fn_CorreoBacklog_CategoriaC1'), (N'dbo.fn_CorreoBacklog_SplitList'),
             (N'dbo.usp_CorreoQARE_KPIs'), (N'dbo.usp_CorreoQARE_Frecuencia'),
             (N'dbo.usp_CorreoQARE_CausaRaiz'), (N'dbo.usp_CorreoQARE_RecurrentesCategoria'),
             (N'dbo.usp_CorreoQARE_ConfirmacionVsQA'), (N'dbo.usp_CorreoQARE_TipoSolucion')) AS o(nombre);
IF @falta <> N''
BEGIN
    RAISERROR(N'Faltan objetos: %s. No se cambio nada.', 16, 1, @falta);
    RETURN;
END;

PRINT N'==== 0. Prerrequisitos: OK ====';

-- ------------------------------------------------------------ ventanas de prueba
DECLARE @Hoy date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
DECLARE @Ventanas TABLE (V int PRIMARY KEY, Fi date NULL, Ff date NULL, Nombre nvarchar(40));
INSERT @Ventanas VALUES
    (0, NULL, NULL, N'default NULL/NULL'),
    (1, DATEADD(DAY, -14, @Hoy), @Hoy, N'15 dias'),
    (2, DATEADD(DAY, -29, @Hoy), @Hoy, N'30 dias'),
    (3, DATEADD(DAY, -59, @Hoy), DATEADD(DAY, -30, @Hoy), N'hace 60 a 30 dias'),
    (4, DATEADD(DAY, -89, @Hoy), @Hoy, N'90 dias'),
    (5, DATEADD(DAY, -1, @Hoy), DATEADD(DAY, -1, @Hoy), N'ayer');

CREATE TABLE #antes_usp_CorreoQARE_KPIs (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL, c8 nvarchar(4000) NULL, c9 nvarchar(4000) NULL, c10 nvarchar(4000) NULL, c11 nvarchar(4000) NULL, c12 nvarchar(4000) NULL, c13 nvarchar(4000) NULL);
CREATE TABLE #antes_usp_CorreoQARE_Frecuencia (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL);
CREATE TABLE #antes_usp_CorreoQARE_CausaRaiz (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL);
CREATE TABLE #antes_usp_CorreoQARE_RecurrentesCategoria (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL);
CREATE TABLE #antes_usp_CorreoQARE_ConfirmacionVsQA (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL);
CREATE TABLE #antes_usp_CorreoQARE_TipoSolucion (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL);
CREATE TABLE #despues_usp_CorreoQARE_KPIs (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL, c8 nvarchar(4000) NULL, c9 nvarchar(4000) NULL, c10 nvarchar(4000) NULL, c11 nvarchar(4000) NULL, c12 nvarchar(4000) NULL, c13 nvarchar(4000) NULL);
CREATE TABLE #despues_usp_CorreoQARE_Frecuencia (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL);
CREATE TABLE #despues_usp_CorreoQARE_CausaRaiz (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL);
CREATE TABLE #despues_usp_CorreoQARE_RecurrentesCategoria (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL);
CREATE TABLE #despues_usp_CorreoQARE_ConfirmacionVsQA (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL);
CREATE TABLE #despues_usp_CorreoQARE_TipoSolucion (Ventana int NULL, c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL);
-- Variables de tabla: sobreviven al ROLLBACK, asi el diagnostico queda.
DECLARE @Tiempos TABLE (Fase nvarchar(10), Sp sysname, Ventana int, Ms int);
DECLARE @Diferencias TABLE (Prueba nvarchar(300), Filas int);

DECLARE @v int, @vi date, @vf date, @t datetime2(7);
DECLARE ventanas CURSOR LOCAL STATIC FOR SELECT V, Fi, Ff FROM @Ventanas ORDER BY V;

-- ------------------------------------------------------------ 1. Salida ANTES
PRINT N'==== 1. Capturando la salida de los SP actuales ====';
OPEN ventanas;
FETCH NEXT FROM ventanas INTO @v, @vi, @vf;
WHILE @@FETCH_STATUS = 0
BEGIN
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #antes_usp_CorreoQARE_KPIs (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13) EXEC dbo.usp_CorreoQARE_KPIs;
        ELSE      INSERT #antes_usp_CorreoQARE_KPIs (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13) EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #antes_usp_CorreoQARE_KPIs SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'antes', N'usp_CorreoQARE_KPIs', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #antes_usp_CorreoQARE_Frecuencia (c1, c2, c3) EXEC dbo.usp_CorreoQARE_Frecuencia;
        ELSE      INSERT #antes_usp_CorreoQARE_Frecuencia (c1, c2, c3) EXEC dbo.usp_CorreoQARE_Frecuencia @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #antes_usp_CorreoQARE_Frecuencia SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'antes', N'usp_CorreoQARE_Frecuencia', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #antes_usp_CorreoQARE_CausaRaiz (c1, c2, c3, c4, c5, c6) EXEC dbo.usp_CorreoQARE_CausaRaiz;
        ELSE      INSERT #antes_usp_CorreoQARE_CausaRaiz (c1, c2, c3, c4, c5, c6) EXEC dbo.usp_CorreoQARE_CausaRaiz @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #antes_usp_CorreoQARE_CausaRaiz SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'antes', N'usp_CorreoQARE_CausaRaiz', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #antes_usp_CorreoQARE_RecurrentesCategoria (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_RecurrentesCategoria;
        ELSE      INSERT #antes_usp_CorreoQARE_RecurrentesCategoria (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_RecurrentesCategoria @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #antes_usp_CorreoQARE_RecurrentesCategoria SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'antes', N'usp_CorreoQARE_RecurrentesCategoria', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #antes_usp_CorreoQARE_ConfirmacionVsQA (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA;
        ELSE      INSERT #antes_usp_CorreoQARE_ConfirmacionVsQA (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #antes_usp_CorreoQARE_ConfirmacionVsQA SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'antes', N'usp_CorreoQARE_ConfirmacionVsQA', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #antes_usp_CorreoQARE_TipoSolucion (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_TipoSolucion;
        ELSE      INSERT #antes_usp_CorreoQARE_TipoSolucion (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_TipoSolucion @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #antes_usp_CorreoQARE_TipoSolucion SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'antes', N'usp_CorreoQARE_TipoSolucion', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
    FETCH NEXT FROM ventanas INTO @v, @vi, @vf;
END;
CLOSE ventanas;

BEGIN TRY
    BEGIN TRAN;

    -- -------------------------------------------------------- 2. Aplicar
    PRINT N'==== 2. Creando la TVF y alterando los seis SP (en transaccion) ====';
        EXEC sys.sp_executesql @ddl_tvf;
        EXEC sys.sp_executesql @ddl_usp_CorreoQARE_KPIs;
        EXEC sys.sp_executesql @ddl_usp_CorreoQARE_Frecuencia;
        EXEC sys.sp_executesql @ddl_usp_CorreoQARE_CausaRaiz;
        EXEC sys.sp_executesql @ddl_usp_CorreoQARE_RecurrentesCategoria;
        EXEC sys.sp_executesql @ddl_usp_CorreoQARE_ConfirmacionVsQA;
        EXEC sys.sp_executesql @ddl_usp_CorreoQARE_TipoSolucion;

    -- -------------------------------------------------------- 3. Salida DESPUES, sin filtros
    PRINT N'==== 3. Capturando la salida de los SP nuevos sin filtros ====';
    OPEN ventanas;
    FETCH NEXT FROM ventanas INTO @v, @vi, @vf;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #despues_usp_CorreoQARE_KPIs (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13) EXEC dbo.usp_CorreoQARE_KPIs;
        ELSE      INSERT #despues_usp_CorreoQARE_KPIs (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13) EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #despues_usp_CorreoQARE_KPIs SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'despues', N'usp_CorreoQARE_KPIs', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #despues_usp_CorreoQARE_Frecuencia (c1, c2, c3) EXEC dbo.usp_CorreoQARE_Frecuencia;
        ELSE      INSERT #despues_usp_CorreoQARE_Frecuencia (c1, c2, c3) EXEC dbo.usp_CorreoQARE_Frecuencia @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #despues_usp_CorreoQARE_Frecuencia SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'despues', N'usp_CorreoQARE_Frecuencia', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #despues_usp_CorreoQARE_CausaRaiz (c1, c2, c3, c4, c5, c6) EXEC dbo.usp_CorreoQARE_CausaRaiz;
        ELSE      INSERT #despues_usp_CorreoQARE_CausaRaiz (c1, c2, c3, c4, c5, c6) EXEC dbo.usp_CorreoQARE_CausaRaiz @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #despues_usp_CorreoQARE_CausaRaiz SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'despues', N'usp_CorreoQARE_CausaRaiz', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #despues_usp_CorreoQARE_RecurrentesCategoria (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_RecurrentesCategoria;
        ELSE      INSERT #despues_usp_CorreoQARE_RecurrentesCategoria (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_RecurrentesCategoria @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #despues_usp_CorreoQARE_RecurrentesCategoria SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'despues', N'usp_CorreoQARE_RecurrentesCategoria', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #despues_usp_CorreoQARE_ConfirmacionVsQA (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA;
        ELSE      INSERT #despues_usp_CorreoQARE_ConfirmacionVsQA (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #despues_usp_CorreoQARE_ConfirmacionVsQA SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'despues', N'usp_CorreoQARE_ConfirmacionVsQA', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        SET @t = SYSDATETIME();
        IF @v = 0 INSERT #despues_usp_CorreoQARE_TipoSolucion (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_TipoSolucion;
        ELSE      INSERT #despues_usp_CorreoQARE_TipoSolucion (c1, c2, c3, c4, c5, c6, c7) EXEC dbo.usp_CorreoQARE_TipoSolucion @FechaInicio = @vi, @FechaFin = @vf;
        UPDATE #despues_usp_CorreoQARE_TipoSolucion SET Ventana = @v WHERE Ventana IS NULL;
        INSERT @Tiempos VALUES (N'despues', N'usp_CorreoQARE_TipoSolucion', @v, DATEDIFF(MILLISECOND, @t, SYSDATETIME()));
        FETCH NEXT FROM ventanas INTO @v, @vi, @vf;
    END;
    CLOSE ventanas;

    -- -------------------------------------------------------- 4. Comparar
    PRINT N'==== 4. Comparando antes vs despues ====';
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_KPIs', COUNT(*) FROM (
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13 FROM #antes_usp_CorreoQARE_KPIs EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13 FROM #despues_usp_CorreoQARE_KPIs)
        UNION ALL
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13 FROM #despues_usp_CorreoQARE_KPIs EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13 FROM #antes_usp_CorreoQARE_KPIs)
    ) AS x;
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_KPIs (filas)', ABS((SELECT COUNT(*) FROM #antes_usp_CorreoQARE_KPIs) - (SELECT COUNT(*) FROM #despues_usp_CorreoQARE_KPIs));
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_Frecuencia', COUNT(*) FROM (
        (SELECT Ventana, c1, c2, c3 FROM #antes_usp_CorreoQARE_Frecuencia EXCEPT SELECT Ventana, c1, c2, c3 FROM #despues_usp_CorreoQARE_Frecuencia)
        UNION ALL
        (SELECT Ventana, c1, c2, c3 FROM #despues_usp_CorreoQARE_Frecuencia EXCEPT SELECT Ventana, c1, c2, c3 FROM #antes_usp_CorreoQARE_Frecuencia)
    ) AS x;
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_Frecuencia (filas)', ABS((SELECT COUNT(*) FROM #antes_usp_CorreoQARE_Frecuencia) - (SELECT COUNT(*) FROM #despues_usp_CorreoQARE_Frecuencia));
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_CausaRaiz', COUNT(*) FROM (
        (SELECT Ventana, c1, c2, c3, c4, c5, c6 FROM #antes_usp_CorreoQARE_CausaRaiz EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6 FROM #despues_usp_CorreoQARE_CausaRaiz)
        UNION ALL
        (SELECT Ventana, c1, c2, c3, c4, c5, c6 FROM #despues_usp_CorreoQARE_CausaRaiz EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6 FROM #antes_usp_CorreoQARE_CausaRaiz)
    ) AS x;
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_CausaRaiz (filas)', ABS((SELECT COUNT(*) FROM #antes_usp_CorreoQARE_CausaRaiz) - (SELECT COUNT(*) FROM #despues_usp_CorreoQARE_CausaRaiz));
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_RecurrentesCategoria', COUNT(*) FROM (
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #antes_usp_CorreoQARE_RecurrentesCategoria EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #despues_usp_CorreoQARE_RecurrentesCategoria)
        UNION ALL
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #despues_usp_CorreoQARE_RecurrentesCategoria EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #antes_usp_CorreoQARE_RecurrentesCategoria)
    ) AS x;
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_RecurrentesCategoria (filas)', ABS((SELECT COUNT(*) FROM #antes_usp_CorreoQARE_RecurrentesCategoria) - (SELECT COUNT(*) FROM #despues_usp_CorreoQARE_RecurrentesCategoria));
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_ConfirmacionVsQA', COUNT(*) FROM (
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #antes_usp_CorreoQARE_ConfirmacionVsQA EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #despues_usp_CorreoQARE_ConfirmacionVsQA)
        UNION ALL
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #despues_usp_CorreoQARE_ConfirmacionVsQA EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #antes_usp_CorreoQARE_ConfirmacionVsQA)
    ) AS x;
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_ConfirmacionVsQA (filas)', ABS((SELECT COUNT(*) FROM #antes_usp_CorreoQARE_ConfirmacionVsQA) - (SELECT COUNT(*) FROM #despues_usp_CorreoQARE_ConfirmacionVsQA));
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_TipoSolucion', COUNT(*) FROM (
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #antes_usp_CorreoQARE_TipoSolucion EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #despues_usp_CorreoQARE_TipoSolucion)
        UNION ALL
        (SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #despues_usp_CorreoQARE_TipoSolucion EXCEPT SELECT Ventana, c1, c2, c3, c4, c5, c6, c7 FROM #antes_usp_CorreoQARE_TipoSolucion)
    ) AS x;
    INSERT @Diferencias
    SELECT N'usp_CorreoQARE_TipoSolucion (filas)', ABS((SELECT COUNT(*) FROM #antes_usp_CorreoQARE_TipoSolucion) - (SELECT COUNT(*) FROM #despues_usp_CorreoQARE_TipoSolucion));

    -- -------------------------------------------------------- 5. Probar los filtros
    PRINT N'==== 5. Probando los filtros sobre la TVF (ultimos 30 dias) ====';
    DECLARE @Fi30 date = DATEADD(DAY, -29, @Hoy);

    SELECT CodigoTicket, Grupo, C1, Lider
    INTO #Base
    FROM dbo.tvf_CorreoQARE_Base(@Fi30, @Hoy, NULL, NULL, NULL);

    -- Cada ticket tiene UN Lider, UN Grupo y UN C1: filtrar por un valor
    -- tiene que dar lo mismo que agrupar por el.
    INSERT @Diferencias
    SELECT N'filtro por Lider = agrupar (valores que no cuadran)', COUNT(*)
    FROM (SELECT Lider, Tickets = COUNT(DISTINCT CodigoTicket) FROM #Base GROUP BY Lider) AS g
    CROSS APPLY (SELECT Tickets = COUNT(DISTINCT CodigoTicket)
                 FROM dbo.tvf_CorreoQARE_Base(@Fi30, @Hoy, NULL, NULL, g.Lider)) AS f
    WHERE g.Tickets <> f.Tickets;

    INSERT @Diferencias
    SELECT N'filtro por Grupo = agrupar (valores que no cuadran)', COUNT(*)
    FROM (SELECT Grupo, Tickets = COUNT(DISTINCT CodigoTicket) FROM #Base WHERE Grupo IS NOT NULL GROUP BY Grupo) AS g
    CROSS APPLY (SELECT Tickets = COUNT(DISTINCT CodigoTicket)
                 FROM dbo.tvf_CorreoQARE_Base(@Fi30, @Hoy, NULL, g.Grupo, NULL)) AS f
    WHERE g.Tickets <> f.Tickets;

    INSERT @Diferencias
    SELECT N'filtro por C1 = agrupar (valores que no cuadran)', COUNT(*)
    FROM (SELECT C1, Tickets = COUNT(DISTINCT CodigoTicket) FROM #Base GROUP BY C1) AS g
    CROSS APPLY (SELECT Tickets = COUNT(DISTINCT CodigoTicket)
                 FROM dbo.tvf_CorreoQARE_Base(@Fi30, @Hoy, g.C1, NULL, NULL)) AS f
    WHERE g.Tickets <> f.Tickets;

    -- Un ticket no puede caer en dos lideres/grupos/C1: las sumas = el total.
    INSERT @Diferencias
    SELECT N'suma por Lider/Grupo/C1 = total (dimensiones que no cuadran)',
           CASE WHEN (SELECT SUM(n) FROM (SELECT n = COUNT(DISTINCT CodigoTicket) FROM #Base GROUP BY Lider) x)
                     <> (SELECT COUNT(DISTINCT CodigoTicket) FROM #Base) THEN 1 ELSE 0 END
         + CASE WHEN (SELECT SUM(n) FROM (SELECT n = COUNT(DISTINCT CodigoTicket) FROM #Base GROUP BY Grupo) x)
                     <> (SELECT COUNT(DISTINCT CodigoTicket) FROM #Base) THEN 1 ELSE 0 END
         + CASE WHEN (SELECT SUM(n) FROM (SELECT n = COUNT(DISTINCT CodigoTicket) FROM #Base GROUP BY C1) x)
                     <> (SELECT COUNT(DISTINCT CodigoTicket) FROM #Base) THEN 1 ELSE 0 END;

    -- Lista de dos lideres (multiselect) = la suma de los dos.
    DECLARE @L1 nvarchar(500), @L2 nvarchar(500);
    SELECT TOP (1) @L1 = Lider FROM #Base GROUP BY Lider ORDER BY COUNT(*) DESC, Lider;
    SELECT TOP (1) @L2 = Lider FROM #Base WHERE Lider <> @L1 GROUP BY Lider ORDER BY COUNT(*) DESC, Lider;
    IF @L2 IS NOT NULL
        INSERT @Diferencias
        SELECT N'lista de dos lideres = la suma', CASE WHEN
            (SELECT COUNT(DISTINCT CodigoTicket) FROM dbo.tvf_CorreoQARE_Base(@Fi30, @Hoy, NULL, NULL, @L1 + N',' + @L2))
            <> (SELECT COUNT(DISTINCT CodigoTicket) FROM #Base WHERE Lider IN (@L1, @L2)) THEN 1 ELSE 0 END;

    -- C1 + Lider = su cruce.
    DECLARE @C1x nvarchar(500), @Lx nvarchar(500);
    SELECT TOP (1) @C1x = C1, @Lx = Lider FROM #Base GROUP BY C1, Lider ORDER BY COUNT(*) DESC, C1, Lider;
    INSERT @Diferencias
    SELECT N'C1 + Lider = su cruce', CASE WHEN
        (SELECT COUNT(DISTINCT CodigoTicket) FROM dbo.tvf_CorreoQARE_Base(@Fi30, @Hoy, @C1x, NULL, @Lx))
        <> (SELECT COUNT(DISTINCT CodigoTicket) FROM #Base WHERE C1 = @C1x AND Lider = @Lx) THEN 1 ELSE 0 END;

    -- El SP filtrado usa la misma fuente: KPI total = TVF filtrada.
    CREATE TABLE #kpiFiltrado (c1 nvarchar(4000) NULL, c2 nvarchar(4000) NULL, c3 nvarchar(4000) NULL, c4 nvarchar(4000) NULL, c5 nvarchar(4000) NULL, c6 nvarchar(4000) NULL, c7 nvarchar(4000) NULL, c8 nvarchar(4000) NULL, c9 nvarchar(4000) NULL, c10 nvarchar(4000) NULL, c11 nvarchar(4000) NULL, c12 nvarchar(4000) NULL, c13 nvarchar(4000) NULL);
    INSERT #kpiFiltrado EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = @Fi30, @FechaFin = @Hoy, @Lideres = @L1;
    INSERT @Diferencias
    SELECT N'KPI de SP filtrado por Lider = TVF filtrada', CASE WHEN
        (SELECT TOP (1) c1 FROM #kpiFiltrado)
        <> CONVERT(nvarchar(4000), (SELECT COUNT(DISTINCT CodigoTicket) FROM #Base WHERE Lider = @L1)) THEN 1 ELSE 0 END;

    -- -------------------------------------------------------- 6. Decidir
    IF EXISTS (SELECT 1 FROM @Diferencias WHERE Filas <> 0)
        RAISERROR(N'Hay diferencias (ver la tabla de pruebas). Se revierte todo.', 16, 1);

    COMMIT;
    PRINT N'==== RESULTADO: APLICADO. Todas las pruebas cuadran. ====';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    PRINT N'==== RESULTADO: REVERTIDO. No quedo ningun cambio. ====';
    PRINT N'Error: ' + ERROR_MESSAGE();
END CATCH;

IF CURSOR_STATUS('local', 'ventanas') >= -1 DEALLOCATE ventanas;

-- ------------------------------------------------------------ 7. Reporte
PRINT N'==== 7a. Pruebas (Filas = 0 es OK) ====';
SELECT Prueba, Filas, Estado = CASE WHEN Filas = 0 THEN N'OK' ELSE N'FALLA' END FROM @Diferencias;

PRINT N'==== 7b. Tiempo por SP (ms, suma de las seis ventanas) ====';
SELECT Sp,
       Antes   = SUM(CASE WHEN Fase = N'antes'   THEN Ms END),
       Despues = SUM(CASE WHEN Fase = N'despues' THEN Ms END)
FROM @Tiempos
GROUP BY Sp
ORDER BY Sp;

PRINT N'==== FIN ====';

