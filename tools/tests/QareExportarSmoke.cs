// tools/tests/QareExportarSmoke.cs - prueba de humo del export "⬇ Descargar QARE"
// (handlers/qare_exportar.ashx -> App_Code/QareExportar.cs).
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Que prueba:
//   A) La consulta, sin base: sale de dbo.tvf_CorreoQARE_Base con los cinco
//      parametros, no repite el mapeo Grupo -> Lider ni el C1, y es solo
//      lectura.
//   B) El handler de punta a punta contra SQL Server LocalDB, en una base
//      TEMPORAL, con la funcion y usp_CorreoQARE_KPIs REALES: sus cuerpos se
//      leen de sql/16_qare_filtros_org.sql (las cadenas @ddl_tvf y
//      @ddl_usp_CorreoQARE_KPIs) y se crean tal cual, sobre una replica de la
//      vista, dbo.vw_Tickets y las funciones del Backlog. Para cada filtro
//      (ninguno, Lider, 'Sin Torre', Grupo, C1, cruce, lista, valor
//      inexistente, rango de un dia, default sin fechas) los tickets del
//      export son EXACTAMENTE los que cuenta el KPI del tablero.
//   C) Contrato de la respuesta, 400/405 y que un filtro con comillas no
//      entra como SQL.
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (Git Bash, ver memoria csc):
//   tail -n +2 handlers/qare_exportar.ashx > <scratch>/qare_exportar_handler.cs
//   csc /nologo /out:<scratch>/QareExportarSmoke.exe /r:System.dll /r:System.Data.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll
//       'App_Code\*.cs' <scratch>/qare_exportar_handler.cs tools\tests\QareExportarSmoke.cs
//   QareExportarSmoke.exe.config junto al exe, con:
//     <connectionStrings><add name="TicketsProactivanet" connectionString=
//       "Server=(localdb)\MSSQLLocalDB;Initial Catalog=QareExportarSmoke;Integrated Security=true"/>
//   QareExportarSmoke.exe <raiz del repo>     # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.IO;
using System.Text;
using System.Web;
using System.Web.Script.Serialization;

public static class QareExportarSmoke
{
    static int fallos;
    static string cadena;

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : esperado.ToString();
        var o = obtenido == null ? "(null)" : obtenido.ToString();
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + "  esperado=" + e + "  obtenido=" + o);
    }

    // --------------------------------------------------------- A) consulta
    static void Consulta()
    {
        var sql = QareExportar.CONSULTA;
        Chk("fuente: la TVF de los seis SP con sus cinco parametros", true,
            sql.Contains("FROM dbo.tvf_CorreoQARE_Base(@FechaInicio, @FechaFin, @C1, @Grupos, @Lideres) AS q"));
        Chk("no lee la vista QARE por su cuenta", false, sql.Contains("vw_CorreoQARECierre_Base"));
        Chk("no repite el mapeo Grupo -> Lider ni el C1", false,
            sql.Contains("CatLiderGrupo") || sql.Contains("fn_CorreoBacklog") || sql.Contains("Sin Torre"));
        Chk("Lider y C1 salen de la TVF", true, sql.Contains("q.Lider") && sql.Contains("q.C1"));
        Chk("vw_Tickets por LEFT JOIN (no pierde tickets)", true,
            sql.Contains("LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket"));
        var mayus = sql.ToUpperInvariant();
        Chk("solo lectura", false, mayus.Contains("INSERT") || mayus.Contains("UPDATE ") ||
            mayus.Contains("DELETE") || mayus.Contains("EXEC") || mayus.Contains("INTO "));
        Chk("sin TOP", false, mayus.Contains("TOP"));
        Chk("24 columnas en el SELECT = 24 llaves", QareExportar.Columnas.Length,
            sql.Substring(0, sql.IndexOf("FROM ", StringComparison.Ordinal)).Split(',').Length);
    }

    // ------------------------------------------------------- B) replica
    /* Vista QARE (mismas columnas que la replica de QareContratoSmoke, con
       Grupo), dbo.vw_Tickets y lo del Backlog con los cuerpos que leyo
       sql/diag_qare_filtros_precheck.sql en la VM. Grupos: Service Desk ->
       Jesus Campa, Soporte Campo -> Laura Cardenas, Grupo Nuevo sin fila en
       CatLiderGrupo (-> 'Sin Torre'). */
    const string Base = @"
