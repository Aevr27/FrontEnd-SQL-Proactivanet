// "Historial de peticiones" de Admin/Iniciativas (pestaña Administracion,
// solo ADM): las peticiones ENVIADAS de los dos tipos que ya existen, en una
// sola lista de solo lectura, la mas reciente primero.
//
//   INICIATIVA  "Solicitar una iniciativa": adm.SolicitudIniciativa (sql/29).
//               Fecha = FechaUtc (DEFAULT SYSUTCDATETIME() al enviar; aprobar
//               y rechazar de sql/31 NO la tocan: escriben FechaRevisionUtc).
//               Folio = NumeroSolicitud (#0000012, como la vista Nuevas).
//               Solicitante = SolicitanteNombre / Cuenta / Correo guardados.
//               Iniciativa = el Titulo pedido y, si la aprobacion la creo
//               (sql/32), CodigoIniciativa. Estado ENVIADA|APROBADA|RECHAZADA.
//   CAMBIO      "Solicitar cambios": adm.SolicitudCambio (sql/22).
//               Fecha = FechaSolicitudUtc (DEFAULT al enviar; revisar escribe
//               FechaRevisionUtc). Folio = IdSolicitud (#12, como la cola).
//               Solicitante = SolicitadoPor (la cuenta Windows) y su rol.
//               Iniciativa = Codigo y el Titulo actual de dbo.Problem.
//               Estado PENDIENTE|APLICADA|RECHAZADA.
//
// No es bitacora: no lista aprobaciones, rechazos ni ediciones; cada fila es
// UNA peticion (la llave de su tabla), nunca repetida: el titulo del cambio
// sale con OUTER APPLY TOP (1), no con un JOIN que podria duplicar.
//
// Fechas: el navegador manda el rango como instantes UTC (el inicio de su
// dia "desde" y el inicio del dia SIGUIENTE a "hasta", exclusivo), asi que
// el dia final entra completo sea cual sea la precision de la hora, y los
// limites son los mismos dias que la pagina pinta en hora local. Sin rango:
// todo el historial. Cada tipo se lee con TOP (Maximo) y su COUNT; la lista
// unida se recorta a Maximo y dice cuantas habia (nada se descarta callado).
//
// Una tabla que no existe (sql/22 o sql/29 sin aplicar) no rompe la otra:
// su tipo sale como no disponible. Las columnas de sql/32 se piden solo si
// existen.
//
// SOLO LECTURA (SELECT con la cuenta del sitio, como las colas). Se prueba
// sin SQL en tools/tests/HistorialPeticionesHttpSmoke.cs.
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public sealed class PeticionHistorial
{
    public const string TipoIniciativa = "INICIATIVA";
    public const string TipoCambio = "CAMBIO";
    public string Tipo;
    public int Id;
    public string FolioTexto;
    public DateTime FechaUtc;
    public string SolicitanteNombre;
    public string SolicitanteCuenta;
    public string SolicitanteCorreo;
    public string RolSolicitante;
    public string IniciativaCodigo;
    public string IniciativaTitulo;
    public string Detalle;       // tipo de iniciativa pedida / tipo de cambio
    public string Estado;        // el valor guardado, tal cual
}

public sealed class FiltroHistorial
{
    public DateTime? DesdeUtc;   // incluido
    public DateTime? HastaUtc;   // EXCLUIDO (inicio del dia siguiente)
    public string Tipo;          // null = los dos
}

public sealed class LecturaHistorial
{
    public bool IniciativasDisponible;
    public bool CambiosDisponible;
    public int TotalIniciativas;
    public int TotalCambios;
    public List<PeticionHistorial> Peticiones = new List<PeticionHistorial>();
}

public interface IFuenteHistorialPeticiones
{
    LecturaHistorial Leer(FiltroHistorial filtro, int maximo);
}

public sealed class FuenteHistorialPeticionesSql : IFuenteHistorialPeticiones
{
    private readonly Func<SqlConnection> abrir;
    public FuenteHistorialPeticionesSql() : this(null) { }
    // abrir: para las pruebas (LocalDB). null = la cadena del sitio.
    public FuenteHistorialPeticionesSql(Func<SqlConnection> abrir)
    {
        this.abrir = abrir ?? delegate { return new SqlConnection(DashboardDb.CadenaConexion()); };
    }

    public const string ConsultaTablas =
        "SELECT CASE WHEN OBJECT_ID(N'adm.SolicitudIniciativa', N'U') IS NOT NULL THEN 1 ELSE 0 END, " +
        "       CASE WHEN COL_LENGTH(N'adm.SolicitudIniciativa', N'CodigoIniciativa') IS NOT NULL THEN 1 ELSE 0 END, " +
        "       CASE WHEN OBJECT_ID(N'adm.SolicitudCambio', N'U') IS NOT NULL THEN 1 ELSE 0 END";

