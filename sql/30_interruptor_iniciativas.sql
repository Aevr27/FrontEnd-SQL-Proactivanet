/* =========================================================================
   sql/30_interruptor_iniciativas.sql - el interruptor global "Iniciativas
   abiertas" pasa de Web.config (clave IniciativasAbiertas, ya ignorada) a la
   base.

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM.

   POR QUE UNA TABLA NUEVA
     En la base no hay tabla de configuracion de la aplicacion. dbo.UsuariosAdmin
     es un rol POR PERSONA (Usuario, CorreoUsuario, Acceso ADM/MOD con CHECK):
     un interruptor global no es una persona y meter ahi a cada empleado
     daria miles de filas. orq.Parametro es de la orquestacion (y guarda
     costos reservados): otro dominio. Por eso una tabla pequena en adm.

   QUE CREA (una transaccion; NO altera nada que ya exista)
     adm.Interruptor   una fila por interruptor global de la aplicacion.
                       Hoy solo INICIATIVAS_ABIERTAS, creada APAGADA
                       (Encendido = 0).
     DENY INSERT/UPDATE/DELETE de PROACTIVANETAD (la cuenta del sitio): el
     sitio solo LEE (db_datareader); ni el sitio ni un formulario pueden
     encenderlo.
   0 filas de dbo tocadas. No toca sql/29 ni sus tablas.

   COMO LO LEE EL SITIO (App_Code/AccesoIniciativas.cs)
     SELECT Encendido FROM adm.Interruptor WHERE Clave = 'INICIATIVAS_ABIERTAS'
     Solo Encendido = 1 abre. Fila ausente, tabla ausente o error: APAGADO.
     Una lectura por request, sin cache entre requests: el cambio vale en el
     siguiente request, sin reiniciar el sitio.

   ENCENDER / APAGAR (operador autorizado; NO la cuenta del sitio)
     Encender:
       UPDATE adm.Interruptor
          SET Encendido = 1, ModificadoPor = SUSER_SNAME(), ModificadoUtc = SYSUTCDATETIME()
        WHERE Clave = 'INICIATIVAS_ABIERTAS';
     Apagar:
       UPDATE adm.Interruptor
          SET Encendido = 0, ModificadoPor = SUSER_SNAME(), ModificadoUtc = SYSUTCDATETIME()
        WHERE Clave = 'INICIATIVAS_ABIERTAS';
     Debe decir "(1 row affected)". Comprobar:
       SELECT Clave, Encendido, ModificadoPor, ModificadoUtc FROM adm.Interruptor;
     Solo cambia esa fila: ninguna solicitud, foto de correos, folio ni
     evento de adm.SolicitudIniciativa*.

   DEPENDENCIAS
     Esquema adm (sql/18). Independiente de 19-29.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'30';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
   Rollback: sql/30_interruptor_iniciativas_rollback.sql.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'30'
BEGIN
    RAISERROR (N'Migracion 30 SIN APROBAR: declara aprobar_migracion = 30 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID(N'adm.Interruptor', N'U') IS NOT NULL OR SCHEMA_ID(N'adm') IS NULL
BEGIN
    ROLLBACK;
    IF SCHEMA_ID(N'adm') IS NULL
        RAISERROR (N'Migracion 30: la base no es la esperada (falta el esquema adm). No se toca nada.', 16, 1);
    ELSE
        RAISERROR (N'Migracion 30: ya aplicada (adm.Interruptor existe). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 30: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Tabla ---------- */
CREATE TABLE adm.Interruptor
(
    Clave         varchar(64)   NOT NULL CONSTRAINT PK_Interruptor PRIMARY KEY CLUSTERED
                                         CONSTRAINT CK_Interruptor_Clave CHECK (LEN(Clave) > 0 AND Clave COLLATE Latin1_General_BIN2 NOT LIKE '%[^A-Z0-9_]%'),
    Encendido     bit           NOT NULL CONSTRAINT DF_Interruptor_Encendido DEFAULT (0),
    ModificadoPor nvarchar(256) NOT NULL CONSTRAINT DF_Interruptor_ModificadoPor DEFAULT (SUSER_SNAME()),
    ModificadoUtc datetime2(0)  NOT NULL CONSTRAINT DF_Interruptor_ModificadoUtc DEFAULT (SYSUTCDATETIME())
);
INSERT adm.Interruptor (Clave, Encendido) VALUES ('INICIATIVAS_ABIERTAS', 0);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 30: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. Permisos ---------- */
IF DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NOT NULL
    DENY INSERT, UPDATE, DELETE ON adm.Interruptor TO [PROACTIVANETAD];
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 30: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 3. Postcondicion ---------- */
DECLARE @deny int = (SELECT COUNT(*) FROM sys.database_permissions AS p
                     WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD')
                       AND p.state = 'D' AND p.class = 1
                       AND p.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
                       AND p.major_id = OBJECT_ID(N'adm.Interruptor'));
DECLARE @esperados int = CASE WHEN DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') IS NULL THEN 0 ELSE 3 END;
IF OBJECT_ID(N'adm.Interruptor', N'U') IS NOT NULL AND @deny = @esperados
   AND (SELECT COUNT(*) FROM adm.Interruptor) = 1
   AND (SELECT Encendido FROM adm.Interruptor WHERE Clave = 'INICIATIVAS_ABIERTAS') = 0
BEGIN
    COMMIT;
    SELECT Migracion = N'30', Resultado = 'APLICADA', IniciativasAbiertas = 'APAGADO', DenyPROACTIVANETAD = @deny;
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 30: postcondicion fallida (%d de %d DENY); ROLLBACK de todo.', 16, 1, @deny, @esperados);
END;
GO
SET NOEXEC OFF;
GO
