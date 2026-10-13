// Servicio de la gestion directa de ADM (App_Code/GestionIniciativaAdmin.cs):
// arma, en el momento de cada llamada, lo que ValidadorGestionAdmin
// necesita. SOLO LECTURA; no hay transaccion ni escritura.
//
//   Crear(p)       catalogo (CatPrefijoProblem + rutas de dbo.Categorias con
//                  sus duenos, igual que IniciativaService) y capacidad.
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
            var rutas = CatalogoRutasIniciativa.Cargar(cn, DirectorioOrganizacional.Cargar(cn));
            var catalogo = CatalogoSolicitud.Desde(tipos, (System.Collections.IEnumerable)rutas["rutas"]);
            var capacidad = new CapacidadCategoria(ExperienciaQueries.CompromisosCapacidad(cn));
            return new ValidadorGestionAdmin().Crear(p, catalogo, capacidad, TiposSolicitud.ValorProblem(tipos));
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
            var rutas = CatalogoRutasIniciativa.Cargar(cn, DirectorioOrganizacional.Cargar(cn));
            var catalogo = CatalogoSolicitud.Desde(tipos, (System.Collections.IEnumerable)rutas["rutas"]);
            var estados = ExperienciaQueries.LeerEstadosProblem(cn).Valores;
            return new ValidadorGestionAdmin().Modificar(p, actual, ExperienciaQueries.CompromisosCapacidad(cn), catalogo, estados);
        }
    }

    // ESCRITURA (solo con PersistenciaGestionAdmin.Activa(); hoy nunca). Una
    // llamada = una transaccion dentro del procedimiento de sql/18.
    // Devuelve el Codigo (el emitido en un alta; el mismo en Modificar).
    public string Guardar(PlanCrearAdmin crear, PlanModificarAdmin modificar, DatosAltaDeclarados declarados, string usuario)
    {
        if (string.IsNullOrEmpty(usuario)) throw new ArgumentException("Sin usuario autenticado no se escribe.");
        var escritor = new EscritorGestionAdminSql();
        using (var cn = Abrir())
        {
            if (crear != null) return escritor.Crear(cn, null, crear, declarados, usuario);
            escritor.Modificar(cn, null, modificar, usuario);
            return modificar.Codigo;
        }
    }

    private static SqlConnection Abrir()
    {
        var cn = new SqlConnection(DashboardDb.CadenaConexion());
        try { cn.Open(); }
        catch { cn.Dispose(); throw; }
        return cn;
    }
}
