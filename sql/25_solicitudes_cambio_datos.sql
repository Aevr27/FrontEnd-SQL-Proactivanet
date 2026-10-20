/* =========================================================================
   sql/25_solicitudes_cambio_datos.sql - "Solicitar cambios" de Titulo,
   Product Owner y Service Owner de una iniciativa (Tipo DATOS).
                                             ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitudesDatosSqlLocalDbSmoke.cs) para comprobar que
   compila y fijar los hashes de abajo. Aplicarla es otro paso, con su OK.

   DEPENDE DE sql/24 (y esta de sql/23), las dos SIN aplicar. Orden:
     22 (aplicada) -> 23 -> 24 -> 25. Aplicar llama a Modificar con los
     parametros de PO / SO de sql/24: con 22 / 23 sola se niega sin tocar
     nada. Si sql/24 cambia, se regenera este script (Crear y Aplicar son
     el texto de sql/22 + lo de abajo; generador gen25.py, fuera del repo).

   POR QUE
     Decision 2026-10-20: Titulo, PO y SO se piden con un tipo propio, no
     como "Otros" (texto libre que ADM corrige a mano). PO / SO son los
     CAPTURADOS de la iniciativa (dbo.Problem.OwnerProblem / OwnerServicio),
     nunca los de la categoria. Las categorias siguen en CATEGORIAS (sin
     quitar: no se pide por solicitud).

   QUE CAMBIA
     adm.SolicitudCambio
       + CambiaTitulo bit NOT NULL DEFAULT 0, TituloAnterior / TituloNuevo
         nvarchar(max) NULL
       + CambiaOwnerProblem bit NOT NULL DEFAULT 0, OwnerProblemAnterior /
         OwnerProblemNuevo nvarchar(255) NULL
       + CambiaOwnerServicio (igual que OwnerProblem)
       Filas existentes: banderas en 0 (DEFAULT), valores NULL.
       CK_SolicitudCambio_Tipo   se recrea con 'DATOS' (antes 4 valores)
       + CK_SolicitudCambio_Datos        DATOS <=> al menos una bandera
       + CK_SolicitudCambio_DatosValores sin bandera, sin valores
     adm.usp_SolicitudCambio_Crear  + @CambiaTitulo / @TituloNuevo,
       @CambiaOwnerProblem / @OwnerProblemNuevo, @CambiaOwnerServicio /
       @OwnerServicioNuevo (al final, opcionales: el sitio de hoy no los
       manda y sigue igual). Lee y guarda el "anterior" de cada uno; mismo
       valor = 51224; PO / SO de mas de 255 = 51027.
     adm.usp_SolicitudCambio_Aplicar  desactualizada tambien si Titulo / PO
       / SO ya no son su "anterior" (binario, 51204); los pasa a Modificar.
     NO cambia: Modificar (sql/24), Rechazar, RegistrarFallo, tipos TVP,
     SolicitudCambioCategoria / Evento, permisos, dbo.

   VALIDACION
     Que PO / SO sean del catalogo vigente lo revisa la aplicacion AL
     APLICAR (ValidacionAplicar.ComoEdicionDirecta = la misma de la edicion
     directa, ValidadorGestionAdmin.DuenoCapturado) y el navegador al
     enviar (listas del catalogo). La base solo revisa forma y largo.

   ERRORES NUEVOS: 51224 dato igual al actual. (51027 es el de sql/24.)

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     Crear     = sql/22  0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71
     Aplicar   = sql/22  0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1
     Modificar = sql/24  0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77
     sin las columnas nuevas. Hash = SHA2_256 de OBJECT_DEFINITION sin
     espacios, tabs ni saltos de linea (regla de sql/20 a 24).
   POSTCONDICION (si no, ROLLBACK)
     Crear     0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203
     Aplicar   0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1
     Modificar sin cambio; 9 columnas y 3 CHECK presentes; Crear con 19
     parametros.

   DIAG ADM_04 (repo del backend), seccion 11: no mira estos procedimientos.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'25';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'25'
BEGIN
    RAISERROR (N'Migracion 25 SIN APROBAR: declara aprobar_migracion = 25 en esta sesion.', 16, 1);
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
FROM (VALUES (N'adm.usp_SolicitudCambio_Crear', 0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71, 0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203),
             (N'adm.usp_SolicitudCambio_Aplicar', 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1, 0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1),
             (N'adm.usp_GestionAdmin_Modificar', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77)) AS v (Objeto, Antes, Despues);
DECLARE @mal nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                              FROM #h25 WHERE Hash IS NULL OR Hash <> Antes ORDER BY Objeto);
-- Antes del ROLLBACK: #h25 se crea dentro de la transaccion.
DECLARE @ya bit = CASE WHEN COL_LENGTH('adm.SolicitudCambio', 'CambiaTitulo') IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM #h25 WHERE Hash IS NULL OR Hash <> Despues) THEN 1 ELSE 0 END;
IF @mal IS NOT NULL OR OBJECT_ID('adm.SolicitudCambio', 'U') IS NULL
   OR OBJECT_ID('adm.CK_SolicitudCambio_Tipo', 'C') IS NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'CambiaTitulo') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'TituloAnterior') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'TituloNuevo') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'CambiaOwnerProblem') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'OwnerProblemAnterior') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'OwnerProblemNuevo') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'CambiaOwnerServicio') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'OwnerServicioAnterior') IS NOT NULL
   OR COL_LENGTH('adm.SolicitudCambio', 'OwnerServicioNuevo') IS NOT NULL
BEGIN
    ROLLBACK;
    IF @ya = 1
        RAISERROR (N'Migracion 25: ya aplicada (columnas y hashes de sql/25). No se toca nada.', 16, 1);
    ELSE IF @mal IS NOT NULL
        RAISERROR (N'Migracion 25: %s no es la esperada (Crear y Aplicar de sql/22, Modificar de sql/24). Aplica sql/23 y sql/24 antes. No se toca nada.', 16, 1, @mal);
    ELSE
        RAISERROR (N'Migracion 25: la base no es la esperada (falta adm.SolicitudCambio o ya tiene columnas de 25). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Columnas de Titulo / PO / SO ---------- */
