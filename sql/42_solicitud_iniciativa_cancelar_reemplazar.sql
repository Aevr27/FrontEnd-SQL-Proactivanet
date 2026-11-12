/* =========================================================================
   sql/42_solicitud_iniciativa_cancelar_reemplazar.sql - quien ENVIO una
   Nueva solicitud (de iniciativa) todavia ENVIADA (pendiente) la puede
   CANCELAR (con motivo) o REEMPLAZAR por otra nueva (la original queda
   CANCELADA con un evento REEMPLAZADA). Nada se borra: las dos filas y sus
   bitacoras se quedan.
                    ROLLBACK: _rollback.sql (completo, se niega si ya hay
                              canceladas / reemplazos) o
                              _rollback_procedimiento.sql (solo quita los
                              dos procedimientos; columnas, CHECK y filas
                              se quedan)
   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*,
   tools/tests/SolicitudesCancelarReemplazarSqlLocalDbSmoke.cs).

   DEPENDE DE (definiciones VIVAS medidas en LocalDB con la cadena 18-40;
   en la VM las confirma la PRECONDICION, por huella):
     adm.usp_SolicitudIniciativa_Crear          sql/36 (21 parametros)
     adm.usp_SolicitudIniciativa_Aprobar        sql/31
     adm.usp_SolicitudIniciativa_Rechazar       sql/31
     adm.usp_SolicitudIniciativa_AprobarYCrear  sql/32
     CHECK CK_SolicitudIniciativa_Estado / _Revision / _Rechazo (sql/31),
     _Codigo (sql/32) y CK_SolicitudIniciativaEvento_Evento (sql/31).
   Orden: despues de 36 (y de 32). Independiente de sql/41. sql/39 (avisos)
   no cambia: cuenta ENVIADA en vivo, asi que una CANCELADA ya no cuenta.

   QUE CAMBIA (una transaccion)
     adm.SolicitudIniciativa, columnas nuevas (NULL, sin valor por omision):
       ReemplazaA          int            FK -> adm.SolicitudIniciativa (NumeroSolicitud)
       CanceladoPor        nvarchar(256)
       FechaCancelacionUtc datetime2(0)
       MotivoCancelacion   nvarchar(2000)
     CHECK (nombres nuevos: la cuenta del sitio ve nombres, no texto):
       CK_SolicitudIniciativa_EstadoCancelada  reemplaza a CK_SolicitudIniciativa_Estado:
         Estado IN (ENVIADA, APROBADA, RECHAZADA, CANCELADA)
       CK_SolicitudIniciativa_RevisionCancelacion  reemplaza a CK_SolicitudIniciativa_Revision:
         ENVIADA  sin revision ni cancelacion (como antes, sin comentario)
         APROBADA / RECHAZADA  con revisor no vacio y fecha (como antes), sin cancelacion
         CANCELADA  sin revision ni comentario de revision; CanceladoPor =
                    SolicitanteCuenta (sin mayusculas ni espacios de mas),
                    fecha y motivo no vacio. (Sin CodigoIniciativa: ya lo
                    exige CK_SolicitudIniciativa_Codigo, que no cambia.)
       CK_SolicitudIniciativa_ReemplazaA  ReemplazaA < NumeroSolicitud (el
         numero lo da el contador, siempre creciente: sin ciclos)
       CK_SolicitudIniciativaEvento_EventoCancelada  reemplaza a
         CK_SolicitudIniciativaEvento_Evento: los 3 de antes + CANCELADA y REEMPLAZADA
     UX_SolicitudIniciativa_ReemplazaA  UNIQUE filtrado: una original se
       reemplaza una sola vez.
     adm.usp_SolicitudIniciativa_Cancelar    (nuevo)
     adm.usp_SolicitudIniciativa_Reemplazar  (nuevo; llama a Crear tal cual)
   NO cambia: Crear, Aprobar, Rechazar, AprobarYCrear, el contador, el resto
     de los CHECK, indices, filas, permisos (los DENY de sql/29 siguen;
     EXECUTE sobre adm cubre los nuevos), sql/39, nada de dbo.

   CARRERAS: Cancelar y Reemplazar toman la fila con UPDLOCK + HOLDLOCK, el
     MISMO candado que Aprobar, Rechazar y AprobarYCrear. Gana el primero:
     aprobar / rechazar una CANCELADA da 51412 (su texto dice "aprobada o
     rechazada": no se toca para no cambiar huellas); cancelar o reemplazar
     una revisada da 51421.

   ERRORES NUEVOS
     51419  falta el motivo de la cancelacion
     51420  el motivo pasa de 2000 caracteres
     51421  la solicitud ya no esta ENVIADA (aprobada, rechazada o cancelada)
     51422  Reemplazar se llamo dentro de otra transaccion
     51423  el token ya se uso en otra solicitud de la cuenta
     51424  Crear no devolvio una solicitud nueva
     51411  (el de siempre) no existe o NO es de la cuenta: no se distingue.
     51409  (el de siempre) el token es de otra cuenta.

   PRECONDICION (si no, ROLLBACK y no toca nada): las 4 huellas, 21
     parametros de Crear, Estado y Evento varchar(20), y UNO de dos estados:
       NUEVA      nada de 42 y el texto de los 5 CHECK de sql/31-32 (sin
                  espacios, corchetes ni parentesis): se aplica todo.
       REACTIVAR  despues de _rollback_procedimiento.sql: columnas, FK, indice y
                  los 4 CHECK de 42 (con su texto), sin los CHECK viejos y SIN
                  los dos procedimientos: solo se vuelven a crear (Resultado
                  REACTIVADA). Cualquier otra mezcla se niega.
   POSTCONDICION (si no, ROLLBACK): huellas de Cancelar y Reemplazar, 3 y 23
     parametros, columnas, FK, indice y CHECK de 42 confiables, sin los CHECK
     viejos, las 4 huellas de antes intactas y los 9 DENY de sql/29 (si
     existe PROACTIVANETAD).

   COMO CORRERLO (solo con OK explicito de este script)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'42';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Antes: sql/diag_migraciones_41_42.sql (solo lectura) debe decir LISTA.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'42'
BEGIN
    RAISERROR (N'Migracion 42 SIN APROBAR: declara aprobar_migracion = 42 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hCrear varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hAprobar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Aprobar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hRechazar varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Rechazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @hAyC varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @checks int = (SELECT COUNT(*) FROM sys.check_constraints AS c
    WHERE c.is_disabled = 0 AND c.is_not_trusted = 0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = CASE c.name
          WHEN N'CK_SolicitudIniciativa_Estado' THEN N'Estado=''RECHAZADA''OREstado=''APROBADA''OREstado=''ENVIADA'''
          WHEN N'CK_SolicitudIniciativa_Revision' THEN N'Estado=''ENVIADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLOREstado<>''ENVIADA''ANDRevisadoPorISNOTNULLANDlenltrimrtrimRevisadoPor>0ANDFechaRevisionUtcISNOTNULL'
          WHEN N'CK_SolicitudIniciativa_Rechazo' THEN N'Estado<>''RECHAZADA''ORComentarioRevisionISNOTNULLANDlenltrimrtrimComentarioRevision>0'
          WHEN N'CK_SolicitudIniciativa_Codigo' THEN N'CodigoIniciativaISNULLOREstado=''APROBADA''ANDlenltrimrtrimCodigoIniciativa>0'
          WHEN N'CK_SolicitudIniciativaEvento_Evento' THEN N'Evento=''RECHAZADA''OREvento=''APROBADA''OREvento=''ENVIADA'''
      END
      AND c.parent_object_id = CASE WHEN c.name = N'CK_SolicitudIniciativaEvento_Evento' THEN OBJECT_ID(N'adm.SolicitudIniciativaEvento') ELSE OBJECT_ID(N'adm.SolicitudIniciativa') END);
-- NUEVA: nada de 42 todavia. REACTIVAR: las tablas ya tienen la forma de
-- 42 (columnas, FK, indice y los 4 CHECK nuevos con su texto) y faltan SOLO
-- los dos procedimientos (despues de _rollback_procedimiento.sql): se
-- vuelven a crear y nada mas. Cualquier otra mezcla: no se toca nada.
DECLARE @nuevos int = (SELECT COUNT(*) FROM sys.check_constraints AS c
    WHERE c.is_disabled = 0 AND c.is_not_trusted = 0
      AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = CASE c.name
          WHEN N'CK_SolicitudIniciativaEvento_EventoCancelada' THEN N'Evento=''REEMPLAZADA''OREvento=''CANCELADA''OREvento=''RECHAZADA''OREvento=''APROBADA''OREvento=''ENVIADA'''
          WHEN N'CK_SolicitudIniciativa_EstadoCancelada' THEN N'Estado=''CANCELADA''OREstado=''RECHAZADA''OREstado=''APROBADA''OREstado=''ENVIADA'''
          WHEN N'CK_SolicitudIniciativa_ReemplazaA' THEN N'ReemplazaAISNULLORReemplazaA<NumeroSolicitud'
          WHEN N'CK_SolicitudIniciativa_RevisionCancelacion' THEN N'Estado=''ENVIADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''RECHAZADA''OREstado=''APROBADA''ANDRevisadoPorISNOTNULLANDlenltrimrtrimRevisadoPor>0ANDFechaRevisionUtcISNOTNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''CANCELADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLANDCanceladoPorISNOTNULLANDupperltrimrtrimCanceladoPor=upperltrimrtrimSolicitanteCuentaANDFechaCancelacionUtcISNOTNULLANDMotivoCancelacionISNOTNULLANDlenltrimrtrimMotivoCancelacion>0'
      END
      AND c.parent_object_id = CASE WHEN c.name = N'CK_SolicitudIniciativaEvento_EventoCancelada' THEN OBJECT_ID(N'adm.SolicitudIniciativaEvento') ELSE OBJECT_ID(N'adm.SolicitudIniciativa') END);
DECLARE @nombresNuevos int = (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN (N'CK_SolicitudIniciativaEvento_EventoCancelada', N'CK_SolicitudIniciativa_EstadoCancelada', N'CK_SolicitudIniciativa_ReemplazaA', N'CK_SolicitudIniciativa_RevisionCancelacion'));
DECLARE @nombresViejos int = (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN (N'CK_SolicitudIniciativa_Estado', N'CK_SolicitudIniciativa_Revision', N'CK_SolicitudIniciativaEvento_Evento'));
DECLARE @columnas int = CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') = 4 THEN 1 ELSE 0 END
                      + CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'CanceladoPor') = 512 THEN 1 ELSE 0 END
                      + CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaCancelacionUtc') IS NOT NULL THEN 1 ELSE 0 END
                      + CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'MotivoCancelacion') = 4000 THEN 1 ELSE 0 END;
DECLARE @algunaColumna int = CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') IS NOT NULL OR COL_LENGTH(N'adm.SolicitudIniciativa', N'CanceladoPor') IS NOT NULL
                                    OR COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaCancelacionUtc') IS NOT NULL OR COL_LENGTH(N'adm.SolicitudIniciativa', N'MotivoCancelacion') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @fkUx int = CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SolicitudIniciativa_ReemplazaA' AND parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND is_not_trusted = 0) THEN 1 ELSE 0 END
                  + CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_SolicitudIniciativa_ReemplazaA' AND object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND is_unique = 1 AND has_filter = 1) THEN 1 ELSE 0 END;
DECLARE @procs int = CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NULL THEN 0 ELSE 1 END + CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NULL THEN 0 ELSE 1 END;
DECLARE @modo varchar(10) = CASE
    WHEN @procs = 0 AND @algunaColumna = 0 AND @fkUx = 0 AND @nombresNuevos = 0 AND @checks = 5 THEN 'NUEVA'
    WHEN @procs = 0 AND @columnas = 4 AND @fkUx = 2 AND @nuevos = 4 AND @nombresViejos = 0 AND @checks = 2 THEN 'REACTIVAR'
END;
IF @modo IS NULL
   OR @hCrear IS NULL OR @hCrear <> 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A
   OR (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear')) <> 21
   OR @hAprobar IS NULL OR @hAprobar <> 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
   OR @hRechazar IS NULL OR @hRechazar <> 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
   OR @hAyC IS NULL OR @hAyC <> 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC
   OR COL_LENGTH(N'adm.SolicitudIniciativa', N'Estado') <> 20 OR COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Evento') <> 20
BEGIN
    ROLLBACK;
    IF @procs > 0
        RAISERROR (N'Migracion 42: ya aplicada (existe Cancelar o Reemplazar). No se toca nada.', 16, 1);
    ELSE IF @modo IS NULL AND (@algunaColumna = 1 OR @nombresNuevos > 0 OR @fkUx > 0)
        RAISERROR (N'Migracion 42: las tablas estan a medias de 42 (ni sin 42 ni con su forma completa). No se toca nada.', 16, 1);
    ELSE IF @hCrear IS NULL OR @hCrear <> 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A
        RAISERROR (N'Migracion 42: adm.usp_SolicitudIniciativa_Crear no es la de sql/36 (o no se ve su definicion). No se toca nada.', 16, 1);
    ELSE IF @hAprobar IS NULL OR @hAprobar <> 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
         OR @hRechazar IS NULL OR @hRechazar <> 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
        RAISERROR (N'Migracion 42: Aprobar o Rechazar no son los de sql/31. No se toca nada.', 16, 1);
    ELSE IF @hAyC IS NULL OR @hAyC <> 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC
        RAISERROR (N'Migracion 42: AprobarYCrear no es la de sql/32. No se toca nada.', 16, 1);
    ELSE IF @modo IS NULL
        RAISERROR (N'Migracion 42: %d de 5 CHECK (Estado, Revision, Rechazo, Codigo, Evento) tienen el texto esperado y estan confiables. No se toca nada.', 16, 1, @checks);
    ELSE
        RAISERROR (N'Migracion 42: los parametros de Crear, Estado o Evento no tienen la forma esperada. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
ELSE
    EXEC sys.sp_set_session_context N'migracion42_modo', @modo;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Columnas, FK, indice ---------- */
