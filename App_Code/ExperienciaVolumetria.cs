// Volumetria de una categoria para Admin (Crear / Modificar / Solicitar
// cambios): el volumen de tickets del SLOT 0 de dbo.vw_TBSlotCAT, con la
// MISMA consulta y la MISMA llave que Experiencia.
//
// QUE ES "VOLUMETRIA"
// -------------------
//   El "Volumen Categoria" de la hoja DBIniciativas del Excel:
//     =SUMIFS(TBSlotCAT[Total general], TBSlotCAT[Categoria V2], <ruta>,
//             TBSlotCAT[SLOT], 0)
//   o sea, el Total general de la ruta en el SLOT 0. En el sitio, la hoja
//   TBSlotCAT es dbo.vw_TBSlotCAT y el SLOT 0 es la ventana de los ultimos
//   DashboardDataInfo.DiasSlot (30) dias contada desde hoy (ver
//   ExperienciaQueries.Construir: periodo = hoy - DIAS_SLOT .. hoy).
//
// LA MISMA CONSULTA
// -----------------
//   LeerVolumen(cn, "dbo.vw_TBSlotCAT", "Slot", "[Categoria V2]", 0): el
//   mismo SELECT ... SUM([Total general]) ... GROUP BY Slot, [Categoria V2]
//   con el que Experiencia arma su volumen (ExperienciaQueries.Construir).
//   Aqui solo se conserva el periodo 0.
//
// LA MISMA LLAVE
// --------------
//   [Categoria V2] ya viene de fn_NormalizaCategoria; la ruta pedida se
//   normaliza con Normaliza (su replica, DirectorioOrganizacional.Normaliza)
//   y se compara Ordinal, igual que el diccionario de categorias de
//   Experiencia (Acumular / AsegurarFila).
//
// NO ES TICKETS REDUCE
// --------------------
//   Tickets Reduce sigue saliendo de dbo.ExpTicketsReduce (o del Excel) con
//   su propia regla de 30 dias moviles (LeerIniciativas). Esta volumetria es
//   un dato a la vista; nada la usa para calcular Tickets Reduce.
//
// ESTADOS DE CADA RUTA (VolumetriaCategoria.Resolver)
//   ok             la ruta tiene filas en el SLOT 0: su Total general (> 0).
//   cero           el SLOT 0 trae datos, pero ninguno de esa ruta: 0 real,
//                  el mismo 0 que Experiencia pinta (AsegurarFila).
//   sin_datos      el SLOT 0 vino VACIO para todas las rutas: no hay tickets
//                  cargados en la ventana, asi que no se puede decir que sea
//                  0. volumetria = null.
//   ruta_invalida  la ruta llego vacia. volumetria = null.
//   Si la consulta falla, la excepcion sube: el handler responde 503 y el
//   navegador lo pinta como error, nunca como 0.
//
// SOLO LECTURA.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;

public static partial class ExperienciaQueries
{
    // Total general del SLOT 0 por [Categoria V2] (ya normalizada).
    public static Dictionary<string, int> VolumenSlot0PorCategoria(SqlConnection cn)
    {
        var salida = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var v in LeerVolumen(cn, "dbo.vw_TBSlotCAT", "Slot", "[Categoria V2]", 0))
        {
            if (v.Periodo != 0 || string.IsNullOrEmpty(v.Llave)) continue;
            int actual;
            salida.TryGetValue(v.Llave, out actual);
            salida[v.Llave] = actual + v.Total;
        }
        return salida;
    }

    // La llave con la que se busca una ruta (la de Experiencia).
    public static string LlaveCategoria(string ruta)
    {
        return Normaliza(ruta);
    }
}

public static class VolumetriaCategoria
{
    public const string OK = "ok";
    public const string CERO = "cero";
    public const string SIN_DATOS = "sin_datos";
    public const string RUTA_INVALIDA = "ruta_invalida";

    // Tope de rutas por peticion y de largo de cada una (ProblemCategoria
    // .Categoria es NVARCHAR(450)).
    public const int MAX_RUTAS = 50;
    public const int MAX_LARGO = 450;

    // slot0: VolumenSlot0PorCategoria. Una entrada por ruta pedida, en el
    // mismo orden (repetidas incluidas: el navegador las pide tal cual).
    public static List<object> Resolver(IEnumerable<string> rutas, IDictionary<string, int> slot0)
    {
        if (slot0 == null) throw new ArgumentNullException("slot0");
        var hayDatos = slot0.Count > 0;
        var salida = new List<object>();
        foreach (var ruta in rutas ?? new string[0])
        {
            var llave = string.IsNullOrWhiteSpace(ruta) ? null : ExperienciaQueries.LlaveCategoria(ruta);
            var fila = new Dictionary<string, object> { { "ruta", ruta }, { "llave", llave } };
            int total;
            if (string.IsNullOrEmpty(llave))
            {
                fila["estado"] = RUTA_INVALIDA;
                fila["volumetria"] = null;
            }
            else if (slot0.TryGetValue(llave, out total))
            {
                fila["estado"] = total > 0 ? OK : CERO;
                fila["volumetria"] = total;
            }
            else if (hayDatos)
            {
                fila["estado"] = CERO;
                fila["volumetria"] = 0;
            }
            else
            {
                fila["estado"] = SIN_DATOS;
                fila["volumetria"] = null;
            }
            salida.Add(fila);
        }
        return salida;
    }
}
