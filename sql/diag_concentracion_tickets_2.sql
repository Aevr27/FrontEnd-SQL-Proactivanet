/* =========================================================================
   sql/diag_concentracion_tickets_2.sql - Segunda pasada, pestaña
   "Concentracion de tickets". Version para SSMS (un solo lote, F5).

   OBJETIVO
     A. Que periodo de fechas es cada valor de vw_Tickets.Slot (0..12) y
        como se calcula (definicion de dbo.vw_Tickets).
     B. Permisos: quien tiene EXECUTE sobre los tres procedimientos,
        comparado con los usp_CorreoQARE_*, usp_Analisis_* y usp_Dash_* que
        el tablero ya llama hoy con la cuenta de la web.
     C. Ejecucion real de los tres procedimientos con @Slot = 0 y 12:
        filas, TotalTickets, cruce del 80 %, orden, tiempo.
     D. Pareto por codigo de servicio: prefijos anidados, tickets que caen
        en mas de un servicio o en mas de una rama, y que denominador da
        cada forma de contar. Incluye, como SELECT suelto, la agrupacion
        propuesta por Servicio (NO crea ni cambia el procedimiento).

   ES DE SOLO LECTURA
   - No hay CREATE, ALTER, DROP, UPDATE, DELETE, MERGE, TRUNCATE, GRANT,
     REVOKE, DENY ni SQL dinamico (sp_executesql / EXEC(@cadena)).
   - Los UNICOS INSERT son a VARIABLES DE TABLA (@...) declaradas aqui:
     viven en esta conexion y desaparecen al terminar el lote.
   - Ejecuta SOLO dbo.usp_CorreoServicio_Pareto, _TicketsCategoria y
     _TicketsGrupo, y SOLO si (seccion P) su fecha de modificacion es la
     misma que se verifico en el diagnostico 1 (2026-11-09) y su texto no
     tiene INSERT/UPDATE/DELETE/MERGE/TRUNCATE/DROP/ALTER/GRANT/EXEC. Si
     alguno cambio, la seccion C sale vacia y P dice por que.

   COMO CORRERLO (SSMS)
     1. Conectar a AZVMBDCENTRALQA. La base la pone el USE de abajo.
     2. Query > Results To > Results to Grid (Ctrl+D).
     3. Pegar el script completo en una ventana nueva y F5 (sin seleccionar
        nada: se ejecuta como un solo lote; no tiene GO).
     4. Cada grilla trae en su primera columna "Seccion" el codigo (P, A1,
        A2...) para identificarla. Las definiciones largas salen como XML:
        clic en la celda para abrir el texto completo sin recortes.
   ========================================================================= */
USE [Tickets_Proactivanet];
SET NOCOUNT ON;

DECLARE @t0 DATETIME2(3);
DECLARE @HoyMx DATE = CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()));

/* -------------------------------------------------------------------------
   0) Contexto
   ------------------------------------------------------------------------- */
SELECT Seccion = '0 Contexto',
       Servidor = @@SERVERNAME, Base = DB_NAME(), Cuenta = SUSER_SNAME(),
       Version = CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(20)),
       NivelCompat = (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()),
       HoraServidor = CONVERT(VARCHAR(19), SYSDATETIME(), 120),
       HoraUtc = CONVERT(VARCHAR(19), SYSUTCDATETIME(), 120),
       HoyMexico = CONVERT(VARCHAR(10), @HoyMx, 120);

/* -------------------------------------------------------------------------
   P) Salvaguarda: los tres procedimientos siguen siendo los verificados
   ------------------------------------------------------------------------- */
DECLARE @Procs TABLE (Nombre SYSNAME PRIMARY KEY, ModificadoVerificado DATETIME2(0));
INSERT @Procs VALUES
    (N'usp_CorreoServicio_Pareto',           '2026-11-05T18:01:28'),
    (N'usp_CorreoServicio_TicketsCategoria', '2026-11-06T11:50:29'),
    (N'usp_CorreoServicio_TicketsGrupo',     '2026-11-06T11:51:33');

DECLARE @Chequeo TABLE (Nombre SYSNAME, Existe BIT, ModificadoActual VARCHAR(19),
                        ModificadoVerificado VARCHAR(19), MismaFecha BIT, PalabrasDeEscritura NVARCHAR(200));
