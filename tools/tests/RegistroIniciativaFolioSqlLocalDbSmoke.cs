// Prueba de ExperienciaQueries.RegistroIniciativas(folio) (App_Code/
// ExperienciaRegistro.cs) contra RegistroIniciativas() -el registro entero-,
// sobre una base DESECHABLE de SQL Server LocalDB. Nunca toca la VM ni
// Tickets_Proactivanet; la base se crea con nombre unico y se borra al final.
//
// La base trae solo lo que leen las dos versiones, con los tipos y la
// intercalacion de la VM (esquema_bd/02_columnas.tsv: Codigo nvarchar(100)
// SQL_Latin1_General_CP1_CI_AS). dbo.vw_ProblemCategoria es una VISTA que
// abanica como la real: su LEFT JOIN por C1 contra dbo.CatCategoriaDueno
// repite cada fila tantas veces como N2 tenga su C1.
//
// Casos (prefijo del rotulo):
//   I  para cada folio de la base y sus variantes (minusculas, espacio al
//      final, inexistente, vacio, null, mas largo que la columna): la
//      iniciativa que encontraba quien buscaba en el registro entero
//      (OrdinalIgnoreCase y Ordinal, las dos comparaciones de los que
//      llaman) es, serializada, la misma que encuentra en el filtrado.
//      Cubre: varias categorias con abanico, categoria no vigente, fecha
//      propia de categoria que la vuelve retrasada, foto de Tickets Reduce,
//      sin categoria, Problem no vigente con categoria vigente, Problem
//      vigente solo con categorias no vigentes, Problem sin nada, folio con
//      otra grafia en ProblemCategoria, historial con 'reconstruido' que
//      depende del inicio de TODA la tabla.
//   R  claves del registro: las que trae, iguales; los catalogos de toda la
//      tabla no vienen; folio inexistente sale sin iniciativas.
//   D  folio inexistente no lee el directorio (sin dbo.CatCategoriaDueno
//      sigue respondiendo); uno que existe si lo necesita.
//   C  los tres que buscan por folio (Modificar, LeerCapacidad del envio de
//      Solicitar cambios, el acuse) devuelven lo mismo que con el registro
//      entero, y su codigo ya llama a RegistroIniciativas(folio).
//   V  variantes de esquema: sin dbo.ExpTicketsReduce, sin la columna
//      Categoria del historial, sin dbo.ProblemFechaEvento.
//   M  medicion (informativa, no falla): registro entero contra filtrado
//      con 3000 iniciativas sinteticas mas, en LocalDB.
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /target:library /out:adm.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:RegistroFolio.exe /r:adm.dll /r:System.dll /r:System.Core.dll /r:System.Data.dll ^
//       /r:System.Web.Extensions.dll /r:System.Configuration.dll tools\tests\RegistroIniciativaFolioSqlLocalDbSmoke.cs
//   RegistroFolio.exe
using System;
using System.Collections;
using System.Collections.Generic;
using System.Configuration;
using System.Data.SqlClient;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;

static class RegistroIniciativaFolioSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;Pooling=false;";
    static int fallos, pasados;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado);
        var o = Convert.ToString(obtenido);
        var ok = e == o;
        if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static void Exec(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn)) { cmd.CommandTimeout = 120; cmd.ExecuteNonQuery(); }
    }

    // App_Code lee la cadena "TicketsProactivanet" de ConfigurationManager;
    // aqui se apunta a la base desechable sin escribir un .config.
    static void ApuntarA(string cadena)
    {
        var lista = ConfigurationManager.ConnectionStrings;
        for (var t = lista.GetType(); t != null; t = t.BaseType)
            foreach (var f in t.GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                if (f.FieldType == typeof(bool) && f.Name.IndexOf("ReadOnly", StringComparison.OrdinalIgnoreCase) >= 0)
                    f.SetValue(lista, false);
        lista.Remove("TicketsProactivanet");
        lista.Add(new ConnectionStringSettings("TicketsProactivanet", cadena, "System.Data.SqlClient"));
    }

    const string Esquema = @"
CREATE TABLE dbo.CatPrefijoProblem (Prefijo nvarchar(10) NOT NULL PRIMARY KEY, Descripcion nvarchar(200) NULL, ControlDeFecha bit NOT NULL);
CREATE TABLE dbo.Problem (
    Codigo nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL CONSTRAINT PK_Problem PRIMARY KEY,
    Prefijo nvarchar(10) NULL, Titulo nvarchar(500) NULL, TipoIniciativa nvarchar(100) NULL,
    Estado nvarchar(100) NULL, Subestado nvarchar(100) NULL,
    FechaAnalisis datetime2(0) NULL, FechaSolucion datetime2(0) NULL, FechaCierre datetime2(0) NULL,
    NroCambioFechaAnalisis int NULL, NroCambioFechaSolucion int NULL, NroCambioFechaCierre int NULL,
    Descripcion nvarchar(max) NULL, Observaciones nvarchar(max) NULL, FechaCreacion datetime2(0) NULL,
    OwnerServicio nvarchar(200) NULL, OwnerProblem nvarchar(200) NULL, Direccion nvarchar(255) NULL,
    VigenteEnOrigen bit NOT NULL);
CREATE TABLE dbo.ProblemCategoria (
    Codigo nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL REFERENCES dbo.Problem (Codigo),
    Categoria nvarchar(450) NOT NULL, TipoAgrupado nvarchar(100) NULL, TituloIniciativa nvarchar(max) NULL,
    PctDisminucion decimal(9,4) NULL, TicketsReduce int NULL, VigenteEnOrigen bit NOT NULL,
    FechaCreacionCategoria date NULL, FechaAnalisisCategoria date NULL,
    CONSTRAINT PK_ProblemCategoria PRIMARY KEY (Codigo, Categoria));
CREATE TABLE dbo.CatCategoriaDueno (CategoriaN2 nvarchar(450) NULL, C1 nvarchar(255) NULL, ProductOwner nvarchar(200) NULL,
    ServiceOwner nvarchar(200) NULL, DirectorPO nvarchar(200) NULL, VigenteEnOrigen bit NOT NULL);
CREATE TABLE dbo.CatPersona (Nombre nvarchar(200) NULL, Manager nvarchar(200) NULL, VigenteEnOrigen bit NOT NULL);
CREATE TABLE dbo.ProblemFechaEvento (IdEvento int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL, Campo varchar(30) NOT NULL,
    FechaAnterior date NULL, FechaNueva date NULL, Operacion char(1) NOT NULL, Origen varchar(20) NOT NULL,
    Usuario nvarchar(200) NULL, SolicitudId int NULL, FechaRegistro datetime2(3) NOT NULL, Categoria nvarchar(450) NULL);
CREATE TABLE dbo.ExpTicketsReduce (Codigo nvarchar(100) NOT NULL, Categoria nvarchar(450) NOT NULL, Pct decimal(9,4) NULL, TicketsReduce int NULL);";

    // Los stubs de tools/tests/GestionAdminLocalDb_replica.sql.
    const string FnC1 = @"
CREATE FUNCTION dbo.fn_CategoriaC1 (@Ruta nvarchar(1000)) RETURNS nvarchar(255) AS
BEGIN
    DECLARE @s nvarchar(1000) = LTRIM(RTRIM(@Ruta));
    IF LEFT(@s, 1) = N'/' SET @s = SUBSTRING(@s, 2, 1000);
    RETURN CASE WHEN CHARINDEX(N'/', @s) > 0 THEN LEFT(@s, CHARINDEX(N'/', @s) - 1) ELSE @s END;
END;";
    const string FnC1C2 = @"
CREATE FUNCTION dbo.fn_CategoriaC1C2 (@Ruta nvarchar(1000)) RETURNS nvarchar(500) AS
BEGIN
    DECLARE @s nvarchar(1000) = LTRIM(RTRIM(@Ruta));
    IF LEFT(@s, 1) = N'/' SET @s = SUBSTRING(@s, 2, 1000);
    DECLARE @i int = CHARINDEX(N'/', @s);
    IF @i = 0 RETURN @s;
    DECLARE @j int = CHARINDEX(N'/', @s, @i + 1);
    RETURN CASE WHEN @j > 0 THEN LEFT(@s, @j - 1) ELSE @s END;
END;";
    const string Vista = @"
CREATE VIEW dbo.vw_ProblemCategoria AS
SELECT pc.Codigo, pc.Categoria,
       C1 = dbo.fn_CategoriaC1(pc.Categoria), C1C2 = dbo.fn_CategoriaC1C2(pc.Categoria),
       Iniciativa = ISNULL(pc.TituloIniciativa, p.Titulo), p.Titulo, p.Estado, pc.TipoAgrupado,
       pc.TicketsReduce, pc.PctDisminucion,
       FechaAnalisis = CASE WHEN pc.FechaAnalisisCategoria IS NOT NULL
                            THEN CONVERT(datetime2(0), pc.FechaAnalisisCategoria) ELSE p.FechaAnalisis END,
       p.FechaSolucion, p.FechaCierre,
       p.NroCambioFechaAnalisis, p.NroCambioFechaSolucion, p.NroCambioFechaCierre,
       pc.VigenteEnOrigen,
       Abanico = d.CategoriaN2
FROM dbo.ProblemCategoria AS pc
INNER JOIN dbo.Problem AS p ON p.Codigo = pc.Codigo
LEFT JOIN dbo.CatCategoriaDueno AS d ON d.C1 = dbo.fn_CategoriaC1(pc.Categoria);";

    const string Datos = @"
INSERT dbo.CatPrefijoProblem VALUES (N'PRB', N'Problem', 1), (N'ADO', N'Adopcion', 1), (N'REQ', N'Requerimiento', 0);
INSERT dbo.Problem (Codigo, Prefijo, Titulo, TipoIniciativa, Estado, Subestado, FechaAnalisis, FechaSolucion, FechaCierre,
    NroCambioFechaAnalisis, NroCambioFechaSolucion, NroCambioFechaCierre, Descripcion, Observaciones, FechaCreacion,
    OwnerServicio, OwnerProblem, Direccion, VigenteEnOrigen) VALUES
 (N'PRB 2026-000001', N'PRB', N'Uno', N'Problem', N'En Análisis', N' Esperando ', '2027-12-31', NULL, NULL, 2, 0, 0,
  N'Desc 1', N'Obs 1', '2026-03-01', N'Beto SO', N'Ana PO', N'Dir 1', 1),
 (N'ADO 2026-000002', N'ADO', N'Dos suelta', N'Adopción', N'EN SOLUCION', NULL, NULL, '2026-02-01', NULL, 0, 1, 0,
  NULL, NULL, '2026-01-10', N'Sofi', N'Pablo', N'Dir 2', 1),
 (N'REQ 2026-000003', N'REQ', N'Tres req', N'Requerimiento', N'En Monitoreo', N'Sub 3', NULL, NULL, '2026-01-01', 0, 0, 3,
  NULL, NULL, '2026-01-01', NULL, NULL, NULL, 1),
 (N'PRB 2026-000004', N'PRB', N'Cuatro no vigente', N'Problem', N'Cerrado', N'Sub 4', NULL, NULL, NULL, 0, 0, 0,
  NULL, NULL, '2025-12-01', N'X', N'Y', NULL, 0),
 (N'PRB 2026-000005', N'PRB', N'Cinco solo categorias viejas', N'Mejora', N'En Análisis', NULL, '2026-01-20', NULL, NULL, 0, 0, 0,
  NULL, NULL, '2026-01-05', NULL, N'Pablo', NULL, 1),
 (N'PRB 2026-000006', N'PRB', N'Seis sin nada', N'Problem', N'Cerrado', NULL, NULL, NULL, NULL, 0, 0, 0,
  NULL, NULL, '2025-01-01', NULL, NULL, NULL, 0),
 (N'PRB 2026-000007', NULL, N'Siete grafia', N'Problem', N'En Solución', NULL, NULL, '2027-01-01', NULL, 0, 0, 0,
  NULL, NULL, '2026-05-05', N'S7', N'P7', NULL, 1);
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoAgrupado, TituloIniciativa, PctDisminucion, TicketsReduce, VigenteEnOrigen,
    FechaCreacionCategoria, FechaAnalisisCategoria) VALUES
 (N'PRB 2026-000001', N'/S/Cat 1', N'Problem', NULL, 0.2000, 10, 1, NULL, NULL),
 (N'PRB 2026-000001', N'/S/Cat 2', N'Problem', NULL, 0.1000, 5, 1, '2026-01-02', '2026-01-15'),
 (N'PRB 2026-000001', N'/S/Vieja', N'Problem', NULL, 0.9000, 99, 0, NULL, NULL),
 (N'REQ 2026-000003', N'/K/Uno', N'Requerimiento', N'Titulo propio', 0.5000, 4, 1, NULL, NULL),
 (N'PRB 2026-000004', N'/K/Uno', N'adopcion', NULL, 0.3000, 3, 1, NULL, NULL),
 (N'PRB 2026-000005', N'/S/Cat 1', N'Problem', NULL, 0.3000, 3, 0, NULL, NULL),
 (N'prb 2026-000007', N'/S/Cat 1', N'Mejora', NULL, 0.4000, 8, 1, NULL, NULL);
