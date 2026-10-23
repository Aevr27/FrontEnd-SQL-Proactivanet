// Registro de iniciativas de admin/iniciativas.html (vista Iniciativas).
//
// Es una SEGUNDA PROYECCION de los mismos datos de Experiencia, no una
// segunda implementacion: vive en la misma clase (ExperienciaQueries es
// partial solo por esto) para llamar a sus privados tal cual, sin copiarlos.
//
// QUE SE REUSA, SIN CAMBIOS
// -------------------------
//   LeerIniciativas              el mismo SELECT a dbo.vw_ProblemCategoria +
//                                dbo.Problem + dbo.CatPrefijoProblem, con la
//                                misma deduplicacion por (Codigo, Categoria),
//                                Canonizar y Semaforo (activa, retrasada,
//                                sem_fecha, ControlDeFecha por prefijo).
//   AlinearDuenos                los dueños de cada fila = los de su
//                                categoria (DirectorioOrganizacional).
//   LeerIniciativasSinCategoria  las que no tienen categoria, con los dueños
//                                del propio Problem.
//   Iniciativa(...)              la forma de una iniciativa del contrato de
//                                Experiencia: folio, titulo, agrup, estado,
//                                tickets_reduce, vol_reduce_folio,
//                                riesgo_folio, retrazado, fechas, contadores,
//                                po/so/director/manager, sem_fecha,
//                                descripcion, observaciones...
//   EsActiva / EsAgrupador       la eligibilidad de ini_total / ret y de las
//                                tablas Activas / Vencidas de experiencia.js.
//
// QUE AGREGA ESTA PROYECCION
// --------------------------
// Experiencia muestra una iniciativa DENTRO de una rama de categoria; aqui el
// registro es por folio, asi que la "rama" es el folio entero:
//
//   tickets_reduce = vol_reduce_folio = suma de TicketsReduce de sus filas
//                    (Codigo, Categoria) ya deduplicadas -la misma suma que
//                    reducePorFolio en ArmarCategorias-.
//   riesgo_folio   lo calcula Iniciativa(): vol_reduce_folio si va retrasada.
//   categorias     una fila por (Codigo, Categoria): tickets_reduce y
//                  pct_dism de esa fila (como categorias_por_folio) mas los
//                  dueños de ESA categoria, que es con lo que se filtra.
//                  n2: la CategoriaN2 de dbo.CatCategoriaDueno bajo la que
//                  cae la ruta (su C1&C2, la misma llave con la que
//                  AlinearDuenos resuelve los dueños), o null si ese C1&C2 no
//                  tiene fila propia (dueños heredados del C1, o ruta de un
//                  solo nivel). Lo usa la Cobertura de categorias para
//                  colgar la ruta de su categoria del catalogo; no se adivina
//                  ninguna otra.
//   activa         estado en ESTADOS_ACTIVOS.
//   seguimiento    activa y con agrupador de AGRUPADORES: el criterio con el
//                  que Experiencia cuenta Activas y Vencidas.
//   prefijo        dbo.Problem.Prefijo del folio
//                  (DashboardCatalogos.PrefijosPorFolio), o null. Es la llave
//                  del filtro "Tipo de iniciativa" (catalogo
//                  dbo.CatPrefijoProblem, que sale aparte en
//                  `tipos_iniciativa`: [{ prefijo, nombre }]). NO es
//                  Problem.TipoIniciativa (no son uno a uno; no se traduce)
//                  ni `agrup` (TipoAgrupado). Lecturas aparte para no tocar
//                  el SELECT de Experiencia.
//
// Los datos del folio (titulo, agrup, estado, fechas) son los de su PRIMERA
// fila, el mismo criterio que Iniciativas() usa para deduplicar por folio
// dentro de una rama.
//
// QUE NO TRAE, A PROPOSITO
// ------------------------
// Nada de volumen de tickets (vw_TBSlotCAT / vw_TBMesCAT ni la columna
// VolumenUltimos30 de la vista): LeerIniciativas no las pide y aqui tampoco.
// Por eso no hay volumen por categoria. La "Cobertura de categorias" de
// admin/ NO es la pestaña de Experiencia (que es por volumen): cruza en el
// navegador el catalogo de dueños con las iniciativas activas de este
// registro por su `n2`, sin ningun SELECT nuevo.
//
// SOLO LECTURA: los SELECT de LeerIniciativas, LeerIniciativasSinCategoria,
// DirectorioOrganizacional.Cargar, DashboardCatalogos.PrefijosPorFolio,
// DashboardCatalogos.PrefijosIniciativa y HistorialFechas.Leer,
// sobre una conexion.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;

