// Categorias REALES (ruta completa) que Nueva solicitud puede elegir, con
// sus dueños. La ruta es la LLAVE DE CAPACIDAD: cada ruta tiene su propio
// 100% (CapacidadCategoria), igual que dbo.ProblemCategoria.Categoria, que
// guarda la ruta completa (= Tickets.Categoria).
//
// DE DONDE SALE
// -------------
//   rutas    dbo.Categorias.RutaCompleta con VigenteEnOrigen = 1 y
//            Inactiva = 0 (la categoria "activa" del catalogo: el mismo
//            criterio de sql/diag_categorias_inactivas_candidatas.sql). Hay
//            varios Id por ruta: basta una fila activa. Se normalizan como
//            el resto del sitio (DirectorioOrganizacional.Normaliza).
//   dueños   DirectorioOrganizacional.Resolver con los cortes C1 / C1&C2 de
//            la ruta (ExperienciaQueries.CortesDeRuta): la regla del
//            COALESCE de dbo.vw_ProblemCategoria (N2 exacto y, si no,
//            heredado del C1). No hay ningun mapeo nuevo.
//
// Una ruta entra a la cascada si, ya resuelta, tiene Director, PO y SO, y
// la fila de dueños de la que salen es vigente (FuenteVigente). Las demas
// no se adivinan: se cuentan aparte.
//
// No se filtra por profundidad ni por AplicaAProblemas: ninguna regla
// verificada dice que solo ciertas rutas admitan iniciativas.
//
// SOLO LECTURA.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;

public static class CatalogoRutasIniciativa
{
    public static List<string> LeerRutasActivas(SqlConnection cn)
    {
        const string sql = @"
SELECT DISTINCT RutaCompleta
FROM dbo.Categorias
WHERE VigenteEnOrigen = 1
  AND ISNULL(Inactiva, 0) = 0
  AND RutaCompleta IS NOT NULL;";

        var rutas = new List<string>();
        using (var cmd = new SqlCommand(sql, cn))
        {
            cmd.CommandType = CommandType.Text;
            using (var rd = cmd.ExecuteReader())
                while (rd.Read())
                    rutas.Add(rd.IsDBNull(0) ? null : Convert.ToString(rd.GetValue(0)));
        }
        return rutas;
    }

    // { "rutas": [ {director, po, so, categoria (= la ruta)} ...],
    //   "rutas_sin_duenos": n, "rutas_duenos_no_vigentes": n }
    // Rutas normalizadas, unicas sin distinguir mayusculas (como compara la
    // capacidad), en orden ordinal.
    public static Dictionary<string, object> Asignaciones(IEnumerable<string> rutas, DirectorioOrganizacional dir)
    {
        var unicas = new List<string>();
        var vistas = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var limpias = new List<string>();
        foreach (var r in rutas ?? new string[0])
        {
            var n = DirectorioOrganizacional.Normaliza(r);
            if (n != null) limpias.Add(n);
        }
        limpias.Sort(string.CompareOrdinal);
        foreach (var n in limpias) if (vistas.Add(n)) unicas.Add(n);

        var filas = new List<object>();
        int sinDuenos = 0, noVigentes = 0;
        foreach (var ruta in unicas)
        {
            string c1, c1c2, po, so, director, manager;
            ExperienciaQueries.CortesDeRuta(ruta, out c1, out c1c2);
            dir.Resolver(c1, c1c2, out po, out so, out director, out manager);

            if (string.IsNullOrEmpty(po) || string.IsNullOrEmpty(so) || string.IsNullOrEmpty(director))
            {
                sinDuenos++;
                continue;
            }
            if (!dir.FuenteVigente(c1, c1c2))
            {
                noVigentes++;
                continue;
            }

            filas.Add(new Dictionary<string, object>
            {
                { "director", director }, { "po", po }, { "so", so }, { "categoria", ruta },
            });
        }

        return new Dictionary<string, object>
        {
            { "rutas", filas },
            { "rutas_sin_duenos", sinDuenos },
            { "rutas_duenos_no_vigentes", noVigentes },
        };
    }

    public static Dictionary<string, object> Cargar(SqlConnection cn, DirectorioOrganizacional dir)
    {
        return Asignaciones(LeerRutasActivas(cn), dir);
    }
}
