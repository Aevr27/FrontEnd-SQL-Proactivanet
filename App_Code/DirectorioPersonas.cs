// Personas y correos que YA estan en la base, para saber quien es quien
// (nombre, correo, manager) y a quien le llegaria un aviso. SOLO LECTURA.
//
// NO es autorizacion: AccesoAdmin decide con la cuenta Windows y no mira
// nada de aqui. Que alguien no aparezca en estos catalogos no es un error:
// la resolucion sale "no_encontrado" y el resto de la pagina sigue igual.
//
// DE DONDE SALE
// -------------
//   dbo.CatPersona     Nombre, Correo, Rol, ProductOwner, Manager, Director
//                      (VigenteEnOrigen = 1)
//   dbo.CatLiderGrupo  Grupo, Lider, CorreoLider, Gerente, CorreoGerente
//                      (VigenteEnOrigen = 1)
//
// COMO SE BUSCA
// -------------
//   Por correo   cuenta@soriana.com (IdentidadWindows.CorreoCandidato) contra
//                CatPersona.Correo, CatLiderGrupo.CorreoLider y
//                CatLiderGrupo.CorreoGerente, sin distinguir mayusculas y sin
//                espacios. El correo que se devuelve es el GUARDADO (en
//                minusculas y sin espacios, ver Correo()), no el candidato.
//   Por nombre   el nombre normalizado como en DirectorioOrganizacional
//                (Normaliza) contra CatPersona.Nombre, CatLiderGrupo.Lider y
//                CatLiderGrupo.Gerente.
//
// Si una busqueda da mas de una persona (o mas de un correo distinto), NO se
// escoge una: el estado es "ambiguo" y van todos los candidatos.
//
// CorreoGerente ES UNA LISTA DE DISTRIBUCION
// ------------------------------------------
// CatLiderGrupo tambien sirve para mandar avisos: CorreoGerente trae el
// correo del Gerente PRIMERO y despues las copias (danielalc, t_nancyvp,
// otros gerentes, externos...), separadas por coma y a veces por un salto
// de linea. Aqui solo se usa el PRIMERO (PrimerCorreo), y las copias no se
// leen: no son el gerente y no dicen nada de la jerarquia. La jerarquia de
// una persona sale de la cascada organizacional, no de este catalogo.

using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;

public sealed class DirectorioPersonas
{
    public const string Resuelto = "resuelto";
    public const string NoEncontrado = "no_encontrado";
    public const string Ambiguo = "ambiguo";
    public const string SinCorreo = "sin_correo";

    // Una fila de dbo.CatPersona.
    public sealed class Persona
    {
        public string Nombre;
        public string Correo;
        public string Rol;
        public string ProductOwner;
        public string Manager;
        public string Director;
    }

    // Una fila de dbo.CatLiderGrupo.
    public sealed class LiderGrupo
    {
        public string Grupo;
        public string Lider;
        public string CorreoLider;
        public string Gerente;
        public string CorreoGerente;
    }

    // Un correo encontrado y la columna de donde salio.
    public sealed class CorreoFuente
    {
        public string Correo;
        public string Fuente;
    }

    // Resultado de buscar a una persona. Nombre/Correo solo con Estado =
    // Resuelto; Manager, ProductOwner y Director solo si la fila es de
    // CatPersona (CatLiderGrupo no los tiene).
    public sealed class PersonaResuelta
    {
        public string Estado;
        public string Nombre;
        public string Correo;
        public string Fuente;
        public string Rol;
        public string Manager;
        public string ProductOwner;
        public string Director;
        public List<string> Candidatos = new List<string>();

        public Dictionary<string, object> ComoDiccionario()
        {
            var d = new Dictionary<string, object>();
            d["estado"] = Estado;
            d["nombre"] = Nombre;
            d["correo"] = Correo;
            d["fuente"] = Fuente;
            d["rol"] = Rol;
            d["manager"] = Manager;
            d["product_owner"] = ProductOwner;
            d["director"] = Director;
            d["candidatos"] = new List<object>(Candidatos.ToArray());
            return d;
        }
    }

    private readonly List<Persona> _personas;
    private readonly List<LiderGrupo> _lideres;

    public DirectorioPersonas(List<Persona> personas, List<LiderGrupo> lideres)
    {
        _personas = personas ?? new List<Persona>();
        _lideres = lideres ?? new List<LiderGrupo>();

        foreach (var p in _personas)
        {
            p.Nombre = DirectorioOrganizacional.Normaliza(p.Nombre);
            p.Correo = Correo(p.Correo);
            p.Rol = DirectorioOrganizacional.Normaliza(p.Rol);
            p.ProductOwner = DirectorioOrganizacional.Normaliza(p.ProductOwner);
            p.Manager = DirectorioOrganizacional.Normaliza(p.Manager);
            p.Director = DirectorioOrganizacional.Normaliza(p.Director);
        }
        foreach (var l in _lideres)
        {
            l.Grupo = DirectorioOrganizacional.Normaliza(l.Grupo);
            l.Lider = DirectorioOrganizacional.Normaliza(l.Lider);
            l.CorreoLider = Correo(l.CorreoLider);
            l.Gerente = DirectorioOrganizacional.Normaliza(l.Gerente);
            l.CorreoGerente = Correo(PrimerCorreo(l.CorreoGerente));
        }
    }

