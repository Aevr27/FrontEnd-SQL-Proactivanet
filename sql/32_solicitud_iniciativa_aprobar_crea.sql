/* =========================================================================
   sql/32_solicitud_iniciativa_aprobar_crea.sql - Aprobar una Nueva
   solicitud CREA la iniciativa (adm.usp_GestionAdmin_Crear de sql/27) y
   liga su Codigo a la solicitud, todo en una transaccion.
                                             ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/AprobarCreaIniciativaSqlLocalDbSmoke.cs).

   POR QUE
     sql/31 (decision 2026-10-23) dejo APROBADA = "ADM la crea a mano en
     Administracion -> Crear": _Aprobar solo cambia el estado. Ahora aprobar
     debe crear la iniciativa y devolver su Codigo, sin dejar nunca una
     APROBADA sin iniciativa ni una iniciativa sin aprobacion. La solicitud
     no tiene donde guardar el Codigo (sql/29 + 31), y sin eso un reintento
     no puede saber que ya se creo: hace falta una columna.

   QUE CAMBIA (una transaccion)
     adm.SolicitudIniciativa
       + CodigoIniciativa nvarchar(100) NULL     (filas existentes: NULL)
       + CK_SolicitudIniciativa_Codigo           con Codigo solo si APROBADA
       + UX_SolicitudIniciativa_CodigoIniciativa UNIQUE filtrado (NOT NULL):
                                                 una iniciativa, una solicitud
     + adm.usp_SolicitudIniciativa_AprobarYCrear
         Candado UPDLOCK + HOLDLOCK en la fila de la solicitud, y en la MISMA
         transaccion: EXEC adm.usp_GestionAdmin_Crear (sin copiar nada de
         ella: validaciones, tope, candado y emision del Codigo, TicketsReduce
         y proteccion son los suyos) con los valores GUARDADOS de la
         solicitud; luego APROBADA + revisor + fecha + comentario + Codigo y
         el evento APROBADA. Cualquier error: ROLLBACK de todo (ni iniciativa
         ni aprobacion ni evento).
         Lo que NO esta en la solicitud lo manda el sitio, ya validado con
         ValidadorGestionAdmin como en Crear: Clasificacion y Agrupacion
         (TiposPorPrefijo del prefijo GUARDADO; aqui se exige que @Prefijo
         sea el de la solicitud), el Estado inicial que ADM elige al aprobar
         (NULL = sin estado, Incompleta: la regla de Crear) y @Hoy.
     NO cambia: _Crear / _Aprobar / _Rechazar de sql/29 y 31,
       adm.usp_GestionAdmin_Crear (hash de sql/27), permisos, las filas,
       eventos ni contador, nada de dbo.
     adm.usp_SolicitudIniciativa_Aprobar (sql/31, aprueba SIN crear) se
       queda: el sitio deja de llamarla. NO se le pone DENY EXECUTE: la
       cuenta del sitio dejaria de VER el procedimiento (OBJECT_ID = NULL sin
       permiso) y la deteccion de sql/31 del sitio (revision_disponible,
       RevisorSolicitudesIniciativaSql.Disponible) apagaria aprobar Y
       rechazar. Quitarla es otra decision (y otra migracion).

   TRANSACCIONES (revisado contra el texto de sql/27)
     _AprobarYCrear abre la transaccion. Crear hace BEGIN TRAN / COMMIT
     anidados (@@TRANCOUNT 2 -> 1: su COMMIT no confirma nada; confirma el
     COMMIT de aqui). Sus sp_getapplock son LockOwner = 'Transaction': el
     candado del Codigo dura hasta el COMMIT de aqui, asi que el siguiente
     emisor ve este Codigo. Si Crear falla, su CATCH hace ROLLBACK (de TODO,
     @@TRANCOUNT 0) y THROW: el CATCH de aqui ya no tiene nada que deshacer
     y relanza el mismo error (51xxx de Crear). Probado en LocalDB.
     Orden de candados: fila de la solicitud -> adm.proteccion (S) ->
     adm.codigo:<prefijo>:<anio> (X). Nadie toma esos applocks y despues la
     fila de una solicitud: no hay ciclo.

   REINTENTOS Y CONCURRENCIA
     APROBADA con Codigo: devuelve ESE Codigo con @Nueva = 0 (doble clic,
       respuesta perdida, dos ADM a la vez: el segundo espera el candado y
       recibe el mismo Codigo). Nunca crea otra.
     APROBADA sin Codigo (aprobada con sql/31, p. ej. la #0000002): 51414.
       No se reprocesa ni se crea nada: se resuelve aparte, a mano.
     RECHAZADA: 51412 (final, como sql/31).

   ERRORES NUEVOS (51410-51413 son de sql/31)
     51414 aprobada antes de sql/32, sin iniciativa ligada
     51415 el prefijo del alta no es el de la solicitud guardada
     51416 Crear no devolvio Codigo (no deberia pasar)
     (los nombres de variables de T-SQL no distinguen mayusculas: el estado
     de la solicitud es @estadoSolicitud, no @estado, que chocaria con
     @Estado)
     Los de adm.usp_GestionAdmin_Crear (51001-51029) suben tal cual.

   PERMISOS: sin GRANT ni DENY nuevo. PROACTIVANETAD ejecuta el procedimiento con el
     EXECUTE sobre el esquema adm de sql/18; Crear y las tablas por
     encadenamiento de propietario (mismo dueno, como _Crear de sql/29). Que
     sea ADM lo decide el handler (AccesoAdmin.ExigirAdm); el revisor lo pone
     el servidor (AccesoAdmin.IdentidadEscritura).

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     adm.usp_GestionAdmin_Crear         = sql/27
       0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
       (el de la VM, diagnostico 2026-10-26)
     adm.usp_SolicitudIniciativa_Crear  = sql/29
       0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
     adm.usp_SolicitudIniciativa_Aprobar / _Rechazar = sql/31
       0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
       0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
     Los tres que escriben adm.SolicitudIniciativa con QUOTED_IDENTIFIER y
     ANSI_NULLS ON (el indice filtrado los exige; si no, sus INSERT/UPDATE
     fallarian despues de aplicar).
     Sin piezas de sql/32. Hash = SHA2_256 de OBJECT_DEFINITION sin
     espacios, tabs ni saltos de linea (regla de 20-31).
   POSTCONDICION (si no, ROLLBACK de todo)
     Las 4 piezas; los 4 hashes de arriba IGUALES; mismas filas, eventos y
     contador; ninguna fila con Codigo; los 9 DENY de sql/29 (si existe
     PROACTIVANETAD) y ningun permiso sobre _Aprobar.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'32';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   Rollback: sql/32_solicitud_iniciativa_aprobar_crea_rollback.sql (se niega
   si ya hay alguna solicitud con Codigo ligado).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'32'
BEGIN
    RAISERROR (N'Migracion 32 SIN APROBAR: declara aprobar_migracion = 32 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hGestion varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hCrear varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hAprobar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hRechazar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @piezas32 int = (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'CodigoIniciativa') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN OBJECT_ID(N'adm.CK_SolicitudIniciativa_Codigo', N'C') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN INDEXPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'UX_SolicitudIniciativa_CodigoIniciativa', 'IndexID') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P') IS NULL THEN 0 ELSE 1 END);
DECLARE @opciones int = (SELECT COUNT(*) FROM sys.sql_modules
                         WHERE object_id IN (OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P'),
                                             OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P'),
                                             OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P'))
                           AND uses_quoted_identifier = 1 AND uses_ansi_nulls = 1);
IF @piezas32 > 0
   OR @hGestion IS NULL OR @hGestion <> 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
   OR @hCrear IS NULL OR @hCrear <> 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   OR @hAprobar IS NULL OR @hAprobar <> 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
   OR @hRechazar IS NULL OR @hRechazar <> 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
   OR @opciones <> 3
BEGIN
    ROLLBACK;
    IF @piezas32 = 4
        RAISERROR (N'Migracion 32: ya aplicada (columna, CHECK, indice y procedimiento de sql/32). No se toca nada.', 16, 1);
    ELSE IF @piezas32 > 0
        RAISERROR (N'Migracion 32: hay %d de 4 piezas de sql/32 (a medias o a mano). No se toca nada.', 16, 1, @piezas32);
    ELSE IF @hGestion IS NULL OR @hGestion <> 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
        RAISERROR (N'Migracion 32: adm.usp_GestionAdmin_Crear no es la de sql/27. No se toca nada.', 16, 1);
    ELSE IF @hAprobar IS NULL OR @hRechazar IS NULL
        RAISERROR (N'Migracion 32: falta sql/31 (_Aprobar / _Rechazar). Aplica sql/31 antes. No se toca nada.', 16, 1);
    ELSE IF @opciones <> 3
        RAISERROR (N'Migracion 32: un procedimiento de sql/29 o 31 se creo sin QUOTED_IDENTIFIER / ANSI_NULLS ON (el indice filtrado lo romperia). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 32: sql/29 o sql/31 no son las esperadas (hash de _Crear, _Aprobar o _Rechazar cambiado). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Foto de lo que NO debe cambiar (se compara en la postcondicion). */
