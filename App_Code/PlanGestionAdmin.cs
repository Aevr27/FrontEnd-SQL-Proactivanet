// Plan de escritura de la gestion directa de ADM (Crear / Modificar): QUE se
// guardaria, con que fechas, a partir de una peticion YA validada por
// ValidadorGestionAdmin. Puro: sin SQL, sin IIS. Lo usa:
//   - el handler (admin_iniciativas_gestion.ashx), para mostrar en la
//     respuesta 501 lo que se habria guardado (nada se guarda);
//   - EscritorGestionAdminSql (App_Code/EscritorGestionAdmin.cs), que NO esta
//     conectado al handler: depende de objetos de BD sin aprobar
//     (sql/18_gestion_admin_persistencia.sql).
//
// FECHAS (regla del negocio: analisis = 15 dias)
//   Alta       FechaCreacion = hoy en Mexico; FechaAnalisis = hoy + 15 dias
//              naturales. Las categorias iniciales COMPARTEN esas fechas: no
//              llevan fecha propia (NULL en la propuesta = "las del
//              problema"), asi que un cambio posterior de la FechaAnalisis
//              del problema las sigue moviendo juntas.
//   Ligar      una categoria agregada despues lleva SU fecha de creacion (hoy)
//              y SU fecha de analisis (hoy + 15). Las del problema y las de
//              las otras categorias no se tocan.
//   Convencion medida en el Excel V3.1 (DBProblems, 530 filas sin cambios
//   de fecha): FechaAnalisis - FechaCreacion = 15 dias es la diferencia mas
//   comun (92), pero no la unica (22: 60, 21: 49, 14: 28). Se aplica la regla
//   de 15 dias naturales; el historico no la sigue siempre.
//
// INMUTABLES al modificar: Codigo (solo identifica) y FechaCreacion.
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
    // Fechas PROPIAS de la categoria. null = comparte las del problema.
    public DateTime? FechaCreacion;
    public DateTime? FechaAnalisis;

    public Dictionary<string, object> ComoJson()
    {
        return new Dictionary<string, object>
        {
            { "categoria", Ruta },
            { "pct", Pct },
            { "fechas_propias", FechaCreacion != null },
            { "f_creacion", FechasGestionAdmin.Iso(FechaCreacion) },
            { "f_analisis", FechasGestionAdmin.Iso(FechaAnalisis) },
        };
    }
}

public sealed class PlanCrearAdmin
{
    public string Prefijo;
    public string Titulo, Descripcion, Observaciones;
    public DateTime FechaCreacion;
    public DateTime FechaAnalisis;
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
            { "f_creacion", FechasGestionAdmin.Iso(FechaCreacion) },
            { "f_analisis", FechasGestionAdmin.Iso(FechaAnalisis) },
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
    // true = registrar el Codigo en adm.ProblemaAdmin (TOMADO) si hoy lo
    // administra el Excel; desde ahi la carga del Excel ya no lo pisa. Nadie
    // lo pone en true todavia: es una decision de negocio sin tomar. Con
    // false, modificar un codigo del Excel se rechaza (51009).
    public bool TomarDelExcel;
    // Campos de dbo.Problem que cambian: clave del formulario -> valor nuevo
    // ("" = se vacia). Solo los que de verdad cambian.
    public Dictionary<string, string> Problem = new Dictionary<string, string>(StringComparer.Ordinal);
    public List<CategoriaPlan> Pcts = new List<CategoriaPlan>();
    public List<CategoriaPlan> Agregar = new List<CategoriaPlan>();
    public List<string> Quitar = new List<string>();
    public List<string> Pendientes = new List<string>();

