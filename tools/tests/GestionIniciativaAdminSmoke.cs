// Prueba offline de la gestion directa de ADM (App_Code/GestionIniciativaAdmin.cs):
// formato, catalogo, cambios, faltantes (Incompleta) y la respuesta de
// persistencia NO habilitada. Sin IIS y sin SQL Server: catalogo,
// compromisos e iniciativa actual armados a mano.
//
// Casos:
//   P) Persistencia: constante true (2026-10-14); la validacion sola dice
//      guardada=false, persistencia=habilitada y codigo=null, valida o no.
//   CF) Crear, formato: sin tipo; % invalido; % sin categoria; categoria
//      repetida; pares desparejos.
//   CC) Crear, catalogo: tipo/PO/SO/categoria fuera del catalogo; cascada
//      incompleta valida; combinacion que no sale de ninguna fila; Director
//      derivado solo si es uno.
//   CI) Crear, Incompleta: faltantes en el orden de CAMPOS_INCOMPLETA; RCA
//      solo en Problem; borrador minimo (solo tipo) es valido e incompleto.
//   CK) Crear, tope 100% por ruta = ERROR (antes advertencia en ADM); cada
//      categoria con su %; otra ruta no resta.
//   CM) Crear con varias categorias: cada una contra el catalogo, Director
//      unico entre todas, Incompleta si alguna no tiene %.
//   MF) Modificar, formato: sin folio; pares desparejos; % invalido; repetida.
//   MM) Modificar: folio inexistente; sin cambios = error; cambios de texto
//      (CRLF no cuenta); % de categoria no ligada = error; vaciar % deja
//      Incompleta; capacidad sin contar la propia iniciativa.
//   MR) IniciativaActual.DesdeRegistro con la forma del registro.
//   MA) Modificar categorias: agregar (catalogo, ya ligada, capacidad),
//      quitar (no ligada, quitar y cambiar a la vez), quedar sin categorias.
//   MD) Modificar fechas compromiso y Estado/Subestado (valores existentes,
//      sin reglas de transicion inventadas). El codigo nunca cambia.
//   MK) Tope en Modificar: subir por encima = error; ruta ya excedida se
//      puede bajar o dejar igual; iniciativa que no consume no tiene tope.
//   V)  VolumetriaCategoria.Resolver: ok, cero real, sin datos, ruta vacia,
//      llave normalizada como Experiencia.
//   DQ) PO / SO capturados y quitar categoria en Modificar (sql/24): la
//      constante encendida solo surte efecto con sql/24 vista en la base
//      (AnotarSql24, vigencia); sin ella se rechazan / quedan pendientes;
//      encendida, se validan contra el catalogo y entran al plan. PO y SO
//      independientes (cambiar uno no lleva el otro al plan). Codigo
//      sigue inmutable con los campos nuevos.
//   VQ) Volumetria fijada por ADM en Crear (sql/26): solo con sql/26 vista
//      en la base (AnotarSql26); sin ella una volumetria escrita se rechaza
//      (422), vacia sigue igual; formato entero >= 0 que cabe en int; entra
//      al plan (0 es 0, no NULL); el % y las categorias no cambian;
//      Modificar no la lee. Los demas casos corren como con sql/26.
//   SQ) Subestado inicial en Crear (sql/27): solo con sql/27 vista en la
//      base (AnotarSql27); sin ella un Subestado elegido se rechaza (422),
//      vacio u omitido sigue igual; uno que no existe = error; sin la lista
//      de valores = error; valido entra al plan (recortado) y al JSON; el
//      Estado no cambia ni se valida contra el. Los demas casos corren
//      como con sql/27.
//   EN) Acentos en la respuesta del servidor (faltantes, cambios, JSON) y
//      fuentes sin BOM sin literales no ASCII; motivo de persistencia vigente.
//
// Compilar y correr desde la raiz del repo. /codepage:1252 = como compila IIS
// los archivos sin BOM (sin el, EN1-EN4 no ven el mojibake del servidor):
//   csc /nologo /target:library /codepage:1252 /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:GestionIniciativaAdminSmoke.exe /r:adm.dll /r:System.dll /r:System.Web.Extensions.dll ^
//       tools\tests\GestionIniciativaAdminSmoke.cs
//   GestionIniciativaAdminSmoke.exe
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Linq;

public static class GestionIniciativaAdminSmoke
{
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

    static CapacidadCategoria.Compromiso K(string folio, string cat, decimal pct)
    {
        return new CapacidadCategoria.Compromiso { Folio = folio, Categoria = cat, Pct = pct, Consume = true };
    }

    static readonly CatalogoSolicitud Catalogo = new CatalogoSolicitud(
        new object[] { "PRB", "ADO", "MAP" },
        new[]
        {
            A("PO 1", "SO x", "/A/Cat 1", "Dir A"),
            A("PO 1", "SO y", "/A/Cat 2", "Dir A"),
            A("PO 2", "SO z", "/B/Cat 3", "Dir B"),
            A("PO 3", "SO z", "/B/Cat 3", "Dir C"),
        });

    static PeticionCrearAdmin C(string tipo, string po = null, string so = null, string cat = null, string pct = null,
                                string tit = null, string desc = null, string obs = null, bool rca = false)
    {
        var p = PeticionCrearAdmin.Una(tipo, cat, pct);
        p.Po = po; p.So = so; p.Titulo = tit; p.Descripcion = desc; p.Observaciones = obs; p.TieneRca = rca;
        return Declarar(p);
    }

    // Lo que el alta declara (no se deriva del prefijo): por omision valores
    // que existen en Estados.
    static PeticionCrearAdmin Declarar(PeticionCrearAdmin p)
    {
        p.TipoIniciativa = "Problem"; p.TipoAgrupado = "Problem"; p.Estado = "En An\u00e1lisis";
        return p;
    }

    // Varias categorias: "ruta", "pct", "ruta", "pct"...
    static PeticionCrearAdmin CV(string tipo, params string[] rp)
    {
        var p = new PeticionCrearAdmin { Tipo = tipo };
        for (var i = 0; i < rp.Length; i += 2) p.Categorias.Add(new PctCategoria { Categoria = rp[i], Texto = rp[i + 1] });
        return Declarar(p);
    }

    static string Campos(ResultadoGestionAdmin r) { return string.Join(",", r.Errores.Select(e => e.Campo ?? "-").ToArray()); }
    static string Faltan(ResultadoGestionAdmin r) { return string.Join(",", r.Faltantes.Select(f => (string)f["clave"]).ToArray()); }

    static ResultadoGestionAdmin Crear(PeticionCrearAdmin p, params CapacidadCategoria.Compromiso[] k)
    {
        return new ValidadorGestionAdmin().Crear(p, Catalogo, new CapacidadCategoria(k), "PRB", Estados);
    }

    static IniciativaActual Actual()
    {
        return Actual("En An\u00e1lisis", "Problem");
    }

    static IniciativaActual Actual(string estado, string agrup)
    {
        return IniciativaActual.DesdeRegistro(new Dictionary<string, object>
        {
            { "folio", "PRB 2026-000001" }, { "titulo", "Titulo iniciativa" }, { "titulo_problem", "Titulo problem" },
            { "descripcion", "Linea 1\nLinea 2" }, { "observaciones", null }, { "sin_categoria", false },
            { "f_analisis", "2026-10-01" }, { "f_solucion", null }, { "f_cierre", "2026-12-15" },
            { "estado", estado }, { "subestado", "En An\u00e1lisis" },
            { "categorias", new List<object>
                {
                    new Dictionary<string, object> { { "categoria", "/A/Cat 1" }, { "pct_dism", 0.5 }, { "agrup", agrup } },
                    new Dictionary<string, object> { { "categoria", "/A/Cat 2" }, { "pct_dism", null }, { "agrup", agrup } },
                } },
        });
    }

    // Con PO capturado "PO 1" y SO capturado vacio (dbo.Problem).
    static IniciativaActual ActualDuenos()
    {
        var a = Actual();
        a.PoCapturado = "PO 1";
        a.SoCapturado = "";
        return a;
    }

    static ResultadoGestionAdmin ModD(NameValueCollection f)
    {
        return new ValidadorGestionAdmin().Modificar(M(f), ActualDuenos(), new CapacidadCategoria.Compromiso[0], Catalogo, Estados);
    }

    // Con los dos capturados: PO "PO 1" y SO "SO x".
    static IniciativaActual ActualAmbos()
    {
        var a = Actual();
        a.PoCapturado = "PO 1";
        a.SoCapturado = "SO x";
        return a;
    }

    static ResultadoGestionAdmin ModAmbos(NameValueCollection f)
    {
        return new ValidadorGestionAdmin().Modificar(M(f), ActualAmbos(), new CapacidadCategoria.Compromiso[0], Catalogo, Estados);
    }

    // Activa con el forzado de prueba puesto en v (y lo deja en null).
    static bool Forzada(bool? v)
    {
        PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = v;
        var activa = PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva();
        PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = null;
        return activa;
    }

