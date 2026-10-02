// Prueba offline de Nueva solicitud en el servidor (App_Code/
// SolicitudIniciativa.cs + ExperienciaQueries.ConsumeCapacidad). Sin IIS y
// sin SQL Server: catalogo y compromisos armados a mano por los
// constructores publicos, igual que IdentidadAdminSmoke.
//
// Casos:
//   T) Tipo: Problem primero si existe; el resto en el orden del catalogo;
//      sin Problem no se inventa.
//   R) Requeridos: cada campo ausente -> error en ese campo; completa -> pasa.
//   C) Cascada: PO/SO/Categoria que no forman fila vigente -> error.
//   V) Volumetria y %: formatos, sin multiplos de 5, fraccion de 4 decimales.
//   A) RCA: Problem sin RCA invalida; con RCA valida; otro tipo, con o sin.
//   K) Capacidad: 100 / 80 / 40 / 0 disponible; pedir de mas -> error.
//   P) Por categoria: A no se ve afectada por B.
//   X) Concurrencia: lo que el navegador creia disponible no decide; el
//      servidor recalcula con el estado actual.
//   E) Estados que consumen (regla de Experiencia).
//   N) Numero de solicitud y nombre del RCA.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:SolicitudIniciativaSmoke.exe /r:adm.dll /r:System.dll ^
//       tools\tests\SolicitudIniciativaSmoke.cs
//   SolicitudIniciativaSmoke.exe
using System;
using System.Collections.Generic;
using System.Collections.Specialized;

// Emisor de prueba: solo para probar CUANDO el servicio pide numero. No
// persiste nada y no reemplaza al emisor real.
public sealed class EmisorDePrueba : IGeneradorNumeroSolicitud
{
    private int _ultimo;
    public int Llamadas;
    public EmisorDePrueba(int ultimo) { _ultimo = ultimo; }
    public NumeroSolicitud Emitir(out string motivo)
    {
        Llamadas++;
        motivo = null;
        var n = NumeroSolicitud.Siguiente(_ultimo);
        _ultimo = n.Valor;
        return n;
    }
}

public static class SolicitudIniciativaSmoke
{
    // El constructor sin argumentos del servicio usa el emisor pendiente.
    static bool ServicioUsaPendiente()
    {
        var campo = typeof(IniciativaService).GetField("_numeros",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        return campo.GetValue(new IniciativaService()) is GeneradorNumeroSolicitudPendiente;
    }

    static int fallos = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, System.Globalization.CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, System.Globalization.CultureInfo.InvariantCulture);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static CatalogoSolicitud.Asignacion A(string po, string so, string cat, string dir)
    {
        return new CatalogoSolicitud.Asignacion { Po = po, So = so, Categoria = cat, Director = dir };
    }

    static CapacidadCategoria.Compromiso K(string folio, string cat, decimal pct, bool consume)
    {
        return new CapacidadCategoria.Compromiso { Folio = folio, Categoria = cat, Pct = pct, Consume = consume };
    }

    static readonly CatalogoSolicitud Catalogo = new CatalogoSolicitud(
        new object[] { "Problem", "Adopcion", "Hardware" },
        new[]
        {
            A("PO 1", "SO x", "/A/Cat 1", "Dir A"),
            A("PO 1", "SO y", "/A/Cat 2", "Dir A"),
            A("PO 2", "SO z", "/B/Cat 3", "Dir B"),
        });

    static NameValueCollection Completa(string tipo, string cat, string pct)
    {
        var f = new NameValueCollection();
        f["tipo"] = tipo;
        f["po"] = cat == "/B/Cat 3" ? "PO 2" : "PO 1";
        f["so"] = cat == "/A/Cat 2" ? "SO y" : cat == "/B/Cat 3" ? "SO z" : "SO x";
        f["categoria"] = cat;
        f["titulo"] = "Titulo";
        f["descripcion"] = "Descripcion";
        f["observaciones"] = "Observaciones";
        f["volumetria"] = "120";
        f["pct"] = pct;
        return f;
    }

    static ValidadorIniciativa.Resultado V(NameValueCollection f, bool rca, CapacidadCategoria cap)
    {
        var s = SolicitudIniciativa.DesdeFormulario(f, rca, rca ? "RCA_final_v7.pdf" : null);
        return new ValidadorIniciativa().Validar(s, Catalogo, cap ?? new CapacidadCategoria(null));
    }

