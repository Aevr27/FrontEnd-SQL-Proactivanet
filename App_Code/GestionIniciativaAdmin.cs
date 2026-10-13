// Gestion directa de ADM sobre iniciativas (Admin -> Administracion):
// "Crear iniciativa" y "Modificar" del detalle del registro. CONTRATO Y
// VALIDACION EN EL SERVIDOR, SIN ESCRITURA.
//
//   handlers/admin_iniciativas_gestion.ashx         (HTTP, ExigirAdm)
//       -> PeticionCrearAdmin / PeticionModificarAdmin (lo que llego)
//       -> GestionIniciativaAdminService            (lee catalogo, capacidad,
//                                                    estados y la iniciativa
//                                                    actual)
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
//   - El tope de 100% por ruta se revisa aqui leyendo y decidiendo: eso no
//     lo garantiza ante dos guardados simultaneos. Hace falta un SP que
//     vuelva a sumar con bloqueo en la misma transaccion (sin aprobar).
// Por eso PersistenciaGestionAdmin.Habilitada es una CONSTANTE false: no hay
// llave de configuracion que la encienda por accidente. Encenderla es un
// cambio de codigo revisado, con su escritor real.
//
// MODELO (verificado en 13_experiencia_usuario.sql y en el registro)
//   dbo.Problem            una fila por Codigo (PK). Titulo, Descripcion,
//                          Observaciones, Estado, Subestado, FechaAnalisis,
//                          FechaSolucion, FechaCierre, ... Prefijo es
//                          calculado (LEFT(Codigo,3)).
//   dbo.ProblemCategoria   (Codigo, Categoria) PK: la iniciativa contra UNA
//                          ruta completa, con PctDisminucion (fraccion) y
//                          TicketsReduce. Crear = 1 fila de Problem + N de
//                          ProblemCategoria; ligar a uno existente = filas
//                          nuevas de ProblemCategoria con su Codigo.
//   El Codigo NO cambia al modificar: solo identifica.
//
// REGLAS (ADM; Nueva solicitud de MOD no se toca)
//   Crear     solo el Tipo es obligatorio (prefijo del codigo). Cero o mas
//             categorias, cada una con su % (pares cat_ruta / cat_pct): cada
//             ruta tiene que existir en el catalogo vigente, sin repetirse.
//             PO / SO opcionales, como antes. Lo que falte se informa como
//             INCOMPLETA (marca derivada, sin columna), no bloquea.
//             La Volumetria ya no se captura: es la del SLOT 0 de
//             dbo.vw_TBSlotCAT, de solo lectura (ExperienciaVolumetria.cs).
//   Modificar Titulo, Descripcion, Observaciones, Fechas compromiso
//             (Analisis / Solucion / Cierre), Estado y Subestado del Problem;
//             % de las categorias ligadas; agregar categorias (con su %) y
//             quitar categorias ligadas. El Codigo no se toca. Sin cambios =
//             error.
//   Estado / Subestado: deben ser valores que ya existen en dbo.Problem
//             vigente (no hay catalogo en la base). NO hay reglas de
//             transicion verificadas: no se inventan; se avisa.
//   Capacidad (TOPE 100% POR RUTA, la misma regla que Nueva solicitud y que
//             CapacidadCategoria / ExperienciaCapacidad): un % que deja la
//             ruta por encima de 100% contando a las demas iniciativas que
//             consumen es ERROR (antes, en ADM, solo advertencia). Una ruta
//             que YA pasa de 100% (dato historico) no se corrige sola: se
//             permite bajar o dejar igual el % de una iniciativa, nunca
//             subirlo.
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
        "Persistencia no habilitada: la validación pasó, pero no se guardó nada. " +
        "Falta aprobar el contrato de escritura, verificar la cuenta SQL del sitio y " +
        "evitar que la carga del Excel pise o desactive lo creado aquí.";

    public static readonly string[] Bloqueos =
    {
        "contrato de persistencia 2026-10-09 sin aprobar",
        "identidad SQL del sitio y sus permisos sin verificar",
        "carga del Excel (usp_CargarExperiencia) reescribe Problem/ProblemCategoria y desactiva lo que no viene en el libro",
        "codigo PPP AAAA-NNNNNN: el Excel sigue emitiendo; sin reserva sin choque hasta el cutover",
        "tope de 100% por ruta: falta la verificacion transaccional con bloqueo (SP sin aprobar)",
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

// Pares paralelos de un formulario (a[i] con b[i]); Desparejos si no
// llegaron del mismo largo.
internal static class Pares
{
    public static List<PctCategoria> Leer(NameValueCollection f, string rutas, string valores, out bool desparejos)
    {
        var cats = f.GetValues(rutas) ?? new string[0];
        var vals = f.GetValues(valores) ?? new string[0];
        desparejos = cats.Length != vals.Length;
        var lista = new List<PctCategoria>();
        for (var i = 0; i < Math.Min(cats.Length, vals.Length); i++)
            lista.Add(new PctCategoria { Categoria = cats[i], Texto = vals[i] });
        return lista;
    }
}

public sealed class PeticionModificarAdmin
{
    public const string CFolio = "folio";
    public const string CPctCategoria = "pct_categoria";
    public const string CPctValor = "pct_valor";
    public const string CAgregarCategoria = "agregar_categoria";
    public const string CAgregarPct = "agregar_pct";
    public const string CQuitarCategoria = "quitar_categoria";
    public const string CFAnalisis = "f_analisis";
    public const string CFSolucion = "f_solucion";
    public const string CFCierre = "f_cierre";
    public const string CEstado = "estado";
    public const string CSubestado = "subestado";

    public string Folio;
    // null = el campo no vino (no se cambia); "" = se vacia.
    public string Titulo;
    public string Descripcion;
    public string Observaciones;
    public string FAnalisis;
    public string FSolucion;
    public string FCierre;
    public string Estado;
    public string Subestado;
    public List<PctCategoria> Pcts = new List<PctCategoria>();
    public List<PctCategoria> Agregar = new List<PctCategoria>();
    public List<string> Quitar = new List<string>();
    // Las listas pct_categoria / pct_valor (o agregar_*) no venian parejas.
    public bool PctsDesparejos;
    public bool AgregarDesparejos;

    public static PeticionModificarAdmin DesdeFormulario(NameValueCollection f)
    {
        var p = new PeticionModificarAdmin
        {
            Folio = f[CFolio],
            Titulo = f[SolicitudIniciativa.CTitulo],
            Descripcion = f[SolicitudIniciativa.CDescripcion],
            Observaciones = f[SolicitudIniciativa.CObservaciones],
            FAnalisis = f[CFAnalisis],
            FSolucion = f[CFSolucion],
            FCierre = f[CFCierre],
            Estado = f[CEstado],
            Subestado = f[CSubestado],
        };
        p.Pcts = Pares.Leer(f, CPctCategoria, CPctValor, out p.PctsDesparejos);
        p.Agregar = Pares.Leer(f, CAgregarCategoria, CAgregarPct, out p.AgregarDesparejos);
        p.Quitar = new List<string>(f.GetValues(CQuitarCategoria) ?? new string[0]);
        return p;
    }
}

public sealed class PeticionCrearAdmin
{
    public const string CCatRuta = "cat_ruta";
    public const string CCatPct = "cat_pct";

    public string Tipo, Po, So, Titulo, Descripcion, Observaciones;
    // Una entrada por categoria elegida, con su % (texto en %; "" = sin %).
    public List<PctCategoria> Categorias = new List<PctCategoria>();
    public bool CategoriasDesparejas;
    public bool TieneRca;

    public static PeticionCrearAdmin DesdeFormulario(NameValueCollection f, bool tieneRca)
    {
        var p = new PeticionCrearAdmin
        {
            Tipo = f[SolicitudIniciativa.CTipo],
            Po = f[SolicitudIniciativa.CPo],
            So = f[SolicitudIniciativa.CSo],
            Titulo = f[SolicitudIniciativa.CTitulo],
            Descripcion = f[SolicitudIniciativa.CDescripcion],
            Observaciones = f[SolicitudIniciativa.CObservaciones],
            TieneRca = tieneRca,
        };
        p.Categorias = Pares.Leer(f, CCatRuta, CCatPct, out p.CategoriasDesparejas);
        return p;
    }

    // Atajo de una sola categoria (pruebas y llamadores viejos).
    public static PeticionCrearAdmin Una(string tipo, string categoria, string pct)
    {
        var p = new PeticionCrearAdmin { Tipo = tipo };
        if (categoria != null || pct != null) p.Categorias.Add(new PctCategoria { Categoria = categoria, Texto = pct });
        return p;
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
    public string FAnalisis;       // yyyy-MM-dd o ""
    public string FSolucion;
    public string FCierre;
    public string Estado;
    public string Subestado;       // null si el registro no lo trajo
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
            FAnalisis = Texto(i, "f_analisis"),
            FSolucion = Texto(i, "f_solucion"),
            FCierre = Texto(i, "f_cierre"),
            Estado = Texto(i, "estado"),
            Subestado = i.ContainsKey("subestado") ? Texto(i, "subestado") : null,
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

    public Categoria Ligada(string ruta)
    {
        foreach (var c in Categorias)
            if (string.Equals((c.Ruta ?? "").Trim(), (ruta ?? "").Trim(), StringComparison.OrdinalIgnoreCase)) return c;
        return null;
    }

    private static string Texto(Dictionary<string, object> i, string k)
    {
        object v;
        return i.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
    }
}

// Valores de Estado y Subestado que ya existen en dbo.Problem vigente (no
// hay catalogo en la base). null = no se pudieron leer: se rechaza cambiar
// Estado/Subestado en vez de aceptar cualquier texto.
public sealed class EstadosProblem
{
    public readonly HashSet<string> Estados = new HashSet<string>(StringComparer.Ordinal);
    public readonly HashSet<string> Subestados = new HashSet<string>(StringComparer.Ordinal);

    public EstadosProblem(IEnumerable<string> estados, IEnumerable<string> subestados)
    {
        foreach (var e in estados ?? new string[0]) if (!string.IsNullOrEmpty(e)) Estados.Add(e);
        foreach (var s in subestados ?? new string[0]) if (!string.IsNullOrEmpty(s)) Subestados.Add(s);
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
    public const string CCategorias = "categorias";

    // Los de CAMPOS_INCOMPLETA de admin/iniciativa-admin.js, mismo orden.
    // Sin Volumetria: ya no se captura (es calculada, de solo lectura).
    private static readonly string[][] CamposIncompleta =
    {
        new[] { "categoria", "Categoría" },
        new[] { "titulo", "Título" },
        new[] { "descripcion", "Descripción" },
        new[] { "observaciones", "Observaciones" },
        new[] { "pct", "% Disminución" },
        new[] { "rca", "RCA" },
    };

    // Fechas compromiso de dbo.Problem que Modificar puede cambiar.
    private static readonly string[][] Fechas =
    {
        new[] { PeticionModificarAdmin.CFAnalisis, "Fecha compromiso de Análisis" },
        new[] { PeticionModificarAdmin.CFSolucion, "Fecha compromiso de Solución" },
        new[] { PeticionModificarAdmin.CFCierre, "Fecha compromiso de Cierre" },
    };

    private static readonly Regex FechaIso = new Regex(@"^\d{4}-\d{2}-\d{2}$");

    private static string Limpio(string s)
    {
        if (s == null) return null;
        s = s.Trim();
        return s.Length == 0 ? null : s;
    }

    // Saltos de linea del navegador (\r\n) contra los de la base: no son un
    // cambio por si solos.
    private static string Normal(string s) { return (s ?? "").Replace("\r\n", "\n"); }

    private static string Llave(string ruta)
    {
        var l = Limpio(ruta);
        return l == null ? null : l.ToUpperInvariant();
    }

    public static string ComoPct(decimal? f)
    {
        return f == null ? "" : (f.Value * 100m).ToString("0.##", CultureInfo.InvariantCulture);
    }

    public static bool EsFecha(string s)
    {
        DateTime d;
        return s != null && FechaIso.IsMatch(s)
            && DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);
    }

    // El tope por ruta. disponible: lo que dejan las DEMAS iniciativas que
    // consumen. anterior: el % que la propia iniciativa ya tenia ahi (null =
    // categoria nueva). Bajar o dejar igual nunca se bloquea (ruta ya
    // excedida por datos historicos); subir por encima de lo disponible si.
    private static string Excede(string ruta, decimal nuevo, decimal? anterior, CapacidadCategoria.Resultado c)
    {
        if (!c.Determinable || nuevo <= c.Disponible) return null;
        if (anterior != null && nuevo <= anterior.Value) return null;
        return ruta + ": solo tiene " + ValidadorIniciativa.ComoPct(c.Disponible) +
            " disponible sin contar esta iniciativa (tope 100% por categoría)" +
            (c.Excedida ? "; la categoría ya pasa de 100% y solo se puede bajar o dejar igual." : ".");
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
            r.Agregar(SolicitudIniciativa.CTipo, "Elige el Tipo de iniciativa: define el prefijo del código.");
        if (p.CategoriasDesparejas)
            r.Agregar(CCategorias, "Las categorías y sus % llegaron incompletos (categoría sin % o al revés).");
        var vistas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in p.Categorias)
        {
            var ruta = Limpio(c.Categoria);
            var pct = Limpio(c.Texto);
            if (ruta == null)
            {
                r.Agregar(SolicitudIniciativa.CPct, pct == null ? "Una categoría llegó vacía."
                    : "El % es por categoría: elige la Categoría o deja el % vacío.");
                continue;
            }
            if (!vistas.Add(Llave(ruta)))
                r.Agregar(CCategorias, ruta + ": la categoría está repetida.");
            if (pct != null && ValidadorIniciativa.Fraccion(pct) == null)
                r.Agregar(SolicitudIniciativa.CPct, ruta + ": el % debe estar entre 0 y 100, con hasta dos decimales.");
        }
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
            r.Agregar(SolicitudIniciativa.CTipo, "El Tipo de iniciativa no está en el catálogo.");

        var po = Limpio(p.Po);
        var so = Limpio(p.So);
        if (po != null && !catalogo.TienePo(po))
            r.Agregar(SolicitudIniciativa.CPo, "El Product Owner no está en el catálogo vigente.");
        if (so != null && !catalogo.TieneSo(so))
            r.Agregar(SolicitudIniciativa.CSo, "El Service Owner no está en el catálogo vigente.");
        if (!r.TieneError(SolicitudIniciativa.CPo) && !r.TieneError(SolicitudIniciativa.CSo)
            && (po != null || so != null) && catalogo.Filas(po, so, null).Count == 0)
            r.Agregar(SolicitudIniciativa.CSo, "Product Owner y Service Owner no salen juntos de ninguna fila vigente del catálogo.");

        var directores = new HashSet<string>(StringComparer.Ordinal);
        var rutas = 0;
        var sinPct = false;
        foreach (var c in p.Categorias)
        {
            var cat = Limpio(c.Categoria);
            if (cat == null) continue;
            rutas++;
            if (!catalogo.TieneCategoria(cat))
            {
                r.Agregar(SolicitudIniciativa.CCategoria, cat + ": la categoría no está en el catálogo vigente.");
                continue;
            }
            // Lo elegido (cada nivel opcional) tiene que salir de UNA fila,
            // como la cascada en modo 'filtro' del navegador.
            var filas = r.TieneError(SolicitudIniciativa.CPo) || r.TieneError(SolicitudIniciativa.CSo)
                ? new List<CatalogoSolicitud.Asignacion>() : catalogo.Filas(po, so, cat);
            if (filas.Count == 0 && (po != null || so != null))
                r.Agregar(SolicitudIniciativa.CCategoria, cat +
                    ": Product Owner, Service Owner y Categoría no salen juntos de ninguna fila vigente del catálogo.");
            foreach (var f in filas) if (!string.IsNullOrEmpty(f.Director)) directores.Add(f.Director);

            var fr = ValidadorIniciativa.Fraccion(Limpio(c.Texto) ?? "");
            if (Limpio(c.Texto) == null) sinPct = true;
            if (fr != null)
            {
                var motivo = Excede(cat, fr.Value, null, capacidad.Para(cat));
                if (motivo != null) r.Agregar(SolicitudIniciativa.CPct, motivo);
            }
        }
        if (directores.Count == 1) foreach (var d in directores) r.Director = d;

        var esProblem = tipo != null && tipoProblem != null && tipo == tipoProblem;
        if (p.TieneRca)
            r.Advertencias.Add("El archivo del RCA se recibió pero no se guarda: no hay destino de almacenamiento aprobado.");

        // INCOMPLETA: los de CAMPOS_INCOMPLETA que faltan.
        var valores = new Dictionary<string, string>
        {
            { "categoria", rutas > 0 ? "si" : null }, { "titulo", Limpio(p.Titulo) },
            { "descripcion", Limpio(p.Descripcion) }, { "observaciones", Limpio(p.Observaciones) },
            // Sin categorias no hay % que revisar: ya cuenta "Categoria".
            { "pct", rutas == 0 || !sinPct ? "si" : null }, { "rca", p.TieneRca ? "si" : null },
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
        if (r.Folio == null) r.Agregar(PeticionModificarAdmin.CFolio, "Falta el código de la iniciativa.");
        if (p.PctsDesparejos)
            r.Agregar("pct", "Los % por categoría llegaron incompletos (categoría sin valor o al revés).");
        if (p.AgregarDesparejos)
            r.Agregar(CCategorias, "Las categorías a agregar llegaron incompletas (categoría sin % o al revés).");

        var vistas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) { r.Agregar("pct", "Un % llegó sin categoría."); continue; }
            if (!vistas.Add(Llave(ruta))) r.Agregar("pct", ruta + ": la categoría viene repetida.");
            var t = Limpio(x.Texto);
            if (t != null && ValidadorIniciativa.Fraccion(t) == null)
                r.Agregar("pct", ruta + ": el % debe estar entre 0 y 100, con hasta dos decimales.");
        }
        var agregadas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in p.Agregar)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) { r.Agregar(CCategorias, "Una categoría a agregar llegó vacía."); continue; }
            if (!agregadas.Add(Llave(ruta))) r.Agregar(CCategorias, ruta + ": se quiere agregar dos veces.");
            var t = Limpio(x.Texto);
            if (t != null && ValidadorIniciativa.Fraccion(t) == null)
                r.Agregar(CCategorias, ruta + ": el % debe estar entre 0 y 100, con hasta dos decimales.");
        }
        var quitadas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var q in p.Quitar)
        {
            var ruta = Limpio(q);
            if (ruta == null) { r.Agregar(CCategorias, "Una categoría a quitar llegó vacía."); continue; }
            if (!quitadas.Add(Llave(ruta))) r.Agregar(CCategorias, ruta + ": se quiere quitar dos veces.");
            if (vistas.Contains(Llave(ruta)))
                r.Agregar(CCategorias, ruta + ": no se puede cambiar el % y quitar la misma categoría.");
            if (agregadas.Contains(Llave(ruta)))
                r.Agregar(CCategorias, ruta + ": no se puede agregar y quitar la misma categoría.");
        }
        foreach (var f in Fechas)
        {
            var v = Limpio(Valor(p, f[0]));
            if (v != null && !EsFecha(v)) r.Agregar(f[0], f[1] + ": escribe una fecha válida (aaaa-mm-dd).");
        }
        return r;
    }

    private static string Valor(PeticionModificarAdmin p, string clave)
    {
        if (clave == PeticionModificarAdmin.CFAnalisis) return p.FAnalisis;
        if (clave == PeticionModificarAdmin.CFSolucion) return p.FSolucion;
        if (clave == PeticionModificarAdmin.CFCierre) return p.FCierre;
        return null;
    }

    private static string Valor(IniciativaActual a, string clave)
    {
        if (clave == PeticionModificarAdmin.CFAnalisis) return a.FAnalisis;
        if (clave == PeticionModificarAdmin.CFSolucion) return a.FSolucion;
        if (clave == PeticionModificarAdmin.CFCierre) return a.FCierre;
        return null;
    }

    // Compatibilidad: sin catalogo de rutas ni estados (no se puede agregar
    // categorias ni cambiar Estado/Subestado).
    public ResultadoGestionAdmin Modificar(PeticionModificarAdmin p, IniciativaActual actual,
                                           IEnumerable<CapacidadCategoria.Compromiso> compromisos)
    {
        return Modificar(p, actual, compromisos, null, null);
    }

    // actual: null si el folio no esta en el registro. compromisos: los de
    // capacidad (ExperienciaQueries.CompromisosCapacidad); los de esta misma
    // iniciativa no cuentan contra ella. catalogo: rutas vigentes (para
    // agregar). estados: valores existentes de Estado/Subestado.
    public ResultadoGestionAdmin Modificar(PeticionModificarAdmin p, IniciativaActual actual,
                                           IEnumerable<CapacidadCategoria.Compromiso> compromisos,
                                           CatalogoSolicitud catalogo, EstadosProblem estados)
    {
        var r = FormatoModificar(p);
        r.CatalogoRevisado = true;
        if (r.Folio == null) return r;
        if (actual == null)
        {
            r.Agregar(PeticionModificarAdmin.CFolio, "La iniciativa " + r.Folio + " no está en el registro vigente.");
            return r;
        }

        // ---- Problem: textos ----
        if (p.Titulo != null && Normal(p.Titulo) != Normal(actual.Titulo))
        {
            r.Cambio("titulo", "Título", actual.Titulo, p.Titulo);
            if (Limpio(p.Titulo) == null) r.Advertencias.Add("La iniciativa quedaría sin Título.");
        }
        if (p.Descripcion != null && Normal(p.Descripcion) != Normal(actual.Descripcion))
            r.Cambio("descripcion", "Descripción", actual.Descripcion, p.Descripcion);
        if (p.Observaciones != null && Normal(p.Observaciones) != Normal(actual.Observaciones))
            r.Cambio("observaciones", "Observaciones", actual.Observaciones, p.Observaciones);

        // ---- Problem: fechas compromiso ----
        foreach (var f in Fechas)
        {
            var nuevo = Valor(p, f[0]);
            if (nuevo == null || r.TieneError(f[0])) continue;
            var limpio = Limpio(nuevo) ?? "";
            var anterior = Valor(actual, f[0]) ?? "";
            if (limpio == anterior) continue;
            r.Cambio(f[0], f[1], anterior, limpio);
            if (limpio == "") r.Advertencias.Add(f[1] + ": quedaría sin fecha.");
        }

        // ---- Problem: Estado / Subestado ----
        var cambiaEstado = false;
        if (p.Estado != null && (Limpio(p.Estado) ?? "") != (actual.Estado ?? ""))
        {
            var e = Limpio(p.Estado);
            if (estados == null) r.Agregar(PeticionModificarAdmin.CEstado, "No se pudo leer la lista de estados: no se puede cambiar el Estado.");
            else if (e == null || !estados.Estados.Contains(e)) r.Agregar(PeticionModificarAdmin.CEstado, "El Estado no es uno de los que ya existen en los problemas.");
            else { r.Cambio(PeticionModificarAdmin.CEstado, "Estado", actual.Estado, e); cambiaEstado = true; }
        }
        if (p.Subestado != null && (Limpio(p.Subestado) ?? "") != (actual.Subestado ?? ""))
        {
            var s = Limpio(p.Subestado);
            if (estados == null) r.Agregar(PeticionModificarAdmin.CSubestado, "No se pudo leer la lista de subestados: no se puede cambiar el Subestado.");
            else if (s == null || !estados.Subestados.Contains(s)) r.Agregar(PeticionModificarAdmin.CSubestado, "El Subestado no es uno de los que ya existen en los problemas.");
            else { r.Cambio(PeticionModificarAdmin.CSubestado, "Subestado", actual.Subestado, s); cambiaEstado = true; }
        }
        if (cambiaEstado)
            r.Advertencias.Add("No hay reglas de transición de Estado/Subestado verificadas: solo se revisó que el valor exista.");

        // ---- Categorias ----
        // Si sus filas actuales NO consumen (cerrada, fuera de los estados
        // vivos o sin agrupador: ExperienciaQueries.ConsumeCapacidad), su %
        // no cuenta contra nadie y el tope no aplica. Sin filas (sin
        // categoria) no se sabe: se trata como si consumiera.
        var otras = new List<CapacidadCategoria.Compromiso>();
        var propias = 0;
        var propiasConsumen = 0;
        foreach (var c in compromisos ?? new CapacidadCategoria.Compromiso[0])
        {
            if (!string.Equals(c.Folio, actual.Folio, StringComparison.OrdinalIgnoreCase)) { otras.Add(c); continue; }
            propias++;
            if (c.Consume) propiasConsumen++;
        }
        var consume = propias == 0 || propiasConsumen > 0;
        var capacidad = new CapacidadCategoria(consume ? otras : new List<CapacidadCategoria.Compromiso>());

        var quitar = new HashSet<string>(StringComparer.Ordinal);
        foreach (var q in p.Quitar)
        {
            var ruta = Limpio(q);
            if (ruta == null) continue;
            var ligada = actual.Ligada(ruta);
            if (ligada == null) { r.Agregar(CCategorias, ruta + ": no está ligada a esta iniciativa; no hay nada que quitar."); continue; }
            quitar.Add(Llave(ruta));
            r.Cambio("quitar_categoria", "Quitar categoría", ligada.Ruta, "");
        }

        var quedaSinPct = false;
        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) continue;
            var ligada = actual.Ligada(ruta);
            if (ligada == null)
            {
                r.Agregar("pct", ruta + ": no está ligada a esta iniciativa. Para ligarla, agrégala como categoría nueva.");
                continue;
            }
            var t = Limpio(x.Texto);
            var nuevo = t == null ? null : ValidadorIniciativa.Fraccion(t);
            if (t != null && nuevo == null) continue;   // ya reportado en FormatoModificar
            if (nuevo == null) quedaSinPct = true;
            if (nuevo != ligada.Pct)
            {
                r.Cambio("pct", "% Disminución · " + ligada.Ruta, ComoPct(ligada.Pct), ComoPct(nuevo));
                if (nuevo != null)
                {
                    var motivo = Excede(ligada.Ruta, nuevo.Value, ligada.Pct, capacidad.Para(ligada.Ruta));
                    if (motivo != null) r.Agregar("pct", motivo);
                }
            }
        }

        var agregadas = 0;
        foreach (var x in p.Agregar)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) continue;
            if (actual.Ligada(ruta) != null)
            {
                r.Agregar(CCategorias, ruta + ": ya está ligada a esta iniciativa; cambia su % en vez de agregarla.");
                continue;
            }
            if (catalogo == null)
            {
                r.Agregar(CCategorias, "No se pudo leer el catálogo de categorías: no se puede agregar " + ruta + ".");
                continue;
            }
            if (!catalogo.TieneCategoria(ruta))
            {
                r.Agregar(CCategorias, ruta + ": la categoría no está en el catálogo vigente.");
                continue;
            }
            var t = Limpio(x.Texto);
            var fr = t == null ? null : ValidadorIniciativa.Fraccion(t);
            if (t != null && fr == null) continue;
            if (fr == null) quedaSinPct = true;
            agregadas++;
            r.Cambio("agregar_categoria", "Agregar categoría", "", ruta + (fr == null ? " (sin %)" : " · " + ComoPct(fr) + "%"));
            if (fr != null)
            {
                var motivo = Excede(ruta, fr.Value, null, capacidad.Para(ruta));
                if (motivo != null) r.Agregar(CCategorias, motivo);
            }
        }

        if (r.Valida && r.Cambios.Count == 0) r.Agregar(null, "No hay cambios que guardar.");

        // INCOMPLETA en una existente: solo Categoria y % (opcion A,
        // Incompleta.CAMPOS_REGISTRO de admin/iniciativa-admin.js), sobre
        // como QUEDARIA: ligadas que no se quitan + agregadas.
        var quedan = 0;
        var sinPct = quedaSinPct;
        foreach (var c in actual.Categorias)
        {
            if (quitar.Contains(Llave(c.Ruta))) continue;
            quedan++;
            var enviada = false;
            foreach (var x in p.Pcts) if (Llave(x.Categoria) == Llave(c.Ruta)) enviada = true;
            if (!enviada && c.Pct == null) sinPct = true;
        }
        quedan += agregadas;
        if (actual.SinCategoria && agregadas == 0) quedan = 0;
        if (quedan == 0)
        {
            r.Falta("categoria", "Categoría");
            if (actual.Categorias.Count > 0 && quitar.Count > 0)
                r.Advertencias.Add("La iniciativa quedaría sin categorías.");
        }
        else if (sinPct) r.Falta("pct", "% Disminución");
        return r;
    }
}
