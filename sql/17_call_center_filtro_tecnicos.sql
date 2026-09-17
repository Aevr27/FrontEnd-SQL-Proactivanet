/* =====================================================================================
   17) Filtro de Tecnicos en el Call Center

   Base destino: Tickets_Proactivanet
   Requiere:     15_dashboard_llamadas.sql y 16_cruce_llamadas_tickets.sql (rama
                 feature/tablero-sla-productividad del repo Integracion_SQL),
                 dbo.fn_Dash_SplitListPipe, dbo.CatAgenteTecnico y
                 dbo.CatAgenteTecnicoAlias.

   QUE HACE
   --------
   Agrega @Tecnicos (lista separada por '|') a dos procedimientos, sin tocar
   nada mas de ellos:

   - dbo.usp_Dash_LlamadasGraficas: solo el result set 4 (por agente) se acota.
     Tendencia, campana y hora siguen siendo de toda la cola.
   - dbo.usp_Dash_CargaCombinada: se acota el llenado de #C, y con eso los dos
     result sets.

   @Tecnicos vacio o NULL = el comportamiento de siempre.

   POR QUE fn_Dash_SplitListPipe
   Los nombres de tecnico traen coma ("Apellidos, Nombre"): fn_Dash_SplitList
   los partiria. El sitio ya manda la lista separada por '|'.

   COMO SE LIGA UN TECNICO CON SU EXTENSION
   El nombre elegido se busca en dbo.CatAgenteTecnico.Tecnico (Habilitado = 1).
   La lista del sitio sale de los nombres de los tickets, que incluyen nombres
   viejos de gente a la que le corrigieron el usuario; esos llegan por
   dbo.CatAgenteTecnicoAlias. No se usa dbo.vw_TecnicoAgente.

   SEGURIDAD
   ---------
   Los cuerpos de abajo son los de 15 y 16 de esa rama, mas las lineas de
   @Tecnicos. Antes de cambiar nada, el script compara la definicion que hay en
   la base contra esos cuerpos (SHA2_256, sin CR y sin espacios en los
   extremos). Si alguno no coincide, NO se aplica nada (SET NOEXEC ON) y se
   informa el hash encontrado. Correrlo dos veces es seguro.

   El sitio solo manda @Tecnicos cuando hay tecnicos elegidos: desplegado
   antes que este script, el Call Center funciona mientras no se elija ningun
   tecnico; al elegir uno, esos bloques dan error hasta aplicar el script.

   Compatible con SQL Server 2016+.
   ===================================================================================== */

USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
GO

/* ---------- Verificacion previa: todo o nada ---------- */
DECLARE @ok BIT = 1, @d NVARCHAR(MAX), @h VARBINARY(32), @hx VARCHAR(66);

IF OBJECT_ID(N'dbo.fn_Dash_SplitListPipe') IS NULL
   OR OBJECT_ID(N'dbo.CatAgenteTecnico', N'U') IS NULL
   OR OBJECT_ID(N'dbo.CatAgenteTecnicoAlias', N'U') IS NULL
BEGIN
    RAISERROR (N'Falta dbo.fn_Dash_SplitListPipe, dbo.CatAgenteTecnico o dbo.CatAgenteTecnicoAlias. No se aplico nada.', 16, 1);
    SET @ok = 0;
END

SET @d = REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Dash_LlamadasGraficas')), NCHAR(13), N'');
WHILE LEN(@d + N'x') > 1 AND LEFT(@d, 1) IN (N' ', NCHAR(9), NCHAR(10)) SET @d = STUFF(@d, 1, 1, N'');
WHILE LEN(@d + N'x') > 1 AND RIGHT(@d, 1) IN (N' ', NCHAR(9), NCHAR(10)) SET @d = LEFT(@d, LEN(@d + N'x') - 2);
SET @h = HASHBYTES('SHA2_256', @d);
IF @d IS NULL
BEGIN
    RAISERROR (N'Falta dbo.usp_Dash_LlamadasGraficas. No se aplico nada.', 16, 1);
    SET @ok = 0;
END
ELSE IF @h = 0x43BCE5D71FA31A86DDDABB16D90FA3066BF51133AE825C2EE4DBA8181D1E982F
    PRINT N'dbo.usp_Dash_LlamadasGraficas: ya tiene @Tecnicos; se vuelve a aplicar igual.';
ELSE IF @h <> 0x206F7757796D48EBB38F6ADFCFDF85E9961722718F31E64F9DDA2D74FCE40C7C
BEGIN
    SET @hx = CONVERT(VARCHAR(66), @h, 1);
    RAISERROR (N'dbo.usp_Dash_LlamadasGraficas en la base NO es la version esperada (hash %s). No se aplico nada: manda la definicion completa.', 16, 1, @hx);
    SET @ok = 0;