IF COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') IS NULL
ALTER TABLE adm.SolicitudIniciativa ADD
    ReemplazaA          int            NULL CONSTRAINT FK_SolicitudIniciativa_ReemplazaA REFERENCES adm.SolicitudIniciativa (NumeroSolicitud),
    CanceladoPor        nvarchar(256)  NULL,
    FechaCancelacionUtc datetime2(0)   NULL,
    MotivoCancelacion   nvarchar(2000) NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
IF INDEXPROPERTY(OBJECT_ID(N'adm.SolicitudIniciativa'), N'UX_SolicitudIniciativa_ReemplazaA', 'IndexID') IS NULL
CREATE UNIQUE NONCLUSTERED INDEX UX_SolicitudIniciativa_ReemplazaA
    ON adm.SolicitudIniciativa (ReemplazaA) WHERE ReemplazaA IS NOT NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. CHECK ---------- */
IF OBJECT_ID(N'adm.CK_SolicitudIniciativa_EstadoCancelada', N'C') IS NULL
BEGIN
    ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Estado;
    ALTER TABLE adm.SolicitudIniciativa WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativa_EstadoCancelada
        CHECK (Estado IN ('ENVIADA', 'APROBADA', 'RECHAZADA', 'CANCELADA'));
    ALTER TABLE adm.SolicitudIniciativa DROP CONSTRAINT CK_SolicitudIniciativa_Revision;
    -- Los IS NOT NULL van explicitos: un CHECK solo rechaza FALSE, y
    -- LEN(NULL) > 0 o UPPER(NULL) = ... son UNKNOWN (dejarian pasar un NULL).
    ALTER TABLE adm.SolicitudIniciativa WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativa_RevisionCancelacion
        CHECK ((Estado = 'ENVIADA' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL AND ComentarioRevision IS NULL
                AND CanceladoPor IS NULL AND FechaCancelacionUtc IS NULL AND MotivoCancelacion IS NULL)
            OR (Estado IN ('APROBADA', 'RECHAZADA') AND RevisadoPor IS NOT NULL AND LEN(LTRIM(RTRIM(RevisadoPor))) > 0 AND FechaRevisionUtc IS NOT NULL
                AND CanceladoPor IS NULL AND FechaCancelacionUtc IS NULL AND MotivoCancelacion IS NULL)
            OR (Estado = 'CANCELADA' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL AND ComentarioRevision IS NULL
                AND CanceladoPor IS NOT NULL AND UPPER(LTRIM(RTRIM(CanceladoPor))) = UPPER(LTRIM(RTRIM(SolicitanteCuenta)))
                AND FechaCancelacionUtc IS NOT NULL
                AND MotivoCancelacion IS NOT NULL AND LEN(LTRIM(RTRIM(MotivoCancelacion))) > 0));
    ALTER TABLE adm.SolicitudIniciativa WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativa_ReemplazaA
        CHECK (ReemplazaA IS NULL OR ReemplazaA < NumeroSolicitud);
    ALTER TABLE adm.SolicitudIniciativaEvento DROP CONSTRAINT CK_SolicitudIniciativaEvento_Evento;
    ALTER TABLE adm.SolicitudIniciativaEvento WITH CHECK ADD CONSTRAINT CK_SolicitudIniciativaEvento_EventoCancelada
        CHECK (Evento IN ('ENVIADA', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'REEMPLAZADA'));
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Cancelacion por QUIEN LA ENVIO (sql/42). @Usuario lo pone el servidor
   (la cuenta de IIS), nunca el navegador; la autorizacion de entrar la
   hace el handler. Aqui: la solicitud tiene que ser de @Usuario
   (SolicitanteCuenta, sin mayusculas ni espacios de mas) y estar ENVIADA,
   con la fila bloqueada (UPDLOCK + HOLDLOCK, el candado de Aprobar,
   Rechazar y AprobarYCrear). Otra cuenta o inexistente: 51411 (no se
   distingue). Revisada o ya cancelada: 51421. Motivo obligatorio (51419),
   hasta 2000 (51420). Guarda quien, cuando y por que, y un evento
   CANCELADA (ENVIADA -> CANCELADA). No borra nada. */
