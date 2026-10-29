// Prueba de humo SIN SQL de handlers/admin_iniciativas_solicitudes.ashx y de
// App_Code/SolicitudCambioAdmin.cs: quien puede enviar / revisar, que lo que
// manda el navegador como usuario, rol o clasificacion se ignora, el
// interruptor propio, la validacion de formato y el flujo de aplicar /
// rechazar con un almacen y un validador falsos. La base de verdad (sql/22)
// se prueba en SolicitudesCambioSqlLocalDbSmoke.
//
// Compilar y correr desde la raiz del repo (como AccesoAdminHttpSmoke):
//   csc /target:library /out:adm.dll ... App_Code\*.cs
//   csc /target:library /out:hnd.dll /r:adm.dll ... h\*.cs   (handlers sin la linea 1)
//   csc /out:SolicitudesCambioHttpSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll tools\tests\SolicitudesCambioHttpSmoke.cs
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Web;

// CatPersona + CatCategoriaDueno sin SQL (AccesoIniciativas.FuenteDuenos).
sealed class DuenosPso : IFuenteDuenosVigentes
{
    public readonly List<PersonaCatalogo> Personas = new List<PersonaCatalogo>();
    public readonly List<DirectorioOrganizacional.Dueno> Filas = new List<DirectorioOrganizacional.Dueno>();
    public int Lecturas;
    public bool Lanza;
    public DuenosPso Persona(string nombre, string correo) { Personas.Add(new PersonaCatalogo { Nombre = nombre, Correo = correo }); return this; }
    public DuenosPso Fila(string po, string so) { Filas.Add(new DirectorioOrganizacional.Dueno { CategoriaN2 = "/A/" + po, C1 = "/A", Po = po, So = so, Director = "Dir", Vigente = true }); return this; }
    // Otra categoria del mismo PO (sql/38: el equipo del PO).
    public DuenosPso FilaEn(string categoria, string po, string so, bool vigente) { Filas.Add(new DirectorioOrganizacional.Dueno { CategoriaN2 = categoria, C1 = "/B", Po = po, So = so, Director = "Dir", Vigente = vigente }); return this; }
    public DuenosVigentes Leer()
    {
        Lecturas++;
        if (Lanza) throw new InvalidOperationException("CatPersona no se pudo leer");
        var filas = Filas.Select(f => new DirectorioOrganizacional.Dueno { CategoriaN2 = f.CategoriaN2, C1 = f.C1, Po = f.Po, So = f.So, Director = f.Director, Vigente = f.Vigente }).ToList();
        return new DuenosVigentes { Personas = new List<PersonaCatalogo>(Personas), Directorio = new DirectorioOrganizacional(filas, new Dictionary<string, string>()) };
    }
}

sealed class RolesFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesFalsos Con(string cuenta, params string[] accesos) { Filas[cuenta.Trim().ToUpperInvariant()] = accesos; return this; }
    public IList<string> AccesosDe(string cuenta)
    {
        string[] f;
        return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0];
    }
}

sealed class AlmacenFalso : IAlmacenSolicitudesCambio
{
    public readonly List<string> Llamadas = new List<string>();
    public PeticionSolicitudCambio UltimaPeticion;
    public string UltimoUsuario, UltimoRol, UltimoRevisor, UltimoComentario;
    public List<ClasificacionSolicitud> UltimasClasificaciones;
    public Dictionary<string, object> Detalle_;
    public ErrorSolicitudCambio LanzarAlAplicar, LanzarAlEnviar;
    public int UltimoNumeroFallo;

    public ResultadoEnvioSolicitud Enviar(PeticionSolicitudCambio p, string usuario, string rol)
    {
        Llamadas.Add("Enviar"); UltimaPeticion = p; UltimoUsuario = usuario; UltimoRol = rol;
        if (LanzarAlEnviar != null) throw LanzarAlEnviar;
        return new ResultadoEnvioSolicitud { IdSolicitud = 7, Repetida = false };
    }
    public List<Dictionary<string, object>> Listar(string estado, int maximo) { Llamadas.Add("Listar:" + estado); return new List<Dictionary<string, object>>(); }
    public Dictionary<string, object> Detalle(int id) { Llamadas.Add("Detalle:" + id); return Detalle_; }
    public void Rechazar(int id, string revisor, string comentario) { Llamadas.Add("Rechazar:" + id); UltimoRevisor = revisor; UltimoComentario = comentario; }
    public void Aplicar(int id, string revisor, string comentario, List<ClasificacionSolicitud> cls, DateTime hoy)
    {
        Llamadas.Add("Aplicar:" + id); UltimoRevisor = revisor; UltimoComentario = comentario; UltimasClasificaciones = cls;
        if (LanzarAlAplicar != null) throw LanzarAlAplicar;
    }
    public void RegistrarFallo(int id, string revisor, int numero, string mensaje) { Llamadas.Add("RegistrarFallo:" + numero); UltimoRevisor = revisor; UltimoNumeroFallo = numero; }
}

public static class SolicitudesCambioHttpSmoke
{
    static int fallos = 0;
    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    const string ADM = @"SORIANA\t_adm";
    const string MOD = @"SORIANA\t_mod";
    const string VIEWER = @"SORIANA\t_nadie";

    static string Correr(string metodo, string query, string cuenta, string[][] campos, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("admin_iniciativas_solicitudes.ashx",
            "http://localhost/handlers/admin_iniciativas_solicitudes.ashx", query ?? ""), new HttpResponse(sw));
        if (cuenta != null)
            ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, cuenta.Length == 0 ? "" : "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        var req = ctx.Request;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, metodo);
        if (campos != null)
        {
            var tipoForm = typeof(HttpRequest).Assembly.GetType("System.Web.HttpValueCollection");
            var form = (NameValueCollection)Activator.CreateInstance(tipoForm, true);
            foreach (var c in campos) form.Add(c[0], c[1]);
            typeof(HttpRequest).GetField("_form", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(req, form);
        }
        new AdminIniciativasSolicitudes().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        return sw.ToString();
    }

    static string[][] F(params string[] kv)
    {
        var l = new List<string[]>();
        for (var i = 0; i < kv.Length; i += 2) l.Add(new[] { kv[i], kv[i + 1] });
        return l.ToArray();
    }

    static readonly string Llave = Guid.NewGuid().ToString();

    static Dictionary<string, object> Pendiente(string tipo, string solicitante, params Dictionary<string, object>[] cats)
    {
        return new Dictionary<string, object>
        {
            { "id", 5 }, { "folio", "PRB 2026-000001" }, { "tipo", tipo }, { "estado", "PENDIENTE" },
            { "estado_anterior", "En Soluci\u00f3n" }, { "estado_nuevo", tipo == "ESTADO" ? "En Monitoreo" : null },
            { "subestado_anterior", null }, { "subestado_nuevo", null },
            { "campo_fecha", tipo == "ESTADO" ? "FechaSolucion" : null }, { "fecha_anterior", tipo == "ESTADO" ? "2026-11-15" : null },
            { "fecha_nueva", tipo == "ESTADO" ? "2026-12-05" : null }, { "solicitado_por", solicitante },
            { "categorias_detalle", cats.Cast<object>().ToList() },
            { "actual", new Dictionary<string, object> { { "estado", "En Soluci\u00f3n" }, { "subestado", null }, { "FechaSolucion", "2026-11-15" } } },
            { "fecha_actual", "2026-11-15" },
        };
    }

    static Dictionary<string, object> Cat(string accion, string ruta, string pctNuevo, string ti, string ta, string pctAnt, string pctAct, bool ligada)
    {
        return new Dictionary<string, object>
        {
            { "categoria", ruta }, { "accion", accion }, { "pct_nuevo", pctNuevo }, { "pct_anterior", pctAnt }, { "pct_actual", pctAct },
            { "tipo_iniciativa", ti }, { "tipo_agrupado", ta }, { "ligada", ligada }, { "ligada_alguna_vez", ligada },
        };
    }

