/* =========================================================================
   sql/diag_admin_persistencia_gestion.sql -- SOLO LECTURA (solo SELECT y
   metadatos). No escribe, no crea objetos, no cambia configuracion.

   Para decidir sql/18_gestion_admin_persistencia.sql y sql/19_cargador_respeta_admin.sql. Correr en la VM
   CON LA CUENTA DEL SITIO (D8 habla de sus permisos; con db_owner no dice
   nada util). Contiene nombres de iniciativas: no copiar la salida al repo.

     D1  FechaAnalisis - FechaCreacion: confirma la regla de 15 dias
     D2  TipoIniciativa / TipoAgrupado por prefijo (lo que un alta tendria
         que llenar para consumir capacidad)
     D3  Estado de las iniciativas recientes (estado inicial de un alta)
     D4  triggers desplegados en Problem / ProblemCategoria (definicion)
     D5  columnas actuales de ProblemCategoria (no hay fecha por categoria?)
     D6  quien depende de ProblemCategoria (impacto de agregar columnas)
     D7  codigo: secuencias, esquema adm, maximo por prefijo/anio
     D8  permisos de esta cuenta
     D9  READ_COMMITTED_SNAPSHOT, compatibilidad, version
     D10 cargador desplegado = copia 174bb51? (precondicion de sql/19)
   ========================================================================= */
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

/* D1 */
SELECT D1 = 'Dias analisis - creacion (sin cambios de FechaAnalisis)',
       Anio = YEAR(p.FechaCreacion),
       Dias = DATEDIFF(DAY, CONVERT(date, p.FechaCreacion), CONVERT(date, p.FechaAnalisis)),
       Filas = COUNT(*)
FROM dbo.Problem AS p
WHERE p.FechaCreacion IS NOT NULL AND p.FechaAnalisis IS NOT NULL
  AND ISNULL(p.NroCambioFechaAnalisis, 0) = 0
GROUP BY YEAR(p.FechaCreacion), DATEDIFF(DAY, CONVERT(date, p.FechaCreacion), CONVERT(date, p.FechaAnalisis))
HAVING COUNT(*) >= 3
ORDER BY Anio DESC, Filas DESC;

/* D2 */
SELECT D2 = 'Tipos por prefijo', p.Prefijo,
       ProblemTipoIniciativa = p.TipoIniciativa, pc.TipoIniciativa, pc.TipoAgrupado,
       Filas = COUNT(*), Ultima = MAX(p.FechaCreacion)
FROM dbo.ProblemCategoria AS pc
INNER JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
WHERE pc.VigenteEnOrigen = 1
GROUP BY p.Prefijo, p.TipoIniciativa, pc.TipoIniciativa, pc.TipoAgrupado
ORDER BY p.Prefijo, Filas DESC;

/* D3 */
SELECT TOP (40) D3 = 'Recientes: estado', p.Codigo, p.FechaCreacion, p.Estado, p.Subestado,
       p.FechaAnalisis, p.VigenteEnOrigen
FROM dbo.Problem AS p
ORDER BY p.FechaCreacion DESC, p.Codigo DESC;

/* D4 */
SELECT D4 = 'Triggers', Tabla = OBJECT_NAME(t.parent_id), Trigger_ = t.name, t.is_disabled,
       t.create_date, t.modify_date, Definicion = OBJECT_DEFINITION(t.object_id)
FROM sys.triggers AS t
WHERE t.parent_id IN (OBJECT_ID('dbo.Problem'), OBJECT_ID('dbo.ProblemCategoria'),
                      OBJECT_ID('dbo.ProblemFechaEvento'), OBJECT_ID('dbo.ProblemEstadoEvento'));

SELECT D4 = 'Columnas ProblemEstadoEvento', c.column_id, c.name, TYPE_NAME(c.user_type_id) AS Tipo, c.is_nullable
FROM sys.columns AS c WHERE c.object_id = OBJECT_ID('dbo.ProblemEstadoEvento') ORDER BY c.column_id;

/* D5 */
SELECT D5 = 'Columnas ProblemCategoria', c.column_id, c.name, TYPE_NAME(c.user_type_id) AS Tipo,
       c.max_length, c.is_nullable, c.is_computed
