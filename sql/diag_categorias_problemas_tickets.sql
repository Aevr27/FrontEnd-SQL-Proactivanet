/* =====================================================================
   AUDITORIA -- Problems/Iniciativas y tickets colgados de categorias
   inactivas, no vigentes o ausentes del catalogo.
   SOLO LECTURA. Ningun INSERT/UPDATE/DELETE/MERGE/TRUNCATE, ninguna
   creacion ni alteracion de objeto permanente. Las unicas tablas que
   se materializan son temporales locales (#), hechas con SELECT INTO.

   QUE RESPONDE
   ------------
   1) Que Problems/Iniciativas siguen sentados en categorias INACTIVAS.
   2) Que iniciativas activas/elegibles estan en categorias que HOY no
      tienen ni un ticket.
   3) Que Problems/Iniciativas apuntan a categorias que YA NO EXISTEN en
      dbo.Categorias.
   4) Que tickets cuelgan de categorias inactivas / no vigentes /
      ausentes del catalogo.

   LA DISTINCION QUE NO HAY QUE MEZCLAR
   ------------------------------------
   A) "categoria inactiva / no vigente / ausente" es un hecho del
      CATALOGO dbo.Categorias (Inactiva, VigenteEnOrigen, o sin fila).
   B) "categoria sin tickets hoy" es un hecho del VOLUMEN: la categoria
      no aparece en dbo.vw_TBSlotCAT para el slot vigente.
   No estar en vw_TBSlotCAT NO significa estar inactiva: esa vista solo
   agrega tickets, asi que una categoria perfectamente activa y con una
   iniciativa viva desaparece de ella en cuanto deja de recibir tickets.
   Por eso el script trae CategoriaStatus (A) y VolumenSlotActual /
   ExisteEnSlotCAT (B) como columnas separadas, y las cuenta por
   separado en el resumen.

   NORMALIZACION -- POR QUE IMPORTA
   --------------------------------
   dbo.vw_ProblemCategoria cruza el catalogo con
       LEFT JOIN dbo.Categorias AS c ON c.RutaCompleta = pc.Categoria
   es decir, texto CRUDO contra texto CRUDO. Un espacio duro (NCHAR(160))
   o un espacio de sobra en cualquiera de los dos lados rompe ese cruce y
   la categoria "desaparece" sin estar borrada. Aqui todo se cruza por
   dbo.fn_NormalizaCategoria -- la misma funcion que define la identidad
   de una categoria en todo el tablero: [Categoria V2] de las vistas de
   volumen es exactamente eso aplicado a Tickets.Categoria, y
   ExperienciaQueries.Normaliza() es su replica en C#. MISSING_CATEGORY
   aqui significa "no existe ni despues de normalizar", no "el LIKE
   fallo".

   ELEGIBILIDAD DE EXPERIENCIA -- COPIADA DEL CODIGO, NO INVENTADA
   ---------------------------------------------------------------
   App_Code/ExperienciaQueries.cs:
     LeerIniciativas()   WHERE v.VigenteEnOrigen = 1
                         INNER JOIN dbo.Problem (implicito en la vista)
     EsActiva()          Estado en ESTADOS_ACTIVOS comparado por Clave():
                         sin acentos, sin mayusculas, sin espacios de
                         sobra  ->  aqui COLLATE ..._CI_AI + LTRIM/RTRIM
     EsAgrupador()       TipoAgrupado en AGRUPADORES comparado con
                         OrdinalIgnoreCase: sin mayusculas pero CON
                         acentos  ->  aqui COLLATE ..._CI_AS
   ESTADOS_ACTIVOS = En Analisis / En Solucion / En Monitoreo
   AGRUPADORES     = Problem / SorIA / Adopcion / Mejora
   Si esas listas cambian en el C#, hay que cambiarlas aqui tambien.

   DEDUPLICACION OBLIGATORIA
   -------------------------
   dbo.vw_ProblemCategoria abanica: su LEFT JOIN contra
   dbo.CatCategoriaDueno por C1 repite cada fila de dbo.ProblemCategoria
   tantas veces como filas tenga su C1 en ese catalogo. LeerIniciativas()
   se queda con la primera de cada (Codigo, Categoria) -- pareja unica en
   la tabla base -- y aqui se reproduce con ROW_NUMBER. Sin eso, los
   conteos salen multiplicados.
   ===================================================================== */

