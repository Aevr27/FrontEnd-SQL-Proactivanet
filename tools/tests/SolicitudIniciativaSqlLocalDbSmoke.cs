// Prueba de INTEGRACION de sql/29_solicitud_iniciativa.sql (+ _rollback) con
// App_Code/SolicitudIniciativaAlta.cs (AlmacenSolicitudesSql) e
// IniciativaService, contra una base REAL pero DESECHABLE de SQL Server
// LocalDB: crea GestionAdminPrueba_Sol<n> con la replica de dbo
// (tools/tests/GestionAdminLocalDb_replica.sql), el esquema adm y la cuenta
// del sitio como en la VM (db_datareader + db_datawriter + EXECUTE sobre
// adm); corre los casos y BORRA la base al final. Nunca toca la VM ni
// Tickets_Proactivanet.
//
// Casos (prefijo del rotulo):
//   G  migracion: guarda (otra base sin aprobar), deteccion antes/despues,
//      4 objetos y 9 DENY, contador en 0, volver a aplicar no toca nada.
//   R  crear: #0000001 con la foto de los correos y evento ENVIADA; mismo
//      token = misma solicitud; token de otra cuenta 51409; correos que no
//      son de UNA persona vigente 51405/51406 (y el contador no avanza);
//      faltantes 51401-51404.
//   F  foto: cambiar CatPersona (correo, vigencia) y CatCategoriaDueno
//      despues NO cambia lo guardado.
//   E  de punta a punta: IniciativaService con el almacen y CatPersona de la
//      base: el folio queda con el solicitante y el PO correctos.
//   P  cuenta del sitio: crea por el procedimiento, NO escribe las tablas a
//      mano (229).
//   C  concurrencia: 8 borradores distintos a la vez = 8 numeros seguidos;
//      8 envios del MISMO borrador = 1 solicitud.
//   B  rollback: se niega con datos; con la bandera quita todo; reaplicar.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Data.dll; correr con cwd = raiz.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

