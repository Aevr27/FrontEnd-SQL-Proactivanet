// Gestion directa de ADM sobre iniciativas (Admin -> Administracion):
// "Crear iniciativa" y "Modificar" del detalle del registro. CONTRATO,
// VALIDACION Y ESCRITURA EN EL SERVIDOR.
//
//   handlers/admin_iniciativas_gestion.ashx         (HTTP, ExigirAdm)
//       -> PeticionCrearAdmin / PeticionModificarAdmin (lo que llego)
//       -> GestionIniciativaAdminService            (lee catalogo, capacidad,
//                                                    estados y la iniciativa
//                                                    actual)
//       -> ValidadorGestionAdmin                    (las reglas, aqui, sin SQL)
//       -> PersistenciaGestionAdmin                 (habilitada 2026-10-14)
//
// ESCRITURA (diseno aprobado 2026-10-13): vive en
// sql/18_gestion_admin_persistencia.sql (adm.usp_GestionAdmin_*: Codigo,
// tope con candado, TicketsReduce, historial y NroCambioFecha* en UNA
// transaccion) y en EscritorGestionAdmin.cs. Aplicado en la VM el
// 2026-10-14: sql/18, GRANT EXECUTE adm + DENY sobre
// adm.IniciativaProtegida, ADM_04 (el cargador del Excel no toca los
// Codigo que Admin crea o modifica) y ADM_01/02 (fecha por categoria).
// PersistenciaGestionAdmin.Habilitada sigue siendo una CONSTANTE (no hay
// llave de configuracion): apagarla es volver a false y desplegar.
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
//             PO / SO opcionales y SIN la cascada de Nueva solicitud: cada
//             uno tiene que estar en el catalogo vigente (nada escrito a
//             mano), pero PO, SO y Categoria no tienen que salir juntos de
//             una fila. Se guardan en dbo.Problem.OwnerProblem / OwnerServicio
//             (sql/20; NULL si no se eligen). Con GuardaDuenos = false (base
//             sin sql/20) un PO o SO elegido se RECHAZA: nunca se tira. Lo que falte se informa como
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
    public const bool Habilitada = true;

    // PO / SO del alta -> dbo.Problem.OwnerProblem / OwnerServicio, por los
    // parametros que sql/20 agrega a adm.usp_GestionAdmin_Crear (aprobado
    // 2026-10-15). true SOLO con sql/20 aplicada en la base: si no, cada alta
    // falla ("too many arguments"). false = el escritor no los manda y el
    // validador rechaza (422) un PO o SO elegido; nunca se tiran.
    public const bool GuardaDuenos = true;
    public static bool GuardaDuenosActiva() { return GuardaDuenos; }

    public const string MotivoDuenos =
        "todav\u00eda no se guarda: el alta en la base no recibe Product Owner ni Service Owner. " +
        "D\u00e9jalo vac\u00edo para guardar (falta aplicar sql/20 en la base).";

    // Lo que consulta el handler (un metodo, para no dejar codigo
    // "inalcanzable" con la constante fija).
    public static bool Activa() { return Habilitada; }

    public const string Estado = Habilitada ? "habilitada" : "no_habilitada";

    // Solo con la persistencia apagada (respuesta 501). Encendida: null.
    public const string Motivo = Habilitada ? null :
        "Persistencia no habilitada: la validaci\u00f3n pas\u00f3, pero no se guard\u00f3 nada. " +
        "Faltan dos pasos, cada uno con su aprobaci\u00f3n: aplicar la migraci\u00f3n de base (sql/18) y proteger " +
        "las iniciativas de Admin frente a la carga del Excel (ADM_04) o retirar esa carga (ADM_03).";

    // Lo que todavia no se guarda aunque la persistencia este encendida.
    public static readonly string[] Bloqueos =
    {
        "quitar categor\u00eda: sin regla aprobada; se rechaza (409) y no se guarda nada",
        "RCA: sin destino de almacenamiento; el archivo no se sube",
    };

    // Con GuardaDuenos = false se suma este bloqueo a los de arriba.
    public const string BloqueoDuenos =
        "Product Owner / Service Owner en Crear: adm.usp_GestionAdmin_Crear no los recibe; se rechazan (422) y no se guarda nada";

    public static List<string> BloqueosVigentes()
    {
        var l = new List<string>(Bloqueos);
        if (!GuardaDuenosActiva()) l.Add(BloqueoDuenos);
        return l;
    }
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
    // Opcionales: al ligar, o para declarar la agrupacion de una
    // ligada que no la tiene. null = no vino.
    public string TipoIniciativa;
    public string TipoAgrupado;
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

    // Una lista OPCIONAL paralela a otra de 'largo' elementos (p. ej. los
    // tipos de cada categoria). No venir = null en todas; venir con otro
    // largo = desparejo.
    public static string[] Paralela(NameValueCollection f, string clave, int largo, out bool desparejos)
    {
        var vals = f.GetValues(clave);
        desparejos = vals != null && vals.Length != largo;
        return vals != null && !desparejos ? vals : new string[largo];
    }
}

