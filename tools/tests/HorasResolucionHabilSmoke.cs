// tools/tests/HorasResolucionHabilSmoke.cs - prueba de humo de HorasResolucion
// en horario habil (lunes a viernes, 08:00-18:30), el MISMO horario que la
// primera respuesta.
//
// NO forma parte del sitio: vive fuera de App_Code y de handlers/, asi que IIS
// no lo compila ni lo ejecuta nunca. Comprueba:
//
//   1) sin base: el texto de SlaPorSolucion arma HorasResolucion con
//      MinutosHabilesDesdeAncla (la misma expresion que PrimeraRespuesta) y ya
//      no con DATEDIFF de reloj.
//   2) con base (-si se pasa la cadena de conexion-): ejecuta el fragmento
//      SlaPorSolucion REAL, sacado por reflexion, sobre filas de ejemplo en un
//      VALUES con alias b. Verifica HorasResolucion por caso, que el veredicto
//      de SLA sigue comparando fechas de calendario, y el promedio, la
//      mediana y el p90 con el mismo PERCENTILE_CONT y el mismo CAST que Kpis.
//      Solo hace SELECT de constantes: no lee ninguna tabla y no escribe nada.
//
// Compilar y correr desde la raiz del repo (PowerShell):
//
//   $csc = "$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
//   $ref = Split-Path $csc
//   & $csc /nologo /target:library /out:app.dll /r:System.dll /r:System.Data.dll `
//       /r:"$ref\System.Web.dll" /r:"$ref\System.Web.Extensions.dll" `
//       /r:"$ref\System.Configuration.dll" App_Code\*.cs
//   & $csc /nologo /out:HorasResolucionHabilSmoke.exe /r:System.dll `
//       /r:System.Data.dll tools\tests\HorasResolucionHabilSmoke.cs
//   .\HorasResolucionHabilSmoke.exe app.dll "Server=(localdb)\MSSQLLocalDB;Integrated Security=true"
//   # sin la cadena solo corre la parte 1; imprime PASS/FAIL y sale 0 si todo paso
using System;
using System.Data.SqlClient;
using System.Reflection;

public static class HorasResolucionHabilSmoke
{
    static int fallos;

    static void Check(bool ok, string nombre, object esperado, object obtenido)
    {
        if (!ok) fallos++;
        Console.WriteLine("{0}  {1}  esperado={2}  obtenido={3}",
            ok ? "PASS " : "FAIL ", nombre, esperado ?? "(null)", obtenido ?? "(null)");
    }

    static string Campo(Type t, string nombre)
    {
        var f = t.GetField(nombre, BindingFlags.NonPublic | BindingFlags.Static);
        return (string)f.GetValue(null);
    }

    // 2026-09-21 es lunes; 09-18 viernes.
    // Caso, registro, firma de solucion, fecha compromiso, horas habiles esperadas,
    // SlaVencido esperado, DentroSla esperado.
    static readonly object[][] Casos =
    {
        new object[] { "Mismo dia habil (lun 09:00 -> lun 10:00)",      "2026-09-21T09:00:00", "2026-09-21T10:00:00", "2026-09-21T12:00:00", 1.0m,  false, true  },
        new object[] { "Cruza fin de semana (vie 17:00 -> lun 09:00)",  "2026-09-18T17:00:00", "2026-09-21T09:00:00", "2026-09-19T12:00:00", 2.5m,  true,  false },
        new object[] { "Empieza fuera (lun 06:00 -> lun 10:00)",        "2026-09-21T06:00:00", "2026-09-21T10:00:00", null,               2.0m,  false, false },
        new object[] { "Termina fuera (lun 17:00 -> lun 22:00)",        "2026-09-21T17:00:00", "2026-09-21T22:00:00", "2026-09-21T21:00:00", 1.5m,  true,  false },
        new object[] { "Varios dias habiles (lun 10:00 -> mie 12:00)",  "2026-09-21T10:00:00", "2026-09-23T12:00:00", "2026-09-25T12:00:00", 23.0m, false, true  },
        new object[] { "Sin resolver (sin firma de solucion)",          "2026-09-21T10:00:00", null,               "2099-01-01T00:00:00", null,  false, true  },
    };

    static string Lit(object v)
    {
        return v == null ? "CONVERT(datetime, NULL)" : "CONVERT(datetime, N'" + v + "', 126)";
    }

