<%@ WebHandler Language="C#" Class="BacklogCatalogos" %>

// Catalogos de los filtros del tablero de Backlog: categoria (C1), grupos,
// lideres y las fechas de corte guardadas en dbo.CorreoBacklogSnapshot.
//
// dashboard.js lo pide una sola vez al abrir la pestana de Backlog, sin query
// string (cargarCatalogos -> obtenerJSON('backlog_catalogos.ashx')), y espera:
//
//     { "c1": [...], "grupos": [...], "lideres": [...], "fechas": [...] }
//
// Las fechas vienen de la mas reciente a la mas vieja: dashboard.js deja
// seleccionada la primera como corte inicial, y si la lista sale vacia
// muestra el aviso de correr dbo.usp_CorreoBacklog_Backfill.
//
// dbo.usp_CorreoBacklog_Catalogos devuelve los cuatro result sets en ese
// orden, con UNA columna cada uno. Lo lee DashboardCatalogos.Backlog()
// (App_Code/DashboardCatalogos.cs), que toma el unico valor de cada fila en
// vez de buscarlo por nombre de columna.

using System;
using System.Collections.Generic;
using System.Web;

public class BacklogCatalogos : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            return DashboardCatalogos.Backlog();
        });
    }

    public bool IsReusable { get { return false; } }
}
