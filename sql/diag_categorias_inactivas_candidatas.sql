/* =====================================================================
   INVESTIGACION -- Categorias INACTIVE_CATEGORY: que Problems/Iniciativas
   siguen dentro, cuanta actividad real de tickets tienen, y que
   categorias ACTIVAS del catalogo podrian representarlas.

   NATURALEZA DEL SCRIPT
   ---------------------
   - SOLO LECTURA. Ningun INSERT/UPDATE/DELETE/MERGE/TRUNCATE. Ninguna
     creacion ni alteracion de objeto permanente. Ninguna llamada a
     procedimiento almacenado. Lo unico que se materializa son tablas
     temporales locales (#), con SELECT INTO.
   - INVESTIGATIVO. No decide nada, no propone un cambio de datos.
   - ENFOCADO en INACTIVE_CATEGORY. Los otros estados del catalogo
     (STALE_CATEGORY / MISSING_CATEGORY) quedan fuera a proposito: los
     cubre sql/diag_categorias_problemas_tickets.sql.
   - NO ES UNA HERRAMIENTA DE REASIGNACION AUTOMATICA. La columna
     CandidateMatchReason describe una relacion ESTRUCTURAL objetiva
     entre dos rutas del catalogo. No dice "esta es la categoria
     correcta". Esa decision es humana y este script no la toma.

   DE DONDE SALE CADA REGLA (todo reusado, nada inventado)
   -------------------------------------------------------
   - Normalizacion e identidad de categoria .... dbo.fn_NormalizaCategoria
     (replica en C# ExperienciaQueries.Normaliza)
   - Estado del catalogo por ruta .............. dbo.Categorias
     (VigenteEnOrigen / Inactiva), colapsado por ruta normalizada con la
     misma regla del script previo: ACTIVE si existe al menos una fila
     vigente y no inactiva, INACTIVE si todas las vigentes estan
     inactivas, STALE si no hay ninguna vigente.
   - Volumen del slot vigente .................. dbo.vw_TBSlotCAT
     ([Categoria V2] ya es fn_NormalizaCategoria de Tickets.Categoria)
   - Tickets ................................... dbo.vw_TicketsSlotsBase
     (+ dbo.vw_Tickets solo donde hace falta la ruta cruda). Es la fuente
     canonica que ya usa el tablero; no se usa ninguna otra.
   - Iniciativas y su deduplicacion ............ dbo.vw_ProblemCategoria,
     una fila por (Codigo, Categoria) via ROW_NUMBER, igual que
     ExperienciaQueries.LeerIniciativas()
   - Elegibilidad de Experiencia ............... copiada de
     App_Code/ExperienciaQueries.cs:
       VigenteEnOrigen = 1
       Estado en (En Analisis / En Solucion / En Monitoreo), comparado
         sin acentos y sin mayusculas -> COLLATE Latin1_General_CI_AI
       TipoAgrupado en (Problem / SorIA / Adopcion / Mejora), comparado
         sin mayusculas pero CON acentos -> COLLATE Latin1_General_CI_AS
     Si esas listas cambian en el C#, hay que cambiarlas aqui.
   - Jerarquia C1 / C1C2 ....................... dbo.fn_CategoriaC1 y
     dbo.fn_CategoriaC1C2 (replicas en C#: C1De / C1DeTsql / C1C2De).
     No se define ninguna jerarquia nueva.

   LA DISTINCION QUE NO HAY QUE MEZCLAR
   ------------------------------------
   Volumen historico NO prueba que una categoria siga en uso. Por eso
   TicketsSlotActual (slot vigente) y TicketsVentana / VolumenTodoSlot
   (historico) viajan SIEMPRE en columnas separadas, y el resumen las
   cuenta por separado.

   SIN SIMILITUD DIFUSA
   --------------------
   No hay fuzzy matching, ni Levenshtein, ni SOUNDEX, ni LIKE sobre
   nombres. El repo no tiene ninguna funcion de similitud establecida.
   Las unicas relaciones de candidatura son las estructurales de arriba.
   ===================================================================== */

SET NOCOUNT ON;

/* ---------------------------------------------------------------------
   Parametros.
   @Slot        slot "vigente" del volumen. 0 = ultimos 30 dias, que es
                con lo que abre el tablero (experiencia.js).
   @TkSlotMin/Max  ventana de auditoria de tickets, en slots. 0..9 cubre
                los ultimos 300 dias, todo lo que clasifica
                dbo.vw_TicketsSlotsBase.
   @TopeDetalle tope de filas del detalle de tickets crudos (resultado 6).
   ------------------------------------------------------------------ */
