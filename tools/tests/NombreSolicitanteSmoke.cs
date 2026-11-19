// Prueba de humo SIN SQL de App_Code/NombreSolicitante.cs: como se MUESTRA a
// quien envio una solicitud en las colas de ADM y en "Mis solicitudes"
// (cambios e iniciativas), con UsuariosAdmin y CatPersona falsos.
//
//   N  regla: NombreSolicitante con valor / NULL / vacio / solo espacios /
//      dos distintos en la misma cuenta; el nombre verificado (CatPersona o
//      el guardado) despues; correo de UsuariosAdmin o el verificado; la
//      cuenta al final.
//   K  por cuenta, nunca por nombre: mayusculas y espacios de la cuenta;
//      dos cuentas con nombres parecidos no se mezclan; UsuariosAdmin caido.
//   H  handlers: cola de ADM y Mis solicitudes de cambio; registro de ADM y
//      Mis solicitudes de iniciativa. solicitado_por / solicitante_cuenta no
//      cambian (la cuenta sigue siendo la llave).
//   G  cualquier cuenta (2026-11-05): revisor, quien cancelo, eventos,
//      Historial de peticiones, Cambios recientes, historial de fechas.
//      Capturado / CatPersona / guardado / correo / cuenta; nombres en
//      conflicto; lotes (una lectura); ADM y no ADM; cada evento con SU cuenta.
//
// Compilar y correr desde la raiz del repo (como SolicitudesCambioHttpSmoke):
//   csc /out:NombreSolicitanteSmoke.exe /r:adm.dll /r:hnd.dll /r:System.dll /r:System.Core.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll tools\tests\NombreSolicitanteSmoke.cs
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Web;
using System.Web.Script.Serialization;

sealed class FichasFalsas : IFuenteFichasUsuariosAdmin
{
    public readonly List<string[]> Filas = new List<string[]>();   // { Usuario, CorreoUsuario, NombreSolicitante }
    public readonly List<string> Pedidas = new List<string>();
    public bool Lanza;
    public FichasFalsas Fila(string usuario, string correo, string nombre) { Filas.Add(new[] { usuario, correo, nombre }); return this; }
    public Dictionary<string, FichaUsuarioAdmin> Leer(ICollection<string> claves)
    {
        Pedidas.AddRange(claves);
        if (Lanza) throw new InvalidOperationException("UsuariosAdmin no se pudo leer");
        var d = new Dictionary<string, FichaUsuarioAdmin>(StringComparer.Ordinal);
        foreach (var f in Filas)
        {
            // Como el SQL: UPPER(LTRIM(RTRIM(Usuario))) IN (claves).
            var k = NombreSolicitante.Clave(f[0]);
            if (k == null || !claves.Contains(k)) continue;
            FichaUsuarioAdmin x;
            if (!d.TryGetValue(k, out x)) d[k] = x = new FichaUsuarioAdmin();
            x.Correos.Add(f[1]); x.Nombres.Add(f[2]);
        }
        return d;
    }
}

sealed class RolesNombreFalsos : IFuenteRolesAdmin
{
    public readonly Dictionary<string, string[]> Filas = new Dictionary<string, string[]>();
    public RolesNombreFalsos Con(string cuenta, params string[] a) { Filas[cuenta.Trim().ToUpperInvariant()] = a; return this; }
    public IList<string> AccesosDe(string cuenta) { string[] f; return Filas.TryGetValue(cuenta.Trim().ToUpperInvariant(), out f) ? f : new string[0]; }
}

sealed class AlmacenNombreFalso : IAlmacenSolicitudesCambio
{
    public List<Dictionary<string, object>> Lista_ = new List<Dictionary<string, object>>();
    public ResultadoEnvioSolicitud Enviar(PeticionSolicitudCambio p, string u, string r) { throw new NotSupportedException(); }
    public List<Dictionary<string, object>> Listar(string estado, int maximo) { return Lista_.Select(x => new Dictionary<string, object>(x)).ToList(); }
    public Dictionary<string, object> Detalle(int id) { var f = Lista_.FirstOrDefault(x => (int)x["id"] == id); return f == null ? null : new Dictionary<string, object>(f); }
    public void Rechazar(int id, string r, string c) { throw new NotSupportedException(); }
    public void Aplicar(int id, string r, string c, List<ClasificacionSolicitud> cls, DateTime hoy) { throw new NotSupportedException(); }
    public void RegistrarFallo(int id, string r, int n, string m) { throw new NotSupportedException(); }
}

sealed class MiasNombreFalsas : ILectorMisSolicitudesCambio
{
    public List<Dictionary<string, object>> Lista_ = new List<Dictionary<string, object>>();
    public List<Dictionary<string, object>> ListarDe(string cuenta, string estado, int maximo)
    {
        return Lista_.Where(x => string.Equals((string)x["solicitado_por"], cuenta, StringComparison.OrdinalIgnoreCase)).Select(x => new Dictionary<string, object>(x)).ToList();
    }
    public Dictionary<string, object> DetalleDe(int id, string cuenta)
    {
        var f = Lista_.FirstOrDefault(x => (int)x["id"] == id && string.Equals((string)x["solicitado_por"], cuenta, StringComparison.OrdinalIgnoreCase));
        return f == null ? null : new Dictionary<string, object>(f);
    }
}

