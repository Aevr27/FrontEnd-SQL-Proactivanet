// "Solicitar cambios" del Product Owner / Service Owner de UNA iniciativa
// (RolSolicitante PSO, sql/37_solicitudes_cambio_pso.sql).
//
// LA REGLA (2026-10-29)
//   ADM / MOD     como siempre: su rol de dbo.UsuariosAdmin. Esta regla ni
//                 se consulta.
//   otra cuenta   solo si (1) la base tiene sql/37
//                 (PersistenciaSolicitudesCambio.SolicitaPsoActiva), (2) es
//                 PO/SO VIGENTE, la MISMA regla que "Solicitar una
//                 iniciativa" (AccesoIniciativas.Motivo), (3) su cuenta se
//                 resuelve a UNA persona de CatPersona (IdentidadAcuse.Resolver)
//                 y (4) esa persona es el OwnerProblem u OwnerServicio
//                 capturado de ESE folio en dbo.Problem
//                 (SolicitudesCambio.DuenosCapturados; IdentidadAcuse.EsDueno),
//                 o, con sql/38 (SolicitaPsoEquipoActiva), un SO del EQUIPO
//                 de su PO: ServiceOwner de una fila vigente de
//                 dbo.CatCategoriaDueno cuyo ProductOwner es el OwnerProblem
//                 del folio (la cascada Director > PO > SO; PoDeMiEquipo).
//                 Entonces, y solo entonces, el SERVIDOR pone el rol "PSO".
//   anonimo       nunca.
//
// Nada viene del navegador: ni rol, ni usuario, ni dueno. El folio si (es lo
// que se pide), y por eso se comprueba contra la base. adm.usp_SolicitudCambio_Crear
// (sql/37, y sql/38 para el equipo) vuelve a comprobar (3) y (4) DENTRO de su transaccion con la fila
// de dbo.Problem bloqueada (51225 / 51226) y rechaza un Subestado (51227):
// esta revision es la de la interfaz y la primera barrera, no la unica.
// Listar, ver el detalle, aplicar y rechazar siguen siendo de ADM.
//
// Se prueba sin SQL en tools/tests/SolicitudesCambioHttpSmoke.cs (P) y la
// base en tools/tests/SolicitanteAdminPsoSqlLocalDbSmoke.cs.

using System;
using System.Collections;
using System.Collections.Generic;

public sealed class DecisionCambioPso
{
    public bool Puede;
    public int Http;          // si no puede
    public string Tipo;       // si no puede
    public string Mensaje;    // si no puede
}

public static class SolicitudCambioPso
{
    public const string Rol = "PSO";

    public const string MotivoNoHabilitado =
        "Pedir cambios como Product Owner o Service Owner todav\u00eda no est\u00e1 habilitado (falta aplicar sql/37 en la base). P\u00eddelo a un administrador.";

    public const string MotivoNoEsDueno =
        "Solo el Product Owner o el Service Owner capturado de esta iniciativa puede pedirle cambios.";

    public const string MotivoNoEsDuenoNiEquipo =
        "Solo el Product Owner de esta iniciativa, su Service Owner capturado o un Service Owner de ese Product Owner puede pedirle cambios.";

    // La regla sin HttpContext. `motivoSolicitante`: AccesoIniciativas.Motivo
    // (null = PO/SO vigente). `duenos`: { po, so } del folio (lanza si no
    // puede leer: el que llama responde 503).
    public static DecisionCambioPso Evaluar(IdentidadWindows id, bool sql37, string motivoSolicitante,
                                            IList<PersonaCatalogo> personas, string folio, Func<string, string[]> duenos)
    {
        return Evaluar(id, sql37, motivoSolicitante, personas, folio, duenos, null);
    }

