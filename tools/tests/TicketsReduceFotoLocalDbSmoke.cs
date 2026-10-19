// Prueba de ExperienciaQueries.LeerIniciativas (App_Code/ExperienciaQueries.cs)
// contra una base DESECHABLE de SQL Server LocalDB: de donde sale Tickets
// Reduce cuando dbo.ExpTicketsReduce (la foto diaria del 65) existe.
//
// El defecto: ADM cambia el % de una categoria ligada;
// adm.usp_GestionAdmin_TicketsReduce recalcula ProblemCategoria.TicketsReduce
// = ROUND(VolumenUltimos30 x PctDisminucion, 0), pero el registro (y
// Experiencia) preferian SIEMPRE la foto, calculada con el % viejo: el
// "Tickets a reducir" no cambiaba hasta el siguiente calculo diario.
//
// La base solo trae lo que el SELECT lee: dbo.vw_ProblemCategoria es aqui
// una TABLA con esas columnas (la vista real pasa pc.PctDisminucion y
// pc.TicketsReduce tal cual: backend_admin_persistencia/_origen/
// vw_ProblemCategoria_38.sql), dbo.Problem, dbo.CatPrefijoProblem y
// dbo.ExpTicketsReduce con sus columnas de la VM (esquema_bd/02_columnas).
// Nunca toca la VM ni Tickets_Proactivanet; la base se borra al final.
//
// Casos:
//   F1 foto con el mismo % de la fila -> la foto (lo de hoy, sin cambio)
//   F2 % cambiado por ADM despues de la foto -> el de la fila (el defecto)
//   F3 sin fila en la foto -> el de la fila
//   F4 % vaciado despues de la foto -> el de la fila (0)
//   F5 foto y fila sin % -> la foto
//   F6 sin dbo.ExpTicketsReduce -> el de la fila
//
// Compilar y correr desde la raiz del repo (Git Bash: MSYS_NO_PATHCONV=1):
//   csc /nologo /target:library /out:exp.dll /r:System.dll /r:System.Data.dll ^
//       /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Configuration.dll App_Code\*.cs
//   csc /nologo /out:TrFoto.exe /r:System.dll /r:System.Data.dll tools\tests\TicketsReduceFotoLocalDbSmoke.cs
//   TrFoto.exe exp.dll
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Reflection;

