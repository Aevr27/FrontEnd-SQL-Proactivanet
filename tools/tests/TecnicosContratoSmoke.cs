// tools/tests/TecnicosContratoSmoke.cs - prueba de humo de la pestaña Tecnicos.
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Dos partes:
//   1) TecnicosContrato / TecnicosQueries.Repartir, puros: fechas (default,
//      tope, invertidas, mal formadas), Pareto ordenado por Posicion,
//      columnas faltantes, result sets de menos, columna de sql/47.
//   2) TecnicosQueries.Consultar + handlers/tecnicos.ashx de punta a punta
//      contra SQL Server LocalDB, en una base TEMPORAL con stubs de los cuatro
//      usp_QARE_* que ecoan @FechaInicio/@FechaFin. Segun la fecha de inicio:
//        2026-08-01  datos normales (Pareto desordenado, Pct NULL)
//        2026-02-01  falla SOLO el SP de Tecnicos (los demas bloques llegan)
//        2026-03-01  todos los result sets vacios
//        2026-04-01  PatronesSolucion devuelve 2 result sets en vez de 3
//        2026-05-01  el Detalle trae TipoClasificacionRespuesta (sql/47)
//        2000-01-01  fallan los cuatro (500)
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (PowerShell):
//   Get-Content handlers\tecnicos.ashx | Select -Skip 1 | Set-Content <scratch>\tecnicos_handler.cs
//   csc /nologo /out:<scratch>\TecnicosSmoke.exe /r:System.dll /r:System.Data.dll
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll
//       App_Code\*.cs <scratch>\tecnicos_handler.cs tools\tests\TecnicosContratoSmoke.cs
//   TecnicosSmoke.exe.config junto al exe, con:
//     <connectionStrings><add name="TicketsProactivanet" connectionString=
//       "Server=(localdb)\MSSQLLocalDB;Initial Catalog=TecnicosSmoke;Integrated Security=true"/>
//   TecnicosSmoke.exe     # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.IO;
using System.Web;
using System.Web.Script.Serialization;

