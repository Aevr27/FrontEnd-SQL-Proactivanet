// tools/tests/TzSmoke.cs - prueba de humo de la zona horaria del sello.
//
// NO forma parte del sitio: vive fuera de App_Code y de handlers/, asi que
// IIS no lo compila ni lo ejecuta nunca. Es una comprobacion manual de
// DashboardDataInfo con valores conocidos, sin tocar SQL Server.
//
// Como correrla (PowerShell, desde la raiz del repositorio):
//
//   $csc = "$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
//   $ref = Split-Path $csc
//   & $csc /nologo /out:tz.exe `
//       /r:"$ref\System.Web.dll" /r:"$ref\System.Web.Extensions.dll" `
//       /r:"$ref\System.Configuration.dll" /r:"$ref\System.Data.dll" `
//       App_Code\*.cs tools\tests\TzSmoke.cs
//   .\tz.exe    # imprime PASS/FAIL por caso y devuelve 0 si todo paso
//
using System;
using System.Collections.Generic;

public static class TzSmoke
{
    static int fallos;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : esperado.ToString();
        var o = obtenido == null ? "(null)" : obtenido.ToString();
        var ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + "  esperado=" + e + "  obtenido=" + o);
    }

    public static int Main()
    {
        // 1) Un instante guardado de verdad en UTC sigue pasando a UTC-06.
        var backlog = DashboardDataInfo.Corte(
            "Backlog", new DateTime(2026, 9, 14, 14, 46, 22), ZonaSello.Utc, "fuente");
        Check("Utc 14:46:22 -> UTC-06", "2026-09-14T08:46:22", backlog.AJson()["ultimaActualizacion"]);

        // 1b) Backlog: FechaHoraSnapshot (DEFAULT sysdatetime()) ya esta en
        //     la hora local del SQL Server y va como YaLocal: 09:15 es 09:15.
        var blLocal = DashboardDataInfo.Corte(
            "Backlog", new DateTime(2026, 10, 26, 9, 15, 0), ZonaSello.YaLocal, "fuente");
        Check("Backlog 09:15 local intacto", "2026-10-26T09:15:00", blLocal.AJson()["ultimaActualizacion"]);

        // 2) Experiencia: MAX(FechaUltimaCargaDW) ya local, va como YaLocal:
        //    sin restar seis horas, y su periodo (fechas de negocio) intacto.
        var hoy = DashboardDataInfo.HoyEnPresentacion();
        var exp = DashboardDataInfo.Periodo(
            "Experiencia al Usuario", new DateTime(2026, 10, 26, 9, 15, 0), ZonaSello.YaLocal,
            hoy.AddDays(-30), hoy, "fuente");
        var expJson = exp.AJson();
        Check("Experiencia 09:15 local intacto", "2026-10-26T09:15:00", expJson["ultimaActualizacion"]);
        Check("Experiencia periodoInicio", hoy.AddDays(-30).ToString("yyyy-MM-dd"), expJson["periodoInicio"]);
        Check("Experiencia periodoFin", hoy.ToString("yyyy-MM-dd"), expJson["periodoFin"]);
        Check("Experiencia tipoPeriodo", "rodante30", expJson["tipoPeriodo"]);

        // 2b) fecha_actualizacion sale del mismo SelloParaMostrar: una carga
        //     local a las 03:00 sigue siendo de ese dia (como Utc caia en el
        //     anterior, 21:00).
        var madrugada = DashboardDataInfo.Periodo(
            "Experiencia al Usuario", new DateTime(2026, 10, 26, 3, 0, 0), ZonaSello.YaLocal,
            hoy.AddDays(-30), hoy, "fuente");
        Check("Experiencia fecha_actualizacion mismo dia", "26/10/2026",
            madrugada.SelloParaMostrar().Value.ToString("dd/MM/yyyy"));

        // 2c) Las llamadas reales declaran YaLocal (Backlog, Experiencia).
        var fuenteDb = System.IO.File.ReadAllText(@"App_Code\DashboardDb.cs");
        var fuenteExp = System.IO.File.ReadAllText(@"App_Code\ExperienciaQueries.cs");
        Check("DashboardDb Backlog YaLocal", true,
            fuenteDb.Contains("\"Backlog\", sello, ZonaSello.YaLocal,"));
        Check("ExperienciaQueries YaLocal", true,
            System.Text.RegularExpressions.Regex.IsMatch(fuenteExp,
                @"""Experiencia al Usuario"",\s*corte,\s*ZonaSello\.YaLocal,"));

        // 3) Cruce de dia: 02:30 UTC del 15 es el 14 a las 20:30 en UTC-06.
        var cruce = DashboardDataInfo.Corte(
            "Backlog", new DateTime(2026, 9, 15, 2, 30, 0), ZonaSello.Utc, "fuente");
        Check("Cruce de dia 15 02:30 UTC", "2026-09-14T20:30:00", cruce.AJson()["ultimaActualizacion"]);

        // 4) Fecha de negocio (DATE, sin hora): NO se convierte ni gana hora.
        var soloFecha = DashboardDataInfo.Corte(
            "Backlog", new DateTime(2026, 9, 14), ZonaSello.Utc, "fuente");
        Check("DATE sin hora", "2026-09-14", soloFecha.AJson()["ultimaActualizacion"]);
        var textoFecha = DashboardDataInfo.Corte("Backlog", "2026-09-14", ZonaSello.Utc, "fuente");
        Check("Texto yyyy-MM-dd", "2026-09-14", textoFecha.AJson()["ultimaActualizacion"]);

        // 5) YaLocal: no se toca (snapshot de QA).
        var yaLocal = DashboardDataInfo.Corte(
            "QA", "2026-09-14T14:46:22", ZonaSello.YaLocal, "fuente");
        Check("YaLocal intacto", "2026-09-14T14:46:22", yaLocal.AJson()["ultimaActualizacion"]);

        // 5b) SLA / QA / QARE: dbo.EtlLog.Fin ya esta en la hora local del SQL
        //     Server (UTC-06) y va como YaLocal: meta dice MAX(Fin) tal cual,
        //     sin restar otras seis horas (como Utc salia 03:15).
        var etl = DashboardDataInfo.Periodo(
            "SLA y productividad", new DateTime(2026, 10, 26, 9, 15, 0), ZonaSello.YaLocal,
            "2026-09-26", "2026-10-25", "dbo.EtlLog (Proactivanet tickets)");
        Check("ETL tickets = MAX(Fin)", "2026-10-26T09:15:00", etl.AJson()["ultimaActualizacion"]);

        // 6) Sin sello: null, nunca la hora actual.
        var vacio = DashboardDataInfo.Corte("Backlog", null, ZonaSello.Utc, "fuente");
        Check("Sin sello", null, vacio.AJson()["ultimaActualizacion"]);
        Check("Sin sello, sin periodo", null, vacio.AJson()["periodoInicio"]);

        // 7) El valor autoritativo interno NO se muta.
        Check("Sello crudo intacto", "2026-09-14 14:46:22",
            backlog.UltimaActualizacion.Value.ToString("yyyy-MM-dd HH:mm:ss"));

        Console.WriteLine(fallos == 0 ? "TODO OK" : (fallos + " FALLOS"));
        return fallos;
    }
}
