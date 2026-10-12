// Gestion directa de ADM sobre iniciativas (Admin -> Administracion):
// "Crear iniciativa" y "Modificar" del detalle del registro. CONTRATO Y
// VALIDACION EN EL SERVIDOR, SIN ESCRITURA.
//
//   handlers/admin_iniciativas_gestion.ashx         (HTTP, ExigirAdm)
//       -> PeticionCrearAdmin / PeticionModificarAdmin (lo que llego)
//       -> GestionIniciativaAdminService            (lee catalogo, capacidad
//                                                    y la iniciativa actual)
//       -> ValidadorGestionAdmin                    (las reglas, aqui, sin SQL)
//       -> PersistenciaGestionAdmin                 (hoy: NO habilitada)
//
// POR QUE NO GUARDA (bloqueo vigente, ver sql/diag_admin_alta_edicion.sql)
//   - El contrato de persistencia (2026-10-09) no esta aprobado.
//   - La identidad SQL del sitio y sus permisos reales no estan verificados
//     (Paso 0 se corrio con una cuenta db_owner, no con la del sitio).
//   - El cargador del Excel (usp_CargarExperiencia) reescribe las columnas de
//     dbo.Problem / dbo.ProblemCategoria y marca VigenteEnOrigen = 0 a lo que
//     no viene en el libro: una alta o un cambio hecho aqui se perderia o se
//     desactivaria en la siguiente carga mientras no haya cutover.
//   - Codigo: la forma observada es 'PPP AAAA-NNNNNN' (consecutivo por
//     prefijo y anio), pero el Excel sigue emitiendo codigos: no hay manera
//     de reservar uno sin choque hasta el cutover.
// Por eso PersistenciaGestionAdmin.Habilitada es una CONSTANTE false: no hay
// llave de configuracion que la encienda por accidente. Encenderla es un
// cambio de codigo revisado, con su escritor real.
//
// REGLAS (ADM; distintas de Nueva solicitud, que no se toca)
//   Crear     solo el Tipo es obligatorio (prefijo del codigo). PO, SO y
//             Categoria son opcionales, pero lo que venga tiene que existir en
//             el catalogo vigente y salir junto de una fila. El % es POR
//             CATEGORIA (dbo.ProblemCategoria): sin Categoria no hay donde
//             ponerlo. Lo que falte se informa como INCOMPLETA (marca
//             derivada, sin columna), no bloquea. La capacidad excedida es
//             advertencia, no error (ADM no pasa por las reglas de MOD).
//   Modificar Titulo, Descripcion, Observaciones del Problem y el % de las
//             categorias YA ligadas. Agregar/quitar categorias, fechas,
//             estado, RCA, codigo, tipo y duenos: fuera (ver
//             admin/iniciativa-admin.js, CAMPOS_EDICION). Sin cambios = error.
//
// Todo se prueba sin IIS ni base: tools/tests/GestionIniciativaAdminSmoke.cs.
// Solo ASCII en este archivo (App_Code sin BOM): acentos con \uXXXX.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Globalization;
using System.Text.RegularExpressions;

public static class PersistenciaGestionAdmin
{
    public const bool Habilitada = false;

    public const string Estado = "no_habilitada";

    public const string Motivo =
        "Persistencia no habilitada: la validaci\u00f3n pas\u00f3, pero no se guard\u00f3 nada. " +
        "Falta aprobar el contrato de escritura, verificar la cuenta SQL del sitio y " +
        "evitar que la carga del Excel pise o desactive lo creado aqu\u00ed.";

    public static readonly string[] Bloqueos =
    {
        "contrato de persistencia 2026-10-09 sin aprobar",
        "identidad SQL del sitio y sus permisos sin verificar",
        "carga del Excel (usp_CargarExperiencia) reescribe Problem/ProblemCategoria y desactiva lo que no viene en el libro",
        "codigo PPP AAAA-NNNNNN: el Excel sigue emitiendo; sin reserva sin choque hasta el cutover",
        "RCA: sin destino de almacenamiento; el archivo no se sube",
    };
}

public sealed class ErrorCampo
{
    public string Campo;
    public string Mensaje;
}

// Un % de una categoria tal como llego (texto en %, no fraccion).
public sealed class PctCategoria
{
    public string Categoria;
    public string Texto;
}

public sealed class PeticionModificarAdmin
{
    public const string CFolio = "folio";
    public const string CPctCategoria = "pct_categoria";
    public const string CPctValor = "pct_valor";

