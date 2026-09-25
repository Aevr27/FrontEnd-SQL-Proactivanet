// tools/tests/QareContratoSmoke.cs - prueba de humo de la pestaña QARE.
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Tres partes:
//   1) QareContrato, puro: fechas (sin correr dias), orden por Posicion,
//      orden natural de Frecuencia, columnas faltantes y avisos del Pareto.
//   2) QareQueries.Consultar + handlers/qare.ashx de punta a punta contra
//      SQL Server LocalDB, en una base TEMPORAL:
//      2A) stubs de casos borde: filas desordenadas, con NULL, vacias o con
//          error, que ecoan @FechaInicio/@FechaFin para comprobar que las
//          fechas llegan TAL CUAL a los seis;
//      2B) replica de la vista y los seis SP tal como los devolvio el diag
//          v2 en la VM: @FechaFin inclusivo, default de 15 dias hasta hoy,
//          literales reales (Primera vez, Valido, Sin catalogo, Sí/No) y
//          EsInconsistencia.
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

        // Default verificado de los SP: @Ff = hoy (Mexico), @Fi = @Ff - 14.
        QareContrato.Rango(null, null, hoy, out i, out f);
        Chk("rango por omision: fin = HOY", "2026-09-25", f.ToString("yyyy-MM-dd"));
        Chk("rango por omision: inicio = hoy - 14 (15 dias)", "2026-09-11", i.ToString("yyyy-MM-dd"));
        QareContrato.Rango(null, "2026-08-31", hoy, out i, out f);
        Chk("solo fecha_fin: 15 dias que terminan en ella", "2026-08-17", i.ToString("yyyy-MM-dd"));

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
        Chk("desconocidos sin rotulo de la guia", "Nunca,Ocasional,Frecuente,Siempre,null,null",
            Col(frec, QareContrato.ColumnaRotuloFrecuencia));

        // Literales REALES de produccion, en el orden en que los manda el SP
        // (CantidadTickets DESC, diag v2): Primera vez va primero, como Nunca.
        var real = QareContrato.OrdenarFrecuencia(new List<Dictionary<string, object>> {
            F("Frecuencia", "Primera vez", "CantidadTickets", 2133),
            F("Frecuencia", "Ocasional", "CantidadTickets", 1193),
            F("Frecuencia", "Siempre", "CantidadTickets", 785),
            F("Frecuencia", "Frecuente", "CantidadTickets", 735) });
        Chk("produccion: orden de la guia", "Primera vez,Ocasional,Frecuente,Siempre", Col(real, "Frecuencia"));
        Chk("produccion: Primera vez conserva su valor y se rotula Nunca",
            "Nunca,Ocasional,Frecuente,Siempre", Col(real, QareContrato.ColumnaRotuloFrecuencia));
        Chk("produccion: no se pierde ninguna fila", 4, real.Count);
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

        // Sin fechas: ventana de Mexico que termina hoy.
        d = Pedir("", out estado);
        Chk("sin fechas: fin = hoy en Mexico",
            DashboardDataInfo.HoyEnPresentacion().ToString("yyyy-MM-dd"), d["fechaFin"]);
    }

    // -------------------------------------- 2B) replica del contrato real
    /* Replica de la vista y los seis SP tal como los devolvio el diag v2 en
       la VM (2026-09-25): mismo filtro inclusivo sobre FechaFirmaSolucion,
       mismo default NULL/NULL con DATEADD(HOUR,-6,SYSUTCDATETIME()), mismos
       CASE de ConfirmacionUsuario / EsInconsistencia y mismo ORDER BY. Solo
       se omiten los comentarios y el formato. La tabla es de mentira. */
    const string Real = @"
DROP PROCEDURE dbo.usp_CorreoQARE_KPIs, dbo.usp_CorreoQARE_Frecuencia, dbo.usp_CorreoQARE_CausaRaiz,
               dbo.usp_CorreoQARE_RecurrentesCategoria, dbo.usp_CorreoQARE_ConfirmacionVsQA, dbo.usp_CorreoQARE_TipoSolucion;
