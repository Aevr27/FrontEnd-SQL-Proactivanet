<%@ WebHandler Language="C#" Class="Qa" %>

// qa.ashx - API de solo lectura del tablero de QA.
//
// El navegador NUNCA habla con SQL Server: pide JSON a este handler, y el
// handler es el unico que abre la conexion. La cadena de conexion vive en
// Web.config (ver App_Code/QaDb.cs) y no aparece en ninguna respuesta.
//
//   qa_test.html/js  ->  qa.ashx  ->  SQL Server  ->  JSON  ->  tablero
//
// FUENTE DE VERDAD
//   Los procedimientos dbo.usp_CorreoQA_*, los MISMOS que alimentan el correo
//   diario de QA (reenviacorreo/Enviar_CorreoQA.ps1). Todos leen
//   dbo.vw_CorreoQA_Base, asi que el tablero y el correo no pueden dar numeros
//   distintos: comparten la regla de Validacion, no la reimplementan.
//
//   Hasta ahora este handler llamaba a dbo.usp_QaWeb_Resumen / _Qare /
//   _Detalle / _Catalogos (app/sql/10_qa_web.sql). Esos objetos nunca se
//   desplegaron en la base real, asi que el tablero no podia funcionar. Se
//   dejaron de usar; el pegamento entre los procedimientos que SI existen y
//   este contrato vive en App_Code/QaCorreo.cs.
//
// VENTANA
//   Por defecto los ultimos 15 dias, igual que usp_CorreoQA_Kpis. Se puede
//   mover con &fecha_inicio=aaaa-mm-dd&fecha_fin=aaaa-mm-dd, sobre todo para
//   comparar contra un correo concreto.
//
// CONTRATO (el mismo de siempre; el tablero no tuvo que cambiar)
//   GET qa.ashx?action=summary
//       Respuesta por defecto y ligera. generatedAt, source, summary,
//       historico, porGrupo, porTecnico, recategorizacion, validacion, un
//       resumen QARE (contadores por campo, sin las distribuciones) y
//       topCategorias. NO incluye detalle ni catalogos.
//
//   GET qa.ashx?action=qare
//       Bloque QARE completo, con las distribuciones de respuestas. Sin
//       porcentaje de cumplimiento: la regla oficial no esta definida.
//
//   GET qa.ashx?action=detail[&validacion=][&grupo=][&tecnico=][&grupoCorrecto=]
//                            [&page=1][&pageSize=100]
//       Detalle de tickets filtrado y paginado EN EL SERVIDOR.
//       pageSize por defecto 100, maximo 1000; pageSize=0 devuelve todas las
//       filas que pasan el filtro (peticion explicita).
//       Respuesta: { page, pageSize, total, returned, filters, meta, rows }
//
//   GET qa.ashx?action=catalogos
//       catalogos.categorias y catalogos.gruposValidos. Solo bajo peticion.
//
//   GET qa.ashx?action=meta
//       Solo trazabilidad: generatedAt y source.
//
// ERRORES: 400 accion o parametro invalido, 500 sitio mal configurado,
//          502 la base no respondio. Siempre como {"error":true,"message":"..."}.
//          El mensaje nunca lleva servidor, usuario, ruta ni stack trace.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.Globalization;
using System.Web;
using System.Web.Script.Serialization;

public class Qa : IHttpHandler
{
    // Lista blanca: cualquier otro valor de ?action= se rechaza con 400.
    private static readonly string[] AccionesPermitidas = new string[]
    {
        "summary", "detail", "qare", "catalogos", "meta",
    };

    private const int TamanoPaginaPorDefecto = 100;
    private const int TamanoPaginaMaximo = 1000;

    private const string NotaQare =
        "Datos QA/QARE en crudo. No se aplica ninguna formula de cumplimiento " +
        "porque la regla oficial aun no esta definida.";

