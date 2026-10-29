/* =========================================================================
   sql/35_solicitud_iniciativa_solicitante_admin.sql - Nueva solicitud de
   una cuenta ADM o MOD de dbo.UsuariosAdmin que NO esta en dbo.CatPersona.
                                             ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitanteAdminSqlLocalDbSmoke.cs).

   POR QUE (2026-10-29)
     dbo.UsuariosAdmin es la fuente de quien es ADM o MOD. Con sql/29 una
     cuenta ADM/MOD sin fila vigente en CatPersona no puede guardar una
     Nueva solicitud (51405 + SolicitanteNombre NOT NULL). Diag de la VM
     2026-10-29: 4 de 6 cuentas de UsuariosAdmin (la unica MOD incluida)
     no estan en CatPersona con ningun correo.

   QUE CAMBIA (una transaccion)
     adm.SolicitudIniciativa
       SolicitanteNombre  NOT NULL -> NULL (filas existentes: sin cambio)
       CK_SolicitudIniciativa_Fuente se recrea: CATPERSONA | USUARIOSADMIN
       + CK_SolicitudIniciativa_FuenteNombre: CATPERSONA con nombre;
         USUARIOSADMIN sin nombre (no se inventa uno)
     adm.usp_SolicitudIniciativa_Crear (ALTER)
       @SolicitanteNombre CON valor: la regla de sql/29 sin cambios (correo
         de UNA fila vigente de CatPersona, 51405). PO/SO siguen aqui.
       @SolicitanteNombre NULL (nuevo): @Usuario tiene filas en
         dbo.UsuariosAdmin, TODAS con Acceso ADM o MOD (RolAdmin), y
         @SolicitanteCorreo es el UNICO CorreoUsuario de esas filas. Si no,
         51417 y nada se guarda. FuenteCorreos = 'USUARIOSADMIN'.
       El correo del PO sigue igual (UNA fila vigente de CatPersona, 51406).
     NO cambia: el resto de columnas y CHECK, el contador, las filas ni los
       eventos, los DENY de sql/29, sql/31 / sql/32 (Aprobar, Rechazar,
       crear la iniciativa), nada de dbo (CatPersona y UsuariosAdmin solo se
       LEEN).

   QUIEN Y QUE SIGUE EN PIE
     @Usuario lo pone el servidor (AccesoAdmin.IdentidadEscritura), nunca el
     navegador; el correo ADM/MOD lo lee el servidor de UsuariosAdmin
     (CorreoAdmin.Para) y aqui se vuelve a comprobar contra la tabla, en la
     transaccion. Quien puede ENVIAR lo sigue decidiendo el handler
     (AccesoIniciativas.ExigirSolicitud); aprobar y rechazar siguen siendo
     solo de ADM (sql/31 + ExigirAdm). Mismo token con otra cuenta: 51409.

   ERRORES NUEVOS (51401-51409 de sql/29, 51410-51416 de sql/31 y 32)
     51417 sin nombre de CatPersona y la cuenta no es ADM/MOD de
           dbo.UsuariosAdmin con ese CorreoUsuario unico.

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     _Crear con el hash de sql/29:
       0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
     CK_SolicitudIniciativa_Fuente = ([FuenteCorreos]='CATPERSONA'),
     SolicitanteNombre NOT NULL, sin CK_SolicitudIniciativa_FuenteNombre, y
     dbo.UsuariosAdmin con Usuario, CorreoUsuario y Acceso.
     Hash = SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni saltos de
     linea (regla de 20-25).
   POSTCONDICION (si no, ROLLBACK de todo)
     _Crear con el hash de sql/35:
       0x307A180FFC5DFD95356CF6A9F2B8868A33BE52892037819091D133B47BF1243F
     SolicitanteNombre NULL, los dos CHECK confiables, mismas filas, eventos
     y contador, todas las filas CATPERSONA con nombre, los 9 DENY.

   ORDEN
     sql/32 verifica el hash de sql/29 en _Crear: si sql/32 no esta
     aplicada, aplicarla ANTES que esta. Para deshacer 31 o 32, deshacer 35
     primero (sus rollbacks exigen el _Crear de sql/29).
     El sitio funciona con o sin esta migracion (AlmacenSolicitudesSql.
     AceptaSolicitanteAdmin): sin ella, un ADM/MOD sin CatPersona recibe
     un 422 claro y nada se guarda.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'35';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   Rollback: sql/35_solicitud_iniciativa_solicitante_admin_rollback.sql (se
   niega si ya hay alguna solicitud USUARIOSADMIN).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'35'
BEGIN
    RAISERROR (N'Migracion 35 SIN APROBAR: declara aprobar_migracion = 35 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hashCrear varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @ckFuente nvarchar(max) = (SELECT definition FROM sys.check_constraints
                               WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND name = N'CK_SolicitudIniciativa_Fuente');
IF @hashCrear IS NULL OR @hashCrear <> 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   OR ISNULL(@ckFuente, N'') <> N'([FuenteCorreos]=''CATPERSONA'')'
   OR ISNULL(COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull'), -1) <> 0
   OR OBJECT_ID(N'adm.CK_SolicitudIniciativa_FuenteNombre', N'C') IS NOT NULL
   OR OBJECT_ID(N'dbo.UsuariosAdmin', N'U') IS NULL
   OR COL_LENGTH(N'dbo.UsuariosAdmin', N'Usuario') IS NULL
   OR COL_LENGTH(N'dbo.UsuariosAdmin', N'CorreoUsuario') IS NULL
   OR COL_LENGTH(N'dbo.UsuariosAdmin', N'Acceso') IS NULL
BEGIN
    ROLLBACK;
    IF @hashCrear = 0x307A180FFC5DFD95356CF6A9F2B8868A33BE52892037819091D133B47BF1243F
        RAISERROR (N'Migracion 35: ya aplicada (_Crear con el hash de sql/35). No se toca nada.', 16, 1);
    ELSE IF @hashCrear IS NULL
        RAISERROR (N'Migracion 35: falta sql/29 (adm.usp_SolicitudIniciativa_Crear). No se toca nada.', 16, 1);
    ELSE IF OBJECT_ID(N'dbo.UsuariosAdmin', N'U') IS NULL
        RAISERROR (N'Migracion 35: falta dbo.UsuariosAdmin (Usuario, CorreoUsuario, Acceso). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 35: sql/29 no es la esperada (hash de _Crear, CHECK de FuenteCorreos o SolicitanteNombre cambiados) o 35 esta a medias. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Foto de lo que NO debe cambiar (se compara en la postcondicion). */
