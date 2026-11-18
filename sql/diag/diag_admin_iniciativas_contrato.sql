/* =====================================================================================
   diag_admin_iniciativas_contrato.sql

   SOLO LECTURA. Ningun INSERT / UPDATE / DELETE / DDL.

   Antes de disenar el flujo de Admin para crear iniciativas hay que confirmar
   contra los datos reales lo que 13_experiencia_usuario.sql y
   cargar_experiencia.py NO dicen:

     A  mapeo tipo de iniciativa -> prefijo (y -> agrupador del tablero)
     B  regla del consecutivo del codigo (por prefijo?, por año?, huecos?)
     C  que campos de dbo.Problem / dbo.ProblemCategoria vienen llenos de verdad
     D  categorias: cuantas por iniciativa, fuera de catalogo, inactivas
     F  permisos de la cuenta con la que se corre esto

   Correrlo en la VM CON LA MISMA CUENTA QUE USA EL SITIO (la de Web.config),
   para que la seccion F diga lo que puede hacer el tablero y no lo que puede
   hacer un administrador.

   Base: Tickets_Proactivanet. SQL Server 2016+.
   ===================================================================================== */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

/* -------------------------------------------------------------------------------------
   A1) Prefijo contra TipoPrb / TipoIniciativa del Problem.
       Si cada prefijo cae en un solo TipoIniciativa, ese es el mapeo; si un
       prefijo reparte en varios, el mapeo NO es 1:1 y hay que preguntarlo.
   ------------------------------------------------------------------------------------- */
SELECT A1 = 'Prefijo x TipoPrb x TipoIniciativa',
       p.Prefijo, p.TipoPrb, p.TipoIniciativa,
       Total = COUNT(*),
       Vigentes = SUM(CASE WHEN p.VigenteEnOrigen = 1 THEN 1 ELSE 0 END)
FROM dbo.Problem AS p
GROUP BY p.Prefijo, p.TipoPrb, p.TipoIniciativa
ORDER BY p.Prefijo, Total DESC;

/* A2) Prefijo contra TipoAgrupado / TipoIniciativa del detalle. El tablero
       solo pinta los agrupadores Problem, SorIA, Adopcion y Mejora
       (ExperienciaQueries.AGRUPADORES); lo que caiga fuera no se ve. */
SELECT A2 = 'Prefijo x TipoAgrupado (detalle)',
       p.Prefijo, pc.TipoIniciativa, pc.TipoAgrupado, pc.TipoTicket,
       Filas = COUNT(*)
FROM dbo.ProblemCategoria AS pc
JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
GROUP BY p.Prefijo, pc.TipoIniciativa, pc.TipoAgrupado, pc.TipoTicket
ORDER BY p.Prefijo, Filas DESC;

/* A3) El catalogo de prefijos tal como esta hoy (ControlDeFecha y lo que
       traiga ademas). */
IF OBJECT_ID('dbo.CatPrefijoProblem') IS NOT NULL
    SELECT A3 = 'CatPrefijoProblem', * FROM dbo.CatPrefijoProblem ORDER BY 2;
ELSE
    SELECT A3 = 'CatPrefijoProblem NO EXISTE';

/* Columnas de CatPrefijoProblem: si ya trae descripcion/tipo, es el lugar
   natural del mapeo tipo -> prefijo. */
SELECT A3b = 'Columnas CatPrefijoProblem', c.name, t.name AS tipo, c.max_length, c.is_nullable
FROM sys.columns AS c JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.CatPrefijoProblem')
ORDER BY c.column_id;

/* -------------------------------------------------------------------------------------
   B) Consecutivo. Formato esperado 'XXX YYYY-NNNNNN'. Se parte el codigo y se
      mira: formato, huecos, repetidos, si el numero es por prefijo o
      compartido entre prefijos, si reinicia cada año y si el año del codigo
      es el de FechaCreacion.

      Se usan TODAS las filas (vigentes o no): un numero de una fila que ya no
      viene en el Excel igual ya se uso.
   ------------------------------------------------------------------------------------- */