    public void ProcessRequest(HttpContext context)
    {
        var response = context.Response;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentEncoding = System.Text.Encoding.UTF8;
        // Datos en vivo: nunca se sirven de cache.
        response.Cache.SetCacheability(HttpCacheability.NoCache);

        try
        {
            string accion = (context.Request.QueryString["action"] ?? "summary")
                            .Trim().ToLowerInvariant();

            // La accion se valida antes de tocar la base: una accion
            // desconocida nunca llega a abrir una conexion.
            if (Array.IndexOf(AccionesPermitidas, accion) < 0)
            {
                Error(context, 400,
                    "Accion no valida. Acciones permitidas: summary, detail, qare, catalogos, meta.");
                return;
            }

            string fi, ff;
            QaParams.Rango(context.Request, out fi, out ff);

            switch (accion)
            {
                case "summary":   Resumen(context, fi, ff);   return;
                case "qare":      Qare(context, fi, ff);      return;
                case "catalogos": Catalogos(context, fi, ff); return;
                case "meta":      Meta(context, fi, ff);      return;
                case "detail":    Detalle(context, fi, ff);   return;

                default:
                    Error(context, 400,
                        "Accion no valida. Acciones permitidas: summary, detail, qare, catalogos, meta.");
                    return;
            }
        }
        catch (QaSolicitudInvalida ex)
        {
            // Lo unico que el usuario puede corregir por si mismo: se le dice
            // exactamente que parametro esta mal.
            Error(context, 400, ex.Message);
        }
        catch (ConfigurationErrorsException ex)
        {
            // Falta Web.config o la cadena de conexion. El mensaje explica que
            // archivo copiar; no contiene servidor, usuario ni contraseña.
            Error(context, 500, ex.Message);
        }
        catch (SqlException ex)
        {
            // El numero de error de SQL Server es lo unico que separa una
            // caida de red de un objeto que no existe o de un permiso que
            // falta. Antes los tres salian con el mismo texto ("revisa la
            // VPN"), y eso mandaba a buscar el problema donde no estaba: con
            // el tablero principal funcionando contra la MISMA cadena de
            // conexion, un procedimiento que el sitio no puede ejecutar se
            // leia como si el servidor estuviera inalcanzable.
            //
            // Sigue sin escribirse ex.Message: llevaria el servidor, la base
            // y el nombre del procedimiento. Solo sale ex.Number, que es un
            // codigo de diagnostico y no identifica nada de la instalacion.
            int codigo;
            string mensaje;

            switch (ex.Number)
            {
                // No se llego al servidor: red, DNS, VPN o instancia parada.
                case 53:      // network path not found
                case 40:      // could not open a connection
                case -2:      // timeout al conectar
                case 10060:   // connection attempt failed
                case 11001:   // host desconocido
                    codigo = 502;
                    mensaje = "No se pudo contactar al servidor de SQL. Revisa la conexion " +
                              "(VPN, red, servidor SQL) o intentalo mas tarde.";
                    break;

                // Se llego al servidor, pero rechazo la identidad del sitio.
                case 18456:   // login failed
                case 18452:   // login from untrusted domain
                case 4060:    // no se pudo abrir la base
                    codigo = 502;
                    mensaje = "El servidor de SQL rechazo las credenciales del sitio o la base " +
                              "indicada. Revisa la cadena de conexion de Web.config.";
                    break;

                // Se llego y se autentico: el login del sitio no alcanza los
                // procedimientos de QA. Eso es un permiso de este servidor, no
                // una caida aguas arriba, asi que 500 y no 502.
                case 2812:    // no se encontro el procedimiento almacenado
                case 208:     // nombre de objeto no valido
                case 229:     // permiso denegado sobre el objeto
                case 4413:    // no se pudo enlazar la vista
                    codigo = 500;
                    mensaje = "El sitio no puede usar los procedimientos de QA de la base. " +
                              "Hace falta GRANT EXECUTE sobre dbo.usp_CorreoQA_Kpis, _PorGrupo, " +
                              "_PorTecnico, _TopCategorias, _Detalle, _CatalogoCategorias y " +
                              "_GruposValidos, y SELECT sobre dbo.vw_CorreoQA_Base.";
                    break;

                default:
                    codigo = 502;
                    mensaje = "No se pudo consultar la base de datos de QA. Revisa la conexion " +
                              "(VPN, servidor SQL, permisos) o intentalo mas tarde.";
                    break;
            }

            Error(context, codigo, mensaje, ex.Number);
        }
        catch (Exception)
        {
            Error(context, 500, "Error interno al procesar la solicitud de QA.");
        }
    }

