/* =========================================================================
   sql/83_reactivacion_categoria_historica_rollback.sql - deshace sql/83:
   los tres procedimientos vuelven EXACTOS a sql/24 / sql/40 / sql/38 y se
   quitan las propiedades ReglaReactivacion.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.

   NO TOCA FILAS. Lo que se reactivo con 83 se queda VIGENTE (es un estado
   valido de dbo.ProblemCategoria). Antes de correrlo, lista lo reactivado
   con sql/diag_83_reactivacion.sql y la baseline de antes de 83.
   Despues del rollback, volver a ligar una categoria dada de baja vuelve a
   ser 51008 / 51204, como antes de 83.

   ORDEN: va ANTES que cualquier rollback de 38, 40 o 41 (esos revisan la
   huella actual de Crear / Aplicar y se niegan con 83 aplicada).

   PRECONDICION (si no, ROLLBACK y no toca nada): las huellas de sql/83 y
     sus tres propiedades ReglaReactivacion.
   POSTCONDICION (si no, ROLLBACK): las huellas EXACTAS de antes
     Modificar sql/24 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77
     Aplicar   sql/40 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB
     Crear     sql/38 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F
     ReglaPso = EQUIPO_PO intacta y ninguna propiedad ReglaReactivacion.
   Los tres lotes de abajo son copia LITERAL de los de sql/24, sql/40 y
   sql/38 (con su comentario: es parte del texto y de la huella).

   COMO CORRERLO (solo con OK explicito)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'83R';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'83R'
BEGIN
    RAISERROR (N'Rollback 83 SIN APROBAR: declara aprobar_migracion = 83R en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hM varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Modificar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hA varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hC varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @sM nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @hM, 1), N'NULL'),
        @sA nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @hA, 1), N'NULL'),
        @sC nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @hC, 1), N'NULL');
IF @hM = 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77
   AND @hA = 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB
   AND @hC = 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 83: ya deshecha (huellas de sql/24 / 40 / 38). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF @hM IS NULL OR @hM <> 0x68331AC9641DBFD6A83213F5E74E23A5FA4F4CC8BC03F040A965269AC98B1054 OR @hA IS NULL OR @hA <> 0x8464627C052EA87A5792C1CE27477D3D04638A391FD29C66352BA66C295B218D OR @hC IS NULL OR @hC <> 0x08CED77CF27E9E929F264377B1059541E8C6CBD050B909D03FA58952613EE842
     OR (SELECT COUNT(*) FROM sys.extended_properties
         WHERE class = 1 AND minor_id = 0 AND name = N'ReglaReactivacion' AND CONVERT(nvarchar(30), value) = N'HISTORICA'
           AND major_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_Modificar', N'P'), OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar', N'P'),
                            OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P'))) <> 3
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 83: los procedimientos no son los de sql/83 (Modificar %s, Aplicar %s, Crear %s) o faltan sus propiedades. No se toca nada.', 16, 1, @sM, @sA, @sC);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Modificar: copia literal de sql/24 ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. Aplicar: copia literal de sql/40 ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Aprobar = aplicar, en UNA transaccion: la solicitud queda APLICADA solo
   si la iniciativa cambio de verdad (mismo adm.usp_GestionAdmin_Modificar
   que la edicion directa, con @SolicitudId para el historial).
   - Desactualizada (lo "anterior" ya no es lo que hay): 51204, no aplica.
   - Categoria por agregar sin clasificacion: ADM la da en @Clasificaciones
     (solo para esas filas: 51222 si no); sin ella, 51221. Lo que ADM elige
     queda en la fila de la solicitud.
   - Cualquier falla: ROLLBACK de todo; la solicitud SIGUE PENDIENTE
     (usp_SolicitudCambio_RegistrarFallo).
   - Otros: no cambia la iniciativa; se cierra con el comentario de lo que
     ADM corrigio a mano (51206 sin comentario).
   - Dos revisores a la vez: UPDLOCK; el segundo recibe 51202.
   - Quien envio y quien aplica se guardan aparte (SolicitadoPor /
     RevisadoPor), aunque sean la misma cuenta.
   La autorizacion (solo ADM) es del handler.
   sql/25: DATOS (Titulo / PO / SO capturados) se compara con su "anterior"
   en binario y se aplica por los parametros de Modificar de sql/24
   (@CambiaTitulo, @CambiaOwnerProblem, @CambiaOwnerServicio).
   sql/34: VARIOS = todo lo pedido (Estado, las fechas de cada etapa,
   categorias, Titulo / PO / SO) se compara con su "anterior" y va en UNA
   llamada a Modificar: se aplica todo o nada.
   sql/40: entrar a Cerrado, como la edicion directa (App_Code/PlanGestionAdmin):
   desde En Monitoreo FechaCierre = dia en que se APLICA (CierreDesdeMonitoreo;
   ya hoy, no se toca); desde otro Estado, hoy solo si queda vacia
   (FechaAlEntrar). @Hoy; sin el, Mexico UTC-06 como Modificar. Una
   FechaCierre pedida en la solicitud se respeta. */
