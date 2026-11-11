// Lectura de la pestaña "Vista general de servicios".
//
// Solo acceso a datos: trae las filas de ticket del periodo (Slots 0..N o uno o varios meses) de
// dbo.vw_ServicioTickets, les pone su Service Owner con
// DirectorioOrganizacional y deja la cuenta a ConcentracionContrato. Nada de
// presentacion ni de HTTP: eso es de concentracion/concentracion.js y
// handlers/concentracion.ashx.
//
// POR QUE NO LOS SP
//   dbo.usp_CorreoServicio_Pareto / _TicketsCategoria / _TicketsGrupo solo
//   aceptan @Slot. Con Mes, Service Owner y Grupo hacia falta cambiarles el
//   contrato (procedimientos ajenos, con dueño y consumidores sin confirmar)
//   o crear objetos nuevos en la base. Se decidio (2026-11-09) leer la MISMA
//   vista que ellos con una consulta parametrizada de solo lectura, como ya
//   hace Experiencia con sus vistas, y resolver los dueños con la regla unica
//   del sitio. Los SP quedan en la base sin tocar.
//
// PERMISOS
//   SELECT sobre dbo.vw_ServicioTickets y dbo.CatServicioCorreo, EXECUTE
//   sobre dbo.fn_CategoriaC1C2, y lo que ya lee DirectorioOrganizacional
//   (dbo.CatCategoriaDueno, dbo.CatPersona). En QA, PROACTIVANETAD tiene
//   db_datareader y EXECUTE sobre el esquema dbo (diag 2, B2/B3).
//
// CACHE
//   5 minutos, como QA y SLA: las filas por periodo + dia (el Slot es
//   relativo a hoy) y el directorio de dueños. Cambiar Service Owner o Grupo
//   no vuelve a la base: filtra las filas ya leidas.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Linq;
using System.Web;
using System.Web.Caching;

public sealed class ConcentracionResultado
{
    public ConcentracionFiltros Filtros;
    public DateTime Hoy;
    public DateTime Desde;             // el dia mas viejo del periodo
    public DateTime Hasta;             // el mas reciente
    // Los rangos que forman el periodo: uno con Slot (acumulado) o con un mes;
    // uno por mes elegido, del mas reciente al mas viejo, con varios meses.
    public readonly List<KeyValuePair<DateTime, DateTime>> Rangos = new List<KeyValuePair<DateTime, DateTime>>();
    public int TicketsPeriodo;
    public int TicketsFiltrados;
    public List<Dictionary<string, object>> Pareto;
    public List<Dictionary<string, object>> Categorias;
    public List<Dictionary<string, object>> Grupos;
    public List<Dictionary<string, object>> OpcionesServiceOwner;
    public List<Dictionary<string, object>> OpcionesGrupo;
    public Dictionary<string, object> Cobertura;
    public readonly List<string> Avisos = new List<string>();
    public Exception FalloDirectorio;      // para la traza; no se serializa
}

public static class ConcentracionQueries
{
    private const int TimeoutComandoSegundos = 90;
    private const int SegundosCache = 300;
    private const string PrefijoCache = "conc:";

    /* Los tickets del periodo. Un renglon por ticket (vw_ServicioTickets ya
       es asi). Slot N: la columna Slot de la vista, sin recalcularla, de 0 a
       N (acumulado, 2026-11-10). Mes: FechaRegistro en [desde, hasta + 1 dia)
       de cada mes elegido (OR de rangos, varios meses 2026-11-10). C1 y C1C2 son las llaves de
       DirectorioOrganizacional (las mismas que usa Experiencia). */
    private const string SqlBase = @"
SELECT v.CodigoTicket,
       Servicio       = LTRIM(RTRIM(v.Servicio)),
       NombreServicio = LTRIM(RTRIM(s.Descripcion)),
       Categoria      = LTRIM(RTRIM(v.Categoria)),
       Grupo          = LTRIM(RTRIM(v.Grupo)),
       C1             = v.C1Raiz,
       C1C2           = dbo.fn_CategoriaC1C2(v.Categoria),
       v.FechaRegistroDia
FROM dbo.vw_ServicioTickets AS v
LEFT JOIN dbo.CatServicioCorreo AS s ON s.Servicio = v.Servicio
WHERE ";
    private const string SqlSlot = "v.Slot >= 0 AND v.Slot <= @Slot;";
    // Un rango por mes: (v.FechaRegistro >= @Desde0 AND v.FechaRegistro < @HastaExcl0) OR ...
    private static string SqlMeses(int n)
    {
        var partes = new List<string>();
        for (int i = 0; i < n; i++)
            partes.Add("(v.FechaRegistro >= @Desde" + i + " AND v.FechaRegistro < @HastaExcl" + i + ")");
        return "(" + string.Join(" OR ", partes) + ");";
    }

