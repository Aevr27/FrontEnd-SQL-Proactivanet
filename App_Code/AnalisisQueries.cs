// App_Code/AnalisisQueries.cs
//
// Pestaña "Analisis de servicios" (sitio/analisis/). Lee los dos
// procedimientos de 47_analisis_servicios.sql y los entrega como los quiere
// analisis.js: cada bloque como {columnas, filas}, con los valores en texto.
// El analisis -motivo, SLA, sitios, quincena...- lo hace el navegador con el
// mismo motor de la pagina de claude.ai (analisis/motor.js).
//
// Solo lectura: dos EXEC de procedimientos de lectura.
//
// Los textos (descripcion, solucion) SI viajan al navegador: la pestaña los
// muestra y el Excel los lleva (decision del dueno, 2026-10-06; el tablero
// solo se ve dentro de los EV).

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;

// Un error de la peticion (servicio o fechas mal puestos): el handler lo
// devuelve como 400 con su mensaje tal cual.
public class AnalisisSolicitudInvalida : Exception
{
    public AnalisisSolicitudInvalida(string mensaje) : base(mensaje) { }
}

// Los tiempos de una peticion de analisis.ashx, paso por paso, para la
// cabecera Server-Timing (DevTools > Network > Timing, y la pestaña los
// lee en TableroAnalisisModulo.medicion()). Solo mide: no cambia la respuesta.
public class AnalisisMedicion
{
    private readonly List<string> partes = new List<string>();
    private long antes;

    // El tiempo del paso es desde el paso anterior (o desde que arranco el reloj).
    public void Anotar(string paso, Stopwatch reloj, int filas, long caracteres)
    {
        long ahora = reloj.ElapsedTicks;
        double ms = (ahora - antes) * 1000.0 / Stopwatch.Frequency;
        antes = ahora;
        string p = paso + ";dur=" + ms.ToString("0.0", CultureInfo.InvariantCulture);
        if (filas >= 0)
            p += ";desc=\"" + filas + " filas, " +
                 (caracteres / 1048576.0).ToString("0.00", CultureInfo.InvariantCulture) + " M caracteres\"";
        partes.Add(p);
    }

    // Un paso medido aparte, con su propio reloj.
    public void Anotar(string paso, TimeSpan duracion)
    {
        partes.Add(paso + ";dur=" + duracion.TotalMilliseconds.ToString("0.0", CultureInfo.InvariantCulture));
    }

    public string ServerTiming() { return string.Join(", ", partes); }
}

public static class AnalisisQueries
{
    // Un servicio grande en un año con sus textos tarda; mas que los 30 s por
    // omision de SqlCommand.
    public const int TIMEOUT_SEGUNDOS = 180;

    // El mismo tope que usp_Analisis_Datos.
    public const int MAX_DIAS = 400;

    // Sin "desde": los ultimos seis meses, contando el mes en curso.
    public const int MESES_POR_OMISION = 6;

    // El orden en que usp_Analisis_Datos devuelve sus bloques.
    public static readonly string[] BLOQUES =
        { "parametros", "reglas", "rutas", "grupos", "fuera", "tickets", "textos", "historial" };

    private static readonly Regex CLAVE = new Regex("^[a-z0-9_-]{1,40}$");

    public static List<Dictionary<string, object>> Servicios()
    {
        return Servicios(DashboardDb.CadenaConexion());
    }

    public static List<Dictionary<string, object>> Servicios(string cadena)
    {
        var filas = new List<Dictionary<string, object>>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("dbo.usp_Analisis_Servicios", cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.CommandTimeout = 30;
            cn.Open();
            using (var r = cmd.ExecuteReader())
                while (r.Read()) filas.Add(SqlRowMapper.Fila(r));
        }
        return filas;
    }

    public static string Servicio(string valor)
    {
        var s = (valor ?? "").Trim();
        if (!CLAVE.IsMatch(s))
            throw new AnalisisSolicitudInvalida("El servicio va como su clave: minusculas, numeros, - o _.");
        return s;
    }

