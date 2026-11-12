/* =========================================================================
   sql/41_solicitudes_cambio_cancelar_reemplazar.sql - quien ENVIO una
   solicitud de cambio PENDIENTE la puede CANCELAR (con motivo) o
   REEMPLAZAR por otra nueva (la original queda CANCELADA con un evento
   REEMPLAZADA). Nada se borra: las dos filas y sus bitacoras se quedan.
                    ROLLBACK: _rollback.sql (completo, se niega si ya hay
                              canceladas / reemplazos) o
                              _rollback_procedimiento.sql (solo quita los
                              dos procedimientos; columnas, CHECK y filas
                              se quedan)
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitudesCancelarReemplazarSqlLocalDbSmoke.cs).

   DEPENDE DE (definiciones VIVAS medidas en LocalDB con la cadena 18-40;
   en la VM las confirma la PRECONDICION de abajo, por huella, no por el
   numero del archivo):
     adm.usp_SolicitudCambio_Crear           sql/37 o sql/38 (25 parametros)
     adm.usp_SolicitudCambio_Aplicar         sql/40 (o sql/34 si se deshizo 40)
     adm.usp_SolicitudCambio_Rechazar        sql/22
     adm.usp_SolicitudCambio_RegistrarFallo  sql/22
     CHECK CK_SolicitudCambio_Estado / _Revision / _Rechazo y
     CK_SolicitudCambioEvento_Evento con el texto de sql/22 (ninguna
     migracion posterior los cambio).
   Orden: despues de 37 (y 38 si se aplica; 38 se puede aplicar antes o
   despues de 41: 41 NO toca Crear). Independiente de sql/42.

   QUE CAMBIA (una transaccion)
     adm.SolicitudCambio, columnas nuevas (NULL, sin valor por omision):
       ReemplazaA          int            FK -> adm.SolicitudCambio (IdSolicitud)
       CanceladoPor        nvarchar(256)
       FechaCancelacionUtc datetime2(0)
       MotivoCancelacion   nvarchar(2000)
     CHECK nuevos (nombres nuevos a proposito: la cuenta del sitio ve
     nombres de CHECK, no su texto, y asi detecta 41):
       CK_SolicitudCambio_EstadoCancelada  reemplaza a CK_SolicitudCambio_Estado:
         Estado IN (PENDIENTE, APLICADA, RECHAZADA, CANCELADA)
       CK_SolicitudCambio_RevisionCancelacion  reemplaza a CK_SolicitudCambio_Revision:
         PENDIENTE  sin revision y sin cancelacion
         APLICADA / RECHAZADA  con revisor y fecha (como antes), sin cancelacion
         CANCELADA  sin revision ni comentario de revision; CanceladoPor =
                    SolicitadoPor (sin mayusculas ni espacios de mas), fecha
                    y motivo no vacio
       CK_SolicitudCambio_ReemplazaA  ReemplazaA < IdSolicitud (el reemplazo
         es posterior a la original: sin ciclos)
       CK_SolicitudCambioEvento_EventoCancelada  reemplaza a
         CK_SolicitudCambioEvento_Evento: los 5 de antes + CANCELADA y REEMPLAZADA
     UX_SolicitudCambio_ReemplazaA  UNIQUE filtrado (ReemplazaA IS NOT NULL):
       una original se reemplaza una sola vez.
     adm.usp_SolicitudCambio_Cancelar     (nuevo)
     adm.usp_SolicitudCambio_Reemplazar   (nuevo; llama a Crear tal cual)
   NO cambia: Crear, Aplicar, Rechazar, RegistrarFallo, el resto de los
     CHECK, indices, filas, permisos (los DENY de 22P siguen: el sitio solo
     escribe por procedimientos; EXECUTE sobre adm de sql/18 cubre los
     nuevos), nada de dbo.

   CARRERAS: Cancelar y Reemplazar toman la fila de la solicitud con
     UPDLOCK + HOLDLOCK, el MISMO candado que Aplicar y Rechazar (y que el
     UPDATE de RegistrarFallo). Gana el primero; el segundo ve el estado
     nuevo: Aplicar / Rechazar / RegistrarFallo de una CANCELADA dan 51202
     (su texto dice "aplicada o rechazada": no se toca para no cambiar sus
     huellas); Cancelar / Reemplazar de una revisada dan 51230.
     Orden de candados de Reemplazar: solicitud original y despues (dentro
     de Crear) dbo.Problem, el mismo orden que Aplicar.

   ERRORES NUEVOS
     51228  falta el motivo de la cancelacion
     51229  el motivo pasa de 2000 caracteres
     51230  la solicitud ya no esta PENDIENTE (aplicada, rechazada o cancelada)
     51231  Reemplazar se llamo dentro de otra transaccion
     51232  la llave ya se uso en otra solicitud de la cuenta
     51233  el reemplazo no es de la misma iniciativa (Codigo)
     51234  Crear no devolvio una solicitud nueva
     51201  (el de siempre) no existe o NO es de la cuenta: no se distingue.

   DATOS: las filas actuales no tienen las columnas nuevas (NULL) y ninguna
     esta CANCELADA: cumplen los CHECK nuevos (WITH CHECK).

   PRECONDICION (si no, ROLLBACK y no toca nada): las huellas de arriba, el
     largo de Estado (varchar(10)) y Evento (varchar(14)), y UNO de dos estados:
       NUEVA      nada de 41 y el texto de los 4 CHECK de sql/22 (sin espacios,
                  corchetes ni parentesis): se aplica todo.
       REACTIVAR  despues de _rollback_procedimiento.sql: columnas, FK, indice y
                  los 4 CHECK de 41 (con su texto), sin los CHECK viejos y SIN
                  los dos procedimientos: solo se vuelven a crear (Resultado
                  REACTIVADA). Cualquier otra mezcla se niega.
   POSTCONDICION (si no, ROLLBACK): las huellas de Cancelar y Reemplazar
     (las de abajo), 3 y 27 parametros, columnas, FK, indice y CHECK de 41
     confiables, sin los CHECK viejos, las 4 huellas de antes intactas y los
     9 DENY de 22P (si existe PROACTIVANETAD).

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'41';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Antes: sql/diag_migraciones_41_42.sql (solo lectura) debe decir LISTA.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'41'
BEGIN
    RAISERROR (N'Migracion 41 SIN APROBAR: declara aprobar_migracion = 41 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hCrear varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hAplicar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hRechazar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Rechazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hFallo varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_RegistrarFallo', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @checks int = (SELECT COUNT(*) FROM sys.check_constraints AS c
    WHERE c.is_disabled = 0 AND c.is_not_trusted = 0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = CASE c.name
          WHEN N'CK_SolicitudCambio_Estado' THEN N'Estado=''RECHAZADA''OREstado=''APLICADA''OREstado=''PENDIENTE'''
          WHEN N'CK_SolicitudCambio_Revision' THEN N'Estado=''PENDIENTE''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLOREstado<>''PENDIENTE''ANDRevisadoPorISNOTNULLANDFechaRevisionUtcISNOTNULL'
          WHEN N'CK_SolicitudCambio_Rechazo' THEN N'Estado<>''RECHAZADA''ORlenltrimrtrimComentarioRevision>0'
          WHEN N'CK_SolicitudCambioEvento_Evento' THEN N'Evento=''DESACTUALIZADA''OREvento=''FALLO_APLICAR''OREvento=''RECHAZADA''OREvento=''APLICADA''OREvento=''ENVIADA'''
      END
      AND c.parent_object_id = CASE WHEN c.name = N'CK_SolicitudCambioEvento_Evento' THEN OBJECT_ID(N'adm.SolicitudCambioEvento') ELSE OBJECT_ID(N'adm.SolicitudCambio') END);
-- NUEVA: nada de 41 todavia. REACTIVAR: las tablas ya tienen la forma de
-- 41 (columnas, FK, indice y los 4 CHECK nuevos con su texto) y faltan SOLO
-- los dos procedimientos (despues de _rollback_procedimiento.sql): se
-- vuelven a crear y nada mas. Cualquier otra mezcla: no se toca nada.
DECLARE @nuevos int = (SELECT COUNT(*) FROM sys.check_constraints AS c
    WHERE c.is_disabled = 0 AND c.is_not_trusted = 0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = CASE c.name
          WHEN N'CK_SolicitudCambioEvento_EventoCancelada' THEN N'Evento=''REEMPLAZADA''OREvento=''CANCELADA''OREvento=''DESACTUALIZADA''OREvento=''FALLO_APLICAR''OREvento=''RECHAZADA''OREvento=''APLICADA''OREvento=''ENVIADA'''
          WHEN N'CK_SolicitudCambio_EstadoCancelada' THEN N'Estado=''CANCELADA''OREstado=''RECHAZADA''OREstado=''APLICADA''OREstado=''PENDIENTE'''
          WHEN N'CK_SolicitudCambio_ReemplazaA' THEN N'ReemplazaAISNULLORReemplazaA<IdSolicitud'
          WHEN N'CK_SolicitudCambio_RevisionCancelacion' THEN N'Estado=''PENDIENTE''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''RECHAZADA''OREstado=''APLICADA''ANDRevisadoPorISNOTNULLANDFechaRevisionUtcISNOTNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''CANCELADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLANDCanceladoPorISNOTNULLANDupperltrimrtrimCanceladoPor=upperltrimrtrimSolicitadoPorANDFechaCancelacionUtcISNOTNULLANDMotivoCancelacionISNOTNULLANDlenltrimrtrimMotivoCancelacion>0'
      END
      AND c.parent_object_id = CASE WHEN c.name = N'CK_SolicitudCambioEvento_EventoCancelada' THEN OBJECT_ID(N'adm.SolicitudCambioEvento') ELSE OBJECT_ID(N'adm.SolicitudCambio') END);
DECLARE @nombresNuevos int = (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN (N'CK_SolicitudCambioEvento_EventoCancelada', N'CK_SolicitudCambio_EstadoCancelada', N'CK_SolicitudCambio_ReemplazaA', N'CK_SolicitudCambio_RevisionCancelacion'));
DECLARE @nombresViejos int = (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN (N'CK_SolicitudCambio_Estado', N'CK_SolicitudCambio_Revision', N'CK_SolicitudCambioEvento_Evento'));
DECLARE @columnas int = CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') = 4 THEN 1 ELSE 0 END
                      + CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'CanceladoPor') = 512 THEN 1 ELSE 0 END
                      + CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'FechaCancelacionUtc') IS NOT NULL THEN 1 ELSE 0 END
                      + CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'MotivoCancelacion') = 4000 THEN 1 ELSE 0 END;
DECLARE @algunaColumna int = CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') IS NOT NULL OR COL_LENGTH(N'adm.SolicitudCambio', N'CanceladoPor') IS NOT NULL
                                    OR COL_LENGTH(N'adm.SolicitudCambio', N'FechaCancelacionUtc') IS NOT NULL OR COL_LENGTH(N'adm.SolicitudCambio', N'MotivoCancelacion') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @fkUx int = CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SolicitudCambio_ReemplazaA' AND parent_object_id = OBJECT_ID(N'adm.SolicitudCambio') AND is_not_trusted = 0) THEN 1 ELSE 0 END
                  + CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_SolicitudCambio_ReemplazaA' AND object_id = OBJECT_ID(N'adm.SolicitudCambio') AND is_unique = 1 AND has_filter = 1) THEN 1 ELSE 0 END;
DECLARE @procs int = CASE WHEN OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NULL THEN 0 ELSE 1 END + CASE WHEN OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NULL THEN 0 ELSE 1 END;
DECLARE @modo varchar(10) = CASE
    WHEN @procs = 0 AND @algunaColumna = 0 AND @fkUx = 0 AND @nombresNuevos = 0 AND @checks = 4 THEN 'NUEVA'
    WHEN @procs = 0 AND @columnas = 4 AND @fkUx = 2 AND @nuevos = 4 AND @nombresViejos = 0 AND @checks = 1 THEN 'REACTIVAR'
END;
IF @modo IS NULL
   OR @hCrear IS NULL OR @hCrear NOT IN (0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642, 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F)
   OR (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear')) <> 25
   OR @hAplicar IS NULL OR @hAplicar NOT IN (0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804)
   OR @hRechazar IS NULL OR @hRechazar <> 0xFC91FF5A0C7F5F445A1EEA168C20D696DE7D3D0943499D9EC1CF604F5987EF24
   OR @hFallo IS NULL OR @hFallo <> 0x1125E2A3BD250A4EEB68703A72A55DACE9B3B43E4DCA13D3C9BD84FA35D7DB95
   OR COL_LENGTH(N'adm.SolicitudCambio', N'Estado') <> 10 OR COL_LENGTH(N'adm.SolicitudCambioEvento', N'Evento') <> 14
BEGIN
    ROLLBACK;
    IF @procs > 0
        RAISERROR (N'Migracion 41: ya aplicada (existe Cancelar o Reemplazar). No se toca nada.', 16, 1);
    ELSE IF @modo IS NULL AND (@algunaColumna = 1 OR @nombresNuevos > 0 OR @fkUx > 0)
        RAISERROR (N'Migracion 41: las tablas estan a medias de 41 (ni sin 41 ni con su forma completa). No se toca nada.', 16, 1);
    ELSE IF @hCrear IS NULL OR @hCrear NOT IN (0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642, 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F)
        RAISERROR (N'Migracion 41: adm.usp_SolicitudCambio_Crear no es la de sql/37 ni la de sql/38 (o no se ve su definicion). No se toca nada.', 16, 1);
    ELSE IF @hAplicar IS NULL OR @hAplicar NOT IN (0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804)
        RAISERROR (N'Migracion 41: adm.usp_SolicitudCambio_Aplicar no es la de sql/40 ni la de sql/34. No se toca nada.', 16, 1);
    ELSE IF @hRechazar IS NULL OR @hRechazar <> 0xFC91FF5A0C7F5F445A1EEA168C20D696DE7D3D0943499D9EC1CF604F5987EF24
         OR @hFallo IS NULL OR @hFallo <> 0x1125E2A3BD250A4EEB68703A72A55DACE9B3B43E4DCA13D3C9BD84FA35D7DB95
        RAISERROR (N'Migracion 41: Rechazar o RegistrarFallo no son los de sql/22. No se toca nada.', 16, 1);
    ELSE IF @modo IS NULL
        RAISERROR (N'Migracion 41: %d de 4 CHECK (Estado, Revision, Rechazo, Evento) tienen el texto de sql/22 y estan confiables. No se toca nada.', 16, 1, @checks);
    ELSE
        RAISERROR (N'Migracion 41: el parametro de Crear, Estado o Evento no tienen la forma esperada. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
ELSE
    EXEC sys.sp_set_session_context N'migracion41_modo', @modo;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Columnas, FK, indice ---------- */
