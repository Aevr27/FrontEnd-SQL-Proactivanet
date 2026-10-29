/* =========================================================================
   sql/36_solicitud_iniciativa_solicitante_admin_rollback.sql - deshace
   sql/36 COMPLETA.
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitanteAdminPsoSqlLocalDbSmoke.cs).

   QUE HACE (una transaccion)
     _Crear vuelve al texto EXACTO de sql/29 (0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A);
     se quita CK_SolicitudIniciativa_FuenteNombre; CK_SolicitudIniciativa_Fuente
     vuelve a CATPERSONA; SolicitanteNombre vuelve a NOT NULL; se quitan
     adm.fn_ClaveNombre y adm.fn_ClaveCorreo.

   SE NIEGA, sin tocar nada, si:
     - _Crear no es la de sql/36 ni la de sql/29;
     - otro objeto usa las funciones (sql/37: deshacer 37 antes);
     - hay solicitudes USUARIOSADMIN o sin nombre: no caben en la tabla de
       sql/29 (NOT NULL y el CHECK viejo). Que hacer con ellas es otra
       decision; mientras, usar _rollback_procedimiento.sql.
   ORDEN: deshacer 37 antes que 36, y 36 antes que 35 (y que 31 / 32).

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'36';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion: si algo falla, ROLLBACK de todo.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'36'
BEGIN
    RAISERROR (N'Rollback 36 SIN APROBAR: declara aprobar_migracion = 36 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @h varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @usa nvarchar(300) = (SELECT TOP (1) OBJECT_SCHEMA_NAME(d.referencing_id) + N'.' + OBJECT_NAME(d.referencing_id)
                              FROM sys.sql_expression_dependencies AS d
                              WHERE d.referenced_id IN (OBJECT_ID(N'adm.fn_ClaveCorreo', N'FN'), OBJECT_ID(N'adm.fn_ClaveNombre', N'FN'))
                                AND d.referencing_id NOT IN (OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P'),
                                                             OBJECT_ID(N'adm.fn_ClaveCorreo', N'FN'), OBJECT_ID(N'adm.fn_ClaveNombre', N'FN'))
                              ORDER BY 1);
DECLARE @filas int = (SELECT COUNT(*) FROM adm.SolicitudIniciativa WITH (TABLOCKX, HOLDLOCK)
                      WHERE FuenteCorreos <> 'CATPERSONA' OR SolicitanteNombre IS NULL);
IF @h IS NULL OR @h NOT IN (0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A, 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A) OR NOT (OBJECT_ID(N'adm.fn_ClaveCorreo', N'FN') IS NOT NULL AND OBJECT_ID(N'adm.fn_ClaveNombre', N'FN') IS NOT NULL) OR NOT (OBJECT_ID(N'adm.CK_SolicitudIniciativa_FuenteNombre', N'C') IS NOT NULL AND COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull') = 1) OR @usa IS NOT NULL OR @filas > 0
BEGIN
    ROLLBACK;
    IF @h IS NULL OR @h NOT IN (0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A, 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A)
        RAISERROR (N'Rollback 36: _Crear no es la de sql/36 ni la de sql/29. No se toca nada.', 16, 1);
    ELSE IF NOT (OBJECT_ID(N'adm.fn_ClaveCorreo', N'FN') IS NOT NULL AND OBJECT_ID(N'adm.fn_ClaveNombre', N'FN') IS NOT NULL) OR NOT (OBJECT_ID(N'adm.CK_SolicitudIniciativa_FuenteNombre', N'C') IS NOT NULL AND COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull') = 1)
        RAISERROR (N'Rollback 36: sql/36 no esta aplicada (faltan funciones, columna nula o CHECK). No se toca nada.', 16, 1);
    ELSE IF @usa IS NOT NULL
        RAISERROR (N'Rollback 36: %s usa las funciones de sql/36; deshaz sql/37 antes. No se toca nada.', 16, 1, @usa);
    ELSE
        RAISERROR (N'Rollback 36: %d solicitud(es) USUARIOSADMIN o sin nombre no caben en la tabla de sql/29. No se toca nada (usa _rollback_procedimiento.sql).', 16, 1, @filas);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 36: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
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
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 36: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_FuenteNombre;
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Fuente;
ALTER TABLE adm.SolicitudIniciativa ALTER COLUMN SolicitanteNombre nvarchar(255) NOT NULL;
ALTER TABLE adm.SolicitudIniciativa WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativa_Fuente CHECK (FuenteCorreos IN ('CATPERSONA'));
DROP FUNCTION adm.fn_ClaveNombre;
DROP FUNCTION adm.fn_ClaveCorreo;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Rollback 36: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   AND OBJECT_ID(N'adm.fn_ClaveCorreo') IS NULL AND OBJECT_ID(N'adm.fn_ClaveNombre') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_FuenteNombre', N'C') IS NULL AND COLUMNPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'SolicitanteNombre', 'AllowsNull') = 0
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_Fuente', N'C') IS NOT NULL
BEGIN
    COMMIT;
    SELECT Script = N'Rollback 36', Resultado = 'DESHECHA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Rollback 36: _Crear, funciones, columna o CHECK no quedo como se esperaba; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
