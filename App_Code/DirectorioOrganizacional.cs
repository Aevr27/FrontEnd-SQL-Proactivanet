// Directorio organizacional del tablero: quien es el dueño de cada categoria
// (Director, Product Owner, Service Owner) y a que Manager reporta cada
// Service Owner.
//
// Es la UNICA resolucion de dueños del sitio. Nacio dentro de
// ExperienciaQueries (la clase privada Directorio) y se saco de ahi sin
// cambiar una regla, para que cualquier otra pestaña que necesite los dueños
// de un ticket o de una categoria -QARE, por ejemplo- use esta y no escriba
// una segunda copia que con el tiempo diga otra cosa.
//
// DE DONDE SALE
// -------------
//   dueños por categoria   dbo.CatCategoriaDueno (CategoriaN2, C1,
//                          ProductOwner, ServiceOwner, DirectorPO)
//   manager de cada SO     dbo.CatPersona (Nombre, Manager)
//
// LA REGLA
// --------
// Los dueños de una categoria salen primero de su C1&C2 exacto y, si no esta
// capturado, se heredan de su C1. Es la misma regla del COALESCE de
// dbo.vw_ProblemCategoria. El Manager no se captura por categoria: es el
// Manager de su Service Owner en CatPersona (jerarquia independiente de la de
// Director / PO).
//
// La llave de una categoria es la ruta C1 / C1&C2 que sale de
// dbo.fn_CategoriaC1 / fn_CategoriaC1C2, normalizada como
// dbo.fn_NormalizaCategoria (ver Normaliza). Quien consulte tickets tiene que
// traer esas dos columnas de la base -las vistas vw_TicketsSlotsBase /
// vw_TicketsMesBase ya las exponen- y llamar a Resolver.
//
// LO QUE NO HACE
// --------------
// No sabe nada de fechas, periodos, volumen ni estados: eso es de cada
// pestaña. Solo identidad (nombres normalizados) y relaciones.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;

public sealed class DirectorioOrganizacional
{
    // Una fila de dbo.CatCategoriaDueno.
    public sealed class Dueno
    {
        public string CategoriaN2;
        public string C1;
        public string Po;
        public string So;
        public string Director;
        public bool Vigente;      // VigenteEnOrigen = 1 (ver LeerDuenos)
    }

    // Espacio duro (U+00A0). Va por codigo de caracter y no como literal
    // para que ningun editor lo confunda con un espacio normal.
    private const char NBSP = ' ';

    private readonly Dictionary<string, Dueno> _porN2;
    private readonly Dictionary<string, Dueno> _porC1;
    private readonly Dictionary<string, string> _managerDe;

    // Lee los dos catalogos sobre una conexion ya abierta.
    public static DirectorioOrganizacional Cargar(SqlConnection cn)
    {
        return new DirectorioOrganizacional(LeerDuenos(cn), LeerPersonas(cn));
    }

    public DirectorioOrganizacional(List<Dueno> duenos, Dictionary<string, string> personas)
    {
        _porN2 = new Dictionary<string, Dueno>(StringComparer.OrdinalIgnoreCase);
        _porC1 = new Dictionary<string, Dueno>(StringComparer.OrdinalIgnoreCase);
        _managerDe = personas;

        // Llaves y nombres se normalizan como las rutas (Normaliza). Las
        // rutas de categoria ya llegan asi (vistas de volumen e
        // iniciativas); el catalogo de dueños, no necesariamente: un espacio
        // de sobra o un NBSP en CategoriaN2 -que el "=" de SQL si perdona-
        // dejaba al N2 sin cruzar con su categoria, y en un nombre daba dos
        // Directores/PO "distintos" en los selects, o un Service Owner sin su
        // fila en CatPersona.
        foreach (var d in duenos)
        {
            d.CategoriaN2 = Normaliza(d.CategoriaN2);
            d.C1 = Normaliza(d.C1);
            d.Po = Normaliza(d.Po);
            d.So = Normaliza(d.So);
            d.Director = Normaliza(d.Director);

            if (d.CategoriaN2 != null && !_porN2.ContainsKey(d.CategoriaN2))
                _porN2[d.CategoriaN2] = d;
            if (d.C1 != null && !_porC1.ContainsKey(d.C1))
                _porC1[d.C1] = d;
        }
    }

    // ------------------------------------------------------------------
    // Resolucion
    // ------------------------------------------------------------------

