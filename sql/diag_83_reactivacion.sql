/* =========================================================================
   sql/diag_83_reactivacion.sql - DIAGNOSTICO DE SOLO LECTURA de sql/83.
   Sin EXEC, sin DDL / DML sobre la base: @b es una variable de tabla que
   solo existe mientras corre este script.

   PERMISOS: las huellas necesitan VIEW DEFINITION (db_owner basta); sin el
   salen NULL ("SIN VIEW DEFINITION"). El resto, con db_datareader.

   A  Estado de 83: huellas de los tres procedimientos y sus propiedades.
   V  Verificacion EXACTA de la baseline (sql/baseline_83_export.sql): mismo
      numero de filas y misma huella SHA-256 sobre los pares ordenados. Si
      no coincide, R no atribuye NADA.
   R  Pares de la baseline (dados de baja ANTES de 83) que hoy estan
      VIGENTES, con la EVIDENCIA de quien los reactivo (no es prueba):
        SOLICITUD APLICADA  una solicitud APLICADA, revisada despues de la
                            baseline, con AGREGAR de esa categoria;
        ADM DIRECTO (probable)  sin solicitud y la proteccion de la
                            iniciativa cambio despues de la baseline;
        SIN PROTECCION: carga del Excel posible;
        SIN EVIDENCIA.
      LIMITE: un par que se dio de baja DESPUES de la baseline y luego se
      reactivo no aparece (no estaba en la baseline). Nivel de auditoria
      acordado: no hay tabla de eventos de categorias.

   COMO CORRERLO: copiar los tres valores de la cabecera de la baseline y
   pegar TODAS sus lineas donde se indica; correr el script completo.
   ========================================================================= */
SET NOCOUNT ON;

/* A Estado de 83 */
SELECT [A] = 'Huella', Objeto = k.Objeto,
       Hash = h.Hash,
       Es = CASE WHEN h.Hash IS NULL THEN 'SIN VIEW DEFINITION'
                 WHEN h.Hash = k.Post83 THEN 'sql/83'
                 WHEN h.Hash = k.Antes THEN k.MigracionAntes
                 ELSE 'DESCONOCIDA' END,
       ReglaReactivacion = (SELECT CONVERT(nvarchar(30), ep.value) FROM sys.extended_properties AS ep
                            WHERE ep.class = 1 AND ep.minor_id = 0 AND ep.major_id = OBJECT_ID(k.Objeto, N'P') AND ep.name = N'ReglaReactivacion')
FROM (VALUES
    (N'adm.usp_GestionAdmin_Modificar',  N'sql/24', 0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, 0x68331AC9641DBFD6A83213F5E74E23A5FA4F4CC8BC03F040A965269AC98B1054),
    (N'adm.usp_SolicitudCambio_Aplicar', N'sql/40', 0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, 0x8464627C052EA87A5792C1CE27477D3D04638A391FD29C66352BA66C295B218D),
    (N'adm.usp_SolicitudCambio_Crear',   N'sql/38', 0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F, 0x08CED77CF27E9E929F264377B1059541E8C6CBD050B909D03FA58952613EE842)
    ) AS k (Objeto, MigracionAntes, Antes, Post83)
CROSS APPLY (SELECT Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID(k.Objeto, N'P')),
                    N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h;

/* 1. Copiar de la cabecera de la baseline (NULL = baseline invalida): */
DECLARE @TomadaUtc      datetime2(7)  = NULL;   -- TomadaUtc, p. ej. '2026-11-12T15:04:05.1234567'
DECLARE @FilasEsperadas int           = NULL;   -- Filas
DECLARE @HuellaEsperada varbinary(32) = NULL;   -- HuellaSha256 (0x...)