    static string PlanProblem(PlanModificarAdmin plan)
    {
        return string.Join("|", plan.Problem.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key + "=" + x.Value).ToArray());
    }

    static IniciativaActual ActualFechas(string estado, string fSolucion, string fCierre)
    {
        return IniciativaActual.DesdeRegistro(new Dictionary<string, object>
        {
            { "folio", "PRB 2026-000001" }, { "titulo", "Titulo" }, { "titulo_problem", "Titulo" },
            { "descripcion", null }, { "observaciones", null }, { "sin_categoria", true },
            { "f_analisis", "2026-10-01" }, { "f_solucion", fSolucion }, { "f_cierre", fCierre },
            { "estado", estado }, { "subestado", null }, { "categorias", new List<object>() },
        });
    }

    // Lo que el plan escribe en dbo.Problem (clave=valor, ordenado).
    static string PlanFechas(IniciativaActual a, DateTime hoy, params string[] kv)
    {
        var f = F(new[] { "folio", a.Folio }.Concat(kv).ToArray());
        var r = new ValidadorGestionAdmin().Modificar(M(f), a, new CapacidadCategoria.Compromiso[0], Catalogo, Estados);
        if (!r.Valida) return "invalida:" + Campos(r);
        var plan = PlanificadorGestionAdmin.Modificar(M(f), a, r, hoy);
        return string.Join("|", plan.Problem.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key + "=" + x.Value).ToArray());
    }

    static PeticionModificarAdmin M(NameValueCollection f) { return PeticionModificarAdmin.DesdeFormulario(f); }

    static NameValueCollection F(params string[] kv)
    {
        var f = new NameValueCollection();
        for (var i = 0; i < kv.Length; i += 2) f.Add(kv[i], kv[i + 1]);
        return f;
    }

    static ResultadoGestionAdmin Mod(NameValueCollection f, params CapacidadCategoria.Compromiso[] k)
    {
        return new ValidadorGestionAdmin().Modificar(M(f), Actual(), k);
    }

    static readonly EstadosProblem Estados = new EstadosProblem(
        new[] { "En An\u00e1lisis", "En Soluci\u00f3n", "En Monitoreo", "Cerrado" }, new[] { "En An\u00e1lisis", "Solucionado", "Cancelado" },
        new[] { "Problem", "Mejora", "Adopci\u00f3n" }, new[] { "Problem", "Adopcion", "Requerimiento", "Adopci\u00f3n" });

    // Modificar con catalogo de rutas y estados (la forma del servicio).
    static ResultadoGestionAdmin ModC(NameValueCollection f, params CapacidadCategoria.Compromiso[] k)
    {
        return new ValidadorGestionAdmin().Modificar(M(f), Actual(), k, Catalogo, Estados);
    }

    static CapacidadCategoria.Compromiso KN(string folio, string cat, decimal pct)
    {
        return new CapacidadCategoria.Compromiso { Folio = folio, Categoria = cat, Pct = pct, Consume = false };
    }

    static string Rotulo(List<Dictionary<string, object>> filas, string clave)
    {
        foreach (var f in filas) if ((string)f["clave"] == clave) return (string)f["rotulo"];
        return null;
    }

    // Archivo sin BOM: lineas de codigo (no comentario) con bytes > 127.
    // Con BOM el compilador lo lee como UTF-8 y no aplica.
    static string NoAsciiEnCodigo(params string[] archivos)
    {
        var malas = new List<string>();
        foreach (var a in archivos)
        {
            var b = System.IO.File.ReadAllBytes(a);
            if (b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF) continue;
            var lineas = System.Text.Encoding.GetEncoding(28591).GetString(b).Split('\n');
            var enBloque = false;
            for (var i = 0; i < lineas.Length; i++)
            {
                var l = lineas[i].Trim();
                if (enBloque) { if (l.Contains("*/")) enBloque = false; continue; }
                if (l.StartsWith("/*")) { enBloque = !l.Contains("*/"); continue; }
                if (l.StartsWith("//") || l.StartsWith("<%--")) continue;
                if (l.Any(c => c > 127)) malas.Add(a + ":" + (i + 1));
            }
        }
        return string.Join(" ", malas.ToArray());
    }

    public static int Main()
    {
        // Los casos de siempre, como con sql/26 en la base (VQ prueba sin ella).
        PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = true;
        // Y como con sql/27 (SQ prueba sin ella).
        PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = true;
        // ---- P ----
        Check("P1 persistencia es constante true (encendida 2026-10-14)", true, PersistenciaGestionAdmin.Habilitada);
        var j = Crear(C("ADO")).ComoJson();
        // La validacion sola nunca guarda: guardada/codigo los pone el handler
        // cuando la base confirma.
        Check("P2 valida: guardada=false, persistencia=habilitada, codigo=null", "True|False|habilitada|",
            j["valida"] + "|" + j["guardada"] + "|" + j["persistencia"] + "|" + j["codigo"]);
        Check("P3 encendida: sin el motivo de 'no habilitada'", null, j["persistencia_motivo"]);
        Check("P4 bloqueos sin sql/24: quitar categoria, PO/SO en Modificar y RCA; PO/SO del alta ya se guardan", "3|True|True|True|False",
            ((List<string>)j["bloqueos"]).Count + "|" + ((List<string>)j["bloqueos"])[0].StartsWith("quitar categor") + "|" +
            ((List<string>)j["bloqueos"])[1].StartsWith("Product Owner / Service Owner en Modificar") + "|" +
            ((List<string>)j["bloqueos"])[2].StartsWith("RCA") + "|" +
            ((List<string>)j["bloqueos"]).Contains(PersistenciaGestionAdmin.BloqueoDuenos));
        var ji = Crear(C(null)).ComoJson();
        Check("P5 invalida tambien: guardada=false", "False|False", ji["valida"] + "|" + ji["guardada"]);
        Check("P6 invalida: sin el motivo \"la validacion paso\"", null, ji["persistencia_motivo"]);

        // ---- CF ----
        var v = new ValidadorGestionAdmin();
        Check("CF1 sin tipo = error de tipo", "tipo", Campos(v.FormatoCrear(C(" "))));
        Check("CF1 formato no revisa catalogo", false, v.FormatoCrear(C(" ")).CatalogoRevisado);
        Check("CF2 categoria repetida (sin distinguir mayusculas)", "categorias",
            Campos(v.FormatoCrear(CV("ADO", "/A/Cat 1", "10", "/a/cat 1", "5"))));
        var desp = Declarar(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "cat_ruta", "/A/Cat 1"), false));
        Check("CF2 pares cat_ruta / cat_pct desparejos", "categorias", Campos(v.FormatoCrear(desp)));
        Check("CF3 % fuera de rango", "pct", Campos(v.FormatoCrear(C("ADO", cat: "/A/Cat 1", pct: "100.01"))));
        Check("CF3 % con tres decimales", "pct", Campos(v.FormatoCrear(C("ADO", cat: "/A/Cat 1", pct: "1.234"))));
        Check("CF4 % sin categoria", "pct", Campos(v.FormatoCrear(C("ADO", pct: "10"))));
        Check("CF5 % valido", "", Campos(v.FormatoCrear(C("ADO", cat: "/A/Cat 1", pct: "33.5"))));
        var form = PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "cat_ruta", "/A/Cat 1", "cat_pct", "10",
                                                         "cat_ruta", "/A/Cat 2", "cat_pct", ""), false);
        Check("CF6 formulario: dos categorias, la segunda sin %", "2|/A/Cat 2|", form.Categorias.Count + "|" +
            form.Categorias[1].Categoria + "|" + form.Categorias[1].Texto);

        // ---- CC ----
        Check("CC1 tipo fuera del catalogo", "tipo", Campos(Crear(C("XXX"))));
        Check("CC2 PO fuera del catalogo", "po", Campos(Crear(C("ADO", po: "Nadie"))));
        Check("CC2 SO fuera del catalogo", "so", Campos(Crear(C("ADO", so: "Nadie"))));
        Check("CC2 categoria fuera del catalogo", "categoria", Campos(Crear(C("ADO", cat: "/Z"))));
        Check("CC3 los tres vacios es valido", "True|", Crear(C("ADO")).Valida + "|" + Campos(Crear(C("ADO"))));
        Check("CC3 solo categoria es valido", "", Campos(Crear(C("ADO", cat: "/A/Cat 2"))));
        // PO / SO: opcionales, independientes y SIN cascada; se guardan
        // (sql/20). Cada uno solo tiene que estar en el catalogo.
        Check("CD0 GuardaDuenos = true (sql/20 aprobada)", true, PersistenciaGestionAdmin.GuardaDuenos);
        Check("CD1 solo PO: valido", "True|", Crear(C("ADO", po: "PO 1")).Valida + "|" + Campos(Crear(C("ADO", po: "PO 1"))));
        Check("CD2 solo SO: valido", "True|", Crear(C("ADO", so: "SO z")).Valida + "|" + Campos(Crear(C("ADO", so: "SO z"))));
        Check("CD3 los tres de una fila: valido", "True|",
              Crear(C("ADO", po: "PO 1", so: "SO x", cat: "/A/Cat 1")).Valida + "|" + Campos(Crear(C("ADO", po: "PO 1", so: "SO x", cat: "/A/Cat 1"))));
        // La combinacion que no sale de ninguna fila del catalogo es valida.
        Check("CD4 PO y categoria que no salen juntos: valido", "", Campos(Crear(C("ADO", po: "PO 2", cat: "/A/Cat 1"))));
        Check("CD4 PO y SO que no salen juntos: valido", "", Campos(Crear(C("ADO", po: "PO 2", so: "SO x"))));
        Check("CD4 PO 3 + SO x + Cat 2 (ninguna fila): valido", "", Campos(Crear(C("ADO", po: "PO 3", so: "SO x", cat: "/A/Cat 2"))));
        Check("CD5 nombre escrito a mano (no esta en el catalogo): rechazado por catalogo", "po,so",
              Campos(Crear(C("ADO", po: "Juan Perez", so: "Alguien"))));
        Check("CD5 ... el resto de la peticion no se toca: categoria valida sin error", "po",
              Campos(Crear(C("ADO", po: "Juan Perez", cat: "/A/Cat 1"))));
        var form2 = PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "po", "  PO 1  ", "so", ""), false);
        Check("CD6 formulario: po llega tal cual, so vacio", "  PO 1  |", form2.Po + "|" + form2.So);
        Check("CD6 PO con espacios de mas: valido (se recorta, no se cambia)", "", Campos(Crear(form2)));
        // ---- CT: Clasificacion y Agrupacion salen del Tipo (regla 2026-10-15) ----
        var formT = PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "tipo_iniciativa", "Problem", "tipo_agrupado", "Problem"), false);
        Check("CT1 formulario: salen del Tipo y se ignora lo que mande", "Adopci\u00f3n|Adopci\u00f3n", formT.TipoIniciativa + "|" + formT.TipoAgrupado);
        var rT = Crear(formT);
        Check("CT1 ... valido y sin faltantes de tipos", "True|", rT.Valida + "|" + string.Join(",", Faltan(rT).Split(',').Where(k => k.StartsWith("tipo")).ToArray()));
        var plT = PlanificadorGestionAdmin.Crear(formT, rT, new DateTime(2026, 10, 15));
        Check("CT2 plan: la iniciativa lleva los del Tipo", "Adopci\u00f3n|Adopci\u00f3n", plT.TipoIniciativa + "|" + plT.TipoAgrupado);
        var formTc = PeticionCrearAdmin.DesdeFormulario(F("tipo", "PRB", "cat_ruta", "/A/Cat 1", "cat_pct", "10"), false);
        var plTc = PlanificadorGestionAdmin.Crear(formTc, Crear(formTc), new DateTime(2026, 10, 15));
        Check("CT2 ... y sus categorias iniciales tambien", "Problem|Problem", plTc.Categorias[0].TipoIniciativa + "|" + plTc.Categorias[0].TipoAgrupado);
        Check("CT3 regla completa (los 9 prefijos de CatPrefijoProblem)",
              "Adopci\u00f3n>Adopci\u00f3n,Hardware>ReqOpr,Mejora Aplicativo>Mejora,Problem>Problem,Requerimiento>ReqOpr," +
              "Requerimiento TI a TI>ReqOpr,Shift Left Administrador>Adopci\u00f3n,SorIA_KB>SorIA,SorIA>SorIA",
              string.Join(",", new[] { "ADO", "HAR", "MAP", "PRB", "REQ", "RTI", "S2L", "SKB", "SOR" }
                  .Select(x => TiposPorPrefijo.Clasificacion(x) + ">" + TiposPorPrefijo.Agrupacion(TiposPorPrefijo.Clasificacion(x))).ToArray()));
        var formX = PeticionCrearAdmin.DesdeFormulario(F("tipo", "XYZ", "tipo_iniciativa", "Problem"), false);
        Check("CT4 prefijo sin regla (o sin Tipo): ambos null, nunca lo del formulario", "True|True|True",
              (formX.TipoIniciativa == null && formX.TipoAgrupado == null) + "|" +
              (PeticionCrearAdmin.DesdeFormulario(F("tipo", ""), false).TipoIniciativa == null) + "|" +
              (TiposPorPrefijo.Clasificacion(" prb ") == "Problem"));
        // El plan: PO / SO recortados o null; textos solo-espacios = null.
        var pPlan = C("ADO", po: " PO 3 ", so: "", cat: "/A/Cat 1", pct: "10", tit: "  ", desc: " D ", obs: null);
        var plan = PlanificadorGestionAdmin.Crear(pPlan, Crear(pPlan), new DateTime(2026, 10, 15));
        Check("CD7 plan: PO recortado, SO vacio = null", "PO 3|True", plan.Po + "|" + (plan.So == null));
        Check("CD7 plan: titulo solo espacios = null; descripcion con texto tal cual", "True| D |True",
              (plan.Titulo == null) + "|" + plan.Descripcion + "|" + (plan.Observaciones == null));
        Check("CD7 plan JSON lleva po / so", "PO 3|", plan.ComoJson()["po"] + "|" + plan.ComoJson()["so"]);
        var pVacio = C("ADO");
        var planVacio = PlanificadorGestionAdmin.Crear(pVacio, Crear(pVacio), new DateTime(2026, 10, 15));
        Check("CD8 solo el Tipo: plan valido, PO/SO/textos null, sin categorias", "True|True|0",
              (planVacio.Po == null && planVacio.So == null) + "|" + (planVacio.Titulo == null) + "|" + planVacio.Categorias.Count);
        Check("CC5 Director derivado de la categoria", "Dir A", Crear(C("ADO", cat: "/A/Cat 2")).Director);
        Check("CC5 categoria con dos directores: no se adivina", null, Crear(C("ADO", cat: "/B/Cat 3")).Director);
        Check("CC5 el PO ya no elige el Director (sin cascada)", null, Crear(C("ADO", po: "PO 3", cat: "/B/Cat 3")).Director);
        Check("CC6 catalogo revisado", true, Crear(C("ADO")).CatalogoRevisado);

        // ---- CI ----
        Check("CI1 borrador minimo (solo tipo) valido", true, Crear(C("ADO")).Valida);
        var sinDecl = PeticionCrearAdmin.Una("ADO", "/A/Cat 1", "10");
        var rSin = Crear(sinDecl);
        Check("CI0 sin Clasificacion, Agrupacion ni Estado: valida e Incompleta con los tres", "True|tipo_iniciativa,tipo_agrupado,estado",
              rSin.Valida + "|" + string.Join(",", Faltan(rSin).Split(',').Where(k => k.StartsWith("tipo") || k == "estado").ToArray()));
        var plSin = PlanificadorGestionAdmin.Crear(sinDecl, rSin, new DateTime(2026, 10, 13));
        Check("CI0b el plan los deja null (no se derivan del prefijo)", "|||", plSin.TipoIniciativa + "|" + plSin.TipoAgrupado + "|" + plSin.Estado + "|" + plSin.Categorias[0].TipoAgrupado);
        Check("CI1 ... e incompleto en el orden de CAMPOS_INCOMPLETA (sin categorias, el % no se pide aparte)",
            "categoria,titulo,descripcion,observaciones", Faltan(Crear(C("ADO"))));
        Check("CI2 Problem sin RCA: falta rca", true, Faltan(Crear(C("PRB"))).EndsWith(",rca"));
        Check("CI2 Problem con RCA: no falta, pero avisa que no se sube", "categoria,titulo,descripcion,observaciones|True",
            Faltan(Crear(C("PRB", rca: true))) + "|" + Crear(C("PRB", rca: true)).Advertencias.Any(a => a.Contains("no se guarda")));
        // PO / SO no cuentan para Incompleta (hoy no se guardan).
        var completa = Crear(C("ADO", null, null, "/A/Cat 1", "20", "T", "D", "O"));
        Check("CI3 completa: valida y sin faltantes", "True|", completa.Valida + "|" + Faltan(completa));
        Check("CI4 espacios cuentan como vacio", "titulo", Faltan(Crear(C("ADO", null, null, "/A/Cat 1", "20", "  ", "D", "O"))));
        Check("CI5 categoria sin %: falta pct", "titulo,descripcion,observaciones,pct", Faltan(Crear(C("ADO", cat: "/A/Cat 1"))));

        // ---- CK ----
        var exc = Crear(C("ADO", cat: "/A/Cat 1", pct: "30"), K("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK1 tope excedido (80 + 30): ERROR en pct", "False|pct", exc.Valida + "|" + Campos(exc));
        var cabe = Crear(C("ADO", cat: "/A/Cat 1", pct: "20"), K("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK2 cabe justo (80 + 20 = 100)", "True|0", cabe.Valida + "|" + cabe.Advertencias.Count);
        var cent = Crear(C("ADO", cat: "/A/Cat 1", pct: "20.01"), K("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK2 20.01 ya no cabe", false, cent.Valida);
        var otra = Crear(C("ADO", cat: "/A/Cat 2", pct: "90"), K("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK3 otra categoria no resta", true, otra.Valida);
        var noCons = Crear(C("ADO", cat: "/A/Cat 1", pct: "50"), KN("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK4 la que no consume no cuenta", true, noCons.Valida);
        var lleno = Crear(C("ADO", cat: "/A/Cat 1", pct: "0"), K("PRB 2026-000009", "/A/Cat 1", 1.3m));
        Check("CK5 ruta ya excedida (130%): 0% si cabe, 1% no", "True|False", lleno.Valida + "|" +
            Crear(C("ADO", cat: "/A/Cat 1", pct: "1"), K("PRB 2026-000009", "/A/Cat 1", 1.3m)).Valida);

        // ---- CM ----
        var multi = Crear(CV("ADO", "/A/Cat 1", "10", "/A/Cat 2", "20"));
        Check("CM1 dos categorias validas, mismo Director", "True|Dir A|", multi.Valida + "|" + multi.Director + "|" + Campos(multi));
        var mezcla = Crear(CV("ADO", "/A/Cat 1", "10", "/B/Cat 3", "20"));
        Check("CM2 directores distintos: no se adivina", null, mezcla.Director);
        var mala = Crear(CV("ADO", "/A/Cat 1", "10", "/Z", "20"));
        Check("CM3 una fuera del catalogo: error solo de esa", "categoria|True", Campos(mala) + "|" +
            mala.Errores[0].Mensaje.StartsWith("/Z"));
        var una = Crear(CV("ADO", "/A/Cat 1", "70", "/A/Cat 2", "50"), K("X", "/A/Cat 1", 0.4m));
        Check("CM4 tope por ruta: solo /A/Cat 1 excede", "pct|True", Campos(una) + "|" + una.Errores[0].Mensaje.StartsWith("/A/Cat 1"));
        Check("CM5 una sin %: incompleta por pct", true, Faltan(Crear(CV("ADO", "/A/Cat 1", "10", "/A/Cat 2", ""))).Contains("pct"));

        // ---- MF ----
        Check("MF1 sin folio", "folio", Campos(v.FormatoModificar(M(F("titulo", "x")))));
        Check("MF2 pares desparejos", "pct", Campos(v.FormatoModificar(M(F("folio", "PRB 2026-000001", "pct_categoria", "/A/Cat 1")))));
        Check("MF3 % invalido", "pct", Campos(v.FormatoModificar(M(F("folio", "PRB 2026-000001", "pct_categoria", "/A/Cat 1", "pct_valor", "abc")))));
        Check("MF4 categoria repetida", "pct", Campos(v.FormatoModificar(M(F("folio", "F", "pct_categoria", "/A/Cat 1", "pct_valor", "1",
                                                                             "pct_categoria", "/a/cat 1", "pct_valor", "2")))));

        // ---- MM ----
        var noExiste = new ValidadorGestionAdmin().Modificar(M(F("folio", "PRB 2026-999999", "titulo", "x")), null, null);
        Check("MM1 folio inexistente", "folio", Campos(noExiste));
        Check("MM2 sin cambios = error", "-", Campos(Mod(F("folio", "PRB 2026-000001", "titulo", "Titulo problem"))));
        Check("MM3 CRLF no es cambio", "-", Campos(Mod(F("folio", "PRB 2026-000001", "descripcion", "Linea 1\r\nLinea 2"))));
        var tit = Mod(F("folio", "PRB 2026-000001", "titulo", "Nuevo"));
        Check("MM4 compara con el titulo del Problem", "True|Titulo problem|Nuevo",
            tit.Valida + "|" + tit.Cambios[0]["anterior"] + "|" + tit.Cambios[0]["nuevo"]);
        var obs = Mod(F("folio", "PRB 2026-000001", "observaciones", "Nueva obs"));
        Check("MM5 observaciones null -> texto es cambio", "observaciones|", obs.Cambios[0]["clave"] + "|" + obs.Cambios[0]["anterior"]);
        var vacio = Mod(F("folio", "PRB 2026-000001", "titulo", ""));
        Check("MM6 vaciar el titulo: valido con advertencia", "True|True", vacio.Valida + "|" + vacio.Advertencias.Any(a => a.Contains("sin T")));
        Check("MM7 % de categoria no ligada = error", "pct",
            Campos(Mod(F("folio", "PRB 2026-000001", "pct_categoria", "/B/Cat 3", "pct_valor", "10"))));
        var pct = Mod(F("folio", "PRB 2026-000001", "pct_categoria", "/A/Cat 2", "pct_valor", "25"));
        Check("MM8 completar el % que faltaba: valida y deja de estar incompleta", "True|1|", pct.Valida + "|" + pct.Cambios.Count + "|" + Faltan(pct));
        var sinPct = Mod(F("folio", "PRB 2026-000001", "titulo", "Otro"));
        Check("MM9 sin tocar el % que falta: sigue incompleta", "pct", Faltan(sinPct));
        var vaciaPct = Mod(F("folio", "PRB 2026-000001", "pct_categoria", "/A/Cat 1", "pct_valor", "", "pct_categoria", "/A/Cat 2", "pct_valor", "10"));
        Check("MM10 vaciar un % es cambio y deja incompleta", "True|pct", vaciaPct.Valida + "|" + Faltan(vaciaPct));
        var mismo = Mod(F("folio", "PRB 2026-000001", "pct_categoria", "/A/Cat 1", "pct_valor", "50.00"));
        Check("MM11 50.00 = 0.5: sin cambios", "-", Campos(mismo));
        var propia = Mod(F("folio", "PRB 2026-000001", "pct_categoria", "/A/Cat 1", "pct_valor", "60"),
                         K("PRB 2026-000001", "/A/Cat 1", 0.5m), K("PRB 2026-000002", "/A/Cat 1", 0.4m));
        Check("MM12 su propio % no cuenta contra ella (60 + 40 = 100)", 0, propia.Advertencias.Count);
        var excede = Mod(F("folio", "PRB 2026-000001", "pct_categoria", "/A/Cat 1", "pct_valor", "61"),
                         K("PRB 2026-000001", "/A/Cat 1", 0.5m), K("PRB 2026-000002", "/A/Cat 1", 0.4m));
        Check("MM12 61 excede: ERROR (tope)", "False|pct", excede.Valida + "|" + Campos(excede));
        var jm = tit.ComoJson();
        Check("MM13 JSON de modificar: folio y no guardada", "PRB 2026-000001|False|habilitada", jm["folio"] + "|" + jm["guardada"] + "|" + jm["persistencia"]);

        // ---- MR ----
        var act = Actual();
        Check("MR1 titulo = titulo_problem", "Titulo problem", act.Titulo);
        Check("MR2 null -> vacio", "", act.Observaciones);
        Check("MR3 categorias y %", "2|0.5|", act.Categorias.Count + "|" + act.Categorias[0].Pct + "|" + act.Categorias[1].Pct);
        var sin = IniciativaActual.DesdeRegistro(new Dictionary<string, object> { { "folio", "X" }, { "sin_categoria", true } });
        var rs = new ValidadorGestionAdmin().Modificar(M(F("folio", "X", "titulo", "t")), sin, null);
        Check("MR4 sin categoria: incompleta por Categoria", "categoria", Faltan(rs));
        Check("MR5 fechas, estado y subestado del registro", "2026-10-01||2026-12-15|En An\u00e1lisis",
            act.FAnalisis + "|" + act.FSolucion + "|" + act.FCierre + "|" + act.Subestado);

        // ---- MA ----
        const string Fo = "PRB 2026-000001";
        var ag = ModC(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "15", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"));
        Check("MA1 agregar una del catalogo: valida, un cambio (/A/Cat 2 sigue sin %)", "True|agregar_categoria|pct", ag.Valida + "|" + ag.Cambios[0]["clave"] + "|" + Faltan(ag));
        Check("MA2 agregar sin catalogo (sobrecarga vieja) = error", "categorias",
            Campos(Mod(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "15", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"))));
        Check("MA3 agregar una fuera del catalogo", "categorias", Campos(ModC(F("folio", Fo, "agregar_categoria", "/Z", "agregar_pct", "1", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"))));
        Check("MA4 agregar una ya ligada = error (duplicado)", "categorias",
            Campos(ModC(F("folio", Fo, "agregar_categoria", "/a/cat 1", "agregar_pct", "1", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"))));
        Check("MA5 agregar dos veces la misma", "categorias", Campos(ModC(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "1", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem",
                                                                           "agregar_categoria", "/B/Cat 3", "agregar_pct", "2", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"))));
        var agExc = ModC(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "30", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"), K("PRB 2026-000002", "/B/Cat 3", 0.8m));
        Check("MA6 agregar excediendo el tope = error", "categorias", Campos(agExc));
        var agSin = ModC(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"));
        Check("MA7 agregar sin %: valida e incompleta por pct", "True|pct", agSin.Valida + "|" + Faltan(agSin));
        var qt = ModC(F("folio", Fo, "quitar_categoria", "/A/Cat 2"));
        Check("MA8 quitar la que no tenia %: deja de estar incompleta", "True|quitar_categoria|", qt.Valida + "|" + qt.Cambios[0]["clave"] + "|" + Faltan(qt));
        Check("MA9 quitar una no ligada = error", "categorias", Campos(ModC(F("folio", Fo, "quitar_categoria", "/B/Cat 3"))));
        Check("MA10 quitar y cambiar % de la misma = error", "categorias",
            Campos(v.FormatoModificar(M(F("folio", Fo, "quitar_categoria", "/A/Cat 1", "pct_categoria", "/A/Cat 1", "pct_valor", "3")))));
        var todas = ModC(F("folio", Fo, "quitar_categoria", "/A/Cat 1", "quitar_categoria", "/A/Cat 2"));
        Check("MA11 quitar todas: valida, incompleta por categoria y aviso", "True|categoria|True", todas.Valida + "|" + Faltan(todas) + "|" +
            todas.Advertencias.Any(a => a.Contains("sin categor")));
        var cambio = ModC(F("folio", Fo, "quitar_categoria", "/A/Cat 2", "agregar_categoria", "/B/Cat 3", "agregar_pct", "5", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"));
        Check("MA12 corregir categoria equivocada (quitar una, agregar otra)", "True|2", cambio.Valida + "|" + cambio.Cambios.Count);

        // ---- MD ----
        var fe = ModC(F("folio", Fo, "f_cierre", "2027-01-31"));
        Check("MD1 cambio de fecha de cierre", "True|f_cierre|2026-12-15|2027-01-31", fe.Valida + "|" + fe.Cambios[0]["clave"] + "|" +
            fe.Cambios[0]["anterior"] + "|" + fe.Cambios[0]["nuevo"]);
        Check("MD2 misma fecha = sin cambios", "-", Campos(ModC(F("folio", Fo, "f_analisis", "2026-10-01"))));
        Check("MD3 fecha invalida", "f_solucion", Campos(ModC(F("folio", Fo, "f_solucion", "2026-02-30"))));
        Check("MD3 formato dd/mm", "f_solucion", Campos(ModC(F("folio", Fo, "f_solucion", "01/02/2026"))));
        var fv = ModC(F("folio", Fo, "f_cierre", ""));
        Check("MD4 vaciar una fecha: valida con aviso", "True|True", fv.Valida + "|" + fv.Advertencias.Any(a => a.Contains("sin fecha")));
        var es = ModC(F("folio", Fo, "estado", "Cerrado", "subestado", "Solucionado"));
        Check("MD5 Estado/Subestado existentes: dos cambios y aviso de transiciones", "True|2|True", es.Valida + "|" + es.Cambios.Count + "|" +
            es.Advertencias.Any(a => a.Contains("transici")));
        Check("MD6 Estado inventado = error", "estado", Campos(ModC(F("folio", Fo, "estado", "Pausado"))));
        Check("MD6 Subestado inventado = error", "subestado", Campos(ModC(F("folio", Fo, "subestado", "Otro"))));
        Check("MD7 sin lista de estados (sobrecarga vieja) = error", "estado", Campos(Mod(F("folio", Fo, "estado", "Cerrado"))));
        Check("MD8 el folio solo identifica: nunca sale como cambio", false,
            es.Cambios.Any(c => (string)c["clave"] == "folio" || (string)c["clave"] == "codigo"));

        // ---- MK ----
        var baja = ModC(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "40"),
                        K(Fo, "/A/Cat 1", 0.5m), K("PRB 2026-000002", "/A/Cat 1", 0.9m));
        Check("MK1 ruta ya excedida (50 + 90): bajar 50 -> 40 se permite", true, baja.Valida);
        var sube = ModC(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "51"),
                        K(Fo, "/A/Cat 1", 0.5m), K("PRB 2026-000002", "/A/Cat 1", 0.9m));
        Check("MK2 ... subir 50 -> 51 no", "pct", Campos(sube));
        var cerrada = new ValidadorGestionAdmin().Modificar(M(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "90")),
                           Actual("Cerrado", "Problem"), new[] { KN(Fo, "/A/Cat 1", 0.5m), K("PRB 2026-000002", "/A/Cat 1", 0.9m) }, Catalogo, Estados);
        Check("MK3 iniciativa que no consume (cerrada): sin tope", true, cerrada.Valida);
        var reactiva = new ValidadorGestionAdmin().Modificar(M(F("folio", Fo, "estado", "En An\u00e1lisis")),
                           Actual("Cerrado", "Problem"), new[] { KN(Fo, "/A/Cat 1", 0.5m), K("PRB 2026-000002", "/A/Cat 1", 0.9m) }, Catalogo, Estados);
        Check("MK4 reactivar (Cerrado -> En Analisis) con 50% sobre una ruta con 90% de otra: tope", "categorias", Campos(reactiva));
        var nula = new ValidadorGestionAdmin().Modificar(M(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "40")),
                           Actual("En An\u00e1lisis", null), new[] { K(Fo, "/A/Cat 1", 0.5m) }, Catalogo, Estados);
        Check("MK5 viva con categorias sin Agrupacion: bajar un % pasa (la Agrupacion es opcional)", true, nula.Valida);
        var nulaSube = new ValidadorGestionAdmin().Modificar(M(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "60")),
                           Actual("En An\u00e1lisis", null), new[] { K(Fo, "/A/Cat 1", 0.5m), K("PRB 2026-000002", "/A/Cat 1", 0.5m) }, Catalogo, Estados);
        Check("MK5b sin Agrupacion, subir el % se revisa como si consumiera (no se salta el tope)", "pct", Campos(nulaSube));
        var fNula = F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "40",
                      "pct_categoria", "/A/Cat 2", "pct_valor", "", "pct_tipo_agrupado", "Problem", "pct_tipo_agrupado", "Adopcion");
        var nulaOk = new ValidadorGestionAdmin().Modificar(M(fNula), Actual("En An\u00e1lisis", null), new[] { K(Fo, "/A/Cat 1", 0.5m) }, Catalogo, Estados);
        Check("MK6 declarando la Agrupacion de cada una (paralela a pct_*), pasa", true, nulaOk.Valida);
        var plNula = PlanificadorGestionAdmin.Modificar(M(fNula), Actual("En An\u00e1lisis", null), nulaOk, new DateTime(2026, 10, 13));
        Check("MK7 el plan lleva la Agrupacion declarada de cada ligada", "/A/Cat 1=Problem|/A/Cat 2=Adopcion",
              string.Join("|", plNula.Pcts.Select(c => c.Ruta + "=" + c.TipoAgrupado).ToArray()));

        // ---- V ----
        var slot0 = new Dictionary<string, int>(StringComparer.Ordinal) { { "/A/Cat 1", 418 }, { "/A/Cat 0", 0 } };
        var vr = VolumetriaCategoria.Resolver(new[] { "/A/Cat 1", " /A/Cat 1 ", "/A/Otra", "", "/A/Cat 0" }, slot0)
            .Cast<Dictionary<string, object>>().ToList();
        Check("V1 ok con su total", "ok|418", vr[0]["estado"] + "|" + vr[0]["volumetria"]);
        Check("V2 llave normalizada (espacios) como Experiencia", "ok|418", vr[1]["estado"] + "|" + vr[1]["volumetria"]);
        Check("V3 sin filas pero hay datos: 0 real", "cero|0", vr[2]["estado"] + "|" + vr[2]["volumetria"]);
        Check("V4 ruta vacia", "ruta_invalida|", vr[3]["estado"] + "|" + vr[3]["volumetria"]);
        Check("V5 total 0 en la vista: cero", "cero|0", vr[4]["estado"] + "|" + vr[4]["volumetria"]);
        var vacia = VolumetriaCategoria.Resolver(new[] { "/A/Cat 1" }, new Dictionary<string, int>())
            .Cast<Dictionary<string, object>>().ToList();
        Check("V6 SLOT 0 vacio: sin_datos, nunca 0", "sin_datos|", vacia[0]["estado"] + "|" + vacia[0]["volumetria"]);
        Check("V7 Volumetria separada de TicketsReduce: la respuesta no lo trae", false,
              vr.Any(f => f.Keys.Any(k => k.IndexOf("reduce", StringComparison.OrdinalIgnoreCase) >= 0)));
        var sinSlot = "";
        try { VolumetriaCategoria.Resolver(new[] { "/A/Cat 1" }, null); } catch (ArgumentNullException) { sinSlot = "lanza"; }
        Check("V8 sin lectura del SLOT 0 (null): lanza, nunca inventa 0", "lanza", sinSlot);
        var falla = "";
        try { ExperienciaQueries.VolumenSlot0PorCategoria(new System.Data.SqlClient.SqlConnection()); }
        catch (Exception) { falla = "lanza"; }
        Check("V9 lectura que falla (conexion sin abrir): lanza (el handler responde 503), no devuelve vacio", "lanza", falla);

        // ---- PL: plan de escritura (PlanGestionAdmin.cs) ----
        var hoy = new DateTime(2026, 10, 13);
        var pc = CV("PRB", "/A/Cat 1", "30", "/A/Cat 2", "20");
        var pcr = Crear(pc);
        var plc = PlanificadorGestionAdmin.Crear(pc, pcr, hoy);
        Check("PL1 alta: FechaCreacion = hoy, FechaAnalisis = hoy + 15", "2026-10-13|2026-10-28",
              FechasGestionAdmin.Iso(plc.FechaCreacion) + "|" + FechasGestionAdmin.Iso(plc.FechaAnalisis));
        Check("PL2 alta multi-categoria: todas sin fechas propias (comparten las del problema)", "2|0",
              plc.Categorias.Count + "|" + plc.Categorias.Count(c => c.FechaCreacion != null || c.FechaAnalisis != null));
        Check("PL3 alta: % de cada categoria como fraccion", "0.3|0.2",
              string.Join("|", plc.Categorias.Select(c => c.Pct.Value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)).ToArray()));
        Check("PL4 alta: sin codigo en el plan (lo emite la base) y sin pendientes (tipos y estado declarados)", "|0",
              plc.ComoJson()["codigo"] + "|" + plc.Pendientes.Count);
        Check("PL4b alta: tipos y estado declarados en el plan y en cada categoria; entrega = hoy", "Problem|Problem|En An\u00e1lisis|2026-10-13|Problem",
              plc.TipoIniciativa + "|" + plc.TipoAgrupado + "|" + plc.Estado + "|" + FechasGestionAdmin.Iso(plc.FechaEntregaAnalisis) + "|" + plc.Categorias[0].TipoAgrupado);
        var plInv = "";
        try { PlanificadorGestionAdmin.Crear(C(null), Crear(C(null)), hoy); } catch (InvalidOperationException) { plInv = "rechaza"; }
        Check("PL5 no se planea un alta invalida", "rechaza", plInv);
        Check("PL6 31-dic + 15 cruza de anio", "2027-01-15", FechasGestionAdmin.Iso(FechasGestionAdmin.Analisis(new DateTime(2026, 12, 31))));

        var fLiga = F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "10");
        var rLiga = ModC(fLiga);
        var plLiga = PlanificadorGestionAdmin.Modificar(M(fLiga), Actual(), rLiga, hoy);
        Check("PL7 ligar despues sin tipos: valida (son opcionales) y no se copian de las hermanas", "True||", rLiga.Valida + "|" +
              PlanificadorGestionAdmin.Modificar(M(fLiga), Actual(), rLiga, hoy).Agregar[0].TipoIniciativa + "|" +
              PlanificadorGestionAdmin.Modificar(M(fLiga), Actual(), rLiga, hoy).Agregar[0].TipoAgrupado);
        Check("PL8 ligar despues: fechas PROPIAS hoy / hoy + 15", "2026-10-13|2026-10-28",
              FechasGestionAdmin.Iso(plLiga.Agregar[0].FechaCreacion) + "|" + FechasGestionAdmin.Iso(plLiga.Agregar[0].FechaAnalisis));
        Check("PL9 ligar despues: no toca fechas del problema ni las ligadas", "0|0",
              plLiga.Problem.Count + "|" + plLiga.Pcts.Count);
        Check("PL10 el codigo del plan es el de la iniciativa leida", Fo, plLiga.Codigo);

        var fFechas = F("folio", Fo, "f_solucion", "2026-11-30", "f_cierre", "2027-01-15");
        var rFechas = ModC(fFechas);
        var plFechas = PlanificadorGestionAdmin.Modificar(M(fFechas), Actual(), rFechas, hoy);
        Check("PL11 editar Solucion y Cierre: solo esos dos campos", "f_cierre=2027-01-15|f_solucion=2026-11-30",
              string.Join("|", plFechas.Problem.OrderBy(kv => kv.Key).Select(kv => kv.Key + "=" + kv.Value).ToArray()));
        var fIgual = F("folio", Fo, "f_cierre", "2026-12-15", "titulo", "Titulo problem");
        Check("PL12 sin cambio real: no hay nada que guardar", "-", Campos(ModC(fIgual)));

        Check("PL13 Codigo inmutable: si llega 'codigo' se rechaza", "codigo",
              Campos(ModC(F("folio", Fo, "codigo", "PRB 2026-999999", "titulo", "x"))));
        Check("PL14 FechaCreacion inmutable: si llega 'f_creacion' se rechaza", "f_creacion",
              Campos(ModC(F("folio", Fo, "f_creacion", "2026-01-01", "titulo", "x"))));
        Check("PL15 campos del plan: nunca Codigo ni FechaCreacion", false,
              PlanificadorGestionAdmin.CamposProblem.Contains("codigo") || PlanificadorGestionAdmin.CamposProblem.Contains("f_creacion"));

        Check("PL16 ligar una ya ligada: se rechaza (sin duplicar)", "categorias",
              Campos(ModC(F("folio", Fo, "agregar_categoria", "/A/Cat 1", "agregar_pct", "10", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"))));
        Check("PL17 ligar dos veces la misma en un guardado: se rechaza", "categorias,categorias",
              Campos(ModC(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "1", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem",
                                     "agregar_categoria", " /b/cat 3 ", "agregar_pct", "1", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"))));

        Check("PL18 tope exacto: 60 de otros + 40 = 100% se permite", true,
              Crear(CV("PRB", "/A/Cat 1", "40"), K("ADO 2026-000009", "/A/Cat 1", 0.6m)).Valida);
        Check("PL19 tope: 60 + 40.01 se rechaza", "pct",
              Campos(Crear(CV("PRB", "/A/Cat 1", "40.01"), K("ADO 2026-000009", "/A/Cat 1", 0.6m))));
        Check("PL20 ligar despues con tope exacto 100% se permite", true,
              ModC(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "25", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"), K("ADO 2026-000009", "/B/Cat 3", 0.75m)).Valida);
        Check("PL21 ligar despues por encima del tope se rechaza", "categorias",
              Campos(ModC(F("folio", Fo, "agregar_categoria", "/B/Cat 3", "agregar_pct", "25.01", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"), K("ADO 2026-000009", "/B/Cat 3", 0.75m))));

        var fQuita = F("folio", Fo, "quitar_categoria", "/A/Cat 2");
        var plQuita = PlanificadorGestionAdmin.Modificar(M(fQuita), Actual(), ModC(fQuita), hoy);
        Check("PL22 quitar categoria: queda como pendiente (sin regla de borrado)", "1|1", plQuita.Quitar.Count + "|" + plQuita.Pendientes.Count);
        var escrQuita = "";
        try { new EscritorGestionAdminSql().Modificar(new System.Data.SqlClient.SqlConnection(), null, plQuita, "u"); }
        catch (InvalidOperationException) { escrQuita = "rechaza"; }
        Check("PL23 el escritor no ejecuta un plan con categorias a quitar", "rechaza", escrQuita);

        // Fecha al entrar a Cerrado (FechaAlEntrar): hoy en Mexico solo si
        // queda vacia; nunca pisa una que ya existe. En Solucion NO llena
        // FechaSolucion (fecha compromiso del semaforo): solo lo que pida el
        // formulario.
        Check("PL24 entrar a En Solucion con FechaSolucion vacia: NO se llena", "estado=En Soluci\u00f3n",
              PlanFechas(ActualFechas("En An\u00e1lisis", null, null), hoy, "estado", "En Soluci\u00f3n"));
        Check("PL25 entrar a En Solucion con FechaSolucion ya puesta: se conserva", "estado=En Soluci\u00f3n",
              PlanFechas(ActualFechas("En An\u00e1lisis", "2026-09-30", null), hoy, "estado", "En Soluci\u00f3n"));
        Check("PL26 entrar a Cerrado con FechaCierre vacia: hoy", "estado=Cerrado|f_cierre=2026-10-13",
              PlanFechas(ActualFechas("En Soluci\u00f3n", "2026-10-01", null), hoy, "estado", "Cerrado"));
        Check("PL27 entrar a Cerrado con FechaCierre ya puesta: se conserva", "estado=Cerrado",
              PlanFechas(ActualFechas("En Soluci\u00f3n", "2026-10-01", "2026-12-15"), hoy, "estado", "Cerrado"));
        Check("PL28 ya En Solucion (sin fecha), guardar otra cosa: no la llena", "titulo=Otro",
              PlanFechas(ActualFechas("En Soluci\u00f3n", null, null), hoy, "titulo", "Otro"));
        Check("PL29 ya Cerrado (sin fecha), guardar otra cosa: no la llena", "titulo=Otro",
              PlanFechas(ActualFechas("Cerrado", null, null), hoy, "titulo", "Otro"));
        Check("PL30 entrar a En Solucion con FechaSolucion en el mismo guardado: se guarda la del formulario", "estado=En Soluci\u00f3n|f_solucion=2026-11-30",
              PlanFechas(ActualFechas("En An\u00e1lisis", null, null), hoy, "estado", "En Soluci\u00f3n", "f_solucion", "2026-11-30"));
        Check("PL31 reglas independientes: entrar a Cerrado no toca FechaSolucion vacia", "estado=Cerrado|f_cierre=2026-10-13",
              PlanFechas(ActualFechas("En An\u00e1lisis", null, null), hoy, "estado", "Cerrado"));
        Check("PL32 entrar a En Solucion (desde Cerrado): ninguna fecha automatica", "estado=En Soluci\u00f3n",
              PlanFechas(ActualFechas("Cerrado", null, null), hoy, "estado", "En Soluci\u00f3n"));
        Check("PL33 editar FechaSolucion sin cambiar Estado: se guarda tal cual", "f_solucion=2026-12-20",
              PlanFechas(ActualFechas("En Soluci\u00f3n", "2026-11-30", null), hoy, "f_solucion", "2026-12-20"));
        Check("PL34 vaciar FechaSolucion al entrar a En Solucion: se vacia (no se rellena con hoy)", "estado=En Soluci\u00f3n|f_solucion=",
              PlanFechas(ActualFechas("En An\u00e1lisis", "2026-09-30", null), hoy, "estado", "En Soluci\u00f3n", "f_solucion", ""));

        // Compromiso a 15 dias (2026-10-26): la MISMA regla de Cerrado
        // (FechaAlEntrar), con el dia de la aprobacion (hoy) + 15. Entrar a
        // En Analisis llena FechaSolucion; entrar a En Monitoreo, FechaCierre.
        Check("PL35 entrar a En Analisis con FechaSolucion vacia: hoy + 15", "estado=En An\u00e1lisis|f_solucion=2026-10-28",
              PlanFechas(ActualFechas("Cerrado", null, null), hoy, "estado", "En An\u00e1lisis"));
        Check("PL36 entrar a En Analisis con FechaSolucion ya puesta: se conserva", "estado=En An\u00e1lisis",
              PlanFechas(ActualFechas("Cerrado", "2026-12-01", null), hoy, "estado", "En An\u00e1lisis"));
        Check("PL37 entrar a En Analisis con FechaSolucion en el mismo guardado: la del formulario", "estado=En An\u00e1lisis|f_solucion=2026-11-30",
              PlanFechas(ActualFechas("Cerrado", null, null), hoy, "estado", "En An\u00e1lisis", "f_solucion", "2026-11-30"));
        Check("PL38 ya En Analisis (sin FechaSolucion), guardar otra cosa: no la llena", "titulo=Otro",
              PlanFechas(ActualFechas("En An\u00e1lisis", null, null), hoy, "titulo", "Otro"));
        Check("PL39 entrar a En Monitoreo con FechaCierre vacia: hoy + 15", "estado=En Monitoreo|f_cierre=2026-10-28",
              PlanFechas(ActualFechas("En Soluci\u00f3n", "2026-10-01", null), hoy, "estado", "En Monitoreo"));
        Check("PL40 entrar a En Monitoreo con FechaCierre ya puesta: se conserva", "estado=En Monitoreo",
              PlanFechas(ActualFechas("En Soluci\u00f3n", "2026-10-01", "2026-12-15"), hoy, "estado", "En Monitoreo"));
        Check("PL41 ya En Monitoreo (sin FechaCierre), guardar otra cosa: no la llena", "titulo=Otro",
              PlanFechas(ActualFechas("En Monitoreo", null, null), hoy, "titulo", "Otro"));
        Check("PL42 entrar a En Monitoreo no toca FechaSolucion vacia", "estado=En Monitoreo|f_cierre=2026-10-28",
              PlanFechas(ActualFechas("En Soluci\u00f3n", null, null), hoy, "estado", "En Monitoreo"));
        Check("PL43 vaciar FechaCierre al entrar a En Monitoreo: hoy + 15 (como Cerrado con hoy)", "estado=En Monitoreo|f_cierre=2026-10-28",
              PlanFechas(ActualFechas("En Soluci\u00f3n", "2026-10-01", "2026-12-15"), hoy, "estado", "En Monitoreo", "f_cierre", ""));
        Check("PL44 de En Monitoreo a Cerrado sigue con hoy (sin los 15 dias)", "estado=Cerrado|f_cierre=2026-10-13",
              PlanFechas(ActualFechas("En Monitoreo", "2026-10-01", null), hoy, "estado", "Cerrado"));
        Check("PL45 limite de mes/anio: 2026-12-20 + 15 = 2027-01-04", "estado=En Monitoreo|f_cierre=2027-01-04",
              PlanFechas(ActualFechas("En Soluci\u00f3n", "2026-10-01", null), new DateTime(2026, 12, 20), "estado", "En Monitoreo"));
        Check("PL46 'EN ANALISIS' -> 'En Analisis' (solo cambia la escritura): no es transicion, sin fecha", "estado=En An\u00e1lisis",
              PlanFechas(ActualFechas("EN ANALISIS", null, null), hoy, "estado", "En An\u00e1lisis"));

        // ---- DQ: PO / SO capturados y quitar (sql/24) ----
        // Constante encendida; surte efecto solo cuando DeteccionSql24 vio
        // sql/24 en la base (aqui se anota a mano, sin base).
        PersistenciaGestionAdmin.OlvidarSql24ParaPruebas();
        Check("DQ1 constante encendida, pero sin revisar la base: apagada (nunca se asume sql/24)", "True|False",
              PersistenciaGestionAdmin.ModificaDuenosYQuita + "|" + PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva());
        var ahoraSql24 = new DateTime(2026, 10, 20, 18, 0, 0, DateTimeKind.Utc);
        PersistenciaGestionAdmin.AnotarSql24(false, ahoraSql24);
        Check("DQ1b la base NO tiene sql/24: apagada; la revision sigue vigente (no se repite en cada peticion)", "False|True",
              PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva() + "|" + PersistenciaGestionAdmin.Sql24Vigente(ahoraSql24.AddSeconds(30)));
        Check("DQ1c pasada la vigencia se vuelve a revisar (aplicar sql/24 la enciende sin reciclar)", false,
              PersistenciaGestionAdmin.Sql24Vigente(ahoraSql24 + PersistenciaGestionAdmin.VigenciaRevisionSql24));
        PersistenciaGestionAdmin.AnotarSql24(true, ahoraSql24);
        Check("DQ1d la base tiene sql/24: encendida; bloqueos de Modificar fuera", "True|1",
              PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva() + "|" + PersistenciaGestionAdmin.BloqueosVigentes().Count);
        PersistenciaGestionAdmin.AnotarSql24(false, ahoraSql24);
        Check("DQ1e rollback de sql/24 visto en la base: se apaga otra vez (bloqueos de quitar y PO / SO)", "False|3",
              PersistenciaGestionAdmin.ModificaDuenosYQuitaActiva() + "|" + PersistenciaGestionAdmin.BloqueosVigentes().Count);
        Check("DQ1f la prueba puede forzarla sin tocar lo revisado", "True|False",
              Forzada(true) + "|" + Forzada(null));
        PersistenciaGestionAdmin.OlvidarSql24ParaPruebas();
        var dqOff = ModD(F("folio", Fo, "po", "PO 2"));
        Check("DQ2 apagado: cambiar el PO se rechaza (422, campo po) y dice por que", "po|True",
              Campos(dqOff) + "|" + dqOff.Errores[0].Mensaje.Contains("sql/24"));
        Check("DQ3 apagado: mandar el MISMO PO no es error (no cambia nada)", "-", Campos(ModD(F("folio", Fo, "po", " PO 1 "))));
        Check("DQ4 apagado: cambiar el SO se rechaza", "so", Campos(ModD(F("folio", Fo, "so", "SO x"))));
        var escrPo = "";
        var plPoOff = new PlanModificarAdmin { Codigo = Fo, Hoy = hoy };
        plPoOff.Problem[SolicitudIniciativa.CPo] = "PO 2";
        try { new EscritorGestionAdminSql().Modificar(new System.Data.SqlClient.SqlConnection(), null, plPoOff, "u"); }
        catch (InvalidOperationException) { escrPo = "rechaza"; }
        Check("DQ5 apagado: el escritor no descarta en silencio un PO del plan", "rechaza", escrPo);

        PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = true;
        try
        {
            var fPo = F("folio", Fo, "po", "PO 2");
            var rPo = ModD(fPo);
            var plPo = PlanificadorGestionAdmin.Modificar(M(fPo), ActualDuenos(), rPo, hoy);
            Check("DQ6 PO del catalogo: valido; cambio 'Product Owner capturado' PO 1 -> PO 2; plan po=PO 2", "True|Product Owner capturado|PO 1|PO 2|po=PO 2",
                  rPo.Valida + "|" + rPo.Cambios[0]["rotulo"] + "|" + rPo.Cambios[0]["anterior"] + "|" + rPo.Cambios[0]["nuevo"] + "|" + PlanProblem(plPo));
            var fSo = F("folio", Fo, "so", "SO z");
            var plSo = PlanificadorGestionAdmin.Modificar(M(fSo), ActualDuenos(), ModD(fSo), hoy);
            Check("DQ7 SO del catalogo: plan so=SO z (el PO no se toca)", "so=SO z", PlanProblem(plSo));
            Check("DQ8 PO fuera del catalogo: error po, nada al plan", "po", Campos(ModD(F("folio", Fo, "po", "Alguien Inventado"))));
            Check("DQ9 SO fuera del catalogo: error so", "so", Campos(ModD(F("folio", Fo, "so", "SO inexistente"))));
            var fVacio = F("folio", Fo, "po", "");
            var rVacio = ModD(fVacio);
            Check("DQ10 vaciar el PO: valido con advertencia; plan po= (vacio)", "True|True|po=",
                  rVacio.Valida + "|" + rVacio.Advertencias.Any(a => a.Contains("Product Owner capturado")) + "|" +
                  PlanProblem(PlanificadorGestionAdmin.Modificar(M(fVacio), ActualDuenos(), rVacio, hoy)));
            Check("DQ11 mismo PO con espacios: sin cambio real (no hay nada que guardar)", "-", Campos(ModD(F("folio", Fo, "po", "  PO 1"))));
            Check("DQ12 sin catalogo (firma de compatibilidad): cambiar el PO se rechaza", "po",
                  Campos(new ValidadorGestionAdmin().Modificar(M(F("folio", Fo, "po", "PO 2")), ActualDuenos(), new CapacidadCategoria.Compromiso[0])));
            Check("DQ13 titulo + PO + SO en un guardado: los tres al plan", "po=PO 3|so=SO y|titulo=Otro titulo",
                  PlanProblem(PlanificadorGestionAdmin.Modificar(M(F("folio", Fo, "titulo", "Otro titulo", "po", "PO 3", "so", "SO y")), ActualDuenos(),
                      ModD(F("folio", Fo, "titulo", "Otro titulo", "po", "PO 3", "so", "SO y")), hoy)));
            Check("DQ14 Codigo sigue inmutable con PO: si llega 'codigo' se rechaza", "codigo",
                  Campos(ModD(F("folio", Fo, "codigo", "PRB 2026-999999", "po", "PO 2"))));
            Check("DQ15 el plan con PO lleva el codigo LEIDO (no uno del cliente) y nunca codigo en Problem", Fo + "|False",
                  plPo.Codigo + "|" + plPo.Problem.ContainsKey("codigo"));
            Check("DQ16 campos del plan: po y so si, Codigo / FechaCreacion no", "True|True|False",
                  PlanificadorGestionAdmin.CamposProblem.Contains("po") + "|" + PlanificadorGestionAdmin.CamposProblem.Contains("so") + "|" +
                  (PlanificadorGestionAdmin.CamposProblem.Contains("codigo") || PlanificadorGestionAdmin.CamposProblem.Contains("f_creacion")));

            var plQ = PlanificadorGestionAdmin.Modificar(M(fQuita), Actual(), ModC(fQuita), hoy);
            Check("DQ17 quitar con sql/24: al plan, SIN pendiente (el handler ya no responde 409)", "1|0|/A/Cat 2",
                  plQ.Quitar.Count + "|" + plQ.Pendientes.Count + "|" + plQ.Quitar[0]);
            var fRemp = F("folio", Fo, "quitar_categoria", "/A/Cat 2", "agregar_categoria", "/B/Cat 3", "agregar_pct", "5",
                          "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem");
            var rRemp = ModC(fRemp);
            var plRemp = PlanificadorGestionAdmin.Modificar(M(fRemp), Actual(), rRemp, hoy);
            Check("DQ18 reemplazar (quitar /A/Cat 2 + agregar /B/Cat 3): valido; solo la asociacion; sin pendientes",
                  "True|/A/Cat 2|/B/Cat 3|0|0", rRemp.Valida + "|" + plRemp.Quitar[0] + "|" + plRemp.Agregar[0].Ruta + "|" +
                  plRemp.Pendientes.Count + "|" + plRemp.Problem.Count);
            Check("DQ19 reemplazar por encima del tope: error (quitar no libera la OTRA categoria)", "categorias",
                  Campos(ModC(F("folio", Fo, "quitar_categoria", "/A/Cat 2", "agregar_categoria", "/B/Cat 3", "agregar_pct", "30",
                                "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"), K("ADO 2026-000009", "/B/Cat 3", 0.75m))));
            Check("DQ20 quitar una ruta excedida por otros: se permite (quitar nunca consume)", true,
                  ModC(F("folio", Fo, "quitar_categoria", "/A/Cat 1"), K("ADO 2026-000009", "/A/Cat 1", 0.9m)).Valida);
            var jOn = Crear(C("ADO")).ComoJson();
            Check("DQ21 bloqueos con sql/24: solo RCA", "1|True",
                  ((List<string>)jOn["bloqueos"]).Count + "|" + ((List<string>)jOn["bloqueos"])[0].StartsWith("RCA"));
            var desdeReg = IniciativaActual.DesdeRegistro(new Dictionary<string, object>
            {
                { "folio", Fo }, { "po_capturado", "PO 9" }, { "so_capturado", null }, { "po", "PO de la categoria" },
            });
            Check("DQ22 IniciativaActual: PO / SO CAPTURADOS (no los de la categoria)", "PO 9|", desdeReg.PoCapturado + "|" + desdeReg.SoCapturado);

            // PO y SO independientes, sin la cascada categoria -> PO -> SO:
            // cambiar uno nunca toca (ni vacia) el otro.
            var fSoloPo = F("folio", Fo, "po", "PO 3");
            var rSoloPo = ModAmbos(fSoloPo);
            Check("DQ23 solo PO (con SO capturado): un cambio, el plan NO lleva so (el SO se conserva)", "True|1|po=PO 3",
                  rSoloPo.Valida + "|" + rSoloPo.Cambios.Count + "|" + PlanProblem(PlanificadorGestionAdmin.Modificar(M(fSoloPo), ActualAmbos(), rSoloPo, hoy)));
            var fSoloSo = F("folio", Fo, "so", "SO y");
            var rSoloSo = ModAmbos(fSoloSo);
            Check("DQ24 solo SO (con PO capturado): el plan NO lleva po (el PO se conserva)", "True|1|so=SO y",
                  rSoloSo.Valida + "|" + rSoloSo.Cambios.Count + "|" + PlanProblem(PlanificadorGestionAdmin.Modificar(M(fSoloSo), ActualAmbos(), rSoloSo, hoy)));
            var fMismoPo = F("folio", Fo, "po", "PO 1", "so", "SO z");
            var rMismoPo = ModAmbos(fMismoPo);
            Check("DQ25 llega el PO de siempre + SO nuevo: solo cambia el SO", "True|so|so=SO z",
                  rMismoPo.Valida + "|" + string.Join(",", rMismoPo.Cambios.Select(c => (string)c["clave"]).ToArray()) + "|" +
                  PlanProblem(PlanificadorGestionAdmin.Modificar(M(fMismoPo), ActualAmbos(), rMismoPo, hoy)));
            var fTitulo = F("folio", Fo, "titulo", "Solo el titulo");
            var rTitulo = ModAmbos(fTitulo);
            Check("DQ26 editar otro campo (titulo): PO y SO no viajan al plan ni cambian", "True|titulo=Solo el titulo",
                  rTitulo.Valida + "|" + PlanProblem(PlanificadorGestionAdmin.Modificar(M(fTitulo), ActualAmbos(), rTitulo, hoy)));
            Check("DQ27 PO de una ruta con otro SO (no salen de la misma fila del catalogo): se acepta igual", "True|po=PO 2|so=SO z",
                  ModAmbos(F("folio", Fo, "po", "PO 2", "so", "SO z")).Valida + "|" +
                  PlanProblem(PlanificadorGestionAdmin.Modificar(M(F("folio", Fo, "po", "PO 2", "so", "SO z")), ActualAmbos(),
                      ModAmbos(F("folio", Fo, "po", "PO 2", "so", "SO z")), hoy)));
            Check("DQ28 PO valido + SO fuera del catalogo: se rechaza todo (nada se guarda a medias)", "so",
                  Campos(ModAmbos(F("folio", Fo, "po", "PO 2", "so", "SO inventado"))));
            Check("DQ29 Codigo inmutable con SO: 'codigo' se rechaza aunque el SO sea valido", "codigo",
                  Campos(ModAmbos(F("folio", Fo, "codigo", Fo, "so", "SO y"))));
        }
        finally { PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = null; }

        // ---- VQ: Volumetria fijada por ADM en Crear (sql/26) ----
        try
        {
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = null;
            PersistenciaGestionAdmin.OlvidarSql26ParaPruebas();
            Check("VQ1 constante encendida, sin revisar la base: apagada (nunca se asume sql/26)", "True|False",
                  PersistenciaGestionAdmin.GuardaVolumetria + "|" + PersistenciaGestionAdmin.GuardaVolumetriaActiva());
            var ahoraSql26 = new DateTime(2026, 10, 21, 18, 0, 0, DateTimeKind.Utc);
            PersistenciaGestionAdmin.AnotarSql26(false, ahoraSql26);
            Check("VQ2 la base NO tiene sql/26: apagada, con su bloqueo; la revision sigue vigente", "False|True|True",
                  PersistenciaGestionAdmin.GuardaVolumetriaActiva() + "|" +
                  PersistenciaGestionAdmin.BloqueosVigentes().Contains(PersistenciaGestionAdmin.BloqueoVolumetria) + "|" +
                  PersistenciaGestionAdmin.Sql26Vigente(ahoraSql26.AddSeconds(30)));
            var sinSql26 = Crear(Declarar(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "volumetria", "1200"), false)));
            Check("VQ3 sin sql/26: una volumetria escrita se RECHAZA (nunca se tira ni se cambia por la calculada)", "volumetria|True",
                  Campos(sinSql26) + "|" + sinSql26.Errores[0].Mensaje.Contains("sql/26"));
            Check("VQ4 sin sql/26: vacia (o solo espacios) sigue valida, como hoy", "True|True",
                  Crear(Declarar(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "volumetria", ""), false))).Valida + "|" +
                  Crear(Declarar(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "volumetria", "  "), false))).Valida);
            PersistenciaGestionAdmin.AnotarSql26(true, ahoraSql26);
            Check("VQ5 la base tiene sql/26: encendida y sin su bloqueo; pasada la vigencia se revisa otra vez", "True|False|False",
                  PersistenciaGestionAdmin.GuardaVolumetriaActiva() + "|" +
                  PersistenciaGestionAdmin.BloqueosVigentes().Contains(PersistenciaGestionAdmin.BloqueoVolumetria) + "|" +
                  PersistenciaGestionAdmin.Sql26Vigente(ahoraSql26 + PersistenciaGestionAdmin.VigenciaRevisionSql24));
            var vVol = new ValidadorGestionAdmin();
            Func<string, string> formato = t =>
                Campos(vVol.FormatoCrear(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "volumetria", t), false)));
            Check("VQ6 formato: negativa, decimal, texto, signo, mas de int: error en volumetria", "volumetria|volumetria|volumetria|volumetria|volumetria",
                  formato("-5") + "|" + formato("1.5") + "|" + formato("mil") + "|" + formato("+3") + "|" + formato("2147483648"));
            Check("VQ7 formato: 0, con espacios y el maximo de int son validos", "||", formato("0") + "|" + formato(" 42 ") + "|" + formato("2147483647"));
            var hoyV = new DateTime(2026, 10, 21);
            var conVol = Declarar(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "volumetria", " 1200 ", "cat_ruta", "/A/Cat 1", "cat_pct", "12.5"), false));
            var rVol = Crear(conVol);
            var plVol = PlanificadorGestionAdmin.Crear(conVol, rVol, hoyV);
            Check("VQ8 con sql/26: valida, entra al plan y al JSON del plan", "True|1200|1200",
                  rVol.Valida + "|" + plVol.Volumetria + "|" + plVol.ComoJson()["volumetria"]);
            var sinVol = Declarar(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "cat_ruta", "/A/Cat 1", "cat_pct", "12.5"), false));
            var plSinVol = PlanificadorGestionAdmin.Crear(sinVol, Crear(sinVol), hoyV);
            Check("VQ9 el % y la categoria no cambian por la volumetria; sin ella, NULL (no 0)", "0.1250|0.1250|/A/Cat 1|True",
                  plVol.Categorias[0].Pct.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" +
                  plSinVol.Categorias[0].Pct.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" +
                  plVol.Categorias[0].Ruta + "|" + (plSinVol.Volumetria == null));
            var cero = Declarar(PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "volumetria", "0"), false));
            Check("VQ10 volumetria 0: es 0 (un dato), no NULL", "0", PlanificadorGestionAdmin.Crear(cero, Crear(cero), hoyV).Volumetria);
            var mod = ModC(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "40", "volumetria", "999"));
            Check("VQ11 Modificar no la lee: ni error ni cambio de volumetria", "False|False",
                  Campos(mod).Contains("volumetria") + "|" + mod.Cambios.Any(c => (string)c["clave"] == "volumetria"));
        }
        finally
        {
            PersistenciaGestionAdmin.OlvidarSql26ParaPruebas();
            PersistenciaGestionAdmin.GuardaVolumetriaForzadaParaPruebas = true;
        }

        // ---- SQ: Subestado inicial en Crear (sql/27) ----
        try
        {
            Func<NameValueCollection, PeticionCrearAdmin> pet = f => Declarar(PeticionCrearAdmin.DesdeFormulario(f, false));
            var hoyS = new DateTime(2026, 10, 21);
            PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = null;
            PersistenciaGestionAdmin.OlvidarSql27ParaPruebas();
            Check("SQ1 constante encendida, sin revisar la base: apagada (nunca se asume sql/27)", "True|False",
                  PersistenciaGestionAdmin.GuardaSubestado + "|" + PersistenciaGestionAdmin.GuardaSubestadoActiva());
            var ahoraSql27 = new DateTime(2026, 10, 21, 18, 0, 0, DateTimeKind.Utc);
            PersistenciaGestionAdmin.AnotarSql27(false, ahoraSql27);
            Check("SQ2 la base NO tiene sql/27: apagada, con su bloqueo; la revision sigue vigente", "False|True|True",
                  PersistenciaGestionAdmin.GuardaSubestadoActiva() + "|" +
                  PersistenciaGestionAdmin.BloqueosVigentes().Contains(PersistenciaGestionAdmin.BloqueoSubestado) + "|" +
                  PersistenciaGestionAdmin.Sql27Vigente(ahoraSql27.AddSeconds(30)));
            var sinSql27 = Crear(pet(F("tipo", "ADO", "subestado", "Solucionado")));
            Check("SQ3 sin sql/27: un Subestado valido se RECHAZA (nunca se tira)", "subestado|True",
                  Campos(sinSql27) + "|" + sinSql27.Errores[0].Mensaje.Contains("sql/27"));
            Check("SQ4 sin sql/27: omitido, vacio o solo espacios sigue valido, como hoy", "True|True|True",
                  Crear(pet(F("tipo", "ADO"))).Valida + "|" + Crear(pet(F("tipo", "ADO", "subestado", ""))).Valida + "|" +
                  Crear(pet(F("tipo", "ADO", "subestado", "  "))).Valida);
            PersistenciaGestionAdmin.AnotarSql27(true, ahoraSql27);
            Check("SQ5 la base tiene sql/27: encendida y sin su bloqueo; pasada la vigencia se revisa otra vez", "True|False|False",
                  PersistenciaGestionAdmin.GuardaSubestadoActiva() + "|" +
                  PersistenciaGestionAdmin.BloqueosVigentes().Contains(PersistenciaGestionAdmin.BloqueoSubestado) + "|" +
                  PersistenciaGestionAdmin.Sql27Vigente(ahoraSql27 + PersistenciaGestionAdmin.VigenciaRevisionSql24));
            Check("SQ6 formato no lo revisa (lo decide la lista de valores)", "",
                  Campos(new ValidadorGestionAdmin().FormatoCrear(pet(F("tipo", "ADO", "subestado", "Inventado")))));
            var inv = Crear(pet(F("tipo", "ADO", "subestado", "Inventado")));
            Check("SQ7 uno que no existe en los problemas: error en subestado, como Modificar", "subestado|El Subestado no es uno de los que ya existen en los problemas.",
                  Campos(inv) + "|" + inv.Errores[0].Mensaje);
            Check("SQ8 distingue mayusculas como Modificar (lista Ordinal)", "subestado",
                  Campos(Crear(pet(F("tipo", "ADO", "subestado", "solucionado")))));
            var sinLista = new ValidadorGestionAdmin().Crear(pet(F("tipo", "ADO", "subestado", "Solucionado")),
                                                           Catalogo, new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]), "PRB", null);
            Check("SQ9 sin la lista de valores: el Subestado se rechaza (no se acepta cualquier texto)", "True",
                  Campos(sinLista).Split(',').Contains("subestado"));
            var ok = pet(F("tipo", "ADO", "subestado", " Solucionado ", "cat_ruta", "/A/Cat 1", "cat_pct", "10"));
            var rOk = Crear(ok);
            var plOk = PlanificadorGestionAdmin.Crear(ok, rOk, hoyS);
            Check("SQ10 valido: entra al plan recortado y al JSON del plan", "True|Solucionado|Solucionado",
                  rOk.Valida + "|" + plOk.Subestado + "|" + plOk.ComoJson()["subestado"]);
            Check("SQ11 el Estado no cambia ni se cruza con el Subestado", "En An\u00e1lisis|En An\u00e1lisis",
                  plOk.Estado + "|" + plOk.ComoJson()["estado"]);
            var sinEstado = PeticionCrearAdmin.DesdeFormulario(F("tipo", "ADO", "subestado", "Cancelado"), false);
            var plSinEstado = PlanificadorGestionAdmin.Crear(sinEstado, Crear(sinEstado), hoyS);
            Check("SQ12 Subestado sin Estado: valido, Estado sigue vacio (no se deriva) e Incompleta pide el Estado", "True|True|Cancelado|True",
                  Crear(sinEstado).Valida + "|" + (plSinEstado.Estado == null) + "|" + plSinEstado.Subestado + "|" +
                  Faltan(Crear(sinEstado)).Split(',').Contains("estado"));
            var omit = pet(F("tipo", "ADO"));
            var vacioS = pet(F("tipo", "ADO", "subestado", "   "));
            Check("SQ13 omitido o vacio: null en el plan (NULL en la base), sin faltante nuevo", "True|True|False",
                  (PlanificadorGestionAdmin.Crear(omit, Crear(omit), hoyS).Subestado == null) + "|" +
                  (PlanificadorGestionAdmin.Crear(vacioS, Crear(vacioS), hoyS).Subestado == null) + "|" +
                  Faltan(Crear(omit)).Split(',').Contains("subestado"));
            Check("SQ14 Modificar sigue con su propia regla (Subestado valido = cambio)", "True",
                  ModC(F("folio", Fo, "subestado", "Cancelado")).Cambios.Any(c => (string)c["clave"] == "subestado"));
            var errSql = new ErrorEscrituraGestionAdmin(51029, "x", null);
            Check("SQ15 51029 del procedimiento = DatoInvalido", "True|DatoInvalido", errSql.EsDatoInvalido + "|" + errSql.Tipo);
        }
        finally
        {
            PersistenciaGestionAdmin.OlvidarSql27ParaPruebas();
            PersistenciaGestionAdmin.GuardaSubestadoForzadaParaPruebas = true;
        }

        // ---- EN: acentos en lo que responde el servidor ----
        // App_Code y los .ashx sin BOM: IIS los compila como Windows-1252 y
        // un literal UTF-8 crudo llega al navegador como "Descripci\u00c3\u00b3n".
        // Por eso este smoke se compila con /codepage:1252 (como el servidor).
        var enCrear = Crear(C("ADO"));
        Check("EN1 faltante de alta: Descripcion con su acento", "Descripci\u00f3n", Rotulo(enCrear.Faltantes, "descripcion"));
        Check("EN2 faltante de modificacion: % Disminucion con su acento", "% Disminuci\u00f3n", Rotulo(sinPct.Faltantes, "pct"));
        var enPct = ModC(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "40"));
        Check("EN3 cambio de %: rotulo con acento y punto medio", "% Disminuci\u00f3n \u00b7 /A/Cat 1", Rotulo(enPct.Cambios, "pct"));
        var enJson = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new object[] { enCrear.ComoJson(), enPct.ComoJson() });
        Check("EN4 JSON como lo escribe DashboardHandler.Responder: sin mojibake y con los acentos", "False|True|True",
            enJson.Contains("\u00c3") + "|" + enJson.Contains("Descripci\u00f3n") + "|" + enJson.Contains("Disminuci\u00f3n"));
        Check("EN5 persistencia encendida: Motivo es null (solo existe con la constante en false)", null, PersistenciaGestionAdmin.Motivo);
        Check("EN6 fuentes de la respuesta de Admin sin BOM: ningun caracter no ASCII fuera de comentarios", "",
            NoAsciiEnCodigo(@"App_Code\GestionIniciativaAdmin.cs", @"App_Code\PlanGestionAdmin.cs", @"App_Code\IniciativaService.cs",
                            @"App_Code\SolicitudIniciativa.cs", @"handlers\admin_iniciativas_gestion.ashx", @"handlers\admin_iniciativas_validar.ashx",
                            @"App_Code\CatalogoRutasIniciativa.cs", @"App_Code\GestionIniciativaAdminService.cs",
                            @"handlers\admin_iniciativas_catalogos.ashx"));

        // ---- CA: categorias de ADM aunque les falten duenos ----
        // CatalogoSolicitud.ParaAdm: la ruta sin duenos entra SOLO como
        // categoria; PO / SO siguen saliendo de las filas completas.
        var adm = CatalogoRutasIniciativa.ElegiblesAdm(new[] { "/A/Cat 1", "/Z/Sin duenos", " /z/sin duenos ", "/Z/Sin duenos" + ((char)0xA0), null, "  " },
            new DirectorioOrganizacional(new List<DirectorioOrganizacional.Dueno>
            {
                new DirectorioOrganizacional.Dueno { CategoriaN2 = "/A/Cat 1", C1 = "A", Po = "PO 1", So = "SO x", Director = "Dir A", Vigente = true },
                new DirectorioOrganizacional.Dueno { CategoriaN2 = "/Z/Sin duenos", C1 = "Z", Po = "PO Parcial", So = null, Director = null, Vigente = true },
            }, new Dictionary<string, string>()));
        var filasAdm = (List<object>)adm["rutas_adm"];
        Check("CA1 ElegiblesAdm: unicas por Normaliza y sin mayusculas; vacias fuera", "2|/A/Cat 1|/Z/Sin duenos|1",
            filasAdm.Count + "|" + ((Dictionary<string, object>)filasAdm[0])["categoria"] + "|" + ((Dictionary<string, object>)filasAdm[1])["categoria"] +
            "|" + adm["rutas_adm_sin_duenos"]);
        var fz = (Dictionary<string, object>)filasAdm[1];
        Check("CA2 duenos que faltan = null (no se inventan); el que hay, tal cual", "PO Parcial|null|null",
            fz["po"] + "|" + (fz["so"] ?? "null") + "|" + (fz["director"] ?? "null"));
        var catAdm = CatalogoSolicitud.ParaAdm(new object[] { "PRB" }, new List<object>
            {
                new Dictionary<string, object> { { "po", "PO 1" }, { "so", "SO x" }, { "categoria", "/A/Cat 1" }, { "director", "Dir A" } },
            }, filasAdm);
        Check("CA3 ParaAdm: la ruta sin duenos es categoria valida; la cascada no la conoce", "True|True|False",
            catAdm.TieneCategoria("/Z/Sin duenos") + "|" + catAdm.TieneCategoria("/A/Cat 1") + "|" + (catAdm.Filas(null, null, "/Z/Sin duenos").Count > 0));
        Check("CA4 ParaAdm: el PO de una fila incompleta NO entra a la lista de PO", "False|True",
            catAdm.TienePo("PO Parcial") + "|" + catAdm.TienePo("PO 1"));
        var sinCap = new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]);
        var rCa = new ValidadorGestionAdmin().Crear(Declarar(PeticionCrearAdmin.Una("PRB", "/Z/Sin duenos", "10")), catAdm, sinCap, "PRB", Estados);
        Check("CA5 Crear (ADM) con la ruta sin duenos: valida, sin Director, avisa Director y Service Owner", "True||True",
            rCa.Valida + "|" + rCa.Director + "|" +
            rCa.Advertencias.Any(a => a.Contains("/Z/Sin duenos") && a.Contains("Director") && a.Contains("Service Owner") && !a.Contains("Product Owner")));
        Check("CA6 la misma alta con el catalogo de la cascada se rechaza (Nueva solicitud / antes)", "False",
            new ValidadorGestionAdmin().Crear(Declarar(PeticionCrearAdmin.Una("PRB", "/Z/Sin duenos", "10")), Catalogo, sinCap, "PRB", Estados).Valida);
        var conPoParcial = Declarar(PeticionCrearAdmin.Una("PRB", "/Z/Sin duenos", "10"));
        conPoParcial.Po = "PO Parcial";
        Check("CA7 Crear (ADM) con el PO de una fila incompleta: se rechaza (lista de PO sin cambio)", "po",
            Campos(new ValidadorGestionAdmin().Crear(conPoParcial, catAdm, sinCap, "PRB", Estados)));
        Check("CA8 Codigo inmutable sin distinguir mayusculas: 'Codigo' tambien se rechaza", "codigo",
            Campos(ModC(F("folio", Fo, "Codigo", "PRB 2026-999999", "titulo", "x"))));

        // ---- HJ) solo hojas: una ruta con otra activa debajo es carpeta ----
        // CatalogoRutasIniciativa.Hojas (lo que publican Asignaciones y
        // ElegiblesAdm). Recibe las rutas ACTIVAS (LeerRutasActivas ya quita
        // inactivas y no vigentes: CategoriasAdmSqlLocalDbSmoke R1).
        var cg = "/S-Datos-Maestros/Centros/Catalogación";
        var hojas = CatalogoRutasIniciativa.Hojas(new[]
        {
            "/S-Datos-Maestros", "/S-Datos-Maestros/Centros", cg,
            cg + "/Agregar Centros en Surtidos", cg + "/Catalogación no reflejada", cg + "/Creación de Modulos",
            "/A/Uno", "/A/Uno/Hija",                 // una sola hija
            "/A/Cat", "/A/Catalogo/Otra",            // prefijo de texto, no de jerarquia
            "/X", "/XY/Z",                           // "/X" no es padre de "/XY/Z"
            "/M ", "/m /Memoria",                    // normalizada y sin mayusculas: misma identidad
            "/Sola",
        });
        Func<string, bool> hoja = r => hojas.Contains(r);
        Check("HJ1 carpeta con una sola hija: fuera; la hija queda", "False|True", hoja("/A/Uno") + "|" + hoja("/A/Uno/Hija"));
        Check("HJ2 carpetas con varias rutas debajo (cada nivel): fuera", "False|False|False",
            hoja("/S-Datos-Maestros") + "|" + hoja("/S-Datos-Maestros/Centros") + "|" + hoja(cg));
        Check("HJ3 hojas anidadas (4 niveles) y de un nivel: quedan", "True|True|True|True",
            hoja(cg + "/Agregar Centros en Surtidos") + "|" + hoja(cg + "/Catalogación no reflejada") + "|" +
            hoja(cg + "/Creación de Modulos") + "|" + hoja("/Sola"));
        Check("HJ4 nombre parecido no hace padre: /A/Cat por /A/Catalogo/Otra, /X por /XY/Z", "True|True|True|True",
            hoja("/A/Cat") + "|" + hoja("/A/Catalogo/Otra") + "|" + hoja("/X") + "|" + hoja("/XY/Z"));
        Check("HJ5 la carpeta se reconoce con la identidad del sitio (espacios a los lados, mayusculas)", "False|True",
            hoja("/M") + "|" + hoja("/m /Memoria"));
        Check("HJ6 sin la hija activa (inactiva no llega), el padre es hoja", "True",
            CatalogoRutasIniciativa.Hojas(new[] { "/A/Uno" }).Contains("/A/Uno").ToString());
        Check("HJ7 catalogo vacio o nulo: lista vacia, sin excepcion", "0|0|0",
            CatalogoRutasIniciativa.Hojas(null).Count + "|" + CatalogoRutasIniciativa.Hojas(new string[0]).Count + "|" +
            CatalogoRutasIniciativa.Hojas(new string[] { null, "  " }).Count);

        // El catalogo de ADM con carpetas: /A/Cat 1 (ligada en Actual()) y
        // /B son carpetas; el validador de ADM solo conoce las hojas.
        var sinDir = new DirectorioOrganizacional(new List<DirectorioOrganizacional.Dueno>(), new Dictionary<string, string>());
        var admHojas = CatalogoRutasIniciativa.ElegiblesAdm(new[] { "/A/Cat 1", "/A/Cat 1/Sub", "/A/Cat 2", "/B", "/B/Hoja" }, sinDir);
        Check("HJ8 ElegiblesAdm publica solo hojas (rutas_adm, en orden)", "/A/Cat 1/Sub|/A/Cat 2|/B/Hoja",
            string.Join("|", CatalogoRutasIniciativa.RutasAdm(admHojas).ToArray()));
        var cascadaHojas = CatalogoRutasIniciativa.Asignaciones(new[] { "/A/Cat 1", "/A/Cat 1/Sub" }, sinDir);
        Check("HJ9 Asignaciones (cascada de Nueva solicitud): la carpeta ni se publica ni se cuenta", "0|1",
            ((List<object>)cascadaHojas["rutas"]).Count + "|" + cascadaHojas["rutas_sin_duenos"]);
        var catHojas = CatalogoSolicitud.ParaAdm(new object[] { "PRB" }, new List<object>(), (System.Collections.IEnumerable)admHojas["rutas_adm"]);
        var capVacia = new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]);
        var crCarpeta = new ValidadorGestionAdmin().Crear(Declarar(PeticionCrearAdmin.Una("PRB", "/B", "10")), catHojas, capVacia, "PRB", Estados);
        Check("HJ10 Crear con una carpeta mandada a mano: rechazada en categoria", "False|categoria",
            crCarpeta.Valida + "|" + Campos(crCarpeta));
        Check("HJ11 Crear con una hoja (resto valido): pasa", "True",
            new ValidadorGestionAdmin().Crear(Declarar(PeticionCrearAdmin.Una("PRB", "/B/Hoja", "10")), catHojas, capVacia, "PRB", Estados).Valida.ToString());
        Check("HJ12 Crear con una ruta que no existe: sigue rechazada", "categoria",
            Campos(new ValidadorGestionAdmin().Crear(Declarar(PeticionCrearAdmin.Una("PRB", "/B/No existe", "10")), catHojas, capVacia, "PRB", Estados)));
        Func<NameValueCollection, ResultadoGestionAdmin> modHojas = f =>
            new ValidadorGestionAdmin().Modificar(M(f), Actual(), new CapacidadCategoria.Compromiso[0], catHojas, Estados);
        Check("HJ13 Modificar: agregar una carpeta a mano se rechaza; una hoja pasa", "categorias|True",
            Campos(modHojas(F("folio", Fo, "agregar_categoria", "/B", "agregar_pct", "5", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem"))) + "|" +
            modHojas(F("folio", Fo, "agregar_categoria", "/B/Hoja", "agregar_pct", "5", "agregar_tipo_iniciativa", "Problem", "agregar_tipo_agrupado", "Problem")).Valida);
        var soloTitulo = modHojas(F("folio", Fo, "titulo", "Titulo nuevo"));
        Check("HJ14 iniciativa con una carpeta YA ligada (/A/Cat 1): cambiar solo el Titulo pasa y no toca categorias", "True|titulo",
            soloTitulo.Valida + "|" + string.Join(",", soloTitulo.Cambios.Select(c => (string)c["clave"]).ToArray()));
        var pctCarpeta = modHojas(F("folio", Fo, "pct_categoria", "/A/Cat 1", "pct_valor", "40"));
        Check("HJ15 su % sigue editable (la ligada no se revisa contra el catalogo: no se reasigna)", "True|pct",
            pctCarpeta.Valida + "|" + string.Join(",", pctCarpeta.Cambios.Select(c => (string)c["clave"]).ToArray()));

        // ---- AG) Agrupacion: una sola grafia por Clave ----------------------
        var tilde = "Adopci" + (char)0xF3 + "n";
        Check("AG1 'Adopcion' y la de tilde: queda solo la de tilde (la de la regla)", tilde + "|Problem",
            string.Join("|", ExperienciaQueries.AgrupacionesUnicas(new[] { "Adopcion", tilde, "Problem" }).ToArray()));
        Check("AG2 orden indistinto y mayusculas: igual una sola", tilde,
            string.Join("|", ExperienciaQueries.AgrupacionesUnicas(new[] { tilde, "ADOPCION", "adopcion" }).ToArray()));
        Check("AG3 solo la sin tilde en la base: se conserva (no se ofrece una que la base no tiene)", "Adopcion",
            string.Join("|", ExperienciaQueries.AgrupacionesUnicas(new[] { "Adopcion" }).ToArray()));
        Check("AG4 variantes sin grafia de la regla: todas tal cual; las demas agrupaciones intactas", "Foo|FOO|Mejora|ReqOpr|SorIA",
            string.Join("|", ExperienciaQueries.AgrupacionesUnicas(new[] { "Foo", "FOO", "Mejora", "ReqOpr", "SorIA", "Mejora" }).ToArray()));
        var conTilde = new EstadosProblem(new[] { "En An" + (char)0xE1 + "lisis" }, new string[0], new[] { "Problem" },
            ExperienciaQueries.AgrupacionesUnicas(new[] { "Adopcion", tilde }));
        Check("AG5 el validador acepta declarar la de tilde y ya no la sin tilde", "True|False",
            conTilde.TiposAgrupado.Contains(tilde) + "|" + conTilde.TiposAgrupado.Contains("Adopcion"));

        // ---- VT) Volumetria total por categoria (sin base) -----------------
        Check("VT1 ruta como la guarda ProblemCategoria: NBSP -> espacio, sin espacios a los lados; vacia = null", "/A/B C|null",
            VolumetriaTotalCategoria.Ruta("  /A/B" + (char)0xA0 + "C ") + "|" + (VolumetriaTotalCategoria.Ruta("  ") ?? "null"));
        var sqlTotal = VolumetriaTotalCategoria.Consulta(2);
        Check("VT2 consulta: COUNT de dbo.Tickets por Categoria exacta (VolumenCategoria) + ultimos 30 dias Mexico (VolumenUltimos30), parametrizada",
            "True|True|True|True",
            sqlTotal.Contains("COUNT_BIG(t.Categoria)") + "|" + sqlTotal.Contains("DATEADD(DAY, -30, DATEADD(HOUR, -6, SYSUTCDATETIME()))") + "|" +
            sqlTotal.Contains("(0, @r0), (1, @r1)") + "|" + sqlTotal.Contains("LEFT JOIN dbo.Tickets AS t ON t.Categoria = LTRIM(RTRIM(REPLACE(r.Ruta, NCHAR(160), N' ')))"));
        var filasVt = VolumetriaTotalCategoria.Armar(new[] { "/A", "", "/B" }, new[] { 0, -1, 1 }, new long[] { 1234, 0 }, new long[] { 56, 0 });
        Func<int, string, string> vt = (i, k) => Convert.ToString(((Dictionary<string, object>)filasVt[i])[k] ?? "null");
        Check("VT3 estados: ok con total y ultimos30; ruta vacia invalida (null); 0 real = cero",
            "ok|1234|56|ruta_invalida|null|cero|0",
            vt(0, "estado") + "|" + vt(0, "volumetria") + "|" + vt(0, "ultimos30") + "|" + vt(1, "estado") + "|" + vt(1, "volumetria") + "|" +
            vt(2, "estado") + "|" + vt(2, "volumetria"));

        // ---- QS) Quitar sin sql/24: el motivo dice lo que falta hoy --------
        Check("QS1 PendienteQuitar: falta sql/24 (sql/23 ya aplicada) y como guardar lo demas", "True|True|False",
            PlanificadorGestionAdmin.PendienteQuitar.Contains("falta aplicar sql/24") + "|" + PlanificadorGestionAdmin.PendienteQuitar.Contains("Restaurar") + "|" +
            PlanificadorGestionAdmin.PendienteQuitar.Contains("sql/23 y sql/24"));

        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
