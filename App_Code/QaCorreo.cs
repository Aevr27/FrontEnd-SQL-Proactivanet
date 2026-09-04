// Capa de adaptacion entre los procedimientos QA que YA existen en la base y
// el contrato JSON que espera el tablero (qa_test.js).
//
// POR QUE EXISTE ESTE ARCHIVO
//   qa.ashx llamaba a dbo.usp_QaWeb_Resumen / _Qare / _Detalle / _Catalogos
//   (app/sql/10_qa_web.sql). Esos objetos NUNCA se desplegaron en
//   Tickets_Proactivanet, asi que el tablero no podia funcionar contra la base
//   real: cada peticion moria con "no se encontro el procedimiento".
//
//   La base SI tiene, desde antes, la familia dbo.usp_CorreoQA_* que alimenta
//   el correo diario de QA (ver reenviacorreo/Enviar_CorreoQA.ps1). Esos
//   procedimientos leen dbo.vw_CorreoQA_Base, la MISMA vista que leian los
//   usp_QaWeb_*. El tablero se reengancha a ellos y aqui vive todo el pegamento.
//
//   Regla: la logica de negocio de QA (la regla de Validacion, el filtro de
//   tickets en alcance, la resolucion de GrupoCorrecto, los KPIs de ayer y de
//   la semana anterior por FechaFirmaSolucion) sigue viviendo en la base. Lo
//   que se hace aqui es SOLO lo que ningun procedimiento existente entrega:
//   agrupar y contar filas que la base ya devolvio, y recortar/paginar.
//
// LO QUE NO SE HACE AQUI
//   - No se ejecuta SQL escrito a mano: todo son EXEC de procedimientos que ya
//     estaban en la base. No se crea, altera ni borra ningun objeto.
//   - No se reimplementa la regla de Validacion: los cuatro estados
//     (OK / Incorrecto / Valido / Sin catalogo) llegan ya calculados en la
//     columna Validacion de cada fila del detalle.
//   - No se inventa ningun porcentaje de cumplimiento QARE.
//   - No se sustituye ningun NULL por un valor de relleno.
//
// COSTE CONOCIDO
//   Cuatro bloques del resumen (validacion, recategorizacion, los contadores
//   QA/QARE y las distribuciones) no los produce ningun procedimiento
//   existente. La unica via sin tocar la base es agregarlos en memoria sobre
//   el detalle del rango, que usp_CorreoQA_Detalle si devuelve. Por eso el
//   resumen hace una pasada completa del detalle y la cachea unos minutos.
//   Con la ventana por defecto de 15 dias son unos pocos miles de filas.

using System;
using System.Collections.Generic;
using System.Web;
using System.Web.Caching;

public static class QaCorreo
{
    // -------------------------------------------------------- procedimientos
    // Los nombres estan aqui y en ningun otro lado. Todos existen en
    // Tickets_Proactivanet desde antes de este tablero.
    public const string ProcKpis = "dbo.usp_CorreoQA_Kpis";
    public const string ProcPorGrupo = "dbo.usp_CorreoQA_PorGrupo";
    public const string ProcPorTecnico = "dbo.usp_CorreoQA_PorTecnico";
    public const string ProcTopCategorias = "dbo.usp_CorreoQA_TopCategorias";
    public const string ProcDetalle = "dbo.usp_CorreoQA_Detalle";
    public const string ProcCatalogoCategorias = "dbo.usp_CorreoQA_CatalogoCategorias";
    public const string ProcGruposValidos = "dbo.usp_CorreoQA_GruposValidos";

    // usp_CorreoQA_Detalle no pagina: recorta con @Top. El tope tiene que ser
    // mayor que cualquier ventana razonable (15 dias son ~5.000 tickets) pero
    // acotado, para que un rango de un año no intente traer la vista entera.
    // Si el resultado llega justo en el tope, el handler lo marca en "source".
    private const int TopDetalle = 50000;

