/* =========================================================================
   sql/28_acuse_po_so.sql - acuse "Estoy trabajando en ello" de PO/SO y su
   notificacion para ADM dentro de la app (sql/PROPUESTA_acuse_po_so.md).

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE CREA (una transaccion; NO altera nada que ya exista)
     adm.AcuseIniciativa     un acuse = (iniciativa, rol PO|SO, cuenta,
                             fecha compromiso del estado). UNIQUE: el mismo
                             episodio no se acusa dos veces.
     adm.NotificacionAdm     una notificacion por acuse (UNIQUE IdAcuse).
     adm.NotificacionLectura leida = hay fila (por usuario ADM).
     adm.usp_Acuse_Registrar           unica escritura de acuse + aviso
     adm.usp_Notificacion_MarcarLeida  unica escritura de "leida"
     DENY INSERT/UPDATE/DELETE de PROACTIVANETAD sobre las tres tablas
     (db_datawriter le dejaria escribirlas a mano; como sql/18 sec. 8).
   0 filas de dbo tocadas. dbo.Problem solo se LEE (con UPDLOCK, HOLDLOCK
   mientras se revalida).

   QUIEN Y QUE SE REVALIDA AQUI
     @Usuario lo pone el servidor (AccesoAdmin.IdentidadEscritura: la
     cuenta de IIS), nunca el formulario. La identidad PO/SO (cuenta ->
     cuenta@soriana.com -> dbo.CatPersona) y la regla Atrasada del semaforo
     se deciden en el sitio (App_Code/AcuseIniciativa.cs), que manda el
     nombre de dueño, el Estado y la fecha compromiso que vio. Aqui, en la
     transaccion y con la fila bloqueada, se comprueba que la iniciativa
     exista y este vigente y que el dueño de ese rol, el Estado y la fecha
     compromiso SIGAN siendo esos (si cambiaron entre la revision y el
     guardado: error, nada se guarda). La fecha compromiso es la de
     dbo.Problem segun el Estado (Analisis -> FechaAnalisis, Solucion ->
     FechaSolucion, Monitoreo -> FechaCierre), la misma que la lista usa
     para el semaforo; puede ser NULL (va atrasada por la fecha propia de
     una categoria) y NULL tambien es un episodio: NULL = NULL coincide,
     NULL contra una fecha no.

   ERRORES (THROW)
     51301 sin usuario          51302 rol distinto de PO / SO
     51303 sin nombre de dueño  51304 la iniciativa no existe o no esta vigente
     51305 el dueño de ese rol cambio      51306 el Estado cambio
     51307 la notificacion no existe       51308 la fecha compromiso cambio

   DEPENDENCIAS
     dbo.Problem (Codigo con indice unico: ya lo referencian sql/22) y el
     esquema adm. No depende de 22-27 ni los cambia. El sitio detecta las
     cinco piezas (DeteccionSql28): sin ellas el acuse no aparece y el
     handler responde 501; se puede aplicar antes o despues del despliegue.

   PERMISOS
     PROACTIVANETAD: lee (db_datareader) y ejecuta (EXECUTE sobre adm, de
     sql/18) sin nada nuevo; el DENY de abajo le quita escribir a mano. Si el
     usuario no existe en la base (LocalDB de pruebas) el DENY se omite.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'28';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   Rollback: sql/28_acuse_po_so_rollback.sql.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'28'
BEGIN
    RAISERROR (N'Migracion 28 SIN APROBAR: declara aprobar_migracion = 28 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hay int = (CASE WHEN OBJECT_ID(N'adm.AcuseIniciativa', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.NotificacionAdm', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.NotificacionLectura', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_Acuse_Registrar', N'P') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_Notificacion_MarcarLeida', N'P') IS NULL THEN 0 ELSE 1 END);
IF @hay > 0 OR OBJECT_ID(N'dbo.Problem', N'U') IS NULL OR SCHEMA_ID(N'adm') IS NULL
   OR COL_LENGTH(N'dbo.Problem', N'OwnerProblem') IS NULL OR COL_LENGTH(N'dbo.Problem', N'OwnerServicio') IS NULL
BEGIN
    ROLLBACK;
    IF @hay = 5
        RAISERROR (N'Migracion 28: ya aplicada. No se toca nada.', 16, 1);
    ELSE IF @hay > 0
        RAISERROR (N'Migracion 28: hay %d de 5 objetos de sql/28 (a medias o a mano). No se toca nada.', 16, 1, @hay);
    ELSE
        RAISERROR (N'Migracion 28: la base no es la esperada (falta dbo.Problem con OwnerProblem/OwnerServicio o el esquema adm). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 28: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Tablas (Codigo con la intercalacion de dbo.Problem) ---------- */
