// Solicitudes de cambio de una iniciativa ("Solicitar cambios"): envio,
// cola de ADM, detalle, rechazo y aplicacion.
//
//   handlers/admin_iniciativas_solicitudes.ashx   (HTTP, sin logica)
//       -> PeticionSolicitudCambio.DesdeFormulario   (lo que llego; formato)
//       -> IAlmacenSolicitudesCambio                 (sql/22: adm.usp_SolicitudCambio_*)
//       -> AplicadorSolicitudCambio                  (aplicar: valida como la
//                                                     edicion directa y luego
//                                                     adm.usp_SolicitudCambio_Aplicar)
//
// REGLAS
//   - Quien envia, su rol y quien revisa los pone el servidor
//     (IdentidadWindows / AccesoAdmin); lo que mande el navegador con esos
//     nombres se ignora.
//   - Enviar revisa el tope de 100% por categoria con la regla de aplicar
//     (SolicitudesCambio.ErroresCapacidad -> TopeModificacion) antes de
//     guardar: lo que no cabe ni se guarda (422); sin poder leer la
//     capacidad, 503.
//   - Enviar nunca escribe la iniciativa. Aplicar la escribe por el mismo
//     adm.usp_GestionAdmin_Modificar que la edicion directa, en una
//     transaccion, solo si lo "anterior" guardado sigue siendo lo que hay.
//   - La clasificacion de una categoria por agregar se deriva del prefijo
//     (TiposPorPrefijo); sin regla queda vacia y ADM la elige al aplicar.
//   - Interruptor propio (PersistenciaSolicitudesCambio, encendido solo si
//     DeteccionSolicitudesCambio ve sql/22 en la base), aparte del de la
//     edicion directa (PersistenciaGestionAdmin). Aplicar necesita los dos:
//     escribe la iniciativa.
//   - Tipo DATOS (sql/25, interruptor SolicitaDatos): Titulo / PO / SO
//     CAPTURADOS de la iniciativa (nunca los de la categoria). Se aplican por
//     las mismas claves que la edicion directa (titulo / po / so), asi que
//     el catalogo de duenos y lo de ahora se revisan AL APLICAR. Codigo no
//     es un dato que se pueda pedir: no hay clave ni columna para el.
//   - Tipo VARIOS (sql/34, interruptor SolicitaVarios): UNA solicitud con
//     cualquier combinacion de Estado, las tres fechas (cada una por su
//     etapa: f_analisis_nueva / f_solucion_nueva / f_cierre_nueva),
//     categorias y Titulo / PO / SO. Se valida y se aplica entera con UNA
//     llamada a Modificar (todo o nada). "Otros" no va en VARIOS.
//
// Solo ASCII en literales (App_Code sin BOM): acentos con \uXXXX.
// Pruebas: tools/tests/SolicitudesCambioHttpSmoke.cs (sin SQL) y
// tools/tests/SolicitudesCambioSqlLocalDbSmoke.cs (LocalDB desechable).

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

public static class PersistenciaSolicitudesCambio
{
    // Encendida (2026-10-21: sql/22 y sus permisos 22P aplicados en la VM),
    // pero SOLO surte efecto cuando DeteccionSolicitudesCambio (abajo) ve los
    // cuatro procedimientos de sql/22 en la base. Sin ellos, o sin haberlo
    // podido revisar, sigue apagada: enviar valida y responde 501; nada se
    // guarda. false = apagada aunque la base tenga sql/22.
    public const bool Habilitada = true;

    // Solo para las pruebas (sin tocar la constante). null = lo de abajo.
    public static bool? ForzadaParaPruebas;

    public static bool Activa() { return ForzadaParaPruebas ?? (Habilitada && sql22EnBase == true); }

    public const string MotivoCola =
        "El registro de solicitudes todav\u00eda no est\u00e1 habilitado (falta aplicar sql/22 en la base, con su aprobaci\u00f3n): no hay solicitudes que revisar.";

    public const string Motivo =
        "El registro de solicitudes todav\u00eda no est\u00e1 habilitado (falta aplicar sql/22 en la base, con su aprobaci\u00f3n). " +
        "La solicitud se revis\u00f3, pero no se guard\u00f3 ni se envi\u00f3.";

    // Tipo DATOS (Titulo / PO / SO capturados): columnas y parametros de
    // sql/25, que depende de sql/24 (y esta de sql/23). Encendida
    // (2026-10-21), pero SOLO surte efecto cuando DeteccionSolicitudesCambio
    // ve los parametros de sql/25 en adm.usp_SolicitudCambio_Crear (sql/25
    // agrega columnas y parametros en la misma transaccion). Apagada: el
    // formulario no lo ofrece, el servidor lo rechaza (422), el almacen no
    // manda los parametros nuevos y la cola lee esas columnas como vacias.
    // false = apagada aunque la base tenga sql/25.
    public const bool SolicitaDatos = true;
    public static bool? SolicitaDatosForzadaParaPruebas;
    public static bool SolicitaDatosActiva() { return SolicitaDatosForzadaParaPruebas ?? (SolicitaDatos && sql25EnBase == true); }

    // Tipo VARIOS (varios cambios en UNA solicitud): columnas y parametros
    // de sql/34, que depende de sql/25. Encendida, pero SOLO surte efecto
    // cuando DeteccionSolicitudesCambio ve sql/25 y los parametros de fecha
    // de sql/34 en adm.usp_SolicitudCambio_Crear. Apagada: el registro no la
    // anuncia (solicitudes_varios), el servidor la rechaza (422), el almacen
    // no manda los parametros nuevos y la cola lee esas columnas como vacias.
    // false = apagada aunque la base tenga sql/34.
    public const bool SolicitaVarios = true;
    public static bool? SolicitaVariosForzadaParaPruebas;
    public static bool SolicitaVariosActiva()
    {
        return SolicitaVariosForzadaParaPruebas ?? (SolicitaVarios && sql25EnBase == true && sql34EnBase == true);
    }

    // Lo que DeteccionSolicitudesCambio vio en la base (null = todavia no se
    // reviso) y cuando. Misma vigencia que sql/24: aplicar o revertir los
    // scripts la enciende o la apaga sin reciclar el sitio.
    private static readonly object candado = new object();
    private static bool? sql22EnBase;
    private static bool? sql25EnBase;
    private static bool? sql34EnBase;
    private static DateTime revisadaUtc;

    public static void Anotar(bool sql22, bool sql25, DateTime ahoraUtc) { Anotar(sql22, sql25, false, ahoraUtc); }

    public static void Anotar(bool sql22, bool sql25, bool sql34, DateTime ahoraUtc)
    {
        lock (candado) { sql22EnBase = sql22; sql25EnBase = sql25; sql34EnBase = sql34; revisadaUtc = ahoraUtc; }
    }

    public static bool Vigente(DateTime ahoraUtc)
    {
        lock (candado) { return sql22EnBase != null && ahoraUtc - revisadaUtc < PersistenciaGestionAdmin.VigenciaRevisionSql24; }
    }

    // Solo para las pruebas: como recien arrancado (sin revisar).
    public static void OlvidarParaPruebas()
    {
        lock (candado) { sql22EnBase = null; sql25EnBase = null; sql34EnBase = null; revisadaUtc = DateTime.MinValue; }
    }

    public const string MotivoVarios =
        "Enviar varios cambios en una sola solicitud todav\u00eda no est\u00e1 habilitado " +
        "(falta aplicar sql/34 en la base). Env\u00edalos en solicitudes que el servidor ya acepta.";

    public const string MotivoDatos =
        "Pedir cambio de T\u00edtulo, Product Owner o Service Owner todav\u00eda no est\u00e1 habilitado " +
        "(falta aplicar sql/23, sql/24 y sql/25 en la base). Expl\u00edcalo con \u00abOtros\u00bb.";
}

// Si la base ya tiene sql/22 (los cuatro adm.usp_SolicitudCambio_*) y
// sql/25 (sus tres @Cambia* en _Crear). Igual que DeteccionSql24: solo
// metadatos (visibles con el EXECUTE sobre adm del sitio), vigencia, y un
// error al revisar cuenta como "sin sql/22 ni sql/25" (apagada).
public static class DeteccionSolicitudesCambio
{
    public const string Consulta =
        "SELECT Sql22 = (SELECT COUNT(*) FROM sys.procedures WHERE object_id IN (" +
        "OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P'), OBJECT_ID(N'adm.usp_SolicitudCambio_Aplicar', N'P'), " +
        "OBJECT_ID(N'adm.usp_SolicitudCambio_Rechazar', N'P'), OBJECT_ID(N'adm.usp_SolicitudCambio_RegistrarFallo', N'P'))), " +
        "Sql25 = (SELECT COUNT(*) FROM sys.parameters " +
        "WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P') " +
        "AND name IN (N'@CambiaTitulo', N'@CambiaOwnerProblem', N'@CambiaOwnerServicio')), " +
        "Sql34 = (SELECT COUNT(*) FROM sys.parameters " +
        "WHERE object_id = OBJECT_ID(N'adm.usp_SolicitudCambio_Crear', N'P') " +
        "AND name IN (N'@CambiaFAnalisis', N'@CambiaFSolucion', N'@CambiaFCierre'))";