DECLARE @Slot        INT = 0;
DECLARE @TkSlotMin   INT = 0;
DECLARE @TkSlotMax   INT = 9;
DECLARE @TopeDetalle INT = 5000;

IF OBJECT_ID('tempdb..#cat')   IS NOT NULL DROP TABLE #cat;
IF OBJECT_ID('tempdb..#vol')   IS NOT NULL DROP TABLE #vol;
IF OBJECT_ID('tempdb..#tkcat') IS NOT NULL DROP TABLE #tkcat;
IF OBJECT_ID('tempdb..#ini')   IS NOT NULL DROP TABLE #ini;
IF OBJECT_ID('tempdb..#audit') IS NOT NULL DROP TABLE #audit;
IF OBJECT_ID('tempdb..#inact') IS NOT NULL DROP TABLE #inact;
IF OBJECT_ID('tempdb..#cand')  IS NOT NULL DROP TABLE #cand;


/* =====================================================================
   1) CATALOGO por ruta normalizada, con su corte jerarquico.

   Se agrupa por RutaNorm porque dbo.Categorias tiene PK por Id: dos Ids
   pueden compartir ruta (tipico cuando la categoria se recrea en el
   origen). C1 / C1C2 / RutaPadre son funcion pura de la ruta, asi que
   dentro de un grupo son constantes: MAX() solo las arrastra.

   RutaPadre = la ruta sin su ultimo segmento. Es el MISMO modelo de ruta
   separada por "/" sobre el que cortan fn_CategoriaC1 (primer segmento)
   y fn_CategoriaC1C2 (dos primeros). Aqui se calcula en T-SQL plano
   porque el repo no expone una funcion "padre"; si algun dia existe, hay
   que cambiar esta expresion por esa funcion.
   ------------------------------------------------------------------ */
SELECT
    RutaNorm          = x.RutaNorm,
    C1                = MAX(x.C1),
    C1C2              = MAX(x.C1C2),
    RutaPadre         = MAX(x.RutaPadre),
    Filas             = COUNT_BIG(*),
    FilasVigentes     = SUM(CASE WHEN x.VigenteEnOrigen = 1 THEN 1 ELSE 0 END),
    FilasVigActivas   = SUM(CASE WHEN x.VigenteEnOrigen = 1 AND ISNULL(x.Inactiva, 0) = 0 THEN 1 ELSE 0 END),
    FilasVigInactivas = SUM(CASE WHEN x.VigenteEnOrigen = 1 AND ISNULL(x.Inactiva, 0) = 1 THEN 1 ELSE 0 END)
INTO #cat
FROM (
    SELECT
        RutaNorm  = y.RutaNorm,
        C1        = dbo.fn_CategoriaC1(y.RutaNorm)   COLLATE Latin1_General_CI_AS,
        C1C2      = dbo.fn_CategoriaC1C2(y.RutaNorm) COLLATE Latin1_General_CI_AS,
        RutaPadre = CASE
                        WHEN CHARINDEX(N'/', REVERSE(y.RutaNorm)) = 0 THEN NULL
                        ELSE LEFT(y.RutaNorm, LEN(y.RutaNorm + N'|') - 1
                                              - CHARINDEX(N'/', REVERSE(y.RutaNorm)))
                    END COLLATE Latin1_General_CI_AS,
        y.Inactiva,
        y.VigenteEnOrigen
    FROM (
        SELECT
            RutaNorm = dbo.fn_NormalizaCategoria(c.RutaCompleta) COLLATE Latin1_General_CI_AS,
            c.Inactiva,
            c.VigenteEnOrigen
        FROM dbo.Categorias AS c
        WHERE c.RutaCompleta IS NOT NULL
    ) AS y
    WHERE y.RutaNorm <> N''
) AS x
GROUP BY x.RutaNorm;

-- Indice sobre TEMPORAL LOCAL, no sobre ningun objeto permanente.
CREATE UNIQUE CLUSTERED INDEX IX_cat  ON #cat (RutaNorm);
CREATE NONCLUSTERED INDEX     IX_cat2 ON #cat (C1, C1C2, RutaPadre);


