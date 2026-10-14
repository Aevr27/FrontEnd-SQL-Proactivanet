/* Replica MINIMA para tools/tests/GestionAdminSqlLocalDbSmoke.cs: solo en una
   base desechable GestionAdminPrueba_* de LocalDB, nunca en la VM.

   Copiado de lo verificado:
   - dbo.Problem / dbo.ProblemCategoria: 13_experiencia_usuario.sql (repo ETL
     174bb51), columnas, PK y FK tal cual.
   - dbo.ProblemFechaEvento: el esquema que el P0 confirmo en la VM
     (2026-10-08) y el volcado del 2026-10-13 (05_checks.tsv).
   - dbo.trg_Problem_FechaEvento: sql/17_historial_fechas_captura.sql.
   - dbo.vw_ProblemCategoria / dbo.vw_ProblemVencido NO van aqui (son del
     backend; este repo es publico): la prueba los carga de
     ../backend_admin_persistencia/_origen (38 c041fe1 y 26 e0335c1, tal
     cual) o, si esa carpeta no esta, crea un stub minimo de la primera.
   - Lo que usa dbo.usp_CargarExperiencia (para probar el stub ADM_03):
     esquema stg, stg.*, dbo.CatPersona, dbo.CatCategoriaDueno y dbo.fn_Exp*,
     de 13_experiencia_usuario.sql (174bb51). El procedimiento se carga
     aparte: tools/tests/usp_CargarExperiencia_174bb51.sql.
   STUBS (no son las definiciones reales, solo lo minimo para que las
   vistas compilen): dbo.fn_CategoriaC1 / fn_CategoriaC1C2 (cortan por '/'),
   dbo.fn_ClaveNombre (mayusculas sin espacios ni acentos), dbo.vw_DuenoPorC1,
   dbo.Categorias y dbo.Tickets (solo las columnas que se leen).
   NO se replica dbo.trg_Problem_EstadoEvento / dbo.ProblemEstadoEvento: su
   definicion desplegada no esta en ningun repo. */

IF DB_NAME() NOT LIKE N'GestionAdminPrueba[_]%'
BEGIN
    RAISERROR (N'Replica de prueba: solo en GestionAdminPrueba_*.', 16, 1);
    SET NOEXEC ON;
END;
GO

CREATE TABLE dbo.CatPrefijoProblem
(
    Prefijo        nvarchar(10) NOT NULL CONSTRAINT PK_CatPrefijoProblem PRIMARY KEY,
    Descripcion    nvarchar(100) NULL,
    ControlDeFecha bit NOT NULL CONSTRAINT DF_CatPrefijoProblem_Ctrl DEFAULT (1)
);
GO

CREATE TABLE dbo.Categorias
(
    Id              nvarchar(100) NOT NULL CONSTRAINT PK_Categorias PRIMARY KEY,
    RutaCompleta    nvarchar(500) NULL,
    Inactiva        bit NULL,
    VigenteEnOrigen bit NOT NULL CONSTRAINT DF_Categorias_Vig DEFAULT (1)
);
GO

CREATE TABLE dbo.Tickets
(
    CodigoTicket  nvarchar(100) NOT NULL CONSTRAINT PK_Tickets PRIMARY KEY,
    FechaRegistro datetime2(0) NULL,
    Tipo          nvarchar(100) NULL,
    Categoria     nvarchar(500) NULL
);
GO