    // Con la conexion (abierta) del que llama.
    public static void Revisar(SqlConnection cn)
    {
        if (cn == null) throw new ArgumentNullException("cn");
        var ahora = DateTime.UtcNow;
        if (PersistenciaSolicitudesCambio.Vigente(ahora)) return;
        bool sql22 = false, sql25 = false, sql34 = false;
        try
        {
            using (var cmd = new SqlCommand(Consulta, cn) { CommandTimeout = 15 })
            using (var rd = cmd.ExecuteReader())
                if (rd.Read())
                {
                    sql22 = Convert.ToInt32(rd.GetValue(0)) == 4;
                    sql25 = sql22 && Convert.ToInt32(rd.GetValue(1)) == 3;
                    sql34 = sql25 && Convert.ToInt32(rd.GetValue(2)) == 3;
                }
        }
        catch (SqlException) { sql22 = false; sql25 = false; sql34 = false; }
        PersistenciaSolicitudesCambio.Anotar(sql22, sql25, sql34, ahora);
    }

    // Abre su propia conexion solo si hace falta revisar.
    public static void Revisar()
    {
        if (PersistenciaSolicitudesCambio.Vigente(DateTime.UtcNow)) return;
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            Revisar(cn);
        }
    }
}

// Una categoria de la solicitud. Pct = fraccion 0-1 (como
// ProblemCategoria.PctDisminucion); Texto = lo que llego, en %.
public sealed class CategoriaSolicitudCambio
{
    public string Categoria;
    public string Accion;          // PCT | AGREGAR
    public string Texto;
    public decimal Pct;
    public string TipoIniciativa;  // solo AGREGAR, derivado del prefijo
    public string TipoAgrupado;
}

// La clasificacion que ADM da al aplicar (categoria por agregar sin ella).
public sealed class ClasificacionSolicitud
{
    public string Categoria;
    public string TipoIniciativa;
    public string TipoAgrupado;
}

public sealed class PeticionSolicitudCambio
{
    public const string CFolio = "folio";
    public const string CLlave = "llave";
    public const string CTipo = "tipo";
    public const string CCampoFecha = "campo_fecha";
    public const string CFechaNueva = "fecha_nueva";
    public const string CEstadoNuevo = "estado_nuevo";
    public const string CSubestadoNuevo = "subestado_nuevo";
    public const string CMotivo = "motivo";
    // Tipo datos (sql/25): la clave PRESENTE = se pide cambiarlo (como
    // PeticionModificarAdmin: null = no vino). Presente y vacia (o solo
    // espacios) se rechaza: una solicitud nunca deja vacios Titulo, PO ni SO.
    public const string CTituloNuevo = "titulo_nuevo";
    public const string CPoNuevo = "po_nuevo";
    public const string CSoNuevo = "so_nuevo";
    // Tipo varios (sql/34): cada fecha compromiso por su etapa; la clave
    // PRESENTE = se pide (y trae su fecha). Nunca campo_fecha / fecha_nueva.
    public const string CFAnalisisNueva = "f_analisis_nueva";
    public const string CFSolucionNueva = "f_solucion_nueva";
    public const string CFCierreNueva = "f_cierre_nueva";

