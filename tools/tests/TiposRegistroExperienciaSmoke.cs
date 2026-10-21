// Prueba offline del volumen por tipo de registro (vol_tipo) que
// ExperienciaQueries manda para el selector Todos / Incidentes /
// Requerimientos de Experiencia. Sin SQL Server: ArmarCategorias y
// ArmarCategoriasV2 se invocan por reflexion con filas de Volumen armadas a
// mano, como en UnionCategoriasExperienciaSmoke.cs.
//
// Cada Volumen es lo que LeerVolumen saca de vw_TBSlotCAT / vw_TBMesCAT:
// Inc = [Incidencia], Pet = [Petición de Servicio], Total = [Total general].
// La vista NO tiene filas de total: Total es el COUNT_BIG(*) de la propia
// fila (Slot x Categoria V2 x Aplica x Tipo relacion), y Total - Inc - Pet
// son los SorIA y cualquier otro tipo. Lo que fija:
//
//   A) vol_slot / vol_mes (Todos) no cambian: siguen siendo la suma de Total;
//   B) vol_tipo.inc / .req son la suma de su columna, por periodo, sin restar;
//   C) Todos >= Incidentes + Requerimientos, y la diferencia es exactamente
//      el resto (SorIA y otros): ni se pierde ni se duplica nada;
//   D) dos filas de la misma categoria y periodo (dos Tipo relacion) se
//      suman una vez cada una, igual que Total;
//   E) C1 / C1&C2 replegados dan la suma de sus rutas;
//   F) una categoria que solo existe por su iniciativa trae series vacias;
//   G) una categoria con tickets de un solo tipo trae la otra serie vacia.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:TiposSmoke.exe /r:System.dll /r:System.Core.dll ^
//       tools\tests\TiposRegistroExperienciaSmoke.cs
//   TiposSmoke.exe exp.dll
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

public static class TiposSmoke
{
    static Type T, TVol, TDet, TDue, TDir;
    static int fallos = 0;