    public Dictionary<string, object> ComoJson()
    {
        var pcts = new List<object>();
        foreach (var c in Pcts) pcts.Add(c.ComoJson());
        var agregar = new List<object>();
        foreach (var c in Agregar) agregar.Add(c.ComoJson());
        var problem = new Dictionary<string, object>();
        foreach (var kv in Problem) problem[kv.Key] = kv.Value;
        return new Dictionary<string, object>
        {
            { "accion", "modificar" },
            { "codigo", Codigo },
            { "tomar_del_excel", TomarDelExcel },
            { "problem", problem },
            { "pcts", pcts },
            { "agregar", agregar },
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
    };

    public const string PendienteTipos =
        "Tipo de iniciativa / TipoAgrupado de un alta: no hay regla verificada que los derive del prefijo " +
        "(sin TipoAgrupado de AGRUPADORES la fila no consume capacidad).";
    public const string PendienteEstado =
        "Estado inicial de un alta: no verificado (se supone En Análisis por la fecha de análisis).";
    public const string PendienteQuitar =
        "Quitar categorías: falta decidir borrado físico o marca propia (VigenteEnOrigen es del cargador).";

    private static string Limpio(string s)
    {
        if (s == null) return null;
        s = s.Trim();
        return s.Length == 0 ? null : s;
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
            Titulo = p.Titulo, Descripcion = p.Descripcion, Observaciones = p.Observaciones,
            FechaCreacion = hoy.Date,
            FechaAnalisis = FechasGestionAdmin.Analisis(hoy),
        };
        foreach (var c in p.Categorias)
        {
            var ruta = Limpio(c.Categoria);
            if (ruta == null) continue;
            var t = Limpio(c.Texto);
            // Iniciales: SIN fechas propias -> comparten las del problema.
            plan.Categorias.Add(new CategoriaPlan { Ruta = ruta, Pct = t == null ? null : ValidadorIniciativa.Fraccion(t) });
        }
        plan.Pendientes.Add(PendienteTipos);
        plan.Pendientes.Add(PendienteEstado);
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

        // Solo lo que el validador registro como cambio: misma decision.
        var cambiados = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in r.Cambios) cambiados.Add(c["clave"] as string);
        foreach (var campo in CamposProblem)
        {
            if (!cambiados.Contains(campo)) continue;
            plan.Problem[campo] = Limpio(ValorDe(p, campo)) ?? "";
        }

        foreach (var x in p.Pcts)
        {
            var ruta = Limpio(x.Categoria);
            var ligada = ruta == null ? null : actual.Ligada(ruta);
            if (ligada == null) continue;
            var t = Limpio(x.Texto);
            var nuevo = t == null ? null : ValidadorIniciativa.Fraccion(t);
            if (nuevo == ligada.Pct) continue;
            plan.Pcts.Add(new CategoriaPlan { Ruta = ligada.Ruta, Pct = nuevo, PctAnterior = ligada.Pct });
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
                // Ligada despues: fechas PROPIAS, desde el dia en que se liga.
                FechaCreacion = hoy.Date,
                FechaAnalisis = FechasGestionAdmin.Analisis(hoy),
            });
        }

        foreach (var q in p.Quitar)
        {
            var ligada = actual.Ligada(Limpio(q));
            if (ligada != null) plan.Quitar.Add(ligada.Ruta);
        }
        if (plan.Quitar.Count > 0) plan.Pendientes.Add(PendienteQuitar);
        return plan;
    }

    private static string ValorDe(PeticionModificarAdmin p, string campo)
    {
        if (campo == SolicitudIniciativa.CTitulo) return p.Titulo;
        if (campo == SolicitudIniciativa.CDescripcion) return p.Descripcion;
        if (campo == SolicitudIniciativa.CObservaciones) return p.Observaciones;
        if (campo == PeticionModificarAdmin.CEstado) return p.Estado;
        if (campo == PeticionModificarAdmin.CSubestado) return p.Subestado;
        if (campo == PeticionModificarAdmin.CFAnalisis) return p.FAnalisis;
        if (campo == PeticionModificarAdmin.CFSolucion) return p.FSolucion;
        if (campo == PeticionModificarAdmin.CFCierre) return p.FCierre;
        return null;
    }
}
