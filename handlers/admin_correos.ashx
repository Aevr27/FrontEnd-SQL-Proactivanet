<%@ WebHandler Language="C#" Class="AdminCorreos" %>

// Ejecucion REAL de los tres flujos de correo de la consola de
// administracion (admin.html). Es el hermano "de verdad" de
// admin_prueba_powershell.ashx, que se conserva como prueba de concepto.
//
// NO es un ejecutor generico de comandos:
//
//   - Los nombres de los .ps1 estan fijos en este archivo. El navegador solo
//     manda un identificador de flujo (qa | backlog | servicios); no puede
//     mandar una ruta, un ejecutable ni un comando.
//   - La carpeta de los scripts se lee de Web.config (appSettings, clave
//     unica AdminScriptsDir), nunca del request. Los tres .ps1 viven juntos
//     en esa carpeta, fuera del sitio web, y NO se copian aqui.
//   - El unico parametro variable es -Servicio, y se valida contra la lista
//     blanca de Web.config: al script se le pasa la cadena canonica de la
//     configuracion, no la que escribio el navegador.
//   - Los destinatarios temporales (modo "personalizados" de la consola) NO
//     se pasan por la linea de comandos ni tocan el .ps1: se escribe una
//     copia temporal de config_correo_servicio.json con modo_prueba=true y
//     destinatario_prueba = las direcciones validadas, y se le pasa al
//     script con -RutaCorreo, que ya acepta. El archivo temporal vive en la
//     carpeta de los scripts (fuera del sitio web) y se borra siempre al
//     terminar. El navegador nunca ve el contenido de esa configuracion.
//   - -FechaCorte se calcula SOLO en el servidor (dia anterior a hoy). El
//     navegador no puede influir en ella.
//   - Solo POST ejecuta. GET devuelve metadatos (servicios y fecha de corte)
//     para que la pantalla de revision muestre lo mismo que se va a ejecutar.
//
// Cada script se lanza con WorkingDirectory en su propia carpeta, para que
// sus archivos de configuracion y sus rutas relativas sigan funcionando tal
// como estan hoy. Los .ps1 no se modifican, y aqui no se replica nada de su
// logica (SQL, SMTP, generacion de reportes).
//
// Respuesta JSON (misma forma que el resto de handlers, ver
// DashboardHandler.Responder en App_Code/DashboardDb.cs):
//
//   POST -> { "ok": true|false, "flujo": "qa", "codigoSalida": 0,
//             "salida": "...", "error": "...", "script": "C:\...\x.ps1",
//             "argumentos": "-Servicio \"WMS\" -FechaCorte \"2026-08-31\"",
//             "duracionMs": 1234 }
//
//   GET  -> { "fechaCorte": "2026-08-31", "servicios": ["WMS", ...],
//             "flujos": { "qa": { ... }, ... } }
//
// "ok" es true unicamente si powershell.exe termino con codigo de salida 0.
//
// CODIGOS DE SALIDA DE LOS SCRIPTS
//   Enviar_CorreoBacklog_direccion.ps1 y Enviar_CorreoServicio.ps1 envuelven
//   todo en try/catch: 0 = enviado, 5 = error (configuracion, SQL, Excel o
//   SMTP), con el detalle en su carpeta Logs\.
//   Enviar_CorreoQA.ps1 no atrapa sus errores: se apoya en
//   $ErrorActionPreference = 'Stop', asi que un fallo termina el proceso con
//   codigo 1 y el detalle sale por la salida de error, no por un log.
//   En los tres casos el criterio es el mismo: exito solo con codigo 0.
//
// REQUISITOS DEL ENTORNO (lo que hay que darle a la identidad del App Pool)
//   - Permiso de ESCRITURA en la carpeta de los scripts: los tres crean y
//     limpian Salida\, Logs\ y su carpeta *_temp\ ahi mismo.
//   - Acceso a SQL Server segun el bloque "sql" de config.json: si esta en
//     autenticacion_windows, la conexion va con la cuenta del App Pool.
//   - Las graficas se dibujan con System.Windows.Forms.DataVisualization.
//     Los propios scripts avisan de que el render puede fallar sin escritorio
//     interactivo, que es justo el caso de IIS.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Script.Serialization;