    private const string RangoIniciativa = "(@desde IS NULL OR s.FechaUtc >= @desde) AND (@hasta IS NULL OR s.FechaUtc < @hasta)";
    private const string RangoCambio = "(@desde IS NULL OR s.FechaSolicitudUtc >= @desde) AND (@hasta IS NULL OR s.FechaSolicitudUtc < @hasta)";

    public static string ConsultaIniciativas(bool conCodigo)
    {
        return "SELECT TOP (@max) s.NumeroSolicitud, s.FechaUtc, s.Estado, s.Titulo, s.TipoIniciativa, " +
               "s.SolicitanteNombre, s.SolicitanteCuenta, s.SolicitanteCorreo, " +
               (conCodigo ? "s.CodigoIniciativa" : "CodigoIniciativa = CONVERT(nvarchar(100), NULL)") + "\n" +
               "FROM adm.SolicitudIniciativa AS s WHERE " + RangoIniciativa + "\n" +
               "ORDER BY s.FechaUtc DESC, s.NumeroSolicitud DESC;\n" +
               "SELECT COUNT(*) FROM adm.SolicitudIniciativa AS s WHERE " + RangoIniciativa + ";";
    }

    public const string ConsultaCambios =
        "SELECT TOP (@max) s.IdSolicitud, s.FechaSolicitudUtc, s.Estado, s.Codigo, t.Titulo, s.Tipo, s.SolicitadoPor, s.RolSolicitante\n" +
        "FROM adm.SolicitudCambio AS s\n" +
        "OUTER APPLY (SELECT TOP (1) p.Titulo FROM dbo.Problem AS p WHERE p.Codigo = s.Codigo) AS t\n" +
        "WHERE " + RangoCambio + "\n" +
        "ORDER BY s.FechaSolicitudUtc DESC, s.IdSolicitud DESC;\n" +
        "SELECT COUNT(*) FROM adm.SolicitudCambio AS s WHERE " + RangoCambio + ";";

    public LecturaHistorial Leer(FiltroHistorial filtro, int maximo)
    {
        var l = new LecturaHistorial();
        using (var cn = abrir())
        {
            if (cn.State != ConnectionState.Open) cn.Open();
            bool conCodigo;
            using (var cmd = new SqlCommand(ConsultaTablas, cn) { CommandTimeout = 15 })
            using (var r = cmd.ExecuteReader())
            {
                r.Read();
                l.IniciativasDisponible = Convert.ToInt32(r.GetValue(0), CultureInfo.InvariantCulture) == 1;
                conCodigo = Convert.ToInt32(r.GetValue(1), CultureInfo.InvariantCulture) == 1;
                l.CambiosDisponible = Convert.ToInt32(r.GetValue(2), CultureInfo.InvariantCulture) == 1;
            }
            if (l.IniciativasDisponible && filtro.Tipo != PeticionHistorial.TipoCambio)
            {
                using (var cmd = Comando(cn, ConsultaIniciativas(conCodigo), filtro, maximo))
                using (var r = cmd.ExecuteReader())
                {
                    while (r.Read())
                    {
                        var n = Convert.ToInt32(r.GetValue(0), CultureInfo.InvariantCulture);
                        l.Peticiones.Add(new PeticionHistorial
                        {
                            Tipo = PeticionHistorial.TipoIniciativa, Id = n, FolioTexto = new NumeroSolicitud(n).ToString(),
                            FechaUtc = r.GetDateTime(1), Estado = Texto(r, 2), IniciativaTitulo = Texto(r, 3), Detalle = Texto(r, 4),
                            SolicitanteNombre = Texto(r, 5), SolicitanteCuenta = Texto(r, 6), SolicitanteCorreo = Texto(r, 7),
                            IniciativaCodigo = Texto(r, 8),
                        });
                    }
                    if (r.NextResult() && r.Read()) l.TotalIniciativas = Convert.ToInt32(r.GetValue(0), CultureInfo.InvariantCulture);
                }
            }
            if (l.CambiosDisponible && filtro.Tipo != PeticionHistorial.TipoIniciativa)
            {
                using (var cmd = Comando(cn, ConsultaCambios, filtro, maximo))
                using (var r = cmd.ExecuteReader())
                {
                    while (r.Read())
                    {
                        var id = Convert.ToInt32(r.GetValue(0), CultureInfo.InvariantCulture);
                        l.Peticiones.Add(new PeticionHistorial
                        {
                            Tipo = PeticionHistorial.TipoCambio, Id = id, FolioTexto = "#" + id.ToString(CultureInfo.InvariantCulture),
                            FechaUtc = r.GetDateTime(1), Estado = Texto(r, 2), IniciativaCodigo = Texto(r, 3), IniciativaTitulo = Texto(r, 4),
                            Detalle = Texto(r, 5), SolicitanteCuenta = Texto(r, 6), RolSolicitante = Texto(r, 7),
                        });
                    }
                    if (r.NextResult() && r.Read()) l.TotalCambios = Convert.ToInt32(r.GetValue(0), CultureInfo.InvariantCulture);
                }
            }
        }
        return l;
    }

