// tools/tests/ConcentracionContratoSmoke.cs - prueba de humo del backend de la
// pestaña "Vista general de servicios" (concentracion.ashx).
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Tres partes:
//   1) ConcentracionContrato, puro: parametros (modo, slot, mes, listas),
//      Slot -> fechas contra los rangos REALES de QA (diag 2, A3), mes
//      calendario, cobertura, filtros, opciones y la cuenta (orden, total,
//      porcentajes con el redondeo de DECIMAL(6,2)).
//   2) ConcentracionQueries + handlers/concentracion.ashx de punta a punta
//      contra SQL Server LocalDB, en una base TEMPORAL:
//        - PARIDAD con los procedimientos reales: con los mismos datos, las
//          categorias y grupos del handler (sin filtros) son fila por fila
//          los de sql/81 (usp_CorreoServicio_TicketsCategoria / _TicketsGrupo)
//          y el Pareto el de sql/82 (por codigo de servicio);
//        - Service Owner con la regla de DirectorioOrganizacional (C1&C2
//          exacto, si no el del C1; sin SO = "(Sin Service Owner)");
//        - Grupo, combinados, sin resultados, opciones con lo elegido;
//        - Mes contra un conteo directo; Slot y Mes no se mezclan;
//        - 400 por parametros invalidos; cobertura; sin catalogo de dueños
//          (aviso, o 500 si se filtra por SO); sin la vista (500).
//   3) Guardas: la pestaña no llama a nada de Analisis de servicios y el
//      backend ya no llama a los SP.
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (Git Bash; opciones con "-"):
//   tail -n +2 handlers/concentracion.ashx > <scratch>/conc_handler.cs
//   csc -nologo -out:<scratch>/ConcSmoke.exe -r:System.dll -r:System.Core.dll -r:System.Data.dll
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
using System.Linq;
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

    static string Dia(DateTime d) { return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }

    static ConcentracionTicket T(string codigo, string servicio, string categoria, string grupo, string so)
    {
        return new ConcentracionTicket { Codigo = codigo, Servicio = servicio, NombreServicio = servicio + " nombre",
                                         Categoria = categoria, Grupo = grupo, ServiceOwner = so };
    }

    static string Col(List<Dictionary<string, object>> filas, string col)
    {
        if (filas == null) return "null";
        return string.Join(",", filas.Select(f =>
        {
            object v; f.TryGetValue(col, out v);
            if (v is decimal) return ((decimal)v).ToString("0.00", CultureInfo.InvariantCulture);
            return v == null ? "null" : Convert.ToString(v, CultureInfo.InvariantCulture);
        }).ToArray());
    }

    // ------------------------------------------------------------ 1) puro
    static void Puro()
    {
        var hoy = new DateTime(2026, 11, 9);
        Chk("modo: ausente = slot; mes; otro = 400", "slot|mes|400",
            ConcentracionContrato.LeerModo(null) + "|" + ConcentracionContrato.LeerModo(" MES ") + "|" + Falla(() => ConcentracionContrato.LeerModo("anio")));
        Chk("slot: ausente 0, 12 ok, 13/-1/abc/1.5 = 400", "0|12|400|400|400|400",
            ConcentracionContrato.LeerSlot(null) + "|" + ConcentracionContrato.LeerSlot("12") + "|" +
            Falla(() => ConcentracionContrato.LeerSlot("13")) + "|" + Falla(() => ConcentracionContrato.LeerSlot("-1")) + "|" +
            Falla(() => ConcentracionContrato.LeerSlot("abc")) + "|" + Falla(() => ConcentracionContrato.LeerSlot("1.5")));
        Chk("mes: vacio = el actual; 12 atras ok; 13 atras, futuro y basura = 400", "2026-11|2025-11|400|400|400",
            ConcentracionContrato.Mes(ConcentracionContrato.LeerMes("", hoy)) + "|" +
            ConcentracionContrato.Mes(ConcentracionContrato.LeerMes("2025-11", hoy)) + "|" +
            Falla(() => ConcentracionContrato.LeerMes("2025-10", hoy)) + "|" + Falla(() => ConcentracionContrato.LeerMes("2026-12", hoy)) + "|" +
            Falla(() => ConcentracionContrato.LeerMes("noviembre", hoy)));
        Chk("meses: 13, del actual hacia atras", "13|2026-11|2025-11",
            ConcentracionContrato.Meses(hoy).Count + "|" + ConcentracionContrato.Mes(ConcentracionContrato.Meses(hoy)[0]) + "|" +
            ConcentracionContrato.Mes(ConcentracionContrato.Meses(hoy)[12]));
        Chk("listas por '|', sin vacios ni repetidos (los nombres pueden llevar coma)", "Perez, Ana|B",
            string.Join("|", ConcentracionContrato.LeerLista(" Perez, Ana | |B|B").ToArray()));
        Chk("hoy de la vista (UTC-6)", "2026-11-09|2026-11-10",
            Dia(ConcentracionContrato.HoyMexico(new DateTime(2026, 11, 10, 5, 59, 0, DateTimeKind.Utc))) + "|" +
            Dia(ConcentracionContrato.HoyMexico(new DateTime(2026, 11, 10, 6, 0, 0, DateTimeKind.Utc))));

        // Slot -> fechas: los rangos que REALMENTE devolvio QA el 2026-11-09.
        string[] a3 = { "2026-10-11..2026-11-09", "2026-09-11..2026-10-10", "2026-08-12..2026-09-10", "2026-07-13..2026-08-11",
                        "2026-06-13..2026-07-12", "2026-05-14..2026-06-12", "2026-04-14..2026-05-13", "2026-03-15..2026-04-13",
                        "2026-02-13..2026-03-14", "2026-01-14..2026-02-12", "2025-12-15..2026-01-13" };
        var calc = new List<string>();
        for (int k = 0; k <= 10; k++) { DateTime d, h; ConcentracionContrato.Periodo(k, hoy, out d, out h); calc.Add(Dia(d) + ".." + Dia(h)); }
        Chk("Slot 0..10 = rangos de QA (A3), sin cambiar la regla", string.Join("|", a3), string.Join("|", calc.ToArray()));

        DateTime md, mh;
        ConcentracionContrato.PeriodoMes(new DateTime(2026, 11, 1), hoy, out md, out mh);
        Chk("mes en curso: del 1 a hoy", "2026-11-01..2026-11-09", Dia(md) + ".." + Dia(mh));
        ConcentracionContrato.PeriodoMes(new DateTime(2026, 2, 1), hoy, out md, out mh);
        Chk("mes cerrado: completo (febrero 28)", "2026-02-01..2026-02-28", Dia(md) + ".." + Dia(mh));

        Chk("dias esperados: slot 0 sin hoy 29; slot 1 30; mes en curso 8; mes cerrado 28", "29|30|8|28",
            ConcentracionContrato.DiasEsperados(new DateTime(2026, 10, 11), hoy, hoy) + "|" +
            ConcentracionContrato.DiasEsperados(new DateTime(2026, 9, 11), new DateTime(2026, 10, 10), hoy) + "|" +
            ConcentracionContrato.DiasEsperados(new DateTime(2026, 11, 1), hoy, hoy) + "|" +
            ConcentracionContrato.DiasEsperados(new DateTime(2026, 2, 1), new DateTime(2026, 2, 28), hoy));

        // La cuenta.
        var tk = new List<ConcentracionTicket> {
            T("1", "PU", "/A/x", "G1", "Ana"), T("2", "PU", "/A/x", "G1", "Ana"), T("3", "EQC", "/B/y", "G2", null),
            T("3", "EQC", "/B/y", "G2", null),   // el mismo ticket dos veces cuenta una
            T("4", "SAP", "/C/z", null, "Beto"), T("5", "S-FENIX", "/D", "G3", "Beto") };
        var p = ConcentracionContrato.Pareto(tk);
        Chk("pareto: distintos por servicio; empate ordenado como SQL (SAP antes que S-FENIX)", "PU,EQC,SAP,S-FENIX|2,1,1,1",
            Col(p, "Servicio") + "|" + Col(p, "CantidadTickets"));
        Chk("pareto: total = suma; % y acumulado a 2 decimales", "5|40.00,20.00,20.00,20.00|40.00,60.00,80.00,100.00",
            p[0]["TotalTickets"] + "|" + Col(p, "Porcentaje") + "|" + Col(p, "PorcentajeAcumulado"));
        Chk("pareto: NombreServicio", "PU nombre", p[0]["NombreServicio"]);
        var g = ConcentracionContrato.Grupos(tk);
        Chk("grupos: sin grupo fuera, total propio", "G1,G2,G3|4", Col(g, "Grupo") + "|" + g[0]["TotalTickets"]);
        Chk("redondeo de DECIMAL(6,2): mitad hacia arriba", "33.33|66.67|16.67", ConcentracionContrato.Pct(1, 3).ToString(CultureInfo.InvariantCulture) + "|" +
            ConcentracionContrato.Pct(2, 3).ToString(CultureInfo.InvariantCulture) + "|" + ConcentracionContrato.Pct(1, 6).ToString(CultureInfo.InvariantCulture));

        var f = new ConcentracionFiltros();
        f.ServiceOwners.Add(ConcentracionContrato.SinServiceOwner);
        Chk("filtro SO: sin SO", "3,3", string.Join(",", ConcentracionContrato.Filtrar(tk, f).Select(x => x.Codigo).ToArray()));
        f.ServiceOwners.Clear(); f.ServiceOwners.Add("beto"); f.Grupos.Add("G3");
        Chk("filtros SO y Grupo juntos (y), sin distinguir mayusculas", "5", string.Join(",", ConcentracionContrato.Filtrar(tk, f).Select(x => x.Codigo).ToArray()));
        var op = ConcentracionContrato.Opciones(new[] { "Ana", "Ana", "Beto", null }, new[] { "Zeta" });
        Chk("opciones: de mas a menos, con lo elegido que ya no esta (0)", "Ana:2,Beto:1,Zeta:0",
            string.Join(",", op.Select(o => o["valor"] + ":" + o["tickets"]).ToArray()));
    }

    static string Falla(Action a)
    {
        try { a(); return "acepto"; } catch (ConcentracionSolicitudInvalida) { return "400"; }
    }

    // ------------------------------------------------------- 2) integracion
    const string Esquema = @"