    static string Campos(ValidadorIniciativa.Resultado r)
    {
        var l = new List<string>();
        foreach (var e in r.Errores) l.Add(e.Campo);
        return string.Join(",", l);
    }

    public static int Main()
    {
        // ---- T) tipo --------------------------------------------------------
        var tipos = TiposSolicitud.ProblemPrimero(DashboardCatalogos.TiposUnicos(
            new[] { "Requerimiento", "Problem", "Adopcion", "Mejora Aplicativo", "Hardware" }));
        Check("T1 Problem primero", "Problem", tipos[0]);
        Check("T2 el resto en el orden del catalogo",
              "Problem|Adopcion|Hardware|Mejora Aplicativo|Requerimiento", string.Join("|", tipos));
        Check("T3 sin Problem: no se inventa", "Adopcion|Mejora",
              string.Join("|", TiposSolicitud.ProblemPrimero(new object[] { "Adopcion", "Mejora" })));
        Check("T4 grafia del catalogo intacta", " PROBLEM|Adopcion",
              string.Join("|", TiposSolicitud.ProblemPrimero(new object[] { "Adopcion", " PROBLEM" })));
        Check("T5 ValorProblem", "Problem", TiposSolicitud.ValorProblem(tipos));
        Check("T5 ValorProblem sin Problem", true, TiposSolicitud.ValorProblem(new object[] { "Adopcion" }) == null);
        Check("T6 'Problema' no es Problem", false, TiposSolicitud.EsProblem("Problema"));

        // ---- R) requeridos --------------------------------------------------
        var ok = V(Completa("Adopcion", "/A/Cat 1", "20"), false, null);
        Check("R0 completa valida", true, ok.Valida);
        Check("R0 director derivado", "Dir A", ok.Director);
        Check("R0 fraccion", "0.2000", ok.PctFraccion);
        foreach (var campo in new[] { "tipo", "po", "so", "categoria", "titulo", "descripcion", "observaciones", "volumetria", "pct" })
        {
            var f = Completa("Adopcion", "/A/Cat 1", "20");
            f[campo] = "   ";
            var r = V(f, false, null);
            Check("R1 falta " + campo + " -> invalida", false, r.Valida);
            Check("R1 falta " + campo + " -> error en " + campo, true, r.TieneError(campo));
        }
        Check("R2 todo vacio: nueve errores", 9, V(new NameValueCollection(), false, null).Errores.Count);

        // ---- C) catalogo y cascada -------------------------------------------
        var fc = Completa("Inventado", "/A/Cat 1", "20");
        Check("C1 tipo fuera de catalogo", "tipo", Campos(V(fc, false, null)));
        fc = Completa("Adopcion", "/A/Cat 1", "20"); fc["so"] = "SO y";
        Check("C2 PO/SO/Categoria sin fila vigente", "categoria", Campos(V(fc, false, null)));
        fc = Completa("Adopcion", "/A/Cat 9", "20");
        Check("C3 categoria inexistente", "categoria", Campos(V(fc, false, null)));

        // ---- V) formatos -----------------------------------------------------
        foreach (var bueno in new[] { "0", "1", "3", "22", "33.33", "6.5", "100", "100.00" })
            Check("V1 % valido " + bueno, true, ValidadorIniciativa.Fraccion(bueno) != null);
        foreach (var malo in new[] { "-1", "100.01", "101", "abc", "1.234", "1,5", "" })
            Check("V2 % invalido '" + malo + "'", true, ValidadorIniciativa.Fraccion(malo) == null);
        Check("V3 33.33% -> 0.3333", "0.3333", ValidadorIniciativa.Fraccion("33.33"));
        Check("V3 1% -> 0.0100 (sin multiplos de 5)", "0.0100", ValidadorIniciativa.Fraccion("1"));
        var fv = Completa("Adopcion", "/A/Cat 1", "20"); fv["volumetria"] = "12.5";
        Check("V4 volumetria decimal", "volumetria", Campos(V(fv, false, null)));
        fv["volumetria"] = "99999999999";
        Check("V4 volumetria fuera de INT", "volumetria", Campos(V(fv, false, null)));
        fv["volumetria"] = "0";
        Check("V4 volumetria 0 valida", true, V(fv, false, null).Valida);

        // ---- A) RCA ----------------------------------------------------------
        var prbSin = V(Completa("Problem", "/A/Cat 1", "20"), false, null);
        Check("A1 Problem sin RCA -> INVALID", "rca", Campos(prbSin));
        Check("A1 rca_obligatorio", true, prbSin.RcaObligatorio);
        Check("A2 Problem con RCA -> VALID", true, V(Completa("Problem", "/A/Cat 1", "20"), true, null).Valida);
        Check("A3 otro tipo sin RCA -> VALID", true, V(Completa("Hardware", "/A/Cat 1", "20"), false, null).Valida);
        Check("A4 otro tipo con RCA -> VALID", true, V(Completa("Hardware", "/A/Cat 1", "20"), true, null).Valida);
        Check("A5 otro tipo: RCA opcional", false, V(Completa("Hardware", "/A/Cat 1", "20"), false, null).RcaObligatorio);

        // ---- K) capacidad ----------------------------------------------------
        Check("K1 sin iniciativas: 100%", "1.0000", new CapacidadCategoria(null).Para("/A/Cat 1").Disponible);
        var una = new CapacidadCategoria(new[] { K("PRB 1", "/A/Cat 1", 0.2000m, true) });
        Check("K2 una de 20%: 80%", "0.8000", una.Para("/A/Cat 1").Disponible);
        var tres = new CapacidadCategoria(new[]
        {
            K("PRB 1", "/A/Cat 1", 0.2000m, true), K("PRB 2", "/A/Cat 1", 0.2000m, true),
            K("PRB 3", "/A/Cat 1", 0.2000m, true),
        });
        Check("K3 20+20+20: usado 60%", "0.6000", tres.Para("/A/Cat 1").Usado);
        Check("K3 20+20+20: disponible 40%", "0.4000", tres.Para("/A/Cat 1").Disponible);
        Check("K3 folios", "PRB 1|PRB 2|PRB 3", string.Join("|", tres.Para("/A/Cat 1").Folios));
        var llena = new CapacidadCategoria(new[]
        {
            K("PRB 1", "/A/Cat 1", 0.2000m, true), K("PRB 2", "/A/Cat 1", 0.2000m, true),
            K("PRB 3", "/A/Cat 1", 0.2000m, true), K("PRB 4", "/A/Cat 1", 0.4000m, true),
        });
        Check("K4 20+20+20+40: usado 100%", "1.0000", llena.Para("/A/Cat 1").Usado);
        Check("K4 20+20+20+40: disponible 0%", "0.0000", llena.Para("/A/Cat 1").Disponible);
        Check("K5 40% con 40% disponible: valida", true, V(Completa("Adopcion", "/A/Cat 1", "40"), false, tres).Valida);
        Check("K5 40.01% con 40% disponible: error en pct", "pct", Campos(V(Completa("Adopcion", "/A/Cat 1", "40.01"), false, tres)));
        Check("K5 50% con 40%: error en pct", "pct", Campos(V(Completa("Adopcion", "/A/Cat 1", "50"), false, tres)));
        Check("K5 0% con 0% disponible: valida", true, V(Completa("Adopcion", "/A/Cat 1", "0"), false, llena).Valida);
        Check("K5 1% con 0% disponible: error", "pct", Campos(V(Completa("Adopcion", "/A/Cat 1", "1"), false, llena)));
        var exceso = new CapacidadCategoria(new[] { K("X 1", "/A/Cat 1", 0.7000m, true), K("X 2", "/A/Cat 1", 0.5000m, true) });
        Check("K6 lo existente pasa de 100%: disponible 0", "0.0000|True", exceso.Para("/A/Cat 1").Disponible + "|" + exceso.Para("/A/Cat 1").Excedida);
        var noConsume = new CapacidadCategoria(new[] { K("C 1", "/A/Cat 1", 0.5000m, false), K("C 2", "/A/Cat 1", 0.2000m, true) });
        Check("K7 la que no consume no resta", "0.8000", noConsume.Para("/A/Cat 1").Disponible);
        var cambio = new CapacidadCategoria(new[] { K("PRB 1", "/A/Cat 1", 0.3500m, true) });
        Check("K8 edicion: cuenta el % actual (35), no uno historico", "0.6500", cambio.Para("/A/Cat 1").Disponible);
        Check("K9 ruta con espacios / NBSP / mayusculas", "0.8000",
              una.Para(" /a/cat 1\u00A0").Disponible);

        // granularidad: ancestro / descendiente -> no determinable
        var hija = new CapacidadCategoria(new[] { K("H 1", "/A/Cat 1/Sub", 0.2000m, true) });
        Check("K10 hay una en una subcategoria: no determinable", false, hija.Para("/A/Cat 1").Determinable);
        Check("K10 rutas relacionadas", "/A/Cat 1/Sub", string.Join("|", hija.Para("/A/Cat 1").RutasRelacionadas));
        Check("K10 rechaza aunque pida 0", "pct", Campos(V(Completa("Adopcion", "/A/Cat 1", "0"), false, hija)));
        Check("K11 padre: no determinable", false,
              new CapacidadCategoria(new[] { K("P 1", "/A", 0.1000m, true) }).Para("/A/Cat 1").Determinable);
        Check("K12 prefijo de texto no es subcategoria", true,
              new CapacidadCategoria(new[] { K("Z 1", "/A/Cat 10", 0.9000m, true) }).Para("/A/Cat 1").Determinable);
        Check("K12 y no resta", "1.0000",
              new CapacidadCategoria(new[] { K("Z 1", "/A/Cat 10", 0.9000m, true) }).Para("/A/Cat 1").Disponible);
        Check("K13 subcategoria que NO consume no estorba", true,
              new CapacidadCategoria(new[] { K("H 2", "/A/Cat 1/Sub", 0.2000m, false) }).Para("/A/Cat 1").Determinable);

        // ---- P) por categoria ------------------------------------------------
        var dos = new CapacidadCategoria(new[]
        {
            K("A 1", "/A/Cat 1", 0.2000m, true), K("A 2", "/A/Cat 1", 0.2000m, true),
            K("B 1", "/B/Cat 3", 0.7000m, true),
        });
        Check("P1 Categoria A: 60% disponible", "0.6000", dos.Para("/A/Cat 1").Disponible);
        Check("P2 Categoria B: 30% disponible", "0.3000", dos.Para("/B/Cat 3").Disponible);
        Check("P3 A puede pedir 60% aunque B use 70%", true, V(Completa("Adopcion", "/A/Cat 1", "60"), false, dos).Valida);
        Check("P4 B no puede pedir 31%", "pct", Campos(V(Completa("Adopcion", "/B/Cat 3", "31"), false, dos)));
        Check("P5 otra categoria de A sin iniciativas: 100%", "1.0000", dos.Para("/A/Cat 2").Disponible);

        // ---- X) concurrencia -------------------------------------------------
        // A abre el formulario con 40% disponible y lo manda; mientras, B
        // consumio 10%. El servidor valida contra el estado ACTUAL.
        var antes = tres;
        var despues = new CapacidadCategoria(new[]
        {
            K("PRB 1", "/A/Cat 1", 0.2000m, true), K("PRB 2", "/A/Cat 1", 0.2000m, true),
            K("PRB 3", "/A/Cat 1", 0.2000m, true), K("PRB 9", "/A/Cat 1", 0.1000m, true),
        });
        var fx = Completa("Adopcion", "/A/Cat 1", "40");
        fx["disponible_cliente"] = "40";
        Check("X1 con el estado de cuando abrio: pasaba", true, V(fx, false, antes).Valida);
        var rx = V(fx, false, despues);
        Check("X2 con el estado actual: rechaza aunque el navegador diga 40", "pct", Campos(rx));
        Check("X2 capacidad recalculada 30%", "0.3000", rx.Capacidad.Disponible);
        fx["disponible_cliente"] = "100";
        Check("X3 inflar disponible_cliente no cambia nada", "pct", Campos(V(fx, false, despues)));
        fx["pct"] = "30";
        Check("X4 30% si cabe", true, V(fx, false, despues).Valida);

        // ---- E) que estados consumen (ExperienciaQueries.ConsumeCapacidad) ---
        Check("E1 En Análisis + Problem", true, ExperienciaQueries.ConsumeCapacidad("En Análisis", "Problem"));
        Check("E1 En Solución + Mejora", true, ExperienciaQueries.ConsumeCapacidad("En Solución", "Mejora"));
        Check("E1 En Monitoreo + SorIA", true, ExperienciaQueries.ConsumeCapacidad("En Monitoreo", "SorIA"));
        Check("E1 sin acento / mayusculas", true, ExperienciaQueries.ConsumeCapacidad("EN ANALISIS", "adopcion"));
        Check("E2 Cerrado no consume", false, ExperienciaQueries.ConsumeCapacidad("Cerrado", "Problem"));
        Check("E2 estado vacio no consume", false, ExperienciaQueries.ConsumeCapacidad(null, "Problem"));
        Check("E2 agrupador fuera de la lista no consume", false, ExperienciaQueries.ConsumeCapacidad("En Análisis", "Otro"));

        // ---- N) numero de solicitud y RCA ------------------------------------
        var n = new NumeroSolicitud(142);
        Check("N1 se muestra #0000142", "#0000142", n.ToString());
        Check("N2 archivo 0000142.pdf", "0000142.pdf", n.NombreArchivoRca("RCA_final_final_v7_JuanPerez.pdf"));
        Check("N2 extension tal cual (sin cambiar grafia)", "0000142.PDF", n.NombreArchivoRca(@"C:\fakepath\Rca.PDF"));
        Check("N2 .docx no se fuerza a .pdf", "0000142.docx", n.NombreArchivoRca("RCA final.docx"));
        Check("N2 .xlsx no se fuerza a .pdf", "0000142.xlsx", n.NombreArchivoRca("analisis.v2.xlsx"));
        Check("N2 sin extension", "0000142", n.NombreArchivoRca("rca"));
        Check("N2 extension rara se descarta", "0000142", n.NombreArchivoRca("rca.p d f"));
        Check("N3 primero #0000001", "#0000001", new NumeroSolicitud(1).ToString());
        Check("N3 no es un Codigo (sin año ni prefijo)", false, n.ToString().Contains("PRB") || n.ToString().Contains("20"));
        bool fuera = false;
        try { new NumeroSolicitud(0); } catch (ArgumentOutOfRangeException) { fuera = true; }
        Check("N4 cero no existe", true, fuera);

        // ---- N5-N8) consecutivo: regla y paso de emision -------------------
        Check("N5 sin emitidos: 0000001", "0000001", NumeroSolicitud.Siguiente(null).Digitos7());
        Check("N5 sigue al ultimo: 142 -> #0000143", "#0000143", NumeroSolicitud.Siguiente(142).ToString());
        Check("N5 siempre 7 digitos", "0000010|0100000|9999999",
              NumeroSolicitud.Siguiente(9).Digitos7() + "|" + NumeroSolicitud.Siguiente(99999).Digitos7() + "|" +
              NumeroSolicitud.Siguiente(9999998).Digitos7());
        bool agotado = false;
        try { NumeroSolicitud.Siguiente(9999999); } catch (InvalidOperationException) { agotado = true; }
        Check("N5 no desborda a 8 digitos", true, agotado);

        // El paso de emision del servicio, con un emisor de prueba que cuenta
        // cuantas veces le piden (no es persistencia: solo el contrato).
        var emisor = new EmisorDePrueba(141);
        var invalida = V(new NameValueCollection(), false, null);
        IniciativaService.AsignarNumero(invalida, emisor);
        Check("N6 invalida: no pide numero", "0|null", emisor.Llamadas + "|" + (invalida.Numero == null ? "null" : "x"));
        var valida = V(Completa("Adopcion", "/A/Cat 1", "20"), false, null);
        IniciativaService.AsignarNumero(valida, emisor);
        Check("N6 valida: un numero, #0000142", "1|#0000142|null",
              emisor.Llamadas + "|" + valida.Numero + "|" + (valida.NumeroPendiente ?? "null"));
        Check("N6 JSON lleva el numero", "#0000142", IniciativaService.ComoJson(valida)["numero_solicitud"]);
        var hoy = V(Completa("Adopcion", "/A/Cat 1", "20"), false, null);
        IniciativaService.AsignarNumero(hoy, new GeneradorNumeroSolicitudPendiente());
        Check("N7 hoy (sin almacen): sin numero y con motivo", "True|" + GeneradorNumeroSolicitudPendiente.Motivo,
              (hoy.Numero == null) + "|" + hoy.NumeroPendiente);
        Check("N7 sigue siendo valida", true, hoy.Valida);
        Check("N7 servicio por omision usa el pendiente", true, ServicioUsaPendiente());
        Check("N8 el numero no sale de dbo.Problem.Codigo", false,
              System.IO.File.ReadAllText(@"App_Code\SolicitudIniciativa.cs").Contains("Problem.Codigo FROM")
              || System.IO.File.ReadAllText(@"App_Code\IniciativaService.cs").Contains("Codigo"));

        // ---- A2) capacidad: casos del hito ----------------------------------
        Check("A2 sin iniciativas: 100%", "1.0000", new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]).Para("/A/Cat 1").Disponible);
        var a30 = new CapacidadCategoria(new[] { K("I 1", "/A/Cat 1", 0.3000m, true) });
        Check("A2 30%: 70%", "0.7000", a30.Para("/A/Cat 1").Disponible);
        var a50 = new CapacidadCategoria(new[] { K("I 1", "/A/Cat 1", 0.3000m, true), K("I 2", "/A/Cat 1", 0.2000m, true) });
        Check("A2 30+20: 50%", "0.5000", a50.Para("/A/Cat 1").Disponible);
        Check("A2 B sigue en 100% con A al 50%", "1.0000", a50.Para("/B/Cat 3").Disponible);
        Check("A2 pedir exactamente lo que queda (50): pasa", true, V(Completa("Adopcion", "/A/Cat 1", "50"), false, a50).Valida);
        Check("A2 pedir 50.01: rechaza", "pct", Campos(V(Completa("Adopcion", "/A/Cat 1", "50.01"), false, a50)));
        Check("A2 B puede pedir 100 con A al 50", true, V(Completa("Adopcion", "/B/Cat 3", "100"), false, a50).Valida);
        var inactivas = new CapacidadCategoria(new[]
        {
            K("C 1", "/A/Cat 1", 0.9000m, false), K("C 2", "/A/Cat 1", 0.5000m, false), K("V 1", "/A/Cat 1", 0.1000m, true),
        });
        Check("A2 no consumen (cerradas/no vigentes): solo cuenta la viva", "0.9000", inactivas.Para("/A/Cat 1").Disponible);
        var dec = new CapacidadCategoria(new[]
        {
            K("D 1", "/A/Cat 1", 0.3300m, true), K("D 2", "/A/Cat 1", 0.2200m, true), K("D 3", "/A/Cat 1", 0.0600m, true),
        });
        Check("A2 decimales 33+22+6: 39% disponible", "0.3900", dec.Para("/A/Cat 1").Disponible);
        Check("A2 39% cabe, 39.01% no", "True|pct",
              V(Completa("Adopcion", "/A/Cat 1", "39"), false, dec).Valida + "|" + Campos(V(Completa("Adopcion", "/A/Cat 1", "39.01"), false, dec)));
        var dec2 = new CapacidadCategoria(new[] { K("E 1", "/A/Cat 1", 0.3333m, true), K("E 2", "/A/Cat 1", 0.3333m, true) });
        Check("A2 33.33+33.33: 33.34% disponible y cabe exacto", "0.3334|True",
              dec2.Para("/A/Cat 1").Disponible + "|" + V(Completa("Adopcion", "/A/Cat 1", "33.34"), false, dec2).Valida);

        // ---- D2) cascada y autorizacion -------------------------------------
        var fpo = Completa("Adopcion", "/A/Cat 1", "20"); fpo["po"] = "PO inventado";
        Check("D2 PO fuera del catalogo", "po", Campos(V(fpo, false, null)));
        var fso = Completa("Adopcion", "/A/Cat 1", "20"); fso["so"] = "SO inventado";
        Check("D2 SO fuera del catalogo", "so", Campos(V(fso, false, null)));
        var fmix = Completa("Adopcion", "/A/Cat 1", "20"); fmix["po"] = "PO 2";
        Check("D2 valores validos que no forman fila: error de combinacion", "categoria", Campos(V(fmix, false, null)));
        foreach (var h in new[] { "catalogos", "capacidad", "validar", "registro", "diagnostico" })
        {
            var ruta = @"handlers\admin_iniciativas_" + h + ".ashx";
            var texto = System.IO.File.ReadAllText(ruta);
            var exigir = texto.IndexOf("if (!AccesoAdmin.Exigir(context)) return;", StringComparison.Ordinal);
            var cuerpo = texto.IndexOf("public void ProcessRequest(HttpContext context)", StringComparison.Ordinal);
            var siguiente = texto.IndexOf(';', cuerpo);   // primera sentencia del metodo
            Check("D3 " + h + ": Exigir es la primera sentencia", true, exigir > cuerpo && texto.IndexOf(';', exigir) == siguiente);
            Check("D3 " + h + ": ruta protegida por el modulo", true,
                  AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_" + h + ".ashx"));
        }
        Check("D4 no autorizado: rechazado por el mismo camino", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(@"SORIANA\t_otro", true)));

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : ("FALLOS: " + fallos));
        return fallos == 0 ? 0 : 1;
    }
}
