/* =========================================================================
   sql/29_solicitud_iniciativa.sql - guarda la "Nueva solicitud" de Admin ->
   Iniciativas con su numero consecutivo y la foto de los correos del
   solicitante y del Product Owner.

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   Sustituye a sql/PROPUESTA_numero_solicitud.md (que nunca se aprobo): toma
   su contador de una fila y su alta atomica, y agrega la identidad del
   solicitante, el correo del PO, el token anti-duplicado y la bitacora.

   QUE CREA (una transaccion; NO altera nada que ya exista)
     adm.SolicitudIniciativaContador  una fila (Id = 1): el ultimo numero.
     adm.SolicitudIniciativa          una solicitud = un numero. Los correos
                                      son una FOTO del momento del envio:
                                      nada los vuelve a escribir.
     adm.SolicitudIniciativaEvento    bitacora (solo se agrega). Hoy solo
                                      ENVIADA; los cambios de estado que se
                                      decidan despues agregan su fila aqui.
     adm.usp_SolicitudIniciativa_Crear  unica escritura de las tres tablas.
     DENY INSERT/UPDATE/DELETE de PROACTIVANETAD sobre las tres tablas
     (db_datawriter le dejaria reescribir la foto; como sql/18 sec. 8).
   0 filas de dbo tocadas. dbo.CatPersona solo se LEE.

   ESTADO INICIAL: ENVIADA y ningun otro (CHECK). No hay revision,
   aprobacion ni transiciones definidas: cuando existan, su migracion amplia
   el CHECK y agrega su procedimiento.

   QUIEN Y QUE SE REVALIDA AQUI
     @Usuario lo pone el servidor (AccesoAdmin.IdentidadEscritura: la
     cuenta de IIS), nunca el formulario. Nombre y correo del solicitante y
     del PO los resuelve el sitio contra dbo.CatPersona
     (App_Code/SolicitudIniciativaAlta.cs, regla de IdentidadAcuse). Aqui
     se comprueba, en la transaccion, que cada correo siga siendo de UNA
     fila vigente de dbo.CatPersona (sin mayusculas ni espacios): un correo
     inventado o que ya no esta no se guarda.
     La capacidad NO se consume aqui: una solicitud no es una iniciativa
     (dbo.ProblemCategoria no cambia), asi que no hace falta bloquearla.

   DUPLICADOS
     @Token (uniqueidentifier del borrador, lo genera el navegador) es
     UNIQUE. Reenviar el mismo borrador (doble clic, respuesta perdida)
     devuelve la MISMA solicitud con @Nuevo = 0: ni otro numero ni otra
     fila. El mismo token con OTRA cuenta: 51409, nada se guarda.

   ERRORES (THROW)
     51401 sin usuario                 51402 sin token
     51403 falta un campo obligatorio  51404 volumetria o % fuera de rango
     51405 correo del solicitante no es de una fila vigente de CatPersona
     51406 correo del PO no es de una fila vigente de CatPersona
     51407 se agotaron los numeros     51408 contador sin su fila
     51409 el token es de otra cuenta

   DEPENDENCIAS
     Esquema adm (sql/18) y dbo.CatPersona (Nombre, Correo, VigenteEnOrigen).
     No depende de 19-28 ni los cambia. El sitio detecta las cuatro piezas
     (AlmacenSolicitudesSql.Disponible): sin ellas Nueva solicitud sigue
     como hoy (valida y no guarda), asi que se puede aplicar antes o despues
     del despliegue.

   PERMISOS
     PROACTIVANETAD: lee (db_datareader) y ejecuta (EXECUTE sobre adm, de
     sql/18) sin nada nuevo; el DENY de abajo le quita escribir a mano. Si el
     usuario no existe en la base (LocalDB de pruebas) el DENY se omite.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'29';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   Rollback: sql/29_solicitud_iniciativa_rollback.sql.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'29'
BEGIN
    RAISERROR (N'Migracion 29 SIN APROBAR: declara aprobar_migracion = 29 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hay int = (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaContador', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaEvento', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P') IS NULL THEN 0 ELSE 1 END);
IF @hay > 0 OR SCHEMA_ID(N'adm') IS NULL OR OBJECT_ID(N'dbo.CatPersona', N'U') IS NULL
   OR COL_LENGTH(N'dbo.CatPersona', N'Correo') IS NULL OR COL_LENGTH(N'dbo.CatPersona', N'VigenteEnOrigen') IS NULL
BEGIN
    ROLLBACK;
    IF @hay = 4
        RAISERROR (N'Migracion 29: ya aplicada. No se toca nada.', 16, 1);
    ELSE IF @hay > 0
        RAISERROR (N'Migracion 29: hay %d de 4 objetos de sql/29 (a medias o a mano). No se toca nada.', 16, 1, @hay);
    ELSE
        RAISERROR (N'Migracion 29: la base no es la esperada (falta el esquema adm o dbo.CatPersona con Correo/VigenteEnOrigen). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 29: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Tablas ---------- */