IF OBJECT_ID('tempdb..#antes32') IS NOT NULL DROP TABLE #antes32;
SELECT Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa),
       Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento),
       Ultimo = (SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1),
       Estados = (SELECT CHECKSUM_AGG(CHECKSUM(NumeroSolicitud, Estado, RevisadoPor, FechaRevisionUtc)) FROM adm.SolicitudIniciativa)
INTO #antes32;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Columna, CHECK e indice ---------- */
ALTER TABLE adm.SolicitudIniciativa ADD CodigoIniciativa nvarchar(100) NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
-- Solo una APROBADA lleva Codigo, y no vacio. Una APROBADA SIN Codigo sigue
-- valiendo: las aprobadas con sql/31 (antes de esta) no tienen iniciativa.
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_Codigo
    CHECK (CodigoIniciativa IS NULL OR (Estado = 'APROBADA' AND LEN(LTRIM(RTRIM(CodigoIniciativa))) > 0));
CREATE UNIQUE NONCLUSTERED INDEX UX_SolicitudIniciativa_CodigoIniciativa
    ON adm.SolicitudIniciativa (CodigoIniciativa) WHERE CodigoIniciativa IS NOT NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. adm.usp_SolicitudIniciativa_AprobarYCrear ---------- */
CREATE PROCEDURE adm.usp_SolicitudIniciativa_AprobarYCrear
    @NumeroSolicitud  int,
    @Revisor          nvarchar(256),
    @Comentario       nvarchar(4000) = NULL,
    -- Lo que la solicitud no guarda; el sitio lo valida antes (Crear lo
    -- vuelve a validar). @Prefijo tiene que ser el de la solicitud.
    @Prefijo          nvarchar(10),
    @TipoIniciativa   nvarchar(100),
    @TipoAgrupado     nvarchar(100),
    @Estado           nvarchar(100),
    @Hoy              date = NULL,
    @CodigoIniciativa nvarchar(100) OUTPUT,
    @Nueva            bit OUTPUT,
    @RevisadoPor      nvarchar(256) OUTPUT,
    @FechaRevisionUtc datetime2(0) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Revisor    = NULLIF(LTRIM(RTRIM(@Revisor)), N'');
    SET @Comentario = NULLIF(LTRIM(RTRIM(@Comentario)), N'');
    SET @Prefijo    = UPPER(NULLIF(LTRIM(RTRIM(@Prefijo)), N''));
    SET @CodigoIniciativa = NULL; SET @Nueva = 0; SET @RevisadoPor = NULL; SET @FechaRevisionUtc = NULL;
    IF @Revisor IS NULL THROW 51410, N'Falta el usuario que revisa: no se guarda nada sin atribucion.', 1;
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estadoSolicitud varchar(20), @codigoPrevio nvarchar(100), @revisorPrevio nvarchar(256), @fechaPrevia datetime2(0),
                    @tipo nvarchar(100), @po nvarchar(255), @so nvarchar(255), @categoria nvarchar(450),
                    @titulo nvarchar(max), @descripcion nvarchar(max), @observaciones nvarchar(max),
                    @volumetria int, @pct decimal(9,4);
            SELECT @estadoSolicitud = Estado, @codigoPrevio = CodigoIniciativa, @revisorPrevio = RevisadoPor, @fechaPrevia = FechaRevisionUtc,
                   @tipo = TipoIniciativa, @po = ProductOwner, @so = ServiceOwner, @categoria = Categoria,
                   @titulo = Titulo, @descripcion = Descripcion, @observaciones = Observaciones,
                   @volumetria = Volumetria, @pct = PctDisminucion
            FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK)
            WHERE NumeroSolicitud = @NumeroSolicitud;
            IF @estadoSolicitud IS NULL THROW 51411, N'La solicitud no existe.', 1;
            -- Ya aprobada CON su iniciativa: la misma, nunca otra.
            IF @estadoSolicitud = 'APROBADA' AND @codigoPrevio IS NOT NULL
            BEGIN
                COMMIT;
                SELECT @CodigoIniciativa = @codigoPrevio, @Nueva = 0, @RevisadoPor = @revisorPrevio, @FechaRevisionUtc = @fechaPrevia;
                RETURN;
            END;
            IF @estadoSolicitud = 'APROBADA'
                THROW 51414, N'La solicitud se aprobo antes de que aprobar creara la iniciativa y no tiene iniciativa ligada. Aqui no se crea: se resuelve aparte.', 1;
            IF @estadoSolicitud <> 'ENVIADA' THROW 51412, N'La solicitud ya fue revisada (aprobada o rechazada).', 1;
            IF @Prefijo IS NULL OR @Prefijo <> UPPER(LTRIM(RTRIM(@tipo)))
                THROW 51415, N'El tipo de la iniciativa no es el de la solicitud guardada: no se crea nada.', 1;

            -- La categoria y su % de la solicitud: la misma fraccion 0-1.
            DECLARE @categorias adm.CategoriaPctTipo;
            INSERT @categorias (Categoria, Pct) VALUES (@categoria, @pct);

            -- La alta de Administracion -> Crear, tal cual: valida, revisa el
            -- tope, emite el Codigo y protege la iniciativa. Su transaccion
            -- queda anidada en esta (ver encabezado). Fecha de entrega del
            -- analisis: la de Crear por omision (hoy). Subestado: sin elegir.
            DECLARE @codigo nvarchar(100);
            EXEC adm.usp_GestionAdmin_Crear
                 @Usuario = @Revisor, @Prefijo = @Prefijo, @TipoIniciativa = @TipoIniciativa, @TipoAgrupado = @TipoAgrupado,
                 @Estado = @Estado, @Titulo = @titulo, @Descripcion = @descripcion, @Observaciones = @observaciones,
                 @FechaEntregaAnalisis = NULL, @Categorias = @categorias, @Hoy = @Hoy,
                 @OwnerProblem = @po, @OwnerServicio = @so, @VolumetriaOriginal = @volumetria, @Subestado = NULL,
                 @Codigo = @codigo OUTPUT;
            IF @codigo IS NULL THROW 51416, N'La alta no devolvio el Codigo: no se aprueba.', 1;

            DECLARE @ahora datetime2(0) = SYSUTCDATETIME();
            UPDATE adm.SolicitudIniciativa
               SET Estado = 'APROBADA', RevisadoPor = @Revisor, FechaRevisionUtc = @ahora, ComentarioRevision = @Comentario,
                   CodigoIniciativa = @codigo
             WHERE NumeroSolicitud = @NumeroSolicitud AND Estado = 'ENVIADA';
            IF @@ROWCOUNT <> 1 THROW 51412, N'La solicitud ya fue revisada (aprobada o rechazada).', 1;
            INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoAnterior, EstadoNuevo, Usuario, FechaUtc, Detalle)
            VALUES (@NumeroSolicitud, 'APROBADA', 'ENVIADA', 'APROBADA', @Revisor, @ahora, LEFT(@Comentario, 2000));
        COMMIT;
        SELECT @CodigoIniciativa = @codigo, @Nueva = 1, @RevisadoPor = @Revisor, @FechaRevisionUtc = @ahora;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @CodigoIniciativa = NULL, @Nueva = 0, @RevisadoPor = NULL, @FechaRevisionUtc = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 32: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. Postcondicion ---------- */
