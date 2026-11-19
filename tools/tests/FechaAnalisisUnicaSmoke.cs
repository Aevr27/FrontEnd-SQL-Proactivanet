// Regla: una iniciativa tiene UNA fecha compromiso de analisis, comun a todas
// sus categorias (dbo.Problem.FechaAnalisis). Prueba offline, por reflexion,
// de lo que el sitio hace con ella (sin SQL Server; LocalDB no reemplaza la
// verificacion en QA):
//
//   U1-U3  semaforo (ExperienciaQueries.Semaforo): con hoy 12/11/2026, una
//          fecha extendida al 17/11 no esta Atrasada; la vencida del 10/11 si.
//   U4-U6  registro (ArmarRegistro): dos categorias del mismo folio con la
//          fecha de la iniciativa salen iguales; Atrasada y n_analisis son los
//          de la iniciativa.
//   U7     LeerDetalle lee p.FechaAnalisis / p.NroCambioFechaAnalisis, no la
//          v.* de dbo.vw_ProblemCategoria (ADM_01 sustituye ahi la vieja
//          FechaAnalisisCategoria y su propio conteo: era el origen de
//          "Atrasada" con la fecha ya extendida y del contador 0 con Cambio 1).
//   U8     ArmarRegistro ya no promueve a la iniciativa el atraso de UNA
//          categoria.
//   U9-U12 validador de Modificar: fcat_* se rechaza (aunque venga con la
//          misma fecha); f_analisis sola es un cambio de la iniciativa.
//   U13    el plan de Modificar nunca lleva FechasCategoria ni fecha de
//          analisis en las categorias que se ligan.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:FechaUnica.exe /r:exp.dll /r:System.dll /r:System.Core.dll ^
//       /r:System.Web.dll tools\tests\FechaAnalisisUnicaSmoke.cs
//   FechaUnica.exe exp.dll
using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Reflection;