sealed class LectorNombreFalso : ILectorSolicitudesIniciativa, ILectorMisSolicitudesIniciativa
{
    public List<Dictionary<string, object>> Todas = new List<Dictionary<string, object>>();
    public bool Disponible() { return true; }
    public LecturaSolicitudesIniciativa Listar(int maximo, string estado)
    {
        var l = new LecturaSolicitudesIniciativa();
        l.Solicitudes.AddRange(Todas.Select(x => new Dictionary<string, object>(x)));
        return l;
    }
    public Dictionary<string, object> Detalle(int n) { var f = Todas.FirstOrDefault(x => (int)x["numero"] == n); return f == null ? null : new Dictionary<string, object>(f); }
    public LecturaSolicitudesIniciativa ListarDe(string cuenta, int maximo, string estado)
    {
        var l = new LecturaSolicitudesIniciativa();
        l.Solicitudes.AddRange(Todas.Where(x => string.Equals((string)x["solicitante_cuenta"], cuenta, StringComparison.OrdinalIgnoreCase)).Select(x => new Dictionary<string, object>(x)));
        return l;
    }
    public Dictionary<string, object> DetalleDe(int n, string cuenta)
    {
        var f = Todas.FirstOrDefault(x => (int)x["numero"] == n && string.Equals((string)x["solicitante_cuenta"], cuenta, StringComparison.OrdinalIgnoreCase));
        return f == null ? null : new Dictionary<string, object>(f);
    }
}

public static class NombreSolicitanteSmoke
{
    static int fallos = 0, pasados = 0;
    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static void CabeceraNavegador(HttpRequest req, string nombre, string valor)
    {
        var h = req.Headers;
        var t = typeof(NameObjectCollectionBase);
        var f = BindingFlags.NonPublic | BindingFlags.Instance;
        var ro = t.GetProperty("IsReadOnly", f);
        ro.SetValue(h, false, null);
        t.GetMethod("BaseSet", f, null, new[] { typeof(string), typeof(object) }, null).Invoke(h, new object[] { nombre, new System.Collections.ArrayList { valor } });
        ro.SetValue(h, true, null);
    }

