/* =========================================================================
   sql/45_qare_respuesta_invalida_v_duplicada_rollback.sql
   ROLLBACK de sql/45_qare_respuesta_invalida_v_duplicada.sql: vuelve a
   activar `v` (IdRespuestaInvalida 47). Eso tambien vuelve a duplicar en
   dbo.vw_QARE_CalidadCaptura los tickets cuya respuesta es "v".
   ========================================================================= */
USE [Tickets_Proactivanet];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

UPDATE dbo.CatQARE_RespuestaInvalida
SET Activo = 1
WHERE IdRespuestaInvalida = 47
  AND Valor COLLATE Latin1_General_CS_AS = 'v'
  AND Activo = 0;

IF @@ROWCOUNT <> 1
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR(N'45 rollback: la fila 47 (v) no estaba inactiva. No se cambio nada.', 16, 1);
    RETURN;
END;

COMMIT TRANSACTION;

SELECT IdRespuestaInvalida, Campo, Valor, Activo
FROM dbo.CatQARE_RespuestaInvalida
WHERE IdRespuestaInvalida IN (47, 48);
GO
