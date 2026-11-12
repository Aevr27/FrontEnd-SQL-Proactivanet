/* =========================================================================
   sql/verificar_check_41_42.sql - SOLO LECTURA (solo sys.check_constraints).
   Confirma que sql/41 y sql/42 reemplazaron sus CHECK por diseno: los 8
   nuevos existen en su tabla, habilitados, confiables y con el texto de la
   migracion; los 6 viejos ya no existen. Los textos esperados son los de la
   precondicion / postcondicion de sql/41 (lineas 126-129) y sql/42 (lineas
   119-122), con la misma normalizacion (sin espacios, corchetes ni
   parentesis).

   RESULTADO ESPERADO: 14 filas, todas con Resultado = OK.
     NUEVO (8)        Existe = SI, TablaReal = TablaEsperada, is_disabled = 0,
                      is_not_trusted = 0, TextoEsperado = SI.
     REEMPLAZADO (6)  Existe = NO.
   Cualquier REVISAR = un cambio a medias o a mano: avisar antes de sql/83.
   ========================================================================= */
SET NOCOUNT ON;

SELECT k.Rol,
       k.Migracion,
       k.Nombre,
       TablaEsperada = k.Tabla,
       TablaReal     = OBJECT_SCHEMA_NAME(c.parent_object_id) + N'.' + OBJECT_NAME(c.parent_object_id),
       Existe        = CASE WHEN c.object_id IS NULL THEN 'NO' ELSE 'SI' END,
       c.is_disabled,
       c.is_not_trusted,
       TextoEsperado = CASE WHEN c.object_id IS NULL OR k.Limpio IS NULL THEN NULL
                            WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'')
                                 = k.Limpio THEN 'SI'
                            ELSE 'NO' END,
       Resultado     = CASE
                           WHEN k.Rol = 'NUEVO'
                                AND c.object_id IS NOT NULL
                                AND OBJECT_SCHEMA_NAME(c.parent_object_id) + N'.' + OBJECT_NAME(c.parent_object_id) = k.Tabla
                                AND c.is_disabled = 0 AND c.is_not_trusted = 0
                                AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = k.Limpio
                               THEN 'OK'
                           WHEN k.Rol = 'REEMPLAZADO' AND c.object_id IS NULL THEN 'OK'
                           ELSE 'REVISAR'
                       END,
       c.definition
FROM (VALUES
    (N'NUEVO', '41', N'CK_SolicitudCambio_EstadoCancelada', N'adm.SolicitudCambio',
     N'Estado=''CANCELADA''OREstado=''RECHAZADA''OREstado=''APLICADA''OREstado=''PENDIENTE'''),
    (N'NUEVO', '41', N'CK_SolicitudCambio_RevisionCancelacion', N'adm.SolicitudCambio',
     N'Estado=''PENDIENTE''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''RECHAZADA''OREstado=''APLICADA''ANDRevisadoPorISNOTNULLANDFechaRevisionUtcISNOTNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''CANCELADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLANDCanceladoPorISNOTNULLANDupperltrimrtrimCanceladoPor=upperltrimrtrimSolicitadoPorANDFechaCancelacionUtcISNOTNULLANDMotivoCancelacionISNOTNULLANDlenltrimrtrimMotivoCancelacion>0'),
    (N'NUEVO', '41', N'CK_SolicitudCambio_ReemplazaA', N'adm.SolicitudCambio',
     N'ReemplazaAISNULLORReemplazaA<IdSolicitud'),
    (N'NUEVO', '41', N'CK_SolicitudCambioEvento_EventoCancelada', N'adm.SolicitudCambioEvento',
     N'Evento=''REEMPLAZADA''OREvento=''CANCELADA''OREvento=''DESACTUALIZADA''OREvento=''FALLO_APLICAR''OREvento=''RECHAZADA''OREvento=''APLICADA''OREvento=''ENVIADA'''),
    (N'NUEVO', '42', N'CK_SolicitudIniciativa_EstadoCancelada', N'adm.SolicitudIniciativa',
     N'Estado=''CANCELADA''OREstado=''RECHAZADA''OREstado=''APROBADA''OREstado=''ENVIADA'''),
    (N'NUEVO', '42', N'CK_SolicitudIniciativa_RevisionCancelacion', N'adm.SolicitudIniciativa',
     N'Estado=''ENVIADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''RECHAZADA''OREstado=''APROBADA''ANDRevisadoPorISNOTNULLANDlenltrimrtrimRevisadoPor>0ANDFechaRevisionUtcISNOTNULLANDCanceladoPorISNULLANDFechaCancelacionUtcISNULLANDMotivoCancelacionISNULLOREstado=''CANCELADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLANDCanceladoPorISNOTNULLANDupperltrimrtrimCanceladoPor=upperltrimrtrimSolicitanteCuentaANDFechaCancelacionUtcISNOTNULLANDMotivoCancelacionISNOTNULLANDlenltrimrtrimMotivoCancelacion>0'),
    (N'NUEVO', '42', N'CK_SolicitudIniciativa_ReemplazaA', N'adm.SolicitudIniciativa',
     N'ReemplazaAISNULLORReemplazaA<NumeroSolicitud'),
    (N'NUEVO', '42', N'CK_SolicitudIniciativaEvento_EventoCancelada', N'adm.SolicitudIniciativaEvento',
     N'Evento=''REEMPLAZADA''OREvento=''CANCELADA''OREvento=''RECHAZADA''OREvento=''APROBADA''OREvento=''ENVIADA'''),
    (N'REEMPLAZADO', '41', N'CK_SolicitudCambio_Estado',           N'adm.SolicitudCambio',          NULL),
    (N'REEMPLAZADO', '41', N'CK_SolicitudCambio_Revision',         N'adm.SolicitudCambio',          NULL),
    (N'REEMPLAZADO', '41', N'CK_SolicitudCambioEvento_Evento',     N'adm.SolicitudCambioEvento',    NULL),
    (N'REEMPLAZADO', '42', N'CK_SolicitudIniciativa_Estado',       N'adm.SolicitudIniciativa',      NULL),
    (N'REEMPLAZADO', '42', N'CK_SolicitudIniciativa_Revision',     N'adm.SolicitudIniciativa',      NULL),
    (N'REEMPLAZADO', '42', N'CK_SolicitudIniciativaEvento_Evento', N'adm.SolicitudIniciativaEvento', NULL)
) AS k (Rol, Migracion, Nombre, Tabla, Limpio)
LEFT JOIN sys.check_constraints AS c ON c.name = k.Nombre
ORDER BY k.Rol, k.Migracion, k.Nombre;
