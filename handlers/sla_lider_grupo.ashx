<%@ WebHandler Language="C#" Class="SlaLiderGrupo" %>

// Tabla "Cumplimiento por lider y grupo" de la pestana de SLA.
//
// Devuelve TAL CUAL el result set de dbo.usp_Dash_SlaLiderGrupo, sin
// recalcular nada: Lider, Grupo, Total, Dentro SLA, Vencidos, % Cumplimiento,
// % Vencidos, Reabiertos y % Reabiertos salen del procedimiento, con los
// nombres de columna que el procedimiento les pone. El tablero no muestra
// "% Vencidos", pero aqui viaja igual: el JSON no descarta nada.
//
// Va en un handler APARTE de kpis.ashx a proposito, como carga_combinada.ashx:
// si el procedimiento falla -o no existe en un servidor viejo-, dashboard.js
// pinta el error solo dentro de su tarjeta y los KPIs y graficas de SLA
// siguen igual. kpis.ashx no se toca.
//
// LOS PARAMETROS
// --------------
// La definicion del procedimiento no esta versionada en el repositorio, asi
// que aqui NO se da por hecha su firma. Se lee de sys.parameters en el primer
// request y solo se mandan los filtros del tablero que el procedimiento
// declara, con los mismos nombres que usan los demas usp_Dash_*:
//
//   @FechaInicio / @FechaFin   el rango del tablero (yyyy-MM-dd), con los
//                              mismos defaults que el resto de los handlers;
//   @Grupos                    la seleccion de Grupos separada por coma, SOLO
//                              si hay seleccion: sin ella no se manda y el
//                              procedimiento aplica su propio DEFAULT.
//
// Tecnicos NO se manda: los procedimientos parten esa lista por coma y los
// nombres de tecnico llevan coma dentro (ver App_Code/DashboardQueries.cs).
// Cualquier otro parametro que el procedimiento declare se queda en su
// DEFAULT. La respuesta dice que parametros se usaron ("parametros"), para que
// el tablero pueda avisar si un filtro activo no llego a la tabla.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Web;

public class SlaLiderGrupo : IHttpHandler
{
    private const string Procedimiento = "dbo.usp_Dash_SlaLiderGrupo";

    // La firma no cambia sin redeploy de la base; se lee una vez por dominio
    // de aplicacion. Un conjunto vacio no se guarda: puede ser que el
    // procedimiento todavia no exista y se cree despues.
    private static readonly object Candado = new object();
    private static HashSet<string> declarados;

    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            string fi, ff;
            DashboardParams.RangoFechas(context.Request, out fi, out ff);
            object grupos = DashboardParams.ListaONulo(context.Request, "grupos");

            var firma = ParametrosDeclarados();
            var parametros = new Dictionary<string, object>();
            if (firma.Contains("FechaInicio")) parametros["FechaInicio"] = fi;
            if (firma.Contains("FechaFin")) parametros["FechaFin"] = ff;
            if (firma.Contains("Grupos") && grupos != null) parametros["Grupos"] = grupos;

            var filas = DashboardDb.Ejecutar(Procedimiento, parametros);

            return new Dictionary<string, object>
            {
                { "sla_lider_grupo", filas },
                { "parametros", new List<string>(parametros.Keys) },
            };
        });
    }

    // Nombres de los parametros del procedimiento, sin la arroba y sin
    // distinguir mayusculas.
    private static HashSet<string> ParametrosDeclarados()
    {
        lock (Candado)
        {
            if (declarados != null) return declarados;
        }

        var salida = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand(
            "SELECT name FROM sys.parameters WHERE object_id = OBJECT_ID(@p);", cn))
        {
            cmd.CommandType = CommandType.Text;
            cmd.Parameters.AddWithValue("@p", Procedimiento);
            cn.Open();
            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    if (rd.IsDBNull(0)) continue;
                    salida.Add(rd.GetString(0).TrimStart('@'));
                }
            }
        }

        if (salida.Count > 0)
        {
            lock (Candado) { declarados = salida; }
        }
        return salida;
    }

    public bool IsReusable { get { return false; } }
}