DECLARE @b TABLE
(
    Codigo    nvarchar(100) COLLATE DATABASE_DEFAULT NOT NULL,
    Categoria nvarchar(450) COLLATE DATABASE_DEFAULT NOT NULL
);
INSERT @b (Codigo, Categoria)
SELECT CONVERT(nvarchar(100), v.C), CONVERT(nvarchar(450), v.K)
FROM (VALUES
/* 2. Pegar aqui TODAS las lineas "Linea" de la baseline, tal cual (cada una termina en coma): */

(NULL, NULL)   -- centinela: no borrar
) AS v (C, K)
WHERE v.C IS NOT NULL;

DECLARE @Filas int = (SELECT COUNT(*) FROM @b);
DECLARE @Canon nvarchar(max) =
    (SELECT STRING_AGG(CONVERT(nvarchar(max),
                CONCAT(DATALENGTH(b.Codigo) / 2, N':', b.Codigo, N'|',
                       DATALENGTH(b.Categoria) / 2, N':', b.Categoria, N';')), N'')
            WITHIN GROUP (ORDER BY b.Codigo COLLATE Latin1_General_BIN2, b.Categoria COLLATE Latin1_General_BIN2)
     FROM @b AS b);
DECLARE @Huella varbinary(32) = HASHBYTES('SHA2_256', ISNULL(@Canon, N''));
DECLARE @BaseOk bit = CASE WHEN @TomadaUtc IS NOT NULL
                            AND @Filas = @FilasEsperadas
                            AND @Huella = @HuellaEsperada THEN 1 ELSE 0 END;

/* V Verificacion (siempre) */
SELECT [V] = 'Baseline', FilasPegadas = @Filas, FilasEsperadas = @FilasEsperadas,
       HuellaCalculada = CONVERT(varchar(66), @Huella, 1),
       HuellaEsperada  = CONVERT(varchar(66), @HuellaEsperada, 1),
       Veredicto = CASE WHEN @BaseOk = 1 THEN 'BASELINE VALIDA'
                        ELSE 'BASELINE INVALIDA: no se atribuye nada' END;

/* R Pares de la baseline hoy vigentes (solo con la baseline valida) */
SELECT [R] = 'Reactivada', b.Codigo, b.Categoria,
       pc.PctDisminucion, pc.TipoIniciativa, pc.TipoAgrupado,
       pc.FechaCreacionCategoria, pc.FechaAnalisisCategoria,
       SolicitudesAplicadas =
           (SELECT STRING_AGG(CONVERT(varchar(12), s.IdSolicitud), ',')
            FROM adm.SolicitudCambio AS s
            INNER JOIN adm.SolicitudCambioCategoria AS c ON c.IdSolicitud = s.IdSolicitud
            WHERE s.Codigo = b.Codigo AND s.Estado = 'APLICADA' AND s.FechaRevisionUtc >= @TomadaUtc
              AND c.Accion = 'AGREGAR'
              AND LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' '))) = b.Categoria),
       ProteccionMotivo = ip.Motivo, ip.UltimoCambioUtc, ip.UltimoCambioUsuario,
       Evidencia = CASE
           WHEN EXISTS (SELECT 1
                        FROM adm.SolicitudCambio AS s
                        INNER JOIN adm.SolicitudCambioCategoria AS c ON c.IdSolicitud = s.IdSolicitud
                        WHERE s.Codigo = b.Codigo AND s.Estado = 'APLICADA' AND s.FechaRevisionUtc >= @TomadaUtc
                          AND c.Accion = 'AGREGAR'
                          AND LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' '))) = b.Categoria)
                THEN 'SOLICITUD APLICADA'
           WHEN ip.UltimoCambioUtc >= @TomadaUtc THEN 'ADM DIRECTO (probable)'
           WHEN ip.Codigo IS NULL THEN 'SIN PROTECCION: carga del Excel posible'
           ELSE 'SIN EVIDENCIA' END
FROM @b AS b
INNER JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = b.Codigo AND pc.Categoria = b.Categoria
LEFT JOIN adm.IniciativaProtegida AS ip ON ip.Codigo = b.Codigo
WHERE @BaseOk = 1 AND pc.VigenteEnOrigen = 1
ORDER BY b.Codigo, b.Categoria;
