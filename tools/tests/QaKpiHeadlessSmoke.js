// tools/tests/QaKpiHeadlessSmoke.js - la tarjeta "Tickets incorrectos" de QA
// (qa/qa.js, KPI_INCORRECTOS) en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco).
//
// QA no tiene boton "Limpiar": sus reinicios son la × de cada etiqueta del
// detalle y "Ver detalle de incorrectos" (vuelve al filtro por omision:
// solo Incorrecto, sin grupo ni tecnico). Se prueban esos, con la tarjeta
// sincronizada: el estado es estado.filtros.validacion, no uno aparte.
//
//   Q1-Q3  clic: el detalle pide Validacion = Incorrecto y conserva el
//          Grupo puesto desde la grafica; otro clic lo quita (todos los
//          estados) y el Grupo sigue; la marca y aria-pressed lo siguen;
//   R1-R4  la dona a mano (OK) quita la marca; la × de Validacion la quita;
//          "Ver detalle de incorrectos" la pone y quita el Grupo; la × de
//          Grupo no toca la tarjeta; la pagina vuelve a 1 en cada cambio.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\QaKpiHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
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

var RESUMEN = { summary: { totalTickets: 100, incorrectos: 12, incorrectosPct: 12 }, source: {}, dataInfo: {},
  porGrupo: [{ grupo: 'G1', tickets: 8 }, { grupo: 'G2', tickets: 4 }], porTecnico: [], recategorizacion: [],
  validacion: [{ validacion: 'Incorrecto', tickets: 12 }, { validacion: 'OK', tickets: 88 }] };
// El detalle de mentira responde a lo pedido: una fila por estado y grupo
// que pasa el filtro (Incorrecto/OK x G1/G2).
var ANTES = '<script>\n' +
  'window.__detalle = [];\n' +
  'window.fetch = function (u) { u = new URL(String(u), location.href); var q = u.searchParams, j;\n' +
  '  if (q.get("action") === "detail") {\n' +
  '    __detalle.push({ validacion: q.get("validacion"), grupo: q.get("grupo"), page: q.get("page") });\n' +
  '    var rows = [];\n' +
  '    ["Incorrecto", "OK"].forEach(function (v) { ["G1", "G2"].forEach(function (g) {\n' +
  '      if ((!q.get("validacion") || q.get("validacion") === v) && (!q.get("grupo") || q.get("grupo") === g))\n' +
  '        rows.push({ "Código": v + "-" + g, Validacion: v, Grupo: g }); }); });\n' +
  '    j = { rows: rows, total: rows.length, page: 1 };\n' +
  '  } else j = ' + JSON.stringify(RESUMEN) + ';\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200,\n' +
  '    text: function () { return Promise.resolve(JSON.stringify(j)); } }); }, 20); }); };\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  '</script>\n';

function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 3000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  var K = '#qa-kpis';
  function boton() { return document.querySelector(K + ' [data-indicador="incorrectos"]'); }
  function pulsada() { return boton() && boton().getAttribute('aria-pressed'); }
  function conSel() { return document.querySelectorAll(K + ' .kpi-sel').length; }
  function foco() { var a = document.activeElement; return a && a.getAttribute ? a.getAttribute('data-indicador') : null; }
  function ultimo() { var d = window.__detalle[window.__detalle.length - 1]; return d ? [d.validacion, d.grupo, d.page] : null; }
  function filas() {
    return Array.prototype.map.call(document.querySelectorAll('#qa-tbody-detalle tr'), function (tr) {
      return tr.querySelector('td').textContent; }).sort();
  }
  function quitar(k) { document.querySelector('#qa-filtros-activos button[data-quitar="' + k + '"]').click(); }
  function barra(id, i) { var g = Chart.getChart(id); g.options.onClick({}, [{ index: i }], g); }
  async function listo(n) { await hasta(function () { return window.__detalle.length >= n; }); await espera(60); }
  (async function () {
    try {
      await hasta(function () { return boton(); });
      apunta('Q0', [pulsada(), conSel(), document.querySelectorAll(K + ' .kpi-filtro').length]);
      // Grupo desde la grafica: abre el detalle (Incorrecto + G1) y la tarjeta ya refleja Incorrecto.
      barra('qa-chart-grupo', 0); await listo(1);
      apunta('Q1a', [ultimo(), pulsada(), filas()]);
      boton().click(); await listo(2);
      apunta('Q1', [ultimo(), pulsada(), conSel(), foco(), filas()]);
      boton().click(); await listo(3);
      apunta('Q2', [ultimo(), pulsada(), conSel(), foco(), filas()]);
      // La dona a mano: OK.
      boton().click(); await listo(4);
      barra('qa-chart-validacion', 1); await listo(5);
      apunta('R1', [ultimo(), pulsada(), conSel(), filas()]);
      // La x de Validacion.
      boton().click(); await listo(6);
      quitar('validacion'); await listo(7);
      apunta('R2', [ultimo(), pulsada(), conSel(), filas()]);
      // "Ver detalle de incorrectos": el filtro por omision (sin Grupo).
      document.getElementById('qa-btn-detalle').click(); await listo(8);
      apunta('R3', [ultimo(), pulsada(), conSel(), filas()]);
      // La x de Grupo no toca la tarjeta.
      barra('qa-chart-grupo', 1); await listo(9);
      quitar('grupo'); await listo(10);
      apunta('R4', [ultimo(), pulsada(), filas()]);
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('qa/qa.html', 'qa.js', ANTES, sonda);
Banco.correr({ '/qa/__banco.html': BANCO }, ['/qa/__banco.html']).then(function (res) {
  if (!res[0]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda'); process.exit(1); }
  Check('S0 sin errores de JS en la pagina', [], res[0].errores);
  var o = Banco.mapa(res[0]);
  var INC = ['Incorrecto-G1', 'Incorrecto-G2'];
  Check('Q0 una tarjeta filtra, sin elegir', ['false', 0, 1], o.Q0);
  Check('Q1a la barra de Grupo abre el detalle Incorrecto + G1 y la tarjeta lo refleja', [['Incorrecto', 'G1', '1'], 'true', ['Incorrecto-G1']], o.Q1a);
  Check('Q1 clic en la marcada la quita: todos los estados, el Grupo sigue', [[null, 'G1', '1'], 'false', 0, 'incorrectos', ['Incorrecto-G1', 'OK-G1']], o.Q1);
  Check('Q2 otro clic la pone: Incorrecto, el Grupo sigue', [['Incorrecto', 'G1', '1'], 'true', 1, 'incorrectos', ['Incorrecto-G1']], o.Q2);
  Check('R1 la dona a mano (OK): sin marca, detalle de OK', [['OK', 'G1', '1'], 'false', 0, ['OK-G1']], o.R1);
  Check('R2 la × de Validacion: sin marca, todos los estados', [[null, 'G1', '1'], 'false', 0, ['Incorrecto-G1', 'OK-G1']], o.R2);
  Check('R3 Ver detalle de incorrectos: filtro por omision (sin Grupo), marcada', [['Incorrecto', null, '1'], 'true', 1, INC], o.R3);
  Check('R4 la × de Grupo no toca la tarjeta', [['Incorrecto', null, '1'], 'true', INC], o.R4);
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
