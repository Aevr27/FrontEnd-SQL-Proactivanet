// tools/tests/SolicitudesCambioImpactoSmoke.js - "Impacto por categoria" del
// detalle de Cambios (admin/solicitudes-cambio.js): volumetria de hoy (SLOT 0,
// la VolumetriaCliente REAL de admin/iniciativa-admin.js con un `pedir`
// falso), Tickets a reducir estimados con el ticketsDe REAL de
// admin/iniciativas.js (FLOOR) y las otras iniciativas activas de cada
// categoria (otras_iniciativas del servidor) con su % y lo comprometido.
//
//   I1 sin volumetria todavia: "Calculando…" y tickets "—"; rotulos de estimado
//   I2 al llegar: solo cambian las dos celdas de cada fila (el comentario no)
//   I3 tickets = ticketsDe(volumetria, % pedido); volumetria 0 -> 0; error -> —
//   I4 otras iniciativas: folio, %, estado, suma y suma con lo pedido
//   I5 lista vacia / null (no se pudo leer) / sin el campo (servidor anterior)
//   I6 un detalle que ya no es el abierto no se pinta
//   I7 sin admin/iniciativa-admin.js: — sin romper el detalle
//
//   node tools\tests\SolicitudesCambioImpactoSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var raiz = path.join(__dirname, '..', '..');
function leer(r) { return fs.readFileSync(path.join(raiz, r), 'utf8'); }
var fallos = 0;
function Check(titulo, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e !== o) fallos++;
  console.log((e === o ? 'PASS  ' : 'FAIL  ') + titulo + (e === o ? '' : '  esperado=' + e + '  obtenido=' + o));
}
function tic() { return new Promise(function (r) { setImmediate(r); }); }
async function tics(n) { for (var i = 0; i < (n || 6); i++) await tic(); }

function Elemento(id) {
  return { id: id, hidden: false, innerHTML: '', className: '', value: '', escuchas: {}, hijos: [],
    addEventListener: function (t, f) { this.escuchas[t] = f; }, setAttribute: function () {}, getAttribute: function () { return null; },
    querySelectorAll: function () { return []; }, querySelector: function () { return null; }, appendChild: function (x) { return x; } };
}
function Documento() {
  var els = {};
  return { els: els, getElementById: function (id) { if (!els[id]) els[id] = Elemento(id); return els[id]; },
    createElement: function () { return Elemento(''); }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}, body: Elemento('body'), documentElement: { clientWidth: 1200 } };
}
function Respuesta(status, json) { return Promise.resolve({ ok: status === 200, status: status, json: function () { return Promise.resolve(json); } }); }

// ticketsDe REAL de admin/iniciativas.js (VALIDAR + ticketsDe por llaves).
function Extraer(src, inicio) {
  var i = src.indexOf(inicio), j = src.indexOf('{', i), n = 0;
  if (i < 0) throw new Error('falta ' + inicio);
  for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}' && --n === 0) break; }
  return src.slice(i, j + 1) + (src[j + 1] === ';' ? ';' : '');
}
var fuenteIni = leer('admin/iniciativas.js');
var ticketsDe = (new Function(Extraer(fuenteIni, 'var VALIDAR = {') + '\n' + Extraer(fuenteIni, 'function ticketsDe(') + '\nreturn ticketsDe;'))();

