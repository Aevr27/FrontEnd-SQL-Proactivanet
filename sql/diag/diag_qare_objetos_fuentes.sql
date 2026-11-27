/* =========================================================================
   sql/diag/diag_qare_objetos_fuentes.sql - Inventario de objetos, columnas,
   dependencias e indices que pueden alimentar los cuatro SP nuevos de
   Tecnicos / QARE (usp_QARE_CalidadCaptura_KPIs, usp_QARE_PatronesSolucion,
   usp_QARE_CalidadCaptura_Tecnicos, usp_QARE_DetalleEvidencia).
   SOLO LECTURA: catalogo del sistema y OBJECT_DEFINITION. Sin DDL ni DML.

   Por que existe: esquema_bd/ (export de QA, 2026-10-13) trunca los cuerpos a
   ~250 caracteres, y usp_CorreoQARE_Detalle / _KB / _OportunidadesKB /
   _RecurrentesAplicacion no estan en ningun repositorio. Si alguna regla de
   texto ya existe, esta en esos cuerpos. Las definiciones salen una fila por
   linea porque la cuadricula de SSMS trunca OBJECT_DEFINITION.

   Requiere VIEW DEFINITION (el export de 2026-10-13 confirmo que la cuenta
   lo tiene). Correr en QA (AZVMBDCENTRALQA / Tickets_Proactivanet).
   Ver sql/docs/PROPUESTA_qare_tecnicos.md, seccion 11.
   ========================================================================= */

SET NOCOUNT ON;

-- ------------------------------------------------------------ 1. Inventario
-- Objetos por nombre. La lista de patrones es amplia a proposito: un objeto
-- de clasificacion de texto podria no llamarse QARE.
SELECT Seccion = N'1. Objetos', Esquema = s.name, Objeto = o.name, o.type_desc, o.create_date, o.modify_date
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF', 'SN')
  AND (   o.name LIKE N'%QARE%' OR o.name LIKE N'%CorreoQA%' OR o.name LIKE N'%QA[_]%'
       OR o.name LIKE N'%Tecnico%' OR o.name LIKE N'%Agente%' OR o.name LIKE N'%CuentaNoPersona%'
       OR o.name LIKE N'%Causa%' OR o.name LIKE N'%Patron%' OR o.name LIKE N'%Solucion%'
       OR o.name LIKE N'%Analisis%' OR o.name LIKE N'%Productividad%' OR o.name LIKE N'%Clasific%'
       OR o.name LIKE N'%Generic%' OR o.name LIKE N'%Regla%')
ORDER BY o.type_desc, s.name, o.name;

-- 1b. Los cuatro SP nuevos no deben existir todavia; si alguno sale, alguien
--     ya creo un prototipo y hay que leerlo antes de disenar
--     (sql/diag/diag_qare_tecnicos_prototipo.sql imprime su cuerpo).
SELECT Seccion = N'1b. SP nuevos', Objeto = n.nombre,
       Existe = CASE WHEN OBJECT_ID(n.nombre) IS NULL THEN 0 ELSE 1 END
FROM (VALUES (N'dbo.usp_QARE_CalidadCaptura_KPIs'), (N'dbo.usp_QARE_PatronesSolucion'),
             (N'dbo.usp_QARE_CalidadCaptura_Tecnicos'), (N'dbo.usp_QARE_DetalleEvidencia')) AS n(nombre);