CREATE TABLE dbo.T (CodigoTicket nvarchar(100) NOT NULL, FechaFirmaSolucion datetime2(0) NULL,
    Categoria nvarchar(500) NULL, Grupo nvarchar(200) NULL, QA_Frecuencia nvarchar(500) NULL, QARe_Causa nvarchar(max) NULL,
    QARe_VerificoClasificacion nvarchar(255) NULL, QARe_AplicaOtrosCasos nvarchar(255) NULL,
    QARe_GenerarArticulo nvarchar(255) NULL, QARe_TipoSolucion nvarchar(255) NULL, Validacion nvarchar(12) NOT NULL);
GO
CREATE VIEW dbo.vw_CorreoQARECierre_Base AS SELECT * FROM dbo.T;
GO
CREATE TABLE dbo.TK (CodigoTicket nvarchar(100) NOT NULL PRIMARY KEY, Titulo nvarchar(500) NULL,
    Descripcion nvarchar(max) NULL, SolucionUsuario nvarchar(max) NULL, TecnicoSegundaLinea nvarchar(200) NULL,
    Subestado nvarchar(100) NULL, Prioridad nvarchar(50) NULL, Cliente nvarchar(200) NULL, Sucursal nvarchar(200) NULL,
    FechaFirmaCierre datetime2(0) NULL, Tipo nvarchar(50) NULL, RegistradoPor nvarchar(200) NULL);
GO
CREATE VIEW dbo.vw_Tickets AS SELECT * FROM dbo.TK;
GO
CREATE TABLE dbo.CatLiderGrupo (Grupo nvarchar(200) NOT NULL PRIMARY KEY, Lider nvarchar(200) NULL);
INSERT dbo.CatLiderGrupo VALUES (N'Service Desk', N'Jesus Campa'), (N'Soporte Campo', N'Laura Cardenas');
GO
CREATE FUNCTION dbo.fn_CorreoBacklog_CategoriaC1 (@Categoria NVARCHAR(1000))
RETURNS NVARCHAR(255)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(1000) = LTRIM(RTRIM(REPLACE(ISNULL(@Categoria, N''), NCHAR(160), N' ')));
    DECLARE @inicio INT, @siguiente INT;
    IF @s = N'' RETURN NULL;
    SET @inicio = CASE WHEN LEFT(@s, 1) = N'/' THEN 2 ELSE 1 END;
    SET @siguiente = CHARINDEX(N'/', @s, @inicio);
    IF @siguiente = 0 RETURN NULLIF(LTRIM(RTRIM(SUBSTRING(@s, @inicio, 1000))), N'');
    RETURN NULLIF(LTRIM(RTRIM(SUBSTRING(@s, @inicio, @siguiente - @inicio))), N'');