public static class SolicitudIniciativaSqlLocalDbSmoke
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
    static void Exec(string sql) { using (var cn = Abrir(Base)) Exec(cn, sql); }
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
    static string LotesError(SqlConnection cn, string sql)
    {
        try { Lotes(cn, sql); return "sin error"; }
        catch (SqlException ex) { return ex.Number + ":" + ex.Message; }
        finally { Exec(cn, "SET NOEXEC OFF; IF @@TRANCOUNT > 0 ROLLBACK;"); }
    }
    static string Leer(params string[] ruta) { return File.ReadAllText(Path.Combine(ruta)); }
    static void Borrar(string db)
    {
        using (var m = Abrir("master"))
            Exec(m, "IF DB_ID(N'" + db + "') IS NOT NULL BEGIN ALTER DATABASE [" + db + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + db + "]; END");
    }
    static string Error(Action a)
    {
        try { a(); return "sin error"; }
        catch (ErrorSolicitud ex) { return ex.Numero.ToString(); }
        catch (SqlException ex) { return ex.Number.ToString(); }
    }
    static int Cuenta(string tabla) { return int.Parse(Uno("SELECT COUNT(*) FROM " + tabla)); }

    static AlmacenSolicitudesSql Sitio() { return new AlmacenSolicitudesSql(ComoSitio); }

    static AltaSolicitud Alta(string cuenta, Guid token, string solCorreo = "andresvr@soriana.com", string poCorreo = "jesuscamor@soriana.com")
    {
        return new AltaSolicitud
        {
            Cuenta = cuenta, Token = token, Tipo = "ADO", Po = "Jesus Campa Morones", So = "Edgar Ramos Davalos",
            Categoria = "/A/Cat 1", Director = "Dir 1", Titulo = "T", Descripcion = "D", Observaciones = "O",
            Volumetria = 120, Pct = 0.2000m, RcaExtension = null,
            SolicitanteNombre = "Andres Vera Rios", SolicitanteCorreo = solCorreo, ProductOwnerCorreo = poCorreo,
        };
    }

    public static int Main()
    {
        Base = "GestionAdminPrueba_Sol" + Environment.TickCount.ToString().Replace("-", "");
        var guarda = "SolicitudGuarda" + Environment.TickCount.ToString().Replace("-", "");
        var sql29 = Leer("sql", "29_solicitud_iniciativa.sql");
        var rb29 = Leer("sql", "29_solicitud_iniciativa_rollback.sql");
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
                         "(N'Andres Vera Rios', N'  AndresVR@Soriana.com ', 1)," +
                         "(N'Jesus Campa Morones', N'jesuscamor@soriana.com', 1)," +
                         "(N'Jesus Campa', N'jcampa@soriana.com', 1)," +
                         "(N'Ana Uno', N'compartido@soriana.com', 1)," +
                         "(N'Ana Dos', N'compartido@soriana.com', 1)," +
                         "(N'Baja Persona', N'baja@soriana.com', 0);");
            }

            // ---------------- G: migracion ----------------
            Borrar(guarda);
            using (var m = Abrir("master")) Exec(m, "CREATE DATABASE [" + guarda + "]");
            using (var g = Abrir(guarda))
                Check("G1 otra base sin aprobar: migracion y rollback se niegan", "True|True",
                      LotesError(g, sql29).Contains("SIN APROBAR") + "|" + LotesError(g, rb29).Contains("SIN APROBAR"));
            Borrar(guarda);
            Check("G2 deteccion antes de sql/29: no disponible (sin error)", false, Sitio().Disponible());
            using (var cn = Abrir(Base))
            {
                Check("G3 rollback antes de aplicar: se niega", true, LotesError(cn, rb29).Contains("0 de 4"));
                Lotes(cn, sql29);
            }
            Check("G4 aplicada: 4 objetos, 9 DENY de PROACTIVANETAD, UNIQUE del token, contador en 0", "4|9|1|0",
                  Uno("SELECT (CASE WHEN OBJECT_ID('adm.SolicitudIniciativaContador') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.SolicitudIniciativa') IS NULL THEN 0 ELSE 1 END) " +
                      "+ (CASE WHEN OBJECT_ID('adm.SolicitudIniciativaEvento') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.usp_SolicitudIniciativa_Crear') IS NULL THEN 0 ELSE 1 END)") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'PROACTIVANETAD') AND state = 'D' " +
                      "AND major_id IN (OBJECT_ID('adm.SolicitudIniciativaContador'), OBJECT_ID('adm.SolicitudIniciativa'), OBJECT_ID('adm.SolicitudIniciativaEvento'))") + "|" +
                  Uno("SELECT COUNT(*) FROM sys.key_constraints WHERE type = 'UQ' AND name = 'UQ_SolicitudIniciativa_Token'") + "|" +
                  Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"));
            Check("G5 deteccion despues (como el sitio): disponible", true, Sitio().Disponible());
            using (var cn = Abrir(Base))
                Check("G6 volver a aplicar: 'ya aplicada', no toca nada", true, LotesError(cn, sql29).Contains("ya aplicada"));

            // ---------------- R: crear ----------------
            var s = Sitio();
            var t1 = Guid.NewGuid();
            var r1 = s.Crear(Alta(@"SORIANA\andresvr", t1));
            Check("R1 nuevo: #0000001, 1 fila, 1 evento ENVIADA, estado ENVIADA", "#0000001|True|1|1|ENVIADA|ENVIADA|NULL",
                  r1.Numero + "|" + r1.Nuevo + "|" + Cuenta("adm.SolicitudIniciativa") + "|" + Cuenta("adm.SolicitudIniciativaEvento") + "|" +
                  Uno("SELECT Estado FROM adm.SolicitudIniciativa") + "|" + Uno("SELECT EstadoNuevo FROM adm.SolicitudIniciativaEvento") + "|" +
                  Uno("SELECT EstadoAnterior FROM adm.SolicitudIniciativaEvento"));
            Check("R1 foto: cuenta, nombre, correos (minusculas) y fuente", "SORIANA\\andresvr|Andres Vera Rios|andresvr@soriana.com|jesuscamor@soriana.com|CATPERSONA|SORIANA\\andresvr",
                  Uno("SELECT SolicitanteCuenta + '|' + SolicitanteNombre + '|' + SolicitanteCorreo + '|' + ProductOwnerCorreo + '|' + FuenteCorreos FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1") + "|" +
                  Uno("SELECT Usuario FROM adm.SolicitudIniciativaEvento WHERE NumeroSolicitud = 1"));
            Check("R1 campos y token", "ADO|Jesus Campa Morones|Edgar Ramos Davalos|/A/Cat 1|Dir 1|120|0.2000|" + t1.ToString().ToUpperInvariant(),
                  Uno("SELECT TipoIniciativa + '|' + ProductOwner + '|' + ServiceOwner + '|' + Categoria + '|' + Director + '|' + CONVERT(varchar(10), Volumetria) + '|' + CONVERT(varchar(20), PctDisminucion) + '|' + CONVERT(varchar(36), Token) FROM adm.SolicitudIniciativa"));
            var r2 = Sitio().Crear(Alta(@"soriana\ANDRESVR", t1));
            Check("R2 mismo token (otra grafia de la cuenta): misma solicitud, nuevo=false, sin otra fila ni evento", "#0000001|False|1|1|1",
                  r2.Numero + "|" + r2.Nuevo + "|" + Cuenta("adm.SolicitudIniciativa") + "|" + Cuenta("adm.SolicitudIniciativaEvento") + "|" + Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"));
            Check("R3 token de otra cuenta: 51409, nada nuevo", "51409|1",
                  Error(() => Sitio().Crear(Alta(@"SORIANA\otro", t1))) + "|" + Cuenta("adm.SolicitudIniciativa"));
            Check("R4 correo del solicitante inventado / de dos personas / de baja: 51405, contador sin avanzar", "51405|51405|51405|1",
                  Error(() => Sitio().Crear(Alta(@"SORIANA\x", Guid.NewGuid(), "atacante@evil.com"))) + "|" +
                  Error(() => Sitio().Crear(Alta(@"SORIANA\x", Guid.NewGuid(), "compartido@soriana.com"))) + "|" +
                  Error(() => Sitio().Crear(Alta(@"SORIANA\x", Guid.NewGuid(), "baja@soriana.com"))) + "|" + Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"));
            Check("R5 correo del PO inventado: 51406, contador sin avanzar", "51406|1",
                  Error(() => Sitio().Crear(Alta(@"SORIANA\x", Guid.NewGuid(), "andresvr@soriana.com", "po@evil.com"))) + "|" + Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"));
            var sinTitulo = Alta(@"SORIANA\x", Guid.NewGuid()); sinTitulo.Titulo = "  ";
            var pctMal = Alta(@"SORIANA\x", Guid.NewGuid()); pctMal.Pct = 1.5m;
            Check("R6 sin usuario 51401; sin token 51402; sin titulo 51403; % fuera 51404", "51401|51402|51403|51404|1",
                  Error(() => Sitio().Crear(Alta(" ", Guid.NewGuid()))) + "|" + Error(() => Sitio().Crear(Alta(@"SORIANA\x", Guid.Empty))) + "|" +
                  Error(() => Sitio().Crear(sinTitulo)) + "|" + Error(() => Sitio().Crear(pctMal)) + "|" + Cuenta("adm.SolicitudIniciativa"));

            // ---------------- F: foto ----------------
            Exec("UPDATE dbo.CatPersona SET Correo = N'nuevo.correo@soriana.com' WHERE Nombre = N'Jesus Campa Morones';" +
                 "UPDATE dbo.CatPersona SET VigenteEnOrigen = 0 WHERE Nombre = N'Andres Vera Rios';" +
                 "UPDATE dbo.CatCategoriaDueno SET ProductOwner = N'Otra Persona';");
            Check("F1 directorio y duenos cambiados despues: la solicitud guardada no cambia",
                  "andresvr@soriana.com|jesuscamor@soriana.com|Andres Vera Rios|Jesus Campa Morones",
                  Uno("SELECT SolicitanteCorreo + '|' + ProductOwnerCorreo + '|' + SolicitanteNombre + '|' + ProductOwner FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1"));
            var r2b = Sitio().Crear(Alta(@"SORIANA\andresvr", t1));
            Check("F2 reenviar el mismo borrador despues del cambio: misma solicitud, foto intacta", "#0000001|False|jesuscamor@soriana.com",
                  r2b.Numero + "|" + r2b.Nuevo + "|" + Uno("SELECT ProductOwnerCorreo FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1"));
            Exec("UPDATE dbo.CatPersona SET Correo = N'jesuscamor@soriana.com' WHERE Nombre = N'Jesus Campa Morones';" +
                 "UPDATE dbo.CatPersona SET VigenteEnOrigen = 1 WHERE Nombre = N'Andres Vera Rios';");

            // ---------------- E: de punta a punta ----------------
            var catalogo = new CatalogoSolicitud(new object[] { "ADO" }, new[] {
                new CatalogoSolicitud.Asignacion { Po = "Jesus Campa Morones", So = "Edgar Ramos Davalos", Categoria = "/A/Cat 1", Director = "Dir 1" } });
            var f = new NameValueCollection();
            f["tipo"] = "ADO"; f["po"] = "Jesus Campa Morones"; f["so"] = "Edgar Ramos Davalos"; f["categoria"] = "/A/Cat 1";
            f["titulo"] = "Punta a punta"; f["descripcion"] = "D"; f["observaciones"] = "O"; f["volumetria"] = "7"; f["pct"] = "10";
            f["token"] = Guid.NewGuid().ToString(); f["correo"] = "atacante@evil.com"; f["po_correo"] = "atacante@evil.com";
            var svc = new IniciativaService(new GeneradorNumeroSolicitudPendiente(), Sitio(), new FuentePersonasAcuseSql(ComoSitio));
            var res = svc.Solicitar(SolicitudIniciativa.DesdeFormulario(f, false, null), IdentidadWindows.Desde(@"SORIANA\AndresVR", true),
                                    catalogo, new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]));
            Check("E1 IniciativaService guarda #0000002 con el solicitante y el PO resueltos de la base", "True|True|#0000002",
                  res.Valida + "|" + res.Guardada + "|" + res.Numero);
            Check("E1 la fila #0000002", "Punta a punta|SORIANA\\AndresVR|andresvr@soriana.com|jesuscamor@soriana.com|0.1000",
                  Uno("SELECT Titulo + '|' + SolicitanteCuenta + '|' + SolicitanteCorreo + '|' + ProductOwnerCorreo + '|' + CONVERT(varchar(20), PctDisminucion) FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 2"));
            var res2 = svc.Solicitar(SolicitudIniciativa.DesdeFormulario(f, false, null), IdentidadWindows.Desde(@"SORIANA\andresvr", true),
                                     catalogo, new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]));
            Check("E2 doble envio del mismo borrador: mismo folio, nuevo=false", "#0000002|False|2", res2.Numero + "|" + res2.Nuevo + "|" + Cuenta("adm.SolicitudIniciativa"));
            f["token"] = Guid.NewGuid().ToString();
            var res3 = svc.Solicitar(SolicitudIniciativa.DesdeFormulario(f, false, null), IdentidadWindows.Desde(@"SORIANA\t_andresvr", true),
                                     catalogo, new CapacidadCategoria(new CapacidadCategoria.Compromiso[0]));
            Check("E3 cuenta que no esta en CatPersona: rechazada, nada guardado", "False|False|solicitante|2",
                  res3.Valida + "|" + res3.Guardada + "|" + res3.Errores[0].Campo + "|" + Cuenta("adm.SolicitudIniciativa"));

            // ---------------- P: cuenta del sitio ----------------
            foreach (var sql in new[] {
                "INSERT adm.SolicitudIniciativaEvento (NumeroSolicitud, Evento, EstadoNuevo, Usuario) VALUES (1, 'ENVIADA', 'ENVIADA', N'x')",
                "UPDATE adm.SolicitudIniciativa SET ProductOwnerCorreo = N'otro@soriana.com' WHERE NumeroSolicitud = 1",
                "DELETE FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1",
                "UPDATE adm.SolicitudIniciativaContador SET Ultimo = 0" })
            {
                string err;
                using (var cn = ComoSitio())
                    try { Exec(cn, sql); err = "sin error"; } catch (SqlException ex) { err = ex.Number.ToString(); }
                Check("P1 el sitio NO escribe a mano: " + sql.Substring(0, 40), "229", err);
            }
            Check("P2 la foto sigue intacta", "jesuscamor@soriana.com|2", Uno("SELECT ProductOwnerCorreo FROM adm.SolicitudIniciativa WHERE NumeroSolicitud = 1") + "|" + Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"));

            // ---------------- C: concurrencia ----------------
            var numeros = new List<int>(); var errores = new List<string>();
            var hilos = Enumerable.Range(0, 8).Select(k => new Thread(() =>
            {
                try { var g = Sitio().Crear(Alta(@"SORIANA\andresvr", Guid.NewGuid())); lock (numeros) numeros.Add(g.Numero.Valor); }
                catch (Exception ex) { lock (errores) errores.Add(ex.Message); }
            })).ToList();
            hilos.ForEach(t => t.Start()); hilos.ForEach(t => t.Join());
            numeros.Sort();
            Check("C1 8 borradores a la vez: 8 numeros distintos y seguidos (3..10), sin errores", "3,4,5,6,7,8,9,10|0",
                  string.Join(",", numeros.Select(n => n.ToString()).ToArray()) + "|" + errores.Count);
            var mismo = Guid.NewGuid(); var nuevos = 0; errores.Clear();
            hilos = Enumerable.Range(0, 8).Select(k => new Thread(() =>
            {
                try { if (Sitio().Crear(Alta(@"SORIANA\andresvr", mismo)).Nuevo) Interlocked.Increment(ref nuevos); }
                catch (Exception ex) { lock (errores) errores.Add(ex.Message); }
            })).ToList();
            hilos.ForEach(t => t.Start()); hilos.ForEach(t => t.Join());
            Check("C2 el MISMO borrador 8 veces a la vez: 1 solicitud, 1 nuevo, sin errores", "1|1|0",
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa WHERE Token = '" + mismo + "'") + "|" + nuevos + "|" + errores.Count);
            Check("C3 cada solicitud tiene exactamente un evento", "0",
                  Uno("SELECT COUNT(*) FROM adm.SolicitudIniciativa s WHERE (SELECT COUNT(*) FROM adm.SolicitudIniciativaEvento e WHERE e.NumeroSolicitud = s.NumeroSolicitud) <> 1"));

            // ---------------- B: rollback ----------------
            using (var cn = Abrir(Base))
            {
                Check("B1 rollback con solicitudes: se niega y no toca nada", "True|4",
                      LotesError(cn, rb29).Contains("Se perderian") + "|" +
                      Uno("SELECT (CASE WHEN OBJECT_ID('adm.SolicitudIniciativaContador') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.SolicitudIniciativa') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.SolicitudIniciativaEvento') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.usp_SolicitudIniciativa_Crear') IS NULL THEN 0 ELSE 1 END)"));
                Exec(cn, "EXEC sys.sp_set_session_context N'rollback_29_perder_solicitudes', N'SI';");
                Lotes(cn, rb29);
            }
            Check("B2 con la bandera: quita las 4 piezas; deteccion vuelve a false", "0|False",
                  Uno("SELECT (CASE WHEN OBJECT_ID('adm.SolicitudIniciativaContador') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.SolicitudIniciativa') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.SolicitudIniciativaEvento') IS NULL THEN 0 ELSE 1 END) + (CASE WHEN OBJECT_ID('adm.usp_SolicitudIniciativa_Crear') IS NULL THEN 0 ELSE 1 END)") + "|" +
                  Sitio().Disponible());
            using (var cn = Abrir(Base)) Lotes(cn, sql29);
            Check("B3 reaplicar despues del rollback: disponible, contador en 0", "True|0", Sitio().Disponible() + "|" + Uno("SELECT Ultimo FROM adm.SolicitudIniciativaContador"));
        }
        catch (Exception ex)
        {
            fallos++;
            Console.WriteLine("FAIL  excepcion: " + ex);
        }
        finally
        {
            try { Borrar(Base); Borrar(guarda); } catch (Exception ex) { Console.WriteLine("aviso: no se borro la base: " + ex.Message); }
        }
        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