END
ELSE
    PRINT N'dbo.usp_Dash_LlamadasGraficas: definicion esperada, se aplica @Tecnicos.';

SET @d = REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_Dash_CargaCombinada')), NCHAR(13), N'');
WHILE LEN(@d + N'x') > 1 AND LEFT(@d, 1) IN (N' ', NCHAR(9), NCHAR(10)) SET @d = STUFF(@d, 1, 1, N'');
WHILE LEN(@d + N'x') > 1 AND RIGHT(@d, 1) IN (N' ', NCHAR(9), NCHAR(10)) SET @d = LEFT(@d, LEN(@d + N'x') - 2);
SET @h = HASHBYTES('SHA2_256', @d);
IF @d IS NULL
BEGIN
    RAISERROR (N'Falta dbo.usp_Dash_CargaCombinada. No se aplico nada.', 16, 1);
    SET @ok = 0;
END
ELSE IF @h = 0x0FE3BC63A6DED38B142508D2D945564AB2883F4E5257F37C111EB3E0E30CB77D
    PRINT N'dbo.usp_Dash_CargaCombinada: ya tiene @Tecnicos; se vuelve a aplicar igual.';
ELSE IF @h <> 0x0EE418BCC18E99FBE4551ED06685BD7FAE499F81F60C778A0F7AF8E2CC560163
BEGIN
    SET @hx = CONVERT(VARCHAR(66), @h, 1);
    RAISERROR (N'dbo.usp_Dash_CargaCombinada en la base NO es la version esperada (hash %s). No se aplico nada: manda la definicion completa.', 16, 1, @hx);
    SET @ok = 0;
END
ELSE
    PRINT N'dbo.usp_Dash_CargaCombinada: definicion esperada, se aplica @Tecnicos.';

IF @ok = 0 SET NOEXEC ON;
GO

/* =====================================================================================
   2) Las graficas, en un solo viaje

      Cuatro result sets. Se resuelven juntos por lo mismo que
      usp_CorreoServicio_Principal: una sola ida a SQL y, sobre todo, ningun
      bloque puede quedar filtrado distinto de otro.

        1  Tendencia diaria      recibidas / contestadas / abandonadas
        2  Por campana           volumen y % de abandono
        3  Por hora del dia      para dimensionar turnos
        4  Por agente            top por volumen atendido
   ===================================================================================== */
CREATE OR ALTER PROCEDURE dbo.usp_Dash_LlamadasGraficas
    @FechaInicio DATE,
    @FechaFin    DATE,
    @Campanas    NVARCHAR(MAX) = NULL,
    @TopAgentes  INT = 15,
    @Tecnicos    NVARCHAR(MAX) = NULL   -- lista separada por '|'