public class AdminCorreos : IHttpHandler
{
    // Estos scripts consultan SQL, generan reportes y abren SMTP: tardan
    // bastante mas que la prueba de concepto. Aun asi hay un limite, para no
    // dejar un request colgado para siempre si el script se queda esperando.
    private const int TiempoLimiteSegundos = 600;

    // Clave unica de Web.config con la carpeta donde estan los tres .ps1.
    // Los tres scripts viven juntos, asi que no hay una clave por flujo: una
    // sola ruta que cambiar al mover el sitio de maquina.
    private const string ClaveDirScripts = "AdminScriptsDir";

    // Configuracion del flujo de servicios. Se usa como plantilla de la copia
    // temporal cuando la consola pide destinatarios personalizados.
    private const string ConfigServicio = "config_correo_servicio.json";

    // Tope de direcciones temporales, para que el campo libre de la pantalla
    // no se convierta en un envio masivo.
    private const int MaxDestinatarios = 10;

    // Definicion fija de un flujo. Ni el nombre del script ni la clave de
    // configuracion salen nunca del request.
    private class Flujo
    {
        public string Id;
        public string Titulo;
        public string Script;      // nombre del .ps1, fijo en el codigo
        public bool   PideServicio;
    }

    private static readonly Flujo[] FLUJOS =
    {
        new Flujo {
            Id = "qa", Titulo = "Correo QA",
            Script = "Enviar_CorreoQA.ps1",
            PideServicio = false
        },
        new Flujo {
            Id = "backlog", Titulo = "Correo Backlog",
            Script = "Enviar_CorreoBacklog_direccion.ps1",
            PideServicio = false
        },
        new Flujo {
            Id = "servicios", Titulo = "Servicios",
            Script = "Enviar_CorreoServicio.ps1",
            PideServicio = true
        },
    };

    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            var metodo = context.Request.HttpMethod;

            if (string.Equals(metodo, "GET", StringComparison.OrdinalIgnoreCase))
                return Metadatos();

            if (!string.Equals(metodo, "POST", StringComparison.OrdinalIgnoreCase))
                throw new HttpException(405, "Este handler solo acepta GET (metadatos) y POST (ejecucion).");

            var flujo = BuscarFlujo(context.Request.Form["flujo"]);
            var script = RutaScript(flujo);

            // Argumentos del script. Para qa y backlog no hay ninguno: cada
            // script se basta con su propia configuracion.
            var argumentos = string.Empty;
            string configTemporal = null;

            if (flujo.PideServicio)
            {
                // Servicio canonico de la lista blanca + fecha del servidor.
                var servicio = ValidarServicio(context.Request.Form["servicio"]);
                argumentos = "-Servicio \"" + servicio + "\" -FechaCorte \"" + FechaCorte() + "\"";

                // Destinatarios temporales: opcionales. Sin ellos, el script
                // usa su distribucion normal (dbo.CatServicioCorreo).
                var personalizados = ValidarDestinatarios(context.Request.Form["destinatarios"]);
                if (personalizados.Count > 0)
                {
                    configTemporal = CrearConfigTemporal(Path.GetDirectoryName(script), personalizados);
                    argumentos += " -RutaCorreo \"" + configTemporal + "\"";
                }
            }

