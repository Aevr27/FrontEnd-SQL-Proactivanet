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
    public ErrorSolicitudCambio LanzarAlAplicar;
    public int UltimoNumeroFallo;

    public ResultadoEnvioSolicitud Enviar(PeticionSolicitudCambio p, string usuario, string rol)
    {
        Llamadas.Add("Enviar"); UltimaPeticion = p; UltimoUsuario = usuario; UltimoRol = rol;
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
        var validaciones = new List<NameValueCollection>();
        var validacionOk = true;
        SolicitudesCambio.ValidarAplicacion = delegate (NameValueCollection f)
        {
            validaciones.Add(f);
            var v = new ValidacionAplicar { Valida = validacionOk };
            if (!validacionOk) v.Errores.Add(new ErrorCampo { Campo = "pct", Mensaje = "/A/Cat 1: rebasa el 100% de la categoria." });
            return v;
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
        cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "categorias", "motivo", "m",
            "pct_categoria", "/A/Cat 1", "pct_valor", "101"), out estado);
        Check("B11 % fuera de rango: 422", 422, estado);

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
        Check("G1 interruptor sql/25 apagado (constante false; sql/23, 24 y 25 sin aplicar)", "False|False",
              PersistenciaSolicitudesCambio.SolicitaDatos + "|" + PersistenciaSolicitudesCambio.SolicitaDatosActiva());
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
            cuerpo = Correr("POST", "accion=enviar", MOD, F("folio", "PRB 2026-000001", "llave", Llave, "tipo", "datos", "so_nuevo", "  ", "motivo", "m"), out estado);
            p = alm.UltimaPeticion;
            Check("G4 SO vacio = que quede vacio (bandera si, valor null)", "200|True|null|False",
                  estado + "|" + p.CambiaSo + "|" + (p.SoNuevo ?? "null") + "|" + p.CambiaTitulo);
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

        Console.WriteLine(fallos == 0 ? "OK: todo paso" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
