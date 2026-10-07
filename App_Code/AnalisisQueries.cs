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
using System.Globalization;
using System.Text.RegularExpressions;

// Un error de la peticion (servicio o fechas mal puestos): el handler lo
// devuelve como 400 con su mensaje tal cual.
public class AnalisisSolicitudInvalida : Exception
{
    public AnalisisSolicitudInvalida(string mensaje) : base(mensaje) { }
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

    public static Dictionary<string, object> Datos(string cadena, string servicio, DateTime desde,
                                                   DateTime hastaExcluido)
    {
        var bloques = new Dictionary<string, object>();
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
            try
            {
                using (var r = cmd.ExecuteReader())
                {
                    do
                    {
                        var bloque = Leer(r);
                        if (k < BLOQUES.Length) bloques[BLOQUES[k]] = bloque;
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

    private static Dictionary<string, object> Leer(SqlDataReader r)
    {
        var columnas = new List<string>();
        for (int i = 0; i < r.FieldCount; i++) columnas.Add(r.GetName(i));
        var filas = new List<object[]>();
        while (r.Read())
        {
            var f = new object[r.FieldCount];
            for (int i = 0; i < r.FieldCount; i++) f[i] = r.IsDBNull(i) ? null : Texto(r.GetValue(i));
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