IF COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') IS NULL
ALTER TABLE adm.SolicitudCambio ADD
    ReemplazaA          int            NULL CONSTRAINT FK_SolicitudCambio_ReemplazaA REFERENCES adm.SolicitudCambio (IdSolicitud),
    CanceladoPor        nvarchar(256)  NULL,
    FechaCancelacionUtc datetime2(0)   NULL,
    MotivoCancelacion   nvarchar(2000) NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF INDEXPROPERTY(OBJECT_ID(N'adm.SolicitudCambio'), N'UX_SolicitudCambio_ReemplazaA', 'IndexID') IS NULL
CREATE UNIQUE NONCLUSTERED INDEX UX_SolicitudCambio_ReemplazaA
    ON adm.SolicitudCambio (ReemplazaA) WHERE ReemplazaA IS NOT NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. CHECK ---------- */
IF OBJECT_ID(N'adm.CK_SolicitudCambio_EstadoCancelada', N'C') IS NULL
BEGIN
    ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_Estado;
    ALTER TABLE adm.SolicitudCambio WITH CHECK ADD CONSTRAINT CK_SolicitudCambio_EstadoCancelada
        CHECK (Estado IN ('PENDIENTE', 'APLICADA', 'RECHAZADA', 'CANCELADA'));
    ALTER TABLE adm.SolicitudCambio DROP CONSTRAINT CK_SolicitudCambio_Revision;
    -- Los IS NOT NULL van explicitos: un CHECK solo rechaza FALSE, y
    -- LEN(NULL) > 0 o UPPER(NULL) = ... son UNKNOWN (dejarian pasar un NULL).
    ALTER TABLE adm.SolicitudCambio WITH CHECK ADD CONSTRAINT CK_SolicitudCambio_RevisionCancelacion
        CHECK ((Estado = 'PENDIENTE' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL
                AND CanceladoPor IS NULL AND FechaCancelacionUtc IS NULL AND MotivoCancelacion IS NULL)
            OR (Estado IN ('APLICADA', 'RECHAZADA') AND RevisadoPor IS NOT NULL AND FechaRevisionUtc IS NOT NULL
                AND CanceladoPor IS NULL AND FechaCancelacionUtc IS NULL AND MotivoCancelacion IS NULL)
            OR (Estado = 'CANCELADA' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL AND ComentarioRevision IS NULL
                AND CanceladoPor IS NOT NULL AND UPPER(LTRIM(RTRIM(CanceladoPor))) = UPPER(LTRIM(RTRIM(SolicitadoPor)))
                AND FechaCancelacionUtc IS NOT NULL
                AND MotivoCancelacion IS NOT NULL AND LEN(LTRIM(RTRIM(MotivoCancelacion))) > 0));
    ALTER TABLE adm.SolicitudCambio WITH CHECK ADD CONSTRAINT CK_SolicitudCambio_ReemplazaA
        CHECK (ReemplazaA IS NULL OR ReemplazaA < IdSolicitud);
    ALTER TABLE adm.SolicitudCambioEvento DROP CONSTRAINT CK_SolicitudCambioEvento_Evento;
    ALTER TABLE adm.SolicitudCambioEvento WITH CHECK ADD CONSTRAINT CK_SolicitudCambioEvento_EventoCancelada
        CHECK (Evento IN ('ENVIADA', 'APLICADA', 'RECHAZADA', 'FALLO_APLICAR', 'DESACTUALIZADA', 'CANCELADA', 'REEMPLAZADA'));
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Cancelacion por QUIEN LA ENVIO (sql/41). @Usuario lo pone el servidor
   (la cuenta de IIS, AccesoAdmin.IdentidadEscritura), nunca el navegador;
   la autorizacion de entrar la hace el handler. Aqui: la solicitud tiene
   que ser de @Usuario (SolicitadoPor, sin mayusculas ni espacios de mas)
   y estar PENDIENTE, con la fila bloqueada (UPDLOCK + HOLDLOCK, el candado
   de Aplicar y Rechazar). Otra cuenta o inexistente: 51201 (no se
   distingue). Revisada o ya cancelada: 51230. Motivo obligatorio (51228),
   hasta 2000 (51229). Guarda quien, cuando y por que, y un evento
   CANCELADA. No borra nada ni toca la iniciativa. */
