/* =========================================================================
   sql/22_solicitudes_cambio.sql - almacen y flujo de "Solicitar cambios"
   de una iniciativa.                    ROLLBACK: _rollback.sql
                                         PERMISOS: _permisos.sql (aparte)
                                         DIAG:     diag_solicitudes_cambio.sql

   ESTADO: PROPUESTA PARA REVISION. NO EJECUTADA EN LA VM NI APROBADA.
   Solo se corrio en bases DESECHABLES de LocalDB (GestionAdminPrueba_*)
   para comprobar que compila y para fijar los hashes de abajo. Aplicarla
   en la VM es otro paso, con su propio OK.

   POR QUE
     "Solicitar cambios" (admin/registro-iniciativas.js, SolicitudCambio)
     solo prepara la solicitud en el navegador: no hay donde guardarla. El
     historial ya la espera: dbo.ProblemFechaEvento.SolicitudId y
     dbo.ProblemEstadoEvento.SolicitudId (int NULL, sin FK) se llenan de
     SESSION_CONTEXT(pfe_solicitud), pero adm.usp_GestionAdmin_Modificar la
     pone en NULL.

   QUE CREA (esquema adm, de sql/18)
     adm.SolicitudCategoriaTipo        TVP de las categorias de una solicitud
     adm.SolicitudClasificacionTipo    TVP de la clasificacion que da ADM
     adm.SolicitudCambio               una fila por solicitud (cabecera con
                                       el antes y el despues de cada campo)
     adm.SolicitudCambioCategoria      0..N categorias: PCT (ligada) o
                                       AGREGAR (del catalogo)
     adm.SolicitudCambioEvento         bitacora: solo se agrega
     adm.usp_SolicitudCambio_Crear     enviar (idempotente por llave)
     adm.usp_SolicitudCambio_Rechazar  ADM rechaza, con comentario
     adm.usp_SolicitudCambio_RegistrarFallo  intento fallido (sigue PENDIENTE)
     adm.usp_SolicitudCambio_Aplicar   ADM aprueba = aplica, atomico, con el
                                       MISMO adm.usp_GestionAdmin_Modificar
   QUE CAMBIA
     adm.usp_GestionAdmin_Modificar    + @SolicitudId int = NULL (ultimo
                                       parametro). NULL = edicion directa,
                                       igual que hoy. Lo demas es el texto
                                       exacto de sql/21.
     0 cambios en dbo (tablas, triggers, vistas, datos).

   ESTADOS DE UNA SOLICITUD
     PENDIENTE -> APLICADA   (Aplicar: la iniciativa cambio en la MISMA
                              transaccion)
     PENDIENTE -> RECHAZADA  (Rechazar: con comentario)
     Ambos finales. Una falla al aplicar NO cambia el estado: queda
     PENDIENTE con Intentos + 1, UltimoError y un evento FALLO_APLICAR o
     DESACTUALIZADA. Otros (solo explicacion) se cierra con Aplicar y el
     comentario de lo que ADM corrigio; no toca la iniciativa.

   REGLAS
     - Enviar NUNCA escribe dbo.Problem ni dbo.ProblemCategoria.
     - Usuario, rol y revisor los pone el servidor (IdentidadWindows y
       AccesoAdmin en el handler). La base solo ve la cuenta del sitio
       (PROACTIVANETAD): quien es ADM lo decide el handler (ExigirAdm).
     - El "anterior" lo lee el procedimiento de la base al enviar; Aplicar
       lo compara bajo candado con lo que haya: si difiere, 51204 y nada
       se aplica (desactualizada).
     - La fecha pedida va SIEMPRE con su etapa (CampoFecha =
       FechaAnalisis | FechaSolucion | FechaCierre, los nombres de
       ProblemFechaEvento.Campo). Nunca se deduce del Estado.
     - Mismo usuario + misma llave = la misma solicitud (UQ + reintento).
     - Categoria por agregar: la clasificacion (TipoIniciativa /
       TipoAgrupado) la deriva el servidor del prefijo; si no hay regla o
       el valor no existe en la base, se guarda SIN ella y Aplicar exige
       que ADM la elija (51221). Nunca se aplica incompleta.
     - Varias pendientes por iniciativa se permiten: cada una guarda su
       "anterior"; la que llegue tarde sale desactualizada (51204).
     - ADM puede aplicar las suyas (fase de pruebas): SolicitadoPor y
       RevisadoPor quedan aparte.
     - Dos revisores a la vez: UPDLOCK en la solicitud; el segundo, 51202.
     - Aplicar es todo o nada: Modificar ya lo es (una transaccion,
       XACT_ABORT) y la solicitud se marca dentro de la misma.

   ERRORES NUEVOS (51001-51026 son los de sql/18)
     51201 no existe          51202 ya revisada       51204 desactualizada
     51206 Otros sin comentario                       51207 rechazo sin motivo
     51208 RegistrarFallo dentro de otra transaccion  51209 Aplicar dentro de otra
     51221 falta clasificacion                        51222 clasificacion de mas
     51223 clasificacion incompleta
     51210 rol                51211 llave             51212 motivo
     51213 tipo               51214 campos del tipo   51215 etapa de fecha
     51216 accion categoria   51217 subestado         51218 misma fecha
     51219 mismo estado       51220 mismo %           51290 tipos de columna

   PRECONDICION (si no se cumple, ROLLBACK y no toca nada)
     adm.usp_GestionAdmin_Modificar con EXACTAMENTE el hash de sql/21:
       0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3
     ningun objeto de 22, y el historial con SolicitudId (sql/17 y el
     trigger de Estado desplegado). Hash = SHA2_256 de OBJECT_DEFINITION
     sin espacios, tabs ni saltos de linea (regla de sql/20 y sql/21).
   POSTCONDICION (si no, ROLLBACK): los cinco procedimientos con los
     hashes de la seccion 5 y Modificar con 23 parametros, @SolicitudId int.

   DIAG ADM_04 (repo del backend), seccion 11: despues de esto marca
     Modificar como 'OTRA: revisar'. Es lo esperado si el hash es el de
     la seccion 5.

   COMO CORRERLO (solo con OK)
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'22';
     y el script completo (sqlcmd -b -I, o SSMS con el script entero).
     Una sola transaccion. Despues, con su propio OK, _permisos.sql.
   ========================================================================= */
IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'22'
BEGIN
    RAISERROR (N'Migracion 22 SIN APROBAR: declara aprobar_migracion = 22 en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
IF OBJECT_ID('tempdb..#h22') IS NOT NULL DROP TABLE #h22;
SELECT v.Objeto, v.Esperado, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
INTO #h22
FROM (VALUES (N'adm.usp_GestionAdmin_Modificar', 0x4E3A69887120832C215FFAF68DFF2792BDE7272CD75B3B0FC399A424050583C3)) AS v (Objeto, Esperado);
DECLARE @ya bit = CASE WHEN OBJECT_ID('adm.SolicitudCambio', 'U') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @mal nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                              FROM #h22 WHERE Hash IS NULL OR Hash <> Esperado);
IF @ya = 1 OR @mal IS NOT NULL
   OR OBJECT_ID('adm.SolicitudCambioCategoria', 'U') IS NOT NULL OR OBJECT_ID('adm.SolicitudCambioEvento', 'U') IS NOT NULL
   OR TYPE_ID('adm.SolicitudCategoriaTipo') IS NOT NULL
   OR OBJECT_ID('adm.usp_SolicitudCambio_Crear', 'P') IS NOT NULL OR OBJECT_ID('adm.usp_SolicitudCambio_Rechazar', 'P') IS NOT NULL
   OR OBJECT_ID('adm.usp_SolicitudCambio_Aplicar', 'P') IS NOT NULL OR OBJECT_ID('adm.usp_SolicitudCambio_RegistrarFallo', 'P') IS NOT NULL
   OR TYPE_ID('adm.SolicitudClasificacionTipo') IS NOT NULL
   OR OBJECT_ID('dbo.trg_Problem_FechaEvento', 'TR') IS NULL OR OBJECT_ID('dbo.trg_Problem_EstadoEvento', 'TR') IS NULL
   OR COL_LENGTH('dbo.ProblemFechaEvento', 'SolicitudId') IS NULL OR COL_LENGTH('dbo.ProblemEstadoEvento', 'SolicitudId') IS NULL
BEGIN
    ROLLBACK;
    IF @ya = 1
        RAISERROR (N'Migracion 22: ya aplicada (adm.SolicitudCambio existe). No se toca nada.', 16, 1);
    ELSE IF @mal IS NOT NULL
        RAISERROR (N'Migracion 22: %s no es la de sql/21. No se toca nada.', 16, 1, @mal);
    ELSE
        RAISERROR (N'Migracion 22: la base no es la esperada (objetos de 22 a medias o falta el historial con SolicitudId). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 1. Tipo de las categorias de una solicitud ---------- */
CREATE TYPE adm.SolicitudCategoriaTipo AS TABLE
(
    Categoria      nvarchar(450) NOT NULL,
    Accion         varchar(7)    NOT NULL,   -- PCT (ligada) | AGREGAR (del catalogo)
    Pct            decimal(9,4)  NOT NULL,   -- fraccion 0-1, como ProblemCategoria.PctDisminucion
    TipoIniciativa nvarchar(100) NULL,       -- solo AGREGAR; NULL = sin declarar (Incompleta)
    TipoAgrupado   nvarchar(100) NULL
);
-- Clasificacion que ADM da al aplicar a una categoria por agregar que llego
-- sin ella (sin regla de prefijo o valor que no existe en la base).
CREATE TYPE adm.SolicitudClasificacionTipo AS TABLE
(
    Categoria      nvarchar(450) NOT NULL,
    TipoIniciativa nvarchar(100) NULL,
    TipoAgrupado   nvarchar(100) NULL
);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 2. Tablas (collation de dbo.Problem.Codigo y de
   dbo.ProblemCategoria.Categoria, como sql/18) ---------- */
DECLARE @colCod sysname = (SELECT c.collation_name FROM sys.columns AS c
                           WHERE c.object_id = OBJECT_ID('dbo.Problem') AND c.name = N'Codigo'
                             AND TYPE_NAME(c.user_type_id) = N'nvarchar' AND c.max_length = 200);
DECLARE @colCat sysname = (SELECT c.collation_name FROM sys.columns AS c
                           WHERE c.object_id = OBJECT_ID('dbo.ProblemCategoria') AND c.name = N'Categoria'
                             AND TYPE_NAME(c.user_type_id) = N'nvarchar' AND c.max_length = 900);
IF @colCod IS NULL OR @colCat IS NULL
    THROW 51290, N'Migracion 22: dbo.Problem.Codigo no es nvarchar(100) o dbo.ProblemCategoria.Categoria no es nvarchar(450): revisar antes de seguir.', 1;

-- CONVERT a nvarchar(max) primero: sin eso la concatenacion se corta en 4000.
DECLARE @sql nvarchar(max) = CONVERT(nvarchar(max), N'') + N'
CREATE TABLE adm.SolicitudCambio
(
    IdSolicitud           int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_SolicitudCambio PRIMARY KEY CLUSTERED,
    Codigo                nvarchar(100) COLLATE ' + @colCod + N' NOT NULL
                          CONSTRAINT FK_SolicitudCambio_Problem REFERENCES dbo.Problem (Codigo),
    Tipo                  varchar(10)    NOT NULL
                          CONSTRAINT CK_SolicitudCambio_Tipo CHECK (Tipo IN (''FECHA'', ''ESTADO'', ''CATEGORIAS'', ''OTROS'')),
    EstadoAnterior        nvarchar(100)  NULL,
    EstadoNuevo           nvarchar(100)  NULL,
    SubestadoAnterior     nvarchar(100)  NULL,
    SubestadoNuevo        nvarchar(100)  NULL,
    CampoFecha            varchar(13)    NULL
                          CONSTRAINT CK_SolicitudCambio_CampoFecha CHECK (CampoFecha IN (''FechaAnalisis'', ''FechaSolucion'', ''FechaCierre'')),
    FechaAnterior         date           NULL,
    FechaNueva            date           NULL,
    Motivo                nvarchar(4000) NOT NULL
                          CONSTRAINT CK_SolicitudCambio_Motivo CHECK (LEN(LTRIM(RTRIM(Motivo))) > 0),
    SolicitadoPor         nvarchar(256)  NOT NULL
                          CONSTRAINT CK_SolicitudCambio_SolicitadoPor CHECK (LEN(LTRIM(RTRIM(SolicitadoPor))) > 0),
    RolSolicitante        varchar(3)     NOT NULL
                          CONSTRAINT CK_SolicitudCambio_Rol CHECK (RolSolicitante IN (''ADM'', ''MOD'')),
    FechaSolicitudUtc     datetime2(0)   NOT NULL CONSTRAINT DF_SolicitudCambio_Fecha DEFAULT (SYSUTCDATETIME()),
    LlaveIdempotencia     uniqueidentifier NOT NULL,
    Estado                varchar(10)    NOT NULL CONSTRAINT DF_SolicitudCambio_Estado DEFAULT (''PENDIENTE'')
                          CONSTRAINT CK_SolicitudCambio_Estado CHECK (Estado IN (''PENDIENTE'', ''APLICADA'', ''RECHAZADA'')),
    RevisadoPor           nvarchar(256)  NULL,
    FechaRevisionUtc      datetime2(0)   NULL,
    ComentarioRevision    nvarchar(4000) NULL,
    Intentos              int            NOT NULL CONSTRAINT DF_SolicitudCambio_Intentos DEFAULT (0)
                          CONSTRAINT CK_SolicitudCambio_Intentos CHECK (Intentos >= 0),
    UltimoError           nvarchar(2000) NULL,
    FechaUltimoIntentoUtc datetime2(0)   NULL,
    CONSTRAINT UQ_SolicitudCambio_Llave UNIQUE (SolicitadoPor, LlaveIdempotencia),
    -- La fecha va SIEMPRE con su etapa.
    CONSTRAINT CK_SolicitudCambio_Fecha CHECK ((CampoFecha IS NULL AND FechaNueva IS NULL AND FechaAnterior IS NULL)
                                            OR (CampoFecha IS NOT NULL AND FechaNueva IS NOT NULL)),
    CONSTRAINT CK_SolicitudCambio_TipoFecha CHECK (Tipo <> ''FECHA'' OR (CampoFecha IS NOT NULL AND EstadoNuevo IS NULL AND SubestadoNuevo IS NULL)),
    CONSTRAINT CK_SolicitudCambio_TipoEstado CHECK (Tipo = ''ESTADO'' OR (EstadoNuevo IS NULL AND SubestadoNuevo IS NULL
                                                                         AND EstadoAnterior IS NULL AND SubestadoAnterior IS NULL)),
    CONSTRAINT CK_SolicitudCambio_EstadoNuevo CHECK (Tipo <> ''ESTADO'' OR EstadoNuevo IS NOT NULL),
    CONSTRAINT CK_SolicitudCambio_SinFecha CHECK (Tipo IN (''FECHA'', ''ESTADO'') OR CampoFecha IS NULL),
    -- Revisada = quien y cuando; rechazada = por que.
    CONSTRAINT CK_SolicitudCambio_Revision CHECK ((Estado = ''PENDIENTE'' AND RevisadoPor IS NULL AND FechaRevisionUtc IS NULL)
                                               OR (Estado <> ''PENDIENTE'' AND RevisadoPor IS NOT NULL AND FechaRevisionUtc IS NOT NULL)),
    CONSTRAINT CK_SolicitudCambio_Rechazo CHECK (Estado <> ''RECHAZADA'' OR LEN(LTRIM(RTRIM(ComentarioRevision))) > 0)
);
CREATE INDEX IX_SolicitudCambio_Cola    ON adm.SolicitudCambio (Estado, FechaSolicitudUtc);
CREATE INDEX IX_SolicitudCambio_Codigo  ON adm.SolicitudCambio (Codigo, FechaSolicitudUtc);
CREATE INDEX IX_SolicitudCambio_Usuario ON adm.SolicitudCambio (SolicitadoPor, FechaSolicitudUtc);

CREATE TABLE adm.SolicitudCambioCategoria
(
    IdSolicitud    int           NOT NULL
                   CONSTRAINT FK_SolicitudCambioCategoria_Solicitud REFERENCES adm.SolicitudCambio (IdSolicitud),
    Categoria      nvarchar(450) COLLATE ' + @colCat + N' NOT NULL,
    Accion         varchar(7)    NOT NULL
                   CONSTRAINT CK_SolicitudCambioCategoria_Accion CHECK (Accion IN (''PCT'', ''AGREGAR'')),
    PctAnterior    decimal(9,4)  NULL,
    PctNuevo       decimal(9,4)  NOT NULL
                   CONSTRAINT CK_SolicitudCambioCategoria_Pct CHECK (PctNuevo BETWEEN 0 AND 1),
    TipoIniciativa nvarchar(100) NULL,
    TipoAgrupado   nvarchar(100) NULL,
    -- NONCLUSTERED: int + nvarchar(450) pasa el limite de 900 bytes de una
    -- llave agrupada (el de una no agrupada es 1700).
    CONSTRAINT PK_SolicitudCambioCategoria PRIMARY KEY NONCLUSTERED (IdSolicitud, Categoria),
    -- AGREGAR no tiene % anterior; PCT no declara tipos (no cambian).
    CONSTRAINT CK_SolicitudCambioCategoria_Forma CHECK ((Accion = ''AGREGAR'' AND PctAnterior IS NULL)
                                                     OR (Accion = ''PCT'' AND TipoIniciativa IS NULL AND TipoAgrupado IS NULL))
);

CREATE CLUSTERED INDEX CX_SolicitudCambioCategoria ON adm.SolicitudCambioCategoria (IdSolicitud);

-- Bitacora: solo se agrega (los procedimientos; el sitio tiene DENY).
CREATE TABLE adm.SolicitudCambioEvento
(
    IdEvento    int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_SolicitudCambioEvento PRIMARY KEY CLUSTERED,
    IdSolicitud int            NOT NULL
                CONSTRAINT FK_SolicitudCambioEvento_Solicitud REFERENCES adm.SolicitudCambio (IdSolicitud),
    Evento      varchar(14)    NOT NULL
                CONSTRAINT CK_SolicitudCambioEvento_Evento CHECK (Evento IN (''ENVIADA'', ''APLICADA'', ''RECHAZADA'', ''FALLO_APLICAR'', ''DESACTUALIZADA'')),
    Usuario     nvarchar(256)  NOT NULL,
    FechaUtc    datetime2(0)   NOT NULL CONSTRAINT DF_SolicitudCambioEvento_Fecha DEFAULT (SYSUTCDATETIME()),
    Detalle     nvarchar(2000) NULL
);
CREATE INDEX IX_SolicitudCambioEvento_Solicitud ON adm.SolicitudCambioEvento (IdSolicitud, IdEvento);';
EXEC (@sql);
GO
/* ---------- 3. adm.usp_GestionAdmin_Modificar + @SolicitudId ----------
   Texto EXACTO de sql/21 salvo: el parametro @SolicitudId int = NULL (al
   final, con valor por omision: las llamadas de hoy no cambian), su linea
   en el comentario, pfe_solicitud = @SolicitudId en lugar de NULL, y
   pfe_solicitud vuelve a NULL al terminar (bien o mal), como pfe_origen /
   pfe_usuario. */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Solo lo que trae su bandera Cambia*. No hay parametro para Codigo ni para
   FechaCreacion: no cambian.
   @Pcts      ligadas vigentes: Pct = el valor final; TipoIniciativa /
              TipoAgrupado NULL = no cambian (con valor, se declaran).
   @Agregar   se ligan ahora: Tipo* obligatorios; fechas PROPIAS = hoy y
              hoy + 15.
   @FechasCategoria  nueva fecha de analisis de una ligada. Si la categoria
              hereda (inicial, sin fecha propia), el cambio va a la fecha de
              la INICIATIVA (FechaAnalisis), no a una fecha propia.
   @SolicitudId  (sql/22) la adm.SolicitudCambio que se aplica: llega al
              historial (pfe_solicitud -> SolicitudId). NULL = edicion
              directa de ADM, igual que antes. */
ALTER PROCEDURE adm.usp_GestionAdmin_Modificar
    @Usuario             nvarchar(256),
    @Codigo              nvarchar(100),
    @CambiaTitulo        bit = 0, @Titulo        nvarchar(max) = NULL,
    @CambiaDescripcion   bit = 0, @Descripcion   nvarchar(max) = NULL,
    @CambiaObservaciones bit = 0, @Observaciones nvarchar(max) = NULL,
    @CambiaEstado        bit = 0, @Estado        nvarchar(100) = NULL,
    @CambiaSubestado     bit = 0, @Subestado     nvarchar(100) = NULL,
    @CambiaFAnalisis     bit = 0, @FAnalisis     date = NULL,
    @CambiaFSolucion     bit = 0, @FSolucion     date = NULL,
    @CambiaFCierre       bit = 0, @FCierre       date = NULL,
    @Pcts                adm.CategoriaPctTipo READONLY,
    @Agregar             adm.CategoriaPctTipo READONLY,
    @FechasCategoria     adm.CategoriaFechaTipo READONLY,
    @Hoy                 date = NULL,
    @SolicitudId         int  = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar) AS x
               GROUP BY LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
       OR EXISTS (SELECT 1 FROM @FechasCategoria
                  GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @Agregar
                              UNION ALL SELECT Categoria FROM @FechasCategoria) AS x
               WHERE NULLIF(LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT Pct FROM @Pcts UNION ALL SELECT Pct FROM @Agregar) AS x WHERE x.Pct < 0 OR x.Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT TipoIniciativa FROM @Agregar UNION ALL SELECT TipoIniciativa FROM @Pcts) AS x
                  WHERE NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N'') IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM dbo.Problem AS p WHERE LTRIM(RTRIM(p.TipoIniciativa)) = LTRIM(RTRIM(x.TipoIniciativa))))
        THROW 51011, N'Tipo de iniciativa de una categoria que no existe en dbo.Problem.', 1;
    IF EXISTS (SELECT 1 FROM (SELECT TipoAgrupado FROM @Agregar UNION ALL SELECT TipoAgrupado FROM @Pcts) AS x
                  WHERE NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N'') IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc WHERE LTRIM(RTRIM(pc.TipoAgrupado)) = LTRIM(RTRIM(x.TipoAgrupado))))
        THROW 51012, N'Agrupacion (TipoAgrupado) de una categoria que no existe en dbo.ProblemCategoria.', 1;
    IF @CambiaEstado = 1
       AND (NULLIF(LTRIM(RTRIM(@Estado)), N'') IS NULL
            OR NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = LTRIM(RTRIM(@Estado))))
        THROW 51013, N'El Estado no es uno de los que ya existen en dbo.Problem.', 1;
    IF EXISTS (SELECT 1 FROM @FechasCategoria WHERE FechaAnalisis IS NULL)
        THROW 51017, N'La fecha de analisis de una categoria no se puede vaciar.', 1;
    IF EXISTS (SELECT 1 FROM @Agregar AS c
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;
    IF @CambiaEstado = 1 SET @Estado = LTRIM(RTRIM(@Estado));

    DECLARE @hoyMx date = COALESCE(@Hoy, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));

    BEGIN TRY
        BEGIN TRAN;
            -- Igual que en Crear: antes de bloquear filas de dbo.Problem.
            DECLARE @rcProt int;
            EXEC @rcProt = sp_getapplock @Resource = N'adm.proteccion', @LockMode = 'Shared',
                                         @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rcProt < 0 THROW 51026, N'La carga del Excel esta corriendo y no termino a tiempo. Intenta de nuevo.', 1;

            DECLARE @estadoAntes nvarchar(100), @estadoFinal nvarchar(100);
            SELECT @estadoAntes = p.Estado,
                   @estadoFinal = CASE WHEN @CambiaEstado = 1 THEN @Estado ELSE p.Estado END
            FROM dbo.Problem AS p WITH (UPDLOCK, HOLDLOCK)
            WHERE p.Codigo = @Codigo;
            IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;

            IF EXISTS (SELECT 1 FROM (SELECT Categoria FROM @Pcts UNION ALL SELECT Categoria FROM @FechasCategoria) AS x
                       WHERE NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                                         WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1
                                           AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))))
                THROW 51007, N'Un cambio es de una categoria que no esta ligada (vigente) a esta iniciativa.', 1;
            IF EXISTS (SELECT 1 FROM @Agregar AS x
                       INNER JOIN dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))))
                THROW 51008, N'La categoria ya esta ligada a esta iniciativa (o lo estuvo y se dio de baja).', 1;

            -- Fecha de una categoria que HEREDA = fecha de la iniciativa.
            DECLARE @heredadas int, @fHeredada date;
            SELECT @heredadas = COUNT(DISTINCT f.FechaAnalisis), @fHeredada = MIN(f.FechaAnalisis)
            FROM @FechasCategoria AS f
            INNER JOIN dbo.ProblemCategoria AS pc
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(f.Categoria, NCHAR(160), N' ')))
            WHERE pc.FechaAnalisisCategoria IS NULL;
            IF @heredadas > 1 OR (@heredadas = 1 AND @CambiaFAnalisis = 1 AND ISNULL(@FAnalisis, '19000101') <> @fHeredada)
                THROW 51016, N'Las categorias que heredan la fecha de la iniciativa comparten UNA fecha de analisis: llegaron dos distintas.', 1;
            IF @heredadas = 1 SELECT @CambiaFAnalisis = 1, @FAnalisis = @fHeredada;

            -- Como queda cada categoria vigente (+ las que se ligan).
            DECLARE @final TABLE (Categoria nvarchar(450) PRIMARY KEY, PctAntes decimal(9,4), PctDespues decimal(9,4),
                                  AgrupAntes nvarchar(100), AgrupDespues nvarchar(100), Nueva bit);
            INSERT @final (Categoria, PctAntes, PctDespues, AgrupAntes, AgrupDespues, Nueva)
            SELECT pc.Categoria, pc.PctDisminucion,
                   CASE WHEN x.Categoria IS NULL THEN pc.PctDisminucion ELSE x.Pct END,
                   pc.TipoAgrupado,
                   COALESCE(NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), pc.TipoAgrupado), 0
            FROM dbo.ProblemCategoria AS pc
            LEFT JOIN @Pcts AS x ON pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
            WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1;
            INSERT @final (Categoria, PctAntes, PctDespues, AgrupAntes, AgrupDespues, Nueva)
            SELECT LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), NULL, x.Pct, NULL, NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), 1
            FROM @Agregar AS x;

            DECLARE @vivoAntes bit = CASE WHEN LTRIM(RTRIM(@estadoAntes)) COLLATE Latin1_General_CI_AI
                                               IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
            DECLARE @vivoFinal bit = CASE WHEN LTRIM(RTRIM(@estadoFinal)) COLLATE Latin1_General_CI_AI
                                               IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
            DECLARE @tocaCapacidad bit = CASE WHEN @CambiaEstado = 1 OR EXISTS (SELECT 1 FROM @Pcts)
                                                   OR EXISTS (SELECT 1 FROM @Agregar) THEN 1 ELSE 0 END;

            IF @tocaCapacidad = 1 AND @vivoFinal = 1
            BEGIN
                -- Una fila sin agrupacion se revisa como si consumiera
                -- (conservador): no se salta el tope por falta del dato.
                DECLARE @revisar adm.CategoriaPctTipo;
                INSERT @revisar (Categoria, Pct)
                SELECT f.Categoria, f.PctDespues
                FROM @final AS f
                WHERE (NULLIF(LTRIM(RTRIM(f.AgrupDespues)), N'') IS NULL OR LTRIM(RTRIM(f.AgrupDespues)) COLLATE Latin1_General_CI_AI IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                  AND ISNULL(f.PctDespues, 0) > 0
                  AND (f.Nueva = 1
                       OR ISNULL(f.PctDespues, 0) > ISNULL(f.PctAntes, 0)
                       OR NOT (@vivoAntes = 1 AND (NULLIF(LTRIM(RTRIM(f.AgrupAntes)), N'') IS NULL
                                                   OR LTRIM(RTRIM(f.AgrupAntes)) COLLATE Latin1_General_CI_AI IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))));
                IF EXISTS (SELECT 1 FROM @revisar)
                    EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = @Codigo, @Revisar = @revisar;
            END;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = @SolicitudId;

            -- Lo editable como estaba (filas ya bloqueadas arriba): al final, solo
            -- si algo de esto cambio se protege la iniciativa. Textos en binario:
            -- un cambio de mayusculas o de espacios tambien es un cambio.
            SELECT Titulo = CONVERT(varbinary(max), Titulo), Descripcion = CONVERT(varbinary(max), Descripcion),
                   Observaciones = CONVERT(varbinary(max), Observaciones), Estado = CONVERT(varbinary(max), Estado),
                   Subestado = CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre
            INTO #antesP FROM dbo.Problem WHERE Codigo = @Codigo;
            SELECT Categoria = CONVERT(varbinary(max), Categoria), PctDisminucion,
                   TipoIniciativa = CONVERT(varbinary(max), TipoIniciativa), TipoAgrupado = CONVERT(varbinary(max), TipoAgrupado),
                   FechaAnalisisCategoria, VigenteEnOrigen
            INTO #antesC FROM dbo.ProblemCategoria WHERE Codigo = @Codigo;

            DECLARE @ultimoEvento int = (SELECT ISNULL(MAX(IdEvento), 0) FROM dbo.ProblemFechaEvento);

            UPDATE dbo.Problem SET
                Titulo        = CASE WHEN @CambiaTitulo = 1        THEN @Titulo        ELSE Titulo END,
                Descripcion   = CASE WHEN @CambiaDescripcion = 1   THEN @Descripcion   ELSE Descripcion END,
                Observaciones = CASE WHEN @CambiaObservaciones = 1 THEN @Observaciones ELSE Observaciones END,
                Estado        = CASE WHEN @CambiaEstado = 1        THEN @Estado        ELSE Estado END,
                Subestado     = CASE WHEN @CambiaSubestado = 1     THEN @Subestado     ELSE Subestado END,
                FechaAnalisis = CASE WHEN @CambiaFAnalisis = 1     THEN @FAnalisis     ELSE FechaAnalisis END,
                FechaSolucion = CASE WHEN @CambiaFSolucion = 1     THEN @FSolucion     ELSE FechaSolucion END,
                FechaCierre   = CASE WHEN @CambiaFCierre = 1       THEN @FCierre       ELSE FechaCierre END
            WHERE Codigo = @Codigo
              AND (@CambiaTitulo | @CambiaDescripcion | @CambiaObservaciones | @CambiaEstado |
                   @CambiaSubestado | @CambiaFAnalisis | @CambiaFSolucion | @CambiaFCierre) = 1;

            -- NroCambioFecha*: los cambios que cuentan de lo que el trigger
            -- acaba de escribir para esta iniciativa (la fila de dbo.Problem
            -- esta bloqueada: nadie mas escribe sus eventos ahora).
            DECLARE @nA int, @nS int, @nC int;
            SELECT @nA = SUM(CASE WHEN e.Campo = 'FechaAnalisis' THEN 1 ELSE 0 END),
                   @nS = SUM(CASE WHEN e.Campo = 'FechaSolucion' THEN 1 ELSE 0 END),
                   @nC = SUM(CASE WHEN e.Campo = 'FechaCierre' AND e.FechaNueva > e.FechaAnterior THEN 1 ELSE 0 END)
            FROM dbo.ProblemFechaEvento AS e
            WHERE e.IdEvento > @ultimoEvento AND e.Codigo = @Codigo AND e.Categoria IS NULL
              AND e.Operacion = 'U' AND e.FechaAnterior IS NOT NULL AND e.FechaNueva IS NOT NULL;
            IF ISNULL(@nA, 0) + ISNULL(@nS, 0) + ISNULL(@nC, 0) > 0
                UPDATE dbo.Problem SET
                    NroCambioFechaAnalisis = ISNULL(NroCambioFechaAnalisis, 0) + ISNULL(@nA, 0),
                    NroCambioFechaSolucion = ISNULL(NroCambioFechaSolucion, 0) + ISNULL(@nS, 0),
                    NroCambioFechaCierre   = ISNULL(NroCambioFechaCierre, 0)   + ISNULL(@nC, 0)
                WHERE Codigo = @Codigo;

            UPDATE pc SET
                pc.PctDisminucion = x.Pct,
                pc.TipoIniciativa = COALESCE(NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''), pc.TipoIniciativa),
                pc.TipoAgrupado   = COALESCE(NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''), pc.TipoAgrupado)
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @Pcts AS x
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')));

            -- Fecha propia de una ligada: solo las que YA tienen fecha propia
            -- (las que heredan se movieron arriba, en la de la iniciativa).
            UPDATE pc SET pc.FechaAnalisisCategoria = f.FechaAnalisis
            FROM dbo.ProblemCategoria AS pc
            INNER JOIN @FechasCategoria AS f
                    ON pc.Codigo = @Codigo
                   AND pc.Categoria = LTRIM(RTRIM(REPLACE(f.Categoria, NCHAR(160), N' ')))
            WHERE pc.FechaAnalisisCategoria IS NOT NULL
              AND pc.FechaAnalisisCategoria <> f.FechaAnalisis;

            -- Ligadas ahora: fechas PROPIAS (hoy y hoy + 15) y los tipos que vengan (NULL si no).
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion,
                                         VigenteEnOrigen, FechaCreacionCategoria, FechaAnalisisCategoria)
            SELECT @Codigo, LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))),
                   NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''), NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N''),
                   x.Pct, 1, @hoyMx, DATEADD(DAY, 15, @hoyMx)
            FROM @Agregar AS x;

            DECLARE @tr adm.CategoriaPctTipo;
            INSERT @tr (Categoria) SELECT Categoria FROM @Agregar UNION SELECT Categoria FROM @Pcts;
            IF EXISTS (SELECT 1 FROM @tr)
                EXEC adm.usp_GestionAdmin_TicketsReduce @Codigo = @Codigo, @Categorias = @tr;

            -- Modificar = Admin toma la iniciativa ENTERA (decidido 2026-10-14): el
            -- Excel ya no la pisa. Solo si algo editable cambio de verdad: una
            -- llamada sin cambios (o con los mismos valores) no se la quita al
            -- Excel. Si ya estaba protegida se queda como estaba (motivo y fecha).
            IF EXISTS (SELECT CONVERT(varbinary(max), Titulo), CONVERT(varbinary(max), Descripcion),
                              CONVERT(varbinary(max), Observaciones), CONVERT(varbinary(max), Estado),
                              CONVERT(varbinary(max), Subestado), FechaAnalisis, FechaSolucion, FechaCierre
                       FROM dbo.Problem WHERE Codigo = @Codigo
                       EXCEPT SELECT * FROM #antesP)
               OR EXISTS (SELECT CONVERT(varbinary(max), Categoria), PctDisminucion, CONVERT(varbinary(max), TipoIniciativa),
                                 CONVERT(varbinary(max), TipoAgrupado), FechaAnalisisCategoria, VigenteEnOrigen
                          FROM dbo.ProblemCategoria WHERE Codigo = @Codigo
                          EXCEPT SELECT * FROM #antesC)
               OR EXISTS (SELECT * FROM #antesC
                          EXCEPT SELECT CONVERT(varbinary(max), Categoria), PctDisminucion, CONVERT(varbinary(max), TipoIniciativa),
                                        CONVERT(varbinary(max), TipoAgrupado), FechaAnalisisCategoria, VigenteEnOrigen
                          FROM dbo.ProblemCategoria WHERE Codigo = @Codigo)
                INSERT adm.IniciativaProtegida (Codigo, Motivo, Usuario)
                SELECT @Codigo, 'MODIFICACION', @Usuario
                WHERE NOT EXISTS (SELECT 1 FROM adm.IniciativaProtegida WHERE Codigo = @Codigo);
            DROP TABLE #antesP; DROP TABLE #antesC;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;
        THROW;
    END CATCH;
END;
GO
/* ---------- 4. Procedimientos de solicitudes ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Alta de una solicitud de cambio. NUNCA toca dbo.Problem ni
   dbo.ProblemCategoria: solo lee lo actual para guardarlo como "anterior".
   @Usuario y @Rol los pone el servidor (IdentidadWindows / AccesoAdmin), no
   el navegador. @Llave: la misma llave del mismo usuario devuelve la misma
   solicitud (@Repetida = 1), sin otra fila. */
CREATE PROCEDURE adm.usp_SolicitudCambio_Crear
    @Usuario        nvarchar(256),
    @Rol            varchar(3),
    @Llave          uniqueidentifier,
    @Codigo         nvarchar(100),
    @Tipo           varchar(10),
    @EstadoNuevo    nvarchar(100) = NULL,
    @SubestadoNuevo nvarchar(100) = NULL,
    @CampoFecha     varchar(13)   = NULL,
    @FechaNueva     date          = NULL,
    @Motivo         nvarchar(4000),
    @Categorias     adm.SolicitudCategoriaTipo READONLY,
    @IdSolicitud    int OUTPUT,
    @Repetida       bit OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @IdSolicitud = NULL;
    SET @Repetida = 0;
    SET @Usuario        = NULLIF(LTRIM(RTRIM(@Usuario)), N'');
    SET @EstadoNuevo    = NULLIF(LTRIM(RTRIM(@EstadoNuevo)), N'');
    SET @SubestadoNuevo = NULLIF(LTRIM(RTRIM(@SubestadoNuevo)), N'');
    SET @Motivo         = NULLIF(LTRIM(RTRIM(@Motivo)), N'');

    IF @Usuario IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @Rol IS NULL OR @Rol NOT IN ('ADM', 'MOD')
        THROW 51210, N'Solo ADM o MOD pueden enviar solicitudes.', 1;
    IF @Llave IS NULL
        THROW 51211, N'Falta la llave de la solicitud.', 1;

    -- Reintento del mismo envio (doble clic, red): la misma solicitud.
    SELECT @IdSolicitud = IdSolicitud FROM adm.SolicitudCambio
    WHERE SolicitadoPor = @Usuario AND LlaveIdempotencia = @Llave;
    IF @IdSolicitud IS NOT NULL BEGIN SET @Repetida = 1; RETURN; END;

    IF @Motivo IS NULL
        THROW 51212, N'Falta el motivo de la solicitud.', 1;
    IF @Tipo IS NULL OR @Tipo NOT IN ('FECHA', 'ESTADO', 'CATEGORIAS', 'OTROS')
        THROW 51213, N'Tipo de solicitud invalido.', 1;
    IF @CampoFecha IS NOT NULL AND @CampoFecha NOT IN ('FechaAnalisis', 'FechaSolucion', 'FechaCierre')
        THROW 51215, N'La fecha pedida no es de Analisis, Solucion ni Cierre.', 1;
    -- Cada tipo trae SOLO lo suyo. La fecha va siempre con su etapa.
    IF (@CampoFecha IS NULL AND @FechaNueva IS NOT NULL) OR (@CampoFecha IS NOT NULL AND @FechaNueva IS NULL)
       OR (@Tipo = 'FECHA'      AND (@CampoFecha IS NULL OR @EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL
                                     OR EXISTS (SELECT 1 FROM @Categorias)))
       OR (@Tipo = 'ESTADO'     AND (@EstadoNuevo IS NULL OR EXISTS (SELECT 1 FROM @Categorias)))
       OR (@Tipo = 'CATEGORIAS' AND (@EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL OR @CampoFecha IS NOT NULL
                                     OR NOT EXISTS (SELECT 1 FROM @Categorias)))
       OR (@Tipo = 'OTROS'      AND (@EstadoNuevo IS NOT NULL OR @SubestadoNuevo IS NOT NULL OR @CampoFecha IS NOT NULL
                                     OR EXISTS (SELECT 1 FROM @Categorias)))
        THROW 51214, N'La solicitud no trae los campos de su tipo.', 1;

    -- Categorias: las mismas reglas de formato que Modificar.
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Accion NOT IN ('PCT', 'AGREGAR'))
        THROW 51216, N'Accion de categoria invalida (PCT o AGREGAR).', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE NULLIF(LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Pct < 0 OR Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    -- La clasificacion de una categoria por agregar la deriva el servidor del
    -- prefijo (TiposPorPrefijo). Si no hay regla o el valor no existe en la
    -- base, la fila se guarda SIN clasificacion (ver el INSERT de abajo) y
    -- Aplicar exige que ADM la resuelva (51221): nunca se aplica incompleta.
    IF EXISTS (SELECT 1 FROM @Categorias AS c
               WHERE c.Accion = 'AGREGAR'
                 AND NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;
    -- Estado y Subestado: valores que ya existen en dbo.Problem (como Modificar
    -- y como la lista del registro, subestados_problem).
    IF @EstadoNuevo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = @EstadoNuevo)
        THROW 51013, N'El Estado no es uno de los que ya existen en dbo.Problem.', 1;
    IF @SubestadoNuevo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Subestado)) = @SubestadoNuevo)
        THROW 51217, N'El Subestado no es uno de los que ya existen en dbo.Problem.', 1;

    BEGIN TRY
        BEGIN TRAN;
            -- Lo que hay ahora es el "anterior" de la solicitud: Aplicar lo
            -- compara con lo que haya entonces (desactualizada = no se aplica).
            DECLARE @eA nvarchar(100), @sA nvarchar(100), @fAn date, @fSo date, @fCi date;
            SELECT @eA = Estado, @sA = Subestado, @fAn = FechaAnalisis, @fSo = FechaSolucion, @fCi = FechaCierre
            FROM dbo.Problem WHERE Codigo = @Codigo;
            IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;
            DECLARE @fA date = CASE @CampoFecha WHEN 'FechaAnalisis' THEN @fAn
                                                WHEN 'FechaSolucion' THEN @fSo
                                                WHEN 'FechaCierre'   THEN @fCi END;
            IF @CampoFecha IS NOT NULL AND @fA = @FechaNueva
                THROW 51218, N'La nueva fecha compromiso es igual a la actual.', 1;
            IF @Tipo = 'ESTADO' AND @EstadoNuevo = LTRIM(RTRIM(ISNULL(@eA, N'')))
               AND (@SubestadoNuevo IS NULL OR @SubestadoNuevo = LTRIM(RTRIM(ISNULL(@sA, N''))))
                THROW 51219, N'El Estado pedido es igual al actual.', 1;

            IF EXISTS (SELECT 1 FROM @Categorias AS x
                       WHERE x.Accion = 'PCT'
                         AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc
                                         WHERE pc.Codigo = @Codigo AND pc.VigenteEnOrigen = 1
                                           AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))))
                THROW 51007, N'Un cambio es de una categoria que no esta ligada (vigente) a esta iniciativa.', 1;
            IF EXISTS (SELECT 1 FROM @Categorias AS x
                       INNER JOIN dbo.ProblemCategoria AS pc
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                       WHERE x.Accion = 'AGREGAR')
                THROW 51008, N'La categoria ya esta ligada a esta iniciativa (o lo estuvo y se dio de baja).', 1;
            IF EXISTS (SELECT 1 FROM @Categorias AS x
                       INNER JOIN dbo.ProblemCategoria AS pc
                               ON pc.Codigo = @Codigo
                              AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                       WHERE x.Accion = 'PCT' AND pc.PctDisminucion = x.Pct)
                THROW 51220, N'El % pedido de una categoria es igual al actual.', 1;

            INSERT adm.SolicitudCambio
                   (Codigo, Tipo, EstadoAnterior, EstadoNuevo, SubestadoAnterior, SubestadoNuevo,
                    CampoFecha, FechaAnterior, FechaNueva, Motivo, SolicitadoPor, RolSolicitante, LlaveIdempotencia)
            VALUES (@Codigo, @Tipo,
                    CASE WHEN @Tipo = 'ESTADO' THEN @eA END, @EstadoNuevo,
                    CASE WHEN @Tipo = 'ESTADO' THEN @sA END, @SubestadoNuevo,
                    @CampoFecha, @fA, @FechaNueva, @Motivo, @Usuario, @Rol, @Llave);
            SET @IdSolicitud = SCOPE_IDENTITY();

            INSERT adm.SolicitudCambioCategoria (IdSolicitud, Categoria, Accion, PctAnterior, PctNuevo, TipoIniciativa, TipoAgrupado)
            SELECT @IdSolicitud, LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' '))), x.Accion,
                   CASE WHEN x.Accion = 'PCT' THEN pc.PctDisminucion END, x.Pct,
                   CASE WHEN k.Valida = 1 THEN t.TipoIniciativa END,
                   CASE WHEN k.Valida = 1 THEN t.TipoAgrupado END
            FROM @Categorias AS x
            CROSS APPLY (SELECT TipoIniciativa = NULLIF(LTRIM(RTRIM(x.TipoIniciativa)), N''),
                                TipoAgrupado   = NULLIF(LTRIM(RTRIM(x.TipoAgrupado)), N'')) AS t
            -- Las dos o ninguna, y solo valores que ya existen (como Modificar).
            CROSS APPLY (SELECT Valida = CASE WHEN x.Accion = 'AGREGAR' AND t.TipoIniciativa IS NOT NULL AND t.TipoAgrupado IS NOT NULL
                                               AND EXISTS (SELECT 1 FROM dbo.Problem AS p WHERE LTRIM(RTRIM(p.TipoIniciativa)) = t.TipoIniciativa)
                                               AND EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS q WHERE LTRIM(RTRIM(q.TipoAgrupado)) = t.TipoAgrupado)
                                              THEN 1 ELSE 0 END) AS k
            LEFT JOIN dbo.ProblemCategoria AS pc
                   ON pc.Codigo = @Codigo
                  AND pc.Categoria = LTRIM(RTRIM(REPLACE(x.Categoria, NCHAR(160), N' ')))
                  AND x.Accion = 'PCT';

            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@IdSolicitud, 'ENVIADA', @Usuario, N'Rol ' + @Rol);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- Dos envios simultaneos con la misma llave: el segundo choca con
        -- UQ_SolicitudCambio_Llave y devuelve la del primero.
        IF ERROR_NUMBER() IN (2601, 2627)
        BEGIN
            SELECT @IdSolicitud = IdSolicitud FROM adm.SolicitudCambio
            WHERE SolicitadoPor = @Usuario AND LlaveIdempotencia = @Llave;
            IF @IdSolicitud IS NOT NULL BEGIN SET @Repetida = 1; RETURN; END;
        END;
        SET @IdSolicitud = NULL;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Rechazo de ADM (la autorizacion la hace el handler: AccesoAdmin.ExigirAdm;
   la base solo ve la cuenta del sitio). Exige comentario. No cambia nada de
   la iniciativa. Dos revisores a la vez: el segundo recibe 51202. */
