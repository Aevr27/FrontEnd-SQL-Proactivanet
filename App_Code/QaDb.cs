// Acceso a SQL Server para qa.ashx.
//
// Es el mismo helper que usa el tablero principal (App_Code/DashboardDb.cs),
// transplantado aqui y renombrado para que las dos carpetas puedan convivir en
// un mismo sitio de IIS sin chocar por el nombre de la clase. La forma de
// trabajar no cambia: cadena de conexion en Web.config, stored procedures con
// parametros, y las filas devueltas como List<Dictionary<string,object>>.
//
// ASP.NET compila App_Code solo en el primer request: no hace falta Visual
// Studio ni un paso de build, basta con copiar la carpeta al sitio.
//
// La cadena de conexion NUNCA sale de aqui: no se escribe en ninguna respuesta,
// no se registra en ningun log propio y no aparece en ningun mensaje de error.
// El cliente jamas ve el servidor, el usuario ni la contraseña.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Web;

// Peticion mal formada del cliente: el handler la traduce a un 400 con este
// mismo mensaje. Solo se usa para cosas que el usuario puede corregir en la
// URL; nunca lleva detalles del servidor.
public sealed class QaSolicitudInvalida : Exception
{
    public QaSolicitudInvalida(string mensaje) : base(mensaje) { }
}

public static class QaDb
{
    // Tope duro de la conexion, por encima del que traiga Web.config: una
    // consulta del tablero que tarde mas de esto es un problema que hay que
    // arreglar en la base, no una espera que valga la pena sostener.
    private const int TimeoutComandoSegundos = 90;

    // Ejecuta un stored procedure y devuelve TODOS sus result sets. Los
    // procedimientos de QA que usa el tablero (dbo.usp_CorreoQA_*) devuelven
    // uno cada uno; el metodo sirve igual para los que devuelvan varios.
    public static List<List<Dictionary<string, object>>> EjecutarMultiple(
        string procedimiento, Dictionary<string, object> parametros)
    {
        var resultados = new List<List<Dictionary<string, object>>>();

        string cadena = CadenaConexion();

        // Sin conexion a SQL Server el sitio puede servirse de una carpeta de
        // archivos exportados (ver App_Code/QaSnapshot.cs). El desvio esta
        // AQUI, en el unico punto que habla con la base, para que el resto de
        // qa.ashx no distinga un modo del otro.
        if (QaSnapshot.Activo(cadena))
            return QaSnapshot.Leer(QaSnapshot.Carpeta(cadena), procedimiento, parametros);

        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand(procedimiento, cn))
        {
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.CommandTimeout = TimeoutComandoSegundos;

            if (parametros != null)
            {
                foreach (var kv in parametros)
                    cmd.Parameters.AddWithValue("@" + kv.Key, kv.Value ?? (object)DBNull.Value);
            }

            cn.Open();
            using (var reader = cmd.ExecuteReader())
            {
                do
                {
                    var filas = new List<Dictionary<string, object>>();
                    while (reader.Read())
                    {
                        var fila = new Dictionary<string, object>();
                        for (int i = 0; i < reader.FieldCount; i++)
                        {
                            object valor = reader.GetValue(i);
                            if (valor is DBNull)
                                valor = null;
                            else if (valor is DateTime)
                                valor = ((DateTime)valor).ToString("yyyy-MM-ddTHH:mm:ss");

                            fila[reader.GetName(i)] = valor;
                        }
                        filas.Add(fila);
                    }
                    resultados.Add(filas);
                } while (reader.NextResult());
            }
        }

        return resultados;
    }

    // Atajo para procedimientos de un solo result set.
    public static List<Dictionary<string, object>> Ejecutar(
        string procedimiento, Dictionary<string, object> parametros)
    {
        var resultados = EjecutarMultiple(procedimiento, parametros);
        return resultados.Count > 0 ? resultados[0] : new List<Dictionary<string, object>>();
    }

    // El result set 'indice', o una lista vacia si el procedimiento devolvio
    // menos de los esperados. Asi un cambio en la base no revienta con un
    // IndexOutOfRange en medio de la serializacion.
    public static List<Dictionary<string, object>> Conjunto(
        List<List<Dictionary<string, object>>> resultados, int indice)
    {
        if (resultados == null || indice < 0 || indice >= resultados.Count)
            return new List<Dictionary<string, object>>();
        return resultados[indice];
    }

    // La primera fila del result set 'indice', o null si no hay ninguna.
    public static Dictionary<string, object> PrimeraFila(
        List<List<Dictionary<string, object>>> resultados, int indice)
    {
        var filas = Conjunto(resultados, indice);
        return filas.Count > 0 ? filas[0] : null;
    }

    // --- Lectura de valores de una fila ----------------------------------
    public static object Valor(Dictionary<string, object> fila, string columna)
    {
        if (fila == null) return null;
        object valor;
        return fila.TryGetValue(columna, out valor) ? valor : null;
    }

    public static string Texto(Dictionary<string, object> fila, string columna)
    {
        object valor = Valor(fila, columna);
        if (valor == null) return null;
        return valor as string ?? Convert.ToString(valor, CultureInfo.InvariantCulture);
    }

    public static long Entero(Dictionary<string, object> fila, string columna)
    {
        object valor = Valor(fila, columna);
        if (valor == null) return 0;
        try { return Convert.ToInt64(valor, CultureInfo.InvariantCulture); }
        catch (Exception) { return 0; }
    }

    // Los DECIMAL(6,2) llegan como decimal; se convierten a double para que
    // JavaScriptSerializer los escriba como numero JSON y no como texto.
    public static object Decimal2(Dictionary<string, object> fila, string columna)
    {
        object valor = Valor(fila, columna);
        if (valor == null) return null;
        try { return Convert.ToDouble(valor, CultureInfo.InvariantCulture); }
        catch (Exception) { return null; }
    }

    // Las columnas DATE llegan ya como "yyyy-MM-ddT00:00:00"; el tablero solo
    // necesita la fecha.
    public static string Fecha(Dictionary<string, object> fila, string columna)
    {
        string texto = Texto(fila, columna);
        if (string.IsNullOrEmpty(texto)) return null;
        return texto.Length >= 10 ? texto.Substring(0, 10) : texto;
    }

    // true cuando el sitio esta sirviendo archivos exportados en vez de la
    // base. qa.ashx lo usa solo para marcarlo en el bloque "source": quien
    // mire el tablero tiene que saber que los numeros estan congelados.
    public static bool ModoSnapshot
    {
        get
        {
            var cs = ConfigurationManager.ConnectionStrings["TicketsProactivanet"];
            return cs != null && QaSnapshot.Activo(cs.ConnectionString);
        }
    }

    private static string CadenaConexion()
    {
        var cs = ConfigurationManager.ConnectionStrings["TicketsProactivanet"];
        if (cs == null || string.IsNullOrWhiteSpace(cs.ConnectionString))
        {
            // Sin este mensaje la referencia nula revienta con un
            // NullReferenceException que no dice nada util, y en pantalla solo
            // se ve "Error al cargar datos".
            throw new ConfigurationErrorsException(
                "Falta la cadena de conexion 'TicketsProactivanet' en Web.config. " +
                "Copia Web.config.ejemplo como Web.config en la raiz del sitio y " +
                "ajusta el servidor/credenciales.");
        }
        return cs.ConnectionString;
    }
}