INSERT dbo.ExpTicketsReduce VALUES (N'PRB 2026-000001', N'/S/Cat 2', 0.1000, 7), (N'REQ 2026-000003', N'/K/Uno', 0.9000, 40);
INSERT dbo.CatCategoriaDueno VALUES
 (N'S/Cat 1', N'S', N'Pablo', N'Sofi', N'Dora', 1),
 (N'S/Cat 2', N'S', N'Pia', N'Saul', N'Dora', 1),
 (N'S/Zeta', N'S', N'Zoe', N'Zed', N'Dora', 0),
 (N'K/Uno', N'K', N'Kim', N'Karl', N'Kai', 1);
INSERT dbo.CatPersona VALUES (N'Sofi', N'Mara', 1), (N'Saul', N'Mario', 1), (N'Karl', N'Kira', 1), (N'Beto SO', N'Bea', 1);
INSERT dbo.ProblemFechaEvento (Codigo, Campo, FechaAnterior, FechaNueva, Operacion, Origen, Usuario, SolicitudId, FechaRegistro, Categoria) VALUES
 (N'REQ 2026-000003', 'FechaCierre',   NULL, '2026-01-01', 'B', 'NO_DECLARADO', NULL, NULL, '2026-09-01T10:00:00', NULL),
 (N'PRB 2026-000001', 'FechaAnalisis', '2026-06-01', '2026-07-01', 'U', 'NO_DECLARADO', N'login', NULL, '2026-08-01T10:00:00', NULL),
 (N'PRB 2026-000001', 'FechaAnalisis', NULL, '2026-07-01', 'B', 'NO_DECLARADO', NULL, NULL, '2026-09-15T10:00:00', NULL),
 (N'PRB 2026-000001', 'FechaAnalisis', '2026-07-01', '2027-12-31', 'U', 'ADMIN', N'SORIANA\adm', 12, '2026-10-01T10:00:00', NULL),
 (N'PRB 2026-000001', 'FechaAnalisis', NULL, '2026-01-15', 'I', 'ADMIN', N'SORIANA\adm', 13, '2026-10-02T10:00:00', N'/S/Cat 2'),
 (N'prb 2026-000001', 'FechaAnalisis', '2027-12-31', '2027-12-31', 'U', 'NO_DECLARADO', NULL, NULL, '2026-10-03T10:00:00', NULL),
 (N'PRB 2026-000004', 'FechaAnalisis', NULL, '2025-12-01', 'B', 'NO_DECLARADO', NULL, NULL, '2026-09-20T10:00:00', NULL);";

    static string Preparar()
    {
        var db = "RegistroFolioPrueba_" + Guid.NewGuid().ToString("N").Substring(0, 8);
        using (var m = new SqlConnection(Servidor + "Database=master;")) { m.Open(); Exec(m, "CREATE DATABASE [" + db + "]"); }
        Bases.Add(db);
        using (var cn = new SqlConnection(Servidor + "Database=" + db + ";"))
        {
            cn.Open();
            Exec(cn, Esquema); Exec(cn, FnC1); Exec(cn, FnC1C2); Exec(cn, Vista); Exec(cn, Datos);
        }
        return db;
    }

    static readonly List<string> Bases = new List<string>();

    static int Main()
    {
        try
        {
            var db = Preparar();
            ApuntarA(Servidor + "Database=" + db + ";");
            using (var cn = new SqlConnection(Servidor + "Database=" + db + ";"))
            {
                cn.Open();
                Comparar("I");
                Registro();
                Directorio(cn);
                Llamadores();

                Exec(cn, "DROP TABLE dbo.ExpTicketsReduce");
                Comparar("V1 sin ExpTicketsReduce");
                Exec(cn, "ALTER TABLE dbo.ProblemFechaEvento DROP COLUMN Categoria");
                Comparar("V2 historial sin Categoria");
                Exec(cn, "DROP TABLE dbo.ProblemFechaEvento");
                Comparar("V3 sin ProblemFechaEvento");
                Check("V3 historial_estado sin_tabla en los dos",
                    "sin_tabla|sin_tabla",
                    ExperienciaQueries.RegistroIniciativas()["historial_estado"] + "|" +
                    ExperienciaQueries.RegistroIniciativas("PRB 2026-000001")["historial_estado"]);
            }

            var dbMedir = Preparar();
            ApuntarA(Servidor + "Database=" + dbMedir + ";");
            using (var cn = new SqlConnection(Servidor + "Database=" + dbMedir + ";"))
            {
                cn.Open();
                Medir(cn);
            }
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            using (var m = new SqlConnection(Servidor + "Database=master;"))
            {
                m.Open();
                foreach (var db in Bases)
                {
                    Exec(m, "ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]");
                    Console.WriteLine("   base " + db + " borrada");
                }
            }
        }
        Console.WriteLine(pasados + " PASARON, " + fallos + " FALLARON");
        return fallos == 0 ? 0 : 1;
    }

    static List<object> Lista(Dictionary<string, object> reg) { return (List<object>)reg["iniciativas"]; }

    static Dictionary<string, object> Buscar(Dictionary<string, object> reg, string folio, StringComparison cmp)
    {
        foreach (Dictionary<string, object> i in Lista(reg))
            if (string.Equals(i["folio"] as string, folio, cmp)) return i;
        return null;
    }

    static string Folios(Dictionary<string, object> reg)
    {
        var l = new List<string>();
        foreach (Dictionary<string, object> i in Lista(reg)) l.Add(i["folio"] as string);
        l.Sort(StringComparer.Ordinal);
        return string.Join(",", l.ToArray());
    }

    static IEnumerable<string> Variantes(Dictionary<string, object> entero)
    {
        var salida = new List<string>();
        foreach (Dictionary<string, object> i in Lista(entero))
        {
            var f = (string)i["folio"];
            salida.Add(f);
            salida.Add(f.ToLowerInvariant());
            salida.Add(f.ToUpperInvariant());
            salida.Add(f + " ");
            salida.Add(" " + f);
        }
        salida.AddRange(new[] { "PRB 2026-000006", "PRB 2026-999999", "", " ", null, new string('P', 101) });
        return salida;
    }

    static void Comparar(string rotulo)
    {
        var entero = ExperienciaQueries.RegistroIniciativas();
        if (rotulo == "I")
            Check("I0 el registro entero trae los folios esperados",
                "ADO 2026-000002,PRB 2026-000001,PRB 2026-000004,PRB 2026-000005,REQ 2026-000003,prb 2026-000007",
                Folios(entero));
        foreach (var f in Variantes(entero))
        {
            var filtrado = ExperienciaQueries.RegistroIniciativas(f);
            foreach (var cmp in new[] { StringComparison.OrdinalIgnoreCase, StringComparison.Ordinal })
            {
                var antes = Buscar(entero, f, cmp);
                var ahora = Buscar(filtrado, f, cmp);
                Check(rotulo + " [" + (f == null ? "null" : "'" + f + "'") + "] " + cmp,
                    antes == null ? "null" : Json.Serialize(antes),
                    ahora == null ? "null" : Json.Serialize(ahora));
            }
            Check(rotulo + " [" + (f == null ? "null" : "'" + f + "'") + "] a lo mas una iniciativa", "True", Lista(filtrado).Count <= 1);
        }
    }

    static void Registro()
    {
        var entero = ExperienciaQueries.RegistroIniciativas();
        var uno = ExperienciaQueries.RegistroIniciativas("PRB 2026-000001");
        foreach (var k in new[] { "estados_activos", "agrupadores", "historial_estado", "historial_desde", "fecha_gen" })
            Check("R1 clave " + k + " igual", Json.Serialize(entero[k]), Json.Serialize(uno[k]));
        foreach (var k in new[] { "tipos_iniciativa", "estados_problem", "subestados_problem", "valores_tipo_iniciativa", "valores_tipo_agrupado" })
            Check("R2 catalogo " + k + ": en el entero si, en el filtrado no", "True|False", entero.ContainsKey(k) + "|" + uno.ContainsKey(k));
        Check("R3 historial_desde = el 'B' mas viejo de TODA la tabla (de otro folio)", "01/09/2026", uno["historial_desde"]);
        var h = (List<object>)((Dictionary<string, object>)Lista(uno)[0])["historial"];
        var marcas = new List<string>();
        foreach (Dictionary<string, object> e in h) marcas.Add(e["operacion"] + ":" + e["reconstruido"]);
        Check("R4 'U' anterior al inicio global sale reconstruido; grafia minuscula incluida",
            "U:True,B:False,U:False,U:False", string.Join(",", marcas.ToArray()));
        var nada = ExperienciaQueries.RegistroIniciativas("PRB 2026-999999");
        Check("R5 inexistente: sin iniciativas, con estados_activos/agrupadores/fecha_gen, sin historial_*",
            "0|True|True|True|False|False",
            Lista(nada).Count + "|" + nada.ContainsKey("estados_activos") + "|" + nada.ContainsKey("agrupadores") + "|" +
            nada.ContainsKey("fecha_gen") + "|" + nada.ContainsKey("historial_estado") + "|" + nada.ContainsKey("historial_desde"));
        var i1 = (Dictionary<string, object>)Lista(uno)[0];
        Check("R6 folio 1: retrasada por su categoria con fecha propia, foto de TR, 2 categorias vigentes",
            "1|17|2|Esperando|PRB|Ana PO|Beto SO",
            i1["retrazado"] + "|" + i1["tickets_reduce"] + "|" + ((IList)i1["categorias"]).Count + "|" + i1["subestado"] + "|" +
            i1["prefijo"] + "|" + i1["po_capturado"] + "|" + i1["so_capturado"]);
    }

    static void Directorio(SqlConnection cn)
    {
        Exec(cn, "EXEC sp_rename 'dbo.CatCategoriaDueno', 'CatCategoriaDueno_fuera'");
        try
        {
            string r;
            try { r = Lista(ExperienciaQueries.RegistroIniciativas("PRB 2026-999999")).Count.ToString(); }
            catch (Exception ex) { r = "excepcion " + ex.GetType().Name; }
            Check("D1 folio inexistente responde sin leer el directorio", "0", r);
            try { ExperienciaQueries.RegistroIniciativas("PRB 2026-000001"); r = "sin excepcion"; }
            catch (SqlException) { r = "SqlException"; }
            Check("D2 folio que existe si llega a la vista y al directorio", "SqlException", r);
        }
        finally
        {
            Exec(cn, "EXEC sp_rename 'dbo.CatCategoriaDueno_fuera', 'CatCategoriaDueno'");
        }
    }

    static void Llamadores()
    {
        var entero = ExperienciaQueries.RegistroIniciativas();
        var fuente = new FuenteIniciativasAcuseSql();
        foreach (var f in Variantes(entero))
        {
            var q = f == null ? "null" : "'" + f + "'";

            // Acuse: Ordinal sobre el folio tal cual.
            var dAntes = Buscar(entero, f, StringComparison.Ordinal);
            var acuseAntes = dAntes == null ? null : IniciativaAcuse.DesdeRegistro(dAntes);
            Check("C1 acuse " + q, Json.Serialize(acuseAntes), Json.Serialize(fuente.Iniciativa(f)));

            // Envio de Solicitar cambios y Modificar: OrdinalIgnoreCase sobre el folio recortado.
            var recortado = (f ?? "").Trim();
            var aAntes = Buscar(entero, recortado, StringComparison.OrdinalIgnoreCase);
            var actualAntes = aAntes == null ? null : IniciativaActual.DesdeRegistro(aAntes);
            Check("C2 LeerCapacidad (envio) " + q, Json.Serialize(actualAntes), Json.Serialize(SolicitudesCambio.LeerCapacidad(f).Actual));

            var svc = new GestionIniciativaAdminService();
            try { svc.Modificar(new PeticionModificarAdmin { Folio = f }); }
            catch (Exception) { /* lo que sigue a la lectura necesita mas esquema; Actual ya quedo */ }
            Check("C3 Modificar.Actual " + q, Json.Serialize(actualAntes), Json.Serialize(svc.Actual));
        }

        var raiz = Directory.GetCurrentDirectory();
        var archivos = new[]
        {
            new[] { "App_Code\\GestionIniciativaAdminService.cs", "RegistroIniciativas(folio)" },
            new[] { "App_Code\\SolicitudCambioAdmin.cs", "RegistroIniciativas((folio ?? \"\").Trim())" },
            new[] { "App_Code\\AcuseIniciativa.cs", "RegistroIniciativas(folio)" },
        };
        foreach (var a in archivos)
        {
            var texto = File.ReadAllText(Path.Combine(raiz, a[0]));
            Check("C4 " + a[0] + " busca por folio y ya no arma el registro entero",
                "True|False", texto.Contains(a[1]) + "|" + texto.Contains("RegistroIniciativas()"));
        }
    }

    // Informativa: no cuenta como PASS/FAIL. LocalDB en esta maquina, no la VM.
    static void Medir(SqlConnection cn)
    {
        Exec(cn, @"
INSERT dbo.Problem (Codigo, Prefijo, Titulo, TipoIniciativa, Estado, FechaAnalisis, Descripcion, Observaciones, FechaCreacion, OwnerProblem, VigenteEnOrigen)
SELECT N'PRB 2025-' + RIGHT(N'000000' + CONVERT(nvarchar(10), n), 6), N'PRB', N'Sintetica ' + CONVERT(nvarchar(10), n), N'Problem',
       N'En Análisis', '2027-01-01', REPLICATE(N'd', 400), REPLICATE(N'o', 200), '2025-06-01', N'Pablo', 1
FROM (SELECT TOP (3000) n = ROW_NUMBER() OVER (ORDER BY (SELECT 1)) FROM sys.all_objects a CROSS JOIN sys.all_objects b) x;
INSERT dbo.ProblemCategoria (Codigo, Categoria, TipoAgrupado, PctDisminucion, TicketsReduce, VigenteEnOrigen)
SELECT p.Codigo, c.r, N'Problem', 0.1000, 5, 1 FROM dbo.Problem p CROSS JOIN (VALUES (N'/S/Cat 1'), (N'/K/Uno')) c (r)
WHERE p.Codigo LIKE N'PRB 2025-%';");
        const int n = 10;
        ExperienciaQueries.RegistroIniciativas(); ExperienciaQueries.RegistroIniciativas("PRB 2026-000001");
        var sw = Stopwatch.StartNew();
        for (var k = 0; k < n; k++) ExperienciaQueries.RegistroIniciativas();
        var entero = sw.Elapsed.TotalMilliseconds / n;
        sw.Restart();
        for (var k = 0; k < n; k++) ExperienciaQueries.RegistroIniciativas("PRB 2026-000001");
        var filtrado = sw.Elapsed.TotalMilliseconds / n;
        sw.Restart();
        for (var k = 0; k < n; k++) ExperienciaQueries.RegistroIniciativas("PRB 2026-999999");
        var inexistente = sw.Elapsed.TotalMilliseconds / n;
        Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
            "MEDICION (LocalDB, {0} iniciativas, {1} corridas, sin pool): entero {2:0.0} ms | por folio {3:0.0} ms | folio inexistente {4:0.0} ms",
            Lista(ExperienciaQueries.RegistroIniciativas()).Count, n, entero, filtrado, inexistente));
    }
}