CREATE PROCEDURE adm.usp_SolicitudCambio_Rechazar
    @IdSolicitud int,
    @Revisor     nvarchar(256),
    @Comentario  nvarchar(4000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Revisor    = NULLIF(LTRIM(RTRIM(@Revisor)), N'');
    SET @Comentario = NULLIF(LTRIM(RTRIM(@Comentario)), N'');
    IF @Revisor IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @Comentario IS NULL
        THROW 51207, N'Explica por que se rechaza.', 1;
    BEGIN TRY
        BEGIN TRAN;
            DECLARE @estado varchar(10);
            SELECT @estado = Estado FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK) WHERE IdSolicitud = @IdSolicitud;
            IF @estado IS NULL THROW 51201, N'La solicitud no existe.', 1;
            IF @estado <> 'PENDIENTE' THROW 51202, N'La solicitud ya fue revisada (aplicada o rechazada).', 1;
            UPDATE adm.SolicitudCambio
               SET Estado = 'RECHAZADA', RevisadoPor = @Revisor, FechaRevisionUtc = SYSUTCDATETIME(), ComentarioRevision = @Comentario
             WHERE IdSolicitud = @IdSolicitud;
            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@IdSolicitud, 'RECHAZADA', @Revisor, LEFT(@Comentario, 2000));
        COMMIT;
    END TRY
    BEGIN CATCH
        -- Sin esto el que llama se queda con una transaccion condenada (3930).
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Registra un intento de aplicar que fallo, en SU PROPIA transaccion (la
   del intento ya se deshizo): la solicitud sigue PENDIENTE con Intentos + 1,
   UltimoError y un evento FALLO_APLICAR (DESACTUALIZADA si @Numero = 51204).
   Lo usan Aplicar (fallas en SQL) y el handler (fallas de la validacion de
   la aplicacion, antes de llegar a Aplicar). */
