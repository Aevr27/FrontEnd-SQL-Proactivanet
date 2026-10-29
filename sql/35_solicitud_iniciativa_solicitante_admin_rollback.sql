/* =========================================================================
   sql/35_solicitud_iniciativa_solicitante_admin_rollback.sql - deshace sql/35.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE HACE (una transaccion)
     _Crear vuelve al texto EXACTO de sql/29 (el lote empieza donde
     empezaba: el comentario forma parte del hash); se quita
     CK_SolicitudIniciativa_FuenteNombre; CK_SolicitudIniciativa_Fuente
     vuelve a solo CATPERSONA; SolicitanteNombre vuelve a NOT NULL.

   DATOS
     Si hay alguna solicitud USUARIOSADMIN NO se deshace: no tiene
     SolicitanteNombre y no se inventa uno. Se niega sin tocar nada.
     Antes de deshacer, el sitio deja de ofrecer el camino (lo detecta
     solo: AlmacenSolicitudesSql.AceptaSolicitanteAdmin sale false).

   ORDEN: deshacer 35 ANTES que 32 o 31 (sus rollbacks exigen el _Crear de
     sql/29).

   PRECONDICION: _Crear con el hash de sql/35
       0x307A180FFC5DFD95356CF6A9F2B8868A33BE52892037819091D133B47BF1243F
     y 0 filas USUARIOSADMIN.
   POSTCONDICION: _Crear con el hash de sql/29
       0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
     CHECK de sql/29, SolicitanteNombre NOT NULL, mismas filas, eventos,
     contador y DENY.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'35';
     y el script completo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'35'
BEGIN
    RAISERROR (N'Rollback 35 SIN APROBAR: declara aprobar_migracion = 35 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hashCrear varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @admin int = 0;
IF @hashCrear = 0x307A180FFC5DFD95356CF6A9F2B8868A33BE52892037819091D133B47BF1243F
    -- UPDLOCK + HOLDLOCK: nadie guarda una USUARIOSADMIN mientras se decide.
    SELECT @admin = COUNT(*) FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK)
    WHERE FuenteCorreos <> 'CATPERSONA' OR SolicitanteNombre IS NULL;
IF @hashCrear IS NULL OR @hashCrear <> 0x307A180FFC5DFD95356CF6A9F2B8868A33BE52892037819091D133B47BF1243F OR @admin > 0
BEGIN
    ROLLBACK;
    IF @admin > 0
        RAISERROR (N'Rollback 35: hay %d solicitud(es) USUARIOSADMIN sin nombre; no se deshace. No se toca nada.', 16, 1, @admin);
    ELSE IF @hashCrear = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
        RAISERROR (N'Rollback 35: sql/35 no esta aplicada (_Crear ya es el de sql/29). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 35: _Crear no es el de sql/35 (no aplicada o cambiada a mano). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('tempdb..#antes35r') IS NOT NULL DROP TABLE #antes35r;
SELECT Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa),
       Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento),
       Ultimo = (SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1),
       Denegados = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento')))
INTO #antes35r;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. adm.usp_SolicitudIniciativa_Crear ---------- */
ALTER PROCEDURE adm.usp_SolicitudIniciativa_Crear
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_FuenteNombre;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Fuente;
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_Fuente
    CHECK (FuenteCorreos IN ('CATPERSONA'));
ALTER TABLE adm.SolicitudIniciativa ALTER COLUMN SolicitanteNombre nvarchar(255) NOT NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
DECLARE @hash2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @hash2 = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   AND COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull') = 0
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_FuenteNombre', N'C') IS NULL
   AND (SELECT definition FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND name = N'CK_SolicitudIniciativa_Fuente'
          AND is_disabled = 0 AND is_not_trusted = 0) = N'([FuenteCorreos]=''CATPERSONA'')'
   AND EXISTS (SELECT 1 FROM #antes35r AS a
               WHERE a.Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa)
                 AND a.Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)
                 AND ISNULL(a.Ultimo, -1) = ISNULL((SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1), -1)
                 AND a.Denegados = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento'))))
BEGIN
    COMMIT;
    SELECT Rollback_ = N'35', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 35: no quedo como sql/29 (hash, columna, CHECK, DENY o datos); ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
