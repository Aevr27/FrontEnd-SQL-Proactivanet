/* =========================================================================
   sql/diag_23_cambios_recientes_preflight.sql - PREFLIGHT de sql/23
   (Cambios recientes). SOLO LECTURA: catalogos, OBJECT_DEFINITION,
   HASHBYTES y APPLOCK_TEST (que solo PRUEBA un candado, no lo toma). Lo
   unico que escribe es una variable de tabla de esta misma sesion. No usa
   EXECUTE AS ni SESSION_CONTEXT. Se puede correr en la VM sin OK.

   COMO CORRERLO
     En la MISMA herramienta y con las MISMAS opciones con que se correra
     sql/23 (SSMS por omision, o sqlcmd -b -I), conectado a la base de
     destino, con una cuenta que vea los metadatos (VIEW DEFINITION en la
     base, o db_owner). Script completo; un solo lote.

   RESULTADO
     1er conjunto: una fila por chequeo (Resultado PASS / FAIL / INFO).
     2o conjunto:  el VEREDICTO.
       GO    = 0 FAIL y los 28 chequeos obligatorios en PASS.
       STOP  = cualquier FAIL, un chequeo que no llego a correr o un error
               del propio preflight. CUALQUIER STOP: NO correr sql/23.
     INFO no decide; es contexto para el registro.
     Si NO aparece el conjunto del VEREDICTO, o SSMS/sqlcmd muestran un error
     (un error de compilacion se salta el TRY/CATCH), tambien es STOP.
     Guardar la salida completa (Ctrl+T, a texto) junto con la de sql/23.

   Hashes: SHA2_256 de OBJECT_DEFINITION(OBJECT_ID(objeto, 'P')) sin
   espacios, tabs ni saltos de linea: la MISMA expresion de la guarda de
   sql/23 (y de sql/20, 21, 22 y el diag ADM_04).
   ========================================================================= */
SET NOCOUNT ON;

DECLARE @BaseEsperada sysname = N'Tickets_Proactivanet';
DECLARE @Obligatorios int = 28;

DECLARE @r TABLE (N int IDENTITY(1, 1), Seccion varchar(40), Chequeo nvarchar(200), Resultado varchar(4),
                  Esperado nvarchar(400), Obtenido nvarchar(max), SiFalla nvarchar(400), Obligatorio bit);