public static partial class ExperienciaQueries
{
    public static Dictionary<string, object> RegistroIniciativas()
    {
        var hoy = DashboardDataInfo.HoyEnPresentacion();

        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();

            var detalle = LeerIniciativas(cn, hoy);
            var dir = DirectorioOrganizacional.Cargar(cn);
            AlinearDuenos(detalle, dir);
            var sueltas = LeerIniciativasSinCategoria(cn, hoy, dir);
            var prefijos = DashboardCatalogos.PrefijosPorFolio(cn);

            var salida = ArmarRegistro(detalle, sueltas, dir, prefijos);
            salida["tipos_iniciativa"] = DashboardCatalogos.PrefijosIniciativa(cn);
            AplicarFechasPropias(salida, LeerFechasPropias(cn));
            AplicarDuenosCapturados(salida, LeerDuenosCapturados(cn));

            // Historial de fechas por folio (App_Code/HistorialFechas.cs). Si
            // no se puede leer, cada iniciativa sale sin historial y
            // historial_estado lo dice; el registro no cambia.
            var historial = HistorialFechas.Leer(cn);
            // Subestado por folio y los valores de Estado/Subestado que ya
            // existen (Modificar los ofrece; no hay catalogo en la base).
            var estados = LeerEstadosProblem(cn);
            foreach (Dictionary<string, object> i in (List<object>)salida["iniciativas"])
            {
                i["historial"] = historial.Para(i["folio"] as string);
                i["historial_categorias"] = historial.CategoriasPara(i["folio"] as string);
                string sub;
                i["subestado"] = estados.SubestadoPorFolio.TryGetValue(i["folio"] as string ?? "", out sub) ? sub : null;
            }
            salida["estados_problem"] = Ordenados(estados.Valores.Estados);
            salida["subestados_problem"] = Ordenados(estados.Valores.Subestados);
            salida["valores_tipo_iniciativa"] = Ordenados(estados.Valores.TiposIniciativa);
            salida["valores_tipo_agrupado"] = Ordenados(estados.Valores.TiposAgrupado);
            salida["historial_estado"] = historial.Estado;
            salida["historial_desde"] = historial.Desde;
            salida["fecha_gen"] = hoy.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
            return salida;
        }
    }

    // Estado y Subestado de dbo.Problem vigente: el Subestado de cada folio
    // (el registro no lo traia) y los valores distintos de cada uno, que son
    // lo unico que Modificar acepta (no hay catalogo ni reglas de transicion
    // en la base). SOLO LECTURA.
    public sealed class EstadosLeidos
    {
        public Dictionary<string, string> SubestadoPorFolio =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public EstadosProblem Valores;
    }

    public static EstadosLeidos LeerEstadosProblem(SqlConnection cn)
    {
        const string SQL =
            "SELECT p.Codigo, LTRIM(RTRIM(p.Estado)), LTRIM(RTRIM(p.Subestado)) " +
            "FROM dbo.Problem AS p WHERE p.VigenteEnOrigen = 1";
        var salida = new EstadosLeidos();
        var estados = new List<string>();
        var subestados = new List<string>();
        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                var folio = Texto(rd.GetValue(0));
                var estado = Texto(rd.GetValue(1));
                var sub = Texto(rd.GetValue(2));
                if (folio != null) salida.SubestadoPorFolio[folio] = sub;
                if (estado != null) estados.Add(estado);
                if (sub != null) subestados.Add(sub);
            }
        }
        // TipoIniciativa (dbo.Problem) y TipoAgrupado (dbo.ProblemCategoria)
        // que ya existen: lo unico que Crear / ligar aceptan declarar.
        var tiposIni = new List<string>();
        var tiposAgr = new List<string>();
        using (var cmd = new SqlCommand(
            "SELECT DISTINCT LTRIM(RTRIM(TipoIniciativa)) FROM dbo.Problem WHERE NULLIF(LTRIM(RTRIM(TipoIniciativa)), N'') IS NOT NULL; " +
            "SELECT DISTINCT LTRIM(RTRIM(TipoAgrupado)) FROM dbo.ProblemCategoria WHERE NULLIF(LTRIM(RTRIM(TipoAgrupado)), N'') IS NOT NULL;", cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read()) { var t = Texto(rd.GetValue(0)); if (t != null) tiposIni.Add(t); }
            rd.NextResult();
            while (rd.Read()) { var t = Texto(rd.GetValue(0)); if (t != null) tiposAgr.Add(t); }
        }
        salida.Valores = new EstadosProblem(estados, subestados, tiposIni, AgrupacionesUnicas(tiposAgr));
        return salida;
    }

    // Una sola grafia por Agrupacion. El DISTINCT de la base distingue
    // acentos (CI_AS): "Adopcion" y "Adopci\u00f3n" salian las dos, y negocio
    // confirmo que son la misma (ver Canonizar). Por Clave (sin acentos ni
    // mayusculas) se queda la grafia de la regla (TiposPorPrefijo, con
    // tilde) SI existe en la base; si ninguna de un grupo es la de la regla,
    // se quedan todas tal cual (no se elige una al azar ni se ofrece una que
    // la base no tenga: el procedimiento la rechazaria, 51012). Solo cambia
    // lo que se OFRECE y se acepta declarar; los datos guardados no se tocan.
    public static List<string> AgrupacionesUnicas(IEnumerable<string> valores)
    {
        var grupos = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var orden = new List<string>();
        foreach (var v in valores ?? new string[0])
        {
            if (string.IsNullOrEmpty(v)) continue;
            var k = Clave(v);
            List<string> g;
            if (!grupos.TryGetValue(k, out g)) { g = new List<string>(); grupos[k] = g; orden.Add(k); }
            if (!g.Contains(v)) g.Add(v);
        }
        var salida = new List<string>();
        foreach (var k in orden)
        {
            var canonica = grupos[k].Find(TiposPorPrefijo.EsAgrupacionCanonica);
            if (canonica != null) salida.Add(canonica);
            else salida.AddRange(grupos[k]);
        }
        return salida;
    }

    private static List<object> Ordenados(IEnumerable<string> valores)
    {
        var lista = new List<string>(valores);
        lista.Sort(StringComparer.Ordinal);
        return new List<object>(lista);
    }

    // Fechas por categoria (sql/18: dbo.ProblemCategoria.FechaCreacionCategoria
    // / FechaAnalisisCategoria) y la fecha de analisis de la INICIATIVA
    // (dbo.Problem.FechaAnalisis). Sin las columnas (sql/18 sin aplicar)
    // ninguna categoria tiene fecha propia: todas heredan. SOLO LECTURA.
    public sealed class FechasPropias
    {
        // folio -> yyyy-MM-dd de dbo.Problem.FechaAnalisis
        public Dictionary<string, string> AnalisisIniciativa =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        // folio + NBSP + ruta normalizada -> { creacion, analisis }
        public Dictionary<string, string[]> PorCategoria =
            new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
    }

    private const string SEP_FECHAS = " ";

    private static FechasPropias LeerFechasPropias(SqlConnection cn)
    {
        var f = new FechasPropias();
        bool columnas;
        using (var cmd = new SqlCommand(
            "SELECT CASE WHEN COL_LENGTH(N'dbo.ProblemCategoria', N'FechaAnalisisCategoria') IS NULL THEN 0 ELSE 1 END", cn))
            columnas = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
        var sql = "SELECT Codigo, FechaAnalisis FROM dbo.Problem WHERE VigenteEnOrigen = 1;" +
            (columnas ? " SELECT Codigo, Categoria, FechaCreacionCategoria, FechaAnalisisCategoria FROM dbo.ProblemCategoria " +
                        "WHERE VigenteEnOrigen = 1 AND FechaAnalisisCategoria IS NOT NULL;" : "");
        using (var cmd = new SqlCommand(sql, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                var folio = Texto(rd.GetValue(0));
                if (folio != null) f.AnalisisIniciativa[folio] = Fecha(rd.GetValue(1));
            }
            if (columnas && rd.NextResult())
            {
                while (rd.Read())
                {
                    var folio = Texto(rd.GetValue(0));
                    var ruta = Normaliza(Texto(rd.GetValue(1)));
                    if (folio == null || ruta == null) continue;
                    f.PorCategoria[folio + SEP_FECHAS + ruta] = new[] { Fecha(rd.GetValue(2)), Fecha(rd.GetValue(3)) };
                }
            }
        }
        return f;
    }

    // Cuelga de cada categoria f_creacion_propia / f_analisis_propia (null =
    // hereda) y deja i["f_analisis"] como la de la INICIATIVA (la primera
    // fila podria ser una categoria con fecha propia). Aparte para probarla
    // sin SQL.
    private static void AplicarFechasPropias(Dictionary<string, object> salida, FechasPropias f)
    {
        foreach (Dictionary<string, object> i in (List<object>)salida["iniciativas"])
        {
            var folio = i["folio"] as string ?? "";
            string fi;
            if (f.AnalisisIniciativa.TryGetValue(folio, out fi)) i["f_analisis"] = fi;
            foreach (Dictionary<string, object> c in (List<object>)i["categorias"])
            {
                string[] propias;
                var hay = f.PorCategoria.TryGetValue(folio + SEP_FECHAS + (c["categoria"] as string ?? ""), out propias);
                c["f_creacion_propia"] = hay ? propias[0] : null;
                c["f_analisis_propia"] = hay ? propias[1] : null;
            }
        }
    }

    // PO / SO CAPTURADOS en la iniciativa (dbo.Problem.OwnerProblem /
    // OwnerServicio; los guarda el alta de Admin desde sql/20). Van aparte de
    // po / so, que siguen siendo los de la categoria (AlinearDuenos) y con
    // los que filtra Experiencia: aqui no se mezclan. null = sin capturar.
    private static Dictionary<string, string[]> LeerDuenosCapturados(SqlConnection cn)
    {
        var d = new Dictionary<string, string[]>(StringComparer.Ordinal);
        using (var cmd = new SqlCommand(
            "SELECT Codigo, OwnerProblem, OwnerServicio FROM dbo.Problem WHERE VigenteEnOrigen = 1;", cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                var folio = Texto(rd.GetValue(0));
                if (folio != null) d[folio] = new[] { Texto(rd.GetValue(1)), Texto(rd.GetValue(2)) };
            }
        }
        return d;
    }

    internal static void AplicarDuenosCapturados(Dictionary<string, object> salida, Dictionary<string, string[]> d)
    {
        foreach (Dictionary<string, object> i in (List<object>)salida["iniciativas"])
        {
            string[] v;
            var hay = d.TryGetValue(i["folio"] as string ?? "", out v);
            i["po_capturado"] = hay ? v[0] : null;
            i["so_capturado"] = hay ? v[1] : null;
        }
    }

    // Aparte de RegistroIniciativas para que tools/tests/RegistroIniciativasSmoke.cs
    // la pruebe sin SQL, con filas armadas a mano.
    private static Dictionary<string, object> ArmarRegistro(
        List<Detalle> detalle, List<object> sueltas, DirectorioOrganizacional dir,
        Dictionary<string, string> prefijos)
    {
        var porFolio = new Dictionary<string, List<Detalle>>(StringComparer.OrdinalIgnoreCase);
        var orden = new List<string>();

        foreach (var d in detalle)
        {
            if (!EsRegistroDeIniciativa(d)) continue;
            List<Detalle> filas;
            if (!porFolio.TryGetValue(d.Folio, out filas))
            {
                filas = new List<Detalle>();
                porFolio[d.Folio] = filas;
                orden.Add(d.Folio);
            }
            filas.Add(d);
        }

        var iniciativas = new List<object>();

        foreach (var folio in orden)
        {
            var filas = porFolio[folio];
            var total = 0;
            var categorias = new List<object>();

            foreach (var d in filas)
            {
                total += d.TicketsReduce;

                var c = new Dictionary<string, object>();
                c["categoria"] = d.Categoria;
                c["agrup"] = d.Agrup;
                // La fecha de analisis EFECTIVA de esta categoria (la de la
                // vista: la propia si la tiene, si no la de la iniciativa).
                c["f_analisis"] = d.FAnalisis;
                c["tickets_reduce"] = d.TicketsReduce;
                c["pct_dism"] = d.PctDisminucion;
                c["po"] = d.Po;
                c["so"] = d.So;
                c["director"] = d.Director;
                c["n2"] = N2De(d, dir);
                categorias.Add(c);
            }

            var primera = filas[0];
            var i = Iniciativa(primera, total, total, dir);
            // Con fechas de analisis por categoria, la iniciativa va
            // retrasada si CUALQUIERA de sus categorias lo va (el semaforo
            // de Experiencia es por categoria). Mientras todas compartan la
            // fecha de la iniciativa, es lo mismo que la primera fila.
            foreach (var d in filas)
            {
                if (!d.Retrasada || primera.Retrasada) continue;
                i["riesgo_folio"] = total;
                i["retrazado"] = 1;
                i["sem_fecha"] = d.SemFecha;
                i["fecha_retrasada"] = true;
                break;
            }
            i["activa"] = primera.Activa;
            i["seguimiento"] = primera.Activa && EsAgrupador(primera.Agrup);
            i["sin_categoria"] = false;
            i["prefijo"] = PrefijoDe(prefijos, folio);
            i["categorias"] = categorias;
            iniciativas.Add(i);
        }

        // Las sin categoria ya vienen con la forma de Iniciativa(). Un folio
        // que ya salio arriba no se repite (como `vistos` en filasBaseAct).
        foreach (Dictionary<string, object> i in sueltas)
        {
            var folio = i["folio"] as string;
            if (string.IsNullOrEmpty(folio) || porFolio.ContainsKey(folio)) continue;

            var activa = EsActiva(i["estado"] as string);
            i["activa"] = activa;
            i["seguimiento"] = activa && EsAgrupador(i["agrup"] as string);
            i["sin_categoria"] = true;
            i["prefijo"] = PrefijoDe(prefijos, folio);
            i["categorias"] = new List<object>();
            iniciativas.Add(i);
        }

        var salida = new Dictionary<string, object>();
        salida["iniciativas"] = iniciativas;
        salida["estados_activos"] = new List<object>(ESTADOS_ACTIVOS);
        salida["agrupadores"] = new List<object>(AGRUPADORES);
        return salida;
    }

    // ------------------------------------------------------------------
    // Columnas extra de "Descargar iniciativas" (admin_iniciativas_registro
    // .ashx?export=1). Solo se piden al pulsar el boton: el registro normal
    // no las lee ni las manda. Columnas verificadas en sys.columns
    // (esquema_bd/02_columnas.tsv, 2026-10-13):
    //   dbo.Problem           Gerencia, Direccion nvarchar(255);
    //                         TipoIniciativa, Prioridad, Impacto nvarchar(100);
    //                         RCA nvarchar(50); VolumetriaOriginal int;
    //                         FechaEntregaPrb datetime2(0)
    //   dbo.ProblemCategoria  TipoTicket, TipoIniciativa nvarchar(100);
    //                         MesReduccion int
    // Todas las vigentes (VigenteEnOrigen = 1, el mismo corte del registro):
    // dos SELECT en una conexion, sin parametros del cliente; el navegador
    // las cruza por folio (y ruta) con lo que ya filtro. SOLO LECTURA.
    // ------------------------------------------------------------------
    private const string SQL_EXPORT_EXTRA =
        "SELECT Codigo, Gerencia, Direccion, TipoIniciativa, Prioridad, Impacto, RCA, " +
        "       VolumetriaOriginal, FechaEntregaPrb " +
        "FROM dbo.Problem WHERE VigenteEnOrigen = 1; " +
        "SELECT Codigo, Categoria, TipoTicket, TipoIniciativa, MesReduccion " +
        "FROM dbo.ProblemCategoria WHERE VigenteEnOrigen = 1;";

    public static Dictionary<string, object> RegistroExportExtra()
    {
        var problemas = new List<object[]>();
        var categorias = new List<object[]>();
        using (var cn = new SqlConnection(DashboardDb.CadenaConexion()))
        {
            cn.Open();
            using (var cmd = new SqlCommand(SQL_EXPORT_EXTRA, cn))
            using (var rd = cmd.ExecuteReader())
            {
                while (rd.Read())
                {
                    var f = new object[9];
                    rd.GetValues(f);
                    problemas.Add(f);
                }
                if (rd.NextResult())
                {
                    while (rd.Read())
                    {
                        var f = new object[5];
                        rd.GetValues(f);
                        categorias.Add(f);
                    }
                }
            }
        }
        return ArmarExportExtra(problemas, categorias);
    }

    // Filas crudas -> { iniciativas: [...], categorias: [...] }. Aparte para
    // probarla sin SQL. La ruta se normaliza como en LeerIniciativas (es la
    // llave con la que el registro la manda) y, si dos rutas crudas quedan
    // iguales, se queda la primera, el mismo criterio. Un int nulo sale
    // null, no 0: no se inventa una volumetria ni un mes.
    private static Dictionary<string, object> ArmarExportExtra(List<object[]> problemas, List<object[]> categorias)
    {
        var ini = new List<object>();
        foreach (var f in problemas)
        {
            var folio = Texto(f[0]);
            if (folio == null) continue;
            var i = new Dictionary<string, object>();
            i["folio"] = folio;
            i["gerencia"] = Texto(f[1]);
            i["direccion"] = Texto(f[2]);
            i["tipo_iniciativa"] = Texto(f[3]);
            i["prioridad"] = Texto(f[4]);
            i["impacto"] = Texto(f[5]);
            i["rca"] = Texto(f[6]);
            i["volumetria_original"] = EnteroONulo(f[7]);
            i["f_entrega_prb"] = Fecha(f[8]);
            ini.Add(i);
        }
        var cats = new List<object>();
        var vistas = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in categorias)
        {
            var folio = Texto(f[0]);
            var ruta = Normaliza(Texto(f[1]));
            if (folio == null || ruta == null || !vistas.Add(folio + SEP_FECHAS + ruta)) continue;
            var c = new Dictionary<string, object>();
            c["folio"] = folio;
            c["categoria"] = ruta;
            c["tipo_ticket"] = Texto(f[2]);
            c["tipo_iniciativa"] = Texto(f[3]);
            c["mes_reduccion"] = EnteroONulo(f[4]);
            cats.Add(c);
        }
        var salida = new Dictionary<string, object>();
        salida["iniciativas"] = ini;
        salida["categorias"] = cats;
        return salida;
    }

    private static object EnteroONulo(object v)
    {
        if (v == null || v is DBNull) return null;
        return Convert.ToInt32(v, CultureInfo.InvariantCulture);
    }

    // La CategoriaN2 capturada para el C1&C2 de la fila (mismo corte que
    // AlinearDuenos), o null.
    private static string N2De(Detalle d, DirectorioOrganizacional dir)
    {
        var c1c2 = !string.IsNullOrEmpty(d.C1C2) ? d.C1C2 : C1C2De(d.Categoria);
        var fila = dir.Categoria(c1c2);
        return fila == null ? null : fila.CategoriaN2;
    }

    private static string PrefijoDe(Dictionary<string, string> prefijos, string folio)
    {
        string p;
        return prefijos != null && prefijos.TryGetValue(folio, out p) ? p : null;
    }
}
