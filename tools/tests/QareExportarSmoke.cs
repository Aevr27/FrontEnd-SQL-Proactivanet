// tools/tests/QareExportarSmoke.cs - prueba de humo del export "⬇ Descargar QARE"
// (handlers/qare_exportar.ashx -> App_Code/QareExportar.cs).
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Que prueba:
//   A) Las consultas, sin base: el detalle sale de dbo.usp_CorreoQARE_Detalle,
//      el filtro de dbo.tvf_CorreoQARE_Base con los cinco parametros, no se
//      repite el mapeo Grupo -> Lider ni el C1, ya no se lee dbo.vw_Tickets,
//      todo es solo lectura, y las 51 columnas son las pedidas.
//   A2) QareExportar.Unir, sin base: interseccion exacta por CodigoTicket
//      (lo que solo trae el SP se cae, lo que solo trae la TVF no se
//      inventa), un ticket repetido sale una vez, orden del SP.
//   B) El handler de punta a punta contra SQL Server LocalDB, en una base
//      TEMPORAL, con los objetos REALES: la TVF y usp_CorreoQARE_KPIs se leen
//      de sql/16_qare_filtros_org.sql (las cadenas @ddl_tvf y
//      @ddl_usp_CorreoQARE_KPIs) y usp_CorreoQARE_Detalle es el cuerpo que
//      devolvio la VM (sql/diag_qare_detalle_poblacion.sql, 2026-09-29),
//      copiado tal cual en DETALLE_VM. Todo sobre una replica de la vista y
//      de las funciones del Backlog. Para cada filtro (ninguno, Lider, 'Sin
//      Torre', Grupo, C1, cruce, lista, valor inexistente, rango de un dia,
//      default sin fechas) los tickets del export son EXACTAMENTE los que
//      cuenta el KPI del tablero, sin CodigoTicket repetido, con C1/Lider de
//      la TVF, las respuestas crudas y las banderas 0/1 del SP como numero.
//   C) Contrato de la respuesta, 400/405 y que un filtro con comillas no
//      entra como SQL.
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (Git Bash, ver memoria csc):
//   tail -n +2 handlers/qare_exportar.ashx > <scratch>/qare_exportar_handler.cs
//   csc /nologo /out:<scratch>/QareExportarSmoke.exe /r:System.dll /r:System.Data.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll
//       'App_Code\*.cs' <scratch>/qare_exportar_handler.cs tools\tests\QareExportarSmoke.cs
//   QareExportarSmoke.exe.config junto al exe, con:
//     <connectionStrings><add name="TicketsProactivanet" connectionString=
//       "Server=(localdb)\MSSQLLocalDB;Initial Catalog=QareExportarSmoke;Integrated Security=true"/>
//   QareExportarSmoke.exe <raiz del repo>     # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.IO;
using System.Text;
using System.Web;
using System.Web.Script.Serialization;

