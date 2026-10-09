/* =====================================================================================
   diag_admin_alta_edicion.sql

   SOLO LECTURA. Ningun INSERT / UPDATE / DELETE / DDL / SET de SESSION_CONTEXT.
   Solo crea tablas temporales (#Rec, #Rut, #Cls) en tempdb, que se borran al final.

   Antes de que Admin cree o edite iniciativas (dbo.Problem +
   dbo.ProblemCategoria) hay que confirmar contra la base REAL lo que el repo
   no puede decir: el script 13 del repo del ETL esta congelado desde el
   2026-09-30 y en la VM ya hay objetos posteriores (scripts 60-65,
   dbo.ProblemFechaEvento, dbo.ProblemEstadoEvento, triggers).

     E1  triggers sobre Problem / ProblemCategoria y sus tablas de historia
     E2  columnas reales (tipo, nulos, default, calculadas)
     E3  llaves: FKs que apuntan a Problem / ProblemCategoria, UNIQUE, CHECK
     E4  quien ESCRIBE en Problem / ProblemCategoria (is_updated)
     E5  esquema adm, secuencias y objetos de Admin que ya existan
     E6  permisos de LA CUENTA CON LA QUE SE CORRE sobre esas tablas
     E7  catalogo de prefijos completo
     E8  el identificador de prueba 676767: ya existe en algun lado?
     E9  con que nacen las 30 iniciativas mas recientes (tipo, duenos, detalle)
     E10 cuantas iniciativas vigentes YA se verian "incompletas" con una
         regla derivada (sin columna nueva), por Estado
     E11 catalogos de duenos y personas, espejo de categorias, rutas fuera
     E12 remapeo de rutas: que hay en dbo.CatRutaEquivalente y por que una
         ruta de iniciativa no cuadra con el catalogo (grafia, baja, rama,
         sin rastro); duenos huerfanos y C1&C2 sin dueno propio

   Complementa (no repite) a diag_admin_iniciativas_contrato.sql (A: prefijo
   -> agrupador; B: regla del consecutivo; C: campos llenos) y a
   diag_admin_nueva_solicitud.sql (N6: con que nacen las iniciativas
   recientes). Si no se han corrido en la VM, correrlos tambien.

   Correrlo CON LA MISMA CUENTA QUE USA EL SITIO (la de Web.config) para que
   E6 diga lo que puede hacer el tablero. Las definiciones de E1/E4 pueden
   salir NULL si la cuenta no tiene VIEW DEFINITION: entonces correr esas dos
   secciones con una cuenta de administrador.

   Base: Tickets_Proactivanet. SQL Server 2016+.
   ===================================================================================== */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

DECLARE @tablas TABLE (Nombre sysname PRIMARY KEY);
INSERT @tablas (Nombre) VALUES
    (N'dbo.Problem'), (N'dbo.ProblemCategoria'), (N'dbo.ProblemFechaEvento'),
    (N'dbo.ProblemEstadoEvento'), (N'dbo.ExpTicketsReduce'), (N'dbo.CatPrefijoProblem'),
    -- Catalogos que Admin podria administrar (duenos, personas, rutas, roles).
    (N'dbo.CatCategoriaDueno'), (N'dbo.CatPersona'), (N'dbo.Categorias'), (N'dbo.UsuariosAdmin'),
    -- Remapeo manual de rutas (script 43): su DDL no esta en ningun repo legible.
    (N'dbo.CatRutaEquivalente');

/* -------------------------------------------------------------------------------------
   E0) Cuenta y servidor con los que se corre.
   ------------------------------------------------------------------------------------- */
SELECT E0 = 'Contexto', Login = SUSER_SNAME(), UsuarioBD = USER_NAME(),
       Servidor = @@SERVERNAME, Version = SERVERPROPERTY('ProductVersion'),
       Compat = (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()),
       AhoraServidor = SYSDATETIME(), AhoraUtc = SYSUTCDATETIME();

