// Prueba offline de la identidad Windows, la autorizacion de Admin y la
// resolucion de personas / destinatarios candidatos. Sin IIS y sin SQL
// Server: identidades con IdentidadWindows.Desde y catalogos armados a mano
// por los constructores publicos.
//
// Casos:
//   1) SORIANA\t_andresvr -> t_andresvr
//   2) t_andresvr sin dominio -> t_andresvr
//   3) normalizacion sin distinguir mayusculas
//   4) cuenta autorizada -> permitida
//   5) cuenta no autorizada / sin autenticar / entrada sin dominio -> negada
//   6) sin fila en CatPersona: autoriza igual, sin nombre, sin excepcion
//   7) con fila en CatPersona: nombre y correo resueltos
//   8) correo candidato t_andresvr@soriana.com
//   9) SO con varios PO: "ambiguo", sin escoger ninguno
//  10) correo faltante: null con estado sin_correo / no_encontrado
//   W) TODO(TEMPORAL) whitelist de AdminWhitelistTemporal: t_andresvr si;
//      otro usuario, anonimo/vacio y otro dominio no
//  +)  rutas protegidas por el modulo
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:IdentidadAdminSmoke.exe /r:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll tools\tests\IdentidadAdminSmoke.cs
//   IdentidadAdminSmoke.exe
using System;
using System.Collections;
using System.Collections.Generic;

public static class IdentidadAdminSmoke
{
    static int fallos = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static DirectorioPersonas.Persona P(string nombre, string correo, string manager, string po)
    {
        return new DirectorioPersonas.Persona { Nombre = nombre, Correo = correo, Manager = manager, ProductOwner = po };
    }

    static DirectorioPersonas.LiderGrupo L(string grupo, string lider, string correoLider, string gerente, string correoGerente)
    {
        return new DirectorioPersonas.LiderGrupo
        {
            Grupo = grupo, Lider = lider, CorreoLider = correoLider,
            Gerente = gerente, CorreoGerente = correoGerente
        };
    }

    static DirectorioOrganizacional.Dueno D(string n2, string c1, string po, string so, string dir, bool vigente)
    {
        var d = new DirectorioOrganizacional.Dueno();
        d.CategoriaN2 = n2; d.C1 = c1; d.Po = po; d.So = so; d.Director = dir; d.Vigente = vigente;
        return d;
    }

    static object Campo(object dic, string llave)
    {
        return ((Dictionary<string, object>)dic)[llave];
    }