CREATE TABLE dbo.vw_ServicioTickets (
    CodigoTicket NVARCHAR(100) NOT NULL, Servicio NVARCHAR(100) NULL, RamaServicio NVARCHAR(400) NULL,
    C1Raiz NVARCHAR(500) NULL, Categoria NVARCHAR(500) NULL, Grupo NVARCHAR(255) NULL, Slot NUMERIC(17,0) NULL,
    FechaRegistro DATETIME2(0) NULL, FechaRegistroDia DATE NULL);
GO
CREATE TABLE dbo.CatServicioCorreo (Servicio NVARCHAR(100) NOT NULL PRIMARY KEY,
    Descripcion NVARCHAR(255) NULL, Habilitado BIT NOT NULL);
GO
INSERT dbo.CatServicioCorreo VALUES (N'PU', N'Punto de venta', 1), (N'EQC', N'S-Equipo de Cómputo', 1),
    (N'WMS', N'Fenix WMS / Logistica', 1), (N'SAP', N'', 1);
GO
CREATE TABLE dbo.CatCategoriaDueno (CategoriaN2 NVARCHAR(450) NULL, ProductOwner NVARCHAR(255) NULL,
    ServiceOwner NVARCHAR(255) NULL, DirectorPO NVARCHAR(255) NULL, C1 NVARCHAR(255) NULL, VigenteEnOrigen BIT NOT NULL);
