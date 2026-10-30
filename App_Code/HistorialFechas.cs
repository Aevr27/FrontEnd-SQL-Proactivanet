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
// cada folio en i["historial"] (eventos de la INICIATIVA, Categoria NULL) y
// en i["historial_categorias"] (eventos de la fecha de analisis PROPIA de
// una categoria, con su "categoria"; sql/18 + trg_ProblemCategoria_FechaEvento).
// Las dos listas van separadas a proposito: el "Cambio n" de la iniciativa
// no cambia por los movimientos de sus categorias. Sin la columna Categoria
// (sql/18 sin aplicar) todo es de la iniciativa, como antes. En un evento de
// categoria, anterior = null es el valor crudo: la categoria heredaba la
// fecha de la iniciativa (el navegador lo explica; no se rellena aqui). Los rotulos (Linea base, Fecha inicial,
// Cambio n...) y la regla de conteo (en Cierre solo cuentan las extensiones)
// los pone el navegador: admin/registro-iniciativas.js, htmlHistorial.
// Las filas 'B' viajan igual aunque el panel no las pinta: de ellas salen
// Desde y `reconstruido` (abajo).
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
// SOLO LECTURA: un SELECT sobre dbo.ProblemFechaEvento (y COL_LENGTH).

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
    private readonly Dictionary<string, List<object>> _categoriasPorCodigo =
        new Dictionary<string, List<object>>(StringComparer.OrdinalIgnoreCase);

    public string Estado { get; private set; }
    // Inicio de la captura viva, ya en zona de presentacion (dd/MM/yyyy), o null.
    public string Desde { get; private set; }

    private HistorialFechas(string estado) { Estado = estado; }

    // Eventos de la iniciativa (Categoria NULL).
    public List<object> Para(string codigo)
    {
        List<object> l;
        return codigo != null && _porCodigo.TryGetValue(codigo, out l) ? l : new List<object>();
    }

    // Eventos de las fechas propias de sus categorias, en orden de IdEvento.
    public List<object> CategoriasPara(string codigo)
    {
        List<object> l;
        return codigo != null && _categoriasPorCodigo.TryGetValue(codigo, out l) ? l : new List<object>();
    }

    public static HistorialFechas Leer(SqlConnection cn)
    {
        return LeerDe(cn, null);
    }

    // soloFolio null = todos los eventos (Leer); si no, solo los de ese
    // Codigo (ExperienciaQueries.RegistroIniciativas(folio)). El inicio de
    // la captura viva (Desde, y con el `reconstruido` de cada evento) es de
    // TODA la tabla, no del folio: con filtro se pide aparte, como MIN, para
    // que cada evento salga igual que en el registro entero.
    public static HistorialFechas LeerDe(SqlConnection cn, string soloFolio)
    {
        try
        {
            using (var cmd = new SqlCommand(
                "SELECT CASE WHEN OBJECT_ID(N'dbo.ProblemFechaEvento', N'U') IS NULL THEN 0 ELSE 1 END", cn))
            {
                if (Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 0)
                    return new HistorialFechas(ESTADO_SIN_TABLA);
            }

            bool conCategoria;
            using (var cmd = new SqlCommand(
                "SELECT CASE WHEN COL_LENGTH(N'dbo.ProblemFechaEvento', N'Categoria') IS NULL THEN 0 ELSE 1 END", cn))
                conCategoria = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;

            var filas = new List<Evento>();
            using (var cmd = new SqlCommand(
                "SELECT IdEvento, Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, " +
                "       Usuario, SolicitudId, FechaRegistro, " +
                (conCategoria ? "Categoria " : "CONVERT(nvarchar(450), NULL) ") +
                "FROM dbo.ProblemFechaEvento " +
                (soloFolio == null ? "" : "WHERE Codigo = @folio ") +
                "ORDER BY Codigo, IdEvento", cn))
            {
                cmd.CommandType = CommandType.Text;
                if (soloFolio != null) cmd.Parameters.Add("@folio", SqlDbType.NVarChar, 100).Value = soloFolio;
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
                            Categoria = rd.IsDBNull(10) ? null : rd.GetString(10),
                        });
                    }
                }
            }
            if (soloFolio == null) return Armar(filas);

            // La misma regla que InicioDe sobre todas las filas: 'B' de la
            // iniciativa (Categoria NULL; sin la columna, todas lo son).
            DateTime? inicio;
            using (var cmd = new SqlCommand(
                "SELECT MIN(FechaRegistro) FROM dbo.ProblemFechaEvento WHERE Operacion = 'B' COLLATE Latin1_General_BIN2" +
                (conCategoria ? " AND Categoria IS NULL" : ""), cn))
            {
                var v = cmd.ExecuteScalar();
                inicio = v == null || v is DBNull ? (DateTime?)null : Convert.ToDateTime(v, CultureInfo.InvariantCulture);
            }
            return ArmarDesde(filas, inicio);
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
        return ArmarDesde(filas, InicioDe(filas));
    }

    private static DateTime? InicioDe(List<Evento> filas)
    {
        DateTime? inicio = null;
        foreach (var e in filas)
            if (e.Operacion == "B" && e.Categoria == null && (!inicio.HasValue || e.RegistroUtc < inicio.Value))
                inicio = e.RegistroUtc;
        return inicio;
    }

    // inicio: el de InicioDe sobre TODA la tabla, aunque 'filas' sea de un folio.
    private static HistorialFechas ArmarDesde(List<Evento> filas, DateTime? inicio)
    {
        var h = new HistorialFechas(ESTADO_OK);

        if (inicio.HasValue)
            h.Desde = DashboardDataInfo.UtcAPresentacion(inicio.Value).ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

        foreach (var e in filas)
        {
            if (string.IsNullOrEmpty(e.Codigo)) continue;
            var destino = e.Categoria == null ? h._porCodigo : h._categoriasPorCodigo;
            List<object> lista;
            if (!destino.TryGetValue(e.Codigo, out lista))
            {
                lista = new List<object>();
                destino[e.Codigo] = lista;
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
            d["reconstruido"] = e.Categoria == null && e.Operacion == "U" && inicio.HasValue && e.RegistroUtc < inicio.Value;
            if (e.Categoria != null) d["categoria"] = e.Categoria;
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
        public string Categoria;   // null = evento de la iniciativa
    }
}