    // Los dueños de una categoria: N2 exacto y, si no, heredados del C1.
    // c1c2 puede venir null (una categoria C1 no tiene N2 propio).
    public void Resolver(string c1, string c1c2,
                         out string po, out string so, out string director, out string manager)
    {
        Dueno n2 = null, raiz = null;
        c1c2 = Normaliza(c1c2);
        c1 = Normaliza(c1);
        if (c1c2 != null) _porN2.TryGetValue(c1c2, out n2);
        if (c1 != null) _porC1.TryGetValue(c1, out raiz);

        po = Primero(n2 == null ? null : n2.Po, raiz == null ? null : raiz.Po);
        so = Primero(n2 == null ? null : n2.So, raiz == null ? null : raiz.So);
        director = Primero(n2 == null ? null : n2.Director, raiz == null ? null : raiz.Director);
        manager = ManagerDe(so);
    }

    // El Manager de una persona segun dbo.CatPersona, o null.
    public string ManagerDe(string persona)
    {
        string m;
        persona = Normaliza(persona);
        if (persona != null && _managerDe.TryGetValue(persona, out m))
            return m;
        return null;
    }

    // Una fila por N2 capturado, ya normalizada.
    public IEnumerable<Dueno> Duenos()
    {
        return _porN2.Values;
    }

    // ------------------------------------------------------------------
    // Catalogos de los selects
    // ------------------------------------------------------------------

    // Las cuatro llaves que llenan los selects de personas:
    //
    //   directores     Directores con al menos un PO vigente
    //   managers       Managers con al menos un SO vigente
    //   jerarquia      Director -> sus Product Owners
    //   jerarquia_mgr  Manager  -> sus Service Owners
    //
    // Todo ordenado con comparacion ordinal. Solo filas vigentes: una
    // categoria dada de baja resuelve sus dueños (LeerDuenos), pero no mete
    // en los selects a un Director o PO que ya solo existe en ella.
    public Dictionary<string, object> Catalogos()
    {
        // jerarquia: Director -> sus Product Owners (los dos selects
        // encadenados de arriba del tablero).
        var jerarquia = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);
        foreach (var d in Duenos())
        {
            if (!d.Vigente) continue;
            if (string.IsNullOrEmpty(d.Director) || string.IsNullOrEmpty(d.Po)) continue;
            SortedSet<string> pos;
            if (!jerarquia.TryGetValue(d.Director, out pos))
            {
                pos = new SortedSet<string>(StringComparer.Ordinal);
                jerarquia[d.Director] = pos;
            }
            pos.Add(d.Po);
        }

