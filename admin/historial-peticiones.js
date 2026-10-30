/* =========================================================================
   admin/historial-peticiones.js - "Historial de peticiones" (pestaña
   Administracion, solo ADM). handlers/admin_iniciativas_historial.ashx (GET).

   Las peticiones ENVIADAS de los dos tipos que ya existen, en una sola
   lista de SOLO LECTURA, la mas reciente primero:
     Solicitar una iniciativa  adm.SolicitudIniciativa (sql/29), folio #0000012
     Solicitar cambios         adm.SolicitudCambio (sql/22), folio #12
   Fecha = la de ENVIO (no la de revision). Estado = el guardado, rotulado
   como en sus colas. No hay aprobar, rechazar ni editar aqui: "Ver" abre el
   detalle de siempre en la pestaña Solicitudes (abrirDetalle), con las
   reglas de esa vista.

   Filtros: Fecha desde / Fecha hasta (dias LOCALES, como se pintan las
   horas) y Tipo de peticion. Al servidor viajan como instantes UTC: el
   inicio del dia "desde" y el inicio del dia SIGUIENTE a "hasta"
   (excluido), asi que el ultimo dia entra completo. Desde > hasta: aviso y
   no se pide nada. Por omision: SIN rango (todo el historial que el
   servidor devuelve, a lo mas `maximo`, y dice cuantas habia). "Limpiar"
   vuelve a eso.

   Solo UX: el servidor exige ADM (AccesoAdmin.ExigirAdm).
   Se prueba en node: tools/tests/HistorialPeticionesSmoke.js.
   ========================================================================= */