/* -------------------------------------------------------------------------------------
   E1) Triggers sobre las tablas de iniciativas. Un alta o edicion desde Admin
       los dispara: hay que saber que exigen (SESSION_CONTEXT, usuario...) y
       donde escriben.
   ------------------------------------------------------------------------------------- */
SELECT E1 = 'Triggers',
       Tabla = OBJECT_SCHEMA_NAME(tr.parent_id) + '.' + OBJECT_NAME(tr.parent_id),
       Trigger_ = tr.name, Deshabilitado = tr.is_disabled, InsteadOf = tr.is_instead_of_trigger,
       Eventos = STUFF((SELECT ',' + te.type_desc FROM sys.trigger_events AS te
                        WHERE te.object_id = tr.object_id FOR XML PATH('')), 1, 1, ''),
       Creado = tr.create_date, Modificado = tr.modify_date,
       Definicion = OBJECT_DEFINITION(tr.object_id)
FROM sys.triggers AS tr
WHERE tr.parent_class = 1
  AND OBJECT_SCHEMA_NAME(tr.parent_id) + '.' + OBJECT_NAME(tr.parent_id) IN (SELECT Nombre FROM @tablas)
ORDER BY Tabla, tr.name;

/* -------------------------------------------------------------------------------------
   E2) Columnas reales.
   ------------------------------------------------------------------------------------- */
SELECT E2 = 'Columnas',
       Tabla = OBJECT_SCHEMA_NAME(c.object_id) + '.' + OBJECT_NAME(c.object_id),
       Orden = c.column_id, Columna = c.name,
       Tipo = TYPE_NAME(c.user_type_id) +
              CASE WHEN TYPE_NAME(c.user_type_id) IN ('nvarchar','nchar') THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CONVERT(varchar(10), c.max_length / 2) END + ')'
                   WHEN TYPE_NAME(c.user_type_id) IN ('varchar','char','varbinary','binary') THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CONVERT(varchar(10), c.max_length) END + ')'
                   WHEN TYPE_NAME(c.user_type_id) IN ('decimal','numeric') THEN '(' + CONVERT(varchar(5), c.precision) + ',' + CONVERT(varchar(5), c.scale) + ')'
                   WHEN TYPE_NAME(c.user_type_id) IN ('datetime2','time','datetimeoffset') THEN '(' + CONVERT(varchar(5), c.scale) + ')'
                   ELSE '' END,
       Nulos = c.is_nullable, Identidad = c.is_identity,
       Calculada = cc.definition, Default_ = dc.definition, Collation = c.collation_name
FROM sys.columns AS c
LEFT JOIN sys.computed_columns AS cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.default_constraints AS dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE OBJECT_SCHEMA_NAME(c.object_id) + '.' + OBJECT_NAME(c.object_id) IN (SELECT Nombre FROM @tablas)
ORDER BY Tabla, c.column_id;

/* -------------------------------------------------------------------------------------
   E3) Llaves y reglas. FKs desde CUALQUIER tabla hacia Problem /
       ProblemCategoria (deciden si una iniciativa de prueba se puede borrar
       y en que orden), mas PK/UNIQUE/CHECK de las tablas de E2.
   ------------------------------------------------------------------------------------- */
SELECT E3 = 'FK hacia iniciativas',
       FK = fk.name,
       Desde = OBJECT_SCHEMA_NAME(fk.parent_object_id) + '.' + OBJECT_NAME(fk.parent_object_id),
       Hacia = OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id),
       Columnas = STUFF((SELECT ',' + COL_NAME(k.parent_object_id, k.parent_column_id)
                         FROM sys.foreign_key_columns AS k WHERE k.constraint_object_id = fk.object_id
                         ORDER BY k.constraint_column_id FOR XML PATH('')), 1, 1, ''),
       AlBorrar = fk.delete_referential_action_desc, AlActualizar = fk.update_referential_action_desc,
       Deshabilitada = fk.is_disabled