SET NOCOUNT ON;

/* ---------------------------------------------------------------------
   Parametros del barrido.
   @Slot        periodo "vigente" del volumen. 0 = ultimos 30 dias, que
                es con lo que abre el tablero (experiencia.js:211).
   @TkSlotMin/Max  ventana de la auditoria de tickets, en slots. 0..9
                cubre los ultimos 300 dias, que es todo lo que
                dbo.vw_TicketsSlotsBase clasifica.
   @TopeTickets tope de filas del detalle de tickets, para no volcar
                decenas de miles a SSMS. Subelo si hace falta.
   ------------------------------------------------------------------ */
DECLARE @Slot        INT = 0;
DECLARE @TkSlotMin   INT = 0;
DECLARE @TkSlotMax   INT = 9;
DECLARE @TopeTickets INT = 5000;

IF OBJECT_ID('tempdb..#cat')   IS NOT NULL DROP TABLE #cat;
IF OBJECT_ID('tempdb..#vol')   IS NOT NULL DROP TABLE #vol;
IF OBJECT_ID('tempdb..#ini')   IS NOT NULL DROP TABLE #ini;
IF OBJECT_ID('tempdb..#audit') IS NOT NULL DROP TABLE #audit;
IF OBJECT_ID('tempdb..#tk')    IS NOT NULL DROP TABLE #tk;


/* ---------------------------------------------------------------------
   1) CATALOGO DE CATEGORIAS, colapsado por ruta normalizada.

   Se agrupa porque dbo.Categorias tiene PK por Id, no por RutaCompleta:
   dos Ids distintos pueden compartir ruta (tipico cuando una categoria
   se recrea en el origen). El estado de la ruta se decide por la fila
   MAS viva que exista, en este orden:
       hay fila vigente y no inactiva   -> ACTIVE_CATEGORY
       solo filas vigentes e inactivas  -> INACTIVE_CATEGORY
       ninguna fila vigente             -> STALE_CATEGORY
   Inactiva es BIT NULL en la tabla, de ahi el ISNULL(...,0).

   La columna normalizada se fija en COLLATE Latin1_General_CI_AS, que
   es lo que hace StringComparer.OrdinalIgnoreCase en el C#: ignora
   mayusculas, NO ignora acentos. Fijarla aqui evita conflictos de
   collation en todos los JOIN de abajo.
   ------------------------------------------------------------------ */
SELECT
    RutaNorm          = x.RutaNorm,
    Filas             = COUNT_BIG(*),
    FilasVigentes     = SUM(CASE WHEN x.VigenteEnOrigen = 1 THEN 1 ELSE 0 END),
    FilasVigActivas   = SUM(CASE WHEN x.VigenteEnOrigen = 1 AND ISNULL(x.Inactiva, 0) = 0 THEN 1 ELSE 0 END),
    FilasVigInactivas = SUM(CASE WHEN x.VigenteEnOrigen = 1 AND ISNULL(x.Inactiva, 0) = 1 THEN 1 ELSE 0 END)
INTO #cat
FROM (
    SELECT
        RutaNorm = dbo.fn_NormalizaCategoria(c.RutaCompleta) COLLATE Latin1_General_CI_AS,
        c.Inactiva,
        c.VigenteEnOrigen
    FROM dbo.Categorias AS c
    WHERE c.RutaCompleta IS NOT NULL
) AS x
WHERE x.RutaNorm <> N''
GROUP BY x.RutaNorm;

-- Indice sobre la TEMPORAL LOCAL, no sobre ningun objeto permanente:
-- #cat y #vol se cruzan cuatro veces cada uno.
CREATE UNIQUE CLUSTERED INDEX IX_cat ON #cat (RutaNorm);


