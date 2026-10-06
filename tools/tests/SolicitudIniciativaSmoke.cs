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
        new object[] { "PRB", "ADO", "HAR" },
        new[]
        {
            A("PO 1", "SO x", "/A/Cat 1", "Dir A"),
            A("PO 1", "SO y", "/A/Cat 2", "Dir A"),
            A("PO 2", "SO z", "/B/Cat 3", "Dir B"),
        });

    static DirectorioOrganizacional.Dueno Due(string n2, string c1, string po, string so, string dir, bool vigente)
    {
        return new DirectorioOrganizacional.Dueno { CategoriaN2 = n2, C1 = c1, Po = po, So = so, Director = dir, Vigente = vigente };
    }

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
        // ---- T) tipo = Prefijo de dbo.CatPrefijoProblem ---------------------
        var catTipos = DashboardCatalogos.PrefijosOrdenados(new[] {
            new KeyValuePair<string, string>("REQ", "Requerimiento"),
            new KeyValuePair<string, string>("PRB", "Problem"),
            new KeyValuePair<string, string>("ADO", "Adopción"),
            new KeyValuePair<string, string>(" MAP ", "Mejora aplicativo"),
            new KeyValuePair<string, string>("HAR", "Hardware"),
            new KeyValuePair<string, string>("RTI", "Requerimiento de TI a TI"),
        });
        var tipos = DashboardCatalogos.Llaves(catTipos);
        Check("T1 PRB primero", "PRB", tipos[0]);
        Check("T2 el resto por Descripcion", "PRB|ADO|HAR|MAP|REQ|RTI", string.Join("|", tipos));
        Check("T3 sin PRB: no se inventa", "ADO|MAP",
              string.Join("|", TiposSolicitud.ProblemPrimero(new object[] { "ADO", "MAP" })));
        Check("T4 grafia del catalogo intacta", " prb|ADO",
              string.Join("|", TiposSolicitud.ProblemPrimero(new object[] { "ADO", " prb" })));
        Check("T5 ValorProblem = el prefijo PRB", "PRB", TiposSolicitud.ValorProblem(tipos));
        Check("T5 ValorProblem sin PRB", true, TiposSolicitud.ValorProblem(new object[] { "ADO" }) == null);
        Check("T6 la Descripcion 'Problem' no es la llave", false, TiposSolicitud.EsProblem("Problem"));
        Check("T6 'Problema' no es Problem", false, TiposSolicitud.EsProblem("Problema"));
        var porFolio = DashboardCatalogos.PrefijoPorFolio(new[] {
            new KeyValuePair<string, string>("PRB 1", " PRB "),
            new KeyValuePair<string, string>("PRB 1", "HAR"),
            new KeyValuePair<string, string>("X 2", null),
            new KeyValuePair<string, string>("", "PRB"),
        });
        Check("T7 prefijo por folio: limpio, el primero gana, vacios fuera", "1|PRB", porFolio.Count + "|" + porFolio["PRB 1"]);
        Check("T8 la Descripcion no se acepta como tipo (el servidor pide el prefijo)", "tipo",
              Campos(V(Completa("Problem", "/A/Cat 1", "20"), true, null)));
        Check("T8 prefijo que no esta en el catalogo: rechazado", "tipo",
              Campos(V(Completa("XYZ", "/A/Cat 1", "20"), false, null)));
        Check("T8 prefijo en minusculas: no es la llave", "tipo",
              Campos(V(Completa("ado", "/A/Cat 1", "20"), false, null)));

        // ---- R) requeridos --------------------------------------------------
        var ok = V(Completa("ADO", "/A/Cat 1", "20"), false, null);
        Check("R0 completa valida", true, ok.Valida);
        Check("R0 director derivado", "Dir A", ok.Director);
        Check("R0 fraccion", "0.2000", ok.PctFraccion);
        foreach (var campo in new[] { "tipo", "po", "so", "categoria", "titulo", "descripcion", "observaciones", "volumetria", "pct" })
        {
            var f = Completa("ADO", "/A/Cat 1", "20");
            f[campo] = "   ";
            var r = V(f, false, null);
            Check("R1 falta " + campo + " -> invalida", false, r.Valida);
            Check("R1 falta " + campo + " -> error en " + campo, true, r.TieneError(campo));
        }
        Check("R2 todo vacio: nueve errores", 9, V(new NameValueCollection(), false, null).Errores.Count);

        // ---- C) catalogo y cascada -------------------------------------------
        var fc = Completa("Inventado", "/A/Cat 1", "20");
        Check("C1 tipo fuera de catalogo", "tipo", Campos(V(fc, false, null)));
        fc = Completa("ADO", "/A/Cat 1", "20"); fc["so"] = "SO y";
        Check("C2 PO/SO/Categoria sin fila vigente", "categoria", Campos(V(fc, false, null)));
        fc = Completa("ADO", "/A/Cat 9", "20");
        Check("C3 categoria inexistente", "categoria", Campos(V(fc, false, null)));

        // ---- V) formatos -----------------------------------------------------
        foreach (var bueno in new[] { "0", "1", "3", "22", "33.33", "6.5", "100", "100.00" })
            Check("V1 % valido " + bueno, true, ValidadorIniciativa.Fraccion(bueno) != null);
        foreach (var malo in new[] { "-1", "100.01", "101", "abc", "1.234", "1,5", "" })
            Check("V2 % invalido '" + malo + "'", true, ValidadorIniciativa.Fraccion(malo) == null);
        Check("V3 33.33% -> 0.3333", "0.3333", ValidadorIniciativa.Fraccion("33.33"));
        Check("V3 1% -> 0.0100 (sin multiplos de 5)", "0.0100", ValidadorIniciativa.Fraccion("1"));
        var fv = Completa("ADO", "/A/Cat 1", "20"); fv["volumetria"] = "12.5";
        Check("V4 volumetria decimal", "volumetria", Campos(V(fv, false, null)));
        fv["volumetria"] = "99999999999";
        Check("V4 volumetria fuera de INT", "volumetria", Campos(V(fv, false, null)));
        fv["volumetria"] = "0";
        Check("V4 volumetria 0 valida", true, V(fv, false, null).Valida);

        // ---- A) RCA ----------------------------------------------------------
        var prbSin = V(Completa("PRB", "/A/Cat 1", "20"), false, null);
        Check("A1 Problem sin RCA -> INVALID", "rca", Campos(prbSin));
        Check("A1 rca_obligatorio", true, prbSin.RcaObligatorio);
        Check("A2 Problem con RCA -> VALID", true, V(Completa("PRB", "/A/Cat 1", "20"), true, null).Valida);
        Check("A3 otro tipo sin RCA -> VALID", true, V(Completa("HAR", "/A/Cat 1", "20"), false, null).Valida);
        Check("A4 otro tipo con RCA -> VALID", true, V(Completa("HAR", "/A/Cat 1", "20"), true, null).Valida);
        Check("A5 otro tipo: RCA opcional", false, V(Completa("HAR", "/A/Cat 1", "20"), false, null).RcaObligatorio);

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
        Check("K5 40% con 40% disponible: valida", true, V(Completa("ADO", "/A/Cat 1", "40"), false, tres).Valida);
        Check("K5 40.01% con 40% disponible: error en pct", "pct", Campos(V(Completa("ADO", "/A/Cat 1", "40.01"), false, tres)));
        Check("K5 50% con 40%: error en pct", "pct", Campos(V(Completa("ADO", "/A/Cat 1", "50"), false, tres)));
        Check("K5 0% con 0% disponible: valida", true, V(Completa("ADO", "/A/Cat 1", "0"), false, llena).Valida);
        Check("K5 1% con 0% disponible: error", "pct", Campos(V(Completa("ADO", "/A/Cat 1", "1"), false, llena)));
        var exceso = new CapacidadCategoria(new[] { K("X 1", "/A/Cat 1", 0.7000m, true), K("X 2", "/A/Cat 1", 0.5000m, true) });
        Check("K6 lo existente pasa de 100%: disponible 0", "0.0000|True", exceso.Para("/A/Cat 1").Disponible + "|" + exceso.Para("/A/Cat 1").Excedida);
        var noConsume = new CapacidadCategoria(new[] { K("C 1", "/A/Cat 1", 0.5000m, false), K("C 2", "/A/Cat 1", 0.2000m, true) });
        Check("K7 la que no consume no resta", "0.8000", noConsume.Para("/A/Cat 1").Disponible);
        var cambio = new CapacidadCategoria(new[] { K("PRB 1", "/A/Cat 1", 0.3500m, true) });
        Check("K8 edicion: cuenta el % actual (35), no uno historico", "0.6500", cambio.Para("/A/Cat 1").Disponible);
        Check("K9 ruta con espacios / NBSP / mayusculas", "0.8000",
              una.Para(" /a/cat 1\u00A0").Disponible);

        // ---- G) 100% = UNA ruta real: padres, hijas y hermanas no comparten --
        // Rutas del diag G5 de la VM (/S-Autocobro/Falla en periféricos/...).
        const string N2 = "/S-Autocobro/Falla en periféricos";
        var autocobro = new CapacidadCategoria(new[]
        {
            K("HAR 2026-000027", N2 + "/Falla Electrica (Daño Perifericos)", 1.0000m, true),
            K("MAP 2026-000023", N2 + "/Falla en báscula de seguridad", 0.8000m, true),
            K("HAR 2026-000030", N2 + "/Falla en Scanner de mano", 1.0000m, true),
        });
        Check("G1 cada ruta es su propia llave: Electrica 0%", "0.0000", autocobro.Para(N2 + "/Falla Electrica (Daño Perifericos)").Disponible);
        Check("G1 bascula 20%", "0.2000", autocobro.Para(N2 + "/Falla en báscula de seguridad").Disponible);
        Check("G2 la N2 padre NO suma a sus hijas: 100%", "1.0000", autocobro.Para(N2).Disponible);
        Check("G2 la N2 padre es determinable", true, autocobro.Para(N2).Determinable);
        Check("G3 hermana sin iniciativas: 100% aunque las otras esten llenas", "1.0000",
              autocobro.Para(N2 + "/Falla en impresora").Disponible);
        var padre = new CapacidadCategoria(new[] { K("P 1", "/A/Cat 1", 1.0000m, true) });
        Check("G4 el padre al 100% no consume a la hija", "1.0000", padre.Para("/A/Cat 1/Sub").Disponible);
        var hija = new CapacidadCategoria(new[] { K("H 1", "/A/Cat 1/Sub", 1.0000m, true) });
        Check("G5 la hija al 100% no consume al padre", "1.0000", hija.Para("/A/Cat 1").Disponible);
        Check("G5 el padre puede pedir 100 con la hija llena", true, V(Completa("ADO", "/A/Cat 1", "100"), false, hija).Valida);
        Check("G6 prefijo de texto tampoco", "1.0000",
              new CapacidadCategoria(new[] { K("Z 1", "/A/Cat 10", 0.9000m, true) }).Para("/A/Cat 1").Disponible);
        Check("G7 la misma ruta con '/' final es OTRA cadena: no se recorta", "1.0000",
              new CapacidadCategoria(new[] { K("T 1", "/A/Cat 1/", 0.5000m, true) }).Para("/A/Cat 1").Disponible);
        var pasada = new CapacidadCategoria(new[] { K("X 1", "/A/Cat 1", 0.8000m, true), K("X 2", "/A/Cat 1", 0.4000m, true) });
        Check("G8 existente > 100% en la ruta: disponible 0, no negativo", "1.2000|0.0000|True",
              pasada.Para("/A/Cat 1").Usado + "|" + pasada.Para("/A/Cat 1").Disponible + "|" + pasada.Para("/A/Cat 1").Excedida);
        Check("G8 su hija no compensa ni se afecta", "1.0000", pasada.Para("/A/Cat 1/Sub").Disponible);


        // ---- P) por categoria ------------------------------------------------
        var dos = new CapacidadCategoria(new[]
        {
            K("A 1", "/A/Cat 1", 0.2000m, true), K("A 2", "/A/Cat 1", 0.2000m, true),
            K("B 1", "/B/Cat 3", 0.7000m, true),
        });
        Check("P1 Categoria A: 60% disponible", "0.6000", dos.Para("/A/Cat 1").Disponible);
        Check("P2 Categoria B: 30% disponible", "0.3000", dos.Para("/B/Cat 3").Disponible);
        Check("P3 A puede pedir 60% aunque B use 70%", true, V(Completa("ADO", "/A/Cat 1", "60"), false, dos).Valida);
        Check("P4 B no puede pedir 31%", "pct", Campos(V(Completa("ADO", "/B/Cat 3", "31"), false, dos)));
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
        var fx = Completa("ADO", "/A/Cat 1", "40");
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
        var valida = V(Completa("ADO", "/A/Cat 1", "20"), false, null);
        IniciativaService.AsignarNumero(valida, emisor);
        Check("N6 valida: un numero, #0000142", "1|#0000142|null",
              emisor.Llamadas + "|" + valida.Numero + "|" + (valida.NumeroPendiente ?? "null"));
        Check("N6 JSON lleva el numero", "#0000142", IniciativaService.ComoJson(valida)["numero_solicitud"]);
        var hoy = V(Completa("ADO", "/A/Cat 1", "20"), false, null);
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
        Check("A2 pedir exactamente lo que queda (50): pasa", true, V(Completa("ADO", "/A/Cat 1", "50"), false, a50).Valida);
        Check("A2 pedir 50.01: rechaza", "pct", Campos(V(Completa("ADO", "/A/Cat 1", "50.01"), false, a50)));
        Check("A2 B puede pedir 100 con A al 50", true, V(Completa("ADO", "/B/Cat 3", "100"), false, a50).Valida);
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
              V(Completa("ADO", "/A/Cat 1", "39"), false, dec).Valida + "|" + Campos(V(Completa("ADO", "/A/Cat 1", "39.01"), false, dec)));
        var dec2 = new CapacidadCategoria(new[] { K("E 1", "/A/Cat 1", 0.3333m, true), K("E 2", "/A/Cat 1", 0.3333m, true) });
        Check("A2 33.33+33.33: 33.34% disponible y cabe exacto", "0.3334|True",
              dec2.Para("/A/Cat 1").Disponible + "|" + V(Completa("ADO", "/A/Cat 1", "33.34"), false, dec2).Valida);

        // ---- D2) cascada y autorizacion -------------------------------------
        var fpo = Completa("ADO", "/A/Cat 1", "20"); fpo["po"] = "PO inventado";
        Check("D2 PO fuera del catalogo", "po", Campos(V(fpo, false, null)));
        var fso = Completa("ADO", "/A/Cat 1", "20"); fso["so"] = "SO inventado";
        Check("D2 SO fuera del catalogo", "so", Campos(V(fso, false, null)));
        var fmix = Completa("ADO", "/A/Cat 1", "20"); fmix["po"] = "PO 2";
        Check("D2 valores validos que no forman fila: error de combinacion", "categoria", Campos(V(fmix, false, null)));
        foreach (var h in new[] { "catalogos", "capacidad", "validar", "registro", "diagnostico" })
        {
            var ruta = @"handlers\admin_iniciativas_" + h + ".ashx";
            var texto = System.IO.File.ReadAllText(ruta);
            // Crear (capacidad, validar) es solo de ADM: ExigirAdm (que corre
            // Exigir primero). Lo que MOD tambien usa: Exigir.
            var soloAdm = h == "capacidad" || h == "validar";
            var linea = soloAdm ? "if (!AccesoAdmin.ExigirAdm(context)) return;" : "if (!AccesoAdmin.Exigir(context)) return;";
            var exigir = texto.IndexOf(linea, StringComparison.Ordinal);
            var cuerpo = texto.IndexOf("public void ProcessRequest(HttpContext context)", StringComparison.Ordinal);
            var siguiente = texto.IndexOf(';', cuerpo);   // primera sentencia del metodo
            Check("D3 " + h + ": " + (soloAdm ? "ExigirAdm" : "Exigir") + " es la primera sentencia", true,
                  exigir > cuerpo && texto.IndexOf(';', exigir) == siguiente);
            Check("D3 " + h + ": ruta protegida por el modulo", true,
                  AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_" + h + ".ashx"));
        }
        Check("D4 no autorizado: rechazado por el mismo camino", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(@"SORIANA\t_otro", true)));

        // ---- RC) catalogo de rutas reales (CatalogoRutasIniciativa) ---------
        // Dueños: N2 exacto (C1&C2 de la ruta) o heredado del C1, la regla de
        // vw_ProblemCategoria via DirectorioOrganizacional.Resolver.
        var dir = new DirectorioOrganizacional(new List<DirectorioOrganizacional.Dueno>
        {
            Due("/S-A/Uno", "S-A", "PO 1", "SO x", "Dir A", true),
            Due("/S-A/Dos", "S-A", "PO 2", "SO y", "Dir A", true),
            Due("/S-B/Uno", "S-B", "PO 3", "SO z", "Dir B", false),     // N2 dado de baja
            Due("/S-C/Uno", "S-C", null, "SO w", "Dir C", true),        // sin PO
        }, new Dictionary<string, string>());
        var cat = CatalogoRutasIniciativa.Asignaciones(new[]
        {
            "/S-A/Uno/Hoja 1", "/S-A/Uno/Hoja 2", "/S-A/Uno", " /S-A/Uno/Hoja 1 ", "/S-A/Dos/X/Y",
            "/S-A/Tres/Hoja",          // N2 sin fila: hereda del C1 S-A (primera fila: PO 1)
            "/S-B/Uno/Hoja",           // dueños solo en fila no vigente
            "/S-C/Uno/Hoja",           // sin PO
            "/S-Z/Nada",               // C1 sin dueños
            null, "",
        }, dir);
        var rutas = (List<object>)cat["rutas"];
        var lineas = new List<string>();
        foreach (Dictionary<string, object> f in rutas)
            lineas.Add(f["categoria"] + ">" + f["po"] + ">" + f["so"] + ">" + f["director"]);
        Check("RC1 la categoria es la RUTA (no la N2), unica y normalizada",
              "/S-A/Dos/X/Y>PO 2>SO y>Dir A|/S-A/Tres/Hoja>PO 1>SO x>Dir A|/S-A/Uno>PO 1>SO x>Dir A|" +
              "/S-A/Uno/Hoja 1>PO 1>SO x>Dir A|/S-A/Uno/Hoja 2>PO 1>SO x>Dir A",
              string.Join("|", lineas));
        Check("RC2 rutas sin Director/PO/SO: contadas, no inventadas", 2, cat["rutas_sin_duenos"]);
        Check("RC3 dueños solo en fila no vigente: contadas", 1, cat["rutas_duenos_no_vigentes"]);
        Check("RC4 FuenteVigente: N2 exacto vigente", true, dir.FuenteVigente("S-A", "/S-A/Uno"));
        Check("RC4 FuenteVigente: N2 no vigente", false, dir.FuenteVigente("S-B", "/S-B/Uno"));
        Check("RC4 FuenteVigente: sin fila", false, dir.FuenteVigente("S-Z", "/S-Z/Nada"));
        string c1, c1c2;
        ExperienciaQueries.CortesDeRuta("/S-A/Uno/Hoja 1", out c1, out c1c2);
        Check("RC5 cortes de la ruta (replicas de fn_CategoriaC1/C1C2)", "S-A|/S-A/Uno", c1 + "|" + c1c2);

        // El validador sobre esas rutas: la N2 sola no es una opcion si no es
        // una ruta activa del catalogo, y la combinacion se exige.
        var catRutas = CatalogoSolicitud.Desde(new object[] { "ADO", "PRB" }, rutas);
        var fr = new NameValueCollection();
        fr["tipo"] = "ADO"; fr["po"] = "PO 1"; fr["so"] = "SO x"; fr["categoria"] = "/S-A/Uno/Hoja 1";
        fr["titulo"] = "T"; fr["descripcion"] = "D"; fr["observaciones"] = "O"; fr["volumetria"] = "5"; fr["pct"] = "20";
        var capRuta = new CapacidadCategoria(new[] { K("I 1", "/S-A/Uno/Hoja 1", 0.3000m, true), K("I 2", "/S-A/Uno", 1.0000m, true) });
        var rv = new ValidadorIniciativa().Validar(SolicitudIniciativa.DesdeFormulario(fr, false, null), catRutas, capRuta);
        Check("RC6 ruta valida: pasa con su propio 70% (el padre lleno no cuenta)", "True|0.7000|Dir A",
              rv.Valida + "|" + rv.Capacidad.Disponible + "|" + rv.Director);
        fr["categoria"] = "/S-A/Tres";
        Check("RC7 N2 que no es ruta activa: categoria invalida", "categoria",
              Campos(new ValidadorIniciativa().Validar(SolicitudIniciativa.DesdeFormulario(fr, false, null), catRutas, capRuta)));
        fr["categoria"] = "/S-A/Dos/X/Y";
        Check("RC8 ruta de otro PO/SO: combinacion invalida", "categoria",
              Campos(new ValidadorIniciativa().Validar(SolicitudIniciativa.DesdeFormulario(fr, false, null), catRutas, capRuta)));
        fr["categoria"] = "/S-B/Uno/Hoja";
        Check("RC9 ruta con dueños no vigentes: no elegible", "categoria",
              Campos(new ValidadorIniciativa().Validar(SolicitudIniciativa.DesdeFormulario(fr, false, null), catRutas, capRuta)));

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : ("FALLOS: " + fallos));
        return fallos == 0 ? 0 : 1;
    }
}