ALTER TABLE adm.SolicitudCambio ADD
    CambiaTitulo          bit            NOT NULL CONSTRAINT DF_SolicitudCambio_CambiaTitulo DEFAULT (0),
    TituloAnterior        nvarchar(max)  NULL,
    TituloNuevo           nvarchar(max)  NULL,
    CambiaOwnerProblem    bit            NOT NULL CONSTRAINT DF_SolicitudCambio_CambiaOwnerProblem DEFAULT (0),
    OwnerProblemAnterior  nvarchar(255)  NULL,
    OwnerProblemNuevo     nvarchar(255)  NULL,
    CambiaOwnerServicio   bit            NOT NULL CONSTRAINT DF_SolicitudCambio_CambiaOwnerServicio DEFAULT (0),
    OwnerServicioAnterior nvarchar(255)  NULL,
    OwnerServicioNuevo    nvarchar(255)  NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. CHECK: el tipo DATOS y sus valores ---------- */
ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_Tipo;
ALTER TABLE adm.SolicitudCambio ADD CONSTRAINT CK_SolicitudCambio_Tipo
    CHECK (Tipo IN ('FECHA', 'ESTADO', 'CATEGORIAS', 'OTROS', 'DATOS'));
-- DATOS trae al menos una bandera; los demas tipos, ninguna.
ALTER TABLE adm.SolicitudCambio ADD CONSTRAINT CK_SolicitudCambio_Datos
    CHECK ((Tipo = 'DATOS' AND (CambiaTitulo = 1 OR CambiaOwnerProblem = 1 OR CambiaOwnerServicio = 1))
        OR (Tipo <> 'DATOS' AND CambiaTitulo = 0 AND CambiaOwnerProblem = 0 AND CambiaOwnerServicio = 0));
