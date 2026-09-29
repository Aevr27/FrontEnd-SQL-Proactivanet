// Tickets del boton "⬇ Descargar QARE" (handlers/qare_exportar.ashx).
//
// Solo lectura: un SELECT, ningun INSERT/UPDATE/DELETE ni objeto nuevo en la
// base. El XLSX lo arma el navegador (qare/qare.js); aqui no se genera
// ningun archivo.
//
// LA MISMA POBLACION QUE EL TABLERO
//   La fuente es dbo.tvf_CorreoQARE_Base (sql/16_qare_filtros_org.sql), la
//   misma de la que leen los seis dbo.usp_CorreoQARE_*, con los MISMOS cinco
//   argumentos que les manda QareQueries: @FechaInicio/@FechaFin (DATE, el
//   dia fin incluido, sin sumar ni restar nada) y @C1/@Grupos/@Lideres (las
//   listas de BacklogUtil.Filtros; NULL = sin filtro). El rango de
//   FechaFirmaSolucion, el C1 (fn_CorreoBacklog_CategoriaC1 + 'Sin
//   categoria'), el Lider (CatLiderGrupo + 'Sin Torre') y el filtro
//   (fn_CorreoBacklog_SplitList) los resuelve la funcion: aqui no se repite
//   ni el mapeo Grupo -> Lider ni el calculo del C1, y el export no puede
//   quedar filtrado distinto que los KPIs.
//
//   Diferencia con QareQueries: la funcion pide sus cinco argumentos, asi que
//   un filtro vacio viaja como NULL en vez de omitirse.
//
// DATOS DEL TICKET
//   La funcion solo trae lo que usan los SP (las seis preguntas QA/QARE,
//   Validacion, Grupo, Categoria, C1, Lider). Lo descriptivo sale de
//   dbo.vw_Tickets por CodigoTicket, con columnas que ya lee el export de
//   Experiencia (ExperienciaQueries.EXPORT_SELECT), cuyo diag en la VM
//   confirmo CodigoTicket unico en esa vista. LEFT JOIN: un ticket QARE sin
//   fila en vw_Tickets sale igual, con esas columnas vacias.
//
// Sin TOP: el export trae el rango entero.

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;

public static class QareExportar
{
    // 30 dias son ~11.000 tickets (VM, 2026-09-28) y la funcion evalua el C1
    // por fila; 30 s por omision no alcanzan para rangos largos.
    private const int TIMEOUT_SEGUNDOS = 180;

    // Llaves JSON de cada ticket, en el orden del SELECT (y del libro). La
    // posicion i de este arreglo es la columna i de CONSULTA.
    public static readonly string[] Columnas =
    {
        "codigo", "fecha_firma_solucion", "grupo", "lider", "c1", "categoria",
        "frecuencia", "causa", "verifico_clasificacion", "aplica_otros_casos",
        "generar_articulo", "tipo_solucion", "validacion",
        "titulo", "descripcion", "solucion", "tecnico_segunda_linea", "subestado",
        "prioridad", "cliente", "sucursal", "fecha_firma_cierre", "tipo_origen",
        "registrado_por",
    };

    // Texto fijo: los cinco valores van como parametros, nunca en la cadena.
    public const string CONSULTA =
        "SELECT q.CodigoTicket, q.FechaFirmaSolucion, q.Grupo, q.Lider, q.C1, q.Categoria, " +
        "       q.QA_Frecuencia, q.QARe_Causa, q.QARe_VerificoClasificacion, q.QARe_AplicaOtrosCasos, " +
        "       q.QARe_GenerarArticulo, q.QARe_TipoSolucion, q.Validacion, " +
        "       t.Titulo, t.Descripcion, t.SolucionUsuario, t.TecnicoSegundaLinea, t.Subestado, " +
        "       t.Prioridad, t.Cliente, t.Sucursal, t.FechaFirmaCierre, t.Tipo, " +
        "       t.RegistradoPor " +
        "FROM dbo.tvf_CorreoQARE_Base(@FechaInicio, @FechaFin, @C1, @Grupos, @Lideres) AS q " +
        "LEFT JOIN dbo.vw_Tickets AS t ON t.CodigoTicket = q.CodigoTicket " +
        "ORDER BY q.FechaFirmaSolucion DESC, q.CodigoTicket";

    public static List<Dictionary<string, object>> Tickets(DateTime inicio, DateTime fin,
                                                           IDictionary<string, object> filtros)
    {
        var filas = new List<Dictionary<string, object>>();

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        using (var cmd = new SqlCommand(CONSULTA, cn))
        {
            cmd.CommandType = CommandType.Text;
            cmd.CommandTimeout = TIMEOUT_SEGUNDOS;
            cmd.Parameters.Add("@FechaInicio", SqlDbType.Date).Value = inicio.Date;
            cmd.Parameters.Add("@FechaFin", SqlDbType.Date).Value = fin.Date;
            // Mismos nombres que en QareQueries (sin la @).
            foreach (var nombre in QareQueries.Filtros)
            {
                object valor = null;
                if (filtros != null) filtros.TryGetValue(nombre, out valor);
                cmd.Parameters.Add("@" + nombre, SqlDbType.NVarChar, -1).Value = valor ?? DBNull.Value;
            }

            cn.Open();
            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    var t = new Dictionary<string, object>();
                    for (int i = 0; i < Columnas.Length; i++) t[Columnas[i]] = Valor(rd.GetValue(i));
                    filas.Add(t);
                }
            }
        }
        return filas;
    }

    // Todo sale como texto: el libro no debe reinterpretar codigos ni fechas.
    // Las fechas llevan hora (DATETIME2(0) en dbo.Tickets), como en el export
    // de Experiencia.
    private static string Valor(object v)
    {
        if (v == null || v is DBNull) return null;
        if (v is DateTime)
            return ((DateTime)v).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        var s = Convert.ToString(v, CultureInfo.InvariantCulture);
        return string.IsNullOrEmpty(s) ? null : s;
    }
}
