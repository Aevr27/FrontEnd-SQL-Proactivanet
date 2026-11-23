// Prueba de humo SIN red ni SQL de App_Code/AvisoNuevaSolicitud.cs (el
// NEW_REQUEST real). El envio va a un transporte falso: nunca a Power Automate.
// Contrato: NEW_REQUEST|tipo|correo|nombre|numero|fecha (seis campos).
//
//   F  Fecha: la del servidor en la zona de presentacion (UTC-06 fijo),
//      aaaa-mm-dd; el borde de medianoche; igual a HoyEnPresentacion.
//   I  Initiative: UN aviso por solicitud nueva confirmada (Guardada + Nuevo),
//      con correo y nombre GUARDADOS y el numero devuelto; seis campos en su
//      orden; sin estado; nombre null = posicion vacia; | y saltos no corren
//      posiciones. Sin aviso: no valida, no guardada, reintento (Nuevo =
//      false), reemplazo, sin numero, webhook apagado. Fallos: nunca lanza.
//   C  Change request: UN aviso con tipo "Change request" y #id; correo o
//      nombre sin resolver = posicion vacia (el aviso sale igual); sin aviso
//      si es repetida, id invalido o webhook apagado (y entonces ni se lee el
//      solicitante); nunca lanza.
//   R  ResolverSolicitanteCambio con CatPersona y UsuariosAdmin falsos:
//      correo con la regla de Nueva solicitud (CatPersona; UsuariosAdmin solo
//      ADM / MOD y solo con UN correo), nombre de la cola (NombreSolicitante);
//      nunca arma cuenta@soriana.com ni usa el correo como nombre.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /target:library /out:adm.dll /r:System.dll /r:System.Core.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /out:AvisoNuevaSolicitudSmoke.exe /r:adm.dll /r:System.dll /r:System.Core.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\AvisoNuevaSolicitudSmoke.cs
//   AvisoNuevaSolicitudSmoke.exe
using System;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

sealed class TransporteNuevo : ITransporteAvisoTeams
{
    public int Estado = 202;
    public Exception Lanza;
    public readonly List<string> Textos = new List<string>();
    public int Post(Uri url, byte[] cuerpo, int timeoutMs)
    {
        // El text del TextBlock de la tarjeta (formato "texto").
        var m = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(cuerpo));
        var adj = (Dictionary<string, object>)((System.Collections.ArrayList)m["attachments"])[0];
        var bloque = (Dictionary<string, object>)((System.Collections.ArrayList)((Dictionary<string, object>)adj["content"])["body"])[0];
        Textos.Add((string)bloque["text"]);
        if (Lanza != null) throw Lanza;
        return Estado;
    }
}

sealed class FichasFalsasAviso : IFuenteFichasUsuariosAdmin
{
    public readonly Dictionary<string, FichaUsuarioAdmin> Fichas = new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
    public bool Lanza;
    public FichasFalsasAviso Con(string cuenta, string correo, string nombre)
    {
        var k = NombreSolicitante.Clave(cuenta);
        FichaUsuarioAdmin f;
        if (!Fichas.TryGetValue(k, out f)) Fichas[k] = f = new FichaUsuarioAdmin();
        f.Correos.Add(correo); f.Nombres.Add(nombre);
        return this;
    }
    public Dictionary<string, FichaUsuarioAdmin> Leer(ICollection<string> claves)
    {
        if (Lanza) throw new InvalidOperationException("UsuariosAdmin caido");
        var salida = new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
        foreach (var k in claves) { FichaUsuarioAdmin f; if (Fichas.TryGetValue(k, out f)) salida[k] = f; }
        return salida;
    }
}

static class AvisoNuevaSolicitudSmoke
{
    const string Url = "https://prueba.invalid/hook?sig=FALSO";
    static int fallos, pasados;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static string Ch(int c) { return ((char)c).ToString(); }

    static TransporteNuevo Conectar(bool configurado)
    {
        var t = new TransporteNuevo();
        AvisoNuevaSolicitud.Avisador = delegate { return new AvisoTeams(delegate { return configurado ? Url : ""; }, t, null, 1000); };
        return t;
    }

    // "LANZO" si la llamada propaga una excepcion (no deberia nunca).
    static object Seguro(Func<ResultadoAvisoTeams?> f)
    {
        try { var r = f(); return r.HasValue ? (object)r.Value : "no aplica"; }
        catch (Exception ex) { return "LANZO " + ex.GetType().Name; }
    }

