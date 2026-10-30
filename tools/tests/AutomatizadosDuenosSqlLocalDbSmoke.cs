// tools/tests/AutomatizadosDuenosSqlLocalDbSmoke.cs - Automatizados SLA de
// Experiencia por dueño (handlers/experiencia_automatizados.ashx ->
// ExperienciaQueries.Automatizados -> DashboardQueries.AutomatizadosPorCategoria)
// contra SQL Server LocalDB, en una base TEMPORAL.
//
// NO forma parte del sitio: IIS no lo compila ni lo ejecuta nunca.
//
// Que prueba:
//   K) UNA llamada con los 10 SLOTs da, periodo a periodo, el
//      TicketsAutomatizados de DashboardQueries.Kpis (lo que pedia antes el
//      tablero, una llamada por SLOT) SIN los tipos SorIA: en Incidentes /
//      Requerimientos EXACTAMENTE Kpis; en Todos, Kpis menos los SorIA
//      resueltos por bot (con espacios alrededor del tipo tambien), y los
//      'Sin tipo' (NULL / vacio) siguen contando, como en el volumen. Kpis
//      (la tarjeta de SLA) sigue contando los SorIA. Un periodo sin ningun
//      resuelto no viene (Kpis: NULL).
//   M) Lo mismo por meses (enero..octubre de un año).
//   D) Con un filtro de Director / PO / Manager / SO (solos y combinados), la
//      suma de las filas de dueños que pasan el filtro (pasaFiltroGlobal) es
//      la cuenta de una verdad calculada AQUI desde la semilla: resueltos en
//      el periodo, no rechazados, por una cuenta de CatCuentaNoPersona
//      habilitada, del tipo, sin SorIA, con los dueños esperados de su categoria
//      (N2 exacto; si no, heredados del C1; Manager del SO).
//   U) Sin doble cuenta: por periodo, filas de dueños + tickets sin dueño =
//      total, y ninguna fila (periodo, dueños) repetida.
//   S) Ningun SorIA en las filas: la suma por Manager es la de la semilla sin
//      SorIA, y en Todos la semilla SI tiene SorIA de bot que quitar.
//   V) Rangos que no son periodos enteros se rechazan.
//
// Semilla: 3000 tickets deterministas (Random(20261030)) con categorias con
// N2 propio, heredadas del C1, sin dueño, vacias y con espacio duro; tipos
// con espacios; rechazados; sin firma de solucion; una cuenta del catalogo
// deshabilitada (cuenta como persona).
//
// La base temporal se crea y se borra en cada corrida; no toca la real.
//
// Compilar y correr desde la raiz del repo (PowerShell):
//   $csc = "$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
//   & $csc /nologo /out:<scratch>\AutomatizadosDuenos.exe /r:System.dll /r:System.Core.dll `
//       /r:System.Data.dll /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll `
//       App_Code\*.cs tools\tests\AutomatizadosDuenosSqlLocalDbSmoke.cs
//   AutomatizadosDuenos.exe.config junto al exe, con:
//     <connectionStrings><add name="TicketsProactivanet" connectionString=
//       "Server=(localdb)\MSSQLLocalDB;Initial Catalog=AutomatizadosDuenosSmoke;Integrated Security=true"/>
//   <scratch>\AutomatizadosDuenos.exe        # PASS/FAIL por caso, sale 0 si todo paso
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Linq;

public static class AutomatizadosDuenosSqlLocalDbSmoke
{
    static int fallos;

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = esperado == null ? "(null)" : Convert.ToString(esperado, CultureInfo.InvariantCulture);
        var o = obtenido == null ? "(null)" : Convert.ToString(obtenido, CultureInfo.InvariantCulture);
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    sealed class Ticket
    {
        public string Codigo, Tecnico, Tipo, Estado, Categoria;
        public DateTime Registro;
        public DateTime? Solucion;
        public string[] Duenos;   // director, po, manager, so (esperados)
    }

    static readonly string NBSP = ((char)160).ToString();
    static readonly DateTime HOY = new DateTime(2026, 10, 23);
    const string BOT = "Desk, Smart";

