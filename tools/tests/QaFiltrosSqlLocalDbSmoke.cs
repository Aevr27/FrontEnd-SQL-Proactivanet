// tools/tests/QaFiltrosSqlLocalDbSmoke.cs - prueba de humo de los filtros
// Servicio (C1) / Grupos / Lideres de la pestana QA (handlers/qa.ashx ->
// App_Code/QaFiltroOrg.cs, QaCorreo.cs, QaDb.cs).
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Que prueba:
//   A) La regla C1, sin handler: QaFiltroOrg.C1De (C#) y QaFiltroOrg.C1Sql
//      (T-SQL de los KPIs) contra dbo.fn_CorreoBacklog_CategoriaC1 con el
//      cuerpo que leyo la VM (el mismo que replica QareExportarSmoke.cs), en
//      entradas raras: NULL, vacio, '/', espacio duro, sin '/' inicial...
//      Y QaFiltroOrg.Partir contra dbo.fn_CorreoBacklog_SplitList.
//   B) qa.ashx de punta a punta contra SQL Server LocalDB, en una base
//      TEMPORAL: dbo.vw_CorreoQA_Base con sus 50 columnas reales, un
//      dbo.CatLiderGrupo de prueba y dbo.usp_CorreoQA_Detalle con el cuerpo
//      versionado en sql/fix_qa_detalle_option_recompile.sql. La VERDAD de
//      cada caso es una TVF de prueba con el WHERE de dbo.tvf_CorreoQARE_Base
//      (sql/16_qare_filtros_org.sql) sobre la vista de QA. Para cada filtro
//      (ninguno, C1, mayusculas, 'Sin categoria', espacio duro, lista,
//      Grupo con espacio al final, 'Sin Torre', comillas, cruces, valor
//      inexistente) se compara: KPIs (total, incorrectos, ayer, semana
//      anterior), porGrupo / porTecnico / recategorizacion, la distribucion
//      por estado (action=qare) y el detalle sin paginar (action=detail,
//      pageSize=0: codigos, C1 y Lider de cada fila).
//   C) Sin filtros la respuesta no cambia de forma (sin source.filtros).
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (PowerShell, ver memoria csc):
//   Get-Content handlers\qa.ashx | Select-Object -Skip 1 | Set-Content <scratch>\qa_handler.cs
//   csc /nologo /out:<scratch>\QaFiltrosSqlLocalDbSmoke.exe /r:System.dll /r:System.Data.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll
//       App_Code\*.cs <scratch>\qa_handler.cs tools\tests\QaFiltrosSqlLocalDbSmoke.cs
//   QaFiltrosSqlLocalDbSmoke.exe.config junto al exe, con:
//     <connectionStrings><add name="TicketsProactivanet" connectionString=
//       "Server=(localdb)\MSSQLLocalDB;Initial Catalog=QaFiltrosSmoke;Integrated Security=true"/>
//   QaFiltrosSqlLocalDbSmoke.exe <raiz del repo>     # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.IO;
using System.Text;
using System.Web;
using System.Web.Script.Serialization;

