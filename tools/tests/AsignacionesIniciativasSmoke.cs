// Prueba offline de DirectorioOrganizacional.AsignacionesVigentes, el
// catalogo de los selects encadenados de admin/iniciativas.html. Sin SQL
// Server: arma el directorio con listas a mano por su constructor publico.
//
// Casos:
//   1) N2 con sus tres dueños                         -> sale tal cual
//   2) N2 sin SO propio                                -> hereda el del C1
//   3) N2 dado de baja (VigenteEnOrigen = 0)           -> no sale
//   4) N2 al que le falta Director aun heredando       -> no sale, cuenta en omitidas
//   5) NBSP y espacios de sobra                        -> normalizados
//   6) orden ordinal por categoria
//   7) el Manager no viaja
//
// Y DashboardCatalogos.TiposUnicos, la limpieza de los Tipo de iniciativa
// que lee TiposIniciativa (dbo.Problem.TipoIniciativa):
//   8) NBSP/espacios normalizados, vacios y null fuera
//   9) repetidos sin distinguir mayusculas: una sola grafia (la primera en
//      orden ordinal)
//  10) orden ordinal
//  11) la consulta de TiposIniciativa es solo lectura (SELECT)
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:dir.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:AsignacionesSmoke.exe /r:dir.dll /r:System.dll /r:System.Data.dll ^
//       tools\tests\AsignacionesIniciativasSmoke.cs
//   AsignacionesSmoke.exe
using System;
using System.Collections.Generic;

public static class AsignacionesIniciativasSmoke
{
    static int fallos = 0;
    static readonly string NBSP = ((char)0xA0).ToString();

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static DirectorioOrganizacional.Dueno D(string n2, string c1, string po, string so, string dir, bool vigente)
    {
        var d = new DirectorioOrganizacional.Dueno();
        d.CategoriaN2 = n2; d.C1 = c1; d.Po = po; d.So = so; d.Director = dir; d.Vigente = vigente;
        return d;
    }

    static string Fila(object o)
    {
        var f = (Dictionary<string, object>)o;
        return f["categoria"] + "|" + f["director"] + "|" + f["po"] + "|" + f["so"] + "|" + f.Count;
    }

    public static int Main()
    {
        // Como LeerDuenos: por C1, vigentes primero.
        var duenos = new List<DirectorioOrganizacional.Dueno>
        {
            D("/A/Uno",  "/A", "PO 1", "SO x", "Dir A", true),
            D("/A/Dos",  "/A", "PO 2", null,   "Dir A", true),     // hereda SO x del C1 (/A/Uno)
            D("/A/Baja", "/A", "PO 9", "SO 9", "Dir 9", false),    // dada de baja
            D("/B/Tres", "/B", "PO 3", "SO z", null,    true),     // sin Director ni en el C1
            D("/C/Cuatro" + NBSP + " ", " /C", NBSP + "PO 4 ", "SO w ", " Dir C", true),
        };
        var personas = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        personas["SO x"] = "Manager M";

        var dir = new DirectorioOrganizacional(duenos, personas);
        var r = dir.AsignacionesVigentes();
        var filas = (List<object>)r["asignaciones"];

        Check("filas vigentes con tres dueños", 3, filas.Count);
        Check("omitidas (sin Director)", 1, r["omitidas"]);
        Check("1/6 N2 completo, orden ordinal", "/A/Dos|Dir A|PO 2|SO x|4", filas.Count > 0 ? Fila(filas[0]) : "");
        Check("2 hereda SO del C1", "/A/Uno|Dir A|PO 1|SO x|4", filas.Count > 1 ? Fila(filas[1]) : "");
        Check("5 normalizado", "/C/Cuatro|Dir C|PO 4|SO w|4", filas.Count > 2 ? Fila(filas[2]) : "");

        bool baja = false, mgr = false;
        foreach (var o in filas)
        {
            var f = (Dictionary<string, object>)o;
            if ((string)f["categoria"] == "/A/Baja") baja = true;
            if (f.ContainsKey("manager")) mgr = true;
        }
        Check("3 dada de baja no sale", false, baja);
        Check("7 sin manager", false, mgr);

        // ---- Tipos de iniciativa ----
        var tipos = DashboardCatalogos.TiposUnicos(new[] {
            "Mejora", " Problem" + NBSP, null, "", "   ", "mejora", "Adopcion", "SorIA", "MEJORA"
        });
        Check("8-10 tipos limpios, unicos y ordenados", "Adopcion|MEJORA|Problem|SorIA",
            string.Join("|", tipos.ConvertAll(delegate (object o) { return (string)o; }).ToArray()));
        Check("8 lista vacia", 0, DashboardCatalogos.TiposUnicos(new string[0]).Count);

        // La consulta vive como literal en el metodo; se revisa el fuente.
        var fuente = System.IO.File.ReadAllText(System.IO.Path.Combine("App_Code", "DashboardCatalogos.cs"));
        var ini = fuente.IndexOf("public static List<object> TiposIniciativa(");
        var fin = fuente.IndexOf("public static List<object> TiposUnicos(");
        var cuerpo = (ini >= 0 && fin > ini) ? fuente.Substring(ini, fin - ini) : "";
        Check("11 TiposIniciativa encontrado", true, cuerpo.Length > 0);
        Check("11 solo SELECT sobre dbo.Problem", true,
            cuerpo.Contains("SELECT DISTINCT TipoIniciativa") && cuerpo.Contains("FROM dbo.Problem"));
        bool escribe = false;
        foreach (var palabra in new[] { "INSERT", "UPDATE", "DELETE", "MERGE", "EXEC", "CREATE", "ALTER", "DROP" })
            if (System.Text.RegularExpressions.Regex.IsMatch(cuerpo, @"\b" + palabra + @"\b")) escribe = true;
        Check("11 sin escrituras", false, escribe);

        Console.WriteLine(fallos == 0 ? "\nTODO PASO" : "\n" + fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
