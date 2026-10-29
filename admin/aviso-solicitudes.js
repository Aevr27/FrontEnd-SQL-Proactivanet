/* =========================================================================
   admin/aviso-solicitudes.js - aviso rojo junto a la pestaña Solicitudes.
   handlers/admin_iniciativas_aviso_solicitudes.ashx (App_Code/SolicitudesVistas.cs).

     resumen  GET  ?accion=resumen   { pendientes, no_vistas, ... }
     marcar   POST ?accion=marcar    tipo (CAMBIO | NUEVA), id

   Tres estados (estadoDe):
     - hay pendientes que este ADM no ha abierto -> circulo rojo con el numero
       de NO VISTAS (99+ si pasa de 99);
     - hay pendientes pero ya las abrio todas    -> punto rojo sin numero;
     - no hay pendientes                         -> nada.
   Pendiente y no vista son cosas distintas: el punto dice que HAY pendientes
   (de quien sea); el numero, cuantas de ESAS no ha abierto quien mira. Una
   resuelta (aplicada, aprobada, rechazada) deja de contar en las dos.

   Lo visto vive en la base, por usuario (sql/39), nunca en el navegador: el
   servidor pone quien es. Sin sql/39 no_vistas llega null y solo se ve el
   punto (nunca un numero inventado).

   Solo ADM: las dos colas son suyas (el servidor lo exige con ExigirAdm).
   Se relee al abrir el detalle de una pendiente (marcar), tras aplicar /
   aprobar / rechazar y cada RefrescoAuto.INTERVALO con la pagina visible;
   nunca dos lecturas encimadas. Se prueba en node:
   tools/tests/AvisoSolicitudesSmoke.js.
   ========================================================================= */
window.AvisoSolicitudes = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_aviso_solicitudes.ashx';
  // La pendiente de cada cola: lo que se puede marcar como vista.
  var PENDIENTE = { CAMBIO: 'PENDIENTE', NUEVA: 'ENVIADA' };

  // -> { modo: 'oculto' | 'punto' | 'numero', n }
  function estadoDe(r) {
    var p = r && typeof r.pendientes === 'number' ? r.pendientes : 0;
    if (p <= 0) return { modo: 'oculto', n: 0 };
    var nv = r && typeof r.no_vistas === 'number' ? Math.min(r.no_vistas, p) : 0;
    return nv > 0 ? { modo: 'numero', n: nv } : { modo: 'punto', n: 0 };
  }

  function textoNumero(n) { return n > 99 ? '99+' : String(n); }

  // Lo que lee un lector de pantalla en la pestaña.
  function etiqueta(e, r) {
    if (e.modo === 'oculto') return 'Solicitudes';
    var p = r.pendientes;
    var pend = p + ' pendiente' + (p === 1 ? '' : 's');
    return e.modo === 'numero' ? 'Solicitudes, ' + e.n + ' sin ver de ' + pend : 'Solicitudes, ' + pend + ', todas vistas';
  }

  function leer(resp) {
    return Promise.resolve(resp.json()).catch(function () { return null; }).then(function (j) { return { status: resp.status, json: j || {} }; });
  }

  class Aviso {
    // pedir(url, op) -> Promise<Response> (fetch por omision).
    constructor(doc, pedir) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.activo = false;      // rol ADM
      this.lecturas = 0;        // descarta respuestas de una lectura superada
      this.enCurso = null;      // la lectura en vuelo (nunca dos a la vez)
      this.otraVez = false;     // algo cambio mientras leia: leer de nuevo al terminar
      this.vistas = {};         // 'CAMBIO:41' -> true (el servidor ya la marco)
      this.sinVistas = false;   // marcar respondio 501 (sin sql/39): no insistir
      this.resumen = null;      // el ultimo pintado
      this.ultimoEstado = null;
      this.refresco = null;
    }

    $(id) { return this.doc.getElementById(id); }

    fijarRol(rol) {
      var antes = this.activo;
      this.activo = rol === 'ADM';
      if (!this.activo) {
        this.lecturas++;
        this.pintar(null);
        if (this.refresco) this.refresco.detener();
        return Promise.resolve(null);
      }
      if (!this.refresco && window.RefrescoAuto) {
        var self = this;
        this.refresco = new window.RefrescoAuto({
          doc: this.doc,
          puede: function () { return self.activo; },
          refrescar: function () { return self.actualizar(); }
        });
      }
      if (this.refresco) this.refresco.iniciar();
      return antes ? Promise.resolve(this.ultimoEstado) : this.actualizar();
    }

    pintar(r) {
      var el = this.$('solAviso'), tab = this.$('tab-solicitudes');
      var e = estadoDe(r);
      this.resumen = r;
      if (el) {
        el.hidden = e.modo === 'oculto';
        el.className = 'ini-tab-aviso' + (e.modo === 'punto' ? ' punto' : '');
        el.textContent = e.modo === 'numero' ? textoNumero(e.n) : '';
      }
      if (tab && tab.setAttribute) {
        if (e.modo === 'oculto') tab.removeAttribute('aria-label');
        else tab.setAttribute('aria-label', etiqueta(e, r));
      }
      return e;
    }

    // -> Promise<estado HTTP | null>. Si ya hay una en vuelo, no pide otra:
    // la deja terminar y lee UNA vez mas (lo de ahora pudo cambiar despues
    // de que salio). Un fallo de red, 500 o 501 deja lo ultimo pintado; 401 /
    // 403 lo quita (ya no es ADM: SesionAdmin se ocupa de la pagina).
    actualizar() {
      var self = this;
      if (!this.activo) return Promise.resolve(null);
      if (this.enCurso) { this.otraVez = true; return this.enCurso; }
      var mia = ++this.lecturas;
      this.enCurso = Promise.resolve()
        .then(function () { return self.pedir(URL + '?accion=resumen', { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          if (mia !== self.lecturas || !self.activo) return r.status;
          self.ultimoEstado = r.status;
          if (r.status === 200) self.pintar(r.json);
          else if (r.status === 401 || r.status === 403) self.pintar(null);
          return r.status;
        }, function () { return null; })
        .then(function (estado) {
          self.enCurso = null;
          if (self.otraVez && self.activo) { self.otraVez = false; return self.actualizar(); }
          self.otraVez = false;
          return estado;
        });
      return this.enCurso;
    }

    // Se abrio el detalle de una solicitud. Solo una PENDIENTE de su cola se
    // marca (una resuelta ya no cuenta); cada una una vez por pagina.
    // -> Promise<bool> (true = el servidor la marco).
    marcar(tipo, id, estado) {
      var self = this, clave = tipo + ':' + id;
      if (!this.activo || this.sinVistas || !PENDIENTE[tipo] || estado !== PENDIENTE[tipo] || !(id > 0) || this.vistas[clave]) {
        return Promise.resolve(false);
      }
      this.vistas[clave] = true;
      var datos = new FormData();
      datos.append('tipo', tipo);
      datos.append('id', String(id));
      return Promise.resolve()
        .then(function () { return self.pedir(URL + '?accion=marcar', { method: 'POST', body: datos, credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          var ok = r.status === 200 && r.json.vista === true;
          if (!ok) delete self.vistas[clave];
          if (r.status === 501) self.sinVistas = true;
          if (!ok) return false;
          return self.actualizar().then(function () { return true; });
        }, function () { delete self.vistas[clave]; return false; });
    }
  }

  return { Aviso: Aviso, estadoDe: estadoDe, textoNumero: textoNumero, URL: URL };
})();
