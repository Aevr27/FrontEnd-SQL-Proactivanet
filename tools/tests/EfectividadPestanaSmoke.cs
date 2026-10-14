// tools/tests/EfectividadPestanaSmoke.cs - la lectura de la pestaña
// "Efectividad de iniciativas" (EfectividadQueries.Construir) contra una base
// con el 60 corrido y las vistas de Experiencia.
//
// NO forma parte del sitio. La corre pruebas/correr_efectividad.sh con Mono,
// contra el SQL Server de Docker. La cadena va en EfectividadPestana.exe.config
// ("TicketsProactivanet"), como la del sitio en Web.config.
//
// Que fija:
//   - trae TODAS las filas de dbo.ExpEfectividad (tambien las que no se
//     califican, con su motivo) y la ultima corrida;
//   - el C1 y el C1&C2 de las medidas y las en medicion son los mismos con
//     los que filtra la tarjeta de Experiencia (ExperienciaQueries.Construir);
//   - el titulo: el de la iniciativa en esa categoria, si no el del Problem;
//   - las categorias y los catalogos de dueños son los de Experiencia;
//   - sin las tablas del 60 (renombradas): hay_calculo = false y sin filas,
//     pero las categorias siguen.
//
// Compilar y correr (desde sitio/):
//   mcs -r:System.Web.dll -r:System.Web.Extensions.dll -r:System.Data.dll -r:System.Configuration.dll
//       -out:EfectividadPestana.exe App_Code/*.cs tools/tests/EfectividadPestanaSmoke.cs
//   mono EfectividadPestana.exe normal <pestana.json> <experiencia.json>
//   mono EfectividadPestana.exe sin60
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Web.Script.Serialization;

public static class EfectividadPestanaSmoke
{
    static int fallos = 0;

    static void Ver(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static object Escalar(string sql)
    {
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            using (var cmd = new SqlCommand(sql, cn)) return cmd.ExecuteScalar();
        }
    }

    public static int Main(string[] args)
    {
        var modo = args.Length > 0 ? args[0] : "normal";
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        var p = EfectividadQueries.Construir();
        var filas = (IList)p["filas"];
        var categorias = (IList)p["categorias"];

        if (modo == "sin60")
        {
            Ver("sin las tablas del 60: hay_calculo = false", false, p["hay_calculo"]);
            Ver("sin las tablas del 60: sin filas", 0, filas.Count);
            Ver("sin las tablas del 60: sin corrida", true, p["corrida"] == null);
            Ver("sin las tablas del 60: las categorias siguen", true, categorias.Count > 0);
            Console.WriteLine(fallos == 0 ? "TODO BIEN" : fallos + " FALLA(S)");
            return fallos == 0 ? 0 : 1;
        }

        var e = ExperienciaQueries.Construir(DashboardDataInfo.HoyEnPresentacion().Year);

        Ver("hay calculo", true, p["hay_calculo"]);
        Ver("todas las filas de dbo.ExpEfectividad", Escalar("SELECT COUNT(*) FROM dbo.ExpEfectividad"), filas.Count);
        Ver("tambien las que no se califican",
            Escalar("SELECT COUNT(*) FROM dbo.ExpEfectividad WHERE Orden NOT IN (14, 15)"),
            Cuenta(filas, f => { var o = Convert.ToInt32(f["orden"]); return o != 14 && o != 15; }));

        var corrida = (IDictionary)p["corrida"];
        Ver("la ultima corrida: compromiso",
            Convert.ToDouble(Escalar("SELECT TOP (1) ROUND(Compromiso, 4) FROM dbo.ExpEfectividadCorrida ORDER BY Id DESC"), CultureInfo.InvariantCulture),
            corrida["compromiso"]);
        Ver("la ultima corrida: iniciativas en medicion",
            Escalar("SELECT TOP (1) IniciativasEnMedicion FROM dbo.ExpEfectividadCorrida ORDER BY Id DESC"),
            corrida["iniciativas_en_medicion"]);
        Ver("la corrida no publica el DateTime interno", false, corrida.Contains("fecha_calculo_dt"));

        // Los cortes de la tarjeta.
        var tarjeta = new Dictionary<string, IDictionary>();
        foreach (IDictionary f in (IList)((IDictionary)e["efectividad"])["filas"])
            tarjeta[f["folio"] + "|" + f["categoria"]] = f;
        int iguales = 0, contadas = 0;
        foreach (IDictionary f in filas)
        {
            var o = Convert.ToInt32(f["orden"]);
            if (o != 14 && o != 15) continue;
            contadas++;
            IDictionary t;
            if (tarjeta.TryGetValue(f["folio"] + "|" + f["categoria"], out t)
                && Equals(t["c1"], f["c1"]) && Equals(t["c1c2"], f["c1c2"])) iguales++;
        }
        Ver("medidas y en medicion: los mismos C1 / C1&C2 que la tarjeta", contadas, iguales);
        Ver("y son las mismas filas que la tarjeta", tarjeta.Count, contadas);

        // Titulos (los pone el arnes): por categoria, del Problem, y la ruta N/A.
        Ver("titulo de la iniciativa en su categoria", "Titulo de M2 en /B/Uno", Titulo(filas, "ADO 2026-900002", "/B/Uno"));
        Ver("otra categoria del mismo folio sin titulo propio: el del Problem", "Problem M2", Titulo(filas, "ADO 2026-900002", "/B/Dos"));
        Ver("una que no se califica (N/A) tambien trae su titulo", "Titulo de N8", TituloPorFolio(filas, "PRB 2026-900048"));

        Ver("las categorias son las de Experiencia", ((IList)e["categorias"]).Count, categorias.Count);
        Ver("con sus dueños", true, Cuenta(categorias, c => c["director"] != null) > 0);
        Ver("y los catalogos de los selects", true, ((IList)p["directores"]).Count > 0);
        Ver("meta con la fuente", "Efectividad de iniciativas", ((IDictionary)p["meta"])["fuente"]);

        File.WriteAllText(args[1], json.Serialize(p));
        File.WriteAllText(args[2], json.Serialize(e));

        Console.WriteLine(fallos == 0 ? "TODO BIEN" : fallos + " FALLA(S)");
        return fallos == 0 ? 0 : 1;
    }

    static int Cuenta(IList filas, Func<IDictionary, bool> si)
    {
        int n = 0;
        foreach (IDictionary f in filas) if (si(f)) n++;
        return n;
    }

    static string Titulo(IList filas, string folio, string excel)
    {
        foreach (IDictionary f in filas)
            if ((string)f["folio"] == folio && (string)f["categoria_excel"] == excel) return (string)f["titulo"];
        return "(no esta)";
    }

    static string TituloPorFolio(IList filas, string folio)
    {
        foreach (IDictionary f in filas)
            if ((string)f["folio"] == folio) return (string)f["titulo"];
        return "(no esta)";
    }
}
