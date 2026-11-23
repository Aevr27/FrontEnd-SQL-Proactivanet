// Prueba de humo SIN red ni SQL de App_Code/AvisoRevisionSolicitud.cs
// (REQUEST_APPROVED / REQUEST_REJECTED reales). El envio va a un transporte
// falso: nunca a Power Automate.
//
//   IA Initiative aprobada: correo y nombre GUARDADOS en la solicitud, [5] =
//      Codigo; Nueva = false, sin Codigo o sin numero = sin aviso; correo
//      invalido o vacio = no se envia a nadie.
//   IR Initiative rechazada: [5] = comentario (| y saltos no corren
//      posiciones); solo si la solicitud releida quedo RECHAZADA.
//   CA Change request aplicada: [5] = folio (Codigo de la iniciativa), no el
//      id; el solicitante se resuelve con solicitado_por y rol_solicitante
//      GUARDADOS, nunca con el revisor; solo si quedo APLICADA.
//   CR Change request rechazada: [5] = comentario; solo si quedo RECHAZADA.
//   PS PO/SO (PSO) sin CatPersona con el resolver real: aunque UsuariosAdmin
//      tenga un correo para esa cuenta, no se usa y no se envia nada; el
//      mismo caso con rol ADM si se envia (el rol que cuenta es el guardado).
//   D  Detalle: apagado = no relee la base; lectura que lanza = null.
//   X  fallos (500, timeout, avisador o resolver que lanzan): nunca lanza.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /target:library /out:adm.dll /r:System.dll /r:System.Core.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /out:AvisoRevisionSolicitudSmoke.exe /r:adm.dll /r:System.dll /r:System.Core.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\AvisoRevisionSolicitudSmoke.cs
//   AvisoRevisionSolicitudSmoke.exe
using System;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

sealed class TransporteRevision : ITransporteAvisoTeams
{
    public int Estado = 202;
    public Exception Lanza;
    public readonly List<string> Textos = new List<string>();
    public int Post(Uri url, byte[] cuerpo, int timeoutMs)
    {
        var m = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(cuerpo));
        var adj = (Dictionary<string, object>)((System.Collections.ArrayList)m["attachments"])[0];
        var bloque = (Dictionary<string, object>)((System.Collections.ArrayList)((Dictionary<string, object>)adj["content"])["body"])[0];
        Textos.Add((string)bloque["text"]);
        if (Lanza != null) throw Lanza;
        return Estado;
    }
}

sealed class FichasFalsasRevision : IFuenteFichasUsuariosAdmin
{
    public readonly Dictionary<string, FichaUsuarioAdmin> Fichas = new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
    public FichasFalsasRevision Con(string cuenta, string correo, string nombre)
    {
        var k = NombreSolicitante.Clave(cuenta);
        FichaUsuarioAdmin f;
        if (!Fichas.TryGetValue(k, out f)) Fichas[k] = f = new FichaUsuarioAdmin();
        f.Correos.Add(correo); f.Nombres.Add(nombre);
        return this;
    }
    public Dictionary<string, FichaUsuarioAdmin> Leer(ICollection<string> claves)
    {
        var salida = new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
        foreach (var k in claves) { FichaUsuarioAdmin f; if (Fichas.TryGetValue(k, out f)) salida[k] = f; }
        return salida;
    }
}

