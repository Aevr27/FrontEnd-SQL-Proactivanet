// Prueba offline de la gestion directa de ADM (App_Code/GestionIniciativaAdmin.cs):
// formato, catalogo, cambios, faltantes (Incompleta) y la respuesta de
// persistencia NO habilitada. Sin IIS y sin SQL Server: catalogo,
// compromisos e iniciativa actual armados a mano.
//
// Casos:
//   P) Persistencia: constante false; el JSON siempre dice guardada=false,
//      persistencia=no_habilitada y codigo=null, valida o no.
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
        new[] { "En An\u00e1lisis", "En Soluci\u00f3n", "Cerrado" }, new[] { "En An\u00e1lisis", "Solucionado", "Cancelado" },
        new[] { "Problem", "Mejora" }, new[] { "Problem", "Adopcion", "Requerimiento" });

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
        // ---- P ----
        Check("P1 persistencia es constante false", false, PersistenciaGestionAdmin.Habilitada);
        var j = Crear(C("ADO")).ComoJson();
        Check("P2 valida: guardada=false, persistencia=no_habilitada, codigo=null", "True|False|no_habilitada|",
            j["valida"] + "|" + j["guardada"] + "|" + j["persistencia"] + "|" + j["codigo"]);
        Check("P3 el motivo dice que no se guardo", true, ((string)j["persistencia_motivo"]).Contains("no se guard"));
        Check("P4 bloqueos listados", true, ((List<string>)j["bloqueos"]).Count >= 4);
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
        Check("CC3 solo PO (cascada incompleta) es valido", "", Campos(Crear(C("ADO", po: "PO 1"))));
        Check("CC3 solo categoria es valido", "", Campos(Crear(C("ADO", cat: "/A/Cat 2"))));
        Check("CC4 PO y categoria que no salen juntos", "categoria", Campos(Crear(C("ADO", po: "PO 2", cat: "/A/Cat 1"))));
        Check("CC4 PO y SO que no salen juntos", "so", Campos(Crear(C("ADO", po: "PO 2", so: "SO x"))));
        Check("CC5 Director derivado de la categoria", "Dir A", Crear(C("ADO", cat: "/A/Cat 2")).Director);
        Check("CC5 categoria con dos directores: no se adivina", null, Crear(C("ADO", cat: "/B/Cat 3")).Director);
        Check("CC5 con PO elegido sale uno", "Dir C", Crear(C("ADO", po: "PO 3", cat: "/B/Cat 3")).Director);
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
        var completa = Crear(C("ADO", "PO 1", "SO x", "/A/Cat 1", "20", "T", "D", "O"));
        Check("CI3 completa: valida y sin faltantes", "True|", completa.Valida + "|" + Faltan(completa));
        Check("CI4 espacios cuentan como vacio", "titulo", Faltan(Crear(C("ADO", "PO 1", "SO x", "/A/Cat 1", "20", "  ", "D", "O"))));
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
        Check("MM13 JSON de modificar: folio y no guardada", "PRB 2026-000001|False|no_habilitada", jm["folio"] + "|" + jm["guardada"] + "|" + jm["persistencia"]);

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
        Check("EN5 motivo de persistencia: sin 'retirar' como unica salida; nombra sql/18, ADM_04 y ADM_03", "False|True|True|True",
            PersistenciaGestionAdmin.Motivo.Contains("Falta retirar") + "|" + PersistenciaGestionAdmin.Motivo.Contains("sql/18") + "|" +
            PersistenciaGestionAdmin.Motivo.Contains("ADM_04") + "|" + PersistenciaGestionAdmin.Motivo.Contains("ADM_03"));
        Check("EN6 fuentes de la respuesta de Admin sin BOM: ningun caracter no ASCII fuera de comentarios", "",
            NoAsciiEnCodigo(@"App_Code\GestionIniciativaAdmin.cs", @"App_Code\PlanGestionAdmin.cs", @"App_Code\IniciativaService.cs",
                            @"App_Code\SolicitudIniciativa.cs", @"handlers\admin_iniciativas_gestion.ashx", @"handlers\admin_iniciativas_validar.ashx"));

        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
