// Registro de iniciativas de admin/iniciativas.html (vista Iniciativas).
//
// Es una SEGUNDA PROYECCION de los mismos datos de Experiencia, no una
// segunda implementacion: vive en la misma clase (ExperienciaQueries es
// partial solo por esto) para llamar a sus privados tal cual, sin copiarlos.
//
// QUE SE REUSA, SIN CAMBIOS
// -------------------------
//   LeerIniciativas              el mismo SELECT a dbo.vw_ProblemCategoria +
//                                dbo.Problem + dbo.CatPrefijoProblem, con la
//                                misma deduplicacion por (Codigo, Categoria),
//                                Canonizar y Semaforo (activa, retrasada,
//                                sem_fecha, ControlDeFecha por prefijo).
//   AlinearDuenos                los dueños de cada fila = los de su
//                                categoria (DirectorioOrganizacional).
//   LeerIniciativasSinCategoria  las que no tienen categoria, con los dueños
//                                del propio Problem.
//   Iniciativa(...)              la forma de una iniciativa del contrato de
//                                Experiencia: folio, titulo, agrup, estado,
//                                tickets_reduce, vol_reduce_folio,
//                                riesgo_folio, retrazado, fechas, contadores,
//                                po/so/director/manager, sem_fecha,
//                                descripcion, observaciones...
//   EsActiva / EsAgrupador       la eligibilidad de ini_total / ret y de las
//                                tablas Activas / Vencidas de experiencia.js.
//
// QUE AGREGA ESTA PROYECCION
// --------------------------
// Experiencia muestra una iniciativa DENTRO de una rama de categoria; aqui el
// registro es por folio, asi que la "rama" es el folio entero:
//
//   tickets_reduce = vol_reduce_folio = suma de TicketsReduce de sus filas
//                    (Codigo, Categoria) ya deduplicadas -la misma suma que
//                    reducePorFolio en ArmarCategorias-.
//   riesgo_folio   lo calcula Iniciativa(): vol_reduce_folio si va retrasada.
//   categorias     una fila por (Codigo, Categoria): tickets_reduce y
//                  pct_dism de esa fila (como categorias_por_folio) mas los
//                  dueños de ESA categoria, que es con lo que se filtra.
//                  n2: la CategoriaN2 de dbo.CatCategoriaDueno bajo la que
//                  cae la ruta (su C1&C2, la misma llave con la que
//                  AlinearDuenos resuelve los dueños), o null si ese C1&C2 no
//                  tiene fila propia (dueños heredados del C1, o ruta de un
//                  solo nivel). Lo usa la Cobertura de categorias para
//                  colgar la ruta de su categoria del catalogo; no se adivina
//                  ninguna otra.
//   activa         estado en ESTADOS_ACTIVOS.
//   seguimiento    activa y con agrupador de AGRUPADORES: el criterio con el
//                  que Experiencia cuenta Activas y Vencidas.
//   tipo_iniciativa  dbo.Problem.TipoIniciativa del folio
//                  (DashboardCatalogos.TiposIniciativaPorFolio, la grafia del
//                  catalogo TiposIniciativa), o null. NO es `agrup`: ese es
//                  TipoAgrupado. Lectura aparte para no tocar el SELECT de
//                  Experiencia.
//
// Los datos del folio (titulo, agrup, estado, fechas) son los de su PRIMERA
// fila, el mismo criterio que Iniciativas() usa para deduplicar por folio
// dentro de una rama.
//
// QUE NO TRAE, A PROPOSITO
// ------------------------
// Nada de volumen de tickets (vw_TBSlotCAT / vw_TBMesCAT ni la columna
// VolumenUltimos30 de la vista): LeerIniciativas no las pide y aqui tampoco.
// Por eso no hay volumen por categoria. La "Cobertura de categorias" de
// admin/ NO es la pestaña de Experiencia (que es por volumen): cruza en el
// navegador el catalogo de dueños con las iniciativas activas de este
// registro por su `n2`, sin ningun SELECT nuevo.
//
// SOLO LECTURA: los SELECT de LeerIniciativas, LeerIniciativasSinCategoria,
// DirectorioOrganizacional.Cargar y DashboardCatalogos.TiposIniciativaPorFolio,
// sobre una conexion.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;