GO
CREATE TABLE dbo.T (CodigoTicket nvarchar(100) NOT NULL, FechaFirmaSolucion datetime2(0) NULL,
    Categoria nvarchar(500) NULL, QA_Frecuencia nvarchar(500) NULL, QARe_Causa nvarchar(max) NULL,
    QARe_VerificoClasificacion nvarchar(255) NULL, QARe_AplicaOtrosCasos nvarchar(255) NULL,
    QARe_GenerarArticulo nvarchar(255) NULL, QARe_TipoSolucion nvarchar(255) NULL, Validacion nvarchar(12) NOT NULL);
GO
CREATE VIEW dbo.vw_CorreoQARECierre_Base AS SELECT * FROM dbo.T;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_KPIs @FechaInicio DATE = NULL, @FechaFin DATE = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));
    SELECT
        TotalTicketsPeriodo = COUNT(DISTINCT CodigoTicket),
        TicketsConFrecuencia = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'') IS NOT NULL THEN CodigoTicket END),
        TicketsRecurrentes = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N'FRECUENTE', N'SIEMPRE') THEN CodigoTicket END),
        PorcentajeRecurrencia = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N'FRECUENTE', N'SIEMPRE') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaConfirmacion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARE_VerificoClasificacion)), N'') IS NOT NULL THEN CodigoTicket END),
        TicketsConfirmados = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARE_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN CodigoTicket END),
        PorcentajeConfirmacion = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARE_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARE_VerificoClasificacion)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaReutilizacion = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_AplicaOtrosCasos)), N'') IS NOT NULL THEN CodigoTicket END),
        CasosReutilizables = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos))) IN (N'SI', N'SÍ') THEN CodigoTicket END),
        PorcentajeCasosReutilizables = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos))) IN (N'SI', N'SÍ') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_AplicaOtrosCasos)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2)),
        TicketsConRespuestaKB = COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_GenerarArticulo)), N'') IS NOT NULL THEN CodigoTicket END),
        CasosPotencialKB = COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_GenerarArticulo))) IN (N'SI', N'SÍ') THEN CodigoTicket END),
        PorcentajePotencialKB = CAST(100.0 * COUNT(DISTINCT CASE WHEN UPPER(LTRIM(RTRIM(QARe_GenerarArticulo))) IN (N'SI', N'SÍ') THEN CodigoTicket END)
            / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(LTRIM(RTRIM(QARe_GenerarArticulo)), N'') IS NOT NULL THEN CodigoTicket END), 0) AS DECIMAL(6,2))
    FROM dbo.vw_CorreoQARECierre_Base
    WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff);
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_Frecuencia @FechaInicio DATE = NULL, @FechaFin DATE = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));
    SELECT Frecuencia = LTRIM(RTRIM(QA_Frecuencia)), CantidadTickets = COUNT(DISTINCT CodigoTicket),
           Porcentaje = CAST(100.0 * COUNT(DISTINCT CodigoTicket) / NULLIF(SUM(COUNT(DISTINCT CodigoTicket)) OVER (), 0) AS DECIMAL(6,2))
    FROM dbo.vw_CorreoQARECierre_Base
    WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
      AND NULLIF(LTRIM(RTRIM(QA_Frecuencia)), N'') IS NOT NULL
    GROUP BY LTRIM(RTRIM(QA_Frecuencia))
    ORDER BY CantidadTickets DESC;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_CausaRaiz @FechaInicio DATE = NULL, @FechaFin DATE = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));
    ;WITH A AS (
        SELECT CausaRaiz = LTRIM(RTRIM(QARe_Causa)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND NULLIF(LTRIM(RTRIM(QARe_Causa)), N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(QARe_Causa))
    ), P AS (
        SELECT CausaRaiz, CantidadTickets, TotalTicketsConCausa = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, CausaRaiz ASC),
               Porcentaje = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
               PorcentajeAcumulado = CAST(100.0 * SUM(CantidadTickets) OVER (ORDER BY CantidadTickets DESC, CausaRaiz ASC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT Posicion, CausaRaiz, CantidadTickets, TotalTicketsConCausa, Porcentaje, PorcentajeAcumulado
    FROM P ORDER BY Posicion;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_RecurrentesCategoria @FechaInicio DATE = NULL, @FechaFin DATE = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));
    ;WITH A AS (
        SELECT Categoria = LTRIM(RTRIM(Categoria)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND UPPER(LTRIM(RTRIM(QA_Frecuencia))) IN (N'FRECUENTE', N'SIEMPRE')
          AND NULLIF(LTRIM(RTRIM(Categoria)), N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(Categoria))
    ), R AS (
        SELECT Categoria, CantidadTickets, TotalTicketsRecurrentes = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, Categoria ASC),
               PorcentajeRecurrentes = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, Posicion, Categoria, CantidadTickets, TotalTicketsRecurrentes, PorcentajeRecurrentes
    FROM R ORDER BY Posicion;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_ConfirmacionVsQA @FechaInicio DATE = NULL, @FechaFin DATE = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));
    ;WITH M AS (
        SELECT ConfirmacionUsuario = CASE
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN N'Sí'
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) = N'NO' THEN N'No'
                   ELSE N'Sin respuesta' END,
               ValidacionQA = ISNULL(NULLIF(LTRIM(RTRIM(Validacion)), N''), N'Sin validación'),
               CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND NULLIF(LTRIM(RTRIM(QARe_VerificoClasificacion)), N'') IS NOT NULL
        GROUP BY CASE
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) IN (N'SI', N'SÍ') THEN N'Sí'
                   WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion))) = N'NO' THEN N'No'
                   ELSE N'Sin respuesta' END,
                 ISNULL(NULLIF(LTRIM(RTRIM(Validacion)), N''), N'Sin validación')
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, ConfirmacionUsuario, ValidacionQA, CantidadTickets,
           PorcentajeDelTotal = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2)),
           EsInconsistencia = CASE WHEN ConfirmacionUsuario = N'Sí' AND ValidacionQA = N'Incorrecto' THEN 1 ELSE 0 END
    FROM M
    ORDER BY CASE ConfirmacionUsuario WHEN N'Sí' THEN 1 WHEN N'No' THEN 2 ELSE 3 END,
             CASE ValidacionQA WHEN N'OK' THEN 1 WHEN N'Valido' THEN 2 WHEN N'Incorrecto' THEN 3 WHEN N'Sin catalogo' THEN 4 ELSE 5 END;
