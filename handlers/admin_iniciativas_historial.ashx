<%@ WebHandler Language="C#" Class="AdminIniciativasHistorial" %>

// "Historial de peticiones" de Admin/Iniciativas (admin/historial-peticiones.js,
// pestaña Administracion). App_Code/HistorialPeticiones.cs: las solicitudes
// de iniciativa (sql/29) y de cambio (sql/22) ENVIADAS, en una lista.
//
//   GET [?desde=aaaa-mm-ddThh:mm:ssZ][&hasta=...Z][&tipo=INICIATIVA|CAMBIO]
//       desde incluido, hasta EXCLUIDO (el navegador manda el inicio del dia
//       siguiente a su "Fecha hasta"); sin fechas = todo; sin tipo = los dos.
//   -> 200 { peticiones: [ { tipo, id, folio, fecha_utc, solicitante_nombre,
//            solicitante_cuenta, solicitante_correo, rol_solicitante,
//            iniciativa_codigo, iniciativa_titulo, detalle, estado } ],
//            maximo, total, total_iniciativas, total_cambios,
//            iniciativas_disponible, cambios_disponible }
//          (la mas reciente primero; a lo mas `maximo`, y `total` dice
//          cuantas cumplen el filtro)
//      400 { error, tipo: FiltroInvalido } fecha mal escrita, desde >= hasta
//          o tipo desconocido; no se lee nada.
//   403 antes de leer nada: AccesoAdmin.ExigirAdm (las dos colas que esto
//       junta ya son solo de ADM; MOD y PO/SO ven solo "Mis solicitudes").
//   405 cualquier otro metodo.   500 { error, tipo } si la lectura falla.
//
// SOLO LECTURA: no aprueba, rechaza, edita ni borra. El detalle de cada
// peticion se abre en su vista de siempre (pestaña Solicitudes).

using System;
using System.Collections.Generic;
using System.Web;

public class AdminIniciativasHistorial : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        if (!AccesoAdmin.ExigirAdm(context, HistorialPeticiones.MensajeSoloAdm)) return;

        DashboardHandler.Responder(context, delegate
        {
            if (!string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                return Error(context, 405, "Usa GET.", "MetodoNoPermitido");
            FiltroHistorial filtro;
            var invalido = HistorialPeticiones.LeerFiltro(context.Request.QueryString, out filtro);
            if (invalido != null) return Error(context, 400, invalido, "FiltroInvalido");
            var lectura = HistorialPeticiones.Fuente.Leer(filtro, HistorialPeticiones.Maximo);
            return HistorialPeticiones.Json(lectura, HistorialPeticiones.Maximo);
        });
    }

    private static object Error(HttpContext context, int estado, string mensaje, string tipo)
    {
        context.Response.StatusCode = estado;
        context.Response.TrySkipIisCustomErrors = true;
        return new Dictionary<string, object> { { "error", mensaje }, { "tipo", tipo } };
    }

    public bool IsReusable { get { return false; } }
}
