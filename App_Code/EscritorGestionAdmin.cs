// Escritor de la gestion directa de ADM contra los procedimientos de la
// migracion sql/18_gestion_admin_persistencia.sql (adm.usp_GestionAdmin_Crear
// / _Modificar). ESA MIGRACION NO ESTA APLICADA EN LA VM: sin aprobar.
//
// El handler (admin_iniciativas_gestion.ashx) lo llama SOLO si
// PersistenciaGestionAdmin.Activa() (hoy const false) y el plan no tiene
// pendientes. Probado solo en LocalDB desechable
// (tools/tests/GestionAdminSqlLocalDbSmoke.cs). Encenderlo exige: 18
// aplicada, el cargador del Excel retirado (stub 51900 del backend), las
// vistas del backend con la fecha por categoria, EXECUTE en adm para la
// cuenta del sitio y la decision de "quitar categoria".
//
// La atomicidad, el tope de 100% con candado, la generacion del Codigo, el
// TicketsReduce y los NroCambioFecha* viven en SQL (una transaccion por
// guardado), no aqui: este escritor solo pasa el plan y traduce los
// errores 51xxx de los procedimientos.
//
// Solo ASCII en literales (App_Code sin BOM).

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;

public sealed class ErrorEscrituraGestionAdmin : Exception
{
    public readonly int Numero;
    public ErrorEscrituraGestionAdmin(int numero, string mensaje, Exception interna)
        : base(mensaje, interna) { Numero = numero; }

    // 51010 = tope de 100% excedido; 51003/51008/2627/2601 = repetida;
    // 51011-51015 = tipos, estado o categoria no validos (o sin agrupacion);
    // 51021-51025 = no se pudo emitir el Codigo.
    public bool EsTope { get { return Numero == 51010; } }
    public bool EsRepetida { get { return Numero == 51003 || Numero == 51008 || Numero == 2627 || Numero == 2601; } }
    public bool EsDatoInvalido { get { return Numero >= 51011 && Numero <= 51017; } }
    public bool EsCodigo { get { return Numero >= 51021 && Numero <= 51025; } }

    public string Tipo
    {
        get
        {
            return EsTope ? "TopeExcedido" : EsRepetida ? "CategoriaRepetida" : EsDatoInvalido ? "DatoInvalido"
                 : EsCodigo ? "CodigoNoEmitido" : "EscrituraRechazada";
        }
    }
}

public sealed class EscritorGestionAdminSql
{
    private const string TipoCategorias = "adm.CategoriaPctTipo";
    private const string TipoFechas = "adm.CategoriaFechaTipo";

    // Devuelve el Codigo emitido (solo existe si el procedimiento confirmo).
    // tx: opcional (la del que llama).
    public string Crear(SqlConnection cn, SqlTransaction tx, PlanCrearAdmin plan, string usuario)
    {
        if (plan == null) throw new ArgumentNullException("plan");
        using (var cmd = Comando(cn, tx, "adm.usp_GestionAdmin_Crear"))
        {
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = Db(usuario);
            cmd.Parameters.Add("@Prefijo", SqlDbType.NVarChar, 10).Value = Db(plan.Prefijo);
            cmd.Parameters.Add("@TipoIniciativa", SqlDbType.NVarChar, 100).Value = Db(plan.TipoIniciativa);
            cmd.Parameters.Add("@TipoAgrupado", SqlDbType.NVarChar, 100).Value = Db(plan.TipoAgrupado);
            cmd.Parameters.Add("@Estado", SqlDbType.NVarChar, 100).Value = Db(plan.Estado);
            cmd.Parameters.Add("@Titulo", SqlDbType.NVarChar, -1).Value = Db(plan.Titulo);
            cmd.Parameters.Add("@Descripcion", SqlDbType.NVarChar, -1).Value = Db(plan.Descripcion);
            cmd.Parameters.Add("@Observaciones", SqlDbType.NVarChar, -1).Value = Db(plan.Observaciones);
            cmd.Parameters.Add("@FechaEntregaAnalisis", SqlDbType.Date).Value = plan.FechaEntregaAnalisis.Date;
            // PO / SO solo existen en el procedimiento desde sql/20. Con
            // GuardaDuenos = false no se mandan (el validador ya rechazo
            // cualquier PO / SO), asi que la version de sql/18 sigue sirviendo.
            if (PersistenciaGestionAdmin.GuardaDuenosActiva())
            {
                cmd.Parameters.Add("@OwnerProblem", SqlDbType.NVarChar, 4000).Value = Db(plan.Po);
                cmd.Parameters.Add("@OwnerServicio", SqlDbType.NVarChar, 4000).Value = Db(plan.So);
            }
            else if (plan.Po != null || plan.So != null)
                throw new InvalidOperationException("PO / SO en el plan con GuardaDuenos = false: no se descartan en silencio.");
            Categorias(cmd, "@Categorias", plan.Categorias);
            // Las fechas del plan son las que se guardan: el mismo "hoy".
            cmd.Parameters.Add("@Hoy", SqlDbType.Date).Value = plan.FechaCreacion.Date;
            var codigo = cmd.Parameters.Add("@Codigo", SqlDbType.NVarChar, 100);
            codigo.Direction = ParameterDirection.Output;
            Ejecutar(cmd);
            return codigo.Value as string;
        }
    }