GO
-- EQC: dueño en /Hardware; /Otro no esta capturado y hereda del C1 (Ana).
-- PU: solo /S-Punto de Venta/Caja (Beto); S-Aplicativos, WMS y SAP sin dueño.
INSERT dbo.CatCategoriaDueno VALUES
 (N'/S-Equipo de Computo/Hardware', N'PO 1', N'Ana SO', N'Dir 1', N'/S-Equipo de Computo', 1),
 (N'/S-Punto de Venta/Caja',        N'PO 2', N'Beto SO', N'Dir 1', N'/S-Punto de Venta', 1);
GO
CREATE TABLE dbo.CatPersona (Nombre NVARCHAR(255) NULL, Manager NVARCHAR(255) NULL, VigenteEnOrigen BIT NOT NULL);
GO
INSERT dbo.CatPersona VALUES (N'Ana SO', N'Mgr', 1), (N'Beto SO', N'Mgr', 1);
GO
-- C1&C2 como la real: normaliza y corta en el segundo nivel.
CREATE FUNCTION dbo.fn_CategoriaC1C2 (@Categoria NVARCHAR(500)) RETURNS NVARCHAR(500) AS
BEGIN
    DECLARE @s NVARCHAR(500) = LTRIM(RTRIM(REPLACE(ISNULL(@Categoria, N''), NCHAR(160), N' ')));
    IF @s = N'' RETURN N'';
    DECLARE @p2 INT = CHARINDEX(N'/', @s, 2);
    IF @p2 = 0 RETURN @s;
    DECLARE @p3 INT = CHARINDEX(N'/', @s, @p2 + 1);
    IF @p3 = 0 RETURN @s;
    RETURN LEFT(@s, @p3 - 1);
