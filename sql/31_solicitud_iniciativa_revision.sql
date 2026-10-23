/* =========================================================================
   sql/31_solicitud_iniciativa_revision.sql - ADM aprueba o rechaza una
   Nueva solicitud (sql/29). Pestaña Solicitudes -> "Iniciativas".
                                             ROLLBACK: _rollback.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/RevisionSolicitudesIniciativaSqlLocalDbSmoke.cs).

   DECISIONES (2026-10-23)
     APROBADA = aprobada para que ADM cree la iniciativa A MANO (Administracion
       -> Crear). Aprobar NO crea ni toca ninguna iniciativa (dbo no cambia).
     Comentario: opcional al aprobar, obligatorio al rechazar.
     ADM puede revisar las suyas (fase de pruebas, como sql/22).
     APROBADA y RECHAZADA son finales: no se reabren ni se revierten.
     Sin correos ni avisos.

   QUE CAMBIA (una transaccion)
     adm.SolicitudIniciativa
       + RevisadoPor nvarchar(256) NULL, FechaRevisionUtc datetime2(0) NULL,
         ComentarioRevision nvarchar(4000) NULL   (filas existentes: NULL)
       CK_SolicitudIniciativa_Estado  se recrea: ENVIADA | APROBADA | RECHAZADA
       + CK_SolicitudIniciativa_Revision  ENVIADA sin revision; revisada con
                                          revisor y fecha
       + CK_SolicitudIniciativa_Rechazo   RECHAZADA con comentario
     adm.SolicitudIniciativaEvento
       + Detalle nvarchar(2000) NULL (el comentario; eventos existentes: NULL)
       CK_SolicitudIniciativaEvento_Evento se recrea: ENVIADA | APROBADA | RECHAZADA
     + adm.usp_SolicitudIniciativa_Aprobar   (@Comentario opcional)
     + adm.usp_SolicitudIniciativa_Rechazar  (@Comentario obligatorio)
       Las dos: candado UPDLOCK + HOLDLOCK en la fila, solo desde ENVIADA,
       estado + revisor + fecha + comentario y el evento en la MISMA
       transaccion y con la MISMA fecha. Dos revisores a la vez: uno gana,
       el otro recibe 51412 y no deja evento.
     NO cambia: adm.usp_SolicitudIniciativa_Crear, el contador, las filas ni
       los eventos que ya existen, los otros CHECK, los DENY de sql/29, nada
       de dbo ni de sql/22 (Cambios).

   PERMISOS: sin GRANT nuevo. La cuenta del sitio (PROACTIVANETAD) ejecuta los
     procedimientos con el EXECUTE sobre el esquema adm de sql/18 (el mismo
     con el que ejecuta _Crear) y sigue sin poder escribir las tablas a mano
     (DENY de sql/29). Quien revisa (@Revisor) lo pone el servidor
     (AccesoAdmin.IdentidadEscritura), nunca el navegador; que sea ADM lo
     decide el handler (AccesoAdmin.ExigirAdm), como en sql/22.

   ERRORES NUEVOS (51401-51409 son de sql/29)
     51410 sin revisor     51411 no existe
     51412 ya revisada (APROBADA o RECHAZADA)
     51413 rechazo sin motivo

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     adm.usp_SolicitudIniciativa_Crear con el hash de sql/29:
       0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
     CK_SolicitudIniciativa_Estado = ([Estado]='ENVIADA') y
     CK_SolicitudIniciativaEvento_Evento = ([Evento]='ENVIADA'), sin las
     columnas ni los procedimientos de 31. Hash = SHA2_256 de
     OBJECT_DEFINITION sin espacios, tabs ni saltos de linea (regla de 20-25).
   POSTCONDICION (si no, ROLLBACK de todo)
     _Crear con el mismo hash; 4 columnas, 2 procedimientos y 5 CHECK de 31;
     mismas filas, eventos y contador que antes; todas las filas ENVIADA sin
     revision; los 9 DENY de sql/29 (si existe PROACTIVANETAD).

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'31';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   Rollback: sql/31_solicitud_iniciativa_revision_rollback.sql (se niega si
   ya hay alguna solicitud revisada).
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'31'
BEGIN
    RAISERROR (N'Migracion 31 SIN APROBAR: declara aprobar_migracion = 31 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hashCrear varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @ckEstado nvarchar(max) = (SELECT definition FROM sys.check_constraints
                                   WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND name = N'CK_SolicitudIniciativa_Estado');
DECLARE @ckEvento nvarchar(max) = (SELECT definition FROM sys.check_constraints
                                   WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativaEvento') AND name = N'CK_SolicitudIniciativaEvento_Evento');
DECLARE @piezas31 int = (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'RevisadoPor') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaRevisionUtc') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'ComentarioRevision') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Detalle') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P') IS NULL THEN 0 ELSE 1 END)
                      + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P') IS NULL THEN 0 ELSE 1 END);
IF @hashCrear IS NULL OR @hashCrear <> 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   OR OBJECT_ID(N'adm.SolicitudIniciativaContador', N'U') IS NULL
   OR ISNULL(@ckEstado, N'') <> N'([Estado]=''ENVIADA'')'
   OR ISNULL(@ckEvento, N'') <> N'([Evento]=''ENVIADA'')'
   OR @piezas31 > 0
BEGIN
    ROLLBACK;
    IF @piezas31 = 6
        RAISERROR (N'Migracion 31: ya aplicada (columnas y procedimientos de sql/31). No se toca nada.', 16, 1);
    ELSE IF @piezas31 > 0
        RAISERROR (N'Migracion 31: hay %d de 6 piezas de sql/31 (a medias o a mano). No se toca nada.', 16, 1, @piezas31);
    ELSE IF @hashCrear IS NULL
        RAISERROR (N'Migracion 31: falta sql/29 (adm.usp_SolicitudIniciativa_Crear). Aplica sql/29 antes. No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 31: sql/29 no es la esperada (hash de _Crear o CHECK de Estado / Evento cambiados). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Foto de lo que NO debe cambiar (se compara en la postcondicion). */
