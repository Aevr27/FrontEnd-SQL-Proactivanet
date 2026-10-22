/* =====================================================================================
   47_analisis_servicios.sql

   Tablas y procedimientos de la pestaña "Analisis de servicios" del tablero
   (sitio/analisis/). Solo CREA objetos nuevos; no toca nada de lo que ya
   existe. Se puede volver a correr: lo que ya esta no se borra y los
   procedimientos se recrean.

   QUE ES CADA COSA

     dbo.AnalisisServicio           un servicio = una agrupacion a la medida,
                                    con su nombre, sus motivos "de equipo" y
                                    sus secciones (ver abajo)
     dbo.AnalisisServicioCriterio   las claves del bloque de PARAMETROS del 45:
                                    Ruta, RutaFuera, Grupo, Titulo
     dbo.AnalisisRegla              las reglas de motivo, en orden: gana la
                                    primera que cumple
     dbo.usp_Analisis_Servicios     la lista para el selector de la pestaña
     dbo.usp_Analisis_Datos         los tickets de un servicio en un periodo:
                                    los mismos bloques que el 45, con los
                                    textos completos en una sola parte

   LAS REGLAS NO SE ESCRIBEN A MANO AQUI

   Cada servicio se carga con su propio script (48_analisis_s_biometrico.sql
   es el primero). Ese script lo arma el boton "Generar script" de la
   pestaña, o node desde analisis_servicio/servicios.js; los dos usan la
   misma funcion (Motor.scriptServicio), asi que el formato es uno solo. El
   tablero NO escribe en la base: el script lo corre el dueno en SSMS.

   LAS SECCIONES DE CADA SERVICIO (desde el 2026-10-21)

   Lo que no le sirve a todos los servicios se prende por servicio en
   dbo.AnalisisServicio.Secciones, un objeto JSON (NULL = nada prendido):
     "quincena"  true: el analisis alrededor del pago (dia 15 y ultimo del
                 mes). Salio de S-Biometrico (las checadas y la nomina); a
                 Punto de Venta no le sirve.
     "cedis"     {"5549": "Salinas Victoria secos", ...}: la tabla de los
                 CEDIS que nombra el texto (S-Logistica, S-Gestion de
                 Inventarios).
   Los valores los pone 78_analisis_secciones.sql (lo arma armar_scripts.js
   desde servicios.js), y tambien el script de cada servicio. En una base
   que ya tenia el 47, volver a correrlo agrega la columna sin tocar nada
   mas.

   LO QUE NO CUENTA

   La misma regla que el 45 v3: los tickets del grupo SorIA (el bot), los
   de la rama /Soria/ sin grupo y sin firma (el bot los abrio y los rechazo
   sin pasarlos a nadie; desde el 2026-10-10) y los que firmo una cuenta de
   dbo.CatCuentaNoPersona (Habilitado = 1) no son trabajo del servicio. Se
   cuentan en el bloque 0 (ExcluidosBot, ExcluidosCuenta) y no salen en
   ningun otro, tampoco en "Fuera de ruta". Para volver a contar una cuenta
   basta con Habilitado = 0 en el catalogo. Sin dbo.CatCuentaNoPersona
   (04_dashboard_sla.sql, 16_catalogos_tecnicos.sql) este script avisa y no
   crea nada.

   Soria, S-Mesa de Servicios al Personal y S-Datos-Maestros no se dan de
   alta como servicios (decision del dueno, 2026-10-06). Lo que de la rama
   Soria atiende un tecnico si entra, en el servicio de cada subrama
   (/Soria/Punto de Venta/ en S-Punto de Venta, /Soria/Usuarios RED/ en
   Usuarios de Red...; 2026-10-10): lo pone la Ruta de cada servicio.

   LA HORA

   El unico reloj es "Extraido" en el primer bloque de usp_Analisis_Datos:
   la hora de Mexico de la consulta, que la pestaña usa como corte para
   decir si un ticket abierto ya vencio. Las fechas salen tal cual, en hora
   de Mexico.

   PERMISOS

   El tablero llama a los dos procedimientos con su usuario de SQL. Si ese
   usuario no tiene EXECUTE sobre todo el esquema dbo, hay que darselo a
   estos dos (ver el bloque 4, comentado). Con EXECUTE basta: los
   procedimientos son de dbo, igual que las tablas que leen.
   ===================================================================================== */

USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
SET NOEXEC OFF;
GO
IF OBJECT_ID('dbo.CatCuentaNoPersona', 'U') IS NULL
BEGIN
    RAISERROR(N'47_analisis_servicios: falta dbo.CatCuentaNoPersona (la crea 16_catalogos_tecnicos.sql). No se creo nada.', 16, 1);
    SET NOEXEC ON;      -- los bloques de abajo ya no corren; el ultimo lo apaga
END;
GO

/* =====================================================================================
   1) Tablas
   ===================================================================================== */
IF OBJECT_ID('dbo.AnalisisServicio') IS NULL
BEGIN
    CREATE TABLE dbo.AnalisisServicio
    (
        Servicio           VARCHAR(40)    NOT NULL CONSTRAINT PK_AnalisisServicio PRIMARY KEY,
        Nombre             NVARCHAR(100)  NOT NULL,
        Descripcion        NVARCHAR(400)  NULL,
        DesdeSugerido      DATE           NULL,
        MotivosEquipo      NVARCHAR(MAX)  NULL,      -- lista JSON de motivos "de equipo"
        ReglasVersion      INT            NOT NULL CONSTRAINT DF_AnalisisServicio_Version DEFAULT (1),
        Activo             BIT            NOT NULL CONSTRAINT DF_AnalisisServicio_Activo DEFAULT (1),
        FechaAltaDW        DATETIME2(0)   NOT NULL CONSTRAINT DF_AnalisisServicio_Alta DEFAULT (SYSDATETIME()),
        FechaUltimaCargaDW DATETIME2(0)   NOT NULL CONSTRAINT DF_AnalisisServicio_Carga DEFAULT (SYSDATETIME()),
        Secciones          NVARCHAR(MAX)  NULL,      -- objeto JSON: quincena, cedis (ver la cabecera)
        CONSTRAINT CK_AnalisisServicio_Clave CHECK (Servicio NOT LIKE '%[^a-z0-9_-]%' AND Servicio <> '')
    );
END;
-- Una base con el 47 de antes del 2026-10-21 no tiene la columna.
IF COL_LENGTH('dbo.AnalisisServicio', 'Secciones') IS NULL
    ALTER TABLE dbo.AnalisisServicio ADD Secciones NVARCHAR(MAX) NULL;

IF OBJECT_ID('dbo.AnalisisServicioCriterio') IS NULL
BEGIN
    CREATE TABLE dbo.AnalisisServicioCriterio
    (
        Servicio  VARCHAR(40)   NOT NULL CONSTRAINT FK_AnalisisCriterio_Servicio REFERENCES dbo.AnalisisServicio (Servicio),
        Orden     INT           NOT NULL,
        Clave     VARCHAR(20)   NOT NULL CONSTRAINT CK_AnalisisCriterio_Clave CHECK (Clave IN ('Ruta', 'RutaFuera', 'Grupo', 'Titulo')),
        Valor     NVARCHAR(400) NOT NULL CONSTRAINT CK_AnalisisCriterio_Valor CHECK (Valor <> N''),
        CONSTRAINT PK_AnalisisServicioCriterio PRIMARY KEY (Servicio, Orden)
    );
END;

IF OBJECT_ID('dbo.AnalisisRegla') IS NULL
BEGIN
    CREATE TABLE dbo.AnalisisRegla
    (
        Servicio  VARCHAR(40)   NOT NULL CONSTRAINT FK_AnalisisRegla_Servicio REFERENCES dbo.AnalisisServicio (Servicio),
        Orden     INT           NOT NULL,
        Regla     VARCHAR(10)   NOT NULL,
        Motivo    NVARCHAR(200) NOT NULL,
        Campo     VARCHAR(2)    NOT NULL CONSTRAINT CK_AnalisisRegla_Campo CHECK (Campo IN ('D', 'S', 'DS')),
        Frases    NVARCHAR(MAX) NOT NULL,                 -- lista JSON de frases ya normalizadas
        CONSTRAINT PK_AnalisisRegla PRIMARY KEY (Servicio, Orden),
        CONSTRAINT UQ_AnalisisRegla UNIQUE (Servicio, Regla)
    );
END;
GO

/* =====================================================================================
   2) dbo.usp_Analisis_Servicios: la lista del selector
   ===================================================================================== */
