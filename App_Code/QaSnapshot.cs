// Modo snapshot: el tablero servido desde archivos, sin conexion a SQL Server.
//
// PARA QUE SIRVE
//   Para trabajar cuando no hay red ni VPN hacia el servidor. Alguien CON
//   acceso corre tools\Exportar-SnapshotQA.ps1 una vez, entrega la carpeta
//   snapshot\ y aqui se lee en lugar de la base.
//
// COMO SE ACTIVA
//   En Web.config, la cadena de conexion completa pasa a ser:
//       connectionString="snapshot:snapshot"
//   donde lo que sigue a "snapshot:" es la carpeta con los .json (relativa a
//   la raiz del sitio, o una ruta absoluta).
//
// POR QUE AQUI Y NO EN EL FRONTEND
//   El punto de corte es QaDb.EjecutarMultiple, que devuelve los result sets
//   CRUDOS. El snapshot guarda exactamente eso. Todo lo demas -- el armado
//   del JSON, los nombres de campo, el bloque QARE, la paginacion del
//   detalle -- lo sigue haciendo qa.ashx con el mismo codigo que en vivo. No
//   hay una segunda implementacion del contrato que se pueda desincronizar,
//   y qa_test.js no se entera de nada.
//
// LO QUE EL SNAPSHOT NO PUEDE HACER
//   Los datos estan CONGELADOS en el rango con el que se exportaron. Mover
//   ?fecha_inicio/?fecha_fin no vuelve a consultar nada: el bloque "source"
//   de la respuesta reporta siempre el rango exportado y marca el origen
//   como snapshot, para que nadie confunda estos numeros con los del dia.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Globalization;
using System.IO;
using System.Web;
using System.Web.Script.Serialization;

public static class QaSnapshot
{
    public const string Prefijo = "snapshot:";

    // Metadatos del export (cuando se hizo y que rango cubre). Se leen una
    // sola vez del archivo del resumen y se cachean: action=meta tiene que
    // poder informarlos sin haber tocado ningun otro archivo.
    private static readonly object Candado = new object();
    private static bool _metaLeida;
    private static string _exportadoEn;
    private static string _fechaInicio;
    private static string _fechaFin;

    public static bool Activo(string cadenaConexion)
    {
        return cadenaConexion != null
            && cadenaConexion.TrimStart().StartsWith(Prefijo, StringComparison.OrdinalIgnoreCase);
    }

    // Carpeta de los .json. Una ruta relativa se resuelve contra la raiz del
    // sitio, no contra el directorio de trabajo del proceso: en IIS ese
    // directorio no es el del sitio.
    public static string Carpeta(string cadenaConexion)
    {
        string ruta = cadenaConexion.TrimStart().Substring(Prefijo.Length).Trim();
        if (ruta.Length == 0) ruta = "snapshot";

        if (Path.IsPathRooted(ruta)) return ruta;

        var contexto = HttpContext.Current;
        if (contexto != null)
            return contexto.Server.MapPath("~/" + ruta.TrimStart('~', '/', '\\'));

        return Path.GetFullPath(ruta);
    }

    public static string ExportadoEn { get { LeerMeta(); return _exportadoEn; } }
    public static string FechaInicio { get { LeerMeta(); return _fechaInicio; } }
    public static string FechaFin { get { LeerMeta(); return _fechaFin; } }

    // Los result sets de un procedimiento, en el mismo formato que devuelve
    // QaDb.EjecutarMultiple contra SQL Server.
    public static List<List<Dictionary<string, object>>> Leer(
        string carpeta, string procedimiento, Dictionary<string, object> parametros)
    {
        var archivo = Archivo(carpeta, procedimiento);
        var contenido = Deserializar(archivo);

        Cachear(contenido);

        var resultados = ResultSets(contenido, archivo);

        // El detalle se exporta entero y sin filtros (PageSize=0). El filtrado
        // y la paginacion que en vivo hace el procedimiento se aplican aqui
        // sobre las filas leidas, para que action=detail se comporte igual.
        if (procedimiento.EndsWith("_Detalle", StringComparison.OrdinalIgnoreCase))
            resultados = FiltrarYPaginar(resultados, parametros);

        return resultados;
    }

    // dbo.usp_QaWeb_Resumen -> <carpeta>\resumen.json
    private static string Archivo(string carpeta, string procedimiento)
    {
        int guion = procedimiento.LastIndexOf('_');
        string nombre = (guion >= 0 ? procedimiento.Substring(guion + 1) : procedimiento)
                        .ToLowerInvariant();
        return Path.Combine(carpeta, nombre + ".json");
    }

    private static Dictionary<string, object> Deserializar(string archivo)
    {
        if (!File.Exists(archivo))
        {
            // Mismo tipo de excepcion que una cadena de conexion ausente: es
            // un sitio mal armado, no una base que no respondio. qa.ashx lo
            // traduce a 500 con este mensaje, que se ve en pantalla.
            throw new ConfigurationErrorsException(
                "Modo snapshot activo pero falta el archivo '" + Path.GetFileName(archivo) +
                "' en la carpeta del snapshot. Genera la carpeta con " +
                "tools\\Exportar-SnapshotQA.ps1 desde un equipo con acceso a SQL Server.");
        }

        var serializador = new JavaScriptSerializer();
        serializador.MaxJsonLength = int.MaxValue;
        var raiz = serializador.DeserializeObject(File.ReadAllText(archivo))
                   as Dictionary<string, object>;

        if (raiz == null)
        {
            throw new ConfigurationErrorsException(
                "El archivo de snapshot '" + Path.GetFileName(archivo) +
                "' no tiene el formato esperado. Vuelve a generarlo con " +
                "tools\\Exportar-SnapshotQA.ps1.");
        }
        return raiz;
    }