static class AvisoRevisionSolicitudSmoke
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

    static TransporteRevision Conectar(bool configurado)
    {
        var t = new TransporteRevision();
        AvisoRevisionSolicitud.Avisador = delegate { return new AvisoTeams(delegate { return configurado ? Url : ""; }, t, null, 1000); };
        return t;
    }

    static object Seguro(Func<ResultadoAvisoTeams?> f)
    {
        try { var r = f(); return r.HasValue ? (object)r.Value : "no aplica"; }
        catch (Exception ex) { return "LANZO " + ex.GetType().Name; }
    }

    static string Ultimo(TransporteRevision t) { return t.Textos.Count == 0 ? "(ninguno)" : t.Textos[t.Textos.Count - 1]; }

    // Como RegistroSolicitudesIniciativa.Lector.Detalle (solo las llaves que se usan).
    static Dictionary<string, object> Iniciativa(string estado, string correo, string nombre)
    {
        return new Dictionary<string, object>
        {
            { "numero", 142 }, { "numero_texto", "#0000142" }, { "estado", estado },
            { "solicitante_correo", correo }, { "solicitante_nombre", nombre }, { "solicitante_cuenta", @"SORIANA\t_ana" },
        };
    }

    // Como SolicitudesCambio.Almacen.Detalle (SolicitudCambioAdmin.Fila).
    static Dictionary<string, object> Cambio(string estado, string cuenta, string rol)
    {
        return new Dictionary<string, object>
        {
            { "id", 57 }, { "folio", "PRB 2026-000009" }, { "estado", estado },
            { "solicitado_por", cuenta }, { "rol_solicitante", rol }, { "revisado_por", @"SORIANA\t_revisor" },
        };
    }

    static int Main()
    {
        IniciativaAprobada();
        IniciativaRechazada();
        CambioAprobado();
        CambioRechazado();
        PoSoSinCatPersona();
        Detalle();
        Fallos();
        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }

    static void IniciativaAprobada()
    {
        var nombre = "Ana Ru" + (char)0xED + "z";
        var t = Conectar(true);
        Check("IA enviado", ResultadoAvisoTeams.Enviado, Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("ENVIADA", "ana@soriana.com", nombre), "PRB 2026-000042", true); }));
        Check("IA un aviso", 1, t.Textos.Count);
        Check("IA texto exacto: solicitante guardado, [5] = Codigo", "REQUEST_APPROVED|Initiative|ana@soriana.com|" + nombre + "|#0000142|PRB 2026-000042", Ultimo(t));
        Check("IA seis posiciones", 6, Ultimo(t).Split('|').Length);

        t.Textos.Clear();
        Check("IA Nueva = false (reintento / otro ADM): sin aviso", "no aplica",
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("APROBADA", "ana@soriana.com", "Ana"), "PRB 2026-000042", false); }));
        Check("IA sin Codigo: sin aviso", "no aplica",
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("ENVIADA", "ana@soriana.com", "Ana"), " ", true); }));
        Check("IA sin detalle: sin aviso", "no aplica", Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(null, "PRB 2026-000042", true); }));
        var sinNumero = Iniciativa("ENVIADA", "ana@soriana.com", "Ana"); sinNumero.Remove("numero_texto");
        Check("IA sin numero: sin aviso", "no aplica", Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(sinNumero, "PRB 2026-000042", true); }));
        Check("IA casos sin aviso: 0 envios", 0, t.Textos.Count);

        Check("IA correo vacio: Invalido, no va a nadie", ResultadoAvisoTeams.Invalido,
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("ENVIADA", null, "Ana"), "PRB 2026-000042", true); }));
        Check("IA correo sin forma: Invalido", ResultadoAvisoTeams.Invalido,
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("ENVIADA", "SORIANA\\t_ana", "Ana"), "PRB 2026-000042", true); }));
        Check("IA correo invalido: 0 envios", 0, t.Textos.Count);

        AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("ENVIADA", "adm@soriana.com", null), "PRB 2026-000042", true);
        Check("IA nombre null: posicion vacia, no inventado", "REQUEST_APPROVED|Initiative|adm@soriana.com||#0000142|PRB 2026-000042", Ultimo(t));

        var apagado = Conectar(false);
        Check("IA webhook apagado", ResultadoAvisoTeams.Desactivado,
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("ENVIADA", "ana@soriana.com", "Ana"), "PRB 2026-000042", true); }));
        Check("IA apagado: 0 envios", 0, apagado.Textos.Count);
    }

    static void IniciativaRechazada()
    {
        var t = Conectar(true);
        Check("IR enviado", ResultadoAvisoTeams.Enviado,
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaRechazada(Iniciativa("RECHAZADA", "ana@soriana.com", "Ana Ruiz"), "Falta el RCA"); }));
        Check("IR texto exacto: [5] = comentario", "REQUEST_REJECTED|Initiative|ana@soriana.com|Ana Ruiz|#0000142|Falta el RCA", Ultimo(t));
        AvisoRevisionSolicitud.IniciativaRechazada(Iniciativa("RECHAZADA", "ana@soriana.com", "Ana Ruiz"), "No | aplica\r\nver tope");
        var p = Ultimo(t).Split('|');
        Check("IR comentario con | y salto: seis posiciones", 6, p.Length);
        Check("IR comentario saneado en [5]", "No / aplica  ver tope", p[5]);

        t.Textos.Clear();
        foreach (var e in new[] { "ENVIADA", "APROBADA", "CANCELADA", null })
            Check("IR releida en " + (e ?? "null") + ": sin aviso", "no aplica",
                  Seguro(delegate { return AvisoRevisionSolicitud.IniciativaRechazada(Iniciativa(e, "ana@soriana.com", "Ana"), "x"); }));
        Check("IR sin detalle (no se pudo releer): sin aviso", "no aplica", Seguro(delegate { return AvisoRevisionSolicitud.IniciativaRechazada(null, "x"); }));
        Check("IR casos sin aviso: 0 envios", 0, t.Textos.Count);
    }

    static void CambioAprobado()
    {
        string cuentaVista = null, rolVisto = null;
        AvisoRevisionSolicitud.SolicitanteCambio = delegate (IdentidadWindows id, string rol)
        {
            cuentaVista = id == null ? null : id.Original; rolVisto = rol;
            return new SolicitanteAviso { Correo = "t_po@soriana.com", Nombre = "Po Uno" };
        };
        var t = Conectar(true);
        Check("CA enviado", ResultadoAvisoTeams.Enviado,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(Cambio("APLICADA", @"SORIANA\t_po", "PSO")); }));
        Check("CA texto exacto: [5] = folio de la iniciativa, no el id", "REQUEST_APPROVED|Change request|t_po@soriana.com|Po Uno|#57|PRB 2026-000009", Ultimo(t));
        Check("CA el solicitante se resuelve con solicitado_por, no con revisado_por", @"SORIANA\t_po", cuentaVista);
        Check("CA con el rol GUARDADO (PSO), no el del revisor", "PSO", rolVisto);

        t.Textos.Clear();
        foreach (var e in new[] { "PENDIENTE", "RECHAZADA", "CANCELADA" })
            Check("CA releida en " + e + ": sin aviso", "no aplica",
                  Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(Cambio(e, @"SORIANA\t_po", "PSO")); }));
        var sinId = Cambio("APLICADA", @"SORIANA\t_po", "PSO"); sinId["id"] = 0;
        Check("CA id invalido: sin aviso", "no aplica", Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(sinId); }));
        Check("CA casos sin aviso: 0 envios", 0, t.Textos.Count);

        AvisoRevisionSolicitud.SolicitanteCambio = delegate { return new SolicitanteAviso { Correo = null, Nombre = "Po Uno" }; };
        Check("CA solicitante sin correo: Invalido, no va a nadie", ResultadoAvisoTeams.Invalido,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(Cambio("APLICADA", @"SORIANA\t_po", "PSO")); }));
        var sinCuenta = Cambio("APLICADA", null, "PSO");
        Check("CA sin solicitado_por: Invalido", ResultadoAvisoTeams.Invalido, Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(sinCuenta); }));
        Check("CA sin correo: 0 envios", 0, t.Textos.Count);
    }

    static void CambioRechazado()
    {
        AvisoRevisionSolicitud.SolicitanteCambio = delegate { return new SolicitanteAviso { Correo = "t_mod@soriana.com", Nombre = "Mod Uno" }; };
        var t = Conectar(true);
        Check("CR enviado", ResultadoAvisoTeams.Enviado,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioRechazado(Cambio("RECHAZADA", @"SORIANA\t_mod", "MOD"), "Fecha fuera de rango"); }));
        Check("CR texto exacto: [5] = comentario", "REQUEST_REJECTED|Change request|t_mod@soriana.com|Mod Uno|#57|Fecha fuera de rango", Ultimo(t));
        t.Textos.Clear();
        foreach (var e in new[] { "PENDIENTE", "APLICADA", "CANCELADA" })
            Check("CR releida en " + e + ": sin aviso", "no aplica",
                  Seguro(delegate { return AvisoRevisionSolicitud.CambioRechazado(Cambio(e, @"SORIANA\t_mod", "MOD"), "x"); }));
        Check("CR casos sin aviso: 0 envios", 0, t.Textos.Count);
    }

    // Con el resolver REAL (AvisoNuevaSolicitud.ResolverSolicitanteCambio) y
    // CatPersona / UsuariosAdmin falsos. t_revisor (ADM, en CatPersona) es
    // quien revisa: su correo nunca debe aparecer.
    static void PoSoSinCatPersona()
    {
        AvisoRevisionSolicitud.SolicitanteCambio = AvisoNuevaSolicitud.ResolverSolicitanteCambio;
        SolicitudesCambio.PersonasSolicitante = delegate
        {
            return new List<PersonaCatalogo>
            {
                new PersonaCatalogo { Nombre = "Revisor Uno", Correo = "t_revisor@soriana.com" },
                new PersonaCatalogo { Nombre = "Po Catalogo", Correo = "t_pocat@soriana.com" },
            };
        };
        NombreSolicitante.Fuente = new FichasFalsasRevision()
            .Con(@"SORIANA\t_posin", "posin.admin@soriana.com", "Po Sin Catalogo")
            .Con(@"SORIANA\t_admsin", "adm.sin@soriana.com", "Adm Sin Catalogo");
        var t = Conectar(true);

        Check("PS PSO sin CatPersona: Invalido (no usa UsuariosAdmin)", ResultadoAvisoTeams.Invalido,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(Cambio("APLICADA", @"SORIANA\t_posin", "PSO")); }));
        Check("PS PSO sin CatPersona rechazado: Invalido", ResultadoAvisoTeams.Invalido,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioRechazado(Cambio("RECHAZADA", @"SORIANA\t_posin", "PSO"), "x"); }));
        Check("PS PSO sin CatPersona: 0 envios (ni al revisor ni a UsuariosAdmin)", 0, t.Textos.Count);

        AvisoRevisionSolicitud.CambioAprobado(Cambio("APLICADA", @"SORIANA\t_pocat", "PSO"));
        Check("PS PSO en CatPersona: su correo y nombre", "REQUEST_APPROVED|Change request|t_pocat@soriana.com|Po Catalogo|#57|PRB 2026-000009", Ultimo(t));

        t.Textos.Clear();
        AvisoRevisionSolicitud.CambioAprobado(Cambio("APLICADA", @"SORIANA\t_admsin", "ADM"));
        Check("PS ADM sin CatPersona: correo unico de UsuariosAdmin", "REQUEST_APPROVED|Change request|adm.sin@soriana.com|Adm Sin Catalogo|#57|PRB 2026-000009", Ultimo(t));

        t.Textos.Clear();
        foreach (var r in new[] { "", null, "adm", "VIEWER" })
            Check("PS rol guardado '" + (r ?? "null") + "' sin CatPersona: no se eleva", ResultadoAvisoTeams.Invalido,
                  Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(Cambio("APLICADA", @"SORIANA\t_admsin", r)); }));
        Check("PS ningun envio contiene el correo del revisor", false, string.Join("\n", t.Textos.ToArray()).Contains("t_revisor"));
    }

    static void Detalle()
    {
        var lecturas = 0;
        Func<Dictionary<string, object>> leer = delegate { lecturas++; return Iniciativa("RECHAZADA", "ana@soriana.com", "Ana"); };
        Conectar(false);
        Check("D apagado: null", "null", AvisoRevisionSolicitud.Detalle(leer) == null ? "null" : "detalle");
        Check("D apagado: no relee la base", 0, lecturas);
        Conectar(true);
        Check("D configurado: relee", "RECHAZADA", AvisoRevisionSolicitud.Detalle(leer)["estado"]);
        Check("D una lectura", 1, lecturas);
        object r;
        try { r = AvisoRevisionSolicitud.Detalle(delegate { throw new InvalidOperationException("SQL caido"); }) == null ? "null" : "detalle"; }
        catch (Exception ex) { r = "LANZO " + ex.GetType().Name; }
        Check("D lectura que lanza: null, sin lanzar", "null", r);
        AvisoRevisionSolicitud.Avisador = delegate { throw new InvalidOperationException("config"); };
        try { r = AvisoRevisionSolicitud.Detalle(leer) == null ? "null" : "detalle"; }
        catch (Exception ex) { r = "LANZO " + ex.GetType().Name; }
        Check("D avisador que lanza: null, sin lanzar", "null", r);
    }

    static void Fallos()
    {
        AvisoRevisionSolicitud.SolicitanteCambio = delegate { return new SolicitanteAviso { Correo = "t_po@soriana.com", Nombre = "Po" }; };
        var t500 = Conectar(true); t500.Estado = 500;
        Check("X Power Automate 500 = Fallido", ResultadoAvisoTeams.Fallido,
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaRechazada(Iniciativa("RECHAZADA", "ana@soriana.com", "Ana"), "x"); }));
        Check("X 500: un solo intento (sin reintento)", 1, t500.Textos.Count);
        var tTo = Conectar(true); tTo.Lanza = new WebException("t", WebExceptionStatus.Timeout);
        Check("X timeout = Fallido", ResultadoAvisoTeams.Fallido,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioAprobado(Cambio("APLICADA", @"SORIANA\t_po", "PSO")); }));
        Check("X timeout: un solo intento", 1, tTo.Textos.Count);
        Conectar(true);
        AvisoRevisionSolicitud.SolicitanteCambio = delegate { throw new InvalidOperationException("CatPersona caida"); };
        Check("X resolver que lanza: Invalido (sin correo), sin lanzar", ResultadoAvisoTeams.Invalido,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioRechazado(Cambio("RECHAZADA", @"SORIANA\t_po", "PSO"), "x"); }));
        AvisoRevisionSolicitud.Avisador = delegate { throw new InvalidOperationException("config"); };
        Check("X avisador que lanza = Fallido", ResultadoAvisoTeams.Fallido,
              Seguro(delegate { return AvisoRevisionSolicitud.IniciativaAprobada(Iniciativa("ENVIADA", "ana@soriana.com", "Ana"), "C", true); }));
        AvisoRevisionSolicitud.Avisador = delegate { return null; };
        Check("X sin avisador = Desactivado", ResultadoAvisoTeams.Desactivado,
              Seguro(delegate { return AvisoRevisionSolicitud.CambioRechazado(Cambio("RECHAZADA", @"SORIANA\t_po", "PSO"), "x"); }));
    }
}