    static int Main()
    {
        // 2026-11-20 03:30 UTC = 2026-11-19 21:30 en UTC-06: el dia de la
        // fecha es el de Mexico, no el UTC.
        AvisoNuevaSolicitud.AhoraUtc = delegate { return new DateTime(2026, 11, 20, 3, 30, 0, DateTimeKind.Utc); };
        Fecha();
        Iniciativa();
        Cambio();
        Resolver();
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }

    static void Fecha()
    {
        Check("F 05:59:59Z = dia anterior en UTC-06", "2026-11-19", AvisoNuevaSolicitud.Fecha(new DateTime(2026, 11, 20, 5, 59, 59, DateTimeKind.Utc)));
        Check("F 06:00:00Z = mismo dia", "2026-11-20", AvisoNuevaSolicitud.Fecha(new DateTime(2026, 11, 20, 6, 0, 0, DateTimeKind.Utc)));
        Check("F formato aaaa-mm-dd con ceros", "2026-01-05", AvisoNuevaSolicitud.Fecha(new DateTime(2026, 1, 5, 12, 0, 0, DateTimeKind.Utc)));
        Check("F igual a HoyEnPresentacion", DashboardDataInfo.HoyEnPresentacion().ToString("yyyy-MM-dd"), AvisoNuevaSolicitud.Fecha(DateTime.UtcNow));
    }

    static ValidadorIniciativa.Resultado Guardada(string correo, string nombre)
    {
        return new ValidadorIniciativa.Resultado
        {
            Guardada = true, Nuevo = true, Numero = new NumeroSolicitud(142),
            Destinatarios = new DestinatariosSolicitud { SolicitanteCorreo = correo, SolicitanteNombre = nombre, Cuenta = @"SORIANA\t_ana" },
        };
    }

    static void Iniciativa()
    {
        var nombre = "Ana Ru" + Ch(0xED) + "z Pe" + Ch(0xF1) + "a";
        var t = Conectar(true);
        Check("I numero como la pantalla", "#0000142", new NumeroSolicitud(142).ToString());
        var r = AvisoNuevaSolicitud.Iniciativa(Guardada("ana@soriana.com", nombre));
        Check("I enviado", ResultadoAvisoTeams.Enviado, r);
        Check("I exactamente un aviso", 1, t.Textos.Count);
        Check("I texto exacto (seis campos)", "NEW_REQUEST|Initiative|ana@soriana.com|" + nombre + "|#0000142|2026-11-19", t.Textos.Count == 1 ? t.Textos[0] : null);
        var p = t.Textos[0].Split('|');
        Check("I seis posiciones", 6, p.Length);
        Check("I [0] evento", "NEW_REQUEST", p[0]);
        Check("I [1] tipo", "Initiative", p[1]);
        Check("I [2] correo guardado", "ana@soriana.com", p[2]);
        Check("I [3] nombre guardado", nombre, p[3]);
        Check("I [4] numero", "#0000142", p[4]);
        Check("I [5] fecha", "2026-11-19", p[5]);
        Check("I sin estado", false, t.Textos[0].Contains("ENVIADA"));

        t.Textos.Clear();
        AvisoNuevaSolicitud.Iniciativa(Guardada("ana@soriana.com", "Ana | Ruiz\r\nSegunda"));
        var raro = t.Textos[0].Split('|');
        Check("I nombre con | y salto: seis posiciones", 6, raro.Length);
        Check("I nombre con | y salto: saneado", "Ana / Ruiz  Segunda", raro[3]);
        Check("I nombre con | y salto: numero y fecha en su lugar", "#0000142|2026-11-19", raro[4] + "|" + raro[5]);

        t.Textos.Clear();
        AvisoNuevaSolicitud.Iniciativa(Guardada("adm@soriana.com", null));
        Check("I nombre null (USUARIOSADMIN sin nombre): posicion vacia, no inventado", "NEW_REQUEST|Initiative|adm@soriana.com||#0000142|2026-11-19", t.Textos[0]);

        var casos = new Dictionary<string, Func<ValidadorIniciativa.Resultado>>
        {
            { "no valida", delegate { var x = Guardada("a@soriana.com", "A"); x.Agregar("po", "malo"); return x; } },
            { "no guardada (sin sql/29)", delegate { var x = Guardada("a@soriana.com", "A"); x.Guardada = false; return x; } },
            { "reintento (Nuevo = false)", delegate { var x = Guardada("a@soriana.com", "A"); x.Nuevo = false; return x; } },
            { "reemplazo (Modificar)", delegate { var x = Guardada("a@soriana.com", "A"); x.ReemplazaA = 9; return x; } },
            { "sin numero", delegate { var x = Guardada("a@soriana.com", "A"); x.Numero = null; return x; } },
            { "resultado null", delegate { return null; } },
        };
        foreach (var c in casos)
        {
            t.Textos.Clear();
            Check("I sin aviso: " + c.Key, "no aplica", Seguro(delegate { return AvisoNuevaSolicitud.Iniciativa(c.Value()); }));
            Check("I sin aviso: " + c.Key + " (0 envios)", 0, t.Textos.Count);
        }
        var apagado = Conectar(false);
        Check("I webhook apagado", ResultadoAvisoTeams.Desactivado, AvisoNuevaSolicitud.Iniciativa(Guardada("a@soriana.com", "A")));
        Check("I webhook apagado: 0 envios", 0, apagado.Textos.Count);

        var t500 = Conectar(true); t500.Estado = 500;
        Check("I Power Automate 500 = Fallido", ResultadoAvisoTeams.Fallido, Seguro(delegate { return AvisoNuevaSolicitud.Iniciativa(Guardada("a@soriana.com", "A")); }));
        var tTo = Conectar(true); tTo.Lanza = new WebException("t", WebExceptionStatus.Timeout);
        Check("I timeout = Fallido", ResultadoAvisoTeams.Fallido, Seguro(delegate { return AvisoNuevaSolicitud.Iniciativa(Guardada("a@soriana.com", "A")); }));
        AvisoNuevaSolicitud.Avisador = delegate { throw new InvalidOperationException("config"); };
        Check("I el avisador lanza = Fallido", ResultadoAvisoTeams.Fallido, Seguro(delegate { return AvisoNuevaSolicitud.Iniciativa(Guardada("a@soriana.com", "A")); }));
        AvisoNuevaSolicitud.Avisador = delegate { return null; };
        Check("I sin avisador = Desactivado", ResultadoAvisoTeams.Desactivado, Seguro(delegate { return AvisoNuevaSolicitud.Iniciativa(Guardada("a@soriana.com", "A")); }));
    }

