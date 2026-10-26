// tools/tests/BacklogKpiHeadlessSmoke.js - la tarjeta "Criticos" de Backlog
// (backlog/backlog.js, KPI_CRITICOS) y "Limpiar", en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco).
//
// Datos: los de assets/js/mock-data.js, encendidos SOLO en la copia en
// memoria de backlog/backlog.html (window.MockData.MOCK_DATA = true); el
// archivo del repo sigue en false.
//
//   C1-C3  clic en Criticos: la tabla de antiguos queda solo con Critica, la
//          barra marcada, las cifras no se mueven; otro clic lo quita; la
//          barra Alta a mano mueve la marca;
//   L1-L4  "Limpiar" con Criticos elegida, tras cambiar a mano la barra de
//          prioridad, y sin nada elegido: filtro de prioridad fuera, tabla
//          de antiguos completa, sin marca ni aria-pressed; la fecha de
//          corte se conserva y la ventana vuelve a 30 dias (lo de siempre).
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\BacklogKpiHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
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

var ANTES = '<script>window.MockData.MOCK_DATA = true; Element.prototype.scrollIntoView = function () {};</script>\n';

function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 4000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  var K = '#kpis-bl';
  function boton() { return document.querySelector(K + ' [data-indicador="criticos"]'); }
  function pulsada() { return boton() && boton().getAttribute('aria-pressed'); }
  function conSel() { return document.querySelectorAll(K + ' .kpi-sel').length; }
  function val(rotulo) {
    var t = Array.prototype.filter.call(document.querySelectorAll(K + ' .kpi'), function (x) { return x.querySelector('.lbl').textContent === rotulo; })[0];
    return t ? t.querySelector('.val').textContent : null;
  }
  function foco() { var a = document.activeElement; return a && a.getAttribute ? a.getAttribute('data-indicador') : null; }
  function prioridades() {
    var s = {};
    Array.prototype.forEach.call(document.querySelectorAll('#tabla-antiguos-bl tbody tr'), function (tr) {
      var td = tr.querySelectorAll('td')[3]; if (td) s[td.textContent] = (s[td.textContent] || 0) + 1;
    });
    return s;
  }
  function filas() { return document.querySelectorAll('#tabla-antiguos-bl tbody tr').length; }
  // La barra de "Por prioridad" a mano: el onClick de la grafica con la
  // barra `i` bajo el cursor (Chart.js no atiende clics sinteticos).
  function barraPrioridad(i) {
    var g = Chart.getChart('chart-prioridad-bl');
    g.getElementsAtEventForMode = function () { return [{ index: i }]; };
    g.options.onClick({}, [], g);
  }
  function limpiar() { document.getElementById('btn-limpiar-bl').click(); }
  (async function () {
    try {
      await hasta(function () { return boton() && filas() > 0; });
      var n0 = filas(), p0 = prioridades(), v0 = [val('Backlog'), val('Criticos')];
      var corte = document.getElementById('f-corte-bl').value;
      apunta('C0', [pulsada(), conSel(), n0 > 0, Object.keys(p0).length > 1, document.querySelectorAll(K + ' .kpi-filtro').length]);
      boton().click(); await espera(60);
      apunta('C1', [pulsada(), conSel(), foco(), Object.keys(prioridades()), [val('Backlog'), val('Criticos')].join('|') === v0.join('|')]);
      boton().click(); await espera(60);
      apunta('C2', [pulsada(), conSel(), filas() === n0, JSON.stringify(prioridades()) === JSON.stringify(p0)]);
      boton().click(); await espera(60);
      barraPrioridad(1); await espera(60);
      apunta('C3', [pulsada(), conSel(), Object.keys(prioridades())]);
      barraPrioridad(1); await espera(60);
      // L1: Criticos + otra ventana de dias; Limpiar.
      boton().click(); await espera(60);
      var dias = document.getElementById('f-dias-bl'); dias.value = dias.options[dias.options.length - 1].value;
      limpiar();
      await hasta(function () { return pulsada() === 'false' && filas() === n0; }); await espera(60);
      apunta('L1', [pulsada(), conSel(), filas() === n0, JSON.stringify(prioridades()) === JSON.stringify(p0),
                    document.getElementById('f-corte-bl').value === corte, dias.value, [val('Backlog'), val('Criticos')].join('|') === v0.join('|')]);
      // L2: Criticos, luego a mano la barra Alta; Limpiar.
      boton().click(); await espera(60);
      barraPrioridad(1); await espera(60);
      apunta('L2a', [pulsada(), Object.keys(prioridades())]);
      limpiar();
      await hasta(function () { return filas() === n0; }); await espera(60);
      apunta('L2', [pulsada(), conSel(), filas() === n0, JSON.stringify(prioridades()) === JSON.stringify(p0)]);
      // L3: Criticos, quitar y volver a poner (alternar) antes de Limpiar.
      boton().click(); await espera(40); boton().click(); await espera(40); boton().click(); await espera(40);
      apunta('L3a', pulsada());
      limpiar();
      await hasta(function () { return pulsada() === 'false' && filas() === n0; }); await espera(60);
      apunta('L3', [pulsada(), conSel(), filas() === n0]);
      // L4: sin nada elegido, Limpiar no cambia lo de siempre.
      limpiar(); await espera(300);
      apunta('L4', [pulsada(), conSel(), filas() === n0, JSON.stringify(prioridades()) === JSON.stringify(p0), dias.value]);
      // Despues de Limpiar el clic sigue funcionando.
      boton().click(); await espera(60);
      apunta('L5', [pulsada(), Object.keys(prioridades()), foco()]);
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('backlog/backlog.html', 'backlog.js', ANTES, sonda);
Banco.correr({ '/backlog/__banco.html': BANCO }, ['/backlog/__banco.html']).then(function (res) {
  if (!res[0]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda'); process.exit(1); }
  Check('S0 sin errores de JS en la pagina', [], res[0].errores);
  var o = Banco.mapa(res[0]);
  Check('C0 arranque: Criticos sin elegir, antiguos con varias prioridades, un solo boton que filtra', ['false', 0, true, true, 1], o.C0);
  Check('C1 clic: marcada, foco, antiguos solo Critica, cifras sin cambio', ['true', 1, 'criticos', ['Critica'], true], o.C1);
  Check('C2 otro clic: sin marca, antiguos como al abrir', ['false', 0, true, true], o.C2);
  Check('C3 la barra Alta a mano tras Criticos: sin marca, antiguos solo Alta', ['false', 0, ['Alta']], o.C3);
  Check('L1 Limpiar con Criticos: sin marca ni aria-pressed, antiguos completos, corte igual, ventana a 30, cifras iguales',
    ['false', 0, true, true, true, '30', true], o.L1);
  Check('L2a antes: Criticos y luego la barra Alta a mano', ['false', ['Alta']], o.L2a);
  Check('L2 Limpiar tras cambiar la barra a mano: sin marca, antiguos completos', ['false', 0, true, true], o.L2);
  Check('L3a antes: Criticos alternada tres veces (queda puesta)', 'true', o.L3a);
  Check('L3 Limpiar: sin marca, antiguos completos', ['false', 0, true], o.L3);
  Check('L4 Limpiar sin nada elegido: igual que siempre', ['false', 0, true, true, '30'], o.L4);
  Check('L5 despues de Limpiar el clic vuelve a filtrar', ['true', ['Critica'], 'criticos'], o.L5);
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
