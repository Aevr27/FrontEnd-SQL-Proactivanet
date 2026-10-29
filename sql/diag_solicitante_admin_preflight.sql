/* =========================================================================
   sql/diag_solicitante_admin_preflight.sql - PREFLIGHT de SOLO LECTURA para
   las propuestas de 2026-10-29 (NombreSolicitante en dbo.UsuariosAdmin,
   solicitante ADM/MOD en Nueva solicitud y "Solicitar cambios" para PO/SO).

   SOLO SELECT sobre vistas de catalogo, dbo.UsuariosAdmin,
   adm.SolicitudIniciativa y adm.SolicitudCambio. Sin tablas temporales, sin
   EXEC, sin DDL/DML, sin transacciones. No necesita EXECUTE ni permisos de
   escritura. Cada consulta es independiente: si una falla por permisos, las
   demas siguen (correr con sqlcmd SIN -b, o en SSMS).

   PERMISOS (cada bloque dice lo que necesita)
     A  SELECT sobre las tablas (db_datareader basta): datos y metadatos que
        cualquier lector ve (columnas, nombres de CHECK, parametros).
     B  VIEW DEFINITION (o db_owner): huellas (hash) de procedimientos,
        definiciones de CHECK y DEFAULT, modulos que mencionan las tablas,
        triggers. Sin ese permiso las definiciones salen NULL (no falla).
     C  VIEW DEFINITION + ver permisos ajenos (db_owner / securityadmin):
        permisos sobre las tablas, miembros de roles, duenos de esquema. Sin
        ese permiso solo salen los permisos propios y de public.
     El bloque 0 dice que permisos tiene QUIEN lo corre.

   QUE NO VE: aplicaciones o scripts FUERA de la base que escriban
   dbo.UsuariosAdmin (por ejemplo un INSERT sin lista de columnas). Eso solo
   lo puede confirmar quien administra la tabla.

   Como correrlo en la VM:
     sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -E -y 0 -i sql\diag_solicitante_admin_preflight.sql
   ========================================================================= */
SET NOCOUNT ON;

/* ---------- 0. Quien corre y con que permisos ---------- */
SELECT P0 = 'Permisos de quien corre',
       Usuario = USER_NAME(), Login = SUSER_SNAME(), Base = DB_NAME(),
       VerDefiniciones = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION'),
       EsDbOwner = IS_ROLEMEMBER('db_owner'),
       LeeUsuariosAdmin = HAS_PERMS_BY_NAME('dbo.UsuariosAdmin', 'OBJECT', 'SELECT'),
       LeeSolicitudIniciativa = HAS_PERMS_BY_NAME('adm.SolicitudIniciativa', 'OBJECT', 'SELECT'),
       LeeSolicitudCambio = HAS_PERMS_BY_NAME('adm.SolicitudCambio', 'OBJECT', 'SELECT'),
       VersionSql = CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion'));

/* =========================================================================
   A. SELECT basta
   ========================================================================= */

/* A1 Columnas reales de dbo.UsuariosAdmin (tipo, largo en caracteres, NULL, identidad, calculada). */
SELECT A1 = 'Columnas dbo.UsuariosAdmin', c.column_id, c.name, Tipo = TYPE_NAME(c.user_type_id),
       Largo = CASE WHEN TYPE_NAME(c.user_type_id) IN (N'nvarchar', N'nchar') AND c.max_length > 0 THEN c.max_length / 2 ELSE c.max_length END,
       c.is_nullable, c.is_identity, c.is_computed
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'dbo.UsuariosAdmin')
ORDER BY c.column_id;

/* A2 Llaves, CHECK, indices y triggers de dbo.UsuariosAdmin (solo nombres). */
SELECT A2 = 'Objetos de dbo.UsuariosAdmin', Nombre = k.name, k.type_desc
FROM sys.key_constraints AS k WHERE k.parent_object_id = OBJECT_ID(N'dbo.UsuariosAdmin')
UNION ALL
SELECT 'Objetos de dbo.UsuariosAdmin', cc.name, cc.type_desc
FROM sys.check_constraints AS cc WHERE cc.parent_object_id = OBJECT_ID(N'dbo.UsuariosAdmin')
UNION ALL
SELECT 'Objetos de dbo.UsuariosAdmin', dc.name, dc.type_desc
FROM sys.default_constraints AS dc WHERE dc.parent_object_id = OBJECT_ID(N'dbo.UsuariosAdmin')
UNION ALL
SELECT 'Objetos de dbo.UsuariosAdmin', ISNULL(i.name, N'(heap)'), N'INDEX ' + i.type_desc + CASE WHEN i.is_unique = 1 THEN N' UNIQUE' ELSE N'' END
FROM sys.indexes AS i WHERE i.object_id = OBJECT_ID(N'dbo.UsuariosAdmin')
UNION ALL
SELECT 'Objetos de dbo.UsuariosAdmin', t.name, N'TRIGGER' + CASE WHEN t.is_disabled = 1 THEN N' (deshabilitado)' ELSE N'' END
FROM sys.triggers AS t WHERE t.parent_id = OBJECT_ID(N'dbo.UsuariosAdmin');

