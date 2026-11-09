// Contrato de la pestaña "Concentracion de tickets": que procedimiento
// alimenta cada grafica, que columnas se esperan, como se lee el Slot y que
// periodo de fechas es cada uno.
//
// Aqui no hay SQL ni conexion: es la parte PURA del modulo, la que se puede
// probar sin base (tools/tests/ConcentracionContratoSmoke.cs). La lectura
// vive en App_Code/ConcentracionQueries.cs y el endpoint en
// handlers/concentracion.ashx.
//
// DE DONDE SALE EL CONTRATO (verificado en QA el 2026-11-09)
//   sql/diag_concentracion_tickets.sql y _2.sql, leyendo los cuerpos reales
//   de los tres SP (versionados tal cual en sql/81_concentracion_tickets.sql):
//     - parametro unico @Slot INT = 0, sin filtro de servicio: resultado
//       global de todos los servicios habilitados de dbo.CatServicioCorreo;
//     - fuente unica dbo.vw_ServicioTickets, un renglon por ticket;
//     - salida Posicion, <etiqueta>, CantidadTickets, TotalTickets,
//       Porcentaje, PorcentajeAcumulado (DECIMAL(6,2), escala 0-100),
//       TODAS las filas (sin TOP), ordenadas por Posicion;
//     - cada SP excluye su etiqueta vacia, asi que cada uno trae SU
//       TotalTickets. No se igualan: la pestaña muestra el de cada grafica.
//   El Pareto puede llegar en dos versiones y las dos valen:
//     - la actual, agrupada por RamaServicio (Servicio = nombre de la rama);
//     - la de sql/82_pareto_por_servicio.sql (propuesta), agrupada por el
//       codigo de CatServicioCorreo.Servicio y con NombreServicio al final.
//   La etiqueta de cada barra la elige la pestaña: NombreServicio si llega,
//   si no Servicio. Aqui solo se avisa si falta una columna OBLIGATORIA.
//
// SLOT -> FECHAS
//   dbo.vw_Tickets: Slot = DATEDIFF(DAY, FechaRegistro,
//   DATEADD(HOUR, -6, SYSUTCDATETIME())) / 30.0, truncado (diag 2, A2; los
//   rangos reales de A3 lo confirman: Slot 0 = 2026-10-11..2026-11-09 el
//   2026-11-09). O sea, con hoy = el dia de Mexico por UTC-6 FIJO:
//       Slot k = hoy-(30k+29) .. hoy-30k, los dos incluidos (30 dias).
//   Slot 0 INCLUYE hoy. No es el SLOT del stepper de SLA (dashboard.js,
//   slotRango), que cuenta desde AYER y mide 31 dias el 0: ese filtra fechas
//   en el navegador; este es la columna de la base que filtran los SP, y el
//   rotulo tiene que decir las fechas que de verdad se contaron.
//   "Hoy" sale de UTC-6 fijo y no de DashboardDataInfo.HoyEnPresentacion
//   (zona de Windows) para que sea literalmente la misma cuenta que la vista.

using System;
using System.Collections.Generic;
using System.Globalization;

public sealed class ConcentracionBloque
{
    public readonly string Clave;          // llave del JSON
    public readonly string Procedimiento;  // dbo.usp_CorreoServicio_*
    public readonly string Etiqueta;       // columna del nombre de la barra
    public readonly string Nombre;         // como se le dice en los avisos

    public ConcentracionBloque(string clave, string procedimiento, string etiqueta, string nombre)
    {
        Clave = clave;
        Procedimiento = procedimiento;
        Etiqueta = etiqueta;
        Nombre = nombre;
    }

    // Las obligatorias. NombreServicio del Pareto es opcional (ver arriba).
    public string[] Columnas
    {
        get
        {
            return new[] { "Posicion", Etiqueta, "CantidadTickets", "TotalTickets",
                           "Porcentaje", "PorcentajeAcumulado" };
        }
    }
}

public sealed class ConcentracionSolicitudInvalida : Exception
{
    public ConcentracionSolicitudInvalida(string mensaje) : base(mensaje) { }
}

public static class ConcentracionContrato
{
    public static readonly ConcentracionBloque Pareto = new ConcentracionBloque(
        "pareto", "dbo.usp_CorreoServicio_Pareto", "Servicio", "Pareto de servicios");

    public static readonly ConcentracionBloque Categorias = new ConcentracionBloque(
        "categorias", "dbo.usp_CorreoServicio_TicketsCategoria", "Categoria", "Tickets por categoria");

    public static readonly ConcentracionBloque Grupos = new ConcentracionBloque(
        "grupos", "dbo.usp_CorreoServicio_TicketsGrupo", "Grupo", "Tickets por grupo");

    // Los tres, en el orden en que se pintan.
    public static readonly ConcentracionBloque[] Bloques = { Pareto, Categorias, Grupos };

    // El selector de la pestaña: 0..12, 0 por omision (como el stepper de SLA).
    public const int SlotMinimo = 0;
    public const int SlotMaximo = 12;
    public const int DiasSlot = 30;          // = DashboardDataInfo.DiasSlot

