/* =========================================================================
   sql/21_gestion_admin_agrupacion_acentos_rollback.sql - Deshace sql/21:
   deja RevisarTope y Modificar exactamente como en sql/18 y Crear como en
   sql/20 (la Agrupacion vuelve a compararse sensible a acentos).
   Misma guarda de aprobacion (aprobar_migracion = 21 o base
   GestionAdminPrueba_*). Una sola transaccion. 0 datos.

   PRECONDICION (si no, ROLLBACK y no toca nada): los tres con el hash de
     sql/21 (ver sql/21). Si ya tienen el de sql/18 / sql/20, no hay nada
     que deshacer; cualquier mezcla u otro texto se rechaza.
   POSTCONDICION (si no, ROLLBACK): RevisarTope 0x5C43DEBA819BA2D1AC3C13E1A32E409EC5BE1729BE9991DB5D73B64C48C43898
     Crear 0x77292B7976EAF0670BE8961824D212EEEFB218343A816CE83BB6F3FE8934C297, Modificar 0x9D98582F2D08B1599CADFDE7BEB0C86168483E311758E6F9FA3B317AD529293E.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'21'
BEGIN
    RAISERROR (N'Rollback 21 SIN APROBAR: declara aprobar_migracion = 21 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID('tempdb..#h21') IS NOT NULL DROP TABLE #h21;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #h21
FROM (VALUES (N'adm.usp_GestionAdmin_RevisarTope', 0x8F654F5AD01FD49C974F2CD707DA696FCC7F04067F213CB0E1E8C37C2FB4DFB7, 0x5C43DEBA819BA2D1AC3C13E1A32E409EC5BE1729BE9991DB5D73B64C48C43898),
             (N'adm.usp_GestionAdmin_Crear',       0x540F83EF4AF3AB4A3D3E2E8E7B6D4DE75B7731E98085DAD11CF54B14A4478D79, 0x77292B7976EAF0670BE8961824D212EEEFB218343A816CE83BB6F3FE8934C297),
             (N'adm.usp_GestionAdmin_Modificar',   0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3, 0x9D98582F2D08B1599CADFDE7BEB0C86168483E311758E6F9FA3B317AD529293E)) AS v (Objeto, Antes, Despues);
DECLARE @mal nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                              FROM #h21 WHERE Hash IS NULL OR Hash <> Antes ORDER BY Objeto);
-- Antes del ROLLBACK: #h21 se crea dentro de la transaccion.
DECLARE @ya bit = CASE WHEN EXISTS (SELECT 1 FROM #h21 WHERE Hash IS NULL OR Hash <> Despues) THEN 0 ELSE 1 END;
IF @mal IS NOT NULL
BEGIN
    ROLLBACK;
    IF @ya = 1
        RAISERROR (N'Rollback 21: sql/21 no aplicada (los tres ya son los de sql/18 / sql/20). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 21: %s no es la esperada. No se toca nada.', 16, 1, @mal);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 21: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* @Revisar: SOLO las filas que van a consumir y hay que revisar (Pct = el
   valor nuevo). Toma un candado exclusivo por ruta y luego suma lo que
   consumen las DEMAS iniciativas; los candados duran hasta el COMMIT o
   ROLLBACK del que llama. */
