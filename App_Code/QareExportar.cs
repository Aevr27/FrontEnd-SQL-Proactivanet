// Tickets del boton "⬇ Descargar QARE" (handlers/qare_exportar.ashx).
//
// Solo lectura: un EXEC de un SP de lectura y un SELECT de una funcion;
// ningun INSERT/UPDATE/DELETE ni objeto nuevo en la base. El XLSX lo arma el
// navegador (qare/qare.js); aqui no se genera ningun archivo.
//
// DOS LECTURAS, UNA POBLACION
//   1) dbo.usp_CorreoQARE_Detalle(@FechaInicio, @FechaFin): la fuente
//      canonica del DETALLE -una fila por ticket, sus 50 columnas y las seis
//      banderas Es*/UsuarioConfirmo que calcula el propio SP-. Lee
//      dbo.vw_CorreoQARECierre_Base con FechaFirmaSolucion >= @FechaInicio y
//      < @FechaFin + 1 dia: el mismo rango, con el fin incluido, que la TVF.
//      No tiene filtros de C1/Grupo/Lider.
//   2) dbo.tvf_CorreoQARE_Base(@FechaInicio, @FechaFin, @C1, @Grupos,
//      @Lideres) (sql/16_qare_filtros_org.sql): la MISMA fuente filtrada de
//      los seis dbo.usp_CorreoQARE_* del tablero. De aqui salen QUE tickets
//      pasan los filtros y su C1 y Lider; aqui no se repite ni el mapeo
//      Grupo -> Lider ni el calculo del C1.
//   El export es la interseccion por CodigoTicket: las filas del SP cuyo
//   ticket devolvio la TVF, con C1/Lider de la TVF. Sin filtros, la TVF
//   devuelve el rango entero y salen todas las del SP.
//
//   sql/diag_qare_detalle_poblacion.sql (VM, 2026-09-29) comprobo que sin
//   filtros SP y TVF traen los MISMOS tickets: 15 dias 4657/4657, 30 dias
//   11353/11353, 0 diferencias en ambos sentidos y 0 CodigoTicket repetidos.
//   Tiempos medidos: SP 1.1 s + TVF 0.6 s (15 dias); 3.8 s + 1.0 s (30).
//   Con un filtro, el SP sigue leyendo el rango entero y lo que sobra se
//   descarta aqui: correcto, aunque no lo mas rapido.
//
// QARe_VerificoClasificacion
//   El SP la tiene comentada: solo la usa para calcular UsuarioConfirmo y
//   EsInconsistenciaConfirmacionQA. La respuesta cruda ("¿Verificaste la
//   correcta clasificacion del ticket?", la de la grafica Confirmacion vs
//   QA) sale de la TVF, que ya se lee para el filtro. OJO: UsuarioConfirmo
//   (bandera 0/1 del SP) NO sale de QARe_UsuarioConfirmo, que es otra
//   pregunta y va tal cual.
//
// Sin TOP: el export trae el rango entero.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public static class QareExportar
{
    // 30 dias son ~11.000 tickets (VM, 2026-09-28) con varios campos
    // nvarchar(max); 30 s por omision no alcanzan para rangos largos.
    private const int TIMEOUT_SEGUNDOS = 180;

    public const string SP_DETALLE = "dbo.usp_CorreoQARE_Detalle";

    // Texto fijo: los cinco valores van como parametros, nunca en la cadena.
    public const string CONSULTA_FILTRO =
        "SELECT q.CodigoTicket, q.C1, q.Lider, q.QARe_VerificoClasificacion " +
        "FROM dbo.tvf_CorreoQARE_Base(@FechaInicio, @FechaFin, @C1, @Grupos, @Lideres) AS q";

    // Las tres columnas que aporta la TVF (no estan en el result set del SP).
    public static readonly string[] ColumnasTvf = { "C1", "Lider", "QARe_VerificoClasificacion" };

    // Banderas 0/1 que calcula el SP. Viajan como numero, tal cual.
    public static readonly string[] Banderas =
    {
        "EsRecurrente", "UsuarioConfirmo", "EsCasoReutilizable", "EsPotencialKB",
        "EsInconsistenciaConfirmacionQA", "EsOportunidadKB",
    };

    /* Llaves JSON de cada ticket = nombre de la columna en el SP (o en la
       TVF, las de ColumnasTvf), en el orden del libro. Fuera FechaInicio y
       FechaFin del SP: son el rango del reporte y van en la cabecera. Las
       del SP se leen POR NOMBRE, asi que una columna nueva en el SP no
       desfasa nada. */
    public static readonly string[] Columnas =
    {
        // Ticket / contexto
        "CodigoTicket", "FechaRegistro", "Tipo", "TipoRelacion", "Estado", "Subestado", "Prioridad",
        "Categoria", "Grupo", "C1", "Lider", "Tecnico", "Cliente", "Sucursal", "Tienda",
        "Titulo", "Descripcion", "SolucionUsuario", "FechaEstimadaResolucion", "FechaFirmaSolucion",
        "FechaUltimaModificacion", "FechaFirmaCierre", "FirmaCierreRevocacion", "FirmaSolucion",
        "ResponsableUltimaModificacion", "NotificadoPor", "FechaEstimadaOlaUc", "IntentosSolucion",
        "ReasignacionesGrupo", "Caducada", "RegistradoPor",
        // QA
        "QA_MensajeError", "QA_Frecuencia", "QA_Aplicacion", "QA_PasoAPaso",
        // QARE
        "QARe_Causa", "QARe_UsuarioConfirmo", "QARe_AplicaOtrosCasos", "QARe_GenerarArticulo",
        "QARe_VerificoClasificacion", "QARe_Evidencia", "QARe_DescripcionSolucion", "QARe_TipoSolucion",
        // Validacion / banderas
        "GrupoCorrecto", "Validacion",
        "EsRecurrente", "UsuarioConfirmo", "EsCasoReutilizable", "EsPotencialKB",
        "EsInconsistenciaConfirmacionQA", "EsOportunidadKB",
    };

    public static List<Dictionary<string, object>> Tickets(DateTime inicio, DateTime fin,
                                                           IDictionary<string, object> filtros)
    {
        Dictionary<string, object[]> filtrados;
        List<Dictionary<string, object>> detalle;

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();

            using (var cmd = new SqlCommand(CONSULTA_FILTRO, cn))
            {
                cmd.CommandType = CommandType.Text;
                cmd.CommandTimeout = TIMEOUT_SEGUNDOS;
                Fechas(cmd, inicio, fin);
                // Mismos nombres que en QareQueries (sin la @). La TVF pide
                // sus cinco argumentos: un filtro vacio viaja como NULL.
                foreach (var nombre in QareQueries.Filtros)
                {
                    object valor = null;
                    if (filtros != null) filtros.TryGetValue(nombre, out valor);
                    cmd.Parameters.Add("@" + nombre, SqlDbType.NVarChar, -1).Value = valor ?? DBNull.Value;
                }
                filtrados = new Dictionary<string, object[]>(StringComparer.Ordinal);
                using (var rd = cmd.ExecuteReader())
                {
                    while (rd.Read())
                    {
                        var codigo = Convert.ToString(rd.GetValue(0), CultureInfo.InvariantCulture);
                        if (!filtrados.ContainsKey(codigo))
                            filtrados[codigo] = new[] { Valor(rd.GetValue(1)), Valor(rd.GetValue(2)), Valor(rd.GetValue(3)) };
                    }
                }
            }

            using (var cmd = new SqlCommand(SP_DETALLE, cn))
            {
                cmd.CommandType = CommandType.StoredProcedure;
                cmd.CommandTimeout = TIMEOUT_SEGUNDOS;
                Fechas(cmd, inicio, fin);
                detalle = new List<Dictionary<string, object>>();
                using (var rd = cmd.ExecuteReader())
                {
                    var ordinal = new Dictionary<string, int>(StringComparer.Ordinal);
                    foreach (var c in Columnas)
                        if (Array.IndexOf(ColumnasTvf, c) < 0) ordinal[c] = rd.GetOrdinal(c);
                    while (rd.Read())
                    {
                        var fila = new Dictionary<string, object>(StringComparer.Ordinal);
                        foreach (var par in ordinal) fila[par.Key] = Valor(rd.GetValue(par.Value));
                        detalle.Add(fila);
                    }
                }
            }
        }
        return Unir(detalle, filtrados);
    }

    /* La interseccion, aparte para probarla sin base. `detalle`: filas del
       SP (llaves = Columnas menos ColumnasTvf), en su orden -FechaFirmaSolucion
       DESC, CodigoTicket-. `filtrados`: CodigoTicket -> {C1, Lider,
       QARe_VerificoClasificacion} de la TVF. Sale una fila por ticket que
       esta en AMBOS, en el orden del SP, con las llaves en el orden de
       Columnas. Un ticket que el SP repitiera sale una vez (la primera): el
       SP es SELECT DISTINCT y el diag de la VM dio 0 repetidos, asi que es
       solo una red. */
    public static List<Dictionary<string, object>> Unir(List<Dictionary<string, object>> detalle,
                                                        Dictionary<string, object[]> filtrados)
    {
        var salida = new List<Dictionary<string, object>>();
        var vistos = new HashSet<string>(StringComparer.Ordinal);
        foreach (var d in detalle)
        {
            var codigo = d["CodigoTicket"] as string;
            object[] tvf;
            if (codigo == null || !filtrados.TryGetValue(codigo, out tvf) || !vistos.Add(codigo)) continue;
            var t = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (var c in Columnas)
            {
                int i = Array.IndexOf(ColumnasTvf, c);
                t[c] = i >= 0 ? tvf[i] : d[c];
            }
            salida.Add(t);
        }
        return salida;
    }

    private static void Fechas(SqlCommand cmd, DateTime inicio, DateTime fin)
    {
        cmd.Parameters.Add("@FechaInicio", SqlDbType.Date).Value = inicio.Date;
        cmd.Parameters.Add("@FechaFin", SqlDbType.Date).Value = fin.Date;
    }

    // Texto salvo los enteros: las banderas 0/1, IntentosSolucion y
    // ReasignacionesGrupo viajan como numero, tal cual los da el SP; el bit
    // Caducada, como 0/1 (en JSON seria true/false). Codigos y fechas van
    // como texto: el libro no debe reinterpretarlos. Las fechas llevan hora
    // (DATETIME2(0) en la vista), como en el export de Experiencia.
    private static object Valor(object v)
    {
        if (v == null || v is DBNull) return null;
        if (v is int || v is short || v is byte) return Convert.ToInt32(v, CultureInfo.InvariantCulture);
        if (v is long) return v;
        if (v is bool) return (bool)v ? 1 : 0;
        if (v is DateTime)
            return ((DateTime)v).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        var s = Convert.ToString(v, CultureInfo.InvariantCulture);
        return string.IsNullOrEmpty(s) ? null : s;
    }
}
