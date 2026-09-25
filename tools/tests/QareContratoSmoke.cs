// tools/tests/QareContratoSmoke.cs - prueba de humo de la pestaña QARE.
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Tres partes:
//   1) QareContrato, puro: fechas (sin correr dias), orden por Posicion,
//      orden natural de Frecuencia, columnas faltantes y avisos del Pareto.
//   2) QareQueries.Consultar + handlers/qare.ashx de punta a punta contra
//      SQL Server LocalDB, en una base TEMPORAL con procedimientos
//      dbo.usp_CorreoQARE_* de MENTIRA. Los stubs no son el contrato real
//      (ese esta en la VM, ver sql/diag_qare_contrato.sql): devuelven filas
//      desordenadas, con NULL, vacias o con error, y ecoan @FechaInicio /
//      @FechaFin para comprobar que las fechas llegan TAL CUAL a los seis.
//   3) Guardas de regresion: el NBSP de DirectorioOrganizacional escapado y
//      HoyEnPresentacion en UTC-06.
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (Git Bash, ver memoria csc):
//   tail -n +2 handlers/qare.ashx > <scratch>/qare_handler.cs
//   csc /nologo /out:<scratch>/QareSmoke.exe /r:System.dll /r:System.Data.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll
//       'App_Code\*.cs' <scratch>/qare_handler.cs tools\tests\QareContratoSmoke.cs
//   QareSmoke.exe.config junto al exe, con:
//     <connectionStrings><add name="TicketsProactivanet" connectionString=
//       "Server=(localdb)\MSSQLLocalDB;Initial Catalog=QareSmoke;Integrated Security=true"/>
//   QareSmoke.exe <raiz del repo>     # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.IO;
using System.Web;
using System.Web.Script.Serialization;

