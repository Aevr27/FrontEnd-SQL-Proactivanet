// Requerimientos de TI a TI por categoria y periodo, para el boton "Sin TI a
// TI" de Experiencia (handlers/experiencia_ti.ashx). La regla: TicketTIaTI.
//
// Van aparte de experiencia.ashx a proposito: son dos pasadas mas por las
// vistas base (una por SLOT y otra por mes) y la pestana no las espera para
// pintar; experiencia.js las pide despues, como los automatizados.
//
// Mismas filas que el volumen: vw_TicketsSlotsBase / vw_TicketsMesBase, las
// bases de vw_TBSlotCAT / vw_TBMesCAT que lee LeerVolumen, con la misma llave
// ([Categoria V2] = CategoriaV2) y el mismo periodo. Por eso el navegador las
// puede restar categoria por categoria: cada ticket de TI a TI ya esta contado
// en el volumen de su categoria. Cliente y Tienda salen de dbo.Tickets, como
// en el 89 (CodigoTicket es su llave: el JOIN no multiplica filas).
//
// C1 y C1&C2 se repliegan como el volumen (Replegar), asi que las llaves
// casan con las de "categorias" y "categorias_v2" del payload principal.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public static partial class ExperienciaQueries
{
    // Dos lecturas sobre todo el año y los 10 SLOTs: holgura sobre el tiempo
    // por omision, que la pestana ya pinto sin ellas.
    private const int TIMEOUT_TI_SEGUNDOS = 120;

    public static Dictionary<string, object> TIaTI(int anio)
    {
        List<Volumen> slot, mes;
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            slot = LeerTIaTI(cn, false, 0);
            mes = LeerTIaTI(cn, true, anio);
        }

        var regla = new Dictionary<string, object>();
        regla["servicio_ti"] = TicketTIaTI.ServicioTI;
        regla["cliente"] = TicketTIaTI.ClienteOAT;
        regla["permisos"] = TicketTIaTI.ServicioPermisos;

        var salida = new Dictionary<string, object>();
        salida["anio"] = anio;
        salida["regla"] = regla;
        salida["categorias"] = SeriesTIaTI(Unir(Replegar(slot, true), Replegar(slot, false)),
                                           Unir(Replegar(mes, true), Replegar(mes, false)));
        salida["categorias_v2"] = SeriesTIaTI(slot, mes);
        return salida;
    }

    // SQL de la lectura, aparte para que una prueba contra SQL Server pueda
    // correr el mismo texto (ese arnes no esta en este repositorio).
    public static string ConsultaTIaTI(SqlCommand cmd, bool porMes)
    {
        string clase = TicketTIaTI.Clase(cmd, "b.TipoTicket", "b.C1", "t.Cliente", "t.Tienda");
        string periodo = porMes ? "b.Mes" : "b.Slot";
        return
            "SELECT Periodo = " + periodo + ", Llave = b.CategoriaV2, Ti = COUNT_BIG(*), " +
            "       TiPermisos = SUM(CASE WHEN x.Clase = " + TicketTIaTI.EsDePermisos + " THEN 1 ELSE 0 END) " +
            "FROM " + (porMes ? "dbo.vw_TicketsMesBase" : "dbo.vw_TicketsSlotsBase") + " AS b " +
            "INNER JOIN dbo.Tickets AS t ON t.CodigoTicket = b.CodigoTicket " +
            "CROSS APPLY (SELECT Clase = " + clase + ") AS x " +
            "WHERE x.Clase <> " + TicketTIaTI.NoEs + (porMes ? " AND b.Anio = @anio" : "") + " " +
            "GROUP BY " + periodo + ", b.CategoriaV2";
    }

    private static List<Volumen> LeerTIaTI(SqlConnection cn, bool porMes, int anio)
    {
        var filas = new List<Volumen>();
        using (var cmd = new SqlCommand())
        {
            cmd.Connection = cn;
            cmd.CommandType = CommandType.Text;
            cmd.CommandTimeout = TIMEOUT_TI_SEGUNDOS;
            cmd.CommandText = ConsultaTIaTI(cmd, porMes);
            if (porMes)
                cmd.Parameters.Add("@anio", SqlDbType.Int).Value = anio;

            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    // Como LeerVolumen: sin periodo o sin categoria no hay
                    // fila de volumen de la cual restar.
                    if (rd.IsDBNull(0) || rd.IsDBNull(1)) continue;
                    filas.Add(new Volumen
                    {
                        Periodo = Convert.ToInt32(rd.GetValue(0), CultureInfo.InvariantCulture),
                        Llave = Convert.ToString(rd.GetValue(1)),
                        Ti = Entero(rd.GetValue(2)),
                        TiPermisos = Entero(rd.GetValue(3)),
                    });
                }
            }
        }
        return filas;
    }

    // C1 y C1&C2 van en el mismo mapa, como en "categorias": las llaves no
    // chocan (un C1 no empieza con "/", un C1&C2 si).
    private static List<Volumen> Unir(List<Volumen> a, List<Volumen> b)
    {
        var salida = new List<Volumen>(a);
        salida.AddRange(b);
        return salida;
    }

    // categoria -> {slot, mes, permisos_slot, permisos_mes}, solo las que
    // tienen alguno: las demas no restan nada y no viajan.
    private static Dictionary<string, object> SeriesTIaTI(List<Volumen> slot, List<Volumen> mes)
    {
        var series = new Dictionary<string, Dictionary<string, Dictionary<int, int>>>(StringComparer.Ordinal);
        Poner(series, slot, "slot", "permisos_slot");
        Poner(series, mes, "mes", "permisos_mes");

        var salida = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var kv in series)
        {
            var c = new Dictionary<string, object>();
            foreach (var nombre in new[] { "slot", "mes", "permisos_slot", "permisos_mes" })
            {
                Dictionary<int, int> serie;
                c[nombre] = Mapa(kv.Value.TryGetValue(nombre, out serie) ? serie : new Dictionary<int, int>());
            }
            salida[kv.Key] = c;
        }
        return salida;
    }

    private static void Poner(Dictionary<string, Dictionary<string, Dictionary<int, int>>> series,
                              List<Volumen> filas, string total, string permisos)
    {
        foreach (var v in filas)
        {
            if (string.IsNullOrEmpty(v.Llave) || v.Ti <= 0) continue;
            Dictionary<string, Dictionary<int, int>> c;
            if (!series.TryGetValue(v.Llave, out c))
            {
                c = new Dictionary<string, Dictionary<int, int>>();
                series[v.Llave] = c;
            }
            Sumar(Serie(c, total), v.Periodo, v.Ti);
            if (v.TiPermisos > 0) Sumar(Serie(c, permisos), v.Periodo, v.TiPermisos);
        }
    }

    private static Dictionary<int, int> Serie(Dictionary<string, Dictionary<int, int>> c, string nombre)
    {
        Dictionary<int, int> serie;
        if (!c.TryGetValue(nombre, out serie))
        {
            serie = new Dictionary<int, int>();
            c[nombre] = serie;
        }
        return serie;
    }
}