    // @Minimo de usp_CorreoQA_PorGrupo / _PorTecnico. El correo lo usa para no
    // listar grupos con uno o dos tickets; el tablero los quiere todos.
    private const int MinimoSinUmbral = 1;

    // Categorias que se piden a usp_CorreoQA_TopCategorias para el resumen.
    private const int TopCategoriasFilas = 10;

    // Vida del detalle cacheado. Corta a proposito: el tablero es de datos en
    // vivo, esto solo evita repetir la misma pasada al recargar o al pasar de
    // pagina en el detalle.
    private const int SegundosCache = 120;

    // Por encima de esto el detalle no se cachea: no vale la pena sostener en
    // memoria del App Pool el resultado de un rango enorme.
    private const int FilasMaximasCacheables = 20000;

    // ------------------------------------------------------------- columnas
    // Nombres de columna del result set de usp_CorreoQA_Detalle. Son los
    // encabezados del TICKETS_QA_<fecha>.xlsx que ese mismo procedimiento
    // exporta para el correo, y son los que qa_test.js lee literalmente.
    //
    // El segundo valor es el nombre de la columna equivalente en
    // dbo.vw_CorreoQA_Base. Sirve de red: si el procedimiento devolviera la
    // columna sin renombrar, la fila se normaliza aqui y el tablero no se
    // entera. Ninguno de los dos nombres esta inventado: los dos estan
    // verificados contra la base.
    public const string ColCodigo = "Código";
    public const string ColFechaRegistro = "Fecha de registro";
    public const string ColTitulo = "Título";
    public const string ColGrupo = "Grupo";
    public const string ColTecnico = "Técnico de 2ª línea";
    public const string ColCategoria = "Categoría";
    public const string ColGrupoCorrecto = "Grupo Correcto";
    public const string ColValidacion = "Validacion";

    private static readonly string[][] AliasColumnas = new string[][]
    {
        new[] { ColCodigo,        "CodigoTicket"  },
        new[] { ColFechaRegistro, "FechaRegistro" },
        new[] { ColTitulo,        "Titulo"        },
        new[] { ColGrupo,         "Grupo"         },
        new[] { ColTecnico,       "Tecnico"       },
        new[] { ColCategoria,     "Categoria"     },
        new[] { ColGrupoCorrecto, "GrupoCorrecto" },
        new[] { ColValidacion,    "Validacion"    },
    };

    // Los 12 campos QA/QARE, en el orden que es contrato con el frontend:
    // action=summary y action=qare devuelven los campos en la MISMA posicion
    // porque el tablero pide la distribucion por indice.
    //
    // El primer valor es la etiqueta visible (columna del detalle); el segundo,
    // la columna de la vista, otra vez como red por si el procedimiento no
    // renombra.
    private static readonly string[][] CamposQare = new string[][]
    {
        new[] { "QA - ¿Aparece algún mensaje de error o describe tu necesidad?",                        "QA_MensajeError" },
        new[] { "QA - ¿Con qué frecuencia ocurre?",                                                     "QA_Frecuencia" },
        new[] { "QA - ¿En qué aplicación estabas cuando sucedió el incidente?",                         "QA_Aplicacion" },
        new[] { "QA - Describe paso a paso qué hiciste antes del error o detalla la petición requerida", "QA_PasoAPaso" },
        new[] { "QARe - ¿Cuál fue la causa del incidente/petición?",                                    "QARe_Causa" },
        new[] { "QARe - ¿El usuario confirmó la solución?",                                             "QARe_UsuarioConfirmo" },
        new[] { "QARe - ¿Esta solución aplica para otros casos similares?",                             "QARe_AplicaOtrosCasos" },
        new[] { "QARe - ¿Se debe generar o actualizar artículo de conocimiento?",                       "QARe_GenerarArticulo" },
        new[] { "QARE - ¿Verificaste la correcta clasificación del ticket?",                            "QARe_VerificoClasificacion" },
        new[] { "QARe - Adjunta evidencia de la solución (logs, capturas, validación)",                 "QARe_Evidencia" },
        new[] { "QARe - Describe la solución aplicada (pasos claros y replicables)",                    "QARe_DescripcionSolucion" },
        new[] { "QARe - Tipo de solución aplicada",                                                     "QARe_TipoSolucion" },
    };