CREATE TABLE dbo.Problem
(
    Codigo                 NVARCHAR(100) NOT NULL,
    Prefijo                AS (UPPER(LEFT(Codigo, 3))) PERSISTED,
    TipoPrb                NVARCHAR(100) NULL,
    TipoIniciativa         NVARCHAR(100) NULL,
    Titulo                 NVARCHAR(MAX) NULL,
    Descripcion            NVARCHAR(MAX) NULL,
    Estado                 NVARCHAR(100) NULL,
    Subestado              NVARCHAR(100) NULL,
    Categoria              NVARCHAR(1000) NULL,
    OwnerServicio          NVARCHAR(255) NULL,
    OwnerProblem           NVARCHAR(255) NULL,
    Gerencia               NVARCHAR(255) NULL,
    Direccion              NVARCHAR(255) NULL,
    Macroproceso           NVARCHAR(255) NULL,
    Proceso                NVARCHAR(255) NULL,
    Causa                  NVARCHAR(255) NULL,
    Impacto                NVARCHAR(100) NULL,
    Prioridad              NVARCHAR(100) NULL,
    RCA                    NVARCHAR(50)  NULL,
    CuentaConWA            NVARCHAR(50)  NULL,
    Observaciones          NVARCHAR(MAX) NULL,
    UltimoComentario       NVARCHAR(MAX) NULL,
    HistoricoComentarios   NVARCHAR(MAX) NULL,
    VolumetriaOriginal     INT NULL,
    VolumenUltimoMes       INT NULL,
    FechaCreacion          DATETIME2(0) NULL,
    FechaEntregaPrb        DATETIME2(0) NULL,
    FechaEntregaAnalisis   DATETIME2(0) NULL,
    FechaAnalisis          DATETIME2(0) NULL,
    FechaOriginalSolucion  DATETIME2(0) NULL,
    FechaSolucion          DATETIME2(0) NULL,
    FechaOriginalCierre    DATETIME2(0) NULL,
    FechaCierre            DATETIME2(0) NULL,
    NroCambioFechaAnalisis INT NULL,
    NroCambioFechaSolucion INT NULL,
    NroCambioFechaCierre   INT NULL,
    VigenteEnOrigen        BIT NOT NULL CONSTRAINT DF_Prb_Vig   DEFAULT (1),
    FechaAltaDW            DATETIME2(0) NOT NULL CONSTRAINT DF_Prb_Alta  DEFAULT (SYSDATETIME()),
    FechaUltimaCargaDW     DATETIME2(0) NOT NULL CONSTRAINT DF_Prb_Carga DEFAULT (SYSDATETIME()),
    HashFila               BINARY(32) NULL,
    CONSTRAINT PK_Problem PRIMARY KEY CLUSTERED (Codigo)
);
GO

CREATE TABLE dbo.ProblemCategoria
(
    Codigo             NVARCHAR(100)  NOT NULL,
    Categoria          NVARCHAR(450)  NOT NULL,
    TipoTicket         NVARCHAR(100)  NULL,
    TipoIniciativa     NVARCHAR(100)  NULL,
    TipoAgrupado       NVARCHAR(100)  NULL,
    TituloIniciativa   NVARCHAR(MAX)  NULL,
    PctDisminucion     DECIMAL(9,4)   NULL,
    MesReduccion       INT            NULL,
    TicketsReduce      INT            NULL,
    DiasMesCerrado     INT            NULL,
    CategoriaInactiva  BIT            NULL,
    EstadoProblem      NVARCHAR(100)  NULL,
    CierreProblem      DATETIME2(0)   NULL,
    MejorFecha         DATETIME2(0)   NULL,
    VigenteEnOrigen    BIT NOT NULL CONSTRAINT DF_PrbCat_Vig   DEFAULT (1),
    FechaAltaDW        DATETIME2(0) NOT NULL CONSTRAINT DF_PrbCat_Alta  DEFAULT (SYSDATETIME()),
    FechaUltimaCargaDW DATETIME2(0) NOT NULL CONSTRAINT DF_PrbCat_Carga DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_ProblemCategoria PRIMARY KEY CLUSTERED (Codigo, Categoria),
    CONSTRAINT FK_ProblemCategoria_Problem FOREIGN KEY (Codigo) REFERENCES dbo.Problem (Codigo)
);
CREATE INDEX IX_ProblemCategoria_Categoria ON dbo.ProblemCategoria (Categoria) INCLUDE (Codigo);
GO

CREATE TABLE dbo.ProblemFechaEvento
(
    IdEvento      int IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProblemFechaEvento PRIMARY KEY CLUSTERED,
    Codigo        nvarchar(100) NOT NULL
                  CONSTRAINT FK_ProblemFechaEvento_Problem REFERENCES dbo.Problem (Codigo),
    Campo         varchar(13) NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Campo
                  CHECK (Campo IN ('FechaAnalisis', 'FechaSolucion', 'FechaCierre')),
    FechaAnterior date NULL,
    FechaNueva    date NULL,
    Operacion     char(1) NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Operacion CHECK (Operacion IN ('I', 'U', 'B')),
    Reconstruido  AS CAST(CASE WHEN Operacion = 'B' THEN 1 ELSE 0 END AS bit),
    Origen        varchar(12) NOT NULL
                  CONSTRAINT CK_ProblemFechaEvento_Origen CHECK (Origen IN ('NO_DECLARADO', 'ADMIN')),
    Usuario       nvarchar(256) NULL,
    SolicitudId   int NULL,
    LoginBD       nvarchar(128) NOT NULL CONSTRAINT DF_ProblemFechaEvento_LoginBD DEFAULT (ORIGINAL_LOGIN()),
    FechaRegistro datetime2(3) NOT NULL CONSTRAINT DF_ProblemFechaEvento_FechaRegistro DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_ProblemFechaEvento_Transicion CHECK (
        (FechaAnterior IS NOT NULL OR FechaNueva IS NOT NULL)
        AND (FechaAnterior IS NULL OR FechaNueva IS NULL OR FechaAnterior <> FechaNueva)),
    CONSTRAINT CK_ProblemFechaEvento_Base CHECK (
        Operacion <> 'B' OR (FechaAnterior IS NULL AND FechaNueva IS NOT NULL)),
    -- Tal cual la VM (volcado 2026-10-13, 05_checks.tsv): con Usuario IS NOT NULL.
    CONSTRAINT CK_ProblemFechaEvento_Atribucion CHECK (
        [Origen]='NO_DECLARADO' AND [Usuario] IS NULL AND [SolicitudId] IS NULL
        OR [Origen]='ADMIN' AND [Usuario] IS NOT NULL AND len(ltrim(rtrim([Usuario])))>(0))
);
GO