BEGIN TRY
    /* ---------- 0. Contexto y permisos de quien corre esto ---------- */
    INSERT @r SELECT '0 contexto', N'Base de datos', CASE WHEN DB_NAME() = @BaseEsperada THEN 'PASS' ELSE 'FAIL' END,
                     @BaseEsperada, DB_NAME(), N'STOP: conectate a la base correcta.', 1;
    DECLARE @veMeta bit = CASE WHEN HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') = 1
                                 OR IS_MEMBER('db_owner') = 1 OR IS_SRVROLEMEMBER('sysadmin') = 1 THEN 1 ELSE 0 END;
    INSERT @r SELECT '0 contexto', N'Quien corre esto ve todos los metadatos (VIEW DEFINITION / db_owner / sysadmin)',
                     CASE WHEN @veMeta = 1 THEN 'PASS' ELSE 'FAIL' END, N'1', CONVERT(nvarchar(10), @veMeta),
                     N'STOP: sin esto, "no existe" puede ser "no lo veo" y las ausencias no se pueden confiar. Correr con otra cuenta.', 1;
    INSERT @r SELECT '0 contexto', N'Esta sesion: ANSI_NULLS ON', CASE WHEN SESSIONPROPERTY('ANSI_NULLS') = 1 THEN 'PASS' ELSE 'FAIL' END,
                     N'1', CONVERT(nvarchar(10), SESSIONPROPERTY('ANSI_NULLS')),
                     N'STOP: sql/23 (ALTER PROCEDURE) toma la opcion de la sesion. Usa SSMS por omision o sqlcmd con ANSI_NULLS ON.', 1;
    INSERT @r SELECT '0 contexto', N'Esta sesion: QUOTED_IDENTIFIER ON', CASE WHEN SESSIONPROPERTY('QUOTED_IDENTIFIER') = 1 THEN 'PASS' ELSE 'FAIL' END,
                     N'1', CONVERT(nvarchar(10), SESSIONPROPERTY('QUOTED_IDENTIFIER')),
                     N'STOP: sqlcmd la trae en OFF salvo con -I. Corre sql/23 igual que este preflight.', 1;
    INSERT @r SELECT '0 contexto', N'Servidor / version / cuenta', 'INFO', NULL,
                     CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) + N' | ' + SUSER_SNAME(), NULL, 0;

    /* ---------- 1. Hashes vivos (misma expresion que sql/23) ---------- */
    INSERT @r
    SELECT '1 hashes', N'Hash de ' + v.Objeto,
           CASE WHEN x.Id IS NULL OR x.Def IS NULL OR x.Hash IS NULL THEN 'FAIL'
                WHEN x.Hash = v.Esperado THEN 'PASS' ELSE 'FAIL' END,
           v.Rev + N' ' + CONVERT(nvarchar(70), v.Esperado, 1),
           CASE WHEN x.Id IS NULL THEN N'NO EXISTE (o no visible)'
                WHEN x.Def IS NULL THEN N'definicion NULL (sin VIEW DEFINITION o cifrado)'
                ELSE CONVERT(nvarchar(70), x.Hash, 1)
                     + CASE WHEN x.Hash = v.Sql23 THEN N' = sql/23 (YA APLICADA)' ELSE N'' END END,
           CASE WHEN x.Hash = v.Sql23 THEN N'STOP: sql/23 ya esta aplicada; no la corras otra vez.'
                ELSE N'STOP: no es la version esperada. No correr sql/23 hasta revisar la diferencia (OBJECT_DEFINITION).' END, 1
    FROM (VALUES (N'adm.usp_GestionAdmin_Crear',     N'sql/21', 0x540F83EF4AF3AB4A3D3E2E8E7B6D4DE75B7731E98085DAD11CF54B14A4478D79,
                                                                0x8032AA3EBEA8E44EFB1E58DF977824093B91BFACFEC2E5EB0684AEC1E52743E6),
                 (N'adm.usp_GestionAdmin_Modificar', N'sql/22', 0x8E0848187A529F6E0C2D9D8B30820F0EA19CCDEC7C7937EFB41BF33108084BA9,
                                                                0x816268254935C77FEE7F325E7E2663D828410EA9242E1037AB1BC3BD4D3F8CB7),
                 (N'adm.usp_SolicitudCambio_Aplicar', N'sql/22', 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1,
                                                                 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1))
           AS v (Objeto, Rev, Esperado, Sql23)
    CROSS APPLY (SELECT Id = OBJECT_ID(v.Objeto, 'P'), Def = OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P'))) AS d
    CROSS APPLY (SELECT Id = d.Id, Def = d.Def,
                        Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(d.Def, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS x
    ORDER BY v.Objeto;
    -- Aplicar es el mismo en sql/22 y sql/23 (sql/23 no lo toca): su
    -- "YA APLICADA" nunca se pinta; solo su PASS/FAIL cuenta.
    UPDATE @r SET Obtenido = REPLACE(Obtenido, N' = sql/23 (YA APLICADA)', N''), SiFalla = N'STOP: no es la version esperada. No correr sql/23 hasta revisar la diferencia (OBJECT_DEFINITION).'
    WHERE Seccion = '1 hashes' AND Chequeo LIKE N'%Aplicar';

    /* ---------- 2. Tabla, columnas y CHECK ---------- */
    DECLARE @tabla int = OBJECT_ID(N'adm.IniciativaProtegida', N'U');
    INSERT @r SELECT '2 esquema', N'adm.IniciativaProtegida existe', CASE WHEN @tabla IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'existe', CASE WHEN @tabla IS NULL THEN N'NO EXISTE (o no visible)' ELSE N'existe' END,
                     N'STOP: sql/18 no esta o no se ve.', 1;
    DECLARE @cols nvarchar(max) = (SELECT STRING_AGG(CONVERT(nvarchar(max), c.name) COLLATE DATABASE_DEFAULT, N',') WITHIN GROUP (ORDER BY c.column_id)
                                   FROM sys.columns AS c WHERE c.object_id = @tabla);
    INSERT @r SELECT '2 esquema', N'Columnas actuales (exactas, en orden)',
                     CASE WHEN @cols = N'Codigo,Motivo,Usuario,FechaAltaUtc' THEN 'PASS' ELSE 'FAIL' END,
                     N'Codigo,Motivo,Usuario,FechaAltaUtc', ISNULL(@cols, N'(ninguna visible)'),
                     N'STOP: la tabla no es la de sql/18 (alguien la cambio o sql/23 quedo a medias). Revisar antes.', 1;
    INSERT @r SELECT '2 esquema', N'Columna UltimoCambioUtc AUSENTE',
                     CASE WHEN @tabla IS NOT NULL AND COL_LENGTH(N'adm.IniciativaProtegida', N'UltimoCambioUtc') IS NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'ausente', CASE WHEN @tabla IS NULL THEN N'tabla no visible' WHEN COL_LENGTH(N'adm.IniciativaProtegida', N'UltimoCambioUtc') IS NULL THEN N'ausente' ELSE N'EXISTE' END,
                     N'STOP: ya existe; sql/23 se negaria o ya esta aplicada.', 1;
    INSERT @r SELECT '2 esquema', N'Columna UltimoCambioUsuario AUSENTE',
                     CASE WHEN @tabla IS NOT NULL AND COL_LENGTH(N'adm.IniciativaProtegida', N'UltimoCambioUsuario') IS NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'ausente', CASE WHEN @tabla IS NULL THEN N'tabla no visible' WHEN COL_LENGTH(N'adm.IniciativaProtegida', N'UltimoCambioUsuario') IS NULL THEN N'ausente' ELSE N'EXISTE' END,
                     N'STOP: ya existe; sql/23 se negaria o ya esta aplicada.', 1;
    DECLARE @ck nvarchar(400) = (SELECT STRING_AGG(o.type_desc COLLATE DATABASE_DEFAULT, N',') FROM sys.objects AS o
                                 WHERE o.schema_id = SCHEMA_ID(N'adm') AND o.name = N'CK_IniciativaProtegida_UltimoCambio');
    INSERT @r SELECT '2 esquema', N'Nombre CK_IniciativaProtegida_UltimoCambio libre en el esquema adm',
                     CASE WHEN SCHEMA_ID(N'adm') IS NOT NULL AND @ck IS NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'libre', CASE WHEN SCHEMA_ID(N'adm') IS NULL THEN N'esquema adm no visible' ELSE ISNULL(N'OCUPADO por ' + @ck, N'libre') END,
                     N'STOP: el ALTER TABLE de sql/23 fallaria (2714). Revisar quien usa ese nombre.', 1;
    INSERT @r SELECT '2 esquema', N'Filas en adm.IniciativaProtegida', 'INFO', NULL,
                     CONVERT(nvarchar(20), (SELECT SUM(p.rows) FROM sys.partitions AS p WHERE p.object_id = @tabla AND p.index_id IN (0, 1))), NULL, 0;

    /* ---------- 3. Opciones guardadas de los procedimientos ---------- */
    INSERT @r
    SELECT '3 opciones', N'ANSI_NULLS / QUOTED_IDENTIFIER de ' + v.Objeto,
           CASE WHEN m.object_id IS NULL THEN 'FAIL'
                WHEN m.uses_ansi_nulls = 1 AND m.uses_quoted_identifier = 1 THEN 'PASS' ELSE 'FAIL' END,
           N'1 / 1',
           CASE WHEN m.object_id IS NULL THEN N'NO EXISTE (o no visible)'
                ELSE CONVERT(nvarchar(1), m.uses_ansi_nulls) + N' / ' + CONVERT(nvarchar(1), m.uses_quoted_identifier)
                     + N'  (modificado ' + CONVERT(nvarchar(19), o.modify_date, 120) + N')' END,
           N'STOP: hoy no esta en ON/ON; correr sql/23 desde SSMS lo dejaria distinto. Decidir antes con que opciones se recrea.', 1
    FROM (VALUES (N'adm.usp_GestionAdmin_Crear'), (N'adm.usp_GestionAdmin_Modificar'), (N'adm.usp_SolicitudCambio_Aplicar')) AS v (Objeto)
    LEFT JOIN sys.sql_modules AS m ON m.object_id = OBJECT_ID(v.Objeto, 'P')
    LEFT JOIN sys.objects AS o ON o.object_id = m.object_id
    ORDER BY v.Objeto;

    /* ---------- 4. Permisos de PROACTIVANETAD ---------- */
    DECLARE @sitio int = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD');
    INSERT @r SELECT '4 permisos', N'Usuario PROACTIVANETAD existe en la base', CASE WHEN @sitio IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'existe', CASE WHEN @sitio IS NULL THEN N'NO EXISTE (o no visible)'
                                     ELSE N'principal_id ' + CONVERT(nvarchar(10), @sitio) + N', tipo ' + (SELECT type_desc FROM sys.database_principals WHERE principal_id = @sitio) END,
                     N'STOP: sin el usuario del sitio no se puede revisar su DENY.', 1;

    -- PROACTIVANETAD + todos sus roles (anidados) + public.
    DECLARE @quien TABLE (Id int PRIMARY KEY);
    IF @sitio IS NOT NULL
    BEGIN
        WITH roles AS (
            SELECT Id = rm.role_principal_id FROM sys.database_role_members AS rm WHERE rm.member_principal_id = @sitio
            UNION ALL
            SELECT rm.role_principal_id FROM sys.database_role_members AS rm INNER JOIN roles ON rm.member_principal_id = roles.Id)
        INSERT @quien SELECT DISTINCT Id FROM (SELECT Id FROM roles UNION SELECT @sitio UNION SELECT DATABASE_PRINCIPAL_ID(N'public')) AS t;
    END;
    INSERT @r SELECT '4 permisos', N'Roles de PROACTIVANETAD (anidados)', 'INFO', NULL,
                     (SELECT STRING_AGG(CONVERT(nvarchar(max), p.name) COLLATE DATABASE_DEFAULT, N', ') FROM @quien AS q JOIN sys.database_principals AS p ON p.principal_id = q.Id WHERE q.Id <> @sitio), NULL, 0;

    INSERT @r
    SELECT '4 permisos', N'DENY ' + v.Permiso + N' sobre adm.IniciativaProtegida (tabla completa)',
           CASE WHEN @sitio IS NOT NULL AND @tabla IS NOT NULL AND d.Quien IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
           N'DENY (state D) a PROACTIVANETAD o a uno de sus roles',
           ISNULL(d.Quien, N'SIN DENY'),
           N'STOP: el sitio podria escribir la tabla (y fingir un sello). Falta el DENY de sql/18 sec. 8: aplicarlo con su OK antes.', 1
    FROM (VALUES (N'INSERT'), (N'UPDATE'), (N'DELETE')) AS v (Permiso)
    OUTER APPLY (SELECT Quien = STRING_AGG(CONVERT(nvarchar(max), pr.name + N' (' + p.state_desc + N')') COLLATE DATABASE_DEFAULT, N', ')
                 FROM sys.database_permissions AS p
                 JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
                 WHERE p.class = 1 AND p.major_id = @tabla AND p.minor_id = 0 AND p.state = 'D'
                   AND p.permission_name = v.Permiso AND p.grantee_principal_id IN (SELECT Id FROM @quien)) AS d;

    -- Un GRANT UPDATE de COLUMNA le gana a un DENY de tabla (regla de SQL Server).
    DECLARE @colGrant nvarchar(max) = (SELECT STRING_AGG(CONVERT(nvarchar(max), pr.name + N':' + COL_NAME(p.major_id, p.minor_id) + N' ' + p.state_desc) COLLATE DATABASE_DEFAULT, N', ')
                                       FROM sys.database_permissions AS p JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
                                       WHERE p.class = 1 AND p.major_id = @tabla AND p.minor_id <> 0 AND p.permission_name = N'UPDATE'
                                         AND p.state IN ('G', 'W') AND p.grantee_principal_id IN (SELECT Id FROM @quien));
    INSERT @r SELECT '4 permisos', N'Sin GRANT UPDATE por columna (le ganaria al DENY de tabla)',
                     CASE WHEN @sitio IS NOT NULL AND @tabla IS NOT NULL AND @colGrant IS NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'ninguno', ISNULL(@colGrant, N'ninguno'), N'STOP: el DENY no protege esas columnas. Revisar con el DBA.', 1;

    -- db_owner o dueño del esquema/tabla no pasan por permisos: el DENY no aplica.
    DECLARE @dueno nvarchar(400) =
        CONCAT(CASE WHEN EXISTS (SELECT 1 FROM @quien WHERE Id = DATABASE_PRINCIPAL_ID(N'db_owner')) THEN N'miembro de db_owner; ' END,
               CASE WHEN (SELECT principal_id FROM sys.schemas WHERE name = N'adm') IN (SELECT Id FROM @quien) THEN N'dueno del esquema adm; ' END,
               CASE WHEN (SELECT principal_id FROM sys.objects WHERE object_id = @tabla) IN (SELECT Id FROM @quien) THEN N'dueno de la tabla; ' END);
    INSERT @r SELECT '4 permisos', N'PROACTIVANETAD no es db_owner ni dueno de adm / de la tabla',
                     CASE WHEN @sitio IS NOT NULL AND @dueno = N'' THEN 'PASS' ELSE 'FAIL' END,
                     N'ninguno', CASE WHEN @sitio IS NULL THEN N'usuario no visible' WHEN @dueno = N'' THEN N'ninguno' ELSE @dueno END,
                     N'STOP: el DENY no aplicaria a esa cuenta.', 1;

    -- Leer: el handler hace SELECT directo (sin procedimiento).
    DECLARE @lee bit = CASE WHEN EXISTS (SELECT 1 FROM @quien WHERE Id IN (DATABASE_PRINCIPAL_ID(N'db_datareader'), DATABASE_PRINCIPAL_ID(N'db_owner')))
                              OR EXISTS (SELECT 1 FROM sys.database_permissions AS p
                                         WHERE p.grantee_principal_id IN (SELECT Id FROM @quien) AND p.state IN ('G', 'W')
                                           AND p.permission_name IN (N'SELECT', N'CONTROL')
                                           AND ((p.class = 1 AND p.major_id = @tabla AND p.minor_id = 0) OR (p.class = 3 AND p.major_id = SCHEMA_ID(N'adm')) OR p.class = 0))
                            THEN 1 ELSE 0 END;
    DECLARE @niegaLeer nvarchar(max) = (SELECT STRING_AGG(CONVERT(nvarchar(max), pr.name + N' ' + p.class_desc) COLLATE DATABASE_DEFAULT, N', ')
                                        FROM sys.database_permissions AS p JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
                                        WHERE p.grantee_principal_id IN (SELECT Id FROM @quien) AND p.state = 'D' AND p.permission_name = N'SELECT'
                                          AND ((p.class = 1 AND p.major_id = @tabla) OR (p.class = 3 AND p.major_id = SCHEMA_ID(N'adm')) OR p.class = 0));
    INSERT @r SELECT '4 permisos', N'PROACTIVANETAD puede LEER la tabla (lo necesita el handler)',
                     CASE WHEN @sitio IS NOT NULL AND @tabla IS NOT NULL AND @lee = 1 AND @niegaLeer IS NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'SELECT por db_datareader o GRANT, sin DENY SELECT',
                     CONCAT(N'lee=', @lee, CASE WHEN @niegaLeer IS NOT NULL THEN N'; DENY SELECT: ' + @niegaLeer END),
                     N'STOP: la seccion daria error 500. Se resuelve con un GRANT SELECT (cambio aparte, con OK).', 1;

    /* ---------- 5. Quien depende de adm.IniciativaProtegida ---------- */
    DECLARE @mods TABLE (Id int PRIMARY KEY, Nombre nvarchar(300), Def nvarchar(max), Plano nvarchar(max));
    INSERT @mods (Id)
    SELECT m.object_id FROM sys.sql_modules AS m WHERE m.definition LIKE N'%IniciativaProtegida%'
    UNION
    SELECT d.referencing_id FROM sys.sql_expression_dependencies AS d
    WHERE d.referenced_id = @tabla OR d.referenced_entity_name = N'IniciativaProtegida';
    -- Los CHECK / DEFAULT de la PROPIA tabla no son dependencias (viajan con
    -- ella); se listan aparte. Sus triggers si cuentan (chequeo propio abajo).
    DELETE x FROM @mods AS x
    WHERE EXISTS (SELECT 1 FROM sys.objects AS o WHERE o.object_id = x.Id AND o.parent_object_id = @tabla AND o.type IN ('C', 'D'));
    INSERT @r SELECT '5 dependencias', N'Restricciones propias de la tabla (no cuentan)', 'INFO', NULL,
                     (SELECT STRING_AGG(CONVERT(nvarchar(max), o.name) COLLATE DATABASE_DEFAULT, N', ') FROM sys.objects AS o
                      WHERE o.parent_object_id = @tabla AND o.type IN ('C', 'D')), NULL, 0;
    UPDATE x SET Nombre = OBJECT_SCHEMA_NAME(x.Id) + N'.' + OBJECT_NAME(x.Id), Def = m.definition,
                 Plano = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.definition, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''), N'[', N''), N']', N''))
    FROM @mods AS x LEFT JOIN sys.sql_modules AS m ON m.object_id = x.Id;
    INSERT @r SELECT '5 dependencias', N'Modulos que la mencionan', 'INFO', NULL,
                     (SELECT STRING_AGG(CONVERT(nvarchar(max), ISNULL(Nombre, CONVERT(nvarchar(20), Id))) COLLATE DATABASE_DEFAULT, N', ') FROM @mods), NULL, 0;

    -- Revisados: Crear y Modificar (sus columnas son explicitas) y el
    -- cargador ADM_04 (solo lee x.Codigo).
    DECLARE @nulos int = (SELECT COUNT(*) FROM sys.sql_modules WHERE definition IS NULL);
    DECLARE @otros nvarchar(max) = (SELECT STRING_AGG(CONVERT(nvarchar(max), ISNULL(Nombre, CONVERT(nvarchar(20), Id))) COLLATE DATABASE_DEFAULT, N', ') FROM @mods
                                    WHERE ISNULL(Nombre, N'') NOT IN (N'adm.usp_GestionAdmin_Crear', N'adm.usp_GestionAdmin_Modificar', N'dbo.usp_CargarExperiencia'));
    INSERT @r SELECT '5 dependencias', N'Solo la usan los modulos revisados (Crear, Modificar, cargador) y todos los modulos son legibles',
                     CASE WHEN @otros IS NULL AND @nulos = 0 THEN 'PASS' ELSE 'FAIL' END,
                     N'ninguno mas; 0 definiciones NULL',
                     CONCAT(N'otros: ', ISNULL(@otros, N'ninguno'), N'; definiciones NULL en la base: ', @nulos),
                     N'STOP: revisar a mano que esos modulos no supongan las columnas de la tabla (o por que no se pueden leer).', 1;

    DECLARE @hCarg varbinary(32) = (SELECT HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(Def, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
                                    FROM @mods WHERE Nombre = N'dbo.usp_CargarExperiencia');
    INSERT @r SELECT '5 dependencias', N'Si el cargador la lee, es ADM_04 (revisado: solo lee Codigo)',
                     CASE WHEN NOT EXISTS (SELECT 1 FROM @mods WHERE Nombre = N'dbo.usp_CargarExperiencia') THEN 'PASS'
                          WHEN @hCarg = 0x74A5A01C6E05B4149A573EB6D28D0A60772B6626576CF1C64FA1177F111EC34F THEN 'PASS' ELSE 'FAIL' END,
                     N'no la lee, o ADM_04 0x74A5A01C...',
                     CASE WHEN NOT EXISTS (SELECT 1 FROM @mods WHERE Nombre = N'dbo.usp_CargarExperiencia') THEN N'no la lee'
                          ELSE ISNULL(CONVERT(nvarchar(70), @hCarg, 1), N'definicion NULL') END,
                     N'STOP: el cargador no es el revisado; revisar como lee la tabla.', 1;

    DECLARE @star nvarchar(max) = (SELECT STRING_AGG(CONVERT(nvarchar(max), ISNULL(Nombre, CONVERT(nvarchar(20), Id))) COLLATE DATABASE_DEFAULT, N', ') FROM @mods
                                   WHERE Plano LIKE N'%*fromadm.iniciativaprotegida%'
                                      OR Plano LIKE N'%insertadm.iniciativaprotegidavalues%' OR Plano LIKE N'%insertintoadm.iniciativaprotegidavalues%'
                                      OR Plano LIKE N'%insertadm.iniciativaprotegidaselect%' OR Plano LIKE N'%insertintoadm.iniciativaprotegidaselect%'
                                      OR Plano LIKE N'%insertadm.iniciativaprotegidaexec%'   OR Plano LIKE N'%insertintoadm.iniciativaprotegidaexec%'
                                      OR Plano LIKE N'%insertadm.iniciativaprotegidadefault%' OR Plano LIKE N'%insertintoadm.iniciativaprotegidadefault%');
    INSERT @r SELECT '5 dependencias', N'Sin SELECT * FROM la tabla ni INSERT sin lista de columnas',
                     CASE WHEN @star IS NULL AND NOT EXISTS (SELECT 1 FROM @mods WHERE Plano IS NULL) THEN 'PASS' ELSE 'FAIL' END,
                     N'ninguno', ISNULL(@star, N'ninguno'),
                     N'STOP: ese modulo cambiaria de forma (o fallaria) con las 2 columnas nuevas. Revisar a mano.', 1;

    DECLARE @trg nvarchar(max) = (SELECT STRING_AGG(CONVERT(nvarchar(max), name) COLLATE DATABASE_DEFAULT, N', ') FROM sys.triggers WHERE parent_id = @tabla);
    INSERT @r SELECT '5 dependencias', N'Sin triggers sobre la tabla', CASE WHEN @tabla IS NOT NULL AND @trg IS NULL THEN 'PASS' ELSE 'FAIL' END,
                     N'ninguno', ISNULL(@trg, N'ninguno'), N'STOP: un trigger podria suponer las columnas; revisarlo.', 1;

    DECLARE @atado nvarchar(max) = CONCAT(
        (SELECT STRING_AGG(CONVERT(nvarchar(max), OBJECT_SCHEMA_NAME(referencing_id) + N'.' + OBJECT_NAME(referencing_id) + N' (SCHEMABINDING)') COLLATE DATABASE_DEFAULT, N', ')
         FROM sys.sql_expression_dependencies AS d WHERE d.referenced_id = @tabla AND d.is_schema_bound_reference = 1
           AND NOT EXISTS (SELECT 1 FROM sys.objects AS o WHERE o.object_id = d.referencing_id AND o.parent_object_id = @tabla AND o.type IN ('C', 'D'))),
        (SELECT STRING_AGG(CONVERT(nvarchar(max), SCHEMA_NAME(schema_id) + N'.' + name + N' (sinonimo)') COLLATE DATABASE_DEFAULT, N', ')
         FROM sys.synonyms WHERE base_object_name LIKE N'%IniciativaProtegida%'));
    INSERT @r SELECT '5 dependencias', N'Sin vistas/funciones SCHEMABINDING ni sinonimos sobre la tabla',
                     CASE WHEN @tabla IS NOT NULL AND @atado = N'' THEN 'PASS' ELSE 'FAIL' END,
                     N'ninguno', CASE WHEN @atado = N'' THEN N'ninguno' ELSE @atado END, N'STOP: revisarlos a mano antes del ALTER TABLE.', 1;
    INSERT @r SELECT '5 dependencias', N'Limite: trabajos del Agente, otras bases, SQL dinamico armado fuera de la base y el sitio NO se ven aqui', 'INFO',
                     NULL, N'El sitio (App_Code) solo lee Codigo/UltimoCambio* con columnas explicitas.', NULL, 0;

    /* ---------- 6. Ahora mismo ---------- */
    -- APPLOCK_TEST solo pregunta; no toma el candado. 0 = el cargador del
    -- Excel (Exclusive) o un guardado de Admin (Shared) lo tiene ahora.
    DECLARE @libre int = APPLOCK_TEST(N'public', N'adm.proteccion', N'Exclusive', N'Session');
    INSERT @r SELECT '6 ahora', N'Nadie usa adm.proteccion (sin carga del Excel ni guardado de Admin en curso)',
                     CASE WHEN @libre = 1 THEN 'PASS' ELSE 'FAIL' END, N'1', CONVERT(nvarchar(10), @libre),
                     N'ESPERA: hay una carga o un guardado en curso. Repetir el preflight en unos minutos.', 1;
END TRY
BEGIN CATCH
    INSERT @r SELECT 'ERROR', N'El preflight fallo a medias', 'FAIL', NULL,
                     CONCAT(ERROR_NUMBER(), N': ', ERROR_MESSAGE()), N'STOP: el preflight no termino; nada de lo anterior basta.', 1;
END CATCH;

SELECT N, Seccion, Resultado, Chequeo, Esperado, Obtenido,
       SiFalla = CASE WHEN Resultado = 'FAIL' THEN SiFalla END
FROM @r ORDER BY N;

DECLARE @fail int = (SELECT COUNT(*) FROM @r WHERE Resultado = 'FAIL');
DECLARE @pass int = (SELECT COUNT(*) FROM @r WHERE Resultado = 'PASS' AND Obligatorio = 1);
SELECT Veredicto = CASE WHEN @fail = 0 AND @pass = @Obligatorios
                        THEN 'GO: los ' + CONVERT(varchar(10), @Obligatorios) + ' chequeos obligatorios en PASS. Se puede correr sql/23 (con su OK) en esta misma sesion/herramienta.'
                        ELSE 'STOP: NO correr sql/23. FAIL=' + CONVERT(varchar(10), @fail) + ', PASS obligatorios=' + CONVERT(varchar(10), @pass)
                             + ' de ' + CONVERT(varchar(10), @Obligatorios) + '.' END,
       Fail = @fail, PassObligatorios = @pass, Esperados = @Obligatorios;