    // Los meses del filtro (Meses; si viene vacio, Mes: quien solo fijo Mes).
    public static List<DateTime> MesesDe(ConcentracionFiltros f)
    {
        return f.Meses.Count > 0 ? new List<DateTime>(f.Meses) : new List<DateTime> { f.Mes };
    }

    public static ConcentracionResultado Consultar(ConcentracionFiltros f)
    {
        return Consultar(f, ConcentracionContrato.HoyMexico(DateTime.UtcNow));
    }

    public static ConcentracionResultado Consultar(ConcentracionFiltros f, DateTime hoy)
    {
        var cadena = DashboardDb.CadenaConexion();   // sin Web.config revienta aqui, una vez

        var r = new ConcentracionResultado();
        r.Filtros = f;
        r.Hoy = hoy.Date;
        if (f.Modo == ConcentracionContrato.ModoMes)
        {
            foreach (var m in MesesDe(f))
            {
                DateTime d, h;
                ConcentracionContrato.PeriodoMes(m, hoy, out d, out h);
                r.Rangos.Add(new KeyValuePair<DateTime, DateTime>(d, h));
            }
        }
        else
        {
            DateTime d, h;
            ConcentracionContrato.PeriodoAcumulado(f.Slot, hoy, out d, out h);
            r.Rangos.Add(new KeyValuePair<DateTime, DateTime>(d, h));
        }
        r.Desde = r.Rangos.Min(x => x.Key);
        r.Hasta = r.Rangos.Max(x => x.Value);

        // Filas del periodo (si falla, falla todo: no hay grafica sin ellas).
        var periodo = LeerPeriodo(cadena, f, r);

        // Service Owner. Si el directorio no se puede leer, las graficas
        // siguen sin ese filtro... salvo que se este filtrando por el: no se
        // ignora un filtro en silencio.
        DirectorioOrganizacional dir = null;
        try { dir = LeerDirectorio(cadena, r.Hoy); }
        catch (Exception ex) { r.FalloDirectorio = ex; }
        if (dir == null && f.ServiceOwners.Count > 0)
            throw new InvalidOperationException(
                "No se pudo leer el catalogo de dueños (dbo.CatCategoriaDueno) para filtrar por Service Owner.", r.FalloDirectorio);
        if (dir == null)
            r.Avisos.Add("No se pudo leer el catalogo de dueños: el filtro de Service Owner no esta disponible (" +
                         DashboardHandler.MensajeSeguro(r.FalloDirectorio) + ").");

        // Copia por peticion: el SO se escribe en la fila y la lista de la
        // cache se comparte entre peticiones.
        var tickets = new List<ConcentracionTicket>(periodo.Count);
        foreach (var t in periodo)
        {
            var c = new ConcentracionTicket
            {
                Codigo = t.Codigo, Servicio = t.Servicio, NombreServicio = t.NombreServicio,
                Categoria = t.Categoria, Grupo = t.Grupo, C1 = t.C1, C1C2 = t.C1C2, Dia = t.Dia,
            };
            if (dir != null)
            {
                string po, so, director, manager;
                dir.Resolver(c.C1, c.C1C2, out po, out so, out director, out manager);
                c.ServiceOwner = string.IsNullOrWhiteSpace(so) ? null : so;
            }
            tickets.Add(c);
        }

        r.TicketsPeriodo = tickets.Count;
        r.Cobertura = ConcentracionContrato.Cobertura(tickets, r.Rangos, r.Hoy);
        r.OpcionesServiceOwner = dir == null ? new List<Dictionary<string, object>>()
            : ConcentracionContrato.Opciones(tickets.ConvertAll(t => t.ServiceOwner ?? ConcentracionContrato.SinServiceOwner), f.ServiceOwners);
        r.OpcionesGrupo = ConcentracionContrato.Opciones(tickets.ConvertAll(t => t.Grupo), f.Grupos);

        var filtrados = ConcentracionContrato.Filtrar(tickets, f);
        r.TicketsFiltrados = filtrados.Count;
        r.Pareto = ConcentracionContrato.Pareto(filtrados);
        r.Categorias = ConcentracionContrato.Categorias(filtrados);
        r.Grupos = ConcentracionContrato.Grupos(filtrados);
        return r;
    }