/* =====================================================================
   2) VOLUMEN por categoria (dbo.vw_TBSlotCAT).

   Se vuelve a normalizar [Categoria V2] -aunque ya venga normalizada-
   para que la llave de cruce sea identica por construccion. Se normaliza
   DESPUES de agregar, para no pagar el UDF escalar por fila.
   ------------------------------------------------------------------ */
SELECT
    RutaNorm          = z.RutaNorm,
    VolumenSlotActual = SUM(z.VolActual),
    VolumenTodoSlot   = SUM(z.VolTodo)
INTO #vol
FROM (
    SELECT
        RutaNorm  = dbo.fn_NormalizaCategoria(a.Cat) COLLATE Latin1_General_CI_AS,
        a.VolActual,
        a.VolTodo
    FROM (
        SELECT
            Cat       = s.[Categoria V2],
            VolActual = SUM(CASE WHEN s.Slot = @Slot THEN s.[Total general] ELSE 0 END),
            VolTodo   = SUM(s.[Total general])
        FROM dbo.vw_TBSlotCAT AS s
        GROUP BY s.[Categoria V2]
    ) AS a
) AS z
GROUP BY z.RutaNorm;

CREATE UNIQUE CLUSTERED INDEX IX_vol ON #vol (RutaNorm);


/* =====================================================================
   3) ACTIVIDAD DE TICKETS por categoria (fuente canonica).

   dbo.vw_TicketsSlotsBase es la unica fuente de tickets del script, la
   misma del detalle del tablero. FechaRegistro y Slot salen de esa
   vista; UltimoTicket = MAX(FechaRegistro) dentro de la ventana, no
   necesita ningun supuesto extra.
   OJO: UltimoTicket esta ACOTADO por la ventana @TkSlotMin..@TkSlotMax.
   No es "el ultimo ticket de la historia", es "el ultimo de la ventana".
   Se agrega sobre todas las categorias, no solo las inactivas, porque
   las candidatas activas del paso 4 necesitan las mismas cifras.
   ------------------------------------------------------------------ */
SELECT
    RutaNorm          = w.RutaNorm,
    TicketsVentana    = SUM(w.Tk),
    TicketsSlotActual = SUM(w.TkActual),
    UltimoTicket      = MAX(w.Ultimo)
INTO #tkcat
FROM (
    SELECT
        RutaNorm = dbo.fn_NormalizaCategoria(b.Cat) COLLATE Latin1_General_CI_AS,
        b.Tk, b.TkActual, b.Ultimo
    FROM (
        SELECT
            Cat      = s.CategoriaV2,
            Tk       = COUNT_BIG(*),
            TkActual = SUM(CASE WHEN s.Slot = @Slot THEN 1 ELSE 0 END),
            Ultimo   = MAX(s.FechaRegistro)
        FROM dbo.vw_TicketsSlotsBase AS s
        WHERE s.Slot BETWEEN @TkSlotMin AND @TkSlotMax
        GROUP BY s.CategoriaV2
    ) AS b
) AS w
GROUP BY w.RutaNorm;

CREATE UNIQUE CLUSTERED INDEX IX_tkcat ON #tkcat (RutaNorm);


/* =====================================================================
   4) INICIATIVAS, una fila por (Codigo, Categoria).

   dbo.vw_ProblemCategoria abanica: su LEFT JOIN contra
   dbo.CatCategoriaDueno por C1 repite cada fila de dbo.ProblemCategoria
   tantas veces como filas tenga ese C1 en el catalogo de duenos.
   LeerIniciativas() se queda con la primera de cada (Codigo, Categoria)
   -pareja unica en la tabla base- y aqui se reproduce con ROW_NUMBER.
   Sin esto los Problems salen multiplicados.
   ------------------------------------------------------------------ */
SELECT
    q.Codigo,
    q.Categoria,
    CategoriaNorm = dbo.fn_NormalizaCategoria(q.Categoria) COLLATE Latin1_General_CI_AS,
    q.C1,
    q.C1C2,
    q.Iniciativa,
    q.Titulo,
    q.Estado,
    q.TipoAgrupado,
    q.TicketsReduce,
    q.VigenteEnOrigen,
    CategoriaInactivaVista = q.CategoriaInactiva,
    q.FechaCreacion,
    q.FechaCierre