END;
GO
CREATE FUNCTION dbo.fn_CorreoBacklog_SplitList (@Lista NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN
(
    SELECT Valor = LTRIM(RTRIM(value))
    FROM STRING_SPLIT(ISNULL(@Lista, N''), N',')
    WHERE LTRIM(RTRIM(value)) <> N''
);";

    /* Dia de prueba 2026-08-10 con sus bordes (00:00, 12:00, 23:59:59), uno
       en el dia siguiente y otro en el anterior; X-0 sin fila en vw_Tickets;
       H-* alrededor de HOY en Mexico para el default sin fechas. */
    const string Datos = @"
INSERT dbo.T (CodigoTicket, FechaFirmaSolucion, Categoria, Grupo, QA_Frecuencia, QARe_Causa, QARe_VerificoClasificacion,
              QARe_AplicaOtrosCasos, QARe_GenerarArticulo, QARe_TipoSolucion, Validacion) VALUES
 (N'D-00', '2026-08-10T00:00:00', N'/S-A/x', N'Service Desk',  N'Siempre',     N'Necesidad', N'SI', N'SI', N'No', N'Permisos', N'OK'),
 (N'D-12', '2026-08-10T12:00:00', N'/S-A/x', N'Service Desk',  N'Siempre',     N'Necesidad', N'Sí', N'No', N'Sí', N'Permisos', N'Incorrecto'),
 (N'D-23', '2026-08-10T23:59:59', N'/S-B/y', N'Soporte Campo', N'Primera vez', N'Falla',     N'NO', N'SI', NULL,  N'Reinicio',  N'Incorrecto'),
 (N'D+1',  '2026-08-11T00:00:00', N'/S-B/y', N'Soporte Campo', N'Ocasional',   N'Falla',     N'SI', NULL,  NULL,  N'Reinicio',  N'Valido'),
 (N'D-1',  '2026-08-09T23:59:59', N'/S-C/z', N'Grupo Nuevo',   N'Frecuente',   N'Falla',     N'NO', NULL,  NULL,  N'Reinicio',  N'Sin catalogo'),
 (N'S-2',  '2026-08-09T10:00:00', N'/S-C/z', N'Grupo Nuevo',   N'Siempre',     N'Falla',     N'SI', NULL,  NULL,  NULL,         N'Sin catalogo'),
 (N'S-3',  '2026-08-11T10:00:00', N'/S-C/z', N'Service Desk',  N'Siempre',     NULL,         N'Si', NULL,  NULL,  NULL,         N'Valido'),
 (N'X-0',  '2026-08-11T11:00:00', NULL,      N'Service Desk',  N'Ocasional',   NULL,         N'NO', NULL,  NULL,  NULL,         N'OK');
DECLARE @HoyMx date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
INSERT dbo.T (CodigoTicket, FechaFirmaSolucion, Grupo, QA_Frecuencia, QARe_VerificoClasificacion, Validacion) VALUES
 (N'H-0',  DATEADD(MINUTE, 1, CAST(@HoyMx AS datetime2(0))),                     N'Service Desk', N'Siempre', N'SI', N'OK'),
 (N'H-14', CAST(DATEADD(DAY, -14, @HoyMx) AS datetime2(0)),                      N'Service Desk', N'Siempre', N'SI', N'OK'),
 (N'H-15', DATEADD(SECOND, -1, CAST(DATEADD(DAY, -14, @HoyMx) AS datetime2(0))), N'Service Desk', N'Siempre', N'SI', N'OK'),
 (N'H+1',  CAST(DATEADD(DAY, 1, @HoyMx) AS datetime2(0)),                        N'Service Desk', N'Siempre', N'SI', N'OK');
INSERT dbo.TK (CodigoTicket, Titulo, Descripcion, SolucionUsuario, TecnicoSegundaLinea, Subestado, Prioridad,
               Cliente, Sucursal, FechaFirmaCierre, Tipo, RegistradoPor)
SELECT CodigoTicket, N'Titulo ' + CodigoTicket, N'Desc ' + CodigoTicket, N'Sol ' + CodigoTicket, N'Tec', N'Cerrado',
       N'Media', N'Cliente', N'Sucursal', '2026-08-12T08:30:00', N'Incidencia', N'Registro'
FROM dbo.T WHERE CodigoTicket <> N'X-0';
INSERT dbo.TK (CodigoTicket, Titulo) VALUES (N'NO-QARE', N'fuera de QARE');";

    /* Una cadena N'...' de T-SQL del script, sin comillas y con '' -> '.
       Se recorre a mano: el cuerpo trae '' por todos lados. */
    static string Cadena(string script, string variable)
    {
        var marca = "DECLARE " + variable + " nvarchar(max) = N'";
        int i = script.IndexOf(marca, StringComparison.Ordinal);
        if (i < 0) throw new Exception("No esta " + variable + " en sql/16_qare_filtros_org.sql");
        i += marca.Length;
        var sb = new StringBuilder();
        while (true)
        {
            char c = script[i];
            if (c == '\'')
            {
                if (i + 1 < script.Length && script[i + 1] == '\'') { sb.Append('\''); i += 2; continue; }
                return sb.ToString();
            }
            sb.Append(c);
            i++;
        }
    }

    static void Preparar(string raiz)
    {
        var script = File.ReadAllText(Path.Combine(raiz, @"sql\16_qare_filtros_org.sql"));
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            foreach (var lote in Base.Split(new[] { "\nGO" }, StringSplitOptions.RemoveEmptyEntries))
                new SqlCommand(lote, cn).ExecuteNonQuery();
            new SqlCommand(Datos, cn).ExecuteNonQuery();
            new SqlCommand(Cadena(script, "@ddl_tvf"), cn).ExecuteNonQuery();
            new SqlCommand(Cadena(script, "@ddl_usp_CorreoQARE_KPIs"), cn).ExecuteNonQuery();
        }
    }

    static Dictionary<string, object> Pedir(string query, out int estado, string metodo = "GET")
    {
        var sw = new StringWriter();
        var req = new HttpRequest("", "http://localhost/handlers/qare_exportar.ashx", query);
        if (metodo != "GET")
            typeof(HttpRequest).GetField("_httpMethod", System.Reflection.BindingFlags.NonPublic |
                System.Reflection.BindingFlags.Instance).SetValue(req, metodo);
        var ctx = new HttpContext(req, new HttpResponse(sw));
        new QareExportarHandler().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        return (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(sw.ToString());
    }

    static List<Dictionary<string, object>> Tickets(Dictionary<string, object> d)
    {
        var salida = new List<Dictionary<string, object>>();
        var arr = d["tickets"] as object[];
        if (arr != null) foreach (var x in arr) salida.Add((Dictionary<string, object>)x);
        return salida;
    }

    static string Codigos(List<Dictionary<string, object>> t)
    {
        var c = new List<string>();
        foreach (var f in t) c.Add((string)f["codigo"]);
        c.Sort(StringComparer.Ordinal);
        return string.Join(",", c);
    }

    static string Nulo(string v) { return v == null ? "NULL" : "N'" + v.Replace("'", "''") + "'"; }

    // TotalTicketsPeriodo del SP REAL con los mismos argumentos.
    static int Kpi(string fi, string ff, string c1, string grupos, string lideres)
    {
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = " + Nulo(fi) +
            ", @FechaFin = " + Nulo(ff) + ", @C1 = " + Nulo(c1) + ", @Grupos = " + Nulo(grupos) +
            ", @Lideres = " + Nulo(lideres) + ";", cn))
        {
            cn.Open();
            using (var rd = cmd.ExecuteReader()) { rd.Read(); return rd.GetInt32(0); }
        }
    }

    /* Un caso de filtros: el export = los codigos esperados, total coherente
       y MISMO numero de tickets que el KPI del tablero. */
    static void Caso(string nombre, string fi, string ff, string c1, string grupos, string lideres, string esperados)
    {
        var qs = new List<string>();
        if (fi != null) qs.Add("fecha_inicio=" + fi);
        if (ff != null) qs.Add("fecha_fin=" + ff);
        if (c1 != null) qs.Add("c1=" + HttpUtility.UrlEncode(c1));
        if (grupos != null) qs.Add("grupos=" + HttpUtility.UrlEncode(grupos));
        if (lideres != null) qs.Add("lideres=" + HttpUtility.UrlEncode(lideres));
        int estado;
        var d = Pedir(string.Join("&", qs), out estado);
        var t = Tickets(d);
        Chk(nombre + ": 200", 200, estado);
        Chk(nombre + ": tickets", esperados, Codigos(t));
        Chk(nombre + ": total = filas", t.Count.ToString(), d["total"].ToString());
        Chk(nombre + ": = KPI TotalTicketsPeriodo del SP real", Kpi(fi, ff, c1, grupos, lideres), t.Count);
    }

    static void Integracion()
    {
        const string fi = "2026-08-09", ff = "2026-08-11";

        Caso("sin filtros", fi, ff, null, null, null, "D+1,D-00,D-1,D-12,D-23,S-2,S-3,X-0");
        Caso("filtros vacios = sin filtro", fi, ff, "", " ", "", "D+1,D-00,D-1,D-12,D-23,S-2,S-3,X-0");
        Caso("lider", fi, ff, null, null, "Jesus Campa", "D-00,D-12,S-3,X-0");
        Caso("lider 'Sin Torre' (grupo sin fila en CatLiderGrupo)", fi, ff, null, null, "Sin Torre", "D-1,S-2");
        Caso("grupo", fi, ff, null, "Soporte Campo", null, "D+1,D-23");
        Caso("C1 = fn_CorreoBacklog_CategoriaC1", fi, ff, "S-A", null, null, "D-00,D-12");
        Caso("C1 'Sin categoria'", fi, ff, "Sin categoria", null, null, "X-0");
        Caso("C1 + lider = cruce", fi, ff, "S-C", null, "Jesus Campa", "S-3");
        Caso("grupo + lider incompatibles = vacio", fi, ff, null, "Soporte Campo", "Jesus Campa", "");
        Caso("lista de dos lideres = la suma", fi, ff, null, null, "Jesus Campa, Laura Cardenas",
             "D+1,D-00,D-12,D-23,S-3,X-0");
        Caso("lider inexistente", fi, ff, null, null, "Nadie", "");
        Caso("un dia: el fin entra entero", "2026-08-10", "2026-08-10", null, null, null, "D-00,D-12,D-23");
        Caso("un dia + lider", "2026-08-10", "2026-08-10", null, null, "Jesus Campa", "D-00,D-12");

        // Default sin fechas: los 15 dias hasta hoy (Mexico), como el SP con NULL/NULL.
        int estado;
        var d = Pedir("", out estado);
        var hoy = DashboardDataInfo.HoyEnPresentacion();
        Chk("default: fechas", hoy.AddDays(-14).ToString("yyyy-MM-dd") + "|" + hoy.ToString("yyyy-MM-dd"),
            d["fechaInicio"] + "|" + d["fechaFin"]);
        Chk("default: tickets (hoy y hoy-14 dentro; hoy-15 y mañana fuera)", "H-0,H-14", Codigos(Tickets(d)));
        Chk("default: = SP con NULL/NULL", Kpi(null, null, null, null, null), Tickets(d).Count);

        // --- contrato de un ticket
        d = Pedir("fecha_inicio=2026-08-10&fecha_fin=2026-08-10&lideres=Jesus%20Campa", out estado);
        var t = Tickets(d);
        Chk("respuesta: llaves", "fechaInicio,fechaFin,total,tickets", string.Join(",", d.Keys));
        Chk("respuesta: rango confirmado", "2026-08-10|2026-08-10", d["fechaInicio"] + "|" + d["fechaFin"]);
        Chk("ticket: llaves = QareExportar.Columnas, en orden", string.Join(",", QareExportar.Columnas),
            string.Join(",", t[0].Keys));
        Chk("orden: FechaFirmaSolucion DESC", "D-12,D-00", t[0]["codigo"] + "," + t[1]["codigo"]);
        var a = t[0];
        Chk("ticket: fecha con hora", "2026-08-10 12:00:00", a["fecha_firma_solucion"]);
        Chk("ticket: Lider / C1 / Grupo de la TVF", "Jesus Campa|S-A|Service Desk", a["lider"] + "|" + a["c1"] + "|" + a["grupo"]);
        Chk("ticket: respuestas QA/QARE tal cual", "Siempre|Necesidad|Sí|No|Sí|Permisos|Incorrecto",
            a["frecuencia"] + "|" + a["causa"] + "|" + a["verifico_clasificacion"] + "|" + a["aplica_otros_casos"] + "|" +
            a["generar_articulo"] + "|" + a["tipo_solucion"] + "|" + a["validacion"]);
        Chk("ticket: datos de vw_Tickets", "Titulo D-12|Desc D-12|Sol D-12|2026-08-12 08:30:00|Incidencia",
            a["titulo"] + "|" + a["descripcion"] + "|" + a["solucion"] + "|" + a["fecha_firma_cierre"] + "|" + a["tipo_origen"]);
        Chk("ticket: categoria cruda de la vista", "/S-A/x", a["categoria"]);

        d = Pedir("fecha_inicio=2026-08-11&fecha_fin=2026-08-11&c1=Sin%20categoria", out estado);
        t = Tickets(d);
        Chk("sin fila en vw_Tickets: sale igual, sin titulo", "X-0|(null)",
            (t.Count == 1 ? t[0]["codigo"] + "|" + (t[0]["titulo"] ?? "(null)") : "n=" + t.Count));
        d = Pedir("fecha_inicio=2026-08-01&fecha_fin=2026-08-31", out estado);
        Chk("un ticket de vw_Tickets fuera de QARE no aparece", false, Codigos(Tickets(d)).Contains("NO-QARE"));

        // --- errores
        d = Pedir("fecha_inicio=2026-09-10&fecha_fin=2026-09-01", out estado);
        Chk("rango invertido: 400", "400|SolicitudInvalida", estado + "|" + d["tipo"]);
        d = Pedir("fecha_inicio=01/09/2026", out estado);
        Chk("fecha mal formada: 400", 400, estado);
        d = Pedir("", out estado, "POST");
        Chk("POST: 405", "405|MetodoNoPermitido", estado + "|" + d["tipo"]);

        // --- un filtro con comillas viaja como valor, no como SQL
        d = Pedir(rangoQs(fi, ff) + "&c1=" + HttpUtility.UrlEncode("S-A'); DROP TABLE dbo.T;--"), out estado);
        Chk("inyeccion: 200 y ningun ticket", "200|0", estado + "|" + Tickets(d).Count);
        d = Pedir(rangoQs(fi, ff), out estado);
        Chk("inyeccion: la tabla sigue ahi", 8, Tickets(d).Count);
    }

    static string rangoQs(string fi, string ff) { return "fecha_inicio=" + fi + "&fecha_fin=" + ff; }

    public static int Main(string[] args)
    {
        var raiz = args.Length > 0 ? args[0] : Directory.GetCurrentDirectory();
        const string maestra = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true";

        if (ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion] == null)
        {
            Console.WriteLine("Falta " + AppDomain.CurrentDomain.SetupInformation.ConfigurationFile +
                              " con la cadena TicketsProactivanet; ver cabecera.");
            return 99;
        }

        Consulta();

        cadena = ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion].ConnectionString;
        var bd = new SqlConnectionStringBuilder(cadena).InitialCatalog;
        using (var cn = new SqlConnection(maestra))
        {
            cn.Open();
            new SqlCommand("IF DB_ID('" + bd + "') IS NOT NULL BEGIN ALTER DATABASE [" + bd +
                           "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "]; END; CREATE DATABASE [" + bd + "];", cn).ExecuteNonQuery();
        }
        try
        {
            Preparar(raiz);
            Integracion();
        }
        finally
        {
            SqlConnection.ClearAllPools();
            using (var cn = new SqlConnection(maestra))
            {
                cn.Open();
                new SqlCommand("ALTER DATABASE [" + bd + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "];", cn).ExecuteNonQuery();
            }
        }

        Console.WriteLine(fallos == 0 ? "TODO OK" : (fallos + " FALLOS"));
        return fallos;
    }
}
