// Prueba de regresion del "ahora" del SLA (DashboardQueries.SlaPorSolucion).
//
// El bug: SQL Server corre en UTC y FechaEstimadaResolucion esta en hora de
// Mexico (UTC-06). Con SYSDATETIME() como "ahora", un ticket abierto cuyo
// compromiso vence dentro de menos de seis horas salia ya vencido.
//
// Comprueba:
//   1) el texto: ningun SYSDATETIME() y el "ahora" es
//      DATEADD(HOUR, -6, SYSUTCDATETIME()) en las dos ramas de ticket abierto.
//   2) contra SQL Server LocalDB, el CROSS APPLY real sobre filas construidas
//      a mano: compromisos en hora de Mexico relativos al "ahora" de Mexico.
//   3) control: el texto VIEJO, con SYSDATETIME() sustituido por lo que da en
//      un host UTC (SYSUTCDATETIME()), marca vencido el caso de +3 h. Asi la
//      prueba demuestra que detecta el bug aunque esta maquina no este en UTC.
//
// Las filas usan solo SYSUTCDATETIME(), asi que el resultado no depende de la
// zona horaria de la maquina que corre LocalDB. No toca la base real.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:app.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:SlaAhoraMexicoSmoke.exe /r:System.dll /r:System.Data.dll ^
//       tools\tests\SlaAhoraMexicoSmoke.cs
//   SlaAhoraMexicoSmoke.exe app.dll
using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Reflection;

public static class SlaAhoraMexicoSmoke
{
    static int fallos = 0;

    static void Chk(string caso, object esperado, object obtenido)
    {
        bool ok = Equals(esperado, obtenido);
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + "  esperado=" + esperado + "  obtenido=" + obtenido);
    }

    // Cada fila: compromiso y firma de solucion en MINUTOS respecto del
    // "ahora" de Mexico; null = sin fecha.
    static readonly object[][] Casos =
    {
        //            caso,                               compromiso, firma, vencido, dentro
        new object[] { "abierto, vence en +3 h (el bug)",       180,  null,  false,  true  },
        new object[] { "abierto, vence en +5 h 59 min",         359,  null,  false,  true  },
        new object[] { "abierto, vencio hace 1 h",              -60,  null,  true,   false },
        new object[] { "abierto, vence en +7 h",                420,  null,  false,  true  },
        new object[] { "resuelto tarde (no usa ahora)",         -120, -60,   true,   false },
        new object[] { "resuelto a tiempo (no usa ahora)",      180,  -60,   false,  true  },
        new object[] { "sin compromiso",                        null, null,  false,  false },
    };

    static string Filas()
    {
        var partes = new List<string>();
        for (int i = 0; i < Casos.Length; i++)
        {
            var c = Casos[i];
            string comp = c[1] == null ? "CAST(NULL AS DATETIME2(0))"
                : "CAST(DATEADD(MINUTE, " + c[1] + ", DATEADD(HOUR, -6, SYSUTCDATETIME())) AS DATETIME2(0))";
            string firma = c[2] == null ? "CAST(NULL AS DATETIME2(0))"
                : "CAST(DATEADD(MINUTE, " + c[2] + ", DATEADD(HOUR, -6, SYSUTCDATETIME())) AS DATETIME2(0))";
            partes.Add("SELECT " + i + " AS Id, " + comp + " AS FechaEstimadaResolucion, " + firma +
                       " AS FechaFirmaSolucion, CAST(DATEADD(DAY, -1, SYSUTCDATETIME()) AS DATETIME2(0)) AS FechaRegistro," +
                       " 1 AS IntentosSolucion");
        }
        return string.Join(" UNION ALL ", partes);
    }

    static Dictionary<int, bool[]> Correr(SqlConnection cn, string crossApply)
    {
        var sql = "SELECT b.Id, s.SlaVencido, s.DentroSla FROM (" + Filas() + ") AS b" + crossApply + " ORDER BY b.Id;";
        var salida = new Dictionary<int, bool[]>();
        using (var cmd = new SqlCommand(sql, cn))
        using (var r = cmd.ExecuteReader())
            while (r.Read())
                salida[r.GetInt32(0)] = new[] { r.GetBoolean(1), r.GetBoolean(2) };
        return salida;
    }

    public static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args.Length > 0 ? args[0] : "app.dll");
        var campo = asm.GetType("DashboardQueries").GetField("SlaPorSolucion",
            BindingFlags.NonPublic | BindingFlags.Static);
        var texto = (string)campo.GetRawConstantValue();

        // 1) Texto.
        Chk("sin SYSDATETIME()", false, texto.Contains("SYSDATETIME()"));
        Chk("ahora Mexico, rama vencido", true,
            texto.Contains("WHEN DATEADD(HOUR, -6, SYSUTCDATETIME()) > b.FechaEstimadaResolucion THEN 1"));
        Chk("ahora Mexico, rama dentro", true,
            texto.Contains("WHEN DATEADD(HOUR, -6, SYSUTCDATETIME()) <= b.FechaEstimadaResolucion THEN 1"));
        Chk("solo dos DATEADD(HOUR, -6, ...)", 2,
            texto.Split(new[] { "DATEADD(HOUR, -6," }, StringSplitOptions.None).Length - 1);

        using (var cn = new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Integrated Security=true"))
        {
            cn.Open();

            // 2) Texto nuevo contra LocalDB.
            var nuevo = Correr(cn, texto);
            for (int i = 0; i < Casos.Length; i++)
            {
                Chk("nuevo: " + Casos[i][0] + " vencido", Casos[i][3], nuevo[i][0]);
                Chk("nuevo: " + Casos[i][0] + " dentro", Casos[i][4], nuevo[i][1]);
            }

            // 3) Control: texto viejo en un host UTC (SYSDATETIME() = UTC).
            var viejo = Correr(cn, texto.Replace("DATEADD(HOUR, -6, SYSUTCDATETIME())", "SYSUTCDATETIME()"));
            Chk("viejo en host UTC: +3 h sale vencido (bug reproducido)", true, viejo[0][0]);
            Chk("viejo en host UTC: +7 h sigue en tiempo", false, viejo[3][0]);
        }

        Console.WriteLine(fallos == 0 ? "TODO OK" : (fallos + " FALLOS"));
        return fallos;
    }
}
