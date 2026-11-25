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
//      Rendimiento (2026-11-11):
//        - C1&C2 en C# contra dbo.fn_CategoriaC1C2 con el texto EXACTO de QA
//          (casos a mano, cada caracter verificable en varias posiciones, al
//          azar con semilla fija, y texto raro que va a la funcion real);
//          una vez por categoria distinta; salida = la del camino viejo;
//        - cache por mes: lee solo los meses que faltan, reusa los demas,
//          filtros sobre lo guardado = en frio, vencimiento, Slot aparte;
//        - lecturas en vuelo: peticiones simultaneas (tabla bloqueada por
//          otra transaccion) lanzan UNA consulta por mes;
//        - Server-Timing: metricas, formato, cache vs SQL, sin datos, mismo JSON.
//   1b/2c) Comparacion con el periodo anterior (2026-11-18): periodos (Slot
//      acumulado, mes en curso y cerrado, meses seguidos y no seguidos),
//      cuenta por codigo (Top 5, empates, 0 fuera, cambio de rama), filtros
//      SO y Grupo en los dos periodos, historia insuficiente, vacio, error
//      de lectura y un oraculo SQL independiente.
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

        // Varios meses y Slot acumulado (2026-11-10).
        Chk("meses: lista por '|', sin repetidos, del mas reciente; vacio = el actual; uno malo = 400", "2026-11,2026-09,2025-11|2026-11|400",
            string.Join(",", ConcentracionContrato.LeerMeses("2026-09|2025-11| 2026-11 |2026-09", hoy).ConvertAll(ConcentracionContrato.Mes).ToArray()) + "|" +
            string.Join(",", ConcentracionContrato.LeerMeses(" | ", hoy).ConvertAll(ConcentracionContrato.Mes).ToArray()) + "|" +
            Falla(() => ConcentracionContrato.LeerMeses("2026-09|2026-12", hoy)));
        var acumPuro = new List<string>();
        for (int k = 0; k <= 3; k++) { DateTime d, h; ConcentracionContrato.PeriodoAcumulado(k, hoy, out d, out h); acumPuro.Add(Dia(d) + ".." + Dia(h)); }
        Chk("Slot acumulado N: del inicio del Slot N (A3) a hoy", "2026-10-11..2026-11-09|2026-09-11..2026-11-09|2026-08-12..2026-11-09|2026-07-13..2026-11-09",
            string.Join("|", acumPuro.ToArray()));
        var rangosCob = new List<KeyValuePair<DateTime, DateTime>> {
            new KeyValuePair<DateTime, DateTime>(new DateTime(2026, 11, 1), hoy), new KeyValuePair<DateTime, DateTime>(new DateTime(2026, 9, 1), new DateTime(2026, 9, 30)) };
        var tkCob = new List<ConcentracionTicket> {
            new ConcentracionTicket { Codigo = "a", Dia = new DateTime(2026, 11, 2) }, new ConcentracionTicket { Codigo = "b", Dia = new DateTime(2026, 9, 5) },
            new ConcentracionTicket { Codigo = "c", Dia = new DateTime(2026, 10, 5) }, new ConcentracionTicket { Codigo = "d", Dia = hoy } };
        var cobVarios = ConcentracionContrato.Cobertura(tkCob, rangosCob, hoy);
        Chk("cobertura de varios rangos: esperados = suma (8 + 30), solo dias dentro de alguno, sin hoy", "2|38|False|True",
            cobVarios["diasConTickets"] + "|" + cobVarios["diasEsperados"] + "|" + cobVarios["completa"] + "|" + cobVarios["excluyeHoy"]);

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

        ComparacionPura();
        TendenciaPura();
    }

    // ------------------------------------------- 1c) tendencia diaria (2026-11-25)
    static ConcentracionTicket TD(string codigo, string servicio, DateTime? dia)
    {
        return new ConcentracionTicket { Codigo = codigo, Servicio = servicio, NombreServicio = servicio + " nombre", Dia = dia };
    }

    static string SerieTD(Dictionary<string, object> t)
    {
        return string.Join(";", ((List<Dictionary<string, object>>)t["series"]).Select(x =>
            x["Servicio"] + "=" + string.Join(",", ((List<int>)x["TicketsServicio"]).Select(n => n.ToString()).ToArray()) + "/" + x["Total"]).ToArray());
    }

    static void TendenciaPura()
    {
        var d1 = new DateTime(2026, 11, 1); var d2 = d1.AddDays(1); var d3 = d1.AddDays(2);
        var rango = new[] { new KeyValuePair<DateTime, DateTime>(d1, d3) };
        // A 4, B 3, C 2, D 1: el Top 3 es A, B, C. B no tiene tickets el dia 2.
        var tk = new List<ConcentracionTicket> {
            TD("a1", "A", d1), TD("a2", "A", d2), TD("a3", "A", d2), TD("a4", "A", d3),
            TD("b1", "B", d1), TD("b2", "B", d3), TD("b3", "B", d3),
            TD("c1", "C", d2), TD("c2", "C", d3),
            TD("d1", "D", d1) };
        tk.Add(tk[0]);   // el mismo ticket dos veces cuenta uno
        var t = ConcentracionContrato.Tendencia(tk, ConcentracionContrato.Pareto(tk), rango, 3);
        Chk("TD1 Top 3 del Pareto, conteo diario (no acumulado), dia sin tickets = 0, duplicado cuenta uno",
            "A=1,2,1/4;B=1,0,2/3;C=0,1,1/2", SerieTD(t));
        Chk("TD2 dias en orden y TicketsTotalDia = suma de las series pintadas (D fuera)", "2026-11-01,2026-11-02,2026-11-03|2,3,4|4",
            string.Join(",", ((List<string>)t["dias"]).ToArray()) + "|" + string.Join(",", ((List<int>)t["TicketsTotalDia"]).Select(n => n.ToString()).ToArray()) + "|" + t["servicios"]);
        Chk("TD3 nombre del servicio = el del Pareto", "A nombre", ((List<Dictionary<string, object>>)t["series"])[0]["NombreServicio"]);

        // Con filtros distintos entra otro servicio: el Top se calcula DESPUES de filtrar.
        var sinA = tk.Where(x => x.Servicio != "A").ToList();
        Chk("TD4 sin A (filtrado): entran B, C, D", "B=1,0,2/3;C=0,1,1/2;D=1,0,0/1",
            SerieTD(ConcentracionContrato.Tendencia(sinA, ConcentracionContrato.Pareto(sinA), rango, 3)));
        var dos = tk.Where(x => x.Servicio == "B" || x.Servicio == "C").ToList();
        Chk("TD5 menos de 3 servicios: solo los que hay", "B=1,0,2/3;C=0,1,1/2",
            SerieTD(ConcentracionContrato.Tendencia(dos, ConcentracionContrato.Pareto(dos), rango, 3)));
        var vacio = ConcentracionContrato.Tendencia(new ConcentracionTicket[0], ConcentracionContrato.Pareto(new ConcentracionTicket[0]), rango, 3);
        Chk("TD6 sin tickets: sin series, los dias del periodo y totales en 0", "|3|0,0,0",
            SerieTD(vacio) + "|" + ((List<string>)vacio["dias"]).Count + "|" + string.Join(",", ((List<int>)vacio["TicketsTotalDia"]).Select(n => n.ToString()).ToArray()));

        // Meses no seguidos: solo los dias de cada rango, sin rellenar el hueco.
        var dosRangos = new[] { new KeyValuePair<DateTime, DateTime>(new DateTime(2026, 11, 1), new DateTime(2026, 11, 2)),
                                new KeyValuePair<DateTime, DateTime>(new DateTime(2026, 9, 29), new DateTime(2026, 9, 30)) };
        var tm = new List<ConcentracionTicket> { TD("x1", "A", new DateTime(2026, 9, 30)), TD("x2", "A", new DateTime(2026, 11, 2)),
                                                 TD("x3", "A", new DateTime(2026, 10, 15)), TD("x4", "A", null) };
        var t2 = ConcentracionContrato.Tendencia(tm, ConcentracionContrato.Pareto(tm), dosRangos, 3);
        Chk("TD7 meses no seguidos: dias de los rangos en orden, sin el hueco; fuera de rango o sin dia no caen en ningun dia",
            "2026-09-29,2026-09-30,2026-11-01,2026-11-02|A=0,1,0,1/2",
            string.Join(",", ((List<string>)t2["dias"]).ToArray()) + "|" + SerieTD(t2));
    }

    // ------------------------------------------- 1b) comparacion (2026-11-18)
    static string Rangos(List<KeyValuePair<DateTime, DateTime>> r)
    {
        return string.Join(",", r.Select(x => Dia(x.Key) + ".." + Dia(x.Value)).ToArray());
    }

    static string Anterior(DateTime hoy, int slot)
    {
        var f = new ConcentracionFiltros(); f.Slot = slot;
        return Rangos(ConcentracionContrato.PeriodoAnterior(f, hoy));
    }

    static string Anterior(DateTime hoy, params string[] meses)
    {
        var f = new ConcentracionFiltros(); f.Modo = ConcentracionContrato.ModoMes;
        f.Meses.AddRange(ConcentracionContrato.LeerMeses(string.Join("|", meses), hoy)); f.Mes = f.Meses[0];
        return Rangos(ConcentracionContrato.PeriodoAnterior(f, hoy));
    }

    // "COD:actual/anterior/dif" de una lista de Cambios.
    static string Filas(object lista)
    {
        var l = lista as IEnumerable<Dictionary<string, object>>;
        if (l == null) return "null";
        return string.Join(",", l.Select(x => x["Servicio"] + ":" + x["TicketsActual"] + "/" + x["TicketsAnterior"] + "/" + x["Diferencia"]).ToArray());
    }

    static List<ConcentracionTicket> Tickets(string servicio, int cuantos, string prefijo, string categoria)
    {
        var l = new List<ConcentracionTicket>();
        for (int i = 0; i < cuantos; i++)
            l.Add(new ConcentracionTicket { Codigo = prefijo + servicio + i, Servicio = servicio, NombreServicio = servicio + " nombre", Categoria = categoria });
        return l;
    }

    static void ComparacionPura()
    {
        var hoy = new DateTime(2026, 11, 9);
        // Slot: el mismo largo, justo antes (Slot 0 = 2026-10-11..2026-11-09, QA A3).
        Chk("CP1 Slot 0: los 30 dias anteriores (= el Slot 1 de QA, A3)", "2026-09-11..2026-10-10", Anterior(hoy, 0));
        Chk("CP2 Slot N acumulado: 30(N+1) dias antes de su inicio (Slot 1 -> Slots 2-3; Slot 12 -> 390 dias)",
            "2026-07-13..2026-09-10|2024-09-21..2025-10-15", Anterior(hoy, 1) + "|" + Anterior(hoy, 12));
        var f12 = new ConcentracionFiltros(); f12.Slot = 12;
        var a12 = ConcentracionContrato.PeriodoAnterior(f12, hoy)[0];
        DateTime d12, h12; ConcentracionContrato.PeriodoAcumulado(12, hoy, out d12, out h12);
        Chk("CP3 Slot 12: mismo largo exacto y pegado al actual, sin solape", "390|390|True",
            ((a12.Value - a12.Key).Days + 1) + "|" + ((h12 - d12).Days + 1) + "|" + (a12.Value.AddDays(1) == d12));
        // Meses.
        Chk("CP4 mes en curso: los mismos dias del mes anterior", "2026-10-01..2026-10-09", Anterior(hoy, "2026-11"));
        Chk("CP5 mes cerrado: el mes anterior completo (31 y 30 dias)", "2026-09-01..2026-09-30|2026-08-01..2026-08-31",
            Anterior(hoy, "2026-10") + "|" + Anterior(hoy, "2026-09"));
        Chk("CP6 mes en curso al 31: se acota al ultimo dia del mes anterior (31 mar -> 1..28 feb); el ultimo dia del mes sigue en curso (30 nov -> 1..30 oct)",
            "2027-02-01..2027-02-28|2026-10-01..2026-10-30",
            Anterior(new DateTime(2027, 3, 31), "2027-03") + "|" + Anterior(new DateTime(2026, 11, 30), "2026-11"));
        Chk("CP7 meses seguidos: los mismos meses justo antes (Sep-Oct-Nov en curso -> Jun-Jul-Ago, Ago hasta el dia de hoy)",
            "2026-08-01..2026-08-09,2026-07-01..2026-07-31,2026-06-01..2026-06-30", Anterior(hoy, "2026-09", "2026-10", "2026-11"));
        Chk("CP8 meses NO seguidos: se conserva el patron corrido el tramo completo (Sep y Nov -> Jun y Ago; Oct/Jul no entran)",
            "2026-08-01..2026-08-09,2026-06-01..2026-06-30", Anterior(hoy, "2026-11", "2026-09"));
        Chk("CP9 los dos extremos de la lista (Oct 2026 y Nov 2025): tramo de 12 -> Oct 2025 y Nov 2024, completos",
            "2025-10-01..2025-10-31,2024-11-01..2024-11-30", Anterior(hoy, "2026-10", "2025-11"));
        Chk("CP10 cambio de año: Ene 2027 en curso -> Dic 2026 mismos dias", "2026-12-01..2026-12-05", Anterior(new DateTime(2027, 1, 5), "2027-01"));

        // La cuenta. (actual, anterior): A1 10/2 +8, A2 9/1 +8 (empate), A3 7/0 +7, A4 5/1, A5 4/1, A6 3/1, R1 1/6, R2 0/3, Z0 2/2.
        var act = new List<ConcentracionTicket>(); var ant = new List<ConcentracionTicket>();
        var datos = new[] { new { S = "A1", A = 10, P = 2 }, new { S = "A2", A = 9, P = 1 }, new { S = "A3", A = 7, P = 0 }, new { S = "A4", A = 5, P = 1 },
                            new { S = "A5", A = 4, P = 1 }, new { S = "A6", A = 3, P = 1 }, new { S = "R1", A = 1, P = 6 }, new { S = "R2", A = 0, P = 3 },
                            new { S = "Z0", A = 2, P = 2 } };
        foreach (var x in datos) { act.AddRange(Tickets(x.S, x.A, "a", "/C/" + x.S)); ant.AddRange(Tickets(x.S, x.P, "p", "/C/" + x.S)); }
        act.Add(act[0]);   // el mismo ticket dos veces cuenta uno
        var c = ConcentracionContrato.Cambios(act, ant, 5);
        Chk("CP11 aumentos: Top 5 de mayor a menor; empate por codigo (A1 antes que A2); el 6o fuera",
            "A1:10/2/8,A2:9/1/8,A3:7/0/7,A4:5/1/4,A5:4/1/3|6", Filas(c["aumentos"]) + "|" + c["serviciosAumento"]);
        Chk("CP12 reducciones: de la mas negativa a la menos; un servicio que ya no tiene tickets cuenta", "R1:1/6/-5,R2:0/3/-3|2",
            Filas(c["reducciones"]) + "|" + c["serviciosReduccion"]);
        Chk("CP13 diferencia 0 no sale (Z0); tickets distintos (repetido una vez)", "False|41|17",
            (Filas(c["aumentos"]) + Filas(c["reducciones"])).Contains("Z0") + "|" + c["ticketsActual"] + "|" + c["ticketsAnterior"]);
        var a1 = ((List<Dictionary<string, object>>)c["aumentos"])[0];
        var a3 = ((List<Dictionary<string, object>>)c["aumentos"])[2];
        var r2 = ((List<Dictionary<string, object>>)c["reducciones"])[1];
        Chk("CP14 variacion: 400.00 (+8 sobre 2), null si el anterior es 0, -100.00 si ya no hay; NombreServicio", "400.00|null|-100.00|A1 nombre",
            ((decimal)a1["VariacionPorcentaje"]).ToString("0.00", CultureInfo.InvariantCulture) + "|" + (a3["VariacionPorcentaje"] ?? "null") + "|" +
            ((decimal)r2["VariacionPorcentaje"]).ToString("0.00", CultureInfo.InvariantCulture) + "|" + a1["NombreServicio"]);
        // Mismo servicio en dos ramas de categoria (cambio de rama): UNA entrada.
        var ramaNueva = Tickets("PU", 5, "a", "/S-Aplicativos Punto de Venta/Caja/X");
        var ramaVieja = Tickets("PU", 4, "p", "/S-Punto de Venta/Caja/X");
        ramaVieja.AddRange(Tickets("pu ", 1, "q", "/S-Punto de Venta/Caja/Y"));   // codigo con otra caja y espacio: el mismo servicio
        var cr = ConcentracionContrato.Cambios(ramaNueva, ramaVieja, 5);
        Chk("CP15 un servicio que cambia de rama es UNA entrada por codigo (5 vs 5 = sin cambio); sin la rama vieja seria +5",
            "||0|0", Filas(cr["aumentos"]) + "|" + Filas(cr["reducciones"]) + "|" + cr["serviciosAumento"] + "|" + cr["serviciosReduccion"]);
        cr = ConcentracionContrato.Cambios(ramaNueva, ramaVieja.Take(3), 5);
        Chk("CP16 ... y con 3 anteriores: PU +2, una sola fila", "PU:5/3/2", Filas(cr["aumentos"]));
        var vacio = ConcentracionContrato.Cambios(new ConcentracionTicket[0], new ConcentracionTicket[0], 5);
        Chk("CP17 vacio: listas vacias (no null) y cero tickets", "||0|0|0|0",
            Filas(vacio["aumentos"]) + "|" + Filas(vacio["reducciones"]) + "|" + vacio["serviciosAumento"] + "|" + vacio["serviciosReduccion"] + "|" +
            vacio["ticketsActual"] + "|" + vacio["ticketsAnterior"]);
        var sinCodigo = new List<ConcentracionTicket> { new ConcentracionTicket { Codigo = "x", Servicio = null }, new ConcentracionTicket { Codigo = "y", Servicio = "  " } };
        Chk("CP18 tickets sin codigo de servicio no cuentan (como el Pareto)", "|0", Filas(ConcentracionContrato.Cambios(sinCodigo, new ConcentracionTicket[0], 5)["aumentos"]) + "|" +
            ConcentracionContrato.Cambios(sinCodigo, new ConcentracionTicket[0], 5)["ticketsActual"]);
        var empates = new List<ConcentracionTicket>();
        foreach (var s in new[] { "E5", "E1", "E4", "E2", "E6", "E3" }) empates.AddRange(Tickets(s, 2, "a", "/C"));
        Chk("CP19 seis empatados: el corte del Top 5 es estable por codigo", "E1,E2,E3,E4,E5|6",
            string.Join(",", ((List<Dictionary<string, object>>)ConcentracionContrato.Cambios(empates, new ConcentracionTicket[0], 5)["aumentos"])
                .Select(x => (string)x["Servicio"]).ToArray()) + "|" + ConcentracionContrato.Cambios(empates, new ConcentracionTicket[0], 5)["serviciosAumento"]);
        VentanaPura();
    }

    // "historiaDesde|porLado|L|valida|actual|anterior"
    static string Ventana(ICollection<DateTime> dias, DateTime desde, DateTime fin, DateTime hoy, int pedidos)
    {
        var v = ConcentracionContrato.VentanaComparable(dias, desde, fin, hoy, pedidos);
        return Dia(v.HistoriaDesde) + "|" + v.DiasPorLado + "|" + v.Dias + "|" + v.Valida + "|" +
               Dia(v.Actual.Key) + ".." + Dia(v.Actual.Value) + "|" + Dia(v.Anterior.Key) + ".." + Dia(v.Anterior.Value);
    }

    static HashSet<DateTime> DiasDesde(DateTime desde, DateTime hasta, params DateTime[] sueltos)
    {
        var s = new HashSet<DateTime>(sueltos);
        for (var d = desde; d <= hasta; d = d.AddDays(1)) s.Add(d);
        return s;
    }

    /* Ventana maxima comparable con la historia REAL de QA (diag
       DIAG_Concentracion_CoberturaDiaria, 2026-11-18): diez tickets sueltos
       del 2025-08-19 al 2025-11-28 y despues todos los dias desde 2025-12-01. */
    static void VentanaPura()
    {
        var hoy = new DateTime(2026, 11, 18);
        var sueltos = new[] { "2025-08-19", "2025-08-30", "2025-09-12", "2025-10-09", "2025-10-21", "2025-10-29", "2025-11-03", "2025-11-07", "2025-11-19", "2025-11-28" }
            .Select(x => DateTime.ParseExact(x, "yyyy-MM-dd", CultureInfo.InvariantCulture)).ToArray();
        var qa = DiasDesde(new DateTime(2025, 12, 1), hoy, sueltos);
        Chk("CV1 Slot 12 en QA: la historia continua empieza el 2025-12-01 (los sueltos no cuentan); 353 dias -> 176 por lado -> 175 (25 semanas)",
            "2025-12-01|176|175|True|2026-05-28..2026-11-18|2025-12-04..2026-05-27",
            Ventana(qa, new DateTime(2024, 9, 30), hoy, hoy, 390));
        Chk("CV2 Slot 5 (180 dias, su anterior empieza el 2025-11-24): la misma ventana de 175", "2025-12-01|176|175|True|2026-05-28..2026-11-18|2025-12-04..2026-05-27",
            Ventana(qa, new DateTime(2025, 11, 24), hoy, hoy, 180));
        Chk("CV3 Dic-Feb seguidos (90 dias, fin 2026-02-28): 90 cubiertos -> 45 -> 42", "2025-12-01|45|42|True|2026-01-18..2026-02-28|2025-12-07..2026-01-17",
            Ventana(qa, new DateTime(2025, 9, 1), new DateTime(2026, 2, 28), hoy, 90));
        Chk("CV4 solo Dic 2025: 31 cubiertos -> 14, menos de 28 -> no valida", "2025-12-01|15|14|False",
            string.Join("|", Ventana(qa, new DateTime(2025, 11, 1), new DateTime(2025, 12, 31), hoy, 31).Split('|').Take(4).ToArray()));
        var conHueco = DiasDesde(new DateTime(2025, 12, 1), hoy); conHueco.Remove(new DateTime(2026, 3, 10));
        Chk("CV5 un dia sin ningun ticket dentro de la historia la corta: empieza el dia siguiente", "2026-03-11|126|126|True",
            string.Join("|", Ventana(conHueco, new DateTime(2024, 9, 30), hoy, hoy, 390).Split('|').Take(4).ToArray()));
        var sinHoy = DiasDesde(new DateTime(2025, 12, 1), hoy.AddDays(-1));
        Chk("CV6 hoy sin tickets todavia no es hueco (dia en curso)", "2025-12-01|176|175|True",
            string.Join("|", Ventana(sinHoy, new DateTime(2024, 9, 30), hoy, hoy, 390).Split('|').Take(4).ToArray()));
        Chk("CV7 lo pedido limita: 60 dias pedidos con historia de sobra -> 56 (8 semanas), no 175", "56|True",
            string.Join("|", Ventana(qa, new DateTime(2025, 11, 1), hoy, hoy, 60).Split('|').Skip(2).Take(2).ToArray()));
        var desdeOct = DiasDesde(new DateTime(2026, 10, 1), new DateTime(2026, 12, 31));
        Chk("CV8 a semanas completas: 58 cubiertos -> 29 por lado -> 28 (valida); 54 -> 27 -> 21 (no)", "29|28|True|27|21|False",
            string.Join("|", Ventana(desdeOct, new DateTime(2026, 1, 1), new DateTime(2026, 11, 27), new DateTime(2026, 11, 28), 90).Split('|').Skip(1).Take(3).ToArray()) + "|" +
            string.Join("|", Ventana(desdeOct, new DateTime(2026, 1, 1), new DateTime(2026, 11, 23), new DateTime(2026, 11, 24), 90).Split('|').Skip(1).Take(3).ToArray()));
        var f = new ConcentracionFiltros { Modo = ConcentracionContrato.ModoMes };
        f.Meses.AddRange(ConcentracionContrato.LeerMeses("2026-02|2025-12|2026-01", hoy));
        var g = new ConcentracionFiltros { Modo = ConcentracionContrato.ModoMes };
        g.Meses.AddRange(ConcentracionContrato.LeerMeses("2026-02|2025-12", hoy));
        Chk("CV9 continuidad: Slot si; Dic-Ene-Feb si; Dic y Feb (sin Ene) no", "True|True|False",
            ConcentracionContrato.SeleccionContinua(new ConcentracionFiltros { Slot = 12 }) + "|" + ConcentracionContrato.SeleccionContinua(f) + "|" + ConcentracionContrato.SeleccionContinua(g));
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
-- C1&C2: el cuerpo EXACTO de QA (2026-11-11), el que replica
-- ConcentracionContrato.C1C2. Fuente verificada por largo + SHA2_256 contra
-- QA: LOCALDB_PERMISSION_CHANGES/scripts/dev_db/10_cadena_volumetria.sql
-- (fn_NormalizaCategoria 0xB941C3CD..., fn_CategoriaC1C2 0x2ACA8E0A...).
CREATE   FUNCTION dbo.fn_NormalizaCategoria (@Categoria NVARCHAR(500))
RETURNS NVARCHAR(500)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(500) = LTRIM(RTRIM(REPLACE(ISNULL(@Categoria,N''), NCHAR(160), N' ')));
    RETURN @s;
END;
GO
CREATE   FUNCTION dbo.fn_CategoriaC1C2 (@Categoria NVARCHAR(500))
RETURNS NVARCHAR(500)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(500) = dbo.fn_NormalizaCategoria(@Categoria);
    DECLARE @p1 INT, @p2 INT, @p3 INT;

    IF @s = N'' RETURN N'';
    IF LEFT(@s,1) <> N'/' SET @s = N'/' + @s;

    SET @p1 = 1;
    SET @p2 = CHARINDEX(N'/', @s, @p1 + 1);
    IF @p2 = 0 RETURN @s;

    SET @p3 = CHARINDEX(N'/', @s, @p2 + 1);
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
 (N'U02', N'SAP', N'SAP', N'/SAP/Alta', N'Soporte AMS Inetum', 1),
 -- Slots 2 y 3 (2026-11-10, Slot acumulado): 3 + 1.
 (N'V01', N'PU',  N'S-Punto de Venta', N'/S-Punto de Venta/Caja/Falla', N'Service Desk', 2),
 (N'V02', N'PU',  N'S-Punto de Venta', N'/S-Punto de Venta/Caja/Falla', N'Service Desk', 2),
 (N'V03', N'WMS', N'S-FENIX WMS', N'/S-FENIX WMS/Recibo/Cita', N'Soporte Fenix_WMS', 2),
 (N'W01', N'SAP', N'SAP', N'/SAP/Alta', N'Soporte AMS Inetum', 3);
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
        var tend = (Dictionary<string, object>)d["tendencia"];
        Chk("tendencia sin filtros: Top 3 del Pareto, un valor por dia del Slot 0 (30)", "PU,EQC,WMS|30|30",
            Col(Lista(tend["series"]), "Servicio") + "|" + ((object[])tend["dias"]).Length + "|" + ((object[])tend["TicketsTotalDia"]).Length);

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
        Chk("Grupo: la tendencia sigue al filtro (sus series = el Top del Pareto filtrado, sumas = cantidades)",
            Col(Lista(d["pareto"]).Take(3).ToList(), "Servicio") + "|" + Col(Lista(d["pareto"]).Take(3).ToList(), "CantidadTickets"),
            Col(Lista(((Dictionary<string, object>)d["tendencia"])["series"]), "Servicio") + "|" +
            string.Join(",", Lista(((Dictionary<string, object>)d["tendencia"])["series"]).Select(x => ((object[])x["TicketsServicio"]).Sum(n => Convert.ToInt32(n)).ToString()).ToArray()));
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
        Chk("slot 1 con mes en la URL: manda el slot (Slots 0 y 1: 12 + 2)", "slot|1|null|14", d["modo"] + "|" + d["slot"] + "|" + (d["mes"] ?? "null") + "|" + d["ticketsPeriodo"]);

        // --- Slot ACUMULADO (2026-11-10): Slot N = Slots 0..N, cada frontera.
        var acum = new List<string>();
        for (int n = 0; n <= 4; n++)
        {
            d = Pedir("slot=" + n, out estado);
            DateTime ad, ah;
            ConcentracionContrato.PeriodoAcumulado(n, hoy, out ad, out ah);
            int directoN = Escalar(cadena, "SELECT COUNT(*) FROM dbo.vw_ServicioTickets WHERE Slot BETWEEN 0 AND " + n);
            var pn = (Dictionary<string, object>)d["periodo"];
            var di = (Dictionary<string, object>)d["dataInfo"];
            acum.Add(n + ":" + d["ticketsPeriodo"] + "=" + directoN + "|" + (pn["desde"] + ".." + pn["hasta"] == Dia(ad) + ".." + Dia(ah)) +
                     "|" + (di["periodoInicio"] + ".." + di["periodoFin"] == Dia(ad) + ".." + Dia(ah)) + "|" + pn["dias"] + "|" + Totales(d));
        }
        Chk("P1 Slot N = Slots 0..N (12, 14, 17, 18, 18); periodo y dataInfo = hoy-(30N+29)..hoy; las tres graficas y los totales con el mismo",
            "0:12=12|True|True|30|12|11|11|12/12;1:14=14|True|True|60|14|13|13|14/14;2:17=17|True|True|90|17|16|16|17/17;" +
            "3:18=18|True|True|120|18|17|17|18/18;4:18=18|True|True|150|18|17|17|18/18", string.Join(";", acum.ToArray()));
        d = Pedir("slot=2&so=" + HttpUtility.UrlEncode(ConcentracionContrato.SinServiceOwner), out estado);
        Chk("P2 Slot 2 con filtro Sin SO: 6 del Slot 0 + U02 + V03 (V01/V02 son de Beto por su C1); las tres graficas sobre los Slots 0..2", "8|7|8|8/17", Totales(d));
        d = Pedir("slot=12", out estado);
        DateTime d12, h12;
        ConcentracionContrato.PeriodoAcumulado(12, hoy, out d12, out h12);
        Chk("P3 Slot 12 (el maximo): Slots 0..12, 390 dias", "200|18|390|" + Dia(d12) + ".." + Dia(h12),
            estado + "|" + d["ticketsPeriodo"] + "|" + ((Dictionary<string, object>)d["periodo"])["dias"] + "|" +
            ((Dictionary<string, object>)d["periodo"])["desde"] + ".." + ((Dictionary<string, object>)d["periodo"])["hasta"]);

        // --- VARIOS meses (2026-11-10): la union, aunque no sean seguidos.
        var m0 = new DateTime(hoy.Year, hoy.Month, 1);
        Func<DateTime, int> enMes = m => Escalar(cadena, "SELECT COUNT(*) FROM dbo.vw_ServicioTickets WHERE FechaRegistro >= '" + Dia(m) +
            "' AND FechaRegistro < '" + Dia(m.AddMonths(1) > hoy.AddDays(1) ? hoy.AddDays(1) : m.AddMonths(1)) + "'");
        string sm0 = ConcentracionContrato.Mes(m0), sm1 = ConcentracionContrato.Mes(m0.AddMonths(-1)),
               sm2 = ConcentracionContrato.Mes(m0.AddMonths(-2)), sm3 = ConcentracionContrato.Mes(m0.AddMonths(-3));
        int c0 = enMes(m0), c1 = enMes(m0.AddMonths(-1)), c2 = enMes(m0.AddMonths(-2)), c3 = enMes(m0.AddMonths(-3));
        Func<Dictionary<string, object>, string> mesesDe = x =>
            string.Join(",", ((object[])x["mesesElegidos"]).Select(v => (string)v).ToArray()) + "|" + x["ticketsPeriodo"] + "|" +
            ((object[])((Dictionary<string, object>)x["periodo"])["rangos"]).Length + "|" + Totales(x).Split('|')[3];
        var pasos = new List<string>();
        d = Pedir("modo=mes&mes=" + sm0, out estado); pasos.Add(mesesDe(d));                              // uno
        d = Pedir("modo=mes&mes=" + sm0 + "|" + sm2, out estado); pasos.Add(mesesDe(d));                  // agregar uno no seguido
        d = Pedir("modo=mes&mes=" + sm0 + "|" + sm2 + "|" + sm1, out estado); pasos.Add(mesesDe(d));      // agregar el de en medio
        d = Pedir("modo=mes&mes=" + sm2 + "|" + sm1, out estado); pasos.Add(mesesDe(d));                  // quitar el en curso
        d = Pedir("modo=mes&mes=" + sm1, out estado); pasos.Add(mesesDe(d));                              // quitar otro
        Chk("P4 meses: uno, agregar, agregar, quitar, quitar = la suma de los conteos directos de cada mes (rangos, totales)",
            sm0 + "|" + c0 + "|1|" + c0 + "/" + c0 + ";" +
            sm0 + "," + sm2 + "|" + (c0 + c2) + "|2|" + (c0 + c2) + "/" + (c0 + c2) + ";" +
            sm0 + "," + sm1 + "," + sm2 + "|" + (c0 + c1 + c2) + "|3|" + (c0 + c1 + c2) + "/" + (c0 + c1 + c2) + ";" +
            sm1 + "," + sm2 + "|" + (c1 + c2) + "|2|" + (c1 + c2) + "/" + (c1 + c2) + ";" +
            sm1 + "|" + c1 + "|1|" + c1 + "/" + c1, string.Join(";", pasos.ToArray()));
        Chk("P5 los meses del fixture no estan vacios (la prueba distingue)", true, c0 > 0 && c1 + c2 + c3 > 0);
        d = Pedir("modo=mes&mes=" + sm2 + "|" + sm0 + "|" + sm2 + "|", out estado);
        var pm = (Dictionary<string, object>)d["periodo"];
        DateTime x0d, x0h, x2d, x2h;
        ConcentracionContrato.PeriodoMes(m0, hoy, out x0d, out x0h);
        ConcentracionContrato.PeriodoMes(m0.AddMonths(-2), hoy, out x2d, out x2h);
        var rg = ((object[])pm["rangos"]).Select(o => (Dictionary<string, object>)o).Select(o => o["desde"] + ".." + o["hasta"]).ToArray();
        var cobM = (Dictionary<string, object>)d["cobertura"];
        Chk("P6 orden y repetidos no importan; mes = el mas reciente; rangos por mes (sin el de en medio); dias y cobertura = suma de los meses",
            sm0 + "|" + sm0 + "," + sm2 + "|" + Dia(x0d) + ".." + Dia(x0h) + "," + Dia(x2d) + ".." + Dia(x2h) + "|" +
            ((x0h - x0d).Days + 1 + (x2h - x2d).Days + 1) + "|" +
            (ConcentracionContrato.DiasEsperados(x0d, x0h, hoy) + ConcentracionContrato.DiasEsperados(x2d, x2h, hoy)) + "|" +
            Dia(x2d) + ".." + Dia(x0h),
            d["mes"] + "|" + string.Join(",", ((object[])d["mesesElegidos"]).Select(v => (string)v).ToArray()) + "|" + string.Join(",", rg) + "|" +
            pm["dias"] + "|" + cobM["diasEsperados"] + "|" + pm["desde"] + ".." + pm["hasta"]);
        d = Pedir("modo=mes&mes=" + sm0 + "|" + sm2 + "&so=" + HttpUtility.UrlEncode(ConcentracionContrato.SinServiceOwner), out estado);
        var t3 = Totales(d).Split('|');
        Chk("P7 varios meses con filtro: pareto, categorias, grupos y filtrados salen del mismo conjunto",
            true, int.Parse(t3[3].Split('/')[1]) == c0 + c2 && int.Parse(t3[3].Split('/')[0]) <= c0 + c2);
        Chk("P8 un mes invalido en la lista = 400 para toda la peticion; vacio = el actual", "400|200|" + sm0,
            Estado("modo=mes&mes=" + sm0 + "|2001-01") + "|" + Estado("modo=mes&mes=|") + "|" + Pedir("modo=mes&mes=|", out estado)["mes"]);
        d = Pedir("modo=slot&slot=2&mes=" + sm0 + "|" + sm2, out estado);
        Chk("P9 de Mes a Slot: la lista de meses se ignora (Slots 0..2), sin mesesElegidos", "slot|2|17|null|null",
            d["modo"] + "|" + d["slot"] + "|" + d["ticketsPeriodo"] + "|" + (d["mes"] ?? "null") + "|" + (d["mesesElegidos"] ?? "null"));
        d = Pedir("modo=mes&mes=" + sm0 + "|" + sm2 + "&slot=3", out estado);
        Chk("P10 de Slot a Mes: el slot se ignora", "mes|null|" + (c0 + c2), d["modo"] + "|" + (d["slot"] ?? "null") + "|" + d["ticketsPeriodo"]);

        // --- Parametros invalidos.
        Chk("400: slot 13, mes fuera de rango, modo raro", "400|400|400",
            Estado("slot=13") + "|" + Estado("modo=mes&mes=2001-01") + "|" + Estado("modo=semana"));

        // --- Cache: un ticket nuevo no se ve hasta limpiarla.
        Lotes(cadena, "INSERT dbo.vw_ServicioTickets (CodigoTicket, Servicio, RamaServicio, Categoria, Grupo, Slot) VALUES (N'U03', N'SAP', N'SAP', N'/SAP/Alta', N'G', 1);");
        d = Pedir("slot=1", out estado);
        Chk("cache: mismo periodo, mismo dato (5 min)", "14", d["ticketsPeriodo"]);
        ConcentracionQueries.LimpiarCache();
        d = Pedir("slot=1", out estado);
        Chk("cache limpia: dato nuevo", "15", d["ticketsPeriodo"]);

        // --- 2026-11-11: C1&C2 sin UDF por fila, cache por mes, Server-Timing.
        C1C2Paridad(cadena);
        CachePorMes(cadena, hoy);
        ServerTiming(cadena, hoy);
        ComparacionSql(cadena, hoy);

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

    // ------------------------------------------------- 2b) rendimiento (2026-11-11)
    static string Cs(int c) { return char.ConvertFromUtf32(c); }
    static string Recortar(string t) { if (t == null) return null; t = t.Trim(); return t.Length == 0 ? null : t; }
    static string V(string c) { return ConcentracionContrato.C1C2Verificable(c).ToString(); }

    /* C1&C2 en C# contra dbo.fn_CategoriaC1C2 con el texto EXACTO de QA (el
       del Esquema). La comparacion es sobre lo que la pestaña usa:
       Recortar(fn(Categoria)) contra Recortar(C1C2(LTRIM(RTRIM(Categoria)))). */
    static void C1C2Paridad(string cadena)
    {
        Chk("C1C2Verificable: ASCII, tab/CR/LF, Latin-1 y NULL si; U+00AD, U+FF0F, U+0000, U+3000, U+0301 no",
            "True|True|True|True|False|False|False|False|False",
            V("/S-Punto de Venta/Caja") + "|" + V("\t/A\r\n") + "|" + V("/" + Cs(0xD1) + "and" + Cs(0xFA) + Cs(0xA0)) + "|" + V(null) + "|" +
            V("/A" + Cs(0xAD)) + "|" + V("/A" + Cs(0xFF0F) + "B") + "|" + V(Cs(0)) + "|" + V(Cs(0x3000)) + "|" + V("/a" + Cs(0x301)));
        Chk("C1C2 puro: ejemplos de la cabecera de la funcion, sin '/' inicial, un nivel, NULL, vacio, NBSP",
            "/S-Punto de Venta/Aplicativo|/Procesos comerciales de tienda (SAP)/|/A/B|/A|||/A/B",
            ConcentracionContrato.C1C2("/S-Punto de Venta/Aplicativo/Error X") + "|" + ConcentracionContrato.C1C2("/Procesos comerciales de tienda (SAP)/") + "|" +
            ConcentracionContrato.C1C2("A/B/C") + "|" + ConcentracionContrato.C1C2("A") + "|" + ConcentracionContrato.C1C2(null) + "|" +
            ConcentracionContrato.C1C2("  ") + "|" + ConcentracionContrato.C1C2(Cs(0xA0) + "/A/B/C" + Cs(0xA0)));

        // El banco: casos a mano (comunes, raros y de frontera), cada caracter
        // del conjunto verificable en varias posiciones y al azar (semilla fija).
        var lista = new List<string> { null, "", " ", "   ", Cs(0xA0), " " + Cs(0xA0) + " ", "\t", "\r\n", "/", "//", "///", "////x",
            "/A", "A", "A/B", "A/B/C", "/A/B", "/A/B/C", "/A/B/C/D", " /A/B/C ", "\t/A/B/C", "/A/B/\t", "/A /B /C", "/a/b/c",
            "/S-Punto de Venta/Aplicativo/Error X", "/Procesos comerciales de tienda (SAP)/", "/S-FENIX WMS/Recibo/Cita",
            new string('x', 500), "/" + new string('x', 499), new string('x', 498) + "/y", new string('x', 499) + "/", "x/" + new string('y', 498),
            "/" + new string(' ', 498) + "x", "A/B" + new string(' ', 497),
            // raros: la collation no compara caracter a caracter
            "/A" + Cs(0xFF0F) + "B/C/D", Cs(0xFF0F) + "A/B/C", "/A/" + Cs(0xFF0F) + "B/C", Cs(0x200B) + "/A/B/C", "/A" + Cs(0x200B) + "/B/C",
            Cs(0xAD) + "/A/B", "/A" + Cs(0xAD) + "/B/C", "/a" + Cs(0x301) + "/B/C", "/" + Cs(0x1F600) + "/B/C", Cs(0) + "/A", Cs(0), Cs(0x3000),
            Cs(0x3000) + "/A/B", "/A/B" + Cs(0x3000) + "/C", Cs(0x2215) + "A/B/C", "/x" + Cs(0xA0) + Cs(0x301) + "/y/z" };
        var seguro = new System.Text.StringBuilder("\t\r\n");
        for (int c = 0x20; c <= 0x7E; c++) seguro.Append((char)c);
        for (int c = 0xA0; c <= 0xFF; c++) if (c != 0xAD) seguro.Append((char)c);
        foreach (char c0 in seguro.ToString())
        {
            string q = c0.ToString();
            lista.AddRange(new[] { q, q + "/", "/" + q, q + "/x/y", "/" + q + "/x/y", "/x" + q + "/y/z", "/x/" + q + "/z", " " + q + " ", q + "/" + q + "/" + q + "/" + q });
        }
        var azar = new Random(20261111);
        string alfabeto = seguro + "//////    ";
        for (int i = 0; i < 4000; i++)
        {
            var b = new System.Text.StringBuilder(); int n = azar.Next(0, 60);
            for (int k = 0; k < n; k++) b.Append(alfabeto[azar.Next(alfabeto.Length)]);
            lista.Add(b.ToString());
        }
        string raro = "/ /abA" + Cs(0xFF0F) + Cs(0x200B) + Cs(0xAD) + Cs(0x301) + Cs(0x3000) + Cs(0x2215) + Cs(0) + Cs(0xA0);
        for (int i = 0; i < 1000; i++)
        {
            var b = new System.Text.StringBuilder(); int n = azar.Next(1, 14);
            for (int k = 0; k < n; k++) b.Append(raro[azar.Next(raro.Length)]);
            lista.Add(b.ToString());
        }

        Lotes(cadena, "CREATE TABLE dbo.ParidadC1C2 (Id INT NOT NULL PRIMARY KEY, Categoria NVARCHAR(500) NULL);");
        var dt = new System.Data.DataTable();
        dt.Columns.Add("Id", typeof(int)); dt.Columns.Add("Categoria", typeof(string));
        for (int i = 0; i < lista.Count; i++) dt.Rows.Add(i, (object)lista[i] ?? DBNull.Value);
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            using (var bc = new SqlBulkCopy(cn)) { bc.DestinationTableName = "dbo.ParidadC1C2"; bc.WriteToServer(dt); }
        }
        var cats = new List<string>(); var fn = new List<string>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("SELECT Id, LTRIM(RTRIM(Categoria)), dbo.fn_CategoriaC1C2(Categoria) FROM dbo.ParidadC1C2 ORDER BY Id;", cn))
        {
            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) { cats.Add(rd.IsDBNull(1) ? null : rd.GetString(1)); fn.Add(rd.IsDBNull(2) ? null : rd.GetString(2)); }
        }
        Lotes(cadena, "DROP TABLE dbo.ParidadC1C2;");

        int verificables = 0, difCs = 0, difSinGuarda = 0, difPestana = 0;
        string primera = null;
        int enCs, enSql;
        var mapa = ConcentracionQueries.C1C2DeCategorias(cadena, cats, out enCs, out enSql);
        var rarasDistintas = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < cats.Count; i++)
        {
            var esperado = Recortar(fn[i]);
            var cs = Recortar(ConcentracionContrato.C1C2(cats[i]));
            if (ConcentracionContrato.C1C2Verificable(cats[i]))
            {
                verificables++;
                if (cs != esperado) { difCs++; if (primera == null) primera = "#" + i; }
            }
            else
            {
                rarasDistintas.Add(cats[i]);
                if (cs != esperado) difSinGuarda++;
            }
            var pestana = Recortar(cats[i] == null ? ConcentracionContrato.C1C2(null) : mapa[cats[i]]);
            if (pestana != esperado) difPestana++;
        }
        Chk("C1C2 en C# = dbo.fn_CategoriaC1C2 (texto de QA) en todo texto verificable (" + verificables + " cadenas)",
            "0", difCs + (primera == null ? "" : " primera " + primera));
        Chk("banco suficiente: mas de 5000 verificables y mas de 100 raras distintas", true, verificables > 5000 && rarasDistintas.Count > 100);
        Chk("sin la guarda, la replica fallaria en texto raro (la prueba distingue)", true, difSinGuarda > 0);
        Chk("lo que usa la pestaña (C# + funcion real para lo raro) = la funcion en TODAS (" + cats.Count + ")", 0, difPestana);
        Chk("las raras van a la funcion real, una vez cada distinta; las demas en C#, una vez cada distinta",
            rarasDistintas.Count + "|" + new HashSet<string>(cats.Where(c => c != null && ConcentracionContrato.C1C2Verificable(c)), StringComparer.Ordinal).Count,
            enSql + "|" + enCs);

        // --- De punta a punta, con tickets raros en el Slot 6 y un dueño para
        // el C1&C2 que solo la collation reconoce.
        Lotes(cadena, "INSERT dbo.CatCategoriaDueno VALUES (N'/S-Punto de Venta' + NCHAR(65295) + N'Caja', N'PO 3', N'Carla SO', N'Dir 1', N'/S-Punto de Venta', 1);\n" +
            "INSERT dbo.CatPersona VALUES (N'Carla SO', N'Mgr', 1);\n" +
            "DECLARE @h DATE = CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME()));\n" +
            "INSERT dbo.vw_ServicioTickets (CodigoTicket, Servicio, RamaServicio, C1Raiz, Categoria, Grupo, Slot, FechaRegistro, FechaRegistroDia) VALUES\n" +
            " (N'X01', N'PU', N'S-Punto de Venta', N'S-Punto de Venta', N'/S-Punto de Venta' + NCHAR(65295) + N'Caja/X', N'Service Desk', 6, DATEADD(HOUR, 9, CONVERT(DATETIME2(0), DATEADD(DAY, -181, @h))), DATEADD(DAY, -181, @h)),\n" +
            " (N'X02', N'PU', N'S-Punto de Venta', N'S-Punto de Venta', N'/S-Punto de Venta' + NCHAR(65295) + N'Caja/X', N'Service Desk', 6, DATEADD(HOUR, 9, CONVERT(DATETIME2(0), DATEADD(DAY, -182, @h))), DATEADD(DAY, -182, @h)),\n" +
            " (N'X03', N'PU', N'S-Punto de Venta', N'S-Punto de Venta', N'/S-Punto de Venta/Caja/Y', N'Service Desk', 6, DATEADD(HOUR, 9, CONVERT(DATETIME2(0), DATEADD(DAY, -183, @h))), DATEADD(DAY, -183, @h)),\n" +
            " (N'X04', N'SAP', N'SAP', NULL, N' ' + NCHAR(12288), N'Soporte AMS Inetum', 6, DATEADD(HOUR, 9, CONVERT(DATETIME2(0), DATEADD(DAY, -184, @h))), DATEADD(DAY, -184, @h));");
        ConcentracionQueries.LimpiarCache();
        var hoy = ConcentracionContrato.HoyMexico(DateTime.UtcNow);
        var f6 = new ConcentracionFiltros(); f6.Slot = 6;
        var r6 = ConcentracionQueries.Consultar(f6, hoy);
        int distintas = Escalar(cadena, "SELECT COUNT(DISTINCT LTRIM(RTRIM(Categoria)) COLLATE Latin1_General_BIN2) FROM dbo.vw_ServicioTickets WHERE Slot BETWEEN 0 AND 6;");
        Chk("C1C2 una vez por categoria DISTINTA (no por ticket): calculos = distintas < tickets; las 2 raras (U+FF0F y U+3000), con la funcion",
            distintas + "|2|True", (r6.C1C2EnCSharp + r6.C1C2EnSql) + "|" + r6.C1C2EnSql + "|" + (r6.C1C2EnCSharp + r6.C1C2EnSql < r6.TicketsPeriodo));

        // Referencia: el camino de ANTES (fn_CategoriaC1C2 en el SELECT, por
        // fila), con el mismo directorio y la misma cuenta.
        var viejo = new List<ConcentracionTicket>();
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            var cmd = new SqlCommand(@"SELECT v.CodigoTicket, LTRIM(RTRIM(v.Servicio)), LTRIM(RTRIM(s.Descripcion)), LTRIM(RTRIM(v.Categoria)),
                LTRIM(RTRIM(v.Grupo)), v.C1Raiz, dbo.fn_CategoriaC1C2(v.Categoria), v.FechaRegistroDia
                FROM dbo.vw_ServicioTickets AS v LEFT JOIN dbo.CatServicioCorreo AS s ON s.Servicio = v.Servicio
                WHERE v.Slot >= 0 AND v.Slot <= 6;", cn);
            Func<System.Data.IDataRecord, int, string> tx = (rd, i) => rd.IsDBNull(i) ? null : Recortar(Convert.ToString(rd.GetValue(i), CultureInfo.InvariantCulture));
            using (var rd = cmd.ExecuteReader())
                while (rd.Read())
                    viejo.Add(new ConcentracionTicket { Codigo = tx(rd, 0), Servicio = tx(rd, 1), NombreServicio = tx(rd, 2), Categoria = tx(rd, 3),
                        Grupo = tx(rd, 4), C1 = tx(rd, 5), C1C2 = tx(rd, 6), Dia = rd.IsDBNull(7) ? (DateTime?)null : rd.GetDateTime(7) });
            var dir = DirectorioOrganizacional.Cargar(cn);
            foreach (var t in viejo)
            {
                string po, so, di, ma;
                dir.Resolver(t.C1, t.C1C2, out po, out so, out di, out ma);
                t.ServiceOwner = string.IsNullOrWhiteSpace(so) ? null : so;
            }
        }
        var js = new JavaScriptSerializer();
        Func<List<ConcentracionTicket>, ConcentracionFiltros, string> cuenta = (tk, fl) =>
        {
            var fi = ConcentracionContrato.Filtrar(tk, fl);
            return js.Serialize(new object[] {
                ConcentracionContrato.Opciones(tk.ConvertAll(t => t.ServiceOwner ?? ConcentracionContrato.SinServiceOwner), fl.ServiceOwners),
                ConcentracionContrato.Pareto(fi), ConcentracionContrato.Categorias(fi), ConcentracionContrato.Grupos(fi), fi.Count });
        };
        Func<ConcentracionResultado, string> nueva = x => js.Serialize(new object[] { x.OpcionesServiceOwner, x.Pareto, x.Categorias, x.Grupos, x.TicketsFiltrados });
        Chk("salida sin filtro = la del camino con fn_CategoriaC1C2 por fila (opciones SO, pareto, categorias, grupos)", cuenta(viejo, f6), nueva(r6));
        var fc = new ConcentracionFiltros(); fc.Slot = 6; fc.ServiceOwners.Add("Carla SO");
        var rc = ConcentracionQueries.Consultar(fc, hoy);
        Chk("SO del C1&C2 raro (Carla, 2 tickets) = el camino de antes", cuenta(viejo, fc) + "|2", nueva(rc) + "|" + rc.TicketsFiltrados);

        Lotes(cadena, "DELETE dbo.vw_ServicioTickets WHERE CodigoTicket IN (N'X01', N'X02', N'X03', N'X04');\n" +
                      "DELETE dbo.CatCategoriaDueno WHERE ServiceOwner = N'Carla SO'; DELETE dbo.CatPersona WHERE Nombre = N'Carla SO';");
        ConcentracionQueries.LimpiarCache();
    }

    static ConcentracionResultado Meses(string meses, DateTime hoy, params string[] so)
    {
        var f = new ConcentracionFiltros();
        f.Modo = ConcentracionContrato.ModoMes;
        f.Meses.AddRange(ConcentracionContrato.LeerMeses(meses, hoy));
        f.Mes = f.Meses[0];
        f.ServiceOwners.AddRange(so);
        return ConcentracionQueries.Consultar(f, hoy);
    }

    // consultas|tramos leidos|de cache|de otra peticion
    static string Uso(ConcentracionResultado r)
    {
        return r.ConsultasPeriodo + "|" + r.TramosSql + "|" + r.TramosCache + "|" + r.TramosEspera;
    }

    static void CachePorMes(string cadena, DateTime hoy)
    {
        var m0 = new DateTime(hoy.Year, hoy.Month, 1);
        string a = ConcentracionContrato.Mes(m0), b = ConcentracionContrato.Mes(m0.AddMonths(-1)),
               c = ConcentracionContrato.Mes(m0.AddMonths(-2)), d = ConcentracionContrato.Mes(m0.AddMonths(-3));
        Func<DateTime, int> directo = m => Escalar(cadena, "SELECT COUNT(*) FROM dbo.vw_ServicioTickets WHERE FechaRegistro >= '" + Dia(m) +
            "' AND FechaRegistro < '" + Dia(m.AddMonths(1) > hoy.AddDays(1) ? hoy.AddDays(1) : m.AddMonths(1)) + "'");
        int ca = directo(m0), cb = directo(m0.AddMonths(-1)), cc = directo(m0.AddMonths(-2)), cd = directo(m0.AddMonths(-3));

        // Elegir los meses de uno en uno, como en el navegador.
        ConcentracionQueries.LimpiarCache();
        int antes = ConcentracionQueries.ConsultasPeriodoTotales;
        var pasos = new List<string>();
        int tramosLeidos = 0;
        foreach (var sel in new[] { a, a, a + "|" + b, a + "|" + b + "|" + c, a + "|" + c, a + "|" + b + "|" + c + "|" + d })
        {
            var r = Meses(sel, hoy);
            tramosLeidos += r.TramosSql;
            pasos.Add(Uso(r) + ":" + r.TicketsPeriodo);
        }
        Chk("CM1 cache por mes: uno (1 consulta), el mismo (0), +1 (lee solo el nuevo), +1, quitar uno (0), +1; tickets = conteos directos",
            "1|1|0|0:" + ca + ";0|0|1|0:" + ca + ";1|1|1|0:" + (ca + cb) + ";1|1|2|0:" + (ca + cb + cc) + ";0|0|2|0:" + (ca + cc) +
            ";1|1|3|0:" + (ca + cb + cc + cd), string.Join(";", pasos.ToArray()));
        Chk("CM2 cuatro meses elegidos de uno en uno: 4 lecturas de mes y 4 consultas (antes 1+2+3+4 = 10 lecturas de mes)",
            "4|4", tramosLeidos + "|" + (ConcentracionQueries.ConsultasPeriodoTotales - antes));

        // En frio, los cuatro juntos: UNA consulta, repartida por mes.
        ConcentracionQueries.LimpiarCache();
        var junto = Meses(a + "|" + b + "|" + c + "|" + d, hoy);
        var sueltos = new List<string>();
        foreach (var x in new[] { a, b, c, d }) { var r = Meses(x, hoy); sueltos.Add(Uso(r) + ":" + r.TicketsPeriodo); }
        Chk("CM3 en frio cuatro meses = 1 consulta, 4 tramos; despues cada mes sale de la cache con SU conteo directo",
            "1|4|0|0:" + (ca + cb + cc + cd) + "|0|0|1|0:" + ca + ";0|0|1|0:" + cb + ";0|0|1|0:" + cc + ";0|0|1|0:" + cd,
            Uso(junto) + ":" + junto.TicketsPeriodo + "|" + string.Join(";", sueltos.ToArray()));

        // Filtros sobre meses ya guardados: igual que en frio, y sin ensuciar la cache.
        var js = new JavaScriptSerializer();
        Func<ConcentracionResultado, string> salida = x => js.Serialize(new object[] { x.OpcionesServiceOwner, x.OpcionesGrupo, x.Pareto, x.Categorias,
            x.Grupos, x.TicketsFiltrados, x.TicketsPeriodo, x.Cobertura });
        var tibioSo = Meses(a + "|" + c, hoy, ConcentracionContrato.SinServiceOwner);
        var tibioBeto = Meses(a + "|" + c, hoy, "Beto SO");
        var tibioTodo = Meses(a + "|" + c, hoy);
        ConcentracionQueries.LimpiarCache();
        var frioSo = Meses(a + "|" + c, hoy, ConcentracionContrato.SinServiceOwner);
        ConcentracionQueries.LimpiarCache();
        var frioBeto = Meses(a + "|" + c, hoy, "Beto SO");
        ConcentracionQueries.LimpiarCache();
        var frioTodo = Meses(a + "|" + c, hoy);
        Chk("CM4 SO sobre meses de la cache = en frio (Sin SO, Beto, sin filtro); filtrar no cambia lo guardado",
            "True|True|True|0|0|0", (salida(tibioSo) == salida(frioSo)) + "|" + (salida(tibioBeto) == salida(frioBeto)) + "|" +
            (salida(tibioTodo) == salida(frioTodo)) + "|" + tibioSo.ConsultasPeriodo + "|" + tibioBeto.ConsultasPeriodo + "|" + tibioTodo.ConsultasPeriodo);
        var fg = new ConcentracionFiltros(); fg.Modo = ConcentracionContrato.ModoMes; fg.Meses.Add(m0); fg.Mes = m0; fg.Grupos.Add("Service Desk");
        var conGrupo = ConcentracionQueries.Consultar(fg, hoy);
        var sinGrupo = Meses(a, hoy);
        Chk("CM5 Grupo reusa el mes guardado y no lo recorta para la siguiente peticion", "0|0|" + ca,
            conGrupo.ConsultasPeriodo + "|" + sinGrupo.ConsultasPeriodo + "|" + sinGrupo.TicketsPeriodo);

        // Vencimiento: con 1 s de vigencia, el mismo mes se vuelve a leer.
        var vigencia = ConcentracionQueries.SegundosCache;
        try
        {
            ConcentracionQueries.SegundosCache = 1;
            ConcentracionQueries.LimpiarCache();
            var v1 = Meses(b, hoy);
            var v2 = Meses(b, hoy);
            System.Threading.Thread.Sleep(1500);
            var v3 = Meses(b, hoy);
            Chk("CM6 vencido el tramo, se vuelve a leer (1, 0 dentro de la vigencia, 1 despues)", "1|0|1",
                v1.ConsultasPeriodo + "|" + v2.ConsultasPeriodo + "|" + v3.ConsultasPeriodo);
        }
        finally { ConcentracionQueries.SegundosCache = vigencia; }

        // Slot sigue con su tramo acumulado propio y su cache.
        ConcentracionQueries.LimpiarCache();
        var fs1 = new ConcentracionFiltros(); fs1.Slot = 2;
        var s1 = ConcentracionQueries.Consultar(fs1, hoy);
        var s2 = ConcentracionQueries.Consultar(fs1, hoy);
        int c02 = Escalar(cadena, "SELECT COUNT(*) FROM dbo.vw_ServicioTickets WHERE Slot BETWEEN 0 AND 2");
        Chk("CM7 Slot 2: un tramo acumulado (1 consulta), luego de la cache; mismo conteo directo", "1|1|0|0:" + c02 + ";0|0|1|0:" + c02,
            Uso(s1) + ":" + s1.TicketsPeriodo + ";" + Uso(s2) + ":" + s2.TicketsPeriodo);

        Concurrencia(cadena, hoy, b, c);
    }

    /* Lecturas en vuelo. Con la tabla bloqueada por otra transaccion, la
       primera peticion queda dentro de su consulta; las demas deben esperarla
       y no lanzar otra. */
    static void Concurrencia(string cadena, DateTime hoy, string b, string c)
    {
        ConcentracionQueries.LimpiarCache();
        int antes = ConcentracionQueries.ConsultasPeriodoTotales;
        var res = new ConcentracionResultado[4];
        var err = new Exception[4];
        int durante;
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            var tx = cn.BeginTransaction();
            new SqlCommand("SELECT COUNT(*) FROM dbo.vw_ServicioTickets WITH (TABLOCKX, HOLDLOCK);", cn, tx).ExecuteScalar();
            var hilos = new List<System.Threading.Thread>();
            for (int i = 0; i < 4; i++)
            {
                int k = i;
                var h = new System.Threading.Thread(() => { try { res[k] = Meses(b, hoy); } catch (Exception ex) { err[k] = ex; } });
                h.Start(); hilos.Add(h);
            }
            for (int t = 0; t < 100 && ConcentracionQueries.ConsultasPeriodoTotales - antes < 1; t++) System.Threading.Thread.Sleep(50);
            System.Threading.Thread.Sleep(700);   // tiempo para que las otras tres lleguen
            durante = ConcentracionQueries.ConsultasPeriodoTotales - antes;
            tx.Rollback();
            foreach (var h in hilos) h.Join(60000);
        }
        Chk("CC1 cuatro peticiones del mismo mes a la vez: 1 consulta; las otras 3 esperan la suya; mismos tickets",
            "1|1|0|3|True", durante + "|" + (ConcentracionQueries.ConsultasPeriodoTotales - antes) + "|" + err.Count(e => e != null) + "|" +
            res.Where(r => r != null).Sum(r => r.TramosEspera) + "|" + (res.All(r => r != null) && res.Select(r => r.TicketsPeriodo).Distinct().Count() == 1));

        // Conjuntos que se enciman: A = b|c, B = c (otro mes ya en vuelo).
        ConcentracionQueries.LimpiarCache();
        antes = ConcentracionQueries.ConsultasPeriodoTotales;
        ConcentracionResultado ra = null, rb = null;
        Exception ea = null, eb = null;
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            var tx = cn.BeginTransaction();
            new SqlCommand("SELECT COUNT(*) FROM dbo.vw_ServicioTickets WITH (TABLOCKX, HOLDLOCK);", cn, tx).ExecuteScalar();
            var ha = new System.Threading.Thread(() => { try { ra = Meses(b + "|" + c, hoy); } catch (Exception ex) { ea = ex; } });
            ha.Start();
            for (int t = 0; t < 100 && ConcentracionQueries.ConsultasPeriodoTotales - antes < 1; t++) System.Threading.Thread.Sleep(50);
            var hb = new System.Threading.Thread(() => { try { rb = Meses(c, hoy); } catch (Exception ex) { eb = ex; } });
            hb.Start();
            System.Threading.Thread.Sleep(700);
            durante = ConcentracionQueries.ConsultasPeriodoTotales - antes;
            tx.Rollback();
            ha.Join(60000); hb.Join(60000);
        }
        Chk("CC2 A pide b|c y, en vuelo, B pide c: una sola consulta; B espera el mes de A",
            "1|1|null|null|1|2|0|0|0|0|0|1", durante + "|" + (ConcentracionQueries.ConsultasPeriodoTotales - antes) + "|" +
            (ea == null ? "null" : ea.Message) + "|" + (eb == null ? "null" : eb.Message) + "|" +
            (ra == null ? "-" : Uso(ra)) + "|" + (rb == null ? "-" : Uso(rb)));
        ConcentracionQueries.LimpiarCache();
    }

    // La cabecera de una respuesta de prueba (HttpResponse fuera de IIS la
    // guarda en un campo privado).
    static string Cabecera(HttpResponse resp, string nombre)
    {
        var flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance;
        var campo = typeof(HttpResponse).GetField("_customHeaders", flags);
        var lista = campo == null ? null : campo.GetValue(resp) as System.Collections.IEnumerable;
        if (lista == null) return null;
        foreach (var h in lista)
        {
            var n = h.GetType().GetProperty("Name", flags);
            var v = h.GetType().GetProperty("Value", flags);
            if (n != null && v != null && string.Equals(n.GetValue(h, null) as string, nombre, StringComparison.OrdinalIgnoreCase))
                return v.GetValue(h, null) as string;
        }
        return null;
    }

    static string PedirCrudo(string query, out int estado, out string timing)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("", "http://localhost/handlers/concentracion.ashx", query), new HttpResponse(sw));
        new Concentracion().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        timing = Cabecera(ctx.Response, "Server-Timing");
        return sw.ToString();
    }

    static void ServerTiming(string cadena, DateTime hoy)
    {
        var mes = ConcentracionContrato.Mes(new DateTime(hoy.Year, hoy.Month, 1));
        ConcentracionQueries.LimpiarCache();
        int e1, e2; string t1, t2;
        var frio = PedirCrudo("modo=mes&mes=" + mes, out e1, out t1);
        var tibio = PedirCrudo("modo=mes&mes=" + mes, out e2, out t2);
        Console.WriteLine("INFO  Server-Timing en frio:    " + t1);
        Console.WriteLine("INFO  Server-Timing de la cache: " + t2);
        Func<string, string> nombres = t => t == null ? "null" : string.Join(",", t.Split(new[] { ", " }, StringSplitOptions.None).Select(p => p.Split(';')[0]).ToArray());
        Chk("ST1 Server-Timing en frio y en cache: sql, c1c2 (solo si hubo lectura), espera, cache, directorio, calculo, anterior, etl, json, total",
            "200|c1c2,sql,espera,cache,directorio,calculo,anterior,etl,json,total|200|sql,espera,cache,directorio,calculo,anterior,etl,json,total",
            e1 + "|" + nombres(t1) + "|" + e2 + "|" + nombres(t2));
        var formato = new System.Text.RegularExpressions.Regex("^[a-z0-9]+;dur=[0-9]+\\.[0-9](;desc=\"[^\",]*\")?$");
        Chk("ST2 cada metrica con dur en ms y descripcion entre comillas", "True|True",
            (t1 != null && t1.Split(new[] { ", " }, StringSplitOptions.None).All(p => formato.IsMatch(p))) + "|" +
            (t2 != null && t2.Split(new[] { ", " }, StringSplitOptions.None).All(p => formato.IsMatch(p))));
        Chk("ST3 se distingue lectura de cache: frio 1 consulta, 0 de 1 tramos en cache; tibio 0 consultas, 1 de 1",
            "True|True|True|True",
            (t1 != null && t1.Contains("desc=\"consultas=1 tramos=1 filas=")) + "|" + (t1 != null && t1.Contains("cache;dur=0.0;desc=\"tramos=0 de=1\"")) + "|" +
            (t2 != null && t2.Contains("desc=\"consultas=0 tramos=0 filas=0\"")) + "|" + (t2 != null && t2.Contains("cache;dur=0.0;desc=\"tramos=1 de=1\"")));
        Chk("ST3b periodo anterior: en frio lo lee (1 consulta, 1 tramo); despues sale de la cache",
            "True|True", (t1 != null && t1.Contains("desc=\"consultas=1 tramos=1 cache=0 filas=")) + "|" +
            (t2 != null && t2.Contains("desc=\"consultas=0 tramos=0 cache=1 filas=")));
        Chk("ST4 la cabecera no trae tickets, categorias ni personas", "False",
            (t1 + t2).Contains("T0") || (t1 + t2).Contains("/S-") || (t1 + t2).Contains("Ana") || (t1 + t2).Contains("Service Desk") ? "True" : "False");
        var js = new JavaScriptSerializer();
        var d1 = (Dictionary<string, object>)js.DeserializeObject(frio);
        var d2 = (Dictionary<string, object>)js.DeserializeObject(tibio);
        Chk("ST5 el JSON sigue con las mismas llaves del contrato",
            "modo,slot,mes,mesesElegidos,slotMaximo,meses,periodo,filtros,opciones,ticketsPeriodo,ticketsFiltrados,cobertura,pareto,categorias,grupos,tendencia,cambios,errores,avisos,dataInfo",
            string.Join(",", d1.Keys.ToArray()));
        Chk("ST6 el cuerpo en frio y desde la cache es el mismo", true, frio == tibio);
        int e3; string t3;
        PedirCrudo("modo=mes&mes=2001-01", out e3, out t3);
        Chk("ST7 un 400 no lleva Server-Timing (como analisis.ashx)", "400|null", e3 + "|" + (t3 ?? "null"));
    }

    // ------------------------------------- 2c) comparacion de punta a punta
    static Dictionary<string, object> Cambios(Dictionary<string, object> d) { return (Dictionary<string, object>)d["cambios"]; }
    static Dictionary<string, object> Ventana(Dictionary<string, object> d) { return (Dictionary<string, object>)Cambios(d)["ventana"]; }

    // "COD:dif,..." de una lista del JSON (null si no vino).
    static string Difs(object o)
    {
        var l = Lista(o);
        if (l == null) return "null";
        return string.Join(",", l.Select(x => x["Servicio"] + ":" + x["Diferencia"]).ToArray());
    }

    static string RangosJ(object bloque)
    {
        var b = (Dictionary<string, object>)bloque;
        return string.Join(",", Lista(b["rangos"]).Select(x => x["desde"] + ".." + x["hasta"]).ToArray());
    }

    static string Lit(DateTime d) { return "'" + Dia(d) + "'"; }

    /* Oraculo independiente del codigo: la cuenta en SQL (tickets distintos
       por Servicio en cada conjunto de rangos, diferencia <> 0) y el orden
       del contrato aplicado aqui. Devuelve "aumentos|reducciones" como Difs. */
    static string Oraculo(string cadena, List<KeyValuePair<DateTime, DateTime>> actual, List<KeyValuePair<DateTime, DateTime>> anterior)
    {
        Func<List<KeyValuePair<DateTime, DateTime>>, string> donde = rs => "(" + string.Join(" OR ", rs.Select(r =>
            "(FechaRegistro >= " + Lit(r.Key) + " AND FechaRegistro < " + Lit(r.Value.AddDays(1)) + ")").ToArray()) + ")";
        var filas = Exec(cadena, "WITH a AS (SELECT Servicio, n = COUNT(DISTINCT CodigoTicket) FROM dbo.vw_ServicioTickets WHERE Servicio IS NOT NULL AND " + donde(actual) +
            " GROUP BY Servicio), p AS (SELECT Servicio, n = COUNT(DISTINCT CodigoTicket) FROM dbo.vw_ServicioTickets WHERE Servicio IS NOT NULL AND " + donde(anterior) +
            " GROUP BY Servicio) SELECT S = COALESCE(a.Servicio, p.Servicio), D = ISNULL(a.n, 0) - ISNULL(p.n, 0) FROM a FULL JOIN p ON p.Servicio = a.Servicio" +
            " WHERE ISNULL(a.n, 0) <> ISNULL(p.n, 0);");
        var l = filas.Select(x => new { S = (string)x["S"], D = Convert.ToInt32(x["D"]) }).ToList();
        var up = l.Where(x => x.D > 0).OrderByDescending(x => x.D).ThenBy(x => x.S, Comparer<string>.Create(ConcentracionContrato.CompararEtiquetas)).Take(5);
        var dn = l.Where(x => x.D < 0).OrderBy(x => x.D).ThenBy(x => x.S, Comparer<string>.Create(ConcentracionContrato.CompararEtiquetas)).Take(5);
        return string.Join(",", up.Select(x => x.S + ":" + x.D).ToArray()) + "|" + string.Join(",", dn.Select(x => x.S + ":" + x.D).ToArray());
    }

    static KeyValuePair<DateTime, DateTime> R(DateTime d, DateTime h) { return new KeyValuePair<DateTime, DateTime>(d, h); }
    static DateTime FinMes(DateTime m) { return m.AddMonths(1).AddDays(-1); }

    /* Fixture propio (se respalda y se restaura el de las demas pruebas):
         - relleno: un ticket SIN servicio por dia desde `historia` (= el 11
           del mes de hace 12) hasta hoy. Da la cobertura sin entrar en la
           comparacion. Antes de `historia` no hay nada: ahi la historia
           esta incompleta.
         - servicios (actual = ultimos 30 dias, anterior = los 30 de antes):
           A1 10/2, A2 9/1, A3 7/0, A4 5/1 (Ana SO), A5 4/1, A6 3/1,
           R1 1/6 (Beto SO), R2 0/3, Z0 2/2, PU 5/4 que CAMBIA de rama
           (anterior en S-Punto de Venta, actual en S-Aplicativos PV) y es
           el unico del grupo "Cajas". */
    static void ComparacionSql(string cadena, DateTime hoy)
    {
        Lotes(cadena, "SELECT * INTO dbo.vw_respaldo FROM dbo.vw_ServicioTickets; DELETE dbo.vw_ServicioTickets;");
        try
        {
            var m0 = new DateTime(hoy.Year, hoy.Month, 1);
            var historia = m0.AddMonths(-12).AddDays(10);
            var dt = new System.Data.DataTable();
            foreach (var c in new[] { "CodigoTicket", "Servicio", "RamaServicio", "C1Raiz", "Categoria", "Grupo" }) dt.Columns.Add(c, typeof(string));
            dt.Columns.Add("Slot", typeof(decimal)); dt.Columns.Add("FechaRegistro", typeof(DateTime)); dt.Columns.Add("FechaRegistroDia", typeof(DateTime));
            Action<string, string, string, string, string, DateTime> fila = (cod, srv, rama, cat, grp, dia) =>
            {
                int p2 = cat.IndexOf('/', 1);
                dt.Rows.Add(cod, (object)srv ?? DBNull.Value, (object)rama ?? DBNull.Value, p2 > 0 ? cat.Substring(0, p2) : cat, cat, grp,
                            (decimal)((hoy - dia).Days / 30), dia.AddHours(10), dia);
            };
            int k = 0;
            for (var dd = historia; dd <= hoy; dd = dd.AddDays(1)) fila("F" + (k++), null, null, "/Relleno/x", "Relleno", dd);
            var servicios = new[] {
                new { S = "A1", A = 10, P = 2, Cat = "/Otro/A1", Grp = "Mesa" }, new { S = "A2", A = 9, P = 1, Cat = "/Otro/A2", Grp = "Mesa" },
                new { S = "A3", A = 7, P = 0, Cat = "/Otro/A3", Grp = "Mesa" }, new { S = "A4", A = 5, P = 1, Cat = "/S-Equipo de Computo/Hardware/Z", Grp = "Mesa" },
                new { S = "A5", A = 4, P = 1, Cat = "/Otro/A5", Grp = "Mesa" }, new { S = "A6", A = 3, P = 1, Cat = "/Otro/A6", Grp = "Mesa" },
                new { S = "R1", A = 1, P = 6, Cat = "/S-Punto de Venta/Caja/Falla", Grp = "Mesa" }, new { S = "R2", A = 0, P = 3, Cat = "/Otro/R2", Grp = "Mesa" },
                new { S = "Z0", A = 2, P = 2, Cat = "/Otro/Z0", Grp = "Mesa" } };
            foreach (var s in servicios)
            {
                for (int i = 0; i < s.A; i++) fila("C" + s.S + i, s.S, "Rama " + s.S, s.Cat, s.Grp, hoy.AddDays(-(i % 30)));
                for (int i = 0; i < s.P; i++) fila("P" + s.S + i, s.S, "Rama " + s.S, s.Cat, s.Grp, hoy.AddDays(-30 - (i % 30)));
            }
            for (int i = 0; i < 5; i++) fila("CPU" + i, "PU", "S-Aplicativos Punto de Venta", "/PV Nuevo/Caja/X", "Cajas", hoy.AddDays(-i));
            for (int i = 0; i < 4; i++) fila("PPU" + i, "PU", "S-Punto de Venta", "/PV Viejo/Caja/X", "Cajas", hoy.AddDays(-30 - i));
            using (var cn = new SqlConnection(cadena))
            {
                cn.Open();
                using (var bc = new SqlBulkCopy(cn))
                {
                    bc.DestinationTableName = "dbo.vw_ServicioTickets";
                    foreach (System.Data.DataColumn c in dt.Columns) bc.ColumnMappings.Add(c.ColumnName, c.ColumnName);
                    bc.WriteToServer(dt);
                }
            }
            ConcentracionQueries.LimpiarCache();
            int estado;

            // --- Slot 0: actual = ultimos 30 dias, anterior = los 30 de antes.
            var d = Pedir("slot=0", out estado);
            var c0 = Cambios(d);
            Chk("CS1 Slot 0: ok; periodos actual y anterior (30 + 30, pegados)",
                "200|ok|" + Dia(hoy.AddDays(-29)) + ".." + Dia(hoy) + "|" + Dia(hoy.AddDays(-59)) + ".." + Dia(hoy.AddDays(-30)) + "|30|30",
                estado + "|" + c0["estado"] + "|" + RangosJ(c0["actual"]) + "|" + RangosJ(c0["anterior"]) + "|" +
                ((Dictionary<string, object>)c0["actual"])["dias"] + "|" + ((Dictionary<string, object>)c0["anterior"])["dias"]);
            Chk("CS2 aumentos Top 5 (empate A1/A2 por codigo, A6 y PU fuera del Top) y reducciones; Z0 (0) fuera",
                "A1:8,A2:8,A3:7,A4:4,A5:3|R1:-5,R2:-3|7|2", Difs(c0["aumentos"]) + "|" + Difs(c0["reducciones"]) + "|" + c0["serviciosAumento"] + "|" + c0["serviciosReduccion"]);
            Chk("CS3 = el oraculo SQL independiente", Oraculo(cadena, new List<KeyValuePair<DateTime, DateTime>> { R(hoy.AddDays(-29), hoy) },
                new List<KeyValuePair<DateTime, DateTime>> { R(hoy.AddDays(-59), hoy.AddDays(-30)) }), Difs(c0["aumentos"]) + "|" + Difs(c0["reducciones"]));
            Chk("CS4 tickets por servicio (el relleno sin servicio no cuenta) y sin errores", "46|21|0",
                c0["ticketsActual"] + "|" + c0["ticketsAnterior"] + "|" + ((Dictionary<string, object>)d["errores"]).Count);
            Chk("CS5 las otras tres graficas no cambian por la comparacion (Pareto Top: A1 10)", "A1:10",
                Lista(d["pareto"])[0]["Servicio"] + ":" + Lista(d["pareto"])[0]["CantidadTickets"]);

            // --- Filtros: los mismos en los dos periodos.
            d = Pedir("slot=0&grupo=Cajas", out estado);
            var cg = Cambios(d);
            Chk("CS6 Grupo Cajas: PU cambio de rama = UNA entrada por codigo (5 vs 4, +1)", "ok|PU:1||1|0|PU:5/4",
                cg["estado"] + "|" + Difs(cg["aumentos"]) + "|" + Difs(cg["reducciones"]) + "|" + cg["serviciosAumento"] + "|" + cg["serviciosReduccion"] + "|" +
                Lista(cg["aumentos"])[0]["Servicio"] + ":" + Lista(cg["aumentos"])[0]["TicketsActual"] + "/" + Lista(cg["aumentos"])[0]["TicketsAnterior"]);
            d = Pedir("slot=0&so=Ana%20SO", out estado);
            Chk("CS7 SO Ana: solo A4 (su anterior tambien filtrado: 5 vs 1)", "A4:4|", Difs(Cambios(d)["aumentos"]) + "|" + Difs(Cambios(d)["reducciones"]));
            d = Pedir("slot=0&so=Beto%20SO", out estado);
            Chk("CS8 SO Beto: solo R1 (-5)", "|R1:-5", Difs(Cambios(d)["aumentos"]) + "|" + Difs(Cambios(d)["reducciones"]));
            d = Pedir("slot=0&so=" + HttpUtility.UrlEncode(ConcentracionContrato.SinServiceOwner) + "&grupo=Mesa", out estado);
            Chk("CS9 Sin SO + Grupo Mesa: sin A4 ni R1 ni PU (A6 entra al Top)", "A1:8,A2:8,A3:7,A5:3,A6:2|R2:-3|5|1",
                Difs(Cambios(d)["aumentos"]) + "|" + Difs(Cambios(d)["reducciones"]) + "|" + Cambios(d)["serviciosAumento"] + "|" + Cambios(d)["serviciosReduccion"]);
            d = Pedir("slot=0&so=Zeta", out estado);
            Chk("CS10 filtros sin tickets: ok, listas vacias, 0 y 0", "ok|||0|0",
                Cambios(d)["estado"] + "|" + Difs(Cambios(d)["aumentos"]) + "|" + Difs(Cambios(d)["reducciones"]) + "|" + Cambios(d)["ticketsActual"] + "|" + Cambios(d)["ticketsAnterior"]);

            // --- Slot acumulado.
            d = Pedir("slot=1", out estado);
            var c1 = Cambios(d);
            Chk("CS11 Slot 1 (acumulado 0..1, 60 dias) contra los 60 anteriores (solo relleno): todo sube (PU 5+4 en sus dos ramas); empate A3/R1 por codigo",
                "ok|" + Dia(hoy.AddDays(-59)) + ".." + Dia(hoy) + "|" + Dia(hoy.AddDays(-119)) + ".." + Dia(hoy.AddDays(-60)) + "|A1:12,A2:10,PU:9,A3:7,R1:7||10|0",
                c1["estado"] + "|" + RangosJ(c1["actual"]) + "|" + RangosJ(c1["anterior"]) + "|" + Difs(c1["aumentos"]) + "|" + Difs(c1["reducciones"]) + "|" +
                c1["serviciosAumento"] + "|" + c1["serviciosReduccion"]);
            d = Pedir("slot=4", out estado);
            Chk("CS12 Slot 4: su anterior (hoy-299..hoy-150) tiene historia completa -> ok", "ok|150|150|True",
                Cambios(d)["estado"] + "|" + ((Dictionary<string, object>)Cambios(d)["cobertura"])["diasConTickets"] + "|" +
                ((Dictionary<string, object>)Cambios(d)["cobertura"])["diasEsperados"] + "|" + ((Dictionary<string, object>)Cambios(d)["cobertura"])["completa"]);

            Chk("CS12b con el anterior completo: ventana no ajustada, dias = lo pedido", "False|150|150",
                Ventana(d)["ajustada"] + "|" + Ventana(d)["dias"] + "|" + Ventana(d)["diasSolicitados"]);

            // --- Historia insuficiente (2026-11-18): ventana maxima comparable,
            // nunca el anterior recortado solo. El relleno cubre cada dia desde
            // `historia`: L = floor(min(pedido, T/2) / 7) * 7 con T = hoy - historia + 1.
            int tCub = (hoy - historia).Days + 1;
            int lMax = Math.Min(210, tCub / 2) / 7 * 7;
            var vAct = R(hoy.AddDays(-lMax + 1), hoy); var vAnt = R(hoy.AddDays(-2 * lMax + 1), hoy.AddDays(-lMax));
            d = Pedir("slot=6", out estado);
            var c6 = Cambios(d);
            var cob6 = (Dictionary<string, object>)c6["cobertura"];
            var v6 = Ventana(d);
            int conDatos6 = (hoy.AddDays(-210) - historia).Days + 1;
            Chk("CS13 Slot 6: el anterior (hoy-419..hoy-210) empieza antes de la historia -> ok con la ventana maxima: L dias a semanas, actual hasta hoy y anterior pegado; la cobertura del pedido; 200 y las otras graficas intactas",
                "200|ok|" + Dia(vAct.Key) + ".." + Dia(vAct.Value) + "|" + Dia(vAnt.Key) + ".." + Dia(vAnt.Value) + "|True|" + lMax + "|210|" + Dia(historia) + "|" +
                Dia(hoy.AddDays(-419)) + ".." + Dia(hoy.AddDays(-210)) + "|" + Dia(hoy.AddDays(-209)) + ".." + Dia(hoy) + "|" + conDatos6 + "|210|False|0|A1:12",
                estado + "|" + c6["estado"] + "|" + RangosJ(c6["actual"]) + "|" + RangosJ(c6["anterior"]) + "|" + v6["ajustada"] + "|" + v6["dias"] + "|" +
                v6["diasSolicitados"] + "|" + v6["historiaDesde"] + "|" + RangosJ(((Dictionary<string, object>)v6["solicitado"])["anterior"]) + "|" +
                RangosJ(((Dictionary<string, object>)v6["solicitado"])["actual"]) + "|" + cob6["diasConTickets"] + "|" + cob6["diasEsperados"] + "|" + cob6["completa"] + "|" +
                ((Dictionary<string, object>)d["errores"]).Count + "|" + Lista(d["pareto"])[0]["Servicio"] + ":" + Lista(d["pareto"])[0]["CantidadTickets"]);            Chk("CS13b ... mismo largo, multiplo de 7, >= 28 y sin solape", "True|True|True|True",
                ((vAct.Value - vAct.Key).Days == (vAnt.Value - vAnt.Key).Days) + "|" + (lMax % 7 == 0) + "|" + (lMax >= 28) + "|" + (vAnt.Value.AddDays(1) == vAct.Key));
            Chk("CS13c ... la cuenta de las dos ventanas = el oraculo SQL", Oraculo(cadena, new List<KeyValuePair<DateTime, DateTime>> { vAct },
                new List<KeyValuePair<DateTime, DateTime>> { vAnt }), Difs(c6["aumentos"]) + "|" + Difs(c6["reducciones"]));
            d = Pedir("slot=6&so=Ana%20SO", out estado);
            Chk("CS13d ... con SO Ana: los mismos filtros en las dos ventanas (A4 5+1 caen en la actual)", "ok|A4:6||True",
                Cambios(d)["estado"] + "|" + Difs(Cambios(d)["aumentos"]) + "|" + Difs(Cambios(d)["reducciones"]) + "|" + Ventana(d)["ajustada"]);
            d = Pedir("slot=6&grupo=Cajas", out estado);
            Chk("CS13e ... con Grupo Cajas: PU, una entrada por codigo (5+4)", "ok|PU:9|", Cambios(d)["estado"] + "|" + Difs(Cambios(d)["aumentos"]) + "|" + Difs(Cambios(d)["reducciones"]));
            d = Pedir("slot=12", out estado);
            Chk("CS14 Slot 12: anterior sin ningun dato -> la misma ventana maxima (lo pedido, 390, no la limita)", "ok|0|390|" + lMax + "|390|" +
                Dia(vAct.Key) + ".." + Dia(vAct.Value) + "|" + Dia(vAnt.Key) + ".." + Dia(vAnt.Value),
                Cambios(d)["estado"] + "|" + ((Dictionary<string, object>)Cambios(d)["cobertura"])["diasConTickets"] + "|" + ((Dictionary<string, object>)Cambios(d)["cobertura"])["diasEsperados"] + "|" +
                Ventana(d)["dias"] + "|" + Ventana(d)["diasSolicitados"] + "|" + RangosJ(Cambios(d)["actual"]) + "|" + RangosJ(Cambios(d)["anterior"]));

            // --- Meses.
            var prevCurso = m0.AddMonths(-1);
            var finCurso = prevCurso.AddDays(Math.Min(hoy.Day - 1, (FinMes(prevCurso) - prevCurso).Days));
            d = Pedir("modo=mes&mes=" + ConcentracionContrato.Mes(m0), out estado);
            var cm = Cambios(d);
            Chk("CS15 mes en curso: contra los mismos dias del mes anterior; = oraculo", "ok|" + Dia(m0) + ".." + Dia(hoy) + "|" + Dia(prevCurso) + ".." + Dia(finCurso) + "|" +
                Oraculo(cadena, new List<KeyValuePair<DateTime, DateTime>> { R(m0, hoy) }, new List<KeyValuePair<DateTime, DateTime>> { R(prevCurso, finCurso) }),
                cm["estado"] + "|" + RangosJ(cm["actual"]) + "|" + RangosJ(cm["anterior"]) + "|" + Difs(cm["aumentos"]) + "|" + Difs(cm["reducciones"]));
            var m1 = m0.AddMonths(-1); var m2 = m0.AddMonths(-2);
            d = Pedir("modo=mes&mes=" + ConcentracionContrato.Mes(m1), out estado);
            cm = Cambios(d);
            Chk("CS16 mes cerrado: contra el mes anterior completo; = oraculo", "ok|" + Dia(m2) + ".." + Dia(FinMes(m2)) + "|" +
                Oraculo(cadena, new List<KeyValuePair<DateTime, DateTime>> { R(m1, FinMes(m1)) }, new List<KeyValuePair<DateTime, DateTime>> { R(m2, FinMes(m2)) }),
                cm["estado"] + "|" + RangosJ(cm["anterior"]) + "|" + Difs(cm["aumentos"]) + "|" + Difs(cm["reducciones"]));
            var r1 = ConcentracionQueries.Consultar(MesesFiltro(ConcentracionContrato.Mes(m2), hoy), hoy);
            Chk("CS17 el mes anterior leido para comparar queda en la cache de la pestaña (pedir ese mes no consulta)", "0|1", r1.ConsultasPeriodo + "|" + r1.TramosCache);
            d = Pedir("modo=mes&mes=" + string.Join("|", new[] { m1, m2, m0.AddMonths(-3) }.Select(ConcentracionContrato.Mes).ToArray()), out estado);
            cm = Cambios(d);
            var m4 = m0.AddMonths(-4); var m5 = m0.AddMonths(-5); var m6 = m0.AddMonths(-6);
            Chk("CS18 tres meses seguidos: los tres de antes, completos y por mes; = oraculo",
                "ok|" + Dia(m4) + ".." + Dia(FinMes(m4)) + "," + Dia(m5) + ".." + Dia(FinMes(m5)) + "," + Dia(m6) + ".." + Dia(FinMes(m6)) + "|" +
                Oraculo(cadena, new List<KeyValuePair<DateTime, DateTime>> { R(m1, FinMes(m1)), R(m2, FinMes(m2)), R(m0.AddMonths(-3), FinMes(m0.AddMonths(-3))) },
                        new List<KeyValuePair<DateTime, DateTime>> { R(m4, FinMes(m4)), R(m5, FinMes(m5)), R(m6, FinMes(m6)) }),
                cm["estado"] + "|" + RangosJ(cm["anterior"]) + "|" + Difs(cm["aumentos"]) + "|" + Difs(cm["reducciones"]));
            var m3 = m0.AddMonths(-3);
            var fin3 = m3.AddDays(Math.Min(hoy.Day - 1, (FinMes(m3) - m3).Days));
            d = Pedir("modo=mes&mes=" + ConcentracionContrato.Mes(m0) + "|" + ConcentracionContrato.Mes(m2) + "&so=" + HttpUtility.UrlEncode(ConcentracionContrato.SinServiceOwner), out estado);
            cm = Cambios(d);
            Chk("CS19 meses NO seguidos (actual y hace 2): el patron corrido 3 meses, dos rangos y nunca el de en medio; con filtro SO",
                "ok|" + Dia(m3) + ".." + Dia(fin3) + "," + Dia(m5) + ".." + Dia(FinMes(m5)) + "|" + 2,
                cm["estado"] + "|" + RangosJ(cm["anterior"]) + "|" + Lista(((Dictionary<string, object>)cm["anterior"])["rangos"]).Count);
            var m11 = m0.AddMonths(-11); var m12 = m0.AddMonths(-12);
            d = Pedir("modo=mes&mes=" + ConcentracionContrato.Mes(m11), out estado);
            cm = Cambios(d);
            int porLado20 = ((FinMes(m11) - historia).Days + 1) / 2;
            Chk("CS20 mes cuyo anterior empieza antes de la historia (le faltan 10 dias): la ventana acotada no llega a 28 dias -> historiaInsuficiente (ventanaMinima), sin filas",
                "historiaInsuficiente|ventanaMinima|null|" + ((FinMes(m12) - m12).Days + 1 - 10) + "|" + ((FinMes(m12) - m12).Days + 1) + "|" + Dia(historia) + "|" + porLado20 + "|False",
                cm["estado"] + "|" + cm["motivo"] + "|" + Difs(cm["aumentos"]) + "|" + ((Dictionary<string, object>)cm["cobertura"])["diasConTickets"] + "|" +
                ((Dictionary<string, object>)cm["cobertura"])["diasEsperados"] + "|" + Ventana(d)["historiaDesde"] + "|" + Ventana(d)["diasPorLado"] + "|" + Ventana(d)["ajustada"]);
            d = Pedir("modo=mes&mes=" + ConcentracionContrato.Mes(m0.AddMonths(-10)), out estado);
            Chk("CS21 ... y el mes siguiente ya tiene su anterior completo -> ok", "ok|False", Cambios(d)["estado"] + "|" + Ventana(d)["ajustada"]);
            // Tres meses seguidos cuyo anterior cae antes de la historia: ventana acotada
            // que termina en el fin del mas reciente.
            var m8 = m0.AddMonths(-8); var m10 = m0.AddMonths(-10);
            int pedidos3 = (FinMes(m8) - m10).Days + 1;
            int l3 = Math.Min(pedidos3, ((FinMes(m8) - historia).Days + 1) / 2) / 7 * 7;
            var w3Act = R(FinMes(m8).AddDays(-l3 + 1), FinMes(m8)); var w3Ant = R(FinMes(m8).AddDays(-2 * l3 + 1), FinMes(m8).AddDays(-l3));
            d = Pedir("modo=mes&mes=" + string.Join("|", new[] { m8, m0.AddMonths(-9), m10 }.Select(ConcentracionContrato.Mes).ToArray()), out estado);
            cm = Cambios(d);
            Chk("CS21b meses seguidos con historia corta: ventana acotada de L dias (multiplo de 7, >= 28) hasta el fin del mas reciente; = oraculo",
                "ok|True|" + l3 + "|" + pedidos3 + "|" + Dia(w3Act.Key) + ".." + Dia(w3Act.Value) + "|" + Dia(w3Ant.Key) + ".." + Dia(w3Ant.Value) + "|" +
                Oraculo(cadena, new List<KeyValuePair<DateTime, DateTime>> { w3Act }, new List<KeyValuePair<DateTime, DateTime>> { w3Ant }) + "|True",
                cm["estado"] + "|" + Ventana(d)["ajustada"] + "|" + Ventana(d)["dias"] + "|" + Ventana(d)["diasSolicitados"] + "|" + RangosJ(cm["actual"]) + "|" +
                RangosJ(cm["anterior"]) + "|" + Difs(cm["aumentos"]) + "|" + Difs(cm["reducciones"]) + "|" + (l3 >= 28 && l3 % 7 == 0));
            d = Pedir("modo=mes&mes=" + ConcentracionContrato.Mes(m11) + "|" + ConcentracionContrato.Mes(m0.AddMonths(-9)), out estado);
            cm = Cambios(d);
            Chk("CS21c meses NO seguidos con historia corta -> historiaInsuficiente (noConsecutivos): una ventana continua meteria el mes no elegido",
                "historiaInsuficiente|noConsecutivos|null|False", cm["estado"] + "|" + cm["motivo"] + "|" + Difs(cm["aumentos"]) + "|" + Ventana(d)["ajustada"]);

            // --- Falla la lectura del anterior: estado error, el resto de la pestaña sigue.
            var ma = ConcentracionContrato.Mes(m0.AddMonths(-7)); var mb = ConcentracionContrato.Mes(m0.AddMonths(-8));
            ConcentracionQueries.LimpiarCache();       // CS20/CS21 ya guardaron -10 y -11
            Pedir("modo=mes&mes=" + ma, out estado);
            Pedir("modo=mes&mes=" + mb, out estado);   // ma y mb en cache (y -9); su anterior conjunto (-9, -10): -10 no
            Lotes(cadena, "EXEC sp_rename 'dbo.vw_ServicioTickets', 'vw_y';");
            try
            {
                d = Pedir("modo=mes&mes=" + ma + "|" + mb, out estado);
                if (!d.ContainsKey("cambios") || !Cambios(d).ContainsKey("mensaje"))
                    Chk("CS22 sin poder leer el periodo anterior: la respuesta trae cambios con mensaje", "200", estado + " " + new JavaScriptSerializer().Serialize(d));
                var ce = d.ContainsKey("cambios") && Cambios(d).ContainsKey("mensaje") ? Cambios(d)
                    : new Dictionary<string, object> { { "estado", "-" }, { "aumentos", null }, { "mensaje", "" } };
                Chk("CS22 sin poder leer el periodo anterior: 200, pareto intacto, cambios = error con mensaje seguro, errores.cambios",
                    "200|True|error|null|True|True|False", estado + "|" + (Lista(d["pareto"]) != null) + "|" + ce["estado"] + "|" + Difs(ce["aumentos"]) + "|" +
                    ((string)ce["mensaje"]).Contains("vw_ServicioTickets") + "|" + ((Dictionary<string, object>)d["errores"]).ContainsKey("cambios") + "|" +
                    (((string)ce["mensaje"]).IndexOf("localdb", StringComparison.OrdinalIgnoreCase) >= 0));
            }
            finally { Lotes(cadena, "EXEC sp_rename 'dbo.vw_y', 'vw_ServicioTickets';"); }
        }
        finally
        {
            Lotes(cadena, "DELETE dbo.vw_ServicioTickets; INSERT dbo.vw_ServicioTickets SELECT * FROM dbo.vw_respaldo; DROP TABLE dbo.vw_respaldo;");
            ConcentracionQueries.LimpiarCache();
        }
    }

    static ConcentracionFiltros MesesFiltro(string meses, DateTime hoy)
    {
        var f = new ConcentracionFiltros();
        f.Modo = ConcentracionContrato.ModoMes;
        f.Meses.AddRange(ConcentracionContrato.LeerMeses(meses, hoy));
        f.Mes = f.Meses[0];
        return f;
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
                           "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "]; END; CREATE DATABASE [" + bd + "] COLLATE SQL_Latin1_General_CP1_CI_AS;", cn).ExecuteNonQuery();
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