    private static SqlCommand Comando(SqlConnection cn, string sql, FiltroHistorial f, int maximo)
    {
        var cmd = new SqlCommand(sql, cn) { CommandTimeout = 60 };
        cmd.Parameters.Add("@max", SqlDbType.Int).Value = maximo;
        cmd.Parameters.Add("@desde", SqlDbType.DateTime2).Value = f.DesdeUtc.HasValue ? (object)f.DesdeUtc.Value : DBNull.Value;
        cmd.Parameters.Add("@hasta", SqlDbType.DateTime2).Value = f.HastaUtc.HasValue ? (object)f.HastaUtc.Value : DBNull.Value;
        return cmd;
    }

    private static string Texto(SqlDataReader r, int i)
    {
        return r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture);
    }
}

public static class HistorialPeticiones
{
    public const int Maximo = 500;
    public const string MensajeSoloAdm = "Solo un administrador (ADM) puede ver el historial de peticiones.";

    private static IFuenteHistorialPeticiones fuente;
    public static IFuenteHistorialPeticiones Fuente
    {
        get { return fuente ?? (fuente = new FuenteHistorialPeticionesSql()); }
        set { fuente = value; }
    }

    // ?desde=&hasta=&tipo= -> filtro, o el mensaje del 400. desde / hasta:
    // instantes UTC "aaaa-mm-ddThh:mm:ssZ" (hasta EXCLUIDO); tipo: vacio,
    // INICIATIVA o CAMBIO.
    public static string LeerFiltro(NameValueCollection qs, out FiltroHistorial filtro)
    {
        filtro = new FiltroHistorial();
        DateTime d;
        var desde = (qs["desde"] ?? "").Trim();
        var hasta = (qs["hasta"] ?? "").Trim();
        var tipo = (qs["tipo"] ?? "").Trim();
        if (desde.Length > 0)
        {
            if (!Instante(desde, out d)) return "La fecha desde no es válida.";
            filtro.DesdeUtc = d;
        }
        if (hasta.Length > 0)
        {
            if (!Instante(hasta, out d)) return "La fecha hasta no es válida.";
            filtro.HastaUtc = d;
        }
        if (filtro.DesdeUtc.HasValue && filtro.HastaUtc.HasValue && filtro.DesdeUtc.Value >= filtro.HastaUtc.Value)
            return "La fecha desde no puede ser posterior a la fecha hasta.";
        if (tipo.Length > 0 && tipo != PeticionHistorial.TipoIniciativa && tipo != PeticionHistorial.TipoCambio)
            return "Tipo de petición desconocido.";
        filtro.Tipo = tipo.Length > 0 ? tipo : null;
        return null;
    }

    private static bool Instante(string texto, out DateTime utc)
    {
        return DateTime.TryParseExact(texto, new[] { "yyyy-MM-ddTHH:mm:ssZ", "yyyy-MM-ddTHH:mm:ss.fffZ" }, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out utc);
    }

    // Une los dos tipos, la mas reciente primero (empates: el numero mayor
    // primero, iniciativas antes que cambios) y recorta a `maximo`.
    public static Dictionary<string, object> Json(LecturaHistorial l, int maximo)
    {
        var todas = new List<PeticionHistorial>(l.Peticiones);
        todas.Sort(delegate (PeticionHistorial a, PeticionHistorial b)
        {
            int c = b.FechaUtc.CompareTo(a.FechaUtc);
            if (c != 0) return c;
            c = string.CompareOrdinal(a.Tipo, b.Tipo) * -1;   // INICIATIVA antes que CAMBIO
            return c != 0 ? c : b.Id.CompareTo(a.Id);
        });
        if (todas.Count > maximo) todas.RemoveRange(maximo, todas.Count - maximo);
        var filas = new List<object>();
        foreach (var p in todas)
        {
            filas.Add(new Dictionary<string, object>
            {
                { "tipo", p.Tipo }, { "id", p.Id }, { "folio", p.FolioTexto },
                { "fecha_utc", DateTime.SpecifyKind(p.FechaUtc, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "Z" },
                { "solicitante_nombre", p.SolicitanteNombre }, { "solicitante_cuenta", p.SolicitanteCuenta },
                { "solicitante_correo", p.SolicitanteCorreo }, { "rol_solicitante", p.RolSolicitante },
                { "iniciativa_codigo", p.IniciativaCodigo }, { "iniciativa_titulo", p.IniciativaTitulo },
                { "detalle", p.Detalle }, { "estado", p.Estado },
            });
        }
        return new Dictionary<string, object>
        {
            { "peticiones", filas }, { "maximo", maximo },
            { "total", l.TotalIniciativas + l.TotalCambios },
            { "total_iniciativas", l.TotalIniciativas }, { "total_cambios", l.TotalCambios },
            { "iniciativas_disponible", l.IniciativasDisponible }, { "cambios_disponible", l.CambiosDisponible },
        };
    }
}
