// Nueva solicitud de Admin -> Iniciativas: el modelo y sus reglas, SIN SQL.
//
//   handlers/admin_iniciativas_validar.ashx      (HTTP, sin logica)
//       -> SolicitudIniciativa.DesdeFormulario   (lo que llego)
//       -> IniciativaService                     (App_Code/IniciativaService.cs:
//                                                 lee catalogo y capacidad)
//       -> ValidadorIniciativa                   (las reglas, aqui)
//
// Todo lo de este archivo se prueba sin IIS ni base:
// tools/tests/SolicitudIniciativaSmoke.cs.
//
// QUE NO HACE (a proposito, ver el hito)
// --------------------------------------
// No guarda nada, no genera el numero de solicitud ni sube el RCA: no hay
// mecanismo existente para ninguno de los dos (REQUEST NUMBER PERSISTENCE y
// RCA SHAREPOINT DESTINATION: UNRESOLVED). NumeroSolicitud solo FORMATEA un
// numero que algun dia dara la base; no lo inventa.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

// ---------------------------------------------------------------------
// Tipo de iniciativa: el caso especial "Problem"
// ---------------------------------------------------------------------
// Los tipos salen del catalogo real (DashboardCatalogos.TiposIniciativa);
// aqui no hay lista de tipos. Solo se reconoce Problem, que es el unico con
// reglas propias: va primero en el selector y exige RCA. Si el catalogo no
// lo trae, no se agrega.
public static class TiposSolicitud
{
    public const string Problem = "Problem";

    public static bool EsProblem(string tipo)
    {
        return tipo != null && string.Equals(tipo.Trim(), Problem, StringComparison.OrdinalIgnoreCase);
    }

    // La misma lista con Problem (si esta) movido al principio; el resto en
    // el orden en que llego. No agrega, no quita y no cambia ningun valor.
    public static List<object> ProblemPrimero(IEnumerable<object> tipos)
    {
        var primero = new List<object>();
        var resto = new List<object>();
        foreach (var t in tipos)
        {
            if (primero.Count == 0 && EsProblem(t as string)) primero.Add(t);
            else resto.Add(t);
        }
        primero.AddRange(resto);
        return primero;
    }

    // El valor del catalogo que es Problem (con su grafia), o null.
    public static string ValorProblem(IEnumerable<object> tipos)
    {
        foreach (var t in tipos)
            if (EsProblem(t as string)) return (string)t;
        return null;
    }
}

// ---------------------------------------------------------------------
// Numero consecutivo de solicitud: #0000142
// ---------------------------------------------------------------------
// Identifica la SOLICITUD. NO es Problem.Codigo ("PRB 2026-00XXX"), no lo
// sustituye y no lleva año, tipo ni prefijo: consecutivo perpetuo y unico.
// Esta clase solo lo representa y sabe cual sigue; QUIEN lo emite es un
// IGeneradorNumeroSolicitud (abajo). Hoy no hay ninguno con almacen real:
// REQUEST NUMBER PERSISTENCE: UNRESOLVED (necesita un objeto en la base).
public sealed class NumeroSolicitud
{
    public const int Digitos = 7;
    public const int Maximo = 9999999;

    public int Valor { get; private set; }

    public NumeroSolicitud(int valor)
    {
        if (valor < 1 || valor > Maximo)
            throw new ArgumentOutOfRangeException("valor", "El numero de solicitud va de 1 a " + Maximo + ".");
        Valor = valor;
    }

    // "0000142": la parte fisica (nombre de archivo).
    public string Digitos7()
    {
        return Valor.ToString("D" + Digitos, CultureInfo.InvariantCulture);
    }

    // "#0000142": como se muestra.
    public override string ToString() { return "#" + Digitos7(); }

    // El que sigue al ultimo emitido; sin ninguno emitido, el 1. Es la regla
    // que aplicara el almacen (que ademas debe hacerlo atomico).
    public static NumeroSolicitud Siguiente(int? ultimo)
    {
        var u = ultimo ?? 0;
        if (u < 0) throw new ArgumentOutOfRangeException("ultimo");
        if (u >= Maximo) throw new InvalidOperationException("Se agotaron los numeros de solicitud de " + Digitos + " digitos.");
        return new NumeroSolicitud(u + 1);
    }

    // Nombre permanente del RCA: el numero + la extension del ORIGINAL, tal
    // cual ("RCA_final_v7.docx" -> "0000142.docx"; no se fuerza .pdf ni se
    // cambia la grafia). Solo se acepta si son letras/digitos; si no, o sin
    // extension, solo el numero. El nombre original nunca se usa.
    public string NombreArchivoRca(string nombreOriginal)
    {
        var ext = ExtensionSegura(nombreOriginal);
        return ext == null ? Digitos7() : Digitos7() + "." + ext;
    }