INTO #ini
FROM (
    SELECT
        v.Codigo, v.Categoria, v.C1, v.C1C2, v.Iniciativa, v.Titulo,
        v.Estado, v.TipoAgrupado, v.TicketsReduce, v.VigenteEnOrigen,
        v.CategoriaInactiva, v.FechaCreacion, v.FechaCierre,
        rn = ROW_NUMBER() OVER (PARTITION BY v.Codigo, v.Categoria ORDER BY (SELECT NULL))
    FROM dbo.vw_ProblemCategoria AS v
) AS q
WHERE q.rn = 1;


/* =====================================================================
   5) AUDITORIA, restringida a INACTIVE_CATEGORY.

   El estado se calcula con la misma regla del script previo y DESPUES se
   filtra, para que la definicion de INACTIVE_CATEGORY sea literalmente
   la misma expresion y no una reescrita:
       FilasVigentes > 0 AND FilasVigActivas = 0
   ------------------------------------------------------------------ */
SELECT
    i.Codigo,
    i.Categoria,
    i.CategoriaNorm,
    i.C1,
    i.C1C2,
    i.Iniciativa,
    i.Titulo,
    i.Estado,
    i.TipoAgrupado,
    i.TicketsReduce,
    IniciativaVigente = i.VigenteEnOrigen,

    ExperienciaActiva = CASE
        WHEN LTRIM(RTRIM(ISNULL(i.Estado, N''))) COLLATE Latin1_General_CI_AI
             IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
        THEN 1 ELSE 0 END,
    ExperienciaAgrupadorValido = CASE
        WHEN i.TipoAgrupado COLLATE Latin1_General_CI_AS
             IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora')
        THEN 1 ELSE 0 END,
    ExperienciaElegible = CASE
        WHEN i.VigenteEnOrigen = 1
         AND LTRIM(RTRIM(ISNULL(i.Estado, N''))) COLLATE Latin1_General_CI_AI
             IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
         AND i.TipoAgrupado COLLATE Latin1_General_CI_AS
             IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora')
        THEN 1 ELSE 0 END,

    CategoriaStatus   = CONVERT(VARCHAR(20), 'INACTIVE_CATEGORY'),
    CategoriaInactiva = CONVERT(BIT, 1),
    CategoriaVigente  = CONVERT(BIT, 1),   -- INACTIVE implica FilasVigentes > 0
    CategoriaInactivaVista = i.CategoriaInactivaVista,

    CatC1             = c.C1,
    CatC1C2           = c.C1C2,
    CatRutaPadre      = c.RutaPadre,

    ExisteEnSlotCAT   = CASE WHEN v.RutaNorm IS NULL THEN 0 ELSE 1 END,
    VolumenSlotActual = ISNULL(v.VolumenSlotActual, 0),
    VolumenTodoSlot   = ISNULL(v.VolumenTodoSlot, 0),
    TicketsSlotActual = ISNULL(tk.TicketsSlotActual, 0),
    TicketsVentana    = ISNULL(tk.TicketsVentana, 0),
    UltimoTicket      = tk.UltimoTicket,

    i.FechaCreacion,
    i.FechaCierre
INTO #audit
FROM #ini AS i
INNER JOIN #cat   AS c  ON c.RutaNorm  = i.CategoriaNorm
LEFT  JOIN #vol   AS v  ON v.RutaNorm  = i.CategoriaNorm
LEFT  JOIN #tkcat AS tk ON tk.RutaNorm = i.CategoriaNorm
WHERE c.FilasVigentes > 0
  AND c.FilasVigActivas = 0;   -- = INACTIVE_CATEGORY


/* =====================================================================
   6) UNIVERSO DE CATEGORIAS INACTIVAS con iniciativas dentro.
   ------------------------------------------------------------------ */
