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
// VOLUMETRIA TOTAL (alcance=total, solo ADM: Crear y Modificar)
// ------------------------------------------------------------
//   Desde 2026-10-26 la pantalla de ADM muestra y planea con ULTIMOS30 (la
//   base de TicketsReduce), no con el total: mostraba 74 (total) y la base
//   guardaba sobre 7 (30 dias). El total sigue en la respuesta, sin uso en
//   pantalla. El total es la columna VolumenCategoria de dbo.vw_ProblemCategoria:
//       (SELECT COUNT_BIG(*) FROM dbo.Tickets AS t WHERE t.Categoria = pc.Categoria)
//   Esa vista solo tiene filas de categorias YA ligadas, asi que para una
//   ruta cualquiera se usa la MISMA expresion (VolumetriaTotalCategoria),
//   con la ruta como la guarda adm.usp_GestionAdmin_* en
//   ProblemCategoria.Categoria (NBSP -> espacio, sin espacios a los lados).
//   En la misma pasada sale VolumenUltimos30 con la expresion de la vista
//   (FechaRegistro >= ahora Mexico - 30 dias): es la base con la que
//   adm.usp_GestionAdmin_TicketsReduce calcula el TicketsReduce que se
//   GUARDA (FLOOR con la propuesta sql/33), y es lo que la pantalla muestra
//   en Volumetria (VolumetriaCliente de admin/iniciativa-admin.js).
//   Estados: ok (> 0), cero (0 real: COUNT sobre dbo.Tickets) y
//   ruta_invalida. Sin "sin_datos": un conteo directo no tiene ventana.
//   El alcance por omision (SLOT 0) no cambia para nadie.
//
// SOLO LECTURA.

using System;
using System.Collections.Generic;
using System.Data;
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

public static class VolumetriaTotalCategoria
{
    public const string ALCANCE = "total";

    // Una fila por ruta pedida (n = su posicion), con las expresiones de
    // VolumenCategoria y VolumenUltimos30 de dbo.vw_ProblemCategoria.
    public static string Consulta(int rutas)
    {
        var valores = new List<string>();
        for (var n = 0; n < rutas; n++) valores.Add("(" + n + ", @r" + n + ")");
        return
            "SELECT r.N, Total = COUNT_BIG(t.Categoria), " +
            "Ultimos30 = COUNT_BIG(CASE WHEN t.FechaRegistro >= DATEADD(DAY, -30, DATEADD(HOUR, -6, SYSUTCDATETIME())) THEN 1 END) " +
            "FROM (VALUES " + string.Join(", ", valores.ToArray()) + ") AS r (N, Ruta) " +
            "LEFT JOIN dbo.Tickets AS t ON t.Categoria = LTRIM(RTRIM(REPLACE(r.Ruta, NCHAR(160), N' '))) " +
            "GROUP BY r.N;";
    }

    // La ruta como la guarda ProblemCategoria.Categoria (null = vacia).
    public static string Ruta(string ruta)
    {
        if (ruta == null) return null;
        var r = ruta.Replace('\u00a0', ' ').Trim();
        return r.Length == 0 ? null : r;
    }

    // Misma forma que VolumetriaCategoria.Resolver (ruta, llave, estado,
    // volumetria) mas ultimos30. Si la consulta falla, la excepcion sube.
    public static List<object> Leer(SqlConnection cn, IList<string> rutas)
    {
        var validas = new List<string>();
        var indice = new int[rutas == null ? 0 : rutas.Count];
        for (var i = 0; i < indice.Length; i++)
        {
            var r = Ruta(rutas[i]);
            indice[i] = r == null ? -1 : validas.Count;
            if (r != null) validas.Add(r);
        }
        var totales = new long[validas.Count];
        var ultimos = new long[validas.Count];
        if (validas.Count > 0)
        {
            using (var cmd = new SqlCommand(Consulta(validas.Count), cn) { CommandTimeout = 60 })
            {
                for (var n = 0; n < validas.Count; n++)
                    cmd.Parameters.Add("@r" + n, SqlDbType.NVarChar, VolumetriaCategoria.MAX_LARGO).Value = validas[n];
                using (var rd = cmd.ExecuteReader())
                    while (rd.Read())
                    {
                        var n = Convert.ToInt32(rd.GetValue(0));
                        totales[n] = Convert.ToInt64(rd.GetValue(1));
                        ultimos[n] = Convert.ToInt64(rd.GetValue(2));
                    }
            }
        }
        return Armar(rutas, indice, totales, ultimos);
    }

    // Sin base (para las pruebas): los conteos ya leidos por posicion.
    public static List<object> Armar(IList<string> rutas, int[] indice, long[] totales, long[] ultimos)
    {
        var salida = new List<object>();
        for (var i = 0; i < indice.Length; i++)
        {
            var fila = new Dictionary<string, object> { { "ruta", rutas[i] } };
            var n = indice[i];
            if (n < 0)
            {
                fila["llave"] = null;
                fila["estado"] = VolumetriaCategoria.RUTA_INVALIDA;
                fila["volumetria"] = null;
                fila["ultimos30"] = null;
            }
            else
            {
                fila["llave"] = ExperienciaQueries.LlaveCategoria(rutas[i]);
                fila["estado"] = totales[n] > 0 ? VolumetriaCategoria.OK : VolumetriaCategoria.CERO;
                fila["volumetria"] = totales[n];
                fila["ultimos30"] = ultimos[n];
            }
            salida.Add(fila);
        }
        return salida;
    }
}