    public static DirectorioPersonas Cargar(SqlConnection cn)
    {
        return new DirectorioPersonas(LeerPersonas(cn), LeerLideres(cn));
    }

    // ------------------------------------------------------------------
    // Busquedas
    // ------------------------------------------------------------------

    // Quien tiene guardado este correo. Lo normal es correo = el candidato
    // cuenta@soriana.com de la identidad Windows.
    public PersonaResuelta BuscarPorCorreo(string correo)
    {
        var r = new PersonaResuelta();
        correo = Correo(correo);
        if (correo == null) { r.Estado = NoEncontrado; return r; }

        // nombre (sin distinguir mayusculas) -> primera fila que lo da
        var nombres = new List<string>();
        Persona fila = null;
        string guardado = null, fuente = null;

        foreach (var p in _personas)
        {
            if (!Igual(p.Correo, correo) || p.Nombre == null) continue;
            if (Agregar(nombres, p.Nombre) && fila == null)
            {
                fila = p; guardado = p.Correo; fuente = "CatPersona.Correo";
            }
        }
        foreach (var l in _lideres)
        {
            if (l.Lider != null && Igual(l.CorreoLider, correo) && Agregar(nombres, l.Lider) && guardado == null)
            {
                guardado = l.CorreoLider; fuente = "CatLiderGrupo.CorreoLider";
            }
            if (l.Gerente != null && Igual(l.CorreoGerente, correo) && Agregar(nombres, l.Gerente) && guardado == null)
            {
                guardado = l.CorreoGerente; fuente = "CatLiderGrupo.CorreoGerente";
            }
        }

        r.Candidatos.AddRange(nombres);
        if (nombres.Count == 0) { r.Estado = NoEncontrado; return r; }
        if (nombres.Count > 1) { r.Estado = Ambiguo; return r; }

        r.Estado = Resuelto;
        r.Nombre = nombres[0];
        r.Correo = guardado;
        r.Fuente = fuente;

        // Manager / PO / Director / Rol solo existen en CatPersona: si la
        // persona salio de CatLiderGrupo, se busca su fila por nombre.
        if (fila == null)
        {
            var porNombre = PersonasConNombre(r.Nombre);
            if (porNombre.Count == 1) fila = porNombre[0];
        }
        if (fila != null)
        {
            r.Rol = fila.Rol;
            r.Manager = fila.Manager;
            r.ProductOwner = fila.ProductOwner;
            r.Director = fila.Director;
        }
        return r;
    }

    // Los correos guardados de una persona, por su nombre. Un solo correo
    // distinto -> resuelto; ninguno -> sin_correo (o no_encontrado si el
    // nombre no aparece en ningun catalogo); varios -> ambiguo.
    public Dictionary<string, object> CorreoDeNombre(string nombre)
    {
        nombre = DirectorioOrganizacional.Normaliza(nombre);
        var salida = new Dictionary<string, object>();
        salida["nombre"] = nombre;
        salida["correo"] = null;

        if (nombre == null)
        {
            salida["estado"] = NoEncontrado;
            salida["candidatos"] = new List<object>();
            return salida;
        }

        var encontrados = new List<CorreoFuente>();
        var aparece = false;

        foreach (var p in _personas)
        {
            if (!Igual(p.Nombre, nombre)) continue;
            aparece = true;
            if (p.Correo != null) encontrados.Add(new CorreoFuente { Correo = p.Correo, Fuente = "CatPersona.Correo" });
        }
        foreach (var l in _lideres)
        {
            if (Igual(l.Lider, nombre))
            {
                aparece = true;
                if (l.CorreoLider != null) encontrados.Add(new CorreoFuente { Correo = l.CorreoLider, Fuente = "CatLiderGrupo.CorreoLider" });
            }
            if (Igual(l.Gerente, nombre))
            {
                aparece = true;
                if (l.CorreoGerente != null) encontrados.Add(new CorreoFuente { Correo = l.CorreoGerente, Fuente = "CatLiderGrupo.CorreoGerente" });
            }
        }

        // Todas las columnas donde sale; la decision se toma sobre las
        // direcciones distintas.
        var distintos = new List<string>();
        var candidatos = new List<object>();
        foreach (var c in encontrados)
        {
            Agregar(distintos, c.Correo);
            var fila = new Dictionary<string, object>();
            fila["correo"] = c.Correo;
            fila["fuente"] = c.Fuente;
            candidatos.Add(fila);
        }
        salida["candidatos"] = candidatos;

        if (!aparece) salida["estado"] = NoEncontrado;
        else if (distintos.Count == 0) salida["estado"] = SinCorreo;
        else if (distintos.Count > 1) salida["estado"] = Ambiguo;
        else
        {
            salida["estado"] = Resuelto;
            salida["correo"] = distintos[0];
        }
        return salida;
    }

