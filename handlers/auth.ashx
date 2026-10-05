<%@ WebHandler Language="C#" Class="AuthCartel" %>

// Cartel fijo. Antes era un diagnostico de identidad IIS que no compilaba
// (empezaba con "csharp"); ya no expone nada de la identidad.
// Guardado con BOM UTF-8: el literal lleva caracteres no ASCII.

using System.Web;

public class AuthCartel : IHttpHandler
{
    private const string Cartel = @"┌──────────────────────────────────────────┐
│        🔐 AUTHORIZED PERSONNEL ONLY      │
│                                          │
│              ACCESS DENIED               │
│                                          │
│        You weren't supposed to be        │
│              here, bro.                  │
│                                          │
│              🗿                         │
│                                          │
│  This endpoint is for authentication.   │
│  It is not a secret admin panel.        │
│                                          │
│  Please return to the dashboard and     │
│  pretend you never saw this.            │
│                                          │
│  Error: curiosity detected              │
└──────────────────────────────────────────┘";

    public void ProcessRequest(HttpContext context)
    {
        context.Response.StatusCode = 403;
        context.Response.TrySkipIisCustomErrors = true;
        context.Response.ContentType = "text/plain; charset=utf-8";
        context.Response.Write(Cartel);
    }

    public bool IsReusable { get { return true; } }
}