IF OBJECT_ID('tempdb..#Cod') IS NOT NULL DROP TABLE #Cod;
SELECT
    p.Codigo,
    p.Prefijo,
    p.FechaCreacion,
    p.VigenteEnOrigen,
    FormatoOk = CASE WHEN p.Codigo LIKE
        '[A-Z0-9][A-Z0-9][A-Z0-9] [0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'
        AND LEN(p.Codigo) = 15 THEN 1 ELSE 0 END,
    Anio   = TRY_CONVERT(INT, SUBSTRING(p.Codigo, 5, 4)),
    Numero = TRY_CONVERT(INT, SUBSTRING(p.Codigo, CHARINDEX('-', p.Codigo) + 1, 20)),
    Digitos = LEN(SUBSTRING(p.Codigo, CHARINDEX('-', p.Codigo) + 1, 20))
INTO #Cod
FROM dbo.Problem AS p;

-- B1) Codigos fuera de formato (espacios de mas, guion distinto, digitos de menos...)
SELECT B1 = 'Fuera de formato', Codigo, LenCodigo = LEN(Codigo), Anio, Numero, Digitos
FROM #Cod WHERE FormatoOk = 0 ORDER BY Codigo;

-- B2) Por prefijo y año: cuantos, rango, huecos y repetidos de numero
SELECT B2 = 'Prefijo x Anio',
       Prefijo, Anio,
       Codigos = COUNT(*),
       NumMin = MIN(Numero), NumMax = MAX(Numero),
       Huecos = MAX(Numero) - MIN(Numero) + 1 - COUNT(DISTINCT Numero),
       NumerosRepetidos = COUNT(*) - COUNT(DISTINCT Numero)
FROM #Cod WHERE FormatoOk = 1
GROUP BY Prefijo, Anio
ORDER BY Prefijo, Anio;

-- B3) Por año, sin prefijo. Si el consecutivo fuera UNO SOLO compartido por
--     los nueve prefijos, aqui no habria numeros repetidos y los rangos por
--     prefijo de B2 se intercalarian. Si hay muchos repetidos, es por prefijo.
SELECT B3 = 'Anio (todos los prefijos)',
       Anio,
       Codigos = COUNT(*),
       NumerosDistintos = COUNT(DISTINCT Numero),
       NumeroEnVariosPrefijos = COUNT(*) - COUNT(DISTINCT Numero),
       NumMax = MAX(Numero)
FROM #Cod WHERE FormatoOk = 1
GROUP BY Anio ORDER BY Anio;

-- B4) Ejemplos de un mismo numero en dos prefijos del mismo año
SELECT TOP (20) B4 = 'Mismo numero, distinto prefijo',
       a.Anio, a.Numero, PrefijoA = a.Prefijo, PrefijoB = b.Prefijo
FROM #Cod AS a JOIN #Cod AS b
  ON b.Anio = a.Anio AND b.Numero = a.Numero AND b.Prefijo > a.Prefijo
WHERE a.FormatoOk = 1 AND b.FormatoOk = 1
ORDER BY a.Anio DESC, a.Numero DESC;

-- B5) Año del codigo contra año de FechaCreacion. Si no coinciden a menudo,
--     el año del codigo NO es "el año en que se creo".
SELECT B5 = 'Anio codigo vs FechaCreacion',
       Coincide = SUM(CASE WHEN Anio = YEAR(FechaCreacion) THEN 1 ELSE 0 END),
       NoCoincide = SUM(CASE WHEN FechaCreacion IS NOT NULL AND Anio <> YEAR(FechaCreacion) THEN 1 ELSE 0 END),
       SinFecha = SUM(CASE WHEN FechaCreacion IS NULL THEN 1 ELSE 0 END)
FROM #Cod WHERE FormatoOk = 1;

SELECT TOP (20) B5b = 'Ejemplos no coincide', Codigo, FechaCreacion
FROM #Cod
WHERE FormatoOk = 1 AND FechaCreacion IS NOT NULL AND Anio <> YEAR(FechaCreacion)
ORDER BY FechaCreacion DESC;