    // Filas de CatLiderGrupo donde la persona aparece como Lider o como
    // Gerente. Es EVIDENCIA para decidir la regla "Lider del SO": aqui no se
    // concluye nada.
    public List<object> GruposDe(string nombre)
    {
        nombre = DirectorioOrganizacional.Normaliza(nombre);
        var filas = new List<object>();
        if (nombre == null) return filas;

        foreach (var l in _lideres)
        {
            var comoLider = Igual(l.Lider, nombre);
            var comoGerente = Igual(l.Gerente, nombre);
            if (!comoLider && !comoGerente) continue;

            var f = new Dictionary<string, object>();
            f["grupo"] = l.Grupo;
            f["aparece_como"] = comoLider ? (comoGerente ? "Lider y Gerente" : "Lider") : "Gerente";
            f["lider"] = l.Lider;
            f["correo_lider"] = l.CorreoLider;
            f["gerente"] = l.Gerente;
            f["correo_gerente"] = l.CorreoGerente;
            filas.Add(f);
        }
        return filas;
    }

    public List<Persona> PersonasConNombre(string nombre)
    {
        nombre = DirectorioOrganizacional.Normaliza(nombre);
        var filas = new List<Persona>();
        if (nombre == null) return filas;
        foreach (var p in _personas)
            if (Igual(p.Nombre, nombre)) filas.Add(p);
        return filas;
    }

    // ------------------------------------------------------------------
    // Lectura (solo SELECT)
    // ------------------------------------------------------------------

    public static List<Persona> LeerPersonas(SqlConnection cn)
    {
        const string SQL =
            "SELECT Nombre, Correo, Rol, ProductOwner, Manager, Director " +
            "FROM dbo.CatPersona WHERE VigenteEnOrigen = 1";

        var filas = new List<Persona>();
        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                filas.Add(new Persona
                {
                    Nombre = Texto(rd.GetValue(0)),
                    Correo = Texto(rd.GetValue(1)),
                    Rol = Texto(rd.GetValue(2)),
                    ProductOwner = Texto(rd.GetValue(3)),
                    Manager = Texto(rd.GetValue(4)),
                    Director = Texto(rd.GetValue(5)),
                });
            }
        }
        return filas;
    }

    public static List<LiderGrupo> LeerLideres(SqlConnection cn)
    {
        const string SQL =
            "SELECT Grupo, Lider, CorreoLider, Gerente, CorreoGerente " +
            "FROM dbo.CatLiderGrupo WHERE VigenteEnOrigen = 1";

        var filas = new List<LiderGrupo>();
        using (var cmd = new SqlCommand(SQL, cn))
        using (var rd = cmd.ExecuteReader())
        {
            while (rd.Read())
            {
                filas.Add(new LiderGrupo
                {
                    Grupo = Texto(rd.GetValue(0)),
                    Lider = Texto(rd.GetValue(1)),
                    CorreoLider = Texto(rd.GetValue(2)),
                    Gerente = Texto(rd.GetValue(3)),
                    CorreoGerente = Texto(rd.GetValue(4)),
                });
            }
        }
        return filas;
    }

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    // Un correo comparable: sin espacios (tampoco NBSP) y en minusculas.
    // Vacio -> null. No se valida el formato: se compara con lo guardado.
    public static string Correo(string valor)
    {
        valor = DirectorioOrganizacional.Normaliza(valor);
        return valor == null ? null : valor.ToLower(CultureInfo.InvariantCulture);
    }

    // El primer correo de una lista de distribucion, o null. Separadores:
    // coma, punto y coma y cualquier blanco (en la base hay listas partidas
    // con un salto de linea en vez de coma: "minervasp@...\r\n danielalc@...").
    // Un correo no lleva blancos, asi que cortar en ellos no parte ninguno.
    public static string PrimerCorreo(string lista)
    {
        if (lista == null) return null;
        var partes = lista.Split(new[] { ',', ';', ' ', '\t', '\r', '\n', ' ' },
                                 StringSplitOptions.RemoveEmptyEntries);
        return partes.Length == 0 ? null : partes[0];
    }

    private static bool Igual(string a, string b)
    {
        return a != null && b != null && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    // Agrega si no estaba (sin distinguir mayusculas). true si lo agrego.
    private static bool Agregar(List<string> lista, string valor)
    {
        foreach (var v in lista)
            if (Igual(v, valor)) return false;
        lista.Add(valor);
        return true;
    }

    private static string Texto(object v)
    {
        if (v == null || v is DBNull) return null;
        var s = Convert.ToString(v, CultureInfo.InvariantCulture);
        return string.IsNullOrEmpty(s) ? null : s;
    }
}