DECLARE @colCod sysname = (SELECT c.collation_name FROM sys.columns AS c
                           WHERE c.object_id = OBJECT_ID(N'dbo.Problem') AND c.name = N'Codigo');
IF @colCod IS NULL THROW 51300, N'Migracion 28: dbo.Problem.Codigo sin intercalacion.', 1;
DECLARE @t nvarchar(max) = N'
CREATE TABLE adm.AcuseIniciativa
(
    IdAcuse          int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_AcuseIniciativa PRIMARY KEY CLUSTERED,
    Codigo           nvarchar(100) COLLATE ' + @colCod + N' NOT NULL
                     CONSTRAINT FK_AcuseIniciativa_Problem REFERENCES dbo.Problem (Codigo),
    Rol              char(2)        NOT NULL CONSTRAINT CK_AcuseIniciativa_Rol CHECK (Rol IN (''PO'', ''SO'')),
    Cuenta           nvarchar(256)  NOT NULL CONSTRAINT CK_AcuseIniciativa_Cuenta CHECK (LEN(LTRIM(RTRIM(Cuenta))) > 0),
    NombreDueno      nvarchar(4000) NOT NULL CONSTRAINT CK_AcuseIniciativa_Nombre CHECK (LEN(LTRIM(RTRIM(NombreDueno))) > 0),
    FuenteIdentidad  varchar(16)    NOT NULL CONSTRAINT CK_AcuseIniciativa_Fuente CHECK (FuenteIdentidad IN (''CORREO_CANDIDATO'')),
    EstadoIniciativa nvarchar(100)  NOT NULL,
    FechaCompromiso  date           NULL,
    FechaUtc         datetime2(0)   NOT NULL CONSTRAINT DF_AcuseIniciativa_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_AcuseIniciativa UNIQUE (Codigo, Rol, Cuenta, FechaCompromiso)
);
CREATE INDEX IX_AcuseIniciativa_Codigo ON adm.AcuseIniciativa (Codigo, FechaUtc DESC);

CREATE TABLE adm.NotificacionAdm
(
    IdNotificacion int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_NotificacionAdm PRIMARY KEY CLUSTERED,
    Tipo           varchar(10)  NOT NULL CONSTRAINT CK_NotificacionAdm_Tipo CHECK (Tipo IN (''ACUSE'')),
    IdAcuse        int          NOT NULL CONSTRAINT FK_NotificacionAdm_Acuse REFERENCES adm.AcuseIniciativa (IdAcuse),
    FechaUtc       datetime2(0) NOT NULL CONSTRAINT DF_NotificacionAdm_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_NotificacionAdm_Acuse UNIQUE (IdAcuse)
);
CREATE INDEX IX_NotificacionAdm_Fecha ON adm.NotificacionAdm (FechaUtc DESC, IdNotificacion DESC);

