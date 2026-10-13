/* =========================================================================
   sql/diag_esquema_completo.sql - Esquema COMPLETO de la base actual.

   OBJETIVO
   Volcar la estructura entera de la base donde se corre (por omision
   Tickets_Proactivanet) para tenerla documentada en el repo:
     0. servidor, base, version y permisos de quien corre el script;
     1. inventario de objetos (tablas, vistas, SP, funciones, triggers,
        sinonimos, tipos tabla) con fechas de creacion/modificacion;
     2. columnas de tablas y vistas (tipo, nulos, identity, calculada,
        default, collation);
     3. indices, PK y UNIQUE con sus columnas;
     4. llaves foraneas;
     5. CHECK constraints;
     6. filas aproximadas por tabla (sys.partitions, no escanea nada);
     7. parametros de SP y funciones;
     8. columnas de tipos tabla (TVP);
     9. sinonimos y dependencias hacia OTRAS bases (Integracion_SQL, etc.);
    10. texto completo de vistas, SP, funciones y triggers, en trozos de
        4000 caracteres para que Results to Text no los corte.

   ES DE SOLO LECTURA
   - Solo SELECT sobre vistas de catalogo (sys.*) y OBJECT_DEFINITION.
   - No hay CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, MERGE, TRUNCATE,
     GRANT, REVOKE ni EXEC de ningun SP.
   - No lee datos de ninguna tabla: los conteos salen de sys.partitions.

   COMO CORRERLO (SSMS)
   1. Query > Results To > Results to File (Ctrl+Shift+F).
   2. Elegir la base en el combo (Tickets_Proactivanet) y F5.
   3. Repetir en cada base que quieras documentar (p. ej. la de
      Integracion_SQL si es otra) y pasar los archivos .rpt.
   - Results to Text corta cada columna en 256 caracteres por omision (Tools >
     Options > Query Results > SQL Server > Results to Text; el cambio solo
     aplica a ventanas NUEVAS). Por eso @Trozo = 250: los cuerpos salen
     completos sin tocar esa opcion. Las secciones 1-9 casi nunca pasan de 256.
   - Si el archivo sale enorme, pon @IncluirDefiniciones = 0 y manda primero
     solo la estructura; los cuerpos se piden despues.
   - @SoloDefiniciones = 1 salta las secciones 1-9 (para repetir solo la 10).
   - La seccion 0 dice si tienes VIEW DEFINITION. Sin ese permiso SQL Server
     OCULTA los objetos que no puedes ver, sin error: el volcado saldria
     incompleto y no se notaria.
   ========================================================================= */

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- lo exige .value() de XML (sqlcmd lo trae OFF)
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;

DECLARE @IncluirDefiniciones bit = 1;   -- 0 = sin la seccion 10 (cuerpos)
DECLARE @SoloDefiniciones bit = 0;      -- 1 = solo secciones 0 y 10
DECLARE @Trozo int = 250;               -- caracteres por trozo; <= limite de Results to Text

/* ---------------------------------------------------------------------- */
PRINT '===== 0. Servidor, base y permisos =====';
SELECT  @@SERVERNAME                                        AS Servidor,
        DB_NAME()                                           AS Base,
        CAST(SERVERPROPERTY('ProductVersion') AS varchar(30)) AS Version,
        CAST(SERVERPROPERTY('Edition') AS varchar(60))      AS Edicion,
        (SELECT compatibility_level FROM sys.databases
          WHERE database_id = DB_ID())                      AS NivelCompat,
        DATABASEPROPERTYEX(DB_NAME(), 'Collation')          AS CollationBase,
        SUSER_SNAME()                                       AS Login,
        USER_NAME()                                         AS Usuario,
        HAS_PERMS_BY_NAME(NULL, 'DATABASE', 'VIEW DEFINITION') AS TieneViewDefinition,
        SYSDATETIME()                                       AS Corrido;

/* ---------------------------------------------------------------------- */
IF @SoloDefiniciones = 0
BEGIN   -- secciones 1-9
PRINT '===== 1. Inventario de objetos =====';
SELECT  s.name                  AS Esquema,
        o.name                  AS Objeto,
        o.type                  AS Tipo,
        o.type_desc             AS TipoDesc,
        OBJECT_NAME(o.parent_object_id) AS Padre,
        o.create_date           AS Creado,
        o.modify_date           AS Modificado
