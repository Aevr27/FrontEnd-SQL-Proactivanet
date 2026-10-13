/* =========================================================================
   sql/18_gestion_admin_persistencia.sql - Persistencia de la gestion
   directa de ADM (Crear / Ligar / Modificar) sobre dbo.Problem y
   dbo.ProblemCategoria.                         ROLLBACK: _rollback.sql

   ESTADO: SIN APROBAR. No se ha corrido en la VM. Probado solo en LocalDB
   desechable (tools/tests/GestionAdminSqlLocalDbSmoke.cs).

   COMO CORRERLO (cuando haya OK)
   La guarda de abajo detiene el script salvo en una base de prueba
   GestionAdminPrueba_* o con la aprobacion declarada en la MISMA sesion:
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'18';
   Correr completo (sqlcmd -b -I, o SSMS con el script entero). Todo va en
   UNA transaccion que abarca los lotes; cada lote comprueba que la
   transaccion sigue abierta (si un lote fallo y la deshizo, los siguientes
   no corren). Al final, si estan todos los objetos: COMMIT.

   PRECONDICIONES (sql/diag_admin_persistencia_gestion.sql)
     D4  trg_Problem_FechaEvento desplegado = sql/17 (captura de fechas)
     D5  ProblemCategoria sin estas columnas; D7 adm no existe
     D6  ningun modulo hace INSERT/SELECT * sobre ProblemCategoria sin lista
         de columnas (las columnas nuevas aceptan NULL, pero un INSERT sin
         lista fallaria)

   QUE CREA Y POR QUE
   1. dbo.ProblemCategoria + FechaCreacionCategoria / FechaAnalisisCategoria
      (date NULL, CHECK: las dos o ninguna). La tabla no tiene fecha de
      negocio por categoria (FechaAltaDW/FechaUltimaCargaDW son sellos de
      carga; CierreProblem/MejorFecha son del Excel y el cargador las pisa).
      NULL = la categoria comparte las fechas del problema: TODAS las filas
      existentes y las categorias iniciales de un alta. Con valor = ligada
      despues, con fechas propias. Agregar columnas NULL es solo metadatos.
   2. dbo.ProblemCategoriaFechaEvento + trigger: historial de esas fechas.
      dbo.ProblemFechaEvento no sirve: CHECK de Campo con solo las tres
      fechas del problema, sin Categoria, y su trigger vive en dbo.Problem.
   3. dbo.ProblemCategoriaPctEvento + trigger: historial de PctDisminucion
      (decimal, no cabe en una tabla de fechas). Captura tambien lo del
      cargador (NO_DECLARADO), como trg_Problem_FechaEvento.
   4. adm.ProblemaAdmin: los Codigo que administra Admin (creados aqui o
      tomados del Excel a proposito). Es la marca que el cargador parchado
      (sql/19) respeta para no pisar ni desactivar lo de Admin. No hay
      columna para eso en dbo.Problem (HashFila nunca se escribe).
   5. adm.ContadorCodigo + adm.usp_SiguienteCodigoProblem: no hay generador
      de Codigo en la base (sin secuencias ni contadores; el Excel lo
      teclea). Forma verificada 'PPP AAAA-NNNNNN', consecutivo por (prefijo,
      anio), anio = el de FechaCreacion. Se siembra una vez por (prefijo,
      anio) con el mayor numero ya usado (incluye VigenteEnOrigen = 0), luego
      solo el contador emite y salta cualquier codigo existente. En la misma
      transaccion del alta: si el alta falla, el numero no se consume.
   6. adm.CategoriaPctTipo + adm.usp_GestionAdmin_RevisarTope / _Crear /
      _Modificar: una transaccion por guardado; tope de 100% por ruta con
      candado exclusivo por ruta (sp_getapplock), revisado despues de tomar
      el candado. Regla de consumo = ExperienciaQueries.ConsumeCapacidad.
      La web solo necesita EXECUTE sobre adm (regla aprobada 2026-09-28: nada
      de DML directo en dbo desde el sitio).

   NO TOCA: datos existentes, dbo.Problem, dbo.ProblemFechaEvento, sus
   triggers, dbo.ProblemEstadoEvento, usp_CargarExperiencia (eso es sql/19).
   ========================================================================= */

IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'18'
BEGIN
    RAISERROR (N'Migracion 18 SIN APROBAR: declara EXEC sys.sp_set_session_context N''aprobar_migracion'', N''18'' en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF COL_LENGTH('dbo.ProblemCategoria', 'FechaCreacionCategoria') IS NOT NULL OR SCHEMA_ID('adm') IS NOT NULL
BEGIN
    RAISERROR (N'Migracion 18: ya aplicada o parcialmente aplicada (columna o esquema adm existen). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
GO

/* ---------- 1. Fechas propias por categoria ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: la transaccion ya no esta abierta; se detiene.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE dbo.ProblemCategoria ADD
    FechaCreacionCategoria date NULL,
    FechaAnalisisCategoria date NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE dbo.ProblemCategoria ADD
    CONSTRAINT CK_ProblemCategoria_FechasCategoria CHECK (
        (FechaCreacionCategoria IS NULL AND FechaAnalisisCategoria IS NULL)
        OR (FechaCreacionCategoria IS NOT NULL AND FechaAnalisisCategoria IS NOT NULL));
GO

/* ---------- 2. Historial de fechas por categoria ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE TABLE dbo.ProblemCategoriaFechaEvento
(
    IdEvento      int IDENTITY(1,1) NOT NULL
                  CONSTRAINT PK_ProblemCategoriaFechaEvento PRIMARY KEY CLUSTERED,
    Codigo        nvarchar(100) NOT NULL,
    Categoria     nvarchar(450) NOT NULL,
    Campo         varchar(22)   NOT NULL
                  CONSTRAINT CK_ProblemCategoriaFechaEvento_Campo
                  CHECK (Campo IN ('FechaCreacionCategoria', 'FechaAnalisisCategoria')),
    FechaAnterior date NULL,
    FechaNueva    date NULL,
    Operacion     char(1) NOT NULL
                  CONSTRAINT CK_ProblemCategoriaFechaEvento_Operacion CHECK (Operacion IN ('I', 'U')),
    Origen        varchar(12) NOT NULL
                  CONSTRAINT CK_ProblemCategoriaFechaEvento_Origen CHECK (Origen IN ('NO_DECLARADO', 'ADMIN')),
    Usuario       nvarchar(256) NULL,
    SolicitudId   int NULL,
    LoginBD       nvarchar(128) NOT NULL
                  CONSTRAINT DF_ProblemCategoriaFechaEvento_LoginBD DEFAULT (ORIGINAL_LOGIN()),
    FechaRegistro datetime2(3) NOT NULL
                  CONSTRAINT DF_ProblemCategoriaFechaEvento_FechaRegistro DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_ProblemCategoriaFechaEvento_ProblemCategoria
        FOREIGN KEY (Codigo, Categoria) REFERENCES dbo.ProblemCategoria (Codigo, Categoria),
    CONSTRAINT CK_ProblemCategoriaFechaEvento_Transicion CHECK (
        (FechaAnterior IS NOT NULL OR FechaNueva IS NOT NULL)
        AND (FechaAnterior IS NULL OR FechaNueva IS NULL OR FechaAnterior <> FechaNueva)),
    CONSTRAINT CK_ProblemCategoriaFechaEvento_Atribucion CHECK (
        (Origen = 'NO_DECLARADO' AND Usuario IS NULL AND SolicitudId IS NULL)
        OR (Origen = 'ADMIN' AND LEN(LTRIM(RTRIM(Usuario))) > 0))
);
CREATE NONCLUSTERED INDEX IX_ProblemCategoriaFechaEvento_Codigo
    ON dbo.ProblemCategoriaFechaEvento (Codigo, Categoria, IdEvento);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE TRIGGER dbo.trg_ProblemCategoria_FechaEvento
ON dbo.ProblemCategoria
AFTER INSERT, UPDATE
AS
BEGIN
    /* Una fila por fecha de categoria que cambia de verdad. En un INSERT,
       UPDATE() es verdadero para todas las columnas: las filas del cargador
       llegan NULL -> NULL y el WHERE las descarta. Crea: sql/18. */
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF NOT (UPDATE(FechaCreacionCategoria) OR UPDATE(FechaAnalisisCategoria)) RETURN;

    DECLARE @esAdmin bit =
        CASE WHEN CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen')) = 'ADMIN' THEN 1 ELSE 0 END;
    DECLARE @usuario nvarchar(256) =
        CASE WHEN @esAdmin = 1 THEN CONVERT(nvarchar(256), SESSION_CONTEXT(N'pfe_usuario')) END;
    DECLARE @solicitud int =
        CASE WHEN @esAdmin = 1 THEN TRY_CONVERT(int, SESSION_CONTEXT(N'pfe_solicitud')) END;

    INSERT dbo.ProblemCategoriaFechaEvento
           (Codigo, Categoria, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario, SolicitudId)
    SELECT i.Codigo, i.Categoria, v.Campo, v.Anterior, v.Nueva,
           CASE WHEN d.Codigo IS NULL THEN 'I' ELSE 'U' END,
           CASE WHEN @esAdmin = 1 THEN 'ADMIN' ELSE 'NO_DECLARADO' END,
           @usuario, @solicitud
    FROM inserted AS i
    LEFT JOIN deleted AS d ON d.Codigo = i.Codigo AND d.Categoria = i.Categoria
    CROSS APPLY (VALUES
        ('FechaCreacionCategoria', d.FechaCreacionCategoria, i.FechaCreacionCategoria),
        ('FechaAnalisisCategoria', d.FechaAnalisisCategoria, i.FechaAnalisisCategoria)
    ) AS v (Campo, Anterior, Nueva)
    WHERE EXISTS (SELECT v.Anterior EXCEPT SELECT v.Nueva);
END;
GO

/* ---------- 3. Historial del % por categoria ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE TABLE dbo.ProblemCategoriaPctEvento
(
    IdEvento      int IDENTITY(1,1) NOT NULL
                  CONSTRAINT PK_ProblemCategoriaPctEvento PRIMARY KEY CLUSTERED,
    Codigo        nvarchar(100) NOT NULL,
    Categoria     nvarchar(450) NOT NULL,
    PctAnterior   decimal(9,4) NULL,
    PctNuevo      decimal(9,4) NULL,
    Operacion     char(1) NOT NULL
                  CONSTRAINT CK_ProblemCategoriaPctEvento_Operacion CHECK (Operacion IN ('I', 'U')),
    Origen        varchar(12) NOT NULL
                  CONSTRAINT CK_ProblemCategoriaPctEvento_Origen CHECK (Origen IN ('NO_DECLARADO', 'ADMIN')),
    Usuario       nvarchar(256) NULL,
    SolicitudId   int NULL,
    LoginBD       nvarchar(128) NOT NULL
                  CONSTRAINT DF_ProblemCategoriaPctEvento_LoginBD DEFAULT (ORIGINAL_LOGIN()),
    FechaRegistro datetime2(3) NOT NULL
                  CONSTRAINT DF_ProblemCategoriaPctEvento_FechaRegistro DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_ProblemCategoriaPctEvento_ProblemCategoria
        FOREIGN KEY (Codigo, Categoria) REFERENCES dbo.ProblemCategoria (Codigo, Categoria),
    CONSTRAINT CK_ProblemCategoriaPctEvento_Transicion CHECK (
        (PctAnterior IS NOT NULL OR PctNuevo IS NOT NULL)
        AND (PctAnterior IS NULL OR PctNuevo IS NULL OR PctAnterior <> PctNuevo)),
    CONSTRAINT CK_ProblemCategoriaPctEvento_Atribucion CHECK (
        (Origen = 'NO_DECLARADO' AND Usuario IS NULL AND SolicitudId IS NULL)
        OR (Origen = 'ADMIN' AND LEN(LTRIM(RTRIM(Usuario))) > 0))
);
CREATE NONCLUSTERED INDEX IX_ProblemCategoriaPctEvento_Codigo
    ON dbo.ProblemCategoriaPctEvento (Codigo, Categoria, IdEvento);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE TRIGGER dbo.trg_ProblemCategoria_PctEvento
ON dbo.ProblemCategoria
AFTER INSERT, UPDATE
AS
BEGIN
    /* Una fila por % que cambia de verdad (el cargador reescribe el mismo
       valor en cada carga: EXCEPT lo descarta). Crea: sql/18. */
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF NOT UPDATE(PctDisminucion) RETURN;

    DECLARE @esAdmin bit =
        CASE WHEN CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen')) = 'ADMIN' THEN 1 ELSE 0 END;
    DECLARE @usuario nvarchar(256) =
        CASE WHEN @esAdmin = 1 THEN CONVERT(nvarchar(256), SESSION_CONTEXT(N'pfe_usuario')) END;
    DECLARE @solicitud int =
        CASE WHEN @esAdmin = 1 THEN TRY_CONVERT(int, SESSION_CONTEXT(N'pfe_solicitud')) END;

    INSERT dbo.ProblemCategoriaPctEvento
           (Codigo, Categoria, PctAnterior, PctNuevo, Operacion, Origen, Usuario, SolicitudId)
    SELECT i.Codigo, i.Categoria, d.PctDisminucion, i.PctDisminucion,
           CASE WHEN d.Codigo IS NULL THEN 'I' ELSE 'U' END,
           CASE WHEN @esAdmin = 1 THEN 'ADMIN' ELSE 'NO_DECLARADO' END,
           @usuario, @solicitud
    FROM inserted AS i
    LEFT JOIN deleted AS d ON d.Codigo = i.Codigo AND d.Categoria = i.Categoria
    WHERE EXISTS (SELECT d.PctDisminucion EXCEPT SELECT i.PctDisminucion);
END;
GO

/* ---------- 4. Esquema adm, registro de Admin y Codigo ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE SCHEMA adm AUTHORIZATION dbo;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE TABLE adm.ProblemaAdmin
(
    Codigo       nvarchar(100) NOT NULL
                 CONSTRAINT PK_ProblemaAdmin PRIMARY KEY CLUSTERED
                 CONSTRAINT FK_ProblemaAdmin_Problem REFERENCES dbo.Problem (Codigo),
    Origen       varchar(12) NOT NULL
                 CONSTRAINT CK_ProblemaAdmin_Origen CHECK (Origen IN ('CREADO', 'TOMADO')),
    Usuario      nvarchar(256) NOT NULL
                 CONSTRAINT CK_ProblemaAdmin_Usuario CHECK (LEN(LTRIM(RTRIM(Usuario))) > 0),
    FechaAlta    datetime2(3) NOT NULL CONSTRAINT DF_ProblemaAdmin_FechaAlta DEFAULT (SYSUTCDATETIME())
);
CREATE TABLE adm.ContadorCodigo
(
    Prefijo nvarchar(10) NOT NULL,
    Anio    smallint     NOT NULL CONSTRAINT CK_ContadorCodigo_Anio CHECK (Anio BETWEEN 2000 AND 9999),
    Ultimo  int          NOT NULL CONSTRAINT CK_ContadorCodigo_Ultimo CHECK (Ultimo BETWEEN 0 AND 999999),
    CONSTRAINT PK_ContadorCodigo PRIMARY KEY CLUSTERED (Prefijo, Anio)
);
CREATE TYPE adm.CategoriaPctTipo AS TABLE
(
    Categoria nvarchar(450) NOT NULL,
    Pct       decimal(9,4)  NULL
);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Emite el siguiente 'PPP AAAA-NNNNNN' dentro de la transaccion del que llama. */
CREATE PROCEDURE adm.usp_SiguienteCodigoProblem
    @Prefijo nvarchar(10),
    @Anio    smallint,
    @Codigo  nvarchar(100) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT = 0 THROW 51020, N'adm.usp_SiguienteCodigoProblem debe correr dentro de una transaccion.', 1;
    SET @Prefijo = UPPER(LTRIM(RTRIM(@Prefijo)));
    IF @Prefijo IS NULL OR @Prefijo NOT LIKE N'[A-Z][A-Z][A-Z]'
        THROW 51021, N'Prefijo invalido: se esperan tres letras.', 1;

    DECLARE @patron nvarchar(40) =
        @Prefijo + N' ' + CONVERT(nchar(4), @Anio) + N'-[0-9][0-9][0-9][0-9][0-9][0-9]';
    DECLARE @n int;

    IF NOT EXISTS (SELECT 1 FROM adm.ContadorCodigo WITH (UPDLOCK, HOLDLOCK)
                   WHERE Prefijo = @Prefijo AND Anio = @Anio)
        INSERT adm.ContadorCodigo (Prefijo, Anio, Ultimo)
        SELECT @Prefijo, @Anio, ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(p.Codigo, 10, 6))), 0)
        FROM dbo.Problem AS p WITH (HOLDLOCK)
        WHERE p.Codigo LIKE @patron;

    WHILE 1 = 1
    BEGIN
        UPDATE adm.ContadorCodigo WITH (UPDLOCK)
           SET @n = Ultimo = Ultimo + 1
        WHERE Prefijo = @Prefijo AND Anio = @Anio;
        SET @Codigo = @Prefijo + N' ' + CONVERT(nchar(4), @Anio) + N'-' + RIGHT(N'000000' + CONVERT(nvarchar(6), @n), 6);
        IF NOT EXISTS (SELECT 1 FROM dbo.Problem WITH (UPDLOCK, HOLDLOCK) WHERE Codigo = @Codigo) BREAK;
    END;