CREATE PROCEDURE adm.usp_SolicitudCambio_Cancelar
    @IdSolicitud int,
    @Usuario     nvarchar(256),
    @Motivo      nvarchar(4000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Usuario = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @Motivo  = NULLIF(LTRIM(RTRIM(@Motivo)), N'');
    IF @Usuario IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @Motivo IS NULL
        THROW 51228, N'Explica por que se cancela la solicitud.', 1;
    IF LEN(@Motivo) > 2000
        THROW 51229, N'El motivo de la cancelacion pasa de 2000 caracteres.', 1;
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado varchar(10), @por nvarchar(256);
            SELECT @estado = Estado, @por = SolicitadoPor
            FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK) WHERE IdSolicitud = @IdSolicitud;
            IF @estado IS NULL OR UPPER(LTRIM(RTRIM(@por))) <> UPPER(@Usuario)
                THROW 51201, N'La solicitud no existe.', 1;
            IF @estado <> 'PENDIENTE'
                THROW 51230, N'La solicitud ya no esta pendiente (aplicada, rechazada o cancelada): no se cancela.', 1;
            UPDATE adm.SolicitudCambio
               SET Estado = 'CANCELADA', CanceladoPor = @Usuario, FechaCancelacionUtc = SYSUTCDATETIME(), MotivoCancelacion = @Motivo
             WHERE IdSolicitud = @IdSolicitud AND Estado = 'PENDIENTE';
            IF @@ROWCOUNT <> 1
                THROW 51230, N'La solicitud ya no esta pendiente (aplicada, rechazada o cancelada): no se cancela.', 1;
            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@IdSolicitud, 'CANCELADA', @Usuario, @Motivo);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Reemplazo por QUIEN LA ENVIO (sql/41): una solicitud NUEVA (otro
   IdSolicitud, ReemplazaA = la original) y la original CANCELADA con un
   evento REEMPLAZADA ("Reemplazada por #N: motivo"), en UNA transaccion.
   La nueva la crea adm.usp_SolicitudCambio_Crear TAL CUAL (mismos 25
   parametros): las MISMAS validaciones y el re-chequeo de PSO de un envio
   nuevo; la aplicacion repite antes su autorizacion y su elegibilidad
   (las de "enviar"). La nueva sigue el flujo normal (PENDIENTE).
   Reglas: la original es de @Usuario (51201 si no, como si no existiera),
   esta PENDIENTE (51230) y es de la MISMA iniciativa (@Codigo, 51233);
   motivo obligatorio (51228, hasta 2000: 51229).
   Idempotencia: la misma llave de la misma cuenta que ya reemplazo a ESTA
   original devuelve esa solicitud (@Repetida = 1); la llave usada en otra
   solicitud: 51232.
   Abre su propia transaccion (51231 dentro de otra): Crear hace ROLLBACK
   en su CATCH y desharia la de quien llama. Candados: la fila original
   (UPDLOCK + HOLDLOCK, el de Aplicar / Rechazar / Cancelar) y luego, en
   Crear, dbo.Problem: el orden de Aplicar. */