    public void Modificar(SqlConnection cn, SqlTransaction tx, PlanModificarAdmin plan, string usuario)
    {
        if (plan == null) throw new ArgumentNullException("plan");
        if (plan.Quitar.Count > 0)
            throw new InvalidOperationException(PlanificadorGestionAdmin.PendienteQuitar);
        using (var cmd = Comando(cn, tx, "adm.usp_GestionAdmin_Modificar"))
        {
            cmd.Parameters.Add("@Usuario", SqlDbType.NVarChar, 256).Value = Db(usuario);
            cmd.Parameters.Add("@Codigo", SqlDbType.NVarChar, 100).Value = Db(plan.Codigo);
            Texto(cmd, plan, SolicitudIniciativa.CTitulo, "Titulo", -1);
            Texto(cmd, plan, SolicitudIniciativa.CDescripcion, "Descripcion", -1);
            Texto(cmd, plan, SolicitudIniciativa.CObservaciones, "Observaciones", -1);
            Texto(cmd, plan, PeticionModificarAdmin.CEstado, "Estado", 100);
            Texto(cmd, plan, PeticionModificarAdmin.CSubestado, "Subestado", 100);
            Fecha(cmd, plan, PeticionModificarAdmin.CFAnalisis, "FAnalisis");
            Fecha(cmd, plan, PeticionModificarAdmin.CFSolucion, "FSolucion");
            Fecha(cmd, plan, PeticionModificarAdmin.CFCierre, "FCierre");
            Categorias(cmd, "@Pcts", plan.Pcts);
            Categorias(cmd, "@Agregar", plan.Agregar);
            Fechas(cmd, "@FechasCategoria", plan.FechasCategoria);
            cmd.Parameters.Add("@Hoy", SqlDbType.Date).Value = plan.Hoy.Date;
            Ejecutar(cmd);
        }
    }

    private static SqlCommand Comando(SqlConnection cn, SqlTransaction tx, string proc)
    {
        if (cn == null) throw new ArgumentNullException("cn");
        return new SqlCommand(proc, cn, tx) { CommandType = CommandType.StoredProcedure, CommandTimeout = 60 };
    }

    private static void Ejecutar(SqlCommand cmd)
    {
        try { cmd.ExecuteNonQuery(); }
        catch (SqlException ex)
        {
            if (ex.Number >= 51000 && ex.Number < 52000 || ex.Number == 2627 || ex.Number == 2601)
                throw new ErrorEscrituraGestionAdmin(ex.Number, ex.Message, ex);
            throw;
        }
    }

    private static void Texto(SqlCommand cmd, PlanModificarAdmin plan, string campo, string nombre, int largo)
    {
        string v;
        var cambia = plan.Problem.TryGetValue(campo, out v);
        cmd.Parameters.Add("@Cambia" + nombre, SqlDbType.Bit).Value = cambia;
        cmd.Parameters.Add("@" + nombre, SqlDbType.NVarChar, largo).Value = cambia ? Db(v) : DBNull.Value;
    }

    private static void Fecha(SqlCommand cmd, PlanModificarAdmin plan, string campo, string nombre)
    {
        string v;
        var cambia = plan.Problem.TryGetValue(campo, out v);
        var d = cambia ? FechasGestionAdmin.DeIso(v) : null;
        if (cambia && !string.IsNullOrEmpty(v) && d == null)
            throw new ArgumentException("Fecha invalida en el plan: " + campo);
        cmd.Parameters.Add("@Cambia" + nombre, SqlDbType.Bit).Value = cambia;
        cmd.Parameters.Add("@" + nombre, SqlDbType.Date).Value = d == null ? (object)DBNull.Value : d.Value;
    }

    private static void Categorias(SqlCommand cmd, string nombre, List<CategoriaPlan> filas)
    {
        var t = new DataTable();
        t.Columns.Add("Categoria", typeof(string));
        t.Columns.Add("Pct", typeof(decimal)).AllowDBNull = true;
        t.Columns.Add("TipoIniciativa", typeof(string)).AllowDBNull = true;
        t.Columns.Add("TipoAgrupado", typeof(string)).AllowDBNull = true;
        foreach (var f in filas)
            t.Rows.Add(f.Ruta, f.Pct == null ? (object)DBNull.Value : f.Pct.Value, Db(f.TipoIniciativa), Db(f.TipoAgrupado));
        var p = cmd.Parameters.Add(nombre, SqlDbType.Structured);
        p.TypeName = TipoCategorias;
        p.Value = t;
    }

    private static void Fechas(SqlCommand cmd, string nombre, List<FechaCategoriaPlan> filas)
    {
        var t = new DataTable();
        t.Columns.Add("Categoria", typeof(string));
        t.Columns.Add("FechaAnalisis", typeof(DateTime)).AllowDBNull = true;
        foreach (var f in filas) t.Rows.Add(f.Ruta, f.FechaAnalisis.Date);
        var p = cmd.Parameters.Add(nombre, SqlDbType.Structured);
        p.TypeName = TipoFechas;
        p.Value = t;
    }

    private static object Db(string s)
    {
        return string.IsNullOrEmpty(s) ? (object)DBNull.Value : s;
    }
}