END;
GO

/* ---------- 5. Tope, alta y modificacion ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE PROCEDURE adm.usp_GestionAdmin_RevisarTope
    @Codigo  nvarchar(100),                 -- quien escribe: no cuenta contra si mismo
    @Revisar adm.CategoriaPctTipo READONLY  -- Pct = el valor nuevo
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT = 0 THROW 51030, N'adm.usp_GestionAdmin_RevisarTope debe correr dentro de una transaccion.', 1;

    -- Candado exclusivo por ruta normalizada (DirectorioOrganizacional.
    -- Normaliza: NBSP -> espacio, sin espacios en las puntas; sin distinguir
    -- mayusculas), en orden fijo para no cruzarse en un deadlock. Dura hasta
    -- el COMMIT/ROLLBACK del que llama.
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

    -- Consumo = ExperienciaQueries.ConsumeCapacidad: vigente en origen,
    -- Estado vivo (CI_AI: con o sin acento) y TipoAgrupado de AGRUPADORES.
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
          AND pc.Codigo <> @Codigo
          AND LTRIM(RTRIM(REPLACE(pc.Categoria, NCHAR(160), N' ')))
              = LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' ')))
          AND LTRIM(RTRIM(p.Estado)) COLLATE Latin1_General_CI_AI
              IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
          AND LTRIM(RTRIM(pc.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora')
    ) AS u
    WHERE r.Pct IS NOT NULL
      AND r.Pct > CASE WHEN u.Usado >= 1 THEN 0 ELSE 1 - u.Usado END
    ORDER BY r.Categoria;
    IF @msg IS NOT NULL THROW 51010, @msg, 1;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE PROCEDURE adm.usp_GestionAdmin_Crear
    @Usuario        nvarchar(256),
    @Prefijo        nvarchar(10),
    @TipoIniciativa nvarchar(100),
    @TipoAgrupado   nvarchar(100),
    @Estado         nvarchar(100),
    @Titulo         nvarchar(max),
    @Descripcion    nvarchar(max),
    @Observaciones  nvarchar(max),
    @Categorias     adm.CategoriaPctTipo READONLY,
    @Hoy            date = NULL,      -- NULL = hoy en Mexico (el servidor esta en UTC)
    @Codigo         nvarchar(100) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.CatPrefijoProblem WHERE Prefijo = @Prefijo)
        THROW 51002, N'El prefijo no esta en dbo.CatPrefijoProblem.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias
               GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE NULLIF(LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Pct < 0 OR Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;

    DECLARE @hoyMx date = COALESCE(@Hoy,
        CONVERT(date, SYSDATETIMEOFFSET() AT TIME ZONE N'Central Standard Time (Mexico)'));
    DECLARE @analisis date = DATEADD(DAY, 15, @hoyMx);   -- 15 dias naturales
    DECLARE @anio smallint = YEAR(@hoyMx);

    BEGIN TRY
        BEGIN TRAN;
            EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = N'', @Revisar = @Categorias;
            EXEC adm.usp_SiguienteCodigoProblem @Prefijo, @anio, @Codigo OUTPUT;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;

            INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Descripcion, Observaciones, Estado,
                                FechaCreacion, FechaAnalisis)
            VALUES (@Codigo, @TipoIniciativa, @Titulo, @Descripcion, @Observaciones, @Estado,
                    @hoyMx, @analisis);

            INSERT adm.ProblemaAdmin (Codigo, Origen, Usuario) VALUES (@Codigo, 'CREADO', @Usuario);

            -- Iniciales: sin fechas propias (NULL) = comparten las del problema.
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion)
            SELECT @Codigo, LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' '))), @TipoIniciativa, @TipoAgrupado, c.Pct
            FROM @Categorias AS c;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        COMMIT;
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Solo lo que trae su bandera Cambia*. No hay parametro para Codigo ni para
   FechaCreacion. Un Codigo que no esta en adm.ProblemaAdmin lo administra el
   Excel: se rechaza (51009) salvo @TomarDelExcel = 1, que lo registra como
   TOMADO (desde ahi el cargador parchado, sql/19, ya no lo pisa). */