    static Dictionary<string, object> Correr(IHttpHandler h, string archivo, string query, string cuenta, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest(archivo, "http://localhost/handlers/" + archivo, query ?? ""), new HttpResponse(sw));
        ctx.User = new GenericPrincipal(new GenericIdentity(cuenta, "Negotiate"), new string[0]);
        HttpContext.Current = ctx;
        typeof(HttpRequest).GetField("_httpMethod", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(ctx.Request, "GET");
        CabeceraNavegador(ctx.Request, "Sec-Fetch-Site", "same-origin");
        h.ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        HttpContext.Current = null;
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(sw.ToString()); }
        catch { return new Dictionary<string, object> { { "crudo", sw.ToString() } }; }
    }

    static string Ver(SolicitanteVisible v) { return v.Fuente + ":" + v.Texto; }
    static FichaUsuarioAdmin Ficha(params string[] correoNombre)
    {
        var f = new FichaUsuarioAdmin();
        for (var i = 0; i < correoNombre.Length; i += 2) { f.Correos.Add(correoNombre[i]); f.Nombres.Add(correoNombre[i + 1]); }
        return f;
    }

    const string ADM = @"SORIANA\t_adm";
    const string MIGUEL = @"SORIANA\miguel.lopez";     // MOD sin CatPersona, nombre capturado a mano
    const string MIGUEL2 = @"SORIANA\miguel.lopezm";   // otra cuenta, nombre parecido
    const string SINNOMBRE = @"SORIANA\t_sinnombre";  // MOD con correo pero sin nombre
    const string NADA = @"SORIANA\t_nada";            // ni UsuariosAdmin ni CatPersona
    const string PO = @"SORIANA\juanperez";           // PO en CatPersona, no en UsuariosAdmin

    public static int Main()
    {
        // ---------------- N: la regla ----------------
        Check("N1 nombre capturado: gana (antes que CatPersona y el correo)", "NOMBRE_ADMIN:Miguel Lopez Ruiz",
              Ver(NombreSolicitante.Elegir(MIGUEL, Ficha("miguel@soriana.com", "  Miguel Lopez Ruiz "), "Otro De CatPersona", "x@soriana.com")));
        Check("N2 nombre NULL: el verificado (CatPersona / guardado)", "NOMBRE_VERIFICADO:Juan Perez",
              Ver(NombreSolicitante.Elegir(PO, Ficha("jp@soriana.com", null), "Juan Perez", "jp@soriana.com")));
        Check("N3 nombre vacio: no cuenta, sigue el correo de UsuariosAdmin", "CORREO:sinnombre@soriana.com",
              Ver(NombreSolicitante.Elegir(SINNOMBRE, Ficha("sinnombre@soriana.com", ""), null, null)));
        Check("N4 nombre solo espacios / tabuladores: no cuenta", "CORREO:sinnombre@soriana.com",
              Ver(NombreSolicitante.Elegir(SINNOMBRE, Ficha(" SinNombre@Soriana.com ", " \t "), null, null)).Replace("SinNombre@Soriana.com", "sinnombre@soriana.com"));
        Check("N5 sin nombre ni correo en UsuariosAdmin: el correo verificado", "CORREO:t_nada@soriana.com",
              Ver(NombreSolicitante.Elegir(NADA, null, null, "t_nada@soriana.com")));
        Check("N6 sin nombre ni correo: la cuenta", "CUENTA:" + NADA, Ver(NombreSolicitante.Elegir("  " + NADA + " ", null, null, null)));
        Check("N7 correo que no es correo: no cuenta (cuenta)", "CUENTA:" + NADA, Ver(NombreSolicitante.Elegir(NADA, Ficha("no es correo", null), null, "tampoco")));
        Check("N8 dos nombres DISTINTOS en filas de la misma cuenta: ninguno (como sql/36 51418)", "CORREO:miguel@soriana.com",
              Ver(NombreSolicitante.Elegir(MIGUEL, Ficha("miguel@soriana.com", "Miguel Lopez", "miguel@soriana.com", "Miguel Ruiz"), null, null)));
        Check("N9 el mismo nombre con otra grafia en dos filas: uno solo", "NOMBRE_ADMIN:Miguel López",
              Ver(NombreSolicitante.Elegir(MIGUEL, Ficha("miguel@soriana.com", "Miguel López", "miguel@soriana.com", " MIGUEL  LOPEZ "), null, null)));
        Check("N10 dos correos distintos en UsuariosAdmin: no se elige uno (sigue el verificado)", "CORREO:verif@soriana.com",
              Ver(NombreSolicitante.Elegir(MIGUEL, Ficha("a@soriana.com", null, "b@soriana.com", null), null, "verif@soriana.com")));
        Check("N11 sin cuenta: nada", ":", Ver(NombreSolicitante.Elegir("  ", null, null, null)));

        // ---------------- K: por cuenta ----------------
        var fichas = new FichasFalsas()
            .Fila("  soriana\\MIGUEL.LOPEZ ", "miguel@soriana.com", "Miguel Lopez Ruiz")   // mayusculas y espacios distintos
            .Fila(MIGUEL2, "miguel.m@soriana.com", "Miguel Lopez Martinez")
            .Fila(SINNOMBRE, "sinnombre@soriana.com", null)
            .Fila(ADM, "adm@soriana.com", "   ");
        NombreSolicitante.Fuente = fichas;
        var filas = new List<Dictionary<string, object>>
        {
            new Dictionary<string, object> { { "solicitante_cuenta", "SORIANA\\Miguel.Lopez" }, { "solicitante_nombre", null }, { "solicitante_correo", "miguel@soriana.com" } },
            new Dictionary<string, object> { { "solicitante_cuenta", MIGUEL2 }, { "solicitante_nombre", null }, { "solicitante_correo", null } },
            new Dictionary<string, object> { { "solicitante_cuenta", SINNOMBRE }, { "solicitante_nombre", null }, { "solicitante_correo", null } },
            new Dictionary<string, object> { { "solicitante_cuenta", PO }, { "solicitante_nombre", "Juan Perez" }, { "solicitante_correo", "juanperez@soriana.com" } },
            new Dictionary<string, object> { { "solicitante_cuenta", NADA }, { "solicitante_nombre", null }, { "solicitante_correo", null } },
            new Dictionary<string, object> { { "solicitante_cuenta", ADM }, { "solicitante_nombre", null }, { "solicitante_correo", null } },
        };
        NombreSolicitante.AgregarIniciativas(filas);
        Check("K1 la cuenta se compara sin mayusculas ni espacios de mas (como SolicitadoPor / sql/36)", "Miguel Lopez Ruiz|NOMBRE_ADMIN",
              filas[0]["solicitante_mostrar"] + "|" + filas[0]["solicitante_mostrar_fuente"]);
        Check("K2 dos cuentas con nombres parecidos: cada una el SUYO (por cuenta, nunca por nombre)", "Miguel Lopez Ruiz|Miguel Lopez Martinez",
              filas[0]["solicitante_mostrar"] + "|" + filas[1]["solicitante_mostrar"]);
        Check("K3 MOD sin nombre: su correo de UsuariosAdmin", "sinnombre@soriana.com|CORREO", filas[2]["solicitante_mostrar"] + "|" + filas[2]["solicitante_mostrar_fuente"]);
        Check("K4 PO en CatPersona, no en UsuariosAdmin: conserva el nombre guardado", "Juan Perez|NOMBRE_VERIFICADO", filas[3]["solicitante_mostrar"] + "|" + filas[3]["solicitante_mostrar_fuente"]);
        Check("K5 sin nada: la cuenta", NADA + "|CUENTA", filas[4]["solicitante_mostrar"] + "|" + filas[4]["solicitante_mostrar_fuente"]);
        Check("K6 nombre de solo espacios en UsuariosAdmin: su correo", "adm@soriana.com", filas[5]["solicitante_mostrar"]);
        Check("K7 la cuenta y lo guardado NO cambian", "SORIANA\\Miguel.Lopez||miguel@soriana.com",
              filas[0]["solicitante_cuenta"] + "|" + filas[0]["solicitante_nombre"] + "|" + filas[0]["solicitante_correo"]);
        Check("K8 UNA lectura de UsuariosAdmin por lista, con las cuentas normalizadas y sin repetir", "6|True",
              fichas.Pedidas.Count + "|" + fichas.Pedidas.Contains(@"SORIANA\MIGUEL.LOPEZ"));
        fichas.Lanza = true;
        var caida = new List<Dictionary<string, object>> { new Dictionary<string, object> { { "solicitante_cuenta", MIGUEL }, { "solicitante_nombre", "Guardado" }, { "solicitante_correo", null } },
                                                           new Dictionary<string, object> { { "solicitante_cuenta", NADA }, { "solicitante_nombre", null }, { "solicitante_correo", null } } };
        NombreSolicitante.AgregarIniciativas(caida);
        Check("K9 UsuariosAdmin caido: la lista sale con lo verificado / la cuenta", "Guardado|" + NADA, caida[0]["solicitante_mostrar"] + "|" + caida[1]["solicitante_mostrar"]);
        fichas.Lanza = false;

        // ---------------- H: handlers ----------------
        AccesoAdmin.FuenteRoles = new RolesNombreFalsos().Con(ADM, "ADM").Con(MIGUEL, "MOD").Con(MIGUEL2, "MOD").Con(PO, "MOD");
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = true;
        SolicitudesCambio.PersonasSolicitante = delegate { return new List<PersonaCatalogo> { new PersonaCatalogo { Nombre = "Juan Perez", Correo = "juanperez@soriana.com" } }; };
        NombreSolicitante.Personas = SolicitudesCambio.PersonasSolicitante;
        Func<int, string, Dictionary<string, object>> cambio = delegate (int id, string por)
        {
            return new Dictionary<string, object> { { "id", id }, { "solicitado_por", por }, { "estado", "PENDIENTE" }, { "folio", "PRB 2026-000001" },
                                                    { "intentos", 0 }, { "ultimo_error", null }, { "fecha_ultimo_intento_utc", null }, { "sin_clasificar", 0 } };
        };
        var alm = new AlmacenNombreFalso();
        alm.Lista_.AddRange(new[] { cambio(1, MIGUEL), cambio(2, MIGUEL2), cambio(3, PO), cambio(4, NADA), cambio(5, SINNOMBRE) });
        SolicitudesCambio.Almacen = alm;
        int st;
        var j = Correr(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx", "accion=listar", ADM, out st);
        var sol = ((System.Collections.ArrayList)j["solicitudes"]).Cast<Dictionary<string, object>>().ToList();
        Func<int, string> mostrado = n => sol.First(x => Convert.ToInt32(x["id"]) == n)["solicitante_mostrar"] as string;
        Check("H1 cola de ADM (cambios): nombre capturado / otro parecido / CatPersona / cuenta / correo",
              "200|Miguel Lopez Ruiz|Miguel Lopez Martinez|Juan Perez|" + NADA + "|sinnombre@soriana.com",
              st + "|" + mostrado(1) + "|" + mostrado(2) + "|" + mostrado(3) + "|" + mostrado(4) + "|" + mostrado(5));
        Check("H2 ... solicitado_por sigue siendo la cuenta; solicitante_nombre sigue siendo el de CatPersona", MIGUEL + "||Juan Perez",
              sol.First(x => Convert.ToInt32(x["id"]) == 1)["solicitado_por"] + "|" + sol.First(x => Convert.ToInt32(x["id"]) == 1)["solicitante_nombre"] + "|" +
              sol.First(x => Convert.ToInt32(x["id"]) == 3)["solicitante_nombre"]);
        var mias = new MiasNombreFalsas();
        mias.Lista_.AddRange(alm.Lista_);
        SolicitudesCambio.Mias = mias;
        j = Correr(new AdminIniciativasMisCambios(), "admin_iniciativas_mis_cambios.ashx", "accion=listar", MIGUEL, out st);
        var mis = ((System.Collections.ArrayList)j["solicitudes"]).Cast<Dictionary<string, object>>().ToList();
        Check("H3 Mis solicitudes de cambio: SOLO las suyas, con el MISMO nombre que ve ADM", "200|1|Miguel Lopez Ruiz",
              st + "|" + mis.Count + "|" + mis[0]["solicitante_mostrar"]);
        j = Correr(new AdminIniciativasMisCambios(), "admin_iniciativas_mis_cambios.ashx", "accion=detalle&id=1", MIGUEL, out st);
        Check("H4 Mis (detalle): el mismo nombre, sin datos de ADM", "200|Miguel Lopez Ruiz|False", st + "|" + j["solicitante_mostrar"] + "|" + j.ContainsKey("intentos"));
        j = Correr(new AdminIniciativasMisCambios(), "admin_iniciativas_mis_cambios.ashx", "accion=detalle&id=2", MIGUEL, out st);
        Check("H5 Mis: la de la cuenta parecida no es suya (404, el nombre no da acceso)", 404, st);

        var lector = new LectorNombreFalso();
        Func<int, string, string, string, Dictionary<string, object>> ini = delegate (int n, string cuenta, string nombre, string correo)
        {
            return new Dictionary<string, object> { { "numero", n }, { "numero_texto", new NumeroSolicitud(n).ToString() }, { "estado", "ENVIADA" },
                                                    { "solicitante_cuenta", cuenta }, { "solicitante_nombre", nombre }, { "solicitante_correo", correo }, { "categoria", null } };
        };
        lector.Todas.AddRange(new[] { ini(1, MIGUEL, null, "miguel@soriana.com"), ini(2, PO, "Juan Perez", "juanperez@soriana.com"), ini(3, NADA, null, null) });
        RegistroSolicitudesIniciativa.Lector = lector;
        RegistroSolicitudesIniciativa.Mias = lector;
        j = Correr(new AdminIniciativasSolicitudesNuevas(), "admin_iniciativas_solicitudes_nuevas.ashx", "accion=listar", ADM, out st);
        var nuevas = ((System.Collections.ArrayList)j["solicitudes"]).Cast<Dictionary<string, object>>().ToList();
        Check("H6 registro de ADM (iniciativas): nombre capturado (aunque se guardo NULL al enviar) / guardado / cuenta",
              "200|Miguel Lopez Ruiz|Juan Perez|" + NADA,
              st + "|" + nuevas[0]["solicitante_mostrar"] + "|" + nuevas[1]["solicitante_mostrar"] + "|" + nuevas[2]["solicitante_mostrar"]);
        Check("H7 ... lo guardado (nombre / correo / cuenta) no cambia", "|miguel@soriana.com|" + MIGUEL,
              nuevas[0]["solicitante_nombre"] + "|" + nuevas[0]["solicitante_correo"] + "|" + nuevas[0]["solicitante_cuenta"]);
        j = Correr(new AdminIniciativasMisSolicitudes(), "admin_iniciativas_mis_solicitudes.ashx", "accion=listar", MIGUEL, out st);
        var misI = ((System.Collections.ArrayList)j["solicitudes"]).Cast<Dictionary<string, object>>().ToList();
        Check("H8 Mis solicitudes de iniciativa: solo la suya, el mismo nombre", "200|1|Miguel Lopez Ruiz", st + "|" + misI.Count + "|" + misI[0]["solicitante_mostrar"]);
        j = Correr(new AdminIniciativasMisSolicitudes(), "admin_iniciativas_mis_solicitudes.ashx", "accion=detalle&numero=1", MIGUEL, out st);
        Check("H9 Mis (detalle de iniciativa): el mismo nombre", "200|Miguel Lopez Ruiz", st + "|" + j["solicitante_mostrar"]);

        var src = File.ReadAllText(Path.Combine("App_Code", "NombreSolicitante.cs"));
        Check("H10 la consulta es por cuenta (Usuario normalizado) con parametros; nunca filtra por nombre", "True|True|False",
              src.Contains("WHERE UPPER(LTRIM(RTRIM(u.Usuario))) IN (") + "|" + src.Contains("cmd.Parameters.Add(\"@c\" + i") + "|" + src.Contains("WHERE u.NombreSolicitante"));

        Generales(fichas, alm, mias, lector);
        PersistenciaSolicitudesCambio.ForzadaParaPruebas = null;

        Console.WriteLine();
        Console.WriteLine(pasados + " pasaron, " + fallos + " fallaron");
        return fallos == 0 ? 0 : 1;
    }

    const string REVISOR = @"SORIANA\luisglom";   // ADM con NombreSolicitante capturado
    const string OMAR = @"SORIANA\omaralus";      // ADM sin NombreSolicitante, en CatPersona
    const string DOBLE = @"SORIANA\t_doble";      // dos NombreSolicitante distintos; CatPersona ambiguo
    const string SOLOCORREO = @"SORIANA\t_correo"; // solo correo en UsuariosAdmin

    static Dictionary<string, object> Ev(string evento, string usuario)
    {
        return new Dictionary<string, object> { { "evento", evento }, { "usuario", usuario }, { "fecha_utc", "2026-11-05T10:00:00Z" } };
    }
    static List<Dictionary<string, object>> Lista(Dictionary<string, object> j, string k)
    {
        return ((System.Collections.ArrayList)j[k]).Cast<Dictionary<string, object>>().ToList();
    }

    // ---------------- G: cualquier cuenta ----------------
    static void Generales(FichasFalsas fichas, AlmacenNombreFalso alm, MiasNombreFalsas mias, LectorNombreFalso lector)
    {
        fichas.Fila(REVISOR, "luis.glo@soriana.com", "Luis Gloria Montes")
              .Fila(OMAR, "omar.alu@soriana.com", null)
              .Fila(DOBLE, "doble@soriana.com", "Pedro Uno").Fila(DOBLE, "doble@soriana.com", "Pablo Dos")
              .Fila(SOLOCORREO, "solo.correo@soriana.com", null);
        var lecturasCat = 0;
        Func<IList<PersonaCatalogo>> cat = delegate
        {
            lecturasCat++;
            return new List<PersonaCatalogo>
            {
                new PersonaCatalogo { Nombre = "Omar Alvarez Lugo", Correo = "omaralus@soriana.com" },
                new PersonaCatalogo { Nombre = "Juan Perez", Correo = "juanperez@soriana.com" },
                // DOBLE: dos personas con el mismo correo de la cuenta = ambiguo.
                new PersonaCatalogo { Nombre = "Doble Uno", Correo = "t_doble@soriana.com" },
                new PersonaCatalogo { Nombre = "Doble Dos", Correo = "t_doble@soriana.com" },
                // Nombre parecido a Omar con OTRA cuenta: nunca se usa para omaralus.
                new PersonaCatalogo { Nombre = "Omar Alvarez", Correo = "oalvarez@soriana.com" },
            };
        };
        NombreSolicitante.Personas = cat;
        SolicitudesCambio.PersonasSolicitante = cat;

        fichas.Pedidas.Clear();
        var r = NombreSolicitante.Resolver(new[] { REVISOR, OMAR, PO, SOLOCORREO, NADA, DOBLE, " soriana\\LUISGLOM ", null, "" }, null, cat);
        Func<string, string> v = c => { var x = r[NombreSolicitante.Clave(c)]; return x.Fuente + ":" + x.Texto; };
        Check("G1 nombre completo capturado (UsuariosAdmin.NombreSolicitante)", "NOMBRE_ADMIN:Luis Gloria Montes", v(REVISOR));
        Check("G2 sin NombreSolicitante: el nombre de CatPersona por SU cuenta (no el parecido de otra)", "NOMBRE_VERIFICADO:Omar Alvarez Lugo", v(OMAR));
        Check("G3 no esta en UsuariosAdmin: CatPersona", "NOMBRE_VERIFICADO:Juan Perez", v(PO));
        Check("G4 sin nombre en ningun lado: el correo de UsuariosAdmin", "CORREO:solo.correo@soriana.com", v(SOLOCORREO));
        Check("G5 sin nada: la cuenta Windows", "CUENTA:" + NADA, v(NADA));
        Check("G6 dos NombreSolicitante distintos y CatPersona ambiguo: ningun nombre, el correo", "CORREO:doble@soriana.com", v(DOBLE));
        Check("G7 lote: la misma cuenta con otra grafia es UNA; vacias fuera; UNA lectura de UsuariosAdmin y UNA de CatPersona",
              "6|6|1", r.Count + "|" + fichas.Pedidas.Count + "|" + lecturasCat);
        lecturasCat = 0;
        NombreSolicitante.Resolver(new[] { REVISOR }, null, cat);
        Check("G8 todas con nombre en UsuariosAdmin: CatPersona NO se lee", 0, lecturasCat);

        var guardados = new Dictionary<string, NombreSolicitante.Verificado>(StringComparer.Ordinal);
        NombreSolicitante.Guardar(guardados, NADA, "Nombre Guardado", null);
        Check("G9 nombre guardado de la cuenta (lo que ya trae la respuesta): antes que CatPersona y el correo",
              "NOMBRE_VERIFICADO:Nombre Guardado", Ver(NombreSolicitante.Resolver(new[] { NADA }, guardados, cat)[NombreSolicitante.Clave(NADA)]));
        NombreSolicitante.Guardar(guardados, NADA, "Otro Nombre Distinto", "nada@soriana.com");
        var conflicto = NombreSolicitante.Resolver(new[] { NADA }, guardados, cat)[NombreSolicitante.Clave(NADA)];
        Check("G10 dos nombres guardados distintos para la misma cuenta: ninguno (cae al correo)", "CORREO:nada@soriana.com", conflicto.Fuente + ":" + conflicto.Texto);
        NombreSolicitante.Guardar(guardados, NADA, "Nombre Guardado", null);
        Check("G10b ... y un tercero igual al primero no lo revive", "CORREO", NombreSolicitante.Resolver(new[] { NADA }, guardados, cat)[NombreSolicitante.Clave(NADA)].Fuente);
        Check("G11 CatPersona caido: sigue con correo / cuenta, sin romper", "CUENTA:" + NADA,
              Ver(NombreSolicitante.Resolver(new[] { NADA }, null, delegate { throw new InvalidOperationException("CatPersona caido"); })[NombreSolicitante.Clave(NADA)]));

        // Eventos: cada uno con SU cuenta; la cuenta no cambia.
        var obj = new Dictionary<string, object> { { "revisado_por", REVISOR }, { "cancelado_por", null },
            { "eventos", new List<object> { Ev("ENVIADA", OMAR), Ev("APROBADA", REVISOR), Ev("ENVIADA", NADA) } } };
        NombreSolicitante.AnotarCuentas(new List<Dictionary<string, object>> { obj }, NombreSolicitante.CamposDetalle, true, null, cat);
        var evs = ((List<object>)obj["eventos"]).Cast<Dictionary<string, object>>().ToList();
        Check("G12 eventos historicos: cada uno con el nombre de SU cuenta y la cuenta intacta",
              "Omar Alvarez Lugo|" + OMAR + "|Luis Gloria Montes|" + REVISOR + "|" + NADA + "|" + NADA,
              evs[0]["usuario_mostrar"] + "|" + evs[0]["usuario"] + "|" + evs[1]["usuario_mostrar"] + "|" + evs[1]["usuario"] + "|" + evs[2]["usuario_mostrar"] + "|" + evs[2]["usuario"]);
        Check("G13 revisado_por intacto + revisado_por_mostrar; sin cuenta: _mostrar null", REVISOR + "|Luis Gloria Montes|True",
              obj["revisado_por"] + "|" + obj["revisado_por_mostrar"] + "|" + (obj["cancelado_por_mostrar"] == null));

        // ---- Handlers: detalle de cambio (ADM y quien la envio) ----
        int st;
        var c9 = new Dictionary<string, object> { { "id", 9 }, { "solicitado_por", MIGUEL }, { "estado", "CANCELADA" }, { "folio", "PRB 2026-000001" },
            { "revisado_por", null }, { "cancelado_por", MIGUEL },
            { "intentos", 0 }, { "ultimo_error", null }, { "fecha_ultimo_intento_utc", null }, { "sin_clasificar", 0 },
            { "eventos", new List<object> { Ev("ENVIADA", MIGUEL), Ev("CANCELADA", MIGUEL) } } };
        var c10 = new Dictionary<string, object> { { "id", 10 }, { "solicitado_por", MIGUEL }, { "estado", "RECHAZADA" }, { "folio", "PRB 2026-000001" },
            { "revisado_por", OMAR }, { "cancelado_por", null },
            { "intentos", 1 }, { "ultimo_error", "x" }, { "fecha_ultimo_intento_utc", null }, { "sin_clasificar", 0 },
            { "eventos", new List<object> { Ev("ENVIADA", MIGUEL), Ev("FALLO_APLICAR", REVISOR), Ev("RECHAZADA", OMAR) } } };
        alm.Lista_.Add(c9); alm.Lista_.Add(c10);
        mias.Lista_.Add(c9); mias.Lista_.Add(c10);
        fichas.Pedidas.Clear(); lecturasCat = 0;
        var j = Correr(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx", "accion=detalle&id=10", ADM, out st);
        var je = Lista(j, "eventos");
        Check("G14 ADM, detalle de cambio: rechazada por (nombre CatPersona), eventos por cuenta, cuentas intactas",
              "200|Omar Alvarez Lugo|" + OMAR + "|Miguel Lopez Ruiz|Luis Gloria Montes|Omar Alvarez Lugo|" + REVISOR,
              st + "|" + j["revisado_por_mostrar"] + "|" + j["revisado_por"] + "|" + je[0]["usuario_mostrar"] + "|" + je[1]["usuario_mostrar"] + "|" + je[2]["usuario_mostrar"] + "|" + je[1]["usuario"]);
        Check("G15 ... UNA lectura de UsuariosAdmin y UNA de CatPersona para todo el detalle", "3|1", fichas.Pedidas.Count + "|" + lecturasCat);
        j = Correr(new AdminIniciativasSolicitudes(), "admin_iniciativas_solicitudes.ashx", "accion=detalle&id=9", ADM, out st);
        Check("G16 cancelada: \"Cancelada por\" dice lo mismo que \"Solicito\"", "200|Miguel Lopez Ruiz|Miguel Lopez Ruiz|" + MIGUEL,
              st + "|" + j["cancelado_por_mostrar"] + "|" + j["solicitante_mostrar"] + "|" + j["cancelado_por"]);
        j = Correr(new AdminIniciativasMisCambios(), "admin_iniciativas_mis_cambios.ashx", "accion=detalle&id=10", MIGUEL, out st);
        je = Lista(j, "eventos");
        Check("G17 no ADM (Mis solicitudes de cambio): el revisor con nombre; sin datos de ADM (intentos, detalle del fallo)",
              "200|Omar Alvarez Lugo|Omar Alvarez Lugo|False|",
              st + "|" + j["revisado_por_mostrar"] + "|" + je[2]["usuario_mostrar"] + "|" + j.ContainsKey("intentos") + "|" + je[1]["detalle"]);
        j = Correr(new AdminIniciativasMisCambios(), "admin_iniciativas_mis_cambios.ashx", "accion=detalle&id=10", MIGUEL2, out st);
        Check("G18 no ADM: la de otra cuenta no se ve (404): el nombre no abre acceso", 404, st);

        // ---- Handlers: detalle de solicitud de iniciativa ----
        var i7 = new Dictionary<string, object> { { "numero", 7 }, { "numero_texto", new NumeroSolicitud(7).ToString() }, { "estado", "APROBADA" },
            { "solicitante_cuenta", PO }, { "solicitante_nombre", "Juan Perez Guardado" }, { "solicitante_correo", "juanperez@soriana.com" }, { "categoria", null },
            { "revisado_por", REVISOR }, { "cancelado_por", null }, { "codigo_iniciativa", "PRE 2026-000199" },
            { "eventos", new List<object> { Ev("ENVIADA", PO), Ev("APROBADA", REVISOR) } } };
        lector.Todas.Add(i7);
        fichas.Pedidas.Clear(); lecturasCat = 0;
        j = Correr(new AdminIniciativasSolicitudesNuevas(), "admin_iniciativas_solicitudes_nuevas.ashx", "accion=detalle&numero=7", ADM, out st);
        je = Lista(j, "eventos");
        Check("G19 ADM, detalle de iniciativa: aprobada por (capturado), quien la envio con su nombre GUARDADO en sus eventos",
              "200|Luis Gloria Montes|Juan Perez Guardado|Juan Perez Guardado|Luis Gloria Montes|" + REVISOR,
              st + "|" + j["revisado_por_mostrar"] + "|" + j["solicitante_mostrar"] + "|" + je[0]["usuario_mostrar"] + "|" + je[1]["usuario_mostrar"] + "|" + j["revisado_por"]);
        Check("G20 ... UNA lectura de UsuariosAdmin; CatPersona no hace falta", "2|0", fichas.Pedidas.Count + "|" + lecturasCat);
        j = Correr(new AdminIniciativasMisSolicitudes(), "admin_iniciativas_mis_solicitudes.ashx", "accion=detalle&numero=7", PO, out st);
        Check("G21 no ADM (Mis solicitudes): el mismo nombre del revisor", "200|Luis Gloria Montes", st + "|" + j["revisado_por_mostrar"]);
        j = Correr(new AdminIniciativasMisSolicitudes(), "admin_iniciativas_mis_solicitudes.ashx", "accion=detalle&numero=7", MIGUEL, out st);
        Check("G22 no ADM: la de otra cuenta no se ve", 404, st);

        // ---- Historial de peticiones / Cambios recientes / historial de fechas ----
        var hp = new Dictionary<string, object> { { "peticiones", new List<object> {
            new Dictionary<string, object> { { "tipo", "CAMBIO" }, { "solicitante_cuenta", REVISOR }, { "solicitante_nombre", null }, { "solicitante_correo", null } },
            new Dictionary<string, object> { { "tipo", "INICIATIVA" }, { "solicitante_cuenta", PO }, { "solicitante_nombre", "Juan Perez Guardado" }, { "solicitante_correo", null } },
            new Dictionary<string, object> { { "tipo", "CAMBIO" }, { "solicitante_cuenta", NADA }, { "solicitante_nombre", null }, { "solicitante_correo", null } } } } };
        NombreSolicitante.AgregarHistorialPeticiones(hp);
        var hpl = ((List<object>)hp["peticiones"]).Cast<Dictionary<string, object>>().ToList();
        Check("G23 Historial de peticiones: misma regla que las colas (capturado / guardado / cuenta), cuenta intacta",
              "Luis Gloria Montes|Juan Perez Guardado|" + NADA + "|" + REVISOR,
              hpl[0]["solicitante_mostrar"] + "|" + hpl[1]["solicitante_mostrar"] + "|" + hpl[2]["solicitante_mostrar"] + "|" + hpl[0]["solicitante_cuenta"]);
        var cr = new Dictionary<string, object> { { "cambios", new List<object> {
            new Dictionary<string, object> { { "folio", "PRB 1" }, { "usuario", OMAR } },
            new Dictionary<string, object> { { "folio", "PRB 2" }, { "usuario", null } } } } };
        NombreSolicitante.AgregarCambiosRecientes(cr);
        var crl = ((List<object>)cr["cambios"]).Cast<Dictionary<string, object>>().ToList();
        Check("G24 Cambios recientes: quien guardo con nombre; sin usuario, null", "Omar Alvarez Lugo|" + OMAR + "|True",
              crl[0]["usuario_mostrar"] + "|" + crl[0]["usuario"] + "|" + (crl[1]["usuario_mostrar"] == null));
        fichas.Pedidas.Clear(); lecturasCat = 0;
        var reg = new Dictionary<string, object> { { "iniciativas", new List<object> {
            new Dictionary<string, object> { { "folio", "PRB 1" },
                { "historial", new List<object> { new Dictionary<string, object> { { "usuario", REVISOR }, { "origen", "ADMIN" } }, new Dictionary<string, object> { { "usuario", null }, { "origen", "EXCEL" } } } },
                { "historial_categorias", new List<object> { new Dictionary<string, object> { { "usuario", OMAR }, { "origen", "ADMIN" } } } } },
            new Dictionary<string, object> { { "folio", "PRB 2" },
                { "historial", new List<object> { new Dictionary<string, object> { { "usuario", OMAR }, { "origen", "ADMIN" } } } },
                { "historial_categorias", new List<object>() } } } } };
        NombreSolicitante.AgregarRegistro(reg);
        var ini1 = (Dictionary<string, object>)((List<object>)reg["iniciativas"])[0];
        var h1 = ((List<object>)ini1["historial"]).Cast<Dictionary<string, object>>().ToList();
        var hc1 = ((List<object>)ini1["historial_categorias"]).Cast<Dictionary<string, object>>().ToList();
        Check("G25 historial de fechas: \"Quien\" con nombre, sin persona = null; todo el registro en UN lote",
              "Luis Gloria Montes|True|Omar Alvarez Lugo|2|1",
              h1[0]["usuario_mostrar"] + "|" + (h1[1]["usuario_mostrar"] == null) + "|" + hc1[0]["usuario_mostrar"] + "|" + fichas.Pedidas.Count + "|" + lecturasCat);
    }
}
