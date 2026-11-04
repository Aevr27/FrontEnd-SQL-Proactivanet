// Backlog por Lider, Grupo y Categoria (C1) para la pestaña "Lider (Categoria)"
// del tablero de Backlog (backlog/backlog.js, renderLideresCategoria).
//
// POR QUE NO SALE DEL PROCEDIMIENTO
// ---------------------------------
// dbo.usp_CorreoBacklog_Principal agrupa sus result sets SOLO por (Lider,
// Grupo) y lo comparte el correo diario de direccion: no se toca. Esta
// consulta lee la MISMA tabla (dbo.CorreoBacklogSnapshot), con el MISMO corte
// y los MISMOS tres filtros que el procedimiento arma en #Corte -incluida
// dbo.fn_CorreoBacklog_SplitList para las listas-, y agrega ademas por C1.
// Solo lectura: un SELECT, ningun INSERT/UPDATE/DELETE ni DDL.
//
// QUE CUENTA CADA COLUMNA (mismas expresiones que el procedimiento / el
// tablero, para que las cifras cuadren con "Lider (Grupo)"):
//
//   Critica   REPLACE(Prioridad, 'í', 'i') = 'Critica'   (result set 2)
//   Alta      Prioridad = 'Alta'                         (result set 2)
//   Total     COUNT(*)                                   (result set 2)
//   Mas30     AgingSort >= 5: "mas de 30 dias", el mismo
//             corte que SORT_MAS_30 en backlog.js aplica
//             sobre el result set 3
//   FueraSLA  EstadoSLA = 'Fuera SLA'                    (result set 6)
//
// Se agrupa tambien por Grupo para que el cross-filter por grupo del tablero
// (porLiderGrupo) siga siendo exacto; el navegador suma los grupos de cada
// (Lider, C1). C1 es la columna de la tabla: el primer segmento de Categoria
// (dbo.fn_CorreoBacklog_CategoriaC1 al guardar el corte), el mismo valor del
// filtro "Servicio / C1".

using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;

public static class BacklogCategorias
{
    // Igual que SORT_MAS_30 de backlog/backlog.js.
    public const int SORT_MAS_30 = 5;

    public const string SQL = @"
DECLARE @F DATE = ISNULL(@FechaCorte, (SELECT MAX(FechaCorte) FROM dbo.CorreoBacklogSnapshot));

SELECT
    Lider, Grupo, C1,
    Critica  = SUM(CASE WHEN REPLACE(Prioridad, N'í', N'i') = N'Critica' THEN 1 ELSE 0 END),
    Alta     = SUM(CASE WHEN Prioridad = N'Alta' THEN 1 ELSE 0 END),
    Mas30    = SUM(CASE WHEN AgingSort >= @SortMas30 THEN 1 ELSE 0 END),
    FueraSLA = SUM(CASE WHEN EstadoSLA = N'Fuera SLA' THEN 1 ELSE 0 END),
    Total    = COUNT(*)
FROM dbo.CorreoBacklogSnapshot
WHERE FechaCorte = @F
  AND (NULLIF(LTRIM(RTRIM(@C1)), N'')      IS NULL OR C1    IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@C1)))
  AND (NULLIF(LTRIM(RTRIM(@Grupos)), N'')  IS NULL OR Grupo IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Grupos)))
  AND (NULLIF(LTRIM(RTRIM(@Lideres)), N'') IS NULL OR Lider IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Lideres)))
GROUP BY Lider, Grupo, C1
ORDER BY Lider, C1, Grupo;";

    // filtros: los de BacklogUtil.Filtros (C1, Grupos, Lideres); fechaCorte:
    // BacklogUtil.FechaCorte (null = el corte mas reciente).
    public static List<Dictionary<string, object>> Leer(Dictionary<string, object> filtros, object fechaCorte)
    {
        var filas = new List<Dictionary<string, object>>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand(SQL, cn))
        {
            cmd.CommandType = CommandType.Text;
            // Texto aaaa-mm-dd del <input type=date>, como lo recibe el
            // procedimiento: SQL lo convierte a DATE (formato ISO, sin
            // depender del idioma de la sesion).
            cmd.Parameters.Add("@FechaCorte", SqlDbType.NVarChar, 10).Value = fechaCorte ?? (object)System.DBNull.Value;
            cmd.Parameters.Add("@SortMas30", SqlDbType.Int).Value = SORT_MAS_30;
            foreach (var k in new[] { "C1", "Grupos", "Lideres" })
            {
                object v;
                filtros.TryGetValue(k, out v);
                cmd.Parameters.Add("@" + k, SqlDbType.NVarChar, -1).Value = v ?? System.DBNull.Value;
            }
            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) filas.Add(SqlRowMapper.Fila(rd));
        }
        return filas;
    }
}