    public static int Main()
    {
        AccesoAdmin.FuenteRoles = new RolesFalsos().Con(ADM, "ADM").Con(MOD, "MOD");
        var alm = new AlmacenFalso();
        SolicitudesCambio.Almacen = alm;
        // Sin SQL: PO / SO capturados por folio y el catalogo de cada par.
        //   000001 -> PO 1 / SO x (par del catalogo: /A/Cat 2, /A/Cat 3)
        //   000002 -> sin capturar; 000003 -> PO X / SO x (no es un par del catalogo)
        var leidasCatalogo = 0;
        var pedidosPar = new List<string>();
        SolicitudesCambio.DuenosCapturados = delegate (string folio)
        {
            if (folio == "PRB 2026-000001" || folio == "XYZ 2026-000001") return new[] { "PO 1", "SO x" };
            if (folio == "PRB 2026-000003") return new[] { "PO X", "SO x" };
            return new string[] { null, null };
        };
        SolicitudesCambio.RutasAgregables = delegate (string po, string so)
        {
            leidasCatalogo++;
            pedidosPar.Add(po + "|" + so);
            return po == "PO 1" && so == "SO x"
                ? new HashSet<string>(new[] { "/A/Cat 2", "/A/Cat 3" }, StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        };
        var validaciones = new List<NameValueCollection>();
        var validacionOk = true;
        SolicitudesCambio.ValidarAplicacion = delegate (NameValueCollection f)
        {
            validaciones.Add(f);
            var v = new ValidacionAplicar { Valida = validacionOk };
            if (!validacionOk) v.Errores.Add(new ErrorCampo { Campo = "pct", Mensaje = "/A/Cat 1: rebasa el 100% de la categoria." });
            return v;
        };
        // Tope al enviar, sin SQL: la iniciativa y los compromisos por folio
        // (sin dato = fuera del registro: no hay que revisar). Los casos C)
        // los llenan; lo de antes no los necesita.
        var capacidades = new Dictionary<string, SolicitudesCambio.DatosCapacidad>(StringComparer.OrdinalIgnoreCase);
        var leidasCapacidad = 0;
        var capacidadFalla = false;
        SolicitudesCambio.LeerCapacidad = delegate (string folio)
        {
            leidasCapacidad++;
            if (capacidadFalla) throw new InvalidOperationException("sin conexion");
            SolicitudesCambio.DatosCapacidad dc;
            return capacidades.TryGetValue(folio ?? "", out dc) ? dc : new SolicitudesCambio.DatosCapacidad();
        };
        int estado; string cuerpo;
        var envioValido = F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "estado", "estado_nuevo", "En Monitoreo",
                            "campo_fecha", "f_solucion", "fecha_nueva", "2026-12-05", "motivo", "Pasa a monitoreo",
                            // falsificados: se ignoran
                            "usuario", @"SORIANA\otro", "rol", "ADM", "solicitado_por", @"SORIANA\otro", "revisor", @"SORIANA\otro");

        // ---- A) quien entra ---------------------------------------------------
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = true;
        cuerpo = Correr("POST", "accion=enviar", "", envioValido, out estado);
        Check("A1 anonimo no envia: 403 y el almacen no se toca", "403|0", estado + "|" + alm.Llamadas.Count);
        cuerpo = Correr("POST", "accion=enviar", VIEWER, envioValido, out estado);
        Check("A2 VIEWER (sin fila en UsuariosAdmin) no envia: 403", "403|0", estado + "|" + alm.Llamadas.Count);
        foreach (var a in new[] { "listar", "detalle&id=5", "aplicar", "rechazar" })
        {
            var metodo = a.StartsWith("listar") || a.StartsWith("detalle") ? "GET" : "POST";
            cuerpo = Correr(metodo, "accion=" + a, MOD, F("id", "5", "comentario", "x"), out estado);
            Check("A3 MOD no puede " + a.Split('&')[0] + ": 403 RolInsuficiente, nada se toca", "403|True|0",
                  estado + "|" + cuerpo.Contains("RolInsuficiente") + "|" + alm.Llamadas.Count);
        }
        cuerpo = Correr("POST", "accion=aplicar", "", F("id", "5"), out estado);
        Check("A4 anonimo no aplica: 403", "403|0", estado + "|" + alm.Llamadas.Count);

        // ---- B) enviar ---------------------------------------------------------
        cuerpo = Correr("POST", "accion=enviar", MOD, envioValido, out estado);
        Check("B1 MOD envia: 200 con el numero de la base", "200|True|True", estado + "|" + cuerpo.Contains("\"enviada\":true") + "|" + cuerpo.Contains("\"id_solicitud\":7"));
        Check("B2 usuario y rol del SERVIDOR, no del formulario", MOD + "|MOD", alm.UltimoUsuario + "|" + alm.UltimoRol);
        var p = alm.UltimaPeticion;
        Check("B3 Estado + fecha de Solucion: la etapa explicita viaja", "ESTADO|En Monitoreo|FechaSolucion|2026-12-05",
              p.Tipo + "|" + p.EstadoNuevo + "|" + p.CampoFecha + "|" + p.FechaNueva.Value.ToString("yyyy-MM-dd"));
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", ADM, envioValido, out estado);
        Check("B4 ADM tambien envia (fase de pruebas), con su rol", "200|ADM", estado + "|" + alm.UltimoRol);
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "estado", "estado_nuevo", "Cerrado",
                                                       "fecha_nueva", "2026-12-05", "motivo", "m"), out estado);
        Check("B5 fecha sin etapa: 422 y no se envia (no se deduce del Estado)", "422|True|0",
              estado + "|" + cuerpo.Contains("\"campo\":\"campo_fecha\"") + "|" + alm.Llamadas.Count);
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "tipo", "otros", "motivo", "m"), out estado);
        Check("B6 sin llave: 422", "422|True", estado + "|" + cuerpo.Contains("\"campo\":\"llave\""));
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "otros", "motivo", "  "), out estado);
        Check("B7 sin motivo: 422", "422|True", estado + "|" + cuerpo.Contains("\"campo\":\"motivo\""));
        cuerpo = Correr("GET", "accion=enviar", MOD, null, out estado);
        Check("B8 GET enviar: 405", 405, estado);
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "alcance",
            "pct_categoria", "/A/Cat 1", "pct_valor", "40", "agregar_categoria", "/A/Cat 2", "agregar_pct", "12.5",
            "agregar_tipo_iniciativa", "Inventado", "agregar_tipo_agrupado", "Inventado"), out estado);
        p = alm.UltimaPeticion;
        var pct = p.Categorias.First(c => c.Accion == "PCT");
        var agr = p.Categorias.First(c => c.Accion == "AGREGAR");
        Check("B9 % en fraccion; la clasificacion de una nueva sale del PREFIJO, no del formulario",
              "0.4000|0.1250|Problem|Problem|null|null",
              pct.Pct.ToString("0.0000", System.Globalization.CultureInfo.InvariantCulture) + "|" + agr.Pct.ToString("0.0000", System.Globalization.CultureInfo.InvariantCulture)
              + "|" + agr.TipoIniciativa + "|" + agr.TipoAgrupado + "|" + (pct.TipoIniciativa ?? "null") + "|" + (pct.TipoAgrupado ?? "null"));
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "XYZ 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/A/Cat 2", "agregar_pct", "10"), out estado);
        agr = alm.UltimaPeticion.Categorias[0];
        Check("B10 prefijo sin regla: sin clasificacion (ADM la elige al aplicar)", "200|null|null",
              estado + "|" + (agr.TipoIniciativa ?? "null") + "|" + (agr.TipoAgrupado ?? "null"));

        // ---- B11-B15) AGREGAR: catalogo de la cascada revisado en el servidor ----
        alm.Llamadas.Clear(); leidasCatalogo = 0;
        foreach (var mala in new[] { "/A", "/A/Inventada", "/Z/Cat 2" })
        {
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
                "agregar_categoria", mala, "agregar_pct", "10"), out estado);
            Check("B11 AGREGAR fuera del catalogo (carpeta / inventada / otra rama) '" + mala + "': 422 categoria, no se envia",
                  "422|True|True|0", estado + "|" + cuerpo.Contains("\"campo\":\"categoria\"") + "|" + cuerpo.Contains("ValidacionFallida") + "|" + alm.Llamadas.Count);
        }
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", " /a/cat 3 ", "agregar_pct", "10"), out estado);
        Check("B12 se compara como el catalogo (NBSP, espacios, sin mayusculas): 200", 200, estado);
        // Lo que manda "Tickets" (pctDeTickets / MetaCategoria.pct: dos
        // decimales) se guarda exacto con la regla de siempre (Math.Round(pct/100, 4)).
        foreach (var caso in new[] { new[] { "42.86", "0.4286" }, new[] { "0.01", "0.0001" }, new[] { "23.93", "0.2393" }, new[] { "100", "1.0000" } })
        {
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
                "agregar_categoria", "/A/Cat 2", "agregar_pct", caso[0]), out estado);
            Check("B12b % de tickets " + caso[0] + ": 200 y se guarda " + caso[1], "200|" + caso[1],
                  estado + "|" + alm.UltimaPeticion.Categorias[0].Pct.ToString("0.0000", System.Globalization.CultureInfo.InvariantCulture));
        }
        alm.Llamadas.Clear(); leidasCatalogo = 0;
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "pct_categoria", "/Ligada/Carpeta", "pct_valor", "15"), out estado);
        Check("B13 solo % de ligadas (aunque sea una carpeta ligada): no se revisa el catalogo, se envia", "200|0",
              estado + "|" + leidasCatalogo);
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/A/Cat 2", "agregar_pct", "150"), out estado);
        Check("B14 formato invalido: 422 sin leer el catalogo", "422|0", estado + "|" + leidasCatalogo);
        // ---- B16-B19) solo el par PO / SO capturado de la iniciativa ----
        pedidosPar.Clear(); alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/A/Cat 3", "agregar_pct", "10"), out estado);
        Check("B16 par capturado valido: su categoria se envia; el catalogo se pide para ESE par", "200|PO 1|SO x",
              estado + "|" + (pedidosPar.Count == 1 ? pedidosPar[0] : "?"));
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000002", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/A/Cat 2", "agregar_pct", "10"), out estado);
        Check("B17 sin PO / SO capturados: 422, no se agrega nada (no se cae a otro par)", "422|True|1",
              estado + "|" + cuerpo.Contains("no tiene Product Owner y Service Owner capturados") + "|" + pedidosPar.Count);
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000003", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/A/Cat 2", "agregar_pct", "10"), out estado);
        Check("B18 par capturado que no esta en el catalogo: 422 (aunque la ruta sea de otro par valido)", "422|True",
              estado + "|" + cuerpo.Contains("no son un par del cat"));
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/B/Cat 4", "agregar_pct", "10"), out estado);
        Check("B19 categoria valida de OTRO par: 422 con el par de la iniciativa en el mensaje", "422|True",
              estado + "|" + cuerpo.Contains("del Product Owner y Service Owner de la iniciativa (PO 1 / SO x)"));
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000002", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "pct_categoria", "/A/Cat 1", "pct_valor", "15"), out estado);
        Check("B19 sin par capturado, solo % de ligadas: se envia (las ligadas se conservan)", 200, estado);
        Check("B19 los mensajes del servidor van en ASCII escapado en el fuente", false,
              System.IO.File.ReadAllText(@"App_Code\SolicitudCambioAdmin.cs").Any(ch => ch > 127));

        // RutasDelPar: igualdad exacta de PO y SO, ruta normalizada.
        var filasCat = new List<object> {
            new Dictionary<string, object> { { "po", "PO 1" }, { "so", "SO x" }, { "categoria", "/A/Cat 2" } },
            new Dictionary<string, object> { { "po", "PO 1" }, { "so", "SO y" }, { "categoria", "/A/Cat 9" } },
            new Dictionary<string, object> { { "po", "PO 3" }, { "so", "SO x" }, { "categoria", "/B/Cat 4" } } };
        Check("B20 RutasDelPar: solo las del par exacto", "1|True|0|0",
              SolicitudesCambio.RutasDelPar(filasCat, " PO 1 ", "SO x").Count + "|" + SolicitudesCambio.RutasDelPar(filasCat, "PO 1", "SO x").Contains("/a/cat 2") +
              "|" + SolicitudesCambio.RutasDelPar(filasCat, "po 1", "SO x").Count + "|" + SolicitudesCambio.RutasDelPar(filasCat, null, "SO x").Count);

        var antes = SolicitudesCambio.RutasAgregables;
        SolicitudesCambio.RutasAgregables = delegate (string po, string so) { throw new InvalidOperationException("timeout"); };
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/A/Cat 2", "agregar_pct", "10"), out estado);
        Check("B15 catalogo ilegible: 503 CatalogoNoDisponible, enviada false, nada se guarda", "503|True|True|0",
              estado + "|" + cuerpo.Contains("CatalogoNoDisponible") + "|" + cuerpo.Contains("\"enviada\":false") + "|" + alm.Llamadas.Count);
        cuerpo = Correr("POST", "accion=enviar", VIEWER, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "agregar_categoria", "/A/Cat 2", "agregar_pct", "10"), out estado);
        Check("B15 sin rol: 403 antes de tocar el catalogo", "403|0", estado + "|" + alm.Llamadas.Count);
        SolicitudesCambio.RutasAgregables = antes;
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "pct_categoria", "/A/Cat 1", "pct_valor", "101"), out estado);
        Check("B11 % fuera de rango: 422", 422, estado);

        // ---- S) Subestado solo ADM (2026-10-26) ------------------------------
        // Quien no ve el Subestado no lo pide: subestado_nuevo de MOD = 422 y
        // nada llega al almacen; el cambio de Estado sin Subestado sigue igual.
        // El rol es el del servidor: un "rol=ADM" del formulario no cuenta.
        var conSub = F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "estado", "estado_nuevo", "Cerrado",
                       "subestado_nuevo", "Solucionado", "motivo", "m", "rol", "ADM");
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", MOD, conSub, out estado);
        Check("S1 MOD pide Subestado: 422 en subestado_nuevo, nada se envia", "422|True|True|0",
              estado + "|" + cuerpo.Contains("\"campo\":\"subestado_nuevo\"") + "|" + cuerpo.Contains("Solo un administrador (ADM)") + "|" + alm.Llamadas.Count);
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "estado",
                                                       "subestado_nuevo", "Solucionado", "motivo", "m"), out estado);
        Check("S2 MOD pide SOLO Subestado: 422, nada se envia", "422|0", estado + "|" + alm.Llamadas.Count);
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "estado",
                                                       "estado_nuevo", "Cerrado", "motivo", "m"), out estado);
        Check("S3 MOD pide Estado sin Subestado: 200, sin Subestado", "200|MOD|Cerrado|null",
              estado + "|" + alm.UltimoRol + "|" + alm.UltimaPeticion.EstadoNuevo + "|" + (alm.UltimaPeticion.SubestadoNuevo ?? "null"));
        cuerpo = Correr("POST", "accion=enviar", ADM, conSub, out estado);
        Check("S4 ADM pide Estado y Subestado: 200, el Subestado viaja", "200|ADM|Solucionado",
              estado + "|" + alm.UltimoRol + "|" + alm.UltimaPeticion.SubestadoNuevo);
        var formSub = new System.Collections.Specialized.NameValueCollection();
        foreach (var par in conSub) formSub.Add(par[0], par[1]);
        var pSub = PeticionSolicitudCambio.DesdeFormulario(formSub);
        pSub.ExigirSubestadoDeAdm(null);
        Check("S5 sin rol resuelto (null): tambien se rechaza (falla cerrado)", "False|subestado_nuevo",
              pSub.Valida + "|" + (pSub.Errores.Count > 0 ? pSub.Errores[0].Campo : ""));

        // ---- VA) VARIOS cambios en UNA solicitud (sql/34) ---------------------
        // Sin sql/34 (interruptor apagado) no pasa: 422 y nada llega al almacen
        // (nunca se parte en varias solicitudes). Con sql/34: una sola peticion
        // con todo; las mismas reglas de rol (Subestado solo ADM) y de forma.
        var varios = F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "varios", "estado_nuevo", "Cerrado",
                       "f_analisis_nueva", "2026-12-01", "f_cierre_nueva", "2027-01-31", "titulo_nuevo", "T nuevo", "motivo", "m", "rol", "ADM");
        PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = false;
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", MOD, varios, out estado);
        Check("VA1 sin sql/34: 422 que lo dice, nada se envia", "422|True|0", estado + "|" + cuerpo.Contains("sql/34") + "|" + alm.Llamadas.Count);
        PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = true;
        PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = true;   // VARIOS ya exige sql/25
        try
        {
            cuerpo = Correr("POST", "accion=enviar", MOD, varios, out estado);
            var pv = alm.UltimaPeticion;
            Check("VA2 con sql/34: UNA peticion VARIOS con todo; el rol es el del servidor", "200|1|VARIOS|Cerrado|2026-12-01|2027-01-31|True|T nuevo|MOD",
                  estado + "|" + alm.Llamadas.Count + "|" + pv.Tipo + "|" + pv.EstadoNuevo + "|" + pv.FechasVarias["FechaAnalisis"].ToString("yyyy-MM-dd") + "|" +
                  pv.FechasVarias["FechaCierre"].ToString("yyyy-MM-dd") + "|" + pv.CambiaTitulo + "|" + pv.TituloNuevo + "|" + alm.UltimoRol);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "varios", "estado_nuevo", "Cerrado",
                                                           "subestado_nuevo", "Solucionado", "f_cierre_nueva", "2027-01-31", "motivo", "m", "rol", "ADM"), out estado);
            Check("VA3 MOD cuela Subestado en VARIOS: 422 en subestado_nuevo, nada se envia", "422|True|0",
                  estado + "|" + cuerpo.Contains("\"campo\":\"subestado_nuevo\"") + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "varios", "estado_nuevo", "Cerrado",
                                                           "campo_fecha", "f_cierre", "fecha_nueva", "2027-01-31", "motivo", "m"), out estado);
            Check("VA4 VARIOS con campo_fecha (en vez de la fecha por etapa): 422", "422|0", estado + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "fecha", "campo_fecha", "f_cierre",
                                                           "fecha_nueva", "2027-01-31", "f_analisis_nueva", "2026-12-01", "motivo", "m"), out estado);
            Check("VA5 una fecha por etapa en otro tipo: 422", "422|0", estado + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "varios", "motivo", "m"), out estado);
            Check("VA6 VARIOS sin ningun cambio: 422", "422|True|0", estado + "|" + cuerpo.Contains("al menos un cambio") + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "varios", "f_cierre_nueva", "2027-01-31",
                                                           "f_cierre_nueva", "2027-02-28", "motivo", "m"), out estado);
            Check("VA7 la misma fecha dos veces en una solicitud: 422 en f_cierre_nueva", "422|True|0",
                  estado + "|" + cuerpo.Contains("\"campo\":\"f_cierre_nueva\"") + "|" + alm.Llamadas.Count);
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = false;
            cuerpo = Correr("POST", "accion=enviar", MOD, varios, out estado);
            Check("VA8 VARIOS con Titulo sin el interruptor de sql/25: 422 (no 500), nada se envia", "422|True|0",
                  estado + "|" + cuerpo.Contains("sql/25") + "|" + alm.Llamadas.Count);
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = null;
        }
        finally
        {
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = null;
            PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = null;
        }

        // ---- C) interruptor apagado ------------------------------------------
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = false;
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", MOD, envioValido, out estado);
        Check("C1 sin sql/22: 501 PersistenciaNoHabilitada, enviada false, el almacen no se toca", "501|True|True|0",
              estado + "|" + cuerpo.Contains("PersistenciaNoHabilitada") + "|" + cuerpo.Contains("\"enviada\":false") + "|" + alm.Llamadas.Count);
        cuerpo = Correr("GET", "accion=listar", ADM, null, out estado);
        Check("C2 sin sql/22 la cola tampoco lee: 501", "501|0", estado + "|" + alm.Llamadas.Count);
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = true;

        // ---- D) aplicar --------------------------------------------------------
        alm.Detalle_ = Pendiente("ESTADO", ADM);
        alm.Llamadas.Clear(); validaciones.Clear();
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5", "comentario", "ok", "revisor", @"SORIANA\otro"), out estado);
        Check("D1 ADM aplica la SUYA (fase de pruebas): valida y aplica; revisor = el del servidor", "200|Detalle:5,Aplicar:5|" + ADM,
              estado + "|" + string.Join(",", alm.Llamadas.ToArray()) + "|" + alm.UltimoRevisor);
        Check("D2 se valida como la edicion directa: estado y SOLO f_solucion", "modificar|En Monitoreo|2026-12-05|||",
              validaciones[0]["accion"] + "|" + validaciones[0]["estado"] + "|" + validaciones[0]["f_solucion"] + "|" + validaciones[0]["f_analisis"]
              + "|" + validaciones[0]["f_cierre"] + "|" + validaciones[0]["titulo"]);

        validacionOk = false; alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5"), out estado);
        Check("D3 validacion que no pasa: 422 con el motivo, falla REGISTRADA, NO se aplica", "422|True|Detalle:5,RegistrarFallo:51230",
              estado + "|" + cuerpo.Contains("rebasa el 100%") + "|" + string.Join(",", alm.Llamadas.ToArray()));
        validacionOk = true;

        alm.Detalle_ = Pendiente("CATEGORIAS", MOD, Cat("AGREGAR", "/A/Cat 2", "10", null, null, null, null, false));
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5"), out estado);
        Check("D4 categoria nueva sin clasificacion: 409 FaltaClasificacion, registrada, no se aplica", "409|True|Detalle:5,RegistrarFallo:51221",
              estado + "|" + cuerpo.Contains("FaltaClasificacion") + "|" + string.Join(",", alm.Llamadas.ToArray()));
        alm.Llamadas.Clear(); validaciones.Clear();
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5", "clas_categoria", "/A/Cat 2", "clas_tipo_iniciativa", "Problem", "clas_tipo_agrupado", "Problem"), out estado);
        Check("D5 con la clasificacion de ADM: se valida con ella y se aplica", "200|Problem|Problem|/A/Cat 2=Problem/Problem",
              estado + "|" + validaciones[0]["agregar_tipo_iniciativa"] + "|" + validaciones[0]["agregar_tipo_agrupado"] + "|"
              + alm.UltimasClasificaciones[0].Categoria + "=" + alm.UltimasClasificaciones[0].TipoIniciativa + "/" + alm.UltimasClasificaciones[0].TipoAgrupado);
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5", "clas_categoria", "/A/Cat 2", "clas_tipo_iniciativa", "Problem"), out estado);
        Check("D6 clasificacion desparejada: 422 ClasificacionInvalida", "422|True", estado + "|" + cuerpo.Contains("ClasificacionInvalida"));

        alm.Detalle_ = Pendiente("ESTADO", MOD);
        foreach (var n in new[] { 51204, 51202, 51010 })
        {
            alm.LanzarAlAplicar = new ErrorSolicitudCambio(n, "mensaje " + n, null);
            cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5"), out estado);
            Check("D7 error " + n + " de la base: 409 con su tipo y aplicada false", "409|True|True",
                  estado + "|" + cuerpo.Contains("\"numero\":" + n) + "|" + cuerpo.Contains("\"aplicada\":false"));
        }
        alm.LanzarAlAplicar = null;
        alm.Detalle_["estado"] = "APLICADA"; alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5"), out estado);
        Check("D8 ya revisada: 409 sin validar ni aplicar", "409|Detalle:5", estado + "|" + string.Join(",", alm.Llamadas.ToArray()));
        alm.Detalle_ = null;
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "99"), out estado);
        Check("D9 no existe: 404", 404, estado);
        cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "x"), out estado);
        Check("D10 sin numero: 400", 400, estado);

        // ---- D11-D14) detalle: otras iniciativas activas de cada categoria ----
        var leidasCap = 0;
        SolicitudesCambio.Capacidad = delegate
        {
            leidasCap++;
            return new CapacidadCategoria(new[] {
                new CapacidadCategoria.Compromiso { Folio = "PRB 2026-000001", Categoria = "/A/Cat 2", Pct = 0.2m, Consume = true, Estado = "En Análisis" },
                new CapacidadCategoria.Compromiso { Folio = "PRB 2026-000009", Categoria = "/A/Cat 2", Pct = 0.3m, Consume = true, Estado = "En Solución" },
                new CapacidadCategoria.Compromiso { Folio = "PRB 2026-000010", Categoria = "/A/Cat 2", Pct = 0.4m, Consume = false, Estado = "Cerrado" } });
        };
        alm.Detalle_ = Pendiente("CATEGORIAS", MOD, Cat("AGREGAR", "/A/Cat 2", "10", null, null, null, null, false),
                                                      Cat("PCT", "/A/Cat 7", "15", null, null, "10", "10", true));
        cuerpo = Correr("GET", "accion=detalle&id=5", ADM, null, out estado);
        Check("D11 detalle ADM: cada categoria con sus otras (sin la de la solicitud ni las cerradas), una lectura", "200|True|False|False|True|1",
              estado + "|" + cuerpo.Contains("\"folio\":\"PRB 2026-000009\",\"pct\"") + "|" + cuerpo.Contains("\"folio\":\"PRB 2026-000001\",\"pct\"") + "|" +
              cuerpo.Contains("PRB 2026-000010") + "|" + cuerpo.Contains("\"otras_iniciativas\":[]") + "|" + leidasCap);
        Check("D12 lo que se pinta: % en fraccion y Estado", true, cuerpo.Contains("\"pct\":0.3") && cuerpo.Contains("Soluci"));
        SolicitudesCambio.Capacidad = delegate { throw new InvalidOperationException("timeout"); };
        cuerpo = Correr("GET", "accion=detalle&id=5", ADM, null, out estado);
        Check("D13 si la capacidad falla: 200, otras_iniciativas null y el detalle se muestra", "200|True|True",
              estado + "|" + cuerpo.Contains("\"otras_iniciativas\":null") + "|" + cuerpo.Contains("\"folio\":\"PRB 2026-000001\""));
        leidasCap = 0;
        SolicitudesCambio.Capacidad = delegate { leidasCap++; return new CapacidadCategoria(null); };
        cuerpo = Correr("GET", "accion=detalle&id=5", MOD, null, out estado);
        Check("D14 MOD: 403 y no se lee la capacidad", "403|0", estado + "|" + leidasCap);
        alm.Detalle_ = null;

        // ---- E) rechazar -------------------------------------------------------
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=rechazar", ADM, F("id", "5", "comentario", "  "), out estado);
        Check("E1 rechazo sin comentario: 422 y no se toca", "422|0", estado + "|" + alm.Llamadas.Count);
        cuerpo = Correr("POST", "accion=rechazar", ADM, F("id", "5", "comentario", "No procede", "revisor", @"SORIANA\otro"), out estado);
        Check("E2 rechazo con comentario: el revisor es el del servidor", "200|Rechazar:5|" + ADM + "|No procede",
              estado + "|" + string.Join(",", alm.Llamadas.ToArray()) + "|" + alm.UltimoRevisor + "|" + alm.UltimoComentario);

        // ---- F) piezas puras ---------------------------------------------------
        var d = Pendiente("CATEGORIAS", MOD, Cat("PCT", "/A/Cat 1", "40", null, null, "30", "30", true),
                                            Cat("AGREGAR", "/A/Cat 2", "10", "Problem", "Problem", null, null, false));
        Check("F1 al dia: no desactualizada", false, SolicitudesCambio.Desactualizada(d));
        ((Dictionary<string, object>)((List<object>)d["categorias_detalle"])[0])["pct_actual"] = "35";
        Check("F2 el % actual ya no es el anterior: desactualizada", true, SolicitudesCambio.Desactualizada(d));
        var e = Pendiente("ESTADO", MOD);
        ((Dictionary<string, object>)e["actual"])["estado"] = "Cerrado";
        Check("F3 el Estado ya cambio: desactualizada", true, SolicitudesCambio.Desactualizada(e));
        var fm = SolicitudesCambio.ComoModificar(d, null);
        Check("F4 ComoModificar: los nombres de la edicion directa", "/A/Cat 1|40|/A/Cat 2|10|Problem",
              fm["pct_categoria"] + "|" + fm["pct_valor"] + "|" + fm["agregar_categoria"] + "|" + fm["agregar_pct"] + "|" + fm["agregar_tipo_iniciativa"]);

        // ---- G) DATOS: Titulo / PO / SO capturados (sql/25) ---------------------
        // Constantes encendidas (2026-10-21), pero sin DeteccionSolicitudesCambio
        // que haya visto sql/22 / sql/25 en la base (aqui no hay base) siguen
        // apagadas: lo prueba con LocalDB SolicitudesDatosSqlLocalDbSmoke (X).
        PersistenciaSolicitudesCambio.OlvidarParaPruebas();
        Check("G1 constantes encendidas; sin sql/22 / sql/25 vistos en la base, apagadas", "True|True|False|False",
              PersistenciaSolicitudesCambio.Habilitada + "|" + PersistenciaSolicitudesCambio.SolicitaDatos + "|" +
              PersistenciaSolicitudesCambio.SolicitaDatosActiva() + "|" + PersistenciaSolicitudesCambio.Vigente(DateTime.UtcNow));
        var forzadaG = PersistenciaSolicitudesCambio.ForzadaParaPruebas;
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = null;
        PersistenciaSolicitudesCambio.Anotar(true, false, DateTime.UtcNow);
        var solo22 = PersistenciaSolicitudesCambio.Activa() + "|" + PersistenciaSolicitudesCambio.SolicitaDatosActiva();
        PersistenciaSolicitudesCambio.Anotar(true, true, DateTime.UtcNow);
        var con25 = PersistenciaSolicitudesCambio.Activa() + "|" + PersistenciaSolicitudesCambio.SolicitaDatosActiva();
        PersistenciaSolicitudesCambio.Anotar(true, true, DateTime.UtcNow - PersistenciaGestionAdmin.VigenciaRevisionSql24);
        var vencida = PersistenciaSolicitudesCambio.Vigente(DateTime.UtcNow);
        PersistenciaSolicitudesCambio.OlvidarParaPruebas();
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = forzadaG;
        Check("G1b deteccion: sql/22 sola enciende Solicitar cambios, no DATOS; con sql/25 las dos; la revision vence", "True|False|True|True|False",
              solo22 + "|" + con25 + "|" + vencida);
        var envioDatos = F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "titulo_nuevo", "  Nuevo titulo ",
                           "po_nuevo", "PO 2", "motivo", "Cambio de responsable",
                           // falsificados: no hay clave para el Codigo ni para el PO de la categoria
                           "codigo", "PRB 2026-999999", "po", "PO inventado", "solicitado_por", @"SORIANA\otro");
        alm.Llamadas.Clear();
        cuerpo = Correr("POST", "accion=enviar", MOD, envioDatos, out estado);
        Check("G2 apagado: datos se rechaza (422, campo tipo, dice que faltan 23/24/25) y el almacen no se toca", "422|True|True|0",
              estado + "|" + cuerpo.Contains("\"campo\":\"tipo\"") + "|" + cuerpo.Contains("sql/25") + "|" + alm.Llamadas.Count);
        PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = true;
        try
        {
            cuerpo = Correr("POST", "accion=enviar", MOD, envioDatos, out estado);
            p = alm.UltimaPeticion;
            Check("G3 encendido: titulo + PO viajan con su bandera; SO no se pide; folio del formulario, sin Codigo aparte",
                  "200|DATOS|True|Nuevo titulo|True|PO 2|False||PRB 2026-000001",
                  estado + "|" + p.Tipo + "|" + p.CambiaTitulo + "|" + p.TituloNuevo + "|" + p.CambiaPo + "|" + p.PoNuevo + "|"
                  + p.CambiaSo + "|" + p.SoNuevo + "|" + p.Folio);
            // Una solicitud nunca deja vacios Titulo / PO / SO: pedido y vacio
            // (o solo espacios) = 422 y el almacen no se toca (peticion manipulada).
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "so_nuevo", "  ", "motivo", "m"), out estado);
            Check("G4 SO pedido vacio (solo espacios): 422 en so_nuevo, no se envia", "422|True|0",
                  estado + "|" + cuerpo.Contains("\"campo\":\"so_nuevo\"") + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "titulo_nuevo", "", "motivo", "m"), out estado);
            Check("G4b Titulo pedido vacio: 422 en titulo_nuevo, no se envia", "422|True|0",
                  estado + "|" + cuerpo.Contains("\"campo\":\"titulo_nuevo\"") + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "titulo_nuevo", " \u00a0 \t",
                                                           "po_nuevo", "PO 2", "motivo", "m"), out estado);
            Check("G4c Titulo de espacios (con NBSP y tab) junto a un PO valido: 422, nada se envia", "422|True|False|0",
                  estado + "|" + cuerpo.Contains("\"campo\":\"titulo_nuevo\"") + "|" + cuerpo.Contains("\"campo\":\"po_nuevo\"") + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "po_nuevo", "", "so_nuevo", "", "motivo", "m"), out estado);
            Check("G4d PO y SO pedidos vacios: 422 en los dos, no se envia", "422|True|True|0",
                  estado + "|" + cuerpo.Contains("\"campo\":\"po_nuevo\"") + "|" + cuerpo.Contains("\"campo\":\"so_nuevo\"") + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "so_nuevo", "SO x", "motivo", "m"), out estado);
            p = alm.UltimaPeticion;
            Check("G4e solo SO: viaja solo SO; Titulo y PO no se piden (null, no vacio)", "200|False|null|False|null|True|SO x",
                  estado + "|" + p.CambiaTitulo + "|" + (p.TituloNuevo ?? "null") + "|" + p.CambiaPo + "|" + (p.PoNuevo ?? "null") + "|" + p.CambiaSo + "|" + p.SoNuevo);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "motivo", "m"), out estado);
            Check("G5 datos sin ningun dato: 422", "422|True|0", estado + "|" + cuerpo.Contains("\"campo\":\"tipo\"") + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "titulo_nuevo", "t",
                                                           "estado_nuevo", "Cerrado", "motivo", "m"), out estado);
            Check("G6 datos con Estado: 422 (cada tipo trae solo lo suyo)", "422|0", estado + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "estado", "estado_nuevo", "Cerrado",
                                                           "po_nuevo", "PO 2", "motivo", "m"), out estado);
            Check("G7 Estado con un PO colado: 422, no se envia", "422|0", estado + "|" + alm.Llamadas.Count);
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos",
                                                           "po_nuevo", new string('x', 256), "motivo", "m"), out estado);
            Check("G8 PO de mas de 255: 422 en po_nuevo", "422|True", estado + "|" + cuerpo.Contains("\"campo\":\"po_nuevo\""));

            var dd = Pendiente("DATOS", MOD);
            dd["cambia_titulo"] = true; dd["titulo_anterior"] = "Titulo iniciativa"; dd["titulo_nuevo"] = "Nuevo titulo";
            dd["cambia_po"] = true; dd["po_anterior"] = "PO 1"; dd["po_nuevo"] = "PO 2";
            dd["cambia_so"] = false; dd["so_anterior"] = null; dd["so_nuevo"] = null;
            dd["actual"] = new Dictionary<string, object> { { "estado", "En Solución" }, { "titulo", "Titulo iniciativa" }, { "po", "PO 1" }, { "so", "SO x" } };
            alm.Detalle_ = dd; alm.Llamadas.Clear(); validaciones.Clear();
            cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5", "folio", "PRB 2026-999999", "codigo", "PRB 2026-999999", "so", "SO colado"), out estado);
            Check("G9 aplicar datos: se valida como la edicion directa con titulo / po (sin so); folio de la SOLICITUD, nada del formulario",
                  "200|Detalle:5,Aplicar:5|PRB 2026-000001|Nuevo titulo|PO 2|null|null",
                  estado + "|" + string.Join(",", alm.Llamadas.ToArray()) + "|" + validaciones[0]["folio"] + "|" + validaciones[0]["titulo"] + "|"
                  + validaciones[0]["po"] + "|" + (validaciones[0]["so"] ?? "null") + "|" + (validaciones[0]["codigo"] ?? "null"));
            Check("G10 datos al dia: no desactualizada", false, SolicitudesCambio.Desactualizada(dd));
            ((Dictionary<string, object>)dd["actual"])["po"] = "PO 3";
            Check("G11 el PO capturado ya cambio: desactualizada", true, SolicitudesCambio.Desactualizada(dd));
            ((Dictionary<string, object>)dd["actual"])["po"] = "PO 1";
            ((Dictionary<string, object>)dd["actual"])["so"] = "Otro SO";
            Check("G12 cambio en un dato que NO se pidio (SO): no desactualizada", false, SolicitudesCambio.Desactualizada(dd));
            dd["cambia_so"] = true; dd["so_nuevo"] = null; dd["so_anterior"] = "SO x";
            Check("G13 SO vacio: ComoModificar manda so = \"\" (vaciar), no lo omite", "True|",
                  (SolicitudesCambio.ComoModificar(dd, null)["so"] != null) + "|" + SolicitudesCambio.ComoModificar(dd, null)["so"]);
            // ...pero una solicitud guardada con un dato pedido y vacio (de antes
            // de que el envio lo rechazara) NUNCA se aplica: dejaria vacio el SO.
            alm.Llamadas.Clear(); validaciones.Clear();
            cuerpo = Correr("POST", "accion=aplicar", ADM, F("id", "5"), out estado);
            Check("G13b aplicar con SO pedido vacio: 422, fallo registrado, ni se valida ni se aplica", "422|Detalle:5,RegistrarFallo:51230|0|True|False",
                  estado + "|" + string.Join(",", alm.Llamadas.ToArray()) + "|" + validaciones.Count + "|" + cuerpo.Contains("Service Owner")
                  + "|" + cuerpo.Contains("\"aplicada\":true"));
            dd["titulo_nuevo"] = "   ";
            Check("G13c DatosVacios: titulo de espacios y SO null pedidos; PO con valor no", "el T\u00edtulo|el Service Owner",
                  string.Join("|", SolicitudesCambio.DatosVacios(dd).ToArray()));
            dd["titulo_nuevo"] = "Nuevo titulo";
            dd["cambia_so"] = false; dd["so_nuevo"] = null; dd["so_anterior"] = null;
            Check("G13d sin datos vacios pedidos: DatosVacios vacio", 0, SolicitudesCambio.DatosVacios(dd).Count);
            dd["cambia_so"] = true; dd["so_nuevo"] = null; dd["so_anterior"] = "SO x";
            var otros = Pendiente("ESTADO", MOD);
            otros["cambia_titulo"] = true; otros["titulo_nuevo"] = "No";
            Check("G14 otro tipo con bandera de datos (no deberia existir: CHECK de sql/25): ComoModificar no la manda", "null",
                  SolicitudesCambio.ComoModificar(otros, null)["titulo"] ?? "null");

            // La validacion REAL de aplicar (sin SQL): ComoModificar ->
            // PeticionModificarAdmin -> ValidadorGestionAdmin con el catalogo.
            var catalogo = new CatalogoSolicitud(new object[] { "PRB" }, new[]
            {
                new CatalogoSolicitud.Asignacion { Po = "PO 1", So = "SO x", Categoria = "/A/Cat 1", Director = "Dir A" },
                new CatalogoSolicitud.Asignacion { Po = "PO 2", So = "SO z", Categoria = "/B/Cat 3", Director = "Dir B" },
            });
            var estados = new EstadosProblem(new[] { "En Solución" }, new string[0], new[] { "Problem" }, new[] { "Problem" });
            var actualIni = IniciativaActual.DesdeRegistro(new Dictionary<string, object>
            {
                { "folio", "PRB 2026-000001" }, { "titulo", "Titulo iniciativa" }, { "titulo_problem", "Titulo iniciativa" },
                { "estado", "En Solución" }, { "po_capturado", "PO 1" }, { "so_capturado", "SO x" }, { "sin_categoria", false },
                { "categorias", new List<object> { new Dictionary<string, object> { { "categoria", "/A/Cat 1" }, { "pct_dism", 0.3 }, { "agrup", "Problem" } } } },
            });
            Func<Dictionary<string, object>, ResultadoGestionAdmin> real = det =>
                new ValidadorGestionAdmin().Modificar(PeticionModificarAdmin.DesdeFormulario(SolicitudesCambio.ComoModificar(det, null)),
                                                      actualIni, new CapacidadCategoria.Compromiso[0], catalogo, estados);
            dd["cambia_so"] = false; dd["so_nuevo"] = null; dd["so_anterior"] = null;
            var sinDuenos = real(dd);
            Check("G15 sin sql/24 (ModificaDuenosYQuita false): el PO pedido NO se aplica (error po); nunca en silencio", "False|po",
                  sinDuenos.Valida + "|" + string.Join(",", sinDuenos.Errores.Select(x => x.Campo ?? "-").ToArray()));
            PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = true;
            try
            {
                var ok = real(dd);
                var plan = PlanificadorGestionAdmin.Modificar(PeticionModificarAdmin.DesdeFormulario(SolicitudesCambio.ComoModificar(dd, null)),
                                                              actualIni, ok, new DateTime(2026, 10, 20));
                Check("G16 con sql/24: titulo y PO del catalogo validan; el plan lleva el Codigo LEIDO y solo titulo / po",
                      "True|PRB 2026-000001|po=PO 2|titulo=Nuevo titulo|0",
                      ok.Valida + "|" + plan.Codigo + "|" + string.Join("|", plan.Problem.OrderBy(x => x.Key, StringComparer.Ordinal)
                          .Select(x => x.Key + "=" + x.Value).ToArray()) + "|" + plan.Pendientes.Count);
                dd["po_nuevo"] = "Alguien Inventado";
                Check("G17 PO que ya no esta en el catalogo AL APLICAR: error po (se valida al aplicar, no solo al enviar)", "False|po",
                      real(dd).Valida + "|" + string.Join(",", real(dd).Errores.Select(x => x.Campo ?? "-").ToArray()));
                dd["po_nuevo"] = "PO 2";
                var dCod = SolicitudesCambio.ComoModificar(dd, null);
                Check("G18 ComoModificar nunca trae 'codigo' (la clave que el validador rechaza)", "null", dCod["codigo"] ?? "null");
            }
            finally { PersistenciaGestionAdmin.ModificaDuenosYQuitaForzadaParaPruebas = null; }
        }
        finally { PersistenciaSolicitudesCambio.SolicitaDatosForzadaParaPruebas = null; }

        // ---- C) tope de 100% por categoria AL ENVIAR ----------------------------
        // La regla de aplicar (TopeModificacion). /T/Cat 1: otras activas 34% +
        // 11.12% = 45.12% (una que no consume no cuenta; la fila de la propia
        // tampoco): cabe hasta 54.88%. /T/Hist: otras 90% (ya excedida con el
        // 30% propio). /T/Req: la propia es ReqOpr (no consume).
        Func<string, string, decimal, bool, CapacidadCategoria.Compromiso> Comp = (folio, ruta, pctC, consume) =>
            new CapacidadCategoria.Compromiso { Folio = folio, Categoria = ruta, Pct = pctC, Consume = consume, Estado = "En Solución" };
        Func<string, string, object[][], IniciativaActual> Ini = (folio, est, cats) => IniciativaActual.DesdeRegistro(new Dictionary<string, object>
        {
            { "folio", folio }, { "titulo", "T" }, { "estado", est }, { "po_capturado", "PO 1" }, { "so_capturado", "SO x" }, { "sin_categoria", false },
            { "categorias", cats.Select(c => (object)new Dictionary<string, object> { { "categoria", c[0] }, { "pct_dism", c[1] }, { "agrup", c[2] } }).ToList() },
        });
        var compromisos = new List<CapacidadCategoria.Compromiso>
        {
            Comp("PRB 2026-000101", "/T/Cat 1", 0.20m, true),     // la propia: no cuenta contra ella
            Comp("PRB 2026-000102", "/T/Cat 1", 0.34m, true),
            Comp("PRB 2026-000103", "/T/Cat 1", 0.1112m, true),
            Comp("PRB 2026-000104", "/T/Cat 1", 0.50m, false),    // cerrada / sin agrupador: no cuenta
            Comp("PRB 2026-000102", "/T/Hist", 0.90m, true),
            Comp("PRB 2026-000102", "/T/Req", 0.95m, true),
            Comp("PRB 2026-000102", "/A/Cat 2", 0.60m, true),
        };
        capacidades["PRB 2026-000101"] = new SolicitudesCambio.DatosCapacidad
        {
            Actual = Ini("PRB 2026-000101", "En Solución", new[] { new object[] { "/T/Cat 1", 0.2, "Problem" }, new object[] { "/T/Hist", 0.3, "Problem" },
                                                                    new object[] { "/T/Req", 0.1, "ReqOpr" } }),
            Compromisos = compromisos,
        };
        capacidades["PRB 2026-000105"] = new SolicitudesCambio.DatosCapacidad
        {
            Actual = Ini("PRB 2026-000105", "Detenido", new[] { new object[] { "/T/Cat 1", 0.6, "Problem" } }), Compromisos = compromisos,
        };
        capacidades["PRB 2026-000001"] = new SolicitudesCambio.DatosCapacidad
        {
            Actual = Ini("PRB 2026-000001", "En Solución", new[] { new object[] { "/A/Cat 1", 0.3, "Problem" } }), Compromisos = compromisos,
        };
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = true;
        PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = true;
        try
        {
            Func<string, string[][]> Pct = v => F("folio", "PRB 2026-000101", "llave", Guid.NewGuid().ToString(), "tipo", "categorias", "motivo", "m",
                                                "pct_categoria", "/T/Cat 1", "pct_valor", v);
            Func<string> Res = () => estado + "|" + cuerpo.Contains("CapacidadExcedida") + "|" + alm.Llamadas.Count(x => x == "Enviar");

            alm.Llamadas.Clear(); leidasCapacidad = 0;
            cuerpo = Correr("POST", "accion=enviar", MOD, Pct("54.88"), out estado);
            Check("C1 dentro del tope (54.88 = 100 - 34 - 11.12; el 20% propio no se suma, el pedido lo reemplaza): 200, se guarda, se leyo la capacidad",
                  "200|False|1|1", Res() + "|" + leidasCapacidad);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, Pct("54.89"), out estado);
            Check("C2 54.89: 422 CapacidadExcedida, enviada false, NO se guarda", "422|True|0|True", Res() + "|" + cuerpo.Contains("\"enviada\":false"));
            Check("C2 ... mensaje accionable con el disponible, campo categoria", "True|True",
                  cuerpo.Contains("/T/Cat 1: solo tiene 54.88% disponible sin contar esta iniciativa") + "|" + cuerpo.Contains("\"campo\":\"categoria\""));
            cuerpo = Correr("POST", "accion=enviar", MOD, Pct("100"), out estado);
            Check("C3 100%: 422, no se guarda", "422|True|0", Res());

            // Misma regla y mismo mensaje que aplicar (ValidadorGestionAdmin.Modificar).
            var fmTope = new NameValueCollection { { "accion", "modificar" }, { PeticionModificarAdmin.CFolio, "PRB 2026-000101" },
                                               { PeticionModificarAdmin.CPctCategoria, "/T/Cat 1" }, { PeticionModificarAdmin.CPctValor, "54.89" } };
            var alAplicar = new ValidadorGestionAdmin().Modificar(PeticionModificarAdmin.DesdeFormulario(fmTope), capacidades["PRB 2026-000101"].Actual, compromisos);
            var alEnviar = SolicitudesCambio.ErroresCapacidad(PeticionSolicitudCambio.DesdeFormulario(new NameValueCollection
                { { "folio", "PRB 2026-000101" }, { "llave", Llave }, { "tipo", "categorias" }, { "motivo", "m" },
                  { "pct_categoria", "/T/Cat 1" }, { "pct_valor", "54.89" } }), capacidades["PRB 2026-000101"]);
            Check("C4 el envio y aplicar dan el MISMO motivo", "True|" + string.Join(" ", alEnviar.ToArray()),
                  (!alAplicar.Valida) + "|" + string.Join(" ", alAplicar.Errores.Where(x => x.Campo == "pct").Select(x => x.Mensaje).ToArray()));

            foreach (var caso in new[] { new[] { "25", "200|False|1" }, new[] { "30", "200|False|1" }, new[] { "31", "422|True|0" } })
            {
                alm.Llamadas.Clear();
                cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000101", "llave", Guid.NewGuid().ToString(), "tipo", "categorias", "motivo", "m",
                    "pct_categoria", "/T/Hist", "pct_valor", caso[0]), out estado);
                Check("C5 ruta ya excedida (90% otras + 30% propio): " + caso[0] + "% -> " + caso[1] + " (bajar o dejar igual si; subir no)", caso[1], Res());
            }
            Check("C5 ... el mensaje da lo disponible (10%) sin contar el 30% propio", true, cuerpo.Contains("/T/Hist: solo tiene 10% disponible sin contar esta iniciativa"));
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000101", "llave", Guid.NewGuid().ToString(), "tipo", "categorias", "motivo", "m",
                "pct_categoria", "/T/Req", "pct_valor", "100"), out estado);
            Check("C6 fila ReqOpr (no consume): sin tope, 200", "200|False|1", Res());

            // Por agregar: la Agrupacion del prefijo (PRB -> Problem) consume.
            foreach (var caso in new[] { new[] { "40", "200|False|1" }, new[] { "40.01", "422|True|0" } })
            {
                alm.Llamadas.Clear();
                cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Guid.NewGuid().ToString(), "tipo", "categorias", "motivo", "m",
                    "agregar_categoria", "/A/Cat 2", "agregar_pct", caso[0]), out estado);
                Check("C7 agregar /A/Cat 2 (otras 60%): " + caso[0] + "% -> " + caso[1], caso[1], Res());
            }

            // Estado: reactivar cuenta el % actual de sus ligadas.
            Func<string, string, string[][]> Est = (folio, en) => F("folio", folio, "llave", Guid.NewGuid().ToString(), "tipo", "estado", "estado_nuevo", en, "motivo", "m");
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, Est("PRB 2026-000105", "En Análisis"), out estado);
            Check("C8 Detenido -> En Analisis con 60% en /T/Cat 1 (otras 65.12%, aqui la 000101 tambien es otra): 422, no se guarda", "422|True|0|True",
                  Res() + "|" + cuerpo.Contains("solo tiene 34.88% disponible"));
            cuerpo = Correr("POST", "accion=enviar", MOD, Est("PRB 2026-000105", "Cerrado"), out estado);
            Check("C9 Detenido -> Cerrado (no vivo): sin tope, 200", "200|False|1", Res());
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, Est("PRB 2026-000101", "En Monitoreo"), out estado);
            Check("C10 Estado vivo -> vivo sin categorias: nada que reactivar, 200", "200|False|1", Res());

            // Varios: el Estado final de la MISMA solicitud decide.
            Func<string, string, string[][]> Var = (en, v) => F("folio", "PRB 2026-000101", "llave", Guid.NewGuid().ToString(), "tipo", "varios", "motivo", "m",
                "estado_nuevo", en, "pct_categoria", "/T/Cat 1", "pct_valor", v);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, Var("En Monitoreo", "100"), out estado);
            Check("C11 varios (Estado vivo + 100% en /T/Cat 1): 422, no se guarda", "422|True|0", Res());
            cuerpo = Correr("POST", "accion=enviar", MOD, Var("Cerrado", "100"), out estado);
            Check("C12 varios (Cerrado + 100%): la iniciativa deja de consumir, 200", "200|False|1", Res());
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000105", "llave", Guid.NewGuid().ToString(), "tipo", "varios", "motivo", "m",
                "estado_nuevo", "En Solución", "f_cierre_nueva", "2026-12-31"), out estado);
            Check("C13 varios que reactiva (con una fecha): 422, no se guarda", "422|True|0", Res());

            // Sin poder leer la capacidad: 503, nada se guarda.
            capacidadFalla = true;
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", MOD, Pct("10"), out estado);
            Check("C14 lectura de capacidad falla: 503 CapacidadNoDisponible, enviada false, no se guarda", "503|True|True|0",
                  estado + "|" + cuerpo.Contains("CapacidadNoDisponible") + "|" + cuerpo.Contains("\"enviada\":false") + "|" + alm.Llamadas.Count(x => x == "Enviar"));
            leidasCapacidad = 0;
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000101", "llave", Guid.NewGuid().ToString(), "tipo", "fecha",
                "campo_fecha", "f_cierre", "fecha_nueva", "2026-12-31", "motivo", "m"), out estado);
            Check("C15 fecha (no toca la capacidad): ni la lee, 200 aunque la lectura falle", "200|0", estado + "|" + leidasCapacidad);
            cuerpo = Correr("POST", "accion=enviar", MOD, Pct("101"), out estado);
            Check("C16 formato invalido: 422 ValidacionFallida antes de leer la capacidad", "422|True|0",
                  estado + "|" + cuerpo.Contains("ValidacionFallida") + "|" + leidasCapacidad);
            capacidadFalla = false;
        }
        finally
        {
            PersistenciaSolicitudesCambio.ForzadaParaPruebas = null;
            PersistenciaSolicitudesCambio.SolicitaVariosForzadaParaPruebas = null;
        }

        // ---------------- P: "Solicitar cambios" del PO / SO (sql/37, PSO) ----------------
        // 000001: PO "PO 1" / SO "SO x"; 000003: PO "PO X" / SO "SO x";
        // 000002: sin capturar (DuenosCapturados de arriba).
        const string PO1 = @"SORIANA\t_po1", SOX = @"SORIANA\t_sox", POX = @"SORIANA\t_pox", COMUN = @"SORIANA\t_comun",
                     AMB = @"SORIANA\t_amb", REP = @"SORIANA\t_rep", ADMPO = @"SORIANA\t_admpo";
        var duenosPso = new DuenosPso()
            .Persona("PO 1", "t_po1@soriana.com").Persona("SO  X", " T_SOX@Soriana.com ").Persona("PO X", "t_pox@soriana.com")
            .Persona("Comun", "t_comun@soriana.com")
            .Persona("Amb Uno", "t_amb@soriana.com").Persona("Amb Dos", "t_amb@soriana.com")
            .Persona("Rep", "t_rep@soriana.com").Persona("REP", "rep.otro@soriana.com")
            .Persona("Adm Po", "t_admpo@soriana.com")
            .Persona("So Equipo", "t_soeq@soriana.com").Persona("So Baja", "t_sobaja@soriana.com")
            .Fila("PO 1", "SO x").Fila("PO X", "SO x").Fila("Amb Uno", "Rep").Fila("Adm Po", "SO x")
            // sql/38: "So Equipo" es SO de PO X en OTRA categoria; "So Baja" solo
            // en una fila NO vigente de PO 1.
            .FilaEn("/B/Equipo", "po  x", "So Equipo", true).FilaEn("/B/Baja", "PO 1", "So Baja", false);
        const string SOEQ = @"SORIANA\t_soeq", SOBAJA = @"SORIANA\t_sobaja";
        AccesoIniciativas.FuenteDuenos = duenosPso;
        AccesoAdmin.FuenteRoles = new RolesFalsos().Con(ADM, "ADM").Con(MOD, "MOD").Con(ADMPO, "ADM");
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = true;
        PersistenciaSolicitudesCambio.SolicitaPsoForzadaParaPruebas = true;
        capacidades.Clear();
        Func<string, string, string[][]> envio = delegate (string folio, string extra)
        {
            var kv = new List<string> { "folio", folio, "llave", Guid.NewGuid().ToString(), "tipo", "estado", "estado_nuevo", "En Monitoreo",
                                        "campo_fecha", "f_solucion", "fecha_nueva", "2026-12-05", "motivo", "m" };
            if (extra == "forja") kv.AddRange(new[] { "rol", "ADM", "rol_solicitante", "ADM", "usuario", ADM, "solicitado_por", ADM, "pso", "0" });
            if (extra == "subestado") kv.AddRange(new[] { "subestado_nuevo", "X" });
            return F(kv.ToArray());
        };
        Func<string> enviados = delegate { return alm.Llamadas.Count(x => x == "Enviar").ToString(); };
        try
        {
            alm.Llamadas.Clear(); duenosPso.Lecturas = 0;
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", null), out estado);
            Check("P1 PO de la iniciativa: 200, firma su cuenta con rol PSO puesto por el servidor; CatPersona leida UNA vez",
                  "200|1|" + PO1 + "|PSO|1", estado + "|" + enviados() + "|" + alm.UltimoUsuario + "|" + alm.UltimoRol + "|" + duenosPso.Lecturas);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", SOX, envio("PRB 2026-000001", null), out estado);
            Check("P2 SO (nombre con otra grafia y correo con mayusculas/espacios): 200 PSO", "200|1|PSO", estado + "|" + enviados() + "|" + alm.UltimoRol);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", "forja"), out estado);
            Check("P3 rol / usuario / solicitante forjados en el formulario: se ignoran (PSO, su cuenta)", "200|PSO|" + PO1,
                  estado + "|" + alm.UltimoRol + "|" + alm.UltimoUsuario);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", POX, envio("PRB 2026-000001", null), out estado);
            Check("P4 PO/SO vigente de OTRA iniciativa: 403 NoEsDueno, nada se guarda", "403|True|True|0",
                  estado + "|" + cuerpo.Contains("NoEsDueno") + "|" + cuerpo.Contains("\"enviada\":false") + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000002", null), out estado);
            Check("P5 iniciativa sin PO / SO capturados (o que no existe): 403 NoEsDueno", "403|True|0", estado + "|" + cuerpo.Contains("NoEsDueno") + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", COMUN, envio("PRB 2026-000001", null), out estado);
            Check("P6 en CatPersona sin ser PO/SO vigente: 403 AccesoDenegado", "403|True|0", estado + "|" + cuerpo.Contains("AccesoDenegado") + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", AMB, envio("PRB 2026-000001", null), out estado);
            Check("P7 correo en DOS personas (ambiguo): 403, nada se guarda", "403|0", estado + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", REP, envio("PRB 2026-000001", null), out estado);
            Check("P8 nombre repetido en CatPersona: 403, nada se guarda", "403|0", estado + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", @"SORIANA\nadie", envio("PRB 2026-000001", null), out estado);
            Check("P9 cuenta fuera de CatPersona: 403", "403|0", estado + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", "", envio("PRB 2026-000001", null), out estado);
            Check("P10 anonimo: 403", "403|0", estado + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", "subestado"), out estado);
            Check("P11 PSO pidiendo Subestado: 422 en subestado_nuevo, nada se guarda", "422|True|0", estado + "|" + cuerpo.Contains("subestado_nuevo") + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", PO1, F("llave", Guid.NewGuid().ToString(), "tipo", "estado", "estado_nuevo", "X", "motivo", "m"), out estado);
            Check("P12 sin folio: 422, nada se guarda", "422|0", estado + "|" + enviados());
            foreach (var q in new[] { "accion=listar", "accion=detalle&id=5", "accion=aplicar", "accion=rechazar" })
            {
                alm.Llamadas.Clear();
                cuerpo = Correr(q.StartsWith("accion=listar") || q.StartsWith("accion=detalle") ? "GET" : "POST", q, PO1, F("id", "5", "comentario", "x"), out estado);
                Check("P13 PO en " + q + ": 403 y el almacen ni se toca", "403|0", estado + "|" + alm.Llamadas.Count);
            }
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", ADMPO, envio("PRB 2026-000003", null), out estado);
            Check("P14 ADM que tambien es PO: sigue como ADM (no PSO), aun en una iniciativa que no es suya", "200|ADM", estado + "|" + alm.UltimoRol);
            cuerpo = Correr("POST", "accion=enviar", MOD, envio("PRB 2026-000003", null), out estado);
            Check("P15 MOD igual que antes", "200|MOD", estado + "|" + alm.UltimoRol);

            alm.Llamadas.Clear();
            alm.LanzarAlEnviar = new ErrorSolicitudCambio(51226, "La cuenta no es el Product Owner ni el Service Owner de la iniciativa.", null);
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", null), out estado);
            Check("P16 la base re-chequea (51226, el dueno cambio en medio): 403 NoEsDueno, enviada false", "403|True|True",
                  estado + "|" + cuerpo.Contains("NoEsDueno") + "|" + cuerpo.Contains("\"enviada\":false"));
            alm.LanzarAlEnviar = new ErrorSolicitudCambio(51225, "El folio no identifica una sola iniciativa.", null);
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", null), out estado);
            Check("P17 51225 de la base: 404 IniciativaNoExiste", "404|True", estado + "|" + cuerpo.Contains("IniciativaNoExiste"));
            alm.LanzarAlEnviar = null;

            var leerDuenos = SolicitudesCambio.DuenosCapturados;
            SolicitudesCambio.DuenosCapturados = delegate (string f) { throw new InvalidOperationException("sin conexion"); };
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", null), out estado);
            Check("P18 no se pueden leer los duenos del folio: 503 DuenosNoDisponibles, nada se guarda", "503|True|0",
                  estado + "|" + cuerpo.Contains("DuenosNoDisponibles") + "|" + enviados());
            SolicitudesCambio.DuenosCapturados = leerDuenos;

            PersistenciaSolicitudesCambio.SolicitaPsoForzadaParaPruebas = false;
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", null), out estado);
            Check("P19 sin sql/37: 403 (dice que falta sql/37), nada se guarda; ADM sigue", "403|True|0|200",
                  estado + "|" + cuerpo.Contains("sql/37") + "|" + enviados() + "|" +
                  (Correr("POST", "accion=enviar", ADM, envio("PRB 2026-000001", null), out estado) != null ? estado.ToString() : ""));
            PersistenciaSolicitudesCambio.SolicitaPsoForzadaParaPruebas = true;

            duenosPso.Lanza = true;
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", PO1, envio("PRB 2026-000001", null), out estado);
            Check("P20 CatPersona no se puede leer: no pasa (falla cerrado), nada se guarda", "403|0", estado + "|" + enviados());
            duenosPso.Lanza = false;

            // La regla sin HttpContext (lo que el handler ya filtro antes).
            var personas = duenosPso.Leer().Personas;
            Func<string, string[]> d1 = delegate (string f) { return new[] { "PO 1", "SO x" }; };
            Check("P21 Evaluar: ambiguo / nombre repetido aun con motivo null: 403 IdentidadNoResuelta", "IdentidadNoResuelta|IdentidadNoResuelta",
                  SolicitudCambioPso.Evaluar(IdentidadWindows.Desde(AMB, true), true, null, personas, "F", d1).Tipo + "|" +
                  SolicitudCambioPso.Evaluar(IdentidadWindows.Desde(REP, true), true, null, personas, "F", d1).Tipo);
            Check("P22 Evaluar: dueno con mayusculas, acentos y espacios de mas en dbo.Problem: puede", "True",
                  SolicitudCambioPso.Evaluar(IdentidadWindows.Desde(PO1, true), true, null, personas, "F",
                                             delegate (string f) { return new[] { "  po\u00a01 ", null }; }).Puede);
            var filas = new List<object>
            {
                new Dictionary<string, object> { { "folio", "A" }, { "po_capturado", "PO 1" }, { "so_capturado", "Otro" } },
                new Dictionary<string, object> { { "folio", "B" }, { "po_capturado", "Otro" }, { "so_capturado", "po 1" } },
                new Dictionary<string, object> { { "folio", "C" }, { "po_capturado", "PO X" }, { "so_capturado", null } },
            };
            Check("P23 FoliosPropios (boton del registro): solo las suyas; ambiguo: ninguna", "A,B|",
                  string.Join(",", SolicitudCambioPso.FoliosPropios(IdentidadWindows.Desde(PO1, true), personas, filas)) + "|" +
                  string.Join(",", SolicitudCambioPso.FoliosPropios(IdentidadWindows.Desde(AMB, true), personas, filas)));
            // ---- Q: sql/38, el SO del equipo del PO de la iniciativa ----
            PersistenciaSolicitudesCambio.SolicitaPsoEquipoForzadaParaPruebas = false;
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", SOEQ, envio("PRB 2026-000003", null), out estado);
            Check("Q1 SO del equipo de PO X sin sql/38: 403 NoEsDueno (regla de sql/37), nada se guarda", "403|True|True|0",
                  estado + "|" + cuerpo.Contains("NoEsDueno") + "|" + cuerpo.Contains("Service Owner capturado de esta") + "|" + enviados());
            PersistenciaSolicitudesCambio.SolicitaPsoEquipoForzadaParaPruebas = true;
            cuerpo = Correr("POST", "accion=enviar", SOEQ, envio("PRB 2026-000003", null), out estado);
            Check("Q2 con sql/38: el SO del equipo del PO (otra categoria, PO con otra grafia) guarda como PSO con su cuenta", "200|1|PSO|" + SOEQ,
                  estado + "|" + enviados() + "|" + alm.UltimoRol + "|" + alm.UltimoUsuario);
            alm.Llamadas.Clear();
            cuerpo = Correr("POST", "accion=enviar", SOEQ, envio("PRB 2026-000001", null), out estado);
            Check("Q3 con sql/38, iniciativa de OTRO PO: 403 NoEsDueno con el aviso del equipo", "403|True|True|0",
                  estado + "|" + cuerpo.Contains("NoEsDueno") + "|" + cuerpo.Contains("un Service Owner de ese Product Owner") + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", SOEQ, envio("PRB 2026-000002", null), out estado);
            Check("Q4 con sql/38, iniciativa sin PO capturado: 403", "403|0", estado + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", SOBAJA, envio("PRB 2026-000001", null), out estado);
            Check("Q5 SO solo en una fila NO vigente del PO: 403, nada se guarda", "403|0", estado + "|" + enviados());
            cuerpo = Correr("POST", "accion=enviar", SOEQ, envio("PRB 2026-000003", "forja"), out estado);
            Check("Q6 SO del equipo con rol forjado: PSO igual", "200|PSO|" + SOEQ, estado + "|" + alm.UltimoRol + "|" + alm.UltimoUsuario);
            var dir = duenosPso.Leer().Directorio;
            Check("Q7 FoliosPropios: con el equipo, la de su PO (C); sin el equipo, ninguna; el PO / SO capturado no cambia", "C||A,B",
                  string.Join(",", SolicitudCambioPso.FoliosPropios(IdentidadWindows.Desde(SOEQ, true), personas, filas, dir)) + "|" +
                  string.Join(",", SolicitudCambioPso.FoliosPropios(IdentidadWindows.Desde(SOEQ, true), personas, filas, null)) + "|" +
                  string.Join(",", SolicitudCambioPso.FoliosPropios(IdentidadWindows.Desde(PO1, true), personas, filas, dir)));
            Check("Q8 PoDeMiEquipo: solo filas vigentes donde es SO", "1|0",
                  SolicitudCambioPso.PoDeMiEquipo(IdentidadAcuse.Resolver(IdentidadWindows.Desde(SOEQ, true), personas), dir).Count + "|" +
                  SolicitudCambioPso.PoDeMiEquipo(IdentidadAcuse.Resolver(IdentidadWindows.Desde(SOBAJA, true), personas), dir).Count);
            PersistenciaSolicitudesCambio.SolicitaPsoEquipoForzadaParaPruebas = null;
            var reg = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_registro.ashx"));
            var sol = File.ReadAllText(Path.Combine("handlers", "admin_iniciativas_solicitudes.ashx"));
            Check("Q9 el directorio del equipo solo va con sql/38 (registro y envio)", "True|True",
                  reg.Contains("PersistenciaSolicitudesCambio.SolicitaPsoEquipoActiva() ? lectura.Directorio : null") + "|" +
                  sol.Contains("PersistenciaSolicitudesCambio.SolicitaPsoEquipoActiva() ? lectura.Directorio : null"));
            Check("P24 el registro manda cambios_pso (FoliosPso: vacio para ADM / MOD, sin sql/37 o sin ser PO/SO)", "True|True",
                  reg.Contains("registro[\"cambios_pso\"] = FoliosPso(context, registro);") + "|" +
                  reg.Contains("RolAdmin.EsElevado(AccesoAdmin.Rol(context)) || !PersistenciaSolicitudesCambio.SolicitaPsoActiva()"));
        }
        finally
        {
            PersistenciaSolicitudesCambio.ForzadaParaPruebas = null;
            PersistenciaSolicitudesCambio.SolicitaPsoForzadaParaPruebas = null;
            PersistenciaSolicitudesCambio.SolicitaPsoEquipoForzadaParaPruebas = null;
            alm.LanzarAlEnviar = null;
        }

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
