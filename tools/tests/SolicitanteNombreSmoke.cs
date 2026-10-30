// Prueba de humo SIN SQL del nombre de quien envio una solicitud (solo
// pantalla): IdentidadAcuse.NombresPorCuenta (la regla del acuse: cuenta ->
// cuenta@soriana.com -> UNA fila de CatPersona, sin nombre repetido),
// SolicitudesCambio.AgregarNombreSolicitante (cola de Cambios) e
// HistorialPeticiones.NombrarCambios (historial). La cuenta guardada
// (solicitado_por / SolicitanteCuenta) nunca cambia.
//
// Compilar y correr desde la raiz del repo (como SolicitudesCambioHttpSmoke):
//   csc /target:library /out:adm.dll ... App_Code\*.cs
//   csc /out:SolicitanteNombreSmoke.exe /r:adm.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll tools\tests\SolicitanteNombreSmoke.cs
using System;
using System.Collections.Generic;

public static class SolicitanteNombreSmoke
{
    static int fallos = 0;
    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static PersonaCatalogo P(string nombre, string correo) { return new PersonaCatalogo { Nombre = nombre, Correo = correo }; }

    static string Nombre(Dictionary<string, string> d, string cuenta)
    {
        string n;
        return d.TryGetValue(cuenta, out n) ? n : "(sin nombre)";
    }

    static Dictionary<string, object> Fila(string cuenta, string estado)
    {
        return new Dictionary<string, object> { { "id", 1 }, { "estado", estado }, { "solicitado_por", cuenta } };
    }

