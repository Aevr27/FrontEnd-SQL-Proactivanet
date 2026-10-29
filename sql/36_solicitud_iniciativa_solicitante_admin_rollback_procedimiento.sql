/* =========================================================================
   sql/36_solicitud_iniciativa_solicitante_admin_rollback_procedimiento.sql
   Deshace SOLO el procedimiento de sql/36: adm.usp_SolicitudIniciativa_Crear
   vuelve al texto EXACTO de sql/29 (hash 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A).
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitanteAdminPsoSqlLocalDbSmoke.cs).

   Para urgencias: no toca filas, columnas, CHECK ni funciones, asi que nada
   se pierde (tambien se quedan las solicitudes USUARIOSADMIN y las que no
   tienen nombre). El sitio deja de ver @FuenteSolicitante y vuelve a pedir
   CatPersona a todos; ADM / MOD sin CatPersona reciben 422 sin guardar.
   Volver a aplicar sql/36 funciona desde aqui.

   PRECONDICION: _Crear con el hash de sql/36 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A.

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'36';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion: si algo falla, ROLLBACK de todo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'36'
BEGIN
    RAISERROR (N'Rollback 36 (procedimiento) SIN APROBAR: declara aprobar_migracion = 36 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @h IS NULL OR @h <> 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A
BEGIN
    ROLLBACK;
    IF @h = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
        RAISERROR (N'Rollback 36 (procedimiento): _Crear ya es la de sql/29. No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Rollback 36 (procedimiento): _Crear no es la de sql/36. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 36 (procedimiento): transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 36 (procedimiento): transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 36 (procedimiento)', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 36 (procedimiento): _Crear no quedo como se esperaba; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
