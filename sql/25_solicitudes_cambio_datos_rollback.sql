/* =========================================================================
   sql/25_solicitudes_cambio_datos_rollback.sql - deshace sql/25.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     Crear y Aplicar vuelven al texto EXACTO de sql/22 (el lote empieza
     donde empezaba: el comentario forma parte del hash); CK_SolicitudCambio_Tipo
     vuelve a 4 valores; se quitan CK_SolicitudCambio_Datos / _DatosValores,
     los DEFAULT y las 9 columnas.

   DATOS
     Si hay alguna solicitud DATOS (pendiente o ya revisada) NO se deshace:
     se perderian su antes / despues y la bitacora quedaria sin su
     solicitud. Se niega sin tocar nada; decidir aparte que hacer con ellas.
     Lo ya APLICADO a dbo.Problem se queda (como cualquier Modificar).
     Antes de deshacer: el sitio tiene que dejar de mandar DATOS
     (PersistenciaSolicitudesCambio.SolicitaDatos = false, desplegado); si
     no, cada envio DATOS falla ("has no parameter named @CambiaTitulo").

   ORDEN: deshacer 25 ANTES que 24 (el rollback de 24 exige el Aplicar de
     sql/22 y se niega con el de 25).

   PRECONDICION: Crear y Aplicar con los hashes de sql/25; 0 filas DATOS.
   POSTCONDICION: Crear 0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71
                  Aplicar 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1 (sql/22), 13 parametros en Crear,
                  sin columnas de 25.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'25';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'25'
BEGIN
    RAISERROR (N'Rollback 25 SIN APROBAR: declara aprobar_migracion = 25 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID('tempdb..#h25') IS NOT NULL DROP TABLE #h25;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #h25
FROM (VALUES (N'adm.usp_SolicitudCambio_Crear', 0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203, 0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71),
             (N'adm.usp_SolicitudCambio_Aplicar', 0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1, 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1),
             (N'adm.usp_GestionAdmin_Modificar', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77)) AS v (Objeto, Antes, Despues);
DECLARE @mal nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                              FROM #h25 WHERE Objeto <> N'adm.usp_GestionAdmin_Modificar' AND (Hash IS NULL OR Hash <> Antes) ORDER BY Objeto);
DECLARE @datos int = 0;
IF @mal IS NULL AND COL_LENGTH('adm.SolicitudCambio', 'CambiaTitulo') IS NOT NULL
    EXEC sys.sp_executesql N'SELECT @n = COUNT(*) FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK) WHERE Tipo = ''DATOS''',
                           N'@n int OUTPUT', @n = @datos OUTPUT;
IF @mal IS NOT NULL OR @datos > 0
BEGIN
    ROLLBACK;
    IF @mal IS NOT NULL
        RAISERROR (N'Rollback 25: %s no es la de sql/25 (no aplicada o cambiada a mano). No se toca nada.', 16, 1, @mal);
    ELSE
        RAISERROR (N'Rollback 25: hay %d solicitud(es) DATOS; se perderian. No se toca nada.', 16, 1, @datos);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Alta de una solicitud de cambio. NUNCA toca dbo.Problem ni
   dbo.ProblemCategoria: solo lee lo actual para guardarlo como "anterior".
   @Usuario y @Rol los pone el servidor (IdentidadWindows / AccesoAdmin), no
   el navegador. @Llave: la misma llave del mismo usuario devuelve la misma
   solicitud (@Repetida = 1), sin otra fila. */
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
    @Repetida       bit OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @IdSolicitud = NULL;
    SET @Repetida = 0;
    SET @Usuario        = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @EstadoNuevo    = NULLIF(LTRIM(RTRIM(@EstadoNuevo)), N'');
    SET @SubestadoNuevo = NULLIF(LTRIM(RTRIM(@SubestadoNuevo)), N'');
    SET @Motivo         = NULLIF(LTRIM(RTRIM(@Motivo)), N'');

    IF @Usuario IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @Rol IS NULL OR @Rol NOT IN ('ADM', 'MOD')
        THROW 51210, N'Solo ADM o MOD pueden enviar solicitudes.', 1;
    IF @Llave IS NULL
        THROW 51211, N'Falta la llave de la solicitud.', 1;

    -- Reintento del mismo envio (doble clic, red): la misma solicitud.
    SELECT @IdSolicitud = IdSolicitud FROM adm.SolicitudCambio
    WHERE SolicitadoPor = @Usuario AND LlaveIdempotencia = @Llave;
    IF @IdSolicitud IS NOT NULL BEGIN SET @Repetida = 1; RETURN; END;

    IF @Motivo IS NULL
        THROW 51212, N'Falta el motivo de la solicitud.', 1;
    IF @Tipo IS NULL OR @Tipo NOT IN ('FECHA', 'ESTADO', 'CATEGORIAS', 'OTROS')
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
        THROW 51214, N'La solicitud no trae los campos de su tipo.', 1;

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
            DECLARE @eA nvarchar(100), @sA nvarchar(100), @fAn date, @fSo date, @fCi date;
            SELECT @eA = Estado, @sA = Subestado, @fAn = FechaAnalisis, @fSo = FechaSolucion, @fCi = FechaCierre
            FROM dbo.Problem WHERE Codigo = @Codigo;
            IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;
            DECLARE @fA date = CASE @CampoFecha WHEN 'FechaAnalisis' THEN @fAn
                                                WHEN 'FechaSolucion' THEN @fSo
                                                WHEN 'FechaCierre'   THEN @fCi END;
            IF @CampoFecha IS NOT NULL AND @fA = @FechaNueva
                THROW 51218, N'La nueva fecha compromiso es igual a la actual.', 1;
            IF @Tipo = 'ESTADO' AND @EstadoNuevo = LTRIM(RTRIM(ISNULL(@eA, N'')))
               AND (@SubestadoNuevo IS NULL OR @SubestadoNuevo = LTRIM(RTRIM(ISNULL(@sA, N''))))
                THROW 51219, N'El Estado pedido es igual al actual.', 1;

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
                    CampoFecha, FechaAnterior, FechaNueva, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia)
            VALUES (@Codigo, @Tipo,
                    CASE WHEN @Tipo = 'ESTADO' THEN @eA END, @EstadoNuevo,
                    CASE WHEN @Tipo = 'ESTADO' THEN @sA END, @SubestadoNuevo,
                    @CampoFecha, @fA, @FechaNueva, @Motivo, @Usuario, @Rol, @Llave);
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
   La autorizacion (solo ADM) es del handler. */
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
            @campo varchar(13), @fA date, @fN date, @nota nvarchar(2000) = NULL;
    BEGIN TRY
        BEGIN TRAN;
            SELECT @codigo = Codigo, @tipo = Tipo, @estado = Estado,
                   @eA = EstadoAnterior, @eN = EstadoNuevo, @sA = SubestadoAnterior, @sN = SubestadoNuevo,
                   @campo = CampoFecha, @fA = FechaAnterior, @fN = FechaNueva
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
                DECLARE @pE nvarchar(100), @pS nvarchar(100), @pAn date, @pSo date, @pCi date;
                SELECT @pE = Estado, @pS = Subestado, @pAn = FechaAnalisis, @pSo = FechaSolucion, @pCi = FechaCierre
                FROM dbo.Problem WITH (UPDLOCK, HOLDLOCK) WHERE Codigo = @codigo;
                IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;
                DECLARE @pF date = CASE @campo WHEN 'FechaAnalisis' THEN @pAn
                                               WHEN 'FechaSolucion' THEN @pSo
                                               WHEN 'FechaCierre'   THEN @pCi END;
                IF (@tipo = 'ESTADO' AND (CONVERT(varbinary(400), ISNULL(@pE, N'')) <> CONVERT(varbinary(400), ISNULL(@eA, N''))
                                       OR CONVERT(varbinary(400), ISNULL(@pS, N'')) <> CONVERT(varbinary(400), ISNULL(@sA, N''))))
                   OR (@campo IS NOT NULL AND ISNULL(@pF, '19000101') <> ISNULL(@fA, '19000101'))
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

                DECLARE @cE bit  = CASE WHEN @tipo = 'ESTADO' THEN 1 ELSE 0 END,
                        @cS bit  = CASE WHEN @tipo = 'ESTADO' AND @sN IS NOT NULL THEN 1 ELSE 0 END,
                        @cFA bit = CASE WHEN @campo = 'FechaAnalisis' THEN 1 ELSE 0 END,
                        @cFS bit = CASE WHEN @campo = 'FechaSolucion' THEN 1 ELSE 0 END,
                        @cFC bit = CASE WHEN @campo = 'FechaCierre' THEN 1 ELSE 0 END;
                EXEC adm.usp_GestionAdmin_Modificar
                     @Usuario = @Revisor, @Codigo = @codigo,
                     @CambiaEstado = @cE, @Estado = @eN, @CambiaSubestado = @cS, @Subestado = @sN,
                     @CambiaFAnalisis = @cFA, @FAnalisis = @fN,
                     @CambiaFSolucion = @cFS, @FSolucion = @fN,
                     @CambiaFCierre = @cFC, @FCierre = @fN,
                     @Pcts = @pcts, @Agregar = @agregar, @FechasCategoria = @fechasCat,
                     @Hoy = @Hoy, @SolicitudId = @IdSolicitud;
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_DatosValores;
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_Datos;
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_Tipo;
ALTER TABLE adm.SolicitudCambio ADD CONSTRAINT CK_SolicitudCambio_Tipo
    CHECK (Tipo IN ('FECHA', 'ESTADO', 'CATEGORIAS', 'OTROS'));
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT DF_SolicitudCambio_CambiaTitulo, DF_SolicitudCambio_CambiaOwnerProblem,
                                                 DF_SolicitudCambio_CambiaOwnerServicio;