ALTER PROCEDURE adm.usp_SolicitudCambio_Aplicar
    @IdSolicitud     int,
    @Revisor         nvarchar(256),
    @Comentario      nvarchar(4000) = NULL,
    @Clasificaciones adm.SolicitudClasificacionTipo READONLY,
    @Hoy             date = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Revisor    = NULLIF(LTRIM(RTRIM(@Revisor)), N'');
    SET @Comentario = NULLIF(LTRIM(RTRIM(@Comentario)), N'');
    IF @Revisor IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @@TRANCOUNT > 0
        THROW 51209, N'Aplicar abre su propia transaccion: no se llama dentro de otra.', 1;

    DECLARE @codigo nvarchar(100), @tipo varchar(10), @estado varchar(10),
            @eA nvarchar(100), @eN nvarchar(100), @sA nvarchar(100), @sN nvarchar(100),
            @campo varchar(13), @fA date, @fN date, @nota nvarchar(2000) = NULL,
            @cT bit, @tA nvarchar(max), @tN nvarchar(max),
            @cPO bit, @poA nvarchar(255), @poN nvarchar(255),
            @cSO bit, @soA nvarchar(255), @soN nvarchar(255),
            @vFA bit, @vFAa date, @vFAn date,
            @vFS bit, @vFSa date, @vFSn date,
            @vFC bit, @vFCa date, @vFCn date;
    BEGIN TRY
        BEGIN TRAN;
            SELECT @codigo = Codigo, @tipo = Tipo, @estado = Estado,
                   @eA = EstadoAnterior, @eN = EstadoNuevo, @sA = SubestadoAnterior, @sN = SubestadoNuevo,
                   @campo = CampoFecha, @fA = FechaAnterior, @fN = FechaNueva,
                   @cT = CambiaTitulo, @tA = TituloAnterior, @tN = TituloNuevo,
                   @cPO = CambiaOwnerProblem, @poA = OwnerProblemAnterior, @poN = OwnerProblemNuevo,
                   @cSO = CambiaOwnerServicio, @soA = OwnerServicioAnterior, @soN = OwnerServicioNuevo,
                   @vFA = CambiaFAnalisis, @vFAa = FAnalisisAnterior, @vFAn = FAnalisisNueva,
                   @vFS = CambiaFSolucion, @vFSa = FSolucionAnterior, @vFSn = FSolucionNueva,
                   @vFC = CambiaFCierre, @vFCa = FCierreAnterior, @vFCn = FCierreNueva
            FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK)
            WHERE IdSolicitud = @IdSolicitud;
            IF @estado IS NULL THROW 51201, N'La solicitud no existe.', 1;
            IF @estado <> 'PENDIENTE' THROW 51202, N'La solicitud ya fue revisada (aplicada o rechazada).', 1;
            IF @tipo = 'OTROS' AND @Comentario IS NULL
                THROW 51206, N'Una solicitud Otros se cierra con el comentario de lo que se corrigio.', 1;
            IF @tipo = 'OTROS' AND EXISTS (SELECT 1 FROM @Clasificaciones)
                THROW 51222, N'Solo se clasifica una categoria por agregar que llego sin clasificacion.', 1;

            IF @tipo <> 'OTROS'
            BEGIN
                -- Desactualizada: lo que la solicitud vio ya no es lo que hay.
                -- Textos en binario (como la proteccion de Modificar).
                DECLARE @pE nvarchar(100), @pS nvarchar(100), @pAn date, @pSo date, @pCi date,
                        @pT nvarchar(max), @pOwP nvarchar(4000), @pOwS nvarchar(4000);
                SELECT @pE = Estado, @pS = Subestado, @pAn = FechaAnalisis, @pSo = FechaSolucion, @pCi = FechaCierre,
                       @pT = Titulo, @pOwP = OwnerProblem, @pOwS = OwnerServicio
                FROM dbo.Problem WITH (UPDLOCK, HOLDLOCK) WHERE Codigo = @codigo;
                IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;
                DECLARE @pF date = CASE @campo WHEN 'FechaAnalisis' THEN @pAn
                                               WHEN 'FechaSolucion' THEN @pSo
                                               WHEN 'FechaCierre'   THEN @pCi END;
                IF ((@tipo = 'ESTADO' OR (@tipo = 'VARIOS' AND @eN IS NOT NULL))
                    AND (CONVERT(varbinary(400), ISNULL(@pE, N'')) <> CONVERT(varbinary(400), ISNULL(@eA, N''))
                         OR CONVERT(varbinary(400), ISNULL(@pS, N'')) <> CONVERT(varbinary(400), ISNULL(@sA, N''))))
                   OR (@campo IS NOT NULL AND ISNULL(@pF, '19000101') <> ISNULL(@fA, '19000101'))
                   OR (@vFA = 1 AND ISNULL(@pAn, '19000101') <> ISNULL(@vFAa, '19000101'))
                   OR (@vFS = 1 AND ISNULL(@pSo, '19000101') <> ISNULL(@vFSa, '19000101'))
                   OR (@vFC = 1 AND ISNULL(@pCi, '19000101') <> ISNULL(@vFCa, '19000101'))
                   OR (@cT = 1 AND CONVERT(varbinary(max), ISNULL(@pT, N'')) <> CONVERT(varbinary(max), ISNULL(@tA, N'')))
                   OR (@cPO = 1 AND CONVERT(varbinary(max), ISNULL(@pOwP, N'')) <> CONVERT(varbinary(max), ISNULL(@poA, N'')))
                   OR (@cSO = 1 AND CONVERT(varbinary(max), ISNULL(@pOwS, N'')) <> CONVERT(varbinary(max), ISNULL(@soA, N'')))
                   OR EXISTS (SELECT 1 FROM adm.SolicitudCambioCategoria AS c
                              LEFT JOIN dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                                     ON pc.Codigo = @codigo AND pc.Categoria = c.Categoria
                              WHERE c.IdSolicitud = @IdSolicitud
                                AND ((c.Accion = 'PCT' AND (pc.Codigo IS NULL OR pc.VigenteEnOrigen <> 1
                                                            OR ISNULL(pc.PctDisminucion, -1) <> ISNULL(c.PctAnterior, -1)))
                                  OR (c.Accion = 'AGREGAR' AND pc.Codigo IS NOT NULL)))
                    THROW 51204, N'La iniciativa cambio desde que se envio la solicitud: no se aplica. Rechazala o pide que la envien de nuevo.', 1;

                -- Clasificacion de ADM: solo filas AGREGAR que llegaron sin ella.
                IF EXISTS (SELECT 1 FROM @Clasificaciones GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
                    THROW 51003, N'Una categoria viene repetida.', 1;
                IF EXISTS (SELECT 1 FROM @Clasificaciones
                           WHERE NULLIF(LTRIM(RTRIM(TipoIniciativa)), N'') IS NULL OR NULLIF(LTRIM(RTRIM(TipoAgrupado)), N'') IS NULL)
                    THROW 51223, N'La clasificacion de ADM necesita Tipo de iniciativa y Agrupacion.', 1;
                IF EXISTS (SELECT 1 FROM @Clasificaciones AS r
                           WHERE NOT EXISTS (SELECT 1 FROM adm.SolicitudCambioCategoria AS c
                                             WHERE c.IdSolicitud = @IdSolicitud AND c.Accion = 'AGREGAR'
                                               AND c.Categoria = LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' ')))
                                               AND c.TipoIniciativa IS NULL AND c.TipoAgrupado IS NULL))
                    THROW 51222, N'Solo se clasifica una categoria por agregar que llego sin clasificacion.', 1;
                IF EXISTS (SELECT 1 FROM @Clasificaciones)
                BEGIN
                    UPDATE c SET c.TipoIniciativa = LTRIM(RTRIM(r.TipoIniciativa)), c.TipoAgrupado = LTRIM(RTRIM(r.TipoAgrupado))
                    FROM adm.SolicitudCambioCategoria AS c
                    INNER JOIN @Clasificaciones AS r ON c.Categoria = LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' ')))
                    WHERE c.IdSolicitud = @IdSolicitud AND c.Accion = 'AGREGAR';
                    SET @nota = LEFT(N'Clasificacion elegida por ADM: ' + STUFF((
                        SELECT N'; ' + LTRIM(RTRIM(REPLACE(r2.Categoria, NCHAR(160), N' '))) + N' = '
                             + LTRIM(RTRIM(r2.TipoIniciativa)) + N' / ' + LTRIM(RTRIM(r2.TipoAgrupado))
                        FROM @Clasificaciones AS r2 ORDER BY r2.Categoria
                        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N''), 2000);
                END;
                IF EXISTS (SELECT 1 FROM adm.SolicitudCambioCategoria
                           WHERE IdSolicitud = @IdSolicitud AND Accion = 'AGREGAR' AND (TipoIniciativa IS NULL OR TipoAgrupado IS NULL))
                    THROW 51221, N'Una categoria por agregar no tiene clasificacion (Tipo de iniciativa y Agrupacion): ADM debe elegirla.', 1;

                DECLARE @pcts adm.CategoriaPctTipo, @agregar adm.CategoriaPctTipo, @fechasCat adm.CategoriaFechaTipo;
                INSERT @pcts (Categoria, Pct)
                SELECT Categoria, PctNuevo FROM adm.SolicitudCambioCategoria WHERE IdSolicitud = @IdSolicitud AND Accion = 'PCT';
                INSERT @agregar (Categoria, Pct, TipoIniciativa, TipoAgrupado)
                SELECT Categoria, PctNuevo, TipoIniciativa, TipoAgrupado
                FROM adm.SolicitudCambioCategoria WHERE IdSolicitud = @IdSolicitud AND Accion = 'AGREGAR';

                -- VARIOS: cada fecha por su bandera; los demas tipos, por CampoFecha.
                DECLARE @cE bit  = CASE WHEN @tipo = 'ESTADO' OR (@tipo = 'VARIOS' AND @eN IS NOT NULL) THEN 1 ELSE 0 END,
                        @cS bit  = CASE WHEN (@tipo = 'ESTADO' OR (@tipo = 'VARIOS' AND @eN IS NOT NULL)) AND @sN IS NOT NULL THEN 1 ELSE 0 END,
                        @cFA bit = CASE WHEN @campo = 'FechaAnalisis' OR @vFA = 1 THEN 1 ELSE 0 END,
                        @cFS bit = CASE WHEN @campo = 'FechaSolucion' OR @vFS = 1 THEN 1 ELSE 0 END,
                        @cFC bit = CASE WHEN @campo = 'FechaCierre' OR @vFC = 1 THEN 1 ELSE 0 END,
                        @nFA date = CASE WHEN @vFA = 1 THEN @vFAn ELSE @fN END,
                        @nFS date = CASE WHEN @vFS = 1 THEN @vFSn ELSE @fN END,
                        @nFC date = CASE WHEN @vFC = 1 THEN @vFCn ELSE @fN END;
                -- sql/40: entrar a Cerrado (paridad con la edicion directa,
                -- PlanGestionAdmin). Solo si la solicitud no pide FechaCierre
                -- (o la pide vacia). Desde En Monitoreo: FechaCierre = dia en
                -- que se aplica, reemplaza el compromiso (CierreDesdeMonitoreo);
                -- si ya es hoy, no se reescribe. Desde otro Estado: hoy solo si
                -- queda vacia (FechaAlEntrar); una fecha existente se conserva.
                -- Estados sin mayusculas / acentos / espacios de mas (MismoEstado).
                DECLARE @hoyMx date = COALESCE(@Hoy, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));
                IF @cE = 1
                   AND LTRIM(RTRIM(@eN)) COLLATE Latin1_General_CI_AI = N'Cerrado' COLLATE Latin1_General_CI_AI
                   AND LTRIM(RTRIM(ISNULL(@pE, N''))) COLLATE Latin1_General_CI_AI <> N'Cerrado' COLLATE Latin1_General_CI_AI
                   AND (@cFC = 0 OR @nFC IS NULL)
                BEGIN
                    IF LTRIM(RTRIM(ISNULL(@pE, N''))) COLLATE Latin1_General_CI_AI = N'En Monitoreo' COLLATE Latin1_General_CI_AI
                    BEGIN
                        IF @pCi = @hoyMx
                            SELECT @cFC = 0, @nFC = NULL;
                        ELSE
                            SELECT @cFC = 1, @nFC = @hoyMx;
                    END
                    ELSE IF @pCi IS NULL OR @cFC = 1
                        SELECT @cFC = 1, @nFC = @hoyMx;
                END;
                EXEC adm.usp_GestionAdmin_Modificar
                     @Usuario = @Revisor, @Codigo = @codigo,
                     @CambiaEstado = @cE, @Estado = @eN, @CambiaSubestado = @cS, @Subestado = @sN,
                     @CambiaFAnalisis = @cFA, @FAnalisis = @nFA,
                     @CambiaFSolucion = @cFS, @FSolucion = @nFS,
                     @CambiaFCierre = @cFC, @FCierre = @nFC,
                     @Pcts = @pcts, @Agregar = @agregar, @FechasCategoria = @fechasCat,
                     @Hoy = @Hoy, @SolicitudId = @IdSolicitud,
                     @CambiaTitulo = @cT, @Titulo = @tN,
                     @CambiaOwnerProblem = @cPO, @OwnerProblem = @poN,
                     @CambiaOwnerServicio = @cSO, @OwnerServicio = @soN;
            END;

            UPDATE adm.SolicitudCambio
               SET Estado = 'APLICADA', RevisadoPor = @Revisor, FechaRevisionUtc = SYSUTCDATETIME(),
                   ComentarioRevision = @Comentario, Intentos = Intentos + 1,
                   UltimoError = NULL, FechaUltimoIntentoUtc = SYSUTCDATETIME()
             WHERE IdSolicitud = @IdSolicitud;
            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@IdSolicitud, 'APLICADA', @Revisor,
                    LEFT(CASE WHEN @nota IS NULL THEN @Comentario
                              WHEN @Comentario IS NULL THEN @nota
                              ELSE @Comentario + N' | ' + @nota END, 2000));
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @num int = ERROR_NUMBER(), @msg nvarchar(2000) = LEFT(ERROR_MESSAGE(), 2000);
        -- No existe, ya revisada, sin comentario o clasificacion mal dada por
        -- ADM: nada que registrar (no es un intento de aplicar). Lo demas se
        -- registra y la solicitud sigue PENDIENTE: nunca se pierde. Si el
        -- registro mismo falla, igual se lanza el error original.
        IF @num NOT IN (51201, 51202, 51206, 51209, 51222, 51223, 51003)
        BEGIN TRY
            EXEC adm.usp_SolicitudCambio_RegistrarFallo @IdSolicitud = @IdSolicitud, @Revisor = @Revisor,
                 @Numero = @num, @Mensaje = @msg;
        END TRY
        BEGIN CATCH
        END CATCH;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. Crear: copia literal de sql/38 ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Alta de una solicitud de cambio. NUNCA toca dbo.Problem ni
   dbo.ProblemCategoria: solo lee lo actual para guardarlo como "anterior".
   @Usuario y @Rol los pone el servidor (IdentidadWindows / AccesoAdmin), no
   el navegador. @Llave: la misma llave del mismo usuario devuelve la misma
   solicitud (@Repetida = 1), sin otra fila.
   sql/25: Tipo DATOS = Titulo / Product Owner / Service Owner CAPTURADOS de
   la iniciativa (dbo.Problem.Titulo / OwnerProblem / OwnerServicio), cada
   uno con su bandera Cambia*; el "anterior" de cada uno se guarda aqui.
   Que PO / SO sean del catalogo lo revisa la aplicacion (al aplicar, con la
   validacion de la edicion directa), como en Crear y Modificar.
   sql/34: Tipo VARIOS = cualquier combinacion de Estado (+ Subestado), las
   tres fechas compromiso (cada una con su bandera CambiaF*, nunca
   CampoFecha), categorias y Titulo / PO / SO, en UNA solicitud; al menos
   un cambio, cada uno con su "anterior" y las reglas de su tipo suelto.
   Otros no va en VARIOS.
   sql/37: @Rol PSO = Product Owner o Service Owner de ESTA iniciativa sin
   rol de Admin; se vuelve a comprobar aqui (51225 / 51226) y no pide
   Subestado (51227).
   sql/38: PSO tambien = Service Owner del equipo del PO de ESTA iniciativa:
   SO de una fila VIGENTE de dbo.CatCategoriaDueno cuyo ProductOwner es el
   OwnerProblem de la iniciativa (la cascada Director > PO > SO). */
