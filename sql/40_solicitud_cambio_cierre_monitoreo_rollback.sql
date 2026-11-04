/* =========================================================================
   sql/40_solicitud_cambio_cierre_monitoreo_rollback.sql - deshace sql/40.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     adm.usp_SolicitudCambio_Aplicar vuelve al texto EXACTO de sql/34 (el
     lote empieza donde empezaba: el comentario forma parte del hash).
     Sin datos que perder: sql/40 no tiene tablas ni columnas. Lo ya
     APLICADO a dbo.Problem (FechaCierre de cierres por solicitud) y su
     historial se quedan, como cualquier Modificar. Despues, cerrar por
     solicitud vuelve a no tocar FechaCierre (comportamiento de sql/34).

   ORDEN: deshacer 40 ANTES que 34 (el rollback de 34 exige su Aplicar).
     Sitio: no hace falta desplegar nada (mismos parametros).

   PRECONDICION:  Aplicar = sql/40 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB; Modificar = sql/24.
   POSTCONDICION: Aplicar = sql/34 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'40';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'40'
BEGIN
    RAISERROR (N'Rollback 40 SIN APROBAR: declara aprobar_migracion = 40 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID('tempdb..#h40') IS NOT NULL DROP TABLE #h40;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #h40
FROM (VALUES (N'adm.usp_SolicitudCambio_Aplicar', 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804),
             (N'adm.usp_GestionAdmin_Modificar', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77)) AS v (Objeto, Antes, Despues);
DECLARE @mal nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                              FROM #h40 WHERE Hash IS NULL OR Hash <> Antes ORDER BY Objeto);
DECLARE @ya bit = CASE WHEN NOT EXISTS (SELECT 1 FROM #h40 WHERE Hash IS NULL OR Hash <> Despues) THEN 1 ELSE 0 END;
IF @mal IS NOT NULL
BEGIN
    ROLLBACK;
    IF @ya = 1
        RAISERROR (N'Rollback 40: ya deshecho (Aplicar ya es el de sql/34). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 40: %s no es la esperada (Aplicar de sql/40, Modificar de sql/24). No se toca nada.', 16, 1, @mal);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 40: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
   llamada a Modificar: se aplica todo o nada. */
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 40: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- Postcondicion ---------- */
IF OBJECT_ID('tempdb..#p40') IS NOT NULL DROP TABLE #p40;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #p40
FROM (VALUES (N'adm.usp_SolicitudCambio_Aplicar', 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804),
             (N'adm.usp_GestionAdmin_Modificar', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77)) AS v (Objeto, Antes, Despues);
DECLARE @mal2 nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                               FROM #p40 WHERE Hash IS NULL OR Hash <> Despues ORDER BY Objeto);
IF @mal2 IS NULL
BEGIN
    COMMIT;
    SELECT Migracion = N'40', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 40: %s no quedo como se esperaba; ROLLBACK de todo.', 16, 1, @mal2);
END;
GO
SET NOEXEC OFF;
GO
