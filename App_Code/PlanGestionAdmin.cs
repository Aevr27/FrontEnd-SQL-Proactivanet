// Plan de escritura de la gestion directa de ADM (Crear / Modificar): QUE se
// guardaria, con que fechas, a partir de una peticion YA validada por
// ValidadorGestionAdmin. Puro: sin SQL, sin IIS. Lo usa:
//   - el handler (admin_iniciativas_gestion.ashx), para mostrar en la
//     respuesta 501 lo que se habria guardado (nada se guarda);
//   - EscritorGestionAdminSql (App_Code/EscritorGestionAdmin.cs), que el
//     handler solo llama con PersistenciaGestionAdmin.Activa() (hoy false):
//     depende de sql/18_gestion_admin_persistencia.sql, sin aplicar en la VM.
//
// FECHAS (regla del negocio: analisis = 15 dias)
//   Alta       FechaCreacion = hoy en Mexico; FechaAnalisis = hoy + 15 dias
//              naturales; FechaEntregaAnalisis = la del formulario (por
//              omision hoy). Las categorias iniciales HEREDAN las fechas de
//              la iniciativa: no llevan fecha propia (NULL), asi que un
//              cambio posterior de la FechaAnalisis de la iniciativa las
//              sigue moviendo juntas.
//   Ligar      una categoria agregada despues lleva SU fecha de creacion (hoy)
//              y SU fecha de analisis (hoy + 15). Las de la iniciativa y las
//              de las otras categorias no se tocan.
//   Editar     la fecha de analisis de una categoria con fecha PROPIA se
//              cambia en ella (FechasCategoria); la de una categoria que
//              HEREDA es la de la iniciativa: el cambio va a f_analisis.
//   Convencion medida en el Excel V3.1 (DBProblems, 530 filas sin cambios
//   de fecha): FechaAnalisis - FechaCreacion = 15 dias es la diferencia mas
//   comun (92), pero no la unica (22: 60, 21: 49, 14: 28). Se aplica la regla
//   de 15 dias naturales; el historico no la sigue siempre.
//
// TIPOS: TipoIniciativa y TipoAgrupado del alta salen del Tipo (prefijo,
// TiposPorPrefijo en PeticionCrearAdmin.DesdeFormulario); Estado del alta y
// los tipos de cada categoria que se liga son los del formulario. Todos se
// validan contra los valores que ya existen, o null si faltan: ADM crea
// justo cuando falta informacion. No se copian de las hermanas.
//
// INMUTABLES al modificar: Codigo (solo identifica) y FechaCreacion.
//
// PO / SO al modificar (sql/24): los CAPTURADOS de la iniciativa
// (dbo.Problem.OwnerProblem / OwnerServicio), nunca los de la categoria.
// Quitar (sql/24): la ligada deja de estar vigente (VigenteEnOrigen = 0),
// la misma baja del cargador; no se borra. Sin sql/24
// (PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva() = false) quitar sigue
// pendiente (409) y el validador ya rechazo PO / SO.
//
// Solo ASCII en literales (App_Code sin BOM): acentos con \uXXXX.

using System;
using System.Collections.Generic;
using System.Globalization;

public static class FechasGestionAdmin
{
    public const int DiasAnalisis = 15;

    public static DateTime Analisis(DateTime creacion)
    {
        return creacion.Date.AddDays(DiasAnalisis);
    }

    public static string Iso(DateTime? d)
    {
        return d == null ? null : d.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    public static DateTime? DeIso(string s)
    {
        DateTime d;
        if (string.IsNullOrEmpty(s)) return null;
        return DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d)
            ? (DateTime?)d : null;
    }
}

public sealed class CategoriaPlan
{
    public string Ruta;
    public decimal? Pct;                // fraccion, como PctDisminucion
    public decimal? PctAnterior;        // solo cambio de %
    // Declarados. En una ligada: null = no cambia.
    public string TipoIniciativa;
    public string TipoAgrupado;
    // Fechas PROPIAS de la categoria. null = hereda las de la iniciativa.
    public DateTime? FechaCreacion;
    public DateTime? FechaAnalisis;

    public Dictionary<string, object> ComoJson()
    {
        return new Dictionary<string, object>
        {
            { "categoria", Ruta },
            { "pct", Pct },
            { "tipo_iniciativa", TipoIniciativa },
            { "tipo_agrupado", TipoAgrupado },
            { "fechas_propias", FechaCreacion != null },
            { "f_creacion", FechasGestionAdmin.Iso(FechaCreacion) },
            { "f_analisis", FechasGestionAdmin.Iso(FechaAnalisis) },
        };
    }
}

// Nueva fecha de analisis PROPIA de una categoria ya ligada.
public sealed class FechaCategoriaPlan
{
    public string Ruta;
    public DateTime FechaAnalisis;
    public DateTime? Anterior;