-- 1c. El prototipo de Daniela devolvio result sets reales (se ve "Return
--     Value" en sus capturas): sus SP existen en ALGUNA base. Se buscan en
--     todas las bases a las que la cuenta tiene acceso. Solo SELECT dinamico
--     sobre sys.objects de cada base.
DECLARE @sql nvarchar(max) = N'';
SELECT @sql = @sql + N'
SELECT Seccion = N''1c. usp_QARE_* en otras bases'', Base = N' + QUOTENAME(d.name, N'''') + N',
       Objeto = s.name + N''.'' + o.name, o.type_desc, o.modify_date
FROM ' + QUOTENAME(d.name) + N'.sys.objects AS o
JOIN ' + QUOTENAME(d.name) + N'.sys.schemas AS s ON s.schema_id = o.schema_id
WHERE (o.name LIKE N''%QARE[_]%'' AND o.name NOT LIKE N''%CorreoQARE%'') OR o.name LIKE N''%PatronSolucion%''
UNION ALL'
FROM sys.databases AS d
WHERE d.state_desc = N'ONLINE' AND HAS_DBACCESS(d.name) = 1 AND d.database_id > 4;
IF @sql <> N''
BEGIN
    SET @sql = LEFT(@sql, LEN(@sql) - LEN(N'UNION ALL')) + N' ORDER BY Base, Objeto;';
    EXEC sys.sp_executesql @sql;
END;

-- ------------------------------------------------------------ 2. Columnas
-- Fuentes candidatas. Una columna que falte aqui y si este en vw_Tickets se
-- puede traer por CodigoTicket sin tocar la vista base (seccion 2b).
SELECT Seccion = N'2. Columnas', Objeto = s.name + N'.' + o.name, c.column_id, Columna = c.name,
       Tipo = TYPE_NAME(c.user_type_id),
       Largo = CASE WHEN c.max_length = -1 THEN N'MAX'
                    WHEN TYPE_NAME(c.user_type_id) LIKE N'n%char' THEN CONVERT(nvarchar(10), c.max_length / 2)
                    ELSE CONVERT(nvarchar(10), c.max_length) END,
       c.is_nullable
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
JOIN sys.columns AS c ON c.object_id = o.object_id
WHERE o.object_id IN (OBJECT_ID(N'dbo.vw_CorreoQARECierre_Base'), OBJECT_ID(N'dbo.vw_CorreoQA_Base'),
                      OBJECT_ID(N'dbo.vw_Tickets'), OBJECT_ID(N'dbo.vw_Dash_ProductividadBase'),
                      OBJECT_ID(N'dbo.tvf_CorreoQARE_Base'), OBJECT_ID(N'dbo.CatCuentaNoPersona'),
                      OBJECT_ID(N'dbo.CatAgenteTecnico'), OBJECT_ID(N'dbo.CatAgenteTecnicoAlias'),
                      OBJECT_ID(N'dbo.vw_TecnicoAgente'), OBJECT_ID(N'dbo.CatCausaRaizAgrupador'),
                      OBJECT_ID(N'dbo.AnalisisRegla'), OBJECT_ID(N'dbo.CatLiderGrupo'))
ORDER BY Objeto, c.column_id;

-- 2b. Columnas de vw_Tickets que la vista QARE no expone (contexto extra
--     posible para la fila expandible del detalle).
SELECT Seccion = N'2b. En vw_Tickets y no en vw_CorreoQARECierre_Base', Columna = c.name, Tipo = TYPE_NAME(c.user_type_id)
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'dbo.vw_Tickets')
  AND NOT EXISTS (SELECT 1 FROM sys.columns AS q
                  WHERE q.object_id = OBJECT_ID(N'dbo.vw_CorreoQARECierre_Base') AND q.name = c.name)
ORDER BY c.column_id;

-- 2c. Filas de catalogos (tamano real hoy).
SELECT Seccion = N'2c. Filas', Tabla = s.name + N'.' + t.name, Filas = SUM(p.rows)
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.partitions AS p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name IN (N'CatCuentaNoPersona', N'CatAgenteTecnico', N'CatAgenteTecnicoAlias', N'CatCausaRaizAgrupador',
                 N'AnalisisRegla', N'AnalisisServicio', N'CatLiderGrupo', N'Tickets')
GROUP BY s.name, t.name
ORDER BY Tabla;

-- ------------------------------------------------------------ 3. Dependencias
-- 3a. Hacia abajo: de que lee la vista QARE, nivel por nivel.
;WITH Dep AS (
    SELECT Nivel = 1, Origen = CONVERT(sysname, N'dbo.vw_CorreoQARECierre_Base'),
           Referencia = CONVERT(sysname, ISNULL(d.referenced_schema_name, N'dbo') + N'.' + d.referenced_entity_name),
           RefId = d.referenced_id
    FROM sys.sql_expression_dependencies AS d
    WHERE d.referencing_id = OBJECT_ID(N'dbo.vw_CorreoQARECierre_Base')
    UNION ALL
    SELECT p.Nivel + 1, p.Referencia,
           CONVERT(sysname, ISNULL(d.referenced_schema_name, N'dbo') + N'.' + d.referenced_entity_name),
           d.referenced_id
    FROM Dep AS p
    JOIN sys.sql_expression_dependencies AS d ON d.referencing_id = p.RefId
    WHERE p.Nivel < 5
)
SELECT DISTINCT Seccion = N'3a. vw_CorreoQARECierre_Base lee', Nivel, Origen, Referencia,
       Tipo = (SELECT o.type_desc FROM sys.objects AS o WHERE o.object_id = Dep.RefId)
FROM Dep
ORDER BY Nivel, Origen, Referencia;

-- 3b. Hacia arriba: quien usa las fuentes QARE y el catalogo de cuentas.
SELECT Seccion = N'3b. Quien las usa', Fuente = ISNULL(d.referenced_schema_name, N'dbo') + N'.' + d.referenced_entity_name,
       UsadaPor = OBJECT_SCHEMA_NAME(d.referencing_id) + N'.' + OBJECT_NAME(d.referencing_id),
       Tipo = o.type_desc
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
WHERE d.referenced_entity_name IN (N'vw_CorreoQARECierre_Base', N'vw_CorreoQA_Base', N'tvf_CorreoQARE_Base',
                                   N'CatCuentaNoPersona', N'CatCausaRaizAgrupador', N'CatAgenteTecnico',
                                   N'vw_TecnicoAgente', N'AnalisisRegla')
ORDER BY Fuente, UsadaPor;

-- 3c. Modulos que tocan los campos QARE o reglas de texto, aunque no se
--     llamen QARE. Aqui apareceria una lista de genericos o un umbral de
--     largo ya implementado en otro modulo.
SELECT Seccion = N'3c. Modulos que mencionan', Objeto = OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id),
       Tipo = o.type_desc,
       DescripcionSolucion = CASE WHEN m.definition LIKE N'%QARe[_]DescripcionSolucion%' THEN 1 ELSE 0 END,
       Causa               = CASE WHEN m.definition LIKE N'%QARe[_]Causa%'               THEN 1 ELSE 0 END,
       Evidencia           = CASE WHEN m.definition LIKE N'%QARe[_]Evidencia%'           THEN 1 ELSE 0 END,
       TipoSolucion        = CASE WHEN m.definition LIKE N'%QARe[_]TipoSolucion%'        THEN 1 ELSE 0 END,
       CuentaNoPersona     = CASE WHEN m.definition LIKE N'%CatCuentaNoPersona%'         THEN 1 ELSE 0 END,
       LiteralNA           = CASE WHEN m.definition LIKE N'%''N/A''%' OR m.definition LIKE N'%''NO APLICA''%' THEN 1 ELSE 0 END,
       UsaLEN              = CASE WHEN m.definition LIKE N'%LEN(%QARe%' OR m.definition LIKE N'%LEN(LTRIM(RTRIM(QARe%' THEN 1 ELSE 0 END,
       UsaPATINDEX         = CASE WHEN m.definition LIKE N'%PATINDEX%' THEN 1 ELSE 0 END,
       Largo = LEN(m.definition)
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE N'%QARe[_]%' OR m.definition LIKE N'%CatCuentaNoPersona%'
ORDER BY Objeto;

-- ------------------------------------------------------------ 4. Cuerpos completos
-- Todos los modulos que leen QARe_DescripcionSolucion / QARe_Causa /
-- QARe_Evidencia, mas los que definen Tecnico y EsPersona. Excluye los seis
-- usp_CorreoQARE_* y la TVF de sql/16_qare_filtros_org.sql: su cuerpo
-- completo ya esta en el repositorio.
;WITH M AS (
    SELECT Objeto = OBJECT_SCHEMA_NAME(m.object_id) + N'.' + OBJECT_NAME(m.object_id),
           Def = REPLACE(m.definition, NCHAR(13), N'') + NCHAR(10)
    FROM sys.sql_modules AS m
    WHERE (   m.definition LIKE N'%QARe[_]DescripcionSolucion%' OR m.definition LIKE N'%QARe[_]Causa%'
           OR m.definition LIKE N'%QARe[_]Evidencia%'
           OR m.object_id IN (OBJECT_ID(N'dbo.vw_Dash_ProductividadBase'), OBJECT_ID(N'dbo.vw_TecnicoAgente'),
                              OBJECT_ID(N'dbo.usp_CorreoQA_PorTecnico'), OBJECT_ID(N'dbo.usp_CargarCatCausaRaizAgrupador'),
                              OBJECT_ID(N'dbo.usp_CorreoQARE_Detalle'), OBJECT_ID(N'dbo.usp_CorreoQARE_KB'),
                              OBJECT_ID(N'dbo.usp_CorreoQARE_OportunidadesKB'), OBJECT_ID(N'dbo.usp_CorreoQARE_RecurrentesAplicacion')))
      AND m.object_id NOT IN (OBJECT_ID(N'dbo.usp_CorreoQARE_KPIs'), OBJECT_ID(N'dbo.usp_CorreoQARE_Frecuencia'),
                              OBJECT_ID(N'dbo.usp_CorreoQARE_CausaRaiz'), OBJECT_ID(N'dbo.usp_CorreoQARE_RecurrentesCategoria'),
                              OBJECT_ID(N'dbo.usp_CorreoQARE_ConfirmacionVsQA'), OBJECT_ID(N'dbo.usp_CorreoQARE_TipoSolucion'),
                              OBJECT_ID(N'dbo.tvf_CorreoQARE_Base'))
      -- vw_Tickets y las vistas de carga solo copian columnas; su cuerpo ya
      -- se reviso (diag 2, A) y no aporta reglas.
      AND OBJECT_NAME(m.object_id) NOT IN (N'vw_Tickets', N'vw_Tickets_Data', N'vw_CorreoQA_Base', N'vw_CorreoQARECierre_Base')
), L AS (
    SELECT Objeto, Linea = 1, Texto = LEFT(Def, CHARINDEX(NCHAR(10), Def) - 1),
           Resto = STUFF(Def, 1, CHARINDEX(NCHAR(10), Def), N'')
    FROM M
    UNION ALL
    SELECT Objeto, Linea + 1, LEFT(Resto, CHARINDEX(NCHAR(10), Resto) - 1),
           STUFF(Resto, 1, CHARINDEX(NCHAR(10), Resto), N'')
    FROM L WHERE CHARINDEX(NCHAR(10), Resto) > 0
)
SELECT Seccion = N'4. Definicion', Objeto, Linea, Texto
FROM L
ORDER BY Objeto, Linea
OPTION (MAXRECURSION 0);

-- ------------------------------------------------------------ 5. Parametros
-- Convencion de parametros de los SP vecinos, para que los nuevos la sigan.
SELECT Seccion = N'5. Parametros', Objeto = OBJECT_SCHEMA_NAME(p.object_id) + N'.' + OBJECT_NAME(p.object_id),
       p.parameter_id, Parametro = p.name, Tipo = TYPE_NAME(p.user_type_id), p.max_length, p.has_default_value
FROM sys.parameters AS p
JOIN sys.objects AS o ON o.object_id = p.object_id
WHERE o.type IN ('P', 'IF', 'TF', 'FN')
  AND (o.name LIKE N'usp[_]CorreoQARE[_]%' OR o.name LIKE N'usp[_]CorreoQA[_]%' OR o.name = N'tvf_CorreoQARE_Base'
       OR o.name LIKE N'usp[_]Dash[_]%Tecnico%')
ORDER BY Objeto, p.parameter_id;

-- ------------------------------------------------------------ 6. Indices
-- La pestana filtra por FechaFirmaSolucion, Tecnico (= FirmaSolucion), Grupo
-- y Categoria. En el export de 2026-10-13 ningun indice de dbo.Tickets tenia
-- FechaFirmaSolucion como llave: si sigue asi, cada SP recorre la tabla.
SELECT Seccion = N'6. Indices', Tabla = s.name + N'.' + t.name, Indice = i.name, i.type_desc,
       Llave = STUFF((SELECT N', ' + c.name FROM sys.index_columns AS ic
                      JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                      WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                      ORDER BY ic.key_ordinal FOR XML PATH(N'')), 1, 2, N''),
       Incluidas = STUFF((SELECT N', ' + c.name FROM sys.index_columns AS ic
                          JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
                          ORDER BY c.name FOR XML PATH(N'')), 1, 2, N''),
       i.filter_definition,
       TocaColumnasQARE = CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns AS ic
                                            JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                                            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                                              AND c.name IN (N'FechaFirmaSolucion', N'FirmaSolucion', N'Grupo', N'Categoria', N'Estado'))
                               THEN 1 ELSE 0 END
FROM sys.indexes AS i
JOIN sys.tables AS t ON t.object_id = i.object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE t.name IN (N'Tickets', N'CatCuentaNoPersona', N'CatLiderGrupo', N'CatAgenteTecnico') AND s.name = N'dbo'
  AND i.type > 0
ORDER BY Tabla, i.index_id;

-- ------------------------------------------------------------ 7. Contenido de catalogos chicos
-- CatCuentaNoPersona: 8 filas en diag 2. Se repite por si cambio.
SELECT Seccion = N'7a. CatCuentaNoPersona', Cuenta, Tipo, Habilitado, Nota
FROM dbo.CatCuentaNoPersona
ORDER BY Habilitado DESC, Cuenta;

-- CatAgenteTecnico: extensiones de Call Center. Se revisa si sirve como
-- catalogo de tecnicos (solo trae a los que tienen extension).
SELECT Seccion = N'7b. CatAgenteTecnico', Agentes = COUNT(*), Habilitados = SUM(CONVERT(int, Habilitado)),
       Grupos = COUNT(DISTINCT Grupo), Origenes = COUNT(DISTINCT Origen)
FROM dbo.CatAgenteTecnico;

-- AnalisisRegla: frases por servicio que motor.js aplica sobre el texto de
-- solucion (Campo S) o titulo+descripcion (D). Interesa el METODO (frases
-- normalizadas, gana la primera) y las frases genericas de cierre que se
-- repiten entre servicios ("sin respuesta", "duplicado").
SELECT Seccion = N'7c. AnalisisRegla sobre la solucion', r.Servicio, r.Orden, r.Regla, r.Motivo, r.Campo,
       Frases = LEFT(r.Frases, 400)
FROM dbo.AnalisisRegla AS r
WHERE r.Campo IN ('S', 'DS')
ORDER BY r.Servicio, r.Orden;

SELECT Seccion = N'7d. AnalisisRegla motivos repetidos entre servicios', Motivo = r.Motivo, Campo = r.Campo,
       Servicios = COUNT(DISTINCT r.Servicio)
FROM dbo.AnalisisRegla AS r
GROUP BY r.Motivo, r.Campo
HAVING COUNT(DISTINCT r.Servicio) > 1
ORDER BY Servicios DESC, Motivo;
