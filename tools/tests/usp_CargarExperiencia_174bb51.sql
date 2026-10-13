/* Copia EXACTA del lote de dbo.usp_CargarExperiencia del repo ETL (13_experiencia_usuario.sql,
   commit 174bb51), con su comentario. Solo para pruebas en LocalDB y como base de sql/19. */
GO

/* =====================================================================================
   4) La carga

      Las cuatro tablas en UNA transaccion: si algo falla a la mitad, no queda
      un Problem sin sus categorias ni categorias apuntando a un Problem que
      no se alcanzo a insertar.

      Orden obligado: primero Problem, luego ProblemCategoria, que tiene la
      llave foranea.

      @Simulacion = 1 reporta que haria sin escribir. Conviene la primera vez
      con un Excel nuevo, para ver cuantas filas se caerian por codigo vacio o
      por apuntar a un problem que no existe.
   ===================================================================================== */
CREATE OR ALTER PROCEDURE dbo.usp_CargarExperiencia
    @Simulacion BIT = 0
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    /* ---------- Problems, ya tipado y sin repetidos ---------- */
    IF OBJECT_ID('tempdb..#P') IS NOT NULL DROP TABLE #P;
    SELECT * INTO #P FROM (
        SELECT
            Codigo = UPPER(LTRIM(RTRIM(s.Codigo))),
            TipoPrb = NULLIF(LTRIM(RTRIM(s.TipoPrb)), N''),
            TipoIniciativa = NULLIF(LTRIM(RTRIM(s.TipoIniciativa)), N''),
            Titulo = NULLIF(LTRIM(RTRIM(s.Titulo)), N''),
            Descripcion = NULLIF(s.Descripcion, N''),
            Estado = NULLIF(LTRIM(RTRIM(s.Estado)), N''),
            Subestado = NULLIF(LTRIM(RTRIM(s.Subestado)), N''),
            Categoria = NULLIF(LTRIM(RTRIM(s.Categoria)), N''),
            OwnerServicio = NULLIF(LTRIM(RTRIM(s.OwnerServicio)), N''),
            OwnerProblem = NULLIF(LTRIM(RTRIM(s.OwnerProblem)), N''),
            Gerencia = NULLIF(LTRIM(RTRIM(s.Gerencia)), N''),
            Direccion = NULLIF(LTRIM(RTRIM(s.Direccion)), N''),
            Macroproceso = NULLIF(LTRIM(RTRIM(s.Macroproceso)), N''),
            Proceso = NULLIF(LTRIM(RTRIM(s.Proceso)), N''),
            Causa = NULLIF(LTRIM(RTRIM(s.Causa)), N''),
            Impacto = NULLIF(LTRIM(RTRIM(s.Impacto)), N''),
            Prioridad = NULLIF(LTRIM(RTRIM(s.Prioridad)), N''),
            RCA = NULLIF(LTRIM(RTRIM(s.RCA)), N''),
            CuentaConWA = NULLIF(LTRIM(RTRIM(s.CuentaConWA)), N''),
            Observaciones = NULLIF(s.Observaciones, N''),
            UltimoComentario = NULLIF(s.UltimoComentario, N''),
            HistoricoComentarios = NULLIF(s.HistoricoComentarios, N''),
            VolumetriaOriginal = dbo.fn_ExpEntero(s.VolumetriaOriginal),
            VolumenUltimoMes = dbo.fn_ExpEntero(s.VolumenUltimoMes),
            FechaCreacion = dbo.fn_ExpFecha(s.FechaCreacion),
            FechaEntregaPrb = dbo.fn_ExpFecha(s.FechaEntregaPrb),
            FechaEntregaAnalisis = dbo.fn_ExpFecha(s.FechaEntregaAnalisis),
            FechaAnalisis = dbo.fn_ExpFecha(s.FechaAnalisis),
            FechaOriginalSolucion = dbo.fn_ExpFecha(s.FechaOriginalSolucion),
            FechaSolucion = dbo.fn_ExpFecha(s.FechaSolucion),
            FechaOriginalCierre = dbo.fn_ExpFecha(s.FechaOriginalCierre),
            FechaCierre = dbo.fn_ExpFecha(s.FechaCierre),
            NroCambioFechaAnalisis = dbo.fn_ExpEntero(s.NroCambioFechaAnalisis),
            NroCambioFechaSolucion = dbo.fn_ExpEntero(s.NroCambioFechaSolucion),
            NroCambioFechaCierre = dbo.fn_ExpEntero(s.NroCambioFechaCierre),
            rn = ROW_NUMBER() OVER (PARTITION BY UPPER(LTRIM(RTRIM(s.Codigo)))
                                    ORDER BY (SELECT 1))
        FROM stg.Problems AS s
        WHERE NULLIF(LTRIM(RTRIM(s.Codigo)), N'') IS NOT NULL
    ) q WHERE rn = 1;

    /* ---------- Detalle por categoria ----------
       Los pares (Codigo, Categoria) repetidos se consolidan a uno. En el
       Excel de referencia habia nueve: cinco filas identicas y cuatro que
       solo diferian en el % de disminucion. Gana el % mas alto, que es el
       ultimo que se capturo en cada caso revisado. */
    IF OBJECT_ID('tempdb..#C') IS NOT NULL DROP TABLE #C;
    SELECT * INTO #C FROM (
        SELECT
            Codigo = UPPER(LTRIM(RTRIM(s.Codigo))),
            Categoria = LEFT(LTRIM(RTRIM(s.Categoria)), 450),
            TipoTicket = NULLIF(LTRIM(RTRIM(s.TipoTicket)), N''),
            TipoIniciativa = NULLIF(LTRIM(RTRIM(s.TipoIniciativa)), N''),
            TipoAgrupado = NULLIF(LTRIM(RTRIM(s.TipoAgrupado)), N''),
            TituloIniciativa = NULLIF(LTRIM(RTRIM(s.TituloIniciativa)), N''),
            PctDisminucion = TRY_CONVERT(DECIMAL(9,4), NULLIF(LTRIM(RTRIM(s.PctDisminucion)), N'')),
            MesReduccion = dbo.fn_ExpEntero(s.MesReduccion),
            TicketsReduce = dbo.fn_ExpEntero(s.TicketsReduce),
            DiasMesCerrado = dbo.fn_ExpEntero(s.DiasMesCerrado),
            CategoriaInactiva = dbo.fn_ExpSiNo(s.CategoriaInactiva),
            EstadoProblem = NULLIF(LTRIM(RTRIM(s.EstadoProblem)), N''),
            CierreProblem = dbo.fn_ExpFecha(s.CierreProblem),
            MejorFecha = dbo.fn_ExpFecha(s.MejorFecha),
            rn = ROW_NUMBER() OVER (
                    PARTITION BY UPPER(LTRIM(RTRIM(s.Codigo))), LEFT(LTRIM(RTRIM(s.Categoria)), 450)
                    ORDER BY TRY_CONVERT(DECIMAL(9,4), NULLIF(LTRIM(RTRIM(s.PctDisminucion)), N'')) DESC)
        FROM stg.Iniciativas AS s
        WHERE NULLIF(LTRIM(RTRIM(s.Codigo)), N'') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(s.Categoria)), N'') IS NOT NULL
    ) q WHERE rn = 1;

    /* Detalle que apunta a un codigo inexistente: no puede entrar por la
       llave foranea, y hay que verlo, no esconderlo. */
    IF OBJECT_ID('tempdb..#Huerfanas') IS NOT NULL DROP TABLE #Huerfanas;
    SELECT c.Codigo, c.Categoria
    INTO #Huerfanas
    FROM #C AS c
    WHERE NOT EXISTS (SELECT 1 FROM #P AS p WHERE p.Codigo = c.Codigo)
      AND NOT EXISTS (SELECT 1 FROM dbo.Problem AS p WHERE p.Codigo = c.Codigo);

    IF @Simulacion = 1
    BEGIN
        SELECT Bloque = 'Problems',    EnStaging = (SELECT COUNT(*) FROM stg.Problems),
               AImportar = (SELECT COUNT(*) FROM #P),
               YaEnBase  = (SELECT COUNT(*) FROM dbo.Problem)
        UNION ALL
        SELECT 'ProblemCategoria', (SELECT COUNT(*) FROM stg.Iniciativas),
               (SELECT COUNT(*) FROM #C), (SELECT COUNT(*) FROM dbo.ProblemCategoria);

        SELECT Huerfanas = COUNT(*) FROM #Huerfanas;
        SELECT TOP (20) * FROM #Huerfanas ORDER BY Codigo;

        DROP TABLE #P; DROP TABLE #C; DROP TABLE #Huerfanas;
        RETURN;
    END;

    DECLARE @insP INT = 0, @updP INT = 0, @insC INT = 0, @updC INT = 0;

    BEGIN TRAN;
        /* ---------- Problem ---------- */
        UPDATE d SET
            d.TipoPrb = t.TipoPrb, d.TipoIniciativa = t.TipoIniciativa, d.Titulo = t.Titulo,
            d.Descripcion = t.Descripcion, d.Estado = t.Estado, d.Subestado = t.Subestado,
            d.Categoria = t.Categoria, d.OwnerServicio = t.OwnerServicio,
            d.OwnerProblem = t.OwnerProblem, d.Gerencia = t.Gerencia, d.Direccion = t.Direccion,
            d.Macroproceso = t.Macroproceso, d.Proceso = t.Proceso, d.Causa = t.Causa,
            d.Impacto = t.Impacto, d.Prioridad = t.Prioridad, d.RCA = t.RCA,
            d.CuentaConWA = t.CuentaConWA, d.Observaciones = t.Observaciones,
            d.UltimoComentario = t.UltimoComentario, d.HistoricoComentarios = t.HistoricoComentarios,
            d.VolumetriaOriginal = t.VolumetriaOriginal, d.VolumenUltimoMes = t.VolumenUltimoMes,
            d.FechaCreacion = t.FechaCreacion, d.FechaEntregaPrb = t.FechaEntregaPrb,
            d.FechaEntregaAnalisis = t.FechaEntregaAnalisis, d.FechaAnalisis = t.FechaAnalisis,
            d.FechaOriginalSolucion = t.FechaOriginalSolucion, d.FechaSolucion = t.FechaSolucion,
            d.FechaOriginalCierre = t.FechaOriginalCierre, d.FechaCierre = t.FechaCierre,
            d.NroCambioFechaAnalisis = t.NroCambioFechaAnalisis,
            d.NroCambioFechaSolucion = t.NroCambioFechaSolucion,
            d.NroCambioFechaCierre = t.NroCambioFechaCierre,
            d.VigenteEnOrigen = 1, d.FechaUltimaCargaDW = SYSDATETIME()
        FROM dbo.Problem AS d INNER JOIN #P AS t ON t.Codigo = d.Codigo;
        SET @updP = @@ROWCOUNT;

        INSERT INTO dbo.Problem (Codigo, TipoPrb, TipoIniciativa, Titulo, Descripcion, Estado,
            Subestado, Categoria, OwnerServicio, OwnerProblem, Gerencia, Direccion, Macroproceso,
            Proceso, Causa, Impacto, Prioridad, RCA, CuentaConWA, Observaciones, UltimoComentario,
            HistoricoComentarios, VolumetriaOriginal, VolumenUltimoMes, FechaCreacion,
            FechaEntregaPrb, FechaEntregaAnalisis, FechaAnalisis, FechaOriginalSolucion,
            FechaSolucion, FechaOriginalCierre, FechaCierre, NroCambioFechaAnalisis,
            NroCambioFechaSolucion, NroCambioFechaCierre)
        SELECT t.Codigo, t.TipoPrb, t.TipoIniciativa, t.Titulo, t.Descripcion, t.Estado,
            t.Subestado, t.Categoria, t.OwnerServicio, t.OwnerProblem, t.Gerencia, t.Direccion,
            t.Macroproceso, t.Proceso, t.Causa, t.Impacto, t.Prioridad, t.RCA, t.CuentaConWA,
            t.Observaciones, t.UltimoComentario, t.HistoricoComentarios, t.VolumetriaOriginal,
            t.VolumenUltimoMes, t.FechaCreacion, t.FechaEntregaPrb, t.FechaEntregaAnalisis,
            t.FechaAnalisis, t.FechaOriginalSolucion, t.FechaSolucion, t.FechaOriginalCierre,
            t.FechaCierre, t.NroCambioFechaAnalisis, t.NroCambioFechaSolucion, t.NroCambioFechaCierre
        FROM #P AS t
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Problem AS d WHERE d.Codigo = t.Codigo);
        SET @insP = @@ROWCOUNT;

        UPDATE d SET d.VigenteEnOrigen = 0
        FROM dbo.Problem AS d
        WHERE NOT EXISTS (SELECT 1 FROM #P AS t WHERE t.Codigo = d.Codigo);

        /* ---------- ProblemCategoria ---------- */
        UPDATE d SET
            d.TipoTicket = t.TipoTicket, d.TipoIniciativa = t.TipoIniciativa,
            d.TipoAgrupado = t.TipoAgrupado, d.TituloIniciativa = t.TituloIniciativa,
            d.PctDisminucion = t.PctDisminucion, d.MesReduccion = t.MesReduccion,
            d.TicketsReduce = t.TicketsReduce, d.DiasMesCerrado = t.DiasMesCerrado,
            d.CategoriaInactiva = t.CategoriaInactiva, d.EstadoProblem = t.EstadoProblem,
            d.CierreProblem = t.CierreProblem, d.MejorFecha = t.MejorFecha,
            d.VigenteEnOrigen = 1, d.FechaUltimaCargaDW = SYSDATETIME()
        FROM dbo.ProblemCategoria AS d
        INNER JOIN #C AS t ON t.Codigo = d.Codigo AND t.Categoria = d.Categoria;
        SET @updC = @@ROWCOUNT;

        INSERT INTO dbo.ProblemCategoria (Codigo, Categoria, TipoTicket, TipoIniciativa,
            TipoAgrupado, TituloIniciativa, PctDisminucion, MesReduccion, TicketsReduce,
            DiasMesCerrado, CategoriaInactiva, EstadoProblem, CierreProblem, MejorFecha)
        SELECT t.Codigo, t.Categoria, t.TipoTicket, t.TipoIniciativa, t.TipoAgrupado,
            t.TituloIniciativa, t.PctDisminucion, t.MesReduccion, t.TicketsReduce,
            t.DiasMesCerrado, t.CategoriaInactiva, t.EstadoProblem, t.CierreProblem, t.MejorFecha
        FROM #C AS t
        WHERE NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS d
                          WHERE d.Codigo = t.Codigo AND d.Categoria = t.Categoria)
          AND NOT EXISTS (SELECT 1 FROM #Huerfanas AS h
                          WHERE h.Codigo = t.Codigo AND h.Categoria = t.Categoria);
        SET @insC = @@ROWCOUNT;

        UPDATE d SET d.VigenteEnOrigen = 0
        FROM dbo.ProblemCategoria AS d
        WHERE NOT EXISTS (SELECT 1 FROM #C AS t
                          WHERE t.Codigo = d.Codigo AND t.Categoria = d.Categoria);

        /* ---------- Catalogos ---------- */
        IF EXISTS (SELECT 1 FROM stg.CatPersona)
        BEGIN
            ;WITH U AS (
                SELECT Nombre = LTRIM(RTRIM(Nombre)),
                       Correo = NULLIF(LTRIM(RTRIM(Correo)), N''),
                       Rol = NULLIF(LTRIM(RTRIM(Rol)), N''),
                       ProductOwner = NULLIF(NULLIF(LTRIM(RTRIM(ProductOwner)), N''), N'NA'),
                       Manager = NULLIF(NULLIF(LTRIM(RTRIM(Manager)), N''), N'NA'),
                       Director = NULLIF(NULLIF(LTRIM(RTRIM(Director)), N''), N'NA'),
                       rn = ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(Nombre)) ORDER BY (SELECT 1))
                FROM stg.CatPersona
                WHERE NULLIF(LTRIM(RTRIM(Nombre)), N'') IS NOT NULL
            )
            MERGE dbo.CatPersona AS d
            USING (SELECT * FROM U WHERE rn = 1) AS t ON t.Nombre = d.Nombre
            WHEN MATCHED THEN UPDATE SET d.Correo = t.Correo, d.Rol = t.Rol,
                 d.ProductOwner = t.ProductOwner, d.Manager = t.Manager, d.Director = t.Director,
                 d.VigenteEnOrigen = 1, d.FechaUltimaCargaDW = SYSDATETIME()
            WHEN NOT MATCHED BY TARGET THEN
                 INSERT (Nombre, Correo, Rol, ProductOwner, Manager, Director)
                 VALUES (t.Nombre, t.Correo, t.Rol, t.ProductOwner, t.Manager, t.Director)
            WHEN NOT MATCHED BY SOURCE THEN UPDATE SET d.VigenteEnOrigen = 0;
        END;

        IF EXISTS (SELECT 1 FROM stg.CatCategoriaDueno)
        BEGIN
            ;WITH U AS (
                SELECT CategoriaN2 = LEFT(LTRIM(RTRIM(CategoriaN2)), 450),
                       ProductOwner = NULLIF(LTRIM(RTRIM(ProductOwner)), N''),
                       ServiceOwner = NULLIF(LTRIM(RTRIM(ServiceOwner)), N''),
                       DirectorPO = NULLIF(LTRIM(RTRIM(DirectorPO)), N''),
                       C1 = NULLIF(LTRIM(RTRIM(C1)), N''),
                       rn = ROW_NUMBER() OVER (PARTITION BY LEFT(LTRIM(RTRIM(CategoriaN2)), 450)
                                               ORDER BY (SELECT 1))
                FROM stg.CatCategoriaDueno
                WHERE NULLIF(LTRIM(RTRIM(CategoriaN2)), N'') IS NOT NULL
            )
            MERGE dbo.CatCategoriaDueno AS d
            USING (SELECT * FROM U WHERE rn = 1) AS t ON t.CategoriaN2 = d.CategoriaN2
            WHEN MATCHED THEN UPDATE SET d.ProductOwner = t.ProductOwner,
                 d.ServiceOwner = t.ServiceOwner, d.DirectorPO = t.DirectorPO, d.C1 = t.C1,
                 d.VigenteEnOrigen = 1, d.FechaUltimaCargaDW = SYSDATETIME()
            WHEN NOT MATCHED BY TARGET THEN
                 INSERT (CategoriaN2, ProductOwner, ServiceOwner, DirectorPO, C1)
                 VALUES (t.CategoriaN2, t.ProductOwner, t.ServiceOwner, t.DirectorPO, t.C1)
            WHEN NOT MATCHED BY SOURCE THEN UPDATE SET d.VigenteEnOrigen = 0;
        END;
    COMMIT TRAN;

    SELECT ProblemsInsertados = @insP, ProblemsActualizados = @updP,
           CategoriasInsertadas = @insC, CategoriasActualizadas = @updC,
           DetalleHuerfano = (SELECT COUNT(*) FROM #Huerfanas);

    IF EXISTS (SELECT 1 FROM #Huerfanas)
        SELECT AvisoDetalleSinProblem = Codigo, Categoria FROM #Huerfanas ORDER BY Codigo;

    DROP TABLE #P; DROP TABLE #C; DROP TABLE #Huerfanas;
END;
GO
