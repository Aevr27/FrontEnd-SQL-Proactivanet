// Identidad Windows de quien hace el request.
//
// La UNICA fuente es HttpContext.Current.User.Identity.Name, que IIS llena con
// la autenticacion de Windows (Negotiate) del sitio: "SORIANA\t_andresvr".
// No hay login propio, ni contraseñas, ni tokens: si IIS no autentico al
// usuario, aqui no hay identidad y punto. (El atajo de desarrollo local no
// inventa identidad: ver AccesoDesarrolloLocal, que vive en AccesoAdmin.)
//
// DOS VALORES, DOS USOS
// ---------------------
//   Original   la cuenta tal como la entrego IIS ("SORIANA\t_andresvr").
//              Es la identidad de SEGURIDAD: con ella se autoriza
//              (AccesoAdmin) y es la que deberia quedar en cualquier
//              bitacora futura.
//   Usuario    la misma cuenta sin el prefijo de dominio y en minusculas
//              ("t_andresvr"). Solo sirve para BUSCAR a la persona en los
//              catalogos (CorreoCandidato). Nunca sustituye a Original.
//
// Solo se quita el prefijo si lo hay ("DOMINIO\cuenta"); una cuenta sin
// dominio se queda como esta. No se asume que el dominio sea SORIANA.

using System;
using System.Globalization;
using System.Web;

public sealed class IdentidadWindows
{
    // Dominio del correo corporativo con el que se arma el candidato de
    // busqueda (cuenta@soriana.com). Es un CANDIDATO: el correo que vale es
    // el que este guardado en la base (DirectorioPersonas).
    public const string DominioCorreo = "soriana.com";

    private static readonly IdentidadWindows Anonima = new IdentidadWindows(null, false);

    public string Original { get; private set; }
    public string Dominio { get; private set; }
    public string Usuario { get; private set; }
    public bool Autenticada { get; private set; }

    private IdentidadWindows(string nombre, bool autenticada)
    {
        nombre = nombre == null ? null : nombre.Trim();
        if (!autenticada || string.IsNullOrEmpty(nombre))
        {
            Autenticada = false;
            return;
        }

        Autenticada = true;
        Original = nombre;

        string dominio, usuario;
        Separar(nombre, out dominio, out usuario);
        Dominio = dominio;
        Usuario = usuario;

        // "SORIANA\" sin cuenta no es una identidad util.
        if (Usuario == null) Autenticada = false;
    }

    // La del request en curso. Sin contexto, sin usuario o sin autenticar:
    // una identidad anonima (Autenticada = false), nunca una excepcion.
    public static IdentidadWindows Actual()
    {
        var ctx = HttpContext.Current;
        return ctx == null ? Anonima : DesdeContexto(ctx);
    }

    public static IdentidadWindows DesdeContexto(HttpContext ctx)
    {
        if (ctx == null || ctx.User == null || ctx.User.Identity == null) return Anonima;
        return Desde(ctx.User.Identity.Name, ctx.User.Identity.IsAuthenticated);
    }

    // Constructor para pruebas y para el resto de la aplicacion.
    public static IdentidadWindows Desde(string nombre, bool autenticada)
    {
        return new IdentidadWindows(nombre, autenticada);
    }

    // "dominio\cuenta" -> ("dominio", "cuenta"), ambos en minusculas y sin
    // espacios. Sin "\" no hay dominio. Solo se mira la ULTIMA barra, igual
    // que hace Windows con DOMINIO\cuenta.
    public static void Separar(string nombre, out string dominio, out string usuario)
    {
        dominio = null;
        usuario = null;
        if (nombre == null) return;

        var limpio = nombre.Trim();
        var barra = limpio.LastIndexOf('\\');
        if (barra >= 0)
        {
            dominio = Minusculas(limpio.Substring(0, barra));
            limpio = limpio.Substring(barra + 1);
        }
        usuario = Minusculas(limpio);
    }

    // La cuenta normalizada de cualquier cadena: "SORIANA\T_AndresVR" ->
    // "t_andresvr"; "t_andresvr" -> "t_andresvr"; vacio -> null.
    public static string NormalizarUsuario(string nombre)
    {
        string dominio, usuario;
        Separar(nombre, out dominio, out usuario);
        return usuario;
    }

    // cuenta@soriana.com, o null si no hay cuenta.
    public string CorreoCandidato()
    {
        return Autenticada ? Usuario + "@" + DominioCorreo : null;
    }

    private static string Minusculas(string s)
    {
        if (s == null) return null;
        s = s.Trim();
        return s.Length == 0 ? null : s.ToLower(CultureInfo.InvariantCulture);
    }
}