    // tipo del formulario -> Tipo de adm.SolicitudCambio
    private static readonly Dictionary<string, string> Tipos = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        { "fecha", "FECHA" }, { "estado", "ESTADO" }, { "categorias", "CATEGORIAS" }, { "otros", "OTROS" },
        { "datos", "DATOS" }, { "varios", "VARIOS" },
    };
    // clave de VARIOS -> ProblemFechaEvento.Campo (las mismas tres etapas).
    public static readonly Dictionary<string, string> CamposVarios = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        { CFAnalisisNueva, "FechaAnalisis" }, { CFSolucionNueva, "FechaSolucion" }, { CFCierreNueva, "FechaCierre" },
    };
    // campo_fecha del formulario (los nombres del registro) -> ProblemFechaEvento.Campo
    public static readonly Dictionary<string, string> Campos = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        { "f_analisis", "FechaAnalisis" }, { "f_solucion", "FechaSolucion" }, { "f_cierre", "FechaCierre" },
    };
    public static readonly Dictionary<string, string> Etapas = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        { "FechaAnalisis", "An\u00e1lisis" }, { "FechaSolucion", "Soluci\u00f3n" }, { "FechaCierre", "Cierre" },
    };

    private static readonly Regex Porcentaje = new Regex(@"^\d{1,3}(\.\d{1,2})?$", RegexOptions.CultureInvariant);
    private static readonly Regex FolioForma = new Regex(@"^[A-Za-z]{3} \d{4}-\d{6}$", RegexOptions.CultureInvariant);

    public string Folio;
    public string Prefijo;
    public Guid Llave;
    public string Tipo;
    public string CampoFecha;
    public DateTime? FechaNueva;
    public string EstadoNuevo;
    public string SubestadoNuevo;
    public string Motivo;
    // DATOS: Cambia* = se pide (y entonces el valor nunca es null: se rechaza).
    public bool CambiaTitulo, CambiaPo, CambiaSo;
    public string TituloNuevo, PoNuevo, SoNuevo;
    // VARIOS (sql/34): Campo (FechaAnalisis | FechaSolucion | FechaCierre) ->
    // la fecha pedida; solo las que vinieron.
    public Dictionary<string, DateTime> FechasVarias = new Dictionary<string, DateTime>(StringComparer.Ordinal);
    public List<CategoriaSolicitudCambio> Categorias = new List<CategoriaSolicitudCambio>();
    public List<ErrorCampo> Errores = new List<ErrorCampo>();

    public bool Valida { get { return Errores.Count == 0; } }

    private void Error(string campo, string mensaje) { Errores.Add(new ErrorCampo { Campo = campo, Mensaje = mensaje }); }

    public const string MensajeSubestadoSoloAdm = "Solo un administrador (ADM) puede pedir un cambio de Subestado.";

    // El Subestado es solo de ADM (2026-10-26): quien no lo ve tampoco lo
    // pide. `rol` es el del servidor (AccesoAdmin.Rol), nunca del formulario.
    // El cambio de Estado sin Subestado sigue igual para todos.
    public void ExigirSubestadoDeAdm(string rol)
    {
        if (SubestadoNuevo != null && rol != RolAdmin.Adm) Error(CSubestadoNuevo, MensajeSubestadoSoloAdm);
    }

    // Lo que pide AGREGAR (decision 2026-10-28): solo categorias del PO / SO
    // CAPTURADOS de la iniciativa (dbo.Problem.OwnerProblem / OwnerServicio),
    // y solo si ese par existe en el catalogo de la cascada (hojas activas con
    // Director / PO / SO vigentes, el `rutas` de Nueva solicitud). Sin par
    // capturado, o con un par que no esta en el catalogo, no se agrega nada:
    // no se cae a otro par. Antes solo se revisaba al APLICAR, contra el
    // catalogo mas amplio de ADM. Las ligadas (PCT) no se revisan: se
    // conservan como estan, igual que en Modificar.
    //   po / so  los capturados (null = sin capturar);
    //   rutas    las del catalogo de ESE par (vacia = el par no esta),
    //            normalizadas, sin distinguir mayusculas.
    public bool AgregaCategorias() { return Categorias.Exists(c => c.Accion == "AGREGAR"); }
    public void ExigirCatalogo(string po, string so, ICollection<string> rutas)
    {
        if (!AgregaCategorias()) return;
        if (po == null || so == null)
        {
            Error("categoria", "La iniciativa no tiene Product Owner y Service Owner capturados: no se pueden agregar categor\u00edas. Pide primero ese cambio.");
            return;
        }
        if (rutas == null || rutas.Count == 0)
        {
            Error("categoria", "El Product Owner y Service Owner de la iniciativa (" + po + " / " + so +
                ") no son un par del cat\u00e1logo vigente: no se pueden agregar categor\u00edas.");
            return;
        }
        foreach (var c in Categorias)
        {
            if (c.Accion != "AGREGAR") continue;
            var llave = DirectorioOrganizacional.Normaliza(c.Categoria);
            if (llave == null || !rutas.Contains(llave))
                Error("categoria", c.Categoria + ": no es una categor\u00eda del Product Owner y Service Owner de la iniciativa (" + po + " / " + so + ") en el cat\u00e1logo vigente.");
        }
    }

    private static string Limpio(string s)
    {
        if (s == null) return null;
        s = s.Replace('\u00a0', ' ').Trim();
        return s.Length == 0 ? null : s;
    }

    // Solo FORMATO (sin base). Lo que exista o no en la base lo revisa
    // adm.usp_SolicitudCambio_Crear. Usuario, rol y clasificacion no se
    // leen del formulario.
    public static PeticionSolicitudCambio DesdeFormulario(NameValueCollection f)
    {
        var p = new PeticionSolicitudCambio();
        p.Folio = Limpio(f[CFolio]);
        if (p.Folio == null || !FolioForma.IsMatch(p.Folio)) p.Error(CFolio, "Falta el folio de la iniciativa.");
        else p.Prefijo = p.Folio.Substring(0, 3).ToUpperInvariant();

        Guid llave;
        if (!Guid.TryParse(Limpio(f[CLlave]) ?? "", out llave) || llave == Guid.Empty)
            p.Error(CLlave, "Falta la llave de la solicitud (vuelve a abrir \u00abSolicitar cambios\u00bb).");
        p.Llave = llave;

        string tipo;
        if (!Tipos.TryGetValue(Limpio(f[CTipo]) ?? "", out tipo)) { p.Error(CTipo, "Elige qu\u00e9 quieres cambiar."); }
        p.Tipo = tipo;

        p.Motivo = Limpio(f[CMotivo]);
        if (p.Motivo == null)
            p.Error(CMotivo, tipo == "OTROS" ? "Explica qu\u00e9 hay que corregir." : "Explica el motivo del cambio.");
        else if (p.Motivo.Length > 4000) p.Error(CMotivo, "El motivo pasa de 4000 caracteres.");

        // La fecha va SIEMPRE con su etapa; nunca se deduce del Estado.
        var campo = Limpio(f[CCampoFecha]);
        var fechaTxt = Limpio(f[CFechaNueva]);
        if (campo != null)
        {
            string c;
            if (Campos.TryGetValue(campo, out c)) p.CampoFecha = c;
            else p.Error(CCampoFecha, "La fecha pedida no es de An\u00e1lisis, Soluci\u00f3n ni Cierre.");
        }
        if (fechaTxt != null)
        {
            DateTime d;
            if (DateTime.TryParseExact(fechaTxt, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) p.FechaNueva = d;
            else p.Error(CFechaNueva, "Escribe la nueva fecha compromiso (aaaa-mm-dd).");
        }
        if (fechaTxt != null && campo == null)
            p.Error(CCampoFecha, "Elige a qu\u00e9 etapa (An\u00e1lisis, Soluci\u00f3n o Cierre) corresponde la nueva fecha.");
        if (campo != null && fechaTxt == null)
            p.Error(CFechaNueva, "Escribe la nueva fecha compromiso" + (p.CampoFecha != null ? " de " + Etapas[p.CampoFecha] : "") + ".");

        p.EstadoNuevo = Limpio(f[CEstadoNuevo]);
        p.SubestadoNuevo = Limpio(f[CSubestadoNuevo]);
        if (p.EstadoNuevo != null && p.EstadoNuevo.Length > 100) p.Error(CEstadoNuevo, "El Estado pasa de 100 caracteres.");
        if (p.SubestadoNuevo != null && p.SubestadoNuevo.Length > 100) p.Error(CSubestadoNuevo, "El Subestado pasa de 100 caracteres.");

        bool d1, d2;
        var pcts = Pares.Leer(f, PeticionModificarAdmin.CPctCategoria, PeticionModificarAdmin.CPctValor, out d1);
        var agregar = Pares.Leer(f, PeticionModificarAdmin.CAgregarCategoria, PeticionModificarAdmin.CAgregarPct, out d2);
        if (d1 || d2) p.Error("categoria", "Cada categor\u00eda necesita su %.");
        foreach (var x in pcts) p.AgregarCategoria(x, "PCT");
        foreach (var x in agregar) p.AgregarCategoria(x, "AGREGAR");
        var vistas = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in p.Categorias)
            if (!vistas.Add(c.Categoria)) p.Error("categoria", c.Categoria + " viene dos veces.");

        // DATOS (sql/25): Titulo / PO / SO capturados. Pedido = no vacio (ni
        // solo espacios); que PO / SO sean del catalogo se revisa al APLICAR
        // (la validacion de la edicion directa).
        p.CambiaTitulo = f[CTituloNuevo] != null;
        p.CambiaPo = f[CPoNuevo] != null;
        p.CambiaSo = f[CSoNuevo] != null;
        p.TituloNuevo = Limpio(f[CTituloNuevo]);
        p.PoNuevo = Limpio(f[CPoNuevo]);
        p.SoNuevo = Limpio(f[CSoNuevo]);
        if (p.CambiaTitulo && p.TituloNuevo == null) p.Error(CTituloNuevo, "Escribe el nuevo T\u00edtulo: no puede quedar vac\u00edo.");
        if (p.CambiaPo && p.PoNuevo == null) p.Error(CPoNuevo, "Elige el nuevo Product Owner: no puede quedar vac\u00edo.");
        if (p.CambiaSo && p.SoNuevo == null) p.Error(CSoNuevo, "Elige el nuevo Service Owner: no puede quedar vac\u00edo.");
        if (p.PoNuevo != null && p.PoNuevo.Length > 255) p.Error(CPoNuevo, "El Product Owner pasa de 255 caracteres.");
        if (p.SoNuevo != null && p.SoNuevo.Length > 255) p.Error(CSoNuevo, "El Service Owner pasa de 255 caracteres.");
        var hayDatos = p.CambiaTitulo || p.CambiaPo || p.CambiaSo;

        // VARIOS (sql/34): cada fecha por su etapa, presente = se pide, con
        // fecha valida (dos valores para la misma clave no son una fecha).
        foreach (var par in CamposVarios)
        {
            var txt = f[par.Key];
            if (txt == null) continue;
            DateTime d;
            if (DateTime.TryParseExact(txt.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) p.FechasVarias[par.Value] = d;
            else p.Error(par.Key, "Escribe la nueva fecha compromiso de " + Etapas[par.Value] + " (aaaa-mm-dd).");
        }
        var hayFechasVarias = CamposVarios.Keys.Any(k => f[k] != null);

        // Cada tipo trae solo lo suyo (la misma regla que la base).
        var hayFecha = campo != null || fechaTxt != null;
        var hayEstado = p.EstadoNuevo != null || p.SubestadoNuevo != null;
        var hayCats = p.Categorias.Count > 0;
        if (tipo != "VARIOS" && hayFechasVarias) p.Error(CTipo, "Las fechas por etapa solo van en una solicitud de varios cambios.");
        if (tipo == "VARIOS")
        {
            if (!PersistenciaSolicitudesCambio.SolicitaVariosActiva()) p.Error(CTipo, PersistenciaSolicitudesCambio.MotivoVarios);
            // Titulo / PO / SO dentro de VARIOS siguen necesitando sql/25 y su
            // interruptor: 422 aqui, no una excepcion en el almacen.
            else if (hayDatos && !PersistenciaSolicitudesCambio.SolicitaDatosActiva()) p.Error(CTipo, PersistenciaSolicitudesCambio.MotivoDatos);
            if (hayFecha) p.Error(CCampoFecha, "En una solicitud de varios cambios cada fecha va con su etapa (f_analisis_nueva, f_solucion_nueva, f_cierre_nueva).");
            if (p.SubestadoNuevo != null && p.EstadoNuevo == null) p.Error(CSubestadoNuevo, "El Subestado se pide junto con el Estado.");
            if (p.EstadoNuevo == null && !hayFechasVarias && !hayCats && !hayDatos) p.Error(CTipo, "Agrega al menos un cambio a la solicitud.");
        }
        if (tipo == "DATOS" && !PersistenciaSolicitudesCambio.SolicitaDatosActiva()) p.Error(CTipo, PersistenciaSolicitudesCambio.MotivoDatos);
        else if (tipo == "DATOS" && !hayDatos) p.Error(CTipo, "Elige qu\u00e9 dato quieres cambiar: T\u00edtulo, Product Owner o Service Owner.");
        if (tipo == "DATOS" && (hayFecha || hayEstado || hayCats)) p.Error(CTipo, "Una solicitud de T\u00edtulo / Product Owner / Service Owner no trae fecha, Estado ni categor\u00edas.");
        if (tipo != null && tipo != "DATOS" && tipo != "VARIOS" && hayDatos) p.Error(CTipo, "T\u00edtulo, Product Owner y Service Owner se piden en su propio tipo de solicitud.");
        if (tipo == "FECHA" && (!hayFecha || hayEstado || hayCats)) p.Error(CTipo, "Una solicitud de fecha trae solo la etapa y la fecha nueva.");
        if (tipo == "ESTADO" && p.EstadoNuevo == null) p.Error(CEstadoNuevo, "Elige el nuevo Estado.");
        if (tipo == "ESTADO" && hayCats) p.Error(CTipo, "Una solicitud de Estado no trae categor\u00edas.");
        if (tipo == "CATEGORIAS" && !hayCats) p.Error("categoria", "Escribe el nuevo % de al menos una categor\u00eda o agrega una.");
        if (tipo == "CATEGORIAS" && (hayFecha || hayEstado)) p.Error(CTipo, "Una solicitud de categor\u00edas no trae Estado ni fecha.");
        if (tipo == "OTROS" && (hayFecha || hayEstado || hayCats)) p.Error(CTipo, "\u00abOtros\u00bb es solo una explicaci\u00f3n: no trae valores.");
        return p;
    }

    private void AgregarCategoria(PctCategoria x, string accion)
    {
        var ruta = Limpio(x.Categoria);
        var texto = Limpio(x.Texto);
        if (ruta == null) { Error("categoria", "Una categor\u00eda lleg\u00f3 vac\u00eda."); return; }
        decimal pct;
        if (texto == null || !Porcentaje.IsMatch(texto) || !decimal.TryParse(texto, NumberStyles.Number, CultureInfo.InvariantCulture, out pct) || pct > 100)
        {
            Error("categoria", ruta + ": escribe un porcentaje entre 0 y 100, con hasta dos decimales.");
            return;
        }
        var c = new CategoriaSolicitudCambio { Categoria = ruta, Accion = accion, Texto = texto, Pct = Math.Round(pct / 100m, 4) };
        if (accion == "AGREGAR" && Prefijo != null)
        {
            // Regla de negocio del alta (598712b): prefijo -> Clasificacion ->
            // Agrupacion. Sin regla: vacia (ADM la elige al aplicar).
            c.TipoIniciativa = TiposPorPrefijo.Clasificacion(Prefijo);
            c.TipoAgrupado = TiposPorPrefijo.Agrupacion(c.TipoIniciativa);
            if (c.TipoIniciativa == null || c.TipoAgrupado == null) { c.TipoIniciativa = null; c.TipoAgrupado = null; }
        }
        Categorias.Add(c);
    }
}

