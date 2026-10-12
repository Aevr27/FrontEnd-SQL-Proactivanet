// Alta de una categoria REAL en Proactivanet (Admin -> Administracion).
// PREPARACION, SIN LLAMADA EXTERNA: valida contra el espejo local
// (dbo.Categorias) y arma el cuerpo que se mandaria; NO hay cliente HTTP en
// este archivo ni en su handler (handlers/admin_categorias_alta.ashx).
//
// NO ES EL MAPEO DE DUENOS. Crear la categoria (Proactivanet) y asignarle
// duenos (dbo.CatCategoriaDueno, admin/categorias-duenos.js) son dos
// operaciones distintas; esta no toca duenos.
//
// CONTRATO DOCUMENTADO (API.html local, 2026-08-24, repo Integracion_SQL)
//   POST /api/Categories   cuerpo Models.CategoryDTO:
//     Name, Description, Sort (int32), PadCategories_id (uuid),
//     AppliesToIncidents, AppliesToProblems, AppliesToRFCs, AppliesToKB,
//     Inactive (bool)
//   200 Models.Category (con Id y Path) | 400 | 401 | 500.
//   Autenticacion: header Authorization (token). La documentacion no dice
//   que campos son obligatorios ni que pasa con un nombre repetido.
//
// LO QUE FALTA PARA ENVIAR (bloqueos, ver Bloqueos)
//   - Base URL y ambiente de prueba confirmados; aprobacion explicita.
//   - Credencial con permiso de ESCRITURA de categorias (el ETL actual solo
//     lee /api/consultas con PVNET_API_TOKEN; no hay evidencia de permiso de
//     alta).
//   - PadCategories_id: dbo.Categorias tiene VARIOS Id por ruta (sql/diag_*);
//     no esta verificado que alguno sea el uuid de Proactivanet. Habria que
//     resolverlo con GET /api/Categories?Path=<padre> (otra llamada externa).
//   - Obligatorios y duplicados de la API sin documentar.
//   - dbo.Categorias es espejo: la categoria nueva aparece aqui solo cuando
//     la carga la traiga.
//
// Todo se prueba sin IIS, SQL ni red: tools/tests/AltaCategoriaSmoke.cs.
// Solo ASCII (App_Code sin BOM): acentos con \uXXXX.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Globalization;
using System.Text.RegularExpressions;

public static class IntegracionCategoriasProactivanet
{
    // Constante, no configuracion: encenderla es un cambio de codigo con su
    // cliente HTTP revisado.
    public const bool Habilitada = false;

    public const string Metodo = "POST";
    public const string Ruta = "/api/Categories";

    public const string Motivo =
        "Integraci\u00f3n con Proactivanet no habilitada: se valid\u00f3 contra el cat\u00e1logo local, " +
        "pero no se envi\u00f3 nada ni se cre\u00f3 la categor\u00eda.";

    public static readonly string[] Bloqueos =
    {
        "base URL y ambiente de prueba de la API sin confirmar; falta aprobacion explicita para escribir",
        "sin credencial verificada con permiso de alta de categorias (el ETL solo lee /api/consultas)",
        "PadCategories_id: el Id de dbo.Categorias no esta verificado como el uuid de Proactivanet (hay varios Id por ruta)",
        "obligatorios y comportamiento ante duplicados de POST /api/Categories sin documentar",
        "dbo.Categorias es espejo de la carga: la categoria nueva no aparece aqui hasta la siguiente carga",
    };
}

public sealed class PeticionAltaCategoria
{
    public string Padre;        // ruta completa del padre; vacio = raiz (C1 nuevo)
    public string Nombre;
    public string Descripcion;
    public string Orden;        // texto; entero si viene
    public bool AplicaIncidentes, AplicaProblemas, AplicaCambios, AplicaKb;

    public static PeticionAltaCategoria DesdeFormulario(NameValueCollection f)
    {
        return new PeticionAltaCategoria
        {
            Padre = f["padre"], Nombre = f["nombre"], Descripcion = f["descripcion"], Orden = f["orden"],
            AplicaIncidentes = f["incidentes"] == "1", AplicaProblemas = f["problemas"] == "1",
            AplicaCambios = f["cambios"] == "1", AplicaKb = f["kb"] == "1",
        };
    }
}

// Una ruta del espejo local con su estado.
public sealed class RutaCategoria
{
    public string Ruta;
    public bool Activa;   // VigenteEnOrigen = 1 y Inactiva = 0
}

public sealed class ResultadoAltaCategoria
{
    public List<ErrorCampo> Errores = new List<ErrorCampo>();
    public List<string> Advertencias = new List<string>();
    public string RutaResultante;
    public Dictionary<string, object> Cuerpo;
    public bool CatalogoRevisado;

    public bool Valida { get { return Errores.Count == 0; } }

    public void Agregar(string campo, string mensaje) { Errores.Add(new ErrorCampo { Campo = campo, Mensaje = mensaje }); }

