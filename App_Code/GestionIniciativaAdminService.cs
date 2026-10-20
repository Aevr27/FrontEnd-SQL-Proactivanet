// Servicio de la gestion directa de ADM (App_Code/GestionIniciativaAdmin.cs):
// arma, en el momento de cada llamada, lo que ValidadorGestionAdmin
// necesita. Lectura; la escritura (Guardar) solo con la persistencia activa.
//
//   Crear(p)       catalogo (CatPrefijoProblem + rutas de dbo.Categorias:
//                  TODAS las activas para ADM aunque les falten duenos,
//                  CatalogoAdm), capacidad y los
//                  Estado / TipoIniciativa / TipoAgrupado que ya existen.
//   Modificar(p)   la iniciativa actual de la MISMA lectura del registro
//                  (ExperienciaQueries.RegistroIniciativas), la capacidad,
//                  las rutas vigentes (agregar) y los Estado/Subestado que
//                  ya existen en dbo.Problem.
//
// Si la lectura falla, la excepcion sube: el handler responde que no se pudo
// validar (503), nunca que la validacion paso.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;

public sealed class GestionIniciativaAdminService
{
    // La iniciativa leida por el ultimo Modificar (null si no estaba): el
    // plan de escritura sale de ella, no de lo que mande el cliente.
    public IniciativaActual Actual { get; private set; }

    public ResultadoGestionAdmin Crear(PeticionCrearAdmin p)
    {
        using (var cn = Abrir())
        {
            var tipos = DashboardCatalogos.Llaves(DashboardCatalogos.PrefijosIniciativa(cn));
            var catalogo = CatalogoAdm(cn, tipos);
            var capacidad = new CapacidadCategoria(ExperienciaQueries.CompromisosCapacidad(cn));
            var valores = ExperienciaQueries.LeerEstadosProblem(cn).Valores;
            return new ValidadorGestionAdmin().Crear(p, catalogo, capacidad, TiposSolicitud.ValorProblem(tipos), valores);
        }
    }

    public ResultadoGestionAdmin Modificar(PeticionModificarAdmin p)
    {
        var folio = (p.Folio ?? "").Trim();
        IniciativaActual actual = null;
        var registro = ExperienciaQueries.RegistroIniciativas();
        foreach (Dictionary<string, object> i in (List<object>)registro["iniciativas"])
        {
            if (string.Equals(i["folio"] as string, folio, StringComparison.OrdinalIgnoreCase))
            {
                actual = IniciativaActual.DesdeRegistro(i);
                break;
            }
        }
        Actual = actual;
        using (var cn = Abrir())
        {
            // Rutas vigentes (para agregar categorias) y los valores de
            // Estado/Subestado que ya existen: las mismas lecturas que Crear
            // y que el registro.
            var tipos = DashboardCatalogos.Llaves(DashboardCatalogos.PrefijosIniciativa(cn));
            var catalogo = CatalogoAdm(cn, tipos);
            var estados = ExperienciaQueries.LeerEstadosProblem(cn).Valores;
            return new ValidadorGestionAdmin().Modificar(p, actual, ExperienciaQueries.CompromisosCapacidad(cn), catalogo, estados);
        }
    }

    // ESCRITURA (solo con PersistenciaGestionAdmin.Activa(); hoy nunca). Una
    // llamada = una transaccion dentro del procedimiento de sql/18.
    // Devuelve el Codigo (el emitido en un alta, solo tras el COMMIT; el
    // mismo en Modificar).
    public string Guardar(PlanCrearAdmin crear, PlanModificarAdmin modificar, string usuario)
    {
        if (string.IsNullOrEmpty(usuario)) throw new ArgumentException("Sin usuario autenticado no se escribe.");
        var escritor = new EscritorGestionAdminSql();
        using (var cn = Abrir())
        {
            if (crear != null) return escritor.Crear(cn, null, crear, usuario);
            escritor.Modificar(cn, null, modificar, usuario);
            return modificar.Codigo;
        }
    }

    // El catalogo de ADM: PO / SO de las rutas con sus tres dueños vigentes
    // (los mismos que Nueva solicitud) y, como categorias, TODAS las rutas
    // activas y unicas aunque les falten dueños (ElegiblesAdm). Es lo mismo
    // que ADM ve en admin_iniciativas_catalogos.ashx (rutas_adm).
    private static CatalogoSolicitud CatalogoAdm(SqlConnection cn, List<object> tipos)
    {
        var dir = DirectorioOrganizacional.Cargar(cn);
        var activas = CatalogoRutasIniciativa.LeerRutasActivas(cn);
        var rutas = CatalogoRutasIniciativa.Asignaciones(activas, dir);
        var adm = CatalogoRutasIniciativa.ElegiblesAdm(activas, dir);
        return CatalogoSolicitud.ParaAdm(tipos, (System.Collections.IEnumerable)rutas["rutas"],
            (System.Collections.IEnumerable)adm["rutas_adm"]);
    }

    private static SqlConnection Abrir()
    {
        var cn = new SqlConnection(DashboardDb.CadenaConexion());
        try { cn.Open(); }
        catch { cn.Dispose(); throw; }
        return cn;
    }
}