CREATE PROCEDURE adm.usp_GestionAdmin_Modificar
    @Usuario             nvarchar(256),
    @Codigo              nvarchar(100),
    @TomarDelExcel       bit = 0,
    @CambiaTitulo        bit = 0, @Titulo        nvarchar(max) = NULL,
    @CambiaDescripcion   bit = 0, @Descripcion   nvarchar(max) = NULL,
    @CambiaObservaciones bit = 0, @Observaciones nvarchar(max) = NULL,
    @CambiaEstado        bit = 0, @Estado        nvarchar(100) = NULL,
    @CambiaSubestado     bit = 0, @Subestado     nvarchar(100) = NULL,
    @CambiaFAnalisis     bit = 0, @FAnalisis     date = NULL,
    @CambiaFSolucion     bit = 0, @FSolucion     date = NULL,
    @CambiaFCierre       bit = 0, @FCierre       date = NULL,
    @Pcts                adm.CategoriaPctTipo READONLY,   -- ya ligadas
    @Agregar             adm.CategoriaPctTipo READONLY,   -- nuevas
    @Hoy                 date = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar) AS x
               GROUP BY LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Agregar WHERE NULLIF(LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Pct FROM @Pcts UNION ALL SELECT Pct FROM @Agregar) AS x WHERE x.Pct < 0 OR x.Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;

    DECLARE @hoyMx date = COALESCE(@Hoy,
        CONVERT(date, SYSDATETIMEOFFSET() AT TIME ZONE N'Central Standard Time (Mexico)'));

    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estadoFinal nvarchar(100);
            SELECT @estadoFinal = CASE WHEN @CambiaEstado = 1 THEN @Estado ELSE p.Estado END
            FROM dbo.Problem AS p WITH (UPDLOCK, HOLDLOCK)
            WHERE p.Codigo = @Codigo;
            IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;

            IF NOT EXISTS (SELECT 1 FROM adm.ProblemaAdmin WITH (UPDLOCK, HOLDLOCK) WHERE Codigo = @Codigo)
            BEGIN
                IF @TomarDelExcel = 0
                    THROW 51009, N'La iniciativa la administra el Excel: la siguiente carga pisaria el cambio. Hay que tomarla para Admin.', 1;
                INSERT adm.ProblemaAdmin (Codigo, Origen, Usuario) VALUES (@Codigo, 'TOMADO', @Usuario);
            END;

            IF EXISTS (SELECT 1 FROM @Pcts AS x
                       WHERE NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc
                                         WHERE pc.Codigo = @Codigo
                                           AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))))
                THROW 51007, N'Un % es de una categoria que no esta ligada a esta iniciativa.', 1;
            IF EXISTS (SELECT 1 FROM @Agregar AS x
                       INNER JOIN dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))))
                THROW 51008, N'La categoria ya esta ligada a esta iniciativa.', 1;

            -- Tope: solo si la iniciativa queda en un estado vivo (si no, no
            -- consume). Subir revisa lo disponible; bajar o igual, nunca.
            IF LTRIM(RTRIM(@estadoFinal)) COLLATE Latin1_General_CI_AI
               IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
            BEGIN
                DECLARE @revisar adm.CategoriaPctTipo;
                INSERT @revisar (Categoria, Pct)
                SELECT x.Categoria, x.Pct FROM @Agregar AS x
                UNION ALL
                SELECT x.Categoria, x.Pct
                FROM @Pcts AS x
                INNER JOIN dbo.ProblemCategoria AS pc
                        ON pc.Codigo = @Codigo
                       AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                WHERE x.Pct > ISNULL(pc.PctDisminucion, 0);
                EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = @Codigo, @Revisar = @revisar;
            END;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;

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

            UPDATE pc SET pc.PctDisminucion = x.Pct
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @Pcts AS x
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')));

            -- Ligadas despues: fechas PROPIAS (hoy y hoy + 15). Tipo y
            -- agrupador se copian de las hermanas solo si son uno solo.
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion,
                                         FechaCreacionCategoria, FechaAnalisisCategoria)
            SELECT @Codigo, LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))),
                   (SELECT CASE WHEN COUNT(DISTINCT h.TipoIniciativa) = 1 THEN MIN(h.TipoIniciativa) END
                    FROM dbo.ProblemCategoria AS h WHERE h.Codigo = @Codigo),
                   (SELECT CASE WHEN COUNT(DISTINCT h.TipoAgrupado) = 1 THEN MIN(h.TipoAgrupado) END
                    FROM dbo.ProblemCategoria AS h WHERE h.Codigo = @Codigo),
                   x.Pct, @hoyMx, DATEADD(DAY, 15, @hoyMx)
            FROM @Agregar AS x;

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

/* ---------- 6. Permisos (descomentar con el usuario REAL del sitio, D8) ----------
GRANT EXECUTE ON SCHEMA::adm TO [{{USUARIO_SQL_DEL_SITIO}}];
GRANT SELECT ON dbo.ProblemCategoriaFechaEvento TO [{{USUARIO_SQL_DEL_SITIO}}];
GRANT SELECT ON dbo.ProblemCategoriaPctEvento TO [{{USUARIO_SQL_DEL_SITIO}}];
   (sin INSERT/UPDATE/DELETE sobre dbo: el sitio escribe solo por adm.*) */

/* ---------- 7. Cierre ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada; nada que confirmar.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('adm.usp_GestionAdmin_Modificar', 'P') IS NOT NULL
   AND OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P') IS NOT NULL
   AND OBJECT_ID('dbo.trg_ProblemCategoria_PctEvento', 'TR') IS NOT NULL
   AND OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento', 'TR') IS NOT NULL
   AND COL_LENGTH('dbo.ProblemCategoria', 'FechaAnalisisCategoria') IS NOT NULL
BEGIN
    COMMIT;
    SELECT Migracion = 18, Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 18: faltan objetos; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