CREATE PROCEDURE adm.usp_SolicitudCambio_Reemplazar
    @ReemplazaA        int,
    @MotivoCancelacion nvarchar(4000),
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
    @CambiaTitulo        bit = 0, @TituloNuevo        nvarchar(max)  = NULL,
    @CambiaOwnerProblem  bit = 0, @OwnerProblemNuevo  nvarchar(4000) = NULL,
    @CambiaOwnerServicio bit = 0, @OwnerServicioNuevo nvarchar(4000) = NULL,
    @CambiaFAnalisis     bit = 0, @FAnalisisNueva     date = NULL,
    @CambiaFSolucion     bit = 0, @FSolucionNueva     date = NULL,
    @CambiaFCierre       bit = 0, @FCierreNueva       date = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @IdSolicitud = NULL;
    SET @Repetida = 0;
    SET @Usuario           = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @MotivoCancelacion = NULLIF(LTRIM(RTRIM(@MotivoCancelacion)), N'');
    IF @Usuario IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @MotivoCancelacion IS NULL
        THROW 51228, N'Explica por que se cancela la solicitud.', 1;
    IF LEN(@MotivoCancelacion) > 2000
        THROW 51229, N'El motivo de la cancelacion pasa de 2000 caracteres.', 1;
    IF @Llave IS NULL
        THROW 51211, N'Falta la llave de la solicitud.', 1;
    IF @@TRANCOUNT > 0
        THROW 51231, N'Reemplazar abre su propia transaccion: no se llama dentro de otra.', 1;
    DECLARE @nueva int, @rep bit, @previa int, @previaReemplaza int;
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado varchar(10), @por nvarchar(256), @codigoOriginal nvarchar(100);
            SELECT @estado = Estado, @por = SolicitadoPor, @codigoOriginal = Codigo
            FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK) WHERE IdSolicitud = @ReemplazaA;
            IF @estado IS NULL OR UPPER(LTRIM(RTRIM(@por))) <> UPPER(@Usuario)
                THROW 51201, N'La solicitud no existe.', 1;
            -- Reintento del mismo reemplazo (doble clic, red): la misma nueva.
            SELECT @previa = IdSolicitud, @previaReemplaza = ReemplazaA FROM adm.SolicitudCambio
            WHERE SolicitadoPor = @Usuario AND LlaveIdempotencia = @Llave;
            IF @previa IS NOT NULL
            BEGIN
                IF @previaReemplaza IS NULL OR @previaReemplaza <> @ReemplazaA
                    THROW 51232, N'La llave ya se uso en otra solicitud: recarga y vuelve a intentarlo.', 1;
                COMMIT;
                SET @IdSolicitud = @previa;
                SET @Repetida = 1;
                RETURN;
            END;
            IF @estado <> 'PENDIENTE'
                THROW 51230, N'La solicitud ya no esta pendiente (aplicada, rechazada o cancelada): no se reemplaza.', 1;
            IF UPPER(LTRIM(RTRIM(ISNULL(@Codigo, N'')))) <> UPPER(LTRIM(RTRIM(@codigoOriginal)))
                THROW 51233, N'El reemplazo tiene que ser de la misma iniciativa que la solicitud original.', 1;
            EXEC adm.usp_SolicitudCambio_Crear
                 @Usuario = @Usuario, @Rol = @Rol, @Llave = @Llave, @Codigo = @Codigo, @Tipo = @Tipo,
                 @EstadoNuevo = @EstadoNuevo, @SubestadoNuevo = @SubestadoNuevo, @CampoFecha = @CampoFecha, @FechaNueva = @FechaNueva,
                 @Motivo = @Motivo, @Categorias = @Categorias, @IdSolicitud = @nueva OUTPUT, @Repetida = @rep OUTPUT,
                 @CambiaTitulo = @CambiaTitulo, @TituloNuevo = @TituloNuevo,
                 @CambiaOwnerProblem = @CambiaOwnerProblem, @OwnerProblemNuevo = @OwnerProblemNuevo,
                 @CambiaOwnerServicio = @CambiaOwnerServicio, @OwnerServicioNuevo = @OwnerServicioNuevo,
                 @CambiaFAnalisis = @CambiaFAnalisis, @FAnalisisNueva = @FAnalisisNueva,
                 @CambiaFSolucion = @CambiaFSolucion, @FSolucionNueva = @FSolucionNueva,
                 @CambiaFCierre = @CambiaFCierre, @FCierreNueva = @FCierreNueva;
            IF @@TRANCOUNT <> 1 OR @nueva IS NULL OR ISNULL(@rep, 0) = 1 OR @nueva <= @ReemplazaA
                THROW 51234, N'No se creo una solicitud nueva para el reemplazo: no se cancela la original.', 1;
            UPDATE adm.SolicitudCambio SET ReemplazaA = @ReemplazaA
             WHERE IdSolicitud = @nueva AND ReemplazaA IS NULL AND Estado = 'PENDIENTE';
            IF @@ROWCOUNT <> 1
                THROW 51234, N'No se creo una solicitud nueva para el reemplazo: no se cancela la original.', 1;
            UPDATE adm.SolicitudCambio
               SET Estado = 'CANCELADA', CanceladoPor = @Usuario, FechaCancelacionUtc = SYSUTCDATETIME(), MotivoCancelacion = @MotivoCancelacion
             WHERE IdSolicitud = @ReemplazaA AND Estado = 'PENDIENTE';
            IF @@ROWCOUNT <> 1
                THROW 51230, N'La solicitud ya no esta pendiente (aplicada, rechazada o cancelada): no se reemplaza.', 1;
            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@ReemplazaA, 'REEMPLAZADA', @Usuario,
                    LEFT(N'Reemplazada por #' + CONVERT(nvarchar(12), @nueva) + N': ' + @MotivoCancelacion, 2000));
        COMMIT;
        SET @IdSolicitud = @nueva;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @IdSolicitud = NULL;
        SET @Repetida = 0;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 41: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- Postcondicion ---------- */
