// tools/tests/TiATiSqlLocalDbSmoke.cs - el SQL de "TI a TI" (TicketTIaTI.Clase
// y Predicado) contra SQL Server LocalDB, en una base DESECHABLE que se crea y
// se borra en cada corrida. Nunca toca QA.
//
// TiATiExperienciaSmoke.js prueba la pestana con datos inventados, pero no
// ejecuta el SQL; el arnes de Docker que lo hacia no esta en este
// repositorio. Esta prueba cubre ese hueco con una semilla escrita a mano:
// cada ticket lleva la clase que la regla le debe dar (0 no, 1 si, 2 si y de
// permisos), asi que la verdad no es una segunda copia de la regla.
//
// LIMITE DECLARADO: fn_NormalizaCategoria, fn_CategoriaC1 y
// vw_TicketsSlotsBase son las de VolumenTiposVistasSqlLocalDbSmoke.cs (copia
// de "Descargar script v2 usando vw_Tickets.sql"); vw_TicketsMesBase y
// vw_Dash_ProductividadBase son REPLICAS con solo las columnas que se leen.
// La colacion es la de la instancia LocalDB; que QA compare igual lo dice la
// prueba en QA de experiencia/INSTALAR_TI_A_TI.md, no esta.
//
// Casos:
//   X1 el export (ConsultaExport) trae la columna 27 "TiATi" (indice 26, el
//      que lee LeerTicketsExport) con la clase esperada de cada ticket;
//   X2 LeerTIaTI (el volumen de experiencia_ti.ashx) por SLOT y por mes:
//      Ti y TiPermisos por categoria = la semilla;
//   X3 Predicado sobre las columnas de los automatizados: Todos no agrega
//      nada; SinTI deja solo la clase 0; dejando permisos, todo menos la 1;
//   X4 Quita (C#, la del export) decide lo mismo que Predicado (SQL).
//
// Compilar y correr desde la raiz del repo (PowerShell):
//   $csc = "$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
//   & $csc /nologo /out:<scratch>\TiATiSql.exe /r:System.dll /r:System.Core.dll `
//       /r:System.Data.dll /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll `
//       App_Code\*.cs tools\tests\TiATiSqlLocalDbSmoke.cs
//   <scratch>\TiATiSql.exe        # PASS/FALLA por caso, sale 0 si todo paso
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.Linq;
using System.Reflection;