CREATE OR ALTER PROCEDURE dbo.usp_Analisis_Servicios
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        s.Servicio,
        s.Nombre,
        s.Descripcion,
        DesdeSugerido = CONVERT(VARCHAR(10), s.DesdeSugerido, 120),
        s.ReglasVersion,
        Reglas    = (SELECT COUNT(*) FROM dbo.AnalisisRegla AS r WHERE r.Servicio = s.Servicio),
        Criterios = (SELECT COUNT(*) FROM dbo.AnalisisServicioCriterio AS c WHERE c.Servicio = s.Servicio),
        Actualizado = CONVERT(VARCHAR(19), s.FechaUltimaCargaDW, 120)
    FROM dbo.AnalisisServicio AS s
    WHERE s.Activo = 1
    ORDER BY s.Nombre;
END;
GO

/* =====================================================================================
   3) dbo.usp_Analisis_Datos: los tickets de un servicio en un periodo

      @Desde incluido, @Hasta EXCLUIDO (NULL = hasta hoy). Como mucho 400
      dias: con los textos, un servicio grande en un año ya pesa decenas de
      megas en el navegador.

      Devuelve, en este orden, los mismos bloques que el 45 (las mismas
      columnas, para que la pestaña los lea con el mismo motor):

        0) Parametros   Version, Extraido, el servicio (con sus motivos de
                        equipo y sus secciones), el periodo, cuantos se
                        dejaron fuera (bot, cuentas) y sus criterios
        R) Reglas       Orden, Regla, Motivo, Campo, Frases (JSON)
        1) Rutas  2) Grupos  3) Fuera de ruta
        4) Tickets      una fila por ticket
        6) Textos       los textos largos, completos, en UNA parte cada uno
        5) Historial
   ===================================================================================== */
