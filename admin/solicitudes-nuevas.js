/* =========================================================================
   admin/solicitudes-nuevas.js - vista "Nuevas" de la pestaña Solicitudes:
   registro de SOLO LECTURA de las Nuevas solicitudes guardadas (sql/29).
   handlers/admin_iniciativas_solicitudes_nuevas.ashx.

     listar   GET ?accion=listar               las mas recientes primero
     detalle  GET ?accion=detalle&numero=      la solicitud y su historial

   Conmutador "Iniciativas | Cambios" (solVerNuevas / solVerCambio): "Cambios"
   es la de siempre (admin/solicitudes-cambio.js, en solVistaCambio) y sigue
   siendo la de inicio; esta vista no la toca, solo la oculta o la muestra.
   Sin aprobar, rechazar, borrar ni cambiar estado.

   Solo UX: el servidor exige ADM (AccesoAdmin.ExigirAdm). Cada respuesta se
   dice distinto: cargando, sin solicitudes, faltan las tablas (501), sin
   permiso (403), la base fallo (500) y sin conexion.
   Se prueba en node: tools/tests/SolicitudesNuevasSmoke.js.
   ========================================================================= */
window.SolicitudesNuevas = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_solicitudes_nuevas.ashx';
  var ESTADOS = { ENVIADA: 'Enviada' };
  var EVENTOS = { ENVIADA: 'Enviada' };

  function h(s) { return Escape.html(s === null || s === undefined ? '' : String(s)); }
  function nada(v) { return v === null || v === undefined || v === '' ? '—' : h(v); }
  // "aaaa-mm-ddThh:mm:ssZ" (UTC) -> hora local legible (como la cola de cambios).
  function fechaHora(utc) {
    if (!utc) return '—';
    var d = new Date(utc);
    if (isNaN(d.getTime())) return h(utc);
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  function estado(e) { return e ? h(ESTADOS[e] || e) : '—'; }
  function solicitante(s) {
    return (s.solicitante_nombre ? h(s.solicitante_nombre) : nada(s.solicitante_cuenta)) +
      (s.solicitante_correo ? '<span class="ini-sub">' + h(s.solicitante_correo) + '</span>' : '');
  }

  function htmlLista(lista) {
    if (!lista.length) return '<p class="ini-nota">Todavía no hay solicitudes nuevas guardadas.</p>';
    return '<table class="ini-det-tabla ini-sol-tabla"><thead><tr><th scope="col">Número</th><th scope="col">Tipo</th>' +
      '<th scope="col">Título</th><th scope="col">Solicitó</th><th scope="col">Product Owner</th><th scope="col">Service Owner</th>' +
      '<th scope="col">Categoría</th><th scope="col">Enviada</th><th scope="col">Estado</th></tr></thead><tbody>' +
      lista.map(function (s) {
        return '<tr class="ini-sol-fila" data-sn-numero="' + h(s.numero) + '">' +
          '<td><button type="button" class="ini-folio" data-sn-numero="' + h(s.numero) + '">' + h(s.numero_texto) + '</button></td>' +
          '<td>' + nada(s.tipo) + '</td><td>' + nada(s.titulo) + '</td><td>' + solicitante(s) + '</td>' +
          '<td>' + nada(s.po) + '</td><td>' + nada(s.so) + '</td><td class="ini-cat-ruta">' + nada(s.categoria) + '</td>' +
          '<td>' + fechaHora(s.fecha_utc) + '</td><td>' + estado(s.estado) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // "Mostrando las 200 más recientes de 250." solo si hay mas de las que se ven.
  function textoTotal(j) {
    var n = (j.solicitudes || []).length;
    return typeof j.total === 'number' && j.total > n
      ? 'Mostrando las ' + n + ' más recientes de ' + j.total + '.'
      : '';
  }

  function htmlDetalle(d) {
    var filas = [
      ['Tipo de iniciativa', nada(d.tipo)],
      ['Solicitó', solicitante(d) + (d.solicitante_cuenta && d.solicitante_nombre ? '<span class="ini-sub">' + h(d.solicitante_cuenta) + '</span>' : '')],
      ['Product Owner', nada(d.po) + (d.po_correo ? '<span class="ini-sub">' + h(d.po_correo) + '</span>' : '')],
      ['Service Owner', nada(d.so)],
      ['Categoría', '<span class="ini-cat-ruta">' + nada(d.categoria) + '</span>'],
      ['Director', nada(d.director)],
      ['Volumetría', nada(d.volumetria)],
      ['% de disminución', d.pct === null || d.pct === undefined ? '—' : h(d.pct) + '%'],
      ['RCA', d.rca_extension ? 'Adjunto .' + h(String(d.rca_extension).toLowerCase()) + ' (el archivo no se guarda)' : '—'],
      ['Enviada', fechaHora(d.fecha_utc)],
      ['Estado', estado(d.estado)]
    ].map(function (f) { return '<tr><th scope="row">' + f[0] + '</th><td>' + f[1] + '</td></tr>'; }).join('');
    var eventos = (d.eventos || []).map(function (e) {
      return '<li><strong>' + h(EVENTOS[e.evento] || e.evento) + '</strong> · ' + fechaHora(e.fecha_utc) + ' · ' + nada(e.usuario) +
        (e.estado_anterior || e.estado_nuevo ? '<span class="ini-sub">' + estado(e.estado_anterior) + ' → ' + estado(e.estado_nuevo) + '</span>' : '') + '</li>';
    }).join('');
    return '<h4>Solicitud ' + h(d.numero_texto) + (d.titulo ? ' · ' + h(d.titulo) : '') + '</h4>' +
      '<table class="ini-det-tabla"><tbody>' + filas + '</tbody></table>' +
      '<h5>Descripción</h5><div class="ini-texto">' + nada(d.descripcion) + '</div>' +
      '<h5>Observaciones</h5><div class="ini-texto">' + nada(d.observaciones) + '</div>' +
      '<h5>Historial de la solicitud</h5>' +
      (eventos ? '<ul class="ini-sol-eventos">' + eventos + '</ul>' : '<p class="ini-nota">Sin eventos registrados.</p>') +
      '<div class="ini-cambio-pie"><button type="button" class="btn linea chico" data-sn-accion="cerrar">Cerrar</button></div>';
  }

  // El texto de una respuesta que no es 200, segun lo que paso.
  function textoError(status, json, que) {
    if (status === 501) return { clase: 'aviso', html: h(json.error || 'El registro de solicitudes nuevas no está disponible en la base.') };
    if (status === 403) return { clase: 'error', html: h(json.error || 'No tienes permiso para ver las solicitudes nuevas.') };
    if (status === 404) return { clase: 'error', html: h(json.error || 'La solicitud no existe.') };
    if (status >= 500) return { clase: 'error', html: 'Error de la base de datos al leer ' + que + ': ' + h(json.error || ('respuesta ' + status)) + '. Intenta de nuevo con «Actualizar».' };
    return { clase: 'error', html: h(json.error || ('No se pudo leer ' + que + ' (respuesta ' + status + ').')) };
  }

  function leer(resp) {
    return Promise.resolve(resp.json()).catch(function () { return null; }).then(function (j) { return { status: resp.status, json: j || {} }; });
  }

  class RegistroSolicitudesNuevas {
    // pedir(url, op) -> Promise<Response> (fetch por omision).
    constructor(doc, pedir) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.rol = null;
      this.vista = 'cambio';     // 'nuevas' | 'cambio' (la de siempre, de inicio)
      this.detalle = null;
      this.alVerCambio = null;   // al volver a "De cambio": la pagina relee esa cola
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    fijarRol(rol) { this.rol = rol === 'ADM' || rol === 'MOD' ? rol : null; }

    cablear() {
      if (this.cableado || !this.$('snBloque')) return;
      this.cableado = true;
      var self = this;
      this.$('solVerNuevas').addEventListener('click', function () { self.verNuevas(); });
      this.$('solVerCambio').addEventListener('click', function () { self.verCambio(); });
      this.$('snActualizar').addEventListener('click', function () { self.listar(); });
      this.$('snLista').addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-sn-numero]') : e.target;
        var n = el && el.getAttribute && el.getAttribute('data-sn-numero');
        if (n) self.verDetalle(Number(n));
      });
      this.$('snDetalle').addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-sn-accion]') : e.target;
        if (el && el.getAttribute && el.getAttribute('data-sn-accion') === 'cerrar') self.cerrarDetalle();
      });
    }

    // Al mostrar la pestaña (despues de ColaSolicitudes.abrir). Sin ADM: ni
    // conmutador ni "Nuevas"; "De cambio" se queda como la pinta su modulo.
    abrir() {
      this.cablear();
      if (!this.$('snBloque')) return Promise.resolve(null);
      var adm = this.rol === 'ADM';
      this.$('solVistas').hidden = !adm;
      if (!adm) {
        this.$('snBloque').hidden = true;
        this.$('solVistaCambio').hidden = false;
        return Promise.resolve(null);
      }
      this.aplicarVista();
      return this.vista === 'nuevas' ? this.listar() : Promise.resolve(null);
    }

    aplicarVista() {
      var nuevas = this.vista === 'nuevas', self = this;
      this.$('snBloque').hidden = !nuevas;
      this.$('solVistaCambio').hidden = nuevas;
      [['solVerNuevas', nuevas], ['solVerCambio', !nuevas]].forEach(function (par) {
        self.$(par[0]).classList.toggle('activa', par[1]);
        self.$(par[0]).setAttribute('aria-pressed', par[1] ? 'true' : 'false');
      });
    }

    verNuevas() {
      if (this.rol !== 'ADM') return Promise.resolve(null);
      this.vista = 'nuevas';
      this.aplicarVista();
      return this.listar();
    }

    verCambio() {
      this.vista = 'cambio';
      this.aplicarVista();
      if (this.alVerCambio) this.alVerCambio();
    }

    mensaje(id, clase, html) {
      var m = this.$(id);
      if (!m) return;
      m.className = 'ini-cambio-msg ' + clase;
      m.innerHTML = html;
    }

    listar() {
      var self = this;
      this.mensaje('snMsg', '', '<span>Cargando solicitudes nuevas…</span>');
      this.$('snResumen').textContent = '';
      return Promise.resolve().then(function () { return self.pedir(URL + '?accion=listar', { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          if (r.status === 200 && Array.isArray(r.json.solicitudes)) {
            self.$('snLista').innerHTML = htmlLista(r.json.solicitudes);
            self.$('snResumen').textContent = textoTotal(r.json);
            self.mensaje('snMsg', '', '');
            return r.json.solicitudes;
          }
          self.$('snLista').innerHTML = '';
          var e = textoError(r.status, r.json, 'las solicitudes');
          self.mensaje('snMsg', e.clase, e.html);
          return null;
        }, function () {
          self.$('snLista').innerHTML = '';
          self.mensaje('snMsg', 'error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    verDetalle(numero) {
      var self = this;
      this.mensaje('snMsg', '', '<span>Cargando la solicitud…</span>');
      return Promise.resolve().then(function () {
        return self.pedir(URL + '?accion=detalle&numero=' + encodeURIComponent(numero), { cache: 'no-store', credentials: 'same-origin' });
      })
        .then(leer)
        .then(function (r) {
          if (r.status !== 200) {
            var e = textoError(r.status, r.json, 'la solicitud');
            self.mensaje('snMsg', e.clase, e.html);
            return null;
          }
          self.mensaje('snMsg', '', '');
          self.detalle = r.json;
          var caja = self.$('snDetalle');
          caja.innerHTML = htmlDetalle(r.json);
          caja.hidden = false;
          return r.json;
        }, function () {
          self.mensaje('snMsg', 'error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    cerrarDetalle() {
      this.detalle = null;
      this.$('snDetalle').hidden = true;
      this.$('snDetalle').innerHTML = '';
    }
  }

  return { RegistroSolicitudesNuevas: RegistroSolicitudesNuevas, htmlLista: htmlLista, htmlDetalle: htmlDetalle,
           textoError: textoError, textoTotal: textoTotal, URL: URL };
})();