    // ------------------------------------------------------------ summary
    // Cinco procedimientos existentes + una pasada de agregacion sobre el
    // detalle del rango, que es lo unico que ninguno de ellos devuelve
    // (validacion por estado, pares de recategorizacion y campos QA/QARE).
    private static void Resumen(HttpContext context, string fi, string ff)
    {
        var kpis = QaCorreo.Kpis(fi, ff);

        var filas = QaCorreo.Detalle(fi, ff, false);
        var agregados = QaCorreo.Agregar(filas);

        // El total lo manda usp_CorreoQA_Kpis. Solo si el procedimiento no
        // devolvio fila (rango sin tickets) se cae al conteo del detalle.
        long total = kpis == null ? agregados.Total : QaDb.Entero(kpis, "TicketsTotales");

        var salida = new Dictionary<string, object>();
        salida["generatedAt"] = Ahora();
        salida["source"] = Origen(fi, ff, total, filas);

        var resumen = new Dictionary<string, object>();
        resumen["totalTickets"] = total;
        resumen["incorrectos"] = QaDb.Entero(kpis, "TicketsIncorrectos");
        // NULL cuando el rango no tiene un solo ticket: se muestra como 0,00 %,
        // no se inventa un porcentaje.
        resumen["incorrectosPct"] = QaDb.Decimal2(kpis, "PorcentajeIncorrectos") ?? (object)0.0;
        salida["summary"] = resumen;

        salida["historico"] = kpis == null ? null : Historico(kpis, ff);

        salida["porGrupo"] = PorGrupo(fi, ff, agregados);
        salida["porTecnico"] = PorTecnico(fi, ff, agregados);
        salida["validacion"] = agregados.Validacion;
        salida["recategorizacion"] = agregados.Recategorizacion;

        // Bloque aditivo: el tablero actual no lo pinta, pero es la unica
        // metrica por categoria que la base ya publica (usp_CorreoQA_TopCategorias,
        // el mismo top que sale en el correo diario).
        salida["topCategorias"] = QaCorreo.TopCategorias(fi, ff);

        // Version ligera de QARE: contadores por campo, sin las
        // distribuciones de respuestas (esas se piden con action=qare).
        var qare = new Dictionary<string, object>();
        qare["nota"] = NotaQare;
        qare["totalTickets"] = total;
        qare["campos"] = agregados.Campos;
        salida["qare"] = qare;

        Escribir(context, salida);
    }

    // KPIs de un solo dia, contados por fecha de firma de solucion.
    //
    // Los conteos (TicketsIncorrectosAyer / SemanaAnterior) los calcula
    // usp_CorreoQA_Kpis; aqui solo se etiquetan con su fecha. Si el
    // procedimiento devuelve esas fechas se usan tal cual; si no, se derivan
    // del fin del rango con la MISMA formula que documenta el procedimiento:
    // ayer = fin - 1, y "semana anterior" = fin - 8 (un solo dia, el mismo dia
    // de la semana que ayer, no un acumulado de siete).
    private static Dictionary<string, object> Historico(Dictionary<string, object> kpis, string ff)
    {
        var historico = new Dictionary<string, object>();
        historico["fechaReferencia"] = QaDb.Fecha(kpis, "FechaFin") ?? ff;
        historico["fechaAyer"] = QaDb.Fecha(kpis, "FechaAyer") ?? Desplazar(ff, -1);
        historico["incorrectosAyer"] = QaDb.Entero(kpis, "TicketsIncorrectosAyer");
        historico["fechaSemanaAnterior"] =
            QaDb.Fecha(kpis, "FechaSemanaAnterior") ?? Desplazar(ff, -8);
        historico["incorrectosSemanaAnterior"] =
            QaDb.Entero(kpis, "TicketsIncorrectosSemanaAnterior");
        return historico;
    }

    // Incorrectos por grupo, tal como los cuenta usp_CorreoQA_PorGrupo. Se
    // pide sin umbral (@Minimo = 1) para que el tablero vea todos los grupos.
    private static List<object> PorGrupo(string fi, string ff, QaCorreo.Agregados agregados)
    {
        var salida = new List<object>();
        var listados = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var fila in QaCorreo.PorGrupo(fi, ff))
        {
            var item = new Dictionary<string, object>();
            item["grupo"] = QaDb.Texto(fila, "Grupo");
            item["tickets"] = QaDb.Entero(fila, "TicketsIncorrectos");
            salida.Add(item);
            listados.Add(QaCorreo.Clave(QaDb.Texto(fila, "Grupo")));
        }

