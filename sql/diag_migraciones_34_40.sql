/* =========================================================================
   sql/diag_migraciones_34_40.sql - DIAGNOSTICO DE SOLO LECTURA: que
   migraciones de 34 a 40 estan aplicadas en esta base.

   SOLO SELECT sobre vistas de catalogo, OBJECT_DEFINITION y conteos de
   adm.SolicitudCambio / adm.SolicitudVista. Sin EXEC, sin DDL/DML, sin
   tablas temporales, sin transacciones, sin SET que cambie la sesion.

   No hay tabla de bitacora de migraciones: ninguna de 18-40 escribe un
   registro de "aplicada". Lo unico que las delata son sus huellas en el
   catalogo (hash de procedimientos, nombres de CHECK, columnas, parametros,
   propiedades extendidas, DENY). Este script las lee todas.

   PERMISOS: los hashes necesitan VIEW DEFINITION (db_owner basta); sin el,
   OBJECT_DEFINITION da NULL y la fila dice "SIN VIEW DEFINITION" (no falla).
   El resto se ve con db_datareader. El bloque D (DENY ajenos) necesita
   db_owner o securityadmin.

   COMO CORRERLO (en la VM, cuenta con db_owner, p. ej. t_andresvr):
     sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -E -W -s "|" -i sql\diag_migraciones_34_40.sql
   o en SSMS con el script completo. Pegar el resultado completo.

   Hashes = SHA2_256 de OBJECT_DEFINITION sin espacios, tabs ni saltos de
   linea (regla de sql/20 a 40). SQL Server guarda un ALTER como CREATE y
   el comentario que precede al procedimiento en su lote forma parte del
   texto: una huella DESCONOCIDA = alguien lo altero a mano.
   ========================================================================= */
SET NOCOUNT ON;

/* 0 Base, cuenta y permisos de quien corre esto. */
SELECT [0] = 'Contexto', Base = DB_NAME(), Servidor = @@SERVERNAME, Version = CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion')),
       Cuenta = SUSER_SNAME(), EsDbOwner = IS_ROLEMEMBER('db_owner'),
       VeDefiniciones = CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar')) IS NULL THEN 0 ELSE 1 END,
       AhoraUtc = SYSUTCDATETIME(), HoyMexico = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));

/* A Huellas de los procedimientos que tocan 22-40. */
SELECT [A] = 'Huella', Objeto = s.name + N'.' + o.name, o.modify_date, h.Hash,
       Migracion = ISNULL(k.Migracion, CASE WHEN h.Hash IS NULL THEN N'SIN VIEW DEFINITION' ELSE N'DESCONOCIDA (alterado a mano?)' END)
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
CROSS APPLY (SELECT Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                 OBJECT_DEFINITION(o.object_id), N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))) AS h
LEFT JOIN (VALUES
    (N'usp_SolicitudCambio_Aplicar',   0x1FFE0F9A837E03F2440BCD98C96CD34F9238B143CA9E695BF0174AD61EAC95F1, N'sql/25'),
    (N'usp_SolicitudCambio_Aplicar',   0x4B62E0D32DD5A44343FBC06ABEC0DC4A775ECDE3778B62021213ECE89D46C804, N'sql/34 (o rollback de 40)'),
    (N'usp_SolicitudCambio_Aplicar',   0x65B3B38854E450D07421B84CAC9FBF0C8CE1CE50D87344E52FB100D0D2148DCB, N'sql/40'),
    (N'usp_SolicitudCambio_Crear',     0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71, N'sql/22'),
    (N'usp_SolicitudCambio_Crear',     0xDFEEB45304CD28D8F3E37F13179D584D9E3509C0909E60B98F78036CC0AC9203, N'sql/25'),
    (N'usp_SolicitudCambio_Crear',     0x2F495E310DCB799201BE1A449AAE283AFFE6F8936105547572E7EE21556E389D, N'sql/34 (o rollback de 37)'),
    (N'usp_SolicitudCambio_Crear',     0x037DBD39F5D6DAEFB9A99C15E7C0B1DBAA070C5BDB0A9E63CB1E32FFDCE19642, N'sql/37 (o rollback de 38)'),
    (N'usp_SolicitudCambio_Crear',     0xBE78FC96094FA3C918CACB3A59BF6340FA77734268BED6315F4D2485AEF6A95F, N'sql/38'),
    (N'usp_GestionAdmin_Modificar',    0xBEEF50D59D15F18403C975A8BCCEBF3556C102E4DC3B2598FADC546FD927BF77, N'sql/24'),
    (N'usp_GestionAdmin_Modificar',    0x68331AC9641DBFD6A83213F5E74E23A5FA4F4CC8BC03F040A965269AC98B1054, N'sql/83'),
    (N'usp_SolicitudCambio_Aplicar',   0x8464627C052EA87A5792C1CE27477D3D04638A391FD29C66352BA66C295B218D, N'sql/83'),
    (N'usp_SolicitudCambio_Crear',     0x08CED77CF27E9E929F264377B1059541E8C6CBD050B909D03FA58952613EE842, N'sql/83'),
    (N'usp_SolicitudIniciativa_Crear', 0x518234C546F607D7FF3DA64DDB0BBE167002DA7BC31C6C897CF9A2C82050761A, N'sql/29 (o rollback de 36)'),
    (N'usp_SolicitudIniciativa_Crear', 0x0484CDBC320573111B3EE245FA1E225F83DC65E7078213DE1C4C275C70E51D5A, N'sql/36'),
    (N'usp_SolicitudIniciativa_AprobarYCrear', 0x7CE867AFD23F970E867A7D5FEC97E9C221047DA584BE78EC43347313A0367CAC, N'sql/32'),
    (N'usp_SolicitudVista_Marcar',     0x20207136ED62E5F1EF61DD79B8536615028C25F3B1D4639465E72819B9F5CAAD, N'sql/39')
    ) AS k (Nombre, Hash, Migracion) ON k.Nombre = o.name AND k.Hash = h.Hash
