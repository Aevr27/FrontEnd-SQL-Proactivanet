<%@ WebHandler Language="C#" Class="BacklogAntiguos" %>

// Listado de los tickets mas viejos que siguen en backlog, para la tabla
// "Tickets mas antiguos" del tablero de Backlog.
//
// dashboard.js lo pide en cargarTodo() con los filtros del tablero
// (backlog_antiguos.ashx?c1=...&grupos=...&lideres=...&fecha_corte=...) y
// espera:
//
//     { "tickets": [ { "Lider": "...", "Grupo": "...",
//                      "Prioridad": "...", ... }, ... ],
//       "total": 1234 }
//
// AQUI NO SE FILTRA POR ANTIGUEDAD, SE RECORTA POR FECHA DE REGISTRO.
//
// Antes se le pasaba @DiasMinimo = 120 al procedimiento -"mas de 4 meses"-, y
// la tabla se quedaba VACIA cuando el corte no tenia ningun ticket tan viejo,
// que no es lo que la seccion quiere decir: quiere decir "los mas antiguos
// que haya". No hay umbral de edad: @DiasMinimo va en NULL y el procedimiento
// devuelve el corte entero.
//
// La tabla pinta UNA lista global: los Tope (100) tickets mas viejos del
// corte que pasan los filtros, del mas viejo al mas nuevo. Pero el tablero
// tiene ademas un cross-filter por clic -lider, prioridad, grupo- que se
// aplica en el navegador sobre lo que llego. Si aqui se mandaran solo los
// 100 mas viejos globales, filtrar por un lider dejaria los suyos que caen
// en ese top (a veces ninguno), no SUS 100 mas viejos.
//
// Por eso viaja la UNION de:
//
//     ROW_NUMBER() OVER (PARTITION BY Lider     ORDER BY FechaRegistro) <= 100
//     ROW_NUMBER() OVER (PARTITION BY Prioridad ORDER BY FechaRegistro) <= 100
//
// hecho en C# y no en T-SQL porque usp_CorreoBacklog_Datos lo comparte el
// correo diario de direccion y no se toca. El top global ya esta dentro (un
// ticket entre los 100 mas viejos de todos lo esta entre los 100 de su
// lider), y un clic en un lider o en una prioridad encuentra sus 100 mas
// viejos completos. Un grupo cuelga de su lider, asi que sus tickets que
// llegan son siempre los mas viejos del grupo (puede que menos de 100).
//
// No se manda el corte entero: son miles de filas y la respuesta moveria
// dos ordenes de magnitud mas de lo que se ve; el tope es 100 x (lideres +
// prioridades) filas.
//
// FechaRegistro es la fecha que YA definia "mas antiguo" en este endpoint, y
// se conserva: es el dato de origen -DiasBacklog es un derivado del corte- y
// es la columna con la que dashboard.js ya ordenaba. Los tickets sin fecha
// van al final de su lider, nunca por delante de uno con fecha.
//
// El umbral de 120 dias sigue vivo donde si significa algo: el correo diario
// de direccion (reenviacorreo/, antiguos_dias_minimo en su configuracion),
// que es otro consumidor del mismo procedimiento y no se toca.
//
// Ademas del recorte se usa @MaxDescripcion, que el procedimiento ya trae
// justamente para el tablero: la descripcion solo se pinta en un title=,
// recortado ademas a LARGO_TOOLTIP (300) en dashboard.js.
//
// La respuesta lleva tambien `total`: cuantos tickets tenia el corte ANTES
// del recorte. El pie de la tabla lo necesita para decir "X de los Y en
// backlog de este corte", y ese numero ya no se puede contar del arreglo.
//
// Cada ticket lleva ademas IdProactivanet: el Id interno (GUID) con el que
// dashboard.js (celdaCodigo) enlaza el codigo al formulario de la incidencia.
// Ese GUID NO sale de usp_CorreoBacklog_Datos -ese procedimiento lo comparte
// el correo diario y no se toca-, sino de dbo.TicketProactivanetId, que llena
// sincronizar_ids.py desde el equipo del ETL. Aqui solo se lee el mapeo con
// dbo.usp_TicketIds_Obtener: el token del API de Proactivanet vive unicamente
// en el ETL y nunca llega al servidor web.

using System;
using System.Collections.Generic;
using System.Web;
using System.Web.Script.Serialization;

public class BacklogAntiguos : IHttpHandler
{
    // Lo mismo que LARGO_TOOLTIP en dashboard.js: la descripcion solo se usa
    // para el title= de la celda del codigo, y ahi se recorta a 300. Traer
    // mas no cambia nada de lo que se ve.
    private const int MaxDescripcion = 300;

    // Cuantos tickets pinta la tabla. Es el mismo numero que TOPE_ANTIGUOS en
    // backlog/backlog.js; el de aqui decide que viaja por la red (por lider y
    // por prioridad), asi que si se cambia uno, se cambian los dos.
    private const int Tope = 100;

    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var parametros = BacklogUtil.Filtros(context.Request);
            parametros["FechaCorte"] = BacklogUtil.FechaCorte(context.Request);
            // NULL = todos los del corte: no hay umbral de edad. De ahi
            // salen los mas viejos por lider y prioridad, ya aqui; ver la nota de
            // arriba.
            parametros["DiasMinimo"] = null;
            parametros["MaxDescripcion"] = MaxDescripcion;

            var tickets = DashboardDb.Ejecutar("dbo.usp_CorreoBacklog_Datos", parametros);
            var total = tickets.Count;

            // El recorte va ANTES de AgregarIds: asi la consulta del mapeo de
            // Ids pide los codigos que de verdad se van a pintar -cientos- y
            // no los del corte entero.
            var masViejos = MasViejos(tickets);
            AgregarIds(masViejos);

