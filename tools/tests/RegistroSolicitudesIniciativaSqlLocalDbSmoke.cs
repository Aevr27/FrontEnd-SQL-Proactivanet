// Prueba de INTEGRACION del registro de solo lectura de Nuevas solicitudes
// (App_Code/RegistroSolicitudesIniciativa.cs, LectorSolicitudesIniciativaSql)
// contra sql/29_solicitud_iniciativa.sql en una base REAL pero DESECHABLE de
// SQL Server LocalDB: crea GestionAdminPrueba_Reg<n> con la replica de dbo
// (tools/tests/GestionAdminLocalDb_replica.sql), el esquema adm y la cuenta
// del sitio como en la VM (db_datareader + db_datawriter + EXECUTE sobre
// adm); corre los casos COMO la cuenta del sitio y BORRA la base al final.
// Nunca toca la VM ni Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   T  tablas: antes de sql/29 no disponible (sin error); despues, si.
//   V  vacio: total 0, lista vacia, detalle null.
//   P  persistencia: lo que guarda adm.usp_SolicitudIniciativa_Crear lo lee
//      un lector NUEVO con conexion nueva (como tras reiniciar el sitio o
//      cambiar de PC): orden, campos, foto de correos, fecha UTC.
//   H  historial: el evento ENVIADA con su usuario; estado = ultimo evento.
//   E  datos existentes: una fila con RCA y % con decimales, escrita como
//      dbo (no por el sitio), se lee igual.
//   X  tope: Listar(2) de 3 = 2 filas y total 3.
//   M  Mis solicitudes: ListarDe / DetalleDe solo con las de UNA cuenta.
//   S  solo lectura: leer no cambia ninguna tabla.
//   F  la base falla: una base que no existe LANZA (no es "sin tablas").
//
// Compilar (como SolicitudIniciativaSqlLocalDbSmoke): App_Code\*.cs en
// adm.dll y este archivo con /r:adm.dll /r:System.Core.dll /r:System.Data.dll;
// correr con cwd = raiz del repo.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Text.RegularExpressions;

