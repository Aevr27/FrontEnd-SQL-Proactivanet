// Prueba offline de ExperienciaQueries.ArmarRegistro (App_Code/ExperienciaRegistro.cs),
// la proyeccion por folio del registro de admin/iniciativas.html. Sin SQL
// Server: como DuenosIniciativaExperienciaSmoke.cs, entra por reflexion a los
// privados de ExperienciaQueries con filas armadas a mano, ya pasadas por
// Canonizar y Semaforo (lo que deja LeerIniciativas).
//
// Casos:
//   1) un folio con dos categorias -> UNA iniciativa; tickets_reduce y
//      vol_reduce_folio = suma de sus filas; categorias en su orden, cada una
//      con sus dueños y su pct_dism
//   2) retrasada -> riesgo_folio = vol_reduce_folio; retrazado = 1
//   3) activa con agrupador fuera de los cuatro -> activa, sin seguimiento
//   4) estado "EN ANALISIS" -> canonizado, activa y en seguimiento
//   5) cerrada -> no activa, sem verde, riesgo 0
//   6) sin categoria: se agrega con sin_categoria = true y categorias vacias;
//      un folio que ya vino con categoria no se repite
//   7) la misma suma que reducePorFolio de ArmarCategorias (vol_reduce_folio
//      de Experiencia) para el mismo detalle
//   8) el archivo no tiene SQL que escriba
//   9) tipo_iniciativa: el TipoIniciativa del folio (DashboardCatalogos
//      .TiposPorFolio, grafia del catalogo), null sin tipo; agrup no cambia
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:RegistroSmoke.exe /r:System.dll /r:System.Core.dll tools\tests\RegistroIniciativasSmoke.cs
//   RegistroSmoke.exe exp.dll
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;