CREATE PROCEDURE adm.usp_SolicitudIniciativa_Cancelar
    @NumeroSolicitud int,
    @Usuario         nvarchar(256),
    @Motivo          nvarchar(4000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Usuario = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @Motivo  = NULLIF(LTRIM(RTRIM(@Motivo)), N'');
    IF @Usuario IS NULL THROW 51401, N'Sin usuario no se guarda la solicitud.', 1;
    IF @Motivo IS NULL THROW 51419, N'Explica por que se cancela la solicitud.', 1;
    IF LEN(@Motivo) > 2000 THROW 51420, N'El motivo de la cancelacion pasa de 2000 caracteres.', 1;
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado varchar(20), @cuenta nvarchar(256), @ahora datetime2(0) = SYSUTCDATETIME();
            SELECT @estado = Estado, @cuenta = SolicitanteCuenta
            FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK) WHERE NumeroSolicitud = @NumeroSolicitud;
            IF @estado IS NULL OR UPPER(LTRIM(RTRIM(@cuenta))) <> UPPER(@Usuario)
                THROW 51411, N'La solicitud no existe.', 1;
            IF @estado <> 'ENVIADA'
                THROW 51421, N'La solicitud ya no esta pendiente (aprobada, rechazada o cancelada): no se cancela.', 1;
            UPDATE adm.SolicitudIniciativa
               SET Estado = 'CANCELADA', CanceladoPor = @Usuario, FechaCancelacionUtc = @ahora, MotivoCancelacion = @Motivo
             WHERE NumeroSolicitud = @NumeroSolicitud AND Estado = 'ENVIADA';
            IF @@ROWCOUNT <> 1
                THROW 51421, N'La solicitud ya no esta pendiente (aprobada, rechazada o cancelada): no se cancela.', 1;
            INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoAnterior, EstadoNuevo, Usuario, FechaUtc, Detalle)
            VALUES (@NumeroSolicitud, 'CANCELADA', 'ENVIADA', 'CANCELADA', @Usuario, @ahora, @Motivo);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Reemplazo por QUIEN LA ENVIO (sql/42): una solicitud NUEVA (otro
   NumeroSolicitud, ReemplazaA = la original) y la original CANCELADA con un
   evento REEMPLAZADA ("Reemplazada por #0000123: motivo"), en UNA
   transaccion. La nueva la crea adm.usp_SolicitudIniciativa_Crear TAL CUAL
   (mismos 21 parametros): las MISMAS validaciones y la misma resolucion del
   solicitante que un envio nuevo; la aplicacion repite antes su
   autorizacion y su elegibilidad (las de enviar). La nueva sigue el flujo
   normal (ENVIADA). No hace falta que sea igual a la original.
   Reglas: la original es de @Usuario (51411 si no, como si no existiera) y
   esta ENVIADA (51421); motivo obligatorio (51419, hasta 2000: 51420).
   Idempotencia: el mismo @Token de la misma cuenta que ya reemplazo a ESTA
   original devuelve esa solicitud (@Nuevo = 0); de otra cuenta 51409; el
   token usado en otra solicitud: 51423.
   Abre su propia transaccion (51422 dentro de otra): Crear hace ROLLBACK
   en su CATCH. Candados: la fila original (UPDLOCK + HOLDLOCK, el de
   Aprobar / Rechazar / Cancelar) y luego, en Crear, el token y el
   contador. */
