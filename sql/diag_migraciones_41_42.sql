/* =========================================================================
   sql/diag_migraciones_41_42.sql - DIAGNOSTICO DE SOLO LECTURA: se pueden
   aplicar sql/41 (cancelar / reemplazar solicitudes de cambio) y sql/42
   (lo mismo para Nuevas solicitudes de iniciativa) en esta base?

   SOLO SELECT sobre vistas de catalogo, OBJECT_DEFINITION y conteos. Sin
   EXEC, sin DDL/DML, sin tablas temporales, sin transacciones, sin SET que
   cambie la sesion. Revisa lo MISMO que la precondicion de cada migracion
   (que de todos modos se vuelve a revisar al correrla).

   PERMISOS: las huellas necesitan VIEW DEFINITION (db_owner basta); sin el,
   OBJECT_DEFINITION da NULL y la fila dice "SIN VIEW DEFINITION".

   COMO CORRERLO (en la VM, cuenta con db_owner, p. ej. t_andresvr):
     sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -E -W -s "|" -i sql\diag_migraciones_41_42.sql
   o en SSMS con el script completo. Pegar el resultado completo.

   Veredicto por migracion: LISTA (se aplica todo), REACTIVAR (despues de su
   _rollback_procedimiento: solo recrea los procedimientos), YA APLICADA, o
   NO (con cada condicion que falla en el bloque de detalle).
   ========================================================================= */
SET NOCOUNT ON;

SELECT [0] = 'Contexto', Base = DB_NAME(), Servidor = @@SERVERNAME, Version = CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion')),
       Cuenta = SUSER_SNAME(), EsDbOwner = IS_ROLEMEMBER('db_owner'),
       VeDefiniciones = CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Crear')) IS NULL THEN 0 ELSE 1 END,
       Collation = CONVERT(nvarchar(100), DATABASEPROPERTYEX(DB_NAME(), 'Collation'));

/* A Huellas de lo que 41 / 42 usan (no lo cambian). */
SELECT [A] = 'Huella', Objeto = h.Objeto, h.Hash, Esperada = k.Esperada,
       Ok = CASE WHEN h.Hash IS NULL THEN 'SIN VIEW DEFINITION' WHEN CHARINDEX(CONVERT(varchar(66), h.Hash, 1), k.Esperada) > 0 THEN 'SI' ELSE 'NO' END
FROM (VALUES
    (N'adm.usp_SolicitudCambio_Crear',              '41', 'sql/37 0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642 o sql/38 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F'),
    (N'adm.usp_SolicitudCambio_Aplicar',            '41', 'sql/40 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB o sql/34 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804'),
    (N'adm.usp_SolicitudCambio_Rechazar',           '41', 'sql/22 0xFC91FF5A0C7F5F445A1EEA168C20D696DE7D3D0943499D9EC1CF604F5987EF24'),
    (N'adm.usp_SolicitudCambio_RegistrarFallo',     '41', 'sql/22 0x1125E2A3BD250A4EEB68703A72A55DACE9B3B43E4DCA13D3C9BD84FA35D7DB95'),
    (N'adm.usp_SolicitudIniciativa_Crear',          '42', 'sql/36 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A'),
    (N'adm.usp_SolicitudIniciativa_Aprobar',        '42', 'sql/31 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906'),
    (N'adm.usp_SolicitudIniciativa_Rechazar',       '42', 'sql/31 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416'),
    (N'adm.usp_SolicitudIniciativa_AprobarYCrear',  '42', 'sql/32 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC')
    ) AS k (Objeto, Migracion, Esperada)
CROSS APPLY (SELECT Objeto = k.Objeto + N' (' + k.Migracion + N')',
                    Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(k.Objeto, N'P')), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h;

/* B CHECK que 41 / 42 reemplazan o necesitan (texto sin espacios, corchetes ni parentesis). */
SELECT [B] = 'CHECK', k.Nombre, k.Migracion,
       Existe = CASE WHEN c.object_id IS NULL THEN 'NO' ELSE 'SI' END,
       Confiable = CASE WHEN c.object_id IS NULL THEN NULL WHEN c.is_not_trusted = 0 AND c.is_disabled = 0 THEN 'SI' ELSE 'NO' END,
       TextoEsperado = CASE WHEN c.object_id IS NULL THEN NULL
                            WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'') = k.Limpio THEN 'SI' ELSE 'NO' END,
       c.definition