ALTER PROCEDURE adm.usp_SolicitudCambio_Crear
    @Usuario        nvarchar(256),
    @Rol            varchar(3),
    @Llave          uniqueidentifier,
    @Codigo         nvarchar(100),
    @Tipo           varchar(10),
    @EstadoNuevo    nvarchar(100) = NULL,
    @SubestadoNuevo nvarchar(100) = NULL,
    @CampoFecha     varchar(13)   = NULL,
    @FechaNueva     date          = NULL,
    @Motivo         nvarchar(4000),
    @Categorias     adm.SolicitudCategoriaTipo READONLY,
    @IdSolicitud    int OUTPUT,
    @Repetida       bit OUTPUT,
    -- sql/25: al final y opcionales; quien no los manda sigue igual.
    @CambiaTitulo        bit = 0, @TituloNuevo        nvarchar(max)  = NULL,
    @CambiaOwnerProblem  bit = 0, @OwnerProblemNuevo  nvarchar(4000) = NULL,
    @CambiaOwnerServicio bit = 0, @OwnerServicioNuevo nvarchar(4000) = NULL,
    -- sql/34: al final y opcionales; solo con Tipo VARIOS.
    @CambiaFAnalisis     bit = 0, @FAnalisisNueva     date = NULL,
    @CambiaFSolucion     bit = 0, @FSolucionNueva     date = NULL,
    @CambiaFCierre       bit = 0, @FCierreNueva       date = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @IdSolicitud = NULL;
    SET @Repetida = 0;
    SET @Usuario        = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @EstadoNuevo    = NULLIF(LTRIM(RTRIM(@EstadoNuevo)), N'');
    SET @SubestadoNuevo = NULLIF(LTRIM(RTRIM(@SubestadoNuevo)), N'');
    SET @Motivo         = NULLIF(LTRIM(RTRIM(@Motivo)), N'');
    SET @CambiaTitulo        = ISNULL(@CambiaTitulo, 0);
    SET @CambiaOwnerProblem  = ISNULL(@CambiaOwnerProblem, 0);
    SET @CambiaOwnerServicio = ISNULL(@CambiaOwnerServicio, 0);
    SET @TituloNuevo         = NULLIF(LTRIM(RTRIM(@TituloNuevo)), N'');
    SET @OwnerProblemNuevo   = NULLIF(LTRIM(RTRIM(@OwnerProblemNuevo)), N'');
    SET @OwnerServicioNuevo  = NULLIF(LTRIM(RTRIM(@OwnerServicioNuevo)), N'');
    SET @CambiaFAnalisis     = ISNULL(@CambiaFAnalisis, 0);
    SET @CambiaFSolucion     = ISNULL(@CambiaFSolucion, 0);
    SET @CambiaFCierre       = ISNULL(@CambiaFCierre, 0);

    IF @Usuario IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @Rol IS NULL OR @Rol NOT IN ('ADM', 'MOD', 'PSO')
        THROW 51210, N'Solo ADM, MOD o el PO/SO de la iniciativa (PSO) pueden enviar solicitudes.', 1;
    IF @Rol = 'PSO' AND @SubestadoNuevo IS NOT NULL
        THROW 51227, N'Solo ADM pide un cambio de Subestado.', 1;
    IF @Llave IS NULL
        THROW 51211, N'Falta la llave de la solicitud.', 1;

    -- Reintento del mismo envio (doble clic, red): la misma solicitud.
    SELECT @IdSolicitud = IdSolicitud FROM adm.SolicitudCambio
    WHERE SolicitadoPor = @Usuario AND LlaveIdempotencia = @Llave;
    IF @IdSolicitud IS NOT NULL BEGIN SET @Repetida = 1; RETURN; END;

    IF @Motivo IS NULL
        THROW 51212, N'Falta el motivo de la solicitud.', 1;
    IF @Tipo IS NULL OR @Tipo NOT IN ('FECHA', 'ESTADO', 'CATEGORIAS', 'OTROS', 'DATOS', 'VARIOS')
        THROW 51213, N'Tipo de solicitud invalido.', 1;
    IF @CampoFecha IS NOT NULL AND @CampoFecha NOT IN ('FechaAnalisis', 'FechaSolucion', 'FechaCierre')
        THROW 51215, N'La fecha pedida no es de Analisis, Solucion ni Cierre.', 1;
    -- Cada tipo trae SOLO lo suyo. La fecha va siempre con su etapa.
    IF (@CampoFecha IS NULL AND @FechaNueva IS NOT NULL) OR (@CampoFecha IS NOT NULL AND @FechaNueva IS NULL)
       OR (@Tipo = 'FECHA'      AND (@CampoFecha IS NULL OR @EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL
                                     OR EXISTS (SELECT 1 FROM @Categorias)))
       OR (@Tipo = 'ESTADO'     AND (@EstadoNuevo IS NULL OR EXISTS (SELECT 1 FROM @Categorias)))
       OR (@Tipo = 'CATEGORIAS' AND (@EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL OR @CampoFecha IS NOT NULL
                                     OR NOT EXISTS (SELECT 1 FROM @Categorias)))
       OR (@Tipo = 'OTROS'      AND (@EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL OR @CampoFecha IS NOT NULL
                                     OR EXISTS (SELECT 1 FROM @Categorias)))
       -- sql/25: DATOS trae al menos uno de Titulo / PO / SO y nada mas; los
       -- demas tipos (salvo VARIOS), ninguno. Un valor sin su bandera no se acepta.
       OR (@Tipo = 'DATOS'      AND (@EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL OR @CampoFecha IS NOT NULL
                                     OR EXISTS (SELECT 1 FROM @Categorias)
                                     OR (@CambiaTitulo | @CambiaOwnerProblem | @CambiaOwnerServicio) = 0))
       OR (@Tipo NOT IN ('DATOS', 'VARIOS') AND (@CambiaTitulo | @CambiaOwnerProblem | @CambiaOwnerServicio) = 1)
       OR (@CambiaTitulo = 0 AND @TituloNuevo IS NOT NULL)
       OR (@CambiaOwnerProblem = 0 AND @OwnerProblemNuevo IS NOT NULL)
       OR (@CambiaOwnerServicio = 0 AND @OwnerServicioNuevo IS NOT NULL)
       -- sql/34: las fechas de VARIOS van por etapa (nunca CampoFecha), cada
       -- una con su bandera y su fecha; Subestado solo con Estado; al menos
       -- un cambio. Los demas tipos no traen banderas de fecha.
       OR (@Tipo <> 'VARIOS'    AND (@CambiaFAnalisis | @CambiaFSolucion | @CambiaFCierre) = 1)
       OR (@CambiaFAnalisis = 1 AND @FAnalisisNueva IS NULL) OR (@CambiaFAnalisis = 0 AND @FAnalisisNueva IS NOT NULL)
       OR (@CambiaFSolucion = 1 AND @FSolucionNueva IS NULL) OR (@CambiaFSolucion = 0 AND @FSolucionNueva IS NOT NULL)
       OR (@CambiaFCierre = 1 AND @FCierreNueva IS NULL) OR (@CambiaFCierre = 0 AND @FCierreNueva IS NOT NULL)
       OR (@Tipo = 'VARIOS'     AND (@CampoFecha IS NOT NULL
                                     OR (@SubestadoNuevo IS NOT NULL AND @EstadoNuevo IS NULL)
                                     OR (@EstadoNuevo IS NULL AND NOT EXISTS (SELECT 1 FROM @Categorias)
                                         AND (@CambiaFAnalisis | @CambiaFSolucion | @CambiaFCierre
                                              | @CambiaTitulo | @CambiaOwnerProblem | @CambiaOwnerServicio) = 0)))
        THROW 51214, N'La solicitud no trae los campos de su tipo.', 1;

    -- PO / SO: las columnas de dbo.Problem son de 255 (como Modificar, sql/24).
    IF LEN(@OwnerProblemNuevo) > 255 OR LEN(@OwnerServicioNuevo) > 255
        THROW 51027, N'Product Owner o Service Owner de mas de 255 caracteres.', 1;

    -- Categorias: las mismas reglas de formato que Modificar.
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Accion NOT IN ('PCT', 'AGREGAR'))
        THROW 51216, N'Accion de categoria invalida (PCT o AGREGAR).', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE NULLIF(LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Pct < 0 OR Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    -- La clasificacion de una categoria por agregar la deriva el servidor del
    -- prefijo (TiposPorPrefijo). Si no hay regla o el valor no existe en la
    -- base, la fila se guarda SIN clasificacion (ver el INSERT de abajo) y
    -- Aplicar exige que ADM la resuelva (51221): nunca se aplica incompleta.
    IF EXISTS (SELECT 1 FROM @Categorias AS c
               WHERE c.Accion = 'AGREGAR'
                 AND NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;
    -- Estado y Subestado: valores que ya existen en dbo.Problem (como Modificar
    -- y como la lista del registro, subestados_problem).
    IF @EstadoNuevo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = @EstadoNuevo)
        THROW 51013, N'El Estado no es uno de los que ya existen en dbo.Problem.', 1;
    IF @SubestadoNuevo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Subestado)) = @SubestadoNuevo)
        THROW 51217, N'El Subestado no es uno de los que ya existen en dbo.Problem.', 1;

    BEGIN TRY
        BEGIN TRAN;
            -- Lo que hay ahora es el "anterior" de la solicitud: Aplicar lo
            -- compara con lo que haya entonces (desactualizada = no se aplica).
            DECLARE @eA nvarchar(100), @sA nvarchar(100), @fAn date, @fSo date, @fCi date,
                    @tA nvarchar(max), @poA nvarchar(4000), @soA nvarchar(4000);
            SELECT @eA = Estado, @sA = Subestado, @fAn = FechaAnalisis, @fSo = FechaSolucion, @fCi = FechaCierre,
                   @tA = Titulo, @poA = OwnerProblem, @soA = OwnerServicio
            FROM dbo.Problem WHERE Codigo = @Codigo;
            IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;
            -- sql/37: PSO. El sitio ya lo comprobo (IdentidadAcuse); aqui se
            -- vuelve a comprobar en ESTA transaccion, con la fila de
            -- dbo.Problem bloqueada hasta el COMMIT y la misma regla:
            --   el folio es UNA sola fila de dbo.Problem (51225);
            --   cuenta -> cuenta@soriana.com -> UNA fila vigente de CatPersona
            --   con nombre que no se repite, y ese nombre es OwnerProblem u
            --   OwnerServicio de esa fila, o (sql/38) el ServiceOwner de una
            --   fila vigente de dbo.CatCategoriaDueno cuyo ProductOwner es el
            --   OwnerProblem de esa fila (51226).
            IF @Rol = 'PSO'
            BEGIN
                DECLARE @filasP int, @poP nvarchar(4000), @soP nvarchar(4000), @cta nvarchar(256), @yoCorreo nvarchar(4000),
                        @yoN int, @yo nvarchar(4000);
                SELECT @filasP = COUNT(*), @poP = MIN(OwnerProblem), @soP = MIN(OwnerServicio)
                FROM dbo.Problem WITH (UPDLOCK, HOLDLOCK) WHERE Codigo = @Codigo;
                IF @filasP <> 1
                    THROW 51225, N'El folio no identifica una sola iniciativa.', 1;
                SET @cta = CASE WHEN CHARINDEX(N'\', @Usuario) > 0 THEN RIGHT(@Usuario, CHARINDEX(N'\', REVERSE(@Usuario)) - 1) ELSE @Usuario END;
                SET @yoCorreo = adm.fn_ClaveCorreo(@cta) + N'@soriana.com';
                SELECT @yoN = COUNT(*), @yo = MIN(adm.fn_ClaveNombre(p.Nombre) COLLATE Latin1_General_100_BIN2)
                FROM dbo.CatPersona AS p
                WHERE p.VigenteEnOrigen = 1 AND adm.fn_ClaveCorreo(p.Correo) COLLATE Latin1_General_100_BIN2 = @yoCorreo COLLATE Latin1_General_100_BIN2;
                IF @yoN <> 1 OR @yo IS NULL
                   OR (SELECT COUNT(*) FROM dbo.CatPersona AS p
                       WHERE p.VigenteEnOrigen = 1 AND adm.fn_ClaveNombre(p.Nombre) COLLATE Latin1_General_100_BIN2 = @yo COLLATE Latin1_General_100_BIN2) <> 1
                   OR NOT (ISNULL(adm.fn_ClaveNombre(@poP), N'') COLLATE Latin1_General_100_BIN2 = @yo COLLATE Latin1_General_100_BIN2 OR ISNULL(adm.fn_ClaveNombre(@soP), N'') COLLATE Latin1_General_100_BIN2 = @yo COLLATE Latin1_General_100_BIN2
                           OR EXISTS (SELECT 1 FROM dbo.CatCategoriaDueno AS d
                                      WHERE d.VigenteEnOrigen = 1
                                        AND adm.fn_ClaveNombre(d.ServiceOwner) COLLATE Latin1_General_100_BIN2 = @yo COLLATE Latin1_General_100_BIN2
                                        AND adm.fn_ClaveNombre(d.ProductOwner) COLLATE Latin1_General_100_BIN2 = adm.fn_ClaveNombre(@poP) COLLATE Latin1_General_100_BIN2))
                    THROW 51226, N'La cuenta no es el Product Owner ni el Service Owner de la iniciativa, ni un Service Owner de su Product Owner.', 1;
            END;
            DECLARE @fA date = CASE @CampoFecha WHEN 'FechaAnalisis' THEN @fAn
                                                WHEN 'FechaSolucion' THEN @fSo
                                                WHEN 'FechaCierre'   THEN @fCi END;
            IF (@CampoFecha IS NOT NULL AND @fA = @FechaNueva)
               OR (@CambiaFAnalisis = 1 AND @fAn = @FAnalisisNueva)
               OR (@CambiaFSolucion = 1 AND @fSo = @FSolucionNueva)
               OR (@CambiaFCierre = 1 AND @fCi = @FCierreNueva)
                THROW 51218, N'La nueva fecha compromiso es igual a la actual.', 1;
            IF @Tipo IN ('ESTADO', 'VARIOS') AND @EstadoNuevo = LTRIM(RTRIM(ISNULL(@eA, N'')))
               AND (@SubestadoNuevo IS NULL OR @SubestadoNuevo = LTRIM(RTRIM(ISNULL(@sA, N''))))
                THROW 51219, N'El Estado pedido es igual al actual.', 1;
            -- sql/25: cada dato pedido tiene que cambiar algo (sin espacios de
            -- mas; el resto, en binario: mayusculas y acentos cuentan).
            IF (@CambiaTitulo = 1
                AND CONVERT(varbinary(max), ISNULL(@TituloNuevo, N'')) = CONVERT(varbinary(max), ISNULL(LTRIM(RTRIM(@tA)), N'')))
               OR (@CambiaOwnerProblem = 1
                   AND CONVERT(varbinary(max), ISNULL(@OwnerProblemNuevo, N'')) = CONVERT(varbinary(max), ISNULL(LTRIM(RTRIM(@poA)), N'')))
               OR (@CambiaOwnerServicio = 1
                   AND CONVERT(varbinary(max), ISNULL(@OwnerServicioNuevo, N'')) = CONVERT(varbinary(max), ISNULL(LTRIM(RTRIM(@soA)), N'')))
                THROW 51224, N'Un dato pedido (Titulo, Product Owner o Service Owner) es igual al actual.', 1;

            IF EXISTS (SELECT 1 FROM @Categorias AS x
                       WHERE x.Accion = 'PCT'
                         AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc
                                         WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1
                                           AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))))
                THROW 51007, N'Un cambio es de una categoria que no esta ligada (vigente) a esta iniciativa.', 1;
            IF EXISTS (SELECT 1 FROM @Categorias AS x
                       INNER JOIN dbo.ProblemCategoria AS pc
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                       WHERE x.Accion = 'AGREGAR')
                THROW 51008, N'La categoria ya esta ligada a esta iniciativa (o lo estuvo y se dio de baja).', 1;
            IF EXISTS (SELECT 1 FROM @Categorias AS x
                       INNER JOIN dbo.ProblemCategoria AS pc
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                       WHERE x.Accion = 'PCT' AND pc.PctDisminucion = x.Pct)
                THROW 51220, N'El % pedido de una categoria es igual al actual.', 1;

            INSERT adm.SolicitudCambio
                   (Codigo, Tipo, EstadoAnterior, EstadoNuevo, SubestadoAnterior, SubestadoNuevo,
                    CampoFecha, FechaAnterior, FechaNueva, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia,
                    CambiaTitulo, TituloAnterior, TituloNuevo,
                    CambiaOwnerProblem, OwnerProblemAnterior, OwnerProblemNuevo,
                    CambiaOwnerServicio, OwnerServicioAnterior, OwnerServicioNuevo,
                    CambiaFAnalisis, FAnalisisAnterior, FAnalisisNueva,
                    CambiaFSolucion, FSolucionAnterior, FSolucionNueva,
                    CambiaFCierre, FCierreAnterior, FCierreNueva)
            VALUES (@Codigo, @Tipo,
                    CASE WHEN @Tipo IN ('ESTADO', 'VARIOS') AND @EstadoNuevo IS NOT NULL THEN @eA END, @EstadoNuevo,
                    CASE WHEN @Tipo IN ('ESTADO', 'VARIOS') AND @EstadoNuevo IS NOT NULL THEN @sA END, @SubestadoNuevo,
                    @CampoFecha, @fA, @FechaNueva, @Motivo, @Usuario, @Rol, @Llave,
                    @CambiaTitulo, CASE WHEN @CambiaTitulo = 1 THEN @tA END, @TituloNuevo,
                    @CambiaOwnerProblem, CASE WHEN @CambiaOwnerProblem = 1 THEN @poA END, @OwnerProblemNuevo,
                    @CambiaOwnerServicio, CASE WHEN @CambiaOwnerServicio = 1 THEN @soA END, @OwnerServicioNuevo,
                    @CambiaFAnalisis, CASE WHEN @CambiaFAnalisis = 1 THEN @fAn END, @FAnalisisNueva,
                    @CambiaFSolucion, CASE WHEN @CambiaFSolucion = 1 THEN @fSo END, @FSolucionNueva,
                    @CambiaFCierre, CASE WHEN @CambiaFCierre = 1 THEN @fCi END, @FCierreNueva);
            SET @IdSolicitud = SCOPE_IDENTITY();

            INSERT adm.SolicitudCambioCategoria (IdSolicitud, Categoria, Accion, PctAnterior, PctNuevo, TipoIniciativa, TipoAgrupado)
            SELECT @IdSolicitud, LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), x.Accion,
                   CASE WHEN x.Accion = 'PCT' THEN pc.PctDisminucion END, x.Pct,
                   CASE WHEN k.Valida = 1 THEN t.TipoIniciativa END,
                   CASE WHEN k.Valida = 1 THEN t.TipoAgrupado END
            FROM @Categorias AS x
            CROSS APPLY (SELECT TipoIniciativa = NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''),
                                TipoAgrupado   = NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N'')) AS t
            -- Las dos o ninguna, y solo valores que ya existen (como Modificar).
            CROSS APPLY (SELECT Valida = CASE WHEN x.Accion = 'AGREGAR' AND t.TipoIniciativa IS NOT NULL AND t.TipoAgrupado IS NOT NULL
                                               AND EXISTS (SELECT 1 FROM dbo.Problem AS p WHERE LTRIM(RTRIM(p.TipoIniciativa)) = t.TipoIniciativa)
                                               AND EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS q WHERE LTRIM(RTRIM(q.TipoAgrupado)) = t.TipoAgrupado)
                                              THEN 1 ELSE 0 END) AS k
            LEFT JOIN dbo.ProblemCategoria AS pc
                   ON pc.Codigo = @Codigo
                  AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                  AND x.Accion = 'PCT';

            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@IdSolicitud, 'ENVIADA', @Usuario, N'Rol ' + @Rol);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- Dos envios simultaneos con la misma llave: el segundo choca con
        -- UQ_SolicitudCambio_Llave y devuelve la del primero.
        IF ERROR_NUMBER() IN (2601, 2627)
        BEGIN
            SELECT @IdSolicitud = IdSolicitud FROM adm.SolicitudCambio
            WHERE SolicitadoPor = @Usuario AND LlaveIdempotencia = @Llave;
            IF @IdSolicitud IS NOT NULL BEGIN SET @Repetida = 1; RETURN; END;
        END;
        SET @IdSolicitud = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 4. Quitar la marca de 83 ---------- */