public static class QaFiltrosSqlLocalDbSmoke
{
    static int fallos;
    static string cadena;
    static readonly string NBSP = ((char)160).ToString();

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : esperado.ToString();
        var o = obtenido == null ? "(null)" : obtenido.ToString();
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // ------------------------------------------------------------ replica
    const string Vista = @"
CREATE TABLE dbo.T (CodigoTicket nvarchar(100) NOT NULL, FechaRegistro datetime2(0) NULL, FechaRegistroDia date NULL,
    Tipo nvarchar(100) NULL, TipoRelacion nvarchar(255) NULL, Estado nvarchar(100) NULL, Subestado nvarchar(100) NULL,
    Categoria nvarchar(500) NULL, Grupo nvarchar(255) NOT NULL, Tecnico nvarchar(255) NULL, TecnicoAsignado nvarchar(255) NOT NULL,
    Cliente nvarchar(255) NULL, Sucursal nvarchar(255) NULL, Tienda nvarchar(500) NULL, Titulo nvarchar(4000) NULL,
    Prioridad nvarchar(100) NULL, Descripcion nvarchar(max) NULL, SolucionUsuario nvarchar(max) NULL,
    FechaEstimadaResolucion datetime2(0) NULL, FechaFirmaSolucion datetime2(0) NULL, FechaUltimaModificacion datetime2(0) NULL,
    FechaFirmaCierre datetime2(0) NULL, FirmaCierreRevocacion nvarchar(255) NULL, FirmaSolucion nvarchar(255) NULL,
    ResponsableUltimaModificacion nvarchar(255) NULL, NotificadoPor nvarchar(500) NULL, FechaEstimadaOlaUc datetime2(0) NULL,
    TiempoResolucion nvarchar(100) NULL, TiempoAtencionHorasMin nvarchar(100) NULL, TiempoPrimeraRespuestaHorasMin nvarchar(100) NULL,
    IntentosSolucion int NULL, TiempoPrimeraRespuesta nvarchar(100) NULL, TiempoAtencion nvarchar(100) NULL,
    ReasignacionesGrupo int NULL, Caducada bit NULL, RegistradoPor nvarchar(255) NULL, QA_MensajeError nvarchar(max) NULL,
    QA_Frecuencia nvarchar(500) NULL, QA_Aplicacion nvarchar(500) NULL, QA_PasoAPaso nvarchar(max) NULL,
    QARe_Causa nvarchar(max) NULL, QARe_UsuarioConfirmo nvarchar(255) NULL, QARe_AplicaOtrosCasos nvarchar(255) NULL,
    QARe_GenerarArticulo nvarchar(255) NULL, QARe_VerificoClasificacion nvarchar(255) NULL, QARe_Evidencia nvarchar(max) NULL,
    QARe_DescripcionSolucion nvarchar(max) NULL, QARe_TipoSolucion nvarchar(255) NULL, GrupoCorrecto nvarchar(255) NULL,
    Validacion nvarchar(12) NOT NULL);
GO
CREATE VIEW dbo.vw_CorreoQA_Base AS SELECT * FROM dbo.T;
GO
CREATE TABLE dbo.CatLiderGrupo (Grupo nvarchar(150) NOT NULL PRIMARY KEY, Lider nvarchar(150) NULL, VigenteEnOrigen bit NOT NULL);
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
);
GO
-- La verdad: el WHERE de dbo.tvf_CorreoQARE_Base sobre la vista de QA
-- (FechaRegistroDia, el rango de QA). @ConVentana = 0 para ayer / semana.
CREATE FUNCTION dbo.tvf_Verdad (@Fi DATE, @Ff DATE, @ConVentana BIT,
    @C1 NVARCHAR(MAX), @Grupos NVARCHAR(MAX), @Lideres NVARCHAR(MAX))
