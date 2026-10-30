/* =========================================================================
   tools/tests/SolicitudesCambioIniciativaSmoke.js

   Con la pagina real (admin/iniciativas.js + admin/registro-iniciativas.js +
   admin/solicitudes-cambio.js), sin navegador ni servidor: el Codigo de la
   cola Solicitudes > Cambios abre el detalle de Iniciativas con
   abrirDesdeLista (el MISMO que Cambios recientes), y su pregunta por los
   cambios sin guardar sigue mandando: si no se descartan, el detalle abierto
   no se cambia.

   Correr: node tools/tests/SolicitudesCambioIniciativaSmoke.js
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
(new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
  w, doc, w.Catalogos, w.Escape, w.GloboAyuda, pedir);

esperar().then(function () {
  var pg = w.IniciativasPagina, reg = pg.registro, cola = pg.cola;
  pg.fijarRol('ADM');
  Check('P1 la pagina le da a la cola quien abre la iniciativa', 'function', typeof cola.alVerIniciativa);

  // El registro real: abrirDesdeLista y soltarCambios tal cual; solo se
  // sustituye abrir el panel y la pregunta al usuario.
  var abiertos = [], preguntas = [], respuesta = false, solicitudes = [];
  reg.registro = { iniciativas: [], buscar: function (f) { return f === 'PRB 2026-000099' ? null : { folio: f }; } };
  reg.abrirDetalle = function (folio) { abiertos.push(folio); reg.abierta = folio; };
  reg.confirmar = function (m) { preguntas.push(m); return respuesta; };
  cola.verDetalle = function (id) { solicitudes.push(id); return Promise.resolve(); };
  cola.cablear();
  var clic = function (n) { doc.getElementById('solLista').disparar('click', { target: n }); };
  var codigo = function (folio, id) { return Nodo({ 'data-sol-folio': folio }, Nodo({}, Nodo({ 'data-sol-id': id }))); };

  pg.vista = 'solicitudes';
  clic(codigo('PRB 2026-000002', '42'));
  Check('P2 Codigo sin nada abierto: pasa a Iniciativas y abre ESE detalle; la solicitud no se abre',
    ['iniciativas', ['PRB 2026-000002'], [], []], [pg.vista, abiertos.slice(), preguntas.slice(), solicitudes.slice()]);

  // Detalle con cambios sin guardar: se pregunta; "no" deja el abierto.
  reg.hayCambiosSinGuardar = function () { return true; };
  reg.edicion = { cambios: function () { return [1, 2]; } };
  pg.vista = 'solicitudes';
  clic(codigo('PRB 2026-000003', '43'));
  Check('P3 con cambios sin guardar y "no": se pregunta y el detalle abierto NO cambia',
    [1, true, ['PRB 2026-000002'], 'PRB 2026-000002'],
    [preguntas.length, /2 cambios sin guardar en PRB 2026-000002/.test(preguntas[0] || ''), abiertos.slice(), reg.abierta]);
  respuesta = true;
  clic(codigo('PRB 2026-000003', '43'));
  Check('P4 con "si, descartar": abre la iniciativa del Codigo', [2, ['PRB 2026-000002', 'PRB 2026-000003']],
    [preguntas.length, abiertos.slice()]);

  pg.vista = 'solicitudes';
  clic(Nodo({ 'data-sol-id': '43' }, Nodo({}, Nodo({ 'data-sol-id': '43' }))));
  Check('P5 el "#" sigue abriendo la solicitud, sin tocar Iniciativas', ['solicitudes', [43], 2],
    [pg.vista, solicitudes.slice(), abiertos.length]);

  clic(codigo('PRB 2026-000099', '44'));
  Check('P6 Codigo fuera del registro cargado: no cambia de pestaña; abre la solicitud, como antes',
    ['solicitudes', [43, 44], 2, 2], [pg.vista, solicitudes.slice(), abiertos.length, preguntas.length]);
}).then(function () {
  console.log(fallos ? 'FALLOS: ' + fallos : 'OK: todo paso');
  process.exit(fallos ? 1 : 0);
}, function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
