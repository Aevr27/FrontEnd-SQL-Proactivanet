// Prueba offline de CatalogoDuenosCategoria.Armar (?duenos=1 de
// handlers/admin_iniciativas_catalogos.ashx). Sin SQL Server: filas a mano
// por el constructor publico de DirectorioOrganizacional.
//
// Casos:
//   1) N2 con sus tres dueños propios: capturado = resuelto
//   2) N2 sin SO propio: capturado null, resuelto = el del C1, fuente_c1
//   3) la fuente del C1 es la PRIMERA fila del C1 (la de Resolver)
//   4) fila dada de baja: viaja con vigente = false
//   5) sin C1: sin fuente y lo que no tiene, sin resolver
//   6) N2 repetido tras normalizar: solo uno es la fila usada
//   7) orden ordinal por N2
//   8) personas: sin repetidos (sin distinguir mayusculas), ordenadas, sin correo
//   9) codigo: la consulta de personas es SELECT y no lee Correo; el handler
//      solo arma esto con ?duenos=1
//
// Compilar y correr desde la raiz del repo (ver AsignacionesIniciativasSmoke.cs):
//   csc /nologo /target:library /codepage:1252 /out:dir.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:DuenosSmoke.exe /r:dir.dll /r:System.dll /r:System.Data.dll ^
//       tools\tests\CatalogoDuenosCategoriaSmoke.cs
//   DuenosSmoke.exe
using System;
using System.Collections.Generic;
using System.IO;

public static class CatalogoDuenosCategoriaSmoke
{
    static int fallos = 0;

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

    static CatalogoDuenosCategoria.Persona P(string nombre, string rol, string manager)
    {
        var p = new CatalogoDuenosCategoria.Persona();
        p.Nombre = nombre; p.Rol = rol; p.Manager = manager;
        return p;
    }

    static Dictionary<string, object> Fila(Dictionary<string, object> salida, string n2)
    {
        foreach (Dictionary<string, object> f in (List<object>)salida["duenos"])
            if ((string)f["n2"] == n2) return f;
        return null;
    }

    static string R(Dictionary<string, object> f, string campo)
    {
        return Convert.ToString(((Dictionary<string, object>)f["resuelto"])[campo]);
    }

    public static int Main()
    {
        // En el orden de LeerDuenos: por C1, vigentes primero.
        var filas = new List<DirectorioOrganizacional.Dueno>
        {
            D("/A/Uno", "/A", "PO 1", "SO 1", "Dir 1", true),     // primera de /A: fuente del C1
            D("/A/Dos", "/A", "PO 2", null, "Dir 1", true),       // sin SO propio
            D("/A/Tres", "/A", null, null, null, false),          // dada de baja, todo heredado
            D("/B/Uno", "/B", "PO 3", "SO 3", "Dir 2", true),
            D("/Sin/C1", null, "PO 4", null, null, true),         // sin C1: no hereda
            D("/A/Uno ", "/A", "PO X", "SO X", "Dir X", true)     // repetido tras normalizar
        };
        var dir = new DirectorioOrganizacional(filas, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));
        var personas = new List<CatalogoDuenosCategoria.Persona>
        {
            P("SO 1", "Service Owner", "Mgr"), P("PO 1", null, null), P("po 1", "dup", null), P("Dir 1", "Director", null)
        };
        var s = CatalogoDuenosCategoria.Armar(filas, dir, personas);

        var uno = Fila(s, "/A/Uno");
        Check("1 propio: capturado", "PO 1|SO 1|Dir 1", uno["po"] + "|" + uno["so"] + "|" + uno["director"]);
        Check("1 propio: resuelto igual", "PO 1|SO 1|Dir 1", R(uno, "po") + "|" + R(uno, "so") + "|" + R(uno, "director"));

        var dos = Fila(s, "/A/Dos");
        Check("2 sin SO propio: capturado null", true, dos["so"] == null);
        Check("2 ... resuelto = SO del C1", "SO 1", R(dos, "so"));
        Check("3 fuente del C1 = primera fila del C1", "/A/Uno", dos["fuente_c1"]);

        var tres = Fila(s, "/A/Tres");
        Check("4 dada de baja viaja, vigente false", "False", tres["vigente"]);
        Check("4 ... y resuelve por herencia", "PO 1|SO 1|Dir 1", R(tres, "po") + "|" + R(tres, "so") + "|" + R(tres, "director"));

        var sinC1 = Fila(s, "/Sin/C1");
        Check("5 sin C1: sin fuente", true, sinC1["fuente_c1"] == null);
        Check("5 ... lo que falta queda sin resolver", "PO 4||", R(sinC1, "po") + "|" + R(sinC1, "so") + "|" + R(sinC1, "director"));

        int usadas = 0, repetidas = 0;
        foreach (Dictionary<string, object> f in (List<object>)s["duenos"])
        {
            if ((string)f["n2"] != "/A/Uno") continue;
            repetidas++;
            if ((bool)f["usada"]) usadas++;
        }
        Check("6 N2 repetido: dos filas, una usada", "2|1", repetidas + "|" + usadas);
        Check("6 ... la usada es la primera", "PO 1", uno["po"]);

        var n2s = new List<string>();
        foreach (Dictionary<string, object> f in (List<object>)s["duenos"]) n2s.Add((string)f["n2"]);
        Check("7 orden ordinal", "/A/Dos,/A/Tres,/A/Uno,/A/Uno,/B/Uno,/Sin/C1", string.Join(",", n2s.ToArray()));

        var nombres = new List<string>();
        bool conCorreo = false;
        foreach (Dictionary<string, object> p in (List<object>)s["personas"])
        {
            nombres.Add((string)p["nombre"]);
            if (p.ContainsKey("correo")) conCorreo = true;
        }
        Check("8 personas sin repetidos y ordenadas", "Dir 1,PO 1,SO 1", string.Join(",", nombres.ToArray()));
        Check("8 ... sin correo", false, conCorreo);

        var fuente = File.ReadAllText(Path.Combine("App_Code", "CatalogoDuenosCategoria.cs"));
        var sql = fuente.Substring(fuente.IndexOf("const string SQL"));
        sql = sql.Substring(0, sql.IndexOf(';'));
        Check("9 personas: SELECT sin Correo", true,
              sql.Contains("SELECT Nombre, Rol, Manager FROM dbo.CatPersona") && !sql.Contains("Correo"));
        Check("9 sin escrituras en la clase", false,
              System.Text.RegularExpressions.Regex.IsMatch(fuente, @"\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b"));
        var handler = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_catalogos.ashx"));
        Check("9 handler: ?duenos=1 solo ADM; el resto, la puerta de Nueva solicitud", true,
              handler.Contains("QueryString[\"duenos\"] == \"1\"") && handler.Contains("AccesoAdmin.ExigirAdm(context, ")
              && handler.Contains("AccesoIniciativas.ExigirSolicitud(context)"));

        Console.WriteLine(fallos == 0 ? "\nTODO PASO" : "\n" + fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
