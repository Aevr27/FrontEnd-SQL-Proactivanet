// tools/tests/EfectividadExperienciaSmoke.cs - la lectura del KPI "% Efectividad
// Reducción" de Experiencia (ExperienciaQueries.LeerEfectividad) contra una
// base con el 60 corrido.
//
// NO forma parte del sitio. La base con el 60 corrido y sus datos armados a
// mano (pruebas/correr_efectividad.sh, SQL Server de Docker) NO estan en este
// repositorio, como tampoco 60_efectividad_iniciativas.sql. Sin ella solo se
// puede correr el primer caso: con un solo argumento -una base cualquiera sin
// las tablas del 60, por ejemplo LocalDB- comprueba que la lectura devuelve
// null y la tarjeta se queda en S/D.
//
// Que fija:
//   - sin las tablas del 60 (otra base) devuelve null: la tarjeta sigue en S/D;
//   - solo vienen las medidas y las en medicion, y suman lo mismo que el 60
//     (142.00 de compromiso, 78.66 de logro);
//   - cada fila lleva el C1 y el C1&C2 de SU iniciativa en el tablero (los de
//     'detalle', cruzando por folio y ruta del Excel normalizada), aunque la
//     ruta que se cuenta sea otra (la equivalencia /S-VIEJA/); sin 'detalle',
//     los cortes de la ruta del Excel;
//   - las en medicion traen desde cuando se miden; el dia del calculo es el
//     de hoy en UTC-06.
//
// Con un tercer argumento escribe lo que devolvio (JSON) para
// EfectividadExperienciaSmoke.js.
//
// Compilar y correr (desde la raiz del repositorio; en Git Bash con
// MSYS_NO_PATHCONV=1, como los demas smokes de C#):
//   csc /out:<scratch>/Efectividad.exe /r:System.Web.dll /r:System.Web.Extensions.dll
//       /r:System.Data.dll /r:System.Configuration.dll
//       "App_Code\*.cs" tools\tests\EfectividadExperienciaSmoke.cs
//   Efectividad.exe "<cadena a una base sin el 60>"
//   Efectividad.exe "<cadena a la base>" "<cadena a una base sin el 60>" [salida.json]
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;

public static class EfectividadSmoke
{
    static int fallos = 0;
    static Type T = typeof(ExperienciaQueries);
    static Type TDet = T.GetNestedType("Detalle", BindingFlags.NonPublic);

    static void Ver(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static object Detalle(string folio, string categoria, string c1, string c1c2)
    {
        var d = Activator.CreateInstance(TDet, true);
        TDet.GetField("Folio").SetValue(d, folio);
        TDet.GetField("Categoria").SetValue(d, categoria);
        TDet.GetField("C1").SetValue(d, c1);
        TDet.GetField("C1C2").SetValue(d, c1c2);
        return d;
    }

    static Dictionary<string, object> Leer(string cadena, IList detalle)
    {
        var m = T.GetMethod("LeerEfectividad", BindingFlags.NonPublic | BindingFlags.Static);
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            return (Dictionary<string, object>)m.Invoke(null, new object[] { cn, detalle });
        }
    }

    static Dictionary<string, object> Fila(List<object> filas, string folio)
    {
        foreach (Dictionary<string, object> f in filas)
            if ((string)f["folio"] == folio) return f;
        return null;
    }

    public static int Main(string[] args)
    {
        if (TDet == null) { Console.WriteLine("FAIL  ExperienciaQueries.Detalle no existe"); return 1; }

        var lista = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(TDet));
        // Como las deja LeerIniciativas: ruta normalizada, C1 y C1&C2 de la
        // vista. La de ADO 900044 trae la ruta VIEJA (la del Excel); la de HAR
        // 900005 viene limpia aunque el Excel traiga un espacio duro al final.
        // Los C1 "-vista" distinguen el cruce del corte de la ruta.
        lista.Add(Detalle("ADO 2026-900044", "/S-VIEJA/X/Hoja", "S-VIEJA-vista", "/S-VIEJA/X-vista"));
        lista.Add(Detalle("HAR 2026-900005", "/D/Temporada", "D-vista", "/D/Temporada-vista"));
        lista.Add(Detalle("ADO 2026-900044", "/otra/ruta", "NO", "NO"));