    // Categoria del ticket -> dueños ESPERADOS {director, po, manager, so}.
    // "/Alfa/Tres/Hoja" no tiene N2: hereda la PRIMERA fila de Alfa en el
    // orden de LeerDuenos (C1, vigente, CategoriaN2) = "/Alfa/Dos".
    static readonly object[][] CATEGORIAS =
    {
        new object[] { "/Alfa/Uno/Hoja", new[] { "Dir A", "PO Uno", "Mgr X", "SO Uno" } },
        new object[] { "/Alfa/Dos", new[] { "Dir A", "PO Dos", "Mgr Y", "SO Dos" } },
        new object[] { "/Alfa/Tres/Hoja", new[] { "Dir A", "PO Dos", "Mgr Y", "SO Dos" } },
        new object[] { "/Beta/Uno/Hoja", new[] { "Dir B", "PO Tres", "Mgr X", "SO Uno" } },
        new object[] { NBSP + "/Alfa/Uno/Otra ", new[] { "Dir A", "PO Uno", "Mgr X", "SO Uno" } },
        new object[] { "/Gamma/Uno", new string[] { null, null, null, null } },
        new object[] { "", new string[] { null, null, null, null } },
        new object[] { null, new string[] { null, null, null, null } },
    };
    static readonly string[] TECNICOS = { BOT, BOT, "Bot, Deshabilitado", "Perez, Ana", "Lopez, Beto" };
    static readonly string[] TIPOS = { "Incidencia", " Incidencia ", "Petición de Servicio", "Peticion de Servicio",
                                       "SorIA Incidentes", "SorIA Peticiones", " SorIA Peticiones ", "Otro", "", null };
    static readonly string[] SORIA = { "SorIA Incidentes", "SorIA Peticiones" };
    static readonly string[] ESTADOS = { "Cerrada", "Cerrada", "Resuelta", "Rechazada", null };

    static List<Ticket> Semilla()
    {
        var r = new Random(20261030);
        var lista = new List<Ticket>();
        for (int i = 0; i < 3000; i++)
        {
            var cat = CATEGORIAS[r.Next(CATEGORIAS.Length)];
            var t = new Ticket();
            t.Codigo = "T" + i.ToString("00000", CultureInfo.InvariantCulture);
            t.Categoria = (string)cat[0];
            t.Duenos = (string[])cat[1];
            t.Tecnico = TECNICOS[r.Next(TECNICOS.Length)];
            t.Tipo = TIPOS[r.Next(TIPOS.Length)];
            t.Estado = ESTADOS[r.Next(ESTADOS.Length)];
            // Firmas de 0 a 330 dias atras (y algunas a las 23:59, para los
            // bordes de dia); 1 de cada 10 sin firma.
            var dia = HOY.AddDays(-r.Next(331));
            t.Solucion = r.Next(10) == 0 ? (DateTime?)null
                : dia.AddMinutes(r.Next(3) == 0 ? 1439 : r.Next(1440));
            t.Registro = (t.Solucion ?? dia).AddDays(-r.Next(20));
            lista.Add(t);
        }
        return lista;
    }

    static readonly Dictionary<string, string[]> TIPO = new Dictionary<string, string[]>
    {
        { "todos", null },
        { "inc", new[] { "Incidencia" } },
        { "req", new[] { "Petición de Servicio", "Peticion de Servicio" } },
    };

    static bool EsSorIA(Ticket t) { return SORIA.Contains((t.Tipo ?? "").Trim()); }

    // La verdad, desde la semilla: lo que Kpis cuenta como automatizado
    // (sinSorIA = false) y lo que cuenta Experiencia (sinSorIA = true).
    static IEnumerable<Ticket> Resueltos(List<Ticket> s, DateTime ini, DateTime fin, string tipo, bool sinSorIA)
    {
        var tipos = TIPO[tipo];
        return s.Where(t => t.Solucion.HasValue && t.Solucion.Value.Date >= ini && t.Solucion.Value.Date <= fin
                         && t.Estado != "Rechazada"
                         && (tipos == null || tipos.Contains((t.Tipo ?? "").Trim()))
                         && !(sinSorIA && EsSorIA(t)));
    }