INSERT @Chequeo
SELECT p.Nombre,
       CASE WHEN o.object_id IS NULL THEN 0 ELSE 1 END,
       CONVERT(VARCHAR(19), o.modify_date, 120),      -- recortado al segundo, igual que el diag 1
       CONVERT(VARCHAR(19), p.ModificadoVerificado, 120),
       CASE WHEN CONVERT(VARCHAR(19), o.modify_date, 120) = CONVERT(VARCHAR(19), p.ModificadoVerificado, 120) THEN 1 ELSE 0 END,
       ISNULL(STUFF(
             CASE WHEN d.Txt LIKE N'%INSERT%'   THEN N',INSERT'   ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%UPDATE%'   THEN N',UPDATE'   ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%DELETE%'   THEN N',DELETE'   ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%MERGE%'    THEN N',MERGE'    ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%TRUNCATE%' THEN N',TRUNCATE' ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%DROP%'     THEN N',DROP'     ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%ALTER%'    THEN N',ALTER'    ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%GRANT%'    THEN N',GRANT'    ELSE N'' END
           + CASE WHEN d.Txt LIKE N'%EXEC%'     THEN N',EXEC'     ELSE N'' END
           , 1, 1, N''), N'')
FROM @Procs AS p
LEFT JOIN sys.objects AS o ON o.object_id = OBJECT_ID(N'dbo.' + p.Nombre) AND o.type = 'P'
OUTER APPLY (SELECT Txt = OBJECT_DEFINITION(o.object_id)) AS d;

DECLARE @EjecutarProcs BIT =
    CASE WHEN (SELECT COUNT(*) FROM @Chequeo
               WHERE Existe = 1 AND MismaFecha = 1 AND PalabrasDeEscritura = N'') = 3 THEN 1 ELSE 0 END;

SELECT Seccion = 'P Salvaguarda procedimientos', c.Nombre, c.Existe,
       c.ModificadoActual,
       c.ModificadoVerificado,
       c.MismaFecha, PalabrasDeEscritura = NULLIF(c.PalabrasDeEscritura, N''),
       SeEjecutanEnC = CASE WHEN @EjecutarProcs = 1 THEN 'SI' ELSE 'NO: alguno cambio, la seccion C se omite' END,
       Definicion = (SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + c.Nombre)) AS [processing-instruction(definicion)]
                     FOR XML PATH(''), TYPE)
FROM @Chequeo AS c ORDER BY c.Nombre;

/* -------------------------------------------------------------------------
   A) Slot
   ------------------------------------------------------------------------- */
-- A1: definicion completa de dbo.vw_Tickets (clic en la celda) y tipo de Slot
SELECT Seccion = 'A1 Definicion vw_Tickets',
       Modificado = (SELECT CONVERT(VARCHAR(19), modify_date, 120) FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.vw_Tickets')),
       TipoSlot = (SELECT TYPE_NAME(user_type_id) FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.vw_Tickets') AND name = N'Slot'),
       Definicion = (SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.vw_Tickets')) AS [processing-instruction(definicion)]
                     FOR XML PATH(''), TYPE);

-- A2: las lineas de vw_Tickets que tocan Slot / Calendar / reloj (atajo de A1)
SELECT Seccion = 'A2 Lineas Slot en vw_Tickets', Linea = LEFT(LTRIM(value), 400)
FROM STRING_SPLIT(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'dbo.vw_Tickets')), CHAR(13), N''), CHAR(10))
WHERE value LIKE N'%Slot%' OR value LIKE N'%Calendar%' OR value LIKE N'%DATEDIFF%' OR value LIKE N'%GETDATE%'
   OR value LIKE N'%SYSDATETIME%' OR value LIKE N'%SYSUTCDATETIME%' OR value LIKE N'%CURRENT[_]TIMESTAMP%';