public static class QareExportarSmoke
{
    static int fallos;
    static string cadena;

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : esperado.ToString();
        var o = obtenido == null ? "(null)" : obtenido.ToString();
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + "  esperado=" + e + "  obtenido=" + o);
    }

    static readonly string[] BANDERAS =
    {
        "EsRecurrente", "UsuarioConfirmo", "EsCasoReutilizable", "EsPotencialKB",
        "EsInconsistenciaConfirmacionQA", "EsOportunidadKB",
    };

    // --------------------------------------------------------- A) consultas
    static void Consulta(string raiz)
    {
        var sql = QareExportar.CONSULTA_FILTRO;
        Chk("detalle: el SP canonico", "dbo.usp_CorreoQARE_Detalle", QareExportar.SP_DETALLE);
        Chk("filtro: la TVF de los seis SP con sus cinco parametros", true,
            sql.Contains("FROM dbo.tvf_CorreoQARE_Base(@FechaInicio, @FechaFin, @C1, @Grupos, @Lideres) AS q"));
        Chk("filtro: trae CodigoTicket, C1, Lider y la respuesta cruda", true,
            sql.StartsWith("SELECT q.CodigoTicket, q.C1, q.Lider, q.QARe_VerificoClasificacion ", StringComparison.Ordinal));
        Chk("no lee la vista QARE por su cuenta", false, sql.Contains("vw_CorreoQARECierre_Base"));
        Chk("no repite el mapeo Grupo -> Lider ni el C1", false,
            sql.Contains("CatLiderGrupo") || sql.Contains("fn_CorreoBacklog") || sql.Contains("Sin Torre"));
        var fuente = File.ReadAllText(Path.Combine(raiz, @"App_Code\QareExportar.cs"));
        Chk("ya no usa vw_Tickets", false, fuente.Contains("vw_Tickets"));
        Chk("no repite el mapeo en C# (ni CatLiderGrupo ni 'Sin Torre')", false,
            fuente.Contains("CatLiderGrupo") || fuente.Contains("\"Sin Torre\"") || fuente.Contains("\"Sin categoria\""));
        var mayus = sql.ToUpperInvariant();
        Chk("solo lectura", false, mayus.Contains("INSERT") || mayus.Contains("UPDATE ") ||
            mayus.Contains("DELETE") || mayus.Contains("EXEC") || mayus.Contains("INTO "));
        Chk("sin TOP", false, mayus.Contains("TOP"));

        var c = QareExportar.Columnas;
        Chk("51 columnas", 51, c.Length);
        Chk("sin FechaInicio/FechaFin por fila", "-1|-1",
            Array.IndexOf(c, "FechaInicio") + "|" + Array.IndexOf(c, "FechaFin"));
        Chk("columnas sin repetir", c.Length, new HashSet<string>(c).Count);
        Chk("C1/Lider/QARe_VerificoClasificacion son las de la TVF", "C1,Lider,QARe_VerificoClasificacion",
            string.Join(",", QareExportar.ColumnasTvf));
        foreach (var k in new[] { "QARe_VerificoClasificacion", "QARe_UsuarioConfirmo", "UsuarioConfirmo" })
            Chk("columna presente: " + k, true, Array.IndexOf(c, k) >= 0);
        Chk("banderas del SP, todas en el libro", true,
            Array.TrueForAll(QareExportar.Banderas, b => Array.IndexOf(c, b) >= 0));
    }

    // ------------------------------------------------ A2) interseccion pura
    static Dictionary<string, object> FilaSp(string codigo, string tecnico)
    {
        var f = new Dictionary<string, object>();
        foreach (var k in QareExportar.Columnas)
            if (Array.IndexOf(QareExportar.ColumnasTvf, k) < 0) f[k] = null;
        f["CodigoTicket"] = codigo;
        f["Tecnico"] = tecnico;
        f["EsRecurrente"] = 1;
        return f;
    }

    static void Interseccion()
    {
        var sp = new List<Dictionary<string, object>>
        {
            FilaSp("B", "t1"), FilaSp("SOLO-SP", "t2"), FilaSp("A", "t3"), FilaSp("B", "t4"),
        };
        var tvf = new Dictionary<string, object[]>
        {
            { "A", new object[] { "S-A", "Jesus Campa", "Sí" } },
            { "B", new object[] { "S-B", "Sin Torre", "NO" } },
            { "SOLO-TVF", new object[] { "S-C", "Laura", "SI" } },
        };
        var r = QareExportar.Unir(sp, tvf);
        var cods = new List<string>();
        foreach (var t in r) cods.Add((string)t["CodigoTicket"]);
        Chk("Unir: interseccion exacta, en el orden del SP", "B,A", string.Join(",", cods));
        Chk("Unir: el repetido sale una vez (la primera)", "t1", r[0]["Tecnico"]);
        Chk("Unir: C1/Lider/cruda de la TVF", "S-B|Sin Torre|NO",
            r[0]["C1"] + "|" + r[0]["Lider"] + "|" + r[0]["QARe_VerificoClasificacion"]);
        Chk("Unir: llaves = Columnas, en orden", string.Join(",", QareExportar.Columnas), string.Join(",", r[0].Keys));
        Chk("Unir: el resto sale del SP tal cual", 1, r[1]["EsRecurrente"]);
        Chk("Unir: TVF vacia = nada", 0, QareExportar.Unir(sp, new Dictionary<string, object[]>()).Count);
    }

    // ------------------------------------------------------- B) replica
    /* Vista QARE con las 49 columnas que lee el SP (nombres de su
       dependencia en la VM) y lo del Backlog con los cuerpos que leyo
       sql/diag_qare_filtros_precheck.sql en la VM. Grupos: Service Desk ->
       Jesus Campa, Soporte Campo -> Laura Cardenas, Grupo Nuevo sin fila en
       CatLiderGrupo (-> 'Sin Torre'). */
    const string Base = @"