public static class RegistroSolicitudesIniciativaSqlLocalDbSmoke
{
    const string Servidor = @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;";
    static string Base;
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    static SqlConnection Abrir(string db)
    {
        var cn = new SqlConnection(Servidor + "Database=" + db + ";Pooling=false;");
        cn.Open();
        return cn;
    }
    static SqlConnection ComoSitio()
    {
        var cn = Abrir(Base);
        Exec(cn, "EXECUTE AS USER = N'PROACTIVANETAD';");
        return cn;
    }
    static void Exec(SqlConnection cn, string sql) { using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 }) c.ExecuteNonQuery(); }
    static string Uno(string sql)
    {
        using (var cn = Abrir(Base)) using (var c = new SqlCommand(sql, cn) { CommandTimeout = 120 })
        {
            var v = c.ExecuteScalar();
            return v == null || v == DBNull.Value ? "NULL" : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
        }
    }
    static void Lotes(SqlConnection cn, string sql)
    {
        foreach (var lote in Regex.Split(sql, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (lote.Trim().Length > 0) Exec(cn, lote);
    }
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }

    // Un lector NUEVO cada vez, con su propia conexion: nada queda en memoria.
    static LectorSolicitudesIniciativaSql Lector() { return new LectorSolicitudesIniciativaSql(ComoSitio); }

    static AltaSolicitud Alta(string titulo, string so)
    {
        return new AltaSolicitud
        {
            Cuenta = @"SORIANA\andresvr", Token = Guid.NewGuid(), Tipo = "ADO", Po = "Jesus Campa Morones", So = so,
            Categoria = "/A/Cat 1", Director = "Dir 1", Titulo = titulo, Descripcion = "D " + titulo, Observaciones = "O " + titulo,
            Volumetria = 120, Pct = 0.2000m, RcaExtension = null,
            SolicitanteNombre = "Andres Vera Rios", SolicitanteCorreo = "andresvr@soriana.com", ProductOwnerCorreo = "jesuscamor@soriana.com",
        };
    }

    static string Conteos()
    {
        return Uno("SELECT CONVERT(varchar(10), (SELECT COUNT(*) FROM adm.SolicitudIniciativa)) + '|' + " +
                   "CONVERT(varchar(10), (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento)) + '|' + " +
                   "CONVERT(varchar(10), (SELECT Ultimo FROM adm.SolicitudIniciativaContador))");
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_Reg" + Environment.TickCount.ToString().Replace("-", "");
        try
        {
            Borrar(Base);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + Base + "]");
            using (var cn = Abrir(Base))
            {
                Lotes(cn, Leer("tools", "tests", "GestionAdminLocalDb_replica.sql"));
                Exec(cn, "IF SCHEMA_ID(N'adm') IS NULL EXEC (N'CREATE SCHEMA adm');");
                Exec(cn, "CREATE USER [PROACTIVANETAD] WITHOUT LOGIN; ALTER ROLE db_datareader ADD MEMBER [PROACTIVANETAD]; " +
                         "ALTER ROLE db_datawriter ADD MEMBER [PROACTIVANETAD]; GRANT EXECUTE ON SCHEMA::adm TO [PROACTIVANETAD];");
                Exec(cn, "DELETE FROM dbo.CatPersona;" +
                         "INSERT dbo.CatPersona (Nombre, Correo, VigenteEnOrigen) VALUES " +
                         "(N'Andres Vera Rios', N'andresvr@soriana.com', 1), (N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1);");
            }

            // ---------------- T: tablas ----------------
            Check("T1 antes de sql/29: no disponible y sin error", false, Lector().Disponible());
            using (var cn = Abrir(Base)) Lotes(cn, Leer("sql", "29_solicitud_iniciativa.sql"));
            Check("T2 despues de sql/29 (como la cuenta del sitio): disponible", true, Lector().Disponible());

            // ---------------- V: vacio ----------------
            var l = Lector().Listar(200);
            Check("V1 sin solicitudes: total 0 y lista vacia", "0|0", l.Total + "|" + l.Solicitudes.Count);
            Check("V2 detalle de un numero que no existe: null", true, Lector().Detalle(1) == null);

            // ---------------- P: persistencia ----------------
            var almacen = new AlmacenSolicitudesSql(ComoSitio);
            var g1 = almacen.Crear(Alta("Uno", "SO 1"));
            var g2 = almacen.Crear(Alta("Dos", "SO 2"));
            var g3 = almacen.Crear(Alta("Tres", "SO 3"));
            Check("P0 guardadas por el procedimiento real: #1..#3", "#0000001|#0000002|#0000003", g1.Numero + "|" + g2.Numero + "|" + g3.Numero);
            l = Lector().Listar(200);
            var orden = new List<string>();
            foreach (var s in l.Solicitudes) orden.Add((string)s["numero_texto"]);
            Check("P1 un lector nuevo las lee: total 3, mas recientes primero", "3|#0000003,#0000002,#0000001", l.Total + "|" + string.Join(",", orden.ToArray()));
            var f = l.Solicitudes[2];
            Check("P2 campos de la lista (tipo, titulo, solicitante, PO, SO, categoria, estado)",
                  @"1|ADO|Uno|Andres Vera Rios|andresvr@soriana.com|SORIANA\andresvr|Jesus Campa Morones|jesuscamor@soriana.com|SO 1|/A/Cat 1|Dir 1|ENVIADA|1",
                  f["numero"] + "|" + f["tipo"] + "|" + f["titulo"] + "|" + f["solicitante_nombre"] + "|" + f["solicitante_correo"] + "|" +
                  f["solicitante_cuenta"] + "|" + f["po"] + "|" + f["po_correo"] + "|" + f["so"] + "|" + f["categoria"] + "|" + f["director"] + "|" +
                  f["estado"] + "|" + f["eventos_total"]);
            var fecha = (string)f["fecha_utc"];
            var guardada = DateTime.SpecifyKind(g1.FechaUtc, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss") + "Z";
            Check("P3 fecha de envio: la de la base, en UTC con Z", guardada, fecha);

            var d = Lector().Detalle(2);
            Check("P4 detalle: descripcion, observaciones, volumetria, % (en %), RCA y fuente",
                  "#0000002|Dos|D Dos|O Dos|120|20||CATPERSONA",
                  d["numero_texto"] + "|" + d["titulo"] + "|" + d["descripcion"] + "|" + d["observaciones"] + "|" + d["volumetria"] + "|" +
                  d["pct"] + "|" + d["rca_extension"] + "|" + d["fuente_correos"]);

            // ---------------- H: historial ----------------
            var ev = (List<object>)d["eventos"];
            var e0 = (Dictionary<string, object>)ev[0];
            Check("H1 historial: un evento ENVIADA (NULL -> ENVIADA) por la cuenta que envio", @"1|ENVIADA||ENVIADA|SORIANA\andresvr|True",
                  ev.Count + "|" + e0["evento"] + "|" + e0["estado_anterior"] + "|" + e0["estado_nuevo"] + "|" + e0["usuario"] + "|" +
                  ((string)e0["fecha_utc"]).EndsWith("Z"));
            var coherentes = true;
            foreach (var s in Lector().Listar(200).Solicitudes)
            {
                var dd = Lector().Detalle((int)s["numero"]);
                var evs = (List<object>)dd["eventos"];
                var ultimo = (Dictionary<string, object>)evs[evs.Count - 1];
                if ((string)ultimo["estado_nuevo"] != (string)dd["estado"] || evs.Count != (int)s["eventos_total"]) coherentes = false;
            }
            Check("H2 en todas: estado = ultimo evento y eventos_total = largo del historial", true, coherentes);

            // ---------------- E: datos existentes ----------------
            using (var cn = Abrir(Base))
                Exec(cn, "INSERT adm.SolicitudIniciativa (NumeroSolicitud, Token, Estado, TipoIniciativa, ProductOwner, ServiceOwner, Categoria, Director, " +
                         "Titulo, Descripcion, Observaciones, Volumetria, PctDisminucion, RcaExtension, SolicitanteCuenta, SolicitanteNombre, " +
                         "SolicitanteCorreo, ProductOwnerCorreo, FuenteCorreos, FechaUtc) VALUES (" +
                         "142, NEWID(), 'ENVIADA', N'PRB', N'Jesús Campa', N'SO Ñ', N'/B/Cat á', N'Dir', N'Título <b>', N'D', N'O', 0, 0.125, N'PDF', " +
                         "N'SORIANA\\otro', N'Otra Persona', N'otra@soriana.com', N'jesuscamor@soriana.com', 'CATPERSONA', '2026-10-01T08:30:00');" +
                         "INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoAnterior, EstadoNuevo, Usuario, FechaUtc) " +
                         "VALUES (142, 'ENVIADA', NULL, 'ENVIADA', N'SORIANA\\otro', '2026-10-01T08:30:00');");
            d = Lector().Detalle(142);
            Check("E1 fila existente (escrita fuera del sitio): acentos, RCA, % con decimales y fecha intactos",
                  "#0000142|Título <b>|Jesús Campa|SO Ñ|/B/Cat á|0|12.5|PDF|2026-10-01T08:30:00Z|1",
                  d["numero_texto"] + "|" + d["titulo"] + "|" + d["po"] + "|" + d["so"] + "|" + d["categoria"] + "|" + d["volumetria"] + "|" +
                  d["pct"] + "|" + d["rca_extension"] + "|" + d["fecha_utc"] + "|" + ((List<object>)d["eventos"]).Count);
            l = Lector().Listar(200);
            Check("E2 y aparece primero en la lista (numero mas alto)", "4|#0000142", l.Total + "|" + l.Solicitudes[0]["numero_texto"]);

            // ---------------- X: tope ----------------
            l = Lector().Listar(2);
            Check("X1 Listar(2) de 4: 2 filas y total 4", "2|4", l.Solicitudes.Count + "|" + l.Total);
            Check("X2 el tope se acota a 1..500", "1|4", Lector().Listar(0).Solicitudes.Count + "|" + Lector().Listar(100000).Solicitudes.Count);

            // ---------------- M: Mis solicitudes (solo las de una cuenta) ----------------
            Func<LecturaSolicitudesIniciativa, string> nums = delegate (LecturaSolicitudesIniciativa x)
            {
                var r = new List<string>();
                foreach (var s in x.Solicitudes) r.Add(Convert.ToString(s["numero"]));
                return x.Total + ":" + string.Join(",", r.ToArray());
            };
            Check("M1 ListarDe: solo las de la cuenta, sin distinguir mayusculas, mas recientes primero", "3:3,2,1",
                  nums(Lector().ListarDe(@"soriana\ANDRESVR", 200)));
            Check("M2 ListarDe de otra cuenta: solo la suya; sin solicitudes: 0", @"1:142|0:",
                  nums(Lector().ListarDe(@"SORIANA\otro", 200)) + "|" + nums(Lector().ListarDe(@"SORIANA\nadie", 200)));
            Check("M3 ListarDe respeta el tope (total = las de la cuenta)", "3:3", nums(Lector().ListarDe(@"SORIANA\andresvr", 1)));
            var mia = Lector().DetalleDe(2, @"SORIANA\andresvr");
            Check("M4 DetalleDe de la suya: la solicitud con su historial", "#0000002|1",
                  mia == null ? "null" : mia["numero_texto"] + "|" + ((List<object>)mia["eventos"]).Count);
            Check("M5 DetalleDe de una de otra cuenta: null (como si no existiera)", true, Lector().DetalleDe(142, @"SORIANA\andresvr") == null);
            string sinCuenta;
            try { Lector().ListarDe(null, 200); sinCuenta = "sin error"; }
            catch (ArgumentNullException) { sinCuenta = "ArgumentNullException"; }
            Check("M6 sin cuenta no se lista nada (nunca 'todas')", "ArgumentNullException", sinCuenta);

            // ---------------- S: solo lectura ----------------
            var antes = Conteos();
            Lector().Listar(200); Lector().Detalle(1); Lector().Detalle(142); Lector().Disponible();
            Lector().ListarDe(@"SORIANA\andresvr", 200); Lector().DetalleDe(1, @"SORIANA\andresvr");
            Check("S1 leer no cambia solicitudes, eventos ni contador", antes, Conteos());

            // ---------------- F: la base falla ----------------
            string resultado;
            try
            {
                new LectorSolicitudesIniciativaSql(delegate
                {
                    return new SqlConnection(Servidor + "Database=NoExiste_" + Base + ";Pooling=false;Connect Timeout=5;");
                }).Disponible();
                resultado = "sin error";
            }
            catch (SqlException) { resultado = "SqlException"; }
            Check("F1 base inaccesible: Disponible LANZA (500), no responde 'sin tablas' (501)", "SqlException", resultado);
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); } catch (Exception ex) { Console.WriteLine("(no se pudo borrar " + Base + ": " + ex.Message + ")"); }
        }
        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
