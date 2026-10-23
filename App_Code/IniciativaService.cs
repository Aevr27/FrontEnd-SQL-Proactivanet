// Servicio de Nueva solicitud (Admin -> Iniciativas): arma, en el momento
// de cada llamada, lo que el validador necesita y lo valida. Los handlers
// solo traducen HTTP; las reglas estan en ValidadorIniciativa
// (App_Code/SolicitudIniciativa.cs).
//
//   Capacidad(categoria)  lo que la pantalla muestra al elegir la categoria.
//   Solicitar(solicitud, identidad)
//                         vuelve a leer catalogo y capacidad y valida. Es
//                         la AUTORIDAD: si entre que se abrio el formulario
//                         y se envio otra iniciativa consumio capacidad,
//                         aqui ya se ve y se rechaza. Ademas resuelve el
//                         solicitante (cuenta de IIS) y el correo del PO
//                         contra dbo.CatPersona (DestinatariosSolicitud,
//                         App_Code/SolicitudIniciativaAlta.cs); sin los dos,
//                         la solicitud no es valida.
//
// GUARDA solo si la base tiene sql/29 (IAlmacenSolicitudes.Disponible):
// numero, solicitud, foto de los dos correos y evento ENVIADA en una
// transaccion (adm.usp_SolicitudIniciativa_Crear). Sin sql/29, como antes:
// valida y responde guardada = false. Una solicitud NO consume capacidad
// (no toca dbo.ProblemCategoria): no hay que bloquear la categoria.
//
// LECTURA: DirectorioOrganizacional.Cargar, CatalogoRutasIniciativa
// (dbo.Categorias), DashboardCatalogos.PrefijosIniciativa
// (dbo.CatPrefijoProblem), ExperienciaQueries.CompromisosCapacidad y
// dbo.CatPersona.
//
// La categoria es la RUTA COMPLETA elegida: es la llave de la capacidad
// (cada ruta, su propio 100%).

using System;
using System.Collections.Generic;
using System.Data.SqlClient;

public sealed class IniciativaService
{
    // Lo que todavia no existe y se dice en cada respuesta, para que nadie
    // tome una validacion por un alta.
    public static readonly string[] Pendientes =
    {
        "numero_solicitud: sin mecanismo de persistencia (UNRESOLVED)",
        "rca: sin destino de almacenamiento configurado; el archivo no se guarda (UNRESOLVED)",
        "alta: no se inserta ninguna solicitud ni iniciativa",
    };

    // Con sql/29 la solicitud se guarda; el RCA y el aviso siguen sin
    // mecanismo.
    public static readonly string[] PendientesGuardada =
    {
        "rca: sin destino de almacenamiento configurado; el archivo no se guarda, solo su extension (UNRESOLVED)",
        "aviso: no se envia correo; los correos quedan guardados para un aviso futuro (UNRESOLVED)",
        "iniciativa: la solicitud no crea la iniciativa ni consume capacidad",
    };

    public const string MotivoSinToken =
        "Falta el identificador del borrador. Recarga la p\u00e1gina y vuelve a enviar.";

    private readonly IGeneradorNumeroSolicitud _numeros;
    private readonly IAlmacenSolicitudes _almacen;
    private readonly IFuentePersonasAcuse _personas;

    // Sin sql/29 el almacen no esta Disponible y el numero queda pendiente
    // (GeneradorNumeroSolicitudPendiente), como antes.
    public IniciativaService() : this(new GeneradorNumeroSolicitudPendiente()) { }

    public IniciativaService(IGeneradorNumeroSolicitud numeros)
        : this(numeros, SolicitudesIniciativa.Almacen, SolicitudesIniciativa.Personas) { }

    public IniciativaService(IGeneradorNumeroSolicitud numeros, IAlmacenSolicitudes almacen, IFuentePersonasAcuse personas)
    {
        if (numeros == null) throw new ArgumentNullException("numeros");
        if (almacen == null) throw new ArgumentNullException("almacen");
        if (personas == null) throw new ArgumentNullException("personas");
        _numeros = numeros;
        _almacen = almacen;
        _personas = personas;
    }

    public Dictionary<string, object> Capacidad(string categoria)
    {
        using (var cn = Abrir())
        {
            var r = new CapacidadCategoria(ExperienciaQueries.CompromisosCapacidad(cn)).Para(categoria);
            return r.ComoJson();
        }
    }

    // Validar, resolver solicitante y PO y, SOLO si todo es valido, guardar
    // (o, sin sql/29, pedir el numero al emisor pendiente). Una solicitud
    // invalida nunca consume numero. `identidad` es la cuenta de IIS
    // (AccesoAdmin.IdentidadEscritura); nada del formulario la sustituye.
    // `esAdm` es AccesoAdmin.Rol == ADM (EXCEPCION ADM de
    // App_Code/SolicitudIniciativaAlta.cs); tampoco sale del formulario.
    public ValidadorIniciativa.Resultado Solicitar(SolicitudIniciativa solicitud, IdentidadWindows identidad, bool esAdm = false)
    {
        CatalogoSolicitud catalogo;
        CapacidadCategoria capacidad;
        using (var cn = Abrir())
        {
            // Tipo = Prefijo de dbo.CatPrefijoProblem: lo que no este ahi se
            // rechaza ("no esta en el catalogo").
            var tipos = DashboardCatalogos.Llaves(DashboardCatalogos.PrefijosIniciativa(cn));
            // La misma lista de rutas que ofrece la pantalla, leida de nuevo.
            var rutas = CatalogoRutasIniciativa.Cargar(cn, DirectorioOrganizacional.Cargar(cn));
            catalogo = CatalogoSolicitud.Desde(tipos, (System.Collections.IEnumerable)rutas["rutas"]);
            capacidad = new CapacidadCategoria(ExperienciaQueries.CompromisosCapacidad(cn));
        }
        return Solicitar(solicitud, identidad, catalogo, capacidad, esAdm);
    }