CREATE TABLE dbo.T (CodigoTicket nvarchar(100) NOT NULL, FechaRegistro datetime2(0) NULL, Tipo nvarchar(100) NULL,
    TipoRelacion nvarchar(255) NULL, Estado nvarchar(100) NULL, Subestado nvarchar(100) NULL, Prioridad nvarchar(100) NULL,
    Categoria nvarchar(500) NULL, Grupo nvarchar(255) NOT NULL, GrupoCorrecto nvarchar(255) NULL, Validacion nvarchar(12) NOT NULL,
    Tecnico nvarchar(255) NULL, Cliente nvarchar(255) NULL, Sucursal nvarchar(255) NULL, Tienda nvarchar(500) NULL,
    Titulo nvarchar(4000) NULL, Descripcion nvarchar(max) NULL, SolucionUsuario nvarchar(max) NULL,
    FechaEstimadaResolucion datetime2(0) NULL, FechaFirmaSolucion datetime2(0) NULL, FechaUltimaModificacion datetime2(0) NULL,
    FechaFirmaCierre datetime2(0) NULL, FirmaCierreRevocacion nvarchar(255) NULL, FirmaSolucion nvarchar(255) NULL,
    ResponsableUltimaModificacion nvarchar(255) NULL, NotificadoPor nvarchar(500) NULL, FechaEstimadaOlaUc datetime2(0) NULL,
    IntentosSolucion int NULL, ReasignacionesGrupo int NULL, Caducada bit NULL, RegistradoPor nvarchar(255) NULL,
    QA_MensajeError nvarchar(max) NULL, QA_Frecuencia nvarchar(500) NULL, QA_Aplicacion nvarchar(500) NULL,
    QA_PasoAPaso nvarchar(max) NULL, QARe_Causa nvarchar(max) NULL, QARe_UsuarioConfirmo nvarchar(255) NULL,
    QARe_AplicaOtrosCasos nvarchar(255) NULL, QARe_GenerarArticulo nvarchar(255) NULL,
    QARe_VerificoClasificacion nvarchar(255) NULL, QARe_Evidencia nvarchar(max) NULL,
    QARe_DescripcionSolucion nvarchar(max) NULL, QARe_TipoSolucion nvarchar(255) NULL);
GO
CREATE VIEW dbo.vw_CorreoQARECierre_Base AS SELECT * FROM dbo.T;
GO
CREATE TABLE dbo.CatLiderGrupo (Grupo nvarchar(200) NOT NULL PRIMARY KEY, Lider nvarchar(200) NULL);
INSERT dbo.CatLiderGrupo VALUES (N'Service Desk', N'Jesus Campa'), (N'Soporte Campo', N'Laura Cardenas');
GO
CREATE FUNCTION dbo.fn_CorreoBacklog_CategoriaC1 (@Categoria NVARCHAR(1000))
RETURNS NVARCHAR(255)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(1000) = LTRIM(RTRIM(REPLACE(ISNULL(@Categoria, N''), NCHAR(160), N' ')));
    DECLARE @inicio INT, @siguiente INT;
    IF @s = N'' RETURN NULL;
    SET @inicio = CASE WHEN LEFT(@s, 1) = N'/' THEN 2 ELSE 1 END;
    SET @siguiente = CHARINDEX(N'/', @s, @inicio);
    IF @siguiente = 0 RETURN NULLIF(LTRIM(RTRIM(SUBSTRING(@s, @inicio, 1000))), N'');
    RETURN NULLIF(LTRIM(RTRIM(SUBSTRING(@s, @inicio, @siguiente - @inicio))), N'');
