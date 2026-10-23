// Prueba offline (sin IIS ni SQL) de quien solicita, el correo del Product
// Owner y el alta de Nueva solicitud: DestinatariosSolicitud e
// IniciativaService.Solicitar (App_Code/SolicitudIniciativaAlta.cs,
// App_Code/IniciativaService.cs) con un CatPersona y un almacen falsos.
//
//   I  identidad: conocida, normalizacion del dominio, desconocida,
//      correo en dos personas, nombre repetido, anonima, sin correo.
//   P  correo del PO: el del PO elegido, no el de un nombre parecido;
//      sin correo, correo invalido, dos personas, no esta: se rechaza.
//   B  lo que manda el navegador (nombre, cuenta, correo del solicitante o
//      del PO) no cambia nada.
//   S  almacen: sin sql/29 no guarda (como antes); con sql/29 guarda una
//      vez con la foto de los correos; sin token no guarda; invalida no
//      pide numero; el mismo token devuelve el mismo numero (nuevo=false);
//      un error de la base no se traga.
//   J  la respuesta JSON.
//   X  excepcion ADM: ADM sin persona (no encontrado, ambiguo, nombre
//      repetido, fila no vigente) valida sin nombre ni correo inventados y
//      conserva la cuenta; con sql/29 no guarda; sin identidad, no-ADM y MOD
//      siguen estrictos; PO/SO/Categoria y el correo del PO no cambian.
//
// Compilar como SolicitudIniciativaSmoke (adm.dll) y correr.
using System;
using System.Collections.Generic;
using System.Collections.Specialized;

sealed class PersonasFalsas : IFuentePersonasAcuse
{
    public List<PersonaCatalogo> Lista = new List<PersonaCatalogo>();
    public PersonasFalsas Con(string nombre, string correo)
    {
        Lista.Add(new PersonaCatalogo { Nombre = nombre, Correo = correo });
        return this;
    }
    public List<PersonaCatalogo> Personas() { return new List<PersonaCatalogo>(Lista); }
}

sealed class AlmacenFalso : IAlmacenSolicitudes
{
    public bool Hay = true;
    public Exception Lanza;
    public readonly List<AltaSolicitud> Altas = new List<AltaSolicitud>();
    readonly Dictionary<Guid, int> porToken = new Dictionary<Guid, int>();
    int ultimo = 0;
    public bool Disponible() { return Hay; }
    public SolicitudGuardada Crear(AltaSolicitud a)
    {
        if (Lanza != null) throw Lanza;
        int n;
        if (porToken.TryGetValue(a.Token, out n))
            return new SolicitudGuardada { Numero = new NumeroSolicitud(n), Nuevo = false, FechaUtc = DateTime.UtcNow };
        Altas.Add(a);
        porToken[a.Token] = ++ultimo;
        return new SolicitudGuardada { Numero = new NumeroSolicitud(ultimo), Nuevo = true, FechaUtc = DateTime.UtcNow };
    }
}

public static class SolicitudIniciativaAltaSmoke
{
    static int fallos = 0, pasados = 0;
    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    const string PO = "Jesus Campa Morones";
    const string TOKEN = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

    static PersonasFalsas Directorio()
    {
        return new PersonasFalsas()
            .Con("Andres Vera Rios", "  AndresVR@Soriana.com ")      // el solicitante (correo con mayusculas y espacios)
            .Con(PO, "jesuscamor@soriana.com")                         // el PO
            .Con("Jesus Campa", "jcampa@soriana.com")                  // nombre PARECIDO al del PO
            .Con("PO Sin Correo", null)
            .Con("PO Correo Raro", "no es correo")
            .Con("PO Doble", "podoble1@soriana.com")
            .Con("po  doble", "podoble2@soriana.com")                  // mismo nombre (ClaveNombre)
            .Con("Ana Uno", "compartido@soriana.com")
            .Con("Ana Dos", "compartido@soriana.com")                 // correo en dos personas
            .Con("Rep Nombre", "repnombre@soriana.com")
            .Con("REP  NOMBRE", "otra@soriana.com");                  // nombre repetido
    }