SELECT
    a.CategoriaNorm,
    CategoriaStatus     = MAX(a.CategoriaStatus),
    CategoriaInactiva   = MAX(CONVERT(TINYINT, a.CategoriaInactiva)),
    CategoriaVigente    = MAX(CONVERT(TINYINT, a.CategoriaVigente)),
    C1                  = MAX(a.CatC1),
    C1C2                = MAX(a.CatC1C2),
    RutaPadre           = MAX(a.CatRutaPadre),
    VolumenSlotActual   = MAX(a.VolumenSlotActual),
    VolumenTodoSlot     = MAX(a.VolumenTodoSlot),
    TicketsSlotActual   = MAX(a.TicketsSlotActual),
    TicketsVentana      = MAX(a.TicketsVentana),
    UltimoTicket        = MAX(a.UltimoTicket),
    Iniciativas         = COUNT_BIG(*),
    Folios              = COUNT(DISTINCT a.Codigo),
    Activas             = SUM(CONVERT(INT, a.ExperienciaActiva)),
    Elegibles           = SUM(CONVERT(INT, a.ExperienciaElegible)),
    NoActivas           = SUM(CASE WHEN a.ExperienciaActiva = 0 THEN 1 ELSE 0 END),
    TicketsReduce       = SUM(ISNULL(a.TicketsReduce, 0))
INTO #inact
FROM #audit AS a
GROUP BY a.CategoriaNorm;

CREATE UNIQUE CLUSTERED INDEX IX_inact ON #inact (CategoriaNorm);


/* =====================================================================
   7) CANDIDATAS ACTIVAS.

   Para cada categoria INACTIVA se busca, dentro del MISMO catalogo
   dbo.Categorias, toda ruta con estado ACTIVE_CATEGORY que comparta una
   relacion estructural objetiva con ella. Nada mas: no se pondera, no se
   ordena por "parecido", no se elige ninguna.

   CandidateMatchReason -- solo relaciones que el repo ya define:
     SAME_NORMALIZED_PARENT  misma ruta padre (mismo modelo de ruta "/"
                             sobre el que cortan fn_CategoriaC1 /
                             fn_CategoriaC1C2). Es la mas estrecha.
     SAME_C1C2               mismo dbo.fn_CategoriaC1C2
     SAME_C1                 mismo dbo.fn_CategoriaC1. Es la mas amplia,
                             y en un C1 grande devolvera MUCHAS filas.

   Una pareja puede cumplir varias: CandidateMatchReason trae la mas
   estrecha y las banderas MismoPadre / MismoC1C2 / MismoC1 traen todas,
   para no perder informacion al deduplicar.
   ------------------------------------------------------------------ */
SELECT
    CategoriaInactivaNorm = x.CategoriaInactivaNorm,
    CandidataNorm         = x.CandidataNorm,
    CandidateMatchReason  = CASE
                                WHEN x.MismoPadre = 1 THEN 'SAME_NORMALIZED_PARENT'
                                WHEN x.MismoC1C2  = 1 THEN 'SAME_C1C2'
                                ELSE                       'SAME_C1' END,
    x.MismoPadre,
    x.MismoC1C2,
    x.MismoC1,
    CandidataC1           = x.CandidataC1,
    CandidataC1C2         = x.CandidataC1C2,
    CandidataRutaPadre    = x.CandidataRutaPadre,
    CandidataFilasCatalogo     = x.Filas,
    CandidataFilasVigActivas   = x.FilasVigActivas,
    CandidataVolumenSlotActual = x.VolumenSlotActual,
    CandidataVolumenTodoSlot   = x.VolumenTodoSlot,
    CandidataTicketsSlotActual = x.TicketsSlotActual,
    CandidataTicketsVentana    = x.TicketsVentana,
    CandidataUltimoTicket      = x.UltimoTicket
INTO #cand
FROM (
    SELECT
        CategoriaInactivaNorm = i.CategoriaNorm,
        CandidataNorm         = c.RutaNorm,
        MismoPadre = CASE WHEN i.RutaPadre IS NOT NULL AND c.RutaPadre IS NOT NULL
                           AND c.RutaPadre = i.RutaPadre THEN 1 ELSE 0 END,
        MismoC1C2  = CASE WHEN c.C1C2 = i.C1C2 THEN 1 ELSE 0 END,
        MismoC1    = CASE WHEN c.C1   = i.C1   THEN 1 ELSE 0 END,
        CandidataC1        = c.C1,
        CandidataC1C2      = c.C1C2,
        CandidataRutaPadre = c.RutaPadre,
        c.Filas,
        c.FilasVigActivas,
        VolumenSlotActual  = ISNULL(v.VolumenSlotActual, 0),
        VolumenTodoSlot    = ISNULL(v.VolumenTodoSlot, 0),
        TicketsSlotActual  = ISNULL(tk.TicketsSlotActual, 0),
        TicketsVentana     = ISNULL(tk.TicketsVentana, 0),
        UltimoTicket       = tk.UltimoTicket
    FROM #inact AS i
    INNER JOIN #cat AS c
            ON c.FilasVigentes > 0
           AND c.FilasVigActivas > 0            -- = ACTIVE_CATEGORY
           AND c.RutaNorm <> i.CategoriaNorm
           AND (   c.C1 = i.C1
                OR c.C1C2 = i.C1C2
                OR (i.RutaPadre IS NOT NULL AND c.RutaPadre = i.RutaPadre) )
    LEFT JOIN #vol   AS v  ON v.RutaNorm  = c.RutaNorm
    LEFT JOIN #tkcat AS tk ON tk.RutaNorm = c.RutaNorm
) AS x;