    public static int Main()
    {
        var personas = new List<PersonaCatalogo>
        {
            P("  Juan P\u00e9rez L\u00f3pez ", "jperez@soriana.com"),
            P("Ana Ruiz", " AnaRuiz@Soriana.com "),
            P("Doble Uno", "doble@soriana.com"),        // mismo correo dos veces: ambiguo
            P("Doble Dos", "doble@soriana.com"),
            P("Luis G\u00f3mez", "lgomez@soriana.com"),      // mismo nombre que otra fila: nombre_repetido
            P("LUIS GOMEZ", "lgomez2@soriana.com"),
            P(null, "sinnombre@soriana.com"),
        };

        // ---- A) la regla, pura ----
        var n = IdentidadAcuse.NombresPorCuenta(new[]
        {
            @"SORIANA\jperez", @"soriana\ANARUIZ", @"SORIANA\nadie", @"SORIANA\doble", @"SORIANA\lgomez",
            @"SORIANA\sinnombre", "SORIANA\\", "", null, @"SORIANA\jperez",
        }, personas);
        Check("A1 cuenta Windows resuelta: CatPersona.Nombre sin espacios de mas", "Juan P\u00e9rez L\u00f3pez", Nombre(n, @"SORIANA\jperez"));
        Check("A2 dominio y cuenta sin distinguir mayusculas; correo guardado con espacios/mayusculas", "Ana Ruiz", Nombre(n, @"soriana\ANARUIZ"));
        Check("A3 sin fila en CatPersona: sin nombre (la pantalla muestra la cuenta)", "(sin nombre)", Nombre(n, @"SORIANA\nadie"));
        Check("A4 ambigua (dos filas con ese correo): sin nombre", "(sin nombre)", Nombre(n, @"SORIANA\doble"));
        Check("A5 nombre repetido en otra fila: sin nombre", "(sin nombre)", Nombre(n, @"SORIANA\lgomez"));
        Check("A6 fila sin nombre, cuenta vacia o null: sin nombre, sin excepcion", "(sin nombre)|(sin nombre)|2",
              Nombre(n, @"SORIANA\sinnombre") + "|" + Nombre(n, "SORIANA\\") + "|" + n.Count);
        Check("A7 sin CatPersona (null): nada resuelto", 0, IdentidadAcuse.NombresPorCuenta(new[] { @"SORIANA\jperez" }, null).Count);

        // ---- B) la cola de Cambios ----
        var lecturas = 0;
        SolicitudesCambio.PersonasSolicitante = delegate { lecturas++; return personas; };
        var filas = new List<Dictionary<string, object>>
        {
            Fila(@"SORIANA\jperez", "PENDIENTE"), Fila(@"SORIANA\jperez", "APLICADA"), Fila(@"SORIANA\nadie", "RECHAZADA"),
            Fila(@"SORIANA\doble", "PENDIENTE"), Fila(null, "PENDIENTE"),
        };
        SolicitudesCambio.AgregarNombreSolicitante(filas);
        Check("B1 pendiente y aplicada con nombre; no resuelta, ambigua y sin cuenta en null; CatPersona se lee UNA vez",
              "Juan P\u00e9rez L\u00f3pez|Juan P\u00e9rez L\u00f3pez|||" + "|1",
              filas[0]["solicitante_nombre"] + "|" + filas[1]["solicitante_nombre"] + "|" + filas[2]["solicitante_nombre"] + "|" +
              filas[3]["solicitante_nombre"] + "|" + filas[4]["solicitante_nombre"] + "|" + lecturas);
        Check("B2 solicitado_por (la cuenta de auditoria) no cambia", @"SORIANA\jperez|SORIANA\nadie|",
              filas[0]["solicitado_por"] + "|" + filas[2]["solicitado_por"] + "|" + filas[4]["solicitado_por"]);
        Check("B3 la clave existe aunque sea null (la pantalla cae a la cuenta)", "True|True",
              filas[2].ContainsKey("solicitante_nombre") + "|" + (filas[2]["solicitante_nombre"] == null));
        SolicitudesCambio.PersonasSolicitante = delegate { throw new InvalidOperationException("CatPersona no se pudo leer"); };
        filas = new List<Dictionary<string, object>> { Fila(@"SORIANA\jperez", "PENDIENTE") };
        SolicitudesCambio.AgregarNombreSolicitante(filas);
        Check("B4 CatPersona no se lee: sin nombre, sin excepcion, la cuenta intacta", "True|SORIANA\\jperez",
              (filas[0]["solicitante_nombre"] == null) + "|" + filas[0]["solicitado_por"]);
        lecturas = 0;
        SolicitudesCambio.PersonasSolicitante = delegate { lecturas++; return personas; };
        SolicitudesCambio.AgregarNombreSolicitante(new List<Dictionary<string, object>>());
        Check("B5 lista vacia: ni se lee CatPersona", 0, lecturas);

        // ---- C) historial ----
        var l = new LecturaHistorial();
        l.Peticiones.Add(new PeticionHistorial { Tipo = PeticionHistorial.TipoCambio, Id = 1, SolicitanteCuenta = @"SORIANA\jperez" });
        l.Peticiones.Add(new PeticionHistorial { Tipo = PeticionHistorial.TipoCambio, Id = 2, SolicitanteCuenta = @"SORIANA\doble" });
        l.Peticiones.Add(new PeticionHistorial { Tipo = PeticionHistorial.TipoIniciativa, Id = 3, SolicitanteCuenta = @"SORIANA\jperez", SolicitanteNombre = "Guardado" });
        HistorialPeticiones.NombrarCambios(l);
        Check("C1 historial: CAMBIO resuelto con nombre, ambiguo sin el, INICIATIVA conserva el guardado; cuentas intactas",
              "Juan P\u00e9rez L\u00f3pez||Guardado|SORIANA\\jperez|SORIANA\\doble",
              l.Peticiones[0].SolicitanteNombre + "|" + l.Peticiones[1].SolicitanteNombre + "|" + l.Peticiones[2].SolicitanteNombre + "|" +
              l.Peticiones[0].SolicitanteCuenta + "|" + l.Peticiones[1].SolicitanteCuenta);

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
