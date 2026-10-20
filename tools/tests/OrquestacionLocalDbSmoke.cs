// Smoke de App_Code/OrquestacionQueries.cs contra LocalDB, con el esquema orq
// de mentira de OrquestacionLocalDb_stub.sql y las vistas del
// sql/77_tablero_orquestacion.sql. Lo corre tools/tests/OrquestacionLocalDb.sh.
//
// Comprueba el contrato del handler (lo que lee orquestacion.js) y escribe la
// respuesta en el archivo del primer argumento para que
// OrquestacionLocalDbSmoke.js la pase por OrquestacionCalc.
//
// La cadena de conexion sale del .exe.config (clave TicketsProactivanet), como
// en el sitio.

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

public static class OrquestacionLocalDbSmoke
{
    static int fallos = 0;

    static void Check(string nombre, object esperado, object obtenido)
    {
        var ok = Equals(Convert.ToString(esperado), Convert.ToString(obtenido));
        if (!ok) fallos++;
        Console.WriteLine((ok ? "ok    " : "FAIL  ") + nombre + "  esperado=" + esperado + "  obtenido=" + obtenido);
    }

    static Dictionary<string, object> Tabla(object t) { return (Dictionary<string, object>)t; }
    static int Filas(object t) { return ((ICollection)Tabla(t)["filas"]).Count; }

    // Valor de una columna en el renglon cuyo JobId es id.
    static object Celda(object t, int id, string col)
    {
        var tab = Tabla(t);
        var cols = (List<string>)tab["cols"];
        int iId = cols.IndexOf("JobId"), iCol = cols.IndexOf(col);
        foreach (object[] f in (IEnumerable)tab["filas"])
            if (Convert.ToInt32(f[iId]) == id) return f[iCol];
        return "(sin renglon)";
    }

    public static int Main(string[] args)
    {
        var r = OrquestacionQueries.Construir();
        Check("hay_datos", true, r["hay_datos"]);

        var carga = (Dictionary<string, object>)r["carga"];
        Check("carga: la ultima APLICADA (no la fallida)", 2, carga["numero"]);
        Check("carga: fecha", "2026-10-17 10:30", carga["fecha"]);
        Check("carga: fecha_dt no sale", false, carga.ContainsKey("fecha_dt"));
        Check("carga: advertencias por tipo, solo del lote 2", 2, ((ICollection)carga["advertencias_por_tipo"]).Count);

        var p = (Dictionary<string, object>)r["parametros"];
        // El stub SI trae los tres costos en orq.Parametro: no deben salir.
        Check("parametro texto -> numero (EjecucionesConsumidasDia)", "System.Double", p["EjecucionesConsumidasDia"].GetType().FullName);
        Check("parametros: solo EjecucionesConsumidasDia", 1, p.Count);
        Check("CostoTareaAnual no sale", false, p.ContainsKey("CostoTareaAnual"));
        Check("CostoJobAnual no sale", false, p.ContainsKey("CostoJobAnual"));
        Check("CostoLicenciaActual no sale", false, p.ContainsKey("CostoLicenciaActual"));

        Check("jobs: solo los vigentes", 5, Filas(r["jobs"]));
        Check("decomisos: solo los vigentes", 2, Filas(r["decomisos"]));
        Check("historico", 2, Filas(r["historico"]));
        Check("campos: los 14 de W a AJ", 14, ((ICollection)r["campos"]).Count);
        Check("campos: acento intacto", "Reducci\u00F3n posible de ejecuciones",
            ((Dictionary<string, object>)((IList)r["campos"])[0])["nombre"]);

        Check("JOB_A: Campos (Horario N/A = relleno)", "22122222222222", Celda(r["jobs"], 1, "Campos"));
        Check("JOB_B: Campos con vacios", "02020020022020", Celda(r["jobs"], 2, "Campos"));
        Check("JOB_C: relleno repetido por acento no duplica el campo", "00000000022120", Celda(r["jobs"], 3, "Campos"));
        Check("JOB_A: OrqCompleto", 1, Celda(r["jobs"], 1, "OrqCompleto"));
        Check("JOB_D: sin nombre de SLA (N/A) no orquesta", 0, Celda(r["jobs"], 4, "OrqCompleto"));
        Check("JOB_D: Clasif Unica", "\u00DAnica", Celda(r["jobs"], 4, "Clasif"));
        Check("JOB_E: candidato vacio", "(vac\u00EDo)", Celda(r["jobs"], 5, "Candidato"));
        Check("Prom DECIMAL -> double", "System.Double", Celda(r["jobs"], 1, "Prom").GetType().FullName);

        var d = OrquestacionQueries.Detalle();
        Check("detalle: hay_datos", true, d["hay_datos"]);
        Check("detalle: renglones", 5, Filas(d["detalle"]));
        Check("detalle JOB_B: advertencias del lote 2", "Nombre repetido; Promedio no numerico",
            Celda(d["detalle"], 2, "Advertencias"));
        Check("detalle JOB_A: sin advertencias de otros lotes", null, Celda(d["detalle"], 1, "Advertencias"));
        Check("detalle JOB_A: responsables fuera de Datos", 1, Celda(d["detalle"], 1, "PersonasFueraDeDatos"));
        Check("detalle JOB_D: aplicacion fuera del catalogo", 0, Celda(d["detalle"], 4, "AplicacionEnCatalogo"));
        Check("detalle JOB_E: sin aplicacion = null", null, Celda(d["detalle"], 5, "AplicacionEnCatalogo"));

        var json = new JavaScriptSerializer();
        json.MaxJsonLength = int.MaxValue;
        if (args.Length > 0)
            File.WriteAllText(args[0], json.Serialize(new Dictionary<string, object> { { "r", r }, { "d", d } }));

        Console.WriteLine();
        Console.WriteLine(fallos == 0 ? "TODO PASA" : fallos + " caso(s) FALLARON");
        return fallos == 0 ? 0 : 1;
    }
}
