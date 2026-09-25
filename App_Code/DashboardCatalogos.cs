// Catalogos de los filtros del tablero: las listas que llenan los <select>
// de cada pestana, cada una leida de SU fuente de siempre.
//
// QUE SE COMPARTE Y QUE NO
// ------------------------
// Se comparte la IMPLEMENTACION: como se ejecuta un catalogo y como se aplana
// un result set de una columna (Columna). Antes eran cuatro copias -ValoresDe
// en catalogos.ashx y en backlog_catalogos.ashx, DashboardQueries.Columna y
// BacklogUtil.Columna- de la misma idea.
//
// NO se comparte la FUENTE. Un "Grupo" de SLA, uno de Backlog y uno de QA no
// son la misma poblacion y no se unifican aqui:
//
//   Sla()         dbo.usp_Dash_Catalogos           grupos y tecnicos de SLA
//   CallCenter()  dbo.vw_Dash_ProductividadBase    el subconjunto que atiende
//                                                  telefono (GruposCallCenter)
//   Backlog()     dbo.usp_CorreoBacklog_Catalogos  c1, grupos, lideres y los
//                                                  cortes de CorreoBacklogSnapshot
//
// Los cuerpos de los dos procedimientos no estan versionados en el repo, asi
// que no hay forma de demostrar desde aqui que dos listas "de grupos" sean la
// misma; cambiar una por otra seria cambiar lo que ofrece el desplegable.
//
// Los catalogos de QA (usp_CorreoQA_CatalogoCategorias / _GruposValidos) se
// quedan en QaCorreo: van por QaDb, que tiene su propia conexion y su modo
// snapshot. Los de Experiencia (Director / PO / Manager / SO) salen de
// DirectorioOrganizacional.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Text;

public static class DashboardCatalogos
{
    // ---------------------------------------------------------------------
    // SLA: dbo.usp_Dash_Catalogos
    // ---------------------------------------------------------------------

    // Dos result sets de UNA columna cada uno: grupos primero, tecnicos
    // despues. Sin parametros ni filtro de fechas.
    public static Dictionary<string, object> Sla()
    {
        var sets = DashboardDb.EjecutarMultiple("dbo.usp_Dash_Catalogos", null);
        return new Dictionary<string, object>
        {
            { "grupos",   Columna(sets, 0) },
            { "tecnicos", Columna(sets, 1) },
        };
    }

    // ---------------------------------------------------------------------
    // Call Center: dbo.vw_Dash_ProductividadBase
    // ---------------------------------------------------------------------

    /* Grupos y tecnicos del Call Center, para acotar los dos <select> cuando
       la barra de filtros esta en esa pestana.

       Va APARTE de dbo.usp_Dash_Catalogos -que sigue sirviendo las listas
       completas del tablero de SLA, sin tocar- y sale de la misma vista que
       el resto de las consultas de DashboardQueries, asi que la relacion
       tecnico -> grupo es la que ya existe en los datos: no hay ninguna lista
       de nombres escrita a mano.

       Sin filtro de fechas, igual que el catalogo de SLA: la lista de un
       filtro no puede encogerse por el rango que el usuario tenga puesto, o
       el tecnico que eligio desapareceria al mover una fecha.

       Los grupos se devuelven leidos de la vista y no desde la constante para
       que salgan con la grafia y el espaciado exactos con que estan grabados
       -el IN los encuentra igual, la colacion del servidor no distingue
       mayusculas- y para que un grupo que no exista en los datos no aparezca
       en el desplegable.

       Los tecnicos se asignan a su grupo PRINCIPAL -en el que tienen mas
       tickets-, no a cualquier grupo en el que aparezcan: la vista guarda el
       grupo del ticket, no el del tecnico, y con un simple IN entraba al Call
       Center cualquiera de otra area que alguna vez cerro un ticket de
       Service Desk o End User. No hay tabla de pertenencia tecnico -> grupo;
       el grupo con mas tickets es lo mas cercano que hay en los datos. */
    public static Dictionary<string, object> CallCenter()
    {
        const string sql = @"
SELECT DISTINCT Grupo
FROM dbo.vw_Dash_ProductividadBase
WHERE Grupo IN ({0})
ORDER BY Grupo;

WITH PorGrupo AS (
    SELECT Tecnico, Grupo, Tickets = COUNT_BIG(*)
    FROM dbo.vw_Dash_ProductividadBase
    WHERE Tecnico IS NOT NULL AND LTRIM(RTRIM(Tecnico)) <> N''
    GROUP BY Tecnico, Grupo
), Principal AS (
    SELECT Tecnico, Grupo,
           Orden = ROW_NUMBER() OVER (PARTITION BY Tecnico ORDER BY Tickets DESC, Grupo)
    FROM PorGrupo
)
SELECT Tecnico
FROM Principal
WHERE Orden = 1
  AND Grupo IN ({0})
ORDER BY Tecnico;";

        var resultados = new List<List<Dictionary<string, object>>>();
        var grupos = DashboardQueries.GruposCallCenter;

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand())
        {
            // Un parametro por grupo, como en DashboardQueries.EnLista(): los
            // nombres no se concatenan nunca dentro del SQL.
            var marcas = new StringBuilder();
            for (int i = 0; i < grupos.Length; i++)
            {
                var nombre = "@gcc" + i;
                if (i > 0) marcas.Append(", ");
                marcas.Append(nombre);
                cmd.Parameters.Add(nombre, SqlDbType.NVarChar, 4000).Value = grupos[i];
            }

            cmd.Connection = cn;
            cmd.CommandType = CommandType.Text;
            cmd.CommandText = string.Format(sql, marcas.ToString());

            cn.Open();
            using (var reader = cmd.ExecuteReader())
            {
                do
                {
                    var filas = new List<Dictionary<string, object>>();
                    while (reader.Read()) filas.Add(SqlRowMapper.Fila(reader));
                    resultados.Add(filas);
                } while (reader.NextResult());
            }
        }

        return new Dictionary<string, object>
        {
            { "grupos",   Columna(resultados, 0) },
            { "tecnicos", Columna(resultados, 1) },
        };
    }

    // ---------------------------------------------------------------------
    // Backlog: dbo.usp_CorreoBacklog_Catalogos
    // ---------------------------------------------------------------------

    // Cuatro result sets de UNA columna, en este orden: c1, grupos, lideres y
    // fechas de corte (de la mas reciente a la mas vieja).
    public static Dictionary<string, object> Backlog()
    {
        var sets = DashboardDb.EjecutarMultiple("dbo.usp_CorreoBacklog_Catalogos", null);
        return new Dictionary<string, object>
        {
            { "c1",      Columna(sets, 0) },
            { "grupos",  Columna(sets, 1) },
            { "lideres", Columna(sets, 2) },
            { "fechas",  Columna(sets, 3) },
        };
    }

    // ---------------------------------------------------------------------
    // Utilidad
    // ---------------------------------------------------------------------

    // Aplana un result set de una sola columna a ["valor", "valor", ...].
    // Cada fila trae exactamente un valor, asi que el primero es el unico y
    // no hace falta conocer el nombre de la columna: el catalogo no depende
    // de como se llame dentro del procedimiento. Los NULL se descartan y un
    // indice fuera de rango da lista vacia.
    public static List<object> Columna(
        List<List<Dictionary<string, object>>> resultados, int indice)
    {
        var salida = new List<object>();
        if (resultados == null || indice < 0 || indice >= resultados.Count) return salida;

        foreach (var fila in resultados[indice])
        {
            foreach (var valor in fila.Values)
            {
                if (valor != null) salida.Add(valor);
                break;
            }
        }
        return salida;
    }
}