AS
BEGIN
    SET NOCOUNT ON;

    IF OBJECT_ID('tempdb..#B') IS NOT NULL DROP TABLE #B;
    SELECT l.FechaLlamadaDia, l.NumeroCola, l.Campana, l.NumeroAgente, l.NombreAgente,
           l.EsperaSeg, l.DuracionSeg, l.EsContestada, l.EsAbandonada,
           l.EsAbandonoContable, l.EsColgadoRapido,
           Hora = DATEPART(HOUR, l.FechaLlamada)
    INTO #B
    FROM dbo.Llamadas AS l
    WHERE l.FechaLlamadaDia >= @FechaInicio
      AND l.FechaLlamadaDia <= @FechaFin
      AND (NULLIF(LTRIM(RTRIM(@Campanas)), N'') IS NULL
           OR CONVERT(NVARCHAR(20), l.NumeroCola) IN (SELECT Valor FROM dbo.fn_Dash_SplitList(@Campanas)));

    /* ---------- 1) Tendencia diaria ---------- */
    SELECT
        Fecha       = FechaLlamadaDia,
        Llamadas    = COUNT(*),
        Contestadas = SUM(CONVERT(INT, EsContestada)),
        Abandonadas = SUM(CONVERT(INT, EsAbandonoContable)),
        AbandonoPct = CONVERT(DECIMAL(6,2),
                      100.0 * SUM(CONVERT(INT, EsAbandonoContable)) / NULLIF(COUNT(*), 0))
    FROM #B
    GROUP BY FechaLlamadaDia
    ORDER BY FechaLlamadaDia;

    /* ---------- 2) Por campana ---------- */
    SELECT
        Campana     = ISNULL(c.Nombre, b.Campana),
        NumeroCola  = b.NumeroCola,
        Llamadas    = COUNT(*),
        Contestadas = SUM(CONVERT(INT, b.EsContestada)),
        Abandonadas = SUM(CONVERT(INT, b.EsAbandonoContable)),
        AbandonoPct = CONVERT(DECIMAL(6,2),
                      100.0 * SUM(CONVERT(INT, b.EsAbandonoContable)) / NULLIF(COUNT(*), 0)),
        EsperaPromSeg = CONVERT(INT, AVG(CONVERT(FLOAT, b.EsperaSeg)))
    FROM #B AS b
    LEFT JOIN dbo.CatCampanaLlamadas AS c ON c.NumeroCola = b.NumeroCola
    GROUP BY ISNULL(c.Nombre, b.Campana), b.NumeroCola
    ORDER BY COUNT(*) DESC;

    /* ---------- 3) Por hora del dia ----------
       Se devuelven las 24 horas aunque no haya llamadas: si no, el eje de la
       grafica se salta las horas muertas y la curva del dia sale deformada. */
    ;WITH horas AS (
        SELECT h = 0
        UNION ALL SELECT h + 1 FROM horas WHERE h < 23
    )
    SELECT
        Hora        = h.h,
        Llamadas    = ISNULL(COUNT(b.Hora), 0),
        Contestadas = ISNULL(SUM(CONVERT(INT, b.EsContestada)), 0),
        Abandonadas = ISNULL(SUM(CONVERT(INT, b.EsAbandonoContable)), 0)
    FROM horas AS h
    LEFT JOIN #B AS b ON b.Hora = h.h
    GROUP BY h.h
    ORDER BY h.h
    OPTION (MAXRECURSION 25);

    /* ---------- 4) Por agente ----------
       Solo las contestadas: las abandonadas no tienen agente. */
    SELECT TOP (@TopAgentes)
        Agente          = ISNULL(NombreAgente, CONVERT(NVARCHAR(20), NumeroAgente)),
        NumeroAgente    = NumeroAgente,
        Atendidas       = COUNT(*),
        DuracionPromSeg = CONVERT(INT, AVG(CONVERT(FLOAT, DuracionSeg))),
        MinutosHablados = SUM(DuracionSeg) / 60
    FROM #B
    WHERE EsContestada = 1 AND NumeroAgente IS NOT NULL
      -- @Tecnicos (17_call_center_filtro_tecnicos.sql): solo este bloque se
      -- acota. La llamada trae extension, no tecnico: el nombre elegido se
      -- busca en dbo.CatAgenteTecnico y, si es un nombre viejo, en
      -- dbo.CatAgenteTecnicoAlias. Vacio = todos, como antes.
      AND (NULLIF(LTRIM(RTRIM(@Tecnicos)), N'') IS NULL
           OR NumeroAgente IN (
               SELECT c.NumeroAgente
               FROM dbo.CatAgenteTecnico AS c
               WHERE c.Habilitado = 1
                 AND (c.Tecnico IN (SELECT Valor FROM dbo.fn_Dash_SplitListPipe(@Tecnicos))
                      OR c.NumeroAgente IN (SELECT a.NumeroAgente FROM dbo.CatAgenteTecnicoAlias AS a
                                            WHERE a.Tecnico IN (SELECT Valor FROM dbo.fn_Dash_SplitListPipe(@Tecnicos))))))
    GROUP BY ISNULL(NombreAgente, CONVERT(NVARCHAR(20), NumeroAgente)), NumeroAgente
    ORDER BY COUNT(*) DESC;

    DROP TABLE #B;
END;
GO

/* =====================================================================================
   6) Lo que consume el sitio

      Dos result sets: el detalle por tecnico y la serie diaria del equipo.
   ===================================================================================== */
CREATE OR ALTER PROCEDURE dbo.usp_Dash_CargaCombinada
    @FechaInicio DATE,
    @FechaFin    DATE,
    @Grupos      NVARCHAR(MAX) = N'Service Desk,End User',
    @Top         INT = 20,
    @Tecnicos    NVARCHAR(MAX) = NULL   -- lista separada por '|'