    static void Cambio()
    {
        var quien = IdentidadWindows.Desde(@"SORIANA\t_mod", true);
        var lecturas = 0;
        AvisoNuevaSolicitud.SolicitanteCambio = delegate (IdentidadWindows id, string rol)
        {
            lecturas++;
            return new SolicitanteAviso { Correo = "t_mod@soriana.com", Nombre = "Mod Uno" };
        };
        var t = Conectar(true);
        Check("C enviado", ResultadoAvisoTeams.Enviado, AvisoNuevaSolicitud.Cambio(57, false, quien, "MOD"));
        Check("C exactamente un aviso", 1, t.Textos.Count);
        Check("C texto exacto (seis campos)", "NEW_REQUEST|Change request|t_mod@soriana.com|Mod Uno|#57|2026-11-19", t.Textos.Count == 1 ? t.Textos[0] : null);
        Check("C [1] tipo distinto de Initiative", "Change request", t.Textos[0].Split('|')[1]);

        t.Textos.Clear();
        Check("C repetida: no aplica", "no aplica", Seguro(delegate { return AvisoNuevaSolicitud.Cambio(57, true, quien, "MOD"); }));
        Check("C id 0: no aplica", "no aplica", Seguro(delegate { return AvisoNuevaSolicitud.Cambio(0, false, quien, "MOD"); }));
        Check("C repetida / id 0: 0 envios", 0, t.Textos.Count);

        t.Textos.Clear();
        AvisoNuevaSolicitud.SolicitanteCambio = delegate { return new SolicitanteAviso { Correo = null, Nombre = "Solo Nombre" }; };
        Check("C correo sin resolver: el aviso sale igual", ResultadoAvisoTeams.Enviado, Seguro(delegate { return AvisoNuevaSolicitud.Cambio(58, false, quien, "MOD"); }));
        Check("C correo sin resolver: posicion vacia", "NEW_REQUEST|Change request||Solo Nombre|#58|2026-11-19", t.Textos.Count == 1 ? t.Textos[0] : null);

        t.Textos.Clear();
        AvisoNuevaSolicitud.SolicitanteCambio = delegate { return null; };
        AvisoNuevaSolicitud.Cambio(59, false, quien, "MOD");
        Check("C sin solicitante: correo y nombre vacios, no corren", "NEW_REQUEST|Change request|||#59|2026-11-19", t.Textos.Count == 1 ? t.Textos[0] : null);

        t.Textos.Clear();
        AvisoNuevaSolicitud.SolicitanteCambio = delegate { throw new InvalidOperationException("CatPersona"); };
        Check("C leer el solicitante lanza: sale igual, sin propagar", ResultadoAvisoTeams.Enviado, Seguro(delegate { return AvisoNuevaSolicitud.Cambio(60, false, quien, "MOD"); }));
        Check("C leer el solicitante lanza: posiciones vacias", "NEW_REQUEST|Change request|||#60|2026-11-19", t.Textos.Count == 1 ? t.Textos[0] : null);

        lecturas = 0;
        AvisoNuevaSolicitud.SolicitanteCambio = delegate (IdentidadWindows id, string rol) { lecturas++; return new SolicitanteAviso(); };
        var apagado = Conectar(false);
        Check("C webhook apagado", ResultadoAvisoTeams.Desactivado, AvisoNuevaSolicitud.Cambio(61, false, quien, "MOD"));
        Check("C webhook apagado: ni lee el solicitante (sin SQL)", 0, lecturas);
        Check("C webhook apagado: 0 envios", 0, apagado.Textos.Count);

        var t500 = Conectar(true); t500.Estado = 500;
        Check("C Power Automate 500 = Fallido", ResultadoAvisoTeams.Fallido, Seguro(delegate { return AvisoNuevaSolicitud.Cambio(62, false, quien, "MOD"); }));
        AvisoNuevaSolicitud.SolicitanteCambio = AvisoNuevaSolicitud.ResolverSolicitanteCambio;
    }