/* A3 Calidad de datos por cuenta (como la compara el sitio: sin espacios ni mayusculas). */
SELECT A3 = 'Cuentas dbo.UsuariosAdmin',
       Cuenta = UPPER(LTRIM(RTRIM(u.Usuario))),
       Filas = COUNT(*),
       Accesos = COUNT(DISTINCT UPPER(LTRIM(RTRIM(u.Acceso)))),
       AccesoNoAdmMod = SUM(CASE WHEN u.Acceso IS NULL OR UPPER(LTRIM(RTRIM(u.Acceso))) NOT IN (N'ADM', N'MOD') THEN 1 ELSE 0 END),
       CorreosDistintos = COUNT(DISTINCT LOWER(NULLIF(LTRIM(RTRIM(u.CorreoUsuario)), N''))),
       FilasSinCorreo = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(u.CorreoUsuario)), N'') IS NULL THEN 1 ELSE 0 END)
FROM dbo.UsuariosAdmin AS u
GROUP BY UPPER(LTRIM(RTRIM(u.Usuario)))
ORDER BY Cuenta;

/* A4 Tabla de solicitudes: columnas que cambiarian y nombres de sus CHECK. */
SELECT A4 = 'Columnas adm.SolicitudIniciativa', c.name, Tipo = TYPE_NAME(c.user_type_id),
       Largo = CASE WHEN TYPE_NAME(c.user_type_id) IN (N'nvarchar', N'nchar') AND c.max_length > 0 THEN c.max_length / 2 ELSE c.max_length END,
       c.is_nullable
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'adm.SolicitudIniciativa')
  AND c.name IN (N'SolicitanteCuenta', N'SolicitanteNombre', N'SolicitanteCorreo', N'FuenteCorreos',
                 N'RevisadoPor', N'CodigoIniciativa')
ORDER BY c.column_id;
SELECT A4b = 'CHECK de adm.SolicitudIniciativa (nombres)', cc.name, cc.is_disabled, cc.is_not_trusted
FROM sys.check_constraints AS cc WHERE cc.parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa')
ORDER BY cc.name;

/* A5 Solicitudes guardadas por fuente, estado y nombre. */
SELECT A5 = 'Solicitudes por fuente', s.FuenteCorreos, s.Estado, Solicitudes = COUNT(*),
       SinNombre = SUM(CASE WHEN s.SolicitanteNombre IS NULL THEN 1 ELSE 0 END)
FROM adm.SolicitudIniciativa AS s
GROUP BY s.FuenteCorreos, s.Estado
ORDER BY s.FuenteCorreos, s.Estado;

/* A6 Que procedimientos existen y sus parametros (sys.parameters se ve con EXECUTE o SELECT). */
SELECT A6 = 'Procedimientos adm', o.name, Parametros = COUNT(p.parameter_id),
       TieneFuenteSolicitante_propuesta = MAX(CASE WHEN p.name = N'@FuenteSolicitante' THEN 1 ELSE 0 END),
       TieneCambiaTitulo_sql25 = MAX(CASE WHEN p.name = N'@CambiaTitulo' THEN 1 ELSE 0 END),
       TieneCambiaFAnalisis_sql34 = MAX(CASE WHEN p.name = N'@CambiaFAnalisis' THEN 1 ELSE 0 END)
FROM sys.objects AS o
LEFT JOIN sys.parameters AS p ON p.object_id = o.object_id
WHERE o.schema_id = SCHEMA_ID(N'adm') AND o.type = 'P'
  AND (o.name LIKE N'usp[_]SolicitudIniciativa[_]%' OR o.name LIKE N'usp[_]SolicitudCambio[_]%' OR o.name = N'usp_GestionAdmin_Crear')
