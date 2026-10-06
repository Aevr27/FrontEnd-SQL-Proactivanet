// Prueba offline del recorte de backlog_antiguos.ashx (BacklogAntiguos.MasViejos)
// sin tocar SQL Server. Comprueba:
//
//   1) el orden: del mas viejo al mas nuevo por FechaRegistro, empates por
//      CodigoTicket, sin fecha al final;
//   2) el top global: los 100 primeros de la respuesta son EXACTAMENTE los 100
//      mas viejos del corte (no los 100 mas recientes);
//   3) el cross-filter: cada lider y cada prioridad recibe sus 100 mas viejos
//      completos, y uno con menos de 100 recibe todos los suyos;
//   4) ningun ticket se repite.
//
// Se entra por reflexion a proposito: MasViejos() es privado y ProcessRequest
// abre una conexion. Asi corre sin SQL Server.
//
// Compilar y correr desde la raiz del repo (el handler sin su linea 1,
// <%@ WebHandler %>, copiado a un .cs temporal):
//   csc /nologo /target:library /out:antiguos.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll ^
//       App_Code\*.cs backlog_antiguos.cs
//   csc /nologo /out:BacklogAntiguosSmoke.exe tools\tests\BacklogAntiguosSmoke.cs
//   BacklogAntiguosSmoke.exe antiguos.dll
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

public static class BacklogAntiguosSmoke
{
    static int fallos = 0;

    static void Chk(string caso, object esperado, object obtenido)
    {
        bool ok = Equals(esperado, obtenido);
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + "  esperado=" + esperado + "  obtenido=" + obtenido);
    }

    static Dictionary<string, object> Ticket(int n, string lider, string prioridad, DateTime? fecha)
    {
        var t = new Dictionary<string, object>();
        t["CodigoTicket"] = "INC" + n.ToString("D6");
        t["Lider"] = lider;
        t["Grupo"] = lider + "-G" + (n % 3);
        t["Prioridad"] = prioridad;
        // Como llega de DashboardDb: DateTime o DBNull.
        t["FechaRegistro"] = fecha.HasValue ? (object)fecha.Value : DBNull.Value;
        return t;
    }

    static DateTime? Fecha(Dictionary<string, object> t)
    {
        return t["FechaRegistro"] is DateTime ? (DateTime?)(DateTime)t["FechaRegistro"] : null;
    }

    public static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args[0]);
        var tipo = asm.GetType("BacklogAntiguos");
        var masViejos = tipo.GetMethod("MasViejos", BindingFlags.NonPublic | BindingFlags.Static);
        int tope = (int)tipo.GetField("Tope", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);
        Chk("Tope", 100, tope);

        // Corte sintetico: 3000 tickets, 6 lideres desiguales, 4 prioridades,
        // fechas desordenadas con empates y algunos sin fecha. Un lider con
        // solo 40 tickets y todos recientes.
        var rnd = new Random(7);
        var lideres = new[] { "Ana", "Beto", "Caro", "Dani", "Eva" };
        var prios = new[] { "Critica", "Alta", "Media", "Baja" };
        var corte = new List<Dictionary<string, object>>();
        var baseF = new DateTime(2024, 1, 1);
        for (int i = 0; i < 3000; i++)
        {
            string l = lideres[Math.Min(rnd.Next(0, 9), 4)];       // Eva con mas
            string p = prios[rnd.Next(0, 4)];
            DateTime? f = i % 97 == 0 ? (DateTime?)null : baseF.AddDays(rnd.Next(0, 600)).AddHours(rnd.Next(0, 2) * 8);
            corte.Add(Ticket(i, l, p, f));
        }
        for (int i = 0; i < 40; i++)
            corte.Add(Ticket(5000 + i, "Sin Torre", prios[i % 4], baseF.AddDays(650 + i)));

        var salida = (List<Dictionary<string, object>>)masViejos.Invoke(null, new object[] { corte });

        // Orden total esperado, calculado aparte.
        Comparison<Dictionary<string, object>> cmp = (a, b) =>
        {
            DateTime? fa = Fecha(a), fb = Fecha(b);
            if (!fa.HasValue && fb.HasValue) return 1;
            if (fa.HasValue && !fb.HasValue) return -1;
            int c = (fa.HasValue ? fa.Value.CompareTo(fb.Value) : 0);
            return c != 0 ? c : string.CompareOrdinal((string)a["CodigoTicket"], (string)b["CodigoTicket"]);
        };
        var ordenado = corte.ToList();
        ordenado.Sort(cmp);

        // 1) orden
        int desorden = 0;
        for (int i = 1; i < salida.Count; i++) if (cmp(salida[i - 1], salida[i]) > 0) desorden++;
        Chk("salida en orden mas viejo -> mas nuevo", 0, desorden);
        Chk("primer ticket = el mas viejo del corte", ordenado[0]["CodigoTicket"], salida[0]["CodigoTicket"]);

        // 2) top global
        var top100 = string.Join(",", ordenado.Take(tope).Select(t => (string)t["CodigoTicket"]));
        Chk("los 100 primeros = los 100 mas viejos del corte", top100,
            string.Join(",", salida.Take(tope).Select(t => (string)t["CodigoTicket"])));
        var recientes = new HashSet<string>(ordenado.Where(t => Fecha(t).HasValue).Reverse().Take(tope).Select(t => (string)t["CodigoTicket"]));
        Chk("ninguno de los 100 mas recientes entre los 100 primeros", 0,
            salida.Take(tope).Count(t => recientes.Contains((string)t["CodigoTicket"])));

        // 3) cross-filter por lider y por prioridad
        foreach (var dim in new[] { "Lider", "Prioridad" })
        {
            foreach (var valor in corte.Select(t => (string)t[dim]).Distinct())
            {
                string esperado = string.Join(",", ordenado.Where(t => (string)t[dim] == valor).Take(tope).Select(t => (string)t["CodigoTicket"]));
                string obtenido = string.Join(",", salida.Where(t => (string)t[dim] == valor).Take(tope).Select(t => (string)t["CodigoTicket"]));
                Chk(dim + "=" + valor + ": sus " + tope + " mas viejos completos", esperado, obtenido);
            }
        }
        Chk("Sin Torre (40 tickets) llega entero", 40, salida.Count(t => (string)t["Lider"] == "Sin Torre"));

        // 4) sin duplicados y acotado
        Chk("sin duplicados", salida.Count, salida.Select(t => t["CodigoTicket"]).Distinct().Count());
        Chk("acotado a Tope x (lideres + prioridades)", true, salida.Count <= tope * (6 + 4));

        // Corte vacio
        var vacia = (List<Dictionary<string, object>>)masViejos.Invoke(null, new object[] { new List<Dictionary<string, object>>() });
        Chk("corte vacio", 0, vacia.Count);

        Console.WriteLine(fallos == 0 ? "\nTodo PASS" : "\n" + fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