END;
GO
CREATE PROCEDURE dbo.usp_CorreoQARE_TipoSolucion @FechaInicio DATE = NULL, @FechaFin DATE = NULL AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ff DATE = ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
    DECLARE @Fi DATE = ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));
    ;WITH A AS (
        SELECT TipoSolucion = LTRIM(RTRIM(QARe_TipoSolucion)), CantidadTickets = COUNT(DISTINCT CodigoTicket)
        FROM dbo.vw_CorreoQARECierre_Base
        WHERE FechaFirmaSolucion >= @Fi AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)
          AND NULLIF(LTRIM(RTRIM(QARe_TipoSolucion)), N'') IS NOT NULL
        GROUP BY LTRIM(RTRIM(QARe_TipoSolucion))
    ), R AS (
        SELECT TipoSolucion, CantidadTickets, TotalTicketsConTipoSolucion = SUM(CantidadTickets) OVER (),
               Posicion = ROW_NUMBER() OVER (ORDER BY CantidadTickets DESC, TipoSolucion ASC),
               Porcentaje = CAST(100.0 * CantidadTickets / NULLIF(SUM(CantidadTickets) OVER (), 0) AS DECIMAL(6,2))
        FROM A
    )
    SELECT FechaInicio = @Fi, FechaFin = @Ff, Posicion, TipoSolucion, CantidadTickets, TotalTicketsConTipoSolucion, Porcentaje
    FROM R ORDER BY Posicion;
END;";

    /* Datos de la replica. Dia de prueba 2026-08-10:
         - tres tickets DENTRO del dia, en 00:00:00, 12:00 y 23:59:59;
         - uno a las 00:00:00 del dia siguiente y otro a las 23:59:59 del
           anterior, que un rango de un solo dia NO debe contar.
       Frecuencia con los literales de produccion y Siempre como el mas
       numeroso, para que el orden del SP (CantidadTickets DESC) no coincida
       con el de la guia. Validacion con los cuatro literales reales.
       Mas tickets alrededor de HOY en Mexico para comparar el default. */
    const string DatosReales = @"