-- A3: Slot -> fechas reales de registro
SELECT Seccion = 'A3 Slot a fechas', Slot,
       Tickets        = COUNT(*),
       PrimerRegistro = CONVERT(VARCHAR(19), MIN(FechaRegistro), 120),
       UltimoRegistro = CONVERT(VARCHAR(19), MAX(FechaRegistro), 120),
       DiasAtrasDesde = DATEDIFF(DAY, CONVERT(DATE, MIN(FechaRegistro)), @HoyMx),
       DiasAtrasHasta = DATEDIFF(DAY, CONVERT(DATE, MAX(FechaRegistro)), @HoyMx),
       DiasDistintos  = COUNT(DISTINCT CONVERT(DATE, FechaRegistro))
FROM dbo.vw_Tickets
WHERE Slot BETWEEN -1 AND 13 OR Slot IS NULL
GROUP BY Slot
ORDER BY CASE WHEN Slot IS NULL THEN 999 ELSE Slot END;

-- A4: rango total de Slot
SELECT Seccion = 'A4 Rango de Slot', SlotMin = MIN(Slot), SlotMax = MAX(Slot),
       SinSlot = SUM(CASE WHEN Slot IS NULL THEN 1 ELSE 0 END), Tickets = COUNT(*)
FROM dbo.vw_Tickets;

-- A5: registrados de antier a hoy: en que Slot caen (borde del Slot 0)
SELECT Seccion = 'A5 Ultimos dias por Slot',
       Dia = CONVERT(VARCHAR(10), CONVERT(DATE, FechaRegistro), 120), Slot, Tickets = COUNT(*)
FROM dbo.vw_Tickets
WHERE FechaRegistro >= DATEADD(DAY, -2, @HoyMx)
GROUP BY CONVERT(DATE, FechaRegistro), Slot
ORDER BY Dia, Slot;

-- A6: frontera entre Slot 0 y Slot 1 (dias 29..33 atras)
SELECT Seccion = 'A6 Borde Slot 0 y 1',
       Dia = CONVERT(VARCHAR(10), CONVERT(DATE, FechaRegistro), 120),
       DiasAtras = DATEDIFF(DAY, CONVERT(DATE, FechaRegistro), @HoyMx), Slot, Tickets = COUNT(*)
FROM dbo.vw_Tickets
WHERE FechaRegistro >= DATEADD(DAY, -33, @HoyMx) AND FechaRegistro < DATEADD(DAY, -28, @HoyMx)
GROUP BY CONVERT(DATE, FechaRegistro), Slot
ORDER BY Dia, Slot;

/* -------------------------------------------------------------------------
   B) Permisos
   ------------------------------------------------------------------------- */
SELECT Seccion = 'B1 Permisos sobre objetos', Objeto = OBJECT_NAME(p.major_id), Principal = pr.name,
       TipoPrincipal = pr.type_desc, p.permission_name, p.state_desc
FROM sys.database_permissions AS p
JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE p.class = 1
  AND (OBJECT_NAME(p.major_id) LIKE N'usp[_]CorreoServicio[_]%'
    OR OBJECT_NAME(p.major_id) LIKE N'usp[_]CorreoQARE[_]%'
    OR OBJECT_NAME(p.major_id) LIKE N'usp[_]Analisis[_]%'
    OR OBJECT_NAME(p.major_id) LIKE N'usp[_]Dash[_]%'
    OR OBJECT_NAME(p.major_id) = N'vw_ServicioTickets')
ORDER BY Objeto, Principal;

SELECT Seccion = 'B2 Permisos esquema y base', Nivel = p.class_desc,
       Sobre = CASE p.class WHEN 3 THEN SCHEMA_NAME(p.major_id) ELSE DB_NAME() END,
       Principal = pr.name, TipoPrincipal = pr.type_desc, p.permission_name, p.state_desc
FROM sys.database_permissions AS p
JOIN sys.database_principals AS pr ON pr.principal_id = p.grantee_principal_id
WHERE (p.class = 3 AND p.major_id = SCHEMA_ID(N'dbo'))
   OR (p.class = 0 AND p.permission_name IN (N'EXECUTE', N'SELECT', N'CONNECT'))
ORDER BY Nivel, Principal, p.permission_name;

SELECT Seccion = 'B3 Miembros de roles', Rol = r.name, Miembro = m.name, TipoMiembro = m.type_desc
FROM sys.database_role_members AS rm
JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals AS m ON m.principal_id = rm.member_principal_id
ORDER BY Rol, Miembro;

