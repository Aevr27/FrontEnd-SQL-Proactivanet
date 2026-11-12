// tools/tests/VolumenTiposVistasSqlLocalDbSmoke.cs - la lectura SQL del
// volumen de Experiencia (ExperienciaQueries.LeerVolumen +
// VolumenDeColumnas) contra dbo.vw_TBSlotCAT y dbo.vw_TBMesCAT en una base
// DESECHABLE de SQL Server LocalDB. La crea, corre los casos y la BORRA.
// Nunca toca QA.
//
// LIMITE DECLARADO: vw_TicketsSlotsBase / vw_TBSlotCAT y las tres funciones
// son copia del script "Descargar script v2 usando vw_Tickets.sql"
// (Integracion_SQL-Proactivanet). vw_TicketsMesBase / vw_TBMesCAT son una
// REPLICA: su script (09_slots_por_mes.sql) no esta en ningun repositorio;
// se arman con la misma expresion de TipoTicket y las mismas columnas que
// leen LeerVolumen y el export. Que la vista de QA sea igual lo dice
// sql/diag_experiencia_tipos_vistas.sql, no esta prueba.
//
// Casos:
//   V1 Incidentes = 'Incidencia' + 'SorIA Incidentes' en las dos vistas;
//   V2 Requerimientos = 'Petición de Servicio' (con y sin tilde) + 'SorIA
//      Peticiones' en las dos vistas;
//   V3 mismo periodo (todos los tickets del SLOT 0 caen en un solo mes): la
//      vista por slot y la vista por mes dan los mismos Inc / Req / Total por
//      categoria;
//   V4 sin doble cuenta: Total = tickets sembrados; Inc + Req + 'Sin tipo' y
//      otros = Total; dos Tipo relacion en la misma categoria;
//   V5 SLOT 0 sigue siendo vw_Tickets.Slot = 0: los del SLOT 1 no entran, y
//      el mes los acumula por fecha de registro;
//   V6 Admin (VolumenSlot0PorCategoria) sigue con [Total general] del SLOT 0.
//
// Compilar y correr desde la raiz del repo:
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:VolumenTiposVistas.exe /r:System.dll /r:System.Core.dll /r:System.Data.dll ^
//       tools\tests\VolumenTiposVistasSqlLocalDbSmoke.cs
//   VolumenTiposVistas.exe exp.dll
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.Reflection;

public static class VolumenTiposVistasSmoke
{
    const string Instancia = @"(localdb)\MSSQLLocalDB";
    static int fallos = 0;

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection("Server=" + Instancia + ";Integrated Security=true;Database=" + db + ";");
        cn.Open();
        return cn;
    }

    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn)) { c.CommandTimeout = 120; c.ExecuteNonQuery(); } }

    static void Chk(string caso, object esperado, object obtenido)
    {
        var ok = Equals(Convert.ToString(esperado, CultureInfo.InvariantCulture), Convert.ToString(obtenido, CultureInfo.InvariantCulture));
        if (!ok) fallos++;
        Console.WriteLine("{0}  {1}  esperado={2}  obtenido={3}", ok ? "PASS" : "FALLA", caso, esperado, obtenido);
    }

    // --- copia de "Descargar script v2 usando vw_Tickets.sql" ---------------
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

    const string FN_C1C2 = @"
CREATE FUNCTION dbo.fn_CategoriaC1C2 (@Categoria NVARCHAR(500))
RETURNS NVARCHAR(500)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s NVARCHAR(500) = dbo.fn_NormalizaCategoria(@Categoria);
    DECLARE @p1 INT, @p2 INT, @p3 INT;

    IF @s = N'' RETURN N'';
    IF LEFT(@s,1) <> N'/' SET @s = N'/' + @s;

    SET @p1 = 1;
    SET @p2 = CHARINDEX(N'/', @s, @p1 + 1);
    IF @p2 = 0 RETURN @s;

    SET @p3 = CHARINDEX(N'/', @s, @p2 + 1);
    IF @p3 = 0 RETURN @s;

    RETURN LEFT(@s, @p3 - 1);
END;";

    const string VW_SLOTS_BASE = @"
