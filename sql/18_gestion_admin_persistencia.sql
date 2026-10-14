/* =========================================================================
   sql/18_gestion_admin_persistencia.sql - Persistencia de la gestion
   directa de ADM (Crear / Ligar / Modificar) sobre dbo.Problem y
   dbo.ProblemCategoria.                         ROLLBACK: _rollback.sql

   ESTADO: SIN APROBAR. No se ha corrido en la VM. Probado solo en LocalDB
   desechable (tools/tests/GestionAdminSqlLocalDbSmoke.cs).

   DISENO APROBADO 2026-10-13 (simplificado)
     0 tablas nuevas. 2 tablas modificadas (dbo.ProblemCategoria,
     dbo.ProblemFechaEvento). 1 trigger nuevo
     (dbo.trg_ProblemCategoria_FechaEvento). Esquema adm con 2 tipos de
     tabla (parametros, no tablas) y 4 procedimientos. Sin adm.ProblemaAdmin,
     sin contador de Codigo, sin historial de %, sin parche del cargador:
     el cargador del Excel se RETIRA antes de encender la persistencia
     (stub aparte, en el repo del backend; no es parte de este script).

   COMO CORRERLO (cuando haya OK)
   La guarda de abajo detiene el script salvo en una base de prueba
   GestionAdminPrueba_* o con la aprobacion declarada en la MISMA sesion:
       EXEC sys.sp_set_session_context N'aprobar_migracion', N'18';
   Correr completo (sqlcmd -b -I, o SSMS con el script entero). Todo va en
   UNA transaccion que abarca los lotes; cada lote comprueba que la
   transaccion sigue abierta. Al final, si estan todos los objetos: COMMIT.
   Despues (repo del backend, aparte): vw_ProblemCategoria y
   vw_ProblemVencido con la fecha efectiva por categoria.

   PRECONDICIONES (las revisa el script; si falla una, no toca nada)
     - dbo.trg_Problem_FechaEvento existe (sql/17, captura de fechas).
     - dbo.ProblemCategoria sin FechaCreacionCategoria/FechaAnalisisCategoria,
       dbo.ProblemFechaEvento sin Categoria, esquema adm inexistente.

   QUE CAMBIA
   1. dbo.ProblemCategoria + FechaCreacionCategoria / FechaAnalisisCategoria
      (date NULL, CHECK: las dos o ninguna). NULL = la categoria hereda las
      fechas de la iniciativa (todas las filas existentes y las iniciales
      de un alta). Con valor = ligada despues: creacion = el dia en que se
      liga (Mexico), analisis = ese dia + 15 naturales (editable). Agregar
      columnas NULL es solo metadatos. No se reusan FechaAltaDW ni MejorFecha.
   2. dbo.ProblemFechaEvento + Categoria (nvarchar(450), collation de
      dbo.ProblemCategoria.Categoria). NULL = evento de la iniciativa (todas
      las filas existentes, intactas). Con valor = evento de la fecha de
      analisis PROPIA de esa categoria: Campo = 'FechaAnalisis' (CK_Campo no
      cambia), Operacion 'I' (primera asignacion, al ligar) o 'U'.
      CK_ProblemFechaEvento_Nivel lo exige. FK compuesta (Codigo, Categoria)
      -> dbo.ProblemCategoria: con Categoria NULL SQL Server no la revisa,
      asi que las filas de la iniciativa siguen igual.
   3. dbo.trg_ProblemCategoria_FechaEvento (AFTER INSERT, UPDATE): una fila
      por cambio REAL de FechaAnalisisCategoria; FechaAnterior = el valor
      crudo anterior (NULL = la categoria heredaba la de la iniciativa).
      Atribucion: las mismas llaves de SESSION_CONTEXT que
      trg_Problem_FechaEvento (pfe_origen / pfe_usuario / pfe_solicitud).
   4. Esquema adm:
        adm.CategoriaPctTipo     (Categoria, Pct, TipoIniciativa, TipoAgrupado)
        adm.CategoriaFechaTipo   (Categoria, FechaAnalisis)
        adm.usp_GestionAdmin_RevisarTope      tope 100% por ruta, con candado
        adm.usp_GestionAdmin_TicketsReduce    TicketsReduce de unas filas
        adm.usp_GestionAdmin_Crear            alta atomica, Codigo incluido
        adm.usp_GestionAdmin_Modificar        cambios, ligar, fechas, tope
      La web solo necesita EXECUTE sobre adm.

   REGLAS QUE VIVEN AQUI
   - Codigo 'PPP AAAA-NNNNNN' (forma verificada; anio = el de FechaCreacion
     = hoy en Mexico, decision 2026-10-13). Dentro de la transaccion del
     alta: candado de aplicacion por (prefijo, anio) y luego el mayor
     numero que ya existe en dbo.Problem, activo o no. Los codigos mal
     formados del mismo prefijo y anio cuentan si su numero se puede leer
     (nunca se reusa ese numero); si no se puede leer, el alta se rechaza
     (51023) en vez de adivinar. Mas de 999999 = 51022. El Codigo nunca
     cambia: Modificar no tiene parametro para el.
   - Hoy = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())), la misma
     regla UTC-6 de las vistas de avisos (@Hoy solo lo pasan las pruebas y
     el sitio con su propio "hoy" de Mexico).
   - TipoIniciativa, TipoAgrupado y Estado: OPCIONALES (Admin crea justo
     cuando falta informacion; decision 2026-10-13). Nunca se derivan del
     prefijo: si no vienen quedan NULL. Si vienen, tienen que ser valores
     que ya existen (dbo.Problem / dbo.ProblemCategoria; no hay catalogo).
   - Tope 100% por ruta (regla de ExperienciaQueries.ConsumeCapacidad):
     consume la fila vigente de una iniciativa en estado vivo con
     TipoAgrupado de AGRUPADORES. Para que una fila SIN agrupacion no se
     salte el tope, se trata como si consumiera (conservador): al escribirla
     se revisa, y al revisar a otra iniciativa se suma. Se revisa, con candado por ruta, toda fila que vaya a
     consumir y que antes no consumia (alta, ligada, reactivada, cambio de
     agrupador) o cuyo % sube. Bajar o dejar igual nunca se bloquea.
   - TicketsReduce = ROUND(VolumenUltimos30 x PctDisminucion, 0) con
     VolumenUltimos30 leido de dbo.vw_ProblemCategoria (regla verificada en
     QA 2026-10-01; la misma formula documentada de
     experiencia/INSTALAR_TICKETS_REDUCE.md). Sin % = NULL. El calculo
     diario de dbo.usp_Exp_CalcularTicketsReduce (dbo.ExpTicketsReduce)
     lo sigue reemplazando en el tablero cuando corre.
   - NroCambioFecha*: Modificar los incrementa con los eventos que acaba de
     escribir el trigger de la iniciativa, con la regla de conteo del
     2026-10-09: Analisis y Solucion cuentan todo cambio fecha -> otra
     fecha; Cierre solo las extensiones (nueva > anterior); 'I', 'B',
     asignar (NULL -> fecha) y retirar (fecha -> NULL) no cuentan. El valor
     del Excel queda como base (su historial no esta completo).

   NO TOCA: datos existentes, dbo.Problem (esquema), sus triggers,
   dbo.ProblemEstadoEvento, usp_CargarExperiencia, las vistas del backend.
   ========================================================================= */

IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
   AND ISNULL(CONVERT(nvarchar(10), SESSION_CONTEXT(N'aprobar_migracion')), N'') <> N'18'
BEGIN
    RAISERROR (N'Migracion 18 SIN APROBAR: declara EXEC sys.sp_set_session_context N''aprobar_migracion'', N''18'' en esta sesion.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF COL_LENGTH('dbo.ProblemCategoria', 'FechaCreacionCategoria') IS NOT NULL
   OR COL_LENGTH('dbo.ProblemCategoria', 'FechaAnalisisCategoria') IS NOT NULL
   OR COL_LENGTH('dbo.ProblemFechaEvento', 'Categoria') IS NOT NULL
   OR SCHEMA_ID('adm') IS NOT NULL
BEGIN
    RAISERROR (N'Migracion 18: ya aplicada o parcialmente aplicada (columnas o esquema adm existen). No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
IF OBJECT_ID('dbo.trg_Problem_FechaEvento', 'TR') IS NULL
   OR OBJECT_ID('dbo.ProblemFechaEvento', 'U') IS NULL
   OR OBJECT_ID('dbo.vw_ProblemCategoria', 'V') IS NULL
BEGIN
    RAISERROR (N'Migracion 18: falta dbo.ProblemFechaEvento, dbo.trg_Problem_FechaEvento (sql/17) o dbo.vw_ProblemCategoria. No se toca nada.', 16, 1);
    SET NOEXEC ON;
END;
GO
SET XACT_ABORT ON;
BEGIN TRAN;
GO

/* ---------- 1. Fechas propias por categoria ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: la transaccion ya no esta abierta; se detiene.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE dbo.ProblemCategoria ADD
    FechaCreacionCategoria date NULL,
    FechaAnalisisCategoria date NULL;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE dbo.ProblemCategoria ADD
    CONSTRAINT CK_ProblemCategoria_FechasCategoria CHECK (
        (FechaCreacionCategoria IS NULL AND FechaAnalisisCategoria IS NULL)
        OR (FechaCreacionCategoria IS NOT NULL AND FechaAnalisisCategoria IS NOT NULL));
GO

/* ---------- 2. Historial: eventos por categoria en dbo.ProblemFechaEvento ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
-- Mismo tipo y collation que dbo.ProblemCategoria.Categoria (la FK lo exige).
DECLARE @col sysname = (SELECT c.collation_name FROM sys.columns AS c
                        WHERE c.object_id = OBJECT_ID('dbo.ProblemCategoria') AND c.name = N'Categoria');
DECLARE @tipo nvarchar(40) = (SELECT TYPE_NAME(c.user_type_id) + N'(' + CONVERT(nvarchar(10), c.max_length / 2) + N')'
                              FROM sys.columns AS c
                              WHERE c.object_id = OBJECT_ID('dbo.ProblemCategoria') AND c.name = N'Categoria');
IF @col IS NULL OR @tipo <> N'nvarchar(450)'
    THROW 51090, N'Migracion 18: dbo.ProblemCategoria.Categoria no es nvarchar(450) con collation: revisar antes de seguir.', 1;
DECLARE @sql nvarchar(400) = N'ALTER TABLE dbo.ProblemFechaEvento ADD Categoria nvarchar(450) COLLATE ' + @col + N' NULL;';
EXEC (@sql);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
ALTER TABLE dbo.ProblemFechaEvento ADD
    CONSTRAINT CK_ProblemFechaEvento_Nivel CHECK (
        Categoria IS NULL OR (Campo = 'FechaAnalisis' AND Operacion IN ('I', 'U'))),
    CONSTRAINT FK_ProblemFechaEvento_ProblemCategoria
        FOREIGN KEY (Codigo, Categoria) REFERENCES dbo.ProblemCategoria (Codigo, Categoria);
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE TRIGGER dbo.trg_ProblemCategoria_FechaEvento
ON dbo.ProblemCategoria
AFTER INSERT, UPDATE
AS
BEGIN
    /* Historial de la fecha de analisis PROPIA de una categoria
       (FechaAnalisisCategoria) en dbo.ProblemFechaEvento, con Categoria.
       Una fila por cambio real: un INSERT con NULL (cargador, categorias
       iniciales) no escribe nada. FechaAnterior es el valor crudo: NULL =
       la categoria heredaba la fecha de la iniciativa. 'I' = la fila se
       inserto con su fecha (ligada despues); 'U' = cambio posterior.
       Atribucion igual que dbo.trg_Problem_FechaEvento. Crea: sql/18. */
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF NOT UPDATE(FechaAnalisisCategoria) RETURN;

    DECLARE @esAdmin bit =
        CASE WHEN CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen')) = 'ADMIN' THEN 1 ELSE 0 END;
    DECLARE @usuario nvarchar(256) =
        CASE WHEN @esAdmin = 1 THEN CONVERT(nvarchar(256), SESSION_CONTEXT(N'pfe_usuario')) END;
    DECLARE @solicitud int =
        CASE WHEN @esAdmin = 1 THEN TRY_CONVERT(int, SESSION_CONTEXT(N'pfe_solicitud')) END;

    INSERT dbo.ProblemFechaEvento
           (Codigo, Categoria, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario, SolicitudId)
    SELECT i.Codigo, i.Categoria, 'FechaAnalisis', d.FechaAnalisisCategoria, i.FechaAnalisisCategoria,
           CASE WHEN d.Codigo IS NULL THEN 'I' ELSE 'U' END,
           CASE WHEN @esAdmin = 1 THEN 'ADMIN' ELSE 'NO_DECLARADO' END,
           @usuario, @solicitud
    FROM inserted AS i
    LEFT JOIN deleted AS d ON d.Codigo = i.Codigo AND d.Categoria = i.Categoria
    WHERE EXISTS (SELECT d.FechaAnalisisCategoria EXCEPT SELECT i.FechaAnalisisCategoria);
END;
GO

/* ---------- 3. Esquema adm y tipos de parametro ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE SCHEMA adm AUTHORIZATION dbo;
GO
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
-- Una categoria y su % (fraccion). TipoIniciativa / TipoAgrupado: en las
-- que se ligan, obligatorios; en las ya ligadas, NULL = no cambia.
CREATE TYPE adm.CategoriaPctTipo AS TABLE
(
    Categoria      nvarchar(450) NOT NULL,
    Pct            decimal(9,4)  NULL,
    TipoIniciativa nvarchar(100) NULL,
    TipoAgrupado   nvarchar(100) NULL
);
-- Nueva fecha de analisis de una categoria ya ligada.
CREATE TYPE adm.CategoriaFechaTipo AS TABLE
(
    Categoria     nvarchar(450) NOT NULL,
    FechaAnalisis date NULL
);
GO

/* ---------- 4. Tope de capacidad ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* @Revisar: SOLO las filas que van a consumir y hay que revisar (Pct = el
   valor nuevo). Toma un candado exclusivo por ruta y luego suma lo que
   consumen las DEMAS iniciativas; los candados duran hasta el COMMIT o
   ROLLBACK del que llama. */
CREATE PROCEDURE adm.usp_GestionAdmin_RevisarTope
    @Codigo  nvarchar(100),                 -- quien escribe: no cuenta contra si mismo
    @Revisar adm.CategoriaPctTipo READONLY
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT = 0 THROW 51030, N'adm.usp_GestionAdmin_RevisarTope debe correr dentro de una transaccion.', 1;

    -- Candado por ruta normalizada (DirectorioOrganizacional.Normaliza: NBSP
    -- -> espacio, sin espacios en las puntas, sin distinguir mayusculas), en
    -- orden fijo para no cruzarse en un deadlock.
    DECLARE @recurso nvarchar(255), @rc int;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT N'adm.capacidad:' + CONVERT(nvarchar(64),
               HASHBYTES('SHA2_256', UPPER(LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' '))))), 2)
        FROM @Revisar AS r
        ORDER BY 1;
    OPEN c;
    FETCH NEXT FROM c INTO @recurso;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC @rc = sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive',
                                 @LockOwner = 'Transaction', @LockTimeout = 15000;
        IF @rc < 0 THROW 51031, N'No se pudo reservar la categoria para revisar su capacidad (tiempo agotado).', 1;
        FETCH NEXT FROM c INTO @recurso;
    END;
    CLOSE c; DEALLOCATE c;

    -- Consumo = ExperienciaQueries.ConsumeCapacidad (vigente en origen,
    -- Estado vivo CI_AI, TipoAgrupado de AGRUPADORES) MAS las filas vivas SIN
    -- agrupacion (NULL o vacia), que se cuentan como si consumieran: el tope
    -- nunca se pasa por un dato que falta. Es mas estricto que el tablero
    -- (que no las suma); ver CUTOVER (decision pendiente de igualarlos).
    DECLARE @msg nvarchar(2048);
    SELECT TOP (1) @msg = r.Categoria + N': solo tiene ' +
           CONVERT(nvarchar(20), CONVERT(decimal(9,2), 100 * CASE WHEN u.Usado >= 1 THEN 0 ELSE 1 - u.Usado END)) +
           N'% disponible sin contar esta iniciativa (tope 100% por categoria).'
    FROM @Revisar AS r
    CROSS APPLY (
        SELECT Usado = ISNULL(SUM(pc.PctDisminucion), 0)
        FROM dbo.ProblemCategoria AS pc
        INNER JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
        WHERE pc.VigenteEnOrigen = 1
          AND p.VigenteEnOrigen = 1
          AND pc.Codigo <> @Codigo
          AND LTRIM(RTRIM(REPLACE(pc.Categoria, NCHAR(160), N' ')))
              = LTRIM(RTRIM(REPLACE(r.Categoria, NCHAR(160), N' ')))
          AND LTRIM(RTRIM(p.Estado)) COLLATE Latin1_General_CI_AI
              IN (N'En Analisis', N'En Solucion', N'En Monitoreo')
          AND (NULLIF(LTRIM(RTRIM(pc.TipoAgrupado)), N'') IS NULL
               OR LTRIM(RTRIM(pc.TipoAgrupado)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
    ) AS u
    WHERE r.Pct IS NOT NULL
      AND r.Pct > CASE WHEN u.Usado >= 1 THEN 0 ELSE 1 - u.Usado END
    ORDER BY r.Categoria;
    IF @msg IS NOT NULL THROW 51010, @msg, 1;
END;
GO

/* ---------- 5. TicketsReduce ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* TicketsReduce = ROUND(VolumenUltimos30 x PctDisminucion, 0) de las filas
   (@Codigo, Categoria) dadas, con el VolumenUltimos30 de la MISMA vista que
   lo publica (dbo.vw_ProblemCategoria); no se repite su conteo aqui. Sin %
   = NULL. Lo llaman Crear y Modificar dentro de su transaccion. */
CREATE PROCEDURE adm.usp_GestionAdmin_TicketsReduce
    @Codigo     nvarchar(100),
    @Categorias adm.CategoriaPctTipo READONLY   -- solo se lee Categoria
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    UPDATE pc SET
        pc.TicketsReduce = CASE WHEN pc.PctDisminucion IS NULL THEN NULL
                                ELSE CONVERT(int, ROUND(v.VolumenUltimos30 *
                                     CASE WHEN pc.PctDisminucion > 1 THEN 1.0 ELSE pc.PctDisminucion END, 0)) END
    FROM dbo.ProblemCategoria AS pc
    INNER JOIN @Categorias AS c
            ON pc.Categoria = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))
    OUTER APPLY (SELECT TOP (1) VolumenUltimos30 = ISNULL(x.VolumenUltimos30, 0)
                 FROM dbo.vw_ProblemCategoria AS x
                 WHERE x.Codigo = pc.Codigo AND x.Categoria = pc.Categoria) AS v
    WHERE pc.Codigo = @Codigo;
