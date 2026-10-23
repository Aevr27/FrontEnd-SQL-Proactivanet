/* =========================================================================
   admin/solicitudes-nuevas.js - vista "Iniciativas" de la pestaña
   Solicitudes: registro de las Nuevas solicitudes guardadas (sql/29) y su
   revision por ADM (sql/31).

     listar    GET  handlers/admin_iniciativas_solicitudes_nuevas.ashx?accion=listar
     detalle   GET  ...?accion=detalle&numero=      la solicitud y su historial
     aprobar   POST handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx?accion=aprobar
                    numero, comentario (opcional)
     rechazar  POST ...?accion=rechazar             numero, comentario (obligatorio)

   APROBADA = aprobada para que ADM cree la iniciativa a mano (Administracion
   -> Crear); no se crea ninguna iniciativa. APROBADA y RECHAZADA son finales.
   Los botones salen solo en una ENVIADA y solo si el servidor dice
   revision_disponible (sql/31 en la base). "Aprobada" / "rechazada" se dice
   SOLO con la respuesta del servidor; despues se releen lista y detalle.
   Nunca usa el endpoint de Cambios.

   Conmutador "Iniciativas | Cambios" (solVerNuevas / solVerCambio): "Cambios"
   es la de siempre (admin/solicitudes-cambio.js, en solVistaCambio) y sigue
   siendo la de inicio; esta vista no la toca, solo la oculta o la muestra.

   Solo UX: el servidor exige ADM (AccesoAdmin.ExigirAdm) en los dos
   handlers. Cada respuesta se dice distinto: cargando, sin solicitudes,
   faltan las tablas (501), sin permiso (403), la base fallo (500) y sin
   conexion.
   Se prueba en node: tools/tests/SolicitudesNuevasSmoke.js.
   ========================================================================= */
