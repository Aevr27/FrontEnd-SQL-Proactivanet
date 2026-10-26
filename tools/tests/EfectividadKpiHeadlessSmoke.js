// tools/tests/EfectividadKpiHeadlessSmoke.js - las tarjetas KPI de
// Efectividad que abren su hoja (efectividad/efectividad.js, HOJA_KPI), en
// un Chrome de verdad (tools/tests/BancoHeadless.js; no escribe en disco).
//
// Datos de mentira: 6 medidas (2 con rebote: M1 PRB y M2 REQ), 2 en
// medicion y 2 que no se califican.
//
//   E1-E10  clic, Rebote filtra Medidas (y convive con la busqueda), la
//           misma quita, otra reemplaza, la pestaña a mano quita, filtro
//           de tipo con la marca puesta;
//   L1-L3   "Limpiar" con una tarjeta elegida: sin marca ni aria-pressed,
//           todas las medidas, busqueda y tipo vacios (Limpiar ya los
//           borraba), la hoja abierta se queda; tambien despues de cambiar
//           a mano la pestaña y el tipo.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\EfectividadKpiHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
// Sin Chrome instalado dice SKIP y sale 0. Otra ruta: CHROME=<ruta>.
'use strict';
var Banco = require('./BancoHeadless');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}
if (!Banco.CHROME) { console.log('SKIP  sin Chrome/Edge (CHROME=<ruta> para indicar otro)'); process.exit(0); }

var filas = [];
function fila(folio, orden, prefijo, extra) {
  var r = { folio: folio, orden: orden, prefijo: prefijo, titulo: 'Titulo ' + folio, categoria: '/A/' + folio, c1: '/A',
            c1c2: '/A/' + folio, comp: 10, logro: 5, asignada: 0, evitados: 1, reduccion_hoy: 1, evalua_rebote: false, estado: 'Cerrado' };
  Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
  filas.push(r);
}
fila('M1', 15, 'PRB', { evalua_rebote: true, asignada: 2, reduccion_hoy: 0 });
fila('M2', 15, 'REQ', { evalua_rebote: true, asignada: 2, reduccion_hoy: -1 });
fila('M3', 15, 'REQ', { evalua_rebote: true, asignada: 2, reduccion_hoy: 3 });
fila('M4', 15, 'REQ', { logro: 10 }); fila('M5', 15, 'REQ', { logro: 0 }); fila('M6', 15, 'PRB');
fila('E1', 14, 'REQ', { se_mide_desde: '2026-11-01' }); fila('E2', 14, 'PRB', { se_mide_desde: '2026-12-01' });
fila('N1', 3, 'REQ', { motivo: 'Sin fecha' }); fila('N2', 3, 'PRB', { motivo: 'Sin fecha' });
var DATOS = { hay_calculo: true, filas: filas, categorias: [], corrida: { fecha_calculo: '2026-10-22' } };

// La pagina suelta no carga escape.js (embebida lo trae el tablero).
var ANTES = '<script src="../assets/js/escape.js"></script>\n<script>\n' +
  'window.fetch = function () { var j = ' + JSON.stringify(DATOS) + ';\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200,\n' +
  '    json: function () { return Promise.resolve(JSON.parse(JSON.stringify(j))); } }); }, 30); }); };\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  '</script>\n';

