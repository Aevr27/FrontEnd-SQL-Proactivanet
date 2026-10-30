/* =========================================================================
   assets/js/refresco-auto.js

   RefrescoAuto: vuelve a pedir una lista cada cierto tiempo, en segundo
   plano, SIN duplicar la carga: quien la usa le pasa su propia funcion de
   "Actualizar" (la misma del boton) y aqui solo se decide CUANDO llamarla.

   QUE HACE (y nada mas)
   ---------------------
     - un temporizador (setTimeout encadenado, nunca dos a la vez) cada
       `intervalo` ms;
     - en cada vuelta llama a `refrescar()` SOLO si la pagina esta visible
       (document.hidden = false), si `puede()` dice que si (la lista se ve
       y nadie esta escribiendo / con un detalle abierto) y si la anterior
       ya termino: nunca dos peticiones encimadas;
     - `refrescar()` devuelve una promesa con el estado HTTP (o null). Con
       401 / 403 se detiene: el acceso cambio, y de eso se ocupa la sesion
       de la pagina (SesionAdmin.vigilar ya envuelve fetch). No reintenta;
     - al volver la pestaña a visible, si ya paso el intervalo, refresca en
       ese momento (no espera la siguiente vuelta).

   QUE NO HACE: no pide nada por su cuenta, no pinta, no borra la lista ni
   decide que mostrar si falla: eso es de la funcion que se le pasa. No
   guarda nada en el navegador.

   Uso:
     var r = new RefrescoAuto({ intervalo: 120000, refrescar: fn, puede: fn });
     r.iniciar(); ... r.detener();

   Lo prueba tools/tests/RefrescoAutoSmoke.js.
   ========================================================================= */
(function (global) {
  'use strict';

  class RefrescoAuto {
    // opciones: { intervalo (ms), refrescar () -> Promise<estado HTTP|null>,
    //   puede () -> bool, doc (document), reloj ({ ahora, programar, cancelar }) }
    constructor(opciones) {
      var o = opciones || {};
      this.intervalo = o.intervalo > 0 ? o.intervalo : RefrescoAuto.INTERVALO;
      this.refrescar = o.refrescar;
      this.puede = typeof o.puede === 'function' ? o.puede : function () { return true; };
      this.doc = o.doc || (typeof document !== 'undefined' ? document : null);
      var t = global;
      this.reloj = o.reloj || {
        ahora: function () { return Date.now(); },
        programar: function (fn, ms) { return t.setTimeout(fn, ms); },
        cancelar: function (id) { t.clearTimeout(id); }
      };
      this.temporizador = null;
      this.enCurso = false;
      this.activo = false;
      this.ultimo = this.reloj.ahora();
      this.detenidoPor = null;   // estado HTTP que lo detuvo (401 / 403)
      var self = this;
      this.alVisible = function () {
        if (self.activo && !self.oculto() && self.reloj.ahora() - self.ultimo >= self.intervalo) self.vuelta();
      };
    }

    oculto() { return !!(this.doc && this.doc.hidden); }

    iniciar() {
      if (this.activo || typeof this.refrescar !== 'function') return this;
      this.activo = true;
      this.detenidoPor = null;
      this.ultimo = this.reloj.ahora();
      if (this.doc && this.doc.addEventListener) this.doc.addEventListener('visibilitychange', this.alVisible);
      this.programar();
      return this;
    }

    detener() {
      this.activo = false;
      if (this.temporizador !== null) this.reloj.cancelar(this.temporizador);
      this.temporizador = null;
      if (this.doc && this.doc.removeEventListener) this.doc.removeEventListener('visibilitychange', this.alVisible);
      return this;
    }

    programar() {
      var self = this;
      if (this.temporizador !== null) this.reloj.cancelar(this.temporizador);
      this.temporizador = this.reloj.programar(function () { self.temporizador = null; self.vuelta(); }, this.intervalo);
    }

    // Una vuelta: refresca si se puede y deja programada la siguiente.
    // -> Promise (para las pruebas).
    vuelta() {
      var self = this;
      if (!this.activo) return Promise.resolve(false);
      if (this.enCurso || this.oculto() || !this.puede()) { this.programar(); return Promise.resolve(false); }
      this.enCurso = true;
      this.ultimo = this.reloj.ahora();
      if (this.temporizador !== null) { this.reloj.cancelar(this.temporizador); this.temporizador = null; }
      return Promise.resolve()
        .then(function () { return self.refrescar(); })
        .then(function (estado) { return estado; }, function () { return null; })
        .then(function (estado) {
          self.enCurso = false;
          if (estado === 401 || estado === 403) { self.detenidoPor = estado; self.detener(); return true; }
          if (self.activo) self.programar();
          return true;
        });
    }
  }

  // 2 minutos: las listas de Solicitudes no tienen cache en el servidor
  // (cache: no-store) y cambian cuando alguien envia, aprueba o rechaza, no
  // con el ETL; mas seguido solo sumaria peticiones.
  RefrescoAuto.INTERVALO = 120000;

  // 5 minutos: datos de los tableros (SLA, Call Center, Backlog, QARE, QA,
  // Experiencia, Efectividad y Orquestacion en dashboard.js) y el registro
  // de Iniciativas en Admin. Es el UNICO sitio
  // donde se cambia: quien refresca datos lo lee de aqui. No acelera el
  // dato de origen: lo que llega depende del ETL (ver DASHBOARD.md, 2.4).
  RefrescoAuto.INTERVALO_DATOS = 300000;

  // ¿Hay un desplegable propio (assets/js/desplegable.js) abierto? Con el
  // menu de un filtro abierto el usuario esta eligiendo: no se refresca.
  RefrescoAuto.eligiendo = function (doc) {
    return !!(doc && doc.querySelector && doc.querySelector('.dd.abierto'));
  };

  // ¿Alguien esta escribiendo o eligiendo dentro de `caja`? (un input,
  // textarea o select con el foco, o lo que sea contentEditable).
  RefrescoAuto.editando = function (doc, caja) {
    var a = doc && doc.activeElement;
    if (!a || !caja || !caja.contains || !caja.contains(a)) return false;
    var tag = String(a.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable === true;
  };

  // Boton "Actualizar": llama a `fn` (-> Promise) YA, sin esperar al
  // temporizador. Deshabilitado mientras la peticion esta en vuelo, asi que
  // varios clics seguidos son una sola peticion. Un solo listener por boton.
  RefrescoAuto.cablearBoton = function (boton, fn) {
    if (!boton || boton.dataset.refrescoCableado) return;
    boton.dataset.refrescoCableado = '1';
    boton.addEventListener('click', function () {
      if (boton.disabled) return;
      var texto = boton.textContent;
      boton.disabled = true;
      boton.textContent = 'Actualizando…';
      var listo = function () { boton.disabled = false; boton.textContent = texto; };
      Promise.resolve().then(fn).then(listo, listo);
    });
  };

  global.RefrescoAuto = RefrescoAuto;
})(typeof window !== 'undefined' ? window : globalThis);