    // Lo mismo con catalogo y capacidad ya leidos (las pruebas, sin SQL).
    public ValidadorIniciativa.Resultado Solicitar(SolicitudIniciativa solicitud, IdentidadWindows identidad,
                                                   CatalogoSolicitud catalogo, CapacidadCategoria capacidad, bool esAdm = false)
    {
        var r = new ValidadorIniciativa().Validar(solicitud, catalogo, capacidad);
        r.Destinatarios = DestinatariosSolicitud.Resolver(identidad, solicitud.ProductOwner, _personas.Personas(), r, esAdm);
        if (!r.Valida) return r;

        if (!_almacen.Disponible())
        {
            AsignarNumero(r, _numeros);
            return r;
        }
        // Con sql/29 el solicitante sin correo de CatPersona no se puede
        // guardar (y no se inventa uno): la excepcion ADM no llega al almacen.
        if (r.Destinatarios.ExcepcionAdm)
        {
            r.Agregar(DestinatariosSolicitud.CampoSolicitante, DestinatariosSolicitud.MensajeExcepcionSinGuardar);
            return r;
        }
        var token = SolicitudesIniciativa.Token(solicitud.Token);
        if (token == Guid.Empty)
        {
            r.Agregar(SolicitudIniciativa.CToken, MotivoSinToken);
            return r;
        }
        var d = r.Destinatarios;
        var g = _almacen.Crear(new AltaSolicitud
        {
            Cuenta = d.Cuenta,
            Token = token,
            Tipo = Limpio(solicitud.Tipo),
            Po = Limpio(solicitud.ProductOwner),
            So = Limpio(solicitud.ServiceOwner),
            Categoria = Limpio(solicitud.Categoria),
            Director = r.Director,
            Titulo = Limpio(solicitud.Titulo),
            Descripcion = Limpio(solicitud.Descripcion),
            Observaciones = Limpio(solicitud.Observaciones),
            Volumetria = int.Parse(Limpio(solicitud.Volumetria), System.Globalization.CultureInfo.InvariantCulture),
            Pct = r.PctFraccion.Value,
            RcaExtension = solicitud.TieneRca ? NumeroSolicitud.ExtensionSegura(solicitud.NombreRca) : null,
            SolicitanteNombre = d.SolicitanteNombre,
            SolicitanteCorreo = d.SolicitanteCorreo,
            ProductOwnerCorreo = d.ProductOwnerCorreo,
        });
        r.Numero = g.Numero;
        r.NumeroPendiente = null;
        r.Guardada = true;
        r.Nuevo = g.Nuevo;
        return r;
    }

    private static string Limpio(string s)
    {
        if (s == null) return null;
        s = s.Trim();
        return s.Length == 0 ? null : s;
    }

    // Aparte para probarlo sin SQL.
    public static void AsignarNumero(ValidadorIniciativa.Resultado r, IGeneradorNumeroSolicitud numeros)
    {
        if (!r.Valida) return;
        string motivo;
        r.Numero = numeros.Emitir(out motivo);
        r.NumeroPendiente = r.Numero == null ? motivo : null;
    }

    public static Dictionary<string, object> ComoJson(ValidadorIniciativa.Resultado r)
    {
        var d = r.Destinatarios;
        var errores = new List<object>();
        foreach (var e in r.Errores)
            errores.Add(new Dictionary<string, object> { { "campo", e.Campo }, { "mensaje", e.Mensaje } });

        return new Dictionary<string, object>
        {
            { "valida", r.Valida },
            { "errores", errores },
            { "rca_obligatorio", r.RcaObligatorio },
            { "pct_fraccion", r.PctFraccion },
            { "director", r.Director },
            { "capacidad", r.Capacidad == null ? null : r.Capacidad.ComoJson() },
            { "guardada", r.Guardada },
            { "nuevo", r.Guardada && r.Nuevo },
            { "numero_solicitud", r.Numero == null ? null : r.Numero.ToString() },
            { "numero_pendiente", r.NumeroPendiente },
            // Lo resuelto en el servidor (nunca lo que mando el navegador).
            { "solicitante", d == null ? null : new Dictionary<string, object>
                {
                    { "nombre", d.SolicitanteNombre }, { "correo", d.SolicitanteCorreo },
                    { "cuenta", d.Cuenta }, { "excepcion_adm", d.ExcepcionAdm },
                } },
            { "product_owner_correo", d == null ? null : d.ProductOwnerCorreo },
            { "pendientes", new List<string>(r.Guardada ? PendientesGuardada : Pendientes) },
        };
    }

    private static SqlConnection Abrir()
    {
        var cn = new SqlConnection(DashboardDb.CadenaConexion());
        try { cn.Open(); }
        catch { cn.Dispose(); throw; }
        return cn;
    }
}