FROM (VALUES
    (N'CK_SolicitudCambio_Estado', '41', N'Estado=''RECHAZADA''OREstado=''APLICADA''OREstado=''PENDIENTE'''),
    (N'CK_SolicitudCambio_Revision', '41', N'Estado=''PENDIENTE''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLOREstado<>''PENDIENTE''ANDRevisadoPorISNOTNULLANDFechaRevisionUtcISNOTNULL'),
    (N'CK_SolicitudCambio_Rechazo', '41', N'Estado<>''RECHAZADA''ORlenltrimrtrimComentarioRevision>0'),
    (N'CK_SolicitudCambioEvento_Evento', '41', N'Evento=''DESACTUALIZADA''OREvento=''FALLO_APLICAR''OREvento=''RECHAZADA''OREvento=''APLICADA''OREvento=''ENVIADA'''),
    (N'CK_SolicitudIniciativa_Estado', '42', N'Estado=''RECHAZADA''OREstado=''APROBADA''OREstado=''ENVIADA'''),
    (N'CK_SolicitudIniciativa_Revision', '42', N'Estado=''ENVIADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLOREstado<>''ENVIADA''ANDRevisadoPorISNOTNULLANDlenltrimrtrimRevisadoPor>0ANDFechaRevisionUtcISNOTNULL'),
    (N'CK_SolicitudIniciativa_Rechazo', '42', N'Estado<>''RECHAZADA''ORComentarioRevisionISNOTNULLANDlenltrimrtrimComentarioRevision>0'),
    (N'CK_SolicitudIniciativa_Codigo', '42', N'CodigoIniciativaISNULLOREstado=''APROBADA''ANDlenltrimrtrimCodigoIniciativa>0'),
    (N'CK_SolicitudIniciativaEvento_Evento', '42', N'Evento=''RECHAZADA''OREvento=''APROBADA''OREvento=''ENVIADA''')
    ) AS k (Nombre, Migracion, Limpio)
LEFT JOIN sys.check_constraints AS c ON c.name = k.Nombre;

/* C Lo que 41 / 42 crean (debe NO existir para LISTA). */
SELECT [C] = 'De 41/42', k.Objeto, k.Migracion,
       Existe = CASE WHEN k.Existe = 1 THEN 'SI' ELSE 'NO' END
FROM (VALUES
    (N'adm.SolicitudCambio.ReemplazaA', '41', CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') IS NULL THEN 0 ELSE 1 END),
    (N'adm.SolicitudCambio.CanceladoPor / FechaCancelacionUtc / MotivoCancelacion', '41',
        CASE WHEN COALESCE(COL_LENGTH(N'adm.SolicitudCambio', N'CanceladoPor'), COL_LENGTH(N'adm.SolicitudCambio', N'FechaCancelacionUtc'), COL_LENGTH(N'adm.SolicitudCambio', N'MotivoCancelacion')) IS NULL THEN 0 ELSE 1 END),
    (N'CK_SolicitudCambio_EstadoCancelada / _RevisionCancelacion / _ReemplazaA / CK_SolicitudCambioEvento_EventoCancelada', '41',
        CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name IN (N'CK_SolicitudCambio_EstadoCancelada', N'CK_SolicitudCambio_RevisionCancelacion', N'CK_SolicitudCambio_ReemplazaA', N'CK_SolicitudCambioEvento_EventoCancelada')) THEN 1 ELSE 0 END),
    (N'adm.usp_SolicitudCambio_Cancelar / _Reemplazar', '41',
        CASE WHEN OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NULL THEN 0 ELSE 1 END),
    (N'adm.SolicitudIniciativa.ReemplazaA', '42', CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') IS NULL THEN 0 ELSE 1 END),
    (N'adm.SolicitudIniciativa.CanceladoPor / FechaCancelacionUtc / MotivoCancelacion', '42',
        CASE WHEN COALESCE(COL_LENGTH(N'adm.SolicitudIniciativa', N'CanceladoPor'), COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaCancelacionUtc'), COL_LENGTH(N'adm.SolicitudIniciativa', N'MotivoCancelacion')) IS NULL THEN 0 ELSE 1 END),
    (N'CK_SolicitudIniciativa_EstadoCancelada / _RevisionCancelacion / _ReemplazaA / CK_SolicitudIniciativaEvento_EventoCancelada', '42',
        CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name IN (N'CK_SolicitudIniciativa_EstadoCancelada', N'CK_SolicitudIniciativa_RevisionCancelacion', N'CK_SolicitudIniciativa_ReemplazaA', N'CK_SolicitudIniciativaEvento_EventoCancelada')) THEN 1 ELSE 0 END),
    (N'adm.usp_SolicitudIniciativa_Cancelar / _Reemplazar', '42',
        CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NULL THEN 0 ELSE 1 END)
    ) AS k (Objeto, Migracion, Existe);

/* D Forma de columnas, parametros y permisos. */
SELECT [D] = 'Forma',
       EstadoCambio = COL_LENGTH(N'adm.SolicitudCambio', N'Estado'), EsperadoEstadoCambio = 10,
       EventoCambio = COL_LENGTH(N'adm.SolicitudCambioEvento', N'Evento'), EsperadoEventoCambio = 14,
       EstadoIni = COL_LENGTH(N'adm.SolicitudIniciativa', N'Estado'), EsperadoEstadoIni = 20,
       EventoIni = COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Evento'), EsperadoEventoIni = 20,
       ParamsCrearCambio = (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear')), EsperadoParamsCrearCambio = 25,
       ParamsCrearIni = (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear')), EsperadoParamsCrearIni = 21,
       DenyCambio = (SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND state = 'D'
                       AND major_id IN (OBJECT_ID(N'adm.SolicitudCambio'), OBJECT_ID(N'adm.SolicitudCambioCategoria'), OBJECT_ID(N'adm.SolicitudCambioEvento'))), EsperadoDenyCambio = 9,
       DenyIni = (SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND state = 'D'
                       AND major_id IN (OBJECT_ID(N'adm.SolicitudIniciativa'), OBJECT_ID(N'adm.SolicitudIniciativaEvento'), OBJECT_ID(N'adm.SolicitudIniciativaContador'))), EsperadoDenyIni = 9,
       ExecuteAdm = (SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND class = 3
                       AND major_id = SCHEMA_ID(N'adm') AND permission_name = 'EXECUTE' AND state IN ('G', 'W')), EsperadoExecuteAdm = 1;

/* E Datos por estado (contexto; 41 / 42 no los cambian). */
SELECT [E] = 'Cambios', Estado, Filas = COUNT(*) FROM adm.SolicitudCambio GROUP BY Estado
UNION ALL
SELECT 'Iniciativas', Estado, COUNT(*) FROM adm.SolicitudIniciativa GROUP BY Estado
ORDER BY 1, 2;

/* F Veredicto. */
WITH h AS (
    SELECT Objeto = o.name, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(o.object_id), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
    FROM sys.objects AS o WHERE o.schema_id = SCHEMA_ID(N'adm') AND o.type = 'P'),
lim AS (
    SELECT c.name, Limpio = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition, N' ', N''), N'[', N''), N']', N''), N'(', N''), N')', N'')
    FROM sys.check_constraints AS c WHERE c.is_not_trusted = 0 AND c.is_disabled = 0),
