/* =========================================================================
   sql/diag_82_pareto_por_servicio_verificar.sql

   Se corre DESPUES de aplicar 82_pareto_por_servicio.sql, en SSMS (un solo
   lote, F5, Results to Grid). Compara, para los slots 0..12, lo que
   devuelve el procedimiento nuevo contra un recuento directo de
   dbo.vw_ServicioTickets por Servicio.

   ES DE SOLO LECTURA: ejecuta SOLO dbo.usp_CorreoServicio_Pareto (SELECT
   puro) y escribe solo en variables de tabla de esta conexion. Sin DDL, sin
   SQL dinamico, sin permisos.

   Todo bien = la grilla V1 con Diferencias = 0 y AcumuladoFinal = 100.00
   (o NULL en un slot sin tickets) en los 13 slots, V2 vacia y
   TicketsEnVariosServicios = 0.
   ========================================================================= */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

DECLARE @P TABLE (Slot INT, Posicion BIGINT, Servicio NVARCHAR(100), CantidadTickets INT, TotalTickets INT,
                  Porcentaje DECIMAL(6,2), PorcentajeAcumulado DECIMAL(6,2), NombreServicio NVARCHAR(255));
DECLARE @X TABLE (Posicion BIGINT, Servicio NVARCHAR(100), CantidadTickets INT, TotalTickets INT,
                  Porcentaje DECIMAL(6,2), PorcentajeAcumulado DECIMAL(6,2), NombreServicio NVARCHAR(255));
DECLARE @V TABLE (Slot INT, Servicio NVARCHAR(100), CodigoTicket NVARCHAR(100));
DECLARE @s INT = 0;

-- Si el procedimiento todavia es el de seis columnas, el INSERT de abajo
-- falla con "Column name or number of supplied values does not match": 82
-- no esta aplicado.
SELECT Seccion = 'V0 Procedimiento', Modificado = CONVERT(VARCHAR(19), modify_date, 120),
       Columnas = (SELECT COUNT(*) FROM sys.dm_exec_describe_first_result_set_for_object(object_id, 0))
FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.usp_CorreoServicio_Pareto');

WHILE @s <= 12
BEGIN
    DELETE @X;
    INSERT @X EXEC dbo.usp_CorreoServicio_Pareto @Slot = @s;
    INSERT @P SELECT @s, * FROM @X;
    SET @s = @s + 1;
END;

INSERT @V
SELECT Slot, LTRIM(RTRIM(Servicio)), CodigoTicket
FROM dbo.vw_ServicioTickets
WHERE Slot BETWEEN 0 AND 12 AND NULLIF(LTRIM(RTRIM(Servicio)), N'') IS NOT NULL;

;WITH Directo AS (
    SELECT Slot, Servicio, n = COUNT(DISTINCT CodigoTicket) FROM @V GROUP BY Slot, Servicio
)
SELECT Seccion = 'V1 Por slot', s.Slot,
       Servicios     = (SELECT COUNT(*) FROM @P p WHERE p.Slot = s.Slot),
       TotalTickets  = (SELECT MAX(TotalTickets) FROM @P p WHERE p.Slot = s.Slot),
       TicketsDistintos = (SELECT COUNT(DISTINCT CodigoTicket) FROM @V v WHERE v.Slot = s.Slot),
       -- Servicio que falta de un lado, o con otra cantidad.
       Diferencias   = (SELECT COUNT(*)
                        FROM (SELECT Servicio, n FROM Directo WHERE Slot = s.Slot) d
                        FULL JOIN (SELECT Servicio, CantidadTickets FROM @P WHERE Slot = s.Slot) p
                               ON p.Servicio = d.Servicio
                        WHERE p.Servicio IS NULL OR d.Servicio IS NULL OR p.CantidadTickets <> d.n),
       AcumuladoFinal = (SELECT MAX(PorcentajeAcumulado) FROM @P p WHERE p.Slot = s.Slot),
       TicketsEnVariosServicios = (SELECT COUNT(*) FROM (SELECT CodigoTicket FROM @V v WHERE v.Slot = s.Slot
                                   GROUP BY CodigoTicket HAVING COUNT(DISTINCT Servicio) > 1) x)
FROM (SELECT DISTINCT Slot = n FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) t(n)) s
ORDER BY s.Slot
OPTION (RECOMPILE);

-- V2: servicios sin nombre en el catalogo (NombreServicio cayo al codigo)
SELECT Seccion = 'V2 Sin nombre', p.Slot, p.Servicio, p.NombreServicio
FROM @P p WHERE p.NombreServicio = p.Servicio;

-- V3: el slot 0 como lo vera la pestaña (debe cuadrar con D8 del diag 2)
SELECT Seccion = 'V3 Slot 0', Posicion, Servicio, NombreServicio, CantidadTickets, TotalTickets,
       Porcentaje, PorcentajeAcumulado
FROM @P WHERE Slot = 0 ORDER BY Posicion;
