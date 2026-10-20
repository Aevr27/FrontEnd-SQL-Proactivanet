/* =========================================================================
   sql/24_gestion_admin_modificar_duenos_quitar.sql - edicion directa de
   ADM: PO / SO capturados de la iniciativa y desligar categorias.
                                             ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/ModificarDuenosQuitarSqlLocalDbSmoke.cs) para comprobar que
   compila y fijar los hashes de abajo. Aplicarla es otro paso, con su OK.

   DEPENDE DE sql/23 (sin aplicar). Orden: 22 (aplicada) -> 23 -> 24.
     La precondicion exige el Modificar EXACTO de sql/23: con 22 sola se
     niega sin tocar nada. Si sql/23 cambia o se descarta, este script se
     regenera (su lote de Modificar es el texto de sql/23 + lo de abajo).

   POR QUE
     Modificar no tenia como guardar PO / SO de una iniciativa ni desligar
     una categoria: el sitio lo rechazaba (Quitar = 409, pendiente de regla).
     Decisiones 2026-10-20: PO / SO son de la INICIATIVA (no de la
     categoria); quitar una categoria quita la ASOCIACION, nunca la
     categoria del catalogo ni sus duenos.

   QUE CAMBIA (solo adm.usp_GestionAdmin_Modificar; texto de sql/23 +)
     + @CambiaOwnerProblem bit = 0, @OwnerProblem nvarchar(4000) = NULL
     + @CambiaOwnerServicio bit = 0, @OwnerServicio nvarchar(4000) = NULL
     + @Quitar adm.CategoriaPctTipo READONLY (solo la columna Categoria)
       Al final y opcionales: Aplicar (sql/22) y el sitio de hoy llaman por
       nombre y no los mandan: siguen igual.
     PO / SO  -> dbo.Problem.OwnerProblem / OwnerServicio (las del alta de
                 sql/20; columnas de 255: 51027 si no caben). Que sean del
                 catalogo lo revisa la aplicacion, como en Crear.
     Quitar   -> UPDATE dbo.ProblemCategoria SET VigenteEnOrigen = 0 de una
                 ligada vigente (51007 si no lo es). Es la baja que ya da
                 el cargador (ADM_04, W6) y la que todos los lectores
                 filtran (VigenteEnOrigen = 1). Sin DELETE: la FK de
                 dbo.ProblemFechaEvento (Codigo, Categoria) lo impediria y
                 se perderia el historial. La desligada deja de consumir
                 capacidad (sale de @final); quitar nunca se bloquea por
                 tope. Cambiar / agregar / fechar y quitar la misma: 51018.
                 Volver a ligarla despues: 51008, como hoy.
     Proteccion y sello (sql/18 / sql/23): los owners entran a #antesP;
     VigenteEnOrigen ya estaba en #antesC. Un cambio real protege y sella.
     NO cambia: dbo (tablas, vistas, triggers), Crear, Aplicar, tipos, ni
     los duenos de dbo.CatCategoriaDueno.

   HISTORIAL
     dbo.ProblemFechaEvento / ProblemEstadoEvento no cubren owners ni
     categorias (tampoco % ni agregar hoy). Lo que queda: el sello de
     sql/23 (quien y cuando, sin el antes / despues) y, por solicitud, la
     bitacora de adm.SolicitudCambio. Una bitacora de owners / categorias
     seria otra migracion.

   DIAG ADM_04 (repo del backend), seccion 11: despues de esto marca
     Modificar como 'OTRA: revisar'. Es lo esperado con el hash de abajo.

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     Modificar = sql/23  0x816268254935C77FEE7F325E7E2663D828410EA9242E1037AB1BC3BD4D3F8CB7
     Aplicar   = sql/22  0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1   (no cambia)
     Hash = SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni saltos.
   POSTCONDICION (si no, ROLLBACK)
     Modificar 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 28 parametros con @Quitar / @OwnerProblem /
     @OwnerServicio; Aplicar sin cambio.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'24';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'24'
BEGIN
    RAISERROR (N'Migracion 24 SIN APROBAR: declara aprobar_migracion = 24 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID('tempdb..#h24') IS NOT NULL DROP TABLE #h24;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #h24
FROM (VALUES (N'adm.usp_GestionAdmin_Modificar', 0x816268254935C77FEE7F325E7E2663D828410EA9242E1037AB1BC3BD4D3F8CB7, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77),
             (N'adm.usp_SolicitudCambio_Aplicar', 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1, 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1)) AS v (Objeto, Antes, Despues);
DECLARE @mal nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                              FROM #h24 WHERE Hash IS NULL OR Hash <> Antes ORDER BY Objeto);
-- Antes del ROLLBACK: #h24 se crea dentro de la transaccion.
DECLARE @ya bit = CASE WHEN NOT EXISTS (SELECT 1 FROM #h24 WHERE Hash IS NULL OR Hash <> Despues) THEN 1 ELSE 0 END;
IF @mal IS NOT NULL OR TYPE_ID('adm.CategoriaPctTipo') IS NULL
   OR COL_LENGTH('dbo.Problem', 'OwnerProblem') IS NULL OR COL_LENGTH('dbo.Problem', 'OwnerServicio') IS NULL
BEGIN
    ROLLBACK;
    IF @ya = 1
        RAISERROR (N'Migracion 24: ya aplicada (hash de sql/24). No se toca nada.', 16, 1);
    ELSE IF @mal IS NOT NULL
        RAISERROR (N'Migracion 24: %s no es la esperada (Modificar de sql/23, Aplicar de sql/22). Aplica sql/23 antes. No se toca nada.', 16, 1, @mal);
    ELSE
        RAISERROR (N'Migracion 24: la base no es la esperada (falta adm.CategoriaPctTipo o las columnas Owner de dbo.Problem). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 24: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Modificar (texto de sql/23 + owners + quitar) ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 24: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Solo lo que trae su bandera Cambia*. No hay parametro para Codigo ni para
   FechaCreacion: no cambian.
   @Pcts      ligadas vigentes: Pct = el valor final; TipoIniciativa /
              TipoAgrupado NULL = no cambian (con valor, se declaran).
   @Agregar   se ligan ahora: Tipo* obligatorios; fechas PROPIAS = hoy y
              hoy + 15.
   @FechasCategoria  nueva fecha de analisis de una ligada. Si la categoria
              hereda (inicial, sin fecha propia), el cambio va a la fecha de
              la INICIATIVA (FechaAnalisis), no a una fecha propia.
   @SolicitudId  (sql/22) la adm.SolicitudCambio que se aplica: llega al
              historial (pfe_solicitud -> SolicitudId). NULL = edicion
              directa de ADM, igual que antes.
   sql/23: un cambio real sella adm.IniciativaProtegida.UltimoCambioUtc /
              UltimoCambioUsuario (Cambios recientes de Admin).
   sql/24: @CambiaOwnerProblem / @CambiaOwnerServicio = PO / SO CAPTURADOS
              de la iniciativa (dbo.Problem.OwnerProblem / OwnerServicio,
              como el alta de sql/20; NULL o vacio = se vacia). Los duenos
              de la categoria no se tocan.
              @Quitar  ligadas vigentes que se desligan: la misma baja que da
              el cargador (VigenteEnOrigen = 0). La fila se queda: el
              historial (dbo.ProblemFechaEvento) la referencia por FK. */
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
    @Hoy                 date = NULL,
    @SolicitudId         int  = NULL,
    -- sql/24: al final y opcionales; quien no los manda sigue igual.
    @CambiaOwnerProblem  bit = 0, @OwnerProblem  nvarchar(4000) = NULL,
    @CambiaOwnerServicio bit = 0, @OwnerServicio nvarchar(4000) = NULL,
    @Quitar              adm.CategoriaPctTipo READONLY
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    SET @OwnerProblem = NULLIF(LTRIM(RTRIM(@OwnerProblem)), N'');
    SET @OwnerServicio = NULLIF(LTRIM(RTRIM(@OwnerServicio)), N'');
    -- PO / SO: que sean del catalogo lo revisa la aplicacion (como en Crear).
    IF LEN(@OwnerProblem) > 255 OR LEN(@OwnerServicio) > 255
        THROW 51027, N'Product Owner o Service Owner de mas de 255 caracteres.', 1;
    IF EXISTS (SELECT 1 FROM @Quitar GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Quitar AS q
               WHERE LTRIM(RTRIM(REPLACE(q.Categoria, NCHAR(160), N' '))) IN
                     (SELECT LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                      FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar
                            UNION ALL SELECT Categoria FROM @FechasCategoria) AS x))
        THROW 51018, N'Una categoria no se puede cambiar o agregar y quitar a la vez.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar) AS x
               GROUP BY LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
       OR EXISTS (SELECT 1 FROM @FechasCategoria
                  GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar
                              UNION ALL SELECT Categoria FROM @FechasCategoria UNION ALL SELECT Categoria FROM @Quitar) AS x
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

            IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @FechasCategoria
                                      UNION ALL SELECT Categoria FROM @Quitar) AS x
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

            -- Como queda cada categoria vigente (+ las que se ligan; - las que
            -- se desligan, que dejan de consumir).
            DECLARE @final TABLE (Categoria nvarchar(450) PRIMARY KEY, PctAntes decimal(9,4), PctDespues decimal(9,4),
                                  AgrupAntes nvarchar(100), AgrupDespues nvarchar(100), Nueva bit);
            INSERT @final (Categoria, PctAntes, PctDespues, AgrupAntes, AgrupDespues, Nueva)
            SELECT pc.Categoria, pc.PctDisminucion,
                   CASE WHEN x.Categoria IS NULL THEN pc.PctDisminucion ELSE x.Pct END,
                   pc.TipoAgrupado,
                   COALESCE(NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), pc.TipoAgrupado), 0
            FROM dbo.ProblemCategoria AS pc
            LEFT JOIN @Pcts AS x ON pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
            WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1
              AND NOT EXISTS (SELECT 1 FROM @Quitar AS q
                              WHERE pc.Categoria = LTRIM(RTRIM(REPLACE(q.Categoria, NCHAR(160), N' '))));
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
                WHERE (NULLIF(LTRIM(RTRIM(f.AgrupDespues)), N'') IS NULL OR LTRIM(RTRIM(f.AgrupDespues)) COLLATE Latin1_General_CI_AI IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                  AND ISNULL(f.PctDespues, 0) > 0
                  AND (f.Nueva = 1
                       OR ISNULL(f.PctDespues, 0) > ISNULL(f.PctAntes, 0)
                       OR NOT (@vivoAntes = 1 AND (NULLIF(LTRIM(RTRIM(f.AgrupAntes)), N'') IS NULL
                                                   OR LTRIM(RTRIM(f.AgrupAntes)) COLLATE Latin1_General_CI_AI IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))));
                IF EXISTS (SELECT 1 FROM @revisar)
                    EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = @Codigo, @Revisar = @revisar;
            END;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = @SolicitudId;

            -- Lo editable como estaba (filas ya bloqueadas arriba): al final, solo
            -- si algo de esto cambio se protege la iniciativa. Textos en binario:
            -- un cambio de mayusculas o de espacios tambien es un cambio.
            SELECT Titulo = CONVERT(varbinary(max), Titulo), Descripcion = CONVERT(varbinary(max), Descripcion),
                   Observaciones = CONVERT(varbinary(max), Observaciones), Estado = CONVERT(varbinary(max), Estado),
                   Subestado = CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre,
                   OwnerProblem = CONVERT(varbinary(max), OwnerProblem), OwnerServicio = CONVERT(varbinary(max), OwnerServicio)
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
                FechaCierre   = CASE WHEN @CambiaFCierre = 1       THEN @FCierre       ELSE FechaCierre END,
                OwnerProblem  = CASE WHEN @CambiaOwnerProblem = 1  THEN @OwnerProblem  ELSE OwnerProblem END,
                OwnerServicio = CASE WHEN @CambiaOwnerServicio = 1 THEN @OwnerServicio ELSE OwnerServicio END
            WHERE Codigo = @Codigo
              AND (@CambiaTitulo | @CambiaDescripcion | @CambiaObservaciones | @CambiaEstado |
                   @CambiaSubestado | @CambiaFAnalisis | @CambiaFSolucion | @CambiaFCierre |
                   @CambiaOwnerProblem | @CambiaOwnerServicio) = 1;

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

            -- sql/24: desligar = la baja del cargador (W6 de ADM_04). Sin DELETE:
            -- dbo.ProblemFechaEvento referencia la fila por FK. Volver a ligarla
            -- despues sigue siendo 51008 (lo estuvo y se dio de baja).
            UPDATE pc SET pc.VigenteEnOrigen = 0
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @Quitar AS q
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(q.Categoria, NCHAR(160), N' ')))
            WHERE pc.VigenteEnOrigen = 1;

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
            -- sql/23: con el mismo criterio se sella el ultimo cambio (hora UTC y
            -- @Usuario, que pone el servidor); sin cambio real no se toca.
            IF EXISTS (SELECT CONVERT(varbinary(max), Titulo), CONVERT(varbinary(max), Descripcion),
                              CONVERT(varbinary(max), Observaciones), CONVERT(varbinary(max), Estado),
                              CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre,
                              CONVERT(varbinary(max), OwnerProblem), CONVERT(varbinary(max), OwnerServicio)
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
            BEGIN
                UPDATE adm.IniciativaProtegida
                   SET UltimoCambioUtc = SYSUTCDATETIME(), UltimoCambioUsuario = @Usuario
                 WHERE Codigo = @Codigo;
                IF @@ROWCOUNT = 0
                    INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario, UltimoCambioUtc, UltimoCambioUsuario)
                    VALUES (@Codigo, 'MODIFICACION', @Usuario, SYSUTCDATETIME(), @Usuario);
            END;
            DROP TABLE #antesP; DROP TABLE #antesC;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 24: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. Postcondicion ---------- */