    public static string ExtensionSegura(string nombre)
    {
        if (string.IsNullOrEmpty(nombre)) return null;
        // Solo el nombre, venga con ruta de Windows o no (IE manda la ruta).
        var corte = Math.Max(nombre.LastIndexOf('\\'), nombre.LastIndexOf('/'));
        if (corte >= 0) nombre = nombre.Substring(corte + 1);
        var punto = nombre.LastIndexOf('.');
        if (punto <= 0 || punto == nombre.Length - 1) return null;
        var ext = nombre.Substring(punto + 1).Trim();
        return Regex.IsMatch(ext, "^[A-Za-z0-9]{1,10}$") ? ext : null;
    }
}

// Quien emite el numero. El emisor de verdad tiene que ser persistente
// (sobrevive reinicios y despliegues), atomico entre procesos y emitir el
// numero en la MISMA transaccion en que se guarda la solicitud: solo asi
// "no hay otra solicitud en creacion con ese numero" es una garantia y no
// una suposicion. Eso no existe sin un objeto nuevo en la base.
public interface IGeneradorNumeroSolicitud
{
    // null = no hay emisor configurado; `motivo` dice por que.
    NumeroSolicitud Emitir(out string motivo);
}

// El que hay hoy: no emite. NO es un contador en memoria ni en archivo a
// proposito (se reiniciaria o se pisaria entre procesos/despliegues y no
// queda ligado a ninguna solicitud guardada).
public sealed class GeneradorNumeroSolicitudPendiente : IGeneradorNumeroSolicitud
{
    public const string Motivo =
        "Sin almacen de solicitudes en la base: el numero de solicitud no se puede emitir todavia.";

    public NumeroSolicitud Emitir(out string motivo)
    {
        motivo = Motivo;
        return null;
    }
}

// ---------------------------------------------------------------------
// Lo que llega del navegador
// ---------------------------------------------------------------------
public sealed class SolicitudIniciativa
{
    // Nombres de los campos del formulario (los manda admin/iniciativas.js).
    public const string CTipo = "tipo";
    public const string CPo = "po";
    public const string CSo = "so";
    public const string CCategoria = "categoria";
    public const string CTitulo = "titulo";
    public const string CDescripcion = "descripcion";
    public const string CObservaciones = "observaciones";
    public const string CVolumetria = "volumetria";
    public const string CPct = "pct";
    public const string CRca = "rca";
    // Lo que el navegador CREIA disponible al enviar. Solo informativo: el
    // servidor nunca lo usa para decidir (ver ValidadorIniciativa).
    public const string CDisponibleCliente = "disponible_cliente";

    public string Tipo;
    public string ProductOwner;
    public string ServiceOwner;
    public string Categoria;
    public string Titulo;
    public string Descripcion;
    public string Observaciones;
    public string Volumetria;     // texto tal cual; lo valida el validador
    public string Pct;            // % como texto ("20", "33.5"), no fraccion
    public bool TieneRca;         // llego un archivo no vacio
    public string NombreRca;      // nombre original (solo para la extension)
    public string DisponibleCliente;

    public static SolicitudIniciativa DesdeFormulario(NameValueCollection f, bool tieneRca, string nombreRca)
    {
        f = f ?? new NameValueCollection();
        return new SolicitudIniciativa
        {
            Tipo = f[CTipo],
            ProductOwner = f[CPo],
            ServiceOwner = f[CSo],
            Categoria = f[CCategoria],
            Titulo = f[CTitulo],
            Descripcion = f[CDescripcion],
            Observaciones = f[CObservaciones],
            Volumetria = f[CVolumetria],
            Pct = f[CPct],
            TieneRca = tieneRca,
            NombreRca = tieneRca ? nombreRca : null,
            DisponibleCliente = f[CDisponibleCliente],
        };
    }
}

// ---------------------------------------------------------------------
// Catalogo contra el que se valida (el mismo que ve el formulario)
// ---------------------------------------------------------------------
public sealed class CatalogoSolicitud
{
    public sealed class Asignacion
    {
        public string Po, So, Categoria, Director;
    }

    private readonly HashSet<string> _tipos = new HashSet<string>(StringComparer.Ordinal);
    private readonly List<Asignacion> _asignaciones = new List<Asignacion>();

