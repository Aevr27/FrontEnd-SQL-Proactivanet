// Prueba offline: el folio de Solicitar cambios (PeticionSolicitudCambio.
// DesdeFormulario, App_Code/SolicitudCambioAdmin.cs) acepta los prefijos
// que adm.usp_GestionAdmin_Crear emite desde sql/43: una letra y dos letras
// o digitos. Sin esto una iniciativa S2L se crea pero no se le pueden pedir
// cambios ("Falta el folio de la iniciativa."). Sin IIS y sin SQL Server.
//
// Compilar (ver memoria csc): App_Code\*.cs en adm.dll y este archivo con
// /r:adm.dll /r:System.Core.dll /r:System.Web.dll.

using System;
using System.Collections.Specialized;
using System.Linq;

public static class FolioPrefijoSmoke
{
    static int fallos = 0, pasados = 0;

    static void Check(string caso, object esperado, object obtenido)
    {
        var e = Convert.ToString(esperado); var o = Convert.ToString(obtenido);
        var ok = e == o; if (ok) pasados++; else fallos++;
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + caso + (ok ? "" : "  esperado=" + e + "  obtenido=" + o));
    }

    // "ok:<Prefijo>" si el folio paso; "folio" si se rechazo. Los demas
    // campos del formulario no importan aqui.
    static string Folio(string folio)
    {
        var f = new NameValueCollection();
        if (folio != null) f[PeticionSolicitudCambio.CFolio] = folio;
        var p = PeticionSolicitudCambio.DesdeFormulario(f);
        return p.Errores.Any(e => e.Campo == PeticionSolicitudCambio.CFolio) ? "folio" : "ok:" + p.Prefijo;
    }

    public static int Main()
    {
        Check("F1 S2L 2026-000001 (como la VM)", "ok:S2L", Folio("S2L 2026-000001"));
        Check("F2 PRB / ADO / SOR siguen igual", "ok:PRB|ok:ADO|ok:SOR",
              Folio("PRB 2026-000001") + "|" + Folio("ADO 2025-000123") + "|" + Folio("SOR 2026-000029"));
        Check("F3 minusculas como antes: s2l -> S2L, prb -> PRB", "ok:S2L|ok:PRB", Folio("s2l 2026-000001") + "|" + Folio("prb 2026-000001"));
        Check("F4 digito primero (2SL): rechazado", "folio", Folio("2SL 2026-000001"));
        Check("F5 cuatro letras (SEMC) o dos (S2): rechazado", "folio|folio", Folio("SEMC 2026-000001") + "|" + Folio("S2 2026-000001"));
        Check("F6 letra acentuada en el prefijo: rechazado", "folio", Folio("S" + (char)0xC1 + "L 2026-000001"));
        Check("F7 numero corto, guion en vez de espacio, vacio: rechazado", "folio|folio|folio",
              Folio("S2L 2026-00001") + "|" + Folio("S2L-2026-000001") + "|" + Folio(null));
        Console.WriteLine(fallos == 0 ? "OK: todo paso (" + pasados + ")" : "FALLOS: " + fallos);
        return fallos == 0 ? 0 : 1;
    }
}
