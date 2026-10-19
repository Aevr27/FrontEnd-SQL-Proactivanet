// Capa de datos de la pestaña "Orquestación" (orquestacion/).
//
// Sin BOM: los literales con acento van escapados (IIS Express compila
// App_Code con la codepage ANSI).
//
// LAS CUENTAS NO SE HACEN AQUI. El Excel de orquestacion lo carga
// cargar_orquestacion.py en el esquema orq (76_orquestacion.sql), y las reglas
// de cada indicador estan en las vistas del 77 (77_tablero_orquestacion.sql):
// orq.vw_TableroJob trae un renglon por job con cada indicador ya resuelto
// en 1 o 0. Aqui solo se leen; la pestaña filtra y suma.
//
// QUE DEVUELVE
// ------------
//   Construir()   lo de la pestaña:
//     hay_datos   false si falta el 77, la cuenta no puede leer orq (para
//                 OBJECT_ID es lo mismo) o no hay ninguna carga aplicada.
//     carga       la ultima carga aplicada (orq.CargaLote) y sus advertencias
//                 por tipo.
//     parametros  los costos y las ejecuciones capturadas (orq.Parametro).
//     jobs        orq.vw_TableroJob, en columnas: { cols: [...], filas: [[...]] }
//                 (10 mil jobs: los nombres de campo una sola vez).
//     decomisos   orq.vw_TableroDecomiso, igual.
//     historico   orq.AvanceDiario: las fotos del Excel y las de la base.
//     campos      los 14 campos de W a AJ, en el orden de vw_TableroJob.Campos.
//   Detalle()     orq.vw_TableroDetalle, en columnas: la lista de jobs y su
//                 Excel. Se pide aparte (?detalle=1) porque pesa mas que todo
//                 lo demas junto y solo hace falta al abrir la lista.
//
// Solo lectura. La cuenta del tablero necesita SELECT sobre el esquema orq.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public static class OrquestacionQueries
{
    // Los 14 campos que cuenta la completitud, en el orden de la columna
    // Campos de orq.vw_TableroJob (W a AJ del Excel).
    private static readonly string[,] CAMPOS =
    {
        { "W", "Reducci\u00F3n posible de ejecuciones" },
        { "X", "Es necesario que siga ejecut\u00E1ndose" },
        { "Y", "Horario en que debe ejecutarse" },
        { "Z", "Justificaci\u00F3n / explicaci\u00F3n" },
        { "AA", "Criticidad" },
        { "AB", "Acciones en caso de falla" },
        { "AC", "Primer punto de escalaci\u00F3n" },
        { "AD", "Segundo punto de escalaci\u00F3n" },
        { "AE", "Tercer punto de escalaci\u00F3n" },
        { "AF", "Aplicaci\u00F3n" },
        { "AG", "Product Owner / N3" },
        { "AH", "Service Owner N2" },
        { "AI", "Director PO" },
        { "AJ", "Proceso de negocio o barredora" },
    };

    public static Dictionary<string, object> Construir()
    {
        var hoy = DashboardDataInfo.HoyEnPresentacion();
        var salida = new Dictionary<string, object>();
        salida["hoy"] = hoy.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        salida["campos"] = Campos();

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();

            var carga = HayVistas(cn) ? LeerCarga(cn) : null;
            salida["hay_datos"] = carga != null;
            salida["carga"] = carga;

            object fecha = null;
            if (carga != null)
            {
                fecha = carga["fecha_dt"];
                carga.Remove("fecha_dt");
                salida["parametros"] = LeerParametros(cn);
                salida["jobs"] = Columnas(cn, "SELECT * FROM orq.vw_TableroJob ORDER BY JobId");
                salida["decomisos"] = Columnas(cn, "SELECT * FROM orq.vw_TableroDecomiso ORDER BY DecomisoId");
                salida["historico"] = Columnas(cn,
                    "SELECT Fecha, Origen, UniversoJobs, Candidatos, Migrados, MigradosNuevos, CandidatosDecomiso, " +
                    "       Huerfanos, TotalDecomisos, PctAvanceDecomisos, PendientesAdopcion, EjecucionesDiarias " +
                    "FROM orq.AvanceDiario ORDER BY Fecha, Origen");
            }

            var info = DashboardDataInfo.Corte(
                "Orquestaci\u00F3n", fecha, ZonaSello.YaLocal,
                "orq: ultima carga del Excel (cargar_orquestacion.py), vistas del 77_tablero_orquestacion.sql");
            salida["meta"] = info.AJson();
        }
        return salida;
    }

    public static Dictionary<string, object> Detalle()
    {
        var salida = new Dictionary<string, object>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            var hay = HayVistas(cn);
            salida["hay_datos"] = hay;
            if (hay) salida["detalle"] = Columnas(cn, "SELECT * FROM orq.vw_TableroDetalle ORDER BY JobId");
        }
        return salida;
    }

    // ------------------------------------------------------------------
    // Lecturas
    // ------------------------------------------------------------------

    private static bool HayVistas(SqlConnection cn)
    {
        using (var cmd = new SqlCommand(
            "SELECT CASE WHEN OBJECT_ID(N'orq.vw_TableroJob', N'V') IS NOT NULL " +
            "             AND OBJECT_ID(N'orq.vw_TableroDecomiso', N'V') IS NOT NULL " +
            "             AND OBJECT_ID(N'orq.vw_TableroDetalle', N'V') IS NOT NULL THEN 1 ELSE 0 END", cn))
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    private static Dictionary<string, object> LeerCarga(SqlConnection cn)
    {
        Dictionary<string, object> c = null;
        object lote = null;
        const string SQL =
            "SELECT TOP (1) LoteId, Numero, Archivo, FechaFin, JobsEnExcel, JobsNuevos, JobsCambiados, " +
            "       JobsBaja, Advertencias " +
            "FROM orq.CargaLote WHERE Estado = N'Aplicado' ORDER BY Numero DESC";
        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            if (!rd.Read()) return null;
            lote = rd.GetValue(0);
            c = new Dictionary<string, object>();
            c["numero"] = Valor(rd.GetValue(1));
            c["archivo"] = Valor(rd.GetValue(2));
            c["fecha_dt"] = rd.IsDBNull(3) ? null : (object)rd.GetDateTime(3);
            c["fecha"] = rd.IsDBNull(3) ? null
                : rd.GetDateTime(3).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
            c["jobs_en_excel"] = Valor(rd.GetValue(4));
            c["jobs_nuevos"] = Valor(rd.GetValue(5));
            c["jobs_cambiados"] = Valor(rd.GetValue(6));
            c["jobs_baja"] = Valor(rd.GetValue(7));
            c["advertencias"] = Valor(rd.GetValue(8));
        }

        // Por tipo, sin el valor (puede ser el nombre de una persona): como el log.
        var tipos = new List<object>();
        using (var cmd = new SqlCommand(
            "SELECT Hoja, Tipo, COUNT(*) FROM orq.Advertencia WHERE LoteId = @lote " +
            "GROUP BY Hoja, Tipo ORDER BY COUNT(*) DESC, Tipo", cn))
        {
            cmd.Parameters.Add("@lote", SqlDbType.UniqueIdentifier).Value = lote;
            using (var rd = cmd.ExecuteReader())
                while (rd.Read())
                    tipos.Add(new Dictionary<string, object>
                    {
                        { "hoja", Valor(rd.GetValue(0)) },
                        { "tipo", Valor(rd.GetValue(1)) },
                        { "cuantas", Valor(rd.GetValue(2)) },
                    });
        }
        c["advertencias_por_tipo"] = tipos;
        return c;
    }

    private static Dictionary<string, object> LeerParametros(SqlConnection cn)
    {
        var p = new Dictionary<string, object>();
        using (var cmd = new SqlCommand("SELECT Clave, Valor FROM orq.Parametro", cn))
        using (var rd = cmd.ExecuteReader())
            while (rd.Read())
                p[rd.GetString(0)] = Numero(Valor(rd.GetValue(1)));
        return p;
    }

    // orquestacion.js solo suma numeros (num() deja en 0 todo lo demas): si
    // orq.Parametro.Valor llega como texto ("1250.50"), se pasa a double. Lo
    // que no es numero se queda como texto.
    private static object Numero(object v)
    {
        var s = v as string;
        if (s == null) return v;
        double d;
        return double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out d)
            ? (object)Math.Round(d, 4) : v;
    }

    // Un SELECT en columnas: { cols: [nombres], filas: [[valores]] }.
    private static Dictionary<string, object> Columnas(SqlConnection cn, string sql)
    {
        var cols = new List<string>();
        var filas = new List<object[]>();
        using (var cmd = new SqlCommand(sql, cn))
        {
            cmd.CommandTimeout = 120;
            using (var rd = cmd.ExecuteReader())
            {
                for (int i = 0; i < rd.FieldCount; i++) cols.Add(rd.GetName(i));
                while (rd.Read())
                {
                    var f = new object[rd.FieldCount];
                    for (int i = 0; i < rd.FieldCount; i++) f[i] = Valor(rd.GetValue(i));
                    filas.Add(f);
                }
            }
        }
        return new Dictionary<string, object> { { "cols", cols }, { "filas", filas } };
    }

    private static List<object> Campos()
    {
        var l = new List<object>();
        for (int i = 0; i < CAMPOS.GetLength(0); i++)
            l.Add(new Dictionary<string, object> { { "letra", CAMPOS[i, 0] }, { "nombre", CAMPOS[i, 1] } });
        return l;
    }

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    // Lo que el navegador necesita: los DECIMAL como double con cuatro
    // decimales, los BIT como 0/1 (pesan menos que true/false en 10 mil
    // renglones) y las fechas como yyyy-MM-dd, que se parten con split('-').
    private static object Valor(object v)
    {
        if (v == null || v is DBNull) return null;
        if (v is bool) return (bool)v ? 1 : 0;
        if (v is decimal || v is double || v is float)
            return Math.Round(Convert.ToDouble(v, CultureInfo.InvariantCulture), 4);
        if (v is DateTime) return ((DateTime)v).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (v is Guid) return v.ToString();
        return v;
    }
}