function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 3000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  var K = '#ef-kpis';
  function boton(k) { return document.querySelector(K + ' [data-indicador="' + k + '"]'); }
  function val(k) { return boton(k).parentNode.querySelector('.val').textContent; }
  function todos() { return Array.prototype.map.call(document.querySelectorAll(K + ' [data-indicador]'), function (b) { return b.getAttribute('data-indicador') + ':' + b.getAttribute('aria-pressed'); }); }
  function marcadas() { return todos().filter(function (x) { return /true$/.test(x); }); }
  function conSel() { return Array.prototype.map.call(document.querySelectorAll(K + ' .kpi-sel [data-indicador]'), function (b) { return b.getAttribute('data-indicador'); }); }
  function foco() { var a = document.activeElement; return a && a.getAttribute ? a.getAttribute('data-indicador') : null; }
  function hoja() { return Array.prototype.filter.call(document.querySelectorAll('#ef-pestanas [data-hoja]'), function (b) { return b.getAttribute('aria-selected') === 'true'; }).map(function (b) { return b.getAttribute('data-hoja'); })[0]; }
  function visibles() { return ['medidas', 'medicion', 'sin'].filter(function (h) { return !document.getElementById('ef-h-' + h).hidden; }); }
  function folios() { return Array.prototype.map.call(document.querySelectorAll('#ef-t-medidas tbody tr.abre'), function (tr) { return tr.getAttribute('data-folio'); }).sort(); }
  function tab(h) { document.querySelector('#ef-pestanas [data-hoja="' + h + '"]').click(); }
  var bus = function () { return document.getElementById('ef-buscar'); };
  var tipo = function () { return document.getElementById('ef-tipo'); };
  function buscar(v) { bus().value = v; bus().dispatchEvent(new Event('input')); }
  function elegirTipo(v) { tipo().value = v; tipo().dispatchEvent(new Event('change')); }
  function limpiar() { document.getElementById('ef-limpiar').click(); }
  (async function () {
    try {
      await hasta(function () { return boton('rebote'); });
      apunta('E1', [todos(), document.querySelectorAll(K + ' .kpi').length, hoja(), folios().length, val('medidas')]);
      boton('rebote').click(); await espera(30);
      apunta('E2', [hoja(), visibles(), folios(), val('rebote'), marcadas(), conSel(), foco()]);
      buscar('M1'); await espera(30);
      apunta('E3', [folios(), marcadas()]);
      buscar('M3'); await espera(30);
      var vacia = document.querySelector('#ef-t-medidas tbody tr.vacia');
      apunta('E3b', vacia && vacia.textContent);
      buscar(''); await espera(30);
      boton('rebote').click(); await espera(30);
      apunta('E4', [hoja(), folios().length, marcadas(), foco()]);
      boton('medicion').click(); await espera(30);
      apunta('E5', [hoja(), visibles(), marcadas()]);
      boton('sin').click(); await espera(30);
      apunta('E6', [hoja(), marcadas()]);
      boton('sin').click(); await espera(30);
      apunta('E7', [hoja(), marcadas()]);
      boton('rebote').click(); await espera(30);
      tab('medicion'); await espera(30);
      apunta('E8', [hoja(), marcadas()]);
      tab('medidas'); await espera(30);
      apunta('E8b', folios().length);
      boton('rebote').click(); await espera(30);
      elegirTipo('REQ'); await espera(30);
      apunta('E9', [marcadas(), val('rebote'), folios()]);
      // L1: Rebote + busqueda + tipo, Limpiar.
      buscar('M'); await espera(30);
      limpiar(); await espera(30);
      apunta('L1', [marcadas(), conSel(), todos(), folios(), val('rebote'), val('medidas'), bus().value, tipo().value, hoja()]);
      // L2: En medicion elegida (hoja medicion), Limpiar: la hoja se queda.
      boton('medicion').click(); await espera(30);
      limpiar(); await espera(30);
      apunta('L2', [marcadas(), hoja(), visibles()]);
      // L3: Rebote, luego a mano otra pestaña y el tipo, otra tarjeta, Limpiar.
      tab('medidas'); await espera(30);
      boton('rebote').click(); await espera(30);
      tab('sin'); await espera(30);
      elegirTipo('PRB'); await espera(30);
      boton('sin').click(); await espera(30);
      apunta('L3a', [marcadas(), hoja(), val('sin')]);
      limpiar(); await espera(30);
      tab('medidas'); await espera(30);
      apunta('L3', [marcadas(), conSel(), hoja(), folios().length, tipo().value, val('sin')]);
      // L4: Limpiar sin tarjeta elegida, con busqueda y tipo: lo de siempre.
      buscar('M1'); elegirTipo('PRB'); await espera(30);
      limpiar(); await espera(30);
      apunta('L4', [marcadas(), folios(), bus().value, tipo().value, val('medidas')]);
      // L5: despues de Limpiar el clic sigue funcionando.
      boton('rebote').click(); await espera(30);
      apunta('L5', [marcadas(), folios(), foco()]);
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('efectividad/efectividad.html', '../assets/js/seleccion-kpi.js', ANTES, sonda);
Banco.correr({ '/efectividad/__banco.html': BANCO }, ['/efectividad/__banco.html']).then(function (res) {
  if (!res[0]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda'); process.exit(1); }
  Check('S0 sin errores de JS en la pagina', [], res[0].errores);
  var o = Banco.mapa(res[0]), NADA = [], TODAS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  var SIN = ['medidas:false', 'rebote:false', 'medicion:false', 'sin:false'];
  Check('E1 cuatro tarjetas filtran (de seis); arranca en Medidas con las seis', [SIN, 6, 'medidas', 6, '6'], o.E1);
  Check('E2 Rebote: hoja Medidas, solo las con rebote (= cifra), marca, foco',
    ['medidas', ['medidas'], ['M1', 'M2'], '2', ['rebote:true'], ['rebote'], 'rebote'], o.E2);
  Check('E3 busqueda y Rebote conviven', [['M1'], ['rebote:true']], o.E3);
  Check('E3b sin coincidencia con Rebote: su aviso', 'Ninguna con rebote coincide con la búsqueda.', o.E3b);
  Check('E4 la misma otra vez la quita: todas las medidas; foco en ella', ['medidas', 6, NADA, 'rebote'], o.E4);
  Check('E5 En medicion abre su hoja', ['medicion', ['medicion'], ['medicion:true']], o.E5);
  Check('E6 otra reemplaza', ['sin', ['sin:true']], o.E6);
  Check('E7 la misma quita; la hoja se queda', ['sin', NADA], o.E7);
  Check('E8 la pestaña a mano quita la marca', ['medicion', NADA], o.E8);
  Check('E8b de vuelta en Medidas: todas (sin el solo-rebote)', 6, o.E8b);
  Check('E9 filtro tipo: la marca sigue, cifra y filas de REQ', [['rebote:true'], '1', ['M2']], o.E9);
  Check('L1 Limpiar con Rebote + busqueda + tipo: sin marca ni aria-pressed, las seis, busqueda y tipo vacios, hoja Medidas',
    [NADA, NADA, SIN, TODAS, '2', '6', '', '', 'medidas'], o.L1);
  Check('L2 Limpiar con En medicion elegida: sin marca; la hoja abierta se queda', [NADA, 'medicion', ['medicion']], o.L2);
  Check('L3a antes: pestaña y tipo cambiados a mano, luego No se puede calificar', [['sin:true'], 'sin', '1'], o.L3a);
  Check('L3 Limpiar: sin marca, todas las medidas, tipo vacio, cifra sin el tipo', [NADA, NADA, 'medidas', 6, '', '2'], o.L3);
  Check('L4 Limpiar sin tarjeta: busqueda y tipo vacios, todas, como siempre', [NADA, TODAS, '', '', '6'], o.L4);
  Check('L5 despues de Limpiar el clic vuelve a filtrar', [['rebote:true'], ['M1', 'M2'], 'rebote'], o.L5);
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
