/* =========================================================================
   sql/38_solicitudes_cambio_pso_equipo_rollback.sql - deshace sql/38:
   adm.usp_SolicitudCambio_Crear vuelve al texto EXACTO de sql/37
   (0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642) y se quita la propiedad ReglaPso.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitanteAdminPsoSqlLocalDbSmoke.cs).

   No toca filas: las solicitudes PSO que guardo un SO del equipo se quedan
   y ADM las puede aplicar o rechazar. Sin la propiedad el sitio deja de
   ofrecer el boton a esos SO; si una pagina vieja manda PSO, sql/37 la
   rechaza (51226).

   PRECONDICION: Crear = sql/38 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F.
   POSTCONDICION: Crear = sql/37, sin ReglaPso.

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'38';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'38'
BEGIN
    RAISERROR (N'Rollback 38 SIN APROBAR: declara aprobar_migracion = 38 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h IS NULL OR @h <> 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F
BEGIN
    ROLLBACK;
    IF @h = 0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642
        RAISERROR (N'Rollback 38: sql/38 no esta aplicada (Crear ya es el de sql/37). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 38: Crear no es el de sql/38 (no aplicada o cambiada a mano). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 38: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
   Subestado (51227). */
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
            --   OwnerServicio de esa fila (51226).
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
                   OR NOT (ISNULL(adm.fn_ClaveNombre(@poP), N'') COLLATE Latin1_General_100_BIN2 = @yo COLLATE Latin1_General_100_BIN2 OR ISNULL(adm.fn_ClaveNombre(@soP), N'') COLLATE Latin1_General_100_BIN2 = @yo COLLATE Latin1_General_100_BIN2)
                    THROW 51226, N'La cuenta no es el Product Owner ni el Service Owner de la iniciativa.', 1;
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 38: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P') AND minor_id = 0 AND name = N'ReglaPso')
    EXEC sys.sp_dropextendedproperty @name = N'ReglaPso',
         @level0type = N'SCHEMA', @level0name = N'adm', @level1type = N'PROCEDURE', @level1name = N'usp_SolicitudCambio_Crear';
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 38: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) = 0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642
   AND NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P') AND minor_id = 0 AND name = N'ReglaPso')
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 38', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 38: Crear no quedo como el de sql/37; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