CREATE TABLE adm.NotificacionLectura
(
    IdNotificacion int           NOT NULL CONSTRAINT FK_NotificacionLectura_Notificacion REFERENCES adm.NotificacionAdm (IdNotificacion),
    Usuario        nvarchar(256) NOT NULL CONSTRAINT CK_NotificacionLectura_Usuario CHECK (LEN(LTRIM(RTRIM(Usuario))) > 0),
    LeidaUtc       datetime2(0)  NOT NULL CONSTRAINT DF_NotificacionLectura_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_NotificacionLectura PRIMARY KEY CLUSTERED (IdNotificacion, Usuario)
);';
EXEC sys.sp_executesql @t;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 28: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. adm.usp_Acuse_Registrar ---------- */
CREATE PROCEDURE adm.usp_Acuse_Registrar
    @Usuario          nvarchar(256),
    @Codigo           nvarchar(100),
    @Rol              char(2),
    @NombreDueno      nvarchar(4000),   -- OwnerProblem / OwnerServicio tal como lo vio el sitio
    @EstadoIniciativa nvarchar(100),    -- Estado tal como lo vio el sitio
    @FechaCompromiso  date,             -- fecha del Estado tal como la vio el sitio (NULL = sin fecha)
    @FuenteIdentidad  varchar(16) = 'CORREO_CANDIDATO',
    @IdAcuse          int          OUTPUT,
    @Nuevo            bit          OUTPUT,
    @FechaUtc         datetime2(0) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Usuario = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @Codigo = NULLIF(LTRIM(RTRIM(@Codigo)), N'');
    SET @NombreDueno = NULLIF(LTRIM(RTRIM(@NombreDueno)), N'');
    SET @IdAcuse = NULL; SET @Nuevo = 0; SET @FechaUtc = NULL;
    IF @Usuario IS NULL THROW 51301, N'Sin usuario no se registra el acuse.', 1;
    IF @Rol IS NULL OR @Rol NOT IN ('PO', 'SO') THROW 51302, N'El rol del acuse es PO o SO.', 1;
    IF @NombreDueno IS NULL THROW 51303, N'Falta el nombre del dueno con el que se autorizo.', 1;

    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado nvarchar(100), @dueno nvarchar(4000), @vig bit, @fecha date, @hay bit = 0;
            SELECT @hay = 1, @estado = p.Estado, @vig = p.VigenteEnOrigen,
                   @dueno = CASE @Rol WHEN 'PO' THEN p.OwnerProblem ELSE p.OwnerServicio END,
                   @fecha = CONVERT(date, CASE WHEN p.Estado COLLATE Latin1_General_CI_AI = N'En Analisis'  THEN p.FechaAnalisis
                                               WHEN p.Estado COLLATE Latin1_General_CI_AI = N'En Solucion'  THEN p.FechaSolucion
                                               WHEN p.Estado COLLATE Latin1_General_CI_AI = N'En Monitoreo' THEN p.FechaCierre END)
            FROM dbo.Problem AS p WITH (UPDLOCK, HOLDLOCK)
            WHERE p.Codigo = @Codigo;
            IF @hay = 0 OR ISNULL(@vig, 0) = 0
                THROW 51304, N'La iniciativa no existe o no esta vigente.', 1;
            IF ISNULL(LTRIM(RTRIM(@dueno)), N'') <> @NombreDueno
                THROW 51305, N'El dueno de ese rol cambio: vuelve a abrir la iniciativa.', 1;
            IF ISNULL(@estado, N'') <> ISNULL(@EstadoIniciativa, N'')
                THROW 51306, N'El Estado de la iniciativa cambio: vuelve a abrirla.', 1;
            -- El episodio que el sitio evaluo (fecha del Estado) tiene que ser
            -- el de ahora; NULL solo coincide con NULL. Sin NOT(...): con un
            -- NULL de un lado la comparacion daria UNKNOWN y no rechazaria.
            IF (@fecha IS NULL AND @FechaCompromiso IS NOT NULL)
               OR (@fecha IS NOT NULL AND @FechaCompromiso IS NULL)
               OR @fecha <> @FechaCompromiso
                THROW 51308, N'La fecha compromiso de la iniciativa cambio: vuelve a abrirla.', 1;

            -- El mismo episodio (misma fecha, o NULL y NULL): se devuelve el
            -- que ya esta. Ni otro acuse ni otra notificacion.
            SELECT @IdAcuse = a.IdAcuse, @FechaUtc = a.FechaUtc
            FROM adm.AcuseIniciativa AS a WITH (UPDLOCK, HOLDLOCK)
            WHERE a.Codigo = @Codigo AND a.Rol = @Rol AND a.Cuenta = @Usuario
              AND (a.FechaCompromiso = @fecha OR (a.FechaCompromiso IS NULL AND @fecha IS NULL));
            IF @IdAcuse IS NULL
            BEGIN
                INSERT adm.AcuseIniciativa (Codigo, Rol, Cuenta, NombreDueno, FuenteIdentidad, EstadoIniciativa, FechaCompromiso)
                VALUES (@Codigo, @Rol, @Usuario, @NombreDueno, @FuenteIdentidad, @estado, @fecha);
                SET @IdAcuse = CONVERT(int, SCOPE_IDENTITY());
                INSERT adm.NotificacionAdm (Tipo, IdAcuse) VALUES ('ACUSE', @IdAcuse);
                SELECT @FechaUtc = FechaUtc FROM adm.AcuseIniciativa WHERE IdAcuse = @IdAcuse;
                SET @Nuevo = 1;
            END;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @IdAcuse = NULL; SET @Nuevo = 0; SET @FechaUtc = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 28: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. adm.usp_Notificacion_MarcarLeida ---------- */
