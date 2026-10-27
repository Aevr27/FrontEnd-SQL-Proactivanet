// Prueba offline del filtro de tipo de registro de handlers/kpis.ashx
// (DashboardQueries.TipoRegistroSla y su uso en Predicados()), sin tocar SQL
// Server. Es lo que pide experiencia.js para la tarjeta "Volumen -
// Automatizado" con Incidentes / Requerimientos. Comprueba:
//
//   1) el query string: ?tipo=inc -> 'Incidencia'; ?tipo=req -> las dos
//      grafias de 'Peticion de Servicio' (con y sin tilde), igual que la
//      columna [Peticion de Servicio] de vw_TBSlotCAT; cualquier otra cosa,
//      o nada, es Todos (lista vacia);
//   2) Todos: Predicados() arma EXACTAMENTE el mismo texto y parametros que
//      antes (la peticion de siempre, la misma clave de cache);
//   3) con tipo: el mismo IN sobre LTRIM(RTRIM(b.Tipo)) una vez en los tres
//      textos, antes de NoRechazado, con un parametro por valor; quitado el
//      IN queda Todos; convive con grupos, tecnicos y "Sin proveedores".
//
// Se entra por reflexion, como GrupoProveedorSmoke.cs: Predicados() es
// privado y las consultas publicas abren una conexion.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:app.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:TipoRegistroSlaSmoke.exe /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll tools\tests\TipoRegistroSlaSmoke.cs
//   TipoRegistroSlaSmoke.exe app.dll
using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Reflection;
using System.Web;

public static class TipoRegistroSlaSmoke
{
    static int fallos = 0;
    static Type T, TFiltros, TTipo;

    static void Chk(string caso, object esperado, object obtenido)
    {
        bool ok = Equals(esperado, obtenido);
        if (!ok) fallos++;
        Console.WriteLine((ok ? "OK    " : "FALLA ") + caso
            + (ok ? "" : "  (esperado: " + Fmt(esperado) + ", obtenido: " + Fmt(obtenido) + ")"));
    }

    static string Fmt(object o) { return o == null ? "null" : "[" + o + "]"; }

    static string Tipos(string query)
    {
        var req = new HttpRequest("", "http://localhost/kpis.ashx", query);
        var l = (List<string>)TTipo.GetMethod("Desde").Invoke(null, new object[] { req });
        return string.Join("|", l);
    }

    static object Filtros(string tipo, bool sinProveedores, string[] grupos, string tecnicos)
    {
        var f = Activator.CreateInstance(TFiltros);
        TFiltros.GetField("FechaInicio").SetValue(f, new DateTime(2026, 9, 24));
        TFiltros.GetField("FechaFin").SetValue(f, new DateTime(2026, 10, 23));
        TFiltros.GetField("SinProveedores").SetValue(f, sinProveedores);
        TFiltros.GetField("TiposRegistro").SetValue(f,
            TTipo.GetMethod("Valores").Invoke(null, new object[] { tipo }));
        if (grupos != null)
            TFiltros.GetField("Grupos").SetValue(f, new List<string>(grupos));
        if (tecnicos != null)
        {
            var tf = TFiltros.GetField("Tecnicos").FieldType;
            TFiltros.GetField("Tecnicos").SetValue(f, Activator.CreateInstance(tf, tecnicos));
        }
        return f;
    }

    static string[] Predicados(object filtros, SqlCommand cmd)
    {
        var m = T.GetMethod("Predicados", BindingFlags.NonPublic | BindingFlags.Static);
        var a = new object[] { cmd, filtros, null, null, null };
        m.Invoke(null, a);
        return new[] { (string)a[2], (string)a[3], (string)a[4] };
    }

    static int Contar(string texto, string trozo)
    {
        int n = 0, i = 0;
        while ((i = texto.IndexOf(trozo, i, StringComparison.Ordinal)) >= 0) { n++; i += trozo.Length; }
        return n;
    }

    static string Nombres(SqlCommand cmd)
    {
        var l = new List<string>();
        foreach (SqlParameter p in cmd.Parameters) l.Add(p.ParameterName);
        return string.Join(",", l);
    }