FROM sys.foreign_keys AS fk
WHERE OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id)
      IN (N'dbo.Problem', N'dbo.ProblemCategoria')
ORDER BY Hacia, Desde;

SELECT E3 = 'PK/UNIQUE/CHECK',
       Tabla = OBJECT_SCHEMA_NAME(o.parent_object_id) + '.' + OBJECT_NAME(o.parent_object_id),
       Regla = o.name, Tipo = o.type_desc,
       Definicion = COALESCE(ck.definition,
           STUFF((SELECT ',' + COL_NAME(ic.object_id, ic.column_id)
                  FROM sys.key_constraints AS kc
                  JOIN sys.index_columns AS ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
                  WHERE kc.object_id = o.object_id ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 1, ''))
FROM sys.objects AS o
LEFT JOIN sys.check_constraints AS ck ON ck.object_id = o.object_id
WHERE o.type IN ('PK', 'UQ', 'C')
  AND OBJECT_SCHEMA_NAME(o.parent_object_id) + '.' + OBJECT_NAME(o.parent_object_id) IN (SELECT Nombre FROM @tablas)
ORDER BY Tabla, Tipo, Regla;

SELECT E3 = 'Indices unicos (no constraint)',
       Tabla = OBJECT_SCHEMA_NAME(i.object_id) + '.' + OBJECT_NAME(i.object_id), Indice = i.name,
       Columnas = STUFF((SELECT ',' + COL_NAME(ic.object_id, ic.column_id) FROM sys.index_columns AS ic
                         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                         ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 1, ''),
       Filtro = i.filter_definition
FROM sys.indexes AS i
WHERE i.is_unique = 1 AND i.is_primary_key = 0 AND i.is_unique_constraint = 0
  AND OBJECT_SCHEMA_NAME(i.object_id) + '.' + OBJECT_NAME(i.object_id) IN (SELECT Nombre FROM @tablas);

/* -------------------------------------------------------------------------------------
   E4) Quien escribe en Problem / ProblemCategoria. Primero todo modulo que
       los menciona (sql_expression_dependencies); luego, modulo por modulo,
       si de verdad los ACTUALIZA (dm_sql_referenced_entities.is_updated).
       Cada modulo va en su TRY/CATCH: uno roto no tumba el resto.
   ------------------------------------------------------------------------------------- */
DECLARE @mods TABLE (Id int PRIMARY KEY, Modulo nvarchar(300), Tipo nvarchar(60));
INSERT @mods (Id, Modulo, Tipo)
SELECT DISTINCT d.referencing_id,
       OBJECT_SCHEMA_NAME(d.referencing_id) + '.' + OBJECT_NAME(d.referencing_id),
       o.type_desc
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
WHERE d.referenced_id IN (OBJECT_ID(N'dbo.Problem'), OBJECT_ID(N'dbo.ProblemCategoria'));

DECLARE @escribe TABLE (Modulo nvarchar(300), Tipo nvarchar(60), Tabla nvarchar(300),
                        Actualiza bit, Selecciona bit, Error nvarchar(400));
DECLARE @id int = (SELECT MIN(Id) FROM @mods), @nom nvarchar(300), @tipo nvarchar(60);
WHILE @id IS NOT NULL
BEGIN
    SELECT @nom = Modulo, @tipo = Tipo FROM @mods WHERE Id = @id;
    BEGIN TRY
        INSERT @escribe (Modulo, Tipo, Tabla, Actualiza, Selecciona)
        SELECT @nom, @tipo, r.referenced_schema_name + '.' + r.referenced_entity_name,
               MAX(CONVERT(int, r.is_updated)), MAX(CONVERT(int, r.is_selected))
        FROM sys.dm_sql_referenced_entities(@nom, N'OBJECT') AS r
        WHERE r.referenced_minor_id = 0
          AND r.referenced_schema_name + '.' + r.referenced_entity_name IN (N'dbo.Problem', N'dbo.ProblemCategoria')
        GROUP BY r.referenced_schema_name, r.referenced_entity_name;
    END TRY
    BEGIN CATCH
        INSERT @escribe (Modulo, Tipo, Error) VALUES (@nom, @tipo, LEFT(ERROR_MESSAGE(), 400));
    END CATCH;
    SET @id = (SELECT MIN(Id) FROM @mods WHERE Id > @id);
END;

SELECT E4 = 'Modulos que tocan Problem/ProblemCategoria', *
FROM @escribe
ORDER BY CASE WHEN Actualiza = 1 THEN 0 ELSE 1 END, Modulo, Tabla;

/* -------------------------------------------------------------------------------------
   E5) Esquema adm y mecanismos de numeracion que ya existan (la propuesta
       del consecutivo no esta aprobada: se espera vacio).
   ------------------------------------------------------------------------------------- */
SELECT E5 = 'Esquemas', s.name, Dueno = USER_NAME(s.principal_id)
FROM sys.schemas AS s WHERE s.name IN (N'adm', N'stg', N'dbo');

SELECT E5 = 'Objetos en adm', Objeto = s.name + '.' + o.name, o.type_desc, o.create_date
FROM sys.objects AS o JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE s.name = N'adm';

SELECT E5 = 'Secuencias', Secuencia = OBJECT_SCHEMA_NAME(object_id) + '.' + name,
       current_value, increment, is_cycling
FROM sys.sequences;

SELECT E5 = 'Objetos con nombre de Admin/iniciativa fuera de adm',
       Objeto = OBJECT_SCHEMA_NAME(o.object_id) + '.' + o.name, o.type_desc, o.create_date, o.modify_date
FROM sys.objects AS o
WHERE o.type IN ('U', 'P', 'V', 'FN', 'IF', 'TF', 'TR')
  AND (o.name LIKE N'%Iniciativa%' OR o.name LIKE N'%Solicitud%' OR o.name LIKE N'%Contador%'
       OR o.name LIKE N'%AdminInit%' OR o.name LIKE N'Problem%' OR o.name LIKE N'Exp%')
ORDER BY o.type_desc, Objeto;

/* -------------------------------------------------------------------------------------
   E6) Permisos efectivos de esta cuenta. Hoy el sitio deberia poder solo
       leer: si ya puede INSERT/UPDATE en dbo, decirlo.
   ------------------------------------------------------------------------------------- */
SELECT E6 = 'Permisos efectivos', Objeto = t.Nombre,
       Existe  = CASE WHEN OBJECT_ID(t.Nombre) IS NULL THEN 0 ELSE 1 END,
       [SELECT] = HAS_PERMS_BY_NAME(t.Nombre, 'OBJECT', 'SELECT'),
       [INSERT] = HAS_PERMS_BY_NAME(t.Nombre, 'OBJECT', 'INSERT'),
       [UPDATE] = HAS_PERMS_BY_NAME(t.Nombre, 'OBJECT', 'UPDATE'),
       [DELETE] = HAS_PERMS_BY_NAME(t.Nombre, 'OBJECT', 'DELETE')
FROM @tablas AS t;

SELECT E6 = 'Permisos sobre esquemas',
       Esquema = s.name,
       [EXECUTE] = HAS_PERMS_BY_NAME(s.name, 'SCHEMA', 'EXECUTE'),
       [INSERT]  = HAS_PERMS_BY_NAME(s.name, 'SCHEMA', 'INSERT'),
       [UPDATE]  = HAS_PERMS_BY_NAME(s.name, 'SCHEMA', 'UPDATE')
FROM sys.schemas AS s WHERE s.name IN (N'dbo', N'adm');

SELECT E6 = 'Roles de base de esta cuenta', Rol = r.name
FROM sys.database_role_members AS m
JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
WHERE m.member_principal_id = USER_ID();

/* -------------------------------------------------------------------------------------
   E7) Catalogo de prefijos completo (incluye los que no tienen iniciativas).
   ------------------------------------------------------------------------------------- */
SELECT E7 = 'CatPrefijoProblem', cp.*,
       Iniciativas = (SELECT COUNT(*) FROM dbo.Problem AS p WHERE p.Prefijo = cp.Prefijo),
       Vigentes    = (SELECT COUNT(*) FROM dbo.Problem AS p WHERE p.Prefijo = cp.Prefijo AND p.VigenteEnOrigen = 1),
       MaxCodigo   = (SELECT MAX(p.Codigo) FROM dbo.Problem AS p WHERE p.Prefijo = cp.Prefijo)
FROM dbo.CatPrefijoProblem AS cp
ORDER BY cp.Prefijo;

/* -------------------------------------------------------------------------------------
   E8) 676767: que no choque con nada existente.
   ------------------------------------------------------------------------------------- */
SELECT E8 = '676767 en Problem', Codigo, Titulo, VigenteEnOrigen
FROM dbo.Problem WHERE Codigo LIKE N'%676767%' OR Titulo LIKE N'%676767%';

SELECT E8 = '676767 en ProblemCategoria', Codigo, Categoria, VigenteEnOrigen
FROM dbo.ProblemCategoria WHERE Codigo LIKE N'%676767%';

IF OBJECT_ID(N'dbo.ProblemFechaEvento', N'U') IS NOT NULL
    EXEC (N'SELECT E8 = ''676767 en ProblemFechaEvento'', COUNT(*) AS Filas FROM dbo.ProblemFechaEvento WHERE Codigo LIKE N''%676767%'';');
IF OBJECT_ID(N'dbo.ProblemEstadoEvento', N'U') IS NOT NULL
    EXEC (N'SELECT E8 = ''676767 en ProblemEstadoEvento'', COUNT(*) AS Filas FROM dbo.ProblemEstadoEvento WHERE Codigo LIKE N''%676767%'';');

/* -------------------------------------------------------------------------------------
   E9) Con que nacen las 30 iniciativas mas recientes, en lo que N6 de
       diag_admin_nueva_solicitud.sql no muestra: tipo, duenos capturados en
       el Problem y su detalle por categoria (TipoAgrupado decide si cuentan
       como Activas en el tablero). Orden por FechaCreacion y, sin ella, por
       FechaAltaDW (cuando entro a la base).
   ------------------------------------------------------------------------------------- */
IF OBJECT_ID('tempdb..#Rec') IS NOT NULL DROP TABLE #Rec;
SELECT TOP (30) p.Codigo, p.FechaCreacion, p.FechaAltaDW
INTO #Rec
FROM dbo.Problem AS p
ORDER BY COALESCE(p.FechaCreacion, p.FechaAltaDW) DESC, p.Codigo DESC;

SELECT E9 = 'Recientes: cabecera', p.Codigo, p.VigenteEnOrigen, p.FechaCreacion, p.FechaAltaDW,
       p.TipoPrb, p.TipoIniciativa, p.Estado, p.Subestado, p.OwnerProblem, p.OwnerServicio,
       p.Direccion, p.Gerencia, p.Impacto, p.Prioridad, p.Categoria,
       TituloLargo = LEN(p.Titulo), DescripcionLarga = LEN(p.Descripcion),
       ObservacionesLargas = LEN(p.Observaciones),
       Categorias = (SELECT COUNT(*) FROM dbo.ProblemCategoria AS pc WHERE pc.Codigo = p.Codigo)
FROM dbo.Problem AS p
JOIN #Rec AS r ON r.Codigo = p.Codigo
ORDER BY COALESCE(r.FechaCreacion, r.FechaAltaDW) DESC, p.Codigo DESC;

SELECT E9 = 'Recientes: detalle', pc.Codigo, pc.Categoria, pc.VigenteEnOrigen,
       pc.TipoTicket, pc.TipoIniciativa, pc.TipoAgrupado,
       TituloIniciativaIgualTitulo = CASE WHEN CONVERT(nvarchar(4000), pc.TituloIniciativa) = CONVERT(nvarchar(4000), p.Titulo) THEN 1 ELSE 0 END,
       pc.PctDisminucion, pc.MesReduccion, pc.TicketsReduce, pc.DiasMesCerrado,
       pc.CategoriaInactiva, pc.EstadoProblem, pc.CierreProblem, pc.MejorFecha, pc.FechaAltaDW
FROM dbo.ProblemCategoria AS pc
JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
JOIN #Rec AS r ON r.Codigo = pc.Codigo
ORDER BY COALESCE(r.FechaCreacion, r.FechaAltaDW) DESC, pc.Codigo DESC, pc.Categoria;

DROP TABLE #Rec;

/* -------------------------------------------------------------------------------------
   E10) Una iniciativa "incompleta" se puede marcar SIN columna nueva,
        derivandolo de lo que le falta. Antes de proponerlo hay que saber
        cuantas de las que ya existen (del Excel) saldrian marcadas: si son
        muchas, la marca no distingue nada. Por Estado, cuantas vigentes no
        tienen cada dato.
   ------------------------------------------------------------------------------------- */
SELECT E10 = 'Vigentes sin cada dato, por Estado',
       Estado = ISNULL(f.Estado, N'(NULL)'),
       Total = COUNT(*),
       SinCategoria   = SUM(f.SinCategoria),
       SinTipoAgrupado = SUM(f.SinTipoAgrupado),
       SinPct         = SUM(f.SinPct),
       SinOwnerProblem = SUM(CASE WHEN f.OwnerProblem IS NULL THEN 1 ELSE 0 END),
       SinFechaQueRige = SUM(f.SinFechaQueRige),
       SinDescripcion = SUM(CASE WHEN f.Descripcion IS NULL THEN 1 ELSE 0 END),
       SinNinguno     = SUM(CASE WHEN f.SinCategoria + f.SinTipoAgrupado + f.SinPct + f.SinFechaQueRige = 0
                                  AND f.OwnerProblem IS NOT NULL THEN 1 ELSE 0 END)
FROM (
    SELECT p.Estado, p.OwnerProblem, Descripcion = CONVERT(nvarchar(10), p.Descripcion),
           SinCategoria = CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc
                                                WHERE pc.Codigo = p.Codigo AND pc.VigenteEnOrigen = 1) THEN 1 ELSE 0 END,
           SinTipoAgrupado = CASE WHEN EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc
                                               WHERE pc.Codigo = p.Codigo AND pc.VigenteEnOrigen = 1 AND pc.TipoAgrupado IS NULL) THEN 1 ELSE 0 END,
           SinPct = CASE WHEN EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc
                                      WHERE pc.Codigo = p.Codigo AND pc.VigenteEnOrigen = 1 AND pc.PctDisminucion IS NULL) THEN 1 ELSE 0 END,
           -- La fecha que rige segun el Estado (la misma correspondencia del
           -- semaforo y de vw_ProblemVencido); Estados sin fecha que rija: 0.
           SinFechaQueRige = CASE
               WHEN p.Estado LIKE N'En An_lisis'     AND p.FechaAnalisis IS NULL THEN 1
               WHEN p.Estado LIKE N'En Soluci_n'      AND p.FechaSolucion IS NULL THEN 1
               WHEN p.Estado LIKE N'En Monitoreo'    AND p.FechaCierre   IS NULL THEN 1
               ELSE 0 END
    FROM dbo.Problem AS p
    WHERE p.VigenteEnOrigen = 1
) AS f
GROUP BY f.Estado
ORDER BY Total DESC;