WHERE s.name = N'adm' AND o.type = 'P'
  AND o.name IN (N'usp_SolicitudCambio_Aplicar', N'usp_SolicitudCambio_Crear', N'usp_GestionAdmin_Modificar',
                 N'usp_SolicitudIniciativa_Crear', N'usp_SolicitudIniciativa_AprobarYCrear', N'usp_SolicitudVista_Marcar')
ORDER BY o.name;

/* B Marcadores de cada migracion (no necesitan VIEW DEFINITION).
   Esperado = lo que deja la migracion aplicada; Hay = lo que hay ahora. */
SELECT [B] = 'Marcador', m.Migracion, m.Marcador, m.Esperado, m.Hay,
       Coincide = CASE WHEN m.Esperado = m.Hay THEN 'SI' ELSE 'NO' END
FROM (VALUES
    (N'sql/34', N'columnas Cambia*/F* de adm.SolicitudCambio', N'9',
        CONVERT(nvarchar(20), (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(N'adm.SolicitudCambio')
            AND name IN (N'CambiaFAnalisis', N'FAnalisisAnterior', N'FAnalisisNueva', N'CambiaFSolucion', N'FSolucionAnterior',
                         N'FSolucionNueva', N'CambiaFCierre', N'FCierreAnterior', N'FCierreNueva')))),
    (N'sql/34', N'CK_SolicitudCambio_Varios + _FechasVarias', N'2',
        CONVERT(nvarchar(20), (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'adm.SolicitudCambio')
            AND name IN (N'CK_SolicitudCambio_Varios', N'CK_SolicitudCambio_FechasVarias')))),
    (N'sql/34', N'parametros de usp_SolicitudCambio_Crear', N'25',
        CONVERT(nvarchar(20), (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear')))),
    (N'sql/35', N'dbo.UsuariosAdmin.NombreSolicitante nvarchar(255) NULL', N'nvarchar(255) NULL',
        ISNULL((SELECT TYPE_NAME(c.user_type_id) + N'(' + CONVERT(nvarchar(10), c.max_length / 2) + N')' + CASE WHEN c.is_nullable = 1 THEN N' NULL' ELSE N' NOT NULL' END
                FROM sys.columns AS c WHERE c.object_id = OBJECT_ID(N'dbo.UsuariosAdmin') AND c.name = N'NombreSolicitante'), N'(no existe)')),
    (N'sql/36', N'adm.fn_ClaveCorreo + adm.fn_ClaveNombre', N'2',
        CONVERT(nvarchar(20), (SELECT COUNT(*) FROM sys.objects WHERE schema_id = SCHEMA_ID(N'adm') AND name IN (N'fn_ClaveCorreo', N'fn_ClaveNombre')))),
    (N'sql/36', N'parametro @FuenteSolicitante en usp_SolicitudIniciativa_Crear', N'1',
        CONVERT(nvarchar(20), (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudIniciativa_Crear') AND name = N'@FuenteSolicitante'))),
    (N'sql/36', N'CK_SolicitudIniciativa_FuenteNombre', N'1',
        CONVERT(nvarchar(20), (SELECT COUNT(*) FROM sys.check_constraints WHERE name = N'CK_SolicitudIniciativa_FuenteNombre' AND parent_object_id = OBJECT_ID(N'adm.SolicitudIniciativa')))),
    (N'sql/36', N'adm.SolicitudIniciativa.SolicitanteNombre admite NULL', N'1',
        ISNULL((SELECT CONVERT(nvarchar(20), CONVERT(int, is_nullable)) FROM sys.columns WHERE object_id = OBJECT_ID(N'adm.SolicitudIniciativa') AND name = N'SolicitanteNombre'), N'(no existe)')),
    (N'sql/37', N'CK_SolicitudCambio_RolPso (confiable) y sin CK_SolicitudCambio_Rol', N'RolPso=1;Rol=0',
        N'RolPso=' + CONVERT(nvarchar(5), (SELECT COUNT(*) FROM sys.check_constraints WHERE name = N'CK_SolicitudCambio_RolPso' AND parent_object_id = OBJECT_ID(N'adm.SolicitudCambio') AND is_not_trusted = 0))
        + N';Rol=' + CONVERT(nvarchar(5), (SELECT COUNT(*) FROM sys.check_constraints WHERE name = N'CK_SolicitudCambio_Rol' AND parent_object_id = OBJECT_ID(N'adm.SolicitudCambio')))),
    (N'sql/38', N'propiedad ReglaPso en usp_SolicitudCambio_Crear', N'EQUIPO_PO',
        ISNULL((SELECT CONVERT(nvarchar(50), value) FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
                AND major_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P') AND name = N'ReglaPso'), N'(no existe)')),
    (N'sql/39', N'adm.SolicitudVista + adm.usp_SolicitudVista_Marcar', N'2',
        CONVERT(nvarchar(20), (CASE WHEN OBJECT_ID(N'adm.SolicitudVista', N'U') IS NULL THEN 0 ELSE 1 END)
                            + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudVista_Marcar', N'P') IS NULL THEN 0 ELSE 1 END))),
    (N'sql/40', N'(solo huella: Aplicar = 0x65B3B388..., ver bloque A)', N'-', N'-')
    ) AS m (Migracion, Marcador, Esperado, Hay)
ORDER BY m.Migracion, m.Marcador;

/* C Datos que afectan aplicar 37 / 40 (conteos; ningun dato personal). */
SELECT [C] = 'Solicitudes de cambio', Estado, Tipo, RolSolicitante, Filas = COUNT(*)
FROM adm.SolicitudCambio GROUP BY Estado, Tipo, RolSolicitante ORDER BY Estado, Tipo, RolSolicitante;
-- Pendientes que sql/40 cambiaria al aplicarse (entran a Cerrado sin pedir FechaCierre).
SELECT [C2] = 'Pendientes que entran a Cerrado', s.IdSolicitud, s.Tipo, s.EstadoAnterior, s.EstadoNuevo,
       FechaCierreActual = p.FechaCierre, PideCampoFecha = s.CampoFecha, PideFCierreVarios = s.CambiaFCierre
FROM adm.SolicitudCambio AS s
LEFT JOIN dbo.Problem AS p ON p.Codigo = s.Codigo
WHERE s.Estado = 'PENDIENTE' AND LTRIM(RTRIM(s.EstadoNuevo)) COLLATE Latin1_General_CI_AI = N'Cerrado'
ORDER BY s.IdSolicitud;

/* D sql/39: DENY de escritura a PROACTIVANETAD sobre adm.SolicitudVista (esperado 3). */
SELECT [D] = 'DENY sql/39', DenyEscritura = COUNT(*)
FROM sys.database_permissions AS p
WHERE p.major_id = OBJECT_ID(N'adm.SolicitudVista') AND p.state = 'D'
  AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
  AND p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD');