    public static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.WriteLine("Uso: HorasResolucionHabilSmoke.exe app.dll [cadena de conexion]");
            return 2;
        }
        var t = Assembly.LoadFrom(args[0]).GetType("DashboardQueries");
        string sla = Campo(t, "SlaPorSolucion");
        string ancla = Campo(t, "MinutosHabilesDesdeAncla");
        string primera = Campo(t, "PrimeraRespuesta");

        // --- 1) estructura ---------------------------------------------------
        string esperado = "((" + ancla.Replace("$M$", "b.FechaFirmaSolucion") + ")\n"
                        + "                - (" + ancla.Replace("$M$", "b.FechaRegistro") + ")) / 60.0";
        Check(sla.Replace("\r\n", "\n").Contains(esperado.Replace("\r\n", "\n")),
              "HorasResolucion usa MinutosHabilesDesdeAncla (firma - registro)", true,
              sla.Replace("\r\n", "\n").Contains(esperado.Replace("\r\n", "\n")));
        Check(!sla.Contains("DATEDIFF(MINUTE, b.FechaRegistro"),
              "Sin DATEDIFF de reloj en HorasResolucion", true, !sla.Contains("DATEDIFF(MINUTE, b.FechaRegistro"));
        Check(primera.Contains(ancla.Replace("$M$", "mom.Inicio")) && primera.Contains(ancla.Replace("$M$", "mom.Fin")),
              "PrimeraRespuesta sigue usando la misma expresion", true,
              primera.Contains(ancla.Replace("$M$", "mom.Inicio")) && primera.Contains(ancla.Replace("$M$", "mom.Fin")));

        if (args.Length < 2)
        {
            Console.WriteLine();
            Console.WriteLine("(sin cadena de conexion: no se ejecuta la parte con SQL)");
            return Fin();
        }

        // --- 2) el fragmento real contra filas de ejemplo ---------------------
        var filas = new System.Text.StringBuilder();
        for (int i = 0; i < Casos.Length; i++)
        {
            var c = Casos[i];
            if (i > 0) filas.Append(",\n");
            filas.AppendFormat("({0}, {1}, {2}, {3}, 1)", i, Lit(c[1]), Lit(c[2]), Lit(c[3]));
        }
        string desde = "\nFROM (VALUES\n" + filas + "\n) AS b(CodigoTicket, FechaRegistro, FechaFirmaSolucion, FechaEstimadaResolucion, IntentosSolucion)" + sla;

        using (var cn = new SqlConnection(args[1]))
        {
            cn.Open();

            var cmd = new SqlCommand("SELECT b.CodigoTicket, HorasResolucion = CAST(s.HorasResolucion AS DECIMAL(18,2)), s.SlaVencido, s.DentroSla"
                                     + desde + "\nORDER BY b.CodigoTicket;", cn);
            using (var r = cmd.ExecuteReader())
            {
                while (r.Read())
                {
                    var c = Casos[r.GetInt32(0)];
                    object horas = r.IsDBNull(1) ? null : (object)r.GetDecimal(1);
                    Check(Equals(horas, c[4]), (string)c[0], c[4], horas);
                    Check(r.GetBoolean(2) == (bool)c[5] && r.GetBoolean(3) == (bool)c[6],
                          "  SLA sin cambios (vencido/dentro)", c[5] + "/" + c[6], r.GetBoolean(2) + "/" + r.GetBoolean(3));
                }
            }

            // Mismo calculo que Kpis: AVG y PERCENTILE_CONT sin PARTITION BY,
            // recogidos con MAX() y con el mismo CAST.
            // Horas con dato: 1.0, 1.5, 2.0, 2.5, 23.0 (el sin resolver es NULL
            // y PERCENTILE_CONT/AVG lo ignoran).
            //   promedio = 30 / 5 = 6.00
            //   mediana  = 2.00
            //   p90      = 2.5 + 0.6 * (23 - 2.5) = 14.80
            cmd = new SqlCommand(@"
;WITH base AS (SELECT s.HorasResolucion" + desde + @"),
conPct AS (
    SELECT b2.*,
        HorasMediana = PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b2.HorasResolucion) OVER (),
        HorasP90     = PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY b2.HorasResolucion) OVER ()
    FROM base AS b2)
SELECT
    HorasResolucionPromedio = CAST(AVG(HorasResolucion) AS DECIMAL(18,2)),
    HorasResolucionMediana  = CAST(MAX(HorasMediana) AS DECIMAL(18,2)),
    HorasResolucionP90      = CAST(MAX(HorasP90)     AS DECIMAL(18,2))
FROM conPct;", cn);
            using (var r = cmd.ExecuteReader())
            {
                r.Read();
                Check(r.GetDecimal(0) == 6.00m,  "HorasResolucionPromedio", 6.00m,  r.GetDecimal(0));
                Check(r.GetDecimal(1) == 2.00m,  "HorasResolucionMediana",  2.00m,  r.GetDecimal(1));
                Check(r.GetDecimal(2) == 14.80m, "HorasResolucionP90",      14.80m, r.GetDecimal(2));
            }
        }
        return Fin();
    }

    static int Fin()
    {
        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " CASO(S) FALLARON");
        return fallos;
    }
}