public static class QareContratoSmoke
{
    static int fallos;

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : esperado.ToString();
        var o = obtenido == null ? "(null)" : obtenido.ToString();
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + "  esperado=" + e + "  obtenido=" + o);
    }

    static Dictionary<string, object> F(params object[] kv)
    {
        var d = new Dictionary<string, object>();
        for (int i = 0; i < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
        return d;
    }

    static string Col(List<Dictionary<string, object>> filas, string col)
    {
        var p = new List<string>();
        foreach (var f in filas) { object v; f.TryGetValue(col, out v); p.Add(v == null ? "null" : v.ToString()); }
        return string.Join(",", p);
    }

    // ------------------------------------------------------------ 1) puro
    static void Puro()
    {
        DateTime i, f;
        var hoy = new DateTime(2026, 9, 25);

        QareContrato.Rango(null, null, hoy, out i, out f);
        Chk("rango por omision: fin = ayer", "2026-09-24", f.ToString("yyyy-MM-dd"));
        Chk("rango por omision: 15 dias", "2026-09-10", i.ToString("yyyy-MM-dd"));

        QareContrato.Rango("2026-08-01", "2026-08-31", hoy, out i, out f);
        Chk("fechas explicitas: inicio sin tocar", "2026-08-01", i.ToString("yyyy-MM-dd"));
        Chk("fechas explicitas: fin sin sumar dia", "2026-08-31", f.ToString("yyyy-MM-dd"));

        QareContrato.Rango("2026-08-05", "2026-08-05", hoy, out i, out f);
        Chk("un solo dia es valido", "2026-08-05|2026-08-05", i.ToString("yyyy-MM-dd") + "|" + f.ToString("yyyy-MM-dd"));

        Chk("inicio > fin -> 400", true, Lanza(() => QareContrato.Rango("2026-09-02", "2026-09-01", hoy, out i, out f)));
        Chk("formato invalido -> 400", true, Lanza(() => QareContrato.Rango("01/09/2026", null, hoy, out i, out f)));
        Chk("inyeccion -> 400", true, Lanza(() => QareContrato.Rango("2026-09-01'; DROP", null, hoy, out i, out f)));
        Chk("rango enorme -> 400", true, Lanza(() => QareContrato.Rango("2000-01-01", "2026-01-01", hoy, out i, out f)));

        // Posicion: estable, numerica (int/decimal/long mezclados), NULL al final.
        var pos = QareContrato.OrdenarPorPosicion(new List<Dictionary<string, object>> {
            F("K", "c", "Posicion", 3), F("K", "sin", "Posicion", null), F("K", "a", "Posicion", 1m),
            F("K", "b1", "Posicion", 2L), F("K", "x", "Otra", 1), F("K", "b2", "Posicion", 2), F("K", "d", "Posicion", 10) });
        Chk("Posicion ASC, estable, sin Posicion al final", "a,b1,b2,c,d,sin,x", Col(pos, "K"));

        var frec = QareContrato.OrdenarFrecuencia(new List<Dictionary<string, object>> {
            F("Frecuencia", "Siempre"), F("Frecuencia", null), F("Frecuencia", "nunca "),
            F("Frecuencia", "Frecuente"), F("Frecuencia", "Otro"), F("Frecuencia", "Ocasional") });
        // "nunca " casa con Nunca sin que se toque su texto.
        Chk("Frecuencia en orden natural; desconocidos detras en su orden",
            "nunca ,Ocasional,Frecuente,Siempre,null,Otro", Col(frec, "Frecuencia"));
        Chk("Frecuencia vacia", "", Col(QareContrato.OrdenarFrecuencia(new List<Dictionary<string, object>>()), "Frecuencia"));

        var avisos = new List<string>();
        QareContrato.Preparar(QareContrato.TipoSolucion, new List<Dictionary<string, object>> {
            F("TipoSolucion", "x", "CantidadTickets", 1, "Posicion", 1) }, avisos);
        Chk("columna faltante avisada", "dbo.usp_CorreoQARE_TipoSolucion no devolvio la columna 'Porcentaje'.",
            avisos.Count == 1 ? avisos[0] : string.Join(" | ", avisos));

        avisos.Clear();
        QareContrato.Preparar(QareContrato.TipoSolucion, new List<Dictionary<string, object>>(), avisos);
        Chk("sin filas no es contrato roto", 0, avisos.Count);

        avisos.Clear();
        var pareto = QareContrato.Preparar(QareContrato.CausaRaiz, new List<Dictionary<string, object>> {
            Causa("B", 30, 30, 80, 2), Causa("C", 20, 20, 100, 3), Causa("A", 50, 50, 50, 1) }, avisos);
        Chk("Pareto por Posicion", "A,B,C", Col(pareto, "CausaRaiz"));
        Chk("Pareto acumulado creciente tras ordenar", "50,80,100", Col(pareto, "PorcentajeAcumulado"));
        Chk("Pareto sano sin avisos", 0, avisos.Count);

        avisos.Clear();
        QareContrato.Preparar(QareContrato.CausaRaiz, new List<Dictionary<string, object>> {
            Causa("A", 5, 50, 90, 1), Causa("B", 5, 50, 60, 2) }, avisos);
        Chk("acumulado que baja se avisa", true, avisos.Count == 1 && avisos[0].Contains("baja"));

        avisos.Clear();
        QareContrato.Preparar(QareContrato.CausaRaiz, new List<Dictionary<string, object>> {
            Causa("A", 5, .5m, .5m, 1), Causa("B", 5, .5m, 1m, 2) }, avisos);
        Chk("escala 0-1 se avisa, no se corrige", true, avisos.Count == 1 && avisos[0].Contains("0-1"));
    }

    static Dictionary<string, object> Causa(string n, int c, decimal p, decimal a, int pos)
    {
        return F("CausaRaiz", n, "CantidadTickets", c, "Porcentaje", p, "PorcentajeAcumulado", a, "Posicion", pos);
    }

    static bool Lanza(Action a)
    {
        try { a(); return false; } catch (QareSolicitudInvalida) { return true; }
    }

    // ------------------------------------------------ 2) LocalDB + handler
    const string Stubs = @"
CREATE PROCEDURE dbo.usp_CorreoQARE_KPIs @FechaInicio DATE, @FechaFin DATE AS
BEGIN
  IF @FechaInicio < '2001-01-01' RAISERROR('falla forzada', 16, 1);
  SELECT TotalTicketsPeriodo = 120, PorcentajeConfirmacion = CAST(62.50 AS DECIMAL(6,2)), TicketsConfirmados = 75,
         PorcentajeRecurrencia = CAST(10.00 AS DECIMAL(6,2)), TicketsRecurrentes = 12,
         PorcentajeCasosReutilizables = CAST(33.33 AS DECIMAL(6,2)), CasosReutilizables = 40,
         PorcentajePotencialKB = CAST(NULL AS DECIMAL(6,2)), CasosPotencialKB = CAST(NULL AS INT),
         EcoInicio = @FechaInicio, EcoFin = @FechaFin;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_Frecuencia @FechaInicio DATE, @FechaFin DATE AS
BEGIN
  IF @FechaInicio < '2001-01-01' RAISERROR('falla forzada', 16, 1);
  SELECT * FROM (VALUES (N'Siempre', 5, 4.2), (NULL, 1, 0.8), (N'Nunca', 50, 41.7), (N'Frecuente', 20, 16.7), (N'Ocasional', 44, 36.6))
    v(Frecuencia, CantidadTickets, Porcentaje) CROSS JOIN (SELECT EcoInicio = @FechaInicio, EcoFin = @FechaFin) e;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_CausaRaiz @FechaInicio DATE, @FechaFin DATE AS
BEGIN
  IF @FechaInicio < '2001-01-01' RAISERROR('falla forzada', 16, 1);
  SELECT * FROM (VALUES (N'Config', 30, 25.0, 83.3, 2), (N'Red', 20, 16.7, 100.0, 3), (N'Software', 70, 58.3, 58.3, 1))
    v(CausaRaiz, CantidadTickets, Porcentaje, PorcentajeAcumulado, Posicion) CROSS JOIN (SELECT EcoInicio = @FechaInicio, EcoFin = @FechaFin) e;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_RecurrentesCategoria @FechaInicio DATE, @FechaFin DATE AS
BEGIN
  IF @FechaInicio < '2001-01-01' RAISERROR('falla forzada', 16, 1);
  SELECT Categoria = N'Cat ' + RIGHT('0' + CAST(n AS VARCHAR(2)), 2), CantidadTickets = 100 - n,
         PorcentajeRecurrentes = CAST(n AS DECIMAL(6,2)), Posicion = CASE WHEN n = 7 THEN NULL ELSE n END,
         EcoInicio = @FechaInicio, EcoFin = @FechaFin
  FROM (SELECT TOP (20) n = ROW_NUMBER() OVER (ORDER BY (SELECT 1)) FROM sys.objects) t
  ORDER BY n DESC;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio DATE, @FechaFin DATE AS
BEGIN
  IF @FechaInicio < '2001-01-01' OR @FechaInicio = '2026-02-01' RAISERROR('falla forzada', 16, 1);
  SELECT * FROM (VALUES (N'Si', N'OK', 60, 50.0), (N'Si', N'Incorrecto', 10, 8.3), (N'No', N'Sin catálogo', 5, 4.2),
                        (N'No', N'OK', NULL, NULL))
    v(ConfirmacionUsuario, ValidacionQA, CantidadTickets, PorcentajeDelTotal) CROSS JOIN (SELECT EcoInicio = @FechaInicio, EcoFin = @FechaFin) e;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_TipoSolucion @FechaInicio DATE, @FechaFin DATE AS
BEGIN
  IF @FechaInicio < '2001-01-01' RAISERROR('falla forzada', 16, 1);
  SELECT TipoSolucion = N'x', CantidadTickets = 1, Porcentaje = 1.0, Posicion = 1,
         EcoInicio = @FechaInicio, EcoFin = @FechaFin
  WHERE 1 = 0;
END;";

    static Dictionary<string, object> Pedir(string query, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("", "http://localhost/handlers/qare.ashx", query),
                                  new HttpResponse(sw));
        new Qare().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        return (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(sw.ToString());
    }

    static List<Dictionary<string, object>> Lista(object o)
    {
        var salida = new List<Dictionary<string, object>>();
        var arr = o as object[];
        if (arr != null) foreach (var x in arr) salida.Add((Dictionary<string, object>)x);
        return salida;
    }

    static void Integracion(string cadenaBase)
    {
        int estado;

        // Rango normal.
        var d = Pedir("fecha_inicio=2026-08-01&fecha_fin=2026-08-31", out estado);
        Chk("200", 200, estado);
        Chk("fechas de la respuesta", "2026-08-01|2026-08-31", d["fechaInicio"] + "|" + d["fechaFin"]);
        Chk("sin errores", 0, ((Dictionary<string, object>)d["errores"]).Count);
        Chk("sin avisos", 0, ((object[])d["avisos"]).Length);

        var kpis = (Dictionary<string, object>)d["kpis"];
        Chk("KPI total", "120", kpis["TotalTicketsPeriodo"]);
        Chk("KPI % confirmacion, escala intacta", true, Convert.ToDecimal(kpis["PorcentajeConfirmacion"]) == 62.5m);
        Chk("KPI nulo sigue nulo", null, kpis["PorcentajePotencialKB"]);

        // Las fechas llegaron TAL CUAL a los seis procedimientos.
        Chk("eco KPIs", "2026-08-01T00:00:00|2026-08-31T00:00:00", kpis["EcoInicio"] + "|" + kpis["EcoFin"]);
        foreach (var clave in new[] { "frecuencia", "causaRaiz", "recurrentesCategoria", "confirmacionVsQa" })
        {
            var filas = Lista(d[clave]);
            Chk("eco " + clave, "2026-08-01T00:00:00|2026-08-31T00:00:00",
                filas.Count == 0 ? "sin filas" : filas[0]["EcoInicio"] + "|" + filas[0]["EcoFin"]);
        }

        Chk("frecuencia natural", "Nunca,Ocasional,Frecuente,Siempre,null", Col(Lista(d["frecuencia"]), "Frecuencia"));
        Chk("pareto por Posicion", "Software,Config,Red", Col(Lista(d["causaRaiz"]), "CausaRaiz"));
        Chk("pareto acumulado", "58.3,83.3,100.0", Col(Lista(d["causaRaiz"]), "PorcentajeAcumulado"));
        var rec = Lista(d["recurrentesCategoria"]);
        Chk("recurrentes: 20 filas (el top lo corta la vista)", 20, rec.Count);
        Chk("recurrentes por Posicion, NULL al final", "1,2,3,4,5,6,8", Col(rec.GetRange(0, 7), "Posicion"));
        Chk("recurrentes: la de Posicion NULL es la ultima", "Cat 07", rec[19]["Categoria"]);
        Chk("matriz: orden del procedimiento y valores intactos", "Si,Si,No,No", Col(Lista(d["confirmacionVsQa"]), "ConfirmacionUsuario"));
        Chk("matriz: acento intacto", "OK,Incorrecto,Sin catálogo,OK", Col(Lista(d["confirmacionVsQa"]), "ValidacionQA"));
        Chk("tipo solucion vacio = lista vacia, no null", "0", d["tipoSolucion"] == null ? "null" : Lista(d["tipoSolucion"]).Count.ToString());

        var info = (Dictionary<string, object>)d["dataInfo"];
        Chk("dataInfo periodo", "2026-08-01|2026-08-31|rango", info["periodoInicio"] + "|" + info["periodoFin"] + "|" + info["tipoPeriodo"]);
        Chk("dataInfo fuente", "QARE", info["fuente"]);

        // Un bloque falla: los demas siguen y el error dice cual.
        d = Pedir("fecha_inicio=2026-02-01&fecha_fin=2026-02-28", out estado);
        Chk("fallo parcial: 200", 200, estado);
        Chk("fallo parcial: bloque en null", null, d["confirmacionVsQa"]);
        var errores = (Dictionary<string, object>)d["errores"];
        Chk("fallo parcial: solo ese bloque", "confirmacionVsQa", string.Join(",", errores.Keys));
        Chk("fallo parcial: mensaje nombra el procedimiento, sin servidor",
            true, ((string)errores["confirmacionVsQa"]).Contains("usp_CorreoQARE_ConfirmacionVsQA")
                  && !((string)errores["confirmacionVsQa"]).ToLowerInvariant().Contains("localdb"));
        Chk("fallo parcial: KPIs siguen", "120", ((Dictionary<string, object>)d["kpis"])["TotalTicketsPeriodo"]);

        // Fallan los seis: 500 con {error, tipo}.
        d = Pedir("fecha_inicio=2000-06-01&fecha_fin=2000-06-30", out estado);
        Chk("fallan los seis: 500", 500, estado);
        Chk("fallan los seis: {error,tipo}", "SqlException", d.ContainsKey("error") ? d["tipo"] : "sin error");
        Chk("fallan los seis: mensaje saneado", false, ((string)d["error"]).ToLowerInvariant().Contains("localdb"));

        // Parametros invalidos: 400 sin tocar la base.
        d = Pedir("fecha_inicio=2026-09-10&fecha_fin=2026-09-01", out estado);
        Chk("rango invertido: 400", 400, estado);
        Chk("rango invertido: tipo", "SolicitudInvalida", d["tipo"]);

        // Sin fechas: ventana de Mexico.
        d = Pedir("", out estado);
        Chk("sin fechas: fin = ayer en Mexico",
            DashboardDataInfo.HoyEnPresentacion().AddDays(-1).ToString("yyyy-MM-dd"), d["fechaFin"]);
    }

    // ------------------------------------------------------ 3) guardas
    static void Guardas(string raiz)
    {
        var texto = File.ReadAllText(Path.Combine(raiz, @"App_Code\DirectorioOrganizacional.cs"));
        Chk("NBSP escapado", true, texto.Contains("private const char NBSP = '\\u00A0';"));
        Chk("sin NBSP literal", false, texto.Contains(" "));

        var esperado = DateTime.UtcNow.AddHours(-6).Date;
        Chk("HoyEnPresentacion = dia UTC-06", esperado.ToString("yyyy-MM-dd"),
            DashboardDataInfo.HoyEnPresentacion().ToString("yyyy-MM-dd"));
    }

    public static int Main(string[] args)
    {
        var raiz = args.Length > 0 ? args[0] : Directory.GetCurrentDirectory();
        const string maestra = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true";

        // La cadena que lee ConnectionStringProvider viene del .exe.config;
        // su Initial Catalog es la base temporal que se crea y se borra aqui.
        if (ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion] == null)
        {
            Console.WriteLine("Falta " + AppDomain.CurrentDomain.SetupInformation.ConfigurationFile +
                              " con la cadena TicketsProactivanet; ver cabecera.");
            return 99;
        }

        Puro();
        Guardas(raiz);

        var cadena = ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion].ConnectionString;
        var bd = new SqlConnectionStringBuilder(cadena).InitialCatalog;
        using (var cn = new SqlConnection(maestra))
        {
            cn.Open();
            new SqlCommand("IF DB_ID('" + bd + "') IS NOT NULL BEGIN ALTER DATABASE [" + bd +
                           "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "]; END; CREATE DATABASE [" + bd + "];", cn).ExecuteNonQuery();
        }
        try
        {
            using (var cn = new SqlConnection(cadena))
            {
                cn.Open();
                foreach (var lote in Stubs.Split(new[] { "\nGO" }, StringSplitOptions.RemoveEmptyEntries))
                    new SqlCommand(lote, cn).ExecuteNonQuery();
            }
            Integracion(cadena);
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
