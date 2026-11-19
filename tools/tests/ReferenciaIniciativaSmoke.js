/* =========================================================================
   tools/tests/ReferenciaIniciativaSmoke.js

   Con la pagina real (admin/iniciativas.js + registro-iniciativas.js +
   solicitudes-cambio.js + solicitudes-nuevas.js + historial-peticiones.js),
   sin navegador ni servidor: la referencia a la iniciativa ligada (el Codigo
   de la solicitud aprobada en Iniciativas / Mis solicitudes, el de Mis
   solicitudes de cambio y el del Historial de peticiones) abre el MISMO
   detalle que el Codigo de la cola de cambios (abrirDesdeLista), sin cambiar
   de pestaña; si no esta en el registro cargado (no existe o la cuenta no la
   ve) la lista avisa y no abre nada.

   Correr: node tools/tests/ReferenciaIniciativaSmoke.js
   ========================================================================= */
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8'); }

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

function Elemento(id) {
  var oyentes = {}, clases = {}, atributos = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', disabled: false, className: '', style: {},
    classList: {
      add: function (c) { clases[c] = true; }, remove: function (c) { delete clases[c]; },
      toggle: function (c, v) { if (v) clases[c] = true; else delete clases[c]; },
      contains: function (c) { return !!clases[c]; }
    },
    setAttribute: function (k, v) { atributos[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; },
    removeAttribute: function (k) { delete atributos[k]; },
    closest: function () { return this; },
    focus: function () {},
    hijos: [], offsetWidth: 200,
    appendChild: function (h) { this.hijos.push(h); return h; },
    contains: function (otro) { return otro === this; },
    matches: function () { return false; },
    querySelector: function () { return null; },
    getBoundingClientRect: function () { return { left: 100, width: 80, bottom: 50 }; },
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo, evento) { var self = this; (oyentes[tipo] || []).forEach(function (fn) { fn(evento || { target: self }); }); }
  };
}
function Documento() {
  var els = {};
  var doc = Elemento('document');
  doc.readyState = 'complete';
  doc.getElementById = function (id) { return els[id] || (els[id] = Elemento(id)); };
  doc.querySelectorAll = function () { return []; };
  doc.createElement = function () { return Elemento(''); };
  doc.body = Elemento('body');
  doc.documentElement = Elemento('html');
  return doc;
}
// Un nodo de la lista: closest('[atributo]') sube por los padres.
function Nodo(attrs, padre) {
  return { attrs: attrs, padre: padre || null,
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    closest: function (sel) {
      var m = /^\[([\w-]+)\]$/.exec(sel);
      for (var n = this; n; n = n.padre) if (m && Object.prototype.hasOwnProperty.call(n.attrs, m[1])) return n;
      return null;
    } };
}
function Respuesta(status, cuerpo) {
  return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(cuerpo); } };
}
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

