/* =========================================================================
   sql/39_solicitudes_vistas.sql - "vista por el revisor": que solicitudes
   pendientes ya abrio CADA ADM, para el aviso de la pestaña Solicitudes
   (admin/aviso-solicitudes.js, App_Code/SolicitudesVistas.cs).

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   QUE CREA (una transaccion; NO altera nada que ya exista)
     adm.SolicitudVista             vista = hay fila (tipo, id, usuario).
                                    Tipo CAMBIO = adm.SolicitudCambio
                                    (IdSolicitud); NUEVA =
                                    adm.SolicitudIniciativa (NumeroSolicitud).
     adm.usp_SolicitudVista_Marcar  unica escritura de "vista".
     DENY INSERT/UPDATE/DELETE de PROACTIVANETAD sobre la tabla
     (db_datawriter le dejaria escribirla a mano; como sql/28).
   0 filas de otras tablas tocadas. adm.SolicitudCambio y
   adm.SolicitudIniciativa solo se LEEN: marcar como vista NO cambia el
   Estado de la solicitud ni lo que vio otro ADM.

   POR USUARIO
     @Usuario lo pone el servidor (AccesoAdmin.IdentidadEscritura: la cuenta
     de IIS), nunca el formulario; se guarda sin espacios y en minusculas,
     asi "SORIANA\Ana" y "soriana\ana" son la misma persona.

   LO PENDIENTE NO SE GUARDA AQUI
     Pendiente = SolicitudCambio PENDIENTE + SolicitudIniciativa ENVIADA,
     leido en cada consulta. Al aplicar / aprobar / rechazar deja de contar
     solo (su fila de vista queda como historia y no estorba).

   ERRORES (THROW)
     51391 sin usuario   51392 tipo distinto de CAMBIO / NUEVA
     51393 la solicitud no existe

   DEPENDENCIAS
     sql/22 (adm.SolicitudCambio) y sql/29 (adm.SolicitudIniciativa). No las
     cambia. El sitio detecta las dos piezas (AlmacenVistasSql.Disponible):
     sin ellas el aviso solo muestra el punto de "hay pendientes", sin
     numero; se puede aplicar antes o despues del despliegue.

   PERMISOS
     PROACTIVANETAD: lee (db_datareader) y ejecuta (EXECUTE sobre adm, de
     sql/18) sin nada nuevo; el DENY de abajo le quita escribir a mano. Si el
     usuario no existe en la base (LocalDB de pruebas) el DENY se omite.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'39';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   Rollback: sql/39_solicitudes_vistas_rollback.sql.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'39'
BEGIN
    RAISERROR (N'Migracion 39 SIN APROBAR: declara aprobar_migracion = 39 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @hay int = (CASE WHEN OBJECT_ID(N'adm.SolicitudVista', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudVista_Marcar', N'P') IS NULL THEN 0 ELSE 1 END);
IF @hay > 0 OR SCHEMA_ID(N'adm') IS NULL
   OR COL_LENGTH(N'adm.SolicitudCambio', N'IdSolicitud') IS NULL OR COL_LENGTH(N'adm.SolicitudCambio', N'Estado') IS NULL
   OR COL_LENGTH(N'adm.SolicitudIniciativa', N'NumeroSolicitud') IS NULL OR COL_LENGTH(N'adm.SolicitudIniciativa', N'Estado') IS NULL
BEGIN
    ROLLBACK;
    IF @hay = 2
        RAISERROR (N'Migracion 39: ya aplicada. No se toca nada.', 16, 1);
    ELSE IF @hay > 0
        RAISERROR (N'Migracion 39: hay %d de 2 objetos de sql/39 (a medias o a mano). No se toca nada.', 16, 1, @hay);
    ELSE
        RAISERROR (N'Migracion 39: falta sql/22 (adm.SolicitudCambio) o sql/29 (adm.SolicitudIniciativa). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 39: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Tabla ---------- */
CREATE TABLE adm.SolicitudVista
(
    Tipo        varchar(6)    NOT NULL CONSTRAINT CK_SolicitudVista_Tipo CHECK (Tipo IN ('CAMBIO', 'NUEVA')),
    IdSolicitud int           NOT NULL CONSTRAINT CK_SolicitudVista_Id CHECK (IdSolicitud > 0),
    Usuario     nvarchar(256) NOT NULL CONSTRAINT CK_SolicitudVista_Usuario CHECK (LEN(LTRIM(RTRIM(Usuario))) > 0),
    VistaUtc    datetime2(0)  NOT NULL CONSTRAINT DF_SolicitudVista_Fecha DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_SolicitudVista PRIMARY KEY CLUSTERED (Tipo, IdSolicitud, Usuario)
);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 39: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. adm.usp_SolicitudVista_Marcar ---------- */
CREATE PROCEDURE adm.usp_SolicitudVista_Marcar
    @Usuario     nvarchar(256),
    @Tipo        varchar(6),
    @IdSolicitud int,
    @Nueva       bit OUTPUT       -- 0 = ese usuario ya la habia visto
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Usuario = LOWER(NULLIF(LTRIM(RTRIM(@Usuario)), N''));
    SET @Nueva = 0;
    IF @Usuario IS NULL THROW 51391, N'Sin usuario no se marca nada.', 1;
    IF @Tipo IS NULL OR @Tipo NOT IN ('CAMBIO', 'NUEVA') THROW 51392, N'Tipo de solicitud desconocido.', 1;

    BEGIN TRY
        BEGIN TRAN;
            IF (@Tipo = 'CAMBIO' AND NOT EXISTS (SELECT 1 FROM adm.SolicitudCambio WHERE IdSolicitud = @IdSolicitud))
               OR (@Tipo = 'NUEVA' AND NOT EXISTS (SELECT 1 FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = @IdSolicitud))
                THROW 51393, N'La solicitud no existe.', 1;
            IF NOT EXISTS (SELECT 1 FROM adm.SolicitudVista WITH (UPDLOCK, HOLDLOCK)
                           WHERE Tipo = @Tipo AND IdSolicitud = @IdSolicitud AND Usuario = @Usuario)
            BEGIN
                INSERT adm.SolicitudVista (Tipo, IdSolicitud, Usuario) VALUES (@Tipo, @IdSolicitud, @Usuario);
                SET @Nueva = 1;
            END;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SET @Nueva = 0;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 39: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. Permisos ---------- */
IF DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NOT NULL
    DENY INSERT, UPDATE, DELETE ON adm.SolicitudVista TO [PROACTIVANETAD];
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 39: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 4. Postcondicion ---------- */
DECLARE @obj int = (CASE WHEN OBJECT_ID(N'adm.SolicitudVista', N'U') IS NULL THEN 0 ELSE 1 END)
                 + (CASE WHEN OBJECT_ID(N'adm.usp_SolicitudVista_Marcar', N'P') IS NULL THEN 0 ELSE 1 END);
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1
                       AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id = OBJECT_ID(N'adm.SolicitudVista'));
DECLARE @esperados int = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 3 END;
IF @obj = 2 AND @deny = @esperados AND NOT EXISTS (SELECT 1 FROM adm.SolicitudVista)
BEGIN
    COMMIT;
    SELECT Migracion = N'39', Resultado = 'APLICADA', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 39: quedaron %d de 2 objetos y %d de %d DENY; ROLLBACK de todo.', 16, 1, @obj, @deny, @esperados);
END;
GO
SET NOEXEC OFF;
GO