CREATE OR ALTER PROCEDURE dbo.usp_Analisis_Datos
    @Servicio VARCHAR(40),
    @Desde    DATE,
    @Hasta    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @HoyMx DATETIME2(0) = DATEADD(HOUR, -6, SYSUTCDATETIME());
    DECLARE @FinEf DATE = ISNULL(@Hasta, DATEADD(DAY, 1, CONVERT(DATE, @HoyMx)));

    IF NOT EXISTS (SELECT 1 FROM dbo.AnalisisServicio WHERE Servicio = @Servicio AND Activo = 1)
    BEGIN
        RAISERROR(N'usp_Analisis_Datos: el servicio "%s" no existe o no esta activo.', 16, 1, @Servicio);
        RETURN;
    END;
    IF @Desde IS NULL OR @FinEf <= @Desde
    BEGIN
        RAISERROR(N'usp_Analisis_Datos: el periodo no es valido (Desde tiene que ser antes de Hasta).', 16, 1);
        RETURN;
    END;
    IF DATEDIFF(DAY, @Desde, @FinEf) > 400
    BEGIN
        RAISERROR(N'usp_Analisis_Datos: el periodo pasa de 400 dias.', 16, 1);
        RETURN;
    END;
    IF NOT EXISTS (SELECT 1 FROM dbo.AnalisisServicioCriterio WHERE Servicio = @Servicio AND Clave IN ('Ruta', 'Grupo'))
    BEGIN
        RAISERROR(N'usp_Analisis_Datos: el servicio "%s" no tiene ni una Ruta ni un Grupo.', 16, 1, @Servicio);
        RETURN;
    END;

    /* Los tickets que entran: la misma regla que el 45, con los criterios
       de la tabla en lugar de #P. Sin acentos ni mayusculas. */
    -- COLLATE DATABASE_DEFAULT: si tempdb tiene otra intercalacion que la base,
    -- el cruce con dbo.Tickets truena por conflicto de intercalacion.
    CREATE TABLE #U (CodigoTicket NVARCHAR(100) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY,
                     Origen VARCHAR(10) COLLATE DATABASE_DEFAULT NOT NULL,
                     Fuera  VARCHAR(10) COLLATE DATABASE_DEFAULT NULL);
    INSERT INTO #U (CodigoTicket, Origen, Fuera)
    SELECT t.CodigoTicket,
           CASE WHEN r.PorRuta = 1 THEN 'Categoria' ELSE 'Grupo' END,
           x.Fuera
    FROM dbo.Tickets AS t
    CROSS APPLY (SELECT PorRuta = CASE
            WHEN EXISTS (SELECT 1 FROM dbo.AnalisisServicioCriterio AS c
                         WHERE c.Servicio = @Servicio AND c.Clave = 'Ruta'
                           AND t.Categoria COLLATE Latin1_General_CI_AI LIKE c.Valor)
             AND NOT EXISTS (SELECT 1 FROM dbo.AnalisisServicioCriterio AS c
                             WHERE c.Servicio = @Servicio AND c.Clave = 'RutaFuera'
                               AND t.Categoria COLLATE Latin1_General_CI_AI LIKE c.Valor)
            THEN 1 ELSE 0 END) AS r
    -- Lo que no cuenta (ver la cabecera): el bot y las cuentas que no son persona.
    CROSS APPLY (SELECT Fuera = CASE
            WHEN LTRIM(RTRIM(t.Grupo)) = N'SorIA' THEN 'Bot'
            WHEN ISNULL(t.Categoria, N'') COLLATE Latin1_General_CI_AI LIKE N'/Soria/%'
             AND NULLIF(LTRIM(RTRIM(t.Grupo)), N'') IS NULL
             AND NULLIF(LTRIM(RTRIM(REPLACE(t.FirmaSolucion, NCHAR(160), N' '))), N'') IS NULL THEN 'Bot'
            WHEN EXISTS (SELECT 1 FROM dbo.CatCuentaNoPersona AS cnp
                         WHERE cnp.Habilitado = 1
                           AND REPLACE(cnp.Cuenta, NCHAR(160), N' ')
                               = LTRIM(RTRIM(REPLACE(t.FirmaSolucion, NCHAR(160), N' '))))
                THEN 'Cuenta'
            END) AS x
    WHERE t.FechaRegistro >= @Desde
      AND t.FechaRegistro < @FinEf
      AND (   r.PorRuta = 1
           OR EXISTS (SELECT 1 FROM dbo.AnalisisServicioCriterio AS c
                      WHERE c.Servicio = @Servicio AND c.Clave = 'Grupo'
                        AND LTRIM(RTRIM(t.Grupo)) COLLATE Latin1_General_CI_AI LIKE c.Valor));
    DECLARE @ExcluidosBot    BIGINT = (SELECT COUNT_BIG(*) FROM #U WHERE Fuera = 'Bot');
    DECLARE @ExcluidosCuenta BIGINT = (SELECT COUNT_BIG(*) FROM #U WHERE Fuera = 'Cuenta');
    DELETE FROM #U WHERE Fuera IS NOT NULL;

    -- 0) Parametros
    SELECT Bloque = '0) Parametros', Clave, Valor
    FROM (
        SELECT Orden = -13, Clave = CONVERT(VARCHAR(20), 'Version'), Valor = CONVERT(NVARCHAR(MAX), N'tablero v1')
        UNION ALL SELECT -12, 'Extraido', CONVERT(NVARCHAR(MAX), CONVERT(VARCHAR(19), @HoyMx, 120))
        UNION ALL SELECT -11, 'Servicio', CONVERT(NVARCHAR(MAX), s.Nombre) FROM dbo.AnalisisServicio AS s WHERE s.Servicio = @Servicio
        UNION ALL SELECT -10, 'ServicioClave', CONVERT(NVARCHAR(MAX), @Servicio)
        UNION ALL SELECT -9, 'Desde', CONVERT(NVARCHAR(MAX), CONVERT(VARCHAR(10), @Desde, 120))
        UNION ALL SELECT -8, 'Hasta', CONVERT(NVARCHAR(MAX), ISNULL(CONVERT(VARCHAR(10), @Hasta, 120), ''))
        UNION ALL SELECT -7, 'ReglasVersion', CONVERT(NVARCHAR(MAX), s.ReglasVersion) FROM dbo.AnalisisServicio AS s WHERE s.Servicio = @Servicio
        UNION ALL SELECT -6, 'MotivosEquipo', ISNULL(s.MotivosEquipo, N'[]') FROM dbo.AnalisisServicio AS s WHERE s.Servicio = @Servicio
        UNION ALL SELECT -5, 'Secciones', ISNULL(s.Secciones, N'{}') FROM dbo.AnalisisServicio AS s WHERE s.Servicio = @Servicio
        UNION ALL SELECT -4, 'TicketsPorRuta', CONVERT(NVARCHAR(MAX), (SELECT COUNT_BIG(*) FROM #U WHERE Origen = 'Categoria'))
        UNION ALL SELECT -3, 'TicketsSoloPorGrupo', CONVERT(NVARCHAR(MAX), (SELECT COUNT_BIG(*) FROM #U WHERE Origen = 'Grupo'))
        UNION ALL SELECT -2, 'ExcluidosBot', CONVERT(NVARCHAR(MAX), @ExcluidosBot)
        UNION ALL SELECT -1, 'ExcluidosCuenta', CONVERT(NVARCHAR(MAX), @ExcluidosCuenta)
        UNION ALL SELECT c.Orden, c.Clave, CONVERT(NVARCHAR(MAX), c.Valor) FROM dbo.AnalisisServicioCriterio AS c WHERE c.Servicio = @Servicio
    ) AS x
    ORDER BY Orden;

    -- R) Reglas
    SELECT r.Orden, r.Regla, r.Motivo, r.Campo, r.Frases
    FROM dbo.AnalisisRegla AS r
    WHERE r.Servicio = @Servicio
    ORDER BY r.Orden;

    -- 1) Rutas
    SELECT
        Bloque         = '1) Rutas',
        u.Origen,
        Categoria      = ISNULL(t.Categoria, N'(sin categoria)'),
        Tickets        = COUNT_BIG(*),
        Incidencias    = SUM(CASE WHEN t.CodigoTicket LIKE N'INC%' THEN 1 ELSE 0 END),
        Peticiones     = SUM(CASE WHEN t.CodigoTicket LIKE N'REQ%' THEN 1 ELSE 0 END),
        SinCerrar      = SUM(CASE WHEN t.FechaFirmaCierre IS NULL THEN 1 ELSE 0 END),
        PrimerRegistro = CONVERT(VARCHAR(19), MIN(t.FechaRegistro), 120),
        UltimoRegistro = CONVERT(VARCHAR(19), MAX(t.FechaRegistro), 120)
    FROM #U AS u
    INNER JOIN dbo.Tickets AS t ON t.CodigoTicket = u.CodigoTicket
    GROUP BY u.Origen, ISNULL(t.Categoria, N'(sin categoria)')
    ORDER BY Tickets DESC;

    -- 2) Grupos
    SELECT
        Bloque       = '2) Grupos',
        Grupo        = ISNULL(NULLIF(LTRIM(RTRIM(t.Grupo)), N''), N'(sin grupo)'),
        Tickets      = COUNT_BIG(*),
        PorRuta      = SUM(CASE WHEN u.Origen = 'Categoria' THEN 1 ELSE 0 END),
        SoloPorGrupo = SUM(CASE WHEN u.Origen = 'Grupo' THEN 1 ELSE 0 END)
    FROM #U AS u
    INNER JOIN dbo.Tickets AS t ON t.CodigoTicket = u.CodigoTicket
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(t.Grupo)), N''), N'(sin grupo)')
    ORDER BY Tickets DESC;

    -- 3) Fuera de ruta: el titulo habla del servicio, pero no entro
    SELECT TOP (40)
        Bloque  = '3) Fuera de ruta',
        RamaC1  = CASE
                      WHEN t.Categoria IS NULL THEN N'(sin categoria)'
                      WHEN CHARINDEX(N'/', t.Categoria, 2) > 2
                          THEN SUBSTRING(t.Categoria, 2, CHARINDEX(N'/', t.Categoria, 2) - 2)
                      ELSE t.Categoria
                  END,
        Grupo   = ISNULL(NULLIF(LTRIM(RTRIM(t.Grupo)), N''), N'(sin grupo)'),
        Tickets = COUNT_BIG(*)
    FROM dbo.Tickets AS t
    WHERE t.FechaRegistro >= @Desde
      AND t.FechaRegistro < @FinEf
      AND EXISTS (SELECT 1 FROM dbo.AnalisisServicioCriterio AS c
                  WHERE c.Servicio = @Servicio AND c.Clave = 'Titulo'
                    AND t.Titulo COLLATE Latin1_General_CI_AI LIKE c.Valor)
      AND NOT EXISTS (SELECT 1 FROM #U AS u WHERE u.CodigoTicket = t.CodigoTicket)
      -- La misma regla que saca a los del bot y a los de cuentas de #U.
      AND ISNULL(LTRIM(RTRIM(t.Grupo)), N'') <> N'SorIA'
      AND NOT (ISNULL(t.Categoria, N'') COLLATE Latin1_General_CI_AI LIKE N'/Soria/%'
               AND NULLIF(LTRIM(RTRIM(t.Grupo)), N'') IS NULL
               AND NULLIF(LTRIM(RTRIM(REPLACE(t.FirmaSolucion, NCHAR(160), N' '))), N'') IS NULL)
      AND NOT EXISTS (SELECT 1 FROM dbo.CatCuentaNoPersona AS cnp
                      WHERE cnp.Habilitado = 1
                        AND REPLACE(cnp.Cuenta, NCHAR(160), N' ')
                            = LTRIM(RTRIM(REPLACE(t.FirmaSolucion, NCHAR(160), N' '))))
    GROUP BY
        CASE
            WHEN t.Categoria IS NULL THEN N'(sin categoria)'
            WHEN CHARINDEX(N'/', t.Categoria, 2) > 2
                THEN SUBSTRING(t.Categoria, 2, CHARINDEX(N'/', t.Categoria, 2) - 2)
            ELSE t.Categoria
        END,
        ISNULL(NULLIF(LTRIM(RTRIM(t.Grupo)), N''), N'(sin grupo)')
    ORDER BY Tickets DESC;

    -- 4) Tickets: las mismas columnas que el bloque 4 del 45
    SELECT
        u.Origen,
        t.CodigoTicket,
        t.Tipo,
        t.Categoria,
        t.Estado,
        t.Subestado,
        t.Prioridad,
        t.SLA,
        Caducada = CONVERT(TINYINT, t.Caducada),
        t.TipoRelacion,
        t.Grupo,
        TecnicoAsignado = t.TecnicoSegundaLinea,
        TecnicoResolvio = t.FirmaSolucion,
        s.TipoSitio,
        SitioNumero = CASE WHEN s.TipoSitio IN ('Tienda', 'City Club', 'CEDIS', 'CAD', 'Otro con numero')
                           THEN TRY_CONVERT(INT, SUBSTRING(t.Tienda, n.Ini,
                                    PATINDEX(N'%[^0-9]%', SUBSTRING(t.Tienda, n.Ini, 20) + N'x') - 1)) END,
        Tienda = CASE WHEN s.TipoSitio IN ('Persona u otro', 'Cuenta') THEN N'(persona o cuenta)'
                      ELSE t.Tienda END,
        TiendaNumero = CASE WHEN t.Tienda LIKE N'[0-9]%'
                            THEN TRY_CONVERT(INT, LEFT(t.Tienda, PATINDEX(N'%[^0-9]%', t.Tienda + N' ') - 1))
                       END,
        t.Sucursal,
        FechaRegistro           = CONVERT(VARCHAR(19), t.FechaRegistro, 120),
        FechaEstimadaResolucion = CONVERT(VARCHAR(19), t.FechaEstimadaResolucion, 120),
        FechaEstimadaOlaUc      = CONVERT(VARCHAR(19), t.FechaEstimadaOlaUc, 120),
        FechaFirmaSolucion      = CONVERT(VARCHAR(19), t.FechaFirmaSolucion, 120),
        FechaFirmaCierre        = CONVERT(VARCHAR(19), t.FechaFirmaCierre, 120),
        FechaUltimaModificacion = CONVERT(VARCHAR(19), t.FechaUltimaModificacion, 120),
        t.IntentosSolucion,
        t.ReasignacionesGrupo,
        t.TiempoPrimeraRespuestaHorasMin,
        t.TiempoAtencionHorasMin,
        t.TiempoResolucion,
        Titulo = LEFT(LTRIM(RTRIM(
            REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(t.Titulo, N''),
                CHAR(13), N' '), CHAR(10), N' '), CHAR(9), N' '), N'"', N''''))), 250),
        QA_Frecuencia = LEFT(LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(ISNULL(t.QA_Frecuencia, N''),
                            CHAR(13), N' '), CHAR(10), N' '), CHAR(9), N' '))), 250),
        QA_Aplicacion = LEFT(LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(ISNULL(t.QA_Aplicacion, N''),
                            CHAR(13), N' '), CHAR(10), N' '), CHAR(9), N' '))), 250),
        t.QARe_TipoSolucion,
        t.QARe_UsuarioConfirmo,
        t.QARe_AplicaOtrosCasos,
        t.QARe_GenerarArticulo,
        t.QARe_VerificoClasificacion
    FROM #U AS u
    INNER JOIN dbo.Tickets AS t ON t.CodigoTicket = u.CodigoTicket
    CROSS APPLY (SELECT TipoSitio = CASE
            WHEN t.Tienda IS NULL OR LTRIM(RTRIM(t.Tienda)) = N'' THEN 'Sin dato'
            WHEN t.Tienda LIKE N'[0-9]%'        THEN 'Tienda'
            WHEN t.Tienda LIKE N'City Club%'    THEN 'City Club'
            WHEN t.Tienda LIKE N'Cedis%'        THEN 'CEDIS'
            WHEN t.Tienda LIKE N'Cad[ 0-9]%'    THEN 'CAD'
            WHEN t.Tienda LIKE N'%[\]%'         THEN 'Cuenta'
            WHEN t.Tienda LIKE N'%[0-9]%'       THEN 'Otro con numero'
            ELSE 'Persona u otro' END) AS s
    CROSS APPLY (SELECT Ini = PATINDEX(N'%[0-9]%', ISNULL(t.Tienda, N''))) AS n
    ORDER BY t.FechaRegistro;

    -- 6) Textos: completos, en una sola parte. Terminan en "|" como en el 45,
    --    para que el mismo lector los junte igual.
    SELECT
        u.CodigoTicket,
        c.Campo,
        Parte = 1,
        Texto = f.Limpio + N'|'
    FROM #U AS u
    INNER JOIN dbo.Tickets AS t ON t.CodigoTicket = u.CodigoTicket
    CROSS APPLY (VALUES
        (N'Titulo',                   t.Titulo,                   500),
        (N'Descripcion',              t.Descripcion,              2000),
        (N'SolucionUsuario',          t.SolucionUsuario,          2000),
        (N'CausaRaizGrupos',          t.CausaRaizGrupos,          500),
        (N'QA_MensajeError',          t.QA_MensajeError,          500),
        (N'QA_PasoAPaso',             t.QA_PasoAPaso,             1000),
        (N'QARe_Causa',               t.QARe_Causa,               500),
        (N'QARe_DescripcionSolucion', t.QARe_DescripcionSolucion, 1000)
    ) AS c (Campo, Crudo, Tope)
    CROSS APPLY (SELECT Limpio = LEFT(LTRIM(RTRIM(
            REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(c.Crudo, N''),
                CHAR(13), N' '), CHAR(10), N' '), CHAR(9), N' '), N'"', N''''))), c.Tope)) AS f
    WHERE f.Limpio <> N''
    ORDER BY u.CodigoTicket, c.Campo;

    -- 5) Historial (versiones anteriores), con la hora de Mexico como en el 45
    SELECT
        h.CodigoTicket,
        h.VersionFila,
        h.Estado,
        h.Subestado,
        h.Grupo,
        h.TecnicoSegundaLinea,
        VigenteDesdeMx = CONVERT(VARCHAR(19), DATEADD(HOUR, -6, h.VigenteDesde), 120),
        VigenteHastaMx = CONVERT(VARCHAR(19), DATEADD(HOUR, -6, h.VigenteHasta), 120)
    FROM dbo.TicketsHist AS h
    INNER JOIN #U AS u ON u.CodigoTicket = h.CodigoTicket
    ORDER BY h.CodigoTicket, h.VersionFila;