        // jerarquia_mgr: Manager -> sus Service Owners. Es una jerarquia
        // aparte (sale de CatPersona, no del catalogo de categorias) y el
        // tablero la combina con la otra por AND.
        var jerarquiaMgr = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);
        foreach (var d in Duenos())
        {
            if (!d.Vigente) continue;
            if (string.IsNullOrEmpty(d.So)) continue;
            var manager = ManagerDe(d.So);
            if (string.IsNullOrEmpty(manager)) continue;
            SortedSet<string> sos;
            if (!jerarquiaMgr.TryGetValue(manager, out sos))
            {
                sos = new SortedSet<string>(StringComparer.Ordinal);
                jerarquiaMgr[manager] = sos;
            }
            sos.Add(d.So);
        }

        var salida = new Dictionary<string, object>();
        salida["directores"] = Ordenadas(jerarquia.Keys);
        salida["managers"] = Ordenadas(jerarquiaMgr.Keys);
        salida["jerarquia"] = Aplanar(jerarquia);
        salida["jerarquia_mgr"] = Aplanar(jerarquiaMgr);
        return salida;
    }

    // ------------------------------------------------------------------
    // Lectura
    // ------------------------------------------------------------------

    // QUE FILAS SE LEEN
    // -----------------
    // TODAS, vigentes o no, porque es lo que hace dbo.vw_ProblemCategoria:
    // su LEFT JOIN a CatCategoriaDueno no filtra VigenteEnOrigen. Cuando una
    // categoria se desactiva, el ETL marca sus filas de dueño como no
    // vigentes, pero la vista le sigue dando esos dueños a sus iniciativas.
    // Con el filtro, el tablero dejaba la categoria sin dueño: la iniciativa
    // pintaba "PO X" y desaparecia al filtrar por X (PRB 2026-000172 en
    // /S-Precios y Promociones, las seis filas en VigenteEnOrigen = 0).
    //
    // Las vigentes van primero dentro de su C1: si hay de las dos, hereda y
    // cruza la vigente. Las no vigentes resuelven dueños, pero NO alimentan
    // los selects de Director / PO / Manager (ver Catalogos).
    //
    // El ORDER BY no es cosmetico. El directorio se queda con la PRIMERA fila
    // de cada C1 para heredar dueños a un N2 sin fila propia -el caso de toda
    // categoria nueva-, y si ese C1 tiene hermanos con dueños distintos, sin
    // orden la herencia dependia del plan de ejecucion.
    //
    // Nombres y llaves se normalizan en el constructor, no aqui.
    public static List<Dueno> LeerDuenos(SqlConnection cn)
    {
        const string SQL =
            "SELECT CategoriaN2, C1, ProductOwner, ServiceOwner, DirectorPO, " +
            "       Vigente = CASE WHEN VigenteEnOrigen = 1 THEN 1 ELSE 0 END " +
            "FROM dbo.CatCategoriaDueno " +
            "ORDER BY C1, CASE WHEN VigenteEnOrigen = 1 THEN 0 ELSE 1 END, CategoriaN2";

        var filas = new List<Dueno>();

        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                var d = new Dueno();
                d.CategoriaN2 = Texto(rd.GetValue(0));
                d.C1 = Texto(rd.GetValue(1));
                d.Po = Texto(rd.GetValue(2));
                d.So = Texto(rd.GetValue(3));
                d.Director = Texto(rd.GetValue(4));
                d.Vigente = Entero(rd.GetValue(5)) == 1;
                filas.Add(d);
            }
        }

        return filas;
    }

    // Nombre -> su manager. El Manager se deriva del Service Owner
    // (jerarquia independiente de la de Director/PO); en el modelo eso es la
    // hoja Equipo, o sea dbo.CatPersona.
    public static Dictionary<string, string> LeerPersonas(SqlConnection cn)
    {
        const string SQL =
            "SELECT Nombre, Manager FROM dbo.CatPersona WHERE VigenteEnOrigen = 1";

        var mapa = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                // Mismo recorte que el constructor aplica a los nombres de
                // CatCategoriaDueno: el Service Owner de la categoria tiene
                // que encontrar su fila aqui.
                var nombre = Normaliza(Texto(rd.GetValue(0)));
                if (nombre == null) continue;
                mapa[nombre] = Normaliza(Texto(rd.GetValue(1)));
            }
        }

        return mapa;
    }

    // ------------------------------------------------------------------
    // Identidad
    // ------------------------------------------------------------------

    // Replica de dbo.fn_NormalizaCategoria:
    //
    //     LTRIM(RTRIM(REPLACE(ISNULL(@c, ''), NCHAR(160), ' ')))
    //
    // o sea: el espacio duro pasa a espacio normal y se recortan los
    // espacios de los extremos (LTRIM/RTRIM de T-SQL recortan ESPACIOS, no
    // cualquier blanco, de ahi el Trim(' ') y no el Trim() pelado).
    //
    // Es la definicion de identidad de una categoria en todo el tablero: la
    // columna [Categoria V2] de las vistas de volumen es exactamente esto
    // aplicado a Tickets.Categoria, y fn_CategoriaC1 / fn_CategoriaC1C2
    // empiezan por llamarla. Tambien es la de un nombre de persona del
    // directorio. Es idempotente: un valor ya normalizado sale igual que
    // entro.
    //
    // Se devuelve null en vez de cadena vacia.
    public static string Normaliza(string valor)
    {
        if (valor == null) return null;
        var limpia = valor.Replace(NBSP, ' ').Trim(' ');
        return limpia.Length == 0 ? null : limpia;
    }

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    private static string Primero(string a, string b)
    {
        return string.IsNullOrEmpty(a) ? b : a;
    }

    private static Dictionary<string, object> Aplanar(Dictionary<string, SortedSet<string>> origen)
    {
        var salida = new Dictionary<string, object>();
        foreach (var kv in origen)
        {
            var lista = new List<object>();
            foreach (var v in kv.Value) lista.Add(v);
            salida[kv.Key] = lista;
        }
        return salida;
    }

    private static List<object> Ordenadas(IEnumerable<string> valores)
    {
        var orden = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var v in valores)
            if (!string.IsNullOrEmpty(v)) orden.Add(v);

        var salida = new List<object>();
        foreach (var v in orden) salida.Add(v);
        return salida;
    }

    private static string Texto(object v)
    {
        if (v == null || v is DBNull) return null;
        var s = Convert.ToString(v);
        return string.IsNullOrEmpty(s) ? null : s;
    }

    private static int Entero(object v)
    {
        if (v == null || v is DBNull) return 0;
        return Convert.ToInt32(v, CultureInfo.InvariantCulture);
    }
}