public static class TiATiSqlLocalDbSmoke
{
    const string Instancia = @"(localdb)\MSSQLLocalDB";
    static int fallos;

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection("Server=" + Instancia + ";Integrated Security=true;Database=" + db + ";");
        cn.Open();
        return cn;
    }

    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn)) { c.CommandTimeout = 120; c.ExecuteNonQuery(); } }

    static void Chk(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado, CultureInfo.InvariantCulture);
        var o = Convert.ToString(obtenido, CultureInfo.InvariantCulture);
        bool ok = e == o;
        if (!ok) fallos++;
        Console.WriteLine((ok ? "PASS   " : "FALLA  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    const string FN_NORMALIZA = @"
CREATE FUNCTION dbo.fn_NormalizaCategoria (@Categoria NVARCHAR(500))
RETURNS NVARCHAR(500)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(500) = LTRIM(RTRIM(REPLACE(ISNULL(@Categoria,N''), NCHAR(160), N' ')));
    RETURN @s;
END;";

    const string FN_C1 = @"
CREATE FUNCTION dbo.fn_CategoriaC1 (@Categoria NVARCHAR(500))
RETURNS NVARCHAR(500)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(500) = dbo.fn_NormalizaCategoria(@Categoria);
    DECLARE @start INT, @next INT;

    IF @s = N'' RETURN N'';
    SET @start = CASE WHEN LEFT(@s,1) = N'/' THEN 2 ELSE 1 END;
    SET @next = CHARINDEX(N'/', @s, @start);

    IF @next = 0 RETURN LTRIM(RTRIM(SUBSTRING(@s, @start, 500)));
    RETURN LTRIM(RTRIM(SUBSTRING(@s, @start, @next - @start)));
END;";

    // dbo.Tickets es la tabla; vw_Tickets la expone tal cual (el export lee
    // la vista; LeerTIaTI, la tabla).
    const string TABLA = @"
CREATE TABLE dbo.Tickets (
    CodigoTicket NVARCHAR(30) NOT NULL PRIMARY KEY, FechaRegistro DATETIME NULL, Slot INT NULL,
    Categoria NVARCHAR(500) NULL, TipoRelacion NVARCHAR(100) NULL, Tipo NVARCHAR(100) NULL,
    Estado NVARCHAR(50) NULL, Subestado NVARCHAR(50) NULL, Grupo NVARCHAR(100) NULL,
    TecnicoSegundaLinea NVARCHAR(100) NULL, Cliente NVARCHAR(255) NULL, Tienda NVARCHAR(500) NULL,
    Titulo NVARCHAR(200) NULL, Descripcion NVARCHAR(MAX) NULL, SolucionUsuario NVARCHAR(MAX) NULL,
    FechaEstimadaResolucion DATETIME NULL, Prioridad NVARCHAR(50) NULL, Sucursal NVARCHAR(200) NULL,
    FechaFirmaSolucion DATETIME NULL, FechaUltimaModificacion DATETIME NULL, FechaFirmaCierre DATETIME NULL,
    FirmaCierreRevocacion NVARCHAR(50) NULL, FirmaSolucion NVARCHAR(50) NULL,
    ResponsableUltimaModificacion NVARCHAR(200) NULL, NotificadoPor NVARCHAR(200) NULL,
    RegistradoPor NVARCHAR(200) NULL);";

    const string VW_TICKETS = "CREATE VIEW dbo.vw_Tickets AS SELECT * FROM dbo.Tickets;";

    const string VW_SLOTS_BASE = @"
CREATE VIEW dbo.vw_TicketsSlotsBase
AS
SELECT
    t.CodigoTicket, t.FechaRegistro, Slot = t.Slot,
    CategoriaV2 = dbo.fn_NormalizaCategoria(t.Categoria),
    C1          = dbo.fn_CategoriaC1(t.Categoria),
    C1C2        = CONVERT(NVARCHAR(500), NULL),
    TipoRelacion = ISNULL(NULLIF(LTRIM(RTRIM(t.TipoRelacion)), N''), N'Sin tipo relacion'),
    TipoTicket    = ISNULL(NULLIF(LTRIM(RTRIM(t.Tipo)), N''), N'Sin tipo'),
    t.Estado, t.Grupo, t.Tienda
FROM dbo.vw_Tickets AS t
WHERE t.FechaRegistro IS NOT NULL AND t.Slot IS NOT NULL;";

    // REPLICA: 09_slots_por_mes.sql no esta en ningun repositorio.
    const string VW_MES_BASE = @"
CREATE VIEW dbo.vw_TicketsMesBase
AS
SELECT
    t.CodigoTicket, t.FechaRegistro, Anio = YEAR(t.FechaRegistro), Mes = MONTH(t.FechaRegistro),
    CategoriaV2 = dbo.fn_NormalizaCategoria(t.Categoria),
    C1          = dbo.fn_CategoriaC1(t.Categoria),
    C1C2        = CONVERT(NVARCHAR(500), NULL),
    TipoRelacion = ISNULL(NULLIF(LTRIM(RTRIM(t.TipoRelacion)), N''), N'Sin tipo relacion'),
    TipoTicket    = ISNULL(NULLIF(LTRIM(RTRIM(t.Tipo)), N''), N'Sin tipo'),
    t.Estado, t.Grupo
FROM dbo.vw_Tickets AS t
WHERE t.FechaRegistro IS NOT NULL;";

    // REPLICA: solo las columnas que pasa DashboardQueries.Predicados.
    const string VW_PRODUCTIVIDAD = @"
CREATE VIEW dbo.vw_Dash_ProductividadBase
AS
SELECT t.CodigoTicket, t.Tipo, t.Categoria, t.Cliente, t.Tienda FROM dbo.Tickets AS t;";

    sealed class Semilla
    {
        public string Codigo, Cat, Tipo, Cliente, Tienda, Porque;
        public int Slot, Clase;
        public DateTime Fecha;
    }

    const string TI = "/S-Servicios TI/Correo";
    const string RED = "/Red/LAN";
    const string PERM = "/S-Acceso Aplicaciones - Permisos/SAP";

    static List<Semilla> Semillas()
    {
        var nov = new DateTime(2026, 11, 5);
        var oct = new DateTime(2026, 10, 10);
        var s = new List<Semilla>();
        Action<string, string, string, string, int, string, int, DateTime> add = (cat, tipo, cliente, tienda, clase, porque, slot, fecha) =>
            s.Add(new Semilla { Codigo = "T" + (s.Count + 1).ToString("00", CultureInfo.InvariantCulture), Cat = cat, Tipo = tipo,
                Cliente = cliente, Tienda = tienda, Clase = clase, Porque = porque, Slot = slot, Fecha = fecha });

        add(TI, "Petición de Servicio", "Soriana", "123 Centro", 1, "S-Servicios TI aunque lo notifique una tienda", 0, nov);
        add(TI, "Peticion de Servicio", null, null, 1, "S-Servicios TI, tipo sin tilde", 0, nov);
        add("/s-servicios ti/Otro", " PETICION DE SERVICIO ", null, null, 1, "C1 y tipo sin mayusculas y con espacios", 0, nov);
        add(TI, "Incidencia", "OAT", null, 0, "incidencia de S-Servicios TI", 0, nov);
        add(TI, "SorIA Peticiones", "OAT", null, 0, "SorIA Peticiones no cuenta", 0, nov);
        add(RED, "Petición de Servicio", "OAT", @"SORIANA\jperez", 1, "OAT con cuenta de dominio", 0, nov);
        add(RED, "Petición de Servicio", "Cliente oat Norte", "Perez, Ana", 1, "cliente que contiene oat, persona", 0, nov);
        add(RED, "Petición de Servicio", "OAT", null, 1, "OAT sin tienda (NULL no es tienda)", 0, nov);
        add(RED, "Petición de Servicio", "OAT", "Cadena Sur", 1, "'Cadena' no es Cad[ 0-9]", 0, nov);
        add(RED, "Petición de Servicio", "OAT", "123 Tienda", 0, "OAT de tienda (numero)", 0, nov);
        add(RED, "Petición de Servicio", "OAT", "City Club 45", 0, "OAT de City Club", 0, nov);
        add(RED, "Petición de Servicio", "OAT", "Cedis Monterrey", 0, "OAT de CEDIS", 0, nov);
        add(RED, "Petición de Servicio", "OAT", "Cad 3", 0, "OAT de CAD", 0, nov);
        add(RED, "Petición de Servicio", "OAT", "Oficina 7", 0, "digito sin '\\' cuenta como tienda", 0, nov);
        add(RED, "Petición de Servicio", null, @"SORIANA\x", 0, "cliente NULL no es OAT", 0, nov);
        add(RED, "Petición de Servicio", "Soriana", @"SORIANA\x", 0, "otro cliente", 0, nov);
        add(PERM, "Petición de Servicio", "OAT", @"SORIANA\x", 2, "permisos por OAT", 0, nov);
        add(PERM, "Petición de Servicio", "OAT", null, 2, "permisos por OAT sin tienda", 0, nov);
        add(PERM, "Petición de Servicio", "OAT", "123", 0, "permisos de tienda", 0, nov);
        add(PERM, "Incidencia", "OAT", null, 0, "incidencia de permisos", 0, nov);
        add(TI, "Petición de Servicio", null, null, 1, "SLOT 1 / octubre", 1, oct);
        add(PERM, "Petición de Servicio", "OAT", null, 2, "SLOT 1 / octubre, permisos", 1, oct);
        return s;
    }

    public static int Main()
    {
        var semilla = Semillas();
        var db = "TiATiPrueba_" + Guid.NewGuid().ToString("N").Substring(0, 8);
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + db + "]");
        try
        {
            using (var cn = Abrir(db))
            {
                foreach (var ddl in new[] { TABLA, VW_TICKETS, FN_NORMALIZA, FN_C1, VW_SLOTS_BASE, VW_MES_BASE, VW_PRODUCTIVIDAD })
                    Exec(cn, ddl);
                foreach (var t in semilla)
                    using (var c = new SqlCommand("INSERT dbo.Tickets (CodigoTicket, FechaRegistro, Slot, Categoria, Tipo, Cliente, Tienda) " +
                                                  "VALUES (@c, @f, @s, @cat, @t, @cl, @ti)", cn))
                    {
                        c.Parameters.AddWithValue("@c", t.Codigo);
                        c.Parameters.AddWithValue("@f", t.Fecha);
                        c.Parameters.AddWithValue("@s", t.Slot);
                        c.Parameters.AddWithValue("@cat", t.Cat);
                        c.Parameters.AddWithValue("@t", (object)t.Tipo ?? DBNull.Value);
                        c.Parameters.AddWithValue("@cl", (object)t.Cliente ?? DBNull.Value);
                        c.Parameters.AddWithValue("@ti", (object)t.Tienda ?? DBNull.Value);
                        c.ExecuteNonQuery();
                    }

                Export(cn, semilla);
                Volumen(cn, semilla);
                Predicado(cn, semilla);
            }
        }
        finally
        {
            SqlConnection.ClearAllPools();
            using (var m = Abrir("master"))
                Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
        }

        Console.WriteLine(fallos == 0 ? "\nTODO OK" : "\n" + fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }

    static MethodInfo Privado(string nombre)
    {
        return typeof(ExperienciaQueries).GetMethod(nombre, BindingFlags.NonPublic | BindingFlags.Static);
    }

    // X1: la clase que LeerTicketsExport lee en GetValue(26).
    static void Export(SqlConnection cn, List<Semilla> semilla)
    {
        var sql = (string)Privado("ConsultaExport").Invoke(null, new object[] { ExperienciaQueries.MODO_SLOT });
        using (var cmd = new SqlCommand(sql, cn))
        {
            TicketTIaTI.Parametros(cmd);
            using (var rd = cmd.ExecuteReader())
            {
                Chk("X1 la columna 26 del export es TiATi", "TiATi", rd.GetName(26));
                var clase = new Dictionary<string, int>();
                while (rd.Read()) clase[rd.GetString(0)] = Convert.ToInt32(rd.GetValue(26), CultureInfo.InvariantCulture);
                foreach (var t in semilla.Where(x => x.Slot == 0))
                {
                    int v;
                    Chk("X1 " + t.Codigo + " " + t.Porque, t.Clase, clase.TryGetValue(t.Codigo, out v) ? v : -1);
                }
            }
        }
    }

    // X2: lo que experiencia_ti.ashx resta por categoria.
    static void Volumen(SqlConnection cn, List<Semilla> semilla)
    {
        var leer = Privado("LeerTIaTI");
        foreach (var porMes in new[] { false, true })
        {
            var filas = (IList)leer.Invoke(null, new object[] { cn, porMes, 2026 });
            var obtenido = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (var f in filas)
            {
                var tp = f.GetType();
                var llave = tp.GetField("Periodo").GetValue(f) + "|" + tp.GetField("Llave").GetValue(f);
                obtenido.Add(llave, tp.GetField("Ti").GetValue(f) + "/" + tp.GetField("TiPermisos").GetValue(f));
            }
            var esperado = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (var g in semilla.Where(t => t.Clase != 0)
                                     .GroupBy(t => (porMes ? t.Fecha.Month : t.Slot) + "|" + t.Cat.Trim()))
                esperado.Add(g.Key, g.Count() + "/" + g.Count(t => t.Clase == 2));
            Func<SortedDictionary<string, string>, string> txt = d => string.Join("; ", d.Select(kv => kv.Key + "=" + kv.Value));
            Chk("X2 " + (porMes ? "mes" : "SLOT") + ": Ti/TiPermisos por categoria", txt(esperado), txt(obtenido));
        }
    }

    // X3 / X4: las mismas columnas que DashboardQueries.Predicados.
    static void Predicado(SqlConnection cn, List<Semilla> semilla)
    {
        foreach (TicketTIaTI.Modo modo in Enum.GetValues(typeof(TicketTIaTI.Modo)))
        {
            using (var cmd = new SqlCommand())
            {
                cmd.Connection = cn;
                var p = TicketTIaTI.Predicado(cmd, modo, "b.Tipo", "dbo.fn_CategoriaC1(b.Categoria)", "b.Cliente", "b.Tienda");
                if (modo == TicketTIaTI.Modo.Todos)
                    Chk("X3 Todos no agrega predicado ni parametros", "|0", p + "|" + cmd.Parameters.Count);
                cmd.CommandText = "SELECT b.CodigoTicket FROM dbo.vw_Dash_ProductividadBase AS b WHERE 1 = 1" + p +
                                  " ORDER BY b.CodigoTicket";
                var quedan = new List<string>();
                using (var rd = cmd.ExecuteReader()) while (rd.Read()) quedan.Add(rd.GetString(0));

                var porSql = string.Join(",", quedan);
                var porCs = string.Join(",", semilla.Where(t => !TicketTIaTI.Quita(modo, t.Clase)).Select(t => t.Codigo).OrderBy(c => c, StringComparer.Ordinal));
                Chk("X3/X4 " + modo + ": Predicado (SQL) deja lo mismo que Quita (C#)", porCs, porSql);
            }
        }
        Chk("X3 la semilla tiene de las tres clases", "True|True|True",
            semilla.Any(t => t.Clase == 0) + "|" + semilla.Any(t => t.Clase == 1) + "|" + semilla.Any(t => t.Clase == 2));
    }
}