    // desde y hasta llegan como aaaa-mm-dd; hasta es el ULTIMO dia incluido. Sale
    // hastaExcluido, el dia siguiente, que es lo que espera el procedimiento.
    public static void Periodo(string desdeTxt, string hastaTxt, DateTime hoy,
                               out DateTime desde, out DateTime hastaExcluido)
    {
        DateTime hasta = string.IsNullOrWhiteSpace(hastaTxt) ? hoy.Date : Dia(hastaTxt, "hasta");
        desde = string.IsNullOrWhiteSpace(desdeTxt)
            ? new DateTime(hoy.Year, hoy.Month, 1).AddMonths(-(MESES_POR_OMISION - 1))
            : Dia(desdeTxt, "desde");
        hastaExcluido = hasta.AddDays(1);
        if (desde >= hastaExcluido)
            throw new AnalisisSolicitudInvalida("La fecha desde tiene que ser antes que la fecha hasta.");
        if ((hastaExcluido - desde).TotalDays > MAX_DIAS)
            throw new AnalisisSolicitudInvalida("El periodo pasa de " + MAX_DIAS + " dias: escoge uno mas corto.");
    }

    private static DateTime Dia(string texto, string nombre)
    {
        DateTime d;
        if (!DateTime.TryParseExact(texto.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                                    DateTimeStyles.None, out d))
            throw new AnalisisSolicitudInvalida("La fecha " + nombre + " va como aaaa-mm-dd.");
        return d;
    }

    public static Dictionary<string, object> Datos(string servicio, DateTime desde, DateTime hastaExcluido)
    {
        return Datos(DashboardDb.CadenaConexion(), servicio, desde, hastaExcluido);
    }

    public static Dictionary<string, object> Datos(string servicio, DateTime desde, DateTime hastaExcluido,
                                                   AnalisisMedicion medicion)
    {
        return Datos(DashboardDb.CadenaConexion(), servicio, desde, hastaExcluido, medicion);
    }

    public static Dictionary<string, object> Datos(string cadena, string servicio, DateTime desde,
                                                   DateTime hastaExcluido)
    {
        return Datos(cadena, servicio, desde, hastaExcluido, null);
    }

    // medicion (opcional): lo que tardo abrir la conexion y cada bloque, con
    // sus filas. Los bloques salen del procedimiento conforme los calcula, asi
    // que el tiempo de un bloque es el del SQL que lo arma mas leerlo.
    public static Dictionary<string, object> Datos(string cadena, string servicio, DateTime desde,
                                                   DateTime hastaExcluido, AnalisisMedicion medicion)
    {
        var bloques = new Dictionary<string, object>();
        var reloj = Stopwatch.StartNew();
        int k = 0;
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("dbo.usp_Analisis_Datos", cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.CommandTimeout = TIMEOUT_SEGUNDOS;
            cmd.Parameters.Add("@Servicio", SqlDbType.VarChar, 40).Value = servicio;
            cmd.Parameters.Add("@Desde", SqlDbType.Date).Value = desde.Date;
            cmd.Parameters.Add("@Hasta", SqlDbType.Date).Value = hastaExcluido.Date;
            cn.Open();
            if (medicion != null) medicion.Anotar("sql-abrir", reloj, -1, -1);
            try
            {
                using (var r = cmd.ExecuteReader())
                {
                    do
                    {
                        long caracteres;
                        var bloque = Leer(r, out caracteres);
                        string nombre = k < BLOQUES.Length ? BLOQUES[k] : "extra" + k;
                        if (k < BLOQUES.Length) bloques[BLOQUES[k]] = bloque;
                        if (medicion != null)
                            medicion.Anotar("sql-" + nombre, reloj, ((List<object[]>)bloque["filas"]).Count, caracteres);
                        k++;
                    } while (r.NextResult());
                }
            }
            catch (SqlException ex)
            {
                // Los RAISERROR del procedimiento (servicio que no existe, periodo
                // invalido) son mensajes nuestros: se devuelven como 400.
                if (ex.Number == 50000) throw new AnalisisSolicitudInvalida(ex.Message);
                throw;
            }
        }
        if (k != BLOQUES.Length)
            throw new InvalidOperationException(
                "usp_Analisis_Datos devolvio " + k + " bloques y se esperaban " + BLOQUES.Length +
                ": la version de la base no es la del repositorio (47_analisis_servicios.sql).");
        return bloques;
    }

