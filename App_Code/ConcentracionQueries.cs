// Lectura de los tres procedimientos de la pestaña "Concentracion de
// tickets".
//
// Solo acceso a datos: ejecuta dbo.usp_CorreoServicio_Pareto,
// _TicketsCategoria y _TicketsGrupo con el MISMO @Slot y entrega las filas a
// ConcentracionContrato.Preparar. Nada de presentacion ni de HTTP: eso es de
// concentracion/concentracion.js y handlers/concentracion.ashx.
//
// UNA GRAFICA QUE FALLA NO TUMBA A LAS DEMAS
//   Igual que QareQueries: cada procedimiento corre por separado, en paralelo
//   y con su conexion del pool (cada uno tarda 1-1.6 s en QA; juntos, lo que
//   tarde el mas lento). Su fallo queda en Errores[clave] con el bloque en
//   null. Solo si fallan LOS TRES se relanza la primera excepcion para que
//   el handler conteste 500.
//
// CACHE
//   5 minutos por procedimiento + slot + dia, como QA y SLA
//   (DashboardQueries.SegundosCache). El dia va en la clave porque el Slot
//   es relativo a hoy: a medianoche (UTC-6) el slot 0 ya es otro periodo y
//   no puede salir de la cache de ayer. Solo se guarda lo que salio bien.
//   El dato de origen cambia con el ETL; entre corridas, el refresco trae lo
//   mismo.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Threading.Tasks;
using System.Web;
using System.Web.Caching;

public sealed class ConcentracionResultado
{
    public int Slot;
    public DateTime Hoy;
    public DateTime Desde;
    public DateTime Hasta;
    // Clave del bloque -> filas en orden de Posicion. null = fallo.
    public readonly Dictionary<string, object> Bloques = new Dictionary<string, object>();
    // Clave del bloque -> mensaje apto para el navegador.
    public readonly Dictionary<string, string> Errores = new Dictionary<string, string>();
    // Diferencias con el contrato (columna ausente, acumulado raro...).
    public readonly List<string> Avisos = new List<string>();
    // Excepciones originales, para la traza del servidor. No se serializan.
    public readonly List<KeyValuePair<string, Exception>> Fallos = new List<KeyValuePair<string, Exception>>();
    // Dias del Slot con tickets (ver ConcentracionContrato, COBERTURA).
    // null = no se pudo medir: no hay aviso y las graficas siguen igual.
    public Dictionary<string, object> Cobertura;
    public Exception FalloCobertura;
}

public static class ConcentracionQueries
{
    // Mismo tope que QareQueries / QaDb.
    private const int TimeoutComandoSegundos = 90;
    private const int SegundosCache = 300;
    private const string PrefijoCache = "conc:";

    public static ConcentracionResultado Consultar(int slot)
    {
        return Consultar(slot, ConcentracionContrato.HoyMexico(DateTime.UtcNow));
    }

    public static ConcentracionResultado Consultar(int slot, DateTime hoy)
    {
        var cadena = DashboardDb.CadenaConexion();   // sin Web.config revienta aqui, una vez

        var r = new ConcentracionResultado();
        r.Slot = slot;
        r.Hoy = hoy.Date;
        ConcentracionContrato.Periodo(slot, hoy, out r.Desde, out r.Hasta);

        var bloques = ConcentracionContrato.Bloques;
        var tareas = new Task<List<Dictionary<string, object>>>[bloques.Length];
        for (int i = 0; i < bloques.Length; i++)
        {
            var procedimiento = bloques[i].Procedimiento;
            tareas[i] = Task.Run(() => LeerConCache(cadena, procedimiento, slot, r.Hoy));
        }
        var hoyDia = r.Hoy;
        var cobertura = Task.Run(() => CoberturaConCache(cadena, slot, hoyDia));
        try { Task.WaitAll(tareas); }
        catch (AggregateException) { /* cada tarea se revisa abajo */ }
        try { cobertura.Wait(); }
        catch (AggregateException) { /* se revisa abajo */ }

        /* La cobertura es solo para el aviso: si falla (permiso, vista), no
           hay aviso y no cuenta como fallo de ninguna grafica. Se anota en
           avisos para que no pase en silencio. */
        if (cobertura.IsFaulted)
        {
            r.FalloCobertura = cobertura.Exception.GetBaseException();
            r.Avisos.Add("No se pudo medir la cobertura del Slot (" +
                         DashboardHandler.MensajeSeguro(r.FalloCobertura) + "); las gráficas no cambian.");
        }
        else
        {
            r.Cobertura = cobertura.Result;
        }

        for (int i = 0; i < bloques.Length; i++)
        {
            var b = bloques[i];
            if (tareas[i].IsFaulted)
            {
                var ex = tareas[i].Exception.GetBaseException();
                r.Bloques[b.Clave] = null;
                r.Errores[b.Clave] = MensajeBloque(b, ex);
                r.Fallos.Add(new KeyValuePair<string, Exception>(b.Procedimiento, ex));
                continue;
            }
            r.Bloques[b.Clave] = ConcentracionContrato.Preparar(b, tareas[i].Result, r.Avisos);
        }

        if (r.Fallos.Count == bloques.Length)
            throw r.Fallos[0].Value;

        return r;
    }