CREATE TABLE adm.SolicitudIniciativaContador
(
    Id     tinyint NOT NULL CONSTRAINT PK_SolicitudIniciativaContador PRIMARY KEY
                            CONSTRAINT CK_SolicitudIniciativaContador_Id CHECK (Id = 1),
    Ultimo int     NOT NULL CONSTRAINT CK_SolicitudIniciativaContador_Ultimo CHECK (Ultimo BETWEEN 0 AND 9999999)
);
INSERT adm.SolicitudIniciativaContador (Id, Ultimo) VALUES (1, 0);

CREATE TABLE adm.SolicitudIniciativa
(
    NumeroSolicitud    int            NOT NULL CONSTRAINT PK_SolicitudIniciativa PRIMARY KEY CLUSTERED
                                               CONSTRAINT CK_SolicitudIniciativa_Numero CHECK (NumeroSolicitud BETWEEN 1 AND 9999999),
    Token              uniqueidentifier NOT NULL CONSTRAINT UQ_SolicitudIniciativa_Token UNIQUE,
    Estado             varchar(20)    NOT NULL CONSTRAINT CK_SolicitudIniciativa_Estado CHECK (Estado IN ('ENVIADA')),
    TipoIniciativa     nvarchar(100)  NOT NULL,   -- Prefijo de dbo.CatPrefijoProblem
    ProductOwner       nvarchar(255)  NOT NULL,
    ServiceOwner       nvarchar(255)  NOT NULL,
    Categoria          nvarchar(450)  NOT NULL,   -- RUTA COMPLETA (llave de capacidad)
    Director           nvarchar(255)  NOT NULL,   -- derivado al validar
    Titulo             nvarchar(max)  NOT NULL,
    Descripcion        nvarchar(max)  NOT NULL,
    Observaciones      nvarchar(max)  NOT NULL,
    Volumetria         int            NOT NULL CONSTRAINT CK_SolicitudIniciativa_Vol CHECK (Volumetria >= 0),
    PctDisminucion     decimal(9,4)   NOT NULL CONSTRAINT CK_SolicitudIniciativa_Pct CHECK (PctDisminucion BETWEEN 0 AND 1),
    RcaExtension       nvarchar(10)   NULL,       -- solo la extension: el archivo NO se guarda (sin destino)
    -- Foto del envio. Nadie las reescribe (DENY + sin procedimiento de cambio).
    SolicitanteCuenta  nvarchar(256)  NOT NULL CONSTRAINT CK_SolicitudIniciativa_Cuenta CHECK (LEN(LTRIM(RTRIM(SolicitanteCuenta))) > 0),
    SolicitanteNombre  nvarchar(255)  NOT NULL,
    SolicitanteCorreo  nvarchar(255)  NOT NULL CONSTRAINT CK_SolicitudIniciativa_CorreoSol CHECK (SolicitanteCorreo LIKE N'_%@_%._%'),
    ProductOwnerCorreo nvarchar(255)  NOT NULL CONSTRAINT CK_SolicitudIniciativa_CorreoPo CHECK (ProductOwnerCorreo LIKE N'_%@_%._%'),
    FuenteCorreos      varchar(16)    NOT NULL CONSTRAINT CK_SolicitudIniciativa_Fuente CHECK (FuenteCorreos IN ('CATPERSONA')),
    FechaUtc           datetime2(0)   NOT NULL CONSTRAINT DF_SolicitudIniciativa_Fecha DEFAULT (SYSUTCDATETIME())
);
CREATE INDEX IX_SolicitudIniciativa_Cuenta ON adm.SolicitudIniciativa (SolicitanteCuenta, FechaUtc DESC);

