/* =========================================================================
   sql/diag_admin_persistencia_gestion_p2.sql -- SOLO LECTURA.
   Complemento de diag_admin_persistencia_gestion.sql para decidir sql/18 y
   sql/19. Se puede correr con la cuenta db_owner de siempre.

   ANTES DE CORRER: en la VM, abre el Web.config DEL SITIO y mira la cadena
   de conexion que usa (ConnectionStringProvider: <connectionStrings>):
     - si trae "User ID=xxx"          -> @LoginSitio = N'xxx'
     - si trae "Integrated Security"  -> @LoginSitio = la identidad del
       App Pool de IIS (p. ej. N'IIS APPPOOL\<pool>' o N'DOMINIO\cuenta$')
   NO pegues la contrasena en ningun lado; solo el nombre del login.

     Q1  los modulos de D6 (los que mencionan ProblemCategoria y un '*'):
         definicion completa, tipo, schemabinding y banderas de riesgo
     Q2  dbo.ProblemEstadoEvento completa: columnas, restricciones, triggers
         (incluida la guarda), y trg_Problem_EstadoEvento entero
     Q3  la identidad del sitio: su usuario en esta base, roles y permisos
         EFECTIVOS (con EXECUTE AS USER, que se deshace con REVERT)
   ========================================================================= */
SET NOCOUNT ON;
DECLARE @LoginSitio sysname = N'{{LOGIN_DEL_SITIO}}';   -- <- cambiar

/* Q1 */
SELECT Q1 = 'Modulos que mencionan ProblemCategoria',
       Objeto = OBJECT_SCHEMA_NAME(m.object_id) + '.' + OBJECT_NAME(m.object_id),
       o.type_desc, m.is_schema_bound,
       -- Banderas (heuristicas; la decision sale de leer la definicion):
       InsertEnProblemCategoria = CASE WHEN m.definition LIKE '%INSERT%ProblemCategoria%' THEN 1 ELSE 0 END,
       SelectEstrella = CASE WHEN m.definition LIKE '%SELECT%*%FROM%ProblemCategoria%'
                              OR m.definition LIKE '%pc.*%' OR m.definition LIKE '%SELECT *%' THEN 1 ELSE 0 END,
       SoloCountOComentario = CASE WHEN m.definition NOT LIKE '%SELECT *%' AND m.definition NOT LIKE '%.*%' THEN 1 ELSE 0 END,
       ColumnasVista = (SELECT COUNT(*) FROM sys.columns AS c WHERE c.object_id = m.object_id),
       m.definition
FROM sys.sql_modules AS m
INNER JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.object_id IN (SELECT d.referencing_id FROM sys.sql_expression_dependencies AS d
                      WHERE d.referenced_id = OBJECT_ID('dbo.ProblemCategoria'))
ORDER BY Objeto;

/* Q2 */
SELECT Q2 = 'Columnas ProblemEstadoEvento', c.column_id, c.name, TYPE_NAME(c.user_type_id) AS Tipo,
       c.max_length, c.is_nullable, c.is_computed, c.is_identity,
       DefaultDef = OBJECT_DEFINITION(c.default_object_id)
FROM sys.columns AS c WHERE c.object_id = OBJECT_ID('dbo.ProblemEstadoEvento') ORDER BY c.column_id;

SELECT Q2 = 'Restricciones ProblemEstadoEvento', o.name, o.type_desc,
       Definicion = COALESCE(cc.definition, OBJECT_DEFINITION(o.object_id))
FROM sys.objects AS o
LEFT JOIN sys.check_constraints AS cc ON cc.object_id = o.object_id
WHERE o.parent_object_id = OBJECT_ID('dbo.ProblemEstadoEvento')
ORDER BY o.type_desc, o.name;

SELECT Q2 = 'FKs ProblemEstadoEvento', fk.name, Referencia = OBJECT_NAME(fk.referenced_object_id),
       fk.delete_referential_action_desc, fk.update_referential_action_desc
FROM sys.foreign_keys AS fk WHERE fk.parent_object_id = OBJECT_ID('dbo.ProblemEstadoEvento');

SELECT Q2 = 'Triggers Problem / ProblemEstadoEvento', Tabla = OBJECT_NAME(t.parent_id), t.name,
       t.is_disabled, t.is_instead_of_trigger,
       Eventos = STUFF((SELECT ',' + te.type_desc FROM sys.trigger_events AS te WHERE te.object_id = t.object_id FOR XML PATH('')), 1, 1, ''),
       Orden = (SELECT TOP (1) CASE WHEN te.is_first = 1 THEN 'FIRST' WHEN te.is_last = 1 THEN 'LAST' ELSE '' END
                FROM sys.trigger_events AS te WHERE te.object_id = t.object_id),
       Definicion = OBJECT_DEFINITION(t.object_id)
