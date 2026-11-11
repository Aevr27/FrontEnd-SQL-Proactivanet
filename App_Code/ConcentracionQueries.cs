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
//   sobre dbo.fn_CategoriaC1C2 (solo para categorias con caracteres fuera de
//   ConcentracionContrato.C1C2Verificable), y lo que ya lee
//   DirectorioOrganizacional (dbo.CatCategoriaDueno, dbo.CatPersona). En QA,
//   PROACTIVANETAD tiene db_datareader y EXECUTE sobre el esquema dbo (diag 2, B2/B3).
//
// CACHE POR MES (2026-11-11)
//   5 minutos, como QA y SLA. La unidad de cache es el TRAMO:
//     - modo mes: UN MES (sus filas, sin filtros). Elegir varios meses junta
//       los tramos; agregar o quitar uno reusa los demas. Los meses que faltan
//       se leen en UNA sola consulta (OR de sus rangos) y se reparten por
//       FechaRegistro, con los mismos limites [desde, hasta + 1 dia) de la
//       consulta. Los meses no se enciman, y vw_ServicioTickets da un renglon
//       por ticket, asi que juntar tramos = la consulta de todos a la vez.
//     - modo slot: el rango acumulado 0..N, un tramo (como antes): la
//       columna Slot no admite busqueda por indice y partirla en un Slot por
//       consulta multiplicaria los barridos.
//   La llave lleva el dia de hoy (Mexico), como antes: el mes en curso llega
//   hasta hoy y la vista puede depender del dia.
//   Solo se guardan filas SIN filtrar: Service Owner y Grupo se aplican
//   despues, sobre una copia por peticion.
//   Lecturas en vuelo: si otra peticion ya esta leyendo un tramo, se espera
//   su resultado en vez de lanzar la misma consulta otra vez.
//   Crecimiento acotado: a lo mas 13 meses + 13 slots por dia, 5 minutos.
//
// C1&C2 (2026-11-11)
//   Antes: dbo.fn_CategoriaC1C2(v.Categoria) en el SELECT, una llamada a un
//   UDF escalar por ticket. Ahora una vez por categoria DISTINTA de la
//   lectura: en C# (ConcentracionContrato.C1C2) cuando el texto es del
//   conjunto verificado, y con la funcion real, en una consulta chica, para
//   el resto (normalmente ninguna).

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Runtime.ExceptionServices;
using System.Threading;
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

    // Medicion de esta peticion (Server-Timing y pruebas; no se serializa).
    public int TramosCache;            // tramos que ya estaban en la cache
    public int TramosSql;              // tramos leidos por esta peticion
    public int TramosEspera;           // tramos que leyo otra peticion en vuelo
    public int ConsultasPeriodo;       // consultas de filas que lanzo (0 o 1)
    public int C1C2EnCSharp;           // categorias distintas calculadas en C#
    public int C1C2EnSql;              // ... y con dbo.fn_CategoriaC1C2
}

/* Tiempos de una peticion de concentracion.ashx para la cabecera
   Server-Timing (DevTools > Network > Timing), como AnalisisMedicion de
   analisis.ashx. Solo mide: no cambia la respuesta ni hace consultas. Las
   descripciones son conteos, nunca datos de tickets. */
public sealed class ConcentracionMedicion
{
    private readonly Stopwatch total = Stopwatch.StartNew();
    private readonly List<string> partes = new List<string>();

    public void Anotar(string paso, TimeSpan duracion, string descripcion)
    {
        var p = paso + ";dur=" + duracion.TotalMilliseconds.ToString("0.0", CultureInfo.InvariantCulture);
        if (!string.IsNullOrEmpty(descripcion))
            p += ";desc=\"" + descripcion.Replace("\"", "'").Replace("\\", "/").Replace(",", " ") + "\"";
        lock (partes) partes.Add(p);
    }