END;
GO

/* ---------- 6. Alta ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
CREATE PROCEDURE adm.usp_GestionAdmin_Crear
    @Usuario              nvarchar(256),
    @Prefijo              nvarchar(10),
    @TipoIniciativa       nvarchar(100),
    @TipoAgrupado         nvarchar(100),
    @Estado               nvarchar(100),
    @Titulo               nvarchar(max),
    @Descripcion          nvarchar(max),
    @Observaciones        nvarchar(max),
    @FechaEntregaAnalisis date = NULL,          -- NULL = hoy
    @Categorias           adm.CategoriaPctTipo READONLY,
    @Hoy                  date = NULL,          -- NULL = hoy en Mexico (UTC-6)
    @Codigo               nvarchar(100) OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Codigo = NULL;
    SET @Prefijo = UPPER(LTRIM(RTRIM(@Prefijo)));
    SET @TipoIniciativa = NULLIF(LTRIM(RTRIM(@TipoIniciativa)), N'');
    SET @TipoAgrupado = NULLIF(LTRIM(RTRIM(@TipoAgrupado)), N'');
    SET @Estado = NULLIF(LTRIM(RTRIM(@Estado)), N'');

    IF NULLIF(LTRIM(RTRIM(@Usuario)), N'') IS NULL
        THROW 51001, N'Falta el usuario autenticado: no se guarda nada sin atribucion.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.CatPrefijoProblem WHERE Prefijo = @Prefijo)
        THROW 51002, N'El prefijo no esta en dbo.CatPrefijoProblem.', 1;
    -- dbo.Problem.Prefijo es UPPER(LEFT(Codigo, 3)): un prefijo del catalogo
    -- que no sea de tres letras no puede formar un Codigo valido.
    IF @Prefijo COLLATE Latin1_General_BIN NOT LIKE N'[A-Z][A-Z][A-Z]'
        THROW 51021, N'Prefijo invalido para un Codigo: se esperan tres letras (PPP AAAA-NNNNNN).', 1;
    -- Opcionales: si no vienen, NULL (la iniciativa queda incompleta).
    IF @TipoIniciativa IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(TipoIniciativa)) = @TipoIniciativa)
        THROW 51011, N'Tipo de iniciativa que no existe en dbo.Problem.', 1;
    IF @TipoAgrupado IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.ProblemCategoria WHERE LTRIM(RTRIM(TipoAgrupado)) = @TipoAgrupado)
        THROW 51012, N'Agrupacion (TipoAgrupado) que no existe en dbo.ProblemCategoria.', 1;
    IF @Estado IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Problem WHERE LTRIM(RTRIM(Estado)) = @Estado)
        THROW 51013, N'Estado inicial que no existe en dbo.Problem.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias
               GROUP BY LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))) HAVING COUNT(*) > 1)
        THROW 51003, N'Una categoria viene repetida.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE NULLIF(LTRIM(RTRIM(REPLACE(Categoria, NCHAR(160), N' '))), N'') IS NULL)
        THROW 51004, N'Una categoria llego vacia.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias WHERE Pct < 0 OR Pct > 1)
        THROW 51005, N'El % de una categoria esta fuera de 0-100.', 1;
    IF EXISTS (SELECT 1 FROM @Categorias AS c
               WHERE NOT EXISTS (SELECT 1 FROM dbo.Categorias AS k
                                 WHERE k.VigenteEnOrigen = 1 AND k.RutaCompleta = LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' ')))))
        THROW 51015, N'Una categoria no esta (vigente) en dbo.Categorias.', 1;

    DECLARE @hoyMx date = COALESCE(@Hoy, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @analisis date = DATEADD(DAY, 15, @hoyMx);   -- 15 dias naturales
    DECLARE @anio char(4) = CONVERT(char(4), YEAR(@hoyMx));
    DECLARE @entrega date = COALESCE(@FechaEntregaAnalisis, @hoyMx);
    DECLARE @vivo bit = CASE WHEN @Estado COLLATE Latin1_General_CI_AI
                                  IN (N'En Analisis', N'En Solucion', N'En Monitoreo') THEN 1 ELSE 0 END;
    -- Sin agrupacion: se revisa como si consumiera (no se salta el tope).
    DECLARE @consume bit = CASE WHEN @vivo = 1 AND (@TipoAgrupado IS NULL OR @TipoAgrupado IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                                THEN 1 ELSE 0 END;
    DECLARE @nuevo nvarchar(100), @rc int, @max int, @raro nvarchar(100);

    BEGIN TRY
        BEGIN TRAN;
            -- Tope: solo si las filas van a consumir.
            IF @consume = 1
            BEGIN
                DECLARE @revisar adm.CategoriaPctTipo;
                INSERT @revisar (Categoria, Pct)
                SELECT c.Categoria, c.Pct FROM @Categorias AS c WHERE c.Pct > 0;
                EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = N'', @Revisar = @revisar;
            END;

            -- Codigo: un solo emisor por (prefijo, anio) a la vez; el candado
            -- dura hasta el COMMIT, asi que el siguiente ya ve este Codigo.
            DECLARE @recurso nvarchar(255) = N'adm.codigo:' + @Prefijo + N':' + @anio;
            EXEC @rc = sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive',
                                     @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @rc < 0 THROW 51025, N'No se pudo reservar el siguiente Codigo (tiempo agotado). Intenta de nuevo.', 1;

            -- Todos los codigos de ese prefijo y anio, activos o no, bien o
            -- mal formados ('PRB-2026-185', 'PRB 2026-00185 '...): quitando
            -- espacios, guiones y NBSP queda 'PRB2026' + numero.
            DECLARE @raiz nvarchar(20) = @Prefijo + @anio;
            SELECT @max = MAX(n.Numero),
                   @raro = MIN(CASE WHEN n.Numero IS NULL THEN p.Codigo END)
            FROM dbo.Problem AS p
            CROSS APPLY (SELECT Plano = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.Codigo)),
                                N' ', N''), N'-', N''), NCHAR(160), N''), NCHAR(9), N''))) AS x
            CROSS APPLY (SELECT Resto = SUBSTRING(x.Plano, LEN(@raiz) + 1, 100)) AS r
            CROSS APPLY (SELECT Numero = CASE WHEN r.Resto <> N'' AND r.Resto NOT LIKE N'%[^0-9]%' AND LEN(r.Resto) <= 9
                                              THEN CONVERT(int, r.Resto) END) AS n
            WHERE LEFT(x.Plano, LEN(@raiz)) = @raiz;
            IF @raro IS NOT NULL
            BEGIN
                DECLARE @msgRaro nvarchar(400) = N'Hay un Codigo de ' + @Prefijo + N' ' + @anio +
                    N' cuyo numero no se puede leer: ''' + @raro + N'''. Corrigelo antes de emitir otro (no se adivina).';
                THROW 51023, @msgRaro, 1;
            END;
            IF ISNULL(@max, 0) >= 999999
                THROW 51022, N'Se agotaron los consecutivos de ese prefijo y anio (999999).', 1;
            SET @nuevo = @Prefijo + N' ' + @anio + N'-' + RIGHT(N'000000' + CONVERT(nvarchar(6), ISNULL(@max, 0) + 1), 6);
            IF EXISTS (SELECT 1 FROM dbo.Problem WHERE Codigo = @nuevo)
                THROW 51024, N'El Codigo calculado ya existe: no se emite.', 1;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;

            -- Owner/Direccion y demas columnas del Excel: NULL (opcionales,
            -- decision 2026-10-13). VigenteEnOrigen = 1 para los filtros.
            INSERT dbo.Problem (Codigo, TipoIniciativa, Titulo, Descripcion, Observaciones, Estado,
                                FechaCreacion, FechaEntregaAnalisis, FechaAnalisis,
                                NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre,
                                VigenteEnOrigen)
            VALUES (@nuevo, @TipoIniciativa, @Titulo, @Descripcion, @Observaciones, @Estado,
                    @hoyMx, @entrega, @analisis, 0, 0, 0, 1);

            -- Iniciales: sin fechas propias (NULL) = heredan las de la iniciativa.
            INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen)
            SELECT @nuevo, LTRIM(RTRIM(REPLACE(c.Categoria, NCHAR(160), N' '))), @TipoIniciativa, @TipoAgrupado, c.Pct, 1
            FROM @Categorias AS c;

            EXEC adm.usp_GestionAdmin_TicketsReduce @Codigo = @nuevo, @Categorias = @Categorias;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        COMMIT;
        SET @Codigo = @nuevo;   -- solo despues del COMMIT
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        SET @Codigo = NULL;
        THROW;
    END CATCH;
END;
GO

/* ---------- 7. Modificacion ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada.', 16, 1); SET NOEXEC ON; END;
GO
/* Solo lo que trae su bandera Cambia*. No hay parametro para Codigo ni para
   FechaCreacion: no cambian.
   @Pcts      ligadas vigentes: Pct = el valor final; TipoIniciativa /
              TipoAgrupado NULL = no cambian (con valor, se declaran).
   @Agregar   se ligan ahora: Tipo* obligatorios; fechas PROPIAS = hoy y
              hoy + 15.
   @FechasCategoria  nueva fecha de analisis de una ligada. Si la categoria
              hereda (inicial, sin fecha propia), el cambio va a la fecha de
              la INICIATIVA (FechaAnalisis), no a una fecha propia. */