var doc = Documento();
var pedir = function () { return Promise.resolve(Respuesta(500, { error: 'sin datos en la prueba' })); };
var w = Elemento('window');
(new Function('window', leer('assets/js/escape.js')))(w);
(new Function('window', leer('assets/js/duracion.js')))(w);
(new Function('window', 'Escape', leer('assets/js/catalogos.js')))(w, w.Escape);
(new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(w, doc);
(new Function('window', leer('admin/cascada-organizacional.js')))(w);
(new Function('window', leer('assets/js/seleccion-kpi.js')))(w);
(new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(w, doc, w.Catalogos, w.Escape, w.Duracion, pedir);
(new Function('window', 'Escape', 'fetch', leer('admin/solicitudes-cambio.js')))(w, w.Escape, pedir);
(new Function('window', 'Escape', 'fetch', leer('admin/solicitudes-nuevas.js')))(w, w.Escape, pedir);
(new Function('window', 'Escape', 'fetch', leer('admin/historial-peticiones.js')))(w, w.Escape, pedir);
(new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
  w, doc, w.Catalogos, w.Escape, w.GloboAyuda, pedir);

esperar().then(function () {
  var pg = w.IniciativasPagina, reg = pg.registro;
  var SN = w.SolicitudesNuevas, SC = w.SolicitudesCambioCola, HP = w.HistorialPeticiones;
  var abrir = w.Iniciativas.abrirIniciativaAqui;

  Check('R1 la pagina da el mismo abridor a Iniciativas, Mis solicitudes, Mis cambios e Historial',
    ['function', 'function', 'function', 'function', true, true],
    [typeof pg.nuevas.alVerIniciativa, typeof pg.mias.alVerIniciativa, typeof pg.misCambios.alVerIniciativa,
     typeof pg.historial.alVerIniciativa, pg.nuevas.alVerIniciativa === pg.mias.alVerIniciativa,
     pg.misCambios.alVerIniciativa === pg.historial.alVerIniciativa]);

  // ---- abrirIniciativaAqui (sin pagina) ----
  var visto = [];
  var falso = { registro: null, abrirDesdeLista: function (f) { visto.push(f); return true; } };
  Check('R2a registro sin cargar: sin_registro, con mensaje, sin abrir', ['sin_registro', true, 0],
    [abrir(falso, 'PRE 2026-000199').estado, /todavía no se carga/.test(abrir(falso, 'PRE 2026-000199').mensaje), visto.length]);
  falso.registro = { buscar: function (f) { return f === 'PRE 2026-000199' ? { folio: f } : null; } };
  var r = abrir(falso, 'PRE 2026-000999');
  Check('R2b no esta en el registro (no existe o no la ve): no_encontrada, mensaje con el codigo, sin abrir',
    ['no_encontrada', true, 0], [r.estado, /PRE 2026-000999/.test(r.mensaje) && /no tiene acceso/.test(r.mensaje), visto.length]);
  Check('R2c en el registro: abierta, sin mensaje; el codigo llega recortado', [{ estado: 'abierta', mensaje: '' }, ['PRE 2026-000199']],
    [abrir(falso, '  PRE 2026-000199 '), visto.slice()]);
  falso.abrirDesdeLista = function () { return false; };
  Check('R2d cambios sin guardar y "no": conservada, sin mensaje', { estado: 'conservada', mensaje: '' }, abrir(falso, 'PRE 2026-000199'));
  Check('R2e sin codigo: no_encontrada', 'no_encontrada', abrir(falso, '').estado);

  // ---- render ----
  var fila = { numero: 7, numero_texto: 'SOL-7', estado: 'APROBADA', codigo_iniciativa: 'PRE 2026-000199' };
  Check('R3a lista de Iniciativas con abridor: el Codigo es un boton data-ini-ref (sigue "Aprobada")', [true, true],
    [/Aprobada/.test(SN.htmlLista([fila], '', true)), /<button[^>]*data-ini-ref="PRE 2026-000199"[^>]*>PRE 2026-000199<\/button>/.test(SN.htmlLista([fila], '', true))]);
  Check('R3b sin abridor: texto como antes, sin boton', false, /data-ini-ref/.test(SN.htmlLista([fila], '')));
  Check('R3c detalle de la solicitud con abridor: la fila Iniciativa y "creada con el codigo" son botones', 2,
    (SN.htmlDetalle({ numero: 7, numero_texto: 'SOL-7', estado: 'APROBADA', codigo_iniciativa: 'PRE 2026-000199', fecha_revision_utc: null }, false, 'sn', true)
      .match(/data-ini-ref="PRE 2026-000199"/g) || []).length);
  Check('R3d Mis cambios con abridor: el Codigo es boton; sin el, texto', [true, false],
    [/data-ini-ref="PRB 2026-000002"/.test(SC.htmlListaMias([{ id: 3, folio: 'PRB 2026-000002', tipo: 'ESTADO', estado: 'APLICADA' }], '', true)),
     /data-ini-ref/.test(SC.htmlListaMias([{ id: 3, folio: 'PRB 2026-000002', tipo: 'ESTADO', estado: 'APLICADA' }], ''))]);
  Check('R3e Historial con abridor: Codigo de cambio y de iniciativa creada son botones; el folio de la peticion sigue abriendo la peticion', [2, 2],
    [(HP.htmlLista([{ tipo: 'CAMBIO', id: 3, folio: '#3', iniciativa_codigo: 'PRB 2026-000002' },
                   { tipo: 'INICIATIVA', id: 7, folio: 'SOL-7', iniciativa_titulo: 'X', iniciativa_codigo: 'PRE 2026-000199' }], true)
       .match(/data-ini-ref=/g) || []).length,
     (HP.htmlLista([{ tipo: 'CAMBIO', id: 3, folio: '#3', iniciativa_codigo: 'PRB 2026-000002' },
                   { tipo: 'INICIATIVA', id: 7, folio: 'SOL-7', iniciativa_titulo: 'X', iniciativa_codigo: 'PRE 2026-000199' }], true)
       .match(/data-hp-id=/g) || []).length]);

  // ---- clics en la pagina ----
  var abiertos = [], origenes = [], preguntas = [], respuesta = false, solicitudes = [], peticiones = [];
  reg.registro = { iniciativas: [], buscar: function (f) { return /^PR[BE] 2026-0000\d\d$/.test(f) || f === 'PRE 2026-000199' ? { folio: f } : null; } };
  reg.abrirDetalle = function (folio, origen) { abiertos.push(folio); origenes.push(origen); reg.abierta = folio; };
  reg.confirmar = function (m) { preguntas.push(m); return respuesta; };
  var paneles = function () { return ['panel-solicitudes', 'panel-iniciativas', 'panel-administracion'].map(function (id) { return doc.getElementById(id).hidden; }); };
  var ref = function (codigo, padre) { return Nodo({ 'data-ini-ref': codigo }, Nodo({}, padre || null)); };

  pg.nuevas.verDetalle = function (n) { solicitudes.push('N' + n); return Promise.resolve(); };
  pg.nuevas.cablear();
  pg.vista = 'solicitudes';
  var antes = paneles();
  doc.getElementById('snLista').disparar('click', { target: ref('PRE 2026-000199', Nodo({ 'data-sn-numero': '7' })) });
  Check('R4 Iniciativas: el Codigo de la aprobada abre ESA iniciativa sin cambiar de pestaña; la solicitud no se abre',
    ['solicitudes', ['PRE 2026-000199'], []], [pg.vista, abiertos.slice(), solicitudes.slice()]);
  Check('R4b el foco vuelve al boton del Codigo; no se muestran ni ocultan paneles',
    ['PRE 2026-000199', JSON.stringify(antes)], [origenes[0] && origenes[0].getAttribute('data-ini-ref'), JSON.stringify(paneles())]);

  doc.getElementById('snLista').disparar('click', { target: ref('PRE 2026-009999', Nodo({ 'data-sn-numero': '8' })) });
  Check('R5 Iniciativas: Codigo fuera del registro: aviso en snMsg, nada se abre, sigue en Solicitudes',
    [true, true, 1, [], 'solicitudes'],
    [/PRE 2026-009999/.test(doc.getElementById('snMsg').innerHTML), /aviso/.test(doc.getElementById('snMsg').className),
     abiertos.length, solicitudes.slice(), pg.vista]);

  doc.getElementById('snLista').disparar('click', { target: Nodo({ 'data-sn-numero': '8' }) });
  Check('R5b el numero de la solicitud sigue abriendo la solicitud', ['N8'], solicitudes.slice());

  reg.abierta = null;
  doc.getElementById('snDetalle').disparar('click', { target: ref('PRE 2026-000010') });
  Check('R6 detalle de la solicitud: su Codigo abre la iniciativa, sin cambiar de pestaña', ['PRE 2026-000010', 'solicitudes'],
    [abiertos[abiertos.length - 1], pg.vista]);
  doc.getElementById('snDetalle').disparar('click', { target: ref('PRE 2026-009999') });
  Check('R6b detalle: fuera del registro avisa en snDetMsg', true, /no tiene acceso/.test(doc.getElementById('snDetMsg').innerHTML));

  // Cambios sin guardar en la abierta: se pregunta y "no" la deja; sin aviso.
  reg.hayCambiosSinGuardar = function () { return true; };
  reg.edicion = { cambios: function () { return [1]; } };
  doc.getElementById('snMsg').innerHTML = '';
  doc.getElementById('snLista').disparar('click', { target: ref('PRE 2026-000011') });
  Check('R7 con cambios sin guardar y "no": se pregunta, la abierta no cambia y no hay aviso',
    [1, 'PRE 2026-000010', ''], [preguntas.length, reg.abierta, doc.getElementById('snMsg').innerHTML]);
  respuesta = true;
  doc.getElementById('snLista').disparar('click', { target: ref('PRE 2026-000011') });
  Check('R7b con "si, descartar": abre la nueva', 'PRE 2026-000011', reg.abierta);
  reg.hayCambiosSinGuardar = function () { return false; };

  // Mis solicitudes (quien no es ADM)
  pg.mias.verDetalle = function (n) { solicitudes.push('M' + n); return Promise.resolve(); };
  pg.mias.cablear();
  doc.getElementById('msLista').disparar('click', { target: ref('PRE 2026-000012', Nodo({ 'data-sn-numero': '9' })) });
  doc.getElementById('msLista').disparar('click', { target: ref('PRE 2026-009998', Nodo({ 'data-sn-numero': '9' })) });
  Check('R8 Mis solicitudes: abre sin cambiar de pestaña; fuera del registro avisa en msMsg; la solicitud no se abre',
    ['PRE 2026-000012', true, 'solicitudes', ['N8']],
    [abiertos[abiertos.length - 1], /PRE 2026-009998/.test(doc.getElementById('msMsg').innerHTML), pg.vista, solicitudes.slice()]);

  // Mis solicitudes de cambio
  pg.misCambios.verDetalle = function (n) { solicitudes.push('C' + n); return Promise.resolve(); };
  pg.misCambios.cablear();
  doc.getElementById('mcLista').disparar('click', { target: ref('PRB 2026-000013', Nodo({ 'data-mc-fila': '3' })) });
  doc.getElementById('mcLista').disparar('click', { target: ref('PRB 2026-009997', Nodo({ 'data-mc-fila': '3' })) });
  Check('R9 Mis cambios: abre sin cambiar de pestaña; fuera del registro avisa en mcMsg; la solicitud no se abre',
    ['PRB 2026-000013', true, 'solicitudes', ['N8']],
    [abiertos[abiertos.length - 1], /PRB 2026-009997/.test(doc.getElementById('mcMsg').innerHTML), pg.vista, solicitudes.slice()]);

  // Historial de peticiones (pestaña Administracion): se queda en Administracion.
  pg.historial.abrirDetalle = function (tipo, id) { peticiones.push(tipo + id); };
  pg.historial.cablear();
  pg.vista = 'administracion';
  doc.getElementById('hpLista').disparar('click', { target: ref('PRB 2026-000014', Nodo({ 'data-hp-tipo': 'CAMBIO', 'data-hp-id': '3' })) });
  Check('R10 Historial: abre la iniciativa SIN ir a Solicitudes ni a Iniciativas; la peticion no se abre',
    ['PRB 2026-000014', 'administracion', [], true], [abiertos[abiertos.length - 1], pg.vista, peticiones.slice(), doc.getElementById('hpMsg').hidden]);
  doc.getElementById('hpLista').disparar('click', { target: ref('PRB 2026-009996', Nodo({ 'data-hp-tipo': 'CAMBIO', 'data-hp-id': '3' })) });
  Check('R10b Historial: fuera del registro avisa en hpMsg', [false, true],
    [doc.getElementById('hpMsg').hidden, /PRB 2026-009996/.test(doc.getElementById('hpMsg').textContent)]);
  doc.getElementById('hpLista').disparar('click', { target: Nodo({ 'data-hp-tipo': 'CAMBIO', 'data-hp-id': '3' }) });
  Check('R10c Historial: el folio de la peticion sigue abriendo la peticion', ['CAMBIO3'], peticiones.slice());

  // Cola de cambios: sin registro cargado el Codigo sigue cayendo a la solicitud (como antes).
  reg.registro = null;
  Check('R11 cola de cambios sin registro cargado: alVerIniciativa false (la fila abre la solicitud)', false,
    pg.cola.alVerIniciativa('PRB 2026-000002', null));
  reg.registro = { iniciativas: [], buscar: function () { return null; } };
  Check('R11b cola de cambios fuera del registro: false', false, pg.cola.alVerIniciativa('PRB 2026-000002', null));
}).then(function () {
  console.log(fallos ? 'FALLOS: ' + fallos : 'OK: todo paso');
  process.exit(fallos ? 1 : 0);
}, function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