/* -------------------------------------------------------------------------------------
   E11) Catalogos que hoy llena el Excel (hojas CategoriasN2 y Equipo) y que
        Admin tendria que administrar si el ETL se retira.
   ------------------------------------------------------------------------------------- */
SELECT E11 = 'CatCategoriaDueno', Total = COUNT(*),
       Vigentes = SUM(CASE WHEN VigenteEnOrigen = 1 THEN 1 ELSE 0 END),
       C1Distintos = COUNT(DISTINCT C1),
       UltimaCarga = MAX(FechaUltimaCargaDW)
FROM dbo.CatCategoriaDueno;

SELECT E11 = 'CatPersona', Total = COUNT(*),
       Vigentes = SUM(CASE WHEN VigenteEnOrigen = 1 THEN 1 ELSE 0 END),
       SinCorreo = SUM(CASE WHEN VigenteEnOrigen = 1 AND Correo IS NULL THEN 1 ELSE 0 END),
       UltimaCarga = MAX(FechaUltimaCargaDW)
FROM dbo.CatPersona;

SELECT E11 = 'Categorias (espejo de Proactivanet)', Total = COUNT(*),
       Vigentes = SUM(CASE WHEN VigenteEnOrigen = 1 THEN 1 ELSE 0 END),
       ActivasVigentes = SUM(CASE WHEN VigenteEnOrigen = 1 AND ISNULL(Inactiva, 0) = 0 THEN 1 ELSE 0 END),
       RutasRepetidas = COUNT(*) - COUNT(DISTINCT RutaCompleta)