    public string Folio;
    // null = el campo no vino (no se cambia); "" = se vacia.
    public string Titulo;
    public string Descripcion;
    public string Observaciones;
    public List<PctCategoria> Pcts = new List<PctCategoria>();
    // Las listas pct_categoria / pct_valor no venian parejas.
    public bool PctsDesparejos;

    public static PeticionModificarAdmin DesdeFormulario(NameValueCollection f)
    {
        var p = new PeticionModificarAdmin
        {
            Folio = f[CFolio],
            Titulo = f[SolicitudIniciativa.CTitulo],
            Descripcion = f[SolicitudIniciativa.CDescripcion],
            Observaciones = f[SolicitudIniciativa.CObservaciones],
        };
        var cats = f.GetValues(CPctCategoria) ?? new string[0];
        var vals = f.GetValues(CPctValor) ?? new string[0];
        p.PctsDesparejos = cats.Length != vals.Length;
        for (var i = 0; i < Math.Min(cats.Length, vals.Length); i++)
            p.Pcts.Add(new PctCategoria { Categoria = cats[i], Texto = vals[i] });
        return p;
    }
}

public sealed class PeticionCrearAdmin
{
    public string Tipo, Po, So, Categoria, Titulo, Descripcion, Observaciones, Volumetria, Pct;
    public bool TieneRca;

    public static PeticionCrearAdmin DesdeFormulario(NameValueCollection f, bool tieneRca)
    {
        return new PeticionCrearAdmin
        {
            Tipo = f[SolicitudIniciativa.CTipo],
            Po = f[SolicitudIniciativa.CPo],
            So = f[SolicitudIniciativa.CSo],
            Categoria = f[SolicitudIniciativa.CCategoria],
            Titulo = f[SolicitudIniciativa.CTitulo],
            Descripcion = f[SolicitudIniciativa.CDescripcion],
            Observaciones = f[SolicitudIniciativa.CObservaciones],
            Volumetria = f[SolicitudIniciativa.CVolumetria],
            Pct = f[SolicitudIniciativa.CPct],
            TieneRca = tieneRca,
        };
    }
}

// Los valores ACTUALES de una iniciativa, de la misma lectura que pinta el
// registro (ExperienciaQueries.RegistroIniciativas): lo que ADM vio es lo
// que se compara.
public sealed class IniciativaActual
{
    public sealed class Categoria
    {
        public string Ruta;
        public decimal? Pct;   // fraccion, como PctDisminucion
    }

    public string Folio;
    public string Titulo;          // dbo.Problem.Titulo (titulo_problem)
    public string Descripcion;
    public string Observaciones;
    public bool SinCategoria;
    public List<Categoria> Categorias = new List<Categoria>();

    public static IniciativaActual DesdeRegistro(Dictionary<string, object> i)
    {
        if (i == null) return null;
        var a = new IniciativaActual
        {
            Folio = i.ContainsKey("folio") ? i["folio"] as string : null,
            Titulo = Texto(i, i.ContainsKey("titulo_problem") ? "titulo_problem" : "titulo"),
            Descripcion = Texto(i, "descripcion"),
            Observaciones = Texto(i, "observaciones"),
            SinCategoria = i.ContainsKey("sin_categoria") && i["sin_categoria"] is bool && (bool)i["sin_categoria"],
        };
        object cats;
        if (i.TryGetValue("categorias", out cats) && cats is System.Collections.IEnumerable)
        {
            foreach (var o in (System.Collections.IEnumerable)cats)
            {
                var c = o as Dictionary<string, object>;
                if (c == null) continue;
                decimal? pct = null;
                object v;
                if (c.TryGetValue("pct_dism", out v) && v != null)
                    pct = decimal.Round(Convert.ToDecimal(v, CultureInfo.InvariantCulture), 4);
                a.Categorias.Add(new Categoria { Ruta = c.ContainsKey("categoria") ? c["categoria"] as string : null, Pct = pct });
            }
        }
        return a;
    }

    private static string Texto(Dictionary<string, object> i, string k)
    {
        object v;
        return i.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
    }
}

public sealed class ResultadoGestionAdmin
{
    public string Accion;          // crear | modificar
    public string Folio;           // modificar: el de la iniciativa
    public List<ErrorCampo> Errores = new List<ErrorCampo>();
    public List<string> Advertencias = new List<string>();
    public List<Dictionary<string, object>> Cambios = new List<Dictionary<string, object>>();
    public List<Dictionary<string, object>> Faltantes = new List<Dictionary<string, object>>();
    public string Director;
    // false = solo se reviso el formato (no se consulto el catalogo).
    public bool CatalogoRevisado;

    public bool Valida { get { return Errores.Count == 0; } }

    public void Agregar(string campo, string mensaje) { Errores.Add(new ErrorCampo { Campo = campo, Mensaje = mensaje }); }