            return new Dictionary<string, object>
            {
                { "tickets", masViejos },
                { "total", total },
            };
        });
    }

    /* La union de los Tope tickets mas viejos de cada lider y de cada
       prioridad, ordenada del mas viejo al mas nuevo. Es el ROW_NUMBER() de
       la nota de arriba, escrito aqui porque el procedimiento se comparte con
       el correo diario y no se toca.

       El orden es total y estable: fecha, luego CodigoTicket y, si aun
       empatan, la posicion original. Dos cargas iguales salen en el mismo
       orden. Una fila sin fecha va detras de todas las que la tienen. */
    private static List<Dictionary<string, object>> MasViejos(
        List<Dictionary<string, object>> tickets)
    {
        var indices = new List<int>();
        for (int i = 0; i < tickets.Count; i++) indices.Add(i);
        indices.Sort(delegate(int a, int b)
        {
            int cmp = ComparaFecha(tickets[a], tickets[b]);
            if (cmp == 0) cmp = string.CompareOrdinal(Texto(tickets[a], "CodigoTicket"), Texto(tickets[b], "CodigoTicket"));
            return cmp != 0 ? cmp : a.CompareTo(b);
        });

        // Ya en orden: el primer Tope de cada lider y de cada prioridad.
        var porLider = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var porPrioridad = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var salida = new List<Dictionary<string, object>>();
        foreach (int i in indices)
        {
            bool entraLider = Contar(porLider, Texto(tickets[i], "Lider"));
            bool entraPrioridad = Contar(porPrioridad, Texto(tickets[i], "Prioridad"));
            if (entraLider || entraPrioridad) salida.Add(tickets[i]);
        }
        return salida;
    }

    // Suma uno a la clave y dice si todavia esta dentro del Tope.
    private static bool Contar(Dictionary<string, int> cuenta, string clave)
    {
        int n;
        cuenta.TryGetValue(clave, out n);
        cuenta[clave] = n + 1;
        return n < Tope;
    }

    private static string Texto(Dictionary<string, object> fila, string campo)
    {
        object v;
        return fila.TryGetValue(campo, out v) && v != null && !(v is DBNull) ? v.ToString() : "";
    }

    // Mas viejo primero por FechaRegistro. Un ticket sin fecha -o con un valor
    // que no se puede leer como fecha- va despues de cualquiera que si la
    // tenga: no se puede afirmar que sea de los mas antiguos de su lider.
    private static int ComparaFecha(Dictionary<string, object> a, Dictionary<string, object> b)
    {
        DateTime? fa = Fecha(a), fb = Fecha(b);
        if (!fa.HasValue) return fb.HasValue ? 1 : 0;
        if (!fb.HasValue) return -1;
        return fa.Value.CompareTo(fb.Value);
    }

    private static DateTime? Fecha(Dictionary<string, object> fila)
    {
        object v;
        if (!fila.TryGetValue("FechaRegistro", out v) || v == null || v is DBNull) return null;
        if (v is DateTime) return (DateTime)v;

        DateTime f;
        if (DateTime.TryParse(v.ToString(), out f)) return f;
        return null;
    }

    // Anade IdProactivanet a cada fila. Es un extra sobre la respuesta del
    // backlog, no un requisito: si el mapeo todavia no tiene el ticket -o si
    // la consulta falla por lo que sea- la clave se queda en null y
    // dashboard.js pinta el codigo como texto plano, sin enlace roto. La tabla
    // se muestra igual: nunca se deja caer el backlog por esto.
    private static void AgregarIds(List<Dictionary<string, object>> tickets)
    {
        var codigos = new List<string>();

        foreach (var t in tickets)
        {
            t["IdProactivanet"] = null;

            object codigo;
            if (t.TryGetValue("CodigoTicket", out codigo) && codigo != null)
                codigos.Add(codigo.ToString());
        }

        if (codigos.Count == 0)
            return;

        var mapa = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var parametros = new Dictionary<string, object>();
            parametros["Codigos"] = new JavaScriptSerializer().Serialize(codigos);

            foreach (var fila in DashboardDb.Ejecutar("dbo.usp_TicketIds_Obtener", parametros))
            {
                object cod, id;
                if (!fila.TryGetValue("CodigoTicket", out cod) || cod == null) continue;
                if (!fila.TryGetValue("IdProactivanet", out id) || id == null) continue;
                mapa[cod.ToString()] = id.ToString();
            }
        }
        catch (Exception ex)
        {
            // Solo el tipo y el mensaje de la excepcion: ni cadena de conexion
            // ni configuracion. Va a la traza de ASP.NET (trace.axd), no al
            // navegador, que sigue recibiendo el backlog completo.
            //
            // Se usa HttpContext.Trace y no System.Diagnostics.Trace porque
            // los metodos de ese ultimo son [Conditional("TRACE")] y ASP.NET
            // no define ese simbolo al compilar App_Code y los .ashx: las
            // llamadas desaparecerian sin dejar rastro.
            var ctx = HttpContext.Current;
            if (ctx != null)
            {
                ctx.Trace.Warn("backlog_antiguos",
                    "No se pudo leer el mapeo de Id de Proactivanet (" +
                    ex.GetType().Name + ": " + ex.Message + "). Los tickets se " +
                    "devuelven sin enlace.");
            }
            return;
        }

        foreach (var t in tickets)
        {
            object codigo;
            if (!t.TryGetValue("CodigoTicket", out codigo) || codigo == null) continue;

            string id;
            if (mapa.TryGetValue(codigo.ToString(), out id))
                t["IdProactivanet"] = id;
        }
    }

    public bool IsReusable { get { return false; } }
}