// Un 51xxx (o una llave duplicada) de los procedimientos de sql/22 o de
// Modificar, con su estado HTTP y un tipo estable para el navegador.
public sealed class ErrorSolicitudCambio : Exception
{
    public readonly int Numero;
    public ErrorSolicitudCambio(int numero, string mensaje, Exception interna) : base(mensaje, interna) { Numero = numero; }

    public int EstadoHttp
    {
        get
        {
            if (Numero == 51201) return 404;
            if (Numero == 51001 || Numero == 51210) return 403;
            if (Numero == 51202 || Numero == 51204 || Numero == 51221 || Numero == 51010 || Numero == 51008) return 409;
            return 422;
        }
    }

    public string Tipo
    {
        get
        {
            switch (Numero)
            {
                case 51201: return "SolicitudNoExiste";
                case 51202: return "SolicitudYaRevisada";
                case 51204: return "SolicitudDesactualizada";
                case 51206: case 51207: return "FaltaComentario";
                case 51221: return "FaltaClasificacion";
                case 51222: case 51223: return "ClasificacionInvalida";
                case 51010: return "TopeExcedido";
                case 51001: case 51210: return "SinAtribucion";
                default: return "DatoInvalido";
            }
        }
    }
}

public sealed class ResultadoEnvioSolicitud
{
    public int IdSolicitud;
    public bool Repetida;
}

public interface IAlmacenSolicitudesCambio
{
    ResultadoEnvioSolicitud Enviar(PeticionSolicitudCambio p, string usuario, string rol);
    List<Dictionary<string, object>> Listar(string estado, int maximo);
    Dictionary<string, object> Detalle(int idSolicitud);    // null = no existe
    void Rechazar(int idSolicitud, string revisor, string comentario);
    void Aplicar(int idSolicitud, string revisor, string comentario, List<ClasificacionSolicitud> clasificaciones, DateTime hoy);
    void RegistrarFallo(int idSolicitud, string revisor, int numero, string mensaje);
}

// La real: los procedimientos de sql/22 (escritura) y SELECT (lectura). El
// sitio no puede escribir las tablas a mano (DENY de _permisos.sql).
public sealed class AlmacenSolicitudesCambioSql : IAlmacenSolicitudesCambio
{
    private readonly Func<SqlConnection> abrir;

    public AlmacenSolicitudesCambioSql() : this(null) { }
    // abrir: para las pruebas (LocalDB). null = la cadena del sitio.
    public AlmacenSolicitudesCambioSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    private SqlConnection Abrir() { var cn = abrir(); if (cn.State != ConnectionState.Open) cn.Open(); return cn; }

    private static SqlCommand Proc(SqlConnection cn, string nombre)
    {
        return new SqlCommand(nombre, cn) { CommandType = CommandType.StoredProcedure, CommandTimeout = 60 };
    }

    private static void Ejecutar(SqlCommand cmd)
    {
        try { cmd.ExecuteNonQuery(); }
        catch (SqlException ex)
        {
            if (ex.Number >= 51000 && ex.Number < 52000 || ex.Number == 2627 || ex.Number == 2601)
                throw new ErrorSolicitudCambio(ex.Number, ex.Message, ex);
            throw;
        }
    }

    private static object Db(string s) { return string.IsNullOrEmpty(s) ? (object)DBNull.Value : s; }

    public ResultadoEnvioSolicitud Enviar(PeticionSolicitudCambio p, string usuario, string rol)
    {
        using (var cn = Abrir())
        using (var cmd = Proc(cn, "adm.usp_SolicitudCambio_Crear"))
        {
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = Db(usuario);
            cmd.Parameters.Add("@Rol", SqlDbType.VarChar, 3).Value = Db(rol);
            cmd.Parameters.Add("@Llave", SqlDbType.UniqueIdentifier).Value = p.Llave;
            cmd.Parameters.Add("@Codigo", SqlDbType.NVarChar, 100).Value = Db(p.Folio);
            cmd.Parameters.Add("@Tipo", SqlDbType.VarChar, 10).Value = Db(p.Tipo);
            cmd.Parameters.Add("@EstadoNuevo", SqlDbType.NVarChar, 100).Value = Db(p.EstadoNuevo);
            cmd.Parameters.Add("@SubestadoNuevo", SqlDbType.NVarChar, 100).Value = Db(p.SubestadoNuevo);
            cmd.Parameters.Add("@CampoFecha", SqlDbType.VarChar, 13).Value = Db(p.CampoFecha);
            cmd.Parameters.Add("@FechaNueva", SqlDbType.Date).Value = p.FechaNueva.HasValue ? (object)p.FechaNueva.Value.Date : DBNull.Value;
            cmd.Parameters.Add("@Motivo", SqlDbType.NVarChar, 4000).Value = Db(p.Motivo);
            var t = new DataTable();
            t.Columns.Add("Categoria", typeof(string));
            t.Columns.Add("Accion", typeof(string));
            t.Columns.Add("Pct", typeof(decimal));
            t.Columns.Add("TipoIniciativa", typeof(string)).AllowDBNull = true;
            t.Columns.Add("TipoAgrupado", typeof(string)).AllowDBNull = true;
            foreach (var c in p.Categorias) t.Rows.Add(c.Categoria, c.Accion, c.Pct, Db(c.TipoIniciativa), Db(c.TipoAgrupado));
            var cats = cmd.Parameters.Add("@Categorias", SqlDbType.Structured);
            cats.TypeName = "adm.SolicitudCategoriaTipo";
            cats.Value = t;
            var id = cmd.Parameters.Add("@IdSolicitud", SqlDbType.Int);
            id.Direction = ParameterDirection.Output;
            var rep = cmd.Parameters.Add("@Repetida", SqlDbType.Bit);
            rep.Direction = ParameterDirection.Output;
            // sql/25: por nombre y solo con el interruptor; sin el, el
            // procedimiento de sql/22 no los conoce.
            if (PersistenciaSolicitudesCambio.SolicitaDatosActiva())
            {
                cmd.Parameters.Add("@CambiaTitulo", SqlDbType.Bit).Value = p.CambiaTitulo;
                cmd.Parameters.Add("@TituloNuevo", SqlDbType.NVarChar, -1).Value = p.CambiaTitulo ? Db(p.TituloNuevo) : DBNull.Value;
                cmd.Parameters.Add("@CambiaOwnerProblem", SqlDbType.Bit).Value = p.CambiaPo;
                cmd.Parameters.Add("@OwnerProblemNuevo", SqlDbType.NVarChar, 4000).Value = p.CambiaPo ? Db(p.PoNuevo) : DBNull.Value;
                cmd.Parameters.Add("@CambiaOwnerServicio", SqlDbType.Bit).Value = p.CambiaSo;
                cmd.Parameters.Add("@OwnerServicioNuevo", SqlDbType.NVarChar, 4000).Value = p.CambiaSo ? Db(p.SoNuevo) : DBNull.Value;
            }
            else if (p.CambiaTitulo || p.CambiaPo || p.CambiaSo)
                throw new InvalidOperationException("Titulo / PO / SO en una solicitud sin sql/25: no se descartan en silencio.");
            // sql/34: igual, por nombre y solo con su interruptor.
            if (PersistenciaSolicitudesCambio.SolicitaVariosActiva())
            {
                foreach (var etapa in new[] { "FAnalisis", "FSolucion", "FCierre" })
                {
                    DateTime d;
                    var pedida = p.FechasVarias.TryGetValue("Fecha" + etapa.Substring(1), out d);
                    cmd.Parameters.Add("@Cambia" + etapa, SqlDbType.Bit).Value = pedida;
                    cmd.Parameters.Add("@" + etapa + "Nueva", SqlDbType.Date).Value = pedida ? (object)d.Date : DBNull.Value;
                }
            }
            else if (p.FechasVarias.Count > 0 || p.Tipo == "VARIOS")
                throw new InvalidOperationException("Una solicitud de varios cambios sin sql/34: no se parte ni se descarta en silencio.");
            Ejecutar(cmd);
            if (id.Value == null || id.Value == DBNull.Value)
                throw new InvalidOperationException("La base no devolvio el numero de la solicitud.");
            return new ResultadoEnvioSolicitud { IdSolicitud = Convert.ToInt32(id.Value), Repetida = Convert.ToBoolean(rep.Value) };
        }
    }

    public void Rechazar(int idSolicitud, string revisor, string comentario)
    {
        using (var cn = Abrir())
        using (var cmd = Proc(cn, "adm.usp_SolicitudCambio_Rechazar"))
        {
            cmd.Parameters.Add("@IdSolicitud", SqlDbType.Int).Value = idSolicitud;
            cmd.Parameters.Add("@Revisor", SqlDbType.NVarChar, 256).Value = Db(revisor);
            cmd.Parameters.Add("@Comentario", SqlDbType.NVarChar, 4000).Value = Db(comentario);
            Ejecutar(cmd);
        }
    }