CREATE PROCEDURE adm.usp_GestionAdmin_Modificar
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
    @Hoy                 date = NULL
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
                WHERE (NULLIF(LTRIM(RTRIM(f.AgrupDespues)), N'') IS NULL OR LTRIM(RTRIM(f.AgrupDespues)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))
                  AND ISNULL(f.PctDespues, 0) > 0
                  AND (f.Nueva = 1
                       OR ISNULL(f.PctDespues, 0) > ISNULL(f.PctAntes, 0)
                       OR NOT (@vivoAntes = 1 AND (NULLIF(LTRIM(RTRIM(f.AgrupAntes)), N'') IS NULL
                                                   OR LTRIM(RTRIM(f.AgrupAntes)) IN (N'Problem', N'SorIA', N'Adopcion', N'Mejora'))));
                IF EXISTS (SELECT 1 FROM @revisar)
                    EXEC adm.usp_GestionAdmin_RevisarTope @Codigo = @Codigo, @Revisar = @revisar;
            END;

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = 'ADMIN';
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = @Usuario;
            EXEC sys.sp_set_session_context @key = N'pfe_solicitud', @value = NULL;

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

            EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
            EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        EXEC sys.sp_set_session_context @key = N'pfe_origen', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'pfe_usuario', @value = NULL;
        THROW;
    END CATCH;