    public CatalogoSolicitud(IEnumerable<object> tipos, IEnumerable<Asignacion> asignaciones)
    {
        foreach (var t in tipos ?? new object[0]) { var s = t as string; if (!string.IsNullOrEmpty(s)) _tipos.Add(s); }
        if (asignaciones != null) _asignaciones.AddRange(asignaciones);
    }

    // Desde la salida de DirectorioOrganizacional.AsignacionesVigentes() (la
    // que publica admin_iniciativas_catalogos.ashx) y los tipos.
    public static CatalogoSolicitud Desde(IEnumerable<object> tipos, Dictionary<string, object> vigentes)
    {
        var filas = new List<Asignacion>();
        object lista;
        if (vigentes != null && vigentes.TryGetValue("asignaciones", out lista))
        {
            foreach (Dictionary<string, object> f in (System.Collections.IEnumerable)lista)
            {
                filas.Add(new Asignacion
                {
                    Po = f["po"] as string, So = f["so"] as string,
                    Categoria = f["categoria"] as string, Director = f["director"] as string
                });
            }
        }
        return new CatalogoSolicitud(tipos, filas);
    }

    public bool TieneTipo(string tipo) { return tipo != null && _tipos.Contains(tipo); }

    // Cada valor por separado: existe en ALGUNA fila vigente.
    public bool TienePo(string po) { return _asignaciones.Exists(a => a.Po == po); }
    public bool TieneSo(string so) { return _asignaciones.Exists(a => a.So == so); }
    public bool TieneCategoria(string c) { return _asignaciones.Exists(a => a.Categoria == c); }

    // La fila que casa EXACTAMENTE con lo elegido en la cascada, o null. Es
    // el mismo filtrado progresivo del navegador: PO, SO y Categoria tienen
    // que salir juntos de una fila vigente (no hay jerarquia que validar).
    public Asignacion Combinacion(string po, string so, string categoria)
    {
        foreach (var a in _asignaciones)
            if (a.Po == po && a.So == so && a.Categoria == categoria) return a;
        return null;
    }
}

// ---------------------------------------------------------------------
// Capacidad de reduccion por categoria
// ---------------------------------------------------------------------
// Cada categoria tiene 100% (1.0000 en la representacion de
// ProblemCategoria.PctDisminucion). Lo usan las iniciativas que hoy cuentan:
//
//     Disponible = max(0, 1.0000 - SUM(PctDisminucion de las que consumen))
//
// Que fila consume la decide quien la arma (IniciativaService, con la regla
// de Experiencia); esta clase solo suma lo actual: si una iniciativa cambia
// su % o deja de contar, el siguiente calculo ya no la trae. No hay restas
// acumuladas.
//
// La categoria se compara por RUTA EXACTA (normalizada, sin distinguir
// mayusculas), como Experiencia compara el Tickets Reduce. Si alguna
// iniciativa que consume esta en una ruta ANCESTRA o DESCENDIENTE de la
// pedida (p. ej. se pide la N2 "/A/B" y hay una en "/A/B/C"), no se sabe si
// comparten el 100%: el resultado es NO DETERMINABLE y el validador rechaza
// (falla cerrado). CATEGORY CAPACITY GRANULARITY: UNRESOLVED.
public sealed class CapacidadCategoria
{
    public const decimal Total = 1.0000m;

    public sealed class Compromiso
    {
        public string Folio;
        public string Categoria;   // ruta de ProblemCategoria
        public decimal Pct;        // fraccion (0.2000 = 20%)
        public bool Consume;       // cuenta contra la capacidad hoy
    }

    public sealed class Resultado
    {
        public string Categoria;
        public decimal Usado;
        public decimal Disponible;
        public bool Determinable;
        public bool Excedida;              // lo usado ya pasa de 100%
        public List<string> Folios = new List<string>();
        public List<string> RutasRelacionadas = new List<string>();

        public Dictionary<string, object> ComoJson()
        {
            return new Dictionary<string, object>
            {
                { "categoria", Categoria },
                { "total", Total },
                { "usado", Usado },
                { "disponible", Disponible },
                { "determinable", Determinable },
                { "excedida", Excedida },
                { "folios", Folios },
                { "rutas_relacionadas", RutasRelacionadas },
            };
        }
    }

    private readonly List<Compromiso> _compromisos = new List<Compromiso>();

    public CapacidadCategoria(IEnumerable<Compromiso> compromisos)
    {
        if (compromisos != null) _compromisos.AddRange(compromisos);
    }