    // Regla de distribucion, copiada tal cual de la que ya usaba el tablero:
    // solo se enumeran las respuestas codificadas (pocas y cortas). Un campo de
    // texto libre se marca sin distribucion y nunca se lista.
    private const int MaximoValoresDistintos = 50;
    private const int MaximoLargoValor = 120;

    // Las comparaciones de texto ignoran mayusculas porque el collation del
    // servidor tambien: si la base cuenta 'SI' y 'Si' como el mismo valor, el
    // conteo de valores distintos de aqui tiene que hacer lo mismo.
    private static readonly StringComparer Comparador = StringComparer.OrdinalIgnoreCase;

    // ============================================================== lecturas
    // Cada metodo es un EXEC de un procedimiento que ya existia. Los result
    // sets se devuelven crudos: quien los interpreta es qa.ashx.

    public static Dictionary<string, object> Kpis(string fi, string ff)
    {
        return QaDb.PrimeraFila(QaDb.EjecutarMultiple(ProcKpis, Rango(fi, ff)), 0);
    }

    public static List<Dictionary<string, object>> PorGrupo(string fi, string ff)
    {
        var parametros = Rango(fi, ff);
        parametros["Minimo"] = MinimoSinUmbral;
        return QaDb.Conjunto(QaDb.EjecutarMultiple(ProcPorGrupo, parametros), 0);
    }

    public static List<Dictionary<string, object>> PorTecnico(string fi, string ff)
    {
        var parametros = Rango(fi, ff);
        parametros["Minimo"] = MinimoSinUmbral;
        return QaDb.Conjunto(QaDb.EjecutarMultiple(ProcPorTecnico, parametros), 0);
    }

    public static List<Dictionary<string, object>> TopCategorias(string fi, string ff)
    {
        var parametros = Rango(fi, ff);
        parametros["Top"] = TopCategoriasFilas;
        return QaDb.Conjunto(QaDb.EjecutarMultiple(ProcTopCategorias, parametros), 0);
    }

    public static List<Dictionary<string, object>> CatalogoCategorias(bool soloVigentes)
    {
        var parametros = new Dictionary<string, object>();
        parametros["SoloVigentes"] = soloVigentes ? 1 : 0;
        return QaDb.Conjunto(QaDb.EjecutarMultiple(ProcCatalogoCategorias, parametros), 0);
    }

    public static List<Dictionary<string, object>> GruposValidos()
    {
        // Sin parametros: asi esta declarado el procedimiento.
        return QaDb.Conjunto(QaDb.EjecutarMultiple(ProcGruposValidos, null), 0);
    }

    // -------------------------------------------------------------- detalle
    // Filas del rango, normalizadas y cacheadas unos minutos. @SoloIncorrectos
    // lo resuelve la base cuando el tablero pide justo ese estado; el resto de
    // filtros no los soporta el procedimiento y se aplican despues, en
    // Filtrar(), sin que el navegador vea la diferencia.
    public static List<Dictionary<string, object>> Detalle(string fi, string ff, bool soloIncorrectos)
    {
        string clave = "qa:detalle:" + fi + ":" + ff + ":" + (soloIncorrectos ? "1" : "0");

        var cache = HttpRuntime.Cache;
        if (cache != null)
        {
            var guardado = cache[clave] as List<Dictionary<string, object>>;
            if (guardado != null) return guardado;
        }

        var parametros = Rango(fi, ff);
        parametros["SoloIncorrectos"] = soloIncorrectos ? 1 : 0;
        parametros["Top"] = TopDetalle;

        var filas = QaDb.Conjunto(QaDb.EjecutarMultiple(ProcDetalle, parametros), 0);
        foreach (var fila in filas) Normalizar(fila);

        if (cache != null && filas.Count <= FilasMaximasCacheables)
        {
            cache.Insert(clave, filas, null,
                         DateTime.UtcNow.AddSeconds(SegundosCache),
                         Cache.NoSlidingExpiration);
        }

        return filas;
    }