function Caja(conAdmin) {
  var caja = { Promise: Promise, FormData: FormData, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
               Date: Date, isNaN: isNaN, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
  caja.window = caja; caja.globalThis = caja;
  vm.runInNewContext(leer('assets/js/escape.js'), caja);
  if (conAdmin) {
    (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', leer('admin/iniciativa-admin.js')))(
      caja, Documento(), { valores: function () { return []; } }, caja.Escape, { texto: function () { return ''; } });
  }
  caja.Iniciativas = { ticketsDe: ticketsDe };
  vm.runInNewContext(leer('admin/solicitudes-cambio.js'), caja);
  return caja;
}

var VOL = { '/A/Cat 1': { estado: 'ok', volumetria: 418 }, '/A/Cat 2': { estado: 'cero', volumetria: 0 }, '/B/Cat 4': 'error' };
function Detalle(o) {
  var d = { id: 7, folio: 'PRB 2026-000001', titulo: 'T', tipo: 'CATEGORIAS', estado: 'PENDIENTE', solicitado_por: 'x', rol_solicitante: 'MOD',
    fecha_solicitud_utc: '2026-10-28T15:00:00Z', motivo: 'm', actual: {}, eventos: [],
    categorias_detalle: [
      { categoria: '/A/Cat 1', accion: 'PCT', pct_anterior: '20', pct_nuevo: '25', pct_actual: '20', ligada: true,
        otras_iniciativas: [{ folio: 'PRB 2026-000009', pct: 0.3, estado: 'En Análisis' }, { folio: 'ADO <b>3</b>', pct: 0.1234, estado: 'En Solución' }] },
      { categoria: '/A/Cat 2', accion: 'AGREGAR', pct_anterior: null, pct_nuevo: '10', tipo_iniciativa: 'Problem', tipo_agrupado: 'Problem',
        otras_iniciativas: [] },
      { categoria: '/B/Cat 4', accion: 'AGREGAR', pct_anterior: null, pct_nuevo: '5', tipo_iniciativa: 'Problem', tipo_agrupado: 'Problem',
        otras_iniciativas: null }] };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}

(async function () {
  var caja = Caja(true), C = caja.SolicitudesCambioCola;
  var pedidos = [];
  function pedir(url) {
    pedidos.push(url);
    if (/accion=detalle/.test(url)) return Respuesta(200, Detalle());
    if (/volumetria/.test(url)) {
      var ruta = decodeURIComponent((/ruta=([^&]*)/.exec(url) || [])[1] || '');
      var v = VOL[ruta];
      if (v === 'error') return Respuesta(503, { error: 'x' });
      return Respuesta(200, { slot: 0, rutas: [{ ruta: ruta, llave: ruta, estado: v.estado, volumetria: v.volumetria }] });
    }
    return Respuesta(404, {});
  }
  var html = C.htmlDetalle(Detalle(), {}, {});
  Check('I1 sin volumetria: "Calculando…" y tickets —; rotulos de estimado y de la ventana', [true, true, true, true, true],
    [/id="solVol-0">Calculando…/.test(html), /id="solTk-0">—/.test(html), /Impacto por categoría <span class="ini-sub">estimado con la volumetría de hoy/.test(html),
     /hoy, últimos 30 días/.test(html), /al aplicar, la base recalcula Tickets a reducir/.test(html)]);

  var doc = Documento();
  var cola = new C.ColaSolicitudes(doc, pedir);
  cola.fijarRol('ADM'); cola.cablear();
  await cola.verDetalle(7); await tics();
  var volUrls = pedidos.filter(function (u) { return /volumetria/.test(u); });
  Check('I2 pide la volumetria SLOT 0 de cada categoria (sin alcance=total)', [3, false],
    [volUrls.length, volUrls.some(function (u) { return /alcance=total/.test(u); })]);
  Check('I3 418 x 25% = 104 (FLOOR); volumetria 0 -> 0; error -> —', ['418', '104', '0', '0', '—', '—'],
    [doc.els['solVol-0'].innerHTML, doc.els['solTk-0'].innerHTML, doc.els['solVol-1'].innerHTML, doc.els['solTk-1'].innerHTML,
     doc.els['solVol-2'].innerHTML, doc.els['solTk-2'].innerHTML]);
  Check('I3 la cuenta es la de ticketsDe (no una propia)', ticketsDe(418, '25') + '', doc.els['solTk-0'].innerHTML);
  var det = doc.els.solDetalle.innerHTML;
  Check('I4 otras iniciativas: folio (escapado), %, estado', [true, true, false],
    [/<td>PRB 2026-000009<\/td><td class="num">30%<\/td><td>En Análisis<\/td>/.test(det),
     /<td>ADO &lt;b&gt;3&lt;\/b&gt;<\/td><td class="num">12.34%<\/td><td>En Solución<\/td>/.test(det), /<b>3<\/b>/.test(det)]);
  Check('I4 comprometido por otras y con el % pedido', [true, true],
    [/Ya comprometido por otras: 42.34% · con el % pedido aquí: 67.34%/.test(det), /Ya comprometido por otras: 0% · con el % pedido aquí: 10%/.test(det)]);
  Check('I5 lista vacia y null', [true, true],
    [/Ninguna otra iniciativa activa tiene % en esta categoría/.test(det), /No se pudieron leer las otras iniciativas de \/B\/Cat 4/.test(det)]);
  var viejo = Detalle(); viejo.categorias_detalle.forEach(function (c) { delete c.otras_iniciativas; });
  Check('I5 servidor anterior (sin el campo): sin la seccion de otras', false, /Otras iniciativas activas/.test(C.htmlDetalle(viejo, {}, {})));

  // I2: llegar la volumetria no repinta el detalle (un comentario a medio escribir se queda).
  var doc2 = Documento(), lento = [];
  var cola2 = new C.ColaSolicitudes(doc2, function (url) {
    if (/accion=detalle/.test(url)) return Respuesta(200, Detalle());
    return new Promise(function (res) { lento.push(function () { res(pedir(url)); }); }).then(function (r) { return r; });
  });
  cola2.fijarRol('ADM'); cola2.cablear();
  await cola2.verDetalle(7); await tics();
  var antes = doc2.els.solDetalle.innerHTML;
  lento.forEach(function (f) { f(); }); await tics();
  Check('I2 al llegar solo cambian sus celdas: el detalle (con el comentario) no se repinta', [antes, '418'],
    [doc2.els.solDetalle.innerHTML, doc2.els['solVol-0'].innerHTML]);

  // I6: otro detalle abierto antes de que llegue la volumetria.
  var doc3 = Documento(), lento3 = [];
  var cola3 = new C.ColaSolicitudes(doc3, function (url) {
    if (/accion=detalle/.test(url)) return Respuesta(200, Detalle());
    return new Promise(function (res) { lento3.push(function () { res(pedir(url)); }); });
  });
  cola3.fijarRol('ADM'); cola3.cablear();
  await cola3.verDetalle(7); await tics();
  var celda = doc3.getElementById('solVol-0').innerHTML;
  cola3.detalle = { id: 8 };
  lento3.forEach(function (f) { f(); }); await tics();
  Check('I6 un detalle que ya no es el abierto no se pinta', celda, doc3.getElementById('solVol-0').innerHTML);

  // I7: sin iniciativa-admin.js.
  var sin = Caja(false), doc4 = Documento();
  var cola4 = new sin.SolicitudesCambioCola.ColaSolicitudes(doc4, pedir);
  cola4.fijarRol('ADM'); cola4.cablear();
  await cola4.verDetalle(7); await tics();
  Check('I7 sin VolumetriaCliente: — en volumetria y tickets, el detalle sigue', ['—', '—', true],
    [doc4.els['solVol-0'].innerHTML, doc4.els['solTk-0'].innerHTML, /Solicitud #7/.test(doc4.els.solDetalle.innerHTML)]);

  console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