    private static List<List<Dictionary<string, object>>> ResultSets(
        Dictionary<string, object> raiz, string archivo)
    {
        var conjuntos = Valor(raiz, "resultSets") as object[];
        if (conjuntos == null)
        {
            throw new ConfigurationErrorsException(
                "El archivo de snapshot '" + Path.GetFileName(archivo) +
                "' no trae 'resultSets'. Vuelve a generarlo con " +
                "tools\\Exportar-SnapshotQA.ps1.");
        }

        var resultados = new List<List<Dictionary<string, object>>>();
        foreach (var conjunto in conjuntos)
        {
            var filas = new List<Dictionary<string, object>>();
            var arreglo = conjunto as object[];
            if (arreglo != null)
            {
                foreach (var fila in arreglo)
                {
                    var diccionario = fila as Dictionary<string, object>;
                    if (diccionario != null) filas.Add(diccionario);
                }
            }
            resultados.Add(filas);
        }
        return resultados;
    }

    // ------------------------------------------------------------- detalle
    // Nombres de columna del result set 2 de usp_QaWeb_Detalle, por el
    // parametro de filtro que les corresponde. Van con acento porque asi
    // salen del procedimiento y asi quedaron en el snapshot.
    private static readonly string[][] Columnas = new string[][]
    {
        new[] { "Validacion",    "Validacion"           },
        new[] { "Grupo",         "Grupo"                },
        new[] { "Tecnico",       "Técnico de 2ª línea" },
        new[] { "GrupoCorrecto", "Grupo Correcto"       },
    };

    private static List<List<Dictionary<string, object>>> FiltrarYPaginar(
        List<List<Dictionary<string, object>>> resultados,
        Dictionary<string, object> parametros)
    {
        var todas = QaDb.Conjunto(resultados, 1);

        var filtradas = new List<Dictionary<string, object>>();
        foreach (var fila in todas)
            if (Coincide(fila, parametros)) filtradas.Add(fila);

        // El Total exportado corresponde al export sin filtros; el que importa
        // es el de las filas que pasaron el filtro de ESTA peticion.
        var total = new Dictionary<string, object>();
        total["Total"] = (long)filtradas.Count;

        int tamano = Entero(parametros, "PageSize", 100);
        int pagina = Entero(parametros, "Page", 1);
        if (pagina < 1) pagina = 1;

        int salto = tamano == 0 ? 0 : (pagina - 1) * tamano;
        if (salto > filtradas.Count) salto = filtradas.Count;
        int toma = tamano == 0 ? filtradas.Count - salto
                               : Math.Min(tamano, filtradas.Count - salto);

        var filasPagina = filtradas.GetRange(salto, toma);

        var salida = new List<List<Dictionary<string, object>>>();
        salida.Add(new List<Dictionary<string, object>> { total });
        salida.Add(filasPagina);
        return salida;
    }

    private static bool Coincide(Dictionary<string, object> fila,
                                 Dictionary<string, object> parametros)
    {
        foreach (var par in Columnas)
        {
            var esperado = Valor(parametros, par[0]) as string;
            if (string.IsNullOrWhiteSpace(esperado)) continue;

            // Igualdad exacta, como el '=' del procedimiento. La comparacion
            // ignora mayusculas porque el collation del servidor tambien.
            var actual = QaDb.Texto(fila, par[1]);
            if (!string.Equals(actual, esperado.Trim(), StringComparison.OrdinalIgnoreCase))
                return false;
        }
        return true;
    }

    // -------------------------------------------------------------- meta
    private static void Cachear(Dictionary<string, object> raiz)
    {
        lock (Candado)
        {
            _exportadoEn = Texto(raiz, "exportadoEn") ?? _exportadoEn;
            _fechaInicio = Texto(raiz, "fechaInicio") ?? _fechaInicio;
            _fechaFin = Texto(raiz, "fechaFin") ?? _fechaFin;
            _metaLeida = true;
        }
    }

    // action=meta no ejecuta ningun procedimiento, asi que los metadatos se
    // leen del archivo del resumen. Si no esta, se responde sin ellos en vez
    // de reventar: meta es informativo.
    private static void LeerMeta()
    {
        lock (Candado) { if (_metaLeida) return; }

        try
        {
            var cadena = ConfigurationManager.ConnectionStrings["TicketsProactivanet"];
            if (cadena == null || !Activo(cadena.ConnectionString)) return;
            Cachear(Deserializar(Archivo(Carpeta(cadena.ConnectionString), "_Resumen")));
        }
        catch (Exception)
        {
            lock (Candado) { _metaLeida = true; }
        }
    }

    private static object Valor(Dictionary<string, object> mapa, string clave)
    {
        object valor;
        return mapa != null && mapa.TryGetValue(clave, out valor) ? valor : null;
    }

    private static string Texto(Dictionary<string, object> mapa, string clave)
    {
        object valor = Valor(mapa, clave);
        return valor == null ? null : Convert.ToString(valor, CultureInfo.InvariantCulture);
    }

    private static int Entero(Dictionary<string, object> mapa, string clave, int porDefecto)
    {
        object valor = Valor(mapa, clave);
        if (valor == null) return porDefecto;
        try { return Convert.ToInt32(valor, CultureInfo.InvariantCulture); }
        catch (Exception) { return porDefecto; }
    }
}