    // true cuando el detalle llego pegado al tope de @Top y por tanto puede
    // estar recortado. El handler lo publica en "source" para que nadie lea
    // los numeros como si fueran el rango completo.
    public static bool Truncado(List<Dictionary<string, object>> filas)
    {
        return filas != null && filas.Count >= TopDetalle;
    }

    // Un valor que el procedimiento ya devuelve con el nombre visible se deja
    // como esta. Solo se rellena el nombre visible que falte, copiando el de la
    // vista: asi el contrato del frontend no depende de cual de los dos juegos
    // de nombres traiga el result set.
    private static void Normalizar(Dictionary<string, object> fila)
    {
        if (fila == null) return;

        foreach (var par in AliasColumnas)
        {
            if (fila.ContainsKey(par[0])) continue;
            object valor;
            if (fila.TryGetValue(par[1], out valor)) fila[par[0]] = valor;
        }

        foreach (var campo in CamposQare)
        {
            if (fila.ContainsKey(campo[0])) continue;
            object valor;
            if (fila.TryGetValue(campo[1], out valor)) fila[campo[0]] = valor;
        }
    }

    // Filtros que usp_CorreoQA_Detalle no tiene. Igualdad exacta, como el '='
    // del procedimiento; un filtro vacio no filtra.
    public static List<Dictionary<string, object>> Filtrar(
        List<Dictionary<string, object>> filas,
        object validacion, object grupo, object tecnico, object grupoCorrecto)
    {
        var salida = new List<Dictionary<string, object>>();
        foreach (var fila in filas)
        {
            if (!Coincide(fila, ColValidacion, validacion)) continue;
            if (!Coincide(fila, ColGrupo, grupo)) continue;
            if (!Coincide(fila, ColTecnico, tecnico)) continue;
            if (!Coincide(fila, ColGrupoCorrecto, grupoCorrecto)) continue;
            salida.Add(fila);
        }
        return salida;
    }

    private static bool Coincide(Dictionary<string, object> fila, string columna, object esperado)
    {
        var texto = esperado as string;
        if (string.IsNullOrWhiteSpace(texto)) return true;
        return string.Equals(QaDb.Texto(fila, columna), texto.Trim(),
                             StringComparison.OrdinalIgnoreCase);
    }

    // Una pagina de filas. tamano = 0 significa "todas las que pasaron el
    // filtro", y solo llega aqui cuando el cliente lo pidio explicitamente.
    public static List<Dictionary<string, object>> Paginar(
        List<Dictionary<string, object>> filas, int pagina, int tamano)
    {
        if (pagina < 1) pagina = 1;

        int salto = tamano == 0 ? 0 : (pagina - 1) * tamano;
        if (salto > filas.Count) salto = filas.Count;

        int toma = tamano == 0 ? filas.Count - salto
                               : Math.Min(tamano, filas.Count - salto);
        return filas.GetRange(salto, toma);
    }

    // ============================================================ agregados
    // Lo que ningun procedimiento existente devuelve, contado sobre las filas
    // que la base ya entrego. Aqui no se decide si un ticket es incorrecto:
    // eso llega resuelto en la columna Validacion.
    public sealed class Agregados
    {
        public long Total;
        public List<object> Validacion = new List<object>();
        public List<object> Recategorizacion = new List<object>();
        public List<object> Campos = new List<object>();
        // Distribucion de respuestas por indice de campo (0..11). null en los
        // campos de texto libre, igual que antes: eso es lo que distingue un
        // campo codificado de uno abierto.
        public List<List<object>> Distribuciones = new List<List<object>>();
        // Incorrectos por grupo y por tecnico. Solo se usan para completar lo
        // que los procedimientos del correo dejan fuera por su @Minimo o por
        // sus exclusiones; no sustituyen sus conteos.
        public Dictionary<string, long> IncorrectosPorGrupo =
            new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, long> IncorrectosPorTecnico =
            new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
    }