    // Los pasos anotados y, al final, el total desde que se creo. Las
    // descripciones van sin comas: muchos lectores parten la cabecera por ",".
    public string ServerTiming()
    {
        lock (partes)
        {
            var todas = new List<string>(partes);
            todas.Add("total;dur=" + total.Elapsed.TotalMilliseconds.ToString("0.0", CultureInfo.InvariantCulture));
            return string.Join(", ", todas);
        }
    }
}

public static class ConcentracionQueries
{
    private const int TimeoutComandoSegundos = 90;
    // 5 minutos. No es const para que las pruebas puedan acortarlo.
    internal static int SegundosCache = 300;
    private const string PrefijoCache = "conc:";

    /* Los tickets del periodo. Un renglon por ticket (vw_ServicioTickets ya
       es asi). Slot N: la columna Slot de la vista, sin recalcularla, de 0 a
       N (acumulado, 2026-11-10). Mes: FechaRegistro en [desde, hasta + 1 dia)
       de cada mes leido (OR de rangos). C1 es llave de DirectorioOrganizacional;
       C1C2, la otra, ya no sale de aqui (ver cabecera). FechaRegistro reparte
       las filas entre los meses leidos juntos. */
    private const string SqlBase = @"
SELECT v.CodigoTicket,
       Servicio       = LTRIM(RTRIM(v.Servicio)),
       NombreServicio = LTRIM(RTRIM(s.Descripcion)),
       Categoria      = LTRIM(RTRIM(v.Categoria)),
       Grupo          = LTRIM(RTRIM(v.Grupo)),
       C1             = v.C1Raiz,
       v.FechaRegistroDia,
       v.FechaRegistro
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
        return Consultar(f, hoy, null);
    }

    public static ConcentracionResultado Consultar(ConcentracionFiltros f, DateTime hoy, ConcentracionMedicion medicion)
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
        var periodo = LeerPeriodo(cadena, f, r, medicion);

        // Service Owner. Si el directorio no se puede leer, las graficas
        // siguen sin ese filtro... salvo que se este filtrando por el: no se
        // ignora un filtro en silencio.
        var reloj = Stopwatch.StartNew();
        DirectorioOrganizacional dir = null;
        bool dirDeCache = false;
        try { dir = LeerDirectorio(cadena, r.Hoy, out dirDeCache); }
        catch (Exception ex) { r.FalloDirectorio = ex; }
        if (medicion != null)
            medicion.Anotar("directorio", reloj.Elapsed, dir == null ? "fallo" : (dirDeCache ? "cache" : "sql"));
        if (dir == null && f.ServiceOwners.Count > 0)
            throw new InvalidOperationException(
                "No se pudo leer el catalogo de dueños (dbo.CatCategoriaDueno) para filtrar por Service Owner.", r.FalloDirectorio);
        if (dir == null)
            r.Avisos.Add("No se pudo leer el catalogo de dueños: el filtro de Service Owner no esta disponible (" +
                         DashboardHandler.MensajeSeguro(r.FalloDirectorio) + ").");

        // Copia por peticion: el SO se escribe en la fila y las listas de la
        // cache se comparten entre peticiones.
        reloj.Restart();
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
        if (medicion != null)
            medicion.Anotar("calculo", reloj.Elapsed, "tickets=" + tickets.Count + " filtrados=" + filtrados.Count);
        return r;
    }

    // ------------------------------------------------------------ tramos
    // Lo que se guarda en la cache: las filas sin filtrar de un mes o de los
    // Slots 0..N. Desde/Hasta son dias (Hasta incluido).
    private sealed class Tramo
    {
        public string Clave;
        public DateTime Desde, Hasta;
        public List<ConcentracionTicket> Filas;
    }

    // Una lectura en curso de un tramo: las demas peticiones que lo
    // necesiten esperan aqui en vez de repetir la consulta.
    private sealed class Lectura
    {
        public readonly ManualResetEventSlim Lista = new ManualResetEventSlim(false);
        public List<ConcentracionTicket> Filas;
        public ExceptionDispatchInfo Error;
    }

    private static readonly object Cerrojo = new object();
    private static readonly Dictionary<string, Lectura> EnVuelo = new Dictionary<string, Lectura>(StringComparer.Ordinal);
    private static int consultasPeriodo;

    // Consultas de filas lanzadas desde que arranco el proceso (pruebas).
    public static int ConsultasPeriodoTotales { get { return Volatile.Read(ref consultasPeriodo); } }

    private static List<Tramo> TramosDe(ConcentracionFiltros f, ConcentracionResultado r)
    {
        var dia = ":" + ConcentracionContrato.Dia(r.Hoy);
        var tramos = new List<Tramo>();
        if (f.Modo == ConcentracionContrato.ModoMes)
        {
            foreach (var rg in r.Rangos)
                tramos.Add(new Tramo
                {
                    Clave = PrefijoCache + "mes:" + ConcentracionContrato.Dia(rg.Key) + ".." + ConcentracionContrato.Dia(rg.Value) + dia,
                    Desde = rg.Key, Hasta = rg.Value,
                });
        }
        else
        {
            tramos.Add(new Tramo
            {
                Clave = PrefijoCache + "slot:0-" + f.Slot.ToString(CultureInfo.InvariantCulture) + dia,
                Desde = r.Rangos[0].Key, Hasta = r.Rangos[0].Value,
            });
        }
        return tramos;
    }

    /* Las filas del periodo: la union de sus tramos, cada uno de la cache, de
       una lectura en vuelo de otra peticion, o leido aqui (todos los que
       falten en UNA consulta). Las listas devueltas son de solo lectura. */
    private static List<ConcentracionTicket> LeerPeriodo(string cadena, ConcentracionFiltros f,
                                                         ConcentracionResultado r, ConcentracionMedicion medicion)
    {
        var tramos = TramosDe(f, r);
        var propios = new List<KeyValuePair<Tramo, Lectura>>();
        var ajenos = new List<KeyValuePair<Tramo, Lectura>>();
        lock (Cerrojo)
        {
            foreach (var t in tramos)
            {
                t.Filas = HttpRuntime.Cache[t.Clave] as List<ConcentracionTicket>;
                if (t.Filas != null) { r.TramosCache++; continue; }
                Lectura l;
                if (EnVuelo.TryGetValue(t.Clave, out l)) { ajenos.Add(new KeyValuePair<Tramo, Lectura>(t, l)); continue; }
                l = new Lectura();
                EnVuelo[t.Clave] = l;
                propios.Add(new KeyValuePair<Tramo, Lectura>(t, l));
            }
        }

        var reloj = Stopwatch.StartNew();
        if (propios.Count > 0)
        {
            try
            {
                var leidas = LeerSql(cadena, f, propios.ConvertAll(p => p.Key), r, medicion);
                for (int i = 0; i < propios.Count; i++)
                {
                    var t = propios[i].Key;
                    t.Filas = leidas[i];
                    propios[i].Value.Filas = leidas[i];
                    // En la cache ANTES de salir de "en vuelo": nunca hay un
                    // momento en que el tramo no este en ninguno de los dos.
                    HttpRuntime.Cache.Insert(t.Clave, leidas[i], null,
                        DateTime.UtcNow.AddSeconds(SegundosCache), Cache.NoSlidingExpiration);
                }
                r.TramosSql = propios.Count;
            }
            catch (Exception ex)
            {
                var e = ExceptionDispatchInfo.Capture(ex);
                foreach (var p in propios) p.Value.Error = e;
                throw;
            }
            finally
            {
                lock (Cerrojo) foreach (var p in propios) EnVuelo.Remove(p.Key.Clave);
                foreach (var p in propios) p.Value.Lista.Set();
            }
        }
        if (medicion != null)
            medicion.Anotar("sql", reloj.Elapsed, "consultas=" + r.ConsultasPeriodo + " tramos=" + r.TramosSql +
                            " filas=" + propios.Sum(p => p.Key.Filas == null ? 0 : p.Key.Filas.Count));

        reloj.Restart();
        foreach (var a in ajenos)
        {
            // La otra peticion tiene su propio tiempo limite por consulta;
            // esto solo evita esperar para siempre si algo se cuelga.
            if (!a.Value.Lista.Wait(TimeSpan.FromSeconds(2 * TimeoutComandoSegundos + 30)))
                throw new TimeoutException("La lectura del periodo de otra peticion no termino a tiempo.");
            if (a.Value.Error != null) a.Value.Error.Throw();
            a.Key.Filas = a.Value.Filas;
            r.TramosEspera++;
        }
        if (medicion != null)
            medicion.Anotar("espera", reloj.Elapsed, "tramos=" + r.TramosEspera);
        if (medicion != null)
            medicion.Anotar("cache", TimeSpan.Zero, "tramos=" + r.TramosCache + " de=" + tramos.Count);

        var filas = new List<ConcentracionTicket>(tramos.Sum(t => t.Filas.Count));
        foreach (var t in tramos) filas.AddRange(t.Filas);
        return filas;
    }

    /* UNA consulta para los tramos que faltan; devuelve las filas de cada
       uno, en el mismo orden. Con meses, cada fila va al mes cuyo
       [Desde, Hasta + 1 dia) contiene su FechaRegistro: los mismos limites
       del WHERE. */
    private static List<List<ConcentracionTicket>> LeerSql(string cadena, ConcentracionFiltros f, List<Tramo> tramos,
                                                           ConcentracionResultado r, ConcentracionMedicion medicion)
    {
        var porTramo = new List<List<ConcentracionTicket>>();
        foreach (var t in tramos) porTramo.Add(new List<ConcentracionTicket>());
        var categoriasSql = new List<string>();   // la Categoria tal como la entrega SQL, por fila
        var todas = new List<ConcentracionTicket>();

        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand())
        {
            cmd.Connection = cn;
            cmd.CommandTimeout = TimeoutComandoSegundos;
            bool porMes = f.Modo == ConcentracionContrato.ModoMes;
            if (porMes)
            {
                cmd.CommandText = SqlBase + SqlMeses(tramos.Count);
                for (int i = 0; i < tramos.Count; i++)
                {
                    cmd.Parameters.Add("@Desde" + i, SqlDbType.DateTime2).Value = tramos[i].Desde;
                    cmd.Parameters.Add("@HastaExcl" + i, SqlDbType.DateTime2).Value = tramos[i].Hasta.AddDays(1);
                }
            }
            else
            {
                cmd.CommandText = SqlBase + SqlSlot;
                cmd.Parameters.Add("@Slot", SqlDbType.Int).Value = f.Slot;
            }
            cn.Open();
            Interlocked.Increment(ref consultasPeriodo);
            r.ConsultasPeriodo++;
            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    string categoria = rd.IsDBNull(3) ? null : Convert.ToString(rd.GetValue(3), CultureInfo.InvariantCulture);
                    var t = new ConcentracionTicket
                    {
                        Codigo = Texto(rd, 0), Servicio = Texto(rd, 1), NombreServicio = Texto(rd, 2),
                        Categoria = Recortar(categoria), Grupo = Texto(rd, 4), C1 = Texto(rd, 5),
                        Dia = rd.IsDBNull(6) ? (DateTime?)null : Convert.ToDateTime(rd.GetValue(6), CultureInfo.InvariantCulture),
                    };
                    int destino = 0;
                    if (porMes)
                    {
                        // FechaRegistro no es NULL: el WHERE la compara.
                        var fecha = Convert.ToDateTime(rd.GetValue(7), CultureInfo.InvariantCulture);
                        destino = -1;
                        for (int i = 0; i < tramos.Count && destino < 0; i++)
                            if (fecha >= tramos[i].Desde && fecha < tramos[i].Hasta.AddDays(1)) destino = i;
                        if (destino < 0)
                            throw new InvalidOperationException("Una fila del periodo no cae en ninguno de los meses pedidos.");
                    }
                    porTramo[destino].Add(t);
                    todas.Add(t);
                    categoriasSql.Add(categoria);
                }
            }
        }

        // C1&C2: una vez por categoria distinta de esta lectura.
        var reloj = Stopwatch.StartNew();
        int enCs, enSql;
        var c1c2 = C1C2DeCategorias(cadena, categoriasSql, out enCs, out enSql);
        for (int i = 0; i < todas.Count; i++)
        {
            var k = categoriasSql[i];
            todas[i].C1C2 = Recortar(k == null ? c1c2Nulo : c1c2[k]);
        }
        r.C1C2EnCSharp += enCs;
        r.C1C2EnSql += enSql;
        if (medicion != null)
            medicion.Anotar("c1c2", reloj.Elapsed, "categorias=" + (enCs + enSql) + " csharp=" + enCs + " sql=" + enSql);
        return porTramo;
    }

    // fn_CategoriaC1C2(NULL) = N''.
    private static readonly string c1c2Nulo = ConcentracionContrato.C1C2(null);

    /* C1&C2 de cada categoria DISTINTA (tal como la entrega
       LTRIM(RTRIM(v.Categoria))), sin recortar: lo mismo que devolveria
       dbo.fn_CategoriaC1C2. En C# si el texto es C1C2Verificable; si no, con
       la funcion real, todas en una consulta (parametros de a 500). NULL no
       entra en el diccionario (vale c1c2Nulo). Publica para las pruebas de
       paridad. */
    public static Dictionary<string, string> C1C2DeCategorias(string cadena, IEnumerable<string> categorias,
                                                             out int enCSharp, out int enSql)
    {
        var salida = new Dictionary<string, string>(StringComparer.Ordinal);
        var raras = new List<string>();
        enCSharp = 0;
        foreach (var c in categorias)
        {
            if (c == null || salida.ContainsKey(c)) continue;
            if (ConcentracionContrato.C1C2Verificable(c)) { salida[c] = ConcentracionContrato.C1C2(c); enCSharp++; }
            else { salida[c] = null; raras.Add(c); }
        }
        enSql = raras.Count;
        if (raras.Count == 0) return salida;

        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            for (int desde = 0; desde < raras.Count; desde += 500)
            {
                int n = Math.Min(500, raras.Count - desde);
                using (var cmd = new SqlCommand())
                {
                    cmd.Connection = cn;
                    cmd.CommandTimeout = TimeoutComandoSegundos;
                    var valores = new List<string>();
                    for (int i = 0; i < n; i++)
                    {
                        valores.Add("(" + i.ToString(CultureInfo.InvariantCulture) + ", @c" + i.ToString(CultureInfo.InvariantCulture) + ")");
                        cmd.Parameters.Add("@c" + i.ToString(CultureInfo.InvariantCulture), SqlDbType.NVarChar, 500).Value = raras[desde + i];
                    }
                    cmd.CommandText = "SELECT x.i, C1C2 = dbo.fn_CategoriaC1C2(x.c) FROM (VALUES " +
                                      string.Join(", ", valores) + ") AS x (i, c);";
                    using (var rd = cmd.ExecuteReader())
                        while (rd.Read())
                            salida[raras[desde + rd.GetInt32(0)]] = rd.IsDBNull(1) ? null : rd.GetString(1);
                }
            }
        }
        return salida;
    }

    private static DirectorioOrganizacional LeerDirectorio(string cadena, DateTime hoy, out bool deCache)
    {
        var clave = PrefijoCache + "directorio:" + ConcentracionContrato.Dia(hoy);
        var guardado = HttpRuntime.Cache[clave] as DirectorioOrganizacional;
        deCache = guardado != null;
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
        return Recortar(Convert.ToString(rd.GetValue(i), CultureInfo.InvariantCulture));
    }

    // Como Texto: recortado y '' = null.
    private static string Recortar(string t)
    {
        if (t == null) return null;
        t = t.Trim();
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