CREATE VIEW dbo.vw_TicketsSlotsBase
AS
SELECT
    t.CodigoTicket,
    t.FechaRegistro,
    Slot = t.Slot,
    CategoriaV2 = dbo.fn_NormalizaCategoria(t.Categoria),
    C1          = dbo.fn_CategoriaC1(t.Categoria),
    C1C2        = dbo.fn_CategoriaC1C2(t.Categoria),
    Aplica      = CONVERT(NVARCHAR(2), N'Si'),
    TipoRelacion = ISNULL(NULLIF(LTRIM(RTRIM(t.TipoRelacion)), N''), N'Sin tipo relacion'),
    TipoTicket    = ISNULL(NULLIF(LTRIM(RTRIM(t.Tipo)), N''), N'Sin tipo'),
    t.Estado,
    t.Subestado,
    t.Grupo,
    t.TecnicoSegundaLinea,
    t.Tienda,
    t.FechaUltimaCargaDW
FROM dbo.vw_Tickets AS t
WHERE t.FechaRegistro IS NOT NULL
  AND t.Slot IS NOT NULL;";

    const string VW_SLOT_CAT = @"
CREATE VIEW dbo.vw_TBSlotCAT
AS
SELECT
    b.Slot,
    [Categoria V2] = b.CategoriaV2,
    b.Aplica,
    [Tipo relación] = b.TipoRelacion,
    [Incidencia] = NULLIF(SUM(CASE WHEN b.TipoTicket = N'Incidencia' THEN 1 ELSE 0 END), 0),
    [Petición de Servicio] = NULLIF(SUM(CASE WHEN b.TipoTicket IN (N'Petición de Servicio', N'Peticion de Servicio') THEN 1 ELSE 0 END), 0),
    [SorIA Peticiones] = NULLIF(SUM(CASE WHEN b.TipoTicket = N'SorIA Peticiones' THEN 1 ELSE 0 END), 0),
    [SorIA Incidentes] = NULLIF(SUM(CASE WHEN b.TipoTicket = N'SorIA Incidentes' THEN 1 ELSE 0 END), 0),
    [Total general] = COUNT_BIG(*)
FROM dbo.vw_TicketsSlotsBase AS b
GROUP BY b.Slot, b.CategoriaV2, b.Aplica, b.TipoRelacion;";

    // --- REPLICA (09_slots_por_mes.sql no esta en ningun repositorio) -------
    const string VW_MES_BASE = @"
CREATE VIEW dbo.vw_TicketsMesBase
AS
SELECT
    t.CodigoTicket,
    t.FechaRegistro,
    Anio = YEAR(t.FechaRegistro),
    Mes = MONTH(t.FechaRegistro),
    CategoriaV2 = dbo.fn_NormalizaCategoria(t.Categoria),
    C1          = dbo.fn_CategoriaC1(t.Categoria),
    C1C2        = dbo.fn_CategoriaC1C2(t.Categoria),
    Aplica      = CONVERT(NVARCHAR(2), N'Si'),
    TipoRelacion = ISNULL(NULLIF(LTRIM(RTRIM(t.TipoRelacion)), N''), N'Sin tipo relacion'),
    TipoTicket    = ISNULL(NULLIF(LTRIM(RTRIM(t.Tipo)), N''), N'Sin tipo'),
    t.Estado,
    t.Grupo
FROM dbo.vw_Tickets AS t
WHERE t.FechaRegistro IS NOT NULL;";

    const string VW_MES_CAT = @"
CREATE VIEW dbo.vw_TBMesCAT
AS
SELECT
    b.Anio,
    b.Mes,
    [Categoria V2] = b.CategoriaV2,
    b.Aplica,
    [Tipo relación] = b.TipoRelacion,
    [Incidencia] = NULLIF(SUM(CASE WHEN b.TipoTicket = N'Incidencia' THEN 1 ELSE 0 END), 0),
    [Petición de Servicio] = NULLIF(SUM(CASE WHEN b.TipoTicket IN (N'Petición de Servicio', N'Peticion de Servicio') THEN 1 ELSE 0 END), 0),
    [SorIA Peticiones] = NULLIF(SUM(CASE WHEN b.TipoTicket = N'SorIA Peticiones' THEN 1 ELSE 0 END), 0),
    [SorIA Incidentes] = NULLIF(SUM(CASE WHEN b.TipoTicket = N'SorIA Incidentes' THEN 1 ELSE 0 END), 0),
    [Total general] = COUNT_BIG(*)