CREATE PROCEDURE adm.usp_SolicitudIniciativa_Reemplazar
    @ReemplazaA         int,
    @MotivoCancelacion  nvarchar(4000),
    @Usuario            nvarchar(256),
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
    @FechaUtc           datetime2(0) OUTPUT,
    @FuenteSolicitante  varchar(16)   = NULL OUTPUT,
    @NombreGuardado     nvarchar(255) = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @NumeroSolicitud = NULL; SET @Nuevo = 0; SET @FechaUtc = NULL;
    SET @FuenteSolicitante = NULL; SET @NombreGuardado = NULL;
    SET @Usuario           = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @MotivoCancelacion = NULLIF(LTRIM(RTRIM(@MotivoCancelacion)), N'');
    IF @Usuario IS NULL THROW 51401, N'Sin usuario no se guarda la solicitud.', 1;
    IF @Token IS NULL THROW 51402, N'Falta el token de la solicitud.', 1;
    IF @MotivoCancelacion IS NULL THROW 51419, N'Explica por que se cancela la solicitud.', 1;
    IF LEN(@MotivoCancelacion) > 2000 THROW 51420, N'El motivo de la cancelacion pasa de 2000 caracteres.', 1;
    IF @@TRANCOUNT > 0 THROW 51422, N'Reemplazar abre su propia transaccion: no se llama dentro de otra.', 1;
    DECLARE @nueva int, @nuevoCrear bit, @fecha datetime2(0), @fuente varchar(16), @nombre nvarchar(255);
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado varchar(20), @cuenta nvarchar(256), @ahora datetime2(0) = SYSUTCDATETIME();
            SELECT @estado = Estado, @cuenta = SolicitanteCuenta
            FROM adm.SolicitudIniciativa WITH (UPDLOCK, HOLDLOCK) WHERE NumeroSolicitud = @ReemplazaA;
            IF @estado IS NULL OR UPPER(LTRIM(RTRIM(@cuenta))) <> UPPER(@Usuario)
                THROW 51411, N'La solicitud no existe.', 1;
            -- Reintento del mismo reemplazo (doble clic, red): la misma nueva.
            DECLARE @previa int, @previaCuenta nvarchar(256), @previaReemplaza int;
            SELECT @previa = NumeroSolicitud, @previaCuenta = SolicitanteCuenta, @previaReemplaza = ReemplazaA,
                   @fecha = FechaUtc, @fuente = FuenteCorreos, @nombre = SolicitanteNombre
            FROM adm.SolicitudIniciativa WHERE Token = @Token;
            IF @previa IS NOT NULL
            BEGIN
                IF UPPER(@previaCuenta) <> UPPER(@Usuario)
                    THROW 51409, N'El token de la solicitud pertenece a otra cuenta.', 1;
                IF @previaReemplaza IS NULL OR @previaReemplaza <> @ReemplazaA
                    THROW 51423, N'El token ya se uso en otra solicitud: recarga y vuelve a intentarlo.', 1;
                COMMIT;
                SET @NumeroSolicitud = @previa; SET @Nuevo = 0; SET @FechaUtc = @fecha;
                SET @FuenteSolicitante = @fuente; SET @NombreGuardado = @nombre;
                RETURN;
            END;
            IF @estado <> 'ENVIADA'
                THROW 51421, N'La solicitud ya no esta pendiente (aprobada, rechazada o cancelada): no se reemplaza.', 1;
            EXEC adm.usp_SolicitudIniciativa_Crear
                 @Usuario = @Usuario, @Token = @Token, @TipoIniciativa = @TipoIniciativa,
                 @ProductOwner = @ProductOwner, @ServiceOwner = @ServiceOwner, @Categoria = @Categoria, @Director = @Director,
                 @Titulo = @Titulo, @Descripcion = @Descripcion, @Observaciones = @Observaciones,
                 @Volumetria = @Volumetria, @PctDisminucion = @PctDisminucion, @RcaExtension = @RcaExtension,
                 @SolicitanteNombre = @SolicitanteNombre, @SolicitanteCorreo = @SolicitanteCorreo, @ProductOwnerCorreo = @ProductOwnerCorreo,
                 @NumeroSolicitud = @nueva OUTPUT, @Nuevo = @nuevoCrear OUTPUT, @FechaUtc = @fecha OUTPUT,
                 @FuenteSolicitante = @fuente OUTPUT, @NombreGuardado = @nombre OUTPUT;
            IF @@TRANCOUNT <> 1 OR @nueva IS NULL OR ISNULL(@nuevoCrear, 0) = 0 OR @nueva <= @ReemplazaA
                THROW 51424, N'No se creo una solicitud nueva para el reemplazo: no se cancela la original.', 1;
            UPDATE adm.SolicitudIniciativa SET ReemplazaA = @ReemplazaA
             WHERE NumeroSolicitud = @nueva AND ReemplazaA IS NULL AND Estado = 'ENVIADA';
            IF @@ROWCOUNT <> 1
                THROW 51424, N'No se creo una solicitud nueva para el reemplazo: no se cancela la original.', 1;
            UPDATE adm.SolicitudIniciativa
               SET Estado = 'CANCELADA', CanceladoPor = @Usuario, FechaCancelacionUtc = @ahora, MotivoCancelacion = @MotivoCancelacion
             WHERE NumeroSolicitud = @ReemplazaA AND Estado = 'ENVIADA';
            IF @@ROWCOUNT <> 1
                THROW 51421, N'La solicitud ya no esta pendiente (aprobada, rechazada o cancelada): no se reemplaza.', 1;
            INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoAnterior, EstadoNuevo, Usuario, FechaUtc, Detalle)
            VALUES (@ReemplazaA, 'REEMPLAZADA', 'ENVIADA', 'CANCELADA', @Usuario, @ahora,
                    LEFT(N'Reemplazada por #' + RIGHT(N'0000000' + CONVERT(nvarchar(7), @nueva), 7) + N': ' + @MotivoCancelacion, 2000));
        COMMIT;
        SET @NumeroSolicitud = @nueva; SET @Nuevo = 1; SET @FechaUtc = @fecha;
        SET @FuenteSolicitante = @fuente; SET @NombreGuardado = @nombre;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @NumeroSolicitud = NULL; SET @Nuevo = 0; SET @FechaUtc = NULL;
        SET @FuenteSolicitante = NULL; SET @NombreGuardado = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 42: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- Postcondicion ---------- */