-- Sin bandera, sin valores (con bandera, NULL = vacio, se permite).
ALTER TABLE adm.SolicitudCambio ADD CONSTRAINT CK_SolicitudCambio_DatosValores
    CHECK ((CambiaTitulo = 1 OR (TituloAnterior IS NULL AND TituloNuevo IS NULL))
       AND (CambiaOwnerProblem = 1 OR (OwnerProblemAnterior IS NULL AND OwnerProblemNuevo IS NULL))
       AND (CambiaOwnerServicio = 1 OR (OwnerServicioAnterior IS NULL AND OwnerServicioNuevo IS NULL)));
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. Crear (texto de sql/22 + DATOS) ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
   validacion de la edicion directa), como en Crear y Modificar. */
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
    @CambiaOwnerServicio bit = 0, @OwnerServicioNuevo nvarchar(4000) = NULL
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
    IF @Tipo IS NULL OR @Tipo NOT IN ('FECHA', 'ESTADO', 'CATEGORIAS', 'OTROS', 'DATOS')
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
       -- demas tipos, ninguno. Un valor sin su bandera no se acepta.
       OR (@Tipo = 'DATOS'      AND (@EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL OR @CampoFecha IS NOT NULL
                                     OR EXISTS (SELECT 1 FROM @Categorias)
                                     OR (@CambiaTitulo | @CambiaOwnerProblem | @CambiaOwnerServicio) = 0))
       OR (@Tipo <> 'DATOS'     AND (@CambiaTitulo | @CambiaOwnerProblem | @CambiaOwnerServicio) = 1)
       OR (@CambiaTitulo = 0 AND @TituloNuevo IS NOT NULL)
       OR (@CambiaOwnerProblem = 0 AND @OwnerProblemNuevo IS NOT NULL)
       OR (@CambiaOwnerServicio = 0 AND @OwnerServicioNuevo IS NOT NULL)
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
            DECLARE @fA date = CASE @CampoFecha WHEN 'FechaAnalisis' THEN @fAn
                                                WHEN 'FechaSolucion' THEN @fSo
                                                WHEN 'FechaCierre'   THEN @fCi END;
            IF @CampoFecha IS NOT NULL AND @fA = @FechaNueva
                THROW 51218, N'La nueva fecha compromiso es igual a la actual.', 1;
            IF @Tipo = 'ESTADO' AND @EstadoNuevo = LTRIM(RTRIM(ISNULL(@eA, N'')))
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
                    CambiaOwnerServicio, OwnerServicioAnterior, OwnerServicioNuevo)
            VALUES (@Codigo, @Tipo,
                    CASE WHEN @Tipo = 'ESTADO' THEN @eA END, @EstadoNuevo,
                    CASE WHEN @Tipo = 'ESTADO' THEN @sA END, @SubestadoNuevo,
                    @CampoFecha, @fA, @FechaNueva, @Motivo, @Usuario, @Rol, @Llave,
                    @CambiaTitulo, CASE WHEN @CambiaTitulo = 1 THEN @tA END, @TituloNuevo,
                    @CambiaOwnerProblem, CASE WHEN @CambiaOwnerProblem = 1 THEN @poA END, @OwnerProblemNuevo,
                    @CambiaOwnerServicio, CASE WHEN @CambiaOwnerServicio = 1 THEN @soA END, @OwnerServicioNuevo);
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 4. Aplicar (texto de sql/22 + DATOS) ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
   (@CambiaTitulo, @CambiaOwnerProblem, @CambiaOwnerServicio). */
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
            @cSO bit, @soA nvarchar(255), @soN nvarchar(255);
    BEGIN TRY
        BEGIN TRAN;
            SELECT @codigo = Codigo, @tipo = Tipo, @estado = Estado,
                   @eA = EstadoAnterior, @eN = EstadoNuevo, @sA = SubestadoAnterior, @sN = SubestadoNuevo,
                   @campo = CampoFecha, @fA = FechaAnterior, @fN = FechaNueva,
                   @cT = CambiaTitulo, @tA = TituloAnterior, @tN = TituloNuevo,
                   @cPO = CambiaOwnerProblem, @poA = OwnerProblemAnterior, @poN = OwnerProblemNuevo,
                   @cSO = CambiaOwnerServicio, @soA = OwnerServicioAnterior, @soN = OwnerServicioNuevo
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
                IF (@tipo = 'ESTADO' AND (CONVERT(varbinary(400), ISNULL(@pE, N'')) <> CONVERT(varbinary(400), ISNULL(@eA, N''))
                                       OR CONVERT(varbinary(400), ISNULL(@pS, N'')) <> CONVERT(varbinary(400), ISNULL(@sA, N''))))
                   OR (@campo IS NOT NULL AND ISNULL(@pF, '19000101') <> ISNULL(@fA, '19000101'))
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 25: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 5. Postcondicion ---------- */
IF OBJECT_ID('tempdb..#p25') IS NOT NULL DROP TABLE #p25;
SELECT v.Objeto, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')),
       v.Antes, v.Despues
INTO #p25
FROM (VALUES (N'adm.usp_SolicitudCambio_Crear', 0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71, 0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203),
             (N'adm.usp_SolicitudCambio_Aplicar', 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1, 0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1),
             (N'adm.usp_GestionAdmin_Modificar', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77)) AS v (Objeto, Antes, Despues);
DECLARE @mal2 nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                               FROM #p25 WHERE Hash IS NULL OR Hash <> Despues ORDER BY Objeto);
IF @mal2 IS NULL
   AND (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('adm.SolicitudCambio')
        AND name IN (N'CambiaTitulo', N'TituloAnterior', N'TituloNuevo', N'CambiaOwnerProblem', N'OwnerProblemAnterior', N'OwnerProblemNuevo', N'CambiaOwnerServicio', N'OwnerServicioAnterior', N'OwnerServicioNuevo')) = 9
   AND OBJECT_ID('adm.CK_SolicitudCambio_Tipo', 'C') IS NOT NULL
   AND OBJECT_ID('adm.CK_SolicitudCambio_Datos', 'C') IS NOT NULL
   AND OBJECT_ID('adm.CK_SolicitudCambio_DatosValores', 'C') IS NOT NULL
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_SolicitudCambio_Crear')) = 19
BEGIN
    COMMIT;
    SELECT Migracion = N'25', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    SET @mal2 = ISNULL(@mal2, N'columnas, CHECK o parametros');
    RAISERROR (N'Migracion 25: %s no quedo como se esperaba; ROLLBACK de todo.', 16, 1, @mal2);
END;
GO
SET NOEXEC OFF;
GO
