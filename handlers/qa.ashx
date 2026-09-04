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
//   Todos los procedimientos usp_QaWeb_* (app/sql/10_qa_web.sql) leen
//   dbo.vw_CorreoQA_Base, la misma vista que usa dbo.usp_CorreoQA_Kpis. El
//   tablero y el correo diario de QA no pueden dar numeros distintos porque
//   comparten la regla de Validacion, no la reimplementan.
//
// VENTANA
//   Por defecto los ultimos 15 dias, igual que usp_CorreoQA_Kpis. Se puede
//   mover con &fecha_inicio=aaaa-mm-dd&fecha_fin=aaaa-mm-dd, sobre todo para
//   comparar contra un correo concreto.
//
// CONTRATO (el mismo de siempre; el tablero no tuvo que cambiar)
//   GET qa.ashx?action=summary
//       Respuesta por defecto y ligera. generatedAt, source, summary,
//       historico, porGrupo, porTecnico, recategorizacion, validacion y un
//       resumen QARE (contadores por campo, sin las distribuciones).
//       NO incluye detalle ni catalogos.
//
//   GET qa.ashx?action=qare
//       Bloque QARE completo, con las distribuciones de respuestas. Sin
//       porcentaje de cumplimiento: la regla oficial no esta definida.
//
//   GET qa.ashx?action=detail[&validacion=][&grupo=][&tecnico=][&grupoCorrecto=]
//                            [&page=1][&pageSize=100]
//       Detalle de tickets filtrado y paginado EN LA BASE.
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
// ERRORES: 400 accion o parametro invalido, 500 sitio mal configurado (incluye
//          los objetos usp_QaWeb_* sin desplegar o sin permiso), 502 no se
//          pudo hablar con la base. Siempre como {"error":true,"message":"..."},
//          y con "sqlNumber" cuando el fallo lo reporto SQL Server.
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
            // conexion, un procedimiento usp_QaWeb_* sin desplegar se leia
            // como si el servidor estuviera inalcanzable.
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

                // Se llego y se autentico: faltan los objetos de QA o el
                // permiso para usarlos. Eso es configuracion de este servidor,
                // no una caida aguas arriba, asi que 500 y no 502.
                case 2812:    // no se encontro el procedimiento almacenado
                case 208:     // nombre de objeto no valido
                case 229:     // permiso denegado sobre el objeto
                case 4413:    // no se pudo enlazar la vista
                    codigo = 500;
                    mensaje = "Faltan los objetos de QA en la base, o el sitio no tiene permiso " +
                              "para usarlos. Despliega sql/10_qa_web.sql y concede EXECUTE sobre " +
                              "los procedimientos usp_QaWeb_*.";
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
    private static void Resumen(HttpContext context, string fi, string ff)
    {
        var resultados = QaDb.EjecutarMultiple("dbo.usp_QaWeb_Resumen", Rango(fi, ff));

        var kpis = QaDb.PrimeraFila(resultados, 0);
        long total = QaDb.Entero(kpis, "TicketsTotales");

        var salida = new Dictionary<string, object>();
        salida["generatedAt"] = Ahora();
        salida["source"] = Origen(fi, ff, total);

        var resumen = new Dictionary<string, object>();
        resumen["totalTickets"] = total;
        resumen["incorrectos"] = QaDb.Entero(kpis, "TicketsIncorrectos");
        // NULL cuando el rango no tiene un solo ticket: se muestra como 0,00 %,
        // no se inventa un porcentaje.
        resumen["incorrectosPct"] = QaDb.Decimal2(kpis, "PorcentajeIncorrectos") ?? (object)0.0;
        salida["summary"] = resumen;

        // KPIs de un solo dia, contados por fecha de firma de solucion.
        var historico = new Dictionary<string, object>();
        historico["fechaReferencia"] = QaDb.Fecha(kpis, "FechaFin");
        historico["fechaAyer"] = QaDb.Fecha(kpis, "FechaAyer");
        historico["incorrectosAyer"] = QaDb.Entero(kpis, "TicketsIncorrectosAyer");
        historico["fechaSemanaAnterior"] = QaDb.Fecha(kpis, "FechaSemanaAnterior");
        historico["incorrectosSemanaAnterior"] = QaDb.Entero(kpis, "TicketsIncorrectosSemanaAnterior");
        salida["historico"] = kpis == null ? null : historico;

        var porGrupo = new List<object>();
        foreach (var fila in QaDb.Conjunto(resultados, 1))
        {
            var item = new Dictionary<string, object>();
            item["grupo"] = QaDb.Texto(fila, "Grupo");
            item["tickets"] = QaDb.Entero(fila, "TicketsIncorrectos");
            porGrupo.Add(item);
        }
        salida["porGrupo"] = porGrupo;

        var porTecnico = new List<object>();
        foreach (var fila in QaDb.Conjunto(resultados, 2))
        {
            var item = new Dictionary<string, object>();
            item["tecnico"] = QaDb.Texto(fila, "Tecnico");
            item["tickets"] = QaDb.Entero(fila, "TicketsIncorrectos");
            porTecnico.Add(item);
        }
        salida["porTecnico"] = porTecnico;

        var validacion = new List<object>();
        foreach (var fila in QaDb.Conjunto(resultados, 3))
        {
            var item = new Dictionary<string, object>();
            item["validacion"] = QaDb.Texto(fila, "Validacion");
            item["tickets"] = QaDb.Entero(fila, "Tickets");
            item["pct"] = QaDb.Decimal2(fila, "Pct") ?? (object)0.0;
            validacion.Add(item);
        }
        salida["validacion"] = validacion;

        var recategorizacion = new List<object>();
        foreach (var fila in QaDb.Conjunto(resultados, 4))
        {
            var item = new Dictionary<string, object>();
            item["grupo"] = QaDb.Texto(fila, "Grupo");
            // NULL de verdad cuando el ticket no tiene grupo correcto: el
            // tablero lo pinta como "Sin grupo correcto", no como un grupo.
            item["grupoCorrecto"] = QaDb.Texto(fila, "GrupoCorrecto");
            item["tickets"] = QaDb.Entero(fila, "Tickets");
            recategorizacion.Add(item);
        }
        salida["recategorizacion"] = recategorizacion;

        // Version ligera de QARE: contadores por campo, sin las
        // distribuciones de respuestas (esas se piden con action=qare).
        var campos = new List<object>();
        foreach (var fila in QaDb.Conjunto(resultados, 5))
            campos.Add(CampoQare(fila));

        var qare = new Dictionary<string, object>();
        qare["nota"] = NotaQare;
        qare["totalTickets"] = total;
        qare["campos"] = campos;
        salida["qare"] = qare;

        Escribir(context, salida);
    }

    // --------------------------------------------------------------- qare
    private static void Qare(HttpContext context, string fi, string ff)
    {
        var resultados = QaDb.EjecutarMultiple("dbo.usp_QaWeb_Qare", Rango(fi, ff));

        // El segundo result set trae las respuestas de todos los campos
        // juntas; se agrupan por Orden para colgarlas del campo que toca.
        var distribuciones = new Dictionary<long, List<object>>();
        long totalTickets = 0;
        foreach (var fila in QaDb.Conjunto(resultados, 1))
        {
            long orden = QaDb.Entero(fila, "Orden");
            List<object> lista;
            if (!distribuciones.TryGetValue(orden, out lista))
            {
                lista = new List<object>();
                distribuciones[orden] = lista;
            }
            var respuesta = new Dictionary<string, object>();
            respuesta["respuesta"] = QaDb.Texto(fila, "Respuesta");
            respuesta["tickets"] = QaDb.Entero(fila, "Tickets");
            lista.Add(respuesta);
        }

        // El orden de los campos es el MISMO que en action=summary: el tablero
        // pide la distribucion por indice, asi que las dos listas tienen que
        // coincidir posicion a posicion.
        var campos = new List<object>();
        foreach (var fila in QaDb.Conjunto(resultados, 0))
        {
            var campo = CampoQare(fila);
            // Todos los campos ven los mismos tickets del rango.
            totalTickets = QaDb.Entero(fila, "Respondidos") + QaDb.Entero(fila, "SinRespuesta");

            List<object> lista;
            // respuestas = null distingue el campo de texto libre del campo
            // codificado, igual que hacia el extractor.
            campo["respuestas"] = distribuciones.TryGetValue(QaDb.Entero(fila, "Orden"), out lista)
                                  ? lista : null;
            campos.Add(campo);
        }

        var qare = new Dictionary<string, object>();
        qare["nota"] = NotaQare;
        qare["totalTickets"] = totalTickets;
        qare["campos"] = campos;

        var salida = new Dictionary<string, object>();
        salida["generatedAt"] = Ahora();
        salida["source"] = Origen(fi, ff, totalTickets);
        salida["qare"] = qare;

        Escribir(context, salida);
    }

    // Contadores de un campo QA/QARE, tal como los devuelve la base. Sin
    // porcentaje de cumplimiento: la regla oficial no esta definida.
    private static Dictionary<string, object> CampoQare(Dictionary<string, object> fila)
    {
        var campo = new Dictionary<string, object>();
        campo["campo"] = QaDb.Texto(fila, "Campo");
        campo["respondidos"] = QaDb.Entero(fila, "Respondidos");
        campo["sinRespuesta"] = QaDb.Entero(fila, "SinRespuesta");
        campo["valoresDistintos"] = QaDb.Entero(fila, "ValoresDistintos");
        campo["tieneDistribucion"] = QaDb.Entero(fila, "TieneDistribucion") == 1;
        return campo;
    }

    // ------------------------------------------------------------- detail
    private static void Detalle(HttpContext context, string fi, string ff)
    {
        var request = context.Request;

        // Los filtros usan nombres ASCII simples; el procedimiento los aplica
        // sobre las columnas de la vista. Nunca se concatenan a una consulta.
        object validacion = QaParams.Filtro(request, "validacion");
        object grupo = QaParams.Filtro(request, "grupo");
        object tecnico = QaParams.Filtro(request, "tecnico");
        object grupoCorrecto = QaParams.Filtro(request, "grupoCorrecto");

        int pagina = QaParams.Entero(request, "page", 1, 1, int.MaxValue);
        int tamano = QaParams.Entero(request, "pageSize", TamanoPaginaPorDefecto,
                                     0, TamanoPaginaMaximo);

        var parametros = Rango(fi, ff);
        parametros["Validacion"] = validacion;
        parametros["Grupo"] = grupo;
        parametros["Tecnico"] = tecnico;
        parametros["GrupoCorrecto"] = grupoCorrecto;
        parametros["Page"] = pagina;
        parametros["PageSize"] = tamano;

        var resultados = QaDb.EjecutarMultiple("dbo.usp_QaWeb_Detalle", parametros);

        long total = QaDb.Entero(QaDb.PrimeraFila(resultados, 0), "Total");
        var filas = QaDb.Conjunto(resultados, 1);

        var filtros = new Dictionary<string, object>();
        filtros["validacion"] = validacion;
        filtros["grupo"] = grupo;
        filtros["tecnico"] = tecnico;
        filtros["grupoCorrecto"] = grupoCorrecto;

        var salida = new Dictionary<string, object>();
        salida["page"] = tamano == 0 ? 1 : pagina;
        salida["pageSize"] = tamano == 0 ? total : (object)tamano;
        salida["total"] = total;
        salida["returned"] = filas.Count;
        salida["filters"] = filtros;
        salida["meta"] = Meta(fi, ff, total);
        salida["rows"] = filas;

        Escribir(context, salida);
    }

    // --------------------------------------------------------- catalogos
    private static void Catalogos(HttpContext context, string fi, string ff)
    {
        var parametros = new Dictionary<string, object>();
        parametros["SoloVigentes"] = 1;

        var resultados = QaDb.EjecutarMultiple("dbo.usp_QaWeb_Catalogos", parametros);

        var catalogos = new Dictionary<string, object>();
        catalogos["categorias"] = QaDb.Conjunto(resultados, 0);
        catalogos["gruposValidos"] = QaDb.Conjunto(resultados, 1);

        var salida = new Dictionary<string, object>();
        salida["generatedAt"] = Ahora();
        salida["source"] = Origen(fi, ff, null);
        salida["catalogos"] = catalogos;

        Escribir(context, salida);
    }

    // -------------------------------------------------------------- meta
    private static void Meta(HttpContext context, string fi, string ff)
    {
        Escribir(context, Meta(fi, ff, null));
    }

    private static Dictionary<string, object> Meta(string fi, string ff, object tickets)
    {
        var meta = new Dictionary<string, object>();
        meta["generatedAt"] = Ahora();
        meta["source"] = Origen(fi, ff, tickets);
        return meta;
    }

    // Trazabilidad de la respuesta: de donde salen los datos y que ventana
    // cubren. Deliberadamente sin servidor, base ni usuario: esto lo ve el
    // navegador.
    private static Dictionary<string, object> Origen(string fi, string ff, object tickets)
    {
        var source = new Dictionary<string, object>();
        source["origen"] = "SQL Server";
        source["vista"] = "dbo.vw_CorreoQA_Base";
        source["fechaInicio"] = fi;
        source["fechaFin"] = ff;
        source["ticketsRows"] = tickets;
        source["consultadoEn"] = Ahora();

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

    private static Dictionary<string, object> Rango(string fi, string ff)
    {
        var parametros = new Dictionary<string, object>();
        parametros["FechaInicio"] = fi;
        parametros["FechaFin"] = ff;
        return parametros;
    }

    private static string Ahora()
    {
        return DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
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
    // credenciales o el despliegue de los procedimientos, y no revela el
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
