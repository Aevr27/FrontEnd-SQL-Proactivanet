// Prueba offline de la gestion directa de ADM (App_Code/GestionIniciativaAdmin.cs):
// formato, catalogo, cambios, faltantes (Incompleta) y la respuesta de
// persistencia NO habilitada. Sin IIS y sin SQL Server: catalogo,
// compromisos e iniciativa actual armados a mano.
//
// Casos:
//   P) Persistencia: constante false; el JSON siempre dice guardada=false,
//      persistencia=no_habilitada y codigo=null, valida o no.
//   CF) Crear, formato: sin tipo; volumetria y % invalidos; % sin categoria.
//   CC) Crear, catalogo: tipo/PO/SO/categoria fuera del catalogo; cascada
//      incompleta valida; combinacion que no sale de ninguna fila; Director
//      derivado solo si es uno.
//   CI) Crear, Incompleta: faltantes en el orden de CAMPOS_INCOMPLETA; RCA
//      solo en Problem; borrador minimo (solo tipo) es valido e incompleto.
//   CK) Crear, capacidad excedida = advertencia, no error.
//   MF) Modificar, formato: sin folio; pares desparejos; % invalido; repetida.
//   MM) Modificar: folio inexistente; sin cambios = error; cambios de texto
//      (CRLF no cuenta); % de categoria no ligada = error; vaciar % deja
//      Incompleta; capacidad sin contar la propia iniciativa.
//   MR) IniciativaActual.DesdeRegistro con la forma del registro.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:GestionIniciativaAdminSmoke.exe /r:adm.dll /r:System.dll ^
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
                                string vol = null, string tit = null, string desc = null, string obs = null, bool rca = false)
    {
        return new PeticionCrearAdmin { Tipo = tipo, Po = po, So = so, Categoria = cat, Pct = pct, Volumetria = vol,
                                        Titulo = tit, Descripcion = desc, Observaciones = obs, TieneRca = rca };
    }

    static string Campos(ResultadoGestionAdmin r) { return string.Join(",", r.Errores.Select(e => e.Campo ?? "-").ToArray()); }
    static string Faltan(ResultadoGestionAdmin r) { return string.Join(",", r.Faltantes.Select(f => (string)f["clave"]).ToArray()); }

    static ResultadoGestionAdmin Crear(PeticionCrearAdmin p, params CapacidadCategoria.Compromiso[] k)
    {
        return new ValidadorGestionAdmin().Crear(p, Catalogo, new CapacidadCategoria(k), "PRB");
    }

    static IniciativaActual Actual()
    {
        return IniciativaActual.DesdeRegistro(new Dictionary<string, object>
        {
            { "folio", "PRB 2026-000001" }, { "titulo", "Titulo iniciativa" }, { "titulo_problem", "Titulo problem" },
            { "descripcion", "Linea 1\nLinea 2" }, { "observaciones", null }, { "sin_categoria", false },
            { "categorias", new List<object>
                {
                    new Dictionary<string, object> { { "categoria", "/A/Cat 1" }, { "pct_dism", 0.5 } },
                    new Dictionary<string, object> { { "categoria", "/A/Cat 2" }, { "pct_dism", null } },
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
        Check("CF2 volumetria no entera", "volumetria", Campos(v.FormatoCrear(C("ADO", vol: "12.5"))));
        Check("CF2 volumetria negativa", "volumetria", Campos(v.FormatoCrear(C("ADO", vol: "-1"))));
        Check("CF3 % fuera de rango", "pct", Campos(v.FormatoCrear(C("ADO", cat: "/A/Cat 1", pct: "100.01"))));
        Check("CF3 % con tres decimales", "pct", Campos(v.FormatoCrear(C("ADO", cat: "/A/Cat 1", pct: "1.234"))));
        Check("CF4 % sin categoria", "pct", Campos(v.FormatoCrear(C("ADO", pct: "10"))));
        Check("CF5 % y volumetria validos", "", Campos(v.FormatoCrear(C("ADO", cat: "/A/Cat 1", pct: "33.5", vol: "0"))));

        // ---- CC ----
        Check("CC1 tipo fuera del catalogo", "tipo", Campos(Crear(C("XXX"))));
        Check("CC2 PO fuera del catalogo", "po", Campos(Crear(C("ADO", po: "Nadie"))));
        Check("CC2 SO fuera del catalogo", "so", Campos(Crear(C("ADO", so: "Nadie"))));
        Check("CC2 categoria fuera del catalogo", "categoria", Campos(Crear(C("ADO", cat: "/Z"))));
        Check("CC3 solo PO (cascada incompleta) es valido", "", Campos(Crear(C("ADO", po: "PO 1"))));
        Check("CC3 solo categoria es valido", "", Campos(Crear(C("ADO", cat: "/A/Cat 2"))));
        Check("CC4 PO y categoria que no salen juntos", "categoria", Campos(Crear(C("ADO", po: "PO 2", cat: "/A/Cat 1"))));
        Check("CC5 Director derivado de la categoria", "Dir A", Crear(C("ADO", cat: "/A/Cat 2")).Director);
        Check("CC5 categoria con dos directores: no se adivina", null, Crear(C("ADO", cat: "/B/Cat 3")).Director);
        Check("CC5 con PO elegido sale uno", "Dir C", Crear(C("ADO", po: "PO 3", cat: "/B/Cat 3")).Director);
        Check("CC6 catalogo revisado", true, Crear(C("ADO")).CatalogoRevisado);

        // ---- CI ----
        Check("CI1 borrador minimo (solo tipo) valido", true, Crear(C("ADO")).Valida);
        Check("CI1 ... e incompleto en el orden de CAMPOS_INCOMPLETA", "categoria,titulo,descripcion,observaciones,volumetria,pct",
            Faltan(Crear(C("ADO"))));
        Check("CI2 Problem sin RCA: falta rca", true, Faltan(Crear(C("PRB"))).EndsWith(",rca"));
        Check("CI2 Problem con RCA: no falta, pero avisa que no se sube", "categoria,titulo,descripcion,observaciones,volumetria,pct|True",
            Faltan(Crear(C("PRB", rca: true))) + "|" + Crear(C("PRB", rca: true)).Advertencias.Any(a => a.Contains("no se guarda")));
        var completa = Crear(C("ADO", "PO 1", "SO x", "/A/Cat 1", "20", "100", "T", "D", "O"));
        Check("CI3 completa: valida y sin faltantes", "True|", completa.Valida + "|" + Faltan(completa));
        Check("CI4 espacios cuentan como vacio", "titulo", Faltan(Crear(C("ADO", "PO 1", "SO x", "/A/Cat 1", "20", "100", "  ", "D", "O"))));

        // ---- CK ----
        var exc = Crear(C("ADO", cat: "/A/Cat 1", pct: "30"), K("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK1 capacidad excedida: valida, con advertencia", "True|True", exc.Valida + "|" + exc.Advertencias.Any(a => a.Contains("capacidad")));
        var cabe = Crear(C("ADO", cat: "/A/Cat 1", pct: "20"), K("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK2 cabe justo: sin advertencia", 0, cabe.Advertencias.Count);
        var otra = Crear(C("ADO", cat: "/A/Cat 2", pct: "90"), K("PRB 2026-000009", "/A/Cat 1", 0.8m));
        Check("CK3 otra categoria no resta", 0, otra.Advertencias.Count);

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
        Check("MM12 61 excede: valida con advertencia", "True|1", excede.Valida + "|" + excede.Advertencias.Count);
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

        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASO" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
