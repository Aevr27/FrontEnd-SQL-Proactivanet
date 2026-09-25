<%@ WebHandler Language="C#" Class="Catalogos" %>

// Catalogos de los filtros del tablero de SLA: la lista de grupos y la de
// tecnicos que llenan los <select> de dashboard.html.
//
// dashboard.js lo pide una sola vez al arrancar, sin query string
// (cargarCatalogos -> obtenerJSON('catalogos.ashx')), y espera:
//
//     { "grupos": ["...", "..."], "tecnicos": ["...", "..."],
//       "gruposCall": ["...", "..."], "tecnicosCall": ["...", "..."] }
//
// Las dos primeras listas son las de SIEMPRE y no cambian: son los filtros
// del tablero de SLA. Las dos que terminan en 'Call' son el subconjunto del
// Call Center -los grupos que atienden telefono y solo los tecnicos que estan
// en ellos- y viajan aparte, en la misma peticion, porque la barra de filtros
// es UNA sola que viaja entre las dos pestanas: el sitio necesita las dos
// versiones para poder acotar los <select> al entrar al Call Center y
// devolverlos completos al volver a SLA.
//
// Las listas las arma App_Code/DashboardCatalogos.cs: Sla() llama a
// dbo.usp_Dash_Catalogos (dos result sets de UNA columna: grupos primero,
// tecnicos despues) y CallCenter() lee el subconjunto del Call Center. Aqui
// solo se juntan las cuatro llaves del contrato.
//
// A diferencia de kpis/tendencia/productividad/distribucion/detalle, aqui SI
// se usa el stored procedure: esos cinco pasaron a consulta de texto porque
// los nombres de tecnico llevan coma y los procedimientos *Multi los partian
// mal, problema que este no tiene (no recibe ninguna lista).

using System;
using System.Collections.Generic;
using System.Web;

public class Catalogos : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var sla = DashboardCatalogos.Sla();

            // El subconjunto del Call Center NO sale del procedimiento: se
            // consulta aparte (DashboardCatalogos.CallCenter) contra la
            // misma vista que el resto del tablero, que es donde vive la
            // relacion tecnico -> grupo. Asi el procedimiento se queda como
            // esta y las listas de SLA no cambian ni un valor.
            var call = DashboardCatalogos.CallCenter();

            return new Dictionary<string, object>
            {
                { "grupos",       sla["grupos"] },
                { "tecnicos",     sla["tecnicos"] },
                { "gruposCall",   call["grupos"] },
                { "tecnicosCall", call["tecnicos"] },
            };
        });
    }

    public bool IsReusable { get { return false; } }
}
