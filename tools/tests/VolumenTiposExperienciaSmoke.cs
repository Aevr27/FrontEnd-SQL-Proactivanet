// Prueba offline de la agrupacion de tipos del volumen de Experiencia
// (ExperienciaQueries.VolumenDeColumnas): Incidentes = [Incidencia] +
// [SorIA Incidentes], Requerimientos = [Petición de Servicio] + [SorIA
// Peticiones], Todos = [Total general]. Sin SQL Server: VolumenDeColumnas,
// Replegar, ArmarCategorias y ArmarCategoriasV2 por reflexion, como
// TiposRegistroExperienciaSmoke.cs. La lectura SQL real de las dos vistas la
// prueba VolumenTiposVistasSqlLocalDbSmoke.cs.
//
// Lo que fija:
//   T1 Incidencia y SorIA Incidentes entran en Incidentes;
//   T2 Petición de Servicio y SorIA Peticiones entran en Requerimientos;
//   T3 Todos = Total general sin restar nada; 'Sin tipo' y otros solo ahi;
//   T4 Inc + Req + resto = Todos (nada se duplica ni se pierde), tambien con
//      dos filas del mismo periodo (dos Tipo relacion);
//   T5 slot y mes con la misma regla; periodos anteriores tambien; una
//      categoria de solo SorIA ya no desaparece;
//   T6 C1 = suma de sus rutas completas (base de KPI-2 + KPI-5 = KPI-1);
//   T7 fuente: las dos vistas se leen igual, sin filtro SorIA en volumen,
//      export ni automatizados; Admin sigue con Total general.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:VolumenTiposSmoke.exe /r:System.dll /r:System.Core.dll ^
//       tools\tests\VolumenTiposExperienciaSmoke.cs
//   VolumenTiposSmoke.exe exp.dll
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;

public static class VolumenTiposSmoke
{
    static Type T, TVol, TDet, TDue, TDir;
    static int fallos = 0;