    public void Aplicar(int idSolicitud, string revisor, string comentario, List<ClasificacionSolicitud> clasificaciones, DateTime hoy)
    {
        using (var cn = Abrir())
        using (var cmd = Proc(cn, "adm.usp_SolicitudCambio_Aplicar"))
        {
            cmd.Parameters.Add("@IdSolicitud", SqlDbType.Int).Value = idSolicitud;
            cmd.Parameters.Add("@Revisor", SqlDbType.NVarChar, 256).Value = Db(revisor);
            cmd.Parameters.Add("@Comentario", SqlDbType.NVarChar, 4000).Value = Db(comentario);
            var t = new DataTable();
            t.Columns.Add("Categoria", typeof(string));
            t.Columns.Add("TipoIniciativa", typeof(string)).AllowDBNull = true;
            t.Columns.Add("TipoAgrupado", typeof(string)).AllowDBNull = true;
            foreach (var c in clasificaciones ?? new List<ClasificacionSolicitud>())
                t.Rows.Add(c.Categoria, Db(c.TipoIniciativa), Db(c.TipoAgrupado));
            var cls = cmd.Parameters.Add("@Clasificaciones", SqlDbType.Structured);
            cls.TypeName = "adm.SolicitudClasificacionTipo";
            cls.Value = t;
            cmd.Parameters.Add("@Hoy", SqlDbType.Date).Value = hoy.Date;
            Ejecutar(cmd);
        }
    }

    public void RegistrarFallo(int idSolicitud, string revisor, int numero, string mensaje)
    {
        using (var cn = Abrir())
        using (var cmd = Proc(cn, "adm.usp_SolicitudCambio_RegistrarFallo"))
        {
            cmd.Parameters.Add("@IdSolicitud", SqlDbType.Int).Value = idSolicitud;
            cmd.Parameters.Add("@Revisor", SqlDbType.NVarChar, 256).Value = Db(revisor);
            cmd.Parameters.Add("@Numero", SqlDbType.Int).Value = numero;
            var m = mensaje ?? "";
            cmd.Parameters.Add("@Mensaje", SqlDbType.NVarChar, 2000).Value = m.Length > 2000 ? m.Substring(0, 2000) : m;
            Ejecutar(cmd);
        }
    }

    private const string CabeceraBase = @"
SELECT s.IdSolicitud, s.Codigo, p.Titulo, s.Tipo, s.EstadoAnterior, s.EstadoNuevo, s.SubestadoAnterior, s.SubestadoNuevo,
       s.CampoFecha, s.FechaAnterior, s.FechaNueva, s.Motivo, s.SolicitadoPor, s.RolSolicitante, s.FechaSolicitudUtc,
       s.Estado, s.RevisadoPor, s.FechaRevisionUtc, s.ComentarioRevision, s.Intentos, s.UltimoError, s.FechaUltimoIntentoUtc,
       Categorias = (SELECT COUNT(*) FROM adm.SolicitudCambioCategoria AS c WHERE c.IdSolicitud = s.IdSolicitud),
       SinClasificar = (SELECT COUNT(*) FROM adm.SolicitudCambioCategoria AS c
                        WHERE c.IdSolicitud = s.IdSolicitud AND c.Accion = 'AGREGAR' AND (c.TipoIniciativa IS NULL OR c.TipoAgrupado IS NULL)),
       EstadoActual = p.Estado, SubestadoActual = p.Subestado, p.FechaAnalisis, p.FechaSolucion, p.FechaCierre,
       PoActual = p.OwnerProblem, SoActual = p.OwnerServicio,
{0},
{1}
FROM adm.SolicitudCambio AS s
LEFT JOIN dbo.Problem AS p ON p.Codigo = s.Codigo";
    // Columnas de sql/25; sin ella no existen y se leen como vacias.
    private const string ColumnasDatos =
        "       s.CambiaTitulo, s.TituloAnterior, s.TituloNuevo, s.CambiaOwnerProblem, s.OwnerProblemAnterior, s.OwnerProblemNuevo,\n" +
        "       s.CambiaOwnerServicio, s.OwnerServicioAnterior, s.OwnerServicioNuevo";
    private const string ColumnasDatosVacias =
        "       CambiaTitulo = CONVERT(bit, 0), TituloAnterior = CONVERT(nvarchar(max), NULL), TituloNuevo = CONVERT(nvarchar(max), NULL),\n" +
        "       CambiaOwnerProblem = CONVERT(bit, 0), OwnerProblemAnterior = CONVERT(nvarchar(255), NULL), OwnerProblemNuevo = CONVERT(nvarchar(255), NULL),\n" +
        "       CambiaOwnerServicio = CONVERT(bit, 0), OwnerServicioAnterior = CONVERT(nvarchar(255), NULL), OwnerServicioNuevo = CONVERT(nvarchar(255), NULL)";

    // Columnas de sql/34 (fechas por etapa de VARIOS); sin ella, vacias.
    private const string ColumnasVarios =
        "       s.CambiaFAnalisis, s.FAnalisisAnterior, s.FAnalisisNueva, s.CambiaFSolucion, s.FSolucionAnterior, s.FSolucionNueva,\n" +
        "       s.CambiaFCierre, s.FCierreAnterior, s.FCierreNueva";
    private const string ColumnasVariosVacias =
        "       CambiaFAnalisis = CONVERT(bit, 0), FAnalisisAnterior = CONVERT(date, NULL), FAnalisisNueva = CONVERT(date, NULL),\n" +
        "       CambiaFSolucion = CONVERT(bit, 0), FSolucionAnterior = CONVERT(date, NULL), FSolucionNueva = CONVERT(date, NULL),\n" +
        "       CambiaFCierre = CONVERT(bit, 0), FCierreAnterior = CONVERT(date, NULL), FCierreNueva = CONVERT(date, NULL)";

    private static string Cabecera
    {
        get
        {
            return CabeceraBase.Replace("{0}", PersistenciaSolicitudesCambio.SolicitaDatosActiva() ? ColumnasDatos : ColumnasDatosVacias)
                               .Replace("{1}", PersistenciaSolicitudesCambio.SolicitaVariosActiva() ? ColumnasVarios : ColumnasVariosVacias);
        }
    }