    public bool TieneError(string campo)
    {
        foreach (var e in Errores) if (e.Campo == campo) return true;
        return false;
    }

    public void Falta(string clave, string rotulo)
    {
        Faltantes.Add(new Dictionary<string, object> { { "clave", clave }, { "rotulo", rotulo } });
    }

    public void Cambio(string clave, string rotulo, string anterior, string nuevo)
    {
        Cambios.Add(new Dictionary<string, object>
        {
            { "clave", clave }, { "rotulo", rotulo }, { "anterior", anterior }, { "nuevo", nuevo },
        });
    }

    public Dictionary<string, object> ComoJson()
    {
        var errores = new List<object>();
        foreach (var e in Errores)
            errores.Add(new Dictionary<string, object> { { "campo", e.Campo }, { "mensaje", e.Mensaje } });
        return new Dictionary<string, object>
        {
            { "accion", Accion },
            { "folio", Folio },
            { "valida", Valida },
            { "catalogo_revisado", CatalogoRevisado },
            { "errores", errores },
            { "advertencias", Advertencias },
            { "cambios", Cambios },
            { "incompleta", Faltantes.Count > 0 },
            { "faltantes", Faltantes },
            { "director", Director },
            { "guardada", false },
            { "codigo", null },
            { "persistencia", PersistenciaGestionAdmin.Estado },
            // El motivo dice "la validacion paso": solo si de verdad paso.
            { "persistencia_motivo", Valida ? PersistenciaGestionAdmin.Motivo : null },
            { "bloqueos", new List<string>(PersistenciaGestionAdmin.Bloqueos) },
        };
    }
}

public sealed class ValidadorGestionAdmin
{
    // Mismas formas que FORMATO de admin/iniciativa-admin.js y que Nueva
    // solicitud (ValidadorIniciativa.Fraccion).
    private static readonly Regex Entero = new Regex(@"^\d+$");

    // Los de CAMPOS_INCOMPLETA de admin/iniciativa-admin.js, mismo orden.
    private static readonly string[][] CamposIncompleta =
    {
        new[] { "categoria", "Categor\u00eda" },
        new[] { "titulo", "T\u00edtulo" },
        new[] { "descripcion", "Descripci\u00f3n" },
        new[] { "observaciones", "Observaciones" },
        new[] { "volumetria", "Volumetr\u00eda" },
        new[] { "pct", "% Disminuci\u00f3n" },
        new[] { "rca", "RCA" },
    };

    private static string Limpio(string s)
    {
        if (s == null) return null;
        s = s.Trim();
        return s.Length == 0 ? null : s;
    }

    // Saltos de linea del navegador (\r\n) contra los de la base: no son un
    // cambio por si solos.
    private static string Normal(string s) { return (s ?? "").Replace("\r\n", "\n"); }

    public static string ComoPct(decimal? f)
    {
        return f == null ? "" : (f.Value * 100m).ToString("0.##", CultureInfo.InvariantCulture);
    }

    // ---------------------------------------------------------------------
    // Crear
    // ---------------------------------------------------------------------
    // Solo formato: lo que se decide sin catalogo. El handler lo corre ANTES
    // de abrir la base.
    public ResultadoGestionAdmin FormatoCrear(PeticionCrearAdmin p)
    {
        if (p == null) throw new ArgumentNullException("p");
        var r = new ResultadoGestionAdmin { Accion = "crear" };
        if (Limpio(p.Tipo) == null)
            r.Agregar(SolicitudIniciativa.CTipo, "Elige el Tipo de iniciativa: define el prefijo del c\u00f3digo.");
        var vol = Limpio(p.Volumetria);
        int n;
        if (vol != null && (!Entero.IsMatch(vol) || !int.TryParse(vol, NumberStyles.None, CultureInfo.InvariantCulture, out n)))
            r.Agregar(SolicitudIniciativa.CVolumetria, "La Volumetr\u00eda debe ser un n\u00famero entero, de 0 en adelante.");
        var pct = Limpio(p.Pct);
        if (pct != null && ValidadorIniciativa.Fraccion(pct) == null)
            r.Agregar(SolicitudIniciativa.CPct, "El % debe estar entre 0 y 100, con hasta dos decimales.");
        if (pct != null && Limpio(p.Categoria) == null)
            r.Agregar(SolicitudIniciativa.CPct, "El % es por categor\u00eda: elige la Categor\u00eda o deja el % vac\u00edo.");
        return r;
    }

