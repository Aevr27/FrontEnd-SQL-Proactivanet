// Lectura de los cuatro procedimientos de la pestaña Tecnicos.
//
// Solo acceso a datos: ejecuta cada SP con @FechaInicio/@FechaFin y entrega
// sus result sets a TecnicosContrato.Preparar. Nada de presentacion ni de
// HTTP (eso es de tecnicos/tecnicos.js y handlers/tecnicos.ashx).
//
// UN PROCEDIMIENTO QUE FALLA NO TUMBA A LOS DEMAS
//   Cada SP corre por separado (en paralelo, cada uno con su conexion del
//   pool) y su fallo deja SUS bloques en null con el mensaje en
//   Errores[bloque]. Solo si fallan los cuatro -la base no responde, o falta
//   la cadena- se relanza la primera excepcion para que el handler conteste
//   con error.
//
// TRES RESULT SETS
//   usp_QARE_PatronesSolucion devuelve distribucion, Pareto y resumen, en ese
//   orden. Se leen los tres con NextResult(); si el SP devuelve menos, el
//   bloque que falte queda en null con su error, y los que si llegaron se
//   pintan.
//
// FECHAS
//   Viajan como SqlDbType.Date, siempre las dos (TecnicosContrato.Rango nunca
//   deja una en null: con NULL estos SP leerian todo el historial).

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Threading.Tasks;

public sealed class TecnicosResultado
{
    public DateTime FechaInicio;
    public DateTime FechaFin;
    // Clave del bloque -> filas (lista) o fila (una). null = fallo.
    public readonly Dictionary<string, object> Bloques = new Dictionary<string, object>();
    // Clave del bloque -> mensaje apto para el navegador.
    public readonly Dictionary<string, string> Errores = new Dictionary<string, string>();
    // Diferencias con el contrato (columna ausente, acumulado raro...).
    public readonly List<string> Avisos = new List<string>();
    // sql/47: el Detalle trae TipoClasificacionRespuesta.
    public bool DetalleTraeTipo;
    // Excepciones originales, para la traza del servidor. No se serializan.
    public readonly List<KeyValuePair<string, Exception>> Fallos = new List<KeyValuePair<string, Exception>>();
}

public static class TecnicosQueries
{
    private const int TimeoutComandoSegundos = 90;

    public static TecnicosResultado Consultar(DateTime inicio, DateTime fin)
    {
        var cadena = DashboardDb.CadenaConexion();   // sin Web.config revienta aqui, una vez

        var procs = TecnicosContrato.Procedimientos;
        var tareas = new Task<List<List<Dictionary<string, object>>>>[procs.Length];
        for (int i = 0; i < procs.Length; i++)
        {
            var procedimiento = procs[i];
            tareas[i] = Task.Run(() => Ejecutar(cadena, procedimiento, inicio, fin));
        }
        try { Task.WaitAll(tareas); }
        catch (AggregateException) { /* cada tarea se revisa abajo */ }

        var r = new TecnicosResultado();
        r.FechaInicio = inicio;
        r.FechaFin = fin;

        for (int i = 0; i < procs.Length; i++)
        {
            var bloques = TecnicosContrato.BloquesDe(procs[i]);
            if (tareas[i].IsFaulted)
            {
                var ex = tareas[i].Exception.GetBaseException();
                foreach (var b in bloques)
                {
                    r.Bloques[b.Clave] = null;
                    r.Errores[b.Clave] = MensajeBloque(procs[i], ex);
                }
                r.Fallos.Add(new KeyValuePair<string, Exception>(procs[i], ex));
                continue;
            }
            Repartir(procs[i], bloques, tareas[i].Result, r);
        }

        if (r.Fallos.Count == procs.Length)
            throw r.Fallos[0].Value;

        return r;
    }

    /* Los result sets de un SP -> sus bloques. Publico para la prueba, que
       le pasa result sets armados a mano (uno de menos, vacios...). */
    public static void Repartir(string procedimiento, List<TecnicosBloque> bloques,
                                List<List<Dictionary<string, object>>> sets, TecnicosResultado r)
    {
        foreach (var b in bloques)
        {
            if (sets == null || b.ResultSet >= sets.Count)
            {
                r.Bloques[b.Clave] = null;
                r.Errores[b.Clave] = procedimiento + " no devolvio el result set " +
                    (b.ResultSet + 1).ToString(CultureInfo.InvariantCulture) + " (se esperaban " +
                    bloques.Count.ToString(CultureInfo.InvariantCulture) + ").";
                continue;
            }
            var filas = TecnicosContrato.Preparar(b, sets[b.ResultSet], r.Avisos);
            if (b == TecnicosContrato.Detalle) r.DetalleTraeTipo = TecnicosContrato.DetalleTraeTipo(filas);
            if (b.UnaFila) r.Bloques[b.Clave] = filas.Count > 0 ? filas[0] : null;
            else r.Bloques[b.Clave] = filas;
        }
    }

    private static List<List<Dictionary<string, object>>> Ejecutar(
        string cadena, string procedimiento, DateTime inicio, DateTime fin)
    {
        var sets = new List<List<Dictionary<string, object>>>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand(procedimiento, cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.CommandTimeout = TimeoutComandoSegundos;
            cmd.Parameters.Add("@FechaInicio", SqlDbType.Date).Value = inicio.Date;
            cmd.Parameters.Add("@FechaFin", SqlDbType.Date).Value = fin.Date;

            cn.Open();
            using (var rd = cmd.ExecuteReader())
            {
                do
                {
                    var filas = new List<Dictionary<string, object>>();
                    while (rd.Read()) filas.Add(SqlRowMapper.Fila(rd));
                    sets.Add(filas);
                } while (rd.NextResult());
            }
        }
        return sets;
    }

    /* Lo que ve el navegador cuando falla un SP. Mismo criterio que
       DashboardHandler.MensajeSeguro -nunca servidor, base, login ni el texto
       crudo de SQL Server-, pero diciendo que procedimiento fue, para saber a
       que darle GRANT. */
    public static string MensajeBloque(string procedimiento, Exception ex)
    {
        var sql = ex as SqlException;
        if (sql == null) return DashboardHandler.MensajeSeguro(ex);

        var numero = sql.Number.ToString(CultureInfo.InvariantCulture);
        switch (sql.Number)
        {
            case 2812:   // procedimiento inexistente
            case 229:    // permiso denegado
            case 208:    // objeto inexistente (la vista)
                return "El sitio no puede ejecutar " + procedimiento +
                       " (error " + numero + "): falta el procedimiento o el permiso EXECUTE.";
            case 50001:  // THROW de los SP: inicio > fin (el handler ya lo evita)
                return procedimiento + " rechazo el rango de fechas (error " + numero + ").";
            case -2:
                return procedimiento + " tardo demasiado y se cancelo (error -2).";
            default:
                return "No se pudo consultar " + procedimiento + " (error " + numero +
                       "). Revisa la traza del servidor para el detalle.";
        }
    }
}
