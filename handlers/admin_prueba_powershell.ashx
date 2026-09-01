<%@ WebHandler Language="C#" Class="AdminPruebaPowerShell" %>

// Prueba de concepto de la consola de administracion (admin.html): comprobar
// que la pagina puede lanzar un script de PowerShell a traves de IIS/ASP.NET.
//
// Deliberadamente NO es un ejecutor generico de comandos:
//
//   - La ruta del script esta fija en el codigo (~/tools/test.ps1). No se lee
//     nada del query string ni del cuerpo del request, asi que no hay forma de
//     pedirle que ejecute otro script ni de inyectar argumentos.
//   - Solo acepta POST. Un GET no dispara nada (evita que un enlace o una
//     imagen remota lo ejecuten de rebote).
//   - test.ps1 no manda correo, no abre SMTP y no toca la base de datos.
//
// Responde con el mismo formato JSON del resto de handlers
// (DashboardHandler.Responder, App_Code/DashboardDb.cs):
//
//     { "ok": true|false, "codigoSalida": 0, "salida": "...", "error": "...",
//       "script": "C:\...\tools\test.ps1", "duracionMs": 123 }
//
// "ok" es true solo si powershell.exe termino con codigo de salida 0.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Web;

public class AdminPruebaPowerShell : IHttpHandler
{
    // Segundos que se espera a que termine el proceso antes de matarlo. El
    // script solo escribe una linea en un archivo: si tarda mas que esto es
    // que algo va mal y no conviene dejar el request colgado.
    private const int TiempoLimiteSegundos = 30;

    public void ProcessRequest(HttpContext context)
    {
        DashboardHandler.Responder(context, delegate
        {
            if (!string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                throw new HttpException(405, "Este handler solo acepta POST.");

            // Ruta fija: el unico script que este handler puede ejecutar.
            var script = context.Server.MapPath("~/tools/test.ps1");
            if (!System.IO.File.Exists(script))
                throw new System.IO.FileNotFoundException("No se encontro el script de prueba.", script);

            return Ejecutar(script);
        });
    }

    private static Dictionary<string, object> Ejecutar(string script)
    {
        var inicio = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            // -NoProfile / -NonInteractive: sin perfil de usuario y sin ningun
            // prompt que pueda dejar el proceso esperando para siempre.
            // -ExecutionPolicy Bypass: el script no esta firmado y el App Pool
            // suele heredar la politica restringida de la maquina.
            // -File con la ruta entre comillas: PowerShell trata todo lo que
            // sigue como argumentos del script, no como comandos.
            Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = System.IO.Path.GetDirectoryName(script)
        };

        var cronometro = Stopwatch.StartNew();
        string salida, error;
        int codigo;

        using (var proceso = Process.Start(inicio))
        {
            // Se leen las dos tuberias antes de esperar: con WaitForExit
            // primero, un volcado grande llenaria el buffer y bloquearia el
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
            { "codigoSalida", codigo },
            { "salida",       (salida ?? string.Empty).Trim() },
            { "error",        (error  ?? string.Empty).Trim() },
            { "script",       script },
            { "duracionMs",   cronometro.ElapsedMilliseconds },
        };
    }

    public bool IsReusable { get { return false; } }
}
