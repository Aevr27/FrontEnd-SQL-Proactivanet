```csharp
<%@ WebHandler Language="C#" Class="RQ" %>

using System;
using System.Web;

public class RQ : IHttpHandler
{
    public void ProcessRequest(HttpContext context)
    {
        context.Response.ContentType = "text/plain";

        var identity = context.User != null ? context.User.Identity : null;

        context.Response.Write(
            "=== IIS / Windows Identity Test ===\r\n\r\n" +
            "IsAuthenticated: " +
            (identity != null && identity.IsAuthenticated) +
            "\r\n" +

            "AuthenticationType: " +
            (identity != null ? identity.AuthenticationType : "") +
            "\r\n" +

            "Name: " +
            (identity != null ? identity.Name : "") +
            "\r\n\r\n" +

            "AUTH_USER: " +
            (context.Request.ServerVariables["AUTH_USER"] ?? "") +
            "\r\n" +

            "REMOTE_USER: " +
            (context.Request.ServerVariables["REMOTE_USER"] ?? "") +
            "\r\n" +

            "LOGON_USER: " +
            (context.Request.ServerVariables["LOGON_USER"] ?? "") +
            "\r\n"
        );
    }

    public bool IsReusable
    {
        get { return false; }
    }
}
```
