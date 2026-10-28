// Prueba offline de como el registro de Admin lee las fechas por categoria
// (sql/18: dbo.ProblemCategoria.FechaCreacionCategoria / FechaAnalisisCategoria)
// - ExperienciaRegistro.AplicarFechasPropias, privada, por reflexion -. Fija
// la regla de herencia (NO es un defecto que las iniciales tengan NULL):
//
//   F1 una categoria inicial (NULL / NULL: no esta en PorCategoria) sale con
//      f_creacion_propia / f_analisis_propia = null: la pantalla y el Excel
//      usan entonces las de la iniciativa (f_creacion, f_analisis);
//   F2 una ligada despues conserva SUS fechas;
//   F3 i["f_analisis"] es la de la INICIATIVA aunque la primera fila sea una
//      categoria con fecha propia;
//   F4 la llave es folio + ruta: otra iniciativa con la misma ruta no se
//      lleva la fecha;
//   F5 el lector solo pide las filas con fecha propia (FechaAnalisisCategoria
//      IS NOT NULL) y vigentes, y sin las columnas (sql/18 sin aplicar) no las
//      pide: todas heredan.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:FechasSmoke.exe /r:System.dll /r:System.Core.dll tools\tests\FechasCategoriaRegistroSmoke.cs
//   FechasSmoke.exe exp.dll
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

public static class FechasCategoriaRegistroSmoke
{
    static int fallos = 0;
    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado) ?? "null";
        var o = Convert.ToString(obtenido) ?? "null";
        if (esperado == null) e = "null";
        if (obtenido == null) o = "null";
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine("{0}  {1}  esperado={2}  obtenido={3}", ok ? "PASS" : "FALLA", caso, e, o);
    }

    static Dictionary<string, object> Cat(string ruta) { return new Dictionary<string, object> { { "categoria", ruta } }; }

    public static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args[0]);
        var t = asm.GetType("ExperienciaQueries");
        var tf = t.GetNestedType("FechasPropias", BindingFlags.Public | BindingFlags.NonPublic);
        var aplicar = t.GetMethod("AplicarFechasPropias", BindingFlags.NonPublic | BindingFlags.Static);
        var sep = (string)t.GetField("SEP_FECHAS", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);

        var f = Activator.CreateInstance(tf);
        var analisis = (Dictionary<string, string>)tf.GetField("AnalisisIniciativa").GetValue(f);
        var porCat = (Dictionary<string, string[]>)tf.GetField("PorCategoria").GetValue(f);
        analisis["PRB 2026-000001"] = "2026-10-28";
        analisis["PRB 2026-000002"] = "2026-11-05";
        porCat["PRB 2026-000001" + sep + "/A/Ligada despues"] = new[] { "2026-11-02", "2026-11-17" };

        var i1 = new Dictionary<string, object> { { "folio", "PRB 2026-000001" }, { "f_analisis", "2026-11-17" }, { "f_creacion", "2026-10-13" },
            { "categorias", new List<object> { Cat("/A/Ligada despues"), Cat("/A/Inicial") } } };
        var i2 = new Dictionary<string, object> { { "folio", "PRB 2026-000002" }, { "f_analisis", "2026-11-05" }, { "f_creacion", "2026-10-21" },
            { "categorias", new List<object> { Cat("/A/Ligada despues") } } };
        var salida = new Dictionary<string, object> { { "iniciativas", new List<object> { i1, i2 } } };
        aplicar.Invoke(null, new object[] { salida, f });

        var c1 = (Dictionary<string, object>)((List<object>)i1["categorias"])[0];
        var c2 = (Dictionary<string, object>)((List<object>)i1["categorias"])[1];
        var c3 = (Dictionary<string, object>)((List<object>)i2["categorias"])[0];
        Chk("F1 inicial: sin fechas propias (hereda: la pantalla usa las de la iniciativa)", "null|null",
            (c2["f_creacion_propia"] ?? "null") + "|" + (c2["f_analisis_propia"] ?? "null"));
        Chk("F2 ligada despues: SUS fechas", "2026-11-02|2026-11-17", c1["f_creacion_propia"] + "|" + c1["f_analisis_propia"]);
        Chk("F3 f_analisis de la iniciativa, no de su primera categoria; f_creacion intacta", "2026-10-28|2026-10-13",
            i1["f_analisis"] + "|" + i1["f_creacion"]);
        Chk("F4 la misma ruta en otra iniciativa no se lleva la fecha", "null", c3["f_analisis_propia"] ?? "null");

        var fuente = File.ReadAllText(Path.Combine(Directory.GetCurrentDirectory(), @"App_Code\ExperienciaRegistro.cs"));
        Chk("F5 solo filas vigentes con fecha propia; sin columnas no se piden", "True|True",
            fuente.Contains("WHERE VigenteEnOrigen = 1 AND FechaAnalisisCategoria IS NOT NULL") + "|" +
            fuente.Contains("COL_LENGTH(N'dbo.ProblemCategoria', N'FechaAnalisisCategoria') IS NULL THEN 0"));

        // La alta (Crear) y la aprobacion de una Nueva solicitud (sql/32 llama
        // a Crear) dejan las iniciales en NULL a proposito; las ligadas despues
        // (Modificar / aplicar una solicitud) llevan hoy y hoy + 15.
        var raiz = Directory.GetCurrentDirectory();
        var s27 = File.ReadAllText(Path.Combine(raiz, @"sql\27_gestion_admin_crear_subestado.sql"));
        var s32 = File.ReadAllText(Path.Combine(raiz, @"sql\32_solicitud_iniciativa_aprobar_crea.sql"));
        Chk("F6 Crear: las iniciales sin fechas propias (herencia); la aprobacion pasa por Crear", "True|True",
            s27.Contains("INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoIniciativa, TipoAgrupado, PctDisminucion, VigenteEnOrigen)") + "|" +
            s32.Contains("EXEC adm.usp_GestionAdmin_Crear"));

        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
