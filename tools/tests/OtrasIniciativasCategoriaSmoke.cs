// Prueba offline de las "Otras iniciativas activas en la categoria" del
// detalle de una Nueva solicitud (admin_iniciativas_solicitudes_nuevas.ashx,
// otras_iniciativas): CapacidadCategoria.Otras y la elegibilidad de
// ExperienciaQueries.Compromisos (privada, por reflexion). Sin SQL Server.
//
// Lo que fija:
//   O1 varias iniciativas que consumen la ruta: todas, cada una con SU %;
//   O2 la regla del tope: cerrada / estado fuera de los vivos / sin
//      agrupador / otra ruta no salen (las mismas que Para no suma);
//   O3 la ruta se compara como Para: sin mayusculas, NBSP y espacios;
//      padre / hija / hermana no comparten;
//   O4 % NULL (llega como 0): sale con 0 y no suma;
//   O5 un folio repetido sale una vez (con su % sumado, como Usado);
//   O6 la iniciativa que creo la solicitud se excluye;
//   O7 la suma de lo listado = Usado de Para (sin la excluida);
//   O8 ComoJson (Nueva solicitud, PO/SO) NO publica la lista ni %s.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:OtrasSmoke.exe /r:exp.dll /r:System.dll /r:System.Core.dll ^
//       tools\tests\OtrasIniciativasCategoriaSmoke.cs
//   OtrasSmoke.exe
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;

public static class OtrasIniciativasCategoriaSmoke
{
    static int fallos = 0;

    static void Check(string titulo, object esperado, object obtenido)
    {
        var js = new JavaScriptSerializer();
        string e = js.Serialize(esperado), o = js.Serialize(obtenido);
        if (e != o) fallos++;
        Console.WriteLine((e == o ? "PASS  " : "FAIL  ") + titulo + (e == o ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static CapacidadCategoria.Compromiso C(string folio, string ruta, decimal pct, bool consume, string estado)
    {
        return new CapacidadCategoria.Compromiso { Folio = folio, Categoria = ruta, Pct = pct, Consume = consume, Estado = estado };
    }

    static string Linea(List<Dictionary<string, object>> l)
    {
        return string.Join(";", l.Select(x => x["folio"] + "|" + ((decimal)x["pct"]).ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) + "|" + x["estado"]).ToArray());
    }

    // Detalle de ExperienciaQueries (privada) armada por reflexion.
    static object Det(Type t, string folio, string ruta, double pct, string estado, string agrup)
    {
        var d = Activator.CreateInstance(t, true);
        t.GetField("Folio").SetValue(d, folio);
        t.GetField("Categoria").SetValue(d, ruta);
        t.GetField("PctDisminucion").SetValue(d, pct);
        t.GetField("Estado").SetValue(d, estado);
        t.GetField("Agrup").SetValue(d, agrup);
        return d;
    }

    public static int Main()
    {
        var cap = new CapacidadCategoria(new[]
        {
            C("PRB 2026-000001", "/A/B/C", 0.30m, true, "En Análisis"),
            C("ADO 2026-000002", "/a/b/c", 0.25m, true, "En Solución"),
            C("PRB 2026-000003", " /A/B/C ", 0.10m, true, "En Monitoreo"),
            C("PRB 2026-000004", "/A/B/C", 0.40m, false, "Cerrado"),
            C("PRB 2026-000005", "/A/B", 0.50m, true, "En Análisis"),
            C("PRB 2026-000006", "/A/B/C/D", 0.50m, true, "En Análisis"),
            C("PRB 2026-000007", "/A/B/C", 0.00m, true, "En Análisis"),
            C("MEJ 2026-000008", "/A/B/C", 0.05m, true, "En Solución"),
            C("MEJ 2026-000008", "/A/B/C", 0.05m, true, "En Solución"),
        });
        var otras = cap.Otras("/A/B/C", null);
        Check("O1/O3/O4/O5 vivas de la ruta, con su %, ruta normalizada, folio repetido una vez",
            "PRB 2026-000001|0.3|En Análisis;ADO 2026-000002|0.25|En Solución;PRB 2026-000003|0.1|En Monitoreo;PRB 2026-000007|0|En Análisis;MEJ 2026-000008|0.1|En Solución",
            Linea(otras));
        Check("O2 cerrada (no consume) y padre / hija no salen", new[] { false, false, false },
            new[] { Linea(otras).Contains("000004"), Linea(otras).Contains("000005"), Linea(otras).Contains("000006") });
        var excl = cap.Otras("/A/B/C", " prb 2026-000001 ");
        Check("O6 la iniciativa de la solicitud se excluye (sin mayusculas ni espacios)", false, Linea(excl).Contains("000001"));
        Check("O7 suma listada = Usado de Para (0.75)", true,
            cap.Para("/A/B/C").Usado == otras.Sum(x => (decimal)x["pct"]) && cap.Para("/A/B/C").Usado == 0.75m);
        Check("O7 sin categoria o ruta vacia: lista vacia", new[] { 0, 0 }, new[] { cap.Otras(null, null).Count, cap.Otras("  ", null).Count });
        var json = cap.Para("/A/B/C").ComoJson();
        Check("O8 ComoJson no publica la lista ni %s por folio", new[] { false, false },
            new[] { json.ContainsKey("otras_iniciativas"), json.ContainsKey("compromisos") });

        // Elegibilidad real: ExperienciaQueries.Compromisos (privada).
        var asm = typeof(CapacidadCategoria).Assembly;
        var tq = asm.GetType("ExperienciaQueries");
        var tdet = tq.GetNestedType("Detalle", BindingFlags.NonPublic | BindingFlags.Public);
        var lista = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(tdet));
        lista.Add(Det(tdet, "PRB 1", "/X/Y", 0.2, "En Análisis", "Problem"));
        lista.Add(Det(tdet, "PRB 2", "/X/Y", 0.3, "Cerrado", "Problem"));
        lista.Add(Det(tdet, "PRB 3", "/X/Y", 0.1, "En Solución", null));
        lista.Add(Det(tdet, "PRB 4", "/X/Y", 0.15, "Cancelado", "Mejora"));
        lista.Add(Det(tdet, "SOR 5", "/X/Y", 0.05, "En Monitoreo", "SorIA"));
        var m = tq.GetMethod("Compromisos", BindingFlags.NonPublic | BindingFlags.Static);
        var comp = (IEnumerable<CapacidadCategoria.Compromiso>)m.Invoke(null, new object[] { lista });
        var real = new CapacidadCategoria(comp).Otras("/X/Y", null);
        Check("O2 regla real: vivo + agrupador; cerrada, sin agrupador y estado no vivo fuera; Estado viaja",
            "PRB 1|0.2|En Análisis;SOR 5|0.05|En Monitoreo", Linea(real));

        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