window.SolicitudesNuevas = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_solicitudes_nuevas.ashx';
  var URL_REVISION = '../handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx';
  var MAXIMO_COMENTARIO = 2000;   // RevisionSolicitudesIniciativa.MaximoComentario
  var ESTADOS = { ENVIADA: 'Enviada', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' };
  var EVENTOS = { ENVIADA: 'Enviada', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' };

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

  // puedeRevisar: ADM y revision_disponible. Los botones, solo en ENVIADA.
  function htmlDetalle(d, puedeRevisar) {
    var revisada = d.estado === 'APROBADA' || d.estado === 'RECHAZADA';
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
        (e.estado_anterior || e.estado_nuevo ? '<span class="ini-sub">' + estado(e.estado_anterior) + ' → ' + estado(e.estado_nuevo) + '</span>' : '') +
        (e.detalle ? '<span class="ini-sub">«' + h(e.detalle) + '»</span>' : '') + '</li>';
    }).join('');
    var revision = revisada
      ? '<p class="ini-nota"><strong>' + estado(d.estado) + '</strong> por ' + nada(d.revisado_por) + ' el ' + fechaHora(d.fecha_revision_utc) +
        (d.comentario_revision ? ': «' + h(d.comentario_revision) + '»' : '') +
        (d.estado === 'APROBADA' ? '<span class="ini-sub">Crea la iniciativa a mano en Administración → Crear.</span>' : '') + '</p>'
      : '';
    var acciones = d.estado === 'ENVIADA' && puedeRevisar
      ? '<div class="ini-cambio-campos"><div class="campo ini-cambio-ancho"><label for="snComentario">Comentario (obligatorio para rechazar; opcional al aprobar)</label>' +
        '<textarea id="snComentario" rows="3" maxlength="' + MAXIMO_COMENTARIO + '"></textarea></div></div>' +
        '<div class="ini-cambio-pie"><button type="button" class="btn chico" data-sn-accion="aprobar">Aprobar</button> ' +
        '<button type="button" class="btn linea chico" data-sn-accion="rechazar">Rechazar</button> ' +
        '<button type="button" class="btn linea chico" data-sn-accion="cerrar">Cerrar</button></div>'
      : '<div class="ini-cambio-pie"><button type="button" class="btn linea chico" data-sn-accion="cerrar">Cerrar</button></div>';
    return '<h4>Solicitud ' + h(d.numero_texto) + (d.titulo ? ' · ' + h(d.titulo) : '') + '</h4>' +
      '<table class="ini-det-tabla"><tbody>' + filas + '</tbody></table>' +
      '<h5>Descripción</h5><div class="ini-texto">' + nada(d.descripcion) + '</div>' +
      '<h5>Observaciones</h5><div class="ini-texto">' + nada(d.observaciones) + '</div>' + revision +
      '<div class="ini-cambio-msg" id="snDetMsg" role="status" aria-live="polite"></div>' + acciones +
      '<h5>Historial de la solicitud</h5>' +
      (eventos ? '<ul class="ini-sol-eventos">' + eventos + '</ul>' : '<p class="ini-nota">Sin eventos registrados.</p>');
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
      this.ocupado = false;      // una revision a la vez (doble clic)
      this.alVerCambio = null;   // al volver a "Cambios": la pagina relee esa cola
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
        var a = el && el.getAttribute && el.getAttribute('data-sn-accion');
        if (a === 'aprobar') self.aprobar();
        else if (a === 'rechazar') self.rechazar();
        else if (a === 'cerrar') self.cerrarDetalle();
      });
    }

    // Al mostrar la pestaña (despues de ColaSolicitudes.abrir). Sin ADM: ni
    // conmutador ni "Iniciativas"; "Cambios" se queda como la pinta su modulo.
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
          caja.innerHTML = htmlDetalle(r.json, self.rol === 'ADM' && r.json.revision_disponible === true);
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

    comentario() { var c = this.$('snComentario'); return c ? String(c.value || '').trim() : ''; }

    aprobar() { return this.revisar('aprobar', 'aprobada'); }

    rechazar() {
      if (this.detalle && !this.comentario()) {
        this.mensaje('snDetMsg', 'error', 'Escribe por qué se rechaza.');
        return Promise.resolve(null);
      }
      return this.revisar('rechazar', 'rechazada');
    }

    // POST al endpoint de revision (nunca al de Cambios). Despues se releen
    // lista y detalle: la verdad es la del servidor (quien gano, el estado).
    revisar(accion, exito) {
      var self = this, d = this.detalle;
      if (!d || this.ocupado || d.estado !== 'ENVIADA') return Promise.resolve(null);
      var comentario = this.comentario();
      if (comentario.length > MAXIMO_COMENTARIO) {
        this.mensaje('snDetMsg', 'error', 'El comentario no puede pasar de ' + MAXIMO_COMENTARIO + ' caracteres.');
        return Promise.resolve(null);
      }
      var datos = new FormData();
      datos.append('numero', String(d.numero));
      if (comentario) datos.append('comentario', comentario);
      this.ocupado = true;
      this.mensaje('snDetMsg', '', '<span>' + (accion === 'aprobar' ? 'Aprobando…' : 'Rechazando…') + '</span>');
      return Promise.resolve().then(function () {
        return self.pedir(URL_REVISION + '?accion=' + accion, { method: 'POST', body: datos, credentials: 'same-origin' });
      })
        .then(leer)
        .then(function (r) {
          self.ocupado = false;
          var j = r.json, ok = r.status === 200 && j[exito] === true;
          var html = ok
            ? (accion === 'aprobar'
                ? '<strong>Solicitud ' + h(d.numero_texto) + ' aprobada.</strong> Crea la iniciativa a mano en Administración → Crear.'
                : '<strong>Solicitud ' + h(d.numero_texto) + ' rechazada.</strong>')
            : j[exito] === null ? h(j.error || 'No se pudo confirmar.') + ' Revisa la solicitud antes de reintentar.'
            : '<strong>No se ' + (accion === 'aprobar' ? 'aprobó' : 'rechazó') + '.</strong> ' + h(j.error || ('Respuesta ' + r.status + '.'));
          var clase = ok ? 'listo' : j[exito] === null ? 'aviso' : 'error';
          return Promise.all([self.listar(), self.verDetalle(d.numero)]).then(function () {
            self.mensaje('snDetMsg', clase, html);
            return r;
          });
        }, function () {
          self.ocupado = false;
          self.mensaje('snDetMsg', 'aviso', 'No se pudo contactar al servidor: no se sabe si se ' + (accion === 'aprobar' ? 'aprobó' : 'rechazó') +
            '. Actualiza la lista antes de reintentar.');
          return null;
        });
    }
  }

  return { RegistroSolicitudesNuevas: RegistroSolicitudesNuevas, htmlLista: htmlLista, htmlDetalle: htmlDetalle,
           textoError: textoError, textoTotal: textoTotal, URL: URL, URL_REVISION: URL_REVISION };
})();