// Lectura de los parametros del query string. Nada de lo que llega por aqui
// se concatena a una consulta: todo termina como SqlParameter.
public static class QaParams
{
    // Ventana por defecto del tablero: los ultimos 15 dias, exactamente la
    // misma que usa usp_CorreoQA_Kpis (@FechaFin = hoy, @FechaInicio = hoy-14).
    // Se puede cambiar por query string, sobre todo para reproducir un dia
    // concreto al comparar contra el correo de QA.
    public const int DiasVentana = 15;

    public static void Rango(HttpRequest request, out string fechaInicio, out string fechaFin)
    {
        var hoy = DateTime.Today;

        fechaFin = FechaOpcional(request, "fecha_fin") ?? hoy.ToString("yyyy-MM-dd");

        var inicio = FechaOpcional(request, "fecha_inicio");
        if (inicio == null)
        {
            // El inicio se calcula desde el fin efectivo, no desde hoy: asi
            // ?fecha_fin=... solo mueve la ventana, no la estira.
            var fin = DateTime.ParseExact(fechaFin, "yyyy-MM-dd",
                                          CultureInfo.InvariantCulture);
            inicio = fin.AddDays(-(DiasVentana - 1)).ToString("yyyy-MM-dd");
        }
        fechaInicio = inicio;

        if (string.CompareOrdinal(fechaInicio, fechaFin) > 0)
        {
            throw new QaSolicitudInvalida(
                "El rango de fechas es invalido: 'fecha_inicio' es posterior a 'fecha_fin'.");
        }
    }

    // Devuelve la fecha normalizada como yyyy-MM-dd, o null si el parametro no
    // viene. Un valor con cualquier otra forma es un 400: no se adivina.
    private static string FechaOpcional(HttpRequest request, string nombre)
    {
        var valor = request.QueryString[nombre];
        if (string.IsNullOrWhiteSpace(valor)) return null;

        valor = valor.Trim();
        DateTime fecha;
        if (!DateTime.TryParseExact(valor, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                                    DateTimeStyles.None, out fecha))
        {
            throw new QaSolicitudInvalida(
                "Parametro '" + nombre + "' invalido: se espera una fecha con el formato aaaa-mm-dd.");
        }
        return fecha.ToString("yyyy-MM-dd");
    }

    // Filtro de texto del query string. Vacio = sin filtro (NULL para el
    // procedimiento). Un valor absurdamente largo solo puede ser ruido o un
    // intento de abuso: ningun valor real del catalogo se acerca al tope.
    public static object Filtro(HttpRequest request, string nombre)
    {
        var valor = request.QueryString[nombre];
        if (string.IsNullOrWhiteSpace(valor)) return null;
        valor = valor.Trim();
        return valor.Length > 200 ? valor.Substring(0, 200) : valor;
    }

    public static int Entero(HttpRequest request, string nombre, int porDefecto,
                             int minimo, int maximo)
    {
        var valor = request.QueryString[nombre];
        if (string.IsNullOrWhiteSpace(valor)) return porDefecto;

        int numero;
        if (!int.TryParse(valor.Trim(), NumberStyles.Integer,
                          CultureInfo.InvariantCulture, out numero))
        {
            throw new QaSolicitudInvalida(
                "Parametro '" + nombre + "' invalido: debe ser un numero entero.");
        }
        if (numero < minimo)
        {
            throw new QaSolicitudInvalida(
                "Parametro '" + nombre + "' invalido: el minimo es "
                + minimo.ToString(CultureInfo.InvariantCulture) + ".");
        }
        return numero > maximo ? maximo : numero;
    }
}
