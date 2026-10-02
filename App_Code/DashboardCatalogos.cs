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
//   Backlog()     dbo.usp_CorreoBacklog_Catalogos  c1, lideres y los cortes de
//                                                  CorreoBacklogSnapshot
//                 dbo.CatLiderGrupo (vigentes)     grupos (tambien los de QARE)
//   TiposIniciativa()  dbo.Problem.TipoIniciativa  tipos en uso (Admin /
//                                                  Iniciativas)
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
    //
    // Del procedimiento se usan c1, lideres y fechas. La lista de GRUPOS no:
    // su result set 1 es mas amplio que el catalogo vigente de grupos, y el
    // desplegable de Grupo (Backlog y QARE, que comparten este endpoint) debe
    // ofrecer solo los de dbo.CatLiderGrupo. Ver GruposVigentes(). "Sin Torre"
    // sigue en lideres tal como lo devuelve el procedimiento.
    public static Dictionary<string, object> Backlog()
    {
        var sets = DashboardDb.EjecutarMultiple("dbo.usp_CorreoBacklog_Catalogos", null);
        return new Dictionary<string, object>
        {
            { "c1",      Columna(sets, 0) },
            { "grupos",  GruposVigentes() },
            { "lideres", Columna(sets, 2) },
            { "fechas",  Columna(sets, 3) },
        };
    }

    /* Grupos del filtro de Backlog/QARE: los vigentes de dbo.CatLiderGrupo,
       el catalogo Grupo -> Lider con el que el Backlog y la TVF de QARE ya
       calculan el Lider (LEFT JOIN por igualdad exacta de Grupo, ver
       sql/16_qare_filtros_org.sql). Se leen de la tabla y no de una lista
       escrita a mano: salen con la grafia exacta con que estan grabados, y un
       alta o baja en el catalogo aparece sin tocar el codigo.

       Solo lectura; no crea ni cambia ningun objeto de la base. */
    private static List<object> GruposVigentes()
    {
        const string sql = @"
SELECT DISTINCT Grupo
FROM dbo.CatLiderGrupo
WHERE VigenteEnOrigen = 1
ORDER BY Grupo;";

        var filas = new List<Dictionary<string, object>>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand(sql, cn))
        {
            cmd.CommandType = CommandType.Text;
            cn.Open();
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read()) filas.Add(SqlRowMapper.Fila(reader));
            }
        }

        return Columna(new List<List<Dictionary<string, object>>> { filas }, 0);
    }

    // ---------------------------------------------------------------------
    // Admin / Iniciativas: tipos de iniciativa
    // ---------------------------------------------------------------------

    /* Los "Tipo Iniciativa" con los que ya existen iniciativas vigentes:
       dbo.Problem.TipoIniciativa, la columna que el loader llena desde la
       hoja DBProblems (la que tiene la validacion de lista en el Excel). Es
       la misma columna que Experiencia lee para las iniciativas sin
       categoria (ExperienciaQueries.LeerIniciativasSinCategoria).

       No hay tabla catalogo de tipos en la base todavia (adm.TipoIniciativa
       es del diseño, no existe), asi que la lista es la de los valores EN
       USO: un tipo de la lista del Excel que ninguna iniciativa vigente use
       no aparece. No se escribe ninguna lista a mano.

       Los valores se normalizan como las categorias
       (DirectorioOrganizacional.Normaliza) y se deduplican sin distinguir
       mayusculas, quedandose con la primera grafia en orden ordinal.

       Orden: Problem (si el catalogo lo trae) primero, el resto en orden
       ordinal (TiposSolicitud.ProblemPrimero). Solo cambia el orden.

       Solo lectura, sobre la conexion que ya abrio quien llama. */
    public static List<object> TiposIniciativa(SqlConnection cn)
    {
        const string sql = @"
SELECT DISTINCT TipoIniciativa
FROM dbo.Problem
WHERE VigenteEnOrigen = 1
  AND TipoIniciativa IS NOT NULL;";

        var valores = new List<string>();
        using (var cmd = new SqlCommand(sql, cn))
        {
            cmd.CommandType = CommandType.Text;
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                    valores.Add(reader.IsDBNull(0) ? null : Convert.ToString(reader.GetValue(0)));
            }
        }

        return TiposSolicitud.ProblemPrimero(TiposUnicos(valores));
    }

    // Normaliza, descarta vacios, deduplica sin distinguir mayusculas y
    // ordena (ordinal). Aparte de la consulta para poder probarla sin SQL.
    public static List<object> TiposUnicos(IEnumerable<string> valores)
    {
        var orden = new List<string>();
        foreach (var v in valores)
        {
            var n = DirectorioOrganizacional.Normaliza(v);
            if (n != null) orden.Add(n);
        }
        orden.Sort(string.CompareOrdinal);

        var vistos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var salida = new List<object>();
        foreach (var v in orden)
            if (vistos.Add(v)) salida.Add(v);
        return salida;
    }

    /* El TipoIniciativa de cada folio, para el filtro "Tipo de iniciativa"
       del registro (ExperienciaQueries.RegistroIniciativas). La misma
       columna y el mismo universo que TiposIniciativa; cada valor sale con la
       grafia que publica ese catalogo, asi que las opciones del filtro son
       valores de esa lista. Folios sin tipo no entran. Solo lectura. */
    public static Dictionary<string, string> TiposIniciativaPorFolio(SqlConnection cn)
    {
        const string sql = @"
SELECT Codigo, TipoIniciativa
FROM dbo.Problem
WHERE VigenteEnOrigen = 1
  AND TipoIniciativa IS NOT NULL;";

        var pares = new List<KeyValuePair<string, string>>();
        using (var cmd = new SqlCommand(sql, cn))
        {
            cmd.CommandType = CommandType.Text;
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                    pares.Add(new KeyValuePair<string, string>(
                        reader.IsDBNull(0) ? null : Convert.ToString(reader.GetValue(0)),
                        reader.IsDBNull(1) ? null : Convert.ToString(reader.GetValue(1))));
            }
        }

        return TiposPorFolio(pares);
    }

    // Folio -> tipo, normalizado y con la grafia de TiposUnicos. El primer
    // tipo de un folio repetido gana. Aparte de la consulta para probarla
    // sin SQL.
    public static Dictionary<string, string> TiposPorFolio(IEnumerable<KeyValuePair<string, string>> pares)
    {
        var lista = new List<KeyValuePair<string, string>>(pares);
        var grafia = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string t in TiposUnicos(lista.ConvertAll(p => p.Value))) grafia[t] = t;

        var salida = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in lista)
        {
            var tipo = DirectorioOrganizacional.Normaliza(p.Value);
            if (string.IsNullOrEmpty(p.Key) || tipo == null || salida.ContainsKey(p.Key)) continue;
            salida[p.Key] = grafia[tipo];
        }
        return salida;
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