public static partial class ExperienciaQueries
{
    public static Dictionary<string, object> RegistroIniciativas()
    {
        var hoy = DashboardDataInfo.HoyEnPresentacion();

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();

            var detalle = LeerIniciativas(cn, hoy);
            var dir = DirectorioOrganizacional.Cargar(cn);
            AlinearDuenos(detalle, dir);
            var sueltas = LeerIniciativasSinCategoria(cn, hoy, dir);
            var tipos = DashboardCatalogos.TiposIniciativaPorFolio(cn);

            var salida = ArmarRegistro(detalle, sueltas, dir, tipos);
            salida["fecha_gen"] = hoy.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
            return salida;
        }
    }

    // Aparte de RegistroIniciativas para que tools/tests/RegistroIniciativasSmoke.cs
    // la pruebe sin SQL, con filas armadas a mano.
    private static Dictionary<string, object> ArmarRegistro(
        List<Detalle> detalle, List<object> sueltas, DirectorioOrganizacional dir,
        Dictionary<string, string> tipos)
    {
        var porFolio = new Dictionary<string, List<Detalle>>(StringComparer.OrdinalIgnoreCase);
        var orden = new List<string>();

        foreach (var d in detalle)
        {
            if (!EsRegistroDeIniciativa(d)) continue;
            List<Detalle> filas;
            if (!porFolio.TryGetValue(d.Folio, out filas))
            {
                filas = new List<Detalle>();
                porFolio[d.Folio] = filas;
                orden.Add(d.Folio);
            }
            filas.Add(d);
        }

        var iniciativas = new List<object>();

        foreach (var folio in orden)
        {
            var filas = porFolio[folio];
            var total = 0;
            var categorias = new List<object>();

            foreach (var d in filas)
            {
                total += d.TicketsReduce;

                var c = new Dictionary<string, object>();
                c["categoria"] = d.Categoria;
                c["tickets_reduce"] = d.TicketsReduce;
                c["pct_dism"] = d.PctDisminucion;
                c["po"] = d.Po;
                c["so"] = d.So;
                c["director"] = d.Director;
                c["n2"] = N2De(d, dir);
                categorias.Add(c);
            }

            var primera = filas[0];
            var i = Iniciativa(primera, total, total, dir);
            i["activa"] = primera.Activa;
            i["seguimiento"] = primera.Activa && EsAgrupador(primera.Agrup);
            i["sin_categoria"] = false;
            i["tipo_iniciativa"] = TipoDe(tipos, folio);
            i["categorias"] = categorias;
            iniciativas.Add(i);
        }

        // Las sin categoria ya vienen con la forma de Iniciativa(). Un folio
        // que ya salio arriba no se repite (como `vistos` en filasBaseAct).
        foreach (Dictionary<string, object> i in sueltas)
        {
            var folio = i["folio"] as string;
            if (string.IsNullOrEmpty(folio) || porFolio.ContainsKey(folio)) continue;

            var activa = EsActiva(i["estado"] as string);
            i["activa"] = activa;
            i["seguimiento"] = activa && EsAgrupador(i["agrup"] as string);
            i["sin_categoria"] = true;
            i["tipo_iniciativa"] = TipoDe(tipos, folio);
            i["categorias"] = new List<object>();
            iniciativas.Add(i);
        }

        var salida = new Dictionary<string, object>();
        salida["iniciativas"] = iniciativas;
        salida["estados_activos"] = new List<object>(ESTADOS_ACTIVOS);
        salida["agrupadores"] = new List<object>(AGRUPADORES);
        return salida;
    }

    // La CategoriaN2 capturada para el C1&C2 de la fila (mismo corte que
    // AlinearDuenos), o null.
    private static string N2De(Detalle d, DirectorioOrganizacional dir)
    {
        var c1c2 = !string.IsNullOrEmpty(d.C1C2) ? d.C1C2 : C1C2De(d.Categoria);
        var fila = dir.Categoria(c1c2);
        return fila == null ? null : fila.CategoriaN2;
    }

    private static string TipoDe(Dictionary<string, string> tipos, string folio)
    {
        string t;
        return tipos != null && tipos.TryGetValue(folio, out t) ? t : null;
    }
}