public static class RegistroSmoke
{
    static Type T, TDet, TDue;
    static int fallos = 0;
    static readonly DateTime HOY = new DateTime(2026, 10, 1);

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static object Nuevo(Type t) { return Activator.CreateInstance(t, true); }
    static void Set(object o, string campo, object v)
    {
        o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).SetValue(o, v);
    }
    static MethodInfo M(string nombre) { return T.GetMethod(nombre, BindingFlags.NonPublic | BindingFlags.Static); }

    static object Det(string folio, string ruta, string estado, string agrup, int reduce, double pct,
                      string fAnalisis, string fSolucion, string po, string so, string dir)
    {
        var d = Nuevo(TDet);
        Set(d, "Folio", folio); Set(d, "Categoria", ruta);
        Set(d, "Titulo", "T " + folio); Set(d, "TituloProblem", "TP " + folio);
        Set(d, "Estado", estado); Set(d, "Agrup", agrup);
        Set(d, "TicketsReduce", reduce); Set(d, "PctDisminucion", pct);
        Set(d, "FAnalisis", fAnalisis); Set(d, "FSolucion", fSolucion);
        Set(d, "Po", po); Set(d, "So", so); Set(d, "Director", dir);
        M("Canonizar").Invoke(null, new object[] { d });
        M("Semaforo").Invoke(null, new object[] { d, HOY });
        return d;
    }

    static Dictionary<string, object> Ini(IList lista, string folio)
    {
        foreach (Dictionary<string, object> i in lista) if ((string)i["folio"] == folio) return i;
        return null;
    }

    public static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(Path.GetFullPath(args.Length > 0 ? args[0] : "exp.dll"));
        T = asm.GetType("ExperienciaQueries");
        TDet = T.GetNestedType("Detalle", BindingFlags.NonPublic);
        var TDir = asm.GetType("DirectorioOrganizacional");
        TDue = TDir.GetNestedType("Dueno");

        // Directorio minimo: el Manager de "SO x".
        var duenos = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(TDue));
        var personas = new Dictionary<string, string>(); personas["SO x"] = "Mgr 1";
        var dir = Activator.CreateInstance(TDir, new object[] { duenos, personas });

        var detalle = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(TDet));
        detalle.Add(Det("PRB 1", "/A/Cat 1/Hoja", "En Solución", "Problem", 100, 0.5, null, "2026-09-01", "PO 1", "SO x", "Dir A"));
        detalle.Add(Det("PRB 1", "/A/Cat 3", "En Solución", "Problem", 50, 0.25, null, "2026-09-01", "PO 2", "SO x", "Dir A"));
        detalle.Add(Det("REQ 2", "/B/Cat 5", "En Análisis", "ReqOpr", 5, 0.1, "2026-12-01", null, "PO 3", "SO z", "Dir B"));
        detalle.Add(Det("MAP 3", "/A/Cat 2", "EN ANALISIS", "mejora", 40, 1.0, "2026-12-01", null, "PO 1", "SO y", "Dir A"));
        detalle.Add(Det("HAR 4", "/B/Cat 4", "Cerrado", "Problem", 30, 0.3, null, null, "PO 3", "SO z", "Dir B"));

        // Sueltas, ya con la forma de Iniciativa() (como LeerIniciativasSinCategoria)
        var sueltas = new List<object>();
        var dSuelta = Det("PRB 5", null, "En Análisis", "Problem", 0, 0, "2026-02-01", null, "PO 1", "SO w", "Dir B");
        sueltas.Add(M("Iniciativa").Invoke(null, new object[] { dSuelta, 0, 0, dir }));
        var dRepetida = Det("PRB 1", null, "En Análisis", "Problem", 0, 0, null, null, "X", "X", "X");
        sueltas.Add(M("Iniciativa").Invoke(null, new object[] { dRepetida, 0, 0, dir }));

        // 9) Tipos por folio como los arma TiposIniciativaPorFolio: normalizados
        // y con la grafia de TiposUnicos ("mejora " -> "Mejora"). REQ 2 y
        // HAR 4 sin tipo; " " no es tipo.
        var TCat = asm.GetType("DashboardCatalogos");
        var pares = new List<KeyValuePair<string, string>> {
            new KeyValuePair<string, string>("PRB 1", "Problema"),
            new KeyValuePair<string, string>("MAP 3", "mejora "),
            new KeyValuePair<string, string>("PRB 5", "Mejora"),
            new KeyValuePair<string, string>("HAR 4", " "),
            new KeyValuePair<string, string>("PRB 1", "Otro"),
        };
        var tipos = (Dictionary<string, string>)TCat.GetMethod("TiposPorFolio").Invoke(null, new object[] { pares });
        Check("9 TiposPorFolio: grafia unica, sin vacios, el primero gana",
            "PRB 1=Problema,MAP 3=Mejora,PRB 5=Mejora", string.Join(",", ToPares(tipos)));
        Check("9 mismas grafias que el catalogo TiposIniciativa", "Mejora,Problema",
            string.Join(",", ToStr((IList)TCat.GetMethod("TiposUnicos").Invoke(null, new object[] { new[] { "Problema", "mejora ", "Mejora", " " } }))));

        var salida = (Dictionary<string, object>)M("ArmarRegistro").Invoke(null, new object[] { detalle, sueltas, dir, tipos });
        var lista = (IList)salida["iniciativas"];

        Check("orden y cuenta: una por folio, sueltas al final, sin repetir",
            "PRB 1,REQ 2,MAP 3,HAR 4,PRB 5",
            string.Join(",", ToFolios(lista)));

        var p1 = Ini(lista, "PRB 1");
        Check("1 tickets_reduce = suma", 150, p1["tickets_reduce"]);
        Check("1 vol_reduce_folio = suma", 150, p1["vol_reduce_folio"]);
        var cats = (IList)p1["categorias"];
        Check("1 dos categorias", 2, cats.Count);
        var c0 = (Dictionary<string, object>)cats[0];
        var c1 = (Dictionary<string, object>)cats[1];
        Check("1 categoria 1", "/A/Cat 1/Hoja|100|0.5|PO 1|SO x|Dir A",
            c0["categoria"] + "|" + c0["tickets_reduce"] + "|" + Convert.ToString(c0["pct_dism"], System.Globalization.CultureInfo.InvariantCulture) + "|" + c0["po"] + "|" + c0["so"] + "|" + c0["director"]);
        Check("1 categoria 2 con su propio PO", "/A/Cat 3|50|PO 2", c1["categoria"] + "|" + c1["tickets_reduce"] + "|" + c1["po"]);
        Check("1 manager del SO (CatPersona)", "Mgr 1", p1["manager"]);
        Check("2 retrasada: riesgo_folio y retrazado", "150|1|rojo|True", p1["riesgo_folio"] + "|" + p1["retrazado"] + "|" + p1["sem_fecha"] + "|" + p1["seguimiento"]);

        var r2 = Ini(lista, "REQ 2");
        Check("3 ReqOpr activo: activa sin seguimiento", "True|False", r2["activa"] + "|" + r2["seguimiento"]);

        var m3 = Ini(lista, "MAP 3");
        Check("4 grafia canonizada, en seguimiento", "En Análisis|Mejora|True|True", m3["estado"] + "|" + m3["agrup"] + "|" + m3["activa"] + "|" + m3["seguimiento"]);

        var h4 = Ini(lista, "HAR 4");
        Check("5 cerrada", "False|False|verde|0", h4["activa"] + "|" + h4["seguimiento"] + "|" + h4["sem_fecha"] + "|" + h4["riesgo_folio"]);

        var p5 = Ini(lista, "PRB 5");
        Check("6 sin categoria", "True|0|True|PO 1|rojo", p5["sin_categoria"] + "|" + ((IList)p5["categorias"]).Count + "|" + p5["seguimiento"] + "|" + p5["po"] + "|" + p5["sem_fecha"]);
        Check("6 la con categoria no es sin_categoria", false, p1["sin_categoria"]);

        // 7) La misma suma por folio que vol_reduce_folio de Experiencia:
        // ArmarCategorias -> Iniciativas -> Iniciativa(d, rama, reducePorFolio).
        var vacia = typeof(List<>).MakeGenericType(T.GetNestedType("Volumen", BindingFlags.NonPublic));
        var v = Activator.CreateInstance(vacia);
        var categorias = (IList)M("ArmarCategorias").Invoke(null, new object[] { v, v, v, v, detalle, dir, 10 });
        int volExp = -1;
        foreach (Dictionary<string, object> c in categorias)
            foreach (Dictionary<string, object> i in (IList)c["iniciativas"])
                if ((string)i["folio"] == "PRB 1") volExp = (int)i["vol_reduce_folio"];
        Check("7 mismo vol_reduce_folio que Experiencia", volExp, p1["vol_reduce_folio"]);

        Check("9 tipo_iniciativa por folio", "Problema|Mejora|Mejora||",
            p1["tipo_iniciativa"] + "|" + m3["tipo_iniciativa"] + "|" + p5["tipo_iniciativa"] + "|" + r2["tipo_iniciativa"] + "|" + h4["tipo_iniciativa"]);
        Check("9 sin tipo = null, no texto", true, r2.ContainsKey("tipo_iniciativa") && r2["tipo_iniciativa"] == null);
        Check("9 agrup sigue siendo TipoAgrupado", "Problem|ReqOpr", p1["agrup"] + "|" + r2["agrup"]);
        var sinTipos = (Dictionary<string, object>)M("ArmarRegistro").Invoke(null, new object[] { detalle, new List<object>(), dir, null });
        Check("9 sin mapa de tipos: null en todas", null, Ini((IList)sinTipos["iniciativas"], "PRB 1")["tipo_iniciativa"]);

        Check("listas del contrato", "En Análisis,En Solución,En Monitoreo|Problem,SorIA,Adopcion,Mejora",
            string.Join(",", ToStr((IList)salida["estados_activos"])) + "|" + string.Join(",", ToStr((IList)salida["agrupadores"])));

        // 8) Solo lectura
        var fuente = File.ReadAllText("App_Code/ExperienciaRegistro.cs");
        var codigo = Regex.Replace(fuente, @"//[^\n]*", "");
        Check("8 sin SQL de escritura", false,
            Regex.IsMatch(codigo, @"\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP|TRUNCATE)\b", RegexOptions.IgnoreCase));

        Console.WriteLine(fallos == 0 ? "\nTODO PASO" : "\n" + fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }

    static List<string> ToFolios(IList lista)
    {
        var s = new List<string>();
        foreach (Dictionary<string, object> i in lista) s.Add((string)i["folio"]);
        return s;
    }
    static List<string> ToPares(Dictionary<string, string> d)
    {
        var s = new List<string>();
        foreach (var kv in d) s.Add(kv.Key + "=" + kv.Value);
        return s;
    }
    static List<string> ToStr(IList lista)
    {
        var s = new List<string>();
        foreach (var o in lista) s.Add(Convert.ToString(o));
        return s;
    }
}