DECLARE @h42c varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @h42r varbinary(32) = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''));
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS dp
                     WHERE dp.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND dp.state = 'D'
                       AND dp.permission_name IN ('INSERT', 'UPDATE', 'DELETE')
                       AND dp.major_id IN (OBJECT_ID(N'adm.SolicitudIniciativa'), OBJECT_ID(N'adm.SolicitudIniciativaEvento'), OBJECT_ID(N'adm.SolicitudIniciativaContador')));
IF @h42c = 0x03ACC642CE1A390F1FF9EBC7D09903DA6696003184B7B0C4041AF53A79C8DE62 -- huella:adm.usp_SolicitudIniciativa_Cancelar
   AND @h42r = 0xBEA3AA16CABFB80C1DC829C9BB371BC46AA25BCC6D58E9A2E6E4FE3636B1238E -- huella:adm.usp_SolicitudIniciativa_Reemplazar
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar')) = 3
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar')) = 23
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') = 4 AND COL_LENGTH(N'adm.SolicitudIniciativa', N'CanceladoPor') = 512
   AND COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaCancelacionUtc') IS NOT NULL AND COL_LENGTH(N'adm.SolicitudIniciativa', N'MotivoCancelacion') = 4000
   AND EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SolicitudIniciativa_ReemplazaA' AND parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND is_not_trusted = 0)
   AND EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_SolicitudIniciativa_ReemplazaA' AND object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND is_unique = 1 AND has_filter = 1)
   AND (SELECT COUNT(*) FROM sys.check_constraints WHERE is_not_trusted = 0 AND is_disabled = 0
          AND name IN (N'CK_SolicitudIniciativa_EstadoCancelada', N'CK_SolicitudIniciativa_RevisionCancelacion', N'CK_SolicitudIniciativa_ReemplazaA', N'CK_SolicitudIniciativaEvento_EventoCancelada')) = 4
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_Estado', N'C') IS NULL AND OBJECT_ID(N'adm.CK_SolicitudIniciativa_Revision', N'C') IS NULL
   AND OBJECT_ID(N'adm.CK_SolicitudIniciativaEvento_Evento', N'C') IS NULL
   AND HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) = 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A
   AND HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudIniciativa_AprobarYCrear', N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')) = 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC
   AND (DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL OR @deny = 9)
BEGIN
    COMMIT;
    SELECT Script = N'Migracion 42', Resultado = CASE CONVERT(varchar(10), SESSION_CONTEXT(N'migracion42_modo')) WHEN 'REACTIVAR' THEN 'REACTIVADA' ELSE 'APLICADA' END;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 42: columnas, CHECK, indice, procedimientos o permisos no quedaron como se esperaba; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