    private static List<Dictionary<string, object>> LeerConCache(
        string cadena, string procedimiento, int slot, DateTime hoy)
    {
        var cache = HttpRuntime.Cache;
        var clave = PrefijoCache + procedimiento + ":" + slot.ToString(CultureInfo.InvariantCulture)
                    + ":" + ConcentracionContrato.Dia(hoy);
        var guardado = cache[clave] as List<Dictionary<string, object>>;
        if (guardado != null) return guardado;

        var filas = Ejecutar(cadena, procedimiento, slot);
        cache.Insert(clave, filas, null, DateTime.UtcNow.AddSeconds(SegundosCache),
                     Cache.NoSlidingExpiration);
        return filas;
    }

    /* Cuantos dias del Slot tienen al menos un ticket, en la MISMA poblacion
       que las tres graficas (dbo.vw_ServicioTickets, mismo filtro Slot).
       Solo lectura, parametrizada. En el Slot 0 no cuenta HOY (dia en curso).
       Requiere SELECT sobre dbo.vw_ServicioTickets: en QA, PROACTIVANETAD lo
       tiene explicito y por db_datareader (diag 2, B1/B3). */
    private const string SqlCobertura = @"
SELECT DiasConTickets = COUNT(DISTINCT CASE WHEN FechaRegistroDia < @Hoy THEN FechaRegistroDia END),
       PrimerDia = MIN(FechaRegistroDia),
       UltimoDia = MAX(FechaRegistroDia)
FROM dbo.vw_ServicioTickets
WHERE Slot = @Slot;";

    private static Dictionary<string, object> CoberturaConCache(string cadena, int slot, DateTime hoy)
    {
        var cache = HttpRuntime.Cache;
        var clave = PrefijoCache + "cobertura:" + slot.ToString(CultureInfo.InvariantCulture)
                    + ":" + ConcentracionContrato.Dia(hoy);
        var guardado = cache[clave] as Dictionary<string, object>;
        if (guardado != null) return guardado;

        int dias = 0;
        object primero = null, ultimo = null;
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand(SqlCobertura, cn))
        {
            cmd.CommandTimeout = TimeoutComandoSegundos;
            cmd.Parameters.Add("@Slot", SqlDbType.Int).Value = slot;
            cmd.Parameters.Add("@Hoy", SqlDbType.Date).Value = hoy.Date;
            cn.Open();
            using (var rd = cmd.ExecuteReader())
            {
                if (rd.Read())
                {
                    dias = rd.IsDBNull(0) ? 0 : Convert.ToInt32(rd.GetValue(0), CultureInfo.InvariantCulture);
                    if (!rd.IsDBNull(1)) primero = ConcentracionContrato.Dia(Convert.ToDateTime(rd.GetValue(1), CultureInfo.InvariantCulture));
                    if (!rd.IsDBNull(2)) ultimo = ConcentracionContrato.Dia(Convert.ToDateTime(rd.GetValue(2), CultureInfo.InvariantCulture));
                }
            }
        }

        var salida = new Dictionary<string, object>
        {
            { "diasConTickets", dias },
            { "diasEsperados", ConcentracionContrato.DiasEsperados(slot) },
            { "primerDia", primero },
            { "ultimoDia", ultimo },
            { "completa", ConcentracionContrato.CoberturaCompleta(slot, dias) },
            { "excluyeHoy", slot == 0 },
        };
        cache.Insert(clave, salida, null, DateTime.UtcNow.AddSeconds(SegundosCache),
                     Cache.NoSlidingExpiration);
        return salida;
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

    private static List<Dictionary<string, object>> Ejecutar(string cadena, string procedimiento, int slot)
    {
        var filas = new List<Dictionary<string, object>>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand(procedimiento, cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.CommandTimeout = TimeoutComandoSegundos;
            cmd.Parameters.Add("@Slot", SqlDbType.Int).Value = slot;

            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) filas.Add(SqlRowMapper.Fila(rd));
        }
        return filas;
    }

    /* Lo que ve el navegador cuando falla UNA grafica. Mismo criterio que
       QareQueries.MensajeBloque: nunca servidor, base, login ni el texto crudo
       de SQL Server, pero diciendo que procedimiento fue. */
    public static string MensajeBloque(ConcentracionBloque bloque, Exception ex)
    {
        var sql = ex as SqlException;
        if (sql == null) return DashboardHandler.MensajeSeguro(ex);

        var numero = sql.Number.ToString(CultureInfo.InvariantCulture);
        switch (sql.Number)
        {
            case 2812:   // procedimiento inexistente
            case 229:    // permiso denegado
            case 208:    // objeto inexistente (la vista base)
                return "El sitio no puede ejecutar " + bloque.Procedimiento +
                       " (error " + numero + "): falta el procedimiento o el permiso EXECUTE.";
            case 201:
            case 8144:
                return bloque.Procedimiento + " no acepta el parametro @Slot (error " + numero + ").";
            case -2:
                return bloque.Procedimiento + " tardo demasiado y se cancelo (error -2).";
            default:
                return "No se pudo consultar " + bloque.Procedimiento + " (error " + numero +
                       "). Revisa la traza del servidor para el detalle.";
        }
    }
}