FROM sys.triggers AS t
WHERE t.parent_id IN (OBJECT_ID('dbo.Problem'), OBJECT_ID('dbo.ProblemEstadoEvento'))
ORDER BY Tabla, t.name;

IF OBJECT_ID('dbo.ProblemEstadoEvento', 'U') IS NOT NULL
    EXEC (N'SELECT TOP (10) Q2 = ''Muestra ProblemEstadoEvento'', * FROM dbo.ProblemEstadoEvento ORDER BY 2 DESC;');

/* Q3 */
SELECT Q3 = 'Login del sitio', Login = @LoginSitio,
       ExisteLogin = CASE WHEN SUSER_ID(@LoginSitio) IS NULL THEN 0 ELSE 1 END,
       UsuarioEnEstaBase = dp.name, dp.type_desc, dp.authentication_type_desc
FROM (SELECT 1 AS x) AS u
LEFT JOIN sys.database_principals AS dp ON dp.sid = SUSER_SID(@LoginSitio);

DECLARE @UsuarioSitio sysname = (SELECT dp.name FROM sys.database_principals AS dp WHERE dp.sid = SUSER_SID(@LoginSitio));

SELECT Q3 = 'Roles del usuario del sitio', Rol = r.name
FROM sys.database_role_members AS rm
INNER JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
INNER JOIN sys.database_principals AS m ON m.principal_id = rm.member_principal_id
WHERE m.name = @UsuarioSitio;

SELECT Q3 = 'Permisos explicitos del usuario del sitio', p.class_desc,
       Objeto = CASE p.class WHEN 1 THEN OBJECT_SCHEMA_NAME(p.major_id) + '.' + OBJECT_NAME(p.major_id)
                             WHEN 3 THEN SCHEMA_NAME(p.major_id) ELSE '' END,
       p.permission_name, p.state_desc
FROM sys.database_permissions AS p
INNER JOIN sys.database_principals AS dp ON dp.principal_id = p.grantee_principal_id
WHERE dp.name = @UsuarioSitio
ORDER BY Objeto, p.permission_name;

IF @UsuarioSitio IS NOT NULL
BEGIN
    -- Permisos EFECTIVOS (roles, grupos y esquemas incluidos), como el sitio.
    EXECUTE AS USER = @UsuarioSitio;
    BEGIN TRY
        SELECT Q3 = 'Efectivos como el sitio', Usuario = USER_NAME(), x.Objeto, p.permission_name
        FROM (VALUES (N'dbo.Problem'), (N'dbo.ProblemCategoria'), (N'dbo.ProblemFechaEvento'),
                     (N'dbo.ProblemEstadoEvento'), (N'dbo.vw_ProblemCategoria'), (N'dbo.vw_TBSlotCAT'),
                     (N'dbo.CatPrefijoProblem'), (N'dbo.Categorias'), (N'dbo.CatCategoriaDueno'),
                     (N'dbo.UsuariosAdmin'), (N'dbo.usp_CargarExperiencia')) AS x (Objeto)
        CROSS APPLY sys.fn_my_permissions(x.Objeto, 'OBJECT') AS p
        WHERE OBJECT_ID(x.Objeto) IS NOT NULL AND p.subentity_name = N''
        ORDER BY x.Objeto, p.permission_name;

        SELECT Q3 = 'Efectivos en la base', p.permission_name
        FROM sys.fn_my_permissions(NULL, 'DATABASE') AS p
        WHERE p.permission_name IN (N'SELECT', N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE', N'CREATE SCHEMA',
                                    N'ALTER', N'CONTROL', N'VIEW DEFINITION');

        SELECT Q3 = 'Esquema dbo', p.permission_name FROM sys.fn_my_permissions(N'dbo', 'SCHEMA') AS p;
    END TRY
    BEGIN CATCH
        SELECT Q3 = 'Error leyendo permisos', ERROR_NUMBER(), ERROR_MESSAGE();
    END CATCH;
    REVERT;
END
ELSE
    SELECT Q3 = 'El login del sitio no tiene usuario en esta base (o el nombre no coincide)', Login = @LoginSitio;

SELECT Q3 = 'Comprobacion', UsuarioActual = USER_NAME(), Login = SUSER_SNAME();   -- debe ser de nuevo el tuyo