-- B6) Primer numero de cada prefijo en cada año: ~1 = reinicia cada año
SELECT B6 = 'Reinicio anual', Prefijo, Anio, PrimerNumero = MIN(Numero)
FROM #Cod WHERE FormatoOk = 1
GROUP BY Prefijo, Anio ORDER BY Prefijo, Anio;

-- B7) Orden de captura: dentro de un prefijo/año, el numero crece con la
--     FechaCreacion? Cuenta pares consecutivos donde el numero sube pero la
--     fecha baja (captura fuera de orden o renumeracion a mano).
;WITH O AS (
    SELECT Prefijo, Anio, Numero, FechaCreacion,
           FechaSig = LEAD(FechaCreacion) OVER (PARTITION BY Prefijo, Anio ORDER BY Numero)
    FROM #Cod WHERE FormatoOk = 1 AND FechaCreacion IS NOT NULL
)
SELECT B7 = 'Numero sube, fecha baja', Prefijo, Anio,
       Inversiones = SUM(CASE WHEN FechaSig < FechaCreacion THEN 1 ELSE 0 END),
       Pares = COUNT(FechaSig)
FROM O GROUP BY Prefijo, Anio ORDER BY Prefijo, Anio;

/* -------------------------------------------------------------------------------------
   C) Que tan llenos vienen los campos, solo iniciativas vigentes. Un campo que
      el Excel casi nunca llena no deberia ser obligatorio en Admin; uno que
      el tablero lee (Estado, TipoIniciativa, fechas, FechaCreacion) si.
   ------------------------------------------------------------------------------------- */
SELECT C1 = 'Problem vigentes: % lleno',
       Total = COUNT(*),
       TipoPrb = AVG(CASE WHEN TipoPrb IS NOT NULL THEN 100.0 ELSE 0 END),
       TipoIniciativa = AVG(CASE WHEN TipoIniciativa IS NOT NULL THEN 100.0 ELSE 0 END),
       Titulo = AVG(CASE WHEN Titulo IS NOT NULL THEN 100.0 ELSE 0 END),
       Descripcion = AVG(CASE WHEN Descripcion IS NOT NULL THEN 100.0 ELSE 0 END),
       Estado = AVG(CASE WHEN Estado IS NOT NULL THEN 100.0 ELSE 0 END),
       Subestado = AVG(CASE WHEN Subestado IS NOT NULL THEN 100.0 ELSE 0 END),
       Categoria = AVG(CASE WHEN Categoria IS NOT NULL THEN 100.0 ELSE 0 END),
       OwnerServicio = AVG(CASE WHEN OwnerServicio IS NOT NULL THEN 100.0 ELSE 0 END),
       OwnerProblem = AVG(CASE WHEN OwnerProblem IS NOT NULL THEN 100.0 ELSE 0 END),
       Gerencia = AVG(CASE WHEN Gerencia IS NOT NULL THEN 100.0 ELSE 0 END),
       Direccion = AVG(CASE WHEN Direccion IS NOT NULL THEN 100.0 ELSE 0 END),
       Impacto = AVG(CASE WHEN Impacto IS NOT NULL THEN 100.0 ELSE 0 END),
       Prioridad = AVG(CASE WHEN Prioridad IS NOT NULL THEN 100.0 ELSE 0 END),
       FechaCreacion = AVG(CASE WHEN FechaCreacion IS NOT NULL THEN 100.0 ELSE 0 END),
       FechaAnalisis = AVG(CASE WHEN FechaAnalisis IS NOT NULL THEN 100.0 ELSE 0 END),
       FechaSolucion = AVG(CASE WHEN FechaSolucion IS NOT NULL THEN 100.0 ELSE 0 END),
       FechaOriginalCierre = AVG(CASE WHEN FechaOriginalCierre IS NOT NULL THEN 100.0 ELSE 0 END),
       FechaCierre = AVG(CASE WHEN FechaCierre IS NOT NULL THEN 100.0 ELSE 0 END),
       VolumetriaOriginal = AVG(CASE WHEN VolumetriaOriginal IS NOT NULL THEN 100.0 ELSE 0 END)
FROM dbo.Problem WHERE VigenteEnOrigen = 1;