    // Desfase de la vista: DATEADD(HOUR, -6, SYSUTCDATETIME()).
    private const int HorasMexico = -6;

    /* ?slot= del query string. Vacio o ausente = 0. Cualquier otra cosa que
       no sea un entero de 0 a 12 es un 400: no se acota en silencio, porque
       el rotulo diria un periodo distinto del que el usuario pidio. */
    public static int LeerSlot(string valor)
    {
        if (valor == null || valor.Trim().Length == 0) return SlotMinimo;
        int slot;
        if (!int.TryParse(valor.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out slot)
            || slot < SlotMinimo || slot > SlotMaximo)
        {
            throw new ConcentracionSolicitudInvalida(
                "El slot debe ser un numero entero de " + SlotMinimo + " a " + SlotMaximo + ".");
        }
        return slot;
    }

    // El dia "hoy" de la vista para el instante utc dado.
    public static DateTime HoyMexico(DateTime utc)
    {
        if (utc.Kind == DateTimeKind.Local) utc = utc.ToUniversalTime();
        return utc.AddHours(HorasMexico).Date;
    }

    // Slot k = hoy-(30k+29) .. hoy-30k, los dos incluidos.
    public static void Periodo(int slot, DateTime hoy, out DateTime desde, out DateTime hasta)
    {
        hasta = hoy.Date.AddDays(-DiasSlot * slot);
        desde = hasta.AddDays(-(DiasSlot - 1));
    }

    /* Copia de las filas en orden de Posicion (estable; sin Posicion, al
       final) y anota en `avisos` lo que no cuadre con el contrato. NUNCA
       corrige un dato: si el acumulado baja o el total cambia de fila a
       fila, se avisa y se pinta lo que llego. La lista original no se toca
       (puede ser la que esta en cache). */
    public static List<Dictionary<string, object>> Preparar(
        ConcentracionBloque bloque, List<Dictionary<string, object>> filas, List<string> avisos)
    {
        var salida = new List<Dictionary<string, object>>(filas ?? new List<Dictionary<string, object>>());
        if (salida.Count == 0) return salida;

        var faltan = new List<string>();
        foreach (var c in bloque.Columnas)
            if (!salida[0].ContainsKey(c)) faltan.Add(c);
        if (faltan.Count > 0)
            avisos.Add(bloque.Nombre + ": " + bloque.Procedimiento + " no devolvio " +
                       string.Join(", ", faltan.ToArray()) + ".");

        // Orden estable por Posicion: List.Sort no lo es, asi que se desempata
        // por el indice original.
        var indice = new Dictionary<Dictionary<string, object>, int>();
        for (int i = 0; i < salida.Count; i++) indice[salida[i]] = i;
        salida.Sort((a, b) =>
        {
            double? pa = Numero(a, "Posicion"), pb = Numero(b, "Posicion");
            if (pa.HasValue && pb.HasValue && pa.Value != pb.Value) return pa.Value.CompareTo(pb.Value);
            if (pa.HasValue != pb.HasValue) return pa.HasValue ? -1 : 1;
            return indice[a].CompareTo(indice[b]);
        });

        double? total = null, previo = null;
        bool totalVaria = false, acumuladoBaja = false, ordenRoto = false;
        double? cantidadPrevia = null;
        foreach (var f in salida)
        {
            var t = Numero(f, "TotalTickets");
            if (t.HasValue)
            {
                if (total.HasValue && total.Value != t.Value) totalVaria = true;
                total = total ?? t;
            }
            var acum = Numero(f, "PorcentajeAcumulado");
            if (acum.HasValue)
            {
                if (previo.HasValue && acum.Value < previo.Value) acumuladoBaja = true;
                previo = acum;
            }
            var cant = Numero(f, "CantidadTickets");
            if (cant.HasValue)
            {
                if (cantidadPrevia.HasValue && cant.Value > cantidadPrevia.Value) ordenRoto = true;
                cantidadPrevia = cant;
            }
        }
        if (totalVaria)
            avisos.Add(bloque.Nombre + ": TotalTickets no es el mismo en todas las filas.");
        if (acumuladoBaja)
            avisos.Add(bloque.Nombre + ": el porcentaje acumulado baja en algun punto.");
        if (ordenRoto)
            avisos.Add(bloque.Nombre + ": las filas no vienen de mayor a menor cantidad de tickets.");
        // El ultimo acumulado debe cerrar en 100 (escala 0-100). Un 1.00 seria
        // escala 0-1; algo lejos de 100, un denominador distinto.
        if (previo.HasValue && Math.Abs(previo.Value - 100.0) > 0.1)
            avisos.Add(bloque.Nombre + ": el acumulado termina en " +
                       previo.Value.ToString("0.##", CultureInfo.InvariantCulture) + " y no en 100.");

        return salida;
    }

    public static double? Numero(Dictionary<string, object> fila, string columna)
    {
        object v;
        if (fila == null || !fila.TryGetValue(columna, out v) || v == null) return null;
        try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); }
        catch (FormatException) { return null; }
        catch (InvalidCastException) { return null; }
    }

    public static string Dia(DateTime d)
    {
        return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }
}