/* ---------------------------------------------------------------------
   2) VOLUMEN DE TICKETS POR CATEGORIA.

   [Categoria V2] ya viene de fn_NormalizaCategoria (ver
   vw_TicketsSlotsBase), pero se vuelve a normalizar porque la funcion es
   idempotente y asi la llave de cruce es identica por construccion, no
   por confianza. Se normaliza DESPUES de agregar para no pagar el UDF
   escalar por cada fila de la vista.

   VolumenSlotActual = tickets del slot @Slot (el "hoy" del tablero).
   VolumenTodoSlot   = tickets en cualquier slot: distingue "nunca tuvo
                       trafico" de "lo tuvo y se apago".
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


/* ---------------------------------------------------------------------
   3) INICIATIVAS, una fila por (Codigo, Categoria).

   Se traen TODAS -- tambien las no vigentes y las de estado cerrado --
   porque el objetivo es justamente separar "elegible" de "no elegible".
   El filtro del tablero se refleja en las banderas, no en el WHERE.
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


/* ---------------------------------------------------------------------
   4) AUDITORIA POR INICIATIVA.
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

    -- Elegibilidad, exactamente como ExperienciaQueries.cs
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

    -- (A) hecho del catalogo
    CategoriaStatus = CASE
        WHEN c.RutaNorm IS NULL      THEN 'MISSING_CATEGORY'
        WHEN c.FilasVigentes = 0     THEN 'STALE_CATEGORY'
        WHEN c.FilasVigActivas > 0   THEN 'ACTIVE_CATEGORY'
        ELSE                              'INACTIVE_CATEGORY' END,
    CategoriaInactiva = CASE
        WHEN c.RutaNorm IS NULL THEN NULL
        WHEN c.FilasVigActivas > 0 THEN 0 ELSE 1 END,
    CategoriaVigente = CASE
        WHEN c.RutaNorm IS NULL THEN NULL
        WHEN c.FilasVigentes > 0 THEN 1 ELSE 0 END,
    -- Lo que dice la vista por su cruce CRUDO. Si difiere de
    -- CategoriaInactiva, el culpable es la normalizacion.
    CategoriaInactivaVista = i.CategoriaInactivaVista,
    CruceCrudoFallo = CASE
        WHEN c.RutaNorm IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM dbo.Categorias AS cc
                         WHERE cc.RutaCompleta = i.Categoria)
        THEN 1 ELSE 0 END,

    -- (B) hecho del volumen
    ExisteEnSlotCAT     = CASE WHEN v.RutaNorm IS NULL THEN 0 ELSE 1 END,
    VolumenSlotActual   = ISNULL(v.VolumenSlotActual, 0),
    VolumenTodoSlot     = ISNULL(v.VolumenTodoSlot, 0),
    SinVolumenActual    = CASE WHEN ISNULL(v.VolumenSlotActual, 0) = 0 THEN 1 ELSE 0 END,

    i.FechaCreacion,
    i.FechaCierre
INTO #audit
FROM #ini AS i
LEFT JOIN #cat AS c ON c.RutaNorm = i.CategoriaNorm
LEFT JOIN #vol AS v ON v.RutaNorm = i.CategoriaNorm;


/* ---------------------------------------------------------------------
   5) AUDITORIA DE TICKETS de categorias problematicas.

   Fuente canonica: dbo.vw_TicketsSlotsBase (la que ya usa el tablero
   para el detalle), que expone CategoriaV2 = fn_NormalizaCategoria de
   Tickets.Categoria. dbo.vw_Tickets solo se cruza para la ruta CRUDA y
   el titulo. En este repo no existe ninguna vw_TicketsConCategoria.
   ------------------------------------------------------------------ */
SELECT TOP (@TopeTickets)
    b.CodigoTicket,
    b.FechaRegistro,
    b.Slot,
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
    CategoriaStatus = CASE
        WHEN c.FilasVigentes = 0   THEN 'STALE_CATEGORY'
        WHEN c.FilasVigActivas > 0 THEN 'ACTIVE_CATEGORY'
        ELSE                            'INACTIVE_CATEGORY' END,
    CategoriaInactiva = CASE WHEN c.FilasVigActivas > 0 THEN 0 ELSE 1 END,
    CategoriaVigente  = CASE WHEN c.FilasVigentes  > 0 THEN 1 ELSE 0 END,
    b.FechaUltimaCargaDW