CREATE TRIGGER dbo.trg_Problem_FechaEvento
ON dbo.Problem
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF NOT (UPDATE(FechaAnalisis) OR UPDATE(FechaSolucion) OR UPDATE(FechaCierre)) RETURN;

    DECLARE @esAdmin bit =
        CASE WHEN CONVERT(varchar(12), SESSION_CONTEXT(N'pfe_origen')) = 'ADMIN' THEN 1 ELSE 0 END;
    DECLARE @usuario nvarchar(256) =
        CASE WHEN @esAdmin = 1 THEN CONVERT(nvarchar(256), SESSION_CONTEXT(N'pfe_usuario')) END;
    DECLARE @solicitud int =
        CASE WHEN @esAdmin = 1 THEN TRY_CONVERT(int, SESSION_CONTEXT(N'pfe_solicitud')) END;

    INSERT dbo.ProblemFechaEvento
           (Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario, SolicitudId)
    SELECT i.Codigo, v.Campo, v.Anterior, v.Nueva,
           CASE WHEN d.Codigo IS NULL THEN 'I' ELSE 'U' END,
           CASE WHEN @esAdmin = 1 THEN 'ADMIN' ELSE 'NO_DECLARADO' END,
           @usuario, @solicitud
    FROM inserted AS i
    LEFT JOIN deleted AS d ON d.Codigo = i.Codigo
    CROSS APPLY (VALUES
        ('FechaAnalisis', CONVERT(date, d.FechaAnalisis), CONVERT(date, i.FechaAnalisis)),
        ('FechaSolucion', CONVERT(date, d.FechaSolucion), CONVERT(date, i.FechaSolucion)),
        ('FechaCierre',   CONVERT(date, d.FechaCierre),   CONVERT(date, i.FechaCierre))
    ) AS v (Campo, Anterior, Nueva)
    WHERE EXISTS (SELECT v.Anterior EXCEPT SELECT v.Nueva);
END;
GO

/* ---------- Lo del cargador (13_experiencia_usuario.sql, 174bb51, tal cual) ---------- */
CREATE SCHEMA stg;
GO
IF OBJECT_ID('stg.Problems') IS NOT NULL DROP TABLE stg.Problems;
GO
CREATE TABLE stg.Problems
(
    Codigo NVARCHAR(100) NULL, TipoPrb NVARCHAR(100) NULL, TipoIniciativa NVARCHAR(100) NULL,
    FechaCreacion NVARCHAR(50) NULL, FechaEntregaPrb NVARCHAR(50) NULL,
    Titulo NVARCHAR(MAX) NULL, OwnerServicio NVARCHAR(255) NULL,
    Descripcion NVARCHAR(MAX) NULL, Estado NVARCHAR(100) NULL, Subestado NVARCHAR(100) NULL,
    Gerencia NVARCHAR(255) NULL, OwnerProblem NVARCHAR(255) NULL,
    Macroproceso NVARCHAR(255) NULL, Causa NVARCHAR(255) NULL, Proceso NVARCHAR(255) NULL,
    Observaciones NVARCHAR(MAX) NULL, UltimoComentario NVARCHAR(MAX) NULL,
    HistoricoComentarios NVARCHAR(MAX) NULL, RCA NVARCHAR(50) NULL, CuentaConWA NVARCHAR(50) NULL,
    Direccion NVARCHAR(255) NULL, VolumetriaOriginal NVARCHAR(50) NULL,
    VolumenUltimoMes NVARCHAR(50) NULL, Impacto NVARCHAR(100) NULL, Prioridad NVARCHAR(100) NULL,
    FechaEntregaAnalisis NVARCHAR(50) NULL, FechaAnalisis NVARCHAR(50) NULL,
    NroCambioFechaAnalisis NVARCHAR(50) NULL, FechaOriginalSolucion NVARCHAR(50) NULL,
    FechaSolucion NVARCHAR(50) NULL, NroCambioFechaSolucion NVARCHAR(50) NULL,
    FechaOriginalCierre NVARCHAR(50) NULL, FechaCierre NVARCHAR(50) NULL,
    NroCambioFechaCierre NVARCHAR(50) NULL, Categoria NVARCHAR(1000) NULL,
    LoteCarga UNIQUEIDENTIFIER NULL,
    FechaCargaStg DATETIME2(0) NOT NULL CONSTRAINT DF_stgPrb_F DEFAULT (SYSDATETIME())
);
GO