public sealed class PeticionModificarAdmin
{
    public const string CFolio = "folio";
    public const string CPctCategoria = "pct_categoria";
    public const string CPctValor = "pct_valor";
    public const string CAgregarCategoria = "agregar_categoria";
    public const string CAgregarPct = "agregar_pct";
    public const string CAgregarTipoIniciativa = "agregar_tipo_iniciativa";
    public const string CAgregarTipoAgrupado = "agregar_tipo_agrupado";
    // Agrupacion declarada para una ligada que no la tiene (paralela a pct_*).
    public const string CPctTipoAgrupado = "pct_tipo_agrupado";
    // Fecha de analisis de una ligada (pares fcat_categoria / fcat_analisis).
    public const string CFCatCategoria = "fcat_categoria";
    public const string CFCatAnalisis = "fcat_analisis";
    public const string CQuitarCategoria = "quitar_categoria";
    public const string CFAnalisis = "f_analisis";
    public const string CFSolucion = "f_solucion";
    public const string CFCierre = "f_cierre";
    public const string CEstado = "estado";
    public const string CSubestado = "subestado";
    // Inmutables: si llegan, se rechaza (el Codigo solo identifica; la
    // fecha de creacion no se reescribe al modificar).
    public static readonly string[] CamposInmutables = { "codigo", "f_creacion" };

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
    // Fecha de analisis por categoria ligada: Texto = aaaa-mm-dd.
    public List<PctCategoria> FechasCategoria = new List<PctCategoria>();
    public List<string> Quitar = new List<string>();
    // Las listas pct_categoria / pct_valor (o agregar_*, fcat_*) no venian parejas.
    public bool PctsDesparejos;
    public bool AgregarDesparejos;
    public bool FechasDesparejas;
    // Campos inmutables que vinieron en el formulario (ver CamposInmutables).
    public List<string> Inmutables = new List<string>();

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
        bool d1, d2, d3;
        var ti = Pares.Paralela(f, CAgregarTipoIniciativa, p.Agregar.Count, out d1);
        var ta = Pares.Paralela(f, CAgregarTipoAgrupado, p.Agregar.Count, out d2);
        for (var i = 0; i < p.Agregar.Count; i++) { p.Agregar[i].TipoIniciativa = ti[i]; p.Agregar[i].TipoAgrupado = ta[i]; }
        var pa = Pares.Paralela(f, CPctTipoAgrupado, p.Pcts.Count, out d3);
        for (var i = 0; i < p.Pcts.Count; i++) p.Pcts[i].TipoAgrupado = pa[i];
        p.AgregarDesparejos = p.AgregarDesparejos || d1 || d2;
        p.PctsDesparejos = p.PctsDesparejos || d3;
        p.FechasCategoria = Pares.Leer(f, CFCatCategoria, CFCatAnalisis, out p.FechasDesparejas);
        p.Quitar = new List<string>(f.GetValues(CQuitarCategoria) ?? new string[0]);
        foreach (var c in CamposInmutables) if (f[c] != null) p.Inmutables.Add(c);
        return p;
    }
}

public sealed class PeticionCrearAdmin
{
    public const string CCatRuta = "cat_ruta";
    public const string CCatPct = "cat_pct";
    // Declarados en el alta (nunca derivados del prefijo).
    public const string CTipoIniciativa = "tipo_iniciativa";
    public const string CTipoAgrupado = "tipo_agrupado";
    public const string CEstado = "estado";
    public const string CFEntregaAnalisis = "f_entrega_analisis";