/* =====================================================================
   RESULTADO 1 -- CATEGORIAS INACTIVAS, EN ORDEN DE INVESTIGACION

   El ORDER BY es un orden de inspeccion determinista, no un ranking ni
   un juicio de importancia: primero lo que tiene iniciativas elegibles
   vivas, luego iniciativas activas, luego volumen reciente, luego
   historico.
   ===================================================================== */
PRINT '=== 1 CATEGORIAS INACTIVE_CATEGORY (orden de investigacion) ===';
SELECT
    i.CategoriaNorm,
    i.CategoriaStatus,
    i.CategoriaInactiva,
    i.CategoriaVigente,
    i.C1,
    i.C1C2,
    i.VolumenSlotActual,          -- volumen del slot vigente (hoy)
    i.VolumenTodoSlot,            -- volumen en todos los slots (historico)
    i.TicketsSlotActual,          -- tickets del slot vigente
    i.TicketsVentana,             -- tickets en la ventana @TkSlotMin..@TkSlotMax
    i.UltimoTicket,               -- acotado a la ventana
    i.Folios,
    i.Iniciativas,
    i.Activas,
    i.Elegibles,
    i.NoActivas,
    i.TicketsReduce,
    Candidatas = ISNULL(k.Candidatas, 0)
FROM #inact AS i
LEFT JOIN (
    SELECT CategoriaInactivaNorm, Candidatas = COUNT_BIG(*)
    FROM #cand GROUP BY CategoriaInactivaNorm
) AS k ON k.CategoriaInactivaNorm = i.CategoriaNorm
ORDER BY
    i.Elegibles DESC,
    i.Activas DESC,
    i.TicketsSlotActual DESC,
    i.VolumenSlotActual DESC,
    i.TicketsVentana DESC,
    i.VolumenTodoSlot DESC,
    i.CategoriaNorm;


/* =====================================================================
   RESULTADO 2 -- PROBLEMS / INICIATIVAS dentro de esas categorias
   Una fila por (Codigo, Categoria). No hay abanico de duenos.
   ===================================================================== */
PRINT '=== 2 PROBLEMS / INICIATIVAS EN CATEGORIAS INACTIVAS ===';
SELECT
    a.Codigo,
    a.Categoria,
    a.CategoriaNorm,
    a.C1,
    a.C1C2,
    a.Iniciativa,
    a.Titulo,
    a.Estado,
    a.TipoAgrupado,
    a.TicketsReduce,
    a.IniciativaVigente,
    a.ExperienciaActiva,
    a.ExperienciaAgrupadorValido,
    a.ExperienciaElegible,
    a.CategoriaStatus,
    a.CategoriaInactiva,
    a.CategoriaVigente,
    a.CategoriaInactivaVista,
    a.ExisteEnSlotCAT,
    a.VolumenSlotActual,
    a.VolumenTodoSlot,
    a.TicketsSlotActual,
    a.TicketsVentana,
    a.UltimoTicket,
    a.FechaCreacion,
    a.FechaCierre
FROM #audit AS a
ORDER BY
    a.ExperienciaElegible DESC,
    a.ExperienciaActiva DESC,
    a.CategoriaNorm,
    a.Codigo;


/* =====================================================================
   RESULTADO 3 -- ACTIVIDAD DE TICKETS por categoria inactiva
   Actual vs historico, separados. TicketsVentana > 0 con
   TicketsSlotActual = 0 significa "se uso, ya no".
   ===================================================================== */