        // Lo que el procedimiento del correo deje fuera se completa con el
        // conteo del detalle, para que el tablero no pierda filas.
        QaCorreo.Completar(salida, agregados.IncorrectosPorGrupo, "grupo", listados);
        return salida;
    }

    // Igual que PorGrupo, con una diferencia importante: usp_CorreoQA_PorTecnico
    // se escribio para el correo, que no lista 'Sin tecnico'. El tablero SI
    // tiene que mostrar esa barra, para que los tickets sin responsable de 2a
    // linea no desaparezcan del conteo; por eso se completa con el detalle.
    private static List<object> PorTecnico(string fi, string ff, QaCorreo.Agregados agregados)
    {
        var salida = new List<object>();
        var listados = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var fila in QaCorreo.PorTecnico(fi, ff))
        {
            var item = new Dictionary<string, object>();
            item["tecnico"] = QaDb.Texto(fila, "Tecnico");
            item["tickets"] = QaDb.Entero(fila, "TicketsIncorrectos");
            salida.Add(item);
            listados.Add(QaCorreo.Clave(QaDb.Texto(fila, "Tecnico")));
        }

        QaCorreo.Completar(salida, agregados.IncorrectosPorTecnico, "tecnico", listados);
        return salida;
    }

    // --------------------------------------------------------------- qare
    private static void Qare(HttpContext context, string fi, string ff)
    {
        var filas = QaCorreo.Detalle(fi, ff, false);
        var agregados = QaCorreo.Agregar(filas);

        // El orden de los campos es el MISMO que en action=summary: el tablero
        // pide la distribucion por indice, asi que las dos listas tienen que
        // coincidir posicion a posicion.
        var campos = new List<object>();
        for (int i = 0; i < agregados.Campos.Count; i++)
        {
            var campo = (Dictionary<string, object>)agregados.Campos[i];
            // respuestas = null distingue el campo de texto libre del campo
            // codificado, igual que hacia el extractor.
            campo["respuestas"] = i < agregados.Distribuciones.Count
                                  ? agregados.Distribuciones[i] : null;
            campos.Add(campo);
        }

        var qare = new Dictionary<string, object>();
        qare["nota"] = NotaQare;
        qare["totalTickets"] = agregados.Total;
        qare["campos"] = campos;

        var salida = new Dictionary<string, object>();
        salida["generatedAt"] = Ahora();
        salida["source"] = Origen(fi, ff, agregados.Total, filas);
        salida["qare"] = qare;

        Escribir(context, salida);
    }

    // ------------------------------------------------------------- detail
    private static void Detalle(HttpContext context, string fi, string ff)
    {
        var request = context.Request;

        // Los filtros usan nombres ASCII simples; se aplican sobre las
        // columnas del result set. Nunca se concatenan a una consulta.
        object validacion = QaParams.Filtro(request, "validacion");
        object grupo = QaParams.Filtro(request, "grupo");
        object tecnico = QaParams.Filtro(request, "tecnico");
        object grupoCorrecto = QaParams.Filtro(request, "grupoCorrecto");

        int pagina = QaParams.Entero(request, "page", 1, 1, int.MaxValue);
        int tamano = QaParams.Entero(request, "pageSize", TamanoPaginaPorDefecto,
                                     0, TamanoPaginaMaximo);

        // El unico filtro que usp_CorreoQA_Detalle sabe aplicar es
        // @SoloIncorrectos. Cuando el tablero pide justo ese estado -- que es
        // su filtro por defecto -- lo resuelve la base y viaja mucho menos.
        bool soloIncorrectos = string.Equals(validacion as string, "Incorrecto",
                                             StringComparison.OrdinalIgnoreCase);

        var filas = QaCorreo.Detalle(fi, ff, soloIncorrectos);
        var filtradas = QaCorreo.Filtrar(filas, validacion, grupo, tecnico, grupoCorrecto);

        long total = filtradas.Count;
        var filasPagina = QaCorreo.Paginar(filtradas, pagina, tamano);

        var filtros = new Dictionary<string, object>();
        filtros["validacion"] = validacion;
        filtros["grupo"] = grupo;
        filtros["tecnico"] = tecnico;
        filtros["grupoCorrecto"] = grupoCorrecto;

        var salida = new Dictionary<string, object>();
        salida["page"] = tamano == 0 ? 1 : pagina;
        salida["pageSize"] = tamano == 0 ? total : (object)tamano;
        salida["total"] = total;
        salida["returned"] = filasPagina.Count;
        salida["filters"] = filtros;
        salida["meta"] = Meta(fi, ff, total, filas);
        salida["rows"] = filasPagina;

        Escribir(context, salida);
    }

    // --------------------------------------------------------- catalogos
    private static void Catalogos(HttpContext context, string fi, string ff)
    {
        var catalogos = new Dictionary<string, object>();
        // Dos procedimientos distintos, uno por catalogo. Las filas van tal
        // como salen de la base: aqui no se renombra ninguna columna.
        catalogos["categorias"] = QaCorreo.CatalogoCategorias(true);
        catalogos["gruposValidos"] = QaCorreo.GruposValidos();

        var salida = new Dictionary<string, object>();
        salida["generatedAt"] = Ahora();
        salida["source"] = Origen(fi, ff, null, null);
        salida["catalogos"] = catalogos;

        Escribir(context, salida);
    }

    // -------------------------------------------------------------- meta
    private static void Meta(HttpContext context, string fi, string ff)
    {
        Escribir(context, Meta(fi, ff, null, null));
    }

    private static Dictionary<string, object> Meta(string fi, string ff, object tickets,
                                                   List<Dictionary<string, object>> filas)
    {
        var meta = new Dictionary<string, object>();
        meta["generatedAt"] = Ahora();
        meta["source"] = Origen(fi, ff, tickets, filas);
        return meta;
    }

    // Trazabilidad de la respuesta: de donde salen los datos y que ventana
    // cubren. Deliberadamente sin servidor, base ni usuario: esto lo ve el
    // navegador.
    private static Dictionary<string, object> Origen(string fi, string ff, object tickets,
                                                     List<Dictionary<string, object>> filas)
    {
        var source = new Dictionary<string, object>();
        source["origen"] = "SQL Server";
        source["vista"] = "dbo.vw_CorreoQA_Base";
        source["fechaInicio"] = fi;
        source["fechaFin"] = ff;
        source["ticketsRows"] = tickets;
        source["consultadoEn"] = Ahora();
        // usp_CorreoQA_Detalle recorta con @Top. Si el rango pedido lo alcanza,
        // los numeros derivados del detalle cubren solo esas filas, y quien
        // mire el tablero tiene que saberlo.
        source["truncado"] = QaCorreo.Truncado(filas);

        // Sirviendo archivos exportados: el rango real es el del export, no el
        // que venga por query string, y el origen lo dice sin ambiguedad. El
        // tablero pinta source.origen tal cual, asi que se ve en pantalla.
        if (QaDb.ModoSnapshot)
        {
            source["origen"] = "Snapshot sin conexion (datos congelados)";
            source["exportadoEn"] = QaSnapshot.ExportadoEn;
            source["fechaInicio"] = QaSnapshot.FechaInicio ?? fi;
            source["fechaFin"] = QaSnapshot.FechaFin ?? ff;
        }

        return source;
    }

    private static string Ahora()
    {
        return DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
    }

    // Fecha del rango desplazada N dias, en el formato del contrato.
    private static string Desplazar(string fecha, int dias)
    {
        DateTime valor;
        if (!DateTime.TryParseExact(fecha, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                                    DateTimeStyles.None, out valor))
            return null;
        return valor.AddDays(dias).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private static void Escribir(HttpContext context, object salida)
    {
        var serializador = new JavaScriptSerializer();
        // Una pagina de 1000 tickets con descripciones largas pasa de sobra el
        // tope por defecto (2 MB) y saldria como excepcion, no como JSON.
        serializador.MaxJsonLength = int.MaxValue;
        context.Response.Write(serializador.Serialize(salida));
    }

    private static void Error(HttpContext context, int codigo, string mensaje)
    {
        Error(context, codigo, mensaje, null);
    }

    // sqlNumber solo viaja cuando el fallo vino de SQL Server. Es el numero de
    // error, nada mas: sirve para saber si hay que mirar la red, las
    // credenciales o el permiso sobre los procedimientos, y no revela el
    // servidor, la base, el usuario ni la ruta del sitio.
    private static void Error(HttpContext context, int codigo, string mensaje, int? sqlNumber)
    {
        context.Response.Clear();
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.StatusCode = codigo;
        // Sin esto IIS reemplaza el cuerpo por su pagina de error en HTML y el
        // frontend recibe algo que no puede parsear como JSON.
        context.Response.TrySkipIisCustomErrors = true;

        var error = new Dictionary<string, object>();
        error["error"] = true;
        error["message"] = mensaje;
        if (sqlNumber.HasValue)
            error["sqlNumber"] = sqlNumber.Value;
        context.Response.Write(new JavaScriptSerializer().Serialize(error));
    }

    public bool IsReusable { get { return false; } }
}
