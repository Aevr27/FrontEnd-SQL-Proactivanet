// tools/tests/HistorialFechasSmoke.cs - App_Code/HistorialFechas.cs: lo que el
// registro de iniciativas de Admin manda como `historial` de cada folio.
//
// NO forma parte del sitio.
//
// Que fija:
//   A) Sin base (Armar, por reflexion):
//      - agrupa por codigo en el orden recibido (IdEvento);
//      - inicio de captura = el FechaRegistro de la linea base, en UTC-06;
//      - un 'U' anterior a ese instante es `reconstruido` (importacion del
//        Excel); 'B', 'I' y los 'U' posteriores no;
//      - fechas de negocio como yyyy-MM-dd, registro como dd/MM/yyyy HH:mm
//        en UTC-06; usuario y solicitud solo en filas ADMIN;
//      - sin linea base: Desde null y nada marcado como reconstruido;
//      - un codigo sin filas da lista vacia.
//   B) Con una cadena de conexion (opcional): Leer contra una base que tenga
//      dbo.ProblemFechaEvento (por ejemplo una copia en LocalDB armada con
//      sql/17_historial_fechas_captura.sql). Solo comprueba que lee sin error,
//      con Estado "ok"; y contra una base sin la tabla, Estado "sin_tabla".
//
// Compilar y correr desde la raiz del repo (Git Bash con
// MSYS_NO_PATHCONV=1, como los demas smokes de C#):
//   csc /nologo /out:<scratch>/HistorialSmoke.exe /r:System.Web.dll
//       /r:System.Web.Extensions.dll /r:System.Data.dll /r:System.Configuration.dll
//       "App_Code\*.cs" tools\tests\HistorialFechasSmoke.cs
//   HistorialSmoke.exe                                     # solo A
//   HistorialSmoke.exe "<base con la tabla>" "<base sin ella>"   # A y B
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.Reflection;

public static class HistorialFechasSmoke
{
    static int fallos = 0;
    static Type T = typeof(HistorialFechas);
    static Type TEv = T.GetNestedType("Evento", BindingFlags.NonPublic);

    static void Ver(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static object Ev(int id, string cod, string campo, string ant, string nue, string op, string origen,
                     string usuario, int? sol, DateTime regUtc)
    {
        var e = Activator.CreateInstance(TEv, true);
        Action<string, object> f = (n, v) => TEv.GetField(n).SetValue(e, v);
        f("Id", id); f("Codigo", cod); f("Campo", campo);
        f("Anterior", ant == null ? (DateTime?)null : DateTime.Parse(ant, CultureInfo.InvariantCulture));
        f("Nueva", nue == null ? (DateTime?)null : DateTime.Parse(nue, CultureInfo.InvariantCulture));
        f("Operacion", op); f("Origen", origen); f("Usuario", usuario); f("Solicitud", sol);
        f("RegistroUtc", regUtc);
        return e;
    }

    static HistorialFechas Armar(IList filas)
    {
        return (HistorialFechas)T.GetMethod("Armar", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { filas });
    }

    static string Resumen(List<object> l)
    {
        var partes = new List<string>();
        foreach (Dictionary<string, object> d in l)
            partes.Add(d["operacion"] + ":" + d["campo"] + ":" + (d["anterior"] ?? "-") + ">" + (d["nuevo"] ?? "-") +
                       ":" + d["fecha"] + ":" + ((bool)d["reconstruido"] ? "R" : "") + ":" + (d["usuario"] ?? "") +
                       ":" + (d["solicitud"] ?? ""));
        return string.Join(" | ", partes);
    }

    public static int Main(string[] args)
    {
        if (TEv == null) { Console.WriteLine("FAIL  HistorialFechas.Evento no existe"); return 1; }

        Console.WriteLine("A) sin base");
        var lista = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(TEv));
        // Importada del Excel (antes de la captura), linea base, y dos vivas.
        lista.Add(Ev(1, "PRB 1", "FechaCierre", "2026-08-03", "2026-08-19", "U", "NO_DECLARADO", "x", 9,
                     new DateTime(2026, 8, 19, 22, 45, 0)));
        lista.Add(Ev(7, "PRB 1", "FechaAnalisis", null, "2026-07-01", "B", "NO_DECLARADO", null, null,
                     new DateTime(2026, 10, 9, 17, 41, 0)));
        lista.Add(Ev(9, "PRB 1", "FechaCierre", "2026-08-19", "2026-09-30", "U", "ADMIN", "SORIANA\\a", 12,
                     new DateTime(2026, 10, 20, 3, 5, 0)));
        lista.Add(Ev(8, "ADO 2", "FechaAnalisis", null, "2026-10-23", "I", "NO_DECLARADO", null, null,
                     new DateTime(2026, 10, 10, 1, 0, 0)));
        var h = Armar(lista);

        Ver("estado ok", HistorialFechas.ESTADO_OK, h.Estado);
        Ver("desde = linea base en UTC-06", "09/10/2026", h.Desde);
        Ver("PRB 1: orden, fechas, reconstruido y usuario solo ADMIN",
            "U:FechaCierre:2026-08-03>2026-08-19:19/08/2026 16:45:R:: | " +
            "B:FechaAnalisis:->2026-07-01:09/10/2026 11:41::: | " +
            "U:FechaCierre:2026-08-19>2026-09-30:19/10/2026 21:05::SORIANA\\a:12",
            Resumen(h.Para("PRB 1")));
        Ver("ADO 2: alta 'I', no reconstruida", "I:FechaAnalisis:->2026-10-23:09/10/2026 19:00:::", Resumen(h.Para("ado 2")));
        Ver("codigo sin filas: lista vacia", 0, h.Para("NADA").Count);
        Ver("codigo null: lista vacia", 0, h.Para(null).Count);

        var sinBase = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(TEv));
        sinBase.Add(Ev(1, "PRB 1", "FechaCierre", "2026-08-03", "2026-08-19", "U", "NO_DECLARADO", null, null,
                       new DateTime(2026, 8, 19, 22, 45, 0)));
        var h2 = Armar(sinBase);
        Ver("sin linea base: Desde null y nada reconstruido", "|U:FechaCierre:2026-08-03>2026-08-19:19/08/2026 16:45:::",
            (h2.Desde ?? "") + "|" + Resumen(h2.Para("PRB 1")));

        if (args.Length >= 2)
        {
            Console.WriteLine("B) contra la base");
            using (var cn = new SqlConnection(args[0]))
            {
                cn.Open();
                var r = HistorialFechas.Leer(cn);
                Ver("con la tabla: ok", HistorialFechas.ESTADO_OK, r.Estado);
            }
            using (var cn = new SqlConnection(args[1]))
            {
                cn.Open();
                Ver("sin la tabla: sin_tabla", HistorialFechas.ESTADO_SIN_TABLA, HistorialFechas.Leer(cn).Estado);
            }
        }

        Console.WriteLine(fallos == 0 ? "TODO BIEN" : fallos + " FALLA(S)");
        return fallos == 0 ? 0 : 1;
    }
}