GROUP BY o.name
ORDER BY o.name;

/* A7 Solicitudes de cambio: tipo de RolSolicitante y valores guardados. */
SELECT A7 = 'Columna adm.SolicitudCambio.RolSolicitante', Tipo = TYPE_NAME(c.user_type_id), c.max_length, c.is_nullable
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'adm.SolicitudCambio') AND c.name = N'RolSolicitante';
SELECT A7b = 'Solicitudes de cambio por rol', sc.RolSolicitante, sc.Estado, Solicitudes = COUNT(*)
FROM adm.SolicitudCambio AS sc
GROUP BY sc.RolSolicitante, sc.Estado
ORDER BY sc.RolSolicitante, sc.Estado;

/* =========================================================================
   B. VIEW DEFINITION (sin el, las columnas de definicion salen NULL)
   ========================================================================= */

/* B1 Huellas de los procedimientos y a que migracion corresponden. Regla de
   20-25: SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni saltos. */
SELECT B1 = 'Huella de procedimientos', o.name, h.Hash,
       Migracion = ISNULL(k.Migracion, CASE WHEN h.Hash IS NULL THEN N'(sin VIEW DEFINITION o no existe)' ELSE N'DESCONOCIDA' END)
FROM sys.objects AS o
CROSS APPLY (SELECT Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                 OBJECT_DEFINITION(o.object_id), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h
LEFT JOIN (VALUES
    (N'usp_SolicitudIniciativa_Crear',    0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A, N'sql/29'),
    (N'usp_SolicitudIniciativa_Aprobar',  0x4C3C621D7F415A6F1F1768A8D0668818B2046E72C0E342417E572C608C7D9906, N'sql/31'),
    (N'usp_SolicitudIniciativa_Rechazar', 0x89E470DEDECEA1AE7E310B884B958EED55A504355E1B1C617C1346F7EDD8E416, N'sql/31'),
    (N'usp_SolicitudCambio_Crear',        0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71, N'sql/22'),
    (N'usp_SolicitudCambio_Crear',        0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203, N'sql/25'),
    (N'usp_SolicitudCambio_Crear',        0x2F495E310DCB799201BE1A449AAE283AFFE6F8936105547572E7EE21556E389D, N'sql/34'),
    (N'usp_GestionAdmin_Crear',           0x6D8BE5D83F74B68CC651D8CDF9283BC6C3A536D112700082449518CDAE14B2BD, N'sql/27'),
    (N'usp_SolicitudIniciativa_AprobarYCrear', 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC, N'sql/32'),
    (N'usp_SolicitudCambio_Aplicar',      0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804, N'sql/34'),
    (N'usp_SolicitudIniciativa_Crear',    0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A, N'sql/36'),
    (N'usp_SolicitudCambio_Crear',        0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642, N'sql/37')
    ) AS k (Nombre, Hash, Migracion) ON k.Nombre = o.name AND k.Hash = h.Hash
WHERE o.schema_id = SCHEMA_ID(N'adm') AND o.type = 'P'
  AND (o.name LIKE N'usp[_]SolicitudIniciativa[_]%' OR o.name LIKE N'usp[_]SolicitudCambio[_]%' OR o.name = N'usp_GestionAdmin_Crear')
ORDER BY o.name;

/* B2 Definiciones de CHECK y DEFAULT que cambiarian. */
SELECT B2 = 'Definiciones', Tabla = OBJECT_SCHEMA_NAME(cc.parent_object_id) + N'.' + OBJECT_NAME(cc.parent_object_id),
       cc.name, cc.definition
FROM sys.check_constraints AS cc
WHERE cc.parent_object_id IN (OBJECT_ID(N'dbo.UsuariosAdmin'), OBJECT_ID(N'adm.SolicitudIniciativa'), OBJECT_ID(N'adm.SolicitudCambio'))
UNION ALL
SELECT 'Definiciones', OBJECT_SCHEMA_NAME(dc.parent_object_id) + N'.' + OBJECT_NAME(dc.parent_object_id), dc.name, dc.definition
FROM sys.default_constraints AS dc
WHERE dc.parent_object_id = OBJECT_ID(N'dbo.UsuariosAdmin')
ORDER BY Tabla, name;

/* B3 Modulos de la base (vistas, procedimientos, funciones, triggers) que
   mencionan lo que cambiaria. Un INSERT sin lista de columnas sobre
   dbo.UsuariosAdmin se veria aqui (InsertSinColumnas = 1 es una pista para
   revisar a mano, no una prueba). */
SELECT B3 = 'Modulos que lo mencionan', Esquema = OBJECT_SCHEMA_NAME(m.object_id), Objeto = OBJECT_NAME(m.object_id), o.type_desc,
       UsuariosAdmin = CASE WHEN m.definition LIKE N'%UsuariosAdmin%' THEN 1 ELSE 0 END,
       InsertSinColumnas = CASE WHEN m.definition LIKE N'%INSERT%UsuariosAdmin%VALUES%'
                                 AND m.definition NOT LIKE N'%INSERT%UsuariosAdmin%(%Usuario%' THEN 1 ELSE 0 END,
       SelectAsterisco = CASE WHEN m.definition LIKE N'%SELECT%*%FROM%UsuariosAdmin%' THEN 1 ELSE 0 END,
       SolicitanteNombre = CASE WHEN m.definition LIKE N'%SolicitanteNombre%' THEN 1 ELSE 0 END,
       FuenteCorreos = CASE WHEN m.definition LIKE N'%FuenteCorreos%' THEN 1 ELSE 0 END,
       RolSolicitante = CASE WHEN m.definition LIKE N'%RolSolicitante%' THEN 1 ELSE 0 END
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE m.definition LIKE N'%UsuariosAdmin%' OR m.definition LIKE N'%SolicitanteNombre%'
   OR m.definition LIKE N'%FuenteCorreos%' OR m.definition LIKE N'%RolSolicitante%'
ORDER BY Esquema, Objeto;

/* B4 Dependencias registradas por el motor (incluye las de esquema enlazado). */
SELECT B4 = 'Dependencias', Desde = OBJECT_SCHEMA_NAME(d.referencing_id) + N'.' + OBJECT_NAME(d.referencing_id),
       Hacia = ISNULL(d.referenced_schema_name, N'') + N'.' + d.referenced_entity_name, d.is_schema_bound_reference
FROM sys.sql_expression_dependencies AS d
WHERE d.referenced_id IN (OBJECT_ID(N'dbo.UsuariosAdmin'), OBJECT_ID(N'adm.SolicitudIniciativa'), OBJECT_ID(N'adm.SolicitudCambio'))
ORDER BY Desde, Hacia;

/* =========================================================================
   C. VIEW DEFINITION + ver permisos ajenos (db_owner / securityadmin)
   ========================================================================= */

/* C1 Permisos explicitos sobre las tablas y lo de PROACTIVANETAD en adm. */
SELECT C1 = 'Permisos', Principal = pr.name, pr.type_desc, p.class_desc,
       Objeto = CASE p.class WHEN 1 THEN OBJECT_SCHEMA_NAME(p.major_id) + N'.' + OBJECT_NAME(p.major_id)
                             WHEN 3 THEN SCHEMA_NAME(p.major_id) ELSE N'(base)' END,
       p.permission_name, p.state_desc
FROM sys.database_permissions AS p
JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE (p.class = 1 AND p.major_id IN (OBJECT_ID(N'dbo.UsuariosAdmin'), OBJECT_ID(N'adm.SolicitudIniciativa'),
                                      OBJECT_ID(N'adm.SolicitudCambio'), OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear'),
                                      OBJECT_ID(N'adm.usp_SolicitudCambio_Crear')))
   OR (pr.name = N'PROACTIVANETAD' AND p.class IN (0, 3))
ORDER BY Principal, Objeto, p.permission_name;

/* C2 Roles de la cuenta del sitio. */
SELECT C2 = 'Roles de PROACTIVANETAD', Rol = r.name
FROM sys.database_role_members AS rm
JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals AS m ON m.principal_id = rm.member_principal_id
WHERE m.name = N'PROACTIVANETAD'
ORDER BY r.name;

/* C3 Duenos de los esquemas: si adm y dbo tienen el mismo dueno, un
   procedimiento de adm lee dbo.UsuariosAdmin por encadenamiento de
   propietario (como ya lee dbo.CatPersona). */
SELECT C3 = 'Duenos de esquema', Esquema = s.name, Dueno = USER_NAME(s.principal_id)
FROM sys.schemas AS s
WHERE s.name IN (N'adm', N'dbo');