-- C2) Valores de Estado / Subestado: el tablero considera activas solo
--     'En Análisis', 'En Solución', 'En Monitoreo'.
SELECT C2 = 'Estado x Subestado', Estado, Subestado, Total = COUNT(*)
FROM dbo.Problem WHERE VigenteEnOrigen = 1
GROUP BY Estado, Subestado ORDER BY Estado, Total DESC;

-- C3) Detalle: TicketsReduce es lo que el tablero usa como compromiso de
--     reduccion. Ver si siempre viene con PctDisminucion (o si uno se deriva
--     del otro) antes de decidir cual captura Admin.
SELECT C3 = 'ProblemCategoria vigentes',
       Total = COUNT(*),
       ConPct = SUM(CASE WHEN PctDisminucion IS NOT NULL THEN 1 ELSE 0 END),
       ConTicketsReduce = SUM(CASE WHEN TicketsReduce IS NOT NULL THEN 1 ELSE 0 END),
       ConAmbos = SUM(CASE WHEN PctDisminucion IS NOT NULL AND TicketsReduce IS NOT NULL THEN 1 ELSE 0 END),
       ConTipoAgrupado = SUM(CASE WHEN TipoAgrupado IS NOT NULL THEN 1 ELSE 0 END),
       ConTituloIniciativa = SUM(CASE WHEN TituloIniciativa IS NOT NULL THEN 1 ELSE 0 END),
       ConMesReduccion = SUM(CASE WHEN MesReduccion IS NOT NULL THEN 1 ELSE 0 END),
       ConCategoriaInactiva = SUM(CASE WHEN CategoriaInactiva IS NOT NULL THEN 1 ELSE 0 END),
       PctMin = MIN(PctDisminucion), PctMax = MAX(PctDisminucion)
FROM dbo.ProblemCategoria WHERE VigenteEnOrigen = 1;

-- C4) Muestra Pct x volumen de la categoria contra TicketsReduce: si
--     TicketsReduce ~= Pct * VolumenMensual, es una formula del Excel y Admin
--     deberia pedir solo el %.
SELECT TOP (25) C4 = 'Pct vs TicketsReduce',
       pc.Codigo, pc.Categoria, pc.PctDisminucion, pc.TicketsReduce, pc.MesReduccion,
       Vol30 = (SELECT COUNT_BIG(*) FROM dbo.Tickets AS t
                WHERE t.Categoria = pc.Categoria
                  AND t.FechaRegistro >= DATEADD(DAY, -30, DATEADD(HOUR, -6, SYSUTCDATETIME())))
FROM dbo.ProblemCategoria AS pc
WHERE pc.VigenteEnOrigen = 1 AND pc.PctDisminucion IS NOT NULL AND pc.TicketsReduce IS NOT NULL
ORDER BY pc.FechaAltaDW DESC;

/* -------------------------------------------------------------------------------------
   D) Categorias
   ------------------------------------------------------------------------------------- */
-- D1) Cuantas categorias por iniciativa (vigentes)
SELECT D1 = 'Categorias por iniciativa', Categorias = n, Iniciativas = COUNT(*)
FROM (SELECT p.Codigo, n = (SELECT COUNT(*) FROM dbo.ProblemCategoria AS pc
                            WHERE pc.Codigo = p.Codigo AND pc.VigenteEnOrigen = 1)
      FROM dbo.Problem AS p WHERE p.VigenteEnOrigen = 1) AS q
GROUP BY n ORDER BY n;

-- D2) Detalle vigente cuya ruta no esta en dbo.Categorias, o esta inactiva
SELECT D2 = 'Detalle vs catalogo',
       Total = COUNT(*),
       FueraDeCatalogo = SUM(CASE WHEN c.RutaCompleta IS NULL THEN 1 ELSE 0 END),
       CatalogoInactiva = SUM(CASE WHEN c.Inactiva = 1 THEN 1 ELSE 0 END),
       MarcadaInactivaEnExcel = SUM(CASE WHEN pc.CategoriaInactiva = 1 THEN 1 ELSE 0 END)