END;
GO

/* =====================================================================================
   4) Permisos (solo si hace falta)

      Si el usuario de SQL del tablero no tiene EXECUTE sobre todo dbo,
      quitar los comentarios y poner su nombre (el User ID del Web.config del
      servidor):

      GRANT EXECUTE ON dbo.usp_Analisis_Servicios TO [usuario_del_tablero];
      GRANT EXECUTE ON dbo.usp_Analisis_Datos     TO [usuario_del_tablero];
   ===================================================================================== */

/* =====================================================================================
   5) Que quedo
   ===================================================================================== */
SELECT Objeto = o.name, Tipo = o.type_desc,
       Filas = CASE o.name
                   WHEN 'AnalisisServicio'         THEN (SELECT COUNT(*) FROM dbo.AnalisisServicio)
                   WHEN 'AnalisisServicioCriterio' THEN (SELECT COUNT(*) FROM dbo.AnalisisServicioCriterio)
                   WHEN 'AnalisisRegla'            THEN (SELECT COUNT(*) FROM dbo.AnalisisRegla)
               END
FROM sys.objects AS o
WHERE o.name IN ('AnalisisServicio', 'AnalisisServicioCriterio', 'AnalisisRegla',
                 'usp_Analisis_Servicios', 'usp_Analisis_Datos')
ORDER BY o.type_desc DESC, o.name;
GO

SET NOEXEC OFF;
GO