INSERT dbo.T (CodigoTicket, FechaFirmaSolucion, Categoria, QA_Frecuencia, QARe_Causa, QARe_VerificoClasificacion,
              QARe_AplicaOtrosCasos, QARe_GenerarArticulo, QARe_TipoSolucion, Validacion) VALUES
 (N'D-00', '2026-08-10T00:00:00', N'/S-A/x', N'Siempre',     N'Necesidad', N'SI', N'SI', N'No', N'Permisos', N'OK'),
 (N'D-12', '2026-08-10T12:00:00', N'/S-A/x', N'Siempre',     N'Necesidad', N'Sí', N'No', N'Sí', N'Permisos', N'Incorrecto'),
 (N'D-23', '2026-08-10T23:59:59', N'/S-B/y', N'Primera vez', N'Falla',     N'NO', N'SI', NULL,  N'Reinicio',  N'Incorrecto'),
 (N'D+1',  '2026-08-11T00:00:00', N'/S-B/y', N'Ocasional',   N'Falla',     N'SI', NULL,  NULL,  N'Reinicio',  N'Valido'),
 (N'D-1',  '2026-08-09T23:59:59', N'/S-C/z', N'Frecuente',   N'Falla',     N'NO', NULL,  NULL,  N'Reinicio',  N'Sin catalogo'),
 (N'S-2',  '2026-08-09T10:00:00', N'/S-C/z', N'Siempre',     N'Falla',     N'SI', NULL,  NULL,  NULL,         N'Sin catalogo'),
 (N'S-3',  '2026-08-11T10:00:00', N'/S-C/z', N'Siempre',     NULL,         N'Si', NULL,  NULL,  NULL,         N'Valido'),
 (N'S-4',  '2026-08-11T11:00:00', N'/S-A/x', N'Ocasional',   NULL,         N'NO', NULL,  NULL,  NULL,         N'OK');