FROM dbo.Categorias;

-- Rutas de iniciativas vigentes que no estan en el espejo de Proactivanet
-- (ProblemCategoria.Categoria no tiene FK a Categorias: se puede guardar
-- cualquier texto).
SELECT E11 = 'Rutas de iniciativa fuera del espejo', Filas = COUNT(*), Rutas = COUNT(DISTINCT pc.Categoria)
FROM dbo.ProblemCategoria AS pc
WHERE pc.VigenteEnOrigen = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.Categorias AS c WHERE c.RutaCompleta = pc.Categoria AND c.VigenteEnOrigen = 1);

/* -------------------------------------------------------------------------------------
   E12) Remapeo de rutas. Hipotesis a verificar: con catalogo y duenos bien
        mantenidos ya no haria falta remapear a mano. Para eso hay que saber
        POR QUE una ruta no cuadra:
          GRAFIA      la misma ruta salvo mayusculas/acentos/espacios: dato
                      mal escrito; el catalogo esta bien.
          BAJA        existe en el espejo pero no vigente o inactiva: la
                      categoria se dio de baja en Proactivanet.
          RAMA        es un nivel intermedio con hojas activas debajo: la
                      iniciativa apunta a una rama, no a una hoja.
          SIN RASTRO  ni eso: renombrada o movida en Proactivanet (el espejo
                      guarda solo la ruta actual de cada Id) o nunca existio.
        Solo GRAFIA y BAJA se arreglan manteniendo el catalogo; RENOMBRADA
        sigue rompiendo porque iniciativas, tickets y duenos se ligan por el
        TEXTO de la ruta, no por el Id de Proactivanet.
   ------------------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.CatRutaEquivalente', N'U') IS NOT NULL
BEGIN
    EXEC (N'SELECT E12 = ''CatRutaEquivalente: filas'', COUNT(*) AS Filas FROM dbo.CatRutaEquivalente;');
    EXEC (N'SELECT TOP (300) E12 = ''CatRutaEquivalente: contenido'', * FROM dbo.CatRutaEquivalente;');
END
ELSE
    SELECT E12 = 'CatRutaEquivalente NO EXISTE (o sin permiso)';

IF OBJECT_ID('tempdb..#Rut') IS NOT NULL DROP TABLE #Rut;
SELECT DISTINCT Ruta = pc.Categoria
INTO #Rut
FROM dbo.ProblemCategoria AS pc
WHERE pc.VigenteEnOrigen = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.Categorias AS c
                  WHERE c.RutaCompleta = pc.Categoria AND c.VigenteEnOrigen = 1 AND ISNULL(c.Inactiva, 0) = 0);

IF OBJECT_ID('tempdb..#Cls') IS NOT NULL DROP TABLE #Cls;
SELECT r.Ruta,
       Clase = CASE
           WHEN EXISTS (SELECT 1 FROM dbo.Categorias AS c
                        WHERE c.VigenteEnOrigen = 1 AND ISNULL(c.Inactiva, 0) = 0
                          AND REPLACE(LTRIM(RTRIM(c.RutaCompleta)), N'  ', N' ') COLLATE Latin1_General_CI_AI
                            = REPLACE(LTRIM(RTRIM(r.Ruta)), N'  ', N' ') COLLATE Latin1_General_CI_AI) THEN 'GRAFIA'
           WHEN EXISTS (SELECT 1 FROM dbo.Categorias AS c WHERE c.RutaCompleta = r.Ruta) THEN 'BAJA'
           WHEN EXISTS (SELECT 1 FROM dbo.Categorias AS c
                        WHERE c.VigenteEnOrigen = 1 AND ISNULL(c.Inactiva, 0) = 0
                          AND c.RutaCompleta LIKE REPLACE(REPLACE(REPLACE(r.Ruta, N'[', N'[[]'), N'%', N'[%]'), N'_', N'[_]') + N'/%') THEN 'RAMA'
           ELSE 'SIN RASTRO' END
INTO #Cls
FROM #Rut AS r;

-- Sin subconsulta dentro de SUM (Msg 130): el conteo va por fila primero.
SELECT E12 = 'Rutas de iniciativa fuera del catalogo activo, por causa', f.Clase,
       Rutas = COUNT(*), FilasIniciativa = SUM(f.Filas)
FROM (SELECT c.Clase,
             Filas = (SELECT COUNT(*) FROM dbo.ProblemCategoria AS pc
                      WHERE pc.Categoria = c.Ruta AND pc.VigenteEnOrigen = 1)
      FROM #Cls AS c) AS f
GROUP BY f.Clase
ORDER BY Rutas DESC;

SELECT TOP (60) E12 = 'Ejemplos', Clase, Ruta
FROM #Cls
ORDER BY Clase, Ruta;

-- Duenos: N2 capturados que ya no tienen ninguna ruta activa debajo
-- (huerfanos) y C1&C2 activos sin fila propia (heredan del C1 o no tienen).
-- Comparacion por texto con fn_CategoriaC1C2; la normalizacion del sitio
-- (DirectorioOrganizacional.Normaliza) puede emparejar algunos mas.
IF OBJECT_ID(N'dbo.fn_CategoriaC1C2', N'FN') IS NOT NULL
BEGIN
    EXEC (N'
    ;WITH act AS (
        SELECT DISTINCT C1C2 = dbo.fn_CategoriaC1C2(c.RutaCompleta)
        FROM dbo.Categorias AS c
        WHERE c.VigenteEnOrigen = 1 AND ISNULL(c.Inactiva, 0) = 0)
    SELECT E12 = ''Duenos vs catalogo activo'',
           N2Vigentes        = (SELECT COUNT(*) FROM dbo.CatCategoriaDueno WHERE VigenteEnOrigen = 1),
           N2SinRutaActiva   = (SELECT COUNT(*) FROM dbo.CatCategoriaDueno AS d
                                WHERE d.VigenteEnOrigen = 1
                                  AND NOT EXISTS (SELECT 1 FROM act WHERE act.C1C2 = d.CategoriaN2)),
           C1C2Activos       = (SELECT COUNT(*) FROM act),
           C1C2SinDuenoPropio = (SELECT COUNT(*) FROM act
                                 WHERE NOT EXISTS (SELECT 1 FROM dbo.CatCategoriaDueno AS d
                                                   WHERE d.VigenteEnOrigen = 1 AND d.CategoriaN2 = act.C1C2));');
END
ELSE
    SELECT E12 = 'fn_CategoriaC1C2 NO EXISTE';

DROP TABLE #Cls; DROP TABLE #Rut;