    public Resultado Para(string categoria)
    {
        var llave = Ruta(categoria);
        var r = new Resultado { Categoria = llave, Determinable = llave != null, Usado = 0.0000m };
        if (llave == null) return r;

        foreach (var c in _compromisos)
        {
            if (c == null || !c.Consume) continue;
            var ruta = Ruta(c.Categoria);
            if (ruta == null) continue;

            if (string.Equals(ruta, llave, StringComparison.OrdinalIgnoreCase))
            {
                r.Usado += c.Pct;
                if (!string.IsNullOrEmpty(c.Folio) && !r.Folios.Contains(c.Folio)) r.Folios.Add(c.Folio);
            }
            else if (Contiene(llave, ruta) || Contiene(ruta, llave))
            {
                r.Determinable = false;
                if (!r.RutasRelacionadas.Contains(ruta)) r.RutasRelacionadas.Add(ruta);
            }
        }

        r.Excedida = r.Usado > Total;
        r.Disponible = r.Usado >= Total ? 0.0000m : Total - r.Usado;
        return r;
    }

    // ¿`hija` cuelga de `padre`? "/A/B" contiene "/A/B/C" y "/A/B / C", no
    // "/A/BC".
    private static bool Contiene(string padre, string hija)
    {
        if (hija.Length <= padre.Length) return false;
        if (!hija.StartsWith(padre, StringComparison.OrdinalIgnoreCase)) return false;
        return hija.Substring(padre.Length).TrimStart().StartsWith("/", StringComparison.Ordinal);
    }

    private static string Ruta(string s)
    {
        var n = DirectorioOrganizacional.Normaliza(s);
        return string.IsNullOrEmpty(n) ? null : n.TrimEnd('/', ' ');
    }
}

// ---------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------
public sealed class ValidadorIniciativa
{
    public sealed class Error
    {
        public string Campo;
        public string Mensaje;
    }

    public sealed class Resultado
    {
        public List<Error> Errores = new List<Error>();
        public bool Valida { get { return Errores.Count == 0; } }
        public bool RcaObligatorio;
        public decimal? PctFraccion;            // como PctDisminucion
        public string Director;                 // derivado de la combinacion
        public CapacidadCategoria.Resultado Capacidad;
        // Solo si la solicitud es valida y hay emisor (IniciativaService
        // .AsignarNumero); si no, null y NumeroPendiente dice por que.
        public NumeroSolicitud Numero;
        public string NumeroPendiente;

        public void Agregar(string campo, string mensaje)
        {
            Errores.Add(new Error { Campo = campo, Mensaje = mensaje });
        }

        public bool TieneError(string campo)
        {
            foreach (var e in Errores) if (e.Campo == campo) return true;
            return false;
        }
    }

    // Mismas formas que VALIDAR en admin/iniciativas.js.
    private static readonly Regex Entero = new Regex(@"^\d+$");
    private static readonly Regex Porcentaje = new Regex(@"^\d{1,3}(\.\d{1,2})?$");