END;
GO
CREATE FUNCTION dbo.fn_CorreoBacklog_SplitList (@Lista NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN
(
    SELECT Valor = LTRIM(RTRIM(value))
    FROM STRING_SPLIT(ISNULL(@Lista, N''), N',')
    WHERE LTRIM(RTRIM(value)) <> N''
);";

    /* Cuerpo de dbo.usp_CorreoQARE_Detalle tal como lo devolvio la VM
       (sp_helptext, 2026-09-29). No se toca: si el SP cambia en la VM, se
       vuelve a copiar de ahi. */
    const string DETALLE_VM = @"CREATE   PROCEDURE [dbo].[usp_CorreoQARE_Detalle]
    @FechaInicio DATE = NULL,  -- Por defecto: fecha final menos 14 dias
    @FechaFin    DATE = NULL   -- Por defecto: fecha actual
AS
BEGIN
    SET NOCOUNT ON;

    /*
        Tablero:
        Calidad de cierre QARE

        Dataset:
        Detalle de tickets QARE

        Objetivo:
        Proporcionar el detalle de los tickets utilizados
        en los KPIs y graficas del tablero.

        Granularidad:
        Una fila por ticket.

        Fuente:
        dbo.vw_CorreoQARECierre_Base

        Fecha oficial:
        FechaFirmaSolucion

        Ventana predeterminada:
        Ultimos 15 dias naturales, incluyendo la fecha final.
    */

    DECLARE @Ff DATE =
        ISNULL(@FechaFin, CONVERT(DATE, DATEADD(HOUR, -6, SYSUTCDATETIME())));

    DECLARE @Fi DATE =
        ISNULL(@FechaInicio, DATEADD(DAY, -14, @Ff));

    SELECT DISTINCT
        FechaInicio = @Fi,
        FechaFin = @Ff,

        CodigoTicket,
        FechaRegistro,

        Tipo,
        TipoRelacion,
        Estado,
        Subestado,
        Prioridad,

        Categoria,
        Grupo,
        GrupoCorrecto,
        Validacion,

        Tecnico,
        Cliente,
        Sucursal,
        Tienda,
        Titulo,
        Descripcion,
        SolucionUsuario,
        FechaEstimadaResolucion,
        FechaFirmaSolucion,
        FechaUltimaModificacion,
        FechaFirmaCierre,
        FirmaCierreRevocacion,
        FirmaSolucion,
        ResponsableUltimaModificacion,
        NotificadoPor,
        FechaEstimadaOlaUc,
        IntentosSolucion,
        ReasignacionesGrupo,
        Caducada,
        RegistradoPor,

        QA_MensajeError,
        QA_Frecuencia,
        QA_Aplicacion,
        QA_PasoAPaso,

        QARe_Causa,
        QARe_UsuarioConfirmo,
        QARe_AplicaOtrosCasos,
        QARe_GenerarArticulo,
        --QARe_VerificoClasificacion,
        QARe_Evidencia,
        QARe_DescripcionSolucion,
        QARe_TipoSolucion,

        /* =====================================================
           Banderas para identificar a qué KPI pertenece el ticket
           ===================================================== */

        EsRecurrente =
            CASE
                WHEN UPPER(LTRIM(RTRIM(QA_Frecuencia)))
                     IN (N'FRECUENTE', N'SIEMPRE')
                THEN 1
                ELSE 0
            END,

        UsuarioConfirmo =
            CASE
                WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion)))
                     IN (N'SI', N'SÍ')
                THEN 1
                ELSE 0
            END,

        EsCasoReutilizable =
            CASE
                WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos)))
                     IN (N'SI', N'SÍ')
                THEN 1
                ELSE 0
            END,

        EsPotencialKB =
            CASE
                WHEN UPPER(LTRIM(RTRIM(QARe_GenerarArticulo)))
                     IN (N'SI', N'SÍ')
                THEN 1
                ELSE 0
            END,

        /* Confirmó con el usuario, pero el ticket está mal clasificado */
        EsInconsistenciaConfirmacionQA =
            CASE
                WHEN UPPER(LTRIM(RTRIM(QARe_VerificoClasificacion)))
                     IN (N'SI', N'SÍ')
                 AND LTRIM(RTRIM(Validacion)) = N'Incorrecto'
                THEN 1
                ELSE 0
            END,

        /* Aplica a otros casos y se indicó generar artículo */
        EsOportunidadKB =
            CASE
                WHEN UPPER(LTRIM(RTRIM(QARe_AplicaOtrosCasos)))
                     IN (N'SI', N'SÍ')
                 AND UPPER(LTRIM(RTRIM(QARe_GenerarArticulo)))
                     IN (N'SI', N'SÍ')
                THEN 1
                ELSE 0
            END

    FROM dbo.vw_CorreoQARECierre_Base

    WHERE FechaFirmaSolucion >= @Fi
      AND FechaFirmaSolucion < DATEADD(DAY, 1, @Ff)

    ORDER BY
        FechaFirmaSolucion DESC,
        CodigoTicket ASC;
END;";

    /* Dia de prueba 2026-08-10 con sus bordes (00:00, 12:00, 23:59:59), uno
       en el dia siguiente y otro en el anterior; X-0 sin categoria; S-3 dos
       veces en la vista con un Tecnico distinto (el SELECT DISTINCT del SP no
       las junta: prueba la red contra repetidos) y una Descripcion de 40.000
       caracteres; H-* alrededor de HOY en Mexico para el default sin fechas.
       QARe_UsuarioConfirmo va a proposito DISTINTO de
       QARe_VerificoClasificacion, para que no se puedan confundir. */
    const string Datos = @"