    static void Crear(string cadena, List<Ticket> semilla)
    {
        var b = new SqlConnectionStringBuilder(cadena);
        var nombre = b.InitialCatalog;
        b.InitialCatalog = "master";
        using (var cn = new SqlConnection(b.ConnectionString))
        {
            cn.Open();
            Ejecutar(cn, "IF DB_ID(N'" + nombre + "') IS NOT NULL BEGIN ALTER DATABASE [" + nombre +
                "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + nombre + "]; END; CREATE DATABASE [" + nombre + "];");
        }
        using (var cn = new SqlConnection(cadena))
        {
            cn.Open();
            // Las columnas que leen Kpis y AutomatizadosPorCategoria.
            Ejecutar(cn, @"
CREATE TABLE dbo.vw_Dash_ProductividadBase (
    CodigoTicket NVARCHAR(50) NOT NULL, FechaRegistro DATETIME NOT NULL, FechaRegistroDia DATE NOT NULL,
    FechaEstimadaResolucion DATETIME NULL, FechaFirmaSolucion DATETIME NULL,
    Grupo NVARCHAR(200) NULL, Tecnico NVARCHAR(200) NULL, Estado NVARCHAR(100) NULL,
    Prioridad NVARCHAR(50) NULL, Tipo NVARCHAR(100) NULL, Categoria NVARCHAR(500) NULL,
    IntentosSolucion INT NULL, EstaCerrado BIT NULL, EstaAbierto BIT NULL,
    HorasCiclo DECIMAL(18,2) NULL, ReasignacionesGrupo INT NULL);
CREATE TABLE dbo.Tickets (CodigoTicket NVARCHAR(50) PRIMARY KEY, TiempoPrimeraRespuestaHorasMin NVARCHAR(20) NULL);
CREATE TABLE dbo.CatCuentaNoPersona (Cuenta NVARCHAR(200) NOT NULL, Habilitado BIT NOT NULL);
CREATE TABLE dbo.EtlLog (Proceso NVARCHAR(100) NOT NULL, Fin DATETIME NULL);
CREATE TABLE dbo.CatCategoriaDueno (CategoriaN2 NVARCHAR(500) NULL, C1 NVARCHAR(500) NULL,
    ProductOwner NVARCHAR(200) NULL, ServiceOwner NVARCHAR(200) NULL, DirectorPO NVARCHAR(200) NULL,
    VigenteEnOrigen BIT NULL);
CREATE TABLE dbo.CatPersona (Nombre NVARCHAR(200) NULL, Manager NVARCHAR(200) NULL, VigenteEnOrigen BIT NULL);
INSERT dbo.CatCuentaNoPersona VALUES (N'Desk, Smart', 1), (N'Bot, Deshabilitado', 0);
INSERT dbo.EtlLog VALUES (N'Proactivanet tickets', '2026-10-23T06:00:00');
INSERT dbo.CatCategoriaDueno VALUES
    (N'/Alfa/Uno', N'Alfa', N'PO Uno', N'SO Uno', N'Dir A', 1),
    (N'/Alfa/Dos', N'Alfa', N'PO Dos', N'SO Dos', N'Dir A', 1),
    (N'/Beta/Uno', N'Beta', N'PO Tres', N'SO Uno', N'Dir B', 1);
INSERT dbo.CatPersona VALUES (N'SO Uno', N'Mgr X', 1), (N'SO Dos', N'Mgr Y', 1);");

            var tabla = new DataTable();
            foreach (var c in new[] { "CodigoTicket", "FechaRegistro", "FechaRegistroDia", "FechaEstimadaResolucion",
                "FechaFirmaSolucion", "Grupo", "Tecnico", "Estado", "Prioridad", "Tipo", "Categoria",
                "IntentosSolucion", "EstaCerrado", "EstaAbierto", "HorasCiclo", "ReasignacionesGrupo" })
                tabla.Columns.Add(c, typeof(object));
            foreach (var t in semilla)
                tabla.Rows.Add(t.Codigo, t.Registro, t.Registro.Date, t.Registro.AddDays(3),
                    (object)t.Solucion ?? DBNull.Value, "Grupo", t.Tecnico, (object)t.Estado ?? DBNull.Value,
                    "Media", (object)t.Tipo ?? DBNull.Value, (object)t.Categoria ?? DBNull.Value, 1, true, false, 1.5m, 0);
            using (var bulk = new SqlBulkCopy(cn))
            {
                bulk.DestinationTableName = "dbo.vw_Dash_ProductividadBase";
                bulk.WriteToServer(tabla);
            }
        }
    }

    static void Ejecutar(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn)) cmd.ExecuteNonQuery();
    }

    static long? Kpis(DateTime ini, DateTime fin, string tipo)
    {
        var f = new DashboardQueries.Filtros();
        f.FechaInicio = ini;
        f.FechaFin = fin;
        f.TiposRegistro = DashboardQueries.TipoRegistroSla.Valores(tipo);
        var fila = DashboardQueries.Kpis(f);
        object v;
        return fila.TryGetValue("TicketsAutomatizados", out v) && v != null
            ? (long?)Convert.ToInt64(v, CultureInfo.InvariantCulture) : null;
    }

    static Dictionary<string, object> Pedir(string modo, DateTime ini, DateTime fin, string tipo)
    {
        return ExperienciaQueries.Automatizados(modo, ini, fin, DashboardQueries.TipoRegistroSla.Valores(tipo));
    }

    static IEnumerable<Dictionary<string, object>> Filas(Dictionary<string, object> r, string llave)
    {
        return ((List<object>)r[llave]).Cast<Dictionary<string, object>>();
    }

    static long? TotalDe(Dictionary<string, object> r, int periodo)
    {
        var p = Filas(r, "periodos").FirstOrDefault(x => (int)x["periodo"] == periodo);
        return p == null ? (long?)null : (int)p["automatizados"];
    }

    // pasaFiltroGlobal de experiencia.js: vacio no restringe; puesto exige igualdad.
    static bool Pasa(string[] filtro, string director, string po, string manager, string so)
    {
        return (filtro[0] == null || filtro[0] == director) && (filtro[1] == null || filtro[1] == po)
            && (filtro[2] == null || filtro[2] == manager) && (filtro[3] == null || filtro[3] == so);
    }

    static string Lista(IEnumerable<long?> v)
    {
        return string.Join(",", v.Select(x => x.HasValue ? x.Value.ToString(CultureInfo.InvariantCulture) : "null"));
    }

    public static int Main()
    {
        var cadena = ConfigurationManager.ConnectionStrings["TicketsProactivanet"].ConnectionString;
        var semilla = Semilla();
        Crear(cadena, semilla);

        var FILTROS = new[]
        {
            new[] { "Dir A", null, null, null }, new[] { "Dir B", null, null, null },
            new[] { null, "PO Uno", null, null }, new[] { null, "PO Dos", null, null },
            new[] { null, null, "Mgr X", null }, new[] { null, null, null, "SO Dos" },
            new[] { "Dir A", null, null, "SO Uno" }, new[] { "Dir A", "PO Dos", "Mgr Y", "SO Dos" },
            new[] { "Dir B", "PO Uno", null, null },
        };

        foreach (var modo in new[] { "slot", "mes" })
        {
            var periodos = modo == "slot" ? Enumerable.Range(0, 10).ToArray() : Enumerable.Range(1, 10).ToArray();
            Func<int, DateTime> ini = p => modo == "slot" ? HOY.AddDays(-30 * p - 29) : new DateTime(2026, p, 1);
            Func<int, DateTime> fin = p => modo == "slot" ? HOY.AddDays(-30 * p)
                : new DateTime(2026, p, DateTime.DaysInMonth(2026, p));
            var desde = periodos.Select(ini).Min();
            var hasta = periodos.Select(fin).Max();

            foreach (var tipo in new[] { "todos", "inc", "req" })
            {
                var r = Pedir(modo, desde, hasta, tipo);
                var caso = modo + " " + tipo;

                // K/M) contra Kpis, periodo a periodo, y contra la semilla.
                var km = modo == "slot" ? "K " : "M ";
                var kpis = periodos.Select(p => Kpis(ini(p), fin(p), tipo)).ToList();
                var nuevos = periodos.Select(p => TotalDe(r, p)).ToList();
                Func<bool, List<long?>> verdadDe = sinSorIA => periodos.Select(p =>
                {
                    var res = Resueltos(semilla, ini(p), fin(p), tipo, sinSorIA).ToList();
                    return res.Count == 0 ? (long?)null : res.Count(t => t.Tecnico == BOT);
                }).ToList();
                Chk(km + caso + ": Kpis (SLA) sin cambio = la semilla CON SorIA", Lista(verdadDe(false)), Lista(kpis));
                Chk(km + caso + ": Experiencia = la semilla sin SorIA", Lista(verdadDe(true)), Lista(nuevos));
                Chk(km + caso + ": hay automatizados que comparar", true, nuevos.Any(v => v.HasValue && v.Value > 0));
                long sorBot = periodos.Sum(p => (long)Resueltos(semilla, ini(p), fin(p), tipo, false)
                    .Count(t => t.Tecnico == BOT && EsSorIA(t)));
                if (tipo == "todos")
                {
                    Chk(km + caso + ": la semilla tiene SorIA de bot (con y sin espacios) que quitar", true,
                        sorBot > 0 && semilla.Any(t => t.Tipo == " SorIA Peticiones " && t.Tecnico == BOT && t.Solucion.HasValue));
                    Chk(km + caso + ": Kpis - Experiencia = los SorIA de bot", sorBot,
                        kpis.Sum(v => v ?? 0) - nuevos.Sum(v => v ?? 0));
                    Chk(km + caso + ": los 'Sin tipo' (NULL / vacio) de bot siguen contando", true,
                        periodos.Sum(p => (long)Resueltos(semilla, ini(p), fin(p), tipo, true)
                            .Count(t => t.Tecnico == BOT && string.IsNullOrWhiteSpace(t.Tipo))) > 0);
                }
                else
                {
                    Chk(km + caso + ": con tipo, Experiencia = Kpis (sin cambio)", Lista(kpis), Lista(nuevos));
                }

                // U) sin doble cuenta ni filas repetidas.
                var duenos = Filas(r, "duenos").ToList();
                var llaves = duenos.Select(d => d["periodo"] + "|" + d["director"] + "|" + d["po"] + "|" + d["manager"] + "|" + d["so"]).ToList();
                Chk("U " + caso + ": ninguna fila (periodo, dueños) repetida", llaves.Count, llaves.Distinct().Count());
                // La fila sin dueños (todo null) es la de los tickets sin
                // categoria o sin dueño capturado: entra en el total.
                var cuadra = periodos.Select(p =>
                {
                    var delPeriodo = duenos.Where(d => (int)d["periodo"] == p).ToList();
                    long suma = delPeriodo.Sum(d => (long)(int)d["automatizados"]);
                    long sinDueno = delPeriodo.Where(d => d["director"] == null && d["po"] == null && d["so"] == null)
                        .Sum(d => (long)(int)d["automatizados"]);
                    long sinDuenoSemilla = Resueltos(semilla, ini(p), fin(p), tipo, true).Count(t => t.Tecnico == BOT && t.Duenos[0] == null);
                    return (TotalDe(r, p) ?? 0) == suma && sinDueno == sinDuenoSemilla;
                });
                Chk("U " + caso + ": suma de filas de dueños = total y la fila sin dueño = la semilla", true, cuadra.All(x => x));

                // D) cada filtro contra la semilla.
                foreach (var fil in FILTROS)
                {
                    var obtenido = periodos.Select(p => TotalDe(r, p).HasValue
                        ? (long?)duenos.Where(d => (int)d["periodo"] == p
                              && Pasa(fil, d["director"] as string, d["po"] as string, d["manager"] as string, d["so"] as string))
                            .Sum(d => (long)(int)d["automatizados"])
                        : null);
                    var esperado = periodos.Select(p =>
                    {
                        var res = Resueltos(semilla, ini(p), fin(p), tipo, true).ToList();
                        return res.Count == 0 ? (long?)null
                            : res.Count(t => t.Tecnico == BOT && Pasa(fil, t.Duenos[0], t.Duenos[1], t.Duenos[2], t.Duenos[3]));
                    });
                    Chk("D " + caso + " [" + string.Join("|", fil.Select(x => x ?? "")) + "]", Lista(esperado), Lista(obtenido));
                }
            }
        }

        // V) rangos invalidos.
        Action<string, string, DateTime, DateTime> rechaza = (caso, modo, a, b) =>
        {
            string err = null;
            try { ExperienciaQueries.ValidarRangoAutomatizados(modo, a, b); } catch (ArgumentException e) { err = e.Message; }
            Chk("V " + caso, true, err != null);
        };
        rechaza("SLOT de 29 dias", "slot", HOY.AddDays(-28), HOY);
        rechaza("13 SLOTs", "slot", HOY.AddDays(-389), HOY);
        rechaza("inicio > fin", "slot", HOY, HOY.AddDays(-29));
        rechaza("mes que no empieza el 1", "mes", new DateTime(2026, 1, 2), new DateTime(2026, 2, 28));
        rechaza("mes que no acaba el ultimo dia", "mes", new DateTime(2026, 1, 1), new DateTime(2026, 2, 27));
        rechaza("meses de dos años", "mes", new DateTime(2025, 12, 1), new DateTime(2026, 1, 31));
        rechaza("modo desconocido", "rango", HOY.AddDays(-29), HOY);
        string ok = null;
        try { ExperienciaQueries.ValidarRangoAutomatizados("slot", HOY.AddDays(-299), HOY); } catch (ArgumentException e) { ok = e.Message; }
        Chk("V 10 SLOTs se aceptan", null, ok);

        Console.WriteLine(fallos == 0 ? "\nTodo paso" : "\n" + fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }
}