    // tipoProblem: el prefijo de Problem en el catalogo (RCA), o null.
    public ResultadoGestionAdmin Crear(PeticionCrearAdmin p, CatalogoSolicitud catalogo,
                                       CapacidadCategoria capacidad, string tipoProblem)
    {
        if (catalogo == null) throw new ArgumentNullException("catalogo");
        if (capacidad == null) throw new ArgumentNullException("capacidad");
        var r = FormatoCrear(p);
        r.CatalogoRevisado = true;

        var tipo = Limpio(p.Tipo);
        if (tipo != null && !catalogo.TieneTipo(tipo))
            r.Agregar(SolicitudIniciativa.CTipo, "El Tipo de iniciativa no est\u00e1 en el cat\u00e1logo.");

        var po = Limpio(p.Po);
        var so = Limpio(p.So);
        var cat = Limpio(p.Categoria);
        if (po != null && !catalogo.TienePo(po))
            r.Agregar(SolicitudIniciativa.CPo, "El Product Owner no est\u00e1 en el cat\u00e1logo vigente.");
        if (so != null && !catalogo.TieneSo(so))
            r.Agregar(SolicitudIniciativa.CSo, "El Service Owner no est\u00e1 en el cat\u00e1logo vigente.");
        if (cat != null && !catalogo.TieneCategoria(cat))
            r.Agregar(SolicitudIniciativa.CCategoria, "La Categor\u00eda no est\u00e1 en el cat\u00e1logo vigente.");

        // Lo elegido (cada nivel opcional) tiene que salir de UNA fila, como
        // la cascada en modo 'filtro' del navegador.
        var filas = new List<CatalogoSolicitud.Asignacion>();
        if (!r.TieneError(SolicitudIniciativa.CPo) && !r.TieneError(SolicitudIniciativa.CSo)
            && !r.TieneError(SolicitudIniciativa.CCategoria) && (po != null || so != null || cat != null))
        {
            filas = catalogo.Filas(po, so, cat);
            if (filas.Count == 0)
                r.Agregar(SolicitudIniciativa.CCategoria,
                    "Product Owner, Service Owner y Categor\u00eda no salen juntos de ninguna fila vigente del cat\u00e1logo.");
        }
        if (cat != null && filas.Count > 0)
        {
            var directores = new HashSet<string>(StringComparer.Ordinal);
            foreach (var f in filas) if (!string.IsNullOrEmpty(f.Director)) directores.Add(f.Director);
            if (directores.Count == 1) foreach (var d in directores) r.Director = d;
        }

        // Capacidad: advertencia, no error (ADM).
        var fr = ValidadorIniciativa.Fraccion(Limpio(p.Pct) ?? "");
        if (cat != null && fr != null && filas.Count > 0)
        {
            var c = capacidad.Para(cat);
            if (c.Determinable && fr.Value > c.Disponible)
                r.Advertencias.Add("La categor\u00eda solo tiene " + ValidadorIniciativa.ComoPct(c.Disponible) +
                    " de capacidad disponible; el % capturado la exceder\u00eda.");
        }

        var esProblem = tipo != null && tipoProblem != null && tipo == tipoProblem;
        if (p.TieneRca)
            r.Advertencias.Add("El archivo del RCA se recibi\u00f3 pero no se guarda: no hay destino de almacenamiento aprobado.");

        // INCOMPLETA: los de CAMPOS_INCOMPLETA que faltan.
        var valores = new Dictionary<string, string>
        {
            { "categoria", cat }, { "titulo", Limpio(p.Titulo) }, { "descripcion", Limpio(p.Descripcion) },
            { "observaciones", Limpio(p.Observaciones) }, { "volumetria", Limpio(p.Volumetria) },
            { "pct", Limpio(p.Pct) }, { "rca", p.TieneRca ? "si" : null },
        };
        foreach (var c in CamposIncompleta)
        {
            if (c[0] == "rca" && !esProblem) continue;
            if (valores[c[0]] == null) r.Falta(c[0], c[1]);
        }
        return r;
    }