FROM    sys.objects o
JOIN    sys.schemas s ON s.schema_id = o.schema_id
WHERE   o.is_ms_shipped = 0
  AND   o.type IN ('U','V','P','FN','IF','TF','TR','SN','SO','FS','FT','PC')
ORDER BY o.type, s.name, o.name;

SELECT  s.name AS Esquema, tt.name AS TipoTabla, tt.is_user_defined
FROM    sys.table_types tt
JOIN    sys.schemas s ON s.schema_id = tt.schema_id
ORDER BY s.name, tt.name;

SELECT  t.name                       AS TriggerBD,
        t.type_desc, t.is_disabled, t.create_date, t.modify_date
FROM    sys.triggers t
WHERE   t.parent_class = 0;          -- triggers DDL a nivel base

/* ---------------------------------------------------------------------- */
PRINT '===== 2. Columnas de tablas y vistas =====';
SELECT  s.name                  AS Esquema,
        o.name                  AS Objeto,
        o.type                  AS Tipo,
        c.column_id             AS N,
        c.name                  AS Columna,
        CASE
          WHEN ty.name IN ('varchar','char','varbinary','binary')
            THEN ty.name + '(' + CASE WHEN c.max_length = -1 THEN 'max'
                                      ELSE CAST(c.max_length AS varchar(10)) END + ')'
          WHEN ty.name IN ('nvarchar','nchar')
            THEN ty.name + '(' + CASE WHEN c.max_length = -1 THEN 'max'
                                      ELSE CAST(c.max_length / 2 AS varchar(10)) END + ')'
          WHEN ty.name IN ('decimal','numeric')
            THEN ty.name + '(' + CAST(c.precision AS varchar(5)) + ','
                               + CAST(c.scale AS varchar(5)) + ')'
          WHEN ty.name IN ('datetime2','time','datetimeoffset')
            THEN ty.name + '(' + CAST(c.scale AS varchar(5)) + ')'
          ELSE ty.name
        END                     AS TipoDato,
        c.is_nullable           AS Nulo,
        c.is_identity           AS EsIdentity,
        c.is_computed           AS EsCalculada,
        cc.definition           AS FormulaCalculada,
        dc.definition           AS ValorDefault,
        c.collation_name        AS Collation
FROM    sys.columns c
JOIN    sys.objects o  ON o.object_id = c.object_id
JOIN    sys.schemas s  ON s.schema_id = o.schema_id
JOIN    sys.types   ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.computed_columns   cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id
                                    AND dc.parent_column_id = c.column_id
WHERE   o.is_ms_shipped = 0
  AND   o.type IN ('U','V')
ORDER BY s.name, o.name, c.column_id;