    public static void Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args[0]);
        T = asm.GetType("DashboardQueries");
        TFiltros = T.GetNestedType("Filtros");
        TTipo = T.GetNestedType("TipoRegistroSla");
        string peticionTilde = "Petici" + (char)0xF3 + "n de Servicio";

        Console.WriteLine("--- 1) Query string");
        Chk("tipo=inc -> Incidencia", "Incidencia", Tipos("tipo=inc"));
        Chk("tipo=req -> las dos grafias", peticionTilde + "|Peticion de Servicio", Tipos("tipo=req"));
        Chk("tipo=INC (mayusculas) -> Incidencia", "Incidencia", Tipos("tipo=INC"));
        Chk("sin parametro = Todos", "", Tipos(""));
        Chk("tipo=todos = Todos", "", Tipos("tipo=todos"));
        Chk("tipo=otro = Todos", "", Tipos("tipo=SorIA"));
        Chk("tipo= (vacio) = Todos", "", Tipos("tipo="));

        Console.WriteLine("--- 2) Todos: Predicados() sin cambios");
        const string solucionAntes = "b.FechaFirmaSolucion >= @FechaInicio AND b.FechaFirmaSolucion < DATEADD(DAY, 1, @FechaFin)";
        const string noRechazado = " AND (b.Estado IS NULL OR b.Estado <> N'Rechazada')";
        var cmdT = new SqlCommand();
        var todos = Predicados(Filtros(null, false, null, null), cmdT);
        Chk("porSolucion identico", solucionAntes + noRechazado, todos[0]);
        Chk("porRegistro identico", "b.FechaRegistro >= @FechaInicio AND b.FechaRegistro < DATEADD(DAY, 1, @FechaFin)", todos[1]);
        Chk("rechazados identico", solucionAntes + " AND b.Estado = N'Rechazada'", todos[2]);
        Chk("parametros identicos", "@FechaInicio,@FechaFin", Nombres(cmdT));

        Console.WriteLine("--- 3) Con tipo");
        string[] nombres = { "porSolucion", "porRegistro", "rechazados" };
        var casos = new[] {
            new { tipo = "inc", frag = " AND LTRIM(RTRIM(b.Tipo)) IN (@tr0)", pars = "@FechaInicio,@FechaFin,@tr0" },
            new { tipo = "req", frag = " AND LTRIM(RTRIM(b.Tipo)) IN (@tr0, @tr1)", pars = "@FechaInicio,@FechaFin,@tr0,@tr1" } };
        foreach (var c in casos)
        {
            var cmd = new SqlCommand();
            var con = Predicados(Filtros(c.tipo, false, null, null), cmd);
            for (int i = 0; i < 3; i++)
            {
                Chk(c.tipo + " " + nombres[i] + ": IN una vez", 1, Contar(con[i], c.frag));
                Chk(c.tipo + " " + nombres[i] + ": sin el IN = Todos", todos[i], con[i].Replace(c.frag, ""));
            }
            Chk(c.tipo + ": un parametro por valor, una sola vez", c.pars, Nombres(cmd));
            Chk(c.tipo + ": porSolucion con el tipo antes de NoRechazado", true,
                con[0].EndsWith(c.frag + noRechazado, StringComparison.Ordinal));
        }
        var cmdInc = new SqlCommand();
        Predicados(Filtros("inc", false, null, null), cmdInc);
        Chk("inc: @tr0 = Incidencia", "Incidencia", cmdInc.Parameters["@tr0"].Value);
        var cmdReq = new SqlCommand();
        Predicados(Filtros("req", false, null, null), cmdReq);
        Chk("req: @tr0 con tilde, @tr1 sin tilde", peticionTilde + "|Peticion de Servicio",
            cmdReq.Parameters["@tr0"].Value + "|" + cmdReq.Parameters["@tr1"].Value);

        var cmdG = new SqlCommand();
        var todosG = Predicados(Filtros(null, true, new[] { "Service Desk" }, "Lugo Solis, David"), cmdG);
        var cmdGi = new SqlCommand();
        var incG = Predicados(Filtros("inc", true, new[] { "Service Desk" }, "Lugo Solis, David"), cmdGi);
        for (int i = 0; i < 3; i++)
            Chk(nombres[i] + " con grupos, tecnicos y sin proveedores: sin el IN = Todos", todosG[i],
                incG[i].Replace(" AND LTRIM(RTRIM(b.Tipo)) IN (@tr0)", ""));
        Chk("con todo: parametros = los de Todos + @tr0", Nombres(cmdG) + ",@tr0", Nombres(cmdGi));

        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLAS");
        Environment.Exit(fallos == 0 ? 0 : 1);
    }
}