IF OBJECT_ID('tempdb..#antes31') IS NOT NULL DROP TABLE #antes31;
SELECT Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa),
       Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento),
       Ultimo = (SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1)
INTO #antes31;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Columnas de la revision ---------- */
ALTER TABLE adm.SolicitudIniciativa ADD
    RevisadoPor        nvarchar(256)  NULL,
    FechaRevisionUtc   datetime2(0)   NULL,
    ComentarioRevision nvarchar(4000) NULL;
ALTER TABLE adm.SolicitudIniciativaEvento ADD
    Detalle            nvarchar(2000) NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. CHECK: estados y revision ---------- */
ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Estado;
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_Estado
    CHECK (Estado IN ('ENVIADA', 'APROBADA', 'RECHAZADA'));
-- ENVIADA: sin revision. Revisada: con revisor (no vacio) y fecha.
-- Los IS NOT NULL van explicitos: un CHECK solo rechaza FALSE, y
-- LEN(NULL) > 0 es UNKNOWN (dejaria pasar un revisor o un motivo NULL).
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_Revision
    CHECK ((Estado = 'ENVIADA' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL AND ComentarioRevision IS NULL)
        OR (Estado <> 'ENVIADA' AND RevisadoPor IS NOT NULL AND LEN(LTRIM(RTRIM(RevisadoPor))) > 0 AND FechaRevisionUtc IS NOT NULL));
ALTER TABLE adm.SolicitudIniciativa ADD CONSTRAINT CK_SolicitudIniciativa_Rechazo
    CHECK (Estado <> 'RECHAZADA' OR (ComentarioRevision IS NOT NULL AND LEN(LTRIM(RTRIM(ComentarioRevision))) > 0));
ALTER TABLE adm.SolicitudIniciativaEvento DROP CONSTRAINT CK_SolicitudIniciativaEvento_Evento;
ALTER TABLE adm.SolicitudIniciativaEvento ADD CONSTRAINT CK_SolicitudIniciativaEvento_Evento
    CHECK (Evento IN ('ENVIADA', 'APROBADA', 'RECHAZADA'));
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. adm.usp_SolicitudIniciativa_Aprobar ---------- */
/* ADM aprueba una solicitud ENVIADA para crear la iniciativa a mano. No
   toca dbo. @Revisor lo pone el servidor; @Comentario es opcional. */
CREATE PROCEDURE adm.usp_SolicitudIniciativa_Aprobar
    @NumeroSolicitud  int,
    @Revisor          nvarchar(256),
    @Comentario       nvarchar(4000) = NULL,
    @FechaRevisionUtc datetime2(0) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Revisor    = NULLIF(LTRIM(RTRIM(@Revisor)), N'');
    SET @Comentario = NULLIF(LTRIM(RTRIM(@Comentario)), N'');
    SET @FechaRevisionUtc = NULL;
    IF @Revisor IS NULL THROW 51410, N'Falta el usuario que revisa: no se guarda nada sin atribucion.', 1;
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado varchar(20), @ahora datetime2(0) = SYSUTCDATETIME();
            SELECT @estado = Estado FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK) WHERE NumeroSolicitud = @NumeroSolicitud;
            IF @estado IS NULL THROW 51411, N'La solicitud no existe.', 1;
            IF @estado <> 'ENVIADA' THROW 51412, N'La solicitud ya fue revisada (aprobada o rechazada).', 1;
            UPDATE adm.SolicitudIniciativa
               SET Estado = 'APROBADA', RevisadoPor = @Revisor, FechaRevisionUtc = @ahora, ComentarioRevision = @Comentario
             WHERE NumeroSolicitud = @NumeroSolicitud AND Estado = 'ENVIADA';
            IF @@ROWCOUNT <> 1 THROW 51412, N'La solicitud ya fue revisada (aprobada o rechazada).', 1;
            INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoAnterior, EstadoNuevo, Usuario, FechaUtc, Detalle)
            VALUES (@NumeroSolicitud, 'APROBADA', 'ENVIADA', 'APROBADA', @Revisor, @ahora, LEFT(@Comentario, 2000));
            SET @FechaRevisionUtc = @ahora;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @FechaRevisionUtc = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 4. adm.usp_SolicitudIniciativa_Rechazar ---------- */