    static string Par(SolicitanteAviso s)
    {
        return s == null ? "null" : (s.Correo ?? "-") + "/" + (s.Nombre ?? "-");
    }

    static void Resolver()
    {
        var mod = IdentidadWindows.Desde(@"SORIANA\t_mod", true);
        var adm = IdentidadWindows.Desde(@"SORIANA\t_adm", true);
        var doble = IdentidadWindows.Desde(@"SORIANA\t_doble", true);
        var personas = new List<PersonaCatalogo>
        {
            new PersonaCatalogo { Nombre = "Mod Uno", Correo = "T_Mod@Soriana.com" },
            new PersonaCatalogo { Nombre = "Doble A", Correo = "t_doble@soriana.com" },
            new PersonaCatalogo { Nombre = "Doble B", Correo = "t_doble@soriana.com" },
        };
        var personasFallan = false;
        SolicitudesCambio.PersonasSolicitante = delegate
        {
            if (personasFallan) throw new InvalidOperationException("CatPersona caida");
            return personas;
        };
        var fichas = new FichasFalsasAviso();
        NombreSolicitante.Fuente = fichas;

        Check("R CatPersona: correo normalizado y nombre", "t_mod@soriana.com/Mod Uno", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(mod, "MOD")));
        fichas.Con(@"SORIANA\t_mod", "otro@soriana.com", "Moderador Uno");
        Check("R CatPersona gana en el correo; nombre como la cola (UsuariosAdmin primero)", "t_mod@soriana.com/Moderador Uno",
              Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(mod, "MOD")));

        Check("R sin CatPersona ni UsuariosAdmin: los dos vacios (no arma cuenta@soriana.com)", "-/-", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(adm, "ADM")));
        fichas.Con(@"SORIANA\t_adm", " Adm.Uno@Soriana.com ", null);
        Check("R ADM sin CatPersona: correo de UsuariosAdmin, sin nombre (no el correo)", "adm.uno@soriana.com/-", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(adm, "ADM")));
        Check("R PSO sin CatPersona: no usa el correo de UsuariosAdmin", "-/-", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(adm, "PSO")));
        fichas.Con(@"SORIANA\t_adm", "adm.dos@soriana.com", "Adm Uno");
        Check("R UsuariosAdmin con dos correos distintos: correo vacio, nombre si", "-/Adm Uno", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(adm, "ADM")));

        Check("R CatPersona ambigua y sin UsuariosAdmin: vacios", "-/-", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(doble, "MOD")));

        personasFallan = true;
        var fichas2 = new FichasFalsasAviso().Con(@"SORIANA\t_mod", "t_mod@soriana.com", "Mod Admin");
        NombreSolicitante.Fuente = fichas2;
        Check("R CatPersona caida: UsuariosAdmin (MOD)", "t_mod@soriana.com/Mod Admin", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(mod, "MOD")));
        fichas2.Lanza = true;
        Check("R las dos caidas: vacios, sin lanzar", "-/-", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(mod, "MOD")));
        personasFallan = false;

        Check("R sin cuenta = null", "null", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(null, "ADM")));
        Check("R cuenta anonima = null", "null", Par(AvisoNuevaSolicitud.ResolverSolicitanteCambio(IdentidadWindows.Desde(null, false), "ADM")));
    }
}