EXEC sys.sp_dropextendedproperty @name = N'ReglaReactivacion',
     @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'usp_GestionAdmin_Modificar';
EXEC sys.sp_dropextendedproperty @name = N'ReglaReactivacion',
     @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'usp_SolicitudCambio_Aplicar';
EXEC sys.sp_dropextendedproperty @name = N'ReglaReactivacion',
     @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'usp_SolicitudCambio_Crear';
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 83: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 5. Postcondicion ---------- */
DECLARE @pM varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Modificar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @pA varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @pC varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @sM nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @pM, 1), N'NULL'),
        @sA nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @pA, 1), N'NULL'),
        @sC nvarchar(70) = ISNULL(CONVERT(nvarchar(70), @pC, 1), N'NULL');
IF @pM = 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77
   AND @pA = 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB
   AND @pC = 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F
   AND EXISTS (SELECT 1 FROM sys.extended_properties
               WHERE class = 1 AND minor_id = 0 AND major_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')
                 AND name = N'ReglaPso' AND CONVERT(nvarchar(30), value) = N'EQUIPO_PO')
   AND NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND name = N'ReglaReactivacion'
                   AND major_id IN (OBJECT_ID(N'adm.usp_GestionAdmin_Modificar', N'P'), OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar', N'P'),
                                    OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')))
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 83', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 83: no quedo como se esperaba (Modificar %s, Aplicar %s, Crear %s); ROLLBACK de todo.', 16, 1, @sM, @sA, @sC);
END;
GO
SET NOEXEC OFF;
GO
