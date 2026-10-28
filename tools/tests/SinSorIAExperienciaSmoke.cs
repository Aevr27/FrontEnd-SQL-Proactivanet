// Prueba offline de "Experiencia sin SorIA" (ExperienciaQueries.SinSorIA):
// el volumen de Experiencia no cuenta los tickets de tipo 'SorIA
// Incidentes' / 'SorIA Peticiones' (columnas de vw_TBSlotCAT / vw_TBMesCAT)
// y la volumetria de Admin no cambia. Sin SQL Server: SinSorIA, Replegar,
// ArmarCategorias y ArmarCategoriasV2 por reflexion, como
// TiposRegistroExperienciaSmoke.cs.
//
// Lo que fija:
//   S1 Volumen Actual (slot 0) y el mes en curso: Total - SorIA;
//   S2 'Sin tipo' y otros tipos siguen contando; Inc / Req no cambian;
//   S3 una fila (o categoria) con solo SorIA desaparece; la categoria que
//      solo existe por su iniciativa sigue (con 0);
//   S4 slot y mes con la misma regla; periodos anteriores tambien;
//   S5 C1 = suma de sus rutas completas (base de KPI-2 + KPI-5 = KPI-1);
//   S6 SinSorIA no toca la lista que recibe;
//   S7 Admin: VolumenSlot0PorCategoria sigue leyendo Total general, sin
//      SinSorIA; Construir si lo aplica a las dos vistas.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:SinSorIASmoke.exe /r:System.dll /r:System.Core.dll ^
//       tools\tests\SinSorIAExperienciaSmoke.cs
//   SinSorIASmoke.exe exp.dll
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;

public static class SinSorIASmoke
{
    static Type T, TVol, TDet, TDue, TDir;
    static int fallos = 0;

