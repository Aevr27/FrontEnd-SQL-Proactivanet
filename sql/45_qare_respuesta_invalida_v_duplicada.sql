/* =========================================================================
   sql/45_qare_respuesta_invalida_v_duplicada.sql
   Desactiva la fila duplicada `v` (IdRespuestaInvalida 47) de
   dbo.CatQARE_RespuestaInvalida. Cambio de DATOS, sin DDL.

   Por que: `v` (47) y `V` (48) estan activos para QARe_DescripcionSolucion.
   La base es CI_AS, asi que los dos coinciden con el mismo texto y el
   LEFT JOIN de dbo.vw_QARE_CalidadCaptura devuelve dos filas para ese
   ticket (QA 2026-11-27: 9 375 filas, 9 374 tickets). Los SP de conteo usan
   COUNT(DISTINCT) y no cambian; usp_QARE_DetalleEvidencia deja de repetir
   el ticket. `V` (48) sigue activo, asi que la respuesta "v" sigue siendo
   invalida. Ver sql/docs/PROPUESTA_qare_tecnicos.md, 12.4.5.

   El catalogo es del prototipo de la pestana Tecnicos / QARE: correrlo solo
   con el acuerdo de su autora y la aprobacion del cambio.
   Deshacer: sql/45_qare_respuesta_invalida_v_duplicada_rollback.sql.

   Se detiene sin cambiar nada si las filas 47 y 48 ya no son las que se
   midieron.
   ========================================================================= */
USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Antes: los dos valores activos y el ticket repetido.
SELECT Momento = 'antes', IdRespuestaInvalida, Campo, Valor, Activo
FROM dbo.CatQARE_RespuestaInvalida
WHERE IdRespuestaInvalida IN (47, 48);

IF NOT EXISTS (SELECT 1 FROM dbo.CatQARE_RespuestaInvalida
               WHERE IdRespuestaInvalida = 47 AND Campo = 'QARe_DescripcionSolucion'
                 AND Valor COLLATE Latin1_General_CS_AS = 'v' AND Activo = 1)
   OR NOT EXISTS (SELECT 1 FROM dbo.CatQARE_RespuestaInvalida
                  WHERE IdRespuestaInvalida = 48 AND Campo = 'QARe_DescripcionSolucion'
                    AND Valor COLLATE Latin1_General_CS_AS = 'V' AND Activo = 1)
BEGIN
    RAISERROR(N'45: las filas 47 (v) y 48 (V) no estan como se midieron el 2026-11-27. No se cambio nada.', 16, 1);
    RETURN;
END;

BEGIN TRANSACTION;

UPDATE dbo.CatQARE_RespuestaInvalida
SET Activo = 0
WHERE IdRespuestaInvalida = 47
  AND Valor COLLATE Latin1_General_CS_AS = 'v'
  AND Activo = 1;

IF @@ROWCOUNT <> 1
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR(N'45: se esperaba actualizar 1 fila. Se deshizo.', 16, 1);
    RETURN;
END;

-- Ningun valor activo debe repetirse tras UPPER/TRIM (si no, el LEFT JOIN
-- vuelve a duplicar tickets).
IF EXISTS (SELECT 1 FROM dbo.CatQARE_RespuestaInvalida
           WHERE Campo = 'QARe_DescripcionSolucion' AND Activo = 1
           GROUP BY UPPER(LTRIM(RTRIM(Valor)))
           HAVING COUNT(*) > 1)
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR(N'45: quedan valores activos repetidos. Se deshizo.', 16, 1);
    RETURN;
END;

COMMIT TRANSACTION;

-- Despues: filas = tickets en la vista (misma ventana que los diag).
SELECT Momento = 'despues', IdRespuestaInvalida, Campo, Valor, Activo
FROM dbo.CatQARE_RespuestaInvalida
WHERE IdRespuestaInvalida IN (47, 48);

SELECT Momento = 'despues', Filas = COUNT(*), Tickets = COUNT(DISTINCT CodigoTicket)
FROM dbo.vw_QARE_CalidadCaptura
WHERE FechaFirmaSolucion >= '20261029' AND FechaFirmaSolucion < '20261128';
GO