DECLARE @HoyMx date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
INSERT dbo.T (CodigoTicket, FechaFirmaSolucion, QA_Frecuencia, QARe_VerificoClasificacion, Validacion) VALUES
 (N'H-0',   DATEADD(MINUTE, 1, CAST(@HoyMx AS datetime2(0))),                    N'Siempre', N'SI', N'OK'),
 (N'H-14',  CAST(DATEADD(DAY, -14, @HoyMx) AS datetime2(0)),                     N'Siempre', N'SI', N'OK'),
 (N'H-15',  DATEADD(SECOND, -1, CAST(DATEADD(DAY, -14, @HoyMx) AS datetime2(0))), N'Siempre', N'SI', N'OK'),
 (N'H+1',   CAST(DATEADD(DAY, 1, @HoyMx) AS datetime2(0)),                       N'Siempre', N'SI', N'OK');";

    static void IntegracionReal(string cadena)
    {
        int estado;
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            foreach (var lote in Real.Split(new[] { "\nGO" }, StringSplitOptions.RemoveEmptyEntries))
                new SqlCommand(lote, cn).ExecuteNonQuery();
            new SqlCommand(DatosReales, cn).ExecuteNonQuery();
        }

        // --- @FechaFin inclusivo: un dia = sus tres tickets, ni uno mas.
        var d = Pedir("fecha_inicio=2026-08-10&fecha_fin=2026-08-10", out estado);
        Chk("real: 200", 200, estado);
        Chk("real: sin errores ni avisos", "0|0",
            ((Dictionary<string, object>)d["errores"]).Count + "|" + ((object[])d["avisos"]).Length);
        var k = (Dictionary<string, object>)d["kpis"];
        Chk("inclusivo: el dia fin entra entero (00:00, 12:00, 23:59:59)", "3", k["TotalTicketsPeriodo"]);
        d = Pedir("fecha_inicio=2026-08-10&fecha_fin=2026-08-11", out estado);
        Chk("inclusivo: dos dias = 3 + 3 (el 00:00 del dia siguiente cae en el suyo)", "6",
            ((Dictionary<string, object>)d["kpis"])["TotalTicketsPeriodo"]);
        d = Pedir("fecha_inicio=2026-08-09&fecha_fin=2026-08-11", out estado);
        k = (Dictionary<string, object>)d["kpis"];
        Chk("inclusivo: tres dias = los 8", "8", k["TotalTicketsPeriodo"]);

        // --- KPIs: denominadores del SP (X de Y), porcentajes 0-100 intactos.
        Chk("KPI confirmados de con respuesta", "5 de 8", k["TicketsConfirmados"] + " de " + k["TicketsConRespuestaConfirmacion"]);
        Chk("KPI reutilizables de con respuesta", "2 de 3", k["CasosReutilizables"] + " de " + k["TicketsConRespuestaReutilizacion"]);
        Chk("KPI KB de con respuesta", "1 de 2", k["CasosPotencialKB"] + " de " + k["TicketsConRespuestaKB"]);
        Chk("KPI recurrentes de con frecuencia", "5 de 8", k["TicketsRecurrentes"] + " de " + k["TicketsConFrecuencia"]);
        Chk("KPI % confirmacion 0-100", true, Convert.ToDecimal(k["PorcentajeConfirmacion"]) == 62.5m);

        // --- Frecuencia: literales de produccion, orden de la guia.
        var frec = Lista(d["frecuencia"]);
        Chk("frecuencia real: orden de la guia (el SP la manda por cantidad)",
            "Primera vez,Ocasional,Frecuente,Siempre", Col(frec, "Frecuencia"));
        Chk("frecuencia real: Primera vez se rotula Nunca, el valor queda intacto",
            "Nunca,Ocasional,Frecuente,Siempre", Col(frec, QareContrato.ColumnaRotuloFrecuencia));

        // --- Matriz: literales exactos y EsInconsistencia solo en Si + Incorrecto.
        var conf = Lista(d["confirmacionVsQa"]);
        Chk("matriz real: ValidacionQA sin acentos y sin reescribir",
            "OK,Valido,Incorrecto,Sin catalogo,OK,Incorrecto,Sin catalogo", Col(conf, "ValidacionQA"));
        Chk("matriz real: ConfirmacionUsuario", "Sí,Sí,Sí,Sí,No,No,No", Col(conf, "ConfirmacionUsuario"));
        var malas = new List<string>();
        foreach (var f in conf)
        {
            bool esperado = (string)f["ConfirmacionUsuario"] == "Sí" && (string)f["ValidacionQA"] == "Incorrecto";
            if (Convert.ToInt32(f["EsInconsistencia"]) != (esperado ? 1 : 0))
                malas.Add(f["ConfirmacionUsuario"] + "/" + f["ValidacionQA"]);
        }
        Chk("EsInconsistencia = 1 solo en Sí + Incorrecto", "", string.Join(",", malas));
        Chk("EsInconsistencia: hay exactamente un par marcado", "1",
            conf.FindAll(f => Convert.ToInt32(f["EsInconsistencia"]) == 1).Count.ToString());

        // --- Default: el handler sin fechas cuenta lo mismo que el SP con NULL/NULL.
        d = Pedir("", out estado);
        var hoy = DashboardDataInfo.HoyEnPresentacion();
        Chk("default: termina HOY en Mexico", hoy.ToString("yyyy-MM-dd"), d["fechaFin"]);
        Chk("default: empieza hoy - 14", hoy.AddDays(-14).ToString("yyyy-MM-dd"), d["fechaInicio"]);
        int delSp;
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = NULL, @FechaFin = NULL;", cn))
        {
            cn.Open();
            using (var rd = cmd.ExecuteReader()) { rd.Read(); delSp = rd.GetInt32(0); }
        }
        Chk("default: el handler = el SP con NULL/NULL (hoy y hoy-14 dentro; hoy-15 y mañana fuera)",
            "2|2", ((Dictionary<string, object>)d["kpis"])["TotalTicketsPeriodo"] + "|" + delSp);
    }

    // ------------------------------------------------------ 3) guardas
    static void Guardas(string raiz)
    {
        var texto = File.ReadAllText(Path.Combine(raiz, @"App_Code\DirectorioOrganizacional.cs"));
        Chk("NBSP escapado", true, texto.Contains("private const char NBSP = '\\u00A0';"));
        Chk("sin NBSP literal", false, texto.Contains("\u00A0"));

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
            IntegracionReal(cadena);
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