SELECT Seccion = 'B4 Mi cuenta', Objeto = p.Nombre,
       PuedoEjecutar = HAS_PERMS_BY_NAME(N'dbo.' + p.Nombre, 'OBJECT', 'EXECUTE')
FROM @Procs AS p;

/* -------------------------------------------------------------------------
   C) Ejecucion real (solo si P dio SI)
   ------------------------------------------------------------------------- */
DECLARE @R TABLE (Proc_ VARCHAR(20), Slot INT, Posicion BIGINT, Etiqueta NVARCHAR(500),
                  CantidadTickets INT, TotalTickets INT, Porcentaje DECIMAL(6,2), PorcentajeAcumulado DECIMAL(6,2));
DECLARE @X TABLE (Posicion BIGINT, Etiqueta NVARCHAR(500), CantidadTickets INT, TotalTickets INT,
                  Porcentaje DECIMAL(6,2), PorcentajeAcumulado DECIMAL(6,2));
DECLARE @Tiempos TABLE (Proc_ VARCHAR(20), Slot INT, Ms INT);
DECLARE @s INT = 0;

IF @EjecutarProcs = 1
BEGIN
    WHILE @s <= 12
    BEGIN
        DELETE @X; SET @t0 = SYSDATETIME();
        INSERT @X EXEC dbo.usp_CorreoServicio_Pareto @Slot = @s;
        INSERT @Tiempos VALUES ('Pareto', @s, DATEDIFF(MILLISECOND, @t0, SYSDATETIME()));
        INSERT @R SELECT 'Pareto', @s, Posicion, Etiqueta, CantidadTickets, TotalTickets, Porcentaje, PorcentajeAcumulado FROM @X;

        DELETE @X; SET @t0 = SYSDATETIME();
        INSERT @X EXEC dbo.usp_CorreoServicio_TicketsCategoria @Slot = @s;
        INSERT @Tiempos VALUES ('Categoria', @s, DATEDIFF(MILLISECOND, @t0, SYSDATETIME()));
        INSERT @R SELECT 'Categoria', @s, Posicion, Etiqueta, CantidadTickets, TotalTickets, Porcentaje, PorcentajeAcumulado FROM @X;

        DELETE @X; SET @t0 = SYSDATETIME();
        INSERT @X EXEC dbo.usp_CorreoServicio_TicketsGrupo @Slot = @s;
        INSERT @Tiempos VALUES ('Grupo', @s, DATEDIFF(MILLISECOND, @t0, SYSDATETIME()));
        INSERT @R SELECT 'Grupo', @s, Posicion, Etiqueta, CantidadTickets, TotalTickets, Porcentaje, PorcentajeAcumulado FROM @X;

        SET @s = @s + 12;      -- solo 0 y 12: el mas reciente y el mas viejo del selector
    END;
END;

SELECT Seccion = 'C1 Resumen ejecucion', t.Proc_, t.Slot, t.Ms,
       Filas          = (SELECT COUNT(*) FROM @R r WHERE r.Proc_ = t.Proc_ AND r.Slot = t.Slot),
       TotalTickets   = (SELECT MAX(TotalTickets) FROM @R r WHERE r.Proc_ = t.Proc_ AND r.Slot = t.Slot),
       TotalesDistintos = (SELECT COUNT(DISTINCT TotalTickets) FROM @R r WHERE r.Proc_ = t.Proc_ AND r.Slot = t.Slot),
       SumaCantidades = (SELECT SUM(CantidadTickets) FROM @R r WHERE r.Proc_ = t.Proc_ AND r.Slot = t.Slot),
       AcumuladoFinal = (SELECT MAX(PorcentajeAcumulado) FROM @R r WHERE r.Proc_ = t.Proc_ AND r.Slot = t.Slot),
       FilasHasta80   = (SELECT COUNT(*) FROM @R r WHERE r.Proc_ = t.Proc_ AND r.Slot = t.Slot AND r.PorcentajeAcumulado <= 80),
       PosicionQueCruza80 = (SELECT MIN(Posicion) FROM @R r WHERE r.Proc_ = t.Proc_ AND r.Slot = t.Slot AND r.PorcentajeAcumulado >= 80),
       OrdenDescendente = CASE WHEN EXISTS (
                SELECT 1 FROM @R a JOIN @R b ON b.Proc_ = a.Proc_ AND b.Slot = a.Slot AND b.Posicion = a.Posicion + 1
                WHERE a.Proc_ = t.Proc_ AND a.Slot = t.Slot AND b.CantidadTickets > a.CantidadTickets) THEN 'NO' ELSE 'SI' END,
       Ejecutado = CASE WHEN @EjecutarProcs = 1 THEN 'SI' ELSE 'NO (ver P)' END