    // Modo Autonomo tiene su propia vista: sus datos no son tickets por ruta sino
    // los eventos de los incident managers y los incidentes que no les llegan,
    // ya clasificados en la base (crit). Ver 97_analisis_modo_autonomo.sql.
    public const string SERVICIO_MODO_AUTONOMO = "modo_autonomo";

    // El orden en que usp_Analisis_ModoAutonomo devuelve sus bloques.
    public static readonly string[] BLOQUES_MODO_AUTONOMO = { "parametros", "eventos", "incidentes" };

    public static Dictionary<string, object> ModoAutonomo(DateTime desde, DateTime hastaExcluido)
    {
        return ModoAutonomo(DashboardDb.CadenaConexion(), desde, hastaExcluido);
    }

    // El procedimiento no se sabe si revisa dbo.AnalisisServicio.Activo (97 no
    // esta en este repositorio). Se exige aqui, con la misma lista que ve la
    // pestaña (usp_Analisis_Servicios, solo Activo = 1): apagar la fila
    // apaga tambien la peticion directa, como pasa con usp_Analisis_Datos.
    public static bool ModoAutonomoActivo(string cadena)
    {
        return ModoAutonomoEnLista(Servicios(cadena));
    }

    public static bool ModoAutonomoEnLista(List<Dictionary<string, object>> servicios)
    {
        foreach (var s in servicios ?? new List<Dictionary<string, object>>())
        {
            object clave;
            if (s.TryGetValue("Servicio", out clave) && SERVICIO_MODO_AUTONOMO.Equals(clave as string))
                return true;
        }
        return false;
    }

    public static Dictionary<string, object> ModoAutonomo(string cadena, DateTime desde, DateTime hastaExcluido)
    {
        if (!ModoAutonomoActivo(cadena))
            throw new AnalisisSolicitudInvalida("El servicio \"" + SERVICIO_MODO_AUTONOMO + "\" no existe o no esta activo.");
        var bloques = new Dictionary<string, object>();
        int k = 0;
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("dbo.usp_Analisis_ModoAutonomo", cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.CommandTimeout = 60;
            cmd.Parameters.Add("@Desde", SqlDbType.Date).Value = desde.Date;
            cmd.Parameters.Add("@Hasta", SqlDbType.Date).Value = hastaExcluido.Date;
            cn.Open();
            try
            {
                using (var r = cmd.ExecuteReader())
                {
                    do
                    {
                        long caracteres;
                        var bloque = Leer(r, out caracteres);
                        if (k < BLOQUES_MODO_AUTONOMO.Length) bloques[BLOQUES_MODO_AUTONOMO[k]] = bloque;
                        k++;
                    } while (r.NextResult());
                }
            }
            catch (SqlException ex)
            {
                if (ex.Number == 50000) throw new AnalisisSolicitudInvalida(ex.Message);
                throw;
            }
        }
        if (k != BLOQUES_MODO_AUTONOMO.Length)
            throw new InvalidOperationException(
                "usp_Analisis_ModoAutonomo devolvio " + k + " bloques y se esperaban " + BLOQUES_MODO_AUTONOMO.Length +
                ": falta correr 97_analisis_modo_autonomo.sql.");
        return bloques;
    }

    // caracteres: lo que suman los valores del bloque, para saber cual pesa en
    // el JSON (sin contar comillas ni comas).
    private static Dictionary<string, object> Leer(SqlDataReader r, out long caracteres)
    {
        var columnas = new List<string>();
        for (int i = 0; i < r.FieldCount; i++) columnas.Add(r.GetName(i));
        var filas = new List<object[]>();
        caracteres = 0;
        while (r.Read())
        {
            var f = new object[r.FieldCount];
            for (int i = 0; i < r.FieldCount; i++)
            {
                string v = r.IsDBNull(i) ? null : Texto(r.GetValue(i));
                if (v != null) caracteres += v.Length;
                f[i] = v;
            }
            filas.Add(f);
        }
        return new Dictionary<string, object> { { "columnas", columnas }, { "filas", filas } };
    }

    // Todo como texto, igual que en la salida del 45: el motor lo lee igual.
    private static string Texto(object v)
    {
        if (v is DateTime) return ((DateTime)v).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        var f = v as IFormattable;
        return f != null ? f.ToString(null, CultureInfo.InvariantCulture) : v.ToString();
    }
}