INSERT dbo.T (CodigoTicket, FechaFirmaSolucion, Categoria, Grupo, QA_Frecuencia, QARe_Causa, QARe_VerificoClasificacion,
              QARe_UsuarioConfirmo, QARe_AplicaOtrosCasos, QARe_GenerarArticulo, QARe_TipoSolucion, Validacion,
              Tecnico, Titulo, Descripcion, Estado, FechaRegistro, IntentosSolucion, ReasignacionesGrupo, Caducada) VALUES
 (N'D-00', '2026-08-10T00:00:00', N'/S-A/x', N'Service Desk',  N'Siempre',     N'Necesidad', N'SI', N'No', N'SI', N'No', N'Permisos', N'OK',           N'Tec', N'Titulo D-00', N'Desc D-00', N'Cerrado', '2026-08-01T09:15:00', 1, 0, 0),
 (N'D-12', '2026-08-10T12:00:00', N'/S-A/x', N'Service Desk',  N'Siempre',     N'Necesidad', N'Sí', N'No', N'No', N'Sí', N'Permisos', N'Incorrecto',   N'Tec', N'Titulo D-12', N'Desc D-12', N'Cerrado', '2026-08-02T09:15:00', 2, 1, 1),
 (N'D-23', '2026-08-10T23:59:59', N'/S-B/y', N'Soporte Campo', N'Primera vez', N'Falla',     N'NO', N'Sí', N'SI', NULL,  N'Reinicio',  N'Incorrecto',   N'Tec', NULL,           NULL,        N'Cerrado', NULL,                  NULL, NULL, NULL),
 (N'D+1',  '2026-08-11T00:00:00', N'/S-B/y', N'Soporte Campo', N'Ocasional',   N'Falla',     N'SI', NULL,  N'SI', N'SI', N'Reinicio',  N'Valido',       N'Tec', NULL,           NULL,        N'Cerrado', NULL,                  NULL, NULL, NULL),
 (N'D-1',  '2026-08-09T23:59:59', N'/S-C/z', N'Grupo Nuevo',   N'Frecuente',   N'Falla',     N'NO', NULL,  NULL,  NULL,  N'Reinicio',  N'Sin catalogo', N'Tec', NULL,           NULL,        N'Cerrado', NULL,                  NULL, NULL, NULL),
 (N'S-2',  '2026-08-09T10:00:00', N'/S-C/z', N'Grupo Nuevo',   N'Siempre',     N'Falla',     N'SI', NULL,  NULL,  NULL,  NULL,         N'Sin catalogo', N'Tec', NULL,           NULL,        N'Cerrado', NULL,                  NULL, NULL, NULL),
 (N'S-3',  '2026-08-11T10:00:00', N'/S-C/z', N'Service Desk',  N'Siempre',     NULL,         N'Si', NULL,  NULL,  NULL,  NULL,         N'Valido',       N'Tec A', NULL,         REPLICATE(CAST(N'x' AS nvarchar(max)), 40000), N'Cerrado', NULL, NULL, NULL, NULL),
 (N'S-3',  '2026-08-11T10:00:00', N'/S-C/z', N'Service Desk',  N'Siempre',     NULL,         N'Si', NULL,  NULL,  NULL,  NULL,         N'Valido',       N'Tec B', NULL,         REPLICATE(CAST(N'x' AS nvarchar(max)), 40000), N'Cerrado', NULL, NULL, NULL, NULL),
 (N'X-0',  '2026-08-11T11:00:00', NULL,      N'Service Desk',  N'Ocasional',   NULL,         N'NO', NULL,  NULL,  NULL,  NULL,         N'OK',           N'Tec', NULL,           NULL,        N'Cerrado', NULL,                  NULL, NULL, NULL);