PRINT '=== 3 ACTIVIDAD DE TICKETS POR CATEGORIA INACTIVA ===';
SELECT
    i.CategoriaNorm,
    i.TicketsSlotActual,
    i.TicketsVentana,
    i.UltimoTicket,
    i.VolumenSlotActual,
    i.VolumenTodoSlot,
    EvidenciaUso = CASE
        WHEN i.TicketsSlotActual > 0 THEN 'CURRENT_TICKETS'
        WHEN i.TicketsVentana    > 0 THEN 'ONLY_HISTORICAL_TICKETS'
        ELSE                              'NO_TICKETS' END,
    i.Folios,
    i.Iniciativas,
    i.Elegibles
FROM #inact AS i
ORDER BY
    i.TicketsSlotActual DESC,
    i.TicketsVentana DESC,
    i.CategoriaNorm;


/* =====================================================================
   RESULTADO 4 -- CANDIDATAS ACTIVAS por categoria inactiva
   Ninguna esta marcada como "la correcta". Si hay varias, salen todas.
   ===================================================================== */
PRINT '=== 4 CANDIDATAS ACTIVAS (evidencia estructural, sin decision) ===';
SELECT
    CategoriaInactiva = d.CategoriaInactivaNorm,
    InactivaC1        = i.C1,
    InactivaC1C2      = i.C1C2,
    InactivaTicketsSlotActual = i.TicketsSlotActual,
    InactivaTicketsVentana    = i.TicketsVentana,
    InactivaElegibles         = i.Elegibles,
    d.CandidataNorm,
    d.CandidateMatchReason,
    d.MismoPadre,
    d.MismoC1C2,
    d.MismoC1,
    d.CandidataC1,
    d.CandidataC1C2,
    d.CandidataRutaPadre,
    d.CandidataFilasVigActivas,
    d.CandidataVolumenSlotActual,
    d.CandidataVolumenTodoSlot,
    d.CandidataTicketsSlotActual,
    d.CandidataTicketsVentana,
    d.CandidataUltimoTicket
FROM #cand AS d
INNER JOIN #inact AS i ON i.CategoriaNorm = d.CategoriaInactivaNorm
ORDER BY
    i.Elegibles DESC,
    i.TicketsSlotActual DESC,
    d.CategoriaInactivaNorm,
    CASE d.CandidateMatchReason
        WHEN 'SAME_NORMALIZED_PARENT' THEN 1
        WHEN 'SAME_C1C2'              THEN 2
        ELSE 3 END,
    d.CandidataTicketsSlotActual DESC,
    d.CandidataNorm;


/* =====================================================================
   RESULTADO 5 -- RESUMEN DE LA INVESTIGACION (una fila)
   Los casos A..G van en columnas separadas a proposito. No existe un
   contador unico de "categoria mala".
   ===================================================================== */
