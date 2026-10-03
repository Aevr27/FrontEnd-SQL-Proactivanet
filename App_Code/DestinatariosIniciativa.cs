// Destinatarios CANDIDATOS de un futuro aviso de iniciativa. SOLO LECTURA y
// sin enviar nada: es lo que muestra handlers/admin_iniciativas_diagnostico.ashx
// para revisar, con datos reales, a quien le llegaria el correo antes de
// decidir las reglas de Para / CC.
//
//   solicitante     identidad Windows -> cuenta@soriana.com ->
//                   DirectorioPersonas.BuscarPorCorreo (nombre, correo,
//                   Manager de CatPersona y el correo del Manager)
//   categoria       N2 elegida -> DirectorioOrganizacional (Director, PO, SO
//                   con la regla N2 -> C1) -> correo de PO y SO por nombre
//   SO -> PO        las combinaciones que EXISTEN en CatCategoriaDueno
//                   (ProductOwnersDe). Si hay mas de un PO, "ambiguo" y van
//                   todos: no se escoge ninguno.
//   Lider del SO    sin regla confirmada: solo se muestran las filas de
//                   CatLiderGrupo donde aparece el SO, como evidencia.
//
// Nada de esto decide quien entra al modulo (eso es AccesoAdmin).

using System.Collections.Generic;
using System.Data.SqlClient;

public sealed class DestinatariosIniciativa
{
    public const string SinReglaConfirmada = "sin_regla_confirmada";

    private readonly IdentidadWindows _identidad;
    private readonly DirectorioPersonas _personas;
    private readonly DirectorioOrganizacional _org;

    public DestinatariosIniciativa(IdentidadWindows identidad, DirectorioPersonas personas,
                                   DirectorioOrganizacional org)
    {
        _identidad = identidad;
        _personas = personas;
        _org = org;
    }

    public static DestinatariosIniciativa Cargar(SqlConnection cn, IdentidadWindows identidad)
    {
        return new DestinatariosIniciativa(identidad, DirectorioPersonas.Cargar(cn),
                                           DirectorioOrganizacional.Cargar(cn));
    }

    // categoria: una CategoriaN2 de CatCategoriaDueno (la que elige Nueva
    // solicitud), opcional. so: un Service Owner a revisar, opcional; si no
    // viene se usa el de la categoria y, si tampoco, el propio solicitante.
    public Dictionary<string, object> Resolver(string categoria, string so)
    {
        var salida = new Dictionary<string, object>();

        var identidad = new Dictionary<string, object>();
        identidad["windows_identity"] = _identidad.Original;
        identidad["normalized_username"] = _identidad.Usuario;
        identidad["lookup_email_candidate"] = _identidad.CorreoCandidato();
        salida["identidad"] = identidad;

        var solicitante = _personas.BuscarPorCorreo(_identidad.CorreoCandidato());
        var dSolicitante = solicitante.ComoDiccionario();
        dSolicitante["manager_correo"] = solicitante.Manager == null
            ? null : _personas.CorreoDeNombre(solicitante.Manager);
        salida["solicitante"] = dSolicitante;

        string soCategoria = null;
        categoria = DirectorioOrganizacional.Normaliza(categoria);
        if (categoria != null)
        {
            var dCat = new Dictionary<string, object>();
            dCat["categoria"] = categoria;
            var fila = _org.Categoria(categoria);
            if (fila == null)
            {
                dCat["estado"] = DirectorioPersonas.NoEncontrado;
            }
            else
            {
                string po, soCat, director, manager;
                _org.Resolver(fila.C1, fila.CategoriaN2, out po, out soCat, out director, out manager);
                soCategoria = soCat;
                dCat["estado"] = DirectorioPersonas.Resuelto;
                dCat["vigente"] = fila.Vigente;
                dCat["director"] = director;
                dCat["product_owner"] = po;
                dCat["product_owner_correo"] = po == null ? null : _personas.CorreoDeNombre(po);
                dCat["service_owner"] = soCat;
                dCat["service_owner_correo"] = soCat == null ? null : _personas.CorreoDeNombre(soCat);
            }
            salida["categoria"] = dCat;
        }

        // Que Service Owner se revisa en SO -> PO y en Lider del SO.
        string origen;
        so = DirectorioOrganizacional.Normaliza(so);
        if (so != null) origen = "parametro so";
        else if (soCategoria != null) { so = soCategoria; origen = "service owner de la categoria"; }
        else if (solicitante.Nombre != null) { so = solicitante.Nombre; origen = "solicitante"; }
        else origen = null;

        salida["service_owner_a_product_owner"] = SoAPo(so, origen);
        salida["lider_so"] = LiderSo(so);
        return salida;
    }

    public Dictionary<string, object> SoAPo(string so, string origen)
    {
        var d = new Dictionary<string, object>();
        d["service_owner"] = so;
        d["origen"] = origen;
        d["product_owner"] = null;
        d["product_owner_correo"] = null;

        var pos = _org.ProductOwnersDe(so);
        var candidatos = new List<object>();
        foreach (var kv in pos)
        {
            var c = new Dictionary<string, object>();
            c["product_owner"] = kv.Key;
            c["categorias"] = new List<object>(kv.Value.ToArray());
            candidatos.Add(c);
        }
        d["candidatos"] = candidatos;

        if (pos.Count == 0) d["estado"] = DirectorioPersonas.NoEncontrado;
        else if (pos.Count > 1) d["estado"] = DirectorioPersonas.Ambiguo;
        else
        {
            foreach (var po in pos.Keys)
            {
                d["product_owner"] = po;
                d["product_owner_correo"] = _personas.CorreoDeNombre(po);
            }
            d["estado"] = DirectorioPersonas.Resuelto;
        }

        // Segunda fuente, SOLO informativa: CatPersona.ProductOwner de la
        // fila del SO. No entra en la decision (su significado no esta
        // confirmado); sirve para ver si coincide con CatCategoriaDueno.
        var catPersona = new List<object>();
        foreach (var p in _personas.PersonasConNombre(so))
            if (p.ProductOwner != null && !catPersona.Contains(p.ProductOwner)) catPersona.Add(p.ProductOwner);
        d["catpersona_product_owner"] = catPersona;
        return d;
    }

    public Dictionary<string, object> LiderSo(string so)
    {
        var d = new Dictionary<string, object>();
        d["service_owner"] = so;
        d["estado"] = SinReglaConfirmada;
        d["lider_so"] = null;
        d["lider_so_correo"] = null;
        d["evidencia_catlidergrupo"] = _personas.GruposDe(so);
        return d;
    }
}