RETURNS TABLE
AS
RETURN
(
    SELECT q.CodigoTicket, q.Validacion, q.FechaFirmaSolucion, o.C1, o.Lider
    FROM dbo.vw_CorreoQA_Base AS q
    LEFT JOIN dbo.CatLiderGrupo AS lg ON lg.Grupo = q.Grupo
    CROSS APPLY (SELECT C1    = ISNULL(dbo.fn_CorreoBacklog_CategoriaC1(q.Categoria), N'Sin categoria'),
                        Lider = COALESCE(NULLIF(LTRIM(RTRIM(lg.Lider)), N''), N'Sin Torre')) AS o
    WHERE (@ConVentana = 0 OR (q.FechaRegistroDia >= @Fi AND q.FechaRegistroDia <= @Ff))
      AND (NULLIF(LTRIM(RTRIM(@C1)), N'')      IS NULL OR o.C1     IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@C1)))
      AND (NULLIF(LTRIM(RTRIM(@Grupos)), N'')  IS NULL OR q.Grupo  IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Grupos)))
      AND (NULLIF(LTRIM(RTRIM(@Lideres)), N'') IS NULL OR o.Lider  IN (SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@Lideres)))
);";

    /* Rango de las pruebas: 2026-10-01..2026-10-15. Ayer = 15, semana
       anterior = 07 (QaDb.SqlKpis). A10 y A11 estan FUERA de la ventana pero
       firman en esos dias: cuentan en ayer / semana y en nada mas. */
    static string Datos()
    {
        var f = new List<string[]>
        {
            // codigo, dia registro, grupo, categoria (SQL), validacion, firma solucion, tecnico
            new[] { "A1",  "2026-10-02", "G1",      "N'/S-A/App/X'",                      "Incorrecto",   "'2026-10-15T10:00:00'", "T1" },
            new[] { "A2",  "2026-10-03", "G1",      "N'S-A/Otra'",                        "OK",           "'2026-10-15T11:00:00'", "T1" },
            new[] { "A3",  "2026-10-04", "G2",      "N'/S-B/x'",                          "Incorrecto",   "'2026-10-07T09:00:00'", "T2" },
            new[] { "A4",  "2026-10-05", "G2 ",     "N' /S-B '",                          "Valido",       "NULL",               "T2" },
            new[] { "A5",  "2026-10-06", "G3",      "NULL",                               "Incorrecto",   "'2026-10-07T23:59:00'", "T3" },
            new[] { "A6",  "2026-10-07", "g1",      "N'/s-a/y'",                          "Incorrecto",   "NULL",               "T1" },
            new[] { "A7",  "2026-10-08", "G4",      "N'/'",                               "Sin catalogo", "NULL",               "T4" },
            new[] { "A8",  "2026-10-09", "G5",      "N'/S' + NCHAR(160) + N'C/z'",        "Incorrecto",   "'2026-10-15T00:00:00'", "T5" },
            new[] { "A9",  "2026-10-10", "O'Hara",  "N'/S-A/q'",                          "Incorrecto",   "'2026-10-15T23:59:00'", "T9" },
            new[] { "A10", "2026-09-20", "G1",      "N'/S-A'",                            "Incorrecto",   "'2026-10-15T08:00:00'", "T1" },
            new[] { "A11", "2026-10-16", "G2",      "N'/S-B'",                            "Incorrecto",   "'2026-10-07T08:00:00'", "T2" },
            new[] { "A12", "2026-10-12", "G1",      "N'   '",                             "OK",           "NULL",               "T1" },
        };
        var sql = new StringBuilder();
        foreach (var x in f)
        {
            sql.Append("INSERT dbo.T (CodigoTicket, FechaRegistro, FechaRegistroDia, Grupo, TecnicoAsignado, Tecnico, Categoria, " +
                       "Validacion, FechaFirmaSolucion, Titulo, Estado, Caducada, GrupoCorrecto) VALUES (N'" + x[0] + "', '" + x[1] +
                       "T08:00:00', '" + x[1] + "', N'" + x[2].Replace("'", "''") + "', N'" + x[6] + "', N'" + x[6] + "', " + x[3] +
                       ", N'" + x[4] + "', " + x[5] + ", N'Titulo " + x[0] + "', N'Cerrado', 0, N'GC');\n");
        }
        sql.Append("INSERT dbo.CatLiderGrupo VALUES (N'G1', N'L1', 1), (N'G2', N'L2', 1), (N'G4', N'  ', 1), " +
                   "(N'G5', N'L2', 0), (N'O''Hara', N'L''1', 1);\n");
        return sql.ToString();
    }

    static void Lotes(SqlConnection cn, string script)
    {
        foreach (var lote in script.Split(new[] { "\nGO\r\n", "\nGO\n", "\r\nGO\r\n" }, StringSplitOptions.RemoveEmptyEntries))
            if (lote.Trim().Length > 0) new SqlCommand(lote, cn).ExecuteNonQuery();
    }

    static void Preparar(string raiz)
    {
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            Lotes(cn, Vista + "\nGO\n");
            new SqlCommand(Datos(), cn).ExecuteNonQuery();
            // El SP del detalle, tal como esta versionado (sin USE ni GO).
            var fix = File.ReadAllText(Path.Combine(raiz, @"sql\fix_qa_detalle_option_recompile.sql"));
            int i = fix.IndexOf("CREATE OR ALTER PROCEDURE dbo.usp_CorreoQA_Detalle", StringComparison.Ordinal);
            int j = fix.IndexOf("END;", fix.IndexOf("OPTION (RECOMPILE);", i, StringComparison.Ordinal), StringComparison.Ordinal);
            new SqlCommand(fix.Substring(i, j + 4 - i), cn).ExecuteNonQuery();
        }
    }

    // ------------------------------------------------------- A) la regla C1
    static void ReglaC1()
    {
        var entradas = new List<string> { null, "", "   ", "/", "//x", "/S-A/App/X", "S-A/Otra", " /S-B ", "/ a /b",
            "/S" + NBSP + "C/z", NBSP + "/X/y", "abc", "/" + new string('k', 300) + "/z", "/s-a/" };
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            int n = 0;
            foreach (var e in entradas)
            {
                n++;
                var cmd = new SqlCommand("SELECT dbo.fn_CorreoBacklog_CategoriaC1(@c), fo.C1 " +
                    "FROM (SELECT Categoria = @c, Grupo = N'') AS b LEFT JOIN dbo.CatLiderGrupo AS fo_lg ON 1 = 0" +
                    QaFiltroOrg.C1Sql, cn);
                cmd.Parameters.Add("@c", System.Data.SqlDbType.NVarChar, 500).Value = (object)e ?? DBNull.Value;
                using (var rd = cmd.ExecuteReader())
                {
                    rd.Read();
                    var fn = rd.IsDBNull(0) ? null : rd.GetString(0);
                    var verdad = fn ?? QaFiltroOrg.SinCategoria;
                    Chk("C1 #" + n + " C# = funcion de la VM", fn ?? "(null)", QaFiltroOrg.C1De(e) ?? "(null)");
                    Chk("C1 #" + n + " T-SQL de los KPIs = funcion de la VM", verdad, rd.GetString(1));
                }
            }

            foreach (var lista in new[] { " a, ,b ,a", "", null, "Sin Torre", "x,", "L'1, L2" })
            {
                var cmd = new SqlCommand("SELECT Valor FROM dbo.fn_CorreoBacklog_SplitList(@l)", cn);
                cmd.Parameters.Add("@l", System.Data.SqlDbType.NVarChar, -1).Value = (object)lista ?? DBNull.Value;
                var sql = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
                using (var rd = cmd.ExecuteReader()) while (rd.Read()) sql.Add(rd.GetString(0));
                var cs = new SortedSet<string>(QaFiltroOrg.Partir(lista), StringComparer.OrdinalIgnoreCase);
                Chk("Partir = fn_CorreoBacklog_SplitList [" + lista + "]", string.Join("|", sql), string.Join("|", cs));
            }
        }
    }

    // ------------------------------------------------------- B) handler
    static Dictionary<string, object> Pedir(string query, out int estado)
    {
        var sw = new StringWriter();
        var req = new HttpRequest("", "http://localhost/handlers/qa.ashx", query);
        var ctx = new HttpContext(req, new HttpResponse(sw));
        new Qa().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        return (Dictionary<string, object>)new JavaScriptSerializer { MaxJsonLength = int.MaxValue }
            .DeserializeObject(sw.ToString());
    }

    static Dictionary<string, object> Pedir(string query)
    {
        int estado;
        var d = Pedir(query, out estado);
        if (estado != 200) Chk("HTTP 200 " + query, 200, estado + " " + (d != null && d.ContainsKey("message") ? d["message"] : ""));
        return d;
    }

    static IEnumerable<Dictionary<string, object>> Lista(object o)
    {
        var arr = o as object[];
        if (arr != null) foreach (var x in arr) yield return (Dictionary<string, object>)x;
    }

    static long Suma(object lista, string col)
    {
        long s = 0;
        foreach (var f in Lista(lista)) s += Convert.ToInt64(f[col]);
        return s;
    }

    sealed class Verdad
    {
        public long Total, Incorrectos, Ayer, Semana;
        public SortedDictionary<string, string> Filas = new SortedDictionary<string, string>(StringComparer.Ordinal);
    }

    static object Nulo(string s) { return string.IsNullOrEmpty(s) ? (object)DBNull.Value : s; }

    static Verdad LeerVerdad(string c1, string grupos, string lideres)
    {
        var v = new Verdad();
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            foreach (var ventana in new[] { 1, 0 })
            {
                var cmd = new SqlCommand("SELECT CodigoTicket, Validacion, FechaFirmaSolucion, C1, Lider " +
                    "FROM dbo.tvf_Verdad('2026-10-01', '2026-10-15', @v, @c1, @g, @l)", cn);
                cmd.Parameters.AddWithValue("@v", ventana);
                cmd.Parameters.AddWithValue("@c1", Nulo(c1));
                cmd.Parameters.AddWithValue("@g", Nulo(grupos));
                cmd.Parameters.AddWithValue("@l", Nulo(lideres));
                using (var rd = cmd.ExecuteReader())
                {
                    while (rd.Read())
                    {
                        bool inc = rd.GetString(1) == "Incorrecto";
                        if (ventana == 1)
                        {
                            v.Total++;
                            if (inc) v.Incorrectos++;
                            v.Filas[rd.GetString(0)] = rd.GetString(3) + "|" + rd.GetString(4);
                        }
                        else if (inc && !rd.IsDBNull(2))
                        {
                            var dia = rd.GetDateTime(2).Date;
                            if (dia == new DateTime(2026, 10, 15)) v.Ayer++;
                            if (dia == new DateTime(2026, 10, 7)) v.Semana++;
                        }
                    }
                }
            }
        }
        return v;
    }

    static string Qs(string c1, string grupos, string lideres)
    {
        var qs = "fecha_inicio=2026-10-01&fecha_fin=2026-10-15";
        if (c1 != null) qs += "&c1=" + HttpUtility.UrlEncode(c1);
        if (grupos != null) qs += "&grupos=" + HttpUtility.UrlEncode(grupos);
        if (lideres != null) qs += "&lideres=" + HttpUtility.UrlEncode(lideres);
        return qs;
    }

    static void Caso(string nombre, string c1, string grupos, string lideres, long minimo)
    {
        var v = LeerVerdad(c1, grupos, lideres);
        var qs = Qs(c1, grupos, lideres);
        Chk(nombre + ": la verdad tiene al menos " + minimo + " tickets", true, v.Total >= minimo);

        var s = Pedir("action=summary&" + qs);
        var resumen = (Dictionary<string, object>)s["summary"];
        var hist = (Dictionary<string, object>)s["historico"];
        Chk(nombre + ": KPIs total / incorrectos / ayer / semana",
            v.Total + "/" + v.Incorrectos + "/" + v.Ayer + "/" + v.Semana,
            resumen["totalTickets"] + "/" + resumen["incorrectos"] + "/" + hist["incorrectosAyer"] + "/" + hist["incorrectosSemanaAnterior"]);
        Chk(nombre + ": porGrupo / porTecnico / recategorizacion suman los incorrectos",
            v.Incorrectos + "/" + v.Incorrectos + "/" + v.Incorrectos,
            Suma(s["porGrupo"], "tickets") + "/" + Suma(s["porTecnico"], "tickets") + "/" + Suma(s["recategorizacion"], "tickets"));
        var src = (Dictionary<string, object>)s["source"];
        bool conFiltro = c1 != null || grupos != null || lideres != null;
        Chk(nombre + ": source.filtros solo con filtros", conFiltro, src.ContainsKey("filtros"));

        var q = Pedir("action=qare&" + qs);
        Chk(nombre + ": distribucion por estado suma el total", v.Total, Suma(q["validacion"], "tickets"));

        var d = Pedir("action=detail&pageSize=0&" + qs);
        var filas = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var f in Lista(d["rows"])) filas[(string)f[QaCorreo.ColCodigo]] = f["C1"] + "|" + f["Lider"];
        Chk(nombre + ": detalle = tickets de la verdad, con su C1 y su Lider", Texto(v.Filas), Texto(filas));
        Chk(nombre + ": detalle total", v.Total, Convert.ToInt64(d["total"]));

        var di = Pedir("action=detail&validacion=Incorrecto&" + qs);
        Chk(nombre + ": detalle de incorrectos = KPI", v.Incorrectos, Convert.ToInt64(di["total"]));
    }

    static string Texto(SortedDictionary<string, string> m)
    {
        var sb = new StringBuilder();
        foreach (var kv in m) sb.Append(kv.Key).Append('=').Append(kv.Value).Append("; ");
        return sb.ToString();
    }

    static void Integracion()
    {
        Caso("sin filtros", null, null, null, 10);
        Caso("C1 S-A", "S-A", null, null, 3);
        Caso("C1 en minusculas", "s-a", null, null, 3);
        Caso("C1 Sin categoria", "Sin categoria", null, null, 3);
        Caso("C1 con espacio duro normalizado", "S C", null, null, 1);
        Caso("C1 lista", "S-A, S-B", null, null, 5);
        Caso("Grupo G2 (y 'G2 ' con espacio al final)", null, "G2", null, 2);
        Caso("Grupo en minusculas", null, "g1", null, 3);
        Caso("Grupo con comilla", null, "O'Hara", null, 1);
        Caso("Lider L1", null, null, "L1", 3);
        Caso("Lider Sin Torre (sin fila y Lider en blanco)", null, null, "Sin Torre", 2);
        Caso("Lider L2 (incluye un grupo no vigente)", null, null, "L2", 2);
        Caso("Lider con comilla", null, null, "L'1", 1);
        Caso("cruce C1 + Lider", "S-A", null, "L1", 2);
        Caso("los tres", "S-B", "G2", "L2", 2);
        Caso("valor inexistente", "NO-EXISTE", null, null, 0);
        Caso("texto con forma de SQL", "x') OR 1=1 --", "'; DROP TABLE dbo.T; --", null, 0);

        // La vista sin filtros responde como siempre: sin "filtros" en el eco
        // del detalle, y la peticion por omision (sin fechas) sigue en pie.
        int estado;
        var d = Pedir("action=detail&validacion=Incorrecto&" + Qs(null, null, null), out estado);
        var filtros = (Dictionary<string, object>)d["filters"];
        Chk("sin filtros: el eco del detalle no lleva c1/grupos/lideres", false,
            filtros.ContainsKey("c1") || filtros.ContainsKey("grupos") || filtros.ContainsKey("lideres"));
        Pedir("action=summary", out estado);
        Chk("la peticion de siempre (sin parametros) sigue respondiendo 200", 200, estado);
        Chk("dbo.T sigue en pie despues del texto con forma de SQL", 12L, Contar());
    }

    static long Contar()
    {
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            return Convert.ToInt64(new SqlCommand("SELECT COUNT_BIG(*) FROM dbo.T", cn).ExecuteScalar());
        }
    }

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
            ReglaC1();
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
