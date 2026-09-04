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
using System.Text;
using System.Web;

// Peticion mal formada del cliente: el handler la traduce a un 400 con este
// mismo mensaje. Solo se usa para cosas que el usuario puede corregir en la
// URL; nunca lleva detalles del servidor.
public sealed class QaSolicitudInvalida : Exception
{
    public QaSolicitudInvalida(string mensaje) : base(mensaje) { }
}

// Los nombres de columna que un result set trajo DE VERDAD, y como llegar a
// ellos desde el nombre que el codigo pide.
//
// El nombre pedido se busca primero exacto. Si no aparece, se compara por
// "esqueleto": el nombre en minusculas y SIN los caracteres no ASCII.
//
// POR QUE EL ESQUELETO
//   usp_CorreoQA_Detalle devuelve los encabezados del TICKETS_QA_<fecha>.xlsx,
//   varios con acentos: [Técnico de 2ª línea], [Categoría], y los doce campos
//   QA/QARE, que llevan ¿ y vocales acentuadas. Un literal con acentos en un
//   .cs sobrevive intacto solo si el compilador lee el archivo con la misma
//   codificacion con la que se guardo; ASP.NET compila App_Code leyendo los
//   fuentes con <globalization fileEncoding>, que por defecto es la codepage
//   ANSI del servidor y no UTF-8. Con eso, "Técnico de 2ª línea" se convierte
//   en "TÃ©cnico de 2Âª lÃ­nea" y no coincide con NINGUNA columna: el conteo
//   sale en cero sin ningun error, que es exactamente lo que le paso al
//   tablero (porTecnico con una sola barra nula, topCategorias con una sola
//   categoria nula, los doce campos QARE en cero, y en cambio Validacion,
//   Grupo y Grupo Correcto -- puro ASCII -- bien).
//
//   El destrozo solo toca caracteres no ASCII y solo los cambia por otros no
//   ASCII, asi que quitarlos de los dos lados deja el mismo esqueleto y la
//   columna se encuentra igual. Tambien cubre una diferencia de acentuacion
//   entre lo que dice el codigo y lo que devuelve la base.
//
//   No adivina nombres: compara contra los que el result set reporto. Si dos
//   columnas comparten esqueleto, el esqueleto se marca ambiguo y no se usa.
public sealed class QaColumnas
{
    private readonly Dictionary<string, int> _exactos =
        new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, int> _esqueletos =
        new Dictionary<string, int>(StringComparer.Ordinal);
    private readonly List<string> _nombres = new List<string>();

    public QaColumnas(IList<string> nombres)
    {
        for (int i = 0; i < nombres.Count; i++)
        {
            string nombre = nombres[i] ?? string.Empty;
            _nombres.Add(nombre);

            if (!_exactos.ContainsKey(nombre)) _exactos[nombre] = i;

            string esqueleto = Esqueleto(nombre);
            if (esqueleto.Length == 0) continue;
            _esqueletos[esqueleto] = _esqueletos.ContainsKey(esqueleto) ? -1 : i;
        }
    }

    public IList<string> Nombres { get { return _nombres; } }

    // Ordinal exacto, o -1. Sirve para saber si la fila YA trae ese nombre tal
    // cual, sin pasar por el esqueleto.
    public int OrdinalExacto(string columna)
    {
        int indice;
        return _exactos.TryGetValue(columna ?? string.Empty, out indice) ? indice : -1;
    }

    public int Ordinal(string columna)
    {
        int indice = OrdinalExacto(columna);
        if (indice >= 0) return indice;

        // -1 tambien es el valor con el que se marca un esqueleto ambiguo, y
        // ambos casos significan lo mismo aqui: no se resuelve.
        return _esqueletos.TryGetValue(Esqueleto(columna), out indice) ? indice : -1;
    }

    public static string Esqueleto(string texto)
    {
        if (string.IsNullOrEmpty(texto)) return string.Empty;

        var sb = new StringBuilder(texto.Length);
        bool espacio = false;
        foreach (char c in texto)
        {
            if (c > 127) continue;
            if (char.IsWhiteSpace(c)) { espacio = sb.Length > 0; continue; }
            if (espacio) { sb.Append(' '); espacio = false; }
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }
}

// Una fila, sin materializarla. La misma cara para la fila que llega de SQL
// Server y para la que sale de un archivo de snapshot.
//
// Resuelve el nombre de columna a su ordinal UNA vez por result set y no por
// fila: con miles de filas y una docena de columnas leidas, esa diferencia se
// nota. De cada fila solo se convierten las columnas que se piden; las que el
// resumen no mira nunca se convierten a string.
public sealed class QaLector
{
    private readonly IDataRecord _reader;
    private readonly QaColumnas _mapaLector;
    private QaColumnas _mapaFila;
    private Dictionary<string, object> _fila;

    public QaLector() { }

    public QaLector(IDataReader reader)
    {
        _reader = reader;

        var nombres = new List<string>(reader.FieldCount);
        for (int i = 0; i < reader.FieldCount; i++) nombres.Add(reader.GetName(i));
        _mapaLector = new QaColumnas(nombres);
    }

    // Apunta el lector a otra fila ya leida (modo snapshot). Todas las filas
    // del mismo archivo comparten claves, asi que el mapa se arma una vez.
    public void Usar(Dictionary<string, object> fila)
    {
        _fila = fila;
        if (_mapaFila == null && fila != null)
            _mapaFila = new QaColumnas(new List<string>(fila.Keys));
    }

    public QaColumnas Mapa { get { return _reader != null ? _mapaLector : _mapaFila; } }

    public string Texto(string columna)
    {
        var mapa = Mapa;
        if (mapa == null) return null;

        int indice = mapa.Ordinal(columna);
        if (indice < 0) return null;

        if (_reader == null) return QaDb.Texto(_fila, mapa.Nombres[indice]);

        if (_reader.IsDBNull(indice)) return null;
        object valor = _reader.GetValue(indice);
        return valor as string ?? Convert.ToString(valor, CultureInfo.InvariantCulture);
    }
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

    // Recorre el PRIMER result set de un stored procedure fila por fila, sin
    // materializar nada.
    //
    // EjecutarMultiple construye un Dictionary<string,object> por fila con las
    // 49 columnas de la vista, varias de ellas NVARCHAR(MAX) de miles de
    // caracteres. Para el detalle de una ventana de 15 dias eso son cientos de
    // miles de conversiones y cadenas que el resumen tira a la basura: solo
    // necesita contar. Recorrer lee del SqlDataReader y deja que la fila se
    // descarte en cuanto se conto, asi que la memoria no crece con el rango.
    //
    // El modo snapshot pasa por aqui igual, sobre las filas ya leidas del
    // archivo: quien agrega no distingue un modo del otro.
    public static void Recorrer(string procedimiento, Dictionary<string, object> parametros,
                                Action<QaLector> porFila)
    {
        string cadena = CadenaConexion();

        if (QaSnapshot.Activo(cadena))
        {
            var resultados = QaSnapshot.Leer(QaSnapshot.Carpeta(cadena), procedimiento, parametros);
            var lectorArchivo = new QaLector();
            foreach (var fila in Conjunto(resultados, 0))
            {
                lectorArchivo.Usar(fila);
                porFila(lectorArchivo);
            }
            return;
        }

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
                var lector = new QaLector(reader);
                while (reader.Read()) porFila(lector);
            }
        }
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