public static class FechaAnalisisUnicaSmoke
{
    static Type T, TDet;
    static int fallos = 0;
    static readonly DateTime HOY = new DateTime(2026, 11, 12);

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado) ?? "null";
        var o = Convert.ToString(obtenido) ?? "null";
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static void Set(object o, string campo, object v)
    {
        o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).SetValue(o, v);
    }
    static object Get(object o, string campo)
    {
        return o.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).GetValue(o);
    }
    // Catalogo minimo para poder ligar /B/Cat 3 (como GestionIniciativaAdminSmoke).
    static readonly CatalogoSolicitud Catalogo = new CatalogoSolicitud(new object[] { "PRB" }, new[] {
        new CatalogoSolicitud.Asignacion { Po = "PO 1", So = "SO x", Categoria = "/A/Cat 1", Director = "Dir A" },
        new CatalogoSolicitud.Asignacion { Po = "PO 1", So = "SO x", Categoria = "/A/Cat 2", Director = "Dir A" },
        new CatalogoSolicitud.Asignacion { Po = "PO 2", So = "SO z", Categoria = "/B/Cat 3", Director = "Dir B" } });
    static readonly EstadosProblem Estados = new EstadosProblem(
        new[] { "En An\u00e1lisis", "Cerrado" }, new[] { "En An\u00e1lisis" }, new[] { "Problem" }, new[] { "Problem" });
    static ResultadoGestionAdmin Mod(NameValueCollection f, IniciativaActual a)
    {
        return new ValidadorGestionAdmin().Modificar(PeticionModificarAdmin.DesdeFormulario(f), a,
            new CapacidadCategoria.Compromiso[0], Catalogo, Estados);
    }
    static MethodInfo M(string nombre) { return T.GetMethod(nombre, BindingFlags.NonPublic | BindingFlags.Static); }

    // Una fila como la deja LeerDetalle: la fecha y el contador de analisis
    // son los de dbo.Problem, iguales en todas las categorias del folio.
    static object Det(string folio, string ruta, string fAnalisis, int nAnalisis)
    {
        var d = Activator.CreateInstance(TDet, true);
        Set(d, "Folio", folio); Set(d, "Categoria", ruta);
        Set(d, "Titulo", "T"); Set(d, "TituloProblem", "T");
        Set(d, "Estado", "En An\u00e1lisis"); Set(d, "Agrup", "Problem");
        Set(d, "TicketsReduce", 10); Set(d, "PctDisminucion", 0.1);
        Set(d, "FAnalisis", fAnalisis); Set(d, "NAnalisis", nAnalisis);
        M("Canonizar").Invoke(null, new object[] { d });
        M("Semaforo").Invoke(null, new object[] { d, HOY });
        return d;
    }

    public static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(Path.GetFullPath(args.Length > 0 ? args[0] : "exp.dll"));
        T = asm.GetType("ExperienciaQueries");
        TDet = T.GetNestedType("Detalle", BindingFlags.NonPublic);

        // ---- Semaforo con hoy = 12/11/2026 (PRB 2026-000191: 10/11 -> 17/11) ----
        var extendida = Det("PRB 2026-000191", "/A/Cat 1", "2026-11-17", 1);
        var vencida = Det("PRB 2026-000191", "/A/Cat 1", "2026-11-10", 0);
        var hoyMismo = Det("PRB 2026-000191", "/A/Cat 1", "2026-11-12", 0);
        Chk("U1 extendida al 17/11: no Atrasada (ambar)", "False|ambar", Get(extendida, "Retrasada") + "|" + Get(extendida, "SemFecha"));
        Chk("U2 la vieja del 10/11 si estaria Atrasada (rojo)", "True|rojo", Get(vencida, "Retrasada") + "|" + Get(vencida, "SemFecha"));
        Chk("U3 vence hoy: todavia no Atrasada", "False", Get(hoyMismo, "Retrasada"));

        // ---- Registro: un folio con dos categorias ----
        var TDir = asm.GetType("DirectorioOrganizacional");
        var TDue = TDir.GetNestedType("Dueno");
        var dir = Activator.CreateInstance(TDir, new object[] {
            Activator.CreateInstance(typeof(List<>).MakeGenericType(TDue)), new Dictionary<string, string>() });
        var detalle = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(TDet));
        detalle.Add(Det("PRB 2026-000191", "/A/Cat 1", "2026-11-17", 1));
        detalle.Add(Det("PRB 2026-000191", "/A/Cat 2", "2026-11-17", 1));
        var salida = (Dictionary<string, object>)M("ArmarRegistro").Invoke(null, new object[] { detalle, new List<object>(), dir, null });
        var ini = (Dictionary<string, object>)((List<object>)salida["iniciativas"])[0];
        var cats = (List<object>)ini["categorias"];
        Chk("U4 las dos categorias: la misma fecha, la de la iniciativa", "2026-11-17|2026-11-17|2026-11-17",
            ((Dictionary<string, object>)cats[0])["f_analisis"] + "|" + ((Dictionary<string, object>)cats[1])["f_analisis"] + "|" + ini["f_analisis"]);
        Chk("U5 la iniciativa no esta Atrasada ni en riesgo", "False|0|0|ambar",
            ini["fecha_retrasada"] + "|" + ini["retrazado"] + "|" + ini["riesgo_folio"] + "|" + ini["sem_fecha"]);
        Chk("U6 contador de la iniciativa = 1 (el Cambio 1 del historial)", "1", ini["n_analisis"]);

        var raiz = Directory.GetCurrentDirectory();
        var qs = File.ReadAllText(Path.Combine(raiz, @"App_Code\ExperienciaQueries.cs"));
        Chk("U7 LeerDetalle: fecha y contador de analisis de dbo.Problem (p.*), no de la vista", "True|True|False|False",
            qs.Contains("\"       p.FechaAnalisis, v.FechaSolucion, v.FechaCierre, \"") + "|" +
            qs.Contains("\"       p.NroCambioFechaAnalisis, v.NroCambioFechaSolucion, v.NroCambioFechaCierre, \"") + "|" +
            qs.Contains("\"       v.FechaAnalisis, v.FechaSolucion") + "|" + qs.Contains("v.NroCambioFechaAnalisis"));
        var reg = File.ReadAllText(Path.Combine(raiz, @"App_Code\ExperienciaRegistro.cs"));
        Chk("U8 ArmarRegistro no promueve el atraso de una sola categoria; el registro no publica f_analisis_propia", "False|False",
            reg.Contains("primera.Retrasada) continue;") + "|" + reg.Contains("c[\"f_analisis_propia\"]"));

        // ---- Validador / plan de Modificar ----
        var actual = new IniciativaActual
        {
            Folio = "PRB 2026-000191", Titulo = "T", Descripcion = "", Observaciones = "",
            FAnalisis = "2026-11-10", FSolucion = "", FCierre = "", Estado = "En An\u00e1lisis", Subestado = "",
            PoCapturado = "", SoCapturado = "",
        };
        actual.Categorias.Add(new IniciativaActual.Categoria { Ruta = "/A/Cat 1", Pct = 0.1m, Agrup = "Problem" });
        actual.Categorias.Add(new IniciativaActual.Categoria { Ruta = "/A/Cat 2", Pct = 0.1m, Agrup = "Problem" });

        var conFcat = new NameValueCollection { { "folio", "PRB 2026-000191" },
            { "fcat_categoria", "/A/Cat 2" }, { "fcat_analisis", "2026-11-20" } };
        var r1 = Mod(conFcat, actual);
        Chk("U9 fecha por categoria: rechazada en el servidor", "False|True", r1.Valida + "|" + r1.TieneError(ValidadorGestionAdmin.CFechasCategoria));

        var mismaFecha = new NameValueCollection { { "folio", "PRB 2026-000191" }, { "f_analisis", "2026-11-17" },
            { "fcat_categoria", "/A/Cat 1" }, { "fcat_analisis", "2026-11-17" } };
        var r2 = Mod(mismaFecha, actual);
        Chk("U10 fcat_* con la misma fecha que la iniciativa: tambien rechazada (ya no se traduce)", "False|True",
            r2.Valida + "|" + r2.TieneError(ValidadorGestionAdmin.CFechasCategoria));

        var desparejo = new NameValueCollection { { "folio", "PRB 2026-000191" }, { "fcat_categoria", "/A/Cat 1" } };
        var r3 = Mod(desparejo, actual);
        Chk("U11 fcat_* incompleta: rechazada", "False", r3.Valida);

        var soloIni = new NameValueCollection { { "folio", "PRB 2026-000191" }, { "f_analisis", "2026-11-17" },
            { "agregar_categoria", "/B/Cat 3" }, { "agregar_pct", "" },
            { "agregar_tipo_iniciativa", "" }, { "agregar_tipo_agrupado", "" } };
        var r4 = Mod(soloIni, actual);
        var cambioAnalisis = "";
        foreach (var c in r4.Cambios)
            if ((c["clave"] as string) == "f_analisis") cambioAnalisis = c["anterior"] + ">" + c["nuevo"];
        Chk("U12 f_analisis 10/11 -> 17/11: un cambio de la iniciativa", "2026-11-10>2026-11-17", cambioAnalisis);

        if (r4.Valida)
        {
            var plan = PlanificadorGestionAdmin.Modificar(PeticionModificarAdmin.DesdeFormulario(soloIni), actual, r4, HOY);
            var json = plan.ComoJson();
            var agregar = (List<object>)json["agregar"];
            var primera = agregar.Count > 0 ? (Dictionary<string, object>)agregar[0] : null;
            Chk("U13 plan: f_analisis de la iniciativa; FechasCategoria vacia; la ligada no lleva fecha de analisis",
                "2026-11-17|0|1|null",
                (plan.Problem.ContainsKey("f_analisis") ? plan.Problem["f_analisis"] : "") + "|" + plan.FechasCategoria.Count + "|" +
                agregar.Count + "|" + (primera == null ? "sin" : (primera["f_analisis"] ?? "null")));
        }
        else
        {
            Chk("U13 la peticion de U12 debia ser valida para planearla", "True", r4.Valida);
        }

        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