/* ADM rechaza una solicitud ENVIADA, con su motivo. No toca dbo. */
CREATE PROCEDURE adm.usp_SolicitudIniciativa_Rechazar
    @NumeroSolicitud  int,
    @Revisor          nvarchar(256),
    @Comentario       nvarchar(4000),
    @FechaRevisionUtc datetime2(0) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Revisor    = NULLIF(LTRIM(RTRIM(@Revisor)), N'');
    SET @Comentario = NULLIF(LTRIM(RTRIM(@Comentario)), N'');
    SET @FechaRevisionUtc = NULL;
    IF @Revisor IS NULL THROW 51410, N'Falta el usuario que revisa: no se guarda nada sin atribucion.', 1;
    IF @Comentario IS NULL THROW 51413, N'Explica por que se rechaza.', 1;
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado varchar(20), @ahora datetime2(0) = SYSUTCDATETIME();
            SELECT @estado = Estado FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK) WHERE NumeroSolicitud = @NumeroSolicitud;
            IF @estado IS NULL THROW 51411, N'La solicitud no existe.', 1;
            IF @estado <> 'ENVIADA' THROW 51412, N'La solicitud ya fue revisada (aprobada o rechazada).', 1;
            UPDATE adm.SolicitudIniciativa
               SET Estado = 'RECHAZADA', RevisadoPor = @Revisor, FechaRevisionUtc = @ahora, ComentarioRevision = @Comentario
             WHERE NumeroSolicitud = @NumeroSolicitud AND Estado = 'ENVIADA';
            IF @@ROWCOUNT <> 1 THROW 51412, N'La solicitud ya fue revisada (aprobada o rechazada).', 1;
            INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoAnterior, EstadoNuevo, Usuario, FechaUtc, Detalle)
            VALUES (@NumeroSolicitud, 'RECHAZADA', 'ENVIADA', 'RECHAZADA', @Revisor, @ahora, LEFT(@Comentario, 2000));
            SET @FechaRevisionUtc = @ahora;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @FechaRevisionUtc = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 31: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 5. Postcondicion ---------- */
DECLARE @hash2 varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
            OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')),
            N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1 AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativaContador'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                          OBJECT_ID(N'adm.SolicitudIniciativaEvento')));
DECLARE @esperados int = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 9 END;
IF @hash2 = 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A
   AND @deny = @esperados
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'RevisadoPor') IS NOT NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaRevisionUtc') IS NOT NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'ComentarioRevision') IS NOT NULL
   AND COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Detalle') IS NOT NULL
   AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P') IS NOT NULL
   AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P') IS NOT NULL
   AND (SELECT COUNT(*) FROM sys.check_constraints
        WHERE name IN (N'CK_SolicitudIniciativa_Estado', N'CK_SolicitudIniciativa_Revision', N'CK_SolicitudIniciativa_Rechazo',
                       N'CK_SolicitudIniciativaEvento_Evento')
          AND parent_object_id IN (OBJECT_ID(N'adm.SolicitudIniciativa'), OBJECT_ID(N'adm.SolicitudIniciativaEvento'))
          AND is_disabled = 0 AND is_not_trusted = 0) = 4
   AND EXISTS (SELECT 1 FROM #antes31 AS a
               WHERE a.Solicitudes = (SELECT COUNT(*) FROM adm.SolicitudIniciativa)
                 AND a.Eventos = (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)
                 AND ISNULL(a.Ultimo, -1) = ISNULL((SELECT Ultimo FROM adm.SolicitudIniciativaContador WHERE Id = 1), -1))
   AND NOT EXISTS (SELECT 1 FROM adm.SolicitudIniciativa
                   WHERE Estado <> 'ENVIADA' OR RevisadoPor IS NOT NULL OR FechaRevisionUtc IS NOT NULL OR ComentarioRevision IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM adm.SolicitudIniciativaEvento WHERE Evento <> 'ENVIADA' OR Detalle IS NOT NULL)
BEGIN
    COMMIT;
    SELECT Migracion = N'31', Resultado = 'APLICADA', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 31: no quedo como se esperaba (hash de _Crear, DENY, columnas, procedimientos, CHECK o datos); ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
