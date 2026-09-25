// Lectura de los seis procedimientos de la pestaña QARE.
//
// Solo acceso a datos: abre la conexion, ejecuta dbo.usp_CorreoQARE_* con
// @FechaInicio/@FechaFin y entrega las filas a QareContrato.Preparar, que
// las ordena y anota lo que no cuadre. Nada de presentacion y nada de HTTP:
// eso es de qare/qare.js y de handlers/qare.ashx.
//
// UN BLOQUE QUE FALLA NO TUMBA A LOS DEMAS
//   Cada procedimiento corre por separado (en paralelo, cada uno con su
//   conexion del pool, como hace qa.ashx con sus dos lecturas) y su fallo se
//   guarda en Errores[clave] con el bloque en null. La pestaña pinta lo que
//   si llego y el error en la tarjeta que falto. Solo si fallan LOS SEIS -la
//   base no responde, o falta la cadena de conexion- se relanza la primera
//   excepcion para que el handler conteste con error.
//
// FECHAS
//   Viajan como SqlDbType.Date, igual que en QaDb.KpisUnaPasada con los
//   procedimientos hermanos usp_CorreoQA_*. No se les suma ni resta nada; ver
//   QareContrato.Rango.
//
// ZONA HORARIA
//   Aqui no hay "ahora": ningun SYSDATETIME/SYSUTCDATETIME, DateTime.Now ni
//   UtcNow. Las dos fechas son dias de negocio que elige el usuario y no se
//   convierten. El sello de "Ultima actualizacion" lo arma el handler con
//   DashboardDataInfo, que es el unico sitio que cambia un sello de zona.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Threading.Tasks;

public sealed class QareResultado
{
    public DateTime FechaInicio;
    public DateTime FechaFin;
    // Clave del bloque -> filas (lista) o fila (KPIs). null = fallo.
    public readonly Dictionary<string, object> Bloques = new Dictionary<string, object>();
    // Clave del bloque -> mensaje apto para el navegador.
    public readonly Dictionary<string, string> Errores = new Dictionary<string, string>();
    // Diferencias con la guia visual (columna ausente, acumulado raro...).
    public readonly List<string> Avisos = new List<string>();
    // Excepciones originales, para la traza del servidor. No se serializan.
    public readonly List<KeyValuePair<string, Exception>> Fallos = new List<KeyValuePair<string, Exception>>();
}

public static class QareQueries
{
    // Mismo tope que QaDb para sus procedimientos hermanos.
    private const int TimeoutComandoSegundos = 90;

    public static QareResultado Consultar(DateTime inicio, DateTime fin)
    {
        var cadena = DashboardDb.CadenaConexion();   // sin Web.config revienta aqui, una vez

        var bloques = QareContrato.Bloques;
        var tareas = new Task<List<Dictionary<string, object>>>[bloques.Length];
        for (int i = 0; i < bloques.Length; i++)
        {
            var procedimiento = bloques[i].Procedimiento;
            tareas[i] = Task.Run(() => Ejecutar(cadena, procedimiento, inicio, fin));
        }
        try { Task.WaitAll(tareas); }
        catch (AggregateException) { /* cada tarea se revisa abajo */ }

        var r = new QareResultado();
        r.FechaInicio = inicio;
        r.FechaFin = fin;

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

            var filas = QareContrato.Preparar(b, tareas[i].Result, r.Avisos);
            if (b.UnaFila)
                r.Bloques[b.Clave] = filas.Count > 0 ? filas[0] : null;
            else
                r.Bloques[b.Clave] = filas;
        }

        if (r.Fallos.Count == bloques.Length)
            throw r.Fallos[0].Value;

        return r;
    }

    private static List<Dictionary<string, object>> Ejecutar(
        string cadena, string procedimiento, DateTime inicio, DateTime fin)
    {
        var filas = new List<Dictionary<string, object>>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand(procedimiento, cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.CommandTimeout = TimeoutComandoSegundos;
            cmd.Parameters.Add("@FechaInicio", SqlDbType.Date).Value = inicio.Date;
            cmd.Parameters.Add("@FechaFin", SqlDbType.Date).Value = fin.Date;

            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) filas.Add(SqlRowMapper.Fila(rd));
        }
        return filas;
    }

    /* Lo que ve el navegador cuando falla UN bloque. Mismo criterio que
       DashboardHandler.MensajeSeguro -nunca servidor, base, login ni el texto
       crudo de SQL Server-, pero diciendo que procedimiento fue: el nombre es
       del propio tablero, y sin el no hay forma de saber a que darle GRANT. */
    public static string MensajeBloque(QareBloque bloque, Exception ex)
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
            case 201:    // falta un parametro obligatorio
            case 8144:   // demasiados parametros
                return bloque.Procedimiento + " no acepta los parametros @FechaInicio/@FechaFin" +
                       " (error " + numero + ").";
            case -2:
                return bloque.Procedimiento + " tardo demasiado y se cancelo (error -2).";
            default:
                return "No se pudo consultar " + bloque.Procedimiento + " (error " + numero +
                       "). Revisa la traza del servidor para el detalle.";
        }
    }
}
