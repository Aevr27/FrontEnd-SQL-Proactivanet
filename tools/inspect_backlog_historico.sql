-- Firma y definicion de los dos procedimientos del historico de Backlog.
-- Sirve para saber que parametros espera realmente
-- dbo.usp_CorreoBacklog_Historico (en particular @FechaInicio) antes de
-- tocar handlers/backlog_historico.ashx.
--
-- Uso (desde la raiz del proyecto, con acceso a la red del servidor):
--   tools\inspect_backlog_historico.cmd
-- o a mano:
--   sqlcmd -S AZVMBDCENTRALQA -d Tickets_Proactivanet -U <usuario> -P <password> -C -W ^
--          -i tools\inspect_backlog_historico.sql -o salida_backlog_historico.txt

SET NOCOUNT ON;

PRINT '=== PARAMETROS ===';
SELECT
    o.name        AS procedimiento,
    p.parameter_id,
    p.name        AS parametro,
    TYPE_NAME(p.user_type_id) AS tipo,
    p.max_length,
    p.has_default_value,
    p.is_output
FROM sys.parameters p
JOIN sys.objects o ON o.object_id = p.object_id
WHERE o.name IN ('usp_CorreoBacklog_Historico', 'usp_CorreoBacklog_HistoricoPorLider')
ORDER BY o.name, p.parameter_id;

PRINT '';
PRINT '=== DEFINICION usp_CorreoBacklog_Historico ===';
SELECT definition
FROM sys.sql_modules
WHERE object_id = OBJECT_ID('dbo.usp_CorreoBacklog_Historico');

PRINT '';
PRINT '=== DEFINICION usp_CorreoBacklog_HistoricoPorLider ===';
SELECT definition
FROM sys.sql_modules
WHERE object_id = OBJECT_ID('dbo.usp_CorreoBacklog_HistoricoPorLider');
