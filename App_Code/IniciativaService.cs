// Servicio de Nueva solicitud (Admin -> Iniciativas): arma, en el momento
// de cada llamada, lo que el validador necesita y lo valida. Los handlers
// solo traducen HTTP; las reglas estan en ValidadorIniciativa
// (App_Code/SolicitudIniciativa.cs).
//
//   Capacidad(categoria)  lo que la pantalla muestra al elegir la categoria.
//   Validar(solicitud)    vuelve a leer catalogo y capacidad y valida. Es
//                         la AUTORIDAD: si entre que se abrio el formulario
//                         y se envio otra iniciativa consumio capacidad,
//                         aqui ya se ve y se rechaza.
//
// No guarda nada. Cuando exista la persistencia, el recalculo de capacidad
// y el alta tendran que ir en la MISMA transaccion (con bloqueo sobre la
// categoria) para que dos envios simultaneos no pasen ambos; con solo
// lectura no hay transaccion que tomar.
//
// SOLO LECTURA: DirectorioOrganizacional.Cargar, CatalogoRutasIniciativa
// (dbo.Categorias), DashboardCatalogos.PrefijosIniciativa
// (dbo.CatPrefijoProblem) y ExperienciaQueries
// .CompromisosCapacidad, sobre una conexion.
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

    private readonly IGeneradorNumeroSolicitud _numeros;

    // Hoy el unico emisor es el pendiente (no emite). Cuando exista el
    // objeto en la base, se pasa aqui el emisor que lo use.
    public IniciativaService() : this(new GeneradorNumeroSolicitudPendiente()) { }

    public IniciativaService(IGeneradorNumeroSolicitud numeros)
    {
        if (numeros == null) throw new ArgumentNullException("numeros");
        _numeros = numeros;
    }

    public Dictionary<string, object> Capacidad(string categoria)
    {
        using (var cn = Abrir())
        {
            var r = new CapacidadCategoria(ExperienciaQueries.CompromisosCapacidad(cn)).Para(categoria);
            return r.ComoJson();
        }
    }

    // Validar y, SOLO si es valida, pedir el numero. Una solicitud invalida
    // nunca consume numero.
    public ValidadorIniciativa.Resultado Solicitar(SolicitudIniciativa solicitud)
    {
        using (var cn = Abrir())
        {
            // Tipo = Prefijo de dbo.CatPrefijoProblem: lo que no este ahi se
            // rechaza ("no esta en el catalogo").
            var tipos = DashboardCatalogos.Llaves(DashboardCatalogos.PrefijosIniciativa(cn));
            // La misma lista de rutas que ofrece la pantalla, leida de nuevo.
            var rutas = CatalogoRutasIniciativa.Cargar(cn, DirectorioOrganizacional.Cargar(cn));
            var catalogo = CatalogoSolicitud.Desde(tipos, (System.Collections.IEnumerable)rutas["rutas"]);
            var capacidad = new CapacidadCategoria(ExperienciaQueries.CompromisosCapacidad(cn));
            var r = new ValidadorIniciativa().Validar(solicitud, catalogo, capacidad);
            AsignarNumero(r, _numeros);
            return r;
        }
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
            { "guardada", false },
            { "numero_solicitud", r.Numero == null ? null : r.Numero.ToString() },
            { "numero_pendiente", r.NumeroPendiente },
            { "pendientes", new List<string>(Pendientes) },
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