CREATE PROCEDURE adm.usp_SolicitudCambio_RegistrarFallo
    @IdSolicitud int,
    @Revisor     nvarchar(256),
    @Numero      int,
    @Mensaje     nvarchar(2000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Revisor = NULLIF(LTRIM(RTRIM(@Revisor)), N'');
    IF @Revisor IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @@TRANCOUNT > 0
        THROW 51208, N'RegistrarFallo corre fuera de la transaccion que fallo.', 1;
    DECLARE @detalle nvarchar(2000) = LEFT(CONVERT(nvarchar(12), ISNULL(@Numero, 0)) + N': ' + ISNULL(@Mensaje, N''), 2000);
    BEGIN TRY
        BEGIN TRAN;
            UPDATE adm.SolicitudCambio
               SET Intentos = Intentos + 1, UltimoError = @detalle, FechaUltimoIntentoUtc = SYSUTCDATETIME()
             WHERE IdSolicitud = @IdSolicitud AND Estado = 'PENDIENTE';
            IF @@ROWCOUNT = 0
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM adm.SolicitudCambio WHERE IdSolicitud = @IdSolicitud)
                    THROW 51201, N'La solicitud no existe.', 1;
                THROW 51202, N'La solicitud ya fue revisada (aplicada o rechazada).', 1;
            END;
            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@IdSolicitud, CASE WHEN @Numero = 51204 THEN 'DESACTUALIZADA' ELSE 'FALLO_APLICAR' END, @Revisor, @detalle);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Aprobar = aplicar, en UNA transaccion: la solicitud queda APLICADA solo
   si la iniciativa cambio de verdad (mismo adm.usp_GestionAdmin_Modificar
   que la edicion directa, con @SolicitudId para el historial).
   - Desactualizada (lo "anterior" ya no es lo que hay): 51204, no aplica.
   - Categoria por agregar sin clasificacion: ADM la da en @Clasificaciones
     (solo para esas filas: 51222 si no); sin ella, 51221. Lo que ADM elige
     queda en la fila de la solicitud.
   - Cualquier falla: ROLLBACK de todo; la solicitud SIGUE PENDIENTE
     (usp_SolicitudCambio_RegistrarFallo).
   - Otros: no cambia la iniciativa; se cierra con el comentario de lo que
     ADM corrigio a mano (51206 sin comentario).
   - Dos revisores a la vez: UPDLOCK; el segundo recibe 51202.
   - Quien envio y quien aplica se guardan aparte (SolicitadoPor /
     RevisadoPor), aunque sean la misma cuenta.
   La autorizacion (solo ADM) es del handler. */