    public Dictionary<string, object> ComoJson()
    {
        return new Dictionary<string, object>
        {
            { "categoria", Ruta },
            { "f_analisis", FechasGestionAdmin.Iso(FechaAnalisis) },
            { "anterior", FechasGestionAdmin.Iso(Anterior) },
        };
    }
}

public sealed class PlanCrearAdmin
{
    public string Prefijo;
    public string TipoIniciativa, TipoAgrupado, Estado;
    // Subestado elegido (dbo.Problem.Subestado, sql/27); null = sin elegir.
    public string Subestado;
    // PO / SO elegidos (dbo.Problem.OwnerProblem / OwnerServicio); null = sin elegir.
    public string Po, So;
    // Volumetria fijada por ADM (dbo.Problem.VolumetriaOriginal, sql/26); null = no la fijo.
    public int? Volumetria;
    public string Titulo, Descripcion, Observaciones;
    public DateTime FechaCreacion;
    public DateTime FechaAnalisis;
    public DateTime FechaEntregaAnalisis;
    public List<CategoriaPlan> Categorias = new List<CategoriaPlan>();
    // Lo que el plan NO puede decidir con lo verificado: el escritor no
    // debe correr mientras haya alguno.
    public List<string> Pendientes = new List<string>();

    public Dictionary<string, object> ComoJson()
    {
        var cats = new List<object>();
        foreach (var c in Categorias) cats.Add(c.ComoJson());
        return new Dictionary<string, object>
        {
            { "accion", "crear" },
            { "codigo", null },
            { "prefijo", Prefijo },
            { "tipo_iniciativa", TipoIniciativa },
            { "tipo_agrupado", TipoAgrupado },
            { "estado", Estado },
            { "subestado", Subestado },
            { "po", Po },
            { "so", So },
            { "volumetria", Volumetria },
            { "f_creacion", FechasGestionAdmin.Iso(FechaCreacion) },
            { "f_analisis", FechasGestionAdmin.Iso(FechaAnalisis) },
            { "f_entrega_analisis", FechasGestionAdmin.Iso(FechaEntregaAnalisis) },
            { "dias_analisis", FechasGestionAdmin.DiasAnalisis },
            { "categorias", cats },
            { "pendientes", Pendientes },
        };
    }
}

public sealed class PlanModificarAdmin
{
    public string Codigo;
    // El dia del guardado (Mexico): de el salen las fechas de lo que se liga.
    public DateTime Hoy;
    // Campos de dbo.Problem que cambian: clave del formulario -> valor nuevo
    // ("" = se vacia). Solo los que de verdad cambian.
    public Dictionary<string, string> Problem = new Dictionary<string, string>(StringComparer.Ordinal);
    public List<CategoriaPlan> Pcts = new List<CategoriaPlan>();
    public List<CategoriaPlan> Agregar = new List<CategoriaPlan>();
    public List<FechaCategoriaPlan> FechasCategoria = new List<FechaCategoriaPlan>();
    public List<string> Quitar = new List<string>();
    public List<string> Pendientes = new List<string>();

    public Dictionary<string, object> ComoJson()
    {
        var pcts = new List<object>();
        foreach (var c in Pcts) pcts.Add(c.ComoJson());
        var agregar = new List<object>();
        foreach (var c in Agregar) agregar.Add(c.ComoJson());
        var fechas = new List<object>();
        foreach (var f in FechasCategoria) fechas.Add(f.ComoJson());
        var problem = new Dictionary<string, object>();
        foreach (var kv in Problem) problem[kv.Key] = kv.Value;
        return new Dictionary<string, object>
        {
            { "accion", "modificar" },
            { "codigo", Codigo },
            { "problem", problem },
            { "pcts", pcts },
            { "agregar", agregar },
            { "fechas_categoria", fechas },
            { "quitar", Quitar },
            { "dias_analisis", FechasGestionAdmin.DiasAnalisis },
            { "pendientes", Pendientes },
        };
    }
}

public static class PlanificadorGestionAdmin
{
    // Campos de dbo.Problem que Modificar puede tocar (las claves del
    // formulario). Codigo y FechaCreacion no estan: son inmutables.
    public static readonly string[] CamposProblem =
    {
        SolicitudIniciativa.CTitulo, SolicitudIniciativa.CDescripcion, SolicitudIniciativa.CObservaciones,
        PeticionModificarAdmin.CEstado, PeticionModificarAdmin.CSubestado,
        PeticionModificarAdmin.CFAnalisis, PeticionModificarAdmin.CFSolucion, PeticionModificarAdmin.CFCierre,
        SolicitudIniciativa.CPo, SolicitudIniciativa.CSo,
    };