static class TicketsReduceFotoLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;Pooling=false;";
    static int fallas, pasadas;

    static void Exec(SqlConnection cn, string sql)
    {
        using (var cmd = new SqlCommand(sql, cn)) cmd.ExecuteNonQuery();
    }

    static void Check(string rotulo, object esperado, object obtenido)
    {
        var ok = Equals(esperado, obtenido);
        if (ok) pasadas++; else fallas++;
        Console.WriteLine((ok ? "OK    " : "FALLA ") + rotulo + "  esperado=" + esperado + " obtenido=" + obtenido);
    }

    static int Main(string[] args)
    {
        var asm = Assembly.LoadFrom(args.Length > 0 ? args[0] : "exp.dll");
        var T = asm.GetType("ExperienciaQueries");
        var leer = T.GetMethod("LeerIniciativas", BindingFlags.NonPublic | BindingFlags.Static);
        var tDet = T.GetNestedType("Detalle", BindingFlags.NonPublic);
        var db = "TrFotoPrueba_" + Guid.NewGuid().ToString("N").Substring(0, 8);

        using (var m = new SqlConnection(Servidor + "Database=master;"))
        {
            m.Open();
            Exec(m, "CREATE DATABASE [" + db + "]");
        }
        try
        {
            using (var cn = new SqlConnection(Servidor + "Database=" + db + ";"))
            {
                cn.Open();
                Exec(cn, @"
CREATE TABLE dbo.Problem (Codigo nvarchar(100) NOT NULL PRIMARY KEY, Prefijo nvarchar(10) NULL,
    Descripcion nvarchar(max) NULL, Observaciones nvarchar(max) NULL, FechaCreacion date NULL);
CREATE TABLE dbo.CatPrefijoProblem (Prefijo nvarchar(10) NOT NULL PRIMARY KEY, ControlDeFecha bit NOT NULL);
CREATE TABLE dbo.vw_ProblemCategoria (Codigo nvarchar(100), Categoria nvarchar(450), C1 nvarchar(450), C1C2 nvarchar(450),
    Iniciativa nvarchar(500), Titulo nvarchar(500), Estado nvarchar(100), TipoAgrupado nvarchar(100),
    TicketsReduce decimal(29,4), PctDisminucion decimal(9,4),
    FechaAnalisis date, FechaSolucion date, FechaCierre date,
    NroCambioFechaAnalisis int, NroCambioFechaSolucion int, NroCambioFechaCierre int, VigenteEnOrigen bit);
CREATE TABLE dbo.ExpTicketsReduce (Codigo nvarchar(100) NOT NULL, Categoria nvarchar(450) NOT NULL, Ruta nvarchar(500) NULL,
    Pct decimal(9,4) NULL, Volumen30 int NOT NULL, TicketsReduce int NULL, TicketsReduceExcel int NULL,
    Hoy date NOT NULL, FechaCalculo datetime2(0) NOT NULL);");

                // Volumen 30 dias = 400 en todas. Fila: % y TicketsReduce de
                // ProblemCategoria (Admin ya recalculo). Foto: % y valor del 65.
                var casos = new[]
                {
                    //       folio,             % fila,  TR fila, foto?, % foto, TR foto
                    new object[] { "PRB 2026-000001", "0.2000", "80",  true,  "0.2000", "81" },  // F1
                    new object[] { "PRB 2026-000002", "0.5000", "200", true,  "0.2000", "80" },  // F2
                    new object[] { "PRB 2026-000003", "0.1000", "40",  false, null,     null },  // F3
                    new object[] { "PRB 2026-000004", null,     null,  true,  "0.2000", "80" },  // F4
                    new object[] { "PRB 2026-000005", null,     null,  true,  null,     "7" },   // F5
                };
                foreach (var c in casos)
                {
                    Exec(cn, "INSERT dbo.Problem (Codigo, Prefijo, FechaCreacion) VALUES (N'" + c[0] + "', N'PRB', '2026-10-01')");
                    Exec(cn, "INSERT dbo.vw_ProblemCategoria (Codigo, Categoria, C1, C1C2, Titulo, Estado, TipoAgrupado, " +
                             "TicketsReduce, PctDisminucion, VigenteEnOrigen) VALUES (N'" + c[0] + "', N'/A/B', N'/A', N'/A/B', N'T', " +
                             "N'Abierto', N'Problem', " + (c[2] ?? "NULL") + ", " + (c[1] ?? "NULL") + ", 1)");
                    if ((bool)c[3])
                        Exec(cn, "INSERT dbo.ExpTicketsReduce (Codigo, Categoria, Pct, Volumen30, TicketsReduce, Hoy, FechaCalculo) " +
                                 "VALUES (N'" + c[0] + "', N'/A/B', " + (c[4] ?? "NULL") + ", 400, " + (c[5] ?? "NULL") + ", '2026-10-18', '2026-10-18')");
                }
                Exec(cn, "INSERT dbo.CatPrefijoProblem VALUES (N'PRB', 1)");

                var tr = Leer(leer, tDet, cn);
                Check("F1 foto con el mismo % -> foto", 81, tr["PRB 2026-000001"]);
                Check("F2 % cambiado tras la foto -> fila", 200, tr["PRB 2026-000002"]);
                Check("F3 sin foto -> fila", 40, tr["PRB 2026-000003"]);
                Check("F4 % vaciado tras la foto -> fila", 0, tr["PRB 2026-000004"]);
                Check("F5 foto y fila sin % -> foto", 7, tr["PRB 2026-000005"]);

                Exec(cn, "DROP TABLE dbo.ExpTicketsReduce");
                tr = Leer(leer, tDet, cn);
                Check("F6 sin ExpTicketsReduce -> fila", 80, tr["PRB 2026-000001"]);
            }
        }
        finally
        {
            using (var m = new SqlConnection(Servidor + "Database=master;"))
            {
                m.Open();
                Exec(m, "ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]");
            }
        }
        Console.WriteLine(pasadas + "/" + (pasadas + fallas) + " pasadas");
        return fallas == 0 ? 0 : 1;
    }

    static Dictionary<string, int> Leer(MethodInfo leer, Type tDet, SqlConnection cn)
    {
        var salida = new Dictionary<string, int>();
        foreach (var d in (IEnumerable)leer.Invoke(null, new object[] { cn, new DateTime(2026, 10, 19) }))
            salida[(string)tDet.GetField("Folio").GetValue(d)] = (int)tDet.GetField("TicketsReduce").GetValue(d);
        return salida;
    }
}