IF OBJECT_ID('stg.Iniciativas') IS NOT NULL DROP TABLE stg.Iniciativas;
GO
CREATE TABLE stg.Iniciativas
(
    Codigo NVARCHAR(100) NULL, Categoria NVARCHAR(1000) NULL,
    TipoTicket NVARCHAR(100) NULL, TipoIniciativa NVARCHAR(100) NULL,
    TipoAgrupado NVARCHAR(100) NULL, TituloIniciativa NVARCHAR(MAX) NULL,
    PctDisminucion NVARCHAR(50) NULL, MesReduccion NVARCHAR(50) NULL,
    TicketsReduce NVARCHAR(50) NULL, DiasMesCerrado NVARCHAR(50) NULL,
    CategoriaInactiva NVARCHAR(50) NULL, EstadoProblem NVARCHAR(100) NULL,
    CierreProblem NVARCHAR(50) NULL, MejorFecha NVARCHAR(50) NULL,
    LoteCarga UNIQUEIDENTIFIER NULL,
    FechaCargaStg DATETIME2(0) NOT NULL CONSTRAINT DF_stgIni_F DEFAULT (SYSDATETIME())
);
GO

IF OBJECT_ID('stg.CatPersona') IS NOT NULL DROP TABLE stg.CatPersona;
GO
CREATE TABLE stg.CatPersona
(
    Nombre NVARCHAR(255) NULL, Correo NVARCHAR(255) NULL, Rol NVARCHAR(100) NULL,
    ProductOwner NVARCHAR(255) NULL, Manager NVARCHAR(255) NULL, Director NVARCHAR(255) NULL,
    LoteCarga UNIQUEIDENTIFIER NULL,
    FechaCargaStg DATETIME2(0) NOT NULL CONSTRAINT DF_stgPer_F DEFAULT (SYSDATETIME())
);
GO