    public List<Dictionary<string, object>> Listar(string estado, int maximo)
    {
        var sql = "SELECT TOP (@max) * FROM (" + Cabecera + @") AS x
WHERE (@estado IS NULL OR x.Estado = @estado)
ORDER BY CASE WHEN x.Estado = 'PENDIENTE' THEN 0 ELSE 1 END,
         CASE WHEN x.Estado = 'PENDIENTE' THEN x.FechaSolicitudUtc END ASC,
         x.FechaSolicitudUtc DESC;";
        var salida = new List<Dictionary<string, object>>();
        using (var cn = Abrir())
        using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 60 })
        {
            cmd.Parameters.Add("@max", SqlDbType.Int).Value = Math.Max(1, Math.Min(maximo, 500));
            cmd.Parameters.Add("@estado", SqlDbType.VarChar, 10).Value = Db(estado);
            using (var r = cmd.ExecuteReader())
                while (r.Read()) salida.Add(Fila(r));
        }
        return salida;
    }

    public Dictionary<string, object> Detalle(int idSolicitud)
    {
        var sql = Cabecera + @"
WHERE s.IdSolicitud = @id;
SELECT c.Categoria, c.Accion, c.PctAnterior, c.PctNuevo, c.TipoIniciativa, c.TipoAgrupado,
       PctActual = pc.PctDisminucion, Ligada = CASE WHEN pc.Codigo IS NOT NULL AND pc.VigenteEnOrigen = 1 THEN 1 ELSE 0 END,
       LigadaAlgunaVez = CASE WHEN pc.Codigo IS NOT NULL THEN 1 ELSE 0 END
FROM adm.SolicitudCambioCategoria AS c
INNER JOIN adm.SolicitudCambio AS s ON s.IdSolicitud = c.IdSolicitud
LEFT JOIN dbo.ProblemCategoria AS pc ON pc.Codigo = s.Codigo AND pc.Categoria = c.Categoria
WHERE c.IdSolicitud = @id ORDER BY c.Accion DESC, c.Categoria;
SELECT e.IdEvento, e.Evento, e.Usuario, e.FechaUtc, e.Detalle
FROM adm.SolicitudCambioEvento AS e WHERE e.IdSolicitud = @id ORDER BY e.IdEvento;";
        using (var cn = Abrir())
        using (var cmd = new SqlCommand(sql, cn) { CommandTimeout = 60 })
        {
            cmd.Parameters.Add("@id", SqlDbType.Int).Value = idSolicitud;
            using (var r = cmd.ExecuteReader())
            {
                if (!r.Read()) return null;
                var d = Fila(r);
                r.NextResult();
                var cats = new List<object>();
                while (r.Read())
                {
                    cats.Add(new Dictionary<string, object>
                    {
                        { "categoria", Texto(r, 0) }, { "accion", Texto(r, 1) },
                        { "pct_anterior", Pct(r, 2) }, { "pct_nuevo", Pct(r, 3) },
                        { "tipo_iniciativa", Texto(r, 4) }, { "tipo_agrupado", Texto(r, 5) },
                        { "pct_actual", Pct(r, 6) }, { "ligada", Convert.ToInt32(r.GetValue(7)) == 1 },
                        { "ligada_alguna_vez", Convert.ToInt32(r.GetValue(8)) == 1 },
                    });
                }
                d["categorias_detalle"] = cats;
                r.NextResult();
                var ev = new List<object>();
                while (r.Read())
                {
                    ev.Add(new Dictionary<string, object>
                    {
                        { "id", Convert.ToInt32(r.GetValue(0)) }, { "evento", Texto(r, 1) }, { "usuario", Texto(r, 2) },
                        { "fecha_utc", Utc(r, 3) }, { "detalle", Texto(r, 4) },
                    });
                }
                d["eventos"] = ev;
                d["desactualizada"] = SolicitudesCambio.Desactualizada(d);
                return d;
            }
        }
    }

    private static string Texto(SqlDataReader r, int i) { return r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture); }
    private static string Iso(SqlDataReader r, int i) { return r.IsDBNull(i) ? null : Convert.ToDateTime(r.GetValue(i)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
    private static string Utc(SqlDataReader r, int i) { return r.IsDBNull(i) ? null : Convert.ToDateTime(r.GetValue(i)).ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "Z"; }
    // Fraccion 0-1 -> % en texto ("30", "12.5"), como el registro.
    private static string Pct(SqlDataReader r, int i)
    {
        if (r.IsDBNull(i)) return null;
        return (Convert.ToDecimal(r.GetValue(i)) * 100m).ToString("0.##", CultureInfo.InvariantCulture);
    }

    private static Dictionary<string, object> Fila(SqlDataReader r)
    {
        var campo = Texto(r, r.GetOrdinal("CampoFecha"));
        var d = new Dictionary<string, object>
        {
            { "id", Convert.ToInt32(r["IdSolicitud"]) }, { "folio", Texto(r, r.GetOrdinal("Codigo")) },
            { "titulo", Texto(r, r.GetOrdinal("Titulo")) }, { "tipo", Texto(r, r.GetOrdinal("Tipo")) },
            { "estado_anterior", Texto(r, r.GetOrdinal("EstadoAnterior")) }, { "estado_nuevo", Texto(r, r.GetOrdinal("EstadoNuevo")) },
            { "subestado_anterior", Texto(r, r.GetOrdinal("SubestadoAnterior")) }, { "subestado_nuevo", Texto(r, r.GetOrdinal("SubestadoNuevo")) },
            { "campo_fecha", campo }, { "etapa", campo != null && PeticionSolicitudCambio.Etapas.ContainsKey(campo) ? PeticionSolicitudCambio.Etapas[campo] : null },
            { "fecha_anterior", Iso(r, r.GetOrdinal("FechaAnterior")) }, { "fecha_nueva", Iso(r, r.GetOrdinal("FechaNueva")) },
            { "motivo", Texto(r, r.GetOrdinal("Motivo")) }, { "solicitado_por", Texto(r, r.GetOrdinal("SolicitadoPor")) },
            { "rol_solicitante", Texto(r, r.GetOrdinal("RolSolicitante")) }, { "fecha_solicitud_utc", Utc(r, r.GetOrdinal("FechaSolicitudUtc")) },
            { "estado", Texto(r, r.GetOrdinal("Estado")) }, { "revisado_por", Texto(r, r.GetOrdinal("RevisadoPor")) },
            { "fecha_revision_utc", Utc(r, r.GetOrdinal("FechaRevisionUtc")) }, { "comentario_revision", Texto(r, r.GetOrdinal("ComentarioRevision")) },
            { "intentos", Convert.ToInt32(r["Intentos"]) }, { "ultimo_error", Texto(r, r.GetOrdinal("UltimoError")) },
            { "fecha_ultimo_intento_utc", Utc(r, r.GetOrdinal("FechaUltimoIntentoUtc")) },
            { "categorias", Convert.ToInt32(r["Categorias"]) }, { "sin_clasificar", Convert.ToInt32(r["SinClasificar"]) },
        };
        var actual = new Dictionary<string, object>
        {
            { "estado", Texto(r, r.GetOrdinal("EstadoActual")) }, { "subestado", Texto(r, r.GetOrdinal("SubestadoActual")) },
            { "FechaAnalisis", Iso(r, r.GetOrdinal("FechaAnalisis")) }, { "FechaSolucion", Iso(r, r.GetOrdinal("FechaSolucion")) },
            { "FechaCierre", Iso(r, r.GetOrdinal("FechaCierre")) },
            // sql/25: lo que hay ahora de Titulo / PO / SO capturados.
            { "titulo", Texto(r, r.GetOrdinal("Titulo")) }, { "po", Texto(r, r.GetOrdinal("PoActual")) },
            { "so", Texto(r, r.GetOrdinal("SoActual")) },
        };
        // DATOS (sql/25): cada dato con su bandera, su anterior y su nuevo
        // (null = vacio). Sin sql/25 las banderas llegan en false.
        d["cambia_titulo"] = Convert.ToBoolean(r["CambiaTitulo"]);
        d["titulo_anterior"] = Texto(r, r.GetOrdinal("TituloAnterior"));
        d["titulo_nuevo"] = Texto(r, r.GetOrdinal("TituloNuevo"));
        d["cambia_po"] = Convert.ToBoolean(r["CambiaOwnerProblem"]);
        d["po_anterior"] = Texto(r, r.GetOrdinal("OwnerProblemAnterior"));
        d["po_nuevo"] = Texto(r, r.GetOrdinal("OwnerProblemNuevo"));
        d["cambia_so"] = Convert.ToBoolean(r["CambiaOwnerServicio"]);
        d["so_anterior"] = Texto(r, r.GetOrdinal("OwnerServicioAnterior"));
        d["so_nuevo"] = Texto(r, r.GetOrdinal("OwnerServicioNuevo"));
        d["actual"] = actual;
        d["fecha_actual"] = campo != null && actual.ContainsKey(campo) ? actual[campo] : null;
        // VARIOS (sql/34): las fechas pedidas, cada una con su etapa, su
        // anterior, su nueva y la de ahora. Sin sql/34, ninguna.
        var fechas = new List<object>();
        foreach (var campoVarios in new[] { "FechaAnalisis", "FechaSolucion", "FechaCierre" })
        {
            var col = "F" + campoVarios.Substring(5);
            if (!Convert.ToBoolean(r["Cambia" + col])) continue;
            fechas.Add(new Dictionary<string, object>
            {
                { "campo", campoVarios }, { "etapa", PeticionSolicitudCambio.Etapas[campoVarios] },
                { "anterior", Iso(r, r.GetOrdinal(col + "Anterior")) }, { "nueva", Iso(r, r.GetOrdinal(col + "Nueva")) },
                { "actual", actual[campoVarios] },
            });
        }
        d["fechas_varias"] = fechas;
        return d;
    }
}

public static class SolicitudesCambio
{
    // El handler usa estos; las pruebas los cambian por falsos.
    public static IAlmacenSolicitudesCambio Almacen = new AlmacenSolicitudesCambioSql();
    public static Func<NameValueCollection, ValidacionAplicar> ValidarAplicacion = ValidacionAplicar.ComoEdicionDirecta;
    // Para PeticionSolicitudCambio.ExigirCatalogo. Si una lectura falla, la
    // excepcion sube: el handler no envia nada.
    //   DuenosCapturados(folio) -> { po, so } de dbo.Problem (null = sin
    //                              capturar; sin la iniciativa, los dos null)
    //   RutasAgregables(po, so) -> las rutas del catalogo de ESE par
    public static Func<string, string[]> DuenosCapturados = LeerDuenosCapturados;
    public static Func<string, string, ICollection<string>> RutasAgregables = LeerRutasAgregables;
    // Detalle de ADM: la capacidad de todas las rutas (una lectura) para las
    // otras iniciativas activas de cada categoria (CapacidadCategoria.Otras).
    public static Func<CapacidadCategoria> Capacidad = IniciativaService.CapacidadActual;

    // Cuelga de cada categoria del detalle sus otras_iniciativas (sin la
    // iniciativa de la solicitud). Si no se pueden leer: null en cada una y
    // el detalle se muestra igual. Solo lectura; solo lo pide el detalle de ADM.
    public static void AgregarOtrasIniciativas(Dictionary<string, object> d)
    {
        object cats;
        if (d == null || !d.TryGetValue("categorias_detalle", out cats) || !(cats is List<object>)) return;
        var lista = (List<object>)cats;
        if (lista.Count == 0) return;
        var folio = d.ContainsKey("folio") ? d["folio"] as string : null;
        CapacidadCategoria cap = null;
        try { cap = Capacidad(); }
        catch (Exception ex) { DashboardHandler.Registrar("admin_iniciativas_solicitudes.ashx", ex); }
        foreach (Dictionary<string, object> c in lista)
            c["otras_iniciativas"] = cap == null ? null : (object)cap.Otras(c["categoria"] as string, folio);
    }

    // ENVIO: el tope de 100% por categoria con LA MISMA regla que aplicar
    // (TopeModificacion, la de ValidadorGestionAdmin.Modificar), para que lo
    // que se guarda ya quepa. Lo que se lee para revisarlo:
    //   Actual       la iniciativa de la MISMA lectura del registro que usa
    //                Modificar (null = no esta en el registro vigente)
    //   Compromisos  ExperienciaQueries.CompromisosCapacidad
    // Si una lectura falla, la excepcion sube: el handler responde 503 y no
    // envia nada. Solo lectura. Las pruebas la cambian por una falsa.
    public sealed class DatosCapacidad
    {
        public IniciativaActual Actual;
        public List<CapacidadCategoria.Compromiso> Compromisos = new List<CapacidadCategoria.Compromiso>();
    }
    public static Func<string, DatosCapacidad> LeerCapacidad = LeerCapacidadEnvio;

    // Solo los tipos que pueden tocar la capacidad: categorias (pedir % o
    // agregar), Estado (reactivar) y varios.
    public static bool RevisaCapacidad(PeticionSolicitudCambio p)
    {
        return p != null && (p.Tipo == "CATEGORIAS" || p.Tipo == "ESTADO" || p.Tipo == "VARIOS");
    }

    // La solicitud como la veria Modificar al aplicarla (SolicitudesCambio
    // .ComoModificar): Estado final = el pedido o el actual; cada % pedido
    // de una ligada, cada categoria por agregar con la Agrupacion de su
    // prefijo (sin regla = sin declarar: consume) y las ligadas que pasan a
    // consumir al reactivar. Lo que no es de esa forma (una ruta que no esta
    // ligada, una por agregar que ya lo esta, la iniciativa fuera del
    // registro) lo rechaza la validacion de aplicar con su propio mensaje:
    // aqui no se inventa otro. -> los motivos (vacia = cabe).
    public static List<string> ErroresCapacidad(PeticionSolicitudCambio p, DatosCapacidad d)
    {
        var motivos = new List<string>();
        if (!RevisaCapacidad(p) || d == null || d.Actual == null) return motivos;
        var actual = d.Actual;
        var estadoNuevo = string.IsNullOrWhiteSpace(p.EstadoNuevo) ? null : p.EstadoNuevo.Trim();
        var tope = new TopeModificacion(actual, d.Compromisos, estadoNuevo ?? actual.Estado);
        foreach (var c in p.Categorias.Where(x => x.Accion == "PCT"))
        {
            var ligada = actual.Ligada(c.Categoria);
            if (ligada == null) continue;
            var motivo = tope.Ligada(ligada, c.Pct, ligada.Agrup);
            if (motivo != null) motivos.Add(motivo);
        }
        foreach (var c in p.Categorias.Where(x => x.Accion == "AGREGAR"))
        {
            if (actual.Ligada(c.Categoria) != null) continue;
            var motivo = tope.Agregada(c.Categoria, c.Pct, c.TipoAgrupado);
            if (motivo != null) motivos.Add(motivo);
        }
        motivos.AddRange(tope.Reactivadas(null, null));
        return motivos;
    }

    private static DatosCapacidad LeerCapacidadEnvio(string folio)
    {
        var d = new DatosCapacidad();
        var registro = ExperienciaQueries.RegistroIniciativas();
        var iniciativas = registro == null ? null : registro["iniciativas"] as List<object>;
        if (iniciativas == null) throw new InvalidOperationException("El registro de iniciativas no trae la lista de iniciativas.");
        foreach (Dictionary<string, object> i in iniciativas)
        {
            if (string.Equals(i["folio"] as string, (folio ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
            {
                d.Actual = IniciativaActual.DesdeRegistro(i);
                break;
            }
        }
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            d.Compromisos = ExperienciaQueries.CompromisosCapacidad(cn);
        }
        return d;
    }

    private static string[] LeerDuenosCapturados(string folio)
    {
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand("SELECT OwnerProblem, OwnerServicio FROM dbo.Problem WHERE Codigo = @c;", cn))
        {
            cmd.Parameters.Add("@c", SqlDbType.NVarChar, 100).Value = folio ?? "";
            cn.Open();
            using (var rd = cmd.ExecuteReader())
            {
                if (!rd.Read()) return new string[] { null, null };
                return new[] { rd.IsDBNull(0) ? null : DirectorioOrganizacional.Normaliza(Convert.ToString(rd.GetValue(0))),
                               rd.IsDBNull(1) ? null : DirectorioOrganizacional.Normaliza(Convert.ToString(rd.GetValue(1))) };
            }
        }
    }

    // La MISMA lista que la cascada de Nueva solicitud y que "Solicitar
    // cambios" recibe en el navegador (admin_iniciativas_catalogos.ashx
    // ?rutas=1, "rutas"), solo las filas de ese PO y ese SO. Solo lectura.
    private static ICollection<string> LeerRutasAgregables(string po, string so)
    {
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            var dir = DirectorioOrganizacional.Cargar(cn);
            var r = CatalogoRutasIniciativa.Asignaciones(CatalogoRutasIniciativa.LeerRutasActivas(cn), dir);
            return RutasDelPar((List<object>)r["rutas"], po, so);
        }
    }

    // Las rutas (normalizadas) de las filas { po, so, categoria } de ese par:
    // igualdad exacta de PO y SO, como CascadaOrganizacional. Aparte para
    // probarla sin SQL.
    public static ICollection<string> RutasDelPar(IEnumerable<object> filas, string po, string so)
    {
        var salida = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var p = DirectorioOrganizacional.Normaliza(po);
        var s = DirectorioOrganizacional.Normaliza(so);
        if (p == null || s == null) return salida;
        foreach (Dictionary<string, object> f in filas ?? new object[0])
        {
            if (!string.Equals(DirectorioOrganizacional.Normaliza(f["po"] as string), p, StringComparison.Ordinal)) continue;
            if (!string.Equals(DirectorioOrganizacional.Normaliza(f["so"] as string), s, StringComparison.Ordinal)) continue;
            var ruta = DirectorioOrganizacional.Normaliza(f["categoria"] as string);
            if (ruta != null) salida.Add(ruta);
        }
        return salida;
    }

    // Los datos de DATOS (sql/25), con el nombre de su clave en el detalle.
    private static readonly string[] Datos = { "titulo", "po", "so" };

    // Un detalle armado sin sql/25 (o por las pruebas) puede no traerlas.
    private static bool Bandera(Dictionary<string, object> d, string clave)
    {
        object v;
        return d.TryGetValue(clave, out v) && v is bool && (bool)v;
    }

    private static string Valor(Dictionary<string, object> d, string clave)
    {
        object v;
        return d.TryGetValue(clave, out v) ? v as string : null;
    }

    // ESTADO siempre pide Estado; VARIOS, solo si trae uno nuevo.
    public static bool PideEstado(Dictionary<string, object> d)
    {
        var tipo = d["tipo"] as string;
        return tipo == "ESTADO" || (tipo == "VARIOS" && d["estado_nuevo"] != null);
    }

    // Las fechas por etapa de VARIOS (sql/34); un detalle sin ellas, ninguna.
    public static List<Dictionary<string, object>> FechasVarias(Dictionary<string, object> d)
    {
        object v;
        return d.TryGetValue("fechas_varias", out v) && v is List<object>
            ? ((List<object>)v).Cast<Dictionary<string, object>>().ToList()
            : new List<Dictionary<string, object>>();
    }

    // DATOS: los datos pedidos (bandera) con el nuevo vacio -> sus nombres.
    public static List<string> DatosVacios(Dictionary<string, object> d)
    {
        var vacios = new List<string>();
        if ((d["tipo"] as string) != "DATOS") return vacios;
        var nombres = new[] { "el T\u00edtulo", "el Product Owner", "el Service Owner" };
        for (var n = 0; n < Datos.Length; n++)
            if (Bandera(d, "cambia_" + Datos[n]) && string.IsNullOrWhiteSpace(Valor(d, Datos[n] + "_nuevo")))
                vacios.Add(nombres[n]);
        return vacios;
    }

    // Solo lectura, para avisar a ADM ANTES de aplicar (la base lo vuelve a
    // revisar bajo candado: esto no decide nada). Misma regla que Aplicar.
    public static bool Desactualizada(Dictionary<string, object> d)
    {
        if ((d["estado"] as string) != "PENDIENTE" || (d["tipo"] as string) == "OTROS") return false;
        var actual = (Dictionary<string, object>)d["actual"];
        if (PideEstado(d)
            && (!string.Equals(actual["estado"] as string ?? "", d["estado_anterior"] as string ?? "", StringComparison.Ordinal)
                || !string.Equals(actual["subestado"] as string ?? "", d["subestado_anterior"] as string ?? "", StringComparison.Ordinal)))
            return true;
        if (d["campo_fecha"] != null && !string.Equals(d["fecha_actual"] as string ?? "", d["fecha_anterior"] as string ?? "", StringComparison.Ordinal))
            return true;
        // VARIOS (sql/34): cada fecha pedida contra la de ahora.
        foreach (var x in FechasVarias(d))
            if (!string.Equals(x["actual"] as string ?? "", x["anterior"] as string ?? "", StringComparison.Ordinal))
                return true;
        // DATOS (sql/25): el texto exacto, como la comparacion en binario de Aplicar.
        foreach (var dato in Datos)
            if (Bandera(d, "cambia_" + dato)
                && !string.Equals(Valor(actual, dato) ?? "", Valor(d, dato + "_anterior") ?? "", StringComparison.Ordinal))
                return true;
        object cats;
        if (d.TryGetValue("categorias_detalle", out cats))
            foreach (Dictionary<string, object> c in (List<object>)cats)
            {
                if ((c["accion"] as string) == "PCT"
                    && (!(bool)c["ligada"] || !string.Equals(c["pct_actual"] as string ?? "", c["pct_anterior"] as string ?? "", StringComparison.Ordinal)))
                    return true;
                if ((c["accion"] as string) == "AGREGAR" && (bool)c["ligada_alguna_vez"]) return true;
            }
        return false;
    }

    // La solicitud guardada como el formulario accion=modificar de la edicion
    // directa (los mismos nombres que PeticionModificarAdmin), para validarla
    // con LA MISMA validacion antes de aplicar. Las categorias por agregar
    // llevan su clasificacion (la guardada o la que da ADM). Nada viene del
    // navegador salvo la clasificacion de ADM.
    public static NameValueCollection ComoModificar(Dictionary<string, object> d, List<ClasificacionSolicitud> clasificaciones)
    {
        var f = new NameValueCollection();
        f["accion"] = "modificar";
        f[PeticionModificarAdmin.CFolio] = d["folio"] as string;
        var tipo = d["tipo"] as string;
        if (PideEstado(d))
        {
            f[PeticionModificarAdmin.CEstado] = d["estado_nuevo"] as string;
            if (d["subestado_nuevo"] != null) f[PeticionModificarAdmin.CSubestado] = d["subestado_nuevo"] as string;
        }
        var campo = d["campo_fecha"] as string;
        if (campo != null)
        {
            var clave = PeticionSolicitudCambio.Campos.First(x => x.Value == campo).Key;
            f[clave] = d["fecha_nueva"] as string;
        }
        // VARIOS (sql/34): cada fecha pedida con la clave de su etapa.
        foreach (var x in FechasVarias(d))
        {
            var clave = PeticionSolicitudCambio.Campos.First(c => c.Value == (x["campo"] as string)).Key;
            f[clave] = x["nueva"] as string;
        }
        // DATOS (sql/25) y VARIOS: las claves de la edicion directa (titulo /
        // po / so); "" = que quede vacio. Asi pasan por el MISMO validador
        // (catalogo de duenos, ValidadorGestionAdmin.DuenoCapturado) contra lo
        // de ahora.
        if (tipo == "DATOS" || tipo == "VARIOS")
        {
            if (Bandera(d, "cambia_titulo")) f[SolicitudIniciativa.CTitulo] = Valor(d, "titulo_nuevo") ?? "";
            if (Bandera(d, "cambia_po")) f[SolicitudIniciativa.CPo] = Valor(d, "po_nuevo") ?? "";
            if (Bandera(d, "cambia_so")) f[SolicitudIniciativa.CSo] = Valor(d, "so_nuevo") ?? "";
        }
        object cats;
        if (d.TryGetValue("categorias_detalle", out cats))
            foreach (Dictionary<string, object> c in (List<object>)cats)
            {
                if ((c["accion"] as string) == "PCT")
                {
                    f.Add(PeticionModificarAdmin.CPctCategoria, c["categoria"] as string);
                    f.Add(PeticionModificarAdmin.CPctValor, c["pct_nuevo"] as string);
                }
                else
                {
                    var ruta = c["categoria"] as string;
                    var ti = c["tipo_iniciativa"] as string;
                    var ta = c["tipo_agrupado"] as string;
                    var adm = (clasificaciones ?? new List<ClasificacionSolicitud>())
                        .FirstOrDefault(x => string.Equals((x.Categoria ?? "").Trim(), ruta, StringComparison.Ordinal));
                    if (ti == null && ta == null && adm != null) { ti = adm.TipoIniciativa; ta = adm.TipoAgrupado; }
                    f.Add(PeticionModificarAdmin.CAgregarCategoria, ruta);
                    f.Add(PeticionModificarAdmin.CAgregarPct, c["pct_nuevo"] as string);
                    f.Add(PeticionModificarAdmin.CAgregarTipoIniciativa, ti ?? "");
                    f.Add(PeticionModificarAdmin.CAgregarTipoAgrupado, ta ?? "");
                }
            }
        return f;
    }
}

// Resultado de validar una solicitud como edicion directa.
public sealed class ValidacionAplicar
{
    public bool Valida;
    public List<ErrorCampo> Errores = new List<ErrorCampo>();
    public List<string> Pendientes = new List<string>();

    public string Mensaje()
    {
        var partes = Errores.Select(e => e.Mensaje).Concat(Pendientes).Where(s => !string.IsNullOrEmpty(s)).ToList();
        return partes.Count == 0 ? "La validaci\u00f3n de la aplicaci\u00f3n no pas\u00f3." : string.Join(" ", partes.ToArray());
    }

    // La misma cadena que admin_iniciativas_gestion.ashx con accion=modificar:
    // formato, catalogo / capacidad / Estado (GestionIniciativaAdminService)
    // y plan sin pendientes. Lee la base; no escribe.
    public static ValidacionAplicar ComoEdicionDirecta(NameValueCollection f)
    {
        var salida = new ValidacionAplicar();
        var p = PeticionModificarAdmin.DesdeFormulario(f);
        var formato = new ValidadorGestionAdmin().FormatoModificar(p);
        if (!formato.Valida) { salida.Errores.AddRange(formato.Errores); return salida; }
        var servicio = new GestionIniciativaAdminService();
        var r = servicio.Modificar(p);
        if (!r.Valida) { salida.Errores.AddRange(r.Errores); return salida; }
        var plan = PlanificadorGestionAdmin.Modificar(p, servicio.Actual, r, DashboardDataInfo.HoyEnPresentacion());
        salida.Pendientes.AddRange(plan.Pendientes);
        salida.Valida = plan.Pendientes.Count == 0;
        return salida;
    }
}

// Aplicar = validar como la edicion directa + adm.usp_SolicitudCambio_Aplicar.
// Toda falla de validacion queda registrada (la solicitud sigue PENDIENTE).
public sealed class AplicadorSolicitudCambio
{
    // 51230: numero propio de "la validacion de la aplicacion no paso" (no
    // sale de la base: lo registra RegistrarFallo).
    public const int NumeroValidacion = 51230;

    private readonly IAlmacenSolicitudesCambio almacen;
    private readonly Func<NameValueCollection, ValidacionAplicar> validar;

    public AplicadorSolicitudCambio(IAlmacenSolicitudesCambio almacen, Func<NameValueCollection, ValidacionAplicar> validar)
    {
        this.almacen = almacen;
        this.validar = validar;
    }

    // -> null si se aplico; si no, lo que hay que responder (lanza
    // ErrorSolicitudCambio para los errores de la base).
    public Dictionary<string, object> Aplicar(int id, string revisor, string comentario,
                                              List<ClasificacionSolicitud> clasificaciones, DateTime hoy)
    {
        var d = almacen.Detalle(id);
        if (d == null) throw new ErrorSolicitudCambio(51201, "La solicitud no existe.", null);
        if ((d["estado"] as string) != "PENDIENTE") throw new ErrorSolicitudCambio(51202, "La solicitud ya fue revisada (aplicada o rechazada).", null);
        // DATOS: un dato pedido y vacio (guardado antes de que el envio lo
        // rechazara) dejaria vacio el Titulo / PO / SO de la iniciativa: la
        // edicion directa solo lo advierte. Nunca se aplica.
        var vacios = SolicitudesCambio.DatosVacios(d);
        if (vacios.Count > 0)
        {
            var msg = "No se aplica: la solicitud dejar\u00eda vac\u00edo " + string.Join(", ", vacios.ToArray()) + ".";
            almacen.RegistrarFallo(id, revisor, NumeroValidacion, msg);
            return new Dictionary<string, object> { { "error", msg }, { "tipo", "ValidacionFallida" }, { "aplicada", false }, { "estado_http", 422 } };
        }
        if ((d["tipo"] as string) != "OTROS")
        {
            var f = SolicitudesCambio.ComoModificar(d, clasificaciones);
            var sinClasificar = ((List<object>)d["categorias_detalle"]).Cast<Dictionary<string, object>>()
                .Where(c => (c["accion"] as string) == "AGREGAR" && (c["tipo_iniciativa"] == null || c["tipo_agrupado"] == null))
                .Select(c => c["categoria"] as string)
                .Where(ruta => !(clasificaciones ?? new List<ClasificacionSolicitud>()).Any(x => string.Equals((x.Categoria ?? "").Trim(), ruta, StringComparison.Ordinal)
                                                                                                && !string.IsNullOrWhiteSpace(x.TipoIniciativa)
                                                                                                && !string.IsNullOrWhiteSpace(x.TipoAgrupado)))
                .ToList();
            if (sinClasificar.Count > 0)
            {
                var msg = "Falta la clasificaci\u00f3n (Tipo de iniciativa y Agrupaci\u00f3n) de: " + string.Join(", ", sinClasificar.ToArray()) + ".";
                almacen.RegistrarFallo(id, revisor, 51221, msg);
                return new Dictionary<string, object> { { "error", msg }, { "tipo", "FaltaClasificacion" }, { "aplicada", false },
                                                        { "sin_clasificar", sinClasificar }, { "estado_http", 409 } };
            }
            ValidacionAplicar v;
            try { v = validar(f); }
            catch (Exception ex)
            {
                // Sin catalogo no se afirma nada: no es un intento de aplicar.
                return new Dictionary<string, object> { { "error", "No se pudo validar contra el cat\u00e1logo: " + DashboardHandler.MensajeSeguro(ex) },
                                                        { "tipo", "ValidacionNoDisponible" }, { "aplicada", false }, { "estado_http", 503 } };
            }
            if (!v.Valida)
            {
                var msg = v.Mensaje();
                almacen.RegistrarFallo(id, revisor, NumeroValidacion, msg);
                var errores = v.Errores.Select(e => (object)new Dictionary<string, object> { { "campo", e.Campo }, { "mensaje", e.Mensaje } }).ToList();
                return new Dictionary<string, object> { { "error", "No se aplic\u00f3: " + msg }, { "tipo", "ValidacionFallida" }, { "aplicada", false },
                                                        { "errores", errores }, { "pendientes", v.Pendientes }, { "estado_http", 422 } };
            }
        }
        almacen.Aplicar(id, revisor, comentario, clasificaciones, hoy);
        return null;
    }
}
