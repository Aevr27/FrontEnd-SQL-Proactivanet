// Catalogo de dueños por categoria TAL COMO ESTA CAPTURADO, para la pantalla
// de Admin "Dueños de categoria" (admin/categorias-duenos.js). SOLO LECTURA.
//
// A diferencia de AsignacionesVigentes (que da los dueños ya resueltos y
// solo de las filas completas), aqui va cada fila de dbo.CatCategoriaDueno
// con lo que tiene CAPTURADO y, aparte, lo que resuelve el sitio, para que
// la pantalla distinga un dueño propio de uno heredado del C1 y muestre lo
// que falta o no cuadra:
//
//   { "duenos": [ { "n2", "c1", "po", "so", "director",        (capturado, null = vacio)
//                   "resuelto": { "po", "so", "director" },     (DirectorioOrganizacional.Resolver)
//                   "fuente_c1",                                 (N2 de la fila de la que hereda su C1, o null)
//                   "vigente",                                   (VigenteEnOrigen = 1)
//                   "usada" } ],                                 (es la fila que el directorio usa para ese N2)
//     "personas": [ { "nombre", "rol", "manager" } ] }           (dbo.CatPersona vigentes)
//
// La regla de herencia NO se reescribe aqui: los valores resueltos son los
// de Resolver y la fuente es FuenteDeC1, la misma fila que Resolver usa.
// Los correos de CatPersona no viajan: la pantalla no los necesita.
//
// TODAS las filas (vigentes o no), como LeerDuenos: una fila dada de baja
// sigue resolviendo dueños (ver el comentario de LeerDuenos) y la pantalla
// tiene que poder mostrarla.
//
// Lo usa handlers/admin_iniciativas_catalogos.ashx?duenos=1. Nada escribe.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;

public static class CatalogoDuenosCategoria
{
    public sealed class Persona
    {
        public string Nombre;
        public string Rol;
        public string Manager;
    }

    // filas: las MISMAS que recibio el constructor de `dir` (ya normalizadas
    // por el). Orden: por N2, ordinal.
    public static Dictionary<string, object> Armar(
        List<DirectorioOrganizacional.Dueno> filas, DirectorioOrganizacional dir, List<Persona> personas)
    {
        var orden = new List<DirectorioOrganizacional.Dueno>();
        foreach (var d in filas ?? new List<DirectorioOrganizacional.Dueno>())
            if (d != null && d.CategoriaN2 != null) orden.Add(d);
        // List.Sort no es estable: con un N2 repetido (tras normalizar), la
        // fila que usa el directorio va primero y despues las demas en el
        // orden en que llegaron.
        var posicion = new Dictionary<DirectorioOrganizacional.Dueno, int>();
        for (int k = 0; k < orden.Count; k++) posicion[orden[k]] = k;
        orden.Sort(delegate (DirectorioOrganizacional.Dueno a, DirectorioOrganizacional.Dueno b)
        {
            int c = string.CompareOrdinal(a.CategoriaN2, b.CategoriaN2);
            if (c != 0) return c;
            bool ua = object.ReferenceEquals(dir.Categoria(a.CategoriaN2), a);
            bool ub = object.ReferenceEquals(dir.Categoria(b.CategoriaN2), b);
            if (ua != ub) return ua ? -1 : 1;
            return posicion[a].CompareTo(posicion[b]);
        });

        var duenos = new List<object>();
        foreach (var d in orden)
        {
            string po, so, director, manager;
            dir.Resolver(d.C1, d.CategoriaN2, out po, out so, out director, out manager);
            var fuente = dir.FuenteDeC1(d.C1);

            var resuelto = new Dictionary<string, object>();
            resuelto["po"] = po;
            resuelto["so"] = so;
            resuelto["director"] = director;

            var f = new Dictionary<string, object>();
            f["n2"] = d.CategoriaN2;
            f["c1"] = d.C1;
            f["po"] = d.Po;
            f["so"] = d.So;
            f["director"] = d.Director;
            f["resuelto"] = resuelto;
            f["fuente_c1"] = fuente == null ? null : fuente.CategoriaN2;
            f["vigente"] = d.Vigente;
            f["usada"] = object.ReferenceEquals(dir.Categoria(d.CategoriaN2), d);
            duenos.Add(f);
        }

        var lista = new List<object>();
        var vistos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ordenadas = new List<Persona>();
        foreach (var p in personas ?? new List<Persona>())
            if (p != null && p.Nombre != null && vistos.Add(p.Nombre)) ordenadas.Add(p);
        ordenadas.Sort(delegate (Persona a, Persona b) { return string.CompareOrdinal(a.Nombre, b.Nombre); });
        foreach (var p in ordenadas)
        {
            var x = new Dictionary<string, object>();
            x["nombre"] = p.Nombre;
            x["rol"] = p.Rol;
            x["manager"] = p.Manager;
            lista.Add(x);
        }

        var salida = new Dictionary<string, object>();
        salida["duenos"] = duenos;
        salida["personas"] = lista;
        return salida;
    }

    // dbo.CatPersona vigentes, nombres normalizados como el directorio.
    public static List<Persona> LeerPersonas(SqlConnection cn)
    {
        const string SQL =
            "SELECT Nombre, Rol, Manager FROM dbo.CatPersona WHERE VigenteEnOrigen = 1";

        var salida = new List<Persona>();
        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                var p = new Persona();
                p.Nombre = DirectorioOrganizacional.Normaliza(Texto(rd.GetValue(0)));
                p.Rol = DirectorioOrganizacional.Normaliza(Texto(rd.GetValue(1)));
                p.Manager = DirectorioOrganizacional.Normaliza(Texto(rd.GetValue(2)));
                if (p.Nombre != null) salida.Add(p);
            }
        }
        return salida;
    }

    private static string Texto(object v)
    {
        if (v == null || v is DBNull) return null;
        var s = Convert.ToString(v);
        return string.IsNullOrEmpty(s) ? null : s;
    }
}
