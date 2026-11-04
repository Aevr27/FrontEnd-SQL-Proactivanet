// IdProactivanet de los tickets del Backlog: el Id interno (GUID) con el que
// backlog.js (celdaCodigo) enlaza el codigo al formulario de la incidencia.
//
// Ese GUID NO sale de dbo.CorreoBacklogSnapshot ni de los procedimientos
// usp_CorreoBacklog_* -los comparte el correo diario y no se tocan-, sino de
// dbo.TicketProactivanetId, que llena sincronizar_ids.py desde el equipo del
// ETL. Aqui solo se lee el mapeo con dbo.usp_TicketIds_Obtener: el token del
// API de Proactivanet vive unicamente en el ETL y nunca llega al servidor web.
//
// Lo usan backlog_antiguos.ashx y backlog_categorias.ashx (tickets de un nodo).

using System;
using System.Collections.Generic;
using System.Web;
using System.Web.Script.Serialization;

public static class BacklogTicketIds
{
    // Anade IdProactivanet a cada fila. Es un extra sobre la respuesta del
    // backlog, no un requisito: si el mapeo todavia no tiene el ticket -o si
    // la consulta falla por lo que sea- la clave se queda en null y
    // backlog.js pinta el codigo como texto plano, sin enlace roto. La tabla
    // se muestra igual: nunca se deja caer el backlog por esto.
    // origen: la categoria de la traza (el handler que llama).
    public static void Agregar(List<Dictionary<string, object>> tickets, string origen)
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
                ctx.Trace.Warn(origen,
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
}