    // El % en texto -> fraccion de 4 decimales, o null si no es un % valido
    // (0 a 100, hasta dos decimales: la precision de DECIMAL(9,4) en
    // fraccion). Sin multiplos obligatorios.
    public static decimal? Fraccion(string pct)
    {
        var t = (pct ?? "").Trim();
        if (!Porcentaje.IsMatch(t)) return null;
        var v = decimal.Parse(t, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
        if (v > 100m) return null;
        // * 0.0100m (y no / 100m) deja la escala en 4, como DECIMAL(9,4):
        // 20 -> 0.2000, no 0.2.
        return decimal.Round(v * 0.0100m, 4);
    }

    // El catalogo y la capacidad los arma el servidor en el momento de
    // validar. Lo que el navegador creyera disponible
    // (SolicitudIniciativa.DisponibleCliente) NO entra aqui a proposito.
    public Resultado Validar(SolicitudIniciativa s, CatalogoSolicitud catalogo, CapacidadCategoria capacidad)
    {
        if (s == null) throw new ArgumentNullException("s");
        if (catalogo == null) throw new ArgumentNullException("catalogo");
        if (capacidad == null) throw new ArgumentNullException("capacidad");

        var r = new Resultado();

        // ---- 01 Clasificacion -------------------------------------------
        var tipo = Limpio(s.Tipo);
        if (tipo == null) r.Agregar(SolicitudIniciativa.CTipo, "Falta el Tipo de iniciativa.");
        else if (!catalogo.TieneTipo(tipo)) r.Agregar(SolicitudIniciativa.CTipo, "El Tipo de iniciativa no esta en el catalogo.");

        var po = Limpio(s.ProductOwner);
        var so = Limpio(s.ServiceOwner);
        var cat = Limpio(s.Categoria);
        if (po == null) r.Agregar(SolicitudIniciativa.CPo, "Falta el Product Owner.");
        else if (!catalogo.TienePo(po)) r.Agregar(SolicitudIniciativa.CPo, "El Product Owner no esta en el catalogo vigente.");
        if (so == null) r.Agregar(SolicitudIniciativa.CSo, "Falta el Service Owner.");
        else if (!catalogo.TieneSo(so)) r.Agregar(SolicitudIniciativa.CSo, "El Service Owner no esta en el catalogo vigente.");
        if (cat == null) r.Agregar(SolicitudIniciativa.CCategoria, "Falta la Categoria.");
        else if (!catalogo.TieneCategoria(cat)) r.Agregar(SolicitudIniciativa.CCategoria, "La Categoria no esta en el catalogo vigente.");

        // La combinacion solo se mira si cada valor existe por si mismo
        // (para no repetir el mismo problema con dos mensajes).
        CatalogoSolicitud.Asignacion fila = null;
        if (po != null && so != null && cat != null
            && !r.TieneError(SolicitudIniciativa.CPo) && !r.TieneError(SolicitudIniciativa.CSo)
            && !r.TieneError(SolicitudIniciativa.CCategoria))
        {
            fila = catalogo.Combinacion(po, so, cat);
            if (fila == null)
                r.Agregar(SolicitudIniciativa.CCategoria,
                    "Product Owner, Service Owner y Categoria no forman una combinacion vigente del catalogo.");
            else if (string.IsNullOrEmpty(fila.Director))
                r.Agregar(SolicitudIniciativa.CCategoria, "La Categoria no tiene Director.");
            else
                r.Director = fila.Director;
        }

        // ---- 02 Informacion del problema --------------------------------
        if (Limpio(s.Titulo) == null) r.Agregar(SolicitudIniciativa.CTitulo, "Falta el Titulo.");
        if (Limpio(s.Descripcion) == null) r.Agregar(SolicitudIniciativa.CDescripcion, "Falta la Descripcion.");
        if (Limpio(s.Observaciones) == null) r.Agregar(SolicitudIniciativa.CObservaciones, "Faltan las Observaciones.");

        // ---- 03 Impacto -------------------------------------------------
        var vol = Limpio(s.Volumetria);
        int volumen;
        if (vol == null) r.Agregar(SolicitudIniciativa.CVolumetria, "Falta la Volumetria.");
        else if (!Entero.IsMatch(vol) || !int.TryParse(vol, NumberStyles.None, CultureInfo.InvariantCulture, out volumen))
            r.Agregar(SolicitudIniciativa.CVolumetria, "La Volumetria debe ser un numero entero, de 0 en adelante.");

        var pctTexto = Limpio(s.Pct);
        if (pctTexto == null) r.Agregar(SolicitudIniciativa.CPct, "Falta el % de disminucion.");
        else
        {
            r.PctFraccion = Fraccion(pctTexto);
            if (r.PctFraccion == null)
                r.Agregar(SolicitudIniciativa.CPct, "El % debe estar entre 0 y 100, con hasta dos decimales.");
        }

        // Capacidad: SIEMPRE la que el servidor calcula ahora, para la
        // categoria de una combinacion valida.
        if (fila != null)
        {
            r.Capacidad = capacidad.Para(fila.Categoria);
            if (!r.Capacidad.Determinable)
                r.Agregar(SolicitudIniciativa.CPct,
                    "No se puede calcular la capacidad de esta categoria: hay iniciativas en categorias que la contienen o que cuelgan de ella.");
            else if (r.PctFraccion != null && r.PctFraccion.Value > r.Capacidad.Disponible)
                r.Agregar(SolicitudIniciativa.CPct,
                    "La categoria solo tiene " + ComoPct(r.Capacidad.Disponible) + " de capacidad disponible.");
        }

        // ---- 04 RCA -----------------------------------------------------
        r.RcaObligatorio = TiposSolicitud.EsProblem(tipo);
        if (r.RcaObligatorio && !s.TieneRca)
            r.Agregar(SolicitudIniciativa.CRca, "El RCA es obligatorio para Problem.");

        return r;
    }

    // 0.4000 -> "40%", 0.3350 -> "33.5%".
    public static string ComoPct(decimal fraccion)
    {
        return (fraccion * 100m).ToString("0.##", CultureInfo.InvariantCulture) + "%";
    }

    private static string Limpio(string s)
    {
        if (s == null) return null;
        s = s.Trim();
        return s.Length == 0 ? null : s;
    }
}