IF OBJECT_ID('tempdb..#p24') IS NOT NULL DROP TABLE #p24;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #p24
FROM (VALUES (N'adm.usp_GestionAdmin_Modificar', 0x816268254935C77FEE7F325E7E2663D828410EA9242E1037AB1BC3BD4D3F8CB7, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77),
             (N'adm.usp_SolicitudCambio_Aplicar', 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1, 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1)) AS v (Objeto, Antes, Despues);
DECLARE @mal2 nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                               FROM #p24 WHERE Hash IS NULL OR Hash <> Despues ORDER BY Objeto);
IF @mal2 IS NULL
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')) = 28
   AND EXISTS (SELECT 1 FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')
               AND name = N'@Quitar' AND TYPE_NAME(user_type_id) = N'CategoriaPctTipo' AND is_readonly = 1)
   AND EXISTS (SELECT 1 FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')
               AND name = N'@OwnerProblem' AND TYPE_NAME(user_type_id) = N'nvarchar')
   AND EXISTS (SELECT 1 FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')
               AND name = N'@OwnerServicio' AND TYPE_NAME(user_type_id) = N'nvarchar')
BEGIN
    COMMIT;
    SELECT Migracion = N'24', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    SET @mal2 = ISNULL(@mal2, N'parametros');
    RAISERROR (N'Migracion 24: %s no quedo como se esperaba; ROLLBACK de todo.', 16, 1, @mal2);
END;
GO
SET NOEXEC OFF;
GO