/* ---------------------------------------------------------------------- */
PRINT '===== 3. Indices, PK y UNIQUE =====';
SELECT  s.name                  AS Esquema,
        o.name                  AS Tabla,
        i.name                  AS Indice,
        i.type_desc             AS TipoIndice,
        i.is_primary_key        AS EsPK,
        i.is_unique             AS EsUnico,
        i.is_unique_constraint  AS EsUQ,
        STUFF((SELECT ', ' + c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE '' END
               FROM   sys.index_columns ic
               JOIN   sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
               WHERE  ic.object_id = i.object_id AND ic.index_id = i.index_id
                 AND  ic.is_included_column = 0
               ORDER BY ic.key_ordinal
               FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS Llave,
        STUFF((SELECT ', ' + c.name
               FROM   sys.index_columns ic
               JOIN   sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
               WHERE  ic.object_id = i.object_id AND ic.index_id = i.index_id
                 AND  ic.is_included_column = 1
               ORDER BY c.name
               FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS Incluidas,
        i.filter_definition     AS Filtro,
        i.is_disabled           AS Deshabilitado
FROM    sys.indexes i
JOIN    sys.objects o ON o.object_id = i.object_id
JOIN    sys.schemas s ON s.schema_id = o.schema_id
WHERE   o.is_ms_shipped = 0
  AND   o.type IN ('U','V')
  AND   i.type > 0                    -- sin el heap
ORDER BY s.name, o.name, i.index_id;

/* ---------------------------------------------------------------------- */
PRINT '===== 4. Llaves foraneas =====';
SELECT  fk.name                                     AS FK,
        SCHEMA_NAME(po.schema_id) + '.' + po.name   AS TablaHija,
        STUFF((SELECT ', ' + pc.name
               FROM   sys.foreign_key_columns fkc
               JOIN   sys.columns pc ON pc.object_id = fkc.parent_object_id
                                    AND pc.column_id = fkc.parent_column_id
               WHERE  fkc.constraint_object_id = fk.object_id
               ORDER BY fkc.constraint_column_id
               FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS ColumnasHija,
        SCHEMA_NAME(ro.schema_id) + '.' + ro.name   AS TablaPadre,
        STUFF((SELECT ', ' + rc.name
               FROM   sys.foreign_key_columns fkc
               JOIN   sys.columns rc ON rc.object_id = fkc.referenced_object_id
                                    AND rc.column_id = fkc.referenced_column_id
               WHERE  fkc.constraint_object_id = fk.object_id
               ORDER BY fkc.constraint_column_id
               FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS ColumnasPadre,
        fk.delete_referential_action_desc           AS OnDelete,
        fk.update_referential_action_desc           AS OnUpdate,
        fk.is_disabled                              AS Deshabilitada,
        fk.is_not_trusted                           AS NoConfiable
FROM    sys.foreign_keys fk
JOIN    sys.objects po ON po.object_id = fk.parent_object_id
JOIN    sys.objects ro ON ro.object_id = fk.referenced_object_id
ORDER BY TablaHija, fk.name;

/* ---------------------------------------------------------------------- */
PRINT '===== 5. CHECK constraints =====';
SELECT  SCHEMA_NAME(o.schema_id) + '.' + o.name AS Tabla,
        ck.name                                 AS CheckConstraint,
        COL_NAME(ck.parent_object_id, ck.parent_column_id) AS Columna,
        ck.definition                           AS Definicion,
        ck.is_disabled                          AS Deshabilitado
FROM    sys.check_constraints ck
JOIN    sys.objects o ON o.object_id = ck.parent_object_id
ORDER BY Tabla, ck.name;

/* ---------------------------------------------------------------------- */
PRINT '===== 6. Filas aproximadas por tabla =====';
SELECT  s.name                  AS Esquema,
        t.name                  AS Tabla,
        SUM(p.rows)             AS FilasAprox
FROM    sys.tables t
JOIN    sys.schemas s    ON s.schema_id = t.schema_id
JOIN    sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE   t.is_ms_shipped = 0
GROUP BY s.name, t.name
ORDER BY s.name, t.name;

/* ---------------------------------------------------------------------- */
PRINT '===== 7. Parametros de SP y funciones =====';
SELECT  SCHEMA_NAME(o.schema_id) + '.' + o.name AS Objeto,
        o.type                                  AS Tipo,
        p.parameter_id                          AS N,
        CASE WHEN p.parameter_id = 0 THEN '(retorno)' ELSE p.name END AS Parametro,
        CASE
          WHEN ty.name IN ('varchar','char','varbinary','binary')
            THEN ty.name + '(' + CASE WHEN p.max_length = -1 THEN 'max'
                                      ELSE CAST(p.max_length AS varchar(10)) END + ')'
          WHEN ty.name IN ('nvarchar','nchar')
            THEN ty.name + '(' + CASE WHEN p.max_length = -1 THEN 'max'
                                      ELSE CAST(p.max_length / 2 AS varchar(10)) END + ')'
          WHEN ty.name IN ('decimal','numeric')
            THEN ty.name + '(' + CAST(p.precision AS varchar(5)) + ','
                               + CAST(p.scale AS varchar(5)) + ')'
          WHEN ty.name IN ('datetime2','time','datetimeoffset')
            THEN ty.name + '(' + CAST(p.scale AS varchar(5)) + ')'
          ELSE ty.name
        END                                     AS TipoDato,
        p.is_output                             AS EsOutput,
        p.is_readonly                           AS EsReadonly,
        p.has_default_value                     AS TieneDefault
FROM    sys.parameters p
JOIN    sys.objects o  ON o.object_id = p.object_id
JOIN    sys.types   ty ON ty.user_type_id = p.user_type_id
WHERE   o.is_ms_shipped = 0
ORDER BY Objeto, p.parameter_id;
-- Nota: has_default_value solo vale para CLR; en T-SQL el default real se ve
-- en el texto de la seccion 10.

/* ---------------------------------------------------------------------- */
PRINT '===== 8. Columnas de tipos tabla (TVP) =====';
SELECT  SCHEMA_NAME(tt.schema_id) + '.' + tt.name AS TipoTabla,
        c.column_id                               AS N,
        c.name                                    AS Columna,
        TYPE_NAME(c.user_type_id)                 AS TipoDato,
        c.max_length, c.precision, c.scale,
        c.is_nullable                             AS Nulo
FROM    sys.table_types tt
JOIN    sys.columns c ON c.object_id = tt.type_table_object_id
ORDER BY TipoTabla, c.column_id;

/* ---------------------------------------------------------------------- */
PRINT '===== 9. Sinonimos y referencias a otras bases =====';
SELECT  SCHEMA_NAME(sn.schema_id) + '.' + sn.name AS Sinonimo,
        sn.base_object_name                       AS Apunta
FROM    sys.synonyms sn
ORDER BY Sinonimo;

SELECT DISTINCT
        SCHEMA_NAME(o.schema_id) + '.' + o.name   AS ObjetoLocal,
        o.type                                    AS Tipo,
        d.referenced_server_name                  AS Servidor,
        d.referenced_database_name                AS BaseRef,
        d.referenced_schema_name                  AS EsquemaRef,
        d.referenced_entity_name                  AS ObjetoRef
FROM    sys.sql_expression_dependencies d
JOIN    sys.objects o ON o.object_id = d.referencing_id
WHERE   d.referenced_database_name IS NOT NULL
   OR   d.referenced_server_name   IS NOT NULL
ORDER BY BaseRef, ObjetoRef, ObjetoLocal;
END     -- secciones 1-9

/* ---------------------------------------------------------------------- */
IF @IncluirDefiniciones = 1
BEGIN
    PRINT '===== 10. Definiciones (vistas, SP, funciones, triggers) =====';
    PRINT 'Cada objeto sale en trozos de ' + CAST(@Trozo AS varchar(10))
        + ' caracteres; unirlos por Objeto + Trozo en orden.';

    ;WITH Mods AS (
        SELECT  m.object_id,
                SCHEMA_NAME(o.schema_id) + '.' + o.name AS Objeto,
                o.type                                  AS Tipo,
                m.definition                            AS Def,
                LEN(m.definition)                       AS Largo
        FROM    sys.sql_modules m
        JOIN    sys.objects o ON o.object_id = m.object_id
        WHERE   o.is_ms_shipped = 0
    ),
    Num AS (   -- 0..N sin tablas propias: sale de dos vistas de catalogo
        SELECT TOP (2000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
        FROM   sys.all_objects a CROSS JOIN sys.all_objects b
    )
    SELECT  md.Tipo,
            md.Objeto,
            nu.n + 1                                        AS Trozo,
            (md.Largo - 1) / @Trozo + 1                     AS DeTrozos,
            SUBSTRING(md.Def, nu.n * @Trozo + 1, @Trozo)    AS Texto
    FROM    Mods md
    JOIN    Num  nu ON nu.n * @Trozo < md.Largo
    ORDER BY md.Tipo, md.Objeto, Trozo;

    -- Objetos cifrados (WITH ENCRYPTION): definition llega NULL.
    SELECT  SCHEMA_NAME(o.schema_id) + '.' + o.name AS ObjetoSinTexto, o.type
    FROM    sys.sql_modules m
    JOIN    sys.objects o ON o.object_id = m.object_id
    WHERE   o.is_ms_shipped = 0 AND m.definition IS NULL;
END

PRINT '===== FIN =====';
