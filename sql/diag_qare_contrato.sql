/* =========================================================================
   sql/diag_qare_contrato.sql - Contrato real de los procedimientos QARE.

   SOLO LECTURA. No crea, no altera y no borra nada: consulta el catalogo del
   sistema y describe los result sets sin ejecutar los procedimientos.

   POR QUE EXISTE
   Los cuerpos de dbo.usp_CorreoQARE_* y de dbo.vw_CorreoQARECierre_Base no
   estan en este repositorio ni en Integracion_SQL-Proactivanet. La pestaña
   QARE (App_Code/QareQueries.cs) se escribio con los nombres de columna de
   "Documentacion_Dashboard_QARE" y con @FechaInicio/@FechaFin. Lo que ese
   documento NO dice, y hay que confirmar aqui antes de dar QARE por bueno:

     1. tipo de @FechaInicio / @FechaFin (DATE o DATETIME) y si hay mas
        parametros (con o sin default);
     2. si @FechaFin es INCLUSIVO (<= @FechaFin sobre un DATE) o exclusivo
        (< @FechaFin, o <= sobre un DATETIME a medianoche). El tablero manda
        las fechas que elige el usuario TAL CUAL, sin sumar un dia;
     3. escala de los porcentajes: 0-100 (como usp_CorreoQA_Kpis) o 0-1;
     4. nombres y tipos exactos de las columnas de cada result set;
     5. los valores literales de ValidacionQA / ConfirmacionUsuario /
        Frecuencia (acentos incluidos);
     6. permisos de la cuenta del sitio.

   Correr en la VM contra Tickets_Proactivanet y pegar la salida.
   ========================================================================= */

SET NOCOUNT ON;

-- 1) Parametros de los seis procedimientos.
SELECT  Procedimiento = OBJECT_NAME(p.object_id),
        Parametro     = p.name,
        Tipo          = TYPE_NAME(p.user_type_id),
        p.max_length,
        p.has_default_value,
        p.parameter_id
FROM sys.parameters AS p
WHERE p.object_id IN (
        OBJECT_ID(N'dbo.usp_CorreoQARE_KPIs'),
        OBJECT_ID(N'dbo.usp_CorreoQARE_Frecuencia'),
        OBJECT_ID(N'dbo.usp_CorreoQARE_CausaRaiz'),
        OBJECT_ID(N'dbo.usp_CorreoQARE_RecurrentesCategoria'),
        OBJECT_ID(N'dbo.usp_CorreoQARE_ConfirmacionVsQA'),
        OBJECT_ID(N'dbo.usp_CorreoQARE_TipoSolucion'))
ORDER BY Procedimiento, p.parameter_id;

-- 2) Cuerpos (buscar como se filtra @FechaFin y como se calculan los %).
SELECT Objeto = N'dbo.vw_CorreoQARECierre_Base',         Definicion = OBJECT_DEFINITION(OBJECT_ID(N'dbo.vw_CorreoQARECierre_Base'))
UNION ALL SELECT N'dbo.usp_CorreoQARE_KPIs',             OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CorreoQARE_KPIs'))
UNION ALL SELECT N'dbo.usp_CorreoQARE_Frecuencia',       OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CorreoQARE_Frecuencia'))
UNION ALL SELECT N'dbo.usp_CorreoQARE_CausaRaiz',        OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CorreoQARE_CausaRaiz'))
UNION ALL SELECT N'dbo.usp_CorreoQARE_RecurrentesCategoria', OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CorreoQARE_RecurrentesCategoria'))
UNION ALL SELECT N'dbo.usp_CorreoQARE_ConfirmacionVsQA', OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CorreoQARE_ConfirmacionVsQA'))
UNION ALL SELECT N'dbo.usp_CorreoQARE_TipoSolucion',     OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_CorreoQARE_TipoSolucion'));

-- 3) Forma del primer result set de cada uno, sin ejecutarlos.
SELECT Procedimiento = N'usp_CorreoQARE_KPIs', name, system_type_name, is_nullable, column_ordinal
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = ''2026-01-01'', @FechaFin = ''2026-01-31''', NULL, 0)
UNION ALL
SELECT N'usp_CorreoQARE_Frecuencia', name, system_type_name, is_nullable, column_ordinal
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_Frecuencia @FechaInicio = ''2026-01-01'', @FechaFin = ''2026-01-31''', NULL, 0)
UNION ALL
SELECT N'usp_CorreoQARE_CausaRaiz', name, system_type_name, is_nullable, column_ordinal
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_CausaRaiz @FechaInicio = ''2026-01-01'', @FechaFin = ''2026-01-31''', NULL, 0)
UNION ALL
SELECT N'usp_CorreoQARE_RecurrentesCategoria', name, system_type_name, is_nullable, column_ordinal
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_RecurrentesCategoria @FechaInicio = ''2026-01-01'', @FechaFin = ''2026-01-31''', NULL, 0)
UNION ALL
SELECT N'usp_CorreoQARE_ConfirmacionVsQA', name, system_type_name, is_nullable, column_ordinal
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio = ''2026-01-01'', @FechaFin = ''2026-01-31''', NULL, 0)
UNION ALL
SELECT N'usp_CorreoQARE_TipoSolucion', name, system_type_name, is_nullable, column_ordinal
FROM sys.dm_exec_describe_first_result_set(N'EXEC dbo.usp_CorreoQARE_TipoSolucion @FechaInicio = ''2026-01-01'', @FechaFin = ''2026-01-31''', NULL, 0)
ORDER BY 1, column_ordinal;

-- 4) Permisos efectivos de la cuenta con la que corre este script. Correrlo
--    con la MISMA cuenta que usa Web.config para que diga algo del sitio.
SELECT Objeto = o.name,
       PuedeEjecutar = HAS_PERMS_BY_NAME(N'dbo.' + o.name, N'OBJECT', N'EXECUTE')
FROM sys.objects AS o
WHERE o.name LIKE N'usp[_]CorreoQARE[_]%'
ORDER BY o.name;