    private static List<ConcentracionTicket> LeerPeriodo(string cadena, ConcentracionFiltros f, ConcentracionResultado r)
    {
        var clave = PrefijoCache + "filas:" + f.Modo + ":" +
                    (f.Modo == ConcentracionContrato.ModoMes
                        ? string.Join("|", MesesDe(f).ConvertAll(ConcentracionContrato.Mes))
                        : "0-" + f.Slot.ToString(CultureInfo.InvariantCulture)) +
                    ":" + ConcentracionContrato.Dia(r.Hoy);
        var guardado = HttpRuntime.Cache[clave] as List<ConcentracionTicket>;
        if (guardado != null) return guardado;

        var filas = new List<ConcentracionTicket>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand())
        {
            cmd.Connection = cn;
            cmd.CommandTimeout = TimeoutComandoSegundos;
            if (f.Modo == ConcentracionContrato.ModoMes)
            {
                cmd.CommandText = SqlBase + SqlMeses(r.Rangos.Count);
                for (int i = 0; i < r.Rangos.Count; i++)
                {
                    cmd.Parameters.Add("@Desde" + i, SqlDbType.DateTime2).Value = r.Rangos[i].Key;
                    cmd.Parameters.Add("@HastaExcl" + i, SqlDbType.DateTime2).Value = r.Rangos[i].Value.AddDays(1);
                }
            }
            else
            {
                cmd.CommandText = SqlBase + SqlSlot;
                cmd.Parameters.Add("@Slot", SqlDbType.Int).Value = f.Slot;
            }
            cn.Open();
            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    filas.Add(new ConcentracionTicket
                    {
                        Codigo = Texto(rd, 0), Servicio = Texto(rd, 1), NombreServicio = Texto(rd, 2),
                        Categoria = Texto(rd, 3), Grupo = Texto(rd, 4), C1 = Texto(rd, 5), C1C2 = Texto(rd, 6),
                        Dia = rd.IsDBNull(7) ? (DateTime?)null : Convert.ToDateTime(rd.GetValue(7), CultureInfo.InvariantCulture),
                    });
                }
            }
        }
        HttpRuntime.Cache.Insert(clave, filas, null, DateTime.UtcNow.AddSeconds(SegundosCache), Cache.NoSlidingExpiration);
        return filas;
    }

    private static DirectorioOrganizacional LeerDirectorio(string cadena, DateTime hoy)
    {
        var clave = PrefijoCache + "directorio:" + ConcentracionContrato.Dia(hoy);
        var guardado = HttpRuntime.Cache[clave] as DirectorioOrganizacional;
        if (guardado != null) return guardado;
        DirectorioOrganizacional dir;
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            dir = DirectorioOrganizacional.Cargar(cn);
        }
        HttpRuntime.Cache.Insert(clave, dir, null, DateTime.UtcNow.AddSeconds(SegundosCache), Cache.NoSlidingExpiration);
        return dir;
    }

    private static string Texto(IDataRecord rd, int i)
    {
        if (rd.IsDBNull(i)) return null;
        var t = Convert.ToString(rd.GetValue(i), CultureInfo.InvariantCulture).Trim();
        return t.Length == 0 ? null : t;
    }

    // Para las pruebas: vacia lo que esta pestaña dejo en la cache.
    public static void LimpiarCache()
    {
        var claves = new List<string>();
        var e = HttpRuntime.Cache.GetEnumerator();
        while (e.MoveNext())
        {
            var k = e.Key as string;
            if (k != null && k.StartsWith(PrefijoCache, StringComparison.Ordinal)) claves.Add(k);
        }
        foreach (var k in claves) HttpRuntime.Cache.Remove(k);
    }

    /* Lo que ve el navegador si falla la lectura. Mismo criterio que
       QareQueries.MensajeBloque: nunca servidor, base, login ni el texto crudo
       de SQL Server, pero diciendo que objeto. */
    public static string MensajeError(Exception ex)
    {
        var inv = ex as InvalidOperationException;
        if (inv != null && inv.InnerException != null) return inv.Message;
        var sql = ex as SqlException;
        if (sql == null) return DashboardHandler.MensajeSeguro(ex);
        var numero = sql.Number.ToString(CultureInfo.InvariantCulture);
        switch (sql.Number)
        {
            case 229:    // permiso denegado
            case 208:    // objeto inexistente
            case 4121:   // funcion inexistente
                return "El sitio no puede leer dbo.vw_ServicioTickets / dbo.fn_CategoriaC1C2 (error " + numero +
                       "): falta el objeto o el permiso.";
            case -2:
                return "La consulta del periodo tardo demasiado y se cancelo (error -2).";
            default:
                return "No se pudo consultar el periodo (error " + numero + "). Revisa la traza del servidor para el detalle.";
        }
    }
}