IF OBJECT_ID('stg.CatCategoriaDueno') IS NOT NULL DROP TABLE stg.CatCategoriaDueno;
GO
CREATE TABLE stg.CatCategoriaDueno
(
    CategoriaN2 NVARCHAR(500) NULL, ProductOwner NVARCHAR(255) NULL,
    ServiceOwner NVARCHAR(255) NULL, DirectorPO NVARCHAR(255) NULL, C1 NVARCHAR(255) NULL,
    LoteCarga UNIQUEIDENTIFIER NULL,
    FechaCargaStg DATETIME2(0) NOT NULL CONSTRAINT DF_stgCD_F DEFAULT (SYSDATETIME())
);
GO
IF OBJECT_ID('dbo.CatPersona', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CatPersona
    (
        Nombre             NVARCHAR(255) NOT NULL,
        Correo             NVARCHAR(255) NULL,
        Rol                NVARCHAR(100) NULL,
        ProductOwner       NVARCHAR(255) NULL,
        Manager            NVARCHAR(255) NULL,
        Director           NVARCHAR(255) NULL,
        VigenteEnOrigen    BIT NOT NULL CONSTRAINT DF_Per_Vig   DEFAULT (1),
        FechaUltimaCargaDW DATETIME2(0) NOT NULL CONSTRAINT DF_Per_Carga DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_CatPersona PRIMARY KEY CLUSTERED (Nombre)
    );
END;
GO

IF OBJECT_ID('dbo.CatCategoriaDueno', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CatCategoriaDueno
    (
        CategoriaN2        NVARCHAR(450) NOT NULL,
        ProductOwner       NVARCHAR(255) NULL,
        ServiceOwner       NVARCHAR(255) NULL,
        DirectorPO         NVARCHAR(255) NULL,
        C1                 NVARCHAR(255) NULL,
        VigenteEnOrigen    BIT NOT NULL CONSTRAINT DF_CatD_Vig   DEFAULT (1),
        FechaUltimaCargaDW DATETIME2(0) NOT NULL CONSTRAINT DF_CatD_Carga DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_CatCategoriaDueno PRIMARY KEY CLUSTERED (CategoriaN2)
    );
END;
GO

GO
CREATE OR ALTER FUNCTION dbo.fn_ExpFecha (@v NVARCHAR(50))
RETURNS DATETIME2(0)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(50) = LTRIM(RTRIM(ISNULL(@v, N'')));
    IF @s IN (N'', N'-', N'NA', N'N/A', N'#N/A', N'0') RETURN NULL;

    DECLARE @d DATETIME2(0) = TRY_CONVERT(DATETIME2(0), @s, 126);
    IF @d IS NOT NULL RETURN @d;
    SET @d = TRY_CONVERT(DATETIME2(0), @s, 103);   -- dd/mm/aaaa
    IF @d IS NOT NULL RETURN @d;
    SET @d = TRY_CONVERT(DATETIME2(0), @s);
    IF @d IS NOT NULL RETURN @d;

    -- Serial de Excel: dias desde 1899-12-30
    DECLARE @n FLOAT = TRY_CONVERT(FLOAT, @s);
    IF @n IS NOT NULL AND @n > 20000 AND @n < 80000
        RETURN CONVERT(DATETIME2(0), DATEADD(SECOND, CONVERT(INT, (@n - FLOOR(@n)) * 86400),
                                             DATEADD(DAY, CONVERT(INT, FLOOR(@n)), '1899-12-30')));
    RETURN NULL;
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_ExpEntero (@v NVARCHAR(50))
RETURNS INT
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(50) = REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(@v, N''))), N',', N''), N' ', N'');
    IF @s IN (N'', N'-', N'NA', N'N/A', N'#N/A') RETURN NULL;
    RETURN TRY_CONVERT(INT, TRY_CONVERT(DECIMAL(18,4), @s));
END;
GO

CREATE OR ALTER FUNCTION dbo.fn_ExpSiNo (@v NVARCHAR(50))
RETURNS BIT
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@v, N''))));
    IF @s IN (N'SI', N'SÍ', N'S', N'YES', N'Y', N'1', N'TRUE', N'VERDADERO') RETURN 1;
    IF @s IN (N'NO', N'N', N'0', N'FALSE', N'FALSO') RETURN 0;
    RETURN NULL;
END;
GO
GO

CREATE FUNCTION dbo.fn_CategoriaC1 (@Ruta nvarchar(1000))
RETURNS nvarchar(255)
AS
BEGIN
    -- STUB: '/A/B/C' -> 'A'
    DECLARE @s nvarchar(1000) = LTRIM(RTRIM(@Ruta));
    IF LEFT(@s, 1) = N'/' SET @s = SUBSTRING(@s, 2, 1000);
    RETURN CASE WHEN CHARINDEX(N'/', @s) > 0 THEN LEFT(@s, CHARINDEX(N'/', @s) - 1) ELSE @s END;
END;
GO
CREATE FUNCTION dbo.fn_CategoriaC1C2 (@Ruta nvarchar(1000))
RETURNS nvarchar(500)
AS
BEGIN
    -- STUB: '/A/B/C' -> 'A/B'
    DECLARE @s nvarchar(1000) = LTRIM(RTRIM(@Ruta));
    IF LEFT(@s, 1) = N'/' SET @s = SUBSTRING(@s, 2, 1000);
    DECLARE @i int = CHARINDEX(N'/', @s);
    IF @i = 0 RETURN @s;
    DECLARE @j int = CHARINDEX(N'/', @s, @i + 1);
    RETURN CASE WHEN @j > 0 THEN LEFT(@s, @j - 1) ELSE @s END;
END;
GO
CREATE FUNCTION dbo.fn_ClaveNombre (@Nombre nvarchar(400))
RETURNS nvarchar(400)
AS
BEGIN
    -- STUB
    RETURN UPPER(REPLACE(REPLACE(REPLACE(@Nombre COLLATE Latin1_General_CI_AI, N' ', N''), N'á', N'a'), N'é', N'e'));
END;
GO
CREATE VIEW dbo.vw_DuenoPorC1
AS
-- STUB: un dueno por C1.
SELECT C1, ProductOwner = MIN(ProductOwner), ServiceOwner = MIN(ServiceOwner), DirectorPO = MIN(DirectorPO)
FROM dbo.CatCategoriaDueno
WHERE C1 IS NOT NULL
GROUP BY C1;
GO

SET NOEXEC OFF;
GO
