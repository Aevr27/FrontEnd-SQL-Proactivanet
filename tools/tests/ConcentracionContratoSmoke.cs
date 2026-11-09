// tools/tests/ConcentracionContratoSmoke.cs - prueba de humo de la pestaña
// "Concentracion de tickets" (backend de aplicacion).
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Tres partes:
//   1) ConcentracionContrato, puro: lectura del ?slot=, "hoy" de la vista
//      (UTC-6), Slot -> fechas contra los rangos REALES que dio QA el
//      2026-11-09 (diag 2, A3), y Preparar (orden por Posicion, avisos, sin
//      tocar la lista original).
//   2) ConcentracionQueries + handlers/concentracion.ashx de punta a punta
//      contra SQL Server LocalDB, en una base TEMPORAL, con los scripts
//      REALES del repositorio:
//        - sql/81_concentracion_tickets.sql (los tres SP tal como estan en QA)
//          sobre una tabla con la forma de dbo.vw_ServicioTickets;
//        - el mismo @Slot llega a los tres; cada grafica trae SU total;
//          slot sin tickets = []; slot invalido = 400;
//        - cache por slot (5 min) y su limpieza;
//        - cobertura del Slot (dias con tickets; el 0 sin contar hoy) y que
//          su fallo no tumba ninguna grafica;
//        - sql/82_pareto_por_servicio.sql (la propuesta): PU y WMS en una
//          barra cada uno, mismos conteos y mismo total; y su rollback;
//        - un SP que falta: solo esa grafica sale con error (200); los tres:
//          500.
//   3) Guarda: la pestaña no llama a nada de Analisis de servicios.
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (Git Bash; opciones con "-" para
// que MSYS no las convierta en rutas):
//   tail -n +2 handlers/concentracion.ashx > <scratch>/conc_handler.cs
//   csc -nologo -out:<scratch>/ConcSmoke.exe -r:System.dll -r:System.Data.dll
//       -r:System.Web.dll -r:System.Web.Extensions.dll -r:System.Configuration.dll
//       'App_Code\*.cs' <scratch>/conc_handler.cs tools\tests\ConcentracionContratoSmoke.cs
//   ConcSmoke.exe.config junto al exe, con:
//     <connectionStrings><add name="TicketsProactivanet" connectionString=
//       "Server=(localdb)\MSSQLLocalDB;Initial Catalog=ConcentracionSmoke;Integrated Security=true"/>
//   ConcSmoke.exe <raiz del repo>     # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Web;
using System.Web.Script.Serialization;

public static class ConcentracionContratoSmoke
{
    static int fallos;

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : esperado.ToString();
        var o = obtenido == null ? "(null)" : obtenido.ToString();
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
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
        foreach (var f in filas)
        {
            object v; f.TryGetValue(col, out v);
            p.Add(v == null ? "null" : Convert.ToString(v, CultureInfo.InvariantCulture));
        }
        return string.Join(",", p);
    }

    static string Dia(DateTime d) { return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }

    // ------------------------------------------------------------ 1) puro
    static void Puro()
    {
        Chk("slot: ausente = 0", 0, ConcentracionContrato.LeerSlot(null));
        Chk("slot: vacio = 0", 0, ConcentracionContrato.LeerSlot("  "));
        Chk("slot: 12", 12, ConcentracionContrato.LeerSlot("12"));
        Chk("slot: con espacios", 3, ConcentracionContrato.LeerSlot(" 3 "));
        foreach (var malo in new[] { "13", "-1", "abc", "1.5", "+2", "999999999999" })
        {
            string r;
            try { ConcentracionContrato.LeerSlot(malo); r = "acepto"; }
            catch (ConcentracionSolicitudInvalida) { r = "400"; }
            Chk("slot invalido '" + malo + "'", "400", r);
        }

        // Hoy de la vista = DATEADD(HOUR, -6, SYSUTCDATETIME()).
        Chk("hoy: 16:33 UTC", "2026-11-09", Dia(ConcentracionContrato.HoyMexico(new DateTime(2026, 11, 9, 16, 33, 59, DateTimeKind.Utc))));
        Chk("hoy: 05:59 UTC del dia siguiente sigue siendo hoy", "2026-11-09",
            Dia(ConcentracionContrato.HoyMexico(new DateTime(2026, 11, 10, 5, 59, 59, DateTimeKind.Utc))));
        Chk("hoy: 06:00 UTC ya es mañana", "2026-11-10",
            Dia(ConcentracionContrato.HoyMexico(new DateTime(2026, 11, 10, 6, 0, 0, DateTimeKind.Utc))));

        /* Slot -> fechas contra lo que REALMENTE devolvio QA el 2026-11-09
           (diag 2, A3: primer y ultimo registro de cada Slot). Los slots 0..10
           tienen 30 dias de datos: sus bordes son exactos. El 11 y el 12 tienen
           historia parcial (empieza el 2025-11-19): solo se exige que los
           registros caigan dentro. */
        var hoy = new DateTime(2026, 11, 9);
        string[,] a3 = {
            { "2026-10-11", "2026-11-09" }, { "2026-09-11", "2026-10-10" }, { "2026-08-12", "2026-09-10" },
            { "2026-07-13", "2026-08-11" }, { "2026-06-13", "2026-07-12" }, { "2026-05-14", "2026-06-12" },
            { "2026-04-14", "2026-05-13" }, { "2026-03-15", "2026-04-13" }, { "2026-02-13", "2026-03-14" },
            { "2026-01-14", "2026-02-12" }, { "2025-12-15", "2026-01-13" } };
        for (int k = 0; k <= 10; k++)
        {
            DateTime desde, hasta;
            ConcentracionContrato.Periodo(k, hoy, out desde, out hasta);
            Chk("periodo slot " + k + " = A3 de QA", a3[k, 0] + ".." + a3[k, 1], Dia(desde) + ".." + Dia(hasta));
        }
        DateTime d11, h11, d12, h12;
        ConcentracionContrato.Periodo(11, hoy, out d11, out h11);
        ConcentracionContrato.Periodo(12, hoy, out d12, out h12);
        Chk("periodo slot 11 contiene 2025-11-19..2025-12-14", "True",
            (d11 <= new DateTime(2025, 11, 19) && h11 >= new DateTime(2025, 12, 14) && h11 == new DateTime(2025, 12, 14)).ToString());
        Chk("periodo slot 12 contiene 2025-10-21..2025-11-07", "True",
            (d12 <= new DateTime(2025, 10, 21) && h12 >= new DateTime(2025, 11, 7)).ToString());
        Chk("slots contiguos: 30 dias, sin hueco ni solape", "True",
            ((h11 - d11).Days == 29 && d11.AddDays(-1) == h12).ToString());

        // Preparar: orden por Posicion, sin tocar la lista original.
        var b = ConcentracionContrato.Grupos;
        var desorden = new List<Dictionary<string, object>> {
            F("Posicion", 2L, "Grupo", "B", "CantidadTickets", 3, "TotalTickets", 10, "Porcentaje", 30m, "PorcentajeAcumulado", 80m),
            F("Posicion", 3L, "Grupo", "C", "CantidadTickets", 2, "TotalTickets", 10, "Porcentaje", 20m, "PorcentajeAcumulado", 100m),
            F("Posicion", 1L, "Grupo", "A", "CantidadTickets", 5, "TotalTickets", 10, "Porcentaje", 50m, "PorcentajeAcumulado", 50m) };
        var avisos = new List<string>();
        var ordenadas = ConcentracionContrato.Preparar(b, desorden, avisos);
        Chk("preparar: por Posicion", "A,B,C", Col(ordenadas, "Grupo"));
        Chk("preparar: la original intacta (puede ser la de cache)", "B,C,A", Col(desorden, "Grupo"));
        Chk("preparar: sano, sin avisos", 0, avisos.Count);

        avisos.Clear();
        ConcentracionContrato.Preparar(b, new List<Dictionary<string, object>> {
            F("Posicion", 1L, "Grupo", "A", "CantidadTickets", 5, "TotalTickets", 10, "Porcentaje", 50m, "PorcentajeAcumulado", 60m),
            F("Posicion", 2L, "Grupo", "B", "CantidadTickets", 6, "TotalTickets", 11, "Porcentaje", 50m, "PorcentajeAcumulado", 55m) }, avisos);
        Chk("preparar: avisa total distinto, acumulado que baja, orden roto y cierre != 100", 4, avisos.Count);

        avisos.Clear();
        ConcentracionContrato.Preparar(ConcentracionContrato.Pareto, new List<Dictionary<string, object>> {
            F("Posicion", 1L, "CantidadTickets", 5, "TotalTickets", 5, "Porcentaje", 100m, "PorcentajeAcumulado", 100m) }, avisos);
        Chk("preparar: avisa columna faltante (Servicio)", "True",
            (avisos.Count == 1 && avisos[0].Contains("Servicio")).ToString());

        avisos.Clear();
        Chk("preparar: vacio = vacio, sin avisos", "0|0",
            ConcentracionContrato.Preparar(b, new List<Dictionary<string, object>>(), avisos).Count + "|" + avisos.Count);
    }

    // ------------------------------------------------------- 2) integracion
    // La forma de dbo.vw_ServicioTickets que leen los tres SP, como TABLA, y
    // el catalogo de nombres que lee el 82.
    const string Esquema = @"
CREATE TABLE dbo.vw_ServicioTickets (
    CodigoTicket NVARCHAR(100) NOT NULL, Servicio NVARCHAR(100) NULL, RamaServicio NVARCHAR(400) NULL,
    Categoria NVARCHAR(500) NULL, Grupo NVARCHAR(255) NULL, Slot NUMERIC(17,0) NULL,
    FechaRegistroDia DATE NULL);
GO
CREATE TABLE dbo.CatServicioCorreo (Servicio NVARCHAR(100) NOT NULL PRIMARY KEY,
    Descripcion NVARCHAR(255) NULL, Habilitado BIT NOT NULL);
GO
INSERT dbo.CatServicioCorreo VALUES (N'PU', N'Punto de venta', 1), (N'EQC', N'S-Equipo de Cómputo', 1),
    (N'WMS', N'Fenix WMS / Logistica', 1), (N'SAP', N'', 1);
GO
-- Slot 0: 12 tickets. PU en dos ramas (3+2), WMS en dos ramas (1+1), EQC 4,
-- SAP 1 (sin descripcion). Uno sin grupo y uno sin categoria.
INSERT dbo.vw_ServicioTickets (CodigoTicket, Servicio, RamaServicio, Categoria, Grupo, Slot) VALUES
 (N'T01', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Hardware/Falla Fisica PinPad', N'Soporte Campo', 0),
 (N'T02', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Hardware/Falla Fisica PinPad', N'Soporte Campo', 0),
 (N'T03', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Hardware/Impresoras Lexmark', N'Proveedor Lexmark', 0),
 (N'T04', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Hardware/Impresoras Lexmark', NULL, 0),
 (N'T05', N'PU',  N'S-Punto de Venta', N'/S-Punto de Venta/Caja/Falla', N'Service Desk', 0),
 (N'T06', N'PU',  N'S-Punto de Venta', N'/S-Punto de Venta/Caja/Falla', N'Service Desk', 0),
 (N'T07', N'PU',  N'S-Punto de Venta', N'  ', N'Service Desk', 0),
 (N'T08', N'PU',  N'S-Aplicativos Punto de Venta', N'/S-Aplicativos Punto de Venta/Linea de cajas/Escalamiento Nivel 2', N'Service Desk', 0),
 (N'T09', N'PU',  N'S-Aplicativos Punto de Venta', N'/S-Aplicativos Punto de Venta/Linea de cajas/Escalamiento Nivel 2', N'Soporte RETO', 0),
 (N'T10', N'WMS', N'S-FENIX WMS', N'/S-FENIX WMS/Recibo/Cita', N'Soporte Fenix_WMS', 0),
 (N'T11', N'WMS', N'S-Logistica', N'/S-Logistica/FENIX WMS - RECIBO PROVEEDORES/CITA NO REPLICA', N'Soporte Fenix_WMS', 0),
 (N'T12', N'SAP', N'SAP', N'/SAP/Alta', N'Soporte AMS Inetum', 0),
-- Slot 1: 2 tickets, para ver que el MISMO slot llega a los tres SP.
 (N'U01', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Otro', N'Soporte Campo', 1),
 (N'U02', N'SAP', N'SAP', N'/SAP/Alta', N'Soporte AMS Inetum', 1);
GO
-- Slot 3: un ticket por dia, los 30 dias (cobertura completa).
INSERT dbo.vw_ServicioTickets (CodigoTicket, Servicio, RamaServicio, Categoria, Grupo, Slot)
SELECT N'W' + RIGHT(N'0' + CAST(n AS NVARCHAR(2)), 2), N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Otro', N'Soporte Campo', 3
FROM (SELECT TOP (30) n = ROW_NUMBER() OVER (ORDER BY (SELECT 1)) - 1 FROM sys.all_objects) q;
GO
-- FechaRegistroDia coherente con el Slot (hoy de Mexico, como la vista):
-- el i-esimo ticket de cada Slot cae i dias antes del fin del Slot.
--   Slot 0: hoy .. hoy-11 (11 dias completos con tickets de 29)
--   Slot 1: 2 dias de 30;  Slot 3: 30 de 30.
;WITH x AS (SELECT FechaRegistroDia, Slot, rn = ROW_NUMBER() OVER (PARTITION BY Slot ORDER BY CodigoTicket) - 1
            FROM dbo.vw_ServicioTickets)
UPDATE x SET FechaRegistroDia = DATEADD(DAY, -(30 * CONVERT(INT, Slot) + rn), CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));
GO";

    static Dictionary<string, object> Pedir(string query, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("", "http://localhost/handlers/concentracion.ashx", query),
                                  new HttpResponse(sw));
        new Concentracion().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        return (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(sw.ToString());
    }

    static List<Dictionary<string, object>> Lista(object o)
    {
        var arr = o as object[];
        if (arr == null) return null;
        var salida = new List<Dictionary<string, object>>();
        foreach (var x in arr) salida.Add((Dictionary<string, object>)x);
        return salida;
    }

    // diasConTickets|diasEsperados|excluyeHoy|completa|primerDia|ultimoDia
    static string Cobertura(Dictionary<string, object> d)
    {
        var c = d["cobertura"] as Dictionary<string, object>;
        if (c == null) return "null";
        return c["diasConTickets"] + "|" + c["diasEsperados"] + "|" + c["excluyeHoy"] + "|" + c["completa"] + "|" + c["primerDia"] + "|" + c["ultimoDia"];
    }

    static string Total(Dictionary<string, object> d, string clave)
    {
        var l = Lista(d[clave]);
        if (l == null) return "null";
        return l.Count == 0 ? "[]" : Convert.ToString(l[0]["TotalTickets"], CultureInfo.InvariantCulture);
    }

    // Corre un script del repo por lotes (GO), sin su USE [Tickets_Proactivanet].
    static void Script(string cadena, string archivo)
    {
        var texto = File.ReadAllText(archivo).Replace("\r\n", "\n").Replace("USE [Tickets_Proactivanet];", "");
        Lotes(cadena, texto);
    }

    static void Lotes(string cadena, string texto)
    {
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            foreach (var lote in texto.Replace("\r\n", "\n").Split(new[] { "\nGO" }, StringSplitOptions.RemoveEmptyEntries))
                if (lote.Trim().Length > 0) new SqlCommand(lote, cn).ExecuteNonQuery();
        }
    }

    static void Integracion(string cadena, string raiz)
    {
        int estado;
        Lotes(cadena, Esquema);
        Script(cadena, Path.Combine(raiz, @"sql\81_concentracion_tickets.sql"));
        ConcentracionQueries.LimpiarCache();

        // --- Slot 0 con los SP actuales (81).
        var d = Pedir("", out estado);
        Chk("81 sin slot: 200 y slot 0", "200|0", estado + "|" + d["slot"]);
        var pareto = Lista(d["pareto"]);
        // Empates de 1: el SP desempata por Servicio ASC con la collation de la
        // base, que ignora el guion ('S-FENIX' se ordena como 'SFENIX'), asi
        // que SAP va antes. Es el orden del SP; la pestaña no reordena.
        Chk("81 pareto por rama, en orden de Posicion",
            "S-Equipo de Computo,S-Punto de Venta,S-Aplicativos Punto de Venta,SAP,S-FENIX WMS,S-Logistica",
            Col(pareto, "Servicio"));
        Chk("81 pareto: cantidades", "4,3,2,1,1,1", Col(pareto, "CantidadTickets"));
        Chk("81 pareto: acumulado cierra en 100", "100.00", Convert.ToDecimal(pareto[pareto.Count - 1]["PorcentajeAcumulado"]).ToString("0.00", CultureInfo.InvariantCulture));
        Chk("81 pareto: sin NombreServicio", "False", pareto[0].ContainsKey("NombreServicio").ToString());
        // Cada grafica con SU total: categorias sin T07 (vacia), grupos sin T04 (NULL).
        Chk("81 totales propios: pareto|categorias|grupos", "12|11|11",
            Total(d, "pareto") + "|" + Total(d, "categorias") + "|" + Total(d, "grupos"));
        Chk("81 categorias: TODAS las filas (el Top lo pone la pestaña)", 7, Lista(d["categorias"]).Count);
        Chk("81 sin errores ni avisos", "0|0", ((Dictionary<string, object>)d["errores"]).Count + "|" + ((object[])d["avisos"]).Length);
        var hoyMx = ConcentracionContrato.HoyMexico(DateTime.UtcNow);
        Chk("cobertura slot 0: sin contar hoy, 11 de 29, parcial, rango real",
            "11|29|True|False|" + Dia(hoyMx.AddDays(-11)) + "|" + Dia(hoyMx), Cobertura(d));
        Chk("cobertura slot 3: 30 de 30, completa", "30|30|False|True|" + Dia(hoyMx.AddDays(-119)) + "|" + Dia(hoyMx.AddDays(-90)),
            Cobertura(Pedir("slot=3", out estado)));
        Chk("cobertura slot 1: 2 de 30, parcial", "2|30|False|False|" + Dia(hoyMx.AddDays(-31)) + "|" + Dia(hoyMx.AddDays(-30)),
            Cobertura(Pedir("slot=1", out estado)));
        Chk("cobertura slot sin tickets: 0, sin rango", "0|30|False|False||", Cobertura(Pedir("slot=8", out estado)));

        var hoy = ConcentracionContrato.HoyMexico(DateTime.UtcNow);
        DateTime desde, hasta;
        ConcentracionContrato.Periodo(0, hoy, out desde, out hasta);
        var periodo = (Dictionary<string, object>)d["periodo"];
        Chk("periodo del slot 0 en la respuesta", Dia(desde) + ".." + Dia(hasta) + "|30",
            periodo["desde"] + ".." + periodo["hasta"] + "|" + periodo["dias"]);
        var info = (Dictionary<string, object>)d["dataInfo"];
        Chk("dataInfo con el mismo periodo", Dia(desde) + ".." + Dia(hasta), info["periodoInicio"] + ".." + info["periodoFin"]);
        Chk("slotMaximo", 12, d["slotMaximo"]);

        // --- El MISMO slot llega a los tres.
        d = Pedir("slot=1", out estado);
        Chk("slot 1: los tres con los tickets del slot 1", "2|2|2",
            Total(d, "pareto") + "|" + Total(d, "categorias") + "|" + Total(d, "grupos"));
        d = Pedir("slot=7", out estado);
        Chk("slot sin tickets: 200 y [] en los tres", "200|[]|[]|[]",
            estado + "|" + Total(d, "pareto") + "|" + Total(d, "categorias") + "|" + Total(d, "grupos"));

        // --- Slot invalido.
        d = Pedir("slot=13", out estado);
        Chk("slot 13: 400 SolicitudInvalida", "400|SolicitudInvalida", estado + "|" + d["tipo"]);
        d = Pedir("slot=abc", out estado);
        Chk("slot abc: 400", 400, estado);

        // --- Cache por slot: un ticket nuevo no se ve hasta limpiarla.
        Lotes(cadena, "INSERT dbo.vw_ServicioTickets (CodigoTicket, Servicio, RamaServicio, Categoria, Grupo, Slot) VALUES (N'U03', N'EQC', N'S-Equipo de Computo', N'/X/Y', N'G', 1);");
        d = Pedir("slot=1", out estado);
        Chk("cache: mismo slot, mismo dato (5 min)", "2", Total(d, "pareto"));
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=1", out estado);
        Chk("cache limpia: dato nuevo", "3", Total(d, "pareto"));

        // --- La propuesta 82: por codigo de servicio.
        Script(cadena, Path.Combine(raiz, @"sql\82_pareto_por_servicio.sql"));
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=0", out estado);
        pareto = Lista(d["pareto"]);
        Chk("82 pareto por codigo: PU y WMS en una barra", "PU,EQC,WMS,SAP", Col(pareto, "Servicio"));
        Chk("82 cantidades (PU = 3+2, WMS = 1+1)", "5,4,2,1", Col(pareto, "CantidadTickets"));
        Chk("82 mismo total que por rama", "12", Total(d, "pareto"));
        Chk("82 NombreServicio del catalogo (vacio -> codigo)",
            "Punto de venta,S-Equipo de Cómputo,Fenix WMS / Logistica,SAP", Col(pareto, "NombreServicio"));
        Chk("82 acumulado", "41.67,75.00,91.67,100.00", string.Join(",", Lista(d["pareto"]).ConvertAll(
            f => Convert.ToDecimal(f["PorcentajeAcumulado"]).ToString("0.00", CultureInfo.InvariantCulture)).ToArray()));
        Chk("82 categorias y grupos sin cambio", "11|11", Total(d, "categorias") + "|" + Total(d, "grupos"));
        Chk("82 sin avisos", 0, ((object[])d["avisos"]).Length);

        // --- Rollback del 82: vuelve a las ramas.
        Script(cadena, Path.Combine(raiz, @"sql\82_pareto_por_servicio_rollback.sql"));
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=0", out estado);
        Chk("rollback 82: otra vez por rama, sin NombreServicio", "6|False",
            Lista(d["pareto"]).Count + "|" + Lista(d["pareto"])[0].ContainsKey("NombreServicio"));

        // --- Una grafica que falla no tumba a las otras.
        // --- La cobertura falla (sin la columna): sin aviso, graficas igual.
        Lotes(cadena, "ALTER TABLE dbo.vw_ServicioTickets DROP COLUMN FechaRegistroDia;");
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=0", out estado);
        Chk("cobertura caida: 200, cobertura null, graficas con datos, aviso", "200|True|12|11|11|True",
            estado + "|" + (d["cobertura"] == null) + "|" + Total(d, "pareto") + "|" + Total(d, "categorias") + "|" + Total(d, "grupos") + "|" +
            (((object[])d["avisos"]).Length == 1 && ((string)((object[])d["avisos"])[0]).Contains("cobertura")));
        Chk("cobertura caida: no cuenta como error de grafica", 0, ((Dictionary<string, object>)d["errores"]).Count);

        Lotes(cadena, "DROP PROCEDURE dbo.usp_CorreoServicio_TicketsGrupo;");
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=0", out estado);
        var errores = (Dictionary<string, object>)d["errores"];
        Chk("falla grupos: 200, grupos null, las otras con datos", "200|null|12|11",
            estado + "|" + Total(d, "grupos") + "|" + Total(d, "pareto") + "|" + Total(d, "categorias"));
        Chk("falla grupos: mensaje con el SP y el 2812, sin servidor", "True",
            (errores.Count == 1 && ((string)errores["grupos"]).Contains("usp_CorreoServicio_TicketsGrupo")
             && ((string)errores["grupos"]).Contains("2812") && !((string)errores["grupos"]).Contains("localdb")).ToString());

        Lotes(cadena, "DROP PROCEDURE dbo.usp_CorreoServicio_Pareto; DROP PROCEDURE dbo.usp_CorreoServicio_TicketsCategoria;");
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=0", out estado);
        Chk("fallan los tres: 500 con {error, tipo}", "500|SqlException", estado + "|" + d["tipo"]);
        Chk("500 sin servidor ni base en el mensaje", "False",
            ((string)d["error"]).IndexOf("localdb", StringComparison.OrdinalIgnoreCase) >= 0);
    }

    // ---------------------------------------------------------- 3) guardas
    static string SinComentarios(string s)
    {
        s = System.Text.RegularExpressions.Regex.Replace(s, @"/\*[\s\S]*?\*/", "");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"<!--[\s\S]*?-->", "");
        return System.Text.RegularExpressions.Regex.Replace(s, @"(^|[^:])//[^\n]*", "$1");
    }

    static void Guardas(string raiz)
    {
        // Solo el CODIGO: los comentarios si nombran Analisis (para decir que
        // no se usa).
        var js = SinComentarios(File.ReadAllText(Path.Combine(raiz, @"concentracion\concentracion.js")));
        var html = SinComentarios(File.ReadAllText(Path.Combine(raiz, @"concentracion\concentracion.html")));
        Chk("la pestaña no llama a analisis.ashx ni lee el modulo de Analisis", "False",
            (js.Contains("analisis.ashx") || js.Contains("TableroAnalisisModulo") || html.Contains("analisis.ashx")).ToString());
        var ashx = File.ReadAllText(Path.Combine(raiz, @"handlers\concentracion.ashx"));
        Chk("el handler no recibe servicio", "False", ashx.Contains("QueryString[\"servicio\"]").ToString());
    }

    public static int Main(string[] args)
    {
        var raiz = args.Length > 0 ? args[0] : Directory.GetCurrentDirectory();
        const string maestra = @"Server=(localdb)\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true";

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
        if (!bd.StartsWith("ConcentracionSmoke", StringComparison.Ordinal))
        {
            Console.WriteLine("La base de la prueba debe llamarse ConcentracionSmoke*: se crea y se BORRA.");
            return 98;
        }
        using (var cn = new SqlConnection(maestra))
        {
            cn.Open();
            new SqlCommand("IF DB_ID('" + bd + "') IS NOT NULL BEGIN ALTER DATABASE [" + bd +
                           "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "]; END; CREATE DATABASE [" + bd + "];", cn).ExecuteNonQuery();
        }
        try
        {
            Integracion(cadena, raiz);
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