PRINT '=== 5 RESUMEN ===';
SELECT
    SlotVigente                   = @Slot,
    VentanaSlots                  = CONVERT(VARCHAR(20), @TkSlotMin) + '..' + CONVERT(VARCHAR(20), @TkSlotMax),

    CategoriasInactivas           = (SELECT COUNT_BIG(*) FROM #inact),
    IniciativasEnInactivas        = (SELECT COUNT_BIG(*) FROM #audit),
    FoliosEnInactivas             = (SELECT COUNT(DISTINCT Codigo) FROM #audit),

    -- (A) inactiva + iniciativa activa / elegible
    CatsConIniciativasActivas     = (SELECT COUNT_BIG(*) FROM #inact WHERE Activas   > 0),
    CatsConElegibles              = (SELECT COUNT_BIG(*) FROM #inact WHERE Elegibles > 0),
    FoliosConIniciativaActiva     = (SELECT COUNT(DISTINCT Codigo) FROM #audit WHERE ExperienciaActiva   = 1),
    FoliosElegibles               = (SELECT COUNT(DISTINCT Codigo) FROM #audit WHERE ExperienciaElegible = 1),

    -- (B) inactiva + iniciativa no activa
    CatsSoloIniciativasNoActivas  = (SELECT COUNT_BIG(*) FROM #inact WHERE Activas = 0),
    FoliosNoActivos               = (SELECT COUNT(DISTINCT Codigo) FROM #audit WHERE ExperienciaActiva = 0),

    -- (C) inactiva + tickets actuales
    CatsConTicketsActuales        = (SELECT COUNT_BIG(*) FROM #inact WHERE TicketsSlotActual > 0),
    FoliosEnCatsConTicketsActuales= (SELECT COUNT(DISTINCT Codigo) FROM #audit WHERE TicketsSlotActual > 0),

    -- (D) inactiva + SOLO tickets historicos
    CatsSoloTicketsHistoricos     = (SELECT COUNT_BIG(*) FROM #inact WHERE TicketsSlotActual = 0 AND TicketsVentana > 0),
    FoliosSoloTicketsHistoricos   = (SELECT COUNT(DISTINCT Codigo) FROM #audit WHERE TicketsSlotActual = 0 AND TicketsVentana > 0),

    -- (E) inactiva + sin tickets
    CatsSinTickets                = (SELECT COUNT_BIG(*) FROM #inact WHERE TicketsVentana = 0),
    FoliosSinTickets              = (SELECT COUNT(DISTINCT Codigo) FROM #audit WHERE TicketsVentana = 0),

    -- (F) inactiva + al menos una candidata activa
    CatsConCandidata              = (SELECT COUNT_BIG(*) FROM #inact AS i
                                     WHERE EXISTS (SELECT 1 FROM #cand AS d
                                                   WHERE d.CategoriaInactivaNorm = i.CategoriaNorm)),
    FoliosConCandidata            = (SELECT COUNT(DISTINCT a.Codigo) FROM #audit AS a
                                     WHERE EXISTS (SELECT 1 FROM #cand AS d
                                                   WHERE d.CategoriaInactivaNorm = a.CategoriaNorm)),

    -- (G) inactiva + sin candidata activa
    CatsSinCandidata              = (SELECT COUNT_BIG(*) FROM #inact AS i
                                     WHERE NOT EXISTS (SELECT 1 FROM #cand AS d
                                                       WHERE d.CategoriaInactivaNorm = i.CategoriaNorm)),
    FoliosSinCandidata            = (SELECT COUNT(DISTINCT a.Codigo) FROM #audit AS a
                                     WHERE NOT EXISTS (SELECT 1 FROM #cand AS d
                                                       WHERE d.CategoriaInactivaNorm = a.CategoriaNorm)),

    ParejasCandidatas             = (SELECT COUNT_BIG(*) FROM #cand),
    ParejasMismoPadre             = (SELECT COUNT_BIG(*) FROM #cand WHERE CandidateMatchReason = 'SAME_NORMALIZED_PARENT'),
    ParejasMismoC1C2              = (SELECT COUNT_BIG(*) FROM #cand WHERE CandidateMatchReason = 'SAME_C1C2'),
    ParejasMismoC1                = (SELECT COUNT_BIG(*) FROM #cand WHERE CandidateMatchReason = 'SAME_C1');


/* =====================================================================
   RESULTADO 6 -- DETALLE DE TICKETS de categorias inactivas
   Para mirar de que van esos tickets cuando el resultado 3 marca
   CURRENT_TICKETS. Acotado por @TopeDetalle.
   ===================================================================== */
PRINT '=== 6 DETALLE DE TICKETS EN CATEGORIAS INACTIVAS (tope aplicado) ===';
SELECT TOP (@TopeDetalle)
    b.CodigoTicket,
    b.FechaRegistro,
    b.Slot,
    EsSlotActual      = CASE WHEN b.Slot = @Slot THEN 1 ELSE 0 END,
    CategoriaOriginal = t.Categoria,
    CategoriaNorm     = b.CategoriaV2 COLLATE Latin1_General_CI_AS,
    b.C1,
    b.C1C2,
    t.Titulo,
    b.Estado,
    b.Subestado,
    b.Grupo,
    b.TecnicoSegundaLinea,
    b.TipoTicket,
    b.TipoRelacion,
    b.FechaUltimaCargaDW
FROM dbo.vw_TicketsSlotsBase AS b
INNER JOIN #inact AS i
        ON i.CategoriaNorm = b.CategoriaV2 COLLATE Latin1_General_CI_AS
INNER JOIN dbo.vw_Tickets AS t
        ON t.CodigoTicket = b.CodigoTicket
WHERE b.Slot BETWEEN @TkSlotMin AND @TkSlotMax
ORDER BY b.FechaRegistro DESC;


DROP TABLE #cand;
DROP TABLE #inact;
DROP TABLE #audit;
DROP TABLE #ini;
DROP TABLE #tkcat;
DROP TABLE #vol;
DROP TABLE #cat;