    public Dictionary<string, object> ComoJson()
    {
        var errores = new List<object>();
        foreach (var e in Errores)
            errores.Add(new Dictionary<string, object> { { "campo", e.Campo }, { "mensaje", e.Mensaje } });
        return new Dictionary<string, object>
        {
            { "valida", Valida },
            { "catalogo_revisado", CatalogoRevisado },
            { "errores", errores },
            { "advertencias", Advertencias },
            { "ruta_resultante", RutaResultante },
            // Lo que se MANDARIA; nunca se manda desde aqui.
            { "envio", Valida ? new Dictionary<string, object>
                {
                    { "metodo", IntegracionCategoriasProactivanet.Metodo },
                    { "ruta", IntegracionCategoriasProactivanet.Ruta },
                    { "cuerpo", Cuerpo },
                } : null },
            { "enviada", false },
            { "creada", false },
            { "integracion", "no_habilitada" },
            { "integracion_motivo", Valida ? IntegracionCategoriasProactivanet.Motivo : null },
            { "bloqueos", new List<string>(IntegracionCategoriasProactivanet.Bloqueos) },
        };
    }
}

public sealed class ValidadorAltaCategoria
{
    private static readonly Regex Entero = new Regex(@"^-?\d{1,9}$");

    private static string Limpio(string s)
    {
        s = DirectorioOrganizacional.Normaliza(s);
        return string.IsNullOrEmpty(s) ? null : s;
    }

    // Misma forma de comparar rutas que el resto del sitio: normalizada y
    // sin distinguir mayusculas; la "/" inicial y final no cuentan.
    public static string Llave(string ruta)
    {
        var r = Limpio(ruta);
        return r == null ? null : r.Trim('/').ToLowerInvariant();
    }

    public ResultadoAltaCategoria Formato(PeticionAltaCategoria p)
    {
        if (p == null) throw new ArgumentNullException("p");
        var r = new ResultadoAltaCategoria();
        var nombre = Limpio(p.Nombre);
        if (nombre == null) r.Agregar("nombre", "Falta el nombre de la categor\u00eda.");
        else if (nombre.IndexOf('/') >= 0)
            r.Agregar("nombre", "El nombre no puede llevar \"/\": es el separador de la ruta de categor\u00edas.");
        var orden = Limpio(p.Orden);
        if (orden != null && !Entero.IsMatch(orden))
            r.Agregar("orden", "El orden debe ser un n\u00famero entero.");
        return r;
    }

    // rutas: TODAS las del espejo local (activas o no).
    public ResultadoAltaCategoria Validar(PeticionAltaCategoria p, IEnumerable<RutaCategoria> rutas)
    {
        var r = Formato(p);
        r.CatalogoRevisado = true;
        var porLlave = new Dictionary<string, bool>(StringComparer.Ordinal);   // llave -> alguna activa
        foreach (var x in rutas ?? new RutaCategoria[0])
        {
            var k = Llave(x.Ruta);
            if (k == null) continue;
            bool activa;
            porLlave[k] = (porLlave.TryGetValue(k, out activa) && activa) || x.Activa;
        }

        var padre = Limpio(p.Padre);
        var llavePadre = Llave(padre);
        if (padre == null)
            r.Advertencias.Add("Sin categor\u00eda padre: se crear\u00eda un C1 nuevo, sin due\u00f1os hasta capturarlos.");
        else
        {
            bool activo;
            if (!porLlave.TryGetValue(llavePadre, out activo))
                r.Agregar("padre", "La categor\u00eda padre no est\u00e1 en el cat\u00e1logo local.");
            else if (!activo)
                r.Agregar("padre", "La categor\u00eda padre est\u00e1 dada de baja.");
        }

        var nombre = Limpio(p.Nombre);
        if (r.Valida && nombre != null)
        {
            r.RutaResultante = (padre == null ? "" : "/" + padre.Trim('/')) + "/" + nombre;
            bool activa;
            if (porLlave.TryGetValue(Llave(r.RutaResultante), out activa))
            {
                if (activa) r.Agregar("nombre", "Ya existe una categor\u00eda activa con esa ruta: " + r.RutaResultante + ".");
                else r.Advertencias.Add("Existe una categor\u00eda dada de baja con esa ruta; la API no documenta si la duplica o la rechaza.");
            }
        }

        if (!p.AplicaIncidentes && !p.AplicaProblemas && !p.AplicaCambios && !p.AplicaKb)
            r.Advertencias.Add("No se marc\u00f3 a qu\u00e9 aplica (incidentes, problemas, cambios, KB).");

        if (r.Valida)
        {
            var orden = Limpio(p.Orden);
            r.Cuerpo = new Dictionary<string, object>
            {
                { "Name", nombre },
                { "Description", Limpio(p.Descripcion) },
                { "Sort", orden == null ? (object)null : int.Parse(orden, CultureInfo.InvariantCulture) },
                // Sin resolver: ver Bloqueos. Nunca se inventa un uuid.
                { "PadCategories_id", null },
                { "PadCategories_ruta", padre == null ? null : "/" + padre.Trim('/') },
                { "AppliesToIncidents", p.AplicaIncidentes },
                { "AppliesToProblems", p.AplicaProblemas },
                { "AppliesToRFCs", p.AplicaCambios },
                { "AppliesToKB", p.AplicaKb },
                { "Inactive", false },
            };
        }
        return r;
    }
}