CREATE TABLE adm.SolicitudIniciativaEvento
(
    IdEvento        int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_SolicitudIniciativaEvento PRIMARY KEY CLUSTERED,
    NumeroSolicitud int           NOT NULL CONSTRAINT FK_SolicitudIniciativaEvento_Solicitud
                                           REFERENCES adm.SolicitudIniciativa (NumeroSolicitud),
    Evento          varchar(20)   NOT NULL CONSTRAINT CK_SolicitudIniciativaEvento_Evento CHECK (Evento IN ('ENVIADA')),
    EstadoAnterior  varchar(20)   NULL,
    EstadoNuevo     varchar(20)   NOT NULL,
    Usuario         nvarchar(256) NOT NULL CONSTRAINT CK_SolicitudIniciativaEvento_Usuario CHECK (LEN(LTRIM(RTRIM(Usuario))) > 0),
    FechaUtc        datetime2(0)  NOT NULL CONSTRAINT DF_SolicitudIniciativaEvento_Fecha DEFAULT (SYSUTCDATETIME())
);
CREATE INDEX IX_SolicitudIniciativaEvento_Numero ON adm.SolicitudIniciativaEvento (NumeroSolicitud, IdEvento);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 29: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. adm.usp_SolicitudIniciativa_Crear ---------- */
CREATE PROCEDURE adm.usp_SolicitudIniciativa_Crear
    @Usuario            nvarchar(256),      -- IdentidadWindows.Original (la cuenta de IIS)
    @Token              uniqueidentifier,
    @TipoIniciativa     nvarchar(100),
    @ProductOwner       nvarchar(255),
    @ServiceOwner       nvarchar(255),
    @Categoria          nvarchar(450),
    @Director           nvarchar(255),
    @Titulo             nvarchar(max),
    @Descripcion        nvarchar(max),
    @Observaciones      nvarchar(max),
    @Volumetria         int,
    @PctDisminucion     decimal(9,4),
    @RcaExtension       nvarchar(10),
    @SolicitanteNombre  nvarchar(255),
    @SolicitanteCorreo  nvarchar(255),
    @ProductOwnerCorreo nvarchar(255),
    @NumeroSolicitud    int          OUTPUT,
    @Nuevo              bit          OUTPUT,
    @FechaUtc           datetime2(0) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Usuario = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @TipoIniciativa = NULLIF(LTRIM(RTRIM(@TipoIniciativa)), N'');
    SET @ProductOwner = NULLIF(LTRIM(RTRIM(@ProductOwner)), N'');
    SET @ServiceOwner = NULLIF(LTRIM(RTRIM(@ServiceOwner)), N'');
    SET @Categoria = NULLIF(LTRIM(RTRIM(@Categoria)), N'');
    SET @Director = NULLIF(LTRIM(RTRIM(@Director)), N'');
    SET @Titulo = NULLIF(LTRIM(RTRIM(@Titulo)), N'');
    SET @Descripcion = NULLIF(LTRIM(RTRIM(@Descripcion)), N'');
    SET @Observaciones = NULLIF(LTRIM(RTRIM(@Observaciones)), N'');
    SET @RcaExtension = NULLIF(LTRIM(RTRIM(@RcaExtension)), N'');
    SET @SolicitanteNombre = NULLIF(LTRIM(RTRIM(@SolicitanteNombre)), N'');
    SET @SolicitanteCorreo = LOWER(NULLIF(LTRIM(RTRIM(@SolicitanteCorreo)), N''));
    SET @ProductOwnerCorreo = LOWER(NULLIF(LTRIM(RTRIM(@ProductOwnerCorreo)), N''));
    SET @NumeroSolicitud = NULL; SET @Nuevo = 0; SET @FechaUtc = NULL;

    IF @Usuario IS NULL THROW 51401, N'Sin usuario no se guarda la solicitud.', 1;
    IF @Token IS NULL THROW 51402, N'Falta el token de la solicitud.', 1;
    IF @TipoIniciativa IS NULL OR @ProductOwner IS NULL OR @ServiceOwner IS NULL OR @Categoria IS NULL
       OR @Director IS NULL OR @Titulo IS NULL OR @Descripcion IS NULL OR @Observaciones IS NULL
       OR @SolicitanteNombre IS NULL OR @SolicitanteCorreo IS NULL OR @ProductOwnerCorreo IS NULL
        THROW 51403, N'Falta un campo obligatorio de la solicitud.', 1;
    IF @Volumetria IS NULL OR @Volumetria < 0 OR @PctDisminucion IS NULL OR @PctDisminucion < 0 OR @PctDisminucion > 1
        THROW 51404, N'La volumetria o el porcentaje estan fuera de rango.', 1;

    BEGIN TRY
        BEGIN TRAN;
            -- El mismo borrador otra vez: la misma solicitud.
            DECLARE @cuentaToken nvarchar(256);
            SELECT @NumeroSolicitud = s.NumeroSolicitud, @FechaUtc = s.FechaUtc, @cuentaToken = s.SolicitanteCuenta
            FROM adm.SolicitudIniciativa AS s WITH (UPDLOCK, HOLDLOCK)
            WHERE s.Token = @Token;
            IF @NumeroSolicitud IS NOT NULL
            BEGIN
                IF UPPER(@cuentaToken) <> UPPER(@Usuario)
                    THROW 51409, N'El token de la solicitud pertenece a otra cuenta.', 1;
                COMMIT;
                RETURN;
            END;

            -- Los correos tienen que ser de UNA fila vigente de CatPersona.
            IF (SELECT COUNT(*) FROM dbo.CatPersona AS p
                WHERE p.VigenteEnOrigen = 1 AND LOWER(LTRIM(RTRIM(p.Correo))) = @SolicitanteCorreo) <> 1
                THROW 51405, N'El correo del solicitante no es de una sola persona vigente de CatPersona.', 1;
            IF (SELECT COUNT(*) FROM dbo.CatPersona AS p
                WHERE p.VigenteEnOrigen = 1 AND LOWER(LTRIM(RTRIM(p.Correo))) = @ProductOwnerCorreo) <> 1
                THROW 51406, N'El correo del Product Owner no es de una sola persona vigente de CatPersona.', 1;

            -- UPDLOCK + HOLDLOCK: un alta a la vez toma el siguiente numero.
            DECLARE @ultimo int;
            SELECT @ultimo = c.Ultimo FROM adm.SolicitudIniciativaContador AS c WITH (UPDLOCK, HOLDLOCK) WHERE c.Id = 1;
            IF @ultimo IS NULL THROW 51408, N'El contador de solicitudes no tiene su fila.', 1;
            IF @ultimo >= 9999999 THROW 51407, N'Se agotaron los numeros de solicitud de 7 digitos.', 1;
            UPDATE adm.SolicitudIniciativaContador SET Ultimo = @ultimo + 1 WHERE Id = 1;
            SET @NumeroSolicitud = @ultimo + 1;

            INSERT adm.SolicitudIniciativa
                (NumeroSolicitud, Token, Estado, TipoIniciativa, ProductOwner, ServiceOwner, Categoria, Director,
                 Titulo, Descripcion, Observaciones, Volumetria, PctDisminucion, RcaExtension,
                 SolicitanteCuenta, SolicitanteNombre, SolicitanteCorreo, ProductOwnerCorreo, FuenteCorreos)
            VALUES
                (@NumeroSolicitud, @Token, 'ENVIADA', @TipoIniciativa, @ProductOwner, @ServiceOwner, @Categoria, @Director,
                 @Titulo, @Descripcion, @Observaciones, @Volumetria, @PctDisminucion, @RcaExtension,
                 @Usuario, @SolicitanteNombre, @SolicitanteCorreo, @ProductOwnerCorreo, 'CATPERSONA');
            INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoAnterior, EstadoNuevo, Usuario)
            VALUES (@NumeroSolicitud, 'ENVIADA', NULL, 'ENVIADA', @Usuario);
            SELECT @FechaUtc = FechaUtc FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = @NumeroSolicitud;
            SET @Nuevo = 1;
        COMMIT;   -- cualquier error: contador, solicitud y evento se revierten juntos
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @NumeroSolicitud = NULL; SET @Nuevo = 0; SET @FechaUtc = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 29: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. Permisos ---------- */
IF DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NOT NULL
BEGIN
    DENY INSERT, UPDATE, DELETE ON adm.SolicitudIniciativaContador TO [PROACTIVANETAD];
    DENY INSERT, UPDATE, DELETE ON adm.SolicitudIniciativa         TO [PROACTIVANETAD];
    DENY INSERT, UPDATE, DELETE ON adm.SolicitudIniciativaEvento   TO [PROACTIVANETAD];
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 29: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 4. Postcondicion ---------- */
DECLARE @obj int = (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaContador', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativaEvento', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P') IS NULL THEN 0 ELSE 1 END);
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1
                       AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento')));
DECLARE @esperados int = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 9 END;
IF @obj = 4 AND @deny = @esperados
   AND OBJECT_ID(N'adm.UQ_SolicitudIniciativa_Token', N'UQ') IS NOT NULL
   AND (SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1) = 0
   AND NOT EXISTS (SELECT 1 FROM adm.SolicitudIniciativa)
BEGIN
    COMMIT;
    SELECT Migracion = N'29', Resultado = 'APLICADA', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 29: quedaron %d de 4 objetos y %d de %d DENY; ROLLBACK de todo.', 16, 1, @obj, @deny, @esperados);
END;
GO
SET NOEXEC OFF;
GO