    public string Tipo, Po, So, Titulo, Descripcion, Observaciones;
    public string TipoIniciativa, TipoAgrupado, Estado;
    // aaaa-mm-dd; vacio = hoy (dbo.Problem.FechaEntregaAnalisis).
    public string FEntregaAnalisis;
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
            TipoIniciativa = f[CTipoIniciativa],
            TipoAgrupado = f[CTipoAgrupado],
            Estado = f[CEstado],
            FEntregaAnalisis = f[CFEntregaAnalisis],
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
        public string Agrup;   // TipoAgrupado (null = sin declarar)
        // Fecha de analisis PROPIA (yyyy-MM-dd), o null si hereda la de la
        // iniciativa (dbo.ProblemCategoria.FechaAnalisisCategoria).
        public string FAnalisisPropia;
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
                a.Categorias.Add(new Categoria
                {
                    Ruta = c.ContainsKey("categoria") ? c["categoria"] as string : null,
                    Pct = pct,
                    Agrup = c.ContainsKey("agrup") ? c["agrup"] as string : null,
                    FAnalisisPropia = c.ContainsKey("f_analisis_propia") ? c["f_analisis_propia"] as string : null,
                });
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
    // dbo.Problem.TipoIniciativa y dbo.ProblemCategoria.TipoAgrupado que ya
    // existen: lo unico que un alta o una categoria ligada puede declarar.
    public readonly HashSet<string> TiposIniciativa = new HashSet<string>(StringComparer.Ordinal);
    public readonly HashSet<string> TiposAgrupado = new HashSet<string>(StringComparer.Ordinal);

    public EstadosProblem(IEnumerable<string> estados, IEnumerable<string> subestados)
        : this(estados, subestados, null, null) { }

    public EstadosProblem(IEnumerable<string> estados, IEnumerable<string> subestados,
                          IEnumerable<string> tiposIniciativa, IEnumerable<string> tiposAgrupado)
    {
        foreach (var e in estados ?? new string[0]) if (!string.IsNullOrEmpty(e)) Estados.Add(e);
        foreach (var s in subestados ?? new string[0]) if (!string.IsNullOrEmpty(s)) Subestados.Add(s);
        foreach (var t in tiposIniciativa ?? new string[0]) if (!string.IsNullOrEmpty(t)) TiposIniciativa.Add(t);
        foreach (var t in tiposAgrupado ?? new string[0]) if (!string.IsNullOrEmpty(t)) TiposAgrupado.Add(t);
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
            { "bloqueos", PersistenciaGestionAdmin.BloqueosVigentes() },
        };
    }
}

public sealed class ValidadorGestionAdmin
{
    public const string CCategorias = "categorias";
    public const string CFechasCategoria = "fechas_categoria";

    // Los de CAMPOS_INCOMPLETA de admin/iniciativa-admin.js, mismo orden.
    // Sin Volumetria: ya no se captura (es calculada, de solo lectura).
    private static readonly string[][] CamposIncompleta =
    {
        new[] { "categoria", "Categor\u00eda" },
        new[] { "titulo", "T\u00edtulo" },
        new[] { "descripcion", "Descripci\u00f3n" },
        new[] { "observaciones", "Observaciones" },
        new[] { "pct", "% Disminuci\u00f3n" },
        new[] { "rca", "RCA" },
        // Opcionales en el alta de ADM (se crea justo cuando falta
        // informacion): si no vienen, la iniciativa queda Incompleta.
        new[] { "tipo_iniciativa", "Clasificaci\u00f3n" },
        new[] { "tipo_agrupado", "Agrupaci\u00f3n" },
        new[] { "estado", "Estado inicial" },
    };

    // Tope al ESCRIBIR (igual que adm.usp_GestionAdmin_*): viva y con
    // agrupacion de AGRUPADORES, o SIN agrupacion (conservador: una fila sin
    // el dato no se salta el tope).
    private static bool ConsumeAlEscribir(string estado, string agrup)
    {
        return ExperienciaQueries.EstadoVivo(estado)
            && (Limpio(agrup) == null || ExperienciaQueries.ConsumeCapacidad(estado, agrup));
    }