    public static int Main()
    {
        // ---- 1-3, 8: identidad ------------------------------------------
        var yo = IdentidadWindows.Desde(@"SORIANA\t_andresvr", true);
        Check("1 usuario de SORIANA\\t_andresvr", "t_andresvr", yo.Usuario);
        Check("1 original intacto", @"SORIANA\t_andresvr", yo.Original);
        Check("1 dominio", "soriana", yo.Dominio);
        Check("2 sin dominio", "t_andresvr", IdentidadWindows.Desde("t_andresvr", true).Usuario);
        Check("2 sin dominio: Dominio null", true, IdentidadWindows.Desde("t_andresvr", true).Dominio == null);
        Check("3 mayusculas", "t_andresvr", IdentidadWindows.NormalizarUsuario(@"soriana\T_AndresVR"));
        Check("3 espacios", "t_andresvr", IdentidadWindows.NormalizarUsuario(@"  SORIANA\t_andresvr  "));
        Check("3 otro dominio", "t_andresvr", IdentidadWindows.NormalizarUsuario(@"OTRO\t_andresvr"));
        Check("8 correo candidato", "t_andresvr@soriana.com", yo.CorreoCandidato());
        Check("8 candidato desde mayusculas", "t_andresvr@soriana.com",
              IdentidadWindows.Desde(@"SORIANA\T_ANDRESVR", true).CorreoCandidato());

        var anonima = IdentidadWindows.Desde(@"SORIANA\t_andresvr", false);
        Check("sin autenticar: no autenticada", false, anonima.Autenticada);
        Check("sin autenticar: sin candidato", true, anonima.CorreoCandidato() == null);
        Check("vacia: no autenticada", false, IdentidadWindows.Desde("", true).Autenticada);
        Check("solo dominio: no autenticada", false, IdentidadWindows.Desde(@"SORIANA\", true).Autenticada);
        Check("Actual sin HttpContext: anonima", false, IdentidadWindows.Actual().Autenticada);

        // ---- 4-5: autorizacion -------------------------------------------
        var lista = AccesoAdmin.ListaAutorizados.Leer(
            @" SORIANA\User1 ; soriana\t_andresvr;SORIANA\user3,SORIANA\user4 ; sindominio ; ");
        Check("lista: 4 cuentas validas", 4, lista.Total);
        Check("lista: 1 ignorada (sin dominio)", 1, lista.Ignoradas);
        Check("4 autorizada", true, lista.Permite(yo));
        Check("4 autorizada en mayusculas", true, lista.Permite(IdentidadWindows.Desde(@"SORIANA\USER1", true)));
        Check("4 coma como separador", true, lista.Permite(IdentidadWindows.Desde(@"SORIANA\user4", true)));
        Check("5 no autorizada", false, lista.Permite(IdentidadWindows.Desde(@"SORIANA\t_otro", true)));
        Check("5 misma cuenta, otro dominio", false, lista.Permite(IdentidadWindows.Desde(@"OTRO\t_andresvr", true)));
        Check("5 sin dominio no casa", false, lista.Permite(IdentidadWindows.Desde("t_andresvr", true)));
        Check("5 entrada sin dominio no autoriza", false, lista.Permite(IdentidadWindows.Desde(@"SORIANA\sindominio", true)));
        Check("5 sin autenticar", false, lista.Permite(anonima));
        Check("5 null", false, lista.Permite(null));
        Check("5 lista vacia: nadie", false, AccesoAdmin.ListaAutorizados.Leer(null).Permite(yo));

        // ---- TODO(TEMPORAL): whitelist de AdminWhitelistTemporal ----------
        // Quitar este bloque junto con App_Code/AdminWhitelistTemporal.cs
        // cuando la autorizacion pase a la base. Es el camino real de los
        // handlers: Exigir -> EstaAutorizado -> Configurada().
        Check("W1 SORIANA\\t_andresvr autorizado", true, AccesoAdmin.EstaAutorizado(yo));
        Check("W1 misma cuenta en mayusculas", true,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(@"SORIANA\T_ANDRESVR", true)));
        Check("W2 otro usuario SORIANA rechazado", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(@"SORIANA\t_otro", true)));
        Check("W3 anonimo (no autenticado) rechazado", false, AccesoAdmin.EstaAutorizado(anonima));
        Check("W3 vacio rechazado", false, AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde("", true)));
        Check("W3 null rechazado", false, AccesoAdmin.EstaAutorizado(null));
        Check("W4 otro dominio rechazado", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde(@"OTRO\t_andresvr", true)));
        Check("W4 sin dominio rechazado", false,
              AccesoAdmin.EstaAutorizado(IdentidadWindows.Desde("t_andresvr", true)));
        Check("W5 la temporal tiene exactamente 1 cuenta", 1, AccesoAdmin.Configurada().Total);

        // ---- rutas del modulo --------------------------------------------
        Check("ruta pagina", true, AccesoAdmin.EsRutaProtegida("~/admin/iniciativas.html"));
        Check("ruta pagina mayusculas", true, AccesoAdmin.EsRutaProtegida("~/Admin/Iniciativas.HTML"));
        Check("ruta catalogos", true, AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_catalogos.ashx"));
        Check("ruta registro", true, AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_registro.ashx"));
        Check("ruta diagnostico", true, AccesoAdmin.EsRutaProtegida("~/handlers/admin_iniciativas_diagnostico.ashx"));
        Check("ruta sesion libre", false, AccesoAdmin.EsRutaProtegida("~/handlers/admin_sesion.ashx"));
        Check("ruta tablero libre", false, AccesoAdmin.EsRutaProtegida("~/dashboard.html"));
        Check("ruta kpis libre", false, AccesoAdmin.EsRutaProtegida("~/handlers/kpis.ashx"));
        Check("ruta js de admin libre", false, AccesoAdmin.EsRutaProtegida("~/admin/iniciativas.js"));

        // ---- 6, 7, 10: personas ------------------------------------------
        var personas = new DirectorioPersonas(
            new List<DirectorioPersonas.Persona>
            {
                P("Andres Vera", " T_AndresVR@Soriana.com ", "Ana Manager", null),
                P("Ana Manager", "ana.manager@soriana.com", null, null),
                P("Sofia SO", "sofia.so@soriana.com", "Ana Manager", "Pedro PO"),
                P("Pedro PO", null, null, null),
                P("Duplicado Uno", "compartido@soriana.com", null, null),
                P("Duplicado Dos", "compartido@soriana.com", null, null),
                P("Dos Correos", "uno@soriana.com", null, null),
                P("Dos Correos", "dos@soriana.com", null, null),
            },
            new List<DirectorioPersonas.LiderGrupo>
            {
                L("Mesa A", "Luis Lider", "luis.lider@soriana.com", "Gina Gerente", "gina.gerente@soriana.com"),
                L("Mesa B", "Sofia SO", "SOFIA.SO@soriana.com", "Gina Gerente", "gina.gerente@soriana.com"),
            });

        var res = personas.BuscarPorCorreo(yo.CorreoCandidato());
        Check("7 resuelto", DirectorioPersonas.Resuelto, res.Estado);
        Check("7 nombre", "Andres Vera", res.Nombre);
        Check("7 correo guardado", "t_andresvr@soriana.com", res.Correo);
        Check("7 fuente", "CatPersona.Correo", res.Fuente);
        Check("7 manager", "Ana Manager", res.Manager);
        Check("7 correo del manager", "ana.manager@soriana.com", Campo(personas.CorreoDeNombre(res.Manager), "correo"));

        var fantasma = IdentidadWindows.Desde(@"SORIANA\t_noexiste", true);
        Exception error = null;
        DirectorioPersonas.PersonaResuelta nadie = null;
        try { nadie = personas.BuscarPorCorreo(fantasma.CorreoCandidato()); } catch (Exception ex) { error = ex; }
        Check("6 sin excepcion", true, error == null);
        Check("6 no_encontrado", DirectorioPersonas.NoEncontrado, nadie.Estado);
        Check("6 sin nombre", true, nadie.Nombre == null);
        Check("6 autoriza igual", true,
              AccesoAdmin.ListaAutorizados.Leer(@"SORIANA\t_noexiste").Permite(fantasma));
        Check("6 catalogos vacios: no_encontrado", DirectorioPersonas.NoEncontrado,
              new DirectorioPersonas(null, null).BuscarPorCorreo(yo.CorreoCandidato()).Estado);

        var deLider = personas.BuscarPorCorreo("luis.lider@soriana.com");
        Check("7 por CatLiderGrupo.CorreoLider", "Luis Lider", deLider.Nombre);
        Check("7 fuente CorreoLider", "CatLiderGrupo.CorreoLider", deLider.Fuente);
        var amb = personas.BuscarPorCorreo("compartido@soriana.com");
        Check("correo de dos personas: ambiguo", DirectorioPersonas.Ambiguo, amb.Estado);
        Check("correo de dos personas: sin nombre", true, amb.Nombre == null);
        Check("correo de dos personas: 2 candidatos", 2, amb.Candidatos.Count);

        Check("10 PO sin correo: sin_correo", DirectorioPersonas.SinCorreo, Campo(personas.CorreoDeNombre("Pedro PO"), "estado"));
        Check("10 PO sin correo: null", true, Campo(personas.CorreoDeNombre("Pedro PO"), "correo") == null);
        Check("10 nombre desconocido: no_encontrado", DirectorioPersonas.NoEncontrado, Campo(personas.CorreoDeNombre("Nadie"), "estado"));
        Check("10 nombre null", DirectorioPersonas.NoEncontrado, Campo(personas.CorreoDeNombre(null), "estado"));
        Check("dos correos: ambiguo", DirectorioPersonas.Ambiguo, Campo(personas.CorreoDeNombre("Dos Correos"), "estado"));
        Check("dos correos: null", true, Campo(personas.CorreoDeNombre("Dos Correos"), "correo") == null);
        Check("mismo correo en dos tablas: resuelto", DirectorioPersonas.Resuelto, Campo(personas.CorreoDeNombre("sofia so"), "estado"));
        Check("mismo correo en dos tablas: 2 fuentes", 2, ((IList)Campo(personas.CorreoDeNombre("Sofia SO"), "candidatos")).Count);
        Check("gerente por CorreoGerente", "gina.gerente@soriana.com", Campo(personas.CorreoDeNombre("Gina Gerente"), "correo"));

        // ---- CorreoGerente es lista: solo el primero (formas reales de la base)
        Check("primer correo: coma y espacio", "luisglom@soriana.com",
              DirectorioPersonas.PrimerCorreo("luisglom@soriana.com, t_nancyvp@soriana.com, danielalc@soriana.com"));
        Check("primer correo: salto de linea sin coma", "minervasp@soriana.com",
              DirectorioPersonas.PrimerCorreo("minervasp@soriana.com\r\n danielalc@soriana.com"));
        Check("primer correo: espacios alrededor", "AGomez@soriana.com", DirectorioPersonas.PrimerCorreo("  AGomez@soriana.com ,x@y.com"));
        Check("primer correo: uno solo", "a@soriana.com", DirectorioPersonas.PrimerCorreo("a@soriana.com"));
        Check("primer correo: vacio / solo comas", true,
              DirectorioPersonas.PrimerCorreo(" , ") == null && DirectorioPersonas.PrimerCorreo(null) == null);

        var listas = new DirectorioPersonas(
            new List<DirectorioPersonas.Persona> { P("Daniela Copia", "danielalc@soriana.com", null, null) },
            new List<DirectorioPersonas.LiderGrupo>
            {
                L("Acuerdos", "Adriana Lozano", "adrianalll@soriana.com", "Luis Gerardo Lomas Malacara",
                  "luisglom@soriana.com, t_nancyvp@soriana.com, danielalc@soriana.com"),
                L("Basis", "Bendrix Zuir", "bendrixzr@soriana.com", "Minerva Salas Peña",
                  "minervasp@soriana.com\r\n danielalc@soriana.com"),
                L("Proveedor", "Laura Cardenas", "lauragcg@soriana.com", "Javier de la Cruz Hinostroza",
                  "javierch@soriana.com, sergiotem@soriana.com, danielalc@soriana.com"),
                L("Autocobro", "Laura Cardenas", "lauragcg@soriana.com", "Sergio Tellez Maldonado",
                  "SERGIOTEM@soriana.com, danielalc@soriana.com"),
            });
        Check("lista: correo del gerente = el primero", "luisglom@soriana.com",
              Campo(listas.CorreoDeNombre("Luis Gerardo Lomas Malacara"), "correo"));
        Check("lista: separada por salto de linea", "minervasp@soriana.com",
              Campo(listas.CorreoDeNombre("Minerva Salas Peña"), "correo"));
        Check("lista: resuelto, no ambiguo", DirectorioPersonas.Resuelto,
              Campo(listas.CorreoDeNombre("Javier de la Cruz Hinostroza"), "estado"));
        var porPrimero = listas.BuscarPorCorreo("LUISGLOM@soriana.com ");
        Check("lista: buscar por el primero (mayusculas, espacios) da el gerente", "Luis Gerardo Lomas Malacara|CatLiderGrupo.CorreoGerente",
              porPrimero.Nombre + "|" + porPrimero.Fuente);
        var copia = listas.BuscarPorCorreo("danielalc@soriana.com");
        Check("lista: una copia NO se vuelve gerente", "Daniela Copia|1",
              copia.Nombre + "|" + copia.Candidatos.Count);
        var otroGerente = listas.BuscarPorCorreo("sergiotem@soriana.com");
        Check("lista: gerente en copia de otro grupo -> solo su propio grupo", "Sergio Tellez Maldonado|1",
              otroGerente.Nombre + "|" + otroGerente.Candidatos.Count);
        Check("lista: la evidencia del grupo muestra solo el primero", "javierch@soriana.com",
              Campo(((IList)listas.GruposDe("Javier de la Cruz Hinostroza"))[0], "correo_gerente"));

        // ---- 9: SO -> PO ---------------------------------------------------
        var org = new DirectorioOrganizacional(new List<DirectorioOrganizacional.Dueno>
        {
            D("/S-A / Uno", "/S-A", "Pedro PO", "Sofia SO", "Dora Dir", true),
            D("/S-A / Dos", "/S-A", "Pedro PO", "Sofia SO", "Dora Dir", true),
            D("/S-B / Uno", "/S-B", "Pablo PO", "Sofia SO", "Dora Dir", true),
            D("/S-C / Uno", "/S-C", "Pedro PO", "Unico SO", "Dora Dir", true),
            D("/S-D / Uno", "/S-D", "Viejo PO", "Unico SO", "Dora Dir", false),
            D("/S-E / Uno", "/S-E", "Pedro PO", null, "Dora Dir", true),
            D("/S-E",       "/S-E", null, "Hereda SO", null, true),
        }, new Dictionary<string, string>());

        var dest = new DestinatariosIniciativa(yo, personas, org);
        var ambiguo = dest.SoAPo("Sofia SO", "prueba");
        Check("9 ambiguo", DirectorioPersonas.Ambiguo, ambiguo["estado"]);
        Check("9 no escoge PO", true, ambiguo["product_owner"] == null);
        Check("9 no escoge correo", true, ambiguo["product_owner_correo"] == null);
        Check("9 dos candidatos", 2, ((IList)ambiguo["candidatos"]).Count);
        Check("9 candidatos en orden", "Pablo PO", Campo(((IList)ambiguo["candidatos"])[0], "product_owner"));
        Check("9 categorias del PO", 2, ((IList)Campo(((IList)ambiguo["candidatos"])[1], "categorias")).Count);
        Check("9 CatPersona.ProductOwner informativo", "Pedro PO", ((IList)ambiguo["catpersona_product_owner"])[0]);

        var unico = dest.SoAPo("unico so", "prueba");
        Check("SO con un PO vigente: resuelto", DirectorioPersonas.Resuelto, unico["estado"]);
        Check("SO con un PO: PO", "Pedro PO", unico["product_owner"]);
        Check("SO con un PO: correo PO sin_correo", DirectorioPersonas.SinCorreo, Campo(unico["product_owner_correo"], "estado"));
        Check("SO heredado del C1 cuenta", "Pedro PO", dest.SoAPo("Hereda SO", "prueba")["product_owner"]);
        Check("SO sin categorias: no_encontrado", DirectorioPersonas.NoEncontrado, dest.SoAPo("Nadie", "prueba")["estado"]);
        Check("SO null: no_encontrado", DirectorioPersonas.NoEncontrado, dest.SoAPo(null, null)["estado"]);

        var lider = dest.LiderSo("Sofia SO");
        Check("lider SO: sin regla", DestinatariosIniciativa.SinReglaConfirmada, lider["estado"]);
        Check("lider SO: null", true, lider["lider_so"] == null);
        Check("lider SO: evidencia", 1, ((IList)lider["evidencia_catlidergrupo"]).Count);

        // ---- diagnostico completo ------------------------------------------
        var diag = dest.Resolver("/S-C / Uno", null);
        Check("diag identidad", @"SORIANA\t_andresvr", Campo(diag["identidad"], "windows_identity"));
        Check("diag usuario", "t_andresvr", Campo(diag["identidad"], "normalized_username"));
        Check("diag candidato", "t_andresvr@soriana.com", Campo(diag["identidad"], "lookup_email_candidate"));
        Check("diag solicitante", "Andres Vera", Campo(diag["solicitante"], "nombre"));
        Check("diag manager correo", "ana.manager@soriana.com", Campo(Campo(diag["solicitante"], "manager_correo"), "correo"));
        Check("diag categoria PO", "Pedro PO", Campo(diag["categoria"], "product_owner"));
        Check("diag categoria SO", "Unico SO", Campo(diag["categoria"], "service_owner"));
        Check("diag SO correo no_encontrado", DirectorioPersonas.NoEncontrado, Campo(Campo(diag["categoria"], "service_owner_correo"), "estado"));
        Check("diag SO->PO toma SO de la categoria", "service owner de la categoria", Campo(diag["service_owner_a_product_owner"], "origen"));
        Check("diag categoria desconocida", DirectorioPersonas.NoEncontrado, Campo(dest.Resolver("/X", null)["categoria"], "estado"));
        Check("diag sin categoria: sin llave", false, dest.Resolver(null, null).ContainsKey("categoria"));
        Check("diag sin categoria: SO = solicitante", "solicitante", Campo(dest.Resolver(null, null)["service_owner_a_product_owner"], "origen"));
        Check("diag ?so manda", "Sofia SO", Campo(dest.Resolver("/S-C / Uno", "Sofia SO")["service_owner_a_product_owner"], "service_owner"));

        var desconocido = new DestinatariosIniciativa(fantasma, personas, org).Resolver(null, null);
        Check("diag desconocido: no_encontrado", DirectorioPersonas.NoEncontrado, Campo(desconocido["solicitante"], "estado"));
        Check("diag desconocido: sin SO", true, Campo(desconocido["service_owner_a_product_owner"], "service_owner") == null);

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : ("FALLOS: " + fallos));
        return fallos == 0 ? 0 : 1;
    }
}