INTO #tk
FROM dbo.vw_TicketsSlotsBase AS b
INNER JOIN #cat AS c
        ON c.RutaNorm = b.CategoriaV2 COLLATE Latin1_General_CI_AS
INNER JOIN dbo.vw_Tickets AS t
        ON t.CodigoTicket = b.CodigoTicket
WHERE b.Slot BETWEEN @TkSlotMin AND @TkSlotMax
  AND (c.FilasVigentes = 0 OR c.FilasVigActivas = 0)
ORDER BY b.FechaRegistro DESC;

/* Los tickets cuya ruta NO esta en el catalogo van aparte: son un
   ANTI JOIN, no se pueden sacar del SELECT de arriba. */
IF OBJECT_ID('tempdb..#tk_missing') IS NOT NULL DROP TABLE #tk_missing;
SELECT TOP (@TopeTickets)
    b.CodigoTicket,
    b.FechaRegistro,
    b.Slot,
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
    CategoriaStatus   = CONVERT(VARCHAR(20), 'MISSING_CATEGORY'),
    CategoriaInactiva = CONVERT(BIT, NULL),
    CategoriaVigente  = CONVERT(BIT, NULL),
    b.FechaUltimaCargaDW
INTO #tk_missing
FROM dbo.vw_TicketsSlotsBase AS b
INNER JOIN dbo.vw_Tickets AS t
        ON t.CodigoTicket = b.CodigoTicket
WHERE b.Slot BETWEEN @TkSlotMin AND @TkSlotMax
  AND NOT EXISTS (SELECT 1 FROM #cat AS c
                  WHERE c.RutaNorm = b.CategoriaV2 COLLATE Latin1_General_CI_AS)
ORDER BY b.FechaRegistro DESC;


/* =====================================================================
   RESULTADO 1 -- RESUMEN GENERAL (una fila)
   ===================================================================== */
