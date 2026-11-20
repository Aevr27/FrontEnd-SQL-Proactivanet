// Prueba offline: App_Code/*.cs y handlers/*.ashx guardados SIN BOM no
// llevan caracteres no ASCII dentro de literales de cadena o de caracter.
// IIS compila esos archivos con la codepage ANSI (cp1252): una 'o' acentuada
// en UTF-8 llega al navegador como "Ã³" (admin_iniciativas_solicitudes_nuevas_
// revision.ashx: "No se aprobÃ³ ni se creÃ³..."). En los comentarios no
// importa. La convencion es \uXXXX.
//
// Trinquete: CONOCIDOS son los archivos que ya estaban asi; fallan los demas
// y tambien un CONOCIDO que ya quedo limpio (hay que quitarlo de la lista).
//
//   E1 ningun archivo fuera de CONOCIDOS tiene literales no ASCII
//   E2 cada CONOCIDO sigue teniendolos (si no, sacarlo de la lista)
//   E3 los tres archivos de la revision de Nueva solicitud quedan limpios y
//      se leen igual en UTF-8 y en cp1252 (lo que hace IIS)
//   E4 el detector ve cadenas normales, verbatim y caracteres, y no los
//      comentarios
//
// Compilar: csc /out:LiteralesAsciiSmoke.exe tools\tests\LiteralesAsciiSmoke.cs
// (sin App_Code); correr con cwd = raiz del repo.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

public static class LiteralesAsciiSmoke
{
    static readonly string[] Conocidos =
    {
        @"App_Code\AccesoAdmin.cs", @"App_Code\AccesoIniciativas.cs", @"App_Code\ConcentracionQueries.cs",
        @"App_Code\DashboardQueries.cs", @"App_Code\EfectividadQueries.cs", @"App_Code\ExperienciaAutomatizados.cs",
        @"App_Code\ExperienciaRegistro.cs", @"App_Code\HistorialPeticiones.cs",
        @"handlers\admin_iniciativas_mis_solicitudes.ashx", @"handlers\admin_iniciativas_solicitudes_nuevas.ashx",
        @"handlers\admin_iniciativas_volumetria.ashx",
    };
    static readonly string[] Revision =
    {
        @"handlers\admin_iniciativas_solicitudes_nuevas_revision.ashx",
        @"App_Code\RevisionSolicitudesIniciativa.cs", @"App_Code\RegistroSolicitudesIniciativa.cs",
    };
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // Lineas (1..n) con un caracter no ASCII dentro de un literal. Lexico
    // minimo de C#: comentarios // y /* */, "..." con escapes, @"..." con "",
    // y '...'. Las cadenas interpoladas no se usan (C# 5).
    public static List<int> LineasNoAscii(string texto)
    {
        var lineas = new SortedSet<int>();
        int i = 0, linea = 1, n = texto.Length;
        while (i < n)
        {
            char c = texto[i];
            if (c == '\n') { linea++; i++; continue; }
            if (c == '/' && i + 1 < n && texto[i + 1] == '/') { while (i < n && texto[i] != '\n') i++; continue; }
            if (c == '/' && i + 1 < n && texto[i + 1] == '*')
            {
                i += 2;
                while (i < n && !(texto[i] == '*' && i + 1 < n && texto[i + 1] == '/')) { if (texto[i] == '\n') linea++; i++; }
                i += 2; continue;
            }
            if (c == '@' && i + 1 < n && texto[i + 1] == '"')
            {
                i += 2;
                while (i < n)
                {
                    if (texto[i] == '"') { if (i + 1 < n && texto[i + 1] == '"') { i += 2; continue; } i++; break; }
                    if (texto[i] == '\n') linea++;
                    else if (texto[i] > 127) lineas.Add(linea);
                    i++;
                }
                continue;
            }
            if (c == '"' || c == '\'')
            {
                i++;
                while (i < n && texto[i] != c && texto[i] != '\n')
                {
                    if (texto[i] == '\\') { i += 2; continue; }
                    if (texto[i] > 127) lineas.Add(linea);
                    i++;
                }
                i++; continue;
            }
            i++;
        }
        return lineas.ToList();
    }

    static bool ConBom(byte[] b) { return b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF; }

    public static int Main()
    {
        var archivos = Directory.GetFiles("App_Code", "*.cs").Concat(Directory.GetFiles("handlers", "*.ashx"))
                                .Select(f => f.Replace('/', '\\')).OrderBy(f => f, StringComparer.OrdinalIgnoreCase).ToList();
        var malos = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in archivos)
        {
            var b = File.ReadAllBytes(f);
            if (ConBom(b)) continue;
            var l = LineasNoAscii(new UTF8Encoding(false).GetString(b));
            if (l.Count > 0) malos[f] = l;
        }

        var nuevos = malos.Keys.Where(f => !Conocidos.Contains(f, StringComparer.OrdinalIgnoreCase))
                               .Select(f => f + ":" + string.Join(",", malos[f])).ToArray();
        Check("E1 sin literales no ASCII fuera de la lista de conocidos", "", string.Join(" ", nuevos));
        var limpios = Conocidos.Where(f => !malos.ContainsKey(f)).ToArray();
        Check("E2 cada conocido sigue en la lista solo si aun los tiene", "", string.Join(" ", limpios));

        var cp1252 = Encoding.GetEncoding(1252);
        foreach (var f in Revision)
        {
            var b = File.ReadAllBytes(f);
            var utf8 = new UTF8Encoding(false).GetString(b);
            var ansi = cp1252.GetString(b);
            Check("E3 " + f + ": sin literales no ASCII y el codigo se lee igual en cp1252", "|True",
                  string.Join(",", LineasNoAscii(utf8)) + "|" + (Quitar(utf8) == Quitar(ansi)));
        }

        Check("E4a detecta cadena, verbatim y caracter", "1,2,3",
              string.Join(",", LineasNoAscii("var a = \"aprobó\";\nvar b = @\"creó \"\"x\"\"\";\nvar c = 'ñ';")));
        Check("E4b ignora comentarios y escapes", "",
              string.Join(",", LineasNoAscii("// aprobó\n/* creó */ var a = \"aprob\\u00f3\"; // ñ\nvar b = \"\\\"\";")));

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }

    // El texto sin comentarios: lo que el compilador lee como codigo.
    static string Quitar(string t)
    {
        var sb = new StringBuilder();
        int i = 0, n = t.Length;
        while (i < n)
        {
            if (t[i] == '/' && i + 1 < n && t[i + 1] == '/') { while (i < n && t[i] != '\n') i++; continue; }
            if (t[i] == '/' && i + 1 < n && t[i + 1] == '*') { i += 2; while (i < n && !(t[i] == '*' && i + 1 < n && t[i + 1] == '/')) i++; i += 2; continue; }
            if (t[i] == '"' || t[i] == '\'')
            {
                var q = t[i]; sb.Append(t[i++]);
                while (i < n && t[i] != q && t[i] != '\n') { if (t[i] == '\\' && i + 1 < n) sb.Append(t[i++]); sb.Append(t[i++]); }
                if (i < n) sb.Append(t[i++]);
                continue;
            }
            sb.Append(t[i++]);
        }
        return sb.ToString();
    }
}
