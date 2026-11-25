// Requerimientos "de TI a TI": el boton de la pestana Experiencia que los
// quita de toda la pestana.
//
// LA REGLA es la de 89_mapa_reduccion.sql (v2), la misma de la pagina
// "Camino a 7,000"; la decidio el dueno. El 89 no esta en este repositorio.
// Un ticket es de TI a TI si es Peticion de Servicio (las "SorIA Peticiones"
// no) y ademas
//   - es del servicio (C1) S-Servicios TI, lo notifique quien lo notifique, o
//   - es del cliente OAT y NO lo notifica una tienda.
// "Tienda" es la regla Sitio del 89 sobre la columna Tienda de dbo.Tickets:
// empieza con numero, City Club, Cedis o Cad, o trae algun digito y ninguna
// "\" (las cuentas de dominio llevan "\"). CEDIS y City Club se quedan.
// De esos, los del servicio S-Acceso Aplicaciones - Permisos se pueden dejar
// (la segunda casilla del boton): Clase() los marca aparte.
//
// Vive AQUI y solo aqui para el sitio: el volumen (ExperienciaQueries.TIaTI),
// los automatizados (DashboardQueries.Predicados) y la descarga
// (ExperienciaQueries.ConsultaExport) usan Clase(). Si el dueno cambia la
// regla, se cambia aqui y en el 89 (TiATiExperienciaSmoke.js, caso L4,
// compara las constantes cuando el 89 esta junto al repositorio).

using System;
using System.Data;
using System.Data.SqlClient;
using System.Web;

public static class TicketTIaTI
{
    public const string ServicioTI = "S-Servicios TI";
    public const string ClienteOAT = "OAT";
    public const string ServicioPermisos = "S-Acceso Aplicaciones - Permisos";

    // ?ti=excluir quita los de TI a TI; con ?ti_permisos=dejar se quedan los
    // de permisos. Cualquier otra cosa, o nada, es "Todos" (sin predicado: el
    // SQL de siempre, byte a byte).
    public const string ParametroQuery = "ti";
    public const string ValorExcluir = "excluir";
    public const string ParametroPermisos = "ti_permisos";
    public const string ValorDejar = "dejar";

    public enum Modo { Todos = 0, SinTI = 1, SinTIDejandoPermisos = 2 }

    // Lo que devuelve Clase().
    public const int NoEs = 0, Es = 1, EsDePermisos = 2;

    public static Modo Desde(HttpRequest request)
    {
        return Desde(request.QueryString[ParametroQuery], request.QueryString[ParametroPermisos]);
    }

    public static Modo Desde(string ti, string permisos)
    {
        if (!string.Equals((ti ?? "").Trim(), ValorExcluir, StringComparison.OrdinalIgnoreCase))
            return Modo.Todos;
        return string.Equals((permisos ?? "").Trim(), ValorDejar, StringComparison.OrdinalIgnoreCase)
            ? Modo.SinTIDejandoPermisos : Modo.SinTI;
    }

    /* La clase de cada ticket como expresion SQL: 0 no es de TI a TI, 1 si,
       2 si y es de permisos. Las columnas las pone quien llama, porque cada
       consulta tiene la suya (TipoTicket o Tipo crudo, C1 de la vista o
       fn_CategoriaC1 de la categoria); son nombres fijos del codigo, nunca
       texto del usuario.

       Como en el 89: el tipo y el C1 se comparan sin mayusculas ni acentos
       ("Peticion" con y sin tilde), el cliente con LIKE '%OAT%' sin
       mayusculas, y la tienda con la colacion de la columna. Un cliente NULL
       no es OAT; una tienda NULL no es tienda. El literal va sin tilde para
       que el archivo siga en ASCII: con CI_AI es el mismo.

       Los tres valores van como parametros. Llamarla dos veces en el mismo
       comando reusa los que ya estan (SqlCommand no deja declararlos dos
       veces). */
    public static string Clase(SqlCommand cmd, string tipo, string c1, string cliente, string tienda)
    {
        Parametros(cmd);
        string t = "ISNULL(" + tienda + ", N'')";
        string c = "LTRIM(RTRIM(" + c1 + ")) COLLATE Latin1_General_CI_AI";
        string esTienda =
            "(" + t + " LIKE N'[0-9]%' OR " + t + " LIKE N'City Club%' OR " + t + " LIKE N'Cedis%'" +
            " OR " + t + " LIKE N'Cad[ 0-9]%' OR (" + t + " LIKE N'%[0-9]%' AND " + t + " NOT LIKE N'%[\\]%'))";
        return "(CASE WHEN LTRIM(RTRIM(" + tipo + ")) COLLATE Latin1_General_CI_AI = N'Peticion de Servicio'" +
               " AND (" + c + " = @TiServicio" +
               " OR (" + cliente + " COLLATE Latin1_General_CI_AI LIKE @TiCliente AND NOT " + esTienda + "))" +
               " THEN CASE WHEN " + c + " = @TiPermisos THEN 2 ELSE 1 END ELSE 0 END)";
    }

    // " AND (clase) = 0" quita todos; "<> 1" quita los de TI a TI y deja los
    // de permisos. Todos: cadena vacia.
    public static string Predicado(SqlCommand cmd, Modo modo, string tipo, string c1, string cliente, string tienda)
    {
        if (modo == Modo.Todos) return "";
        return " AND " + Clase(cmd, tipo, c1, cliente, tienda) + (modo == Modo.SinTI ? " = 0" : " <> 1");
    }

    // La misma decision en C#, sobre la clase ya calculada por SQL (el export
    // la trae como columna).
    public static bool Quita(Modo modo, int clase)
    {
        if (modo == Modo.SinTI) return clase != NoEs;
        if (modo == Modo.SinTIDejandoPermisos) return clase == Es;
        return false;
    }

    public static void Parametros(SqlCommand cmd)
    {
        if (cmd.Parameters.Contains("@TiServicio")) return;
        cmd.Parameters.Add("@TiServicio", SqlDbType.NVarChar, 200).Value = ServicioTI;
        cmd.Parameters.Add("@TiCliente", SqlDbType.NVarChar, 100).Value = "%" + ClienteOAT + "%";
        cmd.Parameters.Add("@TiPermisos", SqlDbType.NVarChar, 200).Value = ServicioPermisos;
    }
}