    static object Nuevo(Type t) { return Activator.CreateInstance(t, true); }
    static void Set(object o, string campo, object v) { o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).SetValue(o, v); }
    static object Get(object o, string campo) { return o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).GetValue(o); }
    static IList Lista(Type t) { return (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(t)); }
    static MethodInfo M(string nombre) { return T.GetMethod(nombre, BindingFlags.NonPublic | BindingFlags.Static); }

    // Una fila de vw_TBSlotCAT / vw_TBMesCAT tal como la trae la vista:
    // las cuatro columnas de tipo y [Total general].
    static object Fila(int periodo, string llave, int inc, int sorInc, int pet, int sorPet, int total)
    {
        return M("VolumenDeColumnas").Invoke(null, new object[] { periodo, llave, inc, sorInc, pet, sorPet, total });
    }

    static object Det(string folio, string cat, string c1, string c1c2, int reduce)
    {
        var d = Nuevo(TDet);
        Set(d, "Folio", folio); Set(d, "Categoria", cat); Set(d, "C1", c1); Set(d, "C1C2", c1c2);
        Set(d, "Titulo", "T " + folio); Set(d, "TituloProblem", "TP " + folio);
        Set(d, "Estado", "En Análisis"); Set(d, "Agrup", "Problem"); Set(d, "TicketsReduce", reduce);
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
        var ok = Equals(Convert.ToString(esperado, CultureInfo.InvariantCulture), Convert.ToString(obtenido, CultureInfo.InvariantCulture));
        if (!ok) fallos++;
        Console.WriteLine("{0}  {1}  esperado={2}  obtenido={3}", ok ? "PASS" : "FALLA", caso, esperado, obtenido);
    }

    // El cuerpo de un metodo del fuente (desde su firma hasta el siguiente
    // "    p..." a ese nivel de sangria).
    static string Cuerpo(string fuente, string firma)
    {
        var i = fuente.IndexOf(firma, StringComparison.Ordinal);
        if (i < 0) return "";
        var j = fuente.IndexOf("\n    p", i + firma.Length, StringComparison.Ordinal);
        return j < 0 ? fuente.Substring(i) : fuente.Substring(i, j - i);
    }

    public static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args[0]);
        T = asm.GetType("ExperienciaQueries");
        TVol = T.GetNestedType("Volumen", BindingFlags.NonPublic);
        TDet = T.GetNestedType("Detalle", BindingFlags.NonPublic);
        TDir = asm.GetType("DirectorioOrganizacional");
        TDue = TDir.GetNestedType("Dueno");

        // T1/T2 sobre una fila: 6 inc + 2 SorIA inc, 3 pet + 4 SorIA pet,
        // 1 'Sin tipo' = 16.
        var una = Fila(0, "/X", 6, 2, 3, 4, 16);
        Chk("T1 Incidentes = Incidencia + SorIA Incidentes", 8, Get(una, "Inc"));
        Chk("T2 Requerimientos = Petición de Servicio + SorIA Peticiones", 7, Get(una, "Pet"));
        Chk("T3 Todos = Total general tal cual", 16, Get(una, "Total"));
        Chk("T1 solo SorIA Incidentes cuenta como Incidentes", 5, Get(Fila(0, "/X", 0, 5, 0, 0, 5), "Inc"));
        Chk("T2 solo SorIA Peticiones cuenta como Requerimientos", 5, Get(Fila(0, "/X", 0, 0, 0, 5, 5), "Pet"));
        Chk("T3 solo 'Sin tipo': ni Inc ni Req, si Todos", "0|0|3",
            Get(Fila(0, "/X", 0, 0, 0, 0, 3), "Inc") + "|" + Get(Fila(0, "/X", 0, 0, 0, 0, 3), "Pet") + "|" + Get(Fila(0, "/X", 0, 0, 0, 0, 3), "Total"));

        // Filas de vw_TBSlotCAT / vw_TBMesCAT. /Red/LAN/Switch slot 0 en DOS
        // filas (dos Tipo relacion).
        var slotCat = Lista(TVol);
        slotCat.Add(Fila(0, "/Red/LAN/Switch", 6, 1, 3, 1, 12));   // + 1 Sin tipo
        slotCat.Add(Fila(0, "/Red/LAN/Switch", 0, 0, 0, 1, 1));
        slotCat.Add(Fila(1, "/Red/LAN/Switch", 4, 2, 2, 1, 9));
        slotCat.Add(Fila(0, "/Red/WAN", 0, 0, 5, 0, 5));
        slotCat.Add(Fila(0, "/Sorx/Bot", 0, 1, 0, 2, 3));          // solo SorIA
        slotCat.Add(Fila(0, "/Otro/SinTipo", 0, 0, 0, 0, 2));      // solo 'Sin tipo'
        var mesCat = Lista(TVol);
        mesCat.Add(Fila(10, "/Red/LAN/Switch", 7, 3, 1, 1, 13));   // + 1 otro tipo
        mesCat.Add(Fila(9, "/Red/WAN", 0, 0, 4, 1, 5));
        mesCat.Add(Fila(10, "/Sorx/Bot", 0, 2, 0, 4, 6));

        var slotC1 = (IList)M("Replegar").Invoke(null, new object[] { slotCat, true });
        var slotC2 = (IList)M("Replegar").Invoke(null, new object[] { slotCat, false });
        var mesC1 = (IList)M("Replegar").Invoke(null, new object[] { mesCat, true });
        var mesC2 = (IList)M("Replegar").Invoke(null, new object[] { mesCat, false });
        var detalle = Lista(TDet);
        detalle.Add(Det("P1", "/Red/LAN/Switch", "Red", "/Red/LAN", 4));
        detalle.Add(Det("P2", "/Sorx/Bot", "Sorx", "/Sorx/Bot", 2));
        var dir = Activator.CreateInstance(TDir, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
            null, new object[] { Lista(TDue), new Dictionary<string, string>() }, null);
        var cats = (IList)M("ArmarCategorias").Invoke(null, new object[] { slotC1, slotC2, mesC1, mesC2, detalle, dir, 10 });
        var v2 = (IList)M("ArmarCategoriasV2").Invoke(null, new object[] { slotCat, mesCat, detalle, dir });

        var sw = Buscar(v2, "/Red/LAN/Switch", null);
        Chk("T3 ruta Todos: slot 0 = 12 + 1, slot 1 = 9", "0=13,1=9", Serie(sw["vol_slot"]));
        Chk("T5 ruta Todos mes 10 = 13", "10=13", Serie(sw["vol_mes"]));
        Chk("T1 ruta Incidentes slot (6+1, 4+2)", "0=7,1=6", Tipo(sw, "inc", "slot"));
        Chk("T2 ruta Requerimientos slot (3+1+1, 2+1)", "0=5,1=3", Tipo(sw, "req", "slot"));
        Chk("T5 ruta Incidentes / Requerimientos mes (7+3, 1+1)", "10=10|10=2", Tipo(sw, "inc", "mes") + "|" + Tipo(sw, "req", "mes"));

        var bot = Buscar(v2, "/Sorx/Bot", null);
        Chk("T5 categoria de solo SorIA: Todos slot / mes", "0=3|10=6", Serie(bot["vol_slot"]) + "|" + Serie(bot["vol_mes"]));
        Chk("T5 categoria de solo SorIA: Inc / Req slot", "0=1|0=2", Tipo(bot, "inc", "slot") + "|" + Tipo(bot, "req", "slot"));
        Chk("T3 'Sin tipo' sigue en Todos y en ningun tipo", "0=2||",
            Serie(Buscar(v2, "/Otro/SinTipo", null)["vol_slot"]) + "|" + Tipo(Buscar(v2, "/Otro/SinTipo", null), "inc", "slot")
            + "|" + Tipo(Buscar(v2, "/Otro/SinTipo", null), "req", "slot"));

        // T4: por periodo, Inc + Req + resto = Todos; el resto es exactamente
        // lo que no es de los cuatro tipos (1 'Sin tipo' + 2 'Sin tipo').
        int todos = 0, inc = 0, req = 0;
        foreach (Dictionary<string, object> f in v2)
        {
            todos += Valor(f["vol_slot"], "0");
            var vt = (Dictionary<string, object>)f["vol_tipo"];
            inc += Valor(((Dictionary<string, object>)vt["inc"])["slot"], "0");
            req += Valor(((Dictionary<string, object>)vt["req"])["slot"], "0");
        }
        Chk("T4 slot 0: Todos = 13 + 5 + 3 + 2", 23, todos);
        Chk("T4 slot 0: Incidentes = 7 + 0 + 1", 8, inc);
        Chk("T4 slot 0: Requerimientos = 5 + 5 + 2", 12, req);
        Chk("T4 slot 0: resto = solo 'Sin tipo' (1 + 2)", 3, todos - inc - req);

        var lan = Buscar(cats, "/Red/LAN", "C2");
        Chk("T4 reqopr slot 0 = 'Sin tipo' (1); inc + pet + reqopr = vol_actual", "7|5|1|13",
            lan["inc"] + "|" + lan["pet"] + "|" + lan["reqopr"] + "|" + lan["vol_actual"]);

        var red = Buscar(cats, "Red", "C1");
        Chk("T6 C1 Volumen Actual (slot 0) = 13 + 5", 18, red["vol_actual"]);
        Chk("T5 C1 mes en curso (10) = 13; anterior (9) = 5", "13|5", red["vol_actual_mes"] + "|" + red["vol_anterior_mes"]);
        Chk("T6 C1 Inc / Req slot", "0=7,1=6|0=10,1=3", Tipo(red, "inc", "slot") + "|" + Tipo(red, "req", "slot"));
        int hojas = 0;
        foreach (Dictionary<string, object> f in v2)
            if (((string)f["categoria"]).StartsWith("/Red/", StringComparison.Ordinal)) hojas += Valor(f["vol_slot"], "0");
        Chk("T6 C1 Red = suma de sus rutas completas en slot 0", red["vol_actual"], hojas);
        var sorx = Buscar(cats, "Sorx", "C1");
        Chk("T5 C1 de solo SorIA suma su volumen", 3, sorx == null ? 0 : Convert.ToInt32(sorx["vol_actual"]));

        // T7: fuente.
        var raiz = Directory.GetCurrentDirectory();
        var fuenteExp = File.ReadAllText(Path.Combine(raiz, @"App_Code\ExperienciaQueries.cs"));
        var fuenteVol = File.ReadAllText(Path.Combine(raiz, @"App_Code\ExperienciaVolumetria.cs"));
        var fuenteDash = File.ReadAllText(Path.Combine(raiz, @"App_Code\DashboardQueries.cs"));
        var fuenteAut = File.ReadAllText(Path.Combine(raiz, @"App_Code\ExperienciaAutomatizados.cs"));
        var leer = Cuerpo(fuenteExp, "private static List<Volumen> LeerVolumen");
        Chk("T7 LeerVolumen lee las cuatro columnas de tipo y Total general", "True|True|True|True|True",
            leer.Contains("SUM(ISNULL([Incidencia], 0))") + "|" + leer.Contains("SUM(ISNULL([SorIA Incidentes], 0))") + "|"
            + leer.Contains("SUM(ISNULL([Petición de Servicio], 0))") + "|" + leer.Contains("SUM(ISNULL([SorIA Peticiones], 0))") + "|"
            + leer.Contains("Total = SUM([Total general])"));
        Chk("T7 Construir lee vw_TBSlotCAT y vw_TBMesCAT con la misma llamada, sin filtro", 2,
            Regex.Matches(fuenteExp, @"= LeerVolumen\(cn, ""dbo\.vw_TB(Slot|Mes)CAT"", +""(Slot|Mes)"", +""\[Categoria V2\]""").Count);
        Chk("T7 ya no existe SinSorIA ni el filtro SorIA del export", "False|False",
            fuenteExp.Contains("SinSorIA(") + "|" + fuenteExp.Contains("NOT IN (N'SorIA"));
        Chk("T7 automatizados sin filtro SorIA", "False|False|True",
            fuenteDash.Contains("SinTiposSorIA") + "|" + fuenteDash.Contains("bool sinSorIA") + "|"
            + fuenteAut.Contains("AutomatizadosPorCategoria(f, modo == MODO_MES);"));
        var admin = Cuerpo(fuenteVol, "public static Dictionary<string, int> VolumenSlot0PorCategoria");
        Chk("T7 Admin (VolumenSlot0PorCategoria) sigue con Total general del SLOT 0", "True|True|True",
            admin.Contains("LeerVolumen(cn, \"dbo.vw_TBSlotCAT\"") + "|" + admin.Contains("+ v.Total") + "|" + admin.Contains("v.Periodo != 0"));

        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