ALTER PROCEDURE adm.usp_GestionAdmin_RevisarTope
    @Codigo  nvarchar(100),                 -- quien escribe: no cuenta contra si mismo
    @Revisar adm.CategoriaPctTipo READONLY
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT = 0 THROW 51030, N'adm.usp_GestionAdmin_RevisarTope debe correr dentro de una transaccion.', 1;

    -- Candado por ruta normalizada (DirectorioOrganizacional.Normaliza: NBSP
    -- -> espacio, sin espacios en las puntas, sin distinguir mayusculas), en
    -- orden fijo para no cruzarse en un deadlock.
    DECLARE @recurso nvarchar(255), @rc int;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT N'adm.capacidad:' + CONVERT(nvarchar(64),
               HASHBYTES('SHA2_256', UPPER(LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' '))))), 2)
        FROM @Revisar AS r
        ORDER BY 1;
    OPEN c;
    FETCH NEXT FROM c INTO @recurso;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC @rc = sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive',
                                 @LockOwner = 'Transaction', @LockTimeout = 15000;
        IF @rc < 0 THROW 51031, N'No se pudo reservar la categoria para revisar su capacidad (tiempo agotado).', 1;
        FETCH NEXT FROM c INTO @recurso;
    END;
    CLOSE c; DEALLOCATE c;

    -- Consumo = ExperienciaQueries.ConsumeCapacidad (vigente en origen,
    -- Estado vivo CI_AI, TipoAgrupado de AGRUPADORES) MAS las filas vivas SIN
    -- agrupacion (NULL o vacia), que se cuentan como si consumieran: el tope
    -- nunca se pasa por un dato que falta. Es mas estricto que el tablero
    -- (que no las suma); ver CUTOVER (decision pendiente de igualarlos).
    DECLARE @msg nvarchar(2048);
    SELECT TOP (1) @msg = r.Categoria + N': solo tiene ' +
           CONVERT(nvarchar(20), CONVERT(decimal(9,2), 100 * CASE WHEN u.Usado >= 1 THEN 0 ELSE 1 - u.Usado END)) +
           N'% disponible sin contar esta iniciativa (tope 100% por categoria).'
    FROM @Revisar AS r
    CROSS APPLY (
        SELECT Usado = ISNULL(SUM(pc.PctDisminucion), 0)
        FROM dbo.ProblemCategoria AS pc
        INNER JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
        WHERE pc.VigenteEnOrigen = 1
          AND p.VigenteEnOrigen = 1
          AND pc.Codigo <> @Codigo
          AND LTRIM(RTRIM(REPLACE(pc.Categoria, NCHAR(160), N' ')))
              = LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' ')))
          AND LTRIM(RTRIM(p.Estado)) COLLATE Latin1_General_CI_AI
              IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
          AND (NULLIF(LTRIM(RTRIM(pc.TipoAgrupado)), N'') IS NULL
               OR LTRIM(RTRIM(pc.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
    ) AS u
    WHERE r.Pct IS NOT NULL
      AND r.Pct > CASE WHEN u.Usado >= 1 THEN 0 ELSE 1 - u.Usado END
    ORDER BY r.Categoria;
    IF @msg IS NOT NULL THROW 51010, @msg, 1;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 21: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER PROCEDURE adm.usp_GestionAdmin_Crear
    @Usuario              nvarchar(256),
    @Prefijo              nvarchar(10),
    @TipoIniciativa       nvarchar(100),
    @TipoAgrupado         nvarchar(100),
    @Estado               nvarchar(100),
    @Titulo               nvarchar(max),
    @Descripcion          nvarchar(max),
    @Observaciones        nvarchar(max),
    @FechaEntregaAnalisis date = NULL,          -- NULL = hoy
    @Categorias           adm.CategoriaPctTipo READONLY,
    @Hoy                  date = NULL,          -- NULL = hoy en Mexico (UTC-6)
    -- sql/20: PO / SO del alta, opcionales (NULL = sin elegir). Al final
    -- y con default: un llamador que no los manda sigue funcionando.
    @OwnerProblem         nvarchar(4000) = NULL, -- Product Owner (columna: 255)
    @OwnerServicio        nvarchar(4000) = NULL, -- Service Owner (columna: 255)
    @Codigo               nvarchar(100) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Codigo = NULL;
    SET @Prefijo = UPPER(LTRIM(RTRIM(@Prefijo)));
    SET @TipoIniciativa = NULLIF(LTRIM(RTRIM(@TipoIniciativa)), N'');
    SET @TipoAgrupado = NULLIF(LTRIM(RTRIM(@TipoAgrupado)), N'');
    SET @Estado = NULLIF(LTRIM(RTRIM(@Estado)), N'');
    SET @OwnerProblem = NULLIF(LTRIM(RTRIM(@OwnerProblem)), N'');
    SET @OwnerServicio = NULLIF(LTRIM(RTRIM(@OwnerServicio)), N'');

    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.CatPrefijoProblem WHERE Prefijo = @Prefijo)
        THROW 51002, N'El prefijo no esta en dbo.CatPrefijoProblem.', 1;
    -- dbo.Problem.Prefijo es UPPER(LEFT(Codigo, 3)): un prefijo del catalogo
    -- que no sea de tres letras no puede formar un Codigo valido.
    IF @Prefijo COLLATE Latin1_General_BIN NOT LIKE N'[A-Z][A-Z][A-Z]'
        THROW 51021, N'Prefijo invalido para un Codigo: se esperan tres letras (PPP AAAA-NNNNNN).', 1;
    -- Opcionales: si no vienen, NULL (la iniciativa queda incompleta).
    IF @TipoIniciativa IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(TipoIniciativa)) = @TipoIniciativa)
        THROW 51011, N'Tipo de iniciativa que no existe en dbo.Problem.', 1;
    IF @TipoAgrupado IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria WHERE LTRIM(RTRIM(TipoAgrupado)) = @TipoAgrupado)
        THROW 51012, N'Agrupacion (TipoAgrupado) que no existe en dbo.ProblemCategoria.', 1;
    IF @Estado IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = @Estado)
        THROW 51013, N'Estado inicial que no existe en dbo.Problem.', 1;
    -- PO / SO: que sean del catalogo lo revisa la aplicacion (la misma
    -- resolucion de duenos que el resto del sitio); aqui solo el largo, para
    -- no truncar en silencio.
    IF LEN(@OwnerProblem) > 255 OR LEN(@OwnerServicio) > 255
        THROW 51027, N'Product Owner o Service Owner de mas de 255 caracteres.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias
               GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE NULLIF(LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Pct < 0 OR Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias AS c
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;

    DECLARE @hoyMx date = COALESCE(@Hoy, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @analisis date = DATEADD(DAY, 15, @hoyMx);   -- 15 dias naturales
    DECLARE @anio char(4) = CONVERT(char(4), YEAR(@hoyMx));
    DECLARE @entrega date = COALESCE(@FechaEntregaAnalisis, @hoyMx);
    DECLARE @vivo bit = CASE WHEN @Estado COLLATE Latin1_General_CI_AI
                                  IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
    -- Sin agrupacion: se revisa como si consumiera (no se salta el tope).
    DECLARE @consume bit = CASE WHEN @vivo = 1 AND (@TipoAgrupado IS NULL OR @TipoAgrupado IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                                THEN 1 ELSE 0 END;
    DECLARE @nuevo nvarchar(100), @rc int, @max int, @raro nvarchar(100);

    BEGIN TRY
        BEGIN TRAN;
            -- Primero que cualquier otro candado: el cargador del Excel
            -- (ADM_04) lo toma en Exclusive; si esta corriendo, se espera.
            EXEC @rc = sp_getapplock @Resource = N'adm.proteccion', @LockMode = 'Shared',
                                     @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rc < 0 THROW 51026, N'La carga del Excel esta corriendo y no termino a tiempo. Intenta de nuevo.', 1;

            -- Tope: solo si las filas van a consumir.
            IF @consume = 1
            BEGIN
                DECLARE @revisar adm.CategoriaPctTipo;
                INSERT @revisar (Categoria, Pct)
                SELECT c.Categoria, c.Pct FROM @Categorias AS c WHERE c.Pct > 0;
                EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = N'', @Revisar = @revisar;
            END;

            -- Codigo: un solo emisor por (prefijo, anio) a la vez; el candado
            -- dura hasta el COMMIT, asi que el siguiente ya ve este Codigo.
            DECLARE @recurso nvarchar(255) = N'adm.codigo:' + @Prefijo + N':' + @anio;
            EXEC @rc = sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive',
                                     @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rc < 0 THROW 51025, N'No se pudo reservar el siguiente Codigo (tiempo agotado). Intenta de nuevo.', 1;

            -- Todos los codigos de ese prefijo y anio, activos o no, bien o
            -- mal formados ('PRB-2026-185', 'PRB 2026-00185 '...): quitando
            -- espacios, guiones y NBSP queda 'PRB2026' + numero.
            DECLARE @raiz nvarchar(20) = @Prefijo + @anio;
            SELECT @max = MAX(n.Numero),
                   @raro = MIN(CASE WHEN n.Numero IS NULL THEN p.Codigo END)
            FROM dbo.Problem AS p
            CROSS APPLY (SELECT Plano = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.Codigo)),
                                N' ', N''), N'-', N''), NCHAR(160), N''), NCHAR(9), N''))) AS x
            CROSS APPLY (SELECT Resto = SUBSTRING(x.Plano, LEN(@raiz) + 1, 100)) AS r
            CROSS APPLY (SELECT Numero = CASE WHEN r.Resto <> N'' AND r.Resto NOT LIKE N'%[^0-9]%' AND LEN(r.Resto) <= 9
                                              THEN CONVERT(int, r.Resto) END) AS n
            WHERE LEFT(x.Plano, LEN(@raiz)) = @raiz;
            IF @raro IS NOT NULL
            BEGIN
                DECLARE @msgRaro nvarchar(400) = N'Hay un Codigo de ' + @Prefijo + N' ' + @anio +
                    N' cuyo numero no se puede leer: ''' + @raro + N'''. Corrigelo antes de emitir otro (no se adivina).';
                THROW 51023, @msgRaro, 1;
            END;
            IF ISNULL(@max, 0) >= 999999
                THROW 51022, N'Se agotaron los consecutivos de ese prefijo y anio (999999).', 1;
            SET @nuevo = @Prefijo + N' ' + @anio + N'-' + RIGHT(N'000000' + CONVERT(nvarchar(6), ISNULL(@max, 0) + 1), 6);
            IF EXISTS (SELECT 1 FROM dbo.Problem WHERE Codigo = @nuevo)
                THROW 51024, N'El Codigo calculado ya existe: no se emite.', 1;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;

            -- Direccion y demas columnas del Excel: NULL (opcionales,
            -- decision 2026-10-13). OwnerProblem / OwnerServicio = PO / SO
            -- del alta o NULL (sql/20). VigenteEnOrigen = 1 para los filtros.
            INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Descripcion, Observaciones, Estado,
                                OwnerProblem, OwnerServicio,
                                FechaCreacion, FechaEntregaAnalisis, FechaAnalisis,
                                NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre,
                                VigenteEnOrigen)
            VALUES (@nuevo, @TipoIniciativa, @Titulo, @Descripcion, @Observaciones, @Estado,
                    @OwnerProblem, @OwnerServicio,
                    @hoyMx, @entrega, @analisis, 0, 0, 0, 1);

            -- Iniciales: sin fechas propias (NULL) = heredan las de la iniciativa.
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen)
            SELECT @nuevo, LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' '))), @TipoIniciativa, @TipoAgrupado, c.Pct, 1
            FROM @Categorias AS c;

            EXEC adm.usp_GestionAdmin_TicketsReduce @Codigo = @nuevo, @Categorias = @Categorias;

            -- En la misma transaccion: un alta guardada nunca queda sin proteger.
            INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario) VALUES (@nuevo, 'ALTA', @Usuario);

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        COMMIT;
        SET @Codigo = @nuevo;   -- solo despues del COMMIT
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        SET @Codigo = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 21: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Solo lo que trae su bandera Cambia*. No hay parametro para Codigo ni para
   FechaCreacion: no cambian.
   @Pcts      ligadas vigentes: Pct = el valor final; TipoIniciativa /
              TipoAgrupado NULL = no cambian (con valor, se declaran).
   @Agregar   se ligan ahora: Tipo* obligatorios; fechas PROPIAS = hoy y
              hoy + 15.
   @FechasCategoria  nueva fecha de analisis de una ligada. Si la categoria
              hereda (inicial, sin fecha propia), el cambio va a la fecha de
              la INICIATIVA (FechaAnalisis), no a una fecha propia. */
ALTER PROCEDURE adm.usp_GestionAdmin_Modificar
    @Usuario             nvarchar(256),
    @Codigo              nvarchar(100),
    @CambiaTitulo        bit = 0, @Titulo        nvarchar(max) = NULL,
    @CambiaDescripcion   bit = 0, @Descripcion   nvarchar(max) = NULL,
    @CambiaObservaciones bit = 0, @Observaciones nvarchar(max) = NULL,
    @CambiaEstado        bit = 0, @Estado        nvarchar(100) = NULL,
    @CambiaSubestado     bit = 0, @Subestado     nvarchar(100) = NULL,
    @CambiaFAnalisis     bit = 0, @FAnalisis     date = NULL,
    @CambiaFSolucion     bit = 0, @FSolucion     date = NULL,
    @CambiaFCierre       bit = 0, @FCierre       date = NULL,
    @Pcts                adm.CategoriaPctTipo READONLY,
    @Agregar             adm.CategoriaPctTipo READONLY,
    @FechasCategoria     adm.CategoriaFechaTipo READONLY,
    @Hoy                 date = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar) AS x
               GROUP BY LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
       OR EXISTS (SELECT 1 FROM @FechasCategoria
                  GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar
                              UNION ALL SELECT Categoria FROM @FechasCategoria) AS x
               WHERE NULLIF(LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Pct FROM @Pcts UNION ALL SELECT Pct FROM @Agregar) AS x WHERE x.Pct < 0 OR x.Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT TipoIniciativa FROM @Agregar UNION ALL SELECT TipoIniciativa FROM @Pcts) AS x
                  WHERE NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N'') IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM dbo.Problem AS p WHERE LTRIM(RTRIM(p.TipoIniciativa)) = LTRIM(RTRIM(x.TipoIniciativa))))
        THROW 51011, N'Tipo de iniciativa de una categoria que no existe en dbo.Problem.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT TipoAgrupado FROM @Agregar UNION ALL SELECT TipoAgrupado FROM @Pcts) AS x
                  WHERE NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N'') IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc WHERE LTRIM(RTRIM(pc.TipoAgrupado)) = LTRIM(RTRIM(x.TipoAgrupado))))
        THROW 51012, N'Agrupacion (TipoAgrupado) de una categoria que no existe en dbo.ProblemCategoria.', 1;
    IF @CambiaEstado = 1
       AND (NULLIF(LTRIM(RTRIM(@Estado)), N'') IS NULL
            OR NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = LTRIM(RTRIM(@Estado))))
        THROW 51013, N'El Estado no es uno de los que ya existen en dbo.Problem.', 1;
    IF EXISTS (SELECT 1 FROM @FechasCategoria WHERE FechaAnalisis IS NULL)
        THROW 51017, N'La fecha de analisis de una categoria no se puede vaciar.', 1;
    IF EXISTS (SELECT 1 FROM @Agregar AS c
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;
    IF @CambiaEstado = 1 SET @Estado = LTRIM(RTRIM(@Estado));

    DECLARE @hoyMx date = COALESCE(@Hoy, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));

    BEGIN TRY
        BEGIN TRAN;
            -- Igual que en Crear: antes de bloquear filas de dbo.Problem.
            DECLARE @rcProt int;
            EXEC @rcProt = sp_getapplock @Resource = N'adm.proteccion', @LockMode = 'Shared',
                                         @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rcProt < 0 THROW 51026, N'La carga del Excel esta corriendo y no termino a tiempo. Intenta de nuevo.', 1;

            DECLARE @estadoAntes nvarchar(100), @estadoFinal nvarchar(100);
            SELECT @estadoAntes = p.Estado,
                   @estadoFinal = CASE WHEN @CambiaEstado = 1 THEN @Estado ELSE p.Estado END
            FROM dbo.Problem AS p WITH (UPDLOCK, HOLDLOCK)
            WHERE p.Codigo = @Codigo;
            IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;

            IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @FechasCategoria) AS x
                       WHERE NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                                         WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1
                                           AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))))
                THROW 51007, N'Un cambio es de una categoria que no esta ligada (vigente) a esta iniciativa.', 1;
            IF EXISTS (SELECT 1 FROM @Agregar AS x
                       INNER JOIN dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))))
                THROW 51008, N'La categoria ya esta ligada a esta iniciativa (o lo estuvo y se dio de baja).', 1;

            -- Fecha de una categoria que HEREDA = fecha de la iniciativa.
            DECLARE @heredadas int, @fHeredada date;
            SELECT @heredadas = COUNT(DISTINCT f.FechaAnalisis), @fHeredada = MIN(f.FechaAnalisis)
            FROM @FechasCategoria AS f
            INNER JOIN dbo.ProblemCategoria AS pc
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(f.Categoria, NCHAR(160), N' ')))
            WHERE pc.FechaAnalisisCategoria IS NULL;
            IF @heredadas > 1 OR (@heredadas = 1 AND @CambiaFAnalisis = 1 AND ISNULL(@FAnalisis, '19000101') <> @fHeredada)
                THROW 51016, N'Las categorias que heredan la fecha de la iniciativa comparten UNA fecha de analisis: llegaron dos distintas.', 1;
            IF @heredadas = 1 SELECT @CambiaFAnalisis = 1, @FAnalisis = @fHeredada;

            -- Como queda cada categoria vigente (+ las que se ligan).
            DECLARE @final TABLE (Categoria nvarchar(450) PRIMARY KEY, PctAntes decimal(9,4), PctDespues decimal(9,4),
                                  AgrupAntes nvarchar(100), AgrupDespues nvarchar(100), Nueva bit);
            INSERT @final (Categoria, PctAntes, PctDespues, AgrupAntes, AgrupDespues, Nueva)
            SELECT pc.Categoria, pc.PctDisminucion,
                   CASE WHEN x.Categoria IS NULL THEN pc.PctDisminucion ELSE x.Pct END,
                   pc.TipoAgrupado,
                   COALESCE(NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), pc.TipoAgrupado), 0
            FROM dbo.ProblemCategoria AS pc
            LEFT JOIN @Pcts AS x ON pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
            WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1;
            INSERT @final (Categoria, PctAntes, PctDespues, AgrupAntes, AgrupDespues, Nueva)
            SELECT LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), NULL, x.Pct, NULL, NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), 1
            FROM @Agregar AS x;

            DECLARE @vivoAntes bit = CASE WHEN LTRIM(RTRIM(@estadoAntes)) COLLATE Latin1_General_CI_AI
                                               IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
            DECLARE @vivoFinal bit = CASE WHEN LTRIM(RTRIM(@estadoFinal)) COLLATE Latin1_General_CI_AI
                                               IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
            DECLARE @tocaCapacidad bit = CASE WHEN @CambiaEstado = 1 OR EXISTS (SELECT 1 FROM @Pcts)
                                                   OR EXISTS (SELECT 1 FROM @Agregar) THEN 1 ELSE 0 END;

            IF @tocaCapacidad = 1 AND @vivoFinal = 1
            BEGIN
                -- Una fila sin agrupacion se revisa como si consumiera
                -- (conservador): no se salta el tope por falta del dato.
                DECLARE @revisar adm.CategoriaPctTipo;
                INSERT @revisar (Categoria, Pct)
                SELECT f.Categoria, f.PctDespues
                FROM @final AS f
                WHERE (NULLIF(LTRIM(RTRIM(f.AgrupDespues)), N'') IS NULL OR LTRIM(RTRIM(f.AgrupDespues)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                  AND ISNULL(f.PctDespues, 0) > 0
                  AND (f.Nueva = 1
                       OR ISNULL(f.PctDespues, 0) > ISNULL(f.PctAntes, 0)
                       OR NOT (@vivoAntes = 1 AND (NULLIF(LTRIM(RTRIM(f.AgrupAntes)), N'') IS NULL
                                                   OR LTRIM(RTRIM(f.AgrupAntes)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))));
                IF EXISTS (SELECT 1 FROM @revisar)
                    EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = @Codigo, @Revisar = @revisar;
            END;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;

            -- Lo editable como estaba (filas ya bloqueadas arriba): al final, solo
            -- si algo de esto cambio se protege la iniciativa. Textos en binario:
            -- un cambio de mayusculas o de espacios tambien es un cambio.
            SELECT Titulo = CONVERT(varbinary(max), Titulo), Descripcion = CONVERT(varbinary(max), Descripcion),
                   Observaciones = CONVERT(varbinary(max), Observaciones), Estado = CONVERT(varbinary(max), Estado),
                   Subestado = CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre
            INTO #antesP FROM dbo.Problem WHERE Codigo = @Codigo;
            SELECT Categoria = CONVERT(varbinary(max), Categoria), PctDisminucion,
                   TipoIniciativa = CONVERT(varbinary(max), TipoIniciativa), TipoAgrupado = CONVERT(varbinary(max), TipoAgrupado),
                   FechaAnalisisCategoria, VigenteEnOrigen
            INTO #antesC FROM dbo.ProblemCategoria WHERE Codigo = @Codigo;

            DECLARE @ultimoEvento int = (SELECT ISNULL(MAX(IdEvento), 0) FROM dbo.ProblemFechaEvento);

            UPDATE dbo.Problem SET
                Titulo        = CASE WHEN @CambiaTitulo = 1        THEN @Titulo        ELSE Titulo END,
                Descripcion   = CASE WHEN @CambiaDescripcion = 1   THEN @Descripcion   ELSE Descripcion END,
                Observaciones = CASE WHEN @CambiaObservaciones = 1 THEN @Observaciones ELSE Observaciones END,
                Estado        = CASE WHEN @CambiaEstado = 1        THEN @Estado        ELSE Estado END,
                Subestado     = CASE WHEN @CambiaSubestado = 1     THEN @Subestado     ELSE Subestado END,
                FechaAnalisis = CASE WHEN @CambiaFAnalisis = 1     THEN @FAnalisis     ELSE FechaAnalisis END,
                FechaSolucion = CASE WHEN @CambiaFSolucion = 1     THEN @FSolucion     ELSE FechaSolucion END,
                FechaCierre   = CASE WHEN @CambiaFCierre = 1       THEN @FCierre       ELSE FechaCierre END
            WHERE Codigo = @Codigo
              AND (@CambiaTitulo | @CambiaDescripcion | @CambiaObservaciones | @CambiaEstado |
                   @CambiaSubestado | @CambiaFAnalisis | @CambiaFSolucion | @CambiaFCierre) = 1;

            -- NroCambioFecha*: los cambios que cuentan de lo que el trigger
            -- acaba de escribir para esta iniciativa (la fila de dbo.Problem
            -- esta bloqueada: nadie mas escribe sus eventos ahora).
            DECLARE @nA int, @nS int, @nC int;
            SELECT @nA = SUM(CASE WHEN e.Campo = 'FechaAnalisis' THEN 1 ELSE 0 END),
                   @nS = SUM(CASE WHEN e.Campo = 'FechaSolucion' THEN 1 ELSE 0 END),
                   @nC = SUM(CASE WHEN e.Campo = 'FechaCierre' AND e.FechaNueva > e.FechaAnterior THEN 1 ELSE 0 END)
            FROM dbo.ProblemFechaEvento AS e
            WHERE e.IdEvento > @ultimoEvento AND e.Codigo = @Codigo AND e.Categoria IS NULL
              AND e.Operacion = 'U' AND e.FechaAnterior IS NOT NULL AND e.FechaNueva IS NOT NULL;
            IF ISNULL(@nA, 0) + ISNULL(@nS, 0) + ISNULL(@nC, 0) > 0
                UPDATE dbo.Problem SET
                    NroCambioFechaAnalisis = ISNULL(NroCambioFechaAnalisis, 0) + ISNULL(@nA, 0),
                    NroCambioFechaSolucion = ISNULL(NroCambioFechaSolucion, 0) + ISNULL(@nS, 0),
                    NroCambioFechaCierre   = ISNULL(NroCambioFechaCierre, 0)   + ISNULL(@nC, 0)
                WHERE Codigo = @Codigo;

            UPDATE pc SET
                pc.PctDisminucion = x.Pct,
                pc.TipoIniciativa = COALESCE(NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''), pc.TipoIniciativa),
                pc.TipoAgrupado   = COALESCE(NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), pc.TipoAgrupado)
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @Pcts AS x
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')));

            -- Fecha propia de una ligada: solo las que YA tienen fecha propia
            -- (las que heredan se movieron arriba, en la de la iniciativa).
            UPDATE pc SET pc.FechaAnalisisCategoria = f.FechaAnalisis
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @FechasCategoria AS f
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(f.Categoria, NCHAR(160), N' ')))
            WHERE pc.FechaAnalisisCategoria IS NOT NULL
              AND pc.FechaAnalisisCategoria <> f.FechaAnalisis;

            -- Ligadas ahora: fechas PROPIAS (hoy y hoy + 15) y los tipos que vengan (NULL si no).
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion,
                                         VigenteEnOrigen, FechaCreacionCategoria, FechaAnalisisCategoria)
            SELECT @Codigo, LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))),
                   NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''), NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''),
                   x.Pct, 1, @hoyMx, DATEADD(DAY, 15, @hoyMx)
            FROM @Agregar AS x;

            DECLARE @tr adm.CategoriaPctTipo;
            INSERT @tr (Categoria) SELECT Categoria FROM @Agregar UNION SELECT Categoria FROM @Pcts;
            IF EXISTS (SELECT 1 FROM @tr)
                EXEC adm.usp_GestionAdmin_TicketsReduce @Codigo = @Codigo, @Categorias = @tr;

            -- Modificar = Admin toma la iniciativa ENTERA (decidido 2026-10-14): el
            -- Excel ya no la pisa. Solo si algo editable cambio de verdad: una
            -- llamada sin cambios (o con los mismos valores) no se la quita al
            -- Excel. Si ya estaba protegida se queda como estaba (motivo y fecha).
            IF EXISTS (SELECT CONVERT(varbinary(max), Titulo), CONVERT(varbinary(max), Descripcion),
                              CONVERT(varbinary(max), Observaciones), CONVERT(varbinary(max), Estado),
                              CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre
                       FROM dbo.Problem WHERE Codigo = @Codigo
                       EXCEPT SELECT * FROM #antesP)
               OR EXISTS (SELECT CONVERT(varbinary(max), Categoria), PctDisminucion, CONVERT(varbinary(max), TipoIniciativa),
                                 CONVERT(varbinary(max), TipoAgrupado), FechaAnalisisCategoria, VigenteEnOrigen
                          FROM dbo.ProblemCategoria WHERE Codigo = @Codigo
                          EXCEPT SELECT * FROM #antesC)
               OR EXISTS (SELECT * FROM #antesC
                          EXCEPT SELECT CONVERT(varbinary(max), Categoria), PctDisminucion, CONVERT(varbinary(max), TipoIniciativa),
                                        CONVERT(varbinary(max), TipoAgrupado), FechaAnalisisCategoria, VigenteEnOrigen
                          FROM dbo.ProblemCategoria WHERE Codigo = @Codigo)
                INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario)
                SELECT @Codigo, 'MODIFICACION', @Usuario
                WHERE NOT EXISTS (SELECT 1 FROM adm.IniciativaProtegida WHERE Codigo = @Codigo);
            DROP TABLE #antesP; DROP TABLE #antesC;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 21; nada que confirmar: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('tempdb..#h21') IS NOT NULL DROP TABLE #h21;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #h21
FROM (VALUES (N'adm.usp_GestionAdmin_RevisarTope', 0x8F654F5AD01FD49C974F2CD707DA696FCC7F04067F213CB0E1E8C37C2FB4DFB7, 0x5C43DEBA819BA2D1AC3C13E1A32E409EC5BE1729BE9991DB5D73B64C48C43898),
             (N'adm.usp_GestionAdmin_Crear',       0x540F83EF4AF3AB4A3D3E2E8E7B6D4DE75B7731E98085DAD11CF54B14A4478D79, 0x77292B7976EAF0670BE8961824D212EEEFB218343A816CE83BB6F3FE8934C297),
             (N'adm.usp_GestionAdmin_Modificar',   0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3, 0x9D98582F2D08B1599CADFDE7BEB0C86168483E311758E6F9FA3B317AD529293E)) AS v (Objeto, Antes, Despues);
DECLARE @mal2 nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                               FROM #h21 WHERE Hash IS NULL OR Hash <> Despues ORDER BY Objeto);
IF @mal2 IS NULL
BEGIN
    COMMIT;
    SELECT Migracion = N'21 rollback', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 21: %s no quedo como se esperaba; ROLLBACK.', 16, 1, @mal2);
END;
GO
SET NOEXEC OFF;
GO