    // `equipo`: el directorio de CatCategoriaDueno si sql/38 esta activa
    // (SolicitaPsoEquipoActiva); null = solo PO / SO capturados (sql/37).
    public static DecisionCambioPso Evaluar(IdentidadWindows id, bool sql37, string motivoSolicitante,
                                            IList<PersonaCatalogo> personas, string folio, Func<string, string[]> duenos,
                                            DirectorioOrganizacional equipo)
    {
        if (id == null || !id.Autenticada || string.IsNullOrEmpty(id.Original))
            return No(403, "SinUsuario", "Sin usuario autenticado no se guarda nada.");
        if (!sql37) return No(403, "AccesoDenegado", MotivoNoHabilitado);
        if (motivoSolicitante != null) return No(403, "AccesoDenegado", motivoSolicitante);
        var yo = IdentidadAcuse.Resolver(id, personas);
        if (!yo.EsResuelta) return No(403, "IdentidadNoResuelta", DestinatariosSolicitud.MensajeSolicitante(yo.Estado, id));
        folio = DirectorioOrganizacional.Normaliza(folio);
        if (folio == null) return No(422, "ValidacionFallida", "Falta el folio de la iniciativa.");
        var d = duenos(folio) ?? new string[] { null, null };
        if (d.Length < 2 || !(yo.EsDueno(d[0]) || yo.EsDueno(d[1]) || (equipo != null && EsDeMiEquipo(PoDeMiEquipo(yo, equipo), d[0]))))
            return No(403, "NoEsDueno", equipo != null ? MotivoNoEsDuenoNiEquipo : MotivoNoEsDueno);
        return new DecisionCambioPso { Puede = true };
    }

    // sql/38: las claves de nombre (IdentidadAcuse.ClaveNombre) de los PO de
    // los que esta persona es SO en alguna fila VIGENTE de
    // dbo.CatCategoriaDueno, con el ProductOwner / ServiceOwner de la fila
    // tal cual (sin heredar del C1), como lo compara la base. Vacio si no se
    // resolvio o sin directorio. Se arma una vez por request.
    public static HashSet<string> PoDeMiEquipo(IdentidadAcuse yo, DirectorioOrganizacional directorio)
    {
        var salida = new HashSet<string>(StringComparer.Ordinal);
        if (yo == null || !yo.EsResuelta || directorio == null) return salida;
        foreach (var f in directorio.Duenos())
        {
            if (!f.Vigente || !yo.EsDueno(f.So)) continue;
            var po = IdentidadAcuse.ClaveNombre(f.Po);
            if (po != null) salida.Add(po);
        }
        return salida;
    }

    private static bool EsDeMiEquipo(HashSet<string> poDeMiEquipo, string poCapturado)
    {
        var po = IdentidadAcuse.ClaveNombre(poCapturado);
        return po != null && poDeMiEquipo.Contains(po);
    }

    // Los folios del registro a los que esta persona puede pedir cambios
    // como PSO (sus filas con po_capturado / so_capturado). Vacio si no
    // aplica. Solo para pintar el boton: el envio vuelve a decidir.
    public static List<string> FoliosPropios(IdentidadWindows id, IList<PersonaCatalogo> personas, IEnumerable filas)
    {
        return FoliosPropios(id, personas, filas, null);
    }

    // `equipo`: como en Evaluar (sql/38); null = solo PO / SO capturados.
    public static List<string> FoliosPropios(IdentidadWindows id, IList<PersonaCatalogo> personas, IEnumerable filas,
                                             DirectorioOrganizacional equipo)
    {
        var salida = new List<string>();
        var yo = IdentidadAcuse.Resolver(id, personas);
        if (!yo.EsResuelta || filas == null) return salida;
        var deMiEquipo = PoDeMiEquipo(yo, equipo);
        foreach (var o in filas)
        {
            var f = o as IDictionary<string, object>;
            if (f == null) continue;
            object folio, po, so;
            f.TryGetValue("folio", out folio);
            f.TryGetValue("po_capturado", out po);
            f.TryGetValue("so_capturado", out so);
            if (folio is string && (yo.EsDueno(po as string) || yo.EsDueno(so as string) || EsDeMiEquipo(deMiEquipo, po as string)))
                salida.Add((string)folio);
        }
        return salida;
    }

    private static DecisionCambioPso No(int http, string tipo, string mensaje)
    {
        return new DecisionCambioPso { Puede = false, Http = http, Tipo = tipo, Mensaje = mensaje };
    }
}