    // Fechas compromiso de dbo.Problem que Modificar puede cambiar.
    private static readonly string[][] Fechas =
    {
        new[] { PeticionModificarAdmin.CFAnalisis, "Fecha compromiso de An\u00e1lisis" },
        new[] { PeticionModificarAdmin.CFSolucion, "Fecha compromiso de Soluci\u00f3n" },
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
            " disponible sin contar esta iniciativa (tope 100% por categor\u00eda)" +
            (c.Excedida ? "; la categor\u00eda ya pasa de 100% y solo se puede bajar o dejar igual." : ".");
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
        // Clasificacion, Agrupacion y Estado: opcionales (nunca derivados del
        // prefijo); si faltan, la iniciativa queda Incompleta.
        var entrega = Limpio(p.FEntregaAnalisis);
        if (entrega != null && !EsFecha(entrega))
            r.Agregar(PeticionCrearAdmin.CFEntregaAnalisis, "Fecha de entrega del an\u00e1lisis: escribe una fecha v\u00e1lida (aaaa-mm-dd).");
        if (p.CategoriasDesparejas)
            r.Agregar(CCategorias, "Las categor\u00edas y sus % llegaron incompletos (categor\u00eda sin % o al rev\u00e9s).");
        var vistas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in p.Categorias)
        {
            var ruta = Limpio(c.Categoria);
            var pct = Limpio(c.Texto);
            if (ruta == null)
            {
                r.Agregar(SolicitudIniciativa.CPct, pct == null ? "Una categor\u00eda lleg\u00f3 vac\u00eda."
                    : "El % es por categor\u00eda: elige la Categor\u00eda o deja el % vac\u00edo.");
                continue;
            }
            if (!vistas.Add(Llave(ruta)))
                r.Agregar(CCategorias, ruta + ": la categor\u00eda est\u00e1 repetida.");
            if (pct != null && ValidadorIniciativa.Fraccion(pct) == null)
                r.Agregar(SolicitudIniciativa.CPct, ruta + ": el % debe estar entre 0 y 100, con hasta dos decimales.");
        }
        return r;
    }

    // tipoProblem: el prefijo de Problem en el catalogo (RCA), o null.
    // Compatibilidad: sin la lista de valores existentes (no se pueden
    // revisar Clasificacion, Agrupacion ni Estado: se rechazan).
    public ResultadoGestionAdmin Crear(PeticionCrearAdmin p, CatalogoSolicitud catalogo,
                                       CapacidadCategoria capacidad, string tipoProblem)
    {
        return Crear(p, catalogo, capacidad, tipoProblem, null);
    }

    // existentes: Estado / TipoIniciativa / TipoAgrupado que ya existen
    // (ExperienciaQueries.LeerEstadosProblem); null = no se pudieron leer.
    public ResultadoGestionAdmin Crear(PeticionCrearAdmin p, CatalogoSolicitud catalogo,
                                       CapacidadCategoria capacidad, string tipoProblem, EstadosProblem existentes)
    {
        if (catalogo == null) throw new ArgumentNullException("catalogo");
        if (capacidad == null) throw new ArgumentNullException("capacidad");
        var r = FormatoCrear(p);
        r.CatalogoRevisado = true;

        var tipo = Limpio(p.Tipo);
        if (tipo != null && !catalogo.TieneTipo(tipo))
            r.Agregar(SolicitudIniciativa.CTipo, "El Tipo de iniciativa no est\u00e1 en el cat\u00e1logo.");
        var tipoIni = Limpio(p.TipoIniciativa);
        var agrup = Limpio(p.TipoAgrupado);
        var estado = Limpio(p.Estado);
        if (existentes == null)
        {
            if (tipoIni != null || agrup != null || estado != null)
                r.Agregar(PeticionCrearAdmin.CEstado, "No se pudieron leer los valores existentes de Clasificaci\u00f3n, Agrupaci\u00f3n y Estado: no se puede validar el alta.");
        }
        else
        {
            if (tipoIni != null && !existentes.TiposIniciativa.Contains(tipoIni))
                r.Agregar(PeticionCrearAdmin.CTipoIniciativa, "La Clasificaci\u00f3n no es una de las que ya existen en los problemas.");
            if (agrup != null && !existentes.TiposAgrupado.Contains(agrup))
                r.Agregar(PeticionCrearAdmin.CTipoAgrupado, "La Agrupaci\u00f3n no es una de las que ya existen en las categor\u00edas.");
            if (estado != null && !existentes.Estados.Contains(estado))
                r.Agregar(PeticionCrearAdmin.CEstado, "El Estado no es uno de los que ya existen en los problemas.");
        }
        // El tope solo aplica si las filas van a consumir (estado vivo y
        // agrupacion de AGRUPADORES, o sin agrupacion), igual que
        // adm.usp_GestionAdmin_Crear.
        var consume = ConsumeAlEscribir(estado, agrup);

        var po = Limpio(p.Po);
        var so = Limpio(p.So);
        if (po != null && !catalogo.TienePo(po))
            r.Agregar(SolicitudIniciativa.CPo, "El Product Owner no est\u00e1 en el cat\u00e1logo vigente.");
        if (so != null && !catalogo.TieneSo(so))
            r.Agregar(SolicitudIniciativa.CSo, "El Service Owner no est\u00e1 en el cat\u00e1logo vigente.");
        // Sin la cascada de Nueva solicitud: PO, SO y Categoria no tienen que
        // salir juntos de una fila. Elegidos de la lista pero sin donde
        // guardarse: se rechazan, nunca se tiran en silencio.
        if (po != null && !r.TieneError(SolicitudIniciativa.CPo) && !PersistenciaGestionAdmin.GuardaDuenosActiva())
            r.Agregar(SolicitudIniciativa.CPo, "Product Owner: " + PersistenciaGestionAdmin.MotivoDuenos);
        if (so != null && !r.TieneError(SolicitudIniciativa.CSo) && !PersistenciaGestionAdmin.GuardaDuenosActiva())
            r.Agregar(SolicitudIniciativa.CSo, "Service Owner: " + PersistenciaGestionAdmin.MotivoDuenos);

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
                r.Agregar(SolicitudIniciativa.CCategoria, cat + ": la categor\u00eda no est\u00e1 en el cat\u00e1logo vigente.");
                continue;
            }
            // El Director sale solo de la categoria: PO / SO no la filtran.
            foreach (var f in catalogo.Filas(null, null, cat)) if (!string.IsNullOrEmpty(f.Director)) directores.Add(f.Director);

            var fr = ValidadorIniciativa.Fraccion(Limpio(c.Texto) ?? "");
            if (Limpio(c.Texto) == null) sinPct = true;
            if (fr != null && consume)
            {
                var motivo = Excede(cat, fr.Value, null, capacidad.Para(cat));
                if (motivo != null) r.Agregar(SolicitudIniciativa.CPct, motivo);
            }
        }
        if (directores.Count == 1) foreach (var d in directores) r.Director = d;

        var esProblem = tipo != null && tipoProblem != null && tipo == tipoProblem;
        if (p.TieneRca)
            r.Advertencias.Add("El archivo del RCA se recibi\u00f3 pero no se guarda: no hay destino de almacenamiento aprobado.");

        // INCOMPLETA: los de CAMPOS_INCOMPLETA que faltan.
        var valores = new Dictionary<string, string>
        {
            { "categoria", rutas > 0 ? "si" : null }, { "titulo", Limpio(p.Titulo) },
            { "descripcion", Limpio(p.Descripcion) }, { "observaciones", Limpio(p.Observaciones) },
            // Sin categorias no hay % que revisar: ya cuenta "Categoria".
            { "pct", rutas == 0 || !sinPct ? "si" : null }, { "rca", p.TieneRca ? "si" : null },
            { "tipo_iniciativa", tipoIni }, { "tipo_agrupado", agrup }, { "estado", estado },
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
        foreach (var c in p.Inmutables)
            r.Agregar(c, c == "codigo" ? "El c\u00f3digo de la iniciativa no se modifica: solo la identifica."
                                       : "La fecha de creaci\u00f3n no se modifica.");
        if (p.PctsDesparejos)
            r.Agregar("pct", "Los % por categor\u00eda llegaron incompletos (categor\u00eda sin valor o al rev\u00e9s).");
        if (p.AgregarDesparejos)
            r.Agregar(CCategorias, "Las categor\u00edas a agregar llegaron incompletas (categor\u00eda sin % o al rev\u00e9s).");
        if (p.FechasDesparejas)
            r.Agregar(CFechasCategoria, "Las fechas de an\u00e1lisis por categor\u00eda llegaron incompletas (categor\u00eda sin fecha o al rev\u00e9s).");

        var vistas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) { r.Agregar("pct", "Un % lleg\u00f3 sin categor\u00eda."); continue; }
            if (!vistas.Add(Llave(ruta))) r.Agregar("pct", ruta + ": la categor\u00eda viene repetida.");
            var t = Limpio(x.Texto);
            if (t != null && ValidadorIniciativa.Fraccion(t) == null)
                r.Agregar("pct", ruta + ": el % debe estar entre 0 y 100, con hasta dos decimales.");
        }
        var agregadas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in p.Agregar)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) { r.Agregar(CCategorias, "Una categor\u00eda a agregar lleg\u00f3 vac\u00eda."); continue; }
            if (!agregadas.Add(Llave(ruta))) r.Agregar(CCategorias, ruta + ": se quiere agregar dos veces.");
            var t = Limpio(x.Texto);
            if (t != null && ValidadorIniciativa.Fraccion(t) == null)
                r.Agregar(CCategorias, ruta + ": el % debe estar entre 0 y 100, con hasta dos decimales.");
            // Sus tipos son opcionales y nunca se copian de las hermanas.
        }
        var conFecha = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in p.FechasCategoria)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) { r.Agregar(CFechasCategoria, "Una fecha de an\u00e1lisis lleg\u00f3 sin categor\u00eda."); continue; }
            if (!conFecha.Add(Llave(ruta))) r.Agregar(CFechasCategoria, ruta + ": la fecha de an\u00e1lisis viene repetida.");
            var t = Limpio(x.Texto);
            if (t == null) r.Agregar(CFechasCategoria, ruta + ": la fecha de an\u00e1lisis de una categor\u00eda no se puede vaciar.");
            else if (!EsFecha(t)) r.Agregar(CFechasCategoria, ruta + ": escribe una fecha v\u00e1lida (aaaa-mm-dd).");
        }
        var quitadas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var q in p.Quitar)
        {
            var ruta = Limpio(q);
            if (ruta == null) { r.Agregar(CCategorias, "Una categor\u00eda a quitar lleg\u00f3 vac\u00eda."); continue; }
            if (!quitadas.Add(Llave(ruta))) r.Agregar(CCategorias, ruta + ": se quiere quitar dos veces.");
            if (vistas.Contains(Llave(ruta)))
                r.Agregar(CCategorias, ruta + ": no se puede cambiar el % y quitar la misma categor\u00eda.");
            if (agregadas.Contains(Llave(ruta)))
                r.Agregar(CCategorias, ruta + ": no se puede agregar y quitar la misma categor\u00eda.");
        }
        foreach (var f in Fechas)
        {
            var v = Limpio(Valor(p, f[0]));
            if (v != null && !EsFecha(v)) r.Agregar(f[0], f[1] + ": escribe una fecha v\u00e1lida (aaaa-mm-dd).");
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
            r.Agregar(PeticionModificarAdmin.CFolio, "La iniciativa " + r.Folio + " no est\u00e1 en el registro vigente.");
            return r;
        }

        // ---- Problem: textos ----
        if (p.Titulo != null && Normal(p.Titulo) != Normal(actual.Titulo))
        {
            r.Cambio("titulo", "T\u00edtulo", actual.Titulo, p.Titulo);
            if (Limpio(p.Titulo) == null) r.Advertencias.Add("La iniciativa quedar\u00eda sin T\u00edtulo.");
        }
        if (p.Descripcion != null && Normal(p.Descripcion) != Normal(actual.Descripcion))
            r.Cambio("descripcion", "Descripci\u00f3n", actual.Descripcion, p.Descripcion);
        if (p.Observaciones != null && Normal(p.Observaciones) != Normal(actual.Observaciones))
            r.Cambio("observaciones", "Observaciones", actual.Observaciones, p.Observaciones);

        // ---- Fechas de analisis por categoria ----
        // PROPIA (ligada despues): se cambia en la categoria. Si la categoria
        // HEREDA la de la iniciativa, el cambio es de la iniciativa
        // (f_analisis): no se le crea una fecha propia.
        string fAnalisisHeredada = null;
        foreach (var x in p.FechasCategoria)
        {
            var ruta = Limpio(x.Categoria);
            var t = Limpio(x.Texto);
            if (ruta == null || t == null || !EsFecha(t)) continue;
            var ligada = actual.Ligada(ruta);
            if (ligada == null)
            {
                r.Agregar(CFechasCategoria, ruta + ": no est\u00e1 ligada a esta iniciativa.");
                continue;
            }
            if (Limpio(ligada.FAnalisisPropia) == null)
            {
                if (fAnalisisHeredada != null && fAnalisisHeredada != t)
                    r.Agregar(CFechasCategoria, "Las categor\u00edas que heredan la fecha de la iniciativa comparten una sola fecha de an\u00e1lisis.");
                fAnalisisHeredada = t;
                continue;
            }
            if (t != ligada.FAnalisisPropia)
                r.Cambio(CFechasCategoria, "Fecha de an\u00e1lisis \u00b7 " + ligada.Ruta, ligada.FAnalisisPropia, t);
        }
        if (fAnalisisHeredada != null && p.FAnalisis != null && (Limpio(p.FAnalisis) ?? "") != fAnalisisHeredada)
            r.Agregar(CFechasCategoria, "La fecha de an\u00e1lisis de una categor\u00eda que hereda es la de la iniciativa: lleg\u00f3 distinta a la Fecha compromiso de An\u00e1lisis.");

        // ---- Problem: fechas compromiso ----
        foreach (var f in Fechas)
        {
            var nuevo = Valor(p, f[0]);
            if (f[0] == PeticionModificarAdmin.CFAnalisis && nuevo == null) nuevo = fAnalisisHeredada;
            if (nuevo == null || r.TieneError(f[0])) continue;
            var limpio = Limpio(nuevo) ?? "";
            var anterior = Valor(actual, f[0]) ?? "";
            if (limpio == anterior) continue;
            r.Cambio(f[0], f[1], anterior, limpio);
            if (limpio == "") r.Advertencias.Add(f[1] + ": quedar\u00eda sin fecha.");
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
            r.Advertencias.Add("No hay reglas de transici\u00f3n de Estado/Subestado verificadas: solo se revis\u00f3 que el valor exista.");

        // ---- Categorias ----
        // Capacidad (la misma regla que adm.usp_GestionAdmin_Modificar; la
        // base la vuelve a revisar con candado): consume la fila de una
        // iniciativa VIVA con agrupacion de AGRUPADORES. Se revisa toda fila
        // que va a consumir y antes no (ligada, reactivada) o cuyo % sube;
        // bajar o dejar igual nunca se bloquea. Las DEMAS iniciativas son
        // las que cuentan.
        var estadoFinal = cambiaEstado ? Limpio(p.Estado) : actual.Estado;
        var vivoFinal = ExperienciaQueries.EstadoVivo(estadoFinal);
        var otras = new List<CapacidadCategoria.Compromiso>();
        foreach (var c in compromisos ?? new CapacidadCategoria.Compromiso[0])
            if (!string.Equals(c.Folio, actual.Folio, StringComparison.OrdinalIgnoreCase)) otras.Add(c);
        var capacidad = new CapacidadCategoria(otras);

        var quitar = new HashSet<string>(StringComparer.Ordinal);
        foreach (var q in p.Quitar)
        {
            var ruta = Limpio(q);
            if (ruta == null) continue;
            var ligada = actual.Ligada(ruta);
            if (ligada == null) { r.Agregar(CCategorias, ruta + ": no est\u00e1 ligada a esta iniciativa; no hay nada que quitar."); continue; }
            quitar.Add(Llave(ruta));
            r.Cambio("quitar_categoria", "Quitar categor\u00eda", ligada.Ruta, "");
        }

        // Agrupacion declarada ahora para una ligada que no la tenia.
        var agrupDeclarada = new Dictionary<string, string>(StringComparer.Ordinal);
        var quedaSinPct = false;
        var revisadas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) continue;
            var ligada = actual.Ligada(ruta);
            if (ligada == null)
            {
                r.Agregar("pct", ruta + ": no est\u00e1 ligada a esta iniciativa. Para ligarla, agr\u00e9gala como categor\u00eda nueva.");
                continue;
            }
            var agrupNueva = Limpio(x.TipoAgrupado);
            if (agrupNueva != null)
            {
                if (Limpio(ligada.Agrup) != null)
                {
                    if (agrupNueva != Limpio(ligada.Agrup))
                        r.Agregar("pct", ligada.Ruta + ": su Agrupaci\u00f3n ya est\u00e1 declarada; aqu\u00ed no se cambia.");
                }
                else if (estados == null || !estados.TiposAgrupado.Contains(agrupNueva))
                    r.Agregar("pct", ligada.Ruta + ": la Agrupaci\u00f3n no es una de las que ya existen en las categor\u00edas.");
                else
                {
                    agrupDeclarada[Llave(ligada.Ruta)] = agrupNueva;
                    r.Cambio("tipo_agrupado", "Agrupaci\u00f3n \u00b7 " + ligada.Ruta, "", agrupNueva);
                }
            }
            var t = Limpio(x.Texto);
            var nuevo = t == null ? null : ValidadorIniciativa.Fraccion(t);
            if (t != null && nuevo == null) continue;   // ya reportado en FormatoModificar
            if (nuevo == null) quedaSinPct = true;
            if (nuevo != ligada.Pct)
                r.Cambio("pct", "% Disminuci\u00f3n \u00b7 " + ligada.Ruta, ComoPct(ligada.Pct), ComoPct(nuevo));
            var agrupFinal = agrupDeclarada.ContainsKey(Llave(ligada.Ruta)) ? agrupDeclarada[Llave(ligada.Ruta)] : ligada.Agrup;
            var consumiaAntes = ConsumeAlEscribir(actual.Estado, ligada.Agrup);
            if (nuevo != null && vivoFinal && ConsumeAlEscribir(estadoFinal, agrupFinal)
                && (nuevo != ligada.Pct || !consumiaAntes))
            {
                revisadas.Add(Llave(ligada.Ruta));
                var motivo = Excede(ligada.Ruta, nuevo.Value, consumiaAntes ? ligada.Pct : null, capacidad.Para(ligada.Ruta));
                if (motivo != null) r.Agregar("pct", motivo);
            }
        }

        var agregadas = 0;
        foreach (var x in p.Agregar)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null) continue;
            if (actual.Ligada(ruta) != null)
            {
                r.Agregar(CCategorias, ruta + ": ya est\u00e1 ligada a esta iniciativa; cambia su % en vez de agregarla.");
                continue;
            }
            if (catalogo == null)
            {
                r.Agregar(CCategorias, "No se pudo leer el cat\u00e1logo de categor\u00edas: no se puede agregar " + ruta + ".");
                continue;
            }
            if (!catalogo.TieneCategoria(ruta))
            {
                r.Agregar(CCategorias, ruta + ": la categor\u00eda no est\u00e1 en el cat\u00e1logo vigente.");
                continue;
            }
            var ti = Limpio(x.TipoIniciativa);
            var ta = Limpio(x.TipoAgrupado);
            if (ti != null && (estados == null || !estados.TiposIniciativa.Contains(ti)))
                r.Agregar(CCategorias, ruta + ": la Clasificaci\u00f3n no es una de las que ya existen en los problemas.");
            if (ta != null && (estados == null || !estados.TiposAgrupado.Contains(ta)))
                r.Agregar(CCategorias, ruta + ": la Agrupaci\u00f3n no es una de las que ya existen en las categor\u00edas.");
            var t = Limpio(x.Texto);
            var fr = t == null ? null : ValidadorIniciativa.Fraccion(t);
            if (t != null && fr == null) continue;
            if (fr == null) quedaSinPct = true;
            agregadas++;
            r.Cambio("agregar_categoria", "Agregar categor\u00eda", "", ruta + (fr == null ? " (sin %)" : " \u00b7 " + ComoPct(fr) + "%") +
                (ta != null ? " \u00b7 " + ta : ""));
            if (fr != null && vivoFinal && ConsumeAlEscribir(estadoFinal, ta))
            {
                var motivo = Excede(ruta, fr.Value, null, capacidad.Para(ruta));
                if (motivo != null) r.Agregar(CCategorias, motivo);
            }
        }

        // Reactivada (o con agrupacion recien declarada): las ligadas que
        // pasan a consumir sin que su % cambie tambien se revisan.
        var tocaCapacidad = cambiaEstado || p.Pcts.Count > 0 || p.Agregar.Count > 0;
        if (tocaCapacidad && vivoFinal)
        {
            foreach (var c in actual.Categorias)
            {
                if (quitar.Contains(Llave(c.Ruta)) || revisadas.Contains(Llave(c.Ruta))) continue;
                var agrupFinal = agrupDeclarada.ContainsKey(Llave(c.Ruta)) ? agrupDeclarada[Llave(c.Ruta)] : c.Agrup;
                if (c.Pct == null || c.Pct.Value <= 0) continue;
                if (ConsumeAlEscribir(estadoFinal, agrupFinal) && !ConsumeAlEscribir(actual.Estado, c.Agrup))
                {
                    var motivo = Excede(c.Ruta, c.Pct.Value, null, capacidad.Para(c.Ruta));
                    if (motivo != null) r.Agregar(CCategorias, motivo);
                }
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
            r.Falta("categoria", "Categor\u00eda");
            if (actual.Categorias.Count > 0 && quitar.Count > 0)
                r.Advertencias.Add("La iniciativa quedar\u00eda sin categor\u00edas.");
        }
        else if (sinPct) r.Falta("pct", "% Disminuci\u00f3n");
        return r;
    }
}