PRINT '=== 1 RESUMEN GENERAL ===';
SELECT
    SlotVigente                  = @Slot,
    TotalIniciativasCategoria    = (SELECT COUNT_BIG(*) FROM #audit),
    TotalFoliosDistintos         = (SELECT COUNT(DISTINCT Codigo) FROM #audit),

    Activas                      = (SELECT COUNT_BIG(*) FROM #audit WHERE ExperienciaActiva = 1),
    Elegibles                    = (SELECT COUNT_BIG(*) FROM #audit WHERE ExperienciaElegible = 1),
    ActivasAgrupadorNoValido     = (SELECT COUNT_BIG(*) FROM #audit
                                    WHERE ExperienciaActiva = 1 AND ExperienciaAgrupadorValido = 0),
    NoActivas                    = (SELECT COUNT_BIG(*) FROM #audit WHERE ExperienciaActiva = 0),

    -- (A) catalogo
    EnCategoriaInactiva          = (SELECT COUNT_BIG(*) FROM #audit WHERE CategoriaStatus = 'INACTIVE_CATEGORY'),
    EnCategoriaNoVigente         = (SELECT COUNT_BIG(*) FROM #audit WHERE CategoriaStatus = 'STALE_CATEGORY'),
    EnCategoriaAusente           = (SELECT COUNT_BIG(*) FROM #audit WHERE CategoriaStatus = 'MISSING_CATEGORY'),
    CatsInactivasAfectadas       = (SELECT COUNT(DISTINCT CategoriaNorm) FROM #audit WHERE CategoriaStatus = 'INACTIVE_CATEGORY'),
    CatsNoVigentesAfectadas      = (SELECT COUNT(DISTINCT CategoriaNorm) FROM #audit WHERE CategoriaStatus = 'STALE_CATEGORY'),
    CatsAusentesAfectadas        = (SELECT COUNT(DISTINCT CategoriaNorm) FROM #audit WHERE CategoriaStatus = 'MISSING_CATEGORY'),

    -- (B) volumen: NO es lo mismo que (A)
    EnCategoriaSinVolumenActual  = (SELECT COUNT_BIG(*) FROM #audit WHERE SinVolumenActual = 1),
    CatsSinVolumenActual         = (SELECT COUNT(DISTINCT CategoriaNorm) FROM #audit WHERE SinVolumenActual = 1),
    -- El caso que motivo la auditoria: iniciativa VIVA y ELEGIBLE, con
    -- categoria SANA en el catalogo, pero sin un solo ticket hoy.
    ElegiblesCatSanaSinVolumen   = (SELECT COUNT_BIG(*) FROM #audit
                                    WHERE ExperienciaElegible = 1
                                      AND CategoriaStatus = 'ACTIVE_CATEGORY'
                                      AND SinVolumenActual = 1),
    CatsSanasSinVolumenConElegible = (SELECT COUNT(DISTINCT CategoriaNorm) FROM #audit
                                    WHERE ExperienciaElegible = 1
                                      AND CategoriaStatus = 'ACTIVE_CATEGORY'
                                      AND SinVolumenActual = 1),
    -- Cruce crudo roto por espacios: falsos "missing" de la vista.
    CruceCrudoRoto               = (SELECT COUNT_BIG(*) FROM #audit WHERE CruceCrudoFallo = 1),

    TicketsCatInactiva           = (SELECT COUNT_BIG(*) FROM #tk WHERE CategoriaStatus = 'INACTIVE_CATEGORY'),
    TicketsCatNoVigente          = (SELECT COUNT_BIG(*) FROM #tk WHERE CategoriaStatus = 'STALE_CATEGORY'),
    TicketsCatAusente            = (SELECT COUNT_BIG(*) FROM #tk_missing),
    TicketsTopeAplicado          = @TopeTickets;


/* =====================================================================
   RESULTADO 2 -- RESUMEN POR CATEGORIA
   Universo: categorias con al menos una iniciativa. Es la lista de
   limpieza / reasignacion.
   ===================================================================== */
PRINT '=== 2 RESUMEN POR CATEGORIA ===';
SELECT
    a.CategoriaNorm,
    a.CategoriaStatus,
    VolumenSlotActual  = MAX(a.VolumenSlotActual),
    VolumenTodoSlot    = MAX(a.VolumenTodoSlot),
    ExisteEnSlotCAT    = MAX(a.ExisteEnSlotCAT),
    Iniciativas        = COUNT_BIG(*),
    Folios             = COUNT(DISTINCT a.Codigo),
    Activas            = SUM(CONVERT(INT, a.ExperienciaActiva)),
    Elegibles          = SUM(CONVERT(INT, a.ExperienciaElegible)),
    TicketsReduce      = SUM(ISNULL(a.TicketsReduce, 0)),
    TicketsEnVentana   = ISNULL(tk.Tickets, 0)
FROM #audit AS a
LEFT JOIN (
    SELECT u.CategoriaNorm, Tickets = SUM(u.Tickets)
    FROM (
        SELECT CategoriaNorm, Tickets = COUNT_BIG(*) FROM #tk GROUP BY CategoriaNorm
        UNION ALL
        SELECT CategoriaNorm, Tickets = COUNT_BIG(*) FROM #tk_missing GROUP BY CategoriaNorm
    ) AS u
    GROUP BY u.CategoriaNorm
) AS tk ON tk.CategoriaNorm = a.CategoriaNorm
GROUP BY a.CategoriaNorm, a.CategoriaStatus, tk.Tickets
ORDER BY
    CASE a.CategoriaStatus
        WHEN 'MISSING_CATEGORY'  THEN 1
        WHEN 'INACTIVE_CATEGORY' THEN 2
        WHEN 'STALE_CATEGORY'    THEN 3
        ELSE 4 END,
    Elegibles DESC,
    Iniciativas DESC;


/* =====================================================================
   RESULTADO 3 -- "Que Problems/Iniciativas siguen en categorias
   INACTIVAS, NO VIGENTES o AUSENTES del catalogo"
   ===================================================================== */
PRINT '=== 3 INICIATIVAS EN CATEGORIAS INACTIVAS / NO VIGENTES / AUSENTES ===';
SELECT
    a.Codigo, a.Categoria, a.CategoriaNorm, a.C1, a.C1C2,
    a.Iniciativa, a.Titulo, a.Estado, a.TipoAgrupado, a.TicketsReduce,
    a.IniciativaVigente,
    a.ExperienciaActiva, a.ExperienciaAgrupadorValido, a.ExperienciaElegible,
    a.CategoriaStatus, a.CategoriaInactiva, a.CategoriaVigente,
    a.CategoriaInactivaVista, a.CruceCrudoFallo,
    a.ExisteEnSlotCAT, a.VolumenSlotActual, a.VolumenTodoSlot,
    a.FechaCreacion, a.FechaCierre
FROM #audit AS a
WHERE a.CategoriaStatus <> 'ACTIVE_CATEGORY'
ORDER BY
    CASE a.CategoriaStatus
        WHEN 'MISSING_CATEGORY'  THEN 1
        WHEN 'INACTIVE_CATEGORY' THEN 2
        ELSE 3 END,
    a.ExperienciaElegible DESC,
    a.CategoriaNorm,
    a.Codigo;


/* =====================================================================
   RESULTADO 4 -- "Que iniciativas activas/elegibles estan en categorias
   que HOY no tienen tickets"
   Ojo: la categoria aqui puede estar PERFECTAMENTE SANA. Esto es el
   caso (B)/(D), no el (A). La columna CategoriaStatus lo dice.
   ===================================================================== */
PRINT '=== 4 ELEGIBLES EN CATEGORIAS SIN VOLUMEN EN EL SLOT VIGENTE ===';
SELECT
    a.Codigo, a.Categoria, a.CategoriaNorm, a.C1, a.C1C2,
    a.Iniciativa, a.Titulo, a.Estado, a.TipoAgrupado, a.TicketsReduce,
    a.CategoriaStatus, a.CategoriaInactiva, a.CategoriaVigente,
    a.ExisteEnSlotCAT, a.VolumenSlotActual, a.VolumenTodoSlot,
    NuncaTuvoTickets = CASE WHEN a.VolumenTodoSlot = 0 THEN 1 ELSE 0 END,
    a.FechaCreacion
FROM #audit AS a
WHERE a.ExperienciaElegible = 1
  AND a.SinVolumenActual = 1
ORDER BY a.CategoriaStatus, a.CategoriaNorm, a.Codigo;


/* =====================================================================
   RESULTADO 5 -- TICKETS en categorias inactivas / no vigentes
   ===================================================================== */
PRINT '=== 5 TICKETS EN CATEGORIAS INACTIVAS O NO VIGENTES ===';
SELECT * FROM #tk ORDER BY CategoriaStatus, CategoriaNorm, FechaRegistro DESC;


/* =====================================================================
   RESULTADO 6 -- TICKETS cuya categoria no existe en el catalogo
   ===================================================================== */
PRINT '=== 6 TICKETS EN CATEGORIAS AUSENTES DEL CATALOGO ===';
SELECT * FROM #tk_missing ORDER BY CategoriaNorm, FechaRegistro DESC;


/* =====================================================================
   RESULTADO 7 -- CONTROL: categorias donde el cruce CRUDO de
   dbo.vw_ProblemCategoria falla pero el normalizado si pega.
   Son los falsos "categoria perdida". Si esta lista sale vacia, el
   problema NO es de espacios.
   ===================================================================== */
PRINT '=== 7 FALSOS MISSING: el cruce crudo falla, el normalizado pega ===';
SELECT DISTINCT
    a.Categoria,
    a.CategoriaNorm,
    a.CategoriaStatus,
    LargoCrudo = LEN(a.Categoria + N'|') - 1,
    LargoNorm  = LEN(a.CategoriaNorm + N'|') - 1,
    TieneNBSP  = CASE WHEN CHARINDEX(NCHAR(160), a.Categoria) > 0 THEN 1 ELSE 0 END
FROM #audit AS a
WHERE a.CruceCrudoFallo = 1
ORDER BY a.CategoriaNorm;


DROP TABLE #tk_missing;
DROP TABLE #tk;
DROP TABLE #audit;
DROP TABLE #ini;
DROP TABLE #vol;
DROP TABLE #cat;
