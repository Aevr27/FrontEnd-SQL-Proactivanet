// Prueba offline del alta de categoria (App_Code/AltaCategoriaProactivanet.cs):
// sin IIS, sin SQL y SIN RED. Comprueba ademas, leyendo el fuente, que ni el
// modelo ni el handler tienen un cliente HTTP (no pueden escribir en
// Proactivanet).
//
// Casos:
//   I) Integracion: constante false; el JSON nunca dice enviada/creada.
//   F) Formato: nombre vacio, con "/", orden no entero.
//   P) Padre: inexistente, dado de baja, raiz (advertencia).
//   D) Duplicados: ruta activa = error; solo dada de baja = advertencia;
//      sin distinguir mayusculas ni "/" de los extremos.
//   C) Cuerpo: CategoryDTO de API.html; PadCategories_id nunca inventado.
//   S) Fuente: sin WebClient/HttpClient/HttpWebRequest/WebRequest.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:AltaCategoriaSmoke.exe /r:adm.dll /r:System.dll tools\tests\AltaCategoriaSmoke.cs
//   AltaCategoriaSmoke.exe
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

public static class AltaCategoriaSmoke
{
    static int fallos = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, System.Globalization.CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, System.Globalization.CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static RutaCategoria R(string ruta, bool activa) { return new RutaCategoria { Ruta = ruta, Activa = activa }; }

    static readonly List<RutaCategoria> Rutas = new List<RutaCategoria>
    {
        R("/Sistemas", true), R("/Sistemas/Correo", true), R("/Sistemas/Correo", false),
        R("/Sistemas/Viejo", false), R("/Baja", false),
    };

    static PeticionAltaCategoria P(string padre, string nombre, string orden = null, bool problemas = true)
    {
        return new PeticionAltaCategoria { Padre = padre, Nombre = nombre, Orden = orden, AplicaProblemas = problemas };
    }

    static string Campos(ResultadoAltaCategoria r) { return string.Join(",", r.Errores.Select(e => e.Campo).ToArray()); }
    static ResultadoAltaCategoria V(PeticionAltaCategoria p) { return new ValidadorAltaCategoria().Validar(p, Rutas); }

    public static int Main()
    {
        // ---- I ----
        Check("I1 integracion es constante false", false, IntegracionCategoriasProactivanet.Habilitada);
        var j = V(P("/Sistemas", "Nueva")).ComoJson();
        Check("I2 valida: enviada=false, creada=false, no_habilitada", "True|False|False|no_habilitada",
            j["valida"] + "|" + j["enviada"] + "|" + j["creada"] + "|" + j["integracion"]);
        var ji = V(P("/Nada", "X")).ComoJson();
        Check("I3 invalida: sin envio ni motivo de 'se valido'", "False||", ji["valida"] + "|" + ji["envio"] + "|" + ji["integracion_motivo"]);

        // ---- F ----
        var v = new ValidadorAltaCategoria();
        Check("F1 nombre vacio", "nombre", Campos(v.Formato(P("/Sistemas", "  "))));
        Check("F2 nombre con /", "nombre", Campos(v.Formato(P("/Sistemas", "A/B"))));
        Check("F3 orden no entero", "orden", Campos(v.Formato(P("/Sistemas", "A", "1.5"))));
        Check("F4 orden entero", "", Campos(v.Formato(P("/Sistemas", "A", "10"))));

        // ---- P ----
        Check("P1 padre inexistente", "padre", Campos(V(P("/No/Existe", "A"))));
        Check("P2 padre dado de baja", "padre", Campos(V(P("/Sistemas/Viejo", "A"))));
        var raiz = V(P("", "Nuevo C1"));
        Check("P3 raiz: valida con advertencia, ruta /Nuevo C1", "True|True|/Nuevo C1",
            raiz.Valida + "|" + raiz.Advertencias.Any(a => a.Contains("C1 nuevo")) + "|" + raiz.RutaResultante);
        Check("P4 padre con otra grafia (mayusculas, / final)", "True|/sistemas/Nueva",
            V(P("sistemas/", "Nueva")).Valida + "|" + V(P("sistemas/", "Nueva")).RutaResultante);
        Check("P5 activa si alguna fila de la ruta lo esta", "", Campos(V(P("/Sistemas/Correo", "Hija"))));

        // ---- D ----
        Check("D1 ya existe activa (sin distinguir mayusculas)", "nombre", Campos(V(P("/SISTEMAS", "correo"))));
        var baja = V(P("/Sistemas", "Viejo"));
        Check("D2 existe solo dada de baja: valida con advertencia", "True|True",
            baja.Valida + "|" + baja.Advertencias.Any(a => a.Contains("dada de baja")));
        Check("D3 sin aplica-a: advertencia", true, V(P("/Sistemas", "Z", null, false)).Advertencias.Any(a => a.Contains("aplica")));

        // ---- C ----
        var c = V(P("/Sistemas", " Nueva ", "7")).Cuerpo;
        Check("C1 campos de CategoryDTO", "AppliesToIncidents,AppliesToKB,AppliesToProblems,AppliesToRFCs,Description,Inactive,Name,PadCategories_id,PadCategories_ruta,Sort",
            string.Join(",", c.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray()));
        Check("C2 valores", "Nueva|7|True|False|False", c["Name"] + "|" + c["Sort"] + "|" + c["AppliesToProblems"] + "|" + c["AppliesToIncidents"] + "|" + c["Inactive"]);
        Check("C3 PadCategories_id nunca inventado; la ruta del padre aparte", "|/Sistemas", c["PadCategories_id"] + "|" + c["PadCategories_ruta"]);
        var envio = (Dictionary<string, object>)j["envio"];
        Check("C4 envio describe POST /api/Categories", "POST /api/Categories", envio["metodo"] + " " + envio["ruta"]);

        // ---- S ----
        foreach (var f in new[] { @"App_Code\AltaCategoriaProactivanet.cs", @"handlers\admin_categorias_alta.ashx" })
        {
            var src = File.ReadAllText(f);
            var codigo = string.Join("\n", src.Split('\n').Where(l => !l.TrimStart().StartsWith("//")).ToArray());
            Check("S1 " + f + " sin cliente HTTP", false,
                codigo.Contains("WebClient") || codigo.Contains("HttpClient") || codigo.Contains("WebRequest") || codigo.Contains("System.Net"));
        }

        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