FROM dbo.vw_TicketsMesBase AS b
GROUP BY b.Anio, b.Mes, b.CategoriaV2, b.Aplica, b.TipoRelacion;";

    struct Semilla { public string Cat, Tipo, Rel; public int Slot, N; public DateTime Fecha; }

    public static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args[0]);
        var T = asm.GetType("ExperienciaQueries");
        var leer = T.GetMethod("LeerVolumen", BindingFlags.NonPublic | BindingFlags.Static);
        var admin = T.GetMethod("VolumenSlot0PorCategoria", BindingFlags.Public | BindingFlags.Static);

        var db = "ExpVolumenTiposPrueba_" + Guid.NewGuid().ToString("N").Substring(0, 8);
        using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + db + "]");
        try
        {
            using (var cn = Abrir(db))
            {
                Exec(cn, @"CREATE TABLE dbo.vw_Tickets (
    CodigoTicket NVARCHAR(30) NOT NULL PRIMARY KEY, FechaRegistro DATETIME NULL, Slot INT NULL,
    Categoria NVARCHAR(500) NULL, TipoRelacion NVARCHAR(100) NULL, Tipo NVARCHAR(100) NULL,
    Estado NVARCHAR(50) NULL, Subestado NVARCHAR(50) NULL, Grupo NVARCHAR(100) NULL,
    TecnicoSegundaLinea NVARCHAR(100) NULL, Tienda NVARCHAR(100) NULL, FechaUltimaCargaDW DATETIME NULL);");
                foreach (var ddl in new[] { FN_NORMALIZA, FN_C1, FN_C1C2, VW_SLOTS_BASE, VW_SLOT_CAT, VW_MES_BASE, VW_MES_CAT })
                    Exec(cn, ddl);

                // SLOT 0 entero dentro de noviembre 2026; SLOT 1 en octubre.
                var nov = new DateTime(2026, 11, 5);
                var oct = new DateTime(2026, 10, 10);
                var semilla = new[] {
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "Incidencia",            Rel = "Directa", Slot = 0, N = 3, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = " SorIA Incidentes ",    Rel = "Directa", Slot = 0, N = 2, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "Petición de Servicio",  Rel = "Directa", Slot = 0, N = 2, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "Peticion de Servicio",  Rel = "Hija",    Slot = 0, N = 1, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "SorIA Peticiones",      Rel = "Hija",    Slot = 0, N = 4, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "",                      Rel = "Directa", Slot = 0, N = 1, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = null,                    Rel = "Hija",    Slot = 0, N = 1, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "Otro",                  Rel = "Directa", Slot = 0, N = 1, Fecha = nov },
                    new Semilla { Cat = "/Soria/Bot",      Tipo = "SorIA Peticiones",      Rel = "Directa", Slot = 0, N = 5, Fecha = nov },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "Incidencia",            Rel = "Directa", Slot = 1, N = 7, Fecha = oct },
                    new Semilla { Cat = "/Red/LAN/Switch", Tipo = "SorIA Incidentes",      Rel = "Directa", Slot = 1, N = 6, Fecha = oct },
                };
                int folio = 0;
                foreach (var s in semilla)
                    for (int i = 0; i < s.N; i++)
                    {
                        using (var c = new SqlCommand("INSERT dbo.vw_Tickets (CodigoTicket, FechaRegistro, Slot, Categoria, TipoRelacion, Tipo) VALUES (@c, @f, @s, @cat, @r, @t)", cn))
                        {
                            c.Parameters.AddWithValue("@c", "T" + (++folio));
                            c.Parameters.AddWithValue("@f", s.Fecha);
                            c.Parameters.AddWithValue("@s", s.Slot);
                            c.Parameters.AddWithValue("@cat", s.Cat);
                            c.Parameters.AddWithValue("@r", s.Rel);
                            c.Parameters.AddWithValue("@t", (object)s.Tipo ?? DBNull.Value);
                            c.ExecuteNonQuery();
                        }
                    }

                var slot = Indice((IList)leer.Invoke(null, new object[] { cn, "dbo.vw_TBSlotCAT", "Slot", "[Categoria V2]", 0 }));
                var mes = Indice((IList)leer.Invoke(null, new object[] { cn, "dbo.vw_TBMesCAT", "Mes", "[Categoria V2]", 2026 }));

                Chk("V1 slot 0 /Red/LAN/Switch Incidentes = 3 Incidencia + 2 SorIA Incidentes", 5, Campo(slot, "0|/Red/LAN/Switch", "Inc"));
                Chk("V1 mes 11 /Red/LAN/Switch Incidentes = 3 + 2", 5, Campo(mes, "11|/Red/LAN/Switch", "Inc"));
                Chk("V2 slot 0 Requerimientos = 2 con tilde + 1 sin tilde + 4 SorIA Peticiones", 7, Campo(slot, "0|/Red/LAN/Switch", "Pet"));
                Chk("V2 mes 11 Requerimientos = 2 + 1 + 4", 7, Campo(mes, "11|/Red/LAN/Switch", "Pet"));
                Chk("V2 categoria de solo SorIA Peticiones: slot / mes", "5|5|0|0",
                    Campo(slot, "0|/Soria/Bot", "Pet") + "|" + Campo(mes, "11|/Soria/Bot", "Pet") + "|"
                    + Campo(slot, "0|/Soria/Bot", "Inc") + "|" + Campo(mes, "11|/Soria/Bot", "Inc"));

                foreach (var cat in new[] { "/Red/LAN/Switch", "/Soria/Bot" })
                    foreach (var campo in new[] { "Inc", "Pet", "Total" })
                        Chk("V3 " + cat + " " + campo + ": SLOT 0 = mes 11 (mismo periodo)",
                            Campo(slot, "0|" + cat, campo), Campo(mes, "11|" + cat, campo));

                Chk("V4 Total = tickets sembrados en SLOT 0 de la ruta (3+2+2+1+4+1+1+1)", 15, Campo(slot, "0|/Red/LAN/Switch", "Total"));
                Chk("V4 Total - Inc - Req = 'Sin tipo' (vacio y NULL) + 'Otro'", 3,
                    Campo(slot, "0|/Red/LAN/Switch", "Total") - Campo(slot, "0|/Red/LAN/Switch", "Inc") - Campo(slot, "0|/Red/LAN/Switch", "Pet"));
                int total = 0;
                foreach (var v in slot.Values) total += Get(v, "Total");
                Chk("V4 suma de Total de todas las filas = tickets sembrados", folio, total);
                Chk("V4 una fila por periodo y categoria tras colapsar dos Tipo relacion", "3|3", slot.Count + "|" + mes.Count);

                Chk("V5 SLOT 1 aparte: Inc = 7 + 6, Total 13", "13|13", Campo(slot, "1|/Red/LAN/Switch", "Inc") + "|" + Campo(slot, "1|/Red/LAN/Switch", "Total"));
                Chk("V5 mes 10 = los mismos 13 (por fecha de registro)", "13|13", Campo(mes, "10|/Red/LAN/Switch", "Inc") + "|" + Campo(mes, "10|/Red/LAN/Switch", "Total"));

                var adm = (Dictionary<string, int>)admin.Invoke(null, new object[] { cn });
                Chk("V6 Admin: Total general del SLOT 0 por ruta", "15|5", adm["/Red/LAN/Switch"] + "|" + adm["/Soria/Bot"]);
            }
        }
        finally
        {
            SqlConnection.ClearAllPools();
            using (var m = Abrir("master"))
                Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
        }

        Console.WriteLine(fallos == 0 ? "TODO OK" : fallos + " FALLO(S)");
        return fallos == 0 ? 0 : 1;
    }

    static int Get(object v, string campo)
    {
        return (int)v.GetType().GetField(campo, BindingFlags.Public | BindingFlags.Instance).GetValue(v);
    }

    static Dictionary<string, object> Indice(IList filas)
    {
        var d = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var v in filas)
        {
            var t = v.GetType();
            var llave = t.GetField("Periodo").GetValue(v) + "|" + t.GetField("Llave").GetValue(v);
            d.Add(llave, v);   // Add: una llave repetida seria doble cuenta
        }
        return d;
    }

    static int Campo(Dictionary<string, object> d, string llave, string campo)
    {
        object v;
        return d.TryGetValue(llave, out v) ? Get(v, campo) : -1;
    }
}