    static CatalogoSolicitud Catalogo()
    {
        var filas = new List<CatalogoSolicitud.Asignacion>();
        foreach (var po in new[] { PO, "PO Sin Correo", "PO Correo Raro", "PO Doble", "PO Fantasma" })
            filas.Add(new CatalogoSolicitud.Asignacion { Po = po, So = "SO 1", Categoria = "/A/Cat 1", Director = "Dir 1" });
        return new CatalogoSolicitud(new object[] { "PRB", "ADO" }, filas);
    }

    static NameValueCollection Form(string po)
    {
        var f = new NameValueCollection();
        f["tipo"] = "ADO"; f["po"] = po; f["so"] = "SO 1"; f["categoria"] = "/A/Cat 1";
        f["titulo"] = "T"; f["descripcion"] = "D"; f["observaciones"] = "O";
        f["volumetria"] = "120"; f["pct"] = "20"; f["token"] = TOKEN;
        return f;
    }

    static ValidadorIniciativa.Resultado Enviar(IdentidadWindows id, NameValueCollection f, AlmacenFalso almacen, PersonasFalsas personas,
                                                bool esAdm = false)
    {
        var s = SolicitudIniciativa.DesdeFormulario(f, false, null);
        var svc = new IniciativaService(new GeneradorNumeroSolicitudPendiente(), almacen, personas ?? Directorio());
        return svc.Solicitar(s, id, Catalogo(), new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]), esAdm);
    }

    static IdentidadWindows Win(string cuenta) { return IdentidadWindows.Desde(cuenta, true); }

    static string Mensajes(ValidadorIniciativa.Resultado r, string campo)
    {
        var l = new List<string>();
        foreach (var e in r.Errores) if (e.Campo == campo) l.Add(e.Mensaje);
        return string.Join(" / ", l.ToArray());
    }

    static string Campos(ValidadorIniciativa.Resultado r)
    {
        var l = new List<string>();
        foreach (var e in r.Errores) l.Add(e.Campo);
        return string.Join(",", l.ToArray());
    }

    public static int Main()
    {
        // ---------------- I: identidad ----------------
        var a = new AlmacenFalso();
        var r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), a, null);
        Check("I1 cuenta conocida: valida, nombre y correo de CatPersona (minusculas, sin espacios)",
              "True|Andres Vera Rios|andresvr@soriana.com|SORIANA\\andresvr",
              r.Valida + "|" + r.Destinatarios.SolicitanteNombre + "|" + r.Destinatarios.SolicitanteCorreo + "|" + r.Destinatarios.Cuenta);
        foreach (var c in new[] { @"soriana\ANDRESVR", @"  SORIANA\AndresVR  ", @"OTRODOM\andresvr" })
            Check("I2 normalizacion del dominio '" + c + "': misma persona", "andresvr@soriana.com",
                  Enviar(Win(c), Form(PO), new AlmacenFalso(), null).Destinatarios.SolicitanteCorreo);
        Check("I2 Usuario sin dominio y en minusculas", "andresvr|soriana", Win(@"SORIANA\AndresVR").Usuario + "|" + Win(@"SORIANA\AndresVR").Dominio);

        a = new AlmacenFalso();
        r = Enviar(Win(@"SORIANA\t_andresvr"), Form(PO), a, null);
        Check("I3 cuenta desconocida (t_*): invalida en 'solicitante', no guarda", "False|solicitante|0|",
              r.Valida + "|" + Campos(r) + "|" + a.Altas.Count + "|" + r.Destinatarios.SolicitanteCorreo);
        Check("I3 el mensaje dice la cuenta y el correo buscado", true,
              Mensajes(r, "solicitante").Contains(@"SORIANA\t_andresvr") && Mensajes(r, "solicitante").Contains("t_andresvr@soriana.com"));
        r = Enviar(Win(@"SORIANA\compartido"), Form(PO), new AlmacenFalso(), null);
        Check("I4 correo en dos personas: ambiguo, no se elige", "False|solicitante|ambiguo",
              r.Valida + "|" + Campos(r) + "|" + r.Destinatarios.SolicitanteEstado);
        r = Enviar(Win(@"SORIANA\repnombre"), Form(PO), new AlmacenFalso(), null);
        Check("I5 nombre repetido en otra fila: no se atribuye", "False|solicitante|nombre_repetido",
              r.Valida + "|" + Campos(r) + "|" + r.Destinatarios.SolicitanteEstado);
        foreach (var anon in new[] { IdentidadWindows.Desde("", false), IdentidadWindows.Desde(@"SORIANA\andresvr", false), null })
        {
            a = new AlmacenFalso();
            r = Enviar(anon, Form(PO), a, null);
            Check("I6 sin identidad autenticada: invalida, no guarda", "False|solicitante|0", r.Valida + "|" + Campos(r) + "|" + a.Altas.Count);
        }
        var malCorreo = Directorio().Con("Sol Raro", "solraro@soriana.com ");
        malCorreo.Lista.Add(new PersonaCatalogo { Nombre = "Otro Raro", Correo = "OTRO@" });
        r = Enviar(Win(@"SORIANA\otro"), Form(PO), new AlmacenFalso(), malCorreo);
        Check("I7 cuenta cuyo correo no casa con ningun correo valido: no encontrado", "False|solicitante", r.Valida + "|" + Campos(r));

        // ---------------- P: correo del PO ----------------
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), new AlmacenFalso(), null);
        Check("P1 correo del PO elegido (no el de 'Jesus Campa')", "jesuscamor@soriana.com", r.Destinatarios.ProductOwnerCorreo);
        foreach (var caso in new[] { new[] { "PO Sin Correo", "no tiene un correo" }, new[] { "PO Correo Raro", "no tiene un correo" },
                                      new[] { "PO Doble", "m\u00e1s de una persona" }, new[] { "PO Fantasma", "no est\u00e1 en el directorio" } })
        {
            a = new AlmacenFalso();
            r = Enviar(Win(@"SORIANA\andresvr"), Form(caso[0]), a, null);
            Check("P2 " + caso[0] + ": invalida en 'po', sin correo, no guarda", "False|po|True||0",
                  r.Valida + "|" + Campos(r) + "|" + Mensajes(r, "po").Contains(caso[1]) + "|" + r.Destinatarios.ProductOwnerCorreo + "|" + a.Altas.Count);
        }
        var acentos = new PersonasFalsas().Con("Andres Vera Rios", "andresvr@soriana.com").Con("Jes\u00fas  CAMPA morones", "jesus2@soriana.com");
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), new AlmacenFalso(), acentos);
        Check("P3 mismo nombre con acentos/mayusculas/espacios (regla ClaveNombre del acuse)", "jesus2@soriana.com", r.Destinatarios.ProductOwnerCorreo);
        acentos.Con(PO, "jesuscamor@soriana.com");
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), new AlmacenFalso(), acentos);
        Check("P4 ... y si las dos grafias existen: ambiguo, se rechaza", "False|po", r.Valida + "|" + Campos(r));
        var fpo = Form("PO Que No Esta En La Cascada");
        r = Enviar(Win(@"SORIANA\andresvr"), fpo, new AlmacenFalso(), null);
        Check("P5 PO fuera de la cascada: un solo error de catalogo, no se busca su correo", "False|po|True",
              r.Valida + "|" + Campos(r) + "|" + Mensajes(r, "po").Contains("catalogo"));
        var fcombo = Form(PO); fcombo["so"] = "SO Otro";
        r = Enviar(Win(@"SORIANA\andresvr"), fcombo, new AlmacenFalso(), null);
        Check("P6 PO que no forma fila con SO/Categoria: rechazada por la cascada", "False", r.Valida);

        // ---------------- B: lo que manda el navegador ----------------
        a = new AlmacenFalso();
        var fb = Form(PO);
        fb["solicitante"] = "Otro Nombre"; fb["nombre"] = "Otro Nombre"; fb["usuario"] = @"SORIANA\jefe";
        fb["cuenta"] = @"SORIANA\jefe"; fb["correo"] = "atacante@evil.com"; fb["solicitante_correo"] = "atacante@evil.com";
        fb["po_correo"] = "atacante@evil.com"; fb["product_owner_correo"] = "atacante@evil.com";
        r = Enviar(Win(@"SORIANA\andresvr"), fb, a, null);
        Check("B1 campos de identidad/correo del navegador ignorados: se guarda lo resuelto",
              "True|SORIANA\\andresvr|Andres Vera Rios|andresvr@soriana.com|jesuscamor@soriana.com",
              r.Valida + "|" + a.Altas[0].Cuenta + "|" + a.Altas[0].SolicitanteNombre + "|" + a.Altas[0].SolicitanteCorreo + "|" + a.Altas[0].ProductOwnerCorreo);
        var j = IniciativaService.ComoJson(r);
        var js = (Dictionary<string, object>)j["solicitante"];
        Check("B2 la respuesta tambien trae lo resuelto", "andresvr@soriana.com|jesuscamor@soriana.com", js["correo"] + "|" + j["product_owner_correo"]);

        // ---------------- S: almacen ----------------
        a = new AlmacenFalso { Hay = false };
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), a, null);
        j = IniciativaService.ComoJson(r);
        Check("S1 sin sql/29: valida, NO guarda, numero pendiente (como antes)", "True|False|||True|0",
              r.Valida + "|" + j["guardada"] + "|" + j["numero_solicitud"] + "|" + (r.Numero == null ? "" : "x") + "|" +
              (j["numero_pendiente"] as string == GeneradorNumeroSolicitudPendiente.Motivo) + "|" + a.Altas.Count);

        a = new AlmacenFalso();
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), a, null);
        j = IniciativaService.ComoJson(r);
        var alta = a.Altas[0];
        Check("S2 con sql/29: guarda UNA vez con #0000001", "True|True|True|#0000001|1", r.Valida + "|" + j["guardada"] + "|" + j["nuevo"] + "|" + j["numero_solicitud"] + "|" + a.Altas.Count);
        Check("S2 los campos que se guardan", "ADO|Jesus Campa Morones|SO 1|/A/Cat 1|Dir 1|T|D|O|120|0.2000|" + TOKEN,
              alta.Tipo + "|" + alta.Po + "|" + alta.So + "|" + alta.Categoria + "|" + alta.Director + "|" + alta.Titulo + "|" +
              alta.Descripcion + "|" + alta.Observaciones + "|" + alta.Volumetria + "|" +
              alta.Pct.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + alta.Token);
        Check("S2 numero_pendiente null y pendientes de guardada", "|True", j["numero_pendiente"] + "|" +
              (((List<string>)j["pendientes"]).Count == IniciativaService.PendientesGuardada.Length));

        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), a, null);
        j = IniciativaService.ComoJson(r);
        Check("S3 mismo token otra vez: mismo numero, nuevo=false, sin otra alta", "True|False|#0000001|1",
              j["guardada"] + "|" + j["nuevo"] + "|" + j["numero_solicitud"] + "|" + a.Altas.Count);
        var f2 = Form(PO); f2["token"] = Guid.NewGuid().ToString();
        r = Enviar(Win(@"SORIANA\andresvr"), f2, a, null);
        Check("S4 otro borrador: #0000002", "#0000002|2", r.Numero + "|" + a.Altas.Count);

        foreach (var tok in new[] { null, "", "no-es-guid", "00000000-0000-0000-0000-000000000000" })
        {
            var ft = Form(PO); ft["token"] = tok;
            var at = new AlmacenFalso();
            r = Enviar(Win(@"SORIANA\andresvr"), ft, at, null);
            Check("S5 token '" + (tok ?? "(ausente)") + "' con sql/29: invalida en 'token', no guarda", "False|token|0",
                  r.Valida + "|" + Campos(r) + "|" + at.Altas.Count);
        }
        a = new AlmacenFalso();
        var fi = Form(PO); fi["titulo"] = " ";
        r = Enviar(Win(@"SORIANA\andresvr"), fi, a, null);
        Check("S6 invalida: no guarda ni pide numero", "False|0|", r.Valida + "|" + a.Altas.Count + "|" + r.Numero);
        a = new AlmacenFalso { Lanza = new ErrorSolicitud(51406, "x") };
        string capturado = "sin error";
        try { Enviar(Win(@"SORIANA\andresvr"), Form(PO), a, null); }
        catch (ErrorSolicitud ex) { capturado = ex.Numero.ToString(); }
        Check("S7 un error de la base (51406) llega al handler, no se traga", "51406", capturado);
        var rca = SolicitudIniciativa.DesdeFormulario(Form(PO), true, @"C:\x\RCA final.DOCX");
        a = new AlmacenFalso();
        new IniciativaService(new GeneradorNumeroSolicitudPendiente(), a, Directorio())
            .Solicitar(rca, Win(@"SORIANA\andresvr"), Catalogo(), new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]));
        Check("S8 RCA: solo la extension original", "DOCX", a.Altas[0].RcaExtension);

        // ---------------- J: forma de la respuesta invalida ----------------
        r = Enviar(Win(@"SORIANA\t_andresvr"), Form("PO Sin Correo"), new AlmacenFalso(), null);
        j = IniciativaService.ComoJson(r);
        Check("J1 invalida: guardada=false, nuevo=false, sin correos resueltos", "False|False|||",
              j["guardada"] + "|" + j["nuevo"] + "|" + ((Dictionary<string, object>)j["solicitante"])["correo"] + "|" + j["product_owner_correo"] + "|" + j["numero_solicitud"]);

        // ---------------- X: excepcion ADM ----------------
        a = new AlmacenFalso();
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), a, null, true);
        Check("X1 ADM con persona: igual que siempre, guarda nombre y correo de CatPersona, sin excepcion",
              "True|False|Andres Vera Rios|andresvr@soriana.com|1|andresvr@soriana.com",
              r.Valida + "|" + r.Destinatarios.ExcepcionAdm + "|" + r.Destinatarios.SolicitanteNombre + "|" +
              r.Destinatarios.SolicitanteCorreo + "|" + a.Altas.Count + "|" + a.Altas[0].SolicitanteCorreo);

        a = new AlmacenFalso { Hay = false };
        r = Enviar(Win(@"SORIANA\t_andresvr"), Form(PO), a, null, true);
        j = IniciativaService.ComoJson(r);
        js = (Dictionary<string, object>)j["solicitante"];
        Check("X2 ADM sin persona, sin sql/29: valida, sin nombre ni correo inventados, no guarda, numero pendiente",
              "True||True|||no_encontrado|0|False||True",
              r.Valida + "|" + Campos(r) + "|" + r.Destinatarios.ExcepcionAdm + "|" + r.Destinatarios.SolicitanteNombre + "|" +
              r.Destinatarios.SolicitanteCorreo + "|" + r.Destinatarios.SolicitanteEstado + "|" + a.Altas.Count + "|" +
              j["guardada"] + "|" + j["numero_solicitud"] + "|" + (j["numero_pendiente"] as string == GeneradorNumeroSolicitudPendiente.Motivo));
        Check("X2 la cuenta Windows real se conserva tal cual y va en la respuesta",
              @"SORIANA\t_andresvr|SORIANA\t_andresvr|True||",
              r.Destinatarios.Cuenta + "|" + js["cuenta"] + "|" + js["excepcion_adm"] + "|" + js["nombre"] + "|" + js["correo"]);
        Check("X2 el correo del PO se sigue resolviendo", "jesuscamor@soriana.com", r.Destinatarios.ProductOwnerCorreo);
        var cruda = IdentidadWindows.Desde(@"  soriana\T_AndresVR ", true);
        r = Enviar(cruda, Form(PO), new AlmacenFalso { Hay = false }, null, true);
        Check("X2 la cuenta guardada es IdentidadWindows.Original (no se reescribe)", cruda.Original, r.Destinatarios.Cuenta);

        a = new AlmacenFalso();
        r = Enviar(Win(@"SORIANA\t_andresvr"), Form(PO), a, null, true);
        Check("X3 ADM sin persona, con sql/29: invalida en 'solicitante', no llega al almacen",
              "False|solicitante|0|True",
              r.Valida + "|" + Campos(r) + "|" + a.Altas.Count + "|" +
              (Mensajes(r, "solicitante") == DestinatariosSolicitud.MensajeExcepcionSinGuardar));

        foreach (var caso in new[] { new[] { @"SORIANA\compartido", "ambiguo" }, new[] { @"SORIANA\repnombre", "nombre_repetido" } })
        {
            a = new AlmacenFalso { Hay = false };
            r = Enviar(Win(caso[0]), Form(PO), a, null, true);
            Check("X4 ADM " + caso[1] + ": valida, no se elige ninguna de las filas", "True|True|" + caso[1] + "|||0",
                  r.Valida + "|" + r.Destinatarios.ExcepcionAdm + "|" + r.Destinatarios.SolicitanteEstado + "|" +
                  r.Destinatarios.SolicitanteNombre + "|" + r.Destinatarios.SolicitanteCorreo + "|" + a.Altas.Count);
            r = Enviar(Win(caso[0]), Form(PO), new AlmacenFalso(), null, true);
            Check("X4 ADM " + caso[1] + " con sql/29: no guarda", "False|solicitante", r.Valida + "|" + Campos(r));
        }
        // Una fila no vigente no llega: FuentePersonasAcuseSql solo lee VigenteEnOrigen = 1.
        Check("X5 la fuente real solo lee filas vigentes de CatPersona", true,
              System.IO.File.ReadAllText(System.IO.Path.Combine("App_Code", "AcuseIniciativa.cs"))
                  .Contains("SELECT Nombre, Correo FROM dbo.CatPersona WHERE VigenteEnOrigen = 1"));
        var sinVigente = new PersonasFalsas().Con(PO, "jesuscamor@soriana.com");   // andresvr dado de baja: ya no viene
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), new AlmacenFalso { Hay = false }, sinVigente, true);
        Check("X5 ADM cuya fila no esta vigente: no_encontrado, valida por excepcion", "True|True|no_encontrado|",
              r.Valida + "|" + r.Destinatarios.ExcepcionAdm + "|" + r.Destinatarios.SolicitanteEstado + "|" + r.Destinatarios.SolicitanteCorreo);
        r = Enviar(Win(@"SORIANA\andresvr"), Form(PO), new AlmacenFalso { Hay = false }, sinVigente, false);
        Check("X5 ... y sin ADM se rechaza", "False|solicitante", r.Valida + "|" + Campos(r));

        foreach (var anon in new[] { IdentidadWindows.Desde("", false), IdentidadWindows.Desde(@"SORIANA\t_andresvr", false), null })
        {
            a = new AlmacenFalso { Hay = false };
            r = Enviar(anon, Form(PO), a, null, true);
            Check("X6 ADM sin identidad autenticada: sin excepcion, invalida", "False|solicitante|False",
                  r.Valida + "|" + Campos(r) + "|" + r.Destinatarios.ExcepcionAdm);
        }

        foreach (var hay in new[] { false, true })
        {
            a = new AlmacenFalso { Hay = hay };
            r = Enviar(Win(@"SORIANA\t_andresvr"), Form(PO), a, null, false);
            Check("X7 no ADM (VIEWER/solicitante/MOD) sin persona, sql/29=" + hay + ": regla estricta de siempre",
                  "False|solicitante|False|True|0",
                  r.Valida + "|" + Campos(r) + "|" + r.Destinatarios.ExcepcionAdm + "|" +
                  Mensajes(r, "solicitante").Contains("no está en el directorio de personas") + "|" + a.Altas.Count);
        }
        Check("X7 MOD (o ADM+MOD) no es ADM: el handler le pasa esAdm = false", "MOD|MOD|ADM",
              RolAdmin.Resolver(new[] { "MOD" }) + "|" + RolAdmin.Resolver(new[] { "ADM", "MOD" }) + "|" + RolAdmin.Resolver(new[] { "ADM" }));
        var hnd = System.IO.File.ReadAllText(System.IO.Path.Combine("handlers", "admin_iniciativas_validar.ashx"));
        Check("X7 el handler toma ADM del rol del servidor, no del formulario",
              "True|True|False",
              hnd.Contains("Solicitar(solicitud, identidad, AccesoAdmin.Rol(context) == RolAdmin.Adm)") + "|" +
              (hnd.IndexOf("AccesoIniciativas.ExigirSolicitud(context)") < hnd.IndexOf("AccesoAdmin.Rol(context)")) + "|" +
              (hnd.Contains("req.Form[\"rol") || hnd.Contains("QueryString")));

        var fx = Form(PO); fx["so"] = "SO Otro";
        var fcat = Form(PO); fcat["categoria"] = "/No/Existe";
        foreach (var caso in new[] { new object[] { "PO fuera de la cascada", Form("PO Que No Esta En La Cascada") },
                                      new object[] { "SO que no forma fila", fx }, new object[] { "categoria que no existe", fcat },
                                      new object[] { "PO sin correo", Form("PO Sin Correo") }, new object[] { "PO ambiguo", Form("PO Doble") } })
        {
            a = new AlmacenFalso { Hay = false };
            r = Enviar(Win(@"SORIANA\t_andresvr"), (NameValueCollection)caso[1], a, null, true);
            Check("X8 ADM sin persona + " + caso[0] + ": se sigue rechazando, sin error de solicitante", "False|False|0",
                  r.Valida + "|" + Campos(r).Contains("solicitante") + "|" + a.Altas.Count);
        }

        a = new AlmacenFalso { Hay = false };
        var ft2 = Form(PO);
        ft2["rol"] = "ADM"; ft2["esAdm"] = "true"; ft2["excepcion_adm"] = "true";
        r = Enviar(Win(@"SORIANA\t_andresvr"), ft2, a, null, false);
        Check("X9 rol/excepcion mandados por el navegador no abren nada", "False|solicitante|False",
              r.Valida + "|" + Campos(r) + "|" + r.Destinatarios.ExcepcionAdm);
        var ft3 = Form(PO);
        ft3["correo"] = "inventado@soriana.com"; ft3["solicitante_correo"] = "inventado@soriana.com"; ft3["nombre"] = "Inventado";
        r = Enviar(Win(@"SORIANA\t_andresvr"), ft3, new AlmacenFalso { Hay = false }, null, true);
        Check("X9 con la excepcion, nombre/correo del navegador tampoco se usan", "True||",
              r.Valida + "|" + r.Destinatarios.SolicitanteNombre + "|" + r.Destinatarios.SolicitanteCorreo);
        j = IniciativaService.ComoJson(Enviar(Win(@"SORIANA\andresvr"), Form(PO), new AlmacenFalso { Hay = false }, null, false));
        Check("X10 respuesta normal: excepcion_adm=false y la cuenta", @"False|SORIANA\andresvr",
              ((Dictionary<string, object>)j["solicitante"])["excepcion_adm"] + "|" + ((Dictionary<string, object>)j["solicitante"])["cuenta"]);

        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