END;
GO

/* ---------- 8. Permisos del sitio (verificado en la VM 2026-10-13, diag p2 Q3) ----------
   El sitio entra con el login SQL PROACTIVANETAD (usuario PROACTIVANETAD):
   db_datareader + db_datawriter + EXECUTE sobre el esquema dbo. O sea:
     - ya LEE todo (dbo.ProblemFechaEvento incluida): no hace falta GRANT
       SELECT;
     - EXECUTE sobre dbo NO cubre adm: hace falta el GRANT de abajo.
   adm no tiene tablas: no hay nada que negarle ahi.
   Descomentar al aplicar:
GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD];
*/

/* ---------- 9. Cierre ---------- */
IF @@TRANCOUNT = 0 BEGIN RAISERROR (N'Migracion 18: transaccion cerrada; nada que confirmar.', 16, 1); SET NOEXEC ON; END;
GO
IF OBJECT_ID('adm.usp_GestionAdmin_Modificar', 'P') IS NOT NULL
   AND OBJECT_ID('adm.usp_GestionAdmin_Crear', 'P') IS NOT NULL
   AND OBJECT_ID('adm.usp_GestionAdmin_TicketsReduce', 'P') IS NOT NULL
   AND OBJECT_ID('adm.usp_GestionAdmin_RevisarTope', 'P') IS NOT NULL
   AND OBJECT_ID('dbo.trg_ProblemCategoria_FechaEvento', 'TR') IS NOT NULL
   AND OBJECT_ID('dbo.FK_ProblemFechaEvento_ProblemCategoria', 'F') IS NOT NULL
   AND COL_LENGTH('dbo.ProblemCategoria', 'FechaAnalisisCategoria') IS NOT NULL
   AND COL_LENGTH('dbo.ProblemFechaEvento', 'Categoria') IS NOT NULL
BEGIN
    COMMIT;
    SELECT Migracion = 18, Resultado = 'APLICADA';
END
ELSE
BEGIN
    ROLLBACK;
    RAISERROR (N'Migracion 18: faltan objetos; ROLLBACK de todo.', 16, 1);
END;
GO
SET NOEXEC OFF;
GO