AS
BEGIN
    SET NOCOUNT ON;

    -- Solo la gente que esta en el catalogo: es la que hace las dos cosas y
    -- de la que el cruce dice algo. Sin esto la tabla se llenaria de tecnicos
    -- con cero llamadas que ya salen en las graficas de arriba.
    IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;
    SELECT c.Tecnico, c.Grupo
    INTO #C
    FROM dbo.CatAgenteTecnico AS c
    WHERE c.Habilitado = 1
      AND NULLIF(LTRIM(RTRIM(c.Tecnico)), N'') IS NOT NULL
      AND (NULLIF(LTRIM(RTRIM(@Grupos)), N'') IS NULL
           OR c.Grupo IN (SELECT Valor FROM dbo.fn_Dash_SplitList(@Grupos)))
      -- @Tecnicos (17_call_center_filtro_tecnicos.sql): solo entran al
      -- catalogo los tecnicos elegidos, y con eso se acotan los dos result
      -- sets. Un nombre viejo llega por dbo.CatAgenteTecnicoAlias. Vacio =
      -- todos, como antes.
      AND (NULLIF(LTRIM(RTRIM(@Tecnicos)), N'') IS NULL
           OR c.Tecnico IN (SELECT Valor FROM dbo.fn_Dash_SplitListPipe(@Tecnicos))
           OR c.NumeroAgente IN (SELECT a.NumeroAgente FROM dbo.CatAgenteTecnicoAlias AS a
                                 WHERE a.Tecnico IN (SELECT Valor FROM dbo.fn_Dash_SplitListPipe(@Tecnicos))));

    /* ---------- 1) Por tecnico ---------- */
    SELECT TOP (@Top)
        v.Tecnico,
        c.Grupo,
        Tickets   = SUM(v.Tickets),
        Llamadas  = SUM(v.Llamadas),
        Atenciones = SUM(v.Atenciones),
        MinutosHablados = SUM(v.MinutosHablados),
        -- Que porcentaje de lo que despacho fueron llamadas. Es el numero que
        -- explica por que alguien cierra pocos tickets.
        LlamadasPct = CONVERT(DECIMAL(5,2),
                      100.0 * SUM(v.Llamadas) / NULLIF(SUM(v.Atenciones), 0))
    FROM dbo.vw_CargaTecnicoDia AS v
    INNER JOIN #C AS c ON c.Tecnico = v.Tecnico
    WHERE v.Dia BETWEEN @FechaInicio AND @FechaFin
    GROUP BY v.Tecnico, c.Grupo
    ORDER BY SUM(v.Atenciones) DESC;

    /* ---------- 2) Serie diaria del equipo ---------- */
    SELECT
        Fecha    = v.Dia,
        Tickets  = SUM(v.Tickets),
        Llamadas = SUM(v.Llamadas)
    FROM dbo.vw_CargaTecnicoDia AS v
    INNER JOIN #C AS c ON c.Tecnico = v.Tecnico
    WHERE v.Dia BETWEEN @FechaInicio AND @FechaFin
    GROUP BY v.Dia
    ORDER BY v.Dia;

    DROP TABLE #C;
END;
GO

SET NOEXEC OFF;
GO

/* =====================================================================================
   Comprobaciones
   =====================================================================================

-- Sin @Tecnicos: mismo resultado que antes del script.
EXEC dbo.usp_Dash_LlamadasGraficas @FechaInicio = '2026-08-01', @FechaFin = '2026-08-31';
EXEC dbo.usp_Dash_CargaCombinada   @FechaInicio = '2026-08-01', @FechaFin = '2026-08-31';

-- Con un tecnico: el result set 4 y la carga combinada solo traen a esa persona.
-- El nombre se copia EXACTO de dbo.CatAgenteTecnico.Tecnico.
DECLARE @t NVARCHAR(MAX) = (SELECT TOP (1) Tecnico FROM dbo.CatAgenteTecnico WHERE Habilitado = 1 ORDER BY NumeroAgente);
EXEC dbo.usp_Dash_LlamadasGraficas @FechaInicio = '2026-08-01', @FechaFin = '2026-08-31', @Tecnicos = @t;
EXEC dbo.usp_Dash_CargaCombinada   @FechaInicio = '2026-08-01', @FechaFin = '2026-08-31', @Tecnicos = @t;

-- Con un nombre viejo (alias): debe traer a la misma persona que su nombre actual.
DECLARE @alias NVARCHAR(MAX) = (SELECT TOP (1) Tecnico FROM dbo.CatAgenteTecnicoAlias);
EXEC dbo.usp_Dash_CargaCombinada   @FechaInicio = '2026-08-01', @FechaFin = '2026-08-31', @Tecnicos = @alias;

-- Permisos: CREATE OR ALTER conserva los que ya hay. Solo si faltaran:
GRANT EXECUTE ON dbo.usp_Dash_LlamadasGraficas TO [PROACTIVANETAD];
GRANT EXECUTE ON dbo.usp_Dash_CargaCombinada   TO [PROACTIVANETAD];
*/
