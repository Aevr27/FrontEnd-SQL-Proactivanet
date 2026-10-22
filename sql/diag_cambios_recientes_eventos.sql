/* =========================================================================
   sql/diag_cambios_recientes_eventos.sql - SOLO LECTURA (ningun INSERT,
   UPDATE, DELETE ni DDL). Para correr en la VM antes de desplegar el lector
   nuevo de "Cambios recientes" (App_Code/CambiosRecientesAdmin.cs).

   Pregunta: por que la columna "Que" decia "Cambio" en iniciativas creadas.
   El lector anterior mostraba UNA fila por iniciativa con su ULTIMO sello y
   solo la llamaba "Alta" si ese sello era el del alta (+-1 s de
   FechaAltaUtc). Una iniciativa creada y luego editada salia como "Cambio".

   Seccion 1: las 30 protegidas mas recientes con lo que la base sabe de
              cada una y como las clasificaba el lector viejo y el nuevo.
   Seccion 2: conteo por caso (cuantas altas quedaban ocultas).
   Seccion 3: sellos que coinciden con una solicitud APLICADA.
   ========================================================================= */
SET NOCOUNT ON;

IF COL_LENGTH(N'adm.IniciativaProtegida', N'UltimoCambioUtc') IS NULL
BEGIN
    SELECT N'sql/23 no aplicada: no hay sellos que revisar' AS Resultado;
    RETURN;
END;

/* ---------- 1. Detalle ---------- */
SELECT TOP (30)
       p.Codigo, p.Motivo, p.Usuario AS UsuarioAlta, p.FechaAltaUtc,
       p.UltimoCambioUtc, p.UltimoCambioUsuario,
       DATEDIFF(MILLISECOND, p.FechaAltaUtc, p.UltimoCambioUtc) AS MsEntreAltaYSello,
       CASE WHEN p.Motivo = 'ALTA' AND DATEDIFF(SECOND, p.FechaAltaUtc, p.UltimoCambioUtc) BETWEEN -1 AND 1
            THEN 'Alta' ELSE 'Cambio' END AS LectorViejo,
       CASE WHEN p.Motivo <> 'ALTA' THEN 'Cambio'
            WHEN p.UltimoCambioUtc IS NULL THEN 'Alta (anterior a sql/23)'
            WHEN DATEDIFF(SECOND, p.FechaAltaUtc, p.UltimoCambioUtc) BETWEEN -1 AND 1 THEN 'Alta'
            ELSE 'Alta + Cambio' END AS LectorNuevo,
       pr.FechaCreacion AS FechaCreacionProblem
FROM adm.IniciativaProtegida AS p
LEFT JOIN dbo.Problem AS pr ON pr.Codigo = p.Codigo
ORDER BY COALESCE(p.UltimoCambioUtc, CONVERT(datetime2(3), p.FechaAltaUtc)) DESC, p.Codigo;

/* ---------- 2. Resumen ---------- */
SELECT p.Motivo,
       SUM(CASE WHEN p.UltimoCambioUtc IS NULL THEN 1 ELSE 0 END) AS SinSello,
       SUM(CASE WHEN p.UltimoCambioUtc IS NOT NULL AND p.Motivo = 'ALTA'
                 AND DATEDIFF(SECOND, p.FechaAltaUtc, p.UltimoCambioUtc) BETWEEN -1 AND 1 THEN 1 ELSE 0 END) AS SelloEsElAlta,
       SUM(CASE WHEN p.UltimoCambioUtc IS NOT NULL AND NOT (p.Motivo = 'ALTA'
                 AND DATEDIFF(SECOND, p.FechaAltaUtc, p.UltimoCambioUtc) BETWEEN -1 AND 1) THEN 1 ELSE 0 END) AS SelloPosterior,
       COUNT(*) AS Total
FROM adm.IniciativaProtegida AS p
GROUP BY p.Motivo
ORDER BY p.Motivo;

/* ---------- 3. Sellos que son una solicitud aplicada ---------- */
IF OBJECT_ID(N'adm.SolicitudCambio', N'U') IS NOT NULL
    SELECT p.Codigo, p.UltimoCambioUtc, p.UltimoCambioUsuario, s.IdSolicitud, s.Tipo, s.FechaRevisionUtc, s.RevisadoPor
    FROM adm.IniciativaProtegida AS p
    INNER JOIN adm.SolicitudCambio AS s
            ON s.Codigo COLLATE DATABASE_DEFAULT = p.Codigo COLLATE DATABASE_DEFAULT
           AND s.Estado = 'APLICADA'
           AND s.RevisadoPor COLLATE DATABASE_DEFAULT = p.UltimoCambioUsuario COLLATE DATABASE_DEFAULT
           AND DATEDIFF(SECOND, s.FechaRevisionUtc, p.UltimoCambioUtc) BETWEEN -1 AND 1
    ORDER BY p.UltimoCambioUtc DESC;
ELSE
    SELECT N'sin sql/22: ningun sello se rotula como solicitud' AS Resultado;