window.HistorialPeticiones = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_historial.ashx';
  var TIPOS = { INICIATIVA: 'Solicitar una iniciativa', CAMBIO: 'Solicitar cambios' };
  // Los rotulos de cada cola (solicitudes-nuevas.js / solicitudes-cambio.js).
  var ESTADOS = {
    INICIATIVA: { ENVIADA: 'Enviada', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' },
    CAMBIO: { PENDIENTE: 'Pendiente', APLICADA: 'Aplicada', RECHAZADA: 'Rechazada' }
  };

  function h(s) { return Escape.html(s === null || s === undefined ? '' : String(s)); }
  function nada(v) { return v === null || v === undefined || v === '' ? '—' : h(v); }
  // "aaaa-mm-ddThh:mm:ssZ" (UTC) -> hora local legible (como las colas).
  function fechaHora(utc) {
    if (!utc) return '—';
    var d = new Date(utc);
    if (isNaN(d.getTime())) return h(utc);
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  // 'aaaa-mm-dd' (un <input type="date">) -> Date local a las 00:00, o null.
  function diaLocal(iso, masDias) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (masDias || 0), 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  // Date -> 'aaaa-mm-ddThh:mm:ssZ' (lo que acepta el handler).
  function utcIso(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  // Filtros de la pantalla -> { qs } o { error }. desde / hasta: 'aaaa-mm-dd'
  // o ''; tipo: '', 'INICIATIVA' o 'CAMBIO'.
  function consulta(desde, hasta, tipo) {
    var p = [];
    var d = desde ? diaLocal(desde) : null, f = hasta ? diaLocal(hasta, 1) : null;
    if (desde && !d) return { error: 'La fecha desde no es válida.' };
    if (hasta && !f) return { error: 'La fecha hasta no es válida.' };
    if (desde && hasta && desde > hasta) return { error: 'La fecha desde no puede ser posterior a la fecha hasta.' };
    if (d) p.push('desde=' + encodeURIComponent(utcIso(d)));
    if (f) p.push('hasta=' + encodeURIComponent(utcIso(f)));
    if (tipo === 'INICIATIVA' || tipo === 'CAMBIO') p.push('tipo=' + tipo);
    return { qs: p.join('&') };
  }

  function solicitante(p) {
    var quien = p.solicitante_nombre ? h(p.solicitante_nombre) : nada(p.solicitante_cuenta);
    var sub = p.solicitante_nombre && p.solicitante_cuenta ? p.solicitante_cuenta : p.solicitante_correo;
    return quien + (p.rol_solicitante ? ' <span class="chip ini-chip">' + h(p.rol_solicitante) + '</span>' : '') +
      (sub ? '<span class="ini-sub">' + h(sub) + '</span>' : '');
  }
  function iniciativa(p) {
    if (p.tipo === 'CAMBIO') {
      return nada(p.iniciativa_codigo) + (p.iniciativa_titulo ? '<span class="ini-sub">' + h(p.iniciativa_titulo) + '</span>' : '');
    }
    // La pedida: su titulo y, si la aprobacion la creo, su codigo.
    return nada(p.iniciativa_titulo) + (p.iniciativa_codigo ? '<span class="ini-sub">' + h(p.iniciativa_codigo) + '</span>' : '');
  }
  function estado(p) {
    var rotulos = ESTADOS[p.tipo] || {};
    return p.estado ? h(rotulos[p.estado] || p.estado) : '—';
  }

  function htmlLista(lista) {
    var filas = lista.map(function (p) {
      var tipo = TIPOS[p.tipo] || p.tipo || '—';
      var clase = p.tipo === 'CAMBIO' ? 'ini-hp-cambio' : 'ini-hp-iniciativa';
      return '<tr>' +
        '<td>' + fechaHora(p.fecha_utc) + '</td>' +
        '<td><span class="chip ini-hp-tipo ' + clase + '">' + h(tipo) + '</span></td>' +
        '<td><button type="button" class="ini-folio" data-hp-tipo="' + h(p.tipo) + '" data-hp-id="' + h(p.id) + '" ' +
          'title="Abrir su detalle en Solicitudes">' + nada(p.folio) + '</button></td>' +
        '<td>' + solicitante(p) + '</td>' +
        '<td>' + iniciativa(p) + '</td>' +
        '<td>' + estado(p) + '</td></tr>';
    }).join('');
    return '<table class="ini-det-tabla ini-hp-tabla"><thead><tr><th scope="col">Fecha</th><th scope="col">Tipo de petición</th>' +
      '<th scope="col">Folio</th><th scope="col">Solicitante</th><th scope="col">Iniciativa</th><th scope="col">Estado</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table>';
  }

  // "Mostrando las 500 más recientes de 620." solo si hay mas de las que se ven.
  function textoCuenta(j) {
    var n = (j.peticiones || []).length;
    if (typeof j.total === 'number' && j.total > n) {
      return 'Mostrando las ' + n + ' más recientes de ' + j.total + '. Acota las fechas para ver las demás.';
    }
    return n === 1 ? '1 petición' : n + ' peticiones';
  }
  // Un tipo cuya tabla no existe en la base no se calla.
  function textoFuentes(j, tipo) {
    var faltan = [];
    if (tipo !== 'CAMBIO' && j.iniciativas_disponible === false) faltan.push('las solicitudes de iniciativa');
    if (tipo !== 'INICIATIVA' && j.cambios_disponible === false) faltan.push('las solicitudes de cambio');
    return faltan.length ? 'Sin ' + faltan.join(' ni ') + ': todavía no están habilitadas en la base de datos.' : '';
  }

  function leer(resp) {
    return Promise.resolve(resp.json()).catch(function () { return null; }).then(function (j) { return { status: resp.status, json: j || {} }; });
  }

  class VistaHistorial {
    // pedir(url, op) -> Promise<Response> (fetch por omision).
    // abrirDetalle(tipo, id) -> abre su detalle en Solicitudes.
    constructor(doc, pedir, abrirDetalle) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.abrirDetalle = abrirDetalle || function () {};
      this.peticiones = null;
      this.cargaId = 0;      // descarta la respuesta de una carga ya superada
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    cablear() {
      if (this.cableado || !this.$('hpSeccion')) return;
      this.cableado = true;
      var self = this;
      ['hpDesde', 'hpHasta', 'hpTipo'].forEach(function (id) {
        self.$(id).addEventListener('change', function () { self.cargar(); });
      });
      this.$('hpLimpiar').addEventListener('click', function () { self.limpiar(); });
      this.$('hpActualizar').addEventListener('click', function () { self.cargar(); });
      this.$('hpReintentar').addEventListener('click', function () { self.cargar(); });
      this.$('hpLista').addEventListener('click', function (e) {
        var t = e.target;
        var el = t && t.closest ? t.closest('[data-hp-id]') : t;
        if (!el || !el.getAttribute) return;
        var tipo = el.getAttribute('data-hp-tipo'), id = el.getAttribute('data-hp-id');
        if (tipo && id) self.abrirDetalle(tipo, id);
      });
    }

    // cargando | error | invalido | vacio | listo: excluyentes; cargando y
    // error nunca se ven como lista vacia.
    estado(e, texto) {
      this.$('hpCargando').hidden = e !== 'cargando';
      this.$('hpError').hidden = e !== 'error';
      this.$('hpInvalido').hidden = e !== 'invalido';
      this.$('hpVacio').hidden = e !== 'vacio';
      this.$('hpLista').hidden = e !== 'listo';
      if (e === 'error') this.$('hpErrorTexto').textContent = texto || '';
      if (e === 'invalido') this.$('hpInvalido').textContent = texto || '';
      if (e === 'vacio') this.$('hpVacioTexto').textContent = texto || '';
      if (e !== 'listo') this.$('hpCuenta').textContent = '';
    }

    // Al mostrar la pestaña Administracion: relee con los filtros que haya.
    abrir() {
      this.cablear();
      return this.cargar();
    }

    limpiar() {
      this.$('hpDesde').value = '';
      this.$('hpHasta').value = '';
      this.$('hpTipo').value = '';
      return this.cargar();
    }

    cargar() {
      var self = this, mia = ++this.cargaId;
      var tipo = this.$('hpTipo').value || '';
      var c = consulta(this.$('hpDesde').value || '', this.$('hpHasta').value || '', tipo);
      if (c.error) {
        this.peticiones = null;
        this.estado('invalido', c.error);
        return Promise.resolve(null);
      }
      this.estado('cargando');
      return Promise.resolve()
        .then(function () { return self.pedir(URL + (c.qs ? '?' + c.qs : ''), { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          if (mia !== self.cargaId) return null;
          if (r.status !== 200 || !Array.isArray(r.json.peticiones)) {
            self.peticiones = null;
            self.estado('error', r.json.error || ('Respuesta ' + r.status + '.'));
            return null;
          }
          self.peticiones = r.json.peticiones;
          self.$('hpFuentes').textContent = textoFuentes(r.json, tipo);
          self.$('hpFuentes').hidden = !self.$('hpFuentes').textContent;
          var hayFiltro = !!(c.qs);
          if (!self.peticiones.length) {
            self.estado('vacio', hayFiltro ? 'No hay peticiones con estos filtros.' : 'Todavía no hay peticiones enviadas.');
          } else {
            self.$('hpLista').innerHTML = htmlLista(self.peticiones);
            self.estado('listo');
            self.$('hpCuenta').textContent = textoCuenta(r.json);
          }
          return self.peticiones;
        }, function () {
          if (mia !== self.cargaId) return null;
          self.peticiones = null;
          self.estado('error', 'No se pudo contactar al servidor.');
          return null;
        });
    }
  }

  return { VistaHistorial: VistaHistorial, htmlLista: htmlLista, consulta: consulta, textoCuenta: textoCuenta, URL: URL };
})();