    public const string PendienteQuitar =
        "Quitar categor\u00edas: la base todav\u00eda no las recibe (falta aplicar sql/24, que requiere sql/23). Usa Restaurar para guardar lo dem\u00e1s.";

    private static string Limpio(string s)
    {
        if (s == null) return null;
        s = s.Trim();
        return s.Length == 0 ? null : s;
    }

    private static string Texto(string s) { return string.IsNullOrWhiteSpace(s) ? null : s; }

    // Fecha al ENTRAR a un estado (2026-10-20): pasar a Cerrado llena
    // FechaCierre con hoy (Mexico, plan.Hoy), SOLO si la fecha queda vacia
    // tras el guardado (ni la tenia ni la trae el formulario). Una fecha que
    // ya existe nunca se pisa. Solo en la transicion: guardar algo que ya
    // estaba Cerrado no toca nada (el Estado ni entra al plan si no cambia).
    // Va por @CambiaFCierre como cualquier edicion: el trigger de sql/17
    // registra el evento (NULL -> fecha es "asignar": no suma a
    // NroCambioFecha*).
    // En Solucion NO llena FechaSolucion: es la fecha COMPROMISO del
    // semaforo (con hoy saldria Atrasada al dia siguiente). Diferido hasta
    // revisar si hace falta una fecha real de solucion.
    //
    // La misma regla con el compromiso a 15 dias (2026-10-26, decidida por
    // el negocio): pasar a En Analisis llena FechaSolucion y pasar a En
    // Monitoreo llena FechaCierre con el dia de la aprobacion (plan.Hoy: el
    // dia en que ADM guarda el cambio) + DiasCompromiso, solo si quedan
    // vacias. OJO: solo la edicion directa pasa por aqui; una solicitud de
    // cambio aplicada escribe en adm.usp_SolicitudCambio_Aplicar (sql/22,
    // sql/25), que no aplica estas reglas ni la de Cerrado.
    public const string EstadoCerrado = "Cerrado";
    public const string EstadoEnAnalisis = "En An\u00e1lisis";
    public const string EstadoEnMonitoreo = "En Monitoreo";
    public const int DiasCompromiso = 15;

    private static void FechaAlEntrar(PlanModificarAdmin plan, IniciativaActual actual,
                                      string estado, string campo, string vigente, int dias = 0)
    {
        string nuevoEstado, pedida;
        if (!plan.Problem.TryGetValue(PeticionModificarAdmin.CEstado, out nuevoEstado)) return;
        if (!MismoEstado(nuevoEstado, estado) || MismoEstado(actual.Estado, estado)) return;
        var queda = plan.Problem.TryGetValue(campo, out pedida) ? pedida : vigente;
        if (Limpio(queda) != null) return;
        plan.Problem[campo] = FechasGestionAdmin.Iso(plan.Hoy.AddDays(dias));
    }

    // Sin mayusculas, acentos ni espacios de mas (como Clave de
    // ExperienciaQueries para el semaforo).
    private static bool MismoEstado(string a, string b)
    {
        return Plano(a) == Plano(b);
    }

    private static string Plano(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var normal = s.Trim().ToUpperInvariant().Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder(normal.Length);
        foreach (var c in normal)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return sb.ToString();
    }

    // r: el resultado del validador para ESTA peticion; tiene que ser valido.
    public static PlanCrearAdmin Crear(PeticionCrearAdmin p, ResultadoGestionAdmin r, DateTime hoy)
    {
        if (p == null) throw new ArgumentNullException("p");
        if (r == null || !r.Valida || r.Accion != "crear")
            throw new InvalidOperationException("Solo se planea un alta que ya paso la validacion.");
        var plan = new PlanCrearAdmin
        {
            Prefijo = Limpio(p.Tipo),
            TipoIniciativa = Limpio(p.TipoIniciativa),
            TipoAgrupado = Limpio(p.TipoAgrupado),
            Estado = Limpio(p.Estado),
            Subestado = Limpio(p.Subestado),
            Po = Limpio(p.Po), So = Limpio(p.So),
            Volumetria = ValidadorGestionAdmin.Volumetria(p.Volumetria),
            // Solo espacios = NULL; con texto, tal cual (no se recorta).
            Titulo = Texto(p.Titulo), Descripcion = Texto(p.Descripcion), Observaciones = Texto(p.Observaciones),
            FechaCreacion = hoy.Date,
            FechaAnalisis = FechasGestionAdmin.Analisis(hoy),
            FechaEntregaAnalisis = FechasGestionAdmin.DeIso(Limpio(p.FEntregaAnalisis)) ?? hoy.Date,
        };
        foreach (var c in p.Categorias)
        {
            var ruta = Limpio(c.Categoria);
            if (ruta == null) continue;
            var t = Limpio(c.Texto);
            // Iniciales: SIN fechas propias -> heredan las de la iniciativa;
            // sus tipos son los del alta.
            plan.Categorias.Add(new CategoriaPlan
            {
                Ruta = ruta, Pct = t == null ? null : ValidadorIniciativa.Fraccion(t),
                TipoIniciativa = plan.TipoIniciativa, TipoAgrupado = plan.TipoAgrupado,
            });
        }
        // Ya no hay pendientes de tipos ni de estado: se declaran y se validan.
        return plan;
    }