DECLARE @HoyMx date = CONVERT(date, DATEADD(HOUR, -6, SYSUTCDATETIME()));
INSERT dbo.T (CodigoTicket, FechaFirmaSolucion, Grupo, QA_Frecuencia, QARe_VerificoClasificacion, Validacion) VALUES
 (N'H-0',  DATEADD(MINUTE, 1, CAST(@HoyMx AS datetime2(0))),                     N'Service Desk', N'Siempre', N'SI', N'OK'),
 (N'H-14', CAST(DATEADD(DAY, -14, @HoyMx) AS datetime2(0)),                      N'Service Desk', N'Siempre', N'SI', N'OK'),
 (N'H-15', DATEADD(SECOND, -1, CAST(DATEADD(DAY, -14, @HoyMx) AS datetime2(0))), N'Service Desk', N'Siempre', N'SI', N'OK'),
 (N'H+1',  CAST(DATEADD(DAY, 1, @HoyMx) AS datetime2(0)),                        N'Service Desk', N'Siempre', N'SI', N'OK');";

    /* Una cadena N'...' de T-SQL del script, sin comillas y con '' -> '.
       Se recorre a mano: el cuerpo trae '' por todos lados. */
    static string Cadena(string script, string variable)
    {
        var marca = "DECLARE " + variable + " nvarchar(max) = N'";
        int i = script.IndexOf(marca, StringComparison.Ordinal);
        if (i < 0) throw new Exception("No esta " + variable + " en sql/16_qare_filtros_org.sql");
        i += marca.Length;
        var sb = new StringBuilder();
        while (true)
        {
            char c = script[i];
            if (c == '\'')
            {
                if (i + 1 < script.Length && script[i + 1] == '\'') { sb.Append('\''); i += 2; continue; }
                return sb.ToString();
            }
            sb.Append(c);
            i++;
        }
    }

    static void Preparar(string raiz)
    {
        var script = File.ReadAllText(Path.Combine(raiz, @"sql\16_qare_filtros_org.sql"));
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            foreach (var lote in Base.Split(new[] { "\nGO" }, StringSplitOptions.RemoveEmptyEntries))
                new SqlCommand(lote, cn).ExecuteNonQuery();
            new SqlCommand(Datos, cn).ExecuteNonQuery();
            new SqlCommand(Cadena(script, "@ddl_tvf"), cn).ExecuteNonQuery();
            new SqlCommand(Cadena(script, "@ddl_usp_CorreoQARE_KPIs"), cn).ExecuteNonQuery();
            new SqlCommand(DETALLE_VM, cn).ExecuteNonQuery();
        }
    }

    static Dictionary<string, object> Pedir(string query, out int estado, string metodo = "GET")
    {
        var sw = new StringWriter();
        var req = new HttpRequest("", "http://localhost/handlers/qare_exportar.ashx", query);
        if (metodo != "GET")
            typeof(HttpRequest).GetField("_httpMethod", System.Reflection.BindingFlags.NonPublic |
                System.Reflection.BindingFlags.Instance).SetValue(req, metodo);
        var ctx = new HttpContext(req, new HttpResponse(sw));
        new QareExportarHandler().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        return (Dictionary<string, object>)new JavaScriptSerializer { MaxJsonLength = int.MaxValue }
            .DeserializeObject(sw.ToString());
    }

    static List<Dictionary<string, object>> Tickets(Dictionary<string, object> d)
    {
        var salida = new List<Dictionary<string, object>>();
        var arr = d["tickets"] as object[];
        if (arr != null) foreach (var x in arr) salida.Add((Dictionary<string, object>)x);
        return salida;
    }

    static string Codigos(List<Dictionary<string, object>> t)
    {
        var c = new List<string>();
        foreach (var f in t) c.Add((string)f["CodigoTicket"]);
        c.Sort(StringComparer.Ordinal);
        return string.Join(",", c);
    }

    static Dictionary<string, Dictionary<string, object>> PorCodigo(List<Dictionary<string, object>> t)
    {
        var m = new Dictionary<string, Dictionary<string, object>>();
        foreach (var f in t) m[(string)f["CodigoTicket"]] = f;
        return m;
    }

    static string Nulo(string v) { return v == null ? "NULL" : "N'" + v.Replace("'", "''") + "'"; }

    // TotalTicketsPeriodo del SP REAL con los mismos argumentos.
    static int Kpi(string fi, string ff, string c1, string grupos, string lideres)
    {
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("EXEC dbo.usp_CorreoQARE_KPIs @FechaInicio = " + Nulo(fi) +
            ", @FechaFin = " + Nulo(ff) + ", @C1 = " + Nulo(c1) + ", @Grupos = " + Nulo(grupos) +
            ", @Lideres = " + Nulo(lideres) + ";", cn))
        {
            cn.Open();
            using (var rd = cmd.ExecuteReader()) { rd.Read(); return rd.GetInt32(0); }
        }
    }

    // CodigoTicket -> "C1|Lider" leidos directo de la TVF, con los mismos argumentos.
    static Dictionary<string, string> Tvf(string fi, string ff, string c1, string grupos, string lideres)
    {
        var m = new Dictionary<string, string>();
        using (var cn = new SqlConnection(cadena))
        using (var cmd = new SqlCommand("SELECT CodigoTicket, C1, Lider FROM dbo.tvf_CorreoQARE_Base(" + Nulo(fi) +
            ", " + Nulo(ff) + ", " + Nulo(c1) + ", " + Nulo(grupos) + ", " + Nulo(lideres) + ");", cn))
        {
            cn.Open();
            using (var rd = cmd.ExecuteReader())
                while (rd.Read()) m[rd.GetString(0)] = rd.GetString(1) + "|" + rd.GetString(2);
        }
        return m;
    }

    /* Un caso de filtros: el export = los codigos esperados, sin repetidos,
       total coherente, MISMO numero de tickets que el KPI del tablero y C1 /
       Lider de cada ticket = los de la TVF. */
    static void Caso(string nombre, string fi, string ff, string c1, string grupos, string lideres, string esperados)
    {
        var qs = new List<string>();
        if (fi != null) qs.Add("fecha_inicio=" + fi);
        if (ff != null) qs.Add("fecha_fin=" + ff);
        if (c1 != null) qs.Add("c1=" + HttpUtility.UrlEncode(c1));
        if (grupos != null) qs.Add("grupos=" + HttpUtility.UrlEncode(grupos));
        if (lideres != null) qs.Add("lideres=" + HttpUtility.UrlEncode(lideres));
        int estado;
        var d = Pedir(string.Join("&", qs), out estado);
        var t = Tickets(d);
        Chk(nombre + ": 200", 200, estado);
        Chk(nombre + ": tickets", esperados, Codigos(t));
        Chk(nombre + ": sin CodigoTicket repetido", t.Count, PorCodigo(t).Count);
        Chk(nombre + ": total = filas", t.Count.ToString(), d["total"].ToString());
        Chk(nombre + ": = KPI TotalTicketsPeriodo del SP real", Kpi(fi, ff, c1, grupos, lideres), t.Count);
        if (fi != null && ff != null)
        {
            var tvf = Tvf(fi, ff, c1, grupos, lideres);
            bool iguales = tvf.Count == t.Count;
            foreach (var f in t)
            {
                string esperado;
                iguales &= tvf.TryGetValue((string)f["CodigoTicket"], out esperado) && esperado == f["C1"] + "|" + f["Lider"];
            }
            Chk(nombre + ": tickets y C1/Lider = los de la TVF", true, iguales);
        }
    }

    static void Integracion()
    {
        const string fi = "2026-08-09", ff = "2026-08-11";

        Caso("sin filtros", fi, ff, null, null, null, "D+1,D-00,D-1,D-12,D-23,S-2,S-3,X-0");
        Caso("filtros vacios = sin filtro", fi, ff, "", " ", "", "D+1,D-00,D-1,D-12,D-23,S-2,S-3,X-0");
        Caso("lider", fi, ff, null, null, "Jesus Campa", "D-00,D-12,S-3,X-0");
        Caso("lider 'Sin Torre' (grupo sin fila en CatLiderGrupo)", fi, ff, null, null, "Sin Torre", "D-1,S-2");
        Caso("grupo", fi, ff, null, "Soporte Campo", null, "D+1,D-23");
        Caso("C1 = fn_CorreoBacklog_CategoriaC1", fi, ff, "S-A", null, null, "D-00,D-12");
        Caso("C1 'Sin categoria'", fi, ff, "Sin categoria", null, null, "X-0");
        Caso("C1 + lider = cruce", fi, ff, "S-C", null, "Jesus Campa", "S-3");
        Caso("grupo + lider incompatibles = vacio", fi, ff, null, "Soporte Campo", "Jesus Campa", "");
        Caso("lista de dos lideres = la suma", fi, ff, null, null, "Jesus Campa, Laura Cardenas",
             "D+1,D-00,D-12,D-23,S-3,X-0");
        Caso("lider inexistente", fi, ff, null, null, "Nadie", "");
        Caso("un dia: el fin entra entero", "2026-08-10", "2026-08-10", null, null, null, "D-00,D-12,D-23");
        Caso("un dia + lider", "2026-08-10", "2026-08-10", null, null, "Jesus Campa", "D-00,D-12");

        // Default sin fechas: los 15 dias hasta hoy (Mexico), como el SP con NULL/NULL.
        int estado;
        var d = Pedir("", out estado);
        var hoy = DashboardDataInfo.HoyEnPresentacion();
        Chk("default: fechas", hoy.AddDays(-14).ToString("yyyy-MM-dd") + "|" + hoy.ToString("yyyy-MM-dd"),
            d["fechaInicio"] + "|" + d["fechaFin"]);
        Chk("default: tickets (hoy y hoy-14 dentro; hoy-15 y mañana fuera)", "H-0,H-14", Codigos(Tickets(d)));
        Chk("default: = SP con NULL/NULL", Kpi(null, null, null, null, null), Tickets(d).Count);

        // --- contrato de un ticket
        d = Pedir("fecha_inicio=2026-08-10&fecha_fin=2026-08-10&lideres=Jesus%20Campa", out estado);
        var t = Tickets(d);
        Chk("respuesta: llaves", "fechaInicio,fechaFin,total,tickets", string.Join(",", d.Keys));
        Chk("respuesta: rango confirmado", "2026-08-10|2026-08-10", d["fechaInicio"] + "|" + d["fechaFin"]);
        Chk("ticket: llaves = QareExportar.Columnas, en orden", string.Join(",", QareExportar.Columnas),
            string.Join(",", t[0].Keys));
        Chk("orden del SP: FechaFirmaSolucion DESC", "D-12,D-00", t[0]["CodigoTicket"] + "," + t[1]["CodigoTicket"]);
        var a = t[0];
        Chk("ticket: fecha con hora", "2026-08-10 12:00:00", a["FechaFirmaSolucion"]);
        Chk("ticket: Lider / C1 / Grupo", "Jesus Campa|S-A|Service Desk", a["Lider"] + "|" + a["C1"] + "|" + a["Grupo"]);
        Chk("ticket: respuestas QA/QARE tal cual", "Siempre|Necesidad|No|Sí|Permisos|Incorrecto",
            a["QA_Frecuencia"] + "|" + a["QARe_Causa"] + "|" + a["QARe_AplicaOtrosCasos"] + "|" +
            a["QARe_GenerarArticulo"] + "|" + a["QARe_TipoSolucion"] + "|" + a["Validacion"]);
        Chk("ticket: QARe_VerificoClasificacion cruda (de la TVF)", "Sí", a["QARe_VerificoClasificacion"]);
        Chk("ticket: QARe_UsuarioConfirmo es OTRA pregunta, tal cual", "No", a["QARe_UsuarioConfirmo"]);
        Chk("ticket: datos descriptivos del SP", "Titulo D-12|Desc D-12|Tec|Cerrado|2026-08-02 09:15:00",
            a["Titulo"] + "|" + a["Descripcion"] + "|" + a["Tecnico"] + "|" + a["Estado"] + "|" + a["FechaRegistro"]);
        Chk("ticket: categoria cruda de la vista", "/S-A/x", a["Categoria"]);
        Chk("ticket: enteros del SP como numero", "Int32:2|Int32:1|Int32:1",
            Tipo(a["IntentosSolucion"]) + "|" + Tipo(a["ReasignacionesGrupo"]) + "|" + Tipo(a["Caducada"]));

        // --- banderas 0/1 del SP: numero, y UsuarioConfirmo sale de VerificoClasificacion
        d = Pedir(rangoQs(fi, ff), out estado);
        var m = PorCodigo(Tickets(d));
        // EsRecurrente, UsuarioConfirmo, EsCasoReutilizable, EsPotencialKB, EsInconsistencia, EsOportunidadKB
        Banderas(m, "D-00", "1,1,1,0,0,0");
        Banderas(m, "D-12", "1,1,0,1,1,0");   // VerificoClasificacion Sí + Incorrecto -> inconsistencia
        Banderas(m, "D-23", "0,0,1,0,0,0");   // QARe_UsuarioConfirmo = Sí pero VerificoClasificacion NO -> 0
        Banderas(m, "D+1",  "0,1,1,1,0,1");   // aplica + generar -> oportunidad KB
        Banderas(m, "D-1",  "1,0,0,0,0,0");
        bool todasNumero = true;
        foreach (var f in m.Values)
            foreach (var b in BANDERAS)
                todasNumero &= f[b] is int && ((int)f[b] == 0 || (int)f[b] == 1);
        Chk("banderas: todas numero 0/1 en todos los tickets", true, todasNumero);
        Chk("S-3 (dos filas distintas en la vista): una sola fila", 1,
            Tickets(d).FindAll(x => (string)x["CodigoTicket"] == "S-3").Count);
        Chk("texto largo llega entero (el recorte es del libro)", 40000, ((string)m["S-3"]["Descripcion"]).Length);

        // --- errores
        d = Pedir("fecha_inicio=2026-09-10&fecha_fin=2026-09-01", out estado);
        Chk("rango invertido: 400", "400|SolicitudInvalida", estado + "|" + d["tipo"]);
        d = Pedir("fecha_inicio=01/09/2026", out estado);
        Chk("fecha mal formada: 400", 400, estado);
        d = Pedir("", out estado, "POST");
        Chk("POST: 405", "405|MetodoNoPermitido", estado + "|" + d["tipo"]);

        // --- un filtro con comillas viaja como valor, no como SQL
        d = Pedir(rangoQs(fi, ff) + "&c1=" + HttpUtility.UrlEncode("S-A'); DROP TABLE dbo.T;--"), out estado);
        Chk("inyeccion: 200 y ningun ticket", "200|0", estado + "|" + Tickets(d).Count);
        d = Pedir(rangoQs(fi, ff), out estado);
        Chk("inyeccion: la tabla sigue ahi", 8, Tickets(d).Count);
    }

    static string Tipo(object v) { return v == null ? "null" : v.GetType().Name + ":" + v; }

    static void Banderas(Dictionary<string, Dictionary<string, object>> m, string codigo, string esperado)
    {
        var v = new List<string>();
        foreach (var b in BANDERAS) v.Add(Convert.ToString(m[codigo][b]));
        Chk("banderas " + codigo, esperado, string.Join(",", v));
    }

    static string rangoQs(string fi, string ff) { return "fecha_inicio=" + fi + "&fecha_fin=" + ff; }

    public static int Main(string[] args)
    {
        var raiz = args.Length > 0 ? args[0] : Directory.GetCurrentDirectory();
        const string maestra = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true";

        if (ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion] == null)
        {
            Console.WriteLine("Falta " + AppDomain.CurrentDomain.SetupInformation.ConfigurationFile +
                              " con la cadena TicketsProactivanet; ver cabecera.");
            return 99;
        }

        Consulta(raiz);
        Interseccion();

        cadena = ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion].ConnectionString;
        var bd = new SqlConnectionStringBuilder(cadena).InitialCatalog;
        using (var cn = new SqlConnection(maestra))
        {
            cn.Open();
            new SqlCommand("IF DB_ID('" + bd + "') IS NOT NULL BEGIN ALTER DATABASE [" + bd +
                           "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "]; END; CREATE DATABASE [" + bd + "];", cn).ExecuteNonQuery();
        }
        try
        {
            Preparar(raiz);
            Integracion();
        }
        finally
        {
            SqlConnection.ClearAllPools();
            using (var cn = new SqlConnection(maestra))
            {
                cn.Open();
                new SqlCommand("ALTER DATABASE [" + bd + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "];", cn).ExecuteNonQuery();
            }
        }

        Console.WriteLine(fallos == 0 ? "TODO OK" : (fallos + " FALLOS"));
        return fallos;
    }
}
