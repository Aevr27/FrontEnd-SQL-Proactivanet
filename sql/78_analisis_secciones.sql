/* =====================================================================================
   78_analisis_secciones.sql

   Las secciones que no le sirven a todos los servicios de la pestaña "Análisis de
   servicios" (dbo.AnalisisServicio.Secciones, ver la cabecera del 47): el analisis
   alrededor del pago (quincena) y la tabla de los CEDIS que nombra el texto.

   Generado con node analisis_servicio/armar_scripts.js desde
   analisis_servicio/servicios.js. Lo que queda prendido:
     S-Biométrico: quincena
     S-Logistica: CEDIS
     S-Gestion de Inventarios: CEDIS
   Los demas servicios quedan en NULL (nada prendido).

   Solo cambia la columna Secciones: no sube ReglasVersion ni toca criterios ni
   reglas. Se puede volver a correr. Necesita el 47 del 2026-10-21 o despues (la
   columna); sin el, avisa y no cambia nada. Lleva acentos en los nombres de los
   CEDIS: abrirlo como archivo en SSMS (trae BOM).
   ===================================================================================== */

USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
SET NOEXEC OFF;
IF COL_LENGTH('dbo.AnalisisServicio', 'Secciones') IS NULL
BEGIN
    RAISERROR(N'Falta correr 47_analisis_servicios.sql del 2026-10-21 o despues: dbo.AnalisisServicio no tiene la columna Secciones. No se cambio nada.', 16, 1);
    SET NOEXEC ON;
END;
GO

UPDATE s SET Secciones = v.Secciones
FROM dbo.AnalisisServicio AS s
JOIN (VALUES
    ('biometrico', N'{"quincena":true}'),
    ('punto_de_venta', NULL),
    ('acceso_aplicaciones', NULL),
    ('caja_general', NULL),
    ('equipo_de_computo', NULL),
    ('logistica', N'{"cedis":{"5521":"Villahermosa frescos","5525":"Tijuana frescos","5531":"Cuautitlán frescos","5532":"Hermosillo frescos","5537":"Querétaro secos","5548":"Tultitlán secos","5549":"Salinas Victoria secos","5556":"Tijuana secos","5557":"Guadalajara secos","5558":"Guadalajara frescos","5645":"Salinas Victoria secos","5647":"Tultitlán secos","5648":"Guadalajara","5681":"Villahermosa secos","5687":"Salinas Victoria frescos"}}'),
    ('fenicia', NULL),
    ('gestion_de_inventarios', N'{"cedis":{"5521":"Villahermosa frescos","5525":"Tijuana frescos","5531":"Cuautitlán frescos","5532":"Hermosillo frescos","5537":"Querétaro secos","5548":"Tultitlán secos","5549":"Salinas Victoria secos","5556":"Tijuana secos","5557":"Guadalajara secos","5558":"Guadalajara frescos","5645":"Salinas Victoria secos","5647":"Tultitlán secos","5648":"Guadalajara","5681":"Villahermosa secos","5687":"Salinas Victoria frescos"}}'),
    ('basculas', NULL),
    ('autocobro', NULL),
    ('servicios_ti', NULL),
    ('mesa_de_control', NULL),
    ('powerbi', NULL),
    ('usuarios_de_red', NULL),
    ('comunicaciones', NULL),
    ('facturacion', NULL),
    ('abasto', NULL),
    ('conciliaciones', NULL)
) AS v (Servicio, Secciones) ON v.Servicio = s.Servicio
WHERE ISNULL(s.Secciones, N'') <> ISNULL(v.Secciones, N'');
PRINT CONCAT(N'Servicios con las secciones cambiadas: ', @@ROWCOUNT);
GO
SET NOEXEC OFF;
GO

SELECT s.Servicio, s.Nombre, Secciones = ISNULL(s.Secciones, N'(nada prendido)')
FROM dbo.AnalisisServicio AS s
ORDER BY s.Servicio;
GO