DECLARE @h41c varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @h41r varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS dp
                     WHERE dp.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND dp.state = 'D'
                       AND dp.permission_name IN ('INSERT', 'UPDATE', 'DELETE')
                       AND dp.major_id IN (OBJECT_ID(N'adm.SolicitudCambio'), OBJECT_ID(N'adm.SolicitudCambioCategoria'), OBJECT_ID(N'adm.SolicitudCambioEvento')));
IF @h41c = 0x79C8DC9E935CE4720CC23A9D8BBDB06F8927EA06F77ACB8E377D745D148B3554 -- huella:adm.usp_SolicitudCambio_Cancelar
   AND @h41r = 0x66A1837626A021F6A170069C646DB07765BD8C179DA3C13092575FA525338880 -- huella:adm.usp_SolicitudCambio_Reemplazar
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar')) = 3
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar')) = 27
   AND COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') = 4 AND COL_LENGTH(N'adm.SolicitudCambio', N'CanceladoPor') = 512
   AND COL_LENGTH(N'adm.SolicitudCambio', N'FechaCancelacionUtc') IS NOT NULL AND COL_LENGTH(N'adm.SolicitudCambio', N'MotivoCancelacion') = 4000
   AND EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SolicitudCambio_ReemplazaA' AND parent_object_id = OBJECT_ID(N'adm.SolicitudCambio') AND is_not_trusted = 0)
   AND EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_SolicitudCambio_ReemplazaA' AND object_id = OBJECT_ID(N'adm.SolicitudCambio') AND is_unique = 1 AND has_filter = 1)
   AND (SELECT COUNT(*) FROM sys.check_constraints WHERE is_not_trusted = 0 AND is_disabled = 0
          AND name IN (N'CK_SolicitudCambio_EstadoCancelada', N'CK_SolicitudCambio_RevisionCancelacion', N'CK_SolicitudCambio_ReemplazaA', N'CK_SolicitudCambioEvento_EventoCancelada')) = 4
   AND OBJECT_ID(N'adm.CK_SolicitudCambio_Estado', N'C') IS NULL AND OBJECT_ID(N'adm.CK_SolicitudCambio_Revision', N'C') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudCambioEvento_Evento', N'C') IS NULL
   AND HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
       IN (0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642, 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F)
   AND HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
       IN (0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804)
   AND (DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL OR @deny = 9)
BEGIN
    COMMIT;
    SELECT Script = N'Migracion 41', Resultado = CASE CONVERT(varchar(10), SESSION_CONTEXT(N'migracion41_modo')) WHEN 'REACTIVAR' THEN 'REACTIVADA' ELSE 'APLICADA' END;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 41: columnas, CHECK, indice, procedimientos o permisos no quedaron como se esperaba; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