    public static Agregados Agregar(List<Dictionary<string, object>> filas)
    {
        var agregados = new Agregados();
        agregados.Total = filas.Count;

        var porValidacion = new Dictionary<string, long>(Comparador);
        var recategorizacion = new Dictionary<string, long>();
        var etiquetasRecat = new Dictionary<string, string[]>();

        // Un diccionario de valores distintos por campo QA/QARE.
        var valores = new List<Dictionary<string, long>>();
        var respondidos = new long[CamposQare.Length];
        var largoMaximo = new int[CamposQare.Length];
        for (int i = 0; i < CamposQare.Length; i++)
            valores.Add(new Dictionary<string, long>(Comparador));

        foreach (var fila in filas)
        {
            string validacion = QaDb.Texto(fila, ColValidacion);
            Sumar(porValidacion, Clave(validacion), 1);

            bool incorrecto = string.Equals(validacion, "Incorrecto",
                                            StringComparison.OrdinalIgnoreCase);
            if (incorrecto)
            {
                Sumar(agregados.IncorrectosPorGrupo, Clave(QaDb.Texto(fila, ColGrupo)), 1);
                Sumar(agregados.IncorrectosPorTecnico, Clave(QaDb.Texto(fila, ColTecnico)), 1);

                string grupo = QaDb.Texto(fila, ColGrupo);
                string correcto = QaDb.Texto(fila, ColGrupoCorrecto);
                string par = Clave(grupo) + "\u0001" + Clave(correcto);
                Sumar(recategorizacion, par, 1);
                if (!etiquetasRecat.ContainsKey(par))
                    etiquetasRecat[par] = new[] { grupo, correcto };
            }

            for (int i = 0; i < CamposQare.Length; i++)
            {
                string valor = Valor(fila, CamposQare[i]);
                if (valor == null) continue;

                respondidos[i]++;
                if (valor.Length > largoMaximo[i]) largoMaximo[i] = valor.Length;
                Sumar(valores[i], valor, 1);
            }
        }

        // --- validacion: los cuatro estados por separado, nunca agrupados.
        var estados = new List<KeyValuePair<string, long>>(porValidacion);
        estados.Sort(PorTicketsDesc);
        foreach (var estado in estados)
        {
            var item = new Dictionary<string, object>();
            item["validacion"] = Etiqueta(estado.Key);
            item["tickets"] = estado.Value;
            item["pct"] = agregados.Total == 0
                ? 0.0
                : Math.Round(100.0 * estado.Value / agregados.Total, 2,
                             MidpointRounding.AwayFromZero);
            agregados.Validacion.Add(item);
        }

        // --- recategorizacion: pares grupo actual -> grupo correcto.
        var pares = new List<KeyValuePair<string, long>>(recategorizacion);
        pares.Sort(PorTicketsDesc);
        foreach (var par in pares)
        {
            var item = new Dictionary<string, object>();
            item["grupo"] = etiquetasRecat[par.Key][0];
            // NULL de verdad cuando el ticket no tiene grupo correcto: el
            // tablero lo pinta como "Sin grupo correcto", no como un grupo.
            item["grupoCorrecto"] = etiquetasRecat[par.Key][1];
            item["tickets"] = par.Value;
            agregados.Recategorizacion.Add(item);
        }

        // --- campos QA/QARE: contadores en crudo, sin porcentaje.
        for (int i = 0; i < CamposQare.Length; i++)
        {
            int distintos = valores[i].Count;
            bool tieneDistribucion = distintos >= 1
                                     && distintos <= MaximoValoresDistintos
                                     && largoMaximo[i] <= MaximoLargoValor;

            var campo = new Dictionary<string, object>();
            campo["campo"] = CamposQare[i][0];
            campo["respondidos"] = respondidos[i];
            campo["sinRespuesta"] = agregados.Total - respondidos[i];
            campo["valoresDistintos"] = (long)distintos;
            campo["tieneDistribucion"] = tieneDistribucion;
            agregados.Campos.Add(campo);

            if (!tieneDistribucion) { agregados.Distribuciones.Add(null); continue; }

            var respuestas = new List<KeyValuePair<string, long>>(valores[i]);
            respuestas.Sort(PorTicketsDesc);

            var lista = new List<object>();
            foreach (var respuesta in respuestas)
            {
                var item = new Dictionary<string, object>();
                item["respuesta"] = respuesta.Key;
                item["tickets"] = respuesta.Value;
                lista.Add(item);
            }
            agregados.Distribuciones.Add(lista);
        }

        return agregados;
    }

