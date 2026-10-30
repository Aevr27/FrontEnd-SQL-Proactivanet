// Automatizados SLA de Experiencia, repartidos por dueño
// (handlers/experiencia_automatizados.ashx).
//
// QUE CUENTA
// ----------
// Lo mismo que la tarjeta "Automatizado" de SLA: TicketsAutomatizados de
// DashboardQueries.Kpis, los tickets RESUELTOS en el periodo (firma de
// solucion, sin rechazados) por una cuenta de dbo.CatCuentaNoPersona, con el
// mismo ?tipo. No hay regla nueva de que es automatizado: las filas salen de
// DashboardQueries.AutomatizadosPorCategoria, que usa el mismo predicado y la
// misma rama de EsPersona que Kpis.
//
// A QUIEN SE LE CUENTA
// --------------------
// Al dueño de la categoria del ticket, con la UNICA resolucion de dueños del
// sitio: cortes C1 / C1&C2 de la ruta (CortesDeRuta, las replicas de
// fn_CategoriaC1 / fn_CategoriaC1C2) y DirectorioOrganizacional.Resolver (N2
// exacto, si no el del C1; Manager = el de su SO en CatPersona). Es lo que
// hace el export de tickets (PasaExport) y lo que da sus dueños a las
// categorias del tablero, asi que el filtro de Director / PO / Manager / SO
// del navegador (pasaFiltroGlobal) significa lo mismo para el volumen y para
// los automatizados. Un ticket sin categoria o sin dueño capturado queda con
// dueños null: entra en el total y en ningun filtro.
//
// Cada ticket cae en UN periodo y UNA fila de dueños, asi que la suma de las
// filas de un periodo es su total: nada se resta dos veces ni a otro dueño.
//
// SOLO LECTURA: el SELECT de AutomatizadosPorCategoria y los dos catalogos de
// DirectorioOrganizacional.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;

public static partial class ExperienciaQueries
{
    // Tope de periodos por peticion: 12 SLOTs o un año de meses. El tablero
    // pide 10 SLOTs o los meses del año en curso.
    private const int MAX_PERIODOS_AUTOMATIZADOS = 12;

    // inicio..fin (los dos incluidos) tiene que ser una serie de periodos
    // enteros del modo: SLOTs de DashboardDataInfo.DiasSlot dias que acaban en
    // fin, o meses completos de un solo año.
    public static void ValidarRangoAutomatizados(string modo, DateTime inicio, DateTime fin)
    {
        if (inicio > fin)
            throw new ArgumentException("La fecha inicio es posterior a la fecha fin.");
        if (modo == MODO_SLOT)
        {
            int dias = (int)(fin.Date - inicio.Date).TotalDays + 1;
            if (dias % DashboardDataInfo.DiasSlot != 0
                || dias / DashboardDataInfo.DiasSlot > MAX_PERIODOS_AUTOMATIZADOS)
                throw new ArgumentException("El rango no es una serie de SLOTs completos.");
            return;
        }
        if (modo == MODO_MES)
        {
            if (inicio.Day != 1 || inicio.Year != fin.Year
                || fin.Day != DateTime.DaysInMonth(fin.Year, fin.Month))
                throw new ArgumentException("El rango no es una serie de meses completos de un año.");
            return;
        }
        throw new ArgumentException("El parametro 'modo' debe ser 'slot' o 'mes'.");
    }

    public static Dictionary<string, object> Automatizados(string modo, DateTime inicio, DateTime fin,
        List<string> tiposRegistro)
    {
        ValidarRangoAutomatizados(modo, inicio, fin);

        var f = new DashboardQueries.Filtros();
        f.FechaInicio = inicio.Date;
        f.FechaFin = fin.Date;
        f.TiposRegistro = tiposRegistro ?? new List<string>();
        var filas = DashboardQueries.AutomatizadosPorCategoria(f, modo == MODO_MES);

        DirectorioOrganizacional dir = null;
        foreach (var fila in filas)
        {
            if (Entero(fila["EsTotal"]) != 0) continue;
            using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
            {
                cn.Open();
                dir = DirectorioOrganizacional.Cargar(cn);
            }
            break;
        }

        var salida = new Dictionary<string, object>();
        salida["modo"] = modo;
        salida["fechaInicio"] = inicio.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        salida["fechaFin"] = fin.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        salida["periodos"] = PeriodosAutomatizados(filas);
        salida["duenos"] = DuenosAutomatizados(filas, dir);
        return salida;
    }

    // Una fila por periodo con algun resuelto: el total de automatizados (=
    // TicketsAutomatizados de Kpis con ese rango) y el de resueltos. Un
    // periodo que no esta aqui no tuvo ni un resuelto: Kpis daba NULL.
    private static List<object> PeriodosAutomatizados(List<Dictionary<string, object>> filas)
    {
        var salida = new List<object>();
        foreach (var fila in filas)
        {
            if (Entero(fila["EsTotal"]) == 0) continue;
            var p = new Dictionary<string, object>();
            p["periodo"] = Entero(fila["Periodo"]);
            p["automatizados"] = Entero(fila["Automatizados"]);
            p["resueltos"] = Entero(fila["Resueltos"]);
            salida.Add(p);
        }
        return salida;
    }

    // Automatizados por periodo y dueños. Varias categorias con los mismos
    // dueños se suman en una fila; los dueños van con el nombre normalizado de
    // DirectorioOrganizacional, el mismo que traen las categorias.
    private static List<object> DuenosAutomatizados(List<Dictionary<string, object>> filas,
        DirectorioOrganizacional dir)
    {
        const char sep = (char)31;
        var orden = new List<string>();
        var porLlave = new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);

        foreach (var fila in filas)
        {
            if (Entero(fila["EsTotal"]) != 0) continue;
            int n = Entero(fila["Automatizados"]);
            if (n <= 0) continue;

            string c1, c1c2, po = null, so = null, director = null, manager = null;
            CortesDeRuta(fila["Categoria"] as string, out c1, out c1c2);
            if (dir != null && c1 != null)
                dir.Resolver(c1, c1c2, out po, out so, out director, out manager);

            int periodo = Entero(fila["Periodo"]);
            string llave = periodo.ToString(CultureInfo.InvariantCulture) + sep + director + sep + po
                + sep + manager + sep + so;
            Dictionary<string, object> d;
            if (!porLlave.TryGetValue(llave, out d))
            {
                d = new Dictionary<string, object>();
                d["periodo"] = periodo;
                d["director"] = director;
                d["po"] = po;
                d["manager"] = manager;
                d["so"] = so;
                d["automatizados"] = 0;
                porLlave[llave] = d;
                orden.Add(llave);
            }
            d["automatizados"] = (int)d["automatizados"] + n;
        }

        var salida = new List<object>();
        foreach (var llave in orden) salida.Add(porLlave[llave]);
        return salida;
    }
}