    static object Nuevo(Type t) { return Activator.CreateInstance(t, true); }
    static void Set(object o, string campo, object v)
    {
        o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).SetValue(o, v);
    }
    static IList Lista(Type t)
    {
        return (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(t));
    }
    static MethodInfo M(string nombre)
    {
        return T.GetMethod(nombre, BindingFlags.NonPublic | BindingFlags.Static);
    }

    static object Vol(int periodo, string llave, int inc, int pet, int total)
    {
        var v = Nuevo(TVol);
        Set(v, "Periodo", periodo); Set(v, "Llave", llave);
        Set(v, "Inc", inc); Set(v, "Pet", pet); Set(v, "Total", total);
        return v;
    }

    static object Det(string folio, string cat, string c1, string c1c2, int reduce)
    {
        var d = Nuevo(TDet);
        Set(d, "Folio", folio); Set(d, "Categoria", cat);
        Set(d, "C1", c1); Set(d, "C1C2", c1c2);
        Set(d, "Titulo", "T " + folio); Set(d, "TituloProblem", "TP " + folio);
        Set(d, "Estado", "En Análisis"); Set(d, "Agrup", "Problem");
        Set(d, "TicketsReduce", reduce);
        M("Semaforo").Invoke(null, new object[] { d, new DateTime(2026, 10, 21) });
        return d;
    }

    static Dictionary<string, object> Buscar(IList filas, string categoria, string nivel)
    {
        foreach (Dictionary<string, object> f in filas)
        {
            if (!string.Equals((string)f["categoria"], categoria, StringComparison.Ordinal)) continue;
            if (nivel != null && !string.Equals((string)f["nivel"], nivel, StringComparison.Ordinal)) continue;
            return f;
        }
        return null;
    }

    // Serie {"0": n, ...} como "0=n,1=m" en orden de llave, para comparar.
    static string Serie(object mapa)
    {
        var d = (Dictionary<string, object>)mapa;
        var llaves = new List<string>(d.Keys);
        llaves.Sort(StringComparer.Ordinal);
        var partes = new List<string>();
        foreach (var k in llaves) partes.Add(k + "=" + Convert.ToString(d[k], CultureInfo.InvariantCulture));
        return string.Join(",", partes.ToArray());
    }

    static string Tipo(Dictionary<string, object> fila, string tipo, string periodo)
    {
        var vt = (Dictionary<string, object>)fila["vol_tipo"];
        return Serie(((Dictionary<string, object>)vt[tipo])[periodo]);
    }

    static int Valor(object mapa, string llave)
    {
        var d = (Dictionary<string, object>)mapa;
        return d.ContainsKey(llave) ? Convert.ToInt32(d[llave], CultureInfo.InvariantCulture) : 0;
    }

    static void Chk(string caso, object esperado, object obtenido)
    {
        var ok = Equals(Convert.ToString(esperado, CultureInfo.InvariantCulture),
                        Convert.ToString(obtenido, CultureInfo.InvariantCulture));
        if (!ok) fallos++;
        Console.WriteLine("{0}  {1}  esperado={2}  obtenido={3}",
            ok ? "PASS" : "FALLA", caso, esperado, obtenido);
    }

    public static void Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args[0]);
        T = asm.GetType("ExperienciaQueries");
        TVol = T.GetNestedType("Volumen", BindingFlags.NonPublic);
        TDet = T.GetNestedType("Detalle", BindingFlags.NonPublic);
        TDir = asm.GetType("DirectorioOrganizacional");
        TDue = TDir.GetNestedType("Dueno");

        // --- escenario (filas de vw_TBSlotCAT / vw_TBMesCAT) ---
        // /Red/LAN/Switch slot 0 llega en DOS filas (dos Tipo relacion):
        //   6 inc + 3 pet + 1 SorIA = 10, y 0 inc + 0 pet + 2 SorIA = 2.
        var slotCat = Lista(TVol);
        slotCat.Add(Vol(0, "/Red/LAN/Switch", 6, 3, 10));
        slotCat.Add(Vol(0, "/Red/LAN/Switch", 0, 0, 2));
        slotCat.Add(Vol(1, "/Red/LAN/Switch", 4, 2, 8));
        slotCat.Add(Vol(0, "/Red/WAN", 0, 5, 5));          // solo Requerimientos
        slotCat.Add(Vol(0, "/Sorx/Bot", 0, 0, 3));         // solo SorIA / otros
        var mesCat = Lista(TVol);
        mesCat.Add(Vol(10, "/Red/LAN/Switch", 7, 1, 9));
        mesCat.Add(Vol(9, "/Red/WAN", 0, 4, 4));

        var slotC1 = (IList)M("Replegar").Invoke(null, new object[] { slotCat, true });
        var slotC2 = (IList)M("Replegar").Invoke(null, new object[] { slotCat, false });
        var mesC1 = (IList)M("Replegar").Invoke(null, new object[] { mesCat, true });
        var mesC2 = (IList)M("Replegar").Invoke(null, new object[] { mesCat, false });

        var detalle = Lista(TDet);
        detalle.Add(Det("P1", "/Red/LAN/Switch", "Red", "/Red/LAN", 4));
        detalle.Add(Det("P2", "/Solo/Sub/Hoja", "Solo", "/Solo/Sub", 5));   // sin tickets

        var dir = Activator.CreateInstance(TDir, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
            null, new object[] { Lista(TDue), new Dictionary<string, string>() }, null);

        var cats = (IList)M("ArmarCategorias").Invoke(null,
            new object[] { slotC1, slotC2, mesC1, mesC2, detalle, dir, 10 });
        var v2 = (IList)M("ArmarCategoriasV2").Invoke(null,
            new object[] { slotCat, mesCat, detalle, dir });

        // ---- A) Todos intacto ----
        var sw = Buscar(v2, "/Red/LAN/Switch", null);
        Chk("A Todos v2 vol_slot = suma de Total (dos filas en slot 0)", "0=12,1=8", Serie(sw["vol_slot"]));
        Chk("A Todos v2 vol_mes", "10=9", Serie(sw["vol_mes"]));
        var red = Buscar(cats, "Red", "C1");
        Chk("A Todos C1 vol_actual", 17, red["vol_actual"]);
        Chk("A Todos C1 vol_anterior", 8, red["vol_anterior"]);
        Chk("A Todos C1 vol_actual_mes (mes 10)", 9, red["vol_actual_mes"]);
        Chk("A Todos C1 vol_anterior_mes (mes 9)", 4, red["vol_anterior_mes"]);

        // ---- B) series por tipo, columna tal cual ----
        Chk("B v2 inc slot", "0=6,1=4", Tipo(sw, "inc", "slot"));
        Chk("B v2 req slot", "0=3,1=2", Tipo(sw, "req", "slot"));
        Chk("B v2 inc mes", "10=7", Tipo(sw, "inc", "mes"));
        Chk("B v2 req mes", "10=1", Tipo(sw, "req", "mes"));

        // ---- C) Todos = Inc + Req + resto, sin restar para obtener grupos ----
        int todos = 0, inc = 0, req = 0;
        foreach (Dictionary<string, object> f in v2)
        {
            todos += Valor(f["vol_slot"], "0");
            var vt = (Dictionary<string, object>)f["vol_tipo"];
            inc += Valor(((Dictionary<string, object>)vt["inc"])["slot"], "0");
            req += Valor(((Dictionary<string, object>)vt["req"])["slot"], "0");
        }
        Chk("C slot 0: Todos", 20, todos);
        Chk("C slot 0: Incidentes", 6, inc);
        Chk("C slot 0: Requerimientos", 8, req);
        Chk("C slot 0: resto (SorIA/otros) = 1 + 2 + 3", 6, todos - inc - req);

        // ---- D) dos filas del mismo periodo: cada tipo se suma una vez ----
        Chk("D inc no se duplica con la segunda fila de Tipo relacion", 6, Valor(
            ((Dictionary<string, object>)((Dictionary<string, object>)sw["vol_tipo"])["inc"])["slot"], "0"));

        // ---- E) replegados ----
        Chk("E C1 Red inc slot", "0=6,1=4", Tipo(red, "inc", "slot"));
        Chk("E C1 Red req slot", "0=8,1=2", Tipo(red, "req", "slot"));
        Chk("E C1 Red req mes (orden ordinal de llave)", "10=1,9=4", Tipo(red, "req", "mes"));
        var lan = Buscar(cats, "/Red/LAN", "C2");
        Chk("E C2 /Red/LAN req slot", "0=3,1=2", Tipo(lan, "req", "slot"));
        var wan = Buscar(cats, "/Red/WAN", "C2");
        Chk("E C2 /Red/WAN req slot", "0=5", Tipo(wan, "req", "slot"));

        // ---- F) categoria sin tickets: series vacias ----
        var solo = Buscar(v2, "/Solo/Sub/Hoja", null);
        Chk("F solo-iniciativa existe", true, solo != null);
        Chk("F solo-iniciativa inc slot vacio", "", Tipo(solo, "inc", "slot"));
        Chk("F solo-iniciativa req mes vacio", "", Tipo(solo, "req", "mes"));
        var soloC1 = Buscar(cats, "Solo", "C1");
        Chk("F solo-iniciativa C1 trae vol_tipo", "", Tipo(soloC1, "inc", "slot"));

        // ---- G) un solo tipo ----
        Chk("G /Red/WAN sin incidentes", "", Tipo(Buscar(v2, "/Red/WAN", null), "inc", "slot"));
        var bot = Buscar(v2, "/Sorx/Bot", null);
        Chk("G /Sorx/Bot solo SorIA: Todos 3", "0=3", Serie(bot["vol_slot"]));
        Chk("G /Sorx/Bot solo SorIA: inc vacio", "", Tipo(bot, "inc", "slot"));
        Chk("G /Sorx/Bot solo SorIA: req vacio", "", Tipo(bot, "req", "slot"));

        // ---- campos que no son de volumen: intactos ----
        Chk("ticket_reduce no depende del tipo", 4, sw["ticket_reduce"]);
        Chk("ini_total del C1 no depende del tipo", 4, red["ini_total"]);

        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLA(S)");
        Environment.Exit(fallos == 0 ? 0 : 1);
    }
}