    // ---------------------------------------------------------------------
    // Modificar
    // ---------------------------------------------------------------------
    public ResultadoGestionAdmin FormatoModificar(PeticionModificarAdmin p)
    {
        if (p == null) throw new ArgumentNullException("p");
        var r = new ResultadoGestionAdmin { Accion = "modificar", Folio = Limpio(p.Folio) };
        if (r.Folio == null) r.Agregar(PeticionModificarAdmin.CFolio, "Falta el c\u00f3digo de la iniciativa.");
        if (p.PctsDesparejos)
            r.Agregar("pct", "Los % por categor\u00eda llegaron incompletos (categor\u00eda sin valor o al rev\u00e9s).");
        var vistas = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) { r.Agregar("pct", "Un % lleg\u00f3 sin categor\u00eda."); continue; }
            if (!vistas.Add(ruta)) r.Agregar("pct", ruta + ": la categor\u00eda viene repetida.");
            var t = Limpio(x.Texto);
            if (t != null && ValidadorIniciativa.Fraccion(t) == null)
                r.Agregar("pct", ruta + ": el % debe estar entre 0 y 100, con hasta dos decimales.");
        }
        return r;
    }

    // actual: null si el folio no esta en el registro. compromisos: los de
    // capacidad (ExperienciaQueries.CompromisosCapacidad); los de esta misma
    // iniciativa no cuentan contra ella.
    public ResultadoGestionAdmin Modificar(PeticionModificarAdmin p, IniciativaActual actual,
                                           IEnumerable<CapacidadCategoria.Compromiso> compromisos)
    {
        var r = FormatoModificar(p);
        r.CatalogoRevisado = true;
        if (r.Folio == null) return r;
        if (actual == null)
        {
            r.Agregar(PeticionModificarAdmin.CFolio, "La iniciativa " + r.Folio + " no est\u00e1 en el registro vigente.");
            return r;
        }

        if (p.Titulo != null && Normal(p.Titulo) != Normal(actual.Titulo))
        {
            r.Cambio("titulo", "T\u00edtulo", actual.Titulo, p.Titulo);
            if (Limpio(p.Titulo) == null) r.Advertencias.Add("La iniciativa quedar\u00eda sin T\u00edtulo.");
        }
        if (p.Descripcion != null && Normal(p.Descripcion) != Normal(actual.Descripcion))
            r.Cambio("descripcion", "Descripci\u00f3n", actual.Descripcion, p.Descripcion);
        if (p.Observaciones != null && Normal(p.Observaciones) != Normal(actual.Observaciones))
            r.Cambio("observaciones", "Observaciones", actual.Observaciones, p.Observaciones);

        var otras = new List<CapacidadCategoria.Compromiso>();
        foreach (var c in compromisos ?? new CapacidadCategoria.Compromiso[0])
            if (!string.Equals(c.Folio, actual.Folio, StringComparison.OrdinalIgnoreCase)) otras.Add(c);
        var capacidad = new CapacidadCategoria(otras);

        var quedaSinPct = false;
        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) continue;
            IniciativaActual.Categoria ligada = null;
            foreach (var c in actual.Categorias)
                if (string.Equals((c.Ruta ?? "").Trim(), ruta, StringComparison.OrdinalIgnoreCase)) ligada = c;
            if (ligada == null)
            {
                r.Agregar("pct", ruta + ": no est\u00e1 ligada a esta iniciativa. Agregar o quitar categor\u00edas " +
                    "todav\u00eda no tiene contrato de escritura.");
                continue;
            }
            var t = Limpio(x.Texto);
            var nuevo = t == null ? null : ValidadorIniciativa.Fraccion(t);
            if (t != null && nuevo == null) continue;   // ya reportado en FormatoModificar
            if (nuevo == null) quedaSinPct = true;
            if (nuevo != ligada.Pct)
            {
                r.Cambio("pct", "% Disminuci\u00f3n \u00b7 " + ligada.Ruta, ComoPct(ligada.Pct), ComoPct(nuevo));
                if (nuevo != null)
                {
                    var c = capacidad.Para(ligada.Ruta);
                    if (c.Determinable && nuevo.Value > c.Disponible)
                        r.Advertencias.Add(ligada.Ruta + ": solo tiene " + ValidadorIniciativa.ComoPct(c.Disponible) +
                            " disponible sin contar esta iniciativa; el nuevo % la exceder\u00eda.");
                }
            }
        }

        if (r.Valida && r.Cambios.Count == 0) r.Agregar(null, "No hay cambios que guardar.");

        // INCOMPLETA en una existente: solo Categoria y % (opcion A,
        // Incompleta.CAMPOS_REGISTRO de admin/iniciativa-admin.js).
        if (actual.SinCategoria || actual.Categorias.Count == 0) r.Falta("categoria", "Categor\u00eda");
        else
        {
            var sinPct = quedaSinPct;
            foreach (var c in actual.Categorias)
            {
                var enviada = false;
                foreach (var x in p.Pcts) if (string.Equals(Limpio(x.Categoria), (c.Ruta ?? "").Trim(), StringComparison.OrdinalIgnoreCase)) enviada = true;
                if (!enviada && c.Pct == null) sinPct = true;
            }
            if (sinPct) r.Falta("pct", "% Disminuci\u00f3n");
        }
        return r;
    }
}