CREATE PROCEDURE adm.usp_Notificacion_MarcarLeida
    @Usuario        nvarchar(256),
    @IdNotificacion int,
    @Nueva          bit OUTPUT       -- 0 = ya estaba leida por ese usuario
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Usuario = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @Nueva = 0;
    IF @Usuario IS NULL THROW 51301, N'Sin usuario no se marca nada.', 1;

    BEGIN TRY
        BEGIN TRAN;
            IF NOT EXISTS (SELECT 1 FROM adm.NotificacionAdm WHERE IdNotificacion = @IdNotificacion)
                THROW 51307, N'La notificacion no existe.', 1;
            IF NOT EXISTS (SELECT 1 FROM adm.NotificacionLectura WITH (UPDLOCK, HOLDLOCK)
                           WHERE IdNotificacion = @IdNotificacion AND Usuario = @Usuario)
            BEGIN
                INSERT adm.NotificacionLectura (IdNotificacion, Usuario) VALUES (@IdNotificacion, @Usuario);
                SET @Nueva = 1;
            END;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @Nueva = 0;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 28: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 4. Permisos ---------- */
IF DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NOT NULL
BEGIN
    DENY INSERT, UPDATE, DELETE ON adm.AcuseIniciativa     TO [PROACTIVANETAD];
    DENY INSERT, UPDATE, DELETE ON adm.NotificacionAdm     TO [PROACTIVANETAD];
    DENY INSERT, UPDATE, DELETE ON adm.NotificacionLectura TO [PROACTIVANETAD];
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 28: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 5. Postcondicion ---------- */
DECLARE @obj int = (CASE WHEN OBJECT_ID(N'adm.AcuseIniciativa', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.NotificacionAdm', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.NotificacionLectura', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_Acuse_Registrar', N'P') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_Notificacion_MarcarLeida', N'P') IS NULL THEN 0 ELSE 1 END);
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1
                       AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.AcuseIniciativa'), OBJECT_ID(N'adm.NotificacionAdm'),
                                          OBJECT_ID(N'adm.NotificacionLectura')));
DECLARE @esperados int = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 9 END;
IF @obj = 5 AND @deny = @esperados
   AND OBJECT_ID(N'adm.UQ_AcuseIniciativa', N'UQ') IS NOT NULL AND OBJECT_ID(N'adm.UQ_NotificacionAdm_Acuse', N'UQ') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM adm.AcuseIniciativa)
BEGIN
    COMMIT;
    SELECT Migracion = N'28', Resultado = 'APLICADA', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 28: quedaron %d de 5 objetos y %d de %d DENY; ROLLBACK de todo.', 16, 1, @obj, @deny, @esperados);
END;
GO
SET NOEXEC OFF;
GO