FROM dbo.ProblemCategoria AS pc
LEFT JOIN dbo.Categorias AS c ON c.RutaCompleta = pc.Categoria
WHERE pc.VigenteEnOrigen = 1;

-- D3) Rutas mas largas: la llave de ProblemCategoria es NVARCHAR(450)
SELECT D3 = 'Rutas de catalogo > 450', Rutas = COUNT(*)
FROM dbo.Categorias WHERE LEN(RutaCompleta) > 450;

-- D4) Problem.Categoria (texto de cabecera) contra su detalle: si la
--     cabecera repite una de las rutas del detalle, Admin puede llenarla con
--     la primera; si es otra cosa, se deja como captura libre.
--     SQL Server no admite subconsultas dentro de SUM (Msg 130): la bandera
--     se calcula por fila en la tabla derivada y se suma afuera.
SELECT D4 = 'Problem.Categoria vs detalle',
       ConCabecera = SUM(f.ConCabecera),
       CabeceraEnDetalle = SUM(f.CabeceraEnDetalle)
FROM (
    SELECT ConCabecera = CASE WHEN p.Categoria IS NOT NULL THEN 1 ELSE 0 END,
           CabeceraEnDetalle = CASE WHEN EXISTS (SELECT 1 FROM dbo.ProblemCategoria AS pc
                                                 WHERE pc.Codigo = p.Codigo AND pc.Categoria = p.Categoria)
                                    THEN 1 ELSE 0 END
    FROM dbo.Problem AS p WHERE p.VigenteEnOrigen = 1
) AS f;

/* -------------------------------------------------------------------------------------
   F) Permisos de ESTA cuenta (correr con la del sitio)
   ------------------------------------------------------------------------------------- */
SELECT F1 = 'Cuenta', Login = SUSER_SNAME(), Usuario = USER_NAME();

SELECT F2 = 'Roles de base', r.name
FROM sys.database_role_members AS m
JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
WHERE m.member_principal_id = DATABASE_PRINCIPAL_ID();

SELECT F3 = 'Permisos efectivos',
       SelectProblem  = HAS_PERMS_BY_NAME('dbo.Problem', 'OBJECT', 'SELECT'),
       InsertProblem  = HAS_PERMS_BY_NAME('dbo.Problem', 'OBJECT', 'INSERT'),
       UpdateProblem  = HAS_PERMS_BY_NAME('dbo.Problem', 'OBJECT', 'UPDATE'),
       DeleteProblem  = HAS_PERMS_BY_NAME('dbo.Problem', 'OBJECT', 'DELETE'),
       InsertDetalle  = HAS_PERMS_BY_NAME('dbo.ProblemCategoria', 'OBJECT', 'INSERT'),
       ExecEsquemaDbo = HAS_PERMS_BY_NAME('dbo', 'SCHEMA', 'EXECUTE'),
       ExecCargar     = HAS_PERMS_BY_NAME('dbo.usp_CargarExperiencia', 'OBJECT', 'EXECUTE'),
       CrearProc      = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE PROCEDURE'),
       CrearTabla     = HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE');

-- F4) Permisos otorgados directamente a la cuenta (GRANT/DENY explicitos)
SELECT F4 = 'GRANT/DENY directos', dp.state_desc, dp.permission_name,
       Objeto = OBJECT_SCHEMA_NAME(dp.major_id) + '.' + OBJECT_NAME(dp.major_id), dp.class_desc
FROM sys.database_permissions AS dp
WHERE dp.grantee_principal_id = DATABASE_PRINCIPAL_ID()
ORDER BY Objeto, dp.permission_name;

-- F5) Quien mas ejecuta usp_CargarExperiencia (la cuenta del ETL puede no ser la del sitio)
SELECT F5 = 'EXECUTE sobre usp_CargarExperiencia', pr.name, dp.state_desc
FROM sys.database_permissions AS dp
JOIN sys.database_principals AS pr ON pr.principal_id = dp.grantee_principal_id
WHERE dp.major_id = OBJECT_ID('dbo.usp_CargarExperiencia') AND dp.permission_name = 'EXECUTE';

DROP TABLE #Cod;