            try
            {
                return Ejecutar(flujo, script, argumentos);
            }
            finally
            {
                // Nunca se deja atras una copia con la configuracion de SMTP.
                if (configTemporal != null)
                {
                    try { File.Delete(configTemporal); } catch { }
                }
            }
        });
    }

    // ---- Metadatos (GET) --------------------------------------------------

    // Lo que la pantalla de revision necesita mostrar ANTES de enviar. La
    // fecha sale del reloj del servidor, el mismo que se le pasara al script:
    // la pagina no la calcula por su cuenta.
    private static Dictionary<string, object> Metadatos()
    {
        var flujos = new Dictionary<string, object>();
        foreach (var f in FLUJOS)
        {
            var carpeta = ConfigurationManager.AppSettings[ClaveDirScripts];
            string ruta = null;
            string problema = null;

            try { ruta = RutaScript(f); }
            catch (Exception ex) { problema = ex.Message; }

            flujos[f.Id] = new Dictionary<string, object>
            {
                { "titulo",       f.Titulo },
                { "script",       f.Script },
                { "carpeta",      carpeta ?? string.Empty },
                { "ruta",         ruta ?? string.Empty },
                { "disponible",   ruta != null },
                { "problema",     problema ?? string.Empty },
                { "pideServicio", f.PideServicio },
            };
        }

        return new Dictionary<string, object>
        {
            { "fechaCorte", FechaCorte() },
            { "servicios",  ServiciosPermitidos() },
            { "flujos",     flujos },
        };
    }

    // ---- Validaciones -----------------------------------------------------

    private static Flujo BuscarFlujo(string id)
    {
        id = (id ?? string.Empty).Trim();
        foreach (var f in FLUJOS)
            if (string.Equals(f.Id, id, StringComparison.OrdinalIgnoreCase))
                return f;

        throw new ArgumentException(
            "Flujo no reconocido. Solo se permiten: qa, backlog, servicios.");
    }

    // Carpeta configurada + nombre fijo del script. Se comprueba que exista
    // antes de lanzar nada, para dar un error claro en vez de un fallo seco
    // de powershell.exe.
    private static string RutaScript(Flujo flujo)
    {
        var carpeta = ConfigurationManager.AppSettings[ClaveDirScripts];
        if (string.IsNullOrWhiteSpace(carpeta))
            throw new ConfigurationErrorsException(
                "Falta la clave <appSettings> \"" + ClaveDirScripts + "\" en Web.config: " +
                "es la carpeta donde viven los tres .ps1 de correo.");

        carpeta = carpeta.Trim();
        if (!Directory.Exists(carpeta))
            throw new DirectoryNotFoundException(
                "La carpeta configurada en \"" + ClaveDirScripts + "\" no existe: " + carpeta);

        var ruta = Path.Combine(carpeta, flujo.Script);
        if (!File.Exists(ruta))
            throw new FileNotFoundException(
                "No se encontro " + flujo.Script + " en la carpeta configurada.", ruta);

        return ruta;
    }

    // Lista blanca de servicios, definida en Web.config separada por comas.
    private static List<string> ServiciosPermitidos()
    {
        var crudo = ConfigurationManager.AppSettings["AdminServiciosPermitidos"] ?? string.Empty;
        var lista = new List<string>();
        foreach (var parte in crudo.Split(','))
        {
            var s = parte.Trim();
            if (s.Length > 0) lista.Add(s);
        }
        return lista;
    }

    // Devuelve SIEMPRE la cadena tal como esta escrita en la configuracion,
    // no la que mando el navegador. Asi, llegue lo que llegue, lo unico que
    // puede acabar en la linea de comandos es un valor de la lista blanca.
    private static string ValidarServicio(string pedido)
    {
        pedido = (pedido ?? string.Empty).Trim();
        if (pedido.Length == 0)
            throw new ArgumentException("Falta el servicio: el flujo \"servicios\" necesita uno.");

        var permitidos = ServiciosPermitidos();
        if (permitidos.Count == 0)
            throw new ConfigurationErrorsException(
                "Falta la clave <appSettings> \"AdminServiciosPermitidos\" en Web.config.");

        foreach (var s in permitidos)
            if (string.Equals(s, pedido, StringComparison.OrdinalIgnoreCase))
                return s;

        throw new ArgumentException(
            "Servicio no permitido: \"" + pedido + "\". Permitidos: " +
            string.Join(", ", permitidos.ToArray()) + ".");
    }

    // Direcciones temporales que llegan del navegador, separadas por ; o por
    // coma. Solo se aceptan direcciones con forma de correo: lo que entra aqui
    // acaba dentro de un JSON, nunca en la linea de comandos.
    private static List<string> ValidarDestinatarios(string crudo)
    {
        var lista = new List<string>();
        crudo = (crudo ?? string.Empty).Trim();
        if (crudo.Length == 0) return lista;

        var separadores = new char[] { ';', ',', '\n', '\r' };
        foreach (var parte in crudo.Split(separadores))
        {
            var dir = parte.Trim();
            if (dir.Length == 0) continue;

            if (!Regex.IsMatch(dir, @"^[^@\s;,<>""]+@[^@\s;,<>""]+\.[^@\s;,<>""]+$"))
                throw new ArgumentException("Destinatario no valido: \"" + dir + "\".");

            if (!lista.Contains(dir)) lista.Add(dir);
        }

        if (lista.Count > MaxDestinatarios)
            throw new ArgumentException(
                "Demasiados destinatarios temporales: maximo " + MaxDestinatarios + ".");

        return lista;
    }

    // Copia de config_correo_servicio.json con la distribucion sustituida por
    // las direcciones temporales. Se apoya en el modo de prueba que el script
    // YA tiene: modo_prueba=true ignora dbo.CatServicioCorreo y manda solo a
    // destinatario_prueba. El resto de las claves (remitente, SMTP, topes) se
    // conservan tal cual y no salen de la carpeta de los scripts.
    private static string CrearConfigTemporal(string carpeta, List<string> destinatarios)
    {
        var plantilla = Path.Combine(carpeta, ConfigServicio);
        if (!File.Exists(plantilla))
            throw new FileNotFoundException(
                "No se encontro " + ConfigServicio + " en la carpeta de los scripts: " +
                "es la plantilla de los destinatarios temporales.", plantilla);

        var serializador = new JavaScriptSerializer();
        var config = serializador.Deserialize<Dictionary<string, object>>(
            File.ReadAllText(plantilla));

        config["modo_prueba"] = true;
        config["destinatario_prueba"] = destinatarios.ToArray();

        var destino = Path.Combine(
            carpeta, "admin_correo_servicio_" + Guid.NewGuid().ToString("N") + ".json");

        // Sin BOM: el script lo lee con -Encoding UTF8, y el serializador ya
        // escapa cualquier caracter no ASCII.
        File.WriteAllText(destino, serializador.Serialize(config), new UTF8Encoding(false));
        return destino;
    }

    // Dia natural anterior al de hoy, segun el reloj local del servidor.
    // Nada codificado a mano y nada que venga del navegador.
    private static string FechaCorte()
    {
        return DateTime.Today.AddDays(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    // ---- Ejecucion --------------------------------------------------------

    private static Dictionary<string, object> Ejecutar(Flujo flujo, string script, string argumentos)
    {
        var carpeta = Path.GetDirectoryName(script);

        // -File con la ruta entre comillas: PowerShell trata todo lo que
        // sigue como argumentos del script, no como comandos.
        var linea = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"";
        if (!string.IsNullOrEmpty(argumentos))
            linea += " " + argumentos;

        var inicio = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = linea,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            // Clave: el script corre desde SU carpeta, asi sus archivos de
            // configuracion y sus rutas relativas siguen resolviendo igual.
            WorkingDirectory = carpeta
        };

        var cronometro = Stopwatch.StartNew();
        string salida, error;
        int codigo;

        using (var proceso = Process.Start(inicio))
        {
            // Se vacian las dos tuberias antes de esperar: con WaitForExit
            // primero, una salida larga llenaria el buffer y bloquearia al
            // proceso hijo. ReadToEnd de las dos ya implica esperar al final.
            salida = proceso.StandardOutput.ReadToEnd();
            error  = proceso.StandardError.ReadToEnd();

            if (!proceso.WaitForExit(TiempoLimiteSegundos * 1000))
            {
                try { proceso.Kill(); } catch { }
                throw new TimeoutException(
                    "El script no termino en " + TiempoLimiteSegundos + " segundos y se cancelo.");
            }

            codigo = proceso.ExitCode;
        }
        cronometro.Stop();

        return new Dictionary<string, object>
        {
            { "ok",           codigo == 0 },
            { "flujo",        flujo.Id },
            { "codigoSalida", codigo },
            { "salida",       (salida ?? string.Empty).Trim() },
            { "error",        (error  ?? string.Empty).Trim() },
            { "script",       script },
            { "carpeta",      carpeta },
            { "argumentos",   argumentos },
            { "duracionMs",   cronometro.ElapsedMilliseconds },
        };
    }

    public bool IsReusable { get { return false; } }
}