ALTER TABLE adm.SolicitudCambio DROP COLUMN CambiaTitulo, TituloAnterior, TituloNuevo, CambiaOwnerProblem, OwnerProblemAnterior, OwnerProblemNuevo, CambiaOwnerServicio, OwnerServicioAnterior, OwnerServicioNuevo;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('tempdb..#p25') IS NOT NULL DROP TABLE #p25;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #p25
FROM (VALUES (N'adm.usp_SolicitudCambio_Crear', 0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203, 0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71),
             (N'adm.usp_SolicitudCambio_Aplicar', 0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1, 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1),
             (N'adm.usp_GestionAdmin_Modificar', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77)) AS v (Objeto, Antes, Despues);
DECLARE @mal2 nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                               FROM #p25 WHERE Hash IS NULL OR Hash <> Despues ORDER BY Objeto);
IF @mal2 IS NULL
   AND COL_LENGTH('adm.SolicitudCambio', 'CambiaTitulo') IS NULL
   AND OBJECT_ID('adm.CK_SolicitudCambio_Datos', 'C') IS NULL
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_SolicitudCambio_Crear')) = 13
BEGIN
    COMMIT;
    SELECT Rollback_ = N'25', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    SET @mal2 = ISNULL(@mal2, N'columnas o parametros');
    RAISERROR (N'Rollback 25: %s no quedo como se esperaba; ROLLBACK de todo.', 16, 1, @mal2);
END;
GO
SET NOEXEC OFF;
GO