CREATE PROCEDURE adm.usp_SolicitudCambio_Aplicar
    @IdSolicitud     int,
    @Revisor         nvarchar(256),
    @Comentario      nvarchar(4000) = NULL,
    @Clasificaciones adm.SolicitudClasificacionTipo READONLY,
    @Hoy             date = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Revisor    = NULLIF(LTRIM(RTRIM(@Revisor)), N'');
    SET @Comentario = NULLIF(LTRIM(RTRIM(@Comentario)), N'');
    IF @Revisor IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF @@TRANCOUNT > 0
        THROW 51209, N'Aplicar abre su propia transaccion: no se llama dentro de otra.', 1;

    DECLARE @codigo nvarchar(100), @tipo varchar(10), @estado varchar(10),
            @eA nvarchar(100), @eN nvarchar(100), @sA nvarchar(100), @sN nvarchar(100),
            @campo varchar(13), @fA date, @fN date, @nota nvarchar(2000) = NULL;
    BEGIN TRY
        BEGIN TRAN;
            SELECT @codigo = Codigo, @tipo = Tipo, @estado = Estado,
                   @eA = EstadoAnterior, @eN = EstadoNuevo, @sA = SubestadoAnterior, @sN = SubestadoNuevo,
                   @campo = CampoFecha, @fA = FechaAnterior, @fN = FechaNueva
            FROM adm.SolicitudCambio WITH (UPDLOCK, HOLDLOCK)
            WHERE IdSolicitud = @IdSolicitud;
            IF @estado IS NULL THROW 51201, N'La solicitud no existe.', 1;
            IF @estado <> 'PENDIENTE' THROW 51202, N'La solicitud ya fue revisada (aplicada o rechazada).', 1;
            IF @tipo = 'OTROS' AND @Comentario IS NULL
                THROW 51206, N'Una solicitud Otros se cierra con el comentario de lo que se corrigio.', 1;
            IF @tipo = 'OTROS' AND EXISTS (SELECT 1 FROM @Clasificaciones)
                THROW 51222, N'Solo se clasifica una categoria por agregar que llego sin clasificacion.', 1;

            IF @tipo <> 'OTROS'
            BEGIN
                -- Desactualizada: lo que la solicitud vio ya no es lo que hay.
                -- Textos en binario (como la proteccion de Modificar).
                DECLARE @pE nvarchar(100), @pS nvarchar(100), @pAn date, @pSo date, @pCi date;
                SELECT @pE = Estado, @pS = Subestado, @pAn = FechaAnalisis, @pSo = FechaSolucion, @pCi = FechaCierre
                FROM dbo.Problem WITH (UPDLOCK, HOLDLOCK) WHERE Codigo = @codigo;
                IF @@ROWCOUNT = 0 THROW 51006, N'La iniciativa no existe.', 1;
                DECLARE @pF date = CASE @campo WHEN 'FechaAnalisis' THEN @pAn
                                               WHEN 'FechaSolucion' THEN @pSo
                                               WHEN 'FechaCierre'   THEN @pCi END;
                IF (@tipo = 'ESTADO' AND (CONVERT(varbinary(400), ISNULL(@pE, N'')) <> CONVERT(varbinary(400), ISNULL(@eA, N''))
                                       OR CONVERT(varbinary(400), ISNULL(@pS, N'')) <> CONVERT(varbinary(400), ISNULL(@sA, N''))))
                   OR (@campo IS NOT NULL AND ISNULL(@pF, '19000101') <> ISNULL(@fA, '19000101'))
                   OR EXISTS (SELECT 1 FROM adm.SolicitudCambioCategoria AS c
                              LEFT JOIN dbo.ProblemCategoria AS pc WITH (UPDLOCK, HOLDLOCK)
                                     ON pc.Codigo = @codigo AND pc.Categoria = c.Categoria
                              WHERE c.IdSolicitud = @IdSolicitud
                                AND ((c.Accion = 'PCT' AND (pc.Codigo IS NULL OR pc.VigenteEnOrigen <> 1
                                                            OR ISNULL(pc.PctDisminucion, -1) <> ISNULL(c.PctAnterior, -1)))
                                  OR (c.Accion = 'AGREGAR' AND pc.Codigo IS NOT NULL)))
                    THROW 51204, N'La iniciativa cambio desde que se envio la solicitud: no se aplica. Rechazala o pide que la envien de nuevo.', 1;

                -- Clasificacion de ADM: solo filas AGREGAR que llegaron sin ella.
                IF EXISTS (SELECT 1 FROM @Clasificaciones GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
                    THROW 51003, N'Una categoria viene repetida.', 1;
                IF EXISTS (SELECT 1 FROM @Clasificaciones
                           WHERE NULLIF(LTRIM(RTRIM(TipoIniciativa)), N'') IS NULL OR NULLIF(LTRIM(RTRIM(TipoAgrupado)), N'') IS NULL)
                    THROW 51223, N'La clasificacion de ADM necesita Tipo de iniciativa y Agrupacion.', 1;
                IF EXISTS (SELECT 1 FROM @Clasificaciones AS r
                           WHERE NOT EXISTS (SELECT 1 FROM adm.SolicitudCambioCategoria AS c
                                             WHERE c.IdSolicitud = @IdSolicitud AND c.Accion = 'AGREGAR'
                                               AND c.Categoria = LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' ')))
                                               AND c.TipoIniciativa IS NULL AND c.TipoAgrupado IS NULL))
                    THROW 51222, N'Solo se clasifica una categoria por agregar que llego sin clasificacion.', 1;
                IF EXISTS (SELECT 1 FROM @Clasificaciones)
                BEGIN
                    UPDATE c SET c.TipoIniciativa = LTRIM(RTRIM(r.TipoIniciativa)), c.TipoAgrupado = LTRIM(RTRIM(r.TipoAgrupado))
                    FROM adm.SolicitudCambioCategoria AS c
                    INNER JOIN @Clasificaciones AS r ON c.Categoria = LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' ')))
                    WHERE c.IdSolicitud = @IdSolicitud AND c.Accion = 'AGREGAR';
                    SET @nota = LEFT(N'Clasificacion elegida por ADM: ' + STUFF((
                        SELECT N'; ' + LTRIM(RTRIM(REPLACE(r2.Categoria, NCHAR(160), N' '))) + N' = '
                             + LTRIM(RTRIM(r2.TipoIniciativa)) + N' / ' + LTRIM(RTRIM(r2.TipoAgrupado))
                        FROM @Clasificaciones AS r2 ORDER BY r2.Categoria
                        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N''), 2000);
                END;
                IF EXISTS (SELECT 1 FROM adm.SolicitudCambioCategoria
                           WHERE IdSolicitud = @IdSolicitud AND Accion = 'AGREGAR' AND (TipoIniciativa IS NULL OR TipoAgrupado IS NULL))
                    THROW 51221, N'Una categoria por agregar no tiene clasificacion (Tipo de iniciativa y Agrupacion): ADM debe elegirla.', 1;

                DECLARE @pcts adm.CategoriaPctTipo, @agregar adm.CategoriaPctTipo, @fechasCat adm.CategoriaFechaTipo;
                INSERT @pcts (Categoria, Pct)
                SELECT Categoria, PctNuevo FROM adm.SolicitudCambioCategoria WHERE IdSolicitud = @IdSolicitud AND Accion = 'PCT';
                INSERT @agregar (Categoria, Pct, TipoIniciativa, TipoAgrupado)
                SELECT Categoria, PctNuevo, TipoIniciativa, TipoAgrupado
                FROM adm.SolicitudCambioCategoria WHERE IdSolicitud = @IdSolicitud AND Accion = 'AGREGAR';

                DECLARE @cE bit  = CASE WHEN @tipo = 'ESTADO' THEN 1 ELSE 0 END,
                        @cS bit  = CASE WHEN @tipo = 'ESTADO' AND @sN IS NOT NULL THEN 1 ELSE 0 END,
                        @cFA bit = CASE WHEN @campo = 'FechaAnalisis' THEN 1 ELSE 0 END,
                        @cFS bit = CASE WHEN @campo = 'FechaSolucion' THEN 1 ELSE 0 END,
                        @cFC bit = CASE WHEN @campo = 'FechaCierre' THEN 1 ELSE 0 END;
                EXEC adm.usp_GestionAdmin_Modificar
                     @Usuario = @Revisor, @Codigo = @codigo,
                     @CambiaEstado = @cE, @Estado = @eN, @CambiaSubestado = @cS, @Subestado = @sN,
                     @CambiaFAnalisis = @cFA, @FAnalisis = @fN,
                     @CambiaFSolucion = @cFS, @FSolucion = @fN,
                     @CambiaFCierre = @cFC, @FCierre = @fN,
                     @Pcts = @pcts, @Agregar = @agregar, @FechasCategoria = @fechasCat,
                     @Hoy = @Hoy, @SolicitudId = @IdSolicitud;
            END;

            UPDATE adm.SolicitudCambio
               SET Estado = 'APLICADA', RevisadoPor = @Revisor, FechaRevisionUtc = SYSUTCDATETIME(),
                   ComentarioRevision = @Comentario, Intentos = Intentos + 1,
                   UltimoError = NULL, FechaUltimoIntentoUtc = SYSUTCDATETIME()
             WHERE IdSolicitud = @IdSolicitud;
            INSERT adm.SolicitudCambioEvento (IdSolicitud, Evento, Usuario, Detalle)
            VALUES (@IdSolicitud, 'APLICADA', @Revisor,
                    LEFT(CASE WHEN @nota IS NULL THEN @Comentario
                              WHEN @Comentario IS NULL THEN @nota
                              ELSE @Comentario + N' | ' + @nota END, 2000));
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @num int = ERROR_NUMBER(), @msg nvarchar(2000) = LEFT(ERROR_MESSAGE(), 2000);
        -- No existe, ya revisada, sin comentario o clasificacion mal dada por
        -- ADM: nada que registrar (no es un intento de aplicar). Lo demas se
        -- registra y la solicitud sigue PENDIENTE: nunca se pierde. Si el
        -- registro mismo falla, igual se lanza el error original.
        IF @num NOT IN (51201, 51202, 51206, 51209, 51222, 51223, 51003)
        BEGIN TRY
            EXEC adm.usp_SolicitudCambio_RegistrarFallo @IdSolicitud = @IdSolicitud, @Revisor = @Revisor,
                 @Numero = @num, @Mensaje = @msg;
        END TRY
        BEGIN CATCH
        END CATCH;
        THROW;
    END CATCH;
END;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 22: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* ---------- 5. Postcondicion: hashes exactos y parametros ---------- */
IF OBJECT_ID('tempdb..#p22') IS NOT NULL DROP TABLE #p22;
SELECT v.Objeto, v.Esperado, Hash = HASHBYTES('SHA2_256', REPLACE(REPLACE(REPLACE(REPLACE(
                   OBJECT_DEFINITION(OBJECT_ID(v.Objeto, 'P')),
                   N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''))
INTO #p22
FROM (VALUES (N'adm.usp_GestionAdmin_Modificar', 0x8E0848187A529F6E0C2D9D8B30820F0EA19CCDEC7C7937EFB41BF33108084BA9),
             (N'adm.usp_SolicitudCambio_Crear', 0x33BBF48EB2CA3F3ED42B232BDEE570E634734348AB95D0B9D48568D3B70FDC71),
             (N'adm.usp_SolicitudCambio_Rechazar', 0xFC91FF5A0C7F5F445A1EEA168C20D696DE7D3D0943499D9EC1CF604F5987EF24),
             (N'adm.usp_SolicitudCambio_RegistrarFallo', 0x1125E2A3BD250A4EEB68703A72A55DACE9B3B43E4DCA13D3C9BD84FA35D7DB95),
             (N'adm.usp_SolicitudCambio_Aplicar', 0xB12230C54B32CEB5CA060D1431BB4E8F5A052A69CED25872B2F1775A62BF17C1)) AS v (Objeto, Esperado);
DECLARE @mal2 nvarchar(400) = (SELECT TOP (1) Objeto + N' (hash ' + ISNULL(CONVERT(nvarchar(70), Hash, 1), N'NULL') + N')'
                               FROM #p22 WHERE Hash IS NULL OR Hash <> Esperado ORDER BY Objeto);
IF @mal2 IS NULL
   AND OBJECT_ID('adm.SolicitudCambio', 'U') IS NOT NULL AND OBJECT_ID('adm.SolicitudCambioCategoria', 'U') IS NOT NULL
   AND OBJECT_ID('adm.SolicitudCambioEvento', 'U') IS NOT NULL AND TYPE_ID('adm.SolicitudCategoriaTipo') IS NOT NULL AND TYPE_ID('adm.SolicitudClasificacionTipo') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')
               AND name = N'@SolicitudId' AND TYPE_NAME(user_type_id) = N'int' AND is_output = 0)
   AND (SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('adm.usp_GestionAdmin_Modificar')) = 23
BEGIN
    COMMIT;
    SELECT Migracion = N'22', Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    SET @mal2 = ISNULL(@mal2, N'objetos o parametros');
    RAISERROR (N'Migracion 22: %s no quedo como se esperaba; ROLLBACK de todo.', 16, 1, @mal2);
END;
GO
SET NOEXEC OFF;
GO