        Ver("sin las tablas del 60: null (la tarjeta queda en S/D)", "True",
            Leer(args.Length == 1 ? args[0] : args[1], lista) == null);
        if (args.Length == 1)
        {
            Console.WriteLine("(sin la base del 60: los demas casos no se corrieron)");
            Console.WriteLine(fallos == 0 ? "TODO BIEN" : fallos + " FALLA(S)");
            return fallos == 0 ? 0 : 1;
        }

        var e = Leer(args[0], lista);
        Ver("con el 60: hay resultado", "True", e != null);
        if (e == null) return 1;

        var hoy = DateTime.UtcNow.AddHours(-6).Date;
        Ver("el dia del calculo es hoy en UTC-06", hoy.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), e["calculado"]);

        var filas = (List<object>)e["filas"];
        int medidas = 0, enMedicion = 0;
        double comp = 0, logro = 0;
        foreach (Dictionary<string, object> f in filas)
        {
            if ((bool)f["medida"]) { medidas++; comp += (double)f["comp"]; logro += (double)f["logro"]; }
            else enMedicion++;
        }
        Ver("solo medidas (11 filas) y en medicion (2)", "11~2", medidas + "~" + enMedicion);
        Ver("suman lo mismo que el 60: 78.66 de 142.00 = 55.4%",
            "142.00~78.66~55.4",
            comp.ToString("0.00", CultureInfo.InvariantCulture) + "~" + logro.ToString("0.00", CultureInfo.InvariantCulture) + "~" +
            (100 * logro / comp).ToString("0.0", CultureInfo.InvariantCulture));

        var n4 = Fila(filas, "ADO 2026-900044");
        Ver("equivalencia: cuenta la ruta nueva, se filtra por donde la pinta el tablero",
            "/S-Nueva/VIEJA - X/Hoja~S-VIEJA-vista~/S-VIEJA/X-vista",
            n4 == null ? "-" : n4["categoria"] + "~" + n4["c1"] + "~" + n4["c1c2"]);
        var m5 = Fila(filas, "HAR 2026-900005");
        Ver("la ruta del Excel con espacio duro cruza con la de 'detalle'",
            "D-vista~/D/Temporada-vista", m5 == null ? "-" : m5["c1"] + "~" + m5["c1c2"]);
        var m1 = Fila(filas, "PRB 2026-900001");
        Ver("sin fila en 'detalle': los cortes de la ruta del Excel",
            "A~/A/Uno~True~10.00~9.51", m1 == null ? "-" : m1["c1"] + "~" + m1["c1c2"] + "~" + m1["medida"] + "~" +
            ((double)m1["comp"]).ToString("0.00", CultureInfo.InvariantCulture) + "~" +
            ((double)m1["logro"]).ToString("0.00", CultureInfo.InvariantCulture));
        var e21 = Fila(filas, "ADO 2026-900021");
        Ver("en medicion: desde cuando se mide",
            "False~" + hoy.AddDays(60).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            e21 == null ? "-" : e21["medida"] + "~" + e21["se_mide_desde"]);
        Ver("las que no entran no vienen (Sin base, Cancelada...)", "True",
            Fila(filas, "PRB 2026-900049") == null && Fila(filas, "PRB 2026-900012") == null);

        if (args.Length > 2)
            File.WriteAllText(args[2], new JavaScriptSerializer().Serialize(e));

        Console.WriteLine(fallos == 0 ? "TODO BIEN" : fallos + " FALLA(S)");
        return fallos == 0 ? 0 : 1;
    }
}