DECLARE @hGestion2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_GestionAdmin_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hCrear2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hAprobar2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hRechazar2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento')));
DECLARE @denyAprobar int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                            WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                              AND p.class = 1 AND p.major_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar'));
DECLARE @hay bit = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 1 END;
IF @hGestion2 = 0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD
   AND @hCrear2 = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   AND @hAprobar2 = 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
   AND @hRechazar2 = 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
   AND @deny = CASE WHEN @hay = 1 THEN 9 ELSE 0 END
   AND @denyAprobar = 0
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'CodigoIniciativa') IS NOT NULL
   AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_SolicitudIniciativa_Codigo'
               AND parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND is_disabled = 0 AND is_not_trusted = 0)
   AND EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'adm.SolicitudIniciativa')
               AND name = N'UX_SolicitudIniciativa_CodigoIniciativa' AND is_unique = 1 AND has_filter = 1)
   AND EXISTS (SELECT 1 FROM sys.sql_modules WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P')
               AND uses_quoted_identifier = 1 AND uses_ansi_nulls = 1)
   AND EXISTS (SELECT 1 FROM #antes32 AS a
               WHERE a.Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa)
                 AND a.Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)
                 AND ISNULL(a.Ultimo, -1) = ISNULL((SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1), -1)
                 AND ISNULL(a.Estados, 0) = ISNULL((SELECT CHECKSUM_AGG(CHECKSUM(NumeroSolicitud, Estado, RevisadoPor, FechaRevisionUtc)) FROM adm.SolicitudIniciativa), 0))
   AND NOT EXISTS (SELECT 1 FROM adm.SolicitudIniciativa WHERE CodigoIniciativa IS NOT NULL)
BEGIN
    COMMIT;
    SELECT Migracion = N'32', Resultado = 'APLICADA', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 32: no quedo como se esperaba (hashes, DENY, columna, CHECK, indice, procedimiento o datos); ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