END;
GO
-- Slot 0: 12 tickets (PU en dos ramas 3+2, WMS en dos 1+1, EQC 4, SAP 1;
-- uno sin grupo, uno sin categoria).
INSERT dbo.vw_ServicioTickets (CodigoTicket, Servicio, RamaServicio, Categoria, Grupo, Slot) VALUES
 (N'T01', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Hardware/Falla Fisica PinPad', N'Soporte Campo', 0),
 (N'T02', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Hardware/Falla Fisica PinPad', N'Soporte Campo', 0),
 (N'T03', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Otro/Impresoras Lexmark', N'Proveedor Lexmark', 0),
 (N'T04', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Hardware/Impresoras Lexmark', NULL, 0),
 (N'T05', N'PU',  N'S-Punto de Venta', N'/S-Punto de Venta/Caja/Falla', N'Service Desk', 0),
 (N'T06', N'PU',  N'S-Punto de Venta', N'/S-Punto de Venta/Caja/Falla', N'Service Desk', 0),
 (N'T07', N'PU',  N'S-Punto de Venta', N'  ', N'Service Desk', 0),
 (N'T08', N'PU',  N'S-Aplicativos Punto de Venta', N'/S-Aplicativos Punto de Venta/Linea de cajas/Escalamiento Nivel 2', N'Service Desk', 0),
 (N'T09', N'PU',  N'S-Aplicativos Punto de Venta', N'/S-Aplicativos Punto de Venta/Linea de cajas/Escalamiento Nivel 2', N'Soporte RETO', 0),
 (N'T10', N'WMS', N'S-FENIX WMS', N'/S-FENIX WMS/Recibo/Cita', N'Soporte Fenix_WMS', 0),
 (N'T11', N'WMS', N'S-Logistica', N'/S-Logistica/FENIX WMS - RECIBO PROVEEDORES/CITA NO REPLICA', N'Soporte Fenix_WMS', 0),
 (N'T12', N'SAP', N'SAP', N'/SAP/Alta', N'Soporte AMS Inetum', 0),
 (N'U01', N'EQC', N'S-Equipo de Computo', N'/S-Equipo de Computo/Otro', N'Soporte Campo', 1),
 (N'U02', N'SAP', N'SAP', N'/SAP/Alta', N'Soporte AMS Inetum', 1);
GO
-- Fechas coherentes con el Slot (hoy de Mexico, como la vista): el i-esimo
-- ticket de cada Slot cae i dias antes del fin del Slot. C1Raiz = 1er nivel.
;WITH x AS (SELECT FechaRegistro, FechaRegistroDia, C1Raiz, Categoria, Slot,
                   rn = ROW_NUMBER() OVER (PARTITION BY Slot ORDER BY CodigoTicket) - 1
            FROM dbo.vw_ServicioTickets)
UPDATE x SET FechaRegistroDia = DATEADD(DAY, -(30 * CONVERT(INT, Slot) + rn), CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()))),
             FechaRegistro = DATEADD(HOUR, 10, CONVERT(DATETIME2(0), DATEADD(DAY, -(30 * CONVERT(INT, Slot) + rn), CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()))))),
             C1Raiz = CASE WHEN CHARINDEX(N'/', LTRIM(Categoria), 2) > 0 THEN LEFT(LTRIM(Categoria), CHARINDEX(N'/', LTRIM(Categoria), 2) - 1)
                           ELSE NULLIF(LTRIM(RTRIM(Categoria)), N'') END;
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
        return arr.Select(x => (Dictionary<string, object>)x).ToList();
    }

    static string Total(Dictionary<string, object> d, string clave)
    {
        var l = Lista(d[clave]);
        if (l == null) return "null";
        return l.Count == 0 ? "[]" : Convert.ToString(l[0]["TotalTickets"], CultureInfo.InvariantCulture);
    }

    static string Totales(Dictionary<string, object> d)
    {
        return Total(d, "pareto") + "|" + Total(d, "categorias") + "|" + Total(d, "grupos") + "|" + d["ticketsFiltrados"] + "/" + d["ticketsPeriodo"];
    }

    // Una fila como texto, con los decimales a 2 (asi salen de SQL y del handler).
    static string Fila(Dictionary<string, object> f, params string[] cols)
    {
        return string.Join(";", cols.Select(c =>
        {
            object v; f.TryGetValue(c, out v);
            // Los porcentajes, siempre a 2 decimales: JSON trae 100 como entero.
            if (v != null && (v is decimal || v is double || c.StartsWith("Porcentaje")))
                return Convert.ToDecimal(v, CultureInfo.InvariantCulture).ToString("0.00", CultureInfo.InvariantCulture);
            return v == null ? "null" : Convert.ToString(v, CultureInfo.InvariantCulture);
        }).ToArray());
    }

    static List<Dictionary<string, object>> Exec(string cadena, string sql)
    {
        var filas = new List<Dictionary<string, object>>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand(sql, cn))
        {
            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) filas.Add(SqlRowMapper.Fila(rd));
        }
        return filas;
    }

    static int Escalar(string cadena, string sql)
    {
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand(sql, cn)) { cn.Open(); return Convert.ToInt32(cmd.ExecuteScalar()); }
    }

    // Corre un script del repo por lotes (GO), sin su USE [Tickets_Proactivanet].
    static void Script(string cadena, string archivo)
    {
        Lotes(cadena, File.ReadAllText(archivo).Replace("USE [Tickets_Proactivanet];", ""));
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

    static string Paridad(List<Dictionary<string, object>> sp, List<Dictionary<string, object>> h, params string[] cols)
    {
        if (h == null) return "handler null";
        if (sp.Count != h.Count) return "filas " + sp.Count + " vs " + h.Count;
        for (int i = 0; i < sp.Count; i++)
        {
            var a = Fila(sp[i], cols); var b = Fila(h[i], cols);
            if (a != b) return "fila " + (i + 1) + ": SP[" + a + "] handler[" + b + "]";
        }
        return "igual (" + sp.Count + " filas)";
    }

    static void Integracion(string cadena, string raiz)
    {
        int estado;
        Lotes(cadena, Esquema);
        ConcentracionQueries.LimpiarCache();

        // --- Paridad con los procedimientos reales (81 y la propuesta 82), sin filtros.
        Script(cadena, Path.Combine(raiz, @"sql\81_concentracion_tickets.sql"));
        Script(cadena, Path.Combine(raiz, @"sql\82_pareto_por_servicio.sql"));
        var d = Pedir("", out estado);
        Chk("sin parametros: 200, modo slot 0", "200|slot|0", estado + "|" + d["modo"] + "|" + d["slot"]);
        var cols = new[] { "Posicion", "CantidadTickets", "TotalTickets", "Porcentaje", "PorcentajeAcumulado" };
        Chk("paridad categorias = usp_CorreoServicio_TicketsCategoria", "igual (8 filas)",
            Paridad(Exec(cadena, "EXEC dbo.usp_CorreoServicio_TicketsCategoria @Slot = 0"), Lista(d["categorias"]), cols.Concat(new[] { "Categoria" }).ToArray()));
        Chk("paridad grupos = usp_CorreoServicio_TicketsGrupo", "igual (6 filas)",
            Paridad(Exec(cadena, "EXEC dbo.usp_CorreoServicio_TicketsGrupo @Slot = 0"), Lista(d["grupos"]), cols.Concat(new[] { "Grupo" }).ToArray()));
        Chk("paridad pareto = 82 (por codigo de servicio, con NombreServicio)", "igual (4 filas)",
            Paridad(Exec(cadena, "EXEC dbo.usp_CorreoServicio_Pareto @Slot = 0"), Lista(d["pareto"]), cols.Concat(new[] { "Servicio", "NombreServicio" }).ToArray()));
        Chk("pareto por codigo: PU y WMS una barra cada uno", "PU,EQC,WMS,SAP|5,4,2,1",
            Col(Lista(d["pareto"]), "Servicio") + "|" + Col(Lista(d["pareto"]), "CantidadTickets"));
        Chk("totales propios: pareto|categorias|grupos|filtrados/periodo", "12|11|11|12/12", Totales(d));
        Chk("sin avisos", 0, ((object[])d["avisos"]).Length);

        var hoy = ConcentracionContrato.HoyMexico(DateTime.UtcNow);
        DateTime desde, hasta;
        ConcentracionContrato.Periodo(0, hoy, out desde, out hasta);
        var per = (Dictionary<string, object>)d["periodo"];
        Chk("periodo del slot 0", Dia(desde) + ".." + Dia(hasta), per["desde"] + ".." + per["hasta"]);
        var cob = (Dictionary<string, object>)d["cobertura"];
        Chk("cobertura slot 0: 11 de 29 dias (sin hoy), parcial", "11|29|False", cob["diasConTickets"] + "|" + cob["diasEsperados"] + "|" + cob["completa"]);

        // --- Service Owner: opciones y filtro.
        var op = (Dictionary<string, object>)d["opciones"];
        Chk("opciones SO (regla N2 exacto o C1; sin dueño aparte)", "(Sin Service Owner):6,Ana SO:4,Beto SO:2",
            string.Join(",", Lista(op["serviceOwners"]).Select(o => o["valor"] + ":" + o["tickets"]).ToArray()));
        d = Pedir("so=Ana%20SO", out estado);
        Chk("SO Ana (T03 hereda del C1): solo EQC en las tres", "EQC:4|4|4|3|4/12",
            Col(Lista(d["pareto"]), "Servicio") + ":" + Col(Lista(d["pareto"]), "CantidadTickets") + "|" + Totales(d));
        d = Pedir("so=" + HttpUtility.UrlEncode(ConcentracionContrato.SinServiceOwner), out estado);
        Chk("SO '(Sin Service Owner)'", "PU,WMS,SAP|6|5|6|6/12", Col(Lista(d["pareto"]), "Servicio") + "|" + Totales(d));
        d = Pedir("so=" + HttpUtility.UrlEncode("Ana SO|Beto SO"), out estado);
        Chk("dos SO = cualquiera de ellos", "6|6|5|6/12", Totales(d));
        Chk("acumulado sobre lo filtrado cierra en 100", "100.00",
            Fila(Lista(d["pareto"]).Last(), "PorcentajeAcumulado"));

        // --- Grupo y combinados.
        d = Pedir("grupo=Service%20Desk", out estado);
        Chk("Grupo Service Desk: las tres graficas filtradas", "PU|4|3|4|4/12", Col(Lista(d["pareto"]), "Servicio") + "|" + Totales(d));
        Chk("Grupo: la grafica de grupos solo trae el elegido", "Service Desk", Col(Lista(d["grupos"]), "Grupo"));
        d = Pedir("so=Beto%20SO&grupo=Service%20Desk", out estado);
        Chk("SO y Grupo juntos", "2|2|2|2/12", Totales(d));
        d = Pedir("so=Ana%20SO&grupo=Soporte%20RETO", out estado);
        Chk("sin resultados: 200, [] en las tres, 0 de 12", "200|[]|[]|[]|0/12", estado + "|" + Totales(d));
        var opG = Lista(((Dictionary<string, object>)d["opciones"])["grupos"]);
        Chk("opciones de grupo salen del periodo completo (no se encogen con el filtro)", 6, opG.Count);
        d = Pedir("so=Zeta", out estado);
        Chk("SO elegido que no esta en el periodo: opcion con 0, sin tickets", "Zeta:0|0/12",
            string.Join(",", Lista(((Dictionary<string, object>)d["opciones"])["serviceOwners"]).Where(o => (string)o["valor"] == "Zeta")
                .Select(o => o["valor"] + ":" + o["tickets"]).ToArray()) + "|" + d["ticketsFiltrados"] + "/" + d["ticketsPeriodo"]);
        d = Pedir("so=Ana%20SO", out estado);
        Chk("filtros aplicados en la respuesta", "Ana SO",
            string.Join(",", ((object[])((Dictionary<string, object>)d["filtros"])["serviceOwners"]).Select(x => (string)x).ToArray()));

        // --- Mes (calendario) contra un conteo directo; no se mezcla con Slot.
        var mesActual = ConcentracionContrato.Mes(new DateTime(hoy.Year, hoy.Month, 1));
        int directo = Escalar(cadena, "SELECT COUNT(*) FROM dbo.vw_ServicioTickets WHERE FechaRegistro >= '" +
                                      Dia(new DateTime(hoy.Year, hoy.Month, 1)) + "' AND FechaRegistro < '" + Dia(hoy.AddDays(1)) + "'");
        d = Pedir("modo=mes&mes=" + mesActual + "&slot=7", out estado);
        Chk("mes en curso: tickets = conteo directo por FechaRegistro; el slot se ignora", "200|mes|" + mesActual + "|null|" + directo,
            estado + "|" + d["modo"] + "|" + d["mes"] + "|" + (d["slot"] ?? "null") + "|" + d["ticketsPeriodo"]);
        per = (Dictionary<string, object>)d["periodo"];
        Chk("periodo del mes en curso: del 1 a hoy", Dia(new DateTime(hoy.Year, hoy.Month, 1)) + ".." + Dia(hoy), per["desde"] + ".." + per["hasta"]);
        Chk("meses ofrecidos: 13, el primero en curso", "13|" + mesActual + "|True",
            ((object[])d["meses"]).Length + "|" + ((Dictionary<string, object>)((object[])d["meses"])[0])["valor"] + "|" +
            ((Dictionary<string, object>)((object[])d["meses"])[0])["enCurso"]);
        var mesViejo = ConcentracionContrato.Mes(new DateTime(hoy.Year, hoy.Month, 1).AddMonths(-12));
        d = Pedir("modo=mes&mes=" + mesViejo, out estado);
        Chk("mes sin tickets: 200 y vacio", "200|[]|[]|[]|0/0", estado + "|" + Totales(d));
        d = Pedir("modo=slot&slot=1&mes=" + mesActual, out estado);
        Chk("slot 1 con mes en la URL: manda el slot", "slot|1|null|2", d["modo"] + "|" + d["slot"] + "|" + (d["mes"] ?? "null") + "|" + d["ticketsPeriodo"]);

        // --- Parametros invalidos.
        Chk("400: slot 13, mes fuera de rango, modo raro", "400|400|400",
            Estado("slot=13") + "|" + Estado("modo=mes&mes=2001-01") + "|" + Estado("modo=semana"));

        // --- Cache: un ticket nuevo no se ve hasta limpiarla.
        Lotes(cadena, "INSERT dbo.vw_ServicioTickets (CodigoTicket, Servicio, RamaServicio, Categoria, Grupo, Slot) VALUES (N'U03', N'SAP', N'SAP', N'/SAP/Alta', N'G', 1);");
        d = Pedir("slot=1", out estado);
        Chk("cache: mismo periodo, mismo dato (5 min)", "2", d["ticketsPeriodo"]);
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=1", out estado);
        Chk("cache limpia: dato nuevo", "3", d["ticketsPeriodo"]);

        // --- Sin catalogo de dueños: aviso, sin filtro SO; filtrar por SO = 500.
        Lotes(cadena, "EXEC sp_rename 'dbo.CatCategoriaDueno', 'CatCategoriaDueno_x';");
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=0", out estado);
        Chk("sin catalogo de dueños: 200, graficas igual, aviso, sin opciones de SO", "200|12|11|11|12/12|True|0",
            estado + "|" + Totales(d) + "|" + ((string)((object[])d["avisos"])[0]).Contains("dueños") + "|" +
            Lista(((Dictionary<string, object>)d["opciones"])["serviceOwners"]).Count);
        d = Pedir("slot=0&so=Ana%20SO", out estado);
        Chk("sin catalogo y filtrando por SO: 500 que lo dice (no se ignora el filtro)", "500|True",
            estado + "|" + ((string)d["error"]).Contains("Service Owner"));
        Lotes(cadena, "EXEC sp_rename 'dbo.CatCategoriaDueno_x', 'CatCategoriaDueno';");

        // --- Sin la vista: 500 con el objeto, sin servidor.
        Lotes(cadena, "EXEC sp_rename 'dbo.vw_ServicioTickets', 'vw_x';");
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=0", out estado);
        Chk("sin la vista: 500 que nombra el objeto, sin servidor", "500|True|False", estado + "|" +
            ((string)d["error"]).Contains("vw_ServicioTickets") + "|" + (((string)d["error"]).IndexOf("localdb", StringComparison.OrdinalIgnoreCase) >= 0));
    }

    static int Estado(string query) { int e; Pedir(query, out e); return e; }

    // ---------------------------------------------------------- 3) guardas
    static string SinComentarios(string s)
    {
        s = System.Text.RegularExpressions.Regex.Replace(s, @"/\*[\s\S]*?\*/", "");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"<!--[\s\S]*?-->", "");
        return System.Text.RegularExpressions.Regex.Replace(s, @"(^|[^:])//[^\n]*", "$1");
    }

    static void Guardas(string raiz)
    {
        var js = SinComentarios(File.ReadAllText(Path.Combine(raiz, @"concentracion\concentracion.js")));
        var html = SinComentarios(File.ReadAllText(Path.Combine(raiz, @"concentracion\concentracion.html")));
        Chk("la pestaña no llama a analisis.ashx ni lee el modulo de Analisis", "False",
            (js.Contains("analisis.ashx") || js.Contains("TableroAnalisisModulo") || html.Contains("analisis.ashx")).ToString());
        var q = File.ReadAllText(Path.Combine(raiz, @"App_Code\ConcentracionQueries.cs"));
        Chk("el backend no llama a los SP usp_CorreoServicio_* (sin tocarlos)", "False",
            SinComentarios(q).Contains("usp_CorreoServicio_").ToString());
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
