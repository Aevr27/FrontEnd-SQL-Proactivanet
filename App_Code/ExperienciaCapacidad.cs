// Capacidad de reduccion por categoria (Admin -> Nueva solicitud): de donde
// salen las iniciativas que hoy consumen el 100% de una categoria.
//
// Como ExperienciaRegistro.cs, es otra proyeccion de los mismos datos de
// Experiencia dentro de la misma clase partial, para reusar sus privados
// sin copiarlos:
//
//   LeerIniciativas   dbo.vw_ProblemCategoria (VigenteEnOrigen = 1) + Problem,
//                     deduplicado por (Codigo, Categoria): una fila por
//                     iniciativa y ruta, con su PctDisminucion ACTUAL.
//   EsActiva          Estado en ESTADOS_ACTIVOS (En Análisis, En Solución,
//                     En Monitoreo).
//   EsAgrupador       TipoAgrupado en AGRUPADORES.
//
// QUE CONSUME CAPACIDAD (ConsumeCapacidad)
// ----------------------------------------
// La misma elegibilidad con la que Experiencia suma el compromiso de
// reduccion de una categoria (ini / ini_total y el Tickets Reduce que resta
// del volumen de la hoja): vigente en origen, activa y con agrupador. Lo que
// no es eso -cerrada, cualquier estado fuera de los tres vivos, no vigente
// en origen- no consume. No se invento un estado nuevo: es la regla que el
// sitio ya aplica a "cuanto se comprometio a reducir esta categoria".
//
// PctDisminucion NULL: LeerIniciativas lo lee como 0 (Doble), igual que en
// el registro; asi que una fila sin % no consume.
//
// SOLO LECTURA: el SELECT de LeerIniciativas.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;

public static partial class ExperienciaQueries
{
    public static List<CapacidadCategoria.Compromiso> CompromisosCapacidad(SqlConnection cn)
    {
        return Compromisos(LeerIniciativas(cn, DashboardDataInfo.HoyEnPresentacion()));
    }

    // Los cortes C1 y C1&C2 de una ruta completa, con las MISMAS replicas de
    // dbo.fn_CategoriaC1 / fn_CategoriaC1C2 que usa Experiencia (C1DeTsql,
    // C1C2De): son las llaves con que vw_ProblemCategoria busca los dueños.
    // Las usa Admin (CatalogoRutasIniciativa) sin copiarlas.
    public static void CortesDeRuta(string ruta, out string c1, out string c1c2)
    {
        var n = Normaliza(ruta);
        c1 = n == null ? null : C1DeTsql(n);
        c1c2 = n == null ? null : C1C2De(n);
    }

    public static bool ConsumeCapacidad(string estado, string agrupador)
    {
        return EsActiva(estado) && EsAgrupador(agrupador);
    }

    private static List<CapacidadCategoria.Compromiso> Compromisos(List<Detalle> detalle)
    {
        var salida = new List<CapacidadCategoria.Compromiso>();
        foreach (var d in detalle)
        {
            if (!EsRegistroDeIniciativa(d) || string.IsNullOrEmpty(d.Categoria)) continue;
            salida.Add(new CapacidadCategoria.Compromiso
            {
                Folio = d.Folio,
                Categoria = d.Categoria,
                // DECIMAL(9,4) llega como double; se regresa a 4 decimales.
                Pct = Math.Round((decimal)d.PctDisminucion, 4),
                Consume = ConsumeCapacidad(d.Estado, d.Agrup),
            });
        }
        return salida;
    }
}