public static class TecnicosContratoSmoke
{
    static int fallos;

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : esperado.ToString();
        var o = obtenido == null ? "(null)" : obtenido.ToString();
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + "  esperado=" + e + "  obtenido=" + o);
    }

    static Dictionary<string, object> F(params object[] kv)
    {
        var d = new Dictionary<string, object>();
        for (int i = 0; i < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
        return d;
    }

    static string Dia(DateTime d) { return d.ToString("yyyy-MM-dd"); }

    // ------------------------------------------------------------ 1. puro
    static void Puro()
    {
        var hoy = new DateTime(2026, 11, 27);
        DateTime i, f;

        TecnicosContrato.Rango(null, null, hoy, out i, out f);
        Chk("sin fechas: 15 dias que terminan hoy", "2026-11-13|2026-11-27", Dia(i) + "|" + Dia(f));
        TecnicosContrato.Rango("2026-11-01", "2026-11-30", hoy, out i, out f);
        Chk("fechas tal cual, sin correr dias", "2026-11-01|2026-11-30", Dia(i) + "|" + Dia(f));
        TecnicosContrato.Rango(null, "2026-10-31", hoy, out i, out f);
        Chk("solo fin: 15 dias que terminan en el fin", "2026-10-17|2026-10-31", Dia(i) + "|" + Dia(f));
        TecnicosContrato.Rango("2026-08-27", "2026-11-27", hoy, out i, out f);
        Chk("93 dias valen", "2026-08-27", Dia(i));

        Chk("inicio > fin -> 400", true, Lanza(() => TecnicosContrato.Rango("2026-11-28", "2026-11-27", hoy, out i, out f)));
        Chk("94 dias -> 400", true, Lanza(() => TecnicosContrato.Rango("2026-08-26", "2026-11-27", hoy, out i, out f)));
        Chk("fecha mal formada -> 400", true, Lanza(() => TecnicosContrato.Rango("27/11/2026", null, hoy, out i, out f)));

        // Los cuatro procedimientos y sus bloques.
        Chk("cuatro procedimientos", 4, TecnicosContrato.Procedimientos.Length);
        Chk("PatronesSolucion alimenta tres bloques en orden",
            "distribucion,pareto,resumen", string.Join(",", Claves(TecnicosContrato.BloquesDe(TecnicosContrato.SpPatrones))));

        // Pareto: Posicion ASC, estable; los demas, orden del SP.
        var avisos = new List<string>();
        var pareto = TecnicosContrato.Preparar(TecnicosContrato.Pareto, new List<Dictionary<string, object>> {
            F("Posicion", 3L, "PatronSolucion", "C", "Tickets", 10, "Porcentaje", 10m, "TicketsAcumulados", 100, "PctAcumulado", 100m),
            F("Posicion", 1L, "PatronSolucion", "A", "Tickets", 60, "Porcentaje", 60m, "TicketsAcumulados", 60, "PctAcumulado", 60m),
            F("Posicion", 2L, "PatronSolucion", "B", "Tickets", 30, "Porcentaje", 30m, "TicketsAcumulados", 90, "PctAcumulado", 90m),
        }, avisos);
        Chk("Pareto por Posicion", "A,B,C", pareto[0]["PatronSolucion"] + "," + pareto[1]["PatronSolucion"] + "," + pareto[2]["PatronSolucion"]);
        Chk("Pareto sin avisos", 0, avisos.Count);

        avisos.Clear();
        var tec = TecnicosContrato.Preparar(TecnicosContrato.Tecnicos, new List<Dictionary<string, object>> {
            F("FirmaSolucion", "Z", "TicketsEvaluados", 1), F("FirmaSolucion", "A", "TicketsEvaluados", 9),
        }, avisos);
        Chk("Tecnicos conserva el orden del SP", "Z,A", tec[0]["FirmaSolucion"] + "," + tec[1]["FirmaSolucion"]);
        Chk("Tecnicos avisa columnas faltantes", true, avisos.Exists(a => a.Contains("'TicketsTotales'")));

        avisos.Clear();
        TecnicosContrato.Preparar(TecnicosContrato.Detalle, new List<Dictionary<string, object>>(), avisos);
        Chk("rango vacio no es un contrato roto", 0, avisos.Count);

        Chk("Detalle sin sql/47", false, TecnicosContrato.DetalleTraeTipo(new List<Dictionary<string, object>> { F("CodigoTicket", "X") }));
        Chk("Detalle con sql/47", true, TecnicosContrato.DetalleTraeTipo(new List<Dictionary<string, object>> { F("CodigoTicket", "X", "TipoClasificacionRespuesta", null) }));
        Chk("Detalle vacio: sin tipo", false, TecnicosContrato.DetalleTraeTipo(new List<Dictionary<string, object>>()));

        // Result sets de menos: el bloque que falta, en null con su error.
        var r = new TecnicosResultado();
        TecnicosQueries.Repartir(TecnicosContrato.SpPatrones, TecnicosContrato.BloquesDe(TecnicosContrato.SpPatrones),
            new List<List<Dictionary<string, object>>> {
                new List<Dictionary<string, object>> { F("ClasificacionRespuesta", "X", "TipoClasificacionRespuesta", "SIN PATRON", "Tickets", 1, "Porcentaje", 100m) },
                new List<Dictionary<string, object>>(),
            }, r);
        Chk("result set 3 ausente -> resumen null", true, r.Bloques["resumen"] == null);
        Chk("result set 3 ausente -> error del bloque", true, r.Errores.ContainsKey("resumen") && r.Errores["resumen"].Contains("result set 3"));
        Chk("los que si llegaron se entregan", 1, ((List<Dictionary<string, object>>)r.Bloques["distribucion"]).Count);
        Chk("Pareto vacio es lista vacia, no null", 0, ((List<Dictionary<string, object>>)r.Bloques["pareto"]).Count);

        var r2 = new TecnicosResultado();
        TecnicosQueries.Repartir(TecnicosContrato.SpKpis, TecnicosContrato.BloquesDe(TecnicosContrato.SpKpis),
            new List<List<Dictionary<string, object>>> { new List<Dictionary<string, object>>() }, r2);
        Chk("KPIs sin fila -> null sin error", "null|0", (r2.Bloques["kpis"] == null ? "null" : "fila") + "|" + r2.Errores.Count);
    }

    static IEnumerable<string> Claves(List<TecnicosBloque> bloques)
    {
        foreach (var b in bloques) yield return b.Clave;
    }

    static bool Lanza(Action a)
    {
        try { a(); return false; }
        catch (TecnicosSolicitudInvalida) { return true; }
    }

    // ------------------------------------------------------------ 2. LocalDB
    const string Stubs = @"
CREATE PROCEDURE dbo.usp_QARE_CalidadCaptura_KPIs @FechaInicio DATE = NULL, @FechaFin DATE = NULL AS
BEGIN
  IF @FechaInicio = '2000-01-01' RAISERROR('falla forzada', 16, 1);
  IF @FechaInicio = '2026-03-01'
    SELECT TicketsTotales = 0, TicketsSinInformacionQARE = 0, TicketsEvaluados = 0, TicketsNoEvaluables = 0,
           PctNoEvaluable = CAST(NULL AS DECIMAL(10,2)), TicketsTextoEvaluable = 0, PctTextoEvaluable = CAST(NULL AS DECIMAL(10,2)),
           EcoInicio = @FechaInicio, EcoFin = @FechaFin;
  ELSE
    SELECT TicketsTotales = 8304, TicketsSinInformacionQARE = 1588, TicketsEvaluados = 6716, TicketsNoEvaluables = 2581,
           PctNoEvaluable = CAST(38.43 AS DECIMAL(10,2)), TicketsTextoEvaluable = 4135, PctTextoEvaluable = CAST(61.57 AS DECIMAL(10,2)),
           EcoInicio = @FechaInicio, EcoFin = @FechaFin;
END;
GO
CREATE PROCEDURE dbo.usp_QARE_PatronesSolucion @FechaInicio DATE = NULL, @FechaFin DATE = NULL,
  @Grupo VARCHAR(250) = NULL, @FirmaSolucion VARCHAR(250) = NULL, @Top INT = NULL AS
BEGIN
  IF @FechaInicio = '2000-01-01' RAISERROR('falla forzada', 16, 1);
  DECLARE @vacio bit = CASE WHEN @FechaInicio = '2026-03-01' THEN 1 ELSE 0 END;
  SELECT ClasificacionRespuesta, TipoClasificacionRespuesta, Tickets, Porcentaje = CAST(Porcentaje AS DECIMAL(10,2)), EcoInicio = @FechaInicio
  FROM (VALUES ('SIN PATRON IDENTIFICADO', 'SIN PATRON', 1690, 40.87), ('REINICIO / REACTIVACION', 'PATRON_SOLUCION', 273, 6.60))
       v(ClasificacionRespuesta, TipoClasificacionRespuesta, Tickets, Porcentaje)
  WHERE @vacio = 0;
  -- Pareto entregado DESORDENADO a proposito.
  SELECT Posicion = CAST(Posicion AS BIGINT), PatronSolucion, Tickets, Porcentaje = CAST(Porcentaje AS DECIMAL(10,2)),
         TicketsAcumulados, PctAcumulado = CAST(PctAcumulado AS DECIMAL(10,2))
  FROM (VALUES (2, 'REINICIO / REACTIVACION', 273, 13.58, 551, 27.41), (1, 'ACTUALIZACION / INSTALACION', 278, 13.83, 278, 13.83),
               (3, 'INDICACIONES / CANALIZACION', 221, 11.00, 772, 38.41))
       v(Posicion, PatronSolucion, Tickets, Porcentaje, TicketsAcumulados, PctAcumulado)
  WHERE @vacio = 0;
  IF @FechaInicio <> '2026-04-01'
    SELECT TotalTextoEvaluable = CASE WHEN @vacio = 1 THEN 0 ELSE 4135 END,
           TicketsConPatron = CASE WHEN @vacio = 1 THEN 0 ELSE 2010 END,
           PctConPatron = CAST(CASE WHEN @vacio = 1 THEN NULL ELSE 48.61 END AS DECIMAL(10,2)),
           TicketsCalidad = CASE WHEN @vacio = 1 THEN 0 ELSE 435 END,
           PctCalidad = CAST(CASE WHEN @vacio = 1 THEN NULL ELSE 10.52 END AS DECIMAL(10,2)),
           TicketsSinPatron = CASE WHEN @vacio = 1 THEN 0 ELSE 1690 END,
           PctSinPatron = CAST(CASE WHEN @vacio = 1 THEN NULL ELSE 40.87 END AS DECIMAL(10,2));
END;
GO
CREATE PROCEDURE dbo.usp_QARE_CalidadCaptura_Tecnicos @FechaInicio DATE = NULL, @FechaFin DATE = NULL, @Grupo VARCHAR(250) = NULL AS
BEGIN
  IF @FechaInicio IN ('2000-01-01', '2026-02-01') RAISERROR('falla forzada', 16, 1);
  SELECT FirmaSolucion, TicketsTotales, TicketsSinInformacionQARE, TicketsEvaluados, TicketsNoEvaluables,
         PctNoEvaluable = CAST(PctNoEvaluable AS DECIMAL(10,2)), TicketsTextoEvaluable, PctTextoEvaluable = CAST(PctTextoEvaluable AS DECIMAL(10,2)),
         TicketsConPatron, PctConPatron = CAST(PctConPatron AS DECIMAL(10,2)), TicketsCalidad, PctCalidad = CAST(PctCalidad AS DECIMAL(10,2)),
         TicketsSinPatron, PctSinPatron = CAST(PctSinPatron AS DECIMAL(10,2))
  FROM (VALUES (N'Perez Rojas, M', 480, 0, 480, 346, 72.08, 134, 27.92, 78, 58.21, 0, 0.00, 56, 41.79),
               (N'Castro Garcia, B', 155, 0, 155, 155, 100.00, 0, 0.00, 0, NULL, 0, NULL, 0, NULL),
               (N'Almanza Almaraz, C', 243, 1, 242, 1, 0.41, 241, 99.59, 127, 52.70, 17, 7.05, 97, 40.25))
       v(FirmaSolucion, TicketsTotales, TicketsSinInformacionQARE, TicketsEvaluados, TicketsNoEvaluables, PctNoEvaluable,
         TicketsTextoEvaluable, PctTextoEvaluable, TicketsConPatron, PctConPatron, TicketsCalidad, PctCalidad, TicketsSinPatron, PctSinPatron)
  WHERE @FechaInicio <> '2026-03-01';
END;
GO
CREATE PROCEDURE dbo.usp_QARE_DetalleEvidencia @FechaInicio DATE = NULL, @FechaFin DATE = NULL, @Grupo VARCHAR(250) = NULL,
  @FirmaSolucion VARCHAR(250) = NULL, @Categoria VARCHAR(500) = NULL, @EstadoDescripcion VARCHAR(50) = NULL,
  @ClasificacionRespuesta VARCHAR(150) = NULL AS
BEGIN
  IF @FechaInicio = '2000-01-01' RAISERROR('falla forzada', 16, 1);
  IF @FechaInicio = '2026-05-01'
    SELECT CodigoTicket = 'INC 1', FechaFirmaSolucion = CAST('2026-05-02T10:30:00' AS DATETIME2), FirmaSolucion = N'Perez Rojas, M',
           Grupo = N'Mesa', Categoria = N'/Cat', Validacion = N'OK', QARe_Causa = N'Necesidad', QARe_AplicaOtrosCasos = N'No',
           QARe_GenerarArticulo = N'No', QARe_VerificoClasificacion = N'Sí', QARe_TipoSolucion = N'Se otorgan permisos',
           QARe_DescripcionSolucion = N'NO  SALE ERROR', EstadoDescripcionVisual = 'RESPUESTA ANALIZABLE',
           ClasificacionRespuesta = 'PROBLEMA / NO SOLUCION', TipoClasificacionRespuesta = 'CALIDAD';
  ELSE
    SELECT CodigoTicket, FechaFirmaSolucion = CAST(FechaFirmaSolucion AS DATETIME2), FirmaSolucion, Grupo, Categoria, Validacion,
           QARe_Causa, QARe_AplicaOtrosCasos, QARe_GenerarArticulo, QARe_VerificoClasificacion, QARe_TipoSolucion,
           QARe_DescripcionSolucion, EstadoDescripcionVisual, ClasificacionRespuesta
    FROM (VALUES ('INC 2', '2026-08-30T15:39:42', N'Perez Rojas, M', N'Mesa', N'/Cat', N'OK', N'Necesidad', N'No', N'No', N'Sí',
                  N'Se otorgan permisos', N'LEGADO - ITX', 'RESPUESTA ANALIZABLE', 'PROBLEMA / NO SOLUCION'),
                 ('INC 3', '2026-08-30T14:00:00', N'Castro Garcia, B', N'Mesa', N'/Cat', N'OK', NULL, NULL, NULL, NULL,
                  NULL, NULL, 'SIN INFORMACION QARE', NULL))
         v(CodigoTicket, FechaFirmaSolucion, FirmaSolucion, Grupo, Categoria, Validacion, QARe_Causa, QARe_AplicaOtrosCasos,
           QARe_GenerarArticulo, QARe_VerificoClasificacion, QARe_TipoSolucion, QARe_DescripcionSolucion,
           EstadoDescripcionVisual, ClasificacionRespuesta)
    WHERE @FechaInicio <> '2026-03-01';
END;";

    static Dictionary<string, object> Pedir(string query, out int estado)
    {
        var sw = new StringWriter();
        var ctx = new HttpContext(new HttpRequest("", "http://localhost/handlers/tecnicos.ashx", query),
                                  new HttpResponse(sw));
        new Tecnicos().ProcessRequest(ctx);
        estado = ctx.Response.StatusCode;
        return (Dictionary<string, object>)new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.DeserializeObject(sw.ToString());
    }

    static object[] Lista(object o) { return o as object[] ?? new object[0]; }
    static Dictionary<string, object> Obj(object o) { return o as Dictionary<string, object>; }
    static Dictionary<string, object> Errores(Dictionary<string, object> d) { return (Dictionary<string, object>)d["errores"]; }

    static void Integracion()
    {
        int estado;

        // --- datos normales --------------------------------------------------
        var d = Pedir("fecha_inicio=2026-08-01&fecha_fin=2026-08-31", out estado);
        Chk("200", 200, estado);
        Chk("fechas de la respuesta", "2026-08-01|2026-08-31", d["fechaInicio"] + "|" + d["fechaFin"]);
        Chk("sin errores", 0, Errores(d).Count);
        Chk("sin avisos", 0, Lista(d["avisos"]).Length);
        var k = Obj(d["kpis"]);
        Chk("KPIs: valores del SP", "8304|1588|6716|2581|4135", k["TicketsTotales"] + "|" + k["TicketsSinInformacionQARE"] + "|" +
            k["TicketsEvaluados"] + "|" + k["TicketsNoEvaluables"] + "|" + k["TicketsTextoEvaluable"]);
        Chk("KPIs: % intacto", "38.43|61.57", k["PctNoEvaluable"] + "|" + k["PctTextoEvaluable"]);
        Chk("las dos fechas llegan TAL CUAL al SP", "2026-08-01T00:00:00|2026-08-31T00:00:00", k["EcoInicio"] + "|" + k["EcoFin"]);

        Chk("Patrones RS1: distribucion", 2, Lista(d["distribucion"]).Length);
        var par = Lista(d["pareto"]);
        Chk("Patrones RS2: Pareto ordenado por Posicion", "ACTUALIZACION / INSTALACION|REINICIO / REACTIVACION|INDICACIONES / CANALIZACION",
            Obj(par[0])["PatronSolucion"] + "|" + Obj(par[1])["PatronSolucion"] + "|" + Obj(par[2])["PatronSolucion"]);
        Chk("Pareto: acumulado intacto", "38.41", Obj(par[2])["PctAcumulado"]);
        var res = Obj(d["resumen"]);
        Chk("Patrones RS3: resumen", "4135|2010|48.61|435|10.52|1690|40.87", res["TotalTextoEvaluable"] + "|" + res["TicketsConPatron"] + "|" +
            res["PctConPatron"] + "|" + res["TicketsCalidad"] + "|" + res["PctCalidad"] + "|" + res["TicketsSinPatron"] + "|" + res["PctSinPatron"]);

        var tec = Lista(d["tecnicos"]);
        Chk("Tecnicos: orden del SP", "Perez Rojas, M|Castro Garcia, B|Almanza Almaraz, C",
            Obj(tec[0])["FirmaSolucion"] + "|" + Obj(tec[1])["FirmaSolucion"] + "|" + Obj(tec[2])["FirmaSolucion"]);
        Chk("Tecnicos: Pct NULL sigue null", null, Obj(tec[1])["PctConPatron"]);
        Chk("Tecnicos: 100 % intacto", "100.00", Obj(tec[1])["PctNoEvaluable"]);

        var det = Lista(d["detalle"]);
        Chk("Detalle: filas", 2, det.Length);
        Chk("Detalle: fecha ISO", "2026-08-30T15:39:42", Obj(det[0])["FechaFirmaSolucion"]);
        Chk("Detalle: estado y clasificacion tal cual", "RESPUESTA ANALIZABLE|PROBLEMA / NO SOLUCION",
            Obj(det[0])["EstadoDescripcionVisual"] + "|" + Obj(det[0])["ClasificacionRespuesta"]);
        Chk("Detalle: clasificacion NULL sigue null", null, Obj(det[1])["ClasificacionRespuesta"]);
        Chk("Detalle sin sql/47: detalleTraeTipo false", false, d["detalleTraeTipo"]);
        Chk("Detalle: acentos intactos", "Sí", Obj(det[0])["QARe_VerificoClasificacion"]);
        Chk("dataInfo presente", true, d.ContainsKey("dataInfo") && d["dataInfo"] != null);

        // --- sin fechas: 15 dias, nunca NULL ------------------------------------
        d = Pedir("", out estado);
        Chk("sin fechas: 200", 200, estado);
        var eco = Obj(d["kpis"]);
        Chk("sin fechas: el SP recibe dos fechas, no NULL", true, eco["EcoInicio"] != null && eco["EcoFin"] != null);
        var di = DateTime.Parse((string)d["fechaInicio"]); var df = DateTime.Parse((string)d["fechaFin"]);
        Chk("sin fechas: 15 dias incluidos", 14, (df - di).Days);

        // --- un SP que falla no tumba a los demas ---------------------------------
        d = Pedir("fecha_inicio=2026-02-01&fecha_fin=2026-02-28", out estado);
        Chk("falla Tecnicos: sigue 200", 200, estado);
        Chk("falla Tecnicos: su bloque en null", true, d["tecnicos"] == null);
        Chk("falla Tecnicos: solo su error", "tecnicos", string.Join(",", Errores(d).Keys));
        Chk("falla Tecnicos: mensaje sin texto crudo de SQL", false, ((string)Errores(d)["tecnicos"]).Contains("falla forzada"));
        Chk("falla Tecnicos: mensaje nombra el SP", true, ((string)Errores(d)["tecnicos"]).Contains("usp_QARE_CalidadCaptura_Tecnicos"));
        Chk("falla Tecnicos: KPIs, Pareto y Detalle llegan", true, d["kpis"] != null && d["pareto"] != null && d["detalle"] != null);

        // --- result sets vacios ------------------------------------------------------
        d = Pedir("fecha_inicio=2026-03-01&fecha_fin=2026-03-31", out estado);
        Chk("vacios: 200 sin errores", "200|0", estado + "|" + Errores(d).Count);
        Chk("vacios: listas vacias, no null", "0|0|0|0", Lista(d["distribucion"]).Length + "|" + Lista(d["pareto"]).Length + "|" +
            Lista(d["tecnicos"]).Length + "|" + Lista(d["detalle"]).Length);
        Chk("vacios: listas no son null", true, d["pareto"] != null && d["detalle"] != null);
        Chk("vacios: KPIs con Pct NULL", "0|(null)", Obj(d["kpis"])["TicketsTotales"] + "|" + (Obj(d["kpis"])["PctNoEvaluable"] ?? "(null)"));
        Chk("vacios: resumen con Pct NULL", null, Obj(d["resumen"])["PctConPatron"]);

        // --- PatronesSolucion con un result set de menos -----------------------------
        d = Pedir("fecha_inicio=2026-04-01&fecha_fin=2026-04-30", out estado);
        Chk("2 result sets: 200", 200, estado);
        Chk("2 result sets: resumen null con error", true, d["resumen"] == null && Errores(d).ContainsKey("resumen"));
        Chk("2 result sets: distribucion y Pareto llegan", "2|3", Lista(d["distribucion"]).Length + "|" + Lista(d["pareto"]).Length);

        // --- sql/47 aplicado -----------------------------------------------------------
        d = Pedir("fecha_inicio=2026-05-01&fecha_fin=2026-05-31", out estado);
        Chk("sql/47: detalleTraeTipo true", true, d["detalleTraeTipo"]);
        Chk("sql/47: columna tal cual", "CALIDAD", Obj(Lista(d["detalle"])[0])["TipoClasificacionRespuesta"]);

        // --- errores de la peticion --------------------------------------------------
        d = Pedir("fecha_inicio=2026-08-31&fecha_fin=2026-08-01", out estado);
        Chk("inicio > fin: 400", 400, estado);
        Chk("inicio > fin: tipo", "SolicitudInvalida", d["tipo"]);
        d = Pedir("fecha_inicio=2026-01-01&fecha_fin=2026-08-01", out estado);
        Chk("rango largo: 400", 400, estado);
        d = Pedir("fecha_inicio=ayer", out estado);
        Chk("fecha mal formada: 400", 400, estado);
        d = Pedir("fecha_inicio=2000-01-01&fecha_fin=2000-01-31", out estado);
        Chk("fallan los cuatro: 500", 500, estado);
        Chk("fallan los cuatro: mensaje seguro", false, ((string)d["error"]).Contains("falla forzada") && ((string)d["error"]).Contains("Server"));
    }

    public static int Main(string[] args)
    {
        const string maestra = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true";
        if (ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion] == null)
        {
            Console.WriteLine("Falta " + AppDomain.CurrentDomain.SetupInformation.ConfigurationFile +
                              " con la cadena TicketsProactivanet; ver cabecera.");
            return 99;
        }

        Puro();

        var cadena = ConfigurationManager.ConnectionStrings[ConnectionStringProvider.ClaveConexion].ConnectionString;
        var bd = new SqlConnectionStringBuilder(cadena).InitialCatalog;
        using (var cn = new SqlConnection(maestra))
        {
            cn.Open();
            new SqlCommand("IF DB_ID('" + bd + "') IS NOT NULL BEGIN ALTER DATABASE [" + bd +
                           "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + bd + "]; END; CREATE DATABASE [" + bd + "];", cn).ExecuteNonQuery();
        }
        try
        {
            using (var cn = new SqlConnection(cadena))
            {
                cn.Open();
                foreach (var lote in Stubs.Split(new[] { "\nGO" }, StringSplitOptions.RemoveEmptyEntries))
                    new SqlCommand(lote, cn).ExecuteNonQuery();
            }
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