    // Grupos o tecnicos que el procedimiento del correo dejo fuera (por su
    // @Minimo, o porque el correo excluye 'Sin tecnico') y que el tablero si
    // tiene que mostrar. Los que el procedimiento SI devolvio conservan su
    // conteo: la base manda, esto solo completa.
    public static void Completar(List<object> destino, Dictionary<string, long> agregado,
                                 string clave, HashSet<string> yaListados)
    {
        var faltantes = new List<KeyValuePair<string, long>>();
        foreach (var par in agregado)
            if (!yaListados.Contains(Clave(par.Key))) faltantes.Add(par);

        faltantes.Sort(PorTicketsDesc);
        foreach (var par in faltantes)
        {
            var item = new Dictionary<string, object>();
            item[clave] = Etiqueta(par.Key);
            item["tickets"] = par.Value;
            destino.Add(item);
        }
    }

    // ------------------------------------------------------------- utiles
    private static Dictionary<string, object> Rango(string fi, string ff)
    {
        var parametros = new Dictionary<string, object>();
        parametros["FechaInicio"] = fi;
        parametros["FechaFin"] = ff;
        return parametros;
    }

    // Un NULL del origen no es lo mismo que una cadena vacia, y no puede
    // usarse como clave de diccionario. Se representa con un centinela que
    // Etiqueta() vuelve a convertir en NULL al escribir el JSON.
    private const string Nulo = "\u0000<null>";

    public static string Clave(string valor) { return valor == null ? Nulo : valor; }
    private static string Etiqueta(string clave) { return clave == Nulo ? null : clave; }

    // El valor de un campo QA/QARE, con la misma normalizacion que aplicaba la
    // base: espacios recortados, vacio = sin respuesta, y recorte a 4000
    // caracteres para que agrupar sea barato (solo afecta al conteo de valores
    // distintos de los campos de texto libre, que nunca se enumeran).
    private static string Valor(Dictionary<string, object> fila, string[] campo)
    {
        string texto = QaDb.Texto(fila, campo[0]);
        if (texto == null) texto = QaDb.Texto(fila, campo[1]);
        if (texto == null) return null;

        texto = texto.Trim();
        if (texto.Length == 0) return null;
        return texto.Length > 4000 ? texto.Substring(0, 4000) : texto;
    }

    private static void Sumar(Dictionary<string, long> mapa, string clave, long cuanto)
    {
        long actual;
        mapa[clave] = mapa.TryGetValue(clave, out actual) ? actual + cuanto : cuanto;
    }

    // Mas tickets primero; a igualdad, por nombre, para que dos peticiones
    // iguales devuelvan siempre el mismo orden.
    private static int PorTicketsDesc(KeyValuePair<string, long> a, KeyValuePair<string, long> b)
    {
        if (a.Value != b.Value) return b.Value.CompareTo(a.Value);
        return string.Compare(a.Key, b.Key, StringComparison.OrdinalIgnoreCase);
    }
}