FROM @Tiempos AS t
ORDER BY t.Proc_, t.Slot;

SELECT Seccion = 'C2 Slot 0 primeras 16 filas', Proc_, Posicion, Etiqueta = LEFT(Etiqueta, 200),
       CantidadTickets, TotalTickets, Porcentaje, PorcentajeAcumulado
FROM @R WHERE Slot = 0 AND Posicion <= 16
ORDER BY Proc_, Posicion;

SELECT Seccion = 'C3 Largo de etiquetas', Proc_, LargoMax = MAX(LEN(Etiqueta)),
       LargoPromedioTop15 = AVG(CASE WHEN Posicion <= 15 THEN LEN(Etiqueta) END)
FROM @R WHERE Slot = 0 GROUP BY Proc_;

/* -------------------------------------------------------------------------
   D) Pareto por codigo de servicio
   ------------------------------------------------------------------------- */
SELECT Seccion = 'D1 CatServicioCorreo', s.Servicio, s.Descripcion, s.Habilitado, s.DiasVentana,
       Ramas = (SELECT COUNT(*) FROM dbo.CatServicioCategoria sc WHERE sc.Servicio = s.Servicio)
FROM dbo.CatServicioCorreo AS s ORDER BY s.Servicio;

SELECT Seccion = 'D2 Prefijos fuera del Pareto', sc.Servicio, sc.PrefijoCategoria,
       Motivo = CASE WHEN s.Servicio IS NULL THEN 'sin fila en CatServicioCorreo' ELSE 'Habilitado = 0' END
FROM dbo.CatServicioCategoria AS sc
LEFT JOIN dbo.CatServicioCorreo AS s ON s.Servicio = sc.Servicio
WHERE s.Servicio IS NULL OR s.Habilitado = 0
ORDER BY sc.Servicio;

SELECT Seccion = 'D3 Prefijos anidados', ServicioPadre = a.Servicio, PrefijoPadre = a.PrefijoCategoria,
       ServicioHijo = b.Servicio, PrefijoHijo = b.PrefijoCategoria
FROM dbo.CatServicioCategoria AS a
JOIN dbo.CatServicioCategoria AS b
  ON b.PrefijoCategoria <> a.PrefijoCategoria
 AND LEFT(b.PrefijoCategoria, LEN(a.PrefijoCategoria + N'|')) = a.PrefijoCategoria + N'/';

-- Una sola lectura de vw_ServicioTickets para todo D4..D8
DECLARE @V TABLE (CodigoTicket NVARCHAR(100), Servicio NVARCHAR(100), Rama NVARCHAR(400), Slot INT,
                  TieneCategoria BIT, TieneGrupo BIT);
SET @t0 = SYSDATETIME();
INSERT @V
SELECT CodigoTicket, LTRIM(RTRIM(Servicio)), LTRIM(RTRIM(RamaServicio)), Slot,
       CASE WHEN NULLIF(LTRIM(RTRIM(Categoria)), N'') IS NULL THEN 0 ELSE 1 END,
       CASE WHEN NULLIF(LTRIM(RTRIM(Grupo)), N'') IS NULL THEN 0 ELSE 1 END
FROM dbo.vw_ServicioTickets
WHERE Slot BETWEEN 0 AND 12;
DECLARE @msV INT = DATEDIFF(MILLISECOND, @t0, SYSDATETIME());