    public static PlanModificarAdmin Modificar(PeticionModificarAdmin p, IniciativaActual actual,
                                               ResultadoGestionAdmin r, DateTime hoy)
    {
        if (p == null) throw new ArgumentNullException("p");
        if (actual == null) throw new ArgumentNullException("actual");
        if (r == null || !r.Valida || r.Accion != "modificar")
            throw new InvalidOperationException("Solo se planea una modificacion que ya paso la validacion.");
        // El codigo es el de la iniciativa leida, nunca uno que mande el cliente.
        var plan = new PlanModificarAdmin { Codigo = actual.Folio, Hoy = hoy.Date };

        // Solo lo que el validador registro como cambio, con SU valor nuevo:
        // misma decision (incluye f_analisis cuando llego como la fecha de
        // una categoria que hereda la de la iniciativa).
        var cambiados = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var c in r.Cambios) cambiados[c["clave"] as string ?? ""] = c["nuevo"] as string;
        foreach (var campo in CamposProblem)
        {
            string nuevo;
            if (!cambiados.TryGetValue(campo, out nuevo)) continue;
            plan.Problem[campo] = Limpio(nuevo) ?? "";
        }
        FechaAlEntrar(plan, actual, EstadoCerrado, PeticionModificarAdmin.CFCierre, actual.FCierre);
        FechaAlEntrar(plan, actual, EstadoEnAnalisis, PeticionModificarAdmin.CFSolucion, actual.FSolucion, DiasCompromiso);
        FechaAlEntrar(plan, actual, EstadoEnMonitoreo, PeticionModificarAdmin.CFCierre, actual.FCierre, DiasCompromiso);

        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            var ligada = ruta == null ? null : actual.Ligada(ruta);
            if (ligada == null) continue;
            var t = Limpio(x.Texto);
            var nuevo = t == null ? null : ValidadorIniciativa.Fraccion(t);
            // Agrupacion declarada solo para una ligada que no la tiene.
            var agrup = Limpio(ligada.Agrup) == null ? Limpio(x.TipoAgrupado) : null;
            if (nuevo == ligada.Pct && agrup == null) continue;
            plan.Pcts.Add(new CategoriaPlan { Ruta = ligada.Ruta, Pct = nuevo, PctAnterior = ligada.Pct, TipoAgrupado = agrup });
        }

        foreach (var x in p.Agregar)
        {
            var ruta = Limpio(x.Categoria);
            if (ruta == null || actual.Ligada(ruta) != null) continue;
            var t = Limpio(x.Texto);
            plan.Agregar.Add(new CategoriaPlan
            {
                Ruta = ruta,
                Pct = t == null ? null : ValidadorIniciativa.Fraccion(t),
                TipoIniciativa = Limpio(x.TipoIniciativa),
                TipoAgrupado = Limpio(x.TipoAgrupado),
                // Ligada despues: fechas PROPIAS, desde el dia en que se liga.
                FechaCreacion = hoy.Date,
                FechaAnalisis = FechasGestionAdmin.Analisis(hoy),
            });
        }

        // Fechas de analisis por categoria: las PROPIAS se cambian en la
        // categoria; las que heredan ya las convirtio el validador en un
        // cambio de f_analisis (de la iniciativa), que va arriba.
        foreach (var f in p.FechasCategoria)
        {
            var ligada = actual.Ligada(Limpio(f.Categoria));
            var nueva = FechasGestionAdmin.DeIso(Limpio(f.Texto));
            if (ligada == null || nueva == null || ligada.FAnalisisPropia == null) continue;
            var anterior = FechasGestionAdmin.DeIso(ligada.FAnalisisPropia);
            if (anterior == nueva) continue;
            plan.FechasCategoria.Add(new FechaCategoriaPlan { Ruta = ligada.Ruta, FechaAnalisis = nueva.Value, Anterior = anterior });
        }

        foreach (var q in p.Quitar)
        {
            var ligada = actual.Ligada(Limpio(q));
            if (ligada != null) plan.Quitar.Add(ligada.Ruta);
        }
        if (plan.Quitar.Count > 0 && !PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva()) plan.Pendientes.Add(PendienteQuitar);
        return plan;
    }
}