v AS (
    SELECT
      base41 = CASE WHEN (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudCambio_Crear') IN (0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642, 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F)
                     AND (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudCambio_Aplicar') IN (0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804)
                     AND (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudCambio_Rechazar') = 0xFC91FF5A0C7F5F445A1EEA168C20D696DE7D3D0943499D9EC1CF604F5987EF24
                     AND (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudCambio_RegistrarFallo') = 0x1125E2A3BD250A4EEB68703A72A55DACE9B3B43E4DCA13D3C9BD84FA35D7DB95
                     AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear')) = 25
                     AND COL_LENGTH(N'adm.SolicitudCambio', N'Estado') = 10 AND COL_LENGTH(N'adm.SolicitudCambioEvento', N'Evento') = 14
                     AND EXISTS (SELECT 1 FROM lim WHERE name = N'CK_SolicitudCambio_Rechazo' AND Limpio = N'Estado<>''RECHAZADA''ORlenltrimrtrimComentarioRevision>0') THEN 1 ELSE 0 END,
      viejos41 = (SELECT COUNT(*) FROM lim WHERE (name = N'CK_SolicitudCambio_Estado' AND Limpio = N'Estado=''RECHAZADA''OREstado=''APLICADA''OREstado=''PENDIENTE''')
                     OR (name = N'CK_SolicitudCambio_Revision' AND Limpio = N'Estado=''PENDIENTE''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLOREstado<>''PENDIENTE''ANDRevisadoPorISNOTNULLANDFechaRevisionUtcISNOTNULL')
                     OR (name = N'CK_SolicitudCambioEvento_Evento' AND Limpio = N'Evento=''DESACTUALIZADA''OREvento=''FALLO_APLICAR''OREvento=''RECHAZADA''OREvento=''APLICADA''OREvento=''ENVIADA''')),
      nuevos41 = (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN (N'CK_SolicitudCambio_EstadoCancelada', N'CK_SolicitudCambio_RevisionCancelacion', N'CK_SolicitudCambio_ReemplazaA', N'CK_SolicitudCambioEvento_EventoCancelada')),
      cols41 = CASE WHEN COL_LENGTH(N'adm.SolicitudCambio', N'ReemplazaA') IS NULL AND COL_LENGTH(N'adm.SolicitudCambio', N'CanceladoPor') IS NULL
                     AND COL_LENGTH(N'adm.SolicitudCambio', N'FechaCancelacionUtc') IS NULL AND COL_LENGTH(N'adm.SolicitudCambio', N'MotivoCancelacion') IS NULL THEN 0 ELSE 1 END,
      procs41 = CASE WHEN OBJECT_ID(N'adm.usp_SolicitudCambio_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudCambio_Reemplazar', N'P') IS NULL THEN 0 ELSE 1 END,
      base42 = CASE WHEN (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudIniciativa_Crear') = 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A
                     AND (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudIniciativa_Aprobar') = 0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906
                     AND (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudIniciativa_Rechazar') = 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416
                     AND (SELECT Hash FROM h WHERE Objeto = N'usp_SolicitudIniciativa_AprobarYCrear') = 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC
                     AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear')) = 21
                     AND COL_LENGTH(N'adm.SolicitudIniciativa', N'Estado') = 20 AND COL_LENGTH(N'adm.SolicitudIniciativaEvento', N'Evento') = 20
                     AND EXISTS (SELECT 1 FROM lim WHERE name = N'CK_SolicitudIniciativa_Rechazo' AND Limpio = N'Estado<>''RECHAZADA''ORComentarioRevisionISNOTNULLANDlenltrimrtrimComentarioRevision>0')
                     AND EXISTS (SELECT 1 FROM lim WHERE name = N'CK_SolicitudIniciativa_Codigo' AND Limpio = N'CodigoIniciativaISNULLOREstado=''APROBADA''ANDlenltrimrtrimCodigoIniciativa>0') THEN 1 ELSE 0 END,
      viejos42 = (SELECT COUNT(*) FROM lim WHERE (name = N'CK_SolicitudIniciativa_Estado' AND Limpio = N'Estado=''RECHAZADA''OREstado=''APROBADA''OREstado=''ENVIADA''')
                     OR (name = N'CK_SolicitudIniciativa_Revision' AND Limpio = N'Estado=''ENVIADA''ANDRevisadoPorISNULLANDFechaRevisionUtcISNULLANDComentarioRevisionISNULLOREstado<>''ENVIADA''ANDRevisadoPorISNOTNULLANDlenltrimrtrimRevisadoPor>0ANDFechaRevisionUtcISNOTNULL')
                     OR (name = N'CK_SolicitudIniciativaEvento_Evento' AND Limpio = N'Evento=''RECHAZADA''OREvento=''APROBADA''OREvento=''ENVIADA''')),
      nuevos42 = (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN (N'CK_SolicitudIniciativa_EstadoCancelada', N'CK_SolicitudIniciativa_RevisionCancelacion', N'CK_SolicitudIniciativa_ReemplazaA', N'CK_SolicitudIniciativaEvento_EventoCancelada')),
      cols42 = CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'ReemplazaA') IS NULL AND COL_LENGTH(N'adm.SolicitudIniciativa', N'CanceladoPor') IS NULL
                     AND COL_LENGTH(N'adm.SolicitudIniciativa', N'FechaCancelacionUtc') IS NULL AND COL_LENGTH(N'adm.SolicitudIniciativa', N'MotivoCancelacion') IS NULL THEN 0 ELSE 1 END,
      procs42 = CASE WHEN OBJECT_ID(N'adm.usp_SolicitudIniciativa_Cancelar', N'P') IS NULL AND OBJECT_ID(N'adm.usp_SolicitudIniciativa_Reemplazar', N'P') IS NULL THEN 0 ELSE 1 END)
SELECT [F] = 'Veredicto',
       Migracion41 = CASE WHEN procs41 = 1 THEN 'YA APLICADA'
                          WHEN base41 = 0 THEN 'NO (ver A, B y D)'
                          WHEN cols41 = 0 AND nuevos41 = 0 AND viejos41 = 3 THEN 'LISTA'
                          WHEN cols41 = 1 AND nuevos41 = 4 AND viejos41 = 0 THEN 'REACTIVAR (la migracion revisa el texto de sus CHECK)'
                          ELSE 'NO (a medias: ver B y C)' END,
       Migracion42 = CASE WHEN procs42 = 1 THEN 'YA APLICADA'
                          WHEN base42 = 0 THEN 'NO (ver A, B y D)'
                          WHEN cols42 = 0 AND nuevos42 = 0 AND viejos42 = 3 THEN 'LISTA'
                          WHEN cols42 = 1 AND nuevos42 = 4 AND viejos42 = 0 THEN 'REACTIVAR (la migracion revisa el texto de sus CHECK)'
                          ELSE 'NO (a medias: ver B y C)' END
FROM v;