SELECT Seccion = 'D4 Totales por slot', v.Slot,
       Renglones           = COUNT(*),
       TicketsDistintos    = COUNT(DISTINCT v.CodigoTicket),
       SumaPorRama         = (SELECT SUM(n) FROM (SELECT n = COUNT(DISTINCT CodigoTicket) FROM @V r
                                                  WHERE r.Slot = v.Slot GROUP BY r.Rama) x),      -- denominador actual del Pareto
       SumaPorServicio     = (SELECT SUM(n) FROM (SELECT n = COUNT(DISTINCT CodigoTicket) FROM @V r
                                                  WHERE r.Slot = v.Slot GROUP BY r.Servicio) x),  -- denominador si se agrupa por Servicio
       TicketsConCategoria = COUNT(DISTINCT CASE WHEN v.TieneCategoria = 1 THEN v.CodigoTicket END),
       TicketsConGrupo     = COUNT(DISTINCT CASE WHEN v.TieneGrupo = 1 THEN v.CodigoTicket END),
       MsLecturaVista      = @msV
FROM @V AS v
GROUP BY v.Slot
ORDER BY v.Slot
OPTION (RECOMPILE);

SELECT Seccion = 'D5a Tickets en varios servicios', Tickets = COUNT(*)
FROM (SELECT CodigoTicket FROM @V GROUP BY CodigoTicket HAVING COUNT(DISTINCT Servicio) > 1) x
OPTION (RECOMPILE);

SELECT TOP (20) Seccion = 'D5b Ejemplos varios servicios', m.CodigoTicket,
       Servicios = STUFF((SELECT N' | ' + v.Servicio + N' <' + v.Rama + N'>'
                          FROM @V v WHERE v.CodigoTicket = m.CodigoTicket
                          FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 3, N'')
FROM (SELECT CodigoTicket FROM @V GROUP BY CodigoTicket HAVING COUNT(DISTINCT Servicio) > 1) m
ORDER BY m.CodigoTicket
OPTION (RECOMPILE);

SELECT Seccion = 'D6 Tickets en varias ramas del mismo servicio', Servicio, Tickets = COUNT(*)
FROM (SELECT Servicio, CodigoTicket FROM @V GROUP BY Servicio, CodigoTicket HAVING COUNT(DISTINCT Rama) > 1) x
GROUP BY Servicio
OPTION (RECOMPILE);

SELECT Seccion = 'D7 Tickets en varios slots', Tickets = COUNT(*)
FROM (SELECT CodigoTicket FROM @V GROUP BY CodigoTicket HAVING COUNT(DISTINCT Slot) > 1) x
OPTION (RECOMPILE);

-- D8: agrupacion PROPUESTA por Servicio con Slot 0 (SELECT suelto, no cambia nada)
;WITH A AS (
    SELECT Servicio, CantidadTickets = COUNT(DISTINCT CodigoTicket)
    FROM @V WHERE Slot = 0 AND NULLIF(Servicio, N'') IS NOT NULL
    GROUP BY Servicio
)
SELECT Seccion = 'D8 Propuesta Pareto por Servicio slot 0',
       Posicion = ROW_NUMBER() OVER (ORDER BY a.CantidadTickets DESC, a.Servicio),
       a.Servicio, Nombre = s.Descripcion, a.CantidadTickets,
       TotalTickets = SUM(a.CantidadTickets) OVER (),
       Porcentaje = CAST(100.0 * a.CantidadTickets / NULLIF(SUM(a.CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
       PorcentajeAcumulado = CAST(100.0 * SUM(a.CantidadTickets) OVER (ORDER BY a.CantidadTickets DESC, a.Servicio
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                                  / NULLIF(SUM(a.CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
       Ramas = STUFF((SELECT N' + ' + r.Rama + N' (' + CAST(r.n AS NVARCHAR(10)) + N')'
                      FROM (SELECT Rama, n = COUNT(DISTINCT CodigoTicket) FROM @V
                            WHERE Slot = 0 AND Servicio = a.Servicio GROUP BY Rama) r
                      ORDER BY r.n DESC
                      FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 3, N'')
FROM A AS a
LEFT JOIN dbo.CatServicioCorreo AS s ON s.Servicio = a.Servicio
ORDER BY Posicion
OPTION (RECOMPILE);

SELECT Seccion = 'FIN', Mensaje = 'Diagnostico terminado';