FROM sys.columns AS c WHERE c.object_id = OBJECT_ID('dbo.ProblemCategoria') ORDER BY c.column_id;

SELECT D5 = 'Restricciones ProblemCategoria', o.name, o.type_desc
FROM sys.objects AS o WHERE o.parent_object_id = OBJECT_ID('dbo.ProblemCategoria') ORDER BY o.type_desc, o.name;

/* D6 */
SELECT D6 = 'Dependen de ProblemCategoria', Objeto = OBJECT_SCHEMA_NAME(d.referencing_id) + '.' + OBJECT_NAME(d.referencing_id),
       o.type_desc,
       UsaSelectEstrella = CASE WHEN OBJECT_DEFINITION(d.referencing_id) LIKE '%ProblemCategoria%*%' THEN 1 ELSE 0 END
FROM sys.sql_expression_dependencies AS d
INNER JOIN sys.objects AS o ON o.object_id = d.referencing_id
WHERE d.referenced_id = OBJECT_ID('dbo.ProblemCategoria')
ORDER BY Objeto;

/* D7 */
SELECT D7 = 'Secuencias', Secuencia = OBJECT_SCHEMA_NAME(object_id) + '.' + name, current_value FROM sys.sequences;
SELECT D7 = 'Esquema adm existe', Existe = CASE WHEN SCHEMA_ID('adm') IS NULL THEN 0 ELSE 1 END;
SELECT D7 = 'Maximo por prefijo/anio', Prefijo = LEFT(p.Codigo, 3), Anio = SUBSTRING(p.Codigo, 5, 4),
       Maximo = MAX(TRY_CONVERT(int, SUBSTRING(p.Codigo, 10, 6))), Filas = COUNT(*),
       NoVigentes = SUM(CASE WHEN p.VigenteEnOrigen = 0 THEN 1 ELSE 0 END)
FROM dbo.Problem AS p
WHERE p.Codigo LIKE '[A-Z][A-Z][A-Z] [0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'
GROUP BY LEFT(p.Codigo, 3), SUBSTRING(p.Codigo, 5, 4)
ORDER BY Anio DESC, Prefijo;
SELECT D7 = 'Codigos fuera de forma', Filas = COUNT(*)
FROM dbo.Problem AS p
WHERE p.Codigo NOT LIKE '[A-Z][A-Z][A-Z] [0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]';

/* D8 */
SELECT D8 = 'Cuenta', Login = SUSER_SNAME(), UsuarioBD = USER_NAME(), EsDbOwner = IS_ROLEMEMBER('db_owner');
SELECT D8 = 'Permisos', Objeto = x.Nombre, p.permission_name
FROM (VALUES (N'dbo.Problem'), (N'dbo.ProblemCategoria'), (N'dbo.ProblemFechaEvento'), (N'dbo.ProblemEstadoEvento')) AS x (Nombre)
CROSS APPLY sys.fn_my_permissions(x.Nombre, 'OBJECT') AS p
WHERE OBJECT_ID(x.Nombre) IS NOT NULL;

/* D9 */
SELECT D9 = 'Base', name, compatibility_level, is_read_committed_snapshot_on, snapshot_isolation_state_desc,
       collation_name, Version = CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion'))
FROM sys.databases WHERE name = DB_NAME();

/* D10 cargador desplegado contra la copia 174bb51 (precondicion de sql/19):
   hash SHA2_256 de la definicion sin espacios, tabs ni saltos. */
SELECT D10 = 'usp_CargarExperiencia',
       Hash = CONVERT(varchar(70), HASHBYTES('SHA2_256',
              REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_CargarExperiencia')),
              N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N'')), 1),
       EsCopia174bb51 = CASE WHEN HASHBYTES('SHA2_256',
              REPLACE(REPLACE(REPLACE(REPLACE(OBJECT_DEFINITION(OBJECT_ID('dbo.usp_CargarExperiencia')),
              N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
              = 0x3BC236C22F81E7A07A4F221A012D54669742BE96A3E31C55DFE7F848D19C67DD THEN 1 ELSE 0 END,
       o.modify_date,
       Definicion = OBJECT_DEFINITION(OBJECT_ID('dbo.usp_CargarExperiencia'))
FROM sys.objects AS o WHERE o.object_id = OBJECT_ID('dbo.usp_CargarExperiencia');
