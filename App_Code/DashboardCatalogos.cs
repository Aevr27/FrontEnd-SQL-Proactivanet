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
//   PrefijosIniciativa()  dbo.CatPrefijoProblem   Tipo de iniciativa de
//                                                  Admin / Iniciativas
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
    // Admin / Iniciativas: tipos de iniciativa = dbo.CatPrefijoProblem
    // ---------------------------------------------------------------------

    /* El catalogo de "Tipo de iniciativa" de Admin (Nueva solicitud y filtro
       del registro): dbo.CatPrefijoProblem. Llave = Prefijo (el que lleva el
       Codigo: "PRB 2026-000001"); texto = Descripcion.

       NO es dbo.Problem.TipoIniciativa. El diagnostico de la VM
       (sql/diag_admin_roles_tipos_historial.sql, 2026-10-05) mostro que
       Prefijo y TipoIniciativa no son uno a uno (71 de 933 vigentes
       difieren) y que sus textos no coinciden con Descripcion. Aqui no se
       traduce uno al otro, y Experiencia sigue leyendo lo suyo.

       Salen TODAS las filas, aunque ningun Problem use ese prefijo. Orden:
       Problem (PRB) primero y el resto por Descripcion. Solo lectura, sobre
       la conexion que ya abrio quien llama. */
    public static List<object> PrefijosIniciativa(SqlConnection cn)
    {
        const string sql = @"
SELECT Prefijo, Descripcion
FROM dbo.CatPrefijoProblem;";

        return PrefijosOrdenados(Pares(cn, sql));
    }

    // Lo de arriba sin SQL -> [{ "prefijo", "nombre" }]. El prefijo va sin
    // espacios a los lados; vacio se descarta; repetido (sin distinguir
    // mayusculas) se queda el primero. Sin Descripcion, el texto es el
    // propio prefijo.
    public static List<object> PrefijosOrdenados(IEnumerable<KeyValuePair<string, string>> pares)
    {
        var vistos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var filas = new List<KeyValuePair<string, string>>();
        foreach (var p in pares)
        {
            var prefijo = p.Key == null ? null : p.Key.Trim();
            if (string.IsNullOrEmpty(prefijo) || !vistos.Add(prefijo)) continue;
            var nombre = p.Value == null ? null : p.Value.Trim();
            filas.Add(new KeyValuePair<string, string>(prefijo, string.IsNullOrEmpty(nombre) ? prefijo : nombre));
        }

        filas.Sort(delegate (KeyValuePair<string, string> a, KeyValuePair<string, string> b)
        {
            var pa = TiposSolicitud.EsProblem(a.Key) ? 0 : 1;
            var pb = TiposSolicitud.EsProblem(b.Key) ? 0 : 1;
            if (pa != pb) return pa - pb;
            var c = string.Compare(a.Value, b.Value, StringComparison.OrdinalIgnoreCase);
            return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key);
        });

        var salida = new List<object>();
        foreach (var f in filas)
            salida.Add(new Dictionary<string, object> { { "prefijo", f.Key }, { "nombre", f.Value } });
        return salida;
    }

    // Solo las llaves (Prefijo) de PrefijosOrdenados, en su orden: lo que el
    // servidor acepta como Tipo de iniciativa.
    public static List<object> Llaves(IEnumerable<object> prefijos)
    {
        var salida = new List<object>();
        foreach (var o in prefijos ?? new object[0])
        {
            var d = o as IDictionary<string, object>;
            var p = d == null ? null : d["prefijo"] as string;
            if (!string.IsNullOrEmpty(p)) salida.Add(p);
        }
        return salida;
    }

    /* El Prefijo de cada folio vigente (dbo.Problem.Prefijo, que coincide
       con el Codigo en 933/933), para filtrar el registro por el catalogo
       de arriba. Solo lectura. */
    public static Dictionary<string, string> PrefijosPorFolio(SqlConnection cn)
    {
        const string sql = @"
SELECT Codigo, Prefijo
FROM dbo.Problem
WHERE VigenteEnOrigen = 1
  AND Prefijo IS NOT NULL;";

        return PrefijoPorFolio(Pares(cn, sql));
    }

    // Folio -> prefijo sin espacios a los lados; el primero de un folio
    // repetido gana; folio o prefijo vacios se descartan.
    public static Dictionary<string, string> PrefijoPorFolio(IEnumerable<KeyValuePair<string, string>> pares)
    {
        var salida = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in pares)
        {
            var prefijo = p.Value == null ? null : p.Value.Trim();
            if (string.IsNullOrEmpty(p.Key) || string.IsNullOrEmpty(prefijo) || salida.ContainsKey(p.Key)) continue;
            salida[p.Key] = prefijo;
        }
        return salida;
    }

    // Dos columnas de texto -> pares (NULL -> null).
    private static List<KeyValuePair<string, string>> Pares(SqlConnection cn, string sql)
    {
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
        return pares;
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