IF OBJECT_ID('tempdb..#antes35') IS NOT NULL DROP TABLE #antes35;
SELECT Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa),
       Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento),
       Ultimo = (SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1),
       Denegados = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento')))
INTO #antes35;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. SolicitanteNombre opcional y el origen del correo ---------- */
ALTER TABLE adm.SolicitudIniciativa ALTER COLUMN SolicitanteNombre nvarchar(255) NULL;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Fuente;
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_Fuente
    CHECK (FuenteCorreos IN ('CATPERSONA', 'USUARIOSADMIN'));
-- CATPERSONA siempre con el nombre de la persona; USUARIOSADMIN sin nombre
-- (UsuariosAdmin no lo tiene y no se arma con la cuenta).
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_FuenteNombre
    CHECK ((FuenteCorreos = 'CATPERSONA' AND SolicitanteNombre IS NOT NULL)
        OR (FuenteCorreos = 'USUARIOSADMIN' AND SolicitanteNombre IS NULL));
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. adm.usp_SolicitudIniciativa_Crear (sql/35) ---------- */
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
    @SolicitanteNombre  nvarchar(255),      -- NULL = solicitante ADM/MOD de dbo.UsuariosAdmin (sql/35)
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
       OR @SolicitanteCorreo IS NULL OR @ProductOwnerCorreo IS NULL
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

            -- Solicitante (sql/35). CON nombre: su correo es de UNA fila
            -- vigente de CatPersona (la regla de sql/29; PO/SO y quien este
            -- en CatPersona). SIN nombre: @Usuario es ADM o MOD en
            -- dbo.UsuariosAdmin (filas que existen y TODAS dicen ADM o MOD,
            -- la regla de RolAdmin) y el correo es el UNICO CorreoUsuario de
            -- esas filas. Ninguna otra cuenta se guarda sin CatPersona.
            DECLARE @fuente varchar(16);
            IF @SolicitanteNombre IS NOT NULL
            BEGIN
                IF (SELECT COUNT(*) FROM dbo.CatPersona AS p
                    WHERE p.VigenteEnOrigen = 1 AND LOWER(LTRIM(RTRIM(p.Correo))) = @SolicitanteCorreo) <> 1
                    THROW 51405, N'El correo del solicitante no es de una sola persona vigente de CatPersona.', 1;
                SET @fuente = 'CATPERSONA';
            END
            ELSE
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM dbo.UsuariosAdmin AS u
                               WHERE UPPER(LTRIM(RTRIM(u.Usuario))) = UPPER(@Usuario))
                   OR EXISTS (SELECT 1 FROM dbo.UsuariosAdmin AS u
                              WHERE UPPER(LTRIM(RTRIM(u.Usuario))) = UPPER(@Usuario)
                                AND (u.Acceso IS NULL OR UPPER(LTRIM(RTRIM(u.Acceso))) NOT IN (N'ADM', N'MOD')))
                   OR (SELECT COUNT(DISTINCT LOWER(LTRIM(RTRIM(u.CorreoUsuario)))) FROM dbo.UsuariosAdmin AS u
                       WHERE UPPER(LTRIM(RTRIM(u.Usuario))) = UPPER(@Usuario)
                         AND NULLIF(LTRIM(RTRIM(u.CorreoUsuario)), N'') IS NOT NULL) <> 1
                   OR NOT EXISTS (SELECT 1 FROM dbo.UsuariosAdmin AS u
                                  WHERE UPPER(LTRIM(RTRIM(u.Usuario))) = UPPER(@Usuario)
                                    AND LOWER(LTRIM(RTRIM(u.CorreoUsuario))) = @SolicitanteCorreo)
                    THROW 51417, N'Sin persona de CatPersona solo guarda una cuenta ADM o MOD de dbo.UsuariosAdmin con su unico CorreoUsuario.', 1;
                SET @fuente = 'USUARIOSADMIN';
            END;
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
                 @Usuario, @SolicitanteNombre, @SolicitanteCorreo, @ProductOwnerCorreo, @fuente);
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 35: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. Postcondicion ---------- */
DECLARE @hash2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
IF @hash2 = 0x307A180FFC5DFD95356CF6A9F2B8868A33BE52892037819091D133B47BF1243F
   AND COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull') = 1
   AND (SELECT COUNT(*) FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa')
          AND name IN (N'CK_SolicitudIniciativa_Fuente', N'CK_SolicitudIniciativa_FuenteNombre')
          AND is_disabled = 0 AND is_not_trusted = 0) = 2
   AND EXISTS (SELECT 1 FROM #antes35 AS a
               WHERE a.Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa)
                 AND a.Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)
                 AND ISNULL(a.Ultimo, -1) = ISNULL((SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1), -1)
                 AND a.Denegados = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento'))))
   AND NOT EXISTS (SELECT 1 FROM adm.SolicitudIniciativa WHERE FuenteCorreos <> 'CATPERSONA' OR SolicitanteNombre IS NULL)
BEGIN
    COMMIT;
    SELECT Migracion = N'35', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 35: no quedo como se esperaba (hash de _Crear, columna, CHECK, DENY o datos); ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
