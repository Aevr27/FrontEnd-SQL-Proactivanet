<%@ WebHandler Language="C#" Class="BacklogAntiguos" %>

// Listado de los tickets mas viejos que siguen en backlog, para la tabla
// "Tickets mas antiguos" del tablero de Backlog.
//
// dashboard.js lo pide en cargarTodo() con los filtros del tablero
// (backlog_antiguos.ashx?c1=...&grupos=...&lideres=...&fecha_corte=...) y
// espera:
//
//     { "tickets": [ { "Lider": "...", "Grupo": "...",
//                      "Prioridad": "...", ... }, ... ] }
//
// AQUI NO SE FILTRA POR ANTIGUEDAD. Antes se le pasaba @DiasMinimo = 120 al
// procedimiento -"mas de 4 meses"-, y la tabla se quedaba VACIA cuando el
// corte no tenia ningun ticket tan viejo, que no es lo que la seccion quiere
// decir: quiere decir "los mas antiguos que haya". La eleccion es
// cronologica, no de edad minima, y la hace dashboard.js (renderAntiguos)
// sobre los tickets del corte ya filtrados por el tablero: ordena por
// FechaRegistro de mas viejo a mas nuevo y se queda con los primeros
// TOPE_ANTIGUOS. Por eso aqui se piden TODOS los del corte (@DiasMinimo =
// NULL) y no se devuelve ningun umbral.
//
// El umbral de 120 dias sigue vivo donde si significa algo: el correo diario
// de direccion (reenviacorreo/, antiguos_dias_minimo en su configuracion),
// que es otro consumidor del mismo procedimiento y no se toca.
//
// Como ya no hay filtro de edad, el corte entero viaja al navegador, y estas
// descripciones llegan a tener decenas de miles de caracteres. Por eso se usa
// @MaxDescripcion, que el procedimiento ya trae justamente para el tablero:
// la tabla solo pinta la descripcion en un title=, recortado ademas a
// LARGO_TOOLTIP (300) en dashboard.js, asi que mover mas que eso seria tirar
// ancho de banda.
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

    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var parametros = BacklogUtil.Filtros(context.Request);
            parametros["FechaCorte"] = BacklogUtil.FechaCorte(context.Request);
            // NULL = todos los del corte. La seleccion de "los mas antiguos"
            // es cronologica y la hace dashboard.js; ver la nota de arriba.
            parametros["DiasMinimo"] = null;
            parametros["MaxDescripcion"] = MaxDescripcion;

            var tickets = DashboardDb.Ejecutar("dbo.usp_CorreoBacklog_Datos", parametros);
            AgregarIds(tickets);

            return new Dictionary<string, object>
            {
                { "tickets", tickets },
            };
        });
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