    static object Nuevo(Type t) { return Activator.CreateInstance(t, true); }
    static void Set(object o, string campo, object v) { o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).SetValue(o, v); }
    static object Get(object o, string campo) { return o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).GetValue(o); }
    static IList Lista(Type t) { return (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(t)); }
    static MethodInfo M(string nombre) { return T.GetMethod(nombre, BindingFlags.NonPublic | BindingFlags.Static); }

    // inc, pet, sor (SorIA Pet + Inc) y total = lo que trae [Total general].
    static object Vol(int periodo, string llave, int inc, int pet, int sor, int total)
    {
        var v = Nuevo(TVol);
        Set(v, "Periodo", periodo); Set(v, "Llave", llave);
        Set(v, "Inc", inc); Set(v, "Pet", pet); Set(v, "Sor", sor); Set(v, "Total", total);
        return v;
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
    // "    private static" / "    public static"), para las pruebas de S7.
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

        // Filas de vw_TBSlotCAT / vw_TBMesCAT. /Red/LAN/Switch slot 0 en DOS
        // filas (dos Tipo relacion): 6 inc + 3 pet + 2 SorIA + 1 Sin tipo = 12,
        // y 0 + 0 + 1 SorIA + 0 = 1 (solo SorIA).
        var slotCat = Lista(TVol);
        slotCat.Add(Vol(0, "/Red/LAN/Switch", 6, 3, 2, 12));
        slotCat.Add(Vol(0, "/Red/LAN/Switch", 0, 0, 1, 1));
        slotCat.Add(Vol(1, "/Red/LAN/Switch", 4, 2, 3, 9));
        slotCat.Add(Vol(0, "/Red/WAN", 0, 5, 0, 5));
        slotCat.Add(Vol(0, "/Sorx/Bot", 0, 0, 3, 3));        // solo SorIA
        slotCat.Add(Vol(0, "/Otro/SinTipo", 0, 0, 0, 2));    // solo "Sin tipo"
        var mesCat = Lista(TVol);
        mesCat.Add(Vol(10, "/Red/LAN/Switch", 7, 1, 4, 13));
        mesCat.Add(Vol(9, "/Red/WAN", 0, 4, 1, 5));
        mesCat.Add(Vol(10, "/Sorx/Bot", 0, 0, 6, 6));

        var sin = M("SinSorIA");
        var slot = (IList)sin.Invoke(null, new object[] { slotCat });
        var mes = (IList)sin.Invoke(null, new object[] { mesCat });

        // S6: la lista de entrada no cambia.
        Chk("S6 SinSorIA no toca la entrada (Total de la 1a fila sigue 12, 6 filas)", "12|6",
            Get(slotCat[0], "Total") + "|" + slotCat.Count);
        Chk("S3 la fila de solo SorIA se descarta (slot: 6 -> 4 filas; mes: 3 -> 2)", "4|2", slot.Count + "|" + mes.Count);

        var slotC1 = (IList)M("Replegar").Invoke(null, new object[] { slot, true });
        var slotC2 = (IList)M("Replegar").Invoke(null, new object[] { slot, false });
        var mesC1 = (IList)M("Replegar").Invoke(null, new object[] { mes, true });
        var mesC2 = (IList)M("Replegar").Invoke(null, new object[] { mes, false });
        var detalle = Lista(TDet);
        detalle.Add(Det("P1", "/Red/LAN/Switch", "Red", "/Red/LAN", 4));
        detalle.Add(Det("P2", "/Sorx/Bot", "Sorx", "/Sorx/Bot", 2));   // solo SorIA, pero con iniciativa
        var dir = Activator.CreateInstance(TDir, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
            null, new object[] { Lista(TDue), new Dictionary<string, string>() }, null);
        var cats = (IList)M("ArmarCategorias").Invoke(null, new object[] { slotC1, slotC2, mesC1, mesC2, detalle, dir, 10 });
        var v2 = (IList)M("ArmarCategoriasV2").Invoke(null, new object[] { slot, mes, detalle, dir });

        var sw = Buscar(v2, "/Red/LAN/Switch", null);
        Chk("S1 ruta: slot 0 = 12 + 1 - 3 SorIA = 10; slot 1 = 9 - 3 = 6", "0=10,1=6", Serie(sw["vol_slot"]));
        Chk("S4 ruta: mes 10 = 13 - 4 = 9", "10=9", Serie(sw["vol_mes"]));
        var red = Buscar(cats, "Red", "C1");
        Chk("S1 C1 Volumen Actual (slot 0) = 10 + 5", 15, red["vol_actual"]);
        Chk("S4 C1 mes en curso (10) = 9; mes anterior (9) = 5 - 1 = 4", "9|4", red["vol_actual_mes"] + "|" + red["vol_anterior_mes"]);
        Chk("S4 C1 delta = 15 - 6", 9, red["delta"]);
        Chk("S2 Incidentes / Requerimientos intactos (columna tal cual)", "0=6,1=4|0=3,1=2|10=7",
            Tipo(sw, "inc", "slot") + "|" + Tipo(sw, "req", "slot") + "|" + Tipo(sw, "inc", "mes"));
        Chk("S2 'Sin tipo' sigue contando", "0=2", Serie(Buscar(v2, "/Otro/SinTipo", null)["vol_slot"]));
        var lan = Buscar(cats, "/Red/LAN", "C2");
        Chk("S2 reqopr del slot 0 = Sin tipo (1), ya sin SorIA", 1, lan["reqopr"]);
        var bot = Buscar(v2, "/Sorx/Bot", null);
        Chk("S3 categoria de solo SorIA con iniciativa: sigue, con volumen 0", "|", (bot == null ? "falta" : Serie(bot["vol_slot"]) + "|" + Serie(bot["vol_mes"])));
        Chk("S3 su C1 tampoco suma volumen", 0, Buscar(cats, "Sorx", "C1") == null ? 0 : Convert.ToInt32(Buscar(cats, "Sorx", "C1")["vol_actual"]));

        // S5: C1 = suma de sus rutas completas (la base de KPI-2/KPI-5).
        int hojas = 0;
        foreach (Dictionary<string, object> f in v2)
            if (((string)f["categoria"]).StartsWith("/Red/", StringComparison.Ordinal)) hojas += Valor(f["vol_slot"], "0");
        Chk("S5 C1 Red = suma de sus rutas completas en slot 0", red["vol_actual"], hojas);

        // S7: Admin no pasa por SinSorIA; Construir si.
        var raiz = Directory.GetCurrentDirectory();
        var fuenteVol = File.ReadAllText(Path.Combine(raiz, @"App_Code\ExperienciaVolumetria.cs"));
        var fuenteExp = File.ReadAllText(Path.Combine(raiz, @"App_Code\ExperienciaQueries.cs"));
        var admin = Cuerpo(fuenteVol, "public static Dictionary<string, int> VolumenSlot0PorCategoria");
        Chk("S7 Admin (VolumenSlot0PorCategoria): LeerVolumen y v.Total, sin SinSorIA", "True|True|False",
            admin.Contains("LeerVolumen(cn, \"dbo.vw_TBSlotCAT\"") + "|" + admin.Contains("+ v.Total") + "|" + admin.Contains("SinSorIA"));
        Chk("S7 SinSorIA solo se usa en Construir (las dos vistas)", 2,
            Regex.Matches(fuenteExp, @"SinSorIA\(LeerVolumen\(cn, ""dbo\.vw_TB(Slot|Mes)CAT""").Count);
        Chk("S7 LeerVolumen sigue devolviendo Total general completo (Total = SUM([Total general]))", true,
            fuenteExp.Contains(".Append(\", Total = SUM([Total general])\")"));

        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
