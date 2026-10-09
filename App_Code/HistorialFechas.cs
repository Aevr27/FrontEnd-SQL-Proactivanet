// App_Code/HistorialFechas.cs - historial de FechaAnalisis / FechaSolucion /
// FechaCierre de las iniciativas, leido de dbo.ProblemFechaEvento.
//
// Lo escriben (nunca el sitio):
//   - la importacion de los comentarios del Excel (filas 'U' NO_DECLARADO con
//     la fecha aproximada del comentario; tools/historial_fechas/);
//   - sql/17_historial_fechas_captura.sql: la linea base ('B') y, desde ahi,
//     el trigger dbo.trg_Problem_FechaEvento ('I' al dar de alta, 'U' en cada
//     cambio real).
//
// Aqui solo se lee la tabla completa (unos miles de filas) en orden de
// IdEvento y se agrupa por Codigo; RegistroIniciativas cuelga la lista de
// cada folio en i["historial"]. Los rotulos (Linea base, Fecha inicial,
// Cambio n...) y la regla de conteo (en Cierre solo cuentan las extensiones)
// los pone el navegador: admin/registro-iniciativas.js, htmlHistorial.
//
// INICIO DE CAPTURA: el FechaRegistro de la linea base, que se escribio en
// la misma transaccion que creo el trigger. Un 'U' anterior a ese instante
// solo puede venir de la importacion del Excel: se marca `reconstruido`.
// Sin linea base no hay forma de saberlo y no se marca nada.
//
// Si la tabla no existe o no se puede leer (falta el GRANT SELECT del login
// del sitio), Estado lo dice y el resto del registro sale igual: el
// historial es un dato de mas, no puede tumbar la pagina.
//
// SOLO LECTURA: un SELECT sobre dbo.ProblemFechaEvento.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public sealed class HistorialFechas
{
    public const string ESTADO_OK = "ok";
    public const string ESTADO_SIN_TABLA = "sin_tabla";
    public const string ESTADO_ERROR = "error";

    private readonly Dictionary<string, List<object>> _porCodigo =
        new Dictionary<string, List<object>>(StringComparer.OrdinalIgnoreCase);

    public string Estado { get; private set; }
    // Inicio de la captura viva, ya en zona de presentacion (dd/MM/yyyy), o null.
    public string Desde { get; private set; }

    private HistorialFechas(string estado) { Estado = estado; }

    public List<object> Para(string codigo)
    {
        List<object> l;
        return codigo != null && _porCodigo.TryGetValue(codigo, out l) ? l : new List<object>();
    }

    public static HistorialFechas Leer(SqlConnection cn)
    {
        try
        {
            using (var cmd = new SqlCommand(
                "SELECT CASE WHEN OBJECT_ID(N'dbo.ProblemFechaEvento', N'U') IS NULL THEN 0 ELSE 1 END", cn))
            {
                if (Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 0)
                    return new HistorialFechas(ESTADO_SIN_TABLA);
            }

            var filas = new List<Evento>();
            using (var cmd = new SqlCommand(
                "SELECT IdEvento, Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, " +
                "       Usuario, SolicitudId, FechaRegistro " +
                "FROM dbo.ProblemFechaEvento ORDER BY Codigo, IdEvento", cn))
            {
                cmd.CommandType = CommandType.Text;
                using (var rd = cmd.ExecuteReader())
                {
                    while (rd.Read())
                    {
                        filas.Add(new Evento
                        {
                            Id = Convert.ToInt32(rd.GetValue(0), CultureInfo.InvariantCulture),
                            Codigo = rd.IsDBNull(1) ? null : rd.GetString(1),
                            Campo = rd.IsDBNull(2) ? null : rd.GetString(2),
                            Anterior = rd.IsDBNull(3) ? (DateTime?)null : rd.GetDateTime(3),
                            Nueva = rd.IsDBNull(4) ? (DateTime?)null : rd.GetDateTime(4),
                            Operacion = rd.IsDBNull(5) ? null : rd.GetString(5),
                            Origen = rd.IsDBNull(6) ? null : rd.GetString(6),
                            Usuario = rd.IsDBNull(7) ? null : rd.GetString(7),
                            Solicitud = rd.IsDBNull(8) ? (int?)null : Convert.ToInt32(rd.GetValue(8), CultureInfo.InvariantCulture),
                            RegistroUtc = rd.GetDateTime(9),
                        });
                    }
                }
            }
            return Armar(filas);
        }
        catch (Exception ex)
        {
            DashboardHandler.Registrar("HistorialFechas", ex);
            return new HistorialFechas(ESTADO_ERROR);
        }
    }

    // Aparte de Leer para que tools/tests/HistorialFechasSmoke.cs lo
    // pruebe sin SQL. 'filas' viene en orden de IdEvento dentro de cada codigo.
    private static HistorialFechas Armar(List<Evento> filas)
    {
        var h = new HistorialFechas(ESTADO_OK);

        DateTime? inicio = null;
        foreach (var e in filas)
            if (e.Operacion == "B" && (!inicio.HasValue || e.RegistroUtc < inicio.Value))
                inicio = e.RegistroUtc;
        if (inicio.HasValue)
            h.Desde = DashboardDataInfo.UtcAPresentacion(inicio.Value).ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

        foreach (var e in filas)
        {
            if (string.IsNullOrEmpty(e.Codigo)) continue;
            List<object> lista;
            if (!h._porCodigo.TryGetValue(e.Codigo, out lista))
            {
                lista = new List<object>();
                h._porCodigo[e.Codigo] = lista;
            }

            var d = new Dictionary<string, object>();
            d["id"] = e.Id;
            d["campo"] = e.Campo;
            d["anterior"] = Dia(e.Anterior);
            d["nuevo"] = Dia(e.Nueva);
            d["operacion"] = e.Operacion;
            d["origen"] = e.Origen;
            // Solo las filas de Admin llevan persona; LoginBD no sale nunca.
            d["usuario"] = e.Origen == "ADMIN" ? e.Usuario : null;
            d["solicitud"] = e.Origen == "ADMIN" ? (object)e.Solicitud : null;
            d["fecha"] = DashboardDataInfo.UtcAPresentacion(e.RegistroUtc)
                             .ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);
            d["reconstruido"] = e.Operacion == "U" && inicio.HasValue && e.RegistroUtc < inicio.Value;
            lista.Add(d);
        }
        return h;
    }

    private static string Dia(DateTime? v)
    {
        return v.HasValue ? v.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;
    }

    private sealed class Evento
    {
        public int Id;
        public string Codigo;
        public string Campo;
        public DateTime? Anterior;
        public DateTime? Nueva;
        public string Operacion;
        public string Origen;
        public string Usuario;
        public int? Solicitud;
        public DateTime RegistroUtc;
    }
}
